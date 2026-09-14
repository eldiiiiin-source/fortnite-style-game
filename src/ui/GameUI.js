/**
 * GameUI.js — the presentation controller.
 *
 * Owns the DOM layers, registers the real scenes with the Application's SceneManager, and
 * routes navigation, settings and input between them.
 *
 * The Application and its systems know nothing about this class; it reads from them and
 * calls their public methods. That is what keeps the simulation testable headlessly while
 * the browser gets a full UI.
 */
import { el } from './dom.js';
import { installTheme } from './theme.js';
import { Toasts } from './components/Shell.js';
import { SceneName } from '../app/SceneManager.js';
import { LobbyScene } from './scenes/LobbyScene.js';
import { ShopScene } from './scenes/ShopScene.js';
import { LockerScene } from './scenes/LockerScene.js';
import { SettingsScene } from './scenes/SettingsScene.js';
import { MatchScene } from './scenes/MatchScene.js';
import { ResultsScene } from './scenes/ResultsScene.js';
import { AdminPanel } from './AdminPanel.js';
import { PerformanceGovernor } from '../core/Performance.js';

export class GameUI {
  /**
   * @param {import('../app/Application.js').Application} app
   * @param {object} [opts]
   * @param {HTMLElement} [opts.mountPoint]
   * @param {object} [opts.input]
   */
  constructor(app, { mountPoint = document.body, input = null } = {}) {
    this.app = app;
    this.settings = app.settings;
    this.input = input;
    this.governor = new PerformanceGovernor();
    this.loop = null;

    installTheme();

    // Two layers: menus on top of the world, so a match can keep rendering underneath.
    this.worldLayer = el('div', { id: 'world-layer', style: { position: 'fixed', inset: '0', zIndex: '1' } });
    this.menuLayer = el('div.ui-root', { id: 'menu-layer', style: { zIndex: '20' } });
    mountPoint.appendChild(this.worldLayer);
    mountPoint.appendChild(this.menuLayer);

    this.toasts = new Toasts(mountPoint);

    this.scenes = {
      [SceneName.LOBBY]: new LobbyScene(app, this),
      [SceneName.SHOP]: new ShopScene(app, this),
      [SceneName.LOCKER]: new LockerScene(app, this),
      [SceneName.SETTINGS]: new SettingsScene(app, this),
      [SceneName.MATCH]: new MatchScene(app, this),
      [SceneName.RESULTS]: new ResultsScene(app, this)
    };
    for (const [name, scene] of Object.entries(this.scenes)) {
      app.scenes.register(name, scene);
    }

    this.adminPanel = new AdminPanel(app, this);
    this.adminPanel.install(mountPoint);

    this._matchHotkeys = null;
    this._wireEvents();
  }

  /* ── layers ────────────────────────────────────────────────────────────── */

  /** Show a menu screen. */
  setScreen(node) {
    this.menuLayer.classList.remove('hidden');
    this.menuLayer.replaceChildren(node);
  }

  /** Hand the screen over to the 3D world and HUD. */
  showWorld(worldNode, hudNode) {
    this.menuLayer.classList.add('hidden');
    this.menuLayer.replaceChildren();
    this.worldLayer.replaceChildren(worldNode, hudNode);
  }

  hideWorld() {
    this.worldLayer.replaceChildren();
    this.menuLayer.classList.remove('hidden');
    this._unbindMatchHotkeys();
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  navigate(scene, params = {}) {
    this.app.scenes.goTo(scene, params);
  }

  /** Re-render the current menu so a changed balance or loadout shows immediately. */
  refreshChrome() {
    const current = this.app.scenes.current;
    if (current && typeof current.render === 'function' && current.name !== SceneName.MATCH) {
      current.render();
    }
  }

  /* ── settings ──────────────────────────────────────────────────────────── */

  applySettings({ renderer = null } = {}) {
    const target = renderer ?? this.scenes[SceneName.MATCH]?.renderer ?? null;
    this.settings.applyTo({ renderer: target, input: this.input });
    this.settings.save();
  }

  /* ── input ─────────────────────────────────────────────────────────────── */

  attachInput(canvas) {
    if (!this.input || this._inputAttached) return;
    this.input.attach(canvas);
    this._inputAttached = true;
    canvas.addEventListener('click', () => {
      // Pointer lock only makes sense during a match.
      if (this.app.scenes.currentName === SceneName.MATCH) this.input.requestPointerLock();
    });
  }

  /** Match-only hotkeys that are not gameplay binds: map toggle and pause-to-lobby. */
  bindMatchHotkeys(matchScene) {
    this._unbindMatchHotkeys();
    const handler = (e) => {
      if (this.app.scenes.currentName !== SceneName.MATCH) return;
      const bindings = this.settings.bindings;
      if (e.code === bindings.map) {
        e.preventDefault();
        const open = matchScene.toggleMap();
        if (open && document.pointerLockElement) document.exitPointerLock?.();
      } else if (e.code === 'Escape') {
        matchScene.mapScreen?.hide();
      }
    };
    window.addEventListener('keydown', handler);
    this._matchHotkeys = handler;
  }

  _unbindMatchHotkeys() {
    if (!this._matchHotkeys) return;
    window.removeEventListener('keydown', this._matchHotkeys);
    this._matchHotkeys = null;
  }

  /* ── events ────────────────────────────────────────────────────────────── */

  _wireEvents() {
    const bus = this.app.bus;
    bus.on('shop:purchaseCompleted', () => this.refreshChrome());
    bus.on('profile:cosmeticEquipped', () => this.refreshChrome());
  }

  /* ── frame ─────────────────────────────────────────────────────────────── */

  /** Called once per rendered frame. */
  render(alpha, frameMs = 16, dt = 1 / 60) {
    this.app.render(alpha);

    // §23 adaptive quality, applied only through the renderer's own knobs.
    this.governor.sample(frameMs, dt);
    const verdict = this.governor.evaluate();
    if (verdict.changed) {
      this.settings.set('video.quality', verdict.tier);
      this.applySettings();
    }

    if (this.adminPanel.open) this.adminPanel.render();
  }
}
