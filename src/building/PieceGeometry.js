/**
 * PieceGeometry.js — the SINGLE source of piece shape. MASTER_SPEC §9.2, §10.4, §11.
 *
 * Both the renderer and the collision world build from this module, from the same edit
 * pattern. That is what makes "preview collision and final collision must not disagree"
 * (§9.2) and "edited collision must match the visible edited shape" (§10.4) structural
 * guarantees rather than things to remember to keep in sync.
 *
 * All dimensions derive from TILE and WALL_H (§9.1.1). No spatial literals here.
 *
 * Two shape kinds:
 *   - BOXES     walls and floors: axis-aligned solids, one per remaining edit tile
 *   - SURFACES  ramps and cones: sloped height fields, queried per (x, z)
 *
 * Ramps are surfaces, not stacked boxes, because one ramp edit row rises WALL_H/3 =
 * 1.28 m against a 0.45 m step height — a stepped collider would wall the player off
 * their own ramp.
 */
import { TILE, WALL_H, BUILD, EDIT_GRIDS } from '../core/Config.js';

/** Cell minimum corner in world space. */
export function cellOrigin(cell) {
  return { x: cell.cx * TILE, y: cell.cy * WALL_H, z: cell.cz * TILE };
}

/** The set of removed tile indices for a piece, from its current edit pattern. */
export function removedTiles(piece) {
  return new Set(piece.editPattern?.removed ?? []);
}

/* ── walls ─────────────────────────────────────────────────────────────────── */

/**
 * Wall tiles, 3x3. Index = row * 3 + col, row 0 is the TOP row.
 * `u` is the horizontal axis across the wall face; `v` is vertical.
 */
export function wallBoxes(piece) {
  const { cols, rows } = EDIT_GRIDS.wall;
  const o = cellOrigin(piece.cell);
  const removed = removedTiles(piece);
  const tw = TILE / cols;
  const th = WALL_H / rows;
  const k = BUILD.thickness;

  // Slab position along the wall's thin axis, per face.
  const slab = {
    north: { axis: 'z', min: o.z, max: o.z + k },
    south: { axis: 'z', min: o.z + TILE - k, max: o.z + TILE },
    west: { axis: 'x', min: o.x, max: o.x + k },
    east: { axis: 'x', min: o.x + TILE - k, max: o.x + TILE }
  }[piece.direction] ?? { axis: 'z', min: o.z, max: o.z + k };

  const boxes = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (removed.has(row * cols + col)) continue;

      // Row 0 is the top row, so it occupies the HIGHEST band.
      const yMin = o.y + (rows - 1 - row) * th;
      const yMax = yMin + th;

      if (slab.axis === 'z') {
        const xMin = o.x + col * tw;
        boxes.push({ min: [xMin, yMin, slab.min], max: [xMin + tw, yMax, slab.max] });
      } else {
        const zMin = o.z + col * tw;
        boxes.push({ min: [slab.min, yMin, zMin], max: [slab.max, yMax, zMin + tw] });
      }
    }
  }
  return boxes;
}

/* ── floors ────────────────────────────────────────────────────────────────── */

/** Floor tiles, 2x2 viewed from above. Index = row * 2 + col; row runs along +Z. */
export function floorBoxes(piece) {
  const { cols, rows } = EDIT_GRIDS.floor;
  const o = cellOrigin(piece.cell);
  const removed = removedTiles(piece);
  const tw = TILE / cols;
  const td = TILE / rows;
  const k = BUILD.thickness;

  const boxes = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (removed.has(row * cols + col)) continue;
      const xMin = o.x + col * tw;
      const zMin = o.z + row * td;
      boxes.push({ min: [xMin, o.y, zMin], max: [xMin + tw, o.y + k, zMin + td] });
    }
  }
  return boxes;
}

/* ── ramps ─────────────────────────────────────────────────────────────────── */

