/**
 * EditPatterns.js — per-piece-type edit grids. MASTER_SPEC §10.2 - §10.7.
 *
 * The grids are NOT uniform:
 *   wall  3x3 (9 tiles)   floor 2x2 (4)   cone 2x2 (4)   ramp 3 rows x 2 cols (6)
 *
 * A selection is the set of REMOVED tiles. Tables are ALLOW LISTS: anything not listed is
 * rejected by construction (§10.3 "Invalid patterns must be rejected"), so there is no
 * blacklist to keep in sync.
 *
 * Walkable openings are VERTICAL. One wall row is WALL_H/3 = 1.28 m and a standing player
 * is WALL_H/2 = 1.92 m, so a horizontal opening cannot be walked through (§9.1.1).
 */
import { EDIT_GRIDS } from '../core/Config.js';

/** Canonical key for a selection: sorted indices, comma-joined. '' is the full piece. */
export function selectionKey(tiles) {
  return [...new Set(tiles)].sort((a, b) => a - b).join(',');
}

/**
 * Wall — 3x3. §10.3
 *
 *   0 1 2
 *   3 4 5
 *   6 7 8
 */
export const WALL_PATTERNS = Object.freeze({
  '': { name: 'Full wall', removed: [] },

  // Walkable openings — vertical, middle column.
  '4,7': { name: 'Door', removed: [4, 7], walkable: true },
  '1,4,7': { name: 'Arch / three-tile opening', removed: [1, 4, 7], walkable: true },
  '3,4,7': { name: 'Door + left window', removed: [3, 4, 7], walkable: true },
  '4,5,7': { name: 'Door + right window', removed: [4, 5, 7], walkable: true },
  '0,3,6': { name: 'Left column opening', removed: [0, 3, 6], walkable: true },
  '2,5,8': { name: 'Right column opening', removed: [2, 5, 8], walkable: true },

  // Windows and peeks — not walkable.
  '4': { name: 'Centre window', removed: [4] },
  '3': { name: 'Left window', removed: [3] },
  '5': { name: 'Right window', removed: [5] },
  '1': { name: 'High window', removed: [1] },
  '3,5': { name: 'Double side window', removed: [3, 5] },

  // Structural cuts.
  '0,1,2': { name: 'Top row removed', removed: [0, 1, 2] },
  '0,1,2,3,4,5': { name: 'Half wall', removed: [0, 1, 2, 3, 4, 5] },
  '6,7,8': { name: 'Bottom row (crouch)', removed: [6, 7, 8] },
  '0,1,3,4': { name: 'Corner opening (top left)', removed: [0, 1, 3, 4] },
  '1,2,4,5': { name: 'Corner opening (top right)', removed: [1, 2, 4, 5] },
  '3,4,6,7': { name: 'Corner opening (bottom left)', removed: [3, 4, 6, 7], walkable: true },
  '4,5,7,8': { name: 'Corner opening (bottom right)', removed: [4, 5, 7, 8], walkable: true }
});

/**
 * Floor — 2x2. §10.5  Viewed from above, player facing toward the top.
 *
 *   0 1
 *   2 3
 */
export const FLOOR_PATTERNS = Object.freeze({
  '': { name: 'Full floor', removed: [] },
  '0': { name: 'Quarter (NW)', removed: [0] },
  '1': { name: 'Quarter (NE)', removed: [1] },
  '2': { name: 'Quarter (SW)', removed: [2] },
  '3': { name: 'Quarter (SE)', removed: [3] },
  '0,1': { name: 'Half (north)', removed: [0, 1] },
  '2,3': { name: 'Half (south)', removed: [2, 3] },
  '0,2': { name: 'Half (west)', removed: [0, 2] },
  '1,3': { name: 'Half (east)', removed: [1, 3] },
  '0,1,2,3': { name: 'Full drop', removed: [0, 1, 2, 3], deletesPiece: true }
});

/** Cone / roof — 2x2. §10.6 */
export const CONE_PATTERNS = Object.freeze({
  '': { name: 'Full cone', removed: [] },
  '0': { name: 'Quarter (NW)', removed: [0] },
  '1': { name: 'Quarter (NE)', removed: [1] },
  '2': { name: 'Quarter (SW)', removed: [2] },
  '3': { name: 'Quarter (SE)', removed: [3] },
  '0,1': { name: 'Half (north)', removed: [0, 1] },
  '2,3': { name: 'Half (south)', removed: [2, 3] },
  '0,2': { name: 'Half (west)', removed: [0, 2] },
  '1,3': { name: 'Half (east)', removed: [1, 3] },
  '0,1,2,3': { name: 'Full removal', removed: [0, 1, 2, 3], deletesPiece: true }
});

