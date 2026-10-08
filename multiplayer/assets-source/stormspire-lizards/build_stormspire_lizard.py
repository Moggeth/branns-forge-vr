"""Stormspire lizard crew: the Voltnewt (level 2, production pass) - reproducible Blender (bpy 4.5+/5.0) builder.

Run:  python3.11 build_stormspire_lizard.py -- --out ../../public/assets/stormspire-lizard.glb
      python3.11 build_stormspire_lizard.py -- --out out/stormspire-lizard.glb      (scratch build + report only)
      (pip install bpy numpy; the system python3 needs Pillow, which encodes the JPEG textures)
Prints LIZARD_BUILD_OK as its last line on success. Blender can exit 0 after a Python traceback, so check for it.

Design: Mitch's concept sheet "03 · VOLTNEWT" (2026-10-07). A chunky teal newt about 0.6 m nose to tail: darker teal
spots, a cream belly, throat and jaw, a row of rounded orange spikes down the back and a thick tail that rises and curls
over into a hook. Big friendly amber eyes high on a broad head and a wide toothy grin (cream cone teeth, a deep red
mouth, a pink tongue). Work gear: a yellow hard hat with a blue lightning bolt (an orange spike pokes out behind it), a
yellow leather chest harness with brown straps, buckles and a round white badge with a red cross, a brass and steel
power socket on the upper back with a red cable, and black chunky boots with rounded claws. Glowing blue electric veins
run under the skin.
Faces: the grin (jaw), a squinting charged-up face (eyelids shut into dark curved closed-eye lines, cheeks puffed by
the Cheek bones, veins flaring), and the bite that zaps.

Everything is authored in the game frame (X = the newt's right, Y up, -Z forward, origin on the ground under the belly,
metres) and converted to Blender's Z-up on the way in, so these numbers match client/stormspire-lizards.js.

One skinned mesh, one material (LizardSkin), three 512 x 512 JPEG textures sharing one UV layout:
  - base colour: painted procedurally per texel from the rest-pose surface point (3D noise, so there are no seams):
    a back-to-belly skin ramp, mottling, clustered dark spots and speckles, transverse belly scales, a painted amber
    iris, a scuffed hard hat, a stitched leather chest plate and graded spikes; gear details live in 16 px solid cells.
  - normal (glTF convention): pebbly skin, belly scale grooves, hat dents, stitching and leather grain.
  - metallic-roughness: G = roughness (wet skin 0.3, matte belly, glossy eyes and boots), B = metalness (brass, steel)
    and R = a vein mask (domain-warped noise isolines) the runtime lights as flickering blue electricity.
UV regions (Blender pixels, y up): see REGIONS. The left limbs and eye are painted; the right ones share their texels.
Vertex colour COLOR_0 carries data, not colour: R = baked ambient occlusion, G = self-glow (eye, catch-lights, z's,
badge), B = skin mask (the runtime shifts the skin hue per crew member and adds a wet sheen there).

The hard hat and the wrench hang on their own bones so the runtime can show the wrench only while tinkering. Bones
Cable1..2 carry the cable stub; the runtime continues the cable from CableTip to wherever the newt is plugged in.

Clips (glTF animations, 30 fps samples): idle, climb, cheer, nap, tinker, bite. After export the GLB is repacked with
KHR_mesh_quantization (byte normals, colours and weights) and 16-bit rotation keys; channels that never leave rest are
dropped, and the three textures are swapped in as JPEGs (4:4:4 for the data maps).
"""
import os, sys, subprocess
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

# ------------------------------------------------------------------ texture layout (Blender pixels, origin bottom left)
TEX, PAD, CELL = 512, 3, 16
REGIONS = {
    'body':  (0, 288, 512, 224),    # x along the loft (neck -> tail tip), y round it (seam under the belly)
    'head':  (0, 128, 256, 160),    # x round the head (seam inside the mouth), y snout-ward
    'jaw':   (256, 192, 128, 96),
    'arm':   (384, 224, 128, 64),   # x round the limb, y shoulder -> wrist; left painted, right shares
    'leg':   (384, 160, 128, 64),
    'lid':   (256, 160, 64, 32),
    'spike': (320, 160, 64, 32),    # x per spike, y base -> tip
    'eye':   (256, 0, 128, 128),    # polar: the pupil at the centre
    'plate': (0, 80, 256, 48),
    'hat':   (384, 32, 128, 128),   # top-down projection of the dome and brim
}
SLOT_AREA = (0, 0, 256, 80)
SKIN_REGIONS = {'body', 'head', 'jaw', 'arm', 'leg', 'lid'}
def _overlap(a, b): return a[0] < b[0] + b[2] and b[0] < a[0] + a[2] and a[1] < b[1] + b[3] and b[1] < a[1] + a[3]
_rects = list(REGIONS.values()) + [SLOT_AREA]
assert not any(_overlap(a, b) for i, a in enumerate(_rects) for b in _rects[i + 1:]), 'texture regions overlap'
assert all(r[0] + r[2] <= TEX and r[1] + r[3] <= TEX for r in _rects)
def reg_uv(name, a, b):
    x0, y0, w, h = REGIONS[name]; return (x0 + PAD + a * (w - 2 * PAD), y0 + PAD + b * (h - 2 * PAD))
# solid cells: colour, roughness, metalness
SLOTS = dict(mouth=('6e1a2c', .32, 0), mouth_dark=('3e0b17', .4, 0), tongue=('f0717f', .3, 0), tooth=('fbf1d2', .28, 0),
             hat=('ffc61f', .32, 0), hat_dark=('d08510', .45, 0), bolt=('2f7fe8', .35, 0), strap=('6e4126', .7, 0),
             buckle=('a7afb6', .3, 1), badge=('fbf7ee', .45, 0), cross=('e2302e', .45, 0), brass=('d29b40', .32, 1),
             steel=('9aa4ad', .28, 1), cable=('d8402e', .42, 0), boot=('232328', .34, 0), sole=('141417', .6, 0),
             claw=('34343b', .3, 0), zzz=('eaf6ff', .5, 0), line=('241210', .6, 0), highlight=('ffffff', .1, 0),
             nostril=('0d3236', .6, 0), lash=('163f44', .5, 0), blush=('f58a86', .5, 0), skin_back=('157f95', .34, 0), skin_mid=('23a596', .34, 0),
             cream=('e3dfb5', .45, 0), harness=('f2b92a', .6, 0), spike=('f07a22', .45, 0))
