"""Editable generator for the Orchard deformation strata strip (deterministic, numpy + Pillow only).

One 512x512 tile used on freshly cut/raised terrain faces. Projection in the shader:
  u (columns) = horizontal world distance along the face, 4.0 m per tile, seamless.
  v (rows)    = depth below the undeformed surface, 160 px per metre:
     rows   0- 16  0.00-0.10 m  turf root mat (dark, fibrous)
     rows  16- 88  0.10-0.55 m  humus loam (dark brown crumbs)
     rows  88-168  0.55-1.05 m  ochre subsoil with pebbles
     rows 168-208  1.05-1.30 m  pale clay / marl laminations
     rows 208-256  1.30-1.60 m  gravel bed grading into rock
     rows 256-512  bedrock, seamless vertically AND horizontally (1.6 m period) so the shader
                   can wrap deeper faces and reuse it for exposed slope rock.
Outputs:
  public/assets/terrain_strata_albedo.png  RGB sRGB albedo (no alpha)
  public/assets/terrain_strata_normal.png  RG OpenGL normal XY (+Y up, Z rebuilt), B = height
Run:  python assets-source/terrain-strata/generate_terrain_strata.py
"""
from pathlib import Path
import hashlib
import numpy as np
from PIL import Image

SEED = 20261003
W = 512
OUT = Path(__file__).resolve().parents[2] / "public" / "assets"
rng = np.random.default_rng(SEED)

def pnoise(h, w, cy, cx, octaves=4, pers=0.5):
    """Tileable value fBm over an h x w grid with cy x cx base cells (both axes periodic)."""
    tot = np.zeros((h, w)); amp = 1.0; norm = 0.0
    for o in range(octaves):
        ny, nx = cy * 2 ** o, cx * 2 ** o
        lat = rng.random((ny, nx))
        fy = np.arange(h) * ny / h; fx = np.arange(w) * nx / w
        iy = np.floor(fy).astype(int); ix = np.floor(fx).astype(int)
        ty = fy - iy; tx = fx - ix; ty = ty * ty * (3 - 2 * ty); tx = tx * tx * (3 - 2 * tx)
        iy1 = (iy + 1) % ny; ix1 = (ix + 1) % nx
        a = lat[np.ix_(iy, ix)]; b = lat[np.ix_(iy, ix1)]; c = lat[np.ix_(iy1, ix)]; d = lat[np.ix_(iy1, ix1)]
        ty = ty[:, None]; tx = tx[None, :]
        tot += amp * ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty)
        norm += amp; amp *= pers
    return tot / norm

def stones(h, w, count, rmin, rmax, y0=0, y1=None, flat=0.6, wrap_y=False):
    """Wrapped ellipse pebbles. Returns (height dome, mask, random tint)."""
    y1 = h if y1 is None else y1
    H = np.zeros((h, w)); M = np.zeros((h, w)); T = np.zeros((h, w))
    yy, xx = np.mgrid[0:h, 0:w]
    for _ in range(count):
        cx = rng.random() * w; cy = y0 + rng.random() * (y1 - y0)
        r = rng.uniform(rmin, rmax); e = rng.uniform(flat, 1.0); ang = rng.uniform(-.5, .5)  # bedded: mostly horizontal
        dx = (xx - cx + w / 2) % w - w / 2
        dy = ((yy - cy + h / 2) % h - h / 2) if wrap_y else (yy - cy)
        ca, sa = np.cos(ang), np.sin(ang)
        u = (dx * ca + dy * sa) / r; v = (-dx * sa + dy * ca) / (r * e)
        d = u * u + v * v; dome = np.clip(1 - d, 0, 1) ** .55
        ins = dome > H; H = np.where(ins, dome, H); M = np.maximum(M, (d < 1) * 1.0); T = np.where(ins & (d < 1), rng.random(), T)
    return H, M, T

rows = np.arange(W)[:, None] * np.ones((1, W))
def band(a, b, soft, warp):
    r = rows + warp
    return np.clip((r - a) / soft + .5, 0, 1) * np.clip((b - r) / soft + .5, 0, 1)

