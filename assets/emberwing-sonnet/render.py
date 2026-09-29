"""Studio renders of the exported GLBs. blender -b --python render.py -- --out DIR"""
import bpy, sys, os, math
from mathutils import Vector as V
a = sys.argv[sys.argv.index("--") + 1:]; OUT = os.path.abspath(a[a.index("--out") + 1])
def B(p): return (p[0], -p[2], p[1])
def setup(res=(900, 900)):
    bpy.ops.wm.read_factory_settings(use_empty=True); sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = 40; sc.cycles.device = "CPU"
    try: sc.cycles.use_denoising = True
    except Exception: pass
    sc.render.resolution_x, sc.render.resolution_y = res
    w = bpy.data.worlds.new("w"); w.use_nodes = True; sc.world = w
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.018, 0.022, 0.032, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.25
    sc.view_settings.view_transform = "Filmic" if "Filmic" in [x.identifier for x in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "AgX"
    return sc
def light(sc, loc, energy, col, size=1.0):
    d = bpy.data.lights.new("l", "AREA"); d.energy = energy; d.color = col; d.size = size
    o = bpy.data.objects.new("l", d); sc.collection.objects.link(o); o.location = B(loc)
    t = o.constraints.new("TRACK_TO"); t.target = TGT; t.track_axis = "TRACK_NEGATIVE_Z"; t.up_axis = "UP_Y"
def cam(sc, loc, lens=60):
    d = bpy.data.cameras.new("c"); d.lens = lens
    o = bpy.data.objects.new("c", d); sc.collection.objects.link(o); o.location = B(loc)
    t = o.constraints.new("TRACK_TO"); t.target = TGT; t.track_axis = "TRACK_NEGATIVE_Z"; t.up_axis = "UP_Y"
    sc.camera = o
def shot(name, views, center, lights):
    global TGT
    for fn, loc, lens in views:
        sc = setup()
        for g in name: bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, g[0]))
        for g in name:
            pass
        TGT = bpy.data.objects.new("t", None); sc.collection.objects.link(TGT); TGT.location = B(center)
        for l in lights: light(sc, *l)
        cam(sc, loc, lens); sc.render.filepath = os.path.join(OUT, fn); bpy.ops.render.render(write_still=True)
L = [((1.2, 1.5, 1.5), 900, (1, 0.93, 0.85), 2.0), ((-1.5, 0.3, 1.2), 90, (0.5, 0.7, 1.0), 2.0), ((0.3, 0.6, -1.5), 160, (1.0, 0.6, 0.3), 2.0)]
shot([("bow.glb",)], None, (0, 0, 0), []) if False else None
which = a[a.index("--only") + 1] if "--only" in a else "all"
if which in ("all", "bow"):
    shot([("bow.glb",)], None, (0, 0, 0.0), L) if False else None
    shot([("bow.glb",)], None, (0, 0, 0), L) if False else None
    shot([("bow.glb",)], None, None, None) if False else None
def go(files, views, center, lights, xform=None):
    global TGT
    for fn, loc, lens in views:
        sc = setup()
        for f in files: bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f))
        TGT = bpy.data.objects.new("t", None); sc.collection.objects.link(TGT); TGT.location = B(center)
        for l in lights: light(sc, *l)
        cam(sc, loc, lens); sc.render.filepath = os.path.join(OUT, fn); bpy.ops.render.render(write_still=True)
if which in ("all", "bow"):
    go(["bow.glb"], [("render_bow_front.png", (0, 0.05, 2.6), 70), ("render_bow_side.png", (2.6, 0.05, 0.0), 70), ("render_bow_threequarter.png", (1.5, 0.35, 1.9), 70)], (0, 0.02, 0), L)
if which in ("all", "wings"):
    # arrow + wings composite, wings mounted on shaft ~0.3 m ahead of the nock
    setup_files = ["arrow.glb", "wings.glb"]
    sc = setup()
    for f in setup_files: bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f))
    wr = [o for o in bpy.data.objects if o.name.startswith("Wings")][0]
    while wr.parent: wr = wr.parent
    wr.location = B((0, 0, -0.30)); wr.rotation_euler = (0.0, math.radians(-14), 0)
    TGT = bpy.data.objects.new("t", None); sc.collection.objects.link(TGT); TGT.location = B((0, 0, -0.32))
    for l in [((0.9, 0.9, -1.1), 120, (1, 0.9, 0.8), 1.5), ((-1.0, 0.2, 0.4), 70, (0.5, 0.7, 1.0), 1.5)]: light(sc, *l)
    cam(sc, (0.75, 0.55, 0.55), 55); sc.render.filepath = os.path.join(OUT, "render_wings_flight.png"); bpy.ops.render.render(write_still=True)
