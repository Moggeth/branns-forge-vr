"""Renders previews FROM THE EXPORTED golem.glb (proves embedded textures survive export).
  blender.exe --background --factory-startup --python-exit-code 2 --python output/render_preview.py [-- pose]
Outputs preview_{three_quarter,front,side,back,breakdown,closeup_head,rts}.png next to this file.
"""
import bpy, os, sys, math
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "golem.glb"))
sc = bpy.context.scene
try:
    sc.render.engine = "BLENDER_EEVEE_NEXT"
except TypeError:
    sc.render.engine = "BLENDER_EEVEE"
sc.render.resolution_x = sc.render.resolution_y = 1000
sc.view_settings.view_transform = "Filmic" if "Filmic" in [i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "Standard"
try:
    sc.eevee.taa_render_samples = 48
    sc.eevee.use_raytracing = False
except Exception:
    pass

# world: soft warm-cool dome
w = bpy.data.worlds.new("W")
sc.world = w
w.use_nodes = True
bg = w.node_tree.nodes["Background"]
bg.inputs["Color"].default_value = (0.42, 0.47, 0.55, 1)
bg.inputs["Strength"].default_value = 0.9

def light(kind, loc, energy, color, size=3.0, target=(0, 0, 1.1)):
    d = bpy.data.lights.new(kind, kind)
    d.energy = energy
    d.color = color
    if kind == "AREA":
        d.size = size
    ob = bpy.data.objects.new(kind, d)
    sc.collection.objects.link(ob)
    ob.location = loc
    v = Vector(target) - Vector(loc)
    ob.rotation_euler = v.to_track_quat("-Z", "Y").to_euler()
    return ob

light("SUN", (-3, -4, 5), 2.6, (1.0, 0.92, 0.80)).data.angle = math.radians(12)
light("AREA", (4, -2.5, 2.5), 350, (0.65, 0.78, 1.0), 4)
light("AREA", (0, 4, 3), 250, (1.0, 0.85, 0.65), 4)

# ground disc
bpy.ops.mesh.primitive_circle_add(vertices=64, radius=3.2, fill_type="NGON", location=(0, 0, -0.002))
g = bpy.context.object
gm = bpy.data.materials.new("Ground")
gm.diffuse_color = (0.16, 0.14, 0.12, 1)
gm.use_nodes = True
gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.17, 0.15, 0.13, 1)
gm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.95
g.data.materials.append(gm)

cam_d = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_d)
sc.collection.objects.link(cam)
sc.camera = cam

def shoot(name, loc, target, lens=50):
    cam_d.lens = lens
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(HERE, f"preview_{name}.png")
    bpy.ops.render.render(write_still=True)
    print("rendered", name)

T = (0, 0, 1.12)
# golem faces -Y in Blender
shoot("three_quarter", (-3.6, -4.2, 1.9), T, 55)
shoot("front", (0, -6.5, 1.3), T, 55)
shoot("side", (6.5, 0, 1.3), T, 55)
shoot("back", (0, 6.5, 1.5), T, 55)
shoot("closeup_head", (-0.9, -1.7, 2.1), (0, -0.05, 1.95), 60)
shoot("rts", (-2.6, -3.4, 7.0), (0, 0, 0.9), 50)
shoot("vr_eye", (-0.9, -3.2, 1.65), (0, 0, 1.5), 40)

# modular breakdown: push removable armour and pivots apart
ob = bpy.data.objects
def nudge(n, d):
    ob[n].location = ob[n].location + Vector(d)
for n, d in (("ShoulderL", (0.45, 0, 0.3)), ("ShoulderR", (-0.45, 0, 0.3)), ("ChestPlate", (0, -0.6, 0.1)),
             ("CoreGlow", (0, -1.0, 0.0)), ("ForearmL", (0.55, -0.15, 0)), ("ForearmR", (-0.55, -0.15, 0)),
             ("Head", (0, 0, 0.35)), ("ArmL", (0.4, 0, 0)), ("ArmR", (-0.4, 0, 0)), ("LegL", (0.25, 0, 0)), ("LegR", (-0.25, 0, 0))):
    if n in ob:
        nudge(n, d)
shoot("breakdown", (-3.8, -5.0, 2.1), (0, -0.2, 1.2), 50)
