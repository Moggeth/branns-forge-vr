"""Clean-process GLB reimport check: blender --background --factory-startup --python verify_glb.py"""
import bpy, json, os
from mathutils import Vector

OUT = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "bridge.glb"))
res = {"meshes": {}, "total_triangles": 0}
lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
vis_lo = Vector((1e9,) * 3); vis_hi = Vector((-1e9,) * 3)
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    tris = sum(len(p.vertices) - 2 for p in o.data.polygons)
    res["meshes"][o.name] = tris
    for v in o.data.vertices:
        w = o.matrix_world @ v.co
        lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
        if "colonly" not in o.name:
            vis_lo = Vector(map(min, vis_lo, w)); vis_hi = Vector(map(max, vis_hi, w))
            if abs(w.x) < 1.7 - 1e-4 and w.z > 0.0055:
                res.setdefault("walkway_intrusions", []).append(o.name)
    if "colonly" not in o.name:
        res["total_triangles"] += tris
res["mesh_count"] = len(res["meshes"])
res["visual_mesh_count"] = sum("colonly" not in k for k in res["meshes"])
# Blender Z-up after import == glTF Y-up
res["visual_size_m"] = [round(c, 3) for c in (vis_hi - vis_lo)]
res["visual_min_blender"] = [round(c, 3) for c in vis_lo]
res["visual_max_blender"] = [round(c, 3) for c in vis_hi]
res["walkway_intrusions"] = sorted(set(res.get("walkway_intrusions", [])))
with open(os.path.join(OUT, "verify_reimport.json"), "w") as f:
    json.dump(res, f, indent=2)
print("VERIFY", json.dumps(res))
