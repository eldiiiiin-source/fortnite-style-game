/**
 * WeaponRig.js — MASTER_SPEC §12.1.1, §12.1.2.
 *
 * Turns a weapon definition into a part list, exactly as `ToolRig.js` does for a
 * harvesting tool and `CharacterRig.js` does for a skin, using the same shape vocabulary
 * (`SKIN_SPEC` §3.3).
 *
 * ONE GEOMETRY SOURCE, THREE CONSUMERS: the weapon lying in the world, the weapon held in
 * the character's hand, and the weapon drawn as an inventory icon. A weapon cannot look
 * like one thing on the ground and another in the hand, because there is only one shape.
 *
 * RIG SPACE: origin is the GRIP — the point the primary hand closes on. +Z runs toward the
 * MUZZLE, +Y is up, +X is the weapon's right. Anchoring at the grip rather than the butt
 * means a pistol and a sniper both sit correctly in the same hand.
 *
 * DIMENSIONS derive from `WEAPON_VIEW` in Config, which derives from the player capsule.
 * No absolute lengths here.
 *
 * NOTHING HERE FEEDS GAMEPLAY. Damage, spread, recoil, ADS timing and ammo are `WEAPONS`
 * and `SPREAD` in Config. There is nowhere in this shape to put a number that could reach
 * the simulation.
 */
import { WEAPON_VIEW, WEAPONS, WEAPON_CATEGORIES } from '../core/Config.js';
import { box, bevelBox, cylinder, v, depthSort } from './RigPrimitives.js';

/** Regions of a weapon, so a consumer can address the barrel without knowing the class. */
export const WeaponRegion = Object.freeze({
  BODY: 'body',
  BARREL: 'barrel',
  STOCK: 'stock',
  GRIP: 'grip',
  FEED: 'feed',
  SIGHT: 'sight'
});

/**
 * Category profiles — MASTER_SPEC §12.1.1.
 *
 * Every span is a pair of fractions measured FORWARD FROM THE BUTT along the weapon's own
 * length: 0 is the butt, 1 is the muzzle. Stating them this way means a profile reads as a
 * silhouette rather than as arithmetic, and `partsFor` does the one conversion into grip
 * space. `length` is a multiple of `WEAPON_VIEW.length` (the assault rifle reference).
 */
const PROFILES = Object.freeze({
  assaultRifle: {
    length: 1.00,
    stock: [0.00, 0.30],
    receiver: [0.24, 0.64],
    barrel: [0.62, 1.00],
    barrelRadius: 1.00,
    magazine: { at: 0.47, length: 0.10, drop: 1.75, tilt: -0.22 },
    grip: { at: 0.31, drop: 1.30, tilt: 0.30 },
    sight: 'rail'
  },
  smg: {
    // Compact body, long curved magazine, stubby barrel — readable at a glance as an SMG.
    length: 0.66,
    stock: [0.00, 0.17],
    receiver: [0.13, 0.66],
    barrel: [0.64, 1.00],
    barrelRadius: 0.85,
    magazine: { at: 0.45, length: 0.10, drop: 2.45, tilt: -0.34 },
    grip: { at: 0.26, drop: 1.25, tilt: 0.34 },
    sight: 'rail'
  },
  shotgun: {
    // A heavy tube under a wide receiver, and a pump the hand sits on.
    length: 0.96,
    stock: [0.00, 0.34],
    receiver: [0.29, 0.61],
    barrel: [0.59, 1.00],
    barrelRadius: 1.75,
    tube: [0.62, 0.95],
    pump: { at: 0.79, length: 0.14 },
    grip: { at: 0.36, drop: 1.05, tilt: 0.26 },
    sight: 'bead'
  },
  pistol: {
    // No stock at all: a short slide over a deep grip. That absence IS the silhouette.
    length: 0.34,
    receiver: [0.16, 1.00],
    barrel: [0.94, 1.00],
    barrelRadius: 0.80,
    grip: { at: 0.10, drop: 2.05, tilt: 0.30, wide: true },
    sight: 'bead'
  },
  sniper: {
    // Longest barrel, long stock, and the scope that names it.
    length: 1.28,
    stock: [0.00, 0.37],
    receiver: [0.33, 0.58],
    barrel: [0.56, 1.00],
    barrelRadius: 0.90,
    magazine: { at: 0.45, length: 0.07, drop: 1.10, tilt: -0.14 },
    grip: { at: 0.35, drop: 1.30, tilt: 0.30 },
    sight: 'scope'
  },
  utility: {
    // One wide tube. Nothing else needs saying.
    length: 1.06,
    receiver: [0.26, 0.48],
    barrel: [0.05, 1.00],
    barrelRadius: 3.10,
    grip: { at: 0.34, drop: 1.45, tilt: 0.28 },
    sight: 'rail'
  }
});

