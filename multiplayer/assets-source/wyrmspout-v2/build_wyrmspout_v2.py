"""Wyrmspout II - reproducible Blender (bpy 4.5) builder.

Run:  python3.11 build_wyrmspout_v2.py [--out path.glb] [--render dir]
      (pip install bpy==4.5.* numpy)

Identity: a small forged wyrm that spits sticky fire. The same dragon-head blaster as the first Wyrmspout,
rebuilt sleek and sturdy: a faceted blackened-steel head with an articulated jaw, armoured neck rings, a
steel receiver over a walnut pistol grip, and a brass-caged glass tank of liquid fire on top that the
player watches drain while firing and refill while it cools. The tail curls round behind the hand.

Frame: Blender (X right, Y forward, Z up), metres. glTF export turns +Y forward into -Z forward, which is
what client/asset-pose.js expects. GripAnchor is the origin (centre of the hand). Runtime node contract:
  GripAnchor, Muzzle (spout tip), Jaw (hinge; rotate about X to open), FuelLiquid (origin at the tank
  floor; scale Y in three.js = fill), FuelGlow, EmberCore, HeatVent_L1..3/R1..3 (cheek gills),
  Neck_Scales, Trigger, EyeLeft/EyeRight, Head.
"""
import bpy, bmesh, math, json, os, sys, time
from mathutils import Vector, Matrix

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'wyrmspout.glb'))
RENDER = arg('--render')
TAU = math.tau

# ------------------------------------------------------------------ dimensions (shared with runtime)
AXIS_Z = 0.080            # barrel / neck centre line
MUZZLE = Vector((0.0, 0.352, 0.071))
TANK_Y = (-0.040, 0.080); TANK_Z = 0.124; TANK_R = 0.027; LIQUID_R = 0.0228
JAW_HINGE = Vector((0.0, 0.202, 0.066))

# ------------------------------------------------------------------ materials
MAT_DEF = {
    "WyrmSteel":  dict(c="23262c", m=1.0, r=0.42),
    "PlateSteel": dict(c="30343b", m=1.0, r=0.34),
    "Brass":      dict(c="c08f3c", m=1.0, r=0.30),
    "DarkBrass":  dict(c="7a5427", m=1.0, r=0.40),
    "Walnut":     dict(c="2a140b", m=0.0, r=0.40),
    "Leather":    dict(c="3b1a12", m=0.0, r=0.62),
    "Ivory":      dict(c="eadfc4", m=0.0, r=0.36),
    "Horn":       dict(c="b9a283", m=0.0, r=0.40),
    "Soot":       dict(c="120c0a", m=0.0, r=0.85),
    "EmberGlass": dict(c="ffb23a", m=0.0, r=0.12, e="ff7a14", es=2.2),
    "Pupil":      dict(c="0a0806", m=0.0, r=0.20),
    "TankGlass":  dict(c="f2f6ff", m=0.0, r=0.02, a=0.12),
    "LiquidFire": dict(c="ff4a00", m=0.0, r=0.16, e="ff4800", es=0.9),
    "Hearth":     dict(c="ffd27a", m=0.0, r=0.10, e="ffb040", es=4.0),
}
def hexc(h): return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
MATS = {}
def material(name):
    if name in MATS: return MATS[name]
    d = MAT_DEF[name]; m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*[c ** 2.2 for c in hexc(d['c'])], 1)
    b.inputs['Metallic'].default_value = d['m']; b.inputs['Roughness'].default_value = d['r']
    if 'e' in d:
        b.inputs['Emission Color'].default_value = (*[c ** 2.2 for c in hexc(d['e'])], 1)
        b.inputs['Emission Strength'].default_value = d['es']
    if 'a' in d:
        b.inputs['Alpha'].default_value = d['a']; m.blend_method = 'BLEND'
        try: m.surface_render_method = 'BLENDED'
        except Exception: pass
    MATS[name] = m; return m

# ------------------------------------------------------------------ scene helpers
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
ROOT = bpy.data.objects.new('Wyrmspout', None); SC.collection.objects.link(ROOT)
def empty(name, loc, parent=ROOT):
    o = bpy.data.objects.new(name, None); o.empty_display_size = .01; SC.collection.objects.link(o)
    o.parent = parent; o.location = Vector(loc) - (world_of(parent)); return o
