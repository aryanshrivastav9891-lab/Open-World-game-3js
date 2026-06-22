// Small, dependency-free math + deterministic RNG helpers.
// Everything procedural in the world derives from these so the town is
// identical on every load (no need to persist anything to disk).

export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function invLerp(a, b, v) {
  return (v - a) / (b - a);
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// Frame-rate independent exponential smoothing ("lerp toward target").
// lambda is roughly "how fast" — higher converges quicker.
export function damp(a, b, lambda, dt) {
  return lerp(a, b, 1 - Math.exp(-lambda * dt));
}

// Wrap an angle to [-PI, PI].
export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

// Shortest-path angular damp (handles wraparound).
export function dampAngle(a, b, lambda, dt) {
  return a + wrapAngle(b - a) * (1 - Math.exp(-lambda * dt));
}

// --- Deterministic hashing / RNG ---------------------------------------

// Hash two integers into a 32-bit seed (good enough for content scatter).
export function hash2(x, y) {
  let h = (x | 0) * 374761393 + (y | 0) * 668265263;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (h ^ (h >>> 16)) >>> 0;
}

export function hash3(x, y, z) {
  return hash2(hash2(x, y), z | 0);
}

// mulberry32 — tiny, fast, decent-quality PRNG. Returns a function () => [0,1).
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convenience: seeded RNG from integer coords.
export function rngFor(x, y, salt = 0) {
  return mulberry32(hash3(x, y, salt));
}

// Smooth value noise (sum of a few hashed lattice points, bilinear blended).
// Cheap and good enough for gentle terrain hills. Returns roughly [-1, 1].
function valueNoise2(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const r = (ix, iy) => (hash3(ix, iy, seed) / 4294967296) * 2 - 1;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const n00 = r(xi, yi);
  const n10 = r(xi + 1, yi);
  const n01 = r(xi, yi + 1);
  const n11 = r(xi + 1, yi + 1);
  const nx0 = lerp(n00, n10, u);
  const nx1 = lerp(n01, n11, u);
  return lerp(nx0, nx1, v);
}

// Fractal noise (a couple of octaves) for terrain.
export function fbm2(x, y, seed = 1337, octaves = 3) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}