/** Category palettes. Original colours; rarity never recolours a weapon (§12.1.1). */
const PALETTES = Object.freeze({
  assaultRifle: { body: '#3f4855', barrel: '#2b323c', stock: '#54473a', grip: '#262c34', feed: '#343c47', sight: '#1f242b' },
  smg: { body: '#454b57', barrel: '#2e343d', stock: '#343a44', grip: '#23282f', feed: '#3a414c', sight: '#1e2229' },
  shotgun: { body: '#4a4238', barrel: '#33383f', stock: '#6b5339', grip: '#2a2822', feed: '#3d4149', sight: '#c8b06a' },
  pistol: { body: '#4b525d', barrel: '#31373f', stock: '#31373f', grip: '#272b31', feed: '#3a404a', sight: '#c8b06a' },
  sniper: { body: '#3a4a3f', barrel: '#252c27', stock: '#4d5a3d', grip: '#1f2521', feed: '#2f3a33', sight: '#161a17' },
  utility: { body: '#5a4a3a', barrel: '#4a4036', stock: '#4a4036', grip: '#2b2620', feed: '#3b352c', sight: '#1f1c18' }
});

/** Every category has a profile — a weapon can never fall back to an invisible model. */
export const SUPPORTED_CATEGORIES = Object.freeze(Object.keys(PROFILES).sort());

const DEFAULT_CATEGORY = 'assaultRifle';

/** Resolve a weapon id, a weapon definition or a category to a category name. */
export function categoryOf(weaponOrId) {
  if (typeof weaponOrId === 'string') {
    if (PROFILES[weaponOrId]) return weaponOrId;
    const weapon = WEAPONS[weaponOrId];
    if (weapon && PROFILES[weapon.category]) return weapon.category;
    return DEFAULT_CATEGORY;
  }
  const category = weaponOrId?.category ?? weaponOrId?.weapon?.category;
  return PROFILES[category] ? category : DEFAULT_CATEGORY;
}

/** Weapon metrics, all derived from the view-scale constants (§12.1.1). */
export function weaponMetrics(category = DEFAULT_CATEGORY) {
  const profile = PROFILES[categoryOf(category)];
  const length = WEAPON_VIEW.length * profile.length;
  // Fraction of the length that lies BEHIND the grip. The grip point is the origin, so
  // this is the one number that converts a butt-relative span into rig space.
  const gripFromButt = 1 - WEAPON_VIEW.gripAlong;
  return {
    category: categoryOf(category),
    length,
    gripFromButt,
    gripToMuzzle: length * WEAPON_VIEW.gripAlong,
    gripToButt: length * gripFromButt,
    bodyHeight: WEAPON_VIEW.bodyHeight,
    bodyWidth: WEAPON_VIEW.bodyWidth,
    barrelRadius: WEAPON_VIEW.barrelRadius * profile.barrelRadius
  };
}

/* ── geometry ────────────────────────────────────────────────────────────── */

/** Convert a butt-relative fraction to a grip-space Z. */
const atZ = (m, u) => (u - m.gripFromButt) * m.length;

/** Centre and length, in grip space, of a butt-relative span. */
function span(m, [u0, u1]) {
  const z0 = atZ(m, u0);
  const z1 = atZ(m, u1);
  return { z: (z0 + z1) / 2, length: Math.abs(z1 - z0) };
}

