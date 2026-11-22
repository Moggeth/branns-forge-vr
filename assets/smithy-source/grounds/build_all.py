# Brann's Forge hub art builder. Blender 4.5:
#   blender -b -P build_all.py -- <input_dir> <output_dir>
# Rebuilds main_hall.glb from the original forge_shelter.glb + forge_detail_kit.glb
# and authors the court kit, gates, ground textures and preview.
import bpy, bmesh, sys, os, math, random
import numpy as np
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
IN = argv[0] if len(argv) > 0 else os.path.dirname(HERE)
OUT = argv[1] if len(argv) > 1 else HERE
TEX = os.path.join(OUT, "_tex"); os.makedirs(TEX, exist_ok=True)
rng = np.random.default_rng(7); random.seed(7)
REPORT = []

# ---------------------------------------------------------------- textures
def fnoise(n, scale, seed):
    r = np.random.default_rng(seed)
    f = np.fft.fft2(r.standard_normal((n, n)))
    k = np.fft.fftfreq(n) * n
    kk = np.sqrt(k[:, None] ** 2 + k[None, :] ** 2)
    f *= np.exp(-(kk / scale) ** 2) * (kk > 0)
    a = np.real(np.fft.ifft2(f)); a -= a.min(); a /= a.max() + 1e-9
    return a  # tileable 0..1

def save_img(name, rgb, alpha=None, noncolor=False):
    n = rgb.shape[0]
    a = np.ones((n, n)) if alpha is None else alpha
    px = np.dstack([np.clip(rgb, 0, 1), a]).astype(np.float32)
    img = bpy.data.images.new(name, n, n, alpha=False)
    img.pixels.foreach_set(px[::-1].ravel())
    path = os.path.join(TEX, name + ".png")
    img.filepath_raw = path; img.file_format = "PNG"; img.save()
    if noncolor: img.colorspace_settings.name = "Non-Color"
    return img

PAL = {  # base, accent, roughness, metal, wear
    "Timber_Oak": ((0.36, 0.20, 0.10), (0.55, 0.36, 0.20), 0.78, 0.0, "grain"),
    "Timber_Pine": ((0.46, 0.29, 0.15), (0.62, 0.44, 0.26), 0.75, 0.0, "grain"),
    "Stone_Warm": ((0.40, 0.37, 0.34), (0.55, 0.50, 0.44), 0.88, 0.0, "stone"),
    "Roof_Terracotta": ((0.48, 0.17, 0.09), (0.62, 0.30, 0.16), 0.72, 0.0, "tile"),
    "Iron_Wrought": ((0.07, 0.08, 0.10), (0.20, 0.21, 0.24), 0.55, 0.85, "metal"),
    "Plaster_Lime": ((0.80, 0.74, 0.62), (0.66, 0.58, 0.46), 0.92, 0.0, "stone"),
    "Copper_Worked": ((0.72, 0.36, 0.18), (0.30, 0.55, 0.45), 0.38, 1.0, "patina"),
    "Brass_Trim": ((0.78, 0.58, 0.26), (0.45, 0.33, 0.14), 0.36, 1.0, "metal"),
    "Cloth_Banner": ((0.42, 0.10, 0.08), (0.55, 0.20, 0.12), 0.9, 0.0, "cloth"),
    "Lantern_Glow": ((1.0, 0.72, 0.35), (1.0, 0.85, 0.55), 0.3, 0.0, "flat"),
    "Stone_Hearth": ((0.30, 0.29, 0.29), (0.48, 0.44, 0.40), 0.9, 0.0, "stone"),
    "Iron_Blued": ((0.06, 0.08, 0.12), (0.18, 0.22, 0.30), 0.45, 0.9, "metal"),
}

def make_tex(name, n=256):
    base, acc, rough, metal, kind = PAL[name]
    b = np.array(base); a = np.array(acc)
    big = fnoise(n, 6, hash(name) % 999); fine = fnoise(n, 60, hash(name) % 777 + 1)
    if kind == "grain":
        y = np.linspace(0, 1, n)[:, None] * np.ones((1, n))
        g = 0.5 + 0.5 * np.sin((y * 40 + big * 6) * math.pi)
        m = 0.55 * g + 0.25 * fine + 0.2 * big
    elif kind == "patina":
        m = np.clip((big - 0.55) * 4, 0, 1) * 0.8 + fine * 0.2
    elif kind == "tile":
        m = 0.6 * big + 0.4 * fine
    else:
        m = 0.5 * big + 0.5 * fine
    m = np.clip(m, 0, 1)[..., None]
    rgb = b * (1 - m) + a * m
    rgb *= (0.85 + 0.3 * fine[..., None])
    edge = np.clip((fine - 0.75) * 3, 0, 1)  # scuff/wear
    rgb = rgb * (1 - 0.25 * edge[..., None]) + 0.25 * edge[..., None] * np.array(acc)
    col = save_img("T_" + name + "_BaseColor", rgb)
    r = np.clip(rough + (fine - 0.5) * 0.25 - (0.2 * edge if metal > 0.5 else 0), 0.05, 1)
    orm = np.dstack([np.ones_like(r), r, np.full_like(r, metal)])
    ormi = save_img("T_" + name + "_ORM", orm, noncolor=True)
    return col, ormi

