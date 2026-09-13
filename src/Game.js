/**
 * Game.js — system wiring and one simulation tick.
 *
 * Tick order is fixed and deliberate (§27 phase order):
 *   input -> player -> collision -> building -> editing -> combat -> world
 *
 * Holds no gameplay numbers; everything comes from Config.
 */
import { SIM, PIECE_TYPES, MATERIAL_ORDER, DIRECTIONS, EDIT, MATERIAL_CAP, BUILD } from './core/Config.js';
import { EventBus, Events } from './core/EventBus.js';
import { MatchRandom } from './core/Random.js';
import { Input } from './core/Input.js';
import { BuildGrid, worldToCell, cellCentre } from './building/BuildGrid.js';
import { BuildPiece } from './building/BuildPiece.js';
import { CollisionWorld } from './building/CollisionWorld.js';
import { PlacementQueue } from './building/PlacementQueue.js';
import { validatePlacement, placePiece } from './building/Placement.js';
import { resolveBuildTarget } from './building/BuildTargeting.js';
import { EditController } from './editing/EditController.js';
import { PlayerController } from './player/PlayerController.js';
import { PlayerCamera } from './player/PlayerCamera.js';
import { aimRayFrom, rayAabb } from './player/AimRay.js';
import { Health } from './combat/Health.js';
import { Inventory, Weapon } from './combat/Weapon.js';
import { Pickaxe } from './combat/Pickaxe.js';
import { TestEnvironment } from './world/TestEnvironment.js';
import { WorldLoot } from './loot/WorldLoot.js';
import { Bot } from './world/Bot.js';
import { resolvePelletHits, pelletPattern } from './combat/DamageModel.js';
import { PICKAXE, WEAPONS, TILE } from './core/Config.js';
import { Storm } from './match/Storm.js';
import { Transport, Descent, DropState, generateDropRoute, chooseLandingSpot } from './match/DropSystem.js';
import { MATCH, BOT } from './meta/MetaConfig.js';

export class Game {
  constructor({
    seed = 1337, input = null, settings = null,
    bus = null, cosmetics = null, botCount = null,
    registry = null, match = null
  } = {}) {
    this.bus = bus ?? new EventBus();
    /** Equipped cosmetics, read once from the profile and passed in (ITEM_SHOP_SPEC §8.2). */
    this.cosmetics = cosmetics;
    this.registry = registry;
    this.match = match;
    this.rng = new MatchRandom(seed);
    this.input = input ?? new Input();
    this.settings = settings;
    this.time = 0;

    this.terrain = new TestEnvironment();
    this.grid = new BuildGrid();
    this.collision = new CollisionWorld(this.grid);

    this.player = new PlayerController({
      terrainHeightAt: (x, z) => this.terrain.heightAt(x, z),
      waterDepthAt: (x, z) => this.terrain.waterDepthAt(x, z),
      collision: this.collision,
      bus: this.bus,
      id: 1
    });
    this.health = new Health(this.bus, 1);
    this.inventory = new Inventory();

    // Camera collision reads the same CollisionWorld the player does (§7.1).
    this.camera = new PlayerCamera(
      (origin, dir, maxDist, radius) => this.collision.sphereCast(origin, dir, maxDist, radius)
    );
    this.editor = new EditController(this.grid, this.bus, settings);
    this.placementQueue = new PlacementQueue();
    this.pickaxe = new Pickaxe(this.bus);
    this.worldLoot = new WorldLoot(this.bus, this.rng.loot);

    /** §17 — lightweight test targets. */
    this.bots = [];
    this.botCount = botCount ?? 0;
    /** §18 — counters the HUD shows. */
    this.eliminations = 0;
    this.interactTarget = null;
    /** Harvestable props (§14). */
    this.props = [];

    this.buildMode = false;
    this.selectedPiece = PIECE_TYPES[0];
    this.selectedMaterial = MATERIAL_ORDER[0];
    this.rotation = DIRECTIONS[0];
    this.buildTarget = null;
    this.aimRay = null;

    this.storm = new Storm({ rng: this.rng.storm, bus: this.bus });
    /**
     * Developer flags, injected by AdminService when DEV_MODE is on. Defaults are all
     * false and the object is replaced, never mutated here, so with admin disabled this
     * is inert and gameplay reads exactly as it would without it.
     */
    this.adminFlags = { godMode: false, infiniteAmmo: false, infiniteMaterials: false, noReload: false };
    this.dropRoute = null;
    this.transport = null;
    this.descent = new Descent({ terrainHeightAt: (x, z) => this.terrain.heightAt(x, z) });
    this.inDropPhase = false;

    this._spawn();
  }

