/**
 * MatchManager.js — BATTLE_ROYALE_SPEC §2.
 *
 * The ONE authoritative owner of match state. §2 forbids scattering match-state checks
 * through unrelated systems, so every other system either receives state through an event
 * or asks this object.
 *
 * Transitions are deterministic and validated: an illegal transition is refused and
 * reported rather than silently applied, which is what keeps the admin panel (§8.1) from
 * corrupting the machine.
 */
import { Events } from '../core/EventBus.js';

export const MatchState = Object.freeze({
  LOBBY: 'LOBBY',
  QUEUEING: 'QUEUEING',
  PRE_MATCH: 'PRE_MATCH',
  DROP_PHASE: 'DROP_PHASE',
  ACTIVE_MATCH: 'ACTIVE_MATCH',
  ENDGAME: 'ENDGAME',
  VICTORY: 'VICTORY',
  DEFEAT: 'DEFEAT',
  POST_MATCH: 'POST_MATCH',
  RETURNING_TO_LOBBY: 'RETURNING_TO_LOBBY'
});

/** Legal transitions. Anything not listed is refused. */
const TRANSITIONS = Object.freeze({
  LOBBY: ['QUEUEING'],
  QUEUEING: ['PRE_MATCH', 'LOBBY'],
  PRE_MATCH: ['DROP_PHASE', 'RETURNING_TO_LOBBY'],
  DROP_PHASE: ['ACTIVE_MATCH', 'RETURNING_TO_LOBBY'],
  ACTIVE_MATCH: ['ENDGAME', 'VICTORY', 'DEFEAT', 'RETURNING_TO_LOBBY'],
  ENDGAME: ['VICTORY', 'DEFEAT', 'RETURNING_TO_LOBBY'],
  VICTORY: ['POST_MATCH'],
  DEFEAT: ['POST_MATCH'],
  POST_MATCH: ['RETURNING_TO_LOBBY'],
  RETURNING_TO_LOBBY: ['LOBBY']
});

/** Below this many survivors the match is in its endgame. */
const ENDGAME_THRESHOLD = 5;

export class MatchManager {
  /**
   * @param {object} opts
   * @param {import('../core/EventBus.js').EventBus} opts.bus
   * @param {import('./ParticipantRegistry.js').ParticipantRegistry} opts.registry
   */
  constructor({ bus, registry }) {
    this.bus = bus;
    this.registry = registry;

    this.state = MatchState.LOBBY;
    this.previousState = null;
    this.elapsed = 0;
    this.matchStartedAt = null;
    this.history = [MatchState.LOBBY];

    /** §12 — match statistics, reset per match. */
    this.stats = this._emptyStats();
    this.result = null;
  }

  _emptyStats() {
    return {
      eliminations: 0,
      damageDealt: 0,
      damageTaken: 0,
      shotsFired: 0,
      shotsHit: 0,
      survivalTime: 0,
      placement: null,
      materialsGathered: 0,
      healingUsed: 0
    };
  }

  get inMatch() {
    return [MatchState.DROP_PHASE, MatchState.ACTIVE_MATCH, MatchState.ENDGAME]
      .includes(this.state);
  }

  get isOver() {
    return [MatchState.VICTORY, MatchState.DEFEAT, MatchState.POST_MATCH].includes(this.state);
  }

  canTransition(to) {
    return (TRANSITIONS[this.state] ?? []).includes(to);
  }

  /**
   * Attempt a transition.
   * @param {string} to
   * @param {object} [detail]
   * @returns {boolean} whether it was applied
   */
  transition(to, detail = {}) {
    if (!Object.values(MatchState).includes(to)) return false;
    if (!this.canTransition(to)) return false;

    this.previousState = this.state;
    this.state = to;
    this.history.push(to);
    this.bus?.emit(Events.MATCH_STATE_CHANGED, { from: this.previousState, to, ...detail });
    return true;
  }

  /**
   * Force a state, bypassing the transition table. ADMIN_PANEL_SPEC §8.1 allows this only
   * as an explicit debug-only override, so it is deliberately named and separate from the
   * normal path rather than a flag on transition().
   */
  debugForceState(to, detail = {}) {
    if (!Object.values(MatchState).includes(to)) return false;
    this.previousState = this.state;
    this.state = to;
    this.history.push(to);
    this.bus?.emit(Events.MATCH_STATE_CHANGED, {
      from: this.previousState, to, forced: true, ...detail
    });
    return true;
  }

