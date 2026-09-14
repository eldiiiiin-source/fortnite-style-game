/**
 * IslandStructures.js — MAP_SPEC §20.1, §20.7, §21.
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
 * ARCHITECTURE COMES FROM THE EDIT SYSTEM (§21.2). A doorway is not a missing wall — it is
 * a wall carrying the edit pattern `4,7`, and a window is one carrying `3,5`. Both already
 * have correct geometry and collision because `PieceGeometry` derives the mesh AND the
 * collider from the pattern. That is why these buildings have framed openings rather than
 * gaps, and why none of it needed new collision code.
 *
 * ROOFS USE RAMPS, NOT CONES (§21.3). A cone per cell gives a field of spikes. Two opposing
 * ramp rows with a flat deck between them give a broad pitched roof that reads as a roof
 * from a distance and is walkable.
 *
 * A blueprint is a pure function of a grid origin: it returns piece descriptors, and the
 * caller turns them into pieces. Pure logic, testable in Node.
 */
import { TILE, WALL_H, WORLD } from '../core/Config.js';
import { resolvePattern } from '../editing/EditPatterns.js';

const SEA_LEVEL = WORLD.seaLevel;

/* ── piece helpers ───────────────────────────────────────────────────────── */

/** Piece descriptor. `cy` is a storey index, so buildings stack on the build grid. */
const piece = (type, material, cx, cy, cz, direction = 'north', editPattern = null) => ({
  type, material, cell: { cx, cy, cz }, direction, editPattern
});

/** Openings, by the edit pattern that cuts them (EditPatterns.WALL_PATTERNS). */
export const Opening = Object.freeze({
  DOOR: '4,7',              // walkable, full height
  ARCH: '1,4,7',            // walkable, taller — bay and barn doors
  DOOR_WINDOW: '3,4,7',     // walkable door with a window beside it
  WINDOW: '4',              // single centre window
  WINDOWS: '3,5',           // a pair, either side
  HIGH_WINDOW: '1',         // clerestory
  HALF: '0,1,2,3,4,5',      // half wall — counters, porch rails, low cover
  OPEN_TOP: '0,1,2'         // top row removed — a gap under a roof overhang
});

/**
 * Resolve an `Opening` key to the pattern object the rest of the engine uses.
 *
 * Blueprints name openings by their edit-pattern KEY ('4,7'), but PieceGeometry reads
 * `editPattern.removed`. Handing a bare key downstream leaves every door, window and arch
 * solid and every half wall full height — the building still looks like a building from
 * outside and is sealed shut. Resolve once, here, so a descriptor is never half-typed.
 *
 * An unknown key throws: a blueprint typo must fail loudly rather than quietly seal a wall.
 */
function patternFor(type, key) {
  if (!key) return null;
  const pattern = resolvePattern(type, key.split(',').map(Number));
  if (!pattern) throw new Error(`blueprint used an invalid ${type} edit pattern: "${key}"`);
  return pattern;
}

const SIDES = ['south', 'north', 'west', 'east'];

/**
 * Walls around a rectangle of cells.
 *
 * `openings` places an edit pattern on one wall of one side by index, so a façade can carry
 * a door and windows rather than being either solid or missing.
 */
