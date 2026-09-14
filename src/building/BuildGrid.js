/**
 * BuildGrid.js — the build grid. MASTER_SPEC §9.1.
 *
 * Cells are integer (cx, cy, cz). World positions are COMPUTED from those indices and
 * never accumulated, which is what makes "no cumulative drift, no arbitrary per-piece
 * offsets" a structural property rather than a thing to be careful about.
 *
 * `revision` increments on every structural change so dependent systems (collision,
 * renderer) can tell in O(1) that their derived state is stale.
 */
import { TILE, WALL_H } from '../core/Config.js';

export const cellKey = (cx, cy, cz) => `${cx},${cy},${cz}`;
const columnKey = (cx, cz) => `${cx},${cz}`;

export function worldToCell(x, y, z) {
  return {
    cx: Math.floor(x / TILE),
    cy: Math.floor(y / WALL_H),
    cz: Math.floor(z / TILE)
  };
}

export function cellToWorld(cx, cy, cz) {
  return { x: cx * TILE, y: cy * WALL_H, z: cz * TILE };
}

export function cellCentre(cx, cy, cz) {
  return { x: (cx + 0.5) * TILE, y: (cy + 0.5) * WALL_H, z: (cz + 0.5) * TILE };
}

export function neighbourCell(cell, direction) {
  switch (direction) {
    case 'north': return { cx: cell.cx, cy: cell.cy, cz: cell.cz - 1 };
    case 'south': return { cx: cell.cx, cy: cell.cy, cz: cell.cz + 1 };
    case 'east': return { cx: cell.cx + 1, cy: cell.cy, cz: cell.cz };
    case 'west': return { cx: cell.cx - 1, cy: cell.cy, cz: cell.cz };
    default: throw new Error(`Unknown direction: ${direction}`);
  }
}

export const OPPOSITE = Object.freeze({
  north: 'south', south: 'north', east: 'west', west: 'east'
});

export class BuildGrid {
  constructor() {
    this.cells = new Map();        // cellKey -> Map<slot, piece>
    this.piecesById = new Map();
    this.columns = new Map();      // columnKey -> Set<piece>, for vertical queries
    /** Bumped on every add, remove or edit. Derived systems watch this. */
    this.revision = 0;
  }

  /**
   * Pieces a PLAYER placed, excluding the island's own structures (MAP_SPEC §20.1).
   *
   * World structures are real build pieces with ownerId 0, so `pieceCount` counts them —
   * correctly, since they collide and can be destroyed. Anything asking "did player state
   * leak between matches?" needs this instead.
   */
  get playerPieceCount() {
    let n = 0;
    for (const piece of this.piecesById.values()) if (piece.ownerId !== 0) n++;
    return n;
  }

  get pieceCount() {
    return this.piecesById.size;
  }

  /** Call after any change that alters piece geometry, including edits. */
  touch() {
    this.revision++;
  }

  getCell(cx, cy, cz) {
    return this.cells.get(cellKey(cx, cy, cz)) ?? null;
  }

  getPiece(cell, slot) {
    return this.getCell(cell.cx, cell.cy, cell.cz)?.get(slot) ?? null;
  }

  isSlotOccupied(cell, slot) {
    return this.getPiece(cell, slot) !== null;
  }

  piecesInCell(cx, cy, cz) {
    const map = this.getCell(cx, cy, cz);
    return map ? [...map.values()] : [];
  }

  /** Every piece in the vertical column above and below (cx, cz). */
  piecesByColumn(cx, cz) {
    return this.columns.get(columnKey(cx, cz)) ?? [];
  }

  add(piece) {
    const key = cellKey(piece.cell.cx, piece.cell.cy, piece.cell.cz);
    let slots = this.cells.get(key);
    if (!slots) {
      slots = new Map();
      this.cells.set(key, slots);
    }
    if (slots.has(piece.slot)) {
      throw new Error(`Slot ${piece.slot} already occupied at ${key}`);
    }
    slots.set(piece.slot, piece);
    this.piecesById.set(piece.id, piece);

    const ck = columnKey(piece.cell.cx, piece.cell.cz);
    if (!this.columns.has(ck)) this.columns.set(ck, []);
    this.columns.get(ck).push(piece);

    this.touch();
    return piece;
  }

  remove(piece) {
    const key = cellKey(piece.cell.cx, piece.cell.cy, piece.cell.cz);
    const slots = this.cells.get(key);
    if (slots) {
      slots.delete(piece.slot);
      if (slots.size === 0) this.cells.delete(key);
    }
    this.piecesById.delete(piece.id);

    const ck = columnKey(piece.cell.cx, piece.cell.cz);
    const column = this.columns.get(ck);
    if (column) {
      const i = column.indexOf(piece);
      if (i >= 0) column.splice(i, 1);
      if (column.length === 0) this.columns.delete(ck);
    }

    this.touch();
  }

  update(dt) {
    for (const piece of this.piecesById.values()) piece.update(dt);
  }

  *[Symbol.iterator]() {
    yield* this.piecesById.values();
  }

  clear() {
    this.cells.clear();
    this.piecesById.clear();
    this.columns.clear();
    this.touch();
  }
}
