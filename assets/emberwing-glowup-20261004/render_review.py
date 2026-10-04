"""Review renders for Emberwing bow / arrow GLBs.

python3.11 render_review.py -- --glb PATH --out DIR --prefix NAME --set bow|arrow [--res 900] [--engine cycles|eevee]
Bow views:   threequarter (front-right 3/4), player (first-person: camera behind the grip looking -Z, bow upright,
             camera offset right/up like the left-hand hold), front (orthographic straight down -Z from behind).
Arrow views: lineup (every Head_i x Fletch_j combination side by side), closeup (head + fletch macro), embedded.
"""
import bpy, sys, os, math
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
def arg(k, d=None): return argv[argv.index(k) + 1] if k in argv else d
GLB = os.path.abspath(arg("--glb")); OUT = os.path.abspath(arg("--out")); PRE = arg("--prefix", "r"); SET = arg("--set", "bow")
RES = int(arg("--res", "900")); ENGINE = arg("--engine", "cycles"); ONLY = arg("--only")
os.makedirs(OUT, exist_ok=True)
P = lambda p: Vector((p[0], -p[2], p[1]))           # glTF -> Blender

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
if ENGINE == "cycles":
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 24; sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 4
else:
    sc.render.engine = "BLENDER_EEVEE_NEXT"; sc.eevee.taa_render_samples = 32
sc.render.resolution_x = RES; sc.render.resolution_y = RES
sc.view_settings.view_transform = "AgX"
sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
bg = sc.world.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.17, 0.18, 0.20, 1); bg.inputs["Strength"].default_value = 0.55

bpy.ops.import_scene.gltf(filepath=GLB)
objs = {o.name: o for o in bpy.data.objects}
for o in bpy.data.objects:      # avoid Cycles' shadow-terminator artifact on low-poly smooth surfaces (not present in three.js)
    if o.type == "MESH":
        o.shadow_terminator_geometry_offset = 0.15; o.shadow_terminator_normal_offset = 0.15

def light(name, pos, e, size, col=(1, 1, 1)):
    d = bpy.data.lights.new(name, "AREA"); d.energy = e; d.size = size; d.color = col
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o); o.location = P(pos)
    o.rotation_euler = (-o.location).to_track_quat("-Z", "Y").to_euler(); return o
light("key", (1.8, 2.2, 2.4), 160, 3); light("fill", (-2.4, .1, 1.8), 90, 3)
light("fill2", (-1.6, .3, -2.2), 120, 2.5); light("top", (.4, 2.0, -1.2), 80, 2)

cam_d = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam_d.clip_start = 0.005

def shot(name, pos, target, span, persp=False, rx=None, ry=None):
    if ONLY and ONLY != name: return
    sc.render.resolution_x = rx or RES; sc.render.resolution_y = ry or RES
    cam.location = P(pos); cam.rotation_euler = (P(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    if persp: cam_d.type = "PERSP"; cam_d.angle = math.radians(span)
    else: cam_d.type = "ORTHO"; cam_d.ortho_scale = span
    sc.render.filepath = os.path.join(OUT, f"{PRE}-{name}.png"); bpy.ops.render.render(write_still=True)

if SET == "bow":
    shot("threequarter", (1.6, .25, -2.1), (0, 0, -0.02), 1.42)
    # first person: eye ~0.30 m right, 0.10 m up and 0.55 m behind the grip, looking slightly left/forward (75 deg fov)
    shot("player", (0.30, 0.10, 0.55), (0.0, 0.08, -1.2), 75, persp=True)
    shot("front", (0, 0, 2.0), (0, 0, 0), 1.36)
    shot("head", (.45, .26, -.75), (0, .19, -.08), .26)
    shot("limb", (0.10, 0.30, 0.60), (0.05, 0.33, -0.06), 0.30)
    shot("nock", (0.16, 0.56, 0.30), (0.0, 0.575, 0.06), 0.12)
else:
    from mathutils import Matrix
    heads = sorted(n for n in objs if n.startswith("Head_")); fl = sorted(n for n in objs if n.startswith("Fletch_"))
    base = [o for o in bpy.data.objects if o.type == "MESH"]
    def layout(combos, spacing, rot, tag):
        """Copy the arrow once per (head, fletch) combo; rot maps the arrow, then rows are spread along +X (Blender)."""
        made = []
        for o in base: o.hide_render = True
        for i, (h, f) in enumerate(combos):
            for o in base:
                if h is not None and o.name.startswith("Head_") and o.name != h: continue
                if f is not None and o.name.startswith("Fletch_") and o.name != f: continue
                if h is None and o.name.startswith("Head_") and o.name != heads[0]: continue
                if f is None and o.name.startswith("Fletch_") and o.name != fl[0]: continue
                c = o.copy(); sc.collection.objects.link(c); c.parent = None
                c.matrix_world = Matrix.Translation(Vector(((i - (len(combos) - 1) / 2) * spacing, 0, 0))) @ rot @ o.matrix_world
                c.hide_render = False; made.append(c)
        return made
    def clear(made):
        for c in made: bpy.data.objects.remove(c)
    up = Matrix.Rotation(math.radians(90), 4, "X")        # arrow tip (Blender +Y) -> +Z (up)
    if heads and fl:
        m = layout([(h, f) for h in heads for f in fl], 0.055, up, "lineup")
        shot("lineup", (0, 0.39, 2.0), (0, 0.39, 0), 1.45, rx=1500, ry=900)   # glTF coords: x, y(up), z(toward camera)
        clear(m)
        # heads: tip up, 3/4 view, side by side
        m = layout([(h, None) for h in heads], 0.034, up, "heads")
        shot("heads", (0.06, 0.70, 0.30), (0, 0.745, 0), 0.115, rx=1200, ry=800)
        clear(m)
        side = Matrix.Rotation(math.radians(-90), 4, "Z") @ up      # profile: arrow side faces the camera
        m = layout([(h, None) for h in heads], 0.034, side, "heads")
        shot("heads-side", (0.0, 0.745, 0.40), (0, 0.745, 0), 0.115, rx=1200, ry=800)
        clear(m)
        m = layout([(None, f) for f in fl], 0.05, up, "fletch")
        shot("fletches", (0.10, 0.13, 0.42), (0, 0.105, 0), 0.24, rx=1300, ry=800)
        clear(m)
        # embedded in a bark block: arrow as authored (tip -Z), head buried, seen from behind/side at ~0.5 m
        for o in base: o.hide_render = not (o.name in ("Shaft", heads[1], fl[3]))
        bpy.ops.mesh.primitive_cube_add(size=1, location=P((0, 0, -0.80)))
        blk = bpy.context.active_object; blk.scale = (0.30, 0.10, 0.30)
        bm = bpy.data.materials.new("bark"); bm.use_nodes = True; bm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.08, 0.05, 0.035, 1)
        bm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9; blk.data.materials.append(bm)
        shot("embedded", (0.28, 0.12, 0.05), (0, 0, -0.33), 50, persp=True)
        shot("embedded-close", (0.10, 0.06, 0.02), (0, 0, -0.14), 40, persp=True)
        shot("nock", (0.035, 0.03, 0.05), (0, 0, -0.012), 0.06)
    else:
        shot("closeup-head", (0.07, 0.035, -0.70), (0, 0, -0.755), 0.075)
        shot("closeup-fletch", (0.20, 0.07, -0.03), (0, 0, -0.10), 0.22)
        shot("side", (0.8, 0.0, -0.39), (0, 0, -0.39), 0.85)
