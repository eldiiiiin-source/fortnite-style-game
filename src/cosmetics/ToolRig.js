/**
 * ToolRig.js — SKIN_SPEC §11.
 *
 * Turns a harvesting tool definition into a part list, exactly as `CharacterRig.js` does
 * for a skin, using the same shape vocabulary. One geometry source, two consumers: the
 * shop preview and the tool held in the character's hand.
 *
 * RIG SPACE: origin is the GRIP — the point the hand closes on. +Y runs up the haft toward
 * the head, +Z is the striking face. Anchoring at the grip rather than the butt means a
 * long tool and a short one both sit correctly in the same hand.
 *
 * DIMENSIONS derive from `PICKAXE_VIEW` in Config, which derives from the player capsule.
 * No absolute lengths here.
 *
 * COLLISION AND DAMAGE: nothing here feeds either. Reach, damage and swing rate come from
 * `PICKAXE` in Config and are the same for every tool (ITEM_SHOP_SPEC §4.4).
 */
import { PICKAXE_VIEW } from '../core/Config.js';
import { HeadForm, HaftStyle, ToolDetail, toolOrFallback } from './ToolDefinitions.js';
import { box, bevelBox, cone, cylinder, wedge, v, depthSort } from './RigPrimitives.js';

/** Regions of a tool, so a consumer can address the head without knowing the form. */
export const ToolRegion = Object.freeze({
  HAFT: 'haft',
  HEAD: 'head',
  DETAIL: 'detail'
});

/** Tool metrics, all derived from the view-scale constants (§11.1). */
export function toolMetrics(headScale = 1) {
  const length = PICKAXE_VIEW.length;
  return {
    length,
    haftRadius: PICKAXE_VIEW.haftRadius,
    // The grip sits below the midpoint: most of the tool is above the hand, which is what
    // makes it read as a swung tool rather than as a staff.
    gripToHead: length * 0.62,
    gripToButt: length * 0.38,
    headScale,
    headWidth: PICKAXE_VIEW.headWidth * headScale,
    headDepth: PICKAXE_VIEW.headDepth * headScale,
    headHeight: PICKAXE_VIEW.headHeight * headScale
  };
}

/* ── carry pose ──────────────────────────────────────────────────────────── */

/**
 * Where a carried tool sits relative to the character rig (SKIN_SPEC §11.6).
 *
 * Pure geometry, so it is testable in Node and the view stays a translator. Returns a
 * position in rig space and an Euler rotation (three.js order XYZ) for the tool group.
 *
 * THE POSE: held in the hand at the side, head angled DOWN and OUTWARD. It is stated as a
 * direction, because that is what the pose means; the Euler angles are solved from it. The
 * previous pose tipped the head up and behind the shoulder, which read as a back-mounted
 * accessory lying across the character's own silhouette.
 *
 * Two things make it work on every build:
 *
 *  - The hand closes PART-WAY UP the haft, as it would on a real tool carried at the side.
 *    A tool is longer than a character's hand is high, so gripping the butt would drag the
 *    head through the floor at any genuine downward angle.
 *  - The tilt is CLAMPED to what the rig can carry. The stout mascot build has a very large
 *    head, which drops its shoulders, and full-length arms — its hand sits barely a third of
 *    a metre off the ground. Every other build takes the full angle unchanged.
 */
