/**
 * The seven acceptance gates from MASTER_SPEC §28.
 *
 * "If any of these fail: the core gameplay is not finished."
 *
 * These are deliberately in their own file and named after the gates so a failure names
 * the requirement it breaks.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { BuildGrid } from '../src/building/BuildGrid.js';
import { BuildPiece, resetPieceIds } from '../src/building/BuildPiece.js';
import { CollisionWorld } from '../src/building/CollisionWorld.js';
import { PlacementQueue } from '../src/building/PlacementQueue.js';
import * as Geo from '../src/building/PieceGeometry.js';
import { EditController } from '../src/editing/EditController.js';
import { resolvePattern } from '../src/editing/EditPatterns.js';
import { PlayerCamera } from '../src/player/PlayerCamera.js';
import { PlayerController } from '../src/player/PlayerController.js';
import { aimRayFrom } from '../src/player/AimRay.js';
import { Input } from '../src/core/Input.js';
import { EventBus } from '../src/core/EventBus.js';
import { TILE, WALL_H, MOVEMENT, SIM, BUILD } from '../src/core/Config.js';

const dt = SIM.fixedDt;
beforeEach(() => resetPieceIds());

const wallAt = (grid, cx, cy, cz, direction = 'north', ownerId = 1) =>
  grid.add(new BuildPiece({ type: 'wall', material: 'brick', cell: { cx, cy, cz }, direction, ownerId }));

/* ═══ GATE 4 — a three-tile wall opening lets the player through ═══════════ */

describe('GATE 4: a three-tile wall opening lets the player through', () => {
  let grid, collision, wall;

  beforeEach(() => {
    grid = new BuildGrid();
    collision = new CollisionWorld(grid);
    wall = wallAt(grid, 0, 0, 0, 'north');
  });

  it('blocks the player through a FULL wall', () => {
    // Stand just south of the wall and try to walk north through it.
    const from = { x: TILE / 2, y: 0, z: 1.0 };
    const to = { x: TILE / 2, y: 0, z: -0.5 };
    const r = collision.resolveCapsule({
      from, to, radius: MOVEMENT.capsuleRadius, height: MOVEMENT.standHeight
    });
    expect(r.blockedZ).toBe(true);
    // The player advances until the capsule meets the wall, then stops — they do not
    // freeze on the spot, and they never reach the far side.
    const wallFaceZ = BUILD.thickness;
    expect(r.position.z).toBeGreaterThanOrEqual(wallFaceZ + MOVEMENT.capsuleRadius - 1e-6);
    expect(r.position.z).toBeLessThanOrEqual(from.z + 1e-6);
  });

  it('lets a STANDING player through the three-tile opening', () => {
    wall.editPattern = resolvePattern('wall', [1, 4, 7]);
    grid.touch();

    // The opening is the middle column: centre of the tile in X.
    const from = { x: TILE / 2, y: 0, z: 1.0 };
    const to = { x: TILE / 2, y: 0, z: -0.5 };
    const r = collision.resolveCapsule({
      from, to, radius: MOVEMENT.capsuleRadius, height: MOVEMENT.standHeight
    });
    expect(r.blockedZ).toBe(false);
    expect(r.position.z).toBeCloseTo(to.z, 5);
  });

  it('gives the opening real clearance around the capsule', () => {
    const tileW = TILE / 3;
    const diameter = MOVEMENT.capsuleRadius * 2;
    expect(tileW).toBeGreaterThan(diameter);
    // Comfortably, not marginally: at least half a capsule of slack on each side.
    expect((tileW - diameter) / 2).toBeGreaterThan(MOVEMENT.capsuleRadius * 0.5);
    // And full wall height clears a standing player with room to spare.
    expect(WALL_H).toBeGreaterThan(MOVEMENT.standHeight * 1.5);
  });

  it('still blocks where the wall was NOT opened', () => {
    wall.editPattern = resolvePattern('wall', [1, 4, 7]);
    grid.touch();
    // Left column is untouched, so walking through it must fail.
    const from = { x: TILE / 6, y: 0, z: 1.0 };
    const to = { x: TILE / 6, y: 0, z: -0.5 };
    const r = collision.resolveCapsule({
      from, to, radius: MOVEMENT.capsuleRadius, height: MOVEMENT.standHeight
    });
    expect(r.blockedZ).toBe(true);
  });
});

