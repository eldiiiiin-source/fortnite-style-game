/**
 * Random.js — seeded RNG streams. MASTER_SPEC §11.1.
 *
 * All gameplay randomness comes from a named stream derived from the match seed.
 * Math.random() is banned outside the `cosmetic` stream.
 */

const STREAM_NAMES = Object.freeze(['loot', 'storm', 'spread', 'cosmetic']);

/** FNV-1a, used to fold a string into a 32-bit seed contribution. */
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** xorshift128+ over two 32-bit halves per 64-bit lane. Deterministic across platforms. */
export class RandomStream {
  constructor(seed) {
    // SplitMix32 the seed into four non-zero state words.
    let s = seed >>> 0 || 0x9e3779b9;
    const next = () => {
      s = (s + 0x9e3779b9) >>> 0;
      let z = s;
      z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0;
      z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0;
      return (z ^ (z >>> 15)) >>> 0;
    };
    this.s0 = next() || 1;
    this.s1 = next() || 2;
    this.s2 = next() || 3;
    this.s3 = next() || 4;
    this.count = 0;
  }

  /** Raw 32-bit unsigned. */
  nextUint32() {
    let t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0;
    this.s0 >>>= 0; this.s1 >>>= 0; this.s2 >>>= 0; this.s3 >>>= 0;
    this.count++;
    t = (this.s0 + this.s3) >>> 0;
    return t;
  }

  /** Float in [0, 1). */
  next() {
    return this.nextUint32() / 4294967296;
  }

  /** Float in [min, max). */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /** Integer in [min, max] inclusive. */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /** True with the given probability. */
  chance(p) {
    return this.next() < p;
  }

  /** Pick from an array uniformly. */
  pick(array) {
    return array[Math.floor(this.next() * array.length)];
  }

  /**
   * Pick a key from a { key: weight } map, proportional to weight.
   * Weights need not sum to 100.
   */
  weighted(weights) {
    const keys = Object.keys(weights);
    let total = 0;
    for (const k of keys) total += weights[k];
    let roll = this.next() * total;
    for (const k of keys) {
      roll -= weights[k];
      if (roll <= 0) return k;
    }
    return keys[keys.length - 1];
  }

  /** In-place Fisher-Yates using this stream. */
  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

/** The four named streams for a match, all derived from one seed. */
export class MatchRandom {
  constructor(seed) {
    this.seed = seed >>> 0;
    for (const name of STREAM_NAMES) {
      this[name] = new RandomStream((this.seed ^ hashString(name)) >>> 0);
    }
  }

  static get streamNames() {
    return STREAM_NAMES;
  }
}

export { hashString };
