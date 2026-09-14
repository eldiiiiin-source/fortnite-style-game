/** Profile, currency, cosmetics, shop and locker. ITEM_SHOP_SPEC §14. */
import { describe, it, expect, beforeEach } from 'vitest';
import { ProfileManager, createDefaultProfile } from '../src/meta/ProfileManager.js';
import { ShopManager, PurchaseResult } from '../src/meta/ShopManager.js';
import {
  COSMETICS, getCosmetic, catalogCounts, cosmeticsByCategory,
  CosmeticCategory, STARTER_COSMETICS, DEFAULT_EQUIPPED, CATEGORY_ORDER
} from '../src/meta/CosmeticCatalog.js';
import { PROFILE, SHOP, PRICE_BANDS, REWARDS } from '../src/meta/MetaConfig.js';
import { MOVEMENT, PICKAXE, WEAPONS, TILE, WALL_H } from '../src/core/Config.js';
import { EventBus } from '../src/core/EventBus.js';

/** A fresh in-memory storage per test. */
function makeStorage() {
  const store = new Map();
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    _store: store
  };
}

let storage;
beforeEach(() => { storage = makeStorage(); });

const makeProfile = () => {
  const p = new ProfileManager({ storage });
  p.load();
  return p;
};

/* ═══ §9 catalog ══════════════════════════════════════════════════════════ */

describe('§9 cosmetic catalog', () => {
  it('meets the §9.2 count target', () => {
    const counts = catalogCounts();
    expect(counts.outfit).toBe(20);   // SKIN_SPEC §7 raised the roster
    expect(counts.pickaxe).toBe(7);   // SKIN_SPEC §11 added Scrapjaw
    expect(counts.glider).toBe(6);
    expect(counts.backAccessory).toBe(5);
    expect(counts.emote).toBe(8);
    expect(counts.wrap).toBe(6);
    expect(COSMETICS.length).toBeGreaterThanOrEqual(39);
  });

  it('covers every required category', () => {
    for (const category of CATEGORY_ORDER) {
      expect(cosmeticsByCategory(category).length).toBeGreaterThan(0);
    }
  });

  it('gives every cosmetic a stable unique ID', () => {
    const ids = COSMETICS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prices every cosmetic inside its rarity band', () => {
    for (const c of COSMETICS) {
      const [low, high] = PRICE_BANDS[c.rarity];
      expect(c.price, c.id).toBeGreaterThanOrEqual(low);
      expect(c.price, c.id).toBeLessThanOrEqual(high);
    }
  });

  it('carries no gameplay fields at all — §4.4 by construction', () => {
    const forbidden = ['damage', 'health', 'shield', 'speed', 'hitbox', 'range', 'fireRate'];
    for (const c of COSMETICS) {
      for (const field of forbidden) expect(c[field], `${c.id}.${field}`).toBeUndefined();
    }
  });

  it('provides at least the §9.1 starter minimum', () => {
    const byCategory = {};
    for (const id of STARTER_COSMETICS) {
      const c = getCosmetic(id);
      byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
    }
    expect(byCategory.outfit).toBeGreaterThanOrEqual(2);
    expect(byCategory.pickaxe).toBeGreaterThanOrEqual(2);
    expect(byCategory.glider).toBeGreaterThanOrEqual(2);
    expect(byCategory.backAccessory).toBeGreaterThanOrEqual(1);
    expect(byCategory.emote).toBeGreaterThanOrEqual(2);
    expect(byCategory.wrap).toBeGreaterThanOrEqual(2);
  });

  it('has a default equipped item per category, all owned at start', () => {
    for (const category of CATEGORY_ORDER) {
      const id = DEFAULT_EQUIPPED[category];
      expect(id, category).toBeDefined();
      expect(STARTER_COSMETICS).toContain(id);
    }
  });
});

/* ═══ §2 profile ══════════════════════════════════════════════════════════ */

