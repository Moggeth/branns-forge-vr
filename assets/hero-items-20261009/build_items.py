"""Brann's Forge - Quartermaster item art, 2026-10-09. Deterministic Blender 4.5 builder (pip install bpy==4.5.*).

Models every hero item sold at the keep Quartermaster (multiplayer/shared/hero-items.js), the Healing Draught and the
tavern's Hearty Ale as small storied props, then renders each one as a shop icon: Cycles, transparent background,
three-quarter view, warm key, cool rim, written as WebP to multiplayer/public/assets/items/<id>.webp.

  python3.11 build_items.py                 # every icon (about a minute each on 4 cores at 64 samples)
  python3.11 build_items.py hat,locket 32   # a subset, at 32 samples
  python3.11 build_items.py sheet           # plus renders/sheet.png, a labelled contact sheet

Blender space: Z up, the item's "face" toward -Y (the camera sits front-right-above). Sizes are real-world metres so
the same functions can feed shelf props later.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix, Euler

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "..", "multiplayer", "public", "assets", "items"))
RENDERS = os.path.join(HERE, "renders")
TAU = 2 * math.pi
ICON = 192

# ------------------------------------------------------------------------------------------------ materials
_MATS = {}
def mat(name, rgb, metal=0.0, rough=0.5, emit=None, estr=0.0, trans=0.0, ior=1.45, wear=0.25, scale=18.0, coat=0.0, alpha=1.0):
    """Principled material with a little procedural breakup: noise drives roughness and darkens the base colour a
    touch (wear and grime), so even small props read as made of something."""
    if name in _MATS: return _MATS[name]
    lin = lambda c: tuple(v ** 2.2 for v in c)  # palette values are picked as sRGB
    rgb = lin(rgb); emit = lin(emit) if emit else None
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Metallic"].default_value = metal; b.inputs["Roughness"].default_value = rough
    b.inputs["Transmission Weight"].default_value = trans; b.inputs["IOR"].default_value = ior
    b.inputs["Coat Weight"].default_value = coat
    if alpha < 1: b.inputs["Alpha"].default_value = alpha
    tc = nt.nodes.new("ShaderNodeTexCoord"); nz = nt.nodes.new("ShaderNodeTexNoise"); nz.inputs["Scale"].default_value = scale; nz.inputs["Detail"].default_value = 6
    nt.links.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB"); ramp.color_ramp.elements[0].position = 0.35; ramp.color_ramp.elements[1].position = 0.75
    c0 = [c * (1 - wear) for c in rgb]; ramp.color_ramp.elements[0].color = (*c0, 1); ramp.color_ramp.elements[1].color = (*rgb, 1)
    nt.links.new(nz.outputs["Fac"], ramp.inputs["Fac"]); nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    rr = nt.nodes.new("ShaderNodeMapRange"); rr.inputs["To Min"].default_value = max(0.02, rough - 0.15); rr.inputs["To Max"].default_value = min(1, rough + 0.2)
    nt.links.new(nz.outputs["Fac"], rr.inputs["Value"]); nt.links.new(rr.outputs["Result"], b.inputs["Roughness"])
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.12 if metal < 0.5 else 0.05; bump.inputs["Distance"].default_value = 0.002
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1); b.inputs["Emission Strength"].default_value = estr
    _MATS[name] = m; return m

def M(key):
    """The shared palette."""
    P = {
        "brass": dict(rgb=(0.95, 0.68, 0.30), metal=1, rough=0.32, wear=0.35),
        "gold": dict(rgb=(1.0, 0.76, 0.32), metal=1, rough=0.22, wear=0.2),
        "copper": dict(rgb=(0.92, 0.48, 0.30), metal=1, rough=0.35, wear=0.35),
        "iron": dict(rgb=(0.42, 0.44, 0.48), metal=1, rough=0.45, wear=0.4),
        "steel": dict(rgb=(0.75, 0.78, 0.82), metal=1, rough=0.25, wear=0.25),
        "leather": dict(rgb=(0.42, 0.22, 0.10), rough=0.62, wear=0.35, scale=30),
        "leather_dk": dict(rgb=(0.20, 0.11, 0.06), rough=0.6, wear=0.3, scale=30),
        "leather_red": dict(rgb=(0.55, 0.14, 0.10), rough=0.55, wear=0.3, scale=30),
        "wood": dict(rgb=(0.55, 0.33, 0.17), rough=0.6, wear=0.35, scale=9),
        "wood_lt": dict(rgb=(0.78, 0.55, 0.32), rough=0.55, wear=0.3, scale=9),
        "cork": dict(rgb=(0.75, 0.55, 0.33), rough=0.8, wear=0.3, scale=60),
        "stone": dict(rgb=(0.42, 0.48, 0.58), rough=0.8, wear=0.35, scale=26),
        "felt_blue": dict(rgb=(0.10, 0.18, 0.45), rough=0.85, wear=0.2, scale=40),
        "felt_navy": dict(rgb=(0.07, 0.09, 0.2), rough=0.85, wear=0.2, scale=40),
        "feather": dict(rgb=(0.97, 0.93, 0.85), rough=0.7, wear=0.08),
        "red_feather": dict(rgb=(0.85, 0.18, 0.12), rough=0.7, wear=0.1),
        "cloth_cream": dict(rgb=(0.92, 0.85, 0.68), rough=0.85, wear=0.2, scale=50),
        "paper": dict(rgb=(0.93, 0.86, 0.68), rough=0.85, wear=0.25),
        "ink": dict(rgb=(0.12, 0.08, 0.06), rough=0.6, wear=0.0),
        "foam": dict(rgb=(1.0, 0.97, 0.9), rough=0.65, wear=0.06, scale=30),
        "glass": dict(rgb=(0.92, 0.97, 1.0), rough=0.02, trans=1.0, wear=0.0),
        "leech": dict(rgb=(0.12, 0.10, 0.07), rough=0.25, wear=0.3, coat=0.8),
        "leech_belly": dict(rgb=(0.55, 0.38, 0.15), rough=0.3, wear=0.2, coat=0.6),
        "ruby": dict(rgb=(0.85, 0.05, 0.08), rough=0.05, trans=0.6, emit=(0.6, 0.02, 0.04), estr=0.6, wear=0.0),
        "sapphire": dict(rgb=(0.25, 0.55, 1.0), rough=0.05, trans=0.4, emit=(0.3, 0.6, 1.0), estr=2.5, wear=0.0),
        "heartstone": dict(rgb=(1.0, 0.35, 0.6), rough=0.08, trans=0.3, emit=(1.0, 0.3, 0.55), estr=3.0, wear=0.0),
        "draught": dict(rgb=(0.08, 0.38, 0.95), rough=0.15, trans=0.0, emit=(0.1, 0.45, 1.0), estr=1.1, wear=0.0),
        "tonic_green": dict(rgb=(0.4, 0.9, 0.3), rough=0.05, trans=0.4, emit=(0.4, 0.9, 0.25), estr=1.4, wear=0.0),
        "ale": dict(rgb=(0.85, 0.5, 0.1), rough=0.1, trans=0.3, emit=(0.7, 0.35, 0.05), estr=0.4, wear=0.0),
        "steam": dict(rgb=(1, 1, 1), rough=1.0, alpha=0.35, wear=0.0),
        "rubber": dict(rgb=(0.15, 0.14, 0.13), rough=0.7, wear=0.2),
        "lace": dict(rgb=(0.85, 0.75, 0.55), rough=0.8, wear=0.2),
        "sun_enamel": dict(rgb=(0.15, 0.32, 0.85), rough=0.2, wear=0.15, coat=0.5),
    }
    return mat(key, **P[key])

# ------------------------------------------------------------------------------------------------ geometry
def link(o, coll):
    coll.objects.link(o); return o

def mesh_obj(name, V, F, material, coll, smooth=True, subd=0, bevel=0.0):
    me = bpy.data.meshes.new(name); me.from_pydata([tuple(v) for v in V], [], [list(f) for f in F]); me.update()
    o = link(bpy.data.objects.new(name, me), coll); o.data.materials.append(material)
    if smooth:
        for p in me.polygons: p.use_smooth = True
    if bevel > 0:
        b = o.modifiers.new("bev", "BEVEL"); b.width = bevel; b.segments = 2; b.limit_method = "ANGLE"
    if subd:
        s = o.modifiers.new("sub", "SUBSURF"); s.levels = s.render_levels = subd
    return o

def lathe(profile, seg=32):
    """Revolve [(r, z)] bottom -> top round Z; axis points become apexes."""
    prof = list(profile); a0 = prof[0][0] < 1e-9; a1 = prof[-1][0] < 1e-9
    ring = prof[1 if a0 else 0: len(prof) - 1 if a1 else len(prof)]; n = len(ring); V, F = [], []
    for k in range(seg):
        a = k / seg * TAU
        for r, z in ring: V.append((r * math.cos(a), r * math.sin(a), z))
    for k in range(seg):
        k2 = (k + 1) % seg
        for j in range(n - 1): F.append([k * n + j, k2 * n + j, k2 * n + j + 1, k * n + j + 1])
    if a0:
        V.append((0.0, 0.0, prof[0][1])); c = len(V) - 1
        for k in range(seg): F.append([(k + 1) % seg * n, k * n, c])
    if a1:
        V.append((0.0, 0.0, prof[-1][1])); c = len(V) - 1
        for k in range(seg): F.append([k * n + n - 1, (k + 1) % seg * n + n - 1, c])
    return np.array(V, float), F

def revolve(name, profile, material, coll, seg=32, subd=1, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1)):
    V, F = lathe(profile, seg); o = mesh_obj(name, V, F, material, coll, subd=subd)
    o.location = at; o.rotation_euler = rot; o.scale = scale; return o

def prim(kind, name, material, coll, at=(0, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), subd=0, bevel=0.0, smooth=True, **kw):
    getattr(bpy.ops.mesh, f"primitive_{kind}_add")(**kw)
    o = bpy.context.active_object; o.name = name
    for c in o.users_collection: c.objects.unlink(o)
    coll.objects.link(o); o.data.materials.append(material)
    o.location = at; o.rotation_euler = rot; o.scale = scale
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
    if bevel > 0:
        b = o.modifiers.new("bev", "BEVEL"); b.width = bevel; b.segments = 3
    if subd:
        s = o.modifiers.new("sub", "SUBSURF"); s.levels = s.render_levels = subd
    return o

def box(name, material, coll, size, at=(0, 0, 0), rot=(0, 0, 0), bevel=0.004):
    return prim("cube", name, material, coll, at=at, rot=rot, scale=(size[0] / 2, size[1] / 2, size[2] / 2), bevel=bevel / max(min(size) / 2, 1e-4) * min(size) / 2 if False else 0, smooth=False) if bevel <= 0 else _bbox(name, material, coll, size, at, rot, bevel)

def _bbox(name, material, coll, size, at, rot, bevel):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0); bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=min(bevel, 0.45 * min(size)), segments=3, affect="EDGES", profile=0.5, clamp_overlap=True)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    o = link(bpy.data.objects.new(name, me), coll); o.data.materials.append(material); o.location = at; o.rotation_euler = rot
    for p in me.polygons: p.use_smooth = True
    me.set_sharp_from_angle(angle=math.radians(40)) if hasattr(me, "set_sharp_from_angle") else None
    return o

def curve(name, pts, radius, material, coll, closed=False, res=12, bevel_res=6, radii=None, taper_end=False, flat=None):
    """A tube along a smooth path (straps, chains, springs, cords, feathers' shafts)."""
    cd = bpy.data.curves.new(name, "CURVE"); cd.dimensions = "3D"; cd.resolution_u = res
    cd.bevel_depth = radius; cd.bevel_resolution = bevel_res; cd.use_fill_caps = True
    sp = cd.splines.new("NURBS"); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts):
        sp.points[i].co = (*p, 1); sp.points[i].radius = radii[i] if radii else 1.0
    sp.use_endpoint_u = not closed; sp.use_cyclic_u = closed; sp.order_u = min(4, len(pts))
    o = link(bpy.data.objects.new(name, cd), coll); o.data.materials.append(material)
    if flat:  # flat ribbon (a strap): squash the round bevel
        o.scale = (1, 1, 1); cd.bevel_mode = "OBJECT" if False else "ROUND"
    return o

