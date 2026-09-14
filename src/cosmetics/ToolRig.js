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
import { box, cone, cylinder, wedge, v, depthSort } from './RigPrimitives.js';

/** Regions of a tool, so a consumer can address the head without knowing the form. */
export const ToolRegion = Object.freeze({
  HAFT: 'haft',
  HEAD: 'head',
  DETAIL: 'detail'
});

/** Tool metrics, all derived from the view-scale constants (§11.1). */
export function toolMetrics() {
  const length = PICKAXE_VIEW.length;
  return {
    length,
    haftRadius: PICKAXE_VIEW.haftRadius,
    // The grip sits below the midpoint: most of the tool is above the hand, which is what
    // makes it read as a swung tool rather than as a staff.
    gripToHead: length * 0.62,
    gripToButt: length * 0.38,
    headWidth: PICKAXE_VIEW.headWidth,
    headDepth: PICKAXE_VIEW.headDepth,
    headHeight: PICKAXE_VIEW.headHeight
  };
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
    parts.push(box('backingBar', ToolRegion.HEAD, 'secondary',
      v(m.headWidth * 0.86, m.headHeight * 0.34, m.headDepth * 0.46),
      v(0, y, 0)));
    parts.push(box('scrapPlate', ToolRegion.HEAD, 'accent',
      v(m.headWidth * 0.78, m.headHeight * 0.8, m.headDepth * 0.3),
      v(m.headWidth * 0.12, y + m.headHeight * 0.1, m.headDepth * 0.16),
      v(0, 0, 0.12)));
    parts.push(box('weldSeam', ToolRegion.HEAD, 'primary',
      v(m.headWidth * 0.82, m.headHeight * 0.1, m.headDepth * 0.36),
      v(m.headWidth * 0.1, y + m.headHeight * 0.42, m.headDepth * 0.12)));
    parts.push(wedge('cuttingEdge', ToolRegion.HEAD, 'edge',
      v(m.headWidth * 0.34, m.headHeight * 0.9, m.headDepth * 0.34),
      v(m.headWidth * 0.56, y + m.headHeight * 0.08, 0),
      v(0, 0, -Math.PI / 2 + 0.14)));
    parts.push(cone('counterSpike', ToolRegion.HEAD, 'primary',
      m.headHeight * 0.2, m.headWidth * 0.44,
      v(-m.headWidth * 0.44, y - m.headHeight * 0.08, 0),
      v(0, 0, Math.PI / 2 + 0.18)));
    parts.push(box('shim', ToolRegion.HEAD, 'secondary',
      v(m.headWidth * 0.2, m.headHeight * 0.5, m.headDepth * 0.5),
      v(-m.headWidth * 0.2, y - m.headHeight * 0.24, -m.headDepth * 0.1),
      v(0, 0, -0.2)));
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
    [0.2, 0.36, 0.5].forEach((t, i) => {
      parts.push(cone(`spike${i}`, ToolRegion.DETAIL, 'edge',
        m.haftRadius * 0.8, m.haftRadius * (3.4 - i * 0.5),
        v(0, m.gripToHead * t, -m.haftRadius * 2.0),
        v(Math.PI / 2 + 0.2, 0, 0)));
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
  const m = toolMetrics();
  const parts = [];

  (HAFT_BUILDERS[tool.haft] ?? HAFT_BUILDERS[HaftStyle.STRAIGHT])(m, parts);
  // An unknown form is skipped rather than thrown: a profile saved against a future
  // roster must never break a running game.
  HEAD_BUILDERS[tool.head]?.(m, parts);
  for (const detail of tool.details) DETAIL_BUILDERS[detail]?.(m, parts);

  return { tool, skin: tool, metrics: m, parts: depthSort(parts) };
}
