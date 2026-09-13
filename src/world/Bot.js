/**
 * Bot.js — battle royale participants. BATTLE_ROYALE_SPEC §9.
 *
 * Bots use the REAL gameplay systems (§9): the same PlayerController for movement and
 * collision, the same Weapon instances, the same DamageModel, the same WorldLoot. There
 * are no separate combat rules for bots — a bot's shot resolves through the same code a
 * player's does, only with deliberately imperfect aim (§9.3).
 *
 * The world must keep evolving even if the human does nothing (§9.10), so bots fight each
 * other through the same path they fight the player.
 */
import { TILE, WEAPONS, CONSUMABLES, MATERIAL_CAP } from '../core/Config.js';
import { BOT, BOT_DIFFICULTY } from '../meta/MetaConfig.js';
import { PlayerController } from '../player/PlayerController.js';
import { Health } from '../combat/Health.js';
import { Inventory, Weapon } from '../combat/Weapon.js';
import { Descent, DropState } from '../match/DropSystem.js';
import { Events } from '../core/EventBus.js';

/** §9.1 — the spec's state list. */
export const BotState = Object.freeze({
  DROPPING: 'DROPPING',
  LANDING: 'LANDING',
  LOOTING: 'LOOTING',
  ROTATING: 'ROTATING',
  PATROLLING: 'PATROLLING',
  COMBAT: 'COMBAT',
  HEALING: 'HEALING',
  FLEEING_STORM: 'FLEEING_STORM',
  SEARCHING: 'SEARCHING',
  ELIMINATED: 'ELIMINATED'
});

const FORCEABLE_STATES = Object.freeze([
  BotState.PATROLLING, BotState.LOOTING, BotState.ROTATING,
  BotState.COMBAT, BotState.HEALING, BotState.FLEEING_STORM, BotState.SEARCHING
]);

let nextBotId = 1000;
export function resetBotIds() { nextBotId = 1000; }

export class Bot {
  /**
   * @param {object} opts
   * @param {object} opts.terrain
   * @param {object} [opts.collision]
   * @param {object} [opts.bus]
   * @param {object} [opts.spawn]
   * @param {object} [opts.rng]
   * @param {string} [opts.difficulty]
   */
  constructor({
    terrain, collision = null, bus = null, spawn = { x: 0, z: 0 },
    rng = null, difficulty = BOT.defaultDifficulty
  }) {
    this.id = nextBotId++;
    this.bus = bus;
    this.rng = rng;
    this.terrain = terrain;
    this.collision = collision;

    this.controller = new PlayerController({
      terrainHeightAt: (x, z) => terrain.heightAt(x, z),
      waterDepthAt: (x, z) => terrain.waterDepthAt?.(x, z) ?? 0,
      collision,
      bus,
      id: this.id
    });
    this.controller.teleport(spawn.x, terrain.heightAt(spawn.x, spawn.z), spawn.z);

    this.health = new Health(bus, this.id);
    this.inventory = new Inventory();
    this.descent = new Descent({ terrainHeightAt: (x, z) => terrain.heightAt(x, z) });

    this.setDifficulty(difficulty);

    this.state = BotState.PATROLLING;
    this.forcedState = null;
    this.frozen = false;
    this.home = { x: spawn.x, z: spawn.z };
    this.destination = { ...this.home };
    this.landingSpot = null;

    this.target = null;
    this.targetSeenFor = 0;
    this.reactionTimer = 0;
    this.fireTimer = 0;
    this.weaponSwitchTimer = 0;
    this.buildTimer = 0;
    this.pauseTimer = 0;
    this.lootTarget = null;
    this.droppedLoot = false;
    this.lastDamagedBy = null;
    this.lastDamagedAt = -Infinity;

    /** §17.1 — LOD tick counter, so distant bots think less often. */
    this._tickCounter = 0;

    this.stats = { eliminations: 0, damageDealt: 0, shotsFired: 0, shotsHit: 0 };
  }

  get position() { return this.controller.position; }
  get alive() { return this.health.alive; }
  get activeWeapon() { return this.inventory.activeWeapon; }

  setDifficulty(name) {
    this.difficultyName = BOT_DIFFICULTY[name] ? name : BOT.defaultDifficulty;
    this.difficulty = { ...BOT_DIFFICULTY[this.difficultyName] };
  }

  /** Admin override of individual AI values — ADMIN_PANEL_SPEC §7.1. */
  tuneDifficulty(values) {
    this.difficulty = { ...this.difficulty, ...values };
  }

  _random() {
    return this.rng ? this.rng.next() : Math.random();
  }

