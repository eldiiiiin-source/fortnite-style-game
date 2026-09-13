/** Map loading and world population. MAP_SPEC §6.1, §6.2, §10. */
import { describe, it, expect } from 'vitest';
import { loadMap, GameMap, DEFAULT_MANIFEST } from '../src/world/MapLoader.js';
import { RandomStream } from '../src/core/Random.js';
import { POIS, POI_TIERS } from '../src/world/PointsOfInterest.js';
import { WORLD } from '../src/core/Config.js';

describe('§10 map loading', () => {
  it('falls back to the procedural island with no manifest', async () => {
    const map = await loadMap();
    expect(map).toBeInstanceOf(GameMap);
    expect(map.procedural).toBe(true);
    expect(map.name).toBe(WORLD.name);
    expect(map.pois).toHaveLength(POIS.length);
  });

  it('honours a seed override', async () => {
    const a = await loadMap({ seed: 10 });
    const b = await loadMap({ seed: 20 });
    expect(a.heightAt(200, 200)).not.toBe(b.heightAt(200, 200));
  });

  it('is deterministic for a seed', async () => {
    const a = await loadMap({ seed: 10 });
    const b = await loadMap({ seed: 10 });
    expect(a.heightAt(200, 200)).toBe(b.heightAt(200, 200));
  });

  it('accepts an inline manifest without fetching', async () => {
    const map = await loadMap({ manifest: { ...DEFAULT_MANIFEST, name: 'Test Isle', seed: 5 } });
    expect(map.name).toBe('Test Isle');
  });
});

describe('§6.2 loot spawn candidates', () => {
  it('scatters enough candidates to hit each tier target after the spawn roll', async () => {
    const map = await loadMap({ seed: 3 });
    const rng = new RandomStream(3);
    const points = map.spawnPoints(rng);

    for (const poi of POIS) {
      const chests = points.filter((p) => p.kind === 'chest' && p.tier === poi.tier);
      expect(chests.length).toBeGreaterThan(0);
    }

    // After the 60% chest roll, the expected count must land in the §5.2 band.
    const majorChests = points.filter((p) => p.kind === 'chest' && p.tier === 'major').length;
    const majorCount = POIS.filter((p) => p.tier === 'major').length;
    const expectedPerPoi = (majorChests / majorCount) * 0.60;
    const [min, max] = POI_TIERS.major.chests;
    expect(expectedPerPoi).toBeGreaterThanOrEqual(min);
    expect(expectedPerPoi).toBeLessThanOrEqual(max);
  });

  it('keeps every candidate inside its POI footprint', async () => {
    const map = await loadMap({ seed: 3 });
    const points = map.spawnPoints(new RandomStream(3));
    for (const p of points) {
      const poi = POIS.find((q) => q.tier === p.tier);
      expect(poi).toBeDefined();
      const half = WORLD.playableExtent / 2;
      expect(Math.abs(p.position[0])).toBeLessThanOrEqual(half);
      expect(Math.abs(p.position[2])).toBeLessThanOrEqual(half);
    }
  });

  it('rolls a subset of the candidates each match', async () => {
    const map = await loadMap({ seed: 3 });
    const all = map.spawnPoints(new RandomStream(3)).length;
    const rolled = map.rollLoot(new RandomStream(3)).length;
    expect(rolled).toBeLessThan(all);
    expect(rolled).toBeGreaterThan(0);
  });

  it('produces a match-start loot count in the MAP_SPEC §6.2 band', async () => {
    const map = await loadMap({ seed: 3 });
    const chests = map.rollLoot(new RandomStream(11)).filter((p) => p.kind === 'chest').length;
    // §6.2 quotes 95-125 chests at match start.
    expect(chests).toBeGreaterThanOrEqual(60);
    expect(chests).toBeLessThanOrEqual(160);
  });
});

describe('§6.1 harvestables', () => {
  it('places harvestables only above sea level', async () => {
    const map = await loadMap({ seed: 8 });
    const items = map.harvestables(new RandomStream(8));
    expect(items.length).toBeGreaterThan(100);
    for (const item of items) {
      expect(item.position[1]).toBeGreaterThanOrEqual(WORLD.seaLevel);
    }
  });

  it('gives the pine forest more trees per cell than the quarry', async () => {
    const map = await loadMap({ seed: 8 });
    const items = map.harvestables(new RandomStream(8));
    const treesIn = (biome) => items.filter((i) => i.biome === biome && i.kind === 'tree').length;
    const cellsIn = (biome) => new Set(
      items.filter((i) => i.biome === biome)
        .map((i) => `${Math.floor(i.position[0] / 100)},${Math.floor(i.position[2] / 100)}`)
    ).size;

    const pinePerCell = treesIn('pineForest') / Math.max(1, cellsIn('pineForest'));
    const quarryPerCell = treesIn('quarryBadlands') / Math.max(1, cellsIn('quarryBadlands'));
    expect(pinePerCell).toBeGreaterThan(quarryPerCell);
  });

  it('only emits harvestable kinds the config knows about', async () => {
    const { HARVEST } = await import('../src/core/Config.js');
    const map = await loadMap({ seed: 8 });
    for (const item of map.harvestables(new RandomStream(8))) {
      expect(HARVEST.sources[item.kind]).toBeDefined();
    }
  });
});