function partsFor(category) {
  const name = categoryOf(category);
  const profile = PROFILES[name];
  const m = weaponMetrics(name);
  const parts = [];
  const R = WeaponRegion;

  // Receiver — the body everything else hangs off.
  const body = span(m, profile.receiver);
  parts.push(bevelBox('receiver', R.BODY, 'body',
    v(m.bodyWidth, m.bodyHeight, body.length), v(0, 0, body.z)));

  // Barrel — a cylinder laid along +Z. The unit cylinder stands on +Y, so a quarter turn
  // about X lays it down the weapon's axis.
  const barrel = span(m, profile.barrel);
  parts.push(cylinder('barrel', R.BARREL, 'barrel',
    m.barrelRadius, barrel.length, v(0, m.bodyHeight * 0.16, barrel.z),
    v(Math.PI / 2, 0, 0)));

  // Shotgun magazine tube, slung under the barrel.
  if (profile.tube) {
    const tube = span(m, profile.tube);
    parts.push(cylinder('tube', R.FEED, 'feed',
      m.barrelRadius * 0.62, tube.length,
      v(0, m.bodyHeight * 0.16 - m.barrelRadius * 1.15, tube.z),
      v(Math.PI / 2, 0, 0)));
  }

  // Pump, where the support hand sits.
  if (profile.pump) {
    const z = atZ(m, profile.pump.at);
    parts.push(box('pump', R.FEED, 'stock',
      v(m.bodyWidth * 1.15, m.bodyHeight * 0.62, m.length * profile.pump.length),
      v(0, m.bodyHeight * 0.16 - m.barrelRadius * 0.9, z)));
  }

  // Stock — absent on a pistol and on the launcher, which is the point.
  if (profile.stock) {
    const stock = span(m, profile.stock);
    parts.push(bevelBox('stock', R.STOCK, 'stock',
      v(m.bodyWidth * 0.86, m.bodyHeight * 0.92, stock.length),
      v(0, -m.bodyHeight * 0.06, stock.z)));
  }

  // Magazine, tilted forward where the class tilts it.
  if (profile.magazine) {
    const mag = profile.magazine;
    parts.push(box('magazine', R.FEED, 'feed',
      v(m.bodyWidth * 0.78, m.bodyHeight * mag.drop, m.length * mag.length),
      v(0, -m.bodyHeight * (0.5 + mag.drop * 0.5) * 0.92, atZ(m, mag.at)),
      v(mag.tilt, 0, 0)));
  }

  // Primary grip — the part the hand actually closes on, at the rig origin's own height.
  const grip = profile.grip;
  parts.push(bevelBox('grip', R.GRIP, 'grip',
    v(m.bodyWidth * (grip.wide ? 0.95 : 0.80), m.bodyHeight * grip.drop, m.length * (grip.wide ? 0.17 : 0.11)),
    v(0, -m.bodyHeight * (0.5 + grip.drop * 0.5) * 0.92, atZ(m, grip.at)),
    v(grip.tilt, 0, 0)));

  // Sight — the one feature that separates a sniper from a rifle at distance.
  if (profile.sight === 'scope') {
    const scope = span(m, [profile.receiver[0] + 0.02, profile.receiver[1] + 0.02]);
    parts.push(cylinder('scope', R.SIGHT, 'sight',
      m.bodyHeight * 0.30, scope.length,
      v(0, m.bodyHeight * 0.82, scope.z), v(Math.PI / 2, 0, 0)));
    parts.push(box('scopeMountFront', R.SIGHT, 'sight',
      v(m.bodyWidth * 0.5, m.bodyHeight * 0.4, m.length * 0.02),
      v(0, m.bodyHeight * 0.55, scope.z + scope.length * 0.3)));
    parts.push(box('scopeMountRear', R.SIGHT, 'sight',
      v(m.bodyWidth * 0.5, m.bodyHeight * 0.4, m.length * 0.02),
      v(0, m.bodyHeight * 0.55, scope.z - scope.length * 0.3)));
  } else if (profile.sight === 'rail') {
    const rail = span(m, [profile.receiver[0] + 0.04, profile.receiver[1] - 0.02]);
    parts.push(box('rail', R.SIGHT, 'sight',
      v(m.bodyWidth * 0.46, m.bodyHeight * 0.18, rail.length),
      v(0, m.bodyHeight * 0.58, rail.z)));
  }
  // Front bead, on everything: it marks the muzzle end so the model reads directionally.
  parts.push(box('bead', R.SIGHT, 'sight',
    v(m.bodyWidth * 0.26, m.bodyHeight * 0.26, m.length * 0.015),
    v(0, m.bodyHeight * 0.16 + m.barrelRadius * 0.9, atZ(m, 0.96))));

  return parts;
}

/**
 * Build a weapon's part list.
 *
 * @param {string|object} weaponOrId  a weapon id, a weapon definition, or a category
 * @returns {{category:string, metrics:object, palette:object, parts:object[]}}
 *          shaped exactly like a skin or tool rig, so `paintRig` and `CharacterView` take
 *          it without knowing what it is
 */
export function buildWeaponRig(weaponOrId) {
  const category = categoryOf(weaponOrId);
  return {
    id: category,
    category,
    metrics: weaponMetrics(category),
    palette: { ...PALETTES[category], primary: PALETTES[category].body },
    parts: depthSort(partsFor(category))
  };
}