def world_of(o):
    if o is ROOT: return Vector()
    bpy.context.view_layer.update(); return o.matrix_world.translation.copy()
def mesh_obj(name, bm, mat, parent=ROOT, flat=True, origin=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = not flat
    me.materials.append(material(mat))
    o = bpy.data.objects.new(name, me); SC.collection.objects.link(o)
    off = Vector(origin) if origin is not None else Vector()
    if off.length: me.transform(Matrix.Translation(-off))
    o.parent = parent; o.location = off - world_of(parent)
    return o

def loft(sections, cap0=True, cap1=True):
    """sections: list of rings (same vertex count) of Vector. Quads between rings, n-gon caps."""
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in ring] for ring in sections]; n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap0: bm.faces.new(list(reversed(rings[0])))
    if cap1: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def ring_xz(profile, y, cz, cx=0.0):
    """profile: list of (x, z) offsets, counter-clockwise seen from +Y. Ring in the plane y = const."""
    return [Vector((cx + x, y, cz + z)) for x, z in profile]

def coffin(w, top, bot, chamfer=.55, low=.45):
    """Crisp 8-sided head/neck section: flat brow, angled cheeks, narrow chin."""
    return [(chamfer * w, top), (w, top * .30), (w * .82, -bot * low), (w * .40, -bot),
            (-w * .40, -bot), (-w * .82, -bot * low), (-w, top * .30), (-chamfer * w, top)][::-1]

def ngon(r, n=8, rz=None, phase=None):
    rz = rz or r; phase = math.pi / n if phase is None else phase
    return [(r * math.cos(phase + TAU * i / n), rz * math.sin(phase + TAU * i / n)) for i in range(n)]

def frame_along(path, i):
    t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
    ref = Vector((1, 0, 0)) if abs(t.x) < .9 else Vector((0, 0, 1))
    n = t.cross(ref).normalized(); b = t.cross(n).normalized()
    return t, n, b

def sweep(path, radii, sides=8, cap=True, squash=1.0):
    """Faceted tube along a polyline, radius per point."""
    secs = []; prev_n = None
    for i, p in enumerate(path):
        t, n, b = frame_along(path, i)
        if prev_n is not None and n.dot(prev_n) < 0: n, b = -n, -b
        prev_n = n; r = radii[i]
        secs.append([p + (n * math.cos(TAU * k / sides) * r) + (b * math.sin(TAU * k / sides) * r * squash) for k in range(sides)])
    return loft(secs, cap, cap)

def bezier(p0, p1, p2, p3, n):
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]

def lathe_y(pts, y0, cz, segs=16, cx=0.0):
    """Revolve (radius, dy) around an axis parallel to Y through (cx, *, cz)."""
    secs = [[Vector((cx + r * math.cos(TAU * k / segs), y0 + dy, cz + r * math.sin(TAU * k / segs))) for k in range(segs)] for r, dy in pts]
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in s] for s in secs]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs; bm.faces.new((a[i], a[j], b[j], b[i]))
    if pts[0][0] > 1e-5: bm.faces.new(list(reversed(rings[0])))
    if pts[-1][0] > 1e-5: bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def box(c, s, bevel=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2])) + Vector(c)
    if bevel: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
    return bm

def cone(base, tip, r, sides=4, roll=0.0):
    axis = (tip - base).normalized(); ref = Vector((1, 0, 0)) if abs(axis.x) < .9 else Vector((0, 0, 1))
    n = axis.cross(ref).normalized(); b = axis.cross(n)
    bm = bmesh.new(); ring = [bm.verts.new(base + (n * math.cos(roll + TAU * k / sides) + b * math.sin(roll + TAU * k / sides)) * r) for k in range(sides)]
    t = bm.verts.new(tip)
    for k in range(sides): bm.faces.new((ring[k], ring[(k + 1) % sides], t))
    bm.faces.new(list(reversed(ring))); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def sphere(c, r, sx=1, sy=1, sz=1, segs=12, rings=8):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz)) + Vector(c)
    return bm

def xform(bm, rot, offset):
    bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(), matrix=rot)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(offset))
    return bm

# ------------------------------------------------------------------ grip, receiver, trigger
GRIP_TILT = math.radians(16)
def grip_axis(t):  # t: 0 bottom .. 1 top
    z = -0.066 + t * 0.108
    return Vector((0, -math.tan(GRIP_TILT) * (z - 0.0), z))