SLOT_NAMES = list(SLOTS)
assert len(SLOT_NAMES) <= (SLOT_AREA[2] // CELL) * (SLOT_AREA[3] // CELL)
def slot_px(name):
    i = SLOT_NAMES.index(name); cols = SLOT_AREA[2] // CELL
    return (SLOT_AREA[0] + CELL * (i % cols) + CELL / 2, SLOT_AREA[1] + CELL * (i // cols) + CELL / 2)
def srgb(h): return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
# the skin ramp (value 0 dark spot teal, .2 back, .45 flank, .95 cream belly)
RAMP = [(0, '0a4656'), (.2, '157f95'), (.45, '22a497'), (.62, '58c3a3'), (.85, 'e3dfb5'), (1, 'f4f0d4')]

# ------------------------------------------------------------------ geometry accumulator
class Geo:
    def __init__(self):
        self.P, self.R, self.W, self.part, self.ao, self.glow = [], [], [], [], [], []
        self.F, self.FS, self.FH, self.FU, self.FB = [], [], [], [], []
    def v(self, p, ramp, w, part, ao=1.0, glow=0.0):
        self.P.append(Vector(p)); self.R.append(ramp); self.W.append(w); self.part.append(part); self.ao.append(ao); self.glow.append(glow)
        return len(self.P) - 1
    def f(self, idx, slot=None, inside=None, out=None, uv=None, bake=True):
        """A face; its winding is fixed later so it faces away from `inside` (a point) or along `out` (a direction).
        uv: (region, [per-corner texture pixel]) for painted faces; slot faces sample their solid cell."""
        assert (slot is None) != (uv is None), 'a face is either painted (uv) or a solid slot'
        self.F.append(list(idx)); self.FS.append(slot); self.FU.append(uv); self.FB.append(bake)
        self.FH.append(('in', Vector(inside)) if inside is not None else ('out', Vector(out)) if out is not None else None)
G = Geo()
OCCLUDERS = {'body', 'head', 'jaw', 'eye', 'limb', 'boot'}
SKIN_PARTS = {'body', 'head', 'jaw', 'limb', 'lid'}
LID_CLOSE = 1.75   # radians the upper lid turns to shut (the runtime blink uses the same)

def frame_from(axis, up=(0, 1, 0)):
    d = Vector(axis).normalized(); ref = Vector(up)
    if abs(d.dot(ref)) > .95: ref = Vector((1, 0, 0)) if abs(d.x) < .9 else Vector((0, 0, 1))
    u = ref.cross(d).normalized(); v = d.cross(u)
    return d, u, v

def ball(c, r, axis, lats, sides, slot_fn, weight, part, scale=(1, 1, 1), ramp=.5, ao=1.0, up=(0, 1, 0), phase=0.0,
         uvf=None, region=None, bake=True, glow=0.0):
    """Sphere (or cap) with its pole along axis; latitude rings at the given angles (radians from the pole).
    slot_fn(band) -> slot name, or None for a painted band mapped by uvf(angle, phi) into `region`."""
    c = Vector(c); d, u, v = frame_from(axis, up)
    def P(a, phi):
        q = d * math.cos(a) + (u * math.cos(phi) + v * math.sin(phi)) * math.sin(a)
        return c + Vector((q.x * scale[0], q.y * scale[1], q.z * scale[2])) * r
    rr = ramp if callable(ramp) else (lambda p, _r=ramp: _r)
    wf = weight if callable(weight) else (lambda p, _w=weight: _w)
    closed = abs(lats[-1] - math.pi) < 1e-6
    ring_a = lats[1:-1] if closed else lats[1:]
    top = G.v(P(0, 0), rr(P(0, 0)), wf(P(0, 0)), part, ao, glow); rings = []
    for a in ring_a:
        ring = []
        for k in range(sides):
            p = P(a, TAU * k / sides + phase); ring.append(G.v(p, rr(p), wf(p), part, ao, glow))
        rings.append(ring)
    ph = lambda k: TAU * k / sides + phase
    def face(idx, band, corners):
        s = slot_fn(band)
        if s is None: G.f(idx, None, inside=c, uv=(region, [uvf(a, p) for a, p in corners]), bake=bake)
        else: G.f(idx, s, inside=c)
    for k in range(sides):
        face((top, rings[0][(k + 1) % sides], rings[0][k]), 0, [(0, ph(k + .5)), (ring_a[0], ph(k + 1)), (ring_a[0], ph(k))])
    for b, (ra, rb) in enumerate(zip(rings, rings[1:])):
        for k in range(sides):
            k1 = (k + 1) % sides
            face((ra[k], ra[k1], rb[k1], rb[k]), b + 1, [(ring_a[b], ph(k)), (ring_a[b], ph(k + 1)), (ring_a[b + 1], ph(k + 1)), (ring_a[b + 1], ph(k))])
    if closed:
        bot = G.v(P(math.pi, 0), rr(P(math.pi, 0)), wf(P(math.pi, 0)), part, ao, glow)
        for k in range(sides):
            face((rings[-1][k], rings[-1][(k + 1) % sides], bot), len(lats) - 2, [(ring_a[-1], ph(k)), (ring_a[-1], ph(k + 1)), (math.pi, ph(k + .5))])
    return rings

def tube(path, radii, sides, slot, weight_fn, part, cap0=True, cap1=True, squash=1.0, up=None, ramp=.5, ao=1.0,
         ramp_fn=None, region=None, bake=True, cap_slot=None, glow=0.0):
    """Tube along a polyline with parallel-transported frames. weight_fn(t) gets t in 0..1. With region (and no slot)
    the tube is painted: x round it, y along it."""
    path = [Vector(p) for p in path]; n = len(path); rings = []
    tang = [(path[min(i + 1, n - 1)] - path[max(i - 1, 0)]).normalized() for i in range(n)]
    ref = Vector(up) if up else (Vector((0, 1, 0)) if abs(tang[0].y) < .9 else Vector((1, 0, 0)))
    nrm = (ref - tang[0] * ref.dot(tang[0])).normalized()
    along = [0.0]
    for i in range(1, n): along.append(along[-1] + (path[i] - path[i - 1]).length)
    L = along[-1] or 1.0
    for i in range(n):
        if i: nrm = (nrm - tang[i] * nrm.dot(tang[i])).normalized()
        bi = tang[i].cross(nrm); t = i / (n - 1); ring = []
        for k in range(sides):
            a = TAU * k / sides
            p = path[i] + (nrm * math.cos(a) + bi * math.sin(a) * squash) * radii[i]
            ring.append(G.v(p, ramp_fn(t, a) if ramp_fn else ramp, weight_fn(t), part, ao, glow))
        rings.append(ring)
    for i, (a, b) in enumerate(zip(rings, rings[1:])):
        mid = (path[i] + path[i + 1]) / 2
        for k in range(sides):
            k1 = (k + 1) % sides
            if slot is None:
                y0, y1 = along[i] / L, along[i + 1] / L; x0, x1 = k / sides, (k + 1) / sides
                G.f((a[k], a[k1], b[k1], b[k]), None, inside=mid, bake=bake,
                    uv=(region, [reg_uv(region, x0, y0), reg_uv(region, x1, y0), reg_uv(region, x1, y1), reg_uv(region, x0, y1)]))
            else: G.f((a[k], a[k1], b[k1], b[k]), slot, inside=mid)
    cs = cap_slot or slot or 'skin_mid'
    if cap0:
        c = G.v(path[0] - tang[0] * radii[0] * .5, ramp_fn(0, 0) if ramp_fn else ramp, weight_fn(0), part, ao, glow)
        for k in range(sides): G.f((rings[0][(k + 1) % sides], rings[0][k], c), cs, out=-tang[0])
    if cap1:
        c = G.v(path[-1] + tang[-1] * radii[-1] * .5, ramp_fn(1, 0) if ramp_fn else ramp, weight_fn(1), part, ao, glow)
        for k in range(sides): G.f((rings[-1][k], rings[-1][(k + 1) % sides], c), cs, out=tang[-1])
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
def disc(c, normal, r, sides, slot, weight, part, stretch=1.0, lift=.0008, glow=0.0):
    d, u, v = frame_from(normal); c = Vector(c) + d * lift
    ctr = G.v(c, .5, weight, part, ao=0, glow=glow)
    ring = [G.v(c + (u * math.cos(TAU * k / sides) * stretch + v * math.sin(TAU * k / sides)) * r, .5, weight, part, ao=0, glow=glow) for k in range(sides)]
    for k in range(sides): G.f((ctr, ring[k], ring[(k + 1) % sides]), slot, out=d)
    return d, u, v

# ------------------------------------------------------------------ body + tail: one loft from the neck to the hook tip
# centreline (z, y) from the neck (inside the head) back to the tail tip; the thick tail rises behind the hips and
# curls over forward into a hook (its spikes, on the dorsal side, run along the inside of the curl as on the sheet)
CL = [(-.135, .142), (-.09, .128), (-.03, .12), (.03, .116), (.09, .112), (.15, .104), (.21, .099), (.265, .108),
      (.312, .134), (.347, .178), (.365, .232), (.36, .282), (.337, .316), (.302, .33), (.272, .318), (.262, .293)]
SPN = catmull(CL, 20)
SPL = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(SPN, axis=0), axis=1))]); BODY_LEN = float(SPL[-1])
def cl_at(s):
    z = np.interp(s, SPL, SPN[:, 0]); y = np.interp(s, SPL, SPN[:, 1])
    s0, s1 = max(0, s - .004), min(BODY_LEN, s + .004)
    t = Vector((0, np.interp(s1, SPL, SPN[:, 1]) - np.interp(s0, SPL, SPN[:, 1]), np.interp(s1, SPL, SPN[:, 0]) - np.interp(s0, SPL, SPN[:, 0]))).normalized()
    return Vector((0, float(y), float(z))), t
def s_of_z(z):   # only valid before the curl (z increasing)
    k = int(np.argmax(SPN[:, 0] > .33)); return float(np.interp(z, SPN[:k, 0], SPL[:k]))
S_TAIL0 = s_of_z(.13); S_CURL = s_of_z(.29)
# (s, half width, top, bottom, superellipse exponent): soft and round, a big chest, a thick tail to a rounded hook
BKEYS = [(0, .056, .05, .05, 2.1), (s_of_z(-.075), .079, .06, .068, 2.15), (s_of_z(-.01), .091, .064, .077, 2.25),
         (s_of_z(.05), .089, .063, .075, 2.25), (s_of_z(.1), .075, .057, .061, 2.15), (s_of_z(.15), .062, .051, .051, 2.1),
         (s_of_z(.22), .056, .05, .049, 2.05), (s_of_z(.29), .05, .047, .046, 2.0), (lerp(S_CURL, BODY_LEN, .45), .043, .041, .041, 2.0),
         (lerp(S_CURL, BODY_LEN, .8), .034, .033, .033, 2.0), (BODY_LEN - .018, .025, .025, .025, 2.0), (BODY_LEN, .008, .008, .008, 2.0)]