describe('§2 profile', () => {
  it('creates a profile on first launch with starter currency and cosmetics', () => {
    const p = makeProfile();
    expect(p.currency).toBe(PROFILE.starterCurrency);
    expect(p.profile.owned.length).toBe(STARTER_COSMETICS.length);
    expect(p.profile.version).toBe(PROFILE.schemaVersion);
  });

  it('equips defaults on first launch', () => {
    const p = makeProfile();
    for (const category of CATEGORY_ORDER) {
      expect(p.equippedId(category)).toBe(DEFAULT_EQUIPPED[category]);
    }
  });

  it('persists across a reload', () => {
    const a = makeProfile();
    a.grantCurrency(1234);
    a.grantCosmetic('outfit_nightvane');
    a.equip('outfit_nightvane');

    const b = makeProfile();
    expect(b.currency).toBe(PROFILE.starterCurrency + 1234);
    expect(b.owns('outfit_nightvane')).toBe(true);
    expect(b.equippedId('outfit')).toBe('outfit_nightvane');
  });

  it('falls back safely on malformed data', () => {
    storage.setItem(PROFILE.storageKey, '{not json at all');
    const p = makeProfile();
    expect(p.currency).toBe(PROFILE.starterCurrency);
    expect(p.profile.owned.length).toBeGreaterThan(0);
  });

  it('recovers what it safely can from a partially broken profile', () => {
    storage.setItem(PROFILE.storageKey, JSON.stringify({
      version: 1, currency: 777, owned: ['outfit_nightvane', 'NOT_A_REAL_ID', 42],
      equipped: { outfit: 'NOT_REAL' }
    }));
    const p = makeProfile();
    expect(p.currency).toBe(777);                       // kept
    expect(p.owns('outfit_nightvane')).toBe(true);      // kept
    expect(p.owns('NOT_A_REAL_ID')).toBe(false);        // dropped
    expect(p.equippedId('outfit')).toBe(DEFAULT_EQUIPPED.outfit);  // reset
  });

  it('does not crash when storage is unavailable', () => {
    const broken = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    };
    const p = new ProfileManager({ storage: broken });
    expect(() => p.load()).not.toThrow();
    expect(p.currency).toBe(PROFILE.starterCurrency);
    expect(p.save()).toBe(false);
  });

  it('migrates a pre-versioned profile rather than breaking it', () => {
    storage.setItem(PROFILE.storageKey, JSON.stringify({
      currency: 2500, owned: ['outfit_drifter']      // no version, no equipped
    }));
    const p = makeProfile();
    expect(p.currency).toBe(2500);
    expect(p.owns('outfit_drifter')).toBe(true);
    expect(p.profile.version).toBe(PROFILE.schemaVersion);
    expect(p.equippedId('outfit')).toBe(DEFAULT_EQUIPPED.outfit);
  });

  it('never allows a negative balance', () => {
    const p = makeProfile();
    expect(p.spendCurrency(p.currency + 1)).toBe(false);
    expect(p.currency).toBe(PROFILE.starterCurrency);
    expect(p.spendCurrency(-500)).toBe(false);
    p.setCurrency(-9999);
    expect(p.currency).toBe(0);
  });

  it('grants only whole positive amounts', () => {
    const p = makeProfile();
    const before = p.currency;
    expect(p.grantCurrency(0)).toBe(false);
    expect(p.grantCurrency(-5)).toBe(false);
    expect(p.currency).toBe(before);
  });

  it('refuses to grant an unknown cosmetic', () => {
    const p = makeProfile();
    expect(p.grantCosmetic('outfit_does_not_exist')).toBe(false);
  });

  it('un-equips a revoked cosmetic', () => {
    const p = makeProfile();
    p.grantCosmetic('outfit_nightvane');
    p.equip('outfit_nightvane');
    p.revokeCosmetic('outfit_nightvane');
    expect(p.equippedId('outfit')).toBe(DEFAULT_EQUIPPED.outfit);
  });

  it('exports and imports', () => {
    const a = makeProfile();
    a.grantCurrency(999);
    const json = a.exportJSON();

    const b = new ProfileManager({ storage: makeStorage() });
    b.load();
    expect(b.importJSON(json)).toBe(true);
    expect(b.currency).toBe(a.currency);
    expect(b.importJSON('garbage')).toBe(false);
  });

  it('resets to defaults', () => {
    const p = makeProfile();
    p.grantCurrency(5000);
    p.grantCosmetic('outfit_aurelian');
    p.resetProfile();
    expect(p.currency).toBe(PROFILE.starterCurrency);
    expect(p.owns('outfit_aurelian')).toBe(false);
    expect(p.profile.purchaseHistory).toEqual([]);
  });
});

