"""Neutral studio + dark review renders of output/bow.glb.  Run: blender -b --python render_final.py -- --out ABS_DIR [--only name]"""
import bpy, sys, os, math
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(argv[argv.index("--out") + 1])
ONLY = argv[argv.index("--only") + 1] if "--only" in argv else None
P = lambda p: Vector((p[0], -p[2], p[1]))
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "BLENDER_EEVEE_NEXT"; sc.eevee.taa_render_samples = 48
sc.render.resolution_x = 1400; sc.render.resolution_y = 1400
sc.view_settings.view_transform = "AgX"
sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
bg = sc.world.node_tree.nodes["Background"]
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "bow.glb"))
def light(name, pos, e, size, col=(1, 1, 1)):
    d = bpy.data.lights.new(name, "AREA"); d.energy = e; d.size = size; d.color = col
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o); o.location = P(pos)
    o.rotation_euler = (-o.location).to_track_quat("-Z", "Y").to_euler(); return o
cam_d = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
def shot(name, pos, target, span, dark=False, persp=False):
    if ONLY and ONLY != name: return
    for o in [o for o in bpy.data.objects if o.type == "LIGHT"]: bpy.data.objects.remove(o)
    if dark:
        bg.inputs["Color"].default_value = (0.01, 0.012, 0.02, 1); bg.inputs["Strength"].default_value = 0.35
        light("rim", (-1.5, 1.2, -1.8), 60, 2, (0.6, 0.7, 1.0)); light("warm", (1.2, 0.5, 1.6), 25, 2, (1.0, 0.6, 0.3))
    else:
        bg.inputs["Color"].default_value = (0.17, 0.18, 0.20, 1); bg.inputs["Strength"].default_value = 0.55
        light("key", (1.8, 2.2, 2.4) if pos[2] > 0 else (1.8, 2.2, -2.4), 180, 3); light("fill", (-2.4, .1, 1.8), 100, 3)
        light("fill2", (-1.6, .3, -2.2), 130, 2.5); light("top", (.4, 2.0, -1.2), 90, 2)
    cam.location = P(pos); cam.rotation_euler = (P(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    if persp: cam_d.type = "PERSP"; cam_d.angle = span
    else: cam_d.type = "ORTHO"; cam_d.ortho_scale = span
    sc.render.filepath = os.path.join(OUT, name + ".png"); bpy.ops.render.render(write_still=True)
shot("render-threequarter", (1.6, .25, -2.1), (0, 0, 0), 1.45)
shot("render-back-quarter", (-1.6, .25, 2.1), (0, 0, 0), 1.45)
shot("render-grip-head", (.55, .15, -.9), (0, .11, -.03), .42)
shot("render-head", (.35, .30, -.7), (0, .21, -.09), .17)
shot("render-grip", (.5, .0, -.9), (0, 0.0, 0), .20)
shot("render-dark", (.9, .2, -1.2), (0, .18, -.05), .55, dark=True)
