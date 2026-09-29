"""Stonewhisper mining pick - deterministic Blender 4.5 builder.

Run:  blender.exe --background --python build_stonewhisper_pick.py
Blender axes: handle = +Z, pick axis = X, thickness = Y.  glTF export converts to
Godot axes (+Y handle, X pick axis).  Outputs go next to this script.
"""
import bpy, bmesh, math, random, os, sys, json
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
HEAD_Z = 0.62
HALF_SPAN = 0.32


# ---------------------------------------------------------------- utilities
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def make_img(name, size, fn):
    img = bpy.data.images.new(name, size, size, alpha=False)
    px = [0.0] * (size * size * 4)
    for y in range(size):
        for x in range(size):
            r, g, b = fn(x / size, y / size)
            i = (y * size + x) * 4
            px[i:i + 4] = (r, g, b, 1.0)
    img.pixels = px
    img.pack()
    return img


def mat(name, base, metal=0.0, rough=0.5, img=None, emit=None, emit_strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    if img:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.image = img
        m.node_tree.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    return m


def finish(name, bm, material, smooth=True, parent=None):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(material)
    for p in me.polygons:
        p.use_smooth = smooth
    if parent:
        ob.parent = parent
    return ob


def loft(bm, rings, cap=True, uv_scale=(1, 1)):
    """rings: list of lists of Vector (equal length). Returns nothing; adds quads + UVs."""
    uvl = bm.loops.layers.uv.verify()
    vs = [[bm.verts.new(p) for p in ring] for ring in rings]
    n, m = len(vs), len(vs[0])
    for i in range(n - 1):
        for j in range(m):
            k = (j + 1) % m
            f = bm.faces.new((vs[i][j], vs[i][k], vs[i + 1][k], vs[i + 1][j]))
            u0, u1 = i / (n - 1) * uv_scale[0], (i + 1) / (n - 1) * uv_scale[0]
            v0, v1 = j / m * uv_scale[1], (j + 1) / m * uv_scale[1]
            for lp, uv in zip(f.loops, ((u0, v0), (u0, v1), (u1, v1), (u1, v0))):
                lp[uvl].uv = uv
    if cap:
        for ring in (vs[0], vs[-1]):
            try:
                f = bm.faces.new(ring)
                for lp in f.loops:
                    lp[uvl].uv = (0.5, 0.5)
            except ValueError:
                pass


def circle(cx, cy, z, rx, ry, n=12, rot=0.0):
    return [Vector((cx + rx * math.cos(rot + 2 * math.pi * j / n),
                    cy + ry * math.sin(rot + 2 * math.pi * j / n), z)) for j in range(n)]


def ring_x(x, cz, a, b, style):
    """cross-section of the pick arm at station x (plane YZ); a=half thickness(Y), b=half height(Z)."""
    if style == "blade":
        pts = [(0, 1.0), (a * 0.85, 0.45), (a, -0.35), (0, -0.85), (-a, -0.35), (-a * 0.85, 0.45)]
        return [Vector((x, py, cz + pz * b)) for py, pz in [(p[0], p[1]) for p in pts]]


# ---------------------------------------------------------------- build
def build():
    reset()
    random.seed(7)

    # --- textures
    def steel_fn(u, v):
        n = random.random()
        streak = 0.5 + 0.5 * math.sin(v * 220 + math.sin(u * 9) * 2.0)
        s = 0.34 + 0.05 * n + 0.05 * streak
        edge = max(0, 1 - abs(v - 0.5) * 6) ** 6 if False else 0
        if random.random() < 0.004:
            s += 0.22  # scratch glint
        return (s * 0.72, s * 0.85, s * 1.15)

    def wood_fn(u, v):
        g = 0.5 + 0.5 * math.sin(v * 90 + math.sin(u * 5 + v * 20) * 1.6)
        n = random.random() * 0.06
        k = 0.55 + 0.35 * g + n
        return (0.36 * k, 0.21 * k, 0.10 * k)

    def leather_fn(u, v):
        n = random.random() * 0.08
        cr = 0.06 if (int(u * 60) % 2 == 0) else 0.0
        return (0.20 + n - cr, 0.09 + n * 0.5 - cr * 0.5, 0.05 + n * 0.3)

    steel = mat("Steel_Blued", (0.35, 0.42, 0.52), 0.85, 0.42, make_img("steel_tex", 128, steel_fn))
    wood = mat("Wood_Ash", (0.4, 0.24, 0.12), 0.0, 0.7, make_img("wood_tex", 128, wood_fn))
    leather = mat("Leather_Wrap", (0.2, 0.09, 0.05), 0.0, 0.85, make_img("leather_tex", 64, leather_fn))
    brass = mat("Brass_Trim", (0.85, 0.6, 0.2), 1.0, 0.32)
    crystal = mat("Resonance_Crystal", (0.0, 0.08, 0.35), 0.0, 0.2,
                  emit=(0.0, 0.30, 1.0), emit_strength=0.9)

    root = bpy.data.objects.new("StonewhisperPick", None)
    bpy.context.scene.collection.objects.link(root)

    # --- pick head arms (one swept loft, curved down, tapered, outward-facing points)
    bm = bmesh.new()
    rings = []
    N = 16
    for i in range(N + 1):
        t = -1 + 2 * i / N  # -1..1
        s = abs(t)
        x = t * HALF_SPAN
        cz = HEAD_Z + 0.075 * s ** 2.2 - 0.005  # ends curve up? no: droop below
        cz = HEAD_Z - 0.085 * s ** 2.0
        a = 0.005 + 0.024 * (1 - s) ** 0.85
        b = 0.004 + 0.042 * (1 - s) ** 0.95
        if s < 0.12:  # swollen eye of the head
            a *= 1.0 + 0.25 * (1 - s / 0.12)
            b *= 1.0 + 0.10 * (1 - s / 0.12)
        rings.append(ring_x(x, cz, a, b, "blade"))
    # collapse the two end rings to points
    for idx in (0, -1):
        c = sum(rings[idx], Vector()) / len(rings[idx])
        rings[idx] = [c + (p - c) * 0.05 for p in rings[idx]]
    loft(bm, rings, uv_scale=(2, 1))
    head = finish("PickHead", bm, steel, smooth=False, parent=root)

    # --- socket eye collar around shaft and top finial
    bm = bmesh.new()
    rings = [circle(0, 0, HEAD_Z - 0.075, 0.028, 0.031, 8, math.pi / 8),
             circle(0, 0, HEAD_Z - 0.052, 0.038, 0.041, 8, math.pi / 8),
             circle(0, 0, HEAD_Z + 0.035, 0.038, 0.041, 8, math.pi / 8),
             circle(0, 0, HEAD_Z + 0.060, 0.026, 0.029, 8, math.pi / 8),
             circle(0, 0, HEAD_Z + 0.085, 0.017, 0.019, 8, math.pi / 8),
             circle(0, 0, HEAD_Z + 0.098, 0.0015, 0.0015, 8, math.pi / 8)]
    loft(bm, rings)
    finish("HeadSocket", bm, steel, smooth=False, parent=root)

    # --- shaft (slight belly, oval), z=-0.03..0.62
    bm = bmesh.new()
    rings = []
    zs = [-0.03 + i * (HEAD_Z + 0.03) / 20 for i in range(21)]
    for z in zs:
        f = z / HEAD_Z
        r = 0.0185 + 0.0025 * math.sin(math.pi * min(max(f, 0), 1)) + 0.0025 * f
        rings.append(circle(0, 0, z, r * 1.08, r * 0.94, 12))
    loft(bm, rings, uv_scale=(6, 1))
    finish("Shaft", bm, wood, smooth=True, parent=root)

    # --- leather grip wrap z=0.10..0.34 (banded)
    bm = bmesh.new()
    rings = []
    for i in range(49):
        z = 0.10 + 0.24 * i / 48
        band = 0.0013 * (1 if i % 2 == 0 else 0)
        edge = min(i, 48 - i) / 3.0
        r = 0.0212 + band + 0.0006 * math.sin(i * 0.5) - 0.0015 * max(0, 1 - edge)
        rings.append(circle(0, 0, z, r * 1.08, r * 0.94, 12))
    loft(bm, rings, uv_scale=(1, 1))
    finish("GripWrap", bm, leather, smooth=True, parent=root)

    # --- brass: pommel cap, ferrules, langets (side straps), socket rims
    bm = bmesh.new()
    def band(z0, z1, rx, ry, n=12, bulge=0.0):
        zm = (z0 + z1) / 2
        loft(bm, [circle(0, 0, z0, rx * 0.95, ry * 0.95, n),
                  circle(0, 0, z0 + 0.002, rx, ry, n),
                  circle(0, 0, zm, rx + bulge, ry + bulge, n),
                  circle(0, 0, z1 - 0.002, rx, ry, n),
                  circle(0, 0, z1, rx * 0.95, ry * 0.95, n)], cap=True)
    # pommel flare
    loft(bm, [circle(0, 0, -0.045, 0.014, 0.014, 12), circle(0, 0, -0.035, 0.026, 0.025, 12),
              circle(0, 0, -0.015, 0.024, 0.023, 12), circle(0, 0, 0.0, 0.0205, 0.019, 12),
              circle(0, 0, 0.03, 0.0195, 0.0175, 12)])
    band(0.085, 0.103, 0.0235, 0.0215, bulge=0.0012)
    band(0.335, 0.353, 0.0235, 0.0215, bulge=0.0012)
    band(HEAD_Z - 0.066, HEAD_Z - 0.052, 0.0355, 0.0385, 8, bulge=0.002)
    band(HEAD_Z + 0.038, HEAD_Z + 0.050, 0.0355, 0.0385, 8, bulge=0.002)
    # langets: two straps running up the shaft under the head
    for sgn in (-1, 1):
        loft(bm, [[Vector((sgn * 0.0225 + dx, dy, z)) for dx, dy in ((-0.0018, -0.009), (0.0018, -0.009), (0.0018, 0.009), (-0.0018, 0.009))]
                  for z in (0.40, 0.42, 0.56)] +
             [[Vector((sgn * 0.0335 + dx, dy, HEAD_Z - 0.09)) for dx, dy in ((-0.0018, -0.006), (0.0018, -0.006), (0.0018, 0.006), (-0.0018, 0.006))]],
             cap=True)
    finish("BrassTrim", bm, brass, smooth=True, parent=root)

    # --- resonance crystal: faceted gem through head eye + rune studs along arms
    bm = bmesh.new()
    for sgn in (-1, 1):
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0,
                                   matrix=__import__("mathutils").Matrix.Translation((0, sgn * 0.036, HEAD_Z - 0.006)) @
                                   __import__("mathutils").Matrix.Diagonal((0.020, 0.008, 0.032, 1)))
    # rune inlay dashes down each arm (small diamonds)
    for sgn in (-1, 1):
        for k in range(4):
            s = 0.26 + k * 0.17
            x = sgn * s * HALF_SPAN
            cz = HEAD_Z - 0.085 * s ** 2 + (0.004 + 0.042 * (1 - s) ** 0.95) * 0.9
            bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0,
                                       matrix=__import__("mathutils").Matrix.Translation((x, 0, cz + 0.004)) @
                                       __import__("mathutils").Matrix.Diagonal((0.008 * (1 - 0.5 * s), 0.0045, 0.0035, 1)))
    crys = finish("ResonanceCrystal", bm, crystal, smooth=False, parent=root)

    # --- markers
    def empty(name, loc, typ="PLAIN_AXES", size=0.02):
        e = bpy.data.objects.new(name, None)
        e.empty_display_type = typ
        e.empty_display_size = size
        e.location = loc
        e.parent = root
        bpy.context.scene.collection.objects.link(e)
        return e
    tipz = HEAD_Z - 0.085
    empty("Grip", (0, 0, 0.22), "ARROWS", 0.04)
    empty("PickTipLeft", (-HALF_SPAN, 0, tipz), "SINGLE_ARROW", 0.04)
    empty("PickTipRight", (HALF_SPAN, 0, tipz), "SINGLE_ARROW", 0.04)
    empty("ChargeGlow", (0, 0, HEAD_Z), "SPHERE", 0.04)
    empty("HitCentre", (0, 0, HEAD_Z - 0.06), "CIRCLE", 0.05)
    # tip empties point outward along +/-X
    bpy.data.objects["PickTipLeft"].rotation_euler = (0, -math.pi / 2, 0)
    bpy.data.objects["PickTipRight"].rotation_euler = (0, math.pi / 2, 0)

    return root


