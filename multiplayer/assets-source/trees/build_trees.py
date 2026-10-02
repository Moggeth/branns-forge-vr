"""Brann's Forge orchard tree kit. Blender 4.5.
blender --background --factory-startup --python-exit-code 2 --python build_trees.py -- --out ABS_DIR [--no-render] [--samples N]
Authoring is done in glTF space (x right, y up, -z front) and converted to Blender Z-up by B().
"""
import bpy, bmesh, sys, os, json, math, random, zlib, struct, time
import numpy as np
from mathutils import Vector, Matrix, noise as mnoise

T0 = time.time()
def log(*a): print('[trees %.1fs]' % (time.time() - T0), *a, flush=True)

def parse_args():
    argv = sys.argv; argv = argv[argv.index('--') + 1:] if '--' in argv else []
    o = dict(out=None, render=True, samples=40); i = 0
    while i < len(argv):
        if argv[i] == '--out': o['out'] = argv[i + 1]; i += 2
        elif argv[i] == '--no-render': o['render'] = False; i += 1
        elif argv[i] == '--samples': o['samples'] = int(argv[i + 1]); i += 2
        else: i += 1
    if not o['out'] or not os.path.isabs(o['out']): raise SystemExit('--out ABS_PATH required')
    return o

def B(p): return Vector((p[0], -p[2], p[1]))
def clamp(x, a=0.0, b=1.0): return max(a, min(b, x))
def lerp(a, b, t): return a + (b - a) * t

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

def tex_bark(size=512):
    rng = np.random.default_rng(101)
    Y, X = np.mgrid[0:size, 0:size] / size
    streak = fbm(rng, size, 18, 3, 4); n = fbm(rng, size, 10, 2, 3)
    crack = np.clip((0.05 - np.abs(n - 0.5)) / 0.03, 0, 1) * np.clip((fbm(rng, size, 3, 5, 2) - 0.38) * 6, 0, 1)
    plate = fbm(rng, size, 6, 10, 3)
    dark = np.array([0.30, 0.19, 0.12]); mid = np.array([0.55, 0.38, 0.23]); hi = np.array([0.74, 0.55, 0.34])
    t = np.clip(streak * 1.5 - 0.25, 0, 1)[..., None]
    col = dark * (1 - t) + mid * t
    ridge = np.clip((plate - 0.5) * 2.4, 0, 1)[..., None]
    col = col * (1 - ridge * 0.55) + hi * ridge * 0.55
    col = col * (1 - crack[..., None]) + np.array([0.20, 0.09, 0.05]) * crack[..., None]
    kr = np.random.default_rng(7)
    for _ in range(6):
        cx, cy = kr.uniform(0.12, 0.88, 2); rx = kr.uniform(0.05, 0.08); ry = rx * 1.6
        d = np.sqrt(((X - cx) / rx) ** 2 + ((Y - cy) / ry) ** 2)
        m = np.clip(1.6 - d, 0, 1)[..., None]; ring = (0.5 + 0.5 * np.sin(d * 10))[..., None]
        kn = np.array([0.20, 0.11, 0.07]) * (0.7 + 0.5 * ring) + np.array([0.55, 0.32, 0.15]) * np.clip(0.5 - d, 0, 1)[..., None]
        col = col * (1 - m * 0.9) + kn * m * 0.9
    mv = fbm(rng, size, 3, 3, 3); mask = np.clip((mv - 0.56) * 5, 0, 1) * (0.35 + 0.65 * (ridge[..., 0] * 0.6 + 0.4))
    moss = np.array([0.32, 0.50, 0.16]) * (0.8 + 0.5 * fbm(rng, size, 40, 40, 2))[..., None]
    col = col * (1 - mask[..., None] * 0.85) + moss * mask[..., None] * 0.85
    col = col * (0.92 + 0.16 * fbm(rng, size, 64, 64, 2))[..., None]
    return to_u8(col)

def tex_leaf(size=512):
    rng = np.random.default_rng(202); pr = np.random.default_rng(5)
    bg = np.array([0.08, 0.26, 0.09]) * (0.8 + 0.5 * fbm(rng, size, 8, 8, 3))[..., None]
    img = bg.copy(); zone = fbm(rng, size, 4, 4, 3)
    pal = [np.array(c) for c in ([0.10, 0.34, 0.12], [0.20, 0.50, 0.13], [0.32, 0.62, 0.15], [0.50, 0.74, 0.18], [0.66, 0.82, 0.28])]
    for p in range(2):
        for _ in range(520):
            cx, cy = pr.uniform(0, size, 2); th = pr.uniform(0, math.pi); L = pr.uniform(15, 30); W = L * pr.uniform(0.32, 0.46)
            zv = zone[int(cy) % size, int(cx) % size]
            idx = clamp(zv * 3.0 + pr.uniform(-0.6, 0.6) + (1.3 if p else 0.0), 0, 3.99)
            c0 = pal[int(idx)]; c = c0 * (1 - (idx % 1)) + pal[int(idx) + 1] * (idx % 1)
            r = pr.random()
            if r < 0.02: c = np.array([0.86, 0.70, 0.18])
            elif r < 0.03: c = np.array([0.80, 0.42, 0.10])
            R = int(L) + 2; ys = (np.arange(-R, R + 1) + int(cy)) % size; xs = (np.arange(-R, R + 1) + int(cx)) % size
            gy, gx = np.mgrid[-R:R + 1, -R:R + 1]
            u = gx * math.cos(th) + gy * math.sin(th); v = -gx * math.sin(th) + gy * math.cos(th)
            shape = (u / L) ** 2 + (v / (W * (1 - 0.5 * (u / L) ** 2 + 0.5 * (u / L) * 0.8) + 1e-6)) ** 2
            m = (shape < 1.0).astype(float); rim = np.clip((shape - 0.6) * 2.2, 0, 1)
            shade = (1.0 + 0.28 * v / W - 0.32 * rim)[..., None]
            leaf = c[None, None, :] * shade; leaf = np.where((np.abs(v) < 0.8)[..., None] & (np.abs(u) < L * 0.9)[..., None], leaf * 0.78 + 0.05, leaf)
            sub = img[np.ix_(ys, xs)]; img[np.ix_(ys, xs)] = sub * (1 - m[..., None]) + leaf * m[..., None]
    img = img * (0.94 + 0.12 * fbm(rng, size, 32, 32, 2))[..., None]
    return to_u8(img)