def strap(name, pts, width, thick, material, coll, closed=False, up=(0, 0, 1)):
    """A flat strap following pts (a ribbon swept with a thin rectangle), with rounded edges via subdivision."""
    P = np.array(pts, float); n = len(P); V, F = [], []
    for i in range(n):
        tg = P[(i + 1) % n] - P[i - 1] if closed else P[min(i + 1, n - 1)] - P[max(i - 1, 0)]
        tg /= np.linalg.norm(tg); u = np.array(up, float); side = np.cross(tg, u)
        if np.linalg.norm(side) < 1e-4: side = np.cross(tg, [1.0, 0, 0])
        side /= np.linalg.norm(side); nrm = np.cross(side, tg)
        for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
            V.append(P[i] + side * sx * width / 2 + nrm * sy * thick / 2)
    m = n if closed else n - 1
    for i in range(m):
        a, b = i * 4, ((i + 1) % n) * 4
        for k in range(4): F.append([a + k, a + (k + 1) % 4, b + (k + 1) % 4, b + k])
    if not closed: F += [[3, 2, 1, 0], [(n - 1) * 4 + 0, (n - 1) * 4 + 1, (n - 1) * 4 + 2, (n - 1) * 4 + 3]]
    o = mesh_obj(name, V, F, material, coll, subd=1)
    return o

