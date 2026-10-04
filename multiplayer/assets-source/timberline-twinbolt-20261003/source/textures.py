"""Deterministic, tileable procedural textures for Timberline (second pass, 2026-10-04).

Run with any Python that has numpy + Pillow (the Blender builder imports it
directly). Every texture tiles in both directions because all noise is built
from FFT-filtered random spectra and integer-frequency patterns.

Each surface ships a base colour, a normal map (OpenGL / glTF +Y) and, where the
surface varies, an ORM map packed the glTF way (R occlusion, G roughness,
B metalness) so worn edges, rust and tarnish catch light differently:

  tl_wood_basecolor.jpg     1024^2  seasoned oak: fine straight grain, ray fleck, soot in the pores
  tl_wood_normal.jpg         512^2  grain, pores and shallow checks
  tl_wood_orm.jpg            256^2  waxed late wood is smoother than open early wood
  tl_iron_basecolor.jpg      512^2  blackened forged iron with rust bloom and bright scratches
  tl_iron_normal.jpg         512^2  hammer facets, pitting
  tl_iron_orm.jpg            256^2  rust is rough and dull; scratches are polished bare metal
  tl_brass_basecolor.jpg     256^2  turned brass, lathe rings, dark tarnish in patches
  tl_brass_normal.jpg        256^2  lathe rings and dents
  tl_brass_orm.jpg           256^2  tarnish dulls the shine
  tl_mithril_basecolor.jpg   256^2  pale blue-silver with brushed streaks
  tl_mithril_normal.jpg      256^2  brushing
  tl_rope_basecolor.jpg      512^2  three-strand hemp lay with loose fibres; twist runs along U
  tl_rope_normal.jpg         256^2  strand and fibre relief
"""
import os
import sys

import numpy as np
from PIL import Image

SEED = 20261004


def spectral_noise(rng, h, w, beta, fx=1.0, fy=1.0):
    """Tileable noise with 1/f^beta falloff. fx/fy stretch the spectrum
    (fx > fy elongates features along x / U)."""
    ky = np.fft.fftfreq(h)[:, None] * h * fy
    kx = np.fft.fftfreq(w)[None, :] * w * fx
    k = np.sqrt(kx * kx + ky * ky)
    k[0, 0] = 1.0
    amp = 1.0 / np.power(k, beta)
    amp[0, 0] = 0.0
    phase = rng.uniform(0, 2 * np.pi, (h, w))
    n = np.real(np.fft.ifft2(amp * np.exp(1j * phase)))
    n -= n.min()
    n /= max(n.max(), 1e-9)
    return n


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def to8(x):
    return np.clip(x * 255.0 + 0.5, 0, 255).astype(np.uint8)


def height_to_normal(hgt, strength):
    dx = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) * 0.5
    dy = (np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)) * 0.5
    nx, ny, nz = -dx * strength, dy * strength, np.ones_like(hgt)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    return to8(np.stack([nx / ln, ny / ln, nz / ln], axis=-1) * 0.5 + 0.5)


def resize(a, size):
    """Area-average a float field (or HxWx3) down to size^2, keeping it tileable."""
    h = a.shape[0]
    k = h // size
    if a.ndim == 2:
        return a.reshape(size, k, size, k).mean(axis=(1, 3))
    return a.reshape(size, k, size, k, a.shape[2]).mean(axis=(1, 3))


def orm(ao, rough, metal):
    return to8(np.stack([ao, rough, metal], axis=-1))


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


def grid(size):
    u = np.linspace(0, 1, size, endpoint=False)[None, :] * np.ones((size, 1))
    v = np.linspace(0, 1, size, endpoint=False)[:, None] * np.ones((1, size))
    return u, v


