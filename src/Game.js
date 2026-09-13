/**
 * Game.js — wires the systems together and owns one simulation tick.
 *
 * The tick order matters and is fixed: input -> player -> building -> editing ->
 * combat -> world. Nothing here holds gameplay numbers; everything comes from Config.
 */
import { SIM, BUILD, MATERIAL_ORDER, PIECE_TYPES, DIRECTIONS, EDIT, WORLD } from './core/Config.js';
import { EventBus, Events } from './core/EventBus.js';
import { MatchRandom } from './core/Random.js';
import { BuildGrid } from './building/BuildGrid.js';
import { placePiece, PlacementResult } from './building/Placement.js';
import { updateSupport } from './building/StructureGraph.js';
import { resolveBuildTarget, resolveEditTarget } from './building/BuildTargeting.js';
import { cellCentre } from './building/BuildGrid.js';
import { EditController } from './editing/EditController.js';
import { PlayerController } from './player/PlayerController.js';
import { PlayerCamera } from './player/PlayerCamera.js';
import { Health } from './combat/Health.js';
import { Inventory, Weapon } from './combat/Weapon.js';
import { TerrainGenerator } from './world/TerrainGenerator.js';
import { Storm } from './world/Storm.js';

export class Game {
  constructor({ seed = 1337, input = null } = {}) {
    this.bus = new EventBus();
    this.rng = new MatchRandom(seed);
    this.input = input;
    this.time = 0;

    this.terrain = new TerrainGenerator(seed);
    this.grid = new BuildGrid();
    this.storm = new Storm(this.rng.storm, this.bus);

    this.player = new PlayerController({
      terrainHeightAt: (x, z) => this.terrain.heightAt(x, z),
      waterDepthAt: (x, z) => this.terrain.waterDepth(x, z),
      bus: this.bus,
      id: 1
    });
    this.health = new Health(this.bus, 1);
    this.inventory = new Inventory();
    this.camera = new PlayerCamera();
    this.editor = new EditController(this.grid, this.bus);

    // Build-mode state (§6.6).
    this.buildMode = false;
    this.selectedPiece = PIECE_TYPES[0];
    this.selectedMaterial = MATERIAL_ORDER[0];
    this.rotation = DIRECTIONS[0];
    this.buildTarget = null;
    this.gridDirty = true;

    this._startPlayer();
    this._wireEvents();
  }

  _startPlayer() {
    // Drop the player onto Ember Peak's approach so there is terrain to stand on.
    const x = 0, z = 220;
    this.player.teleport(x, this.terrain.heightAt(x, z) + 1, z);
    // Starting kit so the game is playable before loot exists in the world.
    this.player.materials = { wood: 300, stone: 300, metal: 300 };
    this.inventory.slots[1] = { kind: 'weapon', rarity: 'rare', weapon: new Weapon('assaultRifle', 'rare') };
    this.inventory.slots[2] = { kind: 'weapon', rarity: 'uncommon', weapon: new Weapon('pumpShotgun', 'uncommon') };
    this.inventory.addAmmo('medium', 180);
    this.inventory.addAmmo('shells', 40);
  }

  _wireEvents() {
    this.bus.on(Events.PIECE_PLACED, () => { this.gridDirty = true; });
    this.bus.on(Events.PIECE_DESTROYED, () => { this.gridDirty = true; });
    this.bus.on(Events.PIECE_EDITED, () => { this.gridDirty = true; });
  }