  _spawn() {
    const s = this.terrain.spawnPoint();
    this.player.teleport(s.x, s.y + 0.1, s.z);
    if (this.botCount > 0) {
      // BATTLE_ROYALE_SPEC §6 — all participants begin without a combat inventory.
      const m = MATCH.startingMaterials;
      this.player.materials = { wood: m, brick: m, metal: m };
      this.health.health = MATCH.startingHealth;
      this.health.shield = MATCH.startingShield;
    } else {
      // Sandbox / test environment: a starting kit so the systems are exercisable.
      this.player.materials = { wood: MATERIAL_CAP, brick: MATERIAL_CAP, metal: MATERIAL_CAP };
      this.inventory.slots[0] = { kind: 'weapon', rarity: 'rare', weapon: new Weapon('assaultRifle', 'rare') };
      this.inventory.slots[1] = { kind: 'weapon', rarity: 'uncommon', weapon: new Weapon('pumpShotgun', 'uncommon') };
      this.inventory.addAmmo('medium', 210);
      this.inventory.addAmmo('shells', 60);
    }
    this.camera.snapTo(this.player);
    this._populateRegion();
    this._wireCombatEvents();
  }

  /** Build the validation region's contents (§22). */
  _populateRegion() {
    const layout = this.terrain.layout();
    const at = (p) => ({ x: p.x, y: this.terrain.heightAt(p.x, p.z), z: p.z });

    for (const p of layout.chests) this.worldLoot.addContainer(at(p), 'chest');
    for (const p of layout.ammoBoxes) this.worldLoot.addContainer(at(p), 'ammoBox');
    for (const p of layout.floorLoot) this.worldLoot.spawnFloorLoot(at(p), { tier: 'landmark' });

    this.props = layout.props.map((prop) => ({
      ...prop,
      position: at(prop),
      remaining: prop.total,
      depleted: false
    }));

    const spawnCount = this.botCount > 0 ? this.botCount : layout.botSpawns.length;
    for (let i = 0; i < spawnCount; i++) {
      const base = layout.botSpawns[i % layout.botSpawns.length];
      // Scatter beyond the authored spawns so a full lobby is not stacked on two points.
      const spread = TILE * 24;
      const spawn = i < layout.botSpawns.length ? base : {
        x: this.rng.cosmetic.range(-spread, spread),
        z: this.rng.cosmetic.range(-spread, spread)
      };
      this.bots.push(new Bot({
        terrain: this.terrain,
        collision: this.collision,
        bus: this.bus,
        spawn,
        rng: this.rng.cosmetic
      }));
    }
  }

  _wireCombatEvents() {
    // Bots damage their target directly through takeDamage; the event is for audio and
    // the admin event log only.
    this.bus.on('bot:fired', () => {});
  }

  /** One simulation tick, always SIM.fixedDt. */
  update(dt = SIM.fixedDt) {
    this.time += dt;

    // Drop phase runs its own reduced tick: no building, no combat, just descent (§5).
    if (this.inDropPhase) {
      this._updateDropPhase(dt);
      return;
    }

    const intent = this._readInput(dt);

    this.player.update(dt, intent.moveAxis, {
      sprintHeld: intent.sprint,
      buildMode: this.buildMode,
      editMode: this.editor.isEditing,
      health: this.health
    });

    // Camera updates before targeting so the aim ray reflects this tick's view (§8.1).
    const weapon = this.inventory.activeWeapon;
    this.camera.update(dt, this.player, {
      adsProgress: weapon?.adsProgress ?? 0,
      adsFov: weapon?.def.adsFov ?? null
    });
    this.aimRay = aimRayFrom(this.camera);

    this.grid.update(dt);
    this._updateBuildTarget();
    this.placementQueue.update(dt, (i) => this._executePlacement(i));
    this._updateEditing(dt, intent);

    this._updateCombat(dt, intent);

    this.inventory.update(dt, { ads: intent.ads });
    this.pickaxe.update(dt);
    this.health.update(dt);
    this.worldLoot.update(dt);
    this._updateInteraction();

    this._updateStorm(dt);
    this._updateBots(dt);

    this.input.endTick();
  }