export function carryTransform(metrics, headScale = 1) {
  const hand = {
    x: metrics.armX + PICKAXE_VIEW.gripOut,
    y: metrics.shoulderY - metrics.armLength - PICKAXE_VIEW.gripDrop,
    z: metrics.armDepth * 0.3
  };

  const tm = toolMetrics(headScale);
  const reach = Math.max(1e-3, tm.gripToHead - PICKAXE_VIEW.carryGrip);
  const clearance = tm.headHeight / 2 + PICKAXE_VIEW.carryClearance;

  const drop = Math.min(
    PICKAXE_VIEW.carryDrop,
    Math.asin(Math.min(1, Math.max(0, hand.y - clearance) / reach))
  );

  // Unit direction from the grip toward the head. Rig space: +Y runs up the haft.
  const flat = Math.cos(drop);
  const direction = {
    x: Math.sin(PICKAXE_VIEW.carrySwing) * flat,
    y: -Math.sin(drop),
    z: Math.cos(PICKAXE_VIEW.carrySwing) * flat
  };

  return {
    direction,
    // Seat the rig so the HAND lands on the grip point, `carryGrip` up the haft.
    position: {
      x: hand.x - direction.x * PICKAXE_VIEW.carryGrip,
      y: hand.y - direction.y * PICKAXE_VIEW.carryGrip,
      z: hand.z - direction.z * PICKAXE_VIEW.carryGrip
    },
    // Euler XYZ taking local +Y onto `direction`.
    rotation: { x: Math.atan2(direction.z, direction.y), y: 0, z: -Math.asin(direction.x) },
    // Handy for tests and tools: where the head and the butt end up.
    head: {
      x: hand.x + direction.x * reach,
      y: hand.y + direction.y * reach,
      z: hand.z + direction.z * reach
    },
    butt: {
      x: hand.x - direction.x * (tm.gripToButt + PICKAXE_VIEW.carryGrip),
      y: hand.y - direction.y * (tm.gripToButt + PICKAXE_VIEW.carryGrip),
      z: hand.z - direction.z * (tm.gripToButt + PICKAXE_VIEW.carryGrip)
    },
    headHalfHeight: tm.headHeight / 2
  };
}

/* ── swing animation ─────────────────────────────────────────────────────── */

/** Named stretches of the swing, for the view and for tests to talk about. */
export const SwingPhase = Object.freeze({
  CARRY: 'carry',
  WINDUP: 'windup',
  STRIKE: 'strike',
  RECOVER: 'recover'
});

/**
 * Keyframes of the swing, in normalised gameplay progress (SKIN_SPEC §11.7).
 *
 * `arm` rotates the whole right arm about the SHOULDER; positive X swings the hand
 * backward, negative swings it forward and then up and over. The wind-up needs about
 * -2.15 rad to carry the head OVERHEAD: a tool hanging head-down from the hand only
 * reaches shoulder height at -1.2, which reads as reaching forward, not as a swing. `tool` is an extra pitch of the tool in the
 * hand — the wrist cocking back and whipping through, which is what makes the head lead
 * the strike instead of trailing the arm rigidly.
 *
 * The first and last frames are the carry pose exactly, so a swing begins and ends where
 * the approved idle pose sits and repeated swings loop without a snap.
 */
const SWING_KEYS = [
  { at: 0.00, armX: 0.00, armZ: 0.00, tool: 0.00, phase: SwingPhase.CARRY },
  { at: 0.14, armX: -2.15, armZ: -0.16, tool: 0.50, phase: SwingPhase.WINDUP },
  { at: 0.32, armX: -0.30, armZ: 0.10, tool: -0.70, phase: SwingPhase.STRIKE },
  { at: 0.46, armX: 0.12, armZ: 0.05, tool: -0.35, phase: SwingPhase.RECOVER },
  { at: 1.00, armX: 0.00, armZ: 0.00, tool: 0.00, phase: SwingPhase.CARRY }
];

/** Smoothstep between two keys — no corner at a keyframe, so the arc reads as one motion. */
const ease = (t) => t * t * (3 - 2 * t);

/**
 * The visual swing pose at a normalised gameplay progress (SKIN_SPEC §11.7).
 *
 * Pure: angles only, no metrics, no side effects, testable in Node.
 *
 * DRIVEN BY GAMEPLAY, NEVER DRIVING IT. `progress` is `Pickaxe.swingProgress`, which is a
 * read of the swing cooldown. There is no second clock, so the animation cannot change the
 * swing rate, the damage timing, the range or the hit test — gameplay resolves the hit at
 * progress 0 and the animation is presentation laid over the same interval.
 */
