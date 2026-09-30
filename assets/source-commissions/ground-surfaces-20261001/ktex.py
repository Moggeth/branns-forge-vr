"""Deterministic NumPy texture toolkit: seamless ground tiles + shared prop atlas cells.
All fields are periodic (FFT synthesis / wrapped Worley) so tiles repeat with no seam.
Normal maps are OpenGL +Y (green up). ORM = R AO, G roughness, B metallic (0)."""
import numpy as np
from PIL import Image

f32 = np.float32


def sstep(a, b, x):
    t = np.clip((x - a) / (b - a + 1e-9), 0, 1)
    return t * t * (3 - 2 * t)


def paint(t, stops):
    ps = [p for p, _ in stops]
    return np.stack([np.interp(t, ps, [c[k] for _, c in stops]) for k in range(3)], -1).astype(f32)


def mix(a, b, t):
    return a + (b - a) * t[..., None]


def fbm(rng, n, beta=2.0, lo=1.0, hi=None, aniso=(1.0, 1.0)):
    """Periodic spectral noise, normalised to ~[0,1]."""
    fy = np.fft.fftfreq(n)[:, None] * n
    fx = np.fft.rfftfreq(n)[None, :] * n
    f = np.sqrt((fx / aniso[0]) ** 2 + (fy / aniso[1]) ** 2)
    hi = hi or n / 2
    amp = np.where((f >= lo) & (f <= hi), np.maximum(f, 1e-3) ** (-beta / 2), 0)
    x = np.fft.irfft2(np.fft.rfft2(rng.standard_normal((n, n))) * amp, s=(n, n))
    p1, p99 = np.percentile(x, (1, 99))
    return np.clip((x - p1) / (p99 - p1 + 1e-12), 0, 1).astype(f32)


def blur(x, s):
    n = x.shape[0]
    fy = np.fft.fftfreq(n)[:, None]
    fx = np.fft.rfftfreq(n)[None, :]
    return np.fft.irfft2(np.fft.rfft2(x) * np.exp(-2 * (np.pi * s) ** 2 * (fx ** 2 + fy ** 2)), s=x.shape).astype(f32)


def worley(rng, n, g, jit=0.85):
    """Periodic jittered-grid Worley: returns (F1, F2, cell id in [0,1)) distances in pixels."""
    pts = []
    for i in range(g):
        for j in range(g):
            pts.append(((i + 0.5 + (rng.random() - 0.5) * jit) * n / g, (j + 0.5 + (rng.random() - 0.5) * jit) * n / g))
    y, x = np.mgrid[0:n, 0:n].astype(f32)
    d1 = np.full((n, n), 1e9, f32)
    d2 = np.full((n, n), 1e9, f32)
    idc = np.zeros((n, n), f32)
    ids = rng.random(len(pts)).astype(f32)
    for k, (px, py) in enumerate(pts):
        dx = np.abs(x - py)
        dx = np.minimum(dx, n - dx)
        dy = np.abs(y - px)
        dy = np.minimum(dy, n - dy)
        d = dx * dx + dy * dy
        closer = d < d1
        d2 = np.where(closer, d1, np.minimum(d2, d))
        idc = np.where(closer, ids[k], idc)
        d1 = np.where(closer, d, d1)
    return np.sqrt(d1), np.sqrt(d2), idc


def normal_map(h, bump):
    n = h.shape[0]
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * n * bump
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * n * bump
    v = np.stack([-dx, dy, np.ones_like(h)], -1)  # OpenGL +Y: green = up the image
    v /= np.linalg.norm(v, axis=-1, keepdims=True)
    return (v * 0.5 + 0.5).astype(f32)


def cavity_ao(h, s1=5, k=2.6, strength=0.65):
    cav = np.clip((blur(h, s1) - h) * k, 0, 1)
    return np.clip(1 - strength * cav, 0, 1)


def to_u8(a):
    return (np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8)


def save_set(prefix, alb, h, rough, bump, ao_s=0.65, ao_extra=None, size=None):
    ao = cavity_ao(h, strength=ao_s)
    if ao_extra is not None:
        ao = ao * ao_extra
    orm = np.stack([ao, np.clip(rough, 0.04, 1), np.zeros_like(h)], -1)
    nm = normal_map(h, bump)
    out = {}
    for suf, arr in (("albedo", alb), ("normal", nm), ("orm", orm)):
        im = Image.fromarray(to_u8(arr))
        if size and size != im.size[0]:
            im = im.resize((size, size), Image.LANCZOS)
        out[suf] = im
    return out


