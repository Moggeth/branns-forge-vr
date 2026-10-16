"""Brinedeep salt-mine prop kit - reproducible Blender (bpy 4.5) builder.

Run:  python3.11 build_salt_mine_kit.py -- --out ../../public/assets/salt-mine-kit.glb
      python3.11 build_salt_mine_kit.py -- --out out/salt-mine-kit.glb --render out/review   (Cycles review images)
      (pip install bpy==4.5.* numpy pillow)
Options: --pieces A,B (build a subset, for iteration only), --only name,name (render subset), --samples N.
Prints SALT_MINE_KIT_OK as its last line on success. Blender can exit 0 after a Python traceback, so check for it.

The Brinedeep: an old, cheerful salt mine dug into a mountain. Pink and white rock salt (halite) that glows warm from
inside like a salt lamp; chunky dark oiled timber, iron straps and rivets, brass fittings, warm lantern light.

Everything is authored in the game frame (X right, Y up, Z toward the viewer / front, metres) and converted to
Blender's Z-up on the way in, so the numbers here are the runtime's numbers. Nineteen top-level static meshes (ten mine
pieces and nine for the Carvers' Chapel, whose statues and formations are SDF-sculpted), one per piece, each at its own
origin. Six shared materials: Timber, Iron, Brass, SaltRock, SaltCrystal, LanternGlow.
COLOR_0   authored per-corner colour with baked ambient occlusion multiplied in (linear).
TEXCOORD_0 Timber: wood-grain tile coordinates (u along the grain); other primitives: aliases TEXCOORD_1.
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
    sign_dark='4f3220', iron='5c616c', iron_dark='42464f', rivet='8a909b', brass='cc9c46', brass_dark='8c682c',
    iron_rust='74503d', rail_top='d2d5da', rail_side='6a6c72', cr_clear='fde6e2', cr_coral='f2a490', cr_blush='f9d5d2',
    salt_carve='f3d3cc', salt_carve2='ecc0b8', salt_cream='fbeee6', salt_rose='d98a8e', salt_shadow='b77476',
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
        self.FCM, self.FMK = [], []          # optional per-corner colour multipliers / glow-mask overrides
        self.anchors = {}
    def v(self, p, c, mask=0.0, ao=1.0):
        self.P.append(Vector(p)); self.C.append(tuple(c)); self.M.append(float(mask)); self.AO.append(ao)
        return len(self.P) - 1
    def f(self, idx, mat, smooth=True, uvs=None, out=None, cm=None, mk=None):
        """Add a face. cm: per-corner colour multiplier (float or 3-tuple, or one value for the whole face) so a
        smooth-shaded face can carry its own tone (worn chamfers, polished rail tops) without splitting normals;
        mk: per-corner glow mask override (or one value)."""
        idx = list(idx); n0 = len(idx)
        if uvs is None: uvs = [(.5, .5)] * n0
        uvs = list(uvs)
        def per(x):
            if x is None: return None
            if isinstance(x, (list,)) and len(x) == n0: return list(x)
            return [x] * n0
        cm, mk = per(cm), per(mk)
        # drop repeated corners (lathe poles)
        k = 0
        while k < len(idx) and len(idx) > 3:
            if idx[k] == idx[(k + 1) % len(idx)]:
                del idx[k]; del uvs[k]
                if cm: del cm[k]
                if mk: del mk[k]
            else: k += 1
        if len(set(idx)) < 3: return
        if out is not None:
            n = newell([self.P[i] for i in idx])
            if n.dot(Vector(out)) < 0:
                idx = idx[::-1]; uvs = uvs[::-1]
                if cm: cm = cm[::-1]
                if mk: mk = mk[::-1]
        self.F.append(idx); self.FM.append(mat); self.FS.append(smooth); self.FUV.append(uvs)
        self.FCM.append(cm); self.FMK.append(mk)
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
         tile=1.1, jit=0.0, seed=0, flat=False, caps=(True, True), colvar=0.0, ao=1.0, uv_off=0.0, bow=None, wear=0.0,
         ring_caps=None):
    """A swept rectangular (ch=0) or chamfered-octagon section from a to b. w along s = up x t, h along u."""
    a, b = Vector(a), Vector(b); L = (b - a).length
    t, s, u = frame_from(b - a, up)
    col = col or C['timber_a']
    if ring_caps is None: ring_caps = mat == TIMBER and min(w, h) > .06
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
    wood = mat == TIMBER
    for k in range(segs):
        for j in range(n):
            j2 = (j + 1) % n
            idx = [rings[k][1][j], rings[k][1][j2], rings[k + 1][1][j2], rings[k + 1][1][j]]
            v0, v1 = per[j] / tile, per[j + 1] / tile
            u0, u1 = L * k / segs / tile + uv_off, L * (k + 1) / segs / tile + uv_off
            cen = sum((pc.P[i] for i in idx), Vector()) / 4
            ax = a + t * (cen - a).dot(t)
            cm = None
            if wear and ch > 0 and j % 2 == 0:
                # worn chamfer: lighter, bare wood where hands and carts rubbed, patchy along the length
                cm = [1.0 + wear * (.55 + .9 * fbm((pc.P[i].x * 3.3, pc.P[i].y * 3.3, pc.P[i].z * 3.3), seed + 17, 2)) for i in idx]
            elif wear and ch > 0:
                # flat faces darken a touch toward the chamfers' shadowed grime at the very ends
                cm = [1.0 - .1 * smoothstep(.12, 0, min((pc.P[i] - a).dot(t), L - (pc.P[i] - a).dot(t))) for i in idx]
            pc.f(idx, mat, not flat, [(u0, v0), (u0, v1), (u1, v1), (u1, v0)], out=cen - ax, cm=cm)
    for k, sgn, want in ((0, -1, caps[0]), (segs, 1, caps[1])):
        if not want: continue
        c, row = rings[k]; cc = cap_col or col
        if wood and ring_caps:
            # end grain: concentric rings so the grain texture's stripes read as growth rings, dark pith at the heart
            rv = .62 + .3 * _hash(seed, k, 3, 77)
            off = _hash(seed, k, 4, 77) * .9
            cen_c = c + s * (hw * .18 * (_hash(seed, k, 5, 77) - .5)) + u * (hh * .18 * (_hash(seed, k, 6, 77) - .5))
            outer = [pc.v(pc.P[i], cc, mask, ao) for i in row]
            mid = [pc.v(cen_c + (pc.P[i] - cen_c) * .5, mul(cc, .93), mask, ao) for i in row]
            pole = pc.v(cen_c, mul(cc, .72), mask, ao)
            def cuv(p):
                d = p - cen_c; r = math.sqrt(d.dot(s) ** 2 + d.dot(u) ** 2) / max(hw, hh)
                th = math.atan2(d.dot(u), d.dot(s))
                return (.5 + .12 * math.cos(th) + off, r * rv + off)
            for j in range(n):
                j2 = (j + 1) % n
                q = [outer[j], outer[j2], mid[j2], mid[j]]
                pc.f(q, mat, True, [cuv(pc.P[i]) for i in q], out=t * sgn)
                q = [mid[j], mid[j2], pole]
                pc.f(q, mat, True, [cuv(pc.P[i]) for i in q], out=t * sgn)
            continue
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

def hull(pc, pts, mat, col_fn, mask=0.0, smooth=False, ao=1.0, grain=None, tile=1.1):
    """Convex hull of pts (flat-shaded facets by default). col_fn(p, n) -> colour; mask may be callable(p, n).
    grain: for Timber, the direction the wood grain runs (planar-projected UVs per facet, end grain on the facets
    that face along it). Without it a Timber hull uses its longest extent."""
    if mat == TIMBER and grain is None:
        P_ = [Vector(p) for p in pts]; best = (0, XA)
        for i in range(len(P_)):
            for j in range(i + 1, len(P_)):
                d = P_[j] - P_[i]
                if d.length > best[0]: best = (d.length, d.normalized())
        grain = best[1]
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
        uvs = None
        if grain is not None:
            g = Vector(grain).normalized()
            if abs(n.dot(g)) > .75:   # end grain: rings round the hull's centre line
                e1 = n.cross(XA if abs(n.x) < .9 else YA).normalized(); e2 = n.cross(e1)
                uvs = []
                for vi in ids:
                    d = pc.P[vi] - cen; uvs.append((.5 + .1 * d.dot(e1) / tile, math.hypot(d.dot(e1), d.dot(e2)) * 6.0 + .3))
            else:
                b = n.cross(g).normalized()
                uvs = [(pc.P[vi].dot(g) / tile, pc.P[vi].dot(b) / tile) for vi in ids]
        pc.f(ids, mat, smooth, uvs, out=fc - cen)
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

def crystal(pc, centre, R, half, col, mask=.5, ch=None, hopper=(), steps=3, inner=None, shade=.07, seed=0, mat=CRYSTAL, detail=2,
            milk=None):
    """Halite cube (or cuboid), flat shaded. detail 0: a plain box (12 tris); 1: chamfered edges and corners;
    2: chamfered, and each plain face is an inset frame round a faintly sunken centre, so a face reads milky at its
    rim and clear and glowing at its core like a salt lamp. Faces in `hopper` ((axis, sign) pairs, local) get the
    stepped, terraced recess of a hopper crystal. Glow mask: face cores ~mask*1.3, rims and bevels paler and lower,
    hopper risers and floors 1."""
    centre = Vector(centre); h = list(half)
    if ch is not None and ch <= 0: detail = 0
    c = (min(h) * .12 if ch is None else ch) if detail > 0 else 0.0
    inner = inner or C['cr_inner']
    milk = milk or C['cr_milk']
    rng = np.random.default_rng(seed)
    top = max(h) * 1.2
    def W(p): return centre + R @ Vector(p)
    def tint(colr, p, k=1.0):
        w = W(p); t = smoothstep(-1, 1, (w.y - centre.y) / top)
        return mul(colr, k * lerp(.84, 1.07, t))
    def face(pl, colr, m, out_local, k=1.0):
        ids = [pc.v(W(p), tint(colr, p, k), m, .9) for p in pl]
        pc.f(ids, mat, False, None, out=R @ Vector(out_local))
    def P3(i, j, k, a, b, cc):
        p = [0.0, 0.0, 0.0]; p[i] = a; p[j] = b; p[k] = cc; return tuple(p)
    core_m = min(1.0, mask * 1.3 + .06)
    rim_col = mix(col, milk, .42)
    for i in range(3):
        j, k = [x for x in range(3) if x != i]
        for sg in (-1, 1):
            nl = [0, 0, 0]; nl[i] = sg
            ej, ek = h[j] - c, h[k] - c
            fk = 1 + rng.uniform(-shade, shade)
            if (i, sg) not in hopper:
                O = [P3(i, j, k, sg * h[i], -ej, -ek), P3(i, j, k, sg * h[i], ej, -ek), P3(i, j, k, sg * h[i], ej, ek), P3(i, j, k, sg * h[i], -ej, ek)]
                if detail < 2 or min(ej, ek) < .05:
                    face(O, col, mask, nl, fk); continue
                wfr = min(ej, ek) * rng.uniform(.24, .34)
                dish = min(h) * .035
                I = [P3(i, j, k, sg * (h[i] - dish), -(ej - wfr), -(ek - wfr)), P3(i, j, k, sg * (h[i] - dish), ej - wfr, -(ek - wfr)),
                     P3(i, j, k, sg * (h[i] - dish), ej - wfr, ek - wfr), P3(i, j, k, sg * (h[i] - dish), -(ej - wfr), ek - wfr)]
                for q in range(4):
                    q2 = (q + 1) % 4
                    ids = [pc.v(W(O[q]), tint(rim_col, O[q], fk * 1.04), mask * .62, .9), pc.v(W(O[q2]), tint(rim_col, O[q2], fk * 1.04), mask * .62, .9),
                           pc.v(W(I[q2]), tint(col, I[q2], fk), core_m * .9, .9), pc.v(W(I[q]), tint(col, I[q], fk), core_m * .9, .9)]
                    pc.f(ids, mat, False, None, out=R @ Vector(nl))
                face(I, col, core_m, nl, fk * .98)
                continue
            fr = [1.0, .74, .52, .32][:steps + 1]
            dd = [0.0, .055, .11, .155][:steps + 1]
            depth = [d * 2 * min(h) for d in dd]
            def Q(fu, fw, d): return P3(i, j, k, sg * (h[i] - d), fu * ej, fw * ek)
            for s in range(steps):
                f0, f1, d0, d1 = fr[s], fr[s + 1], depth[s], depth[s + 1]
                tt = s / steps
                ring_col = mix(col, inner, .2 + .55 * tt) if s else rim_col
                ring_m = lerp(mask, 1.0, .45 + .5 * tt) if s else mask * .7
                for (a, b) in (((1, 0), (0, 1)), ((-1, 0), (0, -1)), ((0, 1), (-1, 0)), ((0, -1), (1, 0))):
                    # side with outward 2D direction a, tangent b
                    def at(f, tval): return (a[0] * f + b[0] * f * tval, a[1] * f + b[1] * f * tval)
                    q0, q1 = at(f0, -1), at(f0, 1); q2, q3 = at(f1, 1), at(f1, -1)
                    face([Q(*q0, d0), Q(*q1, d0), Q(*q2, d0), Q(*q3, d0)], ring_col, ring_m, nl, fk * (1.05 if s == 0 else 1.0))
                    out2 = [0, 0, 0]; out2[j] = -a[0]; out2[k] = -a[1]
                    face([Q(*q3, d0), Q(*q2, d0), Q(*q2, d1), Q(*q3, d1)], mix(col, inner, .55 + .4 * tt), 1.0, out2, fk * .92)
            fl, dl = fr[steps], depth[steps]
            face([Q(-fl, -fl, dl), Q(fl, -fl, dl), Q(fl, fl, dl), Q(-fl, fl, dl)], inner, 1.0, nl, 1.04)
    if c > 0:
        edge_col = mix(col, milk, .58)
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
                        face(pl, edge_col, mask * .5, nl, 1.12)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    pl = [(sx * h[0], sy * (h[1] - c), sz * (h[2] - c)), (sx * (h[0] - c), sy * h[1], sz * (h[2] - c)),
                          (sx * (h[0] - c), sy * (h[1] - c), sz * h[2])]
                    face(pl, mix(col, milk, .65), mask * .45, (sx, sy, sz), 1.14)

def staircase(pc, base, R, s0, col, n=3, mask=.55, seed=0, shrink=.62, step=(.62, .55, .3), **kw):
    """Halite stair growth: cubes of falling size stepping off one another along an edge, same orientation."""
    p = Vector(base); s = s0; out = []
    for k in range(n):
        crystal(pc, p, R, (s, s, s), col, mask, seed=seed + k, detail=2 if s > .05 else 1, **kw); out.append((p.copy(), s))
        ns = s * shrink
        p = p + R @ Vector((step[0] * (s + ns), step[1] * (s + ns), step[2] * (s + ns)))
        s = ns
    return out

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
    kw.setdefault('wear', .32)
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
    # ---- rock-salt reveal: a U-shaped lining 1.5 m deep, cut in bedded salt (terraced strata, one colour per course)
    U = [(-2.06, -.06), (-2.08, 1.6), (-2.06, 3.2), (-1.96, 3.52), (-1.7, 3.72), (0, 3.78), (1.7, 3.72), (1.96, 3.52), (2.06, 3.2), (2.08, 1.6), (2.06, -.06)]
    seg = [math.hypot(U[i + 1][0] - U[i][0], U[i + 1][1] - U[i][1]) for i in range(len(U) - 1)]
    total = sum(seg); NP = 48
    prof = []
    for q in range(NP + 1):
        d = total * q / NP; i = 0
        while i < len(seg) - 1 and d > seg[i]: d -= seg[i]; i += 1
        f = d / seg[i]; prof.append((lerp(U[i][0], U[i + 1][0], f), lerp(U[i][1], U[i + 1][1], f)))
    nrm2 = []
    for q in range(NP + 1):
        a_, b_ = prof[max(0, q - 1)], prof[min(NP, q + 1)]
        dx, dy = b_[0] - a_[0], b_[1] - a_[1]; l = math.hypot(dx, dy); nrm2.append((-dy / l, dx / l))
    STRATA = [C['rock_pink'], C['salt_cream'], C['rock_rose'], C['crust_pink'], C['rock_orange'], C['rock_white'], C['rock_pink'], C['salt_carve2'],
              C['rock_rose'], C['salt_cream'], C['rock_pink'], C['cr_coral'], C['rock_white'], C['rock_pink']]
    BAND = .43
    def band_of(y): return int(math.floor((y + .06) / BAND))
    def band_col(k): return STRATA[k % len(STRATA)]
    def band_mask(k):
        c = band_col(k); return .18 + .45 * (sum(c) / 3)
    ZS = [-1.5, -1.2, -.9, -.6, -.35, -.18]
    grid = []
    for k, z in enumerate(ZS):
        row = []
        for q in range(NP + 1):
            x0, y0 = prof[q]; nx, ny = nrm2[q]
            bk = band_of(y0)
            dsp = (_hash(bk, 0, 0, 13) - .5) * .14 + (vnoise(q * .5, k * .7, 0, 5) - .5) * .05   # each course sits proud or shy
            p = Vector((x0 + nx * dsp, max(-.06, y0 + ny * dsp), z + (vnoise(q * .4, 0, k, 6) - .5) * .06 * (k > 0)))
            if q == 0 or q == NP: p.y = -.06
            row.append(p)
        grid.append(row)
    for k in range(len(ZS) - 1):
        for q in range(NP):
            quad = [grid[k][q], grid[k][q + 1], grid[k + 1][q + 1], grid[k + 1][q]]
            cen = sum(quad, Vector()) / 4; bk = band_of(cen.y)
            col = mul(band_col(bk), .93 + .1 * _hash(q, k, 1, 14))
            ids = [pc.v(p, mix(col, C['rock_white'], .25 * smoothstep(.6, .9, fbm((p.x * 3, p.y * 3, p.z * 3), 15, 2))), band_mask(bk)) for p in quad]
            nx, ny = nrm2[q]
            pc.f(ids, ROCK, False, None, out=Vector((-nx, -ny, 0)))
    # ---- the collar: courses of squared salt blocks following the strata, stepping back from the opening
    def outer_x(y): return math.sqrt(max(0.0, 4.25 ** 2 - (y - 1.1) ** 2))
    blocks = []
    y = -.06; k = 0
    while y < 5.05:
        h = BAND * (.7 + .9 * _hash(k, 2, 0, 16)) if k % 3 else BAND * .45
        y1 = y + h
        ox = min(outer_x(y), outer_x(y1)) + .6 * (_hash(k, 1, 0, 16) - .5)
        if y1 <= 3.55:   # beside the opening: a run of blocks on each side
            for sx in (-1, 1):
                x = 2.07; n = 0
                while x < ox - .25 and n < 3:
                    L = .8 + .9 * _hash(k, n, sx, 17)
                    if ox - x - L < .45: L = ox - x
                    blocks.append((sx, x, x + L, y, y1, k, n)); x += L; n += 1
        else:            # over the lintel: full courses
            x = -ox; n = 0
            while x < ox - .25:
                L = .9 + 1.0 * _hash(k, n, 3, 17)
                if ox - x - L < .5: L = ox - x
                blocks.append((1, x, x + L, y, y1, k, n)); x += L; n += 1
        y = y1; k += 1
    for sx, xa, xb, ya, yb, kb, n in blocks:
        if sx < 0: xa, xb = -xb, -xa
        dist = min(abs(xa), abs(xb)) - 2.07 if yb <= 3.55 else max(0.0, ya - 3.55) * .8
        zf = -.2 - .16 * _hash(kb, n, int(sx), 18) - .1 * max(0.0, dist) - (.12 if kb % 3 == 0 else 0)
        zb = -.95
        g = .012; ch = .045
        rr = np.random.default_rng(int(abs(xa * 100)) + kb * 131)
        pts = []
        outer_end = xb if sx > 0 else xa
        for x_ in (xa + g, xb - g):
            rough = abs(x_ - outer_end) < .05 or yb > 3.55 and abs(x_) > 1.5
            for y_ in (ya + g, yb - g):
                for z_, cz in ((zf, True), (zb, False)):
                    j = (lambda s=.025: rr.uniform(-s * 5, s * 5)) if rough else (lambda s=.025: rr.uniform(-s, s))
                    if cz:   # chamfer the front edges
                        pts += [Vector((x_ - math.copysign(ch, x_ - (xa + xb) / 2), y_ + j(), z_ + j(.015))),
                                Vector((x_ + j(), y_ - math.copysign(ch, y_ - (ya + yb) / 2), z_ + j(.015))),
                                Vector((x_ + j(), y_ + j(), z_ - ch))]
                    else: pts.append(Vector((x_, y_, z_)))
        base = mul(band_col(kb), .9 + .16 * rr.random())
        bm_ = band_mask(kb)
        def cf(p, nn, base=base):
            c = mix(base, C['rock_white'], .3 * smoothstep(.62, .85, fbm((p.x * 2.5, p.y * 2.5, p.z * 2.5), 19, 2)))
            return mul(c, 1.05 if nn.z > .7 else (.9 if nn.y < -.3 else .97))
        hull(pc, pts, ROCK, cf, mask=lambda p, nn, m=bm_: m * (1.15 if nn.z > .7 else .8))
    # boulders and fallen blocks at the feet
    for sx in (-1, 1):
        for (dx, s, zz) in ((.55, .42, .05), (1.25, .34, -.05), (.95, .22, .3)):
            rock_chunk(pc, (sx * (2.07 + dx), s * .45 - .06, zz), (s, s * .7, s * .8), rng, white=rng.uniform(0, .3), seed=7 + int(dx * 10))
    rock_faces = len(pc.F)
    # halite sprouting from the joints of the collar (cast onto the block faces)
    bv = pc.bvh(0, rock_faces)
    for (x, y_, hs, col) in ((-2.85, 2.62, .22, C['cr_pale']), (2.9, 1.7, .2, C['cr_deep']), (-1.2, 4.42, .24, C['cr_milk']), (1.75, 4.1, .17, C['cr_rose']),
                              (3.15, .45, .17, C['cr_clear']), (-3.3, 1.0, .15, C['cr_rose']), (.45, 4.9, .14, C['cr_deep']), (-2.6, 3.95, .14, C['cr_pale']),
                              (2.6, 3.3, .13, C['cr_milk'])):
        hit = bv.ray_cast(Vector((x, y_, 1.5)), Vector((0, 0, -1)), 4)
        if hit[0] is None: continue
        d = (Vector((x, y_ - 1.5, 0)).normalized() * .5 + Vector((0, 0, 1)) + Vector((0, .2, 0))).normalized()
        deep = col == C['cr_deep']
        R = rot_up(d, rng.uniform(0, TAU), CORNER_UP if x > 0 else YA)
        c0 = hit[0] - d * hs * .3
        crystal(pc, c0, R, (hs, hs * 1.1, hs), col, .75 if deep else .6, hopper={(1, 1)} if hs > .12 else (), seed=int(x * 10) + 50,
                inner=C['cr_inner_deep'] if deep else None)
        crystal(pc, c0 + R @ Vector((hs * 1.1, hs * .2, hs * .5)), R, (hs * .5,) * 3, C['cr_milk'] if deep else col, .6, seed=int(x * 10) + 51, detail=1)
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
        grow(x, z, d, (s, s, s), [C['cr_pale'], C['cr_milk'], C['cr_rose'], C['cr_clear']][k % 4], .5, corner=k % 2 == 0, spin=rng.uniform(0, TAU), bury=.4, seed=30 + k, ch=0.0 if s < .045 else None)
    # halite stair growth stepping down off the big cube's flank, and a slim coral column
    staircase(pc, c0 + R0m @ Vector((.36, -.12, .2)), R0m, .1, C['cr_clear'], n=3, seed=60, step=(.66, -.4, .25))
    cc_, Rc = grow(-.42, .3, (-.4, 1, .55), (.07, .2, .07), C['cr_coral'], .7, hopper={(1, 1)}, spin=.8, bury=.3, seed=64)
    # sugary white crust round the foot
    for k in range(11):
        th = TAU * (k + rng.uniform(-.3, .3)) / 11; r = rng.uniform(.62, .74)
        x, z = math.cos(th) * r, math.sin(th) * r; sx_ = rng.uniform(.07, .12)
        R = Matrix.Rotation(-th, 3, YA)
        tint = rng.uniform(0, .5)
        hull(pc, chunk_points((x, .02, z), (sx_ * .6, sx_ * .4, sx_), R, rng, cut=.7, jitter=.25), ROCK,
             lambda p, n, tint=tint: mul(mix(C['crust'], C['crust_pink'], tint), 1.04 if n.y > .4 else .93), mask=.3)
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
             TIMBER, lambda p, n: C['timber_c'] if n.y > .5 else mul(C['end'], .85), grain=XA)
    for sx in (-1, 1):
        x = sx * PX; yb = .3
        for (cc, ax, hf) in (((x, yb, PD / 2 + .006), (XA, YA, ZA), (PW / 2 + .01, .04, .006)), ((x, yb, -PD / 2 - .006), (XA, YA, ZA), (PW / 2 + .01, .04, .006)),
                             ((x + PW / 2 + .006, yb, 0), (ZA, YA, -XA), (PD / 2 + .01, .04, .006)), ((x - PW / 2 - .006, yb, 0), (ZA, YA, -XA), (PD / 2 + .01, .04, .006))):
            box(pc, cc, ax, hf, mat=IRON, col=C['iron'])
        rivet(pc, (x, yb, PD / 2 + .013), ZA, .015)
        xe = sx * 1.98
        for (cc, ax, hf) in (((xe, H + .17, .176), (XA, YA, ZA), (.04, .18, .006)), ((xe, H + .17, -.176), (XA, YA, ZA), (.04, .18, .006)),
                             ((xe, H + .346, 0), (XA, ZA, -YA), (.04, .176, .006))):
            box(pc, cc, ax, hf, mat=IRON, col=C['iron'])
        rivet(pc, (xe, H + .17, .183), ZA, .016)
    # a miner's tally, scratched into the right post (four and a slash)
    tx, tz = PX - .07, PD / 2 + .002
    for k in range(4):
        box(pc, (tx + k * .028, 1.55, tz), (XA, YA, ZA), (.004, .07, .002), mat=TIMBER, col=mul(C['end'], 1.1))
    box(pc, (tx + .042, 1.55, tz + .001), (Vector((1, .6, 0)).normalized(), Vector((-.6, 1, 0)).normalized(), ZA), (.075, .004, .002), mat=TIMBER, col=mul(C['end'], 1.15))
    return pc

RAIL_TOP = .20
LANTERN_SCALE = 1.25   # authored at 0.41 m, scaled to read on a 3.8 m portal
GAUGE = .60
def ratio(c_to, c_from): return tuple(t / max(f, 1e-4) for t, f in zip(c_to, c_from))

def build_rail():
    pc = Piece('RailStraight', reach=.2, ray_off=.003)
    rng = np.random.default_rng(505)
    hx = GAUGE / 2 + .022
    for k in range(4):
        z = -.75 + .5 * k + rng.uniform(-.02, .02); dz = rng.uniform(-.03, .03)
        beam(pc, (-.48, .045, z - dz), (.48, .045, z + dz), .2, .11, up=(0, 1, 0), mat=TIMBER, col=mix(C['timber_b'], C['timber_grey'], .45 + .2 * (k % 2)),
             ch=.02, segs=1, cap_col=mix(C['end'], C['timber_grey'], .4), colvar=.12, seed=k + 3, uv_off=k * .37, wear=.38, jit=.006)
        for sx in (-1, 1):   # tie plate under each rail, two spikes clenching the rail foot
            xc = sx * hx; zc = z + dz * sx * hx / .48
            box(pc, (xc, .1035, zc), (XA, YA, ZA), (.07, .0035, .055), mat=IRON, col=mix(C['iron_dark'], C['iron_rust'], .5))
            for side in (-1, 1):
                rivet(pc, (xc + side * .048, .108, zc + .03 * side * sx), YA, .016, k=4, col=mix(C['iron'], C['iron_rust'], .3))
    side = C['rail_side']
    for sx in (-1, 1):
        xc = sx * hx
        prof = [(-.035, .107), (.035, .107), (.035, .114), (.009, .124), (.009, .176), (.022, .182), (.022, RAIL_TOP), (-.022, RAIL_TOP),
                (-.022, .182), (-.009, .176), (-.009, .124), (-.035, .114)]
        n = len(prof)
        rows = []
        for z in (-1.0, 1.0):
            rows.append([pc.v((xc + x, y, z), side) for x, y in prof])
        for j in range(n):
            j2 = (j + 1) % n
            dx, dy = prof[j2][0] - prof[j][0], prof[j2][1] - prof[j][1]
            ya = min(prof[j][1], prof[j2][1])
            if ya >= RAIL_TOP - .001: tone = C['rail_top']                          # polished running surface
            elif ya >= .181: tone = mix(side, C['rail_top'], .4 if (prof[j][0] * sx) < 0 else .25)   # wheel-flange rub on the gauge side
            elif ya >= .175: tone = mix(side, C['iron_rust'], .3)
            else: tone = mix(side, C['iron_rust'], .62)                          # rusty web and foot
            pc.f([rows[0][j], rows[0][j2], rows[1][j2], rows[1][j]], IRON, True, None, out=Vector((dy, -dx, 0)), cm=ratio(tone, side))
        for r, sg in ((rows[0], -1), (rows[1], 1)):
            pc.f([pc.v(pc.P[i], mix(side, C['rail_top'], .3)) for i in r], IRON, True, None, out=Vector((0, 0, sg)))
        # fishplate and bolts at the +Z joint
        for s2 in (-1, 1):
            box(pc, (xc + s2 * .016, .15, .9), (XA, YA, ZA), (.006, .022, .1), mat=IRON, col=mix(C['iron'], C['iron_rust'], .4), ch=.003)
            rivet(pc, (xc + s2 * .023, .15, .9), (s2, 0, 0), .016, k=6, col=C['rivet'])
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
        if k % 3 == 1:
            crystal(pc, (x, y + s * .35, z), rot_up((x, 1, z), rng.uniform(0, TAU), CORNER_UP if k % 2 else YA), (s * .8,) * 3,
                    [C['cr_pale'], C['cr_rose'], C['cr_clear'], C['cr_coral']][k % 4], .65, seed=120 + k, detail=1)
        else:
            rock_chunk(pc, (x, y + s * .25, z), (s, s * .75, s * .85), rng, white=rng.uniform(0, .5), seed=90 + k, cut=.5)
    for k in range(5):
        th = TAU * k / 5 + .3; rr = .45
        x, z = math.cos(th) * rx * rr, math.sin(th) * rz * rr
        hit = bv.ray_cast(Vector((x, 3, z)), Vector((0, -1, 0)), 5); y = hit[0].y if hit[0] else yb
        s = rng.uniform(.05, .08)
        crystal(pc, (x, y + s * .5, z), rot_up((math.cos(th) * .5, 1, math.sin(th) * .5), rng.uniform(0, TAU), CORNER_UP if k % 2 else YA),
                (s, s, s), [C['cr_pale'], C['cr_rose'], C['cr_milk'], C['cr_deep'], C['cr_pale']][k], .6, seed=k)
    hit = bv.ray_cast(Vector((.02, 3, -.05)), Vector((0, -1, 0)), 5); y = hit[0].y if hit[0] else ytop
    crystal(pc, (.02, y + .07, -.05), rot_up((.15, 1, -.1), .6), (.11, .11, .11), C['cr_pale'], .7, hopper={(1, 1)}, steps=2, seed=140)
    # wheel faces: spoke ribs and brass hub caps; a brass plate on each end of the tub
    for sx in (-1, 1):
        for sz in (-1, 1):
            hc = Vector((sx * (WX + .05), AXY, sz * WZ))
            for k in range(5):
                th = TAU * k / 5 + .3 * sz
                e = Vector((0, math.cos(th), math.sin(th)))
                beam(pc, hc + e * .045 - XA * sx * .006, hc + e * .118 - XA * sx * .006, .018, .014, up=(sx, 0, 0), mat=IRON, col=C['iron'], ch=.004)
            lathe(pc, hc, (sx, 0, 0), [(0, .03), (.025, .028), (.04, .012), (.045, 0)], 10, BRASS, lambda i, j, p: C['brass_light'] if i < 2 else C['brass'], ref=(0, 1, 0))
    for sz in (-1, 1):
        nrm = Vector((0, -(TZ - BZ), sz * (Y1 - Y0))).normalized(); slope = Vector((0, Y1 - Y0, sz * (TZ - BZ))).normalized()
        x_, y_, z_ = side_pt(.68, 'x')
        pcen = Vector((0, y_, sz * z_)) + nrm * .02
        box(pc, pcen, (XA, slope, nrm), (.13, .065, .006), mat=BRASS, col=C['brass'], ch=.004)
        for dx in (-.11, .11): rivet(pc, pcen + XA * dx + nrm * .006, nrm, .012, mat=BRASS, col=C['brass_light'])
        crystal(pc, pcen + nrm * .02, Matrix((XA, slope, nrm)).transposed() @ Matrix.Rotation(math.pi / 4, 3, ZA), (.035, .035, .015), C['cr_rose'], .8, seed=150 + sz, detail=1)
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
    # someone's pick, left stuck in the top of the fall (they went for lunch)
    pk = Vector((.1, .66, .05)); d = Vector((.35, 1, .25)).normalized()
    timber_beam(pc, pk - d * .1, pk + d * .62, .045, .04, rng, up=(1, 0, 0), segs=2, taper=.9, ch=.01, shade=C['timber_c'])
    side_ = d.cross(Vector((0, 0, 1))).normalized(); hd = pk - d * .08
    beam(pc, hd - side_ * .04, hd + side_ * .3, .05, .045, up=d, mat=IRON, col=C['iron'], ch=.01, taper=.35)
    beam(pc, hd + side_ * .04, hd - side_ * .2, .05, .045, up=d, mat=IRON, col=C['iron'], ch=.01, taper=.4)
    box(pc, hd, (side_, d, side_.cross(d)), (.035, .05, .035), mat=IRON, col=C['iron_dark'], ch=.008)
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
    # a carved toy boat someone floated and lost, beached on the crust
    th = 2.25; bp = Vector((math.cos(th) * .98, .13, math.sin(th) * .98)); fw = Vector((-math.sin(th), .0, math.cos(th)))
    side_ = Vector((0, 1, 0)).cross(fw).normalized()
    pts = []
    for t, w, h in ((-.12, .045, .05), (-.06, .055, .05), (.04, .05, .048), (.12, .0, .055)):
        for sgn in (-1, 1):
            pts += [bp + fw * t + side_ * w * sgn + YA * h, bp + fw * t * .9 + side_ * w * .55 * sgn]
    hull(pc, pts, TIMBER, lambda p, n: C['sign'] if n.y > .5 else C['timber_c'], grain=fw)
    beam(pc, bp + YA * .04, bp + YA * .2, .012, .012, mat=TIMBER, col=C['timber_b'], ring_caps=False)
    hull(pc, [bp + YA * .07 + fw * .01, bp + YA * .19 + fw * .01, bp + YA * .07 + fw * .1, bp + YA * .07 + fw * .01 + side_ * .006, bp + YA * .19 + fw * .01 + side_ * .006,
              bp + YA * .07 + fw * .1 + side_ * .006], ROCK, lambda p, n: C['salt_cream'], mask=.5)
    return pc

# ===================================================================== SDF sculpting (carved-salt statues and formations)
# Shapes are signed-distance fields over numpy point arrays (negative inside), blended with smooth unions and carved
# with smooth subtractions, meshed with surface nets, relaxed and decimated to budget in Blender, then coloured per
# vertex from region tags, thickness (thin parts glow like a salt lamp) and strata.
def _np(v): return np.asarray(v, np.float32)
def _len(a): return np.sqrt((a * a).sum(-1))

class Field:
    """A signed-distance accumulator with region tags (the dominant shape's tag wins at each point)."""
    def __init__(self, P):
        self.P = P; self.d = np.full(len(P), 1e3, np.float32); self.tag = np.zeros(len(P), np.int16)
    def add(self, d, tag=0, k=0.0):
        if k > 0:
            h = np.clip(.5 + .5 * (self.d - d) / k, 0, 1)
            nd = self.d * (1 - h) + d * h - k * h * (1 - h)
            self.tag = np.where(h > .5, np.int16(tag), self.tag)
            self.d = nd.astype(np.float32)
        else:
            self.tag = np.where(d < self.d, np.int16(tag), self.tag); self.d = np.minimum(self.d, d)
        return self
    def cut(self, d, k=0.0, tag=None):
        if k > 0:
            h = np.clip(.5 - .5 * (self.d + d) / k, 0, 1)
            nd = self.d * (1 - h) + (-d) * h + k * h * (1 - h)
        else:
            nd = np.maximum(self.d, -d); h = (-d > self.d).astype(np.float32)
        if tag is not None: self.tag = np.where(h > .5, np.int16(tag), self.tag)
        self.d = nd.astype(np.float32); return self
    def clip(self, d):
        self.d = np.maximum(self.d, d); return self

def sd_sphere(P, c, r): return _len(P - _np(c)) - r
def _local(P, c, R):
    q = P - _np(c)
    return q if R is None else q @ _np(R)      # R columns = local axes in world
def sd_ellipsoid(P, c, r, R=None):
    q = _local(P, c, R); r = _np(r)
    k0 = _len(q / r); k1 = _len(q / (r * r))
    return k0 * (k0 - 1) / np.maximum(k1, 1e-6)
def sd_capsule(P, a, b, ra, rb=None):
    a, b = _np(a), _np(b); pa = P - a; ba = b - a
    h = np.clip((pa @ ba) / max(float(ba @ ba), 1e-9), 0, 1)
    r = ra if rb is None else ra + (rb - ra) * h
    return _len(pa - h[:, None] * ba) - r
def sd_rbox(P, c, half, R=None, rad=0.0):
    q = np.abs(_local(P, c, R)) - (_np(half) - rad)
    return _len(np.maximum(q, 0)) + np.minimum(q.max(-1), 0) - rad
def sd_torus(P, c, Rr, r, R=None):
    q = _local(P, c, R)   # ring in the local x-z plane
    return np.sqrt((np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - Rr) ** 2 + q[:, 1] ** 2) - r
def sd_chain(P, pts, radii, k=0.0):
    d = None
    for i in range(len(pts) - 1):
        di = sd_capsule(P, pts[i], pts[i + 1], radii[i], radii[i + 1])
        if d is None: d = di
        elif k > 0:
            h = np.clip(.5 + .5 * (d - di) / k, 0, 1); d = d * (1 - h) + di * h - k * h * (1 - h)
        else: d = np.minimum(d, di)
    return d
def rot_xyz(rx=0.0, ry=0.0, rz=0.0):
    """Rotation (game frame) as a numpy matrix whose columns are the local axes."""
    m = Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')
    return np.array(m, np.float32)
def bezier(p0, p1, p2, n):
    p0, p1, p2 = _np(p0), _np(p1), _np(p2)
    return [(1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t * t * p2 for t in np.linspace(0, 1, n)]

def surface_nets(F, origin, step):
    """F: (nx, ny, nz) samples, negative inside. Returns vertices (n, 3) and outward-wound quads (m, 4)."""
    nx, ny, nz = F.shape
    inside = F < 0
    cs = [inside[i:nx - 1 + i, j:ny - 1 + j, k:nz - 1 + k] for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    anyin = np.zeros_like(cs[0]); allin = np.ones_like(cs[0])
    for x in cs: anyin |= x; allin &= x
    active = anyin & ~allin
    idx = -np.ones(active.shape, np.int64)
    ai = np.argwhere(active); idx[active] = np.arange(len(ai))
    acc = np.zeros((len(ai), 3)); cnt = np.zeros(len(ai))
    I, J, K = ai[:, 0], ai[:, 1], ai[:, 2]
    corners = [(0, 0, 0), (1, 0, 0), (0, 1, 0), (1, 1, 0), (0, 0, 1), (1, 0, 1), (0, 1, 1), (1, 1, 1)]
    edges = [(0, 1), (2, 3), (4, 5), (6, 7), (0, 2), (1, 3), (4, 6), (5, 7), (0, 4), (1, 5), (2, 6), (3, 7)]
    fv = [F[I + a, J + b, K + c] for a, b, c in corners]
    for e0, e1 in edges:
        f0, f1 = fv[e0], fv[e1]
        m = (f0 < 0) != (f1 < 0)
        t = np.where(m, f0 / np.where(m, f0 - f1, 1), 0)
        p0 = np.array(corners[e0], float); p1 = np.array(corners[e1], float)
        acc[m] += p0 + (p1 - p0) * t[m][:, None]; cnt[m] += 1
    V = (ai + acc / cnt[:, None]) * step + origin
    quads = []
    for ax in range(3):
        s0 = [slice(None)] * 3; s1 = [slice(None)] * 3; s0[ax] = slice(0, -1); s1[ax] = slice(1, None)
        a = inside[tuple(s0)]; b = inside[tuple(s1)]
        e = np.argwhere(a != b)
        o1, o2 = [x for x in range(3) if x != ax]
        ok = (e[:, o1] >= 1) & (e[:, o2] >= 1) & (e[:, o1] < F.shape[o1] - 1) & (e[:, o2] < F.shape[o2] - 1)
        e = e[ok]
        flip = a[tuple(e.T)]
        def cell(d1, d2):
            q = e.copy(); q[:, o1] -= d1; q[:, o2] -= d2; return idx[tuple(q.T)]
        Q = np.stack([cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)], 1)
        rh = (o1 - ax) % 3 == 1
        quads.append(np.where((flip != rh)[:, None], Q[:, ::-1], Q))
    return V, np.concatenate(quads)

def sculpt_mesh(field_fn, lo, hi, voxel, target_tris, smooth=2, smooth_factor=.5, name='sculpt'):
    """Mesh the zero set of field_fn(P)->Field inside the box lo..hi; relax and decimate to about target_tris.
    Returns (verts (n, 3) game frame, tris (m, 3))."""
    lo, hi = np.array(lo, float), np.array(hi, float)
    n = np.maximum(np.ceil((hi - lo) / voxel).astype(int) + 1, 2)
    axes = [lo[i] + np.arange(n[i]) * voxel for i in range(3)]
    G = np.stack(np.meshgrid(*axes, indexing='ij'), -1).reshape(-1, 3).astype(np.float32)
    F = field_fn(G).d.reshape(n)
    # close the box so the surface never runs out of the grid
    F[0, :, :] = F[-1, :, :] = F[:, 0, :] = F[:, -1, :] = F[:, :, 0] = F[:, :, -1] = np.maximum(voxel, 0)
    V, Q = surface_nets(F, lo, voxel)
    me = bpy.data.meshes.new(name + '_tmp')
    me.from_pydata([tuple(v) for v in V], [], [tuple(int(i) for i in q) for q in Q])
    me.validate(); me.update()
    ob = bpy.data.objects.new(name + '_tmp', me); SC.collection.objects.link(ob)
    if smooth:
        sm = ob.modifiers.new('relax', 'SMOOTH'); sm.factor = smooth_factor; sm.iterations = smooth
    tri0 = sum(len(p.vertices) - 2 for p in me.polygons)
    dc = ob.modifiers.new('dec', 'DECIMATE'); dc.decimate_type = 'COLLAPSE'; dc.ratio = min(1.0, target_tris / max(tri0, 1))
    dc.use_collapse_triangulate = True
    tr = ob.modifiers.new('tri', 'TRIANGULATE')
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg)
    m2 = ev.to_mesh()
    verts = np.array([tuple(v.co) for v in m2.vertices], np.float32)
    tris = np.array([tuple(p.vertices) for p in m2.polygons], np.int64)
    ev.to_mesh_clear(); bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return verts, tris

def mesh_normals(V, T):
    n = np.zeros_like(V, dtype=np.float64)
    fn = np.cross(V[T[:, 1]] - V[T[:, 0]], V[T[:, 2]] - V[T[:, 0]])
    for k in range(3): np.add.at(n, T[:, k], fn)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-12)

