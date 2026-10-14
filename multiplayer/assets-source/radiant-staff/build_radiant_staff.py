"""Sunthread, the Radiant staff - reproducible Blender (bpy 4.5) builder.

Run:  python3.11 build_radiant_staff.py -- [--out path.glb] [--render dir] [--samples 48] [--views a,b]

Identity: a tall, sleek healer's staff in the Sunlit direction. A pearl-white enamel shaft, faceted like the pick,
wound with a thin gold sun-thread that glows; a sky-blue leather grip between gold bands; a flared gold collar from
which two swept gold blades rise and cradle a sunburst halo. In the halo floats a faceted sun crystal that is the
light source of the whole staff (the runtime hangs the staff's one real light and its glow on it). Three small sky-blue
resonance stones sit on the halo so the magic still reads as Brann's Forge blue.

Frame: Blender (X right, Y forward, Z up), metres. The shaft runs along +Z; glTF export makes that +Y up and -Z forward.
GripAnchor is the origin (centre of the hand). Runtime node contract:
  GripAnchor, Crown (empty at the crystal centre; the light, glow and beam start here), SunCore (the crystal; spins and
  bobs), Halo (empty; the ring, rays and stones turn slowly around the crown's forward axis), Foot (the butt tip).
Materials are named for client/radiant-staff-look.js: Enamel, Gold, GripLeather, Sunstone, ThreadGlow, HaloGlow,
Skystone.
"""
import bpy, bmesh, math, json, os, sys, time
from mathutils import Vector, Matrix

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
OUT = arg('--out', os.path.join(HERE, 'out', 'staff.glb'))
RENDER = arg('--render')
TAU = math.tau

# ------------------------------------------------------------------ dimensions (shared with runtime)
FOOT_Z = -0.56
SHAFT_TOP = 0.625
COLLAR = (0.625, 0.705)
CROWN = Vector((0.0, 0.0, 0.875))      # crystal centre = light origin
HALO_R = 0.088