BK = np.array([k[0] for k in BKEYS])
def bkey(s, i):
    vals = [k[i] for k in BKEYS]; s = min(max(s, BK[0]), BK[-1])
    j = min(int(np.searchsorted(BK, s, side='right') - 1), len(BK) - 2); t = (s - BK[j]) / (BK[j + 1] - BK[j])
    return lerp(vals[j], vals[j + 1], t * t * (3 - 2 * t))
def section_frame(s):
    c, t = cl_at(s); N = Vector((0, t.z, -t.y)).normalized()   # dorsal; turns with the curl (inside of the hook)
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
EYE_C = {'L': Vector((-.049, .181, -.234)), 'R': Vector((.049, .181, -.234))}
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
HAT_BASE = (0, .221, -.16)
BONES['HatHard'] = (HAT_BASE, (0, .27, -.165), 'Head')
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
        h = .03 if jn > 2 else .035
        if abs(s - js[jn]) < h:
            t = smoothstep(-h, h, s - js[jn]); w = {names[jn - 1]: 1 - t, names[jn]: t}; break
    return w

K = 16
def body():
    s = 0.0; ss = []
    while s < BODY_LEN - .002:
        ss.append(s); s += .021 if s < S_TAIL0 else .028 if s < S_CURL else .024
    ss.append(BODY_LEN - .001)
    rings, cents = [], []
    for s in ss:
        c, t, N = section_frame(s); cents.append(c)
        w, top, bot, n = (bkey(s, i) for i in (1, 2, 3, 4)); ring = []
        for k in range(K):
            th = TAU * k / K; cx, cy = math.sin(th), math.cos(th)
            x = w * se(cx, n); y = (top if cy >= 0 else bot) * se(cy, n)
            if cy < -.7: y *= .96                     # a slightly flat belly
            p = c + Vector((1, 0, 0)) * x + N * y
            t_up = (cy + 1) / 2
            ce = lerp(.42, .26, smoothstep(S_TAIL0, S_CURL, s))   # the cream underside narrows along the tail
            ramp = .2 + .25 * smoothstep(.95, .45, t_up) + .5 * smoothstep(ce, ce - .2, t_up)   # back .2, flank .45, cream belly .95
            wts = body_weights(s)
            if -.07 < c.z < .07 and s < S_TAIL0:   # breathing: the belly bone inflates the torso
                kb = .65 * smoothstep(-.07, -.02, c.z) * smoothstep(.07, .02, c.z)
                wts = {k_: v * (1 - kb) for k_, v in wts.items()}; wts['Belly'] = wts.get('Belly', 0) + kb
            ring.append(G.v(p, ramp, wts, 'body'))
        rings.append(ring)
    bv = lambda k: (k / K + .5) % 1.0       # round the loft, the seam under the belly
    for i, (a, b) in enumerate(zip(rings, rings[1:])):
        mid = (cents[i] + cents[i + 1]) / 2; x0, x1 = ss[i] / BODY_LEN, ss[i + 1] / BODY_LEN
        for k in range(K):
            k1 = (k + 1) % K; y0 = bv(k); y1 = y0 + 1 / K
            G.f((a[k], b[k], b[k1], a[k1]), inside=mid,
                uv=('body', [reg_uv('body', x0, y0), reg_uv('body', x1, y0), reg_uv('body', x1, y1), reg_uv('body', x0, y1)]))
    c0, t0 = cl_at(0); cap = G.v(c0 - t0 * .01, .3, {'Head': 1.0}, 'body')
    for k in range(K): G.f((rings[0][k], rings[0][(k + 1) % K], cap), 'skin_back', out=-t0)
    c1, t1 = cl_at(BODY_LEN); cap = G.v(c1 + t1 * .004, .4, body_weights(BODY_LEN), 'body')
    for k in range(K): G.f((rings[-1][(k + 1) % K], rings[-1][k], cap), 'skin_back', out=t1)
body()

# ------------------------------------------------------------------ head: broad newt head, cheeks, a big grinning jaw
HK = 16
HEAD_Z0, HEAD_Z1 = -.095, -.288
def head_section(z):
    """mouth line y, half width, height above the mouth line, depth below it (inside the jaw)."""
    u = max(0, min(1, (z - HEAD_Z0) / (HEAD_Z1 - HEAD_Z0)))
    U = [0, .1, .28, .5, .7]
    w = np.interp(u, U, [.022, .067, .087, .087, .078])
    top = np.interp(u, U, [.025, .07, .082, .076, .061])
    bot = np.interp(u, U, [.014, .024, .026, .022, .018])
    if u > .7:   # a broad, round snout: the front third is a quarter ellipse in plan and in profile
        e = math.sqrt(max(0.0, 1 - ((u - .7) / .3) ** 2)) * .93 + .07 * (1 - (u - .7) / .3)
        w, top, bot = w * e, top * e, bot * e
    ym = np.interp(u, [0, .3, .7, 1], [.146, .14, .137, .136])
    return float(ym), float(w), float(top), float(bot)
CHEEK_C = .062
def cheek_w(p):
    out = {}
    for sfx, sx in (('L', -1), ('R', 1)):
        d = (p - Vector((sx * CHEEK_C, .142, -.186))).length
        k = .9 * smoothstep(.054, .01, d)
        if k > 0: out[f'Cheek{sfx}'] = k
    return out
def head():
    zs = [HEAD_Z0 + (HEAD_Z1 - HEAD_Z0) * u for u in (0, .1, .2, .3, .4, .5, .6, .7, .79, .87, .93, .97, 1)]; rings = []
    for z in zs:
        ym, w, top, bot = head_section(z); ring = []
        for k in range(HK):
            th = TAU * k / HK; cx, cy = math.sin(th), math.cos(th)
            x = w * se(cx, 2.2); y = (top if cy >= 0 else bot) * se(cy, 2.45)
            p = Vector((x, ym + y, z)); t_up = (cy + 1) / 2
            ramp = .2 + .25 * smoothstep(.95, .55, t_up) + .5 * smoothstep(.5, .4, t_up)
            ck = cheek_w(p); wts = {'Head': 1 - sum(ck.values()), **ck}
            ring.append(G.v(p, ramp, wts, 'head'))
        rings.append(ring)
    bv = lambda k: (k / HK + .5) % 1.0
    for zi, (a, b) in enumerate(zip(rings, rings[1:])):
        y0, y1 = (zs[zi] - HEAD_Z0) / (HEAD_Z1 - HEAD_Z0), (zs[zi + 1] - HEAD_Z0) / (HEAD_Z1 - HEAD_Z0)
        for k in range(HK):
            k1 = (k + 1) % HK; cy = math.cos(TAU * (k + .5) / HK); z = (zs[zi] + zs[zi + 1]) / 2
            inside = (0, head_section(z)[0], z)
            if cy < -.3 and z < -.125: G.f((a[k], a[k1], b[k1], b[k]), 'mouth_dark' if z > -.172 else 'mouth', inside=inside); continue
            x0 = bv(k); x1 = x0 + 1 / HK
            G.f((a[k], a[k1], b[k1], b[k]), None, inside=inside,
                uv=('head', [reg_uv('head', x0, y0), reg_uv('head', x1, y0), reg_uv('head', x1, y1), reg_uv('head', x0, y1)]))
    for ring, z, sgn in ((rings[0], zs[0], 1), (rings[-1], zs[-1], -1)):
        ym, w, top, bot = head_section(z); c = G.v((0, ym + (top - bot) * .3, z + sgn * .004), .25, {'Head': 1.0}, 'head')
        for k in range(HK): G.f((ring[(k + 1) % HK], ring[k], c), 'skin_mid', out=(0, 0, sgn))
head()

JAW_Z0, JAW_Z1 = -.115, -.28
def jaw_section(z):
    u = (z - JAW_Z0) / (JAW_Z1 - JAW_Z0)
    w = float(np.interp(u, [0, .2, .55, .85, 1], [.04, .075, .076, .063, .03]))
    dep = float(np.interp(u, [0, .2, .55, .85, 1], [.03, .058, .056, .045, .02]))
    ytop = float(np.interp(u, [0, 1], [.142, .136]))
    return w, dep, ytop
