"""Re-import every exported GLB into a clean scene and render the contact sheet.

  ../../tools/blender-4.5.13-windows-x64/blender.exe -b --factory-startup -P render_sheet.py

Proves each GLB imports standalone (mesh + embedded palette textures) and renders.
Writes renders/tiles/*.png, renders/contact_sheet.png, renders/kit_lineup.png,
renders/import_check.json.
"""
import bpy, json, math, os
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
TILES = os.path.join(HERE, "renders", "tiles")
os.makedirs(TILES, exist_ok=True)
man = json.load(open(os.path.join(HERE, "manifest.json")))
T = 440


def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def setup_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    try:
        sc.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        sc.render.engine = "BLENDER_EEVEE"
    sc.eevee.taa_render_samples = 32
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = False
    w = bpy.data.worlds.new("sky"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*srgb("#DCE8E0"), 1); bg.inputs[1].default_value = 0.9
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2; sun.data.color = srgb("#FFF1D8"); sun.data.angle = math.radians(4)
    sun.rotation_euler = (math.radians(48), 0, math.radians(35))
    sc.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=60)
    g = bpy.context.object
    m = bpy.data.materials.new("ground"); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*srgb("#B7BA7E"), 1); b.inputs["Roughness"].default_value = 1
    g.data.materials.append(m)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam); sc.camera = cam
    sc.render.resolution_x = sc.render.resolution_y = T
    return sc, cam


def aim(cam, target, az, el, dist, lens=50):
    cam.data.lens = lens
    d = Vector((math.cos(el) * math.cos(az), math.cos(el) * math.sin(az), math.sin(el)))
    cam.location = target + d * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def render(sc, path, res=T):
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


checks = []
tiles = []
for a in man["assets"]:
    sc, cam = setup_scene()
    objs = import_glb(os.path.join(HERE, a["file"]))
    meshes = [o for o in objs if o.type == "MESH"]
    me = meshes[0].data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    imgs = [n.image for m in me.materials for n in m.node_tree.nodes if n.type == "TEX_IMAGE" and n.image]
    bb = [meshes[0].matrix_world @ Vector(c) for c in meshes[0].bound_box]
    zmin, zmax = min(v.z for v in bb), max(v.z for v in bb)
    size = max(max(v.x for v in bb) - min(v.x for v in bb), max(v.y for v in bb) - min(v.y for v in bb), zmax - zmin)
    checks.append({"id": a["id"], "imported_meshes": len(meshes), "triangles": tris,
                   "manifest_triangles": a["triangles"], "materials": [m.name for m in me.materials],
                   "embedded_images": sorted({i.name for i in imgs}), "images_packed": all(i.packed_file for i in imgs),
                   "min_z": round(zmin, 4), "ok": len(meshes) == 1 and tris == a["triangles"] and abs(zmin) < 1e-3 and len(imgs) >= 2})
    tgt = Vector((0, 0, (zmax - zmin) * 0.42))
    row = []
    # close: VR eye-level-ish, near and low, 35mm
    aim(cam, tgt, math.radians(-70), math.radians(14), size * 0.95 + 0.25, lens=35)
    p = os.path.join(TILES, f"{a['id']}_close.png"); render(sc, p); row.append(p)
    # 3/4: 45deg azimuth, 30deg elevation, framing whole footprint
    aim(cam, tgt, math.radians(-45), math.radians(30), size * 2.1 + 0.3, lens=50)
    p = os.path.join(TILES, f"{a['id']}_34.png"); render(sc, p); row.append(p)
    # distance: steep overhead at 40 px (approx. screen size of a 1m asset from ~40 m), upscaled nearest
    aim(cam, tgt, math.radians(-45), math.radians(70), size * 2.1 + 0.3, lens=50)
    p = os.path.join(TILES, f"{a['id']}_far.png"); render(sc, p, res=40); row.append(p)
    tiles.append((a["id"], row))


def load(path, res):
    img = bpy.data.images.load(path)
    w, h = img.size
    arr = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    if w != res:
        k = res // w
        arr = np.kron(arr, np.ones((k, k, 1), np.float32))
        pad = res - arr.shape[0]
        arr = np.pad(arr, ((pad // 2, pad - pad // 2), (pad // 2, pad - pad // 2), (0, 0)), constant_values=1.0)
    return arr


rows = len(tiles)
sheet = np.ones((rows * T, 3 * T, 4), np.float32)
for r, (aid, paths) in enumerate(tiles):
    for c, p in enumerate(paths):
        y0 = (rows - 1 - r) * T  # numpy row 0 is the bottom in Blender images
        sheet[y0:y0 + T, c * T:(c + 1) * T] = load(p, T)
out = bpy.data.images.new("sheet", 3 * T, rows * T)
out.pixels.foreach_set(sheet.ravel())
out.filepath_raw = os.path.join(HERE, "renders", "contact_sheet_raw.png"); out.file_format = "PNG"; out.save()

# hero lineup: every GLB together on the Orchard ground, VR eye height
sc, cam = setup_scene()
layout = {"rock_mossy_slab": (-1.2, 1.6), "rock_mossy_boulder": (0.9, 1.9), "branch_fallen_mossy": (0.0, 0.7),
          "fern_sword": (-1.9, 0.2), "fern_lady": (1.9, 0.4), "fern_bracken": (-0.7, 2.6), "grass_tuft": (1.0, -0.4),
          "flower_clump": (-0.9, -0.5), "litter_leaf_cluster": (0.1, -0.2)}
for a in man["assets"]:
    for o in import_glb(os.path.join(HERE, a["file"])):
        if o.parent is None:
            x, y = layout[a["id"]]
            o.location = (x, y, 0)
sc.render.resolution_x, sc.render.resolution_y = 1280, 720
aim(cam, Vector((0, 1.0, 0.25)), math.radians(-90), math.radians(24), 4.6, lens=30)
sc.render.filepath = os.path.join(HERE, "renders", "kit_lineup.png")
bpy.ops.render.render(write_still=True)
json.dump(checks, open(os.path.join(HERE, "renders", "import_check.json"), "w"), indent=2)
print("[sheet] checks ok:", all(c["ok"] for c in checks))
