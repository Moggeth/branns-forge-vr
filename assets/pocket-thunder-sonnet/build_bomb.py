"""Deterministic Pocket Thunder builder. Run:
blender --background --python build_bomb.py -- <output_dir>
Writes pocket_thunder.blend and bomb.glb. Units are metres, Blender Z-up (glTF export converts to Y-up).
Bomb radius R = 0.095 m. No randomness, no external assets, 3 shared materials.
"""
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix

R = 0.095
OUT = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.getcwd()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'


# ---------- materials (shared across every part) ----------
def make_mat(name, base, metal, rough, emit=None, strength=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = base
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    if emit:
        b.inputs["Emission Color"].default_value = emit
        b.inputs["Emission Strength"].default_value = strength
    m.diffuse_color = base
    return m

MATS = [
    make_mat("PT_Forged", (0.028, 0.040, 0.070, 1), 0.95, 0.42),
    make_mat("PT_Brass", (0.85, 0.52, 0.14, 1), 1.0, 0.34),
    make_mat("PT_HeartGlow", (0.10, 0.45, 0.35, 1), 0.0, 0.2, (0.10, 0.80, 0.45, 1), 2.4),
]
FORGED, BRASS, HEART = 0, 1, 2


def new_obj(name, bm, mats, parent=None, loc=(0, 0, 0), smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(MATS[m])
    for p in me.polygons:
        p.use_smooth = smooth
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.location = loc
    if parent:
        ob.parent = parent
    return ob


def sph(lat, lon, r):
    return Vector((math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat))) * r


def tri_count(ob):
    me = ob.data
    return sum(len(p.vertices) - 2 for p in me.polygons)


# ---------- primitive helpers (all write into a bmesh with a material slot) ----------
def add_geo(bm, geo, mat, matrix=None):
    verts = [v for v in geo["verts"]]
    if matrix is not None:
        bmesh.ops.transform(bm, matrix=matrix, verts=verts)
    faces = set()
    for v in verts:
        for f in v.link_faces:
            faces.add(f)
    for f in faces:
        if all(v in verts for v in f.verts):
            f.material_index = mat


def torus(bm, major, minor, mat, z=0.0, seg=32, tube=6):
    rings = []
    for i in range(seg):
        a = i * math.tau / seg
        ring = []
        for j in range(tube):
            t = j * math.tau / tube
            rr = major + minor * math.cos(t)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z + minor * math.sin(t))))
        rings.append(ring)
    for i in range(seg):
        for j in range(tube):
            f = bm.faces.new((rings[i][j], rings[(i + 1) % seg][j], rings[(i + 1) % seg][(j + 1) % tube], rings[i][(j + 1) % tube]))
            f.material_index = mat


def gem(bm, center, scale, mat, rot=0.0):
    """Elongated octahedron jewel (8 tris)."""
    top = bm.verts.new(center + Vector((0, 0, scale[2])))
    bot = bm.verts.new(center - Vector((0, 0, scale[2])))
    ring = []
    for i in range(4):
        a = rot + i * math.tau / 4
        ring.append(bm.verts.new(center + Vector((math.cos(a) * scale[0], math.sin(a) * scale[1], 0))))
    for i in range(4):
        j = (i + 1) % 4
        bm.faces.new((top, ring[i], ring[j])).material_index = mat
        bm.faces.new((bot, ring[j], ring[i])).material_index = mat


# ---------- Heart: faceted jewel core visible through fracture seams ----------
bm = bmesh.new()
geo = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=R * 0.80)
for f in bm.faces:
    f.material_index = 0
root = bpy.data.objects.new("PocketThunder", None)
root.empty_display_type = 'PLAIN_AXES'
root.empty_display_size = R
bpy.context.scene.collection.objects.link(root)
heart = new_obj("Heart", bm, [HEART], root)  # flat shaded facets = jewel look


# ---------- Shell: irregular forged plates (noise-warped Voronoi cells on a fine sphere) ----------
shell = bpy.data.objects.new("Shell", None)
shell.empty_display_size = R * 0.5
bpy.context.scene.collection.objects.link(shell)
shell.parent = root

NPLATES = 13
GAP = 0.085  # radians of warped-distance margin left open between plates (heart shows through)


def warp(n):
    return (n + Vector((math.sin(n.y * 6.1 + n.z * 3.3 + 1.0), math.sin(n.z * 5.3 + n.x * 4.1 + 2.0),
                        math.sin(n.x * 5.7 + n.y * 3.9 + 3.0))) * 0.20).normalized()


