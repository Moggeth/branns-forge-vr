"""Saltback, the salt-mine hermit crab - reproducible Blender (bpy 4.5) builder.

Run:  python3.11 build_saltback_crab.py -- --out ../../public/assets/saltback-crab.glb
      python3.11 build_saltback_crab.py -- --out out/saltback-crab.glb --render out/review   (Cycles review set)
      (pip install bpy==4.5.* numpy pillow)
Prints SALTBACK_BUILD_OK as its last line on success. Blender can exit 0 after a Python traceback, so check for it.

A hermit crab from the brine pools of a pink rock-salt mine that wears a cluster of halite cubes for a shell. Signature
reads: (1) the salt-lamp shell - chunky cubic and stepped "hopper" halite crystals in milky white, pale pink and rose,
glowing faintly from within; (2) the lopsided claws - one oversized crusher (right, -X) and one small nimble picker
(left, +X); (3) tall googly stalk eyes with big glossy black pupils and catch-lights; (4) a squat coral-orange body
with cream speckles, a pale belly and six orange legs with cream tips.

Everything is authored in the game frame (X lateral (+X = the crab's left), Y up, Z forward, metres) and converted to
Blender's Z-up on the way in. Every bone's rest orientation is the identity, so in the GLB each joint node's rest
rotation is identity and a pose is just a rotation about the model's own axes at the joint's head.
One skinned mesh, three materials (CrabShell, CrabBody, CrabEye), 23 bones, rigid weights (1-2 bones per vertex).
COLOR_0 (RGBA, unsigned byte normalized): rgb = authored colour (linear) with baked ambient occlusion multiplied in;
alpha = the salt-lamp glow mask on CrabShell (1 at crystal cores and hopper terraces, 0 at edges and chamfers) and 1.0 on
CrabBody and CrabEye. No texture coordinates, no textures.
Clips (30 fps samples, plus an exact key at the Pinch hit 0.35 s): Idle, Scuttle, Pinch, Hurt, Death, Emerge. The clips
are written into the GLB from the exact samples after cross-checking them against Blender's own export of the baked
actions. Repacked with KHR_mesh_quantization (byte normals, colours, weights; 16-bit rotation keys).
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
import bpy, math, json, time, struct
import numpy as np
from mathutils import Vector, Quaternion, Matrix
from mathutils.bvhtree import BVHTree

T0 = time.time()
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'saltback-crab.glb'))
RENDER = arg('--render')
TAU = math.tau
FPS = 30
RNG = np.random.default_rng(20261016)

def clamp01(x): return min(1.0, max(0.0, x))
def smoothstep(a, b, x):
    t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def lin(h): return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))
def mix(c1, c2, t): return tuple(a + (b - a) * t for a, b in zip(c1, c2))
def mul(c, k): return tuple(a * k for a in c)
def to_b(p): return Vector((p[0], -p[2], p[1]))   # game (x, y up, z fwd) -> Blender (x, y back, z up)
def V(*a): return Vector(a)

C = {k: lin(v) for k, v in dict(
    coral='f2622a', coral_deep='d4471c', belly='ffc58e', cream='ffe9c4', leg='ee5f28', leg_dark='c9431a', tip='fff0d4',
    joint='ff9a5e', stalk='f26a30', claw_tip='fff3de', claw_dark='c23d17', mouth='5a1a14',
    salt_white='fbeeec', salt_pink='f6bcc6', salt_rose='ec8fa3', salt_deep='d2586f',
    eye_white='faf8f2', pupil='0a0910', catch='ffffff').items()}

# ===================================================================== geometry accumulator
class Geo:
    def __init__(self):
        self.P, self.col, self.W, self.uv1, self.aok, self.part = [], [], [], [], [], []
        self.F, self.FM, self.FS = [], [], []
    def v(self, p, col, w, mask=(0., 0.), aok=1.0, part=''):
        self.P.append(Vector(p)); self.col.append(tuple(col)); self.W.append(dict(w)); self.uv1.append(mask)
        self.aok.append(aok); self.part.append(part)
        return len(self.P) - 1
    def f(self, idx, mat, smooth=True):
        self.F.append(list(idx)); self.FM.append(mat); self.FS.append(smooth)
G = Geo()
SHELL, BODY, EYE = 0, 1, 2

def face_normal(ps):
    n = Vector()
    for k in range(len(ps)): n += ps[k].cross(ps[(k + 1) % len(ps)])
    return n
def orient_part(face_start, ref_fn):
    """Flip the faces added since face_start so they face away from ref_fn(face centre) (a point inside the part)."""
    score = 0.0
    for fi in range(face_start, len(G.F)):
        ps = [G.P[i] for i in G.F[fi]]; c = sum(ps, Vector()) / len(ps)
        score += face_normal(ps).dot(c - ref_fn(c))
    if score < 0:
        for fi in range(face_start, len(G.F)): G.F[fi] = G.F[fi][::-1]

def nearest_on_poly(q, pts):
    best, bd = pts[0], 1e9
    for a, b in zip(pts[:-1], pts[1:]):
        ab = b - a; t = clamp01((q - a).dot(ab) / max(ab.length_squared, 1e-12)); p = a + ab * t
        d = (q - p).length
        if d < bd: best, bd = p, d
    return best

def bezier(p0, p1, p2, n):
    return [p0 * (1 - t) ** 2 + p1 * 2 * (1 - t) * t + p2 * t * t for t in np.linspace(0, 1, n)]

def surface(fn, nu, thetas, col_fn, w_fn, mat, part, ref, aok=1.0, mask=(0., 0.)):
    """A closed lat-long surface: fn(theta, phi) -> point, poles at theta 0 and pi."""
    fs = len(G.F)
    top = fn(0.0, 0.0); bot = fn(math.pi, 0.0)
    it = G.v(top, col_fn(top), w_fn(top), mask, aok, part)
    rows = []
    for th in thetas:
        row = []
        for j in range(nu):
            p = fn(th, TAU * j / nu); row.append(G.v(p, col_fn(p), w_fn(p), mask, aok, part))
        rows.append(row)
    ib = G.v(bot, col_fn(bot), w_fn(bot), mask, aok, part)
    for j in range(nu):
        G.f([it, rows[0][j], rows[0][(j + 1) % nu]], mat)
        G.f([ib, rows[-1][(j + 1) % nu], rows[-1][j]], mat)
    for i in range(len(rows) - 1):
        for j in range(nu):
            j2 = (j + 1) % nu
            G.f([rows[i][j], rows[i + 1][j], rows[i + 1][j2], rows[i][j2]], mat)
    orient_part(fs, lambda c: ref)

def tube(path, rad_fn, n, col_fn, w_fn, mat, part, up=V(0, 1, 0), aspect=1.0, tip=True, nring=None, aok=1.0):
    """A loft along a polyline (resampled to nring points); rad_fn(s) radius, aspect = side/up radius ratio; tip closes
    the end in a point. Parallel-transport frames, so it never twists."""
    pts = [Vector(p) for p in path]
    if nring and nring != len(pts):
        L = [0.0]
        for a, b in zip(pts[:-1], pts[1:]): L.append(L[-1] + (b - a).length)
        out = []
        for s in np.linspace(0, L[-1], nring):
            k = min(int(np.searchsorted(L, s, side='right')) - 1, len(pts) - 2)
            t = (s - L[k]) / max(L[k + 1] - L[k], 1e-9); out.append(pts[k].lerp(pts[k + 1], t))
        pts = out
    m = len(pts)
    T = []
    for i in range(m):
        t = pts[min(i + 1, m - 1)] - pts[max(i - 1, 0)]; T.append(t.normalized())
    side = T[0].cross(up)
    if side.length < 1e-4: side = T[0].cross(V(1, 0, 0))
    side.normalize()
    fs = len(G.F); rows = []
    for i in range(m):
        if i:
            side = side - T[i] * side.dot(T[i]); side.normalize()
        upv = side.cross(T[i]).normalized()
        s = i / (m - 1)
        if tip and i == m - 1:
            rows.append([G.v(pts[i], col_fn(s, 0, pts[i]), w_fn(s, pts[i]), (0, 0), aok, part)]); continue
        r = rad_fn(s); row = []
        for k in range(n):
            a = TAU * k / n
            p = pts[i] + side * (math.cos(a) * r * aspect) + upv * (math.sin(a) * r)
            row.append(G.v(p, col_fn(s, a, p), w_fn(s, p), (0, 0), aok, part))
        rows.append(row)
    for i in range(m - 1):
        a, b = rows[i], rows[i + 1]
        for k in range(n):
            k2 = (k + 1) % n
            if len(b) == 1: G.f([a[k], a[k2], b[0]], mat)
            else: G.f([a[k], a[k2], b[k2], b[k]], mat)
    orient_part(fs, lambda c: nearest_on_poly(c, pts))
    return pts

def speckle_field(centres):
    def f(p):
        best = 0.0
        for c, r in centres:
            d = (p - c).length
            if d < r: best = max(best, 1 - smoothstep(r * .2, r, d))
        return best
    return f

# ===================================================================== bones (game frame); heads only, every rest orientation identity
BONES = {}   # name: (head, parent)
BODY_C = V(0, .165, 0)
BONES['Root'] = (V(0, 0, 0), None)
BONES['Body'] = (BODY_C, 'Root')
BONES['Shell'] = (V(0, .27, -.095), 'Body')
EYE_BASE = {'L': V(.046, .235, .135), 'R': V(-.046, .235, .135)}
EYE_C = {'L': V(.078, .405, .158), 'R': V(-.078, .405, .158)}     # eyeball centres
EYE_R = .056
PUPIL_DIR = {'L': V(.30, .06, 1).normalized(), 'R': V(-.16, .12, 1).normalized()}   # a touch googly
for s in 'LR': BONES['Eye' + s] = (EYE_BASE[s], 'Body')
CLAW = {
    'R': dict(S=V(-.10, .15, .11), E=V(-.24, .19, .175), W=V(-.27, .215, .375), palm=(.124, .1, .077), finger=.14, r1=.04),
    'L': dict(S=V(.10, .145, .115), E=V(.182, .165, .18), W=V(.204, .17, .27), palm=(.052, .039, .031), finger=.066, r1=.022),
}
for s, c in CLAW.items():
    d = (c['W'] - c['E']).normalized(); hz = c['palm'][1]
    c['d'] = d; c['side'] = d.cross(V(0, 1, 0)).normalized()
    c['up'] = c['side'].cross(d).normalized()
    c['hinge'] = c['W'] + c['up'] * hz * .42 - d * hz * .1
    c['fixed'] = c['W'] - c['up'] * hz * .30 - d * hz * .1
    BONES['Claw%s1' % s] = (c['S'], 'Body')
    BONES['Claw%s2' % s] = (c['E'], 'Claw%s1' % s)
    BONES['Pincer%s' % s] = (c['hinge'], 'Claw%s2' % s)
LEG_Z = [.03, -.05, -.13]
LEG_SPLAY = [math.radians(26), math.radians(-2), math.radians(-30)]
LEGS = {}
for s, sg in (('L', 1), ('R', -1)):
    for i in range(3):
        hip = V(sg * .135, .145, LEG_Z[i])
        h = V(sg * math.cos(LEG_SPLAY[i]), 0, math.sin(LEG_SPLAY[i]))
        knee = hip + h * .125 + V(0, .095, 0)
        tip = knee + h * .1; tip.y = 0.0
        name = 'Leg%s%d' % (s, i + 1)
        LEGS[name] = dict(hip=hip, knee=knee, tip=tip, h=h, sg=sg)
        BONES[name + 'A'] = (hip, 'Body'); BONES[name + 'B'] = (knee, name + 'A')

# ===================================================================== body: squat rounded carapace
BODY_AX = (.168, .098, .084, .172, .205)   # half width, top, bottom, front, back
def body_point(th, ph):
    """theta from the top pole, phi round the vertical; a soft superellipsoid, broad at the front, flat underneath."""
    st, ct = math.sin(th), math.cos(th)
    cp, sp = math.cos(ph), math.sin(ph)
    e = .82                                   # <1 = boxier than an ellipse
    f = lambda v: math.copysign(abs(v) ** e, v)
    x, y, z = f(st) * f(cp), f(ct), f(st) * f(sp)
    hw, top, bot, fr, bk = BODY_AX
    zz = z * (fr if z > 0 else bk)
    w = hw * (1 + .06 * zz / fr) * (1 - .1 * max(0, -zz / bk) ** 2)
    yy = y * (top if y > 0 else bot)
    yy += .018 * math.exp(-((zz - .06) / .08) ** 2) * max(0, y)   # a soft brow where the eyes sit
    return BODY_C + V(x * w, yy, zz)
def body_normal(p):
    q = p - BODY_C; hw, top, bot, fr, bk = BODY_AX
    return V(q.x / hw ** 2, q.y / (top if q.y > 0 else bot) ** 2, q.z / (fr if q.z > 0 else bk) ** 2).normalized()

def scatter_on(fn, n, seed, th_range=(0, math.pi), ph_range=(0, TAU), r=(.011, .02)):
    rr = np.random.default_rng(seed); out = []
    for _ in range(n):
        th = math.acos(lerp(math.cos(th_range[0]), math.cos(th_range[1]), rr.random()))
        out.append((fn(th, lerp(ph_range[0], ph_range[1], rr.random())), lerp(r[0], r[1], rr.random())))
    return out
BODY_SPECK = speckle_field(scatter_on(body_point, 26, 7, (.35, 1.6), r=(.026, .036)))
def body_col(p):
    n = body_normal(p)
    col = mix(C['belly'], C['coral'], smoothstep(-.55, .05, n.y))
    col = mix(col, C['coral_deep'], smoothstep(.55, 1.0, n.y) * .35)
    return mix(col, C['cream'], BODY_SPECK(p) * smoothstep(-.3, .1, n.y) * .6)

def build_body():
    ths = [math.pi * (i / 24) ** 1.0 for i in range(1, 24)]
    fs = len(G.F)
    surface(body_point, 44, ths, body_col, lambda p: {'Body': 1}, BODY, 'body', BODY_C)
    # a small happy smile under the eye stalks: a thin dark lip tube laid on the front of the carapace
    tri = []
    for f in G.F[fs:]:
        for k in range(1, len(f) - 1): tri.append((f[0], f[k], f[k + 1]))
    bv = BVHTree.FromPolygons([tuple(p) for p in G.P], tri, all_triangles=True)
    pts = []
    for x in np.linspace(-.036, .036, 9):
        y = .178 + 9.0 * x * x
        hit = bv.ray_cast(Vector((x, y, .4)), Vector((0, 0, -1)), 1.0)
        pts.append(hit[0] + hit[1] * .002)
    tube(pts, lambda t: .0042 * (.55 + .45 * math.sin(math.pi * t)) + .0015, 6, lambda t, a, p: C['mouth'], lambda t, p: {'Body': 1},
         BODY, 'mouth', up=V(0, 0, 1), tip=False, aok=.3)

# ===================================================================== eyes: tall stalks, googly glossy eyeballs
def build_eyes():
    for s, sg in (('L', 1), ('R', -1)):
        bone = 'Eye' + s
        base, top = EYE_BASE[s] - V(sg * .006, .02, .01), EYE_C[s]
        mid = base.lerp(top, .5) + V(sg * -.008, 0, -.01)
        path = bezier(base, mid, top, 9)
        def wt(t, p, bone=bone): return {'Body': 1 - smoothstep(.0, .2, t), bone: smoothstep(.0, .2, t)}
        def colf(t, a, p): return mix(C['stalk'], C['cream'], .25 * smoothstep(.55, .95, t))
        tube(path, lambda t: lerp(.021, .015, t) + .006 * math.exp(-((t - .82) / .08) ** 2), 9, colf,
             wt, BODY, 'stalk', tip=False)
        # eyeball: poles along the pupil direction so the pupil edge follows a ring (crisp)
        d = PUPIL_DIR[s]; u = d.cross(V(0, 1, 0)).normalized(); w = u.cross(d).normalized()
        c = EYE_C[s]
        def ep(th, ph, c=c, d=d, u=u, w=w):
            return c + (d * math.cos(th) + (u * math.cos(ph) + w * math.sin(ph)) * math.sin(th)) * EYE_R
        PUP = math.radians(41)
        def ecol(p, c=c, d=d):
            ang = math.acos(max(-1, min(1, (p - c).normalized().dot(d))))
            return C['pupil'] if ang < PUP + 1e-4 else C['eye_white']
        degs = [7, 15, 23, 30, 36, 41, 43.5, 50, 62, 76, 92, 110, 130, 152]
        surface(ep, 18, [math.radians(a) for a in degs], ecol, lambda p, bone=bone: {bone: 1}, EYE, 'eye', c, aok=.6)
        # catch-lights: a big soft dot up and out, a small one below it (sits a hair proud of the pupil)
        for ang_off, rot, rad in ((19, 1.0, .0115), (27, -2.1, .005)):
            dirc = (d * math.cos(math.radians(ang_off)) +
                    (u * math.cos(rot) * sg + w * math.sin(rot)).normalized() * math.sin(math.radians(ang_off))).normalized()
            cu = dirc.cross(V(0, 1, 0)).normalized(); cw = cu.cross(dirc).normalized()
            centre = c + dirc * (EYE_R + .0012)
            fs = len(G.F)
            nk = 12 if rad > .008 else 8
            ring = [G.v(centre + (cu * math.cos(TAU * k / nk) + cw * math.sin(TAU * k / nk)) * rad - dirc * (rad * rad / (2 * EYE_R)),
                        C['catch'], {bone: 1}, (0, 0), 0, 'eye') for k in range(nk)]
            cc = G.v(centre + dirc * .0006, C['catch'], {bone: 1}, (0, 0), 0, 'eye')
            for k in range(nk): G.f([cc, ring[k], ring[(k + 1) % nk]], EYE)
            orient_part(fs, lambda q, c=c: c)

# ===================================================================== claws: a big crusher (R) and a small picker (L)
def build_claws():
    for s, sg in (('L', 1), ('R', -1)):
        c = CLAW[s]; d, side, up = c['d'], c['side'], c['up']; big = s == 'R'
        b1, b2, bp = 'Claw%s1' % s, 'Claw%s2' % s, 'Pincer%s' % s
        speck = speckle_field(scatter_on(lambda th, ph: c['E'].lerp(c['W'], .5) + (d * math.cos(th) * c['palm'][0] + (side * math.cos(ph) * c['palm'][2] + up * math.sin(ph) * c['palm'][1]) * math.sin(th)), 14 if big else 5, 11 if big else 13, (.5, 2.4), (.3, math.pi - .3), (.016, .024) if big else (.009, .012)))
        # arm (merus): shoulder to elbow, a little swollen
        path = bezier(c['S'], c['S'].lerp(c['E'], .5) + V(0, .015, 0), c['E'], 7)
        r1 = c['r1']
        tube(path, lambda t: r1 * (.85 + .25 * math.sin(math.pi * t)), 10,
             lambda t, a, p: mix(C['coral'], C['belly'], .55 * smoothstep(.1, -.8, math.sin(a))), lambda t, p: {b1: 1}, BODY, 'arm', tip=False)
        # carpus knob at the elbow
        kc = c['E']; kr = r1 * 1.18
        surface(lambda th, ph: kc + V(math.sin(th) * math.cos(ph) * kr, math.cos(th) * kr * .95, math.sin(th) * math.sin(ph) * kr),
                12, [math.pi * i / 7 for i in range(1, 7)], lambda p: mix(C['coral'], C['belly'], .5 * smoothstep(0, -1, (p - kc).y / kr)),
                lambda p: {b2: 1}, BODY, 'arm', kc)
        # palm: a chunky mitten, deepest toward the fingers
        pc = c['E'].lerp(c['W'], .52); hl = (c['W'] - c['E']).length * .58
        a0, hz, hx = hl, c['palm'][1], c['palm'][2]
        def pp(th, ph):
            x = math.cos(th); r = math.sin(th)
            swell = 1 + .14 * x - .1 * x * x
            return pc + d * (x * a0) + side * (math.cos(ph) * r * hx * swell) + up * (math.sin(ph) * r * hz * swell * (1.0 if math.sin(ph) > 0 else .9))
        def pcol(p):
            q = p - pc; v = q.dot(up) / hz
            col = mix(C['belly'], C['coral'], smoothstep(-.7, .1, v))
            col = mix(col, C['coral_deep'], smoothstep(.5, 1, v) * .25)
            return mix(col, C['cream'], speck(p) * smoothstep(-.2, .3, v) * .7)
        surface(pp, 20 if big else 14, [math.pi * (i / 14) for i in range(1, 14)] if big else [math.pi * i / 10 for i in range(1, 10)],
                pcol, lambda p: {b2: 1}, BODY, 'palm', pc)
        # fingers: the fixed one curls up, the movable dactyl (pincer bone) curls down to meet it
        L = c['finger']
        def fcol(t, a, p): return mix(mix(C['coral'], C['claw_dark'], .25), C['claw_tip'], smoothstep(.45, .85, t))
        fr = hz * (.36 if big else .4)
        f0 = c['fixed']
        fpath = bezier(f0 - d * .02, f0 + d * L * .55 - up * hz * .05, f0 + d * L * .97 + up * hz * .32, 9)
        tube(fpath, lambda t: fr * (1 - t) ** .7 + .002, 9 if big else 7, fcol, lambda t, p: {b2: 1}, BODY, 'finger', up=up, aspect=.72)
        h0 = c['hinge']
        hpath = bezier(h0 - d * .02, h0 + d * L * .6 + up * hz * .12, h0 + d * L * 1.02 - up * hz * .38, 9)
        tube(hpath, lambda t: fr * 1.05 * (1 - t) ** .7 + .002, 9 if big else 7, fcol, lambda t, p: {bp: 1}, BODY, 'finger', up=up, aspect=.72)
        if big:   # three blunt crusher teeth along each finger's inner edge
            for path_, sgn, bone in ((fpath, 1, b2), (hpath, -1, bp)):
                for t in (.35, .55, .72):
                    k = int(t * (len(path_) - 1)); p = path_[k]; r = fr * (1 - t) ** .7
                    tc = p + up * sgn * r * .8
                    surface(lambda th, ph, tc=tc, r=r: tc + V(math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)) * r * .42,
                            6, [math.pi / 3, 2 * math.pi / 3], lambda p: C['claw_tip'], lambda p, bone=bone: {bone: 1}, BODY, 'finger', tc)

# ===================================================================== legs: three a side, orange with cream tips
def build_legs():
    for name, L in LEGS.items():
        A, B = name + 'A', name + 'B'
        hip, knee, tip, h = L['hip'], L['knee'], L['tip'], L['h']
        # upper segment rises out of the body to the knee
        pa = bezier(hip - h * .02, hip.lerp(knee, .5) + V(0, .012, 0), knee, 6)
        tube(pa, lambda t: lerp(.031, .027, t), 8, lambda t, a, p: mix(C['leg'], C['belly'], .4 * smoothstep(.2, -.9, math.sin(a))),
             lambda t, p: {A: 1}, BODY, 'leg', tip=False)
        # knee knob (lighter band), rigid on the lower bone so it pivots in place
        kr = .03
        surface(lambda th, ph: knee + V(math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)) * kr, 8,
                [math.pi * i / 4 for i in range(1, 4)], lambda p: C['joint'], lambda p: {B: 1}, BODY, 'leg', knee)
        # lower segment: out a little, then down to a cream point
        mid = knee.lerp(tip, .4) + h * .05 + V(0, .03, 0)
        pb = bezier(knee, mid, tip, 8)
        def lcol(t, a, p): return mix(mix(C['leg'], C['leg_dark'], .25 * smoothstep(.0, .4, t)), C['tip'], smoothstep(.6, .72, t))
        tube(pb, lambda t: .027 * (1 - t) ** .5 + .002, 8, lcol, lambda t, p: {B: 1}, BODY, 'leg')

# ===================================================================== the shell: a cluster of halite cubes
# (centre, edge, rotation degrees (x, y, z), colour, hopper faces: local axes whose + face is a stepped hopper face)
CRYSTALS = [
    (V(.0, .395, -.115), .215, (14, 38, 9), 'pink', ['+y']),
    (V(.112, .335, -.02), .135, (-18, 12, 24), 'white', []),
    (V(-.118, .345, -.045), .145, (16, -26, -19), 'rose', ['+y']),
    (V(.085, .305, -.215), .15, (28, 52, -12), 'rose', []),
    (V(-.085, .31, -.22), .14, (-24, 18, 30), 'pink', ['+z']),
    (V(.0, .265, -.285), .12, (38, 8, 4), 'white', []),
    (V(.135, .255, -.135), .1, (6, 30, 40), 'deep', []),
    (V(-.14, .265, -.13), .105, (-12, -40, -34), 'white', []),
    (V(.035, .47, .0), .08, (24, 16, 44), 'white', []),
    (V(-.075, .465, -.185), .09, (-30, 32, 10), 'deep', []),
    (V(.115, .44, -.145), .085, (12, 62, -28), 'rose', []),
    (V(-.035, .30, .035), .105, (10, -12, 12), 'pink', []),
    (V(.16, .2, -.04), .06, (20, 15, 30), 'rose', []),
    (V(-.165, .2, -.035), .065, (-15, 40, -20), 'pink', []),
    (V(.0, .2, -.31), .075, (25, 20, 35), 'deep', []),
    (V(.15, .385, -.06), .065, (35, 25, 15), 'white', []),
    (V(-.145, .42, -.1), .06, (-20, 15, 40), 'white', []),
    (V(.06, .225, -.3), .07, (-30, 10, 20), 'pink', []),
    (V(-.075, .225, -.295), .065, (15, -30, 25), 'rose', []),
]
SALT = {'white': C['salt_white'], 'pink': C['salt_pink'], 'rose': C['salt_rose'], 'deep': C['salt_deep']}
CLUSTER_C = V(0, .3, -.12)

def euler_q(deg):
    x, y, z = (math.radians(a) for a in deg)
    return Quaternion(V(0, 1, 0), y) @ Quaternion(V(0, 0, 1), z) @ Quaternion(V(1, 0, 0), x)

def build_crystal(ci, centre, edge, rot, colkey, hoppers):
    q = euler_q(rot); h = edge / 2; ch = edge * .07   # chamfer
    rnd = float(RNG.random())
    base = SALT[colkey]
    deeper = mix(base, C['salt_deep'], .35 if colkey != 'deep' else .25)
    milky = mix(base, C['salt_white'], .5)
    axes = [V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)]
    def W(p): return centre + q @ p
    def add(pl, col, mask, aok=.75): return G.v(W(pl), col, {'Shell': 1}, (mask, rnd), aok, 'crystal')
    def flat(idx):   # a flat face, oriented outward from the crystal centre
        ps = [G.P[i] for i in idx]; c = sum(ps, Vector()) / len(ps)
        if face_normal(ps).dot(c - centre) < 0: idx = idx[::-1]
        G.f(idx, SHELL, smooth=False)
    corner = {}   # (axis, sign, a, b) -> local corner position of that face
    for ai in range(3):
        for sgn in (1, -1):
            n = axes[ai] * sgn; j, k = [x for x in range(3) if x != ai]
            fc = n * h
            cs = []
            for a, b in ((1, 1), (-1, 1), (-1, -1), (1, -1)):
                p = fc + axes[j] * (a * (h - ch)) + axes[k] * (b * (h - ch)); corner[(ai, sgn, a, b)] = p; cs.append(p)
            nw = q @ n; inward = clamp01(-nw.dot((W(fc) - CLUSTER_C).normalized()) * 1.5 + .2 * (nw.y < -.3))
            shade = 1.0 + .07 * nw.y + .05 * (float(RNG.random()) - .5)
            fcol = mul(base, shade); icol = mix(fcol, deeper, .45)
            ring_mask = lerp(.5, .9, inward)
            key = ('+' if sgn > 0 else '-') + 'xyz'[ai]
            if key in hoppers:
                # stepped hopper face: a raised rim, then two recessed square terraces down to a small core
                d1, d2 = edge * .06, edge * .12
                levels = [(1.0, 0.0, 0.0, fcol), (.74, 0.0, .45, fcol), (.74, d1, .6, icol), (.5, d1, .75, icol),
                          (.5, d2, .9, mix(icol, deeper, .5)), (.27, d2, 1.0, deeper)]
                rings = []
                for ratio, depth, m, col in levels:
                    rings.append([add(fc + (p - fc) * ratio - n * depth, col, m) for p in cs])
                for r0, r1 in zip(rings[:-1], rings[1:]):
                    for e in range(4): flat([r0[e], r0[(e + 1) % 4], r1[(e + 1) % 4], r1[e]])
                flat(rings[-1])
            else:
                outer = [add(p, fcol, 0.0) for p in cs]
                inner = [add(fc + (p - fc) * .55, mix(fcol, icol, .5), ring_mask) for p in cs]
                core = add(fc - n * edge * .004, icol, 1.0)
                for e in range(4): flat([outer[e], outer[(e + 1) % 4], inner[(e + 1) % 4], inner[e]])
                for e in range(4): flat([inner[e], inner[(e + 1) % 4], core])
    ecol = mix(milky, C['salt_white'], .3)
    # chamfer strips along the 12 edges
    for ai in range(3):
        for aj in range(ai + 1, 3):
            ak = 3 - ai - aj
            for si in (1, -1):
                for sj in (1, -1):
                    def cpos(axis, sgn, other_axis, other_sgn, kk):
                        j, k = [x for x in range(3) if x != axis]
                        a = other_sgn if j == other_axis else kk; b = other_sgn if k == other_axis else kk
                        return corner[(axis, sgn, a, b)]
                    pts = [cpos(ai, si, aj, sj, 1), cpos(ai, si, aj, sj, -1), cpos(aj, sj, ai, si, -1), cpos(aj, sj, ai, si, 1)]
                    flat([add(p, ecol, 0.0) for p in pts])
    # corner triangles
    for sx in (1, -1):
        for sy in (1, -1):
            for sz in (1, -1):
                sg = (sx, sy, sz); pts = []
                for ai in range(3):
                    j, k = [x for x in range(3) if x != ai]
                    pts.append(corner[(ai, sg[ai], sg[j], sg[k])])
                flat([add(p, ecol, 0.0) for p in pts])

SHELL_SCALE, SHELL_BASE = 1.12, V(0, .2, -.12)
def build_shell():
    for ci, (c, e, r, col, hop) in enumerate(CRYSTALS):
        build_crystal(ci, SHELL_BASE + (c - SHELL_BASE) * SHELL_SCALE, e * SHELL_SCALE, r, col, hop)

# ===================================================================== build
build_body(); build_shell(); build_eyes(); build_claws(); build_legs()

# ===================================================================== baked ambient occlusion into vertex colours
tris = []
for f in G.F:
    for k in range(1, len(f) - 1): tris.append((f[0], f[k], f[k + 1]))
GROUND = len(G.P)
gp = [V(-3, 0, -3), V(3, 0, -3), V(3, 0, 3), V(-3, 0, 3)]
bvh = BVHTree.FromPolygons([tuple(p) for p in G.P + gp], tris + [(GROUND, GROUND + 2, GROUND + 1), (GROUND, GROUND + 3, GROUND + 2)], all_triangles=True)
vn = [Vector() for _ in G.P]
for fi, f in enumerate(G.F):
    ps = [G.P[i] for i in f]; n = face_normal(ps)
    for i in f: vn[i] += n
DIRS = []
for i in range(40):
    u1, u2 = (i + .5) / 40, (i * .618033988749) % 1
    r, phi = math.sqrt(u1), TAU * u2; DIRS.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - u1))))
def ao_at(p, n, reach=.16):
    if n.length < 1e-12: return 1.0
    n = n.normalized(); ref = Vector((1, 0, 0)) if abs(n.x) < .9 else Vector((0, 1, 0))
    u = n.cross(ref).normalized(); v = n.cross(u); occ = 0.0
    for d in DIRS:
        dw = u * d.x + v * d.y + n * d.z
        hit = bvh.ray_cast(p + n * .0015, dw, reach)
        if hit[0] is not None: occ += 1 - (hit[3] / reach) ** .7
    return 1 - occ / len(DIRS)
AO = []
for i, p in enumerate(G.P):
    if G.aok[i] <= 0: AO.append(1.0); continue
    ao = ao_at(p, vn[i]); AO.append(ao)
    G.col[i] = mul(G.col[i], lerp(1 - .72 * G.aok[i], 1, ao ** 1.1))

# ===================================================================== Blender objects
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene; SC.render.fps = FPS; SC.frame_start = 0
def principled(m):
    m.use_nodes = True; return m.node_tree, m.node_tree.nodes['Principled BSDF']
MATS = []
for name, rough in (('CrabShell', .18), ('CrabBody', .5), ('CrabEye', .1)):
    m = bpy.data.materials.new(name); nt, b = principled(m)   # no colour node: the exporter then writes COLOR_0 as RGBA
    b.inputs['Base Color'].default_value = (1, 1, 1, 1)
    b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = 0
    m.use_backface_culling = True; MATS.append(m)
M_SHELL, M_BODY, M_EYE = MATS

VMAT = [BODY] * len(G.P)
for f, m in zip(G.F, G.FM):
    for i in f: VMAT[i] = m
me = bpy.data.meshes.new('SaltbackCrab')
me.from_pydata([tuple(to_b(p)) for p in G.P], [], G.F)
for m in MATS: me.materials.append(m)
me.polygons.foreach_set('material_index', G.FM)
me.polygons.foreach_set('use_smooth', G.FS)
uv0 = me.uv_layers.new(name='UVMap'); uv1 = me.uv_layers.new(name='Mask')
loop_v = np.zeros(len(me.loops), np.int64); me.loops.foreach_get('vertex_index', loop_v)
PA = np.array([tuple(p) for p in G.P], np.float32)
uv0.data.foreach_set('uv', np.stack([np.clip(PA[loop_v, 0] + .5, 0, 1), np.clip(PA[loop_v, 2] + .5, 0, 1)], 1).ravel())
M1 = np.array(G.uv1, np.float32)
uv1.data.foreach_set('uv', M1[loop_v].ravel())
ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
ca.data.foreach_set('color', np.array([(*c, m[0] if fm == SHELL else 1.0) for c, m, fm in zip(G.col, G.uv1, VMAT)], np.float32).ravel())
me.color_attributes.active_color = ca
try: me.color_attributes.render_color_index = me.color_attributes.active_color_index
except Exception: pass
me.validate(); me.update()
body = bpy.data.objects.new('SaltbackCrab', me); SC.collection.objects.link(body)

arm_data = bpy.data.armatures.new('SaltbackRig'); rig = bpy.data.objects.new('SaltbackRig', arm_data); SC.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
ORDER = list(BONES)
for name in ORDER:
    hd = to_b(BONES[name][0]); eb = arm_data.edit_bones.new(name); eb.head = hd; eb.tail = hd + Vector((0, 0, .04)); eb.roll = 0   # pointing up: the exporter's bone axis fix-up then yields identity rest rotations
for name in ORDER:
    p = BONES[name][1]
    if p: arm_data.edit_bones[name].parent = arm_data.edit_bones[p]; arm_data.edit_bones[name].use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
groups = {n: body.vertex_groups.new(name=n) for n in ORDER}
for i, w in enumerate(G.W):
    items = sorted(((k, v) for k, v in w.items() if v > 1e-3), key=lambda kv: -kv[1])[:2]
    tot = sum(v for _, v in items)
    for k, v in items: groups[k].add([i], v / tot, 'REPLACE')
body.parent = rig; mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = rig

# ===================================================================== posing (game-frame deltas about each joint's head)
def gq(axis, ang): return Quaternion(Vector(axis).normalized(), ang)
def qe(pitch=0.0, yaw=0.0, roll=0.0):   # about the crab's own axes: x pitch (+ = nose down), y yaw (+ = turn left), z roll (+ = left side up)
    return gq((0, 1, 0), yaw) @ gq((0, 0, 1), roll) @ gq((1, 0, 0), pitch)
def q2b(q): return Quaternion((q.w, q.x, -q.z, q.y))
def add(spec, name, q=None, p=None, s=None):
    v = spec.setdefault(name, {})
    if q is not None: v['q'] = q @ v.get('q', Quaternion())
    if p is not None: v['p'] = tuple(a + b for a, b in zip(v.get('p', (0, 0, 0)), p))
    if s is not None: v['s'] = s
PREV_Q = {}
RW = Quaternion(Vector((1, 0, 0)), math.pi / 2)   # every bone's rest orientation in Blender (local Y up, local Z = game +Z)
def apply(spec):
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
        v = spec.get(pb.name, {})
        qb = RW.inverted() @ q2b(v.get('q', Quaternion())) @ RW; qb.normalize()
        prev = PREV_Q.get(pb.name)
        if prev is not None and prev.dot(qb) < 0: qb = -qb
        PREV_Q[pb.name] = qb.copy(); pb.rotation_quaternion = qb
        if 'p' in v: pb.location = RW.inverted() @ to_b(v['p'])
        if 's' in v:
            s = v['s']; pb.scale = (s, s, s) if isinstance(s, (int, float)) else s   # local axes = game x, y, z
    bpy.context.view_layer.update()

def ease(x): x = clamp01(x); return x * x * (3 - 2 * x)
def bump(x, a, b, c, d):   # 0 before a, up to 1 at b, hold to c, down to 0 at d
    if x <= a or x >= d: return 0.0
    return ease((x - a) / (b - a)) if x < b else 1.0 if x <= c else 1 - ease((x - c) / (d - c))
def back_out(x, k=1.7):
    x = clamp01(x); x -= 1; return 1 + x * x * ((k + 1) * x + k)

def body_xf(spec):
    v = spec.get('Body', {}); return v.get('q', Quaternion()), Vector(v.get('p', (0, 0, 0)))
def solve_legs(spec, offsets):
    """Two-bone IK: each foot's target = rest tip + offset, in Root space; the body's pose is undone first so planted
    feet stay put while the body bobs, rolls and rears."""
    qB, pB = body_xf(spec); qi = qB.inverted()
    for name, L in LEGS.items():
        off = offsets.get(name, V(0, 0, 0))
        hip, knee, tip = L['hip'], L['knee'], L['tip']
        tgt = BODY_C + qi @ (tip + off - BODY_C - pB)
        a, b = (knee - hip).length, (tip - knee).length
        dv = tgt - hip; dd = min(max(dv.length, abs(a - b) + 1e-3), a + b - 1e-3); u = dv.normalized()
        w = (knee - hip) - u * (knee - hip).dot(u)
        if w.length < 1e-6: w = V(0, 1, 0)
        w.normalize()
        x = (a * a - b * b + dd * dd) / (2 * dd); y = math.sqrt(max(a * a - x * x, 0))
        k2 = hip + u * x + w * y; t2 = hip + u * dd
        qA = (knee - hip).rotation_difference(k2 - hip)
        qBl = (tip - knee).rotation_difference(qA.inverted() @ (t2 - k2))
        spec.setdefault(name + 'A', {})['q'] = qA; spec.setdefault(name + 'B', {})['q'] = qBl

def eyes(spec, s, yaw=0.0, pitch=0.0, roll=0.0, scale=None):
    add(spec, 'Eye' + s, q=qe(pitch, yaw, roll))
    if scale is not None: add(spec, 'Eye' + s, s=scale)
def claw(spec, s, shoulder=(0, 0, 0), wrist=(0, 0, 0), open_=0.0):
    """shoulder/wrist: (pitch, yaw, roll) game-frame deltas; open_ in radians lifts the dactyl's tip."""
    add(spec, 'Claw%s1' % s, q=qe(*shoulder)); add(spec, 'Claw%s2' % s, q=qe(*wrist))
    if open_: open_pincer(spec, s, open_)
