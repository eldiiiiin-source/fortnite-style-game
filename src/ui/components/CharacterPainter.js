/**
 * CharacterPainter.js — SKIN_SPEC §3.1, §8, §10.
 *
 * Paints a character rig to a 2D canvas for the lobby, shop and locker. It reads the SAME
 * part list `world/CharacterView.js` turns into meshes, so a skin cannot look like one
 * thing in the shop and another in the match — there is only one shape definition.
 *
 * The projection is a light three-quarter view: parts are drawn back-to-front (the rig is
 * already depth-sorted) with a yaw that lets the viewer sway the figure. Shading is a flat
 * two-tone per part — top face lighter, side face darker — which is what gives a stylised
 * character volume without a renderer.
 */
import { partColour, PartShape } from '../../cosmetics/CharacterRig.js';

/* ── colour helpers ──────────────────────────────────────────────────────── */

function parseHex(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16)
  ];
}

/** Scale a colour's brightness. `amount` > 1 lightens, < 1 darkens. */
export function shade(hex, amount) {
  const [r, g, b] = parseHex(hex);
  const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
  return `rgb(${clamp(r * amount)},${clamp(g * amount)},${clamp(b * amount)})`;
}

/* ── projection ──────────────────────────────────────────────────────────── */

/**
 * Project a rig point to canvas space.
 *
 * A yawed orthographic projection with a slight vertical tilt: enough depth for the
 * silhouette to read as a body, never so much that the figure looks like it is falling
 * away from the viewer.
 */
function project(x, y, z, view) {
  const cos = Math.cos(view.yaw);
  const sin = Math.sin(view.yaw);
  const rx = x * cos + z * sin;
  const rz = z * cos - x * sin;
  return {
    x: view.originX + rx * view.scale,
    y: view.originY - y * view.scale + rz * view.scale * view.tilt,
    depth: rz
  };
}

