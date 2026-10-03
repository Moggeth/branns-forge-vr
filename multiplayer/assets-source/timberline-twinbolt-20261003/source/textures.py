"""Deterministic, tileable procedural textures for Timberline.

Run with any Python that has numpy + Pillow (the Blender builder imports it
directly). Every texture tiles in both directions because all noise is built
from FFT-filtered random spectra and integer-frequency patterns.

Outputs (written to the given directory):
  tl_wood_basecolor.jpg   1024^2  warm hardwood, grain runs along U
  tl_wood_normal.jpg       512^2  grain relief (OpenGL / glTF +Y convention)
  tl_iron_basecolor.jpg    512^2  hammered dark forged iron
  tl_iron_normal.jpg       512^2  hammer dents
  tl_rope_basecolor.jpg    256^2  twisted hemp cord, twist runs along U
"""
import os
import sys

import numpy as np
from PIL import Image

SEED = 20261003


def spectral_noise(rng, h, w, beta, fx=1.0, fy=1.0):
    """Tileable noise with 1/f^beta falloff. fx/fy stretch the spectrum
    (fy > fx means features are elongated along x / U)."""
    ky = np.fft.fftfreq(h)[:, None] * h * fy
    kx = np.fft.fftfreq(w)[None, :] * w * fx
    k = np.sqrt(kx * kx + ky * ky)
    k[0, 0] = 1.0
    amp = 1.0 / np.power(k, beta)
    amp[0, 0] = 0.0
    phase = rng.uniform(0, 2 * np.pi, (h, w))
    spec = amp * np.exp(1j * phase)
    n = np.real(np.fft.ifft2(spec))
    n -= n.min()
    n /= max(n.max(), 1e-9)
    return n


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def to_srgb8(rgb):
    return np.clip(rgb * 255.0 + 0.5, 0, 255).astype(np.uint8)


def height_to_normal(hgt, strength):
    dx = (np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)) * 0.5
    dy = (np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)) * 0.5
    nx = -dx * strength
    ny = dy * strength  # image rows go down; glTF normal maps are +Y up (OpenGL)
    nz = np.ones_like(hgt)
    ln = np.sqrt(nx * nx + ny * ny + nz * nz)
    n = np.stack([nx / ln, ny / ln, nz / ln], axis=-1)
    return to_srgb8(n * 0.5 + 0.5)


def wood(rng, size=1024):
    h = w = size
    v = np.linspace(0, 1, h, endpoint=False)[:, None] * np.ones((1, w))
    # Warp: long, slow meanders along the grain, a few knots of distortion.
    warp = spectral_noise(rng, h, w, 1.9, fx=5.0, fy=1.0) - 0.5
    warp2 = spectral_noise(rng, h, w, 1.5, fx=9.0, fy=1.0) - 0.5
    # Two soft knots (positions wrap, so the texture still tiles).
    uu = np.linspace(0, 1, w, endpoint=False)[None, :] * np.ones((h, 1))
    knot = np.zeros((h, w))
    for (kx, ky, kr) in ((0.31, 0.27, 0.035), (0.78, 0.71, 0.028)):
        dx = (uu - kx + 0.5) % 1.0 - 0.5
        dy = (v - ky + 0.5) % 1.0 - 0.5
        knot += np.exp(-(dx * dx * 0.35 + dy * dy) / (kr * kr)) * np.sign(dy + 1e-6)
    rings = 30  # integer => tileable across V
    g = rings * v + 7.0 * warp + 2.2 * warp2 + 1.6 * knot
    f = g - np.floor(g)
    # Asymmetric early/late wood band: soft rise, sharp fall.
    band = smoothstep(0.0, 0.62, f) * (1.0 - smoothstep(0.74, 1.0, f))
    late = 1.0 - band
    streak = spectral_noise(rng, h, w, 0.9, fx=24.0, fy=1.0)  # fine fibres along U
    broad = spectral_noise(rng, h, w, 3.0)
    pores = spectral_noise(rng, h, w, 0.6, fx=8.0, fy=1.0)
    pores = smoothstep(0.80, 0.93, pores) * late
    light = np.array([0.66, 0.42, 0.26])
    dark = np.array([0.37, 0.205, 0.115])
    t = 0.22 + 0.42 * late + 0.45 * (streak - 0.5) + 0.30 * (broad - 0.5)
    t = np.clip(t, 0, 1)[..., None]
    col = light * (1 - t) + dark * t
    col *= (1.0 - 0.32 * pores)[..., None]
    col *= (0.94 + 0.12 * broad)[..., None]
    base = to_srgb8(col)
    hgt = 0.55 * band + 0.30 * streak - 0.6 * pores
    small = Image.fromarray((np.clip(hgt, 0, 1) * 65535).astype(np.uint16))
    hgt_s = np.asarray(small.resize((size // 2, size // 2), Image.BILINEAR), dtype=np.float64) / 65535.0
    normal = height_to_normal(hgt_s, 5.0)
    return base, normal


def iron(rng, size=512):
    h = w = size
    dents = spectral_noise(rng, h, w, 1.5)
    fine = spectral_noise(rng, h, w, 0.7)
    scale = spectral_noise(rng, h, w, 2.8)
    # Hammer facets: quantised low-frequency field gives soft planar dents.
    fac = spectral_noise(rng, h, w, 2.2)
    facq = np.floor(fac * 9.0) / 9.0
    base_c = np.array([0.33, 0.335, 0.36])
    warm = np.array([0.30, 0.22, 0.17])
    t = smoothstep(0.62, 0.9, scale)[..., None] * 0.35
    col = base_c * (1 - t) + warm * t
    col *= (0.70 + 0.55 * dents + 0.22 * (fine - 0.5) + 0.12 * facq)[..., None]
    base = to_srgb8(col)
    hgt = 0.6 * dents + 0.35 * facq + 0.08 * fine
    normal = height_to_normal(hgt, 7.0)
    return base, normal


def rope(rng, size=256):
    h = w = size
    u = np.linspace(0, 1, w, endpoint=False)[None, :] * np.ones((h, 1))
    v = np.linspace(0, 1, h, endpoint=False)[:, None] * np.ones((1, w))
    strands = 3
    twist = 6
    p = (u * twist + v * strands) % 1.0
    ridge = np.sin(p * np.pi) ** 0.6
    fib = spectral_noise(rng, h, w, 1.2, fx=1.0, fy=5.0)
    col = np.array([0.66, 0.53, 0.34])[None, None, :] * (0.45 + 0.6 * ridge[..., None])
    col *= (0.88 + 0.22 * fib)[..., None]
    return to_srgb8(col)


def build(out_dir):
    os.makedirs(out_dir, exist_ok=True)
    rng = np.random.default_rng(SEED)
    wb, wn = wood(rng)
    Image.fromarray(wb).save(os.path.join(out_dir, "tl_wood_basecolor.jpg"), quality=88, optimize=True)
    Image.fromarray(wn).save(os.path.join(out_dir, "tl_wood_normal.jpg"), quality=92, optimize=True)
    ib, inn = iron(rng)
    Image.fromarray(ib).save(os.path.join(out_dir, "tl_iron_basecolor.jpg"), quality=88, optimize=True)
    Image.fromarray(inn).save(os.path.join(out_dir, "tl_iron_normal.jpg"), quality=92, optimize=True)
    Image.fromarray(rope(rng)).save(os.path.join(out_dir, "tl_rope_basecolor.jpg"), quality=88, optimize=True)


if __name__ == "__main__":
    build(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), "textures"))
