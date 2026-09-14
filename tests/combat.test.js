/** Damage, weapons, inventory. MASTER_SPEC §12, §13, §15. */
import { describe, it, expect } from 'vitest';
import {
  singleHitDamage, resolvePelletHits, maxBlastDamage, computeStructureDamage,
  applyDamageToVitals, shotsToKill, computeSpread, decayBloom, falloffMultiplier,
  hitMultiplier, pelletPattern, recoilKick, recoilRecover
} from '../src/combat/DamageModel.js';
import { Weapon, Inventory } from '../src/combat/Weapon.js';
import { Health } from '../src/combat/Health.js';
import { EventBus } from '../src/core/EventBus.js';
import { RandomStream } from '../src/core/Random.js';
import { WEAPONS, VITALS, INVENTORY, SPREAD, SIM, CONSUMABLES } from '../src/core/Config.js';

const dt = SIM.fixedDt;

describe('§12.6 headshots use per-weapon multipliers', () => {
  it('reads the multiplier from the weapon, not a global table', () => {
    expect(hitMultiplier('head', WEAPONS.assaultRifle)).toBe(WEAPONS.assaultRifle.headshotMultiplier);
    expect(hitMultiplier('head', WEAPONS.boltSniper)).toBe(2.5);
    expect(hitMultiplier('head', WEAPONS.pumpShotgun)).toBe(1.5);
    expect(hitMultiplier('torso', WEAPONS.assaultRifle)).toBe(1);
  });
});

describe('§13 shield then health', () => {
  it('absorbs into shield first', () => {
    const r = applyDamageToVitals(100, 100, 30);
    expect(r.shield).toBe(70);
    expect(r.health).toBe(100);
  });

  it('carries overflow into health in the same hit', () => {
    const r = applyDamageToVitals(100, 20, 50);
    expect(r.shieldAbsorbed).toBe(20);
    expect(r.health).toBe(70);
  });

  it('reports death at zero health', () => {
    expect(applyDamageToVitals(30, 0, 30).died).toBe(true);
  });

  it('starts a player at 100/0 with a 100 shield cap', () => {
    const h = new Health();
    expect(h.health).toBe(VITALS.maxHealth);
    expect(h.shield).toBe(0);
  });
});

describe('§12.5 shotgun pellets resolve independently', () => {
  it('scores a mixed body/head blast correctly', () => {
    const pelletHits = [
      ...Array(6).fill({ region: 'torso', distance: 5 }),
      ...Array(2).fill({ region: 'head', distance: 5 }),
      null, null
    ];
    const r = resolvePelletHits({ weaponId: 'pumpShotgun', pelletHits });

    const body = singleHitDamage({ weaponId: 'pumpShotgun', region: 'torso', distance: 5 });
    const head = singleHitDamage({ weaponId: 'pumpShotgun', region: 'head', distance: 5 });
    expect(r.total).toBeCloseTo(body * 6 + head * 2, 6);
    expect(r.pelletsHit).toBe(8);
    expect(r.headshots).toBe(2);
  });

  it('is NOT the same as one lumped calculation when regions differ', () => {
    const mixed = resolvePelletHits({
      weaponId: 'pumpShotgun',
      pelletHits: [
        ...Array(5).fill({ region: 'head', distance: 2 }),
        ...Array(5).fill({ region: 'torso', distance: 2 })
      ]
    });
    const allBody = maxBlastDamage({ weaponId: 'pumpShotgun', region: 'torso', distance: 2 });
    const allHead = maxBlastDamage({ weaponId: 'pumpShotgun', region: 'head', distance: 2 });
    expect(mixed.total).toBeGreaterThan(allBody);
    expect(mixed.total).toBeLessThan(allHead);
  });

  it('counts each pellet at its own distance', () => {
    const near = resolvePelletHits({
      weaponId: 'pumpShotgun', pelletHits: [{ region: 'torso', distance: 2 }]
    });
    const far = resolvePelletHits({
      weaponId: 'pumpShotgun', pelletHits: [{ region: 'torso', distance: 25 }]
    });
    expect(far.total).toBeLessThan(near.total);
  });

  it('ignores missed pellets', () => {
    const r = resolvePelletHits({ weaponId: 'pumpShotgun', pelletHits: [null, null, null] });
    expect(r.total).toBe(0);
    expect(r.pelletsHit).toBe(0);
  });

  it('refuses pellet resolution for a non-pellet weapon', () => {
    expect(() => resolvePelletHits({ weaponId: 'assaultRifle', pelletHits: [] })).toThrow();
  });

  it('fires the full pellet count inside the cone, deterministically', () => {
    const a = pelletPattern('pumpShotgun', false, new RandomStream(7));
    const b = pelletPattern('pumpShotgun', false, new RandomStream(7));
    expect(a).toEqual(b);
    expect(a).toHaveLength(WEAPONS.pumpShotgun.pellets);
    const coneRad = WEAPONS.pumpShotgun.coneHalfAngle * Math.PI / 180;
    for (const p of a) expect(Math.hypot(p.yaw, p.pitch)).toBeLessThanOrEqual(coneRad + 1e-9);
  });

  it('tightens the cone when aiming', () => {
    const spreadOf = (p) => Math.max(...p.map((q) => Math.hypot(q.yaw, q.pitch)));
    expect(spreadOf(pelletPattern('pumpShotgun', true, null)))
      .toBeLessThan(spreadOf(pelletPattern('pumpShotgun', false, null)));
  });
});

