"""Deterministic geological vocabulary builder for Brann's Forge VR.

Run:  blender -b --factory-startup --python build_geology.py -- [--no-render]
Outputs (next to this file): out/geology_vocabulary.blend, out/glb/*.glb,
out/previews/*.png, out/contact_sheet.png, out/manifest.json

Conventions: Blender Z-up metres, exported +Y up. Every asset origin sits at
ground contact (local y=0) with a buried skirt (to -0.25 m or more) so it can
be dropped on slopes up to ~25 degrees without floating edges.
One vertex-coloured opaque material per asset ("geo_rock"), plus at most one
accent material (root wood / rune glow). Vertex colour alpha = wetness mask
(1 = wet-prone low/shaded band) for an optional Godot shader hook.
"""
import bpy, bmesh, math, os, sys, json, random
from mathutils import Vector, noise

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "out")
GLB = os.path.join(OUT, "glb")
PRE = os.path.join(OUT, "previews")
for d in (OUT, GLB, PRE):
    os.makedirs(d, exist_ok=True)
RENDER = "--no-render" not in sys.argv

# palette sampled by eye from orchard/brook references (warm stylised)
STONE_DRY = Vector((0.52, 0.47, 0.40))
STONE_DARK = Vector((0.30, 0.28, 0.26))
STONE_WARM = Vector((0.62, 0.50, 0.36))
STRATA_A = Vector((0.66, 0.52, 0.36))
STRATA_B = Vector((0.45, 0.36, 0.28))
SOIL = Vector((0.33, 0.22, 0.14))
MOSS = Vector((0.33, 0.47, 0.18))
MOSS_LIGHT = Vector((0.52, 0.62, 0.25))
CHIP = Vector((0.78, 0.74, 0.66))


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return a * (1 - t) + b * t


def material(name, base=None, emit=None, rough=0.85, use_vcol=True):
    m = bpy.data.materials.get(name)
    if m:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = rough
    if use_vcol:
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    elif base:
        bsdf.inputs["Base Color"].default_value = (*base, 1)
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 0.9
    return m


def fbm(p, seed, octaves=3):
    o = Vector((seed * 17.13, seed * 5.71, seed * 3.37))
    return noise.fractal(p + o, 0.5, 2.0, octaves, noise_basis="PERLIN_ORIGINAL")


def facet(p, seed, scale):
    """Cellular chip field: 0 in cell interior, ~1 near cell edges (chipped ridges)."""
    o = Vector((seed * 3.1, seed * 7.3, seed * 1.9))
    d, _ = noise.voronoi(p * scale + o, distance_metric="DISTANCE", exponent=2.5)
    return d[1] - d[0]


def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in mats:
        me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = False
    return ob


def paint(ob, fn):
    """fn(world_co, normal) -> (rgb Vector, wet float). Written per-corner."""
    me = ob.data
    attr = me.color_attributes.get("Col") or me.color_attributes.new("Col", "BYTE_COLOR", "CORNER")
    for poly in me.polygons:
        for li in poly.loop_indices:
            v = me.vertices[me.loops[li].vertex_index]
            rgb, wet = fn(v.co, poly.normal)
            rgb = rgb * 0.82  # stylised mid-value: keep stone below grass/foliage brightness
            attr.data[li].color = (rgb.x, rgb.y, rgb.z, wet)


def rock_blob(seed, size, squash, sub=3, lumps=0.35, chip=0.08, flat_top=0.0, lean=0.0):
    rnd = random.Random(seed)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    for v in bm.verts:
        n = v.co.normalized()
        d = 1 + lumps * fbm(n * 1.3, seed) + 0.12 * fbm(n * 3.1, seed + 9)
        d -= chip * facet(n, seed, 2.2) * -1  # raised facet planes
        # planar facets: snap to a few cleavage planes -> chunky stylised faces
        c = n * d
        c.x *= size[0]; c.y *= size[1]; c.z *= size[2] * squash
        if flat_top and c.z > size[2] * squash * flat_top:
            c.z = size[2] * squash * flat_top + (c.z - size[2] * squash * flat_top) * 0.25
        c.x += lean * c.z
        v.co = c
    # cleavage cuts: slice with a few random planes, keep inside -> chiselled silhouette
    for i in range(4):
        a = rnd.uniform(0, math.tau); e = rnd.uniform(-0.2, 0.9)
        nrm = Vector((math.cos(a) * math.cos(e), math.sin(a) * math.cos(e), math.sin(e)))
        off = rnd.uniform(0.72, 0.9)
        for v in bm.verts:
            dist = v.co.dot(nrm) - off * (abs(nrm.x) * size[0] + abs(nrm.y) * size[1] + abs(nrm.z) * size[2] * squash)
            if dist > 0:
                v.co -= nrm * dist * 0.85
    return bm


