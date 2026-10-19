"""Turnaround renders of the Armoury (Cycles, CPU), standing on a patch of turf with a Flockwright seated on its
stand (from ../../multiplayer/assets-source/flockwright/out/flockwright.glb when it has been built).
  python3 render_backtown.py [pieces|all] [views] [samples] [WxH]      -> renders/<piece>_<view>.png, renders/sheet_<piece>.png
  pieces: comma list of D_Tavern G_Tavern N_Tavern D_Quartermaster G_Quartermaster D_Mill G_Mill (default all)
  views:  comma list of front34 side back top inside (default front34,side,back,top; inside only for taverns)
Blender space: pieces face -Y (three.js +Z).
"""
import bpy, math, os, sys
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "renders"); os.makedirs(OUT, exist_ok=True)
PIECES = ["D_Armoury"]
arg = lambda i, d: sys.argv[i] if len(sys.argv) > i and sys.argv[i] not in ("", "all") else d
WHICH = arg(1, ",".join(PIECES)).split(",")
VIEWS = arg(2, "front34,side,back,top").split(",")
SAMPLES = int(arg(3, "32"))
RES = tuple(int(v) for v in arg(4, "1200x800").split("x"))
MOVING = {}

def setup():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "armoury.glb"))
    kit = {o.name: o for o in bpy.data.objects}
    for m in bpy.data.materials:  # the game drives glow with emissiveIntensity; match the bases renders
        b = m.node_tree.nodes.get("Principled BSDF") if m.use_nodes else None
        if b and m.name in ("Crystal", "Amethyst", "Ember", "Ooze"): b.inputs["Emission Strength"].default_value = {"Ember": 4.0, "Ooze": 2.5}.get(m.name, 3.0)
    for o in kit.values(): o.hide_render = True
    return kit

def inst(kit, name, M):
    o = kit[name].copy(); bpy.context.scene.collection.objects.link(o); o.parent = None; o.matrix_world = M; o.hide_render = False; return o

def stage(evil, neutral):
    w = bpy.data.worlds.new("w"); bpy.context.scene.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]; bg.inputs["Color"].default_value = (0.42, 0.55, 0.75, 1) if not evil else (0.34, 0.32, 0.46, 1); bg.inputs["Strength"].default_value = 0.85
    bpy.ops.object.light_add(type="SUN", rotation=(math.radians(52), 0, math.radians(-38))); s = bpy.context.object
    s.data.energy = 3.0 if not evil else 2.2; s.data.color = (1.0, 0.95, 0.86) if not evil else (0.95, 0.86, 1.0); s.data.angle = math.radians(3)
    bpy.ops.mesh.primitive_plane_add(size=60); g = bpy.context.object
    m = bpy.data.materials.new("turf"); m.use_nodes = True; nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    noise = nt.nodes.new("ShaderNodeTexNoise"); noise.inputs["Scale"].default_value = 0.8; ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.14, 0.22, 0.07, 1) if not evil else (0.14, 0.16, 0.08, 1)
    ramp.color_ramp.elements[1].color = (0.27, 0.4, 0.12, 1) if not evil else (0.24, 0.26, 0.13, 1)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"]); nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.95
    g.data.materials.append(m)

def bounds(objs):
    pts = [o.matrix_world @ Vector(c) for o in objs for c in o.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), 0)); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi

def cam(loc, target, lens=35, ortho=None):
    bpy.ops.object.camera_add(location=loc); c = bpy.context.object; c.data.lens = lens; c.data.clip_end = 400
    if ortho: c.data.type = "ORTHO"; c.data.ortho_scale = ortho
    d = Vector(target) - Vector(loc); c.rotation_euler = d.to_track_quat("-Z", "Y").to_euler(); bpy.context.scene.camera = c; return c

def render(path):
    sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True; sc.cycles.device = "CPU"
    sc.cycles.max_bounces = 4; sc.render.resolution_x, sc.render.resolution_y = RES; sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast"
    sc.render.filepath = path; bpy.ops.render.render(write_still=True); print("wrote", path, flush=True)

def sheet(paths, out):
    """2-column contact sheet of the rendered views (bpy images, no PIL)."""
    imgs = [bpy.data.images.load(p) for p in paths]
    for im in imgs: im.colorspace_settings.name = "Non-Color"  # copy pixels as stored
    w, h = imgs[0].size; cols = 2; rows = (len(imgs) + 1) // 2
    canvas = np.ones((rows * h, cols * w, 4), np.float32)
    for i, im in enumerate(imgs):
        a = np.array(im.pixels[:], np.float32).reshape(h, w, 4); r, c = rows - 1 - i // cols, i % cols
        canvas[r * h:(r + 1) * h, c * w:(c + 1) * w] = a
    o = bpy.data.images.new("sheet", cols * w, rows * h, alpha=True, is_data=True); o.pixels[:] = canvas.ravel(); o.filepath_raw = out; o.file_format = "PNG"; o.save()

for name in WHICH:
    kit = setup(); pre, kind = name.split("_", 1)
    stage(pre == "G", pre == "N")
    objs = [inst(kit, name, Matrix())]
    fw = os.path.join(HERE, "..", "..", "multiplayer", "assets-source", "flockwright", "out", "flockwright.glb")
    if os.path.exists(fw):  # the real crossbow on the cradle, nose to +X like the game seats it
        before = set(bpy.data.objects); bpy.ops.import_scene.gltf(filepath=fw)
        new = [o for o in bpy.data.objects if o not in before]; root = [o for o in new if o.parent is None]
        at = kit[f"{pre}_Armoury_Stand"].matrix_world.translation
        for o in root: o.matrix_world = Matrix.Translation(at) @ Matrix.Rotation(-math.pi / 2, 4, "Z") @ o.matrix_world

    for node, anc, spin in MOVING.get(kind, []):
        M = Matrix.Translation(kit[f"{pre}_{anc}"].matrix_local.translation)
        axis = "Y" if node == "MillSails" else "Z"
        objs.append(inst(kit, f"{pre}_{node}", M @ Matrix.Rotation(spin, 4, axis)))
    lo, hi = bounds(objs); c = (lo + hi) / 2; size = max(hi.x - lo.x, hi.y - lo.y, hi.z); tgt = Vector((c.x, c.y, hi.z * 0.42))
    dist = size * 1.75
    shots = {"front34": (tgt + Vector((0.62, -1.0, 0.42)).normalized() * dist, tgt, 35, None),
             "side": (tgt + Vector((1.0, -0.12, 0.2)).normalized() * dist, tgt, 35, None),
             "back": (tgt + Vector((-0.45, 1.0, 0.35)).normalized() * dist, tgt, 35, None),
             "top": (Vector((c.x, c.y - 0.01, hi.z + 40)), Vector((c.x, c.y, 0)), 35, size * 1.25),
             "inside": (Vector((c.x + 0.6, lo.y - 0.6, 1.65)), Vector((c.x - 0.3, hi.y - 1.0, 1.25)), 18, None),
             "detail": (Vector((1.6, -1.6, 1.75)), Vector((0.0, 0.35, 1.2)), 32, None),
             "counter": (Vector((c.x + 1.2, lo.y - 3.2, 1.75)), Vector((c.x, c.y + 0.6, 1.5)), 24, None)}
    paths = []
    for v in VIEWS:
        if v in ("counter",): continue
        loc, t, lens, ortho = shots[v]; cam(loc, t, lens, ortho)
        pth = os.path.join(OUT, f"{name}_{v}.png"); render(pth); paths.append(pth)
    if len(paths) > 1: sheet(paths, os.path.join(OUT, f"sheet_{name}.png"))