def mesh_thickness(V, T, N, reach=.6):
    """Inward ray distance to the far side: how much salt the lamp-light shines through."""
    bvh = BVHTree.FromPolygons([tuple(map(float, v)) for v in V], [tuple(map(int, t)) for t in T])
    out = np.full(len(V), reach, np.float32)
    for i in range(len(V)):
        n = Vector(N[i]); p = Vector(V[i]) - n * .006
        e1 = n.cross(XA if abs(n.x) < .9 else YA).normalized(); e2 = n.cross(e1)
        acc = 0.0
        for d in (-n, (-n + e1 * .45).normalized(), (-n - e1 * .3 + e2 * .4).normalized(), (-n - e1 * .3 - e2 * .4).normalized()):
            hit = bvh.ray_cast(p, d, reach)
            acc += hit[3] if hit[0] is not None else reach
        out[i] = acc / 4
    return out

def add_sculpt(pc, V, T, field_fn, shade_fn, mat=CRYSTAL, mat_fn=None):
    """Add a sculpted mesh to a piece. shade_fn(p, n, tag, thick) -> (colour, mask); mat_fn(tag) -> material."""
    N = mesh_normals(V, T)
    fld = field_fn(V.astype(np.float32)); tags = fld.tag
    thick = mesh_thickness(V, T, N)
    base = len(pc.P)
    for i in range(len(V)):
        col, m = shade_fn(Vector(V[i]), Vector(N[i]), int(tags[i]), float(thick[i]))
        pc.v(Vector(V[i]), col, m)
    for t in T:
        mt = mat if mat_fn is None else mat_fn(int(tags[t[0]]))
        pc.f([base + int(t[0]), base + int(t[1]), base + int(t[2])], mt, True)