/**
 * Ramp sections, 3 rows x 2 columns, as sloped surfaces. §10.7, §10.8
 *
 *   [0][1]  top row    — highest, at the ascending edge
 *   [2][3]  middle
 *   [4][5]  bottom row — lowest, at the descending edge
 *
 * Each surviving section is a sloped quad. The whole ramp rises WALL_H over TILE, so the
 * slope is atan(WALL_H / TILE) = 36.87 degrees regardless of which sections remain.
 */
export function rampSections(piece) {
  const { cols, rows } = EDIT_GRIDS.ramp;
  const o = cellOrigin(piece.cell);
  const removed = removedTiles(piece);
  const sectionW = TILE / cols;
  const sectionD = TILE / rows;

  const sections = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (removed.has(row * cols + col)) continue;
      sections.push({ row, col, ...sectionBounds(piece, o, row, col, sectionW, sectionD) });
    }
  }
  return sections;
}

/**
 * World bounds and edge heights of one ramp section.
 * The ramp ascends toward `piece.direction`; row 0 is nearest that edge.
 */
function sectionBounds(piece, o, row, col, sectionW, sectionD) {
  const rows = EDIT_GRIDS.ramp.rows;
  // Fraction along the ascent at the low and high edges of this row.
  const sLow = (rows - 1 - row) / rows;
  const sHigh = (rows - row) / rows;
  const yLow = o.y + sLow * WALL_H;
  const yHigh = o.y + sHigh * WALL_H;

  // Lay the section out with the ascent axis running toward `direction`.
  let min, max;
  switch (piece.direction) {
    case 'north':  // ascends toward -Z, row 0 at the -Z edge
      min = [o.x + col * sectionW, o.y, o.z + row * sectionD];
      max = [min[0] + sectionW, o.y + WALL_H, min[2] + sectionD];
      break;
    case 'south':  // ascends toward +Z
      min = [o.x + col * sectionW, o.y, o.z + TILE - (row + 1) * sectionD];
      max = [min[0] + sectionW, o.y + WALL_H, min[2] + sectionD];
      break;
    case 'west':   // ascends toward -X
      min = [o.x + row * sectionD, o.y, o.z + col * sectionW];
      max = [min[0] + sectionD, o.y + WALL_H, min[2] + sectionW];
      break;
    case 'east':   // ascends toward +X
      min = [o.x + TILE - (row + 1) * sectionD, o.y, o.z + col * sectionW];
      max = [min[0] + sectionD, o.y + WALL_H, min[2] + sectionW];
      break;
    default:
      min = [o.x + col * sectionW, o.y, o.z + row * sectionD];
      max = [min[0] + sectionW, o.y + WALL_H, min[2] + sectionD];
  }
  return { min, max, yLow, yHigh };
}

/**
 * Walkable surface height of a ramp at a world (x, z), or null if no section covers it.
 * This is the query the collision world uses — an edit that removes a section leaves a
 * genuine hole, because this returns null there.
 */
export function rampHeightAt(piece, x, z) {
  const o = cellOrigin(piece.cell);
  // Fraction of the ascent at this point, 0 at the low edge, 1 at the high edge.
  let s;
  switch (piece.direction) {
    case 'north': s = 1 - (z - o.z) / TILE; break;
    case 'south': s = (z - o.z) / TILE; break;
    case 'west': s = 1 - (x - o.x) / TILE; break;
    case 'east': s = (x - o.x) / TILE; break;
    default: s = 1 - (z - o.z) / TILE;
  }
  if (s < 0 || s > 1) return null;
  if (x < o.x || x > o.x + TILE || z < o.z || z > o.z + TILE) return null;

  // Which section covers this point?
  const { cols, rows } = EDIT_GRIDS.ramp;
  const row = Math.min(rows - 1, Math.floor((1 - s) * rows));
  let col;
  switch (piece.direction) {
    case 'north':
    case 'south': col = Math.min(cols - 1, Math.floor((x - o.x) / (TILE / cols))); break;
    default: col = Math.min(cols - 1, Math.floor((z - o.z) / (TILE / cols)));
  }
  if (removedTiles(piece).has(row * cols + col)) return null;

  return o.y + s * WALL_H;
}

