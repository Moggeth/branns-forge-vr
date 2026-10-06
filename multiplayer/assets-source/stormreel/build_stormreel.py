"""Stormreel kit - reproducible Blender (bpy 4.5+/5.0) builder.

Run:  python3.11 build_stormreel.py -- [--part crossbow|pack|tower|all] [--out-dir DIR] [--render DIR] [--samples N]
      (pip install bpy numpy)

Identity: a lightning crossbow fed from a cable-reel backpack, tethered to a crystal-charged wizard tower.
The kit is built to be electrically coherent, so every piece shows where the current goes:

  Stormspire (tower)  crystals fed into the hopper charge the crystal capacitor in the hat; a Tesla coil winds
                      up the stone shaft to the copper torus brim; four copper earth straps and stakes bond the
                      plinth to the ground (the return path).
  Reel pack           orange rubber-jacketed cable pays out from a sprung drum; slip rings with carbon brushes on
                      the hub keep contact while the drum turns; a fuse box and a blue "live" lamp sit on the frame.
  Stormreel crossbow  the coiled cord plugs into the butt; two glass capacitor tubes fill while you hold; arc
                      horns on top crackle with the charge; every handhold is ribbed black rubber with hazard bands.
                      The bolt trails a fine copper filament from a spool, like a taser probe, so a hit closes the
                      loop: tower -> cable -> crossbow -> filament -> bolt -> target -> ground -> earth stakes.

Frame: Blender (X right, Y forward, Z up), metres. glTF export turns +Y forward into -Z forward.
Contracts (node names the runtime reads) are listed at the top of each part builder.
"""
import bpy, bmesh, math, json, os, sys, time, random
from mathutils import Vector, Matrix

T0 = time.time()
HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(name, default=None):
    return ARGS[ARGS.index(name) + 1] if name in ARGS else default
PART = arg('--part', 'all')
OUT_DIR = arg('--out-dir', os.path.join(HERE, 'out'))
RENDER = arg('--render')
TAU = math.tau

# ------------------------------------------------------------------ materials (shared across the kit)
MAT_DEF = {
    "Steel":      dict(c="2a2e35", m=1.0, r=0.38),
    "PlateSteel": dict(c="3a4049", m=1.0, r=0.30),
    "Copper":     dict(c="d0784a", m=1.0, r=0.26),
    "DarkCopper": dict(c="8c4a2c", m=1.0, r=0.40),
    "Brass":      dict(c="c9973e", m=1.0, r=0.28),
    "Rubber":     dict(c="1b1c1f", m=0.0, r=0.78),
    "Hazard":     dict(c="f2c230", m=0.0, r=0.55),
    "Cable":      dict(c="e8622a", m=0.0, r=0.55),
    "Ceramic":    dict(c="efe8d8", m=0.0, r=0.16),
    "CeramicBlue":dict(c="5d86c8", m=0.0, r=0.12),
    "Glass":      dict(c="e8f4ff", m=0.0, r=0.03, a=0.16),
    "Charge":     dict(c="58c8ff", m=0.0, r=0.10, e="1f9bff", es=1.8),
    "Spark":      dict(c="e6fbff", m=0.0, r=0.10, e="bdf2ff", es=6.0),
    "Crystal":    dict(c="9a6be8", m=0.0, r=0.08, e="7a4fe0", es=1.2),
    "CrystalCore":dict(c="a98cff", m=0.0, r=0.06, e="6f9cff", es=1.1),
    "Stone":      dict(c="9b958a", m=0.0, r=0.82),
    "StoneDark":  dict(c="6f6a62", m=0.0, r=0.86),
    "Slate":      dict(c="2f4a8c", m=0.0, r=0.55),
    "SlateDark":  dict(c="22366a", m=0.0, r=0.60),
    "Wood":       dict(c="6b3f22", m=0.0, r=0.60),
    "Leather":    dict(c="4a2a18", m=0.0, r=0.62),
    "Gold":       dict(c="f0c24a", m=1.0, r=0.22),
    "Soot":       dict(c="141210", m=0.0, r=0.90),
    "Window":     dict(c="bfe9ff", m=0.0, r=0.10, e="5cc6ff", es=1.8),
    "Fletch":     dict(c="3f8fe0", m=0.0, r=0.45),
}
def hexc(h): return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
MATS = {}
def material(name):
    if name in MATS and MATS[name].name in bpy.data.materials: return MATS[name]
    d = MAT_DEF[name]; m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*[c ** 2.2 for c in hexc(d['c'])], 1)
    b.inputs['Metallic'].default_value = d['m']; b.inputs['Roughness'].default_value = d['r']
    if 'e' in d:
        b.inputs['Emission Color'].default_value = (*[c ** 2.2 for c in hexc(d['e'])], 1)
        b.inputs['Emission Strength'].default_value = d['es']
    if 'a' in d:
        b.inputs['Alpha'].default_value = d['a']
        for attr, val in (('blend_method', 'BLEND'), ('surface_render_method', 'BLENDED')):
            try: setattr(m, attr, val)
            except Exception: pass
    MATS[name] = m; return m

# ------------------------------------------------------------------ scene helpers
SC = None; ROOT = None
def new_scene(root_name):
    global SC, ROOT
    bpy.ops.wm.read_factory_settings(use_empty=True); MATS.clear()
    SC = bpy.context.scene
    ROOT = bpy.data.objects.new(root_name, None); SC.collection.objects.link(ROOT)
    return ROOT
def world_of(o):
    if o is ROOT or o is None: return Vector()
    bpy.context.view_layer.update(); return o.matrix_world.translation.copy()
def empty(name, loc, parent=None):
    parent = parent or ROOT
    o = bpy.data.objects.new(name, None); o.empty_display_size = .02; SC.collection.objects.link(o)
    o.parent = parent; o.location = Vector(loc) - world_of(parent); return o
def mesh_obj(name, bm, mat, parent=None, flat=True, origin=None, local=False):
    """local=True: bm is already in the parent's local frame."""
    parent = parent or ROOT
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for p in me.polygons: p.use_smooth = not flat
    me.materials.append(material(mat))
    o = bpy.data.objects.new(name, me); SC.collection.objects.link(o)
    off = Vector(origin) if origin is not None else Vector()
    if off.length: me.transform(Matrix.Translation(-off))
    o.parent = parent; o.location = off if local else off - world_of(parent)
    return o