def open_pincer(spec, s, ang):
    # rotate the dactyl about the hinge axis so its tip lifts (sign chosen so + opens)
    c = CLAW[s]; ax = c['up'].cross(c['d']).normalized()   # = -side
    add(spec, 'Pincer' + s, q=gq(ax, -ang))

def leg_curl(spec, name, amount):
    """Fold a leg in toward the body: the hip lifts the knee up and in, the lower segment tucks under."""
    L = LEGS[name]; sg = L['sg']; h = L['h']
    ax = V(0, 1, 0).cross(h).normalized()   # horizontal, perpendicular to the leg's plane
    add(spec, name + 'A', q=gq(ax, -.55 * amount * 1))
    add(spec, name + 'B', q=gq(ax, 1.5 * amount))

# ----------------------------------------------------------------------------------------- clips
IDLE_T, SCUTTLE_T, PINCH_T, HURT_T, DEATH_T, EMERGE_T = 2.0, .6, .7, .35, 1.2, 1.2
PINCH_HIT = .35
STRIDE = .12   # metres a planted foot sweeps per half cycle

def clip_idle(t):
    spec = {}; w = TAU * t / IDLE_T
    add(spec, 'Body', p=(0, .006 * math.sin(w) + .003 * math.sin(2 * w + .5), 0), q=qe(.025 * math.sin(w + .6), .02 * math.sin(w), .015 * math.sin(2 * w)))
    add(spec, 'Shell', q=qe(-.02 * math.sin(w + .1), 0, .015 * math.sin(2 * w - .6)))
    # eye stalks swivel independently: the left one scans slowly, the right one darts and glances back
    eyes(spec, 'L', yaw=.32 * math.sin(w + .4) + .1 * math.sin(3 * w), pitch=.08 * math.sin(2 * w + 1), roll=-.06 * math.sin(w))
    dart = bump(t, .3, .4, .85, 1.0) - bump(t, 1.35, 1.45, 1.75, 1.9)
    eyes(spec, 'R', yaw=-.45 * dart + .06 * math.sin(2 * w), pitch=-.08 * bump(t, .3, .4, .85, 1.0), roll=.05 * math.sin(w + 2))
    # small claw fidgets: little wrist rolls and nibbling snips
    claw(spec, 'L', shoulder=(.06 * math.sin(w + 1), .05 * math.sin(2 * w), .04 * math.sin(w)),
         wrist=(.12 * math.sin(2 * w + .3), .0, .18 * math.sin(w * 2 + 1.1)))
    open_pincer(spec, 'L', .32 * max(0, math.sin(4 * w)) ** 2)
    # big claw: lifts, opens wide... CLACK (at 1.30 s), settles
    lift = bump(t, .95, 1.2, 1.3, 1.7)
    claw(spec, 'R', shoulder=(-.18 * lift, .06 * lift, .05 * lift), wrist=(-.12 * lift + .06 * bump(t, 1.3, 1.34, 1.36, 1.5), 0, 0))
    open_pincer(spec, 'R', .55 * bump(t, 1.0, 1.24, 1.26, 1.31) - .04 * bump(t, 1.31, 1.33, 1.35, 1.45))
    add(spec, 'Body', p=(0, -.004 * bump(t, 1.3, 1.33, 1.36, 1.5), 0))
    solve_legs(spec, {})
    return spec

