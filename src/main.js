/**
 * main.js — browser entry point. Owns the loop, the renderer, and the HUD.
 *
 * The simulation is in Game.js and never touches anything in this file.
 */
import { Loop } from './core/Loop.js';
import { Input } from './core/Input.js';
import { Game } from './Game.js';
import { Renderer } from './world/Renderer.js';
import { HUD } from './ui/HUD.js';
import { cellCentre } from './building/BuildGrid.js';
import { BUILD } from './core/Config.js';

const seed = Number(new URLSearchParams(location.search).get('seed') ?? 1337);

const input = new Input();
const game = new Game({ seed, input });
const renderer = new Renderer(document.getElementById('app'), game.terrain);
const hud = new HUD();

input.attach(renderer.domElement);

const overlay = document.getElementById('click-to-play');
overlay.addEventListener('click', () => {
  input.requestPointerLock();
});
document.addEventListener('pointerlockchange', () => {
  overlay.style.display = input.pointerLocked ? 'none' : 'grid';
});

const simulate = (dt) => game.update(dt);

const render = () => {
  game.camera.update(1 / 60, game.player, {
    buildMode: game.buildMode,
    adsProgress: game.inventory.activeWeapon?.adsProgress ?? 0,
    adsFov: game.inventory.activeWeapon?.def.adsFov
  });
  renderer.syncCamera(game.camera);
  renderer.updateStreaming(game.player.position);

  if (game.gridDirty) {
    renderer.syncBuildGrid(game.grid);
    game.gridDirty = false;
  }

  // Placement ghost — §6.3 rule 3.
  if (game.buildMode && game.buildTarget) {
    const c = cellCentre(
      game.buildTarget.cell.cx, game.buildTarget.cell.cy, game.buildTarget.cell.cz
    );
    const yaw = { north: 0, east: Math.PI / 2, south: Math.PI, west: -Math.PI / 2 }[game.buildTarget.direction] ?? 0;
    const half = BUILD.tileSize / 2;
    const off = { north: [0, -half], south: [0, half], east: [half, 0], west: [-half, 0] };
    const [dx, dz] = game.selectedPiece === 'wall'
      ? (off[game.buildTarget.direction] ?? [0, -half])
      : [0, 0];
    renderer.updateGhost({
      position: { x: c.x + dx, y: c.y, z: c.z + dz },
      yaw,
      valid: (game.player.materials[game.selectedMaterial] ?? 0) >= BUILD.cost
    });
  } else {
    renderer.updateGhost(null);
  }

  renderer.render();
  hud.update(game.hudState(loop.stats));
};

const loop = new Loop(simulate, render);
loop.start();

// Expose for debugging in the console. Not used by any game code.
window.__game = { game, renderer, loop, input };