# ------------------------------------------------------------------ materials
MAT_DEF = {
    "Enamel":      dict(c="f3eee4", m=0.0, r=0.28),
    "Gold":        dict(c="e9b64c", m=1.0, r=0.24),
    "GripLeather": dict(c="2f6fcf", m=0.0, r=0.58),
    "Sunstone":    dict(c="fff1c4", m=0.0, r=0.08, e="ffd37a", es=3.2),
    "ThreadGlow":  dict(c="ffe39a", m=0.0, r=0.2, e="ffc24a", es=1.6),
    "HaloGlow":    dict(c="fff2c8", m=0.0, r=0.1, e="ffd060", es=3.0),
    "Skystone":    dict(c="7fe6ff", m=0.0, r=0.1, e="22c3d6", es=2.0),
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
    MATS[name] = m; return m

# ------------------------------------------------------------------ scene helpers
bpy.ops.wm.read_factory_settings(use_empty=True)
SC = bpy.context.scene
ROOT = bpy.data.objects.new('RadiantStaff', None); SC.collection.objects.link(ROOT)
def world_of(o):
    if o is ROOT: return Vector()
    bpy.context.view_layer.update(); return o.matrix_world.translation.copy()
def empty(name, loc, parent=ROOT):
    o = bpy.data.objects.new(name, None); o.empty_display_size = .01; SC.collection.objects.link(o)
    o.parent = parent; o.location = Vector(loc) - world_of(parent); return o
def mesh_obj(name, bm, mat, parent=ROOT, flat=False, sharp=34, subsurf=0):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = not flat
    me.materials.append(material(mat))
    o = bpy.data.objects.new(name, me); SC.collection.objects.link(o)
    off = world_of(parent)
    if off.length: me.transform(Matrix.Translation(-off))
    o.parent = parent
    if subsurf:
        mod = o.modifiers.new('sub', 'SUBSURF'); mod.levels = mod.render_levels = subsurf
        with bpy.context.temp_override(object=o, active_object=o):
            bpy.ops.object.modifier_apply(modifier='sub')
        for p in o.data.polygons: p.use_smooth = True
    if not flat and sharp and hasattr(o.data, 'set_sharp_from_angle'): o.data.set_sharp_from_angle(angle=math.radians(sharp))
    return o

def loft(sections, cap0=True, cap1=True, crease_cols=()):
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in ring] for ring in sections]; n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap0: bm.faces.new(list(reversed(rings[0])))
    if cap1: bm.faces.new(rings[-1])
    if crease_cols:
        layer = bm.edges.layers.float.get('crease_edge') or bm.edges.layers.float.new('crease_edge')
        for a, b in zip(rings, rings[1:]):
            for c in crease_cols:
                e = bm.edges.get((a[c], b[c]))
                if e: e[layer] = 1.0
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def lathe_z(pts, segs=16, phase=0.0, c=Vector()):
    """pts: (radius, z). A solid of revolution around +Z."""
    secs = [[c + Vector((r * math.cos(phase + TAU * k / segs), r * math.sin(phase + TAU * k / segs), z)) for k in range(segs)] for r, z in pts]
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in s] for s in secs]
    for a, b in zip(rings, rings[1:]):
        for i in range(segs):
            j = (i + 1) % segs; bm.faces.new((a[i], a[j], b[j], b[i]))
    if pts[0][0] > 1e-5: bm.faces.new(list(reversed(rings[0])))
    if pts[-1][0] > 1e-5: bm.faces.new(rings[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-7)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm

def frame_along(path, i):
    t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
    ref = Vector((0, 1, 0)) if abs(t.y) < .9 else Vector((1, 0, 0))
    n = t.cross(ref).normalized(); b = t.cross(n).normalized()
    return t, n, b

def sweep(path, radii, sides=8, cap=True, squash=1.0, roll=0.0):
    secs = []; prev_n = None
    for i, p in enumerate(path):
        t, n, b = frame_along(path, i)
        if prev_n is not None and n.dot(prev_n) < 0: n, b = -n, -b
        prev_n = n; r = radii[i]
        secs.append([p + n * math.cos(roll + TAU * k / sides) * r + b * math.sin(roll + TAU * k / sides) * r * squash for k in range(sides)])
    return loft(secs, cap, cap)

def bezier(p0, p1, p2, p3, n):
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]

def merge(*bms):
    out = bmesh.new()
    for bm in bms:
        me = bpy.data.meshes.new('tmp'); bm.to_mesh(me); bm.free(); out.from_mesh(me); bpy.data.meshes.remove(me)
    return out

def xform(bm, m):
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    return bm

# ------------------------------------------------------------------ shaft: faceted enamel, tapering toward the foot
def octa(r, z, chamfer=.18):
    """A chamfered octagon (16 points): crisp facets that still catch a highlight on the bevel."""
    pts = []
    for k in range(8):
        a0 = TAU * k / 8 + TAU / 16; a1 = TAU * (k + 1) / 8 + TAU / 16
        p0 = Vector((math.cos(a0), math.sin(a0))); p1 = Vector((math.cos(a1), math.sin(a1)))
        for t in (chamfer, 1 - chamfer):
            q = p0.lerp(p1, t) * r; pts.append(Vector((q.x, q.y, z)))
    return pts
shaft_z = [FOOT_Z + .03, -.30, -.12, .12, .34, .52, SHAFT_TOP]
shaft_r = [.0135, .0150, .0158, .0160, .0168, .0178, .0188]
mesh_obj('Shaft', loft([octa(r, z) for r, z in zip(shaft_r, shaft_z)]), 'Enamel', sharp=30)

# the sun-thread: a fine glowing helix let into the enamel above the grip
helix = []; turns = 3.25; z0, z1 = .14, .60
for i in range(118):
    t = i / 117; z = z0 + (z1 - z0) * t; r = .0158 + (.0186 - .0158) * t + .0008
    a = TAU * turns * t; helix.append(Vector((r * math.cos(a), r * math.sin(a), z)))
