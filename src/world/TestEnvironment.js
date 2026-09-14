/**
 * TestEnvironment.js — the compact gameplay validation region. MASTER_SPEC §22, MAP_SPEC §18.8.
 *
 * "Do NOT prioritise the full island yet. First create a compact polished test
 * environment... for gameplay validation."
 *
 * Terrain here follows MAP_SPEC §4: broad smooth forms only. There is deliberately NO
 * high-frequency detail layer — the spec bans "tiny procedural bumps" and "terrain that
 * catches the player", and a movement test region is exactly where that would corrupt the
 * results.
 *
 * Everything is sized in build modules so build scale and world scale cannot drift apart.
 */
import { TILE, WALL_H, MOVEMENT } from '../core/Config.js';
import { smoothstep, clamp } from '../core/MathUtils.js';

/** Region features, laid out in build-module multiples (§22). */
export const TEST_REGION = Object.freeze({
  /** Half-extent in metres — 40 tiles each way from the origin. */
  halfExtent: TILE * 40,

  /** Flat open field for movement and building chains. */
  field: { centre: [0, 0], radius: TILE * 12 },

  /** A broad smooth hill for elevation, slope traversal and high-ground fights. */
  hill: { centre: [TILE * 20, TILE * 14], radius: TILE * 14, height: WALL_H * 4 },

  /** A gentle ramp-like slope for step-up and slope-traversal testing. */
  slope: { centre: [-TILE * 18, TILE * 10], radius: TILE * 10, height: WALL_H * 2 },

  /** A shallow basin, for elevation change without a cliff. */
  basin: { centre: [-TILE * 6, -TILE * 18], radius: TILE * 9, depth: WALL_H * 0.9 },

  /** Stepped plateau — each step is exactly one step height, to validate auto step-up. */
  steps: { origin: [TILE * 6, -TILE * 10], count: 6, run: TILE * 0.5 }
});

export class TestEnvironment {
  constructor() {
    this.name = 'Test Region';
  }

  /**
   * Terrain height at a world point. Broad smooth forms, composed additively.
   * Deterministic and continuous — no noise, so movement tests measure the controller
   * rather than the terrain.
   */
  heightAt(x, z) {
    let h = 0;
    h += this._dome(x, z, TEST_REGION.hill);
    h += this._dome(x, z, TEST_REGION.slope);
    h -= this._dome(x, z, { ...TEST_REGION.basin, height: TEST_REGION.basin.depth });
    h += this._steps(x, z);
    return h;
  }

  /** A smooth dome — the "large rolling hill" primitive (§4). */
  _dome(x, z, { centre, radius, height }) {
    const d = Math.hypot(x - centre[0], z - centre[1]);
    if (d >= radius) return 0;
    // smoothstep gives zero gradient at both the rim and the summit, so there is no lip
    // to catch the player and no sudden slope change.
    return height * smoothstep(radius, 0, d);
  }

  /** A short flight of exact step-height risers, for auto step-up validation (§6). */
  _steps(x, z) {
    const [ox, oz] = TEST_REGION.steps.origin;
    const { count, run } = TEST_REGION.steps;
    const width = TILE * 2;
    if (z < oz || z > oz + width) return 0;
    const along = x - ox;
    if (along < 0) return 0;
    const index = Math.floor(along / run);
    if (index >= count) return count * MOVEMENT.stepHeight;
    return index * MOVEMENT.stepHeight;
  }

  /** No water in the test region yet — the water network is MAP_SPEC §5, a later phase. */
  waterDepthAt() {
    return 0;
  }

  /** Surface slope in degrees, for walkability checks. */
  slopeAt(x, z, eps = 0.5) {
    const hx = (this.heightAt(x + eps, z) - this.heightAt(x - eps, z)) / (2 * eps);
    const hz = (this.heightAt(x, z + eps) - this.heightAt(x, z - eps)) / (2 * eps);
    return Math.atan(Math.hypot(hx, hz)) * 180 / Math.PI;
  }

  isWalkable(x, z) {
    return this.slopeAt(x, z) <= MOVEMENT.maxWalkableSlopeDeg;
  }

  isInBounds(x, z) {
    return Math.abs(x) <= TEST_REGION.halfExtent && Math.abs(z) <= TEST_REGION.halfExtent;
  }

  /**
   * A safe, flat spawn point in the open field.
   *
   * Deliberately a CELL CENTRE, not the world origin. The origin is a build-grid corner,
   * and a player standing exactly on a cell boundary overlaps any wall placed on that
   * cell's face — which makes every build preview show as blocked. Spawning mid-cell is
   * the position a player would occupy in normal play.
   */
  spawnPoint() {
    const x = TILE / 2;
    const z = TILE / 2;
    return { x, y: this.heightAt(x, z), z };
  }

  /** Sample a chunk into a heightfield for meshing. */
  sampleChunk(originX, originZ, size, resolution = 33) {
    const heights = new Float32Array(resolution * resolution);
    const step = size / (resolution - 1);
    for (let j = 0; j < resolution; j++) {
      for (let i = 0; i < resolution; i++) {
        heights[j * resolution + i] = this.heightAt(originX + i * step, originZ + j * step);
      }
    }
    return { heights, resolution, size, origin: [originX, originZ] };
  }

  /**
   * Fixed layout for the validation region (§22). Deliberately sparse: MAP_SPEC §7 makes
   * open space intentional, and a cluttered test region would hide movement bugs rather
   * than expose them.
   *
   * Everything is placed in build-module multiples so structures line up with the grid.
   */
  layout() {
    const t = (n) => TILE * n;
    return {
      // Chests sit at each feature, so loot routes cross the whole region.
      chests: [
        { x: 0, z: t(-4) },
        { x: t(19), z: t(13) },       // hilltop
        { x: t(-17), z: t(9) },       // slope
        { x: t(-6), z: t(-17) },      // basin
        { x: t(8), z: t(-9) }         // by the steps
      ],
      ammoBoxes: [
        { x: t(3), z: t(3) },
        { x: t(-10), z: t(-4) },
        { x: t(14), z: t(6) }
      ],
      floorLoot: [
        { x: t(-2), z: t(2) },
        { x: t(6), z: t(-2) },
        { x: t(-13), z: t(5) },
        { x: t(17), z: t(10) }
      ],
      /** Harvestable props (§14). Kind maps to PICKAXE.harvestPerSwing. */
      props: [
        { kind: 'tree', material: 'wood', x: t(-4), z: t(6), total: 50 },
        { kind: 'tree', material: 'wood', x: t(-6), z: t(7), total: 50 },
        { kind: 'tree', material: 'wood', x: t(-5), z: t(9), total: 50 },
        { kind: 'rock', material: 'brick', x: t(9), z: t(4), total: 60 },
        { kind: 'rock', material: 'brick', x: t(11), z: t(6), total: 60 },
        { kind: 'vehicle', material: 'metal', x: t(2), z: t(-6), total: 70 },
        { kind: 'container', material: 'metal', x: t(4), z: t(-7), total: 90 }
      ],
      /** One or two bots, per §22. */
      botSpawns: [
        { x: t(10), z: t(2) },
        { x: t(-9), z: t(-6) }
      ],
      /** A simple interior: four walls and a roof opening, for indoor combat tests. */
      shelter: { centre: { x: t(-14), z: t(-12) }, size: 2 }
    };
  }

  /** Clamp a position into the region. */
  clampToBounds(x, z) {
    const e = TEST_REGION.halfExtent;
    return { x: clamp(x, -e, e), z: clamp(z, -e, e) };
  }
}
