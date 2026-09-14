/**
 * MatchScene.js — the in-match presentation layer.
 *
 * Owns the three.js renderer, the HUD, the minimap and the map screen for the duration of
 * one match. The simulation lives in Game; this scene only reads from it.
 *
 * Created and destroyed per match alongside Game, so no renderer state survives into the
 * next match (BATTLE_ROYALE_SPEC §13).
 */
import { Scene, SceneName } from '../../app/SceneManager.js';
import { el } from '../dom.js';
import { Renderer } from '../../world/Renderer.js';
import { HUD } from '../HUD.js';
import { MapView } from '../components/MapView.js';
import { MapScreen } from '../components/MapScreen.js';
import { BuildPiece } from '../../building/BuildPiece.js';
import { solidBoxes, wallBoxes, floorBoxes } from '../../building/PieceGeometry.js';
import { TILE } from '../../core/Config.js';
import { WORLD } from '../../core/Config.js';

export class MatchScene extends Scene {
  constructor(app, ui) {
    super(SceneName.MATCH, app);
    this.ui = ui;

    this.container = el('div', { style: { position: 'fixed', inset: '0', zIndex: '1' } });
    this.hudRoot = el('div', {
      id: 'hud-root',
      style: { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '10' }
    });

    this.renderer = null;
    this.hud = null;
    this.minimap = null;
    this.mapScreen = null;
    this.worldExtent = WORLD.regionExtent;
    this._minimapTick = 0;
  }

  enter() {
    const game = this.app.game;
    if (!game) return;

    // The menu layer steps aside; the 3D view and HUD take over.
    this.ui.showWorld(this.container, this.hudRoot);

    this.renderer = new Renderer(this.container, game.terrain);
    this.hud = new HUD(this.hudRoot);
    this.ui.attachInput(this.renderer.domElement);

    this.minimap = new MapView({
      terrain: game.terrain, size: 168, worldExtent: this.worldExtent
    });
    this.hud.attachMinimap(this.minimap.element);

    this.mapScreen = new MapScreen(game.terrain, { worldExtent: this.worldExtent });
    this.hudRoot.appendChild(this.mapScreen.element);

    // The equipped outfit drives the avatar's colours, so cosmetics are visible in-match.
    this.renderer.setAvatarCosmetics(game.cosmetics?.outfit ?? null, game.cosmetics?.pickaxe ?? null);
    this.ui.applySettings({ renderer: this.renderer });
    this.ui.bindMatchHotkeys(this);

    // Feedback events — §13.1 requires these to be immediate.
    this._off = [
      this.app.bus.on('weapon:hit', (e) => this.hud.showHitmarker(e)),
      this.app.bus.on('match:participantEliminated', (e) => this._onElimination(e))
    ];
  }

  exit() {
    for (const off of this._off ?? []) off();
    this.minimap = null;
    this.mapScreen = null;
    this.hud = null;
    if (this.renderer) {
      this.renderer.renderer.dispose();
      this.renderer = null;
    }
    this.container.replaceChildren();
    this.hudRoot.replaceChildren();
    this.ui.hideWorld();
  }

  _onElimination(e) {
    if (!this.hud) return;
    const name = this.app.registry.get(e.id)?.name ?? `Player ${e.id}`;
    const by = e.by != null ? (this.app.registry.get(e.by)?.name ?? `Player ${e.by}`) : 'the storm';
    this.hud.pushKillFeed(`${by} eliminated ${name}`);
  }

  toggleMap() {
    return this.mapScreen?.toggle() ?? false;
  }

  frame(alpha) {
    const game = this.app.game;
    if (!game || !this.renderer) return;
    void alpha;

    this.renderer.syncCamera(game.camera);
    // Hidden while falling: the descent controls the position and the body would clip.
    this.renderer.updateAvatar(game.player, !game.inDropPhase, game.pickaxeSwingProgress);
    this.renderer.updateStreaming(game.player.position);
    this.renderer.syncBuildGrid(game.grid);

    const inStorm = game.storm.state !== 'idle'
      && !game.storm.isInside(game.player.position.x, game.player.position.z);
    this.renderer.updateStorm(game.storm.snapshot(), !inStorm);

    this.renderer.updateGhost(this._previewPiece(game));
    this.renderer.updateEditOverlay(game.editor.isEditing ? this._editOverlay(game) : null);
    this.renderer.render();

    const hudState = {
      ...game.hudState(this.ui.loop?.stats),
      yaw: game.player.yaw,
      inStorm
    };
    this.hud.update(hudState, 1 / 60);

    // The minimap redraws a few times a second, not every frame — §17 forbids spikes and
    // nothing on it moves fast enough to need 60 Hz.
    this._minimapTick++;
    if (this._minimapTick % 6 === 0) this._drawMinimap(game);
    if (this.mapScreen?.visible) this._drawMapScreen(game);
  }

  _drawMinimap(game) {
    if (!this.ui.settings.get('hud.minimap')) {
      this.hud.setMinimapVisible(false);
      return;
    }
    this.hud.setMinimapVisible(true);
    this.minimap.draw({
      centre: { x: game.player.position.x, z: game.player.position.z },
      span: TILE * 42,
      yaw: game.player.yaw,
      storm: game.storm.snapshot(),
      rotate: true,
      markers: this._markers(game, TILE * 24)
    });
  }

  _drawMapScreen(game) {
    this.mapScreen.render({
      player: { x: game.player.position.x, z: game.player.position.z },
      yaw: game.player.yaw,
      storm: game.storm.snapshot(),
      markers: this._markers(game, Infinity)
    });
  }

  /** Chests and visible bots, within a radius. */
  _markers(game, radius) {
    const px = game.player.position.x;
    const pz = game.player.position.z;
    const near = (x, z) => radius === Infinity || Math.hypot(x - px, z - pz) <= radius;

    const markers = [];
    for (const container of game.worldLoot.containers) {
      if (container.kind !== 'chest' || container.opened) continue;
      if (near(container.position.x, container.position.z)) {
        markers.push({ x: container.position.x, z: container.position.z, kind: 'chest' });
      }
    }
    return markers;
  }

  /** Preview piece, built from the same geometry source as a placed piece (§9.2). */
  _previewPiece(game) {
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

  _editOverlay(game) {
    const piece = game.editor.target;
    if (!piece) return null;
    const full = new BuildPiece({
      type: piece.type, material: piece.material,
      cell: piece.cell, direction: piece.direction, ownerId: piece.ownerId
    });
    const boxes = piece.type === 'wall' ? wallBoxes(full)
      : piece.type === 'floor' ? floorBoxes(full)
        : solidBoxes(full);
    if (boxes.length === 0) return null;
    return { piece, selection: [...game.editor.selection], tileBoxes: boxes };
  }
}
