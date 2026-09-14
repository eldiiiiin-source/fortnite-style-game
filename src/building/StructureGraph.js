/**
 * StructureGraph.js — support propagation and cascade destruction. MASTER_SPEC §6.5.
 *
 * A piece is supported if it transitively connects to terrain. Support is recomputed by
 * flood fill from terrain-grounded pieces; anything not reached is unsupported and is
 * destroyed after the grace period.
 */
import { BUILD } from '../core/Config.js';
import { cellKey, neighbourCell, OPPOSITE } from './BuildGrid.js';

/**
 * @typedef {(cx:number, cz:number) => number} TerrainHeightFn
 * Returns terrain height in metres at the centre of build cell (cx, cz).
 */

/**
 * Does this piece touch terrain directly?
 *
 * The span is widened by one piece thickness at BOTH ends. The upper tolerance lets a piece
 * buried in the ground count as grounded (§6.3 rule 5 allows the intersection). The lower
 * one is not cosmetic: POI pads are snapped to a storey line (MAP_SPEC §21.2.1), so a whole
 * POI's ground storey sits exactly ON this boundary, and an exact comparison then turns on
 * floating-point noise — Hollow Farm's fence corner sits 0.3 mm below its pad and was
 * "floating". A piece resting on the ground is grounded; a third of a millimetre is not a
 * structural fact.
 */
export function touchesTerrain(piece, terrainHeightAt) {
  if (!terrainHeightAt) return piece.cell.cy === 0; // flat world fallback: layer 0 is grounded
  const groundY = terrainHeightAt(piece.cell.cx, piece.cell.cz);
  const cellBase = piece.cell.cy * BUILD.wallHeight;
  const cellTop = cellBase + BUILD.wallHeight;
  return groundY >= cellBase - BUILD.thickness && groundY < cellTop + BUILD.thickness;
}

/**
 * Pieces that directly support `piece`, per the three rules in §6.5.
 * Returns pieces that must exist for this one to stand.
 */
export function supportersOf(piece, grid) {
  const { cx, cy, cz } = piece.cell;
  const below = { cx, cy: cy - 1, cz };
  const out = [];
  const push = (p) => { if (p && !p.destroyed) out.push(p); };

  if (piece.type === 'floor') {
    // Walls on any of the four edges of this cell, or of the cell below sharing the edge.
    for (const dir of ['north', 'east', 'south', 'west']) {
      push(grid.getPiece(piece.cell, `wall:${dir}`));
      push(grid.getPiece(below, `wall:${dir}`));
      // A wall on the neighbour's opposing face is the same physical wall plane.
      const n = neighbourCell(piece.cell, dir);
      push(grid.getPiece(n, `wall:${OPPOSITE[dir]}`));
    }
    // A ramp or cone in the cell below holds a floor up.
    push(grid.getPiece(below, 'ramp'));
    push(grid.getPiece(below, 'cone'));
    // A ramp in the NEIGHBOURING cell one layer down, ascending back toward this floor, tops
    // out exactly at this floor's edge and carries it. Without this a ramp-then-floor — the
    // commonest build in the game, and what every pitched roof in the world is made of —
    // has nothing holding its landing up.
    for (const dir of ['north', 'east', 'south', 'west']) {
      const ramp = grid.getPiece({ ...neighbourCell(piece.cell, dir), cy: cy - 1 }, 'ramp');
      if (ramp && ramp.direction === OPPOSITE[dir]) push(ramp);
    }
    // An adjacent floor at the same layer.
    for (const dir of ['north', 'east', 'south', 'west']) {
      push(grid.getPiece(neighbourCell(piece.cell, dir), 'floor'));
    }
  } else if (piece.type === 'wall') {
    // A floor at this wall's base, or a supported wall directly below.
    push(grid.getPiece(piece.cell, 'floor'));
    push(grid.getPiece(below, `wall:${piece.direction}`));
    push(grid.getPiece(below, 'floor'));
  } else {
    // Ramp and cone: a floor in their cell, or any piece in the cell below.
    push(grid.getPiece(piece.cell, 'floor'));
    push(grid.getPiece(below, 'floor'));
    push(grid.getPiece(below, 'ramp'));
    push(grid.getPiece(below, 'cone'));
    for (const dir of ['north', 'east', 'south', 'west']) {
      push(grid.getPiece(below, `wall:${dir}`));
    }
  }

  return out;
}

/**
 * Flood fill from terrain-grounded pieces outward through the support relation.
 * @returns {Set<number>} ids of supported pieces
 */
export function computeSupported(grid, terrainHeightAt = null) {
  const supported = new Set();

  // Seed: every piece that touches terrain directly.
  const queue = [];
  for (const piece of grid) {
    if (piece.destroyed) continue;
    if (touchesTerrain(piece, terrainHeightAt)) {
      supported.add(piece.id);
      queue.push(piece);
    }
  }

  // Reverse index: for each piece, who lists it as a supporter?
  const dependents = new Map(); // supporterId -> [dependent pieces]
  for (const piece of grid) {
    if (piece.destroyed) continue;
    for (const s of supportersOf(piece, grid)) {
      if (!dependents.has(s.id)) dependents.set(s.id, []);
      dependents.get(s.id).push(piece);
    }
  }

  while (queue.length > 0) {
    const current = queue.pop();
    for (const dep of dependents.get(current.id) ?? []) {
      if (!supported.has(dep.id)) {
        supported.add(dep.id);
        queue.push(dep);
      }
    }
  }

  return supported;
}

/**
 * Tick support. Unsupported pieces are destroyed after BUILD.supportGraceTime (§6.5).
 *
 * @returns {import('./BuildPiece.js').BuildPiece[]} pieces destroyed this tick
 */
export function updateSupport(grid, dt, terrainHeightAt = null, onDestroyed = null) {
  const supported = computeSupported(grid, terrainHeightAt);
  const destroyed = [];

  for (const piece of [...grid]) {
    if (piece.destroyed) continue;
    if (supported.has(piece.id)) {
      piece.unsupportedFor = null;
      continue;
    }
    piece.unsupportedFor = (piece.unsupportedFor ?? 0) + dt;
    if (piece.unsupportedFor >= BUILD.supportGraceTime) {
      piece.destroyed = true;
      destroyed.push(piece);
    }
  }

  for (const piece of destroyed) {
    grid.remove(piece);
    onDestroyed?.(piece);
  }

  return destroyed;
}

/** Remove a destroyed piece and let support re-evaluation cascade on the next tick. */
export function destroyPiece(grid, piece) {
  piece.destroyed = true;
  grid.remove(piece);
}

export { cellKey };
