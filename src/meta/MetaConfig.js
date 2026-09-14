/**
 * MetaConfig.js — tunables for the meta layer: match flow, storm, drop, profile, shop
 * and admin. BATTLE_ROYALE_SPEC, ITEM_SHOP_SPEC, ADMIN_PANEL_SPEC.
 *
 * Kept separate from core/Config.js so the stable gameplay foundation is not disturbed by
 * meta-layer churn. Same rule applies within it: no magic numbers anywhere else.
 */
import { WORLD, TILE } from '../core/Config.js';

/* ══ DEV MODE — ADMIN_PANEL_SPEC §1 ══════════════════════════════════════════
 * The single gate for all developer tooling. Admin UI and commands only
 * initialise when this is true; with it false, nothing admin-related is reachable.
 *
 * Resolution order: an explicit override (tests), then Vite's import.meta.env.DEV,
 * then false. Defaulting to FALSE means a build that somehow loses the env flag ships
 * without admin tools rather than with them.
 */
function resolveDevMode() {
  if (globalThis.__FORCE_DEV_MODE__ !== undefined) return !!globalThis.__FORCE_DEV_MODE__;
  try {
    if (typeof import.meta !== 'undefined' && import.meta.env) return !!import.meta.env.DEV;
  } catch {
    // import.meta unavailable (plain Node); fall through.
  }
  return false;
}

export const DEV_MODE = resolveDevMode();

/** Re-resolve at call time. Tests flip __FORCE_DEV_MODE__ and re-query. */
export function isDevMode() {
  return resolveDevMode();
}

/* ══ MATCH — BATTLE_ROYALE_SPEC §3, §6 ═══════════════════════════════════════ */

export const MATCH = Object.freeze({
  botCount: 24,                 // §3 — 1 human + 24 bots = 25 participants
  maxBotCount: 50,              // §3 later target
  unsafeBotCount: 60,           // §7 admin warns beyond this
  startingHealth: 100,
  startingShield: 0,
  startingMaterials: 0,         // §6 — default 0, configurable
  emptyInventoryOnSpawn: true
});

/* ══ DROP — BATTLE_ROYALE_SPEC §5 ════════════════════════════════════════════ */

export const DROP = Object.freeze({
  /** Transport route, expressed against the region so it scales with map size. */
  routeMarginRatio: 0.25,       // how far outside the region the route starts/ends
  transportAltitude: TILE * 40, // 204.8 m
  transportSpeed: TILE * 8,     // 40.96 m/s
  routeDuration: 30,            // seconds of valid drop window

  /** Freefall — §5.2 */
  freefallDescent: 55,
  freefallSpeed: 34,
  freefallSteerAccel: 30,
  freefallAirControl: 0.85,

  /** Glider — §5.3 */
  gliderDescent: 12,
  gliderSpeed: 26,
  gliderSteerAccel: 18,
  gliderMinDeployAltitude: TILE * 2,   // 10.24 m above ground
  gliderAutoDeployAltitude: TILE * 6,  // 30.72 m — auto-deploy safety floor
  landingSpeedThreshold: 1.0,

  /** Bot landing selection — §5.4 */
  botLandingSpreadWeight: 0.6,
  botLandingRouteWeight: 0.3,
  botLandingLootWeight: 1.0
});

/* ══ STORM — BATTLE_ROYALE_SPEC §8 ═══════════════════════════════════════════
 *
 * §8.1 requires the initial radius to SCALE FROM MAP SIZE. The owner quotes 460 m for
 * an ~1024 m region, so it is stored as that ratio and every phase radius as a fraction
 * of the initial. Changing WORLD.regionExtent rescales the whole storm coherently, and
 * nothing needs editing.
 */
export const STORM_REFERENCE = Object.freeze({
  regionExtent: 1024,
  initialRadius: 460
});

/** 460 / 1024 = 0.44921875 */
export const STORM_INITIAL_RADIUS_RATIO =
  STORM_REFERENCE.initialRadius / STORM_REFERENCE.regionExtent;

/** Initial safe radius for the current region. */
export function initialSafeRadius(regionExtent = WORLD.regionExtent) {
  return regionExtent * STORM_INITIAL_RADIUS_RATIO;
}

/**
 * Phase table — BATTLE_ROYALE_SPEC §8.2, verbatim.
 * `radius` is the owner's metre value at the 1024 m reference; `radiusRatio` is that
 * value as a fraction of the initial radius, which is what the runtime actually uses.
 */
export const STORM_PHASES = Object.freeze([
  { phase: 0, name: 'Grace', wait: 90, shrink: 0, radius: 460, damage: 0 },
  { phase: 1, name: 'Phase 1', wait: 120, shrink: 90, radius: 330, damage: 1 },
  { phase: 2, name: 'Phase 2', wait: 90, shrink: 75, radius: 230, damage: 1 },
  { phase: 3, name: 'Phase 3', wait: 75, shrink: 60, radius: 150, damage: 2 },
  { phase: 4, name: 'Phase 4', wait: 60, shrink: 50, radius: 95, damage: 2 },
  { phase: 5, name: 'Phase 5', wait: 45, shrink: 40, radius: 55, damage: 5 },
  { phase: 6, name: 'Phase 6', wait: 30, shrink: 30, radius: 30, damage: 8 },
  { phase: 7, name: 'Phase 7', wait: 20, shrink: 25, radius: 12, damage: 10 },
  { phase: 8, name: 'Final', wait: 10, shrink: 20, radius: 0, damage: 15 }
].map((p) => Object.freeze({
  ...p,
  radiusRatio: p.radius / STORM_REFERENCE.initialRadius
})));