def helix(r, h, turns, z0=0.0, n_per=16, cx=0.0, cy=0.0):
    N = int(turns * n_per) + 1
    return [(cx + r * math.cos(t), cy + r * math.sin(t), z0 + h * k / (N - 1)) for k, t in enumerate(np.linspace(0, turns * TAU, N))]

def ellipsoid_mesh(name, r, material, coll, at=(0, 0, 0), rot=(0, 0, 0), seg=24, rings=14, subd=1, deform=None):
    prof = [(math.sin(t), -math.cos(t)) for t in np.linspace(0, math.pi, rings + 1)]; prof[0] = (0, -1.0); prof[-1] = (0, 1.0)
    V, F = lathe(prof, seg); V = V * np.array(r)
    if deform is not None: V = deform(V)
    o = mesh_obj(name, V, F, material, coll, subd=subd); o.location = at; o.rotation_euler = rot; return o

def coin(name, coll, at, rot=(0, 0, 0), r=0.022, t=0.004):
    o = revolve(name, [(0, 0), (r * 0.98, 0), (r, t * 0.3), (r, t * 0.7), (r * 0.98, t), (r * 0.8, t * 1.1), (0, t * 0.9)], M("gold"), coll, seg=24, subd=0, at=at, rot=rot)
    return o

# ------------------------------------------------------------------------------------------------ items
def item_breastplate(C):
    """Brass Breastplate: a Dawnhold infantry cuirass, sun boss on the chest, one honest dent from the shop floor."""
    def shape(V):
        x, y, z = V[:, 0], V[:, 1], V[:, 2]
        y = np.minimum(y, 0.02)  # open back
        x = x * (1 + 0.28 * np.clip((z + 0.05) / 0.25, 0, 1))  # broad chest, nipped waist
        y = y - 0.035 * np.exp(-(x / 0.05) ** 2) * (y < 0)  # keel
        d = np.exp(-(((x + 0.09) / 0.045) ** 2 + ((z + 0.08) / 0.05) ** 2)); y = y + 0.018 * d * (y < 0)  # the dent
        return np.stack([x, y, np.minimum(z, 0.2)], -1)
    ellipsoid_mesh("plate", (0.2, 0.14, 0.28), M("brass"), C, at=(0, 0, 0.3), deform=shape, seg=32, rings=18)
    # rolled rim at the neck and arm holes, waist fauld plates
    curve("neckrim", [(-0.09, -0.03, 0.5), (-0.05, -0.1, 0.47), (0, -0.12, 0.46), (0.05, -0.1, 0.47), (0.09, -0.03, 0.5)], 0.012, M("brass"), C)
    for k in range(2):
        z = 0.05 - k * 0.04; w = 0.17 - k * 0.01
        ellipsoid_mesh(f"fauld{k}", (w, 0.13, 0.03), M("brass"), C, at=(0, 0.01, z),
                       deform=lambda V: np.stack([V[:, 0], np.minimum(V[:, 1], 0.0), V[:, 2]], -1), seg=28, rings=6)
    for sx in (-1, 1):  # pauldrons with rivets and leather straps
        ellipsoid_mesh(f"paul{sx}", (0.1, 0.12, 0.05), M("brass"), C, at=(sx * 0.23, -0.01, 0.43), rot=(0, sx * 0.85, 0),
                       deform=lambda V: np.stack([V[:, 0], V[:, 1], np.maximum(V[:, 2], -0.01)], -1), seg=24, rings=10)
        for k in range(3):
            prim("uv_sphere", "rivet", M("steel"), C, at=(sx * (0.21 + k * 0.035), -0.09 + k * 0.005, 0.5 - k * 0.015), scale=(0.008,) * 3, segments=10, ring_count=6)
        strap(f"strap{sx}", [(sx * 0.12, -0.11, 0.42), (sx * 0.14, -0.04, 0.53), (sx * 0.12, 0.05, 0.5)], 0.04, 0.008, M("leather"), C)
        prim("cube", "buckle", M("steel"), C, at=(sx * 0.12, -0.12, 0.41), scale=(0.022, 0.006, 0.016), bevel=0.003)
    # sun boss: blue enamel disc, brass rays
    revolve("boss", [(0, 0), (0.06, 0), (0.06, 0.008), (0.045, 0.018), (0, 0.022)], M("sun_enamel"), C, at=(0, -0.185, 0.33), rot=(math.pi / 2, 0, 0))
    for k in range(10):
        a = k / 10 * TAU; d = 0.075
        prim("cone", "ray", M("gold"), C, at=(math.cos(a) * d, -0.178 + 0.02 * abs(math.cos(a)), 0.33 + math.sin(a) * d), rot=(math.pi / 2, 0, 0), scale=(1, 1, 1), smooth=False,
             vertices=4, radius1=0.014, radius2=0, depth=0.006).rotation_euler = (math.pi / 2, a - math.pi / 2, 0)
    prim("uv_sphere", "gem", M("sapphire"), C, at=(0, -0.205, 0.33), scale=(0.022, 0.012, 0.022), segments=16, ring_count=8)
    return dict(view=(0.3, -1.0, 0.2))

def item_boots(C):
    """Springheel Boots: tall leather boots with brass coil springs riveted under the heels, red laces."""
    for sx, ang, off in ((-1, 0.18, 0.0), (1, -0.08, 0.05)):
        g = Matrix.Translation((sx * 0.11, off, 0)) @ Matrix.Rotation(ang, 4, "Z")
        objs = []
        # sole (rubber) and the coil spring underneath the heel
        objs.append(_bbox("sole", M("leather_dk"), C, (0.11, 0.27, 0.025), (0, -0.04, 0.095), (0, 0, 0), 0.01))
        objs.append(curve("spring", helix(0.035, 0.07, 4.5, z0=0.012, cy=0.05), 0.0055, M("brass"), C))
        objs.append(revolve("springbase", [(0, 0), (0.045, 0), (0.045, 0.012), (0, 0.012)], M("brass"), C, seg=24, subd=0, at=(0, 0.05, 0)))
        # foot and shaft
        objs.append(ellipsoid_mesh("foot", (0.06, 0.14, 0.06), M("leather"), C, at=(0, -0.06, 0.14), seg=24, rings=12,
                                   deform=lambda V: np.stack([V[:, 0] * (1 + 0.15 * (V[:, 1] < 0)), V[:, 1], np.maximum(V[:, 2], -0.03)], -1)))
        objs.append(revolve("shaft", [(0.058, 0.0), (0.062, 0.12), (0.066, 0.22), (0.074, 0.27), (0.078, 0.29), (0.07, 0.29), (0.06, 0.24)], M("leather"), C, seg=24, at=(0, 0.04, 0.12)))
        objs.append(revolve("cuff", [(0.075, 0.0), (0.086, 0.01), (0.086, 0.035), (0.075, 0.045)], M("leather_red"), C, seg=24, at=(0, 0.04, 0.38)))
        for k in range(5):  # laces crossing up the front
            z = 0.17 + k * 0.045
            objs.append(curve("lace", [(-0.04, -0.03, z), (0, -0.06, z + 0.02), (0.04, -0.03, z + 0.04)], 0.0045, M("leather_red"), C))
            for s2 in (-1, 1): objs.append(prim("torus", "eyelet", M("brass"), C, at=(s2 * 0.042, -0.035, z + (0.04 if s2 > 0 else 0)), rot=(math.pi / 2, 0, s2 * 0.6),
                                                major_radius=0.007, minor_radius=0.0025, major_segments=12, minor_segments=6))
        objs.append(prim("torus", "heelplate", M("brass"), C, at=(0, 0.05, 0.11), major_radius=0.04, minor_radius=0.006, major_segments=24, minor_segments=8))
        for o in objs: o.matrix_world = g @ o.matrix_world
    return dict(view=(0.7, -1.0, 0.35))

