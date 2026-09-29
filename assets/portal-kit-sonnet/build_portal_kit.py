"""Brann's Forge VR portal kit - deterministic Blender 4.5 builder.

Run:  blender.exe -b -P output/build_portal_kit.py -- [--no-render] [--quick]
Outputs (next to this file): portals/*.glb, portal_kit.blend, renders/*.png, stats.json

Conventions: Blender +Z up, FRONT (player side) = -Y  ->  glTF/Godot +Z front, +Y up.
Origin = centre of the walkable aperture at ground level. Aperture plane is y=0.
"""
import bpy, bmesh, math, random, os, sys, json, contextlib
from mathutils import Vector, Matrix, Euler, noise

HERE = os.path.dirname(os.path.abspath(__file__))
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
DO_RENDER = "--no-render" not in ARGS
QUICK = "--quick" in ARGS

SLOTS = ["stone", "trim", "metal", "glow", "organic", "accent", "surface"]


def hexc(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def srgb2lin(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)


# ---------------------------------------------------------------- palettes
PAL = {
    "orchard":  dict(stone="8a9878", trim="8a6a48", metal="b59a58", glow="f0c86a", organic="6fa84e", accent="d8503a", emit_accent=0.0),
    "quarry":   dict(stone="c79565", trim="a8703f", metal="5f564c", glow="efbf64", organic="8a5f3a", accent="e4b54f", emit_accent=0.6),
    "crystal":  dict(stone="636d87", trim="454e68", metal="8e9ab5", glow="7edcea", organic="3c4560", accent="4fc4e8", emit_accent=0.55),
    "foundry":  dict(stone="4a454e", trim="2c282f", metal="66606c", glow="ff9747", organic="8a5a3a", accent="ffcf6a", emit_accent=1.6),
    # motif variants reuse a family with a zone palette
    "mushroom": dict(stone="7f8496", trim="8a6a48", metal="b59a58", glow="bc8deb", organic="9965b8", accent="ead3ed", emit_accent=0.4),
    "sky":      dict(stone="d6d8c4", trim="b9c2b0", metal="c8d4d6", glow="b3e4e8", organic="e6f1f0", accent="ffffff", emit_accent=0.5),
    "kitchen":  dict(stone="c0a582", trim="95663d", metal="b97b47", glow="e7a25f", organic="95663d", accent="fff0c8", emit_accent=0.6),
}
# variant name -> (family builder, palette key, options)
VARIANTS = {
    "orchard":  ("orchard", "orchard", {}),
    "quarry":   ("quarry", "quarry", {}),
    "crystal":  ("crystal", "crystal", {}),
    "foundry":  ("foundry", "foundry", {}),
    "mushroom": ("orchard", "mushroom", {"caps": True}),
    "sky":      ("quarry", "sky", {"wings": True}),
    "kitchen":  ("quarry", "kitchen", {"pots": True}),
}


# ---------------------------------------------------------------- materials
def make_mat(vname, slot, pal):
    name = "PK_%s_%s" % (slot.capitalize(), vname.capitalize())
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    col = srgb2lin(hexc(pal[slot if slot in pal else "glow"]))
    if slot == "surface":
        col = srgb2lin(hexc(pal["glow"]))
    bsdf.inputs["Base Color"].default_value = (*col, 1)
    rough = dict(stone=0.92, trim=0.88, metal=0.45, glow=0.5, organic=0.85, accent=0.55 if pal["emit_accent"] < 1 else 0.18, surface=0.4)[slot]
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = 0.85 if slot == "metal" else 0.0
    if slot == "metal" and vname in ("orchard", "mushroom", "quarry", "kitchen", "sky"):
        bsdf.inputs["Metallic"].default_value = 0.6
    if slot in ("stone", "trim", "organic", "metal", "accent"):
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        mix.inputs[7].default_value = (*col, 1)
        nt.links.new(vc.outputs["Color"], mix.inputs[6])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    emit = 0.0
    if slot == "glow":
        emit = 2.2
    if slot == "accent":
        emit = pal["emit_accent"]
    if slot == "surface":
        emit = 2.0
        bsdf.inputs["Base Color"].default_value = (0, 0, 0, 1)
    if emit > 0:
        bsdf.inputs["Emission Color"].default_value = (*col, 1)
        bsdf.inputs["Emission Strength"].default_value = emit
    if slot == "surface":
        m.blend_method = "BLEND"
        bsdf.inputs["Alpha"].default_value = 0.8
    return m


def proceduralise_surface(mat, pal, cz=1.2):
    """Editor/render-only look approximating portal_surface.gdshader (not exported)."""
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    N = nt.nodes.new; L = nt.links.new
    out = N("ShaderNodeOutputMaterial"); em = N("ShaderNodeEmission"); tr = N("ShaderNodeBsdfTransparent"); mixs = N("ShaderNodeMixShader")
    vc = N("ShaderNodeVertexColor"); vc.layer_name = "Col"
    sep = N("ShaderNodeSeparateColor"); tc = N("ShaderNodeTexCoord")
    mp = N("ShaderNodeMapping"); mp.inputs["Location"].default_value = (0, 0, -cz)
    wave = N("ShaderNodeTexWave"); wave.wave_type = "RINGS"
    wave.inputs["Scale"].default_value = 2.6; wave.inputs["Distortion"].default_value = 7.0; wave.inputs["Detail"].default_value = 2.0
    noi = N("ShaderNodeTexNoise"); noi.inputs["Scale"].default_value = 3.0; noi.inputs["Detail"].default_value = 3
    mixc = N("ShaderNodeMath"); mixc.operation = "ADD"
    ramp = N("ShaderNodeValToRGB")
    edge = srgb2lin(hexc(pal["glow"]))
    deep = tuple(c * 0.5 for c in edge); core = tuple(min(1.0, c * 1.0 + 0.16) for c in edge)
    ramp.color_ramp.elements[0].position = 0.0; ramp.color_ramp.elements[0].color = (*deep, 1)
    ramp.color_ramp.elements[1].position = 0.95; ramp.color_ramp.elements[1].color = (*core, 1)
    m2 = ramp.color_ramp.elements.new(0.6); m2.color = (*edge, 1)
    rim = N("ShaderNodeMath"); rim.operation = "SUBTRACT"; rim.inputs[0].default_value = 1.0
    st = N("ShaderNodeMath"); st.operation = "MULTIPLY_ADD"; st.inputs[1].default_value = 1.6; st.inputs[2].default_value = 0.35
    fa = N("ShaderNodeMath"); fa.operation = "MULTIPLY_ADD"; fa.inputs[1].default_value = 0.4; fa.inputs[2].default_value = 0.5
    L(tc.outputs["Object"], mp.inputs["Vector"]); L(mp.outputs["Vector"], wave.inputs["Vector"]); L(mp.outputs["Vector"], noi.inputs["Vector"])
    L(vc.outputs["Color"], sep.inputs["Color"])
    L(wave.outputs["Fac"], mixc.inputs[0]); L(noi.outputs["Fac"], mixc.inputs[1])
    mixc.use_clamp = True
    L(mixc.outputs["Value"], ramp.inputs["Fac"]); L(ramp.outputs["Color"], em.inputs["Color"])
    L(sep.outputs["Red"], rim.inputs[1]); L(rim.outputs["Value"], st.inputs[0]); L(st.outputs["Value"], em.inputs["Strength"])
    L(rim.outputs["Value"], fa.inputs[0]); L(fa.outputs["Value"], mixs.inputs[0])
    L(tr.outputs[0], mixs.inputs[1]); L(em.outputs[0], mixs.inputs[2]); L(mixs.outputs[0], out.inputs["Surface"])


# ---------------------------------------------------------------- piece builder
class Ctx:
    def __init__(self, vname, pal_key, seed, parent_collection):
        self.v = vname
        self.pal = PAL[pal_key]
        self.rng = random.Random(seed)
        self.seed = seed
        self.mats = [make_mat(vname, s, self.pal) for s in SLOTS]
        self.col = bpy.data.collections.new("Portal_" + vname.capitalize())
        parent_collection.children.link(self.col)
        self.root = bpy.data.objects.new("%s__Portal_%s" % (vname, vname.capitalize()), None)
        self.col.objects.link(self.root)
        self.near = self.empty("Near", self.root)
        self.far = self.empty("Far", self.root)

    def empty(self, name, parent, loc=(0, 0, 0), display="PLAIN_AXES"):
        o = bpy.data.objects.new("%s__%s" % (self.v, name), None)
        o.empty_display_type = display
        o.empty_display_size = 0.15
        o.location = loc
        o.parent = parent
        self.col.objects.link(o)
        return o

    def piece(self, name, parent=None):
        return Piece(self, name, parent or self.near)


class Piece:
    def __init__(self, ctx, name, parent):
        self.c, self.name, self.parent = ctx, name, parent
        self.bm = bmesh.new()
        self.lay = self.bm.loops.layers.color.new("Col")
        self.rng = ctx.rng

    def _mark(self):
        for v in self.bm.verts: v.tag = True
        for f in self.bm.faces: f.tag = True
        return None

    def _fin(self, n0, f0, M, mat, tone, jit, ao=True, vary=0.12):
        bm = self.bm
        vs = [v for v in bm.verts if not v.tag]
        fs = [f for f in bm.faces if not f.tag]
        bmesh.ops.transform(bm, matrix=M, verts=vs)
        if jit:
            s = self.c.seed * 0.137
            for v in vs:
                d = noise.noise_vector(v.co * 3.3 + Vector((s, s * 0.7, s * 1.3)))
                v.co += d * jit
        idx = SLOTS.index(mat)
        for f in fs:
            f.material_index = idx
            cen = f.calc_center_median()
            n = noise.noise(cen * 2.3 + Vector((self.c.seed * 0.31, 1.7, 0.4)))
            t = 1.0 + vary * n + self.rng.uniform(-0.04, 0.04)
            if ao:
                t *= 0.68 + 0.32 * max(0.0, min(1.0, cen.z / 1.1))
            col = tuple(min(1.0, x * t) for x in (tone if isinstance(tone, tuple) else (tone,) * 3))
            for l in f.loops:
                l[self.lay] = (*col, 1.0)

    def _mat(self, c, rot, sc):
        R = rot.to_matrix().to_4x4() if hasattr(rot, "to_matrix") else Euler(rot).to_matrix().to_4x4()
        return Matrix.Translation(c) @ R @ Matrix.Diagonal((*sc, 1.0))

    def box(self, c, s, rot=(0, 0, 0), mat="stone", tone=0.9, cuts=1, jit=0.02, taper=None, ao=True):
        bm = self.bm
        n0, f0 = self._mark(), None
        g = bmesh.ops.create_cube(bm, size=1.0)
        if cuts:
            edges = list({e for v in g["verts"] for e in v.link_edges})
            bmesh.ops.subdivide_edges(bm, edges=edges, cuts=cuts, use_grid_fill=True)
        if taper is not None:  # scale top (z>0) in XY by taper
            for v in [v for v in bm.verts if not v.tag]:
                k = 1.0 + (taper - 1.0) * (v.co.z + 0.5)
                v.co.x *= k; v.co.y *= k
        self._fin(n0, f0, self._mat(Vector(c), Vector(rot) if False else Euler(rot), s), mat, tone, jit, ao)

    def cyl(self, c, r1, r2, h, seg=8, rot=(0, 0, 0), mat="stone", tone=0.9, jit=0.0, sc=(1, 1, 1), ao=True, cap=True):
        bm = self.bm
        n0, f0 = self._mark(), None
        bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
        self._fin(n0, f0, self._mat(Vector(c), rot if hasattr(rot, "to_matrix") else Euler(rot), sc), mat, tone, jit, ao)

    def ico(self, c, r, sc=(1, 1, 1), sub=1, rot=(0, 0, 0), mat="organic", tone=0.9, jit=0.04, ao=True, vary=0.18):
        bm = self.bm
        n0, f0 = self._mark(), None
        bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
        self._fin(n0, f0, self._mat(Vector(c), Euler(rot), sc), mat, tone, jit, ao, vary)

    def bar(self, a, b, r, seg=5, mat="organic", tone=0.8, jit=0.0, ao=True):
        a, b = Vector(a), Vector(b)
        d = b - a
        q = Vector((0, 0, 1)).rotation_difference(d.normalized())
        self.cyl((a + b) / 2, r, r, d.length, seg, q, mat, tone, jit, ao=ao)

    def crystal(self, base, direction, length, r, mat="accent", tone=0.95, seg=6, ao=False):
        d = Vector(direction).normalized()
        q = Vector((0, 0, 1)).rotation_difference(d)
        base = Vector(base)
        self.cyl(base + d * (length * 0.36), r, r * 0.92, length * 0.72, seg, q, mat, tone * 0.85, 0.0, ao=ao, cap=True)
        self.cyl(base + d * (length * 0.72 + length * 0.14), r * 0.92, 0.0, length * 0.28, seg, q, mat, tone, 0.0, ao=ao, cap=False)

    def done(self, origin=(0, 0, 0), parent=None):
        me = bpy.data.meshes.new("%s__%s" % (self.c.v, self.name))
        self.bm.to_mesh(me); self.bm.free()
        for p in me.polygons:
            p.use_smooth = False
        for m in self.c.mats:
            me.materials.append(m)
        me.transform(Matrix.Translation(-Vector(origin)))
        o = bpy.data.objects.new("%s__%s" % (self.c.v, self.name), me)
        o.location = origin
        o.parent = parent or self.parent
        self.c.col.objects.link(o)
        return o


# ---------------------------------------------------------------- apertures + surface
def outline_round(hw=0.7, zb=0.14, zs=1.6):
    pts = [(hw, zb), (hw, zs)]
    for i in range(1, 12):
        a = math.pi * i / 12
        pts.append((hw * math.cos(a), zs + hw * math.sin(a)))
    pts += [(-hw, zs), (-hw, zb)]
    return pts


def outline_rect(hw=0.63, zb=0.14, zt=2.3, ch=0.28):
    return [(hw, zb), (hw, zt - ch), (hw - ch, zt), (-hw + ch, zt), (-hw, zt - ch), (-hw, zb)]


def outline_lancet(hw=0.65, zb=0.14, zs=1.3):
    R = 2 * hw
    pts = [(hw, zb), (hw, zs)]
    for i in range(1, 8):  # right arc: centre (-hw, zs), theta 0 -> 60
        t = math.radians(60 * i / 8)
        pts.append((-hw + R * math.cos(t), zs + R * math.sin(t)))
    pts.append((0, zs + R * math.sin(math.radians(60))))
    for i in range(7, 0, -1):
        t = math.radians(60 * i / 8)
        pts.append((hw - R * math.cos(t), zs + R * math.sin(t)))
    pts += [(-hw, zs), (-hw, zb)]
    return pts


OUTLINES = {"orchard": outline_round, "quarry": outline_rect, "crystal": outline_lancet, "foundry": lambda: outline_rect(0.66, 0.14, 2.29, 0.3)}


def surface_piece(ctx, family, name, rings, parent):
    pts = OUTLINES[family]()
    xs = [p[0] for p in pts]; zs = [p[1] for p in pts]
    cx, cz = 0.0, (min(zs) + max(zs)) / 2
    hw, hh = (max(xs) - min(xs)) / 2, (max(zs) - min(zs)) / 2
    bm = bmesh.new()
    lay = bm.loops.layers.color.new("Col")
    uvl = bm.loops.layers.uv.new("UVMap")
    grow = 1.04
    ring_v = []
    for k in range(rings + 1):
        s = grow * (1 - k / rings)
        ring_v.append([bm.verts.new((cx + (x - cx) * s, 0.0, cz + (z - cz) * s)) for x, z in pts])
    n = len(pts)
    centre = ring_v[-1][0]

    def paint(f, ks):
        for l, k in zip(f.loops, ks):
            l[lay] = (k / rings, 1, 1, 1)
            l[uvl].uv = ((l.vert.co.x - cx) / (2 * hw) + 0.5, (l.vert.co.z - cz) / (2 * hh) + 0.5)
    for k in range(rings - 1):
        for i in range(n):
            j = (i + 1) % n
            f = bm.faces.new((ring_v[k][i], ring_v[k][j], ring_v[k + 1][j], ring_v[k + 1][i]))
            paint(f, (k, k, k + 1, k + 1))
    for i in range(n):
        j = (i + 1) % n
        f = bm.faces.new((ring_v[rings - 1][i], ring_v[rings - 1][j], centre))
        paint(f, (rings - 1, rings - 1, rings))
    me = bpy.data.meshes.new("%s__%s" % (ctx.v, name))
    bm.to_mesh(me); bm.free()
    me.materials.append(ctx.mats[SLOTS.index("surface")])
    o = bpy.data.objects.new("%s__%s" % (ctx.v, name), me)
    o.parent = parent
    ctx.col.objects.link(o)
    return o, cz, (hw, hh)


# ---------------------------------------------------------------- families
def base_slab(P, half_w=1.25, tone=0.85, mat="stone"):
    P.box((0, 0.025, 0.07), (half_w * 2, 0.75, 0.14), mat=mat, tone=tone, cuts=2, jit=0.015)
    P.box((0, -0.475, 0.035), (half_w * 1.5, 0.25, 0.07), mat=mat, tone=tone * 0.92, cuts=2, jit=0.015)


def build_orchard(cx, opt):
    P = cx.piece("Base")
    P.cyl((0, 0.02, 0.07), 1.2, 1.1, 0.14, 10, mat="stone", tone=0.85, jit=0.03, sc=(1, 0.42, 1))
    for i, (x, y) in enumerate([(-0.45, -0.42), (0.1, -0.5), (0.6, -0.4)]):
        P.ico((x, y, 0.03), 0.22, sc=(1, 0.8, 0.22), sub=1, mat="stone", tone=0.8, jit=0.02)
    for i in range(12):
        a = math.tau * i / 12 + 0.2
        x, y = 1.1 * math.cos(a), 0.46 * math.sin(a)
        if abs(x) < 0.75 and y < 0: continue
        P.cyl((x, y, 0.2), 0.05, 0.0, 0.26, 3, (0.15 * math.cos(a), 0.15 * math.sin(a), 0), mat="organic", tone=0.9, ao=False)
    P.done()
    # pillars: stacked hand-set blocks
    for side, nm in ((-1, "Pillar_L"), (1, "Pillar_R")):
        P = cx.piece(nm)
        z = 0.14
        for i in range(4):
            h = 0.365
            P.box((side * 0.95 + cx.rng.uniform(-0.03, 0.03), cx.rng.uniform(-0.02, 0.02), z + h / 2), (0.5 - 0.015 * i, 0.55, h - 0.015), mat="stone", tone=0.88, cuts=2, jit=0.03)
            z += h
        P.done()
    P = cx.piece("Arch")
    N = 9
    for i in range(N):
        th = math.pi * (i + 0.5) / N
        r = 0.95
        key = (i == N // 2)
        P.box((r * math.cos(th), 0, 1.6 + r * math.sin(th)), (0.32, 0.56, 0.5 + (0.1 if key else 0)),
              (0, math.pi / 2 - th, 0), mat="stone", tone=0.9 if not key else 1.0, cuts=2, jit=0.025)
    P.done()
    P = cx.piece("Motif_KeystoneGem")
    P.ico((0, -0.3, 2.66), 0.11, (1, 0.6, 1.3), sub=1, mat="glow", tone=1.0, jit=0.0, ao=False)
    P.done()
    P = cx.piece("Motif_Roots")
    for side in (-1, 1):
        for j, (dx, ang) in enumerate([(0.2, 62), (0.0, 78), (-0.25, 50)]):
            a = math.radians(ang)
            d = Vector((side * math.cos(a), (j - 1) * 0.5, math.sin(a) * -0.05 + 0.02)).normalized()
            base = Vector((side * (0.95 + dx * 0.4), -0.15 + j * 0.15, 0.2))
            P.bar(base, base + d * 0.3 + Vector((0, 0, -0.1)), 0.075, 5, mat="trim", tone=0.8, jit=0.02)
    P.done()
    P = cx.piece("Motif_Vines")
    for side in (-1, 1):
        prev = None
        for i in range(21):
            t = i / 20
            a = t * 9.0 * (1 if side > 0 else -1)
            p = Vector((side * 0.95 + 0.3 * math.cos(a), 0.31 * math.sin(a), 0.2 + t * 1.55))
            if prev is not None:
                P.bar(prev, p, 0.024, 4, mat="organic", tone=0.55)
            if i % 2 == 1:
                d = Vector((math.cos(a), math.sin(a), 0.3))
                P.cyl(p + d * 0.06, 0.07, 0.0, 0.16, 4, (0, 0, 0) if False else Vector((0, 0, 1)).rotation_difference(d), mat="organic", tone=0.95, sc=(1, 0.35, 1), ao=False)
            prev = p
    P.done()
    if opt.get("caps"):
        P = cx.piece("Motif_MushroomCaps")
        for (x, z, r, sc_) in [(-0.9, 2.62, 0.4, 1.0), (0.95, 2.5, 0.34, 0.9), (-0.32, 2.86, 0.2, 0.8), (0.36, 2.88, 0.19, 0.75)]:
            P.cyl((x, 0, z - r * 0.7), 0.1, 0.13, r * 1.2, 6, mat="accent", tone=0.95, ao=False)
            P.ico((x, 0, z), r, (1, 1, 0.55), sub=1, mat="organic", tone=0.95, jit=0.03, ao=False)
            for k in range(4):
                a = k * 1.6 + x
                P.ico((x + r * 0.6 * math.cos(a), r * 0.6 * math.sin(a), z + r * 0.34), r * 0.14, (1, 1, 0.5), sub=0, mat="accent", tone=1.0, jit=0.0, ao=False)
        P.done()
    else:
        P = cx.piece("Motif_Canopy")
        for (x, y, z, r) in [(-0.9, 0.0, 2.55, 0.34), (0.92, 0.02, 2.45, 0.32), (-0.45, 0.05, 2.86, 0.27), (0.45, 0.0, 2.9, 0.26), (0.0, 0.22, 2.95, 0.2)]:
            P.ico((x, y, z), r, (1, 1.05, 0.8), sub=1, mat="organic", tone=cx.rng.uniform(0.78, 1.0), jit=0.06, ao=False, vary=0.25)
        for i in range(26):
            th = cx.rng.uniform(0.3, 2.85)
            r = 1.2 + cx.rng.uniform(-0.05, 0.05)
            p = Vector((r * math.cos(th), -0.28 + cx.rng.uniform(-0.05, 0.05), 1.6 + r * math.sin(th)))
            P.cyl(p, 0.07, 0.0, 0.17, 4, (cx.rng.uniform(-1, 1), cx.rng.uniform(-1, 1), cx.rng.uniform(0, 3)), mat="organic", tone=cx.rng.uniform(0.7, 1.0), sc=(1, 0.35, 1), ao=False)
        P.done()
        P = cx.piece("Motif_Apples")
        for (x, z) in [(-0.72, 2.18), (0.8, 2.36), (-1.0, 1.55), (0.3, 2.85), (-0.3, 2.9)]:
            P.ico((x, -0.32, z), 0.065, sub=1, mat="accent", tone=1.0, jit=0.0, ao=False)
        P.done()
    # far LOD
    P = cx.piece("Far_Body", cx.far)
    P.cyl((0, 0.02, 0.07), 1.2, 1.1, 0.14, 6, sc=(1, 0.75, 1), tone=0.85)
    for s in (-1, 1):
        P.box((s * 0.95, 0, 0.87), (0.5, 0.55, 1.46), cuts=0, jit=0)
    for i in range(6):
        th = math.pi * (i + 0.5) / 6
        P.box((0.95 * math.cos(th), 0, 1.6 + 0.95 * math.sin(th)), (0.52, 0.56, 0.5), (0, math.pi / 2 - th, 0), cuts=0, jit=0)
    for (x, z, r) in [(-0.9, 2.55, 0.4), (0.9, 2.5, 0.38), (0, 2.9, 0.34)]:
        P.ico((x, 0, z), r, (1, 1, 0.8), sub=0, mat="accent" if opt.get("caps") else "organic", jit=0.02, ao=False)
    P.done()


def build_quarry(cx, opt):
    P = cx.piece("Base")
    base_slab(P, 1.25, 0.85)
    for i in range(7):
        a = cx.rng.uniform(0, math.tau)
        x = (1.05 + cx.rng.uniform(0, 0.15)) * (1 if i % 2 else -1)
        P.box((x, cx.rng.uniform(-0.55, 0.3), 0.1), (cx.rng.uniform(0.14, 0.3),) * 3, (0, 0, a), tone=0.8, cuts=0, jit=0.03)
    P.done()
    heights = [0.4, 0.34, 0.46, 0.36, 0.3, 0.3]
    for side, nm in ((-1, "Pillar_L"), (1, "Pillar_R")):
        P = cx.piece(nm)
        z = 0.14
        for i, h in enumerate(heights):
            w = 0.6 + cx.rng.uniform(-0.05, 0.03)
            P.box((side * 0.93 + cx.rng.uniform(-0.03, 0.03), cx.rng.uniform(-0.03, 0.03), z + h / 2), (w, 0.56 + cx.rng.uniform(-0.03, 0.03), h - 0.012), mat="stone" if i % 2 == 0 else "trim", tone=0.9, cuts=2, jit=0.02)
            z += h
        P.done()
    P = cx.piece("Lintel")
    P.box((0, 0, 2.525), (2.5, 0.7, 0.45), mat="stone", tone=0.95, cuts=3, jit=0.025)
    if not opt.get("pots"):
        P.box((0, 0, 2.81), (2.3, 0.6, 0.12), mat="trim", tone=0.85, cuts=2, jit=0.025)
    for s in (-1, 1):
        P.box((s * 0.49, 0, 2.14), (0.52, 0.56, 0.16), (0, s * math.radians(45), 0), mat="trim", tone=0.85, cuts=1, jit=0.02)
    for i in range(11):
        P.box((-1.0 + i * 0.2, -0.355, 2.68), (0.05, 0.02, 0.09), mat="trim", tone=0.45, cuts=0, jit=0.0, ao=False)
    P.done()
    P = cx.piece("Motif_GoldVein")
    for s in (-1, 1):
        zz = [0.35, 0.75, 1.1, 1.55, 1.95]
        xx = [0.0, 0.16, -0.08, 0.12, 0.0]
        for i in range(4):
            P.bar((s * 0.93 + xx[i], -0.295, zz[i]), (s * 0.93 + xx[i + 1], -0.295, zz[i + 1]), 0.022, 4, mat="glow", tone=1.0, ao=False)
    P.bar((-1.0, -0.365, 2.36), (1.0, -0.365, 2.36), 0.025, 4, mat="glow", tone=1.0, ao=False)
    P.done()
    P = cx.piece("Motif_Pick")
    for s in (-1, 1):
        a = s * math.radians(38)
        c = Vector((0, -0.38, 2.55))
        d = Vector((math.sin(a), 0, math.cos(a)))
        P.bar(c - d * 0.4, c + d * 0.4, 0.028, 5, mat="organic", tone=0.8, ao=False)
        head = c + d * 0.4
        P.box(head, (0.3, 0.05, 0.06), (0, -a, 0), mat="metal", tone=0.7, cuts=0, jit=0.0, ao=False)
    P.done()
    P = cx.piece("Motif_Scaffold")
    P.box((-1.18, -0.05, 1.35), (0.13, 0.13, 2.6), (0, math.radians(-2), 0), mat="organic", tone=0.75, cuts=2, jit=0.01)
    P.bar((-1.15, -0.05, 2.0), (-0.6, -0.42, 2.72), 0.055, 5, mat="organic", tone=0.7)
    P.bar((-0.62, -0.42, 2.7), (-0.62, -0.42, 2.25), 0.012, 4, mat="metal", tone=0.6)
    P.ico((-0.62, -0.42, 2.18), 0.07, (1, 1, 1.2), sub=1, mat="glow", tone=1.0, jit=0, ao=False)
    P.done()
    P = cx.piece("Motif_GoldNuggets")
    for i, (x, y) in enumerate([(1.02, -0.4), (1.12, -0.25), (0.92, -0.32), (1.08, -0.5)]):
        P.ico((x, y, 0.1), 0.06 + 0.02 * (i % 2), sub=0, mat="accent", tone=1.0, jit=0.01, ao=False)
    P.done()
    if opt.get("wings"):
        P = cx.piece("Motif_CloudWings")
        for s in (-1, 1):
            for j in range(5):
                a = math.radians(15 + j * 17)
                d = Vector((s * math.cos(a), 0, math.sin(a)))
                st = Vector((s * 0.98, -0.34, 2.72 if not opt.get("pots") else 2.7)) + Vector((0, 0.0, 0.0))
                P.box(st + d * 0.16, (0.42 - j * 0.03, 0.03, 0.09), (0, -s * a, 0), mat="organic", tone=0.98 - j * 0.02, cuts=0, jit=0.005, ao=False)
        P.done()
    if opt.get("pots"):
        P = cx.piece("Motif_CopperPots")
        for s in (-1, 1):
            P.cyl((s * 0.9, 0, 2.87), 0.2, 0.26, 0.24, 9, mat="metal", tone=0.95, ao=False)
            P.cyl((s * 0.9, 0, 3.015), 0.24, 0.0, 0.06, 9, mat="accent", tone=1.0, ao=False)
            for h in (-1, 1):
                P.bar((s * 0.9 + h * 0.26, 0, 2.9), (s * 0.9 + h * 0.34, 0, 2.95), 0.02, 4, mat="metal", tone=0.9, ao=False)
        P.done()
    P = cx.piece("Far_Body", cx.far)
    P.box((0, 0.02, 0.07), (2.5, 0.75, 0.14), cuts=0, jit=0)
    for s in (-1, 1):
        P.box((s * 0.93, 0, 1.22), (0.6, 0.56, 2.16), cuts=0, jit=0, tone=0.9)
    P.box((0, 0, 2.525), (2.5, 0.7, 0.45), cuts=0, jit=0)
    P.done()


def build_crystal(cx, opt):
    rng = cx.rng
    P = cx.piece("Base")
    P.ico((0, 0.02, 0.0), 1.2, (1.02, 0.42, 0.12), sub=2, mat="organic", tone=0.8, jit=0.025)
    for (x, y, r) in [(-1.0, -0.35, 0.22), (1.05, -0.3, 0.2), (-0.7, 0.35, 0.28), (0.85, 0.35, 0.3), (-1.15, 0.0, 0.18), (0.3, -0.55, 0.12)]:
        P.ico((x, y, r * 0.3), r, (1, 1, 0.7), sub=1, mat="organic", tone=0.75, jit=0.06)
    P.done()
    for side, nm in ((-1, "Pillar_L"), (1, "Pillar_R")):
        P = cx.piece(nm)
        z = 0.1
        for i, (w, h) in enumerate([(0.62, 0.7), (0.52, 0.6), (0.42, 0.55)]):
            P.box((side * (0.98 + 0.03 * i) + rng.uniform(-0.03, 0.03), rng.uniform(-0.03, 0.03), z + h / 2), (w, 0.5, h), (0, side * 0.12, rng.uniform(-0.2, 0.2)), mat="organic", tone=0.85, cuts=2, jit=0.06)
            z += h * 0.9
        P.done()
    P = cx.piece("Arch_Crystals")
    hw = 0.65; R = 2 * hw; zs = 1.3
    for side in (-1, 1):
        # vertical jamb shards
        for i, zz in enumerate([0.2, 0.62, 0.98]):
            P.crystal((side * (hw + 0.13 + rng.uniform(-0.02, 0.02)), rng.uniform(-0.1, 0.1), zz), (0.0, 0.0, 1.0), 0.55, 0.115 - i * 0.008, "accent", 0.9 + 0.03 * i)
        # arc shards, inner row and larger outer row
        for row, (off, rad, ln) in enumerate([(0.14, 0.105, 0.5), (0.32, 0.13, 0.6)]):
            for i in range(5 + row):
                t = math.radians(60 * (i + 0.2) / (5 + row))
                px, pz = -hw + R * math.cos(t), zs + R * math.sin(t)
                nrm = Vector((math.cos(t), 0, math.sin(t)))
                tang = Vector((-math.sin(t), 0, math.cos(t)))
                d = (tang * 1.0 + nrm * (0.25 + 0.5 * row) + Vector((0, rng.uniform(-0.15, 0.15), 0))).normalized()
                p = Vector((side * (px + nrm.x * off), rng.uniform(-0.12, 0.12), pz + nrm.z * off))
                dd = Vector((side * d.x, d.y, d.z))
                P.crystal(p - dd * 0.1, dd, ln, rad * (1 + rng.uniform(-0.1, 0.1)), "accent", 0.86 + 0.14 * row)
    P.done()
    P = cx.piece("Motif_Apex")
    P.crystal((0, 0.0, 2.35), (0, 0, 1), 0.72, 0.16, "accent", 1.0)
    P.crystal((0.14, -0.06, 2.4), (0.35, -0.1, 1), 0.5, 0.1, "accent", 0.95)
    P.crystal((-0.14, 0.05, 2.38), (-0.4, 0.1, 1), 0.42, 0.09, "accent", 0.92)
    P.done()
    P = cx.piece("Motif_GroundClusters")
    for (x, y, n) in [(-1.12, -0.42, 3), (1.15, -0.4, 3), (-0.35, -0.6, 2), (0.6, -0.62, 2)]:
        for k in range(n):
            ang = rng.uniform(-0.5, 0.5)
            P.crystal((x + k * 0.1 - 0.1, y + rng.uniform(-0.05, 0.05), 0.06), (math.sin(ang), rng.uniform(-0.3, 0.1), 1.0), 0.28 + 0.1 * k, 0.05 + 0.012 * k, "accent", 0.9)
    P.done()
    for i, (x, y, z) in enumerate([(-1.05, -0.25, 2.55), (1.0, -0.2, 2.35), (0.0, -0.45, 2.98)]):
        P = cx.piece("Motif_FloatShard_%d" % (i + 1))
        P.cyl((x, y, z), 0.09, 0.0, 0.16, 4, mat="accent", tone=1.0, ao=False)
        P.cyl((x, y, z - 0.16), 0.0, 0.09, 0.16, 4, mat="accent", tone=0.9, ao=False)
        P.done(origin=(x, y, z - 0.08))
    P = cx.piece("Far_Body", cx.far)
    P.ico((0, 0.02, 0.0), 1.2, (1.02, 0.42, 0.12), sub=1, mat="organic", jit=0.0)
    for s in (-1, 1):
        P.box((s * 0.98, 0, 0.8), (0.55, 0.5, 1.4), (0, s * 0.12, 0), mat="organic", cuts=0, jit=0)
        for i in range(3):
            t = math.radians(60 * (i + 0.3) / 3)
            px, pz = -hw + R * math.cos(t), zs + R * math.sin(t)
            P.crystal((s * (px + 0.12), 0, pz), (-s * math.sin(t) * -1, 0, math.cos(t)), 0.7, 0.16, "accent", 0.95, seg=4)
    P.crystal((0, 0, 2.35), (0, 0, 1), 0.7, 0.16, "accent", 1.0, seg=4)
    P.done()


def build_foundry(cx, opt):
    rng = cx.rng
    P = cx.piece("Base")
    base_slab(P, 1.25, 0.8)
    for x in (-0.3, 0.0, 0.3):
        P.box((x, -0.475, 0.075), (0.1, 0.16, 0.012), mat="glow", tone=1.0, cuts=0, jit=0, ao=False)
    P.bar((-1.1, 0.25, 0.145), (-0.72, 0.3, 0.145), 0.014, 4, mat="glow", ao=False)
    P.bar((1.1, 0.25, 0.145), (0.75, 0.32, 0.145), 0.014, 4, mat="glow", ao=False)
    P.done()
    for side, nm in ((-1, "Pillar_L"), (1, "Pillar_R")):
        P = cx.piece(nm)
        z = 0.14
        for i, h in enumerate([0.85, 0.75, 0.9]):
            P.box((side * 0.95, 0, z + h / 2), (0.58 - 0.02 * i, 0.56, h - 0.02), mat="stone", tone=0.85, cuts=2, jit=0.02)
            z += h
        for bz in (0.55, 1.35, 2.2):
            P.box((side * 0.95, 0, bz), (0.66, 0.62, 0.11), mat="metal", tone=0.7, cuts=1, jit=0.005)
            for rx in (-0.27, 0.27):
                P.cyl((side * 0.95 + rx, -0.325, bz), 0.035, 0.028, 0.03, 6, (math.pi / 2, 0, 0), mat="metal", tone=1.0, ao=False)
        P.box((side * 0.95, -0.292, 1.35), (0.07, 0.02, 0.85), mat="glow", tone=1.0, cuts=0, jit=0, ao=False)
        P.cyl((side * 0.95, 0, 2.79), 0.24, 0.19, 0.3, 8, mat="trim", tone=0.75, jit=0.01)
        P.cyl((side * 0.95, 0, 2.95), 0.2, 0.2, 0.03, 8, mat="glow", tone=1.0, ao=False)
        P.done()
    P = cx.piece("Lintel")
    P.box((0, 0, 2.47), (1.5, 0.6, 0.36), mat="stone", tone=0.85, cuts=2, jit=0.02)
    P.box((0, -0.05, 2.68), (1.3, 0.66, 0.06), mat="metal", tone=0.75, cuts=1, jit=0.005)
    for s in (-1, 1):
        P.box((s * 0.51, 0, 2.14), (0.56, 0.56, 0.15), (0, s * math.radians(45), 0), mat="metal", tone=0.65, cuts=1, jit=0.005)
        P.cyl((s * 0.51, -0.29, 2.14), 0.04, 0.03, 0.03, 6, (math.pi / 2, 0, 0), mat="glow", tone=1.0, ao=False)
    P.done()
    P = cx.piece("Motif_Gear")
    gz = 2.56
    P.cyl((0, -0.36, gz), 0.36, 0.36, 0.1, 12, (math.pi / 2, 0, 0), mat="metal", tone=0.7, ao=False)
    for i in range(10):
        a = math.tau * i / 10
        P.box((0.4 * math.cos(a), -0.36, gz + 0.4 * math.sin(a)), (0.13, 0.1, 0.13), (0, -a, 0), mat="metal", tone=0.65, cuts=0, jit=0, ao=False)
    P.cyl((0, -0.42, gz), 0.17, 0.17, 0.05, 10, (math.pi / 2, 0, 0), mat="glow", tone=1.0, ao=False)
    P.done(origin=(0, -0.36, gz))
    P = cx.piece("Motif_Braziers")
    for s in (-1, 1):
        P.cyl((s * 1.08, -0.52, 0.08), 0.15, 0.2, 0.16, 7, mat="trim", tone=0.7)
        P.ico((s * 1.08, -0.52, 0.2), 0.12, (1, 1, 0.7), sub=1, mat="accent", tone=1.0, jit=0.03, ao=False)
    P.done()
    P = cx.piece("Motif_Chains")
    for s in (-1, 1):
        prev = None
        for i in range(9):
            t = i / 8
            p = Vector((s * (0.95 - 0.95 * 0.0) - s * 0.5 * t, -0.34, 2.72 - 0.16 * math.sin(math.pi * t) * -1 - 0.0 * t))
            if prev is not None and i % 1 == 0:
                P.box((p + prev) / 2, (0.05, 0.03, 0.07), (0, 0, 0), mat="metal", tone=0.6, cuts=0, jit=0, ao=False)
            prev = p
    P.done()
    P = cx.piece("Far_Body", cx.far)
    P.box((0, 0.02, 0.07), (2.5, 0.75, 0.14), cuts=0, jit=0)
    for s in (-1, 1):
        P.box((s * 0.95, 0, 1.4), (0.6, 0.56, 2.52), cuts=0, jit=0, tone=0.8)
        P.cyl((s * 0.95, 0, 2.95), 0.22, 0.2, 0.42, 6, mat="glow", ao=False)
    P.box((0, 0, 2.47), (1.5, 0.6, 0.36), cuts=0, jit=0, tone=0.8)
    P.cyl((0, -0.36, 2.62), 0.4, 0.4, 0.1, 8, (math.pi / 2, 0, 0), mat="metal", ao=False)
    P.done()


FAMILY = {"orchard": build_orchard, "quarry": build_quarry, "crystal": build_crystal, "foundry": build_foundry}
SEEDS = {"orchard": 11, "quarry": 23, "crystal": 37, "foundry": 51, "mushroom": 13, "sky": 29, "kitchen": 31}


def build_variant(vname, parent_collection):
    family, pal_key, opt = VARIANTS[vname]
    cx = Ctx(vname, pal_key, SEEDS[vname], parent_collection)
    FAMILY[family](cx, opt)
    so, cz, _ = surface_piece(cx, family, "Surface_Near", 5, cx.near)
    sf, _, _ = surface_piece(cx, family, "Surface_Far", 1, cx.far)
    cx.empty("FX_SurfaceCenter", cx.root, (0, 0, cz))
    cx.empty("FX_MoteEmitter", cx.root, (0, -0.1, cz))
    cx.empty("FX_Light", cx.root, (0, -0.85, cz - 0.1), "SPHERE")
    cx.empty("FX_ExitBurst", cx.root, (0, -0.12, cz))
    cx.empty("FX_Threshold", cx.root, (0, -0.45, 0.0))
    cx.pal_key = pal_key
    cx.family = family
    return cx


# ---------------------------------------------------------------- stats / export
def descendants(o):
    out = [o]
    for c in o.children:
        out += descendants(c)
    return out


def tri_count(objs):
    t = 0
    for o in objs:
        if o.type == "MESH":
            t += sum(len(p.vertices) - 2 for p in o.data.polygons)
    return t


def bounds(objs):
    mn = Vector((1e9,) * 3); mx = Vector((-1e9,) * 3)
    for o in objs:
        if o.type != "MESH": continue
        for b in o.bound_box:
            w = o.matrix_world @ Vector(b)
            mn = Vector(map(min, mn, w)); mx = Vector(map(max, mx, w))
    return mn, mx


@contextlib.contextmanager
def stripped_names(cx):
    objs = descendants(cx.root)
    prefix = cx.v + "__"
    saved = []
    for o in objs:
        saved.append((o, o.name, o.data.name if o.data else None))
    for o in objs:
        o.name = o.name[len(prefix):]
        if o.data: o.data.name = o.name
    try:
        yield objs
    finally:
        for o, n, dn in saved:
            o.name = n
            if o.data: o.data.name = dn


def export_glb(cx, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with stripped_names(cx) as objs:
        bpy.ops.object.select_all(action="DESELECT")
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = cx.root
        kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True,
                  export_cameras=False, export_lights=False, export_extras=False, export_image_format="AUTO")
        try:
            bpy.ops.export_scene.gltf(export_vertex_color="ACTIVE", export_active_vertex_color_when_no_material=True, **kw)
        except TypeError:
            bpy.ops.export_scene.gltf(**kw)


# ---------------------------------------------------------------- render scene
def set_engine(scene):
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = eng
            return
        except TypeError:
            continue


def new_scene_world(sky_top, sky_hor, sun_energy, sun_col, ambient):
    sc = bpy.context.scene
    set_engine(sc)
    w = bpy.data.worlds.new("World"); w.use_nodes = True
    bg = w.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*srgb2lin(hexc(sky_top)), 1); bg.inputs["Strength"].default_value = ambient
    sc.world = w
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Punchy" if "AgX - Punchy" in [x.identifier for x in sc.view_settings.bl_rna.properties["look"].enum_items] else "None"
    try:
        sc.eevee.use_shadows = True
    except Exception:
        pass
    return sc


def add_ground(size=80):
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0, 8, 0))
    g = bpy.context.active_object; g.name = "Ground"
    m = bpy.data.materials.new("Ground"); m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 0.9; n.inputs["Detail"].default_value = 6
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*srgb2lin(hexc("4e7a30")), 1); ramp.color_ramp.elements[1].color = (*srgb2lin(hexc("7a9a3e")), 1)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["Object"], n.inputs["Vector"]); nt.links.new(n.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"]); bsdf.inputs["Roughness"].default_value = 1.0
    g.data.materials.append(m)
    return g


def add_rocks(coll, spec):
    m = bpy.data.materials.new("Rock"); m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*srgb2lin(hexc("6f8296")), 1)
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 1
    for i, (x, y, r, h) in enumerate(spec):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
        for v in bm.verts:
            v.co += noise.noise_vector(v.co * 0.6 + Vector((i * 3.1, 0, 0))) * r * 0.35
            v.co.z *= h / r
        me = bpy.data.meshes.new("rock%d" % i); bm.to_mesh(me); bm.free()
        for p in me.polygons: p.use_smooth = False
        me.materials.append(m)
        o = bpy.data.objects.new("rock%d" % i, me); o.location = (x, y, h * 0.35)
        coll.objects.link(o)