TRIPOD = {'LegL1': 0, 'LegR2': 0, 'LegL3': 0, 'LegR1': .5, 'LegL2': .5, 'LegR3': .5}
def clip_scuttle(t):
    spec = {}; ph = t / SCUTTLE_T; w = TAU * ph
    add(spec, 'Body', p=(.008 * math.sin(w), .012 + .009 * math.cos(2 * w), 0), q=qe(.03 * math.sin(2 * w + .8), .03 * math.sin(w), -.06 * math.sin(w - .5)))
    add(spec, 'Shell', q=qe(.04 * math.sin(2 * w), .03 * math.sin(w + 1), -.09 * math.sin(w - 1.4)))
    eyes(spec, 'L', yaw=.1 * math.sin(w - 1), roll=.16 * math.sin(w - 1.8), pitch=.07 * math.sin(2 * w - 1))
    eyes(spec, 'R', yaw=.1 * math.sin(w - .7), roll=.16 * math.sin(w - 1.6), pitch=.07 * math.sin(2 * w - 1.3))
    claw(spec, 'R', shoulder=(-.16 + .05 * math.sin(2 * w), .08, .1 + .05 * math.sin(w)), wrist=(-.1 + .05 * math.sin(2 * w + 1), 0, 0))
    claw(spec, 'L', shoulder=(-.2 + .08 * math.sin(2 * w + .5), -.05, -.12 + .06 * math.sin(w + 1)), wrist=(-.15, 0, .1 * math.sin(2 * w)))
    open_pincer(spec, 'L', .25 + .2 * math.sin(2 * w)); open_pincer(spec, 'R', .1 + .06 * math.sin(2 * w + 1))
    offs = {}
    for name, o in TRIPOD.items():
        u = (ph + o) % 1.0
        if u < .5:   # swing: lift and reach toward +X (the travel direction)
            k = u / .5; x = -STRIDE / 2 + STRIDE * ease(k); y = .05 * math.sin(math.pi * k)
        else:        # stance: planted, sweeping toward -X at constant speed while the crab travels +X
            k = (u - .5) / .5; x = STRIDE / 2 - STRIDE * k; y = 0.0
        offs[name] = V(x, y, 0)
    solve_legs(spec, offs)
    return spec