def item_whetstone(C):
    """Grumpy Whetstone: a blue grit stone that has worn a deep dip from years of sharpening, in an oak holder with a
    little oil flask strapped to it and a fresh steel shaving curled on top."""
    _bbox("base", M("wood"), C, (0.34, 0.14, 0.045), (0, 0, 0.0225), (0, 0, 0), 0.01)
    me_o = _bbox("stone", M("stone"), C, (0.3, 0.09, 0.07), (0, 0, 0.08), (0, 0, 0), 0.012)
    sub = me_o.modifiers.new("sub", "SUBSURF"); sub.levels = sub.render_levels = 2
    # wear dip: pull the top down in the middle
    for v in me_o.data.vertices:
        if v.co.z > 0.02: v.co.z -= 0.018 * max(0.0, 1 - (v.co.x / 0.15) ** 2)
    for sx in (-1, 1): _bbox("cleat", M("wood_lt"), C, (0.02, 0.12, 0.04), (sx * 0.16, 0, 0.06), (0, 0, 0), 0.006)
    revolve("flask", [(0, 0), (0.028, 0), (0.032, 0.03), (0.028, 0.06), (0.01, 0.075), (0.01, 0.09), (0, 0.09)], M("tonic_green"), C, at=(0.2, -0.06, 0.0))
    revolve("flaskcork", [(0, 0), (0.011, 0), (0.012, 0.02), (0, 0.02)], M("cork"), C, at=(0.2, -0.06, 0.085))
    curve("shaving", helix(0.016, 0.02, 2.2, z0=0.11, cx=-0.05), 0.0025, M("steel"), C)
    prim("uv_sphere", "glint", M("sapphire"), C, at=(0.05, -0.04, 0.11), scale=(0.01, 0.01, 0.01), segments=8, ring_count=6)
    return dict(view=(0.5, -1.0, 0.55))

