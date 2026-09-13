/**
 * DamageModel.js — damage resolution. MASTER_SPEC §12.5, §12.6, §13.
 *
 * Pure functions, no state, testable in Node.
 *
 * Shotgun pellets resolve INDEPENDENTLY (§12.5): each pellet carries its own hit region
 * and distance, so a shot landing 6 body and 2 head pellets scores correctly. The
 * baseline multiplied damage by pellet count in one calculation with a single hit region,
 * which the spec bans outright.
 */
import { WEAPONS, RARITIES, FALLOFF_CURVE, SPREAD } from '../core/Config.js';
import { sampleCurve, clamp, DEG2RAD } from '../core/MathUtils.js';

/** Per-weapon headshot multiplier (§12.6). */
export function hitMultiplier(region, weapon) {
  if (region === 'head') return weapon?.headshotMultiplier ?? 1;
  return 1;
}

export function falloffMultiplier(weapon, distance) {
  if (weapon.mode === 'pellets') return sampleCurve(weapon.pelletFalloff, distance);
  if (!weapon.useFalloff) return 1;
  return sampleCurve(FALLOFF_CURVE, distance);
}

/** Damage of a single hit — one bullet, or ONE pellet. */
export function singleHitDamage({ weaponId, rarity = 'common', region = 'torso', distance = 0 }) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) throw new Error(`Unknown weapon: ${weaponId}`);
  return weapon.damage
    * (RARITIES[rarity]?.damageMultiplier ?? 1)
    * hitMultiplier(region, weapon)
    * falloffMultiplier(weapon, distance);
}

/**
 * Resolve a shotgun blast from independently-traced pellets (§12.5).
 *
 * @param {object} opts
 * @param {Array<{region:string, distance:number}|null>} opts.pelletHits
 *        One entry per pellet; null for a pellet that missed.
 * @returns {{total:number, pelletsHit:number, headshots:number, isHeadshot:boolean}}
 */
export function resolvePelletHits({ weaponId, rarity = 'common', pelletHits = [] }) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) throw new Error(`Unknown weapon: ${weaponId}`);
  if (weapon.mode !== 'pellets') throw new Error(`${weaponId} does not fire pellets`);

  let total = 0;
  let pelletsHit = 0;
  let headshots = 0;

  for (const hit of pelletHits) {
    if (!hit) continue;
    pelletsHit++;
    if (hit.region === 'head') headshots++;
    total += singleHitDamage({ weaponId, rarity, region: hit.region, distance: hit.distance });
  }

  // §12.5 — total damage may be capped by balance.
  if (weapon.damageCap != null) total = Math.min(total, weapon.damageCap);

  // A blast counts as a headshot for feedback when most connecting pellets hit the head.
  return { total, pelletsHit, headshots, isHeadshot: headshots > 0 && headshots >= pelletsHit / 2 };
}

/** Damage of a full blast with every pellet connecting — used for balance reference. */
export function maxBlastDamage({ weaponId, rarity = 'common', region = 'torso', distance = 0 }) {
  const weapon = WEAPONS[weaponId];
  const pellets = weapon.mode === 'pellets' ? weapon.pellets : 1;
  return singleHitDamage({ weaponId, rarity, region, distance }) * pellets;
}

/** Structure damage — flat, no falloff, no hit region (§9.5). */
export function computeStructureDamage({ weaponId, rarity = 'common' }) {
  const weapon = WEAPONS[weaponId];
  if (!weapon) throw new Error(`Unknown weapon: ${weaponId}`);
  return weapon.structureDamage * (RARITIES[rarity]?.damageMultiplier ?? 1);
}

/** Shield absorbs first, then health; overflow carries within the same hit (§13). */
export function applyDamageToVitals(health, shield, amount) {
  const shieldAbsorbed = Math.min(shield, amount);
  const remaining = amount - shieldAbsorbed;
  const newHealth = Math.max(0, health - remaining);
  return {
    health: newHealth,
    shield: shield - shieldAbsorbed,
    shieldAbsorbed,
    healthLost: health - newHealth,
    died: newHealth <= 0
  };
}

/** Shots to drop a pool, and the time it takes. */
export function shotsToKill({ weaponId, rarity = 'common', region = 'torso', health = 100, shield = 0, distance = 0 }) {
  const per = WEAPONS[weaponId].mode === 'pellets'
    ? maxBlastDamage({ weaponId, rarity, region, distance })
    : singleHitDamage({ weaponId, rarity, region, distance });
  if (per <= 0) return { shots: Infinity, time: Infinity, damagePerShot: 0 };
  const shots = Math.ceil((health + shield) / per);
  return { shots, time: (shots - 1) / WEAPONS[weaponId].fireRate, damagePerShot: per };
}

/** Current spread in degrees (§12.4). */
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

  const spread = base + bloom + movement;
  return crouched ? spread * SPREAD.crouchMultiplier : spread;
}

export function decayBloom(shotsInBurst, timeSinceLastShot, weaponId, dt) {
  if (timeSinceLastShot < SPREAD.bloomDecayDelay) return shotsInBurst;
  const perShot = WEAPONS[weaponId]?.bloomPerShot ?? 0;
  if (perShot <= 0) return 0;
  return Math.max(0, shotsInBurst - (SPREAD.bloomDecayPerSecond * dt) / perShot);
}

/**
 * Deterministic sunflower pellet pattern (§12.5), jittered by the seeded `spread` stream
 * so patterns are learnable rather than pure noise.
 * @returns {Array<{yaw:number, pitch:number}>} angular offsets from the aim direction
 */
export function pelletPattern(weaponId, ads, rng = null) {
  const weapon = WEAPONS[weaponId];
  if (weapon.mode !== 'pellets') throw new Error(`${weaponId} does not fire pellets`);

  const count = weapon.pellets;
  const coneRad = weapon.coneHalfAngle * (ads ? weapon.adsConeScale : 1) * DEG2RAD;
  const golden = Math.PI * (3 - Math.sqrt(5));
  const out = [];

  for (let i = 0; i < count; i++) {
    const r = Math.sqrt((i + 0.5) / count) * coneRad;
    const theta = i * golden;
    const jitter = rng ? 1 + (rng.next() * 2 - 1) * SPREAD.shotgunJitterFraction : 1;
    const rj = clamp(r * jitter, 0, coneRad);
    out.push({ yaw: Math.cos(theta) * rj, pitch: Math.sin(theta) * rj });
  }
  return out;
}

/**
 * Recoil kick for one shot (§12.3). Recoil moves the AIM POINT; spread randomises within
 * it. They are separate systems.
 */
export function recoilKick(weaponId, rng = null) {
  const weapon = WEAPONS[weaponId];
  const lateral = rng ? (rng.next() * 2 - 1) : 0;
  return {
    pitch: (weapon.recoilVertical ?? 0) * DEG2RAD,
    yaw: (weapon.recoilHorizontal ?? 0) * lateral * DEG2RAD
  };
}

/** Recoil recovery toward the original aim, per second (§12.3). */
export function recoilRecover(current, weaponId, dt) {
  const rate = (WEAPONS[weaponId]?.recoilRecovery ?? 0) * DEG2RAD * dt;
  const shrink = (v) => (v > 0 ? Math.max(0, v - rate) : Math.min(0, v + rate));
  return { pitch: shrink(current.pitch), yaw: shrink(current.yaw) };
}