def clip_pinch(t):
    spec = {}
    wind = bump(t, 0, .22, .24, .31); lunge = bump(t, .25, .335, .43, .66)
    snap = ease((t - .29) / (PINCH_HIT - .29))            # pincer shut exactly at the hit frame
    add(spec, 'Body', p=(0, .02 * wind + .006 * lunge, -.035 * wind + .05 * lunge), q=qe(-.2 * wind + .1 * lunge, .1 * wind - .06 * lunge, -.06 * wind + .04 * lunge))
    add(spec, 'Shell', q=qe(.06 * lunge - .04 * wind + .05 * bump(t, .35, .4, .42, .6), 0, .05 * bump(t, .34, .4, .45, .62)))
    claw(spec, 'R', shoulder=(-.55 * wind + .2 * lunge, .3 * wind - .38 * lunge, .15 * wind), wrist=(-.35 * wind + .22 * lunge, 0, .1 * wind))
    open_pincer(spec, 'R', .7 * (1 - snap) * (bump(t, 0, .2, .3, .7) if t < .3 else 1) - .05 * bump(t, PINCH_HIT, .37, .4, .5))
    claw(spec, 'L', shoulder=(-.2 * wind + .1 * lunge, -.15 * wind, -.1 * wind), wrist=(-.1 * wind, 0, 0))
    open_pincer(spec, 'L', .3 * wind)
    eyes(spec, 'L', yaw=-.15 * wind + .1 * lunge, pitch=.15 * lunge); eyes(spec, 'R', yaw=.2 * wind - .12 * lunge, pitch=.15 * lunge)
    solve_legs(spec, {})
    return spec

