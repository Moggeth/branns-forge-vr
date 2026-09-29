import bpy, bmesh, math, os, sys, json, random
import numpy as np
from mathutils import Vector, noise as mnoise

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "output")
os.makedirs(OUT, exist_ok=True)
TEX = 512

def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)

def pnoise(seed, octaves=5, base=2, xs=1, ys=1):
    rng = np.random.RandomState(seed)
    u = np.linspace(0, 1, TEX, endpoint=False)[None, :]
    v = np.linspace(0, 1, TEX, endpoint=False)[:, None]
    out = np.zeros((TEX, TEX)); amp = 1.0; tot = 0
    for o in range(octaves):
        f = base * 2 ** o
        for _ in range(4):
            fx, fy = rng.randint(1, f + 1) * xs, rng.randint(1, f + 1) * ys
            out += amp * np.sin(2 * np.pi * (fx * u + fy * v) + rng.uniform(0, 6.28))
        tot += amp * 2; amp *= 0.55
    return np.clip(out / tot + 0.5, 0, 1)

def sm(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t)

def mix(c1, c2, t):
    return np.array(c1)[None, None, :] * (1 - t[..., None]) + np.array(c2)[None, None, :] * t[..., None]

def make_image(name, rgb, alpha=None):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    px = np.ones((TEX, TEX, 4)); px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel().astype(np.float32))
    img.pack(); img.colorspace_settings.name = 'sRGB'
    return img

def make_rough(name, r):
    img = bpy.data.images.new(name, TEX, TEX, alpha=False)
    px = np.ones((TEX, TEX, 4)); px[..., 0] = px[..., 1] = px[..., 2] = np.clip(r, 0, 1)
    img.pixels.foreach_set(px.ravel().astype(np.float32))
    img.colorspace_settings.name = 'Non-Color'; img.pack()
    return img

def material(name, col, rough):
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial"); b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    t1 = nt.nodes.new("ShaderNodeTexImage"); t1.image = col
    t2 = nt.nodes.new("ShaderNodeTexImage"); t2.image = rough
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(t1.outputs[0], b.inputs["Base Color"])
    nt.links.new(t2.outputs[0], sep.inputs[0])
    nt.links.new(sep.outputs[1], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = 0; b.inputs["Specular IOR Level"].default_value = 0.15
    nt.links.new(b.outputs[0], out.inputs[0])
    return m

def finish(name, bm, mat):
    for v in bm.verts: v.co = Vector((v.co.x, -v.co.z, v.co.y))
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); bpy.context.collection.objects.link(ob)
    me.materials.append(mat)
    for p in me.polygons: p.use_smooth = True
    return ob

def cyl_uv(bm, ymin, ymax, cx=0, cz=0):
    uv = bm.loops.layers.uv.verify(); h = max(ymax - ymin, 1e-6)
    for f in bm.faces:
        us = []
        for l in f.loops:
            p = l.vert.co; us.append(math.atan2(p.z - cz, p.x - cx) / (2 * math.pi) + 0.5)
        if max(us) - min(us) > 0.5: us = [u + 1 if u < 0.5 else u for u in us]
        for l, u in zip(f.loops, us):
            l[uv].uv = (u, (l.vert.co.y - ymin) / h)

def fbm3(p, seed, o=3):
    s = 0; a = 1; f = 1; t = 0
    for i in range(o):
        s += a * mnoise.noise(p * f + Vector((seed * 7.1, seed * 3.3, seed * 1.7))); t += a; a *= .5; f *= 2.1
    return s / t

