"""Import the EXPORTED GLBs into a clean scene, check them, and render previews.

blender --background --factory-startup --python render_preview.py -- --out ABS_OUTPUT_DIR
Gray proxies stand in for runtime entities (Brann, anvil, hearth, tables, gate leaf,
floor slab); they are review-only and never exported.
"""
import bpy, json, math, os, struct, sys
from mathutils import Vector

ARGV = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(ARGV[ARGV.index("--out") + 1])
PREV = os.path.join(OUT, "previews"); os.makedirs(PREV, exist_ok=True)
G = lambda x, y, z: Vector((x, -z, y))  # game -> blender

def glb_info(path):
    with open(path, "rb") as fh:
        data = fh.read()
    n = struct.unpack_from("<I", data, 12)[0]
    js = json.loads(data[20:20 + n])
    tris = 0
    for mesh in js["meshes"]:
        for p in mesh["primitives"]:
            acc = js["accessors"][p["indices"]]
            tris += acc["count"] // 3
    return {"bytes": len(data), "triangles": tris, "meshes": len(js["meshes"]), "nodes": [nd.get("name") for nd in js["nodes"]],
            "materials": [m["name"] for m in js.get("materials", [])], "images": len(js.get("images", [])),
            "external_uris": [i["uri"] for i in js.get("images", []) if "uri" in i] + [b["uri"] for b in js.get("buffers", []) if "uri" in b]}

report = {"glb": {}}
for f in ["forge_shelter.glb", "forge_detail_kit.glb"] + ["kit_modules/" + m for m in sorted(os.listdir(os.path.join(OUT, "kit_modules")))]:
    report["glb"][f] = glb_info(os.path.join(OUT, f))

for ob in list(bpy.data.objects): bpy.data.objects.remove(ob)
for f in ("forge_shelter.glb", "forge_detail_kit.glb"):
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f))
art = [o for o in bpy.data.objects if o.type == "MESH"]

def flat(name, rgb):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]; b.inputs["Base Color"].default_value = (*rgb, 1); b.inputs["Roughness"].default_value = 0.9
    return m

def proxy(name, c, s, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=G(*c))
    o = bpy.context.object; o.name = "REF_" + name; o.scale = (s[0], s[2], s[1]); o.data.materials.append(mat)
    return o

gray = flat("ref_gray", (0.45, 0.47, 0.5)); teal = flat("ref_teal", (0.15, 0.45, 0.45)); grass = flat("ref_grass", (0.28, 0.42, 0.18))
slab = flat("ref_slab", (0.55, 0.5, 0.42)); board = flat("ref_board", (0.2, 0.3, 0.55))
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, -0.02)); bpy.context.object.data.materials.append(grass)
proxy("floor", (0, -0.01, -3.8), (17, 0.08, 7.8), slab)
proxy("path", (0, 0.005, 4.0), (2.2, 0.02, 8), slab)
bpy.ops.mesh.primitive_cylinder_add(radius=0.42, depth=1.95, location=G(0, 0.98, -4)); bpy.context.object.data.materials.append(teal); bpy.context.object.name = "REF_Brann"
proxy("anvil", (-0.35, 0.6, -2.9), (1.25, 1.2, 0.8), gray)
proxy("hearth", (-3.1, 1.2, -4.8), (2.0, 2.2, 1.25), gray)
proxy("hearth_hood", (-3.1, 2.6, -4.9), (1.15, 1.3, 0.8), gray)
for x in (-5.4, 5.4):
    proxy(f"table_{x}", (x, 0.5, -4.7), (1.6, 1.0, 0.9), gray)
    proxy(f"board_{x}", (x, 1.55, -4.95), (1.4, 0.9, 0.06), board)
proxy("gate_leaf", (0, 1.4, -7.6), (2.9, 2.8, 0.16), flat("ref_gate", (0.35, 0.25, 0.17)))

# ---- sightline + clearance checks against the imported art only
dg = bpy.context.evaluated_depsgraph_get()
ref_names = {o.name for o in bpy.data.objects if o.name.startswith("REF_") or o.name.startswith("Plane")}
def blocked(a, b):
    a = G(*a); b = G(*b); d = b - a; dist = d.length; d.normalize(); o = a.copy()
    for _ in range(20):
        hit, loc, n, i, ob, m = bpy.context.scene.ray_cast(dg, o, d, distance=dist - (o - a).length)
        if not hit: return None
        if ob.name not in ref_names: return ob.name
        o = loc + d * 1e-3
    return None
