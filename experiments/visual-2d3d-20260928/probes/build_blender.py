"""Blender 2.93 headless 2.5D and view-dependent probes from saved 2D artwork."""
import bpy
from math import radians
from mathutils import Vector
from pathlib import Path
import json
import time

HERE = Path(__file__).resolve().parent
OUT = HERE / "renders"
OUT.mkdir(exist_ok=True)
metrics = []


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.taa_render_samples = 32
    scene.render.resolution_x = 800
    scene.render.resolution_y = 600
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.world = bpy.data.worlds.new("sky")
    scene.world.color = (0.52, 0.65, 0.77)
    return scene


def material(name, color, texture=None, alpha=False):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = (*color, 1)
    shader.inputs["Roughness"].default_value = 0.9
    if texture:
        tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(texture), check_existing=True)
        mat.node_tree.links.new(tex.outputs["Color"], shader.inputs["Base Color"])
        if alpha:
            mat.node_tree.links.new(tex.outputs["Alpha"], shader.inputs["Alpha"])
            mat.blend_method = "CLIP"
            mat.alpha_threshold = 0.5
            mat.use_nodes = True
            mat.show_transparent_back = False
    return mat


def cube(name, location, scale, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def plane(name, location, width, height, mat, yaw=0):
    bpy.ops.mesh.primitive_plane_add(size=1, location=location, rotation=(radians(90), 0, yaw))
    obj = bpy.context.object
    obj.name = name
    obj.scale = (width, height, 1)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    return obj


def camera(scene, name, location, target, fov=60):
    bpy.ops.object.camera_add(location=location)
    obj = bpy.context.object
    obj.name = name
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    obj.data.type = "PERSP"
    obj.data.lens = 36 / (2 * __import__("math").tan(radians(fov) / 2))
    scene.camera = obj
    return obj


def light(location):
    bpy.ops.object.light_add(type="AREA", location=location)
    bpy.context.object.data.energy = 900
    bpy.context.object.data.size = 9


def render(scene, filename, probe, view):
    scene.render.filepath = str(OUT / filename)
    t0 = time.perf_counter()
    bpy.ops.render.render(write_still=True)
    metrics.append({"probe": probe, "view": view, "file": filename,
                    "render_seconds": round(time.perf_counter() - t0, 3),
                    "resolution": [800, 600], "engine": "Blender 2.93 Eevee"})


def foliage_probe():
    scene = reset()
    ground = material("plain_ground", (0.49, 0.60, 0.34))
    trunk = material("proxy_trunk", (0.31, 0.19, 0.10))
    leaves = material("proxy_leaves", (0.22, 0.43, 0.17))
    cardmat = material("generated_tree_card", (1, 1, 1), HERE / "textures" / "generated_tree_cutout.png", True)
    cube("ground", (1.9, 0, -0.08), (14, 14, 0.15), ground)
    # Crossed cards supply two façade directions but have no volumetric crown.
    plane("generated_card_front", (-2, 0, 1.5), 2.35, 3.0, cardmat)
    plane("generated_card_cross", (-2, 0, 1.5), 2.35, 3.0, cardmat, radians(90))
    cube("proxy_3d_trunk", (2, 0, 0.72), (0.38, 0.38, 1.45), trunk)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.35, location=(2, 0, 2.05))
    bpy.context.object.name = "proxy_3d_crown"
    bpy.context.object.data.materials.append(leaves)
    light((-3, -5, 8))
    # Same camera movement applies to card and geometric proxy.
    for view, loc in [("front", (0, -9, 4.0)), ("side_75deg", (-10, -2.4, 4.0)),
                      ("stereo_left", (-0.032, -9, 4.0)), ("stereo_right", (0.032, -9, 4.0))]:
        camera(scene, view, loc, (0, 0, 1.3), 52)
        render(scene, "foliage_" + view + ".png", "2.5D", view)
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "foliage_probe.blend"))


def view_probe():
    scene = reset()
    ground = material("grass", (0.35, 0.52, 0.24))
    frame = material("panel_edge", (0.13, 0.12, 0.10))
    panel = material("generated_scene_panel", (1, 1, 1), HERE / "textures" / "generated_approach_panel.png")
    cube("ground", (0, 5, -0.08), (20, 20, 0.15), ground)
    # 2D target image mounted at 8 m: deliberately matches one camera only.
    plane("reference_panel", (0, 8, 4.3), 6.7, 8.3, panel)
    cube("thin_panel_backing", (0, 8.04, 4.3), (6.8, 0.06, 8.4), frame)
    light((-3, -4, 10))
    for view, loc, target in [("matched", (0, -2, 2.0), (0, 8, 4.0)),
                              ("unfamiliar_70deg", (9.4, 5.0, 2.0), (0, 8, 4.0)),
                              ("close_left", (-2, 4.5, 1.6), (0, 8, 3.5))]:
        camera(scene, view, loc, target, 54)
        render(scene, "view_" + view + ".png", "view_driven", view)
    bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "view_driven_probe.blend"))


start = time.perf_counter()
foliage_probe()
view_probe()
(HERE / "render_metrics.json").write_text(json.dumps({"wall_seconds": round(time.perf_counter() - start, 3),
                                                       "renders": metrics}, indent=2), encoding="utf-8")
