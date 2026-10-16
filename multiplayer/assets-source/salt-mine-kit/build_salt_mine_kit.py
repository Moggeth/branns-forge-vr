"""Brinedeep salt-mine prop kit - reproducible Blender (bpy 4.5) builder.

Run:  python3.11 build_salt_mine_kit.py -- --out ../../public/assets/salt-mine-kit.glb
      python3.11 build_salt_mine_kit.py -- --out out/salt-mine-kit.glb --render out/review   (Cycles review images)
      (pip install bpy==4.5.* numpy pillow)
Options: --pieces A,B (build a subset, for iteration only), --only name,name (render subset), --samples N.
Prints SALT_MINE_KIT_OK as its last line on success. Blender can exit 0 after a Python traceback, so check for it.

The Brinedeep: an old, cheerful salt mine dug into a mountain. Pink and white rock salt (halite) that glows warm from
inside like a salt lamp; chunky dark oiled timber, iron straps and rivets, brass fittings, warm lantern light.

Everything is authored in the game frame (X right, Y up, Z toward the viewer / front, metres) and converted to
Blender's Z-up on the way in, so the numbers here are the runtime's numbers. Ten top-level static meshes, one per
piece, each at its own origin. Six shared materials: Timber, Iron, Brass, SaltRock, SaltCrystal, LanternGlow.
COLOR_0   authored vertex colour with baked ambient occlusion multiplied in (linear).
TEXCOORD_0 Timber: wood-grain tile coordinates (u along the grain); other primitives: unused (constant).
TEXCOORD_1 x = salt-lamp glow mask 0..1 (SaltCrystal/SaltRock; 1 = glowing core / hopper recess), y = 0.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
import bpy, bmesh, math, json, time, struct
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

T0 = time.time()
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'salt-mine-kit.glb'))
RENDER = arg('--render')
TAU = math.tau

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def clamp(x, a=0.0, b=1.0): return min(b, max(a, x))
def lerp(a, b, t): return a + (b - a) * t
def lin(h): return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))
def mix(c1, c2, t): return tuple(a + (b - a) * t for a, b in zip(c1, c2))
def mul(c, k): return tuple(min(1.0, a * k) for a in c)
def to_b(p): return Vector((p[0], -p[2], p[1]))   # game (x, y up, z fwd) -> Blender (x, y back, z up)
def V(*a): return Vector(a)

C = {k: lin(v) for k, v in dict(
    timber_a='5a3720', timber_b='4b2e1b', timber_c='653e23', timber_grey='5e4c40', end='98724c', sign='8a6440',
    sign_dark='4f3220', iron='464a53', iron_dark='34373e', rivet='636873', brass='cc9c46', brass_dark='8c682c',
    brass_light='e8c46e', rock_pink='e6a898', rock_rose='c46a66', rock_orange='e08c6a', rock_white='f4e6de',
    rock_grey='a89e9a', rock_dark='8e6c68', cr_pale='f6cacd', cr_rose='ef93a5', cr_milk='f8efea', cr_deep='c84d6c',
    cr_inner='ffc4a8', cr_inner_deep='ff9088', crust='f5eee8', crust_pink='f0d6cf', fissure='1c1416',
    stain='cdbb62', glow='ffd59a').items()}

# ===================================================================== deterministic noise
def _hash(i, j, k, seed):
    h = (i * 374761393 + j * 668265263 + k * 1274126177 + seed * 2246822519) & 0xffffffff
    h = ((h ^ (h >> 13)) * 3266489917) & 0xffffffff
    h = (h ^ (h >> 16)) & 0xffffffff
    return h / 0xffffffff
def vnoise(x, y, z, seed=0):
    xi, yi, zi = math.floor(x), math.floor(y), math.floor(z)
    xf, yf, zf = x - xi, y - yi, z - zi
    u, v, w = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf), zf * zf * (3 - 2 * zf)
    def h(a, b, c): return _hash(xi + a, yi + b, zi + c, seed)
    x00 = lerp(h(0, 0, 0), h(1, 0, 0), u); x10 = lerp(h(0, 1, 0), h(1, 1, 0), u)
    x01 = lerp(h(0, 0, 1), h(1, 0, 1), u); x11 = lerp(h(0, 1, 1), h(1, 1, 1), u)
    return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w)
def fbm(p, seed=0, oct=4):
    s, amp, tot, f = 0.0, 1.0, 0.0, 1.0
    for o in range(oct):
        s += amp * vnoise(p[0] * f, p[1] * f, p[2] * f, seed + o * 31); tot += amp; amp *= .5; f *= 2.03
    return s / tot

# ===================================================================== wood-grain tile (numpy, tileable)
def periodic_noise(size, cx, cy, seed):
    r = np.random.default_rng(seed); tab = r.random((cy, cx)).astype(np.float32)
    yy, xx = (np.mgrid[0:size, 0:size].astype(np.float32) + .5) / size
    X, Y = xx * cx, yy * cy
    xi, yi = np.floor(X).astype(np.int64), np.floor(Y).astype(np.int64); xf, yf = X - xi, Y - yi
    u, v = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    a, b = tab[yi % cy, xi % cx], tab[yi % cy, (xi + 1) % cx]
    c, d = tab[(yi + 1) % cy, xi % cx], tab[(yi + 1) % cy, (xi + 1) % cx]
    return (a + (b - a) * u) * (1 - v) + (c + (d - c) * u) * v

def wood_texture(size=512):
    """Near-white grain detail multiplied over the Timber vertex colour. Grain runs along u (image x)."""
    yy = (np.mgrid[0:size, 0:size][0].astype(np.float32) + .5) / size
    warp = periodic_noise(size, 3, 6, 1) * 1.1 + periodic_noise(size, 7, 14, 2) * .35
    rings = np.sin(TAU * (yy * 11 + warp))
    lines = np.clip((rings - .55) / .45, 0, 1) ** 1.5
    streak = periodic_noise(size, 4, 96, 3) * .6 + periodic_noise(size, 8, 192, 4) * .4
    pores = periodic_noise(size, 64, 256, 5)
    val = .90 + .10 * (streak - .5) * 2.0 - .17 * lines - .06 * np.clip((pores - .7) / .3, 0, 1)
    blot = periodic_noise(size, 2, 2, 6)
    val *= .94 + .06 * blot
    val = np.clip(val, .55, 1.0)
    rgb = np.stack([val, val * .965, val * .93], -1)
    return rgb ** (1 / 2.2)   # stored sRGB

def make_image(name, rgb, colourspace='sRGB'):
    from PIL import Image
    folder = os.path.join(HERE, 'out', 'textures'); os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, name + '.png')
    Image.fromarray(np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8), 'RGB').save(path)
    img = bpy.data.images.load(path); img.name = name
    img.colorspace_settings.name = colourspace
    img.pack()
    return img

# ===================================================================== geometry accumulator (one per piece)
TIMBER, IRON, BRASS, ROCK, CRYSTAL, GLOW = range(6)
MAT_NAMES = ['Timber', 'Iron', 'Brass', 'SaltRock', 'SaltCrystal', 'LanternGlow']
AO_MIN = {TIMBER: .30, IRON: .32, BRASS: .38, ROCK: .34, CRYSTAL: .55, GLOW: 1.0}

def newell(ps):
    n = Vector((0, 0, 0))
    for i in range(len(ps)):
        a, b = ps[i], ps[(i + 1) % len(ps)]
        n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y)
    return n

class Piece:
    def __init__(self, name, floor=True, reach=.5, ray_off=.004):
        self.name, self.floor, self.reach, self.ray_off = name, floor, reach, ray_off
        self.P, self.C, self.M, self.AO = [], [], [], []
        self.F, self.FM, self.FS, self.FUV = [], [], [], []
        self.anchors = {}
    def v(self, p, c, mask=0.0, ao=1.0):
        self.P.append(Vector(p)); self.C.append(tuple(c)); self.M.append(float(mask)); self.AO.append(ao)
        return len(self.P) - 1
    def f(self, idx, mat, smooth=True, uvs=None, out=None):
        idx = list(idx)
        if uvs is None: uvs = [(.5, .5)] * len(idx)
        uvs = list(uvs)
        # drop repeated corners (lathe poles)
        k = 0
        while k < len(idx) and len(idx) > 3:
            if idx[k] == idx[(k + 1) % len(idx)]: del idx[k]; del uvs[k]
            else: k += 1
        if len(set(idx)) < 3: return
        if out is not None:
            n = newell([self.P[i] for i in idx])
            if n.dot(Vector(out)) < 0: idx = idx[::-1]; uvs = uvs[::-1]
        self.F.append(idx); self.FM.append(mat); self.FS.append(smooth); self.FUV.append(uvs)
    def bvh(self, f0=0, f1=None):
        return BVHTree.FromPolygons([tuple(p) for p in self.P], [tuple(f) for f in self.F[f0:f1]])

# ===================================================================== primitives
def frame_from(t, up):
    t = Vector(t).normalized(); s = Vector(up).cross(t)
    if s.length < 1e-5: s = Vector((0, 0, 1)).cross(t)
    if s.length < 1e-5: s = Vector((1, 0, 0)).cross(t)
    s.normalize(); u = t.cross(s).normalized()
    return t, s, u

def beam(pc, a, b, w, h, up=(0, 1, 0), mat=TIMBER, col=None, ch=0.0, segs=1, taper=1.0, cap_col=None, mask=0.0,
         tile=1.1, jit=0.0, seed=0, flat=False, caps=(True, True), colvar=0.0, ao=1.0, uv_off=0.0, bow=None):
    """A swept rectangular (ch=0) or chamfered-octagon section from a to b. w along s = up x t, h along u."""
    a, b = Vector(a), Vector(b); L = (b - a).length
    t, s, u = frame_from(b - a, up)
    col = col or C['timber_a']
    hw, hh = w / 2, h / 2
    if ch > 0:
        sec = [(hw, hh - ch), (hw - ch, hh), (-hw + ch, hh), (-hw, hh - ch), (-hw, -hh + ch), (-hw + ch, -hh), (hw - ch, -hh), (hw, -hh + ch)]
    else:
        sec = [(hw, -hh), (hw, hh), (-hw, hh), (-hw, -hh)]
    n = len(sec)
    per = [0.0]
    for k in range(n):
        x0, y0 = sec[k]; x1, y1 = sec[(k + 1) % n]; per.append(per[-1] + math.hypot(x1 - x0, y1 - y0))
    rings = []
    for k in range(segs + 1):
        fk = k / segs; c = a + (b - a) * fk; sc = lerp(1, taper, fk)
        if bow is not None: c = c + Vector(bow) * math.sin(math.pi * fk)
        row = []
        for j, (x, y) in enumerate(sec):
            p = c + s * (x * sc) + u * (y * sc)
            if jit:
                p = p + (s * (vnoise(p.x * 9, p.y * 9, p.z * 9, seed) - .5) + u * (vnoise(p.x * 9, p.y * 9, p.z * 9, seed + 7) - .5)) * jit
            cc = col
            if colvar: cc = mul(col, 1 + colvar * (fbm((p.x * 2.1, p.y * 2.1, p.z * 2.1), seed + 3, 2) * 2 - 1))
            row.append(pc.v(p, cc, mask, ao))
        rings.append((c, row))
    for k in range(segs):
        for j in range(n):
            j2 = (j + 1) % n
            idx = [rings[k][1][j], rings[k][1][j2], rings[k + 1][1][j2], rings[k + 1][1][j]]
            v0, v1 = per[j] / tile, per[j + 1] / tile
            u0, u1 = L * k / segs / tile + uv_off, L * (k + 1) / segs / tile + uv_off
            cen = sum((pc.P[i] for i in idx), Vector()) / 4
            ax = a + t * (cen - a).dot(t)
            pc.f(idx, mat, not flat, [(u0, v0), (u0, v1), (u1, v1), (u1, v0)], out=cen - ax)
    for k, sgn, want in ((0, -1, caps[0]), (segs, 1, caps[1])):
        if not want: continue
        c, row = rings[k]; cc = cap_col or col
        ids = [pc.v(pc.P[i], cc, mask, ao) for i in row]
        pc.f(ids, mat, True, [(x / tile * 1.5 + .3, y / tile * .25) for x, y in sec], out=t * sgn)
    return rings

def box(pc, c, axes, half, **kw):
    """Oriented box: axes = (ax0, ax1, ax2) right-handed unit vectors, half = half sizes along them."""
    c = Vector(c); a0, a1, a2 = (Vector(x).normalized() for x in axes)
    return beam(pc, c - a2 * half[2], c + a2 * half[2], 2 * half[0], 2 * half[1], up=a1, **kw)

XA, YA, ZA = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)

def rivet(pc, p, n, r=.018, mat=IRON, col=None, k=6, mask=0.0):
    col = col or C['rivet']
    n = Vector(n).normalized(); e1 = n.cross(XA if abs(n.x) < .9 else YA).normalized(); e2 = n.cross(e1)
    base = Vector(p) - n * .004
    ring = [pc.v(base + (e1 * math.cos(TAU * i / k) + e2 * math.sin(TAU * i / k)) * r, col, mask) for i in range(k)]
    apex = pc.v(Vector(p) + n * r * .55, mul(col, 1.2), mask)
    for i in range(k):
        q = [ring[i], ring[(i + 1) % k], apex]
        cen = sum((pc.P[j] for j in q), Vector()) / 3
        pc.f(q, mat, True, None, out=cen - (base - n * r))

def lathe(pc, origin, axis, prof, n, mat, col_fn, mask=0.0, smooth=True, ref=None, phase=0.0, ao=1.0, disp=None):
    """Surface of revolution. prof = [(r, h)] from the top (h max) outward and down; outward = (-dh, dr)."""
    o = Vector(origin); ax = Vector(axis).normalized()
    e1 = Vector(ref) if ref is not None else ax.cross(XA if abs(ax.x) < .9 else YA)
    e1 = (e1 - ax * e1.dot(ax)).normalized(); e2 = ax.cross(e1)
    rows = []
    for i, (r, h) in enumerate(prof):
        if r < 1e-7:
            vid = pc.v(o + ax * h, col_fn(i, 0, o + ax * h), mask if not callable(mask) else mask(i, 0), ao)
            rows.append([vid] * n); continue
        row = []
        for j in range(n):
            th = TAU * j / n + phase
            p = o + ax * h + (e1 * math.cos(th) + e2 * math.sin(th)) * r
            if disp: p = p + disp(i, j, p)
            row.append(pc.v(p, col_fn(i, j, p), mask if not callable(mask) else mask(i, j), ao))
        rows.append(row)
    for i in range(len(prof) - 1):
        dr = prof[i + 1][0] - prof[i][0]; dh = prof[i + 1][1] - prof[i][1]
        for j in range(n):
            j2 = (j + 1) % n
            th = TAU * (j + .5) / n + phase
            radial = e1 * math.cos(th) + e2 * math.sin(th)
            pc.f([rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]], mat, smooth, None, out=radial * (-dh) + ax * dr)
    return rows

def torus(pc, c, axis, R, r, n1, n2, mat, col, a0=0.0, a1=TAU, ref=None, mask=0.0, caps=True):
    c = Vector(c); ax = Vector(axis).normalized()
    e1 = Vector(ref) if ref is not None else ax.cross(XA if abs(ax.x) < .9 else YA)
    e1 = (e1 - ax * e1.dot(ax)).normalized(); e2 = ax.cross(e1)
    closed = abs(a1 - a0 - TAU) < 1e-6
    rows, cents = [], []
    for i in range(n1 + (0 if closed else 1)):
        th = a0 + (a1 - a0) * i / n1
        rad = e1 * math.cos(th) + e2 * math.sin(th); q = c + rad * R
        cents.append(q)
        rows.append([pc.v(q + (rad * math.cos(TAU * j / n2) + ax * math.sin(TAU * j / n2)) * r, col, mask) for j in range(n2)])
    m = len(rows)
    for i in range(m if closed else m - 1):
        i2 = (i + 1) % m
        for j in range(n2):
            j2 = (j + 1) % n2
            q = [rows[i][j], rows[i][j2], rows[i2][j2], rows[i2][j]]
            cen = sum((pc.P[k] for k in q), Vector()) / 4
            pc.f(q, mat, True, None, out=cen - (cents[i] + cents[i2]) / 2)
    if not closed and caps:
        for i, sg in ((0, -1), (m - 1, 1)):
            th = a0 if i == 0 else a1
            tang = (-e1 * math.sin(th) + e2 * math.cos(th)) * sg
            ids = [pc.v(pc.P[k], col, mask) for k in rows[i]]
            pc.f(ids, mat, True, None, out=tang)

def hull(pc, pts, mat, col_fn, mask=0.0, smooth=False, ao=1.0):
    """Convex hull of pts (flat-shaded facets by default). col_fn(p, n) -> colour; mask may be callable(p, n)."""
    bm = bmesh.new(); vs = [bm.verts.new(Vector(p)) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs, use_existing_faces=False)
    drop = list({g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)})
    if drop: bmesh.ops.delete(bm, geom=drop, context='VERTS')
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(2.5), verts=list(bm.verts), edges=list(bm.edges))
    bm.normal_update()
    cen = sum((v.co for v in bm.verts), Vector()) / max(1, len(bm.verts))
    shared = {}
    for fa in bm.faces:
        n = fa.normal.copy(); fc = fa.calc_center_median()
        ids = []
        for v in fa.verts:
            p = v.co.copy()
            if smooth and v.index in shared: ids.append(shared[v.index]); continue
            m = mask(p, n) if callable(mask) else mask
            vid = pc.v(p, col_fn(p, n), m, ao)
            if smooth: shared[v.index] = vid
            ids.append(vid)
        pc.f(ids, mat, smooth, None, out=fc - cen)
    bm.free()

def chunk_points(c, half, R, rng, cut=.35, jitter=.12):
    """A cleavage block of rock salt: a box with jittered corners and a few corners knocked off."""
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                q = Vector((sx * half[0], sy * half[1], sz * half[2]))
                q = Vector((q.x * (1 + rng.uniform(-jitter, jitter)), q.y * (1 + rng.uniform(-jitter, jitter)), q.z * (1 + rng.uniform(-jitter, jitter))))
                if rng.random() < cut:   # knock the corner off: three points pulled in along the edges
                    k = rng.uniform(.25, .5)
                    for ax in range(3):
                        qq = q.copy(); qq[ax] *= (1 - k); pts.append(qq)
                else:
                    pts.append(q)
    return [Vector(c) + R @ p for p in pts]

def rot_up(d, spin=0.0, local_up=(0, 1, 0)):
    lu = Vector(local_up).normalized()
    q = lu.rotation_difference(Vector(d).normalized())
    return q.to_matrix() @ Matrix.Rotation(spin, 3, lu)
CORNER_UP = (1, 1, 1)

def crystal(pc, centre, R, half, col, mask=.5, ch=None, hopper=(), steps=3, inner=None, shade=.07, seed=0, mat=CRYSTAL):
    """Halite cube (or cuboid): chamfered edges, flat shaded; faces in `hopper` ((axis, sign) pairs, local) get the
    stepped, terraced recess of a hopper crystal. Glow mask: faces `mask`, recess terraces up to 1."""
    centre = Vector(centre); h = list(half)
    c = min(h) * .12 if ch is None else ch
    inner = inner or C['cr_inner']
    rng = np.random.default_rng(seed)
    top = max(h) * 1.2
    def W(p): return centre + R @ Vector(p)
    def tint(colr, p, k=1.0):
        w = W(p); t = smoothstep(-1, 1, (w.y - centre.y) / top)
        return mul(colr, k * lerp(.86, 1.06, t))
    def face(pl, colr, m, out_local, k=1.0):
        ids = [pc.v(W(p), tint(colr, p, k), m, .9) for p in pl]
        pc.f(ids, mat, False, None, out=R @ Vector(out_local))
    def P3(i, j, k, a, b, cc):
        p = [0.0, 0.0, 0.0]; p[i] = a; p[j] = b; p[k] = cc; return tuple(p)
    for i in range(3):
        j, k = [x for x in range(3) if x != i]
        for sg in (-1, 1):
            nl = [0, 0, 0]; nl[i] = sg
            ej, ek = h[j] - c, h[k] - c
            fk = 1 + rng.uniform(-shade, shade)
            if (i, sg) not in hopper:
                face([P3(i, j, k, sg * h[i], -ej, -ek), P3(i, j, k, sg * h[i], ej, -ek), P3(i, j, k, sg * h[i], ej, ek), P3(i, j, k, sg * h[i], -ej, ek)], col, mask, nl, fk)
                continue
            fr = [1.0, .74, .52, .32][:steps + 1]
            dd = [0.0, .055, .11, .155][:steps + 1]
            depth = [d * 2 * min(h) for d in dd]
            def Q(fu, fw, d): return P3(i, j, k, sg * (h[i] - d), fu * ej, fw * ek)
            for s in range(steps):
                f0, f1, d0, d1 = fr[s], fr[s + 1], depth[s], depth[s + 1]
                tt = s / steps
                ring_col = mix(col, inner, .25 + .6 * tt) if s else col
                ring_m = lerp(mask, 1.0, .5 + .5 * tt) if s else mask
                for (a, b) in (((1, 0), (0, 1)), ((-1, 0), (0, -1)), ((0, 1), (-1, 0)), ((0, -1), (1, 0))):
                    # side with outward 2D direction a, tangent b
                    def at(f, tval): return (a[0] * f + b[0] * f * tval, a[1] * f + b[1] * f * tval)
                    q0, q1 = at(f0, -1), at(f0, 1); q2, q3 = at(f1, 1), at(f1, -1)
                    face([Q(*q0, d0), Q(*q1, d0), Q(*q2, d0), Q(*q3, d0)], ring_col, ring_m, nl, fk)
                    out2 = [0, 0, 0]; out2[j] = -a[0]; out2[k] = -a[1]
                    face([Q(*q3, d0), Q(*q2, d0), Q(*q2, d1), Q(*q3, d1)], mix(col, inner, .55 + .4 * tt), 1.0, out2, fk * .9)
            fl, dl = fr[steps], depth[steps]
            face([Q(-fl, -fl, dl), Q(fl, -fl, dl), Q(fl, fl, dl), Q(-fl, fl, dl)], inner, 1.0, nl, 1.04)
    if c > 0:
        for i in range(3):
            for j in range(i + 1, 3):
                k = 3 - i - j
                for si in (-1, 1):
                    for sj in (-1, 1):
                        def E(a_i, a_j, a_k):
                            p = [0.0, 0.0, 0.0]; p[i] = a_i; p[j] = a_j; p[k] = a_k; return tuple(p)
                        ek = h[k] - c
                        pl = [E(si * h[i], sj * (h[j] - c), -ek), E(si * h[i], sj * (h[j] - c), ek),
                              E(si * (h[i] - c), sj * h[j], ek), E(si * (h[i] - c), sj * h[j], -ek)]
                        nl = [0, 0, 0]; nl[i] = si; nl[j] = sj
                        face(pl, mix(col, C['cr_milk'], .35), mask * .8, nl, 1.08)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    pl = [(sx * h[0], sy * (h[1] - c), sz * (h[2] - c)), (sx * (h[0] - c), sy * h[1], sz * (h[2] - c)),
                          (sx * (h[0] - c), sy * (h[1] - c), sz * h[2])]
                    face(pl, mix(col, C['cr_milk'], .4), mask * .8, (sx, sy, sz), 1.1)

# ===================================================================== salt-rock colouring
def rock_col(p, seed=0, white=0.0, grey=0.0):
    """Banded Himalayan-salt rock: rose and pink strata, orange warmth, milky veins. Returns (colour, glow mask)."""
    b = .5 + .5 * math.sin((p[1] * 2.4 + 1.7 * fbm((p[0] * .5, p[1] * .5, p[2] * .5), seed)) * math.pi)
    o = fbm((p[0] * 1.6, p[1] * 1.6, p[2] * 1.6), seed + 5, 3)
    c = mix(C['rock_rose'], C['rock_pink'], smoothstep(.15, .85, b))
    c = mix(c, C['rock_orange'], smoothstep(.52, .72, o) * .55)
    vein = smoothstep(.56, .7, fbm((p[0] * 2.3 + 4.1, p[1] * 3.1, p[2] * 2.3), seed + 9, 3))
    v = clamp(vein + white)
    c = mix(c, C['rock_white'], v * .85)
    if grey: c = mix(c, C['rock_grey'], grey)
    return c, .12 + .5 * v * (1 - grey)

def rock_dome(pc, cx, cz, R, H, segs, rings, seed, floor_y=-.03, rough=.12, flat=True, white=0.0, grey=0.0, ao=1.0,
              y0=0.0, squash=(1.0, 1.0), lumps=.5):
    """Faceted mound of salt rock centred at (cx, y0, cz)."""
    def hgt(r): return H * max(0.0, 1 - min(1.0, r) ** 2) ** .75
    rows = []
    top = Vector((cx, y0 + H * (1 + .08 * (vnoise(cx, cz, 0, seed) - .5)), cz))
    cc, m = rock_col(top, seed, white, grey)
    centre = pc.v(top, cc, m, ao)
    for i in range(1, rings + 1):
        rr = i / rings; row = []
        for j in range(segs):
            th = TAU * (j + .5 * (i % 2)) / segs
            nz = vnoise(math.cos(th) * 2.2 + seed, math.sin(th) * 2.2, rr * 2.5, seed)
            rad = R * rr * (1 + rough * (nz - .5) * 2)
            x, z = cx + math.cos(th) * rad * squash[0], cz + math.sin(th) * rad * squash[1]
            y = y0 + hgt(rr) * (1 + lumps * rough * (vnoise(x * 4, z * 4, 3, seed + 1) - .5) * 2) if i < rings else floor_y
            p = Vector((x, y, z)); cc, m = rock_col(p, seed, white, grey)
            row.append(pc.v(p, cc, m, ao))
        rows.append(row)
    ref = Vector((cx, y0 - R, cz))
    for j in range(segs):
        j2 = (j + 1) % segs
        q = [centre, rows[0][j], rows[0][j2]]
        pc.f(q, ROCK, not flat, None, out=sum((pc.P[k] for k in q), Vector()) / 3 - ref)
    for i in range(rings - 1):
        for j in range(segs):
            j2 = (j + 1) % segs
            if i % 2 == 0: a, b, c2, d = rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]
            else: a, b, c2, d = rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]
            for q in ([a, b, c2], [a, c2, d]):
                pc.f(q, ROCK, not flat, None, out=sum((pc.P[k] for k in q), Vector()) / 3 - ref)
    return hgt

def rock_chunk(pc, c, half, rng, white=0.0, grey=0.0, seed=0, cut=.4, R=None, mask_k=1.0, shade=.08):
    R = R if R is not None else Matrix.Rotation(rng.uniform(0, TAU), 3, YA) @ Matrix.Rotation(rng.uniform(-.5, .5), 3, XA)
    pts = chunk_points(c, half, R, rng, cut)
    base, m = rock_col(Vector(c), seed, white, grey)
    k = 1 + rng.uniform(-shade, shade)
    def cf(p, n):
        cc, _ = rock_col(p, seed, white, grey)
        cc = mix(cc, base, .5)
        return mul(cc, k * (1.04 if n.y > .5 else .97))
    hull(pc, pts, ROCK, cf, mask=m * mask_k)

def crust_lumps(pc, cx, cz, hw, hd, n, rng, top=.28, crystals=3, seed=0):
    """White evaporite crust built up round a timber foot: lumps hugging the rectangle (hw x hd) plus tiny cubes."""
    perim = 2 * (2 * hw + 2 * hd)
    for k in range(n):
        s = (k + rng.uniform(-.3, .3)) / n * perim
        if s < 2 * hw: x, z, nx, nz = cx - hw + s, cz + hd, 0, 1
        elif s < 2 * hw + 2 * hd: x, z, nx, nz = cx + hw, cz + hd - (s - 2 * hw), 1, 0
        elif s < 4 * hw + 2 * hd: x, z, nx, nz = cx + hw - (s - 2 * hw - 2 * hd), cz - hd, 0, -1
        else: x, z, nx, nz = cx - hw, cz - hd + (s - 4 * hw - 2 * hd), -1, 0
        sx, sz = rng.uniform(.06, .12), rng.uniform(.05, .09)
        sy = rng.uniform(.4, 1.0) * top * .5
        c = Vector((x + nx * sz * .4, sy * .55 - .03, z + nz * sz * .4))
        R = Matrix.Rotation(rng.uniform(0, TAU), 3, YA)
        tint = rng.uniform(0, .45)
        def cf(p, nn, tint=tint):
            return mul(mix(C['crust'], C['crust_pink'], tint), 1.03 if nn.y > .4 else .95)
        hull(pc, chunk_points(c, (sx, sy, sz), R, rng, cut=.6, jitter=.2), ROCK, cf, mask=.22)
    for k in range(crystals):
        th = rng.uniform(0, TAU); hs = rng.uniform(.025, .045)
        c = Vector((cx + math.cos(th) * (hw + .05), rng.uniform(.04, top * .6), cz + math.sin(th) * (hd + .05)))
        crystal(pc, c, rot_up((math.cos(th) * .6, 1, math.sin(th) * .6), rng.uniform(0, TAU), CORNER_UP if k % 2 else YA),
                (hs, hs, hs), C['cr_milk'] if k % 2 else C['cr_pale'], .55, ch=0.0, seed=seed + k)

def timber_beam(pc, a, b, w, h, rng, up=(0, 1, 0), segs=4, taper=.96, ch=.04, shade=None, **kw):
    col = shade or [C['timber_a'], C['timber_b'], C['timber_c']][int(rng.integers(0, 3))]
    return beam(pc, a, b, w, h, up=up, mat=TIMBER, col=col, ch=ch, segs=segs, taper=taper, cap_col=mix(C['end'], col, .3),
                jit=.012, seed=int(rng.integers(0, 9999)), colvar=.10, uv_off=float(rng.uniform(0, 1)), **kw)

def iron_plate(pc, c, axes, half, rivets=(), n=None, col=None):
    box(pc, c, axes, half, mat=IRON, col=col or C['iron'], ch=min(half) * .6 if min(half) > .004 else 0.0)
    nrm = Vector(n) if n is not None else Vector(axes[2])
    for rp in rivets: rivet(pc, Vector(rp), nrm, .017)

# ===================================================================== pieces
def build_portal():
    pc = Piece('MinePortal', reach=.8)
    rng = np.random.default_rng(101)
    OW, OH = 3.8, 3.5
    PW, PD = .40, .42
    PX = OW / 2 + PW / 2
    # ---- rock-salt reveal: a U-shaped lining 1.5 m deep that rolls out into a rough collar behind the frame
    U = [(-2.06, -.06), (-2.08, 1.6), (-2.06, 3.2), (-1.96, 3.52), (-1.7, 3.72), (0, 3.78), (1.7, 3.72), (1.96, 3.52), (2.06, 3.2), (2.08, 1.6), (2.06, -.06)]
    seg = [math.hypot(U[i + 1][0] - U[i][0], U[i + 1][1] - U[i][1]) for i in range(len(U) - 1)]
    total = sum(seg); NP = 64
    prof = []
    for q in range(NP + 1):
        d = total * q / NP; i = 0
        while i < len(seg) - 1 and d > seg[i]: d -= seg[i]; i += 1
        f = d / seg[i]; prof.append((lerp(U[i][0], U[i + 1][0], f), lerp(U[i][1], U[i + 1][1], f)))
    nrm2 = []
    for q in range(NP + 1):
        a, b = prof[max(0, q - 1)], prof[min(NP, q + 1)]
        dx, dy = b[0] - a[0], b[1] - a[1]; l = math.hypot(dx, dy); nrm2.append((-dy / l, dx / l))
    RINGS = [(0, -1.5), (0, -1.25), (0, -1.0), (0, -.75), (0, -.5), (0, -.3), (.03, -.2), (.24, -.15), (.52, -.12), (.84, -.16), (1.16, -.26), (1.45, -.42), (1.7, -.7)]
    grid = []
    for k, (o, z) in enumerate(RINGS):
        row = []
        for q in range(NP + 1):
            x0, y0 = prof[q]; nx, ny = nrm2[q]
            bottom = q == 0 or q == NP
            oo = o * (1 + (.35 * (vnoise(q * .45, 3.3, k, 11) - .5) * 2 if k == len(RINGS) - 1 else 0))
            p = Vector((x0 + nx * oo, y0 + ny * oo, z))
            nv = fbm((p.x * 1.3, p.y * 1.3, z * 1.3 + o), 21) - .5
            nv = lerp(nv, round(nv * 5) / 5, .55)        # terraced, cleavage-like facets
            if o < .01:
                dsp = clamp(nv * .42, -.07, .14)
                p = p + Vector((nx, ny, 0)) * dsp
                p.z += (vnoise(p.x * 3, p.y * 3, 0, 5) - .5) * .12 if k > 0 else 0
            else:
                p = p + Vector((nx, ny, 0)) * nv * .12
                p.z += nv * .32 * min(1, o * 2)
            if bottom: p.y = -.06
            if p.y < -.06: p.y = -.06
            cc, m = rock_col(p, 3)
            row.append(pc.v(p, cc, m))
        grid.append(row)
    for k in range(len(RINGS) - 1):
        for q in range(NP):
            a, b, c2, d = grid[k][q], grid[k][q + 1], grid[k + 1][q + 1], grid[k + 1][q]
            # want the face pointing into the tunnel (toward the profile's inside) or forward on the collar
            nx, ny = nrm2[q]
            o = RINGS[k][0]
            want = Vector((-nx, -ny, 0)) if o < .02 and RINGS[k + 1][0] < .02 else Vector((0, 0, 1)) + Vector((-nx, -ny, 0)) * .2
            pc.f([a, b, c2, d], ROCK, False, None, out=want)
    rock_faces = len(pc.F)
    # chunky boulders on the collar, heavier at the feet
    spots = [(1, 1.0, .55), (4, 1.3, .42), (9, 1.25, .36), (15, 1.35, .4), (22, 1.3, .38), (28, 1.4, .44), (35, 1.35, .4), (42, 1.3, .36), (49, 1.35, .42), (55, 1.25, .38), (60, 1.3, .44), (63, 1.0, .58)]
    for q, oo, s in spots:
        x0, y0 = prof[q]; nx, ny = nrm2[q]
        c = Vector((x0 + nx * oo, max(y0 + ny * oo, s * .45 - .08), -.3))
        rock_chunk(pc, c, (s * rng.uniform(.8, 1.1), s * rng.uniform(.55, .8), s * .7), rng, white=rng.uniform(0, .3), seed=7 + q)
    # halite sprouting from the collar (cast onto the rock surface)
    bv = pc.bvh(0, rock_faces)
    for q, oo, hs, deep in ((9, .5, .13, False), (24, .45, .1, True), (38, .42, .15, False), (47, .5, .09, False), (56, .55, .12, True), (16, .62, .08, False)):
        x0, y0 = prof[q]; nx, ny = nrm2[q]
        start = Vector((x0 + nx * oo, y0 + ny * oo, 1.5))
        hit = bv.ray_cast(start, Vector((0, 0, -1)), 4)
        if hit[0] is None: continue
        d = (Vector((nx, ny, 0)) * .45 + Vector((0, 0, 1)) + Vector((0, .2, 0))).normalized()
        c = hit[0] - d * hs * .35
        crystal(pc, c, rot_up(d, rng.uniform(0, TAU), CORNER_UP if q % 2 else YA), (hs, hs * 1.1, hs),
                C['cr_deep'] if deep else (C['cr_pale'] if q % 3 else C['cr_milk']), .6, hopper={(1, 1)} if hs > .12 else (), seed=q)
    # ---- the timber frame
    for sx in (-1, 1):
        x = sx * PX
        timber_beam(pc, (x, -.06, 0), (x, OH + .04, 0), PW, PD, rng, up=(0, 0, 1), segs=6, taper=.95, ch=.05)
        # iron foot band
        yb = .34
        for (cc, ax, hf) in (((x, yb, PD / 2 + .008), (XA, YA, ZA), (PW / 2 + .012, .05, .009)), ((x, yb, -PD / 2 - .008), (XA, YA, ZA), (PW / 2 + .012, .05, .009)),
                             ((x + PW / 2 + .008, yb, 0), (ZA, YA, -XA), (PD / 2 + .012, .05, .009)), ((x - PW / 2 - .008, yb, 0), (ZA, YA, -XA), (PD / 2 + .012, .05, .009))):
            box(pc, cc, ax, hf, mat=IRON, col=C['iron'])
        for dx in (-.11, .11): rivet(pc, (x + dx, yb, PD / 2 + .017), ZA, .016)
        crust_lumps(pc, x, 0, PW / 2, PD / 2, 15, rng, top=.46, crystals=5, seed=40 + sx)
        # knee brace
        timber_beam(pc, (sx * (OW / 2 + .1), 2.5, 0), (sx * 1.18, OH + .1, 0), .24, .26, rng, up=(0, 0, 1), segs=2, taper=1.0, ch=.035)
        rivet(pc, (sx * 1.97, 2.66, .14), ZA, .03); rivet(pc, (sx * 1.33, 3.47, .14), ZA, .03)
        # L-bracket: strap down the post front and along the lintel front, riveted
        iron_plate(pc, (x, 3.12, PD / 2 + .011), (XA, YA, ZA), (.12, .4, .011), [(x, 2.84, PD / 2 + .022), (x, 3.1, PD / 2 + .022), (x, 3.36, PD / 2 + .022)])
        iron_plate(pc, (sx * (PX - .12), 3.74, .245), (XA, YA, ZA), (.42, .11, .011), [(sx * (PX - .42), 3.74, .257), (sx * (PX - .14), 3.74, .257), (sx * (PX + .14), 3.74, .257)])
        rivet(pc, (x, 3.74, .262), ZA, .04)
        # lintel end band
        xe = sx * 2.42
        for (cc, ax, hf) in (((xe, 3.74, .244), (XA, YA, ZA), (.05, .25, .008)), ((xe, 3.74, -.244), (XA, YA, ZA), (.05, .25, .008)),
                             ((xe, 3.995, 0), (XA, ZA, -YA), (.05, .245, .008)), ((xe, 3.485, 0), (XA, ZA, -YA), (.05, .245, .008))):
            box(pc, cc, ax, hf, mat=IRON, col=C['iron'])
    # heavy lintel
    timber_beam(pc, (-2.62, 3.74, 0), (2.62, 3.74, 0), .48, .49, rng, up=(0, 1, 0), segs=8, taper=1.0, ch=.055, shade=C['timber_b'])
    LT = 3.74 + .245
    # ---- hanging signboard above the lintel
    for sx in (-1, 1):
        box(pc, (sx * .7, LT + .45, -.08), (XA, YA, ZA), (.024, .47, .017), mat=IRON, col=C['iron'])
        box(pc, (sx * .7, LT + .012, -.08), (XA, YA, ZA), (.07, .014, .07), mat=IRON, col=C['iron_dark'])
        rivet(pc, (sx * .7, LT + .026, -.08), YA, .02)
    rod_y = LT + .88
    beam(pc, (-.76, rod_y, -.08), (.76, rod_y, -.08), .038, .038, mat=IRON, col=C['iron'], ch=.011)
    for sx in (-1, 1):
        rivet(pc, (sx * .78, rod_y, -.08), sx * XA, .028)
    SW, SH, SD = 1.36, .66, .09
    sy = rod_y - .1 - SH / 2
    sign_c = Vector((0, sy, -.08))
    beam(pc, sign_c - XA * SW / 2, sign_c + XA * SW / 2, SD, SH, up=(0, 1, 0), mat=TIMBER, col=C['sign'], ch=.02, segs=2, cap_col=C['end'], colvar=.06, seed=5)
    fz = sign_c.z + SD / 2 + .012
    for (a, b, w) in (((-SW / 2 + .02, sy + SH / 2 - .035), (SW / 2 - .02, sy + SH / 2 - .035), .055), ((-SW / 2 + .02, sy - SH / 2 + .035), (SW / 2 - .02, sy - SH / 2 + .035), .055)):
        beam(pc, (a[0], a[1], fz), (b[0], b[1], fz), .03, w, up=(0, 0, 1), mat=TIMBER, col=C['sign_dark'], ch=.008, cap_col=C['sign_dark'])
    for xx in (-SW / 2 + .035, SW / 2 - .035):
        beam(pc, (xx, sy - SH / 2 + .065, fz), (xx, sy + SH / 2 - .065, fz), .055, .03, up=(0, 0, 1), mat=TIMBER, col=C['sign_dark'], ch=.008, cap_col=C['sign_dark'])
    for sx in (-1, 1):   # rings from the rod to eye bolts in the board
        torus(pc, (sx * .48, rod_y - .05, -.08), ZA, .045, .009, 10, 4, IRON, C['iron'])
        rivet(pc, (sx * .48, sy + SH / 2 + .004, -.08), YA, .02)
    # emblem: a pick crossed behind a salt crystal (cube seen corner-on reads as a carved hexagon)
    hx, hy = sign_c.x, sy
    pz = fz + .005
    h0 = Vector((hx - .46, hy - .23, pz)); h1 = Vector((hx + .32, hy + .15, pz))
    beam(pc, h0, h1, .034, .028, up=(0, 0, 1), mat=TIMBER, col=C['timber_c'], ch=.008, cap_col=C['end'])
    dvec = (h1 - h0).normalized(); perp = Vector((-dvec.y, dvec.x, 0))
    arc = [h1 + perp * (.2 * s) - dvec * (.08 * s * s) for s in (-1, -.5, 0, .5, 1)]
    for i in range(4):
        tp = .5 if i in (0, 3) else 1.0
        a_, b_ = (arc[i], arc[i + 1]) if i >= 2 else (arc[i + 1], arc[i])
        beam(pc, a_ + Vector((0, 0, .008)), b_ + Vector((0, 0, .008)), .05, .03, up=(0, 0, 1), mat=IRON, col=C['iron'], ch=.008, taper=tp)
    ccen = Vector((hx - .08, hy, sign_c.z + .01))
    crystal(pc, ccen, rot_up((0, 0, 1), 0.0, CORNER_UP), (.14, .14, .14), C['cr_rose'], .9, ch=.014, seed=3)
    # ---- lantern hook bracket on the right post
    hx0 = PX
    iron_plate(pc, (hx0, 2.52, PD / 2 + .011), (XA, YA, ZA), (.075, .13, .011), [(hx0, 2.43, PD / 2 + .022), (hx0, 2.61, PD / 2 + .022)])
    arm_y, arm_z = 2.56, .64
    beam(pc, (hx0, arm_y, PD / 2), (hx0, arm_y, arm_z), .034, .034, up=(0, 1, 0), mat=IRON, col=C['iron'], ch=.008)
    beam(pc, (hx0, 2.4, PD / 2), (hx0, arm_y - .01, arm_z - .12), .026, .026, up=(1, 0, 0), mat=IRON, col=C['iron'], ch=.006)
    beam(pc, (hx0, arm_y, arm_z - .01), (hx0, arm_y - .06, arm_z - .01), .022, .022, up=(0, 0, 1), mat=IRON, col=C['iron'], ch=.006)
    HR, Hr = .034, .0095
    hc = Vector((hx0, arm_y - .06, arm_z - .01 + HR))
    # J hook: angle 0 points -Z (meets the drop bar), -pi/2 is the bottom (-Y), then up the far side
    torus(pc, hc, XA, HR, Hr, 9, 5, IRON, C['iron'], a0=0.0, a1=-(math.pi + .9), ref=-ZA)
    # lantern ring (outer top = its origin) hangs on the hook: ring inner top touches the hook tube top at the bottom
    pc.anchors['lanternHook'] = None
    pc.hook_info = (hc, HR, Hr)
    return pc

def build_cluster():
    pc = Piece('SaltCluster', reach=.6)
    rng = np.random.default_rng(202)
    R0, H0 = .7, .3
    hgt = rock_dome(pc, 0, 0, R0, H0, 18, 6, seed=31, rough=.14)
    for k in range(7):
        th = TAU * k / 7 + rng.uniform(-.3, .3); r = rng.uniform(.52, .66); s = rng.uniform(.13, .21)
        rock_chunk(pc, (math.cos(th) * r, s * .35, math.sin(th) * r), (s, s * .7, s * .9), rng, white=rng.uniform(0, .3), seed=50 + k)
    base_faces = len(pc.F)
    bv = pc.bvh(0, base_faces)
    def surf(x, z):
        hit = bv.ray_cast(Vector((x, 3, z)), Vector((0, -1, 0)), 6)
        return hit[0].y if hit[0] is not None else 0.0
    def grow(x, z, d, half, col, mask, hopper=(), corner=False, spin=0.0, bury=.45, seed=0, ch=None, inner=None):
        d = Vector(d).normalized()
        lu = CORNER_UP if corner else YA
        R = rot_up(d, spin, lu)
        ext = max(half) * (1.6 if corner else 1.0)
        c = Vector((x, surf(x, z), z)) + d * ext * (1 - bury)
        crystal(pc, c, R, half, col, mask, ch=ch, hopper=hopper, seed=seed, inner=inner)
        return c, R
    # the showpiece: a big hopper cube, leaning a little, with a corner-up cube intergrown on its shoulder
    c0, R0m = grow(.02, -.02, (.16, 1, -.22), (.34, .34, .34), C['cr_pale'], .55, hopper={(1, 1), (0, 1), (2, 1), (0, -1), (2, -1)}, spin=.55, bury=.3, seed=1)
    top = c0 + R0m @ Vector((-.14, .3, -.12))
    d = (R0m @ Vector((-.3, 1, -.25))).normalized()
    crystal(pc, top + d * .06, rot_up(d, .9, CORNER_UP), (.2, .2, .2), C['cr_milk'], .6, hopper={(0, 1), (1, 1), (2, 1)}, steps=2, seed=2)
    # stepped stack: a rose cube with a smaller one stepping off its edge
    cs, Rs = grow(.3, .22, (.55, 1, .45), (.17, .17, .17), C['cr_rose'], .6, hopper={(1, 1)}, spin=.3, bury=.35, seed=4)
    crystal(pc, cs + Rs @ Vector((.15, .13, .1)), Rs, (.1, .1, .1), C['cr_rose'], .6, seed=5)
    # a second tower leaning out the back-left, deep rose
    c3, R3 = grow(-.3, -.22, (-.5, 1, -.35), (.16, .27, .16), C['cr_deep'], .75, hopper={(1, 1)}, spin=.2, bury=.35, seed=3, inner=C['cr_inner_deep'])
    crystal(pc, c3 + R3 @ Vector((.1, .2, -.08)), R3, (.08, .08, .08), C['cr_deep'], .8, seed=6, inner=C['cr_inner_deep'])
    ring = [(.0, .5, .15, False, C['cr_pale'], True), (1.15, .46, .13, True, C['cr_pale'], False), (1.75, .5, .17, False, C['cr_milk'], True),
            (2.45, .44, .11, True, C['cr_deep'], False), (3.2, .5, .14, False, C['cr_rose'], False), (4.0, .46, .12, True, C['cr_milk'], False),
            (4.75, .5, .16, False, C['cr_pale'], True), (5.5, .44, .1, True, C['cr_rose'], False)]
    for k, (th, r, s, corner, col, hop) in enumerate(ring):
        th += rng.uniform(-.15, .15)
        x, z = math.cos(th) * r, math.sin(th) * r
        tilt = rng.uniform(.5, .85)
        d = (math.cos(th) * math.sin(tilt), math.cos(tilt), math.sin(th) * math.sin(tilt))
        deep = col == C['cr_deep']
        grow(x, z, d, (s, s * rng.uniform(1.0, 1.25), s), col, .75 if deep else .5, hopper={(1, 1)} if hop else (), corner=corner,
             spin=rng.uniform(0, TAU), bury=.45, seed=10 + k, inner=C['cr_inner_deep'] if deep else None)
    for k in range(12):
        th = rng.uniform(0, TAU); r = rng.uniform(.5, .7); s = rng.uniform(.03, .065)
        x, z = math.cos(th) * r, math.sin(th) * r
        d = (math.cos(th) * .7, 1, math.sin(th) * .7)
        grow(x, z, d, (s, s, s), [C['cr_pale'], C['cr_milk'], C['cr_rose']][k % 3], .5, corner=k % 2 == 0, spin=rng.uniform(0, TAU), bury=.4, seed=30 + k, ch=0.0 if s < .045 else None)
    return pc

def build_cluster_small():
    pc = Piece('SaltClusterSmall', reach=.3)
    rng = np.random.default_rng(303)
    rock_dome(pc, 0, 0, .25, .1, 10, 3, seed=61, rough=.16)
    bv = pc.bvh()
    def surf(x, z):
        hit = bv.ray_cast(Vector((x, 2, z)), Vector((0, -1, 0)), 4); return hit[0].y if hit[0] is not None else 0.0
    d = Vector((.2, 1, .12)).normalized(); R = rot_up(d, .4)
    c0 = Vector((.02, surf(.02, 0), 0)) + d * .14 * .7
    crystal(pc, c0, R, (.14, .14, .14), C['cr_pale'], .55, hopper={(1, 1)}, steps=2, seed=1)
    crystal(pc, c0 + R @ Vector((-.15, .12, .06)), R, (.075, .075, .075), C['cr_milk'], .6, seed=2)
    for k, (th, r, s, col) in enumerate(((.6, .17, .07, C['cr_rose']), (2.6, .18, .06, C['cr_milk']), (4.4, .16, .075, C['cr_deep']))):
        x, z = math.cos(th) * r, math.sin(th) * r
        dd = Vector((math.cos(th) * .8, 1, math.sin(th) * .8)).normalized()
        crystal(pc, Vector((x, surf(x, z), z)) + dd * s * .5, rot_up(dd, rng.uniform(0, TAU), CORNER_UP if k == 1 else YA), (s, s * 1.15, s), col,
                .75 if col == C['cr_deep'] else .5, seed=3 + k, inner=C['cr_inner_deep'] if col == C['cr_deep'] else None)
    for k, th in enumerate((1.5, 3.6)):
        x, z = math.cos(th) * .22, math.sin(th) * .22; s = .028
        crystal(pc, Vector((x, surf(x, z) + s * .3, z)), rot_up((math.cos(th), 1.5, math.sin(th)), th), (s, s, s), C['cr_pale'], .5, ch=0.0, seed=9 + k)
    return pc

def build_timberset():
    pc = Piece('TimberSet', reach=.6)
    rng = np.random.default_rng(404)
    W, H, PW, PD = 3.4, 3.1, .30, .32
    PX = W / 2 + PW / 2
    for sx in (-1, 1):
        timber_beam(pc, (sx * PX, -.05, 0), (sx * PX, H + .03, 0), PW, PD, rng, up=(0, 0, 1), segs=4, taper=.94)
        crust_lumps(pc, sx * PX, 0, PW / 2, PD / 2, 6, rng, top=.26, crystals=1, seed=70 + sx)
        iron_plate(pc, (sx * PX, H - .04, PD / 2 + .01), (XA, YA, ZA), (.09, .2, .01), [(sx * PX, H - .17, PD / 2 + .02), (sx * PX, H + .1, PD / 2 + .02)])
        # shim wedge driven in at the post head
        x0 = sx * (PX - PW / 2)
        hull(pc, [(x0, H - .005, -.1), (x0, H - .005, .1), (x0 - sx * .2, H - .005, -.1), (x0 - sx * .2, H - .005, .1),
                  (x0, H - .1, -.1), (x0, H - .1, .1)], TIMBER, lambda p, n: C['timber_c'])
    timber_beam(pc, (-2.12, H + .17, 0), (2.12, H + .17, 0), .34, .34, rng, up=(0, 1, 0), segs=4, taper=1.0, ch=.045, shade=C['timber_b'])
    for k, x in enumerate((-1.25, -.05, 1.15)):   # lagging wedges between cap and rock
        L, t0 = .42, .11
        sg = 1 if k % 2 else -1
        hull(pc, [(x - L / 2, H + .335, -.12), (x + L / 2, H + .335, -.12), (x - L / 2, H + .335, .12), (x + L / 2, H + .335, .12),
                  (x - sg * L / 2, H + .335 + t0, -.12), (x - sg * L / 2, H + .335 + t0, .12), (x + sg * L / 2, H + .335 + .015, -.12), (x + sg * L / 2, H + .335 + .015, .12)],
             TIMBER, lambda p, n: C['timber_c'] if n.y > .5 else mul(C['end'], .85))
    return pc

RAIL_TOP = .20
LANTERN_SCALE = 1.25   # authored at 0.41 m, scaled to read on a 3.8 m portal
GAUGE = .60
def build_rail():
    pc = Piece('RailStraight', reach=.2, ray_off=.003)
    rng = np.random.default_rng(505)
    for k in range(4):
        z = -.75 + .5 * k + rng.uniform(-.02, .02); dz = rng.uniform(-.03, .03)
        beam(pc, (-.48, .045, z - dz), (.48, .045, z + dz), .2, .11, up=(0, 1, 0), mat=TIMBER, col=mix(C['timber_b'], C['timber_grey'], .5),
             ch=.02, segs=1, cap_col=mix(C['end'], C['timber_grey'], .4), colvar=.1, seed=k, uv_off=k * .37)
    hx = GAUGE / 2 + .022
    for sx in (-1, 1):
        xc = sx * hx
        prof = [(-.035, .1), (.035, .1), (.035, .112), (.009, .124), (.009, .176), (.022, .182), (.022, RAIL_TOP), (-.022, RAIL_TOP),
                (-.022, .182), (-.009, .176), (-.009, .124), (-.035, .112)]
        n = len(prof)
        rows = []
        for z in (-1.0, 1.0):
            rows.append([pc.v((xc + x, y, z), mix(C['iron'], C['rivet'], .5) if y >= RAIL_TOP - .001 else C['iron_dark']) for x, y in prof])
        for j in range(n):
            j2 = (j + 1) % n
            mx, my = (prof[j][0] + prof[j2][0]) / 2, (prof[j][1] + prof[j2][1]) / 2
            dx, dy = prof[j2][0] - prof[j][0], prof[j2][1] - prof[j][1]
            pc.f([rows[0][j], rows[0][j2], rows[1][j2], rows[1][j]], IRON, True, None, out=Vector((dy, -dx, 0)))
        for r, sg in ((rows[0], -1), (rows[1], 1)):
            pc.f([pc.v(pc.P[i], C['iron']) for i in r], IRON, True, None, out=Vector((0, 0, sg)))
        for k in range(4):
            z = -.75 + .5 * k
            rivet(pc, (xc + sx * .05, .102, z + .04 * sx), YA, .02, k=5, col=C['iron_dark'])
    return pc

def build_cart():
    pc = Piece('MineCart', reach=.45)
    rng = np.random.default_rng(606)
    WR = .16; AXY = RAIL_TOP + WR; WX = GAUGE / 2 + .022; WZ = .40
    for sx in (-1, 1):
        for sz in (-1, 1):
            prof = [(0, .05), (.05, .05), (.125, .03), (WR, .03), (WR, -.025), (WR + .03, -.034), (WR + .03, -.046), (.06, -.04), (0, -.04)]
            def wc(i, j, p): return C['rivet'] if i in (3, 4) else (C['iron_dark'] if i >= 5 else C['iron'])
            lathe(pc, (sx * WX, AXY, sz * WZ), (sx, 0, 0), prof, 14, IRON, wc, ref=(0, 1, 0), phase=.2 * sz)
            for k in range(4):
                th = TAU * k / 4 + .4
                rivet(pc, (sx * (WX + .044), AXY + math.cos(th) * .085, sz * WZ + math.sin(th) * .085), (sx, 0, 0), .014, k=5)
        pass
    for sz in (-1, 1):
        beam(pc, (-WX + .03, AXY, sz * WZ), (WX - .03, AXY, sz * WZ), .05, .05, up=(0, 1, 0), mat=IRON, col=C['iron_dark'], ch=.015)
    for sx in (-1, 1):   # sills straddling the axles
        timber_beam(pc, (sx * .2, AXY + .01, -.7), (sx * .2, AXY + .01, .7), .12, .15, rng, up=(0, 1, 0), segs=2, taper=1.0, ch=.02)
        for sz in (-1, 1):
            box(pc, (sx * .265, AXY, sz * WZ), (ZA, YA, XA), (.06, .06, .012), mat=IRON, col=C['iron'], ch=.01)
    for z in (-.42, 0, .42):   # bolsters carrying the tub
        timber_beam(pc, (-.34, .51, z), (.34, .51, z), .12, .13, rng, up=(0, 1, 0), segs=1, taper=1.0, ch=.02)
    for sz in (-1, 1):   # buffers with an iron face and a coupling link
        timber_beam(pc, (-.36, .43, sz * .76), (.36, .43, sz * .76), .14, .17, rng, up=(0, 1, 0), segs=2, taper=1.0, ch=.025)
        box(pc, (0, .43, sz * .837), (XA, YA, ZA), (.3, .07, .008), mat=IRON, col=C['iron'])
        for dx in (-.24, .24): rivet(pc, (dx, .43, sz * .846), (0, 0, sz), .018)
        box(pc, (0, .43, sz * .855), (XA, YA, ZA), (.04, .04, .02), mat=IRON, col=C['iron_dark'])
        torus(pc, (0, .37, sz * .9), (1, 0, 0), .05, .011, 10, 4, IRON, C['iron'])
    # the tub: tapered, planked, iron-banded
    BX, BZ, Y0, TX, TZ, Y1 = .36, .56, .575, .49, .70, 1.12
    TH = .055
    def side_pt(t, side):   # side 'x' or 'z'
        return lerp(BX, TX, t), lerp(Y0, Y1, t), lerp(BZ, TZ, t)
    NPL = 3
    for k in range(NPL):
        t0, t1 = k / NPL + .006, (k + 1) / NPL - .006; tc = (t0 + t1) / 2
        x, y, z = side_pt(tc, 'x')
        wdt = math.hypot(TX - BX, Y1 - Y0) * (t1 - t0)
        for sx in (-1, 1):
            nrm = Vector((sx * (Y1 - Y0), -(TX - BX), 0)).normalized()
            c = Vector((sx * x, y, 0)) - nrm * TH / 2
            slope = Vector((sx * (TX - BX), Y1 - Y0, 0)).normalized()
            timber_beam(pc, c - ZA * (z + .01), c + ZA * (z + .01), TH, wdt, rng, up=slope, segs=2, taper=1.0, ch=.012)
        for sz in (-1, 1):
            nrm = Vector((0, -(TZ - BZ), sz * (Y1 - Y0))).normalized()
            c = Vector((0, y, sz * z)) - nrm * TH / 2
            slope = Vector((0, Y1 - Y0, sz * (TZ - BZ))).normalized()
            timber_beam(pc, c - XA * (x - .01), c + XA * (x - .01), TH, wdt, rng, up=slope, segs=2, taper=1.0, ch=.012)
    box(pc, (0, Y0 + .02, 0), (XA, YA, ZA), (BX - .01, .025, BZ - .01), mat=TIMBER, col=C['timber_b'])
    def band(t, hh, rivets_x, rivets_z):
        x, y, z = side_pt(t, 'x'); o = .012
        for sx in (-1, 1):
            nrm = Vector((sx * (Y1 - Y0), -(TX - BX), 0)).normalized(); slope = Vector((sx * (TX - BX), Y1 - Y0, 0)).normalized()
            c = Vector((sx * x, y, 0)) + nrm * o
            beam(pc, c - ZA * (z + .025), c + ZA * (z + .025), .022, hh, up=slope, mat=IRON, col=C['iron'], ch=.006)
            for rz in rivets_z: rivet(pc, c + nrm * .012 + ZA * rz * z, nrm, .017)
        for sz in (-1, 1):
            nrm = Vector((0, -(TZ - BZ), sz * (Y1 - Y0))).normalized(); slope = Vector((0, Y1 - Y0, sz * (TZ - BZ))).normalized()
            c = Vector((0, y, sz * z)) + nrm * o
            beam(pc, c - XA * (x + .025), c + XA * (x + .025), .022, hh, up=slope, mat=IRON, col=C['iron'], ch=.006)
            for rx in rivets_x: rivet(pc, c + nrm * .012 + XA * rx * x, nrm, .017)
    band(.94, .075, (-.55, .55), (-.6, 0, .6))
    band(.42, .06, (-.55, .55), (-.6, 0, .6))
    for sx in (-1, 1):
        for sz in (-1, 1):
            a = Vector((sx * (BX + .01), Y0 - .01, sz * (BZ + .01))); b = Vector((sx * (TX + .015), Y1 + .01, sz * (TZ + .015)))
            beam(pc, a, b, .075, .075, up=(sx, 0, sz), mat=IRON, col=C['iron'], ch=.01)
    for sz in (-1, 1):   # grab handle on each end
        zz = sz * (TZ + .03); yy = 1.0
        for sx in (-1, 1):
            beam(pc, (sx * .17, yy, sz * (TZ - .005)), (sx * .17, yy, sz * (TZ + .1)), .03, .03, up=(0, 1, 0), mat=IRON, col=C['iron'], ch=.008)
        beam(pc, (-.19, yy, sz * (TZ + .1)), (.19, yy, sz * (TZ + .1)), .034, .034, up=(0, 1, 0), mat=IRON, col=C['iron'], ch=.01)
    # heaped pink salt
    hb0 = len(pc.F)
    rx, rz, yb, ytop = .46, .66, 1.05, 1.3
    rows = []
    cen = pc.v((0, ytop, 0), rock_col((0, ytop, 0), 81)[0], .3)
    for i in range(1, 5):
        rr = i / 4; row = []
        for j in range(16):
            th = TAU * (j + .5 * (i % 2)) / 16
            y = yb + (ytop - yb) * (1 - rr ** 2) + (vnoise(math.cos(th) * 3, math.sin(th) * 3, i, 9) - .5) * .05
            p = Vector((math.cos(th) * rx * rr, y, math.sin(th) * rz * rr))
            cc, m = rock_col(p, 81, white=.15); row.append(pc.v(p, cc, m))
        rows.append(row)
    for j in range(16):
        pc.f([cen, rows[0][j], rows[0][(j + 1) % 16]], ROCK, False, None, out=YA)
    for i in range(3):
        for j in range(16):
            j2 = (j + 1) % 16
            pc.f([rows[i][j], rows[i][j2], rows[i + 1][j2]], ROCK, False, None, out=YA)
            pc.f([rows[i][j], rows[i + 1][j2], rows[i + 1][j]], ROCK, False, None, out=YA)
    bv = pc.bvh(hb0)
    for k in range(17):
        th = rng.uniform(0, TAU); rr = math.sqrt(rng.uniform(0, 1)) * .9
        x, z = math.cos(th) * rx * rr, math.sin(th) * rz * rr
        hit = bv.ray_cast(Vector((x, 3, z)), Vector((0, -1, 0)), 5)
        y = hit[0].y if hit[0] else yb
        s = rng.uniform(.07, .13)
        rock_chunk(pc, (x, y + s * .25, z), (s, s * .75, s * .85), rng, white=rng.uniform(0, .5), seed=90 + k, cut=.5)
    for k in range(5):
        th = TAU * k / 5 + .3; rr = .45
        x, z = math.cos(th) * rx * rr, math.sin(th) * rz * rr
        hit = bv.ray_cast(Vector((x, 3, z)), Vector((0, -1, 0)), 5); y = hit[0].y if hit[0] else yb
        s = rng.uniform(.05, .08)
        crystal(pc, (x, y + s * .5, z), rot_up((math.cos(th) * .5, 1, math.sin(th) * .5), rng.uniform(0, TAU), CORNER_UP if k % 2 else YA),
                (s, s, s), [C['cr_pale'], C['cr_rose'], C['cr_milk'], C['cr_deep'], C['cr_pale']][k], .6, seed=k)
    return pc

def build_lantern():
    pc = Piece('Lantern', floor=False, reach=.14, ray_off=.0015)
    R, r = .03, .0075
    torus(pc, (0, -R - r, 0), ZA, R, r, 12, 5, BRASS, C['brass'], ref=XA)
    def bc(dark_rows=(), light_rows=()):
        def f(i, j, p):
            if i in dark_rows: return C['brass_dark']
            if i in light_rows: return C['brass_light']
            return C['brass']
        return f
    lathe(pc, (0, 0, 0), YA, [(0, -.06), (.013, -.062), (.017, -.075), (.013, -.084)], 10, BRASS, bc())
    lathe(pc, (0, 0, 0), YA, [(0, -.08), (.03, -.082), (.032, -.092), (.032, -.11), (.05, -.114), (.085, -.135), (.102, -.158), (.104, -.17), (.088, -.176)],
          14, BRASS, bc(dark_rows=(2, 3), light_rows=(6,)))
    for k in range(6):   # chimney vent holes
        th = TAU * k / 6
        box(pc, (math.cos(th) * .0325, -.101, math.sin(th) * .0325), (Vector((-math.sin(th), 0, math.cos(th))), YA, Vector((math.cos(th), 0, math.sin(th)))),
            (.007, .007, .003), mat=IRON, col=C['iron_dark'])
    lathe(pc, (0, 0, 0), YA, [(.07, -.17), (.088, -.195), (.096, -.24), (.091, -.285), (.074, -.315), (.064, -.325)], 14, GLOW, lambda i, j, p: C['glow'], ao=0.0)
    gr = [(.07, -.17), (.088, -.195), (.096, -.24), (.091, -.285), (.074, -.315)]
    for k in range(4):   # cage wires
        th = TAU * k / 4 + math.pi / 4
        e = Vector((math.cos(th), 0, math.sin(th)))
        pts = [e * (rr + .011) + YA * y for rr, y in gr]
        pts = [e * .09 + YA * -.165] + pts[1:] + [e * .085 + YA * -.322]
        for i in range(len(pts) - 1):
            beam(pc, pts[i], pts[i + 1], .011, .011, up=e, mat=BRASS, col=C['brass'], ch=0.0, caps=(i == 0, i == len(pts) - 2))
    torus(pc, (0, -.24, 0), YA, .108, .0065, 16, 4, BRASS, C['brass_light'], ref=XA)
    lathe(pc, (0, 0, 0), YA, [(.062, -.318), (.09, -.324), (.102, -.338), (.104, -.37), (.094, -.39), (.06, -.404), (0, -.407)], 14, BRASS,
          bc(dark_rows=(1,), light_rows=(3,)))
    beam(pc, (0, -.36, .1), (0, -.36, .13), .02, .02, up=(0, 1, 0), mat=BRASS, col=C['brass_dark'], ch=.005)
    lathe(pc, (0, -.36, .13), ZA, [(0, .012), (.016, .01), (.016, -.004), (0, -.004)], 8, BRASS, bc(), ref=XA)
    pc.P = [p * LANTERN_SCALE for p in pc.P]
    return pc

def build_vent():
    pc = Piece('FiredampVent', reach=.35)
    NS = 56
    ang = .35
    def rot(x, z): return x * math.cos(ang) - z * math.sin(ang), x * math.sin(ang) + z * math.cos(ang)
    TS = [-.7, -.4, 0, .06, .16, .3, .47, .66, .84, 1.0]
    HT = [.035, .12, .29, .345, .35, .31, .23, .13, .055, -.03]
    cracks = [3, 12, 21, 30, 38, 47]
    rows = []
    for i, t in enumerate(TS):
        row = []
        for j in range(NS):
            th = TAU * j / NS
            jag = 1 + .3 * (vnoise(math.cos(th) * 3.1, math.sin(th) * 3.1, 0, 41) - .5) * 2
            bx, bz = .29 * math.cos(th) * jag, .13 * math.sin(th) * jag
            ox, oz = .6 * math.cos(th) * (1 + .07 * (vnoise(math.cos(th) * 2, math.sin(th) * 2, 5, 43) - .5) * 2), .6 * math.sin(th)
            if t < 0:
                k = 1 + t; x, z = bx * k, bz * k
            else:
                x, z = lerp(bx, ox, t), lerp(bz, oz, t)
            x, z = rot(x, z)
            y = HT[i] + (vnoise(x * 6, z * 6, 1, 44) - .5) * .05 * (1 - abs(t)) * (1 if t >= 0 else .4)
            crack = 0.0
            if t > .03 and i < len(TS) - 1:
                for cj in cracks:
                    wig = int(round((vnoise(cj, t * 4, 2, 45) - .5) * 2.4))
                    if j == (cj + wig) % NS: crack = 1.0
                    elif j == (cj + wig + 1) % NS: crack = max(crack, .8)
                    elif j == (cj + wig - 1) % NS: crack = max(crack, .3)
                y -= .06 * crack * (1 - .5 * t)
            p = Vector((x, y, z))
            if t < 0:
                col = mix(C['fissure'], mul(C['rock_dark'], .4), clamp(1 + t * 2.2) * .35); m = 0.0
            else:
                col, m = rock_col(p, 47, grey=.35)
                crust = smoothstep(.5, .62, fbm((x * 3, 0, z * 3), 48, 3))
                col = mix(col, C['crust'], crust * .85); m = .05 + .15 * crust
                col = mix(col, C['stain'], smoothstep(.25, .05, t) * .3)
                if t == 0: col = mix(col, C['fissure'], .75); m = 0.0
                col = mix(col, C['fissure'], crack * .9)
            row.append(pc.v(p, col, m))
        rows.append(row)
    for i in range(len(TS) - 1):
        for j in range(NS):
            j2 = (j + 1) % NS
            a, b, c2, d = rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]
            cen = (pc.P[a] + pc.P[c2]) / 2
            if TS[i] < 0: out = Vector((-cen.x, 0, -cen.z)) + YA * .3
            else: out = Vector((cen.x, 0, cen.z)) * .3 + YA
            pc.f([a, b, c2, d], ROCK, True, None, out=out)
    bot = pc.v((0, .03, 0), C["fissure"], 0.0)
    for j in range(NS):
        pc.f([bot, rows[0][j], rows[0][(j + 1) % NS]], ROCK, True, None, out=YA)
    rng = np.random.default_rng(707)
    bv = pc.bvh()
    for k in range(9):   # crust plates round the mouth
        th = TAU * k / 9 + rng.uniform(-.2, .2); t = rng.uniform(.1, .45)
        x, z = rot(lerp(.27 * math.cos(th), .6 * math.cos(th), t), lerp(.085 * math.sin(th), .6 * math.sin(th), t))
        hit = bv.ray_cast(Vector((x, 2, z)), Vector((0, -1, 0)), 4); y = hit[0].y if hit[0] else .2
        s = rng.uniform(.05, .09)
        R = Matrix.Rotation(rng.uniform(0, TAU), 3, YA) @ Matrix.Rotation(rng.uniform(-.25, .25), 3, XA)
        hull(pc, chunk_points((x, y, z), (s, s * .3, s * .8), R, rng, cut=.6, jitter=.2), ROCK,
             lambda p, n: mul(C['crust'] if k % 3 else C['crust_pink'], 1.02 if n.y > .5 else .93), mask=.15)
    for k in range(4):
        th = TAU * k / 4 + .7; t = .55
        x, z = rot(.6 * math.cos(th) * t + .27 * math.cos(th) * (1 - t), .6 * math.sin(th) * t)
        hit = bv.ray_cast(Vector((x, 2, z)), Vector((0, -1, 0)), 4); y = hit[0].y if hit[0] else .2
        s = .03
        crystal(pc, (x, y + s * .3, z), rot_up((x, .6, z), th, CORNER_UP if k % 2 else YA), (s, s, s), C['cr_milk'], .45, ch=0.0, seed=k)
    return pc

def build_rubble():
    pc = Piece('RubblePile', reach=.45)
    rng = np.random.default_rng(808)
    rock_dome(pc, 0, 0, .72, .17, 20, 4, seed=91, rough=.18, grey=.35, white=.1)
    def heap(r): return .58 * max(0, 1 - (r / .7) ** 2) ** 1.1
    # a broken support spar under the fall
    timber_beam(pc, (-.66, .08, .36), (.3, .6, -.12), .16, .14, rng, up=(0, 1, 0), segs=3, taper=1.0, ch=.025, caps=(True, False))
    e = Vector((.3, .6, -.12)); d = (e - Vector((-.66, .08, .36))).normalized()
    t, s, u = frame_from(d, YA)
    spl = []
    for k in range(10):
        a = TAU * k / 10; rr = .085
        spl.append(e - d * .02 + s * math.cos(a) * rr + u * math.sin(a) * rr * .85)
        spl.append(e + d * rng.uniform(.03, .16) + s * math.cos(a) * rr * .45 + u * math.sin(a) * rr * .4)
    hull(pc, spl, TIMBER, lambda p, n: mix(C['end'], C['timber_a'], .4))
    kinds = [(0, .0), (.75, 0), (0, .75), (.2, .3), (1.0, 0), (0, .0), (0, .55)]
    layers = [(10, .38, .7, .15, .22), (9, .25, .5, .11, .17), (6, .12, .3, .09, .14), (2, .0, .1, .08, .11)]
    k = 0
    for count, rmin, rmax, smin, smax in layers:
        for q in range(count):
            th = TAU * (q + rng.uniform(-.3, .3)) / count + k * .37; r = rng.uniform(rmin, rmax)
            x, z = math.cos(th) * r, math.sin(th) * r * .92
            sz = rng.uniform(smin, smax)
            y = heap(r) - sz * .25
            white, grey = kinds[k % len(kinds)]
            rock_chunk(pc, (x, max(y, sz * .4), z), (sz, sz * rng.uniform(.6, .85), sz * rng.uniform(.7, 1.0)), rng, white=white, grey=grey,
                       seed=100 + k, cut=.45)
            k += 1
    for q in range(14):   # gravel
        th = rng.uniform(0, TAU); r = rng.uniform(.5, .74); sz = rng.uniform(.03, .055)
        rock_chunk(pc, (math.cos(th) * r, sz * .3, math.sin(th) * r), (sz, sz * .7, sz * .8), rng, white=rng.uniform(0, .6), grey=rng.uniform(0, .6), seed=200 + q, cut=.2)
    return pc

def build_brine():
    pc = Piece('BrineRim', reach=.4)
    NS = 96
    PROF = [(.80, -.16), (.835, -.05), (.855, .02), (.88, .075), (.925, .112), (.975, .125), (1.025, .1), (1.068, .045), (1.1, -.035)]
    def pts():
        rows = []
        for i, (r0, y0) in enumerate(PROF):
            row = []
            for j in range(NS):
                th = TAU * j / NS
                lobe = .035 * math.sin(7 * th + 2.2 * vnoise(math.cos(th) * 2, math.sin(th) * 2, 0, 51)) + .05 * (vnoise(math.cos(th) * 1.4, math.sin(th) * 1.4, 1, 52) - .5)
                r = r0 + lobe
                x, z = math.cos(th) * r, math.sin(th) * r
                crest = math.exp(-((i - 4.6) / 1.8) ** 2)
                y = y0 + crest * (.09 * (vnoise(x * 3.5, z * 3.5, 2, 53) - .5) + .04 * (vnoise(x * 9, z * 9, 3, 54) - .5))
                # polygonal evaporite ridges, salt-flat style
                ridge = 0.0
                if 2 <= i <= 7:
                    best, second = 9.0, 9.0
                    gx, gz = x / .16, z / .16
                    for di in (-1, 0, 1):
                        for dj in (-1, 0, 1):
                            ci, cj = math.floor(gx) + di, math.floor(gz) + dj
                            px = ci + .5 + (_hash(ci, cj, 0, 55) - .5) * .8; pz = cj + .5 + (_hash(ci, cj, 1, 55) - .5) * .8
                            dd = math.hypot(gx - px, gz - pz)
                            if dd < best: best, second = dd, best
                            elif dd < second: second = dd
                    ridge = math.exp(-((second - best) / .18) ** 2) * crest
                    y += .03 * ridge
                p = Vector((x, y, z))
                col = mix(C['crust'], C['crust_pink'], .5 + .5 * (vnoise(x * 2, z * 2, 4, 56)))
                col = mix(col, mul(C['rock_pink'], .95), (1 - ridge) * crest * .3)
                col = mix(col, (1.0, 1.0, 1.0), ridge * .7)
                if i <= 1: col = mix(col, mul(C['rock_rose'], .75), .6 if i == 0 else .45)
                if i == 2: col = mix(col, C['rock_pink'], .25)
                if i == 8: col = mix(col, C['rock_grey'], .45)
                row.append(pc.v(p, col, .12 + .2 * ridge + .1 * crest))
            rows.append(row)
        return rows
    rows = pts()
    for i in range(len(PROF) - 1):
        dr, dh = PROF[i + 1][0] - PROF[i][0], PROF[i + 1][1] - PROF[i][1]
        for j in range(NS):
            j2 = (j + 1) % NS
            th = TAU * (j + .5) / NS
            pc.f([rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]], ROCK, True, None,
                 out=Vector((math.cos(th), 0, math.sin(th))) * (-dh) + YA * dr)
    rng = np.random.default_rng(909)
    bv = pc.bvh()
    for k in range(22):   # evaporite plates heaved up on the crest
        th = TAU * (k + rng.uniform(-.3, .3)) / 22; r = rng.uniform(.9, 1.04)
        x, z = math.cos(th) * r, math.sin(th) * r
        hit = bv.ray_cast(Vector((x, 2, z)), Vector((0, -1, 0)), 4); y = hit[0].y if hit[0] else .1
        sz = rng.uniform(.05, .09)
        R = Matrix.Rotation(rng.uniform(0, TAU), 3, YA) @ Matrix.Rotation(rng.uniform(-.35, .35), 3, XA)
        tint = rng.uniform(0, .6)
        hull(pc, chunk_points((x, y, z), (sz, sz * .35, sz * .75), R, rng, cut=.6, jitter=.2), ROCK,
             lambda p, n, tint=tint: mul(mix(C['crust'], C['crust_pink'], tint), 1.03 if n.y > .5 else .9), mask=.2)
    for k in range(30):   # cubes grown at the waterline
        th = TAU * (k + rng.uniform(-.35, .35)) / 30
        lobe = .035 * math.sin(7 * th + 2.2 * vnoise(math.cos(th) * 2, math.sin(th) * 2, 0, 51)) + .05 * (vnoise(math.cos(th) * 1.4, math.sin(th) * 1.4, 1, 52) - .5)
        r = .86 + lobe - .01; s = rng.uniform(.018, .04) if k % 5 else rng.uniform(.045, .06)
        c = Vector((math.cos(th) * r, rng.uniform(-.005, .04), math.sin(th) * r))
        d = Vector((-math.cos(th) * .7, 1, -math.sin(th) * .7))
        crystal(pc, c, rot_up(d, rng.uniform(0, TAU), CORNER_UP if k % 3 == 0 else YA), (s, s, s),
                [C['cr_milk'], C['cr_pale'], C['cr_milk'], C['cr_rose']][k % 4], .6, ch=None if s > .04 else 0.0, seed=k)
    return pc

BUILDERS = [('MinePortal', build_portal), ('TimberSet', build_timberset), ('RailStraight', build_rail), ('MineCart', build_cart),
            ('Lantern', build_lantern), ('SaltCluster', build_cluster), ('SaltClusterSmall', build_cluster_small),
            ('FiredampVent', build_vent), ('RubblePile', build_rubble), ('BrineRim', build_brine)]
BUDGET = {'TimberSet': 900, 'RailStraight': 300, 'SaltClusterSmall': 500}

# ===================================================================== finalize: explode flat faces, bake AO
DIRS = []
for i in range(32):
    u1, u2 = (i + .5) / 32, (i * .618033988749) % 1
    rr, phi = math.sqrt(u1), TAU * u2; DIRS.append(Vector((rr * math.cos(phi), rr * math.sin(phi), math.sqrt(1 - u1))))

def finalize(pc):
    P, Cc, M, A = [], [], [], []
    remap = {}
    F2, FUV2 = [], []
    vmat = []
    for fi, f in enumerate(pc.F):
        ids = []
        for i in f:
            if pc.FS[fi]:
                if i not in remap:
                    remap[i] = len(P); P.append(pc.P[i]); Cc.append(pc.C[i]); M.append(pc.M[i]); A.append(pc.AO[i]); vmat.append(pc.FM[fi])
                ids.append(remap[i])
            else:
                ids.append(len(P)); P.append(pc.P[i]); Cc.append(pc.C[i]); M.append(pc.M[i]); A.append(pc.AO[i]); vmat.append(pc.FM[fi])
        F2.append(ids)
    pc.P, pc.C, pc.M, pc.AO, pc.F = P, Cc, M, A, F2
    vn = [Vector() for _ in P]
    for f in F2:
        n = newell([P[i] for i in f])
        for i in f: vn[i] += n
    polys = [tuple(f) for f in F2]; verts = [tuple(p) for p in P]
    if pc.floor:
        b = len(verts); verts += [(-30, -.001, -30), (30, -.001, -30), (30, -.001, 30), (-30, -.001, 30)]; polys.append((b, b + 1, b + 2, b + 3))
    bvh = BVHTree.FromPolygons(verts, polys)
    reach, off = pc.reach, pc.ray_off
    out = []
    for i, p in enumerate(P):
        k = A[i]
        if k <= 0 or vn[i].length < 1e-12: out.append(Cc[i]); continue
        n = vn[i].normalized(); ref = XA if abs(n.x) < .9 else YA
        u = n.cross(ref).normalized(); w = n.cross(u); occ = 0.0
        o = p + n * off
        for d in DIRS:
            hit = bvh.ray_cast(o, u * d.x + w * d.y + n * d.z, reach)
            if hit[0] is not None: occ += 1 - (hit[3] / reach) ** .7
        ao = 1 - occ / len(DIRS)
        fac = lerp(1, lerp(AO_MIN[vmat[i]], 1, ao), k)
        out.append(mul(Cc[i], fac))
    pc.C = out

# ===================================================================== build
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
IMG_WOOD = make_image('SaltMineTimber', wood_texture())

def principled(m):
    m.use_nodes = True; return m.node_tree, m.node_tree.nodes['Principled BSDF']
MATS = []
for name, rough, metal in (('Timber', .78, 0), ('Iron', .48, .75), ('Brass', .3, .92), ('SaltRock', .82, 0), ('SaltCrystal', .26, 0), ('LanternGlow', .4, 0)):
    m = bpy.data.materials.new(name); nt, b = principled(m)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    if name == 'Timber':
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = IMG_WOOD
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'; nt.links.new(uvn.outputs['UV'], t.inputs['Vector'])
        nt.links.new(t.outputs['Color'], b.inputs['Base Color'])
    if name == 'LanternGlow':
        b.inputs['Base Color'].default_value = (1.0, .78, .5, 1)
        b.inputs['Emission Color'].default_value = (1.0, .62, .28, 1); b.inputs['Emission Strength'].default_value = 1.0
    m.use_backface_culling = True
    MATS.append(m)

wanted = arg('--pieces')
OBJS, PCS = {}, {}
for name, fn in BUILDERS:
    if wanted and name not in wanted.split(','): continue
    t1 = time.time()
    pc = fn()
    finalize(pc)
    used = sorted(set(pc.FM)); slot = {m: i for i, m in enumerate(used)}
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(to_b(p)) for p in pc.P], [], pc.F)
    for m in used: me.materials.append(MATS[m])
    me.polygons.foreach_set('material_index', [slot[m] for m in pc.FM])
    me.polygons.foreach_set('use_smooth', [bool(s) for s in pc.FS])
    uv0 = me.uv_layers.new(name='UVMap'); uv1 = me.uv_layers.new(name='Mask')
    l0, l1 = [], []
    for fi, f in enumerate(pc.F):
        for k, vi in enumerate(f):
            l0.extend(pc.FUV[fi][k]); l1.extend((pc.M[vi], 0.0))
    uv0.data.foreach_set('uv', l0); uv1.data.foreach_set('uv', l1)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    ca.data.foreach_set('color', np.array([(*c, 1.0) for c in pc.C], np.float32).ravel())
    me.color_attributes.active_color = ca
    try: me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception: pass
    me.update()
    me.set_sharp_from_angle(angle=math.radians(50))
    ob = bpy.data.objects.new(name, me); SC.collection.objects.link(ob)
    wn = ob.modifiers.new('WeightedNormal', 'WEIGHTED_NORMAL'); wn.mode = 'FACE_AREA'; wn.weight = 50; wn.keep_sharp = True
    OBJS[name] = ob; PCS[name] = pc
    tris = sum(len(f) - 2 for f in pc.F)
    print(f'{name}: {tris} tris, {len(pc.P)} verts ({time.time() - t1:.1f}s)', flush=True)

# lantern hook point on the portal, in the portal's frame (where the Lantern origin goes)
if 'MinePortal' in PCS:
    hc, HR, Hr = PCS['MinePortal'].hook_info
    # the hook arc's lowest point: centre - Y*HR; the ring's inner top rests on the tube's top surface there
    ring_r = .0075 * LANTERN_SCALE
    PCS['MinePortal'].anchors['lanternHook'] = [round(hc.x, 4), round(hc.y - HR + Hr + 2 * ring_r, 4), round(hc.z, 4)]

# ===================================================================== export + repack
def quantize_glb(path):
    raw = open(path, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl]); bin0 = raw[20 + jl + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    def read(ai):
        a = doc['accessors'][ai]; bv = doc['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
        assert bv.get('byteStride', n * np.dtype(dt).itemsize) == n * np.dtype(dt).itemsize, 'interleaved view'
        return np.frombuffer(bin0, dt, a['count'] * n, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n).copy()
    conv = {}
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']; mname = doc['materials'][prim['material']]['name']
            conv[at['NORMAL']] = 'normal'; conv[at['COLOR_0']] = 'colour16' if mname in ('Timber', 'Iron', 'Brass') else 'colour8'
            if 'TEXCOORD_0' in at and mname != 'Timber': conv[at['TEXCOORD_0']] = 'unorm2'
            if 'TEXCOORD_1' in at: conv[at['TEXCOORD_1']] = 'unorm2'
    out = bytearray(); views = []
    def push(data, target=None, stride=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        out.extend(data); views.append(v); return len(views) - 1
    remap = {}
    for vi in sorted({im['bufferView'] for im in doc.get('images', [])}):
        bv = doc['bufferViews'][vi]; o = bv.get('byteOffset', 0); remap[vi] = push(bin0[o:o + bv['byteLength']])
    for im in doc.get('images', []): im['bufferView'] = remap[im['bufferView']]
    for ai, a in enumerate(doc['accessors']):
        data = read(ai); kind = conv.get(ai); target = doc['bufferViews'][a['bufferView']].get('target'); a.pop('byteOffset', None)
        if kind and a.get('normalized'):   # the exporter may already write COLOR_0 / UVs as normalized integers
            data = data.astype(np.float64) / float(np.iinfo(CT[a['componentType']]).max)
        if kind == 'normal':
            q = np.clip(np.round(data / np.maximum(np.linalg.norm(data, axis=1, keepdims=True), 1e-9) * 127), -127, 127).astype(np.int8)
            q = np.concatenate([q, np.zeros((len(q), 1), np.int8)], 1)
            a.update(componentType=5120, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind == 'colour8':
            q = np.clip(np.round(data[:, :3] * 255), 0, 255).astype(np.uint8)
            q = np.concatenate([q, np.full((len(q), 1), 255, np.uint8)], 1)
            a.update(componentType=5121, normalized=True, type='VEC3'); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind == 'colour16':
            q = np.clip(np.round(data[:, :3] * 65535), 0, 65535).astype(np.uint16)
            q = np.concatenate([q, np.full((len(q), 1), 65535, np.uint16)], 1)
            a.update(componentType=5123, normalized=True, type='VEC3'); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target, 8)
        elif kind == 'unorm2':
            q = np.clip(np.round(data * 65535), 0, 65535).astype(np.uint16)
            a.update(componentType=5123, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target)
        else:
            a['bufferView'] = push(data.astype(CT[a['componentType']]).tobytes(), target)
    doc['bufferViews'] = views; doc['buffers'] = [{'byteLength': len(out)}]
    for k in ('extensionsUsed', 'extensionsRequired'): doc[k] = sorted(set(doc.get(k, [])) | {'KHR_mesh_quantization'})
    js = json.dumps(doc, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    while len(out) % 4: out.append(0)
    blob = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    open(path, 'wb').write(blob)

def inspect_glb(path):
    """Parse the exported GLB: node names, materials, per-node triangles, vertex colour / mask sanity."""
    raw = open(path, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl]); bin0 = raw[20 + jl + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    def read(ai):
        a = doc['accessors'][ai]; bv = doc['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = np.dtype(CT[a['componentType']])
        stride = bv.get('byteStride', n * dt.itemsize)
        base = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        arr = np.frombuffer(bin0, np.uint8, a['count'] * stride, base).reshape(a['count'], stride)[:, :n * dt.itemsize].copy().view(dt).reshape(a['count'], n).astype(np.float64)
        if a.get('normalized'): arr = arr / {np.int8: 127, np.uint8: 255, np.int16: 32767, np.uint16: 65535}[CT[a['componentType']]]
        return arr
    scene_nodes = doc['scenes'][doc.get('scene', 0)]['nodes']
    info = {}
    for ni in scene_nodes:
        nd = doc['nodes'][ni]; mesh = doc['meshes'][nd['mesh']]
        tris, verts, mats, lo, hi = 0, 0, [], np.full(3, 1e9), np.full(3, -1e9)
        cmin, cmax, glow_max = 1.0, 0.0, 0.0
        for pr in mesh['primitives']:
            tris += doc['accessors'][pr['indices']]['count'] // 3
            verts += doc['accessors'][pr['attributes']['POSITION']]['count']
            mn = doc['materials'][pr['material']]['name']; mats.append(mn)
            pos = read(pr['attributes']['POSITION']); lo = np.minimum(lo, pos.min(0)); hi = np.maximum(hi, pos.max(0))
            col = read(pr['attributes']['COLOR_0'])[:, :3]; cmin = min(cmin, col.min()); cmax = max(cmax, col.max())
            if mn != 'LanternGlow':
                assert (col.min(1) > .985).mean() < .25, (nd['name'], mn, 'COLOR_0 mostly white - authored colours lost')
            if mn in ('SaltRock', 'SaltCrystal'):
                assert 'TEXCOORD_1' in pr['attributes'], (nd['name'], mn, 'no TEXCOORD_1')
                glow_max = max(glow_max, read(pr['attributes']['TEXCOORD_1'])[:, 0].max())
        assert not any(k in nd for k in ('rotation', 'scale', 'translation')) or nd.get('translation', [0, 0, 0]) == [0, 0, 0], nd
        info[nd['name']] = {'triangles': tris, 'vertices': verts, 'materials': mats, 'bbox_min': [round(x, 3) for x in lo],
                            'bbox_max': [round(x, 3) for x in hi], 'colour_range': [round(cmin, 4), round(cmax, 4)], 'glow_mask_max': round(glow_max, 3)}
        assert cmax - cmin > .05, (nd['name'], 'COLOR_0 looks constant (white?)')
    return doc, info

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=True, export_skins=False,
                          export_animations=False, export_morph=False, export_materials='EXPORT', export_normals=True,
                          export_texcoords=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False,
                          export_extras=False, export_image_format='JPEG', export_image_quality=85, export_tangents=False,
                          export_cameras=False, export_lights=False)
quantize_glb(OUT)
DOC, INFO = inspect_glb(OUT)
total_tris = sum(v['triangles'] for v in INFO.values())
REPORT = {'file': os.path.relpath(OUT, os.path.join(HERE, '..', '..')) if OUT.startswith(os.path.join(HERE, '..', '..')) else os.path.basename(OUT),
          'bytes': os.path.getsize(OUT), 'triangles': total_tris, 'materials': [m['name'] for m in DOC['materials']],
          'images': [(im.get('mimeType'), im.get('name')) for im in DOC.get('images', [])],
          'pieces': INFO, 'anchors': {n: p.anchors for n, p in PCS.items() if p.anchors},
          'rail': {'railTopY': RAIL_TOP, 'gauge': GAUGE, 'length': 2.0},
          'glow_mask': 'TEXCOORD_1.x (0..1) on SaltCrystal and SaltRock; 0 elsewhere'}
for k, lim in BUDGET.items():
    if k in INFO: assert INFO[k]['triangles'] <= lim, (k, INFO[k]['triangles'], lim)
assert total_tris <= 26000, total_tris
assert REPORT['bytes'] <= 1.2 * 1024 * 1024, REPORT['bytes']
missing = {m for m in MAT_NAMES} - set(REPORT['materials'])
if not wanted: assert not missing, missing
REPORT['seconds'] = round(time.time() - T0, 1)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps({k: (v['triangles'], v['vertices']) for k, v in INFO.items()}), REPORT['bytes'], total_tris, flush=True)

# ===================================================================== review renders (after export: preview-only node tweaks)
def sock(socks, name, typ='RGBA'): return [x for x in socks if x.name == name and x.type == typ][0]
GLOW_VALUES = {}
def setup_render_materials():
    for m in MATS:
        nt = m.node_tree; b = nt.nodes['Principled BSDF']
        vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        if m.name == 'Timber':
            t = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeTexImage'][0]
            mm = nt.nodes.new('ShaderNodeMix'); mm.data_type = 'RGBA'; mm.blend_type = 'MULTIPLY'; mm.inputs['Factor'].default_value = 1
            nt.links.new(vc.outputs['Color'], sock(mm.inputs, 'A')); nt.links.new(t.outputs['Color'], sock(mm.inputs, 'B'))
            nt.links.new(sock(mm.outputs, 'Result'), b.inputs['Base Color'])
        elif m.name == 'LanternGlow':
            val = nt.nodes.new('ShaderNodeValue'); val.outputs[0].default_value = 1.0; GLOW_VALUES[m.name] = val
            nt.links.new(val.outputs[0], b.inputs['Emission Strength'])
        else:
            nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
        if m.name in ('SaltRock', 'SaltCrystal'):
            uvm = nt.nodes.new('ShaderNodeUVMap'); uvm.uv_map = 'Mask'
            sp = nt.nodes.new('ShaderNodeSeparateXYZ'); nt.links.new(uvm.outputs['UV'], sp.inputs['Vector'])
            val = nt.nodes.new('ShaderNodeValue'); val.outputs[0].default_value = 0.0; GLOW_VALUES[m.name] = val
            ml = nt.nodes.new('ShaderNodeMath'); ml.operation = 'MULTIPLY'
            nt.links.new(sp.outputs['X'], ml.inputs[0]); nt.links.new(val.outputs[0], ml.inputs[1])
            nt.links.new(ml.outputs[0], b.inputs['Emission Strength'])
            # emission tint: the salt's own colour pushed warm, like a salt lamp
            mw = nt.nodes.new('ShaderNodeMix'); mw.data_type = 'RGBA'; mw.blend_type = 'MULTIPLY'; mw.inputs['Factor'].default_value = 1
            nt.links.new(vc.outputs['Color'], sock(mw.inputs, 'A')); sock(mw.inputs, 'B').default_value = (1.0, .55, .38, 1)
            nt.links.new(sock(mw.outputs, 'Result'), b.inputs['Emission Color'])
            if m.name == 'SaltCrystal':
                try:
                    b.inputs['Subsurface Weight'].default_value = .35; b.inputs['Subsurface Radius'].default_value = (.12, .05, .04)
                    b.inputs['Subsurface Scale'].default_value = .05; b.inputs['Coat Weight'].default_value = .3
                except Exception: pass

def render_all():
    os.makedirs(RENDER, exist_ok=True)
    setup_render_materials()
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 40)); SC.cycles.device = 'CPU'
    try: SC.cycles.use_denoising = True
    except Exception: pass
    SC.render.resolution_x, SC.render.resolution_y = int(arg('--w', 1000)), int(arg('--h', 720))
    SC.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    # cyclorama backdrop
    cm = bpy.data.meshes.new('cyc'); vs, fs = [], []
    prof = [(-30, 0)] + [(8 + 4 * math.sin(a), 4 - 4 * math.cos(a)) for a in np.linspace(0, math.pi / 2, 8)] + [(12, 20)]
    for (d, hgt) in prof:
        vs += [(-40, d, hgt), (40, d, hgt)]
    for i in range(len(prof) - 1): fs.append((2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2))
    cm.from_pydata(vs, [], fs); cyc = bpy.data.objects.new('cyc', cm); SC.collection.objects.link(cyc)
    for p in cm.polygons: p.use_smooth = True
    cmat = bpy.data.materials.new('cyc'); cnt, cb = principled(cmat); cm.materials.append(cmat)
    def lamp(name, kind, energy, colr, size):
        l = bpy.data.lights.new(name, kind); l.energy = energy; l.color = colr
        if kind == 'AREA': l.size = size
        o = bpy.data.objects.new(name, l); SC.collection.objects.link(o); return o
    key = lamp('key', 'AREA', 1, (1.0, .84, .66), 3); fill = lamp('fill', 'AREA', 1, (.8, .86, 1.0), 5); rim = lamp('rim', 'AREA', 1, (1.0, .9, .8), 2)
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    def aim(o, eye, at):
        o.location = to_b(eye); o.rotation_euler = (to_b(at) - to_b(eye)).to_track_quat('-Z', 'Y').to_euler()
    def studio(centre, radius, dark=False):
        c = Vector(centre)
        cb.inputs['Base Color'].default_value = (.03, .025, .03, 1) if dark else (.42, .36, .32, 1); cb.inputs['Roughness'].default_value = .9
        bg.inputs['Color'].default_value = (.01, .01, .016, 1) if dark else (.26, .22, .2, 1); bg.inputs['Strength'].default_value = .3 if dark else 1.0
        d = max(radius, .3)
        for o, off, e in ((key, (1.2, 1.6, 1.4), 220), (fill, (-1.8, .8, 1.0), 70), (rim, (-.6, 1.4, -1.8), 120)):
            pos = c + Vector(off).normalized() * d * 4.5
            aim(o, pos, c); o.data.energy = (e * (d * 4.5) ** 2 / 20) * (.05 if dark else 1); o.data.size = d * 1.6
    def shot(name, at, radius, view=(1.0, .72, 1.45), lens=50):
        cam.lens = lens
        fov = 2 * math.atan(18 / lens) * (SC.render.resolution_y / SC.render.resolution_x)
        dist = radius / math.sin(fov / 2) * .88
        eye = Vector(at) + Vector(view).normalized() * dist
        aim(co, eye, Vector(at)); cam.clip_end = 500
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
        print('rendered', name, flush=True)
    only = arg('--only'); want = lambda n: not only or n in only.split(',')
    def bounds(name):
        i = INFO[name]; lo, hi = Vector(i['bbox_min']), Vector(i['bbox_max'])
        return (lo + hi) / 2, (hi - lo).length / 2
    def show(names):
        for n, o in OBJS.items(): o.hide_render = n not in names
    for name in OBJS:
        if not want(name): continue
        show([name]); c, r = bounds(name)
        if name == 'Lantern':   # hang it at eye height
            OBJS[name].location = to_b((0, 1.0, 0)); c = c + Vector((0, 1.0, 0))
        studio(c, r)
        vw = tuple(float(x) for x in arg('--view').split(',')) if arg('--view') else (1.0, .72, 1.45)
        shot(name, c, r, view=vw)
        OBJS[name].location = (0, 0, 0)
        if name in ('SaltCluster', 'MinePortal', 'MineCart') and want(name + '-front'):
            shot(name + '-front', c, r, view=(.15, .25, 1.0))
    copies = []
    def place(name, pos, yaw=0.0):
        o = bpy.data.objects.new(name + '_view', OBJS[name].data); SC.collection.objects.link(o)
        o.location = to_b(pos); o.rotation_euler = (0, 0, yaw); copies.append(o); return o
    def clear():
        for o in copies: bpy.data.objects.remove(o)
        copies.clear()
    if want('lineup') and len(OBJS) == len(BUILDERS):
        show([])
        layout = [('MinePortal', (-4.6, 0, -2.5)), ('TimberSet', (0.2, 0, -2.5)), ('RubblePile', (3.6, 0, -1.6)),
                  ('RailStraight', (-1.8, 0, 1.2)), ('MineCart', (-1.8, 0, 1.2)), ('Lantern', (-0.4, 1.7, 1.6)), ('SaltCluster', (.9, 0, .9)),
                  ('SaltClusterSmall', (2.3, 0, 1.9)), ('FiredampVent', (4.0, 0, 1.0)), ('BrineRim', (-4.4, 0, 1.9))]
        for n, p in layout: place(n, p)
        studio((0, 1.3, 0), 6.0)
        shot('lineup', (-.2, 1.5, -.2), 5.4, view=(.35, .45, 1.0), lens=40)
        clear()
    if want('scene-glow') and len(OBJS) == len(BUILDERS):
        show([])
        hook = PCS['MinePortal'].anchors['lanternHook']
        place('MinePortal', (0, 0, 0)); place('Lantern', hook)
        for z in (-1.0, 1.0, 3.0, 5.0, 7.0): place('RailStraight', (0, 0, z))
        place('TimberSet', (0, 0, -2.6)); place('MineCart', (0, 0, 3.2))
        place('SaltCluster', (-3.3, 0, 2.0), .6); place('SaltClusterSmall', (2.9, 0, .9), 1.1); place('SaltClusterSmall', (-2.2, 0, 4.6), 2.5)
        place('SaltClusterSmall', (3.4, 0, 4.9), .2); place('FiredampVent', (3.1, 0, 3.0)); place('RubblePile', (-2.7, 0, .3), .4)
        place('BrineRim', (-3.0, 0, 6.6))
        water = bpy.data.meshes.new('water'); water.from_pydata([to_b((-3.0 + .9 * math.cos(a), -.015, 6.6 + .9 * math.sin(a))) for a in np.linspace(0, TAU, 33)[:-1]], [], [tuple(range(32))])
        wo = bpy.data.objects.new('water', water); SC.collection.objects.link(wo); copies.append(wo)
        wm = bpy.data.materials.new('water'); wnt, wb = principled(wm); wb.inputs['Base Color'].default_value = (.12, .2, .22, 1); wb.inputs['Roughness'].default_value = .05
        water.materials.append(wm)
        studio((0, 1.5, 3), 6.0, dark=True)
        GLOW_VALUES['SaltCrystal'].outputs[0].default_value = 2.4; GLOW_VALUES['SaltRock'].outputs[0].default_value = 1.1
        GLOW_VALUES['LanternGlow'].outputs[0].default_value = 12.0
        pl = bpy.data.lights.new('lantern', 'POINT'); pl.energy = 60; pl.color = (1.0, .66, .35); pl.shadow_soft_size = .08
        plo = bpy.data.objects.new('lantern', pl); SC.collection.objects.link(plo); plo.location = to_b((hook[0], hook[1] - .24, hook[2])); copies.append(plo)
        shot('scene-glow', (0, 1.6, 2.6), 5.2, view=(.42, .3, 1.0), lens=35)
        clear()

if RENDER: render_all()
print('SALT_MINE_KIT_OK')