def tex_endgrain(size=512):
    rng = np.random.default_rng(303)
    Y, X = np.mgrid[0:size, 0:size] / size
    w1 = fbm(rng, size, 5, 5, 3) - 0.5; w2 = fbm(rng, size, 9, 9, 3) - 0.5
    cx = 0.5 + 0.03 * w1; cy = 0.5 + 0.03 * w2
    dx = X - cx + 0.05 * w2; dy = Y - cy + 0.05 * w1; r = np.sqrt(dx ** 2 + dy ** 2) / 0.5
    ang = np.arctan2(dy, dx)
    ph = r * 13 + 1.1 * (fbm(rng, size, 6, 6, 3) - 0.5)
    ring = 0.5 + 0.5 * np.sin(ph * 2 * math.pi)
    heart = np.array([0.66, 0.40, 0.19]); sap = np.array([0.90, 0.70, 0.40]); line = np.array([0.46, 0.26, 0.11])
    base = heart * (1 - np.clip((r - 0.45) * 3, 0, 1))[..., None] + sap * np.clip((r - 0.45) * 3, 0, 1)[..., None]
    col = base * (1 - 0.45 * (ring ** 3))[..., None] + line * (0.45 * ring ** 3)[..., None] * 0.6
    cr = np.abs(np.sin(ang * 3.5 + 6 * (fbm(rng, size, 4, 4, 2) - 0.5)))
    crack = np.clip((0.06 - cr) / 0.04, 0, 1) * np.clip((r - 0.08) * 2, 0, 1) * (fbm(rng, size, 6, 6, 2) > 0.45)
    col = col * (1 - 0.8 * crack)[..., None]
    col = np.where((r < 0.035)[..., None], np.array([0.30, 0.16, 0.08]), col)
    bark = np.array([0.30, 0.19, 0.12]) * (0.8 + 0.5 * fbm(rng, size, 20, 20, 2))[..., None]
    rim = np.clip((r - 0.93) * 25, 0, 1)[..., None]
    col = col * (1 - rim) + bark * rim
    col = col * (0.94 + 0.12 * fbm(rng, size, 64, 64, 2))[..., None]
    return to_u8(col)

# ---------------------------------------------------------------- mesh builder
class MB:
    def __init__(self):
        self.bm = bmesh.new(); self.uv = self.bm.loops.layers.uv.new('UVMap')
        lay = self.bm.loops.layers
        self.col = (getattr(lay, 'float_color', None) or lay.color).new('Color')
        self.cache = {}
    def vert(self, p):
        b = B(p); k = (round(b.x, 5), round(b.y, 5), round(b.z, 5))
        v = self.cache.get(k)
        if v is None: v = self.bm.verts.new(b); self.cache[k] = v
        return v
    def face(self, pts, ref, uvs, cols, mat=0, smooth=True):
        n = (pts[2] - pts[0]).cross(pts[1] - pts[0]) * -1 if len(pts) == 3 else (pts[2] - pts[0]).cross(pts[3] - pts[1])
        if len(pts) == 3: n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        c = sum(pts, Vector()) / len(pts)
        idx = list(range(len(pts)))
        if n.dot(c - ref) < 0: idx.reverse()
        vs = [self.vert(pts[i]) for i in idx]
        if len(set(vs)) < len(vs): return
        try: f = self.bm.faces.new(vs)
        except ValueError: return
        f.smooth = smooth; f.material_index = mat
        for lp, i in zip(f.loops, idx):
            lp[self.uv].uv = uvs[i]; lp[self.col] = cols[i]
    def build(self, name, mats, parent):
        me = bpy.data.meshes.new(name); self.bm.to_mesh(me); self.bm.free()
        for m in mats: me.materials.append(m)
        try:
            me.color_attributes.active_color = me.color_attributes['Color']; me.color_attributes.render_color_index = 0
        except Exception: pass
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob); ob.parent = parent
        return ob

def tube(mb, pts, radii, sides, uvu, vlen, colfn, mat=0, tip=True, smooth=True):
    n = len(pts); ts = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    ref = Vector((0, 1, 0)) if abs(ts[0].y) < 0.9 else Vector((1, 0, 0)); N = ts[0].cross(ref).normalized()
    rings = []; outs = []; vs = [0.0]
    for i in range(n):
        t = ts[i]; N = (N - t * N.dot(t)).normalized(); Bv = t.cross(N); ring = []; oo = []
        for j in range(sides):
            a = 2 * math.pi * j / sides; o = N * math.cos(a) + Bv * math.sin(a); oo.append(o); ring.append(pts[i] + o * radii[i])
        rings.append(ring); outs.append(oo)
        if i: vs.append(vs[-1] + (pts[i] - pts[i - 1]).length / vlen)
    for i in range(n - 1):
        for j in range(sides):
            j2 = (j + 1) % sides
            q = [rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]]
            u0 = j / sides * uvu; u1 = (j + 1) / sides * uvu
            uv = [(u0, vs[i]), (u1, vs[i]), (u1, vs[i + 1]), (u0, vs[i + 1])]
            cl = [colfn(q[0], outs[i][j]), colfn(q[1], outs[i][j2]), colfn(q[2], outs[i + 1][j2]), colfn(q[3], outs[i + 1][j])]
            mb.face(q, (pts[i] + pts[i + 1]) * 0.5, uv, cl, mat, smooth)
    if tip:
        ap = pts[-1] + ts[-1] * radii[-1] * 1.3
        for j in range(sides):
            j2 = (j + 1) % sides
            mb.face([rings[-1][j], rings[-1][j2], ap], pts[-1], [((j) / sides * uvu, vs[-1]), ((j + 1) / sides * uvu, vs[-1]), ((j + .5) / sides * uvu, vs[-1] + 0.05)],
                    [colfn(rings[-1][j], outs[-1][j]), colfn(rings[-1][j2], outs[-1][j2]), colfn(ap, ts[-1])], mat, smooth)
    return rings

