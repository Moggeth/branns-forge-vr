"""Deterministic builder for the Brann's Forge VR player adventurer.

Run:  blender -b --factory-startup -P build_player.py [-- --no-render]
Writes output/player.glb, output/player.blend, output/renders/*.png, output/validation.json.

Blender space: +Z up, character faces +Y, character right = +X.
glTF export (+Y up) maps that to Godot: +Y up, -Z forward, right = +X.
"""
import bpy, bmesh, math, os, sys, json, struct, random
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output")
REN = os.path.join(OUT, "renders")
os.makedirs(REN, exist_ok=True)
NO_RENDER = "--no-render" in sys.argv
RNG = random.Random(1729)

# ---------------------------------------------------------------- palette atlas
# 8x8 swatches of 8 px -> one 64x64 base-colour, ORM and emission texture.
GRID, CELL = 8, 8
SW = {}  # name -> (index, srgb, roughness, metallic, emissive)
def swatch(name, rgb, rough=0.8, metal=0.0, emit=0.0):
    SW[name] = (len(SW), rgb, rough, metal, emit)
swatch("skin",      (0.86, 0.64, 0.50), 0.65)
swatch("blush",     (0.90, 0.52, 0.48), 0.65)
swatch("hair",      (0.40, 0.22, 0.13), 0.7)
swatch("hair_hi",   (0.55, 0.33, 0.18), 0.7)
swatch("eye",       (0.09, 0.06, 0.05), 0.25)
swatch("white",     (0.98, 0.97, 0.94), 0.3)
swatch("mouth",     (0.55, 0.24, 0.22), 0.6)
swatch("coat",      (0.30, 0.42, 0.27), 0.9)   # moss wool
swatch("coat_dk",   (0.21, 0.30, 0.20), 0.9)
swatch("linen",     (0.88, 0.81, 0.66), 0.95)
swatch("scarf",     (0.76, 0.33, 0.18), 0.9)   # rust
swatch("scarf_hi",  (0.88, 0.58, 0.28), 0.9)
swatch("leather",   (0.50, 0.31, 0.17), 0.6)
swatch("leather_dk",(0.28, 0.17, 0.10), 0.6)
swatch("leather_lt",(0.66, 0.45, 0.27), 0.6)
swatch("trouser",   (0.40, 0.33, 0.28), 0.9)
swatch("sole",      (0.16, 0.12, 0.10), 0.8)
swatch("brass",     (0.86, 0.66, 0.30), 0.35, 1.0)
swatch("felt",      (0.20, 0.30, 0.62), 0.95)  # perch pad, echoes the fairy
swatch("gem",       (0.45, 0.80, 1.00), 0.2, 0.0, 1.0)
swatch("inner",     (0.12, 0.09, 0.08), 1.0)

def to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def build_textures():
    n = GRID * CELL
    base, orm, emi = ([0.0] * (n * n * 4) for _ in range(3))
    for name, (i, rgb, rough, metal, emit) in SW.items():
        gx, gy = i % GRID, i // GRID
        for py in range(CELL):
            for px in range(CELL):
                # gentle painted gradient: faces sample different points of it
                shade = 0.93 + 0.11 * (px / (CELL - 1))
                warm = 0.03 * (py / (CELL - 1) - 0.5)
                x, y = gx * CELL + px, gy * CELL + py
                k = (y * n + x) * 4
                c = [min(1.0, rgb[0] * shade + warm), min(1.0, rgb[1] * shade), max(0.0, rgb[2] * shade - warm)]
                base[k:k + 4] = [c[0], c[1], c[2], 1.0]  # stored sRGB
                orm[k:k + 4] = [1.0, rough, metal, 1.0]
                e = rgb if emit else (0, 0, 0)
                emi[k:k + 4] = [e[0], e[1], e[2], 1.0]
    imgs = []
    for nm, px, cs in (("player_base", base, "sRGB"), ("player_orm", orm, "Non-Color"), ("player_emit", emi, "sRGB")):
        img = bpy.data.images.new(nm, n, n, alpha=False)
        img.colorspace_settings.name = cs
        img.pixels[:] = px
        img.filepath_raw = os.path.join(OUT, nm + ".png")
        img.file_format = "PNG"
        img.save()
        img.pack()
        imgs.append(img)
    return imgs

