/**
 * LootTables.js — loot rolling. MASTER_SPEC §8, MAP_SPEC §6.2, §6.3.
 *
 * Every roll draws from the match's `loot` RNG stream so a match replays identically.
 */
import { WEAPONS, CONSUMABLES } from '../core/Config.js';
import { Weapon } from '../combat/Weapon.js';

/** §16.4 — small shield, large shield, medkit. */
const CONSUMABLE_WEIGHTS = Object.freeze({
  smallShield: 40, largeShield: 30, medkit: 30
});

/** §16.3 rarity weights. Chests are better than floor loot. */
export const LOOT_RARITY_WEIGHTS = Object.freeze({
  floor: { common: 45, uncommon: 32, rare: 16, epic: 5.5, legendary: 1.5 },
  chest: { common: 18, uncommon: 34, rare: 30, epic: 14, legendary: 4 }
});

/** Weapon class weights. POIs are richer than countryside (MAP_SPEC §14). */
export const LOOT_CLASS_WEIGHTS = Object.freeze({
  poi:        { assaultRifle: 24, smg: 20, pumpShotgun: 13, tacticalShotgun: 13, pistol: 12, boltSniper: 11, rocketLauncher: 7 },
  landmark:   { assaultRifle: 26, smg: 22, pumpShotgun: 12, tacticalShotgun: 12, pistol: 18, boltSniper: 8, rocketLauncher: 2 },
  countryside:{ assaultRifle: 26, smg: 22, pumpShotgun: 12, tacticalShotgun: 12, pistol: 19, boltSniper: 8, rocketLauncher: 1 }
});

export const LOOT_SPAWN_CHANCE = Object.freeze({
  chest: 0.60, floor: 0.75, ammoBox: 0.55, countrysideProp: 0.35
});

/** Ammo handed out alongside a weapon — always the matching type (§8.3). */
const AMMO_PER_WEAPON = Object.freeze({
  light: 36, medium: 30, heavy: 8, shells: 12, rockets: 2
});

/** Roll a rarity from a source's weights (§8.2). */
export function rollRarity(rng, source = 'floor') {
  return rng.weighted(LOOT_RARITY_WEIGHTS[source] ?? LOOT_RARITY_WEIGHTS.floor);
}

/** Roll a weapon class for a POI tier (MAP_SPEC §6.3). */
export function rollWeaponClass(rng, tier = 'countryside') {
  return rng.weighted(LOOT_CLASS_WEIGHTS[tier] ?? LOOT_CLASS_WEIGHTS.countryside);
}

export function rollWeapon(rng, { source = 'floor', tier = 'countryside', excludeClasses = [] } = {}) {
  let weaponId;
  let guard = 0;
  do {
    weaponId = rollWeaponClass(rng, tier);
    guard++;
  } while (excludeClasses.includes(weaponId) && guard < 32);

  const rarity = rollRarity(rng, source);
  return { kind: 'weapon', weaponId, rarity, weapon: new Weapon(weaponId, rarity) };
}

export function rollConsumable(rng) {
  const id = rng.weighted(CONSUMABLE_WEIGHTS);
  return { kind: 'consumable', id, count: 1, def: CONSUMABLES[id] };
}

export function ammoFor(weaponId) {
  const type = WEAPONS[weaponId].ammo;
  return { kind: 'ammo', type, count: AMMO_PER_WEAPON[type] };
}

/**
 * Floor loot: one weapon or one consumable, plus matching ammo (§8.1).
 */
export function rollFloorLoot(rng, { tier = 'countryside' } = {}) {
  const items = [];
  if (rng.chance(0.72)) {
    const w = rollWeapon(rng, { source: 'floor', tier });
    items.push(w, ammoFor(w.weaponId));
  } else {
    items.push(rollConsumable(rng));
  }
  return items;
}

/**
 * Chest: 2 items + 2 ammo stacks + 1 consumable (§8.1).
 * Never rolls two weapons of the same class (§8.3).
 *
 * @param {boolean} guaranteeWeapon  §8.3 — the player's first chest of the match
 */
export function rollChest(rng, { tier = 'poi', guaranteeWeapon = false } = {}) {
  const items = [];
  const usedClasses = [];

  const wantWeapon = (i) => (guaranteeWeapon && i === 0) || rng.chance(0.78);

  for (let i = 0; i < 2; i++) {
    if (wantWeapon(i)) {
      const w = rollWeapon(rng, { source: 'chest', tier, excludeClasses: usedClasses });
      usedClasses.push(w.weaponId);
      items.push(w, ammoFor(w.weaponId));
    } else {
      items.push(rollConsumable(rng));
    }
  }

  items.push(rollConsumable(rng));
  return items;
}

export function rollAmmoBox(rng) {
  const types = ['light', 'medium', 'heavy', 'shells'];
  return [
    { kind: 'ammo', type: rng.pick(types), count: 30 },
    { kind: 'ammo', type: rng.pick(types), count: 30 }
  ];
}

/**
 * Decide which authored spawn points actually spawn this match (MAP_SPEC §6.2).
 * @param {Array<{kind:string}>} spawnPoints
 */
export function rollSpawnPoints(rng, spawnPoints) {
  return spawnPoints.filter((sp) => rng.chance(LOOT_SPAWN_CHANCE[sp.kind] ?? 0));
}
