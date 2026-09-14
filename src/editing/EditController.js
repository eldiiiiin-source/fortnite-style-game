/**
 * EditController.js — the edit state machine. MASTER_SPEC §10.
 *
 * Editing must be extremely responsive, must never get stuck, and must update geometry
 * AND collision together. Collision is derived from the edit pattern by PieceGeometry, so
 * confirming an edit updates both by construction (§11).
 */
import { EDIT } from '../core/Config.js';
import { Events } from '../core/EventBus.js';
import { resolvePattern, selectionKey, isValidTile, tileCount } from './EditPatterns.js';

export const EditState = Object.freeze({
  IDLE: 'idle',
  ENTERING: 'entering',
  SELECTING: 'selecting'
});

export const EditReject = Object.freeze({
  NO_TARGET: 'noTarget',
  NOT_OWNER: 'notOwner',
  OUT_OF_RANGE: 'outOfRange',
  INVALID_PATTERN: 'invalidPattern'
});

export class EditController {
  constructor(grid, bus = null, settings = null) {
    this.grid = grid;
    this.bus = bus;
    this.settings = settings;

    this.state = EditState.IDLE;
    this.target = null;
    this.selection = new Set();
    this.timer = 0;
    this.lastReject = null;
    this.flowElapsed = 0;
    /** Guards drag so a held button cannot toggle a tile on and off repeatedly. */
    this.dragTouched = new Set();
  }

  get isEditing() {
    return this.state !== EditState.IDLE;
  }

  get confirmOnRelease() {
    return this.settings?.confirmEditOnRelease ?? EDIT.confirmOnRelease;
  }

  /** Begin editing. §10.1 — own pieces only, within range. */
  begin(piece, playerId, distance) {
    if (!piece || piece.destroyed) {
      this.lastReject = EditReject.NO_TARGET;
      return false;
    }
    if (piece.ownerId !== playerId) {
      this.lastReject = EditReject.NOT_OWNER;
      return false;
    }
    if (distance > EDIT.range) {
      this.lastReject = EditReject.OUT_OF_RANGE;
      return false;
    }

    this.state = EditState.ENTERING;
    this.target = piece;
    this.selection.clear();
    this.dragTouched.clear();
    // Re-editing starts from the piece's current shape.
    for (const t of piece.editPattern?.removed ?? []) this.selection.add(t);
    this.timer = 0;
    this.flowElapsed = 0;
    this.lastReject = null;
    this.bus?.emit(Events.EDIT_STARTED, { piece, playerId });
    return true;
  }

  /** Tile indices are validated against THIS piece's grid, not a fixed 3x3. */
  toggleTile(index) {
    if (this.state !== EditState.SELECTING || !this.target) return false;
    if (!isValidTile(this.target.type, index)) return false;
    if (this.selection.has(index)) this.selection.delete(index);
    else this.selection.add(index);
    return true;
  }

  /** Drag selection — each tile is taken at most once per drag (§10 step 5). */
  dragTile(index) {
    if (this.state !== EditState.SELECTING || !this.target) return false;
    if (!isValidTile(this.target.type, index)) return false;
    if (this.dragTouched.has(index)) return false;
    this.dragTouched.add(index);
    this.selection.add(index);
    return true;
  }

  endDrag() {
    this.dragTouched.clear();
  }

  /** Clear the selection back to the full piece. */
  resetSelection() {
    this.selection.clear();
    this.dragTouched.clear();
  }

  /**
   * §10.9 — instant reset of an already-edited piece, without entering the edit flow.
   * Aim at an edited build, press the bind, the structure resets immediately.
   */
  resetPiece(piece, playerId, distance) {
    if (!piece || piece.destroyed) return { ok: false, reason: EditReject.NO_TARGET };
    if (piece.ownerId !== playerId) return { ok: false, reason: EditReject.NOT_OWNER };
    if (distance > EDIT.range) return { ok: false, reason: EditReject.OUT_OF_RANGE };

    piece.editPattern = null;
    this.grid.touch();              // collision rebuilds from the new (empty) pattern
    this.bus?.emit(Events.PIECE_EDITED, { piece, pattern: null, reset: true });
    if (this.target === piece) this._toIdle();
    return { ok: true };
  }

  /**
   * Confirm the current selection. An unlisted pattern is rejected and the piece is left
   * untouched (§10.3).
   */
  confirm() {
    if (!this.isEditing || !this.target) {
      return { ok: false, reason: EditReject.NO_TARGET };
    }

    const piece = this.target;
    const tiles = [...this.selection];
    const pattern = resolvePattern(piece.type, tiles);

    if (!pattern) {
      this.lastReject = EditReject.INVALID_PATTERN;
      this.cancel();
      return { ok: false, reason: EditReject.INVALID_PATTERN };
    }

    if (pattern.deletesPiece) {
      piece.destroyed = true;
      this.grid.remove(piece);      // removal bumps revision; collision vanishes with it
      this.bus?.emit(Events.PIECE_DESTROYED, { piece, cause: 'edit' });
    } else {
      // HP, material and owner are untouched by editing (§10.11).
      piece.editPattern = pattern.key === '' ? null : pattern;
      this.grid.touch();            // §10.8 — geometry and collision rebuild together
      this.bus?.emit(Events.PIECE_EDITED, { piece, pattern });
    }

    this.bus?.emit(Events.EDIT_CONFIRMED, { piece, pattern });
    this._toIdle();
    return { ok: true, pattern };
  }

  cancel() {
    if (!this.isEditing) return;
    const piece = this.target;
    this._toIdle();
    this.bus?.emit(Events.EDIT_CANCELLED, { piece });
  }

  _toIdle() {
    this.state = EditState.IDLE;
    this.target = null;
    this.selection.clear();
    this.dragTouched.clear();
    this.timer = 0;
  }

  /**
   * §10.1 — walking out of range or losing the target cancels cleanly. There is no path
   * that leaves the controller editing a piece it cannot reach.
   */
  update(dt, { distanceToTarget = 0 } = {}) {
    if (!this.isEditing) return;

    this.flowElapsed += dt;

    if (!this.target || this.target.destroyed) {
      this.cancel();
      return;
    }
    if (distanceToTarget > EDIT.range) {
      this.lastReject = EditReject.OUT_OF_RANGE;
      this.cancel();
      return;
    }

    this.timer += dt;
    if (this.state === EditState.ENTERING && this.timer >= EDIT.enterTime) {
      this.state = EditState.SELECTING;
      this.timer = 0;
    }
  }

  get selectionKey() {
    return selectionKey([...this.selection]);
  }

  /** Tile count of the piece being edited, for the overlay. */
  get gridTileCount() {
    return this.target ? tileCount(this.target.type) : 0;
  }
}