export const STORM = Object.freeze({
  damageTickInterval: 1.0,      // §8.3 — reliable accumulation, never frame-rate dependent
  bypassesShield: true,
  wallHeight: TILE * 30,        // visual storm wall height
  warningLeadTime: 15           // seconds before a shrink that the warning shows
});

/* ══ PROFILE / CURRENCY — ITEM_SHOP_SPEC §2, §3 ══════════════════════════════ */

export const PROFILE = Object.freeze({
  schemaVersion: 1,
  storageKey: 'profile.v1',     // distinct from settings.v1 so they cannot collide
  defaultDisplayName: 'Player',
  starterCurrency: 5000,
  currencyName: 'Credits'
});

/* ══ SHOP — ITEM_SHOP_SPEC §5 ════════════════════════════════════════════════ */

export const SHOP = Object.freeze({
  rotationPeriodHours: 24,
  rotationPeriodMs: 24 * 60 * 60 * 1000,
  featuredCount: 4,
  dailyCount: 6,
  /** §5.2 — avoid excessive repetition between adjacent rotations. */
  avoidRepeatWindow: 1
});

/** §9.3 price bands by rarity. */
export const PRICE_BANDS = Object.freeze({
  common: [300, 500],
  uncommon: [500, 800],
  rare: [800, 1200],
  epic: [1200, 1800],
  legendary: [1800, 2500]
});

/* ══ REWARDS — ITEM_SHOP_SPEC §11 ════════════════════════════════════════════ */

export const REWARDS = Object.freeze({
  enabled: true,                // admin may disable during testing
  matchCompletion: 50,
  elimination: 10,
  victoryBonus: 150
});

/* ══ BOT AI — BATTLE_ROYALE_SPEC §9, ADMIN_PANEL_SPEC §7.1 ═══════════════════ */

export const BOT_DIFFICULTY = Object.freeze({
  easy: {
    reactionTime: 0.85, accuracy: 0.35, aimError: 6.0, tracking: 0.35,
    aggression: 0.35, lootPriority: 0.6, buildFrequency: 0.15, healThreshold: 0.45
  },
  normal: {
    reactionTime: 0.45, accuracy: 0.55, aimError: 3.2, tracking: 0.6,
    aggression: 0.6, lootPriority: 0.8, buildFrequency: 0.35, healThreshold: 0.55
  },
  hard: {
    reactionTime: 0.22, accuracy: 0.75, aimError: 1.6, tracking: 0.85,
    aggression: 0.85, lootPriority: 0.95, buildFrequency: 0.6, healThreshold: 0.7
  },
  /** Dev-only, for testing hit registration. */
  debugPerfect: {
    reactionTime: 0.0, accuracy: 1.0, aimError: 0.0, tracking: 1.0,
    aggression: 1.0, lootPriority: 1.0, buildFrequency: 0.0, healThreshold: 0.9
  }
});

export const BOT = Object.freeze({
  defaultDifficulty: 'normal',
  sightRange: TILE * 24,
  attackRange: TILE * 14,
  lootSearchRange: TILE * 10,
  lootReachRange: TILE * 0.7,
  /** §9.7 — start rotating this many seconds before the storm would reach them. */
  rotationSafetyMargin: 12,
  /** §9.4 — weapon selection bands, in metres. */
  closeRange: TILE * 5,
  mediumRange: TILE * 14,
  /** §9.4 — minimum time between weapon switches, so bots do not thrash. */
  weaponSwitchCooldown: 2.5,
  /** §9.8 — limited building. */
  buildCooldown: 3.0,
  /** §17.1 — staggered AI by distance from the player. */
  lodNear: TILE * 20,
  lodMedium: TILE * 60,
  lodRates: { near: 1, medium: 3, far: 10 }   // update every N ticks
});

/* ══ ADMIN — ADMIN_PANEL_SPEC §1.2, §15 ═════════════════════════════════════ */

export const ADMIN = Object.freeze({
  toggleKey: 'F8',
  collisionDebugKey: 'F9',
  aiDebugKey: 'F10',
  performanceKey: 'F11',
  eventLogLimit: 100,
  // How far the event log walks into a payload before giving up (§15). Two levels
  // reach a piece's cell, which is the deepest detail worth logging.
  eventLogDepth: 2,
  quickBotCounts: [1, 5, 10, 25]
});

/** §5.1 test loadouts, data-driven. */
export const TEST_LOADOUTS = Object.freeze({
  closeRange: {
    name: 'Close Range',
    weapons: [['pumpShotgun', 'rare'], ['smg', 'rare']],
    consumables: ['medkit', 'largeShield']
  },
  rifleTest: {
    name: 'Rifle Test',
    weapons: [['assaultRifle', 'epic'], ['pistol', 'uncommon']],
    consumables: ['medkit']
  },
  fullTest: {
    name: 'Full Test',
    weapons: [['assaultRifle', 'legendary'], ['pumpShotgun', 'epic'], ['smg', 'epic'], ['boltSniper', 'legendary']],
    consumables: ['medkit']
  },
  buildTest: {
    name: 'Build Test',
    weapons: [['assaultRifle', 'common']],
    consumables: [],
    maxMaterials: true
  }
});