/* ═══ §6 locker / equipping ═══════════════════════════════════════════════ */

describe('§6 locker', () => {
  it('equips an owned cosmetic', () => {
    const p = makeProfile();
    expect(p.equip('outfit_drifter')).toBe(true);
    expect(p.equippedId('outfit')).toBe('outfit_drifter');
  });

  it('refuses to equip an unowned cosmetic', () => {
    const p = makeProfile();
    const unowned = COSMETICS.find((c) => !p.owns(c.id));
    expect(p.equip(unowned.id)).toBe(false);
    expect(p.equippedId(unowned.category)).not.toBe(unowned.id);
  });

  it('refuses an unknown cosmetic', () => {
    expect(makeProfile().equip('nope')).toBe(false);
  });

  it('routes each cosmetic to its own slot', () => {
    const p = makeProfile();
    p.equip('wrap_dust');
    expect(p.equippedId('wrap')).toBe('wrap_dust');
    expect(p.equippedId('outfit')).toBe(DEFAULT_EQUIPPED.outfit);
  });

  it('only lists owned cosmetics', () => {
    const p = makeProfile();
    const owned = p.ownedCosmetics();
    expect(owned.length).toBe(STARTER_COSMETICS.length);
    for (const c of owned) expect(p.owns(c.id)).toBe(true);
  });

  it('resolves the equipped loadout for match setup', () => {
    const loadout = makeProfile().equippedLoadout();
    for (const category of CATEGORY_ORDER) {
      expect(loadout[category], category).not.toBeNull();
      expect(loadout[category].category).toBe(category);
    }
  });
});

/* ═══ §4.4 no pay-to-win — the hard invariant ═════════════════════════════ */

describe('§4.4 cosmetics never affect gameplay', () => {
  it('leaves every gameplay constant untouched after equipping everything', () => {
    const before = JSON.stringify({
      movement: MOVEMENT, pickaxe: PICKAXE, weapons: WEAPONS, tile: TILE, wall: WALL_H
    });

    const p = makeProfile();
    for (const c of COSMETICS) {
      p.grantCosmetic(c.id);
      p.equip(c.id);
    }

    const after = JSON.stringify({
      movement: MOVEMENT, pickaxe: PICKAXE, weapons: WEAPONS, tile: TILE, wall: WALL_H
    });
    expect(after).toBe(before);
  });

  it('cannot mutate a frozen gameplay group even if something tried', () => {
    // The config groups are frozen, so a cosmetic has no path to change them at all.
    expect(Object.isFrozen(MOVEMENT)).toBe(true);
    expect(Object.isFrozen(PICKAXE)).toBe(true);
    expect(Object.isFrozen(WEAPONS)).toBe(true);
  });

  it('keeps the collision profile identical across outfits', () => {
    const p = makeProfile();
    const radii = [];
    for (const outfit of cosmeticsByCategory(CosmeticCategory.OUTFIT)) {
      p.grantCosmetic(outfit.id);
      p.equip(outfit.id);
      radii.push(MOVEMENT.capsuleRadius, MOVEMENT.standHeight, MOVEMENT.crouchHeight);
    }
    expect(new Set(radii).size).toBe(3);   // exactly the three distinct values, unchanged
  });

  it('keeps pickaxe stats identical across pickaxe cosmetics', () => {
    const p = makeProfile();
    const snapshot = JSON.stringify(PICKAXE);
    for (const pick of cosmeticsByCategory(CosmeticCategory.PICKAXE)) {
      p.grantCosmetic(pick.id);
      p.equip(pick.id);
      expect(JSON.stringify(PICKAXE)).toBe(snapshot);
    }
  });
});

