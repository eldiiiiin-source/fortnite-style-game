/**
 * MapLoader.js — reads the map manifest and produces the world. MAP_SPEC §10.
 *
 * Step 3 of the authoring workflow: read assets/maps/<name>.json, and where authored art
 * is absent fall back to TerrainGenerator and the §5.3 POI table (step 4).
 */
import { TerrainGenerator } from './TerrainGenerator.js';
import { POIS, POI_TIERS, BIOME_DENSITY, biomeAt } from './PointsOfInterest.js';
import { WORLD } from '../core/Config.js';
import { rollSpawnPoints } from '../loot/LootTables.js';

/** The manifest used when no file is supplied, mirroring assets/maps/cinder-isle.json. */
export const DEFAULT_MANIFEST = Object.freeze({
  name: WORLD.name,
  specVersion: '0.1.0',
  seed: 1337,
  heightmap: null,
  splatMap: null,
  dimensions: {
    playableExtent: WORLD.playableExtent,
    worldExtent: WORLD.worldExtent,
    seaLevel: WORLD.seaLevel,
    minHeight: WORLD.minHeight,
    maxHeight: WORLD.maxHeight
  },
  poiFiles: []
});

export class GameMap {
  constructor(manifest, terrain, pois) {
    this.manifest = manifest;
    this.terrain = terrain;
    this.pois = pois;
    this.procedural = manifest.heightmap === null;
  }

  get name() {
    return this.manifest.name;
  }

  heightAt(x, z) {
    return this.terrain.heightAt(x, z);
  }

  /**
   * Candidate loot spawn points for the whole map. Authored POI files supply their own;
   * a synthesised POI gets points scattered inside its footprint, in counts that land on
   * the §5.2 target after the §6.2 spawn roll.
   */
  spawnPoints(rng) {
    const points = [];

    for (const poi of this.pois) {
      if (poi.chestPoints) {
        // Authored layout — use it verbatim.
        for (const p of poi.chestPoints) points.push({ kind: 'chest', position: p, tier: poi.tier });
        for (const p of poi.floorLootPoints ?? []) points.push({ kind: 'floor', position: p, tier: poi.tier });
        for (const p of poi.ammoBoxPoints ?? []) points.push({ kind: 'ammoBox', position: p, tier: poi.tier });
        continue;
      }

      // Synthesised — scatter candidates to hit the tier's target after the spawn roll.
      const tier = POI_TIERS[poi.tier];
      const [chestMin, chestMax] = tier.chests;
      const [floorMin, floorMax] = tier.floorLoot;
      const chestCandidates = Math.ceil(((chestMin + chestMax) / 2) / 0.60);
      const floorCandidates = Math.ceil(((floorMin + floorMax) / 2) / 0.75);

      const scatter = (count, kind) => {
        for (let i = 0; i < count; i++) {
          const x = poi.centre[0] + rng.range(-poi.footprint[0] / 2, poi.footprint[0] / 2);
          const z = poi.centre[1] + rng.range(-poi.footprint[1] / 2, poi.footprint[1] / 2);
          points.push({ kind, position: [x, this.heightAt(x, z), z], tier: poi.tier });
        }
      };

      scatter(chestCandidates, 'chest');
      scatter(floorCandidates, 'floor');
      scatter(Math.ceil(chestCandidates / 2), 'ammoBox');
    }

    return points;
  }

  /** Roll which candidates actually spawn this match (MAP_SPEC §6.2). */
  rollLoot(rng) {
    return rollSpawnPoints(rng, this.spawnPoints(rng));
  }

  /**
   * Harvestable placements outside POI footprints, from the §6.1 biome densities.
   * Densities are per 100 m x 100 m cell.
   */
  harvestables(rng, { cellSize = 100 } = {}) {
    const out = [];
    const half = WORLD.playableExtent / 2;

    for (let z = -half; z < half; z += cellSize) {
      for (let x = -half; x < half; x += cellSize) {
        const cx = x + cellSize / 2;
        const cz = z + cellSize / 2;
        const height = this.heightAt(cx, cz);
        if (height < WORLD.seaLevel) continue;

        const biome = biomeAt(cx, cz, height);
        const density = BIOME_DENSITY[biome];
        if (!density) continue;

        const place = (count, kind) => {
          for (let i = 0; i < count; i++) {
            const px = x + rng.range(0, cellSize);
            const pz = z + rng.range(0, cellSize);
            const py = this.heightAt(px, pz);
            if (py < WORLD.seaLevel) continue;
            out.push({ kind, position: [px, py, pz], biome });
          }
        };

        place(density.trees, 'tree');
        place(density.rocks, 'boulder');
        place(density.metalObjects, rng.pick(['vehicle', 'container', 'streetlight']));
      }
    }

    return out;
  }
}

/**
 * Load a map. With no manifest URL, or with a manifest whose heightmap is null, terrain
 * is generated procedurally (§10 step 4).
 *
 * @param {object} opts
 * @param {string} [opts.url]       manifest URL, e.g. '/maps/cinder-isle.json'
 * @param {object} [opts.manifest]  a manifest object, bypassing the fetch
 * @param {number} [opts.seed]      overrides the manifest seed
 */
export async function loadMap({ url = null, manifest = null, seed = null } = {}) {
  let resolved = manifest ?? DEFAULT_MANIFEST;

  if (!manifest && url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      resolved = await response.json();
    } catch (err) {
      // A missing manifest is not fatal — the procedural island is the documented
      // fallback, so the game still starts (§10 step 4).
      console.warn(`Map manifest ${url} unavailable (${err.message}); generating procedurally.`);
      resolved = DEFAULT_MANIFEST;
    }
  }

  const mapSeed = seed ?? resolved.seed ?? DEFAULT_MANIFEST.seed;
  const terrain = new TerrainGenerator(mapSeed);

  // Authored POI files would be fetched here (§10 step 2). None exist yet, so the §5.3
  // table is the source.
  const pois = resolved.poiFiles?.length ? await loadPoiFiles(resolved.poiFiles) : POIS;

  return new GameMap(resolved, terrain, pois);
}

async function loadPoiFiles(files) {
  const loaded = await Promise.all(files.map(async (path) => {
    const response = await fetch(`/maps/${path}`);
    if (!response.ok) throw new Error(`POI file ${path}: HTTP ${response.status}`);
    return response.json();
  }));
  return loaded;
}
