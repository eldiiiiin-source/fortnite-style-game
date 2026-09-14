/**
 * IslandStructures.js — MAP_SPEC §20.1, §20.7.
 *
 * The buildings on the island, authored as BUILD PIECES rather than as decorative meshes.
 *
 * This is the overhaul's central decision. Placing a POI into the existing build grid buys,
 * with no change to the collision hot path:
 *
 *   - collision      every piece already blocks players and bullets;
 *   - destructibility players harvest and blow through walls exactly as they do their own;
 *   - cover          structures join build fights natively;
 *   - rendering      the instanced wood/brick/metal meshes already draw them.
 *
 * The alternative — static world colliders — would mean touching `CollisionWorld`, which is
 * the one system a visual pass must not destabilise.
 *
 * A blueprint is a pure function of a grid origin: it returns piece descriptors, and the
 * caller turns them into pieces. Pure logic, testable in Node.
 */
import { TILE, WALL_H } from '../core/Config.js';

/** Piece descriptor. `cy` is a storey index, so buildings stack on the build grid. */
const piece = (type, material, cx, cy, cz, direction = 'north') => ({
  type, material, cell: { cx, cy, cz }, direction
});

/** Walls around a rectangle of cells, with named gaps left as doorways. */
function walls(material, x0, z0, width, depth, storey, { doors = [] } = {}) {
  const out = [];
  const isDoor = (side, i) => doors.some((d) => d.side === side && d.index === i);

  for (let i = 0; i < width; i++) {
    if (!isDoor('south', i)) out.push(piece('wall', material, x0 + i, storey, z0, 'south'));
    if (!isDoor('north', i)) out.push(piece('wall', material, x0 + i, storey, z0 + depth - 1, 'north'));
  }
  for (let k = 0; k < depth; k++) {
    if (!isDoor('west', k)) out.push(piece('wall', material, x0, storey, z0 + k, 'west'));
    if (!isDoor('east', k)) out.push(piece('wall', material, x0 + width - 1, storey, z0 + k, 'east'));
  }
  return out;
}

/** A floor slab over a rectangle of cells. */
function slab(material, x0, z0, width, depth, storey) {
  const out = [];
  for (let k = 0; k < depth; k++) {
    for (let i = 0; i < width; i++) out.push(piece('floor', material, x0 + i, storey, z0 + k));
  }
  return out;
}

/** A pitched roof: cones read as a ridge line far more cheaply than modelled gables. */
function roof(material, x0, z0, width, depth, storey) {
  const out = [];
  for (let k = 0; k < depth; k++) {
    for (let i = 0; i < width; i++) out.push(piece('cone', material, x0 + i, storey, z0 + k));
  }
  return out;
}

/* ── blueprints — MAP_SPEC §20.7 ─────────────────────────────────────────── */

/**
 * Each takes the POI's grid origin and returns pieces in cells RELATIVE to it, so a POI
 * can be moved by moving one coordinate.
 *
 * Scale note: one cell is a full build module (5.12 m), so a "small house" is 2x2 cells.
 * Authoring in cells rather than metres is what keeps every structure aligned to the grid
 * a player will build against.
 */