def loft(sections, cap0=True, cap1=True, closed=True):
    bm = bmesh.new(); rings = [[bm.verts.new(p) for p in ring] for ring in sections]; n = len(sections[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n if closed else n - 1):
            j = (i + 1) % n; bm.faces.new((a[i], a[j], b[j], b[i]))
    if closed and cap0: bm.faces.new(list(reversed(rings[0])))
    if closed and cap1: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def ring_xz(profile, y, cz, cx=0.0):
    return [Vector((cx + x, y, cz + z)) for x, z in profile]
def ring_xy(profile, z, cx=0.0, cy=0.0):
    return [Vector((cx + x, cy + y, z)) for x, y in profile]
def ngon(r, n=8, rz=None, phase=None):
    rz = rz or r; phase = math.pi / n if phase is None else phase
    return [(r * math.cos(phase + TAU * i / n), rz * math.sin(phase + TAU * i / n)) for i in range(n)]
def chamfer_rect(w, h, c):
    """Octagonal section: half-width w, half-height h, chamfer c (counter-clockwise)."""
    return [(w, -h + c), (w, h - c), (w - c, h), (-w + c, h), (-w, h - c), (-w, -h + c), (-w + c, -h), (w - c, -h)]
def frame_along(path, i):
    t = (path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized()
    ref = Vector((1, 0, 0)) if abs(t.x) < .9 else Vector((0, 0, 1))
    n = t.cross(ref).normalized(); b = t.cross(n).normalized()
    return t, n, b
def sweep(path, radii, sides=8, cap=True, squash=1.0, up=None):
    secs = []; prev_n = None
    for i, p in enumerate(path):
        t, n, b = frame_along(path, i)
        if up is not None:
            b = (Vector(up) - t * t.dot(Vector(up))).normalized(); n = b.cross(t).normalized()
        elif prev_n is not None:  # parallel transport keeps the tube from twisting
            n = (prev_n - t * t.dot(prev_n)).normalized(); b = t.cross(n).normalized()
        prev_n = n; r = radii[i] if isinstance(radii, (list, tuple)) else radii
        secs.append([p + (n * math.cos(TAU * k / sides) * r) + (b * math.sin(TAU * k / sides) * r * squash) for k in range(sides)])
    return loft(secs, cap, cap)
def bezier(p0, p1, p2, p3, n):
    p0, p1, p2, p3 = map(Vector, (p0, p1, p2, p3))
    return [p0 * (1 - t) ** 3 + p1 * 3 * t * (1 - t) ** 2 + p2 * 3 * t * t * (1 - t) + p3 * t ** 3 for t in (i / (n - 1) for i in range(n))]
def lathe(pts, axis='Y', origin=(0, 0, 0), segs=16, phase=0.0):
    """Revolve (radius, offset) profile about an axis through origin."""
    o = Vector(origin); secs = []
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
def cyl(a, b, r, sides=12, r2=None):
    a, b = Vector(a), Vector(b); return sweep([a, b], [r, r if r2 is None else r2], sides=sides)
def torus(c, R, r, axis='Z', seg=24, sides=8):
    bm = bmesh.new(); rings = []
    for k in range(seg):
        a = TAU * k / seg; ring = []
        for j in range(sides):
            b = TAU * j / sides; v = Vector(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
            if axis == 'X': v = Vector((v.z, v.x, v.y))
            elif axis == 'Y': v = Vector((v.x, v.z, v.y))
            ring.append(bm.verts.new(Vector(c) + v))
        rings.append(ring)
    for k in range(seg):
        A, B = rings[k], rings[(k + 1) % seg]
        for j in range(sides):
            i2 = (j + 1) % sides; bm.faces.new((A[j], A[i2], B[i2], B[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def sphere(c, r, sx=1, sy=1, sz=1, segs=12, rings=8):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    for v in bm.verts: v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz)) + Vector(c)
    return bm
def xform(bm, rot, offset=(0, 0, 0)):
    bmesh.ops.rotate(bm, verts=bm.verts, cent=Vector(), matrix=rot)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(offset))
    return bm
def crystal(base, axis, length, r, sides=6, roll=0.0):
    """Faceted crystal prism with a pointed tip."""
    axis = Vector(axis).normalized(); ref = Vector((1, 0, 0)) if abs(axis.x) < .9 else Vector((0, 0, 1))
    n = axis.cross(ref).normalized(); b = axis.cross(n); base = Vector(base)
    ringA = [base + (n * math.cos(roll + TAU * k / sides) + b * math.sin(roll + TAU * k / sides)) * r * .8 for k in range(sides)]
    ringB = [p + axis * length * .72 + (p - base).normalized() * r * .2 for p in ringA]
    bm = bmesh.new(); A = [bm.verts.new(p) for p in ringA]; B = [bm.verts.new(p) for p in ringB]; tip = bm.verts.new(base + axis * length)
    for k in range(sides):
        j = (k + 1) % sides; bm.faces.new((A[k], A[j], B[j], B[k])); bm.faces.new((B[k], B[j], tip))
    bm.faces.new(list(reversed(A))); bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm
def helix(c, R, z0, z1, turns, n=None, R1=None):
    n = n or int(turns * 24); R1 = R if R1 is None else R1
    return [Vector((c[0] + math.cos(TAU * turns * t) * (R + (R1 - R) * t), c[1] + math.sin(TAU * turns * t) * (R + (R1 - R) * t), z0 + (z1 - z0) * t)) for t in (i / (n - 1) for i in range(n))]
def zigzag_bolt(c, size, normal_axis='X', thick=.002):
    """Little lightning-bolt badge (6-point zigzag) facing along +/-X."""
    pts = [(-.30, .50), (.20, .50), (-.02, .08), (.32, .08), (-.22, -.55), (.02, -.06), (-.30, -.06)]
    bm = bmesh.new(); vs = [bm.verts.new(Vector((0, x * size, z * size))) for x, z in pts]; f = bm.faces.new(vs)
    bmesh.ops.solidify(bm, geom=[f], thickness=thick)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector((-thick / 2, 0, 0)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bmesh.ops.translate(bm, verts=bm.verts, vec=Vector(c)); return bm

KEEP = set()
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
def tri_count(root=None):
    n = 0
    for o in SC.objects:
        if o.type == 'MESH' and not o.name.startswith('Review_'): n += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return n
def bounds():
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    for o in SC.objects:
        if o.type != 'MESH' or o.name.startswith('Review_'): continue
        for v in o.data.vertices:
            w = o.matrix_world @ v.co; lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    return lo, hi
def export(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    hidden = [o for o in SC.objects if o.name.startswith('Review_')]
    for o in hidden: bpy.data.objects.remove(o, do_unlink=True)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False,
                              export_materials='EXPORT', export_normals=True, export_texcoords=False, export_extras=False)
    return os.path.getsize(path)

# ================================================================== CROSSBOW
# Contract (glTF -Z forward, +Y up, GripAnchor at origin = centre of the firing hand):
#   GripAnchor, ForeGrip (support hand), Muzzle (bolt tip at rest), BoltSeat, Bolt (node; runtime hides it after a shot
#   and clones it for the flying bolt), String (cocked), Charge_L/Charge_R (origin at the rear cap; scale Y = charge),
#   ArcHorn_L/ArcHorn_R (horn tips; runtime draws the climbing arc between them), CordAnchor (plug socket at the butt),
#   FilamentSpool (where the trailing filament leaves the bolt tail), Trigger.
XB = dict(axis_z=.072, rail_z=.106, front=.36, butt=-.33, nock=-.02, muzzle=.43)
def grip_section(c, w, d):
    return [c + Vector((x, y, 0)) for x, y in [(w * .55, d), (w, d * .45), (w, -d * .45), (w * .55, -d), (-w * .55, -d), (-w, -d * .45), (-w, d * .45), (-w * .55, d)]]
def rubber_grip(name, axis_fn, t_bands, w0, d0, ribs=6, hazard=True, parent=None):
    """Ribbed rubber handle along axis_fn(t) with yellow hazard bands at t_bands."""
    secs = []
    for i in range(ribs * 2 + 1):
        t = i / (ribs * 2); bump = 1.06 if i % 2 else 1.0
        if i in (0, ribs * 2): bump = .96
        secs.append(grip_section(axis_fn(t), w0 * bump, d0 * bump))
    mesh_obj(name, loft(secs), 'Rubber', parent=parent, flat=False)
    if hazard:
        for k, t in enumerate(t_bands):
            mesh_obj(f'{name}_Band{k}', loft([grip_section(axis_fn(t - .03), w0 * 1.1, d0 * 1.1), grip_section(axis_fn(t + .03), w0 * 1.1, d0 * 1.1)]), 'Hazard', parent=parent, flat=False)

def build_crossbow():
    root = new_scene('Stormreel')
    KEEP.clear(); KEEP.update({'Charge_L_Core', 'Charge_R_Core', 'Bolt_Shaft', 'String_Wire', 'Trigger_Blade', 'Cap_Glass_L', 'Cap_Glass_R'})
    AZ, RZ = XB['axis_z'], XB['rail_z']
    # receiver: long chamfered steel body, a touch taller at the back where the capacitors clamp on
    rec = []
    for y, w, top, bot in [(-.215, .020, .094, .046), (-.195, .026, .100, .040), (.10, .026, .100, .041), (.28, .023, .096, .050), (.36, .021, .092, .056)]:
        zc, h = (top + bot) / 2, (top - bot) / 2
        rec.append(ring_xz(chamfer_rect(w, h, .009)[::-1], y, zc))
    mesh_obj('Receiver', loft(rec), 'Steel')
    # skeletal butt stock: a steel loop dropping to a rubber shoulder pad
    top = bezier((0, -.20, .090), (0, -.25, .088), (0, -.30, .082), (0, XB['butt'], .074), 8)
    bot = bezier((0, -.10, .040), (0, -.19, .010), (0, -.27, -.012), (0, XB['butt'], -.020), 8)
    mesh_obj('Stock_Top', sweep(top, .011, sides=8, squash=1.4, up=(1, 0, 0)), 'Steel')
    mesh_obj('Stock_Bottom', sweep(bot, .010, sides=8, squash=1.4, up=(1, 0, 0)), 'Steel')
    pad = loft([ring_xz(chamfer_rect(.022, .056, .014)[::-1], y, .027) for y in (XB['butt'] + .004, XB['butt'] - .022)])
    mesh_obj('Stock_Pad', pad, 'Rubber')
    mesh_obj('Stock_PadBand', loft([ring_xz(chamfer_rect(.0235, .058, .015)[::-1], y, .027) for y in (XB['butt'] - .004, XB['butt'] - .010)]), 'Hazard')
    # cord socket: brass plug with a ceramic insulating collar, under the stock, cord leaving down and back
    sock = Vector((0, -.235, .028))
    mesh_obj('Cord_Collar', lathe([(0, 0), (.016, 0), (.018, .006), (.016, .016), (.012, .018), (0, .018)], 'Y', sock + Vector((0, -.004, 0)), segs=12), 'Ceramic', flat=False)
    mesh_obj('Cord_Plug', lathe([(0, 0), (.011, 0), (.0115, .022), (.008, .03), (0, .03)], 'Y', sock + Vector((0, -.032, 0)), segs=10), 'Brass', flat=False)
    for k in range(3):
        mesh_obj(f'Cord_Fin{k}', lathe([(.0065, 0), (.0125, .002), (.0125, .005), (.0065, .007)], 'Y', sock + Vector((0, -.028 + k * .008, 0)), segs=10), 'Ceramic', flat=False)
    cord = bezier(sock + Vector((0, -.032, 0)), sock + Vector((0, -.06, -.002)), sock + Vector((0, -.07, -.03)), sock + Vector((0, -.07, -.06)), 8)
    mesh_obj('Cord_Stub', sweep(cord, .0075, sides=8), 'Cable', flat=False)
    empty('CordAnchor', cord[-1])
    # pistol grip (insulated) and trigger
    tilt = math.radians(14)
    gaxis = lambda t: Vector((0, -math.tan(tilt) * (-.07 + t * .11), -.07 + t * .11))
    rubber_grip('Grip', gaxis, (.08, .92), .0175, .027, ribs=6)
    guard = bezier((0, .074, .042), (0, .080, -.006), (0, .050, -.020), (0, .030, -.016), 10)
    mesh_obj('TriggerGuard', sweep(guard, .0032, sides=6, squash=1.6), 'Steel')
    trig = bezier((0, .036, .040), (0, .043, .026), (0, .040, .012), (0, .032, .004), 6)
    mesh_obj('Trigger_Blade', sweep(trig, [.0036, .0033, .003, .0027, .0024, .002], sides=6, squash=.6), 'Copper')
    empty('Trigger', (0, .036, .030))
    # vertical fore-grip (insulated), for the support hand
    fy = .20
    faxis = lambda t: Vector((0, fy + .012 * t, -.032 + t * .074))
    rubber_grip('ForeGrip_Rubber', faxis, (.12,), .015, .019, ribs=5)
    mesh_obj('ForeGrip_Cap', lathe([(0, 0), (.019, 0), (.021, .006), (.016, .010), (0, .010)], 'Z', faxis(0) + Vector((0, 0, -.009)), segs=8), 'Steel')
    empty('ForeGrip', faxis(.45))
    # twin copper rails the bolt rides on (the + feed into the bolt's spool contact)
    for s in (-1, 1):
        mesh_obj(f'Rail_{"L" if s < 0 else "R"}', box((s * .0062, .17, RZ - .003), (.004, .38, .006), .0012), 'Copper')
    mesh_obj('Rail_Bed', box((0, .17, RZ - .006), (.020, .40, .006), .001), 'PlateSteel')
    # capacitor tubes (Leyden jars) along both flanks: glass, copper coil inside, glowing core = stored charge
    for s, side in ((-1, 'L'), (1, 'R')):
        cx = s * .040; y0, y1 = -.13, .08; cz = .074
        mesh_obj(f'Cap_Glass_{side}', lathe([(.0115, 0), (.0135, .004), (.0135, y1 - y0 - .004), (.0115, y1 - y0)], 'Y', (cx, y0, cz), segs=14), 'Glass', flat=False)
        coil = [Vector((cx + math.cos(a) * .0098, y0 + .006 + (y1 - y0 - .012) * a / (TAU * 9), cz + math.sin(a) * .0098)) for a in (TAU * 9 * i / 160 for i in range(161))]
        mesh_obj(f'Cap_Coil_{side}', sweep(coil, .0012, sides=4, cap=False), 'Copper')
        core_o = Vector((cx, y0 + .006, cz))
        mesh_obj(f'Charge_{side}_Core', lathe([(.0045, 0), (.0062, .004), (.0062, y1 - y0 - .016), (.0045, y1 - y0 - .012)], 'Y', core_o, segs=10), 'Charge', flat=False, origin=core_o)
        empty(f'Charge_{side}', core_o)
        for y, f in ((y0, -1), (y1, 1)):
            mesh_obj(f'Cap_End_{side}{0 if f < 0 else 1}', lathe([(0, 0), (.015, 0), (.0158, .006 * f), (.012, .011 * f), (0, .012 * f)][::(1 if f > 0 else -1)], 'Y', (cx, y, cz), segs=10), 'Brass', flat=False)
        for y in (-.09, .05):  # clamps to the receiver
            mesh_obj(f'Cap_Clamp_{side}{y}', box((s * .031, y, cz), (.012, .008, .010), .0015), 'Steel')
        # lightning badge
        mesh_obj(f'Badge_{side}', xform(zigzag_bolt((0, 0, 0), .028, thick=.002), Matrix.Rotation(0, 3, 'Z'), (s * .0285, .19, .074)), 'Gold')
    # arc horns (a little Jacob's ladder) on a blue glass insulator on the right flank, clear of the sight line:
    # arcs climb between them as the shot charges
    hb = Vector((.030, -.15, .094))
    mesh_obj('Horn_Base', xform(lathe([(0, 0), (.011, 0), (.012, .005), (.008, .010), (.010, .013), (.007, .018), (0, .018)], 'Z', (0, 0, 0), segs=10), Matrix.Rotation(-.5, 3, 'Y'), hb), 'CeramicBlue', flat=False)
    for k, side in ((0, 'L'), (1, 'R')):
        o = hb + Vector((.006 + .008 * k, 0, .014 - .004 * k))
        hp = bezier(o, o + Vector((.004 + .006 * k, 0, .016)), o + Vector((.008 + .016 * k, 0, .034)), o + Vector((.010 + .030 * k, 0, .056 - .008 * k)), 8)
        mesh_obj(f'Horn_{side}', sweep(hp, [.0034, .0032, .0030, .0028, .0026, .0025, .0024, .0023], sides=6), 'Copper')
        mesh_obj(f'Horn_{side}_Knob', sphere(hp[-1], .0045, segs=8, rings=5), 'Copper', flat=False)
        empty(f'ArcHorn_{side}', hp[-1])
    # front: copper choke coil round the nose, ceramic insulator ring, then the prod
    ny = .31
    coil = [Vector((math.cos(a) * .030, ny - .05 + .045 * a / (TAU * 7), AZ + .002 + math.sin(a) * .030)) for a in (TAU * 7 * i / 168 for i in range(169))]
    mesh_obj('Nose_Coil', sweep(coil, .0026, sides=5, cap=False), 'Copper')
    mesh_obj('Nose_Insulator', lathe([(.026, 0), (.034, .004), (.034, .010), (.030, .014), (.034, .018), (.034, .024), (.026, .028)], 'Y', (0, ny, AZ + .002), segs=12), 'Ceramic', flat=False)
    riser = loft([ring_xz(chamfer_rect(w, h, .008)[::-1], y, AZ + .004) for y, w, h in ((.335, .030, .030), (.36, .038, .028), (.392, .034, .024), (.405, .024, .018))])
    mesh_obj('Prod_Riser', riser, 'PlateSteel')
    # prod limbs: crisp, swept forward then recurved, steel with copper edge strips and copper cams at the tips
    tips = {}
    for s, side in ((-1, 'L'), (1, 'R')):
        path = bezier((s * .03, .385, AZ + .004), (s * .14, .43, AZ + .006), (s * .22, .40, AZ + .006), (s * .27, .345, AZ + .004), 10)
        widths = [.020 - .010 * i / 9 for i in range(10)]
        secs = []
        for i, p in enumerate(path):
            t = (path[min(i + 1, 9)] - path[max(i - 1, 0)]).normalized(); n = Vector((0, 0, 1)); b = t.cross(n).normalized()
            w, th = widths[i], .0075 - .002 * i / 9
            secs.append([p + n * w * .55 + b * th, p + n * w + b * th * .2, p + n * w * .55 - b * th, p - n * w * .55 - b * th, p - n * w - b * th * .2, p - n * w * .55 + b * th])
        mesh_obj(f'Prod_{side}', loft(secs), 'Steel')
        mesh_obj(f'Prod_{side}_Edge', sweep([p + Vector((0, 0, widths[i] * .98)) for i, p in enumerate(path)], .0018, sides=4), 'Copper')
        tip = path[-1]; tips[side] = tip
        mesh_obj(f'Cam_{side}', lathe([(0, -.005), (.014, -.005), (.016, -.002), (.016, .002), (.014, .005), (0, .005)], 'Z', tip, segs=14), 'Copper', flat=False)
        mesh_obj(f'Cam_{side}_Axle', cyl(tip + Vector((0, 0, -.009)), tip + Vector((0, 0, .009)), .0035, sides=8), 'Brass', flat=False)
        mesh_obj(f'Cam_{side}_Bead', lathe([(0, 0), (.007, 0), (.009, .006), (.007, .012), (.009, .018), (0, .02)], 'Y', tip + Vector((s * .004, .010, 0)), segs=8), 'Ceramic', flat=False)
    # string: braided copper wire, cocked back to the latch
    latch = Vector((0, XB['nock'], RZ + .004))
    mesh_obj('Latch', box((0, XB['nock'] - .012, RZ + .002), (.022, .02, .014), .003), 'PlateSteel')
    string_pts = [tips['L'] + Vector((.012, 0, 0)), latch, tips['R'] + Vector((-.012, 0, 0))]
    s_bm = sweep([string_pts[0], string_pts[1]], .0016, sides=5); s2 = sweep([string_pts[1], string_pts[2]], .0016, sides=5)
    tmp = bpy.data.meshes.new('t'); s2.to_mesh(tmp); s2.free(); s_bm.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    mesh_obj('String_Wire', s_bm, 'DarkCopper')
    empty('String', latch)
    # bolt: dark shaft, copper barbed head, blue vanes, brass filament spool at the tail
    bolt = empty('Bolt', (0, XB['nock'] + .01, RZ + .0045))
    by0, by1 = XB['nock'] + .01, XB['muzzle'] - .045
    bz = RZ + .0045
    mesh_obj('Bolt_Shaft', cyl((0, by0, bz), (0, by1, bz), .0042, sides=8), 'Steel', parent=bolt, flat=False)
    head = lathe([(.0045, 0), (.0085, .006), (.0095, .016), (.0, .045)], 'Y', (0, by1 - .002, bz), segs=4, phase=math.pi / 4)
    mesh_obj('Bolt_Head', head, 'Copper', parent=bolt)
    for k in range(3):
        a = math.pi / 2 + TAU * k / 3
        d = Vector((math.cos(a), 0, math.sin(a)))
        v = bmesh.new(); vs = [v.verts.new(Vector((0, y, bz)) + d * r) for y, r in ((by0 + .012, .004), (by0 + .07, .004), (by0 + .03, .016), (by0 + .006, .017))]
        v.faces.new(vs); bmesh.ops.solidify(v, geom=list(v.faces), thickness=.0012)
        mesh_obj(f'Bolt_Vane{k}', v, 'Fletch', parent=bolt)
    mesh_obj('Bolt_Spool', lathe([(.004, -.001), (.0075, 0), (.0075, .002), (.0055, .003), (.0055, .010), (.0075, .011), (.0075, .013), (.004, .014)], 'Y', (0, by0 - .012, bz), segs=10), 'Brass', parent=bolt, flat=False)
    mesh_obj('Bolt_SpoolWire', lathe([(.0057, 0), (.0065, .001), (.0065, .006), (.0057, .007)], 'Y', (0, by0 - .009, bz), segs=10), 'Copper', parent=bolt, flat=False)
    empty('FilamentSpool', (0, by0 - .012, bz), parent=bolt)
    empty('BoltSeat', (0, XB['nock'] + .01, bz))
    empty('Muzzle', (0, by1 + .043, bz))
    empty('GripAnchor', (0, 0, 0))
    # front sight: a tiny brass lightning rod
    mesh_obj('Sight_Post', cyl((0, .33, .098), (0, .33, .122), .0022, sides=6), 'Brass')
    mesh_obj('Sight_Ball', sphere((0, .33, .124), .0036, segs=8, rings=5), 'Charge', flat=False)
    for parent in (ROOT, bolt): merge_children(parent)
    bpy.context.view_layer.update()
    lo, hi = bounds()
    return {'triangles': tri_count(), 'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi]}

# ================================================================== REEL PACK
# Contract (glTF -Z forward = the wearer's facing, +Y up, origin = PackAnchor between the shoulder blades):
#   Reel (spins about the drum axis, X in Blender/glTF), CableExit (where the tower cable leaves the fairlead),
#   CordAnchor (coiled cord to the crossbow), Lamp (blue "live" lamp; runtime drives its glow), Crank,
#   HangPoint (where the pack sits on the tower hook), ArcGap_A/ArcGap_B (fuse-box spark gap).
PACK = dict(drum_c=Vector((0, -.17, -.17)), flange_r=.19, core_r=.085, wound_r=.155, half_w=.14)
def build_pack():
    new_scene('ReelPack')
    KEEP.clear(); KEEP.update({'Lamp_Glow'})
    C, FR, CR, WR, HW = PACK['drum_c'], PACK['flange_r'], PACK['core_r'], PACK['wound_r'], PACK['half_w']
    # frame: two steel side rails, cross bars, a rubber back pad against the wearer
    for s in (-1, 1):
        rail = bezier((s * .17, -.035, .12), (s * .19, -.05, -.05), (s * .19, -.05, -.30), (s * .17, -.06, -.44), 10)
        mesh_obj(f'Frame_Rail{s}', sweep(rail, .012, sides=8, squash=.8), 'Steel')
        # shoulder straps: rubberised, curving over the shoulder
        strap = bezier((s * .12, -.03, .10), (s * .12, .05, .16), (s * .13, .14, .10), (s * .13, .16, -.02), 9)
        mesh_obj(f'Strap{s}', sweep(strap, .022, sides=4, squash=.18, up=(1, 0, 0)), 'Rubber')
        mesh_obj(f'Strap_Buckle{s}', box(strap[4] + Vector((0, .003, 0)), (.03, .012, .02), .003), 'Brass')
        # drum bearing plates
        mesh_obj(f'Bearing{s}', box((s * (HW + .032), C.y, C.z), (.012, .07, .07), .006), 'PlateSteel')
    for z in (.10, -.42):
        mesh_obj(f'Frame_Bar{z}', cyl((-.18, -.045, z), (.18, -.045, z), .010, sides=8), 'Steel')
    mesh_obj('BackPad', box((0, -.02, -.14), (.26, .03, .40), .012), 'Rubber')
    mesh_obj('BackPad_Band', box((0, -.004, -.14), (.27, .004, .04), .002), 'Hazard')
    # drum: brass spoked flanges, steel rims, wound orange cable between them
    reel = empty('Reel', C)
    for s in (-1, 1):
        x = s * HW
        mesh_obj(f'Flange_Rim{s}', torus((x, C.y, C.z), FR, .010, axis='X', seg=28, sides=6), 'Steel', parent=reel, flat=False)
        mesh_obj(f'Flange_Hub{s}', lathe([(0, -.012), (.05, -.012), (.06, -.004), (.06, .004), (.05, .012), (0, .012)], 'X', (x, C.y, C.z), segs=14), 'Brass', parent=reel, flat=False)
        for k in range(6):  # spokes
            a = TAU * k / 6 + .3
            p0 = Vector((x, C.y + math.cos(a) * .055, C.z + math.sin(a) * .055)); p1 = Vector((x, C.y + math.cos(a) * (FR - .006), C.z + math.sin(a) * (FR - .006)))
            mesh_obj(f'Spoke{s}{k}', sweep([p0, p1], .009, sides=4, squash=.45, up=(1, 0, 0)), 'Brass', parent=reel)
    mesh_obj('Drum_Core', lathe([(CR, -HW), (CR, HW)], 'X', C, segs=16), 'DarkCopper', parent=reel, flat=False)
    # wound cable: one torus per wrap, so it reads as coiled cable even at distance, over a dark core
    wraps = 12; pitch = (2 * HW - .012) / wraps
    mesh_obj('Reel_Cable_Bed', lathe([(WR - .012, -HW + .004), (WR - .012, HW - .004)], 'X', C, segs=16), 'DarkCopper', parent=reel, flat=False)
    for i in range(wraps):
        x = -HW + .006 + pitch * (i + .5)
        mesh_obj(f'Reel_Cable{i}', torus((x, C.y, C.z), WR - .002, pitch * .55, axis='X', seg=18, sides=6), 'Cable', parent=reel, flat=False)
    # slip rings (right hub): brass rings between ceramic spacers, with two carbon brush arms on the frame
    sx = HW + .05
    prof = [(0, 0)]
    for k in range(3):
        prof += [(.032, k * .014), (.034, k * .014 + .002), (.034, k * .014 + .006), (.030, k * .014 + .008), (.030, k * .014 + .014)]
    mesh_obj('SlipRing_Core', lathe([(.026, 0), (.026, .046)], 'X', (sx, C.y, C.z), segs=14), 'Ceramic', flat=False)
    for k in range(3):
        mesh_obj(f'SlipRing_{k}', lathe([(.026, 0), (.034, .002), (.034, .007), (.026, .009)], 'X', (sx + .004 + k * .014, C.y, C.z), segs=14), 'Brass', flat=False)
        brush = bezier((sx + .008 + k * .014, C.y + .07, C.z + .07), (sx + .008 + k * .014, C.y + .06, C.z + .05), (sx + .008 + k * .014, C.y + .03, C.z + .04), (sx + .008 + k * .014, C.y + .004, C.z + .036), 6)
        mesh_obj(f'Brush_Arm{k}', sweep(brush, .003, sides=4), 'Copper')
        mesh_obj(f'Brush_Block{k}', box((sx + .008 + k * .014, C.y, C.z + .038), (.006, .01, .008), .001), 'Soot')
    mesh_obj('SlipRing_Cap', lathe([(0, 0), (.03, 0), (.032, .008), (0, .012)], 'X', (sx + .046, C.y, C.z), segs=12), 'Brass', flat=False)
    # coiled cord to the crossbow leaves the slip-ring cap
    cord_start = Vector((sx + .058, C.y, C.z))
    cord = [cord_start + Vector((.006 + .07 * t, math.cos(TAU * 6 * t) * .014 + .07 * t, math.sin(TAU * 6 * t) * .014 - .03 * t)) for t in (i / 95 for i in range(96))]
    mesh_obj('Cord_Coil', sweep(cord, .0045, sides=6, cap=True), 'Cable', flat=False)
    empty('CordAnchor', cord[-1])
    # spring motor and crank (left hub)
    mx = -HW - .05
    mesh_obj('Motor_Drum', lathe([(0, 0), (.055, 0), (.06, .006), (.06, .034), (.055, .04), (0, .04)], 'X', (mx - .04, C.y, C.z), segs=16), 'Steel', flat=False)
    mesh_obj('Motor_Band', lathe([(.0605, 0), (.0605, .008)], 'X', (mx - .022, C.y, C.z), segs=16), 'Hazard', flat=False)
    crank = empty('Crank', (mx - .045, C.y, C.z))
    mesh_obj('Crank_Arm', box((mx - .05, C.y + .035, C.z), (.008, .085, .016), .003), 'PlateSteel', parent=crank)
    mesh_obj('Crank_Knob', cyl((mx - .05, C.y + .07, C.z), (mx - .09, C.y + .07, C.z), .011, sides=10), 'Rubber', parent=crank, flat=False)
    # fairlead: two rollers under the drum that guide the cable down and back toward the tower
    fl = Vector((0, C.y - .07, C.z - FR - .05))
    for dz in (-.016, .016):
        mesh_obj(f'Fairlead_Roller{dz}', cyl((-.05, fl.y, fl.z + dz), (.05, fl.y, fl.z + dz), .011, sides=10), 'Ceramic', flat=False)
    for s in (-1, 1):
        mesh_obj(f'Fairlead_Cheek{s}', box((s * .058, fl.y, fl.z), (.008, .04, .06), .003), 'Steel')
        arm = [Vector((s * .058, fl.y + .02, fl.z + .02)), Vector((s * .17, C.y + .06, C.z - .10))]
        mesh_obj(f'Fairlead_Arm{s}', sweep(arm, .006, sides=6), 'Steel')
    lead = bezier(C + Vector((0, -.02, -WR)), C + Vector((0, -.06, -WR - .02)), fl + Vector((0, .01, .03)), fl, 6)
    mesh_obj('Cable_Lead', sweep(lead, .0085, sides=8), 'Cable', flat=False)
    tail = bezier(fl, fl + Vector((0, -.02, -.03)), fl + Vector((0, -.05, -.06)), fl + Vector((0, -.06, -.10)), 5)
    mesh_obj('Cable_Tail', sweep(tail, .0085, sides=8), 'Cable', flat=False)
    empty('CableExit', tail[-1])
    # fuse box on top of the frame: brass-trimmed steel box, knife-switch lever, blue live lamp, ceramic insulators
    fb = Vector((0, -.09, .14))
    mesh_obj('FuseBox', box(fb, (.16, .07, .06), .006), 'PlateSteel')
    mesh_obj('FuseBox_Trim', box(fb + Vector((0, 0, .031)), (.165, .075, .006), .002), 'Brass')
    lever = bezier(fb + Vector((.05, 0, .035)), fb + Vector((.05, -.01, .06)), fb + Vector((.05, -.03, .075)), fb + Vector((.05, -.05, .08)), 5)
    mesh_obj('Switch_Lever', sweep(lever, .004, sides=6), 'Copper')
    mesh_obj('Switch_Knob', sphere(lever[-1], .009, segs=10, rings=6), 'Rubber', flat=False)
    mesh_obj('Lamp_Cage', lathe([(.013, 0), (.016, .004), (.016, .02), (.006, .03), (0, .031)], 'Z', fb + Vector((-.045, 0, .034)), segs=8), 'Brass')
    mesh_obj('Lamp_Glow', sphere(fb + Vector((-.045, 0, .05)), .012, segs=10, rings=7), 'Charge', flat=False)
    empty('Lamp', fb + Vector((-.045, 0, .05)))
    for s in (-1, 1):
        ins = fb + Vector((s * .02, -.015, .034))
        mesh_obj(f'Insulator{s}', lathe([(0, 0), (.009, 0), (.012, .006), (.007, .012), (.011, .018), (.006, .025), (.003, .03), (0, .03)], 'Z', ins, segs=8), 'CeramicBlue', flat=False)
        empty(f'ArcGap_{"A" if s < 0 else "B"}', ins + Vector((0, 0, .032)))
    mesh_obj('Badge', xform(zigzag_bolt((0, 0, 0), .05, thick=.003), Matrix.Rotation(math.pi / 2, 3, 'Z'), fb + Vector((0, -.037, 0))), 'Gold')
    empty('HangPoint', (0, -.04, .12))
    empty('PackAnchor', (0, 0, 0))
    for parent in (ROOT, reel): merge_children(parent)
    bpy.context.view_layer.update()
    lo, hi = bounds()
    return {'triangles': tri_count(), 'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi]}

# ================================================================== TOWER
# Contract (glTF -Z forward, +Y up, origin on the ground at the tower centre, metres):
#   ChargeColumn (origin at the column floor; scale Y = stored charge), Capacitor (the hat-tip crystal; runtime pulses it),
#   TopLoad (torus brim centre; arcs leap from here when full), Hopper (crystal feed point),
#   CableTerminal (where the reel cable is bonded), PackHook (where the reel pack hangs), Earth_0..3 (stake tips),
#   Window_Glow.
TW = dict(plinth_r=1.45, shaft_r0=.95, shaft_r1=.68, shaft_z0=.85, shaft_z1=5.0, brim_z=5.35, tip_z=8.6)
def build_tower():
    new_scene('Stormspire')
    KEEP.clear(); KEEP.update({'ChargeColumn_Core', 'Capacitor_Crystal', 'Window_Glow', 'Hopper_Crystals'})
    R0, R1, Z0, Z1 = TW['shaft_r0'], TW['shaft_r1'], TW['shaft_z0'], TW['shaft_z1']
    rnd = random.Random(7)
    # plinth: two chamfered octagonal stone steps
    mesh_obj('Plinth', loft([ring_xy(ngon(r, 8), z) for r, z in ((TW['plinth_r'], 0), (TW['plinth_r'], .42), (TW['plinth_r'] - .08, .5))]), 'StoneDark')
    mesh_obj('Plinth_Step', loft([ring_xy(ngon(r, 8), z) for r, z in ((1.18, .5), (1.18, .78), (1.12, Z0))]), 'Stone')
    # shaft: tapered octagon with proud block courses so it reads as built stone
    secs = []
    for i in range(9):
        t = i / 8; z = Z0 + (Z1 - Z0) * t; r = R0 + (R1 - R0) * t
        secs.append(ring_xy(ngon(r, 8), z))
    mesh_obj('Shaft', loft(secs), 'Stone')
    for i in range(1, 8):
        t = i / 8; z = Z0 + (Z1 - Z0) * t; r = R0 + (R1 - R0) * t
        mesh_obj(f'Course{i}', loft([ring_xy(ngon(r + .035, 8), z - .05), ring_xy(ngon(r + .035, 8), z + .05)]), 'StoneDark')
    # a few offset block faces for hand-built charm
    for k in range(18):
        t = rnd.uniform(.05, .95); z = Z0 + (Z1 - Z0) * t; r = R0 + (R1 - R0) * t; a = TAU * rnd.randrange(8) / 8 + math.pi / 8
        if abs(math.sin(a - math.pi / 2)) < .5 and z < 4.0: continue  # keep the charge column face clear
        c = Vector((math.cos(a) * (r * .93 + .02), math.sin(a) * (r * .93 + .02), z))
        mesh_obj(f'Block{k}', xform(box((0, 0, 0), (.04, .42 * r, .28), .02), Matrix.Rotation(a, 3, 'Z'), c), 'StoneDark' if k % 2 else 'Stone')
    # Tesla secondary: a copper coil winding up the shaft, on little ceramic stand-offs
    turns = 9; coil = []
    for i in range(turns * 32 + 1):
        t = i / (turns * 32); z = Z0 + .35 + (Z1 - Z0 - .7) * t; r = R0 + (R1 - R0) * ((z - Z0) / (Z1 - Z0)) + .09
        a = TAU * turns * t + math.pi / 2 + .25
        coil.append(Vector((math.cos(a) * r, math.sin(a) * r, z)))
    mesh_obj('Coil', sweep(coil, .032, sides=6, cap=True), 'Copper', flat=False)
    for i in range(0, len(coil), 16):
        p = coil[i]; d = Vector((p.x, p.y, 0)).normalized()
        mesh_obj(f'Standoff{i}', cyl(p - d * .1, p - d * .02, .028, sides=6), 'Ceramic', flat=False)
    # charge column: a tall glass tube on the front face with a glowing crystal core (scale Y = charge)
    cy = R0 + .14
    col0 = Vector((0, R0 - .02, Z0 + .3)); col_top = Z1 - .55
    def col_y(z): return R0 + (R1 - R0) * ((z - Z0) / (Z1 - Z0)) + .16
    mesh_obj('ChargeColumn_Glass', cyl((0, col_y(col0.z), col0.z), (0, col_y(col_top), col_top), .12, sides=12), 'Glass', flat=False)
    core_o = Vector((0, col_y(col0.z), col0.z + .04))
    mesh_obj('ChargeColumn_Core', cyl(core_o, (0, col_y(col_top - .04), col_top - .04), .075, sides=8), 'Charge', flat=False, origin=core_o)
    empty('ChargeColumn', core_o)
    for z in (col0.z, col_top):
        mesh_obj(f'Column_Cap{z}', cyl((0, col_y(z), z - .06), (0, col_y(z), z + .06), .15, sides=12), 'Brass', flat=False)
    for k in range(5):  # gauge rings
        z = col0.z + (col_top - col0.z) * (k + 1) / 6
        mesh_obj(f'Column_Ring{k}', torus((0, col_y(z), z), .125, .012, axis='Z', seg=16, sides=4), 'Brass', flat=False)
    # crystal hopper at the base front: a brass funnel on a stone post, heaped with crystals
    hp = Vector((0, 1.62, .0))
    mesh_obj('Hopper_Post', loft([ring_xy(ngon(r, 8), z, 0, hp.y) for r, z in ((.26, 0), (.22, .7), (.24, .78))]), 'StoneDark')
    mesh_obj('Hopper_Bowl', lathe([(.12, 0), (.36, .26), (.40, .30), (.37, .32), (.14, .06), (.0, .06)], 'Z', (0, hp.y, .78), segs=12), 'Brass', flat=False)
    crys = bmesh.new()
    for k in range(9):
        a = TAU * k / 9 + rnd.uniform(-.2, .2); rr = rnd.uniform(.05, .22)
        base = Vector((math.cos(a) * rr, hp.y + math.sin(a) * rr, .88)); ax = Vector((math.cos(a) * .4, math.sin(a) * .4, 1))
        c = crystal(base, ax, rnd.uniform(.16, .30), rnd.uniform(.04, .07), roll=rnd.random())
        tmp = bpy.data.meshes.new('t'); c.to_mesh(tmp); c.free(); crys.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    mesh_obj('Hopper_Crystals', crys, 'Crystal')
    empty('Hopper', (0, hp.y, 1.05))
    # feed pipe from the hopper into the shaft
    feed = bezier((0, hp.y - .1, .9), (0, hp.y - .35, 1.0), (0, R0 + .35, 1.05), (0, R0 - .05, 1.1), 8)
    mesh_obj('Hopper_Pipe', sweep(feed, .07, sides=8), 'Brass', flat=False)
    # earth bonding: four copper straps down the plinth into stakes in the ground (the return path)
    for k in range(4):
        a = math.pi / 4 + TAU * k / 4
        d = Vector((math.cos(a), math.sin(a), 0))
        z = lambda h: Vector((0, 0, h))
        strap = [d * (R0 + .02) + z(Z0 + .45), d * (R0 + .03) + z(Z0 + .02), d * 1.19 + z(Z0 - .04), d * 1.19 + z(.52), d * 1.46 + z(.51), d * 1.46 + z(.43), d * 1.47 + z(.03), d * 1.7 + z(.02), d * 1.92 + z(.06)]
        mesh_obj(f'EarthStrap{k}', sweep(strap, .055, sides=4, squash=.22, up=tuple(d)), 'Copper')
        stake = d * 1.95
        mesh_obj(f'EarthStake{k}', cyl(stake + Vector((0, 0, -.25)), stake + Vector((0, 0, .16)), .035, sides=8), 'Copper', flat=False)
        mesh_obj(f'EarthClamp{k}', cyl(stake + Vector((0, 0, .02)), stake + Vector((0, 0, .09)), .055, sides=8), 'Brass', flat=False)
        empty(f'Earth_{k}', stake + Vector((0, 0, .16)))
    # wizard door at the back and a glowing arched window
    door = bezier((-.32, 0, Z0), (-.32, 0, Z0 + 1.0), (.32, 0, Z0 + 1.0), (.32, 0, Z0), 12)
    dsec = [[Vector((p.x, -R0 - .02, p.z)), Vector((p.x, -R0 + .06, p.z))] for p in door]
    dm = bmesh.new()
    vs = [dm.verts.new(Vector((p.x, -R0 - .03, p.z))) for p in door]; dm.faces.new(vs[::-1])
    bmesh.ops.solidify(dm, geom=list(dm.faces), thickness=.06)
    mesh_obj('Door', dm, 'Wood')
    mesh_obj('Door_Ring', torus((.16, -R0 - .1, Z0 + .45), .05, .01, axis='Y', seg=12, sides=4), 'Brass', flat=False)
    mesh_obj('Door_Frame', sweep([Vector((p.x * 1.12, -R0 - .02, Z0 + (p.z - Z0) * 1.06)) for p in door], .05, sides=4), 'StoneDark')
    wz = 3.4; wr = R0 + (R1 - R0) * ((wz - Z0) / (Z1 - Z0))
    win = bezier((-.16, 0, wz - .3), (-.16, 0, wz + .2), (.16, 0, wz + .2), (.16, 0, wz - .3), 10)
    for a, nm in ((math.radians(200), 'W'), (math.radians(-20), 'E')):
        rot = Matrix.Rotation(a + math.pi / 2, 3, 'Z')
        wm = bmesh.new(); vs = [wm.verts.new(rot @ Vector((p.x, -wr - .015, p.z - wz)) + Vector((0, 0, wz))) for p in win]; wm.faces.new(vs)
        bmesh.ops.recalc_face_normals(wm, faces=wm.faces)
        mesh_obj(f'Window_Glow' if nm == 'W' else 'Window_Glow_E', wm, 'Window')
        mesh_obj(f'Window_Frame_{nm}', sweep([rot @ Vector((p.x * 1.15, -wr - .02, (p.z - wz) * 1.1)) + Vector((0, 0, wz)) for p in win], .035, sides=4), 'StoneDark')
    KEEP.add('Window_Glow_E')
    # insulator posts carrying the copper torus brim (the coil's top load)
    BZ = TW['brim_z']
    mesh_obj('Crown', loft([ring_xy(ngon(r, 8), z) for r, z in ((R1, Z1 - .02), (R1 + .12, Z1 + .1), (R1 + .12, Z1 + .22), (R1 + .02, Z1 + .3))]), 'StoneDark')
    for k in range(6):
        a = TAU * k / 6 + .2; d = Vector((math.cos(a), math.sin(a), 0)); base = d * (R1 + .05) + Vector((0, 0, Z1 + .28))
        prof = [(0, 0), (.07, 0), (.11, .06), (.06, .11), (.10, .17), (.055, .22), (.09, .28), (.05, .34), (0, .35)]
        mesh_obj(f'Insulator{k}', lathe(prof, 'Z', base, segs=8), 'CeramicBlue', flat=False)
        mesh_obj(f'BrimArm{k}', sweep([base + Vector((0, 0, .33)), d * 1.05 + Vector((0, 0, BZ + .02))], .025, sides=4), 'Copper')
    mesh_obj('TopLoad_Torus', torus((0, 0, BZ), 1.12, .14, axis='Z', seg=32, sides=10), 'Copper', flat=False)
    empty('TopLoad', (0, 0, BZ))
    # the wizard hat: slate-blue, a bent tip, a copper hatband with a gold lightning buckle
    hat_path = bezier((0, 0, BZ - .05), (0, 0, BZ + 1.4), (.05, .08, BZ + 2.4), (.55, .30, TW['tip_z'] - .2), 16)
    radii = [1.0 * (1 - i / 15) ** 1.15 + .025 for i in range(16)]
    secs = []
    for i, p in enumerate(hat_path):
        r = radii[i]; t = (hat_path[min(i + 1, 15)] - hat_path[max(i - 1, 0)]).normalized()
        n = t.cross(Vector((1, 0, 0))).normalized(); b = t.cross(n)
        secs.append([p + (n * math.cos(TAU * k / 12) + b * math.sin(TAU * k / 12)) * r for k in range(12)])
    mesh_obj('Hat', loft(secs), 'Slate')
    # shingle courses on the hat
    for i in (2, 4, 6, 8):
        p = hat_path[i]; r = radii[i] + .02; t = (hat_path[i + 1] - hat_path[i - 1]).normalized(); n = t.cross(Vector((1, 0, 0))).normalized(); b = t.cross(n)
        mesh_obj(f'Shingle{i}', loft([[p - t * .05 + (n * math.cos(TAU * k / 12) + b * math.sin(TAU * k / 12)) * (r + .015) for k in range(12)],
                                      [p + t * .06 + (n * math.cos(TAU * k / 12) + b * math.sin(TAU * k / 12)) * (r - .03) for k in range(12)]]), 'SlateDark')
    hb = hat_path[1]
    mesh_obj('Hatband', loft([ring_xy(ngon(radii[1] + .035 - d * .25, 12, phase=0), hb.z + d) for d in (-.12, .12)]), 'Copper')
    mesh_obj('Hat_Buckle', xform(zigzag_bolt((0, 0, 0), .55, thick=.05), Matrix.Rotation(math.pi / 2, 3, 'Z'), (0, radii[1] + .05, hb.z)), 'Gold')
    # capacitor: a crystal cluster held by copper prongs at the hat tip, with a lightning-rod spike
    tip = hat_path[-1]; tdir = (hat_path[-1] - hat_path[-2]).normalized()
    cap = empty('Capacitor', tip - tdir * .08)
    mesh_obj('Capacitor_Collar', lathe([(.06, 0), (.13, .05), (.13, .12), (.08, .16)], 'Z', (0, 0, 0), segs=8), 'Copper', parent=cap, local=True)
    cc = bmesh.new()
    for k, (ax, ln, r) in enumerate((((0, 0, 1), .62, .15), ((.5, .2, 1), .38, .09), ((-.4, .3, 1), .34, .08), ((.1, -.5, 1), .30, .07))):
        c = crystal((0, 0, .1), ax, ln, r, roll=k)
        tmp = bpy.data.meshes.new('t'); c.to_mesh(tmp); c.free(); cc.from_mesh(tmp); bpy.data.meshes.remove(tmp)
    mesh_obj('Capacitor_Crystal', cc, 'CrystalCore', parent=cap, local=True)
    for k in range(3):
        a = TAU * k / 3
        prong = bezier((math.cos(a) * .1, math.sin(a) * .1, .12), (math.cos(a) * .2, math.sin(a) * .2, .3), (math.cos(a) * .16, math.sin(a) * .16, .5), (math.cos(a) * .06, math.sin(a) * .06, .62), 6)
        mesh_obj(f'Prong{k}', sweep(prong, .022, sides=5), 'Copper', parent=cap, local=True)
    mesh_obj('Rod', cyl((0, 0, .6), (0, 0, 1.05), .02, sides=6, r2=.004), 'Copper', parent=cap, local=True)
    cap.rotation_euler = Vector((0, 0, 1)).rotation_difference(tdir.lerp(Vector((0, 0, 1)), .5).normalized()).to_euler()
    bpy.context.view_layer.update(); print('capacitor', cap.matrix_world.translation, 'tip', tip)
    # cable terminal and pack hook on the east face (the pack hangs here between uses)
    tz = 1.3; tr = R0 + (R1 - R0) * ((tz - Z0) / (Z1 - Z0))
    term = Vector((tr + .04, 0, tz + .55))
    mesh_obj('Terminal_Bushing', lathe([(0, 0), (.09, 0), (.13, .06), (.08, .1), (.12, .15), (.07, .2), (.10, .25), (.05, .3), (0, .3)], 'X', term, segs=10), 'CeramicBlue', flat=False)
    mesh_obj('Terminal_Lug', cyl(term + Vector((.3, 0, 0)), term + Vector((.38, 0, 0)), .045, sides=8), 'Copper', flat=False)
    empty('CableTerminal', term + Vector((.38, 0, 0)))
    hook = Vector((tr + .05, 0, tz))
    mesh_obj('Hook_Plate', box(hook + Vector((.02, 0, 0)), (.05, .4, .24), .02), 'Steel')
    hk = bezier(hook + Vector((.03, 0, .02)), hook + Vector((.22, 0, -.02)), hook + Vector((.30, 0, .06)), hook + Vector((.28, 0, .16)), 8)
    mesh_obj('Hook', sweep(hk, .03, sides=6), 'Steel')
    empty('PackHook', hk[-2])
    for parent in (ROOT, cap): merge_children(parent)
    bpy.context.view_layer.update()
    lo, hi = bounds()
    return {'triangles': tri_count(), 'bounds_min': [round(v, 4) for v in lo], 'bounds_max': [round(v, 4) for v in hi]}

# ================================================================== renders
def setup_render(res=(1200, 800)):
    SC.render.engine = 'CYCLES'; SC.cycles.samples = int(arg('--samples', 48)); SC.cycles.device = 'CPU'
    try: SC.cycles.use_denoising = True
    except Exception: pass
    SC.render.resolution_x, SC.render.resolution_y = res
    SC.view_settings.view_transform = 'Standard'; SC.render.film_transparent = False
    w = bpy.data.worlds.new('w'); SC.world = w; w.use_nodes = True
    bg = w.node_tree.nodes['Background']; bg.inputs[0].default_value = (.55, .68, .86, 1); bg.inputs[1].default_value = .7
def add_light(loc, e, at=(0, 0, 0), s=.5, col=(1, 1, 1), kind='AREA'):
    l = bpy.data.lights.new('l', kind); l.energy = e; l.color = col
    if kind == 'AREA': l.size = s
    o = bpy.data.objects.new('l', l); o.location = loc; SC.collection.objects.link(o)
    o.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
def shoot(views, outdir, prefix):
    cam = bpy.data.cameras.new('c'); co = bpy.data.objects.new('c', cam); SC.collection.objects.link(co); SC.camera = co
    for name, (loc, at, lens) in views.items():
        cam.lens = lens; co.location = loc; co.rotation_euler = (Vector(at) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        SC.render.filepath = os.path.join(outdir, f'{prefix}-{name}.png'); bpy.ops.render.render(write_still=True)
def ground_plane(size=40, z=0.0, color=(.32, .46, .22)):
    m = bpy.data.materials.new('Ground'); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']; b.inputs['Base Color'].default_value = (*color, 1); b.inputs['Roughness'].default_value = .95
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    me = bpy.data.meshes.new('Review_Ground'); bm.to_mesh(me); me.materials.append(m)
    o = bpy.data.objects.new('Review_Ground', me); SC.collection.objects.link(o); o.location.z = z
def review_arc(points, name='Review_Arc', r=.004, jitter=.02, seed=1, mat='Spark'):
    rr = random.Random(seed); pts = []
    for i, p in enumerate(points):
        j = Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-1, 1))) * jitter * (0 if i in (0, len(points) - 1) else 1)
        pts.append(Vector(p) + j)
    mesh_obj(name + str(seed), sweep(pts, r, sides=5), mat, flat=False)
def lerp_pts(a, b, n): a, b = Vector(a), Vector(b); return [a.lerp(b, i / (n - 1)) for i in range(n)]

def render_crossbow(outdir):
    setup_render()
    for side in 'LR':
        o = bpy.data.objects.get(f'Charge_{side}')
    add_light((.7, -.4, .8), 60, at=(0, .1, .07)); add_light((-.8, .5, .4), 25, at=(0, .1, .07), col=(.8, .9, 1)); add_light((0, -.8, .3), 15, at=(0, .1, .07))
    a, b = bpy.data.objects['ArcHorn_L'].matrix_world.translation, bpy.data.objects['ArcHorn_R'].matrix_world.translation
    review_arc(lerp_pts(a + Vector((0, 0, -.012)), b + Vector((0, 0, -.012)), 9), r=.0011, jitter=.006, seed=3)
    shoot({'three-quarter': ((.62, -.30, .34), (0, .08, .06), 50), 'side': ((.95, .05, .08), (0, .06, .05), 50),
           'front': ((-.45, .85, .25), (0, .18, .07), 50), 'first-person': ((.0, -.42, .26), (0, .3, .08), 38)}, outdir, 'crossbow')
def render_pack(outdir):
    setup_render()
    add_light((.8, -.9, .8), 70, at=(0, -.15, -.15)); add_light((-.9, .2, .4), 25, at=(0, -.15, -.15), col=(.8, .9, 1)); add_light((0, .9, .4), 15, at=(0, -.15, -.15))
    shoot({'back-three-quarter': ((1.1, -1.5, .45), (0, -.15, -.15), 50), 'side': ((1.7, -.15, -.1), (0, -.15, -.15), 50),
           'top-back': ((-.8, -1.3, 1.0), (0, -.12, -.12), 50)}, outdir, 'pack')
def render_tower(outdir, pack_glb=None):
    setup_render()
    ground_plane()
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = .1; so = bpy.data.objects.new('sun', sun); SC.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    if pack_glb and os.path.exists(pack_glb):
        bpy.ops.import_scene.gltf(filepath=pack_glb)
        imp = [o for o in bpy.context.selected_objects if o.parent is None]
        hook = bpy.data.objects['PackHook'].matrix_world.translation
        for o in imp:
            o.rotation_euler = (math.radians(90), 0, math.radians(90)); o.location = hook - Vector((.04, 0, .12))
        bpy.context.view_layer.update()
        exit_p = next(o for o in bpy.context.selected_objects if o.name.startswith('CableExit')).matrix_world.translation.copy()
        for o in bpy.context.selected_objects: o.name = 'Review_' + o.name
        term = bpy.data.objects['CableTerminal'].matrix_world.translation
        drape = [exit_p.lerp(term, t) + Vector((0, .25 * math.sin(math.pi * t), -.55 * math.sin(math.pi * t))) for t in (i / 15 for i in range(16))]
        mesh_obj('Review_Cable', sweep(drape, .018, sides=6), 'Cable', flat=False)
    shoot({'hero-view': ((10.5, 9.5, 2.2), (0, 0, 4.2), 30), 'front': ((0, 15, 3.0), (0, 0, 4.4), 30), 'top-detail': ((4.4, 5.4, 8.6), (.3, .2, 7.2), 30),
           'base-detail': ((4.2, 3.4, 1.8), (.6, .4, 1.1), 28)}, outdir, 'tower')

RESULTS = {}
if PART in ('crossbow', 'all'):
    RESULTS['crossbow'] = build_crossbow()
    if RENDER: render_crossbow(RENDER)
    RESULTS['crossbow']['bytes'] = export(os.path.join(OUT_DIR, 'stormreel.glb'))
if PART in ('pack', 'all'):
    RESULTS['pack'] = build_pack()
    if RENDER: render_pack(RENDER)
    RESULTS['pack']['bytes'] = export(os.path.join(OUT_DIR, 'reel_pack.glb'))
if PART in ('tower', 'all'):
    RESULTS['tower'] = build_tower()
    if RENDER: render_tower(RENDER, os.path.join(OUT_DIR, 'reel_pack.glb'))
    RESULTS['tower']['bytes'] = export(os.path.join(OUT_DIR, 'stormspire.glb'))
RESULTS['seconds'] = round(time.time() - T0, 1)
print(json.dumps(RESULTS))
