"""Deterministic Blender 4.5 builder for the Orchard spell VFX kit.

Run:  blender --background --factory-startup --python build_spell_kit.py -- --out ABS_DIR
Emits ABS_DIR/spell_kit.glb and ABS_DIR/spell_kit.blend (editable source).

Every piece is a small, flat-shaded, vertex-coloured mesh. Colour lives in
COLOR_0 so the Godot presenter can share ONE material across the whole kit and
tint per instance (MultiMesh INSTANCE_CUSTOM / color). Pieces are authored at
real-world metres with their pivot where the presenter anchors them:
  lip_*    pivot at hinge on the inner edge, slab extends +X (away from tear), +Z along path
  chunk_*  / clod_* / pebble   pivot at centroid
  root_seg pivot at base, grows along +Z (presenter scales Z for reach)
  sapling  pivot at ground, grows +Y; leaf_puff pivot at centre
"""
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath("kit_out")
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
rng = random.Random(20260929)

GRASS = (0.30, 0.52, 0.16)
GRASS_DRY = (0.46, 0.55, 0.20)
TOPSOIL = (0.20, 0.12, 0.07)
SUBSOIL = (0.42, 0.25, 0.13)
CLAY = (0.55, 0.36, 0.20)
ROCK = (0.50, 0.48, 0.44)
ROCK_DARK = (0.33, 0.31, 0.29)
ROOT = (0.36, 0.22, 0.12)
BARK = (0.33, 0.21, 0.12)
LEAF = (0.34, 0.60, 0.18)


def mix(a, b, t):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def jitter(c, amt=0.06):
    k = 1.0 + rng.uniform(-amt, amt)
    return tuple(min(1.0, max(0.0, v * k)) for v in c)


def finish(bm, name, colour_fn):
    # Pieces are authored in Godot axes (Y up, +Z along path). Map to Blender Z-up
    # so the glTF Y-up export lands back on the authored axes: (x, y, z) -> (x, -z, y).
    # Colour first (colour_fn reads Godot-axis normals), then remap.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    layer = bm.loops.layers.color.new("Col")
    for f in bm.faces:
        c = colour_fn(f)
        c = jitter(c, 0.08)
        for loop in f.loops:
            loop[layer] = (c[0], c[1], c[2], 1.0)
        f.smooth = False
    for v in bm.verts:
        x, y, z = v.co
        v.co = Vector((x, -z, y))
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    mat = bpy.data.materials.get("KitVertexColour")
    if mat is None:
        mat = bpy.data.materials.new("KitVertexColour")
        mat.use_nodes = True
        nt = mat.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = 0.92
    me.materials.append(mat)
    return ob


def strata(z, top, bottom):
    """Layered earth colour by relative depth 0 (top) .. 1 (bottom)."""
    t = (top - z) / max(top - bottom, 1e-4)
    if t < 0.12:
        return GRASS
    if t < 0.40:
        return TOPSOIL
    if t < 0.72:
        return mix(SUBSOIL, CLAY, (t - 0.4) / 0.32)
    return ROCK_DARK


def lip(name, length, width, thick, seed):
    """Tilted fracture slab: grass skin, torn earth layers, jagged tear edge on -X."""
    bm = bmesh.new()
    nx, nz = 4, 6
    grid = {}
    for iz in range(nz + 1):
        for ix in range(nx + 1):
            u, v = ix / nx, iz / nz
            x = u * width
            z = (v - 0.5) * length
            # tear edge (u=0) is jagged, outer edge tapers into ground
            if ix == 0:
                x += noise.noise(Vector((seed, v * 5.0, 0.0))) * 0.18 + rng.uniform(-0.06, 0.06)
            y_top = thick * (1.0 - u * 0.85) + noise.noise(Vector((u * 3, v * 3, seed))) * 0.04
            grid[(ix, iz, 1)] = bm.verts.new((x, y_top, z))
            grid[(ix, iz, 0)] = bm.verts.new((x + (0.08 if ix == 0 else 0.0), -thick * (1.0 - u) * 1.4 - 0.05, z))
    for iz in range(nz):
        for ix in range(nx):
            bm.faces.new([grid[(ix, iz, 1)], grid[(ix + 1, iz, 1)], grid[(ix + 1, iz + 1, 1)], grid[(ix, iz + 1, 1)]])
            bm.faces.new([grid[(ix, iz + 1, 0)], grid[(ix + 1, iz + 1, 0)], grid[(ix + 1, iz, 0)], grid[(ix, iz, 0)]])
    # torn face (-X side) and end caps
    for iz in range(nz):
        bm.faces.new([grid[(0, iz, 0)], grid[(0, iz, 1)], grid[(0, iz + 1, 1)], grid[(0, iz + 1, 0)]])
        bm.faces.new([grid[(nx, iz + 1, 0)], grid[(nx, iz + 1, 1)], grid[(nx, iz, 1)], grid[(nx, iz, 0)]])
    for iz in (0, nz):
        for ix in range(nx):
            q = [grid[(ix, iz, 0)], grid[(ix + 1, iz, 0)], grid[(ix + 1, iz, 1)], grid[(ix, iz, 1)]]
            bm.faces.new(q if iz == 0 else list(reversed(q)))
    top, bottom = thick, -thick * 1.4 - 0.05

    def col(f):
        n = f.normal
        c = f.calc_center_median()
        if n.y > 0.55:
            return mix(GRASS, GRASS_DRY, max(0.0, noise.noise(c * 2.0)) * 0.8)
        return strata(c.y, top, bottom)
    return finish(bm, name, col)


