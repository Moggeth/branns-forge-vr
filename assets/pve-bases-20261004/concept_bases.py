"""Brann's Forge - PvE home bases CONCEPT renders (2026-10-04). Not a game kit yet.

Dawnhold (good, blue resonance) and Grumblekeep (evil, goofy gloom-violet), each inside a shield dome
held up by three pylons, with a heart forge, barracks, fountain, two crystal spires and two ballistas.
  python3 concept_bases.py [good|evil|both] [samples]
Renders land in ./renders/.  Reuses the landmark kit's procedural textures.
"""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "landmarks-20261004"))
import build_landmarks as L
L.TEXDIR = os.path.join(HERE, "textures"); os.makedirs(L.TEXDIR, exist_ok=True)
OUT = os.path.join(HERE, "renders"); os.makedirs(OUT, exist_ok=True)
WHICH = sys.argv[1] if len(sys.argv) > 1 else "both"
SAMPLES = int(sys.argv[2]) if len(sys.argv) > 2 else 96
R = np.random.default_rng(7)
M = {}

# ---------------------------------------------------------------- materials
def flat(name, col, rough=0.7, metal=0.0, emit=None, strength=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*col, 1); b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if emit: b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = strength
    M[name] = m; return m

def field(name, col, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); mix = nt.nodes.new("ShaderNodeMixShader")
    tr = nt.nodes.new("ShaderNodeBsdfTransparent"); em = nt.nodes.new("ShaderNodeEmission")
    lw = nt.nodes.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.25
    ramp = nt.nodes.new("ShaderNodeMath"); ramp.operation = "POWER"; ramp.inputs[1].default_value = 1.6
    sc = nt.nodes.new("ShaderNodeMath"); sc.operation = "MULTIPLY"; sc.inputs[1].default_value = 0.85
    em.inputs["Color"].default_value = (*col, 1); em.inputs["Strength"].default_value = strength
    nt.links.new(lw.outputs["Facing"], ramp.inputs[0]); nt.links.new(ramp.outputs[0], sc.inputs[0])
    nt.links.new(sc.outputs[0], mix.inputs[0]); nt.links.new(tr.outputs[0], mix.inputs[1]); nt.links.new(em.outputs[0], mix.inputs[2])
    nt.links.new(mix.outputs[0], out.inputs["Surface"]); m.blend_method = "BLEND" if hasattr(m, "blend_method") else None
    M[name] = m; return m