def strata(p, seed=0, scale=1.0):
    """Bedding of carved rock salt: soft horizontal bands, warped a little. 0..1."""
    w = fbm((p[0] * .8 * scale, p[1] * .4 * scale, p[2] * .8 * scale), seed, 2)
    return .5 + .5 * math.sin((p[1] * 7.0 * scale + 2.2 * w) * math.pi)

def carved_salt(p, n, base, thick, seed=0, glow=(.14, .62), thin=(.32, .03), band=.22, grain=.07):
    """Carved salt colour and glow: strata bands, chisel-scale mottling, thin parts glow."""
    s = strata(p, seed)
    c = mix(mul(base, 1 - band * .5), mul(base, 1 + band * .5), s)
    c = mul(c, 1 + grain * (fbm((p[0] * 9, p[1] * 9, p[2] * 9), seed + 3, 2) * 2 - 1))
    t = smoothstep(thin[0], thin[1], thick)
    c = mix(c, mix(base, C['cr_clear'], .35), t * .35)
    return c, glow[0] + (glow[1] - glow[0]) * t


# ===================================================================== the Carvers' Chapel
def strata_box(pc, c, half, rng, ch=.03, seed=0, base=None, mask=.2, band=.16, mat=ROCK, R=None):
    """A squared, chamfered block of carved rock salt with face-constant strata colour (no swimming gradients)."""
    base = base or C['salt_carve2']
    R = R if R is not None else Matrix.Identity(3)
    c = Vector(c); h = Vector(half)
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                for ax in range(3):
                    q = Vector((sx * h.x, sy * h.y, sz * h.z)); q[ax] -= (sx, sy, sz)[ax] * ch
                    pts.append(c + R @ q)
    def cf(p, n):
        s = strata(p, seed, 1.3)
        col = mix(mul(base, .9), mix(base, C['salt_cream'], .55), s)
        return mul(col, (1.06 if n.y > .5 else (.94 if n.y < -.5 else 1.0)) * (1 + .05 * (_hash(int(p.x * 40), int(p.y * 40), int(p.z * 40), seed) - .5)))
    hull(pc, pts, mat, cf, mask=lambda p, n: mask + .12 * strata(p, seed, 1.3))

