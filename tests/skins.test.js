/**
 * skins.test.js — SKIN_SPEC §9 required tests.
 *
 * These assert against numbers quoted from the spec, so a spec change that the code does
 * not follow shows up here as a failure (CLAUDE.md: "Tests assert against numbers quoted
 * from the specs").
 */
import { describe, it, expect } from 'vitest';
import {
  SKINS, PALETTE_ROLES, getSkin, skinOrFallback, skinRarityCounts, Build
} from '../src/cosmetics/SkinDefinitions.js';
import {
  buildCharacterRig, buildMetrics, rigBounds, partColour, BodyRegion, SUPPORTED_FEATURES
} from '../src/cosmetics/CharacterRig.js';
import { CHARACTER, MOVEMENT, RARITY_ORDER } from '../src/core/Config.js';
import {
  evaluateAccentRule, ACCENT_LIMIT, EMISSIVE_STRUCTURAL_PATTERN, EXCEPTION_LIMITS
} from '../src/cosmetics/CosmeticRules.js';
import {
  cosmeticsByCategory, CosmeticCategory, getCosmetic, catalogCounts
} from '../src/meta/CosmeticCatalog.js';
import { ProfileManager } from '../src/meta/ProfileManager.js';

const HEX = /^#[0-9a-f]{6}$/i;

/** An in-memory storage stand-in, as the other meta tests use. */
function makeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k)
  };
}

function memoryProfile(storage = makeStorage()) {
  const p = new ProfileManager({ storage });
  p.load();
  return p;
}

describe('SKIN_SPEC §7 — the roster', () => {
  it('carries twenty outfits', () => {
    expect(SKINS.length).toBe(20);
    expect(catalogCounts().outfit).toBe(20);
  });

  it('matches the §7.4 rarity distribution', () => {
    expect(skinRarityCounts()).toEqual({
      common: 3, uncommon: 4, rare: 4, epic: 5, legendary: 4
    });
  });

  it('carries the signature four (§7.3)', () => {
    for (const id of [
      'outfit_vexbloom', 'outfit_goldspar', 'outfit_voidmarrow', 'outfit_coalcrest'
    ]) {
      expect(getSkin(id), id).not.toBeNull();
    }
  });

  it('pairs the Gilded Vanguard set across two different builds', () => {
    const set = SKINS.filter((s) => s.set === 'Gilded Vanguard');
    expect(set.length).toBe(2);
    // Same palette, different mass — that is what makes a set read as a set rather than
    // as one skin shipped twice.
    expect(set[0].palette.accent).toBe(set[1].palette.accent);
    expect(set[0].build).not.toBe(set[1].build);
  });

  it('uses every rarity tier', () => {
    const seen = new Set(SKINS.map((s) => s.rarity));
    for (const tier of RARITY_ORDER) expect(seen.has(tier)).toBe(true);
  });

  it('keeps the founding eight IDs intact — profiles store them', () => {
    for (const id of [
      'outfit_recruit', 'outfit_drifter', 'outfit_signal', 'outfit_tidewatch',
      'outfit_ironleaf', 'outfit_emberkin', 'outfit_nightvane', 'outfit_aurelian'
    ]) {
      expect(getSkin(id)).not.toBeNull();
    }
  });

  it('gives every skin a unique id and name', () => {
    expect(new Set(SKINS.map((s) => s.id)).size).toBe(SKINS.length);
    expect(new Set(SKINS.map((s) => s.name)).size).toBe(SKINS.length);
  });

  it('only uses features the rig can build', () => {
    for (const skin of SKINS) {
      for (const feature of skin.features) {
        expect(SUPPORTED_FEATURES).toContain(feature);
      }
    }
  });

  it('only uses declared build archetypes', () => {
    const builds = new Set(Object.values(Build));
    for (const skin of SKINS) expect(builds.has(skin.build)).toBe(true);
  });

  it('covers every build archetype across the roster', () => {
    const used = new Set(SKINS.map((s) => s.build));
    for (const build of Object.values(Build)) expect(used.has(build)).toBe(true);
  });
});