  /**
   * Drop phase tick — §5. Movement is the Descent, not the PlayerController, so the stable
   * ground movement model is untouched by falling.
   */
  _updateDropPhase(dt) {
    const input = this.input;
    const look = input.consumeLook();
    this.player.look(look.x, look.y, Input.sensitivityFor({}), this.settings?.invertY ?? false);

    this.transport?.update(dt);

    if (this.descent.state === DropState.IN_TRANSPORT) {
      if (this.transport) this.descent.position = { ...this.transport.position };
      // Jump on the jump bind while the window is open; once it closes, the player is
      // ejected automatically rather than riding a finished transport forever.
      if (input.wasPressed('jump')) this.jumpFromTransport();
      else if (!this.transport?.windowOpen) this.descent.jump(this.descent.position, true);
    } else if (this.descent.isDescending) {
      if (input.wasPressed('jump')) this.deployGlider();
      this.descent.update(dt, input.moveAxis(), this.player.yaw);
    }

    const p = this.descent.position;
    this.player.teleport(p.x, p.y, p.z);
    if (this.descent.state === DropState.LANDED) this.player.grounded = true;

    this.camera.update(dt, this.player, {});
    this.aimRay = aimRayFrom(this.camera);

    for (const bot of this.bots) {
      bot.update(dt, { transport: this.transport });
    }

    this.worldLoot.update(dt);
    this.input.endTick();
  }

  /** Storm damage to the player, through the participant path (§8.3). */
  _updateStorm(dt) {
    this.storm.update(dt);
    const damage = this.storm.damageFor(this.player.id, this.player.position.x, this.player.position.z, dt);
    if (damage > 0 && !this.adminFlags.godMode) {
      // §8.3 — storm bypasses shield.
      this.health.takeDirectHealthDamage(damage, 'storm');
      if (!this.health.alive) {
        this.registry?.eliminate(this.player.id, { by: null, at: this.time });
      }
    }
  }

  /**
   * Bots, with staggered update rates by distance (§17.1). Every bot sees every other
   * participant, so bots fight each other as well as the player (§9.10).
   */
  _updateBots(dt) {
    const participants = [this.participant, ...this.bots];

    for (const bot of this.bots) {
      if (!bot.alive) {
        if (!bot.droppedLoot) {
          bot.dropLoot(this.worldLoot);
          this.registry?.eliminate(bot.id, { by: bot.lastDamagedBy, at: this.time });
          this.eliminations = this.registry?.get(this.player.id)?.stats.eliminations ?? this.eliminations;
        }
        continue;
      }

      const d = Math.hypot(bot.position.x - this.player.position.x, bot.position.z - this.player.position.z);
      const lodRate = d < BOT.lodNear ? BOT.lodRates.near
        : d < BOT.lodMedium ? BOT.lodRates.medium
          : BOT.lodRates.far;

      bot.update(dt, {
        enemies: participants.filter((p) => p.id !== bot.id),
        storm: this.storm,
        worldLoot: this.worldLoot,
        placeWall: (b) => this._botPlaceWall(b),
        lodRate
      });
    }
  }

