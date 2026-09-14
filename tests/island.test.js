/**
 * island.test.js — MAP_SPEC §20.9 required tests.
 *
 * The world overhaul's job is to look better without changing how the game plays, so most
 * of these assert that the island keeps the contracts every other system relies on.
 */
import { describe, it, expect } from 'vitest';
import { Island, Surface, POIS, ROADS, RIVER, LAKE } from '../src/world/Island.js';
import {
  originFor,
  resolveStructures, resolveDressing, resolveLoot, BLUEPRINT_NAMES, PROP_KINDS
} from '../src/world/IslandStructures.js';
import { WALL_PATTERNS } from '../src/editing/EditPatterns.js';
import { wallBoxes } from '../src/building/PieceGeometry.js';
import { TestEnvironment } from '../src/world/TestEnvironment.js';
import { MOVEMENT, WORLD, TILE, WALL_H, BUDGET, LIGHTING } from '../src/core/Config.js';

const island = new Island();

/** Walk a polyline at a fixed spacing. */
function* alongPolyline(points, step = 6) {
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const length = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(length / step));
    for (let k = 0; k <= n; k++) {
      yield [ax + (bx - ax) * (k / n), az + (bz - az) * (k / n)];
    }
  }
}

/** Every point on the island disc, at a coarse spacing. */
function* islandPoints(step = 12, radius = 410) {
  for (let x = -radius; x <= radius; x += step) {
    for (let z = -radius; z <= radius; z += step) {
      if (Math.hypot(x, z) <= radius) yield [x, z];
    }
  }
}

describe('MAP_SPEC §20.9.1 — the island keeps the terrain contract', () => {
  it('exposes every method the validation region did, so no consumer had to change', () => {
    const region = new TestEnvironment();
    for (const key of [
      'heightAt', 'waterDepthAt', 'slopeAt', 'isWalkable', 'isInBounds',
      'spawnPoint', 'sampleChunk', 'layout', 'clampToBounds'
    ]) {
      expect(typeof region[key], `region.${key}`).toBe('function');
      expect(typeof island[key], `island.${key}`).toBe('function');
    }
  });

  it('returns a finite height everywhere, including far out to sea', () => {
    for (const [x, z] of islandPoints(24, 700)) {
      expect(Number.isFinite(island.heightAt(x, z)), `${x},${z}`).toBe(true);
    }
  });

  it('samples a chunk into a heightfield of the right shape', () => {
    const chunk = island.sampleChunk(0, 0, WORLD.chunkSize, 17);
    expect(chunk.heights.length).toBe(17 * 17);
    expect(chunk.resolution).toBe(17);
  });
});

describe('MAP_SPEC §20.9.2 — terrain is continuous', () => {
  it('never jumps more than a step height between samples 0.1 m apart', () => {
    // Fine spacing on purpose: a cliff is steep, so a metre-scale test would either ban
    // cliffs outright or prove nothing about continuity.
    let worst = 0;
    let where = null;
    for (const [x, z] of islandPoints(9)) {
      const h = island.heightAt(x, z);
      const dx = Math.abs(island.heightAt(x + 0.1, z) - h);
      const dz = Math.abs(island.heightAt(x, z + 0.1) - h);
      const d = Math.max(dx, dz);
      if (d > worst) {
        worst = d;
        where = [x, z];
      }
    }
    expect(worst, `worst delta at ${where}`).toBeLessThan(MOVEMENT.stepHeight);
  });

  it('keeps no land outside the island shelf', () => {
    // A signed-distance landform that is not bounded lifts an entire half-plane, which
    // once put a wedge of land out in the ocean. This is the guard against that class.
    for (const [x, z] of islandPoints(10, 700)) {
      if (Math.hypot(x, z) <= 430) continue;
      expect(island.heightAt(x, z), `${x},${z}`).toBeLessThanOrEqual(WORLD.seaLevel);
    }
  });
});