describe('GATE 4b: an edited door fits a standing player', () => {
  it('passes a standing player through a door', () => {
    const grid = new BuildGrid();
    const collision = new CollisionWorld(grid);
    const wall = wallAt(grid, 0, 0, 0, 'north');
    wall.editPattern = resolvePattern('wall', [4, 7]);
    grid.touch();

    const r = collision.resolveCapsule({
      from: { x: TILE / 2, y: 0, z: 1.0 },
      to: { x: TILE / 2, y: 0, z: -0.5 },
      radius: MOVEMENT.capsuleRadius,
      height: MOVEMENT.standHeight
    });
    expect(r.blockedZ).toBe(false);
  });

  it('gives the door more height than a standing player', () => {
    const doorHeight = 2 * (WALL_H / 3);
    expect(doorHeight).toBeGreaterThan(MOVEMENT.standHeight);
    expect(doorHeight - MOVEMENT.standHeight).toBeGreaterThan(0.5); // comfortable
  });

  it('does NOT pass a standing player through a bottom-row (crouch) opening', () => {
    const grid = new BuildGrid();
    const collision = new CollisionWorld(grid);
    const wall = wallAt(grid, 0, 0, 0, 'north');
    wall.editPattern = resolvePattern('wall', [6, 7, 8]);
    grid.touch();

    const r = collision.resolveCapsule({
      from: { x: TILE / 2, y: 0, z: 1.0 },
      to: { x: TILE / 2, y: 0, z: -0.5 },
      radius: MOVEMENT.capsuleRadius,
      height: MOVEMENT.standHeight
    });
    expect(r.blockedZ).toBe(true);
  });

  it('DOES pass a crouched player through the same bottom-row opening', () => {
    const grid = new BuildGrid();
    const collision = new CollisionWorld(grid);
    const wall = wallAt(grid, 0, 0, 0, 'north');
    wall.editPattern = resolvePattern('wall', [6, 7, 8]);
    grid.touch();

    const r = collision.resolveCapsule({
      from: { x: TILE / 2, y: 0, z: 1.0 },
      to: { x: TILE / 2, y: 0, z: -0.5 },
      radius: MOVEMENT.capsuleRadius,
      height: MOVEMENT.crouchHeight
    });
    expect(r.blockedZ).toBe(false);
  });
});

/* ═══ GATE 5 — a flipped stair does not retain its old collision ═══════════ */

describe('GATE 5: a flipped stair does not retain old collision', () => {
  let grid, ramp;

  beforeEach(() => {
    grid = new BuildGrid();
    ramp = grid.add(new BuildPiece({
      type: 'ramp', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north', ownerId: 1
    }));
  });

  it('has a surface at the top row before the edit', () => {
    // Top row of a north ramp is at the -Z edge, high end.
    const h = Geo.rampHeightAt(ramp, TILE / 2, TILE * 0.1);
    expect(h).not.toBeNull();
    expect(h).toBeGreaterThan(WALL_H * 0.8);
  });

  it('has NO surface at the top row after the top row is edited away', () => {
    ramp.editPattern = resolvePattern('ramp', [0, 1]);
    grid.touch();
    const h = Geo.rampHeightAt(ramp, TILE / 2, TILE * 0.1);
    expect(h).toBeNull();     // the old high surface is gone, not merely hidden
  });

  it('keeps the surface where sections remain', () => {
    ramp.editPattern = resolvePattern('ramp', [0, 1]);
    grid.touch();
    const h = Geo.rampHeightAt(ramp, TILE / 2, TILE * 0.9);
    expect(h).not.toBeNull();
    expect(h).toBeLessThan(WALL_H / 3);
  });

  it('swaps collision when the ramp is rotated, leaving nothing from the old direction', () => {
    const before = Geo.rampHeightAt(ramp, TILE / 2, TILE * 0.1);   // high end at -Z
    ramp.direction = 'south';                                       // flip it
    grid.touch();
    const after = Geo.rampHeightAt(ramp, TILE / 2, TILE * 0.1);     // same point
    expect(before).toBeGreaterThan(WALL_H * 0.8);
    expect(after).toBeLessThan(WALL_H * 0.2);   // now the LOW end — old shape is gone
  });

  it('removes collision entirely when every section is edited away', () => {
    const pattern = resolvePattern('ramp', [0, 1, 2, 3, 4, 5]);
    expect(pattern.deletesPiece).toBe(true);
  });

  it('derives collision from the live pattern, so no stale collider can exist', () => {
    // Editing then re-editing must never leave the first shape behind.
    ramp.editPattern = resolvePattern('ramp', [0, 1]);
    grid.touch();
    expect(Geo.rampHeightAt(ramp, TILE / 2, TILE * 0.1)).toBeNull();

    ramp.editPattern = null;                    // reset
    grid.touch();
    expect(Geo.rampHeightAt(ramp, TILE / 2, TILE * 0.1)).not.toBeNull();
  });

  it('keeps the ramp walkable — slope under the walkable limit', () => {
    const slopeDeg = Math.atan2(WALL_H, TILE) * 180 / Math.PI;
    expect(slopeDeg).toBeLessThan(MOVEMENT.maxWalkableSlopeDeg);
  });

  it('rises less than the step height across one capsule stride', () => {
    // A player walking up must never face a lip taller than they can step.
    const stride = MOVEMENT.capsuleRadius;
    const h1 = Geo.rampHeightAt(ramp, TILE / 2, TILE * 0.5);
    const h2 = Geo.rampHeightAt(ramp, TILE / 2, TILE * 0.5 - stride);
    expect(Math.abs(h2 - h1)).toBeLessThan(MOVEMENT.stepHeight);
  });
});