def cap_fan(mb, ring, centre, normal, mat, col=(1, 1, 1, 1), centre_pt=None):
    cp = centre_pt if centre_pt is not None else centre
    e1 = (ring[0] - centre).normalized(); e2 = normal.cross(e1).normalized()
    rr = sum(((p - centre).length for p in ring)) / len(ring)
    def uvf(p): d = p - centre; return (0.5 + d.dot(e1) / (2 * rr), 0.5 + d.dot(e2) / (2 * rr))
    for j in range(len(ring)):
        j2 = (j + 1) % len(ring)
        mb.face([ring[j], ring[j2], cp], centre - normal * 0.2, [uvf(ring[j]), uvf(ring[j2]), uvf(cp)], [col] * 3, mat, False)

def bark_vc(p, o):
    u = (o.y + 1) * 0.5; g = 0.70 + 0.30 * u
    return (g, g * (1.0 + 0.06 * u), g * 0.92, 1.0)

# ---------------------------------------------------------------- icosphere templates
ICO = {}
def ico(sub):
    if sub not in ICO:
        bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0); bm.verts.ensure_lookup_table()
        ICO[sub] = ([v.co.copy() for v in bm.verts], [[v.index for v in f.verts] for f in bm.faces]); bm.free()
    return ICO[sub]

def leaf_mass(mb, c, R, sc, rot, sub, off, top, tint, inner):
    verts, faces = ico(sub); P = []; Cn = []
    for u in verts:
        n1 = mnoise.noise(u * 1.6 + off); n2 = mnoise.noise(u * 3.7 + off * 1.7 + Vector((5, 5, 5)))
        d = max(0.55, 1 + 0.32 * n1 + 0.14 * n2)
        lobe = max(0.0, mnoise.noise(u * 2.3 + off * 0.6 + Vector((9, 1, 3))))
        q = Vector((u.x * sc[0], u.y * sc[1], u.z * sc[2])) * d
        if u.y < 0: q.y -= 0.45 * lobe * (-u.y) * sc[1]
        else: q.y *= 1.0 + 0.08 * n2
        q = rot @ q; p = c + q * R; P.append(p)
        qn = q.normalized(); lift = clamp((p.y - 2.4) / max(0.5, top - 2.4)); outer = clamp(math.hypot(p.x, p.z) / 2.6)
        light = 0.46 + 0.20 * lift + 0.12 * outer + (0.50 * qn.y if qn.y > 0 else 0.52 * qn.y)
        if inner: light *= 0.72
        light = clamp(light, 0.30, 1.15); warm = clamp(0.5 * qn.y + 0.5 * lift)
        Cn.append((light * (1 + 0.10 * warm) * tint[0], light * tint[1], light * (1 - 0.30 * warm) * tint[2], 1.0))
    for f in faces:
        pts = [P[i] for i in f]; fn = (pts[1] - pts[0]).cross(pts[2] - pts[0]).normalized()
        ax = max(range(3), key=lambda a: abs(fn[a])); s = 0.42
        def proj(p):
            a, b = [(p.z, p.y), (p.x, p.z), (p.x, p.y)][ax]
            return (a * s + off.x * 0.37, b * s + off.y * 0.41)
        mb.face(pts, c, [proj(p) for p in pts], [Cn[i] for i in f], 0, False)

def apple(mb, c, r, tone):
    verts, faces = ico(2); P = []; C = []
    for u in verts:
        y = u.y * r * 0.88
        if u.y > 0.8: y -= 0.5 * r * (u.y - 0.8)
        p = c + Vector((u.x * r, y, u.z * r)); P.append(p)
        k = 0.5 + 0.5 * u.y; C.append((0.55 + 0.25 * tone * k + 0.2 * k, 0.03 + 0.35 * tone * k * k, 0.02, 1.0))
    for f in faces: mb.face([P[i] for i in f], c, [(0, 0)] * 3, [C[i] for i in f], 0, True)

# ---------------------------------------------------------------- tree plan (shared by hi and LOD)
def make_rad(P):
    r2 = P['r2']; rb = P['rb']; fork = P['fork']; rf = r2 * 0.72; rfl = r2 * 1.22
    def rad(y):
        if y <= 0: return rb
        if y < 0.3: t = y / 0.3; s = t * t * (3 - 2 * t); return rb + (rfl - rb) * s
        if y <= 2.0: return rfl + (r2 - rfl) * ((y - 0.3) / 1.7)
        return r2 + (rf - r2) * min(1.0, (y - 2.0) / (fork - 2.0))
    return rad

