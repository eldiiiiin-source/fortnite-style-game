/**
 * Config.js — the ONLY place spatial and gameplay constants are declared.
 *
 * MASTER_SPEC §2 (no magic numbers), §9.1.1 (the build module is the unit of scale).
 *
 * RULE: no file outside this one may contain a spatial literal. Every dimension in the
 * game derives from TILE and WALL_H by ratio, so retuning the build module rescales the
 * game coherently instead of requiring an architectural rewrite.
 */

/* ══ THE BUILD MODULE — owner-approved 2026-09-13, MASTER_SPEC §9.1 ══════════ */

/** Build grid tile footprint, metres. Everything horizontal derives from this. */
export const TILE = 5.12;

/** Wall / storey height, metres. Everything vertical derives from this. */
export const WALL_H = 3.84;

/**
 * Ratios against the build module (§9.1.1). Named so the derivation is legible at the
 * call site and survives a retune of TILE / WALL_H.
 */
export const RATIO = Object.freeze({
  pieceThickness: 0.0390625,   // TILE  -> 0.20 m
  capsuleRadius: 0.078125,     // TILE  -> 0.40 m
  standHeight: 0.5,            // WALL_H -> 1.92 m
  crouchHeight: 0.3125,        // WALL_H -> 1.20 m — just under one wall edit row (1.28 m)
  stepHeight: 0.1171875,       // WALL_H -> 0.45 m
  eyeOffset: 0.45,             // WALL_H -> 1.73 m above capsule base when standing
  roadWidth: 1.5,              // TILE  -> 7.68 m  (MAP_SPEC §12.1)
  bridgeWidth: 1.0             // TILE  -> 5.12 m
});

/* ══ SIMULATION — owner-approved 60 Hz, MASTER_SPEC §3 ═══════════════════════ */

export const SIM = Object.freeze({
  tickRate: 60,
  fixedDt: 1 / 60,
  maxStepsPerFrame: 5
});

/* ══ EDIT GRIDS — per piece type, MASTER_SPEC §10.2 ══════════════════════════
 * NOT uniform. Wall 3x3, floor 2x2, cone 2x2, ramp 3 rows x 2 columns.
 */
export const EDIT_GRIDS = Object.freeze({
  wall: { cols: 3, rows: 3, tiles: 9 },
  floor: { cols: 2, rows: 2, tiles: 4 },
  cone: { cols: 2, rows: 2, tiles: 4 },
  ramp: { cols: 2, rows: 3, tiles: 6 }
});

/** Derived edit-tile dimensions in metres (§9.1.1). */
export const EDIT_TILE = Object.freeze({
  wall: { width: TILE / EDIT_GRIDS.wall.cols, height: WALL_H / EDIT_GRIDS.wall.rows },
  floor: { width: TILE / EDIT_GRIDS.floor.cols, depth: TILE / EDIT_GRIDS.floor.rows },
  cone: { width: TILE / EDIT_GRIDS.cone.cols, depth: TILE / EDIT_GRIDS.cone.rows },
  ramp: { width: TILE / EDIT_GRIDS.ramp.cols, rise: WALL_H / EDIT_GRIDS.ramp.rows }
});

/* ══ PLAYER — MASTER_SPEC §5, all spatial values derived ═════════════════════ */

export const VITALS = Object.freeze({
  maxHealth: 100,   // [OWNER] §13
  maxShield: 100,   // [OWNER] §13
  startHealth: 100,
  startShield: 0
});

export const MOVEMENT = Object.freeze({
  walkSpeed: 4.6,
  sprintSpeed: 7.6,
  crouchSpeed: 2.4,
  swimSpeed: 3.4,
  // §5.2 "reaches intended speed quickly" — raised from the baseline's 60 / 12.
  groundAccel: 85,
  groundFriction: 12,
  airAccel: 14,
  airControlCap: 2.0,
  airDrag: 0.4,
  gravity: 22,
  jumpVelocity: 7.4,
  terminalVelocity: 60,
  maxWalkableSlopeDeg: 50,
  slideSpeed: 6,
  coyoteTime: 0.10,
  jumpBufferTime: 0.12,
  crouchTransition: 0.12,

  // Derived from the build module — §9.1.1
  capsuleRadius: TILE * RATIO.capsuleRadius,   // 0.400 m
  standHeight: WALL_H * RATIO.standHeight,     // 1.920 m
  crouchHeight: WALL_H * RATIO.crouchHeight,   // 1.200 m
  stepHeight: WALL_H * RATIO.stepHeight,       // 0.450 m
  eyeOffset: WALL_H * RATIO.eyeOffset          // 1.728 m
});