def item_kettle(C):
    """Pocket Kettle: a palm-sized copper kettle, brass handle wrapped in cord, a tin cup hooked on its side, a curl
    of steam from the spout."""
    revolve("body", [(0, 0), (0.08, 0), (0.105, 0.03), (0.11, 0.075), (0.09, 0.12), (0.045, 0.145), (0.04, 0.15)], M("copper"), C, seg=36)
    revolve("lid", [(0.045, 0), (0.045, 0.008), (0.03, 0.02), (0.012, 0.025), (0, 0.026)], M("copper"), C, at=(0, 0, 0.148))
    prim("uv_sphere", "knob", M("wood"), C, at=(0, 0, 0.184), scale=(0.014, 0.014, 0.012), segments=12, ring_count=8)
    curve("spout", [(0.085, 0, 0.05), (0.13, 0, 0.08), (0.155, 0, 0.13), (0.17, 0, 0.15)], 0.016, M("copper"), C, radii=[1.0, 0.8, 0.6, 0.5])
    curve("handle", [(-0.06, 0, 0.13), (-0.05, 0, 0.21), (0, 0, 0.235), (0.05, 0, 0.21), (0.06, 0, 0.13)], 0.008, M("brass"), C)
    curve("wrap", helix(0.012, 0.05, 6, z0=0, cx=0, cy=0), 0.003, M("lace"), C).matrix_world = Matrix.Translation((-0.025, 0, 0.228)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
    revolve("cup", [(0, 0), (0.028, 0), (0.034, 0.045), (0.032, 0.045), (0.025, 0.004), (0, 0.004)], M("steel"), C, at=(-0.02, -0.14, 0.0))
    curve("cuphook", [(-0.02, -0.11, 0.035), (-0.02, -0.095, 0.05), (-0.03, -0.09, 0.07)], 0.003, M("steel"), C)
    return dict(view=(0.6, -1.0, 0.45))

def item_purse(C):
    """Prospector's Purse: a fat leather pouch, drawstring knotted, a gold nugget and coins spilling out of its mouth."""
    def bulge(V):
        z = V[:, 2]; s = 1 - 0.55 * np.clip((z - 0.03) / 0.07, 0, 1) ** 1.5
        return np.stack([V[:, 0] * s, V[:, 1] * s, z], -1)
    ellipsoid_mesh("bag", (0.11, 0.1, 0.1), M("leather"), C, at=(0, 0, 0.1), deform=bulge, seg=32, rings=16)
    revolve("neck", [(0.045, 0.0), (0.04, 0.02), (0.05, 0.05), (0.065, 0.065), (0.06, 0.07), (0.045, 0.05), (0.035, 0.02)], M("leather"), C, at=(0, 0, 0.17))
    for k in range(5):  # pleats
        a = k / 5 * TAU
        curve("pleat", [(math.cos(a) * 0.044, math.sin(a) * 0.044, 0.18), (math.cos(a) * 0.06, math.sin(a) * 0.06, 0.225)], 0.006, M("leather"), C)
    prim("torus", "draw", M("lace"), C, at=(0, 0, 0.19), major_radius=0.045, minor_radius=0.006, major_segments=24, minor_segments=8)
    curve("tie", [(0.04, -0.02, 0.19), (0.07, -0.05, 0.16), (0.08, -0.07, 0.11)], 0.005, M("lace"), C)
    curve("tie2", [(0.04, -0.02, 0.19), (0.09, -0.03, 0.17), (0.11, -0.04, 0.12)], 0.005, M("lace"), C)
    rr = np.random.default_rng(7)
    for k in range(7):
        coin(f"c{k}", C, at=(0.07 + 0.09 * rr.random(), -0.08 - 0.08 * rr.random(), 0.004 + 0.006 * (k % 3)), rot=(rr.random() * 0.3, rr.random() * 0.3, 0))
    for k in range(3):
        coin(f"cs{k}", C, at=(-0.1, -0.1, 0.005 + k * 0.008))
    prim("ico_sphere", "nugget", M("gold"), C, at=(0.0, -0.04, 0.24), scale=(0.03, 0.025, 0.022), subdivisions=1, smooth=False)
    for k in range(2): coin(f"ct{k}", C, at=(0.02 - 0.03 * k, -0.01, 0.235 + 0.01 * k), rot=(0.6, 0.2 * k, 0))
    return dict(view=(0.55, -1.0, 0.5))

def item_belt(C):
    """Draught Belt: a soldier's bandolier loop with two Healing Draughts in stitched holsters and a brass buckle."""
    pts = [(math.cos(t) * 0.2, math.sin(t) * 0.13, 0.03 + 0.02 * math.sin(2 * t)) for t in np.linspace(0, TAU, 24, endpoint=False)]
    strap("belt", pts, 0.05, 0.01, M("leather"), C, closed=True)
    _bbox("buckle", M("brass"), C, (0.065, 0.015, 0.06), (0, -0.135, 0.03), (0, 0, 0), 0.006)
    _bbox("buckle_in", M("leather_dk"), C, (0.045, 0.02, 0.04), (0, -0.136, 0.03), (0, 0, 0), 0.004)
    prim("cylinder", "tongue", M("steel"), C, at=(0, -0.146, 0.03), rot=(0, math.pi / 2, 0), scale=(0.004, 0.004, 0.025), vertices=8)
    for k, t in enumerate((-0.55, 0.55)):
        x, y = math.sin(t) * 0.2, -math.cos(t) * 0.13
        rot = (0, 0, t)
        h = _bbox("holster", M("leather_dk"), C, (0.07, 0.03, 0.08), (x, y - 0.012, 0.04), rot, 0.01)
        bottle = revolve("vial", [(0, 0), (0.026, 0), (0.03, 0.04), (0.028, 0.09), (0.011, 0.11), (0.011, 0.135), (0, 0.135)], M("draught"), C, at=(x, y - 0.02, 0.02))
        revolve("vialcork", [(0, 0), (0.012, 0), (0.013, 0.025), (0, 0.025)], M("cork"), C, at=(x, y - 0.02, 0.15))
        curve("stitch", [(x - 0.03 * math.cos(t), y - 0.03 - 0.03 * math.sin(t), 0.075), (x + 0.03 * math.cos(t), y - 0.03 + 0.03 * math.sin(t), 0.075)], 0.003, M("lace"), C)
    return dict(view=(0.35, -1.0, 1.0))

def item_charm(C):
    """Forgeling Shield-Charm: a tiny round shield hammered out by forgelings, cog-toothed brass rim, crystal boss,
    hung on a braided cord."""
    revolve("face", [(0, 0.012), (0.09, 0.0), (0.1, 0.006), (0.1, 0.012), (0.09, 0.016), (0, 0.03)], M("steel"), C, at=(0, 0, 0.13), rot=(math.pi / 2 - 0.15, 0, 0), seg=40)
    rim = revolve("rim", [(0.095, -0.004), (0.11, -0.004), (0.112, 0.02), (0.095, 0.02)], M("brass"), C, at=(0, 0, 0.13), rot=(math.pi / 2 - 0.15, 0, 0), seg=48, subd=0)
    for k in range(12):  # cog teeth round the rim
        a = k / 12 * TAU
        t = _bbox("tooth", M("brass"), C, (0.02, 0.022, 0.016), (0, 0, 0), (0, 0, 0), 0.003)
        t.matrix_world = Matrix.Translation((0, 0, 0.13)) @ Euler((math.pi / 2 - 0.15, 0, 0)).to_matrix().to_4x4() @ Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0.118, 0, 0.008))
    g = prim("ico_sphere", "boss", M("sapphire"), C, subdivisions=1, smooth=False, scale=(0.032, 0.032, 0.032))
    g.matrix_world = Matrix.Translation((0, 0, 0.13)) @ Euler((math.pi / 2 - 0.15, 0, 0)).to_matrix().to_4x4() @ Matrix.Translation((0, 0, 0.035)) @ Matrix.Scale(0.032, 4)
    for k in range(4):  # rivets in a cross
        a = k / 4 * TAU + TAU / 8
        r = prim("uv_sphere", "rivet", M("brass"), C, segments=10, ring_count=6)
        r.matrix_world = Matrix.Translation((0, 0, 0.13)) @ Euler((math.pi / 2 - 0.15, 0, 0)).to_matrix().to_4x4() @ Matrix.Translation((math.cos(a) * 0.065, math.sin(a) * 0.065, 0.02)) @ Matrix.Scale(0.008, 4)
    prim("torus", "bail", M("brass"), C, at=(0, 0.01, 0.255), rot=(0, math.pi / 2, 0), major_radius=0.016, minor_radius=0.004, major_segments=16, minor_segments=6)
    cord = [(-0.16, 0.05, 0.02), (-0.12, 0.04, 0.2), (-0.04, 0.02, 0.29), (0, 0.01, 0.27), (0.04, 0.02, 0.29), (0.12, 0.04, 0.2), (0.17, 0.05, 0.02)]
    curve("cord", cord, 0.0045, M("leather_red"), C)
    return dict(view=(0.35, -1.0, 0.3))

def item_leech(C):
    """Leech in a Jar: a stout glass jar of green tonic, wax-sealed cork with twine, a hand-inked apothecary label, and
    a fat, glossy leech pressed against the glass."""
    revolve("jar", [(0, 0), (0.07, 0), (0.08, 0.01), (0.082, 0.14), (0.07, 0.165), (0.05, 0.175), (0.052, 0.19), (0.046, 0.192), (0.044, 0.17), (0.072, 0.15), (0.074, 0.012), (0, 0.006)], M("glass"), C, seg=40)
    revolve("tonic", [(0, 0.01), (0.072, 0.01), (0.074, 0.115), (0, 0.115)], M("tonic_green"), C, seg=32, subd=0)
    revolve("cork", [(0, 0), (0.043, 0), (0.046, 0.04), (0, 0.04)], M("cork"), C, at=(0, 0, 0.17))
    revolve("wax", [(0, 0), (0.05, 0), (0.053, 0.012), (0.045, 0.022), (0, 0.024)], M("leather_red"), C, at=(0, 0, 0.205))
    prim("torus", "twine", M("lace"), C, at=(0, 0, 0.183), major_radius=0.052, minor_radius=0.004, major_segments=24, minor_segments=6)
    lab = _bbox("label", M("paper"), C, (0.075, 0.004, 0.05), (0, -0.081, 0.08), (0, 0, 0), 0.002)
    lab.modifiers.new("bend", "SIMPLE_DEFORM").deform_method = "BEND"
    for k in range(3): _bbox("ink", M("ink"), C, (0.05 - 0.012 * k, 0.002, 0.004), (0, -0.085, 0.095 - k * 0.013), (0, 0, 0), 0.0)
    pts = [(-0.05, -0.05, 0.03), (-0.03, -0.065, 0.06), (0.0, -0.068, 0.085), (0.03, -0.062, 0.1), (0.05, -0.048, 0.12)]
    curve("leech", pts, 0.017, M("leech"), C, radii=[0.4, 1.0, 1.2, 1.0, 0.5], res=16)
    for k in range(5): curve("ring", [(-0.04 + k * 0.02, -0.07 - 0.0 * k, 0.045 + k * 0.017), (-0.035 + k * 0.02, -0.072, 0.05 + k * 0.017)], 0.004, M("leech_belly"), C)
    for sx in (-1, 1): prim("uv_sphere", "eye", M("ink"), C, at=(0.054 + sx * 0.006, -0.058, 0.128), scale=(0.004,) * 3, segments=8, ring_count=6)
    return dict(view=(0.5, -1.0, 0.35))