# ---------------------------------------------------------------- stats / export
def stats(root):
    dg = bpy.context.evaluated_depsgraph_get()
    tri = 0
    per = {}
    lo = Vector((1e9,) * 3)
    hi = Vector((-1e9,) * 3)
    for ob in root.children:
        if ob.type != "MESH":
            continue
        me = ob.evaluated_get(dg).to_mesh()
        t = sum(len(p.vertices) - 2 for p in me.polygons)
        per[ob.name] = t
        tri += t
        for v in me.vertices:
            w = ob.matrix_world @ v.co
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    return tri, per, lo, hi


def export_glb(root, path):
    bpy.ops.object.select_all(action="DESELECT")
    root.select_set(True)
    for c in root.children:
        c.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_yup=True, export_apply=True, export_texcoords=True,
                              export_normals=True, export_materials="EXPORT",
                              export_cameras=False, export_lights=False)


# ---------------------------------------------------------------- previews
def setup_render(res=900):
    sc = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            sc.render.engine = eng
            break
        except TypeError:
            continue
    if sc.render.engine == "CYCLES":
        sc.cycles.samples = 24
    sc.render.resolution_x = sc.render.resolution_y = res
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Filmic" if "Filmic" in [
        i.identifier for i in sc.view_settings.bl_rna.properties["view_transform"].enum_items] else "AgX"
    w = bpy.data.worlds.new("Studio")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.13, 0.15, 0.19, 1)
    bg.inputs["Strength"].default_value = 1.0
    # preview-only lights (never exported: export uses selection of weapon only)
    def light(name, kind, loc, energy, color=(1, 1, 1), size=1.0):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.color = color
        if kind == "AREA":
            ld.size = size
        lo = bpy.data.objects.new(name, ld)
        lo.location = loc
        bpy.context.scene.collection.objects.link(lo)
        d = Vector((0, 0, 0.5)) - Vector(loc)
        lo.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    light("Key", "AREA", (0.9, -1.2, 1.3), 220, (1.0, 0.9, 0.78), 1.2)
    light("Fill", "AREA", (-1.2, -0.8, 0.6), 90, (0.6, 0.75, 1.0), 1.5)
    light("Rim", "AREA", (0.2, 1.4, 1.0), 200, (0.8, 0.9, 1.0), 1.0)
    # floor for shadow grounding
    bpy.ops.mesh.primitive_plane_add(size=4, location=(0, 0, -0.06))
    bpy.context.object.name = "PreviewFloor"
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.08, 0.08, 0.1, 1)
    bpy.context.object.data.materials.append(fm)


