"""Stonewhisper pick surface textures (2026-10-04). Deterministic, tileable, numpy + Pillow only.

python paint_textures.py <outDir>
Writes JPEG colour/normal maps. Palettes follow the shipped 2026-10-03 textures (blued star-steel,
warm ash, oxblood leather) so the pick keeps its identity; only detail and resolution change.
UV conventions (set by build-pick.mjs): steel u = metres along the arm, v = around the section;
wood x = around the shaft, y = along it; leather x = along the wrap strip, y = across one strip;
brass x/y = across/along each piece.
"""
import sys, os
import numpy as np
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else 'textures'
os.makedirs(OUT, exist_ok=True)

def rng(seed): return np.random.default_rng(seed)

def fnoise(n, sx, sy, seed):
    """Periodic gaussian-filtered noise, feature size ~sx by sy pixels, normalised to [-1, 1]."""
    w = rng(seed).standard_normal((n, n))
    fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.fftfreq(n)[None, :]
    k = np.exp(-((fx * sx) ** 2 + (fy * sy) ** 2) * 2 * np.pi ** 2 / 4)
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * k))
    out -= out.mean(); out /= (np.abs(out).max() + 1e-9)
    return out

def fbm(n, base, seed, octaves=4, aniso=(1, 1)):
    acc = np.zeros((n, n)); amp = 1; tot = 0
    for o in range(octaves):
        s = base / (2 ** o)
        acc += amp * fnoise(n, max(s * aniso[0], .6), max(s * aniso[1], .6), seed + o * 17); tot += amp; amp *= .5
    return acc / tot

def dots(n, count, radius, seed, soft=True):
    """Periodic soft discs (dimples/pebbles/speckles). Returns [0,1] field."""
    r = rng(seed); f = np.zeros((n, n))
    yy, xx = np.mgrid[0:n, 0:n]
    R = int(np.ceil(radius * 2.5))
    for _ in range(count):
        cx, cy = r.uniform(0, n, 2); rad = radius * r.uniform(.6, 1.4)
        x0, y0 = int(cx) - R, int(cy) - R
        ys = (np.arange(y0, y0 + 2 * R + 1) % n); xs = (np.arange(x0, x0 + 2 * R + 1) % n)
        dy = (np.arange(y0, y0 + 2 * R + 1) - cy)[:, None]; dx = (np.arange(x0, x0 + 2 * R + 1) - cx)[None, :]
        d = np.sqrt(dx * dx + dy * dy) / rad
        v = np.clip(1 - d * d, 0, 1) ** (1.5 if soft else .5)
        f[np.ix_(ys, xs)] = np.maximum(f[np.ix_(ys, xs)], v)
    return f

