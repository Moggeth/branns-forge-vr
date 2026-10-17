"""Core kit ground textures: seven tileable 512 px layers, generated (no source art needed).

Layers, in array order: 0 lush grass, 1 meadow (dry grass), 2 forest floor, 3 soil, 4 sand, 5 rock, 6 snow.
Writes public/assets/kit_ground_albedo.png (a vertical RGB strip) and kit_ground_normal.png (strip, half resolution:
red/green = tangent-space normal x/y, blue = height for blending). Both are opaque on purpose: browsers premultiply
alpha when decoding, which would destroy colour wherever a height in alpha ran low. Roughness lives in the shader. Everything is periodic by construction (spectral
synthesis on a torus), so every layer tiles seamlessly at every mip. Run: python3 scripts/kit/ground_textures.py
"""
import numpy as np
from PIL import Image
import os

N = 512
rng = np.random.default_rng(20261017)
fx = np.fft.fftfreq(N)[None, :]
fy = np.fft.fftfreq(N)[:, None]
fr = np.sqrt(fx * fx + fy * fy) * N  # cycles per tile


def spectral(beta=2.0, lo=1.0, hi=N / 2, seed=None):
    """Periodic fractal noise, unit variance: amplitude ~ f^-beta/2 between lo and hi cycles per tile."""
    r = rng if seed is None else np.random.default_rng(seed)
    w = np.fft.fft2(r.standard_normal((N, N)))
    amp = np.where((fr >= lo) & (fr <= hi), np.power(np.maximum(fr, 1e-6), -beta / 2), 0.0)
    out = np.real(np.fft.ifft2(w * amp))
    return (out - out.mean()) / (out.std() + 1e-9)


def blur(a, cycles):
    """Periodic gaussian low-pass to `cycles` per tile."""
    return np.real(np.fft.ifft2(np.fft.fft2(a) * np.exp(-(fr / cycles) ** 2)))


def norm01(a):
    lo, hi = np.percentile(a, 1), np.percentile(a, 99)
    return np.clip((a - lo) / (hi - lo + 1e-9), 0, 1)


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a + (b - a) * t


def hexc(h):
    return np.array([(h >> 16) & 255, (h >> 8) & 255, h & 255], float) / 255.0


def palette(t, stops):
    """Map t in 0..1 through colour stops [(pos, hex)]."""
    out = np.zeros(t.shape + (3,))
    pos = [p for p, _ in stops]
    cols = [hexc(c) for _, c in stops]
    for i in range(len(stops) - 1):
        m = (t >= pos[i]) & (t <= pos[i + 1])
        k = ((t - pos[i]) / (pos[i + 1] - pos[i]))[m]
        out[m] = cols[i] * (1 - k[:, None]) + cols[i + 1] * k[:, None]
    out[t < pos[0]] = cols[0]
    out[t > pos[-1]] = cols[-1]
    return out


def voronoi(n_cells, seed, jitter=1.0):
    """Periodic Worley: (F1, F2, cell id) on the torus."""
    r = np.random.default_rng(seed)
    gap, pts = 0.55 / np.sqrt(n_cells), []
    while len(pts) < n_cells:  # well spaced seeds: two near-coincident seeds would smear a wide dark wedge
        p = r.random(2)
        if all(min(abs(p[0] - q[0]), 1 - abs(p[0] - q[0])) ** 2 + min(abs(p[1] - q[1]), 1 - abs(p[1] - q[1])) ** 2 > gap * gap for q in pts):
            pts.append(p)
    ys, xs = np.mgrid[0:N, 0:N] / N
    f1 = np.full((N, N), 9.0); f2 = np.full((N, N), 9.0); idx = np.zeros((N, N), int)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(xs - px); dx = np.minimum(dx, 1 - dx)
        dy = np.abs(ys - py); dy = np.minimum(dy, 1 - dy)
        d = np.sqrt(dx * dx + dy * dy)
        closer = d < f1
        f2 = np.where(closer, f1, np.minimum(f2, d))
        idx = np.where(closer, k, idx)
        f1 = np.where(closer, d, f1)
    return f1, f2, idx


