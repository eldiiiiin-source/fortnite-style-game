/**
 * AdminService.js — ADMIN_PANEL_SPEC §2.
 *
 * The single entry point for every developer action. The GUI and the command console both
 * call these methods — §16 forbids two logic paths — and the service delegates to the real
 * systems rather than mutating internals (§2).
 *
 * EVERY method is gated on DEV_MODE (§1). With it false, each returns a refusal and
 * changes nothing, so there is no reachable admin action in a production build.
 */
import { isDevMode, TEST_LOADOUTS, MATCH, ADMIN, BOT_DIFFICULTY } from '../meta/MetaConfig.js';
import { WEAPONS, CONSUMABLES, MATERIAL_CAP, MATERIAL_ORDER, RARITY_ORDER, TILE } from '../core/Config.js';
import { Weapon } from '../combat/Weapon.js';
import { COSMETICS, getCosmetic } from '../meta/CosmeticCatalog.js';
import { MatchState } from '../match/MatchManager.js';
import { BotState } from '../world/Bot.js';

const ok = (data = {}) => ({ ok: true, ...data });
const fail = (reason) => ({ ok: false, reason });
const DENIED = 'devModeDisabled';

export class AdminService {
  /** @param {import('../app/Application.js').Application} app */
  constructor(app) {
    this.app = app;

    /** §17 — temporary toggles, deliberately NOT persisted; they reset on reload. */
    this.flags = {
      godMode: false,
      infiniteAmmo: false,
      infiniteMaterials: false,
      noReload: false,
      botsFrozen: false,
      rewardsDisabled: false
    };
    this.debugVisuals = {
      collision: false, playerCapsule: false, buildGrid: false, buildCoordinates: false,
      buildCollision: false, editCollision: false, aimRay: false, weaponRay: false,
      interactionRay: false, botPerception: false, botTarget: false, botPath: false,
      stormZones: false, lootSpawns: false, chestSpawns: false, poiBounds: false
    };
    this.speedMultiplier = 1;

    /** §15 — bounded event log. */
    this.eventLog = [];
    this._attachEventLog();
  }

  get enabled() {
    return isDevMode();
  }

  get game() {
    return this.app.game;
  }

  /** Every public method runs through this, so the gate cannot be forgotten. */
  _guard(fn) {
    if (!this.enabled) return fail(DENIED);
    try {
      return fn();
    } catch (err) {
      return fail(err.message);
    }
  }

  /* ── event log — §15 ───────────────────────────────────────────────────── */

  _attachEventLog() {
    const record = (type) => (payload) => {
      if (!this.enabled) return;
      this.eventLog.push({ type, at: Date.now(), payload: this._summarise(payload) });
      if (this.eventLog.length > ADMIN.eventLogLimit) this.eventLog.shift();
    };
    const bus = this.app.bus;
    for (const type of [
      'player:damaged', 'player:died', 'piece:placed', 'piece:edited', 'piece:destroyed',
      'loot:pickedUp', 'chest:opened', 'storm:phaseChanged', 'match:stateChanged',
      'shop:purchaseCompleted', 'match:participantEliminated'
    ]) {
      bus.on(type, record(type));
    }
  }

  /**
   * Keep only small scalars so the log cannot retain large object graphs.
   *
   * Descends a bounded depth rather than one level: most events carry their detail one
   * object down (`piece:placed` emits `{ piece }`, and the piece's cell one deeper), so a
   * single-level filter logged an empty payload for exactly the events worth reading.
   * Only scalars are ever retained, at any depth, so nothing here holds a live reference.
   */
  _summarise(payload, depth = ADMIN.eventLogDepth) {
    if (!payload || typeof payload !== 'object') return payload;
    const out = {};
    for (const [k, v] of Object.entries(payload)) {
      if (v === null || ['number', 'string', 'boolean'].includes(typeof v)) {
        out[k] = v;
      } else if (depth > 0 && typeof v === 'object' && !Array.isArray(v)) {
        const nested = this._summarise(v, depth - 1);
        if (Object.keys(nested).length > 0) out[k] = nested;
      }
    }
    return out;
  }

  clearEventLog() {
    this.eventLog.length = 0;
  }

  /* ── player tools — §4 ─────────────────────────────────────────────────── */

