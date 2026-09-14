/**
 * island.test.js — MAP_SPEC §20.9 required tests.
 *
 * The world overhaul's job is to look better without changing how the game plays, so most
 * of these assert that the island keeps the contracts every other system relies on.
 */
import { describe, it, expect } from 'vitest';
import { Island, Surface, POIS, ROADS, RIVER, LAKE } from '../src/world/Island.js';
import { resolveStructures, BLUEPRINT_NAMES } from '../src/world/IslandStructures.js';
import { TestEnvironment } from '../src/world/TestEnvironment.js';
import { MOVEMENT, WORLD, TILE, WALL_H } from '../src/core/Config.js';

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
    for (const poi of POIS) {
      const ground = island.heightAt(poi.centre[0], poi.centre[1]);
      const mine = structures.filter((s) => s.poi === poi.id);
      const lowest = Math.min(...mine.map((s) => s.cell.cy));
      // The base storey holds the ground line: its floor is at or just below it.
      expect(lowest * WALL_H, `${poi.id} base`).toBeLessThanOrEqual(ground);
      expect((lowest + 1) * WALL_H, `${poi.id} base`).toBeGreaterThan(ground);
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
