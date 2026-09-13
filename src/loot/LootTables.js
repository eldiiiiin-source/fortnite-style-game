/**
 * LootTables.js — loot rolling. MASTER_SPEC §8, MAP_SPEC §6.2, §6.3.
 *
 * Every roll draws from the match's `loot` RNG stream so a match replays identically.
 */
import {
  LOOT_RARITY_WEIGHTS, LOOT_CLASS_WEIGHTS, LOOT_SPAWN_CHANCE, WEAPONS, CONSUMABLES
} from '../core/Config.js';
import { Weapon } from '../combat/Weapon.js';

const CONSUMABLE_WEIGHTS = Object.freeze({
  bandage: 34, smallShield: 30, medkit: 18, shieldPotion: 18
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
export function rollWeaponClass(rng, tier = 'outside') {
  return rng.weighted(LOOT_CLASS_WEIGHTS[tier] ?? LOOT_CLASS_WEIGHTS.outside);
}

export function rollWeapon(rng, { source = 'floor', tier = 'outside', excludeClasses = [] } = {}) {
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
export function rollFloorLoot(rng, { tier = 'outside' } = {}) {
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
export function rollChest(rng, { tier = 'major', guaranteeWeapon = false } = {}) {
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