seeds = []
golden = math.pi * (3 - math.sqrt(5))
for i in range(NPLATES):
    z = 1 - 2 * (i + 0.5) / NPLATES
    r = math.sqrt(1 - z * z)
    a = i * golden + 0.35 * math.sin(i * 2.7)
    z = max(-0.97, min(0.97, z + 0.10 * math.sin(i * 1.9)))
    seeds.append(Vector((math.cos(a) * r, math.sin(a) * r, z)).normalized())
weights = [0.85 + 0.35 * ((i * 7) % 5) / 4 for i in range(NPLATES)]
BRASS_PLATES = {2, 6, 9}
RIM_PLATES = {0, 4, 7, 11}

ico = bmesh.new()
bmesh.ops.create_icosphere(ico, subdivisions=4, radius=1.0)
groups = [[] for _ in range(NPLATES)]
for f in ico.faces:
    n = f.calc_center_median().normalized()
    w = warp(n)
    ds = sorted((math.acos(max(-1, min(1, w.dot(seeds[i])))) * weights[i], i) for i in range(NPLATES))
    if ds[1][0] - ds[0][0] < GAP:
        continue
    # only the closest plate claims the face; shave a jagged notch into some seam edges
    groups[ds[0][1]].append([v.co.copy() for v in f.verts])

segments = []
seg_index = 0
for pi, tris in enumerate(groups):
    if len(tris) < 6:
        continue
    bm = bmesh.new()
    vmap = {}
    def vert(co):
        k = (round(co.x, 5), round(co.y, 5), round(co.z, 5))
        if k not in vmap:
            vmap[k] = bm.verts.new(co)
        return vmap[k]
    for t in tris:
        bm.faces.new([vert(c) for c in t])
    bm.verts.ensure_lookup_table()
    # depth from boundary -> raised plateau profile
    depth = {}
    frontier = [v for v in bm.verts if any(e.is_boundary for e in v.link_edges)]
    for v in frontier:
        depth[v.index] = 0
    d = 0
    while frontier and d < 3:
        nxt = []
        for v in frontier:
            for e in v.link_edges:
                o = e.other_vert(v)
                if o.index not in depth:
                    depth[o.index] = d + 1
                    nxt.append(o)
        frontier = nxt
        d += 1
    bump = 1.0 + 0.012 * (pi % 3)
    for v in bm.verts:
        dd = min(depth.get(v.index, 3), 3)
        v.co = v.co.normalized() * R * (0.93, 0.99, 1.03, 1.05)[dd] * bump
    # skirt down to dark interior
    bnd = [e for e in bm.edges if e.is_boundary]
    inner = {}
    for e in bnd:
        for v in e.verts:
            if v not in inner:
                inner[v] = bm.verts.new(v.co.normalized() * R * 0.78)
    for e in bnd:
        a, b = e.verts
        bm.faces.new((a, b, inner[b], inner[a]))
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    brass_plate = pi in BRASS_PLATES
    for f in bm.faces:
        if brass_plate:
            f.material_index = BRASS
        elif pi in RIM_PLATES and len(f.verts) == 3 and any(depth.get(v.index, 3) == 0 for v in f.verts if v.index in depth):
            f.material_index = BRASS
        else:
            f.material_index = FORGED
    for e in bm.edges:
        fs = e.link_faces
        if len(fs) == 2 and fs[0].normal.dot(fs[1].normal) < 0.75:
            e.smooth = False
    outer = [v.co for v in bm.verts if v.co.length > R * 0.9]
    c = sum(outer, Vector()) / len(outer)
    for v in bm.verts:
        v.co -= c
    ob = new_obj("Shell_Seg_%02d" % seg_index, bm, [FORGED, BRASS], shell, loc=c, smooth=True)
    ob["burst_dir"] = tuple(c.normalized())
    ob["plate"] = pi
    ob["phase"] = (seg_index % 5) * 0.04
    segments.append(ob)
    seg_index += 1
COLS = 8


# ---------- Binding: three partial brass clamp arcs with studs (not a full regular ring) ----------
def torus_arc(bm, major, minor, mat, a0, a1, z=0.0, seg=10, tube=5):
    rings = []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        ring = []
        for j in range(tube):
            t = j * math.tau / tube
            rr = major + minor * math.cos(t)
            ring.append(bm.verts.new((rr * math.cos(a), rr * math.sin(a), z + minor * math.sin(t))))
        rings.append(ring)
    for i in range(seg):
        for j in range(tube):
            bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][(j + 1) % tube], rings[i][(j + 1) % tube])).material_index = mat


