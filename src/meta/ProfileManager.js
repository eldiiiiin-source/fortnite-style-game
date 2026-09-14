/**
 * ProfileManager.js — ITEM_SHOP_SPEC §2, §8.3.
 *
 * Persistent profile above the match. `Game` never owns persistence (§8.2).
 *
 * Storage is guarded at every boundary: corrupt, missing or unavailable storage yields a
 * default profile rather than a crash (§2.1). Recovery is partial where it safely can be —
 * a profile with a valid balance but a broken cosmetic list keeps the balance.
 */
import { PROFILE, REWARDS } from './MetaConfig.js';
import { getCosmetic, STARTER_COSMETICS, DEFAULT_EQUIPPED, CATEGORY_ORDER } from './CosmeticCatalog.js';
import { Events } from '../core/EventBus.js';

/** A fresh profile — §2.2. */
export function createDefaultProfile() {
  return {
    version: PROFILE.schemaVersion,
    displayName: PROFILE.defaultDisplayName,
    currency: PROFILE.starterCurrency,
    owned: [...STARTER_COSMETICS],
    equipped: { ...DEFAULT_EQUIPPED },
    purchaseHistory: [],
    lifetimeStats: {
      matchesPlayed: 0,
      wins: 0,
      eliminations: 0,
      topFiveFinishes: 0,
      totalDamage: 0,
      totalSurvivalTime: 0
    },
    createdAt: Date.now()
  };
}

export class ProfileManager {
  constructor({ bus = null, storage = undefined } = {}) {
    this.bus = bus;
    this.storage = storage === undefined ? globalThis.localStorage : storage;
    this.profile = createDefaultProfile();
    this.loaded = false;
  }

  /* ── currency ──────────────────────────────────────────────────────────── */

  get currency() {
    return this.profile.currency;
  }

  /** §3 — integer only, never negative. */
  grantCurrency(amount) {
    const n = Math.floor(amount);
    if (!Number.isFinite(n) || n <= 0) return false;
    this.profile.currency += n;
    this.save();
    return true;
  }

  /** @returns {boolean} false if the balance would go negative — nothing is changed */
  spendCurrency(amount) {
    const n = Math.floor(amount);
    if (!Number.isFinite(n) || n < 0) return false;
    if (this.profile.currency < n) return false;
    this.profile.currency -= n;
    this.save();
    return true;
  }

  setCurrency(amount) {
    const n = Math.max(0, Math.floor(amount));
    if (!Number.isFinite(n)) return false;
    this.profile.currency = n;
    this.save();
    return true;
  }

  /* ── ownership ─────────────────────────────────────────────────────────── */

  owns(cosmeticId) {
    return this.profile.owned.includes(cosmeticId);
  }

  /** Grant ownership. Unknown cosmetics are refused, so profiles cannot hold dead IDs. */
  grantCosmetic(cosmeticId) {
    if (!getCosmetic(cosmeticId)) return false;
    if (this.owns(cosmeticId)) return false;
    this.profile.owned.push(cosmeticId);
    this.save();
    return true;
  }

  revokeCosmetic(cosmeticId) {
    const i = this.profile.owned.indexOf(cosmeticId);
    if (i < 0) return false;
    this.profile.owned.splice(i, 1);
    // Un-equip anything no longer owned, falling back to the category default.
    for (const [slot, id] of Object.entries(this.profile.equipped)) {
      if (id === cosmeticId) this.profile.equipped[slot] = DEFAULT_EQUIPPED[slot] ?? null;
    }
    this.save();
    return true;
  }

  ownedCosmetics() {
    return this.profile.owned.map((id) => getCosmetic(id)).filter(Boolean);
  }

  ownedInCategory(category) {
    return this.ownedCosmetics().filter((c) => c.category === category);
  }

  /* ── equipping — §6.2 ──────────────────────────────────────────────────── */

  /** @returns {boolean} false if not owned, unknown, or the wrong category for the slot */
  equip(cosmeticId) {
    const cosmetic = getCosmetic(cosmeticId);
    if (!cosmetic) return false;
    if (!this.owns(cosmeticId)) return false;     // §6 — unowned can never be equipped
    if (!CATEGORY_ORDER.includes(cosmetic.category)) return false;

    this.profile.equipped[cosmetic.category] = cosmeticId;
    this.save();
    this.bus?.emit(Events.COSMETIC_EQUIPPED, { slot: cosmetic.category, cosmeticId });
    return true;
  }

  equippedId(category) {
    return this.profile.equipped[category] ?? null;
  }

  /** The full equipped set, resolved to catalog entries — what match setup reads (§8.2). */
  equippedLoadout() {
    const out = {};
    for (const category of CATEGORY_ORDER) {
      out[category] = getCosmetic(this.profile.equipped[category]) ?? null;
    }
    return out;
  }

  resetEquipped() {
    this.profile.equipped = { ...DEFAULT_EQUIPPED };
    this.save();
    return true;
  }

  /* ── purchase history — §5.5 ───────────────────────────────────────────── */

  recordPurchase({ cosmeticId, price, rotationId = null }) {
    this.profile.purchaseHistory.push({
      cosmeticId, price, rotationId, timestamp: Date.now()
    });
    this.save();
  }

