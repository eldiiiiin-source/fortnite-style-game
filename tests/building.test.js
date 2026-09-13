/** Build grid, placement, and structure integrity. MASTER_SPEC §6. */
import { describe, it, expect, beforeEach } from 'vitest';
import { BuildGrid, worldToCell, cellToWorld, cellCentre, neighbourCell } from '../src/building/BuildGrid.js';
import { BuildPiece, resetPieceIds } from '../src/building/BuildPiece.js';
import { validatePlacement, placePiece, PlacementResult, pieceWorldBounds, overlapsPlayer } from '../src/building/Placement.js';
import { computeSupported, updateSupport } from '../src/building/StructureGraph.js';
import { BUILD, MATERIALS, MOVEMENT } from '../src/core/Config.js';

const builder = (overrides = {}) => ({
  id: 1,
  position: { x: 0, y: 0, z: 0 },
  materials: { wood: 500, stone: 500, metal: 500 },
  lastPlacementTime: null,
  ...overrides
});

// A flat world at y = 0 so layer-0 cells are grounded.
const flatTerrain = () => 0;

beforeEach(() => resetPieceIds());

describe('§6.1 grid addressing', () => {
  it('round-trips world to cell to world', () => {
    const cell = worldToCell(7.5, 4.0, -3.2);
    expect(cell).toEqual({ cx: 1, cy: 1, cz: -1 });
    const w = cellToWorld(cell.cx, cell.cy, cell.cz);
    expect(w.x).toBeCloseTo(BUILD.tileSize);
    expect(w.y).toBeCloseTo(BUILD.wallHeight);
  });

  it('puts the cell centre half a tile in from the minimum corner', () => {
    const c = cellCentre(0, 0, 0);
    expect(c.x).toBeCloseTo(BUILD.tileSize / 2);
    expect(c.y).toBeCloseTo(BUILD.wallHeight / 2);
  });

  it('walks to the correct neighbour per direction', () => {
    const cell = { cx: 0, cy: 0, cz: 0 };
    expect(neighbourCell(cell, 'north').cz).toBe(-1);
    expect(neighbourCell(cell, 'south').cz).toBe(1);
    expect(neighbourCell(cell, 'east').cx).toBe(1);
    expect(neighbourCell(cell, 'west').cx).toBe(-1);
  });
});

describe('§6.1 slot occupancy', () => {
  it('allows four walls, a floor, a ramp and a cone in one cell', () => {
    const grid = new BuildGrid();
    const cell = { cx: 0, cy: 0, cz: 0 };
    for (const dir of ['north', 'east', 'south', 'west']) {
      grid.add(new BuildPiece({ type: 'wall', material: 'wood', cell, direction: dir }));
    }
    grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell }));
    grid.add(new BuildPiece({ type: 'ramp', material: 'wood', cell }));
    grid.add(new BuildPiece({ type: 'cone', material: 'wood', cell }));
    expect(grid.pieceCount).toBe(7);
  });

  it('refuses two pieces in the same slot', () => {
    const grid = new BuildGrid();
    const cell = { cx: 0, cy: 0, cz: 0 };
    grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell }));
    expect(() => grid.add(new BuildPiece({ type: 'floor', material: 'stone', cell })))
      .toThrow(/already occupied/);
  });
});

