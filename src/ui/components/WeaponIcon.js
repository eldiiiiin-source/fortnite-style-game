/**
 * WeaponIcon.js — MASTER_SPEC §12.1.1.
 *
 * The inventory-slot icon for a weapon, painted from `buildWeaponRig`'s part list — the
 * SAME part list the held model and the world pickup are built from. A weapon therefore
 * cannot look like one thing in a slot and another in the hand.
 *
 * SIDE VIEW, deliberately: screen X is the weapon's own Z (butt on the left, muzzle on the
 * right) and screen Y is its Y. That is the one view in which a rifle, a shotgun and a
 * pistol are told apart instantly, and it is the view the weapon rig is authored for.
 *
 * This is a small painter of its own rather than a call into `CharacterPainter`, because
 * that painter draws a part as an upright box and squashes it for pitch — correct for a
 * limb, wrong for a barrel laid flat along the weapon's axis, which is most of a weapon.
 */
import { buildWeaponRig, categoryOf } from '../../cosmetics/WeaponRig.js';
import { PartShape, rigBounds } from '../../cosmetics/CharacterRig.js';
import { shade } from './CharacterPainter.js';

/** Rendered icons, keyed by category and size. Painting one is cheap; repeating it is not. */
const CACHE = new Map();

/** A part's side-view footprint: extent along the weapon axis, and across it. */
function footprint(part) {
  if (part.shape === PartShape.CYLINDER) {
    const r = Math.max(part.radius, part.radiusTop ?? part.radius);
    // A quarter turn about X lays the cylinder down the weapon's axis; otherwise it stands.
    const laid = Math.abs(Math.abs(part.rot?.x ?? 0) - Math.PI / 2) < 0.01;
    return laid ? { along: part.height, across: r * 2 } : { along: r * 2, across: part.height };
  }
  if (part.shape === PartShape.SPHERE) return { along: part.radius * 2, across: part.radius * 2 };
  if (part.shape === PartShape.CONE) return { along: part.radius * 2, across: part.height };
  return { along: part.size.z, across: part.size.y };
}

/** Painter's order: deepest first, so an overlapping part lands on top of what it sits on. */
function paintOrder(parts) {
  return [...parts].sort((a, b) => (a.pos.x - b.pos.x) || 0);
}

/**
 * Paint a weapon into a 2D context, filling the given box.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string|object} weaponOrId
 * @param {{width:number, height:number, padding?:number}} opts
 */
export function paintWeapon(ctx, weaponOrId, { width, height, padding = 0.10 } = {}) {
  const rig = buildWeaponRig(weaponOrId);
  const bounds = rigBounds(rig);

  // Frame on the axes actually drawn: Z across the icon, Y up it.
  const spanZ = Math.max(bounds.maxZ - bounds.minZ, 1e-4);
  const spanY = Math.max(bounds.maxY - bounds.minY, 1e-4);
  const scale = Math.min(
    (width * (1 - padding * 2)) / spanZ,
    (height * (1 - padding * 2)) / spanY
  );
  const originX = width / 2 - ((bounds.minZ + bounds.maxZ) / 2) * scale;
  const originY = height / 2 + ((bounds.minY + bounds.maxY) / 2) * scale;

  for (const part of paintOrder(rig.parts)) {
    const { along, across } = footprint(part);
    const w = Math.max(along * scale, 1);
    const h = Math.max(across * scale, 1);
    const base = rig.palette[part.role] ?? rig.palette.primary;

    ctx.save();
    ctx.translate(originX + part.pos.z * scale, originY - part.pos.y * scale);
    // A pitch about X turns the part within the Z-Y plane, which is exactly this view's
    // plane — so it is a plain 2D rotation here, not a foreshortening.
    const pitch = part.rot?.x ?? 0;
    if (pitch && Math.abs(Math.abs(pitch) - Math.PI / 2) > 0.01) ctx.rotate(-pitch);

    // A lit top edge and a darker body: enough form that the icon is not a flat sticker.
    const gradient = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
    gradient.addColorStop(0, shade(base, 1.30));
    gradient.addColorStop(0.45, base);
    gradient.addColorStop(1, shade(base, 0.68));
    ctx.fillStyle = gradient;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.restore();
  }
}

/**
 * A weapon icon as a data URL, cached.
 *
 * Returns null where there is no canvas to paint on, so a headless caller degrades to no
 * icon rather than throwing.
 */
export function weaponIconUrl(weaponOrId, size = 46) {
  const category = categoryOf(weaponOrId);
  const key = `${category}@${size}`;
  if (CACHE.has(key)) return CACHE.get(key);

  let url = null;
  try {
    const canvas = document.createElement('canvas');
    const dpr = Math.min(globalThis.devicePixelRatio ?? 1, 2);
    canvas.width = Math.round(size * 2 * dpr);
    canvas.height = Math.round(size * dpr);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(dpr, dpr);
      paintWeapon(ctx, category, { width: size * 2, height: size });
      url = canvas.toDataURL();
    }
  } catch {
    // No canvas, or a tainted one. The slot simply shows no icon.
    url = null;
  }
  CACHE.set(key, url);
  return url;
}
