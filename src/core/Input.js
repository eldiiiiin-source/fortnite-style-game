/**
 * Input.js — rebindable input over Pointer Lock. MASTER_SPEC §11.3.
 *
 * Mouse look is read from raw movementX/Y deltas and accumulated; the simulation drains
 * the accumulator each tick so look is frame-rate independent and never smoothed.
 */
import { DEFAULT_BINDINGS } from './Config.js';

export class Input {
  constructor(target = document, bindings = DEFAULT_BINDINGS) {
    this.target = target;
    this.bindings = { ...bindings };

    this.down = new Set();        // physical codes currently held
    this.pressedThisTick = new Set();
    this.releasedThisTick = new Set();

    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    this.wheelDelta = 0;
    this.pointerLocked = false;

    this._bound = [];
  }

  attach(canvasEl) {
    const add = (el, type, fn) => {
      el.addEventListener(type, fn);
      this._bound.push(() => el.removeEventListener(type, fn));
    };

    add(window, 'keydown', (e) => {
      if (e.repeat) return;
      this._press(e.code);
      // Stop F1-F5 opening browser help etc. while we own the pointer.
      if (this.pointerLocked && /^F\d$/.test(e.code)) e.preventDefault();
    });
    add(window, 'keyup', (e) => this._release(e.code));
    add(window, 'blur', () => this._releaseAll());

    add(canvasEl, 'mousedown', (e) => this._press(`Mouse${e.button}`));
    add(window, 'mouseup', (e) => this._release(`Mouse${e.button}`));
    add(canvasEl, 'contextmenu', (e) => e.preventDefault());

    add(window, 'mousemove', (e) => {
      if (!this.pointerLocked) return;
      this.lookDeltaX += e.movementX || 0;
      this.lookDeltaY += e.movementY || 0;
    });

    add(window, 'wheel', (e) => { this.wheelDelta += Math.sign(e.deltaY); }, { passive: true });

    add(document, 'pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvasEl;
      if (!this.pointerLocked) this._releaseAll();
    });

    this.canvasEl = canvasEl;
  }

  requestPointerLock() {
    this.canvasEl?.requestPointerLock?.();
  }

  detach() {
    for (const off of this._bound) off();
    this._bound.length = 0;
  }

  _press(code) {
    if (!this.down.has(code)) this.pressedThisTick.add(code);
    this.down.add(code);
  }

  _release(code) {
    if (this.down.has(code)) this.releasedThisTick.add(code);
    this.down.delete(code);
  }

  _releaseAll() {
    for (const code of this.down) this.releasedThisTick.add(code);
    this.down.clear();
  }

  /** Is the action's bound key held? */
  isDown(action) {
    return this.down.has(this.bindings[action]);
  }

  /** Was the action's bound key pressed since the last endTick()? */
  wasPressed(action) {
    return this.pressedThisTick.has(this.bindings[action]);
  }

  wasReleased(action) {
    return this.releasedThisTick.has(this.bindings[action]);
  }

  /** Drain the accumulated look delta. Call exactly once per simulation tick. */
  consumeLook() {
    const x = this.lookDeltaX;
    const y = this.lookDeltaY;
    this.lookDeltaX = 0;
    this.lookDeltaY = 0;
    return { x, y };
  }

  consumeWheel() {
    const w = this.wheelDelta;
    this.wheelDelta = 0;
    return w;
  }

  /** Normalised movement intent in local space: x = right, z = forward. */
  moveAxis() {
    const x = (this.isDown('moveRight') ? 1 : 0) - (this.isDown('moveLeft') ? 1 : 0);
    const z = (this.isDown('moveForward') ? 1 : 0) - (this.isDown('moveBack') ? 1 : 0);
    const len = Math.hypot(x, z);
    return len > 1 ? { x: x / len, z: z / len } : { x, z };
  }

  /** Clear per-tick edge state. Call at the end of every simulation tick. */
  endTick() {
    this.pressedThisTick.clear();
    this.releasedThisTick.clear();
  }

  rebind(action, code) {
    this.bindings[action] = code;
  }
}