def plan_tree(P):
    rng = random.Random(P['seed']); rad = make_rad(P); top = P['top']; fork = P['fork']; lf = P['leaf']
    ph0 = P['seed'] * 0.37
    def axis(y):
        s = max(0.0, y - 2.0) / (top - 2.0)
        return (P['lean'][0] * s * s + P['wig'] * math.sin(s * 3.3 + ph0) * s, P['lean'][1] * s * s + P['wig'] * math.cos(s * 2.7 + ph0 * 1.3) * s)
    pl = dict(P=P, rad=rad, axis=axis, limbs=[], subs=[], twigs=[], clusters=[], fruit=[], roots=[])
    # leader
    y0 = fork - 0.25; ys = [lerp(y0, top, i / 7) for i in range(8)]
    lp = [Vector((axis(y)[0], y, axis(y)[1])) for y in ys]; rs0 = rad(y0) * 0.97
    pl['leader'] = (lp, [(rs0 - 0.03) * (1 - i / 7) ** 1.15 + 0.03 for i in range(8)])
    topv = lp[-1]
    def cluster(kind, c, R, sc=None, inner=False, lod=True):
        sc = sc or (rng.uniform(1.1, 1.35), rng.uniform(0.62, 0.8), rng.uniform(1.05, 1.3))
        rot = Matrix.Rotation(rng.uniform(0, 6.28), 3, 'Y') @ Matrix.Rotation(rng.uniform(-0.25, 0.25), 3, 'X')
        off = Vector((rng.uniform(0, 40), rng.uniform(0, 40), rng.uniform(0, 40)))
        tint = (1 + rng.uniform(-0.08, 0.08), 1 + rng.uniform(-0.04, 0.04), 1 + rng.uniform(-0.1, 0.1))
        pl['clusters'].append(dict(kind=kind, c=c, R=R, sc=sc, rot=rot, off=off, tint=tint, inner=inner, lod=lod))
    n = P['limbs']; lo, hi = P['first'], P['hi']
    hs = sorted(lo + (hi - lo) * ((i + 0.5) / n) + rng.uniform(-0.08, 0.08) for i in range(n))
    for i in range(n):
        f = i / max(1, n - 1); h = hs[i]; az = P['az0'] + i * 2.39996 + rng.uniform(-0.3, 0.3)
        asym = 1 + P['asym'] * math.cos(az - P['asym_az'])
        L = P['reach'] * (1.0 - 0.45 * f) * rng.uniform(0.9, 1.1) * asym
        el0 = math.radians(28 + 24 * f + rng.uniform(-6, 6)); droop = math.radians(34 - 22 * f); lift = math.radians(22)
        m = 6; ph = rng.uniform(0, 6.28); wa = rng.uniform(0.15, 0.4); cx, cz = axis(h)
        p = Vector((cx + math.cos(az) * 0.03, h, cz + math.sin(az) * 0.03)); pts = [p]
        for k in range(m):
            t = (k + 0.5) / m; el = el0 - droop * t * t * 1.2 + lift * math.sin(t * math.pi * 0.9); a = az + wa * math.sin(t * 4 + ph)
            p = p + Vector((math.cos(el) * math.cos(a), math.sin(el), math.cos(el) * math.sin(a))) * (L / m); pts.append(p)
        r0 = P['limb_r'] * (1 - 0.3 * f); radii = [lerp(r0, 0.022, (k / m) ** 0.8) for k in range(m + 1)]
        pl['limbs'].append(dict(pts=pts, radii=radii, y=h, az=az)); tip = pts[-1]; out = Vector((math.cos(az), 0, math.sin(az)))
        cluster('major', tip + out * 0.15 + Vector((0, 0.12, 0)), rng.uniform(0.82, 1.05) * lf * (0.8 + 0.2 * L / P['reach']))
        cluster('minor', pts[3] + Vector((0, 0.28, 0)), rng.uniform(0.5, 0.6) * lf, inner=True, lod=False)
        sub_ts = [0.45, 0.72] + ([0.3] if f < 0.4 else [])
        ends = [(tip, az, 0.9, pts, radii)]
        for si, t in enumerate(sub_ts):
            k = round(t * m); base = pts[k]; sgn = 1 if (i + si) % 2 else -1; az2 = az + sgn * rng.uniform(0.6, 1.1); el2 = math.radians(rng.uniform(10, 35))
            L2 = L * rng.uniform(0.38, 0.52) * (1 - 0.3 * t); m2 = 4; q = base; sp = [q]
            for kk in range(m2):
                tt = (kk + 0.5) / m2; e = el2 - math.radians(18) * tt
                q = q + Vector((math.cos(e) * math.cos(az2), math.sin(e), math.cos(e) * math.sin(az2))) * (L2 / m2); sp.append(q)
            rb = radii[k] * 0.6; sr = [lerp(rb, 0.014, (kk / m2) ** 0.8) for kk in range(m2 + 1)]
            pl['subs'].append(dict(pts=sp, radii=sr))
            if si < 2: cluster('minor', q + Vector((0, 0.1, 0)), rng.uniform(0.46, 0.6) * lf)
            ends.append((q, az2, 0.85, sp, sr))
        for ei, (e, a, _, _, _) in enumerate(ends):
            if ei not in (0, 2): continue
            d0 = (Vector((math.cos(a), 0, math.sin(a))) * 0.45 + Vector((0, -0.9, 0))).normalized(); lt = rng.uniform(0.55, 0.85)
            q = e; tp = [q]
            for kk in range(3):
                d = (d0 + Vector((rng.uniform(-0.15, 0.15), 0, rng.uniform(-0.15, 0.15)))).normalized(); q = q + d * (lt / 3); tp.append(q)
            pl['twigs'].append(dict(pts=tp, radii=[0.02, 0.014, 0.009, 0.005]))
            cluster('tuft', tp[-1] + Vector((0, -0.1, 0)), 0.2 * lf * rng.uniform(0.9, 1.2), sc=(1.0, 1.45, 1.0), lod=False)
    cluster('major', topv + Vector((0, 0.25, 0)), 0.9 * lf, sc=(1.15, 0.78, 1.15))
    for s in (1, -1):
        cluster('major', topv + Vector((0.75 * s, -0.4, 0.45 * -s)), 0.66 * lf)
    for li in (1, max(1, n - 3)):
        L_ = pl['limbs'][li]; c = L_['pts'][4] + Vector((0, -0.22, 0))
        for _ in range(4):
            pl['fruit'].append((c + Vector((rng.uniform(-0.14, 0.14), rng.uniform(-0.08, 0.05), rng.uniform(-0.14, 0.14))), rng.uniform(0.06, 0.075) * (0.5 + 0.5 * lf), rng.random()))
    nr = 7
    for i in range(nr):
        pl['roots'].append(dict(az=i * 2 * math.pi / nr + rng.uniform(-0.3, 0.3), L=rng.uniform(0.9, 1.5) * (P['rb'] / 0.42), ph=rng.uniform(0, 6)))
    ws = [c['R'] ** 3 for c in pl['clusters']]; tw = sum(ws)
    pl['crown'] = sum((c['c'] * w for c, w in zip(pl['clusters'], ws)), Vector()) / tw
    pl['top_y'] = max(c['c'].y + c['R'] * c['sc'][1] for c in pl['clusters'] if c['kind'] == 'major')
    pl['fall'] = Vector((topv.x, pl['top_y'], topv.z)); pl['first_branch_y'] = min(l['y'] for l in pl['limbs'])
    return pl