  /* ── drop — §5.4, §9 ───────────────────────────────────────────────────── */

  boardTransport(position) {
    this.state = BotState.DROPPING;
    this.descent.board(position);
  }

  setLandingSpot(spot) {
    this.landingSpot = spot ? { x: spot.x, z: spot.z } : null;
  }

  /** Bots jump when the transport is nearest their chosen landing spot. */
  _updateDropping(dt, transport) {
    if (!transport) return;
    this.descent.position = { ...transport.position };

    if (!this.landingSpot || !transport.windowOpen) {
      // No preference, or the window has closed: exit now rather than ride to the end.
      this.descent.jump(transport.position, true);
      this.state = BotState.LANDING;
      return;
    }

    const p = transport.position;
    const distance = Math.hypot(this.landingSpot.x - p.x, this.landingSpot.z - p.z);
    // Jump once the glide can reach the spot: rough horizontal reach from this altitude.
    const reach = (p.y / 12) * 26;
    if (distance <= reach) {
      this.descent.jump(p, true);
      this.state = BotState.LANDING;
    }
    void dt;
  }

  _updateLanding(dt) {
    const target = this.landingSpot ?? this.home;
    const dx = target.x - this.descent.position.x;
    const dz = target.z - this.descent.position.z;
    const d = Math.hypot(dx, dz);
    const steer = d > 1 ? { x: 0, z: 1 } : { x: 0, z: 0 };
    const yaw = d > 1 ? Math.atan2(-dx, -dz) : this.controller.yaw;
    this.controller.yaw = yaw;

    this.descent.update(dt, steer, yaw);

    if (this.descent.state === DropState.LANDED) {
      const p = this.descent.position;
      this.controller.teleport(p.x, p.y, p.z);
      this.state = BotState.LOOTING;
    }
  }

  /* ── perception — §9.2 ─────────────────────────────────────────────────── */

  /**
   * Can this bot see a target? Distance and line of sight only — no omniscience (§9.2).
   * Recent damage widens awareness, so a bot shot from behind turns around.
   */
  canSee(other) {
    if (!other || other.alive === false) return false;
    const p = other.position ?? other;
    const d = Math.hypot(p.x - this.position.x, p.z - this.position.z);
    if (d > BOT.sightRange) return false;

    if (this.collision) {
      const origin = { x: this.position.x, y: this.position.y + 1.5, z: this.position.z };
      const dir = { x: (p.x - origin.x) / d, y: 0, z: (p.z - origin.z) / d };
      const blocked = this.collision.raycastSolid({ origin, direction: dir }, d);
      if (blocked && blocked.distance < d - TILE * 0.5) return false;
    }
    return true;
  }

  /** Nearest visible enemy among all participants — §9.10 includes other bots. */
  _acquireTarget(enemies) {
    let best = null;
    for (const enemy of enemies) {
      if (!enemy || enemy.id === this.id || enemy.alive === false) continue;
      if (!this.canSee(enemy)) continue;
      const d = Math.hypot(enemy.position.x - this.position.x, enemy.position.z - this.position.z);
      if (best === null || d < best.d) best = { enemy, d };
    }
    return best?.enemy ?? null;
  }

  /* ── weapons — §9.4 ────────────────────────────────────────────────────── */

  /** Pick a weapon suited to the range band. Rate-limited so bots do not thrash (§9.4). */
  _selectWeapon(distance) {
    if (this.weaponSwitchTimer > 0) return;

    const preferred = distance <= BOT.closeRange
      ? ['shotgun', 'smg']
      : distance <= BOT.mediumRange
        ? ['assaultRifle', 'smg']
        : ['sniper', 'assaultRifle'];

    let bestSlot = -1;
    let bestRank = Infinity;
    for (let i = 0; i < this.inventory.slots.length; i++) {
      const slot = this.inventory.slots[i];
      if (slot?.kind !== 'weapon') continue;
      const rank = preferred.indexOf(WEAPONS[slot.weapon.id].category);
      if (rank >= 0 && rank < bestRank) { bestRank = rank; bestSlot = i; }
    }
    if (bestSlot < 0) {
      for (let i = 0; i < this.inventory.slots.length; i++) {
        if (this.inventory.slots[i]?.kind === 'weapon') { bestSlot = i; break; }
      }
    }

    if (bestSlot >= 0 && (this.inventory.pickaxeEquipped || this.inventory.selected !== bestSlot)) {
      this.inventory.switchCooldown = 0;
      if (this.inventory.select(bestSlot)) {
        this.weaponSwitchTimer = BOT.weaponSwitchCooldown;
      }
    }
  }