describe('§6.3 placement rules', () => {
  it('places a piece and deducts exactly 10 material (rule 1)', () => {
    const grid = new BuildGrid();
    const b = builder();
    const result = placePiece({
      grid, type: 'floor', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, builder: b, now: 1
    });
    expect(result.ok).toBe(true);
    expect(b.materials.wood).toBe(500 - BUILD.cost);
    expect(grid.pieceCount).toBe(1);
  });

  it('rejects an occupied slot (rule 4)', () => {
    const grid = new BuildGrid();
    const cell = { cx: 0, cy: 0, cz: 0 };
    grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell }));
    const r = validatePlacement({ grid, type: 'floor', material: 'wood', cell, builder: builder() });
    expect(r.reason).toBe(PlacementResult.SLOT_OCCUPIED);
  });

  it('rejects beyond the 12 m placement range (rule 2)', () => {
    const grid = new BuildGrid();
    // Cell 3 is ~17.9 m out along X — past the 12 m reach.
    const r = validatePlacement({
      grid, type: 'floor', material: 'wood', cell: { cx: 3, cy: 0, cz: 0 }, builder: builder()
    });
    expect(r.reason).toBe(PlacementResult.OUT_OF_RANGE);
  });

  it('rejects without enough material (rule 4)', () => {
    const grid = new BuildGrid();
    const b = builder({ materials: { wood: 9, stone: 0, metal: 0 } });
    const r = validatePlacement({ grid, type: 'floor', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, builder: b });
    expect(r.reason).toBe(PlacementResult.INSUFFICIENT_MATERIAL);
  });

  it('rejects above the build ceiling (rule 4)', () => {
    const grid = new BuildGrid();
    const cy = Math.ceil(BUILD.ceilingY / BUILD.wallHeight);
    const b = builder({ position: cellCentre(0, cy, 0) });
    const r = validatePlacement({ grid, type: 'floor', material: 'wood', cell: { cx: 0, cy, cz: 0 }, builder: b });
    expect(r.reason).toBe(PlacementResult.ABOVE_CEILING);
  });

  it('rejects a piece that would intersect a player (rule 4)', () => {
    const grid = new BuildGrid();
    const cell = { cx: 0, cy: 0, cz: 0 };
    const c = cellCentre(0, 0, 0);
    // Stand the player inside the cell, at the ramp volume.
    const player = {
      position: { x: c.x, y: 0, z: c.z },
      radius: MOVEMENT.capsuleRadius,
      height: MOVEMENT.standHeight
    };
    const r = validatePlacement({
      grid, type: 'ramp', material: 'wood', cell, builder: builder(), players: [player]
    });
    expect(r.reason).toBe(PlacementResult.BLOCKED_BY_PLAYER);
  });

  it('rate-limits placements to 0.10 s apart (rule 6)', () => {
    const grid = new BuildGrid();
    const b = builder();
    placePiece({ grid, type: 'floor', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, builder: b, now: 0 });
    const tooSoon = validatePlacement({
      grid, type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, builder: b, now: 0.05
    });
    expect(tooSoon.reason).toBe(PlacementResult.RATE_LIMITED);

    const later = validatePlacement({
      grid, type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, builder: b, now: 0.11
    });
    expect(later.ok).toBe(true);
  });

  it('does not let terrain block placement (rule 5)', () => {
    // There is no terrain input to validatePlacement at all — that is the rule.
    const grid = new BuildGrid();
    const r = validatePlacement({
      grid, type: 'floor', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, builder: builder()
    });
    expect(r.ok).toBe(true);
  });
});

describe('§6.2 piece bounds', () => {
  it('gives a wall the full cell width and wall height', () => {
    const b = pieceWorldBounds('wall', 'north', { cx: 0, cy: 0, cz: 0 });
    expect(b.max[0] - b.min[0]).toBeCloseTo(BUILD.tileSize);
    expect(b.max[1] - b.min[1]).toBeCloseTo(BUILD.wallHeight);
    expect(b.max[2] - b.min[2]).toBeCloseTo(BUILD.thickness);
  });

  it('puts opposing wall faces on opposite sides of the cell', () => {
    const n = pieceWorldBounds('wall', 'north', { cx: 0, cy: 0, cz: 0 });
    const s = pieceWorldBounds('wall', 'south', { cx: 0, cy: 0, cz: 0 });
    expect(n.min[2]).toBeLessThan(s.min[2]);
  });

  it('leaves room for a player capsule inside a 1x1 box', () => {
    const inner = BUILD.tileSize - 2 * BUILD.thickness;
    expect(inner).toBeGreaterThan(MOVEMENT.capsuleRadius * 2);
  });

  it('does not report an overlap for a player standing clear', () => {
    const bounds = pieceWorldBounds('wall', 'north', { cx: 0, cy: 0, cz: 0 });
    const player = { position: { x: 2.5, y: 0, z: 4 }, radius: 0.4, height: 1.85 };
    expect(overlapsPlayer(bounds, player)).toBe(false);
  });
});

