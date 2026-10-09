"""Procedural trim-sheet textures for the Stormspire tower and the reel pack (numpy only, deterministic).

Every material lives in a horizontal strip that spans the full atlas width, so U tiles freely (REPEAT) and the
builder maps V inside the strip. Strip content is periodic in both directions and the strip carries PAD rows of
wrapped content above and below, so bilinear and the first mip levels never bleed a neighbour into the seam.

Outputs per atlas: base colour (sRGB), tangent-space normal (OpenGL, +Y up), ORM (R occlusion, G roughness,
B metalness, the glTF packing). Arrays are top-down (row 0 = top of the image = glTF v 0 = Blender v 1).
"""
import numpy as np

PAD = 4

def hexc(h):
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def vnoise(h, w, cy, cx, rng):
    """Periodic value noise: cy x cx lattice cells across the strip."""
    g = rng.random((cy, cx)).astype(np.float32)
    ys = np.arange(h) * cy / h; xs = np.arange(w) * cx / w
    y0 = np.floor(ys).astype(int); x0 = np.floor(xs).astype(int)
    fy = (ys - y0).astype(np.float32); fx = (xs - x0).astype(np.float32)
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    y1 = (y0 + 1) % cy; x1 = (x0 + 1) % cx; y0 %= cy; x0 %= cx
    a = g[y0][:, x0]; b = g[y0][:, x1]; c = g[y1][:, x0]; d = g[y1][:, x1]
    fx = fx[None, :]; fy = fy[:, None]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy

def fbm(h, w, cy, cx, rng, octaves=4, gain=.5):
    out = np.zeros((h, w), np.float32); amp = 1.0; tot = 0.0
    for _ in range(octaves):
        out += vnoise(h, w, max(1, int(cy)), max(1, int(cx)), rng) * amp; tot += amp; amp *= gain; cy *= 2; cx *= 2
    return out / tot

def blur(a, r):
    """Wrap-around box blur, three passes (close to gaussian)."""
    if r < 1: return a
    out = a
    for _ in range(3):
        for ax in (0, 1):
            acc = np.zeros_like(out)
            for k in range(-r, r + 1): acc += np.roll(out, k, axis=ax)
            out = acc / (2 * r + 1)
    return out