export function swingPose(progress) {
  const p = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;

  let lo = SWING_KEYS[0];
  let hi = SWING_KEYS[SWING_KEYS.length - 1];
  for (let i = 0; i < SWING_KEYS.length - 1; i++) {
    if (p >= SWING_KEYS[i].at && p <= SWING_KEYS[i + 1].at) {
      lo = SWING_KEYS[i];
      hi = SWING_KEYS[i + 1];
      break;
    }
  }

  const span = hi.at - lo.at;
  const t = span > 0 ? ease((p - lo.at) / span) : 0;
  const mix = (a, b) => a + (b - a) * t;

  return {
    progress: p,
    // The phase being moved INTO, so a frame reports the motion it is part of.
    phase: hi.phase,
    arm: { x: mix(lo.armX, hi.armX), y: 0, z: mix(lo.armZ, hi.armZ) },
    toolPitch: mix(lo.tool, hi.tool)
  };
}

/** The rest pose: what the rig looks like when no swing is in flight. */
export const SWING_REST = Object.freeze({
  progress: 1, phase: SwingPhase.CARRY, arm: { x: 0, y: 0, z: 0 }, toolPitch: 0
});

/**
 * Where a point `along` the haft ends up in rig space, at a given swing progress.
 *
 * `along` is measured from the grip: `+gripToHead` is the striking head, `-gripToButt` the
 * butt end. Positive Y is up the haft, as everywhere else in this file.
 *
 * MIRRORS THE VIEW'S TRANSFORM CHAIN exactly — arm group pivoted at the shoulder, tool
 * group inside it, both Euler XYZ — so a test of this is a test of what renders. The view
 * owns no geometry of its own; it feeds these same numbers to three.js.
 */
export function swungPoint(metrics, headScale, progress, along) {
  const carry = carryTransform(metrics, headScale);
  const swing = swingPose(progress);
  const pivot = { x: metrics.armX, y: metrics.shoulderY, z: 0 };

  // Euler XYZ: v' = RX * RY * RZ * v. RY is always zero here.
  const rotate = (v, e) => {
    const cz = Math.cos(e.z);
    const sz = Math.sin(e.z);
    const zx = v.x * cz - v.y * sz;
    const zy = v.x * sz + v.y * cz;
    const cx = Math.cos(e.x);
    const sx = Math.sin(e.x);
    return { x: zx, y: zy * cx - v.z * sx, z: zy * sx + v.z * cx };
  };

  // Up the haft, in the tool's own frame, with the wrist pitch laid over the carry rotation.
  const alongTool = rotate({ x: 0, y: along, z: 0 },
    { x: carry.rotation.x + swing.toolPitch, y: 0, z: carry.rotation.z });

  // Into arm space (the carry position is rig space, so rebase it onto the pivot).
  const inArm = {
    x: carry.position.x - pivot.x + alongTool.x,
    y: carry.position.y - pivot.y + alongTool.y,
    z: carry.position.z - pivot.z + alongTool.z
  };

  const swung = rotate(inArm, swing.arm);
  return { x: swung.x + pivot.x, y: swung.y + pivot.y, z: swung.z + pivot.z };
}

/* ── haft ────────────────────────────────────────────────────────────────── */

