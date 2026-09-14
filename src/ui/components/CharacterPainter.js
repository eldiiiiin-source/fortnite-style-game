/**
 * CharacterPainter.js — SKIN_SPEC §3.1, §8, §10, §11, §12.
 *
 * Paints a rig — a character or a harvesting tool — to a 2D canvas for the lobby, shop and
 * locker. It reads the SAME part list `world/CharacterView.js` turns into meshes, so an
 * item cannot look like one thing in the shop and another in the match: there is only one
 * shape definition.
 *
 * FIDELITY (§12). Flat fills read as placeholder art, so every part is shaded on three
 * faces — a lit top, a mid front, a shaded side — with a contact darkening along its lower
 * edge. Self-lit parts get a bloom drawn behind them. None of this is per-item art: it is
 * one lighting model applied to whatever the rig emits, which is why adding a cosmetic
 * never means drawing one.
 */
import { partColour, PartShape, rigBounds } from '../../cosmetics/CharacterRig.js';

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

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

/**
 * Scale a colour's brightness toward white rather than by a flat multiplier.
 *
 * A plain multiply drives a near-black outfit to pure black on every face, which is how
 * the dark premium skins lost all their form. Lifting toward white keeps a shadow side
 * readable even at very low base luminance.
 */
export function shade(hex, amount) {
  const [r, g, b] = parseHex(hex);
  if (amount >= 1) {
    const t = Math.min(1, amount - 1);
    return `rgb(${clamp255(r + (255 - r) * t * 0.85)},${clamp255(g + (255 - g) * t * 0.85)},${clamp255(b + (255 - b) * t * 0.85)})`;
  }
  // Darkening keeps a floor so a black part never becomes a hole in the silhouette, and
  // the floor RISES as the base gets darker. A fixed floor is fine for mid-tone outfits
  // but leaves a matte-black one with no readable shadow side at all, which is how the
  // premium black-and-gold skins lost everything below the waist.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  const floor = 9 + (1 - luminance) * 17;
  return `rgb(${clamp255(r * amount + floor)},${clamp255(g * amount + floor)},${clamp255(b * amount + floor * 1.1)})`;
}

