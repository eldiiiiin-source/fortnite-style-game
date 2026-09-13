/**
 * Config.js — every gameplay tunable in the project.
 *
 * RULE (see CLAUDE.md): no gameplay number appears anywhere else in src/. Each group
 * below names the spec section it comes from. If you change a number here, change the
 * spec first; tests in tests/ assert these against the spec's quoted values.
 */

/* ── Simulation — MASTER_SPEC §2.1 ─────────────────────────────────────────── */
export const SIM = Object.freeze({
  tickRate: 30,
  fixedDt: 1 / 30,
  maxStepsPerFrame: 5
});

/* ── Player vitals — MASTER_SPEC §3.1 ──────────────────────────────────────── */
export const VITALS = Object.freeze({
  maxHealth: 100,
  maxShield: 100,
  startHealth: 100,
  startShield: 0,
  fallDamageFreeDistance: 3.5, // metres
  fallDamagePerMetre: 10,
  fallDamageCap: 100
});

/* ── Movement — MASTER_SPEC §3.2 ───────────────────────────────────────────── */
export const MOVEMENT = Object.freeze({
  walkSpeed: 4.6,
  sprintSpeed: 7.6,
  crouchSpeed: 2.4,
  swimSpeed: 3.4, // MAP_SPEC §4.3
  groundAccel: 60,
  groundFriction: 10,
  airAccel: 12,
  airControlCap: 1.6,
  airDrag: 0.4,
  gravity: 22,
  jumpVelocity: 7.4,
  terminalVelocity: 60,
  stepHeight: 0.45,
  maxWalkableSlopeDeg: 48,
  slideSpeed: 6, // MAP_SPEC §4.2
  capsuleRadius: 0.4,
  standHeight: 1.85,
  crouchHeight: 1.25,
  coyoteTime: 0.10,
  jumpBufferTime: 0.12,
  sprintDecayTime: 0.25,
  mantleMinHeight: 0.45,
  mantleMaxHeight: 1.7,
  mantleClearance: 0.6,
  mantleDuration: 0.35
});

/* ── Camera — MASTER_SPEC §3.3 ─────────────────────────────────────────────── */
export const CAMERA = Object.freeze({
  distance: 3.2,
  buildDistance: 3.6,
  shoulderOffsetX: 0.55,
  shoulderOffsetY: 1.55,
  fovHip: 80,
  fovAds: 55,
  pitchMinDeg: -85,
  pitchMaxDeg: 85,
  lookSensitivity: 0.0022, // rad per mouse count at user sensitivity 1.0
  adsSensitivityScale: 0.6,
  collisionRadius: 0.25,
  collisionPadding: 0.1,
  transitionTime: 0.12
});

/* ── Materials — MASTER_SPEC §4.1 ──────────────────────────────────────────── */
export const MATERIALS = Object.freeze({
  cap: 500,
  wood: { id: 'wood', initialHp: 90, fullHp: 150, buildTime: 3.5, color: 0xc9873b },
  stone: { id: 'stone', initialHp: 90, fullHp: 300, buildTime: 11.0, color: 0x9aa0a6 },
  metal: { id: 'metal', initialHp: 90, fullHp: 500, buildTime: 20.0, color: 0x7fb4d9 }
});

export const MATERIAL_ORDER = Object.freeze(['wood', 'stone', 'metal']);

/* ── Harvesting — MASTER_SPEC §4.2 ─────────────────────────────────────────── */
export const HARVEST = Object.freeze({
  swingInterval: 0.55,
  damageToHarvestables: 75,
  damageToPlayers: 20,
  damageToEnemyStructures: 100,
  damageToOwnStructures: 0,
  weakPointMultiplier: 2,
  range: 3.0,
  sources: Object.freeze({
    tree: { material: 'wood', perSwing: 12, total: 50 },
    pallet: { material: 'wood', perSwing: 10, total: 30 },
    boulder: { material: 'stone', perSwing: 14, total: 60 },
    brickWall: { material: 'stone', perSwing: 11, total: 40 },
    vehicle: { material: 'metal', perSwing: 12, total: 70 },
    container: { material: 'metal', perSwing: 14, total: 90 },
    streetlight: { material: 'metal', perSwing: 10, total: 30 }
  })
});

