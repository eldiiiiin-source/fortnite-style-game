/**
 * BuildGrid.js — the uniform build grid and the pieces in it. MASTER_SPEC §6.1.
 *
 * Cells are integer (cx, cy, cz). Each cell holds at most one piece per slot:
 *   floor, ramp, cone, wall:north, wall:east, wall:south, wall:west
 */
import { BUILD } from '../core/Config.js';

export const cellKey = (cx, cy, cz) => `${cx},${cy},${cz}`;

/** World position → the cell containing it. */
export function worldToCell(x, y, z) {
  return {
    cx: Math.floor(x / BUILD.tileSize),
    cy: Math.floor(y / BUILD.wallHeight),
    cz: Math.floor(z / BUILD.tileSize)
  };
}

/** Cell → world position of its minimum corner. */
export function cellToWorld(cx, cy, cz) {
  return { x: cx * BUILD.tileSize, y: cy * BUILD.wallHeight, z: cz * BUILD.tileSize };
}

/** Cell → world position of its centre. */
export function cellCentre(cx, cy, cz) {
  return {
    x: (cx + 0.5) * BUILD.tileSize,
    y: (cy + 0.5) * BUILD.wallHeight,
    z: (cz + 0.5) * BUILD.tileSize
  };
}

/** The neighbouring cell through a given wall face. */
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
    /** @type {Map<string, Map<string, import('./BuildPiece.js').BuildPiece>>} */
    this.cells = new Map();
    /** @type {Map<number, import('./BuildPiece.js').BuildPiece>} */
    this.piecesById = new Map();
  }

  get pieceCount() {
    return this.piecesById.size;
  }

  getCell(cx, cy, cz) {
    return this.cells.get(cellKey(cx, cy, cz)) ?? null;
  }

  /** The piece occupying a slot, or null. */
  getPiece(cell, slot) {
    return this.getCell(cell.cx, cell.cy, cell.cz)?.get(slot) ?? null;
  }

  isSlotOccupied(cell, slot) {
    return this.getPiece(cell, slot) !== null;
  }

  /** All pieces in a cell. */
  piecesInCell(cx, cy, cz) {
    const map = this.getCell(cx, cy, cz);
    return map ? [...map.values()] : [];
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
  }

  /** Advance every piece's build ramp (§6.4). */
  update(dt) {
    for (const piece of this.piecesById.values()) piece.update(dt);
  }

  *[Symbol.iterator]() {
    yield* this.piecesById.values();
  }

  clear() {
    this.cells.clear();
    this.piecesById.clear();
  }
}