/* ═══ §5 shop ═════════════════════════════════════════════════════════════ */

describe('§5 shop', () => {
  const makeShop = (profile) => new ShopManager({ profile, bus: new EventBus() });

  it('shows the configured featured and daily counts', () => {
    const view = makeShop(makeProfile()).shopView(0);
    expect(view.featured).toHaveLength(SHOP.featuredCount);
    expect(view.daily).toHaveLength(SHOP.dailyCount);
  });

  it('is deterministic for the same rotation', () => {
    const p = makeProfile();
    const a = makeShop(p).shopView(0);
    const b = makeShop(p).shopView(0);
    expect(a.featured.map((i) => i.id)).toEqual(b.featured.map((i) => i.id));
    expect(a.daily.map((i) => i.id)).toEqual(b.daily.map((i) => i.id));
  });

  it('is stable across the whole rotation period', () => {
    const shop = makeShop(makeProfile());
    const start = shop.shopView(0);
    const nearEnd = shop.shopView(SHOP.rotationPeriodMs - 1000);
    expect(start.rotationId).toBe(nearEnd.rotationId);
    expect(start.featured.map((i) => i.id)).toEqual(nearEnd.featured.map((i) => i.id));
  });

  it('changes when the period rolls over', () => {
    const shop = makeShop(makeProfile());
    const a = shop.shopView(0);
    const b = shop.shopView(SHOP.rotationPeriodMs + 1000);
    expect(b.rotationId).not.toBe(a.rotationId);
  });

  it('never duplicates an item within one rotation', () => {
    const shop = makeShop(makeProfile());
    for (let r = 0; r < 30; r++) {
      const rotation = shop.buildRotation(r);
      const ids = [...rotation.featured, ...rotation.daily].map((i) => i.id);
      expect(new Set(ids).size, `rotation ${r}`).toBe(ids.length);
    }
  });

  it('mixes categories rather than showing only outfits', () => {
    const shop = makeShop(makeProfile());
    for (let r = 0; r < 10; r++) {
      const rotation = shop.buildRotation(r);
      const categories = new Set([...rotation.featured, ...rotation.daily].map((i) => i.category));
      expect(categories.size, `rotation ${r}`).toBeGreaterThan(2);
    }
  });

  it('avoids excessive repetition between adjacent rotations', () => {
    const shop = makeShop(makeProfile());
    const a = new Set([...shop.buildRotation(5).featured, ...shop.buildRotation(5).daily].map((i) => i.id));
    const b = [...shop.buildRotation(6).featured, ...shop.buildRotation(6).daily].map((i) => i.id);
    const overlap = b.filter((id) => a.has(id)).length;
    expect(overlap).toBeLessThan(b.length / 2);
  });

  it('marks owned items as owned', () => {
    const p = makeProfile();
    const shop = makeShop(p);
    const view = shop.shopView(0);
    const target = view.featured[0];
    p.grantCosmetic(target.id);
    expect(shop.shopView(0).featured.find((i) => i.id === target.id).owned).toBe(true);
  });
});

/* ═══ §5.3 purchases ══════════════════════════════════════════════════════ */