/* ═══ GATE 6 — rapid building does not drop inputs ════════════════════════ */

describe('GATE 6: rapid building does not drop inputs', () => {
  it('executes every queued intent rather than discarding it', () => {
    const q = new PlacementQueue();
    const placed = [];
    // Three intents in the same tick — the baseline would have dropped two.
    q.enqueue({ type: 'wall' });
    q.enqueue({ type: 'floor' });
    q.enqueue({ type: 'ramp' });

    for (let i = 0; i < 60; i++) {
      q.update(dt, (intent) => { placed.push(intent.type); return true; });
    }
    expect(placed).toEqual(['wall', 'floor', 'ramp']);
    expect(q.stats.executed).toBe(3);
    expect(q.stats.expired).toBe(0);
  });

  it('buffers an intent that arrives inside the cooldown instead of dropping it', () => {
    const q = new PlacementQueue();
    const placed = [];
    const exec = (i) => { placed.push(i.type); return true; };

    q.enqueue({ type: 'wall' });
    q.update(dt, exec);
    expect(placed).toEqual(['wall']);
    expect(q.cooldown).toBeGreaterThan(0);

    // Arrives while still cooling down — must survive.
    q.enqueue({ type: 'ramp' });
    expect(q.length).toBe(1);
    expect(q.stats.enqueued).toBe(2);

    for (let i = 0; i < 10; i++) q.update(dt, exec);
    expect(placed).toEqual(['wall', 'ramp']);
  });

  it('places a 90 (wall, ramp, turn, wall, ramp) with nothing lost', () => {
    const q = new PlacementQueue({ depth: 8 });
    const placed = [];
    const sequence = ['wall', 'ramp', 'wall', 'ramp'];
    for (const type of sequence) q.enqueue({ type });

    for (let i = 0; i < 60; i++) q.update(dt, (i2) => { placed.push(i2.type); return true; });
    expect(placed).toEqual(sequence);
  });

  it('counts every press when several land inside one tick', () => {
    const input = new Input();
    input.simulatePress('KeyQ');
    input.simulatePress('KeyQ');
    input.simulatePress('KeyQ');
    // A boolean flag would collapse these to one; the counter must not.
    expect(input.pressCount('wall')).toBe(3);
    expect(input.wasPressed('wall')).toBe(true);
    input.endTick();
    expect(input.pressCount('wall')).toBe(0);
  });

  it('never reports a placement as silently dropped', () => {
    const q = new PlacementQueue({ depth: 3 });
    for (let i = 0; i < 3; i++) q.enqueue({ type: 'wall' });
    // A 4th beyond depth is REPORTED as rejected, not silently discarded.
    const accepted = q.enqueue({ type: 'wall' });
    expect(accepted).toBe(false);
    expect(q.stats.rejectedFull).toBe(1);
  });
});