def item_hat(C):
    """Ballista Captain's Hat: a navy felt tricorn trimmed in gold braid, a white plume, and the captain's brass badge:
    a little ballista bolt through a sun."""
    def tri(V):
        ang = np.arctan2(V[:, 1], V[:, 0]); rad = np.hypot(V[:, 0], V[:, 1])
        lift = 0.17 * (0.5 + 0.5 * np.cos(3 * (ang + math.pi / 2))) ** 1.6 * np.clip((rad - 0.1) / 0.14, 0, 1)
        z = V[:, 2] + lift * (0.6 + 0.4 * np.clip((rad - 0.12) / 0.1, 0, 1))
        return np.stack([V[:, 0], V[:, 1], z], -1)
    V, F = lathe([(0.0, 0.0), (0.12, 0.0), (0.25, 0.005), (0.255, 0.018), (0.12, 0.012), (0.0, 0.012)], 64)
    mesh_obj("brim", tri(V), F, M("felt_navy"), C, subd=1)
    ring = [(math.cos(t) * 0.25, math.sin(t) * 0.25, 0.012) for t in np.linspace(0, TAU, 64, endpoint=False)]
    curve("braid", [tuple(p) for p in tri(np.array(ring))], 0.008, M("gold"), C, closed=True)
    ellipsoid_mesh("crown", (0.13, 0.13, 0.15), M("felt_navy"), C, at=(0, 0, 0.0),
                   deform=lambda V: np.stack([V[:, 0], V[:, 1], np.maximum(V[:, 2], 0.0)], -1), seg=32, rings=14)
    prim("torus", "band", M("leather_dk"), C, at=(0, 0, 0.03), major_radius=0.128, minor_radius=0.012, major_segments=40, minor_segments=8, scale=(1, 1, 0.9))
    # badge: brass sun with a bolt through it, on the front cock
    revolve("badge", [(0, 0), (0.04, 0), (0.04, 0.008), (0, 0.012)], M("gold"), C, at=(0, -0.2, 0.1), rot=(math.pi / 2 + 0.6, 0, 0))
    for k in range(8):
        a = k / 8 * TAU
        r = prim("cone", "ray", M("gold"), C, vertices=4, radius1=0.01, radius2=0, depth=0.004, smooth=False)
        r.matrix_world = Matrix.Translation((0, -0.2, 0.1)) @ Euler((math.pi / 2 + 0.6, 0, 0)).to_matrix().to_4x4() @ Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0.05, 0, 0.004)) @ Matrix.Rotation(-math.pi / 2, 4, "Y")
    bolt = curve("bolt", [(-0.07, -0.215, 0.07), (0.07, -0.205, 0.13)], 0.005, M("wood_lt"), C)
    prim("cone", "bolthead", M("steel"), C, at=(0.08, -0.205, 0.135), rot=(0, math.radians(67), 0), vertices=4, radius1=0.014, radius2=0, depth=0.03, smooth=False)
    for k in range(2): prim("cone", "fletch", M("red_feather"), C, at=(-0.07, -0.215 + 0.008 * k, 0.07), rot=(0, math.radians(-113), 0.6 * k), vertices=3, radius1=0.016, radius2=0, depth=0.035, smooth=False)
    # plume: a curled ostrich feather tucked into the band at the back-left
    def vane(V):
        z = V[:, 2]; t = (z + 0.15) / 0.3
        x = V[:, 0] * (0.4 + 0.6 * np.sin(np.clip(t, 0, 1) * math.pi) ** 0.6) + 0.004 * np.sin(z * 120) * (np.abs(V[:, 0]) > 0.02)
        return np.stack([x + 0.08 * t ** 2, V[:, 1] + 0.05 * np.sin(t * math.pi), z], -1)
    ellipsoid_mesh("plume", (0.045, 0.008, 0.15), M("feather"), C, at=(-0.13, 0.08, 0.2), rot=(0.2, -0.6, 0.4), deform=vane, seg=24, rings=24)
    ellipsoid_mesh("plume2", (0.03, 0.006, 0.1), M("red_feather"), C, at=(-0.15, 0.1, 0.14), rot=(0.3, -0.9, 0.6), deform=vane, seg=20, rings=18)
    return dict(view=(0.45, -1.0, 0.65))

def item_crown(C):
    """Siege Crown: a blackened iron circlet with gold battlements, ram's-horn curls on each side and a fat ruby; built
    for knocking down gates as much as for wearing."""
    revolve("band", [(0.115, 0.0), (0.122, 0.0), (0.125, 0.012), (0.122, 0.06), (0.125, 0.07), (0.115, 0.07)], M("iron"), C, seg=48, subd=1)
    for z in (0.006, 0.066): prim("torus", "rim", M("gold"), C, at=(0, 0, z), major_radius=0.124, minor_radius=0.006, major_segments=48, minor_segments=8)
    for k in range(8):  # battlements
        a = k / 8 * TAU; h = 0.06 if k % 2 == 0 else 0.04
        b = _bbox("merlon", M("gold"), C, (0.06, 0.02, h), (0, 0, 0), (0, 0, 0), 0.005)
        b.matrix_world = Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0, -0.122, 0.07 + h / 2))
        if k % 2 == 0:
            s = prim("cone", "spike", M("iron"), C, vertices=8, radius1=0.012, radius2=0.0, depth=0.04)
            s.matrix_world = Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0, -0.122, 0.07 + h + 0.018))
    for sx in (-1, 1):  # ram's horns
        pts = [(sx * (0.125 + 0.03 * math.sin(t) * (t / 8 + 0.6)), -0.0 + 0.03 * math.cos(t) * (t / 8 + 0.6), 0.04 + 0.006 * t) for t in np.linspace(0, 1.6 * TAU, 18)]
        curve("horn", pts, 0.016, M("brass"), C, radii=list(np.linspace(1.0, 0.25, len(pts))))
    revolve("setting", [(0, 0), (0.03, 0), (0.03, 0.01), (0, 0.012)], M("gold"), C, at=(0, -0.124, 0.038), rot=(math.pi / 2, 0, 0))
    prim("ico_sphere", "ruby", M("ruby"), C, subdivisions=1, smooth=False, at=(0, -0.136, 0.038), scale=(0.024, 0.014, 0.03))
    for sx in (-1, 1): prim("ico_sphere", "stud", M("ruby"), C, subdivisions=1, smooth=False, at=(sx * 0.088, -0.088, 0.038), scale=(0.011,) * 3)
    return dict(view=(0.5, -1.0, 0.6))