def boxmat(name, scale, emissive=False, strength=1.0, src=None, tint=None):
    src = src or name
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (scale, scale, scale)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    def tex(sfx, cs):
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = L.load_img(f"{src}_{sfx}.png", cs); t.projection = "BOX"; t.projection_blend = 0.3
        nt.links.new(mp.outputs["Vector"], t.inputs["Vector"]); return t
    bc = tex("bc", "sRGB")
    if tint:
        mx = nt.nodes.new("ShaderNodeMix"); mx.data_type = "RGBA"; mx.blend_type = "MULTIPLY"; mx.inputs["Factor"].default_value = 1
        nt.links.new(bc.outputs["Color"], mx.inputs[6]); mx.inputs[7].default_value = (*tint, 1); nt.links.new(mx.outputs[2], b.inputs["Base Color"])
    else: nt.links.new(bc.outputs["Color"], b.inputs["Base Color"])
    nm = tex("n", "Non-Color"); nmap = nt.nodes.new("ShaderNodeNormalMap"); nmap.inputs["Strength"].default_value = 0.8
    nt.links.new(nm.outputs["Color"], nmap.inputs["Color"]); nt.links.new(nmap.outputs["Normal"], b.inputs["Normal"])
    orm = tex("orm", "Non-Color"); sp = nt.nodes.new("ShaderNodeSeparateColor"); nt.links.new(orm.outputs["Color"], sp.inputs["Color"])
    nt.links.new(sp.outputs["Green"], b.inputs["Roughness"]); nt.links.new(sp.outputs["Blue"], b.inputs["Metallic"])
    if emissive:
        em = tex("em", "sRGB"); nt.links.new(em.outputs["Color"], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = strength
    return m

def grass(name, a, b, c):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; bs = nt.nodes["Principled BSDF"]
    n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = 0.35; n.inputs["Detail"].default_value = 6
    n2 = nt.nodes.new("ShaderNodeTexNoise"); n2.inputs["Scale"].default_value = 6; n2.inputs["Detail"].default_value = 3
    cr = nt.nodes.new("ShaderNodeValToRGB"); cr.color_ramp.elements[0].color = (*a, 1); cr.color_ramp.elements[1].color = (*b, 1)
    e = cr.color_ramp.elements.new(0.75); e.color = (*c, 1)
    mx = nt.nodes.new("ShaderNodeMath"); mx.operation = "MULTIPLY_ADD"; mx.inputs[1].default_value = 0.25
    nt.links.new(n2.outputs["Fac"], mx.inputs[0]); nt.links.new(n.outputs["Fac"], mx.inputs[2])
    nt.links.new(mx.outputs[0], cr.inputs["Fac"]); nt.links.new(cr.outputs["Color"], bs.inputs["Base Color"])
    bs.inputs["Roughness"].default_value = 0.95; M[name] = m; return m

def materials():
    if not os.path.exists(os.path.join(L.TEXDIR, "Moss_orm.png")):
        L.tex_stone("Stone", 512, 41); L.tex_wood("Wood", 512, 85); L.tex_bronze("Bronze", 512, 63); L.tex_crystal("Crystal", 256, 74); L.tex_moss("Moss", 256, 52)
    for n, sc in (("Stone", 0.45), ("Wood", 0.6), ("Bronze", 1.0), ("Moss", 0.5)): M[n] = boxmat(n, sc)
    M["Crystal"] = boxmat("Crystal", 1.2, emissive=True, strength=7)
    dk = boxmat("DarkStone", 0.45, src="Stone", tint=(0.42, 0.36, 0.48)); M["DarkStone"] = dk
    L.MATS.update(M)
    flat("Slate", (0.16, 0.20, 0.27), 0.6); flat("Banner", (0.10, 0.30, 0.75), 0.8)
    flat("Ember", (1, .4, .1), .5, emit=(1.0, 0.42, 0.08), strength=18)
    flat("Water", (0.2, 0.6, 1.0), 0.05, emit=(0.25, 0.65, 1.0), strength=4)
    flat("Glow", (0.5, 0.8, 1.0), 0.3, emit=(0.35, 0.75, 1.0), strength=25)
    flat("Body", (0.55, 0.52, 0.48), 0.8); flat("Eye", (0, 0, 0), 0.4, emit=(0.4, 0.85, 1), strength=30)
    flat("Iron", (0.07, 0.065, 0.07), 0.55, 0.6); flat("RustIron", (0.22, 0.12, 0.08), 0.75, 0.3)
    flat("Bone", (0.86, 0.80, 0.66), 0.6); flat("Socket", (0.02, 0.01, 0.03), 0.9)
    flat("Gloom", (0.45, 0.1, 0.9), 0.2, emit=(0.55, 0.1, 1.0), strength=4.5)
    flat("GloomEye", (0, 0, 0), 0.4, emit=(0.75, 1.0, 0.25), strength=30)
    flat("Ooze", (0.4, 1, .2), 0.1, emit=(0.45, 1.0, 0.2), strength=6)
    flat("Cloth", (0.35, 0.08, 0.45), 0.85)
    flat("Rope", (0.8, 0.75, 0.6), 0.9)
    field("FieldGood", (0.3, 0.7, 1.0), 2.2); field("FieldEvil", (0.75, 0.25, 1.0), 2.2)
    field("HexGood", (0.4, 0.8, 1.0), 5.0); field("HexEvil", (0.8, 0.35, 1.0), 5.0)
    grass("GrassGood", (0.035, 0.09, 0.015), (0.07, 0.16, 0.025), (0.12, 0.19, 0.04))
    grass("GrassEvil", (0.04, 0.045, 0.025), (0.07, 0.075, 0.035), (0.09, 0.06, 0.08))

# ---------------------------------------------------------------- primitives
def _fin(ob, mat, bevel=0.0, smooth=False, uv=True):
    if mat: ob.data.materials.append(M[mat] if isinstance(mat, str) else mat)
    if bevel: m = ob.modifiers.new("b", "BEVEL"); m.width = bevel; m.segments = 2; m.limit_method = "ANGLE"
    if smooth: bpy.ops.object.shade_smooth()
    return ob

def box(loc, size, mat, rot=(0, 0, 0), bevel=0.03):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot); ob = bpy.context.object; ob.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    bpy.ops.object.transform_apply(scale=True); return _fin(ob, mat, bevel)

