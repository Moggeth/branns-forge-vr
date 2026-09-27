"""Siegebird belt quiver for Brann's Forge VR -- deterministic Blender builder.

Run:  blender -b --factory-startup --python-exit-code 2 --python build_quiver.py
Writes output/quiver.blend, output/quiver.glb and output/verify.json (re-import check).

Authoring frame is Blender Z-up with +Y = forward.  The glTF exporter (+Y up) maps
Blender (x, y, z) -> Godot (x, z, -y), so Blender +Y becomes Godot -Z (forward) and
Blender +Z becomes Godot +Y (up).  Origin = belt attachment point (centre of belt loop).
"""
import bpy, math, os, json
import numpy as np
from mathutils import Vector

TAU = math.tau
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "output")

# ---------------------------------------------------------------- dimensions (metres)
CY = 0.064            # body centre, forward of the belt plane
Z0, Z1 = -0.245, 0.035  # leather body extent (cup below, collar above hide the ends)
E = 3.0               # superellipse exponent: a rounded-rectangle quiver section
N = 48                # ring resolution around the body
BANDS = (-0.085, -0.190)

def body_ab(z):
    t = min(1.0, max(0.0, (z - Z0) / (Z1 - Z0)))
    s = math.sin(0.9 * math.pi * t)
    return 0.070 + 0.010 * s + 0.004 * t, 0.047 + 0.007 * s + 0.003 * t

def se_xy(a, b, th):
    s, c = math.sin(th), math.cos(th)
    return a * math.copysign(abs(s) ** (2 / E), s), -b * math.copysign(abs(c) ** (2 / E), c)

def se_ring(a, b, z, n=N):
    """theta=0 at back centre (-Y), CCW seen from above: back -> +X -> front -> -X."""
    return [Vector((x, CY + y, z)) for x, y in (se_xy(a, b, TAU * j / n) for j in range(n))]

def surf(th, z, off=0.0):
    """Point and outward normal on the body surface (offset outwards by `off`)."""
    a, b = body_ab(z); a += off; b += off
    x, y = se_xy(a, b, th)
    nx = math.copysign(abs(x / a) ** (E - 1), x) / a
    ny = math.copysign(abs(y / b) ** (E - 1), y) / b
    return Vector((x, CY + y, z)), Vector((nx, ny, 0)).normalized()

# ---------------------------------------------------------------- materials & textures
def hexc(h, a=1.0):
    return [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)] + [a]

def lin(h):
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in hexc(h)[:3]] + [1.0]

def vnoise(rng, W, H, gw, gh):
    """Tileable smooth value noise, shape (H, W)."""
    g = rng.random((gh, gw))
    def axis(n, gn):
        x = np.arange(n) * gn / n; i0 = np.floor(x).astype(int); f = x - i0
        return i0 % gn, (i0 + 1) % gn, f * f * (3 - 2 * f)
    x0, x1, fx = axis(W, gw); y0, y1, fy = axis(H, gh)
    top = g[np.ix_(y0, x0)] * (1 - fx) + g[np.ix_(y0, x1)] * fx
    bot = g[np.ix_(y1, x0)] * (1 - fx) + g[np.ix_(y1, x1)] * fx
    return top * (1 - fy[:, None]) + bot * fy[:, None]

def new_image(name, rgb, noncolor=False):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = "Non-Color" if noncolor else "sRGB"   # before pixels: changing it resets the buffer
    px = np.ones((h, w, 4), dtype=np.float32); px[..., :3] = np.clip(rgb, 0, 1)
    img.pixels.foreach_set(px.ravel()); img.update()
    img.file_format = "PNG"; img.pack()
    return img