describe('§6.4 build HP ramp', () => {
  it('starts at 90 HP and ramps to full over the material build time', () => {
    const piece = new BuildPiece({ type: 'wall', material: 'metal', cell: { cx: 0, cy: 0, cz: 0 } });
    expect(piece.hp).toBe(90);
    expect(piece.isFullyBuilt).toBe(false);

    // 20 s of metal build time, one 30 Hz tick at a time.
    for (let t = 0; t < MATERIALS.metal.buildTime * 30; t++) piece.update(1 / 30);
    expect(piece.isFullyBuilt).toBe(true);
    expect(piece.hp).toBeCloseTo(MATERIALS.metal.fullHp, 0);
  });

  it('does not undo damage taken during the ramp', () => {
    const piece = new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 } });
    piece.applyDamage(50);
    expect(piece.hp).toBe(40);
    piece.update(0.5);
    // It gains ramp HP but stays well below a fresh piece's HP.
    expect(piece.hp).toBeGreaterThan(40);
    expect(piece.hp).toBeLessThan(MATERIALS.wood.fullHp);
  });

  it('destroys a piece at 0 HP', () => {
    const piece = new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 } });
    expect(piece.applyDamage(89)).toBe(false);
    expect(piece.applyDamage(10)).toBe(true);
    expect(piece.destroyed).toBe(true);
  });
});

describe('§6.5 structure integrity', () => {
  it('treats a piece on the terrain as supported', () => {
    const grid = new BuildGrid();
    const p = grid.add(new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 } }));
    const supported = computeSupported(grid, flatTerrain);
    expect(supported.has(p.id)).toBe(true);
  });

  it('supports a stack of walls through the one below it', () => {
    const grid = new BuildGrid();
    const ids = [];
    for (let cy = 0; cy < 4; cy++) {
      ids.push(grid.add(new BuildPiece({
        type: 'wall', material: 'wood', cell: { cx: 0, cy, cz: 0 }, direction: 'north'
      })).id);
    }
    const supported = computeSupported(grid, flatTerrain);
    for (const id of ids) expect(supported.has(id)).toBe(true);
  });

  it('leaves a floating piece unsupported', () => {
    const grid = new BuildGrid();
    const p = grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 5, cz: 0 } }));
    expect(computeSupported(grid, flatTerrain).has(p.id)).toBe(false);
  });

  it('cascades destruction after the 0.35 s grace period', () => {
    const grid = new BuildGrid();
    // A grounded wall holding a floor above it.
    const base = grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north'
    }));
    const floor = grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 1, cz: 0 } }));

    expect(computeSupported(grid, flatTerrain).has(floor.id)).toBe(true);

    // Knock out the base; the floor should survive the grace period, then fall.
    base.destroyed = true;
    grid.remove(base);

    let destroyed = updateSupport(grid, 0.2, flatTerrain);
    expect(destroyed).toHaveLength(0);
    expect(floor.destroyed).toBe(false);

    destroyed = updateSupport(grid, 0.2, flatTerrain); // total 0.4 s > 0.35 s
    expect(destroyed.map((p) => p.id)).toContain(floor.id);
    expect(grid.pieceCount).toBe(0);
  });

  it('re-supports a piece that regains support inside the grace period', () => {
    const grid = new BuildGrid();
    const base = grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north'
    }));
    const floor = grid.add(new BuildPiece({ type: 'floor', material: 'wood', cell: { cx: 0, cy: 1, cz: 0 } }));

    base.destroyed = true;
    grid.remove(base);
    updateSupport(grid, 0.2, flatTerrain);
    expect(floor.unsupportedFor).toBeCloseTo(0.2);

    // Rebuild the support before the grace period expires.
    grid.add(new BuildPiece({ type: 'wall', material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, direction: 'north' }));
    updateSupport(grid, 0.2, flatTerrain);
    expect(floor.destroyed).toBe(false);
    expect(floor.unsupportedFor).toBeNull();
  });
});