def cyl(loc, r, h, mat, verts=24, rot=(0, 0, 0), r2=None, bevel=0.02, smooth=False):
    if r2 is None: bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    else: bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h, location=loc, rotation=rot)
    return _fin(bpy.context.object, mat, bevel, smooth)

def sph(loc, r, mat, scale=(1, 1, 1), seg=24, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc, rotation=rot)
    ob = bpy.context.object; ob.scale = scale; return _fin(ob, mat, 0, True)

def tor(loc, R_, r, mat, rot=(0, 0, 0), arc=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=R_, minor_radius=r, location=loc, rotation=rot, major_segments=40, minor_segments=10)
    return _fin(bpy.context.object, mat, 0, True)

def crystal(loc, base_r, n, length, mat="Crystal", up=1.0, spread=0.55, seed=1):
    seed = abs(int(seed)); ob = L.crystal_cluster(f"cx{seed}", seed, base_r, n, length, spread=spread, up_bias=up); ob.location = loc
    ob.data.materials.clear(); ob.data.materials.append(M[mat]); return ob

def light(loc, col, power, r=0.3):
    d = bpy.data.lights.new("l", "POINT"); d.color = col; d.energy = power; d.shadow_soft_size = r
    ob = bpy.data.objects.new("l", d); ob.location = loc; bpy.context.scene.collection.objects.link(ob); return ob

def group(objs, loc, yaw):
    """Move a set of objects built around the origin to loc, turned by yaw about Z."""
    e = bpy.data.objects.new("g", None); bpy.context.scene.collection.objects.link(e)
    for o in objs: o.parent = e
    e.location = loc; e.rotation_euler = (0, 0, yaw); return e

def built(fn, *a, **k):
    before = set(bpy.data.objects); fn(*a, **k); return [o for o in bpy.data.objects if o not in before and o.parent is None]

def prism(loc, length, width, height, mat):
    """Gable roof: ridge along X."""
    x, w, h = length / 2, width / 2, height
    V = [(-x, -w, 0), (x, -w, 0), (x, w, 0), (-x, w, 0), (-x, 0, h), (x, 0, h)]
    F = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (0, 3, 2, 1)]
    me = bpy.data.meshes.new("roof"); me.from_pydata(V, [], F); ob = bpy.data.objects.new("roof", me)
    bpy.context.scene.collection.objects.link(ob); ob.location = loc
    sol = ob.modifiers.new("s", "SOLIDIFY"); sol.thickness = 0.18
    return _fin(ob, mat, 0.03)

def polar(r, deg): a = math.radians(deg); return (r * math.cos(a), r * math.sin(a))

# ---------------------------------------------------------------- shared pieces
def ground(evil):
    bpy.ops.mesh.primitive_plane_add(size=900, location=(0, 0, 0)); _fin(bpy.context.object, "GrassEvil" if evil else "GrassGood")
    cyl((0, 0, 0.02), 9.5, 0.08, "DarkStone" if evil else "Stone", verts=48 if not evil else 9, bevel=0.03)
    for i in range(36):  # flagstone ring joints / cracks
        a = i / 36 * math.tau; box((math.cos(a) * 7.5, math.sin(a) * 7.5, 0.065), (3.6, 0.06, 0.02), "Socket", rot=(0, 0, a + math.pi / 2), bevel=0)
    box((0, 22, 0.01), (5.5, 30, 0.04), "RustIron" if evil else "Wood", bevel=0)  # lane path out of the gate
    r = np.random.default_rng(3 if evil else 4)
    for i in range(70):  # rocks and tufts so the field reads at scale
        a = r.random() * math.tau; d = 15 + r.random() * 30
        sph((math.cos(a) * d, math.sin(a) * d, 0.0), 0.2 + r.random() * 0.5, "DarkStone" if evil else "Moss", scale=(1.3, 1, 0.55))

def trees(evil):
    r = np.random.default_rng(11 if evil else 12)
    leaf = flat("LeafE" if evil else "Leaf", (0.22, 0.16, 0.24) if evil else (0.05, 0.16, 0.02), 0.9)
    for i in range(40):
        a = r.random() * math.tau; d = 19 + r.random() * 34; x, y = math.cos(a) * d, math.sin(a) * d
        if abs(x) < 5 and y > 0: continue
        h = 3 + r.random() * 3
        cyl((x, y, h / 2), 0.22, h, "Wood", verts=8, r2=0.14)
        if evil:
            for k in range(3): cyl((x, y, h * 0.8), 0.06, 1.8, "Wood", verts=6, r2=0.01, rot=(0.9, 0, k * 2.1 + i))
        else:
            for k in range(3): sph((x + r.normal() * 0.6, y + r.normal() * 0.6, h + 0.3 + k * 0.7), 1.5 - k * 0.3, leaf, scale=(1, 1, 0.85), seg=12)