function rgbaOf(hex, alpha) {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
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

/** One part's on-canvas footprint. */
function drawPart(ctx, part, colour, view) {
  const c = project(part.pos.x, part.pos.y, part.pos.z, view);
  const cos = Math.cos(view.yaw);
  const sin = Math.sin(view.yaw);

  const boxish = part.shape === PartShape.BOX || part.shape === PartShape.WEDGE;
  const halfX = boxish ? part.size.x / 2 : (part.radius ?? 0);
  const halfZ = boxish ? part.size.z / 2 : (part.radius ?? 0);
  const halfY = boxish
    ? part.size.y / 2
    : (part.height !== undefined ? part.height / 2 : (part.radius ?? 0));

  // Apparent width: a yawed box shows a blend of its X and Z faces.
  const w = (Math.abs(halfX * cos) + Math.abs(halfZ * sin)) * 2 * view.scale;
  const h = halfY * 2 * view.scale;
  const roll = part.rot ? part.rot.z : 0;
  const pitch = part.rot ? part.rot.x : 0;
  const squash = pitch ? Math.max(0.35, Math.cos(pitch)) : 1;

  ctx.save();
  ctx.translate(c.x, c.y);
  if (roll) ctx.rotate(-roll);

  // Self-lit parts bloom before they are drawn, so the glow sits under the shape.
  if (part.glow) {
    // Kept deliberately weak: a glow pattern is many parts, and their blooms stack. Tuned
    // so a full skeleton reads as lit bones rather than as one luminous blob.
    const r = Math.max(w, h) * 0.7;
    const bloom = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    bloom.addColorStop(0, rgbaOf(colour.base, 0.3));
    bloom.addColorStop(0.5, rgbaOf(colour.base, 0.1));
    bloom.addColorStop(1, rgbaOf(colour.base, 0));
    ctx.fillStyle = bloom;
    ctx.fillRect(-r, -r, r * 2, r * 2);
  }

  switch (part.shape) {
    case PartShape.SPHERE: {
      // A vertical gradient across the sphere reads as curvature; a flat disc does not.
      const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      g.addColorStop(0, colour.top);
      g.addColorStop(0.55, colour.front);
      g.addColorStop(1, colour.side);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = rgbaOf('#ffffff', 0.12);
      ctx.beginPath();
      ctx.ellipse(-w * 0.15, -h * 0.2, w * 0.26, h * 0.2, -0.4, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case PartShape.CONE:
      ctx.fillStyle = colour.front;
      ctx.beginPath();
      ctx.moveTo(0, -h / 2 * squash);
      ctx.lineTo(w / 2, h / 2 * squash);
      ctx.lineTo(-w / 2, h / 2 * squash);
      ctx.closePath();
      ctx.fill();
      // Left half lit, right half shaded: a cone needs the split to read as round.
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
      const g = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      g.addColorStop(0, colour.side);
      g.addColorStop(0.35, colour.front);
      g.addColorStop(0.72, colour.top);
      g.addColorStop(1, colour.side);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(-topW / 2, -h / 2 * squash);
      ctx.lineTo(topW / 2, -h / 2 * squash);
      ctx.lineTo(w / 2, h / 2 * squash);
      ctx.lineTo(-w / 2, h / 2 * squash);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = colour.top;
      ctx.beginPath();
      ctx.ellipse(0, -h / 2 * squash, topW / 2, Math.max(1, topW * 0.16), 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case PartShape.WEDGE:
      ctx.fillStyle = colour.front;
      ctx.beginPath();
      ctx.moveTo(-w / 2, -h / 2 * squash);
      ctx.lineTo(w / 2, -h / 2 * squash);
      ctx.lineTo(w * 0.42, h / 2 * squash);
      ctx.lineTo(-w * 0.42, h / 2 * squash);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = colour.top;
      ctx.fillRect(-w / 2, -h / 2 * squash, w, Math.max(1, h * 0.12));
      break;

    default: {
      const top = -h / 2 * squash;
      const height = h * squash;
      // Three bands across the face: lit top edge, mid front, shaded lower edge. The
      // lower band is contact shading — it is what stops stacked boxes reading as one
      // flat slab, which was the single biggest tell that this art was placeholder.
      const g = ctx.createLinearGradient(0, top, 0, top + height);
      g.addColorStop(0, colour.top);
      g.addColorStop(0.18, colour.front);
      g.addColorStop(0.82, colour.front);
      g.addColorStop(1, colour.side);
      ctx.fillStyle = g;
      if (part.bevel) {
        // Chamfered corners (§6.5). Proportional to the smaller side and capped, so a
        // long thin strap keeps its length instead of turning into a lozenge.
        const cut = Math.min(w, height) * 0.22;
        ctx.beginPath();
        ctx.moveTo(-w / 2 + cut, top);
        ctx.lineTo(w / 2 - cut, top);
        ctx.lineTo(w / 2, top + cut);
        ctx.lineTo(w / 2, top + height - cut);
        ctx.lineTo(w / 2 - cut, top + height);
        ctx.lineTo(-w / 2 + cut, top + height);
        ctx.lineTo(-w / 2, top + height - cut);
        ctx.lineTo(-w / 2, top + cut);
        ctx.closePath();
        ctx.fill();
      } else {
        ctx.fillRect(-w / 2, top, w, height);
      }
      // A narrow lit strip down the left edge, matching the light direction used above.
      ctx.fillStyle = rgbaOf('#ffffff', 0.07);
      ctx.fillRect(-w / 2, top, Math.max(1, w * 0.12), height);
      break;
    }
  }
  ctx.restore();
}

/** Per-part colour ramp, derived from one light direction for the whole rig. */
function rampFor(owner, part) {
  const base = partColour(owner, part);
  // Parts further back sit further from the key light.
  const facing = 1 + Math.max(-0.16, Math.min(0.08, part.pos.z * 0.45));
  return {
    base,
    top: shade(base, 1.26 * facing),
    front: shade(base, 1.0 * facing),
    side: shade(base, 0.72 * facing)
  };
}

/**
 * Paint any rig — character or tool.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {object} rig    from buildCharacterRig or buildToolRig
 * @param {object} opts
 */
export function paintRig(ctx, rig, {
  width, height, yaw = 0, roll = 0, headroom = 0.06, widthFraction = 0.74,
  groundShadow = true, anchorBottom = true
} = {}) {
  const owner = rig.skin ?? rig.tool;
  const bounds = rigBounds(rig);
  // Full extent, not just the top: a character stands on y=0 but a tool hangs below its
  // grip, and framing either one off maxY alone pushes half of it off the canvas.
  const figureHeight = Math.max(bounds.maxY - bounds.minY, 0.001);
  const figureWidth = Math.max(bounds.maxX - bounds.minX, 0.001);

  // Fit on BOTH axes: a heavy frame in a square panel would otherwise touch the edges
  // while a lean one floated in the middle. Height leads; width only ever shrinks.
  const scale = Math.min(
    (height * (1 - headroom * 2)) / figureHeight,
    (width * widthFraction) / figureWidth
  );

  // Place the origin so the rig's LOWEST point lands on the framing floor.
  const floorY = anchorBottom ? height * (1 - headroom) : height / 2 + (figureHeight / 2) * scale;
  const view = {
    originX: width / 2,
    originY: floorY + bounds.minY * scale,
    scale,
    yaw,
    tilt: 0.22
  };

  if (groundShadow) {
    const span = (rig.metrics?.shoulderWidth ?? figureWidth * 0.5) * scale;
    const groundY = floorY;
    ctx.save();
    // Two stacked ellipses: a tight dark core under the feet and a soft spread around it.
    // A single flat ellipse reads as a sticker; the falloff is what sits the figure down.
    const soft = ctx.createRadialGradient(
      view.originX, groundY, 0, view.originX, groundY, span * 1.5
    );
    soft.addColorStop(0, 'rgba(0,0,0,0.42)');
    soft.addColorStop(0.55, 'rgba(0,0,0,0.16)');
    soft.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = soft;
    ctx.save();
    ctx.translate(view.originX, groundY);
    ctx.scale(1, 0.22);
    ctx.translate(-view.originX, -groundY);
    ctx.beginPath();
    ctx.arc(view.originX, groundY, span * 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }

  ctx.save();
  if (roll) {
    ctx.translate(view.originX, height / 2);
    ctx.rotate(roll);
    ctx.translate(-view.originX, -height / 2);
  }
  for (const part of rig.parts) drawPart(ctx, part, rampFor(owner, part), view);
  ctx.restore();
}

/** A character, framed standing on the canvas floor. */
export function paintCharacter(ctx, rig, opts = {}) {
  paintRig(ctx, rig, opts);
}

/**
 * A harvesting tool, framed on the diagonal.
 *
 * Held on the slant rather than upright: it fills a square panel far better and reads as
 * a tool in use rather than as an object on a shelf.
 */
export function paintTool(ctx, rig, { width, height, yaw = 0, roll = -0.5 } = {}) {
  paintRig(ctx, rig, {
    width, height, yaw, roll,
    headroom: 0.16,
    widthFraction: 0.62,
    groundShadow: false,
    anchorBottom: true
  });
}

/** Total drawn height of a rig, including cosmetic overhang like hats and antennae. */
export function rigDrawHeight(rig) {
  return rigBounds(rig).maxY;
}

/** Widest drawn extent of a rig. */
export function rigDrawWidth(rig) {
  const b = rigBounds(rig);
  return b.maxX - b.minX;
}
