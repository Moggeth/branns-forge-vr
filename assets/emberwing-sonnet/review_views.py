"""Faithful standard review views of installed Emberwing GLBs, no model generation.
Run Blender -b --python review_views.py -- --model bow.glb --out DIR.
"""
import argparse
import hashlib
import json
import math
import sys
import time
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector

parser = argparse.ArgumentParser()
parser.add_argument("--model", required=True)
parser.add_argument("--out", required=True)
parser.add_argument("--size", type=int, default=1800)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
model = Path(args.model).resolve()
out = Path(args.out).resolve()
out.mkdir(parents=True, exist_ok=True)
started = time.perf_counter()


def point(xyz):
    # glTF +Y up/-Z shot -> Blender +Z up/+Y shot.
    return Vector((xyz[0], -xyz[2], xyz[1]))


def make_light(name, position, energy, size):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.size, data.color = energy, size, (1, 1, 1)
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.location = point(position)
    obj.rotation_euler = (-obj.location).to_track_quat("-Z", "Y").to_euler()


def material(name, colour):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*colour, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*colour, 1)
    shader.inputs["Roughness"].default_value = .7
    return mat


def strand(name, a, b):
    delta = b - a
    bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=.0018, depth=delta.length, location=(a+b)/2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    obj.data.materials.append(thread)
    return obj


bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = "BLENDER_EEVEE_NEXT"
scene.eevee.taa_render_samples = 64
scene.render.resolution_x = scene.render.resolution_y = args.size
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
scene.render.image_settings.color_depth = "8"
scene.view_settings.view_transform = "AgX"
scene.view_settings.exposure = 0
scene.world = bpy.data.worlds.new("Neutral review studio")
scene.world.use_nodes = True
scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.17, .18, .20, 1)
scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .55
bpy.ops.import_scene.gltf(filepath=str(model))
original_meshes = [obj for obj in scene.objects if obj.type == "MESH"]
dimensions = []
corners = [obj.matrix_world @ Vector(corner) for obj in original_meshes for corner in obj.bound_box]
for axis in range(3):
    dimensions.append(max(v[axis] for v in corners)-min(v[axis] for v in corners))
thread = material("Runtime string approximation", (.71, .61, .42))
top = bpy.data.objects["StringTop"].matrix_world.translation.copy()
bottom = bpy.data.objects["StringBottom"].matrix_world.translation.copy()
nock = bpy.data.objects["ArrowRest"].matrix_world.translation.copy()
strings = [strand("ReviewStringUpper", top, nock), strand("ReviewStringLower", nock, bottom)]
# This export is a clearly labelled rest-pose review copy, never a live replacement.
bpy.ops.export_scene.gltf(filepath=str(out / "Emberwing-assembled-review.glb"), export_format="GLB")
make_light("Large neutral key", (1.8, 2.2, 2.4), 180, 3)
make_light("Firing-side fill", (-1.6, .3, -2.2), 130, 2.5)
make_light("Side fill", (-2.4, .1, 1.8), 100, 3)
make_light("Upper edge fill", (.4, 2.0, -1.2), 90, 2)
camera_data = bpy.data.cameras.new("Review Camera")
camera = bpy.data.objects.new("Review Camera", camera_data)
scene.collection.objects.link(camera)
scene.camera = camera

views = [
    ("01-front", "Front · firing side (-Z)", (0,0,-3), (0,0,0), 1.50, "ORTHO"),
    ("02-back", "Back · string side (+Z)", (0,0,3), (0,0,0), 1.50, "ORTHO"),
    ("03-left", "Left (-X)", (-3,0,0), (0,0,0), 1.50, "ORTHO"),
    ("04-right", "Right (+X)", (3,0,0), (0,0,0), 1.50, "ORTHO"),
    ("05-top", "Top (+Y) · enlarged", (0,3,0), (0,0,0), .64, "ORTHO"),
    ("06-bottom", "Bottom (-Y) · enlarged", (0,-3,0), (0,0,0), .64, "ORTHO"),
    ("07-front-quarter", "Front three-quarter", (1.6,.25,-2.1), (0,0,0), 1.50, "ORTHO"),
    ("08-back-quarter", "Back three-quarter", (-1.6,.25,2.1), (0,0,0), 1.50, "ORTHO"),
    ("09-grip", "Grip / arrow port close-up", (.4,.04,-1), (0,.005,0), .31, "ORTHO"),
    ("10-phoenix", "Phoenix / material close-up", (.4,.35,-1), (0,.20,-.08), .36, "ORTHO"),
    ("11-drawn", "50 cm draw · side view", (3,0,.18), (0,0,.18), 1.50, "ORTHO"),
    ("12-wireframe", "Triangulated mesh · front quarter", (1.6,.25,-2.1), (0,0,0), 1.50, "ORTHO"),
]
records = []


