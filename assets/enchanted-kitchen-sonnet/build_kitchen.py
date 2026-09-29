"""Deterministic Enchanted Kitchen kit builder. Run:
blender.exe -b --python build_kitchen.py -- [outdir]
Godot axes: X right, Y up, Z depth (Blender Y-up export handled by glTF exporter; we author in Blender Z-up)."""
import bpy, bmesh, sys, os, math, json, random
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[0]) if ARGS else os.path.dirname(os.path.abspath(__file__))
ONLY = os.environ.get("KITCHEN_ONLY")  # comma list of assets for quick tests
os.makedirs(OUT, exist_ok=True)

# ---------- authoring convention ----------
# We author directly in Godot space (x, y_up, z) and convert to Blender (x, -z, y) on creation.
def G(p):
    return Vector((p[0], -p[2], p[1]))

# ---------- procedural textures ----------
TEXSIZE = 256
def _noise(rng, n, octaves=4):
    out = np.zeros((n, n))
    for o in range(octaves):
        s = 4 * 2 ** o
        g = rng.random((s, s))
        big = np.kron(g, np.ones((n // s, n // s)))
        for _ in range(max(1, n // s // 2)):
            big = (big + np.roll(big, 1, 0) + np.roll(big, -1, 0) + np.roll(big, 1, 1) + np.roll(big, -1, 1)) / 5
        out += big * (0.5 ** o)
    out = out - out.min(); return out / out.max()

def make_tex(name, kind, c1, c2, seed=1):
    rng = np.random.default_rng(seed)
    n = TEXSIZE
    y, x = np.mgrid[0:n, 0:n] / n
    a = np.array(c1); b = np.array(c2)
    if kind == "wood":
        f = np.sin((y * 6 + _noise(rng, n) * 2.2) * math.pi * 2) * .5 + .5
        f = f * .6 + _noise(rng, n, 5) * .4
    elif kind == "planks":
        f = _noise(rng, n, 5) * .5 + (np.sin(x * math.pi * 2 * 8 + _noise(rng, n) * 3) * .5 + .5) * .5
        seam = (np.abs((x * 4) % 1 - 0) < .012) | (np.abs((y * 1) % 1) < .01)
        f[seam] = 0.0
    elif kind == "tile":
        f = _noise(rng, n, 3) * .35 + .65
        cell = 8
        gx = (x * cell) % 1; gy = (y * cell) % 1
        grout = (gx < .06) | (gy < .06)
        tint = np.kron(rng.random((cell, cell)), np.ones((n // cell, n // cell)))
        f = np.clip(f * (.55 + tint * .6), 0, 1)
        f[grout] = 0.0
    elif kind == "stone":
        f = _noise(rng, n, 5)
        row = np.floor(y * 6)
        off = (row % 2) * .5
        gx = ((x * 4 + off) % 1); gy = (y * 6) % 1
        mortar = (gx < .05) | (gy < .07)
        f = f * .8 + .2
        f[mortar] = 0.0
    elif kind == "cloth":
        f = (np.sin(x * 120) * np.sin(y * 120)) * .1 + .9
        stripe = (np.floor(x * 8) % 2) * .35
        f = np.clip(f - stripe, 0, 1)
    elif kind == "metal":
        f = _noise(rng, n, 5) * .5 + .5
        f *= (np.sin(y * 500) * .04 + .96)
    elif kind == "ceramic":
        f = _noise(rng, n, 3) * .2 + .8
        band = (np.abs(y - .5) < .06) | (np.abs(y - .25) < .02)
        f[band] = 0.15
    elif kind == "green":
        f = _noise(rng, n, 5)
    else:
        f = _noise(rng, n, 4)
    f = f[..., None]
    if kind in ("tile", "stone", "planks"):
        col = a + (b - a) * f
        if kind in ("tile", "stone", "planks"):
            mask = (f[..., 0] == 0.0)
            col[mask] = a * 0.35
    else:
        col = a + (b - a) * f
    px = np.ones((n, n, 4)); px[..., :3] = np.clip(col, 0.02, 1)
    img = bpy.data.images.new(name + "_tex", n, n)
    img.pixels = px.ravel().tolist()
    img.pack()
    img.colorspace_settings.name = "sRGB"
    return img, float(px[..., :3].mean())

MATS = {}
def mat(name, kind, c1, c2, rough=.7, metal=0.0, emit=None, seed=1):
    if name in MATS:
        return MATS[name]
    img, mean = make_tex(name, kind, c1, c2, seed)
    m = bpy.data.materials.new(name); m.use_nodes = True
    m.use_backface_culling = True
    nt = m.node_tree; bsdf = nt.nodes["Principled BSDF"]
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = img
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.1
        nt.links.new(t.outputs["Color"], bsdf.inputs["Emission Color"])
    MATS[name] = m
    return m

def palette():
    P = {}
    P["oak"] = mat("K_oak", "wood", (.30, .16, .07), (.62, .38, .18), .65, seed=2)
    P["darkwood"] = mat("K_darkwood", "wood", (.12, .06, .03), (.32, .18, .09), .7, seed=3)
    P["planks"] = mat("K_floorplank", "planks", (.22, .12, .06), (.5, .3, .15), .6, seed=4)
    P["tile"] = mat("K_tile", "tile", (.36, .26, .16), (.86, .7, .47), .55, seed=5)
    P["stone"] = mat("K_stone", "stone", (.25, .22, .2), (.62, .56, .48), .9, seed=6)
    P["plaster"] = mat("K_plaster", "noise", (.62, .5, .36), (.85, .72, .55), .95, seed=7)
    P["rug"] = mat("K_rug", "cloth", (.35, .07, .07), (.9, .55, .2), .95, seed=8)
    P["iron"] = mat("K_iron", "metal", (.08, .08, .09), (.3, .3, .32), .5, .8, seed=9)
    P["copper"] = mat("K_copper", "metal", (.45, .2, .1), (.95, .55, .3), .35, .9, seed=10)
    P["ceramic"] = mat("K_ceramic", "ceramic", (.1, .3, .45), (.95, .92, .85), .3, seed=11)
    P["cream"] = mat("K_cream", "ceramic", (.7, .6, .45), (.98, .94, .85), .35, seed=12)
    P["cloth"] = mat("K_cloth", "cloth", (.5, .12, .1), (.98, .9, .8), .95, seed=13)
    P["herb"] = mat("K_herb", "green", (.08, .22, .05), (.4, .6, .15), .9, seed=14)
    P["veg_red"] = mat("K_tomato", "noise", (.55, .05, .03), (.95, .2, .1), .5, seed=15)
    P["veg_orange"] = mat("K_carrot", "noise", (.8, .35, .05), (1, .55, .15), .6, seed=16)
    P["veg_green"] = mat("K_cabbage", "green", (.2, .4, .1), (.6, .8, .3), .7, seed=17)
    P["bread"] = mat("K_bread", "noise", (.55, .32, .12), (.85, .6, .3), .8, seed=18)
    P["glow"] = mat("K_magic", "noise", (.3, .6, 1.0), (.8, .95, 1.0), .3, emit=(.4, .7, 1), seed=19)
    P["fire"] = mat("K_fire", "noise", (1, .3, .05), (1, .85, .3), .5, emit=(1, .5, .1), seed=20)
    P["glass"] = mat("K_bottle", "noise", (.15, .4, .25), (.5, .8, .6), .15, seed=21)
    return P

# ---------- geometry builder ----------
class B:
    """Collects geometry per material into bmesh, with box-projected UVs (1 uv unit ~ 1 m * uvscale)."""
    def __init__(self, name):
        self.name = name; self.bm = {}
    def _b(self, m):
        if m.name not in self.bm:
            self.bm[m.name] = (m, bmesh.new())
        return self.bm[m.name][1]
    def _finish(self, bm, faces, uvscale, rot_uv=False):
        uv = bm.loops.layers.uv.verify()
        for f in faces:
            n = f.normal
            ax = max(range(3), key=lambda i: abs(n[i]))
            for l in f.loops:
                p = l.vert.co
                u, v = [(p.y, p.z), (p.x, p.z), (p.x, p.y)][ax]
                l[uv].uv = (u * uvscale, v * uvscale)
    def geom(self, m, fn, uvscale=1.0):
        bm = self._b(m)
        before = set(bm.faces)
        fn(bm)
        bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
        new = [f for f in bm.faces if f not in before]
        self._finish(bm, new, uvscale)
    def box(self, m, c, s, yaw=0, uvscale=1.0, tilt=0):
        def fn(bm):
            r = bmesh.ops.create_cube(bm, size=1.0)
            verts = r["verts"]
            mat_ = (Matrix_T(G(c)) @ Matrix_Rz(math.radians(yaw)) @ Matrix_Ry(-math.radians(tilt)) @ Matrix_S((s[0], s[2], s[1])))
            bmesh.ops.transform(bm, matrix=mat_, verts=verts)
        self.geom(m, fn, uvscale)
    def cyl(self, m, c, r, h, seg=12, yaw=0, uvscale=1.0, r2=None, axis="y", tilt=0):
        def fn(bm):
            res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=(r if r2 is None else r2), depth=h)
            rot = Matrix_Rz(0)
            if axis == "x":
                rot = Matrix_Ry(math.pi / 2)
            elif axis == "z":
                rot = Matrix_Rx(math.pi / 2)
            mat_ = Matrix_T(G(c)) @ Matrix_Rz(math.radians(yaw)) @ Matrix_Ry(-math.radians(tilt)) @ rot
            bmesh.ops.transform(bm, matrix=mat_, verts=res["verts"])
        self.geom(m, fn, uvscale)
    def sphere(self, m, c, r, sc=(1, 1, 1), seg=10, rings=6, uvscale=1.0):
        def fn(bm):
            res = bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
            mat_ = Matrix_T(G(c)) @ Matrix_S((sc[0], sc[2], sc[1]))
            bmesh.ops.transform(bm, matrix=mat_, verts=res["verts"])
        self.geom(m, fn, uvscale)
    def build(self):
        objs = []
        for mname, (m, bm) in self.bm.items():
            me = bpy.data.meshes.new(f"{self.name}_{mname}")
            bm.to_mesh(me); bm.free()
            me.materials.append(m)
            o = bpy.data.objects.new(f"{self.name}__{mname}", me)
            bpy.context.scene.collection.objects.link(o)
            objs.append(o)
        return objs

from mathutils import Matrix
def Matrix_T(v): return Matrix.Translation(v)
def Matrix_Rz(a): return Matrix.Rotation(a, 4, "Z")
def Matrix_Ry(a): return Matrix.Rotation(a, 4, "Y")
def Matrix_Rx(a): return Matrix.Rotation(a, 4, "X")
def Matrix_S(s): return Matrix.Diagonal((s[0], s[1], s[2], 1.0))

# ---------- assets ----------
ASSETS = {}
def asset(fn):
    ASSETS[fn.__name__] = fn
    return fn

WALL_H = 5.5      # assumed wall top; ridge = WALL_H + 3
RIDGE = WALL_H + 3.0
ASSETS = {}
def asset(fn):
    ASSETS[fn.__name__] = fn
    return fn

# ---- small prop helpers (Godot-space local coords) ----
def jar(b, m, c, r, h, lid=None):
    b.cyl(m, (c[0], c[1] + h / 2, c[2]), r, h, 10)
    b.cyl(lid or m, (c[0], c[1] + h + .02, c[2]), r * .75, .05, 10)
def cup(b, P, c, r=.06):
    b.cyl(P["cream"], (c[0], c[1] + r * .8, c[2]), r * .75, r * 1.6, 10, r2=r)
    b.box(P["cream"], (c[0] + r * 1.05, c[1] + r * .8, c[2]), (r * .3, r * 1.0, r * .3))
def pot(b, P, c, r, h, m=None, lid=True):
    m = m or P["copper"]
    b.cyl(m, (c[0], c[1] + h / 2, c[2]), r, h, 12, r2=r * 1.1)
    b.cyl(P["iron"], (c[0], c[1] + h - .01, c[2]), r * 1.02, .02, 12)
    for s in (-1, 1):
        b.box(P["iron"], (c[0], c[1] + h * .8, c[2] + s * r * 1.25), (.08, .05, r * .4))
    if lid:
        b.cyl(m, (c[0], c[1] + h + .03, c[2]), r * 1.05, .05, 12, r2=r * .8)
        b.sphere(P["iron"], (c[0], c[1] + h + .08, c[2]), .035, seg=6, rings=4)
def pumpkin(b, P, c, r):
    b.sphere(P["veg_orange"], (c[0], c[1] + r * .8, c[2]), r, sc=(1, .82, 1), seg=12, rings=8)
    b.cyl(P["darkwood"], (c[0], c[1] + r * 1.65, c[2]), r * .12, r * .3, 5)
def barrel(b, P, c, r=.42, h=1.0):
    b.cyl(P["oak"], (c[0], c[1] + h / 2, c[2]), r * 1.12, h * .5, 12)
    b.cyl(P["oak"], (c[0], c[1] + h * .125, c[2]), r, h * .25, 12, r2=r * 1.12)
    b.cyl(P["oak"], (c[0], c[1] + h * .875, c[2]), r * 1.12, h * .25, 12, r2=r)
    for dy, k in ((.18, 1.06), (.5, 1.12), (.82, 1.06)):
        b.cyl(P["iron"], (c[0], c[1] + h * dy, c[2]), r * k + .015, .05, 12)
    b.cyl(P["darkwood"], (c[0], c[1] + h + .005, c[2]), r * .96, .02, 12)
def sack(b, P, c, r=.3, m=None):
    m = m or P["cloth"]
    b.sphere(m, (c[0], c[1] + r * .85, c[2]), r, sc=(1, 1.2, .9), seg=8, rings=6)
    b.cyl(m, (c[0], c[1] + r * 1.85, c[2]), r * .3, r * .45, 6, r2=r * .55)
    b.cyl(P["darkwood"], (c[0], c[1] + r * 1.7, c[2]), r * .36, .03, 8)
def herb(b, P, c, L=.45, r=.13):
    b.box(P["darkwood"], (c[0], c[1] - .08, c[2]), (.012, .16, .012))
    b.cyl(P["herb"], (c[0], c[1] - .16 - L / 2, c[2]), r, L, 6, r2=.02)
    b.sphere(P["cream"], (c[0] + r * .5, c[1] - .16 - L * .8, c[2]), .022, seg=4, rings=3)
    b.sphere(P["veg_red"], (c[0] - r * .5, c[1] - .16 - L * .55, c[2] + r * .4), .02, seg=4, rings=3)
def candle(b, P, c, h=.12):
    b.cyl(P["cream"], (c[0], c[1] + h / 2, c[2]), .022, h, 6)
    b.cyl(P["fire"], (c[0], c[1] + h + .03, c[2]), .014, .06, 5, r2=.002)
def flame(b, P, c, h, r):
    b.cyl(P["fire"], (c[0], c[1] + h / 2, c[2]), r, h, 5, r2=.01)
def stool(b, P, c):
    b.cyl(P["oak"], (c[0], c[1] + .5, c[2]), .23, .05, 10)
    for a in range(3):
        an = a * 2.094 + .5
        b.cyl(P["darkwood"], (c[0] + math.cos(an) * .14, c[1] + .25, c[2] + math.sin(an) * .14), .03, .5, 5, r2=.022)

@asset
def table(P):
    b = B("table")
    W, D = 3.4, 1.6
    b.box(P["oak"], (0, .9, 0), (W, .1, D), uvscale=.6)
    b.box(P["darkwood"], (0, .84, 0), (W - .1, .04, D - .1))
    for sx in (-1, 1):
        for sz in (-1, 1):
            b.box(P["darkwood"], (sx * (W / 2 - .2), .42, sz * (D / 2 - .18)), (.16, .84, .16))
            b.box(P["iron"], (sx * (W / 2 - .2), .03, sz * (D / 2 - .18)), (.19, .06, .19))
    b.box(P["darkwood"], (0, .3, 0), (W - .4, .09, .09))
    for sx in (-1, 1): b.box(P["darkwood"], (sx * (W / 2 - .2), .3, 0), (.09, .09, D - .4))
    b.box(P["cloth"], (0, .955, 0), (1.3, .012, D + .02), uvscale=1.2)
    for sz in (-1, 1): b.box(P["cloth"], (0, .82, sz * (D / 2 + .012)), (1.3, .24, .012), uvscale=1.2)
    for i, x in enumerate((-.85, 0, .85)):
        pumpkin(b, P, (x, .96, -.45), .27 - (i == 1) * .02)
    b.box(P["oak"], (-1.15, .985, .4), (.6, .04, .34))
    b.sphere(P["bread"], (-1.2, 1.08, .4), .17, sc=(1.6, .7, .8), seg=10, rings=6)
    b.cyl(P["veg_orange"], (-.98, 1.02, .38), .09, .08, 8)
    b.box(P["iron"], (-1.1, 1.01, .28), (.22, .012, .03))
    b.box(P["darkwood"], (-.96, 1.012, .28), (.1, .025, .035))
    b.cyl(P["ceramic"], (.75, 1.03, .4), .2, .08, 12, r2=.24)
    for a in range(5):
        b.sphere(P["veg_red"], (.75 + math.cos(a * 1.26) * .09, 1.1, .4 + math.sin(a * 1.26) * .09), .06, seg=6, rings=4)
    b.cyl(P["ceramic"], (1.3, 1.11, .1), .11, .3, 10, r2=.13)
    b.cyl(P["ceramic"], (1.3, 1.29, .1), .07, .06, 10, r2=.05)
    b.box(P["ceramic"], (1.44, 1.13, .1), (.04, .16, .04))
    b.sphere(P["cream"], (.2, 1.09, .5), .13, sc=(1, .85, 1), seg=10, rings=6)
    b.cyl(P["cream"], (.2, 1.21, .5), .06, .04, 8)
    b.box(P["cream"], (.36, 1.11, .5), (.12, .03, .03), tilt=25)
    for i in range(3): cup(b, P, (-.15 + i * .2, .96, .58 - (i % 2) * .05), .05)
    b.cyl(P["iron"], (-.35, .97, .0), .09, .02, 10)
    candle(b, P, (-.35, .98, .0), .1)
    b.cyl(P["oak"], (.5, 1.0, -.05), .035, .5, 8, axis="x", yaw=20)
    b.sphere(P["cream"], (.9, 1.02, .0), .14, sc=(1, .55, 1), seg=8, rings=5)
    stool(b, P, (-.9, 0, 1.35)); stool(b, P, (.8, 0, 1.4))
    return b

def cabinet_body(b, P, L=4.0, z0=-2.0):
    b.box(P["darkwood"], (-.05, .05, z0 + L / 2), (1.1, .1, L))
    b.box(P["oak"], (-.05, .5, z0 + L / 2), (1.1, .8, L), uvscale=.5)
    b.box(P["oak"], (-.05, .955, z0 + L / 2), (1.3, .09, L + .1), uvscale=.5)
    n = int(L / .8)
    for i in range(n):
        zc = z0 + (i + .5) * L / n
        b.box(P["darkwood"], (.52, .5, zc), (.03, .66, L / n - .08))
        b.box(P["oak"], (.545, .5, zc), (.02, .54, L / n - .2))
        b.sphere(P["iron"], (.58, .55, zc + (L / n) * .3), .028, seg=6, rings=4)

@asset
def counter_a(P):
    b = B("counter_a"); cabinet_body(b, P)
    pot(b, P, (-.1, 1.0, -1.55), .27, .3)
    for i in range(4): b.cyl(P["cream"], (-.05, 1.0 + i * .025, -.85), .19, .022, 12)
    b.box(P["oak"], (.05, 1.015, -.2), (.5, .04, .34)); b.sphere(P["veg_green"], (.05, 1.15, -.2), .13, seg=8, rings=6)
    b.box(P["iron"], (.2, 1.045, -.12), (.24, .012, .035), yaw=15)
    b.cyl(P["stone"], (-.05, 1.06, .5), .1, .12, 8, r2=.12); b.cyl(P["stone"], (.0, 1.16, .5), .025, .3, 6, tilt=25)
    for i, c in enumerate((P["glass"], P["ceramic"], P["cream"])): jar(b, c, (-.35, 1.0, 1.05 + i * .25), .1, .22 + i * .04, P["darkwood"])
    b.cyl(P["oak"], (.25, 1.05, 1.5), .035, .5, 8, axis="z", yaw=-10)
    pot(b, P, (-.05, 1.0, 1.75), .17, .2, P["iron"])
    b.box(P["iron"], (-.55, 1.85, 0), (.04, .04, 3.6))
    for i, z in enumerate((-1.4, -.7, 0, .7, 1.4)):
        b.cyl(P["copper"], (-.5, 1.42, z), .16 - (i % 2) * .03, .05, 12, axis="x")
        b.box(P["darkwood"], (-.5, 1.65, z), (.04, .4, .04))
    return b

@asset
def counter_b(P):
    b = B("counter_b"); cabinet_body(b, P, 2.6, -2.0)
    for s in (-1, 1):
        b.box(P["stone"], (0, 1.04, -1.0 + s * .45), (.9, .1, .07)); b.box(P["stone"], (s * .43, 1.04, -1.0), (.07, .1, .9))
    b.box(P["glass"], (0, 1.0, -1.0), (.8, .02, .8))
    b.cyl(P["copper"], (-.4, 1.35, -1.0), .025, .5, 6); b.cyl(P["copper"], (-.3, 1.58, -1.0), .02, .2, 6, axis="x")
    pot(b, P, (0, 1.0, .05), .24, .3, lid=False)
    b.cyl(P["oak"], (.0, 1.42, .05), .018, .65, 6, tilt=12)
    for i, (x, y, z) in enumerate(((.1, 1.55, .0), (-.08, 1.7, .1), (.05, 1.85, -.03))): b.sphere(P["glow"], (x, y, z), .035 + i * .008, seg=6, rings=4)
    for i in range(3):
        z = -.05 + i * 0 + (i - 1) * .2 - .55
        b.cyl(P["tile"], (-.3, 1.0, z), .08, .1, 8, r2=.1); b.sphere(P["herb"], (-.3, 1.15, z), .09, seg=6, rings=4)
    for i in range(2): b.cyl(P["veg_orange"], (.05, 1.0 + i * .09, .45), .17, .08, 12)
    barrel(b, P, (-.1, 0, 1.55)); sack(b, P, (.3, 0, .95), .26); sack(b, P, (.32, 0, 1.4), .24, P["bread"])
    b.box(P["iron"], (.56, .16, .3), (.02, .26, .2)); b.cyl(P["fire"], (.57, .04, .3), .07, .01, 6, axis="x")
    b.box(P["veg_orange"], (.66, .04, .5), (.14, .06, .1), yaw=30)
    return b

@asset
def shelf(P):
    b = B("shelf")
    for y in (2.2, 3.15):
        b.box(P["darkwood"], (0, y, 0), (.4, .06, 4.0), uvscale=.5)
        b.box(P["oak"], (.19, y - .03, 0), (.03, .07, 4.0))
    for z in (-1.8, -.6, .6, 1.8):
        for y in (2.2, 3.15):
            b.box(P["iron"], (-.17, y - .16, z), (.04, .3, .06))
            b.box(P["iron"], (-.03, y - .2, z), (.28, .04, .04), tilt=-45)
    for z, m in ((-1.9, "ceramic"), (-1.55, "glass"), (-1.2, "cream")):
        jar(b, P[m], (0, 2.23, z), .09, .2 + (z > -1.6) * .06, P["darkwood"])
    for i in range(4): b.cyl(P["cream"], (0, 2.235 + i * .024, -.5), .17, .022, 12)
    for i in range(3): cup(b, P, (0, 2.23, .0 + i * .17), .06)
    for z in (.8, 1.1, 1.5, 1.8): jar(b, P["tile"] if z < 1.4 else P["ceramic"], (0, 2.23, z), .1, .24 - (z > 1.4) * .06, P["iron"])
    for i in range(5): b.box(P["cloth"] if i % 2 else P["veg_green"], (0, 3.34, -1.6 + i * .09), (.22, .3 - (i % 3) * .04, .07))
    for i, z in enumerate((-.4, .3, 1.2, 1.8)):
        b.cyl(P["iron"], (0, 3.2, z), .05, .05, 8); b.sphere(P["glow"], (0, 3.3, z), .07 + (i % 2) * .02, seg=6, rings=4)
    for i in range(9): herb(b, P, (.12, 3.12, -1.8 + i * .45), .34 + (i % 3) * .07)
    return b

@asset
def hearth(P):
    b = B("hearth")
    S = P["stone"]
    b.box(S, (0, .06, .25), (4.9, .12, 1.5), uvscale=.5)
    for sx in (-1, 1):
        b.box(S, (sx * 1.85, 1.1, -1.0), (1.5, 2.2, 1.7), uvscale=.4)
        b.box(S, (sx * 1.8, 2.875, -1.05), (1.4, 1.75, 1.8), uvscale=.4)
        b.box(S, (sx * 2.2, .18, -.05), (1.0, .36, .25), uvscale=.4)
    R = 1.25
    for i in range(9):
        t = math.radians(10 + i * 20)
        b.box(S, (R * math.cos(t), 2.0 + R * math.sin(t), -.95), (.42, .5, 1.9), tilt=math.degrees(t), uvscale=.6)
    b.box(S, (0, 3.6, -1.05), (3.2, .3, 1.8), uvscale=.4)
    b.box(S, (0, 4.15, -1.1), (4.6, .8, 1.7), uvscale=.4)
    b.box(S, (0, 4.95, -1.15), (3.8, .8, 1.5), uvscale=.4)
    b.box(S, (0, 7.35, -1.3), (2.4, 4.0, 1.3), uvscale=.4)
    b.box(S, (0, 9.5, -1.3), (2.7, .35, 1.5), uvscale=.4)
    b.box(P["darkwood"], (0, 3.85, .0), (5.3, .2, .8), uvscale=.5)
    for sx in (-1, 1): b.box(P["darkwood"], (sx * 2.5, 3.62, .05), (.24, .26, .5))
    for x in (-2.1, -1.8, 1.8, 2.2): candle(b, P, (x, 3.95, .1), .14 + abs(x) * .03)
    for x in (-1.2, 1.2): jar(b, P["ceramic"], (x, 3.95, .1), .1, .26, P["darkwood"])
    cup(b, P, (-.6, 3.95, .1)); cup(b, P, (.5, 3.95, .1)); cup(b, P, (.62, 3.95, .0))
    b.cyl(P["copper"], (0, 4.05, .1), .1, .2, 10, r2=.07)
    b.box(P["iron"], (0, 1.6, -1.92), (2.5, 3.2, .1))
    for sx in (-1, 1): b.box(P["iron"], (sx * 1.15, 1.0, -1.35), (.1, 2.0, 1.2))
    b.box(P["iron"], (0, .13, -1.2), (2.3, .02, 1.5))
    for dz in (-1.15, -.75): b.cyl(P["darkwood"], (0, .3 + (dz > -1) * .03, dz), .15, 1.5, 8, axis="x", yaw=(dz > -1) * 6)
    for i, (x, h, r) in enumerate(((-.6, .7, .16), (-.25, 1.1, .2), (.1, 1.35, .22), (.45, .95, .18), (.75, .6, .14), (-.05, .6, .3))):
        flame(b, P, (x, .34, -.95 - (i % 2) * .1), h, r)
    for sx in (-1, 1): b.cyl(P["iron"], (sx * .95, .35, -.6), .04, .6, 6); b.sphere(P["iron"], (sx * .95, .68, -.6), .06, seg=6, rings=4)
    b.cyl(P["iron"], (-1.0, 1.1, -1.4), .05, 2.2, 6); b.box(P["iron"], (-.4, 2.0, -1.4), (1.25, .06, .06))
    b.box(P["iron"], (-.3, 1.75, -1.4), (.03, .5, .03))
    b.sphere(P["copper"], (-.3, 1.3, -1.4), .42, sc=(1, .8, 1), seg=12, rings=8)
    b.cyl(P["iron"], (-.3, 1.55, -1.4), .3, .04, 12)
    for i in range(3): b.sphere(P["glow"], (-.3 + (i - 1) * .12, 1.72 + i * .05, -1.4), .05, seg=6, rings=4)
    b.cyl(P["iron"], (1.75, .25, .6), .2, .5, 8, r2=.24)
    for i in range(3): b.cyl(P["darkwood"], (1.75 + (i - 1) * .06, .5, .6), .06, .35, 6, tilt=(i - 1) * 12)
    b.cyl(P["iron"], (-1.75, .55, .4), .015, 1.1, 5, tilt=10)
    b.box(P["iron"], (1.9, .18, -.18), (.28, .36, .04)); b.cyl(P["iron"], (1.9, .36, -.18), .14, .04, 8, axis="z")
    b.cyl(P["fire"], (1.9, .03, -.12), .09, .01, 6); b.box(P["veg_orange"], (2.1, .05, .0), (.16, .08, .12), yaw=-30)
    for i in range(6): herb(b, P, (-2.4 + i * .96, 3.75, .3), .4 + (i % 2) * .1)
    return b

@asset
def roof_truss(P):
    b = B("roof_truss")
    W = 12.2
    slope = (RIDGE - WALL_H) / W
    th = math.degrees(math.atan(slope))
    L = math.hypot(W, RIDGE - WALL_H)
    b.box(P["darkwood"], (0, WALL_H - .12, 0), (2 * W, .3, .32), uvscale=.4)
    for s in (-1, 1):
        a = th if s < 0 else -th                      # rafter rises toward centre
        my = (RIDGE + WALL_H) / 2 - .05
        b.box(P["darkwood"], (s * W / 2, my, 0), (L, .3, .28), tilt=a, uvscale=.4)
        nx, ny = -math.sin(math.radians(a)), math.cos(math.radians(a))
        b.box(P["planks"], (s * W / 2 + nx * .21, my + ny * .21, 0), (L, .07, 4.0), tilt=a, uvscale=.5)
        b.box(P["darkwood"], (s * (W - .4), WALL_H - .5, 0), (.34, .8, .34))
        b.box(P["darkwood"], (s * (W - 1.3), 4.575, 0), (2.19, .2, .24), tilt=(34.8 if s < 0 else -34.8), uvscale=.4)
        ex, ey = 4.4, RIDGE - 4.4 * slope - .3
        ang = math.degrees(math.atan2(ey - 6.0, ex))
        b.box(P["darkwood"], (s * ex / 2, (6.0 + ey) / 2, 0), (math.hypot(ex, ey - 6.0), .2, .22), tilt=(ang if s > 0 else -ang), uvscale=.4)
        b.box(P["darkwood"], (s * W / 2, my - .3, 0), (.22, .22, 4.0))
        b.box(P["darkwood"], (s * (W - .3), WALL_H - .12, 0), (.36, .32, 4.0), uvscale=.4)
        lx = s * 5.5
        b.box(P["iron"], (lx, WALL_H - .5, 0), (.02, .55, .02))
        b.box(P["fire"], (lx, WALL_H - 1.0, 0), (.2, .3, .2))
        for dx_, dz_ in ((-1, -1), (-1, 1), (1, -1), (1, 1)): b.box(P["iron"], (lx + dx_ * .11, WALL_H - 1.0, dz_ * .11), (.025, .34, .025))
        b.cyl(P["iron"], (lx, WALL_H - .77, 0), .16, .1, 4, r2=.02, yaw=45)
        b.box(P["iron"], (lx, WALL_H - 1.19, 0), (.26, .04, .26))
    b.box(P["darkwood"], (0, (WALL_H + RIDGE) / 2 - .2, 0), (.28, RIDGE - WALL_H - .3, .28))
    b.box(P["darkwood"], (0, RIDGE - .3, 0), (.3, .3, 4.0))
    return b

@asset
def gable_wall(P):
    b = B("gable_wall")
    W = 12.2; H = RIDGE - WALL_H
    def prism(bm):
        f = [bm.verts.new(G(p)) for p in ((-W, WALL_H, .12), (W, WALL_H, .12), (0, RIDGE, .12))]
        k = [bm.verts.new(G(p)) for p in ((-W, WALL_H, 0), (W, WALL_H, 0), (0, RIDGE, 0))]
        bm.faces.new(f); bm.faces.new(k[::-1])
        for i in range(3):
            j = (i + 1) % 3
            bm.faces.new((f[i], k[i], k[j], f[j]))
    b.geom(P["plaster"], prism, uvscale=.25)
    b.box(P["darkwood"], (0, WALL_H + .05, .16), (2 * W, .3, .2), uvscale=.4)
    th = math.degrees(math.atan2(H, W))
    for s in (-1, 1):
        b.box(P["darkwood"], (s * W * .5, WALL_H + H / 2 + .05, .17), (math.hypot(W, H), .3, .2), tilt=(th if s < 0 else -th), uvscale=.4)
    for x in (-8, -4, 4, 8): b.box(P["darkwood"], (x, WALL_H + .8, .16), (.2, 1.4, .16))
    b.box(P["darkwood"], (0, WALL_H + 1.5, .16), (.22, 2.7, .16))
    b.cyl(P["darkwood"], (0, WALL_H + 1.3, .2), .55, .12, 16, axis="z")
    b.cyl(P["glow"], (0, WALL_H + 1.3, .27), .42, .04, 16, axis="z")
    b.box(P["darkwood"], (0, WALL_H + 1.3, .3), (.06, .9, .04)); b.box(P["darkwood"], (0, WALL_H + 1.3, .3), (.9, .06, .04))
    return b

@asset
def wall_panel(P):
    b = B("wall_panel")
    Wd = 6.0
    b.box(P["plaster"], (0, WALL_H / 2, .06), (Wd, WALL_H, .12), uvscale=.3)
    b.box(P["darkwood"], (0, .55, .17), (Wd, 1.1, .1), uvscale=.5)
    for i in range(int(Wd / .5)): b.box(P["oak"], (-Wd / 2 + .25 + i * .5, .55, .225), (.4, .9, .02), uvscale=.5)
    b.box(P["darkwood"], (0, .07, .2), (Wd, .14, .16)); b.box(P["darkwood"], (0, 1.13, .2), (Wd, .1, .14))
    for x in (-Wd / 2 + .12, 0, Wd / 2 - .12): b.box(P["darkwood"], (x, WALL_H / 2, .16), (.24, WALL_H, .2), uvscale=.5)
    b.box(P["darkwood"], (0, WALL_H - .12, .16), (Wd, .24, .2)); b.box(P["darkwood"], (0, 3.1, .15), (Wd, .12, .14))
    for x in (-1.5, 1.5):
        b.box(P["glow"], (x, 3.9, .12), (1.0, 1.3, .03))
        b.box(P["darkwood"], (x, 3.2, .18), (1.2, .1, .12)); b.box(P["darkwood"], (x, 4.6, .18), (1.2, .1, .12))
        for dx in (-.55, .55): b.box(P["darkwood"], (x + dx, 3.9, .18), (.1, 1.4, .12))
        b.box(P["darkwood"], (x, 3.9, .19), (.05, 1.3, .06)); b.box(P["darkwood"], (x, 3.9, .19), (1.0, .05, .06))
        b.box(P["oak"], (x, 3.15, .27), (1.4, .06, .26))
        for s in (-1, 1): b.box(P["cloth"], (x + s * .58, 3.95, .22), (.22, 1.35, .04), uvscale=1.0)
        b.box(P["iron"], (x, 4.66, .24), (1.4, .03, .03))
    return b

@asset
def floor_rug(P):
    b = B("floor_rug")
    b.box(P["tile"], (0, 0.0, 0), (24, .04, 24), uvscale=1 / 6)
    z = -2; RW, RD = 6.0, 4.6
    b.box(P["rug"], (0, .035, z), (RW, .03, RD), uvscale=.3)
    for sx in (-1, 1):
        b.box(P["cream"], (sx * (RW / 2 - .18), .052, z), (.12, .008, RD - .3))
        b.box(P["darkwood"], (sx * (RW / 2 - .34), .052, z), (.06, .008, RD - .5))
    for sz in (-1, 1):
        b.box(P["cream"], (0, .052, z + sz * (RD / 2 - .18)), (RW - .3, .008, .12))
        b.box(P["darkwood"], (0, .052, z + sz * (RD / 2 - .34)), (RW - .5, .008, .06))
    b.cyl(P["cream"], (0, .052, z), 1.1, .008, 8, yaw=22.5)
    b.cyl(P["veg_red"], (0, .056, z), .8, .008, 8, yaw=22.5)
    for sx in (-1, 1):
        for i in range(18): b.box(P["cream"], (sx * (RW / 2 + .07), .03, z - RD / 2 + .15 + i * .25), (.12, .015, .05))
    return b

@asset
def teacup(P):
    b = B("teacup")
    b.cyl(P["ceramic"], (0, -.16, 0), .38, .04, 14, r2=.3)
    b.cyl(P["cream"], (0, 0, 0), .16, .3, 12, r2=.27)
    b.cyl(P["ceramic"], (0, .14, 0), .27, .03, 12)
    b.cyl(P["bread"], (0, .135, 0), .24, .015, 12)
    for dy, dx in ((.13, .3), (-.03, .27)): b.box(P["cream"], (dx, dy, 0), (.14, .05, .05))
    b.box(P["cream"], (.36, .05, 0), (.05, .22, .05))
    b.box(P["iron"], (.05, .19, 0), (.34, .02, .03), tilt=30)
    for i in range(7):
        a = i * .9
        b.sphere(P["glow"], (math.cos(a) * .55, .15 + math.sin(i * 2.1) * .28, math.sin(a) * .55), .04 + (i % 3) * .012, seg=4, rings=3)
    for i in range(4): b.sphere(P["glow"], (.02 * i, .26 + i * .15, .03 * (i % 2)), .05 - i * .008, seg=6, rings=4)
    return b

def layout():
    pl = []
    def add(a, pos, yaw=0, s=1): pl.append({"asset": a, "position": [round(v, 3) for v in pos], "yaw_degrees": yaw, "scale": s})
    add("floor_rug", (0, 0, 0))
    add("table", (0, 0, -2))
    add("hearth", (0, 0, -10))
    for i, z in enumerate((5.5, 1.5, -2.5, -6.5)):
        for s, yaw in ((-1, 0), (1, 180)):
            a = "counter_a" if (i + (s > 0)) % 2 == 0 else "counter_b"
            add(a, (s * 10.6, 0, z), yaw)
            add("shelf", (s * 11.7, 0, z), yaw)
    for z in (-9, -3, 3, 9):
        add("wall_panel", (-12, 0, z), 90); add("wall_panel", (12, 0, z), -90)
    for x in (-9, -3, 3, 9):
        add("wall_panel", (x, 0, -12), 0); add("wall_panel", (x, 0, 12), 180)
    add("gable_wall", (0, 0, -12), 0); add("gable_wall", (0, 0, 12), 180)
    for z in (-10, -6, -2, 2, 6, 10): add("roof_truss", (0, 0, z))
    add("teacup", (-5.7, 2.1, -4), 0); add("teacup", (5.7, 2.1, -4), 180)
    return pl

# ---------- export ----------
def clear():
    bpy.ops.object.select_all(action="SELECT"); bpy.ops.object.delete()

def export(name, objs):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    path = os.path.join(OUT, name + ".glb")
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_image_format="AUTO", export_materials="EXPORT")
    return path

def tri_count(objs):
    return sum(len(o.data.polygons) and sum(len(p.vertices) - 2 for p in o.data.polygons) for o in objs)

def signed_volume(o):
    me = o.data; v = 0.0
    for p in me.polygons:
        vs = [me.vertices[i].co for i in p.vertices]
        for i in range(1, len(vs) - 1):
            v += vs[0].dot(vs[i].cross(vs[i + 1])) / 6.0
    return v

def tex_check(objs):
    seen = {}
    for o in objs:
        for m in o.data.materials:
            for n in m.node_tree.nodes:
                if n.type == "TEX_IMAGE":
                    px = np.array(n.image.pixels[:])
                    seen[n.image.name] = float(px.reshape(-1, 4)[:, :3].mean())
    return seen

def uv_check(objs):
    bad = 0
    for o in objs:
        uv = o.data.uv_layers.active
        if uv is None: bad += 1; continue
        arr = np.array([d.uv[:] for d in uv.data])
        if not np.isfinite(arr).all(): bad += 1
    return bad

def add_light(kind, loc, energy, color, size=1.0, name="L"):
    ld = bpy.data.lights.new(name, kind); ld.energy = energy; ld.color = color
    if kind == "AREA": ld.size = size
    if kind == "POINT": ld.shadow_soft_size = size
    ld.use_shadow = name in ("fire", "warm")
    lo = bpy.data.objects.new(name, ld); bpy.context.scene.collection.objects.link(lo); lo.location = G(loc)
    return lo

def render_view(png, cam_loc, target, lens, hide=(), res=(1600, 900)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE_NEXT"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.filepath = png
    cam = bpy.data.cameras.new("cam"); cam.lens = lens; cam.clip_end = 100
    co = bpy.data.objects.new("cam", cam); sc.collection.objects.link(co)
    co.location = G(cam_loc)
    co.rotation_euler = (G(target) - co.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    hidden = [o for o in bpy.data.objects if o.get("layout") and o.get("asset") in hide]
    for o in hidden: o.hide_render = True
    bpy.ops.render.render(write_still=True)
    for o in hidden: o.hide_render = False
    bpy.data.objects.remove(co)

def main():
    clear()
    P = palette()
    names = ONLY.split(",") if ONLY else list(ASSETS)
    stats = {"assets": {}, "unique_triangles": 0}
    data = {}
    for n in names:
        objs = ASSETS[n](P).build()
        export(n, objs)
        for o in objs: o.hide_render = True; o.hide_viewport = True
        vol = [signed_volume(o) for o in objs]
        tex = tex_check(objs)
        t = tri_count(objs)
        stats["assets"][n] = {"triangles": t, "draw_calls_per_instance": len(objs), "materials": [o.data.materials[0].name for o in objs],
                              "glb_bytes": os.path.getsize(os.path.join(OUT, n + ".glb")),
                              "min_texture_mean": round(min(tex.values()), 3), "signed_volume_positive": all(v > 0 for v in vol),
                              "bad_uv_meshes": uv_check(objs)}
        stats["unique_triangles"] += t
        data[n] = objs
    pl = layout()
    if not ONLY:
        manifest = {"schema": 1, "assets": {n: n + ".glb" for n in names}, "placements": pl}
        json.dump(manifest, open(os.path.join(OUT, "placement_enchanted_kitchen.json"), "w"), indent=1)
        # instances
        col = bpy.data.collections.new("layout"); bpy.context.scene.collection.children.link(col)
        inst = 0; dc = 0
        for p in pl:
            for o in data[p["asset"]]:
                c = bpy.data.objects.new("i_" + o.name, o.data); col.objects.link(c)
                c.location = G(p["position"]); c.rotation_euler = (0, 0, math.radians(p["yaw_degrees"])); c.scale = (p["scale"],) * 3
                c["layout"] = 1; c["asset"] = p["asset"]; dc += 1
        stats["placed_instances"] = len(pl); stats["approx_draw_calls_no_batching"] = dc
        stats["triangles_placed_total"] = sum(stats["assets"][p["asset"]]["triangles"] for p in pl)
        # lighting (preview only; the game owns its own lights)
        w = bpy.data.worlds.new("w"); w.use_nodes = True
        w.node_tree.nodes["Background"].inputs[0].default_value = (.5, .38, .28, 1); w.node_tree.nodes["Background"].inputs[1].default_value = .5
        bpy.context.scene.world = w
        add_light("POINT", (0, 1.2, -9.2), 900, (1, .55, .2), 1.0, "fire")
        for z in (-8, -2, 4, 9): add_light("POINT", (0, 4.6, z), 700, (1, .78, .5), 1.0, "warm")
        for x in (-6, 6):
            for z in (-8, 4): add_light("POINT", (x, 3.5, z), 300, (1, .7, .4), .6, "fill")
        add_light("POINT", (-5.7, 2.1, -4), 80, (.5, .7, 1), .3, "cupL"); add_light("POINT", (5.7, 2.1, -4), 80, (.5, .7, 1), .3, "cupR")
        bpy.context.scene.view_settings.view_transform = "AgX"
        render_view(os.path.join(OUT, "preview_ground.png"), (0, 1.6, 11.3), (0, 1.9, -6), 20)
        render_view(os.path.join(OUT, "preview_elevated.png"), (0, 21, 17), (0, 0, -3.5), 34, hide=("roof_truss", "gable_wall"))
        bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "kitchen.blend"))
    else:
        render_view(os.path.join(OUT, "first_lit.png"), (3.5, 2.5, 4.5), (0, .7, 0), 28)
    json.dump(stats, open(os.path.join(OUT, "stats.json"), "w"), indent=1)
    print("STATS", json.dumps(stats))

main()
