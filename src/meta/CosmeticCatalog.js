/**
 * CosmeticCatalog.js — ITEM_SHOP_SPEC §4, §9.
 *
 * Data-driven catalog. §9 forbids hard-coding shop items inside UI components, so this is
 * the single source and every screen reads from it.
 *
 * All names, themes and IDs are ORIGINAL. Nothing here references any shipped game's
 * characters, names or branding.
 *
 * Cosmetics carry no gameplay fields by construction — there is nowhere in this shape to
 * put a damage or speed value, which is how §4.4's "visual only" rule is enforced rather
 * than merely stated.
 */
import { PRICE_BANDS } from './MetaConfig.js';
import { SKINS } from '../cosmetics/SkinDefinitions.js';
import { TOOLS } from '../cosmetics/ToolDefinitions.js';

export const CosmeticCategory = Object.freeze({
  OUTFIT: 'outfit',
  PICKAXE: 'pickaxe',
  GLIDER: 'glider',
  BACK_ACCESSORY: 'backAccessory',
  EMOTE: 'emote',
  WRAP: 'wrap'
});

export const CATEGORY_ORDER = Object.freeze([
  CosmeticCategory.OUTFIT,
  CosmeticCategory.PICKAXE,
  CosmeticCategory.GLIDER,
  CosmeticCategory.BACK_ACCESSORY,
  CosmeticCategory.EMOTE,
  CosmeticCategory.WRAP
]);

export const CATEGORY_LABELS = Object.freeze({
  outfit: 'Outfit',
  pickaxe: 'Harvesting Tool',
  glider: 'Glider',
  backAccessory: 'Back Accessory',
  emote: 'Emote',
  wrap: 'Wrap'
});

/**
 * Price within the rarity band, chosen by a stable per-item position so prices are
 * deterministic and never drift between sessions.
 * @param {string} rarity
 * @param {number} position 0..1 within the band
 */
function priceFor(rarity, position = 0.5) {
  const [low, high] = PRICE_BANDS[rarity] ?? PRICE_BANDS.common;
  // Round to the nearest 50 so prices read like prices.
  return Math.round((low + (high - low) * position) / 50) * 50;
}

/**
 * @param {string} id stable identifier — never renamed, since profiles store these
 */
const item = (id, name, category, rarity, description, position = 0.5, extra = {}) => Object.freeze({
  id,
  name,
  category,
  rarity,
  price: priceFor(rarity, position),
  description,
  /** Preview + gameplay asset references. Placeholder-friendly: colour-driven for now. */
  preview: { kind: 'placeholder', palette: extra.palette ?? ['#8892a0', '#cfd8e3'] },
  asset: extra.asset ?? null,
  shopEligible: extra.shopEligible ?? true,
  enabled: extra.enabled ?? true,
  set: extra.set ?? null,
  tags: Object.freeze(extra.tags ?? [])
});

const O = CosmeticCategory.OUTFIT;
const P = CosmeticCategory.PICKAXE;
const G = CosmeticCategory.GLIDER;
const B = CosmeticCategory.BACK_ACCESSORY;
const E = CosmeticCategory.EMOTE;
const W = CosmeticCategory.WRAP;

/**
 * Outfits are generated from the skin roster (SKIN_SPEC §7) rather than declared here.
 * The roster owns a skin's appearance — build, palette roles, silhouette features — and
 * this catalog owns its commerce: price, shop eligibility, ownership. Declaring outfits in
 * both places is exactly how the two drift apart, so only one place declares them.
 */
const OUTFITS = SKINS.map((skin) => item(
  skin.id, skin.name, O, skin.rarity, skin.description, skin.pricePosition, {
    // `palette` stays a two-colour pair for the generic preview paths; anything drawing a
    // character reads the full role map off the skin itself.
    palette: [skin.palette.primary, skin.palette.secondary],
    set: skin.set,
    tags: [...skin.tags, skin.theme.toLowerCase()]
  }
));

/**
 * Harvesting tools come from the tool roster (SKIN_SPEC §11), for the same reason outfits
 * come from the skin roster: appearance is declared once, commerce is declared here.
 */
const PICKAXES = TOOLS.map((t) => item(
  t.id, t.name, P, t.rarity, t.description, t.pricePosition, {
    palette: [t.palette.primary, t.palette.accent],
    set: t.set,
    tags: [...t.tags, t.theme.toLowerCase()]
  }
));

/** 6 gliders */
const GLIDERS = [
  item('glider_canvas', 'Canvas', G, 'common', 'Plain cloth, honest descent.', 0.3, { palette: ['#8d8578', '#ddd5c6'] }),
  item('glider_kite', 'Paper Kite', G, 'common', 'Lighter than it looks.', 0.8, { palette: ['#a8623f', '#f0c3a2'] }),
  item('glider_stormsail', 'Stormsail', G, 'uncommon', 'Cut for rough air.', 0.6, { palette: ['#3c4f6b', '#9fb6d8'] }),
  item('glider_wildline', 'Wildline', G, 'rare', 'Leaf-veined and quiet.', 0.5, { palette: ['#3f5a3a', '#a4c79a'], set: 'Wildline' }),
  item('glider_nightvane', 'Nightvane Wing', G, 'epic', 'Folds into nothing.', 0.4, { palette: ['#2e2a4a', '#9a8ee0'] }),
  item('glider_solane', 'Solane', G, 'legendary', 'Catches more than wind.', 0.8, { palette: ['#8a6a1f', '#ffe49a'] })
];

