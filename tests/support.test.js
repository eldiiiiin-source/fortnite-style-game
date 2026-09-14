/**
 * support.test.js — MASTER_SPEC §6.5, live structural integrity.
 *
 * Covers the dirty-region support system and the world's own structural validity. The
 * island's buildings are ordinary build pieces (MAP_SPEC §20.1), so they answer to exactly
 * the same rules a player's tower does — these tests hold both to it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Island } from '../src/world/Island.js';
import { resolveStructures } from '../src/world/IslandStructures.js';
import { BuildGrid } from '../src/building/BuildGrid.js';
import { BuildPiece } from '../src/building/BuildPiece.js';
import { SupportSystem, dependentsOf } from '../src/building/SupportSystem.js';
import { computeSupported, supportersOf } from '../src/building/StructureGraph.js';
import { WALL_PATTERNS } from '../src/editing/EditPatterns.js';
import { TILE, BUILD, SIM } from '../src/core/Config.js';

/** The island, its buildings, and a support system seeded over them. */
function buildWorld() {
  const island = new Island();
  const grid = new BuildGrid();
  const poiOf = new Map();
  for (const d of resolveStructures(island.pois, island)) {
    const piece = new BuildPiece({
      type: d.type, material: d.material, cell: d.cell, direction: d.direction, ownerId: 0
    });
    piece.editPattern = d.editPattern;
    piece.buildProgress = 1;
    piece.hp = piece.materialDef.fullHp;
    try {
      grid.add(piece);
      poiOf.set(piece.id, d.poi);
    } catch {
      // A blueprint may overlap itself where two parts meet; the first piece wins.
    }
  }
  const terrainHeightAt = (cx, cz) => island.heightAt((cx + 0.5) * TILE, (cz + 0.5) * TILE);
  const collapsed = [];
  const support = new SupportSystem({
    grid, terrainHeightAt, onCollapse: (p) => collapsed.push(p)
  });
  support.seed();
  return { island, grid, poiOf, support, collapsed, terrainHeightAt };
}

/** Destroy a piece the way the game does, then let the cascade run itself out. */
function destroyAndSettle(world, piece, maxFrames = 600) {
  piece.destroyed = true;
  world.grid.remove(piece);
  world.support.markDirty(piece);
  let frames = 0;
  do {
    world.support.update(SIM.fixedDt);
    frames++;
  } while (world.support.falling.size > 0 && frames < maxFrames);
  return frames;
}

const piecesOf = (world, poi) => [...world.grid].filter((p) => world.poiOf.get(p.id) === poi);

describe('MASTER_SPEC §6.5 — world structures are structurally valid', () => {
  let world;
  beforeEach(() => { world = buildWorld(); });

  it('leaves no world piece standing on nothing', () => {
    const floating = [...world.grid].filter((p) => !p.supported);
    const byPoi = new Map();
    for (const p of floating) byPoi.set(world.poiOf.get(p.id), (byPoi.get(world.poiOf.get(p.id)) ?? 0) + 1);
    expect(floating.length, `unsupported: ${JSON.stringify([...byPoi])}`).toBe(0);
  });

  it('agrees exactly with a full global support scan', () => {
    // The incremental system is only worth having if it gives the same answer as the
    // algorithm it replaces. Anything else is a faster wrong answer.
    const global = computeSupported(world.grid, world.terrainHeightAt);
    for (const piece of world.grid) {
      expect(piece.supported, `piece ${piece.id} (${piece.type})`).toBe(global.has(piece.id));
    }
  });

  it('holds Hollow Farm’s gable roof up before anything is damaged', () => {
    // The ridge deck rests on the eave ramps. That relationship is the one the support model
    // originally missed, which left thirteen roof pieces floating.
    const roof = piecesOf(world, 'hollowFarm').filter((p) => p.type === 'floor');
    expect(roof.length).toBeGreaterThan(10);
    for (const p of roof) expect(p.supported, `farm roof piece at ${JSON.stringify(p.cell)}`).toBe(true);
  });

  it('holds Kettle Row’s roofs up before anything is damaged', () => {
    const roofs = piecesOf(world, 'kettleRow').filter((p) => p.type === 'floor');
    expect(roofs.length).toBeGreaterThan(4);
    for (const p of roofs) expect(p.supported, `row roof piece at ${JSON.stringify(p.cell)}`).toBe(true);
  });

  it('stands Riverwatch’s cabin on its pilings before anything is damaged', () => {
    // The cabin is over a ravine; it stands only because real pilings reach the bed.
    const pieces = piecesOf(world, 'riverwatch');
    expect(pieces.length).toBeGreaterThan(50);
    for (const p of pieces) expect(p.supported, `riverwatch piece at ${JSON.stringify(p.cell)}`).toBe(true);

    // And those pilings are load-bearing, not decoration: the cabin floor depends on them.
    const floors = pieces.filter((p) => p.type === 'floor');
    const carried = floors.some((f) => supportersOf(f, world.grid).some((s) => s.type === 'wall'));
    expect(carried, 'no cabin floor rests on a wall').toBe(true);
  });
});

