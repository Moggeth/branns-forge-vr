import bpy, sys, os
for v in ("prismwatch", "cinderkeep"):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join("output", v + "_rig.glb"))
    arms = [o for o in bpy.data.objects if o.type == "ARMATURE"]
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    zs = [(o.matrix_world @ p.co).z for o in meshes for p in o.data.vertices]
    print("VERIFY", v, "arm", [a.name for a in arms], "bones", [b.name for b in arms[0].data.bones],
          "meshes", sorted(o.name for o in meshes), "skinned", sum(any(m.type == "ARMATURE" for m in o.modifiers) for o in meshes),
          "actions", sorted(a.name for a in bpy.data.actions), "zrange %.3f..%.3f" % (min(zs), max(zs)))