describe('SKIN_SPEC §4 — palette roles', () => {
  it('declares all seven roles as valid hex, on every skin', () => {
    for (const skin of SKINS) {
      for (const role of PALETTE_ROLES) {
        expect(skin.palette[role], `${skin.id}.${role}`).toMatch(HEX);
      }
    }
  });

  it('never reuses the primary as the accent — an accent that is the primary is not one', () => {
    for (const skin of SKINS) {
      expect(skin.palette.accent.toLowerCase()).not.toBe(skin.palette.primary.toLowerCase());
    }
  });

  it('keeps every skin inside the accent budget or a valid §6.3 exception (§9.5)', () => {
    for (const skin of SKINS) {
      const result = evaluateAccentRule(skin, buildCharacterRig(skin));
      expect(result.failures, `${skin.id}: ${result.failures.join('; ')}`).toEqual([]);
      expect(result.ok, skin.id).toBe(true);
    }
  });

  it('lets only Voidmarrow exceed the limit, and only by declaring §6.3', () => {
    const exceeding = SKINS.filter(
      (s) => evaluateAccentRule(s, buildCharacterRig(s)).exceeds
    );
    expect(exceeding.map((s) => s.id)).toEqual(['outfit_voidmarrow']);
    for (const skin of exceeding) {
      expect(skin.accentException, skin.id).toBe(EMISSIVE_STRUCTURAL_PATTERN);
    }
  });

  it('declares the exception on no skin that does not need it', () => {
    for (const skin of SKINS) {
      if (skin.accentException === null) continue;
      expect(evaluateAccentRule(skin, buildCharacterRig(skin)).exceeds, skin.id).toBe(true);
    }
  });

  it('keeps a dark base under a glow pattern (§9.10)', () => {
    for (const skin of SKINS) {
      const rig = buildCharacterRig(skin);
      if (!rig.parts.some((p) => p.glow)) continue;
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(skin.palette.primary.slice(i, i + 2), 16));
      const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      expect(luminance, `${skin.id} primary is too light to carry a glow`)
        .toBeLessThan(0.3);
    }
  });

  it('resolves every part to a colour', () => {
    for (const skin of SKINS) {
      for (const part of buildCharacterRig(skin).parts) {
        expect(partColour(skin, part), `${skin.id}:${part.id}`).toMatch(HEX);
      }
    }
  });
});

describe('SKIN_SPEC §6 — silhouettes', () => {
  it('gives every skin a unique (build, features) pair (§9.3)', () => {
    const seen = new Map();
    for (const skin of SKINS) {
      const key = `${skin.build}|${skin.features.join(',')}`;
      expect(seen.has(key), `${skin.id} duplicates ${seen.get(key)}`).toBe(false);
      seen.set(key, skin.id);
    }
  });

  it('gives every skin at least one part in every body region (§9.1)', () => {
    for (const skin of SKINS) {
      const regions = new Set(buildCharacterRig(skin).parts.map((p) => p.tag));
      for (const region of [
        BodyRegion.HEAD, BodyRegion.TORSO, BodyRegion.HIPS,
        BodyRegion.ARM_L, BodyRegion.ARM_R, BodyRegion.LEG_L, BodyRegion.LEG_R
      ]) {
        expect(regions.has(region), `${skin.id} missing ${region}`).toBe(true);
      }
    }
  });

  it('produces measurably different silhouettes between builds', () => {
    const widthOf = (build) => {
      const b = rigBounds(buildCharacterRig(SKINS.find((s) => s.build === build)));
      return b.maxX - b.minX;
    };
    // A heavy frame is broader than a lean one. If these ever converge, the build
    // archetypes have stopped doing their job.
    expect(widthOf(Build.HEAVY)).toBeGreaterThan(widthOf(Build.LEAN) * 1.15);
  });

  it('builds a bigger head for a mascot than for an athletic frame', () => {
    expect(buildMetrics(Build.STOUT).headRadius)
      .toBeGreaterThan(buildMetrics(Build.ATHLETIC).headRadius * 1.4);
  });

  it('is deterministic — the same skin yields an identical part list (§9.6)', () => {
    for (const skin of SKINS) {
      const a = buildCharacterRig(skin);
      const b = buildCharacterRig(skin);
      expect(JSON.stringify(b.parts)).toBe(JSON.stringify(a.parts));
    }
  });

  it('orders parts back-to-front so a 2D consumer can paint in array order', () => {
    for (const skin of SKINS) {
      const zs = buildCharacterRig(skin).parts.map((p) => p.pos.z);
      for (let i = 1; i < zs.length; i++) expect(zs[i]).toBeGreaterThanOrEqual(zs[i - 1]);
    }
  });

  it('skips an unknown feature rather than throwing — a future roster must not break a save', () => {
    const future = { ...SKINS[0], id: 'outfit_future', features: ['somethingNotYetInvented'] };
    expect(() => buildCharacterRig(future)).not.toThrow();
    expect(buildCharacterRig(future).parts.length).toBeGreaterThan(0);
  });

  it('falls back to a real skin for an unknown id rather than rendering nothing', () => {
    expect(skinOrFallback('outfit_does_not_exist').id).toBe(SKINS[0].id);
    expect(buildCharacterRig('outfit_does_not_exist').parts.length).toBeGreaterThan(0);
  });
});