describe('§12.4 falloff and spread', () => {
  it('is full damage inside 35 m and floors past 90 m', () => {
    expect(falloffMultiplier(WEAPONS.assaultRifle, 0)).toBe(1);
    expect(falloffMultiplier(WEAPONS.assaultRifle, 47.5)).toBeCloseTo(0.9, 5);
    expect(falloffMultiplier(WEAPONS.assaultRifle, 500)).toBeCloseTo(0.65, 5);
  });

  it('exempts the sniper', () => {
    expect(falloffMultiplier(WEAPONS.boltSniper, 300)).toBe(1);
  });

  it('is tighter aiming than hip', () => {
    expect(computeSpread({ weaponId: 'assaultRifle', ads: true }))
      .toBeLessThan(computeSpread({ weaponId: 'assaultRifle', ads: false }));
  });

  it('caps bloom', () => {
    const at8 = computeSpread({ weaponId: 'assaultRifle', ads: true, shotsInBurst: SPREAD.bloomCap });
    const at30 = computeSpread({ weaponId: 'assaultRifle', ads: true, shotsInBurst: 30 });
    expect(at8).toBe(at30);
  });

  it('penalises movement more in the air', () => {
    const g = computeSpread({ weaponId: 'assaultRifle', horizontalSpeed: 4.6 });
    const a = computeSpread({ weaponId: 'assaultRifle', horizontalSpeed: 4.6, airborne: true });
    expect(a).toBeGreaterThan(g);
  });

  it('decays bloom only after the delay', () => {
    expect(decayBloom(8, 0.1, 'assaultRifle', dt)).toBe(8);
    expect(decayBloom(8, 0.5, 'assaultRifle', dt)).toBeLessThan(8);
  });
});

describe('§12.3 recoil is separate from spread', () => {
  it('kicks the aim point upward', () => {
    const kick = recoilKick('assaultRifle', new RandomStream(1));
    expect(kick.pitch).toBeGreaterThan(0);
  });

  it('recovers toward zero and stops there', () => {
    let r = { pitch: 0.1, yaw: 0.05 };
    for (let i = 0; i < 600; i++) r = recoilRecover(r, 'assaultRifle', dt);
    expect(r.pitch).toBeCloseTo(0, 6);
    expect(r.yaw).toBeCloseTo(0, 6);
  });

  it('gives the sniper the heaviest kick', () => {
    const kicks = Object.keys(WEAPONS).map((id) => ({ id, v: WEAPONS[id].recoilVertical }));
    kicks.sort((a, b) => b.v - a.v);
    expect(kicks[0].id).toBe('boltSniper');
  });
});

describe('§9.5 structure damage', () => {
  it('is flat and ignores hit region', () => {
    expect(computeStructureDamage({ weaponId: 'assaultRifle' })).toBe(30);
    expect(computeStructureDamage({ weaponId: 'rocketLauncher' })).toBe(400);
  });

  it('does not multiply shotgun structure damage per pellet', () => {
    expect(computeStructureDamage({ weaponId: 'pumpShotgun' })).toBe(100);
  });
});

