"""Brann's Forge resource / treasure prop kit. Blender 4.5, deterministic.
blender --background --factory-startup --python-exit-code 2 --python build_resources.py -- --out ABS_DIR [--no-render] [--samples N] [--only a,b]
Authoring is in glTF space (x right, y up, -z front); B() converts to Blender Z-up.
Two shared 512 maps: props_albedo_a.png (stone | star-iron / oak | leather) and props_atlas_b.png
(gem glow | iron vein glow / apple skin | linen). Every mesh also carries a non-white COLOR_0 multiplier.
"""
import bpy, bmesh, sys, os, json, math, random, zlib, struct, time
import numpy as np
from mathutils import Vector, Matrix, noise as mnoise

T0 = time.time(); TIMES = {}
def log(*a): print('[res %.1fs]' % (time.time() - T0), *a, flush=True)

def parse_args():
    argv = sys.argv; argv = argv[argv.index('--') + 1:] if '--' in argv else []
    o = dict(out=None, render=True, samples=32, only=None); i = 0
    while i < len(argv):
        if argv[i] == '--out': o['out'] = argv[i + 1]; i += 2
        elif argv[i] == '--no-render': o['render'] = False; i += 1
        elif argv[i] == '--samples': o['samples'] = int(argv[i + 1]); i += 2
        elif argv[i] == '--only': o['only'] = argv[i + 1].split(','); i += 2
        else: i += 1
    if not o['out'] or not os.path.isabs(o['out']): raise SystemExit('--out ABS_PATH required')
    return o

def B(p): return Vector((p[0], -p[2], p[1]))
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def lerp(a, b, t): return a + (b - a) * t
def mixc(a, b, t): return tuple(lerp(a[i], b[i], t) for i in range(3))
def mulc(c, k): return tuple(x * k for x in c)
def rgba(c): return (clamp(c[0], 0, 1.5), clamp(c[1], 0, 1.5), clamp(c[2], 0, 1.5), 1.0)
def N3(p, s=1.0, o=0.0): return mnoise.noise(Vector((p[0] * s + o, p[1] * s + o * 1.7, p[2] * s - o * 0.6)))

# ---------------------------------------------------------------- textures (numpy, deterministic)
def vnoise(rng, size, fx, fy):
    g = rng.random((fy, fx)); xs = np.arange(size) / size * fx; ys = np.arange(size) / size * fy
    x0 = np.floor(xs).astype(int); y0 = np.floor(ys).astype(int)
    a = xs - x0; b = ys - y0; a = a * a * (3 - 2 * a); b = b * b * (3 - 2 * b)
    x1 = (x0 + 1) % fx; y1 = (y0 + 1) % fy
    top = g[y0][:, x0] * (1 - a)[None, :] + g[y0][:, x1] * a[None, :]
    bot = g[y1][:, x0] * (1 - a)[None, :] + g[y1][:, x1] * a[None, :]
    return top * (1 - b)[:, None] + bot * b[:, None]

def fbm(rng, size, fx, fy, octv=4):
    tot = 0; amp = 1; nrm = 0
    for o in range(octv):
        tot = tot + amp * vnoise(rng, size, fx * 2 ** o, fy * 2 ** o); nrm += amp; amp *= 0.5
    return tot / nrm

def write_png(path, arr):
    h, w, _ = arr.shape
    raw = b''.join(b'\x00' + arr[y].tobytes() for y in range(h))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) +
                chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))

def to_u8(c): return (np.clip(c, 0, 1) * 255 + 0.5).astype(np.uint8)
Q = 256  # quadrant size inside each 512 map

def q_stone():
    rng = np.random.default_rng(11); Y, X = np.mgrid[0:Q, 0:Q] / Q
    m = fbm(rng, Q, 6, 6, 4); s = fbm(rng, Q, 3, 14, 3)
    col = np.array([0.50, 0.48, 0.43]) * (0.78 + 0.45 * m)[..., None]
    col = col * (1 - 0.12 * np.clip((s - 0.5) * 4, -1, 1))[..., None]                     # faint strata
    col = col + np.array([0.06, 0.03, -0.01]) * (fbm(rng, Q, 4, 4, 2) - 0.5)[..., None] * 2  # warm/cool drift
    sp = rng.random((Q, Q)); col = np.where((sp > 0.985)[..., None], col * 0.45, col); col = np.where((sp < 0.012)[..., None], col * 1.35 + 0.05, col)
    cr = fbm(rng, Q, 5, 5, 3); crack = np.clip((0.018 - np.abs(cr - 0.5)) / 0.012, 0, 1) * (fbm(rng, Q, 3, 3, 2) > 0.5)
    col = col * (1 - 0.3 * crack)[..., None]
    return col

def q_iron():
    rng = np.random.default_rng(23)
    m = fbm(rng, Q, 8, 8, 4); pits = fbm(rng, Q, 24, 24, 2)
    col = np.array([0.20, 0.21, 0.27]) * (0.75 + 0.5 * m)[..., None]
    col = col * (1 - 0.35 * np.clip((0.42 - pits) * 6, 0, 1))[..., None]
    fl = rng.random((Q, Q)); col = np.where((fl > 0.992)[..., None], np.array([0.78, 0.80, 0.86]), col)
    col = col + np.array([0.05, 0.04, 0.0]) * np.clip((fbm(rng, Q, 3, 3, 2) - 0.55) * 4, 0, 1)[..., None]  # faint warm temper
    return col