def make_material(imgs):
    base, orm, emi = imgs
    m = bpy.data.materials.new("Adventurer")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    def tex(img, x, y):
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img; t.location = (x, y)
        t.interpolation = "Linear"; return t
    tb = tex(base, -600, 300); to = tex(orm, -600, 0); te = tex(emi, -600, -300)
    sep = nt.nodes.new("ShaderNodeSeparateRGB"); sep.location = (-300, 0)
    nt.links.new(tb.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(to.outputs["Color"], sep.inputs["Image"])
    nt.links.new(sep.outputs["G"], bsdf.inputs["Roughness"])
    nt.links.new(sep.outputs["B"], bsdf.inputs["Metallic"])
    nt.links.new(te.outputs["Color"], bsdf.inputs["Emission"])
    bsdf.inputs["Emission Strength"].default_value = 1.0
    bsdf.inputs["Specular"].default_value = 0.35
    return m

def swatch_uv(name):
    i = SW[name][0]
    gx, gy = i % GRID, i // GRID
    m = 1.5 / (GRID * CELL)  # keep samples away from neighbours
    u = (gx + RNG.random()) / GRID
    v = (gy + RNG.random()) / GRID
    u = min(max(u, gx / GRID + m), (gx + 1) / GRID - m)
    v = min(max(v, gy / GRID + m), (gy + 1) / GRID - m)
    return u, v

# ---------------------------------------------------------------- primitives
class Part:
    """Accumulates primitives in world space; becomes one mesh object."""
    def __init__(self, name):
        self.name, self.bm = name, bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")

    def _finish(self, verts, sw, smooth=True):
        vs = set(verts)
        faces = {f for v in vs for f in v.link_faces if all(x in vs for x in f.verts)}
        uv = swatch_uv(sw)  # one tint per piece: reads as painted cloth, not a checkerboard
        for f in faces:
            f.smooth = smooth
            for l in f.loops:
                l[self.uv].uv = uv
        return verts

    def ellipsoid(self, c, r, sw, rot=(0, 0, 0), seg=16, ring=10, smooth=True):
        res = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=ring, diameter=1.0)
        # Blender 2.93 "diameter" is actually the radius
        mat = Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*r, 1))
        bmesh.ops.transform(self.bm, matrix=mat, verts=res["verts"])
        return self._finish(res["verts"], sw, smooth)

    def box(self, c, size, sw, rot=(0, 0, 0), bevel=0.0):
        before = set(self.bm.verts)
        res = bmesh.ops.create_cube(self.bm, size=1.0)
        mat = Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1))
        bmesh.ops.transform(self.bm, matrix=mat, verts=res["verts"])
        if bevel:
            self.bm.edges.index_update()
            edges = sorted({e for v in res["verts"] for e in v.link_edges}, key=lambda e: e.index)
            bmesh.ops.bevel(self.bm, geom=edges + res["verts"], offset=bevel, segments=2, affect="EDGES")
        return self._finish([v for v in self.bm.verts if v not in before], sw, smooth=bool(bevel))

    def tube(self, p0, p1, r0, r1, sw, seg=12, squash=1.0, caps=True, twist=0.0):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        res = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=seg,
                                    diameter1=r0, diameter2=r1, depth=d.length)
        q = d.normalized().to_track_quat("Z", "Y")
        mat = (Matrix.Translation((p0 + p1) / 2) @ q.to_matrix().to_4x4()
               @ Matrix.Rotation(twist, 4, "Z") @ Matrix.Diagonal((1, squash, 1, 1)))
        bmesh.ops.transform(self.bm, matrix=mat, verts=res["verts"])
        return self._finish(res["verts"], sw)

    def torus(self, c, R, r, sw, rot=(0, 0, 0), seg=16, rseg=6, scale=(1, 1, 1)):
        bm = self.bm
        rings = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            ring = []
            for j in range(rseg):
                b = 2 * math.pi * j / rseg
                ring.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a),
                                          (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
            rings.append(ring)
        for i in range(seg):
            for j in range(rseg):
                a, b = rings[i], rings[(i + 1) % seg]
                bm.faces.new((a[j], b[j], b[(j + 1) % rseg], a[(j + 1) % rseg]))
        verts = [v for ring in rings for v in ring]
        mat = Matrix.Translation(c) @ Euler(rot).to_matrix().to_4x4() @ Matrix.Diagonal((*scale, 1))
        bmesh.ops.transform(bm, matrix=mat, verts=verts)
        return self._finish(verts, sw)

    def scale_about(self, c, k):
        c = Vector(c)
        for v in self.bm.verts:
            v.co = c + (v.co - c) * k

    def to_object(self, pivot, mat):
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        bmesh.ops.translate(self.bm, vec=-Vector(pivot), verts=self.bm.verts)
        me = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(me); self.bm.free()
        me.materials.append(mat)
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(50)
        ob = bpy.data.objects.new(self.name, me)
        return ob

def mirror(p, side):
    return (p[0] * side, p[1], p[2])

# ---------------------------------------------------------------- proportions
H_HIP = 0.93            # hip joints
H_KNEE = 0.51
H_ANKLE = 0.10
LEG_X = 0.088
SHOULDER = (0.185, 0.0, 1.355)
ELBOW = (0.225, -0.01, 1.085)
WRIST = (0.250, 0.025, 0.840)
NECK = (0.0, 0.0, 1.43)
WAIST = (0.0, 0.0, 1.00)
PERCH = (0.235, 0.0, 1.415)

def build_head():
    p = Part("Head")
    p.tube((0, 0, 1.38), (0, 0.004, 1.49), 0.047, 0.043, "skin", seg=10, caps=False)
    p.ellipsoid((0, 0.006, 1.572), (0.104, 0.108, 0.122), "skin", seg=20, ring=14)
    for s in (-1, 1):
        p.ellipsoid(mirror((0.102, -0.004, 1.572), s), (0.018, 0.012, 0.028), "skin", seg=8, ring=6)
        p.ellipsoid(mirror((0.040, 0.099, 1.585), s), (0.016, 0.011, 0.021), "eye", seg=10, ring=8)
        p.ellipsoid(mirror((0.035, 0.108, 1.594), s), (0.0055, 0.004, 0.0055), "white", seg=6, ring=4)
        p.ellipsoid(mirror((0.043, 0.101, 1.620), s), (0.021, 0.006, 0.0055), "hair",
                    rot=(0, s * 0.18, 0), seg=8, ring=4)
        p.ellipsoid(mirror((0.061, 0.086, 1.553), s), (0.019, 0.007, 0.012), "blush", seg=8, ring=5)
    p.ellipsoid((0, 0.113, 1.562), (0.014, 0.013, 0.015), "skin", seg=8, ring=6)
    p.ellipsoid((0, 0.101, 1.527), (0.017, 0.005, 0.0045), "mouth", rot=(0.15, 0, 0), seg=8, ring=4)
    # tousled hair: cap + a crown of chunky locks, short tail tied with a brass ring
    p.ellipsoid((0, -0.018, 1.612), (0.114, 0.112, 0.106), "hair", seg=18, ring=12)
    locks = [(-0.07, 0.07, 1.655, 0.4), (-0.03, 0.09, 1.67, 0.1), (0.015, 0.093, 1.672, -0.2),
             (0.06, 0.075, 1.66, -0.5), (0.09, 0.02, 1.64, -0.9), (-0.095, 0.02, 1.635, 0.9),
             (0.0, 0.02, 1.685, 0.0), (-0.05, -0.04, 1.685, 0.6), (0.05, -0.05, 1.685, -0.6)]
    for x, y, z, tilt in locks:
        p.ellipsoid((x, y, z), (0.042, 0.034, 0.03), "hair_hi" if RNG.random() < 0.4 else "hair",
                    rot=(0.5, tilt, RNG.uniform(-0.4, 0.4)), seg=8, ring=6)
    p.ellipsoid((0, -0.118, 1.545), (0.042, 0.036, 0.04), "hair_hi", seg=10, ring=8)  # little bun
    p.scale_about((0, 0, 1.55), 1.08)  # slightly storybook head proportion
    p.torus((0, -0.10, 1.545), 0.03, 0.007, "brass", rot=(math.radians(-80), 0, 0), seg=12, rseg=4)
    return p

def build_torso():
    p = Part("Torso")
    p.ellipsoid((0, 0.0, 1.225), (0.168, 0.108, 0.20), "coat", seg=18, ring=12)
    p.ellipsoid((0, 0.0, 1.035), (0.148, 0.098, 0.13), "coat", seg=16, ring=8)
    # linen shirt visible at the open collar
    p.ellipsoid((0, 0.07, 1.335), (0.042, 0.04, 0.055), "linen", seg=10, ring=6)
    # flared coat skirt, split at the back
    for s in (-1, 1):
        p.tube((0.065 * s, 0.0, 1.00), (0.10 * s, 0.01, 0.77), 0.145, 0.175, "coat",
               seg=14, squash=0.72, caps=False, twist=0)
    p.tube((0, 0, 1.005), (0, 0, 0.965), 0.157, 0.160, "leather", seg=18, squash=0.72)
    p.box((0, 0.118, 0.985), (0.052, 0.012, 0.044), "brass", bevel=0.004)
    p.box((0, 0.125, 0.985), (0.026, 0.006, 0.022), "leather_dk")
    # rolled hood at the back and a rust scarf
    p.ellipsoid((0, -0.095, 1.345), (0.125, 0.05, 0.095), "coat_dk", rot=(-0.25, 0, 0), seg=14, ring=8)  # folded hood
    p.torus((0, -0.075, 1.415), 0.085, 0.022, "coat_dk", rot=(math.radians(-25), 0, 0), seg=16, rseg=5, scale=(1.1, 0.95, 1))
    p.torus((0, 0.005, 1.425), 0.072, 0.03, "scarf", rot=(math.radians(-8), 0, 0), seg=16, rseg=7)
    p.tube((-0.035, 0.09, 1.415), (-0.06, 0.125, 1.25), 0.03, 0.026, "scarf", seg=8, squash=0.4)
    p.tube((-0.06, 0.125, 1.25), (-0.065, 0.13, 1.225), 0.026, 0.027, "scarf_hi", seg=8, squash=0.45)
    # satchel strap: left shoulder -> right back hip
    p.tube((-0.14, 0.02, 1.405), (-0.02, 0.112, 1.23), 0.018, 0.018, "leather", seg=6, squash=0.3)
    p.tube((-0.02, 0.112, 1.23), (0.14, 0.085, 1.02), 0.018, 0.018, "leather", seg=6, squash=0.3)
    p.tube((-0.14, -0.02, 1.405), (-0.02, -0.118, 1.22), 0.018, 0.018, "leather", seg=6, squash=0.3)
    p.tube((-0.02, -0.118, 1.22), (0.10, -0.14, 0.99), 0.018, 0.018, "leather", seg=6, squash=0.3)
    p.box((-0.065, 0.10, 1.305), (0.02, 0.01, 0.026), "brass", rot=(0, 0.6, 0), bevel=0.003)
    # satchel on the right-back hip
    p.box((0.115, -0.165, 0.915), (0.13, 0.05, 0.10), "leather", rot=(0, 0, 0.35), bevel=0.012)
    p.box((0.117, -0.172, 0.94), (0.136, 0.046, 0.058), "leather_dk", rot=(0, 0, 0.35), bevel=0.008)
    p.ellipsoid((0.107, -0.198, 0.925), (0.012, 0.007, 0.014), "brass", rot=(0, 0, 0.35), seg=6, ring=4)
    # enchanted charm on the belt: brass-caged blue crystal
    p.ellipsoid((-0.095, 0.108, 0.945), (0.016, 0.016, 0.026), "gem", seg=8, ring=6)
    p.torus((-0.095, 0.108, 0.945), 0.018, 0.0035, "brass", rot=(0, 0, 0), seg=10, rseg=4)
    p.torus((-0.095, 0.108, 0.945), 0.019, 0.0035, "brass", rot=(math.pi / 2, 0, 0.4), seg=10, rseg=4)
    p.tube((-0.095, 0.108, 0.975), (-0.095, 0.11, 0.99), 0.006, 0.006, "brass", seg=6)
    # left: plain leather epaulet under the strap
    p.ellipsoid((-0.185, 0.0, 1.382), (0.07, 0.065, 0.028), "leather", rot=(0, -0.25, 0), seg=12, ring=6)
    # right: the fairy perch -- blue felt cushion in a brass-studded leather rim
    p.ellipsoid((0.195, 0.0, 1.378), (0.082, 0.078, 0.030), "leather", rot=(0, 0.2, 0), seg=14, ring=6)
    p.ellipsoid((0.225, 0.0, 1.398), (0.058, 0.055, 0.017), "felt", rot=(0, 0.18, 0), seg=14, ring=6)
    for k in range(6):
        a = 2 * math.pi * k / 6 + 0.26
        x, y = 0.225 + 0.068 * math.cos(a), 0.063 * math.sin(a)
        z = 1.398 - 0.012 * math.cos(a) - 0.004
        p.ellipsoid((x, y, z), (0.0065, 0.0065, 0.005), "brass", seg=6, ring=4)
    # tiny stitched star on the cushion
    for k in range(4):
        p.box((0.228, 0, 1.4145), (0.03, 0.004, 0.002), "scarf_hi", rot=(0, 0.18, k * math.pi / 4))
    return p

def build_arm(side):
    s, sfx = side, "R" if side > 0 else "L"
    sh, el, wr = mirror(SHOULDER, s), mirror(ELBOW, s), mirror(WRIST, s)
    up = Part("UpperArm_" + sfx)
    up.ellipsoid(sh, (0.064, 0.062, 0.062), "coat", seg=12, ring=8)
    up.tube(sh, el, 0.058, 0.049, "coat", seg=12, caps=False)
    up.torus(el, 0.049, 0.016, "coat_dk", rot=(0, s * 0.15, 0), seg=14, rseg=5)  # rolled sleeve
    fa = Part("Forearm_" + sfx)
    fa.ellipsoid(el, (0.044, 0.044, 0.046), "linen", seg=10, ring=6)
    fa.tube(el, wr, 0.044, 0.037, "linen", seg=12, caps=False)
    elv, wrv = Vector(el), Vector(wr)
    b0, b1 = elv.lerp(wrv, 0.42), elv.lerp(wrv, 0.93)
    fa.tube(b0, b1, 0.047, 0.043, "leather", seg=12, caps=True)       # bracer
    for t in (0.55, 0.8):
        c = elv.lerp(wrv, t)
        fa.torus(c, 0.047, 0.004, "leather_dk", rot=(0, s * 0.1, 0), seg=12, rseg=4)
    stud = elv.lerp(wrv, 0.68) + Vector((s * 0.043, 0.012, 0))
    fa.ellipsoid(stud, (0.007, 0.007, 0.007), "brass", seg=6, ring=4)
    cuff = elv.lerp(wrv, 1.0)
    fa.torus(cuff, 0.041, 0.009, "linen", seg=12, rseg=5)             # soft shirt cuff meeting the tracked hand
    fa.ellipsoid(cuff, (0.036, 0.036, 0.006), "inner", seg=10, ring=4)
    return up, fa

def build_leg(side):
    s, sfx = side, "R" if side > 0 else "L"
    x = LEG_X * s
    th = Part("Thigh_" + sfx)
    th.ellipsoid((x, 0, H_HIP), (0.084, 0.08, 0.085), "trouser", seg=12, ring=8)
    th.tube((x, 0, H_HIP), (x, 0.005, H_KNEE), 0.082, 0.06, "trouser", seg=12, caps=False)
    sh = Part("Shin_" + sfx)
    sh.ellipsoid((x, 0.004, H_KNEE), (0.056, 0.058, 0.058), "trouser", seg=12, ring=8)
    sh.ellipsoid((x, 0.03, H_KNEE + 0.005), (0.04, 0.03, 0.045), "leather_lt", seg=10, ring=6)  # knee patch
    sh.tube((x, 0.004, H_KNEE), (x, 0.0, 0.14), 0.058, 0.046, "trouser", seg=12, caps=False)
    bt = Part("Boot_" + sfx)
    bt.tube((x, 0, 0.30), (x, 0.004, 0.07), 0.058, 0.055, "leather", seg=14, caps=True)
    bt.torus((x, 0, 0.305), 0.061, 0.016, "leather_lt", rot=(0.05, 0, 0), seg=14, rseg=6)  # folded cuff
    bt.ellipsoid((x, 0.05, 0.058), (0.058, 0.118, 0.056), "leather", seg=14, ring=8)
    bt.ellipsoid((x, 0.135, 0.05), (0.052, 0.045, 0.045), "leather_dk", seg=10, ring=6)  # toe cap
    bt.box((x, 0.045, 0.014), (0.118, 0.26, 0.028), "sole", bevel=0.01)
    bt.box((x, -0.035, 0.03), (0.105, 0.07, 0.026), "sole", bevel=0.006)                # heel
    bt.torus((x, 0.02, 0.14), 0.06, 0.007, "leather_dk", rot=(0.35, 0, 0), seg=14, rseg=4)
    bt.box((x + s * 0.058, 0.03, 0.125), (0.006, 0.022, 0.018), "brass", rot=(0.35, 0, 0), bevel=0.002)
    return th, sh, bt

# ---------------------------------------------------------------- scene build
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def empty(name, loc, parent=None, size=0.05, shape="PLAIN_AXES"):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type, e.empty_display_size = shape, size
    link(e, loc, parent)
    return e

def link(ob, world_pivot, parent):
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
        ob.location = Vector(world_pivot) - Vector(parent["pivot"])
    else:
        ob.location = world_pivot
    ob["pivot"] = Vector(world_pivot)
    ob.rotation_mode = "XYZ"

def build():
    reset()
    sc = bpy.context.scene
    sc.render.fps = 30
    mat = make_material(build_textures())
    root = empty("Player", (0, 0, 0), size=0.3, shape="ARROWS")
    hips = empty("Hips", (0, 0, H_HIP), root, size=0.12)
    parts = {}
    def add(part, pivot, parent):
        ob = part.to_object(pivot, mat)
        link(ob, pivot, parent)
        parts[ob.name] = ob
        return ob
    torso = add(build_torso(), WAIST, hips)
    add(build_head(), NECK, torso)
    for s in (1, -1):
        up, fa = build_arm(s)
        u = add(up, mirror(SHOULDER, s), torso)
        add(fa, mirror(ELBOW, s), u)
        th, sh, bt = build_leg(s)
        t = add(th, (LEG_X * s, 0, H_HIP), hips)
        k = add(sh, (LEG_X * s, 0, H_KNEE), t)
        add(bt, (LEG_X * s, 0, H_ANKLE), k)
    perch = empty("ShoulderPerch", PERCH, torso, size=0.04, shape="SPHERE")
    empty("Wrist_R", mirror(WRIST, 1), parts["Forearm_R"], size=0.03)
    empty("Wrist_L", mirror(WRIST, -1), parts["Forearm_L"], size=0.03)
    empty("HeadEye", (0, 0.07, 1.585), parts["Head"], size=0.03)
    animate(hips, parts)
    return root, hips, parts, perch

# ---------------------------------------------------------------- animation
def key_loop(name, frames, poses, objs):
    """poses(t in [0,1)) -> {obj_name: (loc_offset, rot_euler)}; pushed to an NLA track."""
    tracks = {}
    for f in range(frames + 1):
        t = f / frames
        for on, (dloc, rot) in poses(t).items():
            ob = objs[on]
            base = ob.get("rest_loc")
            if base is None:
                base = ob["rest_loc"] = tuple(ob.location)
            ob.location = Vector(base) + Vector(dloc)
            ob.rotation_euler = rot
            ob.keyframe_insert("location", frame=f + 1)
            ob.keyframe_insert("rotation_euler", frame=f + 1)
    for on in poses(0).keys():
        ob = objs[on]
        act = ob.animation_data.action
        act.name = f"{name}_{on}"
        for fc in act.fcurves:
            for kp in fc.keyframe_points:
                kp.interpolation = "BEZIER"
            m = fc.modifiers.new("CYCLES")
        tr = ob.animation_data.nla_tracks.new()
        tr.name = name
        tr.strips.new(name, 1, act)
        ob.animation_data.action = None
        ob.location = Vector(ob["rest_loc"])
        ob.rotation_euler = (0, 0, 0)

def animate(hips, parts):
    objs = dict(parts); objs["Hips"] = hips
    TAU = 2 * math.pi
    def idle(t):
        a = TAU * t
        br = math.sin(a)
        return {
            "Hips": ((0, 0, -0.004 + 0.004 * math.cos(a)), (0, 0, 0.02 * math.sin(a))),
            "Torso": ((0, 0, 0), (0.025 * br, 0.012 * math.sin(a + 1), 0)),
            "Head": ((0, 0, 0), (-0.03 * br + 0.02, 0.05 * math.sin(a * 1), 0.06 * math.sin(a + 0.7))),
            "UpperArm_R": ((0, 0, 0), (0.04 * math.sin(a + 0.4), -0.04 - 0.015 * br, 0)),
            "UpperArm_L": ((0, 0, 0), (0.04 * math.sin(a + 0.9), 0.04 + 0.015 * br, 0)),
            "Forearm_R": ((0, 0, 0), (0.12 + 0.03 * math.sin(a + 0.8), 0, 0)),
            "Forearm_L": ((0, 0, 0), (0.12 + 0.03 * math.sin(a + 1.3), 0, 0)),
            "Thigh_R": ((0, 0, 0), (0, 0, 0)), "Thigh_L": ((0, 0, 0), (0, 0, 0)),
            "Shin_R": ((0, 0, 0), (0, 0, 0)), "Shin_L": ((0, 0, 0), (0, 0, 0)),
            "Boot_R": ((0, 0, 0), (0, 0, 0)), "Boot_L": ((0, 0, 0), (0, 0, 0)),
        }
    def walk(t):
        a = TAU * t
        out = {"Hips": ((0, 0, 0.018 * math.cos(2 * a) - 0.012), (0.03, 0, 0.07 * math.sin(a)))}
        out["Torso"] = ((0, 0, 0), (0.05, 0.02 * math.sin(a), -0.12 * math.sin(a)))
        out["Head"] = ((0, 0, 0), (-0.06 - 0.02 * math.cos(2 * a), 0, 0.10 * math.sin(a)))
        for side, ph in (("R", 0.0), ("L", math.pi)):
            b = a + ph
            sw = math.sin(b)                        # +1: this leg forward
            knee = max(0.0, math.sin(b - 1.6)) * 1.0 + 0.08
            out["Thigh_" + side] = ((0, 0, 0), (0.42 * sw, 0, 0))
            out["Shin_" + side] = ((0, 0, 0), (-knee, 0, 0))
            out["Boot_" + side] = ((0, 0, 0), (-0.2 * sw + 0.5 * knee * 0.5, 0, 0))
            arm = -sw                               # arms counter-swing
            s = 1 if side == "R" else -1
            out["UpperArm_" + side] = ((0, 0, 0), (0.38 * arm, -0.05 * s, 0))
            out["Forearm_" + side] = ((0, 0, 0), (0.25 + 0.22 * max(0.0, arm), 0, 0))
        return out
    key_loop("idle", 60, idle, objs)
    key_loop("walk", 30, walk, objs)

def set_clip(objs, clip, frame):
    """Solo one NLA track on all objects (for preview renders)."""
    for ob in objs:
        ad = ob.animation_data
        if not ad:
            continue
        for tr in ad.nla_tracks:
            tr.mute = tr.name != clip
    bpy.context.scene.frame_set(frame)

# ---------------------------------------------------------------- export / validate
def export(root):
    bpy.ops.object.select_all(action="DESELECT")
    for ob in [root] + list(root.children_recursive if hasattr(root, "children_recursive") else []):
        ob.select_set(True)
    def rec(o):
        o.select_set(True)
        for c in o.children:
            rec(c)
    rec(root)
    for ob in bpy.data.objects:
        if ob.animation_data:
            for tr in ob.animation_data.nla_tracks:
                tr.mute = True  # export rest pose as node transforms; strips still export
            ob.location = Vector(ob["rest_loc"])
            ob.rotation_euler = (0, 0, 0)
    bpy.context.scene.frame_set(1)
    path = os.path.join(OUT, "player.glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=False, export_animations=True,
                              export_nla_strips=True, export_force_sampling=True,
                              export_def_bones=False, export_extras=False, export_cameras=False,
                              export_lights=False, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_image_format="AUTO")
    return path

def validate(path, perch):
    data = open(path, "rb").read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67 and ver == 2 and length == len(data), "bad GLB header"
    jlen, jtype = struct.unpack_from("<II", data, 12)
    g = json.loads(data[20:20 + jlen])
    names = [n.get("name") for n in g["nodes"]]
    need = ["Torso", "Head", "UpperArm_L", "Forearm_L", "UpperArm_R", "Forearm_R", "Thigh_L", "Shin_L",
            "Thigh_R", "Shin_R", "Boot_L", "Boot_R", "ShoulderPerch", "Hips", "Player"]
    missing = [n for n in need if n not in names]
    assert not missing, f"missing nodes {missing}"
    assert all("uri" not in b for b in g.get("buffers", [])), "external buffer"
    assert all("uri" not in i for i in g.get("images", [])), "external image"
    tris = 0
    for m in g["meshes"]:
        for pr in m["primitives"]:
            tris += g["accessors"][pr["indices"]]["count"] // 3
    # world-space (glTF) bounds from mesh accessor min/max + node translations along the chain
    parent = {}
    for i, n in enumerate(g["nodes"]):
        for c in n.get("children", []):
            parent[c] = i
    def world_t(i):
        t = Vector(g["nodes"][i].get("translation", (0, 0, 0)))
        while i in parent:
            i = parent[i]; t += Vector(g["nodes"][i].get("translation", (0, 0, 0)))
        return t
    lo, hi = Vector((9, 9, 9)), Vector((-9, -9, -9))
    for i, n in enumerate(g["nodes"]):
        if "mesh" in n:
            acc = g["accessors"][g["meshes"][n["mesh"]]["primitives"][0]["attributes"]["POSITION"]]
            w = world_t(i)
            for k in range(3):
                lo[k] = min(lo[k], acc["min"][k] + w[k]); hi[k] = max(hi[k], acc["max"][k] + w[k])
    pi = names.index("ShoulderPerch")
    # Blender 2.93's exporter orders animation accessors by set iteration, so GLB bytes vary run to run;
    # this fingerprint is order-independent and must match between builds.
    import hashlib
    bin0 = 20 + jlen + 8
    def acc_bytes(ai):
        a = g["accessors"][ai]; bv = g["bufferViews"][a["bufferView"]]
        o = bin0 + bv.get("byteOffset", 0) + a.get("byteOffset", 0)
        return data[o:o + bv["byteLength"]]
    items = []
    for n in g["nodes"]:
        items.append(repr((n.get("name"), n.get("translation"), n.get("rotation"))))
        if "mesh" in n:
            pr = g["meshes"][n["mesh"]]["primitives"][0]
            pa, ia = g["accessors"][pr["attributes"]["POSITION"]], g["accessors"][pr["indices"]]
            pos = struct.unpack("<%df" % (pa["count"] * 3), acc_bytes(pr["attributes"]["POSITION"])[:pa["count"] * 12])
            fmt = {5123: "H", 5125: "I"}[ia["componentType"]]
            idx = struct.unpack("<%d%s" % (ia["count"], fmt), acc_bytes(pr["indices"])[:ia["count"] * struct.calcsize(fmt)])
            tris_l = []
            for t in range(0, len(idx), 3):
                tri = [tuple(round(pos[3 * k + a], 5) for a in range(3)) for k in idx[t:t + 3]]
                m = tri.index(min(tri))
                tris_l.append(tuple(tri[m:] + tri[:m]))  # canonical start, winding kept
            items.append(n["name"] + hashlib.sha1(repr(sorted(tris_l)).encode()).hexdigest())
    for an in g.get("animations", []):
        for ch in an["channels"]:
            s = an["samplers"][ch["sampler"]]
            items.append(an["name"] + names[ch["target"]["node"]] + ch["target"]["path"]
                         + hashlib.sha1(acc_bytes(s["output"])).hexdigest())
    for im in g.get("images", []):
        bv = g["bufferViews"][im["bufferView"]]
        items.append(hashlib.sha1(data[bin0 + bv.get("byteOffset", 0):][:bv["byteLength"]]).hexdigest())
    fingerprint = hashlib.sha1("\n".join(sorted(items)).encode()).hexdigest()
    report = {
        "file": "output/player.glb", "bytes": len(data), "triangles": tris,
        "content_fingerprint": fingerprint,
        "meshes": len(g["meshes"]), "materials": len(g.get("materials", [])),
        "draw_calls_estimate": sum(len(m["primitives"]) for m in g["meshes"]),
        "images": [(i.get("name"), i.get("mimeType")) for i in g.get("images", [])],
        "animations": [{"name": a["name"], "channels": len(a["channels"]),
                        "seconds": round(max(g["accessors"][s["input"]]["max"][0] for s in a["samplers"]), 3)}
                       for a in g.get("animations", [])],
        "bounds_min_yup": [round(v, 4) for v in lo], "bounds_max_yup": [round(v, 4) for v in hi],
        "height_m": round(hi[1] - lo[1], 4),
        "shoulder_perch_yup": [round(v, 4) for v in world_t(pi)],
        "nodes": names,
    }
    assert 1.65 <= hi[1] <= 1.75 and abs(lo[1]) < 0.01, f"height out of spec {lo[1]}..{hi[1]}"
    with open(os.path.join(OUT, "validation.json"), "w") as f:
        json.dump(report, f, indent=2)
    print("VALIDATION", json.dumps({k: v for k, v in report.items() if k != "nodes"}))
    return report

# ---------------------------------------------------------------- preview renders
def preview_scene(perch):
    sc = bpy.context.scene
    pc = bpy.data.collections.new("Preview_NotExported")
    sc.collection.children.link(pc)
    # ground disc
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1.6, depth=0.02, location=(0, 0, -0.01))
    g = bpy.context.object; g.name = "Preview_Ground"
    gm = bpy.data.materials.new("Preview_Ground"); gm.use_nodes = True
    gb = gm.node_tree.nodes["Principled BSDF"]
    gb.inputs["Base Color"].default_value = (0.30, 0.22, 0.15, 1); gb.inputs["Roughness"].default_value = 0.9
    g.data.materials.append(gm)
    # stand-in fairy on the perch so the shoulder read is obvious in renders
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.022, location=Vector(perch.matrix_world.translation) + Vector((0, 0, 0.03)))
    f = bpy.context.object; f.name = "Preview_Fairy"
    fm = bpy.data.materials.new("Preview_Fairy"); fm.use_nodes = True
    fb = fm.node_tree.nodes["Principled BSDF"]
    fb.inputs["Base Color"].default_value = (0.3, 0.6, 1, 1)
    fb.inputs["Emission"].default_value = (0.35, 0.7, 1, 1); fb.inputs["Emission Strength"].default_value = 4
    f.data.materials.append(fm)
    f.parent = perch; f.matrix_parent_inverse = perch.matrix_world.inverted()
    for w, rz in ((-1, 0.5), (1, -0.5)):
        bpy.ops.mesh.primitive_plane_add(size=0.045, location=Vector(perch.matrix_world.translation) + Vector((0.02 * w, -0.012, 0.045)),
                                         rotation=(1.3, 0, rz))
        wing = bpy.context.object; wing.name = f"Preview_Wing{w}"
        wing.data.materials.append(fm)
        wing.parent = perch; wing.matrix_parent_inverse = perch.matrix_world.inverted()
    for ob in (g, f) + tuple(o for o in bpy.data.objects if o.name.startswith("Preview_Wing")):
        for c in ob.users_collection:
            c.objects.unlink(ob)
        pc.objects.link(ob)
    # lights: warm forge key, cool fairy rim, soft fill
    def light(name, kind, loc, energy, color, size=1.0, target=(0, 0, 1.0)):
        ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
        if kind == "AREA": ld.size = size
        lo = bpy.data.objects.new(name, ld); pc.objects.link(lo); lo.location = loc
        d = Vector(target) - Vector(loc)
        lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    light("Key", "AREA", (1.8, 2.2, 2.6), 420, (1.0, 0.86, 0.68), 1.6)
    light("Fill", "AREA", (-2.4, 1.2, 1.6), 140, (0.85, 0.9, 1.0), 2.5)
    light("Rim", "AREA", (-0.8, -2.4, 2.4), 380, (0.55, 0.72, 1.0), 1.2)
    light("RimR", "AREA", (1.5, -2.0, 1.8), 160, (1.0, 0.75, 0.5), 1.0)
    w = bpy.data.worlds.new("Preview_World"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.13, 0.11, 0.10, 1); bg.inputs["Strength"].default_value = 0.8
    cam = bpy.data.objects.new("Preview_Camera", bpy.data.cameras.new("Preview_Camera"))
    cam.data.lens = 70
    pc.objects.link(cam); sc.camera = cam
    sc.render.engine = "BLENDER_EEVEE"
    ee = sc.eevee
    ee.use_gtao = True; ee.gtao_distance = 0.3; ee.use_soft_shadows = True
    ee.shadow_cube_size = "1024"; ee.use_bloom = True; ee.bloom_intensity = 0.03; ee.taa_render_samples = 64
    sc.view_settings.view_transform = "Filmic"; sc.view_settings.look = "Medium Contrast"
    sc.render.film_transparent = False
    return cam