/* ── Combat — MASTER_SPEC §5 ───────────────────────────────────────────────── */
export const HIT_MULTIPLIERS = Object.freeze({
  head: 2.0,
  headShotgun: 1.5,
  torso: 1.0,
  legs: 1.0
});

/** Rarity damage multipliers and HUD colours — §5.2 */
export const RARITIES = Object.freeze({
  common: { id: 'common', tier: 0, damageMultiplier: 1.00, color: 0xb0b0b0 },
  uncommon: { id: 'uncommon', tier: 1, damageMultiplier: 1.05, color: 0x4cd94c },
  rare: { id: 'rare', tier: 2, damageMultiplier: 1.10, color: 0x3b8eea },
  epic: { id: 'epic', tier: 3, damageMultiplier: 1.16, color: 0xb14ce8 },
  legendary: { id: 'legendary', tier: 4, damageMultiplier: 1.22, color: 0xe8a33b }
});

export const RARITY_ORDER = Object.freeze(['common', 'uncommon', 'rare', 'epic', 'legendary']);

/** Damage falloff stops, hitscan classes — §5.5. [distance m, multiplier] */
export const FALLOFF_CURVE = Object.freeze([
  [0, 1.0], [35, 1.0], [60, 0.80], [90, 0.65]
]);

/** Weapon definitions at Common rarity — §5.3, §5.4, §5.5, §5.6 */
export const WEAPONS = Object.freeze({
  assaultRifle: {
    id: 'assaultRifle', name: 'Assault Rifle', ammo: 'medium',
    damage: 30, fireRate: 5.5, magazine: 30, reloadTime: 2.3,
    structureDamage: 30, mode: 'hitscan', useFalloff: true,
    hipSpread: 3.2, adsSpread: 0.6, adsFov: 55, adsTime: 0.24,
    bloomPerShot: 0.45
  },
  smg: {
    id: 'smg', name: 'SMG', ammo: 'light',
    damage: 17, fireRate: 11.0, magazine: 30, reloadTime: 2.1,
    structureDamage: 17, mode: 'hitscan', useFalloff: true,
    hipSpread: 4.4, adsSpread: 1.4, adsFov: 62, adsTime: 0.18,
    bloomPerShot: 0.30
  },
  pumpShotgun: {
    id: 'pumpShotgun', name: 'Pump Shotgun', ammo: 'shells',
    damage: 9, pellets: 10, fireRate: 0.75, magazine: 5, reloadTime: 4.5,
    structureDamage: 100, mode: 'pellets', useFalloff: false,
    coneHalfAngle: 4.5, adsConeScale: 0.7, adsFov: 65, adsTime: 0.28,
    pelletFalloff: [[0, 1.0], [8, 1.0], [22, 0.55], [1000, 0.35]]
  },
  tacticalShotgun: {
    id: 'tacticalShotgun', name: 'Tactical Shotgun', ammo: 'shells',
    damage: 6, pellets: 10, fireRate: 1.6, magazine: 8, reloadTime: 3.6,
    structureDamage: 80, mode: 'pellets', useFalloff: false,
    coneHalfAngle: 6.0, adsConeScale: 0.7, adsFov: 65, adsTime: 0.28,
    pelletFalloff: [[0, 1.0], [6, 1.0], [18, 0.5], [1000, 0.3]]
  },
  boltSniper: {
    id: 'boltSniper', name: 'Bolt Sniper', ammo: 'heavy',
    damage: 105, fireRate: 0.55, magazine: 1, reloadTime: 2.8,
    structureDamage: 125, mode: 'hitscan', useFalloff: false,
    hipSpread: 12.0, adsSpread: 0.0, adsFov: 28, adsTime: 0.40,
    bloomPerShot: 0
  },
  pistol: {
    id: 'pistol', name: 'Pistol', ammo: 'light',
    damage: 24, fireRate: 6.75, magazine: 16, reloadTime: 1.5,
    structureDamage: 24, mode: 'hitscan', useFalloff: true,
    hipSpread: 2.8, adsSpread: 0.5, adsFov: 58, adsTime: 0.20,
    bloomPerShot: 0.35
  },
  rocketLauncher: {
    id: 'rocketLauncher', name: 'Rocket Launcher', ammo: 'rockets',
    damage: 100, splashDamage: 75, splashRadius: 4.5,
    fireRate: 0.6, magazine: 1, reloadTime: 3.2,
    structureDamage: 400, mode: 'projectile', projectileSpeed: 45, useFalloff: false,
    hipSpread: 1.5, adsSpread: 0.4, adsFov: 60, adsTime: 0.35,
    bloomPerShot: 0
  }
});