/* ── cones ─────────────────────────────────────────────────────────────────── */

/**
 * Cone quadrants, 2x2. Each surviving quadrant is a sloped face rising from the cell's
 * outer edge to the apex at the cell centre top. The face slope is steeper than the
 * walkable limit by design — that is what makes a cone a ramp-push counter.
 */
export function coneQuadrants(piece) {
  const { cols, rows } = EDIT_GRIDS.cone;
  const o = cellOrigin(piece.cell);
  const removed = removedTiles(piece);
  const qw = TILE / cols;
  const qd = TILE / rows;

  const quads = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (removed.has(row * cols + col)) continue;
      const xMin = o.x + col * qw;
      const zMin = o.z + row * qd;
      quads.push({
        row, col,
        min: [xMin, o.y, zMin],
        max: [xMin + qw, o.y + WALL_H, zMin + qd],
        apex: { x: o.x + TILE / 2, y: o.y + WALL_H, z: o.z + TILE / 2 }
      });
    }
  }
  return quads;
}

/** Cone surface height at a world (x, z), or null. */
export function coneHeightAt(piece, x, z) {
  const o = cellOrigin(piece.cell);
  const lx = x - o.x;
  const lz = z - o.z;
  if (lx < 0 || lx > TILE || lz < 0 || lz > TILE) return null;

  const { cols, rows } = EDIT_GRIDS.cone;
  const col = Math.min(cols - 1, Math.floor(lx / (TILE / cols)));
  const row = Math.min(rows - 1, Math.floor(lz / (TILE / rows)));
  if (removedTiles(piece).has(row * cols + col)) return null;

  // Pyramid: height falls linearly with Chebyshev distance from the centre.
  const half = TILE / 2;
  const d = Math.max(Math.abs(lx - half), Math.abs(lz - half)) / half;
  return o.y + WALL_H * (1 - d);
}

/* ── unified interface ─────────────────────────────────────────────────────── */

/**
 * Every solid box of a piece. Walls and floors only; ramps and cones are surfaces and
 * are queried through heightAt.
 */
export function solidBoxes(piece) {
  switch (piece.type) {
    case 'wall': return wallBoxes(piece);
    case 'floor': return floorBoxes(piece);
    default: return [];
  }
}

/** Walkable surface height of a piece at (x, z), or null if nothing is there. */
export function surfaceHeightAt(piece, x, z) {
  switch (piece.type) {
    case 'ramp': return rampHeightAt(piece, x, z);
    case 'cone': return coneHeightAt(piece, x, z);
    case 'floor': {
      for (const box of floorBoxes(piece)) {
        if (x >= box.min[0] && x <= box.max[0] && z >= box.min[2] && z <= box.max[2]) {
          return box.max[1];
        }
      }
      return null;
    }
    default: return null;
  }
}

/** Whole-piece AABB, used for broad-phase and for edit-target raycasts. */
export function pieceBounds(piece) {
  const o = cellOrigin(piece.cell);
  if (piece.type === 'wall') {
    const k = BUILD.thickness;
    switch (piece.direction) {
      case 'north': return { min: [o.x, o.y, o.z], max: [o.x + TILE, o.y + WALL_H, o.z + k] };
      case 'south': return { min: [o.x, o.y, o.z + TILE - k], max: [o.x + TILE, o.y + WALL_H, o.z + TILE] };
      case 'west': return { min: [o.x, o.y, o.z], max: [o.x + k, o.y + WALL_H, o.z + TILE] };
      default: return { min: [o.x + TILE - k, o.y, o.z], max: [o.x + TILE, o.y + WALL_H, o.z + TILE] };
    }
  }
  if (piece.type === 'floor') {
    return { min: [o.x, o.y, o.z], max: [o.x + TILE, o.y + BUILD.thickness, o.z + TILE] };
  }
  return { min: [o.x, o.y, o.z], max: [o.x + TILE, o.y + WALL_H, o.z + TILE] };
}
