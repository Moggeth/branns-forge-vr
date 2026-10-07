"""Stormspire lizard crew: the Voltnewt (level 2) - reproducible Blender (bpy 4.5+/5.0) builder.

Run:  python3.11 build_stormspire_lizard.py -- --out ../../public/assets/stormspire-lizard.glb
      python3.11 build_stormspire_lizard.py -- --out out/stormspire-lizard.glb      (scratch build + report only)
      (pip install bpy numpy)
Prints LIZARD_BUILD_OK as its last line on success. Blender can exit 0 after a Python traceback, so check for it.

Design: Mitch's concept sheet "03 · VOLTNEWT" (2026-10-07). A chunky teal newt about 0.6 m nose to tail curl: darker
teal spots, a cream belly, throat and jaw, a row of orange spikes down the back and a thick tail that curls up into a
hook. Big friendly amber eyes high on a broad head and a wide toothy grin (cream cone teeth, pink mouth). Work gear: a
yellow hard hat with a blue lightning bolt (an orange spike pokes out behind it), a yellow leather chest harness with
brown straps, buckles and a round white badge with a red cross, a brass and steel power socket on the upper back with
a red cable, and black chunky boots with rounded claws. Glowing blue electric veins run under the skin.
Faces: the grin (jaw), a squinting charged-up face (eyelids shut, cheeks puffed by the Cheek bones, veins flaring),
and the bite that zaps.

Everything is authored in the game frame (X = the newt's right, Y up, -Z forward, origin on the ground under the belly,
metres) and converted to Blender's Z-up on the way in, so these numbers match client/stormspire-lizards.js.

One skinned mesh, one material (LizardSkin), one 256 x 144 texture atlas:
  - rows 0..15 (Blender, bottom up): four 4 px palette rows, one per colour look (0 concept teal, 1 jade, 2 lagoon,
    3 spare). u 0..96 px is a continuous skin ramp (dark spot teal -> back -> flank -> cream belly), the rest are 6 px
    solid slots (eyes, mouth, teeth, gear...). TEXCOORD_0 picks the colour; the runtime offsets the row per look.
  - rows 16..143, u 0..128: a tileable 128 px electric-vein tile. TEXCOORD_1 maps skin onto it (x along the body,
    y around it; whole tiles around every loop so there is no seam); gear and eyes carry TEXCOORD_1.x = -500 (no veins).
    The runtime samples the tile in the shader and adds a flickering blue glow (brighter while charging or biting).
Vertex colours carry baked ambient occlusion only. The hard hat and the wrench hang on their own bones so the runtime
can show the wrench only while tinkering. Bones Cable1..2 carry the cable stub; the runtime continues the cable from
CableTip to wherever the newt is plugged in.

Clips (glTF animations, 30 fps samples): idle, climb, cheer, nap, tinker, bite. After export the GLB is repacked with
KHR_mesh_quantization (byte normals, colours and weights) and 16-bit rotation keys; channels that never leave rest are
dropped.
"""
import os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
import bpy, bmesh, math, json, time, struct, random
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

T0 = time.time()
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'stormspire-lizard.glb'))
TAU = math.tau
FPS = 30

def smoothstep(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a))); return t * t * (3 - 2 * t)
def lerp(a, b, t): return a + (b - a) * t
def to_b(p): return Vector((p[0], -p[2], p[1]))   # game (x right, y up, z back) -> Blender (x, y forward, z up)

# ------------------------------------------------------------------ atlas: palette rows + vein tile
RAMP_PX, SLOT_PX, TEX_W, TEX_H, ROW_PX, VEIN_PX = 96, 6, 256, 144, 4, 128
SLOTS = ['eye', 'iris', 'pupil', 'mouth', 'tongue', 'tooth', 'hat', 'hat_dark', 'bolt', 'spike', 'spike_tip', 'harness',
         'strap', 'buckle', 'badge', 'cross', 'brass', 'steel', 'cable', 'boot', 'claw', 'zzz', 'line', 'highlight',
         'nostril', 'blush']
assert RAMP_PX + SLOT_PX * len(SLOTS) <= TEX_W
LOOKS = [   # skin ramp: spot, back, flank, light flank, cream, light cream
    dict(ramp=['073a44', '137a83', '1f9f9c', '49c2ae', 'e6e1b8', 'f7f2d6'], iris='e48a1c'),
    dict(ramp=['0c503a', '17805c', '25a273', '57c48f', 'e8e3b6', 'f7f2d6'], iris='d9771a'),
    dict(ramp=['0b3d63', '15688f', '2189ad', '4fb2c9', 'e4e2c0', 'f5f3dc'], iris='ef9a2a'),
]
LOOKS.append(dict(LOOKS[0]))
COMMON = dict(eye='fffdf6', pupil='1a1210', mouth='a8344e', tongue='ff7f94', tooth='fbf1d2', hat='ffc61f', hat_dark='e0930f',
              bolt='2f7fe8', spike='f07a22', spike_tip='ffb35a', harness='f4be2c', strap='6e4126', buckle='9aa3ab', badge='fbf7ee',
              cross='e2302e', brass='cf9a3e', steel='8f9aa3', cable='d8402e', boot='26262b', claw='3a3a42', zzz='eaf6ff',
              line='3a1d18', highlight='ffffff', nostril='123a3c', blush='ff8f8f')
def srgb(h): return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
def slot_u(name): return (RAMP_PX + SLOT_PX * SLOTS.index(name) + SLOT_PX / 2) / TEX_W
def ramp_u(r): return (1.5 + max(0.0, min(1.0, r)) * (RAMP_PX - 3)) / TEX_W
ROW_V = (ROW_PX / 2) / TEX_H   # row 0 centre in Blender UV (v up); the runtime shifts rows by 4 px
NO_VEIN = (-500.0, 0.0)

def vein_tile(n=VEIN_PX, seed=11):
    """Tileable branching lightning veins: random walks drawn with wrap-around, a hot core and a soft halo."""
    rnd = random.Random(seed); core = np.zeros((n, n), np.float32)
    def stamp(x, y, v):
        core[int(y) % n, int(x) % n] = max(core[int(y) % n, int(x) % n], v)
    def bolt(x, y, ang, length, v, depth):
        for i in range(int(length)):
            ang += rnd.uniform(-.55, .55) * (1 if i % 3 else 1.6)
            x += math.cos(ang) * .9; y += math.sin(ang) * .9; stamp(x, y, v)
            if depth < 2 and rnd.random() < .035: bolt(x, y, ang + rnd.choice((-1, 1)) * rnd.uniform(.5, 1.1), length * rnd.uniform(.25, .45), v * .8, depth + 1)
    for k in range(4):
        bolt(rnd.uniform(0, n), rnd.uniform(0, n), rnd.uniform(0, TAU), rnd.uniform(80, 130), 1.0, 0)
    # halo: separable wrap-around blur
    def blur(a, r):
        k = np.exp(-np.arange(-r * 3, r * 3 + 1) ** 2 / (2 * r * r)); k /= k.sum()
        out = sum(np.roll(a, i - r * 3, 0) * w for i, w in enumerate(k))
        return sum(np.roll(out, i - r * 3, 1) * w for i, w in enumerate(k))
    thick = np.maximum(core, blur(core, 1) * 2.2)
    halo = blur(core, 3) * 4.0
    return np.clip(np.maximum(thick, halo * .45), 0, 1)

def atlas_pixels():
    px = np.zeros((TEX_H, TEX_W, 4), np.float32); px[..., 3] = 1
    for row, look in enumerate(LOOKS):
        cols = {**COMMON, **{k: v for k, v in look.items() if k != 'ramp'}}
        stops = [srgb(h) for h in look['ramp']]; pos = np.linspace(0, 1, len(stops))
        y0 = row * ROW_PX
        for x in range(RAMP_PX):
            r = min(1, max(0, (x + .5 - 1.5) / (RAMP_PX - 3)))
            px[y0:y0 + ROW_PX, x, :3] = [float(np.interp(r, pos, [s[i] for s in stops])) for i in range(3)]
        for i, name in enumerate(SLOTS):
            x0 = RAMP_PX + SLOT_PX * i
            px[y0:y0 + ROW_PX, x0:x0 + SLOT_PX, :3] = srgb(cols[name])
    v = vein_tile()
    px[16:16 + VEIN_PX, 0:VEIN_PX, 0] = v; px[16:16 + VEIN_PX, 0:VEIN_PX, 1] = v; px[16:16 + VEIN_PX, 0:VEIN_PX, 2] = v
    return px

# ------------------------------------------------------------------ geometry accumulator
class Geo:
    def __init__(self):
        self.P, self.R, self.W, self.part, self.ao = [], [], [], [], []
        self.F, self.FS, self.FH, self.FV = [], [], [], []
    def v(self, p, ramp, w, part, ao=1.0):
        self.P.append(Vector(p)); self.R.append(ramp); self.W.append(w); self.part.append(part); self.ao.append(ao)
        return len(self.P) - 1
    def f(self, idx, slot=None, inside=None, out=None, vein=None):
        """A face; its winding is fixed later so it faces away from `inside` (a point) or along `out` (a direction).
        vein: per-corner TEXCOORD_1 (vein tile coordinates) or None for no veins."""
        self.F.append(list(idx)); self.FS.append(slot); self.FV.append(vein)
        self.FH.append(('in', Vector(inside)) if inside is not None else ('out', Vector(out)) if out is not None else None)
G = Geo()
OCCLUDERS = {'body', 'head', 'jaw', 'eye', 'limb', 'boot'}
VEIN_TILE = .1   # metres of skin per vein tile along a part

def frame_from(axis, up=(0, 1, 0)):
    d = Vector(axis).normalized(); ref = Vector(up)
    if abs(d.dot(ref)) > .95: ref = Vector((1, 0, 0)) if abs(d.x) < .9 else Vector((0, 0, 1))
    u = ref.cross(d).normalized(); v = d.cross(u)
    return d, u, v