def q_oak():
    rng = np.random.default_rng(37); Y, X = np.mgrid[0:Q, 0:Q] / Q
    warp = fbm(rng, Q, 3, 6, 3); g = np.sin((Y * 38 + warp * 6) * math.pi * 2) * 0.5 + 0.5
    fine = fbm(rng, Q, 2, 60, 2)
    base = np.array([0.56, 0.36, 0.19]); dark = np.array([0.33, 0.19, 0.09])
    t = np.clip(g ** 3 * 0.8 + (fine - 0.5) * 0.9, 0, 1)[..., None]
    col = base * (1 - t) + dark * t
    col = col * (0.85 + 0.3 * fbm(rng, Q, 2, 8, 3))[..., None]
    kr = np.random.default_rng(5)
    for _ in range(3):
        cx, cy = kr.uniform(0.15, 0.85, 2); rx = kr.uniform(0.035, 0.05); ry = rx * 0.55
        d = np.sqrt(((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2); ring = (0.5 + 0.5 * np.sin(d * 9))[..., None]
        m = np.clip(1.4 - d, 0, 1)[..., None]; col = col * (1 - m * 0.85) + (dark * (0.6 + 0.6 * ring)) * m * 0.85
    return col

def q_leather():
    rng = np.random.default_rng(41)
    peb = fbm(rng, Q, 40, 40, 2); m = fbm(rng, Q, 5, 5, 3); sc = fbm(rng, Q, 9, 3, 3)
    col = np.array([0.46, 0.25, 0.12]) * (0.8 + 0.35 * m)[..., None] * (0.9 + 0.2 * peb)[..., None]
    scuff = np.clip((sc - 0.62) * 5, 0, 1)[..., None]; col = col * (1 - scuff) + np.array([0.66, 0.45, 0.27]) * scuff
    return col

def q_gemglow():
    rng = np.random.default_rng(53); Y, X = np.mgrid[0:Q, 0:Q] / Q
    h = 1 - Y; teal = np.array([0.05, 0.62, 0.58]); amber = np.array([1.0, 0.58, 0.12])
    t = np.clip((h - 0.35) * 1.8 + 0.25 * (fbm(rng, Q, 4, 2, 3) - 0.5), 0, 1)[..., None]
    col = teal * (1 - t) + amber * t
    streak = fbm(rng, Q, 12, 2, 2); col = col * (0.55 + 0.65 * streak)[..., None]
    return col

def q_veins():
    rng = np.random.default_rng(67)
    n1 = fbm(rng, Q, 5, 5, 4); n2 = fbm(rng, Q, 9, 9, 3); mask = np.clip((fbm(rng, Q, 3, 3, 2) - 0.38) * 4, 0, 1)
    v = np.clip((0.022 - np.abs(n1 - 0.5)) / 0.022, 0, 1) ** 1.5 + 0.6 * np.clip((0.012 - np.abs(n2 - 0.5)) / 0.012, 0, 1) ** 2
    v = np.clip(v * mask, 0, 1); st = (rng.random((Q, Q)) > 0.9965).astype(float) * 0.9
    glow = np.array([0.40, 0.88, 1.0]); return glow * np.clip(v + st, 0, 1)[..., None]

def q_apple():
    rng = np.random.default_rng(71)
    st = fbm(rng, Q, 16, 3, 4); bl = fbm(rng, Q, 2, 2, 2)
    yel = np.array([0.80, 0.66, 0.18]); red = np.array([0.66, 0.06, 0.04]); deep = np.array([0.42, 0.03, 0.04])
    Y = np.mgrid[0:Q, 0:Q][0] / Q; t = np.clip((st - 0.40) * 2.6 + (bl - 0.5) * 2.2 + 0.55 + 0.25 * np.sin(Y * math.pi), 0, 1)[..., None]
    col = yel * (1 - t) + red * t; col = col * (1 - 0.35 * np.clip((st - 0.62) * 5, 0, 1))[..., None] + deep * 0.35 * np.clip((st - 0.62) * 5, 0, 1)[..., None]
    lent = rng.random((Q, Q)) > 0.993; col = np.where(lent[..., None], col * 0.6 + np.array([0.9, 0.8, 0.5]) * 0.4, col)
    return col

def q_linen():
    rng = np.random.default_rng(83); Y, X = np.mgrid[0:Q, 0:Q]
    w = (0.5 + 0.5 * np.sin(X * math.pi / 2.0)) * (0.5 + 0.5 * np.sin(Y * math.pi / 2.0 + 1.5))
    col = np.array([0.80, 0.70, 0.52]) * (0.82 + 0.18 * w)[..., None] * (0.85 + 0.25 * fbm(rng, Q, 6, 6, 3))[..., None]
    return col

def atlas(qs):
    img = np.zeros((2 * Q, 2 * Q, 3))
    for k, q in enumerate(qs):
        r, c = divmod(k, 2); img[r * Q:(r + 1) * Q, c * Q:(c + 1) * Q] = q
    return to_u8(img)

def quv(q, s, t):
    """quadrant-local (s right, t down from top of image) -> Blender UV. q: 0 TL,1 TR,2 BL,3 BR"""
    s = clamp(s, 0.03, 0.97); t = clamp(t, 0.03, 0.97); r, c = divmod(q, 2)
    return ((c + s) * 0.5, 1 - (r + t) * 0.5)

def box_uv(q, p, n, scale, off=(0, 0, 0)):
    ax = max(range(3), key=lambda a: abs(n[a]))
    a, b = [(p.z, p.y), (p.x, p.z), (p.x, p.y)][ax]
    return quv(q, 0.5 + (a + off[0]) / scale, 0.5 - (b + off[1]) / scale)

# ---------------------------------------------------------------- mesh builder
class MB:
    def __init__(self):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.new('UVMap')
        lay = self.bm.loops.layers; self.col = (getattr(lay, 'float_color', None) or lay.color).new('Color'); self.cache = {}
    def vert(self, p):
        b = B(p); k = (round(b.x, 6), round(b.y, 6), round(b.z, 6))
        v = self.cache.get(k)
        if v is None: v = self.bm.verts.new(b); self.cache[k] = v
        return v
    def face(self, pts, ref, uvs, cols, mat=0, smooth=True, outward=None):
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if len(pts) == 4: n = (pts[2] - pts[0]).cross(pts[3] - pts[1])
        c = sum(pts, Vector()) / len(pts); idx = list(range(len(pts)))
        want = outward if outward is not None else (c - ref)
        if n.dot(want) < 0: idx.reverse()
        vs = [self.vert(pts[i]) for i in idx]
        if len(set(vs)) < len(vs): return
        try: f = self.bm.faces.new(vs)
        except ValueError: return
        f.smooth = smooth; f.material_index = mat
        for lp, i in zip(f.loops, idx): lp[self.uv].uv = uvs[i]; lp[self.col] = rgba(cols[i])
    def build(self, name, mats, parent, loc=None, scale=1.0):
        if scale != 1.0: bmesh.ops.scale(self.bm, vec=(scale,) * 3, verts=self.bm.verts)
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free()
        for m in mats: me.materials.append(m)
        me.color_attributes.active_color = me.color_attributes['Color']; me.color_attributes.render_color_index = 0
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.parent = parent
        if loc is not None: ob.location = B(loc)
        return ob

ICO = {}
def ico(sub):
    if sub not in ICO:
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0); bm.verts.ensure_lookup_table()
        ICO[sub] = ([v.co.copy() for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces]); bm.free()
    return ICO[sub]

def rock_blob(seed, sub, R, scale, cuts, soft, bumpy):
    """Displaced icosphere with plane-cut fracture facets. Returns (P list, faces, curvature list, normals approx)."""
    rng = random.Random(seed); verts, faces = ico(sub)
    planes = []
    for _ in range(cuts):
        n = Vector((rng.uniform(-1, 1), rng.uniform(-0.6, 1), rng.uniform(-1, 1))).normalized(); planes.append((n, rng.uniform(0.62, 0.86)))
    planes.append((Vector((0, -1, 0)), 0.55))   # flat-ish resting base
    P = []
    for u in verts:
        q = Vector((u.x, u.y, u.z)) * (1 + bumpy * N3(u, 2.1, seed * 0.13) + bumpy * 0.45 * N3(u, 5.3, seed * 0.29))
        for n, d in planes:
            e = q.dot(n) - d
            if e > 0: q = q - n * e * soft
        P.append(Vector((q.x * scale[0] * R, q.y * scale[1] * R, q.z * scale[2] * R)))
    nb = [set() for _ in P]
    for f in faces:
        for i in f:
            nb[i].update(j for j in f if j != i)
    ctr = sum(P, Vector()) / len(P); curv = []
    for i, p in enumerate(P):
        avg = sum((P[j] for j in nb[i]), Vector()) / len(nb[i]); nrm = (p - ctr).normalized()
        curv.append((p - avg).dot(nrm) / (R * 0.06))   # >0 convex edge, <0 crevice
    return P, faces, curv, ctr

def drop_to_ground(P):
    y0 = min(p.y for p in P); return [Vector((p.x, p.y - y0, p.z)) for p in P]

def chamfer_box(mb, ctr, half, rot, c, mat, q, colfn, uvscale, jitter=0.0, seed=0, smooth=False, skip=()):
    hx, hy, hz = half; c = min(c, hx * 0.45, hy * 0.45, hz * 0.45)
    def P(v):
        if jitter:
            v = v + Vector((N3(v, 31, seed), N3(v, 29, seed + 3), N3(v, 27, seed + 7))) * jitter
        return ctr + rot @ v
    corner = {}
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                corner[(sx, sy, sz)] = [P(Vector((sx * hx, sy * (hy - c), sz * (hz - c)))), P(Vector((sx * (hx - c), sy * hy, sz * (hz - c)))), P(Vector((sx * (hx - c), sy * (hy - c), sz * hz)))]
    def emit(pts, kind, axisn):
        n = rot @ axisn
        if any(n.dot(rot @ Vector(s)) > 0.9 for s in skip): return
        uvs = [box_uv(q, p - ctr, rot.inverted() @ n if False else n, uvscale, (ctr.x * 0.7 + ctr.z * 0.3, ctr.y * 0.9)) for p in pts]
        mb.face(pts, ctr, uvs, [colfn(p, n, kind) for p in pts], mat, smooth)
    for ax in range(3):
        for s in (-1, 1):
            pts = []
            o1, o2 = [a for a in range(3) if a != ax]
            for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                key = [0, 0, 0]; key[ax] = s; key[o1] = a; key[o2] = b; pts.append(corner[tuple(key)][ax])
            nv = Vector((0, 0, 0)); nv[ax] = s; emit(pts, 'face', nv)
    for a1 in range(3):
        for a2 in range(a1 + 1, 3):
            a3 = 3 - a1 - a2
            for s1 in (-1, 1):
                for s2 in (-1, 1):
                    k0 = [0, 0, 0]; k0[a1] = s1; k0[a2] = s2; k0[a3] = -1; k1 = list(k0); k1[a3] = 1
                    pts = [corner[tuple(k0)][a1], corner[tuple(k0)][a2], corner[tuple(k1)][a2], corner[tuple(k1)][a1]]
                    nv = Vector((0, 0, 0)); nv[a1] = s1; nv[a2] = s2; emit(pts, 'edge', nv.normalized())
    for k, cv in corner.items(): emit(cv, 'edge', Vector(k).normalized())

def tube(mb, pts, radii, sides, colfn, mat, q, uv_len, smooth=True, cap=True):
    n = len(pts); ts = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    ref = Vector((0, 1, 0)) if abs(ts[0].y) < 0.9 else Vector((1, 0, 0)); Nn = ts[0].cross(ref).normalized()
    rings = []; vs = [0.0]
    for i in range(n):
        t = ts[i]; Nn = (Nn - t * Nn.dot(t)).normalized(); Bv = t.cross(Nn)
        rings.append([(pts[i] + (Nn * math.cos(2 * math.pi * j / sides) + Bv * math.sin(2 * math.pi * j / sides)) * radii[i], Nn * math.cos(2 * math.pi * j / sides) + Bv * math.sin(2 * math.pi * j / sides)) for j in range(sides)])
        if i: vs.append(vs[-1] + (pts[i] - pts[i - 1]).length / uv_len)
    for i in range(n - 1):
        for j in range(sides):
            j2 = (j + 1) % sides; qd = [rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]]
            uvs = [quv(q, (j + (1 if k in (1, 2) else 0)) / sides, (vs[i] if k < 2 else vs[i + 1]) % 1.0) for k in range(4)]
            mb.face([x[0] for x in qd], (pts[i] + pts[i + 1]) * 0.5, uvs, [colfn(x[0], x[1], i / (n - 1)) for x in qd], mat, smooth)
    if cap:
        for end, sg in ((0, -1), (n - 1, 1)):
            ap = pts[end] + ts[end] * sg * radii[end] * 0.4
            for j in range(sides):
                j2 = (j + 1) % sides
                mb.face([rings[end][j][0], rings[end][j2][0], ap], pts[end] - ts[end] * sg, [quv(q, 0.5, 0.5)] * 3, [colfn(rings[end][j][0], ts[end] * sg, end / (n - 1))] * 3, mat, smooth)

