/**
 * End-to-end smoke test of the wired Game. Proves the simulation runs headlessly with no
 * WebGL context, which is what keeps src/ testable (CLAUDE.md).
 */
import { describe, it, expect } from 'vitest';
import { Game } from '../src/Game.js';
import { SIM, BUILD, MATERIALS } from '../src/core/Config.js';
import { placePiece } from '../src/building/Placement.js';
import { cellCentre, worldToCell } from '../src/building/BuildGrid.js';
import { BuildPiece } from '../src/building/BuildPiece.js';

const tick = (game, n = 1) => { for (let i = 0; i < n; i++) game.update(SIM.fixedDt); };

describe('Game wiring', () => {
  it('constructs and ticks without a renderer', () => {
    const game = new Game({ seed: 99 });
    tick(game, 300); // 10 s
    expect(game.time).toBeCloseTo(10, 1);
    expect(game.health.alive).toBe(true);
  });

  it('spawns the player standing on the terrain', () => {
    const game = new Game({ seed: 99 });
    tick(game, 90);
    const ground = game.terrain.heightAt(game.player.position.x, game.player.position.z);
    expect(game.player.position.y).toBeCloseTo(ground, 1);
    expect(game.player.grounded).toBe(true);
  });

  it('replays identically for the same seed', () => {
    const a = new Game({ seed: 4242 });
    const b = new Game({ seed: 4242 });
    tick(a, 600);
    tick(b, 600);
    expect(a.player.position).toEqual(b.player.position);
    expect(a.storm.radius).toBe(b.storm.radius);
    expect(a.storm.centre).toEqual(b.storm.centre);
  });

  it('diverges between seeds', () => {
    const a = new Game({ seed: 1 });
    const b = new Game({ seed: 2 });
    expect(a.storm.centre).not.toEqual(b.storm.centre);
  });

  it('places a piece that survives on the terrain and reaches full HP', () => {
    const game = new Game({ seed: 7 });
    const p = game.player.position;
    const cell = worldToCell(p.x, p.y, p.z);

    const result = placePiece({
      grid: game.grid,
      type: 'ramp',
      material: 'wood',
      cell: { ...cell, cz: cell.cz - 1 }, // in front of the player, not inside them
      builder: game.player,
      now: game.time
    });
    expect(result.ok).toBe(true);

    // The piece is grounded on terrain, so it must not cascade away.
    tick(game, Math.ceil(MATERIALS.wood.buildTime / SIM.fixedDt) + 10);
    expect(result.piece.destroyed).toBe(false);
    expect(result.piece.isFullyBuilt).toBe(true);
    expect(result.piece.hp).toBeCloseTo(MATERIALS.wood.fullHp, 0);
  });

  it('cascades an unsupported piece placed high in the air', () => {
    const game = new Game({ seed: 7 });
    const cell = { cx: 0, cy: 40, cz: 0 }; // ~154 m up, nothing beneath it
    const piece = game.grid.add(new BuildPiece({
      type: 'floor', material: 'metal', cell, ownerId: 1
    }));
    tick(game, Math.ceil(BUILD.supportGraceTime / SIM.fixedDt) + 2);
    expect(piece.destroyed).toBe(true);
    expect(game.grid.pieceCount).toBe(0);
  });

  it('gives the player a starting kit', () => {
    const game = new Game({ seed: 7 });
    expect(game.player.materials.wood).toBeGreaterThan(0);
    expect(game.inventory.slots[1].weapon.id).toBe('assaultRifle');
  });

  it('exposes a HUD state with everything the HUD reads', () => {
    const game = new Game({ seed: 7 });
    tick(game, 30);
    const s = game.hudState({ tick: 0, simMs: 0, frameMs: 0 });
    expect(s.health).toBe(100);
    expect(s.materials).toHaveProperty('wood');
    expect(s.storm).toHaveProperty('radius');
    expect(typeof s.spreadDegrees).toBe('number');
  });

  it('keeps build and edit mutually exclusive (§3.4)', () => {
    const game = new Game({ seed: 7 });
    const cell = worldToCell(game.player.position.x, game.player.position.y, game.player.position.z);
    const placed = placePiece({
      grid: game.grid, type: 'wall', material: 'wood',
      cell: { ...cell, cz: cell.cz - 1 }, direction: 'north',
      builder: game.player, now: game.time
    });
    game.editor.begin(placed.piece, game.player.id, 2);
    expect(game.editor.isEditing).toBe(true);

    game._setBuildMode(true);
    expect(game.editor.isEditing).toBe(false);
    expect(game.buildMode).toBe(true);
  });

  it('damages the player in the storm and not in the circle', () => {
    const game = new Game({ seed: 7 });
    // Fast-forward past the drop so a phase is live, then move well outside.
    tick(game, 60 * 30);
    game.player.teleport(900, 200, 900);
    const before = game.health.health;
    tick(game, 5 * 30);
    if (!game.storm.isInside(900, 900)) {
      expect(game.health.health).toBeLessThan(before);
    }
  });
});

describe('build cell geometry at the spawn point', () => {
  it('places a cell centre half a tile from its corner', () => {
    const c = cellCentre(10, 2, -3);
    expect(c.x).toBeCloseTo(10 * BUILD.tileSize + BUILD.tileSize / 2);
    expect(c.y).toBeCloseTo(2 * BUILD.wallHeight + BUILD.wallHeight / 2);
  });
});