describe('MASTER_SPEC §6.5 — cascade destruction', () => {
  let world;
  beforeEach(() => { world = buildWorld(); });

  it('collapses what a destroyed support was holding up', () => {
    // Riverwatch's pilings are unambiguous load bearers: cut them and the cabin has nothing.
    const pilings = piecesOf(world, 'riverwatch')
      .filter((p) => p.type === 'wall' && p.editPattern?.key === '1,4,7');
    expect(pilings.length, 'no pilings found').toBeGreaterThan(0);

    const lowest = Math.min(...pilings.map((p) => p.cell.cy));
    const feet = pilings.filter((p) => p.cell.cy === lowest);
    for (const foot of feet) {
      foot.destroyed = true;
      world.grid.remove(foot);
      world.support.markDirty(foot);
    }
    let frames = 0;
    do { world.support.update(SIM.fixedDt); frames++; } while (world.support.falling.size > 0 && frames < 600);

    expect(world.collapsed.length, 'nothing fell when the pilings went').toBeGreaterThan(0);
    for (const p of world.collapsed) expect(world.poiOf.get(p.id)).toBe('riverwatch');
  });

  it('never lets an unsupported piece stand forever', () => {
    // A floor placed in mid-air with nothing beneath it must not simply remain there.
    const floating = new BuildPiece({
      type: 'floor', material: 'wood', cell: { cx: 900, cy: 20, cz: 900 }, ownerId: 1
    });
    floating.buildProgress = 1;
    world.grid.add(floating);
    world.support.markDirty(floating);

    world.support.update(SIM.fixedDt);
    expect(floating.supported).toBe(false);

    let frames = 1;
    while (!floating.destroyed && frames < 600) { world.support.update(SIM.fixedDt); frames++; }
    expect(floating.destroyed, 'floating piece survived').toBe(true);
    // It goes within the grace period, not eventually.
    expect(frames * SIM.fixedDt).toBeLessThan(BUILD.supportGraceTime * 2);
    expect(world.grid.has(floating)).toBe(false);
  });

  it('cannot collapse an unrelated POI', () => {
    // Every POI, one at a time: knocking a building down at one must not touch the others.
    for (const poi of world.island.pois) {
      const fresh = buildWorld();
      const walls = piecesOf(fresh, poi.id).filter((p) => p.type === 'wall');
      expect(walls.length).toBeGreaterThan(0);

      // Take out the whole ground storey of that POI — a far heavier blow than one wall.
      const base = Math.min(...piecesOf(fresh, poi.id).map((p) => p.cell.cy));
      for (const w of walls.filter((p) => p.cell.cy === base)) {
        w.destroyed = true;
        fresh.grid.remove(w);
        fresh.support.markDirty(w);
      }
      let frames = 0;
      do { fresh.support.update(SIM.fixedDt); frames++; } while (fresh.support.falling.size > 0 && frames < 900);

      const strays = fresh.collapsed.filter((p) => fresh.poiOf.get(p.id) !== poi.id);
      const where = [...new Set(strays.map((p) => fresh.poiOf.get(p.id)))];
      expect(strays.length, `flattening ${poi.id} also took down ${JSON.stringify(where)}`).toBe(0);
    }
  });
});