MATS = {}
def mat(name):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    rebuild_mat(m, name if name in PAL else "Timber_Oak")
    MATS[name] = m; return m

def rebuild_mat(m, key):
    col, orm = make_tex(key)
    m.use_nodes = True; nt = m.node_tree; nt.nodes.clear()
    o = nt.nodes.new("ShaderNodeOutputMaterial"); p = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(p.outputs[0], o.inputs[0])
    t = nt.nodes.new("ShaderNodeTexImage"); t.image = col
    nt.links.new(t.outputs[0], p.inputs["Base Color"])
    t2 = nt.nodes.new("ShaderNodeTexImage"); t2.image = orm
    sp = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t2.outputs[0], sp.inputs[0])
    nt.links.new(sp.outputs[1], p.inputs["Roughness"]); nt.links.new(sp.outputs[2], p.inputs["Metallic"])
    if key == "Lantern_Glow":
        p.inputs["Emission Color"].default_value = (1.0, 0.68, 0.32, 1); p.inputs["Emission Strength"].default_value = 3.0

# ---------------------------------------------------------------- geometry helpers
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MATS.clear()

def finish(ob, m, bevel=0.0):
    ob.data.materials.append(mat(m))
    if bevel > 0:
        md = ob.modifiers.new("b", "BEVEL"); md.width = bevel; md.segments = 2; md.limit_method = "ANGLE"
    bpy.context.view_layer.objects.active = ob
    for md in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=md.name)
    for pl in ob.data.polygons: pl.use_smooth = False
    uvbox(ob)
    return ob

def uvbox(ob):
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        n = f.normal; ax = max(range(3), key=lambda i: abs(n[i]))
        for l in f.loops:
            c = ob.matrix_world @ l.vert.co
            u, v = [(c.y, c.z), (c.x, c.z), (c.x, c.y)][ax]
            l[uv].uv = (u * 0.7, v * 0.7)
    bm.to_mesh(me); bm.free()

def box(name, loc, size, m, bevel=0.012, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rot)
    ob = bpy.context.object; ob.name = name; ob.scale = [s / 2 for s in size]
    bpy.ops.object.transform_apply(scale=True)
    return finish(ob, m, bevel)

def cyl(name, loc, r, h, m, verts=12, rot=(0, 0, 0), r2=None, bevel=0.0):
    if r2 is None:
        bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r2, depth=h, location=loc, rotation=rot)
    ob = bpy.context.object; ob.name = name
    return finish(ob, m, bevel)

def torus(name, loc, R, r, m, rot=(0, 0, 0), maj=24, mn=6):
    bpy.ops.mesh.primitive_torus_add(location=loc, rotation=rot, major_radius=R, minor_radius=r, major_segments=maj, minor_segments=mn)
    ob = bpy.context.object; ob.name = name; return finish(ob, m)

def sphere(name, loc, r, m, seg=10):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2 + 1, radius=r, location=loc)
    ob = bpy.context.object; ob.name = name; return finish(ob, m)

def rivets(prefix, pts, m="Iron_Wrought", r=0.018):
    obs = [sphere(f"{prefix}_{i}", p, r, m, 6) for i, p in enumerate(pts)]
    return join(obs, prefix)

def join(obs, name):
    obs = [o for o in obs if o]
    if not obs: return None
    bpy.ops.object.select_all(action="DESELECT")
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    if len(obs) > 1: bpy.ops.object.join()
    obs[0].name = name; return obs[0]