def ground(bm, bury=0.25):
    """Put lowest-intended contact at z=0 with a buried skirt below."""
    zs = sorted(v.co.z for v in bm.verts)
    base = zs[int(len(zs) * 0.18)]
    for v in bm.verts:
        v.co.z -= base
        if v.co.z < 0:
            v.co.z = max(v.co.z, -bury) if v.co.z > -bury else -bury
            v.co.x *= 0.96; v.co.y *= 0.96


def rock_paint(seed, top_z, moss_amt=0.55, strata=0.0, warm=0.0):
    def fn(co, n):
        h = co.z / max(top_z, 0.01)
        base = lerp(STONE_DRY, STONE_WARM, warm + 0.3 * fbm(co * 0.8, seed))
        if strata:
            band = 0.5 + 0.5 * math.sin(co.z * strata + 0.6 * fbm(co * 0.5, seed + 3) * 3)
            base = lerp(STRATA_B, STRATA_A, band)
            if band > 0.92:
                base = lerp(base, CHIP, 0.35)
        # AO-ish darkening toward ground and on downward faces
        base = lerp(STONE_DARK, base, 0.45 + 0.55 * min(1, h * 2.2 + 0.2) - 0.25 * max(0, -n.z))
        # chipped edges: steep facet ridges get pale highlight
        ch = facet(co, seed, 1.7)
        if ch < 0.05:
            base = lerp(base, CHIP, 0.45)
        # moss on up-facing surfaces, broken by noise
        m = n.z * 1.4 + 0.6 * fbm(co * 1.6, seed + 4) - (1 - moss_amt) * 1.2
        if m > 0.35:
            base = lerp(base, lerp(MOSS, MOSS_LIGHT, fbm(co * 3, seed) + 0.5), min(1, (m - 0.35) * 3))
        wet = max(0.0, min(1.0, 1.0 - h * 3.0))
        return base, wet
    return fn


def finish(ob, place):
    ob.location = place
    return ob


# ---------------------------------------------------------------- families
def make_boulder_mossy(mat):
    bm = rock_blob(11, (1.1, 0.9, 0.8), 1.0, lumps=0.28)
    ground(bm)
    ob = new_obj("geo_boulder_mossy_a", bm, [mat])
    paint(ob, rock_paint(11, 1.4, moss_amt=0.8))
    return ob


def make_boulder_split(mat):
    """Two-lobe split boulder with a frost-crack cleft: distinct silhouette."""
    bm = bmesh.new()
    for i, (sx, off, s) in enumerate(((0.8, -0.55, 23), (0.7, 0.62, 29))):
        b = rock_blob(s, (sx, 0.85, 1.0), 1.0, lumps=0.3, lean=0.18 * (1 if i else -1))
        for v in b.verts:
            v.co.x += off
        me = bpy.data.meshes.new("tmp"); b.to_mesh(me); b.free()
        bm.from_mesh(me); bpy.data.meshes.remove(me)
    ground(bm)
    ob = new_obj("geo_boulder_split_b", bm, [mat])
    paint(ob, rock_paint(23, 1.6, moss_amt=0.45, warm=0.3))
    return ob


def make_stone_flat(mat):
    """Low slab/stepping-stone: reads well overhead, good for brook edges."""
    bm = rock_blob(37, (1.3, 0.95, 0.45), 1.0, lumps=0.22, flat_top=0.55)
    ground(bm, bury=0.2)
    ob = new_obj("geo_slab_streamside_c", bm, [mat])
    paint(ob, rock_paint(37, 0.5, moss_amt=0.6))
    return ob


