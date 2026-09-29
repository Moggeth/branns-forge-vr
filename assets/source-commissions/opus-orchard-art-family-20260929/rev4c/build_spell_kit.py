"""Deterministic Blender 4.5 builder for the Orchard spell VFX kit (live-revision 2026-09-29).

Run:  blender --background --factory-startup --python build_spell_kit.py -- --out ABS_DIR
Emits ABS_DIR/spell_kit.glb and ABS_DIR/spell_kit.blend (editable source).

Revision against real-game captures:
  * Colours were authored as display values but written as linear vertex colour, so every piece
    rendered ~2x too bright (neon sod blocks, chalk-white debris). Palette is now written in sRGB
    terms and converted to linear into a FLOAT_COLOR attribute.
  * lip_* were rectangular 4x6 grids (read as railway sleepers). They are now irregular fractured
    sod plates: jagged tear edge, overhanging grass skin, real topsoil/subsoil/clay bands on the
    torn sides, tapering root-bound underside and hanging root threads.
  * NEW wall_a/wall_b: stratified cut-wall panels with differential erosion ledges (soft layers
    recessed, gravel/rock proud) so settled Sunder walls read as geology, not a dark oval.
  * NEW scarp_a/scarp_b/crust_a: Raise pieces - fresh angular stone pushing through, and thin
    turf crust plates for the narrow stress seam.
  * chunk_* are convex-hull fractured stones (recognisable planar facets, one pale fresh face)
    instead of noisy icospheres. NEW clod_b (dark subsoil lump), sprout (Grow wave seedling),
    swell (Grow ground heave ring).

Every piece is small, flat-shaded and vertex-coloured (COLOR_0) so the presenter shares ONE
material for the whole kit and tints per instance. Pivot conventions (Godot axes, metres):
  lip_*, crust_a  pivot at hinge on the inner (tear) edge, plate extends +X, +Z along path
  wall_*          pivot at top of the wall face, face looks -X (into the tear), body extends +X,
                  wall hangs 0..-1.8 m in Y (presenter scales Y to real cut depth), +Z along path
  scarp_*         pivot at ground level, shard rises +Y
  chunk_*, clod_*, pebble   pivot at centroid
  root_seg        pivot at base, grows along +Z (presenter scales Z for reach)
  sapling, sprout pivot at ground, grows +Y; leaf_puff pivot at centre
  swell           pivot at ground centre, 1 m radius heave ring
"""
import bpy, bmesh, math, random, sys, os
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = os.path.abspath(argv[argv.index("--out") + 1]) if "--out" in argv else os.path.abspath("kit_out")
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
rng = random.Random(20260929)


def lin(c):
    """sRGB display colour -> linear (vertex colour contract)."""
    def f(v):
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return tuple(f(v) for v in c)


# Display (sRGB) palette sampled against the Orchard ground shader in real captures.
GRASS = (0.27, 0.37, 0.14)        # rev-2: lambert-wrap kit shading reads ~20% brighter than terrain
GRASS_DRY = (0.37, 0.39, 0.18)
GRASS_SHADE = (0.19, 0.28, 0.11)
TURF = (0.27, 0.21, 0.13)          # root-bound mat just under the grass
TOPSOIL = (0.21, 0.14, 0.09)
SUBSOIL = (0.37, 0.25, 0.15)
CLAY = (0.52, 0.38, 0.24)
GRAVEL = (0.46, 0.41, 0.34)
ROCK = (0.47, 0.45, 0.42)
ROCK_DARK = (0.31, 0.30, 0.29)
ROCK_FRESH = (0.62, 0.58, 0.52)
LICHEN = (0.50, 0.52, 0.36)
ROOT = (0.37, 0.26, 0.17)
BARK = (0.45, 0.28, 0.17)          # matches world_builder tree trunks (orange-brown)
LEAF_SHADE = (0.24, 0.42, 0.12)
LEAF_LIT = (0.50, 0.70, 0.22)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def jitter(c, amt=0.07):
    k = 1.0 + rng.uniform(-amt, amt)
    h = rng.uniform(-amt, amt) * 0.4
    return (c[0] * k * (1 + h), c[1] * k, c[2] * k * (1 - h))


def finish(bm, name, colour_fn, jit=0.07):
    # Authored in Godot axes (Y up, +Z along path) -> Blender Z-up so glTF Y-up lands back.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    layer = bm.loops.layers.float_color.new("Col")
    for f in bm.faces:
        c = lin(tuple(min(1.0, max(0.0, v)) for v in jitter(colour_fn(f), jit)))
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
    me.color_attributes.active_color = me.color_attributes["Col"]
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