  /** One simulation tick. Always called with SIM.fixedDt. */
  update(dt = SIM.fixedDt) {
    this.time += dt;

    this._handleInput(dt);

    this.player.update(dt, this._moveAxis, {
      sprintHeld: this._sprintHeld,
      canSprint: !this._firing && !this._ads,
      health: this.health
    });

    this.grid.update(dt);
    const destroyed = updateSupport(this.grid, dt, (cx, cz) => {
      const c = cellCentre(cx, 0, cz);
      return this.terrain.heightAt(c.x, c.z);
    }, (piece) => this.bus.emit(Events.PIECE_DESTROYED, { piece, cause: 'unsupported' }));
    if (destroyed.length > 0) this.gridDirty = true;

    this.editor.update(dt, { distanceToTarget: this._editDistance ?? 0 });
    this.inventory.update(dt);
    this.health.update(dt);
    this.storm.update(dt);

    const stormDamage = this.storm.damageFor(
      this.player.id, this.player.position.x, this.player.position.z, dt
    );
    if (stormDamage > 0) this.health.takeStormDamage(stormDamage);

    // MAP_SPEC §3.1 — out of bounds takes damage and pushes back toward shore.
    if (this.terrain.isOutOfBounds(this.player.position.x, this.player.position.z)) {
      this.health.takeStormDamage(WORLD.oceanDps * dt);
    }

    this._updateBuildTarget();
    this.input?.endTick();
  }

  _handleInput(dt) {
    const input = this.input;
    if (!input) {
      this._moveAxis = { x: 0, z: 0 };
      return;
    }

    // Look — drain the accumulated raw delta once per tick (§3.3, §11.3).
    const look = input.consumeLook();
    const sensitivity = PlayerCamera.sensitivityFor(this.inventory.activeWeapon?.adsProgress ?? 0);
    this.player.look(look.x, look.y, sensitivity);

    this._moveAxis = input.moveAxis();
    this._sprintHeld = input.isDown('sprint');
    this._firing = input.isDown('fire');
    this._ads = input.isDown('ads');
    this.player.setCrouched(input.isDown('crouch'));

    if (input.wasPressed('jump')) this.player.requestJump();

    // Build mode selection (§6.6) — instant, no animation lock.
    const pieceKeys = ['buildWall', 'buildFloor', 'buildRamp', 'buildCone'];
    pieceKeys.forEach((action, i) => {
      if (input.wasPressed(action)) {
        this.selectedPiece = PIECE_TYPES[i];
        this._setBuildMode(true);
      }
    });
    if (input.wasPressed('toggleBuild')) this._setBuildMode(!this.buildMode);

    // Material cycling (§6.6).
    const wheel = input.consumeWheel();
    if (input.wasPressed('cycleMaterial') || (this.buildMode && wheel !== 0)) {
      const i = MATERIAL_ORDER.indexOf(this.selectedMaterial);
      const step = wheel !== 0 ? wheel : 1;
      this.selectedMaterial = MATERIAL_ORDER[
        (i + step + MATERIAL_ORDER.length * 2) % MATERIAL_ORDER.length
      ];
    }

    // Rotation, only meaningful in build mode (§6.6).
    if (this.buildMode && input.wasPressed('rotate')) {
      this.rotation = DIRECTIONS[(DIRECTIONS.indexOf(this.rotation) + 1) % DIRECTIONS.length];
    }

    // Weapon slots exit build mode (§6.6).
    for (let i = 0; i < 6; i++) {
      if (input.wasPressed(`slot${i}`)) {
        this.inventory.select(i);
        this._setBuildMode(false);
      }
    }

    this._handleEditInput(input);
    this._handleBuildInput(input);
    this._handleFireInput(input, dt);
  }

  _setBuildMode(on) {
    if (this.buildMode === on) return;
    this.buildMode = on;
    if (on) this.editor.cancel(); // §3.4 — build and edit are mutually exclusive
    this.bus.emit(Events.BUILD_MODE_CHANGED, { buildMode: on, piece: this.selectedPiece });
  }

  _handleEditInput(input) {
    const eye = this.player.eyePosition;
    const dir = this._lookVector();

    if (input.wasPressed('edit')) {
      if (this.editor.isEditing) {
        this.editor.confirm();
      } else {
        const hit = resolveEditTarget({ origin: eye, direction: dir, grid: this.grid, maxDistance: EDIT.range });
        if (hit) {
          this._setBuildMode(false);
          this.editor.begin(hit.piece, this.player.id, hit.distance);
          this._editDistance = hit.distance;
        }
      }
    }

    if (this.editor.isEditing) {
      if (input.wasPressed('rotate')) this.editor.reset();
      // Keep the range check fed so walking away cancels the edit (§7.2).
      const piece = this.editor.target;
      if (piece) {
        const c = piece.worldCentre;
        this._editDistance = Math.hypot(c.x - eye.x, c.y - eye.y, c.z - eye.z);
      }
      if (input.wasReleased('fire')) this.editor.confirm();
    }
  }