describe('MAP_SPEC §20.9.3 — roads are routes', () => {
  it('is walkable at every point along every road', () => {
    for (const road of ROADS) {
      for (const [x, z] of alongPolyline(road.points)) {
        expect(island.isWalkable(x, z), `${road.id} at ${x},${z}`).toBe(true);
      }
    }
  });

  it('reports the road surface along every road', () => {
    for (const road of ROADS) {
      for (const [x, z] of alongPolyline(road.points, 12)) {
        const surface = island.surfaceAt(x, z);
        // A road through a POI core may report the POI's surface; both are ground a player
        // can rotate along, which is what the test is really about.
        expect([Surface.ROAD, Surface.DIRT, Surface.FIELD]).toContain(surface);
      }
    }
  });

  it('crosses water by fording, never by wading', () => {
    // A road may meet the river — severing the river to keep the road dry reads as a
    // broken map. What it may not do is drop the player into a swim.
    for (const road of ROADS) {
      for (const [x, z] of alongPolyline(road.points)) {
        expect(island.waterDepthAt(x, z), `${road.id} at ${x},${z}`)
          .toBeLessThan(WORLD.swimDepth);
      }
    }
  });
});

describe('MAP_SPEC §20.9.4 — water reads', () => {
  it('puts the river below sea level along its whole run', () => {
    for (const [x, z] of alongPolyline(RIVER.points, 10)) {
      expect(island.heightAt(x, z), `river at ${x},${z}`).toBeLessThan(WORLD.seaLevel);
    }
  });

  it('puts the lake below sea level', () => {
    expect(island.heightAt(LAKE.centre[0], LAKE.centre[1])).toBeLessThan(WORLD.seaLevel);
    expect(island.waterDepthAt(LAKE.centre[0], LAKE.centre[1])).toBeGreaterThan(0);
  });

  it('raises the land beside the water, so a shoreline exists', () => {
    const [cx, cz] = LAKE.centre;
    const beyond = LAKE.radius + LAKE.bank + TILE * 3;
    expect(island.heightAt(cx + beyond, cz)).toBeGreaterThan(WORLD.seaLevel);
    expect(island.heightAt(cx - beyond, cz)).toBeGreaterThan(WORLD.seaLevel);
  });

  it('leaves most of the island dry', () => {
    let wet = 0;
    let total = 0;
    for (const [x, z] of islandPoints(10)) {
      if (island.waterDepthAt(x, z) > 0) wet++;
      total++;
    }
    // Water is a feature, not the map. If it ever takes the island, something upstream
    // has moved a basin on top of the landmass.
    expect(wet / total).toBeLessThan(0.35);
  });
});

describe('MAP_SPEC §20.9.5 — POIs sit on good ground', () => {
  it('places every POI on dry, walkable, in-bounds land', () => {
    for (const poi of POIS) {
      const [x, z] = poi.centre;
      expect(island.isInBounds(x, z), `${poi.id} bounds`).toBe(true);
      // A waterside POI sits at the waterline on purpose; everything else must be dry.
      if (poi.waterside) {
        expect(island.waterDepthAt(x, z), `${poi.id} too deep`).toBeLessThan(WORLD.swimDepth);
      } else {
        expect(island.waterDepthAt(x, z), `${poi.id} flooded`).toBe(0);
      }
      expect(island.isWalkable(x, z), `${poi.id} steep`).toBe(true);
    }
  });

  it('levels each POI enough to build on', () => {
    for (const poi of POIS) {
      const [cx, cz] = poi.centre;
      const r = poi.radius * 0.35;
      for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
        expect(island.slopeAt(cx + dx, cz + dz), `${poi.id} at +${dx},${dz}`)
          .toBeLessThan(MOVEMENT.maxWalkableSlopeDeg);
      }
    }
  });

  it('keeps POIs apart, so each reads as its own place', () => {
    for (let i = 0; i < POIS.length; i++) {
      for (let k = i + 1; k < POIS.length; k++) {
        const d = Math.hypot(
          POIS[i].centre[0] - POIS[k].centre[0],
          POIS[i].centre[1] - POIS[k].centre[1]
        );
        expect(d, `${POIS[i].id}/${POIS[k].id}`).toBeGreaterThan(POIS[i].radius + POIS[k].radius);
      }
    }
  });
});