def plinth(pc, w, d, h, rng, seed=0, base=None, steps=True):
    """A squared salt plinth with a chamfered base moulding and cornice; top at y = h."""
    base = base or C['salt_carve2']
    if steps:
        strata_box(pc, (0, .055, 0), (w / 2, .055, d / 2), rng, ch=.025, seed=seed, base=mul(base, .92))
        strata_box(pc, (0, .125, 0), (w / 2 - .035, .025, d / 2 - .035), rng, ch=.012, seed=seed + 1, base=base)
        strata_box(pc, (0, (h - .07 + .14) / 2, 0), (w / 2 - .07, (h - .07 - .14) / 2, d / 2 - .07), rng, ch=.02, seed=seed + 2, base=base)
        strata_box(pc, (0, h - .07 + .02, 0), (w / 2 - .04, .02, d / 2 - .04), rng, ch=.01, seed=seed + 3, base=mix(base, C['salt_cream'], .3))
        strata_box(pc, (0, h - .025, 0), (w / 2, .025, d / 2), rng, ch=.018, seed=seed + 4, base=mix(base, C['salt_cream'], .2))
    else:
        strata_box(pc, (0, h / 2, 0), (w / 2, h / 2, d / 2), rng, ch=.03, seed=seed, base=base)

def shade_regions(table, seed=0):
    def f(p, n, tag, thick):
        base, glow, kind = table.get(tag, table[0])
        if kind == 'crystal':
            return base, glow[1]
        return carved_salt(p, n, base, thick, seed + tag, glow=glow)
    return f

# --- Brann, the forge's namesake: stout, cheerful, a sledge on his shoulder, one fist on his hip
BR_BODY, BR_BEARD, BR_APRON, BR_BOOT, BR_SKIN, BR_HAMMER, BR_BELT, BR_HAIR = range(8)
def brann_field(P, PT=.62):
    F = Field(P)
    y = lambda v: PT + v
    # boots and stubby legs
    for sx in (-1, 1):
        F.add(sd_rbox(P, (sx * .2, y(.085), .05), (.135, .085, .2), None, .07), BR_BOOT, .02)
        F.add(sd_sphere(P, (sx * .2, y(.11), .2), .1), BR_BOOT, .05)
        F.add(sd_capsule(P, (sx * .19, y(.15), 0), (sx * .18, y(.48), 0), .14, .15), BR_BODY, .05)
    # tunic skirt flaring over the legs, flat hem
    F.add(np.maximum(sd_capsule(P, (0, y(.58), 0), (0, y(.36), .0), .4, .46), y(.3) - P[:, 1]), BR_BODY, .05)
    # barrel body, belly and shoulders
    F.add(sd_ellipsoid(P, (0, y(.86), 0), (.44, .46, .37)), BR_BODY, .1)
    F.add(sd_ellipsoid(P, (0, y(.72), .08), (.41, .34, .35)), BR_BODY, .08)
    F.add(sd_ellipsoid(P, (0, y(1.1), -.02), (.52, .2, .31)), BR_BODY, .12)
    body = F.d.copy()
    # leather apron hugging the front: a shell round the body, cut to a trapezoid below the chest
    shell = body - .045      # a solid thickening of the body: no inner skin, no slivers
    yy = P[:, 1] - PT
    halfw = .22 + .11 * np.clip((1.02 - yy) / .8, 0, 1)
    region = np.maximum(np.maximum(np.abs(P[:, 0]) - halfw, -P[:, 2] + .12), np.maximum(yy - 1.04, .2 - yy))
    F.add(np.maximum(shell, region), BR_APRON, .0)
    # apron pocket
    pk = sd_rbox(P, (.12, y(.47), .5), (.1, .085, .06), None, .02)
    F.add(np.maximum(body - .07, pk), BR_APRON, .01)
    # belt and buckle
    belt = np.maximum(sd_ellipsoid(P, (0, y(.62), .03), (.47, .3, .41)), np.abs(yy - .62) - .05)
    F.add(belt, BR_BELT, .01)
    F.add(sd_rbox(P, (0, y(.62), .44), (.085, .07, .03), None, .018), BR_BELT, .01)
    F.cut(sd_rbox(P, (0, y(.62), .48), (.045, .035, .04), None, .01), .005)
    # straps over the shoulders
    for sx in (-1, 1):
        F.add(sd_chain(P, [(sx * .2, y(1.02), .36), (sx * .28, y(1.17), .22), (sx * .3, y(1.23), 0), (sx * .29, y(1.15), -.24)], [.028] * 4), BR_APRON, .02)
    # head: dome, ears, nose, cheeks, brows; happy squinting eyes and a grin under the moustache
    F.add(sd_sphere(P, (0, y(1.52), .03), .25), BR_SKIN, .1)
    F.add(sd_ellipsoid(P, (0, y(1.46), -.07), (.265, .17, .21)), BR_HAIR, .06)
    for sx in (-1, 1):
        F.add(sd_ellipsoid(P, (sx * .25, y(1.5), .0), (.045, .075, .055)), BR_SKIN, .03)
        F.add(sd_sphere(P, (sx * .115, y(1.44), .215), .085), BR_SKIN, .05)
        F.add(sd_ellipsoid(P, (sx * .1, y(1.6), .225), (.095, .04, .05), rot_xyz(0, 0, sx * -.28)), BR_HAIR, .03)
        F.cut(sd_chain(P, [(sx * .045, y(1.53), .262), (sx * .095, y(1.548), .258), (sx * .145, y(1.53), .238)], [.015] * 3), .012)
    F.add(sd_sphere(P, (0, y(1.47), .29), .08), BR_SKIN, .03)
    # beard: a big mass in chunky lobes over the chest
    F.add(sd_ellipsoid(P, (0, y(1.22), .18), (.28, .17, .19)), BR_BEARD, .07)
    for k, (bx, by, bz, rx, ry) in enumerate(((-.17, 1.12, .27, .1, .16), (-.06, 1.06, .33, .1, .19), (.06, 1.06, .33, .1, .19), (.17, 1.12, .27, .1, .16),
                                              (-.25, 1.26, .15, .09, .14), (.25, 1.26, .15, .09, .14))):
        F.add(sd_ellipsoid(P, (bx, y(by), bz), (rx, ry, .11)), BR_BEARD, .04)
    # moustache curling up at the ends
    for sx in (-1, 1):
        F.add(sd_chain(P, [(sx * .02, y(1.39), .3), (sx * .1, y(1.37), .28), (sx * .18, y(1.38), .23), (sx * .22, y(1.43), .2)], [.045, .048, .04, .03]), BR_BEARD, .02)
    F.cut(sd_chain(P, [(-.09, y(1.335), .3), (-.04, y(1.315), .335), (0, y(1.31), .34), (.04, y(1.315), .335), (.09, y(1.335), .3)], [.022] * 5), .015, tag=BR_SKIN)
    # two thick braids hanging on the belly, banded at the ends
    for sx in (-1, 1):
        path = bezier((sx * .1, y(1.0), .4), (sx * .12, y(.82), .53), (sx * .13, y(.6), .52), 6)
        for i, q in enumerate(path):
            off = (.024 if i % 2 else -.024)
            F.add(sd_ellipsoid(P, q + _np((off, 0, 0)), (.058, .052, .05), rot_xyz(0, 0, sx * (.5 if i % 2 else -.5))), BR_BEARD, .015)
        F.add(sd_capsule(P, path[-1] - _np((0, .03, 0)), path[-1] - _np((0, .07, 0)), .05), BR_BELT, .01)
        F.add(sd_capsule(P, path[-1] - _np((0, .08, 0)), path[-1] - _np((0, .16, -.02)), .05, .025), BR_BEARD, .02)
    # right arm (viewer's left): fist on the hip, elbow out
    F.add(sd_sphere(P, (-.47, y(1.1), 0), .17), BR_BODY, .08)
    F.add(sd_capsule(P, (-.5, y(1.07), 0), (-.78, y(.75), -.04), .15, .12), BR_BODY, .05)
    F.add(sd_capsule(P, (-.78, y(.75), -.04), (-.5, y(.58), .08), .125, .11), BR_SKIN, .06)
    F.add(sd_torus(P, (-.72, y(.72), -.02), .12, .035, rot_xyz(0, 0, .9)), BR_BODY, .02)
    F.add(sd_ellipsoid(P, (-.45, y(.57), .1), (.11, .1, .125)), BR_SKIN, .04)
    # left arm (viewer's right): hand up at the chest, gripping the hammer's handle
    F.add(sd_sphere(P, (.47, y(1.1), 0), .17), BR_BODY, .08)
    F.add(sd_capsule(P, (.5, y(1.07), 0), (.7, y(.8), .14), .15, .12), BR_BODY, .05)
    F.add(sd_capsule(P, (.7, y(.8), .14), (.52, y(1.14), .3), .125, .105), BR_SKIN, .06)
    F.add(sd_torus(P, (.66, y(.86), .17), .12, .035, rot_xyz(.6, 0, -.5)), BR_BODY, .02)
    F.add(sd_ellipsoid(P, (.5, y(1.18), .31), (.11, .12, .115)), BR_SKIN, .04)
    return F

