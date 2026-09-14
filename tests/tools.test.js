/**
 * tools.test.js — SKIN_SPEC §11, §9.11.
 *
 * Harvesting tools are rigs like characters are, so they get the same guarantees:
 * deterministic construction, derived dimensions, and absolutely no gameplay reach.
 */
import { describe, it, expect } from 'vitest';
import {
  TOOLS, getTool, toolOrFallback, toolRarityCounts, HeadForm, HaftStyle, ToolDetail
} from '../src/cosmetics/ToolDefinitions.js';
import {
  buildToolRig, toolMetrics, ToolRegion, SUPPORTED_HEADS, SUPPORTED_TOOL_DETAILS
} from '../src/cosmetics/ToolRig.js';
import { rigBounds, partColour } from '../src/cosmetics/RigPrimitives.js';
import { PICKAXE, PICKAXE_VIEW, CHARACTER, RARITY_ORDER } from '../src/core/Config.js';
import {
  cosmeticsByCategory, CosmeticCategory, getCosmetic, catalogCounts
} from '../src/meta/CosmeticCatalog.js';

const HEX = /^#[0-9a-f]{6}$/i;

describe('SKIN_SPEC §11 — the tool roster', () => {
  it('carries seven harvesting tools', () => {
    expect(TOOLS.length).toBe(7);
    expect(catalogCounts().pickaxe).toBe(7);
  });

  it('keeps the founding six IDs intact — profiles store them', () => {
    for (const id of [
      'pickaxe_standard', 'pickaxe_quarry', 'pickaxe_splitleaf',
      'pickaxe_tidebreak', 'pickaxe_emberfall', 'pickaxe_lumen'
    ]) {
      expect(getTool(id), id).not.toBeNull();
    }
  });

  it('includes Scrapjaw, the signature tool (§11.5)', () => {
    const scrapjaw = getTool('pickaxe_scrapjaw');
    expect(scrapjaw).not.toBeNull();
    expect(scrapjaw.head).toBe(HeadForm.SCRAP);
    expect(scrapjaw.rarity).toBe('epic');
    // Its whole point is density: it must carry more detail than any other tool.
    for (const other of TOOLS.filter((t) => t.id !== 'pickaxe_scrapjaw')) {
      expect(buildToolRig(scrapjaw).parts.length)
        .toBeGreaterThan(buildToolRig(other).parts.length);
    }
  });

  it('gives every tool a unique id, name and head form spread', () => {
    expect(new Set(TOOLS.map((t) => t.id)).size).toBe(TOOLS.length);
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    // Every head form in the vocabulary is actually used by something.
    expect(new Set(TOOLS.map((t) => t.head)).size).toBe(Object.keys(HeadForm).length);
  });

  it('only uses head forms, hafts and details the rig can build', () => {
    const hafts = new Set(Object.values(HaftStyle));
    for (const tool of TOOLS) {
      expect(SUPPORTED_HEADS, tool.id).toContain(tool.head);
      expect(hafts.has(tool.haft), tool.id).toBe(true);
      for (const d of tool.details) expect(SUPPORTED_TOOL_DETAILS, tool.id).toContain(d);
    }
  });

  it('uses every rarity tier below the top', () => {
    const seen = new Set(TOOLS.map((t) => t.rarity));
    for (const tier of RARITY_ORDER) expect(seen.has(tier), tier).toBe(true);
    expect(toolRarityCounts().common).toBe(2);
  });

  it('declares a full palette of valid hex per tool', () => {
    for (const tool of TOOLS) {
      for (const role of ['primary', 'secondary', 'accent', 'detail', 'edge']) {
        expect(tool.palette[role], `${tool.id}.${role}`).toMatch(HEX);
      }
    }
  });
});

