"""Render review shots of Siegebird-Opus.blend (studio rig is created here, never exported).

blender -b Siegebird-Opus.blend --python-exit-code 2 --python render_siegebird_opus.py -- [shot names]
"""
import bpy, sys, os, math, time
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
import build_siegebird_opus as B

B.OBJ.update({n: bpy.data.objects[n] for n in ["Body", "Wings", "Bolt", "Sled", "Pinion", "Reduction", "Drum", "Clutch", "Crank",
                                                "CrankKnob", "Latch", "Trigger", "OpticRear", "BoltSeat", "GripAnchor", "LiveCord", "ReelSocketArt", "SelectorArt"]})
B.OBJ["cords"] = [bpy.data.objects["LiveCord_%02d" % i] for i in range(20)]
scene = bpy.context.scene
OUT = os.path.join(HERE, "renders")

def srgb(h): return B.srgb(h)

def setup():
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = 96
    scene.eevee.use_shadows = True
    try:
        scene.eevee.use_raytracing = True
        scene.eevee.ray_tracing_options.resolution_scale = '1'
    except Exception: pass
    scene.render.resolution_x = 1600; scene.render.resolution_y = 1000
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'; scene.view_settings.look = 'AgX - Base Contrast'
    rig = bpy.data.collections.new("RenderRig"); scene.collection.children.link(rig)
    w = bpy.data.worlds.new("Studio"); scene.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = srgb("2a2f36"); bg.inputs[1].default_value = 0.55
    # backdrop: a large sweep under the model (Blender -Y is Godot up)
    me = bpy.data.meshes.new("Sweep"); vs = []; fs = []
    for x, y in ((-5, -4), (5, -4), (5, 5), (-5, 5)): vs.append(tuple(B.G2B((x, y, 0))))
    fs = [(0, 1, 2, 3)]
    me.from_pydata(vs, [], fs)
    for p in me.polygons: p.use_smooth = True
    sweep = bpy.data.objects.new("Sweep", me); rig.objects.link(sweep)
    m = bpy.data.materials.new("Backdrop"); m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]; bsdf.inputs["Base Color"].default_value = srgb("3a3c40"); bsdf.inputs["Roughness"].default_value = 0.8
    me.materials.append(m)
    return rig, sweep

from mathutils import Matrix
def aim(ob, loc, target):
    f = (Vector(target) - Vector(loc)).normalized(); up = B.G2B((0, 0, 1))
    if abs(f.dot(up)) > 0.98: up = B.G2B((0, 1, 0))
    r = f.cross(up).normalized(); u = r.cross(f)
    M = Matrix((r, u, -f)).transposed(); ob.rotation_euler = M.to_euler()

def light(rig, name, kind, loc, target, energy, size=1.0, color="ffffff"):
    L = bpy.data.lights.new(name, kind); L.energy = energy; L.color = srgb(color)[:3]
    if kind == 'AREA': L.size = size
    if kind == 'SUN': L.angle = math.radians(size)
    ob = bpy.data.objects.new(name, L); rig.objects.link(ob); ob.location = loc
    aim(ob, loc, target)
    return ob

def camera(rig, loc, target, lens=50):
    c = bpy.data.cameras.new("Cam"); c.lens = lens; c.clip_start = 0.01
    ob = bpy.data.objects.new("Cam", c); rig.objects.link(ob); ob.location = loc
    aim(ob, loc, target)
    scene.camera = ob; return ob

def G(x, y, z): return B.G2B((x, y, z))

def place_sweep(sweep, floor_z, back_y=2.4):
    # sweep authored with floor along -Godot Y; put the curved wall far behind (negative y) camera-agnostic
    sweep.location = G(0, 0, floor_z)

