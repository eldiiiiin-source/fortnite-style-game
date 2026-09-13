/**
 * Storm.js — BATTLE_ROYALE_SPEC §8.
 *
 * Rebuilt from scratch against the owner's phase table. The deleted baseline's assumptions
 * are NOT restored: phases are data-driven from MetaConfig, radii scale from the region
 * size, and no storm geometry is hard-coded into any other system.
 *
 * Invariants this module guarantees, each asserted by test:
 *  - the next safe zone always lies entirely within the current one (§8)
 *  - the radius never grows
 *  - the final circle reaches exactly zero
 *  - damage bypasses shield and accumulates in real time, never per frame (§8.3)
 */
import { WORLD } from '../core/Config.js';
import { STORM, STORM_PHASES, initialSafeRadius } from '../meta/MetaConfig.js';
import { Events } from '../core/EventBus.js';
import { lerp } from '../core/MathUtils.js';

export const StormState = Object.freeze({
  IDLE: 'idle',
  WAITING: 'waiting',
  SHRINKING: 'shrinking',
  FINISHED: 'finished'
});

export class Storm {
  /**
   * @param {object} opts
   * @param {import('../core/Random.js').RandomStream} opts.rng  the `storm` stream
   * @param {import('../core/EventBus.js').EventBus} [opts.bus]
   * @param {number} [opts.regionExtent]  so radii scale with map size (§8.1)
   */
  constructor({ rng, bus = null, regionExtent = WORLD.regionExtent } = {}) {
    this.rng = rng;
    this.bus = bus;
    this.regionExtent = regionExtent;

    this.initialRadius = initialSafeRadius(regionExtent);
    this.state = StormState.IDLE;
    this.phaseIndex = -1;
    this.timer = 0;

    this.centre = { x: 0, z: 0 };
    this.radius = this.initialRadius;
    this.nextCentre = { x: 0, z: 0 };
    this.nextRadius = this.initialRadius;

    this.shrinkFrom = { centre: { x: 0, z: 0 }, radius: this.initialRadius };
    this.shrinkDuration = 0;
    this.damagePerSecond = 0;
    this.damageMultiplier = 1;
    this.damageEnabled = true;
    this.paused = false;

    /** Per-participant damage accumulators, so each has its own cadence. */
    this._accumulators = new Map();
    /** Participants currently inside the storm, for enter/leave events. */
    this._inStorm = new Set();
  }

  get currentPhase() {
    return STORM_PHASES[this.phaseIndex] ?? null;
  }

  get nextPhase() {
    return STORM_PHASES[this.phaseIndex + 1] ?? null;
  }

  get isFinished() {
    return this.state === StormState.FINISHED;
  }

  get isShrinking() {
    return this.state === StormState.SHRINKING;
  }

  /** Radius a phase targets, in metres, scaled to this region. */
  radiusForPhase(index) {
    const phase = STORM_PHASES[index];
    return phase ? this.initialRadius * phase.radiusRatio : 0;
  }

  /** Begin the storm at phase 0 (the grace period). */
  start() {
    this.state = StormState.WAITING;
    this.phaseIndex = 0;
    this.radius = this.initialRadius;
    this.centre = { x: 0, z: 0 };
    this.damagePerSecond = STORM_PHASES[0].damage;
    this.timer = STORM_PHASES[0].wait;
    this._planNextZone();
    this.bus?.emit('storm:started', { radius: this.radius, centre: { ...this.centre } });
    this.bus?.emit(Events.STORM_PHASE_CHANGED, {
      phase: 0, radius: this.radius, damage: this.damagePerSecond
    });
  }

  /**
   * Choose the next safe zone. §8 — it must lie entirely within the current zone, so the
   * centre offset is bounded by (currentRadius - nextRadius) and drawn with a sqrt
   * distribution for uniform area coverage.
   */
  _planNextZone() {
    const next = this.nextPhase;
    if (!next) {
      this.nextRadius = 0;
      this.nextCentre = { ...this.centre };
      return;
    }

    this.nextRadius = this.radiusForPhase(this.phaseIndex + 1);
    const maxOffset = Math.max(0, this.radius - this.nextRadius);
    const angle = this.rng.range(0, Math.PI * 2);
    const distance = Math.sqrt(this.rng.next()) * maxOffset;

    this.nextCentre = {
      x: this.centre.x + Math.cos(angle) * distance,
      z: this.centre.z + Math.sin(angle) * distance
    };
  }

  /** Advance to the next phase's wait period. */
  _enterNextPhase() {
    this.phaseIndex++;
    const phase = this.currentPhase;
    if (!phase) {
      this.state = StormState.FINISHED;
      return;
    }
    this.state = StormState.WAITING;
    this.timer = phase.wait;
    this.damagePerSecond = phase.damage;
    this._planNextZone();
    this.bus?.emit(Events.STORM_PHASE_CHANGED, {
      phase: phase.phase, radius: this.radius, nextRadius: this.nextRadius,
      damage: this.damagePerSecond
    });
  }

  _beginShrink() {
    const phase = this.currentPhase;
    const next = this.nextPhase;
    if (!next) {
      this.state = StormState.FINISHED;
      return;
    }

    this.shrinkFrom = { centre: { ...this.centre }, radius: this.radius };
    this.shrinkDuration = next.shrink;
    this.timer = next.shrink;
    this.state = StormState.SHRINKING;

    this.bus?.emit('storm:shrinkStarted', {
      phase: phase?.phase ?? 0,
      from: this.radius, to: this.nextRadius, duration: this.shrinkDuration
    });

    // A zero-duration shrink lands immediately rather than dividing by zero.
    if (this.shrinkDuration <= 0) this._completeShrink();
  }