def item_locket(C):
    """Heartstone Locket: a gold heart locket swung open on its hinge, a glowing pink heartstone inside, filigree on
    the lid, on a fine chain."""
    # build front and back halves as heart-deformed flattened ellipsoids
    for nm, at, rot in (("back", (0, 0, 0.12), (0.25, 0, 0)), ("lid", (0.14, -0.045, 0.12), (0.25, 0, -2.2))):
        def hd(V):
            x, y, z = V[:, 0], V[:, 1], V[:, 2]
            lobes = 0.025 * np.exp(-((np.abs(x) - 0.035) / 0.03) ** 2) * (z > 0)
            z2 = z + lobes - 0.45 * (np.abs(x) - 0.0) * (z < 0) * 0.0
            x2 = x * (1 - 0.65 * np.clip(-z / 0.075, 0, 1))
            return np.stack([x2, y * (0.4 if nm == "back" else 0.35), z2], -1)
        o = ellipsoid_mesh(nm, (0.075, 0.03, 0.075), M("gold"), C, at=at, rot=rot, seg=36, rings=18, deform=hd)
    prim("ico_sphere", "heartstone", M("heartstone"), C, subdivisions=2, smooth=False, at=(0, -0.016, 0.125), rot=(0.25, 0, 0), scale=(0.042, 0.026, 0.048))
    prim("cylinder", "hinge", M("gold"), C, at=(0.07, -0.02, 0.12), rot=(0.25, 0, 0), scale=(0.006, 0.006, 0.03), vertices=12)
    for k in range(4):  # filigree swirls on the open lid
        a = k * 0.9
        pts = [(0.14 + 0.03 * math.cos(a + t) * (1 - t / 6), -0.06 - 0.004, 0.12 + 0.03 * math.sin(a + t) * (1 - t / 6)) for t in np.linspace(0, 4, 8)]
        o = curve("fil", pts, 0.0025, M("brass"), C)
    prim("torus", "bail", M("gold"), C, at=(0, 0.0, 0.215), rot=(0, math.pi / 2, 0), major_radius=0.014, minor_radius=0.004, major_segments=16, minor_segments=6)
    chain = [(-0.2, 0.03, 0.0), (-0.17, 0.03, 0.12), (-0.09, 0.02, 0.24), (0, 0.0, 0.225), (0.09, 0.02, 0.24), (0.17, 0.03, 0.12), (0.2, 0.03, 0.0)]
    curve("chain", chain, 0.0035, M("gold"), C, res=24)
    for k in range(40):  # links glinting along it
        t = k / 39; i = min(int(t * 6), 5); f = t * 6 - i; p = np.array(chain[i]) + (np.array(chain[i + 1]) - np.array(chain[i])) * f
        prim("torus", "link", M("gold"), C, at=tuple(p), rot=(0 if k % 2 else math.pi / 2, 0.7, 0), major_radius=0.006, minor_radius=0.002, major_segments=10, minor_segments=5)
    return dict(view=(0.3, -1.0, 0.25))

def item_draught(C):
    """Healing Draught: a round-bellied flask of glowing blue tonic, wax-dipped cork, a paper tag on a string and a
    tiny brass medicine stamp on the shoulder."""
    revolve("flask", [(0, 0), (0.05, 0), (0.085, 0.02), (0.095, 0.07), (0.085, 0.12), (0.04, 0.15), (0.025, 0.17), (0.025, 0.215), (0.03, 0.22), (0.021, 0.222), (0.02, 0.17), (0.035, 0.15), (0.08, 0.12), (0.088, 0.07), (0.08, 0.025), (0.045, 0.008), (0, 0.006)], M("glass"), C, seg=40)
    revolve("tonic", [(0, 0.008), (0.05, 0.01), (0.08, 0.025), (0.088, 0.07), (0.08, 0.11), (0, 0.11)], M("draught"), C, seg=32)
    revolve("cork", [(0, 0), (0.019, 0), (0.022, 0.05), (0, 0.05)], M("cork"), C, at=(0, 0, 0.19))
    revolve("wax", [(0, 0), (0.027, 0), (0.03, 0.02), (0.02, 0.03), (0, 0.032)], M("sun_enamel"), C, at=(0, 0, 0.225))
    curve("string", [(0.02, -0.01, 0.2), (0.05, -0.04, 0.17), (0.08, -0.06, 0.11)], 0.0025, M("lace"), C)
    _bbox("tag", M("paper"), C, (0.045, 0.004, 0.06), (0.085, -0.065, 0.08), (0.1, 0.3, -0.3), 0.003)
    _bbox("cross", M("leather_red"), C, (0.025, 0.002, 0.008), (0.084, -0.068, 0.085), (0.1, 0.3, -0.3), 0.0)
    _bbox("cross2", M("leather_red"), C, (0.008, 0.002, 0.025), (0.084, -0.068, 0.085), (0.1, 0.3, -0.3), 0.0)
    for k in range(5):  # bubbles in the tonic
        prim("uv_sphere", "bub", M("glass"), C, at=(-0.03 + 0.015 * k, -0.04 + 0.01 * (k % 2), 0.04 + 0.012 * k), scale=(0.006 + 0.002 * (k % 3),) * 3, segments=10, ring_count=6)
    return dict(view=(0.5, -1.0, 0.3))

