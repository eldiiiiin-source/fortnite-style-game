/**
 * Island.js — the first playable island. MAP_SPEC §20.
 *
 * Replaces the flat validation region with an authored landmass: rolling hills, a cliff
 * edge, a river running to the coast, a lake, a road network joining six POIs, and the
 * surface types that let the terrain, the minimap and the vegetation layer agree about
 * where all of it is.
 *
 * API COMPATIBILITY: this exposes exactly the surface `TestEnvironment` did — `heightAt`,
 * `waterDepthAt`, `slopeAt`, `isWalkable`, `isInBounds`, `spawnPoint`, `sampleChunk`,
 * `layout`, `clampToBounds` — because Game, Bot, PlayerController, Renderer, MapView and
 * AdminService all consume it. Nothing else had to change to swap the world.
 *
 * TERRAIN IS AUTHORED, NOT NOISE (§4, §20.2). Every form is a named smooth primitive with
 * zero gradient at its rim, so nothing catches the player. The one broad roll layered over
 * everything is capped well under a step height, so it shapes the light without ever
 * affecting movement.
 *
 * Pure logic: no three.js, no DOM. Runs in Node under Vitest.
 */
import { TILE, WALL_H, MOVEMENT, WORLD } from '../core/Config.js';
import { smoothstep, clamp } from '../core/MathUtils.js';
import { resolveDressing, resolveLoot, footprintBounds, originFor } from './IslandStructures.js';

const t = (n) => TILE * n;
const w = (n) => WALL_H * n;

/** Surface types the terrain reports (§20.5). */
export const Surface = Object.freeze({
  GRASS: 'grass',
  FIELD: 'field',
  DIRT: 'dirt',
  SAND: 'sand',
  ROCK: 'rock',
  ROAD: 'road'
});

/* ── island form — MAP_SPEC §20.2 ────────────────────────────────────────── */

/**
 * Landforms, in build-module multiples. Ordered rim-outward so the composition reads:
 * a high shoulder in the north-east, a cliff bluff west, plateaus for fighting on, and
 * basins that the water finds.
 */
export const LANDFORMS = Object.freeze({
  /** The island's own dome: everything sits on this, and it falls away to the sea. */
  shelf: { centre: [0, 0], radius: t(80), height: w(3.4), flat: 0.62 },

  hills: [
    { centre: [t(30), t(26)], radius: t(26), height: w(5.2) },   // north-east high ground
    { centre: [t(-34), t(-8)], radius: t(22), height: w(4.0) },  // west bluff
    { centre: [t(6), t(-40)], radius: t(20), height: w(3.0) },   // south rise
    { centre: [t(-14), t(36)], radius: t(16), height: w(2.2) }   // north knoll
  ],

  /** Flat ground deliberately kept flat: these are the build-fight arenas. */
  plateaus: [
    { centre: [t(30), t(26)], radius: t(9), height: w(0.5) },
    { centre: [t(-2), t(4)], radius: t(13), height: 0 }
  ],

  /** Basins: the lake sits in one, the others just break up the skyline. */
  basins: [
    // The lake bowl. Kept clear of Hollow Farm: a POI inside a basin floods.
    { centre: [t(-26), t(36)], radius: t(15), depth: w(2.6) },
    { centre: [t(34), t(-34)], radius: t(12), depth: w(1.1) }
  ],

  /** The cliff: a steep step on the bluff's seaward face, for a real vertical read. */
  cliff: { from: [t(-46), t(-2)], to: [t(-30), t(18)], drop: w(3.2), width: t(2), reach: t(12) }
});

/** The river, as a polyline from the north-east high ground to the south-west coast. */
export const RIVER = Object.freeze({
  points: [
    [t(34), t(40)], [t(24), t(28)], [t(14), t(18)], [t(8), t(6)],
    [t(2), t(-6)], [t(-8), t(-16)], [t(-20), t(-26)], [t(-34), t(-38)]
  ],
  halfWidth: t(2.4),
  bankWidth: t(3.2),
  depth: w(0.9)
});

/** The lake, in the north-west basin. */
export const LAKE = Object.freeze({
  centre: [t(-26), t(36)], radius: t(11), bank: t(4), depth: w(1.0)
});

