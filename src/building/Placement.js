/**
 * Placement.js — placement validation and execution. MASTER_SPEC §6.3.
 *
 * Terrain never blocks placement (rule 5). Players do (rule 4).
 */
import { BUILD, MATERIALS } from '../core/Config.js';
import { BuildPiece } from './BuildPiece.js';
import { cellCentre } from './BuildGrid.js';

export const PlacementResult = Object.freeze({
  OK: 'ok',
  SLOT_OCCUPIED: 'slotOccupied',
  OUT_OF_RANGE: 'outOfRange',
  ABOVE_CEILING: 'aboveCeiling',
  OUTSIDE_BOUNDARY: 'outsideBoundary',
  INSUFFICIENT_MATERIAL: 'insufficientMaterial',
  BLOCKED_BY_PLAYER: 'blockedByPlayer',
  RATE_LIMITED: 'rateLimited'
});

const slotFor = (type, direction) => (type === 'wall' ? `wall:${direction}` : type);

/**
 * Axis-aligned local bounds of a piece within its cell, in cell-local metres.
 * See references/building/01-piece-geometry.md.
 */
export function pieceLocalBounds(type, direction) {
  const T = BUILD.tileSize;
  const H = BUILD.wallHeight;
  const K = BUILD.thickness;

  switch (type) {
    case 'floor':
      return { min: [0, 0, 0], max: [T, K, T] };
    case 'ramp':
    case 'cone':
      return { min: [0, 0, 0], max: [T, H, T] };
    case 'wall':
      switch (direction) {
        case 'north': return { min: [0, 0, 0], max: [T, H, K] };
        case 'south': return { min: [0, 0, T - K], max: [T, H, T] };
        case 'west': return { min: [0, 0, 0], max: [K, H, T] };
        case 'east': return { min: [T - K, 0, 0], max: [T, H, T] };
        default: throw new Error(`Unknown wall direction: ${direction}`);
      }
    default:
      throw new Error(`Unknown piece type: ${type}`);
  }
}

/** World-space AABB for a piece in a cell. */
export function pieceWorldBounds(type, direction, cell) {
  const { min, max } = pieceLocalBounds(type, direction);
  const ox = cell.cx * BUILD.tileSize;
  const oy = cell.cy * BUILD.wallHeight;
  const oz = cell.cz * BUILD.tileSize;
  return {
    min: [min[0] + ox, min[1] + oy, min[2] + oz],
    max: [max[0] + ox, max[1] + oy, max[2] + oz]
  };
}

/** Does a piece's AABB overlap a player capsule, approximated by its AABB? §6.3 rule 4 */
export function overlapsPlayer(bounds, player) {
  const r = player.radius;
  const h = player.height;
  const pMin = [player.position.x - r, player.position.y, player.position.z - r];
  const pMax = [player.position.x + r, player.position.y + h, player.position.z + r];
  for (let i = 0; i < 3; i++) {
    if (bounds.max[i] <= pMin[i] || bounds.min[i] >= pMax[i]) return false;
  }
  return true;
}

/**
 * Validate a placement without mutating anything.
 *
 * @param {object} req
 * @param {import('./BuildGrid.js').BuildGrid} req.grid
 * @param {string} req.type
 * @param {string} req.material
 * @param {{cx,cy,cz}} req.cell
 * @param {string} [req.direction]
 * @param {object} req.builder          { position, materials, lastPlacementTime, id }
 * @param {Array}  [req.players]        all player capsules to test against
 * @param {number} [req.now]            seconds, for the rate limit
 * @param {number} [req.playableExtent] half-extent test, metres from origin
 * @returns {{ok:boolean, reason:string}}
 */
export function validatePlacement(req) {
  const {
    grid, type, material, cell, direction = 'north',
    builder, players = [], now = Infinity, playableExtent = null
  } = req;

  if (!MATERIALS[material]) {
    return { ok: false, reason: PlacementResult.INSUFFICIENT_MATERIAL };
  }

  // Rule 6 — minimum interval between placements.
  if (builder.lastPlacementTime != null &&
      now - builder.lastPlacementTime < BUILD.minPlacementInterval) {
    return { ok: false, reason: PlacementResult.RATE_LIMITED };
  }

  // Rule 4 — build ceiling is an absolute altitude (MAP_SPEC §3.4).
  if (cell.cy * BUILD.wallHeight >= BUILD.ceilingY) {
    return { ok: false, reason: PlacementResult.ABOVE_CEILING };
  }

  // Rule 4 — playable boundary.
  if (playableExtent !== null) {
    const c = cellCentre(cell.cx, cell.cy, cell.cz);
    const half = playableExtent / 2;
    if (Math.abs(c.x) > half || Math.abs(c.z) > half) {
      return { ok: false, reason: PlacementResult.OUTSIDE_BOUNDARY };
    }
  }

  // Rule 4 — slot occupied.
  if (grid.isSlotOccupied(cell, slotFor(type, direction))) {
    return { ok: false, reason: PlacementResult.SLOT_OCCUPIED };
  }

  // Rule 2 — placement range, camera to target cell centre.
  const c = cellCentre(cell.cx, cell.cy, cell.cz);
  const dist = Math.hypot(
    c.x - builder.position.x,
    c.y - builder.position.y,
    c.z - builder.position.z
  );
  if (dist > BUILD.placementRange) {
    return { ok: false, reason: PlacementResult.OUT_OF_RANGE };
  }

  // Rule 4 — material cost.
  if ((builder.materials?.[material] ?? 0) < BUILD.cost) {
    return { ok: false, reason: PlacementResult.INSUFFICIENT_MATERIAL };
  }

  // Rule 4 — would intersect any player capsule, the builder included.
  const bounds = pieceWorldBounds(type, direction, cell);
  for (const player of players) {
    if (overlapsPlayer(bounds, player)) {
      return { ok: false, reason: PlacementResult.BLOCKED_BY_PLAYER };
    }
  }

  return { ok: true, reason: PlacementResult.OK };
}

/**
 * Validate, then place. Deducts material (rule 1) and stamps the rate limit.
 * @returns {{ok:boolean, reason:string, piece?:BuildPiece}}
 */
export function placePiece(req) {
  const check = validatePlacement(req);
  if (!check.ok) return check;

  const { grid, type, material, cell, direction = 'north', builder, now = 0 } = req;

  builder.materials[material] -= BUILD.cost;
  builder.lastPlacementTime = now;

  const piece = new BuildPiece({ type, material, cell, direction, ownerId: builder.id ?? 0 });
  grid.add(piece);
  return { ok: true, reason: PlacementResult.OK, piece };
}
