"""Brann's Forge VR - orchard world-building kit builder (deterministic).

Run:  blender.exe --background --factory-startup --python output/build_orchard_kit.py
Builds worker / stockpile / waymarker, exports GLBs, saves orchard_kit.blend,
renders review PNGs and writes build_report.json.  Units: metres, Z-up in Blender
(glTF export converts to Y-up).  Characters face Blender -Y (= glTF +Z forward).
"""
import bpy, bmesh, math, random, json, os, time
from mathutils import Vector, Matrix

T0 = time.time()
OUT = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(OUT, "textures")
REV = os.path.join(OUT, "review")
os.makedirs(TEX, exist_ok=True)
os.makedirs(REV, exist_ok=True)
RNG = random.Random(1729)

# ---------------------------------------------------------------- scene reset
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)
for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures,
             bpy.data.actions, bpy.data.cameras, bpy.data.lights):
    for d in list(coll):
        coll.remove(d)
for c in list(bpy.data.collections):
    bpy.data.collections.remove(c)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0
scene.render.fps = 24


def srgb(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c) + (1.0,)


# ---------------------------------------------------------------- textures
def make_image(name, size, fn):
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = [0.0] * (size * size * 4)
    for y in range(size):
        v = y / size
        for x in range(size):
            u = x / size
            r, g, b = fn(u, v)
            i = (y * size + x) * 4
            px[i], px[i + 1], px[i + 2], px[i + 3] = r, g, b, 1.0
    img.pixels = px
    img.filepath_raw = os.path.join(TEX, name + ".png")
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def lerp3(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def grain_fn(light, dark, freq, wobble):
    L, D = srgb(light)[:3], srgb(dark)[:3]
    def fn(u, v):  # grain runs along U
        w = v * freq + wobble * math.sin(2 * math.pi * (u * 2 + v * 0.7)) + 0.35 * math.sin(2 * math.pi * u * 5 + v * 9)
        t = 0.5 + 0.5 * math.sin(2 * math.pi * w)
        t = t ** 2
        streak = 0.05 * math.sin(2 * math.pi * (v * 37 + 0.2 * math.sin(u * 13)))
        return lerp3(L, D, min(1.0, max(0.0, t * 0.5 + streak + 0.12)))
    return fn


def endgrain_fn(u, v):
    L, D, B = srgb('#E2B478')[:3], srgb('#B07A45')[:3], srgb('#5A3C28')[:3]
    dx, dy = u - 0.5, v - 0.5
    r = math.hypot(dx, dy) * 2
    a = math.atan2(dy, dx)
    if r > 0.93:
        return B
    ring = 0.5 + 0.5 * math.sin(2 * math.pi * (r * 7 + 0.05 * math.sin(a * 5)))
    return lerp3(L, D, ring ** 4 * 0.8 + (0.15 if r < 0.06 else 0))


IMG_PLANK = make_image("tex_wood_plank", 256, grain_fn('#C98048', '#9C5A30', 7, 0.06))
IMG_DARK = make_image("tex_wood_dark", 256, grain_fn('#94603A', '#6A4228', 8, 0.07))
IMG_BARK = make_image("tex_bark", 256, grain_fn('#76543A', '#4A3222', 14, 0.03))
IMG_END = make_image("tex_endgrain", 256, endgrain_fn)
IMG_HANDLE = make_image("tex_wood_handle", 128, grain_fn('#D9A46A', '#B07A46', 6, 0.04))


def mat(name, hexcol, rough=0.85, metal=0.0, img=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = srgb(hexcol)
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if img:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = img
        nt.links.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    return m


M = {
    'plank': mat("Wood_Plank", '#B8683A', img=IMG_PLANK),
    'dark': mat("Wood_Dark", '#7A4A2A', img=IMG_DARK),
    'bark': mat("Wood_Bark", '#5E4030', rough=0.95, img=IMG_BARK),
    'end': mat("Wood_EndGrain", '#D9A86A', img=IMG_END),
    'handle': mat("Wood_Handle", '#D0A06A', img=IMG_HANDLE),
    'stone': mat("Stone_Pale", '#D8D3C8', rough=0.9),
    'stone2': mat("Stone_Shade", '#BDB5A7', rough=0.9),
    'moss': mat("Moss", '#8DB33A', rough=0.95),
    'brass': mat("Brass", '#C9973F', rough=0.35, metal=0.85),
    'steel': mat("Steel_Axe", '#A7AEB2', rough=0.3, metal=0.8),
    'skin': mat("Skin", '#E6B08A', rough=0.7),
    'beard': mat("Cloth_Beard", '#B8672E', rough=0.9),
    'shirt': mat("Cloth_Shirt", '#B04A32', rough=0.9),
    'trousers': mat("Cloth_Trousers", '#3F6468', rough=0.9),
    'leather': mat("Leather", '#6B4A33', rough=0.75),
    'boots': mat("Leather_Boots", '#3E2C22', rough=0.8),
    'cap': mat("Cloth_Cap", '#D19A3C', rough=0.9),
    'pennant': mat("Cloth_Pennant", '#B04A32', rough=0.9),
    'eye': mat("Eye_Dark", '#2A1E18', rough=0.4),
}


# ---------------------------------------------------------------- geometry helpers
def bm_box(sx, sy, sz, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * sx, v.co.y * sy, v.co.z * sz))
    if bevel > 0:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=1,
                        affect='EDGES', profile=0.5)
    return bm