  setHealth(value) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.health.health = Math.max(0, Math.min(100, value));
      return ok({ health: this.game.health.health });
    });
  }

  setShield(value) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.health.shield = Math.max(0, Math.min(100, value));
      return ok({ shield: this.game.health.shield });
    });
  }

  healFull() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.health.health = 100;
      this.game.health.shield = 100;
      return ok();
    });
  }

  damagePlayer(amount) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.participant.takeDamage(amount, { source: 'admin' });
      return ok({ health: this.game.health.health, shield: this.game.health.shield });
    });
  }

  eliminatePlayer() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.participant.takeDamage(9999, { source: 'admin' });
      return ok();
    });
  }

  /** §4.1 — blocks damage without touching health values. */
  toggleGodMode(force = null) {
    return this._guard(() => {
      this.flags.godMode = force ?? !this.flags.godMode;
      return ok({ godMode: this.flags.godMode });
    });
  }

  toggleInfiniteAmmo(force = null) {
    return this._guard(() => {
      this.flags.infiniteAmmo = force ?? !this.flags.infiniteAmmo;
      return ok({ infiniteAmmo: this.flags.infiniteAmmo });
    });
  }

  toggleNoReload(force = null) {
    return this._guard(() => {
      this.flags.noReload = force ?? !this.flags.noReload;
      return ok({ noReload: this.flags.noReload });
    });
  }

  toggleInfiniteMaterials(force = null) {
    return this._guard(() => {
      this.flags.infiniteMaterials = force ?? !this.flags.infiniteMaterials;
      return ok({ infiniteMaterials: this.flags.infiniteMaterials });
    });
  }

  setSpeedMultiplier(multiplier) {
    return this._guard(() => {
      this.speedMultiplier = Math.max(0.1, Math.min(5, multiplier));
      return ok({ speedMultiplier: this.speedMultiplier });
    });
  }

  teleport(x, z) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const y = this.game.terrain.heightAt(x, z);
      this.game.player.teleport(x, y + 0.1, z);
      return ok({ position: { x, y, z } });
    });
  }

  teleportToMapCentre() {
    return this.teleport(0, 0);
  }

  teleportToStormCentre() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const c = this.game.storm.centre;
      return this.teleport(c.x, c.z);
    });
  }

  teleportIntoStorm() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const storm = this.game.storm;
      const d = storm.radius + TILE * 4;
      return this.teleport(storm.centre.x + d, storm.centre.z);
    });
  }

  /* ── inventory tools — §5 ──────────────────────────────────────────────── */

  giveWeapon(weaponId, rarity = 'common') {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      if (!WEAPONS[weaponId]) return fail('unknownWeapon');
      if (!RARITY_ORDER.includes(rarity)) return fail('unknownRarity');

      // §5 — the real catalog, not an admin-only definition.
      const weapon = new Weapon(weaponId, rarity);
      const { replaced } = this.game.inventory.add({ kind: 'weapon', rarity, weapon });
      this.game.inventory.addAmmo(WEAPONS[weaponId].ammo, 999);
      return ok({ weaponId, rarity, replaced: replaced ? 'dropped' : null });
    });
  }

  giveAmmo(type = 'all', amount = 999) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const types = type === 'all' ? Object.keys(this.game.inventory.ammo) : [type];
      for (const t of types) this.game.inventory.addAmmo(t, amount);
      return ok({ types });
    });
  }

  giveConsumable(id) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      if (!CONSUMABLES[id]) return fail('unknownConsumable');
      this.game.inventory.add({ kind: 'consumable', id, count: 1 });
      return ok({ id });
    });
  }

  clearInventory() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      for (let i = 0; i < this.game.inventory.slots.length; i++) this.game.inventory.drop(i);
      return ok();
    });
  }

  setMaterials(amount) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      // Reject anything that is not a real number. Without this, a bad argument clamps to
      // NaN and writes NaN into the player's materials, which then shows in the HUD and
      // poisons every build cost from that point on.
      if (!Number.isFinite(amount)) return fail('invalidAmount');
      const n = Math.max(0, Math.min(MATERIAL_CAP, amount));
      for (const m of MATERIAL_ORDER) this.game.player.materials[m] = n;
      return ok({ materials: n });
    });
  }

  giveMaxMaterials() {
    return this.setMaterials(MATERIAL_CAP);
  }

  /** §5.1 — data-driven presets. */
  applyLoadout(name) {
    return this._guard(() => {
      const preset = TEST_LOADOUTS[name];
      if (!preset) return fail('unknownLoadout');
      if (!this.game) return fail('noMatch');

      this.clearInventory();
      for (const [weaponId, rarity] of preset.weapons) this.giveWeapon(weaponId, rarity);
      for (const id of preset.consumables) this.giveConsumable(id);
      if (preset.maxMaterials) this.giveMaxMaterials();
      this.giveAmmo('all');
      return ok({ loadout: preset.name });
    });
  }

  listLoadouts() {
    return Object.entries(TEST_LOADOUTS).map(([id, l]) => ({ id, name: l.name }));
  }

  /* ── building tools — §6 ───────────────────────────────────────────────── */

  clearAllBuilds() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const count = this.game.grid.pieceCount;
      this.game.grid.clear();
      return ok({ cleared: count });
    });
  }

  repairAllBuilds() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      let n = 0;
      for (const piece of this.game.grid) {
        piece.hp = piece.maxHp;
        n++;
      }
      return ok({ repaired: n });
    });
  }

  toggleBuildCost(force = null) {
    return this.toggleInfiniteMaterials(force === null ? null : !force);
  }

  /* ── bot tools — §7 ────────────────────────────────────────────────────── */

  spawnBots(count = 1) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const total = this.game.bots.length + count;
      if (total > MATCH.unsafeBotCount) {
        // §7 — warn rather than silently crash.
        return fail(`unsafeBotCount: ${total} exceeds ${MATCH.unsafeBotCount}`);
      }
      const spawned = this.game.spawnBots(count);
      for (const bot of spawned) {
        this.app.registry.register({ id: bot.id, kind: 'bot', ref: bot });
      }
      return ok({ spawned: spawned.length, total: this.game.bots.length });
    });
  }

  removeAllBots() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const n = this.game.bots.length;
      for (const bot of this.game.bots) this.app.registry.eliminate(bot.id, { at: this.game.time });
      this.game.bots.length = 0;
      return ok({ removed: n });
    });
  }

  eliminateAllBots({ keep = 0 } = {}) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const alive = this.game.bots.filter((b) => b.alive);
      const toKill = alive.slice(0, Math.max(0, alive.length - keep));
      for (const bot of toKill) bot.takeDamage(9999, { source: 'admin' });
      return ok({ eliminated: toKill.length, remaining: keep });
    });
  }

  freezeBots(force = null) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.flags.botsFrozen = force ?? !this.flags.botsFrozen;
      for (const bot of this.game.bots) {
        if (this.flags.botsFrozen) bot.freeze();
        else bot.resume();
      }
      return ok({ frozen: this.flags.botsFrozen });
    });
  }

  setBotDifficulty(name) {
    return this._guard(() => {
      if (!BOT_DIFFICULTY[name]) return fail('unknownDifficulty');
      if (!this.game) return fail('noMatch');
      for (const bot of this.game.bots) bot.setDifficulty(name);
      return ok({ difficulty: name });
    });
  }

  forceBotState(botId, state) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const bot = this.game.bots.find((b) => b.id === botId);
      if (!bot) return fail('unknownBot');
      // §7.2 — an invalid state is refused with a warning, not forced.
      if (!bot.forceState(state)) return fail(`invalidState: ${state}`);
      return ok({ botId, state });
    });
  }

  teleportBotsToPlayer() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const p = this.game.player.position;
      for (const bot of this.game.bots) {
        if (!bot.alive) continue;
        const a = Math.random() * Math.PI * 2;
        bot.controller.teleport(
          p.x + Math.cos(a) * TILE * 2,
          this.game.terrain.heightAt(p.x, p.z),
          p.z + Math.sin(a) * TILE * 2
        );
      }
      return ok({ moved: this.game.bots.filter((b) => b.alive).length });
    });
  }

  listBots() {
    if (!this.enabled || !this.game) return [];
    return this.game.bots.map((b) => b.snapshot());
  }

  /* ── match tools — §8 ──────────────────────────────────────────────────── */

  startMatch(botCount = MATCH.botCount) {
    return this._guard(() => (this.app.startMatch({ botCount })
      ? ok({ state: this.app.match.state })
      : fail('cannotStart')));
  }

  restartMatch(botCount = MATCH.botCount) {
    return this._guard(() => {
      this.app.returnToLobby();
      return this.app.startMatch({ botCount }) ? ok() : fail('cannotStart');
    });
  }

  returnToLobby() {
    return this._guard(() => (this.app.returnToLobby() ? ok() : fail('cannotReturn')));
  }

  /** §8 — goes through the real MatchManager, never a direct state poke. */
  forceVictory() {
    return this._guard(() => (this.app.match.forceVictory() ? ok() : fail('notInMatch')));
  }

  forceDefeat() {
    return this._guard(() => (this.app.match.forceDefeat() ? ok() : fail('notInMatch')));
  }

  /** Skip the drop and land everyone immediately. */
  skipDropPhase() {
    return this._guard(() => {
      if (!this.game || !this.game.inDropPhase) return fail('notInDrop');
      this.game.skipDrop();
      return ok();
    });
  }

  matchState() {
    return this.enabled ? this.app.match.snapshot() : null;
  }

  /* ── storm tools — §9 ──────────────────────────────────────────────────── */

  startStorm() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.storm.start();
      return ok(this.game.storm.snapshot());
    });
  }

  pauseStorm(force = null) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const paused = force ?? !this.game.storm.paused;
      if (paused) this.game.storm.pause();
      else this.game.storm.resume();
      return ok({ paused });
    });
  }

  advanceStormPhase() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.storm.advancePhase();
      return ok(this.game.storm.snapshot());
    });
  }

  jumpToFinalStormPhase() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.storm.jumpToFinalPhase();
      return ok(this.game.storm.snapshot());
    });
  }

  setStormDamageEnabled(enabled) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.storm.setDamageEnabled(enabled);
      return ok({ damageEnabled: this.game.storm.damageEnabled });
    });
  }

  setStormDamageMultiplier(multiplier) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      this.game.storm.setDamageMultiplier(multiplier);
      return ok({ multiplier: this.game.storm.damageMultiplier });
    });
  }

  stormState() {
    return this.enabled && this.game ? this.game.storm.snapshot() : null;
  }

  /* ── world / loot tools — §10 ──────────────────────────────────────────── */

  spawnChest() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const p = this.game.player.position;
      const container = this.game.worldLoot.addContainer(
        { x: p.x + TILE, y: this.game.terrain.heightAt(p.x + TILE, p.z), z: p.z }, 'chest'
      );
      return ok({ id: container.id });
    });
  }

  spawnAmmoBox() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const p = this.game.player.position;
      const container = this.game.worldLoot.addContainer(
        { x: p.x + TILE, y: this.game.terrain.heightAt(p.x + TILE, p.z), z: p.z }, 'ammoBox'
      );
      return ok({ id: container.id });
    });
  }

  spawnLoot({ tier = 'poi' } = {}) {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const p = this.game.player.position;
      const spawned = this.game.worldLoot.spawnFloorLoot(
        { x: p.x + TILE, y: this.game.terrain.heightAt(p.x + TILE, p.z), z: p.z }, { tier }
      );
      return ok({ spawned: spawned.length });
    });
  }

  clearWorldLoot() {
    return this._guard(() => {
      if (!this.game) return fail('noMatch');
      const n = this.game.worldLoot.count;
      this.game.worldLoot.clear();
      return ok({ cleared: n });
    });
  }

  /* ── profile tools — §11 ───────────────────────────────────────────────── */

  grantCredits(amount) {
    return this._guard(() => (this.app.profile.grantCurrency(amount)
      ? ok({ balance: this.app.profile.currency })
      : fail('invalidAmount')));
  }

  removeCredits(amount) {
    return this._guard(() => {
      const p = this.app.profile;
      p.setCurrency(Math.max(0, p.currency - Math.floor(amount)));
      return ok({ balance: p.currency });
    });
  }

  setCredits(amount) {
    return this._guard(() => (this.app.profile.setCurrency(amount)
      ? ok({ balance: this.app.profile.currency })
      : fail('invalidAmount')));
  }

  unlockCosmetic(id) {
    return this._guard(() => (this.app.profile.grantCosmetic(id)
      ? ok({ id })
      : fail('unknownOrOwned')));
  }

  unlockAllCosmetics() {
    return this._guard(() => {
      let n = 0;
      for (const c of COSMETICS) if (this.app.profile.grantCosmetic(c.id)) n++;
      return ok({ unlocked: n });
    });
  }

  revokeCosmetic(id) {
    return this._guard(() => (this.app.profile.revokeCosmetic(id) ? ok({ id }) : fail('notOwned')));
  }

  equipCosmetic(id) {
    return this._guard(() => (this.app.profile.equip(id) ? ok({ id }) : fail('notOwnedOrUnknown')));
  }

  resetEquipped() {
    return this._guard(() => ok(this.app.profile.resetEquipped()));
  }

  /** §11.1 — destructive, so the caller must confirm explicitly. */
  resetProfile({ confirm = false } = {}) {
    return this._guard(() => {
      if (!confirm) return fail('confirmationRequired');
      this.app.profile.resetProfile();
      return ok();
    });
  }

  exportProfile() {
    return this._guard(() => ok({ json: this.app.profile.exportJSON() }));
  }

  importProfile(json) {
    return this._guard(() => (this.app.profile.importJSON(json) ? ok() : fail('invalidJSON')));
  }

  /** §12.1 — preview must NOT grant ownership. */
  previewCosmetic(id) {
    return this._guard(() => {
      const cosmetic = getCosmetic(id);
      if (!cosmetic) return fail('unknownCosmetic');
      // Deliberately no grant, no equip: this returns data only.
      return ok({ preview: cosmetic, owned: this.app.profile.owns(id) });
    });
  }

  /* ── shop tools — §12 ──────────────────────────────────────────────────── */

  shopRotation() {
    return this.enabled ? this.app.shop.shopView() : null;
  }

  forceShopRotation() {
    return this._guard(() => ok({ rotation: this.app.shop.forceNewRotation().id }));
  }

  previewNextRotation() {
    return this._guard(() => ok({ rotation: this.app.shop.nextRotation() }));
  }

  setShopSeed(offset) {
    return this._guard(() => ok({ rotation: this.app.shop.setSeedOffset(offset).id }));
  }

  testPurchase(cosmeticId) {
    return this._guard(() => {
      // §12 — uses the REAL purchase path, not a shortcut.
      const result = this.app.shop.purchase(cosmeticId, { requireInRotation: false });
      return result.ok ? ok(result) : fail(result.reason);
    });
  }

  /** §12 — simulate insufficient funds without corrupting the balance. */
  simulateInsufficientFunds(cosmeticId) {
    return this._guard(() => {
      const before = this.app.profile.currency;
      this.app.profile.setCurrency(0);
      const result = this.app.shop.purchase(cosmeticId, { requireInRotation: false });
      this.app.profile.setCurrency(before);
      return ok({ purchaseFailed: !result.ok, reason: result.reason, balance: this.app.profile.currency });
    });
  }

  disableRewards(force = null) {
    return this._guard(() => {
      this.flags.rewardsDisabled = force ?? !this.flags.rewardsDisabled;
      this.app.rewardsEnabled = !this.flags.rewardsDisabled;
      return ok({ rewardsEnabled: this.app.rewardsEnabled });
    });
  }

  /* ── debug visualisation — §14 ─────────────────────────────────────────── */

  toggleDebugVisual(name, force = null) {
    return this._guard(() => {
      if (!(name in this.debugVisuals)) return fail('unknownVisual');
      this.debugVisuals[name] = force ?? !this.debugVisuals[name];
      return ok({ [name]: this.debugVisuals[name] });
    });
  }

  /** §14.1 — reads the SHARED aim ray, proving targeting comes from one source. */
  aimDebugInfo() {
    if (!this.enabled || !this.game) return null;
    const ray = this.game.aimRay;
    if (!ray) return null;
    const structure = this.game.collision.raycastPieces(ray, 200);
    const editTarget = this.game.collision.raycastPieces(ray, this.game.editor ? 8 : 8);
    return {
      cameraOrigin: { ...this.game.camera.position },
      crosshairDirection: { ...ray.direction },
      rayOrigin: { ...ray.origin },
      buildTargetCell: this.game.buildTarget?.cell ?? null,
      structureHit: structure ? { pieceId: structure.piece.id, distance: structure.distance } : null,
      editHit: editTarget ? { pieceId: editTarget.piece.id, distance: editTarget.distance } : null,
      /** The invariant: every consumer reads the same ray object. */
      sharedRay: ray === this.game.aimRay
    };
  }

  /* ── performance — §13 ─────────────────────────────────────────────────── */

  performanceInfo(governor = null) {
    if (!this.enabled) return null;
    const g = this.game;
    return {
      tier: governor?.tier ?? null,
      averageMs: governor?.averageMs ?? null,
      p95Ms: governor?.p95Ms ?? null,
      fps: governor?.averageFps ?? null,
      botCount: g?.bots.length ?? 0,
      nearbyBots: g ? g.bots.filter((b) => b.alive &&
        Math.hypot(b.position.x - g.player.position.x, b.position.z - g.player.position.z) < TILE * 20
      ).length : 0,
      buildCount: g?.grid.pieceCount ?? 0,
      worldLootCount: g?.worldLoot.count ?? 0,
      reducible: governor ? [...(governor.constructor.REDUCIBLE ?? [])] : null
    };
  }

  /** §13.1 — the panel may never disable a protected system. */
  attemptReduce(feature, governor) {
    return this._guard(() => {
      if (!governor?.constructor?.canReduce?.(feature)) {
        return fail(`protectedOrUnknown: ${feature}`);
      }
      return ok({ reduced: feature });
    });
  }

  /* ── summary ───────────────────────────────────────────────────────────── */

  snapshot() {
    return {
      enabled: this.enabled,
      flags: { ...this.flags },
      debugVisuals: { ...this.debugVisuals },
      speedMultiplier: this.speedMultiplier,
      eventLogSize: this.eventLog.length
    };
  }
}

export { MatchState, BotState };
