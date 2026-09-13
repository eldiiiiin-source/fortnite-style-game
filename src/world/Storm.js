/**
 * Storm.js — the shrinking safe zone. MASTER_SPEC §9, MAP_SPEC §3.2.
 */
import { STORM_PHASES, WORLD, MATCH, SIM } from '../core/Config.js';
import { Events } from '../core/EventBus.js';
import { lerp } from '../core/MathUtils.js';

export const StormState = Object.freeze({
  WAITING: 'waiting',
  SHRINKING: 'shrinking',
  FINISHED: 'finished'
});

export class Storm {
  /**
   * @param {import('../core/Random.js').RandomStream} rng  the `storm` stream
   * @param {import('../core/EventBus.js').EventBus} [bus]
   */
  constructor(rng, bus = null) {
    this.rng = rng;
    this.bus = bus;

    this.phaseIndex = -1;
    this.state = StormState.WAITING;
    this.timer = MATCH.dropDuration;

    const jitter = WORLD.initialCentreJitter;
    this.centre = {
      x: rng.range(-jitter, jitter),
      z: rng.range(-jitter, jitter)
    };
    this.targetCentre = { ...this.centre };

    this.radius = WORLD.initialSafeRadius;
    this.startRadius = this.radius;
    this.targetRadius = this.radius;
    this.dps = 0;
    /** Per-player damage cadence accumulators, keyed by player id. */
    this.damageAccumulators = new Map();
  }

  get currentPhase() {
    return STORM_PHASES[this.phaseIndex] ?? null;
  }

  get isFinished() {
    return this.state === StormState.FINISHED;
  }

  /** Pick the next circle's centre inside the current one (§9). */
  _chooseNextCentre(nextRadius) {
    // Uniform in the annulus the next circle can occupy without leaving the current one.
    const maxOffset = Math.max(0, this.radius - nextRadius);
    const angle = this.rng.range(0, Math.PI * 2);
    const dist = Math.sqrt(this.rng.next()) * maxOffset;
    return {
      x: this.centre.x + Math.cos(angle) * dist,
      z: this.centre.z + Math.sin(angle) * dist
    };
  }

  _advancePhase() {
    this.phaseIndex++;
    const phase = this.currentPhase;
    if (!phase) {
      this.state = StormState.FINISHED;
      return;
    }
    this.state = StormState.WAITING;
    this.timer = phase.wait;
    this.dps = phase.dps;

    this.startRadius = this.radius;
    this.targetRadius = WORLD.initialSafeRadius * phase.radiusFraction;
    this.targetCentre = this._chooseNextCentre(this.targetRadius);

    this.bus?.emit(Events.STORM_PHASE_CHANGED, {
      phase: phase.phase, radius: this.targetRadius, dps: phase.dps
    });
  }

  update(dt) {
    if (this.state === StormState.FINISHED) return;

    this.timer -= dt;

    if (this.phaseIndex < 0) {
      if (this.timer <= 0) this._advancePhase();
      return;
    }

    const phase = this.currentPhase;

    if (this.state === StormState.WAITING) {
      if (this.timer <= 0) {
        this.state = StormState.SHRINKING;
        this.timer = phase.shrink;
        this.shrinkDuration = phase.shrink;
      }
      return;
    }

    // SHRINKING — interpolate radius and centre over the phase's shrink duration.
    const t = 1 - Math.max(0, this.timer) / this.shrinkDuration;
    this.radius = lerp(this.startRadius, this.targetRadius, t);
    this.centre = {
      x: lerp(this.centre.x, this.targetCentre.x, Math.min(1, dt * 2)),
      z: lerp(this.centre.z, this.targetCentre.z, Math.min(1, dt * 2))
    };

    if (this.timer <= 0) {
      this.radius = this.targetRadius;
      this.centre = { ...this.targetCentre };
      this._advancePhase();
    }
  }

  isInside(x, z) {
    return Math.hypot(x - this.centre.x, z - this.centre.z) <= this.radius;
  }

  /**
   * Storm damage owed to one player this tick. Damage lands on a 1 s cadence (§9).
   * The cadence is tracked per player so entering the storm starts that player's own
   * clock rather than inheriting someone else's.
   *
   * @param {number} playerId
   * @returns {number} damage to apply now, 0 on most ticks
   */
  damageFor(playerId, x, z, dt) {
    if (this.isInside(x, z) || this.dps <= 0) {
      this.damageAccumulators.delete(playerId);
      return 0;
    }
    const acc = (this.damageAccumulators.get(playerId) ?? 0) + dt;
    // Accumulating a fixed dt drifts below the interval by an ULP or two (30 * 1/30 is
    // 0.9999999999999999), which would push every storm tick a frame late. Half a tick of
    // tolerance keeps the cadence on the second it belongs to.
    if (acc < MATCH.stormTickInterval - SIM.fixedDt / 2) {
      this.damageAccumulators.set(playerId, acc);
      return 0;
    }
    this.damageAccumulators.set(playerId, acc - MATCH.stormTickInterval);
    return this.dps;
  }
}