  _handleBuildInput(input) {
    if (!this.buildMode || !this.buildTarget) return;

    // Turbo build: holding fire places into every valid slot crossed (§6.3 rule 7).
    const wantsPlace = input.wasPressed('fire') || input.isDown('fire');
    if (!wantsPlace) return;

    const interval = input.isDown('fire') && !input.wasPressed('fire')
      ? BUILD.turboPlacementInterval
      : BUILD.minPlacementInterval;

    if (this.player.lastPlacementTime != null &&
        this.time - this.player.lastPlacementTime < interval) {
      return;
    }

    const result = placePiece({
      grid: this.grid,
      type: this.selectedPiece,
      material: this.selectedMaterial,
      cell: this.buildTarget.cell,
      direction: this.buildTarget.direction,
      builder: this.player,
      players: [this.player],
      now: this.time,
      playableExtent: WORLD.playableExtent
    });

    if (result.ok) {
      this.bus.emit(Events.PIECE_PLACED, { piece: result.piece });
    } else if (result.reason !== PlacementResult.RATE_LIMITED) {
      this._lastPlacementReject = result.reason;
    }
  }

  _handleFireInput(input, dt) {
    if (this.buildMode || this.editor.isEditing) return;
    const weapon = this.inventory.activeWeapon;
    if (!weapon) return;

    if (input.wasPressed('reload')) {
      weapon.beginReload(this.inventory.ammo[weapon.ammoType] ?? 0);
    }
    if (input.isDown('fire') && weapon.canFire) {
      weapon.fire(this.bus);
      this._resolveShot(weapon);
    }
    void dt;
  }

  /** Trace a shot against structures. Player hits arrive with networking (§12). */
  _resolveShot(weapon) {
    const eye = this.player.eyePosition;
    const dir = this._lookVector();
    const hit = resolveEditTarget({ origin: eye, direction: dir, grid: this.grid, maxDistance: 200, step: 0.4 });
    if (!hit) return;

    const destroyed = hit.piece.applyDamage(weapon.structureDamage);
    this.bus.emit(Events.PIECE_DAMAGED, { piece: hit.piece, amount: weapon.structureDamage });
    if (destroyed) {
      this.grid.remove(hit.piece);
      this.bus.emit(Events.PIECE_DESTROYED, { piece: hit.piece, cause: 'weapon' });
    }
  }

  _lookVector() {
    const cp = Math.cos(this.player.pitch);
    return {
      x: -Math.sin(this.player.yaw) * cp,
      y: Math.sin(this.player.pitch),
      z: -Math.cos(this.player.yaw) * cp
    };
  }

  _updateBuildTarget() {
    if (!this.buildMode) {
      this.buildTarget = null;
      return;
    }
    this.buildTarget = resolveBuildTarget({
      origin: this.player.eyePosition,
      direction: this._lookVector(),
      pieceType: this.selectedPiece,
      rotation: this.rotation,
      grid: this.grid
    });
  }

  /** State snapshot for the HUD. Read-only. */
  hudState(stats) {
    const weapon = this.inventory.activeWeapon;
    return {
      health: this.health.health,
      shield: this.health.shield,
      materials: this.player.materials,
      buildMode: this.buildMode,
      selectedPiece: this.selectedPiece,
      selectedMaterial: this.selectedMaterial,
      selectedSlot: this.inventory.selected,
      inventory: this.inventory,
      pieceCount: this.grid.pieceCount,
      spreadDegrees: weapon
        ? weapon.spread({
            horizontalSpeed: this.player.horizontalSpeed,
            airborne: !this.player.grounded,
            crouched: this.player.crouched
          })
        : 0,
      storm: {
        phase: this.storm.currentPhase?.phase ?? 0,
        timer: this.storm.timer,
        radius: this.storm.radius
      },
      stats
    };
  }
}