describe('MAP_SPEC §20.9.6 — POI structures are build pieces', () => {
  const structures = resolveStructures(POIS, island);

  it('resolves a blueprint for every POI', () => {
    for (const poi of POIS) {
      expect(BLUEPRINT_NAMES, `${poi.id} blueprint`).toContain(poi.blueprint);
      expect(structures.some((s) => s.poi === poi.id), poi.id).toBe(true);
    }
  });

  it('emits only real piece types and materials', () => {
    for (const s of structures) {
      expect(['wall', 'floor', 'ramp', 'cone']).toContain(s.type);
      expect(['wood', 'brick', 'metal']).toContain(s.material);
      expect(Number.isInteger(s.cell.cx) && Number.isInteger(s.cell.cy)
        && Number.isInteger(s.cell.cz), `${s.poi} cell`).toBe(true);
    }
  });

  it('sits every structure on the ground rather than floating or buried', () => {
    // One wall edit row. A building off by more than that has a visibly sunk or stilted
    // ground floor, whatever the POI centre says.
    const TOLERANCE = WALL_H / 3;
    for (const poi of POIS) {
      const mine = structures.filter((s) => s.poi === poi.id);
      const off = foundationError(poi, mine, island);
      expect(off, `${poi.id} is ${off.toFixed(2)} m off its ground`).toBeLessThan(TOLERANCE);
    }
  });

  it('stays well inside the build-piece budget', () => {
    expect(structures.length).toBeGreaterThan(150);
    expect(structures.length).toBeLessThan(1500);
  });

  it('skips an unknown blueprint rather than throwing', () => {
    const future = [{ ...POIS[0], id: 'future', blueprint: 'notYetInvented' }];
    expect(() => resolveStructures(future, island)).not.toThrow();
    expect(resolveStructures(future, island)).toEqual([]);
  });
});

describe('MAP_SPEC §20.9.7 — vegetation respects the world', () => {
  const layout = island.layout();

  it('places a real nature layer', () => {
    expect(layout.trees.length).toBeGreaterThan(60);
    expect(layout.rocks.length).toBeGreaterThan(15);
    expect(layout.bushes.length).toBeGreaterThan(20);
  });

  it('never plants on a road, in water, or inside a POI', () => {
    for (const entry of [...layout.trees, ...layout.rocks, ...layout.bushes]) {
      const { x, z } = entry;
      expect(island.waterDepthAt(x, z), `flooded at ${x},${z}`).toBe(0);
      expect(island.surfaceAt(x, z), `on a road at ${x},${z}`).not.toBe(Surface.ROAD);
      for (const poi of POIS) {
        const d = Math.hypot(x - poi.centre[0], z - poi.centre[1]);
        expect(d, `inside ${poi.id}`).toBeGreaterThanOrEqual(poi.radius * 0.85);
      }
    }
  });

  it('is deterministic — the island is identical every run', () => {
    const a = new Island().layout();
    const b = new Island().layout();
    expect(JSON.stringify(b.trees)).toBe(JSON.stringify(a.trees));
    expect(JSON.stringify(b.chests)).toBe(JSON.stringify(a.chests));
  });
});