grip_secs = []
for t, w, d in [(0, .0165, .026), (.08, .0185, .029), (.35, .0178, .028), (.62, .0172, .0275), (.88, .0168, .027), (1, .0165, .026)]:
    c = grip_axis(t)
    grip_secs.append([c + Vector((x, y, 0)) for x, y in [(w * .55, d), (w, d * .45), (w, -d * .45), (w * .55, -d), (-w * .55, -d), (-w, -d * .45), (-w, d * .45), (-w * .55, d)]])
mesh_obj('Grip_Walnut', loft(grip_secs), 'Walnut')
# leather wrap: slightly proud band in the middle of the grip
wrap = []
for t in (.22, .26, .70, .74):
    c = grip_axis(t); w, d = .0182 + (.0012 if t in (.26, .70) else 0), .0284 + (.0012 if t in (.26, .70) else 0)
    wrap.append([c + Vector((x, y, 0)) for x, y in [(w * .55, d), (w, d * .45), (w, -d * .45), (w * .55, -d), (-w * .55, -d), (-w, -d * .45), (-w, d * .45), (-w * .55, d)]])
mesh_obj('Grip_Leather', loft(wrap), 'Leather')
# brass pommel claw: a faceted cap with three talons gripping the base of the grip
pc = grip_axis(0)
pommel = lathe_y([(0.0, 0), (.021, 0), (.025, .006), (.021, .013), (0.0, .015)], 0, 0, segs=8)
xform(pommel, Matrix.Rotation(-math.pi / 2 - GRIP_TILT, 3, 'X'), pc + Vector((0, 0, -0.002)))
mesh_obj('Grip_Pommel', pommel, 'Brass')
# receiver: a chamfered steel block between grip and neck, slightly wider at the back where the tank sits
rec = []
for y, w, top, bot in [(-.068, .019, .100, .050), (-.056, .024, .104, .043), (.052, .024, .104, .043), (.094, .024, .101, .054), (.114, .028, .099, .060)]:
    zc = (top + bot) / 2; h = (top - bot) / 2
    rec.append(ring_xz([(w * .7, h), (w, h * .55), (w, -h * .6), (w * .7, -h), (-w * .7, -h), (-w, -h * .6), (-w, h * .55), (-w * .7, h)][::-1], y, zc))
mesh_obj('Receiver', loft(rec), 'WyrmSteel')
# side plates with three rivets each
for s in (-1, 1):
    mesh_obj(f'Receiver_Plate_{"L" if s < 0 else "R"}', box((s * .0252, .0, .074), (.002, .078, .022), .0015), 'PlateSteel')
    for k, y in enumerate((-.03, .0, .03)):
        mesh_obj(f'Rivet_{"L" if s < 0 else "R"}{k}', sphere((s * .0268, y, .074), .0028, sx=.6, segs=8, rings=4), 'Brass', flat=False)

# trigger guard: one forged brass loop from the receiver belly to the grip front
guard = bezier(Vector((0, .064, .044)), Vector((0, .068, -.004)), Vector((0, .044, -.016)), Vector((0, .028, -.012)), 10)
mesh_obj('TriggerGuard', sweep(guard, [.0034] * 10, sides=6, squash=1.6), 'Brass')
trig = bezier(Vector((0, .034, .040)), Vector((0, .040, .026)), Vector((0, .036, .012)), Vector((0, .029, .004)), 6)
mesh_obj('Trigger', sweep(trig, [.0036, .0033, .003, .0027, .0024, .002], sides=6, squash=.6), 'PlateSteel')

# ------------------------------------------------------------------ tank of liquid fire
ty0, ty1 = TANK_Y
mesh_obj('Tank_Glass', lathe_y([(TANK_R * .8, 0), (TANK_R, .004), (TANK_R, ty1 - ty0 - .004), (TANK_R * .8, ty1 - ty0)], ty0, TANK_Z, segs=20), 'TankGlass', flat=False)
liquid_floor = Vector((0, (ty0 + ty1) / 2, TANK_Z - LIQUID_R))
mesh_obj('FuelLiquid', lathe_y([(LIQUID_R * .85, .003), (LIQUID_R, .006), (LIQUID_R, ty1 - ty0 - .006), (LIQUID_R * .85, ty1 - ty0 - .003)], ty0, TANK_Z, segs=16),
         'LiquidFire', flat=False, origin=liquid_floor)