def lathe(mb, prof, segs, rfn, colfn, uvfn, mat, smooth=True):
    """prof: list of (r, y) from bottom pole to top. rfn(a, i) radial multiplier."""
    rows = []
    for i, (r, y) in enumerate(prof):
        row = []
        for j in range(segs):
            a = 2 * math.pi * j / segs; rr = r * rfn(a, i)
            row.append(Vector((math.cos(a) * rr, y, math.sin(a) * rr)))
        rows.append(row)
    axis_ctr = lambda i: Vector((0, prof[i][1], 0))
    for i in range(len(prof) - 1):
        for j in range(segs):
            j2 = (j + 1) % segs; pts = [rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]]
            js = [j, j + 1, j + 1, j]; iis = [i, i, i + 1, i + 1]
            out = None
            mid = (pts[0] + pts[2]) * 0.5; radial = Vector((mid.x, 0, mid.z))
            dy = prof[i + 1][1] - prof[i][1]; dr = prof[i + 1][0] - prof[i][0]
            out = radial.normalized() * dy - Vector((0, 1, 0)) * dr if radial.length > 1e-6 else Vector((0, -1 if i == 0 else 1, 0))
            if out.length < 1e-9: out = Vector((0, 1, 0))
            mb.face(pts, None, [uvfn(js[k] / segs, iis[k]) for k in range(4)], [colfn(pts[k], iis[k], js[k] / segs) for k in range(4)], mat, smooth, outward=out)
    return rows

# ---------------------------------------------------------------- assets
TEAL = (0.10, 0.78, 0.72); AMBER = (1.0, 0.62, 0.16)