const HAFT_BUILDERS = {
  [HaftStyle.STRAIGHT](m, parts) {
    parts.push(cylinder('haft', ToolRegion.HAFT, 'detail',
      m.haftRadius, m.length,
      v(0, m.gripToHead - m.length / 2, 0)));
  },

  [HaftStyle.WRAPPED](m, parts) {
    parts.push(cylinder('haft', ToolRegion.HAFT, 'detail',
      m.haftRadius * 0.92, m.length,
      v(0, m.gripToHead - m.length / 2, 0)));
    // Grip wrap at the hand, which is the one place a haft is ever thicker.
    parts.push(cylinder('grip', ToolRegion.HAFT, 'secondary',
      m.haftRadius * 1.3, m.length * 0.22,
      v(0, 0, 0)));
  },

  [HaftStyle.SALVAGE](m, parts) {
    // A salvaged tube: welded collar, taped grip, a spacer where a second piece was
    // joined on. Three visible joints say "built from other things" before any colour does.
    parts.push(cylinder('haft', ToolRegion.HAFT, 'secondary',
      m.haftRadius * 1.16, m.length,
      v(0, m.gripToHead - m.length / 2, 0)));
    parts.push(cylinder('haftWeldCollar', ToolRegion.HAFT, 'primary',
      m.haftRadius * 1.7, m.length * 0.07,
      v(0, m.gripToHead * 0.62, 0)));
    parts.push(cylinder('haftSpacer', ToolRegion.HAFT, 'detail',
      m.haftRadius * 1.44, m.length * 0.05,
      v(0, m.gripToHead * 0.2, 0)));
    parts.push(cylinder('grip', ToolRegion.HAFT, 'detail',
      m.haftRadius * 1.42, m.length * 0.28,
      v(0, -m.length * 0.02, 0)));
    parts.push(bevelBox('gripTape', ToolRegion.HAFT, 'accent',
      v(m.haftRadius * 2.9, m.length * 0.035, m.haftRadius * 2.9),
      v(0, m.length * 0.09, 0)));
  },

  [HaftStyle.PIPE](m, parts) {
    // A salvaged pipe: constant bore, a collar where it was cut, a taped grip.
    parts.push(cylinder('haft', ToolRegion.HAFT, 'secondary',
      m.haftRadius * 1.1, m.length,
      v(0, m.gripToHead - m.length / 2, 0)));
    parts.push(cylinder('haftCollar', ToolRegion.HAFT, 'primary',
      m.haftRadius * 1.4, m.length * 0.06,
      v(0, m.gripToHead * 0.55, 0)));
    parts.push(cylinder('grip', ToolRegion.HAFT, 'detail',
      m.haftRadius * 1.34, m.length * 0.26,
      v(0, 0, 0)));
  }
};

/* ── heads — SKIN_SPEC §11.2 ─────────────────────────────────────────────── */