def brann_hammer(pc, PT=.62):
    """The sledge: handle through the left fist, resting over the shoulder, a big carved head behind it."""
    H = Vector((.5, PT + 1.18, .31)); T = Vector((.4, PT + 1.47, -.38))
    d = (T - H).normalized()
    beam(pc, H - d * .34, T + d * .06, .07, .07, up=(1, 0, 0), mat=CRYSTAL, col=C['salt_carve2'], ch=.018, segs=3, mask=.5)
    for t in (-.3, -.22):
        beam(pc, H + d * t, H + d * (t + .035), .085, .085, up=(1, 0, 0), mat=CRYSTAL, col=C['salt_rose'], ch=.02, mask=.5)
    # head: long axis across the handle in the vertical plane, chamfered with rounded striking faces
    ax = Vector((0, 1, 0)) - d * d.y; ax.normalize()
    side = d.cross(ax).normalized()
    hc = T + d * .02
    R = Matrix((side, ax, d)).transposed()
    crystal(pc, hc, R, (.14, .26, .15), C['cr_rose'], .62, ch=.03, seed=401, detail=2, milk=C['salt_cream'])
    for sg in (-1, 1):
        crystal(pc, hc + ax * sg * .275, R, (.125, .03, .135), C['cr_blush'], .5, ch=.018, seed=402 + sg, detail=1, milk=C['salt_cream'])
    return hc + ax * .31

def build_statue_brann():
    pc = Piece('StatueBrann', reach=.5)
    rng = np.random.default_rng(1101)
    PT = .62
    plinth(pc, 1.4, 1.12, PT, rng, seed=11)
    # carved front panel on the plinth: a small hammer over an anvil-crystal
    strata_box(pc, (0, .36, .5), (.3, .14, .015), rng, ch=.012, seed=17, base=C['salt_rose'], mask=.3)
    crystal(pc, Vector((0, .36, .525)), rot_up((0, 0, 1), 0.0, CORNER_UP), (.07, .07, .07), C['cr_rose'], .8, seed=19, detail=1)
    for sx in (-1, 1):
        crystal(pc, Vector((sx * .2, .36, .522)), Matrix.Rotation(math.pi / 4, 3, ZA), (.035, .035, .03), C['cr_milk'], .6, seed=20 + sx, detail=1)
    table = {BR_BODY: (C['salt_carve'], (.12, .55), 's'), BR_BEARD: (C['salt_cream'], (.16, .66), 's'), BR_APRON: (C['salt_rose'], (.14, .6), 's'),
             BR_BOOT: (C['salt_shadow'], (.1, .4), 's'), BR_SKIN: (C['cr_blush'], (.16, .62), 's'), BR_HAIR: (C['salt_carve2'], (.12, .5), 's'),
             BR_BELT: (C['salt_shadow'], (.12, .45), 's'), 0: (C['salt_carve'], (.12, .55), 's')}
    # a stowaway: a little Saltback perched on the plinth's corner, waving up at him
    co, cs, cy = (.5, PT, .38), .19, -.45
    cfn = lambda P: crab_field(P, co, cs, cy)
    V, T = sculpt_mesh(cfn, (.25, PT - .01, .12), (.75, PT + .25, .62), .005, 700, name='minicrab')
    add_sculpt(pc, V, T, cfn, shade_regions(CRAB_TABLE, 1150))
    crab_shell(pc, co, cs, cy, rng, seed=1160)
    fn = lambda P: brann_field(P, PT)
    s0 = len(pc.P)
    V, T = sculpt_mesh(fn, (-1.0, PT - .02, -.62), (1.0, PT + 1.8, .72), .012, 6600, name='brann')
    add_sculpt(pc, V, T, fn, shade_regions(table, 1100))
    top = brann_hammer(pc, PT)
    o, k = Vector((0, PT, 0)), 1.16      # authored at dwarf scale, shown a touch larger than life
    for i in range(s0, len(pc.P)): pc.P[i] = o + (pc.P[i] - o) * k
    top = o + (top - o) * k
    return pc


# --- a Saltback hermit crab, both claws up in a cheery wave (also used small, as a stowaway on Brann's plinth)
CR_BODY, CR_EYE, CR_CLAW, CR_LEG, CR_PUPIL = 10, 11, 12, 13, 14
def crab_field(P, o=(0, 0, 0), s=1.0, yaw=0.0):
    Ry = np.array(Matrix.Rotation(yaw, 3, 'Y'), np.float32)
    Q = ((P - _np(o)) @ Ry) / s           # into the crab's own frame (faces +Z, body width ~1)
    F = Field(Q)
    F.add(sd_ellipsoid(Q, (0, .33, -.02), (.47, .26, .38)), CR_BODY, 0)
    F.add(sd_ellipsoid(Q, (0, .26, .1), (.38, .18, .31)), CR_BODY, .08)
    F.cut(sd_chain(Q, [(-.13, .33, .37), (-.06, .3, .405), (.06, .3, .405), (.13, .33, .37)], [.026] * 4), .02)   # a big grin
    for sx in (-1, 1):
        F.add(sd_capsule(Q, (sx * .11, .48, .22), (sx * .16, .66, .28), .045, .04), CR_BODY, .04)
        F.add(sd_sphere(Q, (sx * .165, .72, .29), .1), CR_EYE, .02)
        F.add(sd_sphere(Q, (sx * .17, .735, .37), .042), CR_PUPIL, .006)
        for k, z in enumerate((-.2, -.06, .08)):
            F.add(sd_chain(Q, [(sx * .36, .26, z), (sx * .58, .34, z * 1.3 - .02), (sx * .66, .03, z * 1.55 - .03)], [.085, .07, .045]), CR_LEG, .04)
        # claw arms raised in a wave, pincers open
        F.add(sd_chain(Q, [(sx * .3, .36, .22), (sx * .52, .5, .3), (sx * .6, .76, .3)], [.09, .085, .09]), CR_CLAW, .05)
        F.add(sd_ellipsoid(Q, (sx * .62, .92, .3), (.17, .2, .13), rot_xyz(0, 0, sx * -.35)), CR_CLAW, .06)
        F.add(sd_ellipsoid(Q, (sx * .72, 1.12, .3), (.08, .14, .09), rot_xyz(0, 0, sx * -.55)), CR_CLAW, .03)
        F.add(sd_ellipsoid(Q, (sx * .53, 1.1, .3), (.065, .12, .08), rot_xyz(0, 0, sx * .25)), CR_CLAW, .03)
        F.cut(sd_ellipsoid(Q, (sx * .625, 1.16, .3), (.04, .12, .16)), .02)
    F.d = F.d * s
    return F

CRAB_TABLE = {CR_BODY: (C['salt_rose'], (.14, .6), 's'), CR_EYE: (C['salt_cream'], (.3, .7), 's'), CR_PUPIL: (C['salt_shadow'], (.05, .2), 's'),
              CR_CLAW: (mix(C['salt_rose'], C['cr_coral'], .5), (.16, .7), 's'), CR_LEG: (C['salt_carve2'], (.16, .7), 's'), 0: (C['salt_rose'], (.14, .6), 's')}

def crab_shell(pc, o, s, yaw, rng, seed=0):
    """The Saltback's shell: a little cluster of real crystals on its back."""
    Ry = Matrix.Rotation(yaw, 3, YA)
    def W(p): return Vector(o) + Ry @ (Vector(p) * s)
    big = rot_up((0, 1, -.35), .5 + yaw, CORNER_UP)
    crystal(pc, W((0, .66, -.14)), Ry @ big, (.22 * s,) * 3, C['cr_milk'], .7, seed=seed, hopper={(1, 1)} if s > .5 else (), detail=2 if s > .5 else 1)
    for k, (x, y, z, h, col) in enumerate(((-.24, .56, -.06, .12, C['cr_rose']), (.24, .57, -.09, .13, C['cr_pale']), (.04, .6, .1, .09, C['cr_deep']),
                                          (-.1, .55, -.3, .11, C['cr_clear']), (.22, .52, -.27, .09, C['cr_rose']), (-.02, .82, -.2, .08, C['cr_clear']))):
        d = Vector((x * 2, 1, z * 2)).normalized()
        crystal(pc, W((x, y, z)), Ry @ rot_up(d, k * 1.3, CORNER_UP if k % 2 else YA), (h * s,) * 3, col, .8 if col == C['cr_deep'] else .65,
                seed=seed + k + 1, detail=2 if s > .5 else (1 if k < 2 else 0), inner=C['cr_inner_deep'] if col == C['cr_deep'] else None)

def build_statue_crab():
    pc = Piece('StatueCrab', reach=.4)
    rng = np.random.default_rng(1202)
    PT = .22
    plinth(pc, 1.42, .92, PT, rng, seed=21)
    o, s = (0, PT, -.04), .8
    fn = lambda P: crab_field(P, o, s)
    V, T = sculpt_mesh(fn, (-.8, PT - .02, -.45), (.8, PT + 1.1, .5), .009, 6200, name='crab')
    add_sculpt(pc, V, T, fn, shade_regions(CRAB_TABLE, 1200))
    crab_shell(pc, o, s, 0.0, rng, seed=1210)
    return pc

# --- a mountain goat carved in salt, happily licking a salt block
GT_BODY, GT_HORN, GT_HOOF, GT_TONGUE, GT_FACE, GT_BEARD = 20, 21, 22, 23, 24, 25
def goat_field(P, PT=.2, s=1.35):
    Q = (P - _np((-.12, PT, 0))) / s
    F = Field(Q)
    F.add(sd_ellipsoid(Q, (-.04, .52, 0), (.32, .21, .21)), GT_BODY, 0)
    F.add(sd_sphere(Q, (.18, .53, 0), .21), GT_BODY, .1)
    F.add(sd_sphere(Q, (-.25, .54, 0), .19), GT_BODY, .1)
    F.add(sd_ellipsoid(Q, (.27, .44, 0), (.1, .14, .15)), GT_BEARD, .06)
    F.add(sd_ellipsoid(Q, (-.02, .7, 0), (.26, .05, .1)), GT_BEARD, .08)
    for x, kx in ((.19, .025), (-.27, -.035)):
        for sz in (-1, 1):
            F.add(sd_chain(Q, [(x, .45, sz * .1), (x + kx, .25, sz * .105), (x, .07, sz * .1)], [.08, .06, .055]), GT_BODY, .04)
            F.add(sd_rbox(Q, (x + .012, .035, sz * .1), (.06, .035, .055), None, .015), GT_HOOF, .01)
    F.add(sd_chain(Q, [(.25, .6, 0), (.37, .66, .03), (.46, .64, .06)], [.13, .115, .1]), GT_BODY, .06)
    F.add(sd_ellipsoid(Q, (.55, .6, .08), (.15, .095, .09), rot_xyz(0, -.3, -.55)), GT_FACE, .05)
    F.add(sd_ellipsoid(Q, (.66, .5, .12), (.075, .07, .065)), GT_FACE, .04)
    F.add(sd_ellipsoid(Q, (.71, .435, .15), (.04, .055, .03), rot_xyz(.2, 0, -.5)), GT_TONGUE, .012)
    F.cut(sd_chain(Q, [(.68, .47, .17), (.7, .475, .16), (.72, .49, .14)], [.01] * 3), .008)   # smile at the muzzle
    F.add(sd_chain(Q, [(.6, .47, .09), (.59, .4, .085), (.57, .34, .08)], [.035, .024, .01]), GT_BEARD, .02)
    for sz in (-1, 1):
        F.add(sd_chain(Q, bezier((.5, .67, .08 + sz * .045), (.38, .9, .08 + sz * .1), (.25, .8, .08 + sz * .14), 7),
                       [.05, .045, .038, .03, .024, .017, .011]), GT_HORN, .025)
        F.add(sd_ellipsoid(Q, (.47, .63, .08 + sz * .125), (.085, .028, .04), rot_xyz(0, sz * .45, .25)), GT_FACE, .02)
        F.cut(sd_chain(Q, [(.53, .65, .08 + sz * .085), (.57, .64, .08 + sz * .088)], [.012, .012]), .01)
    F.add(sd_capsule(Q, (-.4, .62, 0), (-.47, .75, 0), .06, .03), GT_BODY, .03)
    F.d = F.d * s
    return F

def build_statue_goat():
    pc = Piece('StatueGoat', reach=.4)
    rng = np.random.default_rng(1303)
    PT, s = .2, 1.35
    plinth(pc, 1.84, .8, PT, rng, seed=31)
    table = {GT_BODY: (C['salt_carve'], (.14, .62), 's'), GT_HORN: (C['salt_shadow'], (.18, .7), 's'), GT_HOOF: (C['salt_shadow'], (.1, .35), 's'),
             GT_TONGUE: (C['cr_rose'], (.4, .85), 's'), GT_FACE: (C['salt_cream'], (.16, .65), 's'), GT_BEARD: (C['salt_cream'], (.2, .75), 's'), 0: (C['salt_carve'], (.14, .62), 's')}
    fn = lambda P: goat_field(P, PT, s)
    V, T = sculpt_mesh(fn, (-.9, PT - .02, -.32), (.9, PT + 1.15, .42), .009, 7000, name='goat')
    add_sculpt(pc, V, T, fn, shade_regions(table, 1300))
    # the salt lick: a coral halite block with a tongue-worn dip, on a squared salt post at the goat's chin
    lick = Vector((-.12 + .74 * s, PT + .46, .2))
    strata_box(pc, (lick.x, PT + .18, lick.z), (.08, .18, .08), rng, ch=.015, seed=37, base=C['salt_carve2'])
    crystal(pc, lick, Matrix.Rotation(.3, 3, YA), (.105, .1, .105), C['cr_coral'], .72, hopper={(1, 1)}, steps=2, seed=1311)
    crystal(pc, Vector((lick.x - .2, PT + .05, lick.z + .14)), Matrix.Rotation(.9, 3, YA), (.05, .05, .05), C['cr_milk'], .6, seed=1312, detail=1)
    return pc