def dome(evil, pylons):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=13.5, location=(0, 0, -1.2)); _fin(bpy.context.object, "FieldEvil" if evil else "FieldGood", 0, True)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=13.52, location=(0, 0, -1.2)); ob = bpy.context.object
    w = ob.modifiers.new("w", "WIREFRAME"); w.thickness = 0.035; _fin(ob, "HexEvil" if evil else "HexGood")
    for a in pylons: (pylon_evil if evil else pylon_good)(*polar(13.2, a))

def forgeling(loc, yaw, tool=False):
    s = []
    s.append(sph((0, 0, 0.55), 0.36, "Stone", scale=(1, 0.9, 1.05)))
    s.append(sph((0, 0, 1.02), 0.26, "Stone"))
    s.append(sph((0, 0, 1.1), 0.285, "Bronze", scale=(1, 1, 0.62)))          # brass helmet
    s.append(cyl((0, 0, 1.36), 0.04, 0.18, "Bronze"))
    s.append(sph((0, 0, 1.47), 0.07, "Glow"))                                  # little crystal finial
    for x in (-0.09, 0.09): s.append(sph((x, -0.23, 1.02), 0.055, "Eye"))
    for x in (-0.16, 0.16): s.append(cyl((x, 0, 0.13), 0.08, 0.26, "Bronze", verts=10))
    for x in (-0.38, 0.38): s.append(sph((x, -0.05, 0.6), 0.1, "Stone", scale=(1, 1, 1.8)))
    s.append(tor((0, 0, 0.62), 0.33, 0.03, "Bronze"))
    if tool:
        s.append(cyl((0.45, -0.15, 0.55), 0.025, 0.6, "Wood", verts=8, rot=(0.5, 0, 0)))
        s.append(box((0.45, -0.28, 0.82), (0.22, 0.12, 0.12), "Bronze", rot=(0.5, 0, 0)))
    group(s, loc, yaw)

def skeleton(loc, yaw):
    s = []
    s.append(sph((0, 0, 1.25), 0.3, "Bone", scale=(1, 0.95, 0.92)))            # big cartoon skull
    s.append(sph((0, -0.03, 1.08), 0.2, "Bone", scale=(1, 0.9, 0.5)))           # jaw
    for x in (-0.11, 0.11): s.append(sph((x, -0.24, 1.29), 0.09, "Socket")); s.append(sph((x, -0.3, 1.29), 0.035, "GloomEye"))
    for z in (0.72, 0.62, 0.52): s.append(tor((0, 0, z), 0.16, 0.025, "Bone"))
    s.append(cyl((0, 0, 0.6), 0.03, 0.55, "Bone", verts=8))
    for x in (-0.1, 0.1): s.append(cyl((x, 0, 0.2), 0.03, 0.42, "Bone", verts=8))
    for x in (-0.24, 0.24): s.append(cyl((x, -0.05, 0.62), 0.025, 0.4, "Bone", verts=8, rot=(0.4, 0, 0)))
    group(s, loc, yaw)