  /** §9.8 — a bot places a single defensive wall, through the real building system. */
  _botPlaceWall(bot) {
    const cell = worldToCell(bot.position.x, bot.position.y, bot.position.z);
    const facing = bot.controller.forward;
    const direction = Math.abs(facing.x) > Math.abs(facing.z)
      ? (facing.x > 0 ? 'east' : 'west')
      : (facing.z > 0 ? 'south' : 'north');

    const builder = {
      id: bot.id,
      position: bot.position,
      materials: bot.controller.materials
    };
    if ((builder.materials[this.selectedMaterial] ?? 0) < 10) builder.materials.wood = 100;

    const result = placePiece({
      grid: this.grid, type: 'wall', material: 'wood',
      cell, direction, builder, players: []
    });
    if (result.ok) this.bus.emit(Events.PIECE_PLACED, { piece: result.piece });
    return result.ok;
  }

  _readInput(dt) {
    const input = this.input;
    void dt;

    const look = input.consumeLook();
    const sensitivity = Input.sensitivityFor({
      adsProgress: this.inventory.activeWeapon?.adsProgress ?? 0,
      userSensitivity: this.settings?.mouseSensitivity ?? 1
    });
    this.player.look(look.x, look.y, sensitivity, this.settings?.invertY ?? false);

    const intent = {
      moveAxis: input.moveAxis(),
      sprint: input.isDown('sprint'),
      ads: input.isDown('aim'),
      fire: input.isDown('fire'),
      firePresses: input.pressCount('fire')
    };

    this.player.setCrouched(input.isDown('crouch'));
    if (input.wasPressed('jump')) this.player.requestJump();

    // Build piece selection — instant, no animation lock (§9).
    const pieceBinds = ['wall', 'floor', 'ramp', 'cone'];
    pieceBinds.forEach((action, i) => {
      if (input.wasPressed(action)) {
        this.selectedPiece = PIECE_TYPES[i];
        // §19 "build immediately": selecting a piece enters build mode at once. With the
        // setting off, the piece is selected but the player stays in combat until they
        // toggle in deliberately.
        if (this.settings?.buildImmediately ?? true) this._setBuildMode(true);
      }
    });

    // Weapon slots and pickaxe leave build mode.
    for (let i = 0; i < this.inventory.size; i++) {
      if (input.wasPressed(`weaponSlot${i + 1}`)) {
        this.inventory.select(i);
        this._setBuildMode(false);
      }
    }
    if (input.wasPressed('pickaxe')) {
      this.inventory.equipPickaxe();
      this._setBuildMode(false);
    }

    if (this.buildMode && input.wasPressed('reload')) {
      this.rotation = DIRECTIONS[(DIRECTIONS.indexOf(this.rotation) + 1) % DIRECTIONS.length];
    }

    // §9.3 — every fire press in build mode becomes a QUEUED intent, never a dropped one.
    if (this.buildMode) {
      const presses = Math.max(intent.firePresses, intent.fire ? 1 : 0);
      for (let i = 0; i < presses; i++) {
        this.placementQueue.enqueue({
          type: this.selectedPiece,
          material: this.selectedMaterial,
          rotation: this.rotation
        });
      }
    }

    return intent;
  }

  _setBuildMode(on) {
    if (this.buildMode === on) return;
    this.buildMode = on;
    if (on) this.editor.cancel();       // build and edit are mutually exclusive
    else this.placementQueue.clear();
    this.bus.emit(Events.BUILD_MODE_CHANGED, { buildMode: on, piece: this.selectedPiece });
  }

  _updateBuildTarget() {
    if (!this.buildMode || !this.aimRay) {
      this.buildTarget = null;
      return;
    }
    this.buildTarget = resolveBuildTarget({
      origin: this.aimRay.origin,
      direction: this.aimRay.direction,
      pieceType: this.selectedPiece,
      rotation: this.rotation,
      grid: this.grid
    });
  }