def height_to_normal(H, mu, mv, strength):
    """H in metres-ish units; mu/mv = metres per pixel along u (columns) and v (rows)."""
    du = (np.roll(H, -1, 1) - np.roll(H, 1, 1)) / (2 * mu)
    dv = (np.roll(H, -1, 0) - np.roll(H, 1, 0)) / (2 * mv)
    n = np.stack([-du * strength, -dv * strength, np.ones_like(H)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5

def leather_maps(circ, size=1024):
    """Body wrap: u = around (0 = back centre, 0.5 = front), v = height Z0..Z1.
    Pebbled grain, side saddle-stitch seams and a tooled overlapping-feather front panel."""
    rng = np.random.default_rng(7041)
    W = Hh = size; hgt = Z1 - Z0
    mu, mv = circ / W, hgt / Hh
    def fbm(cell, amp):
        return amp * vnoise(rng, W, Hh, max(2, int(circ / cell)), max(2, int(hgt / cell)))
    grain = fbm(0.006, 0.5) + fbm(0.0025, 0.35) + fbm(0.0011, 0.25)
    crease = np.abs(fbm(0.004, 1.0) - 0.5); crease = np.clip(1 - crease / 0.05, 0, 1) ** 2
    H = 0.00012 * grain - 0.00010 * crease
    blotch = fbm(0.03, 1.0)
    u = (np.arange(W) + 0.5) / W; v = (np.arange(Hh) + 0.5) / Hh
    X = (u[None, :] - 0.5) * circ * np.ones((Hh, 1))          # metres from front centre
    Z = Z0 + v[:, None] * hgt * np.ones((1, W))               # world height
    groove = np.zeros((Hh, W)); raised = np.zeros((Hh, W)); stitch = np.zeros((Hh, W))
    # tooled feather panels between the bands
    panels = [(-0.178, -0.098), (-0.072, 0.020)]
    PW = 0.066; S = 0.0165; R = S * 0.62
    for zlo, zhi in panels:
        inside = (np.abs(X) < PW) & (Z > zlo) & (Z < zhi)
        sid = np.full((Hh, W), -1); local = np.zeros((Hh, W)); spine = np.zeros((Hh, W))
        rows = int((zhi - zlo) / S) + 2
        k = 0
        for r in range(rows):                                # bottom rows first; upper rows overlap
            cz = zlo + r * S
            off = 0.5 * S * (r % 2)
            for c in range(-6, 7):
                cx = c * S + off
                dx, dz = X - cx, Z - cz
                d = np.sqrt(dx * dx + dz * dz)
                m = inside & ((d < R) | ((np.abs(dx) < R) & (dz > 0) & (dz < S * 1.2)))
                sid[m] = k; local[m] = np.clip(1 - (d[m] / R) ** 2, 0, 1)
                spine[m] = np.clip(1 - np.abs(dx[m]) / 0.0007, 0, 1) * (dz[m] > -R * 0.75)
                k += 1
        edge = inside & ((sid != np.roll(sid, 1, 0)) | (sid != np.roll(sid, 1, 1)) |
                         (sid != np.roll(sid, -1, 0)) | (sid != np.roll(sid, -1, 1)))
        eb = edge.astype(float)
        eb = np.maximum(eb, 0.5 * (np.roll(eb, 1, 1) + np.roll(eb, -1, 1)))
        groove += eb + 0.6 * spine * inside
        raised += inside * local
        # double tooled border around each panel
        for inset in (0.004, 0.0065):
            bx = np.abs(np.abs(X) - (PW + inset)) < 0.0007
            bz = (np.abs(Z - (zlo - inset)) < 0.0006) | (np.abs(Z - (zhi + inset)) < 0.0006)
            groove += (bx & (Z > zlo - inset) & (Z < zhi + inset)) + (bz & (np.abs(X) < PW + inset))
    # saddle-stitched side seams at u = 0.25 / 0.75
    for us in (0.25, 0.75):
        xs = (us - 0.5) * circ
        dxs = X - xs
        groove += np.clip(1 - np.abs(dxs) / 0.0008, 0, 1)
        for side in (-1, 1):
            sx = dxs - side * 0.0042
            ph = ((Z + sx * 0.6 * side) / 0.0052) % 1.0          # slanted dashes
            st = (np.abs(sx) < 0.0011) & (ph > 0.18) & (ph < 0.82)
            stitch = np.maximum(stitch, st * np.clip(1 - np.abs(ph - 0.5) / 0.32, 0, 1) ** 0.5)
            groove += ((np.abs(sx) < 0.0011) & ~st) * 0.7          # stitch holes
    groove = np.clip(groove, 0, 1)
    H += 0.00035 * raised - 0.00045 * groove + 0.00030 * stitch
    # albedo (sRGB)
    base = np.array(hexc("2e160e")[:3]); dark = np.array(hexc("140805")[:3])
    burn = np.array(hexc("5c3119")[:3]); cord = np.array(hexc("cdb487")[:3])
    t = np.clip(0.55 + 0.9 * (grain - 0.55) + 0.25 * (blotch - 0.5), 0, 1)
    col = dark + (base - dark) * t[..., None]
    col = col + (burn - col) * (0.55 * raised ** 2)[..., None] * (0.6 + 0.4 * blotch)[..., None]
    col = col * (1 - 0.55 * groove - 0.35 * crease)[..., None]
    col = col + (cord * (0.75 + 0.25 * grain[..., None]) - col) * stitch[..., None]
    nrm = height_to_normal(H, mu, mv, 1.0)
    return col, nrm

def fletch_map(w=256, h=64):
    u = (np.arange(w) + 0.5) / w; v = (np.arange(h) + 0.5) / h
    U, V = np.meshgrid(u, v)
    ivory = np.array(hexc("e6d9b8")[:3]); teal = np.array(hexc("137f86")[:3])
    ember = np.array(hexc("c9582a")[:3]); ink = np.array(hexc("2a1a14")[:3])
    col = np.broadcast_to(ivory, (h, w, 3)).copy()
    band = (U > 0.52) & (U < 0.72); col[band] = teal
    col[(U > 0.76) & (U < 0.80)] = ember
    barbs = 0.5 + 0.5 * np.sin(TAU * (U * 34 + V * 9))
    col *= (0.86 + 0.14 * barbs)[..., None]
    col = col + (ink - col) * np.clip((V - 0.86) / 0.14, 0, 1)[..., None] * 0.8
    col = col + (ink - col) * np.clip(1 - V / 0.08, 0, 1)[..., None] * 0.6
    return col

MATS = {}
def make_materials(circ):
    def pbr(name, c, m, r, emit=None, es=0.0, double=False):
        mat = bpy.data.materials.new("SQ_" + name); mat.use_nodes = True
        p = mat.node_tree.nodes["Principled BSDF"]
        p.inputs["Base Color"].default_value = lin(c)
        p.inputs["Metallic"].default_value = m
        p.inputs["Roughness"].default_value = r
        if emit:
            p.inputs["Emission Color"].default_value = lin(emit)
            p.inputs["Emission Strength"].default_value = es
        mat.use_backface_culling = not double
        MATS[name] = mat
        return mat
    col, nrm = leather_maps(circ)
    lea = pbr("Leather", "3d1d13", 0.0, 0.62)
    nt = lea.node_tree; p = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexImage"); tc.image = new_image("SQ_Leather_BaseColor", col); tc.location = (-600, 300)
    tn = nt.nodes.new("ShaderNodeTexImage"); tn.image = new_image("SQ_Leather_Normal", nrm, True); tn.location = (-600, -100)
    nm = nt.nodes.new("ShaderNodeNormalMap"); nm.location = (-300, -100); nm.inputs["Strength"].default_value = 1.0
    nt.links.new(tc.outputs["Color"], p.inputs["Base Color"])
    nt.links.new(tn.outputs["Color"], nm.inputs["Color"]); nt.links.new(nm.outputs["Normal"], p.inputs["Normal"])
    pbr("LeatherInner", "150907", 0.0, 0.85)
    pbr("BlackSteel", "26292d", 1.0, 0.40)
    pbr("Brass", "cf9a45", 1.0, 0.32)
    pbr("Crystal", "3fcfc2", 0.0, 0.06, emit="1aa69a", es=1.2)
    pbr("Shaft", "2c1c14", 0.0, 0.55)
    fl = pbr("Fletch", "e6d9b8", 0.0, 0.7, double=True)
    nt = fl.node_tree; t = nt.nodes.new("ShaderNodeTexImage"); t.image = new_image("SQ_Fletch_BaseColor", fletch_map())
    nt.links.new(t.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])

# ---------------------------------------------------------------- mesh building
class MB:
    def __init__(self): self.v, self.f, self.uv, self.m, self.flat = [], [], [], [], []
    def vert(self, p): self.v.append(Vector(p)); return len(self.v) - 1
    def face(self, idx, uvs, mat, flat=False):
        fi, fu = [], []
        for i, u in zip(idx, uvs):                         # drop repeated (pole) corners
            if not fi or fi[-1] != i: fi.append(i); fu.append(u)
        if len(fi) > 1 and fi[0] == fi[-1]: fi.pop(); fu.pop()
        if len(fi) >= 3:
            self.f.append(fi); self.uv.append(fu); self.m.append(mat); self.flat.append(flat)

    def to_object(self, name, parent, sharp_deg=40):
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(p) for p in self.v], [], self.f)
        names = list(dict.fromkeys(self.m))
        for n_ in names: me.materials.append(MATS[n_])
        me.polygons.foreach_set("material_index", [names.index(m) for m in self.m])
        uvl = me.uv_layers.new(name="UVMap")
        flat_uv = [c for fu in self.uv for u in fu for c in u]
        uvl.data.foreach_set("uv", flat_uv)
        me.polygons.foreach_set("use_smooth", [not f for f in self.flat])
        me.validate(); me.update()
        me.set_sharp_from_angle(angle=math.radians(sharp_deg))
        ob = bpy.data.objects.new(name, me); bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        return ob

