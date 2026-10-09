"""Review renders for the Emberwing phoenix GLB.

python3.11 render_review.py -- --glb out/wings.glb --out DIR [--prefix phoenix] [--res 760] [--flap 0]
Views: side, threequarter, front, top, mid-beat (wings rotated about their LOCAL Z like the client does),
and a small-on-sky pair that checks readability at in-game size against a bright daytime sky.
Writes a combined sheet with make_sheet.py.
"""
import bpy, sys, os, math
from mathutils import Vector, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:]
def arg(k, d=None): return argv[argv.index(k) + 1] if k in argv else d
GLB = os.path.abspath(arg("--glb")); OUT = os.path.abspath(arg("--out")); PRE = arg("--prefix", "phoenix")
RES = int(arg("--res", "760")); ONLY = arg("--only")
VIEW = arg("--view", "Filmic"); EXPO = float(arg("--exposure", "-1.2")); SKY = float(arg("--sky", "0.55"))
os.makedirs(OUT, exist_ok=True)
P = lambda p: Vector((p[0], -p[2], p[1]))           # glTF -> Blender

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 40
sc.cycles.use_denoising = True; sc.cycles.max_bounces = 4
sc.render.resolution_x = sc.render.resolution_y = RES
sc.view_settings.view_transform = VIEW; sc.view_settings.exposure = EXPO; sc.view_settings.look = "None"
sc.render.film_transparent = False

# Bright daytime sky, as the game shows it: pale blue above, warm ground bounce below.
sc.world = bpy.data.worlds.new("w"); sc.world.use_nodes = True
wnt = sc.world.node_tree
for n in list(wnt.nodes):
    if n.type != "OUTPUT_WORLD": wnt.nodes.remove(n)
sky = wnt.nodes.new("ShaderNodeTexSky"); sky.sky_type = "NISHITA"; sky.sun_elevation = math.radians(48)
sky.sun_rotation = math.radians(40); sky.sun_intensity = 0.9
bgn = wnt.nodes.new("ShaderNodeBackground"); bgn.inputs["Strength"].default_value = SKY
wnt.links.new(sky.outputs["Color"], bgn.inputs["Color"])
wnt.links.new(bgn.outputs["Background"], wnt.nodes["World Output"].inputs["Surface"])

bpy.ops.import_scene.gltf(filepath=GLB)
objs = {o.name: o for o in bpy.data.objects}
for o in bpy.data.objects:
    if o.type == "MESH":
        o.shadow_terminator_geometry_offset = 0.15; o.shadow_terminator_normal_offset = 0.15

def light(name, pos, e, size, col=(1, 1, 1)):
    d = bpy.data.lights.new(name, "AREA"); d.energy = e; d.size = size; d.color = col
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o); o.location = P(pos)
    o.rotation_euler = (-o.location).to_track_quat("-Z", "Y").to_euler(); return o
light("key", (1.6, 2.0, 2.2), 26, 3.0, (1.0, 0.96, 0.88))
light("fill", (-2.2, 0.4, 1.6), 13, 3.0, (0.80, 0.88, 1.0))
light("rim", (-1.2, 0.6, -2.0), 16, 2.5, (1.0, 0.90, 0.80))

def flap(rad):
    """Rotate each wing about its own local Z, exactly as combat-view.js does (left -rad, right +rad)."""
    for name, sgn in (("WingLeft", -1), ("WingRight", 1)):
        o = objs.get(name)
        if not o: continue
        # the imported node's local axes are the glTF node's axes with Y-up -> Z-up conversion:
        # glTF local +Z is Blender local -Y.
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = Quaternion((0, -1, 0), sgn * rad)
    bpy.context.view_layer.update()

cam_d = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cam_d); sc.collection.objects.link(cam); sc.camera = cam
cam_d.clip_start = 0.002

def shot(name, pos, target, span, persp=False, res=None):
    if ONLY and ONLY != name: return
    sc.render.resolution_x = sc.render.resolution_y = res or RES
    cam.location = P(pos); cam.rotation_euler = (P(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    if persp: cam_d.type = "PERSP"; cam_d.angle = math.radians(span)
    else: cam_d.type = "ORTHO"; cam_d.ortho_scale = span
    sc.render.filepath = os.path.join(OUT, f"{PRE}-{name}.png"); bpy.ops.render.render(write_still=True)

C = (0, 0.065, 0.045)            # roughly the middle of the bird
flap(0.0)
shot("side", (1.2, 0.09, 0.045), C, 0.40)
shot("threequarter", (0.72, 0.42, -0.80), C, 0.40)
shot("front", (0.0, 0.10, -1.2), (0, 0.07, 0.0), 0.36)
shot("top", (0.0, 1.2, 0.05), C, 0.40)
shot("rear", (0.0, 0.12, 1.2), C, 0.40)
flap(0.95)
shot("beat-up", (0.60, 0.34, -0.85), C, 0.42)
shot("beat-up-front", (0.0, 0.14, -1.2), (0, 0.08, 0.0), 0.40)
flap(-0.85)
shot("beat-down", (0.60, 0.34, -0.85), C, 0.42)
flap(0.45)
# in-game size check: 1.1x scale, seen from 6 m with a 70 deg fov, against the sky
for o in bpy.data.objects:
    if o.parent is None and o.type in ("MESH", "EMPTY"): o.scale = (1.1, 1.1, 1.1)
bpy.context.view_layer.update()
shot("insky", (2.6, 1.1, -4.6), C, 14, persp=True, res=RES)
shot("insky-far", (5.0, 2.0, -9.0), C, 14, persp=True, res=RES)
print("RENDERED to", OUT)
