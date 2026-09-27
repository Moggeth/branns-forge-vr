"""Brann's Forge — "Anvilwatch" forge lantern (Opus design).

Deterministic standalone builder for Blender 4.5.13:
  blender.exe --background --factory-startup --python build.py -- --out ABSOLUTE_DIR [--no-render]

Design: squat hammered-copper cage on a stepped anvil plinth, glowing rune-etched
horn panes, a pyramid roof crowned with a tiny anvil finial, and a leather-wrapped
bail grip. The front is a hinged brass sun-door with a curled thumb ring.

Blender is Z-up; the glTF exporter converts to Godot +Y up. Blender -Y == Godot +Z (front).
Rotation about Blender +Z == rotation about Godot +Y.
"""
import bpy, bmesh, math, os, sys, json, random
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = None
RENDER = "--no-render" not in argv
if "--out" in argv:
    OUT = argv[argv.index("--out") + 1]
if not OUT or not os.path.isabs(OUT):
    raise SystemExit("usage: -- --out ABSOLUTE_DIRECTORY")
os.makedirs(os.path.join(OUT, "textures"), exist_ok=True)

SHUTTER_OPEN = 1.72
TEX = 256

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0


# ---------------------------------------------------------------- textures
def save_image(name, px):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    img.pixels.foreach_set(px)
    path = os.path.join(OUT, "textures", name + ".png")
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def clamp(v):
    return 0.0 if v < 0 else 1.0 if v > 1 else v


def horn_texture():
    """Amber horn with fibrous streaks, a burnt border and an anvil-and-spark rune."""
    rng = random.Random(1717)
    phases = [(rng.uniform(0, 6.28), rng.uniform(3, 9), rng.uniform(0.02, 0.06)) for _ in range(6)]
    px = []
    for j in range(TEX):
        v = j / (TEX - 1)
        for i in range(TEX):
            u = i / (TEX - 1)
            fib = sum(a * math.sin(v * f * 6.28 + p + 7 * u * a) for p, f, a in phases)
            glow = 1.0 - 1.6 * ((u - 0.5) ** 2 + (v - 0.45) ** 2)
            r = 0.98 * glow + fib
            g = 0.62 * glow + fib * 0.7
            b = 0.22 * glow + fib * 0.3
            dark = 0.0
            # burnt edge border
            e = min(u, v, 1 - u, 1 - v)
            if e < 0.06:
                dark = max(dark, 0.75 * (1 - e / 0.06))
            # inner rune ring
            d = math.hypot(u - 0.5, v - 0.5)
            if 0.34 < d < 0.36:
                dark = max(dark, 0.55)
            # anvil glyph (v up)
            if (0.28 < u < 0.72 and 0.50 < v < 0.56) or (0.40 < u < 0.60 and 0.36 < v < 0.50) \
                    or (0.32 < u < 0.68 and 0.30 < v < 0.36) or (0.20 < u < 0.30 and 0.52 < v < 0.555):
                dark = max(dark, 0.7)
            # spark ticks above the anvil
            for k in range(3):
                cx = 0.40 + 0.10 * k
                if abs(u - cx) < 0.012 and 0.62 + 0.03 * (k % 2) < v < 0.72 + 0.03 * (k % 2):
                    dark = max(dark, 0.6)
            s = 1 - dark
            px += [clamp(r * s), clamp(g * s), clamp(b * s * 0.8), 1.0]
    return save_image("T_Anvilwatch_Horn", px)


def copper_texture():
    """Hammered copper: jittered-grid dimples with warm highlights and dark verdigris seams."""
    rng = random.Random(4242)
    N = 12
    pts = {(a, b): (rng.random(), rng.random()) for a in range(N) for b in range(N)}
    px = []
    for j in range(TEX):
        y = j / TEX * N
        for i in range(TEX):
            x = i / TEX * N
            cx, cy = int(x), int(y)
            d1 = d2 = 9.0
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    gx, gy = cx + dx, cy + dy
                    ox, oy = pts[(gx % N, gy % N)]
                    d = math.hypot(gx + ox - x, gy + oy - y)
                    if d < d1:
                        d1, d2 = d, d1
                    elif d < d2:
                        d2 = d
            dimple = clamp(d1 * 1.3)
            seam = clamp((d2 - d1) * 14)
            l = 0.72 + 0.28 * (1 - dimple)
            r, g, b = 0.80 * l, 0.42 * l, 0.22 * l
            if seam < 1:
                t = 1 - seam
                r, g, b = r * (1 - 0.35 * t), g * (1 - 0.25 * t), b * (1 - 0.1 * t) + 0.03 * t
            px += [clamp(r), clamp(g), clamp(b), 1.0]
    return save_image("T_Anvilwatch_HammeredCopper", px)