def ball(c, r, axis, lats, sides, slot_fn, weight, part, scale=(1, 1, 1), ramp=.5, ao=1.0, up=(0, 1, 0), phase=0.0):
    """Sphere (or cap) with its pole along axis; latitude rings at the given angles (radians from the pole).
    slot_fn(band) -> slot name or None (skin ramp) for the band between lats[band] and lats[band+1]."""
    c = Vector(c); d, u, v = frame_from(axis, up)
    def P(a, phi):
        q = d * math.cos(a) + (u * math.cos(phi) + v * math.sin(phi)) * math.sin(a)
        return c + Vector((q.x * scale[0], q.y * scale[1], q.z * scale[2])) * r
    rr = ramp if callable(ramp) else (lambda p, _r=ramp: _r)
    wf = weight if callable(weight) else (lambda p, _w=weight: _w)
    top = G.v(P(0, 0), rr(P(0, 0)), wf(P(0, 0)), part, ao); rings = []
    for a in lats[1:-1] if abs(lats[-1] - math.pi) < 1e-6 else lats[1:]:
        ring = []
        for k in range(sides):
            p = P(a, TAU * k / sides + phase); ring.append(G.v(p, rr(p), wf(p), part, ao))
        rings.append(ring)
    closed = abs(lats[-1] - math.pi) < 1e-6
    for k in range(sides): G.f((top, rings[0][(k + 1) % sides], rings[0][k]), slot_fn(0), inside=c)
    for b, (ra, rb) in enumerate(zip(rings, rings[1:])):
        for k in range(sides):
            k1 = (k + 1) % sides; G.f((ra[k], ra[k1], rb[k1], rb[k]), slot_fn(b + 1), inside=c)
    if closed:
        bot = G.v(P(math.pi, 0), rr(P(math.pi, 0)), wf(P(math.pi, 0)), part, ao)
        for k in range(sides): G.f((rings[-1][k], rings[-1][(k + 1) % sides], bot), slot_fn(len(lats) - 2), inside=c)
    return rings

def tube(path, radii, sides, slot, weight_fn, part, cap0=True, cap1=True, squash=1.0, up=None, ramp=.5, ao=1.0,
         ramp_fn=None, vein=False, cap_slot=None):
    """Tube along a polyline with parallel-transported frames. weight_fn(t) gets t in 0..1. vein=True maps the tube
    onto the vein tile (two tiles round, VEIN_TILE metres per tile along)."""
    path = [Vector(p) for p in path]; n = len(path); rings = []
    tang = [(path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized() for i in range(n)]
    ref = Vector(up) if up else (Vector((0, 1, 0)) if abs(tang[0].y) < .9 else Vector((1, 0, 0)))
    nrm = (ref - tang[0] * ref.dot(tang[0])).normalized()
    along = [0.0]
    for i in range(1, n): along.append(along[-1] + (path[i] - path[i - 1]).length)
    for i in range(n):
        if i: nrm = (nrm - tang[i] * nrm.dot(tang[i])).normalized()
        bi = tang[i].cross(nrm); t = i / (n - 1); ring = []
        for k in range(sides):
            a = TAU * k / sides
            p = path[i] + (nrm * math.cos(a) + bi * math.sin(a) * squash) * radii[i]
            ring.append(G.v(p, ramp_fn(t, a) if ramp_fn else ramp, weight_fn(t), part, ao))
        rings.append(ring)
    for i, (a, b) in enumerate(zip(rings, rings[1:])):
        mid = (path[i] + path[i + 1]) / 2
        for k in range(sides):
            k1 = (k + 1) % sides
            vv = None
            if vein:
                x0, x1 = along[i] / VEIN_TILE, along[i + 1] / VEIN_TILE; y0, y1 = 2 * k / sides, 2 * (k + 1) / sides
                vv = [(x0, y0), (x0, y1), (x1, y1), (x1, y0)]
            G.f((a[k], a[k1], b[k1], b[k]), slot, inside=mid, vein=vv)
    if cap0:
        c = G.v(path[0] - tang[0] * radii[0] * .5, ramp_fn(0, 0) if ramp_fn else ramp, weight_fn(0), part, ao)
        for k in range(sides): G.f((rings[0][(k + 1) % sides], rings[0][k], c), cap_slot or slot, out=-tang[0])
    if cap1:
        c = G.v(path[-1] + tang[-1] * radii[-1] * .5, ramp_fn(1, 0) if ramp_fn else ramp, weight_fn(1), part, ao)
        for k in range(sides): G.f((rings[-1][k], rings[-1][(k + 1) % sides], c), cap_slot or slot, out=tang[-1])
    return rings

def bezier(p0, p1, p2, p3, n):
    p0, p1, p2, p3 = map(Vector, (p0, p1, p2, p3))
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]

def catmull(pts, n=24):
    out = []; P = [pts[0]] + pts + [pts[-1]]
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = (np.array(P[j], float) for j in (i - 1, i, i + 1, i + 2))
        for k in range(n):
            t = k / n
            out.append(.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(np.array(pts[-1], float)); return np.array(out)
def se(c, n): return math.copysign(abs(c) ** (2 / n), c)
def disc(c, normal, r, sides, slot, weight, part, stretch=1.0, lift=.0008):
    d, u, v = frame_from(normal); c = Vector(c) + d * lift
    ctr = G.v(c, .5, weight, part, ao=0)
    ring = [G.v(c + (u * math.cos(TAU * k / sides) * stretch + v * math.sin(TAU * k / sides)) * r, .5, weight, part, ao=0) for k in range(sides)]
    for k in range(sides): G.f((ctr, ring[k], ring[(k + 1) % sides]), slot, out=d)
    return d, u, v

# ------------------------------------------------------------------ body + tail: one loft from the neck to the curl tip
# centreline (z, y) from the neck (inside the head) back to the tail tip; the thick tail curls up and forward into a hook
CL = [(-.135, .142), (-.09, .126), (-.03, .117), (.03, .113), (.09, .11), (.15, .1), (.22, .086), (.29, .082),
      (.34, .098), (.368, .138), (.366, .184), (.342, .214), (.31, .218), (.292, .2)]
SPN = catmull(CL, 20)
SPL = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(SPN, axis=0), axis=1))]); BODY_LEN = float(SPL[-1])
def cl_at(s):
    z = np.interp(s, SPL, SPN[:, 0]); y = np.interp(s, SPL, SPN[:, 1])
    s0, s1 = max(0, s - .004), min(BODY_LEN, s + .004)
    t = Vector((0, np.interp(s1, SPL, SPN[:, 1]) - np.interp(s0, SPL, SPN[:, 1]), np.interp(s1, SPL, SPN[:, 0]) - np.interp(s0, SPL, SPN[:, 0]))).normalized()
    return Vector((0, float(y), float(z))), t
def s_of_z(z):   # only valid before the curl (z increasing)
    k = int(np.argmax(SPN[:, 0] > .33)); return float(np.interp(z, SPN[:k, 0], SPL[:k]))
S_TAIL0 = s_of_z(.13); S_CURL = s_of_z(.31)
# (s, half width, top, bottom, superellipse exponent)
BKEYS = [(0, .056, .05, .05, 2.2), (s_of_z(-.075), .074, .054, .062, 2.35), (s_of_z(-.01), .085, .056, .07, 2.55),
         (s_of_z(.05), .084, .055, .068, 2.55), (s_of_z(.1), .07, .05, .054, 2.4), (s_of_z(.15), .056, .047, .046, 2.25),
         (s_of_z(.22), .043, .04, .038, 2.15), (s_of_z(.29), .035, .034, .032, 2.1), (BODY_LEN * .8, .025, .025, .024, 2.0),
         (BODY_LEN - .02, .012, .012, .012, 2.0), (BODY_LEN, .004, .004, .004, 2.0)]
BK = np.array([k[0] for k in BKEYS])
def bkey(s, i):
    vals = [k[i] for k in BKEYS]; s = min(max(s, BK[0]), BK[-1])
    j = min(int(np.searchsorted(BK, s, side='right') - 1), len(BK) - 2); t = (s - BK[j]) / (BK[j + 1] - BK[j])
    return lerp(vals[j], vals[j + 1], t * t * (3 - 2 * t))
def section_frame(s):
    c, t = cl_at(s); N = Vector((0, t.z, -t.y)).normalized()
    if s < S_CURL and N.y < 0: N = -N
    if s >= S_CURL and t.z > 0 and N.y < 0: N = -N
    return c, t, N
def body_point(s, th, off=0.0):
    """Surface point of the body loft at arc length s and angle th (0 = top, + toward the right side)."""
    c, t, N = section_frame(s); w, top, bot, n = (bkey(s, i) for i in (1, 2, 3, 4))
    cx, cy = math.sin(th), math.cos(th)
    x = (w + off) * se(cx, n); y = ((top if cy >= 0 else bot) + off) * se(cy, n)
    return c + Vector((1, 0, 0)) * x + N * y

# ------------------------------------------------------------------ bones (game frame). name: (head, tail, parent)
BONES = {}
BONES['Root'] = ((0, 0, 0), (0, 0, -.06), None)
BONES['Hips'] = ((0, .11, .07), (0, .113, 0), 'Root')
BONES['Spine'] = ((0, .113, 0), (0, .124, -.1), 'Hips')
BONES['Belly'] = ((0, .1, .02), (0, .1, -.03), 'Hips')
BONES['Head'] = ((0, .14, -.12), (0, .16, -.24), 'Spine')
BONES['Jaw'] = ((0, .135, -.13), (0, .12, -.27), 'Head')
EYE_R = .035
EYE_C = {'L': Vector((-.046, .19, -.222)), 'R': Vector((.046, .19, -.222))}
for sfx, c in EYE_C.items():
    sx = -1 if sfx == 'L' else 1
    BONES[f'Eye{sfx}'] = (tuple(c), tuple(c + Vector((0, 0, -.03))), 'Head')
    BONES[f'Lid{sfx}'] = (tuple(c), tuple(c + Vector((sx * .03, 0, 0))), 'Head')
    BONES[f'Cheek{sfx}'] = ((sx * .056, .14, -.19), (sx * .08, .14, -.19), 'Head')
TAIL_S = [S_TAIL0 + (BODY_LEN - .004 - S_TAIL0) * k / 6 for k in range(7)]
prev = 'Hips'
for k in range(6):
    a, _ = cl_at(TAIL_S[k]); b, _ = cl_at(TAIL_S[k + 1])
    BONES[f'Tail{k + 1}'] = (tuple(a), tuple(b), prev); prev = f'Tail{k + 1}'