/** Roads joining the POIs (§20.4). Each is a polyline; the terrain flattens under it. */
export const ROADS = Object.freeze([
  { id: 'spine', points: [[t(-44), t(-30)], [t(-20), t(-14)], [t(0), t(-2)], [t(20), t(12)], [t(36), t(30)]] },
  { id: 'farmLane', points: [[t(0), t(-2)], [t(-16), t(8)], [t(-28), t(16)]] },
  { id: 'yardSpur', points: [[t(20), t(12)], [t(26), t(-4)], [t(22), t(-20)]] },
  { id: 'dockPath', points: [[t(0), t(-2)], [t(-6), t(-14)], [t(-14), t(-22)]] }
]);

const ROAD_HALF_WIDTH = t(1.1);
const ROAD_BLEND = t(2.0);
/** How deep a road's river crossing sits. Well under swim depth, so a ford is walkable. */
const FORD_DEPTH = MOVEMENT.stepHeight * 0.7;

/* ── geometry helpers ────────────────────────────────────────────────────── */

/** Distance from a point to a polyline, and the parameter of the closest point. */
function distanceToPolyline(x, z, points) {
  let best = Infinity;
  let bestT = 0;
  let bestIndex = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, az] = points[i];
    const [bx, bz] = points[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    const u = lengthSq === 0 ? 0 : clamp(((x - ax) * dx + (z - az) * dz) / lengthSq, 0, 1);
    const px = ax + dx * u;
    const pz = az + dz * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bestT = u;
      bestIndex = i;
    }
  }
  return { distance: best, t: bestT, index: bestIndex };
}

/**
 * A mesa — flat on top, falling smoothly to nothing at the rim.
 *
 * The island shelf needs this rather than a dome: a dome's height falls away from the
 * centre everywhere, so the outer half of the landmass slides under the sea and the
 * playable area collapses to a small cap. A mesa gives a broad landmass with a coastal
 * ring, which is the shape an island actually is.
 */
function mesa(x, z, { centre, radius, height, flat = 0.55 }) {
  const d = Math.hypot(x - centre[0], z - centre[1]);
  if (d >= radius) return 0;
  const inner = radius * flat;
  if (d <= inner) return height;
  return height * smoothstep(radius, inner, d);
}

/** A smooth dome — the rolling-hill primitive (§4). */
function dome(x, z, { centre, radius, height }) {
  const d = Math.hypot(x - centre[0], z - centre[1]);
  if (d >= radius) return 0;
  // smoothstep gives zero gradient at both rim and summit: no lip, no sudden slope change.
  return height * smoothstep(radius, 0, d);
}

export class Island {
  constructor() {
    this.name = 'Verdant Reach';
    /** Consumed by Game for the drop route and the storm's region sizing. */
    this.regionExtent = WORLD.regionExtent;
    this.halfExtent = WORLD.regionExtent / 2;
    this._layout = null;
    this._pads = null;
  }

  /**
   * Terrain height BEFORE POI levelling — shelf, water carve, roads.
   *
   * Exists so a POI's pad can be placed without asking for the height that the pad itself
   * defines. Water carving and road flattening already ran, which is all the pad placement
   * needs to know: where the river is, and where the roads went.
   */
  _preLevelHeight(x, z) {
    return this._flattenRoads(x, z, this._carveWater(x, z, this._baseHeight(x, z)));
  }

  /**
   * Each POI's flat pad: where its buildings actually settle, and how far they reach.
   *
   * Computed once, lazily, against `_preLevelHeight` — never against `heightAt`, which
   * would recurse straight back into the levelling this is feeding.
   */
  get pads() {
    if (this._pads) return this._pads;
    const preLevel = {
      heightAt: (x, z) => this._preLevelHeight(x, z),
      waterDepthAt: (x, z) => Math.max(0, WORLD.seaLevel - this._preLevelHeight(x, z))
    };
    this._pads = POIS.map((poi) => {
      const { ox, oz } = originFor(poi, preLevel);
      const bounds = footprintBounds(poi.blueprint);
      // The pad follows the SETTLED footprint, not the POI marker: Pumpjack Stop's buildings
      // step 29 m off their marker to get out of the ford, and a pad centred on the marker
      // would leave them on natural slope again.
      const raw = this._baseHeight(poi.centre[0], poi.centre[1]);
      return {
        centre: [(ox + bounds.cx) * TILE, (oz + bounds.cz) * TILE],
        core: bounds.radius,
        height: Math.round(raw / WALL_H) * WALL_H
      };
    });
    return this._pads;
  }

  /* ── height ────────────────────────────────────────────────────────────── */