def arch_band(name, cx, cz, R, thick, depth, m, a0=0, a1=math.pi, seg=16, y=0.0):
    bm = bmesh.new(); vs = []
    for i in range(seg + 1):
        a = a0 + (a1 - a0) * i / seg
        ring = []
        for rr in (R, R + thick):
            for yy in (y - depth / 2, y + depth / 2):
                ring.append(bm.verts.new((cx + rr * math.cos(a), yy, cz + rr * math.sin(a))))
        vs.append(ring)
    for i in range(seg):
        A, B = vs[i], vs[i + 1]
        for q in ((0, 1), (1, 3), (3, 2), (2, 0)):
            bm.faces.new((A[q[0]], A[q[1]], B[q[1]], B[q[0]]))
    bm.faces.new((vs[0][0], vs[0][2], vs[0][3], vs[0][1])); bm.faces.new((vs[-1][0], vs[-1][1], vs[-1][3], vs[-1][2]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    return finish(ob, m)

def export(fname, root_name):
    objs = [o for o in bpy.context.scene.objects if o.type in ("MESH", "EMPTY")]
    root = bpy.data.objects.new(root_name, None); bpy.context.collection.objects.link(root)
    for o in objs:
        if o.parent is None: o.parent = root
    bpy.ops.object.select_all(action="SELECT")
    path = os.path.join(OUT, fname)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True,
                              export_apply=True, export_image_format="AUTO")
    tris = 0; mats = set()
    dg = bpy.context.evaluated_depsgraph_get()
    for o in bpy.context.scene.objects:
        if o.type == "MESH":
            me = o.evaluated_get(dg).data; me.calc_loop_triangles(); tris += len(me.loop_triangles)
            mats |= {s.material.name for s in o.material_slots if s.material}
    REPORT.append(f"{fname}: {tris} tris, {len(mats)} materials ({', '.join(sorted(mats))}), {os.path.getsize(path)//1024} KB")
    print(REPORT[-1])

# Godot (x,y,z) -> Blender (x,-z,y)
def G(x, y, z): return (x, -z, y)

# ================================================================ MAIN HALL
def main_hall():
    reset()
    for f in ("forge_shelter.glb", "forge_detail_kit.glb"):
        bpy.ops.import_scene.gltf(filepath=os.path.join(IN, f))
    # dedupe materials by base name (Timber_Oak.001 -> Timber_Oak) and re-texture
    for o in bpy.context.scene.objects:
        if o.type != "MESH": continue
        for s in o.material_slots:
            if s.material:
                base = s.material.name.split(".")[0]
                s.material = mat(base) if base in PAL else s.material
    for m in list(bpy.data.materials):
        if m.users == 0: bpy.data.materials.remove(m)
    # remove kit props that collide with installed furnace (-3.1,-4.7) / anvil zone in front of it
    fx, fz = -3.1, -4.7
    removed = []
    for o in list(bpy.context.scene.objects):
        if o.type != "MESH" or not o.name.startswith("Kit_"): continue
        ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
        mn = Vector([min(v[i] for v in ws) for i in range(3)]); mx = Vector([max(v[i] for v in ws) for i in range(3)])
        # Blender y = -godot z ; furnace keep-out godot x -4.6..-1.6, z -6.0..-2.6
        if mx.x > -4.6 and mn.x < -1.6 and mx.y > 2.6 and mn.y < 6.0 and mn.z < 2.2:
            removed.append(o.name); bpy.data.objects.remove(o)
    REPORT.append("main_hall removed (furnace/anvil keep-out): " + (", ".join(removed) or "none"))
    # find post centres from Shell_Posts geometry
    posts = bpy.data.objects.get("Shell_Posts")
    centres = []
    if posts:
        pts = [posts.matrix_world @ v.co for v in posts.data.vertices]
        for X in (-8.3, -4.6, 4.6, 8.3):
            col = [p for p in pts if abs(p.x - X) < 0.35 and p.z < 1.0]
            ys = sorted(set(round(p.y * 2) / 2 for p in col))
            groups = []
            for yv in ys:
                if groups and yv - groups[-1][-1] <= 0.5: groups[-1].append(yv)
                else: groups.append([yv])
            for g in groups: centres.append((X, sum(g) / len(g)))
    if not centres:
        centres = [(X, Y) for X in (-8.3, -4.6, 4.6, 8.3) for Y in (0.45, 3.9, 7.35)]
    REPORT.append(f"main_hall post centres (godot x,z): {[(c[0], round(-c[1], 2)) for c in centres]}")
    new = []
    for i, (x, y) in enumerate(centres):
        # iron strap bands + copper cap-ring at base, rivets
        for h in (0.55, 2.35):
            new.append(box(f"Strap_{i}_{h}", (x, y, h), (0.30, 0.30, 0.06), "Iron_Blued", 0.006))
            new.append(rivets(f"Rv_{i}_{h}", [(x + dx * 0.155, y + dy * 0.155, h) for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))], "Iron_Wrought", 0.016))
        new.append(box(f"CopperCollar_{i}", (x, y, 0.42), (0.32, 0.32, 0.035), "Copper_Worked", 0.008))
    join(new, "Polish_PostStraps")
    # stone hearth surround: low plinth behind/around furnace back, keeps front (+Z) clear
    hx, hy = -3.1, 4.7
    stones = []
    for i in range(9):
        a = math.pi * (0.05 + 0.9 * i / 8)
        r = 1.55
        sx, sy = hx + r * math.cos(a), hy + r * math.sin(a) * 0.9
        stones.append(box(f"Hearth_{i}", (sx, sy, 0.16), (0.46 + random.uniform(-.05, .05), 0.34, 0.32 + random.uniform(0, .06)), "Stone_Hearth", 0.04, rot=(0, 0, a + math.pi / 2)))
    stones.append(box("Hearth_Cap", (hx, hy + 1.45, 0.38), (2.2, 0.22, 0.08), "Stone_Warm", 0.02))
    stones.append(box("Hearth_CopperLip", (hx, hy + 1.33, 0.43), (2.0, 0.04, 0.03), "Copper_Worked", 0.008))
    join(stones, "Polish_HearthSurround")
    # restrained copper eave hood badge on front gable (godot z ~ -0.45) and rivet rows along front tie
    deco = [cyl("Crest_Copper", G(0, 4.35, -0.30), 0.22, 0.04, "Copper_Worked", 24, rot=(math.pi / 2, 0, 0), bevel=0.01),
            torus("Crest_Ring", G(0, 4.35, -0.27), 0.22, 0.02, "Iron_Wrought", rot=(math.pi / 2, 0, 0))]
    join(deco, "Polish_GableBadge")
    export("main_hall.glb", "MainHall")

