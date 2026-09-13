/** Edit grid patterns and the edit state machine. MASTER_SPEC §7. */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolvePattern, isValidSelection, selectionKey, patternsFor, renderSelection,
  WALL_PATTERNS, FLOOR_PATTERNS, RAMP_PATTERNS, CONE_PATTERNS
} from '../src/editing/EditPatterns.js';
import { EditController, EditState, EditReject } from '../src/editing/EditController.js';
import { BuildGrid } from '../src/building/BuildGrid.js';
import { BuildPiece, resetPieceIds } from '../src/building/BuildPiece.js';
import { EventBus } from '../src/core/EventBus.js';
import { EDIT, MATERIALS } from '../src/core/Config.js';

const makePiece = (type = 'wall', ownerId = 1) =>
  new BuildPiece({ type, material: 'wood', cell: { cx: 0, cy: 0, cz: 0 }, ownerId });

beforeEach(() => resetPieceIds());

describe('§7.1 selection keys', () => {
  it('is order-independent and de-duplicated', () => {
    expect(selectionKey([7, 6])).toBe('6,7');
    expect(selectionKey([6, 7, 6])).toBe('6,7');
    expect(selectionKey([])).toBe('');
  });
});

describe('§7.3 wall patterns', () => {
  it('resolves the door as tiles 6 and 7', () => {
    const p = resolvePattern('wall', [6, 7]);
    expect(p.name).toBe('Door');
  });

  it('resolves a window as the centre tile', () => {
    expect(resolvePattern('wall', [4]).name).toBe('Window');
  });

  it('treats an empty selection as the full wall', () => {
    expect(resolvePattern('wall', []).name).toBe('Full wall');
  });

  it('offers the nine documented wall patterns', () => {
    expect(Object.keys(WALL_PATTERNS)).toHaveLength(9);
  });
});

