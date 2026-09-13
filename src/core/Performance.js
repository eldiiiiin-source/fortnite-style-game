/**
 * Performance.js — frame budget monitoring and adaptive quality. MASTER_SPEC §23.
 *
 * "When performance degrades, reduce: distant terrain, decorative props, particles,
 *  shadow quality, excessive foliage, draw calls, expensive post-processing.
 *  Do NOT reduce: input polling, building responsiveness, edit responsiveness,
 *  collision correctness, hit feedback."
 *
 * That list is encoded literally below. The governor may only ever touch things in
 * REDUCIBLE; the PROTECTED list exists so the rule is visible in code rather than
 * remembered, and a test asserts the two never overlap.
 */
import { BUDGET } from './Config.js';

/** Things the governor is allowed to degrade, cheapest-to-lose first. */
export const REDUCIBLE = Object.freeze([
  'postProcessing', 'particles', 'foliageDensity', 'decorativeProps',
  'shadowQuality', 'distantTerrain', 'drawDistance'
]);

/** Things it may never touch, at any frame rate. */
export const PROTECTED = Object.freeze([
  'inputPolling', 'buildResponsiveness', 'editResponsiveness',
  'collisionCorrectness', 'hitFeedback'
]);

export const QUALITY_TIERS = Object.freeze(['low', 'medium', 'high']);

export class PerformanceGovernor {
  /**
   * @param {object} [opts]
   * @param {number} [opts.targetFps]
   * @param {number} [opts.sampleSize]  frames averaged before acting
   */
  constructor({ targetFps = BUDGET.targetFps, sampleSize = 90 } = {}) {
    this.targetFps = targetFps;
    this.budgetMs = 1000 / targetFps;
    this.sampleSize = sampleSize;

    this.samples = [];
    this.tier = 'high';
    /** Seconds before another change is allowed, so quality cannot oscillate. */
    this.cooldown = 0;
    this.cooldownTime = 3.0;
    this.history = [];
  }

  /** Record one frame. */
  sample(frameMs, dt = 0) {
    this.samples.push(frameMs);
    if (this.samples.length > this.sampleSize) this.samples.shift();
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  get averageMs() {
    if (this.samples.length === 0) return 0;
    return this.samples.reduce((a, b) => a + b, 0) / this.samples.length;
  }

  get averageFps() {
    const avg = this.averageMs;
    return avg > 0 ? 1000 / avg : 0;
  }

  /** 95th-percentile frame time — catches stutter an average hides (§17 "no stutters"). */
  get p95Ms() {
    if (this.samples.length === 0) return 0;
    const sorted = [...this.samples].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
  }

  get meetsBudget() {
    return this.samples.length > 0 && this.averageMs <= this.budgetMs;
  }

  /**
   * Decide whether to change quality tier.
   * @returns {{changed:boolean, tier:string, reason:string}}
   */
  evaluate() {
    const noChange = { changed: false, tier: this.tier, reason: 'stable' };
    if (this.samples.length < this.sampleSize) return { ...noChange, reason: 'sampling' };
    if (this.cooldown > 0) return { ...noChange, reason: 'cooldown' };

    const index = QUALITY_TIERS.indexOf(this.tier);

    // Degrade when we are meaningfully over budget.
    if (this.averageMs > this.budgetMs * 1.15 && index > 0) {
      this.tier = QUALITY_TIERS[index - 1];
      this.cooldown = this.cooldownTime;
      this.history.push({ tier: this.tier, direction: 'down', avgMs: this.averageMs });
      return { changed: true, tier: this.tier, reason: 'overBudget' };
    }

    // Restore only with comfortable headroom, so we do not flap at the boundary.
    if (this.averageMs < this.budgetMs * 0.7 && index < QUALITY_TIERS.length - 1) {
      this.tier = QUALITY_TIERS[index + 1];
      this.cooldown = this.cooldownTime;
      this.history.push({ tier: this.tier, direction: 'up', avgMs: this.averageMs });
      return { changed: true, tier: this.tier, reason: 'headroom' };
    }

    return noChange;
  }

  /** What the current tier means for each reducible feature. */
  settingsForTier(tier = this.tier) {
    switch (tier) {
      case 'low':
        return {
          postProcessing: false, particles: 0.3, foliageDensity: 0.35,
          decorativeProps: 0.4, shadowQuality: 0, distantTerrain: 0.5, drawDistance: 0.5
        };
      case 'medium':
        return {
          postProcessing: false, particles: 0.7, foliageDensity: 0.7,
          decorativeProps: 0.75, shadowQuality: 1024, distantTerrain: 0.75, drawDistance: 0.75
        };
      default:
        return {
          postProcessing: true, particles: 1, foliageDensity: 1,
          decorativeProps: 1, shadowQuality: 2048, distantTerrain: 1, drawDistance: 1
        };
    }
  }

  /** A named feature may be degraded only if it is in REDUCIBLE. */
  static canReduce(feature) {
    return REDUCIBLE.includes(feature);
  }

  reset() {
    this.samples.length = 0;
    this.cooldown = 0;
    this.tier = 'high';
  }
}
