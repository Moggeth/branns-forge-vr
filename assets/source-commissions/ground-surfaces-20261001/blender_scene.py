"""Blender 4.5 assembly: imports the GLB props, wires the six tile PBR materials (source nodes), saves the .blend,
renders the contact sheet + two low-eye-height showcases.  Run via build.py or:
  blender --background --python blender_scene.py -- <out folder>"""
import bpy, sys, os, json, math, random
from mathutils import Vector, Euler

OUT = os.path.abspath(sys.argv[sys.argv.index("--") + 1])
MAT = os.path.join(OUT, "materials")
PROPS = os.path.join(OUT, "props")
man = json.load(open(os.path.join(OUT, "manifest.json")))
ids = [p["id"] for p in man["props"]]
FAST = os.environ.get("KIT_FAST") == "1"

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.render.engine = "CYCLES"
sc.cycles.device = "CPU"
sc.cycles.use_denoising = True
sc.view_settings.view_transform = "Standard"
sc.view_settings.exposure = -0.5
sc.view_settings.gamma = 1.0


def load_img(name, cs):
    im = bpy.data.images.load(os.path.join(MAT, name), check_existing=True)
    im.colorspace_settings.name = cs
    im.pack()
    return im


def tile_material(fam, scale):
    m = bpy.data.materials.new("tile_" + fam)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs["UV"], mp.inputs["Vector"])
    def tex(name, cs, loc):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = load_img(f"{fam}_{name}.png", cs)
        t.interpolation = "Cubic"
        t.location = loc
        nt.links.new(mp.outputs["Vector"], t.inputs["Vector"])
        return t
    a, n, o = tex("albedo", "sRGB", (-400, 200)), tex("normal", "Non-Color", (-400, -100)), tex("orm", "Non-Color", (-400, -400))
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(n.outputs["Color"], nm.inputs["Color"])
    sp = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(o.outputs["Color"], sp.inputs["Color"])
    ao = nt.nodes.new("ShaderNodeMix")
    ao.data_type = "RGBA"; ao.blend_type = "MULTIPLY"; ao.inputs["Factor"].default_value = 1.0
    nt.links.new(a.outputs["Color"], ao.inputs["A"])
    nt.links.new(sp.outputs["Red"], ao.inputs["B"])
    nt.links.new(ao.outputs["Result"], bsdf.inputs["Base Color"])
    nt.links.new(sp.outputs["Green"], bsdf.inputs["Roughness"])
    nt.links.new(sp.outputs["Blue"], bsdf.inputs["Metallic"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return m


tiles = {f: tile_material(f, 1.0) for f in ("meadow", "loam", "stone", "sand", "snow", "ash")}

# ---- import props
proto = {}
coll = bpy.data.collections.new("props")
sc.collection.children.link(coll)
for pid in ids:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(PROPS, pid + ".glb"))
    new = [o for o in bpy.data.objects if o not in before]
    meshes = [o for o in new if o.type == "MESH"]
    for o in new:
        for c in o.users_collection:
            c.objects.unlink(o)
    root = meshes[0]
    root.parent = None
    root.matrix_world = root.matrix_world  # keep
    root.name = pid
    coll.objects.link(root)
    for o in new:
        if o is not root and o.type != "MESH":
            bpy.data.objects.remove(o)
    proto[pid] = root
# unify prop material (all share the same GLB atlas)
first_mat = proto[ids[0]].data.materials[0]
for pid in ids:
    proto[pid].data.materials[0] = first_mat
    proto[pid].hide_render = True
    proto[pid].hide_viewport = True
first_mat.name = "ground_kit_atlas"
for im in first_mat.node_tree.nodes:
    if im.type == "TEX_IMAGE":
        im.interpolation = "Cubic"; im.extension = "EXTEND"


def spawn(pid, loc, yaw=0.0, s=1.0, tilt=(0, 0)):
    o = proto[pid].copy()
    o.data = proto[pid].data
    o.hide_render = False; o.hide_viewport = False
    o.rotation_euler = Euler((tilt[0], tilt[1], yaw), "XYZ")
    o.scale = (s, s, s)
    o.location = loc
    sc.collection.objects.link(o)
    return o


def ground(fam, size, scale, loc=(0, 0, 0)):
    bpy.ops.mesh.primitive_plane_add(size=size, location=loc)
    g = bpy.context.active_object
    g.name = "ground_" + fam
    g.data.materials.append(tiles[fam])
    uv = g.data.uv_layers.active.data
    # tile size: 1.5 m per repeat
    rep = size / 1.5
    for l in g.data.loops:
        uv[l.index].uv = (uv[l.index].uv[0] * rep, uv[l.index].uv[1] * rep)
    return g


def world(sun_elev=24, sun_rot=40, strength=3.6, sky=1.0):
    w = bpy.data.worlds.new("sky")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    ot = nt.nodes.new("ShaderNodeOutputWorld")
    sk = nt.nodes.new("ShaderNodeTexSky")
    sk.sky_type = "NISHITA"
    sk.sun_elevation = math.radians(sun_elev)
    sk.sun_rotation = math.radians(sun_rot)
    sk.air_density = 1.0; sk.dust_density = 0.5
    sk.sun_size = math.radians(1.5)
    sk.sun_intensity = 1.0
    nt.links.new(sk.outputs["Color"], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = sky
    nt.links.new(bg.outputs["Background"], ot.inputs["Surface"])


def camera(loc, look, lens=32, fstop=None):
    cam = bpy.data.cameras.new("cam")
    cam.lens = lens
    cam.sensor_width = 36
    if fstop:
        cam.dof.use_dof = True
        cam.dof.aperture_fstop = fstop
        cam.dof.focus_distance = (Vector(look) - Vector(loc)).length
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    co.location = loc
    d = Vector(look) - Vector(loc)
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    return co


def reset_scene():
    keep = set(proto.values())
    for o in list(sc.objects):
        if o not in keep:
            bpy.data.objects.remove(o, do_unlink=True)
    for l in list(bpy.data.lights):
        bpy.data.lights.remove(l)


def render(path, w, h, samples):
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.resolution_percentage = 100
    sc.cycles.samples = samples
    sc.render.filepath = path
    sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------- scene A: orchard meadow (crouch height)
def scene_meadow():
    random.seed(4)
    world(sun_elev=17, sun_rot=215, sky=0.5)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.4; sun.angle = math.radians(1.6); sun.color = (1.0, 0.86, 0.68)
    so = bpy.data.objects.new("sun", sun); sc.collection.objects.link(so)
    so.rotation_euler = Euler((math.radians(70), 0, math.radians(35)), "XYZ")
    ground("meadow", 30, 1.0, (0, 5, 0))
    # purposeful clusters: a mossy stone with grasses and flowers, a pebble path, tufts
    spawn("mossy_rock", (-0.9, 3.6, 0), 0.4, 1.0)
    for i in range(9):
        a = random.random() * 6.28
        spawn("grass_tuft", (-0.9 + math.cos(a) * random.uniform(0.35, 0.8), 3.6 + math.sin(a) * random.uniform(0.35, 0.8), 0), random.random() * 6.28, random.uniform(0.9, 1.4))
    for i in range(5):
        a = random.random() * 6.28
        spawn("meadow_flowers", (-0.9 + math.cos(a) * random.uniform(0.5, 1.0), 3.6 + math.sin(a) * random.uniform(0.5, 1.0), 0), random.random() * 6.28, random.uniform(0.9, 1.3))
    # pebble path curving through the foreground
    for i in range(9):
        t = i / 8
        x = -0.25 + 1.3 * t + 0.25 * math.sin(t * 5)
        y = 0.9 + 4.5 * t
        spawn("pebble_scatter" if i % 2 == 0 else "river_stones", (x, y, 0), random.random() * 6.28, random.uniform(0.8, 1.3))
    for i in range(24):
        x, y = random.uniform(-3, 3.5), random.uniform(0.9, 8)
        pid = random.choices(["grass_tuft", "seedhead_grass", "meadow_flowers", "broadleaf_plant"], [4, 3, 2, 1])[0]
        spawn(pid, (x, y, 0), random.random() * 6.28, random.uniform(0.85, 1.4))
    # fallen branch and acorns in the mid-ground; leaves and a twig near camera
    spawn("fallen_branch", (1.2, 2.6, 0), 0.8, 1.0)
    spawn("acorn_pair", (0.35, 1.6, 0), 0.4, 1.6)
    spawn("leaf_litter", (-0.55, 1.5, 0), 1.0, 1.0)
    spawn("twig_fork", (0.55, 2.3, 0), 2.4, 1.3)
    spawn("sandstone_chip", (1.6, 4.6, 0), 0.7, 1.0)
    spawn("seedhead_grass", (1.6, 1.4, 0), 0.7, 1.3)
    spawn("meadow_flowers", (1.15, 1.25, 0), 0.9, 1.2)
    spawn("grass_tuft", (-1.3, 1.25, 0), 0.9, 1.2)
    camera((0.2, -0.6, 0.55), (0.0, 3.4, 0.10), lens=30, fstop=5.6)


def scene_wood():
    random.seed(9)
    world(sun_elev=20, sun_rot=150, sky=0.45)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 2.8; sun.angle = math.radians(2.5); sun.color = (1.0, 0.88, 0.72)
    so = bpy.data.objects.new("sun", sun); sc.collection.objects.link(so)
    so.rotation_euler = Euler((math.radians(72), 0, math.radians(-140)), "XYZ")
    ground("loam", 30, 1.0, (0, 5, 0))
    spawn("root_tangle", (-0.35, 2.7, 0), 0.7, 1.1)
    spawn("mossy_rock", (1.4, 3.6, 0), 2.3, 1.15)
    for i in range(7):
        a = random.random() * 6.28
        spawn("fern_delicate", (-0.35 + math.cos(a) * random.uniform(0.5, 1.4), 2.7 + math.sin(a) * random.uniform(0.5, 1.4), 0), random.random() * 6.28, random.uniform(0.9, 1.5))
    for x, y in [(0.75, 1.6), (0.3, 2.3), (-1.2, 1.5), (0.1, 3.9), (1.1, 2.2)]:
        spawn("leaf_litter", (x, y, 0), random.random() * 6.28, random.uniform(1.0, 1.5))
    for x, y in [(-0.9, 1.4), (-0.5, 3.6)]:
        spawn("mushroom_cluster", (x, y, 0), random.random() * 6.28, 1.5)
    spawn("pinecone", (0.55, 1.35, 0), 0.9, 1.5)
    spawn("pinecone", (0.32, 1.55, 0), 2.1, 1.3)
    spawn("acorn_pair", (-0.15, 1.25, 0), 2.0, 1.7)
    spawn("fallen_branch", (0.6, 3.0, 0), -0.4, 1.0)
    spawn("bark_shards", (-1.3, 2.3, 0), 0.5, 1.0)
    spawn("twig_fork", (1.0, 1.1, 0), 1.0, 1.4)
    spawn("river_stones", (-0.3, 4.3, 0), 0.3, 1.2)
    spawn("broadleaf_plant", (1.9, 2.3, 0), 0.3, 1.1)
    for i in range(14):
        spawn(random.choice(["fern_delicate", "grass_tuft", "leaf_litter", "twig_fork", "pinecone"]), (random.uniform(-3, 3), random.uniform(1.0, 8), 0), random.random() * 6.28, random.uniform(0.9, 1.4))
    camera((0.1, -0.5, 0.5), (0.0, 3.0, 0.12), lens=30, fstop=5.6)


# ---------------------------------------------------------------- contact sheet
def render_thumbs(size=384, samples=40):
    thumbs = {}
    d = os.path.join(OUT, "_thumbs"); os.makedirs(d, exist_ok=True)
    world(sun_elev=32, sun_rot=210, sky=0.55)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0; sun.angle = math.radians(3)
    so = bpy.data.objects.new("sun", sun); sc.collection.objects.link(so)
    so.rotation_euler = Euler((math.radians(52), 0, math.radians(35)), "XYZ")
    fams = {"stone": "stone", "wood": "loam", "litter": "loam", "grass": "meadow", "fern": "loam", "debris": "ash"}
    kinds = {p["id"]: p["kind"] for p in man["props"]}
    for pid in ids:
        g = ground(fams[kinds[pid]], 4, 1.0, (0, 0, 0))
        o = spawn(pid, (0, 0, 0))
        dims = o.dimensions
        r = max(dims.x, dims.y, dims.z * 1.2, 0.12)
        cam = camera((r * 0.9, -r * 1.55, r * 1.05), (0, 0, max(dims.z * 0.32, 0.01)), lens=50)
        render(os.path.join(d, pid + ".png"), size, size, samples)
        bpy.data.objects.remove(o, do_unlink=True); bpy.data.objects.remove(g, do_unlink=True)
        bpy.data.objects.remove(cam, do_unlink=True)
        thumbs[pid] = os.path.join(d, pid + ".png")
    return thumbs


if __name__ == "__main__":
    which = os.environ.get("KIT_STEPS", "blend,thumbs,meadow,wood").split(",")
    # save the .blend first (props + tile material nodes + a tile swatch plane row) so source always exists
    if "blend" in which:
        for i, (f, m) in enumerate(tiles.items()):
            bpy.ops.mesh.primitive_plane_add(size=1.0, location=(i * 1.2, -3.0, 0))
            p = bpy.context.active_object; p.name = "swatch_" + f; p.data.materials.append(m)
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "ground_surface_kit.blend"))
        for o in [o for o in sc.objects if o.name.startswith("swatch_")]:
            bpy.data.objects.remove(o, do_unlink=True)
    if "thumbs" in which:
        render_thumbs(384, 24 if FAST else 40)
        reset_scene()
    if "meadow" in which:
        scene_meadow()
        render(os.path.join(OUT, "showcase_orchard_meadow.png"), 960 if FAST else 1600, 540 if FAST else 900, 32 if FAST else 96)
        reset_scene()
    if "wood" in which:
        scene_wood()
        render(os.path.join(OUT, "showcase_damp_woodland.png"), 960 if FAST else 1600, 540 if FAST else 900, 32 if FAST else 96)