# ---------------------------------------------------------------- Dawnhold
def heart_good():
    cyl((0, 0, 0.3), 2.8, 0.5, "Stone", verts=8, bevel=0.06); cyl((0, 0, 0.7), 2.2, 0.4, "Stone", verts=8, bevel=0.05)
    box((0, 0.6, 1.4), (2.0, 1.4, 1.1), "Stone", bevel=0.08)                     # hearth
    box((0, -0.12, 1.3), (1.0, 0.1, 0.55), "Ember", bevel=0)
    cyl((0, 0.9, 3.0), 0.38, 3.0, "Bronze", verts=16, r2=0.3); tor((0, 0.9, 4.45), 0.38, 0.06, "Bronze")
    for z in (2.1, 3.2): tor((0, 0.9, z), 0.36, 0.05, "Bronze")
    # anvil
    box((1.3, -1.2, 1.2), (0.5, 0.4, 0.6), "Iron", bevel=0.04); box((1.3, -1.2, 1.6), (1.2, 0.42, 0.24), "Iron", bevel=0.05)
    cyl((2.05, -1.2, 1.62), 0.18, 0.5, "Iron", verts=12, r2=0.02, rot=(0, math.pi / 2, 0))
    # floating heart crystal with brass orbit rings
    crystal((0, -0.4, 3.9), 0.0, 1, 2.8, seed=11, spread=0); crystal((0, -0.4, 3.95), 0.45, 7, 1.1, up=-1, seed=12); crystal((0, -0.4, 4.1), 0.3, 5, 1.3, seed=13)
    tor((0, -0.4, 4.8), 1.1, 0.06, "Bronze", rot=(0.5, 0.2, 0)); tor((0, -0.4, 4.8), 1.35, 0.05, "Bronze", rot=(-0.3, 0.7, 0))
    light((0, -0.4, 4.8), (0.4, 0.75, 1.0), 900, 0.6); light((0, -0.6, 1.4), (1, .45, .12), 250)
    for a in range(0, 360, 45): crystal((*polar(2.45, a + 22.5), 0.5), 0.12, 3, 0.45, seed=20 + a)

def barracks_good():
    box((0, 0, 0.35), (6.4, 4.4, 0.7), "Stone", bevel=0.06)
    box((0, 0, 1.95), (5.8, 3.8, 2.5), "Wood", bevel=0.03)
    for x in (-2.9, 2.9):
        for y in (-1.9, 1.9): box((x, y, 1.95), (0.35, 0.35, 2.6), "Stone", bevel=0.04)
    prism((0, 0, 3.2), 7.0, 5.0, 2.4, "Slate")
    box((0, -1.95, 1.55), (1.8, 0.2, 2.2), "Iron", bevel=0.05)                    # big door
    cyl((0, -2.08, 1.65), 0.42, 0.08, "Bronze", verts=12, rot=(math.pi / 2, 0, 0))   # gear emblem
    for k in range(12): a = k / 12 * math.tau; box((math.cos(a) * 0.48, -2.08, 1.65 + math.sin(a) * 0.48), (0.14, 0.08, 0.14), "Bronze", rot=(0, -a, 0))
    for x in (-2.3, 2.3): box((x, -2.0, 2.4), (0.8, 0.04, 1.6), "Banner", bevel=0); sph((x, -2.05, 2.6), 0.13, "Glow")
    cyl((1.8, 1.2, 5.0), 0.3, 1.4, "Stone", verts=8)                              # little chimney

def fountain_good():
    cyl((0, 0, 0.35), 2.0, 0.7, "Stone", verts=32, bevel=0.06); cyl((0, 0, 0.62), 1.75, 0.12, "Water", verts=32, bevel=0)
    cyl((0, 0, 1.3), 0.32, 1.5, "Stone", verts=12); cyl((0, 0, 2.05), 0.9, 0.3, "Stone", verts=24, r2=1.05)
    cyl((0, 0, 2.18), 0.8, 0.06, "Water", verts=24, bevel=0); crystal((0, 0, 2.2), 0.25, 5, 0.9, seed=31)
    light((0, 0, 1.6), (0.3, 0.7, 1.0), 300, 1.0)

def pylon_good(x, y):
    s = [cyl((0, 0, 0.25), 0.9, 0.5, "Stone", verts=8), cyl((0, 0, 2.3), 0.55, 4.0, "Stone", verts=4, r2=0.3, rot=(0, 0, math.pi / 4))]
    s += [tor((0, 0, z), 0.5 - z * 0.05, 0.05, "Bronze") for z in (1.2, 2.6)]
    s.append(crystal((0, 0, 4.2), 0.15, 4, 1.1, seed=int(x * 7 + y)))
    s.append(sph((0, 0, 5.0), 0.35, "Glow"))
    group(s, (x, y, 0), math.atan2(y, x)); light((x, y, 5), (0.35, 0.75, 1), 120)

def spire_good(x, y):
    cyl((x, y, 0.4), 1.1, 0.8, "Stone", verts=8); cyl((x, y, 3.3), 0.65, 5.0, "Stone", verts=6, r2=0.32)
    for z in (1.6, 3.0, 4.6): tor((x, y, z), 0.6 - z * 0.06, 0.05, "Bronze")
    crystal((x, y, 5.7), 0.15, 5, 1.6, seed=int(abs(x) * 3 + 50)); tor((x, y, 7.0), 0.7, 0.04, "Glow", rot=(0.3, 0, 0))
    light((x, y, 6.6), (0.35, 0.75, 1), 200)

