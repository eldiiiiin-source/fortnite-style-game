/**
 * Input.js — MASTER_SPEC §4.
 *
 * Contract: input is sampled every frame; build and edit inputs are NEVER dropped.
 *
 * Events arrive on browser event handlers (many per simulation tick at high frame rates)
 * and are latched into counters. The simulation drains them once per tick. Because
 * presses are COUNTED rather than flagged, two presses landing inside one tick both
 * survive — which is what makes rapid build and edit sequences reliable (§9.3, §10.10).
 */
import { DEFAULT_BINDINGS, BIND_CONFLICT_EXEMPT, CAMERA } from './Config.js';

/** Synthetic codes for wheel directions, independently bindable per §4. */
export const WHEEL_UP = 'WheelUp';
export const WHEEL_DOWN = 'WheelDown';

export class Input {
  constructor(bindings = DEFAULT_BINDINGS) {
    this.bindings = { ...bindings };

    /** Physical codes currently held. */
    this.held = new Set();
    /** code -> number of presses since the last drain. Never collapses to a flag. */
    this.pressCounts = new Map();
    /** code -> number of releases since the last drain. */
    this.releaseCounts = new Map();

    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.pointerLocked = false;

    this._detach = [];
    this.canvasEl = null;
  }

  /* ── lifecycle ─────────────────────────────────────────────────────────── */

  attach(canvasEl) {
    this.canvasEl = canvasEl;
    const on = (el, type, fn, opts) => {
      el.addEventListener(type, fn, opts);
      this._detach.push(() => el.removeEventListener(type, fn, opts));
    };

    on(window, 'keydown', (e) => {
      if (e.repeat) return;          // auto-repeat is not a new press
      this._press(e.code);
      if (this.pointerLocked && /^F\d+$/.test(e.code)) e.preventDefault();
    });
    on(window, 'keyup', (e) => this._release(e.code));
    on(window, 'blur', () => this._releaseAll());

    on(canvasEl, 'mousedown', (e) => this._press(`Mouse${e.button}`));
    on(window, 'mouseup', (e) => this._release(`Mouse${e.button}`));
    on(canvasEl, 'contextmenu', (e) => e.preventDefault());

    on(window, 'mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.lookDeltaX += e.movementX || 0;
      this.lookDeltaY += e.movementY || 0;
    });

    // §4 — wheel up and wheel down are separate, independently bindable codes. A wheel
    // notch is a press and an immediate release; it is never "held".
    on(window, 'wheel', (e) => {
      if (e.deltaY === 0) return;
      const code = e.deltaY < 0 ? WHEEL_UP : WHEEL_DOWN;
      this._press(code);
      this._release(code);
      this.held.delete(code);
    }, { passive: true });

    on(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvasEl;
      if (!this.pointerLocked) this._releaseAll();
    });
  }

  detach() {
    for (const off of this._detach) off();
    this._detach.length = 0;
  }

  requestPointerLock() {
    this.canvasEl?.requestPointerLock?.();
  }

  /* ── raw event latching ────────────────────────────────────────────────── */

  _press(code) {
    this.pressCounts.set(code, (this.pressCounts.get(code) ?? 0) + 1);
    this.held.add(code);
  }

  _release(code) {
    this.releaseCounts.set(code, (this.releaseCounts.get(code) ?? 0) + 1);
    this.held.delete(code);
  }

  _releaseAll() {
    for (const code of [...this.held]) this._release(code);
  }

  /** Test seam: synthesise input without a DOM. */
  simulatePress(code) { this._press(code); }
  simulateRelease(code) { this._release(code); }
  simulateWheel(direction) {
    const code = direction < 0 ? WHEEL_UP : WHEEL_DOWN;
    this._press(code);
    this._release(code);
    this.held.delete(code);
  }
  simulateLook(dx, dy) { this.lookDeltaX += dx; this.lookDeltaY += dy; }

  /* ── queries, by action ────────────────────────────────────────────────── */

  isDown(action) {
    return this.held.has(this.bindings[action]);
  }

  /** Was the action pressed at least once since the last drain? */
  wasPressed(action) {
    return (this.pressCounts.get(this.bindings[action]) ?? 0) > 0;
  }

  /**
   * How many times was the action pressed since the last drain? Build and edit code uses
   * this rather than wasPressed so a burst inside one tick places a piece per press
   * instead of collapsing to one (§9.3).
   */
  pressCount(action) {
    return this.pressCounts.get(this.bindings[action]) ?? 0;
  }

  wasReleased(action) {
    return (this.releaseCounts.get(this.bindings[action]) ?? 0) > 0;
  }

  /** Drain the accumulated look delta. Exactly once per simulation tick. */
  consumeLook() {
    const x = this.lookDeltaX;
    const y = this.lookDeltaY;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return { x, y };
  }

  /** Normalised movement intent, local space: x right, z forward. */
  moveAxis() {
    const x = (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0);
    const z = (this.isDown('moveForward') ? 1 : 0) - (this.isDown('moveBackward') ? 1 : 0);
    const len = Math.hypot(x, z);
    return len > 1 ? { x: x / len, z: z / len } : { x, z };
  }

  /** Clear per-tick edge state. Call at the END of every simulation tick. */
  endTick() {
    this.pressCounts.clear();
    this.releaseCounts.clear();
  }

  /* ── rebinding — §20 ───────────────────────────────────────────────────── */

  /**
   * Find actions that would collide with binding `action` to `code`.
   * @returns {string[]} conflicting action names, empty if the bind is clean
   */
  findConflicts(action, code) {
    const exempt = new Set(
      BIND_CONFLICT_EXEMPT
        .filter((pair) => pair.includes(action))
        .flat()
    );
    return Object.entries(this.bindings)
      .filter(([other, bound]) => other !== action && bound === code && !exempt.has(other))
      .map(([other]) => other);
  }

  /**
   * Rebind an action. Conflicts are reported, never silently accepted (§20).
   * @returns {{ok:boolean, conflicts:string[]}}
   */
  rebind(action, code, { force = false } = {}) {
    if (!(action in this.bindings)) return { ok: false, conflicts: [] };
    const conflicts = this.findConflicts(action, code);
    if (conflicts.length > 0 && !force) return { ok: false, conflicts };
    if (force) for (const other of conflicts) this.bindings[other] = null;
    this.bindings[action] = code;
    return { ok: true, conflicts };
  }

  /** Every conflicting pair in the current binding set. */
  allConflicts() {
    const out = [];
    const actions = Object.keys(this.bindings);
    for (let i = 0; i < actions.length; i++) {
      for (let j = i + 1; j < actions.length; j++) {
        const a = actions[i], b = actions[j];
        if (this.bindings[a] == null || this.bindings[a] !== this.bindings[b]) continue;
        const exempt = BIND_CONFLICT_EXEMPT.some(
          (pair) => pair.includes(a) && pair.includes(b)
        );
        if (!exempt) out.push([a, b]);
      }
    }
    return out;
  }

  resetBindings() {
    this.bindings = { ...DEFAULT_BINDINGS };
  }

  /** Effective look sensitivity for the current aim state (§7, §19). */
  static sensitivityFor({ adsProgress = 0, scoped = false, userSensitivity = 1 } = {}) {
    const aimScale = scoped ? CAMERA.scopeSensitivityScale : CAMERA.adsSensitivityScale;
    const scale = 1 + (aimScale - 1) * adsProgress;
    return CAMERA.lookSensitivity * userSensitivity * scale;
  }
}