def normal_map(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * .5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * .5 * strength
    n = np.dstack([-dx, dy, np.ones_like(h)])  # +Y up (glTF): image rows grow downward
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * .5 + .5

def save(name, arr, q=90):
    img = Image.fromarray(np.clip(arr * 255 + .5, 0, 255).astype(np.uint8), 'RGB')
    img.save(os.path.join(OUT, name), quality=q, subsampling=0 if 'normal' in name else 2, optimize=True)

def srgb(c): return np.array(c, dtype=float) / 255

def mix(a, b, t): return a * (1 - t[..., None]) + b * t[..., None]

# ---------------------------------------------------------------- blued star-steel (head, socket, langets)
N = 1024
brushed = fbm(N, 18, 11, 4, aniso=(9, .35))           # long streaks along u (metres along the arm)
mottle = fbm(N, 140, 21, 3)                            # heat-bluing clouds
warp = fbm(N, 90, 31, 3)
yy, xx = np.mgrid[0:N, 0:N] / N
wave = np.sin((yy * 6 + warp * .55 + xx * .5) * 2 * np.pi * 3)  # faint pattern-weld ripple, periodic
damascus = np.clip(wave, -1, 1) * .5 + .5
spark = dots(N, 260, 1.3, 41, soft=False)
glint = dots(N, 260, 3.2, 41)
base = srgb((66, 79, 112)); deep = srgb((40, 50, 82)); temper = srgb((92, 86, 128)); star = srgb((215, 228, 255))
steel = mix(base[None, None, :].repeat(N, 0).repeat(N, 1), deep, np.clip(.5 - mottle * .6, 0, 1) * .55)
steel = mix(steel, temper, np.clip(mottle - .35, 0, 1) * .7)
steel *= (1 + brushed[..., None] * .07 + (damascus[..., None] - .5) * .08)
steel = mix(steel, star, np.clip(spark * .9 + glint * .18, 0, 1))
save('steel_color.jpg', steel)
h = brushed * .35 + fbm(N, 3, 51, 2, aniso=(6, .5)) * .25 - dots(N, 700, 4, 61) * .22 - spark * .4 + damascus * .15
save('steel_normal.jpg', normal_map(h, 1.8))

# ---------------------------------------------------------------- ash haft (x around, y along)
grainWarp = fbm(N, 120, 71, 3, aniso=(1, 6)) * .07 + fbm(N, 30, 73, 2, aniso=(1, 8)) * .012
rings = (np.sin((xx * 31 + grainWarp * 3.4 + fbm(N, 400, 77, 2) * .9) * 2 * np.pi) * .6 + np.sin((xx * 67 + grainWarp * 5) * 2 * np.pi) * .4) * .5 + .5
late = np.clip((rings - .74) / .26, 0, 1) ** 2.4 * (.55 + .45 * (fbm(N, 80, 79, 2, aniso=(1, 4)) * .5 + .5))       # dark latewood bands
pores = np.clip(fbm(N, 2, 81, 2, aniso=(1, 22)) * 1.8 - .7, 0, 1)
rays = np.clip(fbm(N, 6, 85, 1, aniso=(2.5, .5)) * 2 - 1.2, 0, 1)
light = srgb((112, 70, 36)); mid = srgb((80, 47, 22)); dark = srgb((48, 27, 12))
wood = mix(mix(light[None, None, :].repeat(N, 0).repeat(N, 1), mid, rings * .4 + fbm(N, 60, 75, 2, aniso=(1, 5)) * .2), dark, late * .65)
wood = mix(wood, dark, pores * .4)
wood *= (1 + fbm(N, 200, 87, 2)[..., None] * .08 + rays[..., None] * .06)
save('wood_color.jpg', wood)
save('wood_normal.jpg', normal_map(-late * .25 - pores * .7 + rays * .15 + fbm(N, 1.5, 89, 1, aniso=(1, 10)) * .25, 1.4))

# ---------------------------------------------------------------- oxblood leather wrap strip (x along, y across one strip)
M = 512
lyy, lxx = np.mgrid[0:M, 0:M] / M
pebble = dots(M, 5200, 3.2, 91) - .5 * fbm(M, 2, 93, 1)
edge = np.clip(np.minimum(lyy, 1 - lyy) / .14, 0, 1)                 # burnished rolled edges
crease = fbm(M, 40, 95, 2, aniso=(4, .6))
# Slanted saddle stitches: rounded dashes along the strip centre.
sx = np.mod(lxx * 20 + (lyy - .5) * 2.2, 1) - .5; sy = (lyy - .5) / .03
stitchShape = np.clip(1 - (sx / .28) ** 2 - sy ** 2, 0, 1)
stitch = stitchShape > .05; stitchRow = np.abs(lyy - .5) < .045
oxblood = srgb((74, 31, 20)); burnish = srgb((38, 15, 10)); thread = srgb((176, 150, 104))
leather = mix(burnish[None, None, :].repeat(M, 0).repeat(M, 1), oxblood, edge ** .7)
leather *= (1 + pebble[..., None] * .07 + crease[..., None] * .07)
leather = mix(leather, thread, np.clip(stitchShape * 2.2, 0, 1) * (.75 + .25 * stitchShape))
save('leather_color.jpg', leather)
lh = pebble * .45 + (edge ** .5) * 1.6 + crease * .25 + stitchShape * 1.2 - stitchRow * .35
save('leather_normal.jpg', normal_map(lh, 2.4))

# ---------------------------------------------------------------- brass (multiplies the Brass_Trim factor)
hammer = dots(M, 900, 7, 101)
scratch = fbm(M, 1.2, 103, 2, aniso=(18, .4))
patina = np.clip(fbm(M, 30, 105, 3) * 1.6 - .55, 0, 1)
brass = np.ones((M, M, 3)) * .97
brass *= (1 - patina[..., None] * np.array([.16, .2, .26]) * .8) * (1 + scratch[..., None] * .05)
save('brass_color.jpg', np.clip(brass, 0, 1))
save('brass_normal.jpg', normal_map(-hammer * .9 + scratch * .3, 2.0))
print('painted', sorted(os.listdir(OUT)))
