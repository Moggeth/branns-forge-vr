"""Tileable procedural texture sets for the skeleton warband (numpy only, deterministic).

Every map wraps on both axes so the builder can box-project UVs in metres and let the GPU repeat them.
Returns float32 arrays in [0, 1], shape (N, N, 3), sRGB for albedo, linear for normal / ORM.
"""
import numpy as np


def _grid(n, cells, rng):
    return rng.random((cells, cells)).astype(np.float32)


def value_noise(n, cells, seed):
    """Smooth, tileable value noise: a random lattice with wrap, cubic-interpolated to n x n."""
    rng = np.random.default_rng(seed)
    g = _grid(n, cells, rng)
    x = np.arange(n, dtype=np.float32) * cells / n
    i0 = np.floor(x).astype(int) % cells
    i1 = (i0 + 1) % cells
    f = x - np.floor(x)
    f = f * f * (3 - 2 * f)
    rows = g[i0][:, None, :] * (1 - f)[:, None, None] + g[i1][:, None, :] * f[:, None, None]  # (n,1,cells)
    rows = rows[:, 0, :]
    out = rows[:, i0] * (1 - f)[None, :] + rows[:, i1] * f[None, :]
    return out


def fbm(n, base, octaves, seed, gain=0.5):
    total, amp, norm = np.zeros((n, n), np.float32), 1.0, 0.0
    for o in range(octaves):
        total += value_noise(n, base * 2 ** o, seed + o * 101) * amp
        norm += amp
        amp *= gain
    return total / norm


def stretched(n, cu, cv, seed):
    """Anisotropic noise: cu cells across, cv along (fibres / grain)."""
    a = value_noise(n, cu, seed)
    b = value_noise(n, cv, seed + 7)
    # Sample a with v compressed: repeat rows to stretch along v.
    rng = np.random.default_rng(seed + 3)
    lat = rng.random((cv, cu)).astype(np.float32)
    y = np.arange(n, dtype=np.float32) * cv / n
    x = np.arange(n, dtype=np.float32) * cu / n
    y0 = np.floor(y).astype(int) % cv; y1 = (y0 + 1) % cv; fy = y - np.floor(y); fy = fy * fy * (3 - 2 * fy)
    x0 = np.floor(x).astype(int) % cu; x1 = (x0 + 1) % cu; fx = x - np.floor(x); fx = fx * fx * (3 - 2 * fx)
    r = lat[y0] * (1 - fy)[:, None] + lat[y1] * fy[:, None]
    out = r[:, x0] * (1 - fx)[None, :] + r[:, x1] * fx[None, :]
    return out * 0.8 + b * 0.2


def normal_from_height(h, strength):
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    nz = np.ones_like(h)
    l = np.sqrt(dx * dx + dy * dy + nz * nz)
    # OpenGL / glTF convention: +Y up in texture space (row 0 is the top of the image in Blender pixels).
    return np.stack([(-dx / l) * 0.5 + 0.5, (dy / l) * 0.5 + 0.5, (nz / l) * 0.5 + 0.5], -1)


def mix(a, b, t):
    t = t[..., None] if np.ndim(t) == 2 else t
    return a * (1 - t) + b * t


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def bone(n=512):
    low = fbm(n, 3, 3, 11)
    mid = fbm(n, 12, 3, 23)
    fib = stretched(n, 48, 6, 31)
    pores = value_noise(n, 140, 41)
    pits = smooth(0.78, 0.92, pores)
    ivory = np.array([0.93, 0.88, 0.76], np.float32)
    aged = np.array([0.80, 0.71, 0.52], np.float32)
    grime = np.array([0.52, 0.44, 0.33], np.float32)
    c = mix(np.broadcast_to(ivory, (n, n, 3)), np.broadcast_to(aged, (n, n, 3)), smooth(0.35, 0.75, low) * 0.45)  # even ivory: box-UV seams stay invisible on the round skull
    c = mix(c, np.broadcast_to(grime, (n, n, 3)), smooth(0.62, 0.9, mid) * 0.35)
    c = c * (0.94 + 0.08 * fib[..., None])
    c = c * (1 - 0.14 * pits[..., None])  # cartoon bone: smooth ivory, only faint pores
    h = low * 0.6 + fib * 0.35 - pits * 0.35 + mid * 0.3
    return np.clip(c, 0, 1), normal_from_height(h, 3.5)