def crystal(mb, base, d, L, r, seed, mat, sides=6):
    rng = random.Random(seed); d = d.normalized(); ref = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    e1 = d.cross(ref).normalized(); e2 = d.cross(e1); dl = math.radians(9); ph = rng.uniform(0, 1)
    angs = []
    for k in range(sides):
        a = 2 * math.pi * (k + ph) / sides; angs += [a - dl, a + dl]
    jr = [rng.uniform(0.88, 1.12) for _ in range(sides)]
    levels = [(-0.06, 0.92), (0.45, 1.04), (0.74, 0.98)]
    rings = []
    for h, k in levels:
        ring = []
        for m, a in enumerate(angs):
            rr = r * k * jr[(m + 1) // 2 % sides]
            ring.append(base + d * (L * h) + (e1 * math.cos(a) + e2 * math.sin(a)) * rr)
        rings.append(ring)
    apex = base + d * L + (e1 * rng.uniform(-0.25, 0.25) + e2 * rng.uniform(-0.25, 0.25)) * r
    nside = len(angs)
    def col(p, chamf, fside):
        h = clamp((p - base).dot(d) / L); c = mixc(TEAL, AMBER, clamp(h * 1.25 - 0.15) ** 1.3)
        lit = 0.80 + 0.28 * math.cos(fside * 2 * math.pi / nside * 2 + seed)
        if chamf: lit = 1.45
        return mulc(c, lit)
    for li in range(len(rings) - 1):
        for m in range(nside):
            m2 = (m + 1) % nside; ch = (m % 2 == 0)
            pts = [rings[li][m], rings[li][m2], rings[li + 1][m2], rings[li + 1][m]]
            hs = [levels[li][0], levels[li][0], levels[li + 1][0], levels[li + 1][0]]
            ss = [m / nside, (m + 1) / nside, (m + 1) / nside, m / nside]
            mb.face(pts, base + d * (L * 0.5), [quv(0, 0.1 + 0.8 * ss[k], 1 - clamp(hs[k])) for k in range(4)], [col(p, ch, m) for p in pts], mat, False)
    for m in range(nside):
        m2 = (m + 1) % nside; ch = (m % 2 == 0)
        mb.face([rings[-1][m], rings[-1][m2], apex], base + d * (L * 0.5), [quv(0, 0.1 + 0.8 * m / nside, 0.26), quv(0, 0.1 + 0.8 * (m + 1) / nside, 0.26), quv(0, 0.5, 0.04)],
                [col(rings[-1][m], ch, m), col(rings[-1][m2], ch, m), mulc(AMBER, 1.25)], mat, False)
    return apex

def rock_into(mb, P, faces, curv, ctr, mat, q, uvscale, colfn, smooth=True):
    for f in faces:
        pts = [P[i] for i in f]; n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        if n.dot(sum(pts, Vector()) / 3 - ctr) < 0: n = -n
        mb.face(pts, ctr, [box_uv(q, p - ctr, n, uvscale) for p in pts], [colfn(P[i], curv[i], i) for i in f], mat, smooth)

def stone_col(p, cv, i, top_y, moss=True):
    g = clamp(0.80 + 0.16 * cv, 0.45, 1.18)
    c = (g, g * 0.98, g * 0.94)
    if moss:
        m = clamp((p.y / top_y - 0.62) * 3.0 + 0.9 * N3(p, 22, 3.0)) * clamp(1 + cv * 0.4)
        c = mixc(c, (0.42, 0.62, 0.22), m * 0.85)
        lich = clamp((N3(p, 55, 9.0) - 0.42) * 6) * (1 - m)
        c = mixc(c, (1.25, 1.18, 0.82), lich * 0.6)
    c = mulc(c, lerp(0.62, 1.0, clamp(p.y / (top_y * 0.35))))   # ground contact AO
    return c

def build_star_gem(root, M):
    mb = MB()
    P, faces, curv, ctr = rock_blob(5, 3, 0.085, (1.0, 0.42, 0.9), 6, 0.8, 0.18); P = drop_to_ground(P); ctr = sum(P, Vector()) / len(P)
    ty = max(p.y for p in P)
    rock_into(mb, P, faces, curv, ctr, 1, 0, 0.26, lambda p, cv, i: mulc(stone_col(p, cv, i, ty, moss=False), 0.92))
    specs = [((0.0, 0.0), (0.06, 1, -0.04), 0.225, 0.034), ((0.035, 0.012), (0.75, 0.9, -0.2), 0.13, 0.022), ((-0.04, 0.0), (-0.8, 0.95, 0.15), 0.12, 0.021),
             ((0.005, 0.03), (0.15, 0.85, 0.75), 0.105, 0.019), ((-0.01, -0.035), (-0.25, 0.8, -0.8), 0.095, 0.018), ((0.06, -0.03), (0.9, 0.4, -0.5), 0.06, 0.012),
             ((-0.065, 0.035), (-0.85, 0.45, 0.6), 0.055, 0.011)]
    apex = None
    for k, ((x, z), d, L, r) in enumerate(specs):
        a = crystal(mb, Vector((x, ty * 0.55, z)), Vector(d), L, r, 100 + k, 0)
        if k == 0: apex = a
    ob = mb.build('StarGemMesh', [M['gem'], M['stone']], root)
    return dict(grip=(0, 0.11, 0), pivot=(0, 0.12, 0), extra=dict(glow_tip=[round(apex.x, 3), round(apex.y, 3), round(apex.z, 3)]))

def build_star_iron(root, M):
    mb = MB()
    P, faces, curv, ctr = rock_blob(17, 4, 0.115, (1.0, 0.66, 0.78), 9, 0.92, 0.16); P = drop_to_ground(P); ctr = sum(P, Vector()) / len(P)
    ty = max(p.y for p in P)
    def ic(p, cv, i):
        g = clamp(0.78 + 0.30 * cv, 0.40, 1.35); c = (g * 0.96, g, g * 1.08)    # convex edges catch silver, crevices sink
        c = mulc(c, lerp(0.6, 1.0, clamp(p.y / (ty * 0.4)))); return c
    rock_into(mb, P, faces, curv, ctr, 0, 1, 0.30, ic)
    rng = random.Random(4)
    for k in range(3):   # embedded star-glass shards: celestial read even at RTS distance
        u = Vector((rng.uniform(-1, 1), rng.uniform(0.2, 1), rng.uniform(-1, 1))).normalized()
        best = max(P, key=lambda p: (p - ctr).normalized().dot(u)); d = (best - ctr).normalized()
        crystal(mb, best - d * 0.012, d, rng.uniform(0.035, 0.05), rng.uniform(0.008, 0.011), 300 + k, 1)
    mb.build('StarIronMesh', [M['iron'], M['gem']], root)
    return dict(grip=(0, round(ty * 0.5, 3), 0), pivot=(0, round(ty * 0.5, 3), 0), extra=dict(mass_hint_kg=6.5))

def build_stone(root, M):
    mb = MB()
    P, faces, curv, ctr = rock_blob(29, 4, 0.135, (1.0, 0.68, 0.82), 7, 0.75, 0.13); P = drop_to_ground(P); ctr = sum(P, Vector()) / len(P)
    ty = max(p.y for p in P)
    rock_into(mb, P, faces, curv, ctr, 0, 0, 0.34, lambda p, cv, i: stone_col(p, cv, i, ty))
    mb.build('StoneChunkMesh', [M['stone']], root)
    return dict(grip=(0, round(ty * 0.5, 3), 0), pivot=(0, round(ty * 0.5, 3), 0), extra=dict(mass_hint_kg=4.0))

def build_apple(root, M):
    mb = MB(); H = 0.144; R = 0.077; segs = 22
    prof = []
    for i in range(15):
        t = i / 14; th = t * math.pi
        r = R * math.sin(th) * (1 - 0.18 * t * t) * (1 + 0.06 * math.sin(th))
        y = H * 0.5 * (1 - math.cos(th))
        if t < 0.14: y += 0.012 * (1 - t / 0.14); r *= 0.9      # calyx dimple
        if t > 0.86: y -= 0.022 * ((t - 0.86) / 0.14) ** 0.8   # stem cavity
        prof.append((max(r, 0.0015), y))
    prof[0] = (0.003, 0.010); prof[-1] = (0.003, H - 0.020)
    def rfn(a, i):
        t = i / 14; return 1 + 0.035 * math.cos(5 * a + 0.4) * math.sin(t * math.pi) ** 0.5 * (1 - t) + 0.02 * math.sin(2 * a + 1.0)
    def col(p, i, s):
        t = i / 14; side = 0.5 + 0.5 * math.cos(s * 2 * math.pi + 2.2)
        k = 0.88 + 0.22 * side
        c = (k, k, k)
        if t > 0.8: c = mixc(c, (0.80, 1.05, 0.50), clamp((t - 0.8) * 5) * 0.8)   # green-gold stem cavity
        if t < 0.15: c = mixc(c, (0.55, 0.45, 0.30), clamp((0.15 - t) * 8) * 0.7)
        return mulc(c, lerp(0.7, 1.0, clamp(p.y / 0.04)))
    lathe(mb, prof, segs, rfn, col, lambda s, i: quv(2, s, 0.1 + 0.8 * i / 14), 0)
    # stem
    top = Vector((0, H - 0.020, 0)); sp = [top + Vector((0.0, -0.004, 0)), top + Vector((0.002, 0.014, 0.001)), top + Vector((0.006, 0.027, 0.002)), top + Vector((0.013, 0.036, 0.003))]
    tube(mb, sp, [0.0042, 0.0036, 0.0031, 0.0030], 6, lambda p, o, t: mixc((0.42, 0.30, 0.16), (0.55, 0.45, 0.22), t), 1, 2, 0.05)
    # leaf: folded blade on midrib, double-sided material
    lb = sp[2]; dirv = Vector((-0.75, 0.22, -0.62)).normalized(); side = dirv.cross(Vector((0, 1, 0))).normalized(); up = side.cross(dirv).normalized()
    if up.y < 0: up = -up
    Ll = 0.078; W = 0.026; nseg = 7
    mid = []; lft = []; rgt = []
    for k in range(nseg + 1):
        t = k / nseg; w = W * math.sin(math.pi * t ** 0.85) * (1 - 0.15 * t)
        c = lb + dirv * (Ll * t) + up * (-0.018 * t * t) + side * 0.004 * math.sin(t * 3)
        mid.append(c); lft.append(c + side * w + up * (0.006 * w / W)); rgt.append(c - side * w + up * (0.006 * w / W) + up * (-0.002 * t))
    lt = lambda k, e: mixc((0.20, 0.42, 0.10), (0.40, 0.62, 0.16), clamp(k / nseg * 0.5 + e))
    for k in range(nseg):
        for edge, sd in ((lft, 0.35), (rgt, 0.15)):
            pts = [mid[k], mid[k + 1], edge[k + 1], edge[k]]
            mb.face(pts, None, [quv(2, 0.5, 0.5)] * 4, [lt(k, 0.0), lt(k + 1, 0.0), lt(k + 1, sd), lt(k, sd)], 1, True, outward=up)
    # five dried sepals in calyx
    for k in range(5):
        a = k * 2 * math.pi / 5 + 0.3; c0 = Vector((0, 0.012, 0)); tip = Vector((math.cos(a) * 0.011, 0.004, math.sin(a) * 0.011))
        s2 = Vector((-math.sin(a), 0, math.cos(a))) * 0.003
        mb.face([c0 + s2, tip, c0 - s2], None, [quv(2, 0.5, 0.95)] * 3, [(0.30, 0.22, 0.12)] * 3, 1, False, outward=Vector((0, -1, 0)))
    mb.build('OrchardAppleMesh', [M['apple'], M['leaf']], root)
    return dict(grip=(0, 0.072, 0), pivot=(0, 0.075, 0), extra=dict(mass_hint_kg=0.18))

def build_satchel(root, M):
    mb = MB(); segs = 18
    prof = [(0.004, 0.0), (0.105, 0.005), (0.150, 0.028), (0.163, 0.068), (0.152, 0.125), (0.124, 0.180), (0.084, 0.228), (0.048, 0.258), (0.040, 0.276),
            (0.050, 0.292), (0.068, 0.312), (0.080, 0.330), (0.072, 0.338)]
    def rfn(a, i):
        t = prof[i][1]
        gather = 0.0 if t < 0.2 else clamp((t - 0.2) / 0.08)
        wr = clamp((t - 0.08) / 0.12) * (1 - gather)
        return 1 + 0.22 * gather * math.sin(7 * a) * (1 + 0.3 * math.sin(3 * a)) + 0.05 * wr * math.sin(6 * a + 2 * t * 10) + 0.04 * math.sin(2 * a + 0.5) * (1 - gather) + 0.03 * math.sin(3 * a + 1.3)
    def col(p, i, s):
        g = 0.72 + 0.32 * clamp(p.y / 0.15)
        fold = 0.5 + 0.5 * math.sin(7 * s * 2 * math.pi) if prof[i][1] > 0.24 else (0.5 + 0.5 * math.sin(6 * s * 2 * math.pi + prof[i][1] * 20) if prof[i][1] > 0.09 else 0.6)
        g *= 0.8 + 0.3 * fold
        if i >= 11: g *= 1.15   # sun-bleached rim
        return mulc((g, g * 0.97, g * 0.92), lerp(0.62, 1.0, clamp(p.y / 0.05)))
    lathe(mb, prof, segs, rfn, col, lambda s, i: quv(3, s, 0.05 + 0.9 * i / (len(prof) - 1)), 0)
    # inner lip to hide open top (rim turns inward and down)
    rim = [(0.072, 0.338), (0.055, 0.326), (0.030, 0.296), (0.004, 0.286)]
    rows = []
    for (r, y) in rim:
        rows.append([Vector((math.cos(2 * math.pi * j / segs) * r * rfn(2 * math.pi * j / segs, len(prof) - 1), y, math.sin(2 * math.pi * j / segs) * r * rfn(2 * math.pi * j / segs, len(prof) - 1))) for j in range(segs)])
    for i in range(len(rim) - 1):
        for j in range(segs):
            j2 = (j + 1) % segs; pts = [rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]]
            mb.face(pts, None, [quv(3, j / segs, 0.95)] * 4, [(0.30, 0.18, 0.10)] * 4, 0, True, outward=Vector((0, 1, 0)))
    # cord: two wraps round the neck plus a hanging bow-tail, linen material
    cp = []
    for k in range(37):
        a = k / 36 * 4 * math.pi; y = 0.272 + 0.012 * k / 36
        cp.append(Vector((math.cos(a) * 0.047, y, math.sin(a) * 0.047)))
    cord = lambda p, o, t: mulc((1, 0.97, 0.9), 0.75 + 0.3 * (0.5 + 0.5 * o.y))
    tube(mb, cp, [0.0085] * len(cp), 6, cord, 1, 3, 0.03)
    fr = Vector((0, 0.278, -0.05))
    for k, sg in enumerate((1, -1)):
        tp = [fr, fr + Vector((0.018 * sg, -0.02, -0.012)), fr + Vector((0.026 * sg, -0.06, -0.016)), fr + Vector((0.02 * sg, -0.098 + 0.02 * k, -0.012))]
        tube(mb, tp, [0.0075, 0.0068, 0.006, 0.0055], 6, cord, 1, 3, 0.03)
    knot = [fr + Vector((-0.012, 0, 0.004)), fr + Vector((0.012, 0.002, -0.004))]
    tube(mb, knot, [0.012, 0.012], 6, cord, 1, 3, 0.03)
    # three spilled star-brass coins (treasure read at distance)
    for k, (x, z, tilt, a) in enumerate(((-0.17, -0.09, 0.0, 0.3), (-0.12, -0.15, 0.0, 1.2), (-0.145, -0.115, 0.55, 2.0))):
        rot = Matrix.Rotation(a, 3, 'Y') @ Matrix.Rotation(tilt, 3, 'X'); ctrv = Vector((x, 0.0045 + (0.012 if tilt else 0), z))
        rr = 0.022; n = 10; top = []; bot = []
        for j in range(n):
            an = 2 * math.pi * j / n; top.append(ctrv + rot @ Vector((math.cos(an) * rr, 0.0035, math.sin(an) * rr))); bot.append(ctrv + rot @ Vector((math.cos(an) * rr, -0.0035, math.sin(an) * rr)))
        bc = lambda hi: (1.15, 0.86, 0.40) if hi else (0.95, 0.70, 0.30)
        for j in range(n):
            j2 = (j + 1) % n
            mb.face([bot[j], bot[j2], top[j2], top[j]], ctrv, [quv(0, 0.5, 0.5)] * 4, [bc(True)] * 4, 2, False)
        for ring, up in ((top, 1), (bot, -1)):
            c2 = ctrv + rot @ Vector((0, 0.0035 * up, 0))
            for j in range(n):
                j2 = (j + 1) % n; mb.face([ring[j], ring[j2], c2], ctrv, [quv(0, 0.5, 0.5)] * 3, [bc(False), bc(False), bc(True)], 2, False)
    S = 1.13; mb.build('TreasureSatchelMesh', [M['leather'], M['linen'], M['brass']], root, scale=S)
    return dict(grip=(0, round(0.282 * S, 3), 0), pivot=(0, round(0.16 * S, 3), 0), extra=dict(grip_note='Grip at tied neck (hand closes round cord)', mass_hint_kg=2.2))