def jaw():
    JK = 12; zs = list(np.linspace(JAW_Z0, JAW_Z1, 7)); rings = []
    for z in zs:
        w, dep, ytop = jaw_section(z); ring = []
        for k in range(JK):
            th = TAU * k / JK; cx, cy = math.sin(th), math.cos(th)
            x = w * se(cx, 2.3); y = ytop - .003 + (.002 * se(cy, 6) if cy > 0 else dep * se(cy, 2.2))
            p = Vector((x * .97, y, z)); ck = cheek_w(p); ck = {k_: v * .5 for k_, v in ck.items()}
            ring.append(G.v(p, .93, {'Jaw': 1 - sum(ck.values()), **ck}, 'jaw'))
        rings.append(ring)
    for zi, (a, b) in enumerate(zip(rings, rings[1:])):
        y0, y1 = zi / (len(zs) - 1), (zi + 1) / (len(zs) - 1)
        for k in range(JK):
            k1 = (k + 1) % JK; cy = math.cos(TAU * (k + .5) / JK); cx = math.sin(TAU * (k + .5) / JK)
            inside = (0, .125, (zs[zi] + zs[zi + 1]) / 2)
            if cy > .3:
                G.f((a[k], a[k1], b[k1], b[k]), ('tongue' if abs(cx) < .55 and 1 <= zi < 5 else 'mouth_dark' if zi < 1 else 'mouth'), inside=inside); continue
            x0 = k / JK; x1 = (k + 1) / JK
            G.f((a[k], a[k1], b[k1], b[k]), None, inside=inside,
                uv=('jaw', [reg_uv('jaw', x0, y0), reg_uv('jaw', x1, y0), reg_uv('jaw', x1, y1), reg_uv('jaw', x0, y1)]))
    for ring, z, sgn in ((rings[0], zs[0], 1), (rings[-1], zs[-1], -1)):
        c = G.v((0, .13, z + sgn * .003), .93, {'Jaw': 1.0}, 'jaw')
        for k in range(JK): G.f((ring[(k + 1) % JK], ring[k], c), 'cream', out=(0, 0, sgn))
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
    tube(pts, [.0026] * 13, 4, 'line', lambda t: {'Head': 1.0}, 'deco', ao=0)
smile()
def cone(base_c, axis, r, ln, sides, weight, part, flat=.8):
    """A chunky cartoon tooth: a wide base, a convex flank and a blunt rounded tip (flattened front to back by flat)."""
    d, u, v = frame_from(axis, (0, 0, 1))
    def ring(f, sc):
        return [G.v(base_c + d * ln * f + (u * math.cos(TAU * k / sides) + v * math.sin(TAU * k / sides) * flat) * r * sc, .5, weight, part) for k in range(sides)]
    rings = [ring(0, 1.0), ring(.42, .74), ring(.8, .34)]
    tip = G.v(base_c + d * ln, .5, weight, part)
    for ra, rb in zip(rings, rings[1:]):
        for k in range(sides):
            k1 = (k + 1) % sides; G.f((ra[k], ra[k1], rb[k1], rb[k]), 'tooth', inside=base_c + d * ln * .3)
    for k in range(sides): G.f((rings[-1][k], rings[-1][(k + 1) % sides], tip), 'tooth', inside=base_c + d * ln * .5)
def teeth():
    """The sheet's grin: big cream cones along the upper lip, a shorter row on the jaw."""
    for a in np.linspace(-1.1, 1.1, 7):
        p = lip_point(a, inset=.0062) + Vector((0, .004, 0)); ln = .03 if abs(a) < .5 else .026 if abs(a) < .9 else .021
        cone(p, (0, -1, -.16), .0112 if abs(a) < .9 else .0095, ln, 5, {'Head': 1.0}, 'teeth')
    for a in np.linspace(-.84, .84, 5):
        p = lip_point(a, inset=.0088, upper=False) + Vector((0, -.004, 0)); ln = .02 if abs(a) < .5 else .017
        cone(p, (0, 1, -.12), .0092, ln, 5, {'Jaw': 1.0}, 'teeth')
teeth()

# eyes: big glossy amber eyes on the Eye bones (catch-lights ride them, so a squashed shut eye keeps them under the lid),
# lids on the Lid bones
LID_SIDES, LID_R = 14, 1.15
LID_POLE = 2.33   # radians from the gaze to the lid's pole: its edge rides about .76 rad above the gaze, over the top of the iris
EYE_LOOK = {'L': Vector((-.2, .08, -.97)).normalized(), 'R': Vector((.2, .08, -.97)).normalized()}
LATS = [0, .22, .42, .62, .82, 1.0, 1.45, 2.0]
EYE_AMAX = 2.0
def eye_uv(a, phi): return reg_uv('eye', .5 + .5 * (a / EYE_AMAX) * math.cos(phi), .5 + .5 * (a / EYE_AMAX) * math.sin(phi))
def squint_arc(sfx, c):
    """The closed-eye line of the sheet's squint: a dark arc laid on the lid where it faces front once shut (it rides on
    top of the open eye as a little brow line)."""
    F = EYE_LOOK[sfx]; side = Vector((1, 0, 0)); up = Vector((0, 1, 0)); rl = EYE_R * LID_R * 1.035
    to_open = Matrix.Rotation(LID_CLOSE, 3, 'X')
    pts = []
    for i in range(9):
        psi = -1 + 2 * i / 8
        d = (F + side * psi * .78 + up * (.16 - .36 * psi * psi)).normalized()
        pts.append(c + to_open @ (d * rl))
    tube(pts, [.0018, .0026, .003, .0031, .0031, .0031, .003, .0026, .0018], 4, 'line', lambda t: {f'Lid{sfx}': 1.0}, 'lid', ao=0, up=(0, 1, 0))
for sfx, c in EYE_C.items():
    sx = -1 if sfx == 'L' else 1
    ball(c, EYE_R, EYE_LOOK[sfx], LATS, 12, lambda b: None, {f'Eye{sfx}': 1.0}, 'eye', ao=.35, uvf=eye_uv, region='eye',
         bake=sfx == 'L', glow=.18)
    hl = (EYE_LOOK[sfx] + Vector((0, .7, 0)) + Vector((sx * -.3, 0, 0))).normalized()
    ball(c + hl * EYE_R * .9, .0068, hl, [0, 1.2, 2.2], 6, lambda b: 'highlight', {f'Eye{sfx}': 1.0}, 'deco', ao=0, glow=.9)
    hl2 = (EYE_LOOK[sfx] + Vector((sx * .2, -.45, 0))).normalized()
    ball(c + hl2 * EYE_R * .97, .0032, hl2, [0, 1.4], 5, lambda b: 'highlight', {f'Eye{sfx}': 1.0}, 'deco', ao=0, glow=.9)
    # a fixed skin socket over the back of the eyeball (so a blink never shows the back of the eye) ...
    gaze = EYE_LOOK[sfx]; upg = (Vector((0, 1, 0)) - gaze * gaze.y).normalized()
    ball(c, EYE_R * 1.1, (-gaze * .55 + upg * .45).normalized(), [0, .6, 1.15, 1.45], 12, lambda b: 'skin_mid', {'Head': 1.0}, 'head', ao=1.0)
    # ... and the upper lid: a hemisphere whose edge runs through the eye's sides and over the top of the iris, with a
    # dark lash line along that edge. Rest pose = open; turning LID_CLOSE about X sweeps it down over the eye.
    pole = (gaze * math.cos(LID_POLE) + upg * math.sin(LID_POLE)).normalized()
    lat = [0, .55, 1.05, 1.4, math.pi / 2 + .04]
    rings = ball(c, EYE_R * LID_R, pole, lat, LID_SIDES, lambda b: None, {f'Lid{sfx}': 1.0}, 'lid',
                 ramp=lambda p: .22 + .2 * smoothstep(.17, .2, p.y), ao=1.0, region='lid', bake=sfx == 'L',
                 uvf=lambda a, phi: reg_uv('lid', phi / TAU, a / (math.pi / 2 + .04)))
    last = rings[-1]; inner = [G.v(c + (G.P[vi] - c) * .955 - pole * EYE_R * .05, .1, {f'Lid{sfx}': 1.0}, 'lid') for vi in last]
    for k in range(LID_SIDES):
        k1 = (k + 1) % LID_SIDES; mid_k = ((G.P[last[k]] + G.P[last[k1]]) / 2 - c).normalized()
        G.f((last[k], last[k1], inner[k1], inner[k]), 'lash' if mid_k.dot(gaze) > -.35 else 'skin_mid', out=-pole)
    squint_arc(sfx, c)
    # nostril
    ym, w, top, bot = head_section(-.272)
    disc((sx * .015, ym + top * .955 + .0008, -.272), (sx * .3, .62, -.72), .0036, 6, 'nostril', {'Head': 1.0}, 'deco', stretch=1.4)
    # a faint rosy cheek (rides the cheek bone, so it swells with the puff)
    bc = Vector((sx * .073, .147, -.188)); disc(bc, (sx * .9, .1, -.4), .01, 8, 'blush', {f'Cheek{sfx}': 1.0}, 'deco', stretch=1.3, lift=.0018)

