// Seeded 2D gradient noise (Perlin "improved" style) with fBm, ridged and domain-warp helpers.
// Pure doubles and integer table lookups, so values are bit-identical everywhere.
import {createRandom} from './random.js';

const R = .7071067811865476; // literal unit gradients: no engine-dependent cos/sin
const GRADS = new Float64Array([1, 0, R, R, 0, 1, -R, R, -1, 0, -R, -R, 0, -1, R, -R]);
const fade = t => t * t * t * (t * (t * 6 - 15) + 10);

export function createNoise(seed) {
  const rand = createRandom(seed), perm = new Uint8Array(512), p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rand.next() * (i + 1)), t = p[i]; p[i] = p[j]; p[j] = t; }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const grad = (h, x, z) => { const g = (h & 7) * 2; return GRADS[g] * x + GRADS[g + 1] * z; };
  /** Noise in roughly [-1,1] with period 256. */
  function noise(x, z) {
    const xf = Math.floor(x), zf = Math.floor(z), X = xf & 255, Z = zf & 255, dx = x - xf, dz = z - zf;
    const u = fade(dx), v = fade(dz);
    const a = perm[X] + Z, b = perm[X + 1] + Z;
    const n00 = grad(perm[a], dx, dz), n10 = grad(perm[b], dx - 1, dz), n01 = grad(perm[a + 1], dx, dz - 1), n11 = grad(perm[b + 1], dx - 1, dz - 1);
    const nx0 = n00 + (n10 - n00) * u, nx1 = n01 + (n11 - n01) * u;
    return (nx0 + (nx1 - nx0) * v) * 1.4142;
  }
  /** Fractal sum; result roughly [-1,1]. */
  function fbm(x, z, octaves = 5, lacunarity = 2, gain = .5) {
    let sum = 0, amp = 1, norm = 0, f = 1;
    for (let o = 0; o < octaves; o++) { sum += noise(x * f + o * 17.31, z * f - o * 9.73) * amp; norm += amp; amp *= gain; f *= lacunarity; }
    return sum / norm;
  }
  /** Ridged multifractal in [0,1]: sharp crests, the shape of mountain chains. */
  function ridged(x, z, octaves = 5, lacunarity = 2.1, gain = .5) {
    let sum = 0, amp = 1, norm = 0, f = 1, weight = 1;
    for (let o = 0; o < octaves; o++) {
      let n = 1 - Math.abs(noise(x * f + o * 31.7, z * f + o * 11.3));
      n *= n; n *= weight; weight = Math.min(1, Math.max(0, n * 1.6));
      sum += n * amp; norm += amp; amp *= gain; f *= lacunarity;
    }
    return sum / norm;
  }
  return {noise, fbm, ridged};
}