def build_coffer(root, M):
    W, D, Hb = 0.56, 0.38, 0.26; R = D / 2; t = 0.026; mb = MB(); lid = MB(); rng = random.Random(8)
    I = Matrix.Identity(3)
    def wood(p, n, kind):
        g = 0.86 + 0.14 * clamp(n.y + 0.5) + (0.28 if kind == 'edge' else 0.0)
        g *= lerp(0.66, 1.0, clamp(p.y / 0.08))
        return (g, g * 0.97, g * 0.92)
    def brass(p, n, kind):
        g = 0.82 + (0.40 if kind == 'edge' else 0.0) + 0.1 * n.y
        tarn = clamp(0.5 + 1.4 * N3(p, 18, 2.0)) * (0 if kind == 'edge' else 1)
        return mixc((g * 1.0, g * 0.74, g * 0.36), (0.42, 0.40, 0.26), tarn * 0.3)
    ft = 0.03   # feet lift body
    # body planks: front/back three horizontal planks, sides three, bottom
    ph = (Hb - 0.0) / 3
    for zs in (-1, 1):
        for k in range(3):
            cy = ft + ph * (k + 0.5); j = rng.uniform(-0.004, 0.004)
            chamfer_box(mb, Vector((0, cy, zs * (D / 2 - t / 2))), (W / 2, ph / 2 - 0.002, t / 2), Matrix.Rotation(j * 0.3, 3, 'Z'), 0.006, 0, 2, wood, 0.7, 0.0015, 10 + k * 2 + zs)
    for xs in (-1, 1):
        for k in range(3):
            cy = ft + ph * (k + 0.5)
            chamfer_box(mb, Vector((xs * (W / 2 - t / 2), cy, 0)), (t / 2, ph / 2 - 0.002, D / 2 - t), I, 0.006, 0, 2, wood, 0.7, 0.0015, 40 + k + xs)
    chamfer_box(mb, Vector((0, ft + 0.01, 0)), (W / 2 - t, 0.01, D / 2 - t), I, 0.004, 0, 2, wood, 0.7, skip=((0, -1, 0),))
    # lid (separate node, hinge at back top edge): five curved planks + end caps
    hinge = Vector((0, ft + Hb, D / 2)); lc = Vector((0, ft + Hb, 0))
    def L(p): return p - hinge   # lid geometry relative to hinge node
    n_pl = 5
    for k in range(n_pl):
        a = math.pi * (k + 0.5) / n_pl; w = 2 * R * math.sin(math.pi / n_pl / 2) * 0.98
        ctr = lc + Vector((0, math.sin(a) * (R - t / 2) * 0.62, -math.cos(a) * (R - t / 2)))
        ty, tz = math.cos(a) * 0.62, math.sin(a)   # ellipse tangent; plank local +Z follows it
        chamfer_box(lid, L(ctr), (W / 2, t / 2, w / 2 + 0.002), Matrix.Rotation(math.atan2(-ty, tz), 3, 'X'), 0.006, 0, 2, wood, 0.7, 0.0015, 70 + k)
    for xs in (-1, 1):   # end caps: half-ellipse prisms
        n = 8; x0 = xs * (W / 2 - t / 2); arc = []
        for k in range(n + 1):
            a = math.pi * k / n; arc.append(Vector((0, math.sin(a) * (R - t) * 0.62, -math.cos(a) * (R - t))))
        for k in range(n):
            for (xa, xb) in ((x0 - t / 2, x0 + t / 2),):
                pass
        for side in (-1, 1):
            xx = x0 + side * t / 2; c0 = lc + Vector((xx, 0.0, 0))
            for k in range(n):
                pts = [L(c0), L(lc + Vector((xx, 0, 0)) + arc[k]), L(lc + Vector((xx, 0, 0)) + arc[k + 1])]
                lid.face(pts, None, [box_uv(2, p, Vector((1, 0, 0)), 0.7) for p in pts], [wood(p, Vector((0, 0.3, 0)), 'face') for p in pts], 0, False, outward=Vector((side, 0, 0)))
        for k in range(n):
            pa = lc + Vector((x0 - t / 2, 0, 0)) + arc[k]; pb = lc + Vector((x0 + t / 2, 0, 0)) + arc[k]
            pc = lc + Vector((x0 + t / 2, 0, 0)) + arc[k + 1]; pd = lc + Vector((x0 - t / 2, 0, 0)) + arc[k + 1]
            pts = [L(pa), L(pb), L(pc), L(pd)]; nrm = ((arc[k] + arc[k + 1]) * 0.5).normalized()
            lid.face(pts, None, [box_uv(2, p, nrm, 0.7) for p in pts], [wood(p, nrm, 'edge') for p in pts], 0, False, outward=nrm)
    # brass bands over lid (segments) + straps down body
    for bx in (-W * 0.30, W * 0.30):
        n = 6
        for k in range(n):
            a0 = math.pi * k / n; a1 = math.pi * (k + 1) / n
            p0 = lc + Vector((bx, math.sin(a0) * (R + 0.002) * 0.62, -math.cos(a0) * (R + 0.002))); p1 = lc + Vector((bx, math.sin(a1) * (R + 0.002) * 0.62, -math.cos(a1) * (R + 0.002)))
            mid = (p0 + p1) * 0.5; dv = (p1 - p0); ang = math.atan2(dv.y, dv.z)
            chamfer_box(lid, L(mid), (0.021, 0.0045, dv.length / 2 + 0.003), Matrix.Rotation(-ang, 3, 'X'), 0.0, 1, 2, brass, 0.7)
        for zs in (-1, 1):
            chamfer_box(mb, Vector((bx, ft + Hb / 2, zs * (D / 2 + 0.003))), (0.021, Hb / 2, 0.0045), I, 0.0, 1, 2, brass, 0.7)
    # corner brackets
    for xs in (-1, 1):
        for zs in (-1, 1):
            chamfer_box(mb, Vector((xs * (W / 2 - 0.025), ft + Hb / 2, zs * (D / 2 + 0.004))), (0.03, Hb / 2 + 0.004, 0.004), I, 0.0, 1, 2, brass, 0.7)
            chamfer_box(mb, Vector((xs * (W / 2 + 0.004), ft + Hb / 2, zs * (D / 2 - 0.025))), (0.004, Hb / 2 + 0.004, 0.03), I, 0.0, 1, 2, brass, 0.7)
            chamfer_box(mb, Vector((xs * (W / 2 - 0.03), ft * 0.5, zs * (D / 2 - 0.03))), (0.03, ft / 2, 0.03), I, 0.006, 1, 2, brass, 0.7)  # feet
    # lock plate + hasp
    chamfer_box(mb, Vector((0, ft + Hb - 0.05, -(D / 2 + 0.006))), (0.05, 0.045, 0.006), I, 0.004, 1, 2, brass, 0.7)
    chamfer_box(mb, Vector((0, ft + Hb - 0.06, -(D / 2 + 0.0125))), (0.006, 0.014, 0.001), I, 0.0, 1, 2, lambda p, n, k: (0.08, 0.06, 0.05), 0.7)  # keyhole
    chamfer_box(lid, L(lc + Vector((0, 0.012, -(R + 0.007)))), (0.022, 0.035, 0.004), I, 0.0, 1, 2, brass, 0.7)
    # side handles
    for xs in (-1, 1):
        x = xs * (W / 2 + 0.012); pts = []
        for k in range(7):
            a = math.pi * k / 6; pts.append(Vector((x + xs * 0.022 * math.sin(a), ft + Hb * 0.62 - 0.03 * math.sin(a), -math.cos(a) * 0.06)))
        tube(mb, pts, [0.0065] * 7, 6, lambda p, o, tt: (1.0, 0.76, 0.38), 1, 2, 0.1)
        for zs in (-1, 1):
            chamfer_box(mb, Vector((xs * (W / 2 + 0.006), ft + Hb * 0.62, zs * 0.06)), (0.006, 0.02, 0.016), I, 0.0, 1, 2, brass, 0.7)
    mb.build('CofferBodyMesh', [M['oak'], M['brass']], root)
    lroot = bpy.data.objects.new('LidHinge', None); bpy.context.scene.collection.objects.link(lroot); lroot.parent = root; lroot.location = B(hinge)
    lroot.empty_display_type = 'SINGLE_ARROW'; lroot.empty_display_size = 0.1
    lid.build('CofferLidMesh', [M['oak'], M['brass']], lroot)
    top = ft + Hb + R * 0.62
    return dict(grip=(0, round(top, 3), -0.02), pivot=(0, round((ft + Hb + R * 0.62) / 2, 3), 0),
                extra=dict(lid_hinge=[0, round(hinge.y, 3), round(hinge.z, 3)], lid_open_axis='rotate LidHinge about its local +X (glTF/Godot right-handed); positive angle lifts the front, ~1.9 rad fully open',
                           loot_anchor=[0, round(ft + 0.04, 3), 0], grip_note='Grip on lid crown (two-hand lift / RTS selection)', mass_hint_kg=14))