def aim(cam, angle_deg, dist=4.3, h=1.05, target_z=0.86):
    a = math.radians(angle_deg)  # 0 = in front of character (+Y)
    cam.location = (dist * math.sin(a), dist * math.cos(a), h)
    d = Vector((0, 0, target_z)) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()

def render_to(path, w, h):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

def renders(cam, objs):
    set_clip(objs, "idle", 1)
    for nm, ang in (("front", 0), ("back", 180), ("three_quarter", 35), ("three_quarter_right", -40)):
        aim(cam, ang)
        render_to(os.path.join(REN, f"player_{nm}.png"), 900, 1200)
    # close-up of the perch shoulder
    cam.data.lens = 85
    cam.location = (1.1, 0.9, 1.65)
    cam.rotation_euler = (Vector((0.12, 0, 1.45)) - cam.location).to_track_quat("-Z", "Y").to_euler()
    render_to(os.path.join(REN, "player_perch_closeup.png"), 900, 900)
    cam.data.lens = 70
    # contact sheet: 8 walk frames (3/4 side) + 4 idle frames
    tw, th = 300, 400
    tiles = []
    for i in range(8):
        set_clip(objs, "walk", 1 + i * 30 // 8); aim(cam, 70)
        p = os.path.join(REN, f"_tile_w{i}.png"); render_to(p, tw, th); tiles.append(p)
    for i in range(4):
        set_clip(objs, "idle", 1 + i * 15); aim(cam, 20)
        p = os.path.join(REN, f"_tile_i{i}.png"); render_to(p, tw, th); tiles.append(p)
    cols, rows = 4, 3
    sheet = bpy.data.images.new("contact", tw * cols, th * rows, alpha=False)
    import numpy as np
    buf = np.zeros((th * rows, tw * cols, 4), dtype=np.float32)
    for k, p in enumerate(tiles):
        im = bpy.data.images.load(p)
        px = np.array(im.pixels[:], dtype=np.float32).reshape(th, tw, 4)
        r, c = k // cols, k % cols
        buf[(rows - 1 - r) * th:(rows - r) * th, c * tw:(c + 1) * tw] = px
        bpy.data.images.remove(im); os.remove(p)
    sheet.pixels[:] = buf.ravel()
    sheet.filepath_raw = os.path.join(REN, "player_motion_sheet.png"); sheet.file_format = "PNG"; sheet.save()
    bpy.data.images.remove(sheet)
    set_clip(objs, "idle", 1)

def main():
    root, hips, parts, perch = build()
    path = export(root)
    rep = validate(path, perch)
    objs = list(parts.values()) + [hips]
    for ob in objs:
        if ob.animation_data:
            for tr in ob.animation_data.nla_tracks:
                tr.mute = tr.name != "idle"
    if not NO_RENDER:
        cam = preview_scene(perch)
        renders(cam, objs)
    for nm in ("player_base", "player_orm", "player_emit"):
        p = os.path.join(OUT, nm + ".png")
        if os.path.exists(p):
            os.remove(p)  # textures live packed inside the .blend and embedded in the .glb
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "player.blend"), compress=True)
    if os.path.exists(os.path.join(OUT, "player.blend1")):
        os.remove(os.path.join(OUT, "player.blend1"))
    print("DONE", rep["triangles"], "tris")

main()
