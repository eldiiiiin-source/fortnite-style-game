/** Per-type edit grids and the edit state machine. MASTER_SPEC §10. */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  resolvePattern, isValidSelection, isValidTile, tileCount, gridFor,
  patternsFor, renderSelection, tileToRowCol, rowColToTile,
  FLOOR_PATTERNS, CONE_PATTERNS, RAMP_PATTERNS
} from '../src/editing/EditPatterns.js';
import { EditController, EditState, EditReject } from '../src/editing/EditController.js';
import { BuildGrid } from '../src/building/BuildGrid.js';
import { BuildPiece, resetPieceIds } from '../src/building/BuildPiece.js';
import { EventBus } from '../src/core/EventBus.js';
import { EDIT, EDIT_GRIDS } from '../src/core/Config.js';

beforeEach(() => resetPieceIds());

const piece = (type, ownerId = 1) =>
  new BuildPiece({ type, material: 'brick', cell: { cx: 0, cy: 0, cz: 0 }, ownerId });

describe('§10.2 grids are per piece type, not uniform', () => {
  it('reports each type its own grid', () => {
    expect(gridFor('wall')).toEqual({ cols: 3, rows: 3, tiles: 9 });
    expect(gridFor('floor')).toEqual({ cols: 2, rows: 2, tiles: 4 });
    expect(gridFor('cone')).toEqual({ cols: 2, rows: 2, tiles: 4 });
    expect(gridFor('ramp')).toEqual({ cols: 2, rows: 3, tiles: 6 });
  });

  it('rejects a tile index outside the type\'s own grid', () => {
    expect(isValidTile('wall', 8)).toBe(true);
    expect(isValidTile('floor', 8)).toBe(false);   // 2x2 has no tile 8
    expect(isValidTile('cone', 4)).toBe(false);
    expect(isValidTile('ramp', 6)).toBe(false);    // 3x2 has tiles 0-5
    expect(isValidTile('ramp', 5)).toBe(true);
  });

  it('rejects a whole selection containing an out-of-grid tile', () => {
    expect(isValidSelection('floor', [0, 8])).toBe(false);
    expect(isValidSelection('ramp', [0, 7])).toBe(false);
  });

  it('maps tiles to row/col per the type\'s own width', () => {
    expect(tileToRowCol('wall', 4)).toEqual({ row: 1, col: 1 });
    expect(tileToRowCol('floor', 3)).toEqual({ row: 1, col: 1 });
    expect(tileToRowCol('ramp', 5)).toEqual({ row: 2, col: 1 });
    expect(rowColToTile('ramp', 2, 1)).toBe(5);
    expect(rowColToTile('ramp', 3, 0)).toBe(-1);
  });

  it('counts tiles per type', () => {
    expect(tileCount('wall')).toBe(9);
    expect(tileCount('floor')).toBe(4);
    expect(tileCount('ramp')).toBe(6);
  });
});

describe('§10.3 wall patterns — 3x3', () => {
  it('resolves the door as the middle column bottom two tiles', () => {
    const p = resolvePattern('wall', [4, 7]);
    expect(p.name).toBe('Door');
    expect(p.walkable).toBe(true);
  });

  it('resolves the three-tile opening as the full middle column', () => {
    const p = resolvePattern('wall', [1, 4, 7]);
    expect(p.walkable).toBe(true);
  });

  it('marks a bottom row opening as NOT walkable standing', () => {
    const p = resolvePattern('wall', [6, 7, 8]);
    expect(p.walkable).toBeUndefined();
  });

  it('supports the required wall pattern vocabulary', () => {
    const names = patternsFor('wall').map((p) => p.name.toLowerCase()).join(' ');
    for (const required of ['window', 'door', 'corner', 'half wall', 'top row', 'arch']) {
      expect(names).toContain(required);
    }
  });

  it('treats an empty selection as the full wall', () => {
    expect(resolvePattern('wall', []).name).toBe('Full wall');
  });
});