# ---------------- ASSETS ----------------
def bank_boulder():
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
    for v in bm.verts:
        d = v.co.normalized()
        r = 1 + .22 * fbm3(d * 1.3, 1) + .07 * fbm3(d * 4, 2, 2)
        v.co = Vector((d.x * r * .60, d.y * r * .42, d.z * r * .50))
    ymin = min(v.co.y for v in bm.verts)
    for v in bm.verts:
        v.co.y = max(v.co.y, ymin * .62)
    ymin = min(v.co.y for v in bm.verts)
    for v in bm.verts: v.co.y -= ymin
    ymax = max(v.co.y for v in bm.verts); cyl_uv(bm, 0, ymax)
    # texture: v = height, u = around
    n1, n2, n3 = pnoise(11), pnoise(12, 6, 4), pnoise(13, 4, 8)
    V = np.linspace(0, 1, TEX)[:, None] * np.ones((1, TEX))
    stone = mix((.38, .37, .36), (.56, .53, .48), n2)
    stone = stone * (0.85 + .3 * n3[..., None])
    moss_m = sm(.5, .62, n1 * .45 + V * .8 - .05 + (n3 - .5) * .25)
    moss = mix((.16, .30, .08), (.35, .50, .14), n2)
    col = stone * (1 - moss_m[..., None]) + moss * moss_m[..., None]
    wet = 1 - sm(.14, .30, V + (n1 - .5) * .12)
    col = col * (1 - .45 * wet[..., None]) + np.array([.02, .05, .03]) * (.45 * wet[..., None])
    speck = (n3 > .72) & (moss_m < .5); col[speck] = col[speck] * .7  # dark crack flecks
    rough = .82 - .5 * wet + .1 * moss_m + (n2 - .5) * .1
    mat = material("bank_boulder_mat", make_image("bank_boulder_col", col), make_rough("bank_boulder_rgh", rough))
    return finish("bank_boulder", bm, mat)

def sphere_rock(seed, sc, flat, sub=4):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=1.0)
    for v in bm.verts:
        d = v.co.normalized()
        r = 1 + .22 * fbm3(d * 1.3, seed) + .07 * fbm3(d * 4, seed + 1, 2)
        v.co = Vector((d.x * r * sc[0], d.y * r * sc[1], d.z * r * sc[2]))
    ymin = min(v.co.y for v in bm.verts)
    for v in bm.verts: v.co.y = max(v.co.y, ymin * flat)
    ymin = min(v.co.y for v in bm.verts)
    for v in bm.verts: v.co.y -= ymin
    return bm

def river_slab():
    bm = sphere_rock(5, (.75, .17, .50), .55)
    for v in bm.verts:
        v.co.y = v.co.y * .85 + (round(v.co.y * 14) / 14) * .15
        v.co.y = min(v.co.y, .22)
    ymax = max(v.co.y for v in bm.verts); cyl_uv(bm, 0, ymax)
    n1, n2, n3 = pnoise(21, ys=2), pnoise(22, 6, 4, ys=3), pnoise(23, 4, 8, ys=3)
    V = np.linspace(0, 1, TEX)[:, None] * np.ones((1, TEX))
    strata = .5 + .5 * np.sin(2 * np.pi * (V * 9 + n2 * .8))
    stone = mix((.42, .40, .40), (.66, .60, .52), strata * .6 + n2 * .4)
    stone *= (0.86 + .28 * n3[..., None])
    lich = sm(.66, .72, n1 * .6 + n3 * .4)
    stone = stone * (1 - lich[..., None]) + np.array([.62, .68, .42]) * lich[..., None] * .95
    moss_m = sm(.62, .8, V * .7 + n1 * .4 - .15)
    stone = stone * (1 - .6 * moss_m[..., None]) + np.array([.24, .38, .1]) * .6 * moss_m[..., None]
    wet = 1 - sm(.1, .32, V + (n1 - .5) * .12)
    col = stone * (1 - .5 * wet[..., None]) + np.array([.03, .05, .04]) * .5 * wet[..., None]
    rough = .7 - .4 * wet + .15 * lich + (n2 - .5) * .12 - .1 * strata * (1 - wet)
    mat = material("river_slab_mat", make_image("river_slab_col", col), make_rough("river_slab_rgh", rough))
    return finish("river_slab", bm, mat)