/**
 * Ramp / stair — 3 rows x 2 columns. §10.7
 *
 *   [0][1]   <- top row    (highest)
 *   [2][3]   <- middle row
 *   [4][5]   <- bottom row (lowest)
 *
 * The visual stair corresponds directly to the grid: a removed tile removes that section
 * of the stair, and the collision plane spans only the rows that remain (§10.8).
 */
export const RAMP_PATTERNS = Object.freeze({
  '': { name: 'Full ramp', removed: [] },

  // Directional halves — take height while keeping cover on the exposed side.
  '0,2,4': { name: 'Half ramp (left)', removed: [0, 2, 4] },
  '1,3,5': { name: 'Half ramp (right)', removed: [1, 3, 5] },

  // Flipped / rotated forms. §10.8 makes stale collision on these a hard failure.
  '0,1': { name: 'Flipped stair (top removed)', removed: [0, 1], flipped: true },
  '4,5': { name: 'Landing (bottom removed)', removed: [4, 5] },
  '0,1,2,3': { name: 'Low step', removed: [0, 1, 2, 3] },
  '2,3,4,5': { name: 'High step', removed: [2, 3, 4, 5] },

  // Half-stair style edits.
  '0,3,4': { name: 'Diagonal stair (left lead)', removed: [0, 3, 4] },
  '1,2,5': { name: 'Diagonal stair (right lead)', removed: [1, 2, 5] },

  '0,1,2,3,4,5': { name: 'Full removal', removed: [0, 1, 2, 3, 4, 5], deletesPiece: true }
});

export const PATTERNS_BY_TYPE = Object.freeze({
  wall: WALL_PATTERNS,
  floor: FLOOR_PATTERNS,
  cone: CONE_PATTERNS,
  ramp: RAMP_PATTERNS
});

/** Grid dimensions for a piece type. */
export function gridFor(pieceType) {
  return EDIT_GRIDS[pieceType] ?? null;
}

/** Number of selectable tiles for a piece type. */
export function tileCount(pieceType) {
  return EDIT_GRIDS[pieceType]?.tiles ?? 0;
}

/** Is this a legal tile index for the piece type's grid? */
export function isValidTile(pieceType, index) {
  const grid = EDIT_GRIDS[pieceType];
  return !!grid && Number.isInteger(index) && index >= 0 && index < grid.tiles;
}

/** Tile index -> {row, col} in the piece's own grid. */
export function tileToRowCol(pieceType, index) {
  const grid = EDIT_GRIDS[pieceType];
  if (!grid) return null;
  return { row: Math.floor(index / grid.cols), col: index % grid.cols };
}

export function rowColToTile(pieceType, row, col) {
  const grid = EDIT_GRIDS[pieceType];
  if (!grid) return -1;
  if (row < 0 || row >= grid.rows || col < 0 || col >= grid.cols) return -1;
  return row * grid.cols + col;
}

/**
 * Resolve a selection to a pattern, or null if it is not in the allow list.
 * @returns {{key:string,name:string,removed:number[],walkable?:boolean,deletesPiece?:boolean}|null}
 */
export function resolvePattern(pieceType, tiles) {
  const table = PATTERNS_BY_TYPE[pieceType];
  if (!table) return null;
  // A tile outside this piece's grid is invalid regardless of the table.
  for (const t of tiles) if (!isValidTile(pieceType, t)) return null;
  const key = selectionKey(tiles);
  const pattern = table[key];
  return pattern ? { key, ...pattern } : null;
}

export function isValidSelection(pieceType, tiles) {
  return resolvePattern(pieceType, tiles) !== null;
}

export function patternsFor(pieceType) {
  return Object.entries(PATTERNS_BY_TYPE[pieceType] ?? {}).map(([key, p]) => ({ key, ...p }));
}

/** ASCII diagram of a selection, sized to the piece's own grid. */
export function renderSelection(pieceType, tiles) {
  const grid = EDIT_GRIDS[pieceType];
  if (!grid) return '';
  const removed = new Set(tiles);
  const rows = [];
  for (let r = 0; r < grid.rows; r++) {
    const row = [];
    for (let c = 0; c < grid.cols; c++) row.push(removed.has(r * grid.cols + c) ? '·' : '#');
    rows.push(row.join(' '));
  }
  return rows.join('\n');
}