# --- a Wieliczka-style chandelier of salt crystals on a brass and iron frame (origin at the hook, hangs along -Y)
def build_chandelier():
    pc = Piece('SaltChandelier', floor=False, reach=.25, ray_off=.002)
    rng = np.random.default_rng(1404)
    torus(pc, (0, -.05, 0), ZA, .045, .012, 12, 5, BRASS, C['brass_light'], ref=XA)
    y = -.1
    for k in range(6):   # chain
        ax = ZA if k % 2 else XA
        torus(pc, (0, y - .045, 0), ax, .035, .008, 10, 4, IRON, C['iron'], ref=YA)
        y -= .07
    # crown and central column of graduated crystals
    lathe(pc, (0, 0, 0), YA, [(0, -.5), (.06, -.505), (.14, -.53), (.15, -.56), (.09, -.58), (.04, -.6)], 14, BRASS, lambda i, j, p: C['brass'] if i != 3 else C['brass_light'])
    beam(pc, (0, -.53, 0), (0, -1.5, 0), .05, .05, up=(0, 0, 1), mat=BRASS, col=C['brass_dark'], ch=.012)
    for k, (yy, h) in enumerate(((-.71, .08), (-.92, .115), (-1.17, .15), (-1.4, .1))):
        crystal(pc, Vector((0, yy, 0)), rot_up((0, 1, 0), k * .7, CORNER_UP), (h, h, h), [C['cr_milk'], C['cr_pale'], C['cr_rose'], C['cr_clear']][k],
                .9, seed=1410 + k, detail=2 if h > .08 else 1)
    lathe(pc, (0, 0, 0), YA, [(.035, -1.48), (.08, -1.5), (.09, -1.53), (.05, -1.56), (0, -1.57)], 12, BRASS, lambda i, j, p: C['brass'])
    # the finial: a long glowing drop under the bowl
    hull(pc, [(0, -1.58, 0), (.07, -1.66, 0), (-.07, -1.66, 0), (0, -1.66, .07), (0, -1.66, -.07), (0, -1.9, 0)], CRYSTAL,
         lambda p, n: mix(C['cr_clear'], C['cr_rose'], clamp((-1.6 - p.y) * 3)), mask=1.0)
    tiers = [(-.62, .42, 8, 2, .04), (-1.02, .85, 12, 3, .05), (-1.38, .55, 7, 2, .042)]
    for ti, (ty, r, n, drops, cs) in enumerate(tiers):
        torus(pc, (0, ty, 0), YA, r, .024, 40, 6, BRASS, C['brass'], ref=XA)
        torus(pc, (0, ty - .03, 0), YA, r, .01, 32, 4, BRASS, C['brass_dark'], ref=XA)
        for k in range(3 if ti != 1 else 4):   # spokes
            th = TAU * k / (3 if ti != 1 else 4) + ti * .5
            e = Vector((math.cos(th), 0, math.sin(th)))
            beam(pc, Vector((0, ty + (.08 if ti == 1 else 0), 0)) + e * .03, Vector((0, ty, 0)) + e * r, .022, .022, up=(0, 1, 0), mat=BRASS, col=C['brass'], ch=.006,
                 bow=(0, .07 if ti == 1 else .02, 0))
        for k in range(n):
            th = TAU * (k + .5 * ti) / n
            e = Vector((math.cos(th), 0, math.sin(th)))
            p = Vector((0, ty - .035, 0)) + e * r
            beam(pc, p, p - YA * .025, .008, .008, mat=BRASS, col=C['brass_dark'])
            yy = p.y - .03
            for dk in range(drops):
                h = cs * (1.0 if dk < drops - 1 else 1.25)
                col = [C['cr_clear'], C['cr_pale'], C['cr_milk'], C['cr_rose']][(k + dk + ti) % 4]
                crystal(pc, Vector((p.x, yy - h * 1.6, p.z)), rot_up((0, 1, 0), th, CORNER_UP), (h, h, h), col, .95, seed=1420 + ti * 100 + k * 5 + dk, detail=1 if dk == drops - 1 else 0)
                yy -= h * 3.25 + .006
            # a long pendant under the last drop
            L = .14 + .05 * ((k + ti) % 2)
            hull(pc, [(p.x, yy, p.z), (p.x + .035, yy - L * .35, p.z), (p.x - .035, yy - L * .35, p.z), (p.x, yy - L * .35, p.z + .035), (p.x, yy - L * .35, p.z - .035),
                      (p.x, yy - L, p.z)], CRYSTAL, lambda q, nn: mul(C['cr_clear'], 1.02 if nn.y > 0 else .92), mask=1.0)
            if ti == 1 and k % 2 == 0:   # candle cups with flames on the wide tier
                q = Vector((0, ty + .015, 0)) + e * r
                lathe(pc, q, YA, [(0, .045), (.03, .045), (.034, .03), (.02, 0), (0, -.005)], 10, BRASS, lambda i, j, pp: C['brass_light'])
                crystal(pc, q + YA * .085, Matrix.Rotation(th, 3, YA), (.025, .04, .025), C['cr_milk'], .9, seed=1490 + k, detail=1)
                lathe(pc, q + YA * .125, YA, [(0, .075), (.012, .045), (.016, .02), (.01, .004), (0, 0)], 8, GLOW, lambda i, j, pp: C['glow'], ao=0.0)
                pc.anchors.setdefault('flames', []).append([round(q.x, 3), round(q.y + .15, 3), round(q.z, 3)])
        if ti == 1:   # upright crystals crowning the wide ring between the candles
            for k in range(6):
                th = TAU * (k + .5) / 6 + .26
                q = Vector((math.cos(th) * r, ty + .055, math.sin(th) * r))
                crystal(pc, q, rot_up((0, 1, 0), th, CORNER_UP), (.035, .035, .035), [C['cr_rose'], C['cr_clear']][k % 2], .95, seed=1480 + k, detail=1)
        # festoons of small beads between drop points
        if ti < 2:
            for k in range(n):
                t0, t1 = TAU * (k + .5 * ti) / n, TAU * (k + 1 + .5 * ti) / n
                for b in range(1, 3):
                    f = b / 3; th = lerp(t0, t1, f); sag = .08 * math.sin(math.pi * f)
                    p = Vector((math.cos(th) * r, ty - .04 - sag, math.sin(th) * r))
                    hull(pc, [p + V(.017, 0, 0), p - V(.017, 0, 0), p + V(0, .02, 0), p - V(0, .02, 0), p + V(0, 0, .017), p - V(0, 0, .017)], CRYSTAL,
                         lambda q, nn: C['cr_clear'], mask=.95)
    return pc


# --- the relief: miners with a pick and a cart, the forge's hammer over an anvil in a starburst, a Saltback crab
def _c2(X, Y, c, r): return np.sqrt((X - c[0]) ** 2 + (Y - c[1]) ** 2) - r
def _seg2(X, Y, a, b, ra, rb=None):
    ax, ay = a; bx, by = b; px, py = X - ax, Y - ay; dx, dy = bx - ax, by - ay
    h = np.clip((px * dx + py * dy) / (dx * dx + dy * dy), 0, 1)
    r = ra if rb is None else ra + (rb - ra) * h
    return np.sqrt((px - dx * h) ** 2 + (py - dy * h) ** 2) - r
def _box2(X, Y, c, half, rot=0.0, rad=0.0):
    x, y = X - c[0], Y - c[1]
    if rot: x, y = x * math.cos(rot) + y * math.sin(rot), -x * math.sin(rot) + y * math.cos(rot)
    qx, qy = np.abs(x) - half[0] + rad, np.abs(y) - half[1] + rad
    return np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - rad
def _ell2(X, Y, c, r, rot=0.0):
    x, y = X - c[0], Y - c[1]
    if rot: x, y = x * math.cos(rot) + y * math.sin(rot), -x * math.sin(rot) + y * math.cos(rot)
    k0 = np.sqrt((x / r[0]) ** 2 + (y / r[1]) ** 2); k1 = np.sqrt((x / r[0] ** 2) ** 2 + (y / r[1] ** 2) ** 2)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-6)

RL_BG, RL_FRAME, RL_FIG, RL_FORGE, RL_STAR, RL_CRAB, RL_SHELL, RL_MTN, RL_CART, RL_GROUND = range(30, 40)
def relief_height(X, Y):
    H = np.full(X.shape, .1, np.float32); TG = np.full(X.shape, RL_BG, np.int16)
    def put(d, top, rad, tag, base=None):
        nonlocal H, TG
        t = np.clip(-d / rad, 0, 1); prof = 1 - (1 - t) ** 2
        b = .1 if base is None else base
        h = np.where(d < 0, b + (top - b) * prof, -1)
        TG = np.where(h > H + 1e-4, np.int16(tag), TG); H = np.maximum(H, h)
    # mountains with the mine's portal behind everything, very low
    peaks = [(-1.16, 1.02), (-.9, 1.32), (-.7, 1.16), (-.45, 1.4), (-.2, 1.12), (.55, 1.12), (.78, 1.34), (.98, 1.18), (1.16, 1.05)]
    ridge = np.interp(X, [p[0] for p in peaks], [p[1] for p in peaks])
    put(np.where(np.abs(X) < 1.16, np.maximum(Y - ridge, .96 - Y), 1), .125, .04, RL_MTN)
    put(_c2(X, Y, (.8, 1.42), .025), .13, .02, RL_FIG)           # a tiny goat on the peak (easter egg)
    put(_ell2(X, Y, (.8, 1.37), (.04, .022)), .135, .02, RL_FIG)
    put(_seg2(X, Y, (.83, 1.43), (.81, 1.47), .008), .135, .01, RL_FIG)
    # the starburst of the forge
    cx, cy = .1, .86; ang = np.arctan2(Y - cy, X - cx); rr = np.sqrt((X - cx) ** 2 + (Y - cy) ** 2)
    R = .2 + .2 * np.clip(np.cos(ang * 8), 0, 1) ** 3 + .1 * np.clip(np.cos(ang * 8 + math.pi), 0, 1) ** 4
    put(rr - R, .135, .05, RL_STAR)
    # ground line and rails
    put(_box2(X, Y, (0, .33), (1.16, .025)), .15, .02, RL_GROUND)
    # anvil
    put(_box2(X, Y, (.12, .42), (.12, .04), 0, .01), .2, .04, RL_FORGE)
    put(_box2(X, Y, (.12, .5), (.055, .06), 0, .01), .19, .04, RL_FORGE)
    put(_box2(X, Y, (.08, .6), (.2, .045), 0, .015), .21, .04, RL_FORGE)
    put(_seg2(X, Y, (.26, .6), (.44, .61), .045, .006), .2, .04, RL_FORGE)
    # the hammer striking
    put(_seg2(X, Y, (.04, .77), (.32, 1.02), .02), .2, .02, RL_FORGE)
    put(_box2(X, Y, (.02, .75), (.11, .055), -.73, .015), .22, .04, RL_FORGE)
    for k, (sx_, sy_) in enumerate(((-.18, .72), (-.12, .9), (.33, .7), (.27, .86), (-.05, 1.02))):
        put(_c2(X, Y, (sx_, sy_), .018 + .006 * (k % 2)), .17, .015, RL_STAR)
    # miner swinging a pick (left)
    mx = -.98
    put(_ell2(X, Y, (mx, .6), (.11, .15)), .19, .07, RL_FIG)
    put(_c2(X, Y, (mx + .01, .82), .08), .2, .06, RL_FIG)
    put(_ell2(X, Y, (mx + .03, .74), (.07, .075)), .205, .04, RL_FIG)
    put(_ell2(X, Y, (mx + .01, .88), (.085, .045)), .205, .03, RL_FORGE)       # cap
    for sx_ in (-1, 1):
        put(_seg2(X, Y, (mx + sx_ * .05, .47), (mx + sx_ * .075, .37), .045, .04), .18, .04, RL_FIG)
    put(_seg2(X, Y, (mx + .06, .68), (mx + .17, .93), .04, .035), .2, .035, RL_FIG)
    put(_seg2(X, Y, (mx + .16, .9), (mx + .3, 1.12), .017), .21, .015, RL_FORGE)
    put(_seg2(X, Y, (mx + .19, 1.19), (mx + .3, 1.12), .025, .014) * 1, .21, .02, RL_FORGE)
    put(_seg2(X, Y, (mx + .3, 1.12), (mx + .42, 1.03), .025, .008), .21, .02, RL_FORGE)
    # miner pushing the cart
    m2 = -.66
    put(_ell2(X, Y, (m2, .58), (.1, .14), -.35), .19, .07, RL_FIG)
    put(_c2(X, Y, (m2 + .07, .77), .075), .2, .06, RL_FIG)
    put(_ell2(X, Y, (m2 + .1, .7), (.06, .07)), .205, .04, RL_FIG)
    put(_ell2(X, Y, (m2 + .08, .83), (.08, .04), -.3), .205, .03, RL_FORGE)
    put(_seg2(X, Y, (m2 - .03, .47), (m2 - .1, .37), .045, .04), .18, .04, RL_FIG)
    put(_seg2(X, Y, (m2 + .04, .47), (m2 + .07, .37), .045, .04), .18, .04, RL_FIG)
    put(_seg2(X, Y, (m2 + .05, .63), (m2 + .19, .57), .038, .032), .2, .03, RL_FIG)
    # the cart, heaped with crystals
    put(_box2(X, Y, (-.37, .5), (.15, .09), 0, .02), .19, .05, RL_CART)
    for wx in (-.47, -.27):
        put(_c2(X, Y, (wx, .39), .05), .2, .04, RL_FORGE)
    for k, (hx, hy, hs) in enumerate(((-.46, .6, .045), (-.38, .62, .055), (-.29, .6, .045), (-.42, .67, .035), (-.33, .68, .04))):
        put(_box2(X, Y, (hx, hy), (hs, hs), .78 if k % 2 else .2, .005), .21 + .005 * k, .025, RL_SHELL)
    # Saltback crab (right), claws up
    put(_ell2(X, Y, (.85, .48), (.18, .09)), .19, .06, RL_CRAB)
    for k, (hx, hy, hs, rot) in enumerate(((.85, .62, .08, .78), (.97, .58, .055, .3), (.73, .58, .05, .5), (.9, .72, .04, .1))):
        put(_box2(X, Y, (hx, hy), (hs, hs), rot, .006), .19 + .01 * k, .03, RL_SHELL)
    for sx_ in (-1, 1):
        put(_seg2(X, Y, (.85 + sx_ * .1, .53), (.85 + sx_ * .2, .72), .028, .024), .2, .025, RL_CRAB)
        put(_ell2(X, Y, (.85 + sx_ * .22, .79), (.05, .075), sx_ * .3), .21, .03, RL_CRAB)
        put(_ell2(X, Y, (.85 + sx_ * .235, .855), (.012, .035), sx_ * .3), .1, .01, RL_BG, base=.1)   # pincer notch
        H = np.where(_ell2(X, Y, (.85 + sx_ * .235, .855), (.014, .04), sx_ * .3) < 0, .16, H)
        put(_seg2(X, Y, (.85 + sx_ * .04, .53), (.85 + sx_ * .05, .6), .012), .21, .01, RL_CRAB)
        put(_c2(X, Y, (.85 + sx_ * .05, .615), .022), .215, .015, RL_FIG)
        for k in range(3):
            put(_seg2(X, Y, (.85 + sx_ * (.1 + .03 * k), .43), (.85 + sx_ * (.2 + .05 * k), .36), .015, .01), .18, .015, RL_CRAB)
    # frame: outer moulding, inner bead, crystal rosettes at the corners
    out = np.maximum(np.abs(X) - 1.3, np.abs(Y - .85) - .85)
    inner = np.maximum(np.abs(X) - 1.18, np.abs(Y - .85) - .73)
    frame = np.maximum(out, -inner)
    t = np.clip(-frame / .06, 0, 1)
    hf = np.where(frame < 0, .17 + .05 * (1 - (1 - t) ** 2), -1)
    TG = np.where(hf > H, np.int16(RL_FRAME), TG); H = np.maximum(H, hf)
    bead = np.abs(inner - .015) - .012
    hb = np.where(bead < 0, .155 + .02 * np.sqrt(np.clip(-bead / .012, 0, 1)), -1)
    TG = np.where(hb > H, np.int16(RL_FRAME), TG); H = np.maximum(H, hb)
    for cx_, cy_ in ((-1.24, .06), (1.24, .06), (-1.24, 1.64), (1.24, 1.64)):
        d = _box2(X, Y, (cx_, cy_), (.05, .05), math.pi / 4, .004)
        hr = np.where(d < 0, .22 + .03 * np.clip(-d / .03, 0, 1), -1)
        TG = np.where(hr > H, np.int16(RL_SHELL), TG); H = np.maximum(H, hr)
    return H, TG