def loft(mb, rings, mat, vs=None, closed_v=False, uscale=1.0, flat=False, flip=False):
    """Rings must be CCW about their direction of travel; normals then face outward."""
    n = max(len(r) for r in rings); R = len(rings)
    idx = [[mb.vert(r[0])] * n if len(r) == 1 else [mb.vert(p) for p in r] for r in rings]
    ufr = []
    for r in rings:
        if len(r) == 1: ufr.append([j / n * uscale for j in range(n + 1)]); continue
        d = [0.0]
        for j in range(n): d.append(d[-1] + (r[(j + 1) % n] - r[j]).length)
        ufr.append([x / d[-1] * uscale for x in d])
    if vs is None: vs = [i / (R if closed_v else R - 1) for i in range(R + 1)]
    for i in range(R if closed_v else R - 1):
        i1 = (i + 1) % R
        for j in range(n):
            q = [idx[i][j], idx[i][(j + 1) % n], idx[i1][(j + 1) % n], idx[i1][j]]
            uv = [(ufr[i][j], vs[i]), (ufr[i][j + 1], vs[i]), (ufr[i1][j + 1], vs[i + 1]), (ufr[i1][j], vs[i + 1])]
            if flip: q.reverse(); uv.reverse()
            mb.face(q, uv, mat, flat)
    return idx

