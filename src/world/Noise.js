/**
 * Noise.js — seeded value-gradient noise and fBm for terrain. MAP_SPEC §4.1.
 *
 * Deterministic from an integer seed; no Math.random(), no external dependency.
 */
import { hashString } from '../core/Random.js';

/** 2D hash → gradient direction. */
function grad2(seed, ix, iy) {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  const angle = (h / 4294967296) * Math.PI * 2;
  return [Math.cos(angle), Math.sin(angle)];
}

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);

/** Perlin-style gradient noise in [-1, 1]. */
export function noise2D(seed, x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1, y1 = y0 + 1;
  const fx = x - x0, fy = y - y0;

  const dot = (ix, iy) => {
    const [gx, gy] = grad2(seed, ix, iy);
    return gx * (x - ix) + gy * (y - iy);
  };

  const u = fade(fx), v = fade(fy);
  const n00 = dot(x0, y0), n10 = dot(x1, y0);
  const n01 = dot(x0, y1), n11 = dot(x1, y1);
  const nx0 = n00 + u * (n10 - n00);
  const nx1 = n01 + u * (n11 - n01);
  return nx0 + v * (nx1 - nx0);
}

/** Fractal Brownian motion. Returns roughly [-1, 1]. */
export function fbm(seed, x, y, { octaves = 4, frequency = 1, lacunarity = 2, gain = 0.5 } = {}) {
  let amplitude = 1, freq = frequency, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2D(seed + i * 7919, x * freq, y * freq) * amplitude;
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

/** Ridged fBm — sharp crests, used for the massif. Returns [0, 1]. */
export function ridgedFbm(seed, x, y, opts = {}) {
  const { octaves = 3, frequency = 1, lacunarity = 2, gain = 0.5 } = opts;
  let amplitude = 1, freq = frequency, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(noise2D(seed + i * 6271, x * freq, y * freq));
    sum += n * n * amplitude;
    norm += amplitude;
    amplitude *= gain;
    freq *= lacunarity;
  }
  return norm > 0 ? sum / norm : 0;
}

export { hashString };