  /* ── combat — §9.3 ─────────────────────────────────────────────────────── */

  /**
   * Fire at the current target through the real weapon and damage path, with aim error
   * scaled by difficulty (§9.3). Returns the damage dealt, or 0.
   */
  _tryFire(distance) {
    const weapon = this.activeWeapon;
    if (!weapon || !this.target) return 0;

    if (weapon.isEmpty) {
      weapon.beginReload(this.inventory.ammo[weapon.ammoType] ?? 0);
      return 0;
    }
    if (!weapon.canFire) return 0;
    if (this.reactionTimer > 0) return 0;

    weapon.fire(this.bus, this.rng);
    this.stats.shotsFired++;

    // §9.3 — accuracy and aim error, never perfect hitscan.
    const roll = this._random();
    const rangePenalty = Math.min(0.45, distance / (BOT.sightRange * 2.2));
    const hitChance = Math.max(0, this.difficulty.accuracy - rangePenalty);
    if (roll > hitChance) return 0;

    // Aim error decides body vs head.
    const headRoll = this._random();
    const region = headRoll < Math.max(0, 0.18 - this.difficulty.aimError * 0.03) ? 'head' : 'torso';
    const damage = weapon.damageAt(distance, region);

    this.stats.shotsHit++;
    this.stats.damageDealt += damage;

    const before = this.target.alive;
    this.target.takeDamage?.(damage, { source: 'bot', by: this.id, region });
    if (before && this.target.alive === false) {
      this.stats.eliminations++;
      this.bus?.emit('bot:eliminatedTarget', { botId: this.id, targetId: this.target.id });
    }

    this.bus?.emit('bot:fired', {
      botId: this.id, targetId: this.target.id ?? null, damage, region
    });
    return damage;
  }

  /* ── looting — §9.5 ────────────────────────────────────────────────────── */

  _findLoot(worldLoot) {
    if (!worldLoot) return null;
    let best = null;
    for (const pickup of worldLoot.pickups) {
      const d = Math.hypot(pickup.position.x - this.position.x, pickup.position.z - this.position.z);
      if (d > BOT.lootSearchRange) continue;

      // Prefer weapons when short of them, then ammo and healing.
      const weaponCount = this.inventory.slots.filter((s) => s?.kind === 'weapon').length;
      let value = 1;
      if (pickup.item.kind === 'weapon') value = weaponCount < 2 ? 5 : 2;
      else if (pickup.item.kind === 'consumable') value = 3;
      else if (pickup.item.kind === 'ammo') value = 2;

      const score = value / (1 + d / TILE);
      if (best === null || score > best.score) best = { pickup, d, score };
    }
    return best;
  }

  _updateLooting(dt, worldLoot) {
    const found = this._findLoot(worldLoot);
    if (!found) {
      this.state = BotState.SEARCHING;
      return { x: 0, z: 0 };
    }

    this.lootTarget = found.pickup;
    if (found.d <= BOT.lootReachRange) {
      worldLoot.collect(found.pickup, this.inventory);
      // Equip a weapon as soon as one is held (§9.5).
      const slot = this.inventory.slots.findIndex((s) => s?.kind === 'weapon');
      if (slot >= 0 && this.inventory.pickaxeEquipped) {
        this.inventory.switchCooldown = 0;
        this.inventory.select(slot);
      }
      this.lootTarget = null;
      return { x: 0, z: 0 };
    }
    void dt;
    return this._steerTo(found.pickup.position);
  }

  /* ── healing — §9.6 ────────────────────────────────────────────────────── */

  _shouldHeal(underAttack) {
    if (underAttack) return false;
    const ratio = (this.health.health + this.health.shield) / 200;
    if (ratio > this.difficulty.healThreshold) return false;
    return this.inventory.slots.some((s) => s?.kind === 'consumable');
  }

  _updateHealing(dt, underAttack) {
    if (underAttack) {
      this.health.cancelConsumable();     // §9.6 — cancel when threatened
      this.state = BotState.COMBAT;
      return;
    }
    if (!this.health.consuming) {
      const slot = this.inventory.slots.findIndex((s) => s?.kind === 'consumable');
      if (slot < 0 || !this.health.beginConsumable(this.inventory.slots[slot].id)) {
        this.state = BotState.PATROLLING;
        return;
      }
      this.inventory.drop(slot);
    }
    this.health.update(dt);
    if (!this.health.consuming) this.state = BotState.PATROLLING;
  }

  /* ── movement helpers ──────────────────────────────────────────────────── */

