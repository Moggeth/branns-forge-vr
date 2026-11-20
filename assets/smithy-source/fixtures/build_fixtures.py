"""Brann's smithy fixture set. Run:
blender.exe -b --factory-startup --python build_fixtures.py
Blender modelling is Z-up with front = -Y; the glTF exporter converts it to Y-up with front = +Z.
All textures are procedural (numpy), 256 px (ground 512 px), embedded in each GLB as JPEG.
"""
import bpy, bmesh, math, os, sys, traceback
import numpy as np
from mathutils import Matrix, Vector

OUT = os.path.dirname(os.path.abspath(__file__))
TEX = os.path.join(OUT, "_tex"); os.makedirs(TEX, exist_ok=True)
S = 256
scene = bpy.context.scene

def clear():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
clear()

# ---------------------------------------------------------------- textures
def noise(s, beta, seed):
    r = np.random.default_rng(seed).standard_normal((s, s))
    f = np.fft.fftfreq(s); fx, fy = np.meshgrid(f, f); k = np.sqrt(fx**2 + fy**2); k[0, 0] = 1
    F = np.fft.fft2(r) / k**beta; F[0, 0] = 0
    n = np.real(np.fft.ifft2(F)); n -= n.min(); return n / n.max()

def uv(s):
    u, v = np.meshgrid(np.arange(s) / s, np.arange(s) / s); return u, v

def lerp(a, b, t):
    a = np.array(a); b = np.array(b); return a + (b - a) * t[..., None]

def normal_from(h, k=4.0):
    dx = np.roll(h, -1, 1) - np.roll(h, 1, 1); dy = np.roll(h, -1, 0) - np.roll(h, 1, 0)
    n = np.dstack([-dx * k, -dy * k, np.ones_like(h)]); n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5

def voronoi(s, n, seed):
    P = np.random.default_rng(seed).random((n, 2)); u, v = uv(s)
    G = np.stack([u.ravel(), v.ravel()], 1)
    d = G[:, None, :] - P[None]; d -= np.round(d); dist = np.linalg.norm(d, axis=2)
    idx = np.argsort(dist, 1)[:, :2]; d1 = np.take_along_axis(dist, idx[:, :1], 1)[:, 0]
    d2 = np.take_along_axis(dist, idx[:, 1:2], 1)[:, 0]
    return (d2 - d1).reshape(s, s), idx[:, 0].reshape(s, s)

def save_img(name, rgb, noncolor=False, s=None):
    s = rgb.shape[0]
    a = np.ones((s, s, 4), np.float32); a[..., :3] = np.clip(rgb, 0, 1)
    img = bpy.data.images.new(name, s, s, alpha=False)
    img.pixels.foreach_set(a[::-1].ravel())
    img.filepath_raw = os.path.join(TEX, name + ".png"); img.file_format = "PNG"; img.save()
    if noncolor: img.colorspace_settings.name = "Non-Color"
    return img

def tex_wood(seed, dark, light, planks=6):
    u, v = uv(S); w = noise(S, 1.6, seed); fine = noise(S, 0.8, seed + 1)
    g = 0.5 + 0.5 * np.sin(2 * np.pi * (u * 28 + w * 1.2 + v * 0.3))
    seam = (np.mod(u * planks, 1.0) < 0.025).astype(float)
    t = np.clip(0.25 + 0.5 * g * 0.7 + 0.3 * fine - 0.1, 0, 1)
    col = lerp(dark, light, t) * (1 - 0.55 * seam[..., None])
    h = g * 0.08 + fine * 0.1 - seam * 0.6
    return col, h

def tex_copper(seed, etched=True):
    u, v = uv(S); n = noise(S, 1.4, seed); f = noise(S, 0.7, seed + 3)
    col = lerp((0.45, 0.2, 0.09), (0.86, 0.48, 0.26), np.clip(n * 0.7 + f * 0.4, 0, 1))
    pat = np.clip((n - 0.62) * 4, 0, 1) * np.clip((f - 0.4) * 3, 0, 1)
    col = col * (1 - pat[..., None]) + np.array((0.28, 0.58, 0.5)) * pat[..., None]
    h = n * 0.2
    if etched:
        e = np.abs(np.sin(2 * np.pi * (u * 6 + 0.15 * np.sin(2 * np.pi * v * 6)))) * np.abs(np.sin(2 * np.pi * (v * 6 + 0.15 * np.sin(2 * np.pi * u * 6))))
        line = (e < 0.08).astype(float)
        col = col * (1 - 0.45 * line[..., None]); h -= line * 0.5
    return col, h

def tex_iron(seed):
    n = noise(S, 1.2, seed); f = noise(S, 0.5, seed + 5)
    col = lerp((0.09, 0.09, 0.1), (0.3, 0.3, 0.32), np.clip(n * 0.6 + f * 0.4, 0, 1))
    rust = np.clip((noise(S, 1.8, seed + 9) - 0.7) * 4, 0, 1)
    col = col * (1 - rust[..., None]) + np.array((0.33, 0.16, 0.08)) * rust[..., None]
    return col, n * 0.3 + f * 0.2 + rust * 0.2

def tex_leather(seed):
    n = noise(S, 1.3, seed); f = noise(S, 0.15, seed + 2)
    col = lerp((0.2, 0.1, 0.05), (0.48, 0.27, 0.13), np.clip(n * 0.7 + f * 0.3, 0, 1))
    return col, f * 0.6 + n * 0.3

def tex_rope(seed):
    u, v = uv(S); n = noise(S, 0.6, seed)
    s_ = 0.5 + 0.5 * np.sin(2 * np.pi * (u * 8 + v * 8))
    return lerp((0.42, 0.32, 0.18), (0.78, 0.65, 0.42), s_ * 0.7 + n * 0.3), s_