describe('§12 weapon instance', () => {
  it('gates firing on the per-weapon equip time', () => {
    const w = new Weapon('boltSniper');
    w.beginEquip();
    expect(w.canFire).toBe(false);
    for (let i = 0; i < WEAPONS.boltSniper.equipTime / dt + 2; i++) {
      w.update(dt, { reserveAmmo: 20 });
    }
    expect(w.canFire).toBe(true);
  });

  it('empties and refuses to fire', () => {
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

  it('reloads from the reserve', () => {
    const w = new Weapon('assaultRifle');
    w.ammoInMag = 5;
    expect(w.beginReload(100)).toBe(true);
    let consumed = 0;
    for (let i = 0; i < WEAPONS.assaultRifle.reloadTime / dt + 2; i++) {
      consumed += w.update(dt, { reserveAmmo: 100 });
    }
    expect(w.ammoInMag).toBe(WEAPONS.assaultRifle.magazine);
    expect(consumed).toBe(25);
  });

  it('will not reload while equipping', () => {
    const w = new Weapon('assaultRifle');
    w.ammoInMag = 0;
    w.beginEquip();
    expect(w.beginReload(100)).toBe(false);
  });
});

describe('§15 five-slot inventory with a separate pickaxe', () => {
  it('has exactly five combat slots', () => {
    expect(new Inventory().size).toBe(INVENTORY.combatSlots);
  });

  it('starts with the pickaxe out, not occupying a slot', () => {
    const inv = new Inventory();
    expect(inv.pickaxeEquipped).toBe(true);
    expect(inv.slots.every((s) => s === null)).toBe(true);
  });

  it('switches between pickaxe and slots', () => {
    const inv = new Inventory();
    inv.slots[0] = { kind: 'weapon', rarity: 'common', weapon: new Weapon('pistol') };
    expect(inv.select(0)).toBe(true);
    expect(inv.pickaxeEquipped).toBe(false);
    inv.switchCooldown = 0;
    expect(inv.equipPickaxe()).toBe(true);
    expect(inv.activeWeapon).toBeNull();
  });

  it('never deletes an item — a replaced item is returned to the caller', () => {
    const inv = new Inventory();
    for (let i = 0; i < INVENTORY.combatSlots; i++) {
      inv.slots[i] = { kind: 'weapon', rarity: 'common', weapon: new Weapon('pistol') };
    }
    const incoming = { kind: 'weapon', rarity: 'rare', weapon: new Weapon('smg') };
    const { replaced } = inv.add(incoming);
    expect(replaced).not.toBeNull();
    expect(inv.itemCount).toBe(INVENTORY.combatSlots);
  });

  it('reorders without losing items', () => {
    const inv = new Inventory();
    const a = { kind: 'weapon', rarity: 'common', weapon: new Weapon('pistol') };
    const b = { kind: 'weapon', rarity: 'rare', weapon: new Weapon('smg') };
    inv.slots[0] = a;
    inv.slots[3] = b;
    expect(inv.reorder(0, 3)).toBe(true);
    expect(inv.slots[0]).toBe(b);
    expect(inv.slots[3]).toBe(a);
    expect(inv.itemCount).toBe(2);
  });

  it('cycles with the wheel', () => {
    const inv = new Inventory();
    inv.slots[0] = { kind: 'weapon', rarity: 'common', weapon: new Weapon('pistol') };
    inv.slots[1] = { kind: 'weapon', rarity: 'common', weapon: new Weapon('smg') };
    inv.select(0);
    inv.switchCooldown = 0;
    expect(inv.cycle(1)).toBe(true);
    expect(inv.selected).toBe(1);
  });

  it('cancels a reload when switching', () => {
    const inv = new Inventory();
    const w = new Weapon('assaultRifle');
    w.ammoInMag = 1;
    inv.slots[0] = { kind: 'weapon', rarity: 'common', weapon: w };
    inv.select(0);
    inv.switchCooldown = 0;
    w.equipRemaining = 0;          // finish equipping; reload is refused mid-equip
    w.beginReload(100);
    expect(w.reloading).toBe(true);
    inv.select(1);
    expect(w.reloading).toBe(false);
  });

  it('caps ammo stacks', () => {
    const inv = new Inventory();
    inv.addAmmo('shells', 500);
    expect(inv.ammo.shells).toBe(INVENTORY.stackSizes.shells);
  });

  it('drops and returns an item', () => {
    const inv = new Inventory();
    const item = { kind: 'weapon', rarity: 'common', weapon: new Weapon('pistol') };
    inv.slots[2] = item;
    expect(inv.drop(2)).toBe(item);
    expect(inv.slots[2]).toBeNull();
  });
});

describe('§16.4 consumables', () => {
  it('caps small shields below large shields', () => {
    const h = new Health();
    for (let i = 0; i < 3; i++) {
      h.beginConsumable('smallShield');
      h.update(CONSUMABLES.smallShield.useTime);
    }
    expect(h.shield).toBe(CONSUMABLES.smallShield.shieldCap);
  });

  it('takes a large shield past the small cap', () => {
    const h = new Health();
    h.shield = 50;
    h.beginConsumable('largeShield');
    h.update(CONSUMABLES.largeShield.useTime);
    expect(h.shield).toBe(100);
  });

  it('takes a medkit to full health', () => {
    const h = new Health();
    h.health = 12;
    h.beginConsumable('medkit');
    h.update(CONSUMABLES.medkit.useTime);
    expect(h.health).toBe(100);
  });

  it('is interrupted by damage without consuming the item', () => {
    const h = new Health();
    h.health = 50;
    h.beginConsumable('medkit');
    h.update(4.0);
    h.takeDamage(5);
    expect(h.consuming).toBeNull();
    expect(h.health).toBe(45);
  });
});

describe('§13.2 elimination', () => {
  it('emits damaged then died', () => {
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
    expect(h.takeDamage(50).healthLost).toBe(0);
  });
});

describe('TTK reference', () => {
  it('needs 7 AR body shots through a full shield', () => {
    expect(shotsToKill({ weaponId: 'assaultRifle', health: 100, shield: 100 }).shots).toBe(7);
  });

  it('lets the sniper one-shot a full-shield headshot at 2.5x', () => {
    const r = shotsToKill({ weaponId: 'boltSniper', region: 'head', health: 100, shield: 100 });
    expect(r.damagePerShot).toBeCloseTo(262.5, 5);
    expect(r.shots).toBe(1);
  });
});
