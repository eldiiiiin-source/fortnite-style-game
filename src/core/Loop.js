/**
 * Loop.js — fixed-timestep simulation with an interpolated render. MASTER_SPEC §2.1.
 *
 * Systems receive exactly SIM.fixedDt. The renderer receives an interpolation alpha in
 * [0, 1) between the previous and current simulation states. Nothing in the simulation
 * ever sees real frame time.
 */
import { SIM } from './Config.js';

export class Loop {
  /**
   * @param {(dt:number, ctx:object)=>void} simulate
   * @param {(alpha:number, ctx:object)=>void} render
   * @param {object} ctx  context passed to both callbacks
   */
  constructor(simulate, render, ctx = {}) {
    this.simulate = simulate;
    this.render = render;
    this.ctx = ctx;

    this.accumulator = 0;
    this.lastTime = 0;
    this.running = false;
    this.frameHandle = null;

    /** Diagnostics — read by the HUD, never by simulation code. */
    this.stats = { tick: 0, frame: 0, simMs: 0, frameMs: 0, droppedSteps: 0 };

    this._frame = this._frame.bind(this);
  }

  start(now = performance.now()) {
    if (this.running) return;
    this.running = true;
    this.lastTime = now;
    this.accumulator = 0;
    this.frameHandle = requestAnimationFrame(this._frame);
  }

  stop() {
    this.running = false;
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
  }

  _frame(now) {
    if (!this.running) return;
    this.frameHandle = requestAnimationFrame(this._frame);
    this.step(now);
  }

  /**
   * Advance by real elapsed time. Exposed separately from _frame so tests can drive the
   * loop without requestAnimationFrame.
   */
  step(now) {
    const frameStart = now;
    let elapsed = (now - this.lastTime) / 1000;
    this.lastTime = now;

    // A tab that was backgrounded can hand us a huge delta. Clamp rather than
    // simulating minutes of game time in one frame.
    const maxElapsed = SIM.fixedDt * SIM.maxStepsPerFrame;
    if (elapsed > maxElapsed) {
      this.stats.droppedSteps += Math.floor((elapsed - maxElapsed) / SIM.fixedDt);
      elapsed = maxElapsed;
    }

    this.accumulator += elapsed;

    const simStart = performance.now();
    let steps = 0;
    while (this.accumulator >= SIM.fixedDt && steps < SIM.maxStepsPerFrame) {
      this.simulate(SIM.fixedDt, this.ctx);
      this.accumulator -= SIM.fixedDt;
      this.stats.tick++;
      steps++;
    }
    this.stats.simMs = performance.now() - simStart;

    const alpha = this.accumulator / SIM.fixedDt;
    this.render(alpha, this.ctx);

    this.stats.frame++;
    this.stats.frameMs = performance.now() - frameStart;
  }
}
