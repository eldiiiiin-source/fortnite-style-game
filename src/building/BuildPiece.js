/**
 * BuildPiece.js — one placed piece. MASTER_SPEC §6.2, §6.4.
 *
 * Pure data + HP logic. No three.js here: this must run in Node for tests (CLAUDE.md).
 */
import { MATERIALS, TILE, WALL_H } from '../core/Config.js';
import { clamp, lerp } from '../core/MathUtils.js';

let nextPieceId = 1;

/** Reset the id counter. Tests only — keeps ids stable across test files. */
export function resetPieceIds() {
  nextPieceId = 1;
}

export class BuildPiece {
  /**
   * @param {object} opts
   * @param {string} opts.type      'wall' | 'floor' | 'ramp' | 'cone'
   * @param {string} opts.material  'wood' | 'brick' | 'metal'
   * @param {{cx:number,cy:number,cz:number}} opts.cell
   * @param {string} [opts.direction]  wall face, or ramp/cone facing
   * @param {number} opts.ownerId
   */
  constructor({ type, material, cell, direction = 'north', ownerId = 0 }) {
    this.id = nextPieceId++;
    this.type = type;
    this.material = material;
    this.cell = { ...cell };
    this.direction = direction;
    this.ownerId = ownerId;

    const mat = MATERIALS[material];
    this.hp = mat.initialHp;
    this.buildProgress = 0;      // 0 → 1 over the material's build time
    this.editPattern = null;     // null = unedited full piece
    this.destroyed = false;
    this.unsupportedFor = null;  // seconds since losing support, null while supported
  }

  get materialDef() {
    return MATERIALS[this.material];
  }

  /** Current maximum HP, ramping from initial to full over build time (§6.4). */
  get maxHp() {
    const { initialHp, fullHp } = this.materialDef;
    return lerp(initialHp, fullHp, this.buildProgress);
  }

  get isFullyBuilt() {
    return this.buildProgress >= 1;
  }

  /** Advance the build ramp. §6.4 */
  update(dt) {
    if (this.buildProgress < 1) {
      this.buildProgress = clamp(this.buildProgress + dt / this.materialDef.buildTime, 0, 1);
      // The piece gains HP as it builds, but damage taken is never undone by the ramp.
      this.hp = Math.min(this.hp + (this.materialDef.fullHp - this.materialDef.initialHp)
        * (dt / this.materialDef.buildTime), this.maxHp);
    }
  }

  /**
   * Apply structure damage. §6.7 — flat, no falloff, no headshot multiplier.
   * @returns {boolean} true if this destroyed the piece
   */
  applyDamage(amount) {
    if (this.destroyed) return false;
    this.hp -= amount;
    if (this.hp <= 0) {
      this.hp = 0;
      this.destroyed = true;
      return true;
    }
    return false;
  }

  /** Slot key within a cell: walls are per-face, everything else is one per cell. */
  get slot() {
    return this.type === 'wall' ? `wall:${this.direction}` : this.type;
  }

  /** World-space centre of the piece's cell, computed from indices (no drift). */
  get worldCentre() {
    return {
      x: (this.cell.cx + 0.5) * TILE,
      y: (this.cell.cy + 0.5) * WALL_H,
      z: (this.cell.cz + 0.5) * TILE
    };
  }

  toJSON() {
    return {
      id: this.id, type: this.type, material: this.material,
      cell: this.cell, direction: this.direction, ownerId: this.ownerId,
      hp: Math.round(this.hp), buildProgress: this.buildProgress,
      editPattern: this.editPattern
    };
  }
}