# ------------------------------------------------------------------ tile families
def t_meadow(rng, n):
    big = fbm(rng, n, 2.8, 1, 8)
    mid = fbm(rng, n, 2.0, 4, 50)
    fine = fbm(rng, n, 1.1, 40, None)
    s1 = fbm(rng, n, 0.8, 40, n // 2, aniso=(1, 6))
    s2 = fbm(rng, n, 0.8, 40, n // 2, aniso=(6, 1))
    s3 = fbm(rng, n, 0.8, 40, n // 2, aniso=(4, 4)) * 0 + fbm(rng, n, 0.8, 40, n // 2, aniso=(1, 3))
    s4 = fbm(rng, n, 0.8, 40, n // 2, aniso=(3, 1))
    strokes = (s1 + s2 + s3 + s4) / 4 - 0.5
    h = np.clip(0.35 * mid + 0.2 * fine + 1.6 * strokes + 0.3, 0, 1)
    tone = 0.55 * mid + 0.45 * big
    alb = paint(tone, [(0, (0.15, 0.29, 0.07)), (0.5, (0.27, 0.43, 0.12)), (1, (0.44, 0.54, 0.17))])
    alb = alb * (1 + 0.85 * strokes[..., None])
    dry = sstep(0.70, 0.90, big) * (0.45 + 0.9 * (s1 - 0.4).clip(0))
    alb = mix(alb, np.array([0.63, 0.55, 0.27], f32) * (0.85 + 0.3 * fine[..., None]), np.clip(dry, 0, 0.6))
    soil = sstep(0.32, 0.10, mid) * sstep(0.5, 0.25, h)
    alb = mix(alb, np.array([0.22, 0.155, 0.085], f32), soil * 0.85)
    rough = 0.84 + 0.10 * fine - 0.06 * dry - 0.12 * soil * 0
    return alb, h, rough, 0.020, 0.7


def draw_leaves(rng, n, count, lenr, pal, alb, h, rough, layer0=0.35, layer1=0.9, damp=0.85):
    for i in range(count):
        cy, cx = rng.random(2) * n
        ang = rng.random() * 2 * np.pi
        L = rng.uniform(*lenr)
        W = L * rng.uniform(0.38, 0.52)
        R = int(L * 0.62) + 3
        ys = np.arange(-R, R + 1)
        yy, xx = np.meshgrid(ys, ys, indexing="ij")
        c, s = np.cos(ang), np.sin(ang)
        u = (xx * c + yy * s) / (L / 2)
        v = (-xx * s + yy * c) / (W / 2)
        # gently bent midrib to avoid rigid ellipses
        v = v - 0.18 * (u ** 2 - 0.3) * (1 if i % 2 else -1)
        w = np.clip(1 - np.abs(u) ** 1.9, 0, 1) ** 0.65
        dist = (w - np.abs(v)) * (W / 2)
        a = np.clip(dist / 1.6, 0, 1) * (np.abs(u) < 1)
        if a.max() <= 0:
            continue
        iy = (int(cy) + ys) % n
        ix = (int(cx) + ys) % n
        sl = np.ix_(iy, ix)
        base = np.array(pal[rng.integers(len(pal))], f32) * rng.uniform(0.8, 1.15)
        rib = 1 - sstep(0, 0.07, np.abs(v))
        sec = np.clip(1 - np.abs(((np.abs(u) * 5.5 - np.abs(v) * 2.0) % 1) - 0.5) * 2 * 6, 0, 1) * (1 - np.abs(v) ** 2) * (np.abs(u) < 0.9)
        vein = np.maximum(rib, 0.5 * sec)
        col = base * (1 - 0.30 * np.abs(v)[..., None] ** 2) * (1 - 0.18 * vein[..., None]) + 0.05 * rib[..., None]
        col = col * damp
        layer = layer0 + (layer1 - layer0) * i / count
        hl = layer + 0.05 * (np.abs(v) ** 2) - 0.03 * vein
        aa = a[..., None]
        alb[sl] = alb[sl] * (1 - aa) + col * aa
        h[sl] = h[sl] * (1 - a) + hl * a
        rough[sl] = rough[sl] * (1 - a) + (0.72 - 0.1 * vein) * a


def t_loam(rng, n):
    big = fbm(rng, n, 2.6, 1, 8)
    mid = fbm(rng, n, 2.0, 5, 60)
    fine = fbm(rng, n, 1.2, 40, None)
    crumbs = fbm(rng, n, 1.5, 25, 180)
    h = 0.3 * mid + 0.3 * crumbs + 0.12 * fine
    alb = paint(0.6 * mid + 0.4 * big, [(0, (0.09, 0.062, 0.04)), (0.55, (0.20, 0.135, 0.08)), (1, (0.31, 0.21, 0.12))])
    alb = alb * (0.86 + 0.28 * crumbs[..., None])
    rough = 0.78 + 0.16 * fine - 0.14 * sstep(0.5, 0.25, mid)
    # small stones + twigs-ish bits via worley bumps
    d1, _, ids = worley(rng, n, 9, 1.0)
    pebble = (ids > 0.72) * sstep(14, 4, d1)
    h = h + 0.25 * pebble
    alb = mix(alb, np.array([0.35, 0.32, 0.29], f32), pebble * 0.65)
    pal = [(0.50, 0.28, 0.08), (0.62, 0.36, 0.10), (0.38, 0.30, 0.10), (0.30, 0.21, 0.08), (0.53, 0.42, 0.14), (0.32, 0.36, 0.11), (0.42, 0.20, 0.07)]
    draw_leaves(rng, n, 150, (70, 135), pal, alb, h, rough)
    # damp organic film + moss flecks in hollows
    moss = sstep(0.58, 0.8, big) * sstep(0.6, 0.3, h)
    alb = mix(alb, np.array([0.17, 0.27, 0.07], f32), moss * 0.5)
    return alb, np.clip(h, 0, 1), rough, 0.032, 0.8


def t_stone(rng, n):
    d1, d2, ids = worley(rng, n, 5, 0.75)
    edge = d2 - d1
    wear = fbm(rng, n, 2.6, 1, 14)
    grain = fbm(rng, n, 1.3, 30, None)
    tex = fbm(rng, n, 2.0, 6, 80)
    bevel = sstep(0, 46, edge + 6 * (wear - 0.5))
    inner = sstep(0, 10, edge)
    h = 0.1 + 0.62 * bevel * (0.85 + 0.15 * ids) + 0.14 * wear * inner + 0.05 * grain + 0.08 * tex * inner
    # hairline cracks (second Worley net) and chisel scratches
    e1, e2, _ = worley(rng, n, 11, 1.0)
    crack = (1 - sstep(0.4, 2.4, e2 - e1)) * sstep(0.55, 0.75, fbm(rng, n, 2.5, 1, 10))
    h = h - 0.16 * crack * inner
    stone_tone = 0.5 * tex + 0.3 * wear + 0.2 * ids
    base = paint(stone_tone, [(0, (0.33, 0.315, 0.29)), (0.5, (0.47, 0.44, 0.40)), (1, (0.62, 0.58, 0.52))])
    tint = (ids - 0.5)[..., None] * np.array([0.05, 0.015, -0.04], f32)
    alb = (base + tint) * (0.92 + 0.16 * grain[..., None])
    alb = mix(alb, np.array([0.11, 0.115, 0.095], f32), (1 - inner) * 0.92)
    alb = mix(alb, np.array([0.19, 0.27, 0.10], f32), (1 - sstep(0, 22, edge)) * sstep(0.45, 0.7, wear) * 0.55)
    alb = alb * (1 - 0.35 * crack[..., None])
    # faint arcane inlay veins (teal) on a subset of slabs
    vn = np.abs(fbm(rng, n, 2.2, 3, 30) - 0.5)
    rune = (1 - sstep(0.004, 0.017, vn)) * sstep(0.5, 0.7, fbm(rng, n, 2.5, 1, 6)) * inner * sstep(2, 22, edge)
    alb = mix(alb, np.array([0.20, 0.62, 0.62], f32), rune * 0.30)
    h = h - 0.05 * rune
    rough = 0.80 - 0.22 * sstep(0.35, 0.8, wear) * bevel + 0.10 * grain - 0.1 * rune
    return alb, np.clip(h, 0, 1), rough, 0.034, 0.75


def t_sand(rng, n):
    y, x = np.mgrid[0:n, 0:n].astype(f32) / n
    warp = fbm(rng, n, 2.6, 1, 8)
    warp2 = fbm(rng, n, 2.0, 2, 30)
    ph = 2 * np.pi * (6 * x + 2 * y + 1.6 * (warp - 0.5) + 0.35 * (warp2 - 0.5))
    rip = 0.5 + 0.5 * np.sin(ph)
    rip = rip ** 1.6
    ph2 = 2 * np.pi * (17 * x - 5 * y + 3.5 * (warp2 - 0.5))
    rip2 = 0.5 + 0.5 * np.sin(ph2)
    grain = fbm(rng, n, 0.9, 60, None)
    mid = fbm(rng, n, 2.0, 3, 40)
    h = 0.55 * rip + 0.12 * rip2 + 0.10 * grain + 0.14 * mid
    tone = 0.6 * mid + 0.4 * rip
    alb = paint(tone, [(0, (0.66, 0.52, 0.33)), (0.5, (0.75, 0.61, 0.39)), (1, (0.83, 0.70, 0.47))])
    alb = alb * (0.90 + 0.22 * rip[..., None]) * (0.95 + 0.08 * grain[..., None])
    d1, _, ids = worley(rng, n, 8, 1.0)
    peb = (ids > 0.8) * sstep(9, 3, d1)
    h = h + 0.22 * peb
    alb = mix(alb, np.array([0.42, 0.36, 0.30], f32), peb * 0.7)
    rough = 0.90 + 0.06 * grain - 0.12 * peb
    return alb, np.clip(h, 0, 1), rough, 0.014, 0.4


def t_snow(rng, n):
    drift = fbm(rng, n, 3.3, 1, 6)
    mid = fbm(rng, n, 2.3, 4, 40)
    fine = fbm(rng, n, 1.0, 60, None)
    y, x = np.mgrid[0:n, 0:n].astype(f32) / n
    wind = 0.5 + 0.5 * np.sin(2 * np.pi * (9 * x + 3 * y + 2.5 * (drift - 0.5)))
    h = 0.62 * drift + 0.16 * mid + 0.10 * wind * sstep(0.3, 0.7, mid) + 0.05 * fine
    tone = 0.55 * drift + 0.45 * mid
    alb = paint(tone, [(0, (0.66, 0.75, 0.88)), (0.4, (0.84, 0.90, 0.96)), (1, (0.95, 0.965, 0.98))])
    alb = alb * (0.97 + 0.05 * fine[..., None])
    sparkle = sstep(0.93, 0.985, fbm(rng, n, 0.3, 90, None))
    rough = 0.68 - 0.10 * mid + 0.06 * fine - 0.36 * sparkle
    return alb, np.clip(h, 0, 1), rough, 0.028, 0.55


def t_ash(rng, n):
    d1, d2, ids = worley(rng, n, 7, 0.9)
    edge = d2 - d1
    big = fbm(rng, n, 2.4, 1, 10)
    mid = fbm(rng, n, 2.0, 5, 60)
    fine = fbm(rng, n, 1.1, 40, None)
    plate = sstep(0, 22, edge)
    crack = 1 - sstep(0, 8.0, edge)
    h = 0.15 + 0.5 * plate * (0.8 + 0.2 * ids) + 0.2 * mid + 0.06 * fine - 0.25 * crack
    alb = paint(0.5 * mid + 0.5 * big, [(0, (0.055, 0.052, 0.05)), (0.5, (0.135, 0.13, 0.125)), (1, (0.27, 0.26, 0.25))])
    powder = sstep(0.55, 0.85, fbm(rng, n, 2.3, 4, 30)) * sstep(0.4, 0.8, fine)
    alb = mix(alb, np.array([0.48, 0.47, 0.45], f32), powder * 0.45)
    coal = sstep(0.60, 0.66, fbm(rng, n, 2.6, 8, 90)) * sstep(0.35, 0.6, fine)
    alb = mix(alb, np.array([0.03, 0.028, 0.027], f32), coal * 0.8)
    h = h + 0.18 * coal
    glow = crack * sstep(0.38, 0.62, big) * (0.5 + 0.5 * fine)
    alb = mix(alb, np.array([0.62, 0.17, 0.035], f32), np.clip(glow, 0, 1) * 0.8)
    rough = 0.94 - 0.35 * coal - 0.08 * powder + 0.04 * fine
    return alb, np.clip(h, 0, 1), rough, 0.030, 0.8


TILES = {"meadow": t_meadow, "loam": t_loam, "stone": t_stone, "sand": t_sand, "snow": t_snow, "ash": t_ash}


# ------------------------------------------------------------------ atlas cells (n = inner size)
def grid(n):
    y, x = np.mgrid[0:n, 0:n].astype(f32) / n
    return x, y


def c_stone(rng, n):
    tex = fbm(rng, n, 1.8, 6, 90)
    fine = fbm(rng, n, 0.9, 40, None)
    spk = fbm(rng, n, 0.5, 60, None)
    alb = paint(0.5 * tex + 0.5 * fine, [(0, (0.36, 0.35, 0.34)), (0.5, (0.50, 0.48, 0.46)), (1, (0.68, 0.65, 0.61))])
    dark = sstep(0.82, 0.93, spk)
    lite = sstep(0.82, 0.93, 1 - spk)
    alb = mix(mix(alb, np.array([0.14, 0.14, 0.15], f32), dark * 0.55), np.array([0.82, 0.80, 0.76], f32), lite * 0.35)
    lich = sstep(0.68, 0.84, fbm(rng, n, 2.6, 2, 12))
    alb = mix(alb, np.array([0.62, 0.66, 0.40], f32), lich * 0.42)
    h = 0.25 * tex + 0.5 * fine + 0.15 * spk + 0.1 * lich
    return alb, h, 0.76 + 0.1 * fine - 0.05 * lich, 0.026, 0.7


def c_river(rng, n):
    x, y = grid(n)
    warp = fbm(rng, n, 2.6, 1, 6)
    tex = fbm(rng, n, 2.0, 3, 40)
    fine = fbm(rng, n, 0.9, 40, None)
    band = 0.5 + 0.5 * np.sin(2 * np.pi * (4 * y + 1 * x + 2.2 * (warp - 0.5)))
    alb = paint(0.5 * tex + 0.5 * band, [(0, (0.20, 0.23, 0.26)), (0.5, (0.32, 0.35, 0.38)), (1, (0.47, 0.49, 0.50))])
    vein = 1 - sstep(0.0, 0.04, np.abs(((2 * x + 3 * y + 1.8 * (warp - 0.5)) % 1) - 0.5) * 0 + np.abs(np.sin(2 * np.pi * (2 * x + 3 * y + 1.6 * (warp - 0.5)))) * 0.5)
    vein = vein * sstep(0.55, 0.75, tex) * 0.9
    alb = mix(alb, np.array([0.80, 0.80, 0.77], f32), np.clip(vein, 0, 1) * 0.55)
    alb = alb * (0.95 + 0.1 * fine[..., None])
    h = 0.15 * tex + 0.08 * band + 0.3 * fine
    return alb, h, 0.40 + 0.22 * fine - 0.1 * vein, 0.010, 0.5


def c_moss(rng, n):
    tex = fbm(rng, n, 2.2, 2, 30)
    d1, _, ids = worley(rng, n, 22, 1.0)
    fine = fbm(rng, n, 1.0, 40, None)
    clump = sstep(0, 10, d1) * 0 + (1 - sstep(0, 13, d1))
    h = 0.4 * tex + 0.5 * clump * (0.6 + 0.4 * ids) + 0.15 * fine
    alb = paint(0.45 * tex + 0.35 * clump + 0.2 * ids, [(0, (0.10, 0.22, 0.05)), (0.5, (0.22, 0.40, 0.10)), (1, (0.44, 0.58, 0.18))])
    alb = alb * (0.9 + 0.2 * fine[..., None])
    alb = mix(alb, np.array([0.55, 0.45, 0.15], f32), sstep(0.8, 0.95, tex) * 0.3)
    return alb, h, 0.95 - 0.04 * fine, 0.038, 0.8


def c_sandstone(rng, n):
    x, y = grid(n)
    warp = fbm(rng, n, 2.6, 1, 6)
    tex = fbm(rng, n, 2.0, 3, 40)
    fine = fbm(rng, n, 1.1, 40, None)
    band = 0.5 + 0.5 * np.sin(2 * np.pi * (7 * y + 0.9 * (warp - 0.5) * 2 + 0.25 * (tex - 0.5)))
    band2 = 0.5 + 0.5 * np.sin(2 * np.pi * (2 * y + 1.1 * (warp - 0.5)))
    alb = paint(0.5 * band + 0.5 * tex, [(0, (0.66, 0.47, 0.28)), (0.5, (0.79, 0.60, 0.38)), (1, (0.88, 0.72, 0.50))])
    alb = mix(alb, np.array([0.62, 0.36, 0.22], f32), sstep(0.7, 0.95, band2) * 0.5)
    alb = alb * (0.92 + 0.14 * fine[..., None])
    d1, _, ids = worley(rng, n, 16, 1.0)
    pit = (ids > 0.62) * sstep(5, 1.5, d1)
    alb = alb * (1 - 0.35 * pit[..., None])
    h = 0.12 * tex + 0.15 * band + 0.42 * fine - 0.25 * pit
    return alb, h, 0.92 - 0.05 * fine, 0.026, 0.8


def c_bark(rng, n):
    a = fbm(rng, n, 2.0, 2, 26, aniso=(1, 8))
    b = fbm(rng, n, 1.6, 4, 60, aniso=(1, 3))
    fine = fbm(rng, n, 1.2, 30, None, aniso=(1, 2))
    fiss = 1 - sstep(0.0, 0.085, np.abs(a - 0.5))
    fiss2 = 1 - sstep(0.0, 0.05, np.abs(fbm(rng, n, 2.0, 4, 40, aniso=(1, 6)) - 0.5))
    fiss = np.maximum(fiss, 0.6 * fiss2)
    plate = 1 - fiss
    h = 0.3 + 0.55 * plate * (0.65 + 0.35 * b) + 0.12 * fine
    alb = paint(0.55 * b + 0.45 * fine, [(0, (0.27, 0.18, 0.11)), (0.5, (0.39, 0.28, 0.18)), (1, (0.53, 0.40, 0.27))])
    alb = mix(alb, np.array([0.06, 0.04, 0.03], f32), fiss * 0.9)
    lich = sstep(0.72, 0.86, fbm(rng, n, 2.6, 2, 14))
    alb = mix(alb, np.array([0.55, 0.60, 0.44], f32), lich * 0.35 * plate)
    return alb, h, 0.90 - 0.06 * plate * 0 + 0.05 * fine, 0.038, 0.85


def c_wood(rng, n):
    x, y = grid(n)
    r = np.hypot(x - 0.5, y - 0.5)
    ang = np.arctan2(y - 0.5, x - 0.5)
    w = fbm(rng, n, 2.4, 1, 8)
    fine = fbm(rng, n, 1.2, 20, None)
    ring = 0.5 + 0.5 * np.sin(2 * np.pi * (r * 20 + 0.6 * (w - 0.5)))
    alb = paint(0.6 * ring + 0.4 * fine, [(0, (0.72, 0.55, 0.34)), (0.5, (0.63, 0.45, 0.27)), (1, (0.50, 0.33, 0.19))])
    radial = np.abs(np.sin(ang * 5.5 + 3 * w))
    crack = (1 - sstep(0.0, 0.045, radial)) * sstep(0.03, 0.18, r) * sstep(0.5, 0.2, r)
    alb = alb * (1 - 0.5 * crack[..., None])
    bark = sstep(0.405, 0.43, r)
    alb = mix(alb, np.array([0.19, 0.125, 0.075], f32) * (0.8 + 0.4 * fine[..., None]), bark)
    h = 0.55 + 0.1 * ring - 0.35 * crack + 0.08 * fine + 0.3 * bark
    return alb, h, 0.86 + 0.06 * fine, 0.022, 0.6


def c_leaf(rng, n, kind):
    x, y = grid(n)
    u = np.abs(x - 0.5) * 2
    t = 1 - y
    mott = fbm(rng, n, 2.6, 2, 30)
    fine = fbm(rng, n, 1.3, 20, n / 2)
    ph = t * (16 if kind != "fern" else 24) - u * 5.5
    fr = ph % 1
    dist = np.minimum(fr, 1 - fr)
    line = (1 - sstep(0, 0.09, dist)) * (1 - u ** 2.5) * 0.75
    mid = 1 - sstep(0.0, 0.055, u)
    vein = np.maximum(line, mid)
    if kind == "green":
        alb = paint(0.55 * mott + 0.45 * (1 - u), [(0, (0.10, 0.25, 0.06)), (0.5, (0.20, 0.40, 0.10)), (1, (0.34, 0.52, 0.14))])
        alb = mix(alb, np.array([0.50, 0.58, 0.22], f32), np.clip(vein, 0, 1) * 0.55)
        alb = mix(alb, np.array([0.48, 0.50, 0.14], f32), sstep(0.82, 1.0, t) * 0.35)
    elif kind == "autumn":
        g = np.clip(0.30 * mott + 0.8 * u - 0.05 + 0.35 * t, 0, 1)
        alb = paint(g, [(0, (0.38, 0.46, 0.12)), (0.3, (0.80, 0.62, 0.12)), (0.62, (0.72, 0.33, 0.07)), (1, (0.42, 0.17, 0.06))])
        alb = mix(alb, alb * 1.2 + 0.05, np.clip(vein, 0, 1) * 0.45)
    else:  # fern
        alb = paint(0.5 * mott + 0.5 * (1 - u), [(0, (0.14, 0.32, 0.08)), (0.5, (0.26, 0.47, 0.13)), (1, (0.42, 0.60, 0.20))])
        alb = mix(alb, np.array([0.55, 0.65, 0.28], f32), np.clip(vein, 0, 1) * 0.5)
    alb = alb * (0.93 + 0.14 * fine[..., None])
    h = 0.55 - 0.28 * vein + 0.16 * fine * (1 - vein) + 0.1 * mott
    return alb, h, 0.58 + 0.2 * fine - 0.12 * vein * 0, 0.02, 0.4


def quad_cell(n, builders):
    """2x2 quadrants. builders: list of 4 callables(m)->(alb,h,rough). TL, TR, BL, BR"""
    m = n // 2
    A = np.zeros((n, n, 3), f32)
    H = np.zeros((n, n), f32)
    Rr = np.zeros((n, n), f32)
    for k, fn in enumerate(builders):
        a, hh, rr = fn(m)
        r0, c0 = (k // 2) * m, (k % 2) * m
        A[r0:r0 + m, c0:c0 + m] = a
        H[r0:r0 + m, c0:c0 + m] = hh
        Rr[r0:r0 + m, c0:c0 + m] = rr
    return A, H, Rr


def c_grass(rng, n):
    def blade(kind):
        def fn(m):
            x, y = grid(m)
            t = 1 - y
            streak = fbm(rng, m, 1.2, 8, m / 2, aniso=(1, 14))
            groove = 1 - sstep(0.0, 0.06, np.abs(x - 0.5))
            edge = sstep(0.0, 0.10, x) * sstep(0.0, 0.10, 1 - x)
            if kind == "fresh":
                alb = paint(t, [(0, (0.66, 0.72, 0.36)), (0.06, (0.55, 0.66, 0.24)), (0.28, (0.18, 0.38, 0.07)), (0.75, (0.30, 0.50, 0.12)), (1, (0.56, 0.56, 0.16))])
            else:
                alb = paint(t, [(0, (0.66, 0.60, 0.36)), (0.3, (0.70, 0.60, 0.30)), (0.75, (0.78, 0.66, 0.34)), (1, (0.60, 0.46, 0.22))])
            alb = alb * (0.86 + 0.28 * streak[..., None]) * (1 - 0.30 * groove[..., None]) * (0.85 + 0.15 * edge[..., None])
            return alb, 0.5 + 0.3 * streak - 0.4 * groove, 0.55 + 0.15 * streak
        return fn

    def petal(c0, c1, c2):
        def fn(m):
            x, y = grid(m)
            t = 1 - y
            u = np.abs(x - 0.5) * 2
            streak = 0.5 + 0.5 * np.sin(2 * np.pi * (x * 14 + 1.5 * fbm(rng, m, 2, 1, 6)))
            alb = paint(t, [(0, c0), (0.35, c1), (1, c2)])
            alb = alb * (0.93 + 0.07 * streak[..., None]) * (1 - 0.06 * u[..., None] ** 2)
            return alb, 0.5 + 0.2 * streak, 0.55 + 0.1 * streak
        return fn

    A, H, Rr = quad_cell(n, [blade("fresh"), blade("straw"),
                             petal((0.85, 0.70, 0.15), (0.98, 0.97, 0.94), (0.99, 0.99, 0.99)),
                             petal((0.30, 0.20, 0.55), (0.48, 0.38, 0.82), (0.62, 0.52, 0.90))])
    return A, H, Rr, 0.02, 0.4


def c_flower(rng, n):
    def petal(c0, c1, c2):
        def fn(m):
            x, y = grid(m)
            t = 1 - y
            u = np.abs(x - 0.5) * 2
            streak = 0.5 + 0.5 * np.sin(2 * np.pi * (x * 14 + 1.5 * fbm(rng, m, 2, 1, 6)))
            alb = paint(t, [(0, c0), (0.35, c1), (1, c2)])
            return alb * (0.93 + 0.07 * streak[..., None]) * (1 - 0.06 * u[..., None] ** 2), 0.5 + 0.2 * streak, 0.55 + 0.1 * streak
        return fn
    A, H, Rr = quad_cell(n, [petal((0.85, 0.70, 0.15), (0.98, 0.97, 0.94), (0.99, 0.99, 0.99)),
                             petal((0.30, 0.20, 0.55), (0.48, 0.38, 0.82), (0.62, 0.52, 0.90)),
                             petal((0.90, 0.60, 0.05), (0.99, 0.80, 0.12), (1.0, 0.87, 0.28)),
                             petal((0.35, 0.05, 0.05), (0.80, 0.16, 0.16), (0.93, 0.33, 0.30))])
    return A, H, Rr, 0.015, 0.4


def c_mushroom(rng, n):
    def cap_brown(m):
        x, y = grid(m)
        r = np.hypot(x - 0.5, y - 0.5) * 2
        mott = fbm(rng, m, 2.2, 2, 25)
        alb = paint(np.clip(r * 0.85 + 0.25 * (mott - 0.5), 0, 1), [(0, (0.33, 0.19, 0.10)), (0.6, (0.55, 0.37, 0.22)), (1, (0.74, 0.55, 0.36))])
        d1, _, ids = worley(rng, m, 9, 1.0)
        fleck = (ids > 0.45) * sstep(m / 22, m / 60, d1) * sstep(0.15, 0.6, r)
        alb = mix(alb, np.array([0.90, 0.84, 0.70], f32), fleck * 0.5)
        return alb, 0.5 + 0.3 * mott + 0.2 * fleck, 0.50 + 0.2 * mott

    def gills(m):
        x, y = grid(m)
        r = np.hypot(x - 0.5, y - 0.5) * 2
        a = np.arctan2(y - 0.5, x - 0.5)
        ln = 0.5 + 0.5 * np.sin(a * 46)
        alb = paint(r, [(0, (0.60, 0.46, 0.34)), (0.5, (0.83, 0.72, 0.58)), (1, (0.70, 0.54, 0.40))]) * (0.78 + 0.32 * ln[..., None])
        return alb, 0.4 + 0.5 * ln, 0.85 + 0 * r

    def stem(m):
        x, y = grid(m)
        st = fbm(rng, m, 1.2, 6, m / 2, aniso=(1, 12))
        t = 1 - y
        alb = paint(t, [(0, (0.46, 0.36, 0.25)), (0.25, (0.82, 0.75, 0.62)), (1, (0.93, 0.89, 0.78))]) * (0.88 + 0.2 * st[..., None])
        return alb, 0.5 + 0.4 * st, 0.75 + 0 * t

    def cap_red(m):
        x, y = grid(m)
        r = np.hypot(x - 0.5, y - 0.5) * 2
        mott = fbm(rng, m, 2.2, 2, 25)
        alb = paint(np.clip(r + 0.15 * (mott - 0.5), 0, 1), [(0, (0.52, 0.07, 0.05)), (0.6, (0.75, 0.13, 0.09)), (1, (0.88, 0.25, 0.14))])
        d1, _, ids = worley(rng, m, 5, 0.9)
        dot = sstep(m / 15, m / 22, d1) * (ids > 0.15) * sstep(1.05, 0.9, r)
        alb = mix(alb, np.array([0.96, 0.92, 0.82], f32), dot * 0.9)
        return alb, 0.5 + 0.25 * mott + 0.2 * dot, 0.35 + 0.1 * mott
    A, H, Rr = quad_cell(n, [cap_brown, gills, stem, cap_red])
    return A, H, Rr, 0.022, 0.5


def c_pinecone(rng, n):
    x, y = grid(n)
    t = 1 - y
    gr = fbm(rng, n, 1.5, 6, n / 3, aniso=(3, 1))
    fine = fbm(rng, n, 1.2, 20, None)
    alb = paint(np.clip(t * 0.85 + 0.2 * gr, 0, 1), [(0, (0.14, 0.08, 0.05)), (0.3, (0.30, 0.19, 0.11)), (0.8, (0.50, 0.34, 0.20)), (1, (0.58, 0.42, 0.26))])
    alb = alb * (0.88 + 0.24 * fine[..., None])
    alb = mix(alb, np.array([0.22, 0.14, 0.09], f32), sstep(0.93, 1.0, t) * 0.6)
    h = 0.4 + 0.4 * gr + 0.15 * fine
    return alb, h, 0.82 - 0.1 * t, 0.04, 0.7


def c_acorn(rng, n):
    def nut(m):
        x, y = grid(m)
        st = fbm(rng, m, 1.4, 4, m / 3, aniso=(1, 10))
        t = 1 - y
        alb = paint(np.clip(0.55 * st + 0.4 * (1 - t), 0, 1), [(0, (0.72, 0.52, 0.22)), (0.5, (0.60, 0.40, 0.17)), (1, (0.33, 0.20, 0.09))])
        alb = mix(alb, np.array([0.55, 0.40, 0.22], f32), sstep(0.06, 0.0, t) * 0.5)
        return alb, 0.5 + 0.3 * st, 0.36 + 0.2 * st

    def cap(m):
        d1, d2, ids = worley(rng, m, 8, 0.7)
        bevel = sstep(0, 9, d2 - d1)
        alb = paint(0.6 * ids + 0.4 * bevel, [(0, (0.22, 0.16, 0.08)), (0.5, (0.36, 0.27, 0.14)), (1, (0.50, 0.39, 0.21))])
        return alb, 0.2 + 0.7 * bevel, 0.88 + 0 * bevel

    A = np.zeros((n, n, 3), f32)
    H = np.zeros((n, n), f32)
    Rr = np.zeros((n, n), f32)
    m = n // 2
    for k, fn in enumerate((nut, cap)):  # each rendered square then squeezed to a tall half-width strip
        a, hh, rr = fn(n)
        A[:, k * m:(k + 1) * m] = a[:, ::2][:, :m]
        H[:, k * m:(k + 1) * m] = hh[:, ::2][:, :m]
        Rr[:, k * m:(k + 1) * m] = rr[:, ::2][:, :m]
    return A, H, Rr, 0.03, 0.6


def c_frost(rng, n):
    d1, d2, ids = worley(rng, n, 11, 1.0)
    edge = d2 - d1
    fine = fbm(rng, n, 1.2, 30, None)
    mott = fbm(rng, n, 2.4, 2, 20)
    facet = 0.86 + 0.14 * ids
    alb = paint(np.clip(0.6 * mott + 0.4 * ids, 0, 1), [(0, (0.66, 0.76, 0.88)), (0.5, (0.82, 0.89, 0.95)), (1, (0.95, 0.97, 0.99))]) * facet[..., None]
    alb = mix(alb, np.array([0.50, 0.65, 0.82], f32), (1 - sstep(0, 3.5, edge)) * 0.5)
    alb = alb * (0.96 + 0.06 * fine[..., None])
    h = 0.45 + 0.4 * ids + 0.1 * sstep(0, 12, edge) + 0.08 * fine
    rough = np.where(ids > 0.6, 0.30, 0.66) + 0.08 * fine
    return alb, h, rough, 0.030, 0.6


def c_char(rng, n):
    d1, d2, ids = worley(rng, n, 9, 0.85)
    edge = d2 - d1
    big = fbm(rng, n, 2.3, 1, 8)
    fine = fbm(rng, n, 1.2, 30, None)
    plate = sstep(0, 14, edge)
    crack = 1 - sstep(0, 4.5, edge)
    alb = paint(0.5 * fine + 0.5 * ids, [(0, (0.035, 0.032, 0.03)), (0.5, (0.085, 0.075, 0.068)), (1, (0.17, 0.15, 0.135))])
    ash = sstep(0.62, 0.85, fbm(rng, n, 2.4, 3, 25))
    alb = mix(alb, np.array([0.42, 0.41, 0.40], f32), ash * 0.4)
    glow = crack * sstep(0.45, 0.7, big) * (0.55 + 0.45 * fine)
    alb = mix(alb, np.array([0.75, 0.22, 0.04], f32), np.clip(glow, 0, 1) * 0.7)
    h = 0.25 + 0.55 * plate * (0.8 + 0.2 * ids) + 0.1 * fine - 0.1 * crack
    return alb, h, 0.58 + 0.3 * ash + 0.1 * (1 - plate), 0.045, 0.85


def pad_cell(a, pad, periodic):
    mode = "wrap" if periodic else "edge"
    w = ((pad, pad), (pad, pad)) + (((0, 0),) if a.ndim == 3 else ())
    return np.pad(a, w, mode=mode)


# cell index -> (builder, periodic)
CELLS = {
    0: (c_stone, True), 1: (c_river, True), 2: (c_moss, True), 3: (c_sandstone, True),
    4: (c_bark, True), 5: (c_wood, False), 6: (lambda r, n: c_leaf(r, n, "green"), False),
    7: (lambda r, n: c_leaf(r, n, "autumn"), False), 8: (c_grass, False),
    9: (lambda r, n: c_leaf(r, n, "fern"), False), 10: (c_flower, False), 11: (c_mushroom, False),
    12: (c_pinecone, False), 13: (c_acorn, False), 14: (c_frost, True), 15: (c_char, True),
}
CELL, PAD = 512, 8
INNER = CELL - 2 * PAD


def build_atlas(seed=7):
    Z = CELL * 4
    alb = np.zeros((Z, Z, 3), f32)
    nrm = np.zeros((Z, Z, 3), f32)
    orm = np.zeros((Z, Z, 3), f32)
    for idx, (fn, per) in CELLS.items():
        rng = np.random.default_rng(seed * 100 + idx)
        res = fn(rng, INNER)
        a, h, r = res[0], res[1], res[2]
        bump = res[3] if len(res) > 3 else 0.03
        aos = res[4] if len(res) > 4 else 0.6
        h = np.clip(h, 0, 1)
        nm = normal_map(h, bump)
        ao = cavity_ao(h, strength=aos)
        o = np.stack([ao, np.clip(r, 0.04, 1), np.zeros_like(h)], -1)
        r0, c0 = (idx // 4) * CELL, (idx % 4) * CELL
        alb[r0:r0 + CELL, c0:c0 + CELL] = pad_cell(np.clip(a, 0, 1), PAD, per)
        nrm[r0:r0 + CELL, c0:c0 + CELL] = pad_cell(nm, PAD, per)
        orm[r0:r0 + CELL, c0:c0 + CELL] = pad_cell(o, PAD, per)
    return alb, nrm, orm


def atlas_uv(cell, uv, rect=(0, 0, 1, 1)):
    """Map local (u,v) in [0,1] (v=0 image top) to atlas UV inside the padded cell."""
    uv = np.asarray(uv, np.float64)
    u = rect[0] + np.clip(uv[..., 0], 0, 1) * (rect[2] - rect[0])
    v = rect[1] + np.clip(uv[..., 1], 0, 1) * (rect[3] - rect[1])
    Z = CELL * 4
    x = ((cell % 4) * CELL + PAD + u * INNER) / Z
    y = ((cell // 4) * CELL + PAD + v * INNER) / Z
    return np.stack([x, y], -1)