ASSETS = [
    ('star_gem', 'StarGem', build_star_gem, 0.25, 'height'),
    ('star_iron_nugget', 'StarIronNugget', build_star_iron, 0.22, 'max'),
    ('stone_chunk', 'StoneChunk', build_stone, 0.25, 'max'),
    ('orchard_apple', 'OrchardApple', build_apple, 0.16, 'height'),
    ('treasure_satchel', 'TreasureSatchel', build_satchel, 0.40, 'max'),
    ('reward_coffer', 'RewardCoffer', build_coffer, 0.65, 'max'),
]

# ---------------------------------------------------------------- materials / export
def make_mat(name, img=None, rough=0.6, metal=0.0, emit_img=None, emit_strength=0.0, double=False, base=None):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear(); m.use_backface_culling = not double
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled')
    bs.inputs['Roughness'].default_value = rough; bs.inputs['Metallic'].default_value = metal
    nt.links.new(bs.outputs[0], out.inputs[0])
    ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Color'; src = ca.outputs['Color']
    if img:
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1.0
        nt.links.new(tx.outputs['Color'], mx.inputs[6]); nt.links.new(ca.outputs['Color'], mx.inputs[7]); src = mx.outputs[2]
    nt.links.new(src, bs.inputs['Base Color'])
    if emit_img:
        et = nt.nodes.new('ShaderNodeTexImage'); et.image = emit_img; nt.links.new(et.outputs['Color'], bs.inputs['Emission Color'])
        bs.inputs['Emission Strength'].default_value = emit_strength
    return m