def tex_enamel(seed):
    n = noise(S, 1.5, seed); f = noise(S, 0.3, seed + 4)
    col = lerp((0.05, 0.055, 0.06), (0.15, 0.155, 0.165), np.clip(n * 0.6 + f * 0.3, 0, 1))
    return col, f * 0.15

def tex_stone(seed, s=S, cells=18):
    edge, idx = voronoi(s, cells, seed); n = noise(s, 1.3, seed + 1); f = noise(s, 0.6, seed + 2)
    cellv = np.random.default_rng(seed).random(cells)[idx]
    mortar = np.clip(1 - edge / 0.025, 0, 1)
    stone = lerp((0.36, 0.33, 0.3), (0.62, 0.55, 0.47), np.clip(cellv * 0.5 + n * 0.4 + f * 0.2, 0, 1))
    grass = lerp((0.16, 0.24, 0.08), (0.3, 0.42, 0.13), f)
    col = stone * (1 - mortar[..., None]) + grass * mortar[..., None]
    h = np.clip(edge / 0.04, 0, 1) * 0.7 + n * 0.2 + f * 0.1
    rough = 0.65 + 0.2 * f + 0.15 * mortar
    return col, h, rough

def tex_hot(seed):
    edge, _ = voronoi(S, 14, seed); n = noise(S, 1.2, seed + 1)
    crack = np.clip(1 - edge / 0.05, 0, 1) ** 1.5
    heat = np.clip(crack + (n - 0.55) * 1.5, 0, 1)
    base = lerp((0.06, 0.04, 0.03), (0.25, 0.1, 0.05), n)
    emis = lerp((0.0, 0.0, 0.0), (1.0, 0.42, 0.08), heat) + np.array((0.25, 0.05, 0.0)) * (heat[..., None] ** 3)
    return base, emis, 1 - heat

# ---------------------------------------------------------------- materials
MATS = {}
def mat(name, col=None, h=None, rough=0.5, metal=0.0, emis=None, emis_tex=None, strength=0.0, flat=None):
    if name in MATS: return MATS[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    if col is not None:
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = save_img(name + "_col", col)
        nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
    elif flat is not None:
        b.inputs["Base Color"].default_value = (*flat, 1)
    if h is not None:
        t2 = nt.nodes.new("ShaderNodeTexImage"); t2.image = save_img(name + "_nrm", normal_from(h), True)
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(t2.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], b.inputs["Normal"])
    if emis_tex is not None:
        t3 = nt.nodes.new("ShaderNodeTexImage"); t3.image = save_img(name + "_emi", emis_tex)
        nt.links.new(t3.outputs["Color"], b.inputs["Emission Color"])
        b.inputs["Emission Strength"].default_value = strength
    elif emis is not None:
        b.inputs["Emission Color"].default_value = (*emis, 1); b.inputs["Emission Strength"].default_value = strength
    MATS[name] = m; return m

def M(key):
    if key in MATS: return MATS[key]
    if key == "oak": c, h = tex_wood(11, (0.22, 0.11, 0.05), (0.62, 0.36, 0.17), 8); return mat(key, c, h, 0.45)
    if key == "oak_carved": c, h = tex_wood(12, (0.3, 0.15, 0.06), (0.7, 0.42, 0.2), 1); return mat(key, c, h, 0.4)
    if key == "walnut": c, h = tex_wood(13, (0.12, 0.06, 0.03), (0.38, 0.2, 0.09), 4); return mat(key, c, h, 0.5)
    if key == "copper": c, h = tex_copper(21); return mat(key, c, h, 0.35, 1.0)
    if key == "copper_plain": c, h = tex_copper(22, False); return mat(key, c, h, 0.3, 1.0)
    if key == "iron": c, h = tex_iron(31); return mat(key, c, h, 0.6, 0.85)
    if key == "steel": c, h = tex_iron(32); c = c * 1.5 + 0.06; return mat(key, c, h, 0.4, 1.0)
    if key == "leather": c, h = tex_leather(41); return mat(key, c, h, 0.6)
    if key == "rope": c, h = tex_rope(51); return mat(key, c, h, 0.85)
    if key == "thread": return mat(key, flat=(0.85, 0.76, 0.55), rough=0.8)
    if key == "brass": c, h = tex_copper(61, False); c = c * np.array((1.1, 1.25, 0.8)); return mat(key, c, h, 0.3, 1.0)
    if key == "enamel": c, h = tex_enamel(71); return mat(key, c, h, 0.3)
    if key == "text": return mat(key, flat=(0.93, 0.84, 0.62), rough=0.5)
    if key == "stone": c, h, r = tex_stone(81); return mat(key, c * 0.85, h, 0.8)
    if key == "teal_glow": return mat(key, flat=(0.05, 0.5, 0.45), emis=(0.1, 0.95, 0.8), strength=3.0, rough=0.3)
    if key == "bomb_glow": return mat(key, flat=(0.6, 0.15, 0.05), emis=(1.0, 0.35, 0.08), strength=4.0, rough=0.2)
    if key == "lamp_glass": return mat(key, flat=(1.0, 0.75, 0.45), emis=(1.0, 0.6, 0.28), strength=2.0, rough=0.15)
    if key == "fire": return mat(key, flat=(1.0, 0.4, 0.05), emis=(1.0, 0.45, 0.1), strength=6.0)
    if key == "hot":
        b, e, r = tex_hot(91); return mat(key, b, r * 0.5, 0.7, 0.2, emis_tex=e, strength=5.0)
    raise KeyError(key)

# ---------------------------------------------------------------- geometry helpers
def link(o, name, m):
    o.name = name; o.data.name = name
    if m is not None:
        o.data.materials.clear(); o.data.materials.append(M(m) if isinstance(m, str) else m)
    return o