  /* ── lifetime stats — §10 ──────────────────────────────────────────────── */

  /**
   * Apply a finished match's result. Also pays rewards (§11) when enabled.
   * @returns {{credits:number}} credits awarded
   */
  applyMatchResult(result, { rewardsEnabled = REWARDS.enabled } = {}) {
    const stats = this.profile.lifetimeStats;
    stats.matchesPlayed++;
    stats.eliminations += result.eliminations ?? 0;
    stats.totalDamage += result.damageDealt ?? 0;
    stats.totalSurvivalTime += result.survivalTime ?? 0;
    if (result.outcome === 'victory') stats.wins++;
    if ((result.placement ?? Infinity) <= 5) stats.topFiveFinishes++;

    let credits = 0;
    if (rewardsEnabled) {
      credits += REWARDS.matchCompletion;
      credits += REWARDS.elimination * (result.eliminations ?? 0);
      if (result.outcome === 'victory') credits += REWARDS.victoryBonus;
      if (credits > 0) this.profile.currency += credits;
    }

    this.save();
    return { credits };
  }

  /* ── persistence — §2.1 ────────────────────────────────────────────────── */

  load() {
    this.loaded = true;
    let raw = null;
    try {
      raw = this.storage?.getItem(PROFILE.storageKey) ?? null;
    } catch {
      this.profile = createDefaultProfile();
      return false;
    }
    if (!raw) {
      this.profile = createDefaultProfile();
      return false;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.profile = createDefaultProfile();   // corrupt JSON: rebuild
      return false;
    }

    this.profile = this._recover(parsed);
    return true;
  }

  /**
   * Rebuild a profile from stored data, keeping whatever is safely recoverable and
   * replacing whatever is not (§2.1). Never throws.
   */
  _recover(stored) {
    const base = createDefaultProfile();
    if (!stored || typeof stored !== 'object') return base;

    const migrated = this._migrate(stored);

    if (typeof migrated.displayName === 'string' && migrated.displayName.length > 0) {
      base.displayName = migrated.displayName;
    }
    if (Number.isFinite(migrated.currency) && migrated.currency >= 0) {
      base.currency = Math.floor(migrated.currency);
    }
    if (Array.isArray(migrated.owned)) {
      // Keep only IDs the catalog still knows; a removed cosmetic must not poison a profile.
      const valid = migrated.owned.filter((id) => typeof id === 'string' && getCosmetic(id));
      base.owned = [...new Set([...STARTER_COSMETICS, ...valid])];
    }
    if (migrated.equipped && typeof migrated.equipped === 'object') {
      for (const category of CATEGORY_ORDER) {
        const id = migrated.equipped[category];
        // Only accept an equipped item that exists, is owned, and matches its slot.
        if (typeof id === 'string' && getCosmetic(id)?.category === category && base.owned.includes(id)) {
          base.equipped[category] = id;
        }
      }
    }
    if (Array.isArray(migrated.purchaseHistory)) {
      base.purchaseHistory = migrated.purchaseHistory.filter(
        (h) => h && typeof h.cosmeticId === 'string' && Number.isFinite(h.price)
      );
    }
    if (migrated.lifetimeStats && typeof migrated.lifetimeStats === 'object') {
      for (const key of Object.keys(base.lifetimeStats)) {
        const v = migrated.lifetimeStats[key];
        if (Number.isFinite(v) && v >= 0) base.lifetimeStats[key] = v;
      }
    }
    if (Number.isFinite(migrated.createdAt)) base.createdAt = migrated.createdAt;

    return base;
  }

  /**
   * §2.3 — migrate rather than break. Each step upgrades one version; unknown future
   * versions are treated as current and filtered by _recover.
   */
  _migrate(stored) {
    let data = { ...stored };
    let version = Number.isFinite(data.version) ? data.version : 0;

    // v0 -> v1: the pre-versioned shape had no equipped map or lifetime stats.
    if (version < 1) {
      data = {
        ...data,
        equipped: data.equipped ?? { ...DEFAULT_EQUIPPED },
        lifetimeStats: data.lifetimeStats ?? createDefaultProfile().lifetimeStats,
        purchaseHistory: data.purchaseHistory ?? []
      };
      version = 1;
    }

    data.version = PROFILE.schemaVersion;
    return data;
  }

  save() {
    try {
      this.storage?.setItem(PROFILE.storageKey, JSON.stringify(this.profile));
      return true;
    } catch {
      return false;   // storage full or unavailable: the game continues
    }
  }

  /** §12 — admin reset. Does not touch Settings. */
  resetProfile() {
    this.profile = createDefaultProfile();
    this.save();
    return true;
  }

  exportJSON() {
    return JSON.stringify(this.profile, null, 2);
  }

  /** @returns {boolean} whether the import was accepted */
  importJSON(json) {
    try {
      const parsed = JSON.parse(json);
      this.profile = this._recover(parsed);
      this.save();
      return true;
    } catch {
      return false;
    }
  }

  snapshot() {
    return {
      displayName: this.profile.displayName,
      currency: this.profile.currency,
      ownedCount: this.profile.owned.length,
      equipped: { ...this.profile.equipped },
      lifetimeStats: { ...this.profile.lifetimeStats }
    };
  }
}