const HEAD_BUILDERS = {
  [HeadForm.WEDGE](m, parts) {
    const y = m.gripToHead;
    parts.push(box('headBody', ToolRegion.HEAD, 'primary',
      v(m.headWidth * 0.3, m.headHeight * 0.5, m.headDepth * 0.34),
      v(0, y, 0)));
    parts.push(cone('pick', ToolRegion.HEAD, 'primary',
      m.headHeight * 0.22, m.headWidth * 0.62,
      v(-m.headWidth * 0.3, y, 0), v(0, 0, Math.PI / 2)));
    parts.push(wedge('blade', ToolRegion.HEAD, 'edge',
      v(m.headWidth * 0.42, m.headHeight * 0.62, m.headDepth * 0.3),
      v(m.headWidth * 0.3, y, 0), v(0, 0, -Math.PI / 2)));
  },

  [HeadForm.CHISEL](m, parts) {
    const y = m.gripToHead;
    parts.push(box('headBody', ToolRegion.HEAD, 'primary',
      v(m.headWidth * 0.9, m.headHeight * 0.42, m.headDepth * 0.4),
      v(0, y, 0)));
    parts.push(wedge('chiselEdge', ToolRegion.HEAD, 'edge',
      v(m.headWidth * 0.94, m.headHeight * 0.26, m.headDepth * 0.44),
      v(0, y + m.headHeight * 0.3, 0)));
  },

  [HeadForm.LEAF](m, parts) {
    const y = m.gripToHead;
    parts.push(cone('leafBlade', ToolRegion.HEAD, 'edge',
      m.headWidth * 0.34, m.headHeight * 1.5,
      v(0, y + m.headHeight * 0.42, 0)));
    parts.push(box('leafSpine', ToolRegion.HEAD, 'primary',
      v(m.headWidth * 0.1, m.headHeight * 1.3, m.headDepth * 0.34),
      v(0, y + m.headHeight * 0.3, 0)));
  },

  [HeadForm.HOOK](m, parts) {
    const y = m.gripToHead;
    parts.push(box('hookBase', ToolRegion.HEAD, 'primary',
      v(m.headWidth * 0.28, m.headHeight * 0.6, m.headDepth * 0.34),
      v(0, y, 0)));
    // Three descending segments read as a curve without needing a curved primitive.
    [0, 1, 2].forEach((i) => {
      parts.push(box(`hook${i}`, ToolRegion.HEAD, i === 2 ? 'edge' : 'primary',
        v(m.headWidth * (0.3 - i * 0.06), m.headHeight * 0.34, m.headDepth * 0.3),
        v(m.headWidth * (0.24 + i * 0.2), y + m.headHeight * (0.16 - i * 0.24), 0),
        v(0, 0, -0.4 - i * 0.3)));
    });
  },

  [HeadForm.SPLIT](m, parts) {
    const y = m.gripToHead;
    parts.push(box('forkBase', ToolRegion.HEAD, 'primary',
      v(m.headWidth * 0.34, m.headHeight * 0.56, m.headDepth * 0.4),
      v(0, y, 0)));
    for (const side of [-1, 1]) {
      parts.push(cone(`tine${side < 0 ? 'L' : 'R'}`, ToolRegion.HEAD, 'edge',
        m.headHeight * 0.18, m.headWidth * 0.68,
        v(side * m.headWidth * 0.34, y + m.headHeight * 0.22, 0),
        v(0, 0, side * (Math.PI / 2 - 0.34))));
    }
  },

  [HeadForm.BEAM](m, parts) {
    const y = m.gripToHead;
    parts.push(box('emitter', ToolRegion.HEAD, 'primary',
      v(m.headWidth * 0.26, m.headHeight * 0.7, m.headDepth * 0.42),
      v(0, y, 0)));
    parts.push(wedge('beamEdge', ToolRegion.HEAD, 'accent',
      v(m.headWidth * 0.9, m.headHeight * 0.34, m.headDepth * 0.2),
      v(m.headWidth * 0.4, y + m.headHeight * 0.1, 0), null, true));
    parts.push(box('emitterCore', ToolRegion.HEAD, 'edge',
      v(m.headWidth * 0.12, m.headHeight * 0.44, m.headDepth * 0.46),
      v(0, y, 0), null, true));
  },

  /**
   * Welded scrap — SKIN_SPEC §11.5.
   *
   * Deliberately asymmetric and deliberately layered: a plate bolted over a backing bar,
   * a cutting edge that overhangs one side only, and a counter-spike on the other. The
   * asymmetry is the silhouette; a symmetrical scrap head just reads as a hammer.
   */
  [HeadForm.SCRAP](m, parts) {
    const y = m.gripToHead;
    const w = m.headWidth;
    const h = m.headHeight;
    const d = m.headDepth;

    // Backing bar: what everything else is welded onto.
    parts.push(bevelBox('backingBar', ToolRegion.HEAD, 'secondary',
      v(w * 0.9, h * 0.4, d * 0.52), v(0, y, 0)));

    // The cleaver: a broad rust-red plate overhanging ONE side, with a bright bare-metal
    // edge beyond it. Breadth here is what makes the tool look dangerous rather than busy.
    parts.push(bevelBox('cleaverPlate', ToolRegion.HEAD, 'accent',
      v(w * 0.72, h * 1.06, d * 0.34),
      v(w * 0.36, y + h * 0.12, d * 0.1), v(0, 0, 0.1)));
    parts.push(bevelBox('cleaverBack', ToolRegion.HEAD, 'primary',
      v(w * 0.3, h * 1.1, d * 0.4),
      v(w * 0.1, y + h * 0.1, -d * 0.14), v(0, 0, 0.1)));
    parts.push(wedge('cuttingEdge', ToolRegion.HEAD, 'edge',
      v(w * 0.42, h * 1.16, d * 0.36),
      v(w * 0.78, y + h * 0.14, 0), v(0, 0, -Math.PI / 2 + 0.1)));
    parts.push(box('edgeGlint', ToolRegion.HEAD, 'edge',
      v(w * 0.1, h * 1.0, d * 0.38),
      v(w * 0.64, y + h * 0.14, 0), v(0, 0, 0.1)));

    // The counter-spike: long, narrow and tapered — deliberately nothing like the cleaver,
    // so the two ends of the head never read as the same shape (§11.5).
    parts.push(cone('counterSpike', ToolRegion.HEAD, 'primary',
      h * 0.22, w * 0.78,
      v(-w * 0.56, y - h * 0.04, 0), v(0, 0, Math.PI / 2 + 0.14)));
    parts.push(box('spikeRoot', ToolRegion.HEAD, 'secondary',
      v(w * 0.22, h * 0.46, d * 0.46),
      v(-w * 0.22, y - h * 0.02, 0)));

    // Shim and torn plate wedged behind the joint: the layering that says "welded".
    parts.push(bevelBox('shim', ToolRegion.HEAD, 'secondary',
      v(w * 0.24, h * 0.54, d * 0.56),
      v(-w * 0.1, y - h * 0.34, -d * 0.12), v(0, 0, -0.24)));
    parts.push(bevelBox('tornPlate', ToolRegion.HEAD, 'accent',
      v(w * 0.36, h * 0.4, d * 0.2),
      v(-w * 0.3, y + h * 0.34, d * 0.24), v(0, 0, 0.42)));
    parts.push(box('weldSeam', ToolRegion.HEAD, 'primary',
      v(w * 0.86, h * 0.11, d * 0.42),
      v(w * 0.04, y + h * 0.46, d * 0.06)));
  }
};