def shoot(name, loc, target, lens=None, ortho=None, silhouette=False):
    sc = bpy.context.scene
    cam = bpy.data.objects.get("Cam")
    if cam is None:
        cd = bpy.data.cameras.new("Cam")
        cam = bpy.data.objects.new("Cam", cd)
        sc.collection.objects.link(cam)
    sc.camera = cam
    cd = cam.data
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    else:
        cd.type = "PERSP"
        cd.lens = lens or 50
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    vl = bpy.context.view_layer
    fl = bpy.data.objects["PreviewFloor"]
    world_bg = bpy.data.worlds["Studio"].node_tree.nodes["Background"]
    if silhouette:
        blk = bpy.data.materials.get("SilBlack") or bpy.data.materials.new("SilBlack")
        blk.use_nodes = True
        blk.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0, 0, 0, 1)
        blk.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1
        for k in ("Specular IOR Level",):
            if k in blk.node_tree.nodes["Principled BSDF"].inputs:
                blk.node_tree.nodes["Principled BSDF"].inputs[k].default_value = 0
        saved = {o.name: [m for m in o.data.materials] for o in bpy.data.objects if o.type == 'MESH'}
        for o in bpy.data.objects:
            if o.type == 'MESH' and o.name != 'PreviewFloor':
                o.data.materials.clear(); o.data.materials.append(blk)
        world_bg.inputs["Color"].default_value = (0.9, 0.92, 0.95, 1)
        world_bg.inputs["Strength"].default_value = 1.6
        fl.hide_render = True
    sc.render.filepath = os.path.join(HERE, name)
    bpy.ops.render.render(write_still=True)
    if silhouette:
        for n, ms in saved.items():
            o = bpy.data.objects[n]; o.data.materials.clear()
            for m in ms: o.data.materials.append(m)
        world_bg.inputs["Color"].default_value = (0.13, 0.15, 0.19, 1)
        world_bg.inputs["Strength"].default_value = 1.0
        fl.hide_render = False