def basis(nrm):
    nrm = Vector(nrm).normalized()
    ref = Vector((0, 0, 1)) if abs(nrm.z) < 0.9 else Vector((1, 0, 0))
    u = ref.cross(nrm).normalized(); v = nrm.cross(u)
    return u, v, nrm                                        # cross(u, v) == nrm

def lathe(mb, prof, origin, axis, mat, segs=16, flat=False, phase=0.0):
    """prof: (radius, height) from base upward; solid kept to the left of travel."""
    U, V, Nn = basis(axis); o = Vector(origin)
    rings = []
    for r, h in prof:
        c = o + Nn * h
        if r < 1e-7: rings.append([c]); continue
        rings.append([c + r * (math.cos(phase + TAU * k / segs) * U + math.sin(phase + TAU * k / segs) * V) for k in range(segs)])
    loft(mb, rings, mat, flat=flat)

def prism(mb, outline, origin, U, V, thick, mat, flat=True):
    U, V = Vector(U).normalized(), Vector(V).normalized(); Nn = U.cross(V)
    o = Vector(origin)
    back = [o + x * U + y * V - Nn * thick / 2 for x, y in outline]
    front = [p + Nn * thick for p in back]
    loft(mb, [back, front], mat, flat=flat)
    mn = min(x for x, _ in outline); ext = max(max(x for x, _ in outline) - mn, 1e-6)
    uvs = [((x - mn) / ext, 0.5 + y / ext) for x, y in outline]
    fi = [mb.vert(p) for p in front]; mb.face(fi, uvs, mat, flat)
    bi = [mb.vert(p) for p in back]; mb.face(bi[::-1], uvs[::-1], mat, flat)