def n3(p, s=0.0):
    return noise.noise(Vector((p[0], p[1], p[2] + s)))


# ------------------------------------------------------------------ fractured sod plate

def sod_plate(name, length, width, thick, seed, jag=0.14, roots=3):
    """Irregular turf/earth plate. Tear edge on -X is saw-toothed; bands on the torn sides."""
    r = random.Random(seed)
    n = 11
    outline = []
    for i in range(n):
        t = i / n * math.tau
        c, s = math.cos(t), math.sin(t)
        # squarish-irregular outline (superellipse) with per-vertex bite
        # rev-4c: rounder, bitten outline (was a superellipse^3 -> read as rectangular caps from RTS height)
        k = 1.0 / max((abs(c) ** 2.2 + abs(s) ** 2.2) ** (1 / 2.2), 1e-3)
        k *= r.uniform(0.66, 1.06) * (0.72 if r.random() < 0.22 else 1.0)   # occasional deep notch
        x = width * 0.5 + c * width * 0.5 * min(k, 1.25)
        z = s * length * 0.5 * min(k, 1.2)
        if c < -0.35:                                  # torn edge: alternate teeth
            x += (jag if i % 2 else -jag * 0.6) * width
        outline.append((max(x, -0.05 * width), z))
    # ring levels: (y, inset scale, colour band)
    levels = [(thick, 1.0), (thick - 0.05, 1.03), (thick * 0.35, 0.97), (-thick * 0.55, 0.88), (-thick * 1.35, 0.62)]
    bm = bmesh.new()
    cx = sum(p[0] for p in outline) / n
    rings = []
    for li, (y, sc) in enumerate(levels):
        ring = []
        for i, (x, z) in enumerate(outline):
            jx = r.uniform(-0.04, 0.04) * (li > 1)
            px = cx + (x - cx) * sc + jx
            pz = z * sc + r.uniform(-0.03, 0.03) * (li > 1)
            py = y + n3((px * 2.1, pz * 2.1, seed)) * 0.035 + (0.02 * (1 - (x - cx) ** 2) if li == 0 else 0.0)
            ring.append(bm.verts.new((px, py, pz)))
        rings.append(ring)
    top_c = bm.verts.new((cx, thick + 0.05, 0.0))
    bot_c = bm.verts.new((cx, -thick * 1.45, 0.0))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([top_c, rings[0][i], rings[0][j]])
        for li in range(len(rings) - 1):
            bm.faces.new([rings[li][i], rings[li + 1][i], rings[li + 1][j], rings[li][j]])
        bm.faces.new([bot_c, rings[-1][j], rings[-1][i]])
    # hanging root threads off the torn edge
    for k in range(roots):
        i = r.randrange(n)
        a = rings[1][i].co
        if a.x > cx:                      # only on the tear half
            continue
        d = Vector((r.uniform(-0.1, 0.05), -r.uniform(0.18, 0.4), r.uniform(-0.06, 0.06)))
        v0 = bm.verts.new(a + Vector((0, -0.02, -0.02)))
        v1 = bm.verts.new(a + Vector((0, -0.02, 0.025)))
        v2 = bm.verts.new(a + d)
        bm.faces.new([v0, v1, v2])
    ys = [lv[0] for lv in levels]

    def col(f):
        c = f.calc_center_median()
        if len(f.verts) == 3 and f.normal.y < 0.3 and c.y < ys[1] and c.y > -thick and len(f.edges) == 3 and not any(v is bot_c for v in f.verts) and f.calc_area() < 0.03:
            return ROOT
        if f.normal.y > 0.5 and c.y > ys[1]:
            # rev-4c: darker, broken sod cap - shaded/trampled grass wedges and torn earth patches, so
            # lips no longer read as bright green tiles in tactical view (real rev4b capture 03)
            roll = r.random()
            if roll < 0.3:
                return mix(TURF, TOPSOIL, r.uniform(0.2, 0.7))                 # torn, earth showing
            g = mix(GRASS_SHADE, mix(GRASS, GRASS_DRY, 0.5 + n3(c * 3.0, seed) * 0.9), r.uniform(0.25, 0.7))
            return mix(g, TURF, 0.2 if roll < 0.55 else 0.0)
        if c.y > ys[1] - 0.01:
            return mix(GRASS_SHADE, TURF, 0.6)
        if c.y > ys[2]:
            return TURF
        if c.y > ys[3]:
            return mix(TOPSOIL, SUBSOIL, 0.25 + r.random() * 0.2)
        if c.y > ys[4] + 0.02:
            return mix(SUBSOIL, CLAY, 0.35 + r.random() * 0.3)
        return mix(TOPSOIL, SUBSOIL, 0.4)
    return finish(bm, name, col)