def previews():
    setup_render()
    c = (0, 0, 0.36)
    shoot("preview_01_front.png", (0, -1.5, 0.38), c, ortho=1.0)
    shoot("preview_02_three_quarter.png", (0.95, -1.0, 0.75), (0, 0, 0.42), lens=55)
    shoot("preview_03_side.png", (1.5, 0, 0.38), c, ortho=1.0)
    shoot("preview_04_head_closeup.png", (0.34, -0.42, 0.72), (0, 0, HEAD_Z - 0.03), lens=60)
    shoot("preview_05_grip_closeup.png", (0.28, -0.35, 0.30), (0, 0, 0.22), lens=60)
    shoot("preview_06_distance_silhouette.png", (0.0, -3.2, 0.4), (0, 0, 0.36), lens=50, silhouette=True)


def main():
    root = build()
    tri, per, lo, hi = stats(root)
    print("TRIS", tri, per)
    print("BOUNDS", tuple(lo), tuple(hi))
    export_glb(root, os.path.join(HERE, "stonewhisper_pick.glb"))
    if "--no-render" not in sys.argv:
        previews()
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "stonewhisper_pick.blend"))
    json.dump({"triangles": tri, "per_object": per, "bounds_min": list(lo), "bounds_max": list(hi)},
              open(os.path.join(HERE, "build_stats.json"), "w"), indent=1)


main()