/** Mantling — §5.5. Suppressed during building so it can never fire by accident. */
export const MANTLE = Object.freeze({
  minHeight: WALL_H * RATIO.stepHeight,        // must exceed a step
  maxHeight: WALL_H * 0.4427,                  // 1.70 m
  clearance: TILE * 0.1171875,                 // 0.60 m behind the ledge
  forwardReach: TILE * 0.17578125,             // 0.90 m
  duration: 0.35,
  // [OWNER] §5.5 "No accidental mantling during normal building."
  suppressAfterBuildTime: 0.20
});

/* ══ CHARACTER RIG — SKIN_SPEC §3, §5 ════════════════════════════════════════
 * Visual proportions for the player character. Purely cosmetic: collision stays the
 * capsule in MOVEMENT for every skin (SKIN_SPEC §3.4, ITEM_SHOP_SPEC §4.4).
 *
 * Everything is a ratio of the capsule, so a retune of TILE / WALL_H rescales every
 * character with the world instead of leaving skins the wrong size. Only the anchors that
 * cannot be derived live here — the rig computes torso height, arm and leg spans from
 * them, which is what keeps every build exactly standHeight tall (§3.2).
 */

export const CHARACTER = Object.freeze({
  /** Reference dimensions the whole rig is expressed against. */
  height: MOVEMENT.standHeight,
  radius: MOVEMENT.capsuleRadius,

  /** Hip line: the top of the legs and the bottom of the torso. */
  hipY: MOVEMENT.standHeight * 0.46,
  footHeight: MOVEMENT.standHeight * 0.05,

  /** Base part sizes for the `athletic` build; builds scale these (§5). */
  torsoWidth: MOVEMENT.capsuleRadius * 2.05,
  torsoDepth: MOVEMENT.capsuleRadius * 1.25,
  hipWidth: MOVEMENT.capsuleRadius * 1.70,
  headRadius: MOVEMENT.capsuleRadius * 0.58,
  neckLength: MOVEMENT.capsuleRadius * 0.36,
  neckWidth: MOVEMENT.capsuleRadius * 0.62,
  armWidth: MOVEMENT.capsuleRadius * 0.52,
  armDepth: MOVEMENT.capsuleRadius * 0.60,
  armLength: MOVEMENT.standHeight * 0.36,
  legWidth: MOVEMENT.capsuleRadius * 0.74,
  legDepth: MOVEMENT.capsuleRadius * 0.88,

  /**
   * Build multipliers (§5). Applied before features, so two builds read as different
   * shapes rather than as different palettes.
   *
   * `legScale` moves the hip line, which is what makes a mascot stubby and a lean frame
   * long-legged without either one changing the character's overall height.
   */
  builds: Object.freeze({
    lean: { shoulder: 0.88, torso: 0.86, limb: 0.88, head: 1.00, legScale: 1.06, stance: 0.92 },
    athletic: { shoulder: 1.00, torso: 1.00, limb: 1.00, head: 1.00, legScale: 1.00, stance: 1.00 },
    heavy: { shoulder: 1.14, torso: 1.12, limb: 1.12, head: 0.94, legScale: 0.96, stance: 1.10 },
    stout: { shoulder: 1.04, torso: 1.12, limb: 0.96, head: 1.62, legScale: 0.78, stance: 1.06 }
  })
});

/* ══ CAMERA — MASTER_SPEC §7 ═════════════════════════════════════════════════ */