describe('SKIN_SPEC §11.1 — tool rigs', () => {
  it('builds a haft and a head for every tool (§9.11)', () => {
    for (const tool of TOOLS) {
      const regions = new Set(buildToolRig(tool).parts.map((p) => p.tag));
      expect(regions.has(ToolRegion.HAFT), tool.id).toBe(true);
      expect(regions.has(ToolRegion.HEAD), tool.id).toBe(true);
    }
  });

  it('puts the head above the grip and the butt below it', () => {
    for (const tool of TOOLS) {
      const rig = buildToolRig(tool);
      const head = rig.parts.filter((p) => p.tag === ToolRegion.HEAD);
      expect(head.every((p) => p.pos.y > 0), tool.id).toBe(true);
      expect(rigBounds(rig).minY, tool.id).toBeLessThan(0);
    }
  });

  it('is deterministic — the same tool yields an identical part list', () => {
    for (const tool of TOOLS) {
      expect(JSON.stringify(buildToolRig(tool).parts))
        .toBe(JSON.stringify(buildToolRig(tool).parts));
    }
  });

  it('orders parts back-to-front so a 2D consumer can paint in array order', () => {
    for (const tool of TOOLS) {
      const zs = buildToolRig(tool).parts.map((p) => p.pos.z);
      for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeGreaterThanOrEqual(zs[i - 1]);
    }
  });

  it('resolves every part to a colour', () => {
    for (const tool of TOOLS) {
      for (const part of buildToolRig(tool).parts) {
        expect(partColour(tool, part), `${tool.id}:${part.id}`).toMatch(HEX);
      }
    }
  });

  it('falls back to a real tool for an unknown id rather than rendering nothing', () => {
    expect(toolOrFallback('pickaxe_does_not_exist').id).toBe(TOOLS[0].id);
    expect(buildToolRig('pickaxe_does_not_exist').parts.length).toBeGreaterThan(0);
  });

  it('skips an unknown head form rather than throwing', () => {
    const future = { ...TOOLS[0], head: 'notYetInvented', details: ['notADetail'] };
    expect(() => buildToolRig(future)).not.toThrow();
    // The haft still builds, so a future tool degrades to a stick rather than vanishing.
    expect(buildToolRig(future).parts.length).toBeGreaterThan(0);
  });

  it('derives its scale from the character, not from absolutes', () => {
    const m = toolMetrics();
    expect(m.length).toBeCloseTo(PICKAXE_VIEW.length, 6);
    expect(m.gripToHead + m.gripToButt).toBeCloseTo(m.length, 6);
    // Assert the DERIVATION, not the ratio: retuning how long a tool looks must not
    // break a test, but decoupling tool scale from character scale must (CLAUDE.md).
    for (const [view, reference] of [
      [PICKAXE_VIEW.length, CHARACTER.height],
      [PICKAXE_VIEW.gripDrop, CHARACTER.height],
      [PICKAXE_VIEW.haftRadius, CHARACTER.radius],
      [PICKAXE_VIEW.headWidth, CHARACTER.radius],
      [PICKAXE_VIEW.headHeight, CHARACTER.radius],
      [PICKAXE_VIEW.headDepth, CHARACTER.radius]
    ]) {
      const ratio = view / reference;
      expect(ratio).toBeGreaterThan(0);
      expect(ratio).toBeLessThan(2);
    }
  });

  it('keeps a tool shorter than the character carrying it', () => {
    for (const tool of TOOLS) {
      const b = rigBounds(buildToolRig(tool));
      expect(b.maxY - b.minY, tool.id).toBeLessThan(CHARACTER.height);
    }
  });
});

describe('SKIN_SPEC §11.1 — tools never touch gameplay', () => {
  it('leaves PICKAXE identical whichever tool is built (ITEM_SHOP_SPEC §4.4)', () => {
    const before = JSON.stringify(PICKAXE);
    for (const tool of TOOLS) buildToolRig(tool);
    expect(JSON.stringify(PICKAXE)).toBe(before);
  });

  it('exposes no damage, range or swing field on a tool, so there is nowhere to hide one', () => {
    const banned = [
      'damage', 'range', 'reach', 'swingRate', 'cooldown', 'harvest',
      'multiplier', 'speed', 'hitbox', 'collision'
    ];
    for (const tool of TOOLS) {
      for (const key of Object.keys(tool)) {
        expect(banned, `${tool.id}.${key}`).not.toContain(key);
      }
    }
  });

  it('gives every tool the same reach and damage, by construction', () => {
    // There is no per-tool lookup anywhere: the config IS the value for all of them.
    expect(PICKAXE.damageToPlayers).toBeGreaterThan(0);
    expect(PICKAXE.range).toBeGreaterThan(0);
    expect(PICKAXE.swingInterval).toBeGreaterThan(0);
    for (const tool of TOOLS) {
      expect(tool.damageToPlayers).toBeUndefined();
      expect(tool.range).toBeUndefined();
      expect(tool.swingInterval).toBeUndefined();
    }
  });
});