for k, (y, flip) in enumerate(((ty0, -1), (ty1, 1))):
    cap = lathe_y([(0, 0), (TANK_R * .55, 0), (TANK_R + .004, .002 * flip * 0), (TANK_R + .0045, .006 * flip), (TANK_R + .002, .012 * flip), (0, .013 * flip)][::(1 if flip > 0 else -1)],
                  y + (-.0005 * flip), TANK_Z, segs=8)
    mesh_obj(f'Tank_Cap_{"Rear" if flip < 0 else "Front"}', cap, 'Brass')
for k, a in enumerate((math.pi / 2, math.pi / 2 + 1.25, math.pi / 2 - 1.25)):
    x, z = math.cos(a) * (TANK_R + .0022), math.sin(a) * (TANK_R + .0022)
    mesh_obj(f'Tank_Bar_{k}', box((x, (ty0 + ty1) / 2, TANK_Z + z), (.0036, ty1 - ty0 + .006, .0036), .0008), 'DarkBrass')
# saddle that clamps the tank to the receiver
for y in (-.022, .060):
    mesh_obj(f'Tank_Saddle_{0 if y < 0 else 1}', box((0, y, (TANK_Z - TANK_R + .102) / 2), (.03, .012, TANK_Z - TANK_R - .102 + .008), .002), 'WyrmSteel')
# pressure gauge on the rear cap, facing the player (needle animated at runtime: rotate about Y)
gauge_c = Vector((0, TANK_Y[0] - .014, TANK_Z))
g = bmesh.new(); bmesh.ops.create_cone(g, cap_ends=True, segments=12, radius1=.0175, radius2=.0160, depth=.008)
xform(g, Matrix.Rotation(math.pi / 2, 3, 'X'), gauge_c)
mesh_obj('Gauge_Body', g, 'Brass', flat=False)
f = bmesh.new(); bmesh.ops.create_circle(f, cap_ends=True, segments=16, radius=.0140)
xform(f, Matrix.Rotation(math.pi / 2, 3, 'X'), gauge_c + Vector((0, -.0042, 0)))
mesh_obj('Gauge_Face', f, 'Ivory')
for k in range(5):  # tick marks from empty (left) to full (right)
    a = math.radians(-120 + 60 * k); c = gauge_c + Vector((math.sin(a) * .0112, -.0045, math.cos(a) * .0112))
    mesh_obj(f'Gauge_Tick_{k}', box(c, (.0012, .0006, .0012)), 'LiquidFire' if k == 4 else 'Soot')
needle_pivot = gauge_c + Vector((0, -.0050, 0))
mesh_obj('Gauge_Needle', box(needle_pivot + Vector((0, 0, .0048)), (.0014, .0008, .0105)), 'Soot', origin=needle_pivot)
mesh_obj('Gauge_Hub', sphere(needle_pivot, .0018, segs=8, rings=4), 'Brass', flat=False)
# feed pipe from the tank's front cap down into the neck
pipe = bezier(Vector((0, ty1 + .010, TANK_Z - .010)), Vector((0, ty1 + .03, TANK_Z - .012)), Vector((0, .128, .118)), Vector((0, .146, .104)), 8)
mesh_obj('Feed_Pipe', sweep(pipe, [.0058] * 8, sides=8), 'Brass', flat=False)