LIMBS = {   # shoulder/hip, elbow/knee, wrist/ankle, foot centre on the ground (left side; right mirrors x)
    'Arm': [(-.062, .112, -.06), (-.104, .088, -.07), (-.11, .04, -.083), (-.112, 0, -.098)],
    'Leg': [(-.062, .108, .082), (-.11, .098, .07), (-.114, .04, .084), (-.118, 0, .074)],
}
def side_pt(p, sfx): return (p[0] if sfx == 'L' else -p[0], p[1], p[2])
for sfx in ('L', 'R'):
    parent_of = {'Arm': 'Spine', 'Leg': 'Hips'}
    for limb, (sh, el, wr, ft) in LIMBS.items():
        sh, el, wr, ft = side_pt(sh, sfx), side_pt(el, sfx), side_pt(wr, sfx), side_pt(ft, sfx)
        BONES[f'{limb}U{sfx}'] = (sh, el, parent_of[limb])
        BONES[f'{limb}L{sfx}'] = (el, wr, f'{limb}U{sfx}')
        BONES[f'{"Hand" if limb == "Arm" else "Foot"}{sfx}'] = (wr, tuple(Vector(ft) + Vector((0, 0, -.04))), f'{limb}L{sfx}')
HAT_BASE = (0, .222, -.152)
BONES['HatHard'] = (HAT_BASE, (0, .27, -.158), 'Head')
WRENCH_AT = Vector(BONES['HandR'][1]) + Vector((.0, .035, .02))
BONES['Wrench'] = (tuple(WRENCH_AT), tuple(WRENCH_AT + Vector((0, .05, -.01))), 'HandR')
SOCKET = body_point(s_of_z(-.035), 0.0)                        # top of the upper back, between the shoulders
SOCK_DIR = Vector((0, .82, .57)).normalized()
CABLE_PTS = bezier(SOCKET + SOCK_DIR * .036, SOCKET + SOCK_DIR * .07, SOCKET + Vector((0, .085, .06)), SOCKET + Vector((0, .07, .115)), 6)
BONES['Cable1'] = (tuple(CABLE_PTS[0]), tuple(CABLE_PTS[3]), 'Spine')
BONES['Cable2'] = (tuple(CABLE_PTS[3]), tuple(CABLE_PTS[5]), 'Cable1')
BONES['CableTip'] = (tuple(CABLE_PTS[5]), tuple(CABLE_PTS[5] + (CABLE_PTS[5] - CABLE_PTS[4]).normalized() * .02), 'Cable2')
BONES['Z1'] = ((-.01, .3, -.2), (-.01, .34, -.2), 'Root')
BONES['Z2'] = ((.02, .33, -.17), (.02, .37, -.17), 'Root')

def body_weights(s):
    """Head/Spine/Hips/Tail chain weights along the loft, smoothed across each joint."""
    joints = [(-1.0, 'Head'), (s_of_z(-.115), 'Spine'), (s_of_z(.0), 'Hips')] + [(TAIL_S[k], f'Tail{k + 1}') for k in range(6)]
    names = [j[1] for j in joints]; js = [j[0] for j in joints]
    i = max(0, int(np.searchsorted(js, s, side='right') - 1))
    w = {names[i]: 1.0}
    for jn in (i, i + 1):
        if jn <= 0 or jn >= len(names): continue
        h = .025 if jn > 2 else .035
        if abs(s - js[jn]) < h:
            t = smoothstep(-h, h, s - js[jn]); w = {names[jn - 1]: 1 - t, names[jn]: t}; break
    return w

def spot_amount(s, th, w):
    """Darker teal spots scattered over the back, flanks and tail (deterministic jittered grid)."""
    if s < .01 or s > BODY_LEN - .02: return 0.0
    best = 0.0; arc = th * w * 1.15
    for row in range(-4, 5):
        a0 = row * .028
        if abs(row) > 3 and s > S_TAIL0: continue
        step = .036; off = (row % 2) * step * .5
        k = round((s - off) / step)
        for kk in (k - 1, k, k + 1):
            h = math.sin(kk * 12.9898 + row * 78.233) * 43758.5453; h -= math.floor(h)
            sc = off + kk * step + (h - .5) * .012; ac = a0 + (h * 7 % 1 - .5) * .01
            r = (.011 + .007 * (h * 3 % 1)) * (1 - .4 * smoothstep(S_TAIL0, BODY_LEN, s))
            d = math.hypot(s - sc, arc - ac)
            best = max(best, smoothstep(r, r * .5, d))
    return best

K = 14
def body():
    s = 0.0; ss = []
    while s < BODY_LEN - .002:
        ss.append(s); s += .022 if s < S_TAIL0 else .03 if s < S_CURL else .026
    ss.append(BODY_LEN - .001)
    rings, cents = [], []
    for s in ss:
        c, t, N = section_frame(s); cents.append(c)
        w, top, bot, n = (bkey(s, i) for i in (1, 2, 3, 4)); ring = []
        for k in range(K):
            th = TAU * k / K; cx, cy = math.sin(th), math.cos(th)
            x = w * se(cx, n); y = (top if cy >= 0 else bot) * se(cy, n)
            if cy < -.7: y *= .95                     # a slightly flat belly
            p = c + Vector((1, 0, 0)) * x + N * y
            t_up = (cy + 1) / 2
            ramp = .2 + .25 * smoothstep(.95, .45, t_up) + .5 * smoothstep(.42, .22, t_up)   # back .2, flank .45, cream belly .95
            ramp = lerp(ramp, 0.0, spot_amount(s, th if th <= math.pi else th - TAU, w) * smoothstep(.3, .45, t_up))
            wts = body_weights(s)
            if -.07 < c.z < .07 and s < S_TAIL0:   # breathing: the belly bone inflates the torso
                kb = .65 * smoothstep(-.07, -.02, c.z) * smoothstep(.07, .02, c.z)
                wts = {k_: v * (1 - kb) for k_, v in wts.items()}; wts['Belly'] = wts.get('Belly', 0) + kb
            ring.append(G.v(p, ramp, wts, 'body'))
        rings.append(ring)
    tiles = 4
    for i, (a, b) in enumerate(zip(rings, rings[1:])):
        mid = (cents[i] + cents[i + 1]) / 2; x0, x1 = ss[i] / VEIN_TILE, ss[i + 1] / VEIN_TILE
        for k in range(K):
            k1 = (k + 1) % K; y0, y1 = tiles * k / K, tiles * (k + 1) / K
            G.f((a[k], b[k], b[k1], a[k1]), inside=mid, vein=[(x0, y0), (x1, y0), (x1, y1), (x0, y1)])
    c0, t0 = cl_at(0); cap = G.v(c0 - t0 * .01, .3, {'Head': 1.0}, 'body')
    for k in range(K): G.f((rings[0][k], rings[0][(k + 1) % K], cap), out=-t0)
    c1, t1 = cl_at(BODY_LEN); cap = G.v(c1 + t1 * .002, .4, body_weights(BODY_LEN), 'body')
    for k in range(K): G.f((rings[-1][(k + 1) % K], rings[-1][k], cap), out=t1)
body()

# ------------------------------------------------------------------ head: broad newt head, cheeks, a big grinning jaw
HK = 16
HEAD_Z0, HEAD_Z1 = -.095, -.288
def head_section(z):
    """mouth line y, half width, height above the mouth line, depth below it (inside the jaw)."""
    u = max(0, min(1, (z - HEAD_Z0) / (HEAD_Z1 - HEAD_Z0)))
    U = [0, .1, .28, .5, .72, .9, 1]
    w = np.interp(u, U, [.022, .066, .085, .085, .075, .055, .01])
    top = np.interp(u, U, [.025, .07, .082, .076, .06, .042, .008])
    bot = np.interp(u, U, [.014, .024, .026, .022, .018, .013, .004])
    ym = np.interp(u, [0, .3, .7, 1], [.146, .14, .137, .136])
    return float(ym), float(w), float(top), float(bot)
def cheek_w(p):
    out = {}
    for sfx, sx in (('L', -1), ('R', 1)):
        d = (p - Vector((sx * .06, .142, -.188))).length
        k = .85 * smoothstep(.042, .008, d)
        if k > 0: out[f'Cheek{sfx}'] = k
    return out
def head():
    zs = list(np.linspace(HEAD_Z0, HEAD_Z1, 11)); rings = []
    for z in zs:
        ym, w, top, bot = head_section(z); ring = []
        for k in range(HK):
            th = TAU * k / HK; cx, cy = math.sin(th), math.cos(th)
            x = w * se(cx, 2.35); y = (top if cy >= 0 else bot) * se(cy, 2.6)
            p = Vector((x, ym + y, z)); t_up = (cy + 1) / 2
            ramp = .2 + .25 * smoothstep(.95, .55, t_up) + .5 * smoothstep(.5, .4, t_up)
            ck = cheek_w(p); wts = {'Head': 1 - sum(ck.values()), **ck}
            ring.append(G.v(p, ramp, wts, 'head'))
        rings.append(ring)
    for zi, (a, b) in enumerate(zip(rings, rings[1:])):
        x0, x1 = (HEAD_Z0 - zs[zi]) / VEIN_TILE, (HEAD_Z0 - zs[zi + 1]) / VEIN_TILE
        for k in range(HK):
            k1 = (k + 1) % HK; cy = math.cos(TAU * (k + .5) / HK); z = (zs[zi] + zs[zi + 1]) / 2
            slot = 'mouth' if (cy < -.3 and z < -.125) else None
            G.f((a[k], a[k1], b[k1], b[k]), slot, inside=(0, head_section(z)[0], z),
                vein=None if slot else [(x0, 3 * k / HK), (x0, 3 * (k + 1) / HK), (x1, 3 * (k + 1) / HK), (x1, 3 * k / HK)])
    for ring, z, sgn in ((rings[0], zs[0], 1), (rings[-1], zs[-1], -1)):
        ym, w, top, bot = head_section(z); c = G.v((0, ym + (top - bot) * .3, z + sgn * .004), .25, {'Head': 1.0}, 'head')
        for k in range(HK): G.f((ring[(k + 1) % HK], ring[k], c), out=(0, 0, sgn))
head()

