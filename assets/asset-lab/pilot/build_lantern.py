"""Build a small Forge Yard lantern with Blender 4.5.13.

    blender --background --factory-startup --python-exit-code 2 \
      --python build_lantern.py -- --out ABS_PATH

Coordinates in the exported GLB are Godot metres: +Y up, -Z forward.
Only selected art and marker nodes are exported; studio lights stay in the Blend.
"""

import argparse
import json
import math
import os
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def arguments():
    tail = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args(tail)
    if not args.out.is_absolute():
        parser.error("--out must be an absolute directory")
    return args


OUT = arguments().out.resolve()
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)


def color(hex_color):
    rgb = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in rgb] + [1.0]


def material(name, hex_color, metallic=0.0, roughness=0.6, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = color(hex_color)
    p.inputs["Metallic"].default_value = metallic
    p.inputs["Roughness"].default_value = roughness
    if emission:
        p.inputs["Emission Color"].default_value = color(emission)
        p.inputs["Emission Strength"].default_value = 2.3
    return mat


BRASS = material("Warm hammered brass", "ad7441", 0.8, 0.32)
DARK = material("Soot-dark iron", "282628", 0.7, 0.48)
GLASS = material("Honey glass", "a85424", 0.12, 0.32, "de7625")
EMBER = material("Lantern ember", "ffe398", 0.0, 0.42, "ffab38")
LEATHER = material("Worn leather grip", "59351f", 0.0, 0.9)
EXPORT = []


def keep(obj, name, mat=None):
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    EXPORT.append(obj)
    return obj


def cylinder(name, radius, depth, z, mat, vertices=12, radius_top=None):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius,
                                    radius2=radius if radius_top is None else radius_top,
                                    depth=depth, location=(0, 0, z))
    return keep(bpy.context.object, name, mat)


def bar(name, start, end, radius, mat, vertices=8):
    direction = Vector(end) - Vector(start)
    midpoint = (Vector(start) + Vector(end)) / 2
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius,
                                        depth=direction.length, location=midpoint)
    obj = keep(bpy.context.object, name, mat)
    obj.rotation_euler = direction.to_track_quat("Z", "Y").to_euler()
    return obj


def ico(name, location, scale, mat, subdivisions=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1,
                                          location=location)
    obj = keep(bpy.context.object, name, mat)
    obj.scale = scale
    return obj


# Author in Blender Z-up. Exporter's Y-up conversion gives Godot X,Y,Z =
# Blender X,Z,-Y. The lantern's front points toward Godot -Z / Blender +Y.
cylinder("Foot", 0.067, 0.016, 0.008, DARK, 16)
cylinder("LowerBrassBand", 0.071, 0.013, 0.022, BRASS, 16)
cylinder("LowerCup", 0.058, 0.035, 0.045, DARK, 12, 0.052)
cylinder("WickSocket", 0.025, 0.014, 0.076, BRASS, 12)

# Opaque honey panels form a faceted glow chamber. Metal posts stay separate
# so future runtime animation or a damage state can address them by name.
cylinder("HoneyGlass", 0.049, 0.133, 0.144, GLASS, 6)
for i in range(6):
    angle = math.tau * i / 6 + math.pi / 6
    x, y = 0.055 * math.cos(angle), 0.055 * math.sin(angle)
    bar(f"CagePost_{i + 1:02d}", (x, y, 0.080), (x, y, 0.218), 0.005, DARK)

cylinder("UpperBrassBand", 0.067, 0.014, 0.222, BRASS, 16)
cylinder("VentRoof", 0.073, 0.052, 0.253, DARK, 12, 0.026)
cylinder("RoofFinial", 0.020, 0.018, 0.289, BRASS, 12, 0.007)
ico("FlameCore", (0, 0, 0.145), (0.019, 0.019, 0.047), EMBER, 1)