def emit_tree(pl, lod, root, mats):
    P = pl['P']; rad = pl['rad']; axis = pl['axis']; fork = P['fork']; rb = P['rb']
    objs = {}; contour_dev = 0.0; samples = []
    # Trunk: regular horizontal rings, concentric to the Y axis below 2 m
    sides = 8 if lod else 12
    ys = [-0.1, 0.0, 0.3, 1.0, 2.0, fork] if lod else [-0.1, 0.0, 0.12, 0.3, 0.6, 1.0, 1.4, 1.8, 2.0] + list(np.linspace(2.0, fork, 4)[1:])
    ys = [float(y) for y in ys]; tm = MB(); rings = []
    for y in ys:
        cx, cz = axis(y); ring = []; rr = []
        for j in range(sides):
            a = 2 * math.pi * j / sides
            mm = 1 + 0.040 * math.sin(2 * a + 1.3 + 0.7 * y) + 0.025 * math.sin(3 * a + 2.1 + 1.1 * y)
            r = rad(y) * mm; rr.append(r); ring.append(Vector((cx + math.cos(a) * r, y, cz + math.sin(a) * r)))
        contour_dev = max(contour_dev, max(abs(r / rad(y) - 1) for r in rr))
        samples.append(dict(y=round(y, 3), radius_mean=round(sum(rr) / sides, 4), radius_min=round(min(rr), 4), radius_max=round(max(rr), 4),
                            axis_x=round(cx, 4), axis_z=round(cz, 4)))
        rings.append((ring, Vector((cx, y, cz))))
    for i in range(len(ys) - 1):
        y0, y1 = ys[i], ys[i + 1]
        for j in range(sides):
            j2 = (j + 1) % sides
            q = [rings[i][0][j], rings[i][0][j2], rings[i + 1][0][j2], rings[i + 1][0][j]]
            def vc(p, y=None):
                yy = p.y; g = lerp(0.55, 1.0, clamp(yy / 0.45)); mo = clamp(1 - yy / 0.9) * 0.35
                return (g * (1 - 0.3 * mo), g * (1 + 0.05 * mo), g * (1 - 0.4 * mo), 1.0)
            u0 = j / sides * 2; u1 = (j + 1) / sides * 2
            tm.face(q, (rings[i][1] + rings[i + 1][1]) * 0.5, [(u0, y0 / 0.8), (u1, y0 / 0.8), (u1, y1 / 0.8), (u0, y1 / 0.8)], [vc(p) for p in q], 0, True)
    ring, ctr = rings[-1]
    for j in range(sides):
        j2 = (j + 1) % sides
        tm.face([ring[j], ring[j2], ctr + Vector((0, 0.01, 0))], ctr - Vector((0, 1, 0)), [(0, 0)] * 3, [bark_vc(ring[j], Vector((0, 1, 0)))] * 3, 0, True)
    objs['Trunk'] = tm.build('Trunk', [mats['bark']], root)
    # Roots
    rm = MB(); roots = pl['roots'][::2] if lod else pl['roots']; segs = 3 if lod else 5; rs = 5 if lod else 6; k0 = rb / 0.42
    for r in roots:
        pts = []; radii = []
        for k in range(segs + 1):
            t = k / segs; d = 0.10 * k0 + r['L'] * t; a = r['az'] + 0.25 * math.sin(t * 4 + r['ph']) * t
            y = 0.26 * (1 - t) ** 1.6 * k0 / 1.0 - 0.18 * t ** 1.5; pts.append(Vector((math.cos(a) * d, y, math.sin(a) * d))); radii.append(0.12 * k0 * (1 - t) ** 0.8 + 0.03)
        tube(rm, pts, radii, rs, 1, 0.5, lambda p, o: (lambda g: (g * (1 if p.y > 0.05 else 0.7), g * 1.05, g * 0.8, 1.0))(0.7 + 0.3 * (o.y + 1) / 2), 0, True, True)
    objs['Roots'] = rm.build('Roots', [mats['bark']], root)
    # Branches (leader, limbs, sub branches, hanging twigs)
    bm_ = MB(); dec = (lambda a: a[::2] + ([a[-1]] if (len(a) - 1) % 2 else [])) if lod else (lambda a: a)
    bs = 5 if lod else 7
    lp, lr = pl['leader']; tube(bm_, dec(lp), dec(lr), 8 if not lod else 6, 1, 0.5, bark_vc, 0)
    for l in pl['limbs']: tube(bm_, dec(l['pts']), dec(l['radii']), bs, 1, 0.5, bark_vc, 0)
    if not lod:
        for l in pl['subs']: tube(bm_, l['pts'], l['radii'], 6, 1, 0.5, bark_vc, 0)
        for l in pl['twigs']: tube(bm_, l['pts'], l['radii'], 5, 1, 0.5, bark_vc, 0)
    objs['Branches'] = bm_.build('Branches', [mats['bark']], root)
    # Leaves
    lm = MB(); sub_of = dict(major=3, minor=2, tuft=2)
    for c in pl['clusters']:
        if lod and not c['lod']: continue
        sb = sub_of[c['kind']]; R = c['R']
        if lod:
            sb = 2; R *= 1.12
        leaf_mass(lm, c['c'], R, c['sc'], c['rot'], sb, c['off'], P['top'], c['tint'], c['inner'])
    objs['Leaves'] = lm.build('Leaves', [mats['leaf']], root)
    if not lod:
        fm = MB()
        for c, r, tone in pl['fruit']: apple(fm, c, r, tone)
        objs['Fruit'] = fm.build('Fruit', [mats['fruit']], root)
    empties = dict(Ground=Vector((0, 0, 0)), CutGuide=Vector((0, 1.0, 0)), Crown=pl['crown'], FallTip=pl['fall'])
    for nme, pos in empties.items():
        e = bpy.data.objects.new(nme, None); e.empty_display_type = 'PLAIN_AXES'; e.empty_display_size = 0.25
        bpy.context.scene.collection.objects.link(e); e.parent = root; e.location = B(pos); objs[nme] = e
    return objs, dict(samples=samples, contour_dev=contour_dev, empties={k: [round(v.x, 3), round(v.y, 3), round(v.z, 3)] for k, v in empties.items()})