SHOTS = {
    # name: (camera godot pos, target godot pos, lens, pose kwargs)
    "01_hero":        ((0.95, 1.55, 0.72), (0.02, 0.60, 0.05), 42, dict(draw=1.0, angle=0.9)),
    "02_front":       ((0.0, 2.30, 0.22), (0.0, 0.60, 0.06), 45, dict(draw=1.0, angle=0.9)),
    "03_rear_grip":   ((-0.55, -0.55, 0.28), (0.02, 0.36, -0.02), 40, dict(draw=1.0, angle=0.9, trigger=0.6)),
    "04_mechanism":   ((0.78, 0.40, 0.20), (0.15, 0.58, 0.02), 55, dict(draw=0.55, angle=0.55 * 4 * math.pi + 0.9)),
    "05_top_rest":    ((0.0, 0.50, 3.1), (0.0, 0.50, 0.0), 50, dict(draw=0.0, angle=0.9)),
    "06_top_drawn":   ((0.0, 0.50, 3.1), (0.0, 0.50, 0.0), 50, dict(draw=1.0, angle=0.9)),
    "07_side_right":  ((2.3, 0.52, 0.05), (0.0, 0.52, 0.02), 50, dict(draw=1.0, angle=0.9)),
    "08_release":     ((0.62, 0.25, -0.30), (0.12, 0.60, -0.02), 50, dict(draw=0.35, angle=0.9, release=True)),
    "09_left_reel":   ((-0.95, 0.95, 0.40), (-0.05, 0.55, 0.03), 45, dict(draw=1.0, angle=0.9)),
    "10_sled_closeup":((0.30, 0.25, 0.45), (0.03, 0.56, 0.17), 60, dict(draw=1.0, angle=0.9)),
    "11_underside":   ((0.70, 0.95, -0.75), (0.0, 0.55, -0.05), 42, dict(draw=0.0, angle=0.9)),
    "13a_mech_uncocked": ((0.80, 0.47, 0.28), (0.10, 0.62, 0.08), 45, dict(draw=0.0, angle=0.0)),
    "13b_mech_cocked":   ((0.80, 0.47, 0.28), (0.10, 0.62, 0.08), 45, dict(draw=1.0, angle=4 * math.pi + 0.0)),
    "13c_mech_release":  ((0.80, 0.47, 0.28), (0.10, 0.62, 0.08), 45, dict(draw=0.5, angle=0.0, release=True, trigger=1.0)),
    "14_socket_selector": ((-0.55, 0.30, 0.25), (-0.19, 0.47, 0.05), 50, dict(draw=1.0, angle=0.9)),
    "12_crank_arc":   ((1.10, 0.54, 0.0), (0.2, 0.56, 0.0), 45, dict(draw=0.2, angle=2.2)),
}

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    rig, sweep = setup()
    place_sweep(sweep, -0.30)
    key = light(rig, "Key", 'AREA', G(1.4, -0.3, 1.5), G(0, 0.5, 0), 110, 1.4, "fff1dc")
    fill = light(rig, "Fill", 'AREA', G(-1.6, 1.4, 0.6), G(0, 0.5, 0), 45, 2.0, "cfe3ff")
    rim = light(rig, "Rim", 'AREA', G(-0.4, 2.2, 1.2), G(0, 0.5, 0), 90, 1.0, "ffffff")
    low = light(rig, "Bounce", 'AREA', G(0.4, 0.2, -1.0), G(0, 0.5, 0), 18, 2.0, "ffd9b0")
    names = argv or list(SHOTS)
    for nm in names:
        cpos, tgt, lens, pk = SHOTS[nm]
        B.pose(**pk)
        B.OBJ["Bolt"].hide_render = not (pk.get("draw", 1) >= 0.999 and not pk.get("release"))
        sweep.hide_render = nm.startswith("05") or nm.startswith("06") or nm.startswith("11")
        camera(rig, G(*cpos), G(*tgt), lens)
        scene.render.filepath = os.path.join(OUT, nm + ".png")
        t = time.time(); bpy.ops.render.render(write_still=True)
        print("RENDERED", nm, "%.1fs" % (time.time() - t))

def stitch(out, names, cols):
    import numpy as np
    ims = []
    for n in names:
        im = bpy.data.images.load(os.path.join(OUT, n + ".png")); w, h = im.size
        a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, 4); ims.append(a)
    h, w = ims[0].shape[:2]; rows = (len(ims) + cols - 1) // cols
    sheet = np.ones((rows * h, cols * w, 4), dtype=np.float32)
    for i, a in enumerate(ims):
        r, c = i // cols, i % cols; sheet[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = a
    img = bpy.data.images.new(out, cols * w, rows * h); img.pixels.foreach_set(sheet.ravel())
    img.filepath_raw = os.path.join(OUT, out + ".png"); img.file_format = 'PNG'; img.save()
    print("STITCHED", out)

main()
if "--" not in sys.argv or len(sys.argv[sys.argv.index("--") + 1:]) == 0:
    stitch("20_motion_wings_rest_vs_drawn", ["05_top_rest", "06_top_drawn"], 2)
    stitch("21_motion_mechanism_uncocked_cocked_release", ["13a_mech_uncocked", "13b_mech_cocked", "13c_mech_release"], 3)