# ================================================================ GATES
def gate_common(prefix, post_m, cap_m):
    p = []
    for s in (-1, 1):
        x = s * 0.86
        p.append(box(f"{prefix}_Plinth_{s}", (x, 0, 0.18), (0.44, 0.44, 0.36), "Stone_Warm", 0.04))
        p.append(box(f"{prefix}_Post_{s}", (x, 0, 1.2), (0.30, 0.30, 1.7), post_m, 0.03))
        p.append(box(f"{prefix}_Cap_{s}", (x, 0, 2.1), (0.38, 0.36, 0.1), cap_m, 0.015))
        for h in (0.55, 1.75):
            p.append(box(f"{prefix}_Band_{s}_{h}", (x, 0, h), (0.33, 0.33, 0.05), "Iron_Blued", 0.006))
            p.append(rivets(f"{prefix}_R_{s}_{h}", [(x + d, -0.166, h) for d in (-0.09, 0, 0.09)]))
    return p

def museum_gate():
    reset()
    p = gate_common("Museum", "Timber_Oak", "Brass_Trim")
    p.append(arch_band("Museum_Arch", 0, 2.1, 0.66, 0.36, 0.30, "Timber_Oak", seg=18))
    p.append(arch_band("Museum_ArchBrass", 0, 2.1, 0.62, 0.05, 0.34, "Brass_Trim", seg=18))
    # bookplate cartouche (frame only, text by game)
    p.append(arch_band("Museum_BookplateFrame", 0, 2.62, 0.0, 0.0, 0.0, "Brass_Trim", seg=1) if False else None)
    p.append(box("Museum_Bookplate_Top", (0, -0.17, 2.95), (0.9, 0.04, 0.05), "Brass_Trim", 0.01))
    p.append(box("Museum_Bookplate_Bot", (0, -0.17, 2.72), (0.9, 0.04, 0.05), "Brass_Trim", 0.01))
    for s in (-1, 1):
        p.append(cyl(f"Museum_Scroll_{s}", (s * 0.47, -0.17, 2.835), 0.07, 0.06, "Brass_Trim", 14, rot=(math.pi / 2, 0, 0), bevel=0.01))
        p.append(box(f"Museum_BookSpine_{s}", (s * 0.86, -0.17, 1.2), (0.12, 0.03, 0.9), "Brass_Trim", 0.008))
        # gear/compass rosettes for the inventor archive
        p.append(torus(f"Museum_Compass_{s}", (s * 0.86, -0.19, 1.85), 0.08, 0.012, "Copper_Worked", rot=(math.pi / 2, 0, 0)))
    p.append(cyl("Museum_Keystone", (0, -0.12, 2.86), 0.10, 0.1, "Copper_Worked", 6, rot=(math.pi / 2, 0, 0), bevel=0.01))
    p.append(rivets("Museum_ArchRivets", [(0.80 * math.cos(a), -0.18, 2.1 + 0.80 * math.sin(a)) for a in np.linspace(0.15, math.pi - 0.15, 11)], "Brass_Trim", 0.018))
    for o in p:
        if o: pass
    export("museum_gate.glb", "MuseumGate")