# ------------------------------------------------------------------ stratified wall panel

WALL_BANDS = [  # (bottom y, colour, recess)  soft layers recess, hard layers stand proud
    (-0.07, GRASS_SHADE, -0.10),
    (-0.30, TOPSOIL, 0.02),
    (-0.62, SUBSOIL, 0.06),
    (-0.80, GRAVEL, -0.03),
    (-1.15, CLAY, 0.08),
    (-1.42, ROCK_DARK, -0.06),
    (-1.80, ROCK, -0.02),
]


def wall(name, length, seed):
    r = random.Random(seed)
    nz = 8
    dip = r.uniform(-0.1, 0.1)
    bm = bmesh.new()
    cols = []
    for iz in range(nz + 1):
        z = (iz / nz - 0.5) * length
        col = []
        prev = 0.0
        pts = [(0.0, -0.12 + r.uniform(-0.03, 0.03))]  # grass overhang at the very top
        for bi, (yb, _, rec) in enumerate(WALL_BANDS):
            yb2 = yb + dip * z + n3((z * 0.9, bi * 1.7, seed)) * 0.06
            ymid = (prev + yb2) * 0.5
            pts.append((ymid, rec + n3((z * 2.3, ymid * 3.0, seed)) * 0.07))
            pts.append((yb2, rec * 0.4 + n3((z * 2.1, yb2 * 2.0, seed + 3)) * 0.05))
            prev = yb2
        # stagger scalloped bottom so the panel buries unevenly into the floor
        for (y, x) in pts:
            col.append(bm.verts.new((x, y, z)))
        cols.append(col)
    rows = len(cols[0])
    for iz in range(nz):
        for k in range(rows - 1):
            bm.faces.new([cols[iz][k], cols[iz][k + 1], cols[iz + 1][k + 1], cols[iz + 1][k]])
    # back skin (into the bank, rarely visible) + top turf strip + end caps
    back = [[bm.verts.new((0.45, cols[iz][k].co.y, cols[iz][k].co.z)) for k in (0, rows - 1)] for iz in range(nz + 1)]
    for iz in range(nz):
        bm.faces.new([cols[iz][0], cols[iz + 1][0], back[iz + 1][0], back[iz][0]])        # top
        bm.faces.new([cols[iz][-1], back[iz][1], back[iz + 1][1], cols[iz + 1][-1]])      # bottom
        bm.faces.new([back[iz][0], back[iz + 1][0], back[iz + 1][1], back[iz][1]])        # back
    for iz in (0, nz):
        ring = [cols[iz][k] for k in range(rows)] + [back[iz][1], back[iz][0]]
        f = bm.faces.new(ring if iz == 0 else list(reversed(ring)))

    def colour(f):
        c = f.calc_center_median()
        if f.normal.y > 0.6 and c.y > -0.1:
            return mix(GRASS, GRASS_DRY, 0.4 + n3(c * 2.0, seed))
        if c.x > 0.3:
            return TOPSOIL
        yb_prev = 0.0
        for yb, cc, _ in WALL_BANDS:
            if c.y > yb + dip * c.z:
                base = cc
                break
            yb_prev = yb
        else:
            base = ROCK
        # streaks of wash from above and pale fresh fracture spots in rock layers
        base = mix(base, TOPSOIL, 0.2 if r.random() < 0.18 else 0.0)
        if base in (ROCK, ROCK_DARK) and f.normal.y > 0.2:
            base = mix(base, ROCK_FRESH, 0.5)
        return base
    return finish(bm, name, colour, 0.06)


# ------------------------------------------------------------------ fractured hull stones

def hull_stone(name, size, seed, n=16, fresh_axis=(1, 0, 0), soil_cap=0.0, grass_cap=False, lichen=0.15):
    r = random.Random(seed)
    bm = bmesh.new()
    for _ in range(n):
        v = Vector((r.gauss(0, 1), r.gauss(0, 1), r.gauss(0, 1))).normalized() * r.uniform(0.75, 1.0)
        bm.verts.new((v.x * size[0], v.y * size[1], v.z * size[2]))
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    # one planar fracture: clip everything beyond 0.55 along fresh_axis -> big pale face
    fa = Vector(fresh_axis).normalized()
    lim = 0.55 * max(abs(fa.x) * size[0], abs(fa.y) * size[1], abs(fa.z) * size[2])
    for v in bm.verts:
        d = v.co.dot(fa)
        if d > lim:
            v.co -= fa * (d - lim) * 0.92
    bmesh.ops.dissolve_degenerate(bm, dist=1e-4, edges=bm.edges[:])

    def col(f):
        c = f.calc_center_median()
        nrm = f.normal
        if nrm.dot(fa) > 0.85:
            return mix(ROCK_FRESH, CLAY, r.random() * 0.2)
        if grass_cap and nrm.y > 0.55:
            return mix(GRASS, GRASS_DRY, r.random())
        if soil_cap and c.y > size[1] * (0.6 - soil_cap) and nrm.y > 0.0:
            return mix(TOPSOIL, SUBSOIL, r.random())
        if nrm.y > 0.4 and r.random() < lichen:
            return LICHEN
        return mix(ROCK, ROCK_DARK, 0.3 + 0.5 * r.random() if nrm.y < 0.0 else r.random() * 0.4)
    return finish(bm, name, col, 0.05)


