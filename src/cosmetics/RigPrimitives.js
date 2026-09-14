/**
 * RigPrimitives.js — SKIN_SPEC §3.3.
 *
 * The shape vocabulary every rig is built from. Characters and harvesting tools share it,
 * so one 3D view and one 2D painter can draw either without knowing which they hold.
 *
 * Pure data constructors: no three.js, no DOM, no dimensions of their own.
 */

/** Shapes a consumer must know how to draw (§3.3). */
export const PartShape = Object.freeze({
  BOX: 'box',
  SPHERE: 'sphere',
  CONE: 'cone',
  CYLINDER: 'cylinder',
  WEDGE: 'wedge'
});

/**
 * `glow` marks a part as self-lit: the 3D view gives it an emissive material and the 2D
 * painter draws a bloom behind it. It is a MATERIAL flag, not a rarity effect — a common
 * item may use it and a legendary one need not (SKIN_SPEC §8).
 */
export const box = (id, tag, role, size, pos, rot = null, glow = false) => ({
  id, tag, role, shape: PartShape.BOX, size, pos, rot, glow
});

export const sphere = (id, tag, role, radius, pos, glow = false) => ({
  id, tag, role, shape: PartShape.SPHERE, radius, pos, rot: null, glow
});

export const cone = (id, tag, role, radius, height, pos, rot = null, glow = false) => ({
  id, tag, role, shape: PartShape.CONE, radius, height, pos, rot, glow
});

export const cylinder = (
  id, tag, role, radius, height, pos, rot = null, radiusTop = radius, glow = false
) => ({
  id, tag, role, shape: PartShape.CYLINDER, radius, radiusTop, height, pos, rot, glow
});

export const wedge = (id, tag, role, size, pos, rot = null, glow = false) => ({
  id, tag, role, shape: PartShape.WEDGE, size, pos, rot, glow
});

export const v = (x, y, z) => ({ x, y, z });

/**
 * Repaint parts a base builder already placed.
 *
 * Some garments are defined by what they REMOVE: a tank top is bare arms, not an added
 * sleeve. Without this a sleeveless outfit would need a second base body, which is the
 * duplication the rig exists to prevent.
 */
export function repaint(parts, ids, role) {
  for (const part of parts) if (ids.includes(part.id)) part.role = role;
}

/** Half-extents of one part, ignoring rotation — enough to frame a preview. */
export function partHalfExtents(part) {
  switch (part.shape) {
    case PartShape.SPHERE:
      return { x: part.radius, y: part.radius, z: part.radius };
    case PartShape.CONE:
      return { x: part.radius, y: part.height / 2, z: part.radius };
    case PartShape.CYLINDER: {
      const r = Math.max(part.radius, part.radiusTop ?? part.radius);
      return { x: r, y: part.height / 2, z: r };
    }
    default:
      return { x: part.size.x / 2, y: part.size.y / 2, z: part.size.z / 2 };
  }
}

/** Axis-aligned extents of a part list. Purely presentational — never a hitbox. */
export function rigBounds(rig) {
  const b = {
    minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity
  };
  for (const part of rig.parts) {
    const half = partHalfExtents(part);
    b.minX = Math.min(b.minX, part.pos.x - half.x);
    b.maxX = Math.max(b.maxX, part.pos.x + half.x);
    b.minY = Math.min(b.minY, part.pos.y - half.y);
    b.maxY = Math.max(b.maxY, part.pos.y + half.y);
    b.minZ = Math.min(b.minZ, part.pos.z - half.z);
    b.maxZ = Math.max(b.maxZ, part.pos.z + half.z);
  }
  return b;
}

/**
 * Resolve a part's colour through its owner's palette (§4).
 * Works for a skin or a tool: both declare a role map, and both fall back to `primary`.
 */
export function partColour(owner, part) {
  return owner.palette[part.role] ?? owner.palette.primary;
}

/**
 * Painter's order for 2D consumers: furthest back first, stable where depths tie, so the
 * order is deterministic and an array-order paint is always correct.
 */
export function depthSort(parts) {
  return parts
    .map((p, index) => ({ p, index }))
    .sort((a, b) => (a.p.pos.z - b.p.pos.z) || (a.index - b.index))
    .map((e) => e.p);
}
