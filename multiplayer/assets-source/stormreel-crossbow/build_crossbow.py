"""Stormreel crossbow + bolt, production pass (2026-10-07) - reproducible Blender (bpy 5.0) builder.

Run (from this folder):
    python3.11 build_crossbow.py -- --out ../../public/assets/stormreel.glb          # build, bake, export
    python3.11 build_crossbow.py -- --out /tmp/x.glb --render out/review           # plus turnaround renders
    python3.11 build_crossbow.py -- --out /tmp/x.glb --tex 512 --samples 16        # quick draft bake
(pip install bpy numpy pillow)

Identity: a lightning crossbow fed by a coiled cord from a cable-reel backpack. Twin glass capacitor tubes ride the
top shoulders where the shooter sees them fill; a Jacob's-ladder pair of copper arc horns rises between their front
caps; the bolt is drawn through a copper accelerator coil that collars the nose; ribbed black rubber on every handhold;
a skeletal truss stock with the cord socket under the butt. The bolt is a taser probe: a faceted copper dart, a porcelain
insulator collar, bold pole-coloured vanes and a brass filament spool at the tail.

Shape language (Mitch: sleek, powerful, sturdy, crisp facets, nothing soft or boat-like): every mass is a chamfered
octagon or a lozenge blade; one big wedge receiver that is deepest over the hand and tapers both ways; the prod is a
thick swept recurve blade clamped in steel yokes; small accents (rivets, horn knobs, hazard bands) only where the eye goes.

Surface: one atlas material for everything opaque (body, prod limbs, strings and the bolt), baked here in Cycles:
  * base colour, 1024 x 2048: the red (+) finish in the top half, the blue/black (-) finish in the bottom half. The
    glTF carries a KHR_texture_transform that shows the top half; client/stormreel-look.js finishCrossbow() points a
    cloned map at the bottom half for the blue pole. Crimson candy enamel with bone accents, or blackened enamel with
    electric-blue accents; brass, copper, steel, porcelain and rubber are shared.
  * ORM (occlusion, roughness, metalness) and a tangent normal map (rolled bevels on every hard edge, knurled rubber,
    brushed steel, coil windings), 1024 x 1024.
  * painted decals from the baked position map: a big lightning bolt down each flank, the pole glyph (+ / -) in a
    disc on the flanks and in the brass bezel on top, pinstripes along the limbs, hazard chevrons on the bands.
Glass (a fresnel-patched transparent) and the charge cores (emissive, scaled by the runtime) are their own materials.

Frame: Blender X right, Y forward, Z up, metres; glTF export turns +Y forward into -Z forward.
Node contract (names the runtime reads) - see README.md.
"""
import bpy, bmesh, math, json, os, sys, time, struct
from mathutils import Vector, Matrix, Quaternion
import numpy as np

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(name, default=None): return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'stormreel.glb'))
RENDER = arg('--render')
TEX = int(arg('--tex', '1024'))
SAMPLES = int(arg('--samples', '48'))
WORK = os.path.join(HERE, 'out', 'bake'); os.makedirs(WORK, exist_ok=True)
TAU = math.tau
def log(*a): print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

# ------------------------------------------------------------------ surface zones (one bake material each)
ZONES = ['Enamel', 'Accent', 'Ceramic', 'Steel', 'Brass', 'Copper', 'Rubber', 'Fletch', 'Badge', 'Wire', 'Cable', 'DarkSteel', 'Coil', 'Hazard']
Z = {n: i for i, n in enumerate(ZONES)}
# roughness, metalness, bevel radius, detail (bump kind)
ZPROP = {
    'Enamel': (.30, .12, .0016, 'peel'), 'Accent': (.36, 0, .0014, 'peel'), 'Ceramic': (.16, 0, .0016, None),
    'Steel': (.40, 1, .0012, 'brushed'), 'Brass': (.27, 1, .0010, 'fine'), 'Copper': (.25, 1, .0010, 'fine'),
    'Rubber': (.82, 0, .0022, 'knurl'), 'Fletch': (.42, 0, .0008, None), 'Badge': (.24, 1, .0008, None),
    'Wire': (.38, 1, .0004, None), 'Cable': (.50, 0, .0015, None), 'DarkSteel': (.50, 1, .0012, 'brushed'),
    'Coil': (.28, 1, .0006, 'winding'), 'Hazard': (.40, 0, .0018, None),
}
# finishes (sRGB hex): red = positive (+) crimson & bone, blue = negative (-) blackened steel & electric blue
FIN = {
    'red': dict(Enamel='9c1b14', Accent='ecdfc4', Ceramic='f4ecda', Steel='959ca6', Brass='d9a646', Copper='d9814f', Rubber='202124',
                Fletch='ec4a2e', Badge='f0c24a', Wire='8c4a2c', Cable='c23224', DarkSteel='3b3f47', Coil='d27a46', HazA='f1e5cc', HazB='9a1e17',
                Glyph='b3241b'),
    'blue': dict(Enamel='23439a', Accent='45a0ff', Ceramic='e2e9f3', Steel='8f97a3', Brass='d9a646', Copper='d9814f', Rubber='1f2023',
                 Fletch='2f88ff', Badge='a9c9f2', Wire='8c4a2c', Cable='2a62d0', DarkSteel='2a2e36', Coil='d27a46', HazA='2f7df2', HazB='14171d',
                 Glyph='e9f2ff'),
}
def hexc(h): return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)], dtype=np.float32)

# ------------------------------------------------------------------ scene + mesh helpers
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
ZMAT = []
for zn in ZONES:
    m = bpy.data.materials.new('Z_' + zn); m.use_nodes = True; ZMAT.append(m)
ROOT = bpy.data.objects.new('Stormreel', None); SC.collection.objects.link(ROOT)

def loft(sections, cap0=True, cap1=True):
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in ring] for ring in sections]; n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap0: bm.faces.new(list(reversed(rings[0])))
    if cap1: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def chamfer_rect(w, h, c):
    return [(w, -h + c), (w, h - c), (w - c, h), (-w + c, h), (-w, h - c), (-w, -h + c), (-w + c, -h), (w - c, -h)]
def ring_xz(profile, y, cz, cx=0.0): return [Vector((cx + x, y, cz + z)) for x, z in profile]
def bezier(p0, p1, p2, p3, n):
    p0, p1, p2, p3 = map(Vector, (p0, p1, p2, p3))
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]
def frame(path, i, up):
    t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
    b = (Vector(up) - t * t.dot(Vector(up))).normalized(); n = b.cross(t).normalized()
    return t, n, b
def sweep(path, radii, sides=8, cap=True, up=None, phase=0.0):
    secs = []; prev = None
    for i, p in enumerate(path):
        t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
        if up is not None:
            b = (Vector(up) - t * t.dot(Vector(up))).normalized(); n = b.cross(t).normalized()
        else:
            ref = prev if prev is not None else (Vector((1, 0, 0)) if abs(t.x) < .9 else Vector((0, 0, 1)))
            n = (ref - t * t.dot(ref)).normalized(); b = t.cross(n).normalized(); prev = n
        r = radii[i] if isinstance(radii, (list, tuple)) else radii
        secs.append([p + n * math.cos(phase + TAU * k / sides) * r + b * math.sin(phase + TAU * k / sides) * r for k in range(sides)])
    return loft(secs, cap, cap)
def bar(path, w, h, c, up=(1, 0, 0)):
    """Chamfered-rectangle bar along a path: w across `up`, h across the other normal."""
    secs = []
    for i, p in enumerate(path):
        t, n, b = frame(path, i, up)
        ww = w[i] if isinstance(w, (list, tuple)) else w; hh = h[i] if isinstance(h, (list, tuple)) else h
        secs.append([p + b * x + n * z for x, z in chamfer_rect(ww, hh, c)])
    return loft(secs)
