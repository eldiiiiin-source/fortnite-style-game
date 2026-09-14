/**
 * ToolDefinitions.js — SKIN_SPEC §11.
 *
 * The harvesting-tool roster. Same idea as `SkinDefinitions.js`: a tool is DATA — a head
 * form, a haft style and a palette — and `ToolRig.js` turns it into the part list that
 * both the 3D view and the 2D preview consume.
 *
 * ORIGINALITY: every name, form and palette here is this project's own.
 *
 * A tool carries NO gameplay field. Damage, swing rate, range and harvesting rules live in
 * `PICKAXE` in Config and are identical whichever tool is equipped (ITEM_SHOP_SPEC §4.4) —
 * there is nowhere in this shape to put a number that could change them.
 */

/** Head forms — SKIN_SPEC §11.2. Each is a distinct silhouette, not a recolour. */
export const HeadForm = Object.freeze({
  WEDGE: 'wedge',        // plain issue pick
  CHISEL: 'chisel',      // flat quarry bit
  LEAF: 'leaf',          // tapered blade
  HOOK: 'hook',          // curved sea hook
  SPLIT: 'split',        // twin-tine fork
  BEAM: 'beam',          // energy edge
  SCRAP: 'scrap'         // welded plate, bolted, asymmetric
});

/** Haft styles — SKIN_SPEC §11.3. */
export const HaftStyle = Object.freeze({
  STRAIGHT: 'straight',
  WRAPPED: 'wrapped',
  PIPE: 'pipe',
  SALVAGE: 'salvage'
});

const tool = (id, def) => Object.freeze({
  id,
  name: def.name,
  rarity: def.rarity,
  theme: def.theme,
  description: def.description,
  head: def.head,
  haft: def.haft ?? HaftStyle.STRAIGHT,
  /** Bolts, rivets and hanging scrap — the details that make a form read as built. */
  details: Object.freeze([...(def.details ?? [])].sort()),
  /**
   * Head size against the roster default (SKIN_SPEC §11.3.1). A VIEW value only: reach,
   * damage and swing rate live in PICKAXE and are identical for every tool.
   */
  headScale: def.headScale ?? 1,
  palette: Object.freeze({ ...def.palette }),
  pricePosition: def.pricePosition ?? 0.5,
  set: def.set ?? null,
  tags: Object.freeze(def.tags ?? [])
});

/** Tool detail features — SKIN_SPEC §11.4. */
export const ToolDetail = Object.freeze({
  BOLTS: 'bolts',
  BINDING: 'binding',
  COUNTERWEIGHT: 'counterweight',
  SPIKES: 'spikes',
  RAGS: 'rags',
  GLOW_EDGE: 'glowEdge',
  WELD_PLATES: 'weldPlates',
  CHAIN_LASH: 'chainLash'
});

const D = ToolDetail;

