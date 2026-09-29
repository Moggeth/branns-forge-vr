"""blender --background pocket_thunder.blend --python render_previews.py -- <out_dir>
Renders hero, palm-scale, flight-scale and forming previews (Cycles, low samples, denoised)."""
import bpy, math, sys, os
from mathutils import Vector

OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else "."
R = 0.095
sc = bpy.context.scene
root = bpy.data.objects["PocketThunder"]
sc.render.engine = 'CYCLES'
sc.cycles.samples = 48
sc.cycles.use_denoising = True
sc.render.resolution_x = sc.render.resolution_y = 900
sc.view_settings.view_transform = 'AgX'

extras = []


def track(cam, target):
    d = Vector(target) - cam.location
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def world(top, bottom, strength=1.0):
    w = bpy.data.worlds.new("W") if not sc.world else sc.world
    sc.world = w
    w.use_nodes = True
    n = w.node_tree
    n.nodes.clear()
    tc = n.nodes.new("ShaderNodeTexCoord")
    sep = n.nodes.new("ShaderNodeSeparateXYZ")
    ramp = n.nodes.new("ShaderNodeValToRGB")
    bg = n.nodes.new("ShaderNodeBackground")
    out = n.nodes.new("ShaderNodeOutputWorld")
    n.links.new(tc.outputs["Generated"], sep.inputs[0])
    n.links.new(sep.outputs["Z"], ramp.inputs[0])
    ramp.color_ramp.elements[0].color = bottom
    ramp.color_ramp.elements[1].color = top
    n.links.new(ramp.outputs[0], bg.inputs[0])
    bg.inputs[1].default_value = strength
    n.links.new(bg.outputs[0], out.inputs[0])


def light(name, kind, loc, energy, color, size=1.0):
    d = bpy.data.lights.new(name, kind)
    d.energy = energy
    d.color = color
    if kind == 'AREA':
        d.size = size
    o = bpy.data.objects.new(name, d)
    sc.collection.objects.link(o)
    o.location = loc
    extras.append(o)
    track(o, (0, 0, 0))
    return o


def camera(loc, target, lens):
    c = bpy.data.cameras.new("cam")
    c.lens = lens
    o = bpy.data.objects.new("cam", c)
    sc.collection.objects.link(o)
    o.location = loc
    track(o, target)
    sc.camera = o
    extras.append(o)
    return o