def fair_gate():
    reset()
    p = gate_common("Fair", "Timber_Pine", "Copper_Worked")
    p.append(arch_band("Fair_Arch", 0, 2.1, 0.66, 0.24, 0.26, "Timber_Pine", seg=18))
    p.append(arch_band("Fair_ArchIron", 0, 2.1, 0.92, 0.04, 0.3, "Iron_Blued", seg=18))
    # clockwork rosette at crown
    cz = 2.86
    p.append(cyl("Fair_Rosette", (0, -0.16, cz), 0.2, 0.05, "Brass_Trim", 24, rot=(math.pi / 2, 0, 0), bevel=0.008))
    for i in range(12):
        a = i * math.pi / 6
        p.append(box(f"Fair_Tooth_{i}", (0.22 * math.cos(a), -0.16, cz + 0.22 * math.sin(a)), (0.06, 0.05, 0.05), "Brass_Trim", 0.006, rot=(0, -a, 0)))
    p.append(torus("Fair_RosetteRing", (0, -0.19, cz), 0.12, 0.015, "Copper_Worked", rot=(math.pi / 2, 0, 0)))
    p.append(cyl("Fair_Hub", (0, -0.2, cz), 0.04, 0.06, "Iron_Wrought", 10, rot=(math.pi / 2, 0, 0)))
    # hanging cast bells across inner arch (bottom of bells above 2.25 > opening 2.1)
    for i, a in enumerate((0.5, 1.0, math.pi / 2, 2.14, 2.64)):
        bx = 0.5 * math.cos(a); top = 2.1 + 0.62 * math.sin(a)
        L = top - 2.42
        p.append(cyl(f"Fair_Chain_{i}", (bx, 0, top - L / 2), 0.008, L, "Iron_Wrought", 6))
        p.append(cyl(f"Fair_Bell_{i}", (bx, 0, 2.34), 0.085, 0.13, "Copper_Worked" if i % 2 else "Brass_Trim", 14, r2=0.04))
        p.append(torus(f"Fair_BellLip_{i}", (bx, 0, 2.275), 0.085, 0.01, "Brass_Trim", maj=14, mn=4))
    for s in (-1, 1):
        p.append(cyl(f"Fair_Finial_{s}", (s * 0.86, 0, 2.3), 0.08, 0.3, "Copper_Worked", 8, r2=0.0))
    export("fair_gate.glb", "FairGate")

# ================================================================ COURT KIT
def garden_wall():
    reset()  # along Blender -Y == Godot +Z, 3m, width .58 (x), h 1.15
    p = [box("Wall_Footing", (0, 0, 0.08), (0.58, 3.0, 0.16), "Stone_Hearth", 0.03)]
    rows = [(0.16, 0.26), (0.42, 0.24), (0.66, 0.22)]
    for ri, (z0, h) in enumerate(rows):
        y = -1.5; off = 0.25 * ri
        y += off * (ri % 2)
        while y < 1.5 - 0.05:
            L = min(random.uniform(0.38, 0.62), 1.5 - y)
            p.append(box(f"Wall_Stone_{ri}_{y:.2f}", (random.uniform(-.01, .01), y + L / 2, z0 + h / 2), (0.52 + random.uniform(-.02, .03), L - 0.02, h - 0.015), "Stone_Warm", 0.035))
            y += L
    p.append(box("Wall_Coping", (0, 0, 0.94), (0.58, 3.0, 0.10), "Stone_Hearth", 0.03))
    p.append(box("Wall_CopperCap", (0, 0, 1.02), (0.30, 3.0, 0.06), "Copper_Worked", 0.015))
    for s in (-1, 1):
        p.append(box(f"Wall_Pier_{s}", (0, s * 1.38, 0.55), (0.58, 0.24, 1.1), "Stone_Hearth", 0.03))
        p.append(cyl(f"Wall_Finial_{s}", (0, s * 1.38, 1.12), 0.07, 0.06, "Copper_Worked", 10, bevel=0.01))
    p.append(rivets("Wall_CapRivets", [(sx * 0.12, y, 1.05) for y in np.linspace(-1.2, 1.2, 9) for sx in (-1, 1)], "Iron_Wrought", 0.014))
    export("garden_wall.glb", "GardenWall")

