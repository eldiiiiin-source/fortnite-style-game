/**
 * SkinDefinitions.js — SKIN_SPEC §4, §5, §6, §7.
 *
 * The outfit roster. Every entry is DATA: a build archetype, a palette role map and a list
 * of silhouette features. `CharacterRig.js` turns that into geometry; the 3D character and
 * the 2D preview both consume the rig, so a skin is described exactly once (§3.1).
 *
 * ORIGINALITY (SKIN_SPEC preamble): every name, palette, theme and silhouette here is this
 * project's own. Nothing reproduces any shipped game's characters, outfits or branding.
 *
 * There is nowhere in this shape to put a gameplay value — no damage, speed, health or
 * hitbox field exists — which is how ITEM_SHOP_SPEC §4.4 is enforced structurally rather
 * than by review.
 */

/** Build archetypes — SKIN_SPEC §5. Keys match CHARACTER.builds in Config. */
export const Build = Object.freeze({
  LEAN: 'lean',
  ATHLETIC: 'athletic',
  HEAVY: 'heavy',
  STOUT: 'stout'
});

/** Palette roles — SKIN_SPEC §4. Every skin declares all seven. */
export const PALETTE_ROLES = Object.freeze([
  'primary', 'secondary', 'accent', 'skin', 'hair', 'detail', 'visor'
]);

/** Silhouette features — SKIN_SPEC §6. The rig knows how to build each of these. */
export const Feature = Object.freeze({
  HOOD: 'hood',
  HELMET: 'helmet',
  VISOR_BAND: 'visorBand',
  GOGGLES: 'goggles',
  PONYTAIL: 'ponytail',
  LONG_HAIR: 'longHair',
  HAIR_TUFT: 'hairTuft',
  EAR_PUFFS: 'earPuffs',
  MASCOT_HEAD: 'mascotHead',
  SHOULDER_PADS: 'shoulderPads',
  PLATE_CARRIER: 'plateCarrier',
  CHEST_RIG: 'chestRig',
  SCARF: 'scarf',
  CAPE: 'cape',
  HEM_SKIRT: 'hemSkirt',
  TATTERED_HEM: 'tatteredHem',
  SHIN_GUARDS: 'shinGuards',
  BRACERS: 'bracers',
  BACK_TANK: 'backTank',
  SPINE_FIN: 'spineFin',
  ANTENNA: 'antenna',
  STITCH_SEAMS: 'stitchSeams',

  /* Operator kit — SKIN_SPEC §6.1 */
  AVIATOR_CAP: 'aviatorCap',
  BROW_GOGGLES: 'browGoggles',
  HEAD_WRAP: 'headWrap',
  TANK_TOP: 'tankTop',
  FINGERLESS_GLOVES: 'fingerlessGloves',
  THIGH_RIG: 'thighRig',
  KNEE_PADS: 'kneePads',
  COMBAT_BOOTS: 'combatBoots',
  UTILITY_BELT: 'utilityBelt',
  SHOULDER_STRAP: 'shoulderStrap',
  NECK_WRAP: 'neckWrap',
  FACE_MARKINGS: 'faceMarkings',
  SKULL_MASK: 'skullMask',
  BONE_PATTERN: 'bonePattern'
});

const F = Feature;

/**
 * @param {string} id      permanent — profiles store this (ITEM_SHOP_SPEC §4.2)
 * @param {object} def
 */
const skin = (id, def) => Object.freeze({
  id,
  name: def.name,
  rarity: def.rarity,
  theme: def.theme,
  description: def.description,
  build: def.build,
  features: Object.freeze([...def.features].sort()),
  palette: Object.freeze({ ...def.palette }),
  /** Position within the rarity's price band, 0..1 (ITEM_SHOP_SPEC §9.3). */
  pricePosition: def.pricePosition ?? 0.5,
  set: def.set ?? null,
  tags: Object.freeze(def.tags ?? [])
});

/* ── The founding eight — SKIN_SPEC §7.1 ─────────────────────────────────────
 * Carried over from the launch catalog with their IDs intact, now rigged rather than
 * recoloured. A player who owned Recruit still owns Recruit.
 */