describe('MASTER_SPEC §6.5 — player structures follow the same rules', () => {
  let world;
  beforeEach(() => { world = buildWorld(); });

  /** Build a pillar of walls with a floor per storey on open ground. */
  function tower(cx, cz, storeys) {
    const base = Math.floor(world.terrainHeightAt(cx, cz) / BUILD.wallHeight);
    const built = [];
    for (let y = 0; y < storeys; y++) {
      for (const direction of ['north', 'south', 'east', 'west']) {
        const wall = new BuildPiece({
          type: 'wall', material: 'wood', cell: { cx, cy: base + y, cz }, direction, ownerId: 1
        });
        wall.buildProgress = 1;
        world.grid.add(wall);
        world.support.markDirty(wall);
        built.push(wall);
      }
      const floor = new BuildPiece({
        type: 'floor', material: 'wood', cell: { cx, cy: base + y + 1, cz }, ownerId: 1
      });
      floor.buildProgress = 1;
      world.grid.add(floor);
      world.support.markDirty(floor);
      built.push(floor);
    }
    world.support.update(SIM.fixedDt);
    return { base, built };
  }

  it('stands a player tower up, and drops it when its base is cut', () => {
    const { base, built } = tower(900, 900, 8);
    for (const p of built) expect(p.supported, `${p.type} at storey ${p.cell.cy - base}`).toBe(true);

    for (const foot of built.filter((p) => p.cell.cy === base)) {
      foot.destroyed = true;
      world.grid.remove(foot);
      world.support.markDirty(foot);
    }
    let frames = 0;
    do { world.support.update(SIM.fixedDt); frames++; } while (world.support.falling.size > 0 && frames < 900);

    const survivors = built.filter((p) => !p.destroyed && world.grid.has(p));
    expect(survivors.length, 'the tower kept standing on nothing').toBe(0);
    // And it took nothing of the island with it.
    expect(world.collapsed.filter((p) => world.poiOf.has(p.id)).length).toBe(0);
  });

  it('supports every piece type, edited or not', () => {
    // A pattern describes which tiles are cut out. It never changes what holds a piece up:
    // a wall edited down to a half wall still carries the floor above it.
    const base = Math.floor(world.terrainHeightAt(910, 910) / BUILD.wallHeight);
    const cell = { cx: 910, cy: base, cz: 910 };

    const wall = new BuildPiece({ type: 'wall', material: 'wood', cell, direction: 'north', ownerId: 1 });
    const ramp = new BuildPiece({ type: 'ramp', material: 'wood', cell, direction: 'north', ownerId: 1 });
    const cone = new BuildPiece({ type: 'cone', material: 'wood', cell, ownerId: 1 });
    const floor = new BuildPiece({ type: 'floor', material: 'wood', cell, ownerId: 1 });
    for (const p of [wall, ramp, cone, floor]) {
      p.buildProgress = 1;
      world.grid.add(p);
      world.support.markDirty(p);
    }
    world.support.update(SIM.fixedDt);
    for (const p of [wall, ramp, cone, floor]) {
      expect(p.supported, `${p.type} on the ground`).toBe(true);
    }

    // Now edit each, and confirm the support relationships are unchanged.
    const before = [wall, ramp, cone, floor].map((p) => supportersOf(p, world.grid).length);
    wall.editPattern = { key: '0,1,2,3,4,5', ...WALL_PATTERNS['0,1,2,3,4,5'] };
    floor.editPattern = { key: '0', name: 'corner', removed: [0] };
    for (const p of [wall, floor]) world.support.markEdited(p);
    world.support.update(SIM.fixedDt);

    const after = [wall, ramp, cone, floor].map((p) => supportersOf(p, world.grid).length);
    expect(after).toEqual(before);
    for (const p of [wall, ramp, cone, floor]) expect(p.supported, `${p.type} after edit`).toBe(true);
  });

  it('holds up a floor that lands on top of a ramp', () => {
    // Ramp then floor is the commonest build in the game. The floor sits on the ramp's high
    // edge, in the next cell up and over — a relationship the support model has to know.
    const base = Math.floor(world.terrainHeightAt(920, 920) / BUILD.wallHeight);
    const ramp = new BuildPiece({
      type: 'ramp', material: 'wood', cell: { cx: 920, cy: base, cz: 920 }, direction: 'south', ownerId: 1
    });
    const landing = new BuildPiece({
      type: 'floor', material: 'wood', cell: { cx: 920, cy: base + 1, cz: 921 }, ownerId: 1
    });
    for (const p of [ramp, landing]) {
      p.buildProgress = 1;
      world.grid.add(p);
      world.support.markDirty(p);
    }
    world.support.update(SIM.fixedDt);
    expect(ramp.supported).toBe(true);
    expect(landing.supported, 'landing at the top of a ramp is unsupported').toBe(true);

    // And the ramp really is what holds it: take the ramp away and the landing falls.
    destroyAndSettle(world, ramp);
    expect(landing.destroyed, 'landing survived losing its ramp').toBe(true);
  });
});

describe('MASTER_SPEC §6.5 — the support system stays out of the way', () => {
  it('does nothing at all when the grid has not changed', () => {
    // Responsiveness beats structural simulation: an idle frame must not walk the world.
    const world = buildWorld();
    expect(world.support.pending.size).toBe(0);
    expect(world.support.falling.size).toBe(0);

    const before = world.support.stats.updates;
    for (let i = 0; i < 120; i++) world.support.update(SIM.fixedDt);
    expect(world.support.stats.updates, 'idle frames did work').toBe(before);
    expect(world.grid.pieceCount).toBeGreaterThan(900);
  });

  it('touches only a bounded region when one piece changes', () => {
    // The point of the dirty region. One destruction must not scale with the world.
    const world = buildWorld();
    const total = world.grid.pieceCount;
    const wall = [...world.grid].find((p) => p.type === 'wall' && world.poiOf.get(p.id) === 'drayYard');

    destroyAndSettle(world, wall);
    expect(world.support.stats.worstRegion).toBeGreaterThan(0);
    expect(world.support.stats.worstRegion, 'region scaled with the world')
      .toBeLessThan(total / 5);
  });

  it('reports dependents as the exact inverse of supportersOf', () => {
    // The locality claim: if these two ever disagree, the region is the wrong shape and the
    // incremental answer silently diverges from the global one.
    const world = buildWorld();
    const sample = [...world.grid].slice(0, 120);
    for (const piece of sample) {
      for (const dep of dependentsOf(piece, world.grid)) {
        expect(supportersOf(dep, world.grid), `${dep.type} should name its supporter`)
          .toContain(piece);
      }
    }
    // And nothing outside the local footprint claims this piece.
    for (const piece of sample.slice(0, 40)) {
      const found = new Set(dependentsOf(piece, world.grid));
      for (const other of world.grid) {
        if (other === piece) continue;
        if (supportersOf(other, world.grid).includes(piece)) {
          expect(found.has(other), 'a dependent outside the local footprint').toBe(true);
        }
      }
    }
  });
});
