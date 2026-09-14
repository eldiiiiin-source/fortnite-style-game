/**
 * SceneManager.js — BATTLE_ROYALE_SPEC §14, ITEM_SHOP_SPEC §8.3.
 *
 * A scene owns a screen's lifecycle. Only one is active at a time.
 *
 * Both specs describe the same tree, so this serves both: lobby, shop, locker, match and
 * results. `Game` stays the gameplay simulation and knows nothing about scenes (§14).
 */
export const SceneName = Object.freeze({
  LOBBY: 'lobby',
  SHOP: 'shop',
  LOCKER: 'locker',
  MATCH: 'match',
  RESULTS: 'results',
  SETTINGS: 'settings'
});

/** Base class. Scenes override what they need; all hooks are optional. */
export class Scene {
  constructor(name, app) {
    this.name = name;
    this.app = app;
    this.active = false;
  }

  /** Called when the scene becomes active. */
  enter(_params = {}) {}
  /** Called when the scene is replaced. */
  exit() {}
  /** Fixed-step update while active. */
  update(_dt) {}
  /**
   * Called once per rendered frame while active.
   *
   * Deliberately NOT named `render`: menu scenes use `render()` to rebuild their DOM, and
   * driving that every frame detaches elements mid-interaction. The two concerns get two
   * names so they cannot be confused again.
   */
  frame(_alpha) {}
}

export class SceneManager {
  constructor(app = null) {
    this.app = app;
    this.scenes = new Map();
    this.current = null;
    this.history = [];
  }

  register(name, scene) {
    this.scenes.set(name, scene);
    return scene;
  }

  get currentName() {
    return this.current?.name ?? null;
  }

  /**
   * Switch scenes. The outgoing scene's exit() always runs before the incoming enter(),
   * so a scene can rely on tearing down cleanly.
   *
   * @returns {boolean} whether the switch happened
   */
  goTo(name, params = {}) {
    const next = this.scenes.get(name);
    if (!next) return false;
    if (this.current === next) return false;

    if (this.current) {
      this.current.active = false;
      try {
        this.current.exit();
      } catch (err) {
        console.error(`Scene ${this.current.name} exit() threw:`, err);
      }
    }

    this.history.push(name);
    if (this.history.length > 32) this.history.shift();

    this.current = next;
    next.active = true;
    try {
      next.enter(params);
    } catch (err) {
      console.error(`Scene ${name} enter() threw:`, err);
    }
    return true;
  }

  /** Return to the previous scene, if there is one. */
  back() {
    if (this.history.length < 2) return false;
    this.history.pop();
    const previous = this.history.pop();
    return this.goTo(previous);
  }

  update(dt) {
    if (!this.current) return;
    try {
      this.current.update(dt);
    } catch (err) {
      console.error(`Scene ${this.current.name} update() threw:`, err);
    }
  }

  frame(alpha) {
    if (!this.current) return;
    try {
      this.current.frame(alpha);
    } catch (err) {
      console.error(`Scene ${this.current.name} frame() threw:`, err);
    }
  }
}