const FOUNDING = [
  skin('outfit_recruit', {
    name: 'Recruit',
    rarity: 'common',
    theme: 'Standard issue',
    description: 'Field gear off the rack. Everyone starts here.',
    build: Build.ATHLETIC,
    features: [F.CHEST_RIG, F.BRACERS],
    pricePosition: 0.2,
    palette: {
      primary: '#5c6472', secondary: '#7f8896', accent: '#e0a33c',
      skin: '#d8a077', hair: '#4a3a2c', detail: '#2f353f', visor: '#cfd8e3'
    }
  }),
  skin('outfit_drifter', {
    name: 'Drifter',
    rarity: 'common',
    theme: 'Long road',
    description: 'Travelled light. Travelled far. Still going.',
    build: Build.LEAN,
    features: [F.HAIR_TUFT, F.SCARF],
    pricePosition: 0.6,
    palette: {
      primary: '#8a6f4e', secondary: '#b99a6d', accent: '#cf6b3f',
      skin: '#c98c60', hair: '#3b2c22', detail: '#4a3a2a', visor: '#e8dcc4'
    }
  }),
  skin('outfit_signal', {
    name: 'Signal',
    rarity: 'uncommon',
    theme: 'Work crew',
    description: 'High-visibility gear for distinctly low-visibility work.',
    build: Build.ATHLETIC,
    features: [F.HELMET, F.SHOULDER_PADS, F.SHIN_GUARDS],
    pricePosition: 0.3,
    palette: {
      primary: '#2f9e6e', secondary: '#7ee3b0', accent: '#ffd23f',
      skin: '#e0b088', hair: '#2b2118', detail: '#24352c', visor: '#eaf7f0'
    }
  }),
  skin('outfit_tidewatch', {
    name: 'Tidewatch',
    rarity: 'uncommon',
    theme: 'Coastal patrol',
    description: 'Patrol colours, salt-faded at the cuffs.',
    build: Build.ATHLETIC,
    features: [F.HOOD, F.CAPE, F.BRACERS],
    pricePosition: 0.8,
    palette: {
      primary: '#2b6f8f', secondary: '#79c3dd', accent: '#f2f7fa',
      skin: '#c98c60', hair: '#23303a', detail: '#17384a', visor: '#b8e8f7'
    }
  }),
  skin('outfit_ironleaf', {
    name: 'Ironleaf',
    rarity: 'rare',
    theme: 'Forest plating',
    description: 'Plated in the shape of leaves. Quiet step regardless.',
    build: Build.HEAVY,
    features: [F.SHOULDER_PADS, F.BRACERS, F.SHIN_GUARDS],
    pricePosition: 0.4,
    set: 'Wildline',
    palette: {
      primary: '#3f5a3a', secondary: '#8fb083', accent: '#c2d36a',
      skin: '#d0a37e', hair: '#32251b', detail: '#26332a', visor: '#dff0cf'
    }
  }),
  skin('outfit_emberkin', {
    name: 'Emberkin',
    rarity: 'rare',
    theme: 'Banked fire',
    description: 'Carries a little warmth on the outside, where it helps.',
    build: Build.ATHLETIC,
    features: [F.HAIR_TUFT, F.SHOULDER_PADS, F.BACK_TANK],
    pricePosition: 0.9,
    palette: {
      primary: '#8f3f2b', secondary: '#e0875f', accent: '#ffb347',
      skin: '#d89a6a', hair: '#2f1c14', detail: '#3a1f16', visor: '#ffd9a8'
    }
  }),
  skin('outfit_nightvane', {
    name: 'Nightvane',
    rarity: 'epic',
    theme: 'Final circle',
    description: 'Built for the part of the match nobody plans for.',
    build: Build.LEAN,
    features: [F.HOOD, F.CAPE, F.VISOR_BAND],
    pricePosition: 0.5,
    palette: {
      primary: '#2e2a4a', secondary: '#8b7fd4', accent: '#c8a4ff',
      skin: '#b98a6a', hair: '#1a1730', detail: '#1b1830', visor: '#b9a6ff'
    }
  }),
  skin('outfit_aurelian', {
    name: 'Aurelian',
    rarity: 'legendary',
    theme: 'Gilded champion',
    description: 'Gilded, and earned. Mostly earned.',
    build: Build.HEAVY,
    features: [F.HELMET, F.SHOULDER_PADS, F.CAPE, F.HEM_SKIRT],
    pricePosition: 0.7,
    palette: {
      primary: '#8a6a1f', secondary: '#f0cf72', accent: '#fff3c0',
      skin: '#d8a077', hair: '#3a2a12', detail: '#4a3a14', visor: '#fff6d8'
    }
  })
];

/* ── The new eight — SKIN_SPEC §7.2 ──────────────────────────────────────────
 * Each one leads with a silhouette hook: something you can recognise as a black shape
 * across a field before any colour resolves.
 */