def export(root, path):
    bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
    for c in root.children_recursive: c.select_set(True)
    bpy.context.view_layer.objects.active = root
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_cameras=False, export_lights=False,
              export_image_format='JPEG', export_jpeg_quality=88, export_extras=True)
    bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kw)

def glb_info(path):
    d = open(path, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl]); tris = 0; attrs = set()
    for me in j['meshes']:
        for p in me['primitives']:
            tris += j['accessors'][p['indices']]['count'] // 3; attrs |= set(p['attributes'])
    return dict(file_bytes=len(d), triangles=tris, materials=len(j['materials']), material_names=[m.get('name') for m in j['materials']], images=len(j.get('images', [])),
                image_uris=[im.get('uri') for im in j.get('images', []) if im.get('uri')], nodes=[n.get('name') for n in j['nodes']], attributes=sorted(attrs),
                cameras=len(j.get('cameras', [])), lights=bool(j.get('extensions', {}).get('KHR_lights_punctual')), extensions_used=j.get('extensionsUsed', []))

def bbox_game(objs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        if o.type != 'MESH': continue
        mw = o.matrix_world
        for v in o.data.vertices:
            w = mw @ v.co; g = Vector((w.x, w.z, -w.y)); lo = Vector(map(min, lo, g)); hi = Vector(map(max, hi, g))
    return lo, hi

# ---------------------------------------------------------------- renders
def setup_studio(samples):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4; sc.render.resolution_percentage = 100; sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new('Studio_World'); w.use_nodes = True; bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.55, 0.70, 0.95, 1); bg.inputs[1].default_value = 0.85; sc.world = w
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=30, fill_type='NGON'); gr = bpy.context.active_object; gr.name = 'Studio_Ground'
    gm = bpy.data.materials.new('Studio_Meadow'); gm.use_nodes = True; bsd = gm.node_tree.nodes['Principled BSDF']
    bsd.inputs['Base Color'].default_value = (0.16, 0.30, 0.06, 1); bsd.inputs['Roughness'].default_value = 0.95; gr.data.materials.append(gm)
    sun = bpy.data.objects.new('Studio_Sun', bpy.data.lights.new('Studio_Sun', 'SUN')); sun.data.energy = 3.6; sun.data.angle = 0.12; sun.data.color = (1.0, 0.92, 0.78)
    sc.collection.objects.link(sun); sun.location = B((-4, 8, -6)); sun.rotation_euler = (B((0, 0, 0)) - sun.location).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.objects.new('Studio_Cam', bpy.data.cameras.new('Studio_Cam')); sc.collection.objects.link(cam); sc.camera = cam
    return sc, cam