describe('§10.5 - §10.7 floor, cone and ramp patterns', () => {
  it('offers all four floor quarters and four halves', () => {
    expect(Object.keys(FLOOR_PATTERNS)).toHaveLength(10);
    for (const q of [0, 1, 2, 3]) expect(isValidSelection('floor', [q])).toBe(true);
    for (const h of [[0, 1], [2, 3], [0, 2], [1, 3]]) {
      expect(isValidSelection('floor', h)).toBe(true);
    }
  });

  it('deletes the floor when every quarter is removed', () => {
    expect(resolvePattern('floor', [0, 1, 2, 3]).deletesPiece).toBe(true);
  });

  it('offers directional cone edits', () => {
    expect(Object.keys(CONE_PATTERNS)).toHaveLength(10);
    expect(resolvePattern('cone', [0, 1]).name).toContain('north');
  });

  it('offers stair variants on the 3x2 ramp grid', () => {
    expect(Object.keys(RAMP_PATTERNS)).toHaveLength(10);
    expect(resolvePattern('ramp', [0, 2, 4]).name).toContain('left');
    expect(resolvePattern('ramp', [1, 3, 5]).name).toContain('right');
    expect(resolvePattern('ramp', [0, 1]).flipped).toBe(true);
  });
});

describe('§10.3 invalid patterns are rejected', () => {
  it('rejects unlisted selections', () => {
    expect(isValidSelection('wall', [0, 4, 8])).toBe(false);   // diagonal
    expect(isValidSelection('wall', [2])).toBe(false);
    expect(isValidSelection('floor', [0, 3])).toBe(false);     // diagonal quarters
    expect(isValidSelection('ramp', [0, 5])).toBe(false);
  });

  it('rejects a pattern valid for a different piece type', () => {
    expect(isValidSelection('wall', [4, 7])).toBe(true);
    expect(isValidSelection('ramp', [4, 7])).toBe(false);
  });

  it('rejects an unknown piece type', () => {
    expect(resolvePattern('roofTrap', [])).toBeNull();
  });
});

describe('EditPatterns rendering', () => {
  it('renders at the type\'s own grid size', () => {
    expect(renderSelection('wall', [4, 7])).toBe('# # #\n# · #\n# · #');
    expect(renderSelection('floor', [0])).toBe('· #\n# #');
    expect(renderSelection('ramp', [0, 1])).toBe('· ·\n# #\n# #');
  });
});