# ---------------------------------------------------------------- log + endcap
def build_log(root, mats):
    mb = MB(); rng = random.Random(9); sides = 16
    ys = [-0.55, -0.52, -0.46, -0.36, -0.24, -0.12, 0.0, 0.12, 0.24, 0.36, 0.46, 0.52, 0.55]
    R0 = 0.16; rings = []; lipr = 0.80
    wob = [rng.uniform(0, 6) for _ in range(3)]
    for yi, y in enumerate(ys):
        taper = lerp(1.03, 0.96, (y + 0.55) / 1.1); cx = 0.018 * math.sin(y * 4.0); cz = 0.012 * math.cos(y * 3.0); ring = []
        lip = 1.0
        if yi in (0, 12): lip = lipr
        elif yi in (1, 11): lip = 0.96
        for j in range(sides):
            a = 2 * math.pi * j / sides
            r = R0 * taper * lip * (1 + 0.035 * math.sin(2 * a + wob[0] + y * 5) + 0.03 * math.sin(3 * a + wob[1] - y * 3))
            r += 0.025 * math.exp(-(((y - 0.14) / 0.09) ** 2) - (((a - 1.0 + math.pi) % (2 * math.pi) - math.pi) / 0.5) ** 2)   # knot bump
            yy = y
            if yi in (0, 12): yy = y + (1 if yi == 0 else -1) * rng.uniform(0, 0.035) * (1 if j % 2 else 0.4)
            ring.append(Vector((cx + math.cos(a) * r, yy, cz + math.sin(a) * r)))
        rings.append((ring, Vector((cx, y, cz))))
    def lvc(p, ctr, y):
        a = math.atan2(p.z - ctr.z, p.x - ctr.x); up = (math.sin(a) + 1) / 2; g = 0.72 + 0.28 * up
        mo = clamp(1 - abs(y + 0.0) / 0.4) * clamp(up * 1.4 - 0.4) * 0.6
        return (g * (1 - 0.3 * mo), g * (1 + 0.1 * mo), g * (1 - 0.4 * mo), 1.0)
    for i in range(len(ys) - 1):
        for j in range(sides):
            j2 = (j + 1) % sides; q = [rings[i][0][j], rings[i][0][j2], rings[i + 1][0][j2], rings[i + 1][0][j]]
            u0 = j / sides * 1.0; u1 = (j + 1) / sides
            mb.face(q, (rings[i][1] + rings[i + 1][1]) * 0.5, [(u0, ys[i] / 0.9), (u1, ys[i] / 0.9), (u1, ys[i + 1] / 0.9), (u0, ys[i + 1] / 0.9)],
                    [lvc(p, rings[i][1], p.y) for p in q], 0, True)
    for end, sgn in ((0, -1), (12, 1)):
        ring, ctr = rings[end]; cp = Vector((ctr.x + rng.uniform(-0.01, 0.01), ctr.y - sgn * 0.02, ctr.z)); cp = Vector((cp.x, ctr.y + sgn * 0.0 + (0.012 * sgn), cp.z))
        cap_fan(mb, ring, ctr, Vector((0, sgn, 0)), 1, centre_pt=cp)
    # two sawn-branch stubs
    for ang, yv in ((2.3, -0.2), (-0.9, 0.22)):
        cy = Vector((0, yv, 0)); d = Vector((math.cos(ang), 0.55, math.sin(ang))).normalized(); st = cy + Vector((math.cos(ang), 0, math.sin(ang))) * 0.13
        sp = [st, st + d * 0.05, st + d * 0.10]; sr = rings_ = tube(mb, sp, [0.05, 0.043, 0.040], 8, 1, 0.3, bark_vc, 0, False, True)
        cap_fan(mb, sr[-1], sp[-1], d, 1)
    ob = mb.build('LogMesh', [mats['bark'], mats['wood']], root); return dict(LogMesh=ob)