function room(material, x0, z0, width, depth, storey, { openings = [], omit = [] } = {}) {
  const out = [];
  const patternFor = (side, i) => openings.find((o) => o.side === side && o.index === i)?.pattern ?? null;
  const omitted = (side, i) => omit.some((o) => o.side === side && o.index === i);

  for (let i = 0; i < width; i++) {
    if (!omitted('south', i)) {
      out.push(piece('wall', material, x0 + i, storey, z0, 'south', patternFor('south', i)));
    }
    if (!omitted('north', i)) {
      out.push(piece('wall', material, x0 + i, storey, z0 + depth - 1, 'north', patternFor('north', i)));
    }
  }
  for (let k = 0; k < depth; k++) {
    if (!omitted('west', k)) {
      out.push(piece('wall', material, x0, storey, z0 + k, 'west', patternFor('west', k)));
    }
    if (!omitted('east', k)) {
      out.push(piece('wall', material, x0 + width - 1, storey, z0 + k, 'east', patternFor('east', k)));
    }
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

/**
 * A broad pitched roof (§21.3).
 *
 * Ramps form the eaves and a flat deck spans the ridge. One storey of rise across the whole
 * roof, so it reads as a pitched roof at distance instead of as a row of spikes — and the
 * deck gives roof-top fights somewhere to stand.
 *
 * The ramp direction is the part that is easy to get backwards: a ramp is HIGH at the edge
 * it faces, so the near row must face `south` and the far row `north` for the ridge to be
 * in the middle rather than at the eaves.
 */
function gableRoof(material, x0, z0, width, depth, storey) {
  const out = [];
  for (let i = 0; i < width; i++) {
    for (let k = 0; k < depth; k++) {
      const isNearEave = k === 0;
      const isFarEave = k === depth - 1;
      if (isNearEave && depth > 1) {
        out.push(piece('ramp', material, x0 + i, storey, z0 + k, 'south'));
      } else if (isFarEave && depth > 1) {
        out.push(piece('ramp', material, x0 + i, storey, z0 + k, 'north'));
      } else {
        out.push(piece('floor', material, x0 + i, storey + 1, z0 + k));
      }
    }
  }
  return out;
}

/** A flat industrial roof, optionally with a parapet to fight from behind. */
function flatRoof(material, x0, z0, width, depth, storey, { parapet = true } = {}) {
  const out = slab(material, x0, z0, width, depth, storey);
  if (parapet) {
    out.push(...room(material, x0, z0, width, depth, storey, {
      openings: SIDES.flatMap((side) => (
        Array.from({ length: side === 'south' || side === 'north' ? width : depth },
          (_, i) => ({ side, index: i, pattern: Opening.HALF }))
      ))
    }));
  }
  return out;
}

/**
 * A piling: a stack of walls from the ground up to (but not including) `topStorey`.
 *
 * Carries a floor that stands over water. Structurally this is exactly what the support
 * model wants — a wall is held by the wall directly below it in the same direction, so the
 * column chains down to the one resting on the bed, and the floor above is held by "a wall
 * in the cell below".
 *
 * Built from ARCH-patterned walls, which cut the middle column out: a stack of those reads
 * as a pair of posts rather than as a solid slab boxing in the space under a building.
 */
function piling(material, x, z, groundStorey, topStorey, direction = 'west') {
  const out = [];
  for (let y = groundStorey; y < topStorey; y++) {
    out.push(piece('wall', material, x, y, z, direction, Opening.ARCH));
  }
  return out;
}

/** A ramp run from one storey to the next, walkable in both directions. */
function stairs(material, x, z, storey, direction = 'north') {
  return [piece('ramp', material, x, storey, z, direction)];
}

/**
 * A porch or awning: a deck with half-wall posts, open on the approach side.
 * Overhead cover with open sides is the most readable close-quarters shape there is.
 */
function porch(material, x0, z0, width, depth, storey) {
  const out = slab(material, x0, z0, width, depth, storey + 1);
  for (let i = 0; i < width; i++) {
    out.push(piece('wall', material, x0 + i, storey, z0, 'south', Opening.HALF));
  }
  out.push(piece('wall', material, x0, storey, z0 + depth - 1, 'west', Opening.HALF));
  out.push(piece('wall', material, x0 + width - 1, storey, z0 + depth - 1, 'east', Opening.HALF));
  return out;
}

/* ── landmarks — MAP_SPEC §21.1 ──────────────────────────────────────────── */

/**
 * A slender shaft of walls, one cell square, rising `height` storeys.
 *
 * The shared primitive behind every landmark below: a post, a leg, a mast, a tower stem.
 * One cell is 5.12 m, so a shaft reads as slender rather than as a building, and with no
 * floors inside it there is nothing to climb — a landmark must not become a fortress.
 */
function shaft(material, x, z, storey, height) {
  const out = [];
  for (let y = 0; y < height; y++) out.push(...room(material, x, z, 1, 1, storey + y));
  return out;
}

/**
 * A beam: a run of floor slabs with a half-wall rail down each long side.
 *
 * Spans between two shafts to make a gantry or a drying frame. Support propagates along
 * adjacent floors at the same layer, so a span only needs one end standing on a shaft.
 */
function beam(material, x0, z0, length, storey, axis = 'x') {
  const out = [];
  for (let i = 0; i < length; i++) {
    const x = axis === 'x' ? x0 + i : x0;
    const z = axis === 'x' ? z0 : z0 + i;
    out.push(piece('floor', material, x, storey, z));
    const sides = axis === 'x' ? ['south', 'north'] : ['west', 'east'];
    for (const side of sides) out.push(piece('wall', material, x, storey, z, side, Opening.HALF));
  }
  return out;
}

/**
 * A water tower: a slender stem carrying a wider tank (§21.1).
 *
 * The tank overhangs the stem, which is the whole silhouette — a plain shaft reads as
 * another silo. The tank is sealed: no floor inside, no way up, so it is a landmark and
 * a piece of cover rather than a vertical position to hold.
 */
function waterTower(material, x, z, storey, stemHeight) {
  const out = shaft(material, x, z, storey, stemHeight);
  const top = storey + stemHeight;
  out.push(...slab(material, x, z, 2, 2, top));            // tank underside
  out.push(...room(material, x, z, 2, 2, top));            // tank shell
  out.push(...slab(material, x, z, 2, 2, top + 1));        // tank lid
  return out;
}

/**
 * A gantry: two legs carrying a spanning catwalk (§21.1).
 *
 * The legs stand clear of each other so the yard still runs underneath — the point is a
 * vertical anchor over open ground, not a wall across it.
 */
function gantry(material, x0, z, storey, legHeight, span) {
  const out = [
    ...shaft(material, x0, z, storey, legHeight),
    ...shaft(material, x0 + span - 1, z, storey, legHeight)
  ];
  out.push(...beam(material, x0, z, span, storey + legHeight));
  return out;
}

/**
 * A net-drying frame: two posts and a railed crossbeam, open underneath (§21.1).
 *
 * Same shape as a gantry at a smaller scale, in wood rather than metal — enough to read as
 * "the fishing place" from across the valley.
 */
function dryingFrame(material, x, z0, storey, postHeight, span) {
  const out = [
    ...shaft(material, x, z0, storey, postHeight),
    ...shaft(material, x, z0 + span - 1, storey, postHeight)
  ];
  out.push(...beam(material, x, z0, span, storey + postHeight, 'z'));
  return out;
}

/* ── blueprints — MAP_SPEC §20.7, §21 ────────────────────────────────────── */

/**
 * Each takes the POI's grid origin, plus a context describing the ground it landed on, and
 * returns pieces in cells RELATIVE to that origin.
 *
 * `ctx.waterStorey` is where the waterline sits relative to the POI's own base storey — 0
 * when the POI is founded at the waterline, negative when it stands above it. A waterside
 * blueprint uses it to reach DOWN to the water instead of assuming the water is at its feet.
 *
 * One cell is a full build module (5.12 m), so a room is generous by design: §21.4 puts
 * combat readability above realism, and a realistically-scaled hallway is unplayable in
 * third person.
 */
const BLUEPRINTS = {
  /**
   * HOLLOW FARM — a working farm.
   * Story: still in use. Big open barn with a hay loft, a farmhouse with a porch, a silo,
   * and fenced paddocks. Long sightlines across the field, hard cover inside the barn.
   */
  farm(ox, oz) {
    const out = [];

    // Barn: 5x4, open span, big arched doors both ends — the long sightline through it is
    // the farm's signature fight.
    out.push(...room('wood', ox - 2, oz - 2, 5, 4, 0, {
      openings: [
        { side: 'south', index: 2, pattern: Opening.ARCH },
        { side: 'south', index: 1, pattern: Opening.ARCH },
        { side: 'north', index: 2, pattern: Opening.ARCH },
        { side: 'west', index: 1, pattern: Opening.WINDOWS },
        { side: 'east', index: 2, pattern: Opening.WINDOWS }
      ]
    }));
    // Hay loft over half the barn, reached by a ramp: a vertical route inside the interior.
    out.push(...slab('wood', ox - 2, oz - 2, 5, 2, 1));
    out.push(...stairs('wood', ox + 1, oz + 1, 0, 'north'));
    out.push(...room('wood', ox - 2, oz - 2, 5, 4, 1, {
      openings: [
        { side: 'south', index: 2, pattern: Opening.HIGH_WINDOW },
        { side: 'north', index: 2, pattern: Opening.OPEN_TOP },
        { side: 'west', index: 1, pattern: Opening.HIGH_WINDOW }
      ]
    }));
    out.push(...gableRoof('wood', ox - 2, oz - 2, 5, 4, 2));

    // Silo: the farm's landmark. Tall, narrow, capped — visible from across the island.
    for (let y = 0; y < 4; y++) {
      out.push(...room('metal', ox + 4, oz, 2, 2, y, {
        openings: y === 0 ? [{ side: 'west', index: 0, pattern: Opening.DOOR }] : []
      }));
    }
    out.push(...slab('metal', ox + 4, oz, 2, 2, 4));
    out.push(...gableRoof('metal', ox + 4, oz, 2, 2, 4));

    // Farmhouse: two storeys, porch, windows on every face.
    out.push(...room('brick', ox - 1, oz + 5, 3, 3, 0, {
      openings: [
        { side: 'south', index: 1, pattern: Opening.DOOR_WINDOW },
        { side: 'west', index: 1, pattern: Opening.WINDOWS },
        { side: 'east', index: 1, pattern: Opening.WINDOWS },
        { side: 'north', index: 1, pattern: Opening.WINDOW }
      ]
    }));
    out.push(...slab('wood', ox - 1, oz + 5, 3, 3, 1));
    out.push(...stairs('wood', ox, oz + 6, 0, 'north'));
    out.push(...room('brick', ox - 1, oz + 5, 3, 3, 1, {
      openings: [
        { side: 'south', index: 1, pattern: Opening.WINDOWS },
        { side: 'west', index: 1, pattern: Opening.WINDOW },
        { side: 'east', index: 1, pattern: Opening.WINDOW }
      ]
    }));
    out.push(...gableRoof('brick', ox - 1, oz + 5, 3, 3, 2));
    out.push(...porch('wood', ox - 1, oz + 4, 3, 1, 0));

    // Paddock fences: low cover across the open field.
    for (let i = -3; i <= 6; i++) out.push(piece('wall', 'wood', ox + i, 0, oz - 4, 'south', Opening.HALF));
    for (let k = -4; k <= -1; k++) out.push(piece('wall', 'wood', ox - 3, 0, oz + k, 'west', Opening.HALF));
    for (let k = -4; k <= -1; k++) out.push(piece('wall', 'wood', ox + 6, 0, oz + k, 'east', Opening.HALF));

    return out;
  },

  /**
   * PUMPJACK STOP — a roadside service station.
   * Story: recently abandoned. Shop with a counter, a service garage with its bay door
   * open, a canopy over the forecourt. Fast loot, tight angles, everything within a sprint.
   */
  serviceStop(ox, oz) {
    const out = [];

    // Shop: glass frontage, counter inside, back door for a second route.
    out.push(...room('brick', ox, oz, 3, 2, 0, {
      openings: [
        { side: 'south', index: 1, pattern: Opening.DOOR_WINDOW },
        { side: 'south', index: 0, pattern: Opening.WINDOWS },
        { side: 'south', index: 2, pattern: Opening.WINDOWS },
        { side: 'north', index: 1, pattern: Opening.DOOR },
        { side: 'east', index: 0, pattern: Opening.WINDOW }
      ]
    }));
    // Counter: a half wall inside, splitting the shop into two fighting halves.
    out.push(piece('wall', 'metal', ox + 1, 0, oz + 1, 'south', Opening.HALF));
    out.push(...flatRoof('metal', ox, oz, 3, 2, 1, { parapet: true }));

    // Service garage: one big bay door, open interior, roof access by an outside ramp.
    out.push(...room('metal', ox + 3, oz, 3, 3, 0, {
      openings: [
        { side: 'south', index: 1, pattern: Opening.ARCH },
        { side: 'east', index: 1, pattern: Opening.WINDOWS },
        { side: 'north', index: 1, pattern: Opening.DOOR }
      ]
    }));
    out.push(...flatRoof('metal', ox + 3, oz, 3, 3, 1, { parapet: true }));
    out.push(...stairs('metal', ox + 6, oz + 1, 0, 'west'));

    // Forecourt canopy on posts — overhead cover you can see under and shoot across.
    out.push(...porch('metal', ox - 3, oz - 1, 3, 3, 0));

    return out;
  },

  /**
   * KETTLE ROW — a short street of houses.
   * Story: a small lived-in row. Four houses of differing height and footprint, fenced
   * yards, a street between them. Window-and-doorway fighting, one roof worth holding.
   */
  houseRow(ox, oz) {
    const out = [];
    const plans = [
      { dx: 0, w: 2, d: 2, storeys: 1, material: 'brick' },
      { dx: 3, w: 3, d: 3, storeys: 2, material: 'wood' },     // the tall one
      { dx: 7, w: 2, d: 2, storeys: 1, material: 'brick' },
      { dx: 10, w: 2, d: 3, storeys: 1, material: 'wood' }
    ];

    for (const [n, plan] of plans.entries()) {
      const x = ox + plan.dx;
      const { w, d, storeys, material } = plan;
      for (let y = 0; y < storeys; y++) {
        out.push(...room(material, x, oz, w, d, y, {
          openings: [
            { side: 'south', index: 0, pattern: y === 0 ? Opening.DOOR_WINDOW : Opening.WINDOWS },
            { side: 'south', index: w - 1, pattern: Opening.WINDOWS },
            { side: 'north', index: w - 1, pattern: y === 0 ? Opening.DOOR : Opening.WINDOW },
            { side: 'west', index: Math.floor(d / 2), pattern: Opening.WINDOW },
            { side: 'east', index: Math.floor(d / 2), pattern: Opening.WINDOW }
          ]
        }));
        out.push(...slab('wood', x, oz, w, d, y + 1));
        if (y + 1 < storeys) out.push(...stairs('wood', x, oz + d - 1, y, 'north'));
      }
      out.push(...gableRoof(material, x, oz, w, d, storeys));

      // Porches on the street side, alternating, so the row is not four of the same house.
      if (n % 2 === 0) out.push(...porch('wood', x, oz - 1, w, 1, 0));

      // Back-yard fences between plots.
      for (let k = 0; k < d; k++) {
        out.push(piece('wall', 'wood', x + w, 0, oz + k, 'east', Opening.HALF));
      }
    }

    // Street-side rail along the row, a continuous low cover line to push behind.
    for (let i = -1; i <= 12; i++) {
      out.push(piece('wall', 'wood', ox + i, 0, oz - 2, 'south', Opening.HALF));
    }

    // The neighbourhood water tower (§21.1) — the one thing that reads from 70 m. Four
    // storeys of stem puts the tank about 8 m clear of the tallest roof, which is enough to
    // name the place and nowhere near Crown Post's tower.
    //
    // Sited in the back yards MID-ROW rather than at an end, so it reads from both
    // approaches and its stem stands clear of the houses instead of hiding behind the last
    // one. Off the street, so it breaks no sightline along the row.
    out.push(...waterTower('metal', ox + 7, oz + 2, 0, 4));

    return out;
  },

  /**
   * RIVERWATCH — a fishing cabin on the waterline.
   * Story: someone fishes here. A stilted cabin with a deck, a dock out over the water, a
   * net store, and a plank bridge. Low ground, exposed approach, quick loot.
   */
  dock(ox, oz, { waterStorey = 0, groundStoreyAt = () => 0, terrainStoreyAt = () => 0 } = {}) {
    const out = [];
    // The cabin stands on the BANK (§21.2.1) and the river here runs in a channel below it,
    // so the dock is not at the cabin's feet — it is `waterStorey` storeys down. Reaching
    // for it is the whole point of the POI: you drop to the water and you are exposed.
    const deck = waterStorey;

    // Stilted cabin: raised a storey so the water runs under it. The stilts are REAL — four
    // corner pilings reaching from the riverbed to the underside of the floor. Without them
    // the cabin is a building standing on nothing, which the support model is right to
    // reject, and the POI's own description ("a stilted cabin") is not met by the geometry.
    for (const [dx, dz] of [[0, 0], [2, 0], [0, 2], [2, 2]]) {
      out.push(...piling('wood', ox + dx, oz + dz, terrainStoreyAt(dx, dz), 0));
    }
    out.push(...slab('wood', ox, oz, 3, 3, 0));
    out.push(...room('wood', ox, oz, 3, 3, 1, {
      openings: [
        { side: 'south', index: 1, pattern: Opening.DOOR_WINDOW },
        { side: 'west', index: 1, pattern: Opening.WINDOWS },
        { side: 'east', index: 1, pattern: Opening.WINDOWS },
        { side: 'north', index: 1, pattern: Opening.DOOR }
      ]
    }));
    out.push(...slab('wood', ox, oz, 3, 3, 2));
    out.push(...gableRoof('wood', ox, oz, 3, 3, 2));
    out.push(...stairs('wood', ox + 1, oz - 1, 0, 'north'));

    // Deck around two sides, railed — the approach you have to cross in the open.
    out.push(...slab('wood', ox - 1, oz, 1, 3, 0));
    for (let k = 0; k < 3; k++) {
      out.push(piece('wall', 'wood', ox - 1, 0, oz + k, 'west', Opening.HALF));
    }

    // The descent to the water, one cell at a time, each plank founded on the ground UNDER
    // it (§21.2.1). The river here runs in a narrow ravine and the far side is high ground
    // again, so running the whole deck at the waterline buried six of its cells 11.5 m
    // inside that far bank. The run therefore stops where the bank comes back up rather
    // than tunnelling through it.
    let previous = 0;
    for (let k = 1; k <= 6; k++) {
      const ground = Math.max(deck, groundStoreyAt(1, -k));
      if (k > 1 && ground >= 0) break;           // back on the bank — the water is behind us
      // Ramps bridge each storey of the drop so the descent stays walkable.
      for (let y = previous; y > ground; y--) {
        out.push(piece('ramp', 'wood', ox + 1, y - 1, oz - k, 'north'));
      }
      out.push(piece('floor', 'wood', ox + 1, ground, oz - k));
      // A plank at the waterline is over the bed, not on it: post it down like the cabin.
      if (ground > terrainStoreyAt(1, -k)) {
        out.push(...piling('wood', ox + 1, oz - k, terrainStoreyAt(1, -k), ground));
      }
      if (ground === deck) {
        out.push(piece('wall', 'wood', ox + 1, ground, oz - k, 'west', Opening.HALF));
        out.push(piece('wall', 'wood', ox + 1, ground, oz - k, 'east', Opening.HALF));
      }
      previous = ground;
    }

    // Net-drying frame (§21.1): two posts and a railed crossbeam, open underneath. It is
    // what names the place from across the valley — the cabin alone is a brown box at 70 m.
    //
    // Sited on the bank just past the head of the boardwalk, where the ground comes back up.
    // It has to stand on DRY cells: a post over even 0.2 m of water never reaches terrain,
    // so support propagation would quietly delete its whole column and leave the crossbeam
    // hanging off one leg.
    out.push(...dryingFrame('wood', ox + 2, oz - 5, 0, 5, 3));

    // Net store: a small shed beside the cabin, one way in. It stands over the channel too,
    // so it gets its own floor and pilings rather than resting on the water.
    for (const [dx, dz] of [[4, 1], [5, 2]]) {
      out.push(...piling('wood', ox + dx, oz + dz, terrainStoreyAt(dx, dz), 0));
    }
    out.push(...slab('wood', ox + 4, oz + 1, 2, 2, 0));
    out.push(...room('wood', ox + 4, oz + 1, 2, 2, 0, {
      openings: [
        { side: 'south', index: 0, pattern: Opening.DOOR },
        { side: 'east', index: 1, pattern: Opening.WINDOW }
      ]
    }));
    out.push(...gableRoof('wood', ox + 4, oz + 1, 2, 2, 1));

    return out;
  },

  /**
   * CROWN POST — a hilltop observation outpost.
   * Story: someone watches the island from here. A four-storey tower with a railed
   * observation deck, a walled compound, and a bunker. The silhouette is the point: this
   * has to be recognisable from anywhere on the island.
   */
  outpost(ox, oz) {
    const out = [];

    // Compound wall: half height, so it is cover you fight over rather than a box.
    for (let i = 0; i < 6; i++) {
      out.push(piece('wall', 'brick', ox + i, 0, oz, 'south', Opening.HALF));
      out.push(piece('wall', 'brick', ox + i, 0, oz + 5, 'north', Opening.HALF));
    }
    for (let k = 0; k < 6; k++) {
      out.push(piece('wall', 'brick', ox, 0, oz + k, 'west', k === 2 ? Opening.DOOR : Opening.HALF));
      out.push(piece('wall', 'brick', ox + 5, 0, oz + k, 'east', Opening.HALF));
    }

    // The tower: five storeys, stairs all the way up, windows on every face. Taller than
    // the farm's silo on purpose — this is the island's landmark.
    const tx = ox + 3;
    const tz = oz + 3;
    for (let y = 0; y < 5; y++) {
      out.push(...room('brick', tx, tz, 2, 2, y, {
        openings: [
          { side: 'south', index: 0, pattern: y === 0 ? Opening.DOOR : Opening.WINDOWS },
          { side: 'north', index: 1, pattern: Opening.WINDOW },
          { side: 'west', index: 1, pattern: Opening.WINDOW },
          { side: 'east', index: 0, pattern: Opening.WINDOW }
        ]
      }));
      out.push(...slab('wood', tx, tz, 2, 2, y + 1));
      out.push(...stairs('wood', tx + (y % 2), tz + 1, y, y % 2 === 0 ? 'north' : 'south'));
    }
    // Observation deck: railed, open, the best sightline on the island.
    for (let i = 0; i < 2; i++) {
      out.push(piece('wall', 'metal', tx + i, 5, tz, 'south', Opening.HALF));
      out.push(piece('wall', 'metal', tx + i, 5, tz + 1, 'north', Opening.HALF));
    }
    out.push(piece('wall', 'metal', tx, 5, tz + 1, 'west', Opening.HALF));
    out.push(piece('wall', 'metal', tx + 1, 5, tz, 'east', Opening.HALF));

    // Bunker in the corner of the compound: the low half of the vertical route.
    out.push(...room('brick', ox + 1, oz + 1, 2, 2, 0, {
      openings: [
        { side: 'south', index: 1, pattern: Opening.DOOR },
        { side: 'west', index: 0, pattern: Opening.WINDOW }
      ]
    }));
    out.push(...flatRoof('brick', ox + 1, oz + 1, 2, 2, 1, { parapet: true }));

    return out;
  },

  /**
   * DRAY YARD — an industrial loading yard.
   * Story: goods move through here. Two warehouse shells with loading bays, a container
   * stack outside, a gantry walkway between them. Hard cover everywhere, big interiors.
   */
  warehouse(ox, oz) {
    const out = [];

    // Main warehouse: loading bays down one side, a mezzanine, a flat roof to hold.
    out.push(...room('metal', ox, oz, 5, 4, 0, {
      openings: [
        { side: 'west', index: 1, pattern: Opening.ARCH },
        { side: 'west', index: 2, pattern: Opening.ARCH },
        { side: 'south', index: 2, pattern: Opening.DOOR },
        { side: 'north', index: 2, pattern: Opening.DOOR },
        { side: 'east', index: 1, pattern: Opening.WINDOWS }
      ]
    }));
    out.push(...room('metal', ox, oz, 5, 4, 1, {
      openings: [
        { side: 'south', index: 1, pattern: Opening.HIGH_WINDOW },
        { side: 'north', index: 3, pattern: Opening.HIGH_WINDOW },
        { side: 'east', index: 2, pattern: Opening.HIGH_WINDOW }
      ]
    }));
    // Mezzanine over the back third, with a ramp up: interior high ground.
    out.push(...slab('metal', ox + 3, oz, 2, 4, 1));
    out.push(...stairs('metal', ox + 2, oz + 1, 0, 'east'));
    out.push(...flatRoof('metal', ox, oz, 5, 4, 2, { parapet: true }));

    // Second, smaller shed across the yard — a second building to rotate between.
    out.push(...room('metal', ox - 5, oz + 1, 3, 3, 0, {
      openings: [
        { side: 'east', index: 1, pattern: Opening.ARCH },
        { side: 'west', index: 1, pattern: Opening.DOOR },
        { side: 'south', index: 1, pattern: Opening.WINDOWS }
      ]
    }));
    out.push(...flatRoof('metal', ox - 5, oz + 1, 3, 3, 1, { parapet: true }));

    // Loading gantry (§21.1): the yard's vertical anchor. Two legs well apart with a railed
    // catwalk spanning between them, standing clear of the sheds on the open south side, so
    // the yard still runs underneath it and the warehouse fight is untouched. There is no
    // stair up — it is a silhouette and a piece of cover, not a tower to hold.
    out.push(...gantry('metal', ox - 2, oz + 4, 0, 5, 6));

    // Rooftop utility box on the main warehouse: a small second read that keeps the roofline
    // from being one flat grey band.
    out.push(...room('metal', ox + 1, oz + 1, 2, 1, 3));
    out.push(...slab('metal', ox + 1, oz + 1, 2, 1, 4));

    // Container stacks: the yard's hard cover, at two heights so it plays in three
    // dimensions rather than as a maze of equal boxes.
    const stacks = [[-2, -2, 1], [-2, 5, 2], [6, 0, 2], [6, 3, 1], [2, -3, 1], [-8, -1, 1]];
    for (const [dx, dz, height] of stacks) {
      for (let y = 0; y < height; y++) {
        out.push(...room('metal', ox + dx, oz + dz, 2, 1, y, {
          openings: y === height - 1 ? [{ side: 'south', index: 0, pattern: Opening.DOOR }] : []
        }));
        out.push(...slab('metal', ox + dx, oz + dz, 2, 1, y + 1));
      }
    }
    return out;
  }
};

export const BLUEPRINT_NAMES = Object.freeze(Object.keys(BLUEPRINTS).sort());

/* ── prop dressing — MAP_SPEC §21.6 ──────────────────────────────────────── */

/**
 * Visual dressing, in cells relative to the POI origin.
 *
 * VISUAL ONLY, and deliberately so: anything a player must be able to take cover behind is
 * a build piece above. A prop that looks like cover but is not is worse than no prop.
 * Kept low and sparse so it never fights movement or building.
 */
const DRESSING = {
  farm: [
    ['hayBale', -3.4, -3.2], ['hayBale', -2.6, -3.4], ['hayBale', -3.0, -2.4],
    ['crate', 0.4, -1.2], ['crate', 1.2, -1.0], ['barrel', -1.6, 0.4],
    ['pallet', 2.2, 1.4], ['trough', 3.2, -2.6], ['toolRack', -1.4, 2.2],
    ['hayBale', 5.2, 3.4], ['crate', 4.4, 4.2]
  ],
  serviceStop: [
    ['fuelPump', -2.2, -0.4], ['fuelPump', -1.2, -0.4], ['sign', -3.6, -1.8],
    ['barrel', 3.4, 2.6], ['barrel', 4.0, 2.8], ['crate', 1.4, 2.4],
    ['pallet', 4.6, 1.2], ['toolRack', 4.2, 0.4], ['barrier', -3.2, 1.8],
    ['barrier', -2.2, 2.0]
  ],
  houseRow: [
    ['bench', 0.6, -1.4], ['bench', 7.6, -1.4], ['crate', 3.4, 3.6],
    ['barrel', 9.6, 1.4], ['sign', -1.4, -2.4], ['pallet', 6.2, 3.2],
    ['bench', 10.4, -1.4], ['crate', 2.2, -2.6]
  ],
  dock: [
    ['fishingRack', -1.4, -1.6], ['crate', 1.6, -3.4], ['crate', 0.6, -4.2],
    ['barrel', 4.4, 0.4], ['fishingRack', 1.6, -2.2], ['pallet', 4.2, 3.2],
    ['crate', -1.4, 2.4]
  ],
  outpost: [
    ['antenna', 1.4, 4.2], ['crate', 2.2, 1.4], ['sandbag', 0.6, 2.6],
    ['sandbag', 1.4, 2.6], ['sandbag', 4.4, 2.4], ['barrel', 4.2, 4.4],
    ['toolRack', 2.4, 4.2]
  ],
  warehouse: [
    ['pallet', 1.4, 1.4], ['pallet', 2.2, 2.2], ['crate', 0.6, 2.6],
    ['crate', 1.2, 3.2], ['barrel', -3.4, 2.4], ['barrel', -2.8, 2.8],
    ['forklift', -1.4, 0.4], ['pallet', -4.2, 2.4], ['crate', 6.6, 2.2],
    ['barrier', -1.2, 5.4], ['crate', 4.2, -2.6]
  ]
};

/** Prop kinds the renderer knows how to draw. */
export const PROP_KINDS = Object.freeze([
  'crate', 'barrel', 'pallet', 'hayBale', 'bench', 'sign', 'fuelPump',
  'toolRack', 'fishingRack', 'antenna', 'sandbag', 'barrier', 'trough', 'forklift'
]);

/* ── loot routes — MAP_SPEC §21.5 ────────────────────────────────────────── */

/**
 * Authored loot per POI, in cells relative to the origin, with a storey.
 *
 * Spread on purpose: the point of a loot route is a choice, so no POI has all of its value
 * in one room, and each has one `risk` entry — the best loot in the most exposed place.
 */
const LOOT = {
  farm: {
    chests: [[0, -1, 1], [-1.5, 0.5, 0], [0, 6, 0], [4.6, 0.6, 0]],
    ammo: [[-1.6, -1.4, 0], [0.4, 6.4, 1], [4.6, 1.4, 0]],
    floor: [[1.4, -0.6, 0], [-1.4, 1.4, 0], [0.6, 5.4, 0], [-2.4, -3.4, 0], [5.4, 3.4, 0]],
    risk: [0.5, -1.5, 2]        // the hay loft: one way up, no cover at the top
  },
  serviceStop: {
    chests: [[1, 0.5, 0], [4, 1, 0], [1, 1, 1]],
    ammo: [[0.4, 1.4, 0], [4.4, 0.4, 0], [-2, 0, 0]],
    floor: [[2.4, 0.4, 0], [3.4, 2.4, 0], [-2.4, 0.4, 0], [5.4, 1.4, 0]],
    risk: [4, 1.5, 2]           // the garage roof, reached by the outside ramp
  },
  houseRow: {
    chests: [[0.5, 0.5, 0], [4, 1, 1], [7.5, 0.5, 0], [10.5, 1, 0]],
    ammo: [[3.4, 0.4, 0], [7.4, 1.4, 0], [10.4, 2.4, 0]],
    floor: [[1.4, 1.4, 0], [4.4, 2.4, 0], [8.4, 0.4, 0], [11.4, 0.4, 0], [5.4, -1.4, 0]],
    risk: [4, 1.5, 2]           // the tall house's roof deck
  },
  dock: {
    chests: [[1, 1, 1], [1, -4, 0], [4.5, 1.5, 0]],
    ammo: [[0.4, 1.4, 1], [4.4, 2.4, 0]],
    floor: [[1.4, -2.4, 0], [-0.6, 1.4, 0], [2.4, 0.4, 1], [5.4, 1.4, 0]],
    risk: [1, -5, 0]            // the dock head, in the open over the water
  },
  outpost: {
    chests: [[3.5, 3.5, 0], [4, 4, 2], [1.5, 1.5, 0], [3.5, 4.5, 4]],
    ammo: [[3.4, 4.4, 1], [1.4, 2.4, 0], [4.4, 3.4, 3]],
    floor: [[2.4, 2.4, 0], [0.6, 4.4, 0], [4.4, 1.4, 0], [3.4, 4.4, 2]],
    risk: [4, 4, 5]             // the observation deck, five storeys up and railed
  },
  warehouse: {
    chests: [[1, 1, 0], [3.5, 2, 1], [-4, 2, 0], [6.5, 0.5, 1]],
    ammo: [[2.4, 0.4, 0], [-3.6, 2.4, 0], [0.4, 3.4, 0]],
    floor: [[1.4, 2.4, 0], [4.4, 1.4, 1], [-4.4, 1.4, 0], [2.4, 3.4, 0], [6.4, 3.4, 0]],
    risk: [2, 2, 3]             // the warehouse roof, behind the parapet
  }
};

/* ── resolution ──────────────────────────────────────────────────────────── */

/** Ground height at the middle of a cell, rather than at its corner. */
const groundOfCell = (terrain, cx, cz) => terrain.heightAt((cx + 0.5) * TILE, (cz + 0.5) * TILE);
const cellIsWet = (terrain, cx, cz) => terrain.waterDepthAt((cx + 0.5) * TILE, (cz + 0.5) * TILE) > 0;

/**
 * Grid origin of a POI, in cells (MAP_SPEC §21.2).
 *
 * A POI's CENTRE is fixed by the map layout (§20.7) and is not ours to move. Its BUILDINGS
 * are. Pumpjack Stop's centre sits on the ford, and founding the blueprint there left 15 of
 * its 25 cells standing over the river with the base storey 7.7 m up — a service station on
 * stilts. So for a POI that is not waterside by design, settle the blueprint on the nearest
 * dry origin: the POI stays where the map put it, its buildings step onto the bank.
 *
 * The search is a deterministic ring scan ordered by distance, so the settled origin is a
 * pure function of the terrain — the same island always lays out the same way.
 */
function originOf(poi, terrain, footprint = []) {
  const cx0 = Math.round(poi.centre[0] / TILE);
  const cz0 = Math.round(poi.centre[1] / TILE);

  let ox = cx0;
  let oz = cz0;
  // A waterside POI is MEANT to stand over water (Riverwatch's cabin is on stilts and its
  // dock runs out over the river), so it is never settled.
  if (!poi.waterside && footprint.length) {
    const wetCount = (x, z) => footprint.reduce(
      (n, [dx, dz]) => n + (cellIsWet(terrain, x + dx, z + dz) ? 1 : 0), 0
    );
    let best = { wet: wetCount(cx0, cz0), d2: 0, x: cx0, z: cz0 };
    for (let r = 1; r <= WORLD.poiSettleReach && best.wet > 0; r++) {
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;   // ring only
          const wet = wetCount(cx0 + dx, cz0 + dz);
          const d2 = dx * dx + dz * dz;
          if (wet < best.wet || (wet === best.wet && d2 < best.d2)) {
            best = { wet, d2, x: cx0 + dx, z: cz0 + dz };
          }
        }
      }
    }
    ox = best.x;
    oz = best.z;
  }

  // Found on the ground under the SETTLED origin — the POI's own datum, which §21.2's pad
  // has already flattened and snapped to a storey line.
  //
  // A waterside POI is the exception. Its origin is over the channel, so founding there put
  // Riverwatch 10.9 m below its own bank with the net store and stairs buried in it. Found
  // it on the BANK instead — the dry half of its footprint — and let the stilts and the dock
  // reach down over the water, which is what the blueprint is describing anyway.
  let ground = groundOfCell(terrain, ox, oz);
  if (poi.waterside) {
    const dry = footprint
      .filter(([dx, dz]) => !cellIsWet(terrain, ox + dx, oz + dz))
      .map(([dx, dz]) => groundOfCell(terrain, ox + dx, oz + dz))
      .sort((a, b) => a - b);
    if (dry.length) ground = dry[Math.floor(dry.length / 2)];
  }

  // Never found a building below sea level. EPS absorbs the float error in a pad that is
  // meant to sit exactly on a storey line, so it snaps to that storey and not the one below.
  const EPS = 1e-6;
  return { ox, oz, baseStorey: Math.floor(Math.max(ground, SEA_LEVEL) / WALL_H + EPS) };
}