JAW_Z0, JAW_Z1 = -.115, -.28
def jaw_section(z):
    u = (z - JAW_Z0) / (JAW_Z1 - JAW_Z0)
    w = float(np.interp(u, [0, .2, .55, .85, 1], [.04, .074, .074, .056, .014]))
    dep = float(np.interp(u, [0, .2, .55, .85, 1], [.03, .056, .054, .042, .012]))
    ytop = float(np.interp(u, [0, 1], [.142, .136]))
    return w, dep, ytop
def jaw():
    JK = 12; zs = list(np.linspace(JAW_Z0, JAW_Z1, 7)); rings = []
    for z in zs:
        w, dep, ytop = jaw_section(z); ring = []
        for k in range(JK):
            th = TAU * k / JK; cx, cy = math.sin(th), math.cos(th)
            x = w * se(cx, 2.4); y = ytop - .003 + (.002 * se(cy, 6) if cy > 0 else dep * se(cy, 2.3))
            p = Vector((x * .97, y, z)); ck = cheek_w(p); ck = {k_: v * .5 for k_, v in ck.items()}
            ring.append(G.v(p, .93, {'Jaw': 1 - sum(ck.values()), **ck}, 'jaw'))
        rings.append(ring)
    for zi, (a, b) in enumerate(zip(rings, rings[1:])):
        x0, x1 = (JAW_Z0 - zs[zi]) / VEIN_TILE, (JAW_Z0 - zs[zi + 1]) / VEIN_TILE
        for k in range(JK):
            k1 = (k + 1) % JK; cy = math.cos(TAU * (k + .5) / JK); cx = math.sin(TAU * (k + .5) / JK)
            slot = ('tongue' if abs(cx) < .55 and 1 <= zi < 5 else 'mouth') if cy > .3 else None
            G.f((a[k], a[k1], b[k1], b[k]), slot, inside=(0, .125, (zs[zi] + zs[zi + 1]) / 2),
                vein=None if slot else [(x0, 3 * k / JK), (x0, 3 * (k + 1) / JK), (x1, 3 * (k + 1) / JK), (x1, 3 * k / JK)])
    for ring, z, sgn in ((rings[0], zs[0], 1), (rings[-1], zs[-1], -1)):
        c = G.v((0, .13, z + sgn * .003), .93, {'Jaw': 1.0}, 'jaw')
        for k in range(JK): G.f((ring[(k + 1) % JK], ring[k], c), out=(0, 0, sgn))
jaw()

def lip_point(a, inset=0.0, upper=True):
    """Point on the lip line at angle a round the snout (0 = front centre, +-pi/2 = mouth corners)."""
    zc = -.132; L = (HEAD_Z1 + .012) - zc
    z = zc + L * math.cos(a) ** .8 if abs(a) < math.pi / 2 else zc
    ym, w, top, bot = head_section(z) if upper else (jaw_section(z)[2], jaw_section(z)[0], 0, 0)
    x = math.sin(a) * (w * .985 - inset)
    return Vector((x, ym - .001, z + (inset if abs(a) < 1.2 else 0) * math.cos(a)))
def smile():
    pts = []
    for i in range(13):
        t = i / 12; a = math.pi * (t - .5) * 1.0
        p = lip_point(a); corner = smoothstep(.7, 1, abs(2 * t - 1))
        pts.append(p + Vector((math.copysign(.004, p.x) * corner, .016 * corner ** 1.5, -.002 * (1 - corner))))
    tube(pts, [.0028] * 13, 4, 'line', lambda t: {'Head': 1.0}, 'deco', ao=0)
smile()
def teeth():
    for i, a in enumerate(np.linspace(-1.15, 1.15, 8)):     # upper row: cream cones hanging from the lip
        p = lip_point(a, inset=.006); ln = .013 if abs(a) < .9 else .011
        d, u, v = frame_from((0, -1, 0)); base = [p + (u * math.cos(TAU * k / 4 + .785) + v * math.sin(TAU * k / 4 + .785)) * .0048 for k in range(4)]
        tip = G.v(p + Vector((0, -ln, 0)), .5, {'Head': 1.0}, 'teeth'); bi = [G.v(q, .5, {'Head': 1.0}, 'teeth') for q in base]
        for k in range(4): G.f((bi[k], bi[(k + 1) % 4], tip), 'tooth', inside=p + Vector((0, -ln * .3, 0)))
    for a in np.linspace(-.95, .95, 6):                      # lower row on the jaw
        p = lip_point(a, inset=.009, upper=False) + Vector((0, -.002, 0)); ln = .009
        d, u, v = frame_from((0, 1, 0)); base = [p + (u * math.cos(TAU * k / 4 + .785) + v * math.sin(TAU * k / 4 + .785)) * .0042 for k in range(4)]
        tip = G.v(p + Vector((0, ln, 0)), .5, {'Jaw': 1.0}, 'teeth'); bi = [G.v(q, .5, {'Jaw': 1.0}, 'teeth') for q in base]
        for k in range(4): G.f((bi[k], bi[(k + 1) % 4], tip), 'tooth', inside=p + Vector((0, ln * .3, 0)))
teeth()

# eyes: big glossy amber eyes on the Eye bones, lids on the Lid bones, catch-lights fixed to the head
EYE_LOOK = {'L': Vector((-.2, .08, -.97)).normalized(), 'R': Vector((.2, .08, -.97)).normalized()}
LATS = [0, .3, .5, .7, 1.0, 1.45, 2.0]
def eye_slot(b):
    a = (LATS[b] + LATS[b + 1]) / 2
    return 'pupil' if a < .4 else 'iris' if a < .7 else 'eye'
for sfx, c in EYE_C.items():
    sx = -1 if sfx == 'L' else 1
    ball(c, EYE_R, EYE_LOOK[sfx], LATS, 12, eye_slot, {f'Eye{sfx}': 1.0}, 'eye', ao=.35)
    hl = (EYE_LOOK[sfx] + Vector((0, .7, 0)) + Vector((sx * -.3, 0, 0))).normalized()
    ball(c + hl * EYE_R * .9, .0068, hl, [0, 1.2, 2.2], 6, lambda b: 'highlight', {'Head': 1.0}, 'deco', ao=0)
    hl2 = (EYE_LOOK[sfx] + Vector((sx * .2, -.45, 0))).normalized()
    ball(c + hl2 * EYE_R * .97, .0032, hl2, [0, 1.4], 5, lambda b: 'highlight', {'Head': 1.0}, 'deco', ao=0)
    # upper lid: a skin shell over the back and top of the eye with a dark lash rim. Rest pose = open.
    pole = Vector((sx * .15, .32, .94)).normalized()
    lat = [0, .7, 1.3, 1.86, 1.96]
    rings = ball(c, EYE_R * 1.14, pole, lat, 10, lambda b: 'line' if b >= 3 else None, {f'Lid{sfx}': 1.0}, 'lid',
                 ramp=lambda p: .25 + .25 * smoothstep(.17, .2, p.y), ao=1.0)
    last = rings[-1]; inner = [G.v(c + (G.P[vi] - c) * .93, .1, {f'Lid{sfx}': 1.0}, 'lid') for vi in last]
    for k in range(10):
        k1 = (k + 1) % 10; G.f((last[k], last[k1], inner[k1], inner[k]), 'line', out=-pole)
    # nostril
    ym, w, top, bot = head_section(-.277)
    disc((sx * .015, ym + top * .8 + .001, -.276), (sx * .3, .75, -.6), .0035, 6, 'nostril', {'Head': 1.0}, 'deco', stretch=1.4)
    # rosy cheek blush (rides the cheek bone, so it swells with the puff)
    bc = Vector((sx * .071, .148, -.19)); disc(bc, (sx * .9, .1, -.4), .011, 8, 'blush', {f'Cheek{sfx}': 1.0}, 'deco', stretch=1.3, lift=.0015)

# ------------------------------------------------------------------ limbs: chunky arms and legs in black boots
def limb(sfx, kind):
    sh, el, wr, ft = (Vector(side_pt(p, sfx)) for p in LIMBS[kind])
    U, L = f'{kind}U{sfx}', f'{kind}L{sfx}'; H = ('Hand' if kind == 'Arm' else 'Foot') + sfx
    root = 'Spine' if kind == 'Arm' else 'Hips'
    inner = Vector((sh.x * .45, sh.y + .004, sh.z))
    upper = bezier(inner, sh + (el - sh) * .3 + Vector((0, .006, 0)), el + (sh - el) * .25, el, 4)
    lower = bezier(el, el + (wr - el) * .35 + Vector((sh.x * .06, 0, 0)), wr + (el - wr) * .4, wr + (el - wr) * .25, 3)
    path = upper + lower[1:]
    r0 = .043 if kind == 'Leg' else .037
    radii = [r0, r0 * .92, r0 * .8, r0 * .74, r0 * .72, r0 * .72]
    def wt(t):
        if t < .25: k = smoothstep(.0, .25, t); return {root: 1 - k, U: k}
        if t < .5: return {U: 1.0}
        if t < .65: k = smoothstep(.5, .65, t); return {U: 1 - k, L: k}
        return {L: 1.0}
    tube(path, radii, 7, None, wt, 'limb', cap0=False, cap1=False, ramp_fn=lambda t, a: .33 + .12 * t, vein=True)
    # the boot: a black shaft from mid-shin, a rounded foot block, three fat rounded claws
    top = wr + (el - wr) * .3; br = r0 * .8
    tube([top, wr + Vector((0, -.006, 0)), Vector((wr.x, .02, (wr.z + ft.z) / 2))], [br * 1.02, br * 1.06, br * 1.1], 8, 'boot',
         lambda t: {L: 1 - smoothstep(.2, .8, t), H: smoothstep(.2, .8, t)}, 'boot', cap0=False, cap1=False)
    fc = Vector((ft.x, .017, ft.z - .004))
    ball(fc, 1.0, (0, 1, 0), [0, 1.0, 1.9, math.pi], 8, lambda b: 'boot', {H: 1.0}, 'boot', scale=(.036, .022, .042))
    for k, dx in enumerate((-.017, 0, .017)):
        cc = fc + Vector((dx * (1 if sfx == 'L' else -1), -.006, -.039 + .004 * abs(dx) / .017))
        ball(cc, 1.0, (0, 0, -1), [0, 1.2, math.pi], 6, lambda b: 'claw', {H: 1.0}, 'boot', scale=(.0115, .0105, .0135))
for sfx in ('L', 'R'):
    limb(sfx, 'Arm'); limb(sfx, 'Leg')