bm = bmesh.new()
for k, (a0, a1) in enumerate(((0.3, 1.5), (2.6, 3.5), (4.5, 5.9))):
    torus_arc(bm, R * 1.035, R * 0.03, 0, a0, a1, z=(k - 1) * R * 0.05)
    gem(bm, Vector((math.cos(a0), math.sin(a0), (k - 1) * R * 0.05)) * R * 1.07, (R * 0.05, R * 0.05, R * 0.08), 1, a0)
    gem(bm, Vector((math.cos(a1), math.sin(a1), (k - 1) * R * 0.05)) * R * 1.06, (R * 0.035, R * 0.035, R * 0.05), 0, a1)
binding = new_obj("Binding", bm, [BRASS, HEART], root)


# ---------- Crown: low broad brass collar, five uneven forged prongs, faceted jewel ----------
bm = bmesh.new()
g = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=R * 0.40, radius2=R * 0.30, depth=R * 0.13)
add_geo(bm, g, BRASS, Matrix.Translation((0, 0, R * 1.0)))
heights = (0.20, 0.13, 0.17, 0.11, 0.15)
for k in range(5):
    a = k * math.tau / 5 + 0.2
    d = Vector((math.cos(a), math.sin(a), 0))
    tng = d.cross(Vector((0, 0, 1)))
    base = d * R * 0.34 + Vector((0, 0, R * 1.05))
    tip = d * R * 0.20 + Vector((0, 0, R * (1.05 + heights[k])))
    hw = R * 0.055
    vs = [bm.verts.new(p) for p in (base - tng * hw, base + tng * hw, tip + tng * hw * 0.35 + d * R * 0.02, tip - tng * hw * 0.35 + d * R * 0.02, d * R * 0.26 + Vector((0, 0, R * 1.0)))]
    for q in ((0, 1, 2, 3), (0, 3, 4), (1, 4, 3)[::-1] if False else (3, 2, 4)):
        pass
    bm.faces.new((vs[0], vs[1], vs[2], vs[3])).material_index = BRASS
    bm.faces.new((vs[1], vs[0], vs[4])).material_index = BRASS
    bm.faces.new((vs[0], vs[3], vs[4])).material_index = BRASS
    bm.faces.new((vs[2], vs[1], vs[4])).material_index = BRASS
    bm.faces.new((vs[3], vs[2], vs[4])).material_index = BRASS
gem(bm, Vector((0, 0, R * 1.11)), (R * 0.15, R * 0.13, R * 0.17), HEART, 0.3)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
crown = new_obj("Crown", bm, [BRASS, HEART], root)
for p in crown.data.polygons:
    p.material_index = 0 if p.material_index == BRASS else 1


# ---------- Base cup with tiny jewel ----------
bm = bmesh.new()
g = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=R * 0.27, radius2=R * 0.40, depth=R * 0.15)
add_geo(bm, g, 0, Matrix.Translation((0, 0, -R * 0.99)))
torus(bm, R * 0.30, R * 0.028, 0, -R * 1.06, seg=20, tube=5)
gem(bm, Vector((0, 0, -R * 1.12)), (R * 0.07, R * 0.07, R * 0.09), 1, math.pi / 4)
base = new_obj("Base", bm, [BRASS, HEART], root)

trail = bpy.data.objects.new("TrailOrigin", None)
trail.empty_display_type = 'SPHERE'
trail.empty_display_size = R * 0.15
trail.location = (0, 0, 0)
bpy.context.scene.collection.objects.link(trail)
trail.parent = root
trail["note"] = "Trail emitter anchor at bomb centre; align trail to velocity in code."

root["radius_m"] = R
root["segment_count"] = len(segments)

# ---------- report + save + export ----------
tris = sum(tri_count(o) for o in bpy.data.objects if o.type == 'MESH')
print("PT_TRIANGLES", tris, "SEGMENTS", len(segments), "MATERIALS", len(bpy.data.materials))

os.makedirs(OUT, exist_ok=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "pocket_thunder.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, "bomb.glb"), export_format='GLB',
                          export_apply=True, export_yup=True, export_cameras=False, export_lights=False,
                          export_extras=True, export_materials='EXPORT')
print("PT_DONE")
