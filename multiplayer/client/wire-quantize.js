// Snapshot-only number rounding for the 20 Hz guest stream. Same JSON shape and keys, so guests and
// protocol version are unaffected. Checkpoints and saves stay exact (host-migration determinism).
// 1 mm positions and 1e-4 rotations are far below what rendering or interpolation can show.
const round = (n, scale) => Math.round(n * scale) / scale;
export function quantizeWire(value, scale = 1000, depth = 0) {
  if (typeof value === 'number') return Number.isFinite(value) && !Number.isInteger(value) ? round(value, scale) : value;
  if (value === null || typeof value !== 'object' || depth > 12) return value;
  if (Array.isArray(value)) {
    // Quaternions get one more decimal so renormalised orientation stays visually exact.
    const s = value.length === 4 && value.every(n => typeof n === 'number') ? scale * 10 : scale;
    return value.map(item => quantizeWire(item, s, depth + 1));
  }
  const out = {};
  for (const key in value) if (Object.hasOwn(value, key)) out[key] = quantizeWire(value[key], scale, depth + 1);
  return out;
}