IMG_HORN = horn_texture()
IMG_COPPER = copper_texture()


# ---------------------------------------------------------------- materials
def material(name, color, rough, metal, img=None, emit=None, strength=0.0, emit_img=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if img:
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.location = (-400, 200)
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if emit_img:
            nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
    if emit:
        if not emit_img:
            bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = strength
    return m


M_COPPER = material("M_HammeredCopper", (0.8, 0.45, 0.25), 0.38, 0.9, IMG_COPPER)
M_IRON = material("M_BlackenedIron", (0.07, 0.065, 0.07), 0.55, 0.85)
M_BRASS = material("M_SunBrass", (0.95, 0.72, 0.28), 0.3, 1.0)
M_HORN = material("M_RuneHorn", (1, 0.7, 0.3), 0.6, 0.0, IMG_HORN, emit=(1, 1, 1), strength=0.9, emit_img=True)
M_LEATHER = material("M_OxbloodLeather", (0.16, 0.035, 0.022), 0.7, 0.0)
M_WAX = material("M_TallowWax", (0.93, 0.85, 0.66), 0.5, 0.0, emit=(1.0, 0.6, 0.25), strength=0.3)
M_FLAME = material("M_Flame", (1.0, 0.55, 0.12), 0.5, 0.0, emit=(1.0, 0.5, 0.1), strength=8.0)


# ---------------------------------------------------------------- mesh helpers
def box_uv(obj, fit=False, scale=22.0):
    me = obj.data
    bm = bmesh.new()
    bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    if fit:
        xs = [v.co for v in bm.verts]
        mn = Vector((min(c.x for c in xs), min(c.y for c in xs), min(c.z for c in xs)))
        mx = Vector((max(c.x for c in xs), max(c.y for c in xs), max(c.z for c in xs)))
        size = mx - mn
    for f in bm.faces:
        n = f.normal
        ax = max(range(3), key=lambda k: abs(n[k]))
        a, b = [(1, 2), (0, 2), (0, 1)][ax]
        for l in f.loops:
            co = l.vert.co
            if fit:
                l[uv].uv = ((co[a] - mn[a]) / (size[a] or 1), (co[b] - mn[b]) / (size[b] or 1))
            else:
                w = obj.matrix_world @ co if obj.parent is None else co
                l[uv].uv = (w[a] * scale, w[b] * scale)
    bm.to_mesh(me)
    bm.free()


def finish(obj, name, mat, bevel=0.0, smooth=False, fit=False, parent=None, loc=None):
    obj.name = name
    obj.data.name = name + "_Mesh"
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
        if loc is not None:
            obj.location = loc
    bpy.context.view_layer.update()
    # bake scale into the mesh so bevels are even
    obj.data.transform(Matrix.Diagonal((*obj.scale, 1)))
    obj.scale = (1, 1, 1)
    box_uv(obj, fit=fit)
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    if bevel:
        mod = obj.modifiers.new("Bevel", 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
        mod.harden_normals = False
    return obj


def box(name, mat, size, loc, bevel=0.0012, rot=(0, 0, 0), fit=False, parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object
    o.scale = size
    return finish(o, name, mat, bevel, fit=fit, parent=parent, loc=loc if parent else None)


def cyl(name, mat, r, depth, loc, rot=(0, 0, 0), verts=16, parent=None, bevel=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    return finish(o, name, mat, bevel, smooth=True, parent=parent, loc=loc if parent else None)


def cone(name, mat, r1, r2, depth, loc, verts=4, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    return finish(bpy.context.active_object, name, mat, 0.0015)


# ---------------------------------------------------------------- dimensions (Blender Z-up, metres)
P = 0.050        # corner post centre half-extent
PR = 0.008       # post radius
Z_BASE = 0.032   # top of plinth
Z_EAVE = 0.222   # bottom of roof
HX, HY = P + 0.011, -(P + 0.011)   # shutter hinge pivot (front-right corner, outboard)
DOOR_W = 0.112
DOOR_Z0, DOOR_Z1 = 0.044, 0.210
DOOR_ZC = (DOOR_Z0 + DOOR_Z1) / 2
DOOR_H = DOOR_Z1 - DOOR_Z0
GRIP_Z = 0.398

root = bpy.data.objects.new("ForgeLantern", None)
scene.collection.objects.link(root)
static = []

# plinth: stepped anvil-foot
static.append(box("Plinth_Foot", M_IRON, (0.140, 0.140, 0.012), (0, 0, 0.006), 0.002))
static.append(box("Plinth_Step", M_COPPER, (0.124, 0.124, 0.012), (0, 0, 0.018), 0.0015))
static.append(box("Plinth_Top", M_IRON, (0.112, 0.112, 0.008), (0, 0, 0.028), 0.0012))
for sx in (-1, 1):  # anvil horn nubs on the foot sides
    static.append(cone(f"Plinth_Horn_{'L' if sx < 0 else 'R'}", M_IRON, 0.008, 0.002, 0.016,
                       (sx * 0.078, 0, 0.0085), verts=8, rot=(0, sx * math.pi / 2, 0)))

# corner posts with rivet caps
post_h = Z_EAVE - Z_BASE
for i, (sx, sy) in enumerate(((1, 1), (-1, 1), (-1, -1), (1, -1))):
    static.append(cyl(f"Post_{i}", M_IRON, PR, post_h, (sx * P, sy * P, Z_BASE + post_h / 2), verts=8))
    for z in (Z_BASE + 0.004, Z_EAVE - 0.004):
        static.append(cyl(f"Post_{i}_Rivet_{z:.3f}", M_BRASS, PR + 0.0015, 0.006, (sx * P, sy * P, z), verts=12))

# horizontal bands (all four sides)
for z, tag in ((Z_BASE + 0.004, "Low"), (Z_EAVE - 0.004, "High")):
    for s in (-1, 1):
        static.append(box(f"Band_{tag}_X{s:+d}", M_COPPER, (0.006, 2 * P, 0.008), (s * P, 0, z), 0.001))
        static.append(box(f"Band_{tag}_Y{s:+d}", M_COPPER, (2 * P, 0.006, 0.008), (0, s * P, z), 0.001))

# horn panes on the sides and back (front is the door opening)
pane_h = DOOR_Z1 - 0.040
pane_zc = 0.040 + pane_h / 2
static.append(box("Pane_Right", M_HORN, (0.003, 2 * P - 0.010, pane_h), (P - 0.002, 0, pane_zc), 0, fit=True))
static.append(box("Pane_Left", M_HORN, (0.003, 2 * P - 0.010, pane_h), (-P + 0.002, 0, pane_zc), 0, fit=True))
static.append(box("Pane_Back", M_HORN, (2 * P - 0.010, 0.003, pane_h), (0, P - 0.002, pane_zc), 0, fit=True))
# diagonal cross-straps over the side panes
for s in (-1, 1):
    for d in (-1, 1):
        ang = d * math.atan2(2 * P - 0.018, pane_h - 0.018)
        static.append(box(f"Strap_X{s:+d}_{d:+d}", M_COPPER, (0.003, 0.004, math.hypot(pane_h - 0.018, 2 * P - 0.018)),
                          (s * (P + 0.0015), 0, pane_zc), 0.0006, rot=(ang, 0, 0)))

# candle dish, candle, flame
static.append(cyl("Candle_Dish", M_BRASS, 0.026, 0.005, (0, 0, Z_BASE + 0.0025), verts=24, bevel=0.001))
static.append(cyl("Candle", M_WAX, 0.013, 0.042, (0, 0, Z_BASE + 0.005 + 0.021), verts=16))
bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=10, radius=1, location=(0, 0, 0.100))
flame = bpy.context.active_object
for v in flame.data.vertices:  # teardrop: pinch the top
    t = (v.co.z + 1) / 2
    k = 1.0 - 0.85 * t ** 1.6
    v.co.x *= k
    v.co.y *= k
flame.scale = (0.011, 0.011, 0.024)
finish(flame, "Flame", M_FLAME, smooth=True)

# roof: eave slab + hipped pyramid + vents + anvil finial
static.append(box("Roof_Eave", M_IRON, (0.138, 0.138, 0.008), (0, 0, Z_EAVE + 0.004), 0.0015))
static.append(cone("Roof_Pyramid", M_COPPER, 0.066 * math.sqrt(2), 0.012, 0.058, (0, 0, Z_EAVE + 0.008 + 0.029),
                   verts=4, rot=(0, 0, math.pi / 4)))
static.append(cyl("Roof_Chimney", M_IRON, 0.012, 0.014, (0, 0, 0.292), verts=12, bevel=0.001))
static.append(box("Finial_Anvil_Waist", M_IRON, (0.010, 0.010, 0.008), (0, 0, 0.303), 0.001))
static.append(box("Finial_Anvil_Face", M_IRON, (0.030, 0.012, 0.007), (0.003, 0, 0.310), 0.0012))
static.append(cone("Finial_Anvil_Horn", M_IRON, 0.0045, 0.0005, 0.014, (-0.018, 0, 0.310), verts=8,
                   rot=(0, -math.pi / 2, 0)))

# bail handle (curve -> mesh) and leather grip
cd = bpy.data.curves.new("Bail", 'CURVE')
cd.dimensions = '3D'
cd.bevel_depth = 0.0068
cd.bevel_resolution = 3
sp = cd.splines.new('NURBS')
pts = [(-0.056, 0, 0.236), (-0.056, 0, 0.330), (-0.058, 0, 0.398), (-0.030, 0, GRIP_Z),
       (0.030, 0, GRIP_Z), (0.058, 0, 0.398), (0.056, 0, 0.330), (0.056, 0, 0.236)]
sp.points.add(len(pts) - 1)
for p, c in zip(sp.points, pts):
    p.co = (*c, 1)
sp.order_u = 3
sp.use_endpoint_u = True
sp.resolution_u = 10
bail_c = bpy.data.objects.new("Bail", cd)
scene.collection.objects.link(bail_c)
bpy.context.view_layer.objects.active = bail_c
bail_c.select_set(True)
bpy.ops.object.convert(target='MESH')
bail = bpy.context.active_object
finish(bail, "Bail", M_IRON, smooth=True)
static.append(bail)
for sx in (-1, 1):
    static.append(cyl(f"Bail_Boss_{sx:+d}", M_BRASS, 0.009, 0.010, (sx * 0.056, 0, 0.240), verts=12, bevel=0.001))
static.append(cyl("Grip_Leather", M_LEATHER, 0.0150, 0.070, (0, 0, GRIP_Z), rot=(0, math.pi / 2, 0), verts=20))
for sx in (-1, 1):
    static.append(cyl(f"Grip_Ferrule_{sx:+d}", M_BRASS, 0.0165, 0.006, (sx * 0.037, 0, GRIP_Z),
                      rot=(0, math.pi / 2, 0), verts=20, bevel=0.0008))

# ---------------------------------------------------------------- sockets
grip = bpy.data.objects.new("Grip", None)
grip.empty_display_type = 'ARROWS'
grip.empty_display_size = 0.03
grip.location = (0, 0, GRIP_Z)
scene.collection.objects.link(grip)

bpy.ops.mesh.primitive_cube_add(size=1)
gcol = bpy.context.active_object
gcol.name = "GripCollision-colonly"
gcol.data.name = "GripCollision_Mesh"
gcol.parent = grip
gcol.scale = (0.090, 0.036, 0.036)
gcol.display_type = 'WIRE'
gcol.hide_render = True

bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 0.160))
bcol = bpy.context.active_object
bcol.name = "BodyCollision-colonly"
bcol.data.name = "BodyCollision_Mesh"
bcol.scale = (0.140, 0.140, 0.320)
bcol.display_type = 'WIRE'
bcol.hide_render = True

hinge = bpy.data.objects.new("ShutterHinge", None)
hinge.empty_display_type = 'SINGLE_ARROW'
hinge.empty_display_size = 0.05
hinge.location = (HX, HY, DOOR_ZC)
scene.collection.objects.link(hinge)

# shutter geometry, local to hinge: spans local -X from the pivot, outer face toward local -Y
moving = []
T = 0.004
moving.append(cyl("Shutter_Barrel", M_BRASS, 0.005, DOOR_H, (0, 0, 0), verts=12, parent=hinge, bevel=0.0006))
moving.append(box("Shutter_Frame_Top", M_COPPER, (DOOR_W - 0.004, T, 0.012), (-DOOR_W / 2 - 0.002, -T / 2, DOOR_H / 2 - 0.006), parent=hinge))
moving.append(box("Shutter_Frame_Bottom", M_COPPER, (DOOR_W - 0.004, T, 0.012), (-DOOR_W / 2 - 0.002, -T / 2, -DOOR_H / 2 + 0.006), parent=hinge))
moving.append(box("Shutter_Frame_Free", M_COPPER, (0.010, T, DOOR_H), (-DOOR_W + 0.005, -T / 2, 0), parent=hinge))
moving.append(box("Shutter_Frame_Hinge", M_COPPER, (0.010, T, DOOR_H), (-0.009, -T / 2, 0), parent=hinge))
moving.append(box("Shutter_Pane", M_HORN, (DOOR_W - 0.022, 0.002, DOOR_H - 0.022), (-DOOR_W / 2 - 0.002, -0.0015, 0), 0, fit=True, parent=hinge))
SUN_X = -DOOR_W / 2 - 0.002
moving.append(cyl("Shutter_Sun", M_BRASS, 0.017, 0.004, (SUN_X, -0.005, 0.008), rot=(math.pi / 2, 0, 0), verts=20, parent=hinge, bevel=0.0008))
for k in range(8):
    a = k * math.pi / 4
    ln = 0.040 if k % 2 == 0 else 0.030
    r = moving.append(box(f"Shutter_Ray_{k}", M_BRASS, (0.004, 0.003, ln),
                          (SUN_X + math.sin(a) * (0.017 + ln / 2 - 0.004), -0.0045, 0.008 + math.cos(a) * (0.017 + ln / 2 - 0.004)),
                          0.0006, rot=(0, a, 0), parent=hinge))
for z in (-0.055, 0.055):  # hinge straps
    moving.append(box(f"Shutter_Strap_{z:+.3f}", M_IRON, (0.030, 0.002, 0.010), (-0.016, -T - 0.001, z), 0.0005, parent=hinge))
# curled thumb ring on the free edge
THUMB = Vector((-DOOR_W + 0.012, -0.020, -0.010))
bpy.ops.mesh.primitive_torus_add(major_radius=0.011, minor_radius=0.0035, major_segments=20, minor_segments=8)
ring = bpy.context.active_object
finish(ring, "Shutter_ThumbRing", M_BRASS, smooth=True, parent=hinge, loc=THUMB + Vector((0, 0.004, 0)))
moving.append(ring)
moving.append(box("Shutter_ThumbStem", M_BRASS, (0.006, 0.012, 0.004), (THUMB.x, -0.008, THUMB.z), 0.0006, parent=hinge))
thumb = bpy.data.objects.new("ShutterThumb", None)
thumb.empty_display_type = 'SPHERE'
thumb.empty_display_size = 0.012
thumb.parent = hinge
thumb.location = THUMB
scene.collection.objects.link(thumb)

# parent everything top-level under root
for o in list(scene.collection.objects):
    if o is not root and o.parent is None:
        o.parent = root
bpy.context.view_layer.update()


# ---------------------------------------------------------------- verification
def world_bvh(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    verts, polys = [], []
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        base = len(verts)
        verts += [o.matrix_world @ v.co for v in me.vertices]
        polys += [[base + i for i in p.vertices] for p in me.polygons]
        ev.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys), verts


def bounds(objs):
    _, vs = world_bvh(objs)
    mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return mn, mx


visible = [o for o in scene.objects if o.type == 'MESH' and not o.name.endswith("-colonly")]
report = {"sweep": []}
static_all = [o for o in visible if o not in moving]
static_bvh, _ = world_bvh(static_all)
for k in range(13):
    ang = SHUTTER_OPEN * k / 12
    hinge.rotation_euler.z = ang
    bpy.context.view_layer.update()
    mb, _ = world_bvh(moving)
    hits = mb.overlap(static_bvh)
    report["sweep"].append({"angle": round(ang, 4), "overlapping_face_pairs": len(hits)})


def godot(v):  # Blender (x,y,z) -> glTF/Godot (x, z, -y)
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


for pose, ang in (("closed", 0.0), ("open", SHUTTER_OPEN)):
    hinge.rotation_euler.z = ang
    bpy.context.view_layer.update()
    mn, mx = bounds(visible)
    gmn, gmx = godot(Vector((mn.x, mx.y, mn.z))), godot(Vector((mx.x, mn.y, mx.z)))
    report[f"bounds_{pose}_godot"] = {"min": gmn, "max": gmx,
                                      "size": [round(b - a, 4) for a, b in zip(gmn, gmx)]}
    report[f"thumb_{pose}_godot"] = godot(thumb.matrix_world.translation)
hinge.rotation_euler.z = 0
bpy.context.view_layer.update()
report["grip_godot"] = godot(grip.matrix_world.translation)
report["flame_godot"] = godot(bpy.data.objects["Flame"].matrix_world.translation)
report["shutter_hinge_godot"] = godot(hinge.matrix_world.translation)
dg = bpy.context.evaluated_depsgraph_get()
tris = 0
for o in visible:
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    tris += len(me.loop_triangles)
    ev.to_mesh_clear()
report["triangles_visible"] = tris
report["mesh_objects_visible"] = len(visible)
report["collision_meshes"] = [o.name for o in scene.objects if o.name.endswith("-colonly")]
report["materials"] = sorted(m.name for m in bpy.data.materials if m.users)
report["images"] = sorted(i.name for i in bpy.data.images if i.users)

# ---------------------------------------------------------------- save / export
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "anvilwatch_lantern.blend"), compress=False)
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "model.glb"), export_format='GLB',
                          export_apply=True, export_yup=True, export_image_format='AUTO',
                          export_extras=False, export_cameras=False, export_lights=False)