/** Spread growth — §5.5 */
export const SPREAD = Object.freeze({
  bloomCap: 8,
  bloomDecayPerSecond: 9,
  bloomDecayDelay: 0.25,
  movementPenaltyPerWalkSpeed: 0.55,
  airborneMultiplier: 2,
  crouchMultiplier: 0.75,
  shotgunJitterFraction: 0.15 // §5.6
});

/* ── Inventory — MASTER_SPEC §5.7 ──────────────────────────────────────────── */
export const INVENTORY = Object.freeze({
  slots: 6,
  toolSlot: 0,
  switchTime: 0.25,
  pickupHoldTime: 0.4,
  stackSizes: { light: 999, medium: 999, heavy: 999, shells: 60, rockets: 12 }
});

/* ── Consumables — MASTER_SPEC §5.8 ────────────────────────────────────────── */
export const CONSUMABLES = Object.freeze({
  bandage: { id: 'bandage', useTime: 3.0, health: 15, healthCap: 75, stack: 5 },
  medkit: { id: 'medkit', useTime: 8.0, health: 100, healthCap: 100, stack: 3 },
  smallShield: { id: 'smallShield', useTime: 2.0, shield: 25, shieldCap: 50, stack: 6 },
  shieldPotion: { id: 'shieldPotion', useTime: 5.0, shield: 50, shieldCap: 100, stack: 3 }
});

/* ── Building — MASTER_SPEC §6 ─────────────────────────────────────────────── */
export const BUILD = Object.freeze({
  tileSize: 5.12,
  wallHeight: 3.84,
  thickness: 0.20,
  cost: 10,
  placementRange: 12.0,
  minPlacementInterval: 0.10,
  turboPlacementInterval: 0.15,
  supportGraceTime: 0.35,
  ceilingY: 260 // MAP_SPEC §3.4
});

export const PIECE_TYPES = Object.freeze(['wall', 'floor', 'ramp', 'cone']);
export const DIRECTIONS = Object.freeze(['north', 'east', 'south', 'west']);

/* ── Editing — MASTER_SPEC §7.2 ────────────────────────────────────────────── */
export const EDIT = Object.freeze({
  range: 8.0,
  enterTime: 0.10,
  confirmTime: 0.10,
  maxFlowTime: 0.25 // design ceiling, asserted by tests
});

/* ── Loot — MASTER_SPEC §8.2 ───────────────────────────────────────────────── */
export const LOOT_RARITY_WEIGHTS = Object.freeze({
  floor: { common: 45, uncommon: 32, rare: 16, epic: 5.5, legendary: 1.5 },
  chest: { common: 18, uncommon: 34, rare: 30, epic: 14, legendary: 4 }
});

/** Weapon class weights by POI tier — MAP_SPEC §6.3 */
export const LOOT_CLASS_WEIGHTS = Object.freeze({
  major:    { assaultRifle: 24, smg: 20, pumpShotgun: 13, tacticalShotgun: 13, pistol: 12, boltSniper: 11, rocketLauncher: 7 },
  minor:    { assaultRifle: 24, smg: 21, pumpShotgun: 13, tacticalShotgun: 13, pistol: 14, boltSniper: 10, rocketLauncher: 5 },
  landmark: { assaultRifle: 26, smg: 22, pumpShotgun: 12, tacticalShotgun: 12, pistol: 18, boltSniper: 8, rocketLauncher: 2 },
  outside:  { assaultRifle: 26, smg: 22, pumpShotgun: 12, tacticalShotgun: 12, pistol: 19, boltSniper: 8, rocketLauncher: 1 }
});