# ------------------------------------------------------------------ limbs: chunky arms and legs in black boots
def limb(sfx, kind):
    sh, el, wr, ft = (Vector(side_pt(p, sfx)) for p in LIMBS[kind])
    U, L = f'{kind}U{sfx}', f'{kind}L{sfx}'; H = ('Hand' if kind == 'Arm' else 'Foot') + sfx
    root = 'Spine' if kind == 'Arm' else 'Hips'
    inner = Vector((sh.x * .45, sh.y + .004, sh.z))
    upper = bezier(inner, sh + (el - sh) * .3 + Vector((0, .006, 0)), el + (sh - el) * .25, el, 4)
    lower = bezier(el, el + (wr - el) * .35 + Vector((sh.x * .06, 0, 0)), wr + (el - wr) * .4, wr + (el - wr) * .25, 3)
    path = upper + lower[1:]
    r0 = .045 if kind == 'Leg' else .039
    radii = [r0, r0 * .93, r0 * .82, r0 * .76, r0 * .73, r0 * .72]
    def wt(t):
        if t < .25: k = smoothstep(.0, .25, t); return {root: 1 - k, U: k}
        if t < .5: return {U: 1.0}
        if t < .65: k = smoothstep(.5, .65, t); return {U: 1 - k, L: k}
        return {L: 1.0}
    tube(path, radii, 8, None, wt, 'limb', cap0=False, cap1=False, ramp_fn=lambda t, a: .33 + .12 * t,
         region='arm' if kind == 'Arm' else 'leg', bake=sfx == 'L')
    # the boot: a glossy black shaft from mid-shin with a rolled cuff, a rounded foot, three fat rounded claws
    top = wr + (el - wr) * .3; br = r0 * .8
    tube([top + (el - wr).normalized() * .004, top, wr + Vector((0, -.006, 0)), Vector((wr.x, .02, (wr.z + ft.z) / 2))],
         [br * 1.16, br * 1.12, br * 1.06, br * 1.1], 8, 'boot',
         lambda t: {L: 1 - smoothstep(.3, .85, t), H: smoothstep(.3, .85, t)}, 'boot', cap0=True, cap1=False, cap_slot='sole')
    fc = Vector((ft.x, .017, ft.z - .004))
    ball(fc, 1.0, (0, 1, 0), [0, 1.0, 1.9, math.pi], 8, lambda b: 'sole' if b >= 2 else 'boot', {H: 1.0}, 'boot', scale=(.037, .022, .043))
    for k, dx in enumerate((-.017, 0, .017)):
        cc = fc + Vector((dx * (1 if sfx == 'L' else -1), -.006, -.04 + .004 * abs(dx) / .017))
        ball(cc, 1.0, (0, .35, -1), [0, 1.2, math.pi], 8, lambda b: 'claw', {H: 1.0}, 'boot', scale=(.0125, .0115, .0155))
for sfx in ('L', 'R'):
    limb(sfx, 'Arm'); limb(sfx, 'Leg')

# ------------------------------------------------------------------ rounded orange spikes down the back and tail
def spike(s, h, base_len, col, lean=.42):
    c, t, N = section_frame(s); w = body_weights(s)
    top = bkey(s, 2); base = c + N * (top - .007); fwd = -t
    side = Vector((1, 0, 0)); tip = base + N * h - fwd * (h * lean)
    sides = 6; xs = lambda k: (col % 10 + .1 + .8 * k / sides) / 10
    ring = lambda k, sc: (fwd * math.cos(TAU * k / sides) * base_len * .52 + side * math.sin(TAU * k / sides) * base_len * .34) * sc
    levels = [(0.0, 1.0), (.4, .74), (.75, .4)]
    rings = [[G.v(base.lerp(tip, f) + ring(k, sc), .5, w, 'spike') for k in range(sides)] for f, sc in levels]
    ti = G.v(tip, .5, w, 'spike')
    for li, (ra, rb) in enumerate(zip(rings, rings[1:])):
        for k in range(sides):
            k1 = (k + 1) % sides; y0, y1 = levels[li][0], levels[li + 1][0]
            G.f((ra[k], ra[k1], rb[k1], rb[k]), None, inside=base + N * h * .25, uv=('spike', [reg_uv('spike', xs(k), y0), reg_uv('spike', xs(k + 1), y0), reg_uv('spike', xs(k + 1), y1), reg_uv('spike', xs(k), y1)]))
    for k in range(sides):
        G.f((rings[-1][k], rings[-1][(k + 1) % sides], ti), None, inside=base + N * h * .4, uv=('spike', [reg_uv('spike', xs(k), .75), reg_uv('spike', xs(k + 1), .75), reg_uv('spike', xs(k + .5), 1.0)]))
SPIKES = [(s_of_z(z), h, l) for z, h, l in ((.04, .031, .033), (.085, .035, .037), (.13, .034, .035),
          (.175, .031, .031), (.22, .028, .028), (.262, .025, .025))] + \
         [(S_CURL + (BODY_LEN - S_CURL) * f, h, l) for f, h, l in ((.08, .026, .026), (.27, .024, .024), (.46, .021, .021), (.64, .018, .018), (.8, .015, .015))]
for i, (s, h, l) in enumerate(SPIKES): spike(s, h * 1.3, l * 1.3, i)

# ------------------------------------------------------------------ gear: hard hat, harness with badge, socket and cable
HAT_TILT, HAT_R = .1, .11
HAT_ROT = Matrix.Rotation(HAT_TILT, 3, 'X')
def hat_uv(p):
    q = HAT_ROT.inverted() @ (Vector(p) - Vector(HAT_BASE)); return reg_uv('hat', .5 + q.x / (2 * HAT_R), .5 - q.z / (2 * HAT_R))
def hat_face(idx, inside=None, out=None):
    G.f(idx, None, inside=inside, out=out, uv=('hat', [hat_uv(G.P[i]) for i in idx]))
def hard_hat():
    w = {'HatHard': 1.0}; c = Vector(HAT_BASE); rot = HAT_ROT
    rx, ry, rz = .078, .064, .084
    lats = [0, .4, .8, 1.15, 1.42, 1.571]; sides = 16
    top = G.v(c + rot @ Vector((0, ry, 0)), .5, w, 'gear'); rings = []
    for a in lats[1:]:
        rings.append([G.v(c + rot @ Vector((math.sin(a) * math.cos(TAU * k / sides) * rx, math.cos(a) * ry, math.sin(a) * math.sin(TAU * k / sides) * rz)), .5, w, 'gear') for k in range(sides)])
    for k in range(sides): hat_face((top, rings[0][(k + 1) % sides], rings[0][k]), inside=c)
    for ra, rb in zip(rings, rings[1:]):
        for k in range(sides):
            k1 = (k + 1) % sides; hat_face((ra[k], ra[k1], rb[k1], rb[k]), inside=c)
    # brim: a flat ring with a rolled lip, stretched into a peak at the front
    rin, rout, rlo, rbot = [], [], [], []
    for k in range(sides):
        phi = TAU * k / sides; dx, dz = math.cos(phi), math.sin(phi); peak = .012 * max(0, -dz) ** 2
        rin.append(rings[-1][k])
        rout.append(G.v(c + rot @ Vector((dx * (rx + .012 + peak * .3), -.003, dz * (rz + .012 + peak))), .5, w, 'gear'))
        rlo.append(G.v(c + rot @ Vector((dx * (rx + .011 + peak * .3), -.008, dz * (rz + .011 + peak))), .5, w, 'gear'))
        rbot.append(G.v(c + rot @ Vector((dx * rx * .97, -.006, dz * rz * .97)), .5, w, 'gear'))
    up = rot @ Vector((0, 1, 0))
    for k in range(sides):
        k1 = (k + 1) % sides
        hat_face((rin[k], rin[k1], rout[k1], rout[k]), out=up)
        hat_face((rout[k], rout[k1], rlo[k1], rlo[k]), inside=c)
        G.f((rlo[k], rlo[k1], rbot[k1], rbot[k]), 'hat_dark', out=-up)
    # the centre ridge, the hard hat signature
    ridge = [c + rot @ Vector((0, math.cos(a) * (ry + .002), math.sin(a) * (rz + .002))) for a in np.linspace(-1.25, 1.3, 8)]
    tube(ridge, [.0072] * 8, 5, 'hat', lambda t: w, 'gear', squash=.55, up=(1, 0, 0))
    # a blue lightning bolt on the front
    bc = c + rot @ Vector((.012, ry * .55, -rz * .84)); n = (rot @ Vector((0, .55, -1))).normalized(); d, u, v = frame_from(n, (0, 1, 0))
    bolt = [(.002, .015), (.011, .015), (.003, .003), (.01, .003), (-.008, -.017), (-.002, -.003), (-.009, -.003)]
    idx = [G.v(bc + u * x + v * y + d * .0022, .5, w, 'gear', ao=0) for x, y in bolt]
    G.f(idx, 'bolt', out=n)