describe('SKIN_SPEC §3.2 — dimensions derive from the build module', () => {
  it('stands every build at exactly the capsule height before cosmetic overhang', () => {
    for (const build of Object.values(Build)) {
      const m = buildMetrics(build);
      // Head crown is pinned to standing height; hats and hair sit above it by design.
      expect(m.headY + m.headRadius).toBeCloseTo(MOVEMENT.standHeight, 6);
    }
  });

  it('keeps every skin within a hand-span of the capsule height', () => {
    for (const skin of SKINS) {
      const b = rigBounds(buildCharacterRig(skin));
      expect(b.minY).toBeGreaterThanOrEqual(0);
      // Overhang exists (antennae, tufts) but must never read as a different height class.
      expect(b.maxY).toBeLessThan(MOVEMENT.standHeight * 1.3);
    }
  });

  it('scales with CHARACTER rather than carrying absolute lengths (§9.9)', () => {
    const m = buildMetrics(Build.ATHLETIC);
    expect(m.headRadius).toBeCloseTo(CHARACTER.headRadius, 6);
    expect(m.torsoWidth).toBeCloseTo(CHARACTER.torsoWidth, 6);
    expect(m.hipTop).toBeCloseTo(CHARACTER.hipY, 6);
    // CHARACTER itself derives from the capsule, so the whole chain traces to the module.
    expect(CHARACTER.height).toBe(MOVEMENT.standHeight);
    expect(CHARACTER.radius).toBe(MOVEMENT.capsuleRadius);
  });

  it('keeps the torso roughly within the collision capsule', () => {
    for (const skin of SKINS) {
      const m = buildMetrics(skin.build);
      // The character should fill its capsule without wildly exceeding it — a body far
      // wider than its own hitbox reads as broken to anyone shooting at it.
      expect(m.torsoWidth).toBeLessThan(MOVEMENT.capsuleRadius * 3);
    }
  });
});

describe('SKIN_SPEC §3.4 — cosmetics never touch collision', () => {
  it('leaves the capsule identical for every equipped skin (§9.2)', () => {
    const profile = memoryProfile();
    const before = {
      radius: MOVEMENT.capsuleRadius,
      stand: MOVEMENT.standHeight,
      crouch: MOVEMENT.crouchHeight,
      step: MOVEMENT.stepHeight
    };

    for (const skin of SKINS) {
      if (!profile.owns(skin.id)) profile.grantCosmetic(skin.id);
      expect(profile.equip(skin.id)).toBe(true);
      buildCharacterRig(skin);

      expect(MOVEMENT.capsuleRadius).toBe(before.radius);
      expect(MOVEMENT.standHeight).toBe(before.stand);
      expect(MOVEMENT.crouchHeight).toBe(before.crouch);
      expect(MOVEMENT.stepHeight).toBe(before.step);
    }
  });

  it('exposes no gameplay field on a skin, so there is nowhere to hide a buff', () => {
    const banned = [
      'damage', 'health', 'shield', 'speed', 'hitbox', 'armor', 'armour',
      'multiplier', 'range', 'fireRate', 'collision'
    ];
    for (const skin of SKINS) {
      for (const key of Object.keys(skin)) {
        expect(banned, `${skin.id}.${key}`).not.toContain(key);
      }
    }
  });
});

