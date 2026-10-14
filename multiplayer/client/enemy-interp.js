// Enemy root presentation: snapshot interpolation instead of chasing the latest packet.
// Snapshots arrive at 20 Hz from a browser host (every 3 sim ticks) and ~10 Hz from the cloud. Chasing the newest one with
// an exponential lerp made walkers surge and coast between packets, and the yaw snapped on every arrival. Here each enemy
// keeps a short history of (tick, position, yaw) and is drawn a little behind the presentation clock, on a C1 Hermite
// curve through those samples, so position, speed and heading all change continuously every frame. Presentation only.

const KEEP = 8;           // samples kept per enemy
const SNAP_DIST = 3;      // metres between samples treated as a teleport (respawn, launch landing): no interpolation across it
const EXTRA_DELAY = 1.5;  // ticks of safety on top of one snapshot interval
const MAX_EXTRAPOLATE = 6;// ticks we may run past the newest sample before holding

const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));

function track(entry) {
  return entry.interp ||= {samples: [], interval: 3, shownYaw: null};
}

// Called once per received snapshot for each enemy. Duplicate ticks are ignored (repeated deliveries carry no motion).
export function noteEnemySnapshot(entry, data, tick) {
  if (!entry || !data?.position || !Number.isFinite(tick)) return;
  const st = track(entry), S = st.samples, last = S[S.length - 1];
  if (last && tick <= last.tick) { if (tick === last.tick) return; S.length = 0; } // a rewound host: start a fresh history
  const [x, y, z] = data.position, raw = Number.isFinite(data.yaw) ? data.yaw : 0;
  if (last && Math.hypot(x - last.x, z - last.z) > SNAP_DIST) S.length = 0;
  const prev = S[S.length - 1];
  // Yaw is unwrapped against the previous sample so the curve never spins the long way round.
  const yaw = prev ? prev.yaw + wrap(raw - prev.yaw) : raw;
  if (prev) st.interval += (Math.min(12, tick - prev.tick) - st.interval) * .2;
  S.push({tick, x, y, z, yaw});
  if (S.length > KEEP) S.shift();
}

// Ticks behind the presentation clock that enemies are drawn at. renderTick runs up to a snapshot interval past the
// newest packet, so one interval plus a margin keeps the shown time between two real samples.
export const enemyDelay = entry => (entry?.interp?.interval ?? 3) + EXTRA_DELAY;

// Hermite between samples i and i+1 at fraction u, tangents from neighbours (Catmull-Rom with uneven spacing).
function slope(S, i, key) {
  const a = S[Math.max(0, i - 1)], b = S[Math.min(S.length - 1, i + 1)];
  return b.tick > a.tick ? (b[key] - a[key]) / (b.tick - a.tick) : 0;
}
function hermite(S, i, key, tt) {
  const a = S[i], b = S[i + 1], h = b.tick - a.tick, u = (tt - a.tick) / h, u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * a[key] + (u3 - 2 * u2 + u) * h * slope(S, i, key) + (-2 * u3 + 3 * u2) * b[key] + (u3 - u2) * h * slope(S, i + 1, key);
}

const out = {x: 0, y: 0, z: 0, yaw: 0};
// Sample the presented root at renderTick; returns null with no history.
export function sampleEnemyRoot(entry, renderTick) {
  const st = entry?.interp, S = st?.samples;
  if (!S?.length) return null;
  const tt = renderTick - enemyDelay(entry);
  if (S.length === 1 || tt <= S[0].tick) { const a = S[0]; out.x = a.x; out.y = a.y; out.z = a.z; out.yaw = a.yaw; return out; }
  const n = S.length - 1;
  if (tt >= S[n].tick) {
    // Past the newest packet (a late one): carry on along the last velocity for a few ticks, then hold.
    const a = S[n - 1], b = S[n], h = Math.max(1, b.tick - a.tick), e = Math.min(tt - b.tick, MAX_EXTRAPOLATE);
    const k = e * (1 - e / (2 * MAX_EXTRAPOLATE * 1.5)); // eases off rather than stopping dead
    out.x = b.x + (b.x - a.x) / h * k; out.y = b.y + (b.y - a.y) / h * k; out.z = b.z + (b.z - a.z) / h * k; out.yaw = b.yaw + (b.yaw - a.yaw) / h * k;
    return out;
  }
  let i = n - 1; while (i > 0 && S[i].tick > tt) i--;
  out.x = hermite(S, i, 'x', tt); out.y = hermite(S, i, 'y', tt); out.z = hermite(S, i, 'z', tt); out.yaw = hermite(S, i, 'yaw', tt);
  return out;
}

// Per frame: place entry.root from the interpolated history. Falls back to the old chase when no history exists yet.
export function presentEnemyRoot(entry, renderTick, dt) {
  const p = sampleEnemyRoot(entry, renderTick);
  if (!p) { entry.root.position.lerp(entry.target, 1 - Math.exp(-dt * 12)); entry.root.rotation.y = entry.data?.yaw || 0; return; }
  entry.root.position.set(p.x, p.y, p.z);
  entry.root.rotation.y = wrap(p.yaw);
}