def render_view(entry):
    stem, title, position, target, scale, projection = entry
    before = time.perf_counter()
    camera.location = point(position)
    camera.rotation_euler = (point(target)-camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = projection
    camera_data.ortho_scale = scale
    scene.render.filepath = str(out / (stem + ".png"))
    bpy.ops.render.render(write_still=True)
    record = {"file": stem+".png", "title": title, "camera_gltf_m": position,
              "target_gltf_m": target, "orthographic_span_m": scale,
              "seconds": round(time.perf_counter()-before, 3)}
    records.append(record)
    print("REVIEW_VIEW " + json.dumps(record), flush=True)


for entry in views[:10]:
    render_view(entry)

# Use the same modest limb flex and string anchors as the runtime draw.
for obj in strings:
    bpy.data.objects.remove(obj, do_unlink=True)
flex = .09 * .50/.68
upper = bpy.data.objects["UpperLimb"]
lower = bpy.data.objects["LowerLimb"]
for obj, angle in [(upper, flex), (lower, -flex)]:
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = obj.rotation_quaternion @ Quaternion((1,0,0), angle)
draw_nock = point((0,0,.60))
strings = [strand("DrawStringUpper", Quaternion((1,0,0),flex) @ top, draw_nock),
           strand("DrawStringLower", draw_nock, Quaternion((1,0,0),-flex) @ bottom)]
before_import = set(scene.objects)
bpy.ops.import_scene.gltf(filepath=str(model.parent / "arrow.glb"))
arrow_objects = [obj for obj in scene.objects if obj not in before_import]
for obj in arrow_objects:
    if obj.parent is None:
        obj.location += draw_nock
render_view(views[10])
for obj in arrow_objects + strings:
    bpy.data.objects.remove(obj, do_unlink=True)
for obj, angle in [(upper, -flex), (lower, flex)]:
    obj.rotation_quaternion = obj.rotation_quaternion @ Quaternion((1,0,0), angle)

wire = bpy.data.materials.new("Review triangulation")
wire.use_nodes = True
nodes = wire.node_tree.nodes
nodes.clear()
output = nodes.new("ShaderNodeOutputMaterial")
emission = nodes.new("ShaderNodeEmission")
emission.inputs["Color"].default_value = (.24,.29,.35,1)
wire.node_tree.links.new(emission.outputs[0], output.inputs["Surface"])
edge_mat = material("Actual triangle edges", (.012,.02,.03))
for obj in original_meshes:
    obj.data.materials.clear()
    obj.data.materials.append(wire)
    obj.data.materials.append(edge_mat)
    for face in obj.data.polygons:
        face.material_index = 0
    edges = obj.modifiers.new("Review edges only", "WIREFRAME")
    edges.thickness = .00065
    edges.use_replace = False
    edges.use_even_offset = False
    edges.material_offset = 1
render_view(views[11])
manifest = {"model": model.name, "sha256": hashlib.sha256(model.read_bytes()).hexdigest(),
            "dimensions_gltf_m": [dimensions[0], dimensions[2], dimensions[1]],
            "resolution": [args.size,args.size], "renderer": "Blender EEVEE",
            "notes": "Installed GLB. Neutral white lights, AgX, no bloom or concept retouching. Rest string added from runtime anchors. Detail/top views enlarged; spans recorded.",
            "views": records, "seconds": round(time.perf_counter()-started, 3)}
(out / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print("REVIEW_COMPLETE " + json.dumps({"views":len(records),"seconds":manifest["seconds"]}), flush=True)
