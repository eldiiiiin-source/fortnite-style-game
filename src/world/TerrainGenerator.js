/**
 * TerrainGenerator.js — procedural island fallback. MAP_SPEC §4.1, §10 step 4.
 *
 * Used until an authored heightmap exists in assets/maps/. Produces the same island for
 * the same seed on every platform.
 */
import { WORLD, TERRAIN_NOISE, MOVEMENT } from '../core/Config.js';
import { clamp, smoothstep, RAD2DEG } from '../core/MathUtils.js';
import { fbm, ridgedFbm } from './Noise.js';
import { POIS } from './PointsOfInterest.js';

export class TerrainGenerator {
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this._cache = new Map();
  }

  /** Radial island falloff: 1.0 at the centre, 0.0 at the falloff radius (§4.1). */
  islandFalloff(x, z) {
    const r = Math.hypot(x, z);
    return 1 - smoothstep(TERRAIN_NOISE.falloffRadius * 0.45, TERRAIN_NOISE.falloffRadius, r);
  }

  /** Mask that confines the ridge layer to the central massif (MAP_SPEC §5.1). */
  massifMask(x, z) {
    const r = Math.hypot(x, z);
    return 1 - smoothstep(120, 520, r);
  }

  /** Raw generated height before POI flattening. */
  baseHeight(x, z) {
    const { base, ridge, detail } = TERRAIN_NOISE;

    const falloff = this.islandFalloff(x, z);
    if (falloff <= 0) return WORLD.minHeight;

    const b = (fbm(this.seed, x, z, base) * 0.5 + 0.5) * base.amplitude;
    const r = ridgedFbm(this.seed + 1013, x, z, ridge) * ridge.amplitude * this.massifMask(x, z);
    const d = fbm(this.seed + 2027, x, z, detail) * detail.amplitude;

    const raw = (b + r + d) * falloff;
    // Below the falloff, blend down to the ocean floor rather than clipping.
    const oceanBlend = (1 - falloff) * WORLD.minHeight;
    return clamp(raw + oceanBlend, WORLD.minHeight, WORLD.maxHeight);
  }

  /**
   * Final terrain height, with POI footprints flattened to their base elevation and a
   * blend skirt (§4.1, §5.3).
   */
  heightAt(x, z) {
    let h = this.baseHeight(x, z);

    for (const poi of POIS) {
      const halfX = poi.footprint[0] / 2;
      const halfZ = poi.footprint[1] / 2;
      const dx = Math.abs(x - poi.centre[0]);
      const dz = Math.abs(z - poi.centre[1]);
      const skirt = TERRAIN_NOISE.poiBlendSkirt;

      if (dx > halfX + skirt || dz > halfZ + skirt) continue;

      // 1 inside the footprint, easing to 0 across the skirt.
      const wx = 1 - smoothstep(halfX, halfX + skirt, dx);
      const wz = 1 - smoothstep(halfZ, halfZ + skirt, dz);
      const w = wx * wz;
      h = h * (1 - w) + poi.base * w;
    }

    return h;
  }

  /** Surface normal by central difference, for slope tests (§4.2). */
  normalAt(x, z, eps = 1.0) {
    const hL = this.heightAt(x - eps, z);
    const hR = this.heightAt(x + eps, z);
    const hD = this.heightAt(x, z - eps);
    const hU = this.heightAt(x, z + eps);
    const nx = hL - hR;
    const nz = hD - hU;
    const ny = 2 * eps;
    const len = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / len, y: ny / len, z: nz / len };
  }

  /** Slope in degrees from vertical. */
  slopeAt(x, z) {
    const n = this.normalAt(x, z);
    return Math.acos(clamp(n.y, -1, 1)) * RAD2DEG;
  }

  /** §4.2 — slopes above 48° are not walkable and the player slides. */
  isWalkable(x, z) {
    return this.slopeAt(x, z) <= MOVEMENT.maxWalkableSlopeDeg;
  }

  isUnderwater(x, z) {
    return this.heightAt(x, z) < WORLD.seaLevel;
  }

  /** Water depth at a point, 0 on land. MAP_SPEC §4.3 */
  waterDepth(x, z) {
    return Math.max(0, WORLD.seaLevel - this.heightAt(x, z));
  }

  /** Is this point outside the playable square? MAP_SPEC §3.1 */
  isOutOfBounds(x, z) {
    const half = WORLD.playableExtent / 2;
    return Math.abs(x) > half || Math.abs(z) > half;
  }

  /**
   * Sample a chunk into a Float32Array heightfield for meshing/collision (§9).
   * @returns {{size:number, resolution:number, heights:Float32Array, origin:[number,number]}}
   */
  sampleChunk(chunkX, chunkZ, resolution = 33) {
    const size = WORLD.chunkSize;
    const ox = chunkX * size;
    const oz = chunkZ * size;
    const heights = new Float32Array(resolution * resolution);
    const step = size / (resolution - 1);

    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        heights[j * resolution + i] = this.heightAt(ox + i * step, oz + j * step);
      }
    }
    return { size, resolution, heights, origin: [ox, oz] };
  }
}
