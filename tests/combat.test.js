/**
 * Damage, spread, health. MASTER_SPEC §3.1, §5.
 * The TTK expectations mirror references/gameplay/01-ttk-table.md — if a weapon value
 * changes, this test and that table must move together.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDamage, computeStructureDamage, applyDamageToVitals, fallDamage,
  shotsToKill, computeSpread, decayBloom, falloffMultiplier, hitMultiplier, pelletPattern
} from '../src/combat/DamageModel.js';
import { Weapon, Inventory } from '../src/combat/Weapon.js';
import { Health } from '../src/combat/Health.js';
import { EventBus } from '../src/core/EventBus.js';
import { RandomStream } from '../src/core/Random.js';
import { WEAPONS, VITALS, INVENTORY, SPREAD, MOVEMENT } from '../src/core/Config.js';

describe('§5.1 hit regions', () => {
  it('doubles head damage for bullets and 1.5x for shotguns', () => {
    expect(hitMultiplier('head', WEAPONS.assaultRifle)).toBe(2.0);
    expect(hitMultiplier('head', WEAPONS.pumpShotgun)).toBe(1.5);
    expect(hitMultiplier('legs', WEAPONS.assaultRifle)).toBe(1.0);
  });
});

describe('§3.1 shield-then-health', () => {
  it('absorbs into shield first', () => {
    const r = applyDamageToVitals(100, 100, 30);
    expect(r.shield).toBe(70);
    expect(r.health).toBe(100);
  });

  it('carries overflow into health in the same hit', () => {
    const r = applyDamageToVitals(100, 20, 50);
    expect(r.shieldAbsorbed).toBe(20);
    expect(r.shield).toBe(0);
    expect(r.health).toBe(70);
    expect(r.died).toBe(false);
  });

  it('reports death at zero health', () => {
    expect(applyDamageToVitals(30, 0, 30).died).toBe(true);
  });
});

describe('§3.1 fall damage', () => {
  it('is free below 3.5 m', () => {
    expect(fallDamage(3.4)).toBe(0);
    expect(fallDamage(0)).toBe(0);
  });

  it('is 10 HP per metre past the free distance', () => {
    expect(fallDamage(13.5)).toBe(100);
    expect(fallDamage(5.5)).toBe(20);
  });

  it('caps at 100', () => {
    expect(fallDamage(500)).toBe(VITALS.fallDamageCap);
  });

  it('ignores shield', () => {
    const h = new Health();
    h.shield = 100;
    h.takeFallDamage(13.5);
    expect(h.shield).toBe(100);
    expect(h.health).toBe(0);
  });
});

describe('§5.5 falloff', () => {
  it('is full damage inside 35 m', () => {
    expect(falloffMultiplier(WEAPONS.assaultRifle, 0)).toBe(1);
    expect(falloffMultiplier(WEAPONS.assaultRifle, 35)).toBe(1);
  });

  it('interpolates linearly between stops', () => {
    // Halfway from 35 m to 60 m: halfway from 1.00 to 0.80.
    expect(falloffMultiplier(WEAPONS.assaultRifle, 47.5)).toBeCloseTo(0.9, 5);
  });

  it('floors at 0.65 past 90 m', () => {
    expect(falloffMultiplier(WEAPONS.assaultRifle, 500)).toBeCloseTo(0.65, 5);
  });

  it('exempts the sniper from falloff entirely', () => {
    expect(falloffMultiplier(WEAPONS.boltSniper, 300)).toBe(1);
  });
});

describe('§5.3 / TTK table — body shots', () => {
  const cases = [
    ['assaultRifle', 100, 4], ['assaultRifle', 150, 5], ['assaultRifle', 200, 7],
    ['smg', 100, 6], ['smg', 150, 9], ['smg', 200, 12],
    ['pumpShotgun', 100, 2], ['pumpShotgun', 200, 3],
    ['tacticalShotgun', 100, 2], ['tacticalShotgun', 150, 3], ['tacticalShotgun', 200, 4],
    ['boltSniper', 100, 1], ['boltSniper', 200, 2],
    ['pistol', 100, 5], ['pistol', 150, 7], ['pistol', 200, 9]
  ];

  it.each(cases)('%s needs %i shots against a %i pool', (weaponId, pool, expected) => {
    const { shots } = shotsToKill({
      weaponId, health: 100, shield: pool - 100, region: 'torso', distance: 0
    });
    expect(shots).toBe(expected);
  });
});

describe('§5.3 / TTK table — headshots', () => {
  it('lets the sniper one-shot a full-shield player to the head', () => {
    const { shots, damagePerShot } = shotsToKill({
      weaponId: 'boltSniper', region: 'head', health: 100, shield: 100
    });
    expect(damagePerShot).toBe(210);
    expect(shots).toBe(1);
  });

  it('needs four AR headshots through full shield', () => {
    expect(shotsToKill({ weaponId: 'assaultRifle', region: 'head', health: 100, shield: 100 }).shots).toBe(4);
  });

  it('does not let a pump one-shot a full-shield body', () => {
    const dmg = computeDamage({ weaponId: 'pumpShotgun', region: 'torso', distance: 0 });
    expect(dmg).toBe(90);
    expect(dmg).toBeLessThan(VITALS.maxHealth + VITALS.maxShield);
  });
});

describe('§5.2 rarity scaling', () => {
  it('raises damage but never fire rate', () => {
    const common = computeDamage({ weaponId: 'assaultRifle', rarity: 'common' });
    const legendary = computeDamage({ weaponId: 'assaultRifle', rarity: 'legendary' });
    expect(legendary).toBeCloseTo(common * 1.22, 5);
    expect(new Weapon('assaultRifle', 'common').fireInterval)
      .toBe(new Weapon('assaultRifle', 'legendary').fireInterval);
  });
});

describe('§6.7 structure damage', () => {
  it('is flat, ignoring region and distance', () => {
    expect(computeStructureDamage({ weaponId: 'assaultRifle' })).toBe(30);
    expect(computeStructureDamage({ weaponId: 'rocketLauncher' })).toBe(400);
  });

  it('does not multiply shotgun structure damage by pellet count (§5.6)', () => {
    expect(computeStructureDamage({ weaponId: 'pumpShotgun' })).toBe(100);
  });
});

describe('§5.5 spread', () => {
  it('is tighter aiming than from the hip', () => {
    const hip = computeSpread({ weaponId: 'assaultRifle', ads: false });
    const ads = computeSpread({ weaponId: 'assaultRifle', ads: true });
    expect(ads).toBeLessThan(hip);
    expect(ads).toBe(WEAPONS.assaultRifle.adsSpread);
  });

  it('blooms per shot up to the 8-shot cap', () => {
    const at8 = computeSpread({ weaponId: 'assaultRifle', ads: true, shotsInBurst: 8 });
    const at20 = computeSpread({ weaponId: 'assaultRifle', ads: true, shotsInBurst: 20 });
    expect(at8).toBe(at20);
    expect(at8).toBeCloseTo(WEAPONS.assaultRifle.adsSpread + 0.45 * SPREAD.bloomCap, 5);
  });

  it('doubles the movement penalty while airborne', () => {
    const ground = computeSpread({ weaponId: 'assaultRifle', horizontalSpeed: MOVEMENT.walkSpeed });
    const air = computeSpread({ weaponId: 'assaultRifle', horizontalSpeed: MOVEMENT.walkSpeed, airborne: true });
    expect(air - WEAPONS.assaultRifle.hipSpread)
      .toBeCloseTo((ground - WEAPONS.assaultRifle.hipSpread) * 2, 5);
  });

  it('applies the crouch bonus to the final spread', () => {
    const standing = computeSpread({ weaponId: 'assaultRifle' });
    const crouched = computeSpread({ weaponId: 'assaultRifle', crouched: true });
    expect(crouched).toBeCloseTo(standing * SPREAD.crouchMultiplier, 5);
  });

  it('holds bloom for 0.25 s before decaying', () => {
    expect(decayBloom(8, 0.1, 'assaultRifle', 1 / 30)).toBe(8);
    expect(decayBloom(8, 0.3, 'assaultRifle', 1 / 30)).toBeLessThan(8);
  });

  it('uses the pellet cone for shotguns, not bloom', () => {
    expect(computeSpread({ weaponId: 'pumpShotgun', shotsInBurst: 5 }))
      .toBe(WEAPONS.pumpShotgun.coneHalfAngle);
  });
});

describe('§5.6 pellet pattern', () => {
  it('fires the full pellet count inside the cone', () => {
    const rng = new RandomStream(42);
    const pattern = pelletPattern('pumpShotgun', false, rng);
    expect(pattern).toHaveLength(10);
    const coneRad = WEAPONS.pumpShotgun.coneHalfAngle * Math.PI / 180;
    for (const p of pattern) {
      expect(Math.hypot(p.yaw, p.pitch)).toBeLessThanOrEqual(coneRad + 1e-9);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = pelletPattern('pumpShotgun', false, new RandomStream(7));
    const b = pelletPattern('pumpShotgun', false, new RandomStream(7));
    expect(a).toEqual(b);
  });

  it('tightens when aiming', () => {
    const hip = pelletPattern('pumpShotgun', false, null);
    const ads = pelletPattern('pumpShotgun', true, null);
    const spreadOf = (p) => Math.max(...p.map((q) => Math.hypot(q.yaw, q.pitch)));
    expect(spreadOf(ads)).toBeLessThan(spreadOf(hip));
  });
});

describe('§5.3 weapon instance', () => {
  it('empties its magazine and refuses to fire', () => {
    const w = new Weapon('pumpShotgun');
    for (let i = 0; i < WEAPONS.pumpShotgun.magazine; i++) {
      w.cooldown = 0;
      expect(w.fire()).toBe(true);
    }
    w.cooldown = 0;
    expect(w.isEmpty).toBe(true);
    expect(w.fire()).toBe(false);
  });

  it('honours the fire interval', () => {
    const w = new Weapon('assaultRifle');
    expect(w.fire()).toBe(true);
    expect(w.canFire).toBe(false);
    w.update(w.fireInterval, { reserveAmmo: 100 });
    expect(w.canFire).toBe(true);
  });

  it('reloads from the reserve after the reload time', () => {
    const w = new Weapon('assaultRifle');
    w.ammoInMag = 5;
    expect(w.beginReload(100)).toBe(true);
    let consumed = 0;
    for (let t = 0; t < WEAPONS.assaultRifle.reloadTime * 30 + 1; t++) {
      consumed += w.update(1 / 30, { reserveAmmo: 100 });
    }
    expect(w.ammoInMag).toBe(WEAPONS.assaultRifle.magazine);
    expect(consumed).toBe(25);
  });

  it('reloads only what the reserve holds', () => {
    const w = new Weapon('assaultRifle');
    w.ammoInMag = 0;
    w.beginReload(7);
    for (let t = 0; t < WEAPONS.assaultRifle.reloadTime * 30 + 1; t++) w.update(1 / 30, { reserveAmmo: 7 });
    expect(w.ammoInMag).toBe(7);
  });
});

describe('§5.7 inventory', () => {
  it('reserves slot 0 for the tool and refuses to drop it', () => {
    const inv = new Inventory();
    expect(inv.slots[INVENTORY.toolSlot].kind).toBe('tool');
    expect(inv.drop(INVENTORY.toolSlot)).toBeNull();
    expect(inv.slots[INVENTORY.toolSlot]).not.toBeNull();
  });

  it('cancels a reload when switching slots', () => {
    const inv = new Inventory();
    const w = new Weapon('assaultRifle');
    w.ammoInMag = 1;
    inv.slots[1] = { kind: 'weapon', rarity: 'common', weapon: w };
    inv.select(1);
    inv.switchCooldown = 0;
    w.beginReload(100);
    expect(w.reloading).toBe(true);
    inv.select(2);
    expect(w.reloading).toBe(false);
  });

  it('blocks a switch until the 0.25 s cooldown passes', () => {
    const inv = new Inventory();
    expect(inv.select(1)).toBe(true);
    expect(inv.select(2)).toBe(false);
    inv.update(INVENTORY.switchTime);
    expect(inv.select(2)).toBe(true);
  });

  it('caps ammo at the stack size', () => {
    const inv = new Inventory();
    inv.addAmmo('shells', 500);
    expect(inv.ammo.shells).toBe(INVENTORY.stackSizes.shells);
  });
});

describe('§5.8 consumables', () => {
  it('heals with a bandage only up to 75', () => {
    const h = new Health();
    h.health = 70;
    h.beginConsumable('bandage');
    h.update(3.0);
    expect(h.health).toBe(75);
    expect(h.beginConsumable('bandage')).toBe(false); // already at the cap
  });

  it('takes a medkit to full health', () => {
    const h = new Health();
    h.health = 12;
    h.beginConsumable('medkit');
    h.update(8.0);
    expect(h.health).toBe(100);
  });

  it('caps small shields at 50', () => {
    const h = new Health();
    for (let i = 0; i < 3; i++) {
      h.beginConsumable('smallShield');
      h.update(2.0);
    }
    expect(h.shield).toBe(50);
  });

  it('cancels on damage without consuming the item', () => {
    const h = new Health();
    h.health = 50;
    h.beginConsumable('medkit');
    h.update(4.0);
    h.takeDamage(5);
    expect(h.consuming).toBeNull();
    expect(h.health).toBe(45); // healed nothing, took the 5
  });
});

describe('Health events', () => {
  it('emits damaged and died', () => {
    const bus = new EventBus();
    const seen = [];
    bus.on('player:damaged', () => seen.push('damaged'));
    bus.on('player:died', () => seen.push('died'));
    const h = new Health(bus, 1);
    h.takeDamage(40);
    h.takeDamage(80);
    expect(seen).toEqual(['damaged', 'damaged', 'died']);
    expect(h.alive).toBe(false);
  });

  it('ignores damage once dead', () => {
    const h = new Health();
    h.takeDamage(200);
    const r = h.takeDamage(50);
    expect(r.healthLost).toBe(0);
  });
});