def feather_outline(L, W, serr=True, n=9):
    lo, hi = [], []
    for i in range(n + 1):
        s = i / n
        w = W * (0.28 + 0.72 * math.sin(math.pi * min(1.0, s * 1.15)) ** 0.7) * (1 - 0.55 * s ** 2)
        lo.append((s * L, -0.5 * w))
        wh = w * (0.78 if serr and i % 2 and s > 0.35 else 1.0)
        hi.append((s * L, 0.5 * wh))
    return lo + [(L * 1.06, 0.0)] + hi[::-1][:-1] + [(0.0, 0.0)]

def rivet(mb, p, nrm, r=0.0042, mat="Brass"):
    lathe(mb, [(r, -0.0008), (r, 0.0006), (r * 0.78, 0.0020), (r * 0.40, 0.0029), (0, 0.0031)], p, nrm, mat, segs=10)

def gem(mb, p, nrm, r=0.006, h=0.006, bezel=True, segs=6):
    if bezel:
        lathe(mb, [(r * 1.45, -0.0008), (r * 1.45, 0.0012), (r * 1.2, 0.0024), (r * 1.02, 0.0020)], p, nrm, "Brass", segs=segs * 2)
    lathe(mb, [(r, 0.0), (r, 0.0018), (r * 0.62, h * 0.72), (0, h)], p, nrm, "Crystal", segs=segs, flat=True, phase=math.pi / segs)

# ---------------------------------------------------------------- parts
def build_body(root):
    mb = MB()
    zs = [Z0 + (Z1 - Z0) * i / 20 for i in range(21)]
    loft(mb, [se_ring(*body_ab(z), z) for z in zs], "Leather", vs=[(z - Z0) / (Z1 - Z0) for z in zs] + [1])
    # rim + inner wall down to a floor (visible dark interior)
    zin = [Z1] + [Z1 - (Z1 + 0.205) * i / 8 for i in range(9)]
    offs = [0.0] + [-0.004] * 9
    inner = [se_ring(*(x + o for x in body_ab(z)), z) for z, o in zip(zin, offs)]
    loft(mb, inner + [[Vector((0, CY, -0.205))]], "LeatherInner")
    # blackened steel bands with rivets and a crystal on the lower band
    for zc in BANDS:
        pr = [(0.0, zc - 0.0072), (0.0026, zc - 0.0066), (0.0032, zc - 0.0050), (0.0032, zc + 0.0050), (0.0026, zc + 0.0066), (0.0, zc + 0.0072)]
        loft(mb, [se_ring(*(x + o for x in body_ab(z)), z) for o, z in pr], "BlackSteel")
        for k in (0.36, 0.60, 0.80, 1.20, 1.40, 1.64):
            p, nn = surf(k * math.pi, zc, 0.0030); rivet(mb, p, nn, 0.0034)
        p, nn = surf(math.pi, zc, 0.0030)
        if zc == BANDS[1]: gem(mb, p, nn, 0.0048, 0.0052)
        else: rivet(mb, p, nn, 0.0046)
    # steel base cup with rounded bottom
    A, B = body_ab(Z0)
    rings = [[Vector((0, CY, -0.2668))]]
    for i in range(6, -1, -1):
        ph = math.pi / 2 * i / 6
        s = 0.42 + 0.58 * math.cos(ph)
        rings.append(se_ring((A + 0.004) * s, (B + 0.004) * s, -0.247 - 0.019 * math.sin(ph)))
    rings += [se_ring(A + 0.0045, B + 0.0045, -0.2225), se_ring(A + 0.001, B + 0.001, -0.2215)]
    loft(mb, rings, "BlackSteel")
    for k in range(8):
        th = (k + 0.5) / 8 * TAU
        p, nn = surf(th, -0.2330, 0.0045); p.z = -0.2330
        rivet(mb, p, nn, 0.0030)
    # brass finial with a crystal drop
    fo = Vector((0, CY, -0.2600)); down = Vector((0, 0, -1))
    lathe(mb, [(0.012, 0.0), (0.0135, 0.004), (0.0105, 0.0078), (0.0072, 0.0098), (0.0088, 0.0125), (0.0064, 0.0158)], fo, down, "Brass", segs=16)
    lathe(mb, [(0.0060, 0.0152), (0.0058, 0.0168), (0.0, 0.0222)], fo, down, "Crystal", segs=6, flat=True)
    # front crest: brass medallion with crystal heart, raised wings and a tail fan
    mz = -0.024; mp, mn = surf(math.pi, mz, 0.0)
    lathe(mb, [(0.0205, -0.0015), (0.0212, 0.0022), (0.0196, 0.0042), (0.0168, 0.0048), (0.0152, 0.0034),
               (0.0098, 0.0034), (0.0090, 0.0048), (0.0, 0.0048)], mp, mn, "Brass", segs=24)
    lathe(mb, [(0.0138, 0.0030), (0.0142, 0.0040), (0.0104, 0.0040), (0.0100, 0.0030)], mp, mn, "BlackSteel", segs=24)
    gem(mb, mp + mn * 0.0046, mn, 0.0078, 0.0068, bezel=False, segs=8)
    for sx in (-1, 1):
        for ang, L in ((20, 0.038), (38, 0.034), (56, 0.028)):
            a = math.radians(ang)
            d = Vector((sx * math.cos(a), 0, math.sin(a)))
            fr = mp + Vector((sx * 0.016 * math.cos(a), 0, 0.016 * math.sin(a)))
            mid = fr + d * L * 0.5
            th = math.pi - math.asin(max(-0.99, min(0.99, mid.x / body_ab(mid.z)[0])))
            sp, sn = surf(th, mid.z, 0.0018)
            base = sp - d * L * 0.5
            prism(mb, feather_outline(L, 0.0105), base, d, sn.cross(d), 0.0022, "Brass")
    for ang in (-20, 0, 20):
        a = math.radians(ang)
        d = Vector((math.sin(a), 0, -math.cos(a)))
        fr = mp + d * 0.017
        sp, sn = surf(math.pi, fr.z, 0.0014)
        prism(mb, feather_outline(0.022, 0.008), Vector((fr.x, sp.y, fr.z)), d, sn.cross(d), 0.0020, "Brass")
    return mb.to_object("QuiverBody", root)

