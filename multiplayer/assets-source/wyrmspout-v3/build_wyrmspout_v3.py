"""Wyrmspout III - reproducible Blender (bpy 4.5) builder.

Run:  python3.11 build_wyrmspout_v3.py -- [--out path.glb] [--render dir] [--samples 48] [--firing]

Identity: the same small forged wyrm that spits sticky fire, with a proper dragon's head: a sculpted skull
with a crest and deep-set ember eyes under heavy brows that sweep back into ribbed horns, layered snout
scutes, cheek frills, a toothy hinged jaw and a brass nozzle in its throat. The glass tank of liquid fire on
its back is held by brass claws, and the weapon tells you how it is doing in its own body:
  * the Wyrm's Eye on the tank's rear cap faces you: a wide round pupil means a full tank, a thin slit means
    nearly dry, and the eye shuts while the tank refills, opening as it fills back up;
  * three dorsal fins on the neck light their veins one by one as Gout recharges;
  * flames flicker in its nostrils when Gout is ready;
  * the liquid itself sloshes in the glass (the runtime clips a closed volume against a moving surface).

Frame: Blender (X right, Y forward, Z up), metres. glTF export turns +Y forward into -Z forward, which is what
client/asset-pose.js expects. GripAnchor is the origin (centre of the hand). Runtime node contract:
  GripAnchor, Muzzle, Head, Jaw (rotate X to open), FuelLiquid (closed volume, origin at the tank centre, axis along
  the barrel), EyeGauge (Eye_Pupil scale X = pupil width; Eye_LidUpper/Eye_LidLower rest open and roll toward 0 to
  shut), Eye_Glow, FinVein_1..3 (scale Z = charge), NostrilFlame_L/R (scale = Gout ready), EmberCore, and the
  HeatVent_L1..3/R1..3 markers on the cheek gills. Materials are named for client/wyrmspout-look.js. Static parts are
  merged per material per moving part (37 meshes).
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
AXIS_Z = 0.080            # neck centre line
MUZZLE = Vector((0.0, 0.352, 0.071))
TANK_Y = (-0.040, 0.080); TANK_Z = 0.124; TANK_R = 0.027; LIQUID_R = 0.0236
JAW_HINGE = Vector((0.0, 0.202, 0.066))
EYE_C = Vector((0.0, TANK_Y[0] - .0165, TANK_Z))     # the Wyrm's Eye gauge, facing the player

# ------------------------------------------------------------------ materials
# Display colours (sRGB hex). Steel is blued and dark; brass is warm and polished; glows are display-referred.
MAT_DEF = {
    "WyrmSteel":  dict(c="232a33", m=1.0, r=0.36),
    "WyrmHide":   dict(c="1f5c52", m=0.55, r=0.34),
    "ScaleSteel": dict(c="1d3634", m=0.8, r=0.30),
    "Brass":      dict(c="c89640", m=1.0, r=0.26),
    "DarkBrass":  dict(c="7d5628", m=1.0, r=0.38),
    "Walnut":     dict(c="4a2614", m=0.0, r=0.42),
    "Leather":    dict(c="2a120c", m=0.0, r=0.64),
    "Ivory":      dict(c="efe4c8", m=0.0, r=0.34),
    "Horn":       dict(c="cdb48c", m=0.0, r=0.38),
    "HornTip":    dict(c="2a1d16", m=0.0, r=0.30),
    "Membrane":   dict(c="a3301e", m=0.0, r=0.50),
    "Soot":       dict(c="120c0a", m=0.0, r=0.85),
    "EmberGlass": dict(c="ffb23a", m=0.0, r=0.10, e="ff8a1a", es=2.4),
    "IrisGlow":   dict(c="ffc04a", m=0.0, r=0.12, e="ffa020", es=2.6),
    "VeinGlow":   dict(c="ff9a2a", m=0.0, r=0.20, e="ff7a10", es=3.0),
    "FlameGlow":  dict(c="ffd27a", m=0.0, r=0.10, e="ffb040", es=4.0),
    "Pupil":      dict(c="080605", m=0.0, r=0.20),
    "TankGlass":  dict(c="f2f6ff", m=0.0, r=0.02, a=0.10),
    "LiquidFire": dict(c="ff6a10", m=0.0, r=0.16, e="ff5a10", es=1.6),
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
def world_of(o):
    if o is ROOT: return Vector()
    bpy.context.view_layer.update(); return o.matrix_world.translation.copy()
def empty(name, loc, parent=ROOT):
    o = bpy.data.objects.new(name, None); o.empty_display_size = .01; SC.collection.objects.link(o)
    o.parent = parent; o.location = Vector(loc) - world_of(parent); return o
def mesh_obj(name, bm, mat, parent=ROOT, flat=True, origin=None, subsurf=0):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = not flat
    me.materials.append(material(mat))
    o = bpy.data.objects.new(name, me); SC.collection.objects.link(o)
    off = Vector(origin) if origin is not None else Vector()
    if off.length: me.transform(Matrix.Translation(-off))
    o.parent = parent; o.location = off - world_of(parent)
    if subsurf:
        mod = o.modifiers.new('sub', 'SUBSURF'); mod.levels = mod.render_levels = subsurf
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier='sub')
        for p in o.data.polygons: p.use_smooth = True
        o.data.set_sharp_from_angle(angle=math.radians(38)) if hasattr(o.data, 'set_sharp_from_angle') else None
    return o

def loft(sections, cap0=True, cap1=True, crease_cols=()):
    """sections: rings (same vertex count) of Vector. Quads between rings, n-gon caps. crease_cols: ring
    indices whose lengthwise edges stay crisp under subdivision (ridges, brows)."""
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in ring] for ring in sections]; n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap0: bm.faces.new(list(reversed(rings[0])))
    if cap1: bm.faces.new(rings[-1])
    if crease_cols:
        bm.edges.ensure_lookup_table()
        layer = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
        for a, b in zip(rings, rings[1:]):
            for c in crease_cols:
                e = bm.edges.get((a[c], b[c]))
                if e: e[layer] = 1.0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def ring_xz(profile, y, cz, cx=0.0):
    return [Vector((cx + x, y, cz + z)) for x, z in profile]

def skull_ring(w, t, b):
    """14-point dragon-skull section, counter-clockwise from +Y: crest, brow shelf, brow edge, cheek, jaw line."""
    half = [(.30 * w, .98 * t), (.70 * w, .80 * t), (.97 * w, .42 * t), (1.0 * w, .02 * t), (.86 * w, -.55 * b), (.42 * w, -1.0 * b)]
    pts = [(0, t)] + half + [(0, -b)] + [(-x, z) for x, z in reversed(half)]
    return pts[::-1]
SKULL_CREASE = (13 - 2, 13 - 3, 2, 3)   # brow edge and cheek ridge on both sides (indices after reversal)

def ngon(r, n=8, rz=None, phase=None):
    rz = rz or r; phase = math.pi / n if phase is None else phase
    return [(r * math.cos(phase + TAU * i / n), rz * math.sin(phase + TAU * i / n)) for i in range(n)]

def frame_along(path, i):
    t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
    ref = Vector((1, 0, 0)) if abs(t.x) < .9 else Vector((0, 0, 1))
    n = t.cross(ref).normalized(); b = t.cross(n).normalized()
    return t, n, b

def sweep(path, radii, sides=8, cap=True, squash=1.0, twist=0.0):
    secs = []; prev_n = None
    for i, p in enumerate(path):
        t, n, b = frame_along(path, i)
        if prev_n is not None and n.dot(prev_n) < 0: n, b = -n, -b
        prev_n = n; r = radii[i]; a0 = twist * i
        secs.append([p + (n * math.cos(a0 + TAU * k / sides) * r) + (b * math.sin(a0 + TAU * k / sides) * r * squash) for k in range(sides)])
    return loft(secs, cap, cap)

def bezier(p0, p1, p2, p3, n):
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]

def lathe_y(pts, y0, cz, segs=16, cx=0.0, caps=True):
    secs = [[Vector((cx + r * math.cos(TAU * k / segs), y0 + dy, cz + r * math.sin(TAU * k / segs))) for k in range(segs)] for r, dy in pts]
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in s] for s in secs]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs; bm.faces.new((a[i], a[j], b[j], b[i]))
    if caps and pts[0][0] > 1e-5: bm.faces.new(list(reversed(rings[0])))
    if caps and pts[-1][0] > 1e-5: bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def box(c, s, bevel=0.0):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts: v.co = Vector((v.co.x * s[0], v.co.y * s[1], v.co.z * s[2])) + Vector(c)
    if bevel: bmesh.ops.bevel(bm, geom=list(bm.edges), offset=bevel, segments=1, affect='EDGES')
    return bm

def cone(base, tip, r, sides=4, roll=0.0, squash=1.0):
    axis = (tip - base).normalized(); ref = Vector((1, 0, 0)) if abs(axis.x) < .9 else Vector((0, 0, 1))
    n = axis.cross(ref).normalized(); b = axis.cross(n)
    bm = bmesh.new(); ring = [bm.verts.new(base + (n * math.cos(roll + TAU * k / sides) + b * math.sin(roll + TAU * k / sides) * squash) * r) for k in range(sides)]
    t = bm.verts.new(tip)
    for k in range(sides): bm.faces.new((ring[k], ring[(k + 1) % sides], t))
    bm.faces.new(list(reversed(ring))); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def sphere(c, r, sx=1, sy=1, sz=1, segs=12, rings=8):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz)) + Vector(c)
    return bm

def disc_y(c, r, segs=16, depth=0.0, rx=None):
    """A flat disc (or short cylinder) facing -Y (toward the player)."""
    bm = bmesh.new(); rx = rx or r
    if depth:
        bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=1, radius2=1, depth=depth)
    else:
        bmesh.ops.create_circle(bm, cap_ends=True, segments=segs, radius=1)
    for v in bm.verts: v.co = Vector((v.co.x * rx, v.co.y * r, v.co.z))
    bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'X'))
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def plate(pts, thick, flip=False):
    """A solid plate from a planar outline."""
    bm = bmesh.new(); vs = [bm.verts.new(v) for v in (pts[::-1] if flip else pts)]; bm.faces.new(vs)
    bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=thick)
    bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def xform(bm, rot, offset):
    bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(), matrix=rot)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(offset))
    return bm

SIDES = ((-1, 'L'), (1, 'R'))

# ------------------------------------------------------------------ grip, receiver, trigger
GRIP_TILT = math.radians(16)
def grip_axis(t):
    z = -0.066 + t * 0.108
    return Vector((0, -math.tan(GRIP_TILT) * z, z))
def grip_ring(c, w, d):
    return [c + Vector((x, y, 0)) for x, y in [(w * .55, d), (w, d * .45), (w, -d * .45), (w * .55, -d), (-w * .55, -d), (-w, -d * .45), (-w, d * .45), (-w * .55, d)]]
mesh_obj('Grip_Walnut', loft([grip_ring(grip_axis(t), w, d) for t, w, d in [(0, .0165, .026), (.08, .0185, .029), (.35, .0178, .028), (.62, .0172, .0275), (.88, .0168, .027), (1, .0165, .026)]]), 'Walnut')
# leather wrap in three proud bands
for k, (a, b) in enumerate(((.16, .30), (.36, .50), (.56, .70))):
    rings = []
    for t, up in ((a, 0), (a + .02, 1), (b - .02, 1), (b, 0)):
        rings.append(grip_ring(grip_axis(t), .0181 + .0011 * up, .0283 + .0011 * up))
    mesh_obj(f'Grip_Leather_{k}', loft(rings), 'Leather')
# brass pommel: a dragon's claw clutching a dark pearl
pc = grip_axis(0)
pommel = lathe_y([(0.0, 0), (.021, 0), (.025, .006), (.021, .013), (0.0, .015)], 0, 0, segs=8)
xform(pommel, Matrix.Rotation(-math.pi / 2 - GRIP_TILT, 3, 'X'), pc + Vector((0, 0, -0.002)))
mesh_obj('Grip_Pommel', pommel, 'Brass')
for k in range(3):
    a = TAU * k / 3 + .5
    base = pc + Vector((math.cos(a) * .018, math.sin(a) * .018 * .9, -.006))
    mesh_obj(f'Pommel_Talon_{k}', cone(base, pc + Vector((math.cos(a) * .010, math.sin(a) * .009, -.020)), .0035, sides=4), 'DarkBrass')
mesh_obj('Pommel_Pearl', sphere(pc + Vector((0, 0, -.016)), .0085, segs=10, rings=6), 'Soot', flat=False)

# receiver: chamfered blued-steel block, with brass-edged side plates engraved with scale rows
rec = []
for y, w, top, bot in [(-.068, .019, .100, .050), (-.056, .024, .104, .043), (.052, .024, .104, .043), (.094, .024, .101, .054), (.114, .028, .099, .060)]:
    zc = (top + bot) / 2; h = (top - bot) / 2
    rec.append(ring_xz([(w * .7, h), (w, h * .55), (w, -h * .6), (w * .7, -h), (-w * .7, -h), (-w, -h * .6), (-w, h * .55), (-w * .7, h)][::-1], y, zc))
mesh_obj('Receiver', loft(rec), 'WyrmSteel')
for s, side in SIDES:
    mesh_obj(f'Receiver_Plate_{side}', box((s * .0252, .0, .074), (.002, .084, .024), .0012), 'ScaleSteel')
    mesh_obj(f'Receiver_PlateRim_{side}', box((s * .0249, .0, .074), (.0016, .090, .028), .0008), 'DarkBrass')
    # engraved scales: three staggered rows of domed brass scale studs, overlapping like a wyrm's flank
    for row, z in enumerate((.0815, .0740, .0665)):
        for k in range(7 - row % 2):
            y = -.036 + k * .0115 + (row % 2) * .0058
            mesh_obj(f'Receiver_Scale_{side}{row}{k}', sphere((s * .0262, y, z), .0044, sx=.22, sy=.85, sz=.9, segs=6, rings=3), 'DarkBrass' if row == 1 else 'Brass', flat=False)

guard = bezier(Vector((0, .064, .044)), Vector((0, .068, -.004)), Vector((0, .044, -.016)), Vector((0, .028, -.012)), 10)
mesh_obj('TriggerGuard', sweep(guard, [.0034] * 10, sides=6, squash=1.6), 'Brass')
trig = bezier(Vector((0, .034, .040)), Vector((0, .040, .026)), Vector((0, .036, .012)), Vector((0, .029, .004)), 6)
mesh_obj('Trigger', sweep(trig, [.0036, .0033, .003, .0027, .0024, .002], sides=6, squash=.6), 'ScaleSteel')

# ------------------------------------------------------------------ tank of liquid fire
ty0, ty1 = TANK_Y
mesh_obj('Tank_Glass', lathe_y([(TANK_R * .82, 0), (TANK_R, .004), (TANK_R, ty1 - ty0 - .004), (TANK_R * .82, ty1 - ty0)], ty0, TANK_Z, segs=24), 'TankGlass', flat=False)
# The liquid is a closed volume filling the glass; the runtime clips it at a sloshing surface. Origin: tank centre.
tank_c = Vector((0, (ty0 + ty1) / 2, TANK_Z))
mesh_obj('FuelLiquid', lathe_y([(0, .002), (LIQUID_R * .8, .0025), (LIQUID_R, .006), (LIQUID_R, ty1 - ty0 - .006), (LIQUID_R * .8, ty1 - ty0 - .0025), (0, ty1 - ty0 - .002)], ty0, TANK_Z, segs=20),
         'LiquidFire', flat=False, origin=tank_c)
for y, flip in ((ty0, -1), (ty1, 1)):
    cap = lathe_y([(0, 0), (TANK_R * .55, 0), (TANK_R + .0045, .002 * flip), (TANK_R + .0052, .007 * flip), (TANK_R + .0025, .013 * flip), (0, .014 * flip)][::(1 if flip > 0 else -1)],
                  y - .0005 * flip, TANK_Z, segs=8)
    mesh_obj(f'Tank_Cap_{"Rear" if flip < 0 else "Front"}', cap, 'Brass')
# two brass claws (three talons each) clutch the glass from the receiver
for y in (-.018, .058):
    mesh_obj(f'Tank_Saddle_{0 if y < 0 else 1}', box((0, y, (TANK_Z - TANK_R + .102) / 2), (.030, .012, TANK_Z - TANK_R - .102 + .008), .002), 'WyrmSteel')
    for s, side in SIDES:
        for k, dy in enumerate((-.006, 0, .006)):
            a0, a1 = -math.pi / 2 - s * .55, -math.pi / 2 - s * (1.75 - .1 * abs(dy) * 100)
            pts = []
            for i in range(7):
                a = a0 + (a1 - a0) * i / 6; r = TANK_R + .0028
                pts.append(Vector((math.cos(a) * r * -1 if s < 0 else math.cos(a) * r, y + dy, TANK_Z + math.sin(a) * r)))
            pts = [Vector((-abs(p.x) if s < 0 else abs(p.x), p.y, p.z)) for p in pts]
            mesh_obj(f'Tank_Talon_{side}{0 if y < 0 else 1}{k}', sweep(pts, [.0026 - .0003 * i for i in range(7)], sides=5), 'Brass')
# feed pipe from the front cap into the neck
pipe = bezier(Vector((0, ty1 + .012, TANK_Z - .010)), Vector((0, ty1 + .03, TANK_Z - .012)), Vector((0, .128, .118)), Vector((0, .146, .104)), 8)
mesh_obj('Feed_Pipe', sweep(pipe, [.0058] * 8, sides=8), 'Brass', flat=False)

# ------------------------------------------------------------------ the Wyrm's Eye (fuel gauge on the rear cap)
eye_root = empty('EyeGauge', EYE_C)
mesh_obj('Eye_Bezel', lathe_y([(.0150, .0), (.0198, .0015), (.0212, .0055), (.0196, .0090), (.0150, .0095)], EYE_C.y - .0095 + .004, EYE_C.z, segs=16, caps=False), 'Brass', parent=ROOT, flat=False)
mesh_obj('Eye_Socket', disc_y(EYE_C + Vector((0, .0010, 0)), .0152, segs=20, depth=.004), 'Soot', parent=ROOT, flat=False)
mesh_obj('Eye_Iris', disc_y(EYE_C + Vector((0, -.0012, 0)), .0128, segs=24, depth=.0012), 'IrisGlow', parent=ROOT, flat=False)
# iris rays: a ring of fine darker spokes give it a reptile's depth
for k in range(12):
    a = TAU * k / 12
    c = EYE_C + Vector((math.cos(a) * .0088, -.0020, math.sin(a) * .0088))
    b = box(c, (.0010, .0004, .0040)); xform(b, Matrix.Identity(3), Vector())
    bm = box(Vector(), (.0009, .0004, .0042)); xform(bm, Matrix.Rotation(-a + math.pi / 2, 3, 'Y'), c)
    mesh_obj(f'Eye_Ray_{k}', bm, 'DarkBrass')
glow = empty('Eye_Glow', EYE_C + Vector((0, -.0016, 0)), parent=eye_root)
mesh_obj('Eye_GlowCore', disc_y(EYE_C + Vector((0, -.0016, 0)), .0060, segs=16, depth=.0006), 'FlameGlow', parent=glow, flat=False)
# The pupil: a vertical slit whose width is the fuel (scale X: ~2.4 full and round, ~0.35 a dry slit).
pupil_root = empty('Eye_Pupil', EYE_C + Vector((0, -.0026, 0)), parent=eye_root)
mesh_obj('Eye_PupilMesh', disc_y(EYE_C + Vector((0, -.0026, 0)), .0110, segs=16, depth=.0008, rx=.0034), 'Pupil', parent=pupil_root, flat=False)
mesh_obj('Eye_Dome', lathe_y([(.0150, 0), (.0135, -.0025), (.0095, -.0042), (0, -.0050)], EYE_C.y - .0006, EYE_C.z, segs=16), 'TankGlass', parent=ROOT, flat=False)
# Eyelids: two scaled shells on a sphere centred behind the eye, so turning them about X slides them over the dome like
# a real lid. Authored meeting in the middle; the exported rest pose is open (each rolled back 30 deg, a hooded,
# slightly sleepy look). The runtime rolls them toward 0 to shut.
LID_C = EYE_C + Vector((0, .017, 0)); LID_R = .0262; LID_OPEN = math.radians(26)
for name, sgn in (('Eye_LidUpper', 1), ('Eye_LidLower', -1)):
    lid = empty(name, LID_C, parent=eye_root)
    # rings of constant angle from the eye's axis, half circles on the lid's side
    bm = bmesh.new(); grid = []
    for i in range(7):
        a = math.asin(.0168 / LID_R) * (.02 + .98 * i / 6)        # angle from the -Y axis
        ring = []
        for k in range(11):
            th = math.pi * k / 10
            ring.append(LID_C + Vector((math.cos(th) * math.sin(a), -math.cos(a), sgn * math.sin(th) * math.sin(a))) * (LID_R + .0004))
        grid.append(ring)
    # the meeting edge is a straight line across: flatten the first ring onto z = 0
    for k in range(11):
        v = grid[0][k]; grid[0][k] = Vector((LID_C.x + math.cos(math.pi * k / 10) * .0168, v.y, LID_C.z))
    outer = [[bm.verts.new(v) for v in ring] for ring in grid]
    inner = [[bm.verts.new(LID_C + (v - LID_C) * ((LID_R - .0014) / (v - LID_C).length)) for v in ring] for ring in grid]
    for g in (outer, inner):
        for a, b in zip(g, g[1:]):
            for k in range(10):
                q = (a[k], a[k + 1], b[k + 1], b[k])
                bm.faces.new(q if (g is outer) == (sgn > 0) else q[::-1])
    for k in range(10):                     # close the meeting edge and the outer rim
        for ring_o, ring_i in ((outer[0], inner[0]), (outer[-1], inner[-1])):
            bm.faces.new((ring_o[k], ring_i[k], ring_i[k + 1], ring_o[k + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_obj(f'{name}_Shell', bm, 'ScaleSteel', parent=lid, flat=False)
    # brass lash rim along the meeting edge, and three little scale ridges across the lid
    mesh_obj(f'{name}_Rim', sweep([v + Vector((0, -.0006, 0)) for v in grid[0][1:-1]], [.0010] * 9, sides=4), 'Brass', parent=lid)
    for j in (2, 4):
        mesh_obj(f'{name}_Ridge{j}', sweep([LID_C + (v - LID_C) * ((LID_R + .0006) / (v - LID_C).length) for v in grid[j][1:-1]], [.0006] * 9, sides=4), 'Brass', parent=lid)
    lid.rotation_euler.x = -sgn * LID_OPEN   # open; the runtime rolls toward 0 to shut

# ------------------------------------------------------------------ neck: armoured rings, dorsal fins (Gout charge)
neck_secs = [ring_xz(ngon(r, 8, r * .92), y, AXIS_Z) for y, r in ((.106, .025), (.196, .029))]
mesh_obj('Neck_Scales', loft(neck_secs), 'WyrmHide')
for k, (y0, y1, r) in enumerate(((.104, .134, .0285), (.126, .156, .0300), (.148, .178, .0316), (.170, .198, .0332))):
    secs = [ring_xz(ngon(r * .86, 8, r * .80), y0, AXIS_Z), ring_xz(ngon(r, 8, r * .93), y1 - .005, AXIS_Z + .001), ring_xz(ngon(r * .97, 8, r * .9), y1, AXIS_Z + .001)]
    mesh_obj(f'Neck_Ring_{k + 1}', loft(secs), 'ScaleSteel')
    mesh_obj(f'Neck_BrassBand_{k + 1}', loft([ring_xz(ngon(r * 1.015, 8, r * .945), y1 - .0040, AXIS_Z + .001), ring_xz(ngon(r * 1.015, 8, r * .945), y1 - .0012, AXIS_Z + .001)]), 'Brass')
# three swept dorsal fins; their veins fill with light as Gout recharges (FinVein_k scale Z 0..1)
for k, (y, h) in enumerate(((.118, .020), (.142, .024), (.166, .027))):
    r = .0295 + k * .0016; base_z = AXIS_Z + r * .88
    empty(f'Fin_{k + 1}', (0, y, base_z)); fin_root = ROOT   # marker; the static fin merges with the body
    outline = [Vector((0, y - .016, base_z)), Vector((0, y + .012, base_z)), Vector((0, y + .004, base_z + h * .55)), Vector((0, y - .010, base_z + h)), Vector((0, y - .012, base_z + h * .55))]
    bm = plate(outline, .0030); bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((.0015, 0, 0)))
    mesh_obj(f'Fin_{k + 1}_Blade', bm, 'Membrane', parent=fin_root)
    mesh_obj(f'Fin_{k + 1}_Edge', sweep([outline[1], outline[2], outline[3]], [.0011] * 3, sides=4), 'Brass', parent=fin_root)
    spine = bezier(Vector((0, y + .001, base_z - .001)), Vector((0, y + .001, base_z + h * .35)), Vector((0, y - .004, base_z + h * .62)), Vector((0, y - .009, base_z + h * .90)), 6)
    mesh_obj(f'Fin_{k + 1}_Channel', sweep(spine, [.0021, .0020, .0018, .0015, .0012, .0008], sides=6, squash=.95), 'Soot', parent=fin_root)
    vein = empty(f'FinVein_{k + 1}', spine[0])   # scale Z grows the light up from the root
    mesh_obj(f'FinVein_{k + 1}_Glow', sweep(spine, [.0024, .0023, .0021, .0018, .0014, .0009], sides=6, squash=.95), 'VeinGlow', parent=vein)

# ------------------------------------------------------------------ head
head = empty('Head', (0, .21, AXIS_Z))
skull = [  # y, half width, top, bottom, centre z
    (.188, .029, .030, .014, .086), (.198, .039, .041, .014, .088), (.212, .046, .049, .013, .089),
    (.228, .048, .048, .012, .089), (.246, .043, .039, .011, .087), (.266, .035, .030, .009, .084),
    (.288, .029, .024, .008, .082), (.310, .027, .022, .008, .082), (.328, .026, .021, .008, .082),
    (.342, .022, .016, .007, .081), (.351, .014, .010, .006, .080)]
mesh_obj('Head_Skull', loft([ring_xz(skull_ring(w, t, b), y, cz) for y, w, t, b, cz in skull], crease_cols=SKULL_CREASE), 'WyrmHide', parent=head, subsurf=1)
# crest: a row of low brass-capped scutes down the skull's midline and along the snout
for k in range(7):
    y = .200 + k * .021; t = [s for s in skull if s[0] >= y - .011][0]; z = t[4] + t[2] * .99
    sz = .0088 - .0007 * k
    mesh_obj(f'Crest_{k}', cone(Vector((0, y - sz * 1.6, z - .001)), Vector((0, y + sz * .8, z + sz * 1.1)), sz, sides=3, roll=math.pi / 2, squash=.45), 'ScaleSteel' if k % 2 else 'Brass', parent=head)
# snout scutes: overlapping plates on the nose bridge
for k, y in enumerate((.268, .286, .304, .322)):
    t = [s for s in skull if s[0] >= y][0]; z = t[4] + t[2] * .93
    mesh_obj(f'Snout_Scute_{k}', box((0, y, z), (.020 - k * .0016, .016, .0032), .0012), 'ScaleSteel', parent=head)
    mesh_obj(f'Snout_ScuteEdge_{k}', box((0, y + .0075, z + .0004), (.020 - k * .0016, .0016, .0034), .0006), 'Brass', parent=head)
for s, side in SIDES:
    # heavy brow: an angular plate over the eye that sweeps back into the horn root
    brow = [Vector((s * .014, .244, .128)), Vector((s * .042, .242, .124)), Vector((s * .057, .222, .127)), Vector((s * .052, .198, .138)), Vector((s * .024, .200, .144))]
    mesh_obj(f'Brow_{side}', plate(brow, .008, flip=s < 0), 'ScaleSteel', parent=head)
    mesh_obj(f'Brow_{side}_Edge', sweep(brow[:3], [.0016] * 3, sides=4), 'Brass', parent=head)
    # deep-set ember eye
    mesh_obj(f'Eye{side}_Socket', sphere((s * .041, .226, .112), .0128, sx=.7, segs=12, rings=8), 'Soot', parent=head, flat=False)
    mesh_obj(f'Eye{side}_Globe', sphere((s * .044, .227, .112), .0100, sx=.85, sy=1.15, segs=14, rings=8), 'EmberGlass', parent=head, flat=False)
    mesh_obj(f'Eye{side}_Pupil', sphere((s * .0524, .229, .112), .0028, sx=.5, sy=.8, sz=2.6, segs=8, rings=6), 'Soot', parent=head, flat=False)
    # main horns: ribbed ivory, sweeping back and up over the tank, dark tips
    hp = bezier(Vector((s * .032, .206, .134)), Vector((s * .048, .184, .156)), Vector((s * .058, .156, .160)), Vector((s * .060, .132, .170)), 12)
    radii = [.0118 - .0094 * (i / 11) ** .8 for i in range(12)]
    mesh_obj(f'Horn_{side}', sweep(hp, radii, sides=6, twist=.18), 'Horn', parent=head)
    mesh_obj(f'Horn_{side}_Tip', cone(hp[-2], hp[-1] + (hp[-1] - hp[-2]) * 1.2, radii[-2], sides=6), 'HornTip', parent=head)
    for i in (2, 5):
        t, n, b = frame_along(hp, i)
        mesh_obj(f'Horn_{side}_Ring{i}', sweep([hp[i] - t * .0016, hp[i] + t * .0016], [radii[i] * 1.16] * 2, sides=6), 'Brass', parent=head)
    # small cheek horns
    cp = bezier(Vector((s * .045, .206, .092)), Vector((s * .056, .192, .094)), Vector((s * .064, .176, .092)), Vector((s * .070, .162, .088)), 6)
    mesh_obj(f'CheekHorn_{side}', sweep(cp, [.0046, .004, .0033, .0025, .0016, .0005], sides=5), 'Horn', parent=head)
    # cheek frill: a crimson membrane on three brass ribs, behind the jaw hinge
    root = Vector((s * .040, .200, .082))
    tips = [Vector((s * .064, .168, .112)), Vector((s * .074, .160, .088)), Vector((s * .066, .166, .062))]
    fr = bmesh.new(); r0 = fr.verts.new(root); tv = [fr.verts.new(t) for t in tips]
    mids = [fr.verts.new(tips[i].lerp(tips[i + 1], .5) + Vector((s * .004, -.006, 0))) for i in range(2)]
    for i in range(2):
        f = (r0, tv[i], mids[i]) if s > 0 else (r0, mids[i], tv[i]); fr.faces.new(f)
        f = (r0, mids[i], tv[i + 1]) if s > 0 else (r0, tv[i + 1], mids[i]); fr.faces.new(f)
    bmesh.ops.solidify(fr, geom=list(fr.faces), thickness=.0016)
    mesh_obj(f'Frill_{side}', fr, 'Membrane', parent=head)
    for i, t in enumerate(tips):
        mesh_obj(f'Frill_{side}_Rib{i}', sweep([root, root.lerp(t, .5) + Vector((s * .002, 0, 0)), t], [.0018, .0014, .0007], sides=4), 'Brass', parent=head)
    # cheek vents (heat readout anchors for weapon-readiness): three slanted gills under the eye
    for k in range(3):
        y = .214 - k * .010
        mesh_obj(f'Gill_{side}{k + 1}', box((s * (.0455 - k * .0020), y, .090), (.004, .0040, .016 - k * .002), .0006), 'DarkBrass', parent=head)
        empty(f'HeatVent_{side}{k + 1}', (s * (.0455 - k * .0020), y, .090), parent=head)
    # nostrils, each with a small flame that shows when Gout is ready (scale 0..1)
    n_c = Vector((s * .0118, .336, .0985))
    mesh_obj(f'Nostril_{side}', sphere(n_c, .0036, sx=1.2, sz=.65, segs=8, rings=4), 'Soot', parent=head, flat=False)
    flame = empty(f'NostrilFlame_{side}', n_c + Vector((0, .001, .002)), parent=head)
    mesh_obj(f'NostrilFlame_{side}_Glow', cone(n_c + Vector((0, .001, .0005)), n_c + Vector((s * .002, -.004, .012)), .0026, sides=6), 'FlameGlow', parent=flame)
    # upper teeth: five per side, the front fang longest
    for k, y in enumerate((.262, .280, .298, .316, .334)):
        base = Vector((s * (.0245 - k * .0022), y, .0745))
        ln = .0085 + (.004 if k == 3 else 0)
        mesh_obj(f'Tooth_Upper_{side}{k}', cone(base, base + Vector((0, .0015, -ln)), .0028, sides=4), 'Ivory', parent=head)
# lip line plates along the upper jaw (brass edging where the mouth closes)
for s, side in SIDES:
    lip = [Vector((s * .036, .214, .077)), Vector((s * .031, .250, .0765)), Vector((s * .027, .300, .0765)), Vector((s * .020, .346, .0755))]
    mesh_obj(f'Lip_{side}', sweep(lip, [.0018] * 4, sides=4), 'Brass', parent=head)
# throat and the brass nozzle (its flared lip is the frontmost point of the weapon)
mesh_obj('Mouth_Throat', loft([ring_xz(skull_ring(w, .006, .006), y, .070) for y, w in ((.23, .010), (.28, .017), (.338, .015))]), 'Soot', parent=head)
mesh_obj('Muzzle_Spout', lathe_y([(.0055, 0), (.0080, .010), (.0094, .020), (.0124, .028), (.0114, .030), (.0074, .030)], MUZZLE.y - .032, MUZZLE.z, segs=12), 'Brass', parent=head)
core = empty('EmberCore', (0, MUZZLE.y - .006, MUZZLE.z), parent=head)
mesh_obj('EmberCore_Glow', sphere((0, MUZZLE.y - .006, MUZZLE.z), .0055, segs=8, rings=6), 'Hearth', parent=core, flat=False)

# jaw: hinged under the cheeks
jaw = empty('Jaw', JAW_HINGE, parent=head)
jaw_sections = [(.194, .030, .004, .012, .062), (.226, .035, .004, .018, .060), (.262, .031, .004, .015, .060), (.300, .025, .004, .011, .061), (.330, .020, .004, .009, .062), (.346, .014, .003, .006, .063)]
jaw_ring = lambda w, t, b: [(.6 * w, t), (w, t * .2), (.85 * w, -b * .5), (.35 * w, -b), (-.35 * w, -b), (-.85 * w, -b * .5), (-w, t * .2), (-.6 * w, t)][::-1]
mesh_obj('Jaw_Scales', loft([ring_xz(jaw_ring(w, t, b), y, cz) for y, w, t, b, cz in jaw_sections], crease_cols=(1, 6)), 'WyrmHide', parent=jaw, subsurf=1)
for s, side in SIDES:
    pin = bmesh.new(); bmesh.ops.create_cone(pin, cap_ends=True, segments=8, radius1=.0062, radius2=.0062, depth=.006)
    bmesh.ops.rotate(pin, verts=pin.verts, cent=Vector(), matrix=Matrix.Rotation(math.pi / 2, 3, 'Y'))
    bmesh.ops.translate(pin, verts=pin.verts, vec=Vector((s * .033, JAW_HINGE.y, JAW_HINGE.z)))
    mesh_obj(f'Jaw_HingePin_{side}', pin, 'Brass', parent=jaw, flat=False)
    for k, y in enumerate((.272, .294, .316, .336)):
        base = Vector((s * (.0205 - k * .0022), y, .0635))
        mesh_obj(f'Tooth_Lower_{side}{k}', cone(base, base + Vector((0, -.001, .0085 + (.003 if k == 1 else 0))), .0026, sides=4), 'Ivory', parent=jaw)
    # chin barbels: two short brass-tipped whiskers
    bp = bezier(Vector((s * .010, .330, .055)), Vector((s * .016, .320, .042)), Vector((s * .020, .306, .036)), Vector((s * .024, .292, .034)), 5)
    mesh_obj(f'Barbel_{side}', sweep(bp, [.0022, .0019, .0015, .0010, .0004], sides=4), 'Ivory', parent=jaw)
mesh_obj('Jaw_ChinPlate', box((0, .304, .0505), (.013, .034, .003), .001), 'Brass', parent=jaw)

# ------------------------------------------------------------------ tail curling round behind the hand
tail = bezier(Vector((0, -.062, .074)), Vector((0, -.108, .072)), Vector((0, -.098, .004)), Vector((0, -.026, .010)), 14)
radii = [.0175 - .0110 * (i / 13) ** .9 for i in range(14)]
mesh_obj('Tail', sweep(tail, radii, sides=8, squash=.9), 'WyrmHide')
for k, i in enumerate((2, 5, 8, 11)):
    t, n, b = frame_along(tail, i)
    mesh_obj(f'Tail_Band_{k}', sweep([tail[i] - t * .002, tail[i] + t * .002], [radii[i] * 1.12] * 2, sides=8), 'Brass')
mesh_obj('Tail_Spade', cone(tail[-1] + Vector((0, -.004, 0)), tail[-1] + Vector((0, .014, -.002)), .0075, sides=4, squash=.3), 'Brass')

# ------------------------------------------------------------------ sockets
empty('GripAnchor', (0, 0, 0))
empty('Muzzle', MUZZLE)

# ------------------------------------------------------------------ merge for the web
# One mesh per material per moving part. Nodes the runtime animates or reads by name stay separate.
KEEP = {'FuelLiquid'}
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
if '--firing' not in ARGS and '--nomerge' not in ARGS:
    parents = [o for o in SC.objects if o.type == 'EMPTY'] + [ROOT]
    for parent in parents: merge_children(parent)

# ------------------------------------------------------------------ checks
def tri_count():
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in SC.objects if o.type == 'MESH')
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
          'nodes': len(SC.objects), 'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi],
          'muzzle': list(MUZZLE), 'jaw_hinge': list(JAW_HINGE), 'eye_gauge': list(EYE_C), 'tank_centre': list(tank_c),
          'liquid_radius': LIQUID_R, 'liquid_length': ty1 - ty0 - .004}
assert REPORT['triangles'] < 14000, REPORT
front = [o.name for o in SC.objects if o.type == 'MESH' and max((o.matrix_world @ v.co).y for v in o.data.vertices) > MUZZLE.y + .002]
assert not front, f'nothing may sit in front of the spout: {front}'
for name in ('FuelLiquid', 'EyeGauge', 'Eye_Pupil', 'Eye_LidUpper', 'Eye_LidLower', 'Eye_Glow', 'Jaw', 'Head', 'EmberCore',
             'NostrilFlame_L', 'NostrilFlame_R', 'Fin_1', 'FinVein_1', 'FinVein_2', 'FinVein_3', 'GripAnchor', 'Muzzle'):
    assert name in bpy.data.objects, name

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
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 48)); SC.cycles.device = 'CPU'
    SC.render.resolution_x, SC.render.resolution_y = 1100, 760
    SC.view_settings.view_transform = 'Standard'
    liquid = bpy.data.objects['FuelLiquid']
    # review only: the runtime clips the liquid volume at a sloshing surface; here a tilted cut at 70% stands in
    cut = bpy.data.objects.new('Review_Cut', None); SC.collection.objects.link(cut)
    mod = liquid.modifiers.new('cut', 'BOOLEAN'); bpy.context.view_layer.update()
    cb = box(tank_c + Vector((0, 0, LIQUID_R * .4 + .05)), (.2, .2, .1)); xform(cb, Matrix.Rotation(math.radians(9), 3, 'Y'), Vector());
    me = bpy.data.meshes.new('Review_Cutter'); cb.to_mesh(me); cutter = bpy.data.objects.new('Review_Cutter', me); SC.collection.objects.link(cutter)
    bmesh_c = None; mod.object = cutter; mod.operation = 'DIFFERENCE'; cutter.hide_render = True
    if '--firing' in ARGS:
        bpy.data.objects['Jaw'].rotation_euler.x = math.radians(-24)
        L = .62; pts = [MUZZLE + Vector((0, L * t, .10 * t - .32 * t * t)) for t in (i / 19 * .62 for i in range(20))]
        mesh_obj('Review_Stream', sweep(pts, [.005 + .008 * (i / 19) ** .8 for i in range(20)], sides=10), 'LiquidFire', flat=False)
    if '--closed' in ARGS:
        bpy.data.objects['Eye_LidUpper'].rotation_euler.x = 0.0; bpy.data.objects['Eye_LidLower'].rotation_euler.x = 0.0
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (.30, .34, .40, 1); bg.inputs[1].default_value = .55
    def light(loc, e, s=.4, col=(1, 1, 1)):
        l = bpy.data.lights.new('l', 'AREA'); l.energy = e; l.size = s; l.color = col
        o = bpy.data.objects.new('l', l); o.location = loc; SC.collection.objects.link(o)
        o.rotation_euler = (Vector((0, .15, .08)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light((.6, -.35, .7), 55); light((-.7, .45, .35), 22, col=(.8, .88, 1)); light((0, .9, -.3), 10, col=(1, .7, .45)); light((-.2, -.8, .3), 18)
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    views = {'three-quarter': ((.62, -.18, .30), (0, .14, .075), 58), 'side': ((.9, .15, .07), (0, .15, .055), 62),
             'head': ((.30, .46, .20), (0, .27, .088), 50), 'front-left': ((-.55, .62, .22), (0, .17, .08), 55),
             'first-person': ((-.13, -.30, .25), (0, .30, .06), 40), 'fins': ((.26, .06, .24), (0, .15, .11), 60), 'eye-gauge': ((-.05, -.20, .16), (0, -.05, .124), 70)}
    if '--firing' in ARGS: views = {'firing': ((.72, .30, .26), (0, .42, .05), 34)}
    if '--closed' in ARGS: views = {'eye-gauge-shut': ((-.05, -.20, .16), (0, -.05, .124), 70)}
    only = arg('--views'); views = {k: v for k, v in views.items() if not only or k in only.split(',')}
    for name, (loc, at, lens) in views.items():
        cam.lens = lens; co.location = loc; co.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
