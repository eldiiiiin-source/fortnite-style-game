/**
 * AimRay.js — the single source of aim direction. MASTER_SPEC §8, §8.1.
 *
 * "The crosshair and weapon ray must agree. Use the camera aim direction for targeting."
 *
 * Every system that needs to know what the player is pointing at — weapon tracing, build
 * placement targeting, edit targeting, interaction prompts — calls aimRayFrom(camera).
 * No system computes its own aim direction. That is what makes it impossible for the
 * crosshair and the shot to drift apart.
 *
 * The ray originates at the CAMERA, not the player's eye. The camera sits offset at the
 * right shoulder, so a ray from the eye would diverge from the rendered crosshair by the
 * shoulder offset — the exact failure §8 forbids.
 */

/**
 * @param {object} camera  PlayerCamera (or anything exposing position + lookDirection)
 * @returns {{origin:{x,y,z}, direction:{x,y,z}}}
 */
export function aimRayFrom(camera) {
  return {
    origin: { ...camera.position },
    direction: { ...camera.lookDirection }
  };
}

/** Point at distance t along a ray. */
export function pointOnRay(ray, t) {
  return {
    x: ray.origin.x + ray.direction.x * t,
    y: ray.origin.y + ray.direction.y * t,
    z: ray.origin.z + ray.direction.z * t
  };
}

/**
 * Slab-method ray/AABB intersection.
 *
 * @param {object} ray
 * @param {{min:number[], max:number[]}} box
 * @param {number} maxDistance
 * @returns {number|null} distance along the ray to the entry point, or null
 */
export function rayAabb(ray, box, maxDistance = Infinity) {
  const o = [ray.origin.x, ray.origin.y, ray.origin.z];
  const d = [ray.direction.x, ray.direction.y, ray.direction.z];

  let tMin = 0;
  let tMax = maxDistance;

  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      // Parallel to this slab: miss unless the origin is already inside it.
      if (o[i] < box.min[i] || o[i] > box.max[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (box.min[i] - o[i]) * inv;
    let t2 = (box.max[i] - o[i]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tMin = Math.max(tMin, t1);
    tMax = Math.min(tMax, t2);
    if (tMin > tMax) return null;
  }
  return tMin;
}

/**
 * Ray against a sloped quad (used for ramp surfaces). The plane is defined by a point and
 * a normal, then bounded by the AABB of the ramp cell.
 *
 * @returns {number|null} distance along the ray
 */
export function rayPlaneInBox(ray, planePoint, planeNormal, box, maxDistance = Infinity) {
  const denom =
    ray.direction.x * planeNormal.x +
    ray.direction.y * planeNormal.y +
    ray.direction.z * planeNormal.z;
  if (Math.abs(denom) < 1e-9) return null;

  const t =
    ((planePoint.x - ray.origin.x) * planeNormal.x +
     (planePoint.y - ray.origin.y) * planeNormal.y +
     (planePoint.z - ray.origin.z) * planeNormal.z) / denom;

  if (t < 0 || t > maxDistance) return null;

  const p = pointOnRay(ray, t);
  const eps = 1e-6;
  if (p.x < box.min[0] - eps || p.x > box.max[0] + eps) return null;
  if (p.y < box.min[1] - eps || p.y > box.max[1] + eps) return null;
  if (p.z < box.min[2] - eps || p.z > box.max[2] + eps) return null;
  return t;
}