def outcrop(name, seed, width, height, depth, lean, mat):
    """Modular strata outcrop: tileable along X, face toward -Y, back buried into slope.
    Built as a grid sheet extruded into a thick block with ledge displacement."""
    rnd = random.Random(seed)
    nx, nz = 16, 12
    bm = bmesh.new()
    grid = {}
    layers = [rnd.uniform(0.18, 0.38) for _ in range(12)]
    cum = []; t = 0
    for l in layers:
        t += l; cum.append(t)
    def ledge(z):
        # sawtooth per stratum: each bed juts out at its base, recesses at its top
        prev = 0
        for i, c in enumerate(cum):
            if z <= c:
                f = (z - prev) / (c - prev)
                return (0.22 if i % 2 else 0.12) * (1 - f) ** 1.5 + (0.04 if i % 3 == 0 else 0)
            prev = c
        return 0
    for iz in range(nz + 1):
        z = height * iz / nz
        for ix in range(nx + 1):
            u = ix / nx
            x = (u - 0.5) * width
            taper = math.sin(math.pi * u) ** 0.5  # ends fade into terrain for modular overlap
            zz = z * (0.35 + 0.65 * taper) * (1 + 0.15 * fbm(Vector((x * 0.6, 0, 0)), seed))
            y = -depth * (0.4 + 0.6 * taper) + ledge(zz) * -1.6 + lean * zz
            y += 0.12 * fbm(Vector((x * 1.2, zz * 1.2, 0)), seed + 1)
            y += 0.06 * facet(Vector((x, zz * 2.0, 0)), seed, 1.3)
            grid[ix, iz] = bm.verts.new((x, y, zz - 0.3))
    # back verts (buried in slope)
    back = {}
    for iz in range(nz + 1):
        for ix in range(nx + 1):
            f = grid[ix, iz].co
            back[ix, iz] = bm.verts.new((f.x, 0.6 + 0.2 * iz / nz, f.z))
    for iz in range(nz):
        for ix in range(nx):
            bm.faces.new((grid[ix, iz], grid[ix + 1, iz], grid[ix + 1, iz + 1], grid[ix, iz + 1]))
    # top cap (grass/moss catches here) + ends + bottom kept closed for a clean solid
    for ix in range(nx):
        bm.faces.new((grid[ix, nz], grid[ix + 1, nz], back[ix + 1, nz], back[ix, nz]))
        bm.faces.new((back[ix, 0], back[ix + 1, 0], grid[ix + 1, 0], grid[ix, 0]))
    for ix, rev in ((0, True), (nx, False)):
        for iz in range(nz):
            q = (grid[ix, iz], grid[ix, iz + 1], back[ix, iz + 1], back[ix, iz])
            bm.faces.new(q if rev else q[::-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = new_obj(name, bm, [mat])
    top = max(v.co.z for v in ob.data.vertices)
    paint(ob, rock_paint(seed, top, moss_amt=0.7, strata=math.tau / 0.28))
    return ob


def tube(bm, pts, radii, sides=6):
    rings = []; made = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = t.orthogonal().normalized(); b = t.cross(a)
        rings.append([bm.verts.new(p + (a * math.cos(k / sides * math.tau) + b * math.sin(k / sides * math.tau)) * radii[i]) for k in range(sides)])
    for r0, r1 in zip(rings, rings[1:]):
        for k in range(sides):
            made.append(bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k])))
    made.append(bm.faces.new(rings[-1][::-1]))
    return made


def make_rupture(mat_rock, mat_wood):
    """Earth rupture: heaved soil lip ring + tilted shattered plates + torn roots."""
    rnd = random.Random(71)
    bm = bmesh.new()
    # heaved lip: ring of soil/rock plates tilted outward around a 2.4 m cleft
    plates = 9
    for i in range(plates):
        a = i / plates * math.tau + rnd.uniform(-0.15, 0.15)
        r = rnd.uniform(1.0, 1.35)
        b = rock_blob(100 + i, (rnd.uniform(0.5, 0.8), rnd.uniform(0.35, 0.5), rnd.uniform(0.35, 0.6)), 1.0,
                      sub=2, lumps=0.2, flat_top=0.5)
        tilt = rnd.uniform(0.35, 0.7)
        for v in b.verts:
            c = v.co.copy()
            # tilt outward (rotate about tangent axis)
            c = Vector((c.x, c.y * math.cos(tilt) - c.z * math.sin(tilt), c.y * math.sin(tilt) + c.z * math.cos(tilt)))
            c.rotate(__import__("mathutils").Euler((0, 0, a + math.pi / 2)))
            v.co = c + Vector((math.cos(a) * r, math.sin(a) * r, 0.25))
        me = bpy.data.meshes.new("t"); b.to_mesh(me); b.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    # central jagged shards thrust up
    for i in range(3):
        b = rock_blob(140 + i, (0.25, 0.2, 0.9 + 0.3 * i), 1.0, sub=2, lumps=0.25, lean=rnd.uniform(-0.3, 0.3))
        a = rnd.uniform(0, math.tau)
        for v in b.verts:
            v.co += Vector((math.cos(a) * 0.35 * i, math.sin(a) * 0.35 * i, 0.2))
        me = bpy.data.meshes.new("t"); b.to_mesh(me); b.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    ground(bm, bury=0.3)
    for f in bm.faces:
        f.material_index = 0
    # torn roots arcing out of the cleft
    for i in range(7):
        a = i / 7 * math.tau + rnd.uniform(-0.3, 0.3)
        L = rnd.uniform(1.6, 2.6)
        pts, rad = [], []
        for k in range(8):
            t = k / 7
            rr = 0.2 + t * L
            h = math.sin(t * math.pi) * rnd.uniform(0.6, 1.1) - 0.25 + 0.1 * fbm(Vector((t * 4, i, 0)), 71)
            aa = a + 0.4 * math.sin(t * 3 + i)
            pts.append(Vector((math.cos(aa) * rr, math.sin(aa) * rr, h)))
            rad.append(0.2 * (1 - t) ** 0.8 + 0.03)
        for f in tube(bm, pts, rad):
            f.material_index = 1
    ob = new_obj("geo_earth_rupture_roots", bm, [mat_rock, mat_wood])
    fn = rock_paint(71, 1.8, moss_amt=0.35, warm=0.2)
    def rupt(co, n):
        rgb, wet = fn(co, n)
        # fresh torn soil on under-sides and inner faces
        inner = max(0, -(Vector((co.x, co.y, 0)).normalized().dot(n)))
        rgb = lerp(rgb, SOIL, inner * 0.8 + max(0, -n.z) * 0.6)
        return rgb, wet
    paint(ob, rupt)
    return ob