def build_mouth(root):
    mb = MB()
    Ab, Bb = body_ab(Z1)
    prof = [(0.0015, 0.026), (0.0045, 0.030), (0.0060, 0.058), (0.0085, 0.066), (-0.001, 0.066), (-0.004, 0.030), (-0.004, 0.026)]
    loft(mb, [se_ring(Ab + o, Bb + o, z) for o, z in prof], "BlackSteel", closed_v=True)
    # rolled brass lip: a superelliptic torus around the opening
    r, c0, zc = 0.0062, 0.0036, 0.0716
    rings = [se_ring(Ab + c0 + r * math.cos(TAU * k / 12 - math.pi / 2), Bb + c0 + r * math.cos(TAU * k / 12 - math.pi / 2),
                     zc + r * math.sin(TAU * k / 12 - math.pi / 2), 64) for k in range(12)]
    loft(mb, rings, "Brass", closed_v=True)
    # collar studs and crystals
    for k in (0.12, 0.30, 0.70, 0.88, 1.12, 1.30, 1.70, 1.88):
        p, nn = surf(k * math.pi, 0.044, 0.0052); p.z = 0.044; rivet(mb, p, nn, 0.0030)
    for k, r_ in ((1.0, 0.0062), (0.82, 0.0040), (1.18, 0.0040)):
        p, nn = surf(k * math.pi, 0.045, 0.0052); p.z = 0.045; gem(mb, p, nn, r_, r_ * 1.0)
    # swept-back siegebird wings on both sides of the collar
    for sx in (-1, 1):
        nrm = Vector((sx, 0, 0))
        rootp = Vector((sx * (Ab + 0.0098), CY - 0.004, 0.036))
        lathe(mb, [(0.0068, -0.004), (0.0068, 0.0015), (0.0050, 0.0035), (0.0, 0.0042)], rootp, nrm, "Brass", segs=12)
        lathe(mb, [(0.0028, 0.0038), (0.0, 0.0072)], rootp, nrm, "Crystal", segs=6, flat=True)
        for ang, L, w, cant in ((40, 0.054, 0.0135, 8), (60, 0.064, 0.0145, 16), (80, 0.056, 0.0130, 24)):
            a, c = math.radians(ang), math.radians(cant)
            d = Vector((0, -math.cos(a), math.sin(a)))
            Vv = nrm.cross(d) * math.cos(c) + nrm * math.sin(c)        # splay the trailing edge outward
            prism(mb, feather_outline(L, w), rootp + nrm * (0.0012 + 0.0008 * (ang - 40) / 40), d, Vv, 0.0024, "Brass")
    return mb.to_object("QuiverMouth", root)