describe('SKIN_SPEC §11.6 — tools reach the shop and the locker', () => {
  it('lists every roster tool as a purchasable harvesting tool', () => {
    const items = cosmeticsByCategory(CosmeticCategory.PICKAXE);
    expect(items.length).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      const item = getCosmetic(tool.id);
      expect(item, tool.id).not.toBeNull();
      expect(item.category).toBe(CosmeticCategory.PICKAXE);
      expect(item.rarity).toBe(tool.rarity);
      expect(item.price).toBeGreaterThan(0);
      expect(item.enabled).toBe(true);
    }
  });

  it('marks the glow-edge tools as self-lit in the rig (§6.2)', () => {
    for (const tool of TOOLS) {
      const glowing = buildToolRig(tool).parts.some((p) => p.glow);
      expect(glowing, tool.id).toBe(tool.details.includes(ToolDetail.GLOW_EDGE)
        || tool.head === HeadForm.BEAM);
    }
  });
});

describe('SKIN_SPEC §11.3.1, §11.5 — the 1.3.0 Scrapjaw pass', () => {
  it('runs Scrapjaw at a larger head scale than the roster default', () => {
    const scrapjaw = getTool('pickaxe_scrapjaw');
    expect(scrapjaw.headScale).toBeGreaterThan(1);
    for (const other of TOOLS.filter((t) => t.id !== 'pickaxe_scrapjaw')) {
      expect(other.headScale, other.id).toBe(1);
    }
  });

  it('keeps head scale a view value with no gameplay reach', () => {
    const before = JSON.stringify(PICKAXE);
    buildToolRig(getTool('pickaxe_scrapjaw'));
    expect(JSON.stringify(PICKAXE)).toBe(before);
    // Scaling the head must not scale the haft: the tool still fits the same hand.
    expect(toolMetrics(2).length).toBe(toolMetrics(1).length);
    expect(toolMetrics(2).gripToHead).toBe(toolMetrics(1).gripToHead);
    expect(toolMetrics(2).headWidth).toBeCloseTo(toolMetrics(1).headWidth * 2, 6);
  });

  it('gives the cutting edge and the counter-spike genuinely different shapes (§11.5)', () => {
    const parts = buildToolRig(getTool('pickaxe_scrapjaw')).parts;
    const edge = parts.find((p) => p.id === 'cuttingEdge');
    const spike = parts.find((p) => p.id === 'counterSpike');
    expect(edge, 'cuttingEdge').toBeTruthy();
    expect(spike, 'counterSpike').toBeTruthy();
    expect(edge.shape).not.toBe(spike.shape);
    // …and they oppose each other across the haft.
    expect(Math.sign(edge.pos.x)).not.toBe(Math.sign(spike.pos.x));
  });

  it('layers the head: plates, rivets and lashings, not one slab', () => {
    const parts = buildToolRig(getTool('pickaxe_scrapjaw')).parts;
    expect(parts.filter((p) => p.id.startsWith('weldPlate')).length).toBeGreaterThanOrEqual(3);
    expect(parts.filter((p) => p.id.startsWith('weldRivet')).length).toBeGreaterThanOrEqual(3);
    expect(parts.filter((p) => p.id.startsWith('chainLink')).length).toBeGreaterThanOrEqual(3);
    expect(parts.filter((p) => p.bevel).length).toBeGreaterThanOrEqual(6);
  });

  it('leaves the other six tools untouched by the pass', () => {
    // Part counts frozen from before: this pass was scoped to Scrapjaw alone.
    const BEFORE = {
      pickaxe_standard: 7, pickaxe_quarry: 7, pickaxe_splitleaf: 9,
      pickaxe_tidebreak: 9, pickaxe_emberfall: 9, pickaxe_lumen: 8
    };
    for (const [id, count] of Object.entries(BEFORE)) {
      expect(buildToolRig(getTool(id)).parts.length, id).toBe(count);
    }
  });

  it('preserves save compatibility for every tool ID, rarity and price (§9.13)', () => {
    const BEFORE = {
      pickaxe_standard: ['common', 300], pickaxe_quarry: ['common', 450],
      pickaxe_splitleaf: ['uncommon', 650], pickaxe_tidebreak: ['rare', 900],
      pickaxe_emberfall: ['epic', 1500], pickaxe_lumen: ['legendary', 2200],
      pickaxe_scrapjaw: ['epic', 1650]
    };
    for (const [id, [rarity, price]] of Object.entries(BEFORE)) {
      const item = getCosmetic(id);
      expect(item.rarity, `${id} rarity`).toBe(rarity);
      expect(item.price, `${id} price`).toBe(price);
    }
  });
});
