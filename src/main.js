/**
 * main.js — browser entry point. Owns the loop, renderer, HUD and input.
 *
 * The simulation lives in Game.js and never touches anything in this file.
 */
import { Loop } from './core/Loop.js';
import { Input } from './core/Input.js';
import { Game } from './Game.js';
import { Renderer } from './world/Renderer.js';
import { HUD } from './ui/HUD.js';
import { Settings } from './core/Settings.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { PerformanceGovernor } from './core/Performance.js';
import { BuildPiece } from './building/BuildPiece.js';
import { solidBoxes, wallBoxes, floorBoxes } from './building/PieceGeometry.js';
import { EDIT_GRIDS } from './core/Config.js';

const seed = Number(new URLSearchParams(location.search).get('seed') ?? 1337);

const settings = new Settings();
settings.load();

const input = new Input(settings.bindings);
const game = new Game({ seed, input, settings });
const renderer = new Renderer(document.getElementById('app'), game.terrain);
const hud = new HUD();

input.attach(renderer.domElement);
settings.applyTo({ renderer, input });

const audio = new AudioSystem({ settings });
audio.attach(game.bus);

// §23 — adaptive quality. It may only touch things in Performance.REDUCIBLE.
const governor = new PerformanceGovernor();
settings.onChange(() => { settings.applyTo({ renderer, input }); audio.applySettings(); });

const overlay = document.getElementById('click-to-play');
overlay.addEventListener('click', () => {
  // Browsers require a user gesture before an AudioContext may start.
  audio.init();
  input.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  overlay.style.display = input.pointerLocked ? 'none' : 'grid';
});

// Immediate hit feedback (§12.2, §13.1) — driven by events, never polled.
game.bus.on('weapon:hit', (e) => hud.showHitmarker(e));
game.bus.on('player:died', () => hud.pushKillFeed('Target eliminated'));

/** A provisional piece used only to draw the preview, from the same geometry source. */
function previewPiece() {
  if (!game.buildMode || !game.buildTarget) return null;
  const piece = new BuildPiece({
    type: game.selectedPiece,
    material: game.selectedMaterial,
    cell: game.buildTarget.cell,
    direction: game.buildTarget.direction,
    ownerId: game.player.id
  });
  return { piece, valid: game.buildTargetValid };
}

/** Per-tile boxes of the piece being edited, for the world-space overlay. */
function editOverlayState() {
  const piece = game.editor.target;
  if (!piece) return null;

  // Show every tile of the grid, not just the remaining ones, so the player can select
  // tiles that are already open.
  const full = new BuildPiece({
    type: piece.type, material: piece.material,
    cell: piece.cell, direction: piece.direction, ownerId: piece.ownerId
  });
  let boxes;
  if (piece.type === 'wall') boxes = wallBoxes(full);
  else if (piece.type === 'floor') boxes = floorBoxes(full);
  else boxes = solidBoxes(full);

  // Ramps and cones have no solid boxes; fall back to their grid footprint.
  if (boxes.length === 0) return null;
  void EDIT_GRIDS;
  return { piece, selection: [...game.editor.selection], tileBoxes: boxes };
}

const simulate = (dt) => game.update(dt);

const render = (alpha, ctx, dt = 0) => {
  renderer.syncCamera(game.camera);
  renderer.updateStreaming(game.player.position);
  renderer.syncBuildGrid(game.grid);
  renderer.updateGhost(previewPiece());
  renderer.updateEditOverlay(game.editor.isEditing ? editOverlayState() : null);
  renderer.render();

  hud.update({ ...game.hudState(loop.stats), yaw: game.player.yaw }, dt);

  // Adaptive quality, applied only through the renderer's own knobs.
  governor.sample(loop.stats.frameMs, dt);
  const verdict = governor.evaluate();
  if (verdict.changed) {
    settings.set('video.quality', verdict.tier);
    settings.applyTo({ renderer, input });
  }
};

const loop = new Loop(simulate, render);
loop.start();

// Console handle for debugging. No game code reads this.
window.__game = { game, renderer, loop, input, settings };