# ------------------------------------------------------------------ neck: three armoured rings
neck_parent = empty('Neck', (0, .11, AXIS_Z))
neck_secs = [ring_xz(ngon(r, 8, r * .92), y, AXIS_Z) for y, r in ((.106, .025), (.196, .029))]
mesh_obj('Neck_Scales', loft(neck_secs), 'WyrmSteel')
for k, (y0, y1, r) in enumerate(((.104, .140, .0290), (.132, .168, .0310), (.160, .196, .0330))):
    secs = [ring_xz(ngon(r * .86, 8, r * .80), y0, AXIS_Z), ring_xz(ngon(r, 8, r * .93), y1 - .006, AXIS_Z + .001), ring_xz(ngon(r * .97, 8, r * .9), y1, AXIS_Z + .001)]
    mesh_obj(f'Neck_Ring_{k + 1}', loft(secs), 'PlateSteel')
    mesh_obj(f'Neck_BrassBand_{k + 1}', loft([ring_xz(ngon(r * 1.015, 8, r * .945), y1 - .0045, AXIS_Z + .001), ring_xz(ngon(r * 1.015, 8, r * .945), y1 - .0015, AXIS_Z + .001)]), 'Brass')
    # dorsal heat spine on each ring
    base = Vector((0, (y0 + y1) / 2, AXIS_Z + r * .9))
    sp = bmesh.new(); vs = [sp.verts.new(v) for v in (base + Vector((0, -.016, 0)), base + Vector((0, .014, 0)), base + Vector((0, -.012, .018 + .003 * k)))]
    sp.faces.new(vs); bmesh.ops.solidify(sp, geom=list(sp.faces), thickness=.003); bmesh.ops.translate(sp, verts=sp.verts, vec=Vector((.0015, 0, 0)))
    mesh_obj(f'HeatSpine_{k + 1:02d}', sp, 'DarkBrass')

# ------------------------------------------------------------------ head
head = empty('Head', (0, .21, AXIS_Z))
skull_sections = [  # y, width, top, bottom, centre z
    (.190, .032, .034, .014, .084), (.206, .043, .046, .014, .088), (.226, .047, .049, .012, .089),
    (.250, .041, .038, .010, .086), (.276, .033, .027, .008, .082), (.302, .027, .021, .007, .080),
    (.326, .027, .021, .007, .081), (.344, .021, .015, .006, .080), (.350, .016, .010, .005, .079)]