  /* ── the normal flow ───────────────────────────────────────────────────── */

  beginQueue() { return this.transition(MatchState.QUEUEING); }

  beginPreMatch() {
    if (!this.transition(MatchState.PRE_MATCH)) return false;
    this.stats = this._emptyStats();
    this.result = null;
    this.elapsed = 0;
    this.matchStartedAt = null;
    return true;
  }

  beginDrop() { return this.transition(MatchState.DROP_PHASE); }

  beginActiveMatch() {
    if (!this.transition(MatchState.ACTIVE_MATCH)) return false;
    this.matchStartedAt = this.elapsed;
    return true;
  }

  returnToLobby() {
    if (!this.transition(MatchState.RETURNING_TO_LOBBY)) return false;
    return this.transition(MatchState.LOBBY);
  }

  /* ── win condition — §11 ───────────────────────────────────────────────── */

  /**
   * Evaluate the win condition against the registry. Called each tick while in match.
   *
   * §11 — "Do not end the simulation incorrectly while multiple bots remain." The check is
   * strictly `aliveCount <= 1`, read from the one shared registry.
   *
   * @returns {string|null} the state entered, or null
   */
  evaluateWinCondition() {
    if (!this.inMatch) return null;

    const human = this.registry.human;
    const aliveCount = this.registry.aliveCount;

    // Endgame is presentation only — it must not end the match.
    if (this.state === MatchState.ACTIVE_MATCH && aliveCount <= ENDGAME_THRESHOLD && aliveCount > 1) {
      this.transition(MatchState.ENDGAME);
    }

    if (aliveCount > 1) {
      // The human dying while bots fight on is a DEFEAT even though the match continues.
      if (human && !human.alive && !this.isOver) return this._end(MatchState.DEFEAT, human);
      return null;
    }

    // One participant left: the match is decided.
    const winner = this.registry.winner;
    if (human && winner && winner.id === human.id) return this._end(MatchState.VICTORY, human);
    return this._end(MatchState.DEFEAT, human);
  }

  _end(state, human) {
    this.registry.finalise();

    if (human) {
      this.stats.placement = this.registry.placementOf(human.id);
      this.stats.eliminations = human.stats.eliminations;
      this.stats.damageDealt = human.stats.damageDealt;
      this.stats.damageTaken = human.stats.damageTaken;
      this.stats.shotsFired = human.stats.shotsFired;
      this.stats.shotsHit = human.stats.shotsHit;
      this.stats.materialsGathered = human.stats.materialsGathered;
      this.stats.healingUsed = human.stats.healingUsed;
      this.stats.survivalTime = human.eliminatedAt ?? this.elapsed;
    }

    if (!this.transition(state)) this.debugForceState(state);

    this.result = {
      outcome: state === MatchState.VICTORY ? 'victory' : 'defeat',
      ...this.stats,
      eliminatedBy: human?.eliminatedBy ?? null,
      totalParticipants: this.registry.total
    };
    this.bus?.emit(Events.MATCH_ENDED, { ...this.result });
    return state;
  }

  /** Admin: force an outcome through the real path (§8). */
  forceVictory() {
    if (!this.inMatch) return false;
    const human = this.registry.human;
    for (const p of [...this.registry.alive]) {
      if (!human || p.id !== human.id) this.registry.eliminate(p.id, { by: human?.id ?? null, at: this.elapsed });
    }
    return this.evaluateWinCondition() === MatchState.VICTORY;
  }

  forceDefeat() {
    if (!this.inMatch) return false;
    const human = this.registry.human;
    if (human) this.registry.eliminate(human.id, { at: this.elapsed });
    return this.evaluateWinCondition() === MatchState.DEFEAT;
  }

  /** §13 — full reset; nothing may leak between matches. */
  reset() {
    this.state = MatchState.LOBBY;
    this.previousState = null;
    this.elapsed = 0;
    this.matchStartedAt = null;
    this.history = [MatchState.LOBBY];
    this.stats = this._emptyStats();
    this.result = null;
  }

  update(dt) {
    if (this.inMatch) {
      this.elapsed += dt;
      this.stats.survivalTime = this.elapsed;
    }
  }

  snapshot() {
    return {
      state: this.state,
      elapsed: this.elapsed,
      inMatch: this.inMatch,
      isOver: this.isOver,
      stats: { ...this.stats },
      result: this.result ? { ...this.result } : null
    };
  }
}
