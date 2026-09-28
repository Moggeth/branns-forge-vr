"""Clean-process validation: re-imports each exported GLB and writes inventory.json.

Run:  blender.exe --background --factory-startup --python output/validate_kit.py
"""
import bpy, json, os, math
from mathutils import Vector

OUT = os.path.dirname(os.path.abspath(__file__))
INV = {"units": "metres", "up_axis": "glTF +Y (Blender +Z after import)", "forward": "glTF +Z (Blender -Y)",
       "validated_by": "fresh Blender %s process, glTF re-import" % bpy.app.version_string, "assets": {}}
report = json.load(open(os.path.join(OUT, "build_report.json")))


def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.armatures, bpy.data.actions):
        for d in list(coll):
            coll.remove(d)


def bounds(objs):
    dg = bpy.context.evaluated_depsgraph_get()
    lo, hi = Vector((1e9,) * 3), Vector((-1e9,) * 3)
    for o in objs:
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        for v in me.vertices:
            w = ev.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
        ev.to_mesh_clear()
    return lo, hi


def r3(v):
    return [round(c, 3) for c in v]


for fname in ("worker.glb", "stockpile.glb", "waymarker.glb"):
    clear()
    path = os.path.join(OUT, fname)
    bpy.ops.import_scene.gltf(filepath=path)
    for o in bpy.data.objects:  # measure in bind/rest pose, not the importer's auto-applied first clip
        if o.type == 'ARMATURE':
            if o.animation_data:
                o.animation_data.action = None
            for pb in o.pose.bones:
                pb.location = (0, 0, 0); pb.rotation_quaternion = (1, 0, 0, 0); pb.rotation_euler = (0, 0, 0); pb.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    objs = list(bpy.data.objects)
    shapes = {pb.custom_shape for o in objs if o.type == 'ARMATURE' for pb in o.pose.bones if pb.custom_shape}
    meshes = [o for o in objs if o.type == 'MESH' and o not in shapes]
    objs = [o for o in objs if o not in shapes]  # importer-generated bone display shapes are not in the file
    dg = bpy.context.evaluated_depsgraph_get()
    tris = 0
    per_mesh = {}
    for o in meshes:
        me = o.evaluated_get(dg).to_mesh()
        me.calc_loop_triangles()
        per_mesh[o.name] = len(me.loop_triangles)
        tris += len(me.loop_triangles)
        o.evaluated_get(dg).to_mesh_clear()
    lo, hi = bounds(objs)
    mats = sorted({s.material.name for o in meshes for s in o.material_slots if s.material})
    blend_issues = [m.name for m in bpy.data.materials if getattr(m, "surface_render_method", "DITHERED") == 'BLENDED']
    a = {
        "file": fname, "bytes": os.path.getsize(path),
        "bounds_min": r3(lo), "bounds_max": r3(hi), "size_xyz_blender": r3(hi - lo),
        "height_m": round(hi.z - lo.z, 3), "grounded_min_z": round(lo.z, 4),
        "triangles": tris, "triangles_per_mesh": per_mesh,
        "draw_calls_estimate": sum(len(o.material_slots) for o in meshes),
        "materials": mats,
        "textures": sorted("%s %dx%d" % (i.name, i.size[0], i.size[1]) for i in bpy.data.images),
        "transparent_blend_materials": blend_issues,
        "lights": [o.name for o in objs if o.type == 'LIGHT'],
        "nodes": sorted(o.name for o in objs),
        "sockets": {o.name: r3(o.matrix_world.translation) for o in objs if o.name.startswith("socket_")},
    }
    arms = [o for o in objs if o.type == 'ARMATURE']
    if arms:
        arm = arms[0]
        a["armature"] = arm.name
        a["bones"] = [b.name for b in arm.data.bones]
        a["animations"] = {}
        arm.animation_data_create()
        for act in bpy.data.actions:
            arm.animation_data.action = act
            f0, f1 = act.frame_range
            top, zmin = -1, 9
            for f in range(int(f0), int(f1) + 1, 2):
                bpy.context.scene.frame_set(f)
                l, h = bounds(meshes)
                top, zmin = max(top, h.z), min(zmin, l.z)
            a["animations"][act.name] = {"frame_start": int(f0), "frame_end": int(f1), "fps": 24,
                                         "seconds": round((f1 - f0) / 24, 3),
                                         "max_height_m": round(top, 3), "min_z_m": round(zmin, 3)}
        arm.animation_data.action = None
    INV["assets"][fname.split(".")[0]] = a

INV["builder_report"] = report
with open(os.path.join(OUT, "inventory.json"), "w") as fh:
    json.dump(INV, fh, indent=2)
print("VALIDATE OK")
for k, v in INV["assets"].items():
    print(k, v["size_xyz_blender"], "tris", v["triangles"], "minz", v["grounded_min_z"], v.get("animations", ""))