def mat(name, col, rough=0.6, emit=None, strength=0, alpha=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = col
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = emit
        b.inputs["Emission Strength"].default_value = strength
    return m


def prim(kind, loc, scale, m, rot=(0, 0, 0)):
    if kind == 'sphere':
        bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=loc)
    else:
        bpy.ops.mesh.primitive_cylinder_add(vertices=24, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    o.rotation_euler = rot
    o.data.materials.append(m)
    bpy.ops.object.shade_smooth()
    extras.append(o)
    return o


def cleanup():
    for o in extras:
        bpy.data.objects.remove(o, do_unlink=True)
    extras.clear()


def set_forming(p):
    shell = bpy.data.objects["Shell"]
    for seg in shell.children:
        if "rest" not in seg:
            seg["rest"] = tuple(seg.location)
        d = Vector(seg["burst_dir"])
        ph = seg["phase"]
        a = min(1.0, max(0.0, (p - ph) / (0.92 - ph)))
        a = a * a * (3 - 2 * a)
        seg.location = Vector(seg["rest"]) + d * R * (1 - a) * 2.4
        seg.scale = Vector((1, 1, 1)) * max(0.02, a)
        seg.rotation_euler = ((1 - a) * 0.7, 0, (1 - a) * 0.4)


def render(name):
    sc.render.filepath = os.path.join(OUT, name)
    bpy.ops.render.render(write_still=True)


# 1 ---- hero turntable-style 3/4 view
world((0.05, 0.07, 0.10, 1), (0.01, 0.012, 0.02, 1), 0.6)
root.rotation_euler = (math.radians(-12), 0, math.radians(25))
camera((0.24, -0.30, 0.16), (0, 0, 0.005), 85)
light("key", 'AREA', (0.3, -0.35, 0.4), 22, (1.0, 0.78, 0.55), 0.3)
light("rim", 'AREA', (-0.4, 0.3, 0.2), 30, (0.5, 0.9, 1.0), 0.3)
render("render_01_hero.png")
cleanup()

# 2 ---- palm scale: stylised cupped hand proxy, VR-ish 90deg-ish view from player's eyes
skin = mat("skin", (0.62, 0.42, 0.33, 1), 0.7)
root.rotation_euler = (math.radians(-8), 0, math.radians(35))
root.location = (0, 0, 0)
prim('sphere', (0, 0.01, -0.125), (0.055, 0.075, 0.03), skin)  # palm pad
for i, x in enumerate((-0.048, -0.016, 0.016, 0.048)):
    L = (0.075, 0.085, 0.08, 0.062)[i]
    for k in range(2):
        prim('cylinder', (x * 1.15, -0.085 - 0.075 - k * 0.0, -0.105 + 0.03 * k), (0.0125, 0.0125, 0.03), skin, (math.radians(70 - k * 25), 0, 0))
prim('sphere', (-0.075, 0.03, -0.1), (0.018, 0.05, 0.02), skin, (0, 0, math.radians(30)))  # thumb
prim('sphere', (0, 0.0, -0.157), (0.06, 0.07, 0.02), skin)
world((0.10, 0.09, 0.09, 1), (0.02, 0.02, 0.025, 1), 0.5)
camera((0.0, 0.30, 0.34), (0, -0.01, -0.07), 45)
light("key", 'AREA', (0.4, 0.5, 0.6), 60, (1.0, 0.85, 0.7), 0.6)
light("rim", 'AREA', (-0.5, 0.0, 0.3), 40, (0.5, 0.8, 1.0), 0.4)
render("render_02_palm_scale.png")
cleanup()
root.rotation_euler = (0, 0, 0)

# 3 ---- flight scale: 3 m away, arcing trail ribbon of segments (matches existing trail concept)
world((0.36, 0.5, 0.7, 1), (0.10, 0.12, 0.10, 1), 1.0)
root.location = (0, 0, 0)
root.rotation_euler = (0.4, 0, 0.9)
teal = mat("trail", (0.2, 1, 0.8, 1), 0.3, (0.3, 1, 0.8, 1), 6)
prim('cylinder', (0, 0, -1.2), (12, 12, 0.02), mat("ground", (0.12, 0.15, 0.10, 1), 0.9))
for i in range(1, 7):
    t = i * 0.035 * 1.0
    p = Vector((-i * 0.16, i * 0.05, i * 0.06 * i * 0.2))
    o = prim('sphere', p, (R * 0.22 * (1 - i / 8),) * 3, teal)
camera((0.6, -3.6, 0.5), (-0.3, 0, 0.1), 50)
light("sun", 'AREA', (2, -3, 4), 900, (1.0, 0.92, 0.8), 3)
render("render_03_flight_scale.png")
cleanup()

# 4 ---- forming progress 0.45 (fragments assembling around heart), dark to show glow
world((0.03, 0.04, 0.06, 1), (0.005, 0.005, 0.01, 1), 0.4)
root.rotation_euler = (math.radians(-15), 0, math.radians(20))
set_forming(0.42)
camera((0.35, -0.45, 0.25), (0, 0, 0), 60)
light("key", 'AREA', (0.4, -0.4, 0.5), 35, (1.0, 0.8, 0.6), 0.3)
light("rim", 'AREA', (-0.5, 0.4, 0.2), 40, (0.5, 0.9, 1.0), 0.3)
render("render_04_forming.png")
cleanup()
set_forming(1.0)

# 5 ---- glow close-up seam/heart read (dim room)
world((0.01, 0.012, 0.02, 1), (0.0, 0.0, 0.0, 1), 0.2)
root.rotation_euler = (math.radians(-30), 0, math.radians(10))
camera((0.16, -0.22, 0.10), (0, 0, 0), 70)
light("key", 'AREA', (0.3, -0.3, 0.4), 8, (1.0, 0.7, 0.4), 0.2)
render("render_05_seam_glow.png")
print("PT_RENDERS_DONE")