/* ── poses — §12.1.2 ─────────────────────────────────────────────────────── */

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Where a held weapon sits, and how the arm holding it is turned (§12.1.2).
 *
 * Pure geometry, so it is testable in Node and the view stays a translator.
 *
 * THE ARM IS A PURE X ROTATION, deliberately. The weapon hangs off the shoulder pivot the
 * pickaxe already uses, so its transform has to be expressed in the ARM's local space. A
 * pure X rotation inverts analytically — `Rx(-a)` on the position, and `+a` folded into the
 * pitch, since three.js composes XYZ as `Rx·Ry·Rz` and `Rx(-a)·Rx(p)·Ry(y) = Rx(p-a)·Ry(y)`
 * exactly. A general rotation would need a matrix inverse here, and the view would stop
 * being a translator.
 *
 * @param {object} metrics  the character rig's metrics (armX, shoulderY, armDepth, …)
 * @param {number} adsProgress  0 hip, 1 fully aimed
 * @returns {{arm:{x,y,z}, position:{x,y,z}, rotation:{x,y,z}, grip:{x,y,z}, pitch:number}}
 */
export function weaponPose(metrics, adsProgress = 0) {
  const t = Math.min(1, Math.max(0, Number.isFinite(adsProgress) ? adsProgress : 0));
  const W = WEAPON_VIEW;

  const armPitch = lerp(W.hipArmPitch, W.adsArmPitch, t);
  // The arm swings FORWARD, so its rotation about X is negative: local -Y (the hanging
  // limb) turns toward +Z, the direction the rig faces.
  const arm = { x: -armPitch, y: 0, z: 0 };

  // Where the arm actually puts the hand. Deriving the grip from this rather than stating
  // it independently is what keeps the weapon IN the hand at every ADS progress.
  const c = Math.cos(armPitch);
  const s = Math.sin(armPitch);
  const hand = {
    x: metrics.armX,
    y: metrics.shoulderY - metrics.armLength * c,
    z: metrics.armLength * s
  };

  // Wrist offset, hand -> grip. Stated in rig space and rotated into the arm's space below.
  const offset = {
    x: lerp(W.hipOut, W.adsOut, t),
    y: lerp(W.hipLift, W.adsLift, t),
    z: lerp(W.hipForward, W.adsForward, t)
  };

  const grip = { x: hand.x + offset.x, y: hand.y + offset.y, z: hand.z + offset.z };
  const pitch = lerp(W.hipPitch, W.adsPitch, t);
  const yaw = -lerp(W.hipYaw, W.adsYaw, t);

  return {
    arm,
    // Arm-local: the hand sits at (0, -armLength, 0) in the rotated arm's own space, and
    // the wrist offset rotates in by Rx(+armPitch) — exactly the inverse of the arm's turn.
    position: {
      x: offset.x,
      y: -metrics.armLength + offset.y * c - offset.z * s,
      z: offset.y * s + offset.z * c
    },
    // The arm's rotation folds into the pitch, so the muzzle ends up where `pitch` and
    // `yaw` say it does however far the arm is raised.
    rotation: { x: pitch + armPitch, y: yaw, z: 0 },
    hand,
    grip,
    pitch,
    yaw,
    armPitch
  };
}

/**
 * Where the muzzle ends up in rig space, for tests and for anything that wants to check
 * the weapon is pointing forward rather than through the character (§12.1.2).
 */
export function muzzlePoint(metrics, category, adsProgress = 0) {
  const pose = weaponPose(metrics, adsProgress);
  const m = weaponMetrics(category);
  // RIG-space pitch and yaw, not the arm-local rotation: the arm's own turn is already
  // folded out of these, which is the whole point of stating the pose as a direction.
  const rx = pose.pitch;
  const ry = pose.yaw;
  const forward = {
    x: Math.sin(ry),
    y: -Math.sin(rx) * Math.cos(ry),
    z: Math.cos(rx) * Math.cos(ry)
  };
  return {
    x: pose.grip.x + forward.x * m.gripToMuzzle,
    y: pose.grip.y + forward.y * m.gripToMuzzle,
    z: pose.grip.z + forward.z * m.gripToMuzzle
  };
}

/** Every weapon category the catalog uses has a model (§12.1.1). Asserted by test. */
export function categoriesCovered() {
  return WEAPON_CATEGORIES.every((c) => Boolean(PROFILES[c]));
}