  _completeShrink() {
    this.radius = this.nextRadius;
    this.centre = { ...this.nextCentre };
    this.bus?.emit('storm:shrinkEnded', { radius: this.radius, centre: { ...this.centre } });
    this._enterNextPhase();
  }

  /** @param {number} dt seconds */
  update(dt) {
    if (this.paused || this.state === StormState.IDLE || this.state === StormState.FINISHED) {
      return;
    }

    this.timer -= dt;

    if (this.state === StormState.WAITING) {
      if (this.timer <= 0) this._beginShrink();
      return;
    }

    // SHRINKING — interpolate radius and centre together over the phase's shrink time.
    const elapsed = this.shrinkDuration - Math.max(0, this.timer);
    const t = this.shrinkDuration > 0 ? Math.min(1, elapsed / this.shrinkDuration) : 1;
    this.radius = lerp(this.shrinkFrom.radius, this.nextRadius, t);
    this.centre = {
      x: lerp(this.shrinkFrom.centre.x, this.nextCentre.x, t),
      z: lerp(this.shrinkFrom.centre.z, this.nextCentre.z, t)
    };

    if (this.timer <= 0) this._completeShrink();
  }

  isInside(x, z) {
    return Math.hypot(x - this.centre.x, z - this.centre.z) <= this.radius;
  }

  /** Distance from a point to the safe zone edge; negative inside. */
  distanceToSafety(x, z) {
    return Math.hypot(x - this.centre.x, z - this.centre.z) - this.radius;
  }

  /** Nearest point inside the NEXT safe zone — what bots rotate toward (§9.7). */
  nextZoneTarget(x, z) {
    const dx = x - this.nextCentre.x;
    const dz = z - this.nextCentre.z;
    const d = Math.hypot(dx, dz);
    if (d <= this.nextRadius * 0.8) return { x, z };   // already comfortably inside
    const scale = (this.nextRadius * 0.7) / (d || 1);
    return {
      x: this.nextCentre.x + dx * scale,
      z: this.nextCentre.z + dz * scale
    };
  }

  /**
   * Storm damage owed to one participant this tick (§8.3).
   * Accumulates real time per participant, so damage is never frame-rate dependent and
   * entering the storm starts that participant's own clock.
   *
   * @returns {number} damage to apply now, 0 on most ticks
   */
  damageFor(participantId, x, z, dt) {
    const inside = this.isInside(x, z);

    // Enter / leave events (§8.6).
    if (!inside && !this._inStorm.has(participantId)) {
      this._inStorm.add(participantId);
      this.bus?.emit('storm:playerEntered', { participantId });
    } else if (inside && this._inStorm.has(participantId)) {
      this._inStorm.delete(participantId);
      this.bus?.emit('storm:playerLeft', { participantId });
    }

    if (inside || !this.damageEnabled || this.damagePerSecond <= 0) {
      this._accumulators.delete(participantId);
      return 0;
    }

    const acc = (this._accumulators.get(participantId) ?? 0) + dt;
    // Accumulating a fixed dt drifts an ULP below the interval; half a tick of tolerance
    // keeps the cadence on the second it belongs to.
    if (acc < STORM.damageTickInterval - dt / 2) {
      this._accumulators.set(participantId, acc);
      return 0;
    }
    this._accumulators.set(participantId, acc - STORM.damageTickInterval);
    return this.damagePerSecond * this.damageMultiplier;
  }

  /* ── admin controls — ADMIN_PANEL_SPEC §9 ─────────────────────────────── */

  pause() { this.paused = true; }
  resume() { this.paused = false; }

  /** Advance immediately to the next phase's shrink. */
  advancePhase() {
    if (this.state === StormState.FINISHED) return false;
    if (this.state === StormState.WAITING) {
      this.timer = 0;
      this._beginShrink();
    } else {
      this.timer = 0;
      this._completeShrink();
    }
    return true;
  }

  /** Jump straight to the final phase. */
  jumpToFinalPhase() {
    while (!this.isFinished && this.phaseIndex < STORM_PHASES.length - 1) {
      this.phaseIndex = STORM_PHASES.length - 2;
      this.radius = this.radiusForPhase(this.phaseIndex);
      this._planNextZone();
      this.advancePhase();
    }
    return true;
  }

  setDamageEnabled(enabled) { this.damageEnabled = !!enabled; }
  setDamageMultiplier(multiplier) { this.damageMultiplier = Math.max(0, multiplier); }

  /** Full reset — §13, no state may leak between matches. */
  reset() {
    this.state = StormState.IDLE;
    this.phaseIndex = -1;
    this.timer = 0;
    this.radius = this.initialRadius;
    this.centre = { x: 0, z: 0 };
    this.nextCentre = { x: 0, z: 0 };
    this.nextRadius = this.initialRadius;
    this.damagePerSecond = 0;
    this.damageMultiplier = 1;
    this.damageEnabled = true;
    this.paused = false;
    this._accumulators.clear();
    this._inStorm.clear();
  }

  /** Snapshot for HUD, minimap and admin panel. */
  snapshot() {
    return {
      state: this.state,
      phase: this.currentPhase?.phase ?? -1,
      phaseName: this.currentPhase?.name ?? 'Inactive',
      timer: Math.max(0, this.timer),
      centre: { ...this.centre },
      radius: this.radius,
      nextCentre: { ...this.nextCentre },
      nextRadius: this.nextRadius,
      damagePerSecond: this.damagePerSecond * this.damageMultiplier,
      shrinking: this.isShrinking
    };
  }
}
