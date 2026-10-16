"""Brinedeep salt-mine curios (Easter eggs) - reproducible Blender (bpy 4.5) builder.

Run:  python3.11 build_salt_mine_curios.py -- --out ../../public/assets/salt-mine-curios.glb
      python3.11 build_salt_mine_curios.py -- --out /tmp/x.glb --render /path/to/review   (Cycles review images)
      (pip install bpy==4.5.* numpy pillow)
Options: --pieces A,B (build a subset, for iteration only), --only name,name (render subset), --samples N,
         --report path.json (write the build report; it is always printed).
Prints SALT_MINE_CURIOS_OK as its last line on success. Blender can exit 0 after a Python traceback, so check for it.

Companion to assets-source/salt-mine-kit (same conventions, same shared material names, its helpers copied here so
the two builders stay independent). The Brinedeep is an old, cheerful salt mine: pink and white rock salt that glows
warm from inside like a salt lamp, chunky dark oiled timber, iron, brass and lantern light. These are the little
stories hidden in it: the miners' canary, a lunch left on a ledge, a snowman built of rock salt, the legendary Great
Salt Shaker, King Pinchy's crown, a warning sign, a tally board and a tool rack.

Everything is authored in the game frame (X right, Y up, Z toward the viewer / front, metres) and converted to
Blender's Z-up on the way in, so the numbers here are the runtime's numbers. One top-level static mesh per piece,
each at its own origin. Materials: the kit's six (Timber, Iron, Brass, SaltRock, SaltCrystal, LanternGlow) plus
Painted (plain vertex-coloured paint, food, cloth, coal, wax) and Feather (the canary).
COLOR_0   authored vertex colour with baked ambient occlusion multiplied in (linear).
TEXCOORD_0 Timber: wood-grain tile coordinates (u along the grain); other primitives: unused (constant).
TEXCOORD_1 x = glow mask 0..1 (SaltCrystal/SaltRock; 1 = glowing core), y = 0. 0 on every other material.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
import bpy, bmesh, math, json, time, struct, tempfile
import numpy as np
import mathutils
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

T0 = time.time()
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, '..', '..', 'public', 'assets', 'salt-mine-curios.glb'))
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
    # shared with the kit
    timber_a='5a3720', timber_b='4b2e1b', timber_c='653e23', end='98724c', sign='8a6440', sign_dark='4f3220',
    iron='464a53', iron_dark='34373e', rivet='636873', brass='cc9c46', brass_dark='8c682c', brass_light='e8c46e',
    rock_pink='e6a898', rock_rose='c46a66', rock_orange='e08c6a', rock_white='f4e6de', rock_grey='a89e9a',
    cr_pale='f6cacd', cr_rose='ef93a5', cr_milk='f8efea', cr_deep='c84d6c', cr_inner='ffc4a8', cr_inner_deep='ff9088',
    crust='f5eee8', crust_pink='f0d6cf', glow='ffd59a',
    # curios
    gold='f0b53a', gold_light='ffe28c', gold_dark='9a6618', gold_deep='6e4410',
    tin='a3aab2', tin_light='d2d7dc', tin_dark='4c5258', tin_inside='383c42',
    enamel='f3efe4', enamel_blue='2c63c4', coffee='3b2014', crema='8a5a34',
    pretzel='a4561a', pretzel_light='d98e3e', pretzel_dark='6b300c', pretzel_split='f0c487',
    pickle='5d8f26', pickle_light='a6cc4e', pickle_dark='3a611a',
    cloth_red='d23a2e', cloth_white='f7f0e2',
    canary='ffe41a', canary_belly='fff480', canary_back='ffc400', canary_wing='ffb000', canary_bar='fff4a0',
    canary_tip='cf7a00', blush='ff8c3c', beak='ff9a34', beak_dark='d9661e', legs='eba08a', eye='15121c', white='ffffff',
    coal='221e1f', coal_hi='4b4442', carrot='f27a1e', carrot_dark='c45412',
    burlap='c9a46b', burlap_dark='9a7740', burlap_light='dfc08a', sack_red='c43a2e', sack_blue='3c64a8',
    helmet='f0b43a', helmet_dark='b9802a', wax='fbf1d8', wax_shadow='e8d6b0', wick='2a2220',
    water='3f9ed6', water_light='8fd0f0', sand='e8d2b0', sand_dark='c9ae88', seed='a8713a', seed_light='d6a464',
    paint_teal='2f7f87', paint_teal_light='4f9ea4', paint_teal_dark='1d5258', paint_cream='f2e5c2', paint_red='e52a1c',
    paint_crab='b23a22', glass='b4d4d8', glass_light='eefafa', letter='ffd860', chalk='efece4', chalk_dim='d8d4ca', carve='3a2414',
    rope='c9a466', rope_dark='8a6a38', velvet='b3122e', velvet_dark='6e0a1c', ermine='f6f0e6').items()}

# ===================================================================== deterministic noise (as the kit)
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

# ===================================================================== wood-grain tile (the kit's SaltMineTimber)
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

TMPDIR = tempfile.mkdtemp(prefix='curios-')
def make_image(name, rgb, colourspace='sRGB'):
    from PIL import Image
    path = os.path.join(TMPDIR, name + '.png')
    Image.fromarray(np.clip(np.round(rgb * 255), 0, 255).astype(np.uint8), 'RGB').save(path)
    img = bpy.data.images.load(path); img.name = name
    img.colorspace_settings.name = colourspace
    img.pack()
    return img

# ===================================================================== geometry accumulator (one per piece)
TIMBER, IRON, BRASS, ROCK, CRYSTAL, GLOW, PAINT, FEATHER = range(8)
MAT_NAMES = ['Timber', 'Iron', 'Brass', 'SaltRock', 'SaltCrystal', 'LanternGlow', 'Painted', 'Feather']
AO_MIN = {TIMBER: .30, IRON: .32, BRASS: .40, ROCK: .34, CRYSTAL: .55, GLOW: 1.0, PAINT: .34, FEATHER: .66}

def newell(ps):
    n = Vector((0, 0, 0))
    for i in range(len(ps)):
        a, b = ps[i], ps[(i + 1) % len(ps)]
        n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y)
    return n

class Piece:
    """floor: a ground plane at y=0 occludes the AO bake; wall: a wall plane at z=0 does."""
    def __init__(self, name, floor=True, wall=False, reach=.5, ray_off=.003):
        self.name, self.floor, self.wall, self.reach, self.ray_off = name, floor, wall, reach, ray_off
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
        k = 0
        while k < len(idx) and len(idx) > 3:
            if idx[k] == idx[(k + 1) % len(idx)]: del idx[k]; del uvs[k]
            else: k += 1
        if len(set(idx)) < 3: return
        if out is not None:
            n = newell([self.P[i] for i in idx])
            if n.dot(Vector(out)) < 0: idx = idx[::-1]; uvs = uvs[::-1]
        self.F.append(idx); self.FM.append(mat); self.FS.append(smooth); self.FUV.append(uvs)
    def mark(self): return (len(self.P), len(self.F))
    def sec(self, label):
        """Debug: record the triangle count reached at a labelled point (printed with --sections)."""
        self.__dict__.setdefault('secs', []).append((label, sum(len(f) - 2 for f in self.F)))
    def xform(self, since, M, t=Vector()):
        """Apply a 3x3 matrix M then translate t to the vertices added since mark()."""
        for i in range(since[0], len(self.P)): self.P[i] = M @ self.P[i] + t
    def bvh(self, f0=0, f1=None):
        return BVHTree.FromPolygons([tuple(p) for p in self.P], [tuple(f) for f in self.F[f0:f1]])

# ===================================================================== primitives (the kit's, plus a few)
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
    base = Vector(p) - n * .002
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
    """A cleavage block: a box with jittered corners and a few corners knocked off."""
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                q = Vector((sx * half[0], sy * half[1], sz * half[2]))
                q = Vector((q.x * (1 + rng.uniform(-jitter, jitter)), q.y * (1 + rng.uniform(-jitter, jitter)), q.z * (1 + rng.uniform(-jitter, jitter))))
                if rng.random() < cut:
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
def RX(a): return Matrix.Rotation(a, 3, 'X')
def RY(a): return Matrix.Rotation(a, 3, 'Y')
def RZ(a): return Matrix.Rotation(a, 3, 'Z')

def crystal(pc, centre, R, half, col, mask=.5, ch=None, hopper=(), steps=3, inner=None, shade=.07, seed=0, mat=CRYSTAL):
    """Halite cube (or cuboid): chamfered edges, flat shaded; `hopper` faces get the stepped recess. (kit helper)"""
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

def rock_dome(pc, cx, cz, R, H, segs, rings, seed, floor_y=-.02, rough=.12, white=0.0, y0=0.0, col_fn=None, mask_k=1.0):
    """Faceted low mound centred at (cx, y0, cz). col_fn(p) -> (colour, mask) overrides rock_col."""
    cf = col_fn or (lambda p: rock_col(p, seed, white))
    def hgt(r): return H * max(0.0, 1 - min(1.0, r) ** 2) ** .75
    rows = []
    top = Vector((cx, y0 + H * (1 + .08 * (vnoise(cx, cz, 0, seed) - .5)), cz))
    cc, m = cf(top); centre = pc.v(top, cc, m * mask_k)
    for i in range(1, rings + 1):
        rr = i / rings; row = []
        for j in range(segs):
            th = TAU * (j + .5 * (i % 2)) / segs
            nz = vnoise(math.cos(th) * 2.2 + seed, math.sin(th) * 2.2, rr * 2.5, seed)
            rad = R * rr * (1 + rough * (nz - .5) * 2)
            x, z = cx + math.cos(th) * rad, cz + math.sin(th) * rad
            y = y0 + hgt(rr) * (1 + .5 * rough * (vnoise(x * 4, z * 4, 3, seed + 1) - .5) * 2) if i < rings else floor_y
            p = Vector((x, y, z)); cc, m = cf(p)
            row.append(pc.v(p, cc, m * mask_k))
        rows.append(row)
    ref = Vector((cx, y0 - R, cz))
    for j in range(segs):
        q = [centre, rows[0][j], rows[0][(j + 1) % segs]]
        pc.f(q, ROCK, False, None, out=sum((pc.P[k] for k in q), Vector()) / 3 - ref)
    for i in range(rings - 1):
        for j in range(segs):
            j2 = (j + 1) % segs
            a, b, c2, d = rows[i][j], rows[i][j2], rows[i + 1][j2], rows[i + 1][j]
            for q in ([a, b, c2], [a, c2, d]):
                pc.f(q, ROCK, False, None, out=sum((pc.P[k] for k in q), Vector()) / 3 - ref)

def crust_lumps(pc, cx, cz, hw, hd, n, rng, top=.28, crystals=3, seed=0):
    """White evaporite crust built up round a timber foot (kit helper)."""
    perim = 2 * (2 * hw + 2 * hd)
    for k in range(n):
        s = (k + rng.uniform(-.3, .3)) / n * perim
        if s < 2 * hw: x, z, nx, nz = cx - hw + s, cz + hd, 0, 1
        elif s < 2 * hw + 2 * hd: x, z, nx, nz = cx + hw, cz + hd - (s - 2 * hw), 1, 0
        elif s < 4 * hw + 2 * hd: x, z, nx, nz = cx + hw - (s - 2 * hw - 2 * hd), cz - hd, 0, -1
        else: x, z, nx, nz = cx - hw, cz - hd + (s - 4 * hw - 2 * hd), -1, 0
        sx, sz = rng.uniform(.04, .08), rng.uniform(.035, .06)
        sy = rng.uniform(.4, 1.0) * top * .5
        c = Vector((x + nx * sz * .4, sy * .55 - .03, z + nz * sz * .4))
        R = Matrix.Rotation(rng.uniform(0, TAU), 3, YA)
        tint = rng.uniform(0, .45)
        def cf(p, nn, tint=tint):
            return mul(mix(C['crust'], C['crust_pink'], tint), 1.03 if nn.y > .4 else .95)
        hull(pc, chunk_points(c, (sx, sy, sz), R, rng, cut=.6, jitter=.2), ROCK, cf, mask=.22)
    for k in range(crystals):
        th = rng.uniform(0, TAU); hs = rng.uniform(.018, .03)
        c = Vector((cx + math.cos(th) * (hw + .04), rng.uniform(.03, top * .6), cz + math.sin(th) * (hd + .04)))
        crystal(pc, c, rot_up((math.cos(th) * .6, 1, math.sin(th) * .6), rng.uniform(0, TAU), CORNER_UP if k % 2 else YA),
                (hs, hs, hs), C['cr_milk'] if k % 2 else C['cr_pale'], .55, ch=0.0, seed=seed + k)

def timber_beam(pc, a, b, w, h, rng, up=(0, 1, 0), segs=4, taper=.96, ch=.04, shade=None, **kw):
    col = shade or [C['timber_a'], C['timber_b'], C['timber_c']][int(rng.integers(0, 3))]
    return beam(pc, a, b, w, h, up=up, mat=TIMBER, col=col, ch=ch, segs=segs, taper=taper, cap_col=mix(C['end'], col, .3),
                jit=.004, seed=int(rng.integers(0, 9999)), colvar=.10, uv_off=float(rng.uniform(0, 1)), **kw)

# ---- new helpers
def spline(ctrl, per=6, closed=False):
    """Catmull-Rom through control points (Vectors)."""
    P = [Vector(c) for c in ctrl]; n = len(P); out = []
    segs = n if closed else n - 1
    for i in range(segs):
        p0 = P[(i - 1) % n] if closed else P[max(0, i - 1)]
        p1, p2 = P[i % n], P[(i + 1) % n]
        p3 = P[(i + 2) % n] if closed else P[min(n - 1, i + 2)]
        for k in range(per):
            t = k / per; t2, t3 = t * t, t * t * t
            out.append(.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    if not closed: out.append(P[-1].copy())
    return out

def tube(pc, pts, rad, n=8, mat=PAINT, col=None, col_fn=None, caps=(True, True), up=None, smooth=True, mask=0.0,
         closed=False, tile=None, ell=(1.0, 1.0), ao=1.0, phase=0.0, cap_col=None):
    """Sweep an (elliptical) circle along a polyline with parallel-transport frames.
    rad: float, list, or callable(i, s01). col_fn(i, j, p, radial) -> colour. tile: Timber uv tile length."""
    P = [Vector(p) for p in pts]; m = len(P)
    T = []
    for i in range(m):
        if closed: d = P[(i + 1) % m] - P[(i - 1) % m]
        else: d = P[min(m - 1, i + 1)] - P[max(0, i - 1)]
        T.append(d.normalized())
    ref = Vector(up) if up is not None else (XA if abs(T[0].x) < .9 else YA)
    if abs(ref.normalized().dot(T[0])) > .97: ref = XA if abs(T[0].x) < .9 else ZA   # up along the tube: pick another
    N = (ref - T[0] * ref.dot(T[0])).normalized()
    frames = []
    for i in range(m):
        if i:
            q = T[i - 1].rotation_difference(T[i]); N = (q @ N); N = (N - T[i] * N.dot(T[i])).normalized()
        frames.append((N.copy(), T[i].cross(N).normalized()))
    if closed:   # spread the closing twist
        Ne = T[-1].rotation_difference(T[0]) @ frames[-1][0]
        tw = math.atan2(Ne.cross(frames[0][0]).dot(T[0]), Ne.dot(frames[0][0]))
        frames = [((Matrix.Rotation(tw * i / m, 3, T[i]) @ fN), None) for i, (fN, _) in enumerate(frames)]
        frames = [(fN, T[i].cross(fN).normalized()) for i, (fN, _) in enumerate(frames)]
    L = [0.0]
    for i in range(1, m): L.append(L[-1] + (P[i] - P[i - 1]).length)
    tot = L[-1] or 1.0
    rows = []
    for i in range(m):
        r = rad(i, L[i] / tot) if callable(rad) else (rad[i] if isinstance(rad, (list, tuple)) else rad)
        Nn, Bn = frames[i]; row = []
        for j in range(n):
            th = TAU * j / n + phase
            radial = Nn * math.cos(th) * ell[0] + Bn * math.sin(th) * ell[1]
            p = P[i] + radial * r
            cc = col_fn(i, j, p, radial) if col_fn else col
            row.append(pc.v(p, cc, mask, ao))
        rows.append(row)
    for i in range(m if closed else m - 1):
        i2 = (i + 1) % m
        for j in range(n):
            j2 = (j + 1) % n
            q = [rows[i][j], rows[i][j2], rows[i2][j2], rows[i2][j]]
            uvs = None
            if tile:
                rr = rad if not callable(rad) and not isinstance(rad, (list, tuple)) else .02
                u0, u1 = L[i] / tile, (L[i2] if i2 else tot) / tile
                v0, v1 = j / n * TAU * rr / tile, (j + 1) / n * TAU * rr / tile
                uvs = [(u0, v0), (u0, v1), (u1, v1), (u1, v0)]
            cen = sum((pc.P[k] for k in q), Vector()) / 4
            pc.f(q, mat, smooth, uvs, out=cen - (P[i] + P[i2]) / 2)
    if not closed:
        for i, sg, want in ((0, -1, caps[0]), (m - 1, 1, caps[1])):
            if not want: continue
            ids = [pc.v(pc.P[k], cap_col or pc.C[k], mask, ao) for k in rows[i]]
            pc.f(ids, mat, False, None, out=T[i] * sg)
    return rows

def uv_sphere_dirs(nseg, nring):
    D = [Vector((0, 1, 0))]
    for i in range(1, nring):
        ph = math.pi * i / nring
        for j in range(nseg):
            th = TAU * j / nseg
            D.append(Vector((math.sin(ph) * math.cos(th), math.cos(ph), math.sin(ph) * math.sin(th))))
    D.append(Vector((0, -1, 0)))
    F = []
    for j in range(nseg): F.append((0, 1 + (j + 1) % nseg, 1 + j))
    for i in range(nring - 2):
        for j in range(nseg):
            a = 1 + i * nseg + j; b = 1 + i * nseg + (j + 1) % nseg
            F.append((a, b, b + nseg, a + nseg))
    last = len(D) - 1; base = 1 + (nring - 2) * nseg
    for j in range(nseg): F.append((last, base + j, base + (j + 1) % nseg))
    return D, F

def blob(pc, centre, radius_fn, nseg, nring, mat, col_fn, mask=0.0, smooth=True, R=None, ao=1.0):
    """Star-shaped surface: for each sphere direction d (in R's frame), radius_fn(d) gives the distance from centre.
    col_fn(p, n_approx, d) -> colour; mask may be callable(p, d)."""
    c = Vector(centre); R = R if R is not None else Matrix.Identity(3)
    D, F = uv_sphere_dirs(nseg, nring)
    ids = []
    for d in D:
        dw = R @ d; p = c + dw * radius_fn(d)
        m = mask(p, d) if callable(mask) else mask
        ids.append(pc.v(p, col_fn(p, dw, d), m, ao))
    for f in F:
        q = [ids[k] for k in f]
        cen = sum((pc.P[k] for k in q), Vector()) / len(q)
        pc.f(q, mat, smooth, None, out=cen - c)
    return ids

def sdf_radius(sdf, c, rmax):
    """Distance along each direction from c to the sdf's zero (bisection); for blob()."""
    def fn(dw):
        lo, hi = 0.0, rmax
        for _ in range(26):
            mid = (lo + hi) / 2
            if sdf(c + dw * mid) < 0: lo = mid
            else: hi = mid
        return (lo + hi) / 2
    return fn

def ellipsoid(pc, c, radii, nseg, nring, mat, col_fn, R=None, mask=0.0, smooth=True, ao=1.0):
    rx, ry, rz = radii
    return blob(pc, c, lambda d: 1.0 / math.sqrt((d.x / rx) ** 2 + (d.y / ry) ** 2 + (d.z / rz) ** 2), nseg, nring, mat,
                col_fn, mask, smooth, R, ao)

def prism(pc, loops, frame, z0, z1, mat, col_front, col_side=None, col_back=None, smooth_sides=False, mask=0.0,
          uv_fn=None, ao=1.0, sides=True):
    """Extrude 2D loops (first outer, others holes) along the frame's ez from z0 to z1.
    frame = (origin, ex, ey, ez). col_front may be callable(x, y). uv_fn(x, y) for Timber caps."""
    o, ex, ey, ez = (Vector(v) for v in frame)
    def W(x, y, z): return o + ex * x + ey * y + ez * z
    flat = [p for Lp in loops for p in Lp]
    tris = mathutils.geometry.tessellate_polygon([[(x, y, 0) for x, y in Lp] for Lp in loops])
    cf = col_front if callable(col_front) else (lambda x, y: col_front)
    front = [pc.v(W(x, y, z1), cf(x, y), mask, ao) for x, y in flat]
    for t in tris:
        pc.f([front[k] for k in t], mat, True, [uv_fn(*flat[k]) for k in t] if uv_fn else None, out=ez)
    if col_back is not None:
        back = [pc.v(W(x, y, z0), col_back, mask, ao) for x, y in flat]
        for t in tris:
            pc.f([back[k] for k in t], mat, True, [uv_fn(*flat[k]) for k in t] if uv_fn else None, out=-ez)
    if not sides: return
    cs = col_side or (col_front if not callable(col_front) else None)
    off = 0
    for Lp in loops:
        m = len(Lp)
        cen2 = sum((Vector((x, y)) for x, y in Lp), Vector((0, 0))) / m
        area = sum(Lp[i][0] * Lp[(i + 1) % m][1] - Lp[(i + 1) % m][0] * Lp[i][1] for i in range(m))
        for i in range(m):
            (xa, ya), (xb, yb) = Lp[i], Lp[(i + 1) % m]
            ca = cs if cs is not None else cf(xa, ya)
            ids = [pc.v(W(xa, ya, z0), ca, mask, ao), pc.v(W(xb, yb, z0), ca, mask, ao), pc.v(W(xb, yb, z1), ca, mask, ao), pc.v(W(xa, ya, z1), ca, mask, ao)]
            nx, ny = (yb - ya), -(xb - xa)          # right-hand normal of the edge
            if area < 0: nx, ny = -nx, -ny          # make it point out of a CCW outer loop
            if off: nx, ny = -nx, -ny               # holes point inward
            uvs = None
            if uv_fn:
                ll = math.hypot(xb - xa, yb - ya)
                uvs = [(0, 0), (ll / 1.1, 0), (ll / 1.1, (z1 - z0) / 1.1), (0, (z1 - z0) / 1.1)]
            pc.f(ids, mat, smooth_sides, uvs, out=ex * nx + ey * ny)
        off += m

def circle2(cx, cy, r, n, a0=0.0, a1=TAU, ry=None):
    ry = ry or r; full = abs(a1 - a0 - TAU) < 1e-9
    k = n if full else n + 1
    return [(cx + math.cos(a0 + (a1 - a0) * i / n) * r, cy + math.sin(a0 + (a1 - a0) * i / n) * ry) for i in range(k)]

def disc(pc, c, n_vec, r, k, mat, col, mask=0.0, up=None):
    """Flat k-gon facing n_vec."""
    n_vec = Vector(n_vec).normalized(); ref = Vector(up) if up is not None else (YA if abs(n_vec.y) < .9 else ZA)
    e1 = ref.cross(n_vec).normalized(); e2 = n_vec.cross(e1)
    ids = [pc.v(Vector(c) + (e1 * math.cos(TAU * i / k) + e2 * math.sin(TAU * i / k)) * r, col, mask) for i in range(k)]
    pc.f(ids, mat, False, None, out=n_vec)

def strip(pc, pts2d, width, frame, z, mat, col_fn, mask=0.0, seed=0, wob=0.0):
    """Flat painted / chalked stroke along a 2D polyline on the frame's plane at height z (single-sided quads)."""
    o, ex, ey, ez = (Vector(v) for v in frame)
    def W(x, y): return o + ex * x + ey * y + ez * z
    P = [Vector(p) for p in pts2d]
    L, R = [], []
    for i in range(len(P)):
        d = (P[min(len(P) - 1, i + 1)] - P[max(0, i - 1)]).normalized(); nrm = Vector((-d.y, d.x))
        w = width * (1 + wob * (vnoise(i * 1.7, seed, 0, seed) - .5) * 2) * .5
        L.append(P[i] + nrm * w); R.append(P[i] - nrm * w)
    for i in range(len(P) - 1):
        q = [L[i], R[i], R[i + 1], L[i + 1]]
        ids = [pc.v(W(p.x, p.y), col_fn(p, i), mask) for p in q]
        pc.f(ids, mat, False, None, out=ez)

# ---- carving: glyph outlines (Blender's built-in font) and shapes cut into a board as recessed, painted grooves
def glyph_cut(body, size, at, res=3, spacing=1.0, offset=0.0):
    """Filled 2D glyphs of `body` centred on `at` (Bfont). Returns (points, triangles, boundary loops)."""
    cu = bpy.data.curves.new('txt', 'FONT'); cu.body = body; cu.size = size; cu.align_x = 'CENTER'; cu.align_y = 'CENTER'
    cu.resolution_u = res; cu.space_character = spacing; cu.offset = offset
    ob = bpy.data.objects.new('txt', cu); SC.collection.objects.link(ob)
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(ob); bpy.data.curves.remove(cu)
    bm = bmesh.new(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    for f in bm.faces:
        if f.normal.z < 0: f.normal_flip()
    bmesh.ops.triangulate(bm, faces=bm.faces)
    bm.verts.index_update()
    pts = [(v.co.x + at[0], v.co.y + at[1]) for v in bm.verts]
    tris = [tuple(v.index for v in f.verts) for f in bm.faces]
    edges = []                                   # boundary edges, directed along their face (interior on the left)
    for f in bm.faces:
        for l in f.loops:
            if len(l.edge.link_faces) == 1: edges.append((l.vert.index, l.link_loop_next.vert.index))
    bm.free()
    out = {}
    for a, b in edges: out.setdefault(a, []).append(b)
    loops = []
    while any(out.values()):
        s0 = next(k for k, v in out.items() if v); L = [s0]; v = out[s0].pop()
        while v != s0:
            L.append(v); v = out[v].pop()
        if len(L) >= 3: loops.append([pts[k] for k in L])
    return pts, tris, loops

def shape_cut(loops):
    """A carved region bounded by loops (first outer, others holes); loops are re-oriented interior-left."""
    def area(L): return sum(L[i][0] * L[(i + 1) % len(L)][1] - L[(i + 1) % len(L)][0] * L[i][1] for i in range(len(L)))
    fixed = []
    for k, L in enumerate(loops):
        L = list(L); ccw = area(L) > 0
        if (k == 0) != ccw: L = L[::-1]           # outer CCW, holes CW: interior always on the left
        fixed.append(L)
    pts = [p for L in fixed for p in L]
    tris = mathutils.geometry.tessellate_polygon([[(x, y, 0) for x, y in L] for L in fixed])
    return pts, [tuple(t) for t in tris], fixed

def carved_board(pc, outline, cuts, thick, depth, place, look):
    """A plank (2D outline extruded thick, centred on z=0) whose front face has the cuts sunk `depth` into it.
    look: class -> (material, colour or callable(local Vector), smooth, uv_fn(local Vector) or None) for
    'front', 'floor', 'wall', 'back', 'edge'. place(local Vector) -> piece space."""
    zf, zb, zl = thick / 2, -thick / 2, thick / 2 - depth
    def V3(p, z): return Vector((p[0], p[1], z))
    def emit(cls, P3, tri_list, out):
        mat, col, smooth, uvf = look[cls]
        ids = [pc.v(place(p), col(p) if callable(col) else col) for p in P3]
        for t in tri_list:
            pc.f([ids[k] for k in t], mat, smooth, [uvf(P3[k]) for k in t] if uvf else None, out=out)
    loops = [L for (_, _, ls) in cuts for L in ls]
    flat = [p for L in [outline] + loops for p in L]
    tris = mathutils.geometry.tessellate_polygon([[(x, y, 0) for x, y in L] for L in [outline] + loops])
    nrm = place(Vector((0, 0, 1))) - place(Vector((0, 0, 0)))
    emit('front', [V3(p, zf) for p in flat], tris, nrm)
    btris = mathutils.geometry.tessellate_polygon([[(x, y, 0) for x, y in outline]])
    emit('back', [V3(p, zb) for p in outline], btris, -nrm)
    for pts, ctris, _ in cuts:
        emit('floor', [V3(p, zl) for p in pts], ctris, nrm)
    def side(L, z0, z1, cls, inward):
        mat, col, smooth, uvf = look[cls]
        ar = sum(L[i][0] * L[(i + 1) % len(L)][1] - L[(i + 1) % len(L)][0] * L[i][1] for i in range(len(L)))
        for i in range(len(L)):
            a, b = L[i], L[(i + 1) % len(L)]
            q = [V3(a, z0), V3(b, z0), V3(b, z1), V3(a, z1)]
            ids = [pc.v(place(p), col(p) if callable(col) else col) for p in q]
            nx, ny = -(b[1] - a[1]), (b[0] - a[0])          # left normal (interior side for cut loops)
            if not inward:
                nx, ny = (b[1] - a[1]), -(b[0] - a[0])
                if ar < 0: nx, ny = -nx, -ny
            o = place(Vector((nx, ny, 0))) - place(Vector((0, 0, 0)))
            pc.f(ids, mat, smooth, [uvf(p) for p in q] if uvf else None, out=o)
    side(outline, zb, zf, 'edge', False)
    for L in loops: side(L, zl, zf, 'wall', True)

# ===================================================================== the canary
def canary(pc, keeled=False):
    """Plump bright-yellow canary, standing upright on its toes at the origin facing +Z, ~0.13 m tall.
    keeled: the same bird authored with stiff legs sticking forward out of its belly and X eyes; the caller rolls
    it onto its back."""
    BODY_C = V(0, .053, -.012); BODY_AX = V(0, 1, .8).normalized()
    RB = rot_up(BODY_AX)                     # local Y -> body axis
    BR = V(.032, .05, .033)
    HEAD_C = V(0, .097, .016); HR = .027
    def sdf(p):
        q = RB.transposed() @ (p - BODY_C)
        k = math.sqrt((q.x / BR.x) ** 2 + (q.y / BR.y) ** 2 + (q.z / BR.z) ** 2)
        a = (k - 1) * min(BR)
        b = (p - HEAD_C).length - HR
        kk = .009; h = clamp(.5 + .5 * (b - a) / kk)
        return lerp(b, a, h) - kk * h * (1 - h)
    centre = V(0, .07, .004)
    cheeks = [V(s * .019, .091, .032) for s in (-1, 1)]
    def col(p, n, d):
        c = C['canary']
        belly = smoothstep(-.15, .75, n.z * .75 - n.y * .55)
        c = mix(c, C['canary_belly'], belly * .85)
        back = smoothstep(.0, .9, -n.z * .9 + n.y * .1 - (p.y - .09) * 4)
        c = mix(c, C['canary_back'], back * .8)
        crown = smoothstep(.115, .124, p.y)
        c = mix(c, C['canary_back'], crown * .35)
        for ch in cheeks:
            c = mix(c, C['blush'], (1 - smoothstep(.004, .015, (p - ch).length)) * .6)
        return c
    blob(pc, centre, sdf_radius(sdf, centre, .12), 15, 12, FEATHER, col)
    pc.body_n = len(pc.P)
    pc.sec('wings')
    # wings: flattened teardrops tucked along the sides, tips crossing over the tail; two pale wing bars
    for s in (-1, 1):
        if keeled: Rw = RY(-s * .5) @ RX(.25) @ RZ(s * .55)
        else: Rw = RY(-s * .12) @ RX(.62) @ RZ(s * .08)
        wc = V(s * .029, .057, -.019) if not keeled else V(s * .036, .05, -.006)
        def wcol(p, n, d, Rw=Rw, wc=wc):
            t = (Rw.transposed() @ (p - wc)).y / .03       # +1 shoulder .. -1 tip
            c = mix(C['canary_wing'], C['canary_back'], smoothstep(-.2, .9, t))
            c = mix(c, C['canary_tip'], smoothstep(-.3, -.95, t))
            bar = max(1 - abs(t - .15) / .14, 1 - abs(t + .25) / .12, 0)
            return mix(c, C['canary_bar'], clamp(bar) * .75)
        ellipsoid(pc, wc, (.0075, .036, .016), 10, 7, FEATHER, wcol, R=Rw)
    pc.sec('tail')
    # tail: a flat notched fan, tilted down and back
    fan = [(-.007, 0), (.007, 0), (.016, .072), (.011, .08), (.006, .074), (0, .082), (-.006, .074), (-.011, .08), (-.016, .072)]
    tilt = -2.05 if not keeled else -2.0
    ex, ey = XA, (RX(tilt) @ YA)
    ez = ex.cross(ey)
    o = V(0, .026, -.038)
    def tcol(x, y): return mix(C['canary_back'], C['canary_tip'], smoothstep(.02, .08, y))
    prism(pc, [fan], (o, ex, ey, ez), -.003, .003, FEATHER, tcol, col_back=C['canary_tip'], smooth_sides=True)
    pc.sec('beak')
    # beak: a stubby cone, slightly drooped
    bd = V(0, -.18, 1).normalized(); bo = HEAD_C + V(0, -.003, HR - .006)
    lathe(pc, bo, bd, [(0, .016), (.004, .010), (.0076, .003), (.0076, -.002)], 6, PAINT,
          lambda i, j, p: C['beak'] if i < 2 else C['beak_dark'], ref=XA)
    pc.sec('eyes')
    # eyes
    for s in (-1, 1):
        e = HEAD_C + V(s * .0175, .006, .022)
        nrm = (e - HEAD_C).normalized()
        if not keeled:
            ellipsoid(pc, e, (.005, .0056, .005), 6, 4, PAINT, lambda p, n, d: C['eye'])
            ellipsoid(pc, e + nrm * .003 + V(-s * .001, .002, .001), (.0015, .0015, .0015), 4, 2, PAINT, lambda p, n, d: C['white'])
        else:
            t1 = nrm.cross(YA).normalized(); t2 = nrm.cross(t1).normalized()
            for a in (t1 + t2, t1 - t2):
                a = a.normalized() * .0065
                beam(pc, e - a + nrm * .001, e + a + nrm * .001, .0028, .0026, up=nrm, mat=PAINT, col=C['eye'], caps=(False, False))
    pc.sec('crest')
    # crest: three little tufts
    for k, (x, lean) in enumerate(((-.006, -.3), (0, 0.0), (.006, .3))):
        base = HEAD_C + V(x, HR - .004, -.004 - .004 * abs(x) / .006)
        d = V(lean * .5, 1, -.9).normalized()
        lathe(pc, base, d, [(0, .01 - .002 * abs(lean)), (.0036, .0)], 4, FEATHER, lambda i, j, p: C['canary_back'], ref=XA)
    pc.sec('legs')
    # legs and toes
    for s in (-1, 1):
        if not keeled:
            hip, foot = V(s * .011, .018, .004), V(s * .012, .0, .006)
            toes = [V(s * .009, -.002, .02), V(-s * .003, -.003, .021), V(s * .012, -.001, -.008)]
            tube(pc, [hip, foot], .0026, 4, PAINT, C['legs'], caps=(False, True))
            for t in toes:
                tube(pc, [foot + V(0, .001, 0), t], [.0019, .0012], 3, PAINT, C['legs'], caps=(False, False))
        else:
            hip = V(s * .012, .03, .018); foot = V(s * .015, .034, .056)
            tube(pc, [hip, foot], .0026, 4, PAINT, C['legs'], caps=(False, True))
            for k in range(3):
                a = (k - 1) * .6
                t = foot + V(s * .004 + math.sin(a) * .009, .009 * math.cos(a) * .3 + .004, .008)
                tip = t + V(math.sin(a) * .002, -.005, .002)
                tube(pc, [foot, t, tip], [.0018, .0016, .001], 3, PAINT, C['legs'], caps=(False, False))
            tube(pc, [foot, foot + V(0, -.006, -.006)], .0015, 3, PAINT, C['legs'], caps=(False, False))

def build_canary():
    pc = Piece('Canary', reach=.06, ray_off=.0008)
    canary(pc)
    return pc

def build_canary_keeled():
    pc = Piece('CanaryKeeled', reach=.06, ray_off=.0008)
    canary(pc, keeled=True)
    pc.sec('roll')
    # roll it onto its back (belly up, feet in the air), lying across X with its head to +X, a touch toward camera
    M = RX(.22) @ RY(-math.pi / 2) @ RX(-math.pi / 2 - .1)
    pc.xform((0, 0), M)
    ymin = min(p.y for p in pc.P)
    body = pc.P[:pc.body_n]                                  # the body blob's vertices
    cx = sum(p.x for p in body) / len(body); cz = sum(p.z for p in body) / len(body)
    pc.xform((0, 0), Matrix.Identity(3), V(-cx, -ymin, -cz))
    return pc

# ===================================================================== CanaryCage
CAGE = dict(R=.135, bars=14)
def build_cage():
    pc = Piece('CanaryCage', floor=False, reach=.12, ray_off=.0015)
    Rc = CAGE['R']
    def gold(i, j, p): return C['brass']
    pc.sec('hanging')
    # hanging ring: outer top at the origin
    RR, Rr = .022, .0055
    torus(pc, (0, -(RR + Rr), 0), ZA, RR, Rr, 12, 4, BRASS, C['brass_light'], ref=XA)
    pc.sec('knob')
    # knob and apex boss
    lathe(pc, (0, 0, 0), YA, [(0, -.049), (.009, -.051), (.014, -.058), (.017, -.066), (.012, -.073), (.016, -.077), (.034, -.082),
                              (.036, -.087), (.026, -.091)], 10, BRASS,
          lambda i, j, p: C['brass_light'] if i in (3, 7) else (C['brass_dark'] if i in (5, 8) else C['brass']))
    pc.sec('bars')
    # bars: up the side, then over the bell-shaped dome to the apex boss
    prof = [(Rc, -.478), (Rc, -.205), (.125, -.158), (.098, -.118), (.06, -.094), (.03, -.085)]
    nb = CAGE['bars']
    for k in range(nb):
        th = TAU * k / nb
        d = V(math.cos(th), 0, math.sin(th))
        pts = [d * r + YA * y for r, y in prof]
        tube(pc, pts, .0036, 4, BRASS, C['brass'], caps=(True, False), up=YA, phase=math.pi / 4)
    pc.sec('hoops')
    # hoops (dome ring, top, middle-above-door, bottom)
    for y, r, rr in ((-.205, Rc + .002, .0052), (-.298, Rc + .002, .0046), (-.47, Rc + .002, .0055)):
        torus(pc, (0, y, 0), YA, r, rr, 18, 4, BRASS, C['brass_light'] if y > -.2 else C['brass'], ref=XA)
    pc.sec('door')
    # door: a framed panel on the front between two bars, with a latch, hinge loops and a little pull ring
    a0, a1 = math.pi / 2 - TAU * 1.0 / nb, math.pi / 2 + TAU * 1.0 / nb
    yb, yt = -.455, -.312
    Rd = Rc + .0055
    def arc(y, k=5): return [V(math.cos(lerp(a0, a1, i / k)) * Rd, y, math.sin(lerp(a0, a1, i / k)) * Rd) for i in range(k + 1)]
    for y in (yb, yt):
        tube(pc, arc(y), .0038, 4, BRASS, C['brass_light'], up=YA, phase=math.pi / 4)
    for a in (a0, a1):
        tube(pc, [V(math.cos(a) * Rd, yb, math.sin(a) * Rd), V(math.cos(a) * Rd, yt, math.sin(a) * Rd)], .0038, 4, BRASS, C['brass_light'], up=XA, phase=math.pi / 4)
    for k in range(1, 2):   # door's own bar, just proud of the cage bars
        a = lerp(a0, a1, k / 2)
        tube(pc, [V(math.cos(a) * Rd, yb, math.sin(a) * Rd), V(math.cos(a) * Rd, yt, math.sin(a) * Rd)], .003, 4, BRASS, C['brass'], up=XA, caps=(False, False))
    ym = (yb + yt) / 2
    pl = V(math.cos(a0) * (Rd + .002), ym, math.sin(a0) * (Rd + .002))
    torus(pc, pl + V(.006, 0, .004), V(math.cos(a0), 0, math.sin(a0)).cross(YA), .009, .0022, 8, 4, BRASS, C['brass_light'], a0=0, a1=math.pi * 1.4)
    for y in (yb + .025, yt - .025):
        ph = V(math.cos(a1) * (Rd + .001), y, math.sin(a1) * (Rd + .001))
        torus(pc, ph, YA, .0055, .0022, 8, 3, BRASS, C['brass_dark'])
    torus(pc, V(0, yb - .012, Rd + .004), XA, .009, .0022, 8, 3, BRASS, C['brass_light'], ref=-YA)
    pc.sec('tray')
    # tray: engraved rim bead, flared skirt and foot
    tray = [(.122, -.478), (.151, -.47), (.154, -.479), (.148, -.49), (.14, -.518), (.124, -.53), (.13, -.55), (.0, -.55)]
    lathe(pc, (0, 0, 0), YA, tray, 20, BRASS,
          lambda i, j, p: C['brass_light'] if i in (1, 2) else (C['brass_dark'] if i in (3, 5) else C['brass']))
    pc.sec('sand')
    # sand floor with a scatter of seed husks
    FLOOR_Y = -.478
    def sand(i, j, p): return mix(C['sand'], C['sand_dark'], .4 * vnoise(p.x * 60, p.z * 60, 0, 3))
    lathe(pc, (0, 0, 0), YA, [(0, FLOOR_Y + .002), (.07, FLOOR_Y + .0015), (.124, FLOOR_Y - .001)], 16, PAINT, sand)
    rng = np.random.default_rng(77)
    for k in range(4):
        th = rng.uniform(0, TAU); r = rng.uniform(.03, .11)
        c = V(math.cos(th) * r, FLOOR_Y + .003, math.sin(th) * r)
        hull(pc, chunk_points(c, (.0055, .0025, .0035), RY(rng.uniform(0, TAU)), rng, cut=.8, jitter=.25), PAINT,
             lambda p, n: C['seed_light'] if n.y > .5 else C['seed'])
    pc.sec('perch')
    # perch: a wooden dowel across the cage with brass end collars
    PY = -.385; PR = .0068
    beam(pc, (-Rc + .002, PY, 0), (Rc - .002, PY, 0), PR * 2, PR * 2, up=(0, 1, 0), mat=TIMBER, col=C['timber_c'], ch=PR * .55,
         segs=2, cap_col=C['end'], colvar=.08, seed=11, tile=.4)
    for s in (-1, 1):
        lathe(pc, (s * (Rc - .012), PY, 0), XA * s, [(.0095, .009), (.0105, .004), (.0105, -.004), (.0095, -.009)], 6, BRASS, gold, ref=YA)
    pc.anchors['perch'] = [0.0, round(PY + PR, 4), 0.0]
    pc.anchors['floor'] = [0.0, round(FLOOR_Y + .002, 4), 0.0]
    pc.sec('water')
    # water cup (left front) and seed cup (right front), hooked over the bars
    for th, kind in ((math.radians(150), 'water'),):
        d = V(math.cos(th), 0, math.sin(th)); c = d * (Rc - .026) + YA * -.432
        lathe(pc, c, YA, [(.0, .0), (.019, .0), (.019, .021), (.022, .026), (.024, .024), (.022, .0), (.018, -.006), (0, -.006)][::-1][::-1],
              8, BRASS, lambda i, j, p: C['brass_light'] if i in (2, 3) else C['brass'])
        # (profile above runs inside-floor -> inner wall -> rim -> outer wall -> base)
        top = c + YA * .017
        if kind == 'water':
            disc(pc, top, YA, .0185, 10, PAINT, C['water'])
            disc(pc, top + YA * .0004 + d * -.004 + V(-.003, 0, 0), YA, .006, 6, PAINT, C['water_light'])
        else:
            for k in range(5):
                q = top + V(rng.uniform(-.01, .01), .002, rng.uniform(-.01, .01))
                hull(pc, chunk_points(q, (.005, .003, .0035), RY(rng.uniform(0, TAU)), rng, cut=.8, jitter=.25), PAINT,
                     lambda p, n: C['seed_light'] if n.y > .5 else C['seed'])
        # hook strip over the rim to the bar
        hk = c + d * .022 + YA * .026
        tube(pc, [c + d * .018 + YA * .02, hk + YA * .008, hk + d * .006 + YA * .006, hk + d * .006 - YA * .012], .0022, 4, BRASS, C['brass_dark'], up=YA)
    pc.sec('a')
    # a little bell hanging from the dome on a short chain
    for k in range(2):
        torus(pc, (0, -.094 - .011 * k, 0), XA if k % 2 else ZA, .005, .0015, 6, 3, BRASS, C['brass_dark'], ref=YA)
    lathe(pc, (0, 0, 0), YA, [(0, -.124), (.006, -.125), (.011, -.132), (.013, -.142), (.018, -.152), (.019, -.156), (.013, -.156), (.0, -.15)],
          8, BRASS, lambda i, j, p: C['brass_light'] if i in (3, 4) else C['brass'])
    hull(pc, chunk_points(V(0, -.158, 0), (.0035, .0035, .0035), Matrix.Identity(3), rng, cut=.0, jitter=.0), BRASS, lambda p, n: C['brass_dark'])
    return pc

# ===================================================================== LunchPail
def build_lunch():
    pc = Piece('LunchPail', reach=.16, ray_off=.0015)
    rng = np.random.default_rng(404)
    PX, SZ = -.062, .8                      # pail centre x, oval squash in z
    RO = .12
    m0 = pc.mark()
    dents = [(math.radians(68), .055, .03, .014), (math.radians(-25), .13, .028, .011), (math.radians(118), .14, .022, .009)]
    prof = [(0, .03), (.111, .03), (.111, .166), (.116, .176), (.123, .174), (.124, .166), (.12, .158), (.12, .112), (.123, .106),
            (.122, .094), (.12, .088), (.12, .02), (.123, .012), (.117, .0), (0, .0)]
    band = {7, 8, 9, 10}
    def pcol(i, j, p):
        if i <= 2: return C['tin_inside'] if i < 2 else mix(C['tin_inside'], C['tin'], .4)
        if i in (3, 4, 5, 12): return C['tin_light']
        if i in (8, 9): return mix(C['paint_red'], C['tin_dark'], .25)
        if i in (7, 10): return C['tin_light']
        return mix(C['tin'], C['tin_light'], .25 * vnoise(p.x * 30, p.y * 30, p.z * 30, 5))
    def pdisp(i, j, p):
        if i < 5 or i > 12: return Vector()
        rad = Vector((p.x, 0, p.z)); th = math.atan2(p.z, p.x); out = Vector()
        for (td, yd, sz, dep) in dents:
            da = (th - td + math.pi) % TAU - math.pi
            w = math.exp(-((da * RO) ** 2 + (p.y - yd) ** 2) / (sz * sz))
            out -= rad.normalized() * dep * w
        return out
    lathe(pc, (0, 0, 0), YA, prof, 22, IRON, pcol, disp=pdisp)
    pc.xform(m0, Matrix.Diagonal((1, 1, SZ)), V(PX, 0, 0))
    pc.sec('side')
    # side lugs and the folded-back wire bail
    for s in (-1, 1):
        lug = V(PX + s * (RO + .004), .142, 0)
        rivet(pc, lug, V(s, 0, 0), .011, IRON, C['tin_light'])
    bail = []
    for k in range(17):
        a = math.pi * k / 16
        bail.append(V(PX - math.cos(a) * (RO + .011), .142 + math.sin(a) * .07 * .25, -math.sin(a) * .1))
    tube(pc, bail, .0035, 5, IRON, C['iron'], caps=(True, True))
    pc.sec('the')
    # the lid, ajar: pivoting on the front-left rim, its back-right edge lifted (so its top, and the pretzel, face you)
    lid = pc.mark()
    lprof = [(0, .047), (.012, .046), (.016, .04), (.03, .036), (.07, .028), (.104, .015), (.127, .004), (.13, -.004), (.126, -.011),
             (.116, -.011), (.114, .0), (.0, .02)]
    def lcol(i, j, p):
        if i <= 1: return C['tin_dark']
        if i in (6, 7, 8): return C['tin_light']
        if i >= 9: return C['tin_inside']
        return mix(C['tin'], C['tin_light'], .35 * vnoise(p.x * 25, 0, p.z * 25, 9))
    lathe(pc, (0, 0, 0), YA, lprof, 22, IRON, lcol)
    pc.xform(lid, Matrix.Diagonal((1, 1, SZ)))
    th_h = math.radians(125)
    hinge = V(math.cos(th_h) * RO, 0, math.sin(th_h) * RO * SZ)
    axis = V(-math.sin(th_h), 0, math.cos(th_h) * SZ).normalized()
    Ml = Matrix.Rotation(.32, 3, axis)
    if (Ml @ (-hinge * 2)).y < 0: Ml = Matrix.Rotation(-.32, 3, axis)
    for i in range(lid[0], len(pc.P)): pc.P[i] = Ml @ (pc.P[i] - hinge) + hinge + V(PX, .176, 0)
    LM = lambda p: Ml @ (p - hinge) + hinge + V(PX, .176, 0)     # lid space -> piece space
    pc.sec('pickle')
    # pickle peeking out from under the lifted front
    pk = [V(PX - .01, .14, .02), V(PX + .05, .17, -.02), V(PX + .11, .2, -.055), V(PX + .165, .214, -.075)]
    pk = spline(pk, 4)
    pk.append(pk[-1] + (pk[-1] - pk[-2]).normalized() * .004)
    def prad(i, s): return .021 * max(.05, 1 - abs(2 * s - 1) ** 5) ** .2 * (1 + .1 * (vnoise(i * 1.3, 0, 0, 3) - .5))
    def pkcol(i, j, p, r):
        c = mix(C['pickle_dark'], C['pickle'], .5 + .5 * math.cos(j * TAU / 9 * 3))
        bump = vnoise(p.x * 160, p.y * 160, p.z * 160, 4)
        return mix(c, C['pickle_light'], smoothstep(.62, .8, bump) * .8 + .15 * max(0, r.y))
    tube(pc, pk, prad, 9, PAINT, col_fn=pkcol, caps=(False, False))
    pc.sec('a')
    # a checked napkin corner flopped over the front-right rim
    th0, th1, rows = math.radians(28), math.radians(78), 5
    cols = 6
    grid = []
    for iv in range(rows + 1):
        row = []
        for iu in range(cols + 1):
            u, v = iu / cols, iv / rows
            th = lerp(th0, th1, u)
            drop = .02 + .085 * (1 - abs(2 * u - 1) ** 1.3)
            if v < .25:   # over the rim and into the pail
                t = v / .25; r = lerp(RO - .02, RO + .009, t); y = .181 + .004 * math.sin(math.pi * t)
            else:
                t = (v - .25) / .75; r = RO + .009 + .004 * math.sin(u * 9); y = .181 - drop * t
            row.append(V(PX + math.cos(th) * r, y, math.sin(th) * r * SZ))
        grid.append(row)
    for iv in range(rows):
        for iu in range(cols):
            u = (iu + .5) / cols; v = (iv + 1) / rows
            if v > .25 and (iv - 1) / rows * .75 > (1 - abs(2 * u - 1)) * .9 + .05: continue
            cc = C['cloth_red'] if (iu + iv) % 2 == 0 else C['cloth_white']
            q = [grid[iv][iu], grid[iv][iu + 1], grid[iv + 1][iu + 1], grid[iv + 1][iu]]
            ids = [pc.v(p, cc) for p in q]
            cen = sum(q, Vector()) / 4
            pc.f(ids, PAINT, False, None, out=Vector((cen.x - PX, .2 if iv == 0 else 0, cen.z)))
    pc.sec('the')
    # the pretzel, resting on the lid
    U = [(-.42, -.40, .55), (-.18, -.12, .4), (.0, .06, .95), (.2, .3, .5), (.42, .62, .2), (.62, .88, 0), (.9, .82, 0), (1.03, .45, 0),
         (.92, .0, 0), (.58, -.42, 0), (.0, -.6, 0), (-.58, -.42, 0), (-.92, .0, 0), (-1.03, .45, 0), (-.9, .82, 0), (-.62, .88, 0),
         (-.42, .62, .2), (-.2, .3, .5), (.0, .06, -.1), (.18, -.12, .4), (.42, -.40, .55)]
    S = .1; rr = .017
    ctrl = [V(x * S, z * rr, -y * S) for x, y, z in U]     # pretzel plane = lid top (x, -z); z-up offsets for crossings
    pts = spline(ctrl, 2)
    def rrad(i, s):
        belly = smoothstep(.25, .45, s) * (1 - smoothstep(.55, .75, s))
        return rr * (.72 + .45 * belly) * (.8 + .2 * min(1, s * 12, (1 - s) * 12))
    Mp = RY(.35)
    def lid_y(x, z):          # lid-space height of the dome surface under (x, z)
        r = math.hypot(x, z / SZ)
        for (r0, h0), (r1, h1) in zip(lprof, lprof[1:]):
            if r0 <= r <= r1: return lerp(h0, h1, (r - r0) / max(1e-6, r1 - r0))
        return .0
    for i, p in enumerate(pts):
        q = Mp @ p; q = V(q.x * .92, 0, q.z * .92 + .004)
        pts[i] = LM(q + V(0, lid_y(q.x, q.z) + rr * .8 + p.y, 0))
    def pzcol(i, j, p, r):
        up = r.dot(Ml @ YA)
        c = mix(C['pretzel'], C['pretzel_light'], smoothstep(-.4, .9, up) * .55)
        c = mix(c, C['pretzel_dark'], smoothstep(-.1, -.8, up) * .6)
        s = i / max(1, len(pts) - 1)
        if .3 < s < .7 and up > .55: c = mix(c, C['pretzel_split'], smoothstep(.55, .9, up) * .9)
        return c
    tube(pc, pts, rrad, 7, PAINT, col_fn=pzcol, caps=(True, True))
    pc.sec('coarse')
    # coarse salt on the pretzel: tiny cubes on its upper surface, glowing a little like the mine's salt
    for k in range(20):
        i = int(rng.integers(2, len(pts) - 3)); p = pts[i]
        d = (pts[i + 1] - pts[i - 1]).normalized(); upv = Ml @ YA
        side = d.cross(upv).normalized()
        q = p + upv * rrad(i, i / (len(pts) - 1)) * .92 + side * rng.uniform(-.008, .008)
        hs = rng.uniform(.0028, .0045)
        crystal(pc, q, rot_up(upv, rng.uniform(0, TAU)) @ RX(rng.uniform(-.4, .4)), (hs, hs, hs), C['cr_milk'], .55, ch=0.0, seed=k)
    pc.sec('a')
    # a little knob on the lid
    # (the lid's centre bump; left plain, the pretzel sits there)
    pc.sec('enamel')
    # enamel mug beside it, handle out to the right
    MX, MZ = .18, .035
    mprof = [(0, .012), (.039, .012), (.039, .086), (.042, .094), (.046, .092), (.047, .086), (.046, .07), (.044, .012), (.046, .006), (.041, .0), (0, .0)]
    def mcol(i, j, p):
        if i in (3, 4, 5, 9, 8): return C['enamel_blue']
        if i < 3: return mix(C['enamel'], C['tin_inside'], .25 if i < 2 else 0)
        if i == 6: return mix(C['enamel'], C['enamel_blue'], .1)
        return C['enamel']
    lathe(pc, (MX, 0, MZ), YA, mprof, 16, PAINT, mcol)
    disc(pc, V(MX, .068, MZ), YA, .0392, 14, PAINT, C['coffee'])
    disc(pc, V(MX - .008, .0682, MZ + .006), YA, .012, 8, PAINT, C['crema'])
    hd = [V(MX + .044, .078, MZ), V(MX + .072, .075, MZ), V(MX + .078, .05, MZ), V(MX + .068, .026, MZ), V(MX + .044, .024, MZ)]
    tube(pc, spline(hd, 3), .006, 6, PAINT, C['enamel_blue'], ell=(1, 1.5), up=ZA, caps=(False, False))
    pc.sec('a')
    # a few crumbs
    for k in range(3):
        c = V(rng.uniform(-.02, .16), .003, rng.uniform(.09, .15))
        hull(pc, chunk_points(c, (.005, .003, .004), RY(rng.uniform(0, TAU)), rng, cut=.8, jitter=.3), PAINT,
             lambda p, n: C['pretzel_light'] if n.y > .5 else C['pretzel'])
    return pc

# ===================================================================== Saltman
def helmet(pc, centre, M, rng, candle=True, dent=True, scale=1.0):
    """Little miner's hard hat: dome, ridge, brim, a front lamp bracket with a candle. centre = brim plane centre."""
    m0 = pc.mark()
    prof = [(0, .118), (.03, .116), (.062, .106), (.09, .088), (.11, .064), (.122, .036), (.126, .012), (.132, .004), (.17, -.004),
            (.172, -.012), (.164, -.016), (.126, -.008)]
    def hcol(i, j, p):
        c = C['helmet']
        if i in (6, 7): return C['helmet_dark']
        if i >= 9: return mix(C['helmet_dark'], C['helmet'], .4)
        return mix(c, C['gold_light'], smoothstep(.06, .11, p.y) * .25)
    def hdisp(i, j, p):
        if not dent or i > 6: return Vector()
        dc = V(-.08, .085, .04); w = math.exp(-((p - dc).length ** 2) / (.04 ** 2))
        return -(p - V(0, 0, 0)).normalized() * .016 * w
    lathe(pc, (0, 0, 0), YA, prof, 18, PAINT, hcol, disp=hdisp)
    pc.sec('front-to-bac')
    # front-to-back ridge
    ridge = [V(0, math.cos(a) * .118 + .004, math.sin(a) * .118) for a in np.linspace(-1.25, 1.2, 8)]
    ridge = [V(0, p.y * .99, p.z * 1.0) for p in ridge]
    tube(pc, ridge, .011, 5, PAINT, C['helmet_dark'], ell=(1, .55), up=XA)
    if candle:
        # brass lamp bracket on the front with a candle cup
        box(pc, V(0, .045, .118), (XA, YA, ZA), (.022, .03, .006), mat=BRASS, col=C['brass'], ch=.004)
        rivet(pc, V(0, .062, .125), ZA, .006, BRASS, C['brass_light'])
        lathe(pc, V(0, .07, .142), YA, [(0, .0), (.017, .0), (.019, .016), (.022, .018), (.02, -.006), (0, -.008)], 10, BRASS,
              lambda i, j, p: C['brass_light'] if i in (2, 3) else C['brass'])
        beam(pc, V(0, .045, .122), V(0, .064, .142), .01, .006, up=XA, mat=BRASS, col=C['brass_dark'])
        # the candle: short stub with wax drips, a wick and a teardrop flame
        def wax(i, j, p): return C['wax'] if i < 3 else C['wax_shadow']
        dr = lambda i, j, p: V(0, -.006 if (j % 4 == 1 and i == 2) else 0, 0)
        lathe(pc, V(0, .07, .142), YA, [(0, .068), (.012, .067), (.0135, .062), (.013, .03), (.013, .004)], 10, PAINT, wax,
              disp=lambda i, j, p: V(0, 0, 0) if i < 3 else V(0, -.004 * (j % 3 == 0), 0))
        for k, a in enumerate((.6, 2.4, 4.2)):
            q = V(math.cos(a) * .0135, .07 + .055 - .01 * k, .142 + math.sin(a) * .0135)
            tube(pc, [q + V(0, .006, 0), q, q + V(0, -.012 - .006 * k, 0)], [.004, .0045, .0035], 5, PAINT, C['wax'], caps=(False, True))
        beam(pc, V(0, .07 + .066, .142), V(0, .07 + .076, .142), .0025, .0025, up=ZA, mat=PAINT, col=C['wick'])
        lathe(pc, V(0, .07 + .074, .142), YA, [(0, .052), (.006, .04), (.012, .022), (.013, .012), (.01, .004), (.005, .0), (0, -.001)],
              8, GLOW, lambda i, j, p: C['glow'], ao=0.0)
    pc.xform(m0, M * scale, Vector(centre))

def build_saltman():
    pc = Piece('Saltman', reach=.35, ray_off=.002)
    rng = np.random.default_rng(505)
    balls = [(V(0, .262, 0), .29, .92, 1.1, 51), (V(.004, .69, .01), .21, .96, .7, 52), (V(.0, .99, .02), .155, 1.0, -.4, 53)]
    RBS = []
    for bi, (c, R, sq, spin, seed) in enumerate(balls):
        Rb = RY(spin) @ RX(.3 * (bi - 1))
        def rfn(d, R=R, sq=sq, Rb=Rb, seed=seed):
            q = Rb.transposed() @ d
            k = 3.0
            box_ = (abs(q.x) ** k + abs(q.y) ** k + abs(q.z) ** k) ** (-1 / k)       # rounded-cube lump
            n = fbm((d.x * 1.8 + seed, d.y * 1.8, d.z * 1.8), seed, 3) - .5
            n = lerp(n, round(n * 4) / 4, .6)                                          # cleavage terraces
            r = R * lerp(1.0, box_, .55) * (1 + .16 * n)
            return r * (sq if d.y > 0 else 1.0)
        def bcol(p, n, d, seed=seed):
            cc, m = rock_col(p * 1.4, seed, white=.45)
            return mul(cc, 1.03 if n.y > .3 else .97)
        def bmask(p, d, seed=seed):
            return rock_col(p * 1.4, seed, white=.45)[1] * .8
        ids = blob(pc, c, rfn, 14, 10, ROCK, bcol, mask=bmask, smooth=False)
        g = [.06, .05, .04][bi]
        for i in ids:   # pull the lump toward a cubic grid in its own frame: stepped halite cleavage, not a smooth ball
            q = Rb.transposed() @ (pc.P[i] - c)
            qs = Vector([round(x / g) * g for x in q])
            pc.P[i] = c + Rb @ q.lerp(qs, .42)
            if pc.P[i].y < -.012: pc.P[i].y = -.012
        RBS.append(Rb)
    bv = pc.bvh()
    pc.sec('halite')
    # halite cubes set into the lumps along the lump's own cleavage grid, mostly buried, the outward face a stepped
    # hopper pit: they read as crystals in the rock, not cubes stuck on
    for bi, (c, R, sq, spin, seed) in enumerate(balls):
        nk = [6, 5, 3][bi]; Rb = RBS[bi]
        for k in range(nk):
            th = TAU * (k + rng.uniform(-.3, .3)) / nk + bi; ph = rng.uniform(-.45, .7)
            if bi == 2 and abs(((th % TAU) - math.pi / 2)) < .9: th += math.pi   # keep the face clear
            d = V(math.cos(th) * math.cos(ph), math.sin(ph), math.sin(th) * math.cos(ph))
            hit = bv.ray_cast(c + d * R * 1.6, -d, R * 2)
            if hit[0] is None: continue
            hs = rng.uniform(.03, .05) * (1.15 if bi == 0 else 1.0)
            q = Rb.transposed() @ d; ax = max(range(3), key=lambda a: abs(q[a])); sg = 1 if q[ax] > 0 else -1
            base, _ = rock_col(hit[0] * 1.4, seed, white=.45)
            colr = mix(base, [C['cr_milk'], C['cr_pale'], C['cr_rose']][k % 3], .6)
            crystal(pc, hit[0] - d * hs * .45, Rb, (hs, hs, hs), colr, .6, seed=bi * 10 + k, ch=hs * .08,
                    hopper={(ax, sg)}, steps=3 if hs > .04 else 2)
    def coal_at(c, d, s, k):
        q = c + d * .004
        hull(pc, chunk_points(q, (s, s * .85, s * .7), rot_up(d, rng.uniform(0, TAU)), rng, cut=.5, jitter=.25), PAINT,
             lambda p, n: C['coal_hi'] if n.dot(d) > .7 and n.y > .1 else C['coal'])
    def surf(c, d, R):
        hit = bv.ray_cast(c + d * R * 1.8, -d, R * 3); return hit[0] if hit[0] is not None else c + d * R
    hc, hR = balls[2][0], balls[2][1]
    for s in (-1, 1):   # coal eyes, set a little wide and high: friendly
        d = V(s * .36, .26, .9).normalized(); coal_at(surf(hc, d, hR), d, .021, 0)
    for k in range(5):  # coal smile
        a = (k - 2) * .24
        d = V(math.sin(a) * .95, -.33 - .06 * math.cos(a * 2.2), .95).normalized()
        coal_at(surf(hc, d, hR), d, .011, k)
    mc, mR = balls[1][0], balls[1][1]
    for k, y in enumerate((.1, -.02)):
        d = V(.03 * k, y * 4.5, 1).normalized(); coal_at(surf(mc, d, mR), d, .022, k)
    bc, bR = balls[0][0], balls[0][1]
    for y in (.32, -.05):
        d = V(0, y, 1).normalized(); coal_at(surf(bc, d, bR), d, .026, 0)
    pc.sec('carrot')
    # carrot nose (from someone's lunch), drooping a little
    nd = V(.06, -.18, 1).normalized(); n0 = surf(hc, V(0, .05, 1).normalized(), hR) - nd * .02
    lathe(pc, n0, nd, [(0, .135), (.006, .12), (.011, .095), (.016, .065), (.019, .035), (.021, .0)], 7, PAINT,
          lambda i, j, p: C['carrot_dark'] if i in (2, 4) else C['carrot'], ref=YA)
    pc.sec('pick-handle')
    # pick-handle arms: the left one waving high, the right one resting low
    for s, tip, up in ((1, V(.44, 1.2, .1), .3), (-1, V(-.5, .5, .25), -.15)):
        root = mc + V(s * .13, .06, 0)
        timber_beam(pc, root, tip, .044, .04, rng, up=(0, 0, 1), segs=4, taper=1.25, ch=.012, shade=C['timber_c'], bow=V(0, up * .06, 0))
        d = (tip - root).normalized()
        knob = tip + d * .018
        lathe(pc, knob, d, [(0, .03), (.022, .022), (.031, .0), (.028, -.022), (.024, -.03)], 8, TIMBER, lambda i, j, p: C['timber_c'])
        q = root + (tip - root) * .78   # iron ferrule where the pick head used to sit
        lathe(pc, q, d, [(.03, .012), (.031, .006), (.031, -.006), (.03, -.012)], 8, IRON, lambda i, j, p: C['iron'])
        sd = d.cross(ZA).normalized()
        for k, a in enumerate((-.6, 0.0, .55)):   # twig fingers spread from the knob
            fd = (d * math.cos(a) + sd * math.sin(a) + ZA * .15).normalized()
            beam(pc, knob + d * .01, knob + d * .01 + fd * (.07 if k == 1 else .055), .012, .012, up=ZA, mat=TIMBER,
                 col=C['timber_a'], taper=.5, cap_col=C['end'], seed=k, tile=.4)
    pc.sec('little')
    # little twig fingers on the waving hand: three salt-crusted wire ends
    tip = V(.6, 1.06, .1) + V(.6, 1.06, .1).normalized() * 0
    pc.sec('sack')
    # sack scarf round the neck, two tails with printed stripes and frayed ends
    ny = .885
    ring = []
    for k in range(20):
        a = TAU * k / 20
        ring.append(V(.004 + math.cos(a) * .128, ny + .012 * math.sin(a * 2 + .5), .015 + math.sin(a) * .132))
    def scol(i, j, p, r): return mix(C['burlap'], C['burlap_dark'], .35 * (1 - r.y) * .5 + .3 * (vnoise(p.x * 90, p.y * 90, p.z * 90, 3) > .6))
    tube(pc, ring, .046, 8, PAINT, col_fn=scol, closed=True, ell=(.55, 1.0), up=YA)
    knot = V(.08, ny - .01, .12)
    hull(pc, chunk_points(knot, (.04, .035, .03), RY(.6), rng, cut=.6, jitter=.2), PAINT, lambda p, n: C['burlap'])
    for k, (dx, ln, sw) in enumerate(((.02, .27, .25), (.08, .2, -.2))):
        pts = []
        for t in np.linspace(0, 1, 7):
            y = ny - .02 - t * ln
            dd = V(.1 + dx + sw * .1 * t, 0, 1).normalized()
            p = surf(mc, (V(dd.x, (y - mc.y) / mR, dd.z)).normalized(), mR)
            pts.append(p + (p - mc).normalized() * (.012 + .004 * k))
        pts[0] = knot + V(dx * .5, -.01, .02)
        w = .068
        L, Rr = [], []
        for i, p in enumerate(pts):
            d = (pts[min(6, i + 1)] - pts[max(0, i - 1)]).normalized(); nrm = (p - mc).normalized()
            side = d.cross(nrm).normalized() * (w / 2) * (1 - .15 * i / 6)
            L.append(p + side); Rr.append(p - side)
        for i in range(6):
            band = 3 <= i <= 4
            cc = C['sack_red'] if band and k == 0 else (C['sack_blue'] if band else C['burlap'])
            cc = mix(cc, C['burlap_light'], .15 * (i % 2))
            for sgn, off in ((1, .0025), (-1, -.0025)):
                q = [L[i], Rr[i], Rr[i + 1], L[i + 1]]
                ids = [pc.v(p + (p - mc).normalized() * off, cc) for p in q]
                cen = sum(q, Vector()) / 4
                pc.f(ids, PAINT, True, None, out=(cen - mc) * sgn)
        # frayed fringe: little zigzag teeth at the end
        a, b = L[6], Rr[6]; d = (pts[6] - pts[5]).normalized()
        for f in range(5):
            p0 = a + (b - a) * (f / 5); p1 = a + (b - a) * ((f + 1) / 5); tipp = (p0 + p1) / 2 + d * .016
            ids = [pc.v(p0, C['burlap_light']), pc.v(p1, C['burlap_light']), pc.v(tipp, C['burlap_light'])]
            pc.f(ids, PAINT, False, None, out=(p0 - mc))
            ids = [pc.v(p0, C['burlap_light']), pc.v(p1, C['burlap_light']), pc.v(tipp, C['burlap_light'])]
            pc.f(ids, PAINT, False, None, out=-(p0 - mc))
    pc.sec('dented')
    # dented miner's helmet, tipped back at a jaunty angle, candle lit
    helmet(pc, hc + V(-.004, .118, -.012), RZ(.16) @ RX(-.2), rng, scale=.92)
    return pc

# ===================================================================== SaltShaker (The Great Salt Shaker)
def build_shaker():
    pc = Piece('SaltShaker', reach=.4, ray_off=.002)
    rng = np.random.default_rng(606)
    pc.sec('----')
    # ---- the carved salt plinth (0.5 m): foot slab, die with framed panels, cornice, cap slab
    def rc(white=.55, seed=71):
        def f(p): return rock_col(p * 1.6, seed, white)
        return f
    def slab(c, half, ch, white=.55, seed=71, mask_k=.8, colk=1.0):
        rcf = rc(white, seed)
        m0 = pc.mark()
        box(pc, c, (XA, YA, ZA), half, mat=ROCK, col=C['rock_white'], ch=ch, flat=True)
        for i in range(m0[0], len(pc.P)):
            cc, m = rcf(pc.P[i]); pc.C[i] = mul(cc, colk); pc.M[i] = m * mask_k
    slab(V(0, .045, 0), (.46, .045, .46), .03, white=.45, colk=.96)
    slab(V(0, .1, 0), (.42, .012, .42), .008, white=.7)
    slab(V(0, .26, 0), (.36, .155, .36), .025, white=.6)
    slab(V(0, .425, 0), (.41, .012, .41), .008, white=.7)
    slab(V(0, .462, 0), (.44, .028, .44), .02, white=.5)
    slab(V(0, .495, 0), (.38, .009, .38), .006, white=.75)
    pc.sec('raised')
    # raised panel frames on the four faces, each holding a glowing salt crystal (corner-on, like the portal sign)
    for k in range(4):
        Ry = RY(k * math.pi / 2)
        n = Ry @ ZA; t = Ry @ XA
        fc = n * .362 + YA * .26
        for (a, b) in (((-.26, .13), (.26, .13)), ((-.26, -.13), (.26, -.13)), ((-.26, -.13), (-.26, .13)), ((.26, -.13), (.26, .13))):
            p0 = fc + t * a[0] + YA * a[1]; p1 = fc + t * b[0] + YA * b[1]
            ext = (p1 - p0).normalized() * .02
            m0 = pc.mark()
            beam(pc, p0 - ext, p1 + ext, .035, .02, up=n, mat=ROCK, col=C['rock_white'], ch=0.0, flat=True)
            for i in range(m0[0], len(pc.P)):
                cc, m = rock_col(pc.P[i] * 1.6, 72, .75); pc.C[i] = cc; pc.M[i] = m * .7
        R = Ry @ rot_up((0, 0, 1), 0.0, CORNER_UP)
        if k == 0:
            crystal(pc, fc - n * .045, R, (.085, .085, .085), C['cr_rose'], .95, ch=.01, seed=80, hopper=())
        else:
            crystal(pc, fc - n * .035, R, (.06, .06, .06), C['cr_pale'], .8, ch=.008, seed=80 + k)
    pc.sec('----')
    # ---- the shaker (1.3 m) on top, base at y0
    y0 = .5
    def G(light_rows=(), dark_rows=(), deep_rows=()):
        def f(i, j, p):
            if i in deep_rows: return C['gold_deep']
            if i in dark_rows: return C['gold_dark']
            if i in light_rows: return C['gold_light']
            return C['gold']
        return f
    O = V(0, y0, 0)
    # Silhouette: a classic heirloom shaker. A tall twelve-sided glass body, gently waisted and packed with glowing
    # pink-white salt up to a wavy fill line, clear glass above it, a chunky threaded collar and a big domed cap
    # pierced with glowing holes. Gold foot, waist belt with salt gems and a crown finial make it the idol.
    PH = math.pi / 12                                      # puts a flat facet square to +Z (lathe with ref=XA)
    def fdir(th): return V(math.cos(th), 0, -math.sin(th))
    pc.sec('foot')
    foot = [(.25, .118), (.29, .112), (.31, .1), (.33, .074), (.346, .046), (.352, .022), (.346, .006), (.325, -.002)]
    def flute(i, j, p):
        if i < 2 or i > 5: return Vector()
        rad = Vector((p.x, 0, p.z)).normalized(); th = math.atan2(p.z, p.x)
        return rad * .01 * math.cos(th * 18) * math.sin(math.pi * (i - 1) / 5)
    lathe(pc, O, YA, foot, 36, BRASS, G(light_rows=(2, 3), dark_rows=(6,), deep_rows=(1,)), disp=flute, ref=XA)
    pc.sec('glass')
    FILL = .87
    def wave(j): return .02 * (vnoise(j * .9, 3.1, 0, 17) - .5) + .008 * math.sin(j * 2.1)
    def body_r(h):                                         # gently waisted glass, widest low down
        return .3 - .03 * math.exp(-((h - .52) / .2) ** 2) + .006 * math.sin(h * 9) * 0
    salt = [(body_r(h), h) for h in np.linspace(FILL, .13, 19)] + [(.3, .11), (.288, .095)]
    glass = [(.235, 1.0), (.272, .988), (.293, .966), (.3, .93), (body_r(FILL), FILL)]
    def scol(i, j, p):
        # layered salt, like a shaker filled over many years: wavy white, blush and rose strata, sparkly grain
        h = p.y - y0 + .014 * math.sin(math.atan2(p.z, p.x) * 3 + 1.3) + .01 * (vnoise(p.x * 14, p.y * 3, p.z * 14, 33) - .5)
        k = int(math.floor(h / .095)) % 3
        c = [C['cr_milk'], C['cr_pale'], C['cr_rose']][k]
        return mix(c, C['white'], .3 * smoothstep(.6, .85, vnoise(p.x * 40, p.y * 40, p.z * 40, 31)))
    lathe(pc, O, YA, salt, 12, CRYSTAL, scol, mask=lambda i, j: .95 if i == 0 else .8 + .15 * vnoise(i, j, 0, 4), smooth=False,
          ref=XA, phase=PH, disp=lambda i, j, p: YA * wave(j) if i == 0 else Vector())
    def gcol(i, j, p): return mix(C['glass'], C['glass_light'], .55 if i in (1, 2) else 0.0)
    lathe(pc, O, YA, glass, 12, CRYSTAL, gcol, mask=.06, smooth=False, ref=XA, phase=PH,
          disp=lambda i, j, p: YA * wave(j) if i == len(glass) - 1 else Vector())
    # glass highlights: two vertical glints running down the front facets
    for fc, f0, f1 in ((-math.pi / 2 - math.pi / 6, .5, .72), (-math.pi / 2, .14, .22)):
        ta, tb = fc - PH, fc + PH
        nrm = fdir(fc)
        rows = [(r, h) for r, h in glass[1:] + salt[1:-1]]
        L, R = [], []
        for r, h in rows:
            a = O + YA * h + fdir(ta) * r; b = O + YA * h + fdir(tb) * r
            L.append(a.lerp(b, f0) + nrm * .0015); R.append(a.lerp(b, f1) + nrm * .0015)
        for k in range(len(rows) - 1):
            ids = [pc.v(q, C['white'], .35) for q in (L[k], R[k], R[k + 1], L[k + 1])]
            pc.f(ids, CRYSTAL, False, None, out=nrm)
    pc.sec('belt')
    # gold waist belt with a salt gem on every other facet
    belt = [(.268, .552), (.282, .548), (.288, .538), (.288, .512), (.282, .502), (.268, .498)]
    lathe(pc, O, YA, belt, 12, BRASS, G(light_rows=(2,), dark_rows=(4,), deep_rows=(0, 5)), smooth=False, ref=XA, phase=PH)
    for k in range(6):
        fc = -math.pi / 2 + k * TAU / 6
        d = fdir(fc); c = O + YA * .525 + d * (.288 * math.cos(PH) + .004)
        lathe(pc, c - d * .003, d, [(.0, .01), (.02, .008), (.022, .003), (.022, -.003)], 8, BRASS, G(light_rows=(1,), dark_rows=(3,)), ref=YA)
        crystal(pc, c + d * .005, rot_up(d, 0.0, CORNER_UP), (.0105, .0105, .0105), C['cr_deep'] if k % 2 else C['cr_rose'], .95, ch=.002,
                seed=90 + k, inner=C['cr_inner_deep'])
    pc.sec('collar')
    # chunky threaded collar
    collar = [(.225, 1.104), (.262, 1.102), (.274, 1.094), (.274, 1.082), (.266, 1.076), (.274, 1.07), (.274, 1.058), (.266, 1.052),
              (.274, 1.046), (.274, 1.032), (.262, 1.0), (.235, .99)]
    lathe(pc, O, YA, collar, 36, BRASS, G(light_rows=(2, 6, 9), dark_rows=(4, 7), deep_rows=(10,)), ref=XA)
    pc.sec('cap')
    # big domed cap
    cap = [(0, 1.276), (.045, 1.272), (.1, 1.255), (.15, 1.227), (.19, 1.19), (.218, 1.152), (.236, 1.124), (.244, 1.112), (.258, 1.106),
           (.26, 1.098), (.25, 1.094)]
    lathe(pc, O, YA, cap, 36, BRASS, G(light_rows=(1, 2, 8), dark_rows=(6,), deep_rows=(9,)), ref=XA)
    def cap_r(y):
        for (r0, h0), (r1, h1) in zip(cap, cap[1:]):
            if h1 <= y <= h0: return lerp(r0, r1, (h0 - y) / (h0 - h1))
        return 0.0
    # pierced holes: a dark brass rim with glowing salt behind, three rings round the finial
    for ring_y, count, ph in ((1.252, 8, 0.0), (1.222, 13, .26), (1.18, 18, .1)):
        r = cap_r(ring_y)
        e = .003; dr = (cap_r(ring_y - e) - cap_r(ring_y + e)) / (2 * e)
        for k in range(count):
            th = TAU * k / count + ph
            d = V(math.cos(th), 0, math.sin(th))
            nrm = (d * 1.0 + YA * dr).normalized()
            pp = O + d * r + YA * ring_y
            disc(pc, pp + nrm * .0012, nrm, .0155, 6, BRASS, C['gold_deep'], up=YA)
            disc(pc, pp + nrm * .0024, nrm, .0105, 6, CRYSTAL, C['cr_milk'], mask=1.0, up=YA)
    pc.sec('tiny')
    # tiny crown finial
    crown(pc, O + YA * 1.258, .72, rng, gem=True)
    pc.sec('----')
    # ---- spilled salt at the foot: a low glowing heap in front, a few loose cubes and grains on the plinth
    rock_dome(pc, .1, .64, .24, .045, 12, 3, seed=91, white=.8, col_fn=lambda p: (mix(C['crust'], C['crust_pink'], .3 * vnoise(p.x * 9, 0, p.z * 9, 3)), .55))
    for k in range(13):
        a = rng.uniform(0, TAU); r = rng.uniform(.0, .22)
        x, z = .1 + math.cos(a) * r, .64 + math.sin(a) * r * .8
        y = .045 * max(0, 1 - (r / .24) ** 2) ** .75
        hs = rng.uniform(.012, .028) if k % 4 else rng.uniform(.03, .042)
        colr = [C['cr_milk'], C['cr_pale'], C['cr_rose'], C['cr_milk']][k % 4]
        crystal(pc, V(x, y + hs * .3, z), rot_up(V(rng.uniform(-.4, .4), 1, rng.uniform(-.4, .4)), rng.uniform(0, TAU), CORNER_UP if k % 3 == 0 else YA),
                (hs, hs, hs), colr, .9, ch=0.0 if hs < .02 else None, seed=100 + k)
    for k in range(7):   # trail of grains up the plinth front and on its top
        if k < 5: x, y, z = rng.uniform(-.1, .2), rng.uniform(.005, .015), rng.uniform(.47, .52) if k % 2 else rng.uniform(.8, .95)
        else: a = rng.uniform(-1.2, 1.2) + math.pi / 2; x, y, z = math.cos(a) * .34, .505, math.sin(a) * .34
        hs = rng.uniform(.008, .014)
        crystal(pc, V(x, y + hs * .5, z), RY(rng.uniform(0, TAU)), (hs, hs, hs), C['cr_milk'], .85, ch=0.0, seed=120 + k)
    return pc

def crown(pc, base, scale, rng, gem=True, velvet=False, points=5):
    """Little gold crown; base = centre of the band's bottom; ~0.17 m across at scale 1."""
    m0 = pc.mark()
    def G(i, j, p): return C['gold_light'] if i in (1, 2, 5) else (C['gold_dark'] if i in (3, 7) else C['gold'])
    band = [(.068, .044), (.074, .043), (.078, .037), (.076, .031), (.077, .012), (.082, .007), (.083, .0), (.077, -.002), (.07, -.002),
            (.07, .042)]
    lathe(pc, V(0, 0, 0), YA, band, 22, BRASS, G)
    for k in range(points):
        th = TAU * k / points + math.pi / 2
        d = V(math.cos(th), 0, math.sin(th)); t = YA.cross(d)
        # a tapered spike leaning a touch outward, ball on the tip
        o = d * .073 + YA * .036; ax = (YA + d * .14).normalized()
        lathe(pc, o, ax, [(0, .056), (.0055, .044), (.01, .026), (.0145, .01), (.0165, .0), (.0165, -.008)], 8, BRASS,
              lambda i, j, p: C['gold_light'] if i in (1, 2) else (C['gold_dark'] if i == 5 else C['gold']), ref=d)
        tip = o + ax * .062
        ellipsoid(pc, tip, (.0085, .0085, .0085), 6, 4, BRASS, lambda p, n, d: C['gold_light'] if n.y > 0 else C['gold'])
    if velvet:
        lathe(pc, V(0, 0, 0), YA, [(0, .072), (.025, .068), (.048, .056), (.062, .04), (.068, .02), (.068, .006)], 14, PAINT,
              lambda i, j, p: C['velvet'] if i < 3 else C['velvet_dark'])
        lathe(pc, V(0, .068, 0), YA, [(0, .016), (.008, .014), (.011, .006), (.008, .0), (0, -.002)], 8, BRASS, G)
    if gem:
        f = V(0, .022, .086)
        lathe(pc, f - ZA * .006, ZA, [(.0, .012), (.018, .01), (.021, .004), (.021, -.004)], 10, BRASS, lambda i, j, p: C['gold_light'] if i < 2 else C['gold'], ref=YA)
        crystal(pc, f + ZA * .001, rot_up(ZA, 0.0, CORNER_UP), (.0105, .0105, .0105), C['cr_deep'], 1.0, ch=.002, seed=7,
                inner=C['cr_inner_deep'])
        for k in (-1, 1):
            th = math.pi / 2 + k * TAU / points
            d = V(math.cos(th), 0, math.sin(th))
            crystal(pc, V(0, .022, 0) + d * .078, rot_up(d, 0.0, CORNER_UP), (.0055, .0055, .0055), C['cr_rose'], .9, ch=.0, seed=8 + k)
    pc.xform(m0, Matrix.Diagonal((scale, scale, scale)), Vector(base))

# ===================================================================== CrabCrown
def build_crab_crown():
    pc = Piece('CrabCrown', reach=.05, ray_off=.0008)
    rng = np.random.default_rng(707)
    crown(pc, V(0, .002, 0), 1.0, rng, gem=True, velvet=True)
    return pc

# ===================================================================== SignCrabs
def build_sign():
    pc = Piece('SignCrabs', reach=.3, ray_off=.002)
    rng = np.random.default_rng(808)
    pc.sec('post')
    # post with a weathered pointed top, salt crust at its foot
    timber_beam(pc, (0, -.03, -.06), (0, 1.36, -.06), .1, .1, rng, up=(0, 0, 1), segs=5, taper=.96, ch=.014, shade=C['timber_b'])
    lathe(pc, V(0, 1.36, -.06), YA, [(0, .06), (.068, .0)], 4, TIMBER, lambda i, j, p: C['timber_b'], phase=math.pi / 4, smooth=False)
    m0 = pc.mark()
    crust_lumps(pc, 0, -.06, .05, .05, 10, rng, top=.22, crystals=3, seed=30)
    for i in range(m0[0], len(pc.P)): pc.P[i].y = max(pc.P[i].y, -.03)
    pc.sec('----')
    # ---- lower board: carved MIND THE / CRABS!, a single painted plank, hung a little crooked
    BW, BH, BT = .86, .4, .034
    cy = .86
    tilt = -.045
    outline = [(-BW / 2, -BH / 2 + .02), (-BW / 2 + .02, -BH / 2), (BW / 2 - .05, -BH / 2), (BW / 2, -BH / 2 + .03), (BW / 2 - .004, BH / 2 - .06),
               (BW / 2 - .045, BH / 2 - .02), (BW / 2 - .07, BH / 2), (-BW / 2 + .015, BH / 2), (-BW / 2, BH / 2 - .015)]
    wob = []
    for i, (x, y) in enumerate(outline):
        wob.append((x + .004 * (vnoise(i, 0, 0, 5) - .5), y + .004 * (vnoise(i, 1, 0, 5) - .5)))
    Mb = RZ(tilt); ob = V(0, cy, BT / 2 - .005)
    place = lambda p: Mb @ Vector(p) + ob
    cuts = [glyph_cut('MIND THE', .142, (0, .075), spacing=1.08), glyph_cut('CRABS!', .162, (0, -.092), spacing=1.1)]
    teal = lambda p: mix(C['paint_teal'], C['paint_teal_light'], .55 * vnoise(p.x * 9, p.y * 9, 0, 7))
    gr = lambda p: (p.x / .5, p.y / .5)
    carved_board(pc, wob, cuts, BT, .009, place, {
        'front': (TIMBER, teal, True, gr), 'floor': (PAINT, C['letter'], True, None),
        'wall': (PAINT, mix(C['letter'], C['carve'], .6), False, None), 'back': (TIMBER, C['timber_b'], True, gr),
        'edge': (TIMBER, mix(C['end'], C['paint_teal_dark'], .4), False, lambda p: (p.x / .5 + p.y / .5, p.z / .5))})
    front = BT / 2
    pc.sec('nails')
    for (x, y) in ((-.33, .16), (.31, -.16)):
        rivet(pc, place(V(x, y, front)), Mb @ ZA, .009, IRON, C['iron'])
    pc.sec('----')
    # ---- upper disc: red crab in a red ring with a slash ("no pinching")
    DC = V(0, 1.215, -.004); DR = .245
    fr = (DC, XA, YA, ZA)
    prism(pc, [circle2(0, 0, DR, 28)], fr, -.016, .016, TIMBER, lambda x, y: mix(C['paint_cream'], C['sign'], .12 + .15 * vnoise(x * 12, y * 12, 0, 3)),
          col_side=C['sign_dark'], col_back=C['timber_b'], uv_fn=lambda x, y: (x / .5, y / .5), smooth_sides=True)
    torus(pc, DC + ZA * .0, ZA, DR, .012, 28, 5, TIMBER, C['sign_dark'], ref=XA)   # rounded rim
    Z1 = .0165
    def crab_poly(z, col):
        body = circle2(0, -.035, .088, 16, ry=.058)
        prism(pc, [body], fr, Z1, z, PAINT, col)
        for s in (-1, 1):
            # arm and pincer (an open "C": sector of a disc with a notch)
            arm = [(s * .06, -.01), (s * .1, .045), (s * .085, .06), (s * .045, .0)]
            if s < 0: arm = arm[::-1]
            prism(pc, [arm], fr, Z1, z - .0004, PAINT, col)
            cx, cy2, cr = s * .118, .078, .044
            a_open = math.pi / 2 + s * (-.25)
            gap = .5
            pts = circle2(cx, cy2, cr, 12, a_open + gap / 2, a_open + TAU - gap / 2)
            pts.append((cx + math.cos(a_open) * cr * .25, cy2 + math.sin(a_open) * cr * .25))
            prism(pc, [pts], fr, Z1, z, PAINT, col)
            # legs: three bent strokes
            for k in range(3):
                y0 = -.03 - .028 * k
                leg = [(s * .05, y0 - .004 * k), (s * .118, y0 - .004 + .01 * (1 - k)), (s * .145, y0 - .042)]
                strip(pc, leg, .016, (fr[0] + ZA * (z - .0003), XA, YA, ZA), 0.0, PAINT, lambda p, i: col)
            # eye stalks with dot eyes
            strip(pc, [(s * .02, .0), (s * .028, .05)], .011, (fr[0] + ZA * (z - .0003), XA, YA, ZA), 0.0, PAINT, lambda p, i: col)
            prism(pc, [circle2(s * .029, .056, .015, 8)], fr, Z1, z, PAINT, C['paint_cream'])
            prism(pc, [circle2(s * .031, .056, .0075, 6)], fr, Z1, z + .0004, PAINT, C['eye'])
    crab_poly(Z1 + .0018, C['paint_crab'])   # a deeper brick red than the ring, so the crab reads through it
    pc.sec('ring')
    # ring and slash on top
    ring_o, ring_i = circle2(0, 0, DR - .02, 28), circle2(0, 0, DR - .062, 28)
    prism(pc, [ring_o, ring_i], fr, Z1, Z1 + .003, PAINT, C['paint_red'])
    a = math.radians(-45); dx, dy = math.cos(a), math.sin(a); w = .022; L2 = DR - .055
    slash = [(-dx * L2 - dy * w, -dy * L2 + dx * w), (dx * L2 - dy * w, dy * L2 + dx * w), (dx * L2 + dy * w, dy * L2 - dx * w), (-dx * L2 + dy * w, -dy * L2 - dx * w)]
    prism(pc, [slash], fr, Z1, Z1 + .0034, PAINT, C['paint_red'])
    pc.sec('iron')
    # iron strap holding the disc to the post, and nails
    box(pc, V(0, 1.215, -.03), (XA, YA, ZA), (.03, .1, .012), mat=IRON, col=C['iron'], ch=.003)
    return pc

# ===================================================================== TallyBoard
def build_tally():
    pc = Piece('TallyBoard', floor=False, wall=True, reach=.25, ray_off=.0015)
    rng = np.random.default_rng(909)
    pc.sec('beam')
    # beam stub: a sawn-off post against the wall, end grain on top, a notch
    timber_beam(pc, (0, -.42, .08), (0, .3, .08), .22, .16, rng, up=(0, 0, 1), segs=3, taper=1.0, ch=.02, shade=C['timber_b'])
    pc.sec('plank')
    # plank: carved heart with B.F., nailed to the stub
    PW, PH, PT = .9, .3, .034
    outline = [(-PW / 2, -PH / 2 + .01), (-PW / 2 + .015, -PH / 2), (PW / 2 - .01, -PH / 2), (PW / 2, -PH / 2 + .02), (PW / 2, PH / 2 - .01),
               (PW / 2 - .03, PH / 2), (-PW / 2 + .06, PH / 2), (-PW / 2 + .03, PH / 2 - .025), (-PW / 2, PH / 2 - .03)]
    HX, HY = .3, -.005
    def heart(s_, n=28):
        pts = []
        for k in range(n):
            t = TAU * k / n
            x = 16 * math.sin(t) ** 3; y = 13 * math.cos(t) - 5 * math.cos(2 * t) - 2 * math.cos(3 * t) - math.cos(4 * t)
            pts.append((HX + x * s_ / 16, HY + y * s_ / 16 + s_ * .1))
        return pts
    cuts = [shape_cut([heart(.118), heart(.096)]), glyph_cut('B.F.', .072, (HX, HY + .014), spacing=1.05)]
    Mb = RZ(.025); ob = V(0, 0, .16 + PT / 2)
    place = lambda p: Mb @ Vector(p) + ob
    front = PT / 2
    tone = lambda p: mix(C['timber_c'], C['sign'], .3 + .3 * vnoise(p.x * 6, p.y * 20, 0, 4))
    gr = lambda p: (p.x / .55, p.y / .55)
    carved_board(pc, outline, cuts, PT, .007, place, {
        'front': (TIMBER, tone, True, gr), 'floor': (TIMBER, mix(C['end'], C['sign'], .25), True, gr),
        'wall': (TIMBER, C['carve'], False, gr), 'back': (TIMBER, C['timber_b'], True, gr),
        'edge': (TIMBER, C['end'], False, lambda p: (p.x / .55 + p.y / .55, p.z / .55))})
    for y in (.07, -.07):
        rivet(pc, place(V(0, y, front)), Mb @ ZA, .011, IRON, C['iron'])
    rivet(pc, place(V(-PW / 2 + .03, .1, front)), Mb @ ZA, .009, IRON, C['iron_dark'])
    pc.sec('chalk')
    # chalk: a crab doodle and the tally (four strokes and a gate, five times, plus three)
    fz = front + .0008
    FR = (ob, Mb @ XA, Mb @ YA, Mb @ ZA)
    chalk = lambda p, i: mix(C['chalk'], C['chalk_dim'], .5 * vnoise(p.x * 80, p.y * 80, 0, 2))
    def dood(pts, w=.007, seed=0): strip(pc, pts, w, FR, fz, PAINT, chalk, seed=seed, wob=.3)
    cx0, cy0 = -.34, .02
    body = [(cx0 + math.cos(a) * .05, cy0 + math.sin(a) * .032) for a in np.linspace(0, TAU, 15)]
    dood(body, .0075, 1)
    for s in (-1, 1):
        dood([(cx0 + s * .04, cy0 + .02), (cx0 + s * .07, cy0 + .06)], seed=2)
        cl = [(cx0 + s * (.07 + .025 * math.cos(a)), cy0 + .075 + .025 * math.sin(a)) for a in np.linspace(-1.0 if s > 0 else 4.15, 4.6 if s > 0 else -.3, 10)]
        if s < 0: cl = [(cx0 - (x - cx0) * 1, y) for x, y in [(cx0 + (.07 + .025 * math.cos(a)), cy0 + .075 + .025 * math.sin(a)) for a in np.linspace(-1.0, 4.6, 10)]]
        dood(cl, .0065, 3)
        for k in range(3):
            y = cy0 - .005 - .014 * k
            dood([(cx0 + s * .045, y), (cx0 + s * .075, y - .008), (cx0 + s * .088, y - .03)], .006, 4 + k)
        dood([(cx0 + s * .015, cy0 + .03), (cx0 + s * .018, cy0 + .05)], .005, 9)
        dood([(cx0 + s * .018 - .006, cy0 + .056), (cx0 + s * .018 + .006, cy0 + .056)], .009, 10)
    dood([(cx0 - .02, cy0 - .005), (cx0, cy0 - .013), (cx0 + .02, cy0 - .005)], .005, 11)   # smile
    x = -.225
    for g in range(3):          # three gates of five
        for k in range(4):
            xx = x + k * .022 + .002 * (vnoise(g, k, 0, 3) - .5)
            dood([(xx, -.06 + .004 * (k % 2)), (xx + .004, .07 - .004 * (k % 3))], .0072, g * 7 + k)
        dood([(x - .015, -.04), (x + .082, .05)], .0072, g * 7 + 5)
        x += .105
    for k in range(2):          # and two more: the count goes on
        xx = x + k * .022
        dood([(xx, -.058), (xx + .003, .068)], .0072, 40 + k)
    # a chalk stub hung on a string from a nail at the right end
    nail = place(V(PW / 2 - .035, PH / 2 - .04, front))
    rivet(pc, nail, Mb @ ZA, .008, IRON, C['iron'])
    s0 = nail + ZA * .006
    string = [s0, s0 + V(.006, -.05, .006), s0 + V(.008, -.11, .01), s0 + V(.006, -.15, .012)]
    tube(pc, spline(string, 2), .0022, 4, PAINT, C['rope'], caps=(False, False))
    end = s0 + V(.006, -.15, .012)
    tube(pc, [end + V(0, .004, 0), end + V(0, -.05, .002)], .0075, 6, PAINT, C['chalk'], caps=(True, True))
    pc.sec('centre')
    # centre the piece so the origin is the back centre of its bounding box (x, y); z = 0 is the wall
    xs = [p.x for p in pc.P]; ys = [p.y for p in pc.P]
    pc.xform((0, 0), Matrix.Identity(3), V(-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, 0))
    return pc

# ===================================================================== ToolRack (pick-and-shovel wall rack)
def lantern_small(pc, top, s):
    """A small hanging brass lamp (the kit lantern's shape), ring top at `top`, scaled by s."""
    m0 = pc.mark()
    R, r = .03, .0075
    torus(pc, (0, -R - r, 0), ZA, R, r, 10, 4, BRASS, C['brass'], ref=XA)
    def bc(dark=(), light=()):
        return lambda i, j, p: C['brass_dark'] if i in dark else (C['brass_light'] if i in light else C['brass'])
    lathe(pc, (0, 0, 0), YA, [(0, -.06), (.03, -.07), (.032, -.092), (.032, -.11), (.05, -.114), (.085, -.135), (.102, -.158), (.104, -.17), (.088, -.176)],
          12, BRASS, bc((2, 3), (6,)))
    lathe(pc, (0, 0, 0), YA, [(.07, -.17), (.088, -.195), (.096, -.24), (.091, -.285), (.074, -.315), (.064, -.325)], 10, GLOW, lambda i, j, p: C['glow'], ao=0.0)
    for k in range(4):
        th = TAU * k / 4 + math.pi / 4; e = V(math.cos(th), 0, math.sin(th))
        pts = [e * .09 + YA * -.165, e * .1 + YA * -.2, e * .108 + YA * -.24, e * .102 + YA * -.285, e * .085 + YA * -.322]
        tube(pc, pts, .0055, 4, BRASS, C['brass'], caps=(False, False), up=YA)
    torus(pc, (0, -.24, 0), YA, .108, .0065, 12, 4, BRASS, C['brass_light'], ref=XA)
    lathe(pc, (0, 0, 0), YA, [(.062, -.318), (.09, -.324), (.102, -.338), (.104, -.37), (.094, -.39), (.06, -.404), (0, -.407)], 10, BRASS, bc((1,), (3,)))
    pc.xform(m0, Matrix.Diagonal((s, s, s)), Vector(top))

def pick(pc, eye, handle_end, rng, flip=1, yaw=0.0):
    """Miner's pick: curved iron head through an eye, ash handle with a swelled end."""
    eye = Vector(eye); hd = (Vector(handle_end) - eye).normalized()
    side = RY(yaw) @ XA * flip
    upv = -hd
    pts, rads = [], []
    for k in range(11):
        t = (k - 5) / 5                                    # -1 .. 1 along the head
        p = eye + side * (t * .24) + upv * (-.07 * t * t + .012)
        pts.append(p)
        rads.append(.026 * (1 - abs(t) ** 1.6 * .82) + .002)
    def hcol(i, j, p, r):
        c = mix(C['iron_dark'], C['iron'], .5 + .5 * max(0, r.dot(upv)))
        return mix(c, C['rivet'], .7) if i in (0, 10) else c
    tube(pc, pts, rads, 6, IRON, col_fn=hcol, ell=(1.0, .78), up=upv, caps=(True, True))
    pc.sec('the')
    # the chisel end flattened: an extra blade
    lathe(pc, eye, upv, [(.032, .03), (.036, .02), (.036, -.02), (.032, -.03)], 8, IRON, lambda i, j, p: C['iron'], ref=side)
    L = (Vector(handle_end) - eye).length
    timber_beam(pc, eye + upv * .045, handle_end, .036, .03, rng, up=side.cross(hd), segs=3, taper=1.32, ch=.01, shade=C['timber_c'])
    lathe(pc, Vector(handle_end), hd, [(0, .022), (.02, .014), (.026, .0), (.024, -.022)], 8, TIMBER, lambda i, j, p: C['timber_c'])

def build_pickaxes():
    pc = Piece('ToolRack', floor=False, wall=True, reach=.3, ray_off=.002)
    rng = np.random.default_rng(1010)
    RY0 = 1.05
    for x in (-.55, .55):   # wall cleats
        timber_beam(pc, (x, .86, .025), (x, 1.24, .025), .09, .05, rng, up=(0, 0, 1), segs=2, taper=1.0, ch=.01, shade=C['timber_b'])
        rivet(pc, V(x, 1.18, .051), ZA, .013); rivet(pc, V(x, .92, .051), ZA, .013)
    timber_beam(pc, (-.7, RY0, .08), (.7, RY0, .08), .1, .06, rng, up=(0, 0, 1), segs=4, taper=1.0, ch=.012, shade=C['timber_a'])
    for x in (-.55, .55):
        box(pc, V(x, RY0, .1105), (XA, YA, ZA), (.03, .055, .0045), mat=IRON, col=C['iron'], ch=.003)
        rivet(pc, V(x, RY0 + .03, .116), ZA, .009); rivet(pc, V(x, RY0 - .03, .116), ZA, .009)
    def peg(x, y=RY0 + .018, L=.11):
        a = V(x, y, .11); b = a + V(0, .03, L)
        beam(pc, a, b, .022, .022, up=(0, 1, 0), mat=TIMBER, col=C['timber_c'], ch=.006, segs=1, cap_col=C['end'], tile=.4, seed=int(x * 100))
        return b
    pc.sec('two')
    # two picks hung by their heads on paired pegs
    for x0, flip, yaw, lean in ((-.47, 1, .0, .02), (.0, -1, .12, -.025)):
        for dx in (-.035, .035): peg(x0 + dx)
        eye = V(x0, RY0 + .07, .175)
        pick(pc, eye, eye + V(lean, -.86, .03), rng, flip=flip, yaw=yaw)
    pc.sec('shovel')
    # shovel hung by its D-grip
    SX = .31
    pg = peg(SX, RY0 + .0, .12)
    gt = V(SX, RY0 + .07, .2)
    tube(pc, [gt + V(-.055, 0, 0), gt + V(.055, 0, 0)], .013, 6, TIMBER, C['timber_c'], tile=.4, up=YA)
    for s in (-1, 1):
        tube(pc, spline([gt + V(s * .055, 0, 0), gt + V(s * .05, -.06, 0), gt + V(s * .018, -.12, 0), gt + V(0, -.15, 0)], 3), .011, 6, TIMBER,
             C['timber_c'], tile=.4, up=ZA, caps=(False, False))
    sh_top, sh_bot = gt + V(0, -.15, 0), V(SX + .01, .37, .19)
    timber_beam(pc, sh_top, sh_bot, .034, .034, rng, up=(0, 0, 1), segs=4, taper=1.05, ch=.01, shade=C['timber_c'])
    pc.sec('socket')
    # socket and blade (round point, dished)
    lathe(pc, sh_bot, (sh_bot - sh_top).normalized(), [(.04, .1), (.03, .07), (.021, .0), (.019, -.02)], 8, IRON, lambda i, j, p: C['iron'], ref=XA)
    rivet(pc, sh_bot + V(0, -.03, .022), ZA, .007, IRON, C['rivet'])
    bl = []
    for k in range(13):
        a = math.pi * k / 12
        x = math.cos(a) * .13; y = -.07 - math.sin(a) ** 1.6 * .27 - .06 * math.sin(a) ** 8
        bl.append((x, y))
    bl = [(.125, -.06), (.06, -.055), (-.06, -.055), (-.125, -.06)] + bl[::-1][1:-1][::-1]
    blade_o = sh_bot + V(0, -.04, -.006)
    def bcol(x, y): return mix(C['iron'], C['tin_light'], smoothstep(-.24, -.33, y) * .7)
    m0 = pc.mark()
    prism(pc, [bl], (blade_o, XA, YA, ZA), -.004, .004, IRON, bcol, col_side=C['tin_light'], col_back=C['iron_dark'])
    for i in range(m0[0], len(pc.P)):
        p = pc.P[i]; dx = p.x - blade_o.x; pc.P[i] = p + V(0, 0, 1.6 * dx * dx)
    pc.sec('coiled')
    # coiled rope on a peg
    RX0 = .53
    pg = peg(RX0, RY0 + .0, .13)
    for k in range(3):
        ctr = V(RX0 + (k - 1) * .012, RY0 - .1, .2 + .012 * k)
        loop = []
        for t in range(18):
            a = TAU * t / 18
            loop.append(ctr + V(math.sin(a) * (.085 - .01 * k), .14 * math.cos(a) * (1 + .12 * k) - .02 * k, .01 * math.sin(a * 2)))
        loop = [RZ((k - 1) * .12) @ (p - ctr) + ctr for p in loop]
        def rcol(i, j, p, r, k=k):
            return C['rope_dark'] if ((j + i) % 5) < 2 else C['rope']
        tube(pc, loop, .0115, 5, PAINT, col_fn=rcol, closed=True)
    wrap_y = RY0 - .02
    torus(pc, V(RX0, wrap_y, .21), YA, .04, .012, 10, 5, PAINT, C['rope_dark'], ref=XA)
    tail = [V(RX0 + .02, wrap_y - .01, .24), V(RX0 + .04, wrap_y - .12, .25), V(RX0 + .03, wrap_y - .28, .24)]
    tube(pc, spline(tail, 3), .0105, 6, PAINT, col_fn=lambda i, j, p, r: C['rope_dark'] if (j + i) % 6 < 2 else C['rope'], caps=(False, True))
    pc.sec('lamp')
    # lamp on an iron hook at the right end
    LX = .655
    beam(pc, V(LX, RY0 + .0, .11), V(LX, RY0 + .0, .23), .014, .014, up=(0, 1, 0), mat=IRON, col=C['iron'], ch=.003)
    torus(pc, V(LX, RY0 - .022, .23), XA, .022, .0065, 8, 4, IRON, C['iron'], a0=math.pi / 2, a1=-math.pi * .9, ref=YA)
    lantern_small(pc, V(LX, RY0 - .038, .23), .62)
    pc.sec('origin')
    # origin: back-bottom-centre
    xs = [p.x for p in pc.P]; ys = [p.y for p in pc.P]
    pc.xform((0, 0), Matrix.Identity(3), V(-(min(xs) + max(xs)) / 2, -min(ys), 0))
    return pc

# ===================================================================== finalize: explode flat faces, bake AO (kit)
DIRS = []
for i in range(32):
    u1, u2 = (i + .5) / 32, (i * .618033988749) % 1
    rr, phi = math.sqrt(u1), TAU * u2; DIRS.append(Vector((rr * math.cos(phi), rr * math.sin(phi), math.sqrt(1 - u1))))

def finalize(pc):
    P, Cc, M, A = [], [], [], []
    remap = {}
    F2 = []
    vmat = []
    for fi, f in enumerate(pc.F):
        ids = []
        for i in f:
            if pc.FS[fi]:
                if (i, pc.FM[fi]) not in remap:
                    remap[(i, pc.FM[fi])] = len(P); P.append(pc.P[i]); Cc.append(pc.C[i]); M.append(pc.M[i]); A.append(pc.AO[i]); vmat.append(pc.FM[fi])
                ids.append(remap[(i, pc.FM[fi])])
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
    if pc.wall:
        b = len(verts); verts += [(-30, -30, -.001), (30, -30, -.001), (30, 30, -.001), (-30, 30, -.001)]; polys.append((b, b + 1, b + 2, b + 3))
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
for name, rough, metal in (('Timber', .78, 0), ('Iron', .48, .75), ('Brass', .3, .92), ('SaltRock', .82, 0), ('SaltCrystal', .26, 0),
                           ('LanternGlow', .4, 0), ('Painted', .62, 0), ('Feather', .78, 0)):
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

BUILDERS = [('CanaryCage', build_cage), ('Canary', build_canary), ('CanaryKeeled', build_canary_keeled), ('LunchPail', build_lunch),
            ('Saltman', build_saltman), ('SaltShaker', build_shaker), ('CrabCrown', build_crab_crown), ('SignCrabs', build_sign),
            ('TallyBoard', build_tally), ('ToolRack', build_pickaxes)]
BUDGET = {'CanaryCage': 2500, 'Canary': 800, 'CanaryKeeled': 800, 'SaltShaker': 8000, 'Saltman': 4000, 'LunchPail': 3000,
          'CrabCrown': 3000, 'SignCrabs': 3000, 'TallyBoard': 3000, 'ToolRack': 3000}

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
            l0.extend(pc.FUV[fi][k]); l1.extend((pc.M[vi] if pc.FM[fi] in (ROCK, CRYSTAL) else 0.0, 0.0))
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
    if '--sections' in ARGS and getattr(pc, 'secs', None):
        prev = 0
        for lab, n in pc.secs + [('end', tris)]: print(f'    {lab:>12}: {n - prev}', flush=True); prev = n

# ===================================================================== export + repack (kit)
def quantize_glb(path):
    raw = open(path, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl]); bin0 = raw[20 + jl + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    def read(ai):
        a = doc['accessors'][ai]; bv = doc['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
        assert bv.get('byteStride', n * np.dtype(dt).itemsize) == n * np.dtype(dt).itemsize, 'interleaved view'
        return np.frombuffer(bin0, dt, a['count'] * n, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n).copy()
    # drop attributes nothing reads: TEXCOORD_0/1 off everything but Timber (grain) and the salt (glow mask; it keeps a
    # constant TEXCOORD_0 so its texcoord sets stay contiguous as glTF requires)
    dropped = set()
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']; mname = doc['materials'][prim['material']]['name']
            if mname not in ('Timber', 'SaltRock', 'SaltCrystal') and 'TEXCOORD_0' in at: dropped.add(at.pop('TEXCOORD_0'))
            if mname not in ('SaltRock', 'SaltCrystal') and 'TEXCOORD_1' in at: dropped.add(at.pop('TEXCOORD_1'))
    keep = [i for i in range(len(doc['accessors'])) if i not in dropped]; amap = {o: n for n, o in enumerate(keep)}
    doc['accessors'] = [doc['accessors'][i] for i in keep]
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            prim['attributes'] = {k: amap[v] for k, v in prim['attributes'].items()}; prim['indices'] = amap[prim['indices']]
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
        if kind and a.get('normalized'):
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
    blob_ = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    open(path, 'wb').write(blob_)

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
            elif 'TEXCOORD_1' in pr['attributes']:
                assert read(pr['attributes']['TEXCOORD_1'])[:, 0].max() < 1e-4, (nd['name'], mn, 'glow mask on a non-salt material')
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
REPORT = {'file': os.path.basename(OUT), 'bytes': os.path.getsize(OUT), 'triangles': total_tris,
          'materials': [m['name'] for m in DOC['materials']],
          'images': [(im.get('mimeType'), im.get('name')) for im in DOC.get('images', [])],
          'pieces': INFO, 'anchors': {n: p.anchors for n, p in PCS.items() if p.anchors},
          'glow_mask': 'TEXCOORD_1.x (0..1) on SaltCrystal and SaltRock; 0 elsewhere'}
for k, lim in BUDGET.items():
    if k in INFO: assert INFO[k]['triangles'] <= lim, (k, INFO[k]['triangles'], lim)
assert REPORT['bytes'] <= 950_000, REPORT['bytes']
missing = set(MAT_NAMES) - set(REPORT['materials'])
if not wanted: assert not missing, missing
REPORT['seconds'] = round(time.time() - T0, 1)
if arg('--report'):
    with open(arg('--report'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps({k: (v['triangles'], v['vertices'], v['bbox_min'], v['bbox_max']) for k, v in INFO.items()}), flush=True)
print('anchors', json.dumps(REPORT['anchors']), 'bytes', REPORT['bytes'], 'tris', total_tris, flush=True)

# ===================================================================== review renders (after export: preview-only)
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
            val = nt.nodes.new('ShaderNodeValue'); val.outputs[0].default_value = 6.0; GLOW_VALUES[m.name] = val
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
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 64)); SC.cycles.device = 'CPU'
    try: SC.cycles.use_denoising = True
    except Exception: pass
    SC.render.resolution_x, SC.render.resolution_y = int(arg('--w', 1000)), int(arg('--h', 760))
    SC.view_settings.view_transform = 'AgX'
    try: SC.view_settings.look = 'AgX - Medium High Contrast'
    except Exception: pass
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (.035, .022, .02, 1); bg.inputs['Strength'].default_value = .5
    # a warm, dim cave nook: rough salt-rock floor and back wall (procedural, preview only)
    def cave_mat():
        m = bpy.data.materials.new('cave'); nt, b = principled(m)
        nz = nt.nodes.new('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 3.0; nz.inputs['Detail'].default_value = 8
        ramp = nt.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color = (.16, .085, .07, 1); ramp.color_ramp.elements[1].color = (.36, .22, .19, 1)
        nt.links.new(nz.outputs['Fac'], ramp.inputs['Fac']); nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
        bump = nt.nodes.new('ShaderNodeBump'); bump.inputs['Strength'].default_value = .35
        nt.links.new(nz.outputs['Fac'], bump.inputs['Height']); nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
        b.inputs['Roughness'].default_value = .9
        return m
    CAVE = cave_mat()
    def plane(name, pts):
        me = bpy.data.meshes.new(name); me.from_pydata([tuple(to_b(p)) for p in pts], [], [(0, 1, 2, 3)]); me.materials.append(CAVE)
        o = bpy.data.objects.new(name, me); SC.collection.objects.link(o); return o
    floor = plane('floor', [(-20, 0, 20), (20, 0, 20), (20, 0, -20), (-20, 0, -20)])
    wall = plane('wall', [(-20, -1, 0), (20, -1, 0), (20, 20, 0), (-20, 20, 0)])
    def lamp(name, kind, colr, size=1.0):
        l = bpy.data.lights.new(name, kind); l.color = colr
        if kind == 'AREA': l.size = size
        else: l.shadow_soft_size = size
        o = bpy.data.objects.new(name, l); SC.collection.objects.link(o); return o
    key = lamp('key', 'AREA', (1.0, .7, .45)); fill = lamp('fill', 'AREA', (.6, .68, 1.0)); rim = lamp('rim', 'AREA', (1.0, .62, .5))
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    def aim(o, eye, at):
        o.location = to_b(eye); o.rotation_euler = (to_b(at) - to_b(eye)).to_track_quat('-Z', 'Y').to_euler()
    def lights(c, d, k=1.0):
        c = Vector(c)
        for o, off, e in ((key, (1.3, 1.5, 1.6), 230), (fill, (-2.0, .7, 1.2), 30), (rim, (-.9, 1.6, -1.5), 110)):
            pos = c + Vector(off).normalized() * d * 4.0
            aim(o, pos, c); o.data.energy = e * (d * 4.0) ** 2 / 20 * k; o.data.size = d * 1.4
    def shot(name, at, radius, view=(1.0, .55, 1.6), lens=50, wall_z=None, k=1.0):
        wall.location = to_b((0, 0, wall_z if wall_z is not None else -40))
        lights(at, max(radius, .12), k)
        cam.lens = lens
        fov = 2 * math.atan(18 / lens) * (SC.render.resolution_y / SC.render.resolution_x)
        dist = radius / math.sin(fov / 2) * .92
        eye = Vector(at) + Vector(view).normalized() * dist
        aim(co, eye, Vector(at)); cam.clip_start = .005; cam.clip_end = 500
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
        print('rendered', name, flush=True)
    GLOW_VALUES.get('SaltCrystal') and setattr(GLOW_VALUES['SaltCrystal'].outputs[0], 'default_value', 1.6)
    GLOW_VALUES.get('SaltRock') and setattr(GLOW_VALUES['SaltRock'].outputs[0], 'default_value', .6)
    only = arg('--only'); want = lambda n: not only or n in only.split(',')
    copies = []
    def place(name, pos, yaw=0.0):
        o = bpy.data.objects.new(name + '_view', OBJS[name].data); SC.collection.objects.link(o)
        o.location = to_b(pos); o.rotation_euler = (0, 0, yaw); copies.append(o); return o
    def clear():
        for o in copies: bpy.data.objects.remove(o)
        copies.clear()
    def show(names):
        for n, o in OBJS.items(): o.hide_render = n not in names
    def bounds(name, off=(0, 0, 0)):
        i = INFO[name]; lo, hi = Vector(i['bbox_min']), Vector(i['bbox_max'])
        return (lo + hi) / 2 + Vector(off), (hi - lo).length / 2
    hang = {'CanaryCage': (0, 1.35, 0)}
    VIEWS = {'LunchPail': (.9, 1.0, 1.6), 'Canary': (1.3, .45, 1.0), 'CrabCrown': (.8, .9, 1.6), 'CanaryKeeled': (.5, .8, 1.6)}
    wallp = {'TallyBoard': (0, 1.2, 0), 'ToolRack': (0, .25, 0)}
    flame = []
    def add_flame(pos, e=1.2):
        pl = bpy.data.lights.new('flame', 'POINT'); pl.energy = e; pl.color = (1.0, .6, .3); pl.shadow_soft_size = .01
        o = bpy.data.objects.new('flame', pl); SC.collection.objects.link(o); o.location = to_b(pos); flame.append(o); return o
    for name in OBJS:
        if not want(name): continue
        show([name]); off = hang.get(name) or wallp.get(name) or (0, 0, 0)
        OBJS[name].location = to_b(off)
        c, r = bounds(name, off)
        fl = []
        if name == 'Saltman': fl.append(add_flame((-.02, 1.27, .17), 1.5))
        if name == 'ToolRack': fl.append(add_flame((.66, .25 + .82, .23), 3.0))
        vw = VIEWS.get(name, (.55, .4, 1.6) if name in wallp else (1.0, .55, 1.6))
        if arg('--view'): vw = tuple(float(x) for x in arg('--view').split(','))
        shot(name, c, r, wall_z=0 if name in wallp else None, view=vw)
        if name == 'SignCrabs': shot('SignCrabs-front-3m', (0, 1.05, 0), .9, view=(0, .05, 1), lens=35)
        for o in fl: bpy.data.objects.remove(o)
        flame.clear()
        OBJS[name].location = (0, 0, 0)
    show([])
    if 'CanaryCage' in OBJS and 'Canary' in OBJS and want('cage-canary'):
        top = Vector((0, 1.35, 0))
        place('CanaryCage', top); a = PCS['CanaryCage'].anchors
        place('Canary', top + Vector(a['perch']))
        shot('cage-canary', top + Vector((0, -.29, 0)), .33, view=(.5, .25, 1.6))
        clear()
    if 'CanaryCage' in OBJS and 'CanaryKeeled' in OBJS and want('cage-keeled'):
        top = Vector((0, 1.35, 0))
        place('CanaryCage', top); a = PCS['CanaryCage'].anchors
        place('CanaryKeeled', top + Vector(a['floor']))
        shot('cage-keeled', top + Vector((0, -.4, 0)), .3, view=(.4, .6, 1.6))
        clear()
    if len(OBJS) == len(BUILDERS) and want('group'):
        place('ToolRack', (1.25, .22, -1.4)); place('TallyBoard', (-1.45, 1.2, -1.4))
        place('SaltShaker', (-.1, 0, -.75)); place('Saltman', (-1.35, 0, -.25), .35); place('SignCrabs', (1.55, 0, .05), -.5)
        place('LunchPail', (.75, 0, .55), -.3); place('CrabCrown', (.25, 0, .85), .4)
        top = Vector((-.6, 2.0, .45)); place('CanaryCage', top); place('Canary', top + Vector(PCS['CanaryCage'].anchors['perch']))
        # a timber beam above to hang the cage from (preview prop)
        bmesh_ = bmesh.new(); bmesh.ops.create_cube(bmesh_, size=1.0); bme = bpy.data.meshes.new('beam'); bmesh_.to_mesh(bme); bmesh_.free()
        bme.materials.append(CAVE); bo = bpy.data.objects.new('beam', bme); SC.collection.objects.link(bo); copies.append(bo)
        bo.location = to_b((-.6, 2.0 + .07, .45)); bo.scale = (3.2, .14, .14)
        add_flame((-1.35 - .02, 1.27, -.25 + .17), 1.5); add_flame((1.25 + .66, .22 + .82, -1.4 + .23), 3.0)
        wall.location = to_b((0, 0, -1.4))
        lights((0, 1.0, 0), 2.2, .8)
        cam.lens = 27
        eye = Vector((.45, 1.45, 3.6)); aim(co, eye, Vector((-.05, .9, -.45)))
        SC.render.filepath = os.path.join(RENDER, 'group.png'); bpy.ops.render.render(write_still=True)
        print('rendered group', flush=True)
        clear()

if RENDER: render_all()
print('SALT_MINE_CURIOS_OK')