def decimate_mesh(V, faces, target, smooth=0, smooth_factor=.5, name='dec'):
    me = bpy.data.meshes.new(name + '_tmp')
    me.from_pydata([tuple(map(float, v)) for v in V], [], [tuple(int(i) for i in q) for q in faces])
    me.validate(); me.update()
    ob = bpy.data.objects.new(name + '_tmp', me); SC.collection.objects.link(ob)
    if smooth:
        sm = ob.modifiers.new('relax', 'SMOOTH'); sm.factor = smooth_factor; sm.iterations = smooth
    tri0 = sum(len(p.vertices) - 2 for p in me.polygons)
    dc = ob.modifiers.new('dec', 'DECIMATE'); dc.decimate_type = 'COLLAPSE'; dc.ratio = min(1.0, target / max(tri0, 1))
    dc.use_collapse_triangulate = True
    ob.modifiers.new('tri', 'TRIANGULATE')
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg); m2 = ev.to_mesh()
    verts = np.array([tuple(v.co) for v in m2.vertices], np.float32)
    tris = np.array([tuple(p.vertices) for p in m2.polygons], np.int64)
    ev.to_mesh_clear(); bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return verts, tris

def build_relief():
    pc = Piece('ChapelRelief', floor=False, reach=.25)
    step = .008
    xs = np.arange(-1.3, 1.3 + 1e-6, step); ys = np.arange(0, 1.7 + 1e-6, step)
    X, Y = np.meshgrid(xs, ys, indexing='ij')
    H, TG = relief_height(X, Y)
    nx, ny = X.shape
    Vg = np.stack([X, Y, H], -1).reshape(-1, 3)
    vid = np.arange(nx * ny).reshape(nx, ny)
    faces = [tuple(q) for q in np.stack([vid[:-1, :-1], vid[1:, :-1], vid[1:, 1:], vid[:-1, 1:]], -1).reshape(-1, 4)]
    ring = list(vid[:, 0]) + list(vid[-1, 1:]) + list(vid[::-1, -1][1:]) + list(vid[0, ::-1][1:-1])
    base = len(Vg); back = np.array([(Vg[i][0], Vg[i][1], 0.0) for i in ring])
    for k in range(len(ring)):
        k2 = (k + 1) % len(ring)
        faces.append((ring[k2], ring[k], base + k, base + k2))
    faces.append(tuple(base + k for k in range(len(ring)))[::-1])
    V, T = decimate_mesh(np.concatenate([Vg, back]), faces, 5600, name='relief')
    # fix winding: front faces must point +Z
    N = mesh_normals(V, T)
    tab = {RL_BG: C['salt_rose'], RL_FRAME: C['salt_carve2'], RL_FIG: C['salt_cream'], RL_FORGE: C['salt_carve'], RL_STAR: C['cr_coral'],
           RL_CRAB: mix(C['salt_rose'], C['cr_coral'], .5), RL_SHELL: C['cr_clear'], RL_MTN: mix(C['salt_rose'], C['salt_carve2'], .5),
           RL_CART: C['salt_shadow'], RL_GROUND: C['salt_carve2']}
    b0 = len(pc.P)
    for i, p in enumerate(V):
        x, y, z = map(float, p)
        ix = int(round((x + 1.3) / step)); iy = int(round(y / step))
        ix = min(max(ix, 0), nx - 1); iy = min(max(iy, 0), ny - 1)
        tag = int(TG[ix, iy]) if z > .05 else RL_FRAME
        base_c = tab.get(tag, C['salt_rose'])
        rel = clamp((z - .1) / .12)
        c, _ = carved_salt(Vector((x, y, z)), Vector(N[i]), base_c, .3, seed=1500, band=.18)
        if tag == RL_BG: c = mul(c, .85)
        m = .16 + .5 * rel + (.2 if tag in (RL_STAR, RL_SHELL) else 0)
        pc.v(Vector((x, y, z)), c, min(1.0, m))
    for t in T:
        ids = [b0 + int(i) for i in t]
        pc.f(ids, ROCK, True)
    return pc

# --- the carvers' bench: a salt table with salt-block candles, chisels, a mallet, a half-carved bust and a lunch
def build_bench():
    pc = Piece('CarversBench', reach=.4)
    rng = np.random.default_rng(1606)
    TH = .86
    for sx in (-1, 1):   # pedestal ends
        strata_box(pc, (sx * .68, .05, 0), (.2, .05, .34), rng, ch=.02, seed=60 + sx, base=C['salt_carve2'])
        strata_box(pc, (sx * .68, (TH - .06 + .1) / 2, 0), (.14, (TH - .06 - .1) / 2, .26), rng, ch=.03, seed=62 + sx, base=C['salt_carve'])
        strata_box(pc, (sx * .68, TH - .1, 0), (.18, .04, .3), rng, ch=.02, seed=64 + sx, base=C['salt_carve2'])
        crystal(pc, Vector((sx * .68, .45, .27)), Matrix.Rotation(math.pi / 4, 3, ZA), (.06, .06, .02), C['cr_rose'], .75, seed=66 + sx, detail=1)
    strata_box(pc, (0, .2, 0), (.56, .05, .12), rng, ch=.02, seed=67, base=C['salt_shadow'])     # footrest stretcher
    strata_box(pc, (0, TH - .04, 0), (.9, .04, .37), rng, ch=.025, seed=68, base=C['salt_cream'])   # the slab
    strata_box(pc, (0, TH - .12, .3), (.62, .045, .03), rng, ch=.012, seed=69, base=C['salt_rose'])  # front apron
    for k in range(5):
        crystal(pc, Vector((-.48 + .24 * k, TH - .12, .335)), Matrix.Rotation(math.pi / 4, 3, ZA), (.028, .028, .012), C['cr_milk'], .7, seed=70 + k, detail=1)
    # salt-block candles with flames
    for k, (x, z, hgt) in enumerate(((-.74, -.2, .2), (-.6, -.24, .14), (.72, -.22, .24), (.58, -.18, .12))):
        crystal(pc, Vector((x, TH + hgt / 2, z)), Matrix.Rotation(k * .7, 3, YA), (.055, hgt / 2, .055), [C['cr_pale'], C['cr_milk'], C['cr_rose'], C['cr_clear']][k],
                .85, seed=80 + k, detail=1)
        beam(pc, (x, TH + hgt, z), (x, TH + hgt + .02, z), .008, .008, mat=IRON, col=C['iron_dark'])
        lathe(pc, (x, TH + hgt + .015, z), YA, [(0, .09), (.016, .055), (.021, .025), (.013, .005), (0, 0)], 8, GLOW, lambda i, j, p: C['glow'], ao=0.0)
        pc.anchors.setdefault('flames', []).append([round(x, 3), round(TH + hgt + .05, 3), round(z, 3)])
    # chisels and a mallet
    for k, (x, z, a, L) in enumerate(((-.22, .18, .25, .26), (-.12, .2, .1, .22), (-.02, .17, -.05, .28))):
        d = Vector((math.sin(a), 0, -math.cos(a)))
        p0 = Vector((x, TH + .016, z))
        beam(pc, p0, p0 + d * .12, .022, .022, mat=TIMBER, col=C['timber_c'], ch=.005, segs=1, ring_caps=False)
        beam(pc, p0 + d * .12, p0 + d * .135, .026, .026, mat=BRASS, col=C['brass'], ch=.004)
        beam(pc, p0 + d * .135, p0 + d * L, .016, .008, mat=IRON, col=C['rivet'], ch=.002, taper=.6)
    m0 = Vector((.22, TH + .05, .08))
    beam(pc, m0 + Vector((-.06, 0, -.05)), m0 + Vector((.06, 0, .05)), .1, .1, mat=TIMBER, col=C['timber_c'], ch=.015, wear=.3, seed=5)
    beam(pc, m0, m0 + Vector((.18, -.03, -.17)), .028, .028, mat=TIMBER, col=C['timber_a'], ch=.007, ring_caps=False, wear=.2, seed=6)
    # the half-carved bust of Brann, still rough below the chest, chips round it
    bo = Vector((-.38, TH, -.08))
    strata_box(pc, bo + Vector((0, .07, 0)), (.11, .07, .1), rng, ch=.015, seed=71, base=C['salt_carve2'])
    bs = .2
    def bust(P):
        Pq = (P - _np((bo.x, bo.y + .1, bo.z))) / bs + _np((0, .62 + .9, 0))
        F = brann_field(Pq, .62)
        F.d = np.maximum(F.d, (.62 + .9) - Pq[:, 1]) * bs
        F.add(sd_rbox(P, (bo.x, bo.y + .14, bo.z), (.1, .05, .09), None, .02), BR_BODY, .02)
        return F
    V, T = sculpt_mesh(bust, (bo.x - .2, bo.y + .08, bo.z - .15), (bo.x + .2, bo.y + .3, bo.z + .15), .005, 560, name='bust')
    table = {BR_BODY: (C['salt_carve'], (.2, .6), 's'), BR_BEARD: (C['salt_cream'], (.2, .7), 's'), BR_APRON: (C['salt_rose'], (.2, .6), 's'),
             BR_BOOT: (C['salt_shadow'], (.1, .4), 's'), BR_SKIN: (C['cr_blush'], (.2, .65), 's'), BR_HAIR: (C['salt_carve2'], (.2, .55), 's'),
             BR_BELT: (C['salt_shadow'], (.12, .45), 's'), 0: (C['salt_carve'], (.2, .6), 's')}
    add_sculpt(pc, V, T, bust, shade_regions(table, 1610))
    for k in range(6):
        th = rng.uniform(0, TAU); r = rng.uniform(.14, .24); s = rng.uniform(.012, .022)
        crystal(pc, bo + Vector((math.cos(th) * r, s * .8, math.sin(th) * r * .7)), Matrix.Rotation(th, 3, YA), (s, s * .7, s), C['salt_cream'], .4, seed=90 + k, detail=0)
    # lunch: a brass plate with a salted pretzel and a tin mug
    pl = Vector((.5, TH, .1))
    lathe(pc, pl, YA, [(0, .012), (.1, .012), (.12, .02), (.125, .016), (.1, .004), (0, 0)], 16, BRASS, lambda i, j, p: C['brass_light'] if i == 2 else C['brass'])
    def pretzel(P):
        Q = (P - _np((pl.x, pl.y + .03, pl.z))) / .085
        F = Field(Q)
        F.add(sd_chain(Q, bezier((-.05, 0, -.55), (-1.15, 0, -.2), (-.5, 0, .55), 7) + bezier((-.5, 0, .55), (.1, 0, .45), (.5, 0, -.5), 6)[1:], [.17] * 12), 0, .05)
        F.add(sd_chain(Q, bezier((.05, 0, -.55), (1.15, 0, -.2), (.5, 0, .55), 7) + bezier((.5, 0, .55), (-.1, 0, .45), (-.5, 0, -.5), 6)[1:], [.17] * 12), 0, .05)
        F.d = F.d * .085
        return F
    V, T = sculpt_mesh(pretzel, (pl.x - .13, pl.y + .005, pl.z - .1), (pl.x + .13, pl.y + .06, pl.z + .1), .004, 300, name='pretzel')
    add_sculpt(pc, V, T, pretzel, lambda p, n, tag, th: (mul(lin('9a5a26'), .9 + .2 * fbm((p.x * 60, p.y * 60, p.z * 60), 3, 2)), 0.0), mat=TIMBER)
    for k in range(9):   # salt on the pretzel
        th = TAU * k / 9; p = pl + Vector((math.cos(th) * .055, .05, math.sin(th) * .045))
        crystal(pc, p, Matrix.Rotation(th, 3, YA), (.006, .006, .006), C['salt_cream'], .5, seed=95 + k, detail=0)
    mg = Vector((.66, TH, -.04))
    lathe(pc, mg, YA, [(0, .13), (.05, .13), (.05, .125), (.045, .12), (.046, .01), (.05, 0), (0, 0)], 12, BRASS, lambda i, j, p: C['brass_dark'] if i >= 4 else C['brass'])
    torus(pc, mg + Vector((.065, .07, 0)), ZA, .03, .007, 10, 4, BRASS, C['brass'], a0=-math.pi / 2, a1=math.pi / 2, ref=-YA)
    return pc

