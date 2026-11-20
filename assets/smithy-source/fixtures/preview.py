import bpy, os, math
OUT = os.path.dirname(os.path.abspath(__file__))
for o in list(bpy.data.objects): bpy.data.objects.remove(o)
files = [("bucket", 0, 0, 1), ("lever", 0.8, 0, 1), ("pouch", 1.4, 0.3, 1), ("gloves", 2.1, 0.15, 1), ("furniture_plaque", 3.2, 0.6, 0.5),
         ("coal_billet", 4.0, 0, 1), ("armory_lamp", 4.6, 0.6, 1), ("foundry_door", 1.5, -2.0, 0.6)]
for f, x, y, s in files:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f + ".glb"))
    for o in set(bpy.data.objects) - before:
        if o.parent is None: o.location.x += x; o.location.z += y; o.scale = (s, s, s)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); bpy.context.scene.collection.objects.link(cam)
cam.location = (2.3, -6.5, 1.0); cam.rotation_euler = (math.radians(88), 0, 0); cam.data.lens = 30
bpy.context.scene.camera = cam
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN")); sun.data.energy = 3; sun.rotation_euler = (0.8, 0.2, 0.5)
bpy.context.scene.collection.objects.link(sun)
w = bpy.data.worlds.new("w"); w.use_nodes = True; w.node_tree.nodes["Background"].inputs[0].default_value = (0.35, 0.28, 0.22, 1)
bpy.context.scene.world = w
sc = bpy.context.scene; sc.render.engine = "BLENDER_EEVEE_NEXT"; sc.render.resolution_x = 1600; sc.render.resolution_y = 900
sc.render.filepath = os.path.join(OUT, "preview.png"); bpy.ops.render.render(write_still=True)