const EXPANSION = [
  skin('outfit_dunewake', {
    name: 'Dunewake',
    rarity: 'common',
    theme: 'Desert drifter',
    description: 'Wrapped against the grit, with a tail of cloth that never sits still.',
    build: Build.LEAN,
    features: [F.SCARF, F.GOGGLES, F.BRACERS],
    pricePosition: 0.45,
    palette: {
      primary: '#c8a879', secondary: '#e2cfa6', accent: '#d9543f',
      skin: '#a86b45', hair: '#2e2218', detail: '#6b5436', visor: '#7fd4e8'
    }
  }),
  skin('outfit_voltrun', {
    name: 'Voltrun',
    rarity: 'uncommon',
    theme: 'Sport, bright',
    description: 'Track colours, high ponytail, no intention of standing still.',
    build: Build.LEAN,
    features: [F.PONYTAIL, F.BRACERS, F.SHIN_GUARDS],
    pricePosition: 0.55,
    palette: {
      primary: '#18b5d8', secondary: '#f2f6f8', accent: '#ffe14d',
      skin: '#8c5a3c', hair: '#2a2f38', detail: '#172029', visor: '#ffffff'
    }
  }),
  skin('outfit_bramblejack', {
    name: 'Bramblejack',
    rarity: 'uncommon',
    theme: 'Feral woodland',
    description: 'Went into the treeline as a scout. Came out as something else.',
    build: Build.ATHLETIC,
    features: [F.HOOD, F.SPINE_FIN, F.TATTERED_HEM],
    pricePosition: 0.25,
    set: 'Wildline',
    palette: {
      primary: '#4a6b2f', secondary: '#86a84f', accent: '#e07a2f',
      skin: '#caa07a', hair: '#3a2a1e', detail: '#2b3320', visor: '#d7e8a8'
    }
  }),
  skin('outfit_greyline', {
    name: 'Greyline',
    rarity: 'rare',
    theme: 'Tactical urban',
    description: 'Hard plates, soft footsteps, nothing that rattles.',
    build: Build.ATHLETIC,
    features: [F.HELMET, F.VISOR_BAND, F.PLATE_CARRIER, F.SHIN_GUARDS],
    pricePosition: 0.55,
    palette: {
      primary: '#3c434d', secondary: '#5c6672', accent: '#e05a3a',
      skin: '#c98c60', hair: '#241f1c', detail: '#1d2228', visor: '#79e0d8'
    }
  }),
  skin('outfit_rustward', {
    name: 'Rustward',
    rarity: 'rare',
    theme: 'Rugged scavenger',
    description: 'Built entirely out of other things that stopped working.',
    build: Build.HEAVY,
    features: [F.HOOD, F.GOGGLES, F.BACK_TANK, F.TATTERED_HEM],
    pricePosition: 0.75,
    palette: {
      primary: '#7a5a3a', secondary: '#a8845c', accent: '#d9762f',
      skin: '#b9805a', hair: '#33251a', detail: '#3b2c1e', visor: '#9fe3c9'
    }
  }),
  skin('outfit_hexwilt', {
    name: 'Hexwilt',
    rarity: 'epic',
    theme: 'Spooky revenant',
    description: 'Stitched back together in a better colour scheme than the original.',
    build: Build.LEAN,
    features: [F.LONG_HAIR, F.HEM_SKIRT, F.TATTERED_HEM, F.STITCH_SEAMS],
    pricePosition: 0.65,
    tags: ['spooky'],
    palette: {
      primary: '#3a2f4f', secondary: '#6b5a86', accent: '#ff5fae',
      skin: '#b8e0cf', hair: '#2ee0c8', detail: '#241d33', visor: '#ff9ad4'
    }
  }),
  skin('outfit_sprocket', {
    name: 'Sprocket',
    rarity: 'epic',
    theme: 'Mascot',
    description: 'Contractually obligated to be delighted about all of this.',
    build: Build.STOUT,
    features: [F.MASCOT_HEAD, F.EAR_PUFFS, F.ANTENNA],
    pricePosition: 0.35,
    tags: ['mascot'],
    palette: {
      primary: '#ffb23f', secondary: '#fff0d0', accent: '#3fb6ff',
      skin: '#ffcf8f', hair: '#8a4f1f', detail: '#6b3a14', visor: '#2b2118'
    }
  }),
  skin('outfit_paleaxis', {
    name: 'Pale Axis',
    rarity: 'legendary',
    theme: 'Sleek futurist',
    description: 'Everything unnecessary has already been removed.',
    build: Build.LEAN,
    features: [F.VISOR_BAND, F.CAPE, F.SHOULDER_PADS, F.BRACERS],
    pricePosition: 0.85,
    palette: {
      primary: '#e8edf2', secondary: '#9aa8b8', accent: '#35f0d0',
      skin: '#c08f6a', hair: '#23272e', detail: '#2b3038', visor: '#35f0d0'
    }
  })
];