# ---------- soil horizons (rows 0-256): boundaries wander along u, seamless in u ----------
wave = (pnoise(1, W, 1, 3, 3)[0] - .5) * 24 + (pnoise(1, W, 1, 17, 2)[0] - .5) * 5
wave2 = (pnoise(1, W, 1, 5, 3)[0] - .5) * 10
grain = pnoise(W, W, 32, 32, 3); crumbs = pnoise(W, W, 64, 64, 2); macro = pnoise(W, W, 4, 4, 4)
alb = np.zeros((W, W, 3)); hgt = np.zeros((W, W)); rough = np.full((W, W), .9)
C = lambda *v: np.array(v, float)
layers = [  # (top row, bottom row, dark sRGB, light sRGB, boundary warp, roughness)
    (-40, 16, C(38, 33, 20), C(62, 52, 30), wave * .4, .95),
    (16, 88, C(54, 37, 24), C(88, 62, 40), wave, .93),
    (88, 168, C(108, 78, 52), C(146, 110, 74), wave2 + wave * .3, .9),
    (168, 208, C(126, 113, 95), C(160, 146, 124), wave2 * .7, .82),
    (208, 262, C(78, 70, 60), C(112, 102, 88), wave2 * .5, .8),
]
wsum = np.zeros((W, W))
for a, b, dark, light, warp, rgh in layers:
    m = band(a, b, 6, warp[None, :])
    t = np.clip(.15 + .7 * grain + .3 * (crumbs - .5) + .25 * (macro - .5), 0, 1)[..., None]
    alb += m[..., None] * (dark * (1 - t) + light * t); rough += 0; wsum += m
    rough = np.where(m > .5, rgh, rough)
alb /= np.maximum(wsum, 1e-3)[..., None]
# clay laminations: thin pale/dark stripes that follow the wave
lam = np.sin((rows + wave2[None, :] * .7) * 1.9) * .5 + .5
clay = band(168, 208, 4, wave2[None, :] * .7)
alb *= (1 - clay * .12 * lam)[..., None]
# roots in the turf/loam: thin downward fibres
for _ in range(220):
    x = rng.random() * W; y = rng.uniform(-4, 30); L = rng.uniform(8, 70); th = rng.uniform(-.5, .5)
    for s in np.linspace(0, 1, int(L)):
        px = int(x + np.sin(th + s * 3) * 4 + s * L * np.sin(th) * .4) % W; py = int(y + s * L)
        if 0 <= py < 100: alb[py, px] *= .62; hgt[py, px] += .25
# loam crumbs and subsoil pebbles
cH, cM, cT = stones(W, W, 420, 1.2, 3.5, 10, 95, .5)
pH, pM, pT = stones(W, W, 110, 1.6, 5, 90, 170)
gH, gM, gT = stones(W, W, 520, 1.4, 7, 202, 262, .45)
for H, M, T, ca, cb in ((cH, cM, cT, C(44, 30, 19), C(76, 56, 38)), (pH, pM, pT, C(104, 96, 84), C(132, 122, 106)), (gH, gM, gT, C(84, 80, 74), C(134, 126, 114))):
    col = ca * (1 - T[..., None]) + cb * T[..., None]; col *= (.8 + .3 * H)[..., None]
    M = M * .82; alb = alb * (1 - M[..., None]) + col * M[..., None]
soil_h = .45 * grain + .2 * crumbs + .55 * cH * .6 + .7 * pH + .8 * gH
# ledge relief: harder horizons stand proud of the softer loam
soil_h += .35 * band(88, 168, 10, wave2[None, :]) + .55 * band(168, 208, 6, wave2[None, :] * .7) + .5 * band(208, 262, 6, wave2[None, :] * .5)
soil_h += hgt
rough = np.where(pM > .5, .72, rough); rough = np.where(gM > .5, .7, rough)

