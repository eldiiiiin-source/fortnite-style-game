/**
 * DamageModel.js — damage resolution. MASTER_SPEC §5.1, §5.2, §5.5, §5.6.
 *
 * Pure functions. Everything here is testable in Node and asserted against the spec.
 */
import {
  WEAPONS, RARITIES, HIT_MULTIPLIERS, FALLOFF_CURVE, SPREAD, VITALS
} from '../core/Config.js';
import { sampleCurve, clamp, DEG2RAD } from '../core/MathUtils.js';

/** Hit-region multiplier. Shotguns use a reduced head multiplier (§5.1). */
export function hitMultiplier(region, weapon) {
  if (region === 'head') {
    return weapon?.mode === 'pellets' ? HIT_MULTIPLIERS.headShotgun : HIT_MULTIPLIERS.head;
  }
  return HIT_MULTIPLIERS[region] ?? HIT_MULTIPLIERS.torso;
}

/** Distance falloff multiplier for a weapon at a distance (§5.5, §5.6). */
export function falloffMultiplier(weapon, distance) {
  if (weapon.mode === 'pellets') return sampleCurve(weapon.pelletFalloff, distance);
  if (!weapon.useFalloff) return 1;
  return sampleCurve(FALLOFF_CURVE, distance);
}

/**
 * Damage one hit deals to a player, before shield/health split.
 *
 * @param {object} opts
 * @param {string} opts.weaponId
 * @param {string} [opts.rarity]
 * @param {string} [opts.region]    'head' | 'torso' | 'legs'
 * @param {number} [opts.distance]  metres
 * @param {number} [opts.pelletsHit] for shotguns; defaults to all pellets
 */
export function computeDamage({
  weaponId, rarity = 'common', region = 'torso', distance = 0, pelletsHit = null
}) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) throw new Error(`Unknown weapon: ${weaponId}`);

  const rarityMult = RARITIES[rarity]?.damageMultiplier ?? 1;
  const regionMult = hitMultiplier(region, weapon);
  const rangeMult = falloffMultiplier(weapon, distance);

  const pellets = weapon.mode === 'pellets'
    ? (pelletsHit ?? weapon.pellets)
    : 1;

  return weapon.damage * pellets * rarityMult * regionMult * rangeMult;
}

/** Structure damage — flat, no falloff, no region multiplier (§6.7). */
export function computeStructureDamage({ weaponId, rarity = 'common' }) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) throw new Error(`Unknown weapon: ${weaponId}`);
  // Rarity scales structure damage the same way it scales player damage (§5.2).
  return weapon.structureDamage * (RARITIES[rarity]?.damageMultiplier ?? 1);
}

/**
 * Split incoming damage across shield then health (§3.1). Overflow carries into health
 * within the same hit.
 *
 * @returns {{health:number, shield:number, shieldAbsorbed:number, healthLost:number, died:boolean}}
 */
export function applyDamageToVitals(health, shield, amount) {
  const shieldAbsorbed = Math.min(shield, amount);
  const remaining = amount - shieldAbsorbed;
  const newShield = shield - shieldAbsorbed;
  const newHealth = Math.max(0, health - remaining);
  return {
    health: newHealth,
    shield: newShield,
    shieldAbsorbed,
    healthLost: health - newHealth,
    died: newHealth <= 0
  };
}

/** Fall damage (§3.1). Ignores shield, capped at 100. */
export function fallDamage(fallDistance) {
  const over = fallDistance - VITALS.fallDamageFreeDistance;
  if (over <= 0) return 0;
  return Math.min(over * VITALS.fallDamagePerMetre, VITALS.fallDamageCap);
}

/**
 * Shots needed to drop a player from a health/shield pool, and the time it takes.
 * Used by the HUD's damage preview and asserted in tests against
 * references/gameplay/01-ttk-table.md.
 */
export function shotsToKill({ weaponId, rarity = 'common', region = 'torso', health = 100, shield = 0, distance = 0 }) {
  const per = computeDamage({ weaponId, rarity, region, distance });
  if (per <= 0) return { shots: Infinity, time: Infinity };
  const shots = Math.ceil((health + shield) / per);
  const time = (shots - 1) / WEAPONS[weaponId].fireRate;
  return { shots, time, damagePerShot: per };
}

/**
 * Current spread in degrees (§5.5).
 *
 * @param {object} opts
 * @param {string} opts.weaponId
 * @param {boolean} [opts.ads]
 * @param {number} [opts.shotsInBurst]
 * @param {number} [opts.horizontalSpeed] m/s
 * @param {number} [opts.walkSpeed]
 * @param {boolean} [opts.airborne]
 * @param {boolean} [opts.crouched]
 */
export function computeSpread({
  weaponId, ads = false, shotsInBurst = 0,
  horizontalSpeed = 0, walkSpeed = 4.6, airborne = false, crouched = false
}) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) throw new Error(`Unknown weapon: ${weaponId}`);

  if (weapon.mode === 'pellets') {
    return weapon.coneHalfAngle * (ads ? weapon.adsConeScale : 1);
  }

  const base = ads ? weapon.adsSpread : weapon.hipSpread;
  const bloom = (weapon.bloomPerShot ?? 0) * Math.min(shotsInBurst, SPREAD.bloomCap);

  let movement = SPREAD.movementPenaltyPerWalkSpeed * (horizontalSpeed / walkSpeed);
  if (airborne) movement *= SPREAD.airborneMultiplier;

  let spread = base + bloom + movement;
  if (crouched) spread *= SPREAD.crouchMultiplier;
  return spread;
}

/** Decay accumulated bloom (§5.5): 9°/s starting 0.25 s after the last shot. */
export function decayBloom(shotsInBurst, timeSinceLastShot, weaponId, dt) {
  if (timeSinceLastShot < SPREAD.bloomDecayDelay) return shotsInBurst;
  const perShot = WEAPONS[weaponId]?.bloomPerShot ?? 0;
  if (perShot <= 0) return 0;
  const shotsDecayed = (SPREAD.bloomDecayPerSecond * dt) / perShot;
  return Math.max(0, shotsInBurst - shotsDecayed);
}

/**
 * Deterministic sunflower pellet pattern (§5.6), jittered by the `spread` RNG stream.
 * Returns unit-ish offsets in radians: { yaw, pitch } relative to the aim direction.
 */
export function pelletPattern(weaponId, ads, rng) {
  const weapon = WEAPONS[weaponId];
  if (weapon.mode !== 'pellets') throw new Error(`${weaponId} does not fire pellets`);

  const count = weapon.pellets;
  const coneRad = weapon.coneHalfAngle * (ads ? weapon.adsConeScale : 1) * DEG2RAD;
  const golden = Math.PI * (3 - Math.sqrt(5)); // 137.507...°
  const out = [];

  for (let i = 0; i < count; i++) {
    // Sunflower: radius grows as sqrt so pellets are area-uniform inside the cone.
    const r = Math.sqrt((i + 0.5) / count) * coneRad;
    const theta = i * golden;
    const jitter = rng ? 1 + (rng.next() * 2 - 1) * SPREAD.shotgunJitterFraction : 1;
    const rj = clamp(r * jitter, 0, coneRad);
    out.push({ yaw: Math.cos(theta) * rj, pitch: Math.sin(theta) * rj });
  }
  return out;
}