def bevel(o, w, seg=2):
    md = o.modifiers.new("bevel", "BEVEL"); md.width = w; md.segments = seg; md.limit_method = "ANGLE"
    return o

def smooth(o):
    for p in o.data.polygons: p.use_smooth = True
    return o

def box(name, size, loc, m, bev=0.004, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.active_object; o.data.transform(Matrix.Diagonal((*size, 1)))
    link(o, name, m)
    if bev: bevel(o, min(bev, min(size) * 0.45))
    return o

def cyl(name, r, d, loc, m, rot=(0, 0, 0), v=24, bev=0.0):
    bpy.ops.mesh.primitive_cylinder_add(vertices=v, radius=r, depth=d, location=loc, rotation=rot)
    o = link(bpy.context.active_object, name, m); smooth(o)
    if bev: bevel(o, bev)
    return o

def sph(name, r, loc, m, seg=16, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=seg // 2, radius=r, location=loc)
    o = link(bpy.context.active_object, name, m); o.data.transform(Matrix.Diagonal((*scale, 1))); return smooth(o)

def torus(name, R, r, loc, m, rot=(0, 0, 0), seg=32, mseg=8, half=False):
    bpy.ops.mesh.primitive_torus_add(major_radius=R, minor_radius=r, major_segments=seg, minor_segments=mseg, location=loc, rotation=rot)
    o = link(bpy.context.active_object, name, m)
    if half:
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -1e-4], context="VERTS"); bm.to_mesh(o.data); bm.free()
    return smooth(o)

def lathe(name, prof, m, loc=(0, 0, 0), segs=32, rot=(0, 0, 0), sy=1.0, uvscale=1.0):
    verts, faces, uvs = [], [], []
    n = len(prof); L = [0.0]
    for j in range(1, n):
        L.append(L[-1] + math.dist(prof[j], prof[j - 1]))
    for j, (r, z) in enumerate(prof):
        for i in range(segs + 1):
            a = 2 * math.pi * i / segs; verts.append((r * math.cos(a), r * math.sin(a) * sy, z))
    for j in range(n - 1):
        for i in range(segs):
            a = j * (segs + 1) + i; b = a + segs + 1
            faces.append((a, a + 1, b + 1, b))
    me = bpy.data.meshes.new(name); me.from_pydata(verts, [], faces); me.update()
    lay = me.uv_layers.new(name="UVMap")
    for p in me.polygons:
        for li in p.loop_indices:
            vi = me.loops[li].vertex_index; j, i = divmod(vi, segs + 1)
            lay.data[li].uv = (i / segs * uvscale, L[j] / max(L[-1], 1e-6) * uvscale)
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    o.location = loc; o.rotation_euler = rot
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    link(o, name, m); return smooth(o)

def ensure_uv(o, k=3.0):
    me = o.data
    if me.uv_layers: return
    lay = me.uv_layers.new(name="UVMap")
    for li, l in enumerate(me.loops):
        c = me.vertices[l.vertex_index].co; lay.data[li].uv = ((c.x + c.y) * k, c.z * k)

def tube(name, pts, r, m, res=2):
    cu = bpy.data.curves.new(name, "CURVE"); cu.dimensions = "3D"; cu.bevel_depth = r; cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new("POLY"); sp.points.add(len(pts) - 1)
    for i, p in enumerate(pts): sp.points[i].co = (*p, 1)
    o = bpy.data.objects.new(name, cu); scene.collection.objects.link(o)
    bpy.ops.object.select_all(action="DESELECT"); o.select_set(True); bpy.context.view_layer.objects.active = o
    bpy.ops.object.convert(target="MESH"); o = bpy.context.active_object
    ensure_uv(o); link(o, name, m); return smooth(o)

def merge(objs, name):
    objs = [o for o in objs if o]
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join(); o = bpy.context.active_object; o.name = name; o.data.name = name; return o

def strap(name, p1, p2, w, t, y, m):
    dx, dz = p2[0] - p1[0], p2[1] - p1[1]; L = math.hypot(dx, dz)
    return box(name, (L + w * 0.6, t, w), ((p1[0] + p2[0]) / 2, y, (p1[1] + p2[1]) / 2), m, 0.003, (0, -math.atan2(dz, dx), 0))

def stitches(name, pts, y_off=0.0, size=0.008, every=0.016):
    out = []
    for k in range(len(pts) - 1):
        a, b = Vector(pts[k]), Vector(pts[k + 1]); L = (b - a).length; n = max(1, int(L / every))
        d = (b - a).normalized()
        for i in range(n):
            p = a + d * (i + 0.5) * L / n
            o = box("st", (size, 0.003, 0.0025), p, "thread", 0)
            o.rotation_euler = (0, -math.atan2(d.z, d.x) + 0.5, 0); out.append(o)
    o = merge(out, name); bpy.ops.object.transform_apply(location=False, rotation=True, scale=False); return o

def parent_to(objs, empty):
    for o in objs:
        mw = o.matrix_world.copy(); o.parent = empty; o.matrix_world = mw

def empty(name, loc):
    e = bpy.data.objects.new(name, None); e.location = loc; scene.collection.objects.link(e); return e

def export(fname):
    bpy.ops.object.select_all(action="SELECT")
    path = os.path.join(OUT, fname)
    kw = dict(filepath=path, export_format="GLB", use_selection=True, export_apply=True, export_yup=True)
    try:
        bpy.ops.export_scene.gltf(export_image_format="JPEG", **kw)
    except TypeError:
        bpy.ops.export_scene.gltf(**kw)
    print("EXPORTED", fname, os.path.getsize(path))
    clear()

