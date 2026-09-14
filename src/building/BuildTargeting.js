/**
 * BuildTargeting.js — resolve the crosshair to a build cell and slot. MASTER_SPEC §6.3.
 *
 * The crosshair ray is stepped forward to the placement range; the first cell whose
 * target slot is free is the placement candidate. Terrain never blocks (§6.3 rule 5), so
 * this is a pure grid walk, not a physics query.
 */
import { BUILD, DIRECTIONS } from '../core/Config.js';
import { worldToCell } from './BuildGrid.js';

/** Which wall face a look direction is most aligned with. */
export function facingDirection(dirX, dirZ) {
  return Math.abs(dirX) > Math.abs(dirZ)
    ? (dirX > 0 ? 'east' : 'west')
    : (dirZ > 0 ? 'south' : 'north');
}

/**
 * Resolve a placement target.
 *
 * @param {object} opts
 * @param {{x,y,z}} opts.origin      camera position
 * @param {{x,y,z}} opts.direction   normalised look direction
 * @param {string} opts.pieceType
 * @param {string} [opts.rotation]   player-chosen ramp/cone facing
 * @param {import('./BuildGrid.js').BuildGrid} opts.grid
 * @param {number} [opts.step]       march step in metres
 * @returns {{cell:object, direction:string, distance:number} | null}
 */
export function resolveBuildTarget({
  origin, direction, pieceType, rotation = null, grid, step = 0.35, minDistance = 0
}) {
  const range = BUILD.placementRange;
  // Walls face the player, so the default direction is the one the player is looking at.
  const lookDir = facingDirection(direction.x, direction.z);

  let lastCellKey = null;

  // The aim ray starts at the CAMERA (§8.1), which sits behind the player. Marching from
  // zero would target cells around and behind the character, so the walk begins once the
  // ray has cleared the camera-to-player gap.
  for (let d = minDistance; d <= range; d += step) {
    const px = origin.x + direction.x * d;
    const py = origin.y + direction.y * d;
    const pz = origin.z + direction.z * d;

    const cell = worldToCell(px, py, pz);
    const key = `${cell.cx},${cell.cy},${cell.cz}`;
    if (key === lastCellKey) continue;
    lastCellKey = key;

    // For a wall, place on the face nearest the player; for a ramp/cone, use the
    // player's chosen rotation; a floor has no direction.
    const pieceDirection = pieceType === 'wall'
      ? lookDir
      : (rotation ?? DIRECTIONS[0]);

    const slot = pieceType === 'wall' ? `wall:${pieceDirection}` : pieceType;
    if (!grid.isSlotOccupied(cell, slot)) {
      return { cell, direction: pieceDirection, distance: d };
    }
  }

  return null;
}

/**
 * Resolve the piece the crosshair is on, for editing (§7.2).
 * Marches the ray and returns the first piece it enters the cell of.
 */
export function resolveEditTarget({ origin, direction, grid, maxDistance = 8, step = 0.2 }) {
  let lastCellKey = null;
  for (let d = 0; d <= maxDistance; d += step) {
    const cell = worldToCell(
      origin.x + direction.x * d,
      origin.y + direction.y * d,
      origin.z + direction.z * d
    );
    const key = `${cell.cx},${cell.cy},${cell.cz}`;
    if (key === lastCellKey) continue;
    lastCellKey = key;

    const pieces = grid.piecesInCell(cell.cx, cell.cy, cell.cz);
    if (pieces.length > 0) {
      // Prefer the wall facing the player, then floor, ramp, cone.
      const lookDir = facingDirection(direction.x, direction.z);
      const preferred =
        pieces.find((p) => p.type === 'wall' && p.direction === lookDir) ??
        pieces.find((p) => p.type === 'wall') ??
        pieces.find((p) => p.type === 'floor') ??
        pieces[0];
      return { piece: preferred, distance: d };
    }
  }
  return null;
}