def fallen_branch():
    L = 2.5; N = 30; K = 10
    bm = bmesh.new(); rings = []
    for i in range(N + 1):
        t = i / N; y = t * L
        r = .17 * (1 - .55 * t) + (.05 if i % 7 == 3 else 0) * (1 - t)
        ring = []
        for k in range(K):
            a = 2 * math.pi * k / K
            rr = r * (1 + .10 * math.sin(a * 3 + t * 9) + .08 * fbm3(Vector((math.cos(a) * 2, t * 6, math.sin(a) * 2)), 7, 2))
            root = 0
            if t < .22:
                f = 1 - t / .22
                root = .55 * f * f * max(0, math.cos(a * 2.5 + 0.7)) ** 2 * (1 + f)
            rr *= 1 + root
            ring.append(bm.verts.new((math.cos(a) * rr, y - (.05 * (1 - t / .22) if t < .22 and k % 2 else 0), math.sin(a) * rr)))
        rings.append(ring)
    for i in range(N):
        for k in range(K):
            bm.faces.new((rings[i][k], rings[i][(k + 1) % K], rings[i + 1][(k + 1) % K], rings[i + 1][k]))
    for ring in (rings[0], rings[-1]):
        first = ring is rings[0]
        c = bm.verts.new((0, sum(v.co.y for v in ring) / K, 0))
        for k in range(K):
            bm.faces.new((ring[k], ring[(k + 1) % K], c) if first else (ring[(k + 1) % K], ring[k], c))
    for (yy, ang, ln, rd) in ((.9, 1.2, .38, .045), (1.5, 3.8, .3, .035), (1.95, 5.4, .22, .028)):
        base = Vector((math.cos(ang), 0, math.sin(ang)))
        rt = .17 * (1 - .55 * yy / L) * .7
        p0 = base * rt + Vector((0, yy, 0)); ax = (base * .8 + Vector((0, .55, 0))).normalized()
        side = ax.cross(Vector((0, 1, 0))).normalized(); up2 = ax.cross(side).normalized()
        rs = []
        for j in range(3):
            row = []
            for k in range(6):
                a = 2 * math.pi * k / 6; rr = rd * (1 - .45 * j / 2) * (1 if j < 2 else .5)
                row.append(bm.verts.new(p0 + ax * (ln * j / 2 - .03) + side * math.cos(a) * rr + up2 * math.sin(a) * rr))
            rs.append(row)
        for j in range(2):
            for k in range(6): bm.faces.new((rs[j][k], rs[j][(k + 1) % 6], rs[j + 1][(k + 1) % 6], rs[j + 1][k]))
        c = bm.verts.new(p0 + ax * (ln + .01))
        for k in range(6): bm.faces.new((rs[2][(k + 1) % 6], rs[2][k], c))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    cyl_uv(bm, 0, L)
    for v in bm.verts: v.co = Vector((v.co.y, -v.co.x, v.co.z))
    ymin = min(v.co.y for v in bm.verts)
    for v in bm.verts: v.co.y -= ymin
    n1, n2, n3 = pnoise(31, 5, 6, xs=6), pnoise(32, 5, 4, xs=4), pnoise(33, 5, 8)
    U = np.ones((TEX, 1)) * np.linspace(0, 1, TEX)[None, :]; V = np.linspace(0, 1, TEX)[:, None] * np.ones((1, TEX))
    bark = mix((.20, .13, .08), (.42, .30, .20), n1)
    bark *= (.75 + .5 * n2[..., None])
    groove = sm(.55, .7, n1); bark *= (1 - .35 * groove[..., None])
    top = np.abs(np.cos(np.pi * U))
    lich = sm(.55, .68, n3 * .5 + n2 * .3 + top * .3 - .1) * (.4 + .6 * top)
    lc = mix((.60, .68, .38), (.42, .58, .30), n1)
    bark = bark * (1 - .85 * lich[..., None]) + lc * .85 * lich[..., None]
    moss = sm(.68, .8, top * .6 + n3 * .5 - .2) * sm(.1, .5, V) * (1 - lich)
    bark = bark * (1 - .8 * moss[..., None]) + np.array([.18, .34, .09]) * .8 * moss[..., None]
    rz = 1 - sm(.06, .2, V)
    bark = bark * (1 - .5 * rz[..., None]) + np.array([.15, .10, .06]) * .5 * rz[..., None]
    rough = .88 + (n2 - .5) * .12 - .1 * moss
    mat = material("fallen_branch_mat", make_image("fallen_branch_col", bark), make_rough("fallen_branch_rgh", rough))
    return finish("fallen_branch", bm, mat)