/* ── details — SKIN_SPEC §11.4 ───────────────────────────────────────────── */

const DETAIL_BUILDERS = {
  [ToolDetail.BOLTS](m, parts) {
    const y = m.gripToHead;
    [[-0.3, 0.24], [0.26, -0.2], [0.04, 0.34]].forEach(([dx, dy], i) => {
      parts.push(cylinder(`bolt${i}`, ToolRegion.DETAIL, 'edge',
        m.headHeight * 0.07, m.headDepth * 0.5,
        v(m.headWidth * dx, y + m.headHeight * dy, 0),
        v(Math.PI / 2, 0, 0)));
    });
  },

  [ToolDetail.BINDING](m, parts) {
    // Cord lashing where the head meets the haft — the joint every hand-made tool has.
    [0, 1, 2].forEach((i) => {
      parts.push(cylinder(`lash${i}`, ToolRegion.DETAIL, 'detail',
        m.haftRadius * 1.5, m.length * 0.03,
        v(0, m.gripToHead - m.length * (0.07 + i * 0.045), 0)));
    });
  },

  [ToolDetail.COUNTERWEIGHT](m, parts) {
    parts.push(cylinder('buttWeight', ToolRegion.DETAIL, 'primary',
      m.haftRadius * 2.0, m.length * 0.07,
      v(0, -m.gripToButt + m.length * 0.04, 0)));
  },

  [ToolDetail.SPIKES](m, parts) {
    // Welded along the back of the haft, uneven on purpose.
    [0.24, 0.42, 0.58, 0.74].forEach((t, i) => {
      parts.push(cone(`spike${i}`, ToolRegion.DETAIL, 'edge',
        m.haftRadius * (0.92 - i * 0.08), m.haftRadius * (4.2 - i * 0.6),
        v(0, m.gripToHead * t, -m.haftRadius * 2.2),
        v(Math.PI / 2 + 0.18 + i * 0.05, 0, 0)));
    });
  },

  [ToolDetail.RAGS](m, parts) {
    parts.push(box('rag', ToolRegion.DETAIL, 'accent',
      v(m.haftRadius * 2.2, m.length * 0.16, m.haftRadius * 0.5),
      v(m.haftRadius * 1.4, m.gripToHead * 0.7, -m.haftRadius * 1.2),
      v(0, 0, -0.22)));
    parts.push(box('ragTail', ToolRegion.DETAIL, 'accent',
      v(m.haftRadius * 1.2, m.length * 0.1, m.haftRadius * 0.4),
      v(m.haftRadius * 2.2, m.gripToHead * 0.52, -m.haftRadius * 1.5),
      v(0, 0, -0.42)));
  },

  [ToolDetail.WELD_PLATES](m, parts) {
    // A stack of riveted plates across the joint, each offset from the last. Offsetting
    // is what makes a stack read as salvage rather than as one thick slab.
    const y = m.gripToHead;
    [[-0.2, -0.5, 0.16], [0.12, -0.66, -0.1], [-0.02, -0.82, 0.08]].forEach(([dx, dy, dz], i) => {
      parts.push(bevelBox(`weldPlate${i}`, ToolRegion.DETAIL, 'secondary',
        v(m.headWidth * (0.5 - i * 0.07), m.headHeight * 0.2, m.headDepth * 0.4),
        v(m.headWidth * dx, y + m.headHeight * dy, m.headDepth * dz),
        v(0, 0, (i % 2 ? -1 : 1) * 0.16)));
      parts.push(cylinder(`weldRivet${i}`, ToolRegion.DETAIL, 'edge',
        m.headHeight * 0.055, m.headDepth * 0.45,
        v(m.headWidth * dx, y + m.headHeight * dy, m.headDepth * dz),
        v(Math.PI / 2, 0, 0)));
    });
  },

  [ToolDetail.CHAIN_LASH](m, parts) {
    // A short chain hanging off the collar, drawn as separate links so it reads as chain.
    for (let i = 0; i < 4; i++) {
      parts.push(cylinder(`chainLink${i}`, ToolRegion.DETAIL, 'primary',
        m.haftRadius * 0.62, m.haftRadius * 0.9,
        v(-m.haftRadius * (1.8 + i * 0.24), m.gripToHead * (0.5 - i * 0.1), -m.haftRadius * 1.2),
        v(i % 2 ? Math.PI / 2 : 0, 0, 0.3)));
    }
  },

  [ToolDetail.GLOW_EDGE](m, parts) {
    parts.push(box('glowLine', ToolRegion.DETAIL, 'accent',
      v(m.headWidth * 0.1, m.headHeight * 0.9, m.headDepth * 0.5),
      v(0, m.gripToHead, 0), null, true));
  }
};