# ------------------------------------------------------------------ orange spikes down the back and tail
def spike(s, h, base_len, lean=.45):
    c, t, N = section_frame(s); w = body_weights(s)
    top = bkey(s, 2); base = c + N * (top - .006); fwd = -t
    side = Vector((1, 0, 0)); tip = base + N * h - fwd * (h * lean)
    pts = [base + fwd * base_len * .5, base + side * base_len * .32, base - fwd * base_len * .55, base - side * base_len * .32]
    bi = [G.v(p, .5, w, 'spike') for p in pts]
    mid = [G.v(base.lerp(tip, .45) + (p - base) * .62, .5, w, 'spike') for p in pts]
    ti = G.v(tip, .5, w, 'spike')
    for k in range(4):
        k1 = (k + 1) % 4; G.f((bi[k], bi[k1], mid[k1], mid[k]), 'spike', inside=base + N * h * .2)
        G.f((mid[k], mid[k1], ti), 'spike_tip', inside=base + N * h * .4)
SPIKES = [(.012, .03, .032)] + [(s_of_z(z), h, l) for z, h, l in ((.04, .03, .032), (.085, .034, .036), (.13, .033, .034),
          (.175, .03, .03), (.22, .027, .027), (.265, .024, .024), (.305, .021, .021))] + \
         [(S_CURL + (BODY_LEN - S_CURL) * f, h, l) for f, h, l in ((.18, .018, .019), (.4, .015, .016), (.62, .012, .013))]
for s, h, l in SPIKES: spike(s, h * 1.3, l * 1.25)

# ------------------------------------------------------------------ gear: hard hat, harness with badge, socket and cable
def dome(c, rx, ry, rz, lats, sides, slot_fn, weight, part, tilt=0.0):
    c = Vector(c); rings = []; rot = Matrix.Rotation(tilt, 3, 'X')
    top = G.v(c + rot @ Vector((0, ry, 0)), .5, weight, part)
    for a in lats[1:]:
        rings.append([G.v(c + rot @ Vector((math.sin(a) * math.cos(TAU * k / sides) * rx, math.cos(a) * ry, math.sin(a) * math.sin(TAU * k / sides) * rz)), .5, weight, part) for k in range(sides)])
    for k in range(sides): G.f((top, rings[0][(k + 1) % sides], rings[0][k]), slot_fn(0), inside=c)
    for b, (ra, rb) in enumerate(zip(rings, rings[1:])):
        for k in range(sides):
            k1 = (k + 1) % sides; G.f((ra[k], ra[k1], rb[k1], rb[k]), slot_fn(b + 1), inside=c)
    return rings
def hard_hat():
    w = {'HatHard': 1.0}; c = Vector(HAT_BASE); tilt = .14; rot = Matrix.Rotation(tilt, 3, 'X')
    rx, ry, rz = .073, .062, .079
    dome(c, rx, ry, rz, [0, .45, .9, 1.25, 1.571], 14, lambda b: 'hat', w, 'gear', tilt=tilt)
    # brim: a flat ring with a rolled lip, stretched into a peak at the front
    sides = 14; rin, rout, rlo, rbot = [], [], [], []
    for k in range(sides):
        phi = TAU * k / sides; dx, dz = math.cos(phi), math.sin(phi); peak = .012 * max(0, -dz) ** 2
        rin.append(G.v(c + rot @ Vector((dx * rx, 0, dz * rz)), .5, w, 'gear'))
        rout.append(G.v(c + rot @ Vector((dx * (rx + .012 + peak * .3), -.003, dz * (rz + .012 + peak))), .5, w, 'gear'))
        rlo.append(G.v(c + rot @ Vector((dx * (rx + .011 + peak * .3), -.008, dz * (rz + .011 + peak))), .5, w, 'gear'))
        rbot.append(G.v(c + rot @ Vector((dx * rx * .97, -.006, dz * rz * .97)), .5, w, 'gear'))
    up = rot @ Vector((0, 1, 0))
    for k in range(sides):
        k1 = (k + 1) % sides
        G.f((rin[k], rin[k1], rout[k1], rout[k]), 'hat', out=up)
        G.f((rout[k], rout[k1], rlo[k1], rlo[k]), 'hat', inside=c)
        G.f((rlo[k], rlo[k1], rbot[k1], rbot[k]), 'hat_dark', out=-up)
    # the centre ridge, the hard hat signature
    ridge = [c + rot @ Vector((0, math.cos(a) * (ry + .002), math.sin(a) * (rz + .002))) for a in np.linspace(-1.25, 1.3, 7)]
    tube(ridge, [.007] * 7, 4, 'hat_dark', lambda t: w, 'gear', squash=.55, up=(1, 0, 0))
    # a blue lightning bolt on the front
    bc = c + rot @ Vector((.012, ry * .55, -rz * .84)); n = (rot @ Vector((0, .55, -1))).normalized(); d, u, v = frame_from(n, (0, 1, 0))
    bolt = [(.002, .015), (.011, .015), (.003, .003), (.01, .003), (-.008, -.017), (-.002, -.003), (-.009, -.003)]
    idx = [G.v(bc + u * x + v * y + d * .002, .5, w, 'gear', ao=0) for x, y in bolt]
    G.f(idx, 'bolt', out=n)
hard_hat()

def band_ring(s, width, off, slot, tiles=None, th0=0.0, th1=TAU, n=16, weight=None):
    """A strap round the body loft at arc length s (closed if th0..th1 spans the full circle)."""
    w = weight or body_weights(s); full = abs(th1 - th0 - TAU) < 1e-6; cnt = n if full else n + 1
    rings = []
    for ds in (-width / 2, width / 2):
        rings.append([G.v(body_point(s + ds, th0 + (th1 - th0) * k / n, off), .5, w, 'gear') for k in range(cnt)])
    c, _t = cl_at(s)
    for k in range(n):
        k1 = (k + 1) % cnt
        G.f((rings[0][k], rings[0][k1], rings[1][k1], rings[1][k]), slot, inside=c)
    return rings
def harness():
    s_col, s_girth = s_of_z(-.098), s_of_z(.012)
    band_ring(s_col, .016, .006, 'strap')                         # collar
    band_ring(s_girth, .014, .006, 'strap')                       # girth strap behind the front legs
    # dorsal strap: collar -> socket -> girth along the top
    sa, sb = s_col, s_girth; n = 6
    left = [G.v(body_point(sa + (sb - sa) * i / n, -.12, .007), .5, body_weights(sa + (sb - sa) * i / n), 'gear') for i in range(n + 1)]
    right = [G.v(body_point(sa + (sb - sa) * i / n, .12, .007), .5, body_weights(sa + (sb - sa) * i / n), 'gear') for i in range(n + 1)]
    for i in range(n): G.f((left[i], left[i + 1], right[i + 1], right[i]), 'strap', inside=cl_at(sa + (sb - sa) * (i + .5) / n)[0])
    # yellow chest plate: wraps the lower chest from side to side between collar and girth (the front legs come
    # through it), with a round medic badge on each flank
    nu, nv = 4, 10; ths = [1.3 + (TAU - 2.6) * j / nv for j in range(nv + 1)]
    sl = lambda i: lerp(s_col + .008, s_girth - .006, i / nu)
    bulge = lambda i, j: .009 + .003 * math.sin(math.pi * i / nu)
    grid = [[G.v(body_point(sl(i), th, bulge(i, j)), .5, body_weights(sl(i)), 'gear') for j, th in enumerate(ths)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            G.f((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]), 'harness', inside=cl_at(sl(i + .5))[0])
    for j in (0, nv):   # brown edging where the plate meets the skin
        for i in range(nu):
            ia = G.v(body_point(sl(i), ths[j] + (-.08 if j == 0 else .08), .002), .5, body_weights(sl(i)), 'gear')
            ib = G.v(body_point(sl(i + 1), ths[j] + (-.08 if j == 0 else .08), .002), .5, body_weights(sl(i + 1)), 'gear')
            G.f((grid[i][j], grid[i + 1][j], ib, ia), 'strap', inside=cl_at(sl(i + .5))[0])
    sm = lerp(s_col, s_girth, .5); wts = body_weights(sm); c0, _t = cl_at(sm)
    for th in (1.95, TAU - 1.95):
        bp = body_point(sm, th, .0135); bn = (bp - c0).normalized(); bn = (bn + Vector((0, 0, -.25))).normalized()
        d, u, v = disc(bp, bn, .017, 12, 'badge', wts, 'gear', lift=.0005)
        for (a0, a1), (b0, b1) in (((-.011, .011), (-.0037, .0037)), ((-.0037, .0037), (-.011, .011))):
            q = [bp + d * .0012 + u * x + v * y for x, y in ((a0, b0), (a1, b0), (a1, b1), (a0, b1))]
            G.f([G.v(p_, .5, wts, 'gear', ao=0) for p_ in q], 'cross', out=bn)
    # steel buckles on the collar and girth
    for s_, th in ((s_col, 1.15), (s_col, -1.15), (s_girth, 1.05), (s_girth, -1.05)):
        p = body_point(s_, th, .0095); c0, _t = cl_at(s_); n_ = (p - c0).normalized(); d, u, v = frame_from(n_, (0, 0, 1))
        q = [p + u * x + v * y for x, y in ((-.008, -.007), (.008, -.007), (.008, .007), (-.008, .007))]
        G.f([G.v(pp, .5, body_weights(s_), 'gear') for pp in q], 'buckle', out=n_)
harness()

def socket_and_cable():
    w = {'Spine': 1.0}
    base = SOCKET - SOCK_DIR * .006
    tube([base, base + SOCK_DIR * .02], [.017, .017], 8, 'brass', lambda t: w, 'gear', cap0=False, cap1=True, ao=1.0)
    # hex nut collar and the steel plug
    nut0 = base + SOCK_DIR * .02
    tube([nut0, nut0 + SOCK_DIR * .012], [.021, .021], 6, 'steel', lambda t: w, 'gear')
    tube([nut0 + SOCK_DIR * .012, nut0 + SOCK_DIR * .022], [.013, .012], 8, 'steel', lambda t: w, 'gear', cap0=False)
    # red cable stub (the runtime continues it from CableTip)
    def cw(t):
        if t < .55: return {'Cable1': 1.0}
        if t < .8: k = smoothstep(.55, .8, t); return {'Cable1': 1 - k, 'Cable2': k}
        return {'Cable2': 1.0}
    tube(CABLE_PTS, [.0095] * len(CABLE_PTS), 7, 'cable', cw, 'gear', cap0=False, cap1=False)
socket_and_cable()

def wrench():
    w = {'Wrench': 1.0}; base = WRENCH_AT; up = Vector((0, 1, -.2)).normalized()
    tube([base - up * .016, base + up * .045], [.0045, .0045], 5, 'steel', lambda t: w, 'gear', squash=.6, up=(1, 0, 0))
    hc = base + up * .057
    pts = [hc + (up * math.cos(a) + Vector((0, 0, 1)) * math.sin(a)) * .012 for a in np.linspace(.9, TAU - .9, 8)]
    tube(pts, [.0043] * 8, 4, 'steel', lambda t: w, 'gear', squash=.7, up=(1, 0, 0))
wrench()
def zzz():
    glyph = [(-.012, .014), (.012, .014), (.012, .009), (-.004, -.009), (.012, -.009), (.012, -.014), (-.012, -.014), (-.012, -.009), (.004, .009), (-.012, .009)]
    for name, sc in (('Z1', 1.0), ('Z2', 1.35)):
        h, _t, _p = BONES[name]; c = Vector(h); w = {name: 1.0}
        front = [G.v(c + Vector((x * sc, y * sc, -.003)), .5, w, 'gear', ao=0) for x, y in glyph]
        back = [G.v(c + Vector((x * sc, y * sc, .003)), .5, w, 'gear', ao=0) for x, y in glyph]
        for quad in ((0, 1, 2, 9), (2, 3, 8, 9), (3, 4, 5, 6), (3, 6, 7, 8)):
            G.f([front[i] for i in quad], 'zzz', out=(0, 0, -1)); G.f([back[i] for i in quad], 'zzz', out=(0, 0, 1))
        n = len(glyph); area = sum(glyph[k][0] * glyph[(k + 1) % n][1] - glyph[(k + 1) % n][0] * glyph[k][1] for k in range(n))
        for k in range(n):
            k1 = (k + 1) % n; dx, dy = glyph[k1][0] - glyph[k][0], glyph[k1][1] - glyph[k][1]
            G.f((front[k], front[k1], back[k1], back[k]), 'zzz', out=(dy, -dx, 0) if area > 0 else (-dy, dx, 0))
zzz()

# ------------------------------------------------------------------ face winding from the hints (outward = front face)
def face_normal(f):
    n = Vector()
    for k in range(len(f)):
        a, b = G.P[f[k]], G.P[f[(k + 1) % len(f)]]
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    return n
for i, (f, h) in enumerate(zip(G.F, G.FH)):
    assert h is not None, f'face {i} has no orientation hint'
    cen = sum((G.P[j] for j in f), Vector()) / len(f)
    want = (cen - h[1]) if h[0] == 'in' else h[1]
    if face_normal(f).dot(want) < 0:
        G.F[i] = f[::-1]
        if G.FV[i]: G.FV[i] = G.FV[i][::-1]

# ------------------------------------------------------------------ baked ambient occlusion (body, limbs and boots occlude)
tris_occ = []
for f in G.F:
    if G.part[f[0]] not in OCCLUDERS: continue
    for k in range(1, len(f) - 1): tris_occ.append((f[0], f[k], f[k + 1]))
bvh = BVHTree.FromPolygons([tuple(p) for p in G.P], tris_occ, all_triangles=True)
vn = [Vector() for _ in G.P]
for f in G.F:
    for k in range(1, len(f) - 1):
        a, b, c = f[0], f[k], f[k + 1]; n = (G.P[b] - G.P[a]).cross(G.P[c] - G.P[a])
        for i in (a, b, c): vn[i] += n
DIRS = []
for i in range(48):
    u1, u2 = (i + .5) / 48, (i * .618033988749) % 1
    r, phi = math.sqrt(u1), TAU * u2; DIRS.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(1 - u1))))