def wood(n=512):
    warp = fbm(n, 4, 3, 51)
    v = np.linspace(0, 1, n, endpoint=False, dtype=np.float32)[None, :].repeat(n, 0)  # u across
    grain = np.sin((v * 7 + warp * 0.6) * np.pi * 2 * 3)
    fine = stretched(n, 96, 4, 61)
    planks = (np.floor(v * 4) % 4)
    tone = 0.85 + 0.12 * np.sin(planks * 2.3)
    edge = np.minimum((v * 4) % 1, 1 - (v * 4) % 1)
    seam = 1 - 0.75 * (1 - smooth(0.0, 0.014, edge))
    base = np.array([0.86, 0.78, 0.66], np.float32)
    dark = np.array([0.62, 0.5, 0.38], np.float32)
    weather = np.array([0.82, 0.8, 0.74], np.float32)
    c = mix(np.broadcast_to(base, (n, n, 3)), np.broadcast_to(dark, (n, n, 3)), smooth(-0.4, 1.0, grain) * 0.35 + fine * 0.25)
    c = mix(c, np.broadcast_to(weather, (n, n, 3)), smooth(0.55, 0.85, fbm(n, 6, 3, 71)) * 0.4)
    c = c * tone[..., None] * seam[..., None]
    h = grain * 0.12 + fine * 0.6 + (seam - 1) * 1.5
    return np.clip(c, 0, 1), normal_from_height(h, 4.0)


def iron(n=256):
    low = fbm(n, 4, 4, 81)
    dents = fbm(n, 10, 2, 91)
    speck = value_noise(n, 90, 97)
    rust_mask = smooth(0.52, 0.7, low * 0.8 + speck * 0.25)
    metal = np.array([0.42, 0.42, 0.44], np.float32)
    rust = np.array([0.45, 0.22, 0.10], np.float32)
    c = mix(np.broadcast_to(metal, (n, n, 3)) * (0.8 + 0.3 * dents[..., None]), np.broadcast_to(rust, (n, n, 3)) * (0.8 + 0.4 * speck[..., None]), rust_mask)
    rough = 0.42 + 0.48 * rust_mask + 0.08 * speck
    metalness = 0.9 * (1 - rust_mask)
    orm = np.stack([np.ones_like(rough), rough, metalness], -1)
    h = dents * 0.7 + rust_mask * 0.5 + speck * rust_mask * 0.4
    return np.clip(c, 0, 1), normal_from_height(h, 4.0), np.clip(orm, 0, 1)


def fabric(n=512):
    """Neutral (near white) woven fibre: tinted by vertex colour (moss, leather, petals) or material colour (cloth)."""
    u = np.linspace(0, 1, n, endpoint=False, dtype=np.float32)
    U, V = np.meshgrid(u, u)
    weave = np.sin(U * np.pi * 2 * 64) * np.sin(V * np.pi * 2 * 64)
    fuzz = fbm(n, 24, 3, 111)
    blot = fbm(n, 4, 3, 121)
    c = 0.78 + 0.1 * weave[..., None] * 0.5 + 0.18 * (fuzz[..., None] - 0.5) - 0.18 * smooth(0.55, 0.85, blot)[..., None]
    c = np.broadcast_to(c, (n, n, 3)).copy()
    h = weave * 0.35 + fuzz * 0.9
    return np.clip(c, 0, 1), normal_from_height(h, 3.0)


def glow(n=64):
    """Radial falloff for the eye lights (emissive)."""
    u = np.linspace(-1, 1, n, dtype=np.float32)
    U, V = np.meshgrid(u, u)
    r = np.sqrt(U * U + V * V)
    g = np.clip(1 - r, 0, 1) ** 1.5
    return np.stack([g, g, g], -1)