/** 5 back accessories */
const BACK_ACCESSORIES = [
  item('back_fieldpack', 'Field Pack', B, 'common', 'Everything you need, nothing you do not.', 0.4, { palette: ['#6b6357', '#b6ab98'] }),
  item('back_surveyor', 'Surveyor Case', B, 'uncommon', 'Charts for a map that keeps changing.', 0.5, { palette: ['#4a6b5a', '#a2cbb6'] }),
  item('back_tidecan', 'Tide Canister', B, 'rare', 'Sealed against salt water.', 0.5, { palette: ['#2b6f8f', '#8fd8ec'] }),
  item('back_emberlantern', 'Ember Lantern', B, 'epic', 'Never quite goes out.', 0.5, { palette: ['#8f3f2b', '#ffb27a'] }),
  item('back_aurelianwing', 'Aurelian Crest', B, 'legendary', 'Worn by whoever is left.', 0.6, { palette: ['#8a6a1f', '#ffe49a'] })
];

/** 8 emotes */
const EMOTES = [
  item('emote_wave', 'Wave', E, 'common', 'A simple hello.', 0.1, { palette: ['#6b7280', '#cbd5e1'] }),
  item('emote_salute', 'Salute', E, 'common', 'Respect, briefly.', 0.4, { palette: ['#5a6b7c', '#b8c6d4'] }),
  item('emote_sitdown', 'Take Five', E, 'common', 'The circle can wait.', 0.8, { palette: ['#7b7466', '#ccc3af'] }),
  item('emote_flex', 'Flex', E, 'uncommon', 'Earned or not.', 0.3, { palette: ['#8f6a2b', '#e6c286'] }),
  item('emote_pointup', 'Skyward', E, 'uncommon', 'Look up.', 0.7, { palette: ['#2b6f8f', '#9fd8ec'] }),
  item('emote_spin', 'Spin Out', E, 'rare', 'One full rotation.', 0.5, { palette: ['#3f5a3a', '#a4c79a'] }),
  item('emote_dropbeat', 'Drop Beat', E, 'epic', 'Bring your own rhythm.', 0.4, { palette: ['#2e2a4a', '#a396f0'] }),
  item('emote_victorylap', 'Victory Lap', E, 'legendary', 'Save it for the end.', 0.7, { palette: ['#8a6a1f', '#ffe49a'] })
];

/** 6 wraps */
const WRAPS = [
  item('wrap_matte', 'Matte', W, 'common', 'No shine, no tell.', 0.2, { palette: ['#3a3f47', '#6b7280'] }),
  item('wrap_dust', 'Dust', W, 'common', 'Field-worn finish.', 0.7, { palette: ['#8d8578', '#c9c0af'] }),
  item('wrap_signalgreen', 'Signal Green', W, 'uncommon', 'Hard to miss.', 0.5, { palette: ['#2f9e6e', '#7ee3b0'] }),
  item('wrap_tideglass', 'Tideglass', W, 'rare', 'Depth in the finish.', 0.5, { palette: ['#2b6f8f', '#8fd8ec'] }),
  item('wrap_emberflow', 'Emberflow', W, 'epic', 'Moves when you do.', 0.5, { palette: ['#8f3f2b', '#ffb27a'] }),
  item('wrap_aurelian', 'Aurelian Leaf', W, 'legendary', 'Gold, applied sparingly.', 0.6, { palette: ['#8a6a1f', '#ffe49a'] })
];

/** The full catalog, frozen. */
export const COSMETICS = Object.freeze([
  ...OUTFITS, ...PICKAXES, ...GLIDERS, ...BACK_ACCESSORIES, ...EMOTES, ...WRAPS
]);

const BY_ID = new Map(COSMETICS.map((c) => [c.id, c]));

export function getCosmetic(id) {
  return BY_ID.get(id) ?? null;
}

export function cosmeticsByCategory(category) {
  return COSMETICS.filter((c) => c.category === category);
}

export function shopEligible() {
  return COSMETICS.filter((c) => c.shopEligible && c.enabled);
}

/** §9.1 — granted and equipped on first launch. */
export const STARTER_COSMETICS = Object.freeze([
  'outfit_recruit', 'outfit_drifter',
  'pickaxe_standard', 'pickaxe_quarry',
  'glider_canvas', 'glider_kite',
  'back_fieldpack',
  'emote_wave', 'emote_salute',
  'wrap_matte', 'wrap_dust'
]);

/** The default equipped set — one per gameplay-visible category. */
export const DEFAULT_EQUIPPED = Object.freeze({
  outfit: 'outfit_recruit',
  pickaxe: 'pickaxe_standard',
  glider: 'glider_canvas',
  backAccessory: 'back_fieldpack',
  emote: 'emote_wave',
  wrap: 'wrap_matte'
});

/** Catalog counts, asserted by test against the §9.2 target. */
export function catalogCounts() {
  const counts = {};
  for (const c of COSMETICS) counts[c.category] = (counts[c.category] ?? 0) + 1;
  return counts;
}