  /**
   * Terrain height at a world point.
   *
   * Composed in one order, every time: island shelf, hills, plateaus, basins, cliff, the
   * broad roll, then water carving, then road flattening. Water and roads come LAST
   * because they must win — a road that a hill pokes through is not a road.
   */
  heightAt(x, z) {
    let h = this._baseHeight(x, z);
    h = this._carveWater(x, z, h);
    h = this._flattenRoads(x, z, h);
    h = this._levelPois(x, z, h);
    return h;
  }

  /**
   * Level the ground under a POI toward its centre height (§20.7).
   *
   * Without this, a building on a slope is buried on its uphill side and stilted on its
   * downhill side, because the build grid is discrete in storeys while the terrain is not.
   * It also gives each POI the flat ground the spec asks for — somewhere to build.
   *
   * The flat core must cover the POI's FOOTPRINT, not a fixed fraction of its radius.
   * Kettle Row is a 13-cell street — 67 m of houses on a 28 m pad — so its far houses stood
   * on natural slope and sank 7.3 m into the hill, leaving only their roofs above ground.
   */
  _levelPois(x, z, h) {
    // Never level carved water back up. POI levelling ran after the carve, so a POI whose
    // footprint clipped the river quietly filled it in — the river simply stopped.
    if (h < WORLD.seaLevel) return h;

    // Where two POIs' pads overlap they are averaged by an influence weight, not picked
    // between. Blending them in sequence is order-dependent and let a neighbour drag this
    // POI's ground toward its own; picking the nearest outright is order-independent but
    // DISCONTINUOUS — the winner flips along a line and leaves a one-storey cliff, which cut
    // the yard spur road in half. The weight diverges as k approaches 1, so inside a POI's
    // own core its pad still wins outright and its ground stays dead flat.
    let weight = 0;
    let weighted = 0;
    let strongest = 0;
    for (const pad of this.pads) {
      const d = Math.hypot(x - pad.centre[0], z - pad.centre[1]);
      // The apron has to carry the whole drop from pad to natural ground at a walkable
      // grade. Crown Post's pad stands 11.5 m above the countryside, and a short apron put
      // the spine road onto a 59° ramp — past MOVEMENT.maxWalkableSlopeDeg, so the road
      // simply stopped being a road.
      const edge = pad.core * 3.0;
      if (d >= edge) continue;

      const k = smoothstep(edge, pad.core, d);
      if (k >= 1) return pad.height;

      const w = (k * k) / (1 - k);
      weight += w;
      weighted += w * pad.height;
      strongest = Math.max(strongest, k);
    }
    if (weight === 0) return h;

    return h * (1 - strongest) + (weighted / weight) * strongest;
  }

  _baseHeight(x, z) {
    let h = mesa(x, z, LANDFORMS.shelf) - w(0.55);

    for (const hill of LANDFORMS.hills) h += dome(x, z, hill);
    for (const plateau of LANDFORMS.plateaus) h += dome(x, z, plateau);
    for (const basin of LANDFORMS.basins) {
      h -= dome(x, z, { centre: basin.centre, radius: basin.radius, height: basin.depth });
    }

    h += this._cliff(x, z);
    h += this._roll(x, z);
    return h;
  }

  /**
   * A steep seaward step on the bluff (§20.2).
   *
   * Still smoothstepped across its width: "cliff" here means a strong vertical read from a
   * distance, not a wall the controller has to special-case.
   */
  _cliff(x, z) {
    const { from, to, drop, width, reach } = LANDFORMS.cliff;
    const dx = to[0] - from[0];
    const dz = to[1] - from[1];
    const length = Math.hypot(dx, dz);
    if (length === 0) return 0;

    // BOUNDED FOOTPRINT FIRST. A signed-distance step saturates to ±drop/2 across an
    // entire half-plane, so on its own it silently lifts everything on one side of the
    // line — including ocean hundreds of metres away, which is what put a wedge of land
    // off the island's north-east corner.
    const { distance } = distanceToPolyline(x, z, [from, to]);
    if (distance >= reach) return 0;

    // Within the footprint: a smooth step across the line, faded out at the rim so the
    // bluff returns to the surrounding terrain instead of ending in a wall.
    const signed = ((x - from[0]) * dz - (z - from[1]) * dx) / length;
    const falloff = smoothstep(reach, reach * 0.45, distance);
    return drop * (smoothstep(-width, width, signed) - 0.5) * falloff;
  }