AO_DIST = .07
def ao_at(p, n):
    if n.length < 1e-12: return 1.0
    n = n.normalized(); ref = Vector((1, 0, 0)) if abs(n.x) < .9 else Vector((0, 1, 0))
    u = n.cross(ref).normalized(); v = n.cross(u); occ = 0.0
    for d in DIRS:
        dw = u * d.x + v * d.y + n * d.z
        hit = bvh.ray_cast(p + n * .0015, dw, AO_DIST)
        if hit[0] is not None: occ += 1 - (hit[3] / AO_DIST) ** .6
    ground = smoothstep(.07, .0, p.y) * .2 if n.y < 0 else 0
    return max(0.0, 1 - occ / len(DIRS) - ground)
AO = []
for i, p in enumerate(G.P):
    if G.ao[i] <= 0: AO.append(1.0); continue
    a = ao_at(p, vn[i]); AO.append(lerp(1, lerp(.45, 1, a ** 1.1), G.ao[i]))

# ------------------------------------------------------------------ Blender objects
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene; SC.render.fps = FPS; SC.frame_start = 0
img = bpy.data.images.new('LizardAtlas', TEX_W, TEX_H, alpha=False)
img.colorspace_settings.name = 'sRGB'
img.pixels.foreach_set(atlas_pixels().ravel())
img.pack(); img.file_format = 'PNG'

mat = bpy.data.materials.new('LizardSkin'); mat.use_nodes = True; nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = .5; bsdf.inputs['Metallic'].default_value = 0.0
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.interpolation = 'Linear'
vc = nt.nodes.new('ShaderNodeVertexColor'); vc.layer_name = 'Col'
mixn = nt.nodes.new('ShaderNodeMix'); mixn.data_type = 'RGBA'; mixn.blend_type = 'MULTIPLY'; mixn.inputs['Factor'].default_value = 1.0
sock = lambda socks, name: [x for x in socks if x.name == name and x.type == 'RGBA'][0]
nt.links.new(tex.outputs['Color'], sock(mixn.inputs, 'A')); nt.links.new(vc.outputs['Color'], sock(mixn.inputs, 'B'))
nt.links.new(sock(mixn.outputs, 'Result'), bsdf.inputs['Base Color'])
mat.use_backface_culling = True

bm = bmesh.new()
bv = [bm.verts.new(to_b(p)) for p in G.P]
bm.verts.index_update(); bm.verts.ensure_lookup_table()
uvl = bm.loops.layers.uv.new('UVMap'); uvv = bm.loops.layers.uv.new('Veins')
skipped = 0
for f, slot, vein in zip(G.F, G.FS, G.FV):
    try: face = bm.faces.new([bv[i] for i in f])
    except ValueError: skipped += 1; continue
    face.smooth = True
    for li, loop in enumerate(face.loops):
        loop[uvl].uv = (slot_u(slot) if slot else ramp_u(G.R[loop.vert.index]), ROW_V)
        loop[uvv].uv = vein[li] if vein else NO_VEIN
me = bpy.data.meshes.new('Lizard'); bm.to_mesh(me); bm.free()
me.materials.append(mat)
ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
ca.data.foreach_set('color', np.array([(a, a, a, 1.0) for a in AO], np.float32).ravel())
me.color_attributes.active_color = ca
try: me.set_sharp_from_angle(angle=math.radians(70))
except Exception: pass
body_ob = bpy.data.objects.new('Lizard', me); SC.collection.objects.link(body_ob)

arm_data = bpy.data.armatures.new('LizardRig'); rig = bpy.data.objects.new('LizardRig', arm_data); SC.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='EDIT')
order = list(BONES)
for name in order:
    h, t, _p = BONES[name]; eb = arm_data.edit_bones.new(name); eb.head = to_b(h); eb.tail = to_b(t); eb.roll = 0
for name in order:
    p = BONES[name][2]
    if p: arm_data.edit_bones[name].parent = arm_data.edit_bones[p]; arm_data.edit_bones[name].use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')
groups = {n: body_ob.vertex_groups.new(name=n) for n in order}
for i, w in enumerate(G.W):
    tot = sum(w.values())
    items = sorted(((k, v / tot) for k, v in w.items() if v > 1e-4), key=lambda kv: -kv[1])[:4]
    tot = sum(v for _, v in items)
    for k, v in items: groups[k].add([i], v / tot, 'REPLACE')
body_ob.parent = rig; mod = body_ob.modifiers.new('Armature', 'ARMATURE'); mod.object = rig

# ------------------------------------------------------------------ clips
AXB = {'x': Vector((1, 0, 0)), 'y': Vector((0, 0, 1)), 'z': Vector((0, -1, 0))}   # game axes in Blender
REST = {pb.name: pb.bone.matrix_local.to_quaternion() for pb in rig.pose.bones}
def apply(spec):
    """spec: {bone: {'r': (pitch_x, yaw_y, roll_z) about the newt's own axes, 'p': model-frame offset, 's': scale}}."""
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = Quaternion(); pb.location = (0, 0, 0); pb.scale = (1, 1, 1)
        v = spec.get(pb.name)
        if not v: continue
        rw = REST[pb.name]
        if 'r' in v:
            ax, ay, az = v['r']
            qm = Quaternion(AXB['y'], ay) @ Quaternion(AXB['z'], az) @ Quaternion(AXB['x'], ax)
            pb.rotation_quaternion = rw.inverted() @ qm @ rw
        if 'p' in v: pb.location = rw.inverted() @ to_b(v['p'])
        if 's' in v:
            s = v['s']; pb.scale = (s, s, s) if isinstance(s, (int, float)) else s
def add(spec, name, r=None, p=None, s=None):
    v = spec.setdefault(name, {})
    if r is not None: a = v.get('r', (0, 0, 0)); v['r'] = tuple(x + y for x, y in zip(a, r))
    if p is not None: a = v.get('p', (0, 0, 0)); v['p'] = tuple(x + y for x, y in zip(a, p))
    if s is not None: v['s'] = s
def jaw_open(spec, r):   # + opens the mouth (the jaw tip drops: a negative pitch about the newt's X)
    add(spec, 'Jaw', r=(-r[0], r[1], r[2]))
def ease(x): x = max(0.0, min(1.0, x)); return x * x * (3 - 2 * x)
def bump(x, a, b, c, d):   # 0 before a, up to 1 at b, hold to c, down to 0 at d
    if x < a or x > d: return 0.0
    return ease((x - a) / (b - a)) if x < b else 1.0 if x < c else 1 - ease((x - c) / (d - c))