def item_ale(C):
    """Hearty Ale: an oak-staved tankard bound in brass, foam spilling down one side."""
    n = 14
    for k in range(n):  # staves, each slightly different
        a = k / n * TAU; w = TAU * 0.105 / n * 1.02
        s = _bbox("stave", M("wood_lt" if k % 3 else "wood"), C, (0.105 * TAU / n * 1.04, 0.016, 0.19), (0, 0, 0), (0, 0, 0), 0.003)
        s.matrix_world = Matrix.Rotation(a, 4, "Z") @ Matrix.Translation((0, -0.1, 0.095))
    revolve("bottom", [(0, 0), (0.1, 0), (0.1, 0.02), (0, 0.02)], M("wood"), C)
    for z in (0.03, 0.16): prim("torus", "hoop", M("brass"), C, at=(0, 0, z), major_radius=0.111, minor_radius=0.008, major_segments=40, minor_segments=8, scale=(1, 1, 1.4))
    curve("handle", [(0.105, 0, 0.15), (0.17, 0, 0.15), (0.19, 0, 0.1), (0.17, 0, 0.05), (0.105, 0, 0.045)], 0.016, M("wood"), C)
    def froth(V):
        r = np.hypot(V[:, 0], V[:, 1]); z = V[:, 2]
        return np.stack([V[:, 0], V[:, 1], z + 0.012 * np.sin(np.arctan2(V[:, 1], V[:, 0]) * 7) * (r > 0.04)], -1)
    ellipsoid_mesh("foam", (0.11, 0.11, 0.05), M("foam"), C, at=(0, 0, 0.19), deform=froth, seg=32, rings=12)
    for k in range(6):
        a = k / 6 * TAU
        prim("uv_sphere", "bub", M("foam"), C, at=(math.cos(a) * 0.075, math.sin(a) * 0.075, 0.22 + 0.01 * (k % 2)), scale=(0.03, 0.03, 0.025), segments=12, ring_count=8)
    curve("drip", [(-0.06, -0.09, 0.2), (-0.07, -0.105, 0.15), (-0.065, -0.108, 0.1)], 0.014, M("foam"), C, radii=[1, 0.9, 0.6])
    return dict(view=(0.6, -1.0, 0.45))

ITEMS = {"breastplate": item_breastplate, "boots": item_boots, "whetstone": item_whetstone, "kettle": item_kettle,
         "purse": item_purse, "belt": item_belt, "charm": item_charm, "leech": item_leech, "hat": item_hat,
         "crown": item_crown, "locket": item_locket, "draught": item_draught, "ale": item_ale}

# ------------------------------------------------------------------------------------------------ studio and render
def studio():
    sc = bpy.context.scene; w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
    bg = w.node_tree.nodes["Background"]; bg.inputs["Color"].default_value = (0.38, 0.36, 0.4, 1); bg.inputs["Strength"].default_value = 0.35
    def area(name, loc, energy, color, size):
        bpy.ops.object.light_add(type="AREA", location=loc); l = bpy.context.object; l.name = name
        l.data.energy = energy; l.data.color = color; l.data.size = size
        d = -Vector(loc); l.rotation_euler = d.to_track_quat("-Z", "Y").to_euler(); return l
    area("key", (-1.2, -1.6, 1.6), 140, (1.0, 0.9, 0.75), 1.2)
    area("rim", (1.1, 1.4, 1.2), 200, (0.65, 0.8, 1.0), 0.8)
    area("fill", (1.6, -1.0, 0.3), 30, (1.0, 0.95, 0.9), 2.0)
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.use_denoising = True
    sc.render.film_transparent = True; sc.render.resolution_x = sc.render.resolution_y = ICON * 2
    sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
    sc.cycles.max_bounces = 8; sc.cycles.transmission_bounces = 8

def frame(objs, view):
    deps = bpy.context.evaluated_depsgraph_get(); pts = []
    for o in objs:
        ev = o.evaluated_get(deps)
        try: me = ev.to_mesh()
        except RuntimeError: continue
        if me is None: continue
        mw = o.matrix_world; pts += [mw @ v.co for v in me.vertices]; ev.to_mesh_clear()
    P = np.array([p[:] for p in pts]); lo, hi = P.min(0), P.max(0); c = Vector(((lo + hi) / 2).tolist())
    d = Vector(view).normalized(); fov = math.radians(28)
    # fit: project the points on the camera plane and size the distance to the widest spread
    up = Vector((0, 0, 1)); right = d.cross(up).normalized(); up2 = right.cross(d).normalized()
    Q = P - np.array(c[:]); ext = max(np.abs(Q @ np.array(right[:])).max(), np.abs(Q @ np.array(up2[:])).max())
    dist = ext / math.tan(fov / 2) * 1.12 + np.abs(Q @ np.array(d[:])).max()
    cam = bpy.data.objects.get("cam")
    if cam is None:
        cd = bpy.data.cameras.new("cam"); cam = bpy.data.objects.new("cam", cd); bpy.context.scene.collection.objects.link(cam)
    cam.data.angle = fov; cam.location = c + d * dist; cam.rotation_euler = (-d).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam

def build(which, samples):
    from PIL import Image
    os.makedirs(OUT, exist_ok=True); os.makedirs(RENDERS, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True); studio(); bpy.context.scene.cycles.samples = samples
    made = []
    for name in which:
        C = bpy.data.collections.new(name); bpy.context.scene.collection.children.link(C)
        spec = ITEMS[name](C); objs = list(C.all_objects)
        for other in bpy.data.collections:
            if other is not C: other.hide_render = True
        C.hide_render = False
        frame(objs, spec.get("view", (0.5, -1.0, 0.4)))
        raw = os.path.join(RENDERS, f"{name}.png"); bpy.context.scene.render.filepath = raw
        bpy.ops.render.render(write_still=True)
        im = Image.open(raw).convert("RGBA").resize((ICON, ICON), Image.LANCZOS)
        out = os.path.join(OUT, f"{name}.webp"); im.save(out, "WEBP", quality=88, method=6)
        print("wrote", out, os.path.getsize(out), "bytes", flush=True); made.append(name)
        C.hide_render = True
    return made

def contact_sheet(names):
    from PIL import Image, ImageDraw
    cell = 220; cols = 5; rows = (len(names) + cols - 1) // cols
    sheet = Image.new("RGBA", (cols * cell, rows * cell), (40, 30, 24, 255)); d = ImageDraw.Draw(sheet)
    for i, n in enumerate(names):
        im = Image.open(os.path.join(RENDERS, f"{n}.png")).convert("RGBA").resize((cell - 20, cell - 20), Image.LANCZOS)
        x, y = (i % cols) * cell, (i // cols) * cell
        d.rounded_rectangle((x + 6, y + 6, x + cell - 6, y + cell - 6), 18, fill=(70, 52, 36, 255))
        sheet.alpha_composite(im, (x + 10, y + 4)); d.text((x + 14, y + cell - 24), n, fill=(255, 230, 170, 255))
    sheet.save(os.path.join(RENDERS, "sheet.png"))

if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    want_sheet = "sheet" in args; args = [a for a in args if a != "sheet"]
    which = args[0].split(",") if args and not args[0].isdigit() and args[0] != "all" else list(ITEMS)
    samples = int(next((a for a in args if a.isdigit()), "64"))
    made = build(which, samples)
    if want_sheet: contact_sheet(made)
