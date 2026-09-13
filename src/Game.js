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
import { aimRayFrom } from './player/AimRay.js';
import { Health } from './combat/Health.js';
import { Inventory, Weapon } from './combat/Weapon.js';
import { TestEnvironment } from './world/TestEnvironment.js';

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

    this.inventory.update(dt, { ads: intent.ads });
    this.health.update(dt);

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
        this._setBuildMode(true);
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