/** Head forms and details the rig knows how to build. */
export const SUPPORTED_HEADS = Object.freeze(Object.keys(HEAD_BUILDERS).sort());
export const SUPPORTED_TOOL_DETAILS = Object.freeze(Object.keys(DETAIL_BUILDERS).sort());

/**
 * Build the part list for a harvesting tool.
 *
 * Deterministic, like the character rig: the same tool always yields an identical list.
 *
 * @param {object|string} toolOrId
 * @returns {{tool: object, metrics: object, parts: Array}}
 */
export function buildToolRig(toolOrId) {
  const tool = typeof toolOrId === 'string'
    ? toolOrFallback(toolOrId)
    : (toolOrId ?? toolOrFallback(null));
  const m = toolMetrics(tool.headScale ?? 1);
  const parts = [];

  (HAFT_BUILDERS[tool.haft] ?? HAFT_BUILDERS[HaftStyle.STRAIGHT])(m, parts);
  // An unknown form is skipped rather than thrown: a profile saved against a future
  // roster must never break a running game.
  HEAD_BUILDERS[tool.head]?.(m, parts);
  for (const detail of tool.details) DETAIL_BUILDERS[detail]?.(m, parts);

  return { tool, skin: tool, metrics: m, parts: depthSort(parts) };
}