describe('§7.4 - §7.6 other piece patterns', () => {
  it('deletes the piece on a full floor drop', () => {
    const p = resolvePattern('floor', [0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(p.deletesPiece).toBe(true);
  });

  it('accepts a quarter hole at any corner', () => {
    for (const corner of [0, 2, 6, 8]) {
      expect(isValidSelection('floor', [corner])).toBe(true);
    }
  });

  it('resolves both ramp halves', () => {
    expect(resolvePattern('ramp', [0, 3, 6]).name).toBe('Half ramp (left)');
    expect(resolvePattern('ramp', [2, 5, 8]).name).toBe('Half ramp (right)');
  });

  it('offers the documented pattern counts', () => {
    expect(Object.keys(FLOOR_PATTERNS)).toHaveLength(8);
    expect(Object.keys(RAMP_PATTERNS)).toHaveLength(5);
    expect(Object.keys(CONE_PATTERNS)).toHaveLength(3);
  });
});

describe('§7.7 rejected selections', () => {
  it('rejects the selections named in references/editing/01-edit-patterns.md', () => {
    expect(isValidSelection('wall', [0, 1, 2])).toBe(false);   // top row only
    expect(isValidSelection('wall', [1])).toBe(false);          // purposeless hole
    expect(isValidSelection('wall', [0, 4, 8])).toBe(false);    // diagonal
    expect(isValidSelection('floor', [1, 3, 5, 7])).toBe(false); // cross
  });

  it('rejects a pattern valid for a different piece type', () => {
    // 6,7 is a wall door, but it is not a floor pattern.
    expect(isValidSelection('wall', [6, 7])).toBe(true);
    expect(isValidSelection('floor', [6, 7])).toBe(false);
  });

  it('is an allow list, so an unknown piece type resolves to nothing', () => {
    expect(resolvePattern('pyramidRamp', [])).toBeNull();
  });
});

describe('EditPatterns helpers', () => {
  it('renders a selection as the reference diagram', () => {
    expect(renderSelection([6, 7])).toBe('# # #\n# # #\n· · #');
  });

  it('lists every pattern for a type with its key', () => {
    const list = patternsFor('cone');
    expect(list).toHaveLength(3);
    expect(list.map((p) => p.name)).toContain('Quarter cone');
  });
});

describe('§7.2 edit flow', () => {
  let grid, bus, editor, piece;

  beforeEach(() => {
    grid = new BuildGrid();
    bus = new EventBus();
    editor = new EditController(grid, bus);
    piece = grid.add(makePiece('wall', 1));
  });

  it('refuses to edit a piece owned by someone else', () => {
    const enemy = grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 1, cy: 0, cz: 0 }, direction: 'east', ownerId: 2
    }));
    expect(editor.begin(enemy, 1, 2)).toBe(false);
    expect(editor.lastReject).toBe(EditReject.NOT_OWNER);
  });

  it('refuses to edit beyond 8 m', () => {
    expect(editor.begin(piece, 1, EDIT.range + 0.1)).toBe(false);
    expect(editor.lastReject).toBe(EditReject.OUT_OF_RANGE);
  });

  it('reaches SELECTING after the 0.10 s enter gate', () => {
    editor.begin(piece, 1, 2);
    expect(editor.state).toBe(EditState.ENTERING);
    editor.update(0.05, { distanceToTarget: 2 });
    expect(editor.state).toBe(EditState.ENTERING);
    editor.update(0.06, { distanceToTarget: 2 });
    expect(editor.state).toBe(EditState.SELECTING);
  });

  it('applies a valid pattern without touching HP, material or owner', () => {
    const hpBefore = piece.hp;
    editor.begin(piece, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    editor.selectTile(6);
    editor.selectTile(7);
    const result = editor.confirm();

    expect(result.ok).toBe(true);
    expect(piece.editPattern.name).toBe('Door');
    expect(piece.hp).toBe(hpBefore);            // §7.7 rule 1
    expect(piece.material).toBe('wood');
    expect(piece.ownerId).toBe(1);
    expect(editor.state).toBe(EditState.IDLE);
  });

  it('leaves the piece unchanged on an invalid selection', () => {
    editor.begin(piece, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    editor.selectTile(0);
    editor.selectTile(4);
    editor.selectTile(8); // diagonal — not in the allow list
    const result = editor.confirm();

    expect(result.ok).toBe(false);
    expect(result.reason).toBe(EditReject.INVALID_PATTERN);
    expect(piece.editPattern).toBeNull();
    expect(piece.destroyed).toBe(false);
  });

  it('costs and refunds no material', () => {
    // Editing has no material parameter at all — assert the piece's own material is intact
    // and that the pattern carries no cost field.
    editor.begin(piece, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    editor.selectTile(4);
    const result = editor.confirm();
    expect(result.pattern.cost).toBeUndefined();
    expect(MATERIALS[piece.material].fullHp).toBe(150);
  });

  it('deletes the piece on a full floor drop and removes it from the grid', () => {
    const floor = grid.add(new BuildPiece({
      type: 'floor', material: 'wood', cell: { cx: 2, cy: 0, cz: 0 }, ownerId: 1
    }));
    editor.begin(floor, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    for (let i = 0; i < 9; i++) editor.selectTile(i);
    const result = editor.confirm();

    expect(result.ok).toBe(true);
    expect(floor.destroyed).toBe(true);
    expect(grid.getPiece({ cx: 2, cy: 0, cz: 0 }, 'floor')).toBeNull();
  });

  it('cancels when the player walks out of range', () => {
    editor.begin(piece, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    expect(editor.isEditing).toBe(true);
    editor.update(1 / 30, { distanceToTarget: EDIT.range + 1 });
    expect(editor.isEditing).toBe(false);
    expect(editor.lastReject).toBe(EditReject.OUT_OF_RANGE);
  });

  it('cancels if the target is destroyed mid-edit', () => {
    editor.begin(piece, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    piece.destroyed = true;
    editor.update(1 / 30, { distanceToTarget: 2 });
    expect(editor.isEditing).toBe(false);
  });

  it('resets the selection back to the full piece', () => {
    editor.begin(piece, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    editor.selectTile(6);
    editor.selectTile(7);
    editor.reset();
    expect(editor.selectionKey).toBe('');
    expect(editor.confirm().pattern.name).toBe('Full wall');
    expect(piece.editPattern).toBeNull();
  });

  it('starts a re-edit from the piece\'s existing pattern', () => {
    editor.begin(piece, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    editor.selectTile(6);
    editor.selectTile(7);
    editor.confirm();

    editor.begin(piece, 1, 2);
    expect(editor.selectionKey).toBe('6,7');
  });

  it('completes a door edit inside the 0.25 s budget', () => {
    const dt = 1 / 30;
    editor.begin(piece, 1, 2);
    let elapsed = 0;
    while (editor.state === EditState.ENTERING) {
      editor.update(dt, { distanceToTarget: 2 });
      elapsed += dt;
    }
    editor.selectTile(6);
    editor.selectTile(7);
    editor.confirm();
    elapsed += EDIT.confirmTime;
    expect(elapsed).toBeLessThanOrEqual(EDIT.maxFlowTime);
  });

  it('emits started and confirmed events', () => {
    const seen = [];
    bus.on('edit:started', () => seen.push('started'));
    bus.on('edit:confirmed', () => seen.push('confirmed'));
    editor.begin(piece, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    editor.confirm();
    expect(seen).toEqual(['started', 'confirmed']);
  });
});