  /**
   * One broad, long-wavelength roll over the whole island.
   *
   * Amplitude is capped at a third of a step height, so it shapes the light and keeps the
   * ground from reading as billiard-table flat without ever being something the player
   * can feel. This is the only periodic term in the terrain, and it is deliberately far
   * too smooth to be the "tiny procedural bumps" §4 bans.
   */
  _roll(x, z) {
    const amplitude = MOVEMENT.stepHeight * 0.33;
    return amplitude * (
      Math.sin(x / t(11)) * Math.cos(z / t(13)) * 0.6
      + Math.sin((x + z) / t(19)) * 0.4
    );
  }

  /** Carve the river channel and the lake bowl below sea level (§20.3). */
  _carveWater(x, z, h) {
    let out = h;

    const river = distanceToPolyline(x, z, RIVER.points);
    if (river.distance < RIVER.halfWidth + RIVER.bankWidth) {
      const bed = -RIVER.depth;
      // Inside the channel the bed wins outright; across the bank it blends, which is what
      // makes the shoreline a graded edge rather than a step (§20.3).
      const k = smoothstep(RIVER.halfWidth + RIVER.bankWidth, RIVER.halfWidth, river.distance);
      out = out * (1 - k) + bed * k;
    }

    const lakeDistance = Math.hypot(x - LAKE.centre[0], z - LAKE.centre[1]);
    if (lakeDistance < LAKE.radius + LAKE.bank) {
      const bed = -LAKE.depth;
      const k = smoothstep(LAKE.radius + LAKE.bank, LAKE.radius, lakeDistance);
      out = out * (1 - k) + bed * k;
    }

    return out;
  }

  /**
   * Flatten the terrain under a road toward the road's own centreline height (§20.4).
   *
   * The centreline height is sampled from the UNCARVED base terrain at the nearest
   * segment's endpoints, so a road keeps a constant, walkable gradient instead of
   * inheriting whatever the hills underneath were doing.
   */
  _flattenRoads(x, z, h) {
    let out = h;
    for (const road of ROADS) {
      const { distance, t: u, index } = distanceToPolyline(x, z, road.points);
      if (distance >= ROAD_HALF_WIDTH + ROAD_BLEND) continue;

      const a = road.points[index];
      const b = road.points[index + 1];
      const ha = this._baseHeight(a[0], a[1]);
      const hb = this._baseHeight(b[0], b[1]);
      const centreHeight = ha + (hb - ha) * u;

      // Where a road meets water it FORDS rather than fills: raising the bed to the road
      // severs the river, which reads as a broken map from the air. A shallow crossing
      // keeps the river continuous and gives rotations a natural place to cross.
      const target = out < WORLD.seaLevel
        ? Math.min(centreHeight, WORLD.seaLevel - FORD_DEPTH)
        : centreHeight;

      const k = smoothstep(ROAD_HALF_WIDTH + ROAD_BLEND, ROAD_HALF_WIDTH, distance);
      out = out * (1 - k) + target * k;
    }
    return out;
  }

  /* ── water ─────────────────────────────────────────────────────────────── */

  /** Depth of standing water at a point — 0 on dry land. */
  waterDepthAt(x, z) {
    const h = this.heightAt(x, z);
    return h < WORLD.seaLevel ? WORLD.seaLevel - h : 0;
  }

  /* ── surfaces — MAP_SPEC §20.5 ─────────────────────────────────────────── */

  /**
   * What the ground is made of at a point.
   *
   * One function, consumed by BOTH the terrain mesh and the minimap, so the map can never
   * disagree with the world about where the river or the roads are.
   */
  surfaceAt(x, z) {
    for (const road of ROADS) {
      if (distanceToPolyline(x, z, road.points).distance < ROAD_HALF_WIDTH + ROAD_BLEND * 0.4) {
        return Surface.ROAD;
      }
    }

    const h = this.heightAt(x, z);
    if (h < WORLD.seaLevel) return Surface.SAND;      // riverbed and lakebed read as sand
    if (h < WORLD.seaLevel + w(0.22)) return Surface.SAND;   // the shoreline band

    if (this.slopeAt(x, z) > 34) return Surface.ROCK;

    for (const poi of POIS) {
      // Only the levelled CORE takes the POI's surface. Painting the full radius turns a
      // farm into a desert and swamps the island's colour balance.
      if (poi.surface && Math.hypot(x - poi.centre[0], z - poi.centre[1]) < poi.radius * 0.5) {
        return poi.surface;
      }
    }

    if (h > w(4.6)) return Surface.ROCK;
    return Surface.GRASS;
  }