describe('§10 edit state machine', () => {
  let grid, bus, editor, wall;

  beforeEach(() => {
    grid = new BuildGrid();
    bus = new EventBus();
    editor = new EditController(grid, bus);
    wall = grid.add(piece('wall', 1));
  });

  const enterSelecting = (p = wall) => {
    editor.begin(p, 1, 2);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
  };

  it('refuses a piece owned by someone else', () => {
    const enemy = grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 1, cy: 0, cz: 0 }, direction: 'east', ownerId: 2
    }));
    expect(editor.begin(enemy, 1, 2)).toBe(false);
    expect(editor.lastReject).toBe(EditReject.NOT_OWNER);
  });

  it('refuses a piece out of range', () => {
    expect(editor.begin(wall, 1, EDIT.range + 0.5)).toBe(false);
    expect(editor.lastReject).toBe(EditReject.OUT_OF_RANGE);
  });

  it('reaches SELECTING after the enter gate', () => {
    editor.begin(wall, 1, 2);
    expect(editor.state).toBe(EditState.ENTERING);
    editor.update(EDIT.enterTime, { distanceToTarget: 2 });
    expect(editor.state).toBe(EditState.SELECTING);
  });

  it('applies a valid pattern without touching HP, material or owner', () => {
    const hp = wall.hp;
    enterSelecting();
    editor.dragTile(4);
    editor.dragTile(7);
    expect(editor.confirm().ok).toBe(true);
    expect(wall.editPattern.name).toBe('Door');
    expect(wall.hp).toBe(hp);
    expect(wall.material).toBe('brick');
    expect(wall.ownerId).toBe(1);
  });

  it('leaves the piece untouched on an invalid selection', () => {
    enterSelecting();
    editor.dragTile(0);
    editor.dragTile(4);
    editor.dragTile(8);
    const r = editor.confirm();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(EditReject.INVALID_PATTERN);
    expect(wall.editPattern).toBeNull();
  });

  it('ignores a tile outside the piece\'s grid', () => {
    const floor = grid.add(new BuildPiece({
      type: 'floor', material: 'wood', cell: { cx: 2, cy: 0, cz: 0 }, ownerId: 1
    }));
    enterSelecting(floor);
    expect(editor.dragTile(8)).toBe(false);     // 2x2 grid has no tile 8
    expect(editor.selection.size).toBe(0);
  });

  it('takes each tile at most once per drag', () => {
    enterSelecting();
    expect(editor.dragTile(4)).toBe(true);
    expect(editor.dragTile(4)).toBe(false);
    expect(editor.selection.size).toBe(1);
    // A NEW stroke over the same tile is idempotent: it stays selected, not toggled off.
    editor.endDrag();
    expect(editor.dragTile(4)).toBe(true);
    expect(editor.selection.size).toBe(1);
  });

  it('toggles tiles on click', () => {
    enterSelecting();
    editor.toggleTile(4);
    expect(editor.selection.has(4)).toBe(true);
    editor.toggleTile(4);
    expect(editor.selection.has(4)).toBe(false);
  });

  it('resets the selection back to the full piece', () => {
    enterSelecting();
    editor.dragTile(4);
    editor.dragTile(7);
    editor.resetSelection();
    expect(editor.selectionKey).toBe('');
    expect(editor.confirm().pattern.name).toBe('Full wall');
    expect(wall.editPattern).toBeNull();
  });

  it('resets an edited piece instantly, without entering the flow', () => {
    enterSelecting();
    editor.dragTile(4);
    editor.dragTile(7);
    editor.confirm();
    expect(wall.editPattern).not.toBeNull();

    const r = editor.resetPiece(wall, 1, 2);
    expect(r.ok).toBe(true);
    expect(wall.editPattern).toBeNull();
    expect(editor.isEditing).toBe(false);
  });

  it('refuses to reset a piece owned by someone else', () => {
    const enemy = grid.add(new BuildPiece({
      type: 'wall', material: 'wood', cell: { cx: 3, cy: 0, cz: 0 }, direction: 'east', ownerId: 2
    }));
    expect(editor.resetPiece(enemy, 1, 2).ok).toBe(false);
  });

  it('cancels when the player walks out of range — never stuck', () => {
    enterSelecting();
    expect(editor.isEditing).toBe(true);
    editor.update(1 / 60, { distanceToTarget: EDIT.range + 1 });
    expect(editor.isEditing).toBe(false);
    expect(editor.state).toBe(EditState.IDLE);
  });

  it('cancels when the target is destroyed mid-edit', () => {
    enterSelecting();
    wall.destroyed = true;
    editor.update(1 / 60, { distanceToTarget: 2 });
    expect(editor.isEditing).toBe(false);
  });

  it('starts a re-edit from the piece\'s existing pattern', () => {
    enterSelecting();
    editor.dragTile(4);
    editor.dragTile(7);
    editor.confirm();
    editor.begin(wall, 1, 2);
    expect(editor.selectionKey).toBe('4,7');
  });

  it('deletes the piece when every tile is selected on a floor', () => {
    const floor = grid.add(new BuildPiece({
      type: 'floor', material: 'wood', cell: { cx: 4, cy: 0, cz: 0 }, ownerId: 1
    }));
    enterSelecting(floor);
    for (let i = 0; i < EDIT_GRIDS.floor.tiles; i++) editor.dragTile(i);
    expect(editor.confirm().ok).toBe(true);
    expect(floor.destroyed).toBe(true);
    expect(grid.getPiece({ cx: 4, cy: 0, cz: 0 }, 'floor')).toBeNull();
  });

  it('completes the flow inside the responsiveness budget', () => {
    const dt = 1 / 60;
    editor.begin(wall, 1, 2);
    let elapsed = 0;
    while (editor.state === EditState.ENTERING) {
      editor.update(dt, { distanceToTarget: 2 });
      elapsed += dt;
    }
    editor.dragTile(4);
    editor.dragTile(7);
    editor.confirm();
    elapsed += EDIT.confirmTime;
    expect(elapsed).toBeLessThanOrEqual(EDIT.maxFlowTime);
  });

  it('emits started and confirmed', () => {
    const seen = [];
    bus.on('edit:started', () => seen.push('started'));
    bus.on('edit:confirmed', () => seen.push('confirmed'));
    enterSelecting();
    editor.confirm();
    expect(seen).toEqual(['started', 'confirmed']);
  });
});
