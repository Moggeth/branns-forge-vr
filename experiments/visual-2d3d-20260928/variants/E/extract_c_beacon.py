"""Export Opus C's beacon collection as a reusable, origin-centred GLB.

Run from repo root with portable Blender 4.5.13. This does not modify the C scene.
"""
from pathlib import Path
import bpy

here = Path(__file__).resolve().parent
repo = here.parents[3]
source = repo / "experiments/visual-2d3d-20260928/variants/C/scene.blend"
target = repo / "godot/assets/experimental_2d3d/beacon.glb"
target.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source))
beacon = bpy.data.collections["Beacon"]
mesh_objects = [obj for obj in beacon.objects if obj.type == "MESH"]
if len(mesh_objects) < 8:
    raise RuntimeError(f"Expected assembled C beacon, found {len(mesh_objects)} meshes")
for obj in bpy.data.objects:
    obj.select_set(False)
# C authored at Godot (24, y, -27), represented in Blender as (24, 27, y).
goal_x, goal_z = 24.0, -27.0
ground_y = 0.0
spec = __import__("json").loads((source.parent / "world_spec.json").read_text())
for hill in spec["terrain"]["hills"]:
    cx, cz = hill["center_xz"]
    r, amp = hill["radius_m"], hill["amplitude_m"]
    ground_y += amp * __import__("math").exp(-((goal_x-cx)**2+(goal_z-cz)**2)/(r*r))
for obj in mesh_objects:
    obj.location.x -= goal_x
    obj.location.y += goal_z
    obj.location.z -= ground_y
    obj.select_set(True)
bpy.context.view_layer.objects.active = mesh_objects[0]
bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", use_selection=True, export_yup=True, export_lights=False)
print(f"EXPORTED {target} meshes={len(mesh_objects)} bytes={target.stat().st_size} ground_y={ground_y:.3f}")