def ballista(x, y, yaw, evil=False):
    wood = "Iron" if evil else "Wood"; trim = "RustIron" if evil else "Bronze"; s = []
    s.append(cyl((0, 0, 0.35), 0.95, 0.7, "DarkStone" if evil else "Stone", verts=10))
    s.append(box((0, 0, 0.95), (0.6, 0.6, 0.5), wood)); s.append(box((0, -0.6, 1.25), (0.25, 2.2, 0.18), wood))
    for sgn in (-1, 1):
        s.append(box((sgn * 0.75, -1.25, 1.3), (1.4, 0.14, 0.14), trim, rot=(0, 0, sgn * 0.35)))
        s.append(cyl((sgn * 0.68, -0.85, 1.3), 0.01, 1.05, "Rope", verts=6, rot=(0, math.pi / 2, sgn * -0.75), bevel=0))
    s.append(cyl((0, -1.1, 1.42), 0.04, 2.2, wood, verts=8, rot=(math.pi / 2, 0, 0)))
    s.append(cyl((0, -2.3, 1.42), 0.08, 0.3, "Gloom" if evil else "Glow", verts=8, r2=0.0, rot=(math.pi / 2, 0, 0)))
    if evil:
        s.append(sph((0, -1.0, 1.75), 0.26, "Bone")); s += [sph((sx, -1.2, 1.79), 0.06, "GloomEye") for sx in (-0.08, 0.08)]
    group(s, (x, y, 0), yaw)

def build_good():
    ground(False); trees(False); dome(False, (60, 120, 270))
    g = built(heart_good); group(g, (0, 0, 0), math.pi)
    g = built(barracks_good); group(g, (-5.4, 2.6, 0), math.pi + 0.55)
    g = built(fountain_good); group(g, (5.2, 3.2, 0), 0)
    for x in (-4.0, 4.0): spire_good(x, 16.0)
    for x, yw in ((-9.5, 0.5), (9.5, -0.5)): ballista(x, 14.5, math.pi + yw)
    for p in [(-3.4, -1.2, 3.0), (-2.0, -0.6, 3.4), (3.0, -0.7, 2.6), (-1.0, 8.5, 3.1), (1.0, 9.6, 3.2), (0.1, 11.2, 3.1)]:
        forgeling((p[0], -p[1] + 4, 0), p[2], tool=p[0] > 0)

# ---------------------------------------------------------------- Grumblekeep
def skull(loc, r, scale=1.0, yaw=0):
    s = [sph((0, 0, 0), r, "Bone", scale=(1, 0.95, 0.9)), sph((0, -r * 0.08, -r * 0.6), r * 0.7, "Bone", scale=(1, 0.85, 0.55))]
    for x in (-0.36, 0.36):
        s.append(sph((x * r, -r * 0.78, r * 0.08), r * 0.3, "Socket")); s.append(sph((x * r, -r * 0.98, r * 0.08), r * 0.11, "GloomEye"))
    s.append(sph((0, -r * 0.93, -r * 0.28), r * 0.1, "Socket", scale=(0.8, 1, 1.2)))
    for k in range(5): box(((k - 2) * r * 0.16, -r * 0.83, -r * 0.62), (r * 0.12, r * 0.08, r * 0.2), "Bone", rot=(0, 0, 0.1 * (k - 2)))
    return group(s, loc, yaw)