# ---------------------------------------------------------------- assets
def build_bucket():
    prof = [(0, 0), (0.23, 0), (0.29, 0.30), (0.272, 0.30), (0.213, 0.022), (0, 0.022)]
    lathe("pail_staves", prof, "oak", segs=48)
    for i, z in enumerate((0.045, 0.235)):
        r = 0.23 + 0.06 * z / 0.30 + 0.004
        lathe(f"pail_hoop_{i}", [(r - 0.004, z - 0.018), (r + 0.004, z - 0.016), (r + 0.006, z), (r + 0.004, z + 0.016), (r - 0.004, z + 0.018)], "iron", segs=48)
    for s in (-1, 1):
        box(f"pail_ear_{'LR'[s > 0]}", (0.016, 0.05, 0.06), (s * 0.288, 0, 0.265), "copper", 0.006)
        cyl(f"pail_ear_rivet_{'LR'[s > 0]}", 0.008, 0.03, (s * 0.297, 0, 0.27), "brass", rot=(0, math.pi / 2, 0), v=12)
    h = torus("pail_handle_bail", 0.305, 0.008, (0, 0, 0.27), "iron", half=True, seg=40)
    h.rotation_euler = (math.radians(-150), 0, 0)
    g = lathe("pail_handle_grip", [(0.0125, -0.05), (0.014, -0.04), (0.014, 0.04), (0.0125, 0.05)], "walnut", segs=16, rot=(0, math.pi / 2, 0))
    g.location = (0, -0.305 * math.cos(math.radians(30)) * 1.0, 0.27 - 0.305 * 0.5)
    # front donation medallion + coins inside
    cyl("pail_medallion", 0.045, 0.006, (0, -0.268, 0.14), "copper", rot=(math.radians(90 - 11.3), 0, 0), v=32, bev=0.002)
    cs = [cyl("c", 0.016, 0.003, (math.cos(a) * d, math.sin(a) * d, 0.024 + 0.003 * k), "copper_plain", v=16)
          for k, (a, d) in enumerate([(0.3, 0.05), (1.9, 0.09), (3.3, 0.03), (4.4, 0.12), (5.6, 0.07)])]
    merge(cs, "pail_coins")
    export("bucket.glb")

def build_lever():
    box("lever_base_plate", (0.30, 0.10, 0.025), (0, 0, -0.0125), "iron", 0.006)
    for s in (-1, 1):
        box(f"lever_bracket_{'LR'[s > 0]}", (0.02, 0.07, 0.07), (s * 0.08, 0, 0.02), "iron", 0.006)
        cyl(f"lever_pivot_cap_{'LR'[s > 0]}", 0.022, 0.012, (s * 0.096, 0, 0.03), "copper", rot=(0, math.pi / 2, 0), bev=0.003)
        tube(f"lever_arm_{'LR'[s > 0]}", [(s * 0.065, 0, 0.03), (s * 0.068, -0.01, 0.2), (s * 0.08, -0.02, 0.38), (s * 0.095, -0.015, 0.5)], 0.011, "iron")
    cyl("lever_pivot_axle", 0.016, 0.2, (0, 0, 0.03), "iron", rot=(0, math.pi / 2, 0))
    lathe("lever_grip", [(0.012, -0.11), (0.02, -0.105), (0.024, -0.09), (0.022, -0.05), (0.025, 0), (0.022, 0.05), (0.024, 0.09), (0.02, 0.105), (0.012, 0.11)],
          "copper", segs=24, rot=(0, math.pi / 2, 0), loc=(0, -0.015, 0.5))
    rs = [torus("r", 0.025, 0.003, (x, -0.015, 0.5), None, rot=(0, math.pi / 2, 0), seg=24, mseg=6) for x in (-0.07, -0.02, 0.02, 0.07)]
    link(merge(rs, "lever_grip_wraps"), "lever_grip_wraps", "iron")
    rv = [sph("r", 0.006, (x, -0.051, -0.005), None, 8) for x in (-0.12, -0.04, 0.04, 0.12)]
    link(merge(rv, "lever_base_rivets"), "lever_base_rivets", "brass")
    export("lever.glb")

def build_pouch():
    body = box("pouch_body", (0.30, 0.12, 0.27), (0, 0, -0.095), "leather", 0.04)
    body.modifiers["bevel"].segments = 4
    lathe("pouch_neck_gather", [(0.05, 0.03), (0.075, 0.04), (0.06, 0.06), (0.05, 0.075), (0.065, 0.08), (0.06, 0.082)], "leather", loc=(0, 0, 0), segs=24, sy=0.6)
    box("pouch_top_panel", (0.27, 0.10, 0.01), (0, 0, 0.03), "leather", 0.004)
    torus("pouch_drawstring", 0.068, 0.006, (0, 0, 0.055), "rope", seg=32, mseg=6).data.transform(Matrix.Diagonal((1, 0.62, 1, 1)))
    for s in (-1, 1):
        tube(f"pouch_cord_end_{'LR'[s > 0]}", [(s * 0.04, -0.045, 0.055), (s * 0.06, -0.07, 0.02), (s * 0.055, -0.075, -0.02)], 0.005, "rope")
        lathe(f"pouch_toggle_{'LR'[s > 0]}", [(0, -0.02), (0.01, -0.015), (0.011, 0.0), (0.01, 0.015), (0, 0.02)], "brass", loc=(s * 0.055, -0.076, -0.035), segs=12)
    box("pouch_flap", (0.26, 0.012, 0.12), (0, -0.066, -0.03), "leather", 0.01)
    box("pouch_buckle_strap", (0.04, 0.008, 0.12), (0, -0.074, -0.1), "leather", 0.003)
    torus("pouch_buckle", 0.02, 0.004, (0, -0.08, -0.13), "brass", rot=(math.pi / 2, 0, 0), seg=4, mseg=6)
    box("pouch_belt_loop", (0.07, 0.02, 0.2), (0, 0.07, -0.04), "leather", 0.004)
    box("pouch_belt_stub", (0.36, 0.012, 0.045), (0, 0.086, 0.02), "leather", 0.004)
    stitches("pouch_stitches_flap", [(-0.12, -0.0735, 0.025), (-0.12, -0.0735, -0.08), (0.12, -0.0735, -0.08), (0.12, -0.0735, 0.025)])
    stitches("pouch_stitches_body", [(-0.135, -0.062, -0.21), (0.135, -0.062, -0.21)])
    export("pouch.glb")