def signpost():
    reset()
    p = [box("Sign_Base", (0, 0, 0.08), (0.36, 0.36, 0.16), "Stone_Hearth", 0.03),
         box("Sign_Post", (0, 0, 0.95), (0.14, 0.14, 1.9), "Timber_Oak", 0.02),
         cyl("Sign_Finial", (0, 0, 1.93), 0.08, 0.08, "Copper_Worked", 8, r2=0.0)]
    p.append(box("Sign_Bracket", (0.38, 0, 1.68), (0.76, 0.04, 0.04), "Iron_Blued", 0.006))
    p.append(arch_band("Sign_Scroll", 0.24, 1.48, 0.17, 0.025, 0.035, "Iron_Blued", a0=0, a1=math.pi / 2, seg=8))
    # two-sided board hung from bracket; front faces -Y (Godot +Z). Text by game.
    for x in (0.18, 0.62):
        p.append(cyl(f"Sign_Chain_{x}", (x, 0, 1.6), 0.006, 0.14, "Iron_Wrought", 6))
    p.append(box("Sign_Board", (0.40, 0, 1.33), (0.66, 0.05, 0.38), "Timber_Pine", 0.012))
    for z in (1.16, 1.50):
        p.append(box(f"Sign_Trim_{z}", (0.40, 0, z), (0.68, 0.065, 0.025), "Copper_Worked", 0.005))
    p.append(rivets("Sign_Rivets", [(x, sy * 0.034, z) for x in (0.1, 0.7) for z in (1.2, 1.46) for sy in (-1, 1)], "Iron_Wrought", 0.012))
    for h in (0.3, 1.2):
        p.append(box(f"Sign_Band_{h}", (0, 0, h), (0.16, 0.16, 0.04), "Iron_Blued", 0.005))
    export("signpost.glb", "Signpost")

def yard_dressing():
    reset()  # footprint x -1..1, Godot z -0.5..0.5 (Blender y)
    p = []
    # stave barrel
    bx, by = -0.62, 0.0
    for i in range(14):
        a = i * 2 * math.pi / 14
        p.append(box(f"Barrel_Stave_{i}", (bx + 0.27 * math.cos(a), by + 0.27 * math.sin(a), 0.38), (0.035, 0.12, 0.76), "Timber_Oak", 0.008, rot=(0, 0, a)))
    for h in (0.12, 0.64):
        p.append(torus(f"Barrel_Hoop_{h}", (bx, by, h), 0.29, 0.014, "Iron_Blued", maj=20, mn=4))
    p.append(cyl("Barrel_Lid", (bx, by, 0.73), 0.27, 0.03, "Timber_Pine", 18))
    p.append(cyl("Barrel_Water", (bx, by, 0.70), 0.26, 0.01, "Iron_Blued", 18))
    # bench
    p.append(box("Bench_Top", (0.35, 0.18, 0.46), (1.1, 0.34, 0.07), "Timber_Oak", 0.015))
    for s in (-1, 1):
        p.append(box(f"Bench_Leg_{s}", (0.35 + s * 0.44, 0.18, 0.22), (0.08, 0.30, 0.44), "Timber_Oak", 0.012))
        p.append(box(f"Bench_Strap_{s}", (0.35 + s * 0.44, 0.18, 0.47), (0.12, 0.36, 0.02), "Iron_Blued", 0.004))
    # target repair spools on bench
    for i, x in enumerate((0.0, 0.28)):
        p.append(cyl(f"Spool_{i}", (x, 0.18, 0.60), 0.08, 0.16, "Timber_Pine", 14, rot=(math.pi / 2, 0, 0)))
        p.append(cyl(f"SpoolRope_{i}", (x, 0.18, 0.60), 0.065, 0.12, "Cloth_Banner", 14, rot=(math.pi / 2, 0, 0)))
    # straw target disc leaning on stand
    p.append(cyl("Target_Face", (0.7, -0.32, 0.55), 0.36, 0.08, "Timber_Pine", 20, rot=(math.radians(75), 0, 0)))
    for r_, m in ((0.26, "Cloth_Banner"), (0.12, "Copper_Worked")):
        p.append(torus(f"Target_Ring_{r_}", (0.7, -0.37, 0.56), r_, 0.018, m, rot=(math.radians(75), 0, 0)))
    p.append(box("Target_Stand", (0.7, -0.1, 0.35), (0.06, 0.06, 0.7), "Timber_Oak", 0.01, rot=(math.radians(-20), 0, 0)))
    # tongs and wrench on bench
    for s in (-1, 1):
        p.append(box(f"Tongs_Arm_{s}", (0.62, 0.12 + s * 0.02, 0.505), (0.42, 0.018, 0.018), "Iron_Wrought", 0.004, rot=(0, 0, s * 0.06)))
    p.append(box("Wrench_Shaft", (0.2, 0.28, 0.505), (0.30, 0.03, 0.015), "Iron_Blued", 0.004))
    p.append(torus("Wrench_Head", (0.37, 0.28, 0.505), 0.03, 0.01, "Iron_Blued", maj=10, mn=4))
    export("yard_dressing.glb", "YardDressing")