hard_hat()

def band_ring(s, width, off, slot, th0=0.0, th1=TAU, n=16, weight=None):
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
def rim(c, d, u, v, r_in, r_out, n, w, phase=0.0, sq=False):
    """A raised metal ring flat on a surface: outer edge on it, a crest between, inner edge just above it."""
    k_sq = 1 / math.cos(math.pi / 4) if sq else 1.0
    pt = lambda r, k, h: c + d * h + (u * math.cos(phase + TAU * k / n) + v * math.sin(phase + TAU * k / n)) * r * k_sq
    rm = (r_in + r_out) / 2
    rings = [[G.v(pt(r, k, h), .5, w, 'gear') for k in range(n)] for r, h in ((r_out, .0004), (rm, .0024), (r_in, .0014))]
    for ra, rb in zip(rings, rings[1:]):
        for k in range(n):
            k1 = (k + 1) % n; G.f((ra[k], ra[k1], rb[k1], rb[k]), 'buckle', out=d)
def harness():
    s_col, s_girth = s_of_z(-.098), s_of_z(.012)
    band_ring(s_col, .017, .006, 'strap')                         # collar
    band_ring(s_girth, .015, .006, 'strap')                       # girth strap behind the front legs
    # dorsal strap: collar -> socket -> girth along the top
    sa, sb = s_col, s_girth; n = 6
    left = [G.v(body_point(sa + (sb - sa) * i / n, -.12, .007), .5, body_weights(sa + (sb - sa) * i / n), 'gear') for i in range(n + 1)]
    right = [G.v(body_point(sa + (sb - sa) * i / n, .12, .007), .5, body_weights(sa + (sb - sa) * i / n), 'gear') for i in range(n + 1)]
    for i in range(n): G.f((left[i], left[i + 1], right[i + 1], right[i]), 'strap', inside=cl_at(sa + (sb - sa) * (i + .5) / n)[0])
    # yellow leather chest plate: wraps the lower chest from side to side between collar and girth (the front legs
    # come through it), stitched round the edge, with a round medic badge on each flank
    nu, nv = 4, 12; ths = [1.3 + (TAU - 2.6) * j / nv for j in range(nv + 1)]
    sl = lambda i: lerp(s_col + .008, s_girth - .006, i / nu)
    bulge = lambda i, j: .009 + .003 * math.sin(math.pi * i / nu)
    grid = [[G.v(body_point(sl(i), th, bulge(i, j)), .5, body_weights(sl(i)), 'gear') for j, th in enumerate(ths)] for i in range(nu + 1)]
    for i in range(nu):
        for j in range(nv):
            G.f((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]), None, inside=cl_at(sl(i + .5))[0],
                uv=('plate', [reg_uv('plate', j / nv, i / nu), reg_uv('plate', j / nv, (i + 1) / nu), reg_uv('plate', (j + 1) / nv, (i + 1) / nu), reg_uv('plate', (j + 1) / nv, i / nu)]))
    for j in (0, nv):   # brown edging where the plate meets the skin
        for i in range(nu):
            ia = G.v(body_point(sl(i), ths[j] + (-.08 if j == 0 else .08), .002), .5, body_weights(sl(i)), 'gear')
            ib = G.v(body_point(sl(i + 1), ths[j] + (-.08 if j == 0 else .08), .002), .5, body_weights(sl(i + 1)), 'gear')
            G.f((grid[i][j], grid[i + 1][j], ib, ia), 'strap', inside=cl_at(sl(i + .5))[0])
    sm = lerp(s_col, s_girth, .5); wts = body_weights(sm); c0, _t = cl_at(sm)
    for th in (1.95, TAU - 1.95):
        bp = body_point(sm, th, .0135); bn = (bp - c0).normalized(); bn = (bn + Vector((0, 0, -.25))).normalized()
        d, u, v = disc(bp, bn, .017, 12, 'badge', wts, 'gear', lift=.0005, glow=.12)
        # a raised steel rim round the badge (a bevelled annulus: cheap and it still catches the light)
        rim(bp, d, u, v, .0162, .0205, 12, wts)
        for (a0, a1), (b0, b1) in (((-.011, .011), (-.0037, .0037)), ((-.0037, .0037), (-.011, .011))):
            q = [bp + d * .0012 + u * x + v * y for x, y in ((a0, b0), (a1, b0), (a1, b1), (a0, b1))]
            G.f([G.v(p_, .5, wts, 'gear', ao=0, glow=.12) for p_ in q], 'cross', out=bn)
    # steel buckles on the collar and girth: a bevelled square frame with a bar across
    for s_, th in ((s_col, 1.15), (s_col, -1.15), (s_girth, 1.05), (s_girth, -1.05)):
        p = body_point(s_, th, .0075); c0, _t = cl_at(s_); n_ = (p - c0).normalized(); d, u, v = frame_from(n_, (0, 0, 1))
        rim(p, d, u, v, .0058, .0095, 4, body_weights(s_), phase=math.pi / 4, sq=True)
        bar = [G.v(p + d * .0016 + u * x + v * y, .5, body_weights(s_), 'gear') for x, y in ((-.0065, -.0011), (.0065, -.0011), (.0065, .0011), (-.0065, .0011))]
        G.f(bar, 'buckle', out=d)
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
        front = [G.v(c + Vector((x * sc, y * sc, -.003)), .5, w, 'gear', ao=0, glow=.7) for x, y in glyph]
        back = [G.v(c + Vector((x * sc, y * sc, .003)), .5, w, 'gear', ao=0, glow=.7) for x, y in glyph]
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
        if G.FU[i]: G.FU[i] = (G.FU[i][0], G.FU[i][1][::-1])

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

# ------------------------------------------------------------------ texture bake: rasterise the painted faces, paint per texel
def _hash(ix, iy, iz, seed):
    h = (ix * 374761393 + iy * 668265263 + iz * 1274126177 + seed * 1442695041) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 1103515245) & 0xFFFFFFFF
    h = (h ^ (h >> 16)) & 0xFFFFFFFF
    return (h & 0xFFFFFF) / 16777216.0
def vnoise(P, seed):
    """Smooth value noise in 0..1 at points P (n, 3)."""
    Pf = np.floor(P); f = P - Pf; i = Pf.astype(np.int64); u = f * f * (3 - 2 * f); out = np.zeros(len(P))
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out += w * _hash(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz, seed)
    return out
def fbm(P, seed, octaves=3):
    tot, amp, out = 0.0, 1.0, np.zeros(len(P))
    for o in range(octaves):
        out += vnoise(P * (2 ** o), seed + o * 17) * amp; tot += amp; amp *= .5
    return out / tot
def worley(P, seed):
    """Distance to the nearest jittered feature point (cell units) and that cell's random value."""
    i = np.floor(P).astype(np.int64); best = np.full(len(P), 9.0); cid = np.zeros(len(P))
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                cx, cy, cz = i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz
                fp = np.stack([cx + .15 + .7 * _hash(cx, cy, cz, seed), cy + .15 + .7 * _hash(cx, cy, cz, seed + 1), cz + .15 + .7 * _hash(cx, cy, cz, seed + 2)], 1)
                d = np.linalg.norm(P - fp, axis=1); upd = d < best
                best = np.where(upd, d, best); cid = np.where(upd, _hash(cx, cy, cz, seed + 3), cid)
    return best, cid
def sstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)
def hexes(hs): return np.array([srgb(h) for h in hs])
def ramp_colour(R):
    pos = [p for p, _ in RAMP]; cols = hexes([h for _, h in RAMP])
    return np.stack([np.interp(R, pos, cols[:, k]) for k in range(3)], 1)
def mixc(a, b, t): return a + (b - a) * np.asarray(t)[:, None]