def fern_patch():
    rng = random.Random(9)
    bm = bmesh.new(); uvs = {}
    nfr = 11
    for fi in range(nfr):
        az = 2 * math.pi * fi / nfr + rng.uniform(-.2, .2)
        inner = fi <= 2
        sc = rng.uniform(.5, .65) if inner else rng.uniform(.8, 1.05)
        dx, dz = math.cos(az), math.sin(az); cx, cz = -dz, dx
        S = 14; st = []
        for i in range(S + 1):
            t = i / S
            h = (.04 + .43 * sc * t * .92) * (.55 if inner else 1)
            hy = .05 + sc * .30 * (t * (1.5 - t)) * (1.6 if inner else 1.28) + .04 * math.sin(t * 5 + fi)
            P = Vector((dx * h, hy, dz * h))
            w = .1 * sc * math.sin(math.pi * min(1, t ** .75)) + .004
            if i % 2: w *= .5
            if i == S:
                st.append(bm.verts.new(P + Vector((dx * .03, -.01, dz * .03)))); uvs[st[-1]] = (.5, 1.0); continue
            rows = []
            for kind in range(4):
                if kind == 0: q = P + Vector((0, .007, 0)); uu = .5
                elif kind == 1: q = P + Vector((cx, 0, cz)) * w + Vector((0, .22 * w, 0)); uu = 0.
                elif kind == 2: q = P - Vector((0, .007, 0)); uu = .5
                else: q = P - Vector((cx, 0, cz)) * w + Vector((0, .22 * w, 0)); uu = 1.
                vv = bm.verts.new(q); uvs[vv] = (uu, t); rows.append(vv)
            st.append(rows)
        for i in range(S - 1):
            a, b = st[i], st[i + 1]
            for k in range(4): bm.faces.new((a[k], b[k], b[(k + 1) % 4], a[(k + 1) % 4]))
        for k in range(4): bm.faces.new((st[S - 1][k], st[S], st[S - 1][(k + 1) % 4]))
        bm.faces.new(st[0])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv = bm.loops.layers.uv.verify()
    for f in bm.faces:
        for l in f.loops: l[uv].uv = uvs[l.vert]
    ymin = min(v.co.y for v in bm.verts)
    for v in bm.verts: v.co.y -= ymin
    n1, n2 = pnoise(41, 5, 6), pnoise(42, 4, 10, ys=2)
    U = np.ones((TEX, 1)) * np.linspace(0, 1, TEX)[None, :]; V = np.linspace(0, 1, TEX)[:, None] * np.ones((1, TEX))
    edge = np.abs(U - .5) * 2
    base = mix((.07, .22, .06), (.42, .62, .13), sm(0, 1, V * .9 + (n1 - .5) * .3))
    veins = .5 + .5 * np.sin(2 * np.pi * (V * 26 - edge * 5))
    base *= (.88 + .2 * veins[..., None]) * (.9 + .2 * n2[..., None])
    rib = 1 - sm(.0, .12, np.abs(U - .5))
    base = base * (1 - .7 * rib[..., None]) + np.array([.55, .68, .30]) * .7 * rib[..., None]
    base = base * (1 - .25 * (sm(.9, 1, V) * (n2 > .55))[..., None]) + np.array([.45, .34, .10]) * .25 * (sm(.9, 1, V) * (n2 > .55))[..., None]
    rough = .55 + (n2 - .5) * .2 - .15 * rib
    mat = material("fern_patch_mat", make_image("fern_patch_col", base), make_rough("fern_patch_rgh", rough))
    return finish("fern_patch", bm, mat)

ASSETS = {"bank_boulder": bank_boulder, "river_slab": river_slab, "fallen_branch": fallen_branch, "fern_patch": fern_patch}

def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

def export(ob):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, ob.name + ".glb"), export_format='GLB',
        use_selection=True, export_yup=True, export_apply=True, export_texcoords=True, export_normals=True,
        export_lights=False, export_cameras=False, export_image_format='JPEG', export_jpeg_quality=92)