mesh_obj('Head_Skull', loft([ring_xz(coffin(w, t, b), y, cz) for y, w, t, b, cz in skull_sections]), 'WyrmSteel', parent=head)
# snout plate and brow ridges (crisp brass wedges; the brows give him a cheeky look)
mesh_obj('Snout_BrassPlate', loft([ring_xz(coffin(.010, .004, .002), y, cz) for y, cz in ((.268, .1115), (.300, .1035), (.322, .1035), (.344, .0975))]), 'Brass', parent=head)
for s, side in ((-1, 'Left'), (1, 'Right')):
    brow = [Vector((s * .018, .206, .140)), Vector((s * .050, .214, .130)), Vector((s * .044, .246, .124)), Vector((s * .020, .238, .133))]
    b = bmesh.new(); vs = [b.verts.new(v) for v in brow]; b.faces.new(vs if s > 0 else vs[::-1])
    bmesh.ops.solidify(b, geom=list(b.faces), thickness=.005)
    mesh_obj(f'Brow_{side}', b, 'Brass', parent=head)
    eye = empty(f'Eye{side}', (s * .041, .232, .112), parent=head)
    mesh_obj(f'Eye{side}_Globe', sphere((s * .041, .232, .112), .0105, segs=14, rings=8), 'EmberGlass', parent=eye, flat=False)
    mesh_obj(f'Eye{side}_Pupil', sphere((s * .0508, .234, .112), .0032, sx=.5, sy=.7, sz=2.2, segs=8, rings=6), 'Pupil', parent=eye, flat=False)
    rim = bmesh.new(); bmesh.ops.create_cone(rim, cap_ends=False, segments=8, radius1=.0135, radius2=.0118, depth=.004)
    bmesh.ops.rotate(rim, verts=rim.verts, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y') @ Matrix.Rotation(-.25 * s, 3, 'Z'))
    bmesh.ops.translate(rim, verts=rim.verts, vec=Vector((s * .0442, .232, .112)))
    mesh_obj(f'Eye{side}_SocketRim', rim, 'Brass', parent=head)
    # swept-back horns over the tank
    hp = bezier(Vector((s * .026, .204, .124)), Vector((s * .040, .182, .146)), Vector((s * .056, .150, .150)), Vector((s * .064, .124, .166)), 9)
    mesh_obj(f'Horn_{"L" if s < 0 else "R"}', sweep(hp, [.0085, .0078, .0068, .0058, .0048, .0038, .0028, .0018, .0006], sides=5), 'Horn', parent=head)
    # cheek gills: three slanted brass vents (heat readout)
    for k in range(3):
        y = .200 - k * .010
        v = box((s * (.0400 - k * .0030), y, .086), (.004, .0045, .022 - k * .003), .0006)
        mesh_obj(f'HeatVent_{"L" if s < 0 else "R"}{k + 1}', v, 'DarkBrass', parent=head)
    # nostril
    mesh_obj(f'Nostril_{"L" if s < 0 else "R"}', sphere((s * .011, .334, .0935), .0032, sx=1.2, sz=.6, segs=8, rings=4), 'Soot', parent=head, flat=False)
    # upper fangs
    for k, y in enumerate((.282, .306, .330)):
        base = Vector((s * (.024 - k * .003), y, .074))
        mesh_obj(f'Fang_Upper_{"L" if s < 0 else "R"}{k + 1}', cone(base, base + Vector((0, .002, -.012 + k * .002)), .0034, sides=4), 'Ivory', parent=head)
# throat (soot inside the mouth) and the brass spout
mesh_obj('Mouth_Throat', loft([ring_xz(coffin(w, .006, .006), y, .070) for y, w in ((.23, .010), (.28, .017), (.338, .015))]), 'Soot', parent=head)
mesh_obj('Muzzle_Spout', lathe_y([(.0055, 0), (.0085, .010), (.0100, .022), (.0118, .028), (.0108, .030), (.0070, .030)], MUZZLE.y - .032, MUZZLE.z, segs=10), 'Brass', parent=head)
core = empty('EmberCore', (0, MUZZLE.y - .006, MUZZLE.z), parent=head)
mesh_obj('EmberCore_Glow', sphere((0, MUZZLE.y - .006, MUZZLE.z), .0055, segs=8, rings=6), 'Hearth', parent=core, flat=False)

# jaw: hinged under the cheeks, drops open while spraying
jaw = empty('Jaw', JAW_HINGE, parent=head)
jaw_sections = [(.194, .030, .004, .012, .062), (.226, .034, .004, .017, .060), (.270, .028, .004, .013, .060), (.316, .022, .004, .010, .061), (.344, .016, .003, .007, .063)]
mesh_obj('Jaw_Scales', loft([ring_xz(coffin(w, t, b, chamfer=.8, low=.6), y, cz) for y, w, t, b, cz in jaw_sections]), 'WyrmSteel', parent=jaw)
for s in (-1, 1):
    pin = bmesh.new(); bmesh.ops.create_cone(pin, cap_ends=True, segments=8, radius1=.0065, radius2=.0065, depth=.006)
    bmesh.ops.rotate(pin, verts=pin.verts, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    bmesh.ops.translate(pin, verts=pin.verts, vec=Vector((s * .032, JAW_HINGE.y, JAW_HINGE.z)))
    mesh_obj(f'Jaw_HingePin_{"L" if s < 0 else "R"}', pin, 'Brass', parent=jaw, flat=False)
    for k, y in enumerate((.290, .318)):
        base = Vector((s * (.018 - k * .003), y, .063))
        mesh_obj(f'Fang_Lower_{"L" if s < 0 else "R"}{k + 1}', cone(base, base + Vector((0, -.001, .010)), .003, sides=4), 'Ivory', parent=jaw)
# chin barbel plate
mesh_obj('Jaw_ChinPlate', box((0, .300, .051), (.012, .03, .003), .001), 'Brass', parent=jaw)

# ------------------------------------------------------------------ tail curling round behind the hand
tail = bezier(Vector((0, -.062, .074)), Vector((0, -.108, .072)), Vector((0, -.098, .004)), Vector((0, -.026, .010)), 12)
radii = [.0175 - .0105 * (i / 11) ** .9 for i in range(12)]
mesh_obj('Tail', sweep(tail, radii, sides=8, squash=.9), 'WyrmSteel')
for k, i in enumerate((2, 5, 8)):
    t, n, b = frame_along(tail, i)
    mesh_obj(f'Tail_Band_{k}', sweep([tail[i] - t * .002, tail[i] + t * .002], [radii[i] * 1.12] * 2, sides=8), 'Brass')

# ------------------------------------------------------------------ sockets
grip_anchor = empty('GripAnchor', (0, 0, 0))
muzzle = empty('Muzzle', MUZZLE)

# ------------------------------------------------------------------ merge for the web
# One mesh per material per moving part keeps the draw count low on phones and Quest. Nodes the runtime
# animates or reads by name stay separate.
KEEP = {'FuelLiquid', 'Gauge_Needle', 'EmberCore_Glow', 'Neck_Scales', 'Trigger', 'Tank_Glass'} | {f'HeatVent_{s}{k}' for s in 'LR' for k in (1, 2, 3)}
def merge_children(parent):
    by_mat = {}
    for o in list(SC.objects):
        if o.type == 'MESH' and o.parent is parent and o.name not in KEEP and not o.name.startswith('Review_'):
            by_mat.setdefault(o.data.materials[0].name, []).append(o)
    for mat, objs in by_mat.items():
        if len(objs) < 2: continue
        with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
            bpy.ops.object.join()
        objs[0].name = f'{parent.name}_{mat}'; objs[0].data.name = objs[0].name
if '--firing' not in ARGS:
    for parent in (ROOT, head, jaw, bpy.data.objects['EyeLeft'], bpy.data.objects['EyeRight']): merge_children(parent)

# ------------------------------------------------------------------ checks
def tri_count():
    n = 0
    for o in SC.objects:
        if o.type == 'MESH': n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n
def bounds():
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in SC.objects:
        if o.type != 'MESH': continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi
bpy.context.view_layer.update()
lo, hi = bounds()
REPORT = {'triangles': tri_count(), 'objects': sum(1 for o in SC.objects if o.type == 'MESH'),
          'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi],
          'muzzle': list(MUZZLE), 'jaw_hinge': list(JAW_HINGE)}
assert REPORT['triangles'] < 12000, REPORT
front = [o.name for o in SC.objects if o.type == 'MESH' and max((o.matrix_world @ v.co).y for v in o.data.vertices) > MUZZLE.y + .002]
assert not front, f'nothing may sit in front of the spout: {front}'

# ------------------------------------------------------------------ export
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False,
                          export_materials='EXPORT', export_normals=True, export_texcoords=False, export_extras=False)
REPORT['bytes'] = os.path.getsize(OUT); REPORT['seconds'] = round(time.time() - T0, 2)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps(REPORT))