def make_spire(mat_rock, mat_rune):
    """Spell-risen spire: clustered hexagonal basalt-like columns with glowing rune seams.
    Origin at ground; animate by translating from y=-height to 0 (buried skirt hides seam)."""
    rnd = random.Random(91)
    bm = bmesh.new()
    rune_faces = []
    cols = [(0, 0, 3.4, 0.45)] + [(math.cos(a) * 0.62, math.sin(a) * 0.62, rnd.uniform(1.2, 2.5), rnd.uniform(0.26, 0.36))
                                  for a in [i / 6 * math.tau + rnd.uniform(-0.2, 0.2) for i in range(6)]]
    for ci, (cx, cy, h, r) in enumerate(cols):
        sides = 6
        rot = rnd.uniform(0, 1)
        lean = Vector((cx, cy, 0)) * 0.12
        ringsz = [-0.6, h * 0.3, h * 0.55, h * 0.8, h]
        rings = []
        for zi, z in enumerate(ringsz):
            rr = r * (1 - 0.18 * z / h) * rnd.uniform(0.95, 1.05)
            ring = []
            for k in range(sides):
                a = (k + rot) / sides * math.tau
                ring.append(bm.verts.new((cx + math.cos(a) * rr + lean.x * z, cy + math.sin(a) * rr + lean.y * z, z)))
            rings.append(ring)
        for zi, (r0, r1) in enumerate(zip(rings, rings[1:])):
            for k in range(sides):
                f = bm.faces.new((r0[k], r0[(k + 1) % sides], r1[(k + 1) % sides], r1[k]))
                if zi == 2 and k % 2 == ci % 2:
                    rune_faces.append(f)
        # chipped slanted cap: tilt top and add apex point
        top = rings[-1]
        apex = bm.verts.new(sum((v.co for v in top), Vector()) / sides + Vector((rnd.uniform(-.1, .1), rnd.uniform(-.1, .1), r * 0.9)))
        for k in range(sides):
            bm.faces.new((top[k], top[(k + 1) % sides], apex))
    # inset rune seams so glow reads as carved, not pasted
    res = bmesh.ops.inset_individual(bm, faces=rune_faces, thickness=0.05, depth=-0.03)
    for f in rune_faces:
        f.material_index = 1
    ob = new_obj("geo_spell_spire", bm, [mat_rock, mat_rune])
    fn = rock_paint(91, 3.8, moss_amt=0.15)
    def sp(co, n):
        rgb, wet = fn(co, n)
        return lerp(rgb, STONE_DARK * 0.9, 0.35), wet
    paint(ob, sp)
    return ob


# ---------------------------------------------------------------- pipeline
def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export(ob):
    bpy.ops.object.select_all(action="DESELECT")
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    old = ob.location.copy(); ob.location = (0, 0, 0)
    path = os.path.join(GLB, ob.name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, use_selection=True, export_format="GLB",
                              export_yup=True, export_apply=True, export_vertex_color="ACTIVE",
                              export_all_vertex_colors=False)
    ob.location = old
    return path