def medallion():
    reset()
    p = [cyl("Medallion_Disc", (0, 0, 0.012), 1.0, 0.024, "Stone_Warm", 48, bevel=0.006)]
    p.append(torus("Medallion_CopperRim", (0, 0, 0.02), 0.95, 0.008, "Copper_Worked", maj=64, mn=4))
    p.append(torus("Medallion_IronRing", (0, 0, 0.02), 0.55, 0.007, "Iron_Wrought", maj=48, mn=4))
    for i in range(8):
        a = i * math.pi / 4
        p.append(box(f"Medallion_Ray_{i}", (0.75 * math.cos(a), 0.75 * math.sin(a), 0.026), (0.3, 0.05, 0.008), "Copper_Worked", 0.002, rot=(0, 0, a)))
    p.append(cyl("Medallion_Anvil", (0, 0, 0.026), 0.22, 0.008, "Brass_Trim", 6))
    for o in bpy.context.scene.objects:
        o.scale.z = min(o.scale.z, 1.0)
    export("medallion.glb", "ThresholdMedallion")

# ================================================================ GROUND
def ground():
    n = 1024
    big = fnoise(n, 3, 11); mid = fnoise(n, 14, 12); fine = fnoise(n, 120, 13)
    earth = np.clip((big - 0.58) * 3.0 + (mid - 0.5) * 0.6, 0, 1)  # compacted earth patches / path edge
    grass = np.array((0.24, 0.34, 0.13)); grass2 = np.array((0.33, 0.40, 0.17))
    loam = np.array((0.36, 0.28, 0.19)); grav = np.array((0.52, 0.48, 0.42))
    g = grass * (1 - mid[..., None]) + grass2 * mid[..., None]
    rgb = g * (1 - earth[..., None]) + loam * earth[..., None]
    h = 0.3 * mid + 0.2 * fine
    r = np.random.default_rng(3)
    # blades: short strokes, tile-wrapped
    for _ in range(26000):
        x, y = r.integers(0, n, 2); L = r.integers(5, 13); ang = r.normal(-math.pi / 2, 0.5)
        if earth[y, x] > 0.6 and r.random() < 0.85: continue
        c = grass2 * r.uniform(0.75, 1.25) + r.uniform(0, 0.04)
        for t in range(L):
            yy = int(y + t * math.sin(ang)) % n; xx = int(x + t * math.cos(ang)) % n
            k = 1 - t / L * 0.3
            rgb[yy, xx] = rgb[yy, xx] * 0.45 + c * k * 0.55; h[yy, xx] += 0.25 * (1 - t / L)
    # gravel
    for _ in range(9000):
        x, y = r.integers(0, n, 2)
        if earth[y, x] < 0.3: continue
        s = r.integers(1, 3); c = grav * r.uniform(0.8, 1.15)
        ys = np.arange(y, y + s) % n; xs = np.arange(x, x + s) % n
        rgb[np.ix_(ys, xs)] = c; h[np.ix_(ys, xs)] += 0.3
    # pale seed heads + dew
    for _ in range(1400):
        x, y = r.integers(0, n, 2)
        if earth[y, x] > 0.4: continue
        rgb[y % n, x % n] = (0.82, 0.78, 0.6); rgb[(y + 1) % n, x % n] = (0.74, 0.70, 0.52); h[y % n, x % n] += 0.3
    for _ in range(2500):
        x, y = r.integers(0, n, 2); rgb[y, x] = rgb[y, x] * 0.6 + 0.4 * np.array((0.8, 0.86, 0.85))
    rgb *= 0.92 + 0.08 * fine[..., None]
    save_img("court_ground", rgb).save()
    hb = (h + np.roll(h, 1, 0) + np.roll(h, 1, 1) + np.roll(h, -1, 0) + np.roll(h, -1, 1)) / 5
    dx = (np.roll(hb, -1, 1) - np.roll(hb, 1, 1)) * 2.0; dy = (np.roll(hb, -1, 0) - np.roll(hb, 1, 0)) * 2.0
    nz = np.ones_like(dx); l = np.sqrt(dx * dx + dy * dy + 1)
    nrm = np.dstack([-dx / l, dy / l, nz / l]) * 0.5 + 0.5  # OpenGL (+Y up) convention, as Godot expects
    save_img("court_ground_normal", nrm, noncolor=True)
    import shutil
    for nm in ("court_ground", "court_ground_normal"):
        shutil.copy(os.path.join(TEX, nm + ".png"), os.path.join(OUT, nm + ".png"))