  /* ── slopes and bounds ─────────────────────────────────────────────────── */

  slopeAt(x, z, eps = 0.5) {
    const hx = (this.heightAt(x + eps, z) - this.heightAt(x - eps, z)) / (2 * eps);
    const hz = (this.heightAt(x, z + eps) - this.heightAt(x, z - eps)) / (2 * eps);
    return Math.atan(Math.hypot(hx, hz)) * 180 / Math.PI;
  }

  isWalkable(x, z) {
    return this.slopeAt(x, z) <= MOVEMENT.maxWalkableSlopeDeg;
  }

  isInBounds(x, z) {
    return Math.abs(x) <= this.halfExtent && Math.abs(z) <= this.halfExtent;
  }

  clampToBounds(x, z) {
    const e = this.halfExtent;
    return { x: clamp(x, -e, e), z: clamp(z, -e, e) };
  }

  /**
   * Spawn on the central plateau.
   *
   * Deliberately a CELL CENTRE, not a grid corner: a player standing exactly on a cell
   * boundary overlaps any wall placed on that cell's face, which makes every build preview
   * read as blocked.
   */
  spawnPoint() {
    const x = t(-2) + TILE / 2;
    const z = t(4) + TILE / 2;
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

  /* ── contents ──────────────────────────────────────────────────────────── */

  /**
   * Everything placed on the island. Cached: the layout is authored and deterministic, and
   * Game asks for it once per match.
   */
  layout() {
    if (!this._layout) this._layout = buildLayout(this);
    return this._layout;
  }

  /** The POI table, for anything that wants to name a place. */
  get pois() {
    return POIS;
  }
}

/* ── POIs — MAP_SPEC §20.7 ───────────────────────────────────────────────── */

/**
 * Six original locations. `structures` are build-piece blueprints (§20.1) resolved by
 * `IslandStructures.js`; everything else here is loot and dressing.
 */
export const POIS = Object.freeze([
  {
    id: 'hollowFarm',
    name: 'Hollow Farm',
    centre: [t(-28), t(16)],
    radius: t(13),
    surface: Surface.FIELD,
    blueprint: 'farm'
  },
  {
    id: 'pumpjackStop',
    name: 'Pumpjack Stop',
    centre: [t(0), t(-2)],
    radius: t(9),
    surface: Surface.DIRT,
    blueprint: 'serviceStop'
  },
  {
    id: 'kettleRow',
    name: 'Kettle Row',
    centre: [t(20), t(12)],
    radius: t(11),
    surface: Surface.DIRT,
    blueprint: 'houseRow'
  },
  {
    id: 'riverwatch',
    name: 'Riverwatch',
    centre: [t(-14), t(-22)],
    radius: t(8),
    surface: null,
    blueprint: 'dock',
    /** On the waterline by design — the dock is the point of it (§20.7). */
    waterside: true
  },
  {
    id: 'crownPost',
    name: 'Crown Post',
    centre: [t(36), t(30)],
    radius: t(8),
    surface: Surface.DIRT,
    blueprint: 'outpost'
  },
  {
    id: 'drayYard',
    name: 'Dray Yard',
    centre: [t(22), t(-20)],
    radius: t(10),
    surface: Surface.DIRT,
    blueprint: 'warehouse'
  }
]);

/* ── vegetation — MAP_SPEC §20.6 ─────────────────────────────────────────── */

/**
 * Authored clusters, not a uniform scatter (§9). Each is a centre, a radius and a count;
 * placement inside one is a deterministic spiral, and anything landing on a road, in water
 * or inside a POI is dropped rather than nudged — a tree half in a road reads worse than
 * a slightly thinner wood.
 */
const TREE_CLUSTERS = [
  { centre: [t(-12), t(28)], radius: t(10), count: 26 },
  { centre: [t(12), t(34)], radius: t(9), count: 20 },
  { centre: [t(-38), t(4)], radius: t(9), count: 18 },
  { centre: [t(-4), t(-32)], radius: t(11), count: 24 },
  { centre: [t(34), t(2)], radius: t(8), count: 16 },
  { centre: [t(-30), t(-16)], radius: t(7), count: 12 },
  { centre: [t(16), t(-34)], radius: t(8), count: 14 }
];

const ROCK_CLUSTERS = [
  { centre: [t(-40), t(-6)], radius: t(7), count: 10 },
  { centre: [t(38), t(18)], radius: t(6), count: 8 },
  { centre: [t(4), t(-44)], radius: t(6), count: 7 },
  { centre: [t(-18), t(40)], radius: t(5), count: 6 }
];

const BUSH_CLUSTERS = [
  { centre: [t(-20), t(10)], radius: t(12), count: 20 },
  { centre: [t(10), t(20)], radius: t(12), count: 20 },
  { centre: [t(-8), t(-20)], radius: t(12), count: 18 },
  { centre: [t(28), t(-8)], radius: t(10), count: 14 }
];

/** Deterministic point-in-disc spiral. No RNG: the island must be identical every run. */
function* spiral(cluster) {
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < cluster.count; i++) {
    const r = cluster.radius * Math.sqrt((i + 0.5) / cluster.count);
    const a = i * golden;
    yield [cluster.centre[0] + Math.cos(a) * r, cluster.centre[1] + Math.sin(a) * r];
  }
}

