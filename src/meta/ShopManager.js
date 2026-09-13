/**
 * ShopManager.js — ITEM_SHOP_SPEC §5, §8.3.
 *
 * Deterministic rotation with no backend: the rotation is a pure function of the time
 * bucket and the catalog, so it is stable across reloads within the same 24-hour period
 * and reproducible in tests (§5.1).
 *
 * ShopManager validates purchases and exposes items. It never touches rendering (§8.3).
 */
import { SHOP } from './MetaConfig.js';
import { shopEligible, getCosmetic, CATEGORY_ORDER } from './CosmeticCatalog.js';
import { RandomStream, hashString } from '../core/Random.js';
import { Events } from '../core/EventBus.js';

export const PurchaseResult = Object.freeze({
  OK: 'ok',
  UNKNOWN_ITEM: 'unknownItem',
  NOT_PURCHASABLE: 'notPurchasable',
  ALREADY_OWNED: 'alreadyOwned',
  INSUFFICIENT_FUNDS: 'insufficientFunds',
  NOT_IN_SHOP: 'notInShop'
});

export class ShopManager {
  /**
   * @param {object} opts
   * @param {import('./ProfileManager.js').ProfileManager} opts.profile
   * @param {import('../core/EventBus.js').EventBus} [opts.bus]
   * @param {number} [opts.seedOffset] admin override for testing rotations
   */
  constructor({ profile, bus = null, seedOffset = 0 } = {}) {
    this.profile = profile;
    this.bus = bus;
    this.seedOffset = seedOffset;
    this._cache = new Map();   // rotationId -> rotation
  }

  /** The rotation bucket for a moment in time. */
  rotationIdFor(timestamp = Date.now()) {
    return Math.floor(timestamp / SHOP.rotationPeriodMs) + this.seedOffset;
  }

  /** When the current rotation ends. */
  rotationEndsAt(timestamp = Date.now()) {
    const bucket = Math.floor(timestamp / SHOP.rotationPeriodMs);
    return (bucket + 1) * SHOP.rotationPeriodMs;
  }

  /**
   * Build a rotation deterministically from its ID.
   *
   * §5.2 — no duplicate within a rotation, a spread of categories and rarities, and no
   * excessive repetition against the adjacent rotation.
   */
  buildRotation(rotationId) {
    if (this._cache.has(rotationId)) return this._cache.get(rotationId);

    const rng = new RandomStream((hashString(`rotation:${rotationId}`)) >>> 0);
    const pool = shopEligible();

    // What the previous rotation showed, so we can avoid repeating it (§5.2).
    const previous = new Set();
    if (SHOP.avoidRepeatWindow > 0 && !this._buildingPrevious) {
      this._buildingPrevious = true;
      try {
        const prior = this.buildRotation(rotationId - 1);
        for (const entry of [...prior.featured, ...prior.daily]) previous.add(entry.id);
      } catch {
        // First rotation ever, or recursion guard: nothing to avoid.
      } finally {
        this._buildingPrevious = false;
      }
    }

    const total = SHOP.featuredCount + SHOP.dailyCount;
    const chosen = this._select(pool, total, rng, previous);

    // Featured takes the higher-rarity half so the section reads as "featured".
    const rarityRank = { common: 0, uncommon: 1, rare: 2, epic: 3, legendary: 4 };
    const sorted = [...chosen].sort((a, b) => rarityRank[b.rarity] - rarityRank[a.rarity]);
    const featured = sorted.slice(0, SHOP.featuredCount);
    const daily = sorted.slice(SHOP.featuredCount);

    const rotation = Object.freeze({
      id: rotationId,
      featured: Object.freeze(featured),
      daily: Object.freeze(daily),
      periodHours: SHOP.rotationPeriodHours
    });
    this._cache.set(rotationId, rotation);
    return rotation;
  }

