/**
 * Settings.js — user settings and keybinds. MASTER_SPEC §19, §20.
 *
 * Settings are DATA, separate from the systems that read them (§2). Nothing here reaches
 * into a system; systems read values through `applyTo` or by holding a reference.
 *
 * Persisted to localStorage when available. Every read is guarded — storage can be
 * absent, full, or disabled, and the game must still start with defaults.
 */
import { DEFAULT_BINDINGS, BIND_CONFLICT_EXEMPT, CAMERA } from './Config.js';

const STORAGE_KEY = 'settings.v1';

/** §19 — the full settings surface, grouped as the spec groups it. */
export const DEFAULT_SETTINGS = Object.freeze({
  video: {
    fullscreen: false,
    quality: 'high',          // low | medium | high
    shadows: true,
    effects: true,
    renderDistance: 1.0,      // multiplier on the configured draw distance
    fpsLimit: 0,              // 0 = uncapped
    fov: CAMERA.fovDefault
  },
  input: {
    mouseSensitivity: 1.0,
    adsSensitivity: CAMERA.adsSensitivityScale,
    scopeSensitivity: CAMERA.scopeSensitivityScale,
    invertY: false
  },
  gameplay: {
    sprintMode: 'hold',       // hold | toggle | auto
    confirmEditOnRelease: true,   // §4.2 — required ON/OFF
    buildImmediately: true,       // §19 — placing a piece enters build mode at once
    resetEditBind: DEFAULT_BINDINGS.resetEdit
  },
  audio: {
    master: 0.8,
    music: 0.4,
    sfx: 0.9,
    environment: 0.6
  },
  hud: {
    scale: 1.0,
    crosshair: true,
    minimap: true,
    damageNumbers: true
  }
});

/** Deep clone of a plain settings object. */
const clone = (o) => JSON.parse(JSON.stringify(o));

export class Settings {
  constructor(initial = null) {
    this.values = clone(initial ?? DEFAULT_SETTINGS);
    this.bindings = { ...DEFAULT_BINDINGS };
    this.listeners = new Set();
  }

  /* ── convenience accessors used by systems ───────────────────────────── */

  get mouseSensitivity() { return this.values.input.mouseSensitivity; }
  get invertY() { return this.values.input.invertY; }
  get confirmEditOnRelease() { return this.values.gameplay.confirmEditOnRelease; }
  get buildImmediately() { return this.values.gameplay.buildImmediately; }
  get sprintMode() { return this.values.gameplay.sprintMode; }
  get fov() { return this.values.video.fov; }
  get hudScale() { return this.values.hud.scale; }