def gauntlet(side):
    s = 1 if side == "R" else -1; cx = 0.14 * s; p = f"gauntlet_{side}_"; objs = []
    objs.append(lathe(p + "cuff", [(0.058, -0.015), (0.068, -0.012), (0.07, 0.03), (0.064, 0.075), (0.058, 0.08), (0.054, 0.075), (0.052, -0.012)], "copper", loc=(cx, 0, 0.0), segs=32, sy=0.8))
    for i, z in enumerate((-0.006, 0.07)):
        t = torus(p + f"cuff_glowband_{i}", 0.067 - i * 0.003, 0.0035, (cx, 0, z), "teal_glow", seg=32, mseg=6); t.data.transform(Matrix.Diagonal((1, 0.8, 1, 1))); objs.append(t)
    sc = []
    for k in (-1, 1):  # scrollwork spirals on the front of the cuff
        pts = []
        for i in range(40):
            a = i / 39 * 2.6 * math.pi; r = 0.022 * (1 - i / 46)
            x = k * 0.018 + k * r * math.cos(a) * 0.9; z = 0.035 + r * math.sin(a)
            pts.append((cx + x, -0.058 - 0.004, z))
        sc.append(tube("sc", pts, 0.0022, None, 1))
    pts = [(cx + 0.05 * math.sin(a), -0.06 * math.cos(a) * 0.95 - 0.004, 0.035 + 0.012 * math.sin(3 * a)) for a in np.linspace(-1.1, 1.1, 30)]
    sc.append(tube("sc", pts, 0.002, None, 1))
    objs.append(link(merge(sc, p + "wrist_scrollwork"), p + "wrist_scrollwork", "teal_glow"))
    objs.append(box(p + "hand_back", (0.105, 0.055, 0.19), (cx, 0, 0.18), "leather", 0.022))
    objs.append(box(p + "hand_plate", (0.085, 0.014, 0.12), (cx, -0.03, 0.18), "iron", 0.006))
    objs.append(lathe(p + "bomb_bezel", [(0.0, -0.004), (0.03, -0.004), (0.032, 0.0), (0.03, 0.006), (0.024, 0.008)], "copper", loc=(cx, -0.038, 0.18), rot=(math.pi / 2, 0, 0), segs=24))
    objs.append(sph(p + "bomb_core", 0.021, (cx, -0.044, 0.18), "bomb_glow", 16))
    objs.append(tube(p + "bomb_fuse", [(cx + 0.02 * s, -0.045, 0.2), (cx + 0.035 * s, -0.05, 0.215), (cx + 0.03 * s, -0.055, 0.24), (cx + 0.04 * s, -0.05, 0.255)], 0.0025, "rope"))
    objs.append(cyl(p + "knuckle_bar", 0.02, 0.12, (cx, -0.008, 0.3), "copper", rot=(0, math.pi / 2, 0), bev=0.004))
    st = [sph("k", 0.008, (cx + dx, -0.027, 0.3), None, 10) for dx in (-0.042, -0.014, 0.014, 0.042)]
    objs.append(link(merge(st, p + "knuckle_studs"), p + "knuckle_studs", "brass"))
    fing = []
    for i, dx in enumerate((-0.04, -0.013, 0.013, 0.04)):
        ln = (0.075, 0.085, 0.08, 0.065)[i if s > 0 else 3 - i]
        pts = [(cx + dx, 0, 0.3), (cx + dx * 1.05, -0.006, 0.3 + ln * 0.5), (cx + dx * 1.1, -0.02, 0.3 + ln)]
        fing.append(tube("f", pts, 0.0115, None, 2))
    objs.append(link(merge(fing, p + "fingers"), p + "fingers", "leather"))
    jr = [torus("j", 0.013, 0.0028, (cx + dx * 1.05, -0.007, 0.3 + 0.035), None, seg=16, mseg=5) for dx in (-0.04, -0.013, 0.013, 0.04)]
    objs.append(link(merge(jr, p + "finger_rings"), p + "finger_rings", "iron"))
    objs.append(tube(p + "thumb", [(cx - 0.055 * s, 0, 0.17), (cx - 0.075 * s, -0.012, 0.22), (cx - 0.08 * s, -0.025, 0.26)], 0.013, "leather"))
    for k, z in enumerate((0.0, 0.035, 0.07)):  # bomb canisters on the outer side of the cuff
        objs.append(cyl(p + f"canister_{k}", 0.011, 0.028, (cx + s * 0.076, 0.0, z + 0.0), "brass", rot=(0, 0, 0), v=12, bev=0.002))
    e = empty("gauntlet_" + side, (cx, 0, 0.035)); parent_to(objs, e)

def build_gloves():
    gauntlet("L"); gauntlet("R")
    box("stand_base", (0.5, 0.22, 0.035), (0, 0, -0.14), "walnut", 0.008)
    for s in (-1, 1):
        cyl(f"stand_post_{'LR'[s > 0]}", 0.012, 0.11, (s * 0.14, 0, -0.07), "iron")
        t = torus(f"stand_cradle_{'LR'[s > 0]}", 0.05, 0.005, (s * 0.14, 0, -0.018), "copper", seg=24, half=True)
        t.rotation_euler = (math.pi / 2, 0, 0); t.data.transform(Matrix.Rotation(math.pi, 4, "Z"))
    box("stand_nameplate", (0.12, 0.006, 0.022), (0, -0.112, -0.14), "copper", 0.002)
    export("gloves.glb")