def sweep(mb, path, profile, mat, up=Vector((1, 0, 0)), vscale=1.0, u0=0.0, uscale=1.0):
    T = [(path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]).normalized() for i in range(len(path))]
    rings, vs, acc = [], [], 0.0
    Nn = (up - up.project(T[0])).normalized()
    for i, (p, t) in enumerate(zip(path, T)):
        if i: Nn = (Nn - Nn.project(t)).normalized(); acc += (p - path[i - 1]).length
        Bn = t.cross(Nn)
        rings.append([p + x * Nn + y * Bn for x, y in profile]); vs.append(acc * vscale)
    vs.append(vs[-1])
    idx = loft(mb, rings, mat, vs=vs, uscale=uscale)
    return rings

def build_belt_loop(root):
    mb = MB()
    zt = 0.012
    back = []
    for i in range(10):
        z = -0.078 + (zt + 0.078) * i / 9
        back.append(Vector((0, CY - body_ab(z)[1] - 0.0024, z)))
    R = back[-1].y
    arc = [Vector((0, R * math.cos(math.pi * k / 10), zt + R * math.sin(math.pi * k / 10))) for k in range(1, 11)]
    front = [Vector((0, -R, zt - 0.046 * k / 5)) for k in range(1, 6)]
    path = back + arc + front
    hw, ht = 0.021, 0.0019
    prof = [(hw, -ht), (hw + 0.0012, 0), (hw, ht), (0, ht), (-hw, ht), (-hw - 0.0012, 0), (-hw, -ht), (0, -ht)]
    sweep(mb, path, prof, "Leather", up=Vector((1, 0, 0)), vscale=1 / (Z1 - Z0), uscale=0.09)
    # brass snap on the flap, rivets where the strap meets the body
    snap = Vector((0, -R - ht, zt - 0.036))
    lathe(mb, [(0.0085, -0.0006), (0.0088, 0.0012), (0.0072, 0.0030), (0.0040, 0.0040), (0.0, 0.0043)], snap, (0, -1, 0), "Brass", segs=16)
    gem(mb, snap + Vector((0, -0.0040, 0)), Vector((0, -1, 0)), 0.0026, 0.0024, bezel=False)
    for x in (-0.012, 0.012):
        z = -0.070; y = CY - body_ab(z)[1] - 0.0045
        rivet(mb, Vector((x, y, z)), Vector((0, -1, 0)), 0.0036)
    # steel keeper bar across the strap below the arc
    ky = CY - body_ab(-0.010)[1] - 0.0045
    lathe(mb, [(0.0024, -0.026), (0.0030, -0.024), (0.0030, 0.024), (0.0024, 0.026), (0.0, 0.026)], (0, ky, -0.010), (1, 0, 0), "BlackSteel", segs=8)
    return mb.to_object("BeltLoop", root)

