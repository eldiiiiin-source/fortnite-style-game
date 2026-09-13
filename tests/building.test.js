/** Build grid, placement, geometry and collision. MASTER_SPEC §9, §11. */
import { describe, it, expect, beforeEach } from 'vitest';
import { BuildGrid, worldToCell, cellToWorld, cellCentre, neighbourCell } from '../src/building/BuildGrid.js';
import { BuildPiece, resetPieceIds } from '../src/building/BuildPiece.js';
import { validatePlacement, placePiece, PlacementResult } from '../src/building/Placement.js';
import { PlacementQueue } from '../src/building/PlacementQueue.js';
import { CollisionWorld } from '../src/building/CollisionWorld.js';
import * as Geo from '../src/building/PieceGeometry.js';
import { computeSupported, updateSupport } from '../src/building/StructureGraph.js';
import { resolvePattern } from '../src/editing/EditPatterns.js';
import { TILE, WALL_H, BUILD, MATERIALS, MOVEMENT, SIM, EDIT_GRIDS } from '../src/core/Config.js';

const dt = SIM.fixedDt;
beforeEach(() => resetPieceIds());

const builder = (o = {}) => ({
  id: 1,
  position: { x: 0, y: 0, z: 0 },
  materials: { wood: 500, brick: 500, metal: 500 },
  ...o
});

describe('§9.1 grid addressing has no drift', () => {
  it('round-trips world to cell to world', () => {
    const cell = worldToCell(7.5, 4.0, -3.2);
    expect(cell).toEqual({ cx: 1, cy: 1, cz: -1 });
    const w = cellToWorld(cell.cx, cell.cy, cell.cz);
    expect(w.x).toBeCloseTo(TILE, 12);
    expect(w.y).toBeCloseTo(WALL_H, 12);
  });

  it('computes positions from indices, so chaining never accumulates error', () => {
    // 500 pieces in a line: the last one must land exactly on its index.
    const n = 500;
    const c = cellCentre(n, 0, 0);
    expect(c.x).toBeCloseTo((n + 0.5) * TILE, 9);
    // Compare against a naive accumulated sum, which WOULD drift.
    let accumulated = 0.5 * TILE;
    for (let i = 0; i < n; i++) accumulated += TILE;
    expect(Math.abs(c.x - accumulated)).toBeLessThan(1e-9);
  });

  it('walks to the right neighbour', () => {
    const cell = { cx: 0, cy: 0, cz: 0 };
    expect(neighbourCell(cell, 'north').cz).toBe(-1);
    expect(neighbourCell(cell, 'east').cx).toBe(1);
  });

  it('bumps the revision on every structural change', () => {
    const grid = new BuildGrid();
    const r0 = grid.revision;
    const p = grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 } }));
    expect(grid.revision).toBeGreaterThan(r0);
    const r1 = grid.revision;
    grid.remove(p);
    expect(grid.revision).toBeGreaterThan(r1);
  });
});

describe('§9.1 slots', () => {
  it('allows four walls, a floor, a ramp and a cone per cell', () => {
    const grid = new BuildGrid();
    const cell = { cx: 0, cy: 0, cz: 0 };
    for (const d of ['north', 'east', 'south', 'west']) {
      grid.add(new BuildPiece({ type: 'wall', material: 'wood', cell, direction: d }));
    }
    grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell }));
    grid.add(new BuildPiece({ type: 'ramp', material: 'wood', cell }));
    grid.add(new BuildPiece({ type: 'cone', material: 'wood', cell }));
    expect(grid.pieceCount).toBe(7);
  });

  it('refuses two pieces in one slot', () => {
    const grid = new BuildGrid();
    const cell = { cx: 0, cy: 0, cz: 0 };
    grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell }));
    expect(() => grid.add(new BuildPiece({ type: 'floor', material: 'brick', cell })))
      .toThrow(/already occupied/);
  });
});