def clip_hurt(t):
    spec = {}
    f = bump(t, 0, .06, .1, HURT_T); jolt = math.sin(TAU * t * 9) * bump(t, 0, .05, .12, .3)
    add(spec, 'Body', p=(0, .012 * f, -.04 * f), q=qe(-.22 * f, 0, .08 * jolt))
    add(spec, 'Shell', q=qe(.08 * jolt, 0, -.08 * jolt))
    sq = bump(t, 0, .05, .14, HURT_T)
    for s, sg in (('L', 1), ('R', -1)):
        eyes(spec, s, pitch=.35 * sq, roll=-sg * .2 * sq, scale=(1 + .3 * sq, 1 - .45 * sq, 1 + .3 * sq))
        claw(spec, s, shoulder=(-.35 * f, -sg * .2 * f, sg * .15 * f), wrist=(-.25 * f, 0, 0))
        open_pincer(spec, s, .35 * f)
    solve_legs(spec, {n: V(0, .03 * f * (1 if n.endswith('1') else .4), 0) for n in LEGS})
    return spec

DEATH_FRAMES = {}
def death_pose(t):
    """Everything but the Root's lift and slide (those come from contact with the ground)."""
    spec = {}
    shock = bump(t, 0, .1, .18, .4); roll = ease((t - .2) / .5) * 2.72 + .1 * bump(t, .7, .78, .8, .95)
    add(spec, 'Root', q=qe(-.15 * ease((t - .2) / .5), 0, roll))
    add(spec, 'Body', p=(0, .02 * shock, 0), q=qe(-.15 * shock, 0, 0))
    curl = ease((t - .3) / .6)
    for name in LEGS: leg_curl(spec, name, curl * (.9 + .1 * math.sin(len(name) + int(name[-1]))) + .15 * shock)
    droop = ease((t - .55) / .5)
    for s, sg in (('L', 1), ('R', -1)):
        eyes(spec, s, pitch=-.3 * shock + 1.0 * droop, roll=-sg * (.15 * shock - .5 * droop * (1 if s == 'L' else .7)), yaw=sg * .3 * droop,
             scale=(1 + .15 * shock, 1 + .25 * shock - .15 * droop, 1 + .15 * shock))
        claw(spec, s, shoulder=(-.4 * shock + .55 * curl, -sg * .25 * curl, sg * .3 * curl), wrist=(.3 * curl, 0, 0))
        open_pincer(spec, s, .4 * shock + .25 * droop)
    return spec