describe('SKIN_SPEC §10 — every skin reaches the shop, the locker and a match', () => {
  it('lists every roster skin as a purchasable outfit (§9.8)', () => {
    const outfits = cosmeticsByCategory(CosmeticCategory.OUTFIT);
    expect(outfits.length).toBe(SKINS.length);
    for (const skin of SKINS) {
      const item = getCosmetic(skin.id);
      expect(item, skin.id).not.toBeNull();
      expect(item.category).toBe(CosmeticCategory.OUTFIT);
      expect(item.rarity).toBe(skin.rarity);
      expect(item.price).toBeGreaterThan(0);
      expect(item.enabled).toBe(true);
    }
  });

  it('carries the skin palette through to the catalog preview', () => {
    for (const skin of SKINS) {
      expect(getCosmetic(skin.id).preview.palette).toEqual([
        skin.palette.primary, skin.palette.secondary
      ]);
    }
  });

  it('can be granted and equipped through the normal profile path', () => {
    const profile = memoryProfile();
    for (const skin of SKINS) {
      // Starter skins are already owned on a fresh profile; granting those is a no-op.
      if (!profile.owns(skin.id)) expect(profile.grantCosmetic(skin.id)).toBe(true);
      expect(profile.owns(skin.id)).toBe(true);
      expect(profile.equip(skin.id)).toBe(true);
      expect(profile.equippedId('outfit')).toBe(skin.id);
    }
  });

  it('survives a save and reload with the equipped skin intact', () => {
    const storage = makeStorage();
    const a = memoryProfile(storage);
    a.grantCosmetic('outfit_hexwilt');
    a.equip('outfit_hexwilt');

    const b = memoryProfile(storage);
    expect(b.equippedId('outfit')).toBe('outfit_hexwilt');
    expect(buildCharacterRig(b.equippedId('outfit')).skin.id).toBe('outfit_hexwilt');
  });
});

describe('SKIN_SPEC §6.3 — the emissive structural pattern exception stays narrow', () => {
  const rigOf = (skin) => buildCharacterRig(skin);

  it('refuses an over-budget skin that does not declare the exception', () => {
    const undeclared = { ...getSkin('outfit_voidmarrow'), accentException: null };
    const result = evaluateAccentRule(undeclared, rigOf(undeclared));
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('without declaring');
  });

  it('refuses it on rarity alone — legendary buys nothing', () => {
    // Same geometry, same excess, no declaration, top rarity. Still refused.
    const legendary = {
      ...getSkin('outfit_voidmarrow'), rarity: 'legendary', accentException: null
    };
    expect(evaluateAccentRule(legendary, rigOf(legendary)).ok).toBe(false);

    // And the rule reaches an identical verdict for a common skin with the same geometry,
    // which is the proof that rarity is not an input at all.
    const common = { ...legendary, rarity: 'common' };
    const a = evaluateAccentRule(legendary, rigOf(legendary));
    const b = evaluateAccentRule(common, rigOf(common));
    expect(b.ok).toBe(a.ok);
    expect(b.failures).toEqual(a.failures);
  });

  it('refuses a declared skin whose excess is ordinary decoration, not a pattern', () => {
    // Strip the glow flags: the accent parts are now plain paint, so the exception's
    // "structural, not decorative" condition must reject it.
    const skin = getSkin('outfit_voidmarrow');
    const rig = rigOf(skin);
    const decorative = { ...rig, parts: rig.parts.map((p) => ({ ...p, glow: false })) };
    const result = evaluateAccentRule(skin, decorative);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/decoration|no emissive parts/);
  });

  it('refuses a declared skin whose base is too light to carry a glow', () => {
    const base = getSkin('outfit_voidmarrow');
    const skin = { ...base, palette: { ...base.palette, primary: '#eef2f7' } };
    const result = evaluateAccentRule(skin, rigOf(skin));
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('too light');
  });

  it('refuses a declared skin whose glow swallows the figure', () => {
    // Every part emissive: the base can no longer dominate, and the wearer would light
    // up in normal play.
    const skin = getSkin('outfit_voidmarrow');
    const rig = rigOf(skin);
    const allGlow = { ...rig, parts: rig.parts.map((p) => ({ ...p, glow: true })) };
    const result = evaluateAccentRule(skin, allGlow);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toMatch(/dominate|visible/);
  });

  it('refuses a declared skin that erases a body region behind its glow', () => {
    const skin = getSkin('outfit_voidmarrow');
    const rig = rigOf(skin);
    // Make every torso part emissive: the torso keeps no solid geometry, so from the
    // front its proportions are gone.
    const hollow = {
      ...rig,
      parts: rig.parts.map((p) => (p.tag === 'torso' ? { ...p, glow: true } : p))
    };
    const result = evaluateAccentRule(skin, hollow);
    expect(result.ok).toBe(false);
    expect(result.failures.join(' ')).toContain('emissive-only');
  });

  it('keeps Voidmarrow approved, comfortably inside every condition', () => {
    const skin = getSkin('outfit_voidmarrow');
    const { ok, exceeds, declared, metrics } = evaluateAccentRule(skin, rigOf(skin));
    expect({ ok, exceeds, declared }).toEqual({ ok: true, exceeds: true, declared: true });
    expect(metrics.accentShare).toBeGreaterThan(ACCENT_LIMIT);
    expect(metrics.solidAccentShare).toBeLessThanOrEqual(ACCENT_LIMIT);
    expect(metrics.emissiveArea).toBeLessThanOrEqual(EXCEPTION_LIMITS.maxEmissiveArea);
    expect(metrics.baseArea).toBeGreaterThanOrEqual(EXCEPTION_LIMITS.minBaseArea);
    expect(metrics.baseParts).toBeGreaterThanOrEqual(EXCEPTION_LIMITS.minBaseParts);
    expect(metrics.baseLuminance).toBeLessThanOrEqual(EXCEPTION_LIMITS.maxBaseLuminance);
  });

  it('changes no gameplay value — the exception is presentation only', () => {
    const before = { ...MOVEMENT };
    for (const skin of SKINS) evaluateAccentRule(skin, buildCharacterRig(skin));
    expect({ ...MOVEMENT }).toEqual(before);
  });
});