/**
 * A blueprint's footprint: its centre relative to its origin, and its half-extent (MAP_SPEC
 * §21.2). The terrain uses this to size the flat pad it lays under a POI.
 *
 * Terrain-free on purpose — it must not ask the terrain anything back, or sizing the pad
 * would recurse into the levelling the pad defines.
 *
 * Measured from the footprint's CENTRE, not from the origin. A blueprint's origin is a
 * corner (the outpost's cells run 0..5 on both axes), so a radius measured from it is twice
 * what the buildings need; pads sized that way overlapped their neighbours and steepened the
 * countryside between them until the spine road stopped being walkable.
 *
 * The half-extent is per-AXIS rather than the diagonal, for the same reason: a pad sized to
 * the diagonal of a 13-cell street is half again wider than the street.
 */
export function footprintBounds(blueprintName) {
  const blueprint = BLUEPRINTS[blueprintName];
  if (!blueprint) return { cx: 0, cz: 0, radius: 0 };
  const cells = footprintOf(blueprint);
  const xs = cells.map(([dx]) => dx);
  const zs = cells.map(([, dz]) => dz);
  const x0 = Math.min(...xs), x1 = Math.max(...xs) + 1;   // +1 covers the far cell's far edge
  const z0 = Math.min(...zs), z1 = Math.max(...zs) + 1;
  return {
    cx: (x0 + x1) / 2,
    cz: (z0 + z1) / 2,
    radius: Math.max(x1 - x0, z1 - z0) / 2 * TILE + TILE   // half-extent plus a cell of margin
  };
}