def build_door():
    W, H, T = 2.9, 2.8, 0.12
    for s, side in ((-1, "L"), (1, "R")):
        cx = s * (0.01 + 0.72)
        box(f"door_leaf_{side}", (1.44, T, H), (cx, 0, H / 2), "oak", 0.012)
        for k, (z0, z1) in enumerate(((0.25, 1.15), (1.65, 2.55))):
            pnl = box(f"door_{side}_carved_panel_{k}", (1.1, 0.014, z1 - z0), (cx, -T / 2 - 0.005, (z0 + z1) / 2), "oak_carved", 0.012)
            pnl.modifiers["bevel"].segments = 3
        # steel diamond straps
        dcx, dcz, hw, hh = cx, 1.4, 0.55, 0.95
        pts = [(dcx, dcz + hh), (dcx + hw, dcz), (dcx, dcz - hh), (dcx - hw, dcz), (dcx, dcz + hh)]
        ds = [strap("d", pts[i], pts[i + 1], 0.07, 0.016, -T / 2 - 0.012, None) for i in range(4)]
        for d in ds: d.modifiers.clear()
        for z in (0.32, 2.48):
            ds.append(box("h", (1.38, 0.016, 0.09), (cx, -T / 2 - 0.012, z), None, 0))
        link(merge(ds, f"door_{side}_steel_straps"), f"door_{side}_steel_straps", "steel")
        rv = []
        for (x, z) in pts[:4]:
            rv.append(sph("r", 0.016, (x, -T / 2 - 0.022, z), None, 10))
        for z in (0.32, 2.48):
            for x in np.linspace(cx - 0.62, cx + 0.62, 6):
                rv.append(sph("r", 0.013, (x, -T / 2 - 0.022, z), None, 8))
        link(merge(rv, f"door_{side}_rivets"), f"door_{side}_rivets", "iron")
        # pull ring near the seam
        rx = s * 0.12
        cyl(f"door_{side}_ring_boss", 0.04, 0.012, (rx, -T / 2 - 0.02, 1.15), "iron", rot=(math.pi / 2, 0, 0), bev=0.003)
        torus(f"door_{side}_pull_ring", 0.055, 0.009, (rx, -T / 2 - 0.03, 1.1), "iron", rot=(math.pi / 2 - 0.15, 0, 0), seg=24)
        # back braces
        box(f"door_{side}_back_brace", (1.3, 0.02, 0.12), (cx, T / 2 + 0.01, 1.4), "walnut", 0.004, rot=(0, 0.6 * s, 0))
    # copper dwarven maker mark on the left leaf diamond centre
    mx, mz, my = -0.73, 1.4, -T / 2 - 0.016
    cyl("door_maker_mark", 0.12, 0.012, (mx, my, mz), "copper", rot=(math.pi / 2, 0, 0), v=6, bev=0.004)
    rn = [box("m", (0.11, 0.008, 0.022), (mx, my - 0.01, mz + 0.03), None, 0),          # anvil face
          box("m", (0.05, 0.008, 0.05), (mx, my - 0.01, mz - 0.01), None, 0),           # anvil waist
          box("m", (0.09, 0.008, 0.018), (mx, my - 0.01, mz - 0.045), None, 0),         # anvil foot
          box("m", (0.012, 0.008, 0.09), (mx + 0.03, my - 0.01, mz + 0.09 - 0.03), None, 0, rot=(0, 0.7, 0)),  # hammer
          box("m", (0.04, 0.008, 0.02), (mx + 0.055, my - 0.01, mz + 0.085), None, 0, rot=(0, 0.7, 0))]
    link(merge(rn, "door_maker_mark_rune"), "door_maker_mark_rune", "brass")
    torus("door_maker_mark_ring", 0.105, 0.005, (mx, my - 0.007, mz), "brass", rot=(math.pi / 2, 0, 0), seg=6, mseg=4)
    cyl("door_R_diamond_boss", 0.07, 0.014, (0.73, my, mz), "iron", rot=(math.pi / 2, 0, 0), v=24, bev=0.004)
    export("foundry_door.glb")

def build_plaque():
    box("plaque_writeable_face", (1.0, 0.012, 1.0), (0, 0.006, 0), "enamel", 0.0)
    box("plaque_backing", (1.12, 0.048, 1.12), (0, 0.036, 0), "walnut", 0.006)
    fr = [box("f", (1.12, 0.03, 0.06), (0, 0.0, z), None, 0) for z in (0.53, -0.53)] + \
         [box("f", (0.06, 0.03, 1.0), (x, 0.0, 0), None, 0) for x in (0.53, -0.53)]
    o = merge(fr, "plaque_frame"); link(o, "plaque_frame", "enamel"); bevel(o, 0.006, 2)
    bands, fas = [], []
    for sx in (-1, 1):
        for sz in (-1, 1):
            bands.append(box("b", (0.16, 0.004, 0.022), (sx * 0.48, -0.017, sz * 0.545), None, 0))
            bands.append(box("b", (0.022, 0.004, 0.16), (sx * 0.545, -0.017, sz * 0.48), None, 0))
            for (fx, fz) in ((0.43, 0.545), (0.545, 0.43), (0.545, 0.545)):
                fas.append(sph("s", 0.0065, (sx * fx, -0.02, sz * fz), None, 8, (1, 0.6, 1)))
    link(merge(bands, "plaque_copper_corner_bands"), "plaque_copper_corner_bands", "copper_plain")
    link(merge(fas, "plaque_brass_fasteners"), "plaque_brass_fasteners", "brass")
    # The live ledger owns all lettering on this panel.
    export("furniture_plaque.glb")