def base_spec():
    return {'Z1': {'s': .001}, 'Z2': {'s': .001}}
def limb_pose(spec, side, kind, swing, lift, out=0.0):
    """swing + = foot forward, lift + = foot raised (knee/elbow bends), out + = limb spread sideways; per side."""
    sgn = 1 if side == 'L' else -1
    U, L = f'{kind}U{side}', f'{kind}L{side}'; H = ('Hand' if kind == 'Arm' else 'Foot') + side
    bend = lift * 1.1
    add(spec, U, r=(swing + lift * .55, 0, -sgn * (out + lift * .25)))
    add(spec, L, r=(-bend, 0, 0))
    add(spec, H, r=(-(swing + lift * .55 - bend), 0, sgn * (out + lift * .25) * .8))
def cheeks(spec, k):
    for c in ('CheekL', 'CheekR'): add(spec, c, s=(1 + k, 1 + k * .8, 1 + k))
LID_CLOSE = 1.75   # radians the upper lid turns to shut (the runtime blink uses the same)
def lids(spec, k):   # k 1 = shut
    add(spec, 'LidL', r=(-LID_CLOSE * k, 0, 0)); add(spec, 'LidR', r=(-LID_CLOSE * k, 0, 0))
def cable(spec, t, amt=1.0):
    add(spec, 'Cable1', r=(.06 * math.sin(TAU * t * .7) * amt, .08 * math.sin(TAU * t * .45) * amt, 0))
    add(spec, 'Cable2', r=(.1 * math.sin(TAU * t * .7 - .8) * amt, .1 * math.sin(TAU * t * .45 - .6) * amt, 0))
def tail_sway(spec, t, T, amp=.1, curl=0.0):
    for k in range(6):
        add(spec, f'Tail{k + 1}', r=((curl if k > 2 else 0) + (-.06 * math.sin(TAU * t / T + k * .5) if k > 2 else 0), amp * math.sin(TAU * (t / T - k * .1)), 0))

IDLE_T = 6.0
def clip_idle(t):
    spec = base_spec()
    br = math.sin(TAU * t / 2.0)                       # three breaths per loop
    add(spec, 'Belly', s=(1 + .04 * (br + 1) / 2, 1 + .02 * (br + 1) / 2, 1 + .04 * (br + 1) / 2))
    add(spec, 'Spine', r=(.02 + .012 * br, 0, 0)); add(spec, 'Hips', p=(0, .0012 * br, 0))
    look = .4 * bump(t, .4, .9, 1.8, 2.3) - .36 * bump(t, 3.4, 3.9, 4.7, 5.2)
    tilt = .2 * bump(t, .9, 1.3, 1.8, 2.2) - .16 * bump(t, 3.8, 4.2, 4.6, 5.0)
    add(spec, 'Head', r=(.05 + .025 * br, look, tilt)); add(spec, 'Spine', r=(0, look * .2, 0))
    add(spec, 'EyeL', r=(0, look * .45, 0)); add(spec, 'EyeR', r=(0, look * .45, 0))
    grin = 1 - bump(t, 3.9, 4.25, 5.5, 5.9)             # the big toothy grin, closing to a smile for the toe tap
    jaw_open(spec, (.3 * grin + .03 * br, 0, 0)); cheeks(spec, .05 * grin)
    tail_sway(spec, t, 3.0, .1, .05 * math.sin(TAU * t / 3))
    shift = math.sin(TAU * t / 6)                       # a slow weight shift
    add(spec, 'Root', r=(0, 0, .02 * shift))
    tap = bump(t, 4.9, 5.0, 5.05, 5.15) + bump(t, 5.25, 5.35, 5.4, 5.5)
    for side in 'LR':
        limb_pose(spec, side, 'Arm', 0, .35 * tap if side == 'R' else 0)
        limb_pose(spec, side, 'Leg', 0, 0)
    cable(spec, t)
    return spec
CLIMB_T = .6
def clip_climb(t):
    """A newt trot, diagonal pairs, in place (the runtime moves the body). About 0.1 m of travel per loop."""
    spec = base_spec(); ph = (t % CLIMB_T) / CLIMB_T
    A, Lf = .42, .55
    def leg(p):
        if p < .58: return A * (1 - 2 * p / .58), 0.0
        q = (p - .58) / .42; return -A + 2 * A * ease(q), math.sin(math.pi * q) * Lf
    for side, kind, off in (('L', 'Arm', 0), ('R', 'Leg', 0), ('R', 'Arm', .5), ('L', 'Leg', .5)):
        sw, lf = leg((ph + off) % 1)
        limb_pose(spec, side, kind, sw, lf, .08)
    bend = math.sin(TAU * ph)
    add(spec, 'Spine', r=(0, .14 * bend, .04 * bend)); add(spec, 'Hips', r=(0, -.12 * bend, -.04 * bend))
    add(spec, 'Head', r=(.04, -.12 * bend, -.03 * bend))
    add(spec, 'Hips', p=(0, .003 * abs(math.sin(TAU * ph * 2)), 0))
    jaw_open(spec, (.12, 0, 0))                    # a happy open-mouth trot
    for k in range(6):
        add(spec, f'Tail{k + 1}', r=(0, .16 * math.sin(TAU * (ph - .12 * (k + 1))), 0))
    cable(spec, t * 3, .8)
    return spec
CHEER_T = 1.6
def clip_cheer(t):
    """Charge up (crouch, eyes squeezed shut, cheeks puffed, trembling), then a big hop with arms up and a toothy grin,
    a squash on landing and a tail wag."""
    spec = base_spec()
    charge = bump(t, 0, .12, .42, .52)
    air = 0.0
    if .5 < t < 1.02: q = (t - .5) / .52; air = 4 * q * (1 - q)
    land = bump(t, 1.0, 1.06, 1.1, 1.3)
    tremble = math.sin(TAU * t * 22) * .035 * charge
    add(spec, 'Root', p=(0, -.014 * charge - .01 * land + .14 * air, 0),
        s=(1 + .08 * charge + .1 * land - .04 * air, 1 - .1 * charge - .14 * land + .08 * air, 1 + .08 * charge + .1 * land - .04 * air))
    up = bump(t, .48, .62, 1.15, 1.5)
    add(spec, 'Spine', r=(.3 * up - .08 * charge, 0, tremble)); add(spec, 'Hips', r=(-.1 * up, 0, -tremble))
    add(spec, 'Head', r=(.18 * up - .12 * charge, 0, .12 * math.sin(TAU * t * 1.4) * up + tremble))
    jaw_open(spec, (.42 * bump(t, .52, .66, 1.2, 1.5), 0, 0))
    cheeks(spec, .45 * charge + .06 * up)
    lids(spec, charge)
    wave = math.sin(TAU * t * 3.2)
    for side in 'LR':
        sg = 1 if side == 'L' else -1
        limb_pose(spec, side, 'Arm', 1.1 * up + .15 * up * wave * sg, .35 * up - .1 * charge, .9 * up)
        limb_pose(spec, side, 'Leg', -.3 * air, .3 * air + .1 * charge, .1 * charge)
    wag = bump(t, .5, .62, 1.3, 1.6)
    for k in range(6):
        add(spec, f'Tail{k + 1}', r=((.12 if k > 2 else -.05) * up + .1 * charge * (k > 2), .35 * wag * math.sin(TAU * (t * 3.0 - .1 * k)), 0))
    add(spec, 'Belly', s=(1 + .06 * charge + .04 * up, 1 + .03 * charge, 1 + .06 * charge + .04 * up))
    cable(spec, t * 2, 1 + 2 * air)
    return spec
NAP_T = 4.0
def clip_nap(t):
    """Belly down, legs flopped out, chin resting, eyes shut and the hard hat tipped over them; a big slow snore and
    two z's floating off."""
    spec = {}
    br = .5 - .5 * math.cos(TAU * t / NAP_T)          # 0 exhaled .. 1 inhaled
    snore = bump(t, 2.3, 2.6, 3.0, 3.6)
    add(spec, 'Root', p=(0, -.036, 0))
    add(spec, 'Belly', s=(1 + .09 * br, 1 + .04 * br, 1 + .09 * br))
    add(spec, 'Spine', r=(-.04 + .04 * br, 0, .03))
    add(spec, 'Head', r=(-.16 + .05 * br, -.22, .16))
    jaw_open(spec, (.04 + .14 * snore, 0, 0)); cheeks(spec, .12 * snore)
    lids(spec, 1.0)
    add(spec, 'HatHard', r=(-.3, 0, .06))
    for side in 'LR':
        limb_pose(spec, side, 'Arm', .5, 0, 1.15)
        limb_pose(spec, side, 'Leg', -.6, 0, 1.15)
    tail_sway(spec, t, NAP_T, .04, -.06)
    for name, off in (('Z1', 0.0), ('Z2', .5)):
        q = ((t / NAP_T) + off) % 1
        grow = bump(q, .0, .25, .6, .95)
        add(spec, name, p=(.015 * math.sin(TAU * q), .1 * q, .05 * q), s=max(.001, grow), r=(0, 0, .25 * math.sin(TAU * q)))
    cable(spec, t, .3)
    return spec
TINKER_T = 2.0
def clip_tinker(t):
    """Sits up a little, steadies the job with the left hand and taps it twice with the wrench; tail flicks."""
    spec = base_spec()
    add(spec, 'Spine', r=(.2, .06, 0)); add(spec, 'Hips', r=(-.05, 0, 0))
    def tap(c): return bump(t, c - .32, c - .12, c - .1, c), bump(t, c - .02, c, c + .02, c + .12)
    w1, h1 = tap(.55); w2, h2 = tap(1.0); wind = max(w1, w2); hit = max(h1, h2)
    look = bump(t, 1.3, 1.5, 1.75, 1.95)
    add(spec, 'Head', r=(-.3 + .05 * hit + .18 * look, .1 - .25 * look, .1 + .15 * look))
    add(spec, 'EyeL', r=(-.25, 0, 0)); add(spec, 'EyeR', r=(-.25, 0, 0))
    jaw_open(spec, (.1 + .2 * look, 0, 0))
    limb_pose(spec, 'L', 'Arm', .6, .15)
    limb_pose(spec, 'R', 'Arm', .7 + .55 * wind - .2 * hit, .25 + .3 * wind, .2)
    add(spec, 'Wrench', r=(-.8 * wind + .3 * hit, 0, 0))
    for side in 'LR': limb_pose(spec, side, 'Leg', .05, 0)
    for k in range(6):
        add(spec, f'Tail{k + 1}', r=(0, .12 * math.sin(TAU * (t / 2 - .08 * k)) + .22 * hit * (1 if k > 2 else .3), 0))
    add(spec, 'Belly', s=(1 + .03 * math.sin(TAU * t), 1, 1 + .03 * math.sin(TAU * t)))
    cable(spec, t)
    return spec
