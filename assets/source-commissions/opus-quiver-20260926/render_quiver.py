"""Render two review views of output/quiver.blend (does not save the .blend).
Run:  blender -b output/quiver.blend --python-exit-code 2 --python render_quiver.py
"""
import bpy, math, os
from mathutils import Vector

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "output")
sc = bpy.context.scene
sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 96
sc.cycles.use_denoising = True; sc.cycles.seed = 1
sc.render.resolution_x, sc.render.resolution_y = 1000, 1250
sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"

world = bpy.data.worlds.new("Studio"); sc.world = world; world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.035, 0.038, 0.045, 1)
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6

def light(name, loc, power, size, color=(1, 1, 1)):
    d = bpy.data.lights.new(name, "AREA"); d.energy = power; d.size = size; d.color = color
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o); o.location = loc
    o.rotation_euler = (Vector((0, 0.06, -0.1)) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()

light("Key", (0.9, 0.9, 0.7), 120, 0.8, (1.0, 0.93, 0.85))
light("Fill", (-0.9, 0.5, 0.2), 35, 1.2, (0.8, 0.9, 1.0))
light("Rim", (0.0, -0.9, 0.6), 90, 0.6, (0.75, 0.95, 1.0))
light("Top", (0.0, 0.1, 1.0), 30, 0.5)

floor = bpy.data.meshes.new("Floor"); floor.from_pydata([(-3, -3, -0.29), (3, -3, -0.29), (3, 3, -0.29), (-3, 3, -0.29)], [], [(0, 1, 2, 3)])
fo = bpy.data.objects.new("Floor", floor); sc.collection.objects.link(fo)
fm = bpy.data.materials.new("FloorMat"); fm.use_nodes = True
fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.03, 0.03, 0.035, 1)
fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
floor.materials.append(fm)

cam_d = bpy.data.cameras.new("Cam"); cam_d.lens = 55
cam = bpy.data.objects.new("Cam", cam_d); sc.collection.objects.link(cam); sc.camera = cam

views = {
    "quiver_front.png": ((0.46, 0.66, 0.16), (0.0, 0.05, -0.105)),
    "quiver_back_top.png": ((-0.42, -0.34, 0.52), (0.0, 0.045, -0.085)),
}
for fn, (loc, tgt) in views.items():
    cam.location = loc
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(OUT, fn)
    bpy.ops.render.render(write_still=True)
    print("rendered", fn)
