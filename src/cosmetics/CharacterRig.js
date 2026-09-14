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
  box, sphere, cone, cylinder, wedge, v, repaint, depthSort
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

  /* ── operator kit — SKIN_SPEC §6.1 ────────────────────────────────────────
   * The pieces that make an outfit read as equipment rather than as clothing.
   * Each one is a real change to the outline, never a decal.
   */

  [Feature.AVIATOR_CAP](m, parts) {
    // A soft leather cap hugging the skull, with ear flaps down the jaw line — the
    // outline that says "pilot" before any colour resolves.
    parts.push(sphere('capShell', BodyRegion.HEAD, 'detail', m.headRadius * 1.1,
      v(0, m.headY + m.headRadius * 0.3, -m.headRadius * 0.08)));
    parts.push(box('capBrowBand', BodyRegion.HEAD, 'detail',
      v(m.headRadius * 2.06, m.headRadius * 0.34, m.headRadius * 2.0),
      v(0, m.headY + m.headRadius * 0.52, 0)));
    for (const side of [-1, 1]) {
      parts.push(box(`capFlap${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'detail',
        v(m.headRadius * 0.44, m.headRadius * 1.24, m.headRadius * 1.1),
        v(side * m.headRadius * 0.92, m.headY - m.headRadius * 0.42, -m.headRadius * 0.12)));
      parts.push(box(`capBuckle${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'accent',
        v(m.headRadius * 0.2, m.headRadius * 0.2, m.headRadius * 0.2),
        v(side * m.headRadius * 1.02, m.headY - m.headRadius * 0.82, m.headRadius * 0.2)));
    }
    parts.push(box('capStrap', BodyRegion.HEAD, 'detail',
      v(m.headRadius * 0.28, m.headRadius * 1.5, m.headRadius * 0.3),
      v(-m.headRadius * 0.2, m.headY - m.headRadius * 1.1, m.headRadius * 0.34),
      v(0, 0, 0.12)));
  },

  [Feature.BROW_GOGGLES](m, parts) {
    // Goggles pushed UP onto the brow rather than worn over the eyes: the face stays
    // readable and the goggles still break the head's outline.
    parts.push(box('browStrap', BodyRegion.HEAD, 'detail',
      v(m.headRadius * 2.16, m.headRadius * 0.3, m.headRadius * 2.0),
      v(0, m.headY + m.headRadius * 0.86, 0)));
    for (const side of [-1, 1]) {
      parts.push(cylinder(`browLens${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'visor',
        m.headRadius * 0.36, m.headRadius * 0.26,
        v(side * m.headRadius * 0.44, m.headY + m.headRadius * 0.92, m.headRadius * 0.74),
        v(Math.PI / 2, 0, 0)));
      parts.push(cylinder(`browRim${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'accent',
        m.headRadius * 0.42, m.headRadius * 0.14,
        v(side * m.headRadius * 0.44, m.headY + m.headRadius * 0.92, m.headRadius * 0.66),
        v(Math.PI / 2, 0, 0)));
    }
  },

  [Feature.HEAD_WRAP](m, parts) {
    // A cloth wrap: taller and softer than a cap, with a knot off to one side.
    parts.push(sphere('wrapCrown', BodyRegion.HEAD, 'hair', m.headRadius * 1.16,
      v(0, m.headY + m.headRadius * 0.5, -m.headRadius * 0.06)));
    parts.push(box('wrapBand', BodyRegion.HEAD, 'hair',
      v(m.headRadius * 2.12, m.headRadius * 0.5, m.headRadius * 2.04),
      v(0, m.headY + m.headRadius * 0.56, 0)));
    parts.push(sphere('wrapKnot', BodyRegion.HEAD, 'hair', m.headRadius * 0.34,
      v(m.headRadius * 0.94, m.headY + m.headRadius * 0.9, -m.headRadius * 0.5)));
  },

  [Feature.TANK_TOP](m, parts) {
    // Sleeveless: defined by what it leaves bare. The vest is a narrower slab over the
    // chest so the shoulders read as skin from any angle.
    repaint(parts, ['upperArmL', 'upperArmR', 'foreArmL', 'foreArmR'], 'skin');
    parts.push(box('vest', BodyRegion.TORSO, 'primary',
      v(m.shoulderWidth * 0.82, m.torsoHeight * 0.94, m.torsoDepth * 1.06),
      v(0, m.hipTop + m.torsoHeight * 0.48, 0)));
    for (const side of [-1, 1]) {
      parts.push(box(`vestStrap${side < 0 ? 'L' : 'R'}`, BodyRegion.TORSO, 'primary',
        v(m.shoulderWidth * 0.2, m.torsoHeight * 0.3, m.torsoDepth * 1.08),
        v(side * m.shoulderWidth * 0.3, m.hipTop + m.torsoHeight * 0.86, 0)));
    }
  },

  [Feature.FINGERLESS_GLOVES](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      const suffix = side < 0 ? 'L' : 'R';
      // The glove covers the wrist and palm; the base hand stays skin below it, which is
      // what makes it read as fingerless rather than as a mitten.
      parts.push(box(`glove${suffix}`, tag, 'detail',
        v(m.armWidth * 1.08, m.armLength * 0.14, m.armDepth * 1.08),
        v(side * m.armX, m.shoulderY - m.armLength * 0.97, 0)));
      parts.push(box(`gloveCuff${suffix}`, tag, 'detail',
        v(m.armWidth * 1.16, m.armLength * 0.1, m.armDepth * 1.16),
        v(side * m.armX, m.shoulderY - m.armLength * 0.86, 0)));
    }
  },

  [Feature.THIGH_RIG](m, parts) {
    // Strapped thigh pouches, asymmetric on purpose: one side carries, the other does
    // not. Symmetry here would read as a uniform rather than as kit.
    parts.push(box('thighPouch', BodyRegion.LEG_R, 'detail',
      v(m.legWidth * 0.72, m.legLength * 0.26, m.legDepth * 0.5),
      v(m.legX + m.legWidth * 0.34, m.footTop + m.legLength * 0.62, m.legDepth * 0.3)));
    parts.push(box('thighBuckle', BodyRegion.LEG_R, 'accent',
      v(m.legWidth * 0.76, m.legLength * 0.05, m.legDepth * 0.54),
      v(m.legX + m.legWidth * 0.34, m.footTop + m.legLength * 0.74, m.legDepth * 0.3)));
    parts.push(box('thighStrapL', BodyRegion.LEG_L, 'detail',
      v(m.legWidth * 1.04, m.legLength * 0.06, m.legDepth * 1.04),
      v(-m.legX, m.footTop + m.legLength * 0.6, 0)));
  },

  [Feature.KNEE_PADS](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.LEG_L : BodyRegion.LEG_R;
      parts.push(box(`kneePad${side < 0 ? 'L' : 'R'}`, tag, 'accent',
        v(m.legWidth * 0.94, m.legLength * 0.14, m.legDepth * 0.44),
        v(side * m.legX, m.footTop + m.legLength * 0.46, m.legDepth * 0.42)));
    }
  },

  [Feature.COMBAT_BOOTS](m, parts) {
    for (const side of [-1, 1]) {
      const tag = side < 0 ? BodyRegion.LEG_L : BodyRegion.LEG_R;
      const suffix = side < 0 ? 'L' : 'R';
      parts.push(box(`boot${suffix}`, tag, 'detail',
        v(m.legWidth * 1.14, m.legLength * 0.3, m.legDepth * 1.08),
        v(side * m.legX, m.footTop + m.legLength * 0.16, m.legDepth * 0.04)));
      parts.push(box(`bootCuff${suffix}`, tag, 'detail',
        v(m.legWidth * 1.22, m.legLength * 0.07, m.legDepth * 1.16),
        v(side * m.legX, m.footTop + m.legLength * 0.31, m.legDepth * 0.04)));
      parts.push(box(`bootSole${suffix}`, tag, 'accent',
        v(m.legWidth * 1.2, m.footTop * 0.7, m.legDepth * 1.5),
        v(side * m.legX, m.footTop * 0.35, m.legDepth * 0.26)));
    }
  },

  [Feature.UTILITY_BELT](m, parts) {
    parts.push(box('belt', BodyRegion.HIPS, 'detail',
      v(m.hipWidth * 1.08, m.torsoHeight * 0.12, m.torsoDepth * 1.06),
      v(0, m.hipTop + m.torsoHeight * 0.06, 0)));
    parts.push(box('buckle', BodyRegion.HIPS, 'accent',
      v(m.hipWidth * 0.32, m.torsoHeight * 0.13, m.torsoDepth * 0.3),
      v(0, m.hipTop + m.torsoHeight * 0.06, m.torsoDepth * 0.56)));
    parts.push(box('hipPouch', BodyRegion.HIPS, 'detail',
      v(m.hipWidth * 0.3, m.torsoHeight * 0.2, m.torsoDepth * 0.42),
      v(-m.hipWidth * 0.54, m.hipTop - m.torsoHeight * 0.04, m.torsoDepth * 0.18)));
  },

  [Feature.SHOULDER_STRAP](m, parts) {
    // One diagonal strap across the chest. Asymmetry is the point: it breaks the
    // left-right mirror that makes a stylised figure look like a mannequin.
    parts.push(box('baldric', BodyRegion.TORSO, 'detail',
      v(m.shoulderWidth * 0.22, m.torsoHeight * 1.06, m.torsoDepth * 1.1),
      v(-m.shoulderWidth * 0.1, m.hipTop + m.torsoHeight * 0.52, 0),
      v(0, 0, 0.38)));
    parts.push(box('baldricClip', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.16, m.torsoHeight * 0.1, m.torsoDepth * 0.22),
      v(-m.shoulderWidth * 0.2, m.hipTop + m.torsoHeight * 0.66, m.torsoDepth * 0.58)));
    parts.push(box('shoulderTab', BodyRegion.ARM_L, 'accent',
      v(m.armWidth * 1.3, m.armLength * 0.09, m.armDepth * 1.24),
      v(-m.armX, m.shoulderY - m.armLength * 0.08, 0)));
  },

  [Feature.NECK_WRAP](m, parts) {
    parts.push(cylinder('neckWrap', BodyRegion.TORSO, 'detail',
      m.neckWidth * 1.12, m.neckLength * 1.5,
      v(0, m.shoulderY + m.neckLength * 0.34, 0)));
    parts.push(box('wrapFold', BodyRegion.TORSO, 'detail',
      v(m.neckWidth * 1.5, m.neckLength * 0.9, m.neckWidth * 0.5),
      v(m.neckWidth * 0.3, m.shoulderY - m.neckLength * 0.1, m.neckWidth * 0.62),
      v(0, 0, -0.3)));
  },

  [Feature.FACE_MARKINGS](m, parts) {
    // Painted markings, not wounds: a brow flash over each eye and a stitched jaw line.
    // Reads as costume at any distance, which is what keeps it stylised rather than grim.
    for (const side of [-1, 1]) {
      parts.push(box(`browMark${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'accent',
        v(m.headRadius * 0.36, m.headRadius * 0.1, m.headRadius * 0.16),
        v(side * m.headRadius * 0.38, m.headY + m.headRadius * 0.34, m.headRadius * 0.82),
        v(0, 0, side * 0.3)));
      parts.push(box(`cheekMark${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'accent',
        v(m.headRadius * 0.12, m.headRadius * 0.26, m.headRadius * 0.14),
        v(side * m.headRadius * 0.56, m.headY - m.headRadius * 0.2, m.headRadius * 0.74)));
    }
    parts.push(box('jawStitch', BodyRegion.HEAD, 'accent',
      v(m.headRadius * 0.78, m.headRadius * 0.09, m.headRadius * 0.16),
      v(0, m.headY - m.headRadius * 0.5, m.headRadius * 0.78)));
  },

  [Feature.SKULL_MASK](m, parts) {
    parts.push(sphere('maskShell', BodyRegion.HEAD, 'detail', m.headRadius * 1.04,
      v(0, m.headY + m.headRadius * 0.06, -m.headRadius * 0.04)));
    parts.push(box('maskBrow', BodyRegion.HEAD, 'skin',
      v(m.headRadius * 1.5, m.headRadius * 0.9, m.headRadius * 0.4),
      v(0, m.headY + m.headRadius * 0.18, m.headRadius * 0.78)));
    parts.push(box('maskJaw', BodyRegion.HEAD, 'skin',
      v(m.headRadius * 1.1, m.headRadius * 0.5, m.headRadius * 0.34),
      v(0, m.headY - m.headRadius * 0.52, m.headRadius * 0.74)));
    for (const side of [-1, 1]) {
      parts.push(box(`maskSocket${side < 0 ? 'L' : 'R'}`, BodyRegion.HEAD, 'visor',
        v(m.headRadius * 0.34, m.headRadius * 0.34, m.headRadius * 0.18),
        v(side * m.headRadius * 0.36, m.headY + m.headRadius * 0.12, m.headRadius * 0.96),
        null, true));
    }
  },

  [Feature.BONE_PATTERN](m, parts) {
    // A rib cage, a spine and limb bones, all self-lit. The pattern is deliberately
    // schematic — four ribs, not twelve — so it stays a shape at distance rather than
    // dissolving into stripes.
    const ribs = [0.30, 0.46, 0.62, 0.78];
    ribs.forEach((t, i) => {
      const width = m.shoulderWidth * (0.82 - i * 0.08);
      parts.push(box(`rib${i}`, BodyRegion.TORSO, 'accent',
        v(width, m.torsoHeight * 0.07, m.torsoDepth * 1.06),
        v(0, m.hipTop + m.torsoHeight * t, 0), null, true));
    });
    parts.push(box('sternum', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.12, m.torsoHeight * 0.56, m.torsoDepth * 1.07),
      v(0, m.hipTop + m.torsoHeight * 0.54, 0), null, true));
    parts.push(box('collarBone', BodyRegion.TORSO, 'accent',
      v(m.shoulderWidth * 0.9, m.torsoHeight * 0.08, m.torsoDepth * 1.07),
      v(0, m.shoulderY - m.torsoHeight * 0.08, 0), null, true));
    // A solid backing behind the spine. Without it the back carries emissive geometry and
    // nothing else, so from behind the glow floats with no body under it — the figure
    // loses its proportions exactly where §6.3 says it must not.
    parts.push(box('spineBacking', BodyRegion.BACK, 'secondary',
      v(m.shoulderWidth * 0.34, m.torsoHeight * 0.94, m.torsoDepth * 0.16),
      v(0, m.hipTop + m.torsoHeight * 0.5, -m.torsoDepth * 0.54)));
    parts.push(box('spine', BodyRegion.BACK, 'accent',
      v(m.shoulderWidth * 0.14, m.torsoHeight * 0.9, m.torsoDepth * 0.12),
      v(0, m.hipTop + m.torsoHeight * 0.5, -m.torsoDepth * 0.58), null, true));

    for (const side of [-1, 1]) {
      const armTag = side < 0 ? BodyRegion.ARM_L : BodyRegion.ARM_R;
      const legTag = side < 0 ? BodyRegion.LEG_L : BodyRegion.LEG_R;
      const suffix = side < 0 ? 'L' : 'R';
      parts.push(box(`humerus${suffix}`, armTag, 'accent',
        v(m.armWidth * 0.3, m.armLength * 0.46, m.armDepth * 1.04),
        v(side * m.armX, m.shoulderY - m.armLength * 0.28, 0), null, true));
      parts.push(box(`radius${suffix}`, armTag, 'accent',
        v(m.armWidth * 0.26, m.armLength * 0.38, m.armDepth * 0.96),
        v(side * m.armX, m.shoulderY - m.armLength * 0.78, 0), null, true));
      parts.push(box(`femur${suffix}`, legTag, 'accent',
        v(m.legWidth * 0.28, m.legLength * 0.44, m.legDepth * 1.04),
        v(side * m.legX, m.footTop + m.legLength * 0.74, 0), null, true));
      parts.push(box(`tibia${suffix}`, legTag, 'accent',
        v(m.legWidth * 0.26, m.legLength * 0.38, m.legDepth * 0.94),
        v(side * m.legX, m.footTop + m.legLength * 0.26, 0), null, true));
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