# --- formations
def shade_formation(base_lo, base_hi, y0, y1, seed, glow=(.2, .8)):
    def f(p, n, tag, thick):
        t = clamp((p.y - y0) / (y1 - y0))
        base = mix(base_lo, base_hi, t)
        return carved_salt(p, n, base, thick, seed, glow=glow, thin=(.25, .02), band=.24, grain=.08)
    return f

def spire_field(P):
    F = Field(P)
    levels = [(0, .34, .0, 0), (.22, .3, .04, .4), (.45, .25, -.03, 1.1), (.68, .2, .05, 2.0), (.9, .15, .0, 2.9), (1.1, .11, -.03, 3.6), (1.28, .075, .02, 4.4)]
    for k, (y, r, off, a) in enumerate(levels):
        c = (off * math.cos(a), y + .1, off * math.sin(a))
        F.add(sd_ellipsoid(P, c, (r * 1.05, .16, r)), 0, .12)
        F.add(sd_ellipsoid(P, (c[0], y + .02, c[2]), (r * 1.22, .045, r * 1.18)), 1, .05)   # rimstone ledges
    F.add(sd_capsule(P, (.02, 1.3, 0), (0, 1.47, .01), .07, .035), 0, .06)
    F.clip(-P[:, 1] - .02)
    return F

def build_spire():
    pc = Piece('SaltSpire', reach=.4)
    rng = np.random.default_rng(1707)
    V, T = sculpt_mesh(spire_field, (-.5, -.04, -.5), (.5, 1.55, .5), .011, 2300, name='spire')
    add_sculpt(pc, V, T, spire_field, shade_formation(C['salt_rose'], C['salt_cream'], 0, 1.5, 1700), mat=ROCK)
    for k in range(5):
        th = TAU * k / 5 + .3; r = .36 + .05 * (k % 2); s = .04 + .015 * (k % 3)
        d = Vector((math.cos(th) * .7, 1, math.sin(th) * .7))
        crystal(pc, Vector((math.cos(th) * r, s * .6, math.sin(th) * r)), rot_up(d, th, CORNER_UP if k % 2 else YA), (s, s, s),
                [C['cr_pale'], C['cr_milk'], C['cr_rose']][k % 3], .65, seed=1710 + k, detail=1)
    return pc

def stalactite_field(P):
    F = Field(P)
    F.add(sd_ellipsoid(P, (0, -.0, 0), (.34, .08, .28)), 0, 0)
    for k in range(5):
        a = TAU * k / 5 + .4
        F.add(sd_ellipsoid(P, (math.cos(a) * .25, -.04, math.sin(a) * .2), (.13, .07, .12)), 0, .06)
    spikes = [(0, 0, 1.2, .1), (.2, .1, .82, .08), (-.2, .08, .7, .075), (.12, -.17, .55, .065), (-.14, -.16, .42, .06), (.3, -.06, .32, .05), (-.3, .14, .28, .045)]
    for k, (x, z, L, r) in enumerate(spikes):
        F.add(sd_capsule(P, (x, -.05, z), (x * 1.05, -L, z * 1.05), r, .014), 0, .06)
        for j in range(1, 3):   # drip nodes along the icicle
            t = j / 3 + .07 * (k % 2)
            F.add(sd_sphere(P, (x * (1 + .05 * t), -.05 - (L - .05) * t, z * (1 + .05 * t)), r * (1 - t) * 1.25 + .01), 0, .05)
        F.add(sd_sphere(P, (x * 1.05, -L - .005, z * 1.05), .022), 1, .02)
    F.clip(P[:, 1] - .0)
    return F

def build_stalactites():
    pc = Piece('Stalactites', floor=False, reach=.35)
    V, T = sculpt_mesh(stalactite_field, (-.5, -1.27, -.42), (.5, .02, .42), .009, 2600, name='stal')
    add_sculpt(pc, V, T, stalactite_field, shade_formation(C['cr_clear'], C['salt_rose'], -1.2, 0, 1800, glow=(.3, .95)), mat=CRYSTAL,
               mat_fn=lambda tag: CRYSTAL)
    return pc

def drapery_field(P):
    X, Y, Z = P[:, 0], P[:, 1], P[:, 2]
    depth = np.clip(-Y / 1.5, 0, 1)
    zc = (.05 + .11 * depth) * np.sin(X * 7.5 + 1.1 * np.sin(X * 2.3) + .6) + .04 * np.sin(X * 17 + 1.0) * depth
    thick = .055 - .03 * depth
    d_sheet = (np.abs(Z - zc) - thick) * .7
    bottom = -1.32 - .11 * np.cos(X * 7.5 + 1.1 * np.sin(X * 2.3) + .6 - math.pi) - .06 * np.abs(np.sin(X * 15))
    edge = .9 - .12 * depth - .04 * np.sin(Y * 6)
    d = np.maximum(d_sheet, np.maximum(bottom - Y, np.abs(X) - edge))
    F = Field(P); F.d = d.astype(np.float32)
    F.add(sd_ellipsoid(P, (0, .0, 0), (1.0, .14, .22)), 1, .1)
    for k in range(9):   # drip tips at the scallops
        x = -.8 + .2 * k
        b = -1.32 - .11 * math.cos(x * 7.5 + 1.1 * math.sin(x * 2.3) + .6 - math.pi) - .06 * abs(math.sin(x * 15))
        zz = (.16) * math.sin(x * 7.5 + 1.1 * math.sin(x * 2.3) + .6) + .04 * math.sin(x * 17 + 1.0)
        F.add(sd_capsule(P, (x, b + .05, zz), (x, b - .1 - .04 * (k % 3), zz), .025, .008), 2, .04)
    F.clip(P[:, 1] - .02)
    return F

def build_drapery():
    pc = Piece('SaltDrapery', floor=False, reach=.3)
    def shade(p, n, tag, thick):
        # rose where it meets the roof, milky toward the drip edge; broad soft variation only, so the sparse,
        # fold-following triangles never smear a fine stripe pattern
        t = smoothstep(-.1, -1.45, p.y)
        base = mix(C['salt_rose'], C['salt_cream'], t * .85 + .15 * fbm((p.x * 1.2, p.y * .8, 0), 3, 2))
        if tag == 1: base = C['salt_carve2']
        return carved_salt(p, n, base, thick, 1900, glow=(.25, .95), thin=(.16, .02), band=.08, grain=.04)
    V, T = sculpt_mesh(drapery_field, (-1.0, -1.62, -.28), (1.0, .14, .28), .009, 2950, name='drapery')
    add_sculpt(pc, V, T, drapery_field, shade, mat=CRYSTAL)
    return pc

CHAPEL_FRONT = ('StatueBrann', 'StatueCrab', 'StatueGoat', 'ChapelRelief', 'CarversBench', 'SaltDrapery')
BUILDERS = [('MinePortal', build_portal), ('TimberSet', build_timberset), ('RailStraight', build_rail), ('MineCart', build_cart),
            ('Lantern', build_lantern), ('SaltCluster', build_cluster), ('SaltClusterSmall', build_cluster_small),
            ('FiredampVent', build_vent), ('RubblePile', build_rubble), ('BrineRim', build_brine),
            ('StatueBrann', build_statue_brann), ('StatueCrab', build_statue_crab), ('StatueGoat', build_statue_goat),
            ('SaltChandelier', build_chandelier), ('ChapelRelief', build_relief), ('CarversBench', build_bench),
            ('SaltSpire', build_spire), ('Stalactites', build_stalactites), ('SaltDrapery', build_drapery)]
BUDGET = {'TimberSet': 1500, 'RailStraight': 640, 'SaltClusterSmall': 700}

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
for name, rough, metal in (('Timber', .74, 0), ('Iron', .44, .45), ('Brass', .3, .92), ('SaltRock', .82, 0), ('SaltCrystal', .26, 0), ('LanternGlow', .4, 0)):
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
    l0, l1, lc = [], [], []
    for fi, f in enumerate(pc.F):
        cmf, mkf = pc.FCM[fi], pc.FMK[fi]
        for k, vi in enumerate(f):
            l0.extend(pc.FUV[fi][k]); l1.extend((clamp(pc.M[vi] if mkf is None else mkf[k]), 0.0))
            c = pc.C[vi]
            if cmf is not None:
                m = cmf[k]; m = (m, m, m) if isinstance(m, (int, float)) else m
                c = (min(1.0, c[0] * m[0]), min(1.0, c[1] * m[1]), min(1.0, c[2] * m[2]))
            lc.extend((*c, 1.0))
    uv0.data.foreach_set('uv', l0); uv1.data.foreach_set('uv', l1)
    ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
    ca.data.foreach_set('color', np.array(lc, np.float32))
    me.color_attributes.active_color = ca
    try: me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except Exception: pass
    me.validate(clean_customdata=False); me.update()
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
            if 'TEXCOORD_0' in at and mname != 'Timber':
                # only Timber samples a texture: the constant UVs elsewhere are dead weight. TEXCOORD_1 (the glow mask)
                # keeps its slot name, so loaders still see it as uv1.
                if 'TEXCOORD_1' in at: at['TEXCOORD_0'] = at.pop('TEXCOORD_1'); at['TEXCOORD_1'] = at['TEXCOORD_0']
                else: del at['TEXCOORD_0']
            conv[at['NORMAL']] = 'normal'; conv[at['COLOR_0']] = 'colour16' if mname in ('Timber', 'Iron', 'Brass') else 'colour8'
            if 'TEXCOORD_1' in at: conv[at['TEXCOORD_1']] = 'unorm2'
    # drop accessors nothing references any more
    used = sorted({a for m in doc['meshes'] for p in m['primitives'] for a in list(p['attributes'].values()) + [p['indices']]})
    amap = {a: i for i, a in enumerate(used)}
    old_acc = doc['accessors']; doc['accessors'] = [old_acc[a] for a in used]
    for m in doc['meshes']:
        for p in m['primitives']:
            p['attributes'] = {k: amap[a] for k, a in p['attributes'].items()}; p['indices'] = amap[p['indices']]
    conv = {amap[a]: k for a, k in conv.items() if a in amap}
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
missing = {m for m in MAT_NAMES} - set(REPORT['materials'])
if not wanted: assert not missing, missing
REPORT['seconds'] = round(time.time() - T0, 1)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps({k: (v['triangles'], v['vertices']) for k, v in INFO.items()}), REPORT['bytes'], total_tris, flush=True)
assert total_tris <= 80000, total_tris
assert REPORT['bytes'] <= 2.4 * 1024 * 1024, REPORT['bytes']

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
        elif not PCS[name].floor:   # hanging pieces: lift them clear of the floor
            lift = .25 - INFO[name]['bbox_min'][1]
            OBJS[name].location = to_b((0, lift, 0)); c = c + Vector((0, lift, 0))
        studio(c, r)
        vw = tuple(float(x) for x in arg('--view').split(',')) if arg('--view') else (1.0, .72, 1.45)
        shot(name, c, r, view=vw)
        if name in ('SaltCluster', 'MinePortal', 'MineCart') + CHAPEL_FRONT and want(name + '-front'):
            shot(name + '-front', c, r, view=(.15, .25, 1.0))
        OBJS[name].location = (0, 0, 0)
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

    if want('chapel-glow') and all(n in OBJS for n in CHAPEL_FRONT):
        show([])
        for o in (key, fill, rim): o.hide_render = False
        wall = bpy.data.meshes.new('wall')
        wv = []
        for i in range(25):
            for j in range(13):
                x, y = -7 + i * .58, -.2 + j * .5
                wv.append(to_b((x, y, -3.25 - .25 * vnoise(x * 1.3, y * 1.3, 0, 9) - .08 * math.sin(y * 4))))
        wf = [(i * 13 + j, (i + 1) * 13 + j, (i + 1) * 13 + j + 1, i * 13 + j + 1) for i in range(24) for j in range(12)]
        wall.from_pydata(wv, [], wf); wo = bpy.data.objects.new('wall', wall); SC.collection.objects.link(wo); copies.append(wo)
        wm = bpy.data.materials.new('wallm'); wnt, wb = principled(wm); wb.inputs['Base Color'].default_value = (.32, .13, .11, 1); wb.inputs['Roughness'].default_value = .9
        wall.materials.append(wm)
        place('ChapelRelief', (0, .95, -3.2)); place('CarversBench', (0, 0, -2.45))
        place('StatueBrann', (-2.5, 0, -1.7), .45); place('StatueGoat', (2.6, 0, -1.5), -.6); place('StatueCrab', (1.4, 0, .4), -.35)
        place('SaltChandelier', (0, 4.5, -.9)); place('SaltSpire', (-4.1, 0, -2.5), .3); place('SaltSpire', (4.3, 0, -2.6), 1.9)
        place('Stalactites', (-1.6, 4.9, -2.6)); place('Stalactites', (2.2, 4.9, -2.2), 1.1); place('SaltDrapery', (4.0, 4.8, -2.9), -.3)
        place('SaltClusterSmall', (-1.2, 0, .6), .4); place('SaltCluster', (-4.2, 0, -.6), .8); place('Lantern', (-1.3, 2.4, -1.2))
        studio((0, 1.6, -1.0), 6.0, dark=True)
        GLOW_VALUES['SaltCrystal'].outputs[0].default_value = 2.4; GLOW_VALUES['SaltRock'].outputs[0].default_value = 1.1
        GLOW_VALUES['LanternGlow'].outputs[0].default_value = 12.0
        for nm, pos, e in (('chand', (0, 3.2, -.9), 110), ('lamp', (-1.3, 1.95, -1.2), 35), ('candles', (0, 1.3, -2.3), 18)):
            pl = bpy.data.lights.new(nm, 'POINT'); pl.energy = e; pl.color = (1.0, .66, .36); pl.shadow_soft_size = .1
            plo = bpy.data.objects.new(nm, pl); SC.collection.objects.link(plo); plo.location = to_b(pos); copies.append(plo)
        shot('chapel-glow', (0, 1.7, -1.4), 5.0, view=(.1, .2, 1.0), lens=30)
        clear()

if RENDER: render_all()
print('SALT_MINE_KIT_OK')
