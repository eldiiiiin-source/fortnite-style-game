/** Loot rolling and RNG determinism. MASTER_SPEC §8, §11.1, MAP_SPEC §6.2, §6.3. */
import { describe, it, expect } from 'vitest';
import { MatchRandom, RandomStream } from '../src/core/Random.js';
import {
  rollRarity, rollWeaponClass, rollWeapon, rollChest, rollFloorLoot,
  rollAmmoBox, rollSpawnPoints, ammoFor
} from '../src/loot/LootTables.js';
import { LOOT_RARITY_WEIGHTS, LOOT_CLASS_WEIGHTS, WEAPONS, RARITY_ORDER } from '../src/core/Config.js';

describe('§11.1 determinism', () => {
  it('replays identically for the same seed', () => {
    const a = new MatchRandom(2468);
    const b = new MatchRandom(2468);
    for (let i = 0; i < 1000; i++) expect(a.loot.next()).toBe(b.loot.next());
  });

  it('gives each named stream an independent sequence', () => {
    const m = new MatchRandom(1);
    const loot = Array.from({ length: 20 }, () => m.loot.next());
    const storm = Array.from({ length: 20 }, () => m.storm.next());
    expect(loot).not.toEqual(storm);
  });

  it('exposes exactly the four streams the spec names', () => {
    expect(MatchRandom.streamNames).toEqual(['loot', 'storm', 'spread', 'cosmetic']);
  });

  it('does not let one stream advance another', () => {
    const m = new MatchRandom(77);
    const firstStorm = m.storm.next();
    const m2 = new MatchRandom(77);
    for (let i = 0; i < 500; i++) m2.loot.next();
    expect(m2.storm.next()).toBe(firstStorm);
  });

  it('produces values in [0, 1)', () => {
    const r = new RandomStream(123);
    for (let i = 0; i < 5000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('distributes uniformly enough for loot weighting', () => {
    const r = new RandomStream(9);
    const buckets = new Array(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.next() * 10)]++;
    for (const b of buckets) {
      expect(Math.abs(b - n / 10) / (n / 10)).toBeLessThan(0.05);
    }
  });

  it('rolls integers inclusively at both ends', () => {
    const r = new RandomStream(3);
    const seen = new Set();
    for (let i = 0; i < 2000; i++) seen.add(r.int(1, 4));
    expect([...seen].sort()).toEqual([1, 2, 3, 4]);
  });
});

describe('§8.2 rarity weights', () => {
  it('sums both source tables to 100', () => {
    for (const source of ['floor', 'chest']) {
      const total = Object.values(LOOT_RARITY_WEIGHTS[source]).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(100, 6);
    }
  });

  it('rolls floor loot close to the spec distribution', () => {
    const rng = new RandomStream(555);
    const counts = {};
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const r = rollRarity(rng, 'floor');
      counts[r] = (counts[r] ?? 0) + 1;
    }
    for (const [rarity, weight] of Object.entries(LOOT_RARITY_WEIGHTS.floor)) {
      expect((counts[rarity] / n) * 100).toBeCloseTo(weight, 0);
    }
  });

  it('makes chests better than floor loot', () => {
    const score = (w) => RARITY_ORDER.reduce((s, r, i) => s + w[r] * i, 0);
    expect(score(LOOT_RARITY_WEIGHTS.chest)).toBeGreaterThan(score(LOOT_RARITY_WEIGHTS.floor));
  });
});

describe('MAP_SPEC §6.3 class weights', () => {
  it('sums every tier to 100', () => {
    for (const tier of Object.keys(LOOT_CLASS_WEIGHTS)) {
      const total = Object.values(LOOT_CLASS_WEIGHTS[tier]).reduce((a, b) => a + b, 0);
      expect(total).toBeCloseTo(100, 6);
    }
  });

  it('covers every weapon in every tier', () => {
    for (const tier of Object.keys(LOOT_CLASS_WEIGHTS)) {
      expect(Object.keys(LOOT_CLASS_WEIGHTS[tier]).sort()).toEqual(Object.keys(WEAPONS).sort());
    }
  });

  it('makes rockets rarest outside POIs', () => {
    expect(LOOT_CLASS_WEIGHTS.outside.rocketLauncher)
      .toBeLessThan(LOOT_CLASS_WEIGHTS.major.rocketLauncher);
  });

  it('only rolls known weapon ids', () => {
    const rng = new RandomStream(31);
    for (let i = 0; i < 1000; i++) {
      expect(WEAPONS[rollWeaponClass(rng, 'major')]).toBeDefined();
    }
  });
});

describe('§8.1 / §8.3 loot sources', () => {
  it('gives a chest 5 entries: 2 items, their ammo, and a consumable', () => {
    const rng = new RandomStream(17);
    for (let i = 0; i < 200; i++) {
      const items = rollChest(rng, { tier: 'major' });
      expect(items.length).toBeGreaterThanOrEqual(3);
      expect(items.length).toBeLessThanOrEqual(5);
    }
  });

  it('never puts two weapons of the same class in one chest (§8.3)', () => {
    const rng = new RandomStream(404);
    for (let i = 0; i < 3000; i++) {
      const weapons = rollChest(rng, { tier: 'major' }).filter((x) => x.kind === 'weapon');
      const ids = weapons.map((w) => w.weaponId);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('guarantees a weapon in the first chest (§8.3)', () => {
    const rng = new RandomStream(808);
    for (let i = 0; i < 500; i++) {
      const items = rollChest(rng, { tier: 'minor', guaranteeWeapon: true });
      expect(items.some((x) => x.kind === 'weapon')).toBe(true);
    }
  });

  it('always pairs a weapon with its own ammo type (§8.3)', () => {
    const rng = new RandomStream(2929);
    for (let i = 0; i < 1000; i++) {
      const items = rollChest(rng, { tier: 'major' });
      const weapons = items.filter((x) => x.kind === 'weapon');
      const ammo = items.filter((x) => x.kind === 'ammo').map((a) => a.type);
      for (const w of weapons) {
        expect(ammo).toContain(WEAPONS[w.weaponId].ammo);
      }
    }
  });

  it('gives floor loot one weapon or one consumable', () => {
    const rng = new RandomStream(61);
    for (let i = 0; i < 500; i++) {
      const items = rollFloorLoot(rng, { tier: 'outside' });
      const weapons = items.filter((x) => x.kind === 'weapon').length;
      const consumables = items.filter((x) => x.kind === 'consumable').length;
      expect(weapons + consumables).toBe(1);
    }
  });

  it('builds a usable Weapon instance from a roll', () => {
    const rng = new RandomStream(13);
    const { weapon, weaponId, rarity } = rollWeapon(rng, { source: 'chest', tier: 'major' });
    expect(weapon.id).toBe(weaponId);
    expect(weapon.rarity).toBe(rarity);
    expect(weapon.ammoInMag).toBe(WEAPONS[weaponId].magazine);
  });

  it('gives an ammo box two stacks', () => {
    expect(rollAmmoBox(new RandomStream(4))).toHaveLength(2);
  });

  it('maps a weapon to its ammo type', () => {
    expect(ammoFor('boltSniper').type).toBe('heavy');
    expect(ammoFor('smg').type).toBe('light');
  });
});

describe('MAP_SPEC §6.2 spawn-point rolls', () => {
  it('spawns chests about 60% of the time', () => {
    const rng = new RandomStream(70);
    const points = Array.from({ length: 20000 }, () => ({ kind: 'chest' }));
    const spawned = rollSpawnPoints(rng, points);
    expect(spawned.length / points.length).toBeCloseTo(0.60, 1);
  });

  it('spawns floor loot about 75% of the time', () => {
    const rng = new RandomStream(71);
    const points = Array.from({ length: 20000 }, () => ({ kind: 'floor' }));
    expect(rollSpawnPoints(rng, points).length / points.length).toBeCloseTo(0.75, 1);
  });

  it('never spawns an unknown spawn kind', () => {
    const rng = new RandomStream(72);
    expect(rollSpawnPoints(rng, [{ kind: 'nonsense' }])).toHaveLength(0);
  });
});