def soil_lump(name, radius, seed, turf=True):
    r = random.Random(seed)
    bm = bmesh.new()
    for _ in range(14):
        v = Vector((r.gauss(0, 1), r.gauss(0, 1) * 0.6, r.gauss(0, 1))).normalized() * r.uniform(0.7, 1.0)
        bm.verts.new(v * radius)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    for v in [v for v in bm.verts if not v.link_faces]:
        bm.verts.remove(v)
    if turf:
        for v in bm.verts:
            if v.co.y > radius * 0.25:
                v.co.y = radius * 0.25 + (v.co.y - radius * 0.25) * 0.25

    def col(f):
        if turf and f.normal.y > 0.7:
            return mix(GRASS, GRASS_DRY, r.random() * 0.7)
        c = f.calc_center_median()
        if turf and c.y > 0.0:
            return TURF
        return mix(TOPSOIL, SUBSOIL, r.random() * (0.8 if turf else 0.5))
    return finish(bm, name, col)


# ------------------------------------------------------------------ organic pieces

def tube(bm, pts, radii, sides=5):
    rings = []
    for i, p in enumerate(pts):
        d = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        a = d.orthogonal().normalized()
        b = d.cross(a).normalized()
        ring = [bm.verts.new(p + (a * math.cos(s / sides * math.tau) + b * math.sin(s / sides * math.tau)) * radii[i]) for s in range(sides)]
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
    for i in range(7):
        t = i / 6
        pts.append(Vector((math.sin(t * 5.0) * 0.07, -0.05 * t + 0.03 * math.sin(t * 9), t)))
        radii.append(0.07 * (1.0 - t * 0.85))
    tube(bm, pts, radii)
    tube(bm, [Vector((0.02, -0.01, 0.35)), Vector((0.15, -0.03, 0.5)), Vector((0.24, -0.06, 0.7))], [0.03, 0.02, 0.008], 4)
    tube(bm, [Vector((-0.02, -0.02, 0.6)), Vector((-0.14, -0.04, 0.75)), Vector((-0.2, -0.06, 0.9))], [0.022, 0.014, 0.006], 4)
    return finish(bm, name, lambda f: mix(ROOT, BARK, 0.5 if f.normal.y > 0.3 else 0.0))


def sapling(name):
    bm = bmesh.new()
    trunk = [Vector((0, 0, 0)), Vector((0.03, 0.5, 0.0)), Vector((-0.02, 1.0, 0.03)), Vector((0.0, 1.5, 0.0))]
    tube(bm, trunk, [0.08, 0.06, 0.045, 0.028], 6)
    tube(bm, [Vector((0.0, 0.8, 0)), Vector((0.25, 1.1, 0.05)), Vector((0.4, 1.3, 0.1))], [0.03, 0.02, 0.012], 4)
    tube(bm, [Vector((0.0, 1.05, 0)), Vector((-0.22, 1.3, -0.1)), Vector((-0.34, 1.45, -0.15))], [0.025, 0.017, 0.01], 4)
    for k in range(5):
        a = k * math.tau / 5 + 0.4
        tube(bm, [Vector((0, 0.18, 0)), Vector((math.cos(a) * 0.2, 0.0, math.sin(a) * 0.2)), Vector((math.cos(a) * 0.36, -0.05, math.sin(a) * 0.36))], [0.045, 0.03, 0.012], 4)
    return finish(bm, name, lambda f: BARK)