describe('§5.3 purchase flow', () => {
  let profile, shop, target;
  beforeEach(() => {
    profile = makeProfile();
    shop = new ShopManager({ profile, bus: new EventBus() });
    target = shop.shopView(0).featured.find((i) => !i.owned);
  });

  it('succeeds and subtracts the price exactly once', () => {
    const before = profile.currency;
    const result = shop.purchase(target.id, { timestamp: 0 });
    expect(result.ok).toBe(true);
    expect(profile.currency).toBe(before - target.price);
    expect(profile.owns(target.id)).toBe(true);
  });

  it('persists ownership across a reload', () => {
    shop.purchase(target.id, { timestamp: 0 });
    const reloaded = makeProfile();
    expect(reloaded.owns(target.id)).toBe(true);
  });

  it('rejects a duplicate purchase and does not charge twice', () => {
    shop.purchase(target.id, { timestamp: 0 });
    const balance = profile.currency;
    const second = shop.purchase(target.id, { timestamp: 0 });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe(PurchaseResult.ALREADY_OWNED);
    expect(profile.currency).toBe(balance);
  });

  it('rejects on insufficient funds, changing nothing', () => {
    profile.setCurrency(target.price - 1);
    const result = shop.purchase(target.id, { timestamp: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe(PurchaseResult.INSUFFICIENT_FUNDS);
    expect(profile.currency).toBe(target.price - 1);
    expect(profile.owns(target.id)).toBe(false);
  });

  it('rejects an unknown item', () => {
    expect(shop.purchase('not_real', { timestamp: 0 }).reason).toBe(PurchaseResult.UNKNOWN_ITEM);
  });

  it('records purchase history with price and rotation', () => {
    shop.purchase(target.id, { timestamp: 0 });
    const entry = profile.profile.purchaseHistory.at(-1);
    expect(entry.cosmeticId).toBe(target.id);
    expect(entry.price).toBe(target.price);
    expect(entry.rotationId).toBe(0);
    expect(entry.timestamp).toBeGreaterThan(0);
  });

  it('emits a purchase event', () => {
    const bus = new EventBus();
    const s = new ShopManager({ profile, bus });
    const seen = [];
    bus.on('shop:purchaseCompleted', (e) => seen.push(e));
    const t = s.shopView(0).featured.find((i) => !i.owned);
    s.purchase(t.id, { timestamp: 0 });
    expect(seen).toHaveLength(1);
    expect(seen[0].cosmeticId).toBe(t.id);
  });

  it('can be equipped immediately after purchase', () => {
    shop.purchase(target.id, { timestamp: 0 });
    expect(profile.equip(target.id)).toBe(true);
  });
});

/* ═══ §10, §11 lifetime stats and rewards ═════════════════════════════════ */

describe('§10 lifetime stats and §11 rewards', () => {
  it('accumulates lifetime stats across matches', () => {
    const p = makeProfile();
    p.applyMatchResult({ outcome: 'defeat', placement: 12, eliminations: 2, damageDealt: 300, survivalTime: 400 });
    p.applyMatchResult({ outcome: 'victory', placement: 1, eliminations: 5, damageDealt: 900, survivalTime: 900 });
    const s = p.profile.lifetimeStats;
    expect(s.matchesPlayed).toBe(2);
    expect(s.wins).toBe(1);
    expect(s.eliminations).toBe(7);
    expect(s.totalDamage).toBe(1200);
    expect(s.topFiveFinishes).toBe(1);
  });

  it('pays the configured rewards', () => {
    const p = makeProfile();
    const before = p.currency;
    const { credits } = p.applyMatchResult({ outcome: 'victory', placement: 1, eliminations: 3, damageDealt: 0, survivalTime: 0 });
    expect(credits).toBe(REWARDS.matchCompletion + REWARDS.elimination * 3 + REWARDS.victoryBonus);
    expect(p.currency).toBe(before + credits);
  });

  it('pays nothing when rewards are disabled', () => {
    const p = makeProfile();
    const before = p.currency;
    const { credits } = p.applyMatchResult(
      { outcome: 'victory', placement: 1, eliminations: 3 }, { rewardsEnabled: false }
    );
    expect(credits).toBe(0);
    expect(p.currency).toBe(before);
  });

  it('persists lifetime stats', () => {
    const a = makeProfile();
    a.applyMatchResult({ outcome: 'victory', placement: 1, eliminations: 4, damageDealt: 100, survivalTime: 100 });
    expect(makeProfile().profile.lifetimeStats.wins).toBe(1);
  });
});

describe('default profile shape', () => {
  it('matches the spec fields', () => {
    const p = createDefaultProfile();
    for (const field of ['version', 'displayName', 'currency', 'owned', 'equipped',
      'purchaseHistory', 'lifetimeStats']) {
      expect(p[field], field).toBeDefined();
    }
  });
});