def add_sun(rot, energy, col="fff1d6"):
    ld = bpy.data.lights.new("Sun", "SUN"); ld.energy = energy; ld.color = hexc(col); ld.angle = math.radians(3)
    o = bpy.data.objects.new("Sun", ld); o.rotation_euler = rot
    bpy.context.scene.collection.objects.link(o)


def add_portal_light(cx, root_loc, power=60):
    ld = bpy.data.lights.new("PL_" + cx.v, "POINT")
    ld.energy = power; ld.color = hexc(cx.pal["glow"]); ld.shadow_soft_size = 0.4
    ld.use_shadow = False
    o = bpy.data.objects.new("PL_" + cx.v, ld)
    o.location = Vector(root_loc) + Vector((0, -0.85, 1.2))
    bpy.context.scene.collection.objects.link(o)


def add_camera(loc, target, lens=28, name="Cam"):
    cd = bpy.data.cameras.new(name); cd.lens = lens; cd.clip_end = 300
    o = bpy.data.objects.new(name, cd); o.location = loc
    d = Vector(target) - Vector(loc)
    o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.collection.objects.link(o)
    return o


def add_glare(sc):
    try:
        sc.use_nodes = True
        nt = sc.node_tree
        rl = next(n for n in nt.nodes if n.type == "R_LAYERS"); comp = next(n for n in nt.nodes if n.type == "COMPOSITE")
        gl = nt.nodes.new("CompositorNodeGlare")
        gl.glare_type = "BLOOM"
        try:
            gl.threshold = 1.2; gl.size = 7; gl.mix = -0.7
        except Exception:
            pass
        nt.links.new(rl.outputs["Image"], gl.inputs["Image"]); nt.links.new(gl.outputs["Image"], comp.inputs["Image"])
    except Exception as e:
        print("glare skipped:", e)