  /** @returns {boolean} whether the placement succeeded */
  _executePlacement(intent) {
    if (!this.buildTarget) return false;

    const result = placePiece({
      grid: this.grid,
      type: intent.type,
      material: intent.material,
      cell: this.buildTarget.cell,
      direction: this.buildTarget.direction,
      builder: this.player,
      players: [this.player],
      now: this.time
    });

    if (!result.ok) return false;

    // §4.3 — infinite materials means building consumes nothing, while the actual
    // material values stay intact (the cost is returned, not bypassed).
    if (this.adminFlags.infiniteMaterials) {
      this.player.materials[intent.material] =
        Math.min(MATERIAL_CAP, this.player.materials[intent.material] + BUILD.cost);
    }

    this.player.notifyBuildPlaced();     // §5.5 — suppresses accidental mantling
    this.bus.emit(Events.PIECE_PLACED, { piece: result.piece });
    this._updateBuildTarget();
    return true;
  }

  _updateEditing(dt, intent) {
    const input = this.input;

    // §10.9 — instant reset on the reset bind, without entering the edit flow.
    if (input.wasPressed('resetEdit')) {
      const hit = this.collision.raycastPieces(this.aimRay, EDIT.range);
      if (hit) this.editor.resetPiece(hit.piece, this.player.id, hit.distance);
    }

    if (input.wasPressed('edit')) {
      if (this.editor.isEditing) {
        this.editor.confirm();
      } else {
        const hit = this.collision.raycastPieces(this.aimRay, EDIT.range);
        if (hit) {
          this._setBuildMode(false);
          this.editor.begin(hit.piece, this.player.id, hit.distance);
        }
      }
    }

    if (this.editor.isEditing) {
      const piece = this.editor.target;
      const c = piece ? piece.worldCentre : null;
      const distance = c
        ? Math.hypot(c.x - this.aimRay.origin.x, c.y - this.aimRay.origin.y, c.z - this.aimRay.origin.z)
        : Infinity;
      this.editor.update(dt, { distanceToTarget: distance });

      if (this.editor.confirmOnRelease && input.wasReleased('confirmEdit')) {
        this.editor.confirm();
      }
    }
    void intent;
  }

  /**
   * Weapon and pickaxe resolution. §12.2 requires fire, hit registration and damage
   * feedback to all happen immediately, so everything here resolves in the firing tick.
   */
  _updateCombat(dt, intent) {
    if (this.buildMode || this.editor.isEditing) return;
    void dt;

    // §14 — the pickaxe is its own slot, not one of the five.
    if (this.inventory.pickaxeEquipped) {
      if (intent.fire && this.pickaxe.canSwing) {
        const prop = this._nearestProp(PICKAXE.range);
        if (prop) this.pickaxe.harvest(prop, this.player);
        else this.pickaxe.swing({ aimRay: this.aimRay, collision: this.collision, ownerId: this.player.id });
      }
      return;
    }

    const weapon = this.inventory.activeWeapon;
    if (!weapon) return;

    if (this.input.wasPressed('reload')) {
      if (weapon.beginReload(this.inventory.ammo[weapon.ammoType] ?? 0)) {
        this.bus.emit(Events.WEAPON_RELOADED, { weaponId: weapon.id });
      }
    }

    if (!intent.fire) return;
    if (weapon.isEmpty && weapon.cooldown <= 0) {
      this.bus.emit('weapon:empty', { weaponId: weapon.id });
      return;
    }
    const reserveBefore = this.inventory.ammo[weapon.ammoType] ?? 0;
    const magBefore = weapon.ammoInMag;
    if (!weapon.fire(this.bus, this.rng.spread)) return;
    this.registry?.addStat(this.player.id, 'shotsFired', 1);

    // §4.2 — infinite ammo leaves the reserve untouched; reload stays testable. NO RELOAD
    // is a separate flag that also refills the magazine.
    if (this.adminFlags.infiniteAmmo) this.inventory.ammo[weapon.ammoType] = reserveBefore;
    if (this.adminFlags.noReload) weapon.ammoInMag = magBefore;

    this._resolveShot(weapon);
  }