# ================================================================ PREVIEW
def preview():
    reset()
    bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, "main_hall.glb"))
    place = {"museum_gate.glb": (G(-6.5, 0, 4.5), 0), "fair_gate.glb": (G(6.5, 0, 4.5), 0),
             "garden_wall.glb": (G(-10.5, 0, 3.0), 0), "signpost.glb": (G(2.6, 0, 3.2), 0),
             "yard_dressing.glb": (G(9.5, 0, 2.0), 0), "medallion.glb": (G(0, 0, 3.0), 0)}
    for f, (loc, rz) in place.items():
        before = set(bpy.context.scene.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(OUT, f))
        for o in set(bpy.context.scene.objects) - before:
            if o.parent is None: o.location = loc
    bpy.ops.mesh.primitive_plane_add(size=60, location=(0, -3, 0))
    gp = bpy.context.object; gm = bpy.data.materials.new("G"); gm.use_nodes = True
    nt = gm.node_tree; t = nt.nodes.new("ShaderNodeTexImage"); t.image = bpy.data.images.load(os.path.join(OUT, "court_ground.png"))
    mp = nt.nodes.new("ShaderNodeMapping"); mp.inputs["Scale"].default_value = (20, 20, 1); tc = nt.nodes.new("ShaderNodeTexCoord")
    nt.links.new(tc.outputs["UV"], mp.inputs[0]); nt.links.new(mp.outputs[0], t.inputs[0])
    nt.links.new(t.outputs[0], nt.nodes["Principled BSDF"].inputs["Base Color"]); gp.data.materials.append(gm)
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN")); bpy.context.collection.objects.link(sun)
    sun.data.energy = 3.5; sun.data.color = (1, 0.93, 0.82); sun.rotation_euler = (math.radians(50), 0, math.radians(-35))
    hl = bpy.data.objects.new("Hearth", bpy.data.lights.new("Hearth", "POINT")); bpy.context.collection.objects.link(hl)
    hl.data.energy = 600; hl.data.color = (1, 0.55, 0.25); hl.location = G(-3.1, 1.0, -4.2)
    w = bpy.data.worlds.new("W"); bpy.context.scene.world = w; w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.72, 0.95, 1); w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); bpy.context.collection.objects.link(cam)
    cam.location = G(9.5, 4.2, 15.5); cam.data.lens = 26
    d = Vector(G(-0.5, 2.0, -2.5)) - cam.location; cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc = bpy.context.scene; sc.camera = cam
    sc.render.engine = "BLENDER_EEVEE_NEXT"; sc.eevee.taa_render_samples = 16
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.view_settings.view_transform = "AgX"
    sc.render.filepath = os.path.join(OUT, "preview_oblique.png"); bpy.ops.render.render(write_still=True)
    cam.location = G(0, 1.7, 13.0); d = Vector(G(0, 2.2, -3)) - cam.location; cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sc.render.filepath = os.path.join(OUT, "preview_front.png"); bpy.ops.render.render(write_still=True)

steps = sys.argv[sys.argv.index("--") + 3:] if len(argv) > 2 else ["hall", "gates", "kit", "ground", "preview"]
for st, fn in (("hall", [main_hall]), ("gates", [museum_gate, fair_gate]),
               ("kit", [garden_wall, signpost, yard_dressing, medallion]), ("ground", [ground]), ("preview", [preview])):
    if st in steps:
        for f in fn:
            try: f()
            except Exception as e:
                import traceback; traceback.print_exc(); REPORT.append(f"FAILED {f.__name__}: {e}")
with open(os.path.join(OUT, "build_report.txt"), "a") as fh:
    fh.write("\n".join(REPORT) + "\n")
print("\n".join(REPORT))