def render(sc, cam, path, res=(1600, 900)):
    sc.camera = cam
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = path
    sc.render.image_settings.file_format = "PNG"
    try:
        sc.eevee.taa_render_samples = 16 if QUICK else 48
    except Exception:
        pass
    bpy.ops.render.render(write_still=True)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    kit = bpy.data.collections.new("PortalKit"); sc.collection.children.link(kit)
    order = ["orchard", "quarry", "crystal", "foundry", "mushroom", "sky", "kitchen"]
    cxs = {v: build_variant(v, kit) for v in order}
    stats = {}
    bpy.context.view_layer.update()
    for v, cx in cxs.items():
        export_glb(cx, os.path.join(HERE, "portals", "portal_%s.glb" % v))
        near = [o for o in descendants(cx.near)]
        far = [o for o in descendants(cx.far)]
        mn, mx = bounds([o for o in near if o.type == "MESH"])
        used = set()
        for o in near:
            if o.type == "MESH":
                for p in o.data.polygons:
                    used.add(o.data.materials[p.material_index].name)
        stats[v] = dict(family=cx.family, near_tris=tri_count(near), far_tris=tri_count(far),
                        dims_xyz=[round(mx.x - mn.x, 2), round(mx.y - mn.y, 2), round(mx.z - mn.z, 2)],
                        min=[round(x, 2) for x in mn], max=[round(x, 2) for x in mx],
                        materials=sorted(used), mesh_nodes=sorted(o.name.split("__")[1] for o in near + far if o.type == "MESH"),
                        aperture_centre_z=round(next(o for o in descendants(cx.root) if o.name.endswith("FX_SurfaceCenter")).location.z, 3))
    json.dump(stats, open(os.path.join(HERE, "stats.json"), "w"), indent=1)
    print(json.dumps({k: (v["near_tris"], v["far_tris"], v["dims_xyz"]) for k, v in stats.items()}))

    # editor look for surface + hub layout
    for v, cx in cxs.items():
        proceduralise_surface(cx.mats[SLOTS.index("surface")], cx.pal, next(o for o in descendants(cx.root) if o.name.endswith("FX_SurfaceCenter")).location.z)
    hub_order = ["orchard", "quarry", "kitchen", "mushroom", "crystal", "sky", "foundry"]
    # the game's hub order: pinewood, quarry, kitchen, mushroom, crystal, sky, ember
    for i, v in enumerate(hub_order):
        cxs[v].root.location = ((i - 3) * 3.5, 0, 0)
        for o in descendants(cxs[v].far):
            o.hide_render = True
            o.hide_viewport = True
    ground = add_ground()
    scene_coll = sc.collection
    rocks = bpy.data.collections.new("Backdrop"); scene_coll.children.link(rocks)
    add_rocks(rocks, [(-9, 14, 4.5, 6), (-2, 17, 5, 7.5), (7, 15, 4, 5.5), (13, 13, 4.2, 6), (-16, 12, 3.6, 5)])
    add_sun((math.radians(50), math.radians(8), math.radians(-35)), 3.2)
    for v in hub_order:
        add_portal_light(cxs[v], cxs[v].root.location)
    new_scene_world("bcd6ea", "bcd6ea", 0, "fff", 1.0)
    sc.render.film_transparent = False
    add_glare(sc)
    os.makedirs(os.path.join(HERE, "renders"), exist_ok=True)
    R = lambda n: os.path.join(HERE, "renders", n)
    cams = {
        "lineup": add_camera((0.4, -7.5, 1.7), (-0.4, 0, 1.45), 28, "CamLineup"),
        "hub": add_camera((0, -12.5, 1.7), (0, 0, 2.0), 15, "CamHub"),
        "rts": add_camera((0, -9.5, 17), (0, -0.2, 0.8), 14, "CamRTS"),
    }
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(HERE, "portal_kit.blend"))
    if not DO_RENDER:
        return
    # 1) four core families, ground level, three-quarter
    for v in hub_order:
        pass
    hide = {"kitchen", "mushroom", "sky"}
    saved = {v: cxs[v].root.location.copy() for v in cxs}
    for i, v in enumerate(["orchard", "quarry", "crystal", "foundry"]):
        cxs[v].root.location = ((i - 1.5) * 3.6, 0, 0)
    for v in hide:
        for o in descendants(cxs[v].root):
            o.hide_render = True
    for l in bpy.data.objects:
        if l.name.startswith("PL_") and l.name[3:] in hide:
            l.hide_render = True
    cams["lineup"].data.lens = 20; cams["lineup"].location = (1.2, -9.4, 1.6); cams["lineup"].rotation_euler = (Vector((-1.0, 9.4, -0.1)).to_track_quat("-Z", "Y")).to_euler()
    for l in bpy.data.objects:
        if l.name.startswith("PL_"):
            v = l.name[3:]
            if v in ("orchard", "quarry", "crystal", "foundry"):
                l.location = cxs[v].root.location + Vector((0, -0.85, 1.2))
    render(sc, cams["lineup"], R("render_01_families_ground.png"))
    # 2) hub restored: seven adjacent gates, VR eye view
    for v in hide:
        for o in descendants(cxs[v].root):
            if o not in descendants(cxs[v].far):
                o.hide_render = False
        for l in bpy.data.objects:
            if l.name == "PL_" + v: l.hide_render = False
    for i, v in enumerate(hub_order):
        cxs[v].root.location = ((i - 3) * 3.5, 0, 0)
        bpy.data.objects["PL_" + v].location = cxs[v].root.location + Vector((0, -0.85, 1.2))
    render(sc, cams["hub"], R("render_02_hub_seven_ground.png"))
    render(sc, cams["rts"], R("render_03_hub_overhead_rts.png"))
    # 4) close 3/4 dusk of crystal + foundry (glow read)
    for v in cxs:
        cxs[v].root.hide_render = True
        for o in descendants(cxs[v].root): o.hide_render = True
    for v in ("crystal", "foundry"):
        for o in descendants(cxs[v].root):
            if o not in descendants(cxs[v].far): o.hide_render = False
        cxs[v].root.hide_render = False
    cxs["crystal"].root.location = (-1.6, 0, 0); cxs["foundry"].root.location = (1.6, 0.3, 0)
    for v in ("crystal", "foundry"):
        bpy.data.objects["PL_" + v].hide_render = False
        bpy.data.objects["PL_" + v].location = cxs[v].root.location + Vector((0, -0.85, 1.2))
        bpy.data.objects["PL_" + v].data.energy = 110
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (*srgb2lin(hexc("1e2a44")), 1)
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    for o in bpy.data.objects:
        if o.type == "LIGHT" and o.data.type == "SUN":
            o.data.energy = 0.6; o.data.color = (0.6, 0.7, 1.0)
    cam4 = add_camera((-1.2, -5.6, 1.5), (0.0, 0, 1.35), 32, "CamDusk")
    cam4.location = (-3.0, -5.0, 1.4); cam4.rotation_euler = (Vector((3.0, 5.0, -0.05)).to_track_quat("-Z", "Y")).to_euler()
    render(sc, cam4, R("render_04_dusk_glow_closeup.png"))


main()