  /** Trace a fired shot. Uses the shared camera aim ray, so it matches the crosshair. */
  _resolveShot(weapon) {
    const def = WEAPONS[weapon.id];

    if (def.mode === 'pellets') {
      // §12.5 — each pellet resolves independently, with its own region and distance.
      const pattern = pelletPattern(weapon.id, weapon.adsProgress >= 1, this.rng.spread);
      const pelletHits = pattern.map((offset) => this._tracePellet(offset));
      const result = resolvePelletHits({ weaponId: weapon.id, rarity: weapon.rarity, pelletHits });
      if (result.pelletsHit > 0) {
        this._applyHit(result.total, { headshot: result.isHeadshot });
      }
    } else {
      const hit = this._traceRay(this.aimRay);
      if (hit) {
        const damage = weapon.damageAt(hit.distance, hit.region);
        this._applyHit(damage, { headshot: hit.region === 'head' });
      }
    }

    // Structure damage is resolved separately and is flat (§9.5).
    const structure = this.collision.raycastPieces(this.aimRay, 200);
    if (structure) {
      const destroyed = structure.piece.applyDamage(weapon.structureDamage);
      this.bus.emit(Events.PIECE_DAMAGED, { piece: structure.piece, amount: weapon.structureDamage });
      if (destroyed) {
        this.grid.remove(structure.piece);
        this.bus.emit(Events.PIECE_DESTROYED, { piece: structure.piece, cause: 'weapon' });
      }
    }
  }

  /** Rotate a pellet offset off the aim ray and trace it. */
  _tracePellet(offset) {
    const d = this.aimRay.direction;
    const ray = {
      origin: this.aimRay.origin,
      direction: this._rotateDirection(d, offset.yaw, offset.pitch)
    };
    return this._traceRay(ray);
  }

  _rotateDirection(dir, yaw, pitch) {
    // Small-angle rotation in the plane perpendicular to dir — adequate for pellet cones.
    const right = { x: -dir.z, y: 0, z: dir.x };
    const rlen = Math.hypot(right.x, right.z) || 1;
    right.x /= rlen; right.z /= rlen;
    const up = {
      x: right.z * dir.y - 0 * dir.z,
      y: 0 * dir.z - right.x * dir.y,
      z: right.x * 0 - right.z * dir.x
    };
    const out = {
      x: dir.x + right.x * yaw + up.x * pitch,
      y: dir.y + up.y * pitch,
      z: dir.z + right.z * yaw + up.z * pitch
    };
    const len = Math.hypot(out.x, out.y, out.z) || 1;
    return { x: out.x / len, y: out.y / len, z: out.z / len };
  }

  /** @returns {{region:string, distance:number, bot:object}|null} */
  _traceRay(ray) {
    let best = null;
    for (const bot of this.bots) {
      if (!bot.alive) continue;
      const hit = this._rayHitsCapsule(ray, bot);
      if (hit && (best === null || hit.distance < best.distance)) best = { ...hit, bot };
    }
    return best;
  }

  /** Capsule approximated by a body box and a head box, so headshots are detectable. */
  _rayHitsCapsule(ray, bot) {
    const p = bot.position;
    const r = bot.controller.radius;
    const h = bot.controller.height;
    const headHeight = h * 0.18;

    const boxes = [
      { region: 'head', min: [p.x - r, p.y + h - headHeight, p.z - r], max: [p.x + r, p.y + h, p.z + r] },
      { region: 'torso', min: [p.x - r, p.y, p.z - r], max: [p.x + r, p.y + h - headHeight, p.z + r] }
    ];

    let best = null;
    for (const box of boxes) {
      const t = rayAabb(ray, box, 300);
      if (t === null) continue;
      if (best === null || t < best.distance) best = { region: box.region, distance: t };
    }
    return best;
  }

  _applyHit(damage, { headshot = false } = {}) {
    const hit = this._traceRay(this.aimRay);
    const bot = hit?.bot;
    if (!bot) return;

    const before = bot.alive;
    bot.takeDamage(damage, { source: 'player', by: this.player.id });

    // §12 — statistics live on the participant registry, shared by human and bots.
    this.registry?.addStat(this.player.id, 'damageDealt', damage);
    this.registry?.addStat(this.player.id, 'shotsHit', 1);

    if (before && !bot.alive) {
      this.registry?.eliminate(bot.id, { by: this.player.id, at: this.time });
      this.eliminations = this.registry?.get(this.player.id)?.stats.eliminations ?? this.eliminations + 1;
    }

    // §13.1 — feedback is immediate, and headshots are distinct.
    this.bus.emit('weapon:hit', { damage, headshot, elimination: before && !bot.alive });
  }

