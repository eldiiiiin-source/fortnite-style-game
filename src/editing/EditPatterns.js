/**
 * EditPatterns.js — the 3x3 edit allow-list. MASTER_SPEC §7.1, §7.3 - §7.6.
 *
 * Selection is the set of REMOVED tiles, indexed:
 *     0 1 2
 *     3 4 5
 *     6 7 8
 *
 * This is an allow list, not a blacklist: a selection that does not appear here is
 * rejected by construction (§7.7, references/editing/01-edit-patterns.md).
 */

/** Canonical key for a selection: sorted indices joined by commas. '' = full piece. */
export function selectionKey(tiles) {
  return [...new Set(tiles)].sort((a, b) => a - b).join(',');
}

/** Wall patterns — §7.3 */
export const WALL_PATTERNS = Object.freeze({
  '': { name: 'Full wall', removed: [] },
  '4': { name: 'Window', removed: [4] },
  '6,7': { name: 'Door', removed: [6, 7] },
  '6,7,8': { name: 'Doorway wide', removed: [6, 7, 8] },
  '0,1,2,3,4,5': { name: 'Half wall (bottom)', removed: [0, 1, 2, 3, 4, 5] },
  '2,5,8': { name: 'Corner (left)', removed: [2, 5, 8] },
  '0,3,6': { name: 'Corner (right)', removed: [0, 3, 6] },
  '3': { name: 'Peek left', removed: [3] },
  '5': { name: 'Peek right', removed: [5] }
});

/** Floor patterns — §7.4 */
export const FLOOR_PATTERNS = Object.freeze({
  '': { name: 'Full floor', removed: [] },
  '4': { name: 'Centre hole', removed: [4] },
  '0': { name: 'Quarter hole (NW)', removed: [0] },
  '2': { name: 'Quarter hole (NE)', removed: [2] },
  '6': { name: 'Quarter hole (SW)', removed: [6] },
  '8': { name: 'Quarter hole (SE)', removed: [8] },
  '0,1,3,4': { name: 'Half floor', removed: [0, 1, 3, 4] },
  '0,1,2,3,4,5,6,7,8': { name: 'Full drop', removed: [0, 1, 2, 3, 4, 5, 6, 7, 8], deletesPiece: true }
});

/** Ramp patterns — §7.5 */
export const RAMP_PATTERNS = Object.freeze({
  '': { name: 'Full ramp', removed: [] },
  '0,3,6': { name: 'Half ramp (left)', removed: [0, 3, 6] },
  '2,5,8': { name: 'Half ramp (right)', removed: [2, 5, 8] },
  '6,7,8': { name: 'Ramp with platform', removed: [6, 7, 8] },
  '0,1,2': { name: 'Inverted step', removed: [0, 1, 2] }
});

/** Cone patterns — §7.6 */
export const CONE_PATTERNS = Object.freeze({
  '': { name: 'Full cone', removed: [] },
  '0,1,2': { name: 'Half cone', removed: [0, 1, 2] },
  '0,1,2,3': { name: 'Quarter cone', removed: [0, 1, 2, 3] }
});

export const PATTERNS_BY_TYPE = Object.freeze({
  wall: WALL_PATTERNS,
  floor: FLOOR_PATTERNS,
  ramp: RAMP_PATTERNS,
  cone: CONE_PATTERNS
});

/**
 * Resolve a selection to a pattern.
 * @param {string} pieceType
 * @param {number[]} tiles  selected (removed) tile indices
 * @returns {{key:string, name:string, removed:number[], deletesPiece?:boolean} | null}
 */
export function resolvePattern(pieceType, tiles) {
  const table = PATTERNS_BY_TYPE[pieceType];
  if (!table) return null;
  const key = selectionKey(tiles);
  const pattern = table[key];
  return pattern ? { key, ...pattern } : null;
}

export function isValidSelection(pieceType, tiles) {
  return resolvePattern(pieceType, tiles) !== null;
}

/** Every valid pattern for a piece type, for the UI and for tests. */
export function patternsFor(pieceType) {
  return Object.entries(PATTERNS_BY_TYPE[pieceType] ?? {})
    .map(([key, p]) => ({ key, ...p }));
}

/** Render a selection as the ASCII diagram used in references/editing/. */
export function renderSelection(tiles) {
  const removed = new Set(tiles);
  const rows = [];
  for (let r = 0; r < 3; r++) {
    const row = [];
    for (let c = 0; c < 3; c++) row.push(removed.has(r * 3 + c) ? '·' : '#');
    rows.push(row.join(' '));
  }
  return rows.join('\n');
}