def build_billet():
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.active_object; o.data.transform(Matrix.Diagonal((0.23, 0.14, 0.07, 1)))
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges, cuts=4, use_grid_fill=True)
    rng = np.random.default_rng(7)
    for v in bm.verts:
        c = v.co; taper = 1 - 0.12 * (c.z / 0.035)  # slightly trapezoid ingot
        v.co.x *= taper; v.co.y *= taper
        v.co += Vector(rng.normal(0, 0.0035, 3))
        v.co.x = max(-0.115, min(0.115, v.co.x)); v.co.y = max(-0.07, min(0.07, v.co.y)); v.co.z = max(-0.035, min(0.035, v.co.z))
    bm.to_mesh(o.data); bm.free()
    link(o, "coal_billet", "hot"); bevel(o, 0.004, 2); smooth(o)
    export("coal_billet.glb")

def build_lamp():
    ls = []
    for i in range(5):
        z = -0.012 - i * 0.024
        t = torus("l", 0.012, 0.0025, (0, 0, z), None, rot=(math.pi / 2, 0, (i % 2) * math.pi / 2), seg=12, mseg=5)
        t.data.transform(Matrix.Diagonal((1, 1, 1.35, 1))); ls.append(t)
    link(merge(ls, "lamp_chain"), "lamp_chain", "iron")
    lathe("lamp_cap", [(0.008, -0.12), (0.02, -0.125), (0.05, -0.14), (0.085, -0.17), (0.09, -0.178), (0.0, -0.18)], "copper", segs=32)
    for i, z in enumerate((-0.19, -0.205, -0.22)):
        r = 0.07 - i * 0.008
        lathe(f"lamp_louver_{i}", [(r - 0.02, z - 0.006), (r, z), (r + 0.004, z + 0.002)], "copper_plain", segs=32)
    prof = [(0.0, -0.2), (0.03, -0.205), (0.05, -0.24), (0.075, -0.3), (0.085, -0.36), (0.08, -0.41), (0.06, -0.45), (0.03, -0.47), (0.0, -0.475)]
    lathe("lamp_optic_glass", prof, "lamp_glass", segs=32)
    bars = []
    for k in range(6):
        a = k / 6 * 2 * math.pi; pts = [((r + 0.008) * math.cos(a), (r + 0.008) * math.sin(a), z) for r, z in prof[1:-1]]
        bars.append(tube("b", pts, 0.0035, None, 1))
    for z, r in ((-0.3, 0.085), (-0.45, 0.07)):
        bars.append(torus("c", r, 0.004, (0, 0, z), None, seg=32, mseg=5))
    link(merge(bars, "lamp_cage"), "lamp_cage", "iron")
    lathe("lamp_finial", [(0.0, -0.47), (0.035, -0.475), (0.03, -0.49), (0.012, -0.51), (0.016, -0.53), (0.0, -0.55)], "copper", segs=24)
    export("armory_lamp.glb")

def build_ground():
    col, h, rough = tex_stone(101, 512, 26)
    for nm, arr, nc in (("ground_path_color", col, False), ("ground_path_normal", normal_from(h, 6), True), ("ground_path_roughness", np.dstack([rough] * 3), True)):
        save_img(nm, arr, nc)
        import shutil; shutil.copy(os.path.join(TEX, nm + ".png"), os.path.join(OUT, nm + ".png"))

# ---------------------------------------------------------------- miniatures (.78 x .55 footprint, <= .6 tall)
def plinth(n):
    box(f"mini{n}_plinth", (0.78, 0.55, 0.05), (0, 0, 0.025), "walnut", 0.01)
    box(f"mini{n}_plinth_trim", (0.74, 0.51, 0.012), (0, 0, 0.056), "copper_plain", 0.003)

def anvil(p, x, y, z, s=1.0, m="iron"):
    a = [box("a", (0.12 * s, 0.07 * s, 0.035 * s), (x, y, z + 0.018 * s), None, 0),
         box("a", (0.06 * s, 0.045 * s, 0.05 * s), (x, y, z + 0.06 * s), None, 0),
         box("a", (0.2 * s, 0.07 * s, 0.035 * s), (x, y, z + 0.1 * s), None, 0)]
    bpy.ops.mesh.primitive_cone_add(vertices=12, radius1=0.03 * s, radius2=0.003, depth=0.08 * s, location=(x - 0.135 * s, y, z + 0.105 * s), rotation=(0, -math.pi / 2, 0))
    a.append(bpy.context.active_object)
    o = merge(a, p + "anvil"); link(o, p + "anvil", m); ensure_uv(o); return o

def hearth(p, x, y, s=1.0):
    b = 0.062
    box(p + "hearth_stones", (0.34 * s, 0.2 * s, 0.22 * s), (x, y, b + 0.11 * s), "stone", 0.01)
    box(p + "hearth_mouth", (0.18 * s, 0.03 * s, 0.11 * s), (x, y - 0.09 * s, b + 0.07 * s), "walnut", 0.005)
    sph(p + "hearth_fire", 0.05 * s, (x, y - 0.1 * s, b + 0.05 * s), "fire", 12, (1.2, 0.5, 1.0))
    box(p + "hearth_chimney", (0.14 * s, 0.12 * s, 0.3 * s), (x, y + 0.03 * s, b + 0.37 * s), "stone", 0.008)
    lathe(p + "hearth_hood", [(0.0, b + 0.3 * s), (0.2 * s, b + 0.22 * s), (0.21 * s, b + 0.215 * s), (0.0, b + 0.3 * s - 0.004)], "copper", loc=(x, y, 0), segs=4, sy=0.7)