def clip_emerge(t):
    spec = {}
    rise = back_out(t / .6, 1.4); y = -.45 * (1 - rise)
    add(spec, 'Root', p=(0, y, 0))
    sh = bump(t, .58, .64, .82, .98)
    wig = math.sin(TAU * (t - .58) * 7.5) * sh
    add(spec, 'Body', p=(.01 * wig, .02 * bump(t, .45, .55, .6, .7), 0), q=qe(.04 * wig, .05 * wig, .16 * wig))
    add(spec, 'Shell', q=qe(.05 * math.sin(TAU * (t - .6) * 7.5) * sh, 0, -.12 * math.sin(TAU * (t - .62) * 7.5) * sh))
    # eyes tucked low until the shake is done, then pop up last with a springy overshoot
    pop = clamp01((t - .9) / .3); spring = 1 - math.exp(-6 * pop) * math.cos(9 * pop) if pop > 0 else 0.0
    sc = lerp(.12, 1.0, spring)
    for s, sg in (('L', 1), ('R', -1)):
        eyes(spec, s, pitch=lerp(.9, 0, spring), roll=-sg * .3 * (1 - spring), scale=(lerp(.6, 1, spring), sc, lerp(.6, 1, spring)))
        tuck = 1 - ease((t - .3) / .35)
        claw(spec, s, shoulder=(.5 * tuck - .15 * sh, -sg * .2 * tuck, 0), wrist=(.4 * tuck, 0, .25 * wig * sg))
        open_pincer(spec, s, .3 * sh)
    tuck = 1 - ease((t - .25) / .4)
    for name in LEGS: leg_curl(spec, name, .8 * tuck)
    if t > .35:   # legs plant while the shake finishes
        keep = {n: spec[n].copy() for n in [k for k in spec if k.startswith('Leg')]}
        solve_legs(spec, {})
        k = ease((t - .35) / .3)
        for n, v in keep.items():
            spec[n]['q'] = v['q'].slerp(spec[n]['q'], k)
    return spec

CLIPS = {'Idle': (clip_idle, IDLE_T, True), 'Scuttle': (clip_scuttle, SCUTTLE_T, True), 'Pinch': (clip_pinch, PINCH_T, False),
         'Hurt': (clip_hurt, HURT_T, False), 'Death': (None, DEATH_T, False), 'Emerge': (clip_emerge, EMERGE_T, False)}
def clip_times(name):
    T = CLIPS[name][1]; ts = [i / FPS for i in range(int(math.floor(T * FPS + 1e-6)) + 1)]
    if T - ts[-1] > 1e-6: ts.append(T)
    if name == 'Pinch': ts.append(PINCH_HIT)
    return sorted(set(round(x, 6) for x in ts))

# CPU skinning (for ground contact and checks), Blender frame
BI = {n: i for i, n in enumerate(ORDER)}
WM = np.zeros((len(G.P), len(ORDER)), np.float32)
for v in me.vertices:
    for g in v.groups: WM[v.index, g.group] = g.weight
P0 = np.c_[np.array([tuple(to_b(p)) for p in G.P], np.float64), np.ones(len(G.P))]
def skinned():
    mats = np.array([np.array(rig.pose.bones[n].matrix @ rig.data.bones[n].matrix_local.inverted()) for n in ORDER])
    out = np.einsum('bij,vj->bvi', mats, P0)[:, :, :3]
    return np.einsum('vb,bvi->vi', WM, out)

def death_contact():
    """Roll the crab over its contact point: the Root lifts so the lowest point touches the ground, and slides so the
    previous contact point does not skid."""
    xo, prev_c = 0.0, None
    for t in clip_times('Death'):
        spec = death_pose(t); add(spec, 'Root', p=(xo, 0, 0)); apply(spec); P = skinned()
        if prev_c is not None:
            xo += (PREV_X - P[prev_c, 0]); xo = max(-.3, min(.3, xo))
            spec = death_pose(t); add(spec, 'Root', p=(xo, 0, 0)); apply(spec); P = skinned()
        ci = int(np.argmin(P[:, 2])); lift = -P[ci, 2]
        globals()['PREV_X'] = P[ci, 0]; prev_c = ci
        DEATH_FRAMES[round(t, 6)] = (xo, lift)
def clip_death(t):
    ts = sorted(DEATH_FRAMES); k = int(np.clip(np.searchsorted(ts, t) - 1, 0, len(ts) - 2)); f = clamp01((t - ts[k]) / (ts[k + 1] - ts[k]))
    (x0, l0), (x1, l1) = DEATH_FRAMES[ts[k]], DEATH_FRAMES[ts[k + 1]]
    spec = death_pose(t); add(spec, 'Root', p=(lerp(x0, x1, f), lerp(l0, l1, f), 0)); return spec
death_contact()
CLIPS['Death'] = (clip_death, DEATH_T, False)

# exact samples for the GLB (game frame = glTF frame; rest rotations are identity, so a node's rotation is the delta)
SAMPLES = {}
def record(clip, t, spec):
    S = SAMPLES.setdefault(clip, {'t': [], 'bones': {n: {'q': [], 'p': [], 's': []} for n in ORDER}})
    S['t'].append(t)
    for n in ORDER:
        v = spec.get(n, {}); q = v.get('q', Quaternion()).normalized(); b = S['bones'][n]
        qa = np.array([q.x, q.y, q.z, q.w])
        if b['q'] and np.dot(b['q'][-1], qa) < 0: qa = -qa
        b['q'].append(qa); b['p'].append(np.array(v.get('p', (0, 0, 0)), float))
        sc = v.get('s', 1.0); b['s'].append(np.array((sc, sc, sc) if isinstance(sc, (int, float)) else sc, float))
# bake the actions too (Blender's own export of them is the cross-check); every bone keys its rotation, a few also translation and scale
KEYED = {n: ('rotation_quaternion', 'location', 'scale') for n in ('Root', 'Body', 'Shell', 'EyeL', 'EyeR')}
rig.animation_data_create()
CHECK = {}
for name, (fn, T, loop) in CLIPS.items():
    act = bpy.data.actions.new(name); rig.animation_data.action = act
    PREV_Q.clear(); miny = []
    for t in clip_times(name):
        tt = 0.0 if (loop and abs(t - T) < 1e-6) else t
        spec = fn(tt); apply(spec); P = skinned(); miny.append(float(P[:, 2].min()))
        record(name, t, spec)
        for pb in rig.pose.bones:
            for path in KEYED.get(pb.name, ('rotation_quaternion',)):
                pb.keyframe_insert(path, frame=t * FPS, group=pb.name)
    for fc in act.fcurves:
        for kp in fc.keyframe_points: kp.interpolation = 'LINEAR'
    CHECK[name] = {'min_height': round(min(miny), 4), 'keys': len(clip_times(name))}
    track = rig.animation_data.nla_tracks.new(); track.name = name
    track.strips.new(name, 0, act); track.mute = True
    rig.animation_data.action = None