export const CAMERA = Object.freeze({
  // Close over-the-shoulder, but far enough that the avatar does not occlude the
  // crosshair. Tuned against the rendered view; see MASTER_SPEC §7.
  distance: 4.0,
  shoulderOffsetX: 0.8,
  heightAbovebase: WALL_H * RATIO.standHeight * 0.807,  // 1.55 m
  crouchDrop: 0.6,
  pitchMinDeg: -85,
  pitchMaxDeg: 85,
  fovDefault: 80,
  lookSensitivity: 0.0022,
  adsSensitivityScale: 0.6,
  scopeSensitivityScale: 0.45,
  // §7.1 — pulling in is immediate (clipping is never acceptable); restoring is smoothed.
  collisionRadius: 0.25,
  collisionPadding: 0.10,
  restoreSpeed: 8.0,
  transitionTime: 0.12
});

/* ══ BUILDING — MASTER_SPEC §9 ═══════════════════════════════════════════════ */

export const BUILD = Object.freeze({
  tileSize: TILE,
  wallHeight: WALL_H,
  thickness: TILE * RATIO.pieceThickness,
  cost: 10,
  placementRange: TILE * 2.34375,       // 12.0 m
  editRange: TILE * 1.5625,             // 8.0 m
  // §9.3 — inputs are QUEUED, never dropped.
  placementCooldown: 0.05,
  queueDepth: 3,
  queuedIntentLifetime: 0.25,
  supportGraceTime: 0.35,
  ceilingY: 260
});

export const PIECE_TYPES = Object.freeze(['wall', 'floor', 'ramp', 'cone']);
export const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);

/* ══ MATERIALS — WOOD / BRICK / METAL, MASTER_SPEC §9.4 ══════════════════════ */

export const MATERIALS = Object.freeze({
  wood: { id: 'wood', name: 'Wood', initialHp: 90, fullHp: 150, buildTime: 3.5, color: 0xc9873b },
  brick: { id: 'brick', name: 'Brick', initialHp: 90, fullHp: 300, buildTime: 11.0, color: 0xb06a4f },
  metal: { id: 'metal', name: 'Metal', initialHp: 90, fullHp: 500, buildTime: 20.0, color: 0x8fa3b0 }
});

export const MATERIAL_ORDER = Object.freeze(['wood', 'brick', 'metal']);
export const MATERIAL_CAP = 500;

/* ══ EDITING — MASTER_SPEC §10 ═══════════════════════════════════════════════ */

export const EDIT = Object.freeze({
  range: BUILD.editRange,
  enterTime: 0.05,
  confirmTime: 0.05,
  maxFlowTime: 0.25,
  confirmOnRelease: true   // [OWNER] §4.2 — user-settable ON/OFF
});

/* ══ COMBAT — MASTER_SPEC §12, §13 ═══════════════════════════════════════════ */

export const RARITIES = Object.freeze({
  common: { id: 'common', tier: 0, damageMultiplier: 1.00, color: 0xb0b0b0 },
  uncommon: { id: 'uncommon', tier: 1, damageMultiplier: 1.05, color: 0x4cd94c },
  rare: { id: 'rare', tier: 2, damageMultiplier: 1.10, color: 0x3b8eea },
  epic: { id: 'epic', tier: 3, damageMultiplier: 1.16, color: 0xb14ce8 },
  legendary: { id: 'legendary', tier: 4, damageMultiplier: 1.22, color: 0xe8a33b }
});

export const RARITY_ORDER = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);

export const WEAPON_CATEGORIES = Object.freeze([
  'assaultRifle', 'shotgun', 'smg', 'pistol', 'sniper', 'utility'
]);

export const FALLOFF_CURVE = Object.freeze([[0, 1.0], [35, 1.0], [60, 0.80], [90, 0.65]]);