describe('§9.3 placement never silently drops input', () => {
  it('has no rate-limit rejection at all', () => {
    expect(PlacementResult.RATE_LIMITED).toBeUndefined();
  });

  it('places back-to-back with no cooldown rejection', () => {
    const grid = new BuildGrid();
    const b = builder();
    const cell = { cx: 0, cy: 0, cz: 0 };
    // Five placements into distinct slots of one in-range cell, with no delay between.
    const requests = [
      { type: 'wall', direction: 'north' },
      { type: 'wall', direction: 'east' },
      { type: 'floor' },
      { type: 'ramp' },
      { type: 'cone' }
    ];
    for (const req of requests) {
      const r = placePiece({ grid, material: 'wood', cell, builder: b, ...req });
      expect(r.ok, `${req.type} ${req.direction ?? ''}`).toBe(true);
    }
    expect(grid.pieceCount).toBe(5);
  });

  it('deducts exactly the piece cost', () => {
    const grid = new BuildGrid();
    const b = builder();
    placePiece({ grid, type: 'floor', material: 'brick', cell: { cx: 0, cy: 0, cz: 0 }, builder: b });
    expect(b.materials.brick).toBe(500 - BUILD.cost);
  });

  it('rejects an occupied slot, out of range, and insufficient material', () => {
    const grid = new BuildGrid();
    const cell = { cx: 0, cy: 0, cz: 0 };
    grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell }));
    expect(validatePlacement({ grid, type: 'floor', material: 'wood', cell, builder: builder() }).reason)
      .toBe(PlacementResult.SLOT_OCCUPIED);
    expect(validatePlacement({ grid, type: 'floor', material: 'wood', cell: { cx: 4, cy: 0, cz: 0 }, builder: builder() }).reason)
      .toBe(PlacementResult.OUT_OF_RANGE);
    expect(validatePlacement({
      grid, type: 'floor', material: 'wood', cell: { cx: 0, cy: 1, cz: 0 },
      builder: builder({ materials: { wood: 5, brick: 0, metal: 0 } })
    }).reason).toBe(PlacementResult.INSUFFICIENT_MATERIAL);
  });

  it('never blocks on terrain — there is no terrain input at all', () => {
    const grid = new BuildGrid();
    expect(validatePlacement({
      grid, type: 'floor', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, builder: builder()
    }).ok).toBe(true);
  });
});

describe('§9.3 placement queue', () => {
  it('buffers rather than discards, and reports every outcome', () => {
    const q = new PlacementQueue();
    q.enqueue({ type: 'wall' });
    q.enqueue({ type: 'floor' });
    const placed = [];
    for (let i = 0; i < 60; i++) q.update(dt, (x) => { placed.push(x.type); return true; });
    expect(placed).toEqual(['wall', 'floor']);
    expect(q.stats.enqueued).toBe(q.stats.executed);
  });

  it('accounts for every intent — nothing disappears unexplained', () => {
    const q = new PlacementQueue({ depth: 8 });
    for (let i = 0; i < 6; i++) q.enqueue({ type: 'wall' });
    let calls = 0;
    for (let i = 0; i < 120; i++) {
      q.update(dt, () => { calls++; return calls % 2 === 0; });   // half succeed
    }
    expect(q.accounted).toBe(q.stats.enqueued);
    expect(q.stats.executed).toBeGreaterThan(0);
    expect(q.stats.discarded).toBeGreaterThan(0);
  });

  it('reports an unplaceable intent as discarded rather than silently dropping it', () => {
    const q = new PlacementQueue();
    q.enqueue({ type: 'wall' });
    q.update(dt, () => false);
    expect(q.length).toBe(0);
    expect(q.stats.discarded).toBe(1);
    expect(q.accounted).toBe(1);
  });
});

describe('§9.4 build health ramp', () => {
  it('starts at initial HP and ramps to full over the material build time', () => {
    const p = new BuildPiece({ type: 'wall', material: 'metal', cell: { cx: 0, cy: 0, cz: 0 } });
    expect(p.hp).toBe(MATERIALS.metal.initialHp);
    for (let t = 0; t < MATERIALS.metal.buildTime / dt; t++) p.update(dt);
    expect(p.isFullyBuilt).toBe(true);
    expect(p.hp).toBeCloseTo(MATERIALS.metal.fullHp, 0);
  });

  it('does not undo damage taken during the ramp', () => {
    const p = new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 } });
    p.applyDamage(50);
    expect(p.hp).toBe(MATERIALS.wood.initialHp - 50);
    p.update(0.5);
    expect(p.hp).toBeLessThan(MATERIALS.wood.fullHp);
  });

  it('destroys at zero HP', () => {
    const p = new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 } });
    expect(p.applyDamage(MATERIALS.wood.initialHp - 1)).toBe(false);
    expect(p.applyDamage(10)).toBe(true);
    expect(p.destroyed).toBe(true);
  });
});

