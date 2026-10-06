"""Skyfire, the streak dragon (level 2) - reproducible Blender (bpy 4.5) builder.

Run:  python3.11 build_skyfire_dragon.py -- --out ../../public/assets/skyfire-dragon.glb
      python3.11 build_skyfire_dragon.py -- --render out/review          (also writes the GLB to out/)
      (pip install bpy==4.5.* numpy)
Prints SKYFIRE_BUILD_OK as its last line on success. Blender can exit 0 after a Python traceback, so check for it.

Identity: a chubby-but-powerful red hero dragon you want to ride. One big readable mass (a deep chest and round
belly), a tapered neck and tail, a big friendly head with huge amber eyes, cream horns and a golden belly, and orange
bat wings with crisp finger bones and scalloped trailing edges. Signature features:
  1. Ember belly: the golden belly plates from chest to throat are a separate "Ember" material that smoulders softly
     and lights up in a wave running up the throat into the open mouth while the dragon breathes fire.
  2. Golden crest and flame tail: a row of golden spines runs from the head down the back to a glowing flame-shaped
     tail tip.

Everything is authored in the game frame (X lateral, Y up, Z forward = the way the dragon faces in three.js,
units = metres before DRAGON_SCALE) and converted to Blender's Z-up on the way in, so the numbers here match
client/dragon-art.js. One skinned mesh, three materials (SkyfireHide, SkyfireWing, SkyfireEmber), vertex colours with
baked ambient occlusion, one 256 px scale tile, and a 31-bone armature weighted analytically (no heat solver).
TEXCOORD_1 carries two masks: x = how much of the scale tile shows (hide) or how hot a plate glows (ember), and
y = position along the throat for the breath wave (ember; -1 marks the tail flame), stored as (y + 1) / 2.5.
After export the GLB is repacked with KHR_mesh_quantization (byte normals, byte colours and weights, 16-bit masks).
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy, bmesh, math, json, time
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

T0 = time.time()
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'skyfire-dragon.glb'))
RENDER = arg('--render')
TAU = math.tau

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def lin(h):
    return tuple((int(h[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4))
def mix(c1, c2, t): return tuple(a + (b - a) * t for a, b in zip(c1, c2))
def mul(c, k): return tuple(a * k for a in c)
def to_b(p): return Vector((p[0], -p[2], p[1]))   # game (x, y up, z fwd) -> Blender (x, y back, z up)

# ------------------------------------------------------------------ palette (sRGB hex, stored linear)
C = {k: lin(v) for k, v in dict(
    back='7e1613', flank='d8432c', side='ec6a34', belly='ffc24a', belly_lo='ffad3a', groove='d4762c', stripe='5a0f0d',
    head_top='c9301f', snout='e2533a', blush='ff8a78', lip='6e1512', mouth='5c1018', tongue='e0566c',
    horn_base='e9cf9c', horn='fff0cf', horn_tip='fffaf0', gold='f4b234', gold_tip='ffe58a', claw='f8e8c8',
    eye_white='fffaf2', iris_in='ffd45a', iris_out='e5861a', iris_ring='4a200c', pupil='120a08', nostril='3a0c0a',
    brow='8e1d16', wing_root='e0482a', wing_mid='ff7c2e', wing_edge='ffb347', wing_vein='c0321e', arm='a8291f',
    flame='ffa42a', flame_tip='ffe680').items()}

# ------------------------------------------------------------------ geometry accumulator
class Geo:
    def __init__(self):
        self.P, self.col, self.W, self.mask, self.aok = [], [], [], [], []
        self.F, self.FM, self.FUV = [], [], []
    def v(self, p, col, w, mask=(0.0, 0.0), aok=1.0):
        self.P.append(Vector(p)); self.col.append(col); self.W.append(w); self.mask.append(mask); self.aok.append(aok)
        return len(self.P) - 1
    def f(self, idx, mat, uvs=None):
        self.F.append(list(idx)); self.FM.append(mat); self.FUV.append(uvs or [(0.5, 0.42)] * len(idx))
G = Geo()
HIDE, WING, EMBER = 0, 1, 2

# ------------------------------------------------------------------ spine: tail tip -> snout, in the (z, y) plane
CP = [(-6.9, .55), (-5.8, .26), (-4.5, 0), (-3.2, -.1), (-2.0, -.04), (-.8, 0), (.4, .04), (1.4, .2), (2.1, .52),
      (2.7, .86), (3.2, 1.08), (3.7, 1.18), (4.2, 1.12), (4.88, 1.0)]
def catmull(pts, n=60):
    out = []; P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = (np.array(P[j]) for j in (i - 1, i, i + 1, i + 2))
        for k in range(n):
            t = k / n
            out.append(.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(np.array(pts[-1])); return np.array(out)
SP = catmull(CP)
SL = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(SP, axis=0), axis=1))])
SPINE_LEN = SL[-1]
def spine_at(s):
    z = np.interp(s, SL, SP[:, 0]); y = np.interp(s, SL, SP[:, 1])
    s0, s1 = max(0, s - .02), min(SPINE_LEN, s + .02)
    t = Vector((0, np.interp(s1, SL, SP[:, 1]) - np.interp(s0, SL, SP[:, 1]), np.interp(s1, SL, SP[:, 0]) - np.interp(s0, SL, SP[:, 0]))).normalized()
    return Vector((0, y, z)), t
def spine_y(z): return float(np.interp(z, SP[:, 0], SP[:, 1]))
def s_of_z(z): return float(np.interp(z, SP[:, 0], SL))

# Cross-section keys by spine z: half width, height above and depth below the spine, superellipse exponents.
KEYS = [  # z,    w,    top,  bot,  n_top, n_bot
    (-6.9, .05, .05, .05, 2.0, 2.0), (-6.2, .13, .12, .12, 2.1, 2.1), (-5.1, .24, .22, .22, 2.2, 2.2),
    (-3.9, .36, .35, .34, 2.25, 2.3), (-2.6, .48, .47, .46, 2.3, 2.4), (-1.7, .62, .6, .6, 2.3, 2.4),
    (-.9, .74, .68, .74, 2.3, 2.3), (.6, 1.12, 1.08, 1.12, 2.4, 2.3), (1.45, .92, .92, .82, 2.4, 2.4),
    (2.1, .52, .5, .54, 2.3, 2.4), (2.7, .4, .41, .44, 2.3, 2.5), (3.15, .47, .48, .5, 2.3, 3.0),
    (3.5, .61, .55, .36, 2.4, 3.6), (3.85, .63, .54, .26, 2.45, 4.0), (4.2, .48, .4, .2, 2.4, 4.0),
    (4.55, .37, .3, .14, 2.4, 4.0), (4.75, .3, .23, .1, 2.4, 4.0), (4.86, .17, .13, .07, 2.3, 3.0)]
KZ = np.array([k[0] for k in KEYS])
def key(z, i):
    vals = [k[i] for k in KEYS]; z = min(max(z, KZ[0]), KZ[-1])
    j = int(np.searchsorted(KZ, z, side='right') - 1); j = min(j, len(KZ) - 2)
    z0, z1 = KZ[j], KZ[j + 1]; t = (z - z0) / (z1 - z0); h = z1 - z0
    def m(k):
        a, b = max(k - 1, 0), min(k + 1, len(KZ) - 1)
        return (vals[b] - vals[a]) / (KZ[b] - KZ[a])
    m0, m1 = m(j) * h * .8, m(j + 1) * h * .8
    t2, t3 = t * t, t * t * t
    return (2 * t3 - 3 * t2 + 1) * vals[j] + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * vals[j + 1] + (t3 - t2) * m1
def se(c, n): return math.copysign(abs(c) ** (2 / n), c)

# ------------------------------------------------------------------ bones (game frame); weights reference these names
SPINE_JOINTS = [(-6.9, 'Tail6'), (-5.95, 'Tail5'), (-5.05, 'Tail4'), (-4.2, 'Tail3'), (-3.4, 'Tail2'), (-2.55, 'Tail1'),
                (-1.7, 'Hips'), (-.3, 'Body'), (.8, 'Chest'), (1.75, 'Neck1'), (2.35, 'Neck2'), (2.85, 'Neck3'), (3.25, 'Head'), (4.9, None)]
def spine_weights(z):
    """Blend between the spine bones whose segment holds z, smoothing across each joint."""
    zs = [j[0] for j in SPINE_JOINTS]; names = [j[1] for j in SPINE_JOINTS[:-1]]
    z = min(max(z, zs[0]), zs[-1] - 1e-4)
    i = max(0, min(len(names) - 1, int(np.searchsorted(zs, z, side='right') - 1)))
    w = {names[i]: 1.0}
    for jn in (i, i + 1):  # joint at zs[jn] between names[jn-1] and names[jn]
        if jn <= 0 or jn >= len(names): continue
        h = .32 * min(zs[jn] - zs[jn - 1], zs[jn + 1] - zs[jn])
        if abs(z - zs[jn]) < h:
            t = smoothstep(-h, h, z - zs[jn]); return {names[jn - 1]: 1 - t, names[jn]: t}
    return w

WING_S = (.66, .78, 1.0); WING_E = (2.25, 1.08, .5); WING_W = (3.8, 1.2, 1.0)
WING_F = [(6.4, 1.0, -.3), (5.35, .88, -1.8), (3.4, .78, -2.6)]
WING_R = (.6, .5, -1.15)
JAW_HINGE = (0, .95, 3.42)
NECK_LIFT = .26
BONES = {}  # name: (head, tail, parent)
def spine_pt(z): return (0.0, spine_y(z), z)
BONES['Body'] = (spine_pt(-.3), spine_pt(.8), None)
BONES['Chest'] = (spine_pt(.8), spine_pt(1.75), 'Body')
BONES['Neck1'] = (spine_pt(1.75), spine_pt(2.35), 'Chest')
BONES['Neck2'] = (spine_pt(2.35), spine_pt(2.85), 'Neck1')
BONES['Neck3'] = (spine_pt(2.85), spine_pt(3.25), 'Neck2')
BONES['Head'] = (spine_pt(3.25), spine_pt(4.9), 'Neck3')
BONES['Jaw'] = (JAW_HINGE, (0, .86, 4.75), 'Head')
BONES['Horns'] = ((0, 1.62, 3.42), (0, 1.98, 3.0), 'Head')
BONES['Hips'] = (spine_pt(-.3), spine_pt(-1.7), 'Body')
prev = 'Hips'
for i, (za, zb) in enumerate([(-1.7, -2.55), (-2.55, -3.4), (-3.4, -4.2), (-4.2, -5.05), (-5.05, -5.95), (-5.95, -6.9)]):
    BONES[f'Tail{i + 1}'] = (spine_pt(za), spine_pt(zb), prev); prev = f'Tail{i + 1}'
for side, sfx in ((1, 'L'), (-1, 'R')):
    m = lambda p: (side * p[0], p[1], p[2])
    BONES[f'Brow{sfx}'] = (m((.4, 1.76, 4.01)), m((.62, 1.7, 3.8)), 'Head')
    BONES[f'WingArm{sfx}'] = (m(WING_S), m(WING_E), 'Chest')
    BONES[f'WingFore{sfx}'] = (m(WING_E), m(WING_W), f'WingArm{sfx}')
    for k in range(3): BONES[f'WingF{k + 1}{sfx}'] = (m(WING_W), m(WING_F[k]), f'WingFore{sfx}')
    BONES[f'LegF{sfx}'] = (m((.55, -.38, 1.05)), m((.64, -1.06, 1.3)), 'Chest')
    BONES[f'LegH{sfx}'] = (m((.55, -.28, -1.15)), m((.68, -1.0, -1.95)), 'Hips')

# ------------------------------------------------------------------ the body: one loft from tail tip to snout
K = 22
def hide_colour(z, t_up, x, y, s, groove):
    """Dark back, red flanks, golden belly plates; chevron stripes on the back; a blush on the cheeks."""
    head = smoothstep(3.0, 3.4, z)
    back = mix(C['back'], C['head_top'], head)
    c = mix(C['flank'], back, smoothstep(.56, .97, t_up))
    c = mix(C['side'], c, smoothstep(.2, .42, t_up))
    if z > 4.1: c = mix(c, C['snout'], .45 * smoothstep(4.1, 4.6, z) * smoothstep(.2, .6, t_up))
    b = smoothstep(.31, .2, t_up) * (1 - smoothstep(3.3, 3.6, z)) * smoothstep(-6.4, -5.6, z)
    belly = mix(C['belly'], C['belly_lo'], smoothstep(1.5, -2, z))
    if groove: belly = mix(belly, C['groove'], .5 * smoothstep(.6, .95, b))
    c = mix(c, belly, b)
    if z < 1.7 and t_up > .55:   # chevrons running down the back and tail
        p = .5 + .5 * math.cos(TAU * (s / 1.05 + .55 * (1 - t_up)))
        c = mix(c, C['stripe'], .55 * smoothstep(.45, .95, p) * smoothstep(.55, .8, t_up) * smoothstep(1.7, 1.0, z))
    for sx in (-1, 1):  # cheeks
        d = (Vector((x, y, z)) - Vector((sx * .5, .98, 3.66))).length
        c = mix(c, C['blush'], .75 * smoothstep(.26, .08, d))
    return c, b

s = 0.0; ring_list = []
while s < SPINE_LEN - 1e-3:
    ring_list.append(s)
    z = float(np.interp(s, SL, SP[:, 0]))
    s += .24 if z < -1.8 else .2 if z < 1.6 else .15 if z < 3.05 else .085
ring_list.append(SPINE_LEN - .005)
EMBER_MASK = {}
body_rings = []
for ri, s in enumerate(ring_list):
    c0, t = spine_at(s); z = c0.z
    X = Vector((1, 0, 0)); N = Vector((0, t.z, -t.y)).normalized()
    w, top, bot, nt, nb = (key(z, i) for i in range(1, 6))
    groove = (ri % 2 == 0) and z < 3.25
    ring = []
    for k in range(K):
        th = -math.pi / 2 + TAU * k / K; cx, cy = math.cos(th), math.sin(th)
        n = nt if cy >= 0 else nb
        x = w * se(cx, n); y = (top if cy >= 0 else bot) * se(cy, n)
        if cy > 0: y += .035 * cy ** 14 * smoothstep(-6.1, -5.1, z) * (1 - smoothstep(3.0, 3.3, z))   # dorsal ridge
        if groove and cy < -.5: x *= .985; y *= .975                                                  # belly plate seams
        p = c0 + X * x + N * y
        t_up = (cy + 1) / 2
        col, belly = hide_colour(z, t_up, p.x, p.y, s, groove)
        scale_mask = (1 - belly) * (1 - .4 * smoothstep(3.2, 3.6, z))
        i = G.v(p, col, spine_weights(z), (scale_mask, 0.0))
        if belly > .5 and .05 < z < 3.3: EMBER_MASK[i] = (1.0 if not groove else .35, max(.01, (z - .05) / 3.2))
        ring.append(i)
    body_rings.append((ring, s, z))
def palate(z, t_up): return 3.56 < z < 4.9 and t_up < .14
for (ra, sa, za), (rb, sb, zb) in zip(body_rings, body_rings[1:]):
    for k in range(K):
        k1 = (k + 1) % K
        u0, u1 = k / K * 6, (k + 1) / K * 6
        zc = (za + zb) / 2; tu = (math.sin(-math.pi / 2 + TAU * (k + .5) / K) + 1) / 2
        mat = HIDE
        if palate(zc, tu):
            mat = EMBER
            for i in (ra[k], ra[k1], rb[k], rb[k1]): G.col[i] = C['mouth']; G.mask[i] = (1.0, 1.25)
        elif all(i in EMBER_MASK for i in (ra[k], ra[k1], rb[k], rb[k1])):
            mat = EMBER
        G.f((ra[k], ra[k1], rb[k1], rb[k]), mat, [(u0, sa / .8), (u1, sa / .8), (u1, sb / .8), (u0, sb / .8)])
# vertices of the glowing belly plates carry the ember mask instead of the scale mask
used_ember = set(i for f, m in zip(G.F, G.FM) if m == EMBER for i in f)
for i, m in EMBER_MASK.items():
    if i in used_ember and G.mask[i][1] < 1.2: G.mask[i] = m
# caps: tail tip and nose
ring, s_, z = body_rings[0]; c0, t = spine_at(0)
tip = G.v(c0 - t * .04, C['stripe'], spine_weights(z)); [G.f((ring[(k + 1) % K], ring[k], tip), HIDE) for k in range(K)]
ring, s_, z = body_rings[-1]; c0, t = spine_at(SPINE_LEN)
tip = G.v(c0 + t * .05 + Vector((0, .01, 0)), C['snout'], {'Head': 1.0}); [G.f((ring[k], ring[(k + 1) % K], tip), HIDE) for k in range(K)]

def surface_y(z, x=0.0):
    """Top of the body loft at (x, z) (approximate: superellipse top)."""
    w, top, nt = key(z, 1), key(z, 2), key(z, 4)
    u = min(.999, abs(x) / max(w, 1e-3)) ** (nt / 2) if x else 0
    return spine_y(z) + top * (1 - u ** 2) ** (1 / nt) if x else spine_y(z) + top

# ------------------------------------------------------------------ generic tube / ellipsoid helpers
def tube(path, radii, sides, colour, weight, mat=HIDE, cap0=True, cap1=True, squash=1.0, up=None, mask=(0.0, 0.0), aok=1.0, tipcol=None):
    """Smooth tube along a polyline with parallel-transported frames. colour(t, ang) and weight(t) get t in 0..1."""
    path = [Vector(p) for p in path]; n = len(path); ringsx = []
    tang = [(path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized() for i in range(n)]
    ref = Vector(up) if up else (Vector((0, 1, 0)) if abs(tang[0].y) < .9 else Vector((1, 0, 0)))
    nrm = (ref - tang[0] * ref.dot(tang[0])).normalized()
    for i in range(n):
        if i: nrm = (nrm - tang[i] * nrm.dot(tang[i])).normalized()
        bi = tang[i].cross(nrm); t = i / (n - 1); ring = []
        for k in range(sides):
            a = TAU * k / sides
            p = path[i] + (nrm * math.cos(a) + bi * math.sin(a) * squash) * radii[i]
            ring.append(G.v(p, colour(t, a), weight(t), mask, aok))
        ringsx.append(ring)
    for a, b in zip(ringsx, ringsx[1:]):
        for k in range(sides):
            k1 = (k + 1) % sides; G.f((a[k], a[k1], b[k1], b[k]), mat)
    if cap0:
        c = G.v(path[0] - tang[0] * radii[0] * .6, colour(0, 0), weight(0), mask, aok)
        for k in range(sides): G.f((ringsx[0][(k + 1) % sides], ringsx[0][k], c), mat)
    if cap1:
        c = G.v(path[-1] + tang[-1] * max(radii[-1] * .6, .0), tipcol or colour(1, 0), weight(1), mask, aok)
        for k in range(sides): G.f((ringsx[-1][k], ringsx[-1][(k + 1) % sides], c), mat)
    return ringsx

def bezier(p0, p1, p2, p3, n):
    p0, p1, p2, p3 = map(Vector, (p0, p1, p2, p3))
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]

def ball(c, r, axis, lats, sides, colour, weight, mat=HIDE, scale=(1, 1, 1), aok=1.0):
    """Sphere with its pole along axis and latitude rings at the given angles (radians from the pole)."""
    c = Vector(c); d = Vector(axis).normalized(); ref = Vector((0, 1, 0)) if abs(d.y) < .9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u)
    def P(a, phi):
        q = d * math.cos(a) + (u * math.cos(phi) + v * math.sin(phi)) * math.sin(a)
        return c + Vector((q.x * scale[0], q.y * scale[1], q.z * scale[2])) * r
    top = G.v(P(0, 0), colour(0, 0), weight, aok=aok); ringsx = []
    for a in lats[1:-1]:
        ringsx.append([G.v(P(a, TAU * k / sides), colour(a, TAU * k / sides), weight, aok=aok) for k in range(sides)])
    bot = G.v(P(math.pi, 0), colour(math.pi, 0), weight, aok=aok)
    for k in range(sides): G.f((top, ringsx[0][k], ringsx[0][(k + 1) % sides]), mat)
    for a, b in zip(ringsx, ringsx[1:]):
        for k in range(sides): k1 = (k + 1) % sides; G.f((a[k], b[k], b[k1], a[k1]), mat)
    for k in range(sides): G.f((ringsx[-1][(k + 1) % sides], ringsx[-1][k], bot), mat)

def fin(base, length, height, lean, width, weight, col0, col1, mat=HIDE, out=(0, 1, 0)):
    """A golden crest spine: diamond sections shrinking from a long thin base to a sharp tip, leaning back."""
    base = Vector(base); up = Vector(out).normalized(); fwd = Vector((0, 0, 1)); side = up.cross(fwd).normalized()
    if side.length < .5: side = Vector((1, 0, 0))
    secs = [(0, 1.0), (.3, .78), (.6, .48), (.85, .2)]; ringsx = []
    for h, k in secs:
        cc = base + up * (height * h) - fwd * (lean * h * h + length * .12 * h)
        pts = [cc + fwd * (length * .5 * k), cc + side * (width * k), cc - fwd * (length * .5 * k * 1.15), cc - side * (width * k)]
        ringsx.append([G.v(p, mix(col0, col1, h), weight) for p in pts])
    tipp = base + up * height - fwd * (lean + length * .12 + length * .05)
    tipv = G.v(tipp, col1, weight)
    for a, b in zip(ringsx, ringsx[1:]):
        for k in range(4): G.f((a[k], a[(k + 1) % 4], b[(k + 1) % 4], b[k]), mat)
    for k in range(4): G.f((ringsx[-1][k], ringsx[-1][(k + 1) % 4], tipv), mat)
    G.f(list(reversed(ringsx[0])), mat)

# ------------------------------------------------------------------ jaw (hinged lower jaw with a pink tongue on top)
JAW = [(3.3, .36, .93, .6), (3.55, .44, .93, .6), (3.9, .41, .935, .64), (4.25, .33, .935, .7), (4.55, .23, .935, .76), (4.76, .14, .93, .82)]
JK = 16; jrings = []
for zi, (z, w, yt, yb) in enumerate(JAW):
    yc, h = (yt + yb) / 2, (yt - yb) / 2; ring = []
    for k in range(JK):
        th = -math.pi / 2 + TAU * k / JK; cx, cy = math.cos(th), math.sin(th)
        n = 6.0 if cy > 0 else 2.3
        x = w * se(cx, n); y = yc + h * se(cy, n)
        t_up = (cy + 1) / 2
        col = mix(mix(C['belly'], C['side'], smoothstep(.25, .45, t_up)), C['flank'], smoothstep(.45, .7, t_up))
        if t_up > .8: col = mix(C['mouth'], C['tongue'], smoothstep(3.6, 4.3, z) * (1 - abs(cx) * 1.2))
        ring.append(G.v((x, y, z), col, {'Jaw': 1.0}, (1.0, 1.3) if t_up > .8 else (0.0, 0.0)))
    jrings.append(ring)
for a, b in zip(jrings, jrings[1:]):
    for k in range(JK):
        k1 = (k + 1) % JK; tu = (math.sin(-math.pi / 2 + TAU * (k + .5) / JK) + 1) / 2
        G.f((a[k], a[k1], b[k1], b[k]), EMBER if tu > .8 else HIDE)
cj = G.v((0, .8, 4.82), C['belly'], {'Jaw': 1.0})
for k in range(JK): G.f((jrings[-1][k], jrings[-1][(k + 1) % JK], cj), HIDE)
cb = G.v((0, .76, 3.22), C['belly'], {'Jaw': 1.0})
for k in range(JK): G.f((jrings[0][(k + 1) % JK], jrings[0][k], cb), HIDE)
# two little fangs peeking out over the lower lip
for sx in (-1, 1):
    tube([(sx * .215, .95, 4.5), (sx * .23, .87, 4.52), (sx * .235, .8, 4.53)], [.04, .03, .0], 5, lambda t, a: C['claw'], lambda t: {'Head': 1.0}, cap1=True)

# ------------------------------------------------------------------ face: big friendly eyes, brows, nostrils
LATS = [0, .14, .3, .38, .42, .5, .6, .64, .7, .95, 1.35, 1.8, 2.4, math.pi]
def eye_colour(a, phi):
    if a < .4: return C['pupil']
    if a < .44: return mix(C['pupil'], C['iris_in'], .6)
    if a < .62: return mix(C['iris_in'], C['iris_out'], smoothstep(.44, .62, a))
    if a < .67: return C['iris_ring']
    return C['eye_white']
for sx, sfx in ((1, 'L'), (-1, 'R')):
    ec = Vector((sx * .37, 1.43, 3.98)); look = Vector((sx * .5, .12, .86)).normalized()
    ball(ec, .215, look, LATS, 16, eye_colour, {'Head': 1.0}, aok=.35)
    hl = (look + Vector((0, .5, 0)) + Vector((sx * -.12, 0, 0))).normalized()
    ball(ec + hl * .2, .05, hl, [0, .8, 1.6, 2.4, math.pi], 8, lambda a, p: C['eye_white'], {'Head': 1.0}, aok=0)
    ball(ec + Vector((sx * -.2, -.35, .62)) * .22 + look * .02, .02, look, [0, 1.2, 2.0, math.pi], 6, lambda a, p: C['eye_white'], {'Head': 1.0}, aok=0)
    brow = bezier((sx * .2, 1.68, 4.08), (sx * .32, 1.79, 4.07), (sx * .5, 1.79, 3.96), (sx * .62, 1.7, 3.8), 7)
    tube(brow, [.035, .05, .06, .06, .055, .045, .03], 7, lambda t, a: C['brow'], lambda t: {f'Brow{sfx}': 1.0}, up=(0, 1, 0))
    ball((sx * .105, 1.17, 4.84), .05, (sx * .3, .3, 1), [0, .6, 1.2, 1.9, 2.5, math.pi], 8, lambda a, p: C['nostril'], {'Head': 1.0}, scale=(1.2, .8, .7), aok=.5)

# ------------------------------------------------------------------ horns, cheek frills, head crest (all on the Horns bone)
def horn_col(t, a): return mix(mix(C['horn_base'], C['horn'], smoothstep(0, .35, t)), C['horn_tip'], smoothstep(.6, 1, t))
for sx in (-1, 1):
    hp = bezier((sx * .27, 1.6, 3.6), (sx * .36, 1.86, 3.28), (sx * .46, 1.98, 2.92), (sx * .42, 2.24, 2.62), 11)
    tube(hp, [.135 * (1 - .9 * (i / 10) ** 1.2) for i in range(11)], 9, horn_col, lambda t: {'Horns': 1.0}, cap0=True)
    fp = bezier((sx * .5, 1.4, 3.56), (sx * .7, 1.46, 3.38), (sx * .84, 1.55, 3.18), (sx * .92, 1.66, 3.02), 7)
    tube(fp, [.085 * (1 - .9 * (i / 6) ** 1.1) for i in range(7)], 7, horn_col, lambda t: {'Horns': 1.0})
for k, (z, h) in enumerate([(3.62, .22), (3.38, .2)]):
    fin((0, surface_y(z) - .05, z), .26, h, .1, .055, {'Horns': 1.0}, C['gold'], C['gold_tip'])

# ------------------------------------------------------------------ crest spines down the neck, back and tail
CREST = [(3.0, .14), (2.66, .16), (2.32, .17), (1.3, .3), (.88, .38), (.46, .42), (.04, .43), (-.38, .42), (-.8, .4), (-1.22, .37),
         (-1.66, .34), (-2.1, .31), (-2.55, .28), (-3.0, .25), (-3.48, .22), (-3.98, .19), (-4.5, .16), (-5.05, .13), (-5.6, .11)]
for z, h in CREST:
    s = s_of_z(z); c0, t = spine_at(s); N = Vector((0, t.z, -t.y)).normalized()
    base = c0 + N * (key(z, 2) + .02 - .05)
    fin(base, .34 * min(1, h / .3) + .06, h, h * .45, .06 * min(1, h / .25) + .02, spine_weights(z), C['gold'], C['gold_tip'], out=N)

# ------------------------------------------------------------------ tail flame (Ember): a flat three-tongued flame
def flame_tail():
    s = s_of_z(-6.75); c0, t = spine_at(s)
    base = c0; fwd = -t                                          # pointing back along the tail
    side = Vector((1, 0, 0)); up = fwd.cross(side).normalized() * -1
    # outline in (lateral, along) with the tail at (0, 0); three tongues, the middle one longest
    outline = [(0, -.05), (.2, .05), (.38, .28), (.46, .55), (.36, .82), (.43, 1.05), (.24, .9), (.16, 1.2), (.06, 1.02), (0, 1.42)]
    outline = outline + [(-x, y) for x, y in reversed(outline[1:-1])]
    n = len(outline); w = {'Tail6': 1.0}
    centre = base + fwd * .5
    def P(x, y, lift): return base + side * x * 1.0 + fwd * y * 1.0 + up * lift
    top_c = G.v(centre + up * .09, C['flame'], w, (1.0, -1.0)); bot_c = G.v(centre - up * .09, C['flame'], w, (1.0, -1.0))
    mids_t, mids_b, edge = [], [], []
    for x, y in outline:
        col = mix(C['flame'], C['flame_tip'], smoothstep(.6, 1.3, y))
        mx, my = lerp(0, x, .55), lerp(.5, y, .55)
        mids_t.append(G.v(P(mx, my, .065), mix(C['flame'], col, .5), w, (1.0, -1.0)))
        mids_b.append(G.v(P(mx, my, -.065), mix(C['flame'], col, .5), w, (1.0, -1.0)))
        edge.append(G.v(P(x, y, 0), col, w, (1.0, -1.0)))
    for k in range(n):
        k1 = (k + 1) % n
        G.f((top_c, mids_t[k], mids_t[k1]), EMBER); G.f((mids_t[k], edge[k], edge[k1], mids_t[k1]), EMBER)
        G.f((bot_c, mids_b[k1], mids_b[k]), EMBER); G.f((mids_b[k1], edge[k1], edge[k], mids_b[k]), EMBER)
flame_tail()

# ------------------------------------------------------------------ legs: chunky thighs, tucked forelegs, cream claws
def leg(sx, sfx, path, radii, kind):
    bone = f'Leg{kind}{sfx}'; root = 'Chest' if kind == 'F' else 'Hips'
    def wt(t):
        k = smoothstep(.1, .38, t); return {root: 1 - k, bone: k} if k < 1 else {bone: 1.0}
    def col(t, a): return mix(C['flank'], C['side'], smoothstep(.2, .7, t))
    pts = bezier(*[(sx * p[0], p[1], p[2]) for p in path], 9)
    rr = [lerp(radii[0], radii[1], smoothstep(0, .45, i / 8)) if i < 4 else lerp(radii[1], radii[2], smoothstep(.45, 1, i / 8)) for i in range(9)]
    tube(pts, rr, 10, col, wt, cap0=False)
    end = pts[-1]
    claws_dir = [Vector((sx * .25, -.35, 1)), Vector((0, -.4, 1)), Vector((-sx * .25, -.35, 1))] if kind == 'F' else \
                [Vector((sx * .3, -.25, -1)), Vector((0, -.3, -1)), Vector((-sx * .3, -.25, -1))]
    for k, d in enumerate(claws_dir):
        d = d.normalized(); b = end + Vector((sx * (.07 - .07 * k), -.03, 0)) + d * .06
        tube([b, b + d * .1, b + d * .2 + Vector((0, -.04, 0))], [.05, .035, 0], 5, lambda t, a: C['claw'], lambda t: {bone: 1.0})
for sx, sfx in ((1, 'L'), (-1, 'R')):
    leg(sx, sfx, [(.5, -.3, 1.05), (.78, -.86, .78), (.7, -1.08, 1.05), (.62, -1.08, 1.32)], (.3, .2, .13), 'F')
    leg(sx, sfx, [(.5, -.2, -1.12), (.92, -.62, -.62), (.76, -1.02, -1.42), (.66, -1.0, -1.98)], (.5, .26, .15), 'H')

# ------------------------------------------------------------------ wings (SkyfireWing): bones and scalloped membrane
def wing(sx, sfx):
    m = lambda p: Vector((sx * p[0], p[1], p[2]))
    S, E, W, R = m(WING_S), m(WING_E), m(WING_W), m(WING_R); F = [m(f) for f in WING_F]
    A, Fo = f'WingArm{sfx}', f'WingFore{sfx}'; FB = [f'WingF{k + 1}{sfx}' for k in range(3)]
    arm_col = lambda t, a: C['arm']
    tube([S, (S + E) / 2 + Vector((0, .05, 0)), E], [.22, .16, .13], 7, arm_col, lambda t: {'Chest': 1 - smoothstep(0, .3, t), A: smoothstep(0, .3, t)}, WING, cap0=False, cap1=False)
    tube([E, (E + W) / 2, W], [.12, .1, .1], 7, arm_col, lambda t: {A: 1 - smoothstep(0, .35, t), Fo: smoothstep(0, .35, t)}, WING, cap0=True, cap1=False)
    ball(W, .14, (0, 1, 0), [0, .7, 1.4, 2.1, 2.7, math.pi], 8, lambda a, p: C['arm'], {Fo: 1.0}, WING)
    thumb = W + m((.05, .08, .16))
    tube([W + m((0, .02, .06)), thumb, thumb + m((-.02, .02, .14))], [.07, .05, 0], 6, lambda t, a: mix(C['arm'], C['claw'], smoothstep(.2, .6, t)), lambda t: {Fo: 1.0}, WING)
    for k in range(3):
        d = (F[k] - W); pts = [W + d * u for u in (0, .1, .35, .65, .9, 1.0)]
        tube(pts, [.085, .075, .06, .045, .03, .0], 6, lambda t, a: mix(C['arm'], C['claw'], smoothstep(.86, .95, t)), lambda t, b=FB[k]: {Fo: 1 - smoothstep(0, .12, t), b: smoothstep(0, .12, t)}, WING, cap0=False)

    def mcol(r, edge_t, near_bone):
        c = mix(C['wing_root'], C['wing_mid'], smoothstep(0, .55, r)); c = mix(c, C['wing_edge'], smoothstep(.6, 1, r))
        return mix(c, C['wing_vein'], .55 * near_bone)
    def grid(Pfun, Wfun, nr, nt, flip):
        idx = [[None] * (nt + 1) for _ in range(nr + 1)]
        for i in range(nr + 1):
            for j in range(nt + 1):
                r, t = i / nr, j / nt; p, col = Pfun(r, t)
                idx[i][j] = G.v(p, col, Wfun(r, t))
        for i in range(nr):
            for j in range(nt):
                q = (idx[i][j], idx[i + 1][j], idx[i + 1][j + 1], idx[i][j + 1])
                G.f(q if flip else q[::-1], WING)
    def scallop(a, b, t, depth, toward):
        e = a.lerp(b, t); return e + (toward - e).normalized() * depth * math.sin(math.pi * t)
    # outer panels between neighbouring fingers
    for k in range(2):
        a, b = F[k], F[k + 1]; depth = .3 * (a - b).length
        def P(r, t, a=a, b=b, depth=depth):
            e = scallop(a, b, t, depth, W); p = W.lerp(e, r)
            nb = max(smoothstep(.12, 0, t), smoothstep(.88, 1, t)) * smoothstep(.05, .3, r)
            return p, mcol(r, t, nb)
        def Wt(r, t, k=k):
            fo = (1 - r) ** 2; out = {Fo: fo}
            out[FB[k]] = (1 - fo) * (1 - t); out[FB[k + 1]] = out.get(FB[k + 1], 0) + (1 - fo) * t
            return out
        grid(P, Wt, 7, 9, sx > 0)
    # inner panel from the last finger round the forearm, upper arm and flank, with two scallops to the body
    inner = [W, E, S, R]
    def along(t):  # wrist -> elbow -> shoulder -> body root along the arm and flank
        seg = [(0, .38), (.38, .72), (.72, 1.0)]
        for (t0, t1), p0, p1 in zip(seg, inner, inner[1:]):
            if t <= t1 + 1e-9: return p0.lerp(p1, (t - t0) / (t1 - t0))
        return R
    def trail(t):
        a, b = F[2], R; mid = a.lerp(b, .5) + Vector((0, 0, .25))
        if t < .5: return scallop(a, mid, t * 2, .26 * (a - mid).length, along(t * .7))
        return scallop(mid, b, (t - .5) * 2, .22 * (mid - b).length, along(.4 + .6 * t))
    def P(r, t):
        p = along(t).lerp(trail(t), r)
        nb = smoothstep(.1, 0, t) * smoothstep(.05, .3, r) + .5 * smoothstep(.2, 0, r) * (1 - smoothstep(.8, 1, t))
        return p, mcol(r * (1 - .4 * t), t, min(1, nb))
    def Wt(r, t):
        if t < .38: inner_w = {Fo: 1 - smoothstep(.25, .38, t) * .5, A: smoothstep(.25, .38, t) * .5}
        elif t < .72: inner_w = {A: 1 - smoothstep(.6, .72, t) * .5, Fo: 0, 'Chest': smoothstep(.6, .72, t) * .5}
        else: inner_w = {'Chest': 1 - smoothstep(.8, 1, t), 'Body': smoothstep(.8, 1, t)}
        f3 = r * (1 - smoothstep(0, .55, t)); out = {k: v * (1 - f3) for k, v in inner_w.items() if v > 0}
        out[FB[2]] = out.get(FB[2], 0) + f3
        return out
    grid(P, Wt, 7, 14, sx < 0)
    # leading edge membrane in front of the arm: shoulder -> wrist straight, filling the elbow notch
    def P(r, t):
        arm = (S.lerp(E, t / .5) if t < .5 else E.lerp(W, (t - .5) / .5)); lead = S.lerp(W, t) + Vector((0, .02, .08 * math.sin(math.pi * t)))
        return arm.lerp(lead, r), mix(C['wing_vein'], C['wing_mid'], .5 * r)
    def Wt(r, t): return {A: 1 - smoothstep(.4, .7, t), Fo: smoothstep(.4, .7, t)} if t > .08 else {'Chest': .5, A: .5}
    grid(P, Wt, 3, 8, sx < 0)
for sx, sfx in ((1, 'L'), (-1, 'R')): wing(sx, sfx)

# ------------------------------------------------------------------ proud neck: lift the head and upper neck smoothly
def neck_lift(p): return Vector((p[0], p[1] + NECK_LIFT * smoothstep(1.7, 3.5, p[2]), p[2]))
G.P = [neck_lift(p) for p in G.P]
BONES = {n: (tuple(neck_lift(h)), tuple(neck_lift(t)), par) for n, (h, t, par) in BONES.items()}

# ------------------------------------------------------------------ baked ambient occlusion into the vertex colours
tris = []
for f in G.F:
    for k in range(1, len(f) - 1): tris.append((f[0], f[k], f[k + 1]))
bvh = BVHTree.FromPolygons([tuple(p) for p in G.P], tris, all_triangles=True)
vn = [Vector() for _ in G.P]
for a, b, c in tris:
    n = (G.P[b] - G.P[a]).cross(G.P[c] - G.P[a])
    for i in (a, b, c): vn[i] += n
DIRS = []
for i in range(40):  # fixed cosine-weighted hemisphere (deterministic)
    u1, u2 = (i + .5) / 40, (i * .618033988749) % 1
    r, phi = math.sqrt(u1), TAU * u2; DIRS.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - u1))))
def ao_at(p, n):
    if n.length < 1e-9: return 1.0
    n = n.normalized(); ref = Vector((1, 0, 0)) if abs(n.x) < .9 else Vector((0, 1, 0))
    u = n.cross(ref).normalized(); v = n.cross(u); occ = 0.0
    for d in DIRS:
        dw = u * d.x + v * d.y + n * d.z
        hit = bvh.ray_cast(p + n * .012, dw, 1.6)
        if hit[0] is not None: occ += 1 - (hit[3] / 1.6) ** .7
    return 1 - occ / len(DIRS)
for i, p in enumerate(G.P):
    if G.aok[i] <= 0: continue
    ao = ao_at(p, vn[i])
    if G.FM and G.col[i] is not None:
        k = lerp(1, lerp(.32, 1, ao ** 1.15), G.aok[i])
        G.col[i] = mul(G.col[i], k)

# ------------------------------------------------------------------ Blender objects
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene

def scale_tile(size=256, cols=4, rows=4):
    """Tileable overlapping-scale pattern, rounded free edges facing the tail (low v). Values multiply the hide colour."""
    yy, xx = np.mgrid[0:size, 0:size].astype(np.float32) + .5
    cw, rh = size / cols, size / rows; R = cw * .62
    best_v = np.full((size, size), np.inf, np.float32); val = np.ones((size, size), np.float32)
    for r in range(-1, rows + 2):
        for c in range(-1, cols + 2):
            cx = c * cw + (cw / 2 if r % 2 else 0); cy = r * rh + rh * .2
            dx = (xx - cx); dy = (yy - cy)
            # scale shape: a rounded shield whose free edge points to low v
            d = np.sqrt((dx / (cw * .56)) ** 2 + (np.minimum(dy, 0) / (rh * .95)) ** 2 + (np.maximum(dy, 0) / (rh * 1.3)) ** 2)
            inside = d < 1.0; take = inside & (cy < best_v)
            dome = .8 + .2 * np.clip(dy / (rh * 1.3) + .4, 0, 1) - .06 * (dx / (cw * .56)) ** 2
            shade = np.where(d > .84, .56 + .3 * (1 - (d - .84) / .16) * 0, dome)
            val = np.where(take, shade, val); best_v = np.where(take, cy, best_v)
    val = np.clip(val, 0, 1)
    img = bpy.data.images.new('SkyfireScales', size, size, alpha=False)
    rgba = np.stack([val, val * .985, val * .97, np.ones_like(val)], -1)
    img.pixels.foreach_set(rgba.ravel())
    img.pack(); img.file_format = 'PNG'; img.colorspace_settings.name = 'sRGB'
    return img
SCALES = scale_tile()

def make_mat(name, emission=None, double=False, use_tex=False):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes['Principled BSDF']
    b.inputs['Roughness'].default_value = .58 if name != 'SkyfireWing' else .7
    b.inputs['Metallic'].default_value = 0.0
    vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
    if use_tex:
        tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = SCALES
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'; nt.links.new(uvn.outputs['UV'], tex.inputs['Vector'])
        mx = nt.nodes.new('ShaderNodeMix'); mx.data_type = 'RGBA'; mx.blend_type = 'MULTIPLY'; mx.inputs['Factor'].default_value = 1.0
        sock = lambda socks, name: [x for x in socks if x.name == name and x.type == 'RGBA'][0]
        nt.links.new(vc.outputs['Color'], sock(mx.inputs, 'A')); nt.links.new(tex.outputs['Color'], sock(mx.inputs, 'B'))
        nt.links.new(sock(mx.outputs, 'Result'), b.inputs['Base Color'])
    else:
        nt.links.new(vc.outputs['Color'], b.inputs['Base Color'])
    if emission:
        b.inputs['Emission Color'].default_value = (*lin(emission[0]), 1); b.inputs['Emission Strength'].default_value = emission[1]
    m.use_backface_culling = not double
    return m
MATS = [make_mat('SkyfireHide', use_tex=True), make_mat('SkyfireWing', double=True), make_mat('SkyfireEmber', emission=('ff7a1c', .6))]

bm = bmesh.new()
bv = [bm.verts.new(to_b(p)) for p in G.P]
bm.verts.index_update(); bm.verts.ensure_lookup_table()
uv0 = bm.loops.layers.uv.new('UVMap'); uv1 = bm.loops.layers.uv.new('Mask')
for fi, (f, mi, uvs) in enumerate(zip(G.F, G.FM, G.FUV)):
    try: face = bm.faces.new([bv[i] for i in f])
    except ValueError: continue
    face.material_index = mi; face.smooth = True
    for loop, uv in zip(face.loops, uvs): loop[uv0].uv = uv
    for loop in face.loops: mk = G.mask[loop.vert.index]; loop[uv1].uv = (mk[0], (mk[1] + 1) / 2.5)   # y stored as (y + 1) / 2.5 so it fits 0..1
bmesh.ops.recalc_face_normals(bm, faces=[f for f in bm.faces if f.material_index != WING])
me = bpy.data.meshes.new('Skyfire'); bm.to_mesh(me); bm.free()
for m in MATS: me.materials.append(m)
ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
ca.data.foreach_set('color', np.array([(*c, 1.0) for c in G.col], np.float32).ravel())
me.color_attributes.active_color = ca
try: me.set_sharp_from_angle(angle=math.radians(62))
except Exception: pass
body = bpy.data.objects.new('Skyfire', me); SC.collection.objects.link(body)

# armature
arm_data = bpy.data.armatures.new('SkyfireRig'); rig = bpy.data.objects.new('SkyfireRig', arm_data); SC.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
order = list(BONES)
for name in order:
    h, t, _p = BONES[name]; eb = arm_data.edit_bones.new(name); eb.head = to_b(h); eb.tail = to_b(t); eb.roll = 0
for name in order:
    p = BONES[name][2]
    if p: arm_data.edit_bones[name].parent = arm_data.edit_bones[p]; arm_data.edit_bones[name].use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
groups = {n: body.vertex_groups.new(name=n) for n in order}
for i, w in enumerate(G.W):
    tot = sum(w.values())
    items = sorted(((k, v / tot) for k, v in w.items() if v > 1e-4), key=lambda kv: -kv[1])[:4]
    tot = sum(v for _, v in items)
    for k, v in items: groups[k].add([i], v / tot, 'REPLACE')
body.parent = rig; mod = body.modifiers.new('Armature', 'ARMATURE'); mod.object = rig

# ------------------------------------------------------------------ GLB repack: quantized attributes (KHR_mesh_quantization)
def quantize_glb(path):
    import struct
    raw = open(path, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl]); bin0 = raw[20 + jl + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    def read(ai):  # the exporter writes tightly packed, non-interleaved views
        a = doc['accessors'][ai]; bv = doc['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
        assert bv.get('byteStride', n * np.dtype(dt).itemsize) == n * np.dtype(dt).itemsize, 'interleaved view'
        return np.frombuffer(bin0, dt, a['count'] * n, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n).copy()
    conv = {}
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            conv[at['NORMAL']] = 'normal'; conv[at['COLOR_0']] = 'colour'; conv[at['WEIGHTS_0']] = 'weights'; conv[at['TEXCOORD_1']] = 'mask'
    out = bytearray(); views = []
    def push(data, target=None, stride=None):
        while len(out) % 4: out.append(0)
        v = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(data)}
        if target: v['target'] = target
        if stride: v['byteStride'] = stride
        out.extend(data); views.append(v); return len(views) - 1
    img_views = {im['bufferView'] for im in doc.get('images', [])}
    remap = {}
    for vi in sorted(img_views):
        bv = doc['bufferViews'][vi]; o = bv.get('byteOffset', 0); remap[vi] = push(bin0[o:o + bv['byteLength']])
    for im in doc.get('images', []): im['bufferView'] = remap[im['bufferView']]
    for ai, a in enumerate(doc['accessors']):
        data = read(ai); kind = conv.get(ai); target = doc['bufferViews'][a['bufferView']].get('target'); a.pop('byteOffset', None)
        if kind == 'normal':
            q = np.clip(np.round(data / np.maximum(np.linalg.norm(data, axis=1, keepdims=True), 1e-9) * 127), -127, 127).astype(np.int8)
            q = np.concatenate([q, np.zeros((len(q), 1), np.int8)], 1)
            a.update(componentType=5120, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind == 'colour':
            q = np.clip(np.round(data[:, :3] * 255), 0, 255).astype(np.uint8)
            q = np.concatenate([q, np.zeros((len(q), 1), np.uint8)], 1)
            a.update(componentType=5121, normalized=True, type='VEC3'); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes(), target, 4)
        elif kind == 'weights':
            q = np.round(data / data.sum(1, keepdims=True) * 255).astype(np.int32)
            fix = 255 - q.sum(1); q[np.arange(len(q)), q.argmax(1)] += fix
            a.update(componentType=5121, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.astype(np.uint8).tobytes(), target)
        elif kind == 'mask':
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

# ------------------------------------------------------------------ checks and export
tri_count = sum(len(p.vertices) - 2 for p in me.polygons)
REPORT = {'triangles': tri_count, 'vertices': len(me.vertices), 'materials': len(me.materials), 'bones': len(order),
          'materials_names': [m.name for m in me.materials]}
assert tri_count < 12000, REPORT
assert len(me.materials) <= 3
assert all(abs(sum(g.weight for g in v.groups) - 1) < 1e-3 for v in me.vertices), 'every vertex fully weighted'
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                          export_animations=False, export_morph=False, export_materials='EXPORT', export_normals=True,
                          export_texcoords=True, export_vertex_color='ACTIVE', export_extras=False, export_image_format='AUTO')
quantize_glb(OUT)
REPORT['bytes'] = os.path.getsize(OUT); REPORT['seconds'] = round(time.time() - T0, 1)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps(REPORT))

# ------------------------------------------------------------------ review renders
AX = {'x': Vector((1, 0, 0)), 'y': Vector((0, 0, 1)), 'z': Vector((0, -1, 0))}   # game axes in Blender
def pose(spec):
    """spec: {bone: (pitch_x, yaw_y, roll_z)} radians about the model's own (game) axes, as client/dragon-art.js does."""
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = Quaternion(); pb.scale = (1, 1, 1)
        if pb.name not in spec: continue
        ax, ay, az = spec[pb.name]
        rw = pb.bone.matrix_local.to_quaternion()
        qm = Quaternion(AX['y'], ay) @ Quaternion(AX['z'], az) @ Quaternion(AX['x'], ax)
        pb.rotation_quaternion = rw.inverted() @ qm @ rw
    bpy.context.view_layer.update()
