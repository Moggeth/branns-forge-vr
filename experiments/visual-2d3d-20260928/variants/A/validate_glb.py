"""Reimport output/scene.glb in a clean Blender session and write output/validation.json."""
import bpy, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, "scene.glb"))
objs = [o for o in bpy.data.objects if o.type == "MESH"]
tris = sum(len(p.vertices) - 2 for o in objs for p in o.data.polygons)
spec = json.load(open(os.path.join(HERE, "world_spec.json")))
names = {o.name.split(".")[0] for o in objs}
res = {"glb_bytes": os.path.getsize(os.path.join(HERE, "scene.glb")), "mesh_objects": len(objs),
       "unique_meshes": len({o.data.name for o in objs}), "triangles": tris,
       "procedural_present": all(n in names for n in ["Terrain", "Stream_Water", "Bridge_Deck", "Beacon_Tower"]),
       "spec_objects": len(spec["objects"]),
       "library_instances_in_glb": sum(1 for o in objs if o.name.rsplit("_", 1)[0] in {x["asset_id"] for x in spec["objects"]})}
res["ok"] = res["procedural_present"] and res["library_instances_in_glb"] == res["spec_objects"]
json.dump(res, open(os.path.join(HERE, "validation.json"), "w"), indent=1)
print("VALIDATION", json.dumps(res))