def wood(rng, size=1024):
    """Quarter-sawn seasoned oak. Grain runs along U, so long beams read as straight timber."""
    h = w = size
    u, v = grid(size)
    warp = spectral_noise(rng, h, w, 2.1, fx=6.0, fy=1.0) - 0.5      # long, slow meanders along the grain
    warp2 = spectral_noise(rng, h, w, 1.6, fx=12.0, fy=1.0) - 0.5
    knot = np.zeros((h, w))
    for (kx, ky, kr) in ((0.27, 0.31, 0.022), (0.71, 0.77, 0.018)):
        dx = (u - kx + 0.5) % 1.0 - 0.5
        dy = (v - ky + 0.5) % 1.0 - 0.5
        knot += np.exp(-(dx * dx * 0.12 + dy * dy) / (kr * kr)) * np.sign(dy + 1e-6)
    rings = 26
    g = rings * v + 9.0 * warp + 2.6 * warp2 + 0.9 * knot
    f = g - np.floor(g)
    late = smoothstep(0.55, 0.78, f) * (1.0 - smoothstep(0.9, 1.0, f))     # thin dark late-wood line
    fibre = spectral_noise(rng, h, w, 0.8, fx=40.0, fy=1.0)               # fine straight fibres
    broad = spectral_noise(rng, h, w, 2.6)
    tone = spectral_noise(rng, h, w, 1.8, fx=3.0, fy=1.0)                 # board-to-board colour drift
    pores = smoothstep(0.78, 0.92, spectral_noise(rng, h, w, 0.5, fx=10.0, fy=1.0)) * (1 - late)
    # Medullary ray fleck: short, pale lenses across the grain (characteristic of quartered oak).
    fl = spectral_noise(rng, h, w, 1.0, fx=1.0, fy=7.0)
    fleck = smoothstep(0.80, 0.90, fl) * smoothstep(0.35, 0.7, broad)
    # Shallow drying checks along the grain.
    checks = smoothstep(0.965, 0.995, spectral_noise(rng, h, w, 0.4, fx=60.0, fy=1.0))
    honey = np.array([0.47, 0.30, 0.17])
    umber = np.array([0.25, 0.145, 0.08])
    pale = np.array([0.58, 0.42, 0.27])
    t = np.clip(0.40 + 0.12 * late + 0.55 * (fibre - 0.5) + 0.45 * (broad - 0.5) + 0.35 * (tone - 0.5), 0, 1)
    col = mix(honey, umber, t)
    col = mix(col, pale, 0.3 * fleck)
    col *= (1.0 - 0.38 * pores - 0.55 * checks)[..., None]                 # soot and grime settle in the pores
    col *= (0.92 + 0.14 * tone)[..., None]
    base = to8(col)
    hgt = 0.45 * (1 - late) + 0.35 * fibre - 0.55 * pores - 0.9 * checks + 0.15 * fleck
    normal = height_to_normal(resize(hgt, size // 2), 4.0)
    rough = 0.70 - 0.16 * late - 0.08 * fleck + 0.12 * pores + 0.06 * (broad - 0.5)
    ao = 1.0 - 0.35 * pores - 0.5 * checks
    return base, normal, orm(resize(ao, 256), resize(rough, 256), np.zeros((256, 256)))


def iron(rng, size=512):
    """Blackened, hand-forged iron: hammer facets, pitting, a bloom of rust in the low spots, bright scratches."""
    h = w = size
    dents = spectral_noise(rng, h, w, 1.6)
    fine = spectral_noise(rng, h, w, 0.6)
    fac = spectral_noise(rng, h, w, 2.3)
    facq = np.floor(fac * 11.0) / 11.0                                      # soft planar hammer facets
    pits = smoothstep(0.82, 0.95, spectral_noise(rng, h, w, 0.3))
    rust_field = spectral_noise(rng, h, w, 2.0) * 0.7 + 0.3 * spectral_noise(rng, h, w, 0.9)
    rust = 0.7 * smoothstep(0.80, 0.95, rust_field + 0.2 * (1 - dents))     # a light bloom gathers in dents
    # Scratches: thin, long, mostly along U with a second set crossing at a slant.
    s1 = smoothstep(0.985, 0.998, spectral_noise(rng, h, w, 0.2, fx=50.0, fy=1.0))
    s2 = smoothstep(0.985, 0.998, np.roll(spectral_noise(rng, h, w, 0.2, fx=1.0, fy=50.0), 7, axis=1))
    scratch = np.clip(s1 + 0.7 * s2, 0, 1) * (1 - rust)
    black = np.array([0.27, 0.28, 0.30])     # sRGB: forged iron is dark, not black
    blue = np.array([0.34, 0.37, 0.42])
    rustc = np.array([0.38, 0.17, 0.07])
    bare = np.array([0.58, 0.59, 0.60])
    col = mix(black, blue, 0.5 * dents + 0.25 * facq)
    col *= (0.82 + 0.3 * fine)[..., None]
    col = mix(col, rustc * (0.7 + 0.5 * fine)[..., None], rust)
    col = mix(col, bare, scratch * 0.85)
    col *= (1 - 0.5 * pits)[..., None]
    base = to8(col)
    hgt = 0.6 * dents + 0.4 * facq + 0.06 * fine - 0.5 * pits + 0.25 * rust * fine - 0.2 * scratch
    normal = height_to_normal(hgt, 7.0)
    rough = 0.48 + 0.1 * (fine - 0.5) + 0.38 * rust - 0.25 * scratch + 0.1 * pits
    metal = 0.5 - 0.35 * rust + 0.4 * scratch                               # oxide-black scale reads part-dielectric
    ao = 1 - 0.45 * pits - 0.15 * (1 - dents)
    return base, normal, orm(resize(ao, 256), resize(rough, 256), resize(metal, 256))


def brass(rng, size=256):
    """Turned brass fittings: fine lathe rings, a few dents, dark tarnish in irregular patches."""
    h = w = size
    u, v = grid(size)
    lathe = 0.5 + 0.5 * np.sin(2 * np.pi * (64 * v + 0.6 * (spectral_noise(rng, h, w, 2.0) - 0.5)))
    tarnish = smoothstep(0.55, 0.78, spectral_noise(rng, h, w, 2.2))
    speck = smoothstep(0.86, 0.97, spectral_noise(rng, h, w, 0.5))
    dents = spectral_noise(rng, h, w, 2.4)
    gold = np.array([0.86, 0.62, 0.27])
    dark = np.array([0.36, 0.26, 0.12])
    verd = np.array([0.30, 0.38, 0.28])
    col = gold * (0.9 + 0.12 * lathe)[..., None]
    col = mix(col, dark, 0.75 * tarnish)
    col = mix(col, verd, 0.6 * speck * tarnish)
    base = to8(col)
    normal = height_to_normal(0.15 * lathe + 0.8 * dents, 3.0)
    rough = 0.36 + 0.08 * lathe + 0.3 * tarnish + 0.15 * speck
    return base, normal, orm(np.ones((h, w)) - 0.2 * speck, rough, np.ones((h, w)) - 0.35 * speck * tarnish)


def mithril(rng, size=256):
    """Pale, faintly blue silver with long brushed streaks along U."""
    h = w = size
    brush = spectral_noise(rng, h, w, 0.7, fx=30.0, fy=1.0)
    cloud = spectral_noise(rng, h, w, 2.4)
    col = np.array([0.80, 0.85, 0.93]) * (0.9 + 0.12 * brush + 0.06 * (cloud - 0.5))[..., None]
    return to8(col), height_to_normal(brush, 1.6)


def rope(rng, size=512):
    """Three-strand hemp with a visible lay, fibres along each strand and stray hairs."""
    h = w = size
    u, v = grid(size)
    strands, twist = 3, 6
    p = (u * twist + v * strands) % 1.0
    ridge = np.sin(p * np.pi) ** 0.55
    # Fibres follow the strand direction (diagonal), built by shearing a stretched noise field.
    fib = spectral_noise(rng, h, w, 0.9, fx=1.0, fy=14.0)
    shift = (np.arange(h) * twist * w // (strands * h)) % w
    fib = np.stack([np.roll(fib[i], int(shift[i])) for i in range(h)])
    hairs = smoothstep(0.93, 0.99, spectral_noise(rng, h, w, 0.3))
    dirt = spectral_noise(rng, h, w, 2.0)
    straw = np.array([0.70, 0.58, 0.38])
    brown = np.array([0.42, 0.31, 0.18])
    col = mix(brown, straw, 0.25 + 0.75 * ridge * (0.75 + 0.35 * fib))
    col *= (0.86 + 0.2 * dirt)[..., None]
    col = mix(col, np.array([0.82, 0.72, 0.52]), 0.5 * hairs)
    base = to8(col)
    normal = height_to_normal(resize(1.0 * ridge + 0.25 * fib + 0.2 * hairs, 256), 6.0)
    return base, normal


def build(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.startswith("tl_"):
            os.remove(os.path.join(out_dir, f))
    rng = np.random.default_rng(SEED)

    def save(name, arr, q=88):
        Image.fromarray(arr).save(os.path.join(out_dir, name), quality=q, optimize=True)

    wb, wn, wo = wood(rng)
    save("tl_wood_basecolor.jpg", wb)
    save("tl_wood_normal.jpg", wn, 92)
    save("tl_wood_orm.jpg", wo, 90)
    ib, inn, io = iron(rng)
    save("tl_iron_basecolor.jpg", ib)
    save("tl_iron_normal.jpg", inn, 92)
    save("tl_iron_orm.jpg", io, 90)
    bb, bn, bo = brass(rng)
    save("tl_brass_basecolor.jpg", bb)
    save("tl_brass_normal.jpg", bn, 92)
    save("tl_brass_orm.jpg", bo, 90)
    mb, mn = mithril(rng)
    save("tl_mithril_basecolor.jpg", mb)
    save("tl_mithril_normal.jpg", mn, 92)
    rb, rn = rope(rng)
    save("tl_rope_basecolor.jpg", rb)
    save("tl_rope_normal.jpg", rn, 92)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "textures"))