def side_spec(base):
    out = {}
    for name, (ax, ay, az) in base.items():
        if name.endswith('*'):
            out[name[:-1] + 'L'] = (ax, ay, az); out[name[:-1] + 'R'] = (ax, -ay, -az)
        else: out[name] = (ax, ay, az)
    return out
POSES = {
    'glide': side_spec({'WingArm*': (0, 0, .12), 'WingFore*': (0, 0, .04), 'WingF1*': (0, 0, .03)}),
    'flap-down': side_spec({'WingArm*': (0, -.08, -.62), 'WingFore*': (0, 0, -.2), 'WingF1*': (.12, 0, .22), 'WingF2*': (.12, 0, .18), 'WingF3*': (.1, 0, .12),
                            'Body': (.04, 0, 0), 'Tail1': (-.05, 0, 0), 'Tail2': (-.05, 0, 0)}),
    'dive': side_spec({'WingArm*': (0, .85, .3), 'WingFore*': (0, 1.35, -.15), 'WingF1*': (0, .5, 0), 'WingF2*': (0, .35, 0), 'WingF3*': (0, .2, 0),
                       'Neck1': (.12, 0, 0), 'Neck2': (.08, 0, 0), 'Head': (-.15, 0, 0), 'Tail1': (-.06, 0, 0), 'Tail2': (-.04, 0, 0),
                       'LegF*': (-.5, 0, 0), 'LegH*': (-.35, 0, 0)}),
    'breath': side_spec({'Jaw': (.55, 0, 0), 'Neck1': (.1, 0, 0), 'Neck2': (.06, 0, 0), 'Head': (.05, 0, 0), 'Brow*': (0, 0, -.25), 'WingArm*': (0, 0, .12)}),
}
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 40)); SC.cycles.device = 'CPU'
    try: SC.cycles.use_denoising = True
    except Exception: pass
    SC.render.resolution_x, SC.render.resolution_y = 1000, 680
    SC.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in SC.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Standard'
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (.42, .6, .85, 1); bg.inputs[1].default_value = .9
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = .2
    so = bpy.data.objects.new('sun', sun); SC.collection.objects.link(so); so.rotation_euler = (math.radians(40), math.radians(-25), math.radians(30))
    # the materials the game shades with: scale tile only where the mask says, ember glow
    hm = MATS[0].node_tree; mixn = [n for n in hm.nodes if n.bl_idname == 'ShaderNodeMix'][0]
    uvm = hm.nodes.new('ShaderNodeUVMap'); uvm.uv_map = 'Mask'; sep = hm.nodes.new('ShaderNodeSeparateXYZ')
    hm.links.new(uvm.outputs['UV'], sep.inputs['Vector']); hm.links.new(sep.outputs['X'], mixn.inputs['Factor'])
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    def shot(name, eye, at, lens=35):
        cam.lens = lens; co.location = to_b(eye); co.rotation_euler = (to_b(at) - to_b(eye)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
    em = MATS[2].node_tree.nodes['Principled BSDF']
    pose(POSES['glide'])
    shot('three-quarter', (10.5, 5.5, 10.5), (0, .4, -.3))
    shot('side', (16, 1.2, -.8), (0, .3, -1.0))
    shot('front', (0, 2.2, 15), (0, .6, 0))
    shot('top', (0, 17, -1.0), (0, 0, -1.0))
    shot('below', (5, -9, 7), (0, 0, -.5))
    shot('face', (3.2, 2.6, 8.4), (0, 1.25, 3.9), 50)
    pose(POSES['flap-down']); shot('flap-down', (10.5, 5.5, 10.5), (0, .4, -.3))
    pose(POSES['dive']); shot('dive', (10.5, 6.5, 8.5), (0, .4, -.8))
    pose(POSES['breath']); em.inputs['Emission Strength'].default_value = 5.0
    shot('breath', (3.6, 2.2, 8.8), (0, 1.0, 3.2), 45)
print('SKYFIRE_BUILD_OK')
