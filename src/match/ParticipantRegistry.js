/**
 * ParticipantRegistry.js — BATTLE_ROYALE_SPEC §10.
 *
 * "Human + bots use the same participant registry."
 *
 * One registry is what makes the remaining-player count, placement and the win condition
 * consistent: there is no separate human path to disagree with the bot path.
 *
 * Eliminated participants are RETAINED, not deleted — §10 requires post-match statistics to
 * survive elimination.
 */
export const ParticipantKind = Object.freeze({ HUMAN: 'human', BOT: 'bot' });

export class ParticipantRegistry {
  constructor(bus = null) {
    this.bus = bus;
    /** @type {Map<number, object>} id -> record */
    this.participants = new Map();
    this.eliminationOrder = [];
  }

  get total() {
    return this.participants.size;
  }

  get alive() {
    return [...this.participants.values()].filter((p) => p.alive);
  }

  get aliveCount() {
    let n = 0;
    for (const p of this.participants.values()) if (p.alive) n++;
    return n;
  }

  get human() {
    for (const p of this.participants.values()) {
      if (p.kind === ParticipantKind.HUMAN) return p;
    }
    return null;
  }

  /**
   * @param {object} opts
   * @param {number} opts.id
   * @param {string} opts.kind
   * @param {string} [opts.name]
   * @param {object} [opts.ref]  the live controller (player or Bot)
   */
  register({ id, kind, name = null, ref = null }) {
    const record = {
      id,
      kind,
      name: name ?? (kind === ParticipantKind.HUMAN ? 'You' : `Bot ${id}`),
      ref,
      alive: true,
      placement: null,
      eliminatedBy: null,
      eliminatedAt: null,
      stats: {
        eliminations: 0,
        damageDealt: 0,
        damageTaken: 0,
        shotsFired: 0,
        shotsHit: 0,
        materialsGathered: 0,
        healingUsed: 0
      }
    };
    this.participants.set(id, record);
    return record;
  }

  get(id) {
    return this.participants.get(id) ?? null;
  }

  /**
   * Mark a participant eliminated. Placement is assigned from the back: the first to die in
   * a 25-player match places 25th, and the last survivor places 1st.
   *
   * @returns {object|null} the eliminated record
   */
  eliminate(id, { by = null, at = 0 } = {}) {
    const record = this.participants.get(id);
    if (!record || !record.alive) return null;

    record.alive = false;
    record.eliminatedAt = at;
    record.eliminatedBy = by;
    // Everyone still alive, plus this participant, outrank the already-dead.
    record.placement = this.aliveCount + 1;
    this.eliminationOrder.push(id);

    if (by !== null) {
      const killer = this.participants.get(by);
      if (killer) killer.stats.eliminations++;
    }

    this.bus?.emit('match:participantEliminated', {
      id, kind: record.kind, by, placement: record.placement, remaining: this.aliveCount
    });
    return record;
  }

  /** Record a stat against a participant. Unknown ids are ignored, never thrown on. */
  addStat(id, stat, amount = 1) {
    const record = this.participants.get(id);
    if (!record || !(stat in record.stats)) return false;
    record.stats[stat] += amount;
    return true;
  }

  /** §11 — the match ends when exactly one participant remains alive. */
  get isMatchOver() {
    return this.aliveCount <= 1;
  }

  /** The last participant standing, or null while several remain. */
  get winner() {
    if (!this.isMatchOver) return null;
    return this.alive[0] ?? null;
  }

  /**
   * Final placement for a participant. A survivor at match end places 1st; the eliminated
   * keep the placement assigned when they died.
   */
  placementOf(id) {
    const record = this.participants.get(id);
    if (!record) return null;
    if (record.placement !== null) return record.placement;
    return record.alive ? 1 : null;
  }

  /** Assign placement 1 to whoever is still standing, at match end. */
  finalise() {
    for (const record of this.participants.values()) {
      if (record.alive && record.placement === null) record.placement = 1;
    }
  }

  clear() {
    this.participants.clear();
    this.eliminationOrder.length = 0;
  }

  /** Snapshot for the HUD and admin panel. */
  snapshot() {
    return {
      total: this.total,
      alive: this.aliveCount,
      eliminated: this.total - this.aliveCount
    };
  }
}