/** One part's on-canvas footprint. Rotation is applied about the part's own centre. */
function drawPart(ctx, part, colour, view) {
  const c = project(part.pos.x, part.pos.y, part.pos.z, view);
  const cos = Math.cos(view.yaw);
  const sin = Math.sin(view.yaw);

  // Apparent width: a yawed box shows a blend of its X and Z faces.
  const halfX = part.shape === PartShape.BOX || part.shape === PartShape.WEDGE
    ? part.size.x / 2 : (part.radius ?? 0);
  const halfZ = part.shape === PartShape.BOX || part.shape === PartShape.WEDGE
    ? part.size.z / 2 : (part.radius ?? 0);
  const halfY = part.shape === PartShape.BOX || part.shape === PartShape.WEDGE
    ? part.size.y / 2 : (part.height !== undefined ? part.height / 2 : (part.radius ?? 0));

  const w = (Math.abs(halfX * cos) + Math.abs(halfZ * sin)) * 2 * view.scale;
  const h = halfY * 2 * view.scale;
  const roll = part.rot ? part.rot.z : 0;
  const pitch = part.rot ? part.rot.x : 0;

  ctx.save();
  ctx.translate(c.x, c.y);
  // Pitch reads on a 2D canvas as a vertical squash plus a small roll — enough to keep a
  // tilted hood or fin from looking like an upright box.
  if (roll) ctx.rotate(-roll);
  const squash = pitch ? Math.max(0.35, Math.cos(pitch)) : 1;

  ctx.fillStyle = colour.side;
  switch (part.shape) {
    case PartShape.SPHERE:
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      // Top-left highlight, so spheres read as round rather than as discs.
      ctx.fillStyle = colour.top;
      ctx.beginPath();
      ctx.ellipse(-w * 0.12, -h * 0.16, w * 0.32, h * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      break;

    case PartShape.CONE:
      ctx.beginPath();
      ctx.moveTo(0, -h / 2 * squash);
      ctx.lineTo(w / 2, h / 2 * squash);
      ctx.lineTo(-w / 2, h / 2 * squash);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = colour.top;
      ctx.beginPath();
      ctx.moveTo(0, -h / 2 * squash);
      ctx.lineTo(0, h / 2 * squash);
      ctx.lineTo(-w / 2, h / 2 * squash);
      ctx.closePath();
      ctx.fill();
      break;

    case PartShape.CYLINDER: {
      const topW = ((part.radiusTop ?? part.radius) / (part.radius || 1)) * w;
      ctx.beginPath();
      ctx.moveTo(-topW / 2, -h / 2 * squash);
      ctx.lineTo(topW / 2, -h / 2 * squash);
      ctx.lineTo(w / 2, h / 2 * squash);
      ctx.lineTo(-w / 2, h / 2 * squash);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = colour.top;
      ctx.beginPath();
      ctx.ellipse(0, -h / 2 * squash, topW / 2, topW * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case PartShape.WEDGE:
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2 * squash);
      ctx.lineTo(w / 2, -h / 2 * squash);
      ctx.lineTo(w * 0.42, h / 2 * squash);
      ctx.lineTo(-w * 0.42, h / 2 * squash);
      ctx.closePath();
      ctx.fill();
      break;

    default: {
      ctx.fillRect(-w / 2, -h / 2 * squash, w, h * squash);
      // A thin lit band along the top edge: the cheapest convincing volume cue there is.
      ctx.fillStyle = colour.top;
      ctx.fillRect(-w / 2, -h / 2 * squash, w, Math.max(1, h * 0.08));
      break;
    }
  }
  ctx.restore();
}

/**
 * Paint a rig.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} rig       from buildCharacterRig
 * @param {object} opts
 * @param {number} opts.width, opts.height   canvas extent in device pixels
 * @param {number} [opts.yaw]                radians; 0 faces the viewer
 * @param {number} [opts.headroom]           0..1 fraction of height left above the figure
 */
export function paintCharacter(ctx, rig, {
  width, height, yaw = 0, headroom = 0.06, groundShadow = true
} = {}) {
  const skin = rig.skin;
  const figureHeight = rigDrawHeight(rig);
  const figureWidth = rigDrawWidth(rig);
  // Fit on BOTH axes: a heavy frame in a square panel would otherwise touch the edges
  // while a lean one floated in the middle. Height still leads; width only ever shrinks.
  const scale = Math.min(
    (height * (1 - headroom * 2)) / figureHeight,
    (width * 0.74) / Math.max(figureWidth, 0.001)
  );

  const view = {
    originX: width / 2,
    originY: height * (1 - headroom) ,
    scale,
    yaw,
    tilt: 0.22
  };

  if (groundShadow) {
    const span = rig.metrics.shoulderWidth * scale;
    ctx.save();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(view.originX, view.originY, span * 0.85, span * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const part of rig.parts) {
    const base = partColour(skin, part);
    // Parts facing away from the viewer darken, which separates a cape from the back it
    // hangs on without needing a second colour in the palette.
    const facing = 1 + Math.max(-0.18, Math.min(0.1, part.pos.z * 0.5));
    drawPart(ctx, part, {
      side: shade(base, 0.86 * facing),
      top: shade(base, 1.14 * facing)
    }, view);
  }
}

/** Widest drawn extent of a rig, used to keep a broad frame inside its panel. */
export function rigDrawWidth(rig) {
  let half = 0;
  for (const part of rig.parts) {
    const halfX = part.shape === PartShape.BOX || part.shape === PartShape.WEDGE
      ? part.size.x / 2
      : Math.max(part.radius ?? 0, part.radiusTop ?? 0);
    half = Math.max(half, Math.abs(part.pos.x) + halfX);
  }
  return half * 2;
}

/** Total drawn height of a rig, including cosmetic overhang like hats and antennae. */
export function rigDrawHeight(rig) {
  let top = 0;
  for (const part of rig.parts) {
    const halfY = part.shape === PartShape.BOX || part.shape === PartShape.WEDGE
      ? part.size.y / 2
      : (part.height !== undefined ? part.height / 2 : (part.radius ?? 0));
    top = Math.max(top, part.pos.y + halfY);
  }
  return top;
}