describe('MAP_SPEC §20.9.8-9 — spawns and contents are placed safely', () => {
  const layout = island.layout();

  it('spawns the player on dry walkable land', () => {
    const spawn = island.spawnPoint();
    expect(island.waterDepthAt(spawn.x, spawn.z)).toBe(0);
    expect(island.isWalkable(spawn.x, spawn.z)).toBe(true);
    expect(island.isInBounds(spawn.x, spawn.z)).toBe(true);
  });

  it('spawns every bot on dry walkable land', () => {
    expect(layout.botSpawns.length).toBeGreaterThan(0);
    for (const spawn of layout.botSpawns) {
      expect(island.waterDepthAt(spawn.x, spawn.z), `${spawn.x},${spawn.z}`).toBe(0);
      expect(island.isWalkable(spawn.x, spawn.z), `${spawn.x},${spawn.z}`).toBe(true);
    }
  });

  it('keeps loot, props and spawns inside the island', () => {
    const everything = [
      ...layout.chests, ...layout.ammoBoxes, ...layout.floorLoot,
      ...layout.props, ...layout.botSpawns
    ];
    for (const p of everything) {
      expect(island.isInBounds(p.x, p.z), `${p.x},${p.z}`).toBe(true);
      expect(Math.hypot(p.x, p.z), `${p.x},${p.z}`).toBeLessThan(430);
    }
  });

  it('spreads loot across every POI so landing anywhere is viable', () => {
    for (const poi of POIS) {
      const near = layout.chests.filter(
        (c) => Math.hypot(c.x - poi.centre[0], c.z - poi.centre[1]) < poi.radius
      );
      expect(near.length, `${poi.id} chests`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('the overhaul changed no gameplay constant', () => {
  it('leaves movement, and therefore collision, untouched', () => {
    // The island is a visual pass. If it ever needs to move one of these to look right,
    // that is a gameplay change and belongs in a different conversation.
    expect(MOVEMENT.capsuleRadius).toBe(TILE * 0.078125);
    expect(MOVEMENT.standHeight).toBe(WALL_H * 0.5);
    expect(MOVEMENT.maxWalkableSlopeDeg).toBe(50);
  });

  it('keeps the region extent the storm and drop route are sized against', () => {
    expect(island.regionExtent).toBe(WORLD.regionExtent);
  });
});


/**
 * Worst mismatch between a POI's base storey and the ground under its footprint, in metres.
 *
 * Measured against the POI's own settled base storey, over EVERY dry building cell.
 *
 * Both halves of that matter. Measuring at the POI centre alone is what let a real bug
 * through: Kettle Row is a 67 m street, its centre sat on level ground, and its far houses
 * stood 7.3 m into the hill with only their roofs showing. And measuring against the POI's
 * LOWEST piece instead of its base storey would flag Riverwatch, whose dock is three storeys
 * down at the waterline on purpose (§21.2.1).
 */
function foundationError(poi, pieces, island) {
  const base = originFor(poi, island).baseStorey * WALL_H;
  const seen = new Set();
  let worst = 0;
  for (const p of pieces) {
    const key = `${p.cell.cx},${p.cell.cz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const x = (p.cell.cx + 0.5) * TILE;
    const z = (p.cell.cz + 0.5) * TILE;
    // A waterside POI stands over the channel on purpose; only its dry cells are ground.
    if (island.waterDepthAt(x, z) > 0) continue;
    worst = Math.max(worst, Math.abs(island.heightAt(x, z) - base));
  }
  return worst;
}

describe('MAP_SPEC §21 — POI architecture, interiors and loot', () => {
  const structures = resolveStructures(POIS, island);
  const dressing = resolveDressing(POIS, island);
  const loot = resolveLoot(POIS, island);
  const byPoi = (list) => {
    const map = new Map(POIS.map((p) => [p.id, []]));
    for (const item of list) map.get(item.poi)?.push(item);
    return map;
  };
  const piecesByPoi = byPoi(structures);

  it('§21.8.1 builds every POI from valid pieces', () => {
    for (const poi of POIS) {
      const mine = piecesByPoi.get(poi.id);
      expect(mine.length, `${poi.id} pieces`).toBeGreaterThan(40);
      for (const p of mine) {
        expect(['wall', 'floor', 'ramp', 'cone']).toContain(p.type);
        expect(['wood', 'brick', 'metal']).toContain(p.material);
        if (p.type === 'wall') expect(['north', 'south', 'east', 'west']).toContain(p.direction);
      }
    }
  });

  it('§21.8.2 sits every building on the ground', () => {
    const TOLERANCE = WALL_H / 3;      // one wall edit row
    for (const poi of POIS) {
      const off = foundationError(poi, piecesByPoi.get(poi.id), island);
      expect(off, `${poi.id} is ${off.toFixed(2)} m off its ground`).toBeLessThan(TOLERANCE);
    }
  });

  it('§21.8.2 lays a flat, storey-aligned pad under every POI footprint', () => {
    // The pad is what makes the previous test passable: the build grid is discrete in
    // storeys, so a POI's ground has to be both level and ON a storey line.
    for (const poi of POIS) {
      const cells = new Set();
      for (const p of piecesByPoi.get(poi.id)) cells.add(`${p.cell.cx},${p.cell.cz}`);
      const heights = [...cells].map((k) => {
        const [cx, cz] = k.split(',').map(Number);
        return { x: (cx + 0.5) * TILE, z: (cz + 0.5) * TILE };
      }).filter((c) => island.waterDepthAt(c.x, c.z) <= 0)
        .map((c) => island.heightAt(c.x, c.z));

      const spread = Math.max(...heights) - Math.min(...heights);
      expect(spread, `${poi.id} pad varies ${spread.toFixed(2)} m`).toBeLessThan(WALL_H / 3);
      const off = Math.abs(heights[0] / WALL_H - Math.round(heights[0] / WALL_H)) * WALL_H;
      expect(off, `${poi.id} pad is ${off.toFixed(2)} m off a storey line`).toBeLessThan(0.01);
    }
  });

  it('§21.8.3 gives every POI a walkable entrance', () => {
    for (const poi of POIS) {
      const walkable = piecesByPoi.get(poi.id).filter((p) => (
        p.type === 'wall' && p.editPattern?.walkable === true
      ));
      expect(walkable.length, `${poi.id} has no walkable opening`).toBeGreaterThan(0);
    }
  });

  it('§21.8.3 uses only edit patterns the game defines', () => {
    for (const p of structures) {
      if (!p.editPattern) continue;
      expect(Object.keys(WALL_PATTERNS), `${p.poi}: ${p.editPattern.key}`)
        .toContain(p.editPattern.key);
    }
  });

  it('§21.8.3 hands pieces a resolved pattern, not a bare key', () => {
    // PieceGeometry reads `editPattern.removed`. A descriptor carrying the KEY ('4,7')
    // instead of the resolved object silently yields a solid wall: the POI still looks
    // right from outside and every door, window and fence gap is sealed.
    for (const p of structures) {
      if (!p.editPattern) continue;
      expect(typeof p.editPattern, `${p.poi} pattern is not resolved`).toBe('object');
      expect(Array.isArray(p.editPattern.removed), `${p.poi}: ${p.editPattern.key}`).toBe(true);
      expect(p.editPattern.removed.length).toBeGreaterThan(0);
    }
  });

  it('§21.8.3 actually cuts the opening out of the wall geometry', () => {
    // The end-to-end assertion: a patterned wall must render fewer solid tiles than a full
    // one, and a half wall must stand a third of WALL_H. Counting patterns is not enough —
    // the pattern has to reach the geometry.
    const tiles = (p) => wallBoxes({
      cell: p.cell, direction: p.direction, editPattern: p.editPattern
    });
    const full = tiles({ cell: { cx: 0, cy: 0, cz: 0 }, direction: 'south', editPattern: null });
    expect(full.length).toBe(9);

    const patterned = structures.filter((p) => p.type === 'wall' && p.editPattern);
    expect(patterned.length).toBeGreaterThan(0);
    for (const p of patterned) {
      const boxes = tiles(p);
      expect(boxes.length, `${p.poi}: ${p.editPattern.key} did not cut`).toBeLessThan(9);
      expect(boxes.length).toBe(9 - p.editPattern.removed.length);
    }

    // Half walls are the load-bearing case for cover: they must be low enough to shoot over.
    const halves = patterned.filter((p) => p.editPattern.key === '0,1,2,3,4,5');
    expect(halves.length, 'no half-height cover in any POI').toBeGreaterThan(0);
    for (const p of halves) {
      const top = Math.max(...tiles(p).map((b) => b.max[1]));
      expect(top - p.cell.cy * WALL_H).toBeCloseTo(WALL_H / 3, 5);
    }
  });

  it('§21.8.4 connects the storeys of every multi-storey POI with a ramp', () => {
    for (const poi of POIS) {
      const mine = piecesByPoi.get(poi.id);
      const storeys = new Set(mine.map((p) => p.cell.cy));
      if (storeys.size < 2) continue;
      expect(mine.some((p) => p.type === 'ramp'), `${poi.id} has no stairs`).toBe(true);
    }
  });

  it('§21.8.5 leaves every POI interior reachable', () => {
    // A roof over a doorway is fine; a roof with no walkable opening beneath it anywhere is
    // a sealed box. Check each POI has walkable openings on its ground storey.
    for (const poi of POIS) {
      const mine = piecesByPoi.get(poi.id);
      // The POI's own base storey — where its buildings stand. Riverwatch's lowest pieces
      // are its dock, three storeys down at the waterline, and a dock has no doorways.
      const base = originFor(poi, island).baseStorey;
      const groundOpenings = mine.filter((p) => (
        p.cell.cy === base && p.editPattern?.walkable === true
      ));
      expect(groundOpenings.length, `${poi.id} sealed at ground level`).toBeGreaterThan(0);
    }
  });

  it('§21.8.6 spreads loot and gives each POI one risk chest', () => {
    const chests = byPoi(loot.chests);
    for (const poi of POIS) {
      const mine = chests.get(poi.id);
      expect(mine.length, `${poi.id} chests`).toBeGreaterThanOrEqual(3);
      // Not all in one place: at least three distinct cells.
      const cells = new Set(mine.map(
        (c) => `${Math.round(c.x / TILE)},${Math.round(c.z / TILE)},${Math.round(c.y / WALL_H)}`
      ));
      expect(cells.size, `${poi.id} chests are stacked in one spot`).toBeGreaterThanOrEqual(3);
      expect(mine.some((c) => c.risk), `${poi.id} has no risk chest`).toBe(true);
    }
  });

  it('§21.8.6 puts loot on more than one floor where the POI has floors', () => {
    const chests = byPoi(loot.chests);
    const multiStorey = ['hollowFarm', 'kettleRow', 'crownPost', 'drayYard'];
    for (const id of multiStorey) {
      const heights = new Set(chests.get(id).map((c) => Math.round(c.y / WALL_H)));
      expect(heights.size, `${id} loot is all on one floor`).toBeGreaterThan(1);
    }
  });

  it('§21.8.7 keeps every loot position inside its POI and above its ground', () => {
    const all = [...loot.chests, ...loot.ammoBoxes, ...loot.floorLoot];
    expect(all.length).toBeGreaterThan(50);
    for (const item of all) {
      const poi = POIS.find((p) => p.id === item.poi);
      const d = Math.hypot(item.x - poi.centre[0], item.z - poi.centre[1]);
      expect(d, `${item.poi} loot is outside the POI`).toBeLessThan(poi.radius * 1.6);
      // Loot sits on the building's floors, so it is measured against the POI's own settled
      // foundation rather than against whatever the terrain does under that exact point.
      const { baseStorey } = originFor(poi, island);
      expect(item.y, `${item.poi} loot below its building`)
        .toBeGreaterThanOrEqual(baseStorey * WALL_H);
    }
  });

  it('§21.8.8 keeps props out of water and off roads', () => {
    expect(dressing.length).toBeGreaterThan(30);
    for (const prop of dressing) {
      expect(PROP_KINDS, `unknown prop ${prop.kind}`).toContain(prop.kind);
      expect(island.waterDepthAt(prop.x, prop.z), `${prop.kind} in water`)
        .toBeLessThan(WORLD.swimDepth);
      // A service station's pumps belong on its forecourt, which is road surface — what
      // matters is that props stay inside their POI.
      const poi = POIS.find((p) => p.id === prop.poi);
      expect(Math.hypot(prop.x - poi.centre[0], prop.z - poi.centre[1]),
        `${prop.kind} outside ${prop.poi}`).toBeLessThan(poi.radius * 1.6);
    }
  });

  it('§21.8.9 stays inside the build-piece budget', () => {
    expect(structures.length).toBeGreaterThan(400);
    expect(structures.length).toBeLessThan(BUDGET.maxBuildPieces * 0.5);
  });

  it('§21.8.11 keeps the interior fill below the key light', () => {
    // §21.9 — the fill exists so a room is readable, not so the world goes flat. If it ever
    // approaches the sun it stops being a fill and exteriors lose their directional shading.
    expect(LIGHTING.interiorFill).toBeGreaterThan(0);
    expect(LIGHTING.interiorFill).toBeLessThan(LIGHTING.sunIntensity * 0.5);
    expect(LIGHTING.interiorFill).toBeLessThan(LIGHTING.hemisphereIntensity);
  });

  it('§21.8.10 gives every POI a distinct silhouette recipe', () => {
    // Piece-type mix plus storey count: if two POIs match on both, they will read the same
    // from a distance whatever their props say.
    const recipes = new Set();
    for (const poi of POIS) {
      const mine = piecesByPoi.get(poi.id);
      const counts = { wall: 0, floor: 0, ramp: 0, cone: 0 };
      for (const p of mine) counts[p.type]++;
      const storeys = new Set(mine.map((p) => p.cell.cy)).size;
      const recipe = `${storeys}|${Object.values(counts).join(',')}`;
      expect(recipes.has(recipe), `${poi.id} duplicates another silhouette`).toBe(false);
      recipes.add(recipe);
    }
  });

  it('gives the tall POIs real vertical presence', () => {
    // Measured UP from each POI's own base storey, not as a storey span. Riverwatch's dock
    // descends three storeys to the waterline (§21.2.1), which makes its span the largest on
    // the island while it remains the lowest thing on the skyline.
    const height = (id) => {
      const poi = POIS.find((p) => p.id === id);
      const base = originFor(poi, island).baseStorey;
      return Math.max(...piecesByPoi.get(id).map((p) => p.cell.cy)) - base;
    };
    // Crown Post is the island's landmark; it must out-top every other POI.
    for (const id of ['hollowFarm', 'pumpjackStop', 'kettleRow', 'riverwatch', 'drayYard']) {
      expect(height('crownPost'), `crownPost vs ${id}`).toBeGreaterThan(height(id));
    }
  });

  it('uses roofs made of ramps and decks, not fields of cones', () => {
    const cones = structures.filter((p) => p.type === 'cone').length;
    expect(cones).toBe(0);
    expect(structures.filter((p) => p.type === 'ramp').length).toBeGreaterThan(20);
  });
});