  /** Subscribe to changes. Returns an unsubscribe function. */
  onChange(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  _notify(path, value) {
    for (const fn of this.listeners) {
      try {
        fn(path, value, this);
      } catch (err) {
        console.error('Settings listener threw:', err);
      }
    }
  }

  /**
   * Read a value by dotted path, e.g. 'video.quality'.
   * @returns {*} the value, or undefined if the path does not exist
   */
  get(path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), this.values);
  }

  /**
   * Write a value by dotted path. Unknown paths are rejected rather than silently
   * creating new settings, so a typo surfaces instead of vanishing.
   * @returns {boolean} whether the write was accepted
   */
  set(path, value) {
    const keys = path.split('.');
    const last = keys.pop();
    let node = this.values;
    for (const k of keys) {
      if (node[k] == null || typeof node[k] !== 'object') return false;
      node = node[k];
    }
    if (!(last in node)) return false;

    const clamped = this._clamp(path, value);
    if (clamped === undefined) return false;
    node[last] = clamped;
    this._notify(path, clamped);
    return true;
  }

  /** Range and enum validation, so a bad value can never reach a system. */
  _clamp(path, value) {
    const num = (v, lo, hi) =>
      (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
    const bool = (v) => (typeof v === 'boolean' ? v : undefined);
    const oneOf = (v, list) => (list.includes(v) ? v : undefined);

    switch (path) {
      case 'video.quality': return oneOf(value, ['low', 'medium', 'high']);
      case 'video.fov': return num(value, 60, 120);
      case 'video.renderDistance': return num(value, 0.25, 2.0);
      case 'video.fpsLimit': return num(value, 0, 480);
      case 'video.fullscreen':
      case 'video.shadows':
      case 'video.effects': return bool(value);

      case 'input.mouseSensitivity': return num(value, 0.05, 10);
      case 'input.adsSensitivity':
      case 'input.scopeSensitivity': return num(value, 0.05, 2);
      case 'input.invertY': return bool(value);

      case 'gameplay.sprintMode': return oneOf(value, ['hold', 'toggle', 'auto']);
      case 'gameplay.confirmEditOnRelease':
      case 'gameplay.buildImmediately': return bool(value);
      case 'gameplay.resetEditBind':
        return typeof value === 'string' && value.length > 0 ? value : undefined;

      case 'audio.master':
      case 'audio.music':
      case 'audio.sfx':
      case 'audio.environment': return num(value, 0, 1);

      case 'hud.scale': return num(value, 0.6, 1.6);
      case 'hud.crosshair':
      case 'hud.minimap':
      case 'hud.damageNumbers': return bool(value);

      default: return value;
    }
  }

  /* ── keybinds — §20 ──────────────────────────────────────────────────── */

  /**
   * Rebind an action. Conflicts are reported, never silently accepted.
   * @returns {{ok:boolean, conflicts:string[]}}
   */
  rebind(action, code, { force = false } = {}) {
    if (!(action in this.bindings)) return { ok: false, conflicts: [] };

    // Honour the same exemptions `Input` does (§4.5). Without this the settings screen
    // reported a conflict for pairs the game deliberately shares — pickaxe with slot 1,
    // fire with confirm-edit — and refused a bind the simulation handles perfectly well.
    const exempt = new Set(
      BIND_CONFLICT_EXEMPT.filter((pair) => pair.includes(action)).flat()
    );
    const conflicts = Object.entries(this.bindings)
      .filter(([other, bound]) => other !== action && bound === code && !exempt.has(other))
      .map(([other]) => other);

    if (conflicts.length > 0 && !force) return { ok: false, conflicts };
    if (force) for (const other of conflicts) this.bindings[other] = null;

    this.bindings[action] = code;
    if (action === 'resetEdit') this.values.gameplay.resetEditBind = code;
    this._notify(`bindings.${action}`, code);
    return { ok: true, conflicts };
  }

  resetBindings() {
    this.bindings = { ...DEFAULT_BINDINGS };
    this._notify('bindings', this.bindings);
  }

  resetAll() {
    this.values = clone(DEFAULT_SETTINGS);
    this.resetBindings();
    this._notify('*', this.values);
  }

  /* ── persistence ─────────────────────────────────────────────────────── */

  /** Merge stored values over the defaults, keeping unknown stored keys out. */
  load(storage = globalThis.localStorage) {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      if (parsed?.values) this._mergeKnown(this.values, parsed.values);
      if (parsed?.bindings) {
        for (const [action, code] of Object.entries(parsed.bindings)) {
          if (action in this.bindings) this.bindings[action] = code;
        }
      }
      return true;
    } catch {
      // Corrupt or unavailable storage must never stop the game starting.
      return false;
    }
  }

  save(storage = globalThis.localStorage) {
    try {
      storage?.setItem(STORAGE_KEY, JSON.stringify({
        values: this.values, bindings: this.bindings
      }));
      return true;
    } catch {
      return false;
    }
  }

  /** Copy only keys that already exist in the target, at any depth. */
  _mergeKnown(target, source) {
    for (const [k, v] of Object.entries(source)) {
      if (!(k in target)) continue;
      if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object') {
        this._mergeKnown(target[k], v);
      } else {
        target[k] = v;
      }
    }
  }

  /* ── applying to systems ─────────────────────────────────────────────── */

  /**
   * Push current values into the systems that consume them. Called once at startup and
   * whenever the settings UI commits a change.
   */
  applyTo({ renderer = null, input = null } = {}) {
    if (input) input.bindings = { ...this.bindings };
    if (renderer) {
      renderer.setQuality(this.values.video.quality);
      renderer.setRenderDistance?.(this.values.video.renderDistance);
      if (renderer.camera) {
        renderer.camera.fov = this.values.video.fov;
        renderer.camera.updateProjectionMatrix();
      }
    }
  }

  toJSON() {
    return { values: clone(this.values), bindings: { ...this.bindings } };
  }
}