mesh_obj('SunThread', sweep(helix, [.0016] * len(helix), sides=5), 'ThreadGlow', sharp=0)
# fine gold pinstripes on two facets, below the grip (reads at gameplay distance as a clean line)
for s in (-1, 1):
    a = TAU / 16 + (0 if s > 0 else math.pi)
    line = [Vector((math.cos(a) * .0152, math.sin(a) * .0152, z)) for z in (-.47, -.14)]
    mesh_obj('Stripe', sweep([line[0], line[0].lerp(line[1], .5), line[1]], [.0011] * 3, sides=4), 'Gold', sharp=0)

# grip: sky-blue wrap in proud bands between two gold rings
grip = []
z = -.105
while z < .105:
    grip += [(.0195, z), (.0212, z + .006), (.0212, z + .016), (.0195, z + .022)]; z += .022
mesh_obj('Grip', lathe_z(grip, segs=16), 'GripLeather', sharp=40)
for zc in (-.118, .118):
    mesh_obj('GripRing', lathe_z([(.0172, zc - .011), (.0232, zc - .008), (.0240, zc), (.0232, zc + .008), (.0172, zc + .011)], segs=16), 'Gold', sharp=40)
mesh_obj('MidRing', lathe_z([(.0164, .118 + .19), (.0200, .118 + .196), (.0200, .118 + .204), (.0164, .118 + .21)], segs=16), 'Gold', sharp=40)

# foot: gold ferrule with a faceted sunstone point
mesh_obj('Ferrule', lathe_z([(.0150, FOOT_Z + .095), (.0185, FOOT_Z + .085), (.0185, FOOT_Z + .060), (.0150, FOOT_Z + .035), (.0130, FOOT_Z + .020), (.0105, FOOT_Z + .012)], segs=8, phase=TAU / 16), 'Gold', sharp=30)
mesh_obj('FootGem', lathe_z([(.0100, FOOT_Z + .014), (.0060, FOOT_Z + .004), (0.0, FOOT_Z - .010)], segs=8, phase=TAU / 16), 'Sunstone', flat=True)
empty('Foot', (0, 0, FOOT_Z - .010))

# collar: a flared gold cup that the blades grow out of
mesh_obj('Collar', lathe_z([(.0186, COLLAR[0] - .006), (.0230, COLLAR[0]), (.0215, COLLAR[0] + .018), (.0235, COLLAR[0] + .030),
                            (.0290, COLLAR[0] + .052), (.0330, COLLAR[1]), (.0250, COLLAR[1] + .004), (.0150, COLLAR[1] + .006)], segs=16), 'Gold', sharp=36)
mesh_obj('CollarGem', lathe_z([(.0, COLLAR[1] - .004), (.0110, COLLAR[1] + .012), (.0090, COLLAR[1] + .026), (.0, COLLAR[1] + .036)], segs=8), 'Sunstone', flat=True)

# two swept blades: out of the collar, round the halo, flicking up past it like a lyre
def blade(side):
    s = side
    base = Vector((s * .024, 0, COLLAR[1] - .01))
    R = HALO_R + .0175
    p = bezier(base, Vector((s * .060, 0, COLLAR[1] + .000)), Vector((s * (R + .012), 0, CROWN.z - .085)), Vector((s * R, 0, CROWN.z - .012)), 18)
    p += bezier(Vector((s * R, 0, CROWN.z - .012)), Vector((s * (R - .006), 0, CROWN.z + .060)), Vector((s * .074, 0, CROWN.z + .112)), Vector((s * .036, 0, CROWN.z + .150)), 14)[1:]
    n = len(p); radii = [.0112 * (1 - .62 * (i / (n - 1)) ** 1.3) + .0012 for i in range(n)]
    return sweep(p, radii, sides=6, squash=.62, roll=math.pi / 2)
mesh_obj('Blades', merge(blade(-1), blade(1)), 'Gold', sharp=28)
# gold bridges: the blades clasp the halo at three and nine o'clock
bridges = []
for sx in (-1, 1):
    c = CROWN + Vector((sx * (HALO_R + .009), 0, -.004))
    bridges.append(lathe_z([(.0, -.012), (.0085, -.006), (.0085, .006), (.0, .012)], segs=8, c=c))