def build_bolts(root):
    mb = MB()
    bolts = [((-0.036, CY - 0.024), (-0.16, -0.02), 0.138, 0.0),
             ((0.001, CY - 0.030), (0.02, -0.03), 0.150, 0.7),
             ((0.037, CY - 0.021), (0.17, -0.01), 0.132, 1.9)]
    for (x, y), (tx, ty), top, spin in bolts:
        d = Vector((tx, ty, 1)).normalized()
        base = Vector((x, y, -0.15)); L = (top - base.z) / d.z
        rs = 0.0040
        lathe(mb, [(rs, 0.0), (rs, L - 0.009), (0.0, L - 0.009)], base, d, "Shaft", segs=6, phase=spin)
        nock = base + d * (L - 0.010)
        lathe(mb, [(0.0046, 0.0), (0.0048, 0.0065), (0.0036, 0.0098), (0.0014, 0.0112), (0.0, 0.0112)], nock, d, "Brass", segs=10)
        U, V, _ = basis(d)
        v0 = L - 0.058; vl = 0.044; h = 0.0125
        for k in range(3):
            a = spin + TAU * k / 3
            radial = math.cos(a) * U + math.sin(a) * V
            outline = [(0.0, rs), (vl * 0.10, rs + h * 0.18), (vl * 0.62, rs + h * 0.92), (vl, rs + h), (vl * 1.02, rs + h * 0.35), (vl * 0.96, rs)]
            ids = [mb.vert(base + d * (v0 + s) + radial * r) for s, r in outline]
            uvs = [(s / vl, (r - rs) / h) for s, r in outline]
            mb.face(ids, uvs, "Fletch", flat=True)
    return mb.to_object("BoltFletching", root, sharp_deg=30)

# ---------------------------------------------------------------- scene, export, verify
def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT, exist_ok=True)
    mid = se_ring(*body_ab(-0.1), -0.1)
    circ = sum((mid[(j + 1) % N] - mid[j]).length for j in range(N))
    make_materials(circ)
    root = bpy.data.objects.new("SiegebirdQuiver", None)
    bpy.context.scene.collection.objects.link(root)
    root.empty_display_size = 0.05
    parts = [build_body(root), build_mouth(root), build_belt_loop(root), build_bolts(root)]
    bpy.context.view_layer.update()
    blend = os.path.join(OUT, "quiver.blend"); glb = os.path.join(OUT, "quiver.glb")
    bpy.ops.wm.save_as_mainfile(filepath=blend, compress=True)
    bpy.ops.export_scene.gltf(filepath=glb, export_format="GLB", export_yup=True, export_apply=True,
                              export_materials="EXPORT", export_image_format="AUTO", export_extras=False)
    built = {o.name: {"tris": tri_count(o), "materials": [m.name for m in o.data.materials]} for o in parts}

    # ---- re-import the GLB into an empty scene and check it
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    obs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    lo = Vector((1e9,) * 3); hi = -lo
    for o in obs:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c); lo = Vector(map(min, lo, w)); hi = Vector(map(max, hi, w))
    mats = sorted({m.name for o in obs for m in o.data.materials if m})
    imgs = [{"name": i.name, "size": list(i.size), "packed": bool(i.packed_file),
             "mean_rgb": [round(float(x), 3) for x in np.array(i.pixels[:]).reshape(-1, 4)[:, :3].mean(0)]}
            for i in bpy.data.images if i.size[0]]
    assert all(max(i["mean_rgb"]) > 0.02 for i in imgs), "a re-imported texture is black"
    textured = sorted({m.name for m in bpy.data.materials if m.use_nodes and any(n.type == "TEX_IMAGE" and n.image for n in m.node_tree.nodes)})
    # Godot frame: x, y(up)=blender z, z = -blender y
    report = {
        "glb_bytes": os.path.getsize(glb),
        "built": built,
        "reimport_meshes": {o.name: tri_count(o) for o in obs},
        "total_tris": sum(tri_count(o) for o in obs),
        "materials": mats, "textured_materials": textured, "images": imgs,
        "bounds_godot": {"x": [round(lo.x, 4), round(hi.x, 4)], "y": [round(lo.z, 4), round(hi.z, 4)], "z": [round(-hi.y, 4), round(-lo.y, 4)]},
        "size_godot": [round(hi.x - lo.x, 4), round(hi.z - lo.z, 4), round(hi.y - lo.y, 4)],
    }
    need = {"QuiverBody", "QuiverMouth", "BeltLoop", "BoltFletching"}
    report["named_nodes_ok"] = need <= {o.name for o in bpy.context.scene.objects}
    with open(os.path.join(OUT, "verify.json"), "w") as f: json.dump(report, f, indent=2)
    print(json.dumps(report, indent=2))
    assert report["named_nodes_ok"] and len(mats) >= 5 and len(textured) >= 2, "re-import check failed"

main()
