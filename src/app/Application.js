/**
 * Application.js — the layer above Game. BATTLE_ROYALE_SPEC §14, ITEM_SHOP_SPEC §8.3.
 *
 * Owns persistent state (profile, shop, settings) and the scene stack. `Game` is created
 * and destroyed per match beneath it, which is what guarantees §13's "no state may leak
 * between matches": a new match gets a new Game.
 *
 * Headless by construction — it takes no renderer and no DOM, so the whole lobby → match →
 * results loop is testable in Node.
 */
import { EventBus, Events } from '../core/EventBus.js';
import { MatchManager, MatchState } from '../match/MatchManager.js';
import { ParticipantRegistry, ParticipantKind } from '../match/ParticipantRegistry.js';
import { ProfileManager } from '../meta/ProfileManager.js';
import { ShopManager } from '../meta/ShopManager.js';
import { SceneManager, SceneName, Scene } from './SceneManager.js';
import { Settings } from '../core/Settings.js';
import { Game } from '../Game.js';
import { MATCH, REWARDS, isDevMode } from '../meta/MetaConfig.js';
import { AdminService } from '../admin/AdminService.js';

export class Application {
  /**
   * @param {object} [opts]
   * @param {object} [opts.storage]   injected for tests
   * @param {number} [opts.seed]
   */
  constructor({ storage = undefined, seed = null, settings = null } = {}) {
    this.bus = new EventBus();
    this.settings = settings ?? new Settings();
    this.profile = new ProfileManager({ bus: this.bus, storage });
    this.profile.load();
    this.shop = new ShopManager({ profile: this.profile, bus: this.bus });

    this.registry = new ParticipantRegistry(this.bus);
    this.match = new MatchManager({ bus: this.bus, registry: this.registry });
    this.scenes = new SceneManager(this);

    this.game = null;
    this.seed = seed;
    this.rewardsEnabled = REWARDS.enabled;
    this.lastResult = null;
    this.botCount = MATCH.botCount;
    /** Guards against paying rewards twice for one match. */
    this._resultProcessed = false;

    this.devMode = isDevMode();
    /** ADMIN_PANEL_SPEC §1 — constructed always, but every method self-gates on DEV_MODE. */
    this.admin = new AdminService(this);
    this._registerDefaultScenes();
    this.scenes.goTo(SceneName.LOBBY);
  }

  /**
   * Logic-only scenes. The browser entry point replaces these with rendering versions;
   * having them here keeps the whole lobby -> match -> results loop testable headlessly.
   */
  _registerDefaultScenes() {
    for (const name of Object.values(SceneName)) {
      this.scenes.register(name, new Scene(name, this));
    }
  }

  /* ── lobby ─────────────────────────────────────────────────────────────── */

  /** Data the lobby screen renders — ITEM_SHOP_SPEC §8.1. */
  lobbyState() {
    return {
      displayName: this.profile.profile.displayName,
      currency: this.profile.currency,
      equipped: this.profile.equippedLoadout(),
      lifetimeStats: { ...this.profile.profile.lifetimeStats },
      mode: 'Battle Royale',
      devMode: this.devMode
    };
  }

  /* ── starting a match — BATTLE_ROYALE_SPEC §15 ────────────────────────── */

  /**
   * PLAY. Starts a REAL match: creates state, spawns bots, populates loot, prepares the
   * storm and begins the drop (§15).
   *
   * @returns {boolean} whether the match started
   */
  startMatch({ botCount = this.botCount } = {}) {
    if (this.match.state !== MatchState.LOBBY) return false;

    this.match.beginQueue();
    if (!this.match.beginPreMatch()) return false;

    // §13 — a fresh Game per match. Nothing can leak from the previous one.
    this.registry.clear();
    this._resultProcessed = false;
    this.lastResult = null;
    const seed = this.seed ?? (Date.now() & 0x7fffffff);
    this.game = new Game({
      seed,
      settings: this.settings,
      bus: this.bus,
      cosmetics: this.profile.equippedLoadout(),
      botCount,
      registry: this.registry,
      match: this.match
    });

    this.registry.register({ id: this.game.player.id, kind: ParticipantKind.HUMAN, ref: this.game });
    for (const bot of this.game.bots) {
      this.registry.register({ id: bot.id, kind: ParticipantKind.BOT, ref: bot });
    }

    // Share the admin flag object so toggles reach gameplay without Game importing admin.
    if (this.devMode) this.game.adminFlags = this.admin.flags;

    this.match.beginDrop();
    this.game.beginDropPhase();
    this.scenes.goTo(SceneName.MATCH);
    return true;
  }

  /** Abandon the current match and go back to the lobby. */
  returnToLobby() {
    if (this.match.inMatch || this.match.isOver) {
      if (!this.match.transition(MatchState.RETURNING_TO_LOBBY)) {
        this.match.debugForceState(MatchState.RETURNING_TO_LOBBY);
      }
      this.match.transition(MatchState.LOBBY);
    }
    this._teardownMatch();
    this.scenes.goTo(SceneName.LOBBY);
    return true;
  }

  /** §13 — full teardown so a second match starts clean. */
  _teardownMatch() {
    this.game = null;
    this.registry.clear();
    this.match.reset();
    this._resultProcessed = false;
  }

  /* ── match end — §11, ITEM_SHOP_SPEC §10, §11 ─────────────────────────── */

  _onMatchEnded(result) {
    this.lastResult = result;
    // Lifetime stats and rewards live on the profile, never on Game (§8.2).
    const reward = this.profile.applyMatchResult(result, { rewardsEnabled: this.rewardsEnabled });
    this.lastResult = { ...result, creditsEarned: reward.credits };
    this.match.transition(MatchState.POST_MATCH);
    this.scenes.goTo(SceneName.RESULTS, { result: this.lastResult });
  }

  /* ── loop ──────────────────────────────────────────────────────────────── */

  update(dt) {
    this.match.update(dt);

    if (this.game && this.match.inMatch) {
      this.game.update(dt);

      // §5 -> §8: once everyone is on the ground, the active match (and the storm) begins.
      if (this.match.state === MatchState.DROP_PHASE && this.game.dropComplete) {
        this.match.beginActiveMatch();
        this.game.beginActiveMatch();
      }

      this.match.evaluateWinCondition();
    }

    // A match can also end outside the normal flow - an admin force victory/defeat ends it
    // synchronously. Processing the result here rather than at the call site means every
    // ending pays rewards and reaches the results screen through exactly one path.
    if (this.match.result && !this._resultProcessed) {
      this._resultProcessed = true;
      this._onMatchEnded(this.match.result);
    }

    this.scenes.update(dt);
  }

  render(alpha) {
    this.scenes.render(alpha);
  }

  snapshot() {
    return {
      scene: this.scenes.currentName,
      match: this.match.snapshot(),
      participants: this.registry.snapshot(),
      profile: this.profile.snapshot(),
      devMode: this.devMode
    };
  }
}

export { MatchState, SceneName, Events };