mesh_obj('Clasps', merge(*bridges), 'Gold', sharp=40)
# blade tips: small sunstone beads
mesh_obj('TipGems', merge(*[lathe_z([(.0, -.008), (.0062, -.001), (.0, .009)], segs=6, c=Vector((sx * .036, 0, CROWN.z + .152))) for sx in (-1, 1)]), 'Sunstone', flat=True)

# ------------------------------------------------------------------ crown: halo, rays, stones, sun crystal
crown = empty('Crown', CROWN)
halo = empty('Halo', CROWN, parent=crown)
def ring(r, tube, segs=40, sides=8, y=0.0, squash=1.0):
    """A torus around the crown's forward (Y) axis; squash > 1 makes the band deeper front-to-back."""
    secs = []
    for i in range(segs):
        a = TAU * i / segs; out = Vector((math.cos(a), 0, math.sin(a)))
        secs.append([CROWN + out * (r + tube * math.cos(TAU * k / sides + TAU / sides / 2)) + Vector((0, y + tube * squash * math.sin(TAU * k / sides + TAU / sides / 2), 0)) for k in range(sides)])
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in s] for s in secs]
    for i in range(segs):
        A = rings[i]; B = rings[(i + 1) % segs]
        for k in range(sides): bm.faces.new((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
mesh_obj('HaloRing', ring(HALO_R, .0072, segs=48, sides=6, squash=1.7), 'Gold', parent=halo, sharp=40)
mesh_obj('HaloLight', ring(HALO_R - .0105, .0019, segs=48, sides=5), 'HaloGlow', parent=halo, sharp=0)
def ray(a, length, width):
    """A flat, slightly bevelled sun blade: wide where it meets the halo, a crisp point outward."""
    d = Vector((math.cos(a), 0, math.sin(a))); side = Vector((-d.z, 0, d.x)); r0 = HALO_R + .006
    outline = [CROWN + d * r0 + side * width, CROWN + d * (r0 + length * .45) + side * width * .55, CROWN + d * (r0 + length),
               CROWN + d * (r0 + length * .45) - side * width * .55, CROWN + d * r0 - side * width]
    t = .0026; bm = bmesh.new()
    F = [bm.verts.new(v - Vector((0, t, 0))) for v in outline]; B = [bm.verts.new(v + Vector((0, t, 0))) for v in outline]
    n = len(outline)
    def face(vs, want):
        f = bm.faces.new(vs); f.normal_update()
        if f.normal.dot(want) < 0: f.normal_flip()
    face(F, Vector((0, -1, 0))); face(B, Vector((0, 1, 0)))
    mid = sum(outline, Vector()) / n
    for i in range(n):
        j = (i + 1) % n; out = ((outline[i] + outline[j]) / 2 - mid)
        face([F[i], F[j], B[j], B[i]], out)
    return bm
rays = []
for k in range(16):
    a = TAU * k / 16 + TAU / 32
    if math.sin(a) < -.35: continue            # leave the bottom open where the blades come in
    major = k % 2 == 0
    rays.append(ray(a, .040 if major else .022, .0115 if major else .0075))
mesh_obj('Rays', merge(*rays), 'Gold', parent=halo, flat=True)
stones = []
for k in range(3):
    a = math.pi / 2 + TAU * k / 3
    c = CROWN + Vector((math.cos(a) * HALO_R, 0, math.sin(a) * HALO_R))
    g = lathe_z([(.0, -.014), (.0092, -.003), (.0078, .005), (.0, .015)], segs=6, c=Vector())
    xform(g, Matrix.Translation(c) @ Matrix.Rotation(a - math.pi / 2, 4, 'Y') @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    stones.append(g)
    setting = lathe_z([(.0118, -.0062), (.0118, .0062)], segs=12, c=Vector())
    xform(setting, Matrix.Translation(c) @ Matrix.Rotation(math.pi / 2, 4, 'X'))
    stones.append(setting)
st = mesh_obj('Stones', merge(*stones[0::2]), 'Skystone', parent=halo, flat=True)
mesh_obj('Settings', merge(*stones[1::2]), 'Gold', parent=halo, sharp=40)
# the sun crystal: a long faceted bipyramid with a girdle; spins on its own axis at runtime
core = lathe_z([(.0, -.056), (.0195, -.013), (.0240, -.002), (.0240, .005), (.0190, .016), (.0, .064)], segs=8, phase=TAU / 16, c=CROWN)
mesh_obj('SunCore', core, 'Sunstone', parent=crown, flat=True)
empty('BeamOrigin', CROWN + Vector((0, .03, 0)), parent=crown)
empty('GripAnchor', (0, 0, 0))

# ------------------------------------------------------------------ merge for the web
KEEP = {'SunCore'}
def merge_children(parent):
    by_mat = {}
    for o in list(SC.objects):
        if o.type == 'MESH' and o.parent is parent and o.name not in KEEP:
            by_mat.setdefault(o.data.materials[0].name, []).append(o)
    for mat, objs in by_mat.items():
        if len(objs) < 2: continue
        with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
            bpy.ops.object.join()
        objs[0].name = f'{parent.name}_{mat}'; objs[0].data.name = objs[0].name
for parent in [o for o in SC.objects if o.type == 'EMPTY'] + [ROOT]: merge_children(parent)

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
REPORT = {'triangles': tri_count(), 'meshes': sum(1 for o in SC.objects if o.type == 'MESH'), 'nodes': len(SC.objects),
          'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi], 'crown': list(CROWN), 'halo_r': HALO_R}
assert REPORT['triangles'] < 8000, REPORT
for name in ('GripAnchor', 'Crown', 'SunCore', 'Halo', 'Foot', 'BeamOrigin'): assert name in bpy.data.objects, name

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_yup=True, export_apply=False,
                          export_materials='EXPORT', export_normals=True, export_texcoords=False, export_extras=False)
REPORT['bytes'] = os.path.getsize(OUT); REPORT['seconds'] = round(time.time() - T0, 2)
os.makedirs(os.path.join(HERE, 'out'), exist_ok=True)
with open(os.path.join(HERE, 'out', 'build_report.json'), 'w') as fh: json.dump(REPORT, fh, indent=2)
print(json.dumps(REPORT))

# ------------------------------------------------------------------ optional review renders
if RENDER:
    os.makedirs(RENDER, exist_ok=True)
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 48)); SC.cycles.device = 'CPU'
    SC.render.resolution_x, SC.render.resolution_y = 900, 1100
    SC.view_settings.view_transform = 'AgX'
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (.42, .62, .92, 1); bg.inputs[1].default_value = .6
    def light(loc, e, s=.6, col=(1, 1, 1)):
        l = bpy.data.lights.new('l', 'AREA'); l.energy = e; l.size = s; l.color = col
        o = bpy.data.objects.new('l', l); o.location = loc; SC.collection.objects.link(o)
        o.rotation_euler = (Vector((0, 0, .3)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    light((1.2, -1.0, 1.6), 260, col=(1, .93, .8)); light((-1.3, .6, .6), 90, col=(.7, .82, 1)); light((0, 1.4, 1.2), 60)
    sun = bpy.data.lights.new('core', 'POINT'); sun.energy = 6; sun.color = (1, .85, .55); sun.shadow_soft_size = .02
    so = bpy.data.objects.new('core', sun); so.location = CROWN; SC.collection.objects.link(so)
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    views = {'full': ((1.9, -2.6, .55), (0, 0, .16), 50), 'crown': ((.32, -.48, 1.0), (0, 0, .84), 60),
             'crown-front': ((0, -.55, .92), (0, 0, .86), 70), 'grip': ((.25, -.32, .05), (0, 0, .0), 60),
             'first-person': ((-.22, -.42, .12), (0, .1, .70), 32)}
    only = arg('--views'); views = {k: v for k, v in views.items() if not only or k in only.split(',')}
    for name, (loc, at, lens) in views.items():
        cam.lens = lens; co.location = loc; co.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(RENDER, f'{name}.png'); bpy.ops.render.render(write_still=True)