def build_endcap(root, mats):
    mb = MB(); rng = random.Random(21); seg = 32; h = 0.0125; edge = [1 + rng.uniform(-0.03, 0.02) for _ in range(seg)]
    def ringpts(r, y, k=1.0):
        return [Vector((math.cos(2 * math.pi * j / seg) * r * (1 if r < 0.9 else edge[j]) * k, y + 0.002 * math.sin(j * 1.7 + r * 5), math.sin(2 * math.pi * j / seg) * r * (1 if r < 0.9 else edge[j]) * k)) for j in range(seg)]
    def uv(p): return (0.5 + p.x * 0.5, 0.5 + p.z * 0.5)
    W = (1, 1, 1, 1)
    for sgn in (1, -1):
        y = h * sgn; r1 = ringpts(0.5, y); r2 = ringpts(1.0, y); cp = Vector((0.0, y + 0.002 * sgn, 0.0)); n = Vector((0, sgn, 0))
        for j in range(seg):
            j2 = (j + 1) % seg
            mb.face([r1[j], r1[j2], cp], Vector((0, -sgn, 0)), [uv(r1[j]), uv(r1[j2]), uv(cp)], [W] * 3, 0, True)
            mb.face([r2[j], r2[j2], r1[j2], r1[j]], Vector((0, -sgn, 0)), [uv(r2[j]), uv(r2[j2]), uv(r1[j2]), uv(r1[j])], [W] * 4, 0, True)
    t = ringpts(1.0, h); b = ringpts(1.0, -h)
    for j in range(seg):
        j2 = (j + 1) % seg
        mb.face([t[j], t[j2], b[j2], b[j]], Vector((0, 0, 0)), [(0.02, 0.02)] * 4, [(0.8, 0.8, 0.8, 1)] * 4, 0, False)
    return dict(EndCapMesh=mb.build('EndCapMesh', [mats['wood']], root))

# ---------------------------------------------------------------- materials / export / contract
def make_mat(name, img, rough, vc='mul'):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial'); bs = nt.nodes.new('ShaderNodeBsdfPrincipled'); bs.inputs['Roughness'].default_value = rough
    nt.links.new(bs.outputs[0], out.inputs[0]); src = None
    if img:
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img; src = tx.outputs['Color']
    if vc:
        ca = nt.nodes.new('ShaderNodeVertexColor'); ca.layer_name = 'Color'
        if src is None: src = ca.outputs['Color']
        else:
            mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs[0].default_value = 1.0
            nt.links.new(src, mx.inputs[6]); nt.links.new(ca.outputs['Color'], mx.inputs[7]); src = mx.outputs[2]
    nt.links.new(src, bs.inputs['Base Color'])
    return m

def export(root, path):
    bpy.ops.object.select_all(action='DESELECT'); root.select_set(True)
    for c in root.children_recursive: c.select_set(True)
    bpy.context.view_layer.objects.active = root
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_apply=False, export_cameras=False, export_lights=False,
              export_image_format='JPEG', export_jpeg_quality=85)
    try: bpy.ops.export_scene.gltf(export_vertex_color='ACTIVE', **kw)
    except TypeError: bpy.ops.export_scene.gltf(**kw)

def glb_info(path):
    d = open(path, 'rb').read(); jl = struct.unpack('<I', d[12:16])[0]; j = json.loads(d[20:20 + jl]); tris = 0
    attrs = set()
    for me in j['meshes']:
        for p in me['primitives']:
            tris += (j['accessors'][p['indices']]['count'] if 'indices' in p else j['accessors'][p['attributes']['POSITION']]['count']) // 3; attrs |= set(p['attributes'])
    return dict(file_bytes=len(d), triangles=tris, meshes=len(j['meshes']), materials=len(j['materials']), images=len(j.get('images', [])), nodes=[n.get('name') for n in j['nodes']],
                mesh_names=[m.get('name') for m in j['meshes']], attributes=sorted(attrs), cameras=len(j.get('cameras', [])), lights=bool(j.get('extensions', {}).get('KHR_lights_punctual')),
                material_names=[m.get('name') for m in j['materials']])

def bbox_game(objs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in objs:
        if o.type != 'MESH': continue
        for v in o.data.vertices:
            g = Vector((v.co.x, v.co.z, -v.co.y)); lo = Vector(map(min, lo, g)); hi = Vector(map(max, hi, g))
    return [round(x, 3) for x in lo], [round(x, 3) for x in hi]

def render_views(out, samples):
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = samples; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4; sc.render.resolution_x = sc.render.resolution_y = 800; sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new('Studio_World'); w.use_nodes = True; bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (0.50, 0.68, 0.95, 1); bg.inputs[1].default_value = 0.9; sc.world = w
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=40, fill_type='NGON'); gr = bpy.context.active_object; gr.name = 'Studio_Ground'
    gm = bpy.data.materials.new('Studio_Grass'); gm.use_nodes = True; gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.09, 0.26, 0.04, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95; gr.data.materials.append(gm)
    sun = bpy.data.objects.new('Studio_Sun', bpy.data.lights.new('Studio_Sun', 'SUN')); sun.data.energy = 3.2; sun.data.angle = 0.1; sun.data.color = (1.0, 0.93, 0.8)
    sc.collection.objects.link(sun); sun.location = B((-5, 9, -6)); sun.rotation_euler = (B((0, 0, 0)) - sun.location).to_track_quat('-Z', 'Y').to_euler()
    cam = bpy.data.objects.new('Studio_Cam', bpy.data.cameras.new('Studio_Cam')); sc.collection.objects.link(cam); sc.camera = cam; cam.data.lens = 50
    views = dict(front=((0, 3.2, -14), (0, 3.0, 0)), three_quarter=((-9.5, 4.2, -10.5), (0, 3.0, 0)), overhead=((0, 15.5, -6.0), (0, 2.2, 0)))
    for nme, (cp, tp) in views.items():
        cam.location = B(cp); cam.rotation_euler = (B(tp) - cam.location).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(out, nme + '.png'); t = time.time(); bpy.ops.render.render(write_still=True); log('render', nme, '%.1fs' % (time.time() - t))

