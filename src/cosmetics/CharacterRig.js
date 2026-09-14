/**
 * CharacterRig.js — SKIN_SPEC §3, §5, §6.
 *
 * Turns a skin definition into an ordered list of abstract parts. This is the ONLY place a
 * character's shape is defined: `world/CharacterView.js` builds three.js meshes from these
 * parts and `ui/components/CharacterPainter.js` paints the same parts to a canvas, so the
 * lobby preview, the shop card and the in-match character cannot drift apart.
 *
 * The same principle as `building/PieceGeometry.js` — one shape definition, many consumers
 * (CLAUDE.md: "Geometry has one source").
 *
 * Pure logic: no three.js, no DOM. Runs in Node under Vitest.
 *
 * DIMENSIONS: every value is a ratio of `CHARACTER` in Config, which derives from the
 * player capsule, which derives from the build module (MASTER_SPEC §9.1.1). There are no
 * absolute lengths in this file — retuning TILE / WALL_H rescales every character.
 *
 * COLLISION: nothing here feeds collision. The capsule is the hitbox for every skin
 * without exception (SKIN_SPEC §3.4, ITEM_SHOP_SPEC §4.4).
 */
import { CHARACTER } from '../core/Config.js';
import { Feature, skinOrFallback } from './SkinDefinitions.js';
import {
  box, bevelBox, sphere, cone, cylinder, wedge, v, repaint, depthSort
} from './RigPrimitives.js';

// Re-exported so existing consumers keep importing shape helpers from the rig they use.
export { PartShape, partHalfExtents, rigBounds, partColour } from './RigPrimitives.js';

/** Body regions a part can belong to. Animation addresses these, not skins. */
export const BodyRegion = Object.freeze({
  HEAD: 'head',
  TORSO: 'torso',
  HIPS: 'hips',
  ARM_L: 'armL',
  ARM_R: 'armR',
  LEG_L: 'legL',
  LEG_R: 'legR',
  BACK: 'back'
});

/**
 * Body metrics for a build (§5).
 *
 * The vertical anchors are SOLVED rather than declared: the head crown is pinned to
 * CHARACTER.height and the torso fills whatever is left between the hip line and the neck.
 * That is what keeps a mascot and an armoured heavy exactly the same height while looking
 * nothing alike — only the proportions between the anchors move.
 */
export function buildMetrics(build) {
  const B = CHARACTER.builds[build] ?? CHARACTER.builds.athletic;
  const footTop = CHARACTER.footHeight;
  const hipTop = CHARACTER.hipY * B.legScale;
  const headRadius = CHARACTER.headRadius * B.head;
  const headY = CHARACTER.height - headRadius;
  const neckLength = CHARACTER.neckLength * B.head;
  const shoulderY = headY - headRadius * 0.86 - neckLength;

  const torsoWidth = CHARACTER.torsoWidth * B.torso;
  const hipWidth = CHARACTER.hipWidth * B.torso;
  const armWidth = CHARACTER.armWidth * B.limb;
  const legWidth = CHARACTER.legWidth * B.limb;

  return {
    build,
    footTop,
    hipTop,
    shoulderY,
    headY,
    headRadius,
    neckLength,
    neckWidth: CHARACTER.neckWidth * B.head,
    torsoWidth,
    torsoDepth: CHARACTER.torsoDepth * B.torso,
    torsoHeight: shoulderY - hipTop,
    hipWidth,
    hipHeight: hipTop - CHARACTER.hipY * B.legScale * 0.78,
    shoulderWidth: torsoWidth * B.shoulder,
    armWidth,
    armDepth: CHARACTER.armDepth * B.limb,
    armLength: CHARACTER.armLength,
    // Clear of the torso edge, not flush with it: flush arms merge into the chest
    // as soon as the figure is viewed at any angle.
    armX: (torsoWidth * B.shoulder) / 2 + armWidth * 0.62,
    legWidth,
    legDepth: CHARACTER.legDepth * B.limb,
    legLength: hipTop - footTop,
    // Leg centres, spaced so a visible gap survives: legs tucked flush under the hips
    // merge into one block and the walk stops reading at distance.
    legX: (hipWidth / 2 - legWidth * 0.42) * B.stance,
    footHeight: footTop
  };
}

/* ── base body ───────────────────────────────────────────────────────────── */