/* ── The signature four — SKIN_SPEC §7.3 ─────────────────────────────────────
 * The premium tier: denser kit, stronger colour identity, more silhouette per figure.
 * These carry the shop.
 *
 * Each was designed from a mood brief — a neon revenant, an elite aviator, a glowing
 * skeleton, a gold-trimmed operator — as ORIGINAL characters built from this project's
 * own rig, palette roles and feature vocabulary. They are not reproductions of any
 * existing game's characters, and share no names, markings or proportions with them.
 */

const SIGNATURE = [
  skin('outfit_vexbloom', {
    name: 'Vexbloom',
    rarity: 'epic',
    theme: 'Neon revenant',
    description: 'Came back wrong, came back brighter. No complaints so far.',
    build: Build.LEAN,
    features: [F.HEAD_WRAP, F.BROW_GOGGLES, F.TANK_TOP, F.FACE_MARKINGS, F.UTILITY_BELT],
    pricePosition: 0.8,
    tags: ['spooky', 'neon'],
    palette: {
      // Hot pink skin against cyan cloth: two saturated hues at opposite ends of the
      // wheel, with everything else pushed to neutral so they stay the whole story.
      primary: '#f4f6f8', secondary: '#39424f', accent: '#25dbe8',
      skin: '#ff6fb5', hair: '#25dbe8', detail: '#222a35', visor: '#ffd45e'
    }
  }),
  skin('outfit_goldspar', {
    name: 'Goldspar',
    rarity: 'legendary',
    theme: 'Elite aviator',
    description: 'Flies in, walks out. The gear has never needed explaining.',
    build: Build.LEAN,
    features: [
      F.AVIATOR_CAP, F.BROW_GOGGLES, F.TANK_TOP, F.FINGERLESS_GLOVES,
      F.THIGH_RIG, F.COMBAT_BOOTS
    ],
    pricePosition: 0.9,
    set: 'Gilded Vanguard',
    tags: ['operator'],
    palette: {
      // Matte black carries the mass; gold appears only at buckles, soles and trim,
      // which is what keeps it reading as expensive rather than as costume.
      primary: '#1a1d22', secondary: '#282c33', accent: '#e8b53a',
      skin: '#d29a6e', hair: '#3a2a1c', detail: '#101216', visor: '#f3dc92'
    }
  }),
  skin('outfit_voidmarrow', {
    name: 'Voidmarrow',
    rarity: 'legendary',
    theme: 'Glowing skeleton',
    description: 'Whatever is holding it together is doing so in violet.',
    build: Build.ATHLETIC,
    features: [F.SKULL_MASK, F.BONE_PATTERN, F.THIGH_RIG, F.KNEE_PADS, F.COMBAT_BOOTS],
    pricePosition: 0.95,
    tags: ['spooky', 'glow'],
    palette: {
      // Near-black base so the self-lit bones are the only thing the eye lands on.
      primary: '#14161c', secondary: '#1d2028', accent: '#a24cff',
      skin: '#8a5cd6', hair: '#14161c', detail: '#0c0e12', visor: '#d7b3ff'
    }
  }),
  skin('outfit_coalcrest', {
    name: 'Coalcrest',
    rarity: 'epic',
    theme: 'Gilded operator',
    description: 'Same colours as Goldspar, half the patience.',
    build: Build.HEAVY,
    features: [
      F.HELMET, F.NECK_WRAP, F.TANK_TOP, F.SHOULDER_STRAP, F.UTILITY_BELT, F.KNEE_PADS
    ],
    pricePosition: 0.85,
    set: 'Gilded Vanguard',
    tags: ['operator'],
    palette: {
      // The set's shared palette on a heavy frame: same colours, different mass, so the
      // pair reads as a matched set without either one looking like a recolour.
      primary: '#16191e', secondary: '#252931', accent: '#e8b53a',
      skin: '#8a5a3a', hair: '#1a1410', detail: '#0d0f13', visor: '#f3dc92'
    }
  })
];

/** The full roster, in catalog order. */
export const SKINS = Object.freeze([...FOUNDING, ...EXPANSION, ...SIGNATURE]);

const BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export function getSkin(id) {
  return BY_ID.get(id) ?? null;
}

/** The skin drawn when an outfit id is missing or unknown — never returns null. */
export const FALLBACK_SKIN = SKINS[0];

export function skinOrFallback(id) {
  return BY_ID.get(id) ?? FALLBACK_SKIN;
}

/** Roster counts by rarity, asserted against SKIN_SPEC §7.3. */
export function skinRarityCounts() {
  const counts = {};
  for (const s of SKINS) counts[s.rarity] = (counts[s.rarity] ?? 0) + 1;
  return counts;
}