describe('SKIN_SPEC §9.12, §9.13 — the 1.3.0 fidelity pass', () => {
  const SIGNATURE = ['outfit_vexbloom', 'outfit_goldspar', 'outfit_voidmarrow', 'outfit_coalcrest'];

  it('gives each of the signature four real costume layering (§9.12)', () => {
    for (const id of SIGNATURE) {
      const rig = buildCharacterRig(getSkin(id));
      // Density: a premium outfit carries markedly more geometry than a base one.
      expect(rig.parts.length, `${id} part count`).toBeGreaterThanOrEqual(55);
      expect(rig.parts.filter((p) => p.bevel).length, `${id} bevelled parts`)
        .toBeGreaterThanOrEqual(10);
      expect(getSkin(id).features.length, `${id} features`).toBeGreaterThanOrEqual(6);
    }
  });

  it('keeps the signature four denser than every base-roster outfit', () => {
    const base = SKINS.filter((s) => !SIGNATURE.includes(s.id))
      .map((s) => buildCharacterRig(s).parts.length);
    const worstSignature = Math.min(
      ...SIGNATURE.map((id) => buildCharacterRig(getSkin(id)).parts.length)
    );
    expect(worstSignature).toBeGreaterThan(Math.max(...base));
  });

  it('carries at least one asymmetric element per signature outfit', () => {
    for (const id of SIGNATURE) {
      const rig = buildCharacterRig(getSkin(id));
      // An element with no mirrored twin at -x is what breaks the mannequin read.
      const asymmetric = rig.parts.some((p) => Math.abs(p.pos.x) > 1e-6 && !rig.parts.some(
        (q) => q.id !== p.id
          && Math.abs(q.pos.x + p.pos.x) < 1e-6
          && Math.abs(q.pos.y - p.pos.y) < 1e-6
      ));
      expect(asymmetric, `${id} is perfectly mirrored`).toBe(true);
    }
  });

  it('keeps silhouette variety across the four (§9.12)', () => {
    const width = (id) => {
      const b = rigBounds(buildCharacterRig(getSkin(id)));
      return b.maxX - b.minX;
    };
    // The heavy operator must stay clearly the broadest of the set.
    const coalcrest = width('outfit_coalcrest');
    for (const id of SIGNATURE.filter((s) => s !== 'outfit_coalcrest')) {
      expect(coalcrest, `${id} is as broad as Coalcrest`).toBeGreaterThan(width(id) * 1.15);
    }
  });

  it('preserves save compatibility: IDs, rarity and price are untouched (§9.13)', () => {
    // Frozen expectations from before the pass. A profile saved then must still resolve.
    const BEFORE = {
      outfit_vexbloom: { rarity: 'epic', price: 1700 },
      outfit_goldspar: { rarity: 'legendary', price: 2450 },
      outfit_voidmarrow: { rarity: 'legendary', price: 2450 },
      outfit_coalcrest: { rarity: 'epic', price: 1700 }
    };
    for (const [id, expected] of Object.entries(BEFORE)) {
      const item = getCosmetic(id);
      expect(item, id).not.toBeNull();
      expect(item.rarity, `${id} rarity`).toBe(expected.rarity);
      expect(item.price, `${id} price`).toBe(expected.price);
      expect(getSkin(id), `${id} skin`).not.toBeNull();
    }
  });

  it('still satisfies the accent rule after the pass', () => {
    for (const id of SIGNATURE) {
      const skin = getSkin(id);
      expect(evaluateAccentRule(skin, buildCharacterRig(skin)).ok, id).toBe(true);
    }
  });
});