def heart_evil():
    cyl((0, 0, 0.3), 2.8, 0.5, "DarkStone", verts=7, bevel=0.06); cyl((0, 0, 0.7), 2.2, 0.4, "DarkStone", verts=7, bevel=0.05)
    cyl((0, 0.3, 1.5), 1.4, 1.3, "Iron", verts=20, r2=1.1, bevel=0.04); tor((0, 0.3, 2.15), 1.12, 0.12, "RustIron")
    cyl((0, 0.3, 2.12), 1.05, 0.1, "Ooze", verts=20, bevel=0)
    for k in range(6): sph((*polar(0.6, k * 60 + 10), 2.2), 0.1 + 0.05 * (k % 3), "Ooze")
    skull((0, -1.0, 1.55), 0.55)                                                       # goofy skull bellows on the front
    for i, (dx, dz, t) in enumerate(((0, 0, 0), (0.15, 1.0, 0.2), (0.0, 2.0, -0.15), (0.3, 2.9, 0.3))):  # crooked chimney
        cyl((0.9 + dx, 1.3, 2.6 + dz), 0.36 - i * 0.03, 1.05, "RustIron", verts=10, rot=(t, 0, 0))
    crystal((0, -0.2, 3.9), 0.0, 1, 2.7, mat="Gloom", seed=61, spread=0); crystal((0, -0.2, 4.1), 0.35, 6, 1.3, mat="Gloom", seed=63); crystal((0, -0.2, 4.2), 0.4, 7, 0.9, mat="Gloom", up=-1, seed=62)
    for a in (0, 120, 240): cyl((*polar(0.9, a), 5.2), 0.03, 2.2, "Iron", verts=6, rot=(0.35, 0, math.radians(a)))   # chains up
    tor((0, -0.2, 4.6), 1.2, 0.07, "RustIron", rot=(0.4, -0.3, 0))
    for a in range(0, 360, 51): cyl((*polar(2.5, a), 1.4), 0.12, 1.4, "Bone", verts=6, r2=0.0)   # bone spikes around the rim
    light((0, -0.2, 4.6), (0.65, 0.25, 1.0), 900, 0.6); light((0, 0.3, 2.6), (0.45, 1.0, 0.25), 200)

def barracks_evil():
    box((0, 0, 0.35), (6.4, 4.4, 0.7), "DarkStone", bevel=0.06)
    box((0, 0.3, 1.8), (5.6, 3.4, 2.2), "DarkStone", bevel=0.06)
    for k in range(7):                                                                   # ribcage roof
        y = -1.5 + k * 0.55; tor((0, y + 0.3, 2.9), 2.5 - abs(k - 3) * 0.08, 0.13, "Bone", rot=(math.pi / 2, 0, 0))
    cyl((0, 0.3, 5.35), 0.18, 4.2, "Bone", verts=10, rot=(math.pi / 2, 0, 0))            # spine
    skull((0, -1.8, 2.0), 1.35)                                                          # the door is a giant goofy skull
    box((0, -3.05, 0.95), (1.2, 0.2, 0.9), "Socket", bevel=0.1)                          # mouth = doorway
    for x in (-2.3, 2.3): box((x, -1.4, 2.6), (0.7, 0.04, 1.5), "Cloth", bevel=0); sph((x, -1.45, 3.2), 0.12, "Gloom")

def fountain_evil():
    sph((0, 0, 0.9), 1.6, "Iron", scale=(1, 1, 0.7)); tor((0, 0, 1.75), 1.45, 0.14, "RustIron")
    cyl((0, 0, 1.72), 1.4, 0.06, "Ooze", verts=32, bevel=0)
    for k in range(9): sph((*polar(0.3 + (k % 3) * 0.35, k * 47), 1.8 + (k % 2) * 0.12), 0.1 + 0.06 * (k % 3), "Ooze")
    for a in (0, 120, 240): cyl((*polar(1.2, a), 0.3), 0.12, 0.7, "Iron", verts=6, rot=(0, 0.3, math.radians(a)))
    light((0, 0, 2.5), (0.45, 1, 0.3), 260, 1.0)

def pylon_evil(x, y):
    s = [cyl((0, 0, 0.25), 0.9, 0.5, "DarkStone", verts=5)]
    for k in range(6): s.append(cyl((0, 0, 0.8 + k * 0.62), 0.5 - k * 0.06, 0.66, "RustIron" if k % 2 else "Iron", verts=5, r2=0.42 - k * 0.06, rot=(0, 0, k * 0.4)))
    for k in range(3): s.append(cyl((*polar(0.45, k * 120), 1.0), 0.09, 1.1, "Bone", verts=6, r2=0.0, rot=(0.6, 0, math.radians(k * 120 + 90))))
    s.append(crystal((0, 0, 4.4), 0.15, 4, 1.1, mat="Gloom", seed=int(abs(x) * 5 + 70)))
    s.append(sph((0, 0, 5.1), 0.35, "Gloom"))
    group(s, (x, y, 0), math.atan2(y, x)); light((x, y, 5), (0.7, 0.25, 1), 120)