/** §12.1 — every weapon declares equipTime, reserveAmmo and recoil. */
export const WEAPONS = Object.freeze({
  assaultRifle: {
    id: 'assaultRifle', name: 'Assault Rifle', category: 'assaultRifle', ammo: 'medium',
    damage: 30, fireRate: 5.5, magazine: 30, reserveAmmo: 210, reloadTime: 2.3,
    equipTime: 0.55, headshotMultiplier: 2.0, structureDamage: 30,
    mode: 'hitscan', useFalloff: true,
    hipSpread: 3.2, adsSpread: 0.6, adsFov: 55, adsTime: 0.24, bloomPerShot: 0.45,
    recoilVertical: 0.55, recoilHorizontal: 0.18, recoilRecovery: 6.0
  },
  smg: {
    id: 'smg', name: 'SMG', category: 'smg', ammo: 'light',
    damage: 17, fireRate: 11.0, magazine: 30, reserveAmmo: 240, reloadTime: 2.1,
    equipTime: 0.45, headshotMultiplier: 2.0, structureDamage: 17,
    mode: 'hitscan', useFalloff: true,
    hipSpread: 4.4, adsSpread: 1.4, adsFov: 62, adsTime: 0.18, bloomPerShot: 0.30,
    recoilVertical: 0.28, recoilHorizontal: 0.22, recoilRecovery: 8.0
  },
  pumpShotgun: {
    id: 'pumpShotgun', name: 'Pump Shotgun', category: 'shotgun', ammo: 'shells',
    damage: 9, pellets: 10, fireRate: 0.75, magazine: 5, reserveAmmo: 60, reloadTime: 4.5,
    equipTime: 0.85, headshotMultiplier: 1.5, structureDamage: 100,
    mode: 'pellets', useFalloff: false,
    coneHalfAngle: 4.5, adsConeScale: 0.7, adsFov: 65, adsTime: 0.28,
    pelletFalloff: [[0, 1.0], [8, 1.0], [22, 0.55], [1000, 0.35]],
    recoilVertical: 2.2, recoilHorizontal: 0.4, recoilRecovery: 5.0
  },
  tacticalShotgun: {
    id: 'tacticalShotgun', name: 'Tactical Shotgun', category: 'shotgun', ammo: 'shells',
    damage: 6, pellets: 10, fireRate: 1.6, magazine: 8, reserveAmmo: 60, reloadTime: 3.6,
    equipTime: 0.70, headshotMultiplier: 1.5, structureDamage: 80,
    mode: 'pellets', useFalloff: false,
    coneHalfAngle: 6.0, adsConeScale: 0.7, adsFov: 65, adsTime: 0.28,
    pelletFalloff: [[0, 1.0], [6, 1.0], [18, 0.5], [1000, 0.3]],
    recoilVertical: 1.4, recoilHorizontal: 0.35, recoilRecovery: 6.0
  },
  boltSniper: {
    id: 'boltSniper', name: 'Bolt Sniper', category: 'sniper', ammo: 'heavy',
    damage: 105, fireRate: 0.55, magazine: 1, reserveAmmo: 20, reloadTime: 2.8,
    equipTime: 1.05, headshotMultiplier: 2.5, structureDamage: 125,
    mode: 'hitscan', useFalloff: false,
    hipSpread: 12.0, adsSpread: 0.0, adsFov: 28, adsTime: 0.40, bloomPerShot: 0,
    recoilVertical: 3.5, recoilHorizontal: 0.2, recoilRecovery: 3.0
  },
  pistol: {
    id: 'pistol', name: 'Pistol', category: 'pistol', ammo: 'light',
    damage: 24, fireRate: 6.75, magazine: 16, reserveAmmo: 180, reloadTime: 1.5,
    equipTime: 0.40, headshotMultiplier: 2.0, structureDamage: 24,
    mode: 'hitscan', useFalloff: true,
    hipSpread: 2.8, adsSpread: 0.5, adsFov: 58, adsTime: 0.20, bloomPerShot: 0.35,
    recoilVertical: 0.45, recoilHorizontal: 0.15, recoilRecovery: 7.0
  },
  rocketLauncher: {
    id: 'rocketLauncher', name: 'Rocket Launcher', category: 'utility', ammo: 'rockets',
    damage: 100, splashDamage: 75, splashRadius: TILE * 0.879,
    fireRate: 0.6, magazine: 1, reserveAmmo: 12, reloadTime: 3.2,
    equipTime: 1.10, headshotMultiplier: 1.0, structureDamage: 400,
    mode: 'projectile', projectileSpeed: 45, useFalloff: false,
    hipSpread: 1.5, adsSpread: 0.4, adsFov: 60, adsTime: 0.35, bloomPerShot: 0,
    recoilVertical: 2.0, recoilHorizontal: 0.3, recoilRecovery: 4.0
  }
});