describe('§9.2/§11 geometry is the single source for render and collision', () => {
  const wall = () => new BuildPiece({
    type: 'wall', material: 'brick', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north', ownerId: 1
  });

  it('gives a full wall one box per edit tile', () => {
    expect(Geo.wallBoxes(wall())).toHaveLength(EDIT_GRIDS.wall.tiles);
  });

  it('removes exactly the edited tiles from collision', () => {
    const w = wall();
    w.editPattern = resolvePattern('wall', [4, 7]);
    expect(Geo.wallBoxes(w)).toHaveLength(EDIT_GRIDS.wall.tiles - 2);
  });

  it('sizes wall boxes from the build module', () => {
    const [box] = Geo.wallBoxes(wall());
    expect(box.max[0] - box.min[0]).toBeCloseTo(TILE / 3, 9);
    expect(box.max[1] - box.min[1]).toBeCloseTo(WALL_H / 3, 9);
    expect(box.max[2] - box.min[2]).toBeCloseTo(BUILD.thickness, 9);
  });

  it('puts row 0 at the top', () => {
    const w = wall();
    w.editPattern = resolvePattern('wall', [0, 1, 2]);   // top row removed
    const maxY = Math.max(...Geo.wallBoxes(w).map((b) => b.max[1]));
    expect(maxY).toBeCloseTo(WALL_H * 2 / 3, 9);
  });

  it('gives a floor four quarters on its 2x2 grid', () => {
    const f = new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 } });
    expect(Geo.floorBoxes(f)).toHaveLength(EDIT_GRIDS.floor.tiles);
    f.editPattern = resolvePattern('floor', [0]);
    expect(Geo.floorBoxes(f)).toHaveLength(3);
  });

  it('interpolates ramp height smoothly across the tile', () => {
    const r = new BuildPiece({ type: 'ramp', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north' });
    const low = Geo.rampHeightAt(r, TILE / 2, TILE * 0.98);
    const high = Geo.rampHeightAt(r, TILE / 2, TILE * 0.02);
    expect(low).toBeLessThan(WALL_H * 0.1);
    expect(high).toBeGreaterThan(WALL_H * 0.9);
    expect(Geo.rampHeightAt(r, TILE / 2, TILE * 0.5)).toBeCloseTo(WALL_H / 2, 1);
  });

  it('returns null where a ramp section was edited away', () => {
    const r = new BuildPiece({ type: 'ramp', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north' });
    r.editPattern = resolvePattern('ramp', [0, 2, 4]);   // left half removed
    // Left column is col 0 for a north ramp.
    expect(Geo.rampHeightAt(r, TILE * 0.25, TILE * 0.5)).toBeNull();
    expect(Geo.rampHeightAt(r, TILE * 0.75, TILE * 0.5)).not.toBeNull();
  });

  it('gives a cone its apex at the cell centre', () => {
    const c = new BuildPiece({ type: 'cone', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 } });
    expect(Geo.coneHeightAt(c, TILE / 2, TILE / 2)).toBeCloseTo(WALL_H, 6);
    expect(Geo.coneHeightAt(c, 0.01, 0.01)).toBeLessThan(WALL_H * 0.1);
  });
});

describe('§11 collision derived from live patterns', () => {
  let grid, collision;
  beforeEach(() => {
    grid = new BuildGrid();
    collision = new CollisionWorld(grid);
  });

  it('supports a player standing on a floor', () => {
    grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 1, cz: 0 } }));
    expect(collision.supportHeightAt(TILE / 2, TILE / 2)).toBeCloseTo(WALL_H + BUILD.thickness, 6);
  });

  it('removes support where the floor was edited away', () => {
    const f = grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 1, cz: 0 } }));
    f.editPattern = resolvePattern('floor', [0]);
    grid.touch();
    expect(collision.supportHeightAt(TILE * 0.25, TILE * 0.25)).toBeNull();
    expect(collision.supportHeightAt(TILE * 0.75, TILE * 0.75)).not.toBeNull();
  });

  it('leaves no collision behind a destroyed piece', () => {
    const f = grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 1, cz: 0 } }));
    expect(collision.supportHeightAt(TILE / 2, TILE / 2)).not.toBeNull();
    grid.remove(f);
    expect(collision.supportHeightAt(TILE / 2, TILE / 2)).toBeNull();
  });

  it('walks a player up a ramp', () => {
    grid.add(new BuildPiece({
      type: 'ramp', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north'
    }));
    const r = collision.resolveCapsule({
      from: { x: TILE / 2, y: 0.2, z: TILE * 0.9 },
      to: { x: TILE / 2, y: 0.2, z: TILE * 0.6 },
      radius: MOVEMENT.capsuleRadius,
      height: MOVEMENT.standHeight
    });
    expect(r.position.y).toBeGreaterThan(0.2);   // climbed
  });

  it('raycasts to the nearest piece', () => {
    grid.add(new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north' }));
    const near = grid.add(new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 2 }, direction: 'north' }));
    const hit = collision.raycastPieces({
      origin: { x: TILE / 2, y: WALL_H / 2, z: TILE * 4 },
      direction: { x: 0, y: 0, z: -1 }
    }, 100);
    expect(hit.piece.id).toBe(near.id);
  });
});

describe('§9.5 structure integrity', () => {
  const flat = () => 0;

  it('treats a grounded piece as supported', () => {
    const grid = new BuildGrid();
    const p = grid.add(new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 } }));
    expect(computeSupported(grid, flat).has(p.id)).toBe(true);
  });

  it('cascades after the grace period', () => {
    const grid = new BuildGrid();
    const base = grid.add(new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north' }));
    const floor = grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 1, cz: 0 } }));
    grid.remove(base);
    base.destroyed = true;

    expect(updateSupport(grid, BUILD.supportGraceTime * 0.5, flat)).toHaveLength(0);
    const destroyed = updateSupport(grid, BUILD.supportGraceTime * 0.6, flat);
    expect(destroyed.map((p) => p.id)).toContain(floor.id);
  });
});
