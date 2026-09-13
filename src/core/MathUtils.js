/** Small maths helpers with no game knowledge. */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));

export function smoothstep(edge0, edge1, x) {
  const t = clamp(invLerp(edge0, edge1, x), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential damping toward a target. */
export function damp(current, target, lambda, dt) {
  return lerp(target, current, Math.exp(-lambda * dt));
}

/**
 * Piecewise-linear lookup over [[x, y], ...] stops sorted by x.
 * Values below the first stop clamp to it; above the last, clamp to it.
 */
export function sampleCurve(stops, x) {
  if (stops.length === 0) return 0;
  if (x <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i];
    if (x <= x1) {
      const [x0, y0] = stops[i - 1];
      return lerp(y0, y1, invLerp(x0, x1, x));
    }
  }
  return stops[stops.length - 1][1];
}

/** Shortest signed angular difference, radians, in (-PI, PI]. */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

export const length2 = (x, z) => Math.hypot(x, z);
