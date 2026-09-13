/**
 * EditController.js — the edit state machine. MASTER_SPEC §7.2, §7.7.
 *
 * Editing never blocks movement: this holds no movement lock and returns no "busy" state
 * that the player controller consults.
 */
import { EDIT } from '../core/Config.js';
import { Events } from '../core/EventBus.js';
import { resolvePattern, selectionKey } from './EditPatterns.js';

export const EditState = Object.freeze({
  IDLE: 'idle',
  ENTERING: 'entering',
  SELECTING: 'selecting',
  CONFIRMING: 'confirming'
});

export const EditReject = Object.freeze({
  NOT_OWNER: 'notOwner',
  OUT_OF_RANGE: 'outOfRange',
  INVALID_PATTERN: 'invalidPattern',
  NO_TARGET: 'noTarget'
});

export class EditController {
  /**
   * @param {import('../building/BuildGrid.js').BuildGrid} grid
   * @param {import('../core/EventBus.js').EventBus} bus
   */
  constructor(grid, bus) {
    this.grid = grid;
    this.bus = bus;

    this.state = EditState.IDLE;
    this.target = null;         // BuildPiece being edited
    this.selection = new Set(); // removed tile indices
    this.timer = 0;
    this.lastReject = null;
    /** Wall-clock seconds spent in the flow, for the §7.2 budget. */
    this.flowElapsed = 0;
  }

  get isEditing() {
    return this.state !== EditState.IDLE;
  }

  /**
   * Begin editing a piece. §7.2 — own pieces only, within EDIT.range.
   * @returns {boolean} whether the edit started
   */
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
    // Pre-load the piece's existing pattern so re-editing starts from its current shape.
    if (piece.editPattern) {
      for (const t of piece.editPattern.removed) this.selection.add(t);
    }
    this.timer = 0;
    this.flowElapsed = 0;
    this.lastReject = null;
    this.bus?.emit(Events.EDIT_STARTED, { piece, playerId });
    return true;
  }

  /** Toggle a tile while selecting. Drag calls this once per newly-crossed tile. */
  toggleTile(index) {
    if (this.state !== EditState.SELECTING) return;
    if (index < 0 || index > 8) return;
    if (this.selection.has(index)) this.selection.delete(index);
    else this.selection.add(index);
  }

  /** Add a tile without toggling — used by drag, which must not flip tiles twice. */
  selectTile(index) {
    if (this.state !== EditState.SELECTING) return;
    if (index >= 0 && index <= 8) this.selection.add(index);
  }

  /** `R` while editing — clear the selection back to the full piece (§7.2). */
  reset() {
    if (!this.isEditing) return;
    this.selection.clear();
  }

  /**
   * Confirm the current selection. Applies the pattern if it is in the allow list,
   * otherwise rejects and leaves the piece untouched (§7.7 rule 1).
   * @returns {{ok:boolean, reason?:string, pattern?:object}}
   */
  confirm() {
    if (!this.isEditing || !this.target) {
      return { ok: false, reason: EditReject.NO_TARGET };
    }

    const tiles = [...this.selection];
    const pattern = resolvePattern(this.target.type, tiles);

    if (!pattern) {
      this.lastReject = EditReject.INVALID_PATTERN;
      this.cancel();
      return { ok: false, reason: EditReject.INVALID_PATTERN };
    }

    const piece = this.target;

    // §7.7 rule 3 — an edit that removes everything deletes the piece; support
    // re-evaluation happens on the next StructureGraph tick.
    if (pattern.deletesPiece) {
      piece.destroyed = true;
      this.grid.remove(piece);
      this.bus?.emit(Events.PIECE_DESTROYED, { piece, cause: 'edit' });
    } else {
      // §7.7 rule 1 — HP, material and owner are untouched by editing.
      piece.editPattern = pattern.key === '' ? null : pattern;
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
    this.timer = 0;
  }

  /**
   * Advance the state machine. ENTERING and CONFIRMING are the two 0.10 s gates in §7.2.
   * Also enforces the range check every tick so walking away cancels the edit.
   */
  update(dt, { distanceToTarget = 0 } = {}) {
    if (!this.isEditing) return;

    this.flowElapsed += dt;

    if (this.target?.destroyed) {
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

  /** Current selection as a canonical key, for the UI and for tests. */
  get selectionKey() {
    return selectionKey([...this.selection]);
  }
}