def scene_setup():
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT'
    sc.render.resolution_x, sc.render.resolution_y = 960, 540
    sc.view_settings.view_transform = 'Standard'
    w = bpy.data.worlds.new("w"); w.use_nodes = True; sc.world = w
    bg = w.node_tree.nodes["Background"]; bg.inputs[0].default_value = (.55, .70, .90, 1); bg.inputs[1].default_value = 0.35
    sun = bpy.data.lights.new("sun", 'SUN'); sun.energy = 3.2; sun.angle = .1
    so = bpy.data.objects.new("sun", sun); bpy.context.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), 0, math.radians(35))
    gm = bpy.data.meshes.new("ground"); g = bmesh.new(); bmesh.ops.create_grid(g, x_segments=1, y_segments=1, size=12); g.to_mesh(gm); g.free()
    go = bpy.data.objects.new("ground", gm); bpy.context.collection.objects.link(go)
    gmat = bpy.data.materials.new("g"); gmat.use_nodes = True
    gmat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (.22, .34, .12, 1)
    gm.materials.append(gmat)
    return sc

def camera(sc, loc, target, lens=50):
    cd = bpy.data.cameras.new("cam"); cd.lens = lens
    co = bpy.data.objects.new("cam", cd); bpy.context.collection.objects.link(co)
    co.location = loc; d = Vector(target) - Vector(loc)
    co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler(); sc.camera = co

def render(path):
    bpy.context.scene.render.filepath = path; bpy.ops.render.render(write_still=True)

PLACE = {"bank_boulder": -2.4, "river_slab": -0.7, "fern_patch": 0.9, "fallen_branch": 1.7}

def glb_info(path):
    import struct
    d = open(path, 'rb').read(); n = struct.unpack('<I', d[12:16])[0]
    j = json.loads(d[20:20 + n]); a = j["accessors"]; p = j["meshes"][0]["primitives"][0]
    pos = a[p["attributes"]["POSITION"]]
    return {"meshes": len(j["meshes"]), "primitives": len(j["meshes"][0]["primitives"]), "materials": len(j["materials"]),
        "images": len(j.get("images", [])), "textures": len(j["textures"]), "has_uv": "TEXCOORD_0" in p["attributes"],
        "has_normals": "NORMAL" in p["attributes"], "triangles": a[p["indices"]]["count"] // 3,
        "lights_ext": "KHR_lights_punctual" in j.get("extensionsUsed", []),
        "bbox_min": [round(x, 3) for x in pos["min"]], "bbox_max": [round(x, 3) for x in pos["max"]],
        "size_m": [round(pos["max"][i] - pos["min"][i], 3) for i in range(3)], "bytes": os.path.getsize(path),
        "pbr": j["materials"][0]["pbrMetallicRoughness"]}

def main():
    reset(); random.seed(1); np.random.seed(1)
    obs = [fn() for fn in ASSETS.values()]
    sc = scene_setup()
    for ob in obs: export(ob)
    stats = {}
    for ob in obs:
        g = glb_info(os.path.join(OUT, ob.name + ".glb")); pbr = g.pop("pbr")
        g["base_color_texture"] = "baseColorTexture" in pbr; g["roughness_texture"] = "metallicRoughnessTexture" in pbr
        assert g["meshes"] == 1 and g["primitives"] == 1 and g["materials"] == 1 and g["triangles"] <= 1500 and g["base_color_texture"] and g["roughness_texture"] and not g["lights_ext"], (ob.name, g)
        stats[ob.name] = g
    json.dump(stats, open(os.path.join(OUT, "stats.json"), "w"), indent=2)
    camera(sc, (1.9, -2.6, 1.2), (-.6, 0, .3), 40)
    for ob in obs: ob.hide_render = ob.name != "bank_boulder"
    render(os.path.join(OUT, "first_render.png"))
    for ob in obs: ob.hide_render = False
    for ob in obs:
        ob.location.x = PLACE[ob.name]
        if ob.name == "river_slab": ob.rotation_euler.z = .5
        if ob.name == "fallen_branch": ob.rotation_euler.z = -.12; ob.location.y = .3
    camera(sc, (.5, -6.0, 1.65), (.5, 0, .3), 32); render(os.path.join(OUT, "ground_preview.png"))
    camera(sc, (-.1, -7.5, 8.5), (-.1, 0, 0), 40); render(os.path.join(OUT, "rts_preview.png"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "bank.blend"))
    print("BANK_BUILD_OK")

main()