def strokes(count, length, width, seed, angle_jitter=0.6, base_angle=None):
    """Periodic soft blade strokes: returns coverage 0..1 and a per-stroke tint field."""
    r = np.random.default_rng(seed)
    cov = np.zeros((N, N)); tint = np.zeros((N, N))
    for _ in range(count):
        cx, cy = r.random() * N, r.random() * N
        a = (base_angle if base_angle is not None else r.random() * np.pi) + r.normal() * angle_jitter
        L = length * (0.6 + 0.8 * r.random()); W = width * (0.7 + 0.6 * r.random())
        steps = int(L)
        t = r.random()
        for s in range(steps):
            u = s / max(1, steps - 1)
            x = int(cx + np.cos(a) * s) % N; y = int(cy + np.sin(a) * s) % N
            w = W * (1 - u * 0.85)
            rad = max(1, int(np.ceil(w)))
            for oy in range(-rad, rad + 1):
                for ox in range(-rad, rad + 1):
                    d = np.hypot(ox, oy) / (w + 1e-6)
                    if d < 1:
                        v = (1 - d) * (0.55 + 0.45 * u)
                        yy, xx = (y + oy) % N, (x + ox) % N
                        if v > cov[yy, xx]:
                            cov[yy, xx] = v; tint[yy, xx] = t * 0.6 + u * 0.4
    return cov, tint


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    n = np.stack([-gx, gy, np.ones_like(h)], -1)
    return n / np.linalg.norm(n, axis=-1, keepdims=True)


layers = []

# 0 lush grass: dense blade strokes over a mottled base, warm tips, cool shade.
base = norm01(spectral(2.6, 2, 64)); mott = norm01(spectral(3.0, 1, 12))
cov, tint = strokes(4200, 9, 1.3, 1)
cov2, tint2 = strokes(2600, 6, 1.0, 2)
cov = np.maximum(cov, cov2 * 0.9); tint = np.where(cov2 > cov * 0.95, tint2, tint)
col = palette(base * 0.6 + mott * 0.4, [(0, 0x3f7a2a), (0.5, 0x5d9a37), (1, 0x7cb444)])
blade = palette(tint, [(0, 0x5c9a34), (0.6, 0x86bf4a), (1, 0xb4d466)])
col = lerp(col * 0.78, blade, cov * 0.9)
h = 0.35 * base + 0.65 * cov
layers.append((col, h, 3.0, 0.92))

# 1 meadow: drier, golden-green with seed heads and clover patches.
base = norm01(spectral(2.4, 2, 80)); patch = smooth(0.45, 0.85, norm01(spectral(3.2, 2, 10)))
cov, tint = strokes(3600, 10, 1.1, 3)
col = palette(base, [(0, 0x7e8f3a), (0.55, 0x9fa94b), (1, 0xc2b65c)])
col = lerp(col, palette(norm01(spectral(2, 8, 128)), [(0, 0x6f9238), (1, 0x86a840)]), patch * 0.45)
col = lerp(col * 0.85, palette(tint, [(0, 0x9aa548), (1, 0xd8c873)]), cov * 0.85)
dots = (norm01(spectral(1.2, 64, 256)) > 0.985).astype(float)
col = lerp(col, np.ones_like(col) * hexc(0xf4ecd0), blur(dots, 120) * 6 * (1 - patch))
layers.append((col, 0.4 * base + 0.6 * cov, 2.6, 0.93))

# 2 forest floor: leaf litter, moss and twig shadows.
f1, f2, idx = voronoi(1400, 4)
leaf = smooth(0.0, 0.008, f2 - f1)
hue = (idx * 0.6180339) % 1.0
col = palette(hue, [(0, 0x7a5432), (0.35, 0x9b6b39), (0.65, 0x6e5a2e), (1, 0xa9843f)])
moss = smooth(0.45, 0.8, norm01(spectral(3.0, 2, 16))) * 0.75
col = lerp(col * (0.84 + 0.16 * leaf[..., None]) * (0.85 + 0.3 * norm01(spectral(2.5, 2, 64))[..., None]), palette(norm01(spectral(2, 16, 200)), [(0, 0x3f6527), (1, 0x5f8a33)]), moss * 0.85)
h = leaf * 0.5 + norm01(spectral(2.2, 4, 128)) * 0.5
layers.append((col, h, 3.5, 0.9))