eye = (0, 1.6, 8)
targets = {"brann_head": (0, 1.55, -4), "brann_chest": (0, 1.0, -4), "board_west": (-5.4, 1.55, -4.9), "board_east": (5.4, 1.55, -4.9),
           "table_west": (-5.4, 1.0, -4.7), "table_east": (5.4, 1.0, -4.7), "gate_centre": (0, 1.4, -7.5)}
report["sightlines_from_approach"] = {k: blocked(eye, v) for k, v in targets.items()}
# head clearance: cast upwards on a grid under the roof (inside posts)
low = 99.0; low_at = None
for ix in range(-16, 17):
    for iz in range(-14, 0):
        x = ix * 0.5; z = -0.5 + iz * 0.5
        if abs(x) > 7.6 or z < -7.0: continue
        hit, loc, *_ , ob, m = bpy.context.scene.ray_cast(dg, G(x, 0.05, z), Vector((0, 0, 1)), distance=10)
        if hit and ob.name not in ref_names and loc.z < low: low, low_at = loc.z, (x, z, ob.name)
report["lowest_overhead_hit_inside"] = {"y": round(low, 3), "at_xz_object": low_at}
# gate aperture: horizontal rays across at several heights
aperture = {}
for y in (0.5, 1.5, 2.5, 2.9):
    gl = bpy.data.objects["REF_gate_leaf"]; gl.hide_viewport = True; dg.update()
    hit_l = bpy.context.scene.ray_cast(dg, G(0, y, -7.55), Vector((-1, 0, 0)), distance=5)
    hit_r = bpy.context.scene.ray_cast(dg, G(0, y, -7.55), Vector((1, 0, 0)), distance=5)
    gl.hide_viewport = False
    aperture[y] = round((hit_r[1].x if hit_r[0] else 5) - (hit_l[1].x if hit_l[0] else -5), 3)
report["gate_clear_width_by_height"] = aperture
mins = Vector((1e9,) * 3); maxs = Vector((-1e9,) * 3)
for o in art:
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c); mins = Vector(map(min, mins, w)); maxs = Vector(map(max, maxs, w))
report["scene_bounds_game"] = {"min": [round(mins.x, 2), round(mins.z, 2), round(-maxs.y, 2)], "max": [round(maxs.x, 2), round(maxs.z, 2), round(-mins.y, 2)]}
with open(os.path.join(OUT, "inspection.json"), "w") as fh: json.dump(report, fh, indent=2)
print("INSPECT", json.dumps({k: report[k] for k in ("sightlines_from_approach", "lowest_overhead_hit_inside", "gate_clear_width_by_height", "scene_bounds_game")}))

# ---- lights, world, cameras
sc = bpy.context.scene
for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
    try: sc.render.engine = eng; break
    except TypeError: pass
sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
sc.view_settings.view_transform = "AgX"
sc.world = bpy.data.worlds.new("sky"); sc.world.use_nodes = True
sc.world.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.68, 0.85, 1)
sc.world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
bpy.ops.object.light_add(type="SUN", rotation=(math.radians(50), math.radians(18), math.radians(-30)))
bpy.context.object.data.energy = 3.2; bpy.context.object.data.angle = math.radians(3)
bpy.ops.object.light_add(type="POINT", location=G(-3.1, 1.6, -3.9)); bpy.context.object.data.energy = 500; bpy.context.object.data.color = (1, 0.55, 0.25)
try: sc.eevee.use_shadows = True
except AttributeError: pass

views = {
    "front": ((0, 4.0, 21), (0, 3.4, -4), 45),
    "three_quarter": ((15.5, 6.5, 13), (0, 3.2, -4), 45),
    "side": ((24, 4.0, -3.9), (0, 3.6, -3.9), 40),
    "eye_approach_z8": ((0, 1.6, 8), (0, 1.9, -4), 70),
    "eye_inside_looking_hearth": ((3.0, 1.6, 1.0), (-3.5, 3.0, -6), 75),
    "eye_rear_gate": ((1.5, 1.6, -1.5), (-0.5, 2.6, -7.6), 75),
    "rear_exterior": ((-9, 5, -20), (0, 4, -4), 45),
}
for name, (pos, tgt, fov) in views.items():
    cam = bpy.data.objects.new("CAM_" + name, bpy.data.cameras.new(name)); sc.collection.objects.link(cam)
    cam.location = G(*pos); cam.data.angle = math.radians(fov); cam.data.clip_end = 300
    cam.rotation_euler = (G(*tgt) - G(*pos)).to_track_quat("-Z", "Y").to_euler()
    sc.camera = cam; sc.render.filepath = os.path.join(PREV, name + ".png")
    bpy.ops.render.render(write_still=True)
print("RENDER_OK")