/** Spawn-point roll chances — MAP_SPEC §6.2 */
export const LOOT_SPAWN_CHANCE = Object.freeze({
  chest: 0.60, floor: 0.75, ammoBox: 0.55, outsideProp: 0.35
});

/* ── Match flow — MASTER_SPEC §9 ───────────────────────────────────────────── */
export const STORM_PHASES = Object.freeze([
  { phase: 1, wait: 180, shrink: 120, radiusFraction: 0.60, dps: 1 },
  { phase: 2, wait: 120, shrink: 100, radiusFraction: 0.45, dps: 1 },
  { phase: 3, wait: 100, shrink: 90, radiusFraction: 0.33, dps: 2 },
  { phase: 4, wait: 90, shrink: 80, radiusFraction: 0.24, dps: 3 },
  { phase: 5, wait: 75, shrink: 70, radiusFraction: 0.17, dps: 5 },
  { phase: 6, wait: 60, shrink: 60, radiusFraction: 0.11, dps: 7 },
  { phase: 7, wait: 45, shrink: 45, radiusFraction: 0.06, dps: 10 },
  { phase: 8, wait: 30, shrink: 60, radiusFraction: 0.00, dps: 10 }
]);

export const MATCH = Object.freeze({
  dropDuration: 45,
  stormTickInterval: 1.0
});

/* ── World — MAP_SPEC §2, §3, §7, §8, §9 ───────────────────────────────────── */
export const WORLD = Object.freeze({
  name: 'Cinder Isle',
  playableExtent: 2048,
  worldExtent: 2560,
  heightmapResolution: 1025,
  seaLevel: 0,
  minHeight: -8,
  maxHeight: 190,
  killFloorY: -40,
  oceanDps: 10,
  swimDepth: 1.2,
  initialSafeRadius: 980,
  initialCentreJitter: 180,
  chunkSize: 128,
  chunkLodDistances: [200, 450, 800],
  propLoadRadius: 500,
  propUnloadRadius: 650,
  buildCullDistance: 300,
  terrainDrawDistance: 1400
});

/** Procedural terrain fallback — MAP_SPEC §4.1 */
export const TERRAIN_NOISE = Object.freeze({
  falloffRadius: 1100,
  base: { octaves: 5, frequency: 1 / 512, lacunarity: 2.0, gain: 0.5, amplitude: 120 },
  ridge: { octaves: 3, frequency: 1 / 256, lacunarity: 2.0, gain: 0.5, amplitude: 60 },
  detail: { octaves: 3, frequency: 1 / 64, lacunarity: 2.0, gain: 0.5, amplitude: 4 },
  poiBlendSkirt: 24
});

/** Drop path — MAP_SPEC §7 */
export const DROP = Object.freeze({
  pathRadius: 1300,
  altitude: 600,
  glideSpeed: 26,
  glideDescent: 22,
  diveDescent: 55,
  diveSpeed: 34,
  autoDeployHeight: 60
});

/* ── Input defaults — MASTER_SPEC §11.3 ────────────────────────────────────── */
export const DEFAULT_BINDINGS = Object.freeze({
  moveForward: 'KeyW', moveBack: 'KeyS', moveLeft: 'KeyA', moveRight: 'KeyD',
  jump: 'Space', sprint: 'ShiftLeft', crouch: 'ControlLeft',
  fire: 'Mouse0', ads: 'Mouse2', reload: 'KeyR',
  slot0: 'Digit1', slot1: 'Digit2', slot2: 'Digit3',
  slot3: 'Digit4', slot4: 'Digit5', slot5: 'Digit6',
  buildWall: 'F1', buildFloor: 'F2', buildRamp: 'F3', buildCone: 'F4',
  toggleBuild: 'KeyQ', cycleMaterial: 'F5',
  edit: 'KeyG', rotate: 'KeyR', interact: 'KeyE', map: 'KeyM'
});

/* ── Performance budget — MASTER_SPEC §11.2 ────────────────────────────────── */
export const BUDGET = Object.freeze({
  frameTimeMs: 16.6,
  simulationMs: 4,
  maxDrawCalls: 1200,
  maxBuildPieces: 6000,
  maxTriangles: 2_500_000
});