  /**
   * Pick `count` distinct cosmetics with category spread, preferring items not in
   * `avoid`. Falls back to avoided items rather than returning a short rotation.
   */
  _select(pool, count, rng, avoid) {
    const chosen = [];
    const taken = new Set();

    const byCategory = new Map(CATEGORY_ORDER.map((c) => [c, []]));
    for (const item of pool) byCategory.get(item.category)?.push(item);

    // Pass 1 — one from each category, so the shop is never all outfits (§5.1).
    const categories = rng.shuffle([...CATEGORY_ORDER]);
    for (const category of categories) {
      if (chosen.length >= count) break;
      const items = (byCategory.get(category) ?? []).filter(
        (i) => !taken.has(i.id) && !avoid.has(i.id)
      );
      if (items.length === 0) continue;
      const pick = items[Math.floor(rng.next() * items.length)];
      chosen.push(pick);
      taken.add(pick.id);
    }

    // Pass 2 — fill the rest, still preferring unseen items.
    const remaining = rng.shuffle(pool.filter((i) => !taken.has(i.id) && !avoid.has(i.id)));
    for (const item of remaining) {
      if (chosen.length >= count) break;
      chosen.push(item);
      taken.add(item.id);
    }

    // Pass 3 — only if the catalog is too small, allow repeats from the previous rotation.
    if (chosen.length < count) {
      const fallback = rng.shuffle(pool.filter((i) => !taken.has(i.id)));
      for (const item of fallback) {
        if (chosen.length >= count) break;
        chosen.push(item);
        taken.add(item.id);
      }
    }

    return chosen;
  }

  /** The rotation active right now. */
  currentRotation(timestamp = Date.now()) {
    return this.buildRotation(this.rotationIdFor(timestamp));
  }

  /** §12 — admin preview of what comes next. */
  nextRotation(timestamp = Date.now()) {
    return this.buildRotation(this.rotationIdFor(timestamp) + 1);
  }

  /** §12 — admin reroll, by shifting the seed offset. */
  forceNewRotation() {
    this.seedOffset += 1;
    return this.currentRotation();
  }

  setSeedOffset(offset) {
    this.seedOffset = offset;
    return this.currentRotation();
  }

  /** Items of the current rotation, annotated with owned/equipped/affordable state (§5.6). */
  shopView(timestamp = Date.now()) {
    const rotation = this.currentRotation(timestamp);
    const decorate = (item) => ({
      ...item,
      owned: this.profile.owns(item.id),
      equipped: this.profile.equippedId(item.category) === item.id,
      affordable: this.profile.currency >= item.price
    });
    return {
      rotationId: rotation.id,
      endsAt: this.rotationEndsAt(timestamp),
      featured: rotation.featured.map(decorate),
      daily: rotation.daily.map(decorate),
      currency: this.profile.currency
    };
  }

  /** Is this cosmetic in the current rotation? */
  isInRotation(cosmeticId, timestamp = Date.now()) {
    const r = this.currentRotation(timestamp);
    return [...r.featured, ...r.daily].some((i) => i.id === cosmeticId);
  }

  /**
   * Purchase — ITEM_SHOP_SPEC §5.3, in the spec's exact order.
   *
   * Atomic from the UI's perspective: currency is only debited once the grant is known to
   * succeed, so a failed grant can never leave the player poorer (§5.3).
   *
   * @returns {{ok:boolean, reason:string, item?:object, balance:number}}
   */
  purchase(cosmeticId, { timestamp = Date.now(), requireInRotation = true } = {}) {
    const fail = (reason) => ({ ok: false, reason, balance: this.profile.currency });

    // 4. item exists
    const item = getCosmetic(cosmeticId);
    if (!item) return fail(PurchaseResult.UNKNOWN_ITEM);

    // 5. purchasable
    if (!item.shopEligible || !item.enabled) return fail(PurchaseResult.NOT_PURCHASABLE);
    if (requireInRotation && !this.isInRotation(cosmeticId, timestamp)) {
      return fail(PurchaseResult.NOT_IN_SHOP);
    }

    // 6. not already owned
    if (this.profile.owns(cosmeticId)) return fail(PurchaseResult.ALREADY_OWNED);

    // 7. sufficient currency
    if (this.profile.currency < item.price) return fail(PurchaseResult.INSUFFICIENT_FUNDS);

    // 8 + 9 — grant FIRST, then debit. If the grant fails the balance is untouched.
    if (!this.profile.grantCosmetic(cosmeticId)) {
      return fail(PurchaseResult.NOT_PURCHASABLE);
    }
    if (!this.profile.spendCurrency(item.price)) {
      // Should be unreachable given the check above; undo rather than leave a free item.
      this.profile.revokeCosmetic(cosmeticId);
      return fail(PurchaseResult.INSUFFICIENT_FUNDS);
    }

    // 10 + 11 — history, persisted by ProfileManager.
    this.profile.recordPurchase({
      cosmeticId, price: item.price, rotationId: this.rotationIdFor(timestamp)
    });

    this.bus?.emit(Events.PURCHASE_COMPLETED, {
      cosmeticId, price: item.price, balance: this.profile.currency
    });

    return { ok: true, reason: PurchaseResult.OK, item, balance: this.profile.currency };
  }

  clearCache() {
    this._cache.clear();
  }
}