export const TOOLS = Object.freeze([
  tool('pickaxe_standard', {
    name: 'Standard Issue',
    rarity: 'common',
    theme: 'Issued kit',
    description: 'It does the job. That is the whole review.',
    head: HeadForm.WEDGE,
    haft: HaftStyle.STRAIGHT,
    details: [D.BOLTS],
    pricePosition: 0.1,
    palette: {
      primary: '#8d949e', secondary: '#6b7280', accent: '#cbd5e1',
      detail: '#3a3f47', edge: '#dfe6ee'
    }
  }),
  tool('pickaxe_quarry', {
    name: 'Quarry Bit',
    rarity: 'common',
    theme: 'Stone work',
    description: 'Worn smooth by a great deal of stone.',
    head: HeadForm.CHISEL,
    haft: HaftStyle.WRAPPED,
    details: [D.BINDING],
    pricePosition: 0.7,
    palette: {
      primary: '#9a9285', secondary: '#7b7466', accent: '#c6bda9',
      detail: '#4a4338', edge: '#ddd6c6'
    }
  }),
  tool('pickaxe_splitleaf', {
    name: 'Splitleaf',
    rarity: 'uncommon',
    theme: 'Wildline',
    description: 'Shaped like a falling leaf, sharpened like nothing of the sort.',
    head: HeadForm.LEAF,
    haft: HaftStyle.WRAPPED,
    details: [D.BINDING, D.RAGS],
    pricePosition: 0.5,
    set: 'Wildline',
    palette: {
      primary: '#5f9a5a', secondary: '#3f7a45', accent: '#c2d36a',
      detail: '#2f4a2c', edge: '#d8eec0'
    }
  }),
  tool('pickaxe_tidebreak', {
    name: 'Tidebreak',
    rarity: 'rare',
    theme: 'Salt and iron',
    description: 'Salt-pitted, still sharp. The sea gave up first.',
    head: HeadForm.HOOK,
    haft: HaftStyle.STRAIGHT,
    details: [D.BINDING, D.COUNTERWEIGHT],
    pricePosition: 0.3,
    palette: {
      primary: '#4f93ad', secondary: '#2b6f8f', accent: '#8fd8ec',
      detail: '#1d3f4f', edge: '#dbf3fb'
    }
  }),
  tool('pickaxe_emberfall', {
    name: 'Emberfall',
    rarity: 'epic',
    theme: 'Banked fire',
    description: 'Still warm to the touch. It has been like that for weeks.',
    head: HeadForm.SPLIT,
    haft: HaftStyle.WRAPPED,
    details: [D.BINDING, D.GLOW_EDGE],
    pricePosition: 0.5,
    palette: {
      primary: '#a8522f', secondary: '#7a3a22', accent: '#ffb347',
      detail: '#3a1f16', edge: '#ffd9a8'
    }
  }),
  tool('pickaxe_lumen', {
    name: 'Lumen',
    rarity: 'legendary',
    theme: 'Cut light',
    description: 'Cuts a line of light, then cuts through it.',
    head: HeadForm.BEAM,
    haft: HaftStyle.PIPE,
    details: [D.GLOW_EDGE, D.COUNTERWEIGHT],
    pricePosition: 0.6,
    palette: {
      primary: '#3a7f96', secondary: '#1f6f8a', accent: '#9df2ff',
      detail: '#16323d', edge: '#d9fbff'
    }
  }),

  /* ── The signature tool — SKIN_SPEC §11.5 ────────────────────────────────
   * Built to sit beside the premium outfits: dense, asymmetric, unmistakably
   * hand-made. An original design — welded plate, bolted collar, hanging rag.
   */
  tool('pickaxe_scrapjaw', {
    name: 'Scrapjaw',
    rarity: 'epic',
    theme: 'Welded scrap',
    description: 'Four things that failed at their old jobs, welded into one that does not.',
    head: HeadForm.SCRAP,
    haft: HaftStyle.SALVAGE,
    details: [D.BOLTS, D.BINDING, D.SPIKES, D.RAGS, D.COUNTERWEIGHT,
      D.WELD_PLATES, D.CHAIN_LASH],
    // Oversized on purpose: a signature tool has to carry a shop card that a common one
    // does not (§11.3.1). View only — reach and damage are unchanged.
    headScale: 1.34,
    pricePosition: 0.75,
    tags: ['scrap'],
    palette: {
      // Dark steel body, rust-red plate, worn bare metal at the edge. The rust is the
      // accent: enough of it to read as salvage, never enough to look painted.
      primary: '#4a525c', secondary: '#343b44', accent: '#a8412a',
      detail: '#241b14', edge: '#b9c2cc'
    }
  })
]);

const BY_ID = new Map(TOOLS.map((t) => [t.id, t]));

export function getTool(id) {
  return BY_ID.get(id) ?? null;
}

export const FALLBACK_TOOL = TOOLS[0];

export function toolOrFallback(id) {
  return BY_ID.get(id) ?? FALLBACK_TOOL;
}

export function toolRarityCounts() {
  const counts = {};
  for (const t of TOOLS) counts[t.rarity] = (counts[t.rarity] ?? 0) + 1;
  return counts;
}