# ---------- bedrock (rows 256-512): periodic 512 x 256 block, jointed and bedded ----------
R = 256
rg = pnoise(R, W, 4, 8, 5); rf = pnoise(R, W, 32, 64, 3)
# Fractured, weathered rock: two domain-warped crack networks (fine + coarse) gated by noise so cracks fade in and
# out, plus faint wavy bedding. Everything periodic in both axes.
yy, xx = np.mgrid[0:R, 0:W]
def warp_take(a, wy, wx): return a[(yy + wy).astype(int) % R, (xx + wx).astype(int) % W]
wy = (pnoise(R, W, 2, 4, 3) - .5) * 60; wx = (pnoise(R, W, 2, 4, 3) - .5) * 90
# Warped periodic Voronoi: F2-F1 gives fracture lines between blocks; each block gets its own tint and tilt (facets).
pts = rng.random((46, 2)) * [R, W]; tint = rng.random(46); tilt = rng.normal(0, 1, (46, 2))
py, px = yy + wy * .35, xx + wx * .35
D = np.stack([np.hypot(((py - p[0]) + R / 2) % R - R / 2, (((px - p[1]) + W / 2) % W - W / 2) * .7) for p in pts])
order = np.argsort(D, axis=0); f1 = np.take_along_axis(D, order[:1], 0)[0]; f2 = np.take_along_axis(D, order[1:2], 0)[0]; cell = order[0]
fine = np.exp(-(np.abs(warp_take(pnoise(R, W, 6, 12, 3), wy * .5, wx * .5) - .5) / .01) ** 2) * np.clip((pnoise(R, W, 3, 6, 2) - .5) * 3, 0, 1)
crack = np.maximum(np.clip(1 - (f2 - f1) / 1.5, 0, 1) ** 2 * np.clip(.25 + (pnoise(R, W, 4, 8, 2) - .3) * 2.2, 0, 1), .45 * fine)
facet = (tilt[cell, 0] * (yy - pts[cell, 0]) / R + tilt[cell, 1] * (xx - pts[cell, 1]) / W) * .5 + (tint[cell] - .5) * .4
bed = np.sin((yy + wy * .6) / R * 2 * np.pi * 4) * .5 + .5
rock_t = np.clip(.2 + .55 * rg + .25 * (rf - .5) + .45 * (tint[cell] - .5), 0, 1)[..., None]
rock = C(90, 88, 84) * (1 - rock_t) + C(140, 135, 126) * rock_t; rock *= (.94 + .08 * bed)[..., None]
stain = np.clip((pnoise(R, W, 3, 6, 3) - .55) * 3, 0, 1)[..., None]
rock = rock * (1 - stain * .35) + C(150, 110, 70) * stain * .35  # iron staining
rock *= (1 - .55 * crack)[..., None]
rock_h = .35 * rg + .2 * rf - .6 * crack + .06 * bed + .5 * facet
alb[256:] = rock; soil_h[256:] = 0
rough[256:] = .66 + .2 * rf
# make the gravel->rock transition continuous (blend top of rock block under the gravel bed)
fade = np.clip((rows[:, :1].repeat(W, 1) - 240) / 22, 0, 1)[240:262]
alb[240:262] = alb[240:262] * (1 - fade[..., None]) + rock[(np.arange(240, 262) - 256) % R][..., ] * fade[..., None]

height = np.zeros((W, W))
sh = soil_h[:256]; height[:256] = (sh - sh.min()) / (np.ptp(sh) + 1e-6)
height[256:] = (rock_h - rock_h.min()) / (np.ptp(rock_h) + 1e-6)
cav = height - (np.roll(height, 2, 0) + np.roll(height, -2, 0) + np.roll(height, 2, 1) + np.roll(height, -2, 1)) / 4
alb *= (1 + 1.8 * np.clip(cav, -.1, .1))[..., None]
alb = np.clip(alb, 0, 255)

def normals(h, strength, wrap_rows):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5 * strength
    if wrap_rows: gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5 * strength
    else: hp = np.pad(h, ((1, 1), (0, 0)), mode='edge'); gy = (hp[2:] - hp[:-2]) * .5 * strength
    n = np.stack([-gx, gy, np.ones_like(gx)], -1); return n / np.linalg.norm(n, axis=-1, keepdims=True)
nrm = np.concatenate([normals(height[:256], 3.5, False), normals(height[256:], 7, True)])

OUT.mkdir(parents=True, exist_ok=True)
# RGB only (no alpha: browsers may premultiply). Roughness is derived per horizon in the shader.
Image.fromarray(alb.astype(np.uint8), "RGB").save(OUT / "terrain_strata_albedo.png", optimize=True)
packed = np.dstack([nrm[..., 0] * .5 + .5, nrm[..., 1] * .5 + .5, height])
Image.fromarray(np.clip(packed * 255 + .5, 0, 255).astype(np.uint8), "RGB").save(OUT / "terrain_strata_normal.png", optimize=True)
for n in ("terrain_strata_albedo.png", "terrain_strata_normal.png"):
    p = OUT / n; print(n, p.stat().st_size, hashlib.sha256(p.read_bytes()).hexdigest()[:16])
