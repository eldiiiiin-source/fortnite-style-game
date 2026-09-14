/**
 * PlacementQueue.js — MASTER_SPEC §9.3.
 *
 * "Use input buffering or queued placement if necessary. Do not silently drop build
 * inputs because a previous placement happened milliseconds earlier."
 *
 * The baseline rejected placements inside a cooldown window and discarded them, which is
 * precisely the banned behaviour. Here an intent that arrives during the cooldown is
 * BUFFERED and executed as soon as the window opens, so wall -> floor -> ramp, 90s and
 * ramp rushes land every piece the player asked for.
 *
 * Intents older than `queuedIntentLifetime` are dropped as stale — a build the player
 * asked for a quarter-second ago and has since turned away from should not fire late.
 */
import { BUILD } from '../core/Config.js';

export class PlacementQueue {
  constructor({ depth = BUILD.queueDepth, lifetime = BUILD.queuedIntentLifetime } = {}) {
    this.depth = depth;
    this.lifetime = lifetime;
    this.intents = [];
    this.cooldown = 0;
    /** Diagnostics — asserted by tests to prove nothing is silently dropped. */
    this.stats = { enqueued: 0, executed: 0, expired: 0, rejectedFull: 0, discarded: 0 };
  }

  get length() {
    return this.intents.length;
  }

  get isEmpty() {
    return this.intents.length === 0;
  }

  /**
   * Buffer a build intent.
   * @param {object} intent { type, material, rotation }
   * @returns {boolean} whether it was accepted
   */
  enqueue(intent) {
    if (this.intents.length >= this.depth) {
      this.stats.rejectedFull++;
      return false;
    }
    this.intents.push({ ...intent, age: 0 });
    this.stats.enqueued++;
    return true;
  }

  /**
   * Advance the queue and execute whatever is due.
   *
   * @param {number} dt
   * @param {(intent:object) => boolean} execute
   *        Returns true if the placement succeeded. A failed placement (no valid target,
   *        no material) consumes the intent rather than retrying forever.
   * @returns {number} how many placements executed this tick
   */
  update(dt, execute) {
    this.cooldown = Math.max(0, this.cooldown - dt);

    // Age out stale intents.
    for (const intent of this.intents) intent.age += dt;
    const before = this.intents.length;
    this.intents = this.intents.filter((i) => i.age <= this.lifetime);
    this.stats.expired += before - this.intents.length;

    let executed = 0;
    while (this.cooldown <= 0 && this.intents.length > 0) {
      const intent = this.intents.shift();
      const ok = execute(intent);
      if (ok) {
        this.cooldown = BUILD.placementCooldown;
        this.stats.executed++;
        executed++;
      }
      else {
        // Could not be placed (no valid target, no material). Consumed rather than
        // retried forever - but COUNTED, so "nothing is silently dropped" is auditable.
        this.stats.discarded++;
      }
    }
    return executed;
  }

  clear() {
    this.intents.length = 0;
  }

  /**
   * Every enqueued intent must end up in exactly one bucket. Tests assert this to prove
   * no build input disappears unaccounted for (§9.3).
   */
  get accounted() {
    return this.stats.executed + this.stats.discarded + this.stats.expired + this.intents.length;
  }
}
