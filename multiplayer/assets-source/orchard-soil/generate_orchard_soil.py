"""Editable generator for the Orchard trodden-soil tile (seamless, deterministic).

Outputs (512x512, tile is ~2.2 m in world space):
  public/assets/orchard_soil_albedo.png  RGB = sRGB albedo (no alpha: avoids browser
                                         premultiply/white-fringe problems)
  public/assets/orchard_soil_normal.png  RG = OpenGL tangent-space normal XY (+Y up; Z is
                                         reconstructed in the shader), B = height 0..1 (linear)

Run:  python tools/generate_orchard_soil.py
Only numpy + Pillow; no network, no image models. Change SEED/palette below and rerun.
"""
from pathlib import Path
import numpy as np
from PIL import Image

SEED = 1803
N = 512
OUT = Path(__file__).resolve().parents[2] / "public" / "assets"
# Warm ochre earth; values are sRGB 0..255.
SOIL_DARK = np.array([92, 66, 44], float)
SOIL_LIGHT = np.array([168, 132, 92], float)
PEBBLE_A = np.array([132, 120, 102], float)
PEBBLE_B = np.array([104, 90, 74], float)

rng = np.random.default_rng(SEED)


def periodic_noise(cells, octaves=4, persistence=0.5):
    """Tileable value-noise fBm via FFT-free bilinear upsampling of wrapped lattices."""
    total = np.zeros((N, N))
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        c = cells * (2 ** o)
        lattice = rng.random((c, c))
        coords = np.arange(N) * c / N
        i0 = np.floor(coords).astype(int)
        f = coords - i0
        f = f * f * (3 - 2 * f)
        i1 = (i0 + 1) % c
        a = lattice[np.ix_(i0, i0)]; b = lattice[np.ix_(i0, i1)]
        cc = lattice[np.ix_(i1, i0)]; d = lattice[np.ix_(i1, i1)]
        fy, fx = f[:, None], f[None, :]
        total += amp * ((a * (1 - fx) + b * fx) * (1 - fy) + (cc * (1 - fx) + d * fx) * fy)
        norm += amp; amp *= persistence
    return total / norm


def pebbles(count, rmin, rmax):
    """Wrapped elliptical pebbles: returns (height, mask, tint index)."""
    h = np.zeros((N, N)); m = np.zeros((N, N)); t = np.zeros((N, N))
    yy, xx = np.mgrid[0:N, 0:N]
    for _ in range(count):
        cx, cy = rng.random(2) * N
        r = rng.uniform(rmin, rmax); e = rng.uniform(0.6, 1.0); ang = rng.uniform(0, np.pi)
        dx = (xx - cx + N / 2) % N - N / 2; dy = (yy - cy + N / 2) % N - N / 2
        ca, sa = np.cos(ang), np.sin(ang)
        u = (dx * ca + dy * sa) / r; v = (-dx * sa + dy * ca) / (r * e)
        d = u * u + v * v
        dome = np.clip(1 - d, 0, 1) ** 0.6
        inside = dome > h
        h = np.where(inside, dome, h); m = np.maximum(m, (d < 1).astype(float))
        t = np.where(inside & (d < 1), rng.random(), t)
    return h, m, t


base = periodic_noise(4, 5)
fine = periodic_noise(32, 3)
clods = periodic_noise(12, 3)
ph, pm, pt = pebbles(120, 3.0, 9.0)
gh, gm, _ = pebbles(900, 0.8, 2.2)  # grit

height = 0.35 * base + 0.15 * fine + 0.2 * np.clip(clods - 0.45, 0, 1) + 0.45 * ph + 0.12 * gh
height = (height - height.min()) / (height.max() - height.min())

soil_t = np.clip(0.25 + 0.6 * base + 0.25 * (fine - 0.5), 0, 1)[..., None]
albedo = SOIL_DARK * (1 - soil_t) + SOIL_LIGHT * soil_t
peb_col = PEBBLE_A * pt[..., None] + PEBBLE_B * (1 - pt[..., None])
peb_col *= (0.82 + 0.3 * ph)[..., None]
albedo = albedo * (1 - pm[..., None]) + peb_col * pm[..., None]
albedo *= (0.9 + 0.15 * gm)[..., None]
# crevice darkening (cheap cavity)
cav = np.clip(height - (np.roll(height, 2, 0) + np.roll(height, -2, 0) + np.roll(height, 2, 1) + np.roll(height, -2, 1)) / 4, -0.08, 0.08)
albedo *= (1 + 2.2 * cav)[..., None]
albedo = np.clip(albedo, 0, 255)

strength = 6.0
gx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5 * strength
gy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5 * strength
nrm = np.stack([-gx, gy, np.ones_like(gx)], -1)  # image rows go down => +v is up (OpenGL)
nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)

OUT.mkdir(parents=True, exist_ok=True)
Image.fromarray(albedo.astype(np.uint8), "RGB").save(OUT / "orchard_soil_albedo.png", optimize=True)
packed = np.dstack([nrm[..., 0] * 0.5 + 0.5, nrm[..., 1] * 0.5 + 0.5, height])
Image.fromarray(np.clip(packed * 255 + 0.5, 0, 255).astype(np.uint8), "RGB").save(OUT / "orchard_soil_normal.png", optimize=True)
print("wrote", OUT / "orchard_soil_albedo.png", OUT / "orchard_soil_normal.png")