def lathe(pts, axis='Y', origin=(0, 0, 0), segs=16, phase=None):
    o = Vector(origin); phase = math.pi / segs if phase is None else phase; secs = []
    for r, d in pts:
        ring = []
        for k in range(segs):
            a = phase + TAU * k / segs; c, s = math.cos(a) * r, math.sin(a) * r
            ring.append(o + (Vector((c, d, s)) if axis == 'Y' else Vector((d, c, s)) if axis == 'X' else Vector((c, s, d))))
        secs.append(ring)
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in s] for s in secs]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs; bm.faces.new((a[i], a[j], b[j], b[i]))
    if pts[0][0] > 1e-6: bm.faces.new(list(reversed(rings[0])))
    if pts[-1][0] > 1e-6: bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def lathe_dir(pts, base, axis, segs=8, phase=None):
    """Lathe about an arbitrary axis direction through base."""
    bm = lathe(pts, 'Y', (0, 0, 0), segs, phase)
    q = Vector((0, 1, 0)).rotation_difference(Vector(axis).normalized())
    bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(), matrix=q.to_matrix())
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(base)); return bm
def box(c, s, bevel=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2])) + Vector(c)
    if bevel: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def torus(c, R, r, axis='Y', seg=24, sides=8):
    bm = bmesh.new(); rings = []
    for k in range(seg):
        a = TAU * k / seg; ring = []
        for j in range(sides):
            b = TAU * j / sides + math.pi / sides
            v = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
            if axis == 'Y': v = Vector((v.x, v.z, v.y))
            elif axis == 'X': v = Vector((v.z, v.x, v.y))
            ring.append(bm.verts.new(Vector(c) + v))
        rings.append(ring)
    for k in range(seg):
        A, B = rings[k], rings[(k + 1) % seg]
        for j in range(sides):
            i2 = (j + 1) % sides; bm.faces.new((A[j], A[i2], B[i2], B[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def slab(outer, inner=None, xa=-.01, xb=.01, bevel=.0018):
    """A flat plate in the YZ plane between x=xa and x=xb, optionally with a window (inner has outer's vertex count)."""
    bm = bmesh.new(); ring = lambda pts, x: [bm.verts.new(Vector((x, y, z))) for y, z in pts]
    oA, oB = ring(outer, xa), ring(outer, xb); n = len(outer)
    if inner: iA, iB = ring(inner, xa), ring(inner, xb)
    for i in range(n):
        j = (i + 1) % n; bm.faces.new((oA[i], oA[j], oB[j], oB[i]))
        if inner:
            bm.faces.new((iA[j], iA[i], iB[i], iB[j])); bm.faces.new((oB[i], oB[j], iB[j], iB[i])); bm.faces.new((oA[j], oA[i], iA[i], iA[j]))
    if not inner: bm.faces.new(oB); bm.faces.new(list(reversed(oA)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if bevel:
        edges = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(30)]
        bmesh.ops.bevel(bm, geom=edges, offset=bevel, segments=1, affect='EDGES', clamp_overlap=True)
    return bm
def gem(c, r, segs=8, rings=4, squash=1.0):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts: v.co = Vector((v.co.x, v.co.y, v.co.z * squash)) + Vector(c)
    return bm
def xform(bm, m):
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts); return bm
def mirror_x(bm):
    xform(bm, Matrix.Scale(-1, 4, Vector((1, 0, 0))))
    bmesh.ops.reverse_faces(bm, faces=bm.faces); return bm
def copy_bm(bm):
    me = bpy.data.meshes.new('tmp'); bm.to_mesh(me); out = bmesh.new(); out.from_mesh(me); bpy.data.meshes.remove(me); return out

class Part:
    """Accumulates zone-tagged pieces into one mesh object."""
    def __init__(self, name): self.name = name; self.bm = bmesh.new()
    def add(self, bm, zone, flat=False):
        for f in bm.faces: f.material_index = Z[zone]; f.smooth = not flat
        me = bpy.data.meshes.new('tmp'); bm.to_mesh(me); bm.free(); self.bm.from_mesh(me); bpy.data.meshes.remove(me)
    def both(self, bm, zone, flat=False):
        self.add(mirror_x(copy_bm(bm)), zone, flat); self.add(bm, zone, flat)
    def finish(self, parent=None, origin=(0, 0, 0), sharp=32):
        me = bpy.data.meshes.new(self.name); self.bm.to_mesh(me); self.bm.free()
        for m in ZMAT: me.materials.append(m)
        o = bpy.data.objects.new(self.name, me); SC.collection.objects.link(o)
        off = Vector(origin); me.transform(Matrix.Translation(-off))
        par = parent or ROOT; o.parent = par; o.location = off - world_of(par)
        me.set_sharp_from_angle(angle=math.radians(sharp))
        return o
def world_of(o):
    if o is None or o is ROOT: return Vector()
    bpy.context.view_layer.update(); return o.matrix_world.translation.copy()
def empty(name, loc, parent=None):
    par = parent or ROOT
    o = bpy.data.objects.new(name, None); o.empty_display_size = .01; SC.collection.objects.link(o)
    o.parent = par; o.location = Vector(loc) - world_of(par); return o

# ================================================================== layout (metres, Blender frame; GripAnchor = origin)
DECK = .108                 # top of the copper rails the bolt rides
BZ = DECK + .0045 + .002    # bolt axis height
NOCK = .072                 # cocked string / bolt tail
BOLT_LEN = .33              # tail to nose (client/stormreel-view.js BOLT_LEN)
MUZZLE = NOCK + BOLT_LEN
TUBE = dict(x=.0365, z=.1135, y0=-.150, y1=.034, r=.0125)
RING = dict(y=.258, z=.089, R=.040, r=.0072)
HORN_Y = .046
SEAT = Vector((0, -.118, .1075))   # polarity bezel on the top of the receiver, between the tubes

def limb_path(s):
    return bezier((s * .040, .392, BZ - .004), (s * .115, .438, BZ - .002), (s * .205, .432, BZ), (s * .262, .356, BZ), 12)

# ================================================================== geometry
def build():
    body = Part('Stormreel_Body')
    # --- receiver: one faceted wedge, deepest over the hand, tapering to the stock and to the prod
    # dark steel core at the back (where the tubes and side armour mount), crimson/cobalt enamel nose ahead of the latch
    rec = [(-.208, .019, .097, .054, .008), (-.193, .029, .1045, .041, .010), (-.07, .030, .1065, .032, .011), (.075, .030, .1065, .034, .011)]
    body.add(loft([ring_xz(chamfer_rect(w, (t - b) / 2, c)[::-1], y, (t + b) / 2) for y, w, t, b, c in rec]), 'DarkSteel')
    front = [(.070, .0305, .1068, .0335, .0112), (.17, .025, .1058, .046, .009), (.31, .021, .1048, .056, .008), (.345, .024, .1048, .058, .008)]
    body.add(loft([ring_xz(chamfer_rect(w, (t - b) / 2, c)[::-1], y, (t + b) / 2) for y, w, t, b, c in front]), 'Enamel')
    # side armour: a long arrowhead plate on each flank, proud of the steel, carrying the lightning stripe
    arm = [(-.188, .0915), (.034, .0925), (.082, .0735), (.034, .0505), (-.188, .0515), (-.199, .0715)]
    body.both(slab(arm, None, .0298, .0338, .0014), 'Enamel')
    for y in (-.176, .022):
        for zz in (.0575, .0855):
            body.add(lathe([(.0021, 0), (.0021, .0010), (.0012, .0017), (0, .0018)], 'X', (.0338, y, zz), segs=6), 'Brass')
            body.add(lathe([(.0021, 0), (.0021, -.0010), (.0012, -.0017), (0, -.0018)], 'X', (-.0338, y, zz), segs=6), 'Brass')
    # dark steel keel under the receiver: the frame the grips hang from
    keel = [(-.19, .041), (-.07, .032), (.06, .033), (.17, .046), (.30, .056), (.34, .058)]
    body.add(loft([ring_xz(chamfer_rect(.0215, .0075, .004)[::-1], y, b + .002) for y, b in keel]), 'DarkSteel')
    # deck: rail bed, twin copper rails with a dark flight groove between them
    body.add(box((0, .232, DECK - .0045), (.026, .37, .005), .0012), 'DarkSteel')
    for s in (-1, 1):
        body.add(box((s * .0060, .232, DECK - .0012), (.0042, .36, .0026), .0007), 'Copper')
    # --- riser (prod block) and steel yokes clamping the limbs
    ris = [(.335, .026, .1045, .058, .008), (.36, .042, .1045, .061, .010), (.405, .040, .1035, .065, .010), (.428, .022, .100, .074, .007)]
    body.add(loft([ring_xz(chamfer_rect(w, (t - b) / 2, c)[::-1], y, (t + b) / 2) for y, w, t, b, c in ris]), 'Enamel')
    yoke = loft([ring_xz(chamfer_rect(w, h, .005)[::-1], y, BZ - .005, .041) for y, w, h in ((.370, .009, .020), (.384, .0115, .0235), (.404, .0115, .0235), (.415, .008, .018))])
    body.both(yoke, 'DarkSteel')
    for s in (-1, 1):
        for zz in (BZ + .009, BZ - .019):
            body.add(lathe([(.0032, 0), (.0032, .0016), (.0020, .0026), (0, .0028)], 'X', (s * .051, .392, zz), segs=6), 'Brass')
    # nose cap with a muzzle notch: bone ceramic insulator plate
    body.add(loft([ring_xz(chamfer_rect(w, h, .005)[::-1], y, .0875) for y, w, h in ((.424, .0225, .0135), (.434, .019, .0105), (.440, .012, .0065))]), 'Brass')
    # --- accelerator coil collaring the nose; porcelain standoffs hold it off the receiver
    body.add(torus((0, RING['y'], RING['z']), RING['R'], RING['r'], 'Y', seg=28, sides=8), 'Coil')
    for s in (-1, 1):
        body.add(lathe([(.0048, 0), (.0062, .002), (.0048, .004), (.0062, .006), (.0048, .008), (.0048, .0095)], 'X', (s * .0232, RING['y'], RING['z']), segs=8) if s > 0 else
                 lathe([(.0048, 0), (.0062, -.002), (.0048, -.004), (.0062, -.006), (.0048, -.008), (.0048, -.0095)], 'X', (s * .0232, RING['y'], RING['z']), segs=8), 'Ceramic')
    # --- capacitor tubes (glass is its own object) with brass caps, porcelain discs, clamps and saddles
    glass = bmesh.new()
    for s, side in ((-1, 'L'), (1, 'R')):
        cx, cz, y0, y1, r = s * TUBE['x'], TUBE['z'], TUBE['y0'], TUBE['y1'], TUBE['r']
        g = lathe([(r - .0012, .0), (r, .003), (r, y1 - y0 - .003), (r - .0012, y1 - y0)], 'Y', (cx, y0, cz), segs=12)
        me = bpy.data.meshes.new('tmp'); g.to_mesh(me); g.free(); glass.from_mesh(me); bpy.data.meshes.remove(me)
        body.add(lathe([(0, -.011), (.0112, -.011), (.0142, -.008), (.0142, -.002), (.0132, 0), (0, 0)], 'Y', (cx, y0, cz), segs=8), 'Brass')
        body.add(lathe([(0, 0), (.0132, 0), (.0142, .002), (.0142, .008), (.0112, .011), (0, .011)], 'Y', (cx, y1, cz), segs=8), 'Brass')
        for y, d in ((y0 - .0005, -1), (y1 + .0005, 1)):
            body.add(lathe([(.0125, 0), (.0160, .0010 * d), (.0160, .0028 * d), (.0125, .0038 * d)][::d], 'Y', (cx, y + (0 if d > 0 else 0), cz), segs=12), 'Ceramic')
        for y in (-.105, -.006):
            body.add(lathe([(.0130, -.0026), (.0140, -.0018), (.0140, .0018), (.0130, .0026)], 'Y', (cx, y, cz), segs=12), 'Steel')
            body.add(box((s * .0295, y, .1010), (.008, .0050, .008), .0012), 'Steel')
        # inner copper coil the charge glows through
        n = 72; coil = [Vector((cx + math.cos(a) * .0090, y0 + .010 + (y1 - y0 - .020) * i / (n - 1), cz + math.sin(a) * .0090)) for i, a in ((i, TAU * 5 * i / (n - 1)) for i in range(n))]
        body.add(sweep(coil, .0010, sides=3, cap=False), 'Copper')
        # lightning feed: a copper strap from each front cap down into the receiver
        body.add(bar([Vector((cx, y1 + .014, cz)), Vector((s * .028, y1 + .020, .104))], .0022, .0035, .0008), 'Copper')
    # --- arc horns: porcelain stack, brass comb, a copper Jacob's ladder flaring up and out
    hb = Vector((0, HORN_Y, DECK - .002))
    body.add(lathe([(.0105, 0), (.0105, .003), (.0072, .005), (.0098, .008), (.0068, .011), (.0092, .014), (.0062, .017), (.0062, .021)], 'Z', hb, segs=8), 'Ceramic')
    body.add(box((0, HORN_Y, hb.z + .0235), (.016, .010, .006), .0015), 'Brass')
    tips = {}
    for s, side in ((-1, 'L'), (1, 'R')):
        o = Vector((s * .0045, HORN_Y, hb.z + .025))
        hp = bezier(o, o + Vector((s * .002, -.001, .016)), o + Vector((s * .016, -.004, .036)), o + Vector((s * .037, -.009, .056)), 9)
        body.add(sweep(hp, [.0029 - .0007 * i / 8 for i in range(9)], sides=6), 'Copper')
        body.add(gem(hp[-1] + Vector((s * .0012, -.0003, .0016)), .0046, segs=8, rings=4), 'Brass', flat=True)
        tips[side] = hp[-1] + Vector((s * .0012, -.0003, .0016))
    # --- polarity bezel between the tubes (glyph painted inside; the runtime adds the glowing badge on top)
    body.add(lathe([(0, 0), (.0118, 0), (.0118, .0018), (.0098, .0026), (.0088, .0012), (0, .0012)], 'Z', SEAT - Vector((0, 0, .0012)), segs=12), 'Badge')
    body.add(lathe([(0, 0), (.0089, 0), (.0089, .0013), (0, .0013)], 'Z', SEAT - Vector((0, 0, .0006)), segs=12), 'DarkSteel')
    # --- latch: a steel block under the deck with brass claws holding the string
    body.add(box((0, NOCK - .006, DECK - .006), (.024, .026, .010), .002), 'Steel')
    for s in (-1, 1):
        body.add(box((s * .0085, NOCK - .004, BZ + .001), (.004, .010, .012), .0012), 'Brass')
    # --- stock: one sturdy enamel plate with a triangular window, a steel heel and a ribbed rubber pad
    outer = [(-.186, .1005), (-.300, .0935), (-.313, .082), (-.313, -.016), (-.296, -.029), (-.050, .023), (-.150, .044)]
    inner = [(-.214, .0835), (-.287, .0790), (-.295, .0715), (-.295, .0010), (-.284, -.0075), (-.214, .0065), (-.214, .0450)]
    body.add(slab(outer, inner, -.0105, .0105, .0022), 'Enamel')
    body.add(loft([ring_xz(chamfer_rect(.0175, .0605, .009)[::-1], y, .033) for y in (-.309, -.327)]), 'DarkSteel')
    pad = []
    for i, y in enumerate((-.326, -.331, -.336, -.341, -.346, -.350)):
        k = 1.0 if i % 2 == 0 else 1.045
        if i == 5: k = .93
        pad.append(ring_xz(chamfer_rect(.0190 * k, .0620 * k, .012)[::-1], y + .002, .033))
    body.add(loft(pad), 'Rubber')
    for y, zz in ((-.300, .086), (-.300, -.012), (-.222, .092), (-.150, .025)):
        body.add(lathe([(.0030, 0), (.0030, .0014), (.0018, .0024), (0, .0026)], 'X', (.0105, y, zz), segs=6), 'Brass')
        body.add(lathe([(.0030, 0), (.0030, -.0014), (.0018, -.0024), (0, -.0026)], 'X', (-.0105, y, zz), segs=6), 'Brass')
    # --- cord socket under the butt: porcelain finned insulator, hazard collar, brass plug, cord stub with a boot
    sock = Vector((0, -.272, -.010)); d = Vector((0, -.42, -1)).normalized()
    body.add(lathe_dir([(.0105, -.004), (.0125, 0), (.0125, .006), (.0105, .008)], sock, d, segs=10), 'Hazard')
    for k in range(3):
        body.add(lathe_dir([(.0075, 0), (.0135, .0015), (.0135, .0035), (.0075, .005)], sock + d * (.009 + k * .0062), d, segs=10), 'Ceramic')
    body.add(lathe_dir([(.0070, 0), (.0082, .002), (.0082, .010), (.0062, .013)], sock + d * .028, d, segs=8), 'Brass')
    cord = bezier(sock + d * .038, sock + d * .052, sock + d * .058 + Vector((0, -.012, 0)), Vector((0, -.326, -.082)), 8)
    body.add(sweep(cord, [.0080, .0076, .0072, .0070, .0070, .0070, .0070, .0070], sides=8), 'Cable')
    cord_anchor = cord[-1]
    # --- pistol grip: ribbed rubber with finger swells, accent band, steel cap and brass pommel
    tilt = math.radians(14)
    gax = lambda t: Vector((0, .003 - math.tan(tilt) * (1 - t) * .108, .034 - (1 - t) * .108))
    secs = []
    N = 15
    for i in range(N):
        t = i / (N - 1); rib = 1.05 if i % 2 else 1.0
        finger = 1 + .07 * max(0, math.sin(t * math.pi * 3.0 - .4))
        w, dd = .0172 * rib, .0255 * rib
        c = gax(t); prof = [(w * .55, dd * finger), (w, dd * .45), (w, -dd * .5), (w * .6, -dd * 1.02), (-w * .6, -dd * 1.02), (-w, -dd * .5), (-w, dd * .45), (-w * .55, dd * finger)]
        secs.append([c + Vector((x, y, 0)) for x, y in prof])
    body.add(loft(secs), 'Rubber')
    def band(c, w, dd, h, zone):
        prof = [(w * .55, dd), (w, dd * .45), (w, -dd * .5), (w * .6, -dd * 1.02), (-w * .6, -dd * 1.02), (-w, -dd * .5), (-w, dd * .45), (-w * .55, dd)]
        body.add(loft([[c + Vector((x, y, -h)) for x, y in prof], [c + Vector((x, y, h)) for x, y in prof]]), zone)
    band(gax(.93), .0184, .0272, .004, 'Hazard')
    band(gax(-.015), .0186, .0275, .0035, 'Steel')
    body.add(lathe([(0, 0), (.0090, 0), (.0105, .003), (.0080, .006), (0, .006)], 'Z', gax(-.015) - Vector((0, 0, .0095)), segs=8), 'Brass')
    # trigger guard and trigger
    guard = bezier((0, .088, .036), (0, .092, -.006), (0, .064, -.020), (0, .030, -.016), 10)
    body.add(bar(guard, .0034, .0048, .0012), 'Steel')
    body.add(bar(bezier((0, .046, .036), (0, .052, .024), (0, .050, .012), (0, .041, .004), 6), [.0026, .0026, .0024, .0022, .0020, .0018], .0034, .0008), 'Brass')
    # fore-grip
    fy = .212
    fax = lambda t: Vector((0, fy + .010 * t, -.026 + t * .072))
    secs = []
    for i in range(11):
        t = i / 10; rib = 1.06 if i % 2 else 1.0
        if i == 10: rib = .98
        c = fax(t); w, dd = .0145 * rib, .0180 * rib
        secs.append([c + Vector((x, y, 0)) for x, y in chamfer_rect(w, dd, .006)])
    body.add(loft(secs), 'Rubber')
    body.add(loft([[fax(.86) + Vector((x, y, dz)) for x, y in chamfer_rect(.0156, .0192, .0065)] for dz in (-.004, .004)]), 'Hazard')
    body.add(loft([[fax(0) + Vector((x, y, dz)) for x, y in chamfer_rect(w, d2, .006)] for dz, w, d2 in ((-.006, .0130, .0165), (-.002, .0160, .0195), (.003, .0160, .0195))]), 'Steel')
    body_o = body.finish()

    # --- prod limbs: swept recurve blades (separate nodes so the runtime can flex them), cams at the tips
    limbs = {}
    for s, side in ((-1, 'L'), (1, 'R')):
        p = Part(f'Prod_{side}'); path = limb_path(s); n_ = len(path)
        secs = []
        for i, q in enumerate(path):
            u = i / (n_ - 1); t = (path[min(i + 1, n_ - 1)] - path[max(i - 1, 0)]).normalized(); nz = Vector((0, 0, 1)); b = t.cross(nz).normalized()
            w = .0215 - .0125 * u ** 1.1; th = .0092 - .0048 * u
            secs.append([q + nz * w * .55 + b * th, q + nz * w + b * th * .15, q + nz * w * .55 - b * th, q - nz * w * .55 - b * th, q - nz * w - b * th * .15, q - nz * w * .55 + b * th])
        p.add(loft(secs), 'Enamel')
        tip = path[-1]
        p.add(lathe([(0, -.0075), (.0105, -.0075), (.0132, -.0045), (.0132, .0045), (.0105, .0075), (0, .0075)], 'Z', tip, segs=12), 'Brass')
        p.add(lathe([(.0036, -.0098), (.0036, .0098)], 'Z', tip, segs=6), 'Steel')
        p.add(lathe([(0, 0), (.0050, 0), (.0062, .0025), (.0050, .005), (.0062, .0075), (0, .0095)], 'Y', tip + Vector((s * .0035, .0115, 0)), segs=6), 'Ceramic')
        o = p.finish(origin=path[0])
        tipE = empty(f'Prod_{side}_Tip', tip + Vector((-s * .0105, -.0060, 0)), parent=o)
        limbs[side] = (o, tipE)
    # --- string halves: each a braided wire from its cam to the latch; local +Y runs to the nock so the runtime can aim
    # and stretch it (scale along the wire) when the limbs flex or the string slips forward on a shot
    nock = Vector((0, NOCK, BZ))
    for side in ('L', 'R'):
        bpy.context.view_layer.update()
        a = limbs[side][1].matrix_world.translation.copy(); L = (nock - a).length
        p = Part(f'String_{side}')
        p.add(sweep([Vector((0, 0, 0)), Vector((0, L, 0))], .0015, sides=6, cap=False, up=(0, 0, 1)), 'Wire')
        o = p.finish()
        o.location = a; o.rotation_mode = 'QUATERNION'; o.rotation_quaternion = Vector((0, 1, 0)).rotation_difference((nock - a).normalized())
    # --- the bolt (tail at its origin, nose BOLT_LEN ahead)
    # The Bolt node sits at HALF the seat position and its mesh child carries the other half: client/stormreel-view.js clones
    # Bolt and sets its position to minus the template's, which then lands the bolt's tail exactly on the holder origin.
    bolt = empty('Bolt', nock * .5)
    bp = Part('Bolt_Mesh'); o = Vector((0, NOCK, BZ))
    Y = lambda y: o + Vector((0, y, 0))
    bp.add(lathe([(0, -.013), (.0062, -.013), (.0078, -.011), (.0078, -.0085), (.0058, -.007), (.0058, .004), (.0078, .0055), (.0078, .0085), (.0050, .010)], 'Y', o, segs=6, phase=0), 'Brass')
    bp.add(lathe([(.0060, -.0066), (.0067, -.0055), (.0067, .0025), (.0060, .0036)], 'Y', o, segs=6, phase=0), 'Copper')
    bp.add(lathe([(.0043, .010), (.0043, .262)], 'Y', o, segs=6, phase=0), 'DarkSteel')
    bp.add(lathe([(.0043, 0), (.0070, .002), (.0070, .006), (.0056, .0075), (.0070, .009), (.0070, .013), (.0045, .015)], 'Y', Y(.258), segs=6, phase=0), 'Ceramic')
    bp.add(lathe([(.0048, 0), (.0102, .010), (.0118, .017), (.0062, .022), (.0080, .026), (0, BOLT_LEN - .273)], 'Y', Y(.273), segs=4, phase=math.pi / 4), 'Copper', flat=True)
    for k in range(3):
        a_ = math.pi / 2 + TAU * k / 3 + math.pi / 3; dv = Vector((math.cos(a_), 0, math.sin(a_)))
        v = bmesh.new(); pts = [(.016, .0040), (.026, .0205), (.050, .0205), (.104, .0040)]
        vs = [v.verts.new(Y(y) + dv * r) for y, r in pts]; f = v.faces.new(vs)
        bmesh.ops.solidify(v, geom=[f], thickness=.0014)
        side_n = Vector((0, 1, 0)).cross(dv).normalized(); bmesh.ops.translate(v, verts=v.verts, vec=side_n * .0007)
        bmesh.ops.recalc_face_normals(v, faces=v.faces)
        bp.add(v, 'Fletch', flat=True)
    bolt_o = bp.finish(parent=bolt, origin=nock)
    empty('FilamentSpool', Y(-.013), parent=bolt)
    # --- glass + charge cores
    me = bpy.data.meshes.new('Capacitor_Glass'); glass.to_mesh(me); glass.free()
    for poly in me.polygons: poly.use_smooth = True
    go = bpy.data.objects.new('Capacitor_Glass', me); SC.collection.objects.link(go); go.parent = ROOT
    cores = []
    for s, side in ((-1, 'L'), (1, 'R')):
        co = Vector((s * TUBE['x'], TUBE['y0'] + .006, TUBE['z']))
        L = TUBE['y1'] - TUBE['y0'] - .012
        c = lathe([(0, 0), (.0042, .0015), (.0056, .006), (.0056, L - .006), (.0042, L - .0015), (0, L)], 'Y', co, segs=8)
        cme = bpy.data.meshes.new(f'Charge_{side}_Core'); c.to_mesh(cme); c.free(); cme.transform(Matrix.Translation(-co))
        for poly in cme.polygons: poly.use_smooth = True
        cob = bpy.data.objects.new(f'Charge_{side}_Core', cme); SC.collection.objects.link(cob); cob.parent = ROOT; cob.location = co
        empty(f'Charge_{side}', co); cores.append(cob)
    # --- contract empties
    empty('GripAnchor', (0, 0, 0))
    empty('ForeGrip', fax(.45))
    empty('Muzzle', (0, MUZZLE, BZ))
    empty('BoltSeat', nock)
    empty('String', nock)
    empty('Trigger', (0, .047, .028))
    empty('CordAnchor', cord_anchor)
    empty('Horn_Base', (0, HORN_Y, hb.z + .027))
    for side, t in tips.items(): empty(f'ArcHorn_{side}', t)
    empty('PolarityBadge_Seat', SEAT + Vector((0, 0, .0016)))
    empty('Coil_Center', (0, RING['y'], RING['z']))
    bpy.context.view_layer.update()
    atlas = [body_o, limbs['L'][0], limbs['R'][0], SC.objects['String_L'], SC.objects['String_R'], bolt_o]
    return atlas, go, cores, bolt_o

ATLAS, GLASS, CORES, BOLT = build()
def tris(objs): return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)
log('geometry', {o.name: tris([o]) for o in ATLAS + [GLASS] + CORES}, 'total', tris(ATLAS + [GLASS] + CORES))

# ================================================================== UV unwrap (all atlas objects share one 0..1 square)
def select_only(objs, active=None):
    for o in SC.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = active or objs[0]
select_only(ATLAS)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=.002, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.select_all(action='SELECT')
bpy.ops.uv.average_islands_scale()
bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, rotate_method='ANY', scale=True, margin_method='FRACTION', margin=.004, shape_method='CONCAVE')
bpy.ops.object.mode_set(mode='OBJECT')
log('unwrapped')

# ================================================================== bake
SC.render.engine = 'CYCLES'; SC.cycles.device = 'CPU'
SC.cycles.use_denoising = False
SC.render.bake.margin = max(4, TEX // 96); SC.render.bake.margin_type = 'EXTEND'
def new_img(name, size=TEX, float_=False):
    if name in bpy.data.images: bpy.data.images.remove(bpy.data.images[name])
    im = bpy.data.images.new(name, size, size, alpha=False, float_buffer=float_)
    im.colorspace_settings.name = 'Non-Color'; return im

def setup_zone(mat, zone, mode, img):
    nt = mat.node_tree; nt.nodes.clear(); N = nt.nodes.new; L = nt.links.new
    out = N('ShaderNodeOutputMaterial'); tex = N('ShaderNodeTexImage'); tex.image = img; nt.nodes.active = tex
    rough, metal, bev, detail = ZPROP[zone]
    geo = N('ShaderNodeNewGeometry'); tc = N('ShaderNodeTexCoord')
    def emit(sock):
        e = N('ShaderNodeEmission'); L(sock, e.inputs['Color']); e.inputs['Strength'].default_value = 1; L(e.outputs[0], out.inputs['Surface'])
    if mode == 'id':
        rgb = N('ShaderNodeRGB'); rgb.outputs[0].default_value = ((Z[zone] + .5) / 16, 0, 0, 1); emit(rgb.outputs[0])
    elif mode == 'pos':
        sub = N('ShaderNodeVectorMath'); sub.operation = 'MULTIPLY_ADD'; L(geo.outputs['Position'], sub.inputs[0])
        sub.inputs[1].default_value = (1, 1, 1); sub.inputs[2].default_value = (.5, .5, .5); emit(sub.outputs[0])   # world + .5
    elif mode == 'nrm':
        m = N('ShaderNodeVectorMath'); m.operation = 'MULTIPLY_ADD'; L(geo.outputs['Normal'], m.inputs[0]); m.inputs[1].default_value = (.5, .5, .5); m.inputs[2].default_value = (.5, .5, .5); emit(m.outputs[0])
    elif mode == 'edge':
        bv = N('ShaderNodeBevel'); bv.inputs['Radius'].default_value = bev * 1.8; bv.samples = 16
        dot = N('ShaderNodeVectorMath'); dot.operation = 'DOT_PRODUCT'; L(bv.outputs[0], dot.inputs[0]); L(geo.outputs['Normal'], dot.inputs[1])
        m = N('ShaderNodeMath'); m.operation = 'SUBTRACT'; m.inputs[0].default_value = 1; L(dot.outputs['Value'], m.inputs[1])
        k = N('ShaderNodeMath'); k.operation = 'MULTIPLY'; k.use_clamp = True; L(m.outputs[0], k.inputs[0]); k.inputs[1].default_value = 9
        emit(k.outputs[0])
    elif mode == 'normal':
        bsdf = N('ShaderNodeBsdfPrincipled'); L(bsdf.outputs[0], out.inputs['Surface'])
        bv = N('ShaderNodeBevel'); bv.inputs['Radius'].default_value = bev; bv.samples = 12
        nrm = bv.outputs[0]
        h = None
        pos = geo.outputs['Position']
        if detail == 'knurl':   # diamond knurl: two crossed fine waves
            sep = N('ShaderNodeSeparateXYZ'); L(pos, sep.inputs[0])
            def wave(a, b, f):
                ad = N('ShaderNodeMath'); ad.operation = 'ADD'; L(sep.outputs[a], ad.inputs[0])
                if b is None: ad.inputs[1].default_value = 0
                else:
                    ng = N('ShaderNodeMath'); ng.operation = 'MULTIPLY'; L(sep.outputs[b], ng.inputs[0]); ng.inputs[1].default_value = f; L(ng.outputs[0], ad.inputs[1])
                m = N('ShaderNodeMath'); m.operation = 'MULTIPLY'; L(ad.outputs[0], m.inputs[0]); m.inputs[1].default_value = 900
                sn = N('ShaderNodeMath'); sn.operation = 'SINE'; L(m.outputs[0], sn.inputs[0])
                ab = N('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; L(sn.outputs[0], ab.inputs[0]); return ab.outputs[0]
            w1 = wave('Z', 'X', 1.0); w2 = wave('Z', 'X', -1.0); w3 = wave('Z', 'Y', 1.0); w4 = wave('Z', 'Y', -1.0)
            m1 = N('ShaderNodeMath'); m1.operation = 'MINIMUM'; L(w1, m1.inputs[0]); L(w2, m1.inputs[1])
            m2 = N('ShaderNodeMath'); m2.operation = 'MINIMUM'; L(w3, m2.inputs[0]); L(w4, m2.inputs[1])
            mm = N('ShaderNodeMath'); mm.operation = 'MINIMUM'; L(m1.outputs[0], mm.inputs[0]); L(m2.outputs[0], mm.inputs[1])
            h = mm.outputs[0]; strength, dist = .55, .0004
        elif detail == 'brushed':
            mp = N('ShaderNodeMapping'); L(pos, mp.inputs[0]); mp.inputs['Scale'].default_value = (900, 25, 900)
            nz = N('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 1; nz.inputs['Detail'].default_value = 4; L(mp.outputs[0], nz.inputs['Vector'])
            h = nz.outputs['Fac']; strength, dist = .12, .0002
        elif detail == 'fine':
            nz = N('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 600; nz.inputs['Detail'].default_value = 3; L(pos, nz.inputs['Vector'])
            h = nz.outputs['Fac']; strength, dist = .08, .0002
        elif detail == 'peel':
            nz = N('ShaderNodeTexNoise'); nz.inputs['Scale'].default_value = 420; nz.inputs['Detail'].default_value = 2; L(pos, nz.inputs['Vector'])
            h = nz.outputs['Fac']; strength, dist = .035, .0002
        elif detail == 'winding':   # wire turns round the coil's minor circle: bands along the major angle
            sep = N('ShaderNodeSeparateXYZ'); L(pos, sep.inputs[0])
            dz = N('ShaderNodeMath'); dz.operation = 'SUBTRACT'; L(sep.outputs['Z'], dz.inputs[0]); dz.inputs[1].default_value = RING['z']
            at = N('ShaderNodeMath'); at.operation = 'ARCTAN2'; L(dz.outputs[0], at.inputs[0]); L(sep.outputs['X'], at.inputs[1])
            m = N('ShaderNodeMath'); m.operation = 'MULTIPLY'; L(at.outputs[0], m.inputs[0]); m.inputs[1].default_value = 64
            sn = N('ShaderNodeMath'); sn.operation = 'SINE'; L(m.outputs[0], sn.inputs[0])
            ab = N('ShaderNodeMath'); ab.operation = 'ABSOLUTE'; L(sn.outputs[0], ab.inputs[0])
            pw = N('ShaderNodeMath'); pw.operation = 'POWER'; L(ab.outputs[0], pw.inputs[0]); pw.inputs[1].default_value = .5
            h = pw.outputs[0]; strength, dist = .9, .0008
        if h is not None:
            bump = N('ShaderNodeBump'); bump.inputs['Strength'].default_value = strength; bump.inputs['Distance'].default_value = dist
            L(h, bump.inputs['Height']); L(nrm, bump.inputs['Normal']); nrm = bump.outputs[0]
        L(nrm, bsdf.inputs['Normal'])
    else:   # 'ao' bakes need a plain diffuse surface
        bsdf = N('ShaderNodeBsdfDiffuse'); L(bsdf.outputs[0], out.inputs['Surface'])

def bake(mode, btype, img, samples, objs, filter_=1.5):
    for zi, m in enumerate(ZMAT): setup_zone(m, ZONES[zi], mode, img)
    SC.cycles.samples = samples; SC.cycles.filter_width = filter_
    select_only(objs)
    kw = dict(type=btype, margin=SC.render.bake.margin, use_clear=True)
    if btype == 'NORMAL': kw.update(normal_space='TANGENT')
    t = time.time(); bpy.ops.object.bake(**kw); log(f'baked {mode} ({time.time() - t:.0f}s)')
    a = np.array(img.pixels[:], dtype=np.float32).reshape(img.size[1], img.size[0], 4)
    return a

imgs = {k: new_img('bake_' + k, float_=(k == 'pos')) for k in ('id', 'pos', 'nrm', 'edge', 'ao', 'normal')}
B = {}
B['id'] = bake('id', 'EMIT', imgs['id'], 1, ATLAS, .01)
B['pos'] = bake('pos', 'EMIT', imgs['pos'], 1, ATLAS, .01)
B['nrm'] = bake('nrm', 'EMIT', imgs['nrm'], 1, ATLAS, .5)
B['edge'] = bake('edge', 'EMIT', imgs['edge'], max(8, SAMPLES // 2), ATLAS)
B['normal'] = bake('normal', 'NORMAL', imgs['normal'], max(8, SAMPLES // 2), ATLAS)
# AO: the bolt is baked on its own (it flies and lies alone), the crossbow without the bolt in it
SC.world = bpy.data.worlds.new('W') if SC.world is None else SC.world
SC.render.bake.use_selected_to_active = False
SC.world.light_settings.distance = .05
bolt_parent = BOLT.parent; bolt_parent.location.x += 10
for o in [GLASS] + CORES: o.hide_render = True   # glass must not shade what is inside it
bpy.context.view_layer.update()
ao_body = bake('ao', 'AO', imgs['ao'], SAMPLES, [o for o in ATLAS if o is not BOLT])
ao_bolt = bake('ao', 'AO', imgs['ao'], SAMPLES, [BOLT])
bolt_parent.location.x -= 10
for o in [GLASS] + CORES: o.hide_render = False
bpy.context.view_layer.update()

# ================================================================== composite (numpy, Blender rows are bottom-up)
idm = np.clip(np.floor(B['id'][..., 0] * 16).astype(int), 0, len(ZONES) - 1)
P = B['pos'][..., :3] - .5
Nw = B['nrm'][..., :3] * 2 - 1
edge = np.clip(B['edge'][..., 0], 0, 1)
# AO: the two bakes cleared the image; take whichever covered each texel (bolt texels from the bolt bake)
bolt_mask = np.zeros(idm.shape, bool)
# bolt texels: position near the seated bolt axis and inside its length
bolt_mask = (np.abs(P[..., 0]) < .028) & (P[..., 1] > NOCK - .016) & (P[..., 1] < MUZZLE + .002) & (np.abs(P[..., 2] - BZ) < .028) & np.isin(idm, [Z['Brass'], Z['Copper'], Z['DarkSteel'], Z['Ceramic'], Z['Fletch']])
ao = np.where(bolt_mask, ao_bolt[..., 0], ao_body[..., 0])
ao = np.clip(ao, 0, 1) ** .9
def blur3(a, n=1):   # light de-noise of the AO bake (texels only ever average with close neighbours in UV space)
    for _ in range(n):
        p_ = np.pad(a, 1, mode='edge'); a = (p_[:-2, 1:-1] + p_[2:, 1:-1] + p_[1:-1, :-2] + p_[1:-1, 2:] + 2 * a) / 6
    return a
ao = blur3(ao, 2)
H_, W_ = idm.shape
X, Yp, Zp = P[..., 0], P[..., 1], P[..., 2]
def noise2(seed, scale):
    rng = np.random.default_rng(seed); small = rng.random((max(2, H_ // scale), max(2, W_ // scale))).astype(np.float32)
    from PIL import Image
    return np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((W_, H_), Image.BICUBIC), dtype=np.float32) / 255
grain = noise2(3, 24); grain2 = noise2(9, 6)

# ---- decal masks from the position map
from PIL import Image, ImageDraw
def plane_decal(draw_fn, y0, y1, z0, z1, ppm=2400):
    w, h = int((y1 - y0) * ppm), int((z1 - z0) * ppm)
    im = Image.new('L', (w, h), 0); draw_fn(ImageDraw.Draw(im), lambda y, z: ((y - y0) * ppm, (z1 - z) * ppm))
    a = np.asarray(im, dtype=np.float32) / 255
    iy = np.clip(((Yp - y0) * ppm).astype(int), 0, w - 1); iz = np.clip(((z1 - Zp) * ppm).astype(int), 0, h - 1)
    inside = (Yp >= y0) & (Yp < y1) & (Zp >= z0) & (Zp < z1)
    return np.where(inside, a[iz, iy], 0)
BOLT_SHAPE = [(-.30, .50), (.20, .50), (-.02, .08), (.32, .08), (-.22, -.55), (.02, -.06), (-.30, -.06)]
def bolt_side(d, T):   # a long lightning bolt down the flank, rear point to forward point, one crisp step
    pts = [(-.168, .0905), (.022, .0950), (.002, .0795), (.232, .0725), (.050, .0660), (.070, .0815)]
    d.polygon([T(-.172 + (y + .168) * .565, .0565 + (z - .066) * 1.05) for y, z in pts], fill=255)
side_bolt = plane_decal(bolt_side, -.21, .35, .02, .12)
def glyph_disc(d, T):
    c = T(-.166, .0735); r = .0165 * 2400; d.ellipse([c[0] - r, c[1] - r, c[0] + r, c[1] + r], fill=255)
glyph_disc_m = plane_decal(glyph_disc, -.21, -.12, .04, .11)
def glyph_mark(sign):
    def f(d, T):
        c = T(-.166, .0735); a, b = .0105 * 2400, .0030 * 2400
        d.rectangle([c[0] - a, c[1] - b, c[0] + a, c[1] + b], fill=255)
        if sign: d.rectangle([c[0] - b, c[1] - a, c[0] + b, c[1] + a], fill=255)
    return f
side_flank = (np.abs(Nw[..., 0]) > .8) & (idm == Z['Enamel']) & (np.abs(X) > .0332) & (Yp < .09)
# top bezel glyph (x,y plane at SEAT)
def top_glyph(sign):
    dx, dy = X - SEAT.x, Yp - SEAT.y
    m = (np.abs(dx) < .0062) & (np.abs(dy) < .0018)
    if sign: m |= (np.abs(dy) < .0062) & (np.abs(dx) < .0018)
    return m & (idm == Z['DarkSteel']) & (Nw[..., 2] > .7) & (np.abs(Zp - SEAT.z) < .004) & (np.hypot(dx, dy) < .009)
# limb pinstripe: distance to each limb's centreline in XY, on the blade's front and back faces
def poly_dist(px, py, pts):
    best = np.full(px.shape, 1e9, np.float32); ubest = np.zeros(px.shape, np.float32); n = len(pts)
    for i in range(n - 1):
        ax, ay, bx, by = pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y
        vx, vy = bx - ax, by - ay; L2 = vx * vx + vy * vy
        t = np.clip(((px - ax) * vx + (py - ay) * vy) / L2, 0, 1)
        d = np.hypot(px - (ax + t * vx), py - (ay + t * vy))
        better = d < best; best = np.where(better, d, best); ubest = np.where(better, (i + t) / (n - 1), ubest)
    return best, ubest
limb_zone = (idm == Z['Enamel']) & (np.abs(X) > .044) & (Yp > .33)
stripe = np.zeros(idm.shape, bool)
for s in (-1, 1):
    d, u = poly_dist(X, Yp, limb_path(s))
    side_face = np.abs(Nw[..., 2]) < .6
    zc = BZ - .004 + .004 * u
    stripe |= limb_zone & (np.sign(X) == s) & side_face & (np.abs(Zp - zc) < (.0030 - .0014 * u)) & (u > .06) & (u < .9)
haz = idm == Z['Hazard']
haz_stripe = (np.mod((X * .6 + Yp + Zp * 1.2) / .0105, 1.0) < .5)

def lin(c): return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)
def srgb(c): c = np.clip(c, 0, 1); return np.where(c <= .0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - .055)

def base_colour(fin):
    F = {k: lin(hexc(v)) for k, v in FIN[fin].items()}
    col = np.zeros((H_, W_, 3), np.float32)
    for zn in ZONES:
        if zn in F: col[idm == Z[zn]] = F[zn]
    col[haz] = np.where(haz_stripe[haz][:, None], F['HazA'], F['HazB'])
    # decals
    acc = F['Accent']
    m = side_flank & (side_bolt > .5); col[m] = acc
    col[stripe] = acc
    tg = top_glyph(fin == 'red'); col[tg] = acc
    # value shaping: top-lit gradient on painted parts, grain, polished/worn edges, ambient occlusion
    painted = np.isin(idm, [Z['Enamel'], Z['Accent'], Z['Fletch'], Z['Cable'], Z['Hazard']])
    up = np.clip(Nw[..., 2] * .5 + .5, 0, 1)
    grad = .80 + .22 * up + .06 * np.clip((Zp - .02) / .1, -.5, 1)
    col = np.where(painted[..., None], col * grad[..., None], col)
    col *= (.96 + .08 * grain)[..., None]
    metal = np.isin(idm, [Z['Steel'], Z['DarkSteel'], Z['Brass'], Z['Copper'], Z['Coil'], Z['Badge']])
    e = edge[..., None]
    col = np.where(metal[..., None], col + (np.minimum(1, col * 1.6 + .10) - col) * e * .65, col)
    col = np.where(painted[..., None], col + (np.minimum(1, col * 1.45 + .05) - col) * e * .45, col)
    rub = idm == Z['Rubber']; col = np.where(rub[..., None], col + .035 * e, col)
    col *= (.55 + .45 * ao)[..., None]
    return srgb(col)

rough = np.zeros(idm.shape, np.float32); metal = np.zeros(idm.shape, np.float32)
for zn in ZONES: rough[idm == Z[zn]] = ZPROP[zn][0]; metal[idm == Z[zn]] = ZPROP[zn][1]
metalz = metal > .5
rough = rough + (grain - .5) * .10
rough = np.where(metalz, rough - edge * .10, rough + edge * .06)     # polished metal edges, a touch of wear on paint
rough[stripe] = ZPROP['Accent'][0]
rough = np.clip(rough, .05, 1)
ORM = np.stack([ao, rough, metal], -1)
NRM = B['normal'][..., :3]

def save(a, path, quality=None, size=None, sub=0):
    im = Image.fromarray((np.clip(a, 0, 1)[::-1] * 255 + .5).astype(np.uint8))
    if size: im = im.resize(size, Image.LANCZOS)
    if path.endswith('.jpg'): im.save(path, quality=quality or 90, subsampling=sub, optimize=True, progressive=False)
    else: im.save(path, optimize=True)
    return path
red, blue = base_colour('red'), base_colour('blue')
base_path = os.path.join(WORK, 'stormreel_base.jpg')
# top half (glTF v 0..0.5) = red, bottom half = blue; arrays are bottom-up, so stack blue under red then flip in save
save(np.concatenate([blue, red], 0), base_path, 84, sub=2)
orm_path = save(ORM, os.path.join(WORK, 'stormreel_orm.jpg'), 88, size=(TEX // 2, TEX // 2))
nrm_path = save(NRM, os.path.join(WORK, 'stormreel_normal.jpg'), 80)
for k in ('id', 'edge'): save(np.repeat((B[k][..., :1] if k == 'edge' else (idm[..., None] / 14.0)), 3, -1), os.path.join(WORK, f'debug_{k}.png'))
save(np.repeat(ao[..., None], 3, -1), os.path.join(WORK, 'debug_ao.png'))
log('textures', {p: os.path.getsize(p) for p in (base_path, orm_path, nrm_path)})

# ================================================================== export materials + GLB
body_mat = bpy.data.materials.new('Stormreel_Body'); body_mat.use_nodes = True
bb = body_mat.node_tree.nodes['Principled BSDF']; bb.inputs['Roughness'].default_value = 1; bb.inputs['Metallic'].default_value = 1
for o in ATLAS:
    me = o.data
    for p in me.polygons: p.material_index = 0
    me.materials.clear(); me.materials.append(body_mat)
glass_mat = bpy.data.materials.new('Glass'); glass_mat.use_nodes = True
gb = glass_mat.node_tree.nodes['Principled BSDF']
gb.inputs['Base Color'].default_value = (.80, .90, 1.0, 1); gb.inputs['Roughness'].default_value = .04; gb.inputs['Alpha'].default_value = .22
glass_mat.surface_render_method = 'BLENDED'
GLASS.data.materials.append(glass_mat)
charge_mat = bpy.data.materials.new('Charge'); charge_mat.use_nodes = True
cb = charge_mat.node_tree.nodes['Principled BSDF']
cb.inputs['Base Color'].default_value = (.35, .75, 1, 1); cb.inputs['Roughness'].default_value = .2
cb.inputs['Emission Color'].default_value = (.12, .55, 1, 1); cb.inputs['Emission Strength'].default_value = 2.0
for c in CORES: c.data.materials.append(charge_mat)

def lo_hi():
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in SC.objects:
        if o.type != 'MESH': continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi

os.makedirs(os.path.dirname(os.path.abspath(OUT)), exist_ok=True)
tmp_glb = os.path.join(WORK, 'raw.glb')
select_only([o for o in SC.objects]); bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=tmp_glb, export_format='GLB', export_yup=True, export_apply=False, export_materials='EXPORT',
                          export_image_format='NONE', export_normals=True, export_texcoords=True, export_tangents=False,
                          export_extras=False, export_cameras=False, export_lights=False)

# ---- GLB post-process: attach the baked textures (base colour via KHR_texture_transform), quantize normals and UVs
def read_glb(path):
    b = open(path, 'rb').read(); jl = struct.unpack_from('<I', b, 12)[0]; j = json.loads(b[20:20 + jl])
    off = 20 + jl; bl = struct.unpack_from('<I', b, off)[0]; return j, bytearray(b[off + 8:off + 8 + bl])
def write_glb(path, j, bin_):
    while len(bin_) % 4: bin_.append(0)
    js = json.dumps(j, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    out = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(bin_)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(bin_), 0x004E4942) + bytes(bin_)
    open(path, 'wb').write(out); return len(out)
j, binb = read_glb(tmp_glb)
newbin = bytearray(); views = []
CT = {5126: ('f', 4), 5123: ('H', 2), 5125: ('I', 4), 5121: ('B', 1), 5122: ('h', 2), 5120: ('b', 1)}
def view_bytes(acc):
    bv = j['bufferViews'][acc['bufferView']]; fmt, sz = CT[acc['componentType']]; n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[acc['type']]
    start = bv.get('byteOffset', 0) + acc.get('byteOffset', 0); stride = bv.get('byteStride', sz * n)
    arr = np.frombuffer(bytes(binb[start:start + stride * (acc['count'] - 1) + sz * n]), dtype=np.dtype(fmt).newbyteorder('<')) if stride == sz * n else None
    if arr is None: raise RuntimeError('strided view')
    return arr.reshape(acc['count'], n)
def add_view(data, target=None, stride=None):
    while len(newbin) % 4: newbin.append(0)
    v = {'buffer': 0, 'byteOffset': len(newbin), 'byteLength': len(data)}
    if target: v['target'] = target
    if stride: v['byteStride'] = stride
    newbin.extend(data); views.append(v); return len(views) - 1
quantized = set()
for mesh in j['meshes']:
    for prim in mesh['primitives']:
        for sem, ai in list(prim['attributes'].items()):
            acc = j['accessors'][ai]
            if ai in quantized: continue
            if sem == 'NORMAL':
                a = view_bytes(acc).astype(np.float32); q = np.clip(np.round(a * 127), -127, 127).astype(np.int8)
                q4 = np.zeros((len(q), 4), np.int8); q4[:, :3] = q
                acc.update(bufferView=add_view(q4.tobytes(), 34962, 4), componentType=5120, normalized=True, byteOffset=0); acc.pop('min', None); acc.pop('max', None)
                quantized.add(ai)
            elif sem.startswith('TEXCOORD'):
                a = view_bytes(acc).astype(np.float32); q = np.clip(np.round(a * 65535), 0, 65535).astype(np.uint16)
                acc.update(bufferView=add_view(q.tobytes(), 34962), componentType=5123, normalized=True, byteOffset=0); acc.pop('min', None); acc.pop('max', None)
                quantized.add(ai)
            else:
                acc.update(bufferView=add_view(view_bytes(acc).tobytes(), 34962), byteOffset=0); quantized.add(ai)
        if 'indices' in prim and prim['indices'] not in quantized:
            acc = j['accessors'][prim['indices']]; a = view_bytes(acc)
            acc.update(bufferView=add_view(a.tobytes(), 34963), byteOffset=0); quantized.add(prim['indices'])
for k, acc in enumerate(j['accessors']):
    if k not in quantized: acc.update(bufferView=add_view(view_bytes(acc).tobytes()), byteOffset=0)
imgs_out = []
for path, mime in ((base_path, 'image/jpeg'), (orm_path, 'image/jpeg'), (nrm_path, 'image/jpeg')):
    imgs_out.append({'bufferView': add_view(open(path, 'rb').read()), 'mimeType': mime})
j['bufferViews'] = views; j['buffers'] = [{'byteLength': len(newbin)}]
j['images'] = imgs_out
j['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 33071, 'wrapT': 33071}]
j['textures'] = [{'sampler': 0, 'source': i} for i in range(3)]
for m in j['materials']:
    if m['name'] == 'Stormreel_Body':
        m['pbrMetallicRoughness'] = {'baseColorTexture': {'index': 0, 'extensions': {'KHR_texture_transform': {'offset': [0, 0], 'scale': [1, .5]}}},
                                     'metallicRoughnessTexture': {'index': 1}, 'metallicFactor': 1, 'roughnessFactor': 1}
        m['occlusionTexture'] = {'index': 1}; m['normalTexture'] = {'index': 2}
ext = set(j.get('extensionsUsed', [])) | {'KHR_texture_transform', 'KHR_mesh_quantization'}
j['extensionsUsed'] = sorted(ext); j['extensionsRequired'] = sorted(set(j.get('extensionsRequired', [])) | {'KHR_mesh_quantization'})
size = write_glb(OUT, j, newbin)
lo, hi = lo_hi()
nverts = sum(len(o.data.vertices) for o in SC.objects if o.type == 'MESH')
report = {'out': OUT, 'bytes': size, 'triangles': tris([o for o in SC.objects if o.type == 'MESH']), 'bolt_triangles': tris([BOLT]),
          'meshes': len(j['meshes']), 'materials': [m['name'] for m in j['materials']], 'textures': {os.path.basename(p): os.path.getsize(p) for p in (base_path, orm_path, nrm_path)},
          'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi], 'seconds': round(time.time() - T0)}
json.dump(report, open(os.path.join(WORK, 'report.json'), 'w'), indent=1)
log('REPORT', json.dumps(report))

# ================================================================== optional turnaround renders (Cycles, review only)
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=OUT)
    sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = 48; sc.cycles.device = 'CPU'
    sc.render.resolution_x, sc.render.resolution_y = 1200, 760; sc.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (.55, .63, .72, 1); w.node_tree.nodes['Background'].inputs[1].default_value = .9
    def light(loc, e, s=.6):
        ld = bpy.data.lights.new('l', 'AREA'); ld.energy = e; ld.size = s; lo_ = bpy.data.objects.new('l', ld); sc.collection.objects.link(lo_); lo_.location = loc
        lo_.rotation_euler = (Vector((0, 0, .05)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light((-1.2, -.8, 1.6), 260); light((1.4, .6, .9), 120); light((0, 1.6, .4), 60)
    camd = bpy.data.cameras.new('c'); camd.lens = 60; cam = bpy.data.objects.new('c', camd); sc.collection.objects.link(cam); sc.camera = cam
    for name, loc in (('three_quarter', (.9, -.75, .55)), ('side', (1.25, .05, .1)), ('top', (.25, .02, 1.25)), ('front', (.35, 1.1, .35)), ('back_fp', (-.18, -.62, .35))):
        cam.location = loc; cam.rotation_euler = (Vector((0, .05, .05)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(RENDER, f'crossbow_{name}.png'); bpy.ops.render.render(write_still=True); log('render', name)
