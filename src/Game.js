/**
 * Game.js — system wiring and one simulation tick.
 *
 * Tick order is fixed and deliberate (§27 phase order):
 *   input -> player -> collision -> building -> editing -> combat -> world
 *
 * Holds no gameplay numbers; everything comes from Config.
 */
import { SIM, PIECE_TYPES, MATERIAL_ORDER, DIRECTIONS, EDIT, MATERIAL_CAP } from './core/Config.js';
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

export class Game {
  constructor({ seed = 1337, input = null, settings = null } = {}) {
    this.bus = new EventBus();
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

    this._spawn();
  }

  _spawn() {
    const s = this.terrain.spawnPoint();
    this.player.teleport(s.x, s.y + 0.1, s.z);
    this.player.materials = { wood: MATERIAL_CAP, brick: MATERIAL_CAP, metal: MATERIAL_CAP };
    this.inventory.slots[0] = { kind: 'weapon', rarity: 'rare', weapon: new Weapon('assaultRifle', 'rare') };
    this.inventory.slots[1] = { kind: 'weapon', rarity: 'uncommon', weapon: new Weapon('pumpShotgun', 'uncommon') };
    this.inventory.addAmmo('medium', 210);
    this.inventory.addAmmo('shells', 60);
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

    for (const spawn of layout.botSpawns) {
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
    // Bots shooting the player (§17).
    this.bus.on('bot:fired', (e) => {
      if (e.targetId === this.player.id) this.health.takeDamage(e.damage, { source: 'bot' });
    });
  }

  /** One simulation tick, always SIM.fixedDt. */
  update(dt = SIM.fixedDt) {
    this.time += dt;

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

    for (const bot of this.bots) {
      bot.update(dt, { player: { position: this.player.position, id: this.player.id, health: this.health } });
      if (!bot.alive && !bot.droppedLoot) {
        bot.dropLoot(this.worldLoot);
        this.eliminations++;
      }
    }

    this.input.endTick();
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
    if (!weapon.fire(this.bus, this.rng.spread)) return;

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
    bot.takeDamage(damage, { source: 'player' });
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
      playersAlive: 1 + this.bots.filter((b) => b.alive).length,
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