  _nearestProp(range) {
    let best = null;
    for (const prop of this.props) {
      if (prop.depleted) continue;
      const d = Math.hypot(
        prop.position.x - this.player.position.x,
        prop.position.z - this.player.position.z
      );
      if (d <= range && (best === null || d < best.d)) best = { prop, d };
    }
    return best?.prop ?? null;
  }

  /** §18 — interaction prompt, and the interact action itself. */
  _updateInteraction() {
    const found = this.worldLoot.nearestInteractable(this.player.position, TILE * 0.6);
    this.interactTarget = found?.entity ?? null;

    if (!this.interactTarget || !this.input.wasPressed('interact')) return;

    if (this.interactTarget.kind === 'pickup') {
      this.worldLoot.collect(this.interactTarget, this.inventory);
    } else {
      this.worldLoot.openContainer(this.interactTarget, { tier: 'poi' });
    }
  }

  /** Can a piece be placed at the current target? Drives the preview colour (§9.2). */
  get buildTargetValid() {
    if (!this.buildTarget) return false;
    return validatePlacement({
      grid: this.grid,
      type: this.selectedPiece,
      material: this.selectedMaterial,
      cell: this.buildTarget.cell,
      direction: this.buildTarget.direction,
      builder: this.player,
      players: [this.player],
      now: this.time
    }).ok;
  }

  /* ── battle royale integration — BATTLE_ROYALE_SPEC §5, §8 ────────────── */

  /**
   * Begin the drop phase: generate the route, board every participant, and choose bot
   * landing spots. The storm does not start until the drop ends (§8).
   */
  beginDropPhase() {
    this.inDropPhase = true;
    this.dropRoute = generateDropRoute(this.rng.storm, this.terrain.regionExtent ?? undefined);
    this.transport = new Transport(this.dropRoute);

    const boardAt = this.transport.position;
    this.descent.board(boardAt);
    this.player.teleport(boardAt.x, boardAt.y, boardAt.z);

    // §5.4 — weighted landing spots, so bots spread out.
    const candidates = this._landingCandidates();
    const taken = [];
    for (const bot of this.bots) {
      const spot = chooseLandingSpot(this.rng.storm, candidates, this.dropRoute, taken);
      if (spot) taken.push(spot);
      bot.setLandingSpot(spot);
      bot.boardTransport(boardAt);
    }
    return true;
  }

  /** Landing candidates weighted by nearby loot (§5.4). */
  _landingCandidates() {
    const spots = [];
    for (const container of this.worldLoot.containers) {
      spots.push({
        x: container.position.x,
        z: container.position.z,
        lootWeight: container.kind === 'chest' ? 3 : 1.5
      });
    }
    // Plus a scatter of plain countryside options, so not every bot chases a chest.
    const extent = (this.terrain.regionExtent ?? TILE * 80) / 2;
    for (let i = 0; i < 8; i++) {
      spots.push({
        x: this.rng.storm.range(-extent, extent),
        z: this.rng.storm.range(-extent, extent),
        lootWeight: 0.6
      });
    }
    return spots;
  }

  /** The player jumps from the transport (§5.2). */
  jumpFromTransport() {
    if (!this.transport) return false;
    return this.descent.jump(this.transport.position, this.transport.windowOpen);
  }

  deployGlider() {
    return this.descent.deployGlider();
  }

  /** True once the drop phase is over for everyone. */
  get dropComplete() {
    if (!this.inDropPhase) return true;
    const playerDown = this.descent.state === DropState.LANDED;
    const botsDown = this.bots.every((b) => !b.alive || b.state !== 'DROPPING');
    return playerDown && botsDown;
  }

  /** Called by Application once the drop ends: the storm begins (§8). */
  beginActiveMatch() {
    this.inDropPhase = false;
    this.storm.start();
    return true;
  }