BITE_T = 1.8
def clip_bite(t):
    """Rear back with the jaw wide, lunge and chomp, then a fizzing, squinting, cheek-puffed shake as the zap goes in."""
    spec = base_spec()
    wind = bump(t, 0, .3, .34, .44); lunge = bump(t, .34, .46, 1.15, 1.45)
    shake = bump(t, .48, .56, 1.1, 1.2)
    add(spec, 'Root', p=(0, .006 * wind, .012 * wind - .045 * lunge))
    add(spec, 'Spine', r=(.16 * wind - .18 * lunge, 0, .05 * math.sin(TAU * t * 9) * shake))
    add(spec, 'Hips', r=(-.06 * wind + .08 * lunge, 0, 0))
    add(spec, 'Head', r=(.4 * wind - .12 * lunge, .06 * math.sin(TAU * t * 4.5) * shake, .16 * math.sin(TAU * t * 9) * shake))
    jaw_open(spec, (.75 * bump(t, .05, .3, .4, .48) + .06 * shake, 0, 0))
    lids(spec, .9 * shake); cheeks(spec, .25 * shake)
    for side in 'LR':
        limb_pose(spec, side, 'Arm', .25 * lunge - .1 * wind, .2 * wind, .05)
        limb_pose(spec, side, 'Leg', -.25 * lunge, 0, .05)
    for k in range(6):
        add(spec, f'Tail{k + 1}', r=(.08 * wind * (k > 2), .25 * math.sin(TAU * (t * 4 - .12 * k)) * shake + .05 * math.sin(TAU * t / 1.8), 0))
    cable(spec, t * 3, 1 + shake)
    return spec

CLIPS = {'idle': (clip_idle, IDLE_T), 'climb': (clip_climb, CLIMB_T), 'cheer': (clip_cheer, CHEER_T), 'nap': (clip_nap, NAP_T),
         'tinker': (clip_tinker, TINKER_T), 'bite': (clip_bite, BITE_T)}
ONCE = {'cheer'}
# what each clip keys: every bone's rotation (so clips always own the pose the runtime layers on), location and scale
# only where used; the repack drops whatever never leaves rest
KEYED = {n: ('rotation_quaternion', 'location', 'scale') for n in ('Root', 'Z1', 'Z2')}
KEYED.update({'Hips': ('rotation_quaternion', 'location'), 'Belly': ('rotation_quaternion', 'scale'),
              'CheekL': ('rotation_quaternion', 'scale'), 'CheekR': ('rotation_quaternion', 'scale')})
rig.animation_data_create()
for name, (fn, T) in CLIPS.items():
    act = bpy.data.actions.new(name); rig.animation_data.action = act
    n = int(round(T * FPS))
    for fi in range(n + 1):
        apply(fn(T if (fi == n and name in ONCE) else (fi / FPS if fi < n else 0.0)))
        for pb in rig.pose.bones:
            for path in KEYED.get(pb.name, ('rotation_quaternion',)):
                pb.keyframe_insert(path, frame=fi, group=pb.name)
    track = rig.animation_data.nla_tracks.new(); track.name = name
    track.strips.new(name, 0, act); track.mute = True
    rig.animation_data.action = None
apply({})

# ------------------------------------------------------------------ GLB repack: quantized attributes and rotation keys
def quantize_glb(path):
    raw = open(path, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]
    doc = json.loads(raw[20:20 + jl]); bin0 = raw[20 + jl + 8:]
    CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
    NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
    def read(ai):
        a = doc['accessors'][ai]; bv = doc['bufferViews'][a['bufferView']]; n = NC[a['type']]; dt = CT[a['componentType']]
        assert bv.get('byteStride', n * np.dtype(dt).itemsize) == n * np.dtype(dt).itemsize, 'interleaved view'
        return np.frombuffer(bin0, dt, a['count'] * n, bv.get('byteOffset', 0) + a.get('byteOffset', 0)).reshape(a['count'], n).copy()
    # animations: a channel that never moves from the bone's rest value is dropped (three restores the rest pose when
    # no clip drives a bone); one that holds a single other value keeps two keys
    newdata = {}
    for anim in doc.get('animations', []):
        keep_ch, keep_s = [], []
        for ch in anim['channels']:
            smp = anim['samplers'][ch['sampler']]; node = doc['nodes'][ch['target']['node']]; path_ = ch['target']['path']
            inp, outp = read(smp['input']), read(smp['output'])
            rest = np.array(node.get(path_, {'rotation': [0, 0, 0, 1], 'translation': [0, 0, 0], 'scale': [1, 1, 1]}[path_]), np.float32)
            const = np.abs(outp - outp[0]).max() < 1e-5
            if const and np.abs(outp[0] - rest).max() < 1e-4: continue
            if const:
                ti = len(doc['accessors']); doc['accessors'].append(dict(doc['accessors'][smp['input']], count=2, min=[float(inp[0, 0])], max=[float(inp[-1, 0])]))
                newdata[ti] = np.array([inp[0], inp[-1]], np.float32)
                to = len(doc['accessors']); oa = dict(doc['accessors'][smp['output']], count=2); oa.pop('min', None); oa.pop('max', None)
                doc['accessors'].append(oa); newdata[to] = np.array([outp[0], outp[0]], np.float32)
                smp = dict(smp, input=ti, output=to)
            keep_s.append(smp); keep_ch.append(dict(ch, sampler=len(keep_s) - 1))
        anim['channels'], anim['samplers'] = keep_ch, keep_s
    used = set()
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            used.update(prim['attributes'].values())
            if 'indices' in prim: used.add(prim['indices'])
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin: used.add(skin['inverseBindMatrices'])
    for anim in doc.get('animations', []):
        for smp in anim['samplers']: used.update((smp['input'], smp['output']))
    order_acc = sorted(used); remap_acc = {old: new for new, old in enumerate(order_acc)}
    datas = [newdata[ai] if ai in newdata else read(ai) for ai in order_acc]
    doc['accessors'] = [doc['accessors'][ai] for ai in order_acc]
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            prim['attributes'] = {k: remap_acc[v] for k, v in prim['attributes'].items()}
            if 'indices' in prim: prim['indices'] = remap_acc[prim['indices']]
    for skin in doc.get('skins', []):
        if 'inverseBindMatrices' in skin: skin['inverseBindMatrices'] = remap_acc[skin['inverseBindMatrices']]
    for anim in doc.get('animations', []):
        for smp in anim['samplers']: smp['input'] = remap_acc[smp['input']]; smp['output'] = remap_acc[smp['output']]
    read = lambda ai: datas[ai]
    conv = {}
    for mesh in doc['meshes']:
        for prim in mesh['primitives']:
            at = prim['attributes']
            conv[at['NORMAL']] = 'normal'; conv[at['COLOR_0']] = 'colour'; conv[at['WEIGHTS_0']] = 'weights'
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
        elif kind == 'rotation':
            q = np.clip(np.round(data / np.maximum(np.linalg.norm(data, axis=1, keepdims=True), 1e-9) * 32767), -32767, 32767).astype(np.int16)
            a.update(componentType=5122, normalized=True); a.pop('min', None); a.pop('max', None)
            a['bufferView'] = push(q.tobytes())
        else:
            a['bufferView'] = push(data.astype(CT[a['componentType']]).tobytes(), target)
    doc['bufferViews'] = views; doc['buffers'] = [{'byteLength': len(out)}]
    for s in doc.get('samplers', []): s['magFilter'] = 9729; s['minFilter'] = 9729; s['wrapS'] = 33071; s['wrapT'] = 33071
    for k in ('extensionsUsed', 'extensionsRequired'): doc[k] = sorted(set(doc.get(k, [])) | {'KHR_mesh_quantization'})
    js = json.dumps(doc, separators=(',', ':')).encode(); js += b' ' * (-len(js) % 4)
    while len(out) % 4: out.append(0)
    blob = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(out)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(out), 0x004E4942) + bytes(out)
    open(path, 'wb').write(blob)
    return doc

# ------------------------------------------------------------------ checks and export
tri_count = sum(len(p.vertices) - 2 for p in me.polygons)
parts = {}
for f in G.F:
    w = G.W[f[0]]; b = next(iter(w)) if G.part[f[0]] == 'gear' and len(w) == 1 and next(iter(w)) in ('HatHard', 'Wrench', 'Z1', 'Z2') else G.part[f[0]]
    parts[b] = parts.get(b, 0) + len(f) - 2
REPORT = {'triangles': tri_count, 'triangles_by_part': parts, 'vertices': len(me.vertices), 'materials': len(me.materials),
          'bones': len(order), 'skipped_faces': skipped, 'atlas': [TEX_W, TEX_H]}
assert tri_count < 4000, REPORT
assert skipped == 0, REPORT
assert all(abs(sum(g.weight for g in v.groups) - 1) < 1e-3 for v in me.vertices), 'every vertex fully weighted'
os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                          export_animations=True, export_animation_mode='NLA_TRACKS', export_force_sampling=False,
                          export_optimize_animation_size=True, export_def_bones=False, export_anim_single_armature=True,
                          export_morph=False, export_materials='EXPORT', export_normals=True, export_texcoords=True,
                          export_vertex_color='ACTIVE', export_extras=False, export_image_format='AUTO')
doc = quantize_glb(OUT)
REPORT['animations'] = {a['name']: len(a['channels']) for a in doc.get('animations', [])}
REPORT['bytes'] = os.path.getsize(OUT); REPORT['seconds'] = round(time.time() - T0, 1)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps(REPORT))
assert set(REPORT['animations']) == set(CLIPS), REPORT['animations']
print('LIZARD_BUILD_OK')