# Thumb-safe rear grip and arched carry handle. No collider is exported;
# the game can create simple proxies from the contract markers and bounds.
bar("GripStem", (0, -0.050, 0.132), (0, -0.090, 0.132), 0.016, DARK, 12)
bar("GripWrap", (0, -0.085, 0.132), (0, -0.115, 0.132), 0.023, LEATHER, 12)
for i in range(9):
    a = math.pi * i / 8
    b = math.pi * (i + 1) / 8
    start = (0.056 * math.cos(a), 0, 0.288 + 0.053 * math.sin(a))
    end = (0.056 * math.cos(b), 0, 0.288 + 0.053 * math.sin(b))
    bar(f"CarryHandle_{i + 1:02d}", start, end, 0.006, BRASS)


def marker(name, location):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.empty_display_type = "SPHERE"
    obj.empty_display_size = 0.012
    obj.location = location
    EXPORT.append(obj)
    return obj


# Blender locations convert to Godot Grip=(0,.132,+.101),
# Flame=(0,.145,0); both are stable assembly markers.
marker("Grip", (0, -0.101, 0.132))
marker("Flame", (0, 0, 0.145))

for obj in EXPORT:
    obj.select_set(True)
bpy.context.view_layer.objects.active = EXPORT[0]
glb = OUT / "model.glb"
bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB",
                          use_selection=True, export_yup=True, export_apply=False)

# Set up an editable studio scene and three useful review angles.
world = bpy.context.scene.world
world.color = (0.11, 0.11, 0.11)
world.use_nodes = True
world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
light_data = bpy.data.lights.new("Softbox", "AREA")
light = bpy.data.objects.new("Softbox", light_data)
bpy.context.collection.objects.link(light)
light.location = (0.55, 0.6, 0.7)
light_data.energy = 90
light_data.shape = "DISK"
light_data.size = 0.7
camera_data = bpy.data.cameras.new("Camera")
camera = bpy.data.objects.new("Camera", camera_data)
bpy.context.collection.objects.link(camera)
bpy.context.scene.camera = camera
camera_data.type = "ORTHO"
camera_data.ortho_scale = 0.48
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.image_settings.color_mode = "RGBA"
scene.view_settings.view_transform = "AgX"
for name, position in (
    ("front", (0.02, 0.75, 0.34)),
    ("side", (0.75, 0.04, 0.36)),
    ("three_quarter", (0.44, -0.66, 0.43)),
):
    camera.location = position
    camera.rotation_euler = (Vector((0, 0, 0.16)) - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.filepath = str(OUT / f"{name}.png")
    bpy.ops.render.render(write_still=True)

bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "source.blend"))
vertices = [obj.matrix_world @ Vector(corner)
            for obj in EXPORT if obj.type == "MESH" for corner in obj.bound_box]
lo = [min(p[i] for p in vertices) for i in range(3)]
hi = [max(p[i] for p in vertices) for i in range(3)]
report = {
    "asset": "Forge Yard Lantern",
    "format": "GLB 2.0",
    "units": "metres",
    "godot_axes": "+Y up, -Z front",
    "godot_bounds_min": [round(lo[0], 6), round(lo[2], 6), round(-hi[1], 6)],
    "godot_bounds_max": [round(hi[0], 6), round(hi[2], 6), round(-lo[1], 6)],
    "mesh_names": [obj.name for obj in EXPORT if obj.type == "MESH"],
    "marker_positions": {obj.name: [round(obj.location.x, 6), round(obj.location.z, 6),
                                    round(-obj.location.y, 6)]
                         for obj in EXPORT if obj.type == "EMPTY"},
    "triangles": sum(len(p.vertices) - 2 for obj in EXPORT if obj.type == "MESH"
                     for p in obj.data.polygons),
    "materials": sorted({m.name for obj in EXPORT if obj.type == "MESH"
                         for m in obj.data.materials}),
}
(OUT / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print("ASSET_LAB_RESULT " + json.dumps(report, separators=(",", ":")))
