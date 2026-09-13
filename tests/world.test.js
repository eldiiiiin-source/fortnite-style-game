/** Terrain, POIs, storm. MAP_SPEC §2 - §9. */
import { describe, it, expect } from 'vitest';
import { TerrainGenerator } from '../src/world/TerrainGenerator.js';
import { POIS, poiAt, lootTierAt, poiDistance, BIOME_DENSITY, biomeAt } from '../src/world/PointsOfInterest.js';
import { Storm, StormState } from '../src/world/Storm.js';
import { RandomStream } from '../src/core/Random.js';
import { WORLD, STORM_PHASES, MATCH, MOVEMENT } from '../src/core/Config.js';

describe('MAP_SPEC §4.1 terrain generation', () => {
  const terrain = new TerrainGenerator(2024);

  it('is deterministic for a seed', () => {
    const a = new TerrainGenerator(99).heightAt(123, -456);
    const b = new TerrainGenerator(99).heightAt(123, -456);
    expect(a).toBe(b);
  });

  it('differs between seeds', () => {
    const a = new TerrainGenerator(1).heightAt(300, 300);
    const b = new TerrainGenerator(2).heightAt(300, 300);
    expect(a).not.toBe(b);
  });

  it('stays inside the documented height range', () => {
    for (let x = -1000; x <= 1000; x += 137) {
      for (let z = -1000; z <= 1000; z += 137) {
        const h = terrain.heightAt(x, z);
        expect(h).toBeGreaterThanOrEqual(WORLD.minHeight);
        expect(h).toBeLessThanOrEqual(WORLD.maxHeight);
      }
    }
  });

  it('falls to ocean beyond the island falloff radius', () => {
    expect(terrain.heightAt(1600, 1600)).toBeLessThan(WORLD.seaLevel);
    expect(terrain.islandFalloff(1600, 1600)).toBe(0);
  });

  it('is above water near the centre', () => {
    expect(terrain.heightAt(0, 0)).toBeGreaterThan(WORLD.seaLevel);
  });

  it('flattens POI footprints to their base elevation', () => {
    for (const poi of POIS) {
      const h = terrain.heightAt(poi.centre[0], poi.centre[1]);
      // §4.1 — the footprint is flattened; the blend skirt only affects the edges.
      expect(Math.abs(h - poi.base)).toBeLessThan(1);
    }
  });

  it('leaves POI centres walkable', () => {
    for (const poi of POIS) {
      expect(terrain.slopeAt(poi.centre[0], poi.centre[1]))
        .toBeLessThanOrEqual(MOVEMENT.maxWalkableSlopeDeg);
    }
  });

  it('reports water depth only below sea level', () => {
    expect(terrain.waterDepth(1600, 1600)).toBeGreaterThan(0);
    expect(terrain.waterDepth(0, 0)).toBe(0);
  });

  it('marks points outside the playable square out of bounds', () => {
    const half = WORLD.playableExtent / 2;
    expect(terrain.isOutOfBounds(half + 1, 0)).toBe(true);
    expect(terrain.isOutOfBounds(0, 0)).toBe(false);
  });

  it('samples a chunk at the requested resolution', () => {
    const chunk = terrain.sampleChunk(0, 0, 33);
    expect(chunk.heights).toHaveLength(33 * 33);
    expect(chunk.size).toBe(WORLD.chunkSize);
  });
});

describe('MAP_SPEC §5.3 points of interest', () => {
  it('has 15 POIs across the three tiers', () => {
    expect(POIS).toHaveLength(15);
    const counts = POIS.reduce((acc, p) => ({ ...acc, [p.tier]: (acc[p.tier] ?? 0) + 1 }), {});
    expect(counts.major).toBe(5);
    expect(counts.minor).toBe(5);
    expect(counts.landmark).toBe(5);
  });

  it('keeps every Major POI at least 420 m from every other', () => {
    const majors = POIS.filter((p) => p.tier === 'major');
    for (let i = 0; i < majors.length; i++) {
      for (let j = i + 1; j < majors.length; j++) {
        expect(poiDistance(majors[i], majors[j])).toBeGreaterThanOrEqual(420);
      }
    }
  });

  it('keeps every POI footprint inside the playable square', () => {
    const half = WORLD.playableExtent / 2;
    for (const poi of POIS) {
      expect(Math.abs(poi.centre[0]) + poi.footprint[0] / 2).toBeLessThanOrEqual(half);
      expect(Math.abs(poi.centre[1]) + poi.footprint[1] / 2).toBeLessThanOrEqual(half);
    }
  });

  it('does not overlap any two POI footprints', () => {
    for (let i = 0; i < POIS.length; i++) {
      for (let j = i + 1; j < POIS.length; j++) {
        const a = POIS[i], b = POIS[j];
        const overlapX = Math.abs(a.centre[0] - b.centre[0]) < (a.footprint[0] + b.footprint[0]) / 2;
        const overlapZ = Math.abs(a.centre[1] - b.centre[1]) < (a.footprint[1] + b.footprint[1]) / 2;
        expect(overlapX && overlapZ).toBe(false);
      }
    }
  });

  it('makes Ember Peak the highest POI', () => {
    const highest = [...POIS].sort((a, b) => b.base - a.base)[0];
    expect(highest.name).toBe('Ember Peak');
  });

  it('resolves the loot tier at a position', () => {
    const town = POIS.find((p) => p.name === 'Cinder Town');
    expect(poiAt(town.centre[0], town.centre[1]).name).toBe('Cinder Town');
    expect(lootTierAt(town.centre[0], town.centre[1])).toBe('major');
    expect(lootTierAt(1000, 1000)).toBe('outside');
  });

  it('gives Pine Forest the most trees and the Quarry the most rock (§6.1)', () => {
    const byTrees = Object.entries(BIOME_DENSITY).sort((a, b) => b[1].trees - a[1].trees);
    expect(byTrees[0][0]).toBe('pineForest');
    const byRocks = Object.entries(BIOME_DENSITY).sort((a, b) => b[1].rocks - a[1].rocks);
    expect(byRocks[0][0]).toBe('quarryBadlands');
  });

  it('classifies low ground as coastal', () => {
    expect(biomeAt(900, 900, 2)).toBe('coastal');
    expect(biomeAt(0, 0, 150)).toBe('emberMassif');
  });
});

