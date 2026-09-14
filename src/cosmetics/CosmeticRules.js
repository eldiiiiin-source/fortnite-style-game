/**
 * CosmeticRules.js — SKIN_SPEC §9.5, §6.3.
 *
 * The accent budget and the one exception to it.
 *
 * This exists as runnable code rather than as prose in the spec because the exception is
 * narrow and easy to widen by accident. A cosmetic that wants to exceed the accent limit
 * has to declare the exception AND pass every condition below; nothing about its rarity,
 * its price or its theme enters into it.
 *
 * Pure logic: no rendering, no gameplay reach.
 */

/** Normal ceiling: accent may paint at most this share of a rig (§9.5). */
export const ACCENT_LIMIT = 0.25;

/** The only declared exception (§6.3). */
export const EMISSIVE_STRUCTURAL_PATTERN = 'emissiveStructuralPattern';

/** Conditions the exception imposes, as measurable ceilings and floors. */
export const EXCEPTION_LIMITS = Object.freeze({
  /** The emissive pattern may not cover more of the figure than this. */
  maxEmissiveArea: 0.25,
  /** The non-emissive base must hold at least this share of the figure's area. */
  minBaseArea: 0.65,
  /** …and at least this share of its parts. */
  minBaseParts: 0.55,
  /** A glow needs a dark base to read against; above this the base is too light. */
  maxBaseLuminance: 0.3
});

/** Relative luminance of a `#rrggbb` colour, 0..1. */
export function luminanceOf(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/**
 * Frontal area of one part, as a proxy for how much of the figure it covers.
 *
 * Deliberately a projection rather than a part count: four thin rib strips and four broad
 * plates are the same count and nothing like the same amount of glow on screen, and it is
 * the screen that the rule is about.
 */
function frontalArea(part) {
  switch (part.shape) {
    case 'sphere':
      return Math.PI * part.radius * part.radius;
    case 'cone':
      return part.radius * part.height;
    case 'cylinder': {
      const r = Math.max(part.radius, part.radiusTop ?? part.radius);
      return r * 2 * part.height;
    }
    default:
      return part.size.x * part.size.y;
  }
}

/**
 * Evaluate a skin's accent usage against §9.5 and, where claimed, §6.3.
 *
 * @param {object} skin  a skin definition
 * @param {object} rig   its built rig
 * @returns {{ok: boolean, exceeds: boolean, declared: boolean, failures: string[], metrics: object}}
 */
export function evaluateAccentRule(skin, rig) {
  const parts = rig.parts;
  const emissive = parts.filter((p) => p.glow);
  const solid = parts.filter((p) => !p.glow);

  const totalArea = parts.reduce((sum, p) => sum + frontalArea(p), 0) || 1;
  const emissiveArea = emissive.reduce((sum, p) => sum + frontalArea(p), 0);

  const metrics = {
    accentShare: parts.filter((p) => p.role === 'accent').length / parts.length,
    solidAccentShare: solid.length
      ? solid.filter((p) => p.role === 'accent').length / solid.length
      : 0,
    emissiveArea: emissiveArea / totalArea,
    baseArea: 1 - emissiveArea / totalArea,
    baseParts: solid.length / parts.length,
    baseLuminance: luminanceOf(skin.palette.primary)
  };

  const exceeds = metrics.accentShare > ACCENT_LIMIT;
  const declared = skin.accentException === EMISSIVE_STRUCTURAL_PATTERN;

  // Within budget: nothing to justify, and a declaration would be noise.
  if (!exceeds) {
    return {
      ok: !declared,
      exceeds: false,
      declared,
      metrics,
      failures: declared
        ? ['declares the emissive exception but does not need it']
        : []
    };
  }

  const failures = [];

  // 1. Declared in the cosmetic definition. Rarity is not an input to this function at
  //    all — being legendary buys nothing.
  if (!declared) failures.push('exceeds the accent limit without declaring §6.3');

  // 2. The excess must come from the emissive pattern, not from ordinary decoration.
  //    Strip the glow away and what remains must still live inside the normal budget.
  if (metrics.solidAccentShare > ACCENT_LIMIT) {
    failures.push('non-emissive accent alone exceeds the limit — this is decoration, not a pattern');
  }

  // 3. A pattern that paints nothing is not structural.
  if (emissive.length === 0) failures.push('declares an emissive pattern but has no emissive parts');

  // 4. The non-emissive base stays visually dominant, so the character keeps its form.
  if (metrics.baseArea < EXCEPTION_LIMITS.minBaseArea) {
    failures.push('emissive pattern covers too much of the figure for the base to dominate');
  }
  if (metrics.baseParts < EXCEPTION_LIMITS.minBaseParts) {
    failures.push('too few non-emissive parts for the base to dominate');
  }

  // 5. The emissive material must not light up more of the figure than a pattern would,
  //    which is what would make the wearer easier to see in normal play.
  if (metrics.emissiveArea > EXCEPTION_LIMITS.maxEmissiveArea) {
    failures.push('emissive area is large enough to change how visible the wearer is');
  }

  // 6. It reads as a pattern only against a dark base.
  if (metrics.baseLuminance > EXCEPTION_LIMITS.maxBaseLuminance) {
    failures.push('base is too light for a glow to read as structure');
  }

  // 7. Proportions stay legible: every body region keeps non-emissive geometry, so the
  //    glow overlays the body rather than replacing it.
  const regionsWithBase = new Set(solid.map((p) => p.tag));
  for (const region of new Set(parts.map((p) => p.tag))) {
    if (!regionsWithBase.has(region)) {
      failures.push(`region "${region}" is emissive-only, which erases its proportions`);
    }
  }

  return { ok: failures.length === 0, exceeds: true, declared, metrics, failures };
}