/* ═══ GATE 7 — crosshair and shot direction agree ═════════════════════════ */

describe('GATE 7: crosshair and shot direction agree', () => {
  const makePlayer = () => new PlayerController({ terrainHeightAt: () => 0 });

  it('takes the aim ray from the camera, not the player eye', () => {
    const player = makePlayer();
    player.yaw = 0.9;
    player.pitch = -0.3;
    const cam = new PlayerCamera();
    cam.update(dt, player, {});

    const ray = aimRayFrom(cam);
    expect(ray.origin).toEqual(cam.position);
    expect(ray.direction).toEqual(cam.lookDirection);
    // The eye is offset from the camera, so this is a real distinction.
    expect(ray.origin.x).not.toBeCloseTo(player.eyePosition.x, 3);
  });

  it('points the ray exactly where the camera looks, at every angle', () => {
    const player = makePlayer();
    const cam = new PlayerCamera();
    for (const yaw of [-2.5, -1, 0, 0.7, 2.0, 3.1]) {
      for (const pitch of [-1.2, -0.4, 0, 0.5, 1.2]) {
        player.yaw = yaw;
        player.pitch = pitch;
        cam.update(dt, player, {});
        const ray = aimRayFrom(cam);
        const len = Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z);
        expect(len).toBeCloseTo(1, 6);
        // Direction must match the camera's own forward exactly.
        expect(ray.direction.x).toBeCloseTo(cam.lookDirection.x, 12);
        expect(ray.direction.y).toBeCloseTo(cam.lookDirection.y, 12);
        expect(ray.direction.z).toBeCloseTo(cam.lookDirection.z, 12);
      }
    }
  });

  it('hits the piece the camera is pointed at', () => {
    const grid = new BuildGrid();
    const collision = new CollisionWorld(grid);
    const player = makePlayer();
    const cam = new PlayerCamera();

    // Put the player south of a wall, looking north at it.
    player.teleport(TILE / 2, 0, TILE * 1.5);
    player.yaw = 0;           // faces -Z
    player.pitch = 0;
    cam.update(dt, player, {});

    const target = wallAt(grid, 0, 0, 0, 'north');
    const hit = collision.raycastPieces(aimRayFrom(cam), 50);
    expect(hit).not.toBeNull();
    expect(hit.piece.id).toBe(target.id);
  });

  it('agrees between weapon tracing and edit targeting, because both use one ray', () => {
    const grid = new BuildGrid();
    const collision = new CollisionWorld(grid);
    const player = makePlayer();
    const cam = new PlayerCamera();
    player.teleport(TILE / 2, 0, TILE * 1.5);
    player.yaw = 0.05;
    cam.update(dt, player, {});
    wallAt(grid, 0, 0, 0, 'north');

    const ray = aimRayFrom(cam);
    const shotHit = collision.raycastPieces(ray, 50);
    const editHit = collision.raycastPieces(ray, BUILD.editRange);
    if (shotHit && editHit) expect(shotHit.piece.id).toBe(editHit.piece.id);
    expect(shotHit).not.toBeNull();
  });
});

/* ═══ GATES 2 & 3 — double and triple edits ═══════════════════════════════ */