def spire_evil(x, y):
    cyl((x, y, 0.4), 1.1, 0.8, "DarkStone", verts=7)
    r = np.random.default_rng(int(abs(x) * 11))
    for k in range(5):
        a = k * 72 + r.random() * 30; cyl((x + math.cos(math.radians(a)) * 0.3, y + math.sin(math.radians(a)) * 0.3, 2.6), 0.32, 4.4 - k * 0.5, "DarkStone", verts=5, r2=0.0, rot=(0.12 * math.cos(k), 0.12 * math.sin(k), 0))
    crystal((x, y, 4.6), 0.2, 5, 1.8, mat="Gloom", seed=int(abs(x) * 3 + 90)); skull((x, y - 0.8, 1.6), 0.38)
    light((x, y, 6.4), (0.7, 0.25, 1), 200)

def build_evil():
    ground(True); trees(True); dome(True, (60, 120, 270))
    g = built(heart_evil); group(g, (0, 0, 0), math.pi)
    g = built(barracks_evil); group(g, (-5.4, 2.6, 0), math.pi + 0.55)
    g = built(fountain_evil); group(g, (5.2, 3.2, 0), 0)
    for x in (-4.0, 4.0): spire_evil(x, 16.0)
    for x, yw in ((-9.5, 0.5), (9.5, -0.5)): ballista(x, 14.5, math.pi + yw, evil=True)
    for p in [(-3.4, -1.2, 3.0), (-2.0, -0.6, 3.4), (3.0, -0.7, 2.6), (-1.0, 8.5, 3.1), (1.0, 9.6, 3.2), (0.1, 11.2, 3.1)]:
        skeleton((p[0], -p[1] + 4, 0), p[2])

# ---------------------------------------------------------------- scene + render
def scene(evil):
    sc = bpy.context.scene; sc.render.engine = "CYCLES"; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
    sc.cycles.max_bounces = 6; sc.cycles.transparent_max_bounces = 16
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900; sc.render.film_transparent = False; sc.cycles.device = "CPU"
    sc.render.image_settings.file_format = "JPEG"; sc.render.image_settings.quality = 86
    try: sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Punchy"
    except TypeError: pass
    sc.view_settings.exposure = -0.6 if not evil else -0.2
    w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True; nt = w.node_tree
    sky = nt.nodes.new("ShaderNodeTexSky"); sky.sky_type = "NISHITA"; sky.sun_elevation = math.radians(9 if evil else 24); sky.sun_rotation = math.radians(200 if evil else 135)
    sky.air_density = 2.5 if evil else 1.2; sky.dust_density = 3.0 if evil else 1.0
    bg = nt.nodes["Background"]; nt.links.new(sky.outputs["Color"], bg.inputs["Color"]); bg.inputs["Strength"].default_value = 0.25 if evil else 0.5
    sd = bpy.data.lights.new("sun", "SUN"); sd.energy = 1.4 if evil else 3.2; sd.color = (1.0, 0.62, 0.55) if evil else (1.0, 0.92, 0.8); sd.angle = math.radians(2)
    so = bpy.data.objects.new("sun", sd); so.rotation_euler = (math.radians(90 - (9 if evil else 24)), 0, math.radians(200 if evil else 135) + math.pi / 2)
    sc.collection.objects.link(so)

def camera(loc, look, lens=30, name="cam"):
    c = bpy.data.cameras.new(name); c.lens = lens; o = bpy.data.objects.new(name, c); bpy.context.scene.collection.objects.link(o)
    o.location = loc; d = Vector(look) - Vector(loc); o.rotation_euler = d.to_track_quat("-Z", "Y").to_euler(); return o

def render(path, cam):
    bpy.context.scene.camera = cam; bpy.context.scene.render.filepath = path; bpy.ops.render.render(write_still=True); print("wrote", path)

def run(evil):
    bpy.ops.wm.read_factory_settings(use_empty=True); M.clear(); materials(); scene(evil)
    (build_evil if evil else build_good)()
    tag = "grumblekeep" if evil else "dawnhold"
    render(os.path.join(OUT, f"{tag}-hero.jpg"), camera((19, 31, 15), (0, 2.5, 2.4), 28))
    render(os.path.join(OUT, f"{tag}-gate.jpg"), camera((-3.5, 24, 3.2), (0, 4, 3.4), 26))

if __name__ == "__main__":
    if WHICH in ("good", "both"): run(False)
    if WHICH in ("evil", "both"): run(True)
