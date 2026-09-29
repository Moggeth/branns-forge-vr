"""Compile the editable Kitchen layout into one material-batched runtime GLB.

Run: blender -b -P build_runtime_kitchen.py -- <source.blend> <runtime-dir>
The individual source GLBs remain reusable; the game loads this cheaper room kit.
"""

import json
import os
import sys
from collections import defaultdict

import bpy


def main():
    arguments = sys.argv[sys.argv.index("--") + 1:]
    if len(arguments) != 2:
        raise SystemExit("expected <source.blend> <runtime-dir>")
    source, destination = map(os.path.abspath, arguments)
    os.makedirs(destination, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=source)
    source_parts = [obj for obj in bpy.data.objects if obj.type == "MESH" and obj.get("layout")]
    if not source_parts:
        raise RuntimeError("Kitchen source has no marked layout meshes")
    compiled = bpy.data.collections.new("runtime_material_batches")
    bpy.context.scene.collection.children.link(compiled)
    groups = defaultdict(list)
    for original in source_parts:
        if len(original.data.materials) != 1:
            raise RuntimeError("Expected one material per source part: " + original.name)
        material = original.data.materials[0]
        duplicate = original.copy()
        duplicate.data = original.data.copy()
        compiled.objects.link(duplicate)
        duplicate.hide_render = False
        duplicate.hide_viewport = False
        bpy.ops.object.select_all(action="DESELECT")
        duplicate.select_set(True)
        bpy.context.view_layer.objects.active = duplicate
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        groups[material.name].append(duplicate)
    batches = []
    for material_name, objects in sorted(groups.items()):
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = objects[0]
        bpy.ops.object.join()
        merged = bpy.context.view_layer.objects.active
        merged.name = "Room_" + material_name
        batches.append(merged)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in batches:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = batches[0]
    output = os.path.join(destination, "kitchen_room.glb")
    bpy.ops.export_scene.gltf(
        filepath=output, export_format="GLB", use_selection=True,
        export_yup=True, export_apply=True, export_image_format="AUTO",
        export_materials="EXPORT",
    )
    manifest = {
        "schema": 1,
        "assets": {"room": "kitchen_room.glb"},
        "placements": [{"asset": "room", "position": [0, 0, 0], "yaw_degrees": 0, "scale": 1}],
    }
    with open(os.path.join(destination, "placement.json"), "w", encoding="utf-8") as stream:
        json.dump(manifest, stream, indent=2)
    print("KITCHEN_BATCHES", json.dumps({
        "source_parts": len(source_parts), "batches": len(batches),
        "glb_bytes": os.path.getsize(output),
    }))


main()