PREV_Q.clear(); apply({})

# ===================================================================== GLB repack: quantized attributes and rotation keys
QUANT = {}
def quantize_glb(path):
    raw = open(path, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl]); bin0 = raw[20 + jl + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    def read(ai):
        a = doc['accessors'][ai]; bv = doc['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
        assert bv.get('byteStride', n * np.dtype(dt).itemsize) == n * np.dtype(dt).itemsize, 'interleaved view'
        d = np.frombuffer(bin0, dt, a['count'] * n, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n).copy()
        if a.get('normalized'): d = d.astype(np.float32) / np.iinfo(dt).max
        return d
    # cross-check Blender's export (whole frames) against the exact samples, then replace the clips with them
    node_ix = {n['name']: i for i, n in enumerate(doc['nodes'])}
    rest_t = {n: np.array(doc['nodes'][node_ix[n]].get('translation', [0, 0, 0]), float) for n in ORDER}
    worst = 0.0
    for anim in doc.get('animations', []):
        S = SAMPLES[anim['name']]; ts = np.array(S['t'])
        for ch in anim['channels']:
            smp = anim['samplers'][ch['sampler']]; nname = doc['nodes'][ch['target']['node']]['name']; path_ = ch['target']['path']
            tin, outp = read(smp['input'])[:, 0], read(smp['output'])
            for k, tk in enumerate(tin):
                j = int(np.argmin(np.abs(ts - tk)))
                if abs(ts[j] - tk) > 1e-4: continue
                b = S['bones'][nname]
                mine = b['q'][j] if path_ == 'rotation' else (rest_t[nname] + b['p'][j] if path_ == 'translation' else b['s'][j])
                d = np.abs(outp[k] - mine).max()
                if path_ == 'rotation': d = min(d, np.abs(outp[k] + mine).max())
                worst = max(worst, d)
    assert worst < 2e-3, ('exact samples disagree with the Blender export', worst)
    QUANT['anim_crosscheck_max_error'] = float(worst)
    newdata = {}
    def new_acc(arr, typ, extra=None):
        doc['accessors'].append(dict({'bufferView': 0, 'componentType': 5126, 'count': len(arr), 'type': typ}, **(extra or {})))
        newdata[len(doc['accessors']) - 1] = np.asarray(arr, np.float32).reshape(len(arr), -1); return len(doc['accessors']) - 1
    anims = []
    for cname in CLIPS:
        S = SAMPLES[cname]; ts = np.array(S['t'], np.float32)
        ti = new_acc(ts, 'SCALAR', {'min': [float(ts.min())], 'max': [float(ts.max())]})
        chs, sms = [], []
        for n in ORDER:
            b = S['bones'][n]
            for path_, arr, rest, typ in (('rotation', np.array(b['q']), np.array([0, 0, 0, 1.]), 'VEC4'),
                                          ('translation', np.array(b['p']) + rest_t[n], rest_t[n], 'VEC3'),
                                          ('scale', np.array(b['s']), np.ones(3), 'VEC3')):
                dev = np.abs(arr - rest).max() if path_ != 'rotation' else np.minimum(np.abs(arr - rest).max(1), np.abs(arr + rest).max(1)).max()
                if dev < 1e-5: continue
                sms.append({'input': ti, 'output': new_acc(arr, typ), 'interpolation': 'LINEAR'})
                chs.append({'sampler': len(sms) - 1, 'target': {'node': node_ix[n], 'path': path_}})
        anims.append({'name': cname, 'channels': chs, 'samplers': sms})
    doc['animations'] = anims
    used = set()
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            used.update(prim['attributes'].values())
            if 'indices' in prim: used.add(prim['indices'])
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin: used.add(skin['inverseBindMatrices'])
    for anim in doc.get('animations', []):
        for smp in anim['samplers']: used.update((smp['input'], smp['output']))
    order_acc = sorted(used); remap = {old: new for new, old in enumerate(order_acc)}
    datas = [newdata[ai] if ai in newdata else read(ai) for ai in order_acc]
    doc['accessors'] = [doc['accessors'][ai] for ai in order_acc]
    for a in doc['accessors']: a.pop('normalized', None)
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            prim['attributes'] = {k: remap[v] for k, v in prim['attributes'].items()}
            if 'indices' in prim: prim['indices'] = remap[prim['indices']]
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin: skin['inverseBindMatrices'] = remap[skin['inverseBindMatrices']]
    for anim in doc.get('animations', []):
        for smp in anim['samplers']: smp['input'] = remap[smp['input']]; smp['output'] = remap[smp['output']]
    conv = {}
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            conv[at['NORMAL']] = 'normal'; conv[at['COLOR_0']] = 'colour'; conv[at['WEIGHTS_0']] = 'weights'; conv[at['JOINTS_0']] = 'joints'
    for anim in doc.get('animations', []):
        for ch in anim['channels']:
            if ch['target']['path'] == 'rotation': conv[anim['samplers'][ch['sampler']]['output']] = 'rotation'
    out = bytearray(); views = []
    def push(data, target=None, stride=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        out.extend(data); views.append(v); return len(views) - 1
    shared_inputs = {}
    for ai, a in enumerate(doc['accessors']):
        data = datas[ai]; kind = conv.get(ai); target = doc['bufferViews'][a['bufferView']].get('target'); a.pop('byteOffset', None)
        if kind == 'normal':
            q = np.clip(np.round(data / np.maximum(np.linalg.norm(data, axis=1, keepdims=True), 1e-9) * 127), -127, 127).astype(np.int8)
            q = np.concatenate([q, np.zeros((len(q), 1), np.int8)], 1)
            a.update(componentType=5120, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind == 'colour':
            assert data.shape[1] == 4, 'COLOR_0 carries the glow mask in alpha'
            q = np.clip(np.round(data * 255), 0, 255).astype(np.uint8)
            a.update(componentType=5121, normalized=True, type='VEC4'); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind == 'weights':
            q = np.round(data / data.sum(1, keepdims=True) * 255).astype(np.int32)
            fix = 255 - q.sum(1); q[np.arange(len(q)), q.argmax(1)] += fix
            a.update(componentType=5121, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.astype(np.uint8).tobytes(), target)
        elif kind == 'joints':
            a.update(componentType=5121); a['bufferView'] = push(data.astype(np.uint8).tobytes(), target)
        elif kind == 'uv':
            q = np.clip(np.round(data * 65535), 0, 65535).astype(np.uint16)
            a.update(componentType=5123, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target)
        elif kind == 'rotation':
            q = np.clip(np.round(data / np.maximum(np.linalg.norm(data, axis=1, keepdims=True), 1e-9) * 32767), -32767, 32767).astype(np.int16)
            a.update(componentType=5122, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes())
        else:
            b = data.astype(CT[a['componentType']]).tobytes()
            if target is None and a['type'] == 'SCALAR' and a['componentType'] == 5126 and b in shared_inputs:
                a['bufferView'] = shared_inputs[b]
            else:
                a['bufferView'] = push(b, target)
                if target is None: shared_inputs[b] = a['bufferView']
    doc['bufferViews'] = views; doc['buffers'] = [{'byteLength': len(out)}]
    for k in ('extensionsUsed', 'extensionsRequired'): doc[k] = sorted(set(doc.get(k, [])) | {'KHR_mesh_quantization'})
    js = json.dumps(doc, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    while len(out) % 4: out.append(0)
    blob = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    open(path, 'wb').write(blob)

def verify_glb(path):
    """Parse the written GLB back and check the runtime contract."""
    raw = open(path, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl]); bin0 = raw[20 + jl + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}
    def read(ai):
        a = doc['accessors'][ai]; bv = doc['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
        d = np.frombuffer(bin0, dt, a['count'] * n, bv.get('byteOffset', 0)).reshape(a['count'], n).astype(np.float64)
        return d / np.iinfo(dt).max if a.get('normalized') else d
    assert len(doc['meshes']) == 1 and len(doc['skins']) == 1, 'one skinned mesh'
    joints = [doc['nodes'][j]['name'] for j in doc['skins'][0]['joints']]
    assert set(joints) == set(ORDER), joints
    for j in doc['skins'][0]['joints']:
        assert 'rotation' not in doc['nodes'][j] or np.allclose(doc['nodes'][j]['rotation'], [0, 0, 0, 1], atol=1e-6), doc['nodes'][j]
    mats = [m['name'] for m in doc['materials']]; assert sorted(mats) == sorted(['CrabShell', 'CrabBody', 'CrabEye']), mats
    tri = 0; prim_info = {}
    for prim in doc['meshes'][0]['primitives']:
        tri += doc['accessors'][prim['indices']]['count'] // 3
        at = prim['attributes']; col = read(at['COLOR_0'])
        assert doc['accessors'][at['COLOR_0']]['type'] == 'VEC4' and 'TEXCOORD_0' not in at
        prim_info[mats[prim['material']]] = {'vertices': len(col), 'rgb_mean': [round(float(x), 3) for x in col[:, :3].mean(0)],
                                             'alpha_range': [round(float(col[:, 3].min()), 3), round(float(col[:, 3].max()), 3)],
                                             'alpha_mean': round(float(col[:, 3].mean()), 3)}
        assert col[:, :3].std(0).max() > .02 and col[:, :3].mean(0).min() < .97, ('COLOR_0 must carry the authored colour', prim_info)
    anims = {}
    for an in doc['animations']:
        anims[an['name']] = round(max(doc['accessors'][s['input']]['max'][0] for s in an['samplers']), 4)
    return {'joints': joints, 'materials': mats, 'triangles': tri, 'animations': anims, 'primitives': prim_info,
            'pinch_has_hit_key': any(abs(t - PINCH_HIT) < 1e-4 for an in doc['animations'] if an['name'] == 'Pinch'
                                     for s in an['samplers'][:1] for t in read(s['input'])[:, 0]),
            'channels': {an['name']: len(an['channels']) for an in doc['animations']}}

tri_count = sum(len(p.vertices) - 2 for p in me.polygons)
parts = {}
for f in G.F: parts[G.part[f[0]]] = parts.get(G.part[f[0]], 0) + len(f) - 2
PA = np.array([tuple(p) for p in G.P])
REPORT = {'rest_bounds_m': {'x': [round(float(PA[:, 0].min()), 3), round(float(PA[:, 0].max()), 3)], 'y': [round(float(PA[:, 1].min()), 3), round(float(PA[:, 1].max()), 3)],
                            'z': [round(float(PA[:, 2].min()), 3), round(float(PA[:, 2].max()), 3)]},
          'triangles': tri_count, 'triangles_by_part': parts, 'vertices': len(me.vertices), 'materials': [m.name for m in me.materials],
          'bones': len(ORDER), 'clip_checks': CHECK}
assert tri_count <= 9000, REPORT
assert all(abs(sum(g.weight for g in v.groups) - 1) < 1e-3 and 1 <= len(v.groups) <= 2 for v in me.vertices), 'rigid, normalized weights'
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=False,
                          export_optimize_animation_size=False, export_def_bones=False, export_anim_single_armature=True,
                          export_morph=False, export_materials='EXPORT', export_normals=True, export_texcoords=False,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_extras=False)
quantize_glb(OUT)
REPORT['bytes'] = os.path.getsize(OUT)
REPORT['glb'] = verify_glb(OUT); REPORT['glb'].update(QUANT)
REPORT['seconds'] = round(time.time() - T0, 1)
assert REPORT['bytes'] <= 400 * 1024, REPORT['bytes']
assert REPORT['glb']['triangles'] <= 9000
want_clips = {'Idle': IDLE_T, 'Scuttle': SCUTTLE_T, 'Pinch': PINCH_T, 'Hurt': HURT_T, 'Death': DEATH_T, 'Emerge': EMERGE_T}
assert all(abs(REPORT['glb']['animations'].get(k, -1) - v) < 1e-3 for k, v in want_clips.items()), REPORT['glb']['animations']
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
rep = dict(REPORT); rep['glb'] = {k: v for k, v in REPORT['glb'].items() if k != 'joints'}; rep['glb']['joints'] = len(REPORT['glb']['joints'])
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(rep, fh, indent=2)
print(json.dumps(rep))

# ===================================================================== review renders
if RENDER:
    from PIL import Image
    os.makedirs(RENDER, exist_ok=True)
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 40)); SC.cycles.device = 'CPU'
    try: SC.cycles.use_denoising = True
    except Exception: pass
    SC.render.resolution_x, SC.render.resolution_y = int(arg('--w', 640)), int(arg('--h', 480))
    SC.view_settings.view_transform = 'Filmic'; SC.view_settings.look = 'Medium High Contrast'   # nearest to the game's ACES
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True; wn = w.node_tree
    bg = wn.nodes['Background']; bg.inputs['Color'].default_value = (.5, .44, .4, 1); bg.inputs['Strength'].default_value = .4
    def area(name, loc, size, energy, col):
        l = bpy.data.lights.new(name, 'AREA'); l.size = size; l.energy = energy; l.color = col
        o = bpy.data.objects.new(name, l); SC.collection.objects.link(o); o.location = to_b(loc)
        o.rotation_euler = (to_b(V(0, .25, 0)) - to_b(loc)).to_track_quat('-Z', 'Y').to_euler(); return l
    KEY = area('key', V(1.4, 1.9, 1.6), 2.2, 170, (1, .93, .84))
    FILL = area('fill', V(-1.8, .9, 1.0), 2.0, 50, (.85, .9, 1))
    RIM = area('rim', V(-.4, 1.4, -1.8), 1.2, 120, (1, .95, .9))
    fl = bpy.data.meshes.new('floor'); fl.from_pydata([(-8, -8, 0), (8, -8, 0), (8, 8, 0), (-8, 8, 0)], [], [(0, 1, 2, 3)])
    fo = bpy.data.objects.new('floor', fl); SC.collection.objects.link(fo)
    fm = bpy.data.materials.new('floor'); fnt, fb = principled(fm); fb.inputs['Base Color'].default_value = (.42, .33, .3, 1); fb.inputs['Roughness'].default_value = .85; fl.materials.append(fm)
    # preview of the runtime look: shell = soft subsurface salt with a faint glow from the mask; eyes glossy; body satin
    for m in MATS:
        nt = m.node_tree; vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
        nt.links.new(vc.outputs['Color'], nt.nodes['Principled BSDF'].inputs['Base Color'])
    nt = M_SHELL.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Subsurface Weight'].default_value = .35; b.inputs['Subsurface Radius'].default_value = (1.0, .45, .45); b.inputs['Subsurface Scale'].default_value = .03
    b.inputs['Coat Weight'].default_value = .35; b.inputs['Coat Roughness'].default_value = .08
    vc = [n for n in nt.nodes if n.bl_idname == 'ShaderNodeVertexColor'][0]
    em = nt.nodes.new('ShaderNodeMath'); em.operation = 'MULTIPLY'; nt.links.new(vc.outputs['Alpha'], em.inputs[0]); em.inputs[1].default_value = .25
    glow_col = nt.nodes.new('ShaderNodeRGB'); glow_col.outputs[0].default_value = (1.0, .45, .38, 1)
    nt.links.new(glow_col.outputs[0], b.inputs['Emission Color']); nt.links.new(em.outputs[0], b.inputs['Emission Strength'])
    GLOW = em.inputs[1]
    b = M_BODY.node_tree.nodes['Principled BSDF']; b.inputs['Coat Weight'].default_value = .25; b.inputs['Coat Roughness'].default_value = .25
    b = M_EYE.node_tree.nodes['Principled BSDF']; b.inputs['Coat Weight'].default_value = .3; b.inputs['Coat Roughness'].default_value = .04
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    def shot(name, eye, at, lens=50):
        cam.lens = lens; co.location = to_b(eye); co.rotation_euler = (to_b(at) - to_b(eye)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
        return SC.render.filepath
    only = arg('--only'); want = lambda n: not only or n in only.split(',')
    PREV_Q.clear(); apply({})
    VIEWS = {'front': ((0, .32, 2.3), (0, .25, 0), 50), 'three-quarter': ((1.45, .95, 1.6), (0, .23, 0), 50),
             'side': ((2.3, .3, 0), (0, .25, -.02), 50), 'top': ((0, 2.5, .01), (0, 0, 0), 50),
             'face': ((.35, .42, .95), (-.02, .32, .12), 75), 'back': ((-1.3, 1.0, -1.7), (0, .25, -.05), 50),
             'phone-10m': ((3.4, 2.2, 9.3), (0, .25, 0), 24)}
    for vn_, (e, a, lens) in VIEWS.items():
        if want(vn_): shot(vn_, e, a, lens)
    if want('glow'):   # dark mine variant: lamps down, the salt glowing from within
        KEY.energy, FILL.energy, RIM.energy = 6, 2, 14; bg.inputs['Strength'].default_value = .01; GLOW.default_value = 3.0
        fb.inputs['Base Color'].default_value = (.12, .07, .07, 1)
        shot('glow-three-quarter', *VIEWS['three-quarter']); shot('glow-back', *VIEWS['back'])
        KEY.energy, FILL.energy, RIM.energy = 170, 50, 120; bg.inputs['Strength'].default_value = .4; GLOW.default_value = .25
        fb.inputs['Base Color'].default_value = (.42, .33, .3, 1)
    if want('strips'):
        SC.render.resolution_x, SC.render.resolution_y = 320, 260
        for cname, (fn, T, loop) in CLIPS.items():
            fracs = [0, .2, .4, .6, .8, 1.0] if cname != 'Pinch' else [0, .2 / .7, .3 / .7, PINCH_HIT / .7, .5 / .7, 1.0]
            tiles = []
            for k, fr in enumerate(fracs):
                t = round(T * fr, 6)
                PREV_Q.clear(); apply(fn(0.0 if (loop and fr == 1.0) else t))
                e, a = ((1.15, .75, 1.3), (0, .2, .04)) if cname != 'Death' else ((.5, .9, 1.75), (-.12, .18, 0))
                tiles.append(shot(f'_{cname}_{k}', e, a, 40))
            ims = [Image.open(p) for p in tiles]; W_, H_ = ims[0].size
            strip = Image.new('RGB', (W_ * len(ims), H_))
            for k, im in enumerate(ims): strip.paste(im.convert('RGB'), (k * W_, 0))
            strip.save(os.path.join(RENDER, f'clip-{cname.lower()}.png'))
            for p in tiles: os.remove(p)
        SC.render.resolution_x, SC.render.resolution_y = int(arg('--w', 640)), int(arg('--h', 480))
    PREV_Q.clear(); apply({})
print('SALTBACK_BUILD_OK')