PARAMS = {
    'tree':       dict(seed=11, rb=0.42, r2=0.225, fork=3.1, top=5.0, limbs=7, first=2.4, hi=4.1, reach=2.3, limb_r=0.115, lean=(0.10, -0.06), wig=0.10, leaf=1.0, asym=0.0, asym_az=0.0, az0=0.4),
    'tree_b':     dict(seed=47, rb=0.40, r2=0.21, fork=2.9, top=5.1, limbs=6, first=2.3, hi=4.0, reach=2.4, limb_r=0.11, lean=(0.55, 0.25), wig=0.16, leaf=1.0, asym=0.55, asym_az=0.6, az0=2.0),
    'tree_young': dict(seed=5, rb=0.19, r2=0.105, fork=2.4, top=3.3, limbs=5, first=2.15, hi=3.0, reach=1.35, limb_r=0.055, lean=(0.08, 0.05), wig=0.05, leaf=0.64, asym=0.0, asym_az=0.0, az0=1.0),
}

def main():
    o = parse_args(); out = o['out']; os.makedirs(out, exist_ok=True); tdir = os.path.join(out, 'textures'); os.makedirs(tdir, exist_ok=True)
    for ob in list(bpy.data.objects): bpy.data.objects.remove(ob)
    for nme, fn in (('bark', tex_bark), ('leaf', tex_leaf), ('endgrain', tex_endgrain)): write_png(os.path.join(tdir, nme + '.png'), fn())
    log('textures')
    imgs = {k: bpy.data.images.load(os.path.join(tdir, k + '.png')) for k in ('bark', 'leaf', 'endgrain')}
    mats = dict(bark=make_mat('Bark', imgs['bark'], 0.88), leaf=make_mat('Leaves', imgs['leaf'], 0.72), fruit=make_mat('Fruit', None, 0.35), wood=make_mat('EndGrain', imgs['endgrain'], 0.8))
    # log shares bark (vertex-coloured) + endgrain; endgrain uses no vertex colour multiply (cap verts are white anyway)
    assets = {}; contract = dict(units='metres', up='+Y', front='-Z', origin='exact trunk axis at ground centre (Tree) / midpoint (Log) / disc centre (EndCap)',
                                 vertex_colors='COLOR_0 is a linear multiplier on albedo (shade/AO/moss/warm tint). Godot: vertex_color_use_as_albedo=true. Do not treat as white.',
                                 trees={}, textures={k: dict(file='textures/%s.png' % k, size=512) for k in imgs})
    def pack(name, root, objs, extra=None):
        path = os.path.join(out, name + '.glb'); export(root, path); info = glb_info(path); log('export', name, info['triangles'], 'tris', info['file_bytes'], 'bytes')
        allo = [root] + list(root.children_recursive); lo, hi = bbox_game(allo); info.update(bbox_min=lo, bbox_max=hi)
        if extra: info.update(extra)
        for ob in allo:
            ob.name = name + ':' + ob.name
            if ob.type == 'MESH': ob.data.name = ob.name
        assets[name] = allo; return info
    plans = {}
    for tname, P in PARAMS.items():
        pl = plan_tree(P); plans[tname] = pl
        for lod in (False, True):
            nm = tname + ('_lod' if lod else '')
            root = bpy.data.objects.new('Tree', None); bpy.context.scene.collection.objects.link(root)
            objs, ex = emit_tree(pl, lod, root, mats)
            info = pack(nm, root, objs, dict(trunk_samples=ex['samples'], trunk_contour_max_deviation=round(ex['contour_dev'], 4), empties=ex['empties'], first_branch_start_y=round(pl['first_branch_y'], 3)) if not lod else None)
            contract['trees'][nm] = info
        if tname == 'tree' and o['render']:
            for nm2, objs2 in assets.items():
                if nm2 != 'tree':
                    for ob in objs2: ob.hide_render = True
            render_views(out, o['samples'])
            for objs2 in assets.values():
                for ob in objs2: ob.hide_render = False
    root = bpy.data.objects.new('Log', None); bpy.context.scene.collection.objects.link(root); build_log(root, mats)
    g = bpy.data.objects.new('Grip', None); bpy.context.scene.collection.objects.link(g); g.parent = root; g.empty_display_type = 'ARROWS'; g.empty_display_size = 0.15
    contract['log'] = pack('log', root, None, dict(length_m=1.1, diameter_m=0.32, longitudinal_axis='+Y', grip_node='Grip'))
    root = bpy.data.objects.new('EndCap', None); bpy.context.scene.collection.objects.link(root); build_endcap(root, mats)
    contract['endcap'] = pack('endcap', root, None, dict(radius_m=1.0, thickness_m=0.025, top='+Y', note='scale XZ to trunk radius; texture circle edge carries bark rim'))
    t = contract['trees']
    for nm in ('tree', 'tree_b', 'tree_young'):
        t[nm]['lod_ratio'] = round(t[nm + '_lod']['triangles'] / t[nm]['triangles'], 3)
    contract['trunk_contract'] = dict(sides=12, rings='horizontal, regular 12-gon, vertices on fixed angles 30deg*j so lower trunk lines are vertical; mesh is linear between rings',
                                      concentric_below_m=2.0, contour_max_deviation_note='radius per vertex = nominal*(1+/-<=6.5%)', cut_range_m=[0.4, 1.6], root_flare_m=0.3,
                                      trunk_mesh='Trunk (y -0.1 buried to fork height); roots mesh separate, preserved as stump',
                                      note='Trunk is a hollow surface shell with no interior geometry; no bottom cap (buried), small top cap at fork hidden by Branches.')
    json.dump(contract, open(os.path.join(out, 'tree_contract.json'), 'w', encoding='utf-8'), indent=1)
    # editable source: spread assets for inspection, pack textures
    for i, (nm, objs) in enumerate(assets.items()):
        r = [x for x in objs if x.parent is None][0]; r.location = Vector(((i - 4) * 6.5 if not nm.startswith(('log', 'endcap')) else (i - 4) * 6.5, -14 if nm.startswith(('log', 'endcap')) else 0, 0)) if False else Vector((i * 6.5 - 20, 0, 0))
    bpy.ops.file.pack_all(); bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'source.blend'))
    log('done')

main()