# 3 soil: packed earth with pebbles.
base = norm01(spectral(2.2, 2, 160))
f1, f2, idx = voronoi(180, 5)
peb = smooth(0.018, 0.009, f1) * ((idx * 0.37) % 1 > 0.6)
col = palette(base, [(0, 0x6e4b2c), (0.5, 0x8a6038), (1, 0xa47a4a)])
col = lerp(col, palette((idx * 0.71) % 1.0, [(0, 0x6f675e), (1, 0x948a7c)]), peb * 0.85)
h = base * 0.4 + peb * 0.6
layers.append((col, h, 3.0, 0.95))

# 4 sand: fine grain and wind ripples.
ys, xs = np.mgrid[0:N, 0:N] / N
warp = spectral(3, 1, 6, seed=9) * 0.04
rip = 0.5 + 0.5 * np.sin((ys + xs * 0.25 + warp) * np.pi * 2 * 24)
grain = norm01(spectral(0.8, 64, 256))
col = palette(norm01(spectral(2.5, 1, 24)), [(0, 0xcdb27c), (1, 0xe6d3a0)]) * (0.9 + 0.12 * grain[..., None]) * (0.94 + 0.08 * rip[..., None])
layers.append((col, rip * 0.25 + grain * 0.4 + norm01(spectral(2.5, 1, 24)) * 0.35, 1.2, 0.97))

# 5 rock: layered, fractured stone. Strata run along v (cliffs sample it side-on), ridged fractal relief, a few
# long cracks, lichen on the upper lips.
ys, xs = np.mgrid[0:N, 0:N] / N
wob = spectral(3.0, 1, 8, seed=61) * 0.035
bands = 0.5 + 0.5 * np.sin((ys + wob) * np.pi * 2 * 7 + spectral(2.5, 1, 16, seed=62) * 0.8)
ridge = norm01(1 - np.abs(spectral(2.1, 2, 160, seed=63)))
f1, f2, idx = voronoi(40, 6)
crack = smooth(0.0, 0.006, f2 - f1)
tone = norm01(spectral(2.6, 1, 32, seed=64))
col = palette(tone * 0.55 + bands * 0.45, [(0, 0x5a5856), (0.45, 0x77736d), (0.8, 0x928d85), (1, 0xa9a49a)])
col *= (0.6 + 0.4 * crack[..., None]) * (0.78 + 0.32 * ridge[..., None])
lichen = smooth(0.7, 0.88, norm01(spectral(2.0, 6, 128, seed=65))) * smooth(0.55, 0.9, bands)
col = lerp(col, np.ones_like(col) * hexc(0x9aa65e), lichen * 0.5)
h = crack * 0.35 + ridge * 0.4 + bands * 0.25
layers.append((col, h, 5.0, 0.85))

# 6 snow: soft drifts, blue in the hollows.
drift = norm01(spectral(3.0, 1, 40)); fine = norm01(spectral(1.0, 64, 256))
col = palette(drift, [(0, 0xc9d6e6), (0.5, 0xe6eef6), (1, 0xffffff)]) * (0.97 + 0.04 * fine[..., None])
layers.append((col, drift * 0.8 + fine * 0.2, 1.5, 0.6))

# Write strips. Albedo in sRGB; normal x/y plus blend height.
out_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'public', 'assets')
os.makedirs(out_dir, exist_ok=True)
alb = np.zeros((N * len(layers), N, 3), np.uint8); M = N // 2; nrm = np.zeros((M * len(layers), M, 3), np.uint8)
for i, (col, h, strength, rough) in enumerate(layers):
    hh = norm01(h)
    alb[i * N:(i + 1) * N] = np.clip(col * 255 + 0.5, 0, 255).astype(np.uint8)
    # Normals at half resolution (detail relief only; keeps the download small for phones).
    small = hh.reshape(M, 2, M, 2).mean(axis=(1, 3))
    n = normal_from_height(small, strength * M / 128)
    nrm[i * M:(i + 1) * M, :, :2] = np.clip((n[..., :2] * 0.5 + 0.5) * 255 + 0.5, 0, 255).astype(np.uint8)
    nrm[i * M:(i + 1) * M, :, 2] = np.clip(small * 255 + 0.5, 0, 255).astype(np.uint8)
    print(f'layer {i}: roughness {rough}')
Image.fromarray(alb, 'RGB').save(os.path.join(out_dir, 'kit_ground_albedo.png'), optimize=True)
Image.fromarray(nrm, 'RGB').save(os.path.join(out_dir, 'kit_ground_normal.png'), optimize=True)
print('wrote', len(layers), 'layers')