def shoot(sc, cam, path, cp, tp, lens, rx, ry):
    sc.render.resolution_x = rx; sc.render.resolution_y = ry; cam.data.lens = lens
    cam.location = B(cp); cam.rotation_euler = (B(tp) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    sc.render.filepath = path; t = time.time(); bpy.ops.render.render(write_still=True); log('render', os.path.basename(path), '%.1fs' % (time.time() - t))
    im = bpy.data.images.load(path); a = np.array(im.pixels[:]).reshape(ry, rx, 4)[::-1, :, :3]; bpy.data.images.remove(im); return a

def label(arr, text_rows):  # tiny no-font marker strip: coloured bar per tile keeps sheet dependency-free
    return arr

def render_all(out, samples, roots, stats):
    sc, cam = setup_studio(samples); rdir = os.path.join(out, 'renders'); os.makedirs(rdir, exist_ok=True)
    xs = dict(star_gem=-1.15, star_iron_nugget=-0.78, stone_chunk=-0.40, orchard_apple=-0.07, treasure_satchel=0.30, reward_coffer=0.92)
    for nm, r in roots.items(): r.location = B((xs.get(nm, 0), 0, 0)); r.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    eye = shoot(sc, cam, os.path.join(rdir, 'lineup_ground_eye.png'), (-0.08, 0.40, -2.6), (-0.08, 0.22, 0), 28, 800, 400)
    rts = shoot(sc, cam, os.path.join(rdir, 'lineup_rts.png'), (-0.1, 3.0, -2.3), (-0.1, 0.05, 0), 35, 800, 400)
    write_png(os.path.join(out, 'contact_sheet.png'), to_u8(np.concatenate([eye, rts], 0)))
    tiles = []
    for nm, r in roots.items():
        lo, hi = stats[nm]['bbox_min'], stats[nm]['bbox_max']; c = Vector(((lo[0] + hi[0]) / 2 + xs[nm], (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2))
        md = max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]); d = md * 2.3
        tiles.append(shoot(sc, cam, os.path.join(rdir, 'close_%s.png' % nm), (c.x - d * 0.55, c.y + d * 0.45, c.z - d * 0.75), (c.x, c.y, c.z), 50, 400, 400))
    while len(tiles) % 3: tiles.append(np.zeros_like(tiles[0]))
    rows = [np.concatenate(tiles[i:i + 3], 1) for i in range(0, len(tiles), 3)]
    write_png(os.path.join(out, 'closeups_sheet.png'), to_u8(np.concatenate(rows, 0)))
    for r in roots.values(): r.location = (0, 0, 0)

# ---------------------------------------------------------------- main
def main():
    o = parse_args(); out = o['out']; os.makedirs(out, exist_ok=True); tdir = os.path.join(out, 'textures'); os.makedirs(tdir, exist_ok=True)
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob)
    t = time.time(); write_png(os.path.join(tdir, 'props_albedo_a.png'), atlas([q_stone(), q_iron(), q_oak(), q_leather()])); TIMES['texture_albedo_a_s'] = round(time.time() - t, 2)
    t = time.time(); write_png(os.path.join(tdir, 'props_atlas_b.png'), atlas([q_gemglow(), q_veins(), q_apple(), q_linen()])); TIMES['texture_atlas_b_s'] = round(time.time() - t, 2)
    log('textures', TIMES)
    ia = bpy.data.images.load(os.path.join(tdir, 'props_albedo_a.png')); ib = bpy.data.images.load(os.path.join(tdir, 'props_atlas_b.png'))
    t = time.time()
    M = dict(stone=make_mat('Stone', ia, 0.92), iron=make_mat('StarIron', ia, 0.45, 0.8, ib, 3.0), gem=make_mat('StarGem', None, 0.16, 0.0, ib, 2.2),
             apple=make_mat('AppleSkin', ib, 0.36), leaf=make_mat('LeafStem', None, 0.6, double=True), oak=make_mat('Oak', ia, 0.72),
             brass=make_mat('Brass', None, 0.34, 0.92), leather=make_mat('Leather', ia, 0.62), linen=make_mat('Linen', ib, 0.9))
    TIMES['materials_s'] = round(time.time() - t, 3)
    contract = dict(kit='brann_resource_treasure_kit', version=1, units='metres', up='+Y', front='-Z', origin='bottom centre (rests on y=0)',
                    vertex_colors='COLOR_0 is a linear multiplier on base colour (AO/edge wear/moss/blush). Godot: vertex_color_use_as_albedo=true.',
                    sockets=dict(Grip='hand/attachment socket (+Y up, -Z front); centre of mass unless noted', ResourcePivot='visual centre for spin/bob/pickup pop and floating reward display'),
                    textures=dict(props_albedo_a=dict(size=512, quadrants=['stone', 'star_iron', 'oak', 'leather']), props_atlas_b=dict(size=512, quadrants=['gem_glow(emissive)', 'iron_veins(emissive)', 'apple_skin(albedo)', 'linen(albedo)'])),
                    budgets=dict(triangles=1500, materials=3, shared_maps=2, map_size=512), assets={}, timings=TIMES)
    roots = {}; stats = {}
    for fname, rname, fn, target, measure in ASSETS:
        if o['only'] and fname not in o['only']: continue
        t = time.time(); root = bpy.data.objects.new(rname, None); bpy.context.scene.collection.objects.link(root)
        info = fn(root, M)
        for sk, key in (('Grip', 'grip'), ('ResourcePivot', 'pivot')):
            e = bpy.data.objects.new(sk, None); e.empty_display_type = 'ARROWS'; e.empty_display_size = 0.05; bpy.context.scene.collection.objects.link(e); e.parent = root; e.location = B(info[key])
        bpy.context.view_layer.update()
        path = os.path.join(out, fname + '.glb'); export(root, path); gi = glb_info(path)
        lo, hi = bbox_game([root] + list(root.children_recursive)); dims = hi - lo
        meas = dims.y if measure == 'height' else max(dims)
        gi.update(bbox_min=[round(x, 4) for x in lo], bbox_max=[round(x, 4) for x in hi], dimensions=[round(x, 4) for x in dims], target_size_m=target, target_measure=measure,
                  measured_size_m=round(meas, 4), sockets=dict(Grip=list(info['grip']), ResourcePivot=list(info['pivot'])), **info.get('extra', {}),
                  budget_ok=dict(triangles=gi['triangles'] <= 1650, materials=gi['materials'] <= 3, no_camera_light=not gi['cameras'] and not gi['lights'], embedded=not gi['image_uris']),
                  build_s=round(time.time() - t, 2))
        stats[fname] = gi; contract['assets'][fname] = gi; TIMES['asset_%s_s' % fname] = gi['build_s']
        log('export', fname, gi['triangles'], 'tris', gi['file_bytes'], 'bytes', 'size', round(meas, 3))
        for ob in [root] + list(root.children_recursive):
            ob.name = fname + ':' + ob.name
            if ob.type == 'MESH': ob.data.name = ob.name
        roots[fname] = root
    json.dump(contract, open(os.path.join(out, 'resource_contract.json'), 'w', encoding='utf-8'), indent=1)
    if o['render']:
        t = time.time(); render_all(out, o['samples'], roots, stats); TIMES['render_s'] = round(time.time() - t, 1)
        json.dump(contract, open(os.path.join(out, 'resource_contract.json'), 'w', encoding='utf-8'), indent=1)
    for i, r in enumerate(roots.values()): r.location = B((i * 0.8 - 2.0, 0, 0))
    for ob in [x for x in bpy.data.objects if x.name.startswith('Studio_')]: bpy.data.objects.remove(ob)
    bpy.ops.file.pack_all(); bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'source.blend'))
    log('done total %.1fs' % (time.time() - T0))

main()
