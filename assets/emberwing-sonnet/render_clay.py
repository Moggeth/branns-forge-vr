"""Neutral clay contact sheet from the EXPORTED bow.glb (Workbench, orthographic).
Run: blender --background --python render_clay.py -- --out ABS_DIR"""
import bpy, sys, os, math
import numpy as np
from mathutils import Vector
argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath("output")
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "bow.glb"))
sc = bpy.context.scene
sc.render.engine = "BLENDER_WORKBENCH"
sh = sc.display.shading
sh.light = "STUDIO"; sh.color_type = "SINGLE"; sh.single_color = (0.78, 0.74, 0.68)
sh.show_cavity = True; sh.cavity_type = "BOTH"; sh.cavity_ridge_factor = 1.0; sh.cavity_valley_factor = 1.2
sh.show_shadows = True; sh.shadow_intensity = 0.35
sc.view_settings.view_transform = "Standard"
w = bpy.data.worlds.new("w"); w.use_nodes = False; w.color = (0.32, 0.34, 0.37); sc.world = w
sc.render.film_transparent = False
T = 640
sc.render.resolution_x = T; sc.render.resolution_y = T; sc.render.image_settings.file_format = "PNG"
def B(p): return Vector((p[0], -p[2], p[1]))
cam = bpy.data.cameras.new("c"); cam.type = "ORTHO"; co = bpy.data.objects.new("c", cam); sc.collection.objects.link(co); sc.camera = co
views = [("Front (-Z, firing side)", (0, 0.0, -3), (0, 0, 0), 1.40),
         ("Side (+X)", (3, 0.0, 0), (0, 0, 0), 1.40),
         ("Three-quarter", (1.8, 0.7, -2.2), (0, 0, 0), 1.40),
         ("Grip + riser window (3/4)", (1.2, 0.35, -1.4), (0, 0.07, -0.02), 0.34),
         ("Phoenix head (3/4)", (1.3, 0.55, -1.5), (0, 0.21, -0.10), 0.28),
         ("Archer view (+Z) window", (0, 0.115, 3), (0, 0.115, 0), 0.34)]
tiles = []
for i, (nm, pos, tgt, sc_) in enumerate(views):
    co.location = B(pos); co.data.ortho_scale = sc_
    d = B(tgt) - co.location
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    co.data.clip_start = 0.01; co.data.clip_end = 50
    fp = os.path.join(OUT, f"_clay_{i}.png"); sc.render.filepath = fp
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(fp); a = np.array(img.pixels[:], dtype=np.float32).reshape(T, T, 4); tiles.append(a); bpy.data.images.remove(img)
    os.remove(fp)
rows = [np.concatenate(tiles[r * 3:(r + 1) * 3], axis=1) for r in range(2)]
sheet = np.concatenate(rows[::-1], axis=0)   # pixel rows are bottom-up in Blender
im = bpy.data.images.new("sheet", sheet.shape[1], sheet.shape[0], alpha=True)
im.pixels.foreach_set(sheet.ravel()); im.filepath_raw = os.path.join(OUT, "clay-contact-sheet.png"); im.file_format = "PNG"; im.save()
print("saved clay-contact-sheet.png", sheet.shape)