# ------------------------------------------------------------------ optional review renders
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 64)); SC.cycles.device = 'CPU'
    SC.render.resolution_x, SC.render.resolution_y = 1100, 760
    SC.view_settings.view_transform = 'Standard'
    if '--firing' in ARGS:  # review only: jaw open and a mock stream of sticky fire (the game draws its own)
        jaw.rotation_euler.x = math.radians(-22)
        L = .62; pts = [MUZZLE + Vector((0, L * t, .10 * t - .32 * t * t)) for t in (i / 19 * .62 for i in range(20))]
        mesh_obj('Review_Stream', sweep(pts, [.005 + .008 * (i / 19) ** .8 for i in range(20)], sides=10), 'LiquidFire', flat=False)
        import random; rnd = random.Random(4)
        for k in range(30):
            t = .58 + rnd.random() * .42; c = MUZZLE + Vector((rnd.uniform(-.09, .09) * t, L * t, .10 * t - .32 * t * t + rnd.uniform(-.02, .02)))
            mesh_obj(f'Review_Glob_{k}', sphere(c, .004 + .009 * rnd.random(), sy=1.8, segs=10, rings=6), 'LiquidFire', flat=False)
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (.30, .34, .40, 1); bg.inputs[1].default_value = .55
    def light(loc, e, s=.4, col=(1, 1, 1)):
        l = bpy.data.lights.new('l', 'AREA'); l.energy = e; l.size = s; l.color = col
        o = bpy.data.objects.new('l', l); o.location = loc; SC.collection.objects.link(o)
        o.rotation_euler = (Vector((0, .15, .08)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light((.6, -.35, .7), 55); light((-.7, .45, .35), 22, col=(.8, .88, 1)); light((0, .9, -.3), 10, col=(1, .7, .45)); light((-.2, -.8, .3), 18)
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    views = {'three-quarter': ((.62, -.18, .30), (0, .14, .075), 58), 'side': ((.9, .15, .07), (0, .15, .055), 62),
             'front-left': ((-.55, .62, .22), (0, .17, .08), 55), 'first-person': ((-.13, -.30, .25), (0, .30, .06), 40)}
    if '--firing' in ARGS: views = {'firing': ((.72, .30, .26), (0, .42, .05), 34), 'firing-fps': ((-.13, -.30, .25), (0, .6, .02), 40)}
    for name, (loc, at, lens) in views.items():
        cam.lens = lens; co.location = loc; co.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