def rock(name, radius, squash, seed, dirt=0.3, grass_cap=False):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    for v in bm.verts:
        d = 1.0 + noise.noise(v.co * 2.3 + Vector((seed, 0, 0))) * 0.35 + rng.uniform(-0.08, 0.08)
        v.co *= d
        v.co.y *= squash
    # one flattened fracture face makes it read as a split stone, not a blob
    for v in bm.verts:
        if v.co.x > radius * 0.45:
            v.co.x = radius * 0.45 + (v.co.x - radius * 0.45) * 0.15

    def col(f):
        c = f.calc_center_median()
        if grass_cap and f.normal.y > 0.6:
            return GRASS
        if f.normal.x > 0.8:
            return mix(ROCK, (0.66, 0.62, 0.55), 0.6)  # fresh fracture face is paler
        if c.y > radius * 0.2 and rng.random() < dirt:
            return SUBSOIL
        return ROCK if rng.random() > 0.3 else ROCK_DARK
    return finish(bm, name, col)


def clod(name, radius, seed):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=radius)
    for v in bm.verts:
        v.co *= 1.0 + noise.noise(v.co * 3.0 + Vector((0, seed, 0))) * 0.4
        v.co.y *= 0.62
        if v.co.y > radius * 0.3:
            v.co.y = radius * 0.3 + (v.co.y - radius * 0.3) * 0.2  # flat turf top

    def col(f):
        if f.normal.y > 0.65:
            return GRASS
        return TOPSOIL if f.calc_center_median().y > -radius * 0.2 else SUBSOIL
    return finish(bm, name, col)


def tube(bm, pts, radii, sides=5):
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = d.orthogonal().normalized()
        b = d.cross(a).normalized()
        ring = []
        for s in range(sides):
            t = s / sides * math.tau
            ring.append(bm.verts.new(p + (a * math.cos(t) + b * math.sin(t)) * radii[i]))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for s in range(sides):
            bm.faces.new([rings[i][s], rings[i][(s + 1) % sides], rings[i + 1][(s + 1) % sides], rings[i + 1][s]])
    tip = bm.verts.new(pts[-1] + (pts[-1] - pts[-2]).normalized() * radii[-1] * 2.0)
    for s in range(sides):
        bm.faces.new([rings[-1][s], rings[-1][(s + 1) % sides], tip])


def root_seg(name):
    bm = bmesh.new()
    pts, radii = [], []
    for i in range(6):
        t = i / 5
        pts.append(Vector((math.sin(t * 5.0) * 0.06, -0.04 * t, t)))
        radii.append(0.055 * (1.0 - t * 0.8))
    tube(bm, pts, radii)
    # a side rootlet so each instance is not a clean cylinder
    tube(bm, [Vector((0.02, -0.01, 0.4)), Vector((0.14, -0.03, 0.55)), Vector((0.2, -0.05, 0.72))], [0.025, 0.017, 0.008], 4)
    return finish(bm, name, lambda f: ROOT)


def sapling(name):
    bm = bmesh.new()
    trunk = [Vector((0, 0, 0)), Vector((0.03, 0.5, 0.0)), Vector((-0.02, 1.0, 0.03)), Vector((0.0, 1.5, 0.0))]
    tube(bm, trunk, [0.07, 0.055, 0.04, 0.025], 5)
    tube(bm, [Vector((0.0, 0.8, 0)), Vector((0.25, 1.1, 0.05)), Vector((0.4, 1.3, 0.1))], [0.03, 0.02, 0.012], 4)
    tube(bm, [Vector((0.0, 1.05, 0)), Vector((-0.22, 1.3, -0.1)), Vector((-0.34, 1.45, -0.15))], [0.025, 0.017, 0.01], 4)
    # root flare
    for k in range(4):
        a = k * math.tau / 4 + 0.4
        tube(bm, [Vector((0, 0.15, 0)), Vector((math.cos(a) * 0.18, 0.0, math.sin(a) * 0.18)), Vector((math.cos(a) * 0.3, -0.06, math.sin(a) * 0.3))], [0.035, 0.025, 0.01], 4)
    return finish(bm, name, lambda f: BARK)


def leaf_puff(name):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5)
    for v in bm.verts:
        v.co *= 1.0 + noise.noise(v.co * 2.5) * 0.25
        v.co.y *= 0.72

    def col(f):
        # baked top-light: sun-facing facets warmer/brighter, underside cooler/darker
        return mix((0.16, 0.36, 0.14), (0.55, 0.72, 0.24), max(0.0, f.normal.y * 0.5 + 0.5))
    return finish(bm, name, col)


objs = [
    lip("lip_a", 1.7, 0.9, 0.28, 1.0),
    lip("lip_b", 1.3, 0.75, 0.22, 2.0),
    lip("lip_c", 2.1, 1.0, 0.32, 3.0),
    rock("chunk_a", 0.32, 0.75, 1.0),
    rock("chunk_b", 0.22, 0.9, 2.0, 0.5),
    rock("chunk_c", 0.42, 0.6, 3.0, 0.2, grass_cap=True),
    clod("clod_a", 0.2, 1.0),
    rock("pebble", 0.08, 0.7, 4.0, 0.0),
    root_seg("root_seg"),
    sapling("sapling"),
    leaf_puff("leaf_puff"),
]
for i, ob in enumerate(objs):
    ob.location.x = i * 2.5  # spread for the editable .blend; presenter ignores node transforms

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "spell_kit.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "spell_kit.glb"), export_format="GLB",
                          export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_apply=True, export_yup=True)
print("SPELL_KIT_OK", len(objs), out)