def bounds(ob):
    xs = [v.co for v in ob.data.vertices]
    mn = [min(c[i] for c in xs) for i in range(3)]
    mx = [max(c[i] for c in xs) for i in range(3)]
    # report in Godot Y-up: (x, z, -y)
    return {"min": [round(mn[0], 3), round(mn[2], 3), round(-mx[1], 3)],
            "max": [round(mx[0], 3), round(mx[2], 3), round(-mn[1], 3)]}


def preview(obs):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x = sc.render.resolution_y = 512
    sc.view_settings.view_transform = "Standard"
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.62, 0.7, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.5
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 2.2; sun.rotation_euler = (0.8, 0.2, 0.9); sc.collection.objects.link(sun)
    bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, -0.02))
    gp = bpy.context.object; gp.name = "preview_ground"
    gm = material("preview_grass", base=(0.30, 0.42, 0.18), use_vcol=False); gp.data.materials.append(gm)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam")); sc.collection.objects.link(cam); sc.camera = cam
    files = []
    for ob in obs:
        others = [o for o in obs if o is not ob]
        for o in others: o.hide_render = True
        c = ob.location + Vector((0, 0, (ob.dimensions.z) * 0.4))
        R = max(ob.dimensions) * 1.4 + 1.0
        for tag, off in (("close", Vector((0.2, -1, 0.05))), ("threequarter", Vector((0.8, -1, 0.9)))):
            cam.location = c + off.normalized() * (R * (0.8 if tag == "close" else 1.2))
            cam.rotation_euler = (c - cam.location).to_track_quat("-Z", "Y").to_euler()
            p = os.path.join(PRE, f"{ob.name}_{tag}.png")
            sc.render.filepath = p
            bpy.ops.render.render(write_still=True)
            files.append(p)
        for o in others: o.hide_render = False
    # contact sheet (numpy-free pixel copy)
    cols, n = 4, len(files); rows = (n + cols - 1) // cols
    W = 256
    sheet = bpy.data.images.new("sheet", W * cols, W * rows)
    px = [0.1] * (W * cols * W * rows * 4)
    for i, f in enumerate(files):
        im = bpy.data.images.load(f); im.scale(W, W); src = list(im.pixels)
        cx, cy = i % cols, rows - 1 - i // cols
        for y in range(W):
            row = (cy * W + y) * W * cols + cx * W
            px[row * 4:(row + W) * 4] = src[y * W * 4:(y + 1) * W * 4]
    sheet.pixels = px
    sheet.filepath_raw = os.path.join(OUT, "contact_sheet.png"); sheet.file_format = "PNG"; sheet.save()
    gp.hide_render = True
    return files


def main():
    clear()
    rock = material("geo_rock")
    wood = material("geo_root_wood", base=(0.36, 0.24, 0.15), use_vcol=False, rough=0.9)
    rune = material("geo_rune_glow", base=(0.2, 0.5, 0.7), emit=(0.35, 0.8, 1.0), use_vcol=False, rough=0.4)
    obs = [make_boulder_mossy(rock), make_boulder_split(rock), make_stone_flat(rock),
           outcrop("geo_outcrop_bank_straight", 51, 4.0, 2.2, 0.9, 0.08, rock),
           outcrop("geo_outcrop_ridge_tall", 57, 3.0, 3.4, 1.1, 0.18, rock),
           make_rupture(rock, wood), make_spire(rock, rune)]
    manifest = {"generator": "build_geology.py", "units": "metres", "up": "+Y (glTF)", "assets": []}
    x = 0
    for ob in obs:
        path = export(ob)
        manifest["assets"].append({
            "name": ob.name, "glb": os.path.relpath(path, ROOT).replace("\\", "/"),
            "triangles": tri_count(ob), "vertices": len(ob.data.vertices),
            "materials": [m.name for m in ob.data.materials], "material_count": len(ob.data.materials),
            "bounds": bounds(ob), "bytes": os.path.getsize(path)})
        ob.location = (x, 0, 0); x += max(ob.dimensions.x, 3) + 2.5
    if RENDER:
        manifest["previews"] = [os.path.relpath(f, ROOT).replace("\\", "/") for f in preview(obs)]
    with open(os.path.join(OUT, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "geology_vocabulary.blend"))
    print("GEOLOGY_OK", len(obs))


main()