def build_mini1():
    plinth(1); hearth("mini1_", 0, 0.08)
    logs = [cyl("l", 0.018, 0.14, (0.25 + 0.02 * (i % 2), 0.0 + 0.04 * (i // 2) - 0.05, 0.08 + 0.035 * (i % 2)), None, rot=(0, math.pi / 2, 0.2 * i), v=10) for i in range(5)]
    link(merge(logs, "mini1_log_pile"), "mini1_log_pile", "oak")
    lathe("mini1_kettle", [(0, 0.062), (0.04, 0.062), (0.05, 0.09), (0.04, 0.12), (0.02, 0.13), (0, 0.13)], "copper", loc=(-0.25, -0.12, 0), segs=20)
    box("mini1_stool", (0.08, 0.08, 0.06), (-0.25, 0.08, 0.092), "oak", 0.006)
    export("mini_1.glb")

def build_mini2():
    plinth(2)
    box("mini2_bench_top", (0.5, 0.16, 0.025), (0, 0.1, 0.2), "oak", 0.005)
    for x in (-0.22, 0.22):
        for y in (0.04, 0.16):
            box(f"mini2_bench_leg", (0.025, 0.025, 0.14), (x, y, 0.13), "walnut", 0.003)
    box("mini2_shelf", (0.5, 0.06, 0.015), (0, 0.24, 0.42), "oak", 0.003)
    box("mini2_backboard", (0.54, 0.015, 0.4), (0, 0.27, 0.36), "walnut", 0.004)
    g = []
    for i, (x, r) in enumerate(((-0.14, 0.05), (-0.06, 0.03), (0.1, 0.045))):
        g.append(cyl("g", r, 0.012, (x, 0.08, 0.235 + r), None, rot=(math.pi / 2, 0, 0), v=12 + 4 * i))
    link(merge(g, "mini2_gears"), "mini2_gears", "brass")
    box("mini2_vise", (0.05, 0.05, 0.05), (0.2, 0.06, 0.24), "iron", 0.004)
    for i, x in enumerate((-0.15, -0.05, 0.05, 0.15)):
        lathe(f"mini2_jar_{i}", [(0, 0.428), (0.02, 0.428), (0.022, 0.47), (0.012, 0.48), (0, 0.48)], "copper_plain" if i % 2 else "lamp_glass", loc=(x, 0.24, 0), segs=12)
    tube("mini2_rope_coil", [(0.3 * 0 + 0.03 * math.cos(a) - 0.28, 0.24 + 0.03 * math.sin(a), 0.07 + a * 0.002) for a in np.linspace(0, 6 * math.pi, 50)], 0.006, "rope")
    export("mini_2.glb")

def build_mini3():
    plinth(3)
    lathe("mini3_stump", [(0, 0.062), (0.1, 0.062), (0.085, 0.08), (0.08, 0.2), (0, 0.2)], "oak", segs=16)
    anvil("mini3_", 0, 0, 0.2, 1.3, "steel")
    torus("mini3_rune_circle", 0.22, 0.004, (0, 0, 0.064), "teal_glow", seg=48)
    torus("mini3_rune_circle_inner", 0.17, 0.003, (0, 0, 0.064), "teal_glow", seg=6)
    for i in range(3):
        a = i * 2.1
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.025, location=(0.2 * math.cos(a), 0.2 * math.sin(a) * 0.8, 0.42 + 0.05 * i))
        o = link(bpy.context.active_object, f"mini3_floating_crystal_{i}", "teal_glow"); o.scale = (0.6, 0.6, 1.4); ensure_uv(o)
    box("mini3_hammer_handle", (0.015, 0.015, 0.16), (0.08, -0.02, 0.37), "walnut", 0.003, rot=(0, 0.5, 0))
    box("mini3_hammer_head", (0.06, 0.03, 0.03), (0.12, -0.02, 0.44), "steel", 0.004, rot=(0, 0.5, 0))
    export("mini_3.glb")

def build_mini4():
    plinth(4)
    lathe("mini4_furnace", [(0, 0.062), (0.15, 0.062), (0.15, 0.3), (0.11, 0.38), (0.06, 0.42), (0.06, 0.58), (0, 0.58)], "stone", loc=(-0.18, 0.06, 0), segs=16)
    box("mini4_furnace_mouth", (0.1, 0.02, 0.08), (-0.18, -0.085, 0.16), "fire", 0.004)
    lathe("mini4_crucible", [(0, 0.0), (0.035, 0.0), (0.045, 0.06), (0.04, 0.065), (0.0, 0.01)], "iron", loc=(0.05, -0.02, 0.3), rot=(0, -1.0, 0), segs=16)
    tube("mini4_molten_pour", [(0.1, -0.02, 0.33), (0.13, -0.02, 0.27), (0.14, -0.02, 0.15)], 0.009, "hot")
    box("mini4_ingot_mold", (0.28, 0.1, 0.04), (0.18, -0.02, 0.08), "iron", 0.006)
    ig = [box("i", (0.05, 0.03, 0.012), (0.08 + 0.065 * k, -0.02, 0.1), None, 0.0) for k in range(4)]
    link(merge(ig, "mini4_glowing_ingots"), "mini4_glowing_ingots", "hot")
    for x in (0.0, 0.3):
        box("mini4_gantry_post", (0.02, 0.02, 0.5), (x, 0.15, 0.31), "oak", 0.003)
    box("mini4_gantry_beam", (0.34, 0.025, 0.025), (0.15, 0.15, 0.56), "oak", 0.003)
    tube("mini4_chain", [(0.1, 0.15, 0.55), (0.08, 0.05, 0.45), (0.07, -0.02, 0.37)], 0.003, "iron")
    anvil("mini4_", 0.25, 0.15, 0.062, 0.8)
    export("mini_4.glb")

JOBS = [build_bucket, build_lever, build_pouch, build_gloves, build_door, build_plaque, build_billet, build_lamp, build_ground,
        build_mini1, build_mini2, build_mini3, build_mini4]
only = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
for job in JOBS:
    if only and job.__name__ not in only: continue
    try:
        job()
    except Exception:
        print("FAILED", job.__name__); traceback.print_exc(); clear()
