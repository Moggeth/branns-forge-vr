"""Clean-process reimport check: blender -b --factory-startup --python verify_glb.py"""
import bpy, os, json
from mathutils import Vector
OUT = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "bridge.glb"))
res = {"meshes": {}, "render_tris": 0, "collider_count": 0}
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in bpy.context.scene.objects:
    if o.type != 'MESH': continue
    t = sum(len(p.vertices) - 2 for p in o.data.polygons)
    res["meshes"][o.name] = t
    if "colonly" in o.name: res["collider_count"] += 1; continue
    res["render_tris"] += t
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
# Blender import converts back to Z-up: X width, Y length, Z height
res["size_xyz_blender"] = [round(hi[i] - lo[i], 3) for i in range(3)]
res["min"], res["max"] = [round(c, 3) for c in lo], [round(c, 3) for c in hi]
deck = bpy.data.objects.get("Deck")
dz = max((deck.matrix_world @ v.co).z for v in deck.data.vertices)
res["deck_top_z"] = round(dz, 4)
res["mesh_count"] = len(res["meshes"])
json.dump(res, open(os.path.join(OUT, "verify_reimport.json"), "w"), indent=2)
print("VERIFY", json.dumps(res))