const BLUEPRINTS = {
  /** Hollow Farm: a big open barn, a silo, a small farmhouse and a fence line. */
  farm(ox, oz) {
    const out = [];
    // Barn — deliberately large and open inside, with a wide door: long sightlines (§20.7).
    out.push(...walls('wood', ox - 2, oz - 2, 5, 4, 0, {
      doors: [{ side: 'south', index: 2 }, { side: 'south', index: 1 }]
    }));
    out.push(...slab('wood', ox - 2, oz - 2, 5, 4, 1));
    out.push(...roof('wood', ox - 2, oz - 2, 5, 4, 1));
    // Silo — a tall metal column beside it, the farm's landmark silhouette.
    for (let y = 0; y < 3; y++) out.push(...walls('metal', ox + 4, oz, 2, 2, y));
    out.push(...roof('metal', ox + 4, oz, 2, 2, 3));
    // Farmhouse across the yard.
    out.push(...walls('brick', ox - 1, oz + 5, 3, 3, 0, { doors: [{ side: 'south', index: 1 }] }));
    out.push(...slab('wood', ox - 1, oz + 5, 3, 3, 1));
    out.push(...roof('brick', ox - 1, oz + 5, 3, 3, 1));
    // Fence line: single walls, no roof — cover to fight behind without blocking sight.
    for (let i = -3; i <= 6; i++) out.push(piece('wall', 'wood', ox + i, 0, oz - 4, 'south'));
    return out;
  },

  /** Pumpjack Stop: a service building with a canopy over the forecourt. */
  serviceStop(ox, oz) {
    const out = [];
    out.push(...walls('brick', ox, oz, 3, 2, 0, {
      doors: [{ side: 'south', index: 1 }]
    }));
    out.push(...slab('metal', ox, oz, 3, 2, 1));
    // Canopy: a floor on legs. Overhead cover with open sides is the most readable
    // close-quarters shape there is — you can see through it but not shoot down through it.
    out.push(...slab('metal', ox - 3, oz - 1, 3, 3, 1));
    out.push(piece('wall', 'metal', ox - 3, 0, oz - 1, 'west'));
    out.push(piece('wall', 'metal', ox - 1, 0, oz + 1, 'east'));
    return out;
  },

  /** Kettle Row: three small pitched-roof houses with gaps to rotate through. */
  houseRow(ox, oz) {
    const out = [];
    const materials = ['brick', 'wood', 'brick'];
    for (let n = 0; n < 3; n++) {
      const x = ox + n * 3;
      const mat = materials[n];
      out.push(...walls(mat, x, oz, 2, 2, 0, { doors: [{ side: 'south', index: 0 }] }));
      out.push(...slab('wood', x, oz, 2, 2, 1));
      // The middle house gets a second storey: one rooftop to hold is worth more than
      // three identical bungalows.
      if (n === 1) {
        out.push(...walls(mat, x, oz, 2, 2, 1, { doors: [{ side: 'north', index: 1 }] }));
        out.push(...slab('wood', x, oz, 2, 2, 2));
      }
      out.push(...roof(mat, x, oz, 2, 2, n === 1 ? 2 : 1));
    }
    return out;
  },

  /** Riverwatch: a stilted cabin with a dock running out over the water. */
  dock(ox, oz) {
    const out = [];
    out.push(...slab('wood', ox, oz, 3, 3, 0));
    out.push(...walls('wood', ox, oz, 3, 3, 1, { doors: [{ side: 'south', index: 1 }] }));
    out.push(...slab('wood', ox, oz, 3, 3, 2));
    out.push(...roof('wood', ox, oz, 3, 3, 2));
    // The dock itself: a plank run out from the cabin, exposed on every side.
    for (let k = 1; k <= 4; k++) out.push(piece('floor', 'wood', ox + 1, 0, oz - k));
    return out;
  },

  /** Crown Post: a small walled outpost with a tower — the island's high ground. */
  outpost(ox, oz) {
    const out = [];
    out.push(...walls('brick', ox, oz, 4, 4, 0, {
      doors: [{ side: 'south', index: 1 }, { side: 'south', index: 2 }]
    }));
    // Tower in the corner, three storeys with a ramp up: high ground you have to take.
    for (let y = 0; y < 3; y++) {
      out.push(...walls('brick', ox + 3, oz + 3, 2, 2, y, {
        doors: y === 0 ? [{ side: 'west', index: 0 }] : []
      }));
      out.push(...slab('wood', ox + 3, oz + 3, 2, 2, y + 1));
    }
    out.push(piece('ramp', 'wood', ox + 2, 0, oz + 3));
    out.push(piece('ramp', 'wood', ox + 2, 1, oz + 4));
    return out;
  },

  /** Dray Yard: a warehouse shell plus stacked containers for hard cover. */
  warehouse(ox, oz) {
    const out = [];
    out.push(...walls('metal', ox, oz, 5, 4, 0, {
      doors: [{ side: 'west', index: 1 }, { side: 'west', index: 2 }]
    }));
    out.push(...walls('metal', ox, oz, 5, 4, 1, {
      doors: [{ side: 'north', index: 2 }]
    }));
    out.push(...slab('metal', ox, oz, 5, 4, 2));
    // Container stacks outside: the yard's cover, at two heights so it plays in 3D.
    const stacks = [[-2, 0, 1], [-2, 2, 2], [6, 1, 1], [6, 3, 2], [2, -2, 1]];
    for (const [dx, dz, height] of stacks) {
      for (let y = 0; y < height; y++) {
        out.push(...walls('metal', ox + dx, oz + dz, 2, 1, y));
        out.push(...slab('metal', ox + dx, oz + dz, 2, 1, y + 1));
      }
    }
    return out;
  }
};

export const BLUEPRINT_NAMES = Object.freeze(Object.keys(BLUEPRINTS).sort());

/**
 * Resolve every POI's blueprint into piece descriptors in world grid cells.
 *
 * The vertical origin is the POI's terrain height, snapped to a storey, so a building sits
 * ON the ground rather than floating over it or sinking into it.
 *
 * @param {Array} pois       POI table
 * @param {object} terrain   anything with heightAt
 * @returns {Array} piece descriptors with absolute cells
 */
export function resolveStructures(pois, terrain) {
  const out = [];
  for (const poi of pois) {
    const blueprint = BLUEPRINTS[poi.blueprint];
    // An unknown blueprint is skipped rather than thrown: a POI table that outruns the
    // blueprint set must not break a match.
    if (!blueprint) continue;

    const ox = Math.round(poi.centre[0] / TILE);
    const oz = Math.round(poi.centre[1] / TILE);
    const ground = terrain.heightAt(poi.centre[0], poi.centre[1]);
    const baseStorey = Math.floor(ground / WALL_H);

    for (const p of blueprint(ox, oz)) {
      out.push({
        type: p.type,
        material: p.material,
        direction: p.direction,
        cell: { cx: p.cell.cx, cy: p.cell.cy + baseStorey, cz: p.cell.cz },
        poi: poi.id
      });
    }
  }
  return out;
}
