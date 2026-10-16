// Deterministic seeds and random streams for world generation. No Math.random, no clock: the same seed text gives
// the same numbers on every device, browser and Node version (only 32-bit integer maths and IEEE doubles).

/** Seed text (any string or integer) -> unsigned 32-bit integer. Case and surrounding spaces are ignored. */
export function hashSeed(seed) {
  const text = String(seed).trim().toLowerCase();
  let h = 2166136261 >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return mix32(h);
}
/** Avalanche one 32-bit integer (murmur3 finaliser). */
export function mix32(h) {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
/** Hash any list of integers into one unsigned 32-bit integer. */
export function hashInts(...values) {
  let h = 0x9e3779b9;
  for (const v of values) h = mix32((h ^ (v | 0)) + 0x7f4a7c15 >>> 0);
  return h;
}
/** Uniform [0,1) from a list of integers: stable per-position randomness (tree at cell i,j, etc.). */
export const hash01 = (...values) => hashInts(...values) / 4294967296;
/** A seeded stream (mulberry32). next() -> [0,1). Also range/int/pick helpers. */
export function createRandom(seed) {
  let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (lo, hi) => lo + (hi - lo) * next(),
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: list => list[Math.floor(next() * list.length)],
    chance: p => next() < p,
  };
}
const SEED_WORDS_A = ['amber', 'brisk', 'copper', 'dapple', 'ember', 'fable', 'gilded', 'hazel', 'ivory', 'jolly', 'kindle', 'lucky',
  'mossy', 'nimble', 'opal', 'plucky', 'quill', 'rosy', 'sunny', 'tumble', 'umber', 'velvet', 'willow', 'zesty'];
const SEED_WORDS_B = ['otter', 'badger', 'heron', 'kestrel', 'marten', 'newt', 'puffin', 'wren', 'stoat', 'lynx', 'hare', 'finch',
  'beaver', 'curlew', 'falcon', 'gecko', 'ibis', 'jay', 'kite', 'lark', 'moth', 'owl', 'pika', 'robin'];
/** A friendly, shareable seed like "mossy-heron-417" from a numeric source. */
export function friendlySeed(n) {
  const h = mix32(n >>> 0);
  return `${SEED_WORDS_A[h % 24]}-${SEED_WORDS_B[(h >>> 8) % 24]}-${100 + (h >>> 16) % 900}`;
}
/** Normalise what a player typed into the seed field: trimmed, lower-case, max 48 chars, never empty. */
export function cleanSeed(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9_-]/g, '').slice(0, 48);
  return s || 'brann';
}