describe('MASTER_SPEC §9 storm', () => {
  const makeStorm = (seed = 5) => new Storm(new RandomStream(seed));

  it('waits out the drop before the first phase', () => {
    const storm = makeStorm();
    expect(storm.phaseIndex).toBe(-1);
    storm.update(MATCH.dropDuration - 1);
    expect(storm.phaseIndex).toBe(-1);
    storm.update(2);
    expect(storm.phaseIndex).toBe(0);
  });

  it('starts with a circle covering the island', () => {
    const storm = makeStorm();
    expect(storm.radius).toBe(WORLD.initialSafeRadius);
    expect(Math.hypot(storm.centre.x, storm.centre.z))
      .toBeLessThanOrEqual(WORLD.initialCentreJitter * Math.SQRT2);
  });

  it('shrinks to the phase radius and closes to zero', () => {
    const storm = makeStorm();
    const dt = 1 / 30;
    let guard = 0;
    const total = STORM_PHASES.reduce((s, p) => s + p.wait + p.shrink, MATCH.dropDuration);
    while (!storm.isFinished && guard < (total + 60) * 30) {
      storm.update(dt);
      guard++;
    }
    expect(storm.isFinished).toBe(true);
    expect(storm.radius).toBeCloseTo(0, 5);
  });

  it('keeps each circle inside the previous one', () => {
    const storm = makeStorm(11);
    const dt = 1 / 30;
    for (let i = 0; i < 40 * 30; i++) {
      const before = { c: { ...storm.centre }, r: storm.radius };
      storm.update(dt);
      if (storm.targetRadius < before.r) {
        const offset = Math.hypot(storm.targetCentre.x - before.c.x, storm.targetCentre.z - before.c.z);
        expect(offset).toBeLessThanOrEqual(before.r - storm.targetRadius + 1e-6);
      }
    }
  });

  it('damages only outside the circle, on a 1 s cadence', () => {
    const storm = makeStorm();
    storm.update(MATCH.dropDuration + 0.1); // into phase 1
    storm.dps = 5;
    const far = WORLD.initialSafeRadius + 500;

    expect(storm.damageFor(1, 0, 0, 1 / 30)).toBe(0); // inside — no damage

    let ticks = 0;
    let damage = 0;
    for (let i = 0; i < 30; i++) {
      const d = storm.damageFor(1, far, far, 1 / 30);
      if (d > 0) { ticks++; damage += d; }
    }
    expect(ticks).toBe(1);      // exactly one tick per second
    expect(damage).toBe(5);
  });

  it('tracks the damage cadence per player', () => {
    const storm = makeStorm();
    storm.update(MATCH.dropDuration + 0.1);
    storm.dps = 3;
    const far = 5000;
    // Player 1 accumulates most of a second; player 2 should not inherit it.
    for (let i = 0; i < 29; i++) storm.damageFor(1, far, far, 1 / 30);
    expect(storm.damageFor(2, far, far, 1 / 30)).toBe(0);
  });

  it('reports inside and outside correctly', () => {
    const storm = makeStorm();
    expect(storm.isInside(storm.centre.x, storm.centre.z)).toBe(true);
    expect(storm.isInside(storm.centre.x + storm.radius + 1, storm.centre.z)).toBe(false);
  });

  it('never lowers the phase index', () => {
    const storm = makeStorm();
    let last = -1;
    for (let i = 0; i < 200 * 30 && !storm.isFinished; i++) {
      storm.update(1 / 30);
      expect(storm.phaseIndex).toBeGreaterThanOrEqual(last);
      last = storm.phaseIndex;
    }
    expect(storm.state).not.toBe(undefined);
    expect([StormState.WAITING, StormState.SHRINKING, StormState.FINISHED]).toContain(storm.state);
  });
});