def normal_from_height(hgt, strength):
    dx = (np.roll(hgt, -1, 1) - np.roll(hgt, 1, 1)) * .5
    dy = (np.roll(hgt, 1, 0) - np.roll(hgt, -1, 0)) * .5   # +v is up the image (row - 1)
    n = np.stack([-dx * strength, -dy * strength, np.ones_like(hgt)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * .5 + .5

def cavity(hgt, r=5, k=3.0):
    return np.clip(1 - np.maximum(blur(hgt, r) - hgt, 0) * k, .45, 1)

class Strip:
    """One trim strip: albedo (h,w,3) sRGB, height (h,w) 0..1, rough, metal, normal strength."""
    def __init__(self, alb, hgt, rough, metal, nstr=4.0, ao_k=3.0):
        self.alb, self.hgt, self.rough, self.metal, self.nstr, self.ao_k = alb, hgt, rough, metal, nstr, ao_k

# ------------------------------------------------------------------ painterly stone blocks
def stone(h, w, metres_w, metres_h, course_m, width_rng, palette, mortar, seed, moss=0.0, bevel=.03, rough=.82):
    rng = np.random.default_rng(seed)
    ppx, ppy = w / metres_w, h / metres_h
    nrow = max(1, round(metres_h / course_m)); ch = h / nrow
    yy_all = np.arange(h)[:, None].astype(np.float32); xx = np.arange(w)[None, :].astype(np.float32)
    dxm = np.zeros((h, w), np.float32); dym = np.zeros((h, w), np.float32); bid = np.zeros((h, w), np.int32)
    yin = np.zeros((h, w), np.float32); nb = 0
    for r in range(nrow):
        y0, y1 = int(round(r * ch)), int(round((r + 1) * ch))
        widths = []
        while sum(widths) < metres_w: widths.append(rng.uniform(*width_rng))
        widths = np.array(widths); widths *= metres_w / widths.sum()
        edges = np.concatenate([[0], np.cumsum(widths)]) * ppx; off = rng.uniform(0, w)
        xs = (xx - off) % w; idx = np.clip(np.searchsorted(edges, xs, 'right') - 1, 0, len(widths) - 1)
        left, right = edges[idx], edges[idx + 1]
        rows = slice(y0, y1); yy = yy_all[rows] - y0
        dxm[rows] = np.minimum(xs - left, right - xs) / ppx
        dym[rows] = np.minimum(yy, (y1 - y0) - yy) / ppy
        yin[rows] = yy / max(1, (y1 - y0))
        bid[rows] = idx + nb; nb += len(widths)
    # rounded-rectangle interior distance
    rr = bevel * 1.2
    qx = np.maximum(rr - dxm, 0); qy = np.maximum(rr - dym, 0)
    d = np.minimum(dxm, dym)
    d = np.where((qx > 0) & (qy > 0), rr - np.sqrt(qx * qx + qy * qy), d)
    gap = .007
    big = fbm(h, w, 4, max(2, int(metres_w * 2)), rng, 4)
    fine = fbm(h, w, int(metres_h * 30), int(metres_w * 30), rng, 3)
    chips = fbm(h, w, int(metres_h * 9), int(metres_w * 9), rng, 3)
    btab = rng.random((nb + 1, 4)).astype(np.float32)
    jit = btab[bid]
    face = smooth(gap, gap + bevel, d)
    chip = (chips > .70) & (d < .05)
    hgt = face * (.78 + .22 * jit[..., 0]) + (fine - .5) * .10 * face + (big - .5) * .08
    hgt = np.where(chip, hgt - .35 * smooth(.62, .75, chips), hgt)
    hgt = np.where(d < gap, .05 * fine, hgt)
    pal = np.stack([hexc(p) for p in palette])
    base = pal[(jit[..., 1] * len(palette)).astype(int) % len(palette)]
    base = base * (.9 + .2 * jit[..., 2:3])
    alb = base * (.88 + .24 * big[..., None]) + (fine[..., None] - .5) * .08
    alb = alb + (.07 * (1 - yin) - .03)[..., None] * face[..., None]       # light from above: lit top, shaded foot
    top_edge = smooth(.035, 0, dym) * (yin < .5); bot_edge = smooth(.04, 0, dym) * (yin >= .5)
    alb = alb + .08 * (top_edge * face)[..., None] - .10 * (bot_edge * face)[..., None]
    alb = np.where(chip[..., None], alb * .82, alb)
    if moss:
        m = smooth(.62, .72, fbm(h, w, int(metres_h * 4), int(metres_w * 4), rng, 4)) * smooth(.5, 1.0, yin) * moss
        alb = alb * (1 - m[..., None]) + hexc('7c9a3e')[None, None] * (.85 + .3 * fine[..., None]) * m[..., None]
    alb = np.where((d < gap)[..., None], hexc(mortar)[None, None] * (.85 + .3 * fine[..., None]), alb)
    rgh = np.clip(rough + (fine - .5) * .12 + (d < gap) * .1, 0, 1)
    return Strip(np.clip(alb, 0, 1), np.clip(hgt, 0, 1), rgh, np.zeros((h, w), np.float32), nstr=9.0)

# ------------------------------------------------------------------ metals, ceramics, rubber
def metal(h, w, col, rough, rng, streak=True, patina=None, dent=0.0, metal_v=1.0, dark=.18):
    s = vnoise(h, w, max(2, h // 2), 6, rng) if streak else fbm(h, w, 8, 32, rng, 3)
    f = fbm(h, w, 16, 64, rng, 3)
    alb = hexc(col)[None, None] * (1 - dark * .5 + dark * (s[..., None] * .6 + f[..., None] * .4))
    hgt = .5 + (s - .5) * .15
    if dent:
        dd = fbm(h, w, 6, 24, rng, 2); hgt = hgt + (dd - .5) * dent
    p = np.zeros((h, w), np.float32)
    if patina:
        p = smooth(.72, .80, fbm(h, w, 6, 26, rng, 4))
        alb = alb * (1 - p[..., None] * .8) + hexc(patina)[None, None] * p[..., None] * .8
    rough_a = rough + p * .35
    rgh = np.clip(rough_a + (f - .5) * .12 + (s - .5) * .08, .05, 1)
    mtl = np.full((h, w), metal_v, np.float32) * (1 - p * .9)
    return Strip(np.clip(alb, 0, 1), np.clip(hgt, 0, 1), rgh, mtl, nstr=2.0)

def ceramic(h, w, col, rng, rough=.16, craze=True):
    f = fbm(h, w, 4, 16, rng, 3)
    alb = hexc(col)[None, None] * (.94 + .1 * f[..., None])
    hgt = np.full((h, w), .5, np.float32)
    if craze:
        c = fbm(h, w, 8, 40, rng, 2); line = smooth(.025, 0, np.abs(c - .5))
        alb = alb * (1 - .1 * line[..., None]); hgt = hgt - .05 * line
    return Strip(alb, hgt, np.full((h, w), rough, np.float32) + (f - .5) * .05, np.zeros((h, w), np.float32), nstr=2.0)

def rubber(h, w, rng, col='242529'):
    f = fbm(h, w, 8, 40, rng, 3)
    return Strip(hexc(col)[None, None] * (.9 + .2 * f[..., None]), .5 + (f - .5) * .1, np.full((h, w), .86, np.float32), np.zeros((h, w), np.float32), nstr=2.0)

# ------------------------------------------------------------------ wood planks (grain along V, plank joints along U)
def wood(h, w, metres_w, plank_m, col, rng):
    ppx = w / metres_w
    xs = np.arange(w)[None, :] / ppx; ys = np.arange(h)[:, None] / h
    n = max(1, round(metres_w / plank_m)); pw = metres_w / n
    pid = np.floor(xs / pw).astype(int) % n; px = (xs - pid * pw) / pw
    jit = rng.random((n, 3)).astype(np.float32)[pid]
    warp = fbm(h, w, 4, n * 3, rng, 3)
    grain = .5 + .5 * np.sin((px * 9 + warp * 3 + jit[..., 0] * 7) * np.pi * 2)
    grain = grain ** 3
    fine = fbm(h, w, 64, n * 8, rng, 2)
    joint = smooth(.035, .0, np.minimum(px, 1 - px))
    alb = hexc(col)[None, None] * (.78 + .3 * jit[..., 1:2] - .16 * grain[..., None] + .08 * fine[..., None])
    alb = alb * (1 - .55 * joint[..., None])
    hgt = .6 - .1 * grain - .5 * joint + .03 * fine
    return Strip(np.clip(alb, 0, 1), np.clip(hgt, 0, 1), np.clip(.62 + .15 * grain, 0, 1), np.zeros((h, w), np.float32), nstr=5.0)

def wood_h(h, w, rows, col, rng):
    """Planks stacked across the strip (joints along U, grain along U): a backboard."""
    ys = np.arange(h)[:, None] / h * rows; pid = np.floor(ys).astype(int) % rows; py = ys - np.floor(ys)
    xs = np.arange(w)[None, :] / w
    jit = rng.random((rows, 3)).astype(np.float32)[pid]
    warp = fbm(h, w, rows * 3, 6, rng, 3)
    grain = (.5 + .5 * np.sin((py * 7 + warp * 3 + jit[..., 0] * 5) * np.pi * 2 + xs * 0)) ** 3
    fine = fbm(h, w, rows * 6, 96, rng, 2)
    joint = smooth(.06, 0, np.minimum(py, 1 - py))
    alb = hexc(col)[None, None] * (.8 + .28 * jit[..., 1:2] - .15 * grain[..., None] + .08 * fine[..., None]) * (1 - .5 * joint[..., None])
    hgt = .6 - .1 * grain - .5 * joint + .03 * fine
    return Strip(np.clip(alb, 0, 1), np.clip(hgt, 0, 1), np.clip(.6 + .15 * grain, 0, 1), np.zeros((h, w), np.float32), nstr=5.0)

# ------------------------------------------------------------------ leather with edge stitching
def leather(h, w, col, rng, stitch_rows=(.18, .82), stitch_px=10):
    f = fbm(h, w, 12, 80, rng, 4); pebble = fbm(h, w, 40, 260, rng, 2)
    alb = hexc(col)[None, None] * (.85 + .25 * f[..., None] - .08 * pebble[..., None])
    hgt = .5 + (pebble - .5) * .2
    xs = np.arange(w)[None, :]; ys = np.arange(h)[:, None] / h
    st = np.zeros((h, w), np.float32)
    for r in stitch_rows:
        st = np.maximum(st, smooth(.035, .015, np.abs(ys - r)) * ((xs % stitch_px) < stitch_px * .6))
    alb = alb * (1 - st[..., None]) + hexc('e8d2a8')[None, None] * st[..., None]
    hgt = hgt + st * .2
    edge = smooth(.08, 0, np.minimum(ys, 1 - ys)); alb = alb * (1 - .35 * edge[..., None])
    return Strip(np.clip(alb, 0, 1), np.clip(hgt, 0, 1), np.full((h, w), .58, np.float32) - st * .2, np.zeros((h, w), np.float32), nstr=3.0)

# ------------------------------------------------------------------ braided cable jacket (near white: the runtime tints it)
def braid(h, w, rng, wraps_u=48):
    ys = np.arange(h)[:, None] / h; xs = np.arange(w)[None, :] / w
    a = np.sin((xs * wraps_u + ys * 2) * np.pi * 2); b = np.sin((xs * wraps_u - ys * 2) * np.pi * 2)
    weave = np.maximum(a, b) * .5 + .5
    f = fbm(h, w, 8, 64, rng, 2)
    alb = np.ones((h, w, 3), np.float32) * (.80 + .16 * weave[..., None] + .06 * f[..., None])
    return Strip(np.clip(alb, 0, 1), .4 + .3 * weave, np.full((h, w), .5, np.float32) - weave * .1, np.zeros((h, w), np.float32), nstr=3.0)

# ------------------------------------------------------------------ enchanted hat cloth: indigo felt, gold stars and moons, one stitched patch
def _star(px, py, cx, cy, r, points=5, inner=.45, rot=0.0):
    ang = np.arctan2(py - cy, px - cx) + rot; rad = np.hypot(px - cx, py - cy)
    k = (ang * points / (2 * np.pi)) % 1.0
    edge = r * (inner + (1 - inner) * np.abs(1 - 2 * k) ** 1.6)
    return edge - rad

def hat_cloth(h, w, metres_w, metres_h, rng):
    ppx, ppy = w / metres_w, h / metres_h
    xs = np.arange(w)[None, :].astype(np.float32); ys = np.arange(h)[:, None].astype(np.float32)
    f = fbm(h, w, 6, 18, rng, 4); weave = (np.sin(xs * 1.9) * np.sin(ys * 1.9)) * .5 + .5
    alb = hexc('2d3c9c')[None, None] * (.82 + .3 * f[..., None] + .05 * weave[..., None])
    hgt = .5 + (f - .5) * .3 + .05 * weave
    mask = np.zeros((h, w), np.float32)   # gold
    def put(sdf, colour, soft=1.4):
        nonlocal alb, hgt, mask
        a = smooth(-soft, soft, sdf)
        rim = smooth(-soft - 2.5, -soft, sdf) * (1 - a)
        alb = alb * (1 - rim[..., None] * .35)
        alb = alb * (1 - a[..., None]) + colour * a[..., None]
        hgt = hgt + a * .25; mask = np.maximum(mask, a)
    gold, cream = hexc('ffcc45')[None, None], hexc('fff0b0')[None, None]
    placed = []
    for i in range(60):
        for _ in range(40):
            cx, cy = rng.uniform(0, w), rng.uniform(.08 * h, .92 * h)
            size = rng.choice([.05, .07, .09, .13]) if i < 26 else .025
            if all(min(abs(cx - x), w - abs(cx - x)) / ppx > (s + size) * 1.5 or abs(cy - y) / ppy > (s + size) * 1.5 for x, y, s in placed): break
        placed.append((cx, cy, size))
        for wrap in (-w, 0, w):
            X = (xs - cx - wrap) / ppx; Y = (ys - cy) / ppy   # metres, isotropic
            if i < 26 and i % 5 == 4:   # crescent moon
                d = np.minimum(size - np.hypot(X, Y), np.hypot(X - size * .45, Y + size * .2) - size * .8)
                put(d * ppy, cream)
            elif i < 26:
                put(_star(X, Y, 0, 0, size, 5, .46, rng.uniform(0, 6.28) if wrap == -w else 0) * ppy, gold)
            else:   # tiny four-point sparkles
                put(_star(X, Y, 0, 0, size, 4, .25) * ppy, cream, 1.0)
    # one stitched patch (purple), a little crooked
    cx, cy, sz = w * .73, h * .55, .22
    X = (xs - cx) / ppx; Y = (ys - cy) / ppy; c, s = np.cos(.18), np.sin(.18)
    U = X * c - Y * s; V = X * s + Y * c
    box = np.maximum(np.abs(U), np.abs(V) * 1.15) - sz
    pa = smooth(.004, -.004, box)
    pf = fbm(h, w, 12, 40, rng, 3)
    alb = alb * (1 - pa[..., None]) + hexc('8a4cb8')[None, None] * (.85 + .25 * pf[..., None]) * pa[..., None]
    mask = mask * (1 - pa)
    dash = (((U + V) * 70) % 1.0 < .55)
    stitch = smooth(.008, .003, np.abs(box + .025)) * dash
    alb = alb * (1 - stitch[..., None]) + cream * stitch[..., None]
    hgt = hgt + pa * .15 + stitch * .1
    rgh = .88 - mask * .45
    return Strip(np.clip(alb, 0, 1), np.clip(hgt, 0, 1), rgh, mask * .65, nstr=4.0)

# ------------------------------------------------------------------ atlas assembly
def assemble(width, height, layout, out_prefix, quality=(88, 86, 90)):
    """layout: list of (name, rows, Strip-factory(h, w)). Returns {name: (y0, y1)} in top-down pixel rows (inner area)."""
    from PIL import Image
    alb = np.zeros((height, width, 3), np.float32); nrm = np.zeros((height, width, 3), np.float32); orm = np.zeros((height, width, 3), np.float32)
    nrm[..., 2] = 1; nrm = nrm * 0 + np.array([.5, .5, 1.0], np.float32); orm[..., 0] = 1
    rows = {}; y = 0
    for name, n, factory in layout:
        inner = n - 2 * PAD
        s = factory(inner, width)
        nm = normal_from_height(s.hgt, s.nstr); occ = cavity(s.hgt, 5, s.ao_k)
        ormS = np.stack([occ, s.rough, s.metal], -1)
        for arr, src in ((alb, s.alb), (nrm, nm), (orm, ormS)):
            padded = np.concatenate([src[-PAD:], src, src[:PAD]], 0)
            arr[y:y + n] = padded
        rows[name] = (y + PAD, y + n - PAD); y += n
    assert y <= height, (y, height)
    to8 = lambda a: (np.clip(a, 0, 1) * 255 + .5).astype(np.uint8)
    paths = {}
    for key, arr, q, sub in (('base', alb, quality[0], 2), ('normal', nrm, quality[1], 0), ('orm', orm, quality[2], 0)):
        im = Image.fromarray(to8(arr))
        if key == 'orm': im = im.resize((width // 2, height // 2), Image.BILINEAR)   # occlusion/roughness/metal are soft: half size
        p = f'{out_prefix}_{key}.jpg'; im.save(p, quality=q, subsampling=sub, optimize=True); paths[key] = p
    return rows, paths