export const SPREAD = Object.freeze({
  bloomCap: 8,
  bloomDecayPerSecond: 9,
  bloomDecayDelay: 0.25,
  movementPenaltyPerWalkSpeed: 0.55,
  airborneMultiplier: 2,
  crouchMultiplier: 0.75,
  shotgunJitterFraction: 0.15
});

/* ══ PICKAXE — MASTER_SPEC §14 ═══════════════════════════════════════════════ */

export const PICKAXE = Object.freeze({
  swingInterval: 0.55,
  range: TILE * 0.5859375,        // 3.0 m
  damageToStructures: 100,
  damageToOwnStructures: 0,
  damageToPlayers: 20,
  damageToProps: 75,
  harvestPerSwing: { wood: 12, brick: 14, metal: 12 },
  weakPointMultiplier: 2
});

/* ══ INVENTORY — five combat slots + separate pickaxe, MASTER_SPEC §15 ═══════ */

export const INVENTORY = Object.freeze({
  combatSlots: 5,       // [OWNER]
  switchTime: 0.25,     // floor; per-weapon equipTime overrides upward
  pickupHoldTime: 0.4,
  stackSizes: { light: 999, medium: 999, heavy: 999, shells: 60, rockets: 12 }
});

export const CONSUMABLES = Object.freeze({
  smallShield: { id: 'smallShield', name: 'Small Shield', useTime: 2.0, shield: 25, shieldCap: 50, stack: 6 },
  largeShield: { id: 'largeShield', name: 'Large Shield', useTime: 5.0, shield: 50, shieldCap: 100, stack: 3 },
  medkit: { id: 'medkit', name: 'Medkit', useTime: 8.0, health: 100, healthCap: 100, stack: 3 }
});

/* ══ INPUT — MASTER_SPEC §4 ══════════════════════════════════════════════════ */

export const DEFAULT_BINDINGS = Object.freeze({
  moveForward: 'KeyW', moveBackward: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
  jump: 'Space', crouch: 'ControlLeft', sprint: 'ShiftLeft',
  interact: 'KeyE', fire: 'Mouse0', aim: 'Mouse2', reload: 'KeyR',
  pickaxe: 'Digit1',
  weaponSlot1: 'Digit1', weaponSlot2: 'Digit2', weaponSlot3: 'Digit3',
  weaponSlot4: 'Digit4', weaponSlot5: 'Digit5',
  wall: 'KeyQ', floor: 'KeyF', ramp: 'KeyC', cone: 'KeyV',
  edit: 'KeyG', confirmEdit: 'Mouse0',
  resetEdit: 'WheelDown',          // [OWNER] §10.9
  inventory: 'Tab', map: 'KeyM', settings: 'Escape'
});

/** Binds that may legitimately share a key with another action. */
export const BIND_CONFLICT_EXEMPT = Object.freeze([
  ['pickaxe', 'weaponSlot1'],
  ['fire', 'confirmEdit']
]);

/* ══ WORLD — MAP_SPEC ════════════════════════════════════════════════════════ */

export const WORLD = Object.freeze({
  regionExtent: 1024,          // MAP_SPEC §12.2 — the first region only
  eventualIslandExtent: 2048,
  seaLevel: 0,
  swimDepth: 1.2,
  chunkSize: 128,
  propLoadRadius: 500,
  propUnloadRadius: 650,
  buildCullDistance: 300,
  terrainDrawDistance: 1400
});

export const BUDGET = Object.freeze({
  targetFps: 60,
  frameTimeMs: 16.6,
  simulationMs: 4,
  maxDrawCalls: 1200,
  maxBuildPieces: 6000,
  maxTriangles: 2_500_000
});