  /**
   * Participant interface, so the human can be a target for bots through exactly the same
   * path bots use on each other (§9.10). No separate human damage path exists.
   */
  get participant() {
    const game = this;
    return {
      id: this.player.id,
      get position() { return game.player.position; },
      get alive() { return game.health.alive; },
      takeDamage(amount, meta = {}) {
        // ADMIN_PANEL_SPEC §4.1 — god mode blocks damage without altering health values,
        // so disabling it restores standard behaviour immediately.
        if (game.adminFlags.godMode) return { healthLost: 0, shieldAbsorbed: 0, died: false };
        const before = game.health.alive;
        const r = game.health.takeDamage(amount, meta);
        game.registry?.addStat(game.player.id, 'damageTaken', r.healthLost + r.shieldAbsorbed);
        if (meta.by != null) game.registry?.addStat(meta.by, 'damageDealt', amount);
        if (before && !game.health.alive) {
          game.registry?.eliminate(game.player.id, { by: meta.by ?? null, at: game.time });
        }
        return r;
      }
    };
  }

  /** ADMIN_PANEL_SPEC §7 — spawn additional bots into a live match. */
  spawnBots(count = 1) {
    const spawned = [];
    const spread = TILE * 12;
    for (let i = 0; i < count; i++) {
      const p = this.player.position;
      const bot = new Bot({
        terrain: this.terrain,
        collision: this.collision,
        bus: this.bus,
        spawn: {
          x: p.x + this.rng.cosmetic.range(-spread, spread),
          z: p.z + this.rng.cosmetic.range(-spread, spread)
        },
        rng: this.rng.cosmetic
      });
      this.bots.push(bot);
      spawned.push(bot);
    }
    return spawned;
  }

  /** ADMIN_PANEL_SPEC §8 — land everyone immediately. */
  skipDrop() {
    if (!this.inDropPhase) return false;
    const land = (x, z) => ({ x, y: this.terrain.heightAt(x, z), z });

    const target = this.descent.state === 'inTransport'
      ? land(0, 0)
      : land(this.descent.position.x, this.descent.position.z);
    this.descent.position = { ...target };
    this.descent.state = 'landed';
    this.player.teleport(target.x, target.y, target.z);

    for (const bot of this.bots) {
      const spot = bot.landingSpot ?? { x: 0, z: 0 };
      const p = land(spot.x, spot.z);
      bot.controller.teleport(p.x, p.y, p.z);
      bot.descent.state = 'landed';
      bot.state = 'LOOTING';
    }
    return true;
  }

  /** Read-only snapshot for the HUD (§18.1). */
  hudState(stats = null) {
    const weapon = this.inventory.activeWeapon;
    return {
      health: this.health.health,
      shield: this.health.shield,
      materials: this.player.materials,
      buildMode: this.buildMode,
      selectedPiece: this.selectedPiece,
      selectedMaterial: this.selectedMaterial,
      selectedSlot: this.inventory.selected,
      pickaxeEquipped: this.inventory.pickaxeEquipped,
      inventory: this.inventory,
      pieceCount: this.grid.pieceCount,
      editing: this.editor.isEditing,
      editTiles: this.editor.gridTileCount,
      editSelection: [...this.editor.selection],
      playersAlive: this.registry
        ? this.registry.aliveCount
        : 1 + this.bots.filter((b) => b.alive).length,
      storm: this.storm.snapshot(),
      dropPhase: this.inDropPhase,
      descentState: this.descent.state,
      eliminations: this.eliminations,
      interactPrompt: this.interactTarget
        ? (this.interactTarget.kind === 'pickup'
            ? `Pick up ${this.interactTarget.label}`
            : this.interactTarget.label)
        : null,
      spreadDegrees: weapon
        ? weapon.spread({
            horizontalSpeed: this.player.horizontalSpeed,
            airborne: !this.player.grounded,
            crouched: this.player.crouched
          })
        : 0,
      stats
    };
  }
}

export { worldToCell, cellCentre, BuildPiece };