# ---------------------------------------------------------------- renders
if RENDER:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.render.resolution_x = scene.render.resolution_y = 900
    scene.eevee.taa_render_samples = 48
    scene.view_settings.view_transform = 'AgX'
    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.045, 0.035, 0.035, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=3, location=(0, 0, -0.0005))
    floor = bpy.context.active_object
    floor.name = "RenderFloor"
    floor.data.materials.append(material("M_RenderFloor", (0.09, 0.075, 0.07), 0.8, 0))
    ld = bpy.data.lights.new("Key", 'AREA'); ld.energy = 40; ld.size = 0.6
    key = bpy.data.objects.new("Key", ld); scene.collection.objects.link(key)
    key.location = (0.6, -0.7, 0.9); key.rotation_euler = (math.radians(50), 0, math.radians(40))
    ld2 = bpy.data.lights.new("Rim", 'AREA'); ld2.energy = 25; ld2.size = 0.5; ld2.color = (0.6, 0.75, 1.0)
    rim = bpy.data.objects.new("Rim", ld2); scene.collection.objects.link(rim)
    rim.location = (-0.6, 0.7, 0.6); rim.rotation_euler = (math.radians(-55), 0, math.radians(-140))
    lf = bpy.data.lights.new("FlameLight", 'POINT'); lf.energy = 1.5; lf.color = (1, 0.55, 0.2); lf.shadow_soft_size = 0.01
    fl = bpy.data.objects.new("FlameLight", lf); scene.collection.objects.link(fl); fl.location = (0, 0, 0.12)
    cam_d = bpy.data.cameras.new("Cam"); cam_d.lens = 70
    cam = bpy.data.objects.new("Cam", cam_d); scene.collection.objects.link(cam); scene.camera = cam
    target = Vector((0, -0.02, 0.19))

    def shot(fname, az_deg, el_deg, ang, dist=0.95):
        hinge.rotation_euler.z = ang
        az, el = math.radians(az_deg), math.radians(el_deg)
        cam.location = target + dist * Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))
        cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = os.path.join(OUT, fname)
        bpy.ops.render.render(write_still=True)

    shot("render_front_closed.png", 0, 8, 0)
    shot("render_side_closed.png", 90, 8, 0)
    shot("render_threequarter_closed.png", 35, 18, 0)
    shot("render_threequarter_open.png", 35, 18, SHUTTER_OPEN)
    shot("render_front_open.png", -20, 12, SHUTTER_OPEN)
    hinge.rotation_euler.z = 0

with open(os.path.join(OUT, "stats.json"), "w") as f:
    json.dump(report, f, indent=2)
print("ANVILWATCH_REPORT " + json.dumps(report))