describe('GATES 2 & 3: double and triple edits work repeatedly', () => {
  let grid, bus, editor;

  beforeEach(() => {
    grid = new BuildGrid();
    bus = new EventBus();
    editor = new EditController(grid, bus);
  });

  const editPiece = (piece, tiles) => {
    editor.begin(piece, 1, 2);
    editor.update(0.05, { distanceToTarget: 2 });
    for (const t of tiles) editor.dragTile(t);
    return editor.confirm();
  };

  it('performs a double edit on two pieces in sequence', () => {
    const a = wallAt(grid, 0, 0, 0, 'north');
    const b = wallAt(grid, 1, 0, 0, 'north');
    expect(editPiece(a, [4, 7]).ok).toBe(true);
    expect(editPiece(b, [4, 7]).ok).toBe(true);
    expect(a.editPattern.name).toBe('Door');
    expect(b.editPattern.name).toBe('Door');
  });

  it('performs a triple edit on three pieces in sequence', () => {
    const pieces = [0, 1, 2].map((cx) => wallAt(grid, cx, 0, 0, 'north'));
    for (const p of pieces) expect(editPiece(p, [4, 7]).ok).toBe(true);
    for (const p of pieces) expect(p.editPattern.name).toBe('Door');
  });

  it('survives repeated edit-reset-edit loops without sticking', () => {
    const wall = wallAt(grid, 0, 0, 0, 'north');
    for (let i = 0; i < 25; i++) {
      expect(editPiece(wall, [4, 7]).ok).toBe(true);
      expect(wall.editPattern.name).toBe('Door');
      expect(editor.isEditing).toBe(false);       // never stuck

      editor.resetPiece(wall, 1, 2);
      expect(wall.editPattern).toBeNull();
    }
  });

  it('bumps the grid revision on every edit so collision never goes stale', () => {
    const wall = wallAt(grid, 0, 0, 0, 'north');
    const r0 = grid.revision;
    editPiece(wall, [4, 7]);
    expect(grid.revision).toBeGreaterThan(r0);
    const r1 = grid.revision;
    editor.resetPiece(wall, 1, 2);
    expect(grid.revision).toBeGreaterThan(r1);
  });
});

/* ═══ GATE 1 — a fast 90 works repeatedly ═════════════════════════════════ */

describe('GATE 1: a fast 90 works repeatedly', () => {
  it('places wall+ramp pairs through four quarter turns with nothing dropped', () => {
    const grid = new BuildGrid();
    const player = new PlayerController({ terrainHeightAt: () => 0 });
    player.teleport(TILE / 2, 0, TILE / 2);
    player.materials = { wood: 500, brick: 500, metal: 500 };

    const q = new PlacementQueue({ depth: 8 });
    const placed = [];
    let cy = 0;

    for (let turn = 0; turn < 4; turn++) {
      player.yaw = turn * Math.PI / 2;      // the 90 itself
      q.enqueue({ type: 'wall', turn });
      q.enqueue({ type: 'ramp', turn });

      for (let i = 0; i < 20; i++) {
        q.update(dt, (intent) => {
          const dir = ['north', 'east', 'south', 'west'][intent.turn];
          const cell = { cx: intent.turn, cy, cz: 0 };
          const piece = new BuildPiece({
            type: intent.type, material: 'wood', cell,
            direction: dir, ownerId: 1
          });
          grid.add(piece);
          placed.push(intent.type);
          if (intent.type === 'ramp') cy++;
          return true;
        });
      }
    }

    expect(placed).toHaveLength(8);
    expect(placed.filter((p) => p === 'wall')).toHaveLength(4);
    expect(placed.filter((p) => p === 'ramp')).toHaveLength(4);
    expect(q.stats.expired).toBe(0);
  });

  it('sprinting is allowed while building (§5.1)', () => {
    const player = new PlayerController({ terrainHeightAt: () => 0 });
    for (let i = 0; i < 90; i++) {
      player.update(dt, { x: 0, z: 1 }, { sprintHeld: true, buildMode: true });
    }
    expect(player.sprinting).toBe(true);
    expect(player.horizontalSpeed).toBeGreaterThan(MOVEMENT.walkSpeed + 0.5);
  });

  it('jumping is allowed while building (§5.1)', () => {
    const player = new PlayerController({ terrainHeightAt: () => 0 });
    player.requestJump();
    player.update(dt, { x: 0, z: 0 }, { buildMode: true });
    expect(player.grounded).toBe(false);
    expect(player.velocity.y).toBeGreaterThan(0);
  });

  it('never mantles accidentally while building (§5.5)', () => {
    // A ledge right in front of the player that WOULD normally mantle.
    const player = new PlayerController({
      terrainHeightAt: (x) => (x > 0.5 ? 1.0 : 0)
    });
    player.yaw = -Math.PI / 2;          // face +X, toward the ledge
    player.notifyBuildPlaced();         // just placed a build

    for (let i = 0; i < 5; i++) {
      player.update(dt, { x: 0, z: 1 }, { buildMode: true });
      expect(player.state).not.toBe('mantling');
    }
  });
});