def sprout(name):
    """Three-leaf seedling fan: 12 tris. Pops along the Grow wave ahead of the trees."""
    bm = bmesh.new()
    for k in range(3):
        a = k * math.tau / 3
        d = Vector((math.cos(a), 0, math.sin(a)))
        s = bm.verts.new((0, 0, 0))
        m1 = bm.verts.new(d * 0.08 + Vector((0, 0.14, 0)) + d.cross(Vector((0, 1, 0))) * 0.05)
        m2 = bm.verts.new(d * 0.08 + Vector((0, 0.14, 0)) - d.cross(Vector((0, 1, 0))) * 0.05)
        tip = bm.verts.new(d * 0.2 + Vector((0, 0.22, 0)))
        bm.faces.new([s, m1, tip, m2])
    return finish(bm, name, lambda f: mix(LEAF_SHADE, LEAF_LIT, 0.7))


def leaf_puff(name, seed=0):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=2, radius=0.5)
    for v in bm.verts:
        v.co *= 1.0 + noise.noise(v.co * 2.2 + Vector((seed, 0, 0))) * 0.28
        v.co.y *= 0.74
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(9), verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])

    def col(f):
        # baked top-light kept mild (scene light does the rest); interior clusters darker
        t = max(0.0, f.normal.y * 0.5 + 0.5)
        return mix(LEAF_SHADE, LEAF_LIT, t * t * 0.9 + rng.uniform(-0.05, 0.08))
    return finish(bm, name, col, 0.05)


def swell(name):
    """Low heave ring: cracked turf dome with a darker soil ring (reads from RTS height)."""
    bm = bmesh.new()
    n = 14
    c = bm.verts.new((0, 0.2, 0))
    inner = [bm.verts.new((math.cos(i / n * math.tau) * 0.55, 0.14 + rng.uniform(-0.02, 0.03), math.sin(i / n * math.tau) * 0.55)) for i in range(n)]
    crack = [bm.verts.new((math.cos((i + 0.5) / n * math.tau) * rng.uniform(0.66, 0.78), 0.06, math.sin((i + 0.5) / n * math.tau) * rng.uniform(0.66, 0.78))) for i in range(n)]
    outer = [bm.verts.new((math.cos(i / n * math.tau) * 1.0, -0.04, math.sin(i / n * math.tau) * 1.0)) for i in range(n)]
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([c, inner[j], inner[i]])
        bm.faces.new([inner[i], inner[j], crack[i]])
        bm.faces.new([crack[i], inner[j], outer[j], outer[i]][::-1][::-1])
    def col(f):
        cc = f.calc_center_median()
        rr = math.hypot(cc.x, cc.z)
        if rr < 0.45:
            return mix(GRASS, GRASS_DRY, rng.random() * 0.5)
        if rr < 0.62:
            return mix(TOPSOIL, TURF, rng.random())
        return mix(GRASS_SHADE, TURF, 0.3)
    return finish(bm, name, col)


objs = [
    sod_plate("lip_a", 1.6, 0.95, 0.24, 11),
    sod_plate("lip_b", 1.15, 0.7, 0.2, 12, jag=0.2),
    sod_plate("lip_c", 2.0, 1.1, 0.3, 13, jag=0.1, roots=4),
    sod_plate("crust_a", 0.9, 0.55, 0.1, 14, jag=0.22, roots=1),
    wall("wall_a", 2.3, 21),
    wall("wall_b", 1.7, 22),
    hull_stone("chunk_a", (0.34, 0.26, 0.3), 31, soil_cap=0.25),
    hull_stone("chunk_b", (0.26, 0.12, 0.22), 32, fresh_axis=(0, 1, 0), lichen=0.0),
    hull_stone("chunk_c", (0.48, 0.3, 0.4), 33, grass_cap=True),
    hull_stone("scarp_a", (0.32, 0.85, 0.24), 34, fresh_axis=(-1, 0.2, 0), soil_cap=0.15, lichen=0.0),
    hull_stone("scarp_b", (0.5, 0.55, 0.3), 35, fresh_axis=(-0.8, 0.5, 0.2), soil_cap=0.2, lichen=0.05),
    soil_lump("clod_a", 0.2, 41, turf=True),
    soil_lump("clod_b", 0.16, 42, turf=False),
    hull_stone("pebble", (0.08, 0.055, 0.07), 43, n=10, lichen=0.0),
    root_seg("root_seg"),
    sapling("sapling"),
    sprout("sprout"),
    leaf_puff("leaf_puff"),
    swell("swell"),
]
tris = 0
for i, ob in enumerate(objs):
    ob.location.x = i * 2.5
    t = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    tris += t
    print("PIECE", ob.name, "tris", t)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "spell_kit.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "spell_kit.glb"), export_format="GLB",
                          export_vertex_color="ACTIVE", export_all_vertex_colors=False,
                          export_apply=True, export_yup=True)
print("SPELL_KIT_OK", len(objs), "tris", tris, out)