  _steerTo(point) {
    const dx = point.x - this.position.x;
    const dz = point.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) return { x: 0, z: 0 };
    this.controller.yaw = Math.atan2(-dx, -dz);
    return { x: 0, z: 1 };
  }

  _pickDestination(radius = TILE * 8) {
    const angle = this._random() * Math.PI * 2;
    const dist = this._random() * radius;
    this.destination = {
      x: this.position.x + Math.cos(angle) * dist,
      z: this.position.z + Math.sin(angle) * dist
    };
  }

  /* ── building — §9.8, deliberately limited ────────────────────────────── */

  _maybeBuild(placeWall) {
    if (this.buildTimer > 0) return false;
    if (this._random() > this.difficulty.buildFrequency) return false;
    if (!placeWall) return false;
    this.buildTimer = BOT.buildCooldown;
    return placeWall(this);
  }

  /* ── damage ────────────────────────────────────────────────────────────── */

  takeDamage(amount, meta = {}) {
    if (!this.alive) return { healthLost: 0, died: false };
    const wasAlive = this.health.alive;
    const r = this.health.takeDamage(amount, { ...meta, targetId: this.id });
    this.lastDamagedBy = meta.by ?? null;
    this.lastDamagedAt = 0;

    if (wasAlive && !this.health.alive) {
      this.state = BotState.ELIMINATED;
      this.bus?.emit(Events.PLAYER_DIED, { ownerId: this.id, by: meta.by ?? null, ...meta });
    }
    return r;
  }

  /* ── main update ───────────────────────────────────────────────────────── */

  /**
   * @param {number} dt
   * @param {object} ctx
   * @param {Array} ctx.enemies      every other participant
   * @param {object} [ctx.storm]
   * @param {object} [ctx.worldLoot]
   * @param {object} [ctx.transport]
   * @param {Function} [ctx.placeWall]
   * @param {number} [ctx.lodRate]   update every N ticks (§17.1)
   */
  update(dt, ctx = {}) {
    if (!this.alive) {
      this.state = BotState.ELIMINATED;
      return;
    }
    if (this.frozen) return;

    const {
      enemies = [], storm = null, worldLoot = null, transport = null,
      placeWall = null, lodRate = 1
    } = ctx;

    // §17.1 — distant bots decide less often, but never freeze: movement still integrates.
    this._tickCounter++;
    const thinkThisTick = lodRate <= 1 || this._tickCounter % lodRate === 0;
    const thinkDt = dt * (lodRate <= 1 ? 1 : lodRate);

    this.fireTimer = Math.max(0, this.fireTimer - dt);
    this.weaponSwitchTimer = Math.max(0, this.weaponSwitchTimer - dt);
    this.buildTimer = Math.max(0, this.buildTimer - dt);
    this.reactionTimer = Math.max(0, this.reactionTimer - dt);
    this.lastDamagedAt += dt;
    this.inventory.update(dt);
    this.health.update(dt);

    // Drop phase runs on its own path.
    if (this.state === BotState.DROPPING) { this._updateDropping(dt, transport); return; }
    if (this.state === BotState.LANDING) { this._updateLanding(dt); return; }

    let axis = { x: 0, z: 0 };

    if (thinkThisTick) {
      axis = this._think(thinkDt, { enemies, storm, worldLoot, placeWall });
      this._lastAxis = axis;
    } else {
      axis = this._lastAxis ?? { x: 0, z: 0 };
    }

    this.controller.update(dt, axis, {
      sprintHeld: this.state === BotState.ROTATING || this.state === BotState.FLEEING_STORM
    });

    // §8.3 — storm damage through the same path the player uses.
    if (storm) {
      const dmg = storm.damageFor(this.id, this.position.x, this.position.z, dt);
      if (dmg > 0) this.takeDamage(dmg, { source: 'storm' });
    }
  }

  /** One decision pass. Returns the movement axis to walk this tick. */
  _think(dt, { enemies, storm, worldLoot, placeWall }) {
    const underAttack = this.lastDamagedAt < 2.0;

    // Storm pressure outranks everything — §9.7, bots must not die to the storm.
    if (storm && storm.state !== 'idle') {
      const outside = !storm.isInside(this.position.x, this.position.z);
      const distanceToSafety = storm.distanceToSafety(this.position.x, this.position.z);
      const travelTime = Math.max(0, distanceToSafety) / 7.6;   // sprint speed

      if (outside) {
        this.state = BotState.FLEEING_STORM;
        return this._steerTo(storm.nextZoneTarget(this.position.x, this.position.z));
      }
      if (storm.timer < travelTime + BOT.rotationSafetyMargin && this.state !== BotState.COMBAT) {
        this.state = BotState.ROTATING;
        return this._steerTo(storm.nextZoneTarget(this.position.x, this.position.z));
      }
    }

    // Forced state from the admin panel wins over normal selection (§7.2).
    if (this.forcedState && FORCEABLE_STATES.includes(this.forcedState)) {
      this.state = this.forcedState;
    }

    if (this.state === BotState.HEALING) {
      this._updateHealing(dt, underAttack);
      return { x: 0, z: 0 };
    }

    const target = this._acquireTarget(enemies);
    if (target) {
      if (this.target?.id !== target.id) {
        this.target = target;
        this.reactionTimer = this.difficulty.reactionTime;   // §9.3
      }
      this.state = BotState.COMBAT;

      const d = Math.hypot(target.position.x - this.position.x, target.position.z - this.position.z);
      this._selectWeapon(d);
      this._tryFire(d);
      if (underAttack) this._maybeBuild(placeWall);

      // Hold at attack range rather than walking into the enemy.
      if (d > BOT.attackRange) return this._steerTo(target.position);
      if (d < BOT.closeRange * 0.6) return { x: 0, z: -1 };
      return { x: 0, z: 0 };
    }

    this.target = null;

    if (this._shouldHeal(underAttack)) {
      this.state = BotState.HEALING;
      return { x: 0, z: 0 };
    }

    const weaponCount = this.inventory.slots.filter((s) => s?.kind === 'weapon').length;
    if (worldLoot && weaponCount < 3) {
      const axis = this._updateLooting(dt, worldLoot);
      if (this.state === BotState.LOOTING) return axis;
      this.state = BotState.LOOTING;
      return axis;
    }

    // Nothing pressing — patrol.
    this.state = BotState.PATROLLING;
    if (this.pauseTimer > 0) { this.pauseTimer -= dt; return { x: 0, z: 0 }; }
    const steer = this._steerTo(this.destination);
    if (steer.x === 0 && steer.z === 0) {
      this.pauseTimer = 1.5;
      this._pickDestination();
    }
    return steer;
  }

  /* ── admin — ADMIN_PANEL_SPEC §7 ──────────────────────────────────────── */

  freeze() { this.frozen = true; }
  resume() { this.frozen = false; }

  /** @returns {boolean} false if the state is not forceable (§7.2 warns rather than breaks) */
  forceState(state) {
    if (!FORCEABLE_STATES.includes(state)) return false;
    this.forcedState = state;
    this.state = state;
    return true;
  }

  clearForcedState() { this.forcedState = null; }

  /** §10 — drop everything on elimination. */
  dropLoot(worldLoot) {
    if (this.droppedLoot || this.alive || !worldLoot) return [];
    this.droppedLoot = true;
    return worldLoot.dropInventory(this.position, this.inventory, this.controller.materials);
  }

  /** Give a bot a starting loadout — used by admin tools and tests. */
  giveWeapon(weaponId, rarity = 'common') {
    const slot = this.inventory.slots.findIndex((s) => s === null);
    if (slot < 0) return false;
    this.inventory.slots[slot] = { kind: 'weapon', rarity, weapon: new Weapon(weaponId, rarity) };
    this.inventory.addAmmo(WEAPONS[weaponId].ammo, 200);
    this.inventory.switchCooldown = 0;
    this.inventory.select(slot);
    const w = this.inventory.activeWeapon;
    if (w) w.equipRemaining = 0;
    return true;
  }

  giveConsumable(id) {
    const slot = this.inventory.slots.findIndex((s) => s === null);
    if (slot < 0 || !CONSUMABLES[id]) return false;
    this.inventory.slots[slot] = { kind: 'consumable', id, count: 1 };
    return true;
  }

  respawn(spawn = null) {
    const p = spawn ?? this.home;
    this.health.reset();
    this.controller.reset();
    this.controller.teleport(p.x, this.terrain.heightAt(p.x, p.z), p.z);
    this.controller.materials = { wood: 0, brick: 0, metal: 0 };
    this.state = BotState.PATROLLING;
    this.droppedLoot = false;
    this.target = null;
    this.forcedState = null;
    this.frozen = false;
    this.descent.reset();
  }

  snapshot() {
    return {
      id: this.id,
      state: this.state,
      alive: this.alive,
      health: this.health.health,
      shield: this.health.shield,
      position: { ...this.position },
      targetId: this.target?.id ?? null,
      difficulty: this.difficultyName,
      weapon: this.activeWeapon?.name ?? 'Pickaxe'
    };
  }
}

export { MATERIAL_CAP };