function baseBody(m, parts) {
  // Hips — the transition from legs to torso, slightly narrower than the chest.
  parts.push(box('hips', BodyRegion.HIPS, 'detail',
    v(m.hipWidth, m.hipHeight * 1.6, m.torsoDepth * 0.92),
    v(0, m.hipTop - m.hipHeight * 0.4, 0)));

  // Torso. Two stacked boxes: a narrower waist and a wider chest, which gives the
  // silhouette a taper instead of reading as one slab.
  const waistH = m.torsoHeight * 0.42;
  const chestH = m.torsoHeight - waistH;
  parts.push(box('waist', BodyRegion.TORSO, 'primary',
    v(m.torsoWidth * 0.88, waistH, m.torsoDepth * 0.94),
    v(0, m.hipTop + waistH / 2, 0)));
  parts.push(box('chest', BodyRegion.TORSO, 'primary',
    v(m.shoulderWidth, chestH, m.torsoDepth),
    v(0, m.hipTop + waistH + chestH / 2, 0)));

  parts.push(box('neck', BodyRegion.HEAD, 'skin',
    v(m.neckWidth, m.neckLength * 1.5, m.neckWidth),
    v(0, m.shoulderY + m.neckLength * 0.5, 0)));

  parts.push(sphere('head', BodyRegion.HEAD, 'skin', m.headRadius, v(0, m.headY, 0)));

  // Hair cap — a shell over the back and top of the skull. Features may sit on top of it.
  parts.push(sphere('hairCap', BodyRegion.HEAD, 'hair', m.headRadius * 1.08,
    v(0, m.headY + m.headRadius * 0.38, -m.headRadius * 0.1)));

  // Eyes, so the character has a front. Small and dark: readable, never fussy.
  for (const side of [-1, 1]) {
    parts.push(box(`eye${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'detail',
      v(m.headRadius * 0.24, m.headRadius * 0.3, m.headRadius * 0.18),
      v(side * m.headRadius * 0.36, m.headY + m.headRadius * 0.08, m.headRadius * 0.84)));
  }

  for (const side of [-1, 1]) {
    const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
    const suffix = side < 0 ? 'L' : 'R';

    parts.push(box(`upperArm${suffix}`, tag, 'secondary',
      v(m.armWidth, m.armLength * 0.54, m.armDepth),
      v(side * m.armX, m.shoulderY - m.armLength * 0.27, 0)));
    parts.push(box(`foreArm${suffix}`, tag, 'secondary',
      v(m.armWidth * 0.92, m.armLength * 0.46, m.armDepth * 0.92),
      v(side * m.armX, m.shoulderY - m.armLength * 0.77, 0)));
    parts.push(box(`hand${suffix}`, tag, 'skin',
      v(m.armWidth * 0.96, m.armLength * 0.16, m.armDepth * 0.96),
      v(side * m.armX, m.shoulderY - m.armLength - m.armLength * 0.06, 0)));

    // Colour banding, deliberately alternating: torso primary, arms secondary, thighs
    // detail, shins secondary. Adjacent masses never share a colour, which is what keeps
    // the arms from melting into the legs at a distance.
    const legTag = side < 0 ? BodyRegion.LEG_L : BodyRegion.LEG_R;
    parts.push(box(`thigh${suffix}`, legTag, 'detail',
      v(m.legWidth, m.legLength * 0.52, m.legDepth),
      v(side * m.legX, m.footTop + m.legLength * 0.74, 0)));
    parts.push(box(`shin${suffix}`, legTag, 'secondary',
      v(m.legWidth * 0.9, m.legLength * 0.48, m.legDepth * 0.9),
      v(side * m.legX, m.footTop + m.legLength * 0.24, 0)));
    parts.push(box(`foot${suffix}`, legTag, 'detail',
      v(m.legWidth * 1.05, m.footTop * 1.6, m.legDepth * 1.45),
      v(side * m.legX, m.footTop * 0.8, m.legDepth * 0.24)));
  }
}

/* ── silhouette features — SKIN_SPEC §6 ──────────────────────────────────── */

const FEATURE_BUILDERS = {
  [Feature.HOOD](m, parts) {
    // The crown sits high and back so the face stays clear — a hood that encircles the
    // head at eye level reads as a halo.
    parts.push(sphere('hoodCrown', BodyRegion.HEAD, 'secondary', m.headRadius * 1.14,
      v(0, m.headY + m.headRadius * 0.46, -m.headRadius * 0.34)));
    parts.push(box('hoodSide', BodyRegion.HEAD, 'secondary',
      v(m.headRadius * 2.2, m.headRadius * 1.3, m.headRadius * 1.2),
      v(0, m.headY + m.headRadius * 0.34, -m.headRadius * 0.5)));
    parts.push(cone('hoodPeak', BodyRegion.HEAD, 'secondary',
      m.headRadius * 0.78, m.headRadius * 1.7,
      v(0, m.headY - m.headRadius * 0.1, -m.headRadius * 1.0),
      v(-1.05, 0, 0)));
    parts.push(box('hoodCollar', BodyRegion.TORSO, 'secondary',
      v(m.shoulderWidth * 1.06, m.torsoHeight * 0.2, m.torsoDepth * 1.12),
      v(0, m.shoulderY - m.torsoHeight * 0.04, 0)));
  },

  [Feature.HELMET](m, parts) {
    parts.push(sphere('helmetShell', BodyRegion.HEAD, 'detail', m.headRadius * 1.14,
      v(0, m.headY + m.headRadius * 0.26, -m.headRadius * 0.06)));
    parts.push(wedge('helmetBrim', BodyRegion.HEAD, 'detail',
      v(m.headRadius * 1.9, m.headRadius * 0.22, m.headRadius * 0.7),
      v(0, m.headY + m.headRadius * 0.44, m.headRadius * 0.82)));
    parts.push(box('helmetStripe', BodyRegion.HEAD, 'accent',
      v(m.headRadius * 0.3, m.headRadius * 1.2, m.headRadius * 0.5),
      v(0, m.headY + m.headRadius * 0.72, -m.headRadius * 0.5)));
  },

  [Feature.VISOR_BAND](m, parts) {
    parts.push(wedge('visorBand', BodyRegion.HEAD, 'visor',
      v(m.headRadius * 1.74, m.headRadius * 0.46, m.headRadius * 0.5),
      v(0, m.headY + m.headRadius * 0.08, m.headRadius * 0.74)));
    parts.push(box('visorFrame', BodyRegion.HEAD, 'detail',
      v(m.headRadius * 1.86, m.headRadius * 0.14, m.headRadius * 0.54),
      v(0, m.headY + m.headRadius * 0.34, m.headRadius * 0.72)));
  },

  [Feature.GOGGLES](m, parts) {
    for (const side of [-1, 1]) {
      parts.push(cylinder(`goggleLens${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'visor',
        m.headRadius * 0.34, m.headRadius * 0.3,
        v(side * m.headRadius * 0.42, m.headY + m.headRadius * 0.5, m.headRadius * 0.76),
        v(Math.PI / 2, 0, 0)));
    }
    parts.push(box('goggleStrap', BodyRegion.HEAD, 'detail',
      v(m.headRadius * 2.1, m.headRadius * 0.26, m.headRadius * 1.9),
      v(0, m.headY + m.headRadius * 0.5, 0)));
  },

  [Feature.PONYTAIL](m, parts) {
    parts.push(box('ponytailBand', BodyRegion.HEAD, 'accent',
      v(m.headRadius * 0.44, m.headRadius * 0.3, m.headRadius * 0.44),
      v(0, m.headY + m.headRadius * 0.78, -m.headRadius * 0.72)));
    parts.push(cylinder('ponytail', BodyRegion.HEAD, 'hair',
      m.headRadius * 0.34, m.headRadius * 2.6,
      v(0, m.headY + m.headRadius * 0.1, -m.headRadius * 1.5),
      v(0.6, 0, 0), m.headRadius * 0.16));
  },

  [Feature.LONG_HAIR](m, parts) {
    parts.push(box('hairFall', BodyRegion.HEAD, 'hair',
      v(m.headRadius * 1.9, m.headRadius * 2.9, m.headRadius * 0.7),
      v(0, m.headY - m.headRadius * 1.1, -m.headRadius * 0.78)));
    // One long front lock, off-centre: asymmetry is what makes long hair read as a shape
    // rather than as a helmet.
    parts.push(box('hairLock', BodyRegion.HEAD, 'hair',
      v(m.headRadius * 0.52, m.headRadius * 2.2, m.headRadius * 0.5),
      v(-m.headRadius * 0.74, m.headY - m.headRadius * 0.9, m.headRadius * 0.56)));
    parts.push(box('hairSweep', BodyRegion.HEAD, 'hair',
      v(m.headRadius * 1.5, m.headRadius * 0.6, m.headRadius * 1.1),
      v(m.headRadius * 0.24, m.headY + m.headRadius * 0.74, m.headRadius * 0.3),
      v(0, 0, -0.22)));
  },

  [Feature.HAIR_TUFT](m, parts) {
    parts.push(cone('hairTuft', BodyRegion.HEAD, 'hair',
      m.headRadius * 0.46, m.headRadius * 0.9,
      v(m.headRadius * 0.1, m.headY + m.headRadius * 1.16, m.headRadius * 0.1),
      v(-0.3, 0, 0.26)));
  },

  [Feature.EAR_PUFFS](m, parts) {
    for (const side of [-1, 1]) {
      parts.push(sphere(`earPuff${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'hair',
        m.headRadius * 0.46,
        v(side * m.headRadius * 1.06, m.headY + m.headRadius * 0.6, -m.headRadius * 0.1)));
      parts.push(sphere(`earInner${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'accent',
        m.headRadius * 0.22,
        v(side * m.headRadius * 1.22, m.headY + m.headRadius * 0.6, m.headRadius * 0.16)));
    }
  },

  [Feature.MASCOT_HEAD](m, parts) {
    parts.push(sphere('muzzle', BodyRegion.HEAD, 'secondary', m.headRadius * 0.52,
      v(0, m.headY - m.headRadius * 0.26, m.headRadius * 0.82)));
    parts.push(sphere('nose', BodyRegion.HEAD, 'detail', m.headRadius * 0.18,
      v(0, m.headY - m.headRadius * 0.12, m.headRadius * 1.2)));
    parts.push(box('smile', BodyRegion.HEAD, 'detail',
      v(m.headRadius * 0.5, m.headRadius * 0.1, m.headRadius * 0.2),
      v(0, m.headY - m.headRadius * 0.52, m.headRadius * 1.14)));
    // Big eyes, set wide. They sit proud of the base eyes rather than replacing them.
    for (const side of [-1, 1]) {
      parts.push(sphere(`bigEye${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'secondary',
        m.headRadius * 0.3,
        v(side * m.headRadius * 0.44, m.headY + m.headRadius * 0.22, m.headRadius * 0.8)));
      parts.push(sphere(`pupil${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'visor',
        m.headRadius * 0.15,
        v(side * m.headRadius * 0.46, m.headY + m.headRadius * 0.2, m.headRadius * 1.02)));
    }
  },

  [Feature.SHOULDER_PADS](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      // A pad caps the shoulder: wider than the arm, shallower than it is wide, and in
      // the secondary colour. An accent-coloured ball reads as a balloon, not armour.
      parts.push(box(`pad${side < 0 ? 'L' : 'R'}`, tag, 'secondary',
        v(m.armWidth * 1.5, m.armLength * 0.2, m.armDepth * 1.35),
        v(side * (m.armX + m.armWidth * 0.1), m.shoulderY - m.armLength * 0.04, 0)));
      parts.push(box(`padTrim${side < 0 ? 'L' : 'R'}`, tag, 'accent',
        v(m.armWidth * 1.54, m.armLength * 0.05, m.armDepth * 1.39),
        v(side * (m.armX + m.armWidth * 0.1), m.shoulderY + m.armLength * 0.06, 0)));
    }
  },

  [Feature.PLATE_CARRIER](m, parts) {
    parts.push(box('plate', BodyRegion.TORSO, 'detail',
      v(m.shoulderWidth * 0.92, m.torsoHeight * 0.62, m.torsoDepth * 0.42),
      v(0, m.hipTop + m.torsoHeight * 0.6, m.torsoDepth * 0.6)));
    parts.push(box('plateCollar', BodyRegion.TORSO, 'detail',
      v(m.shoulderWidth * 0.62, m.torsoHeight * 0.16, m.torsoDepth * 1.1),
      v(0, m.shoulderY + m.torsoHeight * 0.04, 0)));
    parts.push(box('plateTag', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.2, m.torsoHeight * 0.1, m.torsoDepth * 0.16),
      v(m.shoulderWidth * 0.28, m.hipTop + m.torsoHeight * 0.78, m.torsoDepth * 0.82)));
  },

  [Feature.CHEST_RIG](m, parts) {
    for (const i of [-1, 0, 1]) {
      parts.push(box(`pouch${i + 1}`, BodyRegion.TORSO, 'detail',
        v(m.shoulderWidth * 0.22, m.torsoHeight * 0.2, m.torsoDepth * 0.3),
        v(i * m.shoulderWidth * 0.28, m.hipTop + m.torsoHeight * 0.52, m.torsoDepth * 0.56)));
    }
    parts.push(box('rigStrap', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.9, m.torsoHeight * 0.08, m.torsoDepth * 1.04),
      v(0, m.hipTop + m.torsoHeight * 0.74, 0)));
  },

  [Feature.SCARF](m, parts) {
    parts.push(cylinder('scarfWrap', BodyRegion.TORSO, 'accent',
      m.neckWidth * 1.02, m.neckLength * 1.15,
      v(0, m.shoulderY + m.neckLength * 0.42, 0)));
    parts.push(box('scarfTail', BodyRegion.BACK, 'accent',
      v(m.neckWidth * 0.9, m.torsoHeight * 1.15, m.neckWidth * 0.28),
      v(m.neckWidth * 0.5, m.shoulderY - m.torsoHeight * 0.5, -m.torsoDepth * 0.66),
      v(0.18, 0, -0.12)));
  },

  [Feature.CAPE](m, parts) {
    parts.push(box('cape', BodyRegion.BACK, 'secondary',
      v(m.shoulderWidth * 1.08, m.torsoHeight + m.legLength * 0.52, m.torsoDepth * 0.16),
      v(0, m.shoulderY - (m.torsoHeight + m.legLength * 0.52) / 2 + m.torsoHeight * 0.06,
        -m.torsoDepth * 0.62),
      v(0.05, 0, 0)));
    parts.push(box('capeClasp', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.26, m.torsoHeight * 0.12, m.torsoDepth * 1.16),
      v(0, m.shoulderY - m.torsoHeight * 0.04, 0)));
  },

  [Feature.HEM_SKIRT](m, parts) {
    parts.push(cylinder('hemSkirt', BodyRegion.HIPS, 'primary',
      m.hipWidth * 0.62, m.legLength * 0.34,
      v(0, m.hipTop - m.legLength * 0.14, 0),
      null, m.hipWidth * 0.46));
    parts.push(box('hemBand', BodyRegion.HIPS, 'accent',
      v(m.hipWidth * 1.26, m.legLength * 0.05, m.hipWidth * 1.26),
      v(0, m.hipTop - m.legLength * 0.31, 0)));
  },

  [Feature.TATTERED_HEM](m, parts) {
    // Uneven strip lengths, fixed rather than random: the rig must be deterministic (§9.6).
    const drops = [0.42, 0.24, 0.5, 0.3, 0.46];
    drops.forEach((drop, i) => {
      const offset = (i - (drops.length - 1) / 2) / ((drops.length - 1) / 2);
      parts.push(box(`tatter${i}`, BodyRegion.HIPS, 'secondary',
        v(m.hipWidth * 0.3, m.legLength * drop, m.torsoDepth * 0.2),
        v(offset * m.hipWidth * 0.62, m.hipTop - m.legLength * drop * 0.5,
          m.torsoDepth * (i % 2 === 0 ? 0.42 : -0.42)),
        v(0, 0, offset * 0.14)));
    });
  },

  [Feature.SHIN_GUARDS](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.LEG_L : BodyRegion.LEG_R;
      parts.push(box(`shinGuard${side < 0 ? 'L' : 'R'}`, tag, 'secondary',
        v(m.legWidth * 1.02, m.legLength * 0.38, m.legDepth * 0.42),
        v(side * m.legX, m.footTop + m.legLength * 0.26, m.legDepth * 0.42)));
      parts.push(box(`kneeCap${side < 0 ? 'L' : 'R'}`, tag, 'accent',
        v(m.legWidth * 0.8, m.legLength * 0.09, m.legDepth * 0.34),
        v(side * m.legX, m.footTop + m.legLength * 0.47, m.legDepth * 0.46)));
    }
  },

  [Feature.BRACERS](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      parts.push(box(`bracer${side < 0 ? 'L' : 'R'}`, tag, 'accent',
        v(m.armWidth * 1.16, m.armLength * 0.26, m.armDepth * 1.16),
        v(side * m.armX, m.shoulderY - m.armLength * 0.8, 0)));
    }
  },

  [Feature.BACK_TANK](m, parts) {
    parts.push(cylinder('backTank', BodyRegion.BACK, 'accent',
      m.torsoDepth * 0.42, m.torsoHeight * 0.82,
      v(0, m.hipTop + m.torsoHeight * 0.58, -m.torsoDepth * 0.78)));
    parts.push(cylinder('tankCap', BodyRegion.BACK, 'detail',
      m.torsoDepth * 0.2, m.torsoHeight * 0.14,
      v(0, m.hipTop + m.torsoHeight * 1.04, -m.torsoDepth * 0.78)));
    parts.push(box('tankPipe', BodyRegion.BACK, 'detail',
      v(m.torsoDepth * 0.12, m.torsoHeight * 0.5, m.torsoDepth * 0.12),
      v(m.shoulderWidth * 0.3, m.hipTop + m.torsoHeight * 0.8, -m.torsoDepth * 0.6),
      v(0, 0, -0.24)));
  },

  [Feature.SPINE_FIN](m, parts) {
    parts.push(cone('spineFin', BodyRegion.BACK, 'accent',
      m.torsoDepth * 0.34, m.torsoHeight * 0.95,
      v(0, m.hipTop + m.torsoHeight * 0.62, -m.torsoDepth * 0.56),
      v(0.22, 0, 0)));
    parts.push(box('spineRidge', BodyRegion.BACK, 'detail',
      v(m.torsoDepth * 0.16, m.torsoHeight * 0.9, m.torsoDepth * 0.3),
      v(0, m.hipTop + m.torsoHeight * 0.5, -m.torsoDepth * 0.52)));
  },

  [Feature.ANTENNA](m, parts) {
    parts.push(cylinder('antennaStalk', BodyRegion.HEAD, 'detail',
      m.headRadius * 0.07, m.headRadius * 0.82,
      v(m.headRadius * 0.16, m.headY + m.headRadius * 1.34, 0),
      v(0, 0, -0.2)));
    parts.push(sphere('antennaBulb', BodyRegion.HEAD, 'accent', m.headRadius * 0.2,
      v(m.headRadius * 0.32, m.headY + m.headRadius * 1.76, 0)));
  },

  [Feature.STITCH_SEAMS](m, parts) {
    parts.push(box('seamChest', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.1, m.torsoHeight * 0.86, m.torsoDepth * 1.02),
      v(-m.shoulderWidth * 0.16, m.hipTop + m.torsoHeight * 0.5, 0),
      v(0, 0, 0.1)));
    parts.push(box('seamWaist', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.96, m.torsoHeight * 0.07, m.torsoDepth * 1.02),
      v(0, m.hipTop + m.torsoHeight * 0.34, 0)));
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      parts.push(box(`seamArm${side < 0 ? 'L' : 'R'}`, tag, 'accent',
        v(m.armWidth * 1.04, m.armLength * 0.06, m.armDepth * 1.04),
        v(side * m.armX, m.shoulderY - m.armLength * 0.52, 0)));
    }
  },
  /* ── operator kit — SKIN_SPEC §6.1, §6.4 ──────────────────────────────────
   * The pieces that make an outfit read as equipment rather than as clothing, and the
   * layering that makes it read as garments over garments rather than one painted suit.
   *
   * Every builder here is used ONLY by the signature four, which is why the 1.3.0
   * fidelity pass could rebuild them without touching the other sixteen outfits.
   */

  [Feature.AVIATOR_CAP](m, parts) {
    const r = m.headRadius;
    // Leather cap: a domed crown, a rear shroud down the neck, jaw flaps and a strap.
    // The shroud is what separates a pilot's cap from a plain helmet in outline.
    parts.push(sphere('capCrown', BodyRegion.HEAD, 'detail', r * 1.12,
      v(0, m.headY + r * 0.26, -r * 0.08)));
    parts.push(bevelBox('capShroud', BodyRegion.HEAD, 'detail',
      v(r * 1.86, r * 1.05, r * 0.8),
      v(0, m.headY - r * 0.24, -r * 0.92), v(0.22, 0, 0)));
    parts.push(bevelBox('capBrowBand', BodyRegion.HEAD, 'secondary',
      v(r * 2.12, r * 0.3, r * 2.04),
      v(0, m.headY + r * 0.5, 0)));
    // Flat and high: a crest running front-to-back over the crown. Any taller and it
    // hangs down the forehead and reads as a bar across the face.
    parts.push(box('capSeam', BodyRegion.HEAD, 'accent',
      v(r * 0.18, r * 0.22, r * 2.04),
      v(0, m.headY + r * 1.02, 0)));
    for (const side of [-1, 1]) {
      const sfx = side < 0 ? 'L' : 'R';
      parts.push(bevelBox(`capFlap${sfx}`, BodyRegion.HEAD, 'detail',
        v(r * 0.46, r * 1.32, r * 1.02),
        v(side * r * 0.96, m.headY - r * 0.46, -r * 0.14), v(0, 0, side * 0.08)));
      parts.push(box(`capBuckle${sfx}`, BodyRegion.HEAD, 'accent',
        v(r * 0.26, r * 0.22, r * 0.26),
        v(side * r * 1.04, m.headY - r * 0.94, r * 0.16)));
    }
    parts.push(box('capChinStrap', BodyRegion.HEAD, 'detail',
      v(r * 0.22, r * 0.46, r * 0.26),
      v(-r * 0.62, m.headY - r * 0.72, r * 0.42), v(0, 0, 0.3)));
  },

  [Feature.BROW_GOGGLES](m, parts) {
    const r = m.headRadius;
    // Pushed UP onto the brow, on a ringed mount: the face stays readable and the goggles
    // still break the head's outline where a flat band would not.
    parts.push(bevelBox('browStrap', BodyRegion.HEAD, 'detail',
      v(r * 2.2, r * 0.34, r * 2.04),
      v(0, m.headY + r * 0.88, 0)));
    parts.push(box('browBridge', BodyRegion.HEAD, 'accent',
      v(r * 0.34, r * 0.2, r * 0.4),
      v(0, m.headY + r * 0.94, r * 0.78)));
    for (const side of [-1, 1]) {
      const sfx = side < 0 ? 'L' : 'R';
      parts.push(cylinder(`browRim${sfx}`, BodyRegion.HEAD, 'accent',
        r * 0.46, r * 0.2,
        v(side * r * 0.46, m.headY + r * 0.94, r * 0.7), v(Math.PI / 2, 0, 0)));
      parts.push(cylinder(`browLens${sfx}`, BodyRegion.HEAD, 'visor',
        r * 0.36, r * 0.3,
        v(side * r * 0.46, m.headY + r * 0.94, r * 0.82), v(Math.PI / 2, 0, 0)));
    }
  },

  [Feature.HEAD_WRAP](m, parts) {
    const r = m.headRadius;
    // Cloth wrap: a tall soft crown, a banded brow, a knot and a short trailing tail.
    parts.push(sphere('wrapCrown', BodyRegion.HEAD, 'hair', r * 1.1,
      v(0, m.headY + r * 0.54, -r * 0.04)));
    parts.push(bevelBox('wrapBand', BodyRegion.HEAD, 'hair',
      v(r * 2.16, r * 0.44, r * 2.08),
      v(0, m.headY + r * 0.66, 0)));
    parts.push(box('wrapFold', BodyRegion.HEAD, 'hair',
      v(r * 1.5, r * 0.3, r * 2.1),
      v(0, m.headY + r * 0.94, 0), v(0, 0, 0.14)));
    parts.push(sphere('wrapKnot', BodyRegion.HEAD, 'hair', r * 0.34,
      v(r * 0.96, m.headY + r * 0.86, -r * 0.56)));
    parts.push(box('wrapTail', BodyRegion.HEAD, 'hair',
      v(r * 0.36, r * 1.5, r * 0.3),
      v(r * 1.06, m.headY + r * 0.1, -r * 0.78), v(0.2, 0, -0.3)));
  },

  [Feature.TANK_TOP](m, parts) {
    // Sleeveless, defined by what it leaves bare. A vest slab plus two shoulder straps,
    // with a hem lip at the waist so the garment ends somewhere rather than fading out.
    repaint(parts, ['upperArmL', 'upperArmR', 'foreArmL', 'foreArmR'], 'skin');
    parts.push(bevelBox('vest', BodyRegion.TORSO, 'primary',
      v(m.shoulderWidth * 0.84, m.torsoHeight * 0.9, m.torsoDepth * 1.08),
      v(0, m.hipTop + m.torsoHeight * 0.5, 0)));
    parts.push(bevelBox('vestHem', BodyRegion.TORSO, 'secondary',
      v(m.shoulderWidth * 0.86, m.torsoHeight * 0.1, m.torsoDepth * 1.12),
      v(0, m.hipTop + m.torsoHeight * 0.1, 0)));
    parts.push(box('vestCollar', BodyRegion.TORSO, 'secondary',
      v(m.shoulderWidth * 0.5, m.torsoHeight * 0.09, m.torsoDepth * 1.12),
      v(0, m.shoulderY - m.torsoHeight * 0.02, 0)));
    for (const side of [-1, 1]) {
      parts.push(bevelBox(`vestStrap${side < 0 ? 'L' : 'R'}`, BodyRegion.TORSO, 'primary',
        v(m.shoulderWidth * 0.2, m.torsoHeight * 0.32, m.torsoDepth * 1.1),
        v(side * m.shoulderWidth * 0.3, m.hipTop + m.torsoHeight * 0.86, 0),
        v(0, 0, side * 0.06)));
    }
  },

  [Feature.FINGERLESS_GLOVES](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      const sfx = side < 0 ? 'L' : 'R';
      // Glove at the wrist and palm with the skin left below it, plus a cuff and a
      // knuckle plate — three stacked pieces where there was one.
      parts.push(bevelBox(`glove${sfx}`, tag, 'detail',
        v(m.armWidth * 1.1, m.armLength * 0.15, m.armDepth * 1.1),
        v(side * m.armX, m.shoulderY - m.armLength * 0.97, 0)));
      parts.push(bevelBox(`gloveCuff${sfx}`, tag, 'detail',
        v(m.armWidth * 1.24, m.armLength * 0.11, m.armDepth * 1.2),
        v(side * m.armX, m.shoulderY - m.armLength * 0.85, 0)));
      parts.push(box(`knuckle${sfx}`, tag, 'accent',
        v(m.armWidth * 0.9, m.armLength * 0.05, m.armDepth * 0.5),
        v(side * m.armX, m.shoulderY - m.armLength * 0.94, m.armDepth * 0.5)));
    }
  },

  [Feature.THIGH_RIG](m, parts) {
    // Strapped thigh pouches on ONE leg. Symmetry here reads as a uniform; asymmetry
    // reads as kit someone chose.
    parts.push(bevelBox('thighPouch', BodyRegion.LEG_R, 'detail',
      v(m.legWidth * 0.78, m.legLength * 0.28, m.legDepth * 0.52),
      v(m.legX + m.legWidth * 0.36, m.footTop + m.legLength * 0.62, m.legDepth * 0.3)));
    parts.push(box('thighBuckle', BodyRegion.LEG_R, 'accent',
      v(m.legWidth * 0.82, m.legLength * 0.055, m.legDepth * 0.56),
      v(m.legX + m.legWidth * 0.36, m.footTop + m.legLength * 0.75, m.legDepth * 0.3)));
    parts.push(box('thighPouchLip', BodyRegion.LEG_R, 'secondary',
      v(m.legWidth * 0.8, m.legLength * 0.05, m.legDepth * 0.56),
      v(m.legX + m.legWidth * 0.36, m.footTop + m.legLength * 0.49, m.legDepth * 0.3)));
    parts.push(box('thighStrapL', BodyRegion.LEG_L, 'detail',
      v(m.legWidth * 1.08, m.legLength * 0.07, m.legDepth * 1.08),
      v(-m.legX, m.footTop + m.legLength * 0.6, 0)));
  },

  [Feature.KNEE_PADS](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.LEG_L : BodyRegion.LEG_R;
      const sfx = side < 0 ? 'L' : 'R';
      parts.push(bevelBox(`kneePad${sfx}`, tag, 'secondary',
        v(m.legWidth * 1.0, m.legLength * 0.16, m.legDepth * 0.5),
        v(side * m.legX, m.footTop + m.legLength * 0.46, m.legDepth * 0.4)));
      parts.push(box(`kneeTrim${sfx}`, tag, 'accent',
        v(m.legWidth * 1.02, m.legLength * 0.04, m.legDepth * 0.52),
        v(side * m.legX, m.footTop + m.legLength * 0.54, m.legDepth * 0.4)));
    }
  },

  [Feature.COMBAT_BOOTS](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.LEG_L : BodyRegion.LEG_R;
      const sfx = side < 0 ? 'L' : 'R';
      // Shaft, folded cuff, buckle strap, then a proud sole. Four bands up the lower leg
      // instead of one slab, which is what makes a boot read as a boot.
      parts.push(bevelBox(`boot${sfx}`, tag, 'detail',
        v(m.legWidth * 1.16, m.legLength * 0.32, m.legDepth * 1.1),
        v(side * m.legX, m.footTop + m.legLength * 0.17, m.legDepth * 0.04)));
      parts.push(bevelBox(`bootCuff${sfx}`, tag, 'detail',
        v(m.legWidth * 1.26, m.legLength * 0.09, m.legDepth * 1.2),
        v(side * m.legX, m.footTop + m.legLength * 0.34, m.legDepth * 0.04)));
      parts.push(box(`bootStrap${sfx}`, tag, 'accent',
        v(m.legWidth * 1.3, m.legLength * 0.045, m.legDepth * 1.24),
        v(side * m.legX, m.footTop + m.legLength * 0.24, m.legDepth * 0.04)));
      parts.push(box(`bootSole${sfx}`, tag, 'accent',
        v(m.legWidth * 1.24, m.footTop * 0.8, m.legDepth * 1.55),
        v(side * m.legX, m.footTop * 0.4, m.legDepth * 0.26)));
    }
  },

  [Feature.UTILITY_BELT](m, parts) {
    parts.push(bevelBox('belt', BodyRegion.HIPS, 'detail',
      v(m.hipWidth * 1.1, m.torsoHeight * 0.13, m.torsoDepth * 1.08),
      v(0, m.hipTop + m.torsoHeight * 0.06, 0)));
    parts.push(box('buckle', BodyRegion.HIPS, 'accent',
      v(m.hipWidth * 0.34, m.torsoHeight * 0.15, m.torsoDepth * 0.3),
      v(0, m.hipTop + m.torsoHeight * 0.06, m.torsoDepth * 0.58)));
    parts.push(bevelBox('hipPouch', BodyRegion.HIPS, 'detail',
      v(m.hipWidth * 0.32, m.torsoHeight * 0.22, m.torsoDepth * 0.44),
      v(-m.hipWidth * 0.56, m.hipTop - m.torsoHeight * 0.04, m.torsoDepth * 0.18)));
  },

  [Feature.SHOULDER_STRAP](m, parts) {
    // One diagonal baldric. Asymmetry is the point: it breaks the left-right mirror that
    // makes a stylised figure look like a mannequin.
    parts.push(bevelBox('baldric', BodyRegion.TORSO, 'detail',
      v(m.shoulderWidth * 0.24, m.torsoHeight * 1.08, m.torsoDepth * 1.12),
      v(-m.shoulderWidth * 0.1, m.hipTop + m.torsoHeight * 0.52, 0),
      v(0, 0, 0.38)));
    parts.push(box('baldricClip', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.18, m.torsoHeight * 0.11, m.torsoDepth * 0.24),
      v(-m.shoulderWidth * 0.2, m.hipTop + m.torsoHeight * 0.66, m.torsoDepth * 0.6)));
    parts.push(box('baldricRing', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.14, m.torsoHeight * 0.08, m.torsoDepth * 0.22),
      v(-m.shoulderWidth * 0.02, m.hipTop + m.torsoHeight * 0.28, m.torsoDepth * 0.6)));
    parts.push(bevelBox('shoulderTab', BodyRegion.ARM_L, 'accent',
      v(m.armWidth * 1.34, m.armLength * 0.1, m.armDepth * 1.28),
      v(-m.armX, m.shoulderY - m.armLength * 0.08, 0)));
  },

  [Feature.NECK_WRAP](m, parts) {
    // Heavy wrap with a fold and a hanging tail: bulk at the neck broadens the shoulder
    // line, which is most of what makes a heavy frame read as heavy.
    // A standing collar around the wrap: the vertical at the neck is what reads as
    // military rather than as a scarf.
    parts.push(cylinder('neckWrap', BodyRegion.TORSO, 'detail',
      m.neckWidth * 1.34, m.neckLength * 1.8,
      v(0, m.shoulderY + m.neckLength * 0.44, 0)));
    parts.push(cylinder('collarStand', BodyRegion.TORSO, 'secondary',
      m.neckWidth * 1.32, m.neckLength * 0.95,
      v(0, m.shoulderY + m.neckLength * 0.92, 0), null, m.neckWidth * 1.16));
    // Narrow: a trim ring wider than the head reads as a lampshade rather than a collar.
    parts.push(box('collarTrim', BodyRegion.TORSO, 'accent',
      v(m.neckWidth * 2.3, m.neckLength * 0.13, m.neckWidth * 2.3),
      v(0, m.shoulderY + m.neckLength * 1.3, 0)));
    parts.push(bevelBox('wrapShoulder', BodyRegion.TORSO, 'detail',
      v(m.shoulderWidth * 0.5, m.neckLength * 0.8, m.torsoDepth * 1.02),
      v(0, m.shoulderY - m.neckLength * 0.2, 0)));
    parts.push(box('wrapFoldFront', BodyRegion.TORSO, 'detail',
      v(m.neckWidth * 1.6, m.neckLength * 1.1, m.neckWidth * 0.5),
      v(m.neckWidth * 0.34, m.shoulderY - m.neckLength * 0.2, m.neckWidth * 0.7),
      v(0, 0, -0.32)));
    parts.push(box('wrapTail', BodyRegion.BACK, 'detail',
      v(m.neckWidth * 0.9, m.torsoHeight * 0.5, m.neckWidth * 0.3),
      v(-m.neckWidth * 0.5, m.shoulderY - m.torsoHeight * 0.28, -m.torsoDepth * 0.6),
      v(0.14, 0, 0.12)));
  },

  [Feature.FACE_MARKINGS](m, parts) {
    const r = m.headRadius;
    // Painted markings, not wounds: brow flashes, cheek marks and a nose dot. Reads as
    // costume at any distance, which is what keeps it stylised rather than grim.
    for (const side of [-1, 1]) {
      const sfx = side < 0 ? 'L' : 'R';
      parts.push(box(`browMark${sfx}`, BodyRegion.HEAD, 'accent',
        v(r * 0.4, r * 0.11, r * 0.16),
        v(side * r * 0.38, m.headY + r * 0.36, r * 0.82), v(0, 0, side * 0.34)));
      parts.push(box(`cheekMark${sfx}`, BodyRegion.HEAD, 'accent',
        v(r * 0.13, r * 0.3, r * 0.14),
        v(side * r * 0.58, m.headY - r * 0.18, r * 0.74)));
    }
    parts.push(box('noseDot', BodyRegion.HEAD, 'detail',
      v(r * 0.2, r * 0.16, r * 0.14),
      v(0, m.headY - r * 0.14, r * 0.88)));
  },

  [Feature.SKULL_MASK](m, parts) {
    const r = m.headRadius;
    // A brow ridge, cheekbones and a separated jaw. The gap between brow and jaw is what
    // makes a skull read as a skull rather than as a painted face.
    parts.push(sphere('maskShell', BodyRegion.HEAD, 'detail', r * 1.06,
      v(0, m.headY + r * 0.06, -r * 0.04)));
    parts.push(bevelBox('maskBrow', BodyRegion.HEAD, 'skin',
      v(r * 1.54, r * 0.62, r * 0.42),
      v(0, m.headY + r * 0.34, r * 0.76)));
    parts.push(bevelBox('maskMid', BodyRegion.HEAD, 'skin',
      v(r * 1.1, r * 0.34, r * 0.4),
      v(0, m.headY - r * 0.12, r * 0.82)));
    parts.push(bevelBox('maskJaw', BodyRegion.HEAD, 'skin',
      v(r * 1.16, r * 0.42, r * 0.38),
      v(0, m.headY - r * 0.62, r * 0.74)));
    for (const side of [-1, 1]) {
      const sfx = side < 0 ? 'L' : 'R';
      parts.push(bevelBox(`maskCheek${sfx}`, BodyRegion.HEAD, 'skin',
        v(r * 0.36, r * 0.5, r * 0.4),
        v(side * r * 0.66, m.headY - r * 0.2, r * 0.58), v(0, 0, side * 0.2)));
      parts.push(box(`maskSocket${sfx}`, BodyRegion.HEAD, 'visor',
        v(r * 0.38, r * 0.36, r * 0.2),
        v(side * r * 0.36, m.headY + r * 0.02, r * 0.96), null, true));
    }
    // Teeth: one bar with cut marks reads better at distance than modelled teeth.
    parts.push(box('maskTeeth', BodyRegion.HEAD, 'visor',
      v(r * 0.8, r * 0.12, r * 0.18),
      v(0, m.headY - r * 0.46, r * 0.92), null, true));
  },

  [Feature.BONE_PATTERN](m, parts) {
    // A stylised but ANATOMICAL skeleton: collar, sternum, a rib cage that tapers, a
    // pelvic girdle, and limb bones. Schematic enough to hold at distance, structured
    // enough to read as a body rather than as stripes.
    const ribs = [0.34, 0.48, 0.62, 0.76];
    ribs.forEach((t, i) => {
      // The cage narrows downward, as a real one does — a stack of equal bars does not
      // read as a rib cage at any distance.
      const width = m.shoulderWidth * (0.86 - i * 0.1);
      parts.push(box(`rib${i}`, BodyRegion.TORSO, 'accent',
        v(width, m.torsoHeight * 0.065, m.torsoDepth * 1.14),
        v(0, m.hipTop + m.torsoHeight * t, m.torsoDepth * 0.04), null, true));
    });
    parts.push(box('collarBone', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.92, m.torsoHeight * 0.08, m.torsoDepth * 1.14),
      v(0, m.shoulderY - m.torsoHeight * 0.08, m.torsoDepth * 0.04), null, true));
    parts.push(box('sternum', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.13, m.torsoHeight * 0.5, m.torsoDepth * 1.14),
      v(0, m.hipTop + m.torsoHeight * 0.56, m.torsoDepth * 0.04), null, true));

    // Pelvic girdle: two wings and a centre, sat on the hip line.
    parts.push(box('pelvisCentre', BodyRegion.HIPS, 'accent',
      v(m.hipWidth * 0.2, m.torsoHeight * 0.16, m.torsoDepth * 1.0),
      v(0, m.hipTop - m.torsoHeight * 0.06, 0), null, true));
    for (const side of [-1, 1]) {
      parts.push(box(`pelvisWing${side < 0 ? 'L' : 'R'}`, BodyRegion.HIPS, 'accent',
        v(m.hipWidth * 0.4, m.torsoHeight * 0.1, m.torsoDepth * 1.0),
        v(side * m.hipWidth * 0.3, m.hipTop + m.torsoHeight * 0.02, 0),
        v(0, 0, side * 0.24), true));
    }

    parts.push(box('spineBacking', BodyRegion.BACK, 'secondary',
      v(m.shoulderWidth * 0.34, m.torsoHeight * 0.94, m.torsoDepth * 0.16),
      v(0, m.hipTop + m.torsoHeight * 0.5, -m.torsoDepth * 0.54)));
    // Vertebrae rather than one bar: the spine is the read from behind.
    for (let i = 0; i < 5; i++) {
      parts.push(box(`vertebra${i}`, BodyRegion.BACK, 'accent',
        v(m.shoulderWidth * (0.2 - i * 0.014), m.torsoHeight * 0.1, m.torsoDepth * 0.12),
        v(0, m.hipTop + m.torsoHeight * (0.16 + i * 0.19), -m.torsoDepth * 0.58),
        null, true));
    }

    for (const side of [-1, 1]) {
      const armTag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      const legTag = side < 0 ? BodyRegion.LEG_L : BodyRegion.LEG_R;
      const sfx = side < 0 ? 'L' : 'R';
      parts.push(box(`humerus${sfx}`, armTag, 'accent',
        v(m.armWidth * 0.34, m.armLength * 0.44, m.armDepth * 1.06),
        v(side * m.armX, m.shoulderY - m.armLength * 0.28, 0), null, true));
      parts.push(box(`radius${sfx}`, armTag, 'accent',
        v(m.armWidth * 0.2, m.armLength * 0.36, m.armDepth * 0.98),
        v(side * (m.armX - m.armWidth * 0.16), m.shoulderY - m.armLength * 0.78, 0),
        null, true));
      parts.push(box(`ulna${sfx}`, armTag, 'accent',
        v(m.armWidth * 0.2, m.armLength * 0.36, m.armDepth * 0.98),
        v(side * (m.armX + m.armWidth * 0.16), m.shoulderY - m.armLength * 0.78, 0),
        null, true));
      parts.push(box(`femur${sfx}`, legTag, 'accent',
        v(m.legWidth * 0.32, m.legLength * 0.42, m.legDepth * 1.06),
        v(side * m.legX, m.footTop + m.legLength * 0.74, 0), null, true));
      parts.push(box(`patella${sfx}`, legTag, 'accent',
        v(m.legWidth * 0.44, m.legLength * 0.06, m.legDepth * 1.02),
        v(side * m.legX, m.footTop + m.legLength * 0.5, 0), null, true));
      parts.push(box(`tibia${sfx}`, legTag, 'accent',
        v(m.legWidth * 0.28, m.legLength * 0.36, m.legDepth * 0.96),
        v(side * m.legX, m.footTop + m.legLength * 0.26, 0), null, true));
    }
  },

  /* ── costume layering — SKIN_SPEC §6.4 ─────────────────────────────────── */

  [Feature.SHOULDER_CAPS](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      const sfx = side < 0 ? 'L' : 'R';
      // A rounded deltoid cap. Rounding the shoulder corner is the cheapest single fix
      // for a figure that reads as a stack of boxes.
      parts.push(bevelBox(`deltoid${sfx}`, tag, 'primary',
        v(m.armWidth * 1.26, m.armLength * 0.18, m.armDepth * 1.22),
        v(side * m.armX, m.shoulderY - m.armLength * 0.07, 0),
        v(0, 0, side * 0.1)));
      parts.push(bevelBox(`capTrim${sfx}`, tag, 'accent',
        v(m.armWidth * 1.2, m.armLength * 0.045, m.armDepth * 1.16),
        v(side * m.armX, m.shoulderY - m.armLength * 0.14, 0)));
    }
  },

  [Feature.TORSO_TAPER](m, parts) {
    // A chest plate that narrows toward the waist, laid over the trunk. The taper is the
    // whole point: a straight-sided torso is what makes a stylised figure look like a box.
    parts.push(cylinder('trunkTaper', BodyRegion.TORSO, 'primary',
      m.shoulderWidth * 0.5, m.torsoHeight * 0.66,
      v(0, m.hipTop + m.torsoHeight * 0.58, -m.torsoDepth * 0.08),
      null, m.shoulderWidth * 0.36));
    // Narrow, and set high on the chest: a full-width plate here buries anything else
    // drawn on the trunk — it is what hid Voidmarrow's own rib cage.
    parts.push(bevelBox('chestPlate', BodyRegion.TORSO, 'secondary',
      v(m.shoulderWidth * 0.34, m.torsoHeight * 0.2, m.torsoDepth * 0.26),
      v(0, m.hipTop + m.torsoHeight * 0.86, m.torsoDepth * 0.54)));
  },

  [Feature.BELT_RIG](m, parts) {
    // A layered waist: belt, buckle, two side pouches at different heights, and a strap
    // hanging past the hip. Four pieces where a belt used to be one.
    parts.push(bevelBox('rigBelt', BodyRegion.HIPS, 'detail',
      v(m.hipWidth * 1.16, m.torsoHeight * 0.15, m.torsoDepth * 1.1),
      v(0, m.hipTop + m.torsoHeight * 0.04, 0)));
    parts.push(bevelBox('rigBuckle', BodyRegion.HIPS, 'accent',
      v(m.hipWidth * 0.3, m.torsoHeight * 0.17, m.torsoDepth * 0.26),
      v(0, m.hipTop + m.torsoHeight * 0.04, m.torsoDepth * 0.6)));
    parts.push(bevelBox('rigPouchL', BodyRegion.HIPS, 'detail',
      v(m.hipWidth * 0.3, m.torsoHeight * 0.24, m.torsoDepth * 0.46),
      v(-m.hipWidth * 0.58, m.hipTop - m.torsoHeight * 0.06, m.torsoDepth * 0.14)));
    parts.push(bevelBox('rigPouchR', BodyRegion.HIPS, 'detail',
      v(m.hipWidth * 0.24, m.torsoHeight * 0.18, m.torsoDepth * 0.4),
      v(m.hipWidth * 0.58, m.hipTop + m.torsoHeight * 0.02, m.torsoDepth * 0.1)));
    parts.push(box('rigStrapDrop', BodyRegion.HIPS, 'accent',
      v(m.hipWidth * 0.12, m.torsoHeight * 0.3, m.torsoDepth * 0.2),
      v(m.hipWidth * 0.22, m.hipTop - m.torsoHeight * 0.12, m.torsoDepth * 0.56),
      v(0, 0, -0.1)));
  },

  [Feature.HIP_FLAPS](m, parts) {
    // Asymmetric flaps: a long one on one hip, a short one on the other. Equal flaps
    // read as a skirt; unequal ones read as a coat that has been moving.
    parts.push(bevelBox('flapL', BodyRegion.HIPS, 'secondary',
      v(m.hipWidth * 0.42, m.legLength * 0.4, m.torsoDepth * 0.26),
      v(-m.hipWidth * 0.5, m.hipTop - m.legLength * 0.18, m.torsoDepth * 0.1),
      v(0, 0, 0.12)));
    parts.push(bevelBox('flapR', BodyRegion.HIPS, 'secondary',
      v(m.hipWidth * 0.36, m.legLength * 0.24, m.torsoDepth * 0.24),
      v(m.hipWidth * 0.52, m.hipTop - m.legLength * 0.1, m.torsoDepth * 0.06),
      v(0, 0, -0.16)));
    parts.push(box('flapTrimL', BodyRegion.HIPS, 'accent',
      v(m.hipWidth * 0.44, m.legLength * 0.035, m.torsoDepth * 0.28),
      v(-m.hipWidth * 0.5, m.hipTop - m.legLength * 0.37, m.torsoDepth * 0.1),
      v(0, 0, 0.12)));
  },

  [Feature.ARM_WRAPS](m, parts) {
    // Wrapped forearms, one heavier than the other — a wrap is not a uniform.
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      const sfx = side < 0 ? 'L' : 'R';
      const bands = side < 0 ? 3 : 2;
      for (let i = 0; i < bands; i++) {
        parts.push(bevelBox(`wrap${sfx}${i}`, tag, 'secondary',
          v(m.armWidth * 1.12, m.armLength * 0.08, m.armDepth * 1.12),
          v(side * m.armX, m.shoulderY - m.armLength * (0.62 + i * 0.1), 0),
          v(0, 0, side * 0.04)));
      }
    }
  },

  [Feature.THIGH_STRAPS](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.LEG_L : BodyRegion.LEG_R;
      const sfx = side < 0 ? 'L' : 'R';
      parts.push(bevelBox(`thighCinch${sfx}`, tag, 'detail',
        v(m.legWidth * 1.1, m.legLength * 0.06, m.legDepth * 1.1),
        v(side * m.legX, m.footTop + m.legLength * 0.86, 0)));
    }
  },

  [Feature.ASSAULT_HELMET](m, parts) {
    const r = m.headRadius;
    // A domed shell with a rear shroud, a brow rail and a side rail. Distinct from the
    // roster's plain `helmet`, which other outfits use and this pass must not touch.
    // Deliberately oversized: this helmet is worn only by the heavy frame, and a broad
    // body under a standard-sized head reads as a doll rather than as an operator.
    parts.push(sphere('assaultShell', BodyRegion.HEAD, 'detail', r * 1.46,
      v(0, m.headY + r * 0.3, -r * 0.04)));
    parts.push(bevelBox('assaultJaw', BodyRegion.HEAD, 'detail',
      v(r * 2.2, r * 0.8, r * 2.0),
      v(0, m.headY - r * 0.36, 0)));
    parts.push(bevelBox('assaultShroud', BodyRegion.HEAD, 'detail',
      v(r * 2.3, r * 1.1, r * 0.8),
      v(0, m.headY - r * 0.24, -r * 1.1), v(0.18, 0, 0)));
    parts.push(bevelBox('assaultBrow', BodyRegion.HEAD, 'accent',
      v(r * 2.36, r * 0.26, r * 0.56),
      v(0, m.headY + r * 0.46, r * 0.92)));
    parts.push(box('assaultVisorGap', BodyRegion.HEAD, 'visor',
      v(r * 1.5, r * 0.3, r * 0.2),
      v(0, m.headY + r * 0.08, r * 1.0)));
    parts.push(wedge('assaultPeak', BodyRegion.HEAD, 'detail',
      v(r * 2.3, r * 0.3, r * 0.86),
      v(0, m.headY + r * 0.74, r * 0.86)));
    parts.push(bevelBox('assaultChinBar', BodyRegion.HEAD, 'secondary',
      v(r * 1.72, r * 0.3, r * 0.44),
      v(0, m.headY - r * 0.74, r * 0.84)));
    parts.push(box('assaultCrest', BodyRegion.HEAD, 'accent',
      v(r * 0.24, r * 0.26, r * 2.3),
      v(0, m.headY + r * 1.5, -r * 0.06)));
    for (const side of [-1, 1]) {
      parts.push(bevelBox(`assaultRail${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'secondary',
        v(r * 0.26, r * 0.4, r * 1.5),
        v(side * r * 1.32, m.headY + r * 0.3, -r * 0.08)));
    }
  },

  [Feature.SWEPT_HAIR](m, parts) {
    const r = m.headRadius;
    // Long, asymmetric and moving: a back mass, a swept crown, one forward lock over the
    // shoulder and a shorter one on the other side. The unevenness is the silhouette.
    // Trimmed in the 1.3.1 polish: the mass AROUND the skull came down, the length and
    // the asymmetry did not. The back fall still carries the silhouette.
    parts.push(bevelBox('hairBack', BodyRegion.HEAD, 'hair',
      v(r * 1.64, r * 2.62, r * 0.6),
      v(0, m.headY - r * 1.04, -r * 0.94)));
    parts.push(bevelBox('hairSweep', BodyRegion.HEAD, 'hair',
      v(r * 1.86, r * 0.56, r * 1.14),
      v(r * 0.2, m.headY + r * 0.92, -r * 0.1), v(0, 0, -0.22)));
    // Locks sit OUTSIDE the cheek line and behind the face plane, so they frame the face
    // rather than closing over it.
    parts.push(bevelBox('hairLockLong', BodyRegion.HEAD, 'hair',
      v(r * 0.46, r * 2.36, r * 0.42),
      v(-r * 1.06, m.headY - r * 0.94, r * 0.12), v(0, 0, 0.08)));
    parts.push(bevelBox('hairLockShort', BodyRegion.HEAD, 'hair',
      v(r * 0.38, r * 1.34, r * 0.38),
      v(r * 1.08, m.headY - r * 0.46, r * 0.1), v(0, 0, -0.1)));
    parts.push(box('hairTip', BodyRegion.HEAD, 'accent',
      v(r * 0.56, r * 0.22, r * 0.5),
      v(-r * 1.12, m.headY - r * 2.06, r * 0.14)));
  },

  [Feature.FITTED_TORSO](m, parts) {
    // Goldspar's shoulder treatment: a narrow fitted cap instead of the broad
    // `shoulderCaps`, plus a cinched waist. A narrower shoulder read with a stronger
    // waist taper is what turns a boxy trunk into a figure.
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      const sfx = side < 0 ? 'L' : 'R';
      parts.push(bevelBox(`fittedCap${sfx}`, tag, 'primary',
        v(m.armWidth * 1.06, m.armLength * 0.15, m.armDepth * 1.04),
        v(side * m.armX, m.shoulderY - m.armLength * 0.08, 0),
        v(0, 0, side * 0.14)));
      parts.push(box(`fittedPiping${sfx}`, tag, 'accent',
        v(m.armWidth * 1.0, m.armLength * 0.035, m.armDepth * 1.0),
        v(side * m.armX, m.shoulderY - m.armLength * 0.16, 0)));
    }
    // The cinch: a narrow band low on the trunk, with a panel above it that narrows into
    // it. Two pieces, and the waist reads.
    parts.push(cylinder('waistCinch', BodyRegion.TORSO, 'detail',
      m.shoulderWidth * 0.34, m.torsoHeight * 0.14,
      v(0, m.hipTop + m.torsoHeight * 0.2, 0), null, m.shoulderWidth * 0.31));
    parts.push(cylinder('waistPanel', BodyRegion.TORSO, 'primary',
      m.shoulderWidth * 0.44, m.torsoHeight * 0.34,
      v(0, m.hipTop + m.torsoHeight * 0.42, 0), null, m.shoulderWidth * 0.33));
    parts.push(box('cinchClasp', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.16, m.torsoHeight * 0.1, m.torsoDepth * 0.26),
      v(0, m.hipTop + m.torsoHeight * 0.2, m.torsoDepth * 0.5)));
  },

  [Feature.PAULDRONS](m, parts) {
    // Coalcrest's shoulder treatment: hard angular plates sitting proud of the deltoid,
    // with a trim edge and a strap under them. Squaring off the shoulder line is what
    // makes a heavy frame read as armoured rather than merely wide.
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      const sfx = side < 0 ? 'L' : 'R';
      parts.push(bevelBox(`pauldron${sfx}`, tag, 'secondary',
        v(m.armWidth * 1.66, m.armLength * 0.28, m.armDepth * 1.5),
        v(side * (m.armX + m.armWidth * 0.14), m.shoulderY - m.armLength * 0.02, 0),
        v(0, 0, side * 0.16)));
      parts.push(bevelBox(`pauldronLip${sfx}`, tag, 'detail',
        v(m.armWidth * 1.5, m.armLength * 0.1, m.armDepth * 1.38),
        v(side * (m.armX + m.armWidth * 0.16), m.shoulderY - m.armLength * 0.19, 0),
        v(0, 0, side * 0.16)));
      parts.push(box(`pauldronTrim${sfx}`, tag, 'accent',
        v(m.armWidth * 1.42, m.armLength * 0.045, m.armDepth * 1.3),
        v(side * (m.armX + m.armWidth * 0.18), m.shoulderY + m.armLength * 0.09, 0)));
    }
    // A yoke across the back, tying the two plates into one shoulder line.
    parts.push(bevelBox('shoulderYoke', BodyRegion.BACK, 'secondary',
      v(m.shoulderWidth * 1.02, m.torsoHeight * 0.16, m.torsoDepth * 0.3),
      v(0, m.shoulderY - m.torsoHeight * 0.1, -m.torsoDepth * 0.44)));
  },

  [Feature.PAINTED_GRIN](m, parts) {
    const r = m.headRadius;
    // A painted mouth: a bar with vertical stitches across it. Reads as face paint at
    // distance and as a grin up close, without modelling a mouth.
    parts.push(box('grinBar', BodyRegion.HEAD, 'accent',
      v(r * 0.56, r * 0.1, r * 0.14),
      v(0, m.headY - r * 0.52, r * 0.86)));
    for (const i of [-1, 0, 1]) {
      parts.push(box(`grinStitch${i + 1}`, BodyRegion.HEAD, 'detail',
        v(r * 0.05, r * 0.18, r * 0.12),
        v(i * r * 0.16, m.headY - r * 0.52, r * 0.9)));
    }
  }
};

/** Feature names the rig knows how to build. */
export const SUPPORTED_FEATURES = Object.freeze(Object.keys(FEATURE_BUILDERS).sort());

/**
 * Build the full part list for a skin.
 *
 * Deterministic: the same skin always yields an identical list, in an identical order
 * (SKIN_SPEC §9.6). Parts are emitted back-to-front by construction and then depth-sorted,
 * so a 2D consumer can paint them in array order without knowing anything about the rig.
 *
 * @param {object|string} skinOrId
 * @returns {{skin: object, metrics: object, parts: Array}}
 */
export function buildCharacterRig(skinOrId) {
  const skin = typeof skinOrId === 'string' ? skinOrFallback(skinOrId) : (skinOrId ?? skinOrFallback(null));
  const m = buildMetrics(skin.build);
  const parts = [];

  baseBody(m, parts);

  for (const feature of skin.features) {
    const builder = FEATURE_BUILDERS[feature];
    // An unknown feature is skipped rather than thrown: a profile saved against a future
    // roster must never break a running game.
    if (builder) builder(m, parts);
  }

  return { skin, metrics: m, parts: depthSort(parts) };
}