/**
 * The settled grid origin and foundation of a POI (MAP_SPEC §21.2).
 *
 * Exported so tests and tools measure against where a POI's buildings actually stand,
 * rather than re-deriving it from the POI centre and disagreeing with the world.
 */
export function originFor(poi, terrain) {
  const blueprint = BLUEPRINTS[poi.blueprint];
  return originOf(poi, terrain, blueprint ? footprintOf(blueprint) : []);
}

/** The distinct cells a blueprint occupies, as offsets from its origin. */
function footprintOf(blueprint) {
  const seen = new Set();
  const cells = [];
  // The widest shape the blueprint can take. A terrain-aware blueprint shortens itself on
  // some sites (Riverwatch's boardwalk stops at the bank), and the pad has to cover the
  // longest version or a POI on flatter ground would overrun its own level ground.
  for (const p of blueprint(0, 0, { waterStorey: 0, groundStoreyAt: () => 0, terrainStoreyAt: () => 0 })) {
    const key = `${p.cell.cx},${p.cell.cz}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cells.push([p.cell.cx, p.cell.cz]);
  }
  return cells;
}

/**
 * Resolve every POI's blueprint into piece descriptors in world grid cells.
 *
 * The vertical origin is the POI's terrain height snapped to a storey, so a building sits
 * ON the ground rather than floating over it or sinking into it.
 */
export function resolveStructures(pois, terrain) {
  const out = [];
  for (const poi of pois) {
    const blueprint = BLUEPRINTS[poi.blueprint];
    // An unknown blueprint is skipped rather than thrown: a POI table that outruns the
    // blueprint set must not break a match.
    if (!blueprint) continue;
    const { ox, oz, baseStorey } = originOf(poi, terrain, footprintOf(blueprint));

    // Where the waterline sits relative to this POI's base storey (see the blueprint docs).
    const waterStorey = Math.ceil(SEA_LEVEL / WALL_H) - baseStorey;
    // The ground storey under one of the blueprint's own cells, relative to its base. Lets a
    // blueprint found a piece on the ground it actually stands over instead of assuming the
    // site is flat — which is what put Riverwatch's boardwalk inside the far bank.
    const groundStoreyAt = (dx, dz) => (
      Math.round(groundOfCell(terrain, ox + dx, oz + dz) / WALL_H) - baseStorey
    );
    // The storey whose vertical span the terrain actually passes THROUGH — the one a piece
    // must occupy to be grounded (StructureGraph.touchesTerrain). Distinct from
    // `groundStoreyAt`, which rounds to the nearest storey line to found a floor ON the
    // ground; over a riverbed 0.3 m below a storey line the two differ by a whole storey.
    const terrainStoreyAt = (dx, dz) => (
      Math.floor(groundOfCell(terrain, ox + dx, oz + dz) / WALL_H) - baseStorey
    );

    for (const p of blueprint(ox, oz, { waterStorey, groundStoreyAt, terrainStoreyAt })) {
      out.push({
        type: p.type,
        material: p.material,
        direction: p.direction,
        editPattern: patternFor(p.type, p.editPattern),
        cell: { cx: p.cell.cx, cy: p.cell.cy + baseStorey, cz: p.cell.cz },
        poi: poi.id
      });
    }
  }
  return out;
}

/** Resolve prop dressing into world positions. */
export function resolveDressing(pois, terrain) {
  const out = [];
  for (const poi of pois) {
    const entries = DRESSING[poi.blueprint];
    const blueprint = BLUEPRINTS[poi.blueprint];
    if (!entries || !blueprint) continue;
    // Same footprint, so props settle with the buildings they dress rather than staying
    // behind in the river the buildings just stepped out of.
    const { ox, oz } = originOf(poi, terrain, footprintOf(blueprint));
    for (const [kind, dx, dz] of entries) {
      const x = (ox + dx) * TILE;
      const z = (oz + dz) * TILE;
      // Drop anything that lands in water rather than nudging it. A POI beside a ford or a
      // river has some of its apron underwater, and a crate floating mid-current reads far
      // worse than a slightly emptier yard. Same rule the vegetation layer uses.
      if (terrain.waterDepthAt(x, z) > 0) continue;
      out.push({ kind, x, z, poi: poi.id, yaw: (dx * 1.7 + dz * 0.9) % Math.PI });
    }
  }
  return out;
}

/**
 * Resolve authored loot into world positions.
 * Storeys become heights above the POI's ground, so loot lands on the floor it belongs to.
 */
export function resolveLoot(pois, terrain) {
  const chests = [];
  const ammoBoxes = [];
  const floorLoot = [];

  for (const poi of pois) {
    const plan = LOOT[poi.blueprint];
    const blueprint = BLUEPRINTS[poi.blueprint];
    if (!plan || !blueprint) continue;
    // Loot is authored against the blueprint's own cells, so it must settle with it.
    const { ox, oz, baseStorey } = originOf(poi, terrain, footprintOf(blueprint));
    const place = (dx, dz, storey) => ({
      x: (ox + dx) * TILE,
      z: (oz + dz) * TILE,
      y: (baseStorey + storey) * WALL_H,
      poi: poi.id
    });

    for (const [dx, dz, storey] of plan.chests) chests.push(place(dx, dz, storey));
    for (const [dx, dz, storey] of plan.ammo) ammoBoxes.push(place(dx, dz, storey));
    for (const [dx, dz, storey] of plan.floor) floorLoot.push(place(dx, dz, storey));
    if (plan.risk) {
      const [dx, dz, storey] = plan.risk;
      chests.push({ ...place(dx, dz, storey), risk: true });
    }
  }
  return { chests, ammoBoxes, floorLoot };
}

/** For tests and tooling: the loot plan for a blueprint. */
export function lootPlanFor(blueprint) {
  return LOOT[blueprint] ?? null;
}