/** Is this a spot vegetation may stand on? */
function plantable(island, x, z) {
  if (!island.isInBounds(x, z)) return false;
  if (island.waterDepthAt(x, z) > 0) return false;
  if (island.surfaceAt(x, z) === Surface.ROAD) return false;
  if (!island.isWalkable(x, z)) return false;
  for (const poi of POIS) {
    if (Math.hypot(x - poi.centre[0], z - poi.centre[1]) < poi.radius * 0.85) return false;
  }
  return true;
}

/* ── layout assembly ─────────────────────────────────────────────────────── */

function buildLayout(island) {
  const trees = [];
  const rocks = [];
  const bushes = [];

  let n = 0;
  for (const cluster of TREE_CLUSTERS) {
    for (const [x, z] of spiral(cluster)) {
      if (!plantable(island, x, z)) continue;
      // Three sizes, cycled deterministically: a wood of identical trees reads as wallpaper.
      trees.push({ x, z, scale: 0.85 + (n % 3) * 0.22, variant: n % 3 });
      n++;
    }
  }
  let m = 0;
  for (const cluster of ROCK_CLUSTERS) {
    for (const [x, z] of spiral(cluster)) {
      if (!plantable(island, x, z)) continue;
      rocks.push({ x, z, scale: 0.8 + (m % 4) * 0.25, variant: m % 2 });
      m++;
    }
  }
  let b = 0;
  for (const cluster of BUSH_CLUSTERS) {
    for (const [x, z] of spiral(cluster)) {
      if (!plantable(island, x, z)) continue;
      bushes.push({ x, z, scale: 0.7 + (b % 3) * 0.2 });
      b++;
    }
  }

  // Harvestable props: a readable subset of the vegetation, plus yard metal. Keeping the
  // harvestable set smaller than the visual set is deliberate — every tree being a
  // resource turns a wood into a chore.
  const props = [];
  trees.forEach((tree, i) => {
    if (i % 3 === 0) props.push({ kind: 'tree', material: 'wood', x: tree.x, z: tree.z, total: 50 });
  });
  rocks.forEach((rock, i) => {
    if (i % 2 === 0) props.push({ kind: 'rock', material: 'brick', x: rock.x, z: rock.z, total: 60 });
  });
  for (const poi of POIS) {
    props.push({
      kind: poi.id === 'drayYard' ? 'container' : 'vehicle',
      material: 'metal',
      x: poi.centre[0] + t(4),
      z: poi.centre[1] - t(3),
      total: poi.id === 'drayYard' ? 90 : 70
    });
  }

  // Loot is AUTHORED per POI (§21.5), not scattered in a ring: a loot route is only a
  // route if the pieces are in rooms and on floors a player has to choose between.
  const { chests, ammoBoxes, floorLoot } = resolveLoot(POIS, island);

  // Prop dressing — visual only (§21.6).
  const dressing = resolveDressing(POIS, island);

  // Bots start spread around the island, on dry walkable ground.
  const botSpawns = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const r = t(26) + (i % 3) * t(8);
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (plantable(island, x, z)) botSpawns.push({ x, z });
  }
  if (botSpawns.length === 0) botSpawns.push({ x: t(6), z: t(6) });

  return {
    chests,
    ammoBoxes,
    floorLoot,
    dressing,
    props,
    botSpawns,
    trees,
    rocks,
    bushes,
    pois: POIS,
    roads: ROADS,
    river: RIVER,
    lake: LAKE
  };
}