def bm_cyl(r1, r2, depth, seg=8):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=seg,
                          radius1=r1, radius2=r2, depth=depth)
    return bm


def bm_ico(r, sub=1, scale=(1, 1, 1)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2]))
    return bm


def bm_prism(poly, thick):
    """poly: list of (x, z) CCW seen from -Y; extruded along Y, centred."""
    bm = bmesh.new()
    f = [bm.verts.new((x, -thick / 2, z)) for x, z in poly]
    b = [bm.verts.new((x, thick / 2, z)) for x, z in poly]
    bm.faces.new(f)
    bm.faces.new(list(reversed(b)))
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((f[i], b[i], b[j], f[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm


def uv_project(bm, grain_axis=None, cap_radius=None, cap_mat=1, scale=1.0):
    """Box projection in the primitive's local space; grain runs along U.
    cylinder caps (|n.z|>0.9) get a centred radial end-grain mapping + material index."""
    uvl = bm.loops.layers.uv.verify()
    bm.normal_update()
    if grain_axis is None:
        ext = [max(v.co[i] for v in bm.verts) - min(v.co[i] for v in bm.verts) for i in range(3)]
        grain_axis = ext.index(max(ext))
    for f in bm.faces:
        n = f.normal
        if cap_radius and abs(n.z) > 0.9:
            f.material_index = cap_mat
            for l in f.loops:
                l[uvl].uv = (0.5 + l.vert.co.x / (2 * cap_radius) * 0.96,
                             0.5 + l.vert.co.y / (2 * cap_radius) * 0.96)
            continue
        dom = max(range(3), key=lambda i: abs(n[i]))
        axes = [i for i in range(3) if i != dom]
        if grain_axis in axes:
            other = axes[0] if axes[1] == grain_axis else axes[1]
            a, b = grain_axis, other
        else:
            a, b = axes
        for l in f.loops:
            l[uvl].uv = (l.vert.co[a] * scale, l.vert.co[b] * scale)


def xf(loc=(0, 0, 0), rot=(0, 0, 0), scl=None):
    m = Matrix.Translation(Vector(loc)) @ (
        Matrix.Rotation(math.radians(rot[2]), 4, 'Z') @ Matrix.Rotation(math.radians(rot[1]), 4, 'Y')
        @ Matrix.Rotation(math.radians(rot[0]), 4, 'X'))
    return m


class Part:
    """Accumulates primitive objects; join() merges into one named mesh."""
    def __init__(self, name, coll):
        self.name, self.coll, self.objs = name, coll, []

    def add(self, bm, mats, matrix, grain=None, cap=None, vgroup=None, matfn=None):
        if isinstance(mats, str):
            mats = [mats]
        uv_project(bm, grain, cap)
        if matfn:
            for f in bm.faces:
                f.material_index = matfn(f)
        bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
        me = bpy.data.meshes.new(self.name + "_tmp")
        bm.to_mesh(me)
        bm.free()
        for k in mats:
            me.materials.append(M[k])
        ob = bpy.data.objects.new(self.name + "_tmp", me)
        self.coll.objects.link(ob)
        if vgroup:
            vg = ob.vertex_groups.new(name=vgroup)
            vg.add(list(range(len(me.vertices))), 1.0, 'REPLACE')
        self.objs.append(ob)
        return ob

    def join(self, parent=None):
        bpy.ops.object.select_all(action='DESELECT')
        for o in self.objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = self.objs[0]
        if len(self.objs) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        ob.name = self.name
        ob.data.name = self.name + "_Mesh"
        # merge duplicate material slots
        if parent:
            ob.parent = parent
        return ob


def new_coll(name):
    c = bpy.data.collections.new(name)
    scene.collection.children.link(c)
    return c


def empty(name, coll, loc, parent=None, size=0.08, etype='PLAIN_AXES', rot=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type = etype
    e.empty_display_size = size
    coll.objects.link(e)
    if parent:
        e.parent = parent
    e.location = loc
    e.rotation_euler = [math.radians(a) for a in rot]
    return e


def moss_clump(part, loc, r, flat=0.35, vgroup=None):
    part.add(bm_ico(r, 1, (1.0, 0.85, flat)), 'moss',
             xf(loc, (0, 0, RNG.uniform(0, 180))), vgroup=vgroup)


REPORT = {"builder": "build_orchard_kit.py", "blender": bpy.app.version_string, "assets": {}}

# ================================================================ WORKER
cw = new_coll("Worker")
arm_data = bpy.data.armatures.new("Worker_Rig")
arm = bpy.data.objects.new("Worker_Rig", arm_data)
cw.objects.link(arm)
bpy.context.view_layer.objects.active = arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
BONES = {}


def bone(name, head, tail, parent=None, roll_to=(0, -1, 0)):
    b = arm_data.edit_bones.new(name)
    b.head, b.tail = Vector(head), Vector(tail)
    b.align_roll(Vector(roll_to))
    if parent:
        b.parent = arm_data.edit_bones[parent]
        b.use_connect = False
    BONES[name] = (head, tail)


bone("root", (0, 0, 0), (0, 0, 0.25))
bone("hips", (0, 0, 0.84), (0, 0, 0.98), "root")
bone("spine", (0, 0, 0.98), (0, 0, 1.24), "hips")
bone("head", (0, 0, 1.26), (0, 0, 1.50), "spine")
for s, sx in (("L", 1), ("R", -1)):
    bone(f"upperarm.{s}", (0.25 * sx, 0, 1.18), (0.28 * sx, 0, 0.95), "spine")
    bone(f"forearm.{s}", (0.28 * sx, 0, 0.95), (0.30 * sx, 0, 0.77), f"upperarm.{s}")
    bone(f"hand.{s}", (0.30 * sx, 0, 0.77), (0.30 * sx, 0, 0.66), f"forearm.{s}")
    bone(f"thigh.{s}", (0.11 * sx, 0, 0.84), (0.11 * sx, 0, 0.46), "hips")
    bone(f"shin.{s}", (0.11 * sx, 0, 0.46), (0.11 * sx, 0, 0.08), f"thigh.{s}")
bpy.ops.object.mode_set(mode='OBJECT')
arm_data.display_type = 'STICK'

P = Part("Worker_Body", cw)
for s, sx in (("L", 1), ("R", -1)):
    x = 0.11 * sx
    # boots with a toe cap and brass lace hook
    P.add(bm_box(0.13, 0.22, 0.10, 0.02), 'boots', xf((x, -0.035, 0.05)), vgroup=f"shin.{s}")
    P.add(bm_box(0.14, 0.06, 0.03, 0.008), 'leather', xf((x, -0.035, 0.115)), vgroup=f"shin.{s}")
    P.add(bm_cyl(0.068, 0.078, 0.34, 8), 'trousers', xf((x, 0, 0.29)), vgroup=f"shin.{s}")
    P.add(bm_ico(0.08, 1), 'trousers', xf((x, 0, 0.46)), vgroup=f"shin.{s}")
    P.add(bm_cyl(0.080, 0.092, 0.38, 8), 'trousers', xf((x, 0, 0.65)), vgroup=f"thigh.{s}")
    # arms
    ux = 0.265 * sx
    P.add(bm_ico(0.078, 1), 'shirt', xf((0.25 * sx, 0, 1.17)), vgroup=f"upperarm.{s}")
    P.add(bm_cyl(0.055, 0.064, 0.22, 8), 'shirt', xf((ux, 0, 1.07), (0, -7 * sx, 0)), vgroup=f"upperarm.{s}")
    P.add(bm_cyl(0.066, 0.066, 0.05, 8), 'shirt', xf((0.28 * sx, 0, 0.945)), vgroup=f"forearm.{s}")
    P.add(bm_cyl(0.042, 0.052, 0.17, 8), 'skin', xf((0.29 * sx, 0, 0.85), (0, -6 * sx, 0)), vgroup=f"forearm.{s}")
    P.add(bm_cyl(0.052, 0.05, 0.05, 8), 'leather', xf((0.30 * sx, 0, 0.765)), vgroup=f"hand.{s}")
    P.add(bm_ico(0.054, 1, (0.9, 1.0, 1.15)), 'leather', xf((0.30 * sx, 0, 0.705)), vgroup=f"hand.{s}")
    # suspenders
    P.add(bm_box(0.04, 0.02, 0.34, 0.004), 'leather', xf((0.09 * sx, -0.135, 1.06), (-6, 0, 0)), vgroup="spine")
    P.add(bm_box(0.04, 0.02, 0.34, 0.004), 'leather', xf((0.09 * sx, 0.135, 1.06), (6, 0, 0)), vgroup="spine")
    P.add(bm_box(0.03, 0.012, 0.03, 0.004), 'brass', xf((0.09 * sx, -0.148, 0.935)), vgroup="spine")
# pelvis + belt
P.add(bm_box(0.34, 0.23, 0.16, 0.03), 'trousers', xf((0, 0, 0.85)), vgroup="hips")
P.add(bm_box(0.36, 0.25, 0.06, 0.015), 'leather', xf((0, 0, 0.92)), vgroup="hips")
P.add(bm_box(0.075, 0.02, 0.06, 0.01), 'brass', xf((0, -0.128, 0.92)), vgroup="hips")
P.add(bm_box(0.09, 0.07, 0.10, 0.012), 'leather', xf((0.19, -0.03, 0.87)), vgroup="hips")  # belt pouch
# torso (barrel chest, slightly flattened front-back)
tb = bm_cyl(0.165, 0.2, 0.30, 10)
for v in tb.verts:
    v.co.y *= 0.72
P.add(tb, 'shirt', xf((0, 0, 1.08)), vgroup="spine")
tb = bm_cyl(0.2, 0.12, 0.08, 10)
for v in tb.verts:
    v.co.y *= 0.72
P.add(tb, 'shirt', xf((0, 0, 1.27)), vgroup="spine")
P.add(bm_cyl(0.052, 0.058, 0.08, 8), 'skin', xf((0, 0, 1.28)), vgroup="head")
# head
P.add(bm_ico(0.13, 2, (1.0, 0.95, 1.05)), 'skin', xf((0, 0, 1.40)), vgroup="head")
P.add(bm_ico(0.028, 1, (1, 1.2, 1)), 'skin', xf((0, -0.13, 1.395)), vgroup="head")  # nose
for sx in (1, -1):
    P.add(bm_box(0.022, 0.012, 0.03, 0.004), 'eye', xf((0.048 * sx, -0.121, 1.43)), vgroup="head")
    P.add(bm_box(0.05, 0.02, 0.016, 0.004), 'beard', xf((0.05 * sx, -0.122, 1.465), (0, 8 * sx, 0)), vgroup="head")
    P.add(bm_ico(0.03, 1, (0.6, 1, 1)), 'skin', xf((0.13 * sx, 0, 1.40)), vgroup="head")  # ears
beard = bm_cyl(0.125, 0.03, 0.2, 8)
for v in beard.verts:
    v.co.y *= 0.7
P.add(beard, 'beard', xf((0, -0.06, 1.285), (12, 0, 0)), vgroup="head")
P.add(bm_box(0.12, 0.03, 0.03, 0.008), 'beard', xf((0, -0.132, 1.37)), vgroup="head")  # moustache
# felt cap: brim, cone, brass pin, pom
P.add(bm_cyl(0.142, 0.138, 0.035, 12), 'cap', xf((0, 0, 1.485)), vgroup="head")
P.add(bm_cyl(0.135, 0.045, 0.14, 10), 'cap', xf((0, 0.015, 1.57), (-10, 0, 0)), vgroup="head")
P.add(bm_cyl(0.143, 0.143, 0.018, 12), 'leather', xf((0, 0, 1.51)), vgroup="head")
P.add(bm_ico(0.02, 1), 'brass', xf((0.105, -0.085, 1.515)), vgroup="head")
P.add(bm_ico(0.03, 1), 'cap', xf((0, 0.04, 1.645)), vgroup="head")

# axe (double-bit, brass bands) in right hand, handle angled 30 deg forward of straight down
GRIP = Vector((-0.30, 0.0, 0.705))
ang = math.radians(30)
D = Vector((0, -math.sin(ang), -math.cos(ang)))      # handle direction (toward head)
axe_rot = (180 - 30, 0, 0)                            # local +Z -> D
hl = 0.78
hc = GRIP + D * (hl / 2 - 0.09)
P.add(bm_cyl(0.019, 0.017, hl, 8), 'handle', xf(tuple(hc), axe_rot), grain=2, vgroup="hand.R")
AXE_HEAD = GRIP + D * (hl - 0.09 - 0.07)
P.add(bm_box(0.05, 0.08, 0.1, 0.01), 'steel', xf(tuple(AXE_HEAD), axe_rot), vgroup="hand.R")
for sgn in (1, -1):
    # prism in local XZ (x outward, z along handle); RotZ(90) maps x -> axe-local +/-Y (blade width axis)
    blade = bm_prism([(0.03, -0.045), (0.15, -0.08), (0.165, 0.0), (0.15, 0.08), (0.03, 0.045)], 0.028)
    P.add(blade, 'steel', xf(tuple(AXE_HEAD), axe_rot) @ Matrix.Rotation(math.radians(90 * sgn), 4, 'Z'),
          vgroup="hand.R")
for bc in (GRIP + D * 0.11, AXE_HEAD - D * 0.09):
    P.add(bm_cyl(0.024, 0.024, 0.03, 8), 'brass', xf(tuple(bc), axe_rot), vgroup="hand.R")
P.add(bm_ico(0.026, 1), 'brass', xf(tuple(GRIP - D * 0.09)), vgroup="hand.R")  # pommel knob
body = P.join(parent=arm)
mod = body.modifiers.new("Armature", 'ARMATURE')
mod.object = arm

# sockets parented to bones
bpy.context.view_layer.update()


def bone_socket(name, bone_name, world_loc, size=0.06):
    e = empty(name, cw, (0, 0, 0), size=size)
    e.parent = arm
    e.parent_type = 'BONE'
    e.parent_bone = bone_name
    bpy.context.view_layer.update()
    pb = arm.pose.bones[bone_name]
    bone_tail_world = arm.matrix_world @ pb.matrix @ Matrix.Translation((0, pb.length, 0))
    e.matrix_parent_inverse = Matrix.Identity(4)
    e.matrix_basis = bone_tail_world.inverted() @ Matrix.Translation(Vector(world_loc))
    return e


SOCK_W = {
    "socket_axe_blade": ("hand.R", tuple(AXE_HEAD + D * 0.02 + Vector((0, -0.0, 0)) )),
    "socket_hand_R": ("hand.R", tuple(GRIP)),
    "socket_hand_L": ("hand.L", (0.30, 0, 0.705)),
    "socket_carry_shoulder": ("spine", (0.0, 0.05, 1.30)),
    "socket_overhead_icon": ("head", (0.0, 0.0, 1.90)),
}
sockets = {k: bone_socket(k, b, loc) for k, (b, loc) in SOCK_W.items()}
empty("socket_ground_center", cw, (0, 0, 0), parent=arm, size=0.2, etype='CIRCLE', rot=(90, 0, 0))

# ---------------------------------------------------------------- animations
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'XYZ'
arm.animation_data_create()
BONE_NAMES = [b.name for b in arm_data.bones]


def make_action(name, keys):
    """keys: {frame: {bone: (rx, ry, rz) deg | 'root_up': m}} ; every bone keyed each frame."""
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    for fr, pose in sorted(keys.items()):
        for bn in BONE_NAMES:
            pb = arm.pose.bones[bn]
            r = pose.get(bn, (0, 0, 0))
            pb.rotation_euler = [math.radians(a) for a in r]
            pb.location = (0, pose.get('root_up', 0.0) if bn == "root" else 0, 0)
            pb.keyframe_insert("rotation_euler", frame=fr)
            if bn == "root":
                pb.keyframe_insert("location", frame=fr)
    return act


idle = make_action("Worker_Idle", {
    1: {"spine": (1, 0, 0), "hand.R": (-21, 0, 0), "upperarm.L": (4, 0, 4), "forearm.L": (8, 0, 0)},
    25: {"spine": (3, 0, 0), "head": (-3, 0, 4), "hand.R": (-21, 0, 0), "upperarm.L": (5, 0, 4), "forearm.L": (10, 0, 0),
         "root_up": -0.005},
    49: {"spine": (1, 0, 0), "hand.R": (-21, 0, 0), "upperarm.L": (4, 0, 4), "forearm.L": (8, 0, 0)},
})


def walk_pose(ph):
    s = 1 if ph == 0 else -1
    return {"thigh.L": (24 * s, 0, 0), "thigh.R": (-24 * s, 0, 0),
            "shin.L": (-8 if s > 0 else -14, 0, 0), "shin.R": (-14 if s > 0 else -8, 0, 0),
            "upperarm.L": (-18 * s, 0, 3), "forearm.L": (14, 0, 0),
            "upperarm.R": (6 * s, 0, 0), "forearm.R": (32, 0, 0), "hand.R": (-12, 0, 0),
            "hips": (0, 0, 5 * s), "spine": (4, 0, -4 * s)}


def walk_pass(lead):
    p = {"thigh.L": (0 if lead else -4, 0, 0), "thigh.R": (-4 if lead else 0, 0, 0),
         "shin.L": (-38 if not lead else -4, 0, 0), "shin.R": (-38 if lead else -4, 0, 0),
         "upperarm.L": (0, 0, 3), "forearm.L": (14, 0, 0), "upperarm.R": (0, 0, 0),
         "forearm.R": (32, 0, 0), "hand.R": (-12, 0, 0), "spine": (4, 0, 0), "root_up": 0.03}
    return p


walk = make_action("Worker_Walk", {1: walk_pose(0), 7: walk_pass(True), 13: walk_pose(1), 19: walk_pass(False),
                                   25: walk_pose(0)})
for d in (walk_pose(0), walk_pose(1)):
    d["root_up"] = -0.01

READY = {"upperarm.R": (22, 0, 0), "forearm.R": (18, 0, 0), "hand.R": (-4, 0, 0),
         "upperarm.L": (30, 0, -10), "forearm.L": (30, 0, 0), "thigh.L": (14, 0, 0), "shin.L": (-10, 0, 0),
         "thigh.R": (-8, 0, 0), "spine": (6, 0, 0)}
chop = make_action("Worker_Chop", {
    1: READY,
    11: {"upperarm.R": (165, 0, 8), "forearm.R": (40, 0, 0), "hand.R": (20, 0, 0),
         "upperarm.L": (120, 0, -18), "forearm.L": (40, 0, 0), "spine": (-9, 0, 0), "head": (-6, 0, 0),
         "thigh.L": (14, 0, 0), "shin.L": (-10, 0, 0), "thigh.R": (-8, 0, 0), "root_up": 0.01},
    16: {"upperarm.R": (38, 0, 4), "forearm.R": (2, 0, 0), "hand.R": (-2, 0, 0),
         "upperarm.L": (40, 0, -12), "forearm.L": (10, 0, 0), "spine": (20, 0, 0), "head": (6, 0, 0),
         "thigh.L": (22, 0, 0), "shin.L": (-22, 0, 0), "thigh.R": (-4, 0, 0), "shin.R": (-12, 0, 0), "root_up": 0.0},
    20: {"upperarm.R": (42, 0, 4), "forearm.R": (4, 0, 0), "hand.R": (0, 0, 0),
         "upperarm.L": (42, 0, -12), "forearm.L": (12, 0, 0), "spine": (18, 0, 0), "head": (4, 0, 0),
         "thigh.L": (22, 0, 0), "shin.L": (-22, 0, 0), "thigh.R": (-4, 0, 0), "shin.R": (-12, 0, 0), "root_up": 0.0},
    37: READY,
})
CLIPS = {"Worker_Idle": (1, 49, True), "Worker_Walk": (1, 25, True), "Worker_Chop": (1, 37, False)}
for act in (idle, walk, chop):
    for fc in act.fcurves if hasattr(act, "fcurves") else []:
        for kp in fc.keyframe_points:
            kp.interpolation = 'BEZIER'
bpy.ops.object.mode_set(mode='OBJECT')

# solve the strike swing so the blade meets the split log on the chopping block
CHOP_TARGET_Z = 0.06 + 0.34 + 0.10          # pad + stump + into the half log
arm.animation_data.action = chop
fc_arm = chop.fcurves.find('pose.bones["upperarm.R"].rotation_euler', index=0)
for ang in range(30, 100, 2):
    for kp in fc_arm.keyframe_points:
        fr = int(round(kp.co.x))
        if fr in (16, 20):
            kp.co.y = math.radians(ang + (4 if fr == 20 else 0))
    fc_arm.update()
    scene.frame_set(16)
    bpy.context.view_layer.update()
    strike = sockets["socket_axe_blade"].matrix_world.translation.copy()
    if strike.z >= CHOP_TARGET_Z - 0.02:
        break
REPORT["chop_strike_upperarm_R_deg"] = ang
scene.frame_set(11)
bpy.context.view_layer.update()
windup_top = max((arm.matrix_world @ pb.head).z for pb in arm.pose.bones)
REPORT["assets"]["worker"] = {"chop_strike_blade_world": [round(c, 3) for c in strike],
                              "clips": {k: {"frames": [a, b], "fps": 24, "loop": l} for k, (a, b, l) in CLIPS.items()}}
arm.animation_data.action = idle
scene.frame_set(1)

# ================================================================ STOCKPILE
cs = new_coll("Stockpile")
sp_root = empty("Stockpile", cs, (0, 0, 0), size=0.5)
PAD = 0.06
S = Part("StoneBase", cs)
for ix in range(5):
    for iy in range(4):
        x = -0.96 + ix * 0.48 + RNG.uniform(-0.02, 0.02)
        y = -0.56 + iy * 0.42 + RNG.uniform(-0.02, 0.02)
        h = PAD + RNG.uniform(-0.012, 0.004)
        S.add(bm_box(0.44 + RNG.uniform(-0.03, 0.01), 0.38 + RNG.uniform(-0.03, 0.01), h, 0.018),
              'stone' if (ix + iy) % 3 else 'stone2', xf((x, y, h / 2), (0, 0, RNG.uniform(-3, 3))))
for loc, r in [((-1.12, 0.62, PAD - 0.01), 0.1), ((1.1, -0.66, PAD - 0.01), 0.08), ((0.25, -0.7, PAD - 0.015), 0.07),
               ((-1.1, -0.2, PAD - 0.01), 0.075), ((1.05, 0.72, PAD - 0.01), 0.09)]:
    moss_clump(S, loc, r)
S.join(sp_root)

W = Part("LogRack", cs)
for x in (-0.62, 0.62):  # sleepers
    W.add(bm_box(0.12, 0.74, 0.08, 0.012), 'dark', xf((x, 0.45, PAD + 0.04)), grain=1)
for x in (-0.95, 0.95):
    for y in (0.1, 0.8):
        W.add(bm_box(0.08, 0.08, 0.72, 0.012), 'dark', xf((x, y, PAD + 0.36), (0, RNG.uniform(-3, 3), 0)), grain=2)
        W.add(bm_cyl(0.056, 0.0, 0.06, 4), 'dark', xf((x, y, PAD + 0.75), (0, 0, 45)))
        W.add(bm_cyl(0.05, 0.05, 0.03, 8), 'brass', xf((x, y, PAD + 0.62), (0, 0, 22.5)))
    moss_clump(W, (x, 0.1, PAD + 0.01), 0.06)
LR = 0.105
rows = [(3, 0.0), (2, 1.0), (1, 2.0)]
logs_top = 0
for n, level in rows:
    z = PAD + 0.08 + LR + level * LR * 1.73
    for i in range(n):
        y = 0.45 + (i - (n - 1) / 2) * LR * 2.02
        L = 1.7 + RNG.uniform(-0.06, 0.06)
        W.add(bm_cyl(LR + RNG.uniform(-0.008, 0.006), LR, L, 9), ['bark', 'end'],
              xf((RNG.uniform(-0.04, 0.04), y, z), (0, 90, 0)), grain=2, cap=LR)
        logs_top = max(logs_top, z + LR)
W.join(sp_root)

C = Part("ChopBlock", cs)
C.add(bm_cyl(0.23, 0.21, 0.34, 10), ['bark', 'end'], xf((-0.72, -0.34, PAD + 0.17)), grain=2, cap=0.22)
for a in range(0, 360, 90):  # root flares
    C.add(bm_cyl(0.06, 0.02, 0.14, 5), 'bark',
          xf((-0.72 + 0.2 * math.cos(math.radians(a + 20)), -0.34 + 0.2 * math.sin(math.radians(a + 20)), PAD + 0.05),
             (0, 60, a + 20)))
# half log waiting on the block + brass wedge
C.add(bm_cyl(0.09, 0.09, 0.34, 8), ['bark', 'end'], xf((-0.72, -0.34, PAD + 0.34 + 0.09), (0, 90, 15)), grain=2, cap=0.09)
C.add(bm_prism([(-0.035, 0.0), (0.035, 0.0), (0.0, -0.08)], 0.05), 'brass', xf((-0.72, -0.34, PAD + 0.34 + 0.2), (0, 0, 15)))
for i in range(9):  # wood chips
    a = RNG.uniform(0, 2 * math.pi)
    r = RNG.uniform(0.28, 0.5)
    C.add(bm_box(0.06, 0.03, 0.012, 0.0), 'plank',
          xf((-0.72 + r * math.cos(a), -0.34 + r * math.sin(a) * 0.7, PAD + 0.006), (0, RNG.uniform(-8, 8), RNG.uniform(0, 180))))
C.join(sp_root)

K = Part("PlankStack", cs)
for i in range(5):
    rz = 0 if i % 2 == 0 else 4
    for j in range(3):
        K.add(bm_box(0.95, 0.15, 0.04, 0.008), 'plank',
              xf((0.6 + RNG.uniform(-0.03, 0.03), -0.34 + (j - 1) * 0.16, PAD + 0.06 + 0.02 + i * 0.042), (0, 0, rz + RNG.uniform(-2, 2))),
              grain=0)
for x in (0.28, 0.92):
    K.add(bm_box(0.1, 0.56, 0.06, 0.01), 'dark', xf((x, -0.34, PAD + 0.03)), grain=1)
    K.add(bm_box(0.012, 0.52, 0.25, 0.0), 'brass', xf((x, -0.34, PAD + 0.13)))
K.join(sp_root)

SP_SOCK = {
    "socket_log_drop": (0.0, 0.45, round(logs_top + 0.1, 3)),
    "socket_log_pickup": (0.0, 0.0, PAD + 0.2),
    "socket_chop_target": (-0.72, -0.34, CHOP_TARGET_Z),
    "socket_worker_chop_stand": None,  # computed below
    "socket_plank_pickup": (0.6, -0.34, round(PAD + 0.06 + 5 * 0.042 + 0.02, 3)),
    "socket_label": (0.0, 0.45, 1.25),
}
# stand so the measured blade strike lands on the half log (blade offset in worker space)
bx, by = strike.x, strike.y
# worker is yawed 180 deg (faces +Y, toward the rack) so the blade offset flips sign
SP_SOCK["socket_worker_chop_stand"] = (round(-0.72 + bx, 3), round(-0.34 + by, 3), 0.0)
REPORT["assets"]["stockpile"] = {"chop_stand_yaw_deg": 180, "blade_strike_height_m": round(strike.z, 3)}
for k, v in SP_SOCK.items():
    e = empty(k, cs, v, parent=sp_root, size=0.08)
    if k == "socket_worker_chop_stand":
        e.empty_display_type = 'SINGLE_ARROW'
        e.rotation_euler = (0, 0, math.radians(180))  # worker forward (-Y) turned to face +Y

# ================================================================ WAYMARKER
cm = new_coll("Waymarker")
wm_root = empty("Waymarker", cm, (0, 0, 0), size=0.3)
F = Part("Footing", cm)
F.add(bm_cyl(0.26, 0.24, 0.1, 8), 'stone', xf((0, 0, 0.05), (0, 0, 22.5)))
F.add(bm_cyl(0.18, 0.16, 0.08, 8), 'stone2', xf((0, 0, 0.14), (0, 0, 5)))
for a in (30, 150, 250):
    F.add(bm_ico(0.07, 1, (1.2, 1, 0.6)), 'stone', xf((0.26 * math.cos(math.radians(a)), 0.26 * math.sin(math.radians(a)), 0.043)))
moss_clump(F, (0.12, -0.14, 0.1), 0.07)
moss_clump(F, (-0.17, 0.1, 0.1), 0.06)
moss_clump(F, (0.04, 0.1, 0.18), 0.05, 0.3)
F.join(wm_root)

Q = Part("Post", cm)
Q.add(bm_box(0.11, 0.11, 1.2, 0.015), 'dark', xf((0, 0, 0.18 + 0.6)), grain=2)
Q.add(bm_cyl(0.105, 0.0, 0.12, 4), 'brass', xf((0, 0, 1.44), (0, 0, 45)))
Q.add(bm_box(0.13, 0.13, 0.04, 0.008), 'brass', xf((0, 0, 1.36)))
Q.add(bm_box(0.125, 0.125, 0.03, 0.006), 'brass', xf((0, 0, 0.26)))
for z in (0.55, 0.62):  # carved survey notches
    Q.add(bm_box(0.116, 0.116, 0.012, 0.0), 'end', xf((0, 0, z)))
Q.join(wm_root)

A = Part("SignArrows", cm)
arrow = [(0.0, -0.07), (0.38, -0.07), (0.38, -0.11), (0.5, 0.0), (0.38, 0.11), (0.38, 0.07), (0.0, 0.07)]
A.add(bm_prism(arrow, 0.035), 'plank', xf((0.04, -0.075, 1.16)), grain=0)
A.add(bm_prism([(x * 0.8, z * 0.8) for x, z in arrow], 0.035), 'plank', xf((-0.04, 0.075, 0.95), (0, 0, 180 + 35)), grain=0)
for x in (0.1, 0.3):
    A.add(bm_ico(0.012, 1), 'brass', xf((0.04 + x, -0.095, 1.16)))
A.add(bm_box(0.3, 0.01, 0.02, 0.0), 'end', xf((0.24, -0.094, 1.16)))  # carved groove
A.join(wm_root)

N = Part("Pennant", cm)
N.add(bm_cyl(0.012, 0.012, 0.26, 6), 'brass', xf((-0.18, 0, 1.30), (0, 90, 0)))
N.add(bm_prism([(0.0, 0.0), (-0.1, -0.3), (-0.2, 0.0)], 0.012), 'pennant', xf((-0.1, 0, 1.29)))
N.add(bm_cyl(0.02, 0.02, 0.04, 8), 'brass', xf((-0.06, 0, 1.30), (0, 90, 0)))
N.join(wm_root)

WM_SOCK = {"socket_route_anchor": (0, 0, 0), "socket_arrow_tip": (0.54, -0.075, 1.16),
           "socket_grab": (0, 0, 1.0), "socket_top_beacon": (0, 0, 1.62), "socket_pennant_tip": (-0.2, 0.0, 0.99)}
for k, v in WM_SOCK.items():
    empty(k, cm, v, parent=wm_root, size=0.06)

# ================================================================ EXPORT
bpy.context.view_layer.update()


def export(coll, fname, anim=False):
    bpy.ops.object.select_all(action='DESELECT')
    for o in coll.all_objects:
        o.select_set(True)
    path = os.path.join(OUT, fname)
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
              export_apply=False, export_lights=False, export_cameras=False, export_extras=False,
              export_materials='EXPORT', export_image_format='AUTO')
    if anim:
        kw.update(export_animations=True, export_animation_mode='ACTIONS', export_force_sampling=True,
                  export_skins=True, export_def_bones=False, export_optimize_animation_size=True)
    else:
        kw.update(export_animations=False)
    bpy.ops.export_scene.gltf(**kw)
    return path


arm.animation_data.action = None
for pb in arm.pose.bones:
    pb.rotation_euler = (0, 0, 0)
    pb.location = (0, 0, 0)
export(cw, "worker.glb", anim=True)
arm.animation_data.action = idle
export(cs, "stockpile.glb")
export(cm, "waymarker.glb")

# ================================================================ REVIEW SCENE (not exported)
cr = new_coll("ReviewStage")
ground = bpy.data.meshes.new("ReviewGround")
bm = bmesh.new()
bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=6)
bm.to_mesh(ground)
g = bpy.data.objects.new("ReviewGround", ground)
g.data.materials.append(mat("Review_Ground", '#CFC9BE', rough=1))
cr.objects.link(g)
corr = bm_box(12, 2.0, 0.004)
me = bpy.data.meshes.new("Corridor2m")
corr.to_mesh(me)
co = bpy.data.objects.new("Corridor2m", me)
co.data.materials.append(mat("Review_Corridor", '#9FB7B5', rough=1))
co.location = (0, -2.0, 0.002)
cr.objects.link(co)

arm.location = (-2.4, -0.6, 0)
sp_root.location = (0.2, 0.0, 0)
wm_root.location = (2.6, -0.45, 0)   # arrow tip reaches y -0.52 +0.0; corridor edge at y -1.0

world = bpy.data.worlds.new("ReviewWorld")
world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = srgb('#A9A6A0')
world.node_tree.nodes['Background'].inputs[1].default_value = 0.9
scene.world = world
sun = bpy.data.lights.new("ReviewSun", 'SUN')
sun.energy = 3.2
sun.angle = math.radians(8)
so = bpy.data.objects.new("ReviewSun", sun)
so.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
cr.objects.link(so)

try:
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
except TypeError:
    scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 1600, 900
scene.render.film_transparent = False
scene.view_settings.view_transform = 'AgX' if 'AgX' in [i.identifier for i in scene.view_settings.bl_rna.properties['view_transform'].enum_items] else 'Filmic'
try:
    scene.eevee.taa_render_samples = 32
    scene.eevee.use_shadows = True
except Exception:
    pass

camd = bpy.data.cameras.new("ReviewCam")
cam = bpy.data.objects.new("ReviewCam", camd)
cr.objects.link(cam)
scene.camera = cam


def shot(fname, loc, rot, ortho=None, res=(1600, 900), lens=35):
    camd.type = 'ORTHO' if ortho else 'PERSP'
    if ortho:
        camd.ortho_scale = ortho
    camd.lens = lens
    cam.location = loc
    cam.rotation_euler = [math.radians(a) for a in rot]
    scene.render.resolution_x, scene.render.resolution_y = res
    scene.render.filepath = os.path.join(REV, fname)
    bpy.ops.render.render(write_still=True)


scene.frame_set(1)
shot("review_front.png", (0.1, -12, 0.9), (90, 0, 0), ortho=7.0)
shot("review_side.png", (12, -0.3, 0.9), (90, 0, 90), ortho=4.2, res=(1200, 900))
shot("review_overhead.png", (0.1, -0.9, 12), (0, 0, 0), ortho=7.2)
shot("review_vr_eye.png", (0.1, -5.6, 1.6), (82, 0, 0), res=(1600, 900), lens=22)
# worker pose sheet (side view, orthographic)
arm.location = (0, 0, 0)
for tag, act, fr in (("idle", idle, 1), ("walk", walk, 7), ("chop_windup", chop, 11), ("chop_strike", chop, 16)):
    arm.animation_data.action = act
    scene.frame_set(fr)
    for o in (sp_root, wm_root):
        o.hide_render = True
    for c in cs.all_objects:
        c.hide_render = True
    for c in cm.all_objects:
        c.hide_render = True
    shot(f"worker_{tag}_side.png", (6, 0.15, 1.0), (90, 0, 90), ortho=2.4, res=(800, 800))
shot("worker_chop_strike_front.png", (-0.1, -6, 1.0), (90, 0, 0), ortho=2.4, res=(800, 800))
for c in list(cs.all_objects) + list(cm.all_objects):
    c.hide_render = False
arm.animation_data.action = idle
scene.frame_set(1)
arm.location = (0, 0, 0)
sp_root.location = (0, 0, 0)
wm_root.location = (0, 0, 0)
cr.hide_render = True
cr.hide_viewport = True

REPORT["build_seconds"] = round(time.time() - T0, 2)
REPORT["render_engine"] = scene.render.engine
cr.hide_render = False
cr.hide_viewport = False
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "orchard_kit.blend"), compress=True)
with open(os.path.join(OUT, "build_report.json"), "w") as fh:
    json.dump(REPORT, fh, indent=2)
print("BUILD OK", REPORT)