def bake():
    H = W = TEX
    attr = np.zeros((H, W, 7), np.float32); fill = np.zeros((H, W), bool)
    vnn = [v.normalized() if v.length > 1e-12 else Vector((0, 1, 0)) for v in vn]
    for f, uv, bk in zip(G.F, G.FU, G.FB):
        if uv is None or not bk: continue
        pts = uv[1]; A = [np.array([*G.P[i], *vnn[i], G.R[i]], np.float32) for i in f]
        for k in range(1, len(f) - 1):
            (x0, y0), (x1, y1), (x2, y2) = pts[0], pts[k], pts[k + 1]
            d = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
            if abs(d) < 1e-9: continue
            xs = np.arange(int(math.floor(min(x0, x1, x2))), int(math.ceil(max(x0, x1, x2))) + 1) + .5
            ys = np.arange(int(math.floor(min(y0, y1, y2))), int(math.ceil(max(y0, y1, y2))) + 1) + .5
            X, Y = np.meshgrid(xs, ys)
            l0 = ((y1 - y2) * (X - x2) + (x2 - x1) * (Y - y2)) / d; l1 = ((y2 - y0) * (X - x2) + (x0 - x2) * (Y - y2)) / d; l2 = 1 - l0 - l1
            m = (l0 > -.03) & (l1 > -.03) & (l2 > -.03)
            cols, rows = X[m].astype(int), Y[m].astype(int); ok = (cols >= 0) & (cols < W) & (rows >= 0) & (rows < H)
            vals = l0[m][:, None] * A[0] + l1[m][:, None] * A[k] + l2[m][:, None] * A[k + 1]
            attr[rows[ok], cols[ok]] = vals[ok]; fill[rows[ok], cols[ok]] = True
    # grow every region a few texels into its padding so filtering and mips never pick up black
    def shift(a, dy, dx):
        out = np.zeros_like(a); h, w = a.shape[:2]
        out[max(dy, 0):h + min(dy, 0), max(dx, 0):w + min(dx, 0)] = a[max(-dy, 0):h + min(-dy, 0), max(-dx, 0):w + min(-dx, 0)]
        return out
    for name, (x0, y0, w, h) in REGIONS.items():
        sa, sf = attr[y0:y0 + h, x0:x0 + w], fill[y0:y0 + h, x0:x0 + w]
        for _ in range(PAD + 4):
            acc = np.zeros_like(sa); cnt = np.zeros(sf.shape, np.float32)
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx or dy: acc += shift(sa * sf[..., None], dy, dx); cnt += shift(sf.astype(np.float32), dy, dx)
            grow = (~sf) & (cnt > 0)
            sa[grow] = acc[grow] / cnt[grow][:, None]; sf |= grow
    base = np.zeros((H, W, 3)); hgt = np.zeros((H, W)); rough = np.full((H, W), .5); metal = np.zeros((H, W)); vein = np.zeros((H, W))
    nstr = np.zeros((H, W))
    for name in SLOT_NAMES:
        col, r, m_ = SLOTS[name]; cx, cy = slot_px(name); x0, y0 = int(cx - CELL / 2), int(cy - CELL / 2)
        base[y0:y0 + CELL, x0:x0 + CELL] = srgb(col); rough[y0:y0 + CELL, x0:x0 + CELL] = r; metal[y0:y0 + CELL, x0:x0 + CELL] = m_
    for name, (x0, y0, w, h) in REGIONS.items():
        sub = np.zeros((H, W), bool); sub[y0:y0 + h, x0:x0 + w] = True; m = sub & fill
        rows, cols = np.nonzero(m)
        if not len(rows): continue
        a_ = (cols + .5 - x0 - PAD) / (w - 2 * PAD); b_ = (rows + .5 - y0 - PAD) / (h - 2 * PAD)
        P = attr[rows, cols, 0:3].astype(np.float64); R = attr[rows, cols, 6].astype(np.float64)
        if name in SKIN_REGIONS:
            col, hh, rr, vv = paint_skin(name, P, R, a_, b_)
            nstr[rows, cols] = .75
        elif name == 'eye': col, hh, rr, vv = paint_eye(a_, b_); nstr[rows, cols] = 0
        elif name == 'hat': col, hh, rr, vv = paint_hat(P, a_, b_); nstr[rows, cols] = 1.2
        elif name == 'plate': col, hh, rr, vv = paint_plate(P, a_, b_, w, h); nstr[rows, cols] = 1.4
        elif name == 'spike': col, hh, rr, vv = paint_spike(P, a_, b_); nstr[rows, cols] = .6
        base[rows, cols] = col; hgt[rows, cols] = hh; rough[rows, cols] = rr; vein[rows, cols] = vv
        metal[rows, cols] = 0
    gy, gx = np.gradient(hgt)            # per texel, y up the image (Blender v): the glTF normal-map convention
    nrm = np.stack([-gx * nstr, -gy * nstr, np.ones_like(hgt)], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    return np.clip(base, 0, 1), nrm, np.clip(rough, .04, 1), metal, np.clip(vein, 0, 1)

def paint_skin(name, P, R, a_, b_):
    n = len(P); belly = sstep(.7, .88, R); dorsal = sstep(.66, .48, R)
    col = ramp_colour(R)
    # mottling: broad value swells, a green-blue drift, finer grain
    m1 = vnoise(P * 22, 1); m2 = vnoise(P * 70, 2); drift = vnoise(P * 8, 3)
    col *= (.9 + .17 * m1 + .06 * (m2 - .5))[:, None] * (1 - .35 * belly)[:, None] + (.35 * belly)[:, None]
    col = mixc(col, col * np.array([.82, 1.06, .9]), .55 * drift * dorsal)
    col = mixc(col, col * np.array([1.0, .96, 1.08]), .4 * (1 - drift) * dorsal)
    # spots: clustered dark teal blotches and speckles over the back, flanks, tail and legs (fewer on the face)
    spot_w = dorsal * (.55 if name in ('head', 'lid', 'jaw') else 1.0)
    F1, cid = worley(P * 46, 4); rad = .24 + .17 * cid; clus = sstep(.35, .6, vnoise(P * 9, 5))
    spot = sstep(rad, rad - .09, F1) * (cid > .22) * spot_w * (.55 + .45 * clus)
    F2, cid2 = worley(P * 115, 6); speck = sstep(.24, .13, F2) * (cid2 > .5) * spot_w * .75
    sp = np.maximum(spot, speck)
    spot_col = mixc(ramp_colour(np.zeros(n)), ramp_colour(np.full(n, .1)), vnoise(P * 30, 7))
    col = mixc(col, spot_col, .85 * sp)
    # cream belly and throat: transverse scale rows
    if name == 'body': along = a_ * BODY_LEN; pitch = .0125
    else: along = P[:, 2]; pitch = .0105
    q = np.mod(along / pitch, 1.0); groove = 1 - sstep(.0, .14, q) * sstep(1.0, .86, q)
    bands = groove * belly * (1.0 if name in ('body', 'head') else 0.0)
    col *= (1 - .13 * bands)[:, None]
    # pebbly skin: small domed scales everywhere, finer on the belly
    Fp, cp = worley(P * np.where(belly[:, None] > .5, 330, 240), 8); peb = sstep(.66, .08, Fp)
    col *= (.95 + .08 * peb)[:, None]
    h = .55 * peb + .25 * sp - .9 * bands + .25 * (m2 - .5)
    rough = .4 + .15 * belly + .07 * (vnoise(P * 34, 9) - .5) - .05 * sp + .04 * (1 - peb)
    # veins: domain-warped noise isolines, in patches, a little sparser on the belly
    warp = np.stack([vnoise(P * 9, 11), vnoise(P * 9, 12), vnoise(P * 9, 13)], 1) - .5
    nv = fbm(P * 13 + warp * 1.4, 14, 3)
    line = sstep(.032, .008, np.abs(nv - .5))
    patch = sstep(.42, .6, vnoise(P * 4.5, 15))
    vein = line * patch * (1 - .5 * belly)
    if name == 'lid': vein *= 0
    return col, h, rough, vein

def paint_eye(a_, b_):
    dx, dy = a_ - .5, b_ - .5; a = np.hypot(dx, dy) * 2 * EYE_AMAX; phi = np.arctan2(dy, dx); n = len(a)
    t = np.clip((a - .5) / .42, 0, 1)
    iris = np.stack([np.interp(t, [0, .3, .75, 1], hexes(['ffd463', 'f59c27', 'c9661a', '6e310c'])[:, k]) for k in range(3)], 1)
    streak = 1 + .1 * np.sin(phi * 31 + 4 * vnoise(np.stack([np.cos(phi) * 3, np.sin(phi) * 3, a * 4], 1), 21)) * (t > 0)
    iris *= streak[:, None]
    white = mixc(np.tile(srgb('fbf7ee'), (n, 1)), np.tile(srgb('e6ddd2'), (n, 1)), sstep(1.2, 1.9, a))
    col = mixc(iris, np.tile(srgb('110b09'), (n, 1)), sstep(.54, .47, a))
    col = mixc(col, white, sstep(.9, .98, a))
    return col, np.zeros(n), np.full(n, .07), np.zeros(n)

def paint_hat(P, a_, b_):
    n = len(P); q = np.stack([a_, b_], 1)
    lift = P[:, 1] - HAT_BASE[1]
    col = mixc(np.tile(srgb('f0b416'), (n, 1)), np.tile(srgb('ffd24a'), (n, 1)), sstep(.0, .06, lift))
    # scuffs and scratches: thin anisotropic streaks, dark grime and pale chips
    s1 = vnoise(P * np.array([420, 60, 420]), 31); s2 = vnoise(P * np.array([60, 420, 520]), 32)
    scratch = np.maximum(sstep(.84, .9, s1), sstep(.86, .92, s2)) * sstep(.45, .7, vnoise(P * 14, 33))
    grime = sstep(.6, .85, vnoise(P * 30, 34)) * .22
    col = mixc(col, col * np.array([.78, .66, .5]), grime)
    col = mixc(col, np.tile(srgb('fff1c4'), (n, 1)), .3 * scratch)
    Fd, cd = worley(P * 38, 35); dent = sstep(.32, .0, Fd) * (cd > .78)
    h = -.45 * dent - .2 * scratch + .1 * (vnoise(P * 200, 36) - .5)
    rough = .36 + .25 * scratch + .15 * grime
    return col, h, rough, np.zeros(n)

def paint_plate(P, a_, b_, w, h_px):
    n = len(P); ex = np.minimum(a_, 1 - a_) * (w - 2 * PAD); ey = np.minimum(b_, 1 - b_) * (h_px - 2 * PAD); e = np.minimum(ex, ey)
    col = np.tile(srgb('f2b92a'), (n, 1))
    col = mixc(col * np.array([.8, .62, .4]), col, sstep(0, 9, e))           # worn, darker edges
    grain = vnoise(P * 520, 41); col *= (.94 + .1 * grain)[:, None]
    along = np.where(ex < ey, b_ * (h_px - 2 * PAD), a_ * (w - 2 * PAD))
    stitch = sstep(1.3, .5, np.abs(e - 5.0)) * (np.mod(along / 6.0, 1.0) < .55)
    col = mixc(col, np.tile(srgb('6a3d1a'), (n, 1)), .85 * stitch)
    hh = .35 * grain - .9 * stitch - .5 * sstep(4, 0, e)
    rough = .52 + .12 * grain + .1 * stitch
    return col, hh, rough, np.zeros(n)

def paint_spike(P, a_, b_):
    n = len(P); t = np.clip(b_, 0, 1)
    col = np.stack([np.interp(t, [0, .45, 1], hexes(['d65a16', 'f2852a', 'ffc779'])[:, k]) for k in range(3)], 1)
    col *= (.93 + .1 * vnoise(np.stack([a_ * 40, b_ * 6, a_ * 3], 1), 51))[:, None]
    return col, np.zeros(n), .42 - .1 * t, np.zeros(n)

def encode(rgb01, quality, subsampling):
    """JPEG via the system Pillow (bpy's Python has none). rgb01 is bottom-up (Blender rows)."""
    arr = np.ascontiguousarray(np.flipud(np.clip(np.round(rgb01 * 255), 0, 255).astype(np.uint8)))
    code = ('import sys, io; from PIL import Image; h, w, q, s = map(int, sys.argv[1:5]); d = sys.stdin.buffer.read(); '
            'b = io.BytesIO(); Image.frombytes("RGB", (w, h), d).save(b, "JPEG", quality=q, subsampling=s, optimize=True); sys.stdout.buffer.write(b.getvalue())')
    res = subprocess.run(['python3', '-I', '-c', code, str(arr.shape[0]), str(arr.shape[1]), str(quality), str(subsampling)], input=arr.tobytes(), capture_output=True, check=True)
    return res.stdout

TB = time.time()
BASE, NRM, ROUGH, METAL, VEIN = bake()
JPEGS = {'base': encode(BASE, 90, 2), 'normal': encode(NRM * .5 + .5, 92, 0), 'mr': encode(np.stack([VEIN, ROUGH, METAL], -1), 92, 0)}
BAKE_SECONDS = round(time.time() - TB, 1)

# ------------------------------------------------------------------ Blender objects
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene; SC.render.fps = FPS; SC.frame_start = 0
img = bpy.data.images.new('LizardBase', TEX, TEX, alpha=False)
img.pixels.foreach_set(np.concatenate([BASE, np.ones((TEX, TEX, 1))], -1).astype(np.float32).ravel())
img.pack(); img.file_format = 'PNG'
mat = bpy.data.materials.new('LizardSkin'); mat.use_nodes = True; nt = mat.node_tree; bsdf = nt.nodes['Principled BSDF']
bsdf.inputs['Roughness'].default_value = .5; bsdf.inputs['Metallic'].default_value = 0.0
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = img; tex.interpolation = 'Linear'
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])   # the repack swaps in the JPEG set (base, normal, MR)
mat.use_backface_culling = True

bm = bmesh.new()
bv = [bm.verts.new(to_b(p)) for p in G.P]
bm.verts.index_update(); bm.verts.ensure_lookup_table()
uvl = bm.loops.layers.uv.new('UVMap')
skipped = 0
for f, slot, uv in zip(G.F, G.FS, G.FU):
    try: face = bm.faces.new([bv[i] for i in f])
    except ValueError: skipped += 1; continue
    face.smooth = True
    for li, loop in enumerate(face.loops):
        x, y = uv[1][li] if uv else slot_px(slot)
        loop[uvl].uv = (x / TEX, y / TEX)
me = bpy.data.meshes.new('Lizard'); bm.to_mesh(me); bm.free()
me.materials.append(mat)
ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
ca.data.foreach_set('color', np.array([(AO[i], G.glow[i], 1.0 if G.part[i] in SKIN_PARTS else 0.0, 1.0) for i in range(len(G.P))], np.float32).ravel())
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
    jaw_open(spec, (.3 * grin + .03 * br, 0, 0)); cheeks(spec, .08 * grin)
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
    cheeks(spec, .62 * charge + .06 * up)
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
    jaw_open(spec, (.04 + .14 * snore, 0, 0)); cheeks(spec, .2 * snore)
    lids(spec, 1.0)
    add(spec, 'HatHard', r=(-.3, 0, .06))
    for side in 'LR':
        limb_pose(spec, side, 'Arm', .5, 0, 1.15)
        limb_pose(spec, side, 'Leg', -.6, 0, 1.15)
    tail_sway(spec, t, NAP_T, .04, -.16)
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
    lids(spec, .9 * shake); cheeks(spec, .42 * shake)
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
    # the texture set: Blender's PNG base colour is replaced by the three JPEGs, mip-mapped and clamped
    doc['images'] = [{'name': f'Lizard_{n}', 'mimeType': 'image/jpeg', 'bufferView': push(JPEGS[n])} for n in ('base', 'normal', 'mr')]
    doc['textures'] = [{'sampler': 0, 'source': i} for i in range(3)]
    doc['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
    m0 = doc['materials'][0]; pbr = m0.setdefault('pbrMetallicRoughness', {})
    pbr.pop('baseColorFactor', None); pbr['baseColorTexture'] = {'index': 0}; pbr['metallicRoughnessTexture'] = {'index': 2}
    pbr['metallicFactor'] = 1.0; pbr['roughnessFactor'] = 1.0; m0['normalTexture'] = {'index': 1}
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
          'bones': len(order), 'skipped_faces': skipped, 'texture': [TEX, TEX], 'jpeg_bytes': {k: len(v) for k, v in JPEGS.items()},
          'bake_seconds': BAKE_SECONDS}
assert tri_count < 5500, REPORT
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
if '--dump-textures' in ARGS:
    for k, v in JPEGS.items(): open(os.path.join(HERE, 'out', f'lizard_{k}.jpg'), 'wb').write(v)
print(json.dumps(REPORT))
assert set(REPORT['animations']) == set(CLIPS), REPORT['animations']
print('LIZARD_BUILD_OK')
