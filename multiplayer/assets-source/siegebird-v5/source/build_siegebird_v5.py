"""Siegebird V - "Wren's Calling" showpiece pass. Reproducible Blender (bpy 4.5 / 5.0) builder.

Run:  <python with bpy> build_siegebird_v5.py [--no-check] [--out path.glb]
Default output: multiplayer/public/assets/crossbow.glb

Story: Hollis Wren kept the songbird aviary at Dawnhold and built clocks for the keep. Her last commission
was a siege crossbow the keep's birds would serve. Two Calling Stones sit in gilt bezels on its shoulders.
A sounding wire runs from the winch's pawl bracket up the right flank to the stones, so every ratchet
click rings them; the birds were raised to answer that note and bring the next bolt. Each bolt is
fletched with a moulted feather of the bird that carries it. Her maker's plate is on the left flank.

What this pass changes over Siegebird IV (build_siegebird_v4.py is imported and reused unchanged):
- Calling Stones: faceted resonance crystals (a glowing inner core inside a clear faceted shell) in
  gilt bezels with six claw prongs and swept gilt wing guards, set into each shoulder strake.
- Sounding wire: a brass wire on standoffs from the winch frame to the right-hand stone.
- Maker's plate: an engraved, riveted brass plate on the left flank of the stock.
- Gilt feather quills (the wings' ivory quills become polished gilt; they now catch glints) and a
  richer feather atlas: gilt rachis line, enamel sheen bands and a pale iridescent edge.
- Bolt fletches get their own material (SB_Fletch, near-white) so the runtime tints them with the
  plumage of the bird that brought the bolt.
The contract (rail, sled travel, winch, limb path, bolt, BoltSeat/GripAnchor) and every moving part are
unchanged, so the runtime mechanism, flock and sight keep working.

Frame: native item space (X right, Y forward, Z up), metres.
"""
import bpy, bmesh, math, json, os, sys, time
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.normpath(os.path.join(HERE, '..', '..', '..', '..'))
sys.path.insert(0, os.path.join(HERE, '..', '..', 'siegebird-v4', 'source'))
import build_siegebird_v4 as V  # noqa: E402
B = V.B
from build_siegebird_opus import MB, lathe, prism, tube, catmull, lerp, TAU, G2B  # noqa: E402

T0 = time.time()

# ---------------------------------------------------------------- materials
V.MAT_DEF.update({
    "Gilt":       dict(c="f2c060", m=1.0, r=0.16),
    "Fletch":     dict(c="ffffff", m=0.0, r=0.52),
    "CallingStone": dict(c="bfe6ff", m=0.0, r=0.04, e="58b8ff", es=2.2),
    "StoneGlass": dict(c="d8f0ff", m=0.0, r=0.02),
    "MakerPlate": dict(c="ffffff", m=1.0, r=0.32),
})

def B2G(v): return Vector((v[0], v[2], -v[1]))

def feather_image_v5(size=512):
    """Siegebird IV atlas, refined: the rachis line is gilt, the vane carries a soft enamel sheen band and
    a pale iridescent fringe so the wings read as lacquered enamel rather than flat paint."""
    import numpy as np
    img = V.feather_image_v4(size)
    px = np.empty(size * size * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(size, size, 4)
    u = np.linspace(0, 1, size)[None, :]; v = np.linspace(0, 1, size)[:, None]
    band = (v * 5) % 1.0; across = band * 2 - 1; a = np.abs(across)
    col = px[..., :3]
    lum = col.mean(-1, keepdims=True); col = np.clip(lum + (col - lum) * 1.35, 0, 1) ** 1.18   # deeper, richer enamel
    rach = np.exp(-(across / 0.05) ** 2)[..., None] * (u < 0.93)[..., None]
    gilt = np.array([0.95, 0.74, 0.34])
    col = col * (1 - 0.85 * rach) + gilt * 0.85 * rach
    sheen = (np.exp(-((a - 0.45) / 0.18) ** 2) * np.clip((u - 0.25) / 0.3, 0, 1) * (1 - np.clip((u - 0.86) / 0.1, 0, 1)))[..., None]
    col = col * (1 + 0.22 * sheen)
    fringe = (np.clip((a - 0.82) / 0.16, 0, 1) * (u > 0.2))[..., None]
    hue = 0.5 + 0.5 * np.sin(TAU * (u * 2.0 + across * 0.6))[..., None]
    irid = np.array([0.55, 0.95, 0.9]) * (1 - hue) + np.array([0.75, 0.6, 1.0]) * hue
    col = col * (1 - 0.35 * fringe) + irid * 0.35 * fringe
    px[..., :3] = np.clip(col, 0, 1); img.pixels.foreach_set(px.ravel()); img.pack()
    return img

def fletch_image(size=256):
    """Neutral fletching feather: soft white vane with darker barring and a pale quill. The runtime multiplies
    it by the plumage colour of the bird that brought the bolt."""
    import numpy as np
    u = np.linspace(0, 1, size)[None, :]; v = np.linspace(0, 1, size)[:, None]
    band = (v * 5) % 1.0; across = band * 2 - 1; a = np.abs(across)
    val = 0.86 - 0.18 * np.clip((u - 0.6) / 0.4, 0, 1)
    bars = (0.5 + 0.5 * np.cos(TAU * (u * 6.0 + 0.35 * a))) ** 12 * (u > 0.2)
    val = val * (1 - 0.30 * bars) * (1 - 0.25 * np.clip((a - 0.8) / 0.2, 0, 1))
    barb = (0.5 + 0.5 * np.sin(TAU * (u * 80 - a * 24))) ** 2; val *= (1 - 0.08 * barb)
    rach = np.exp(-(across / 0.05) ** 2); val = val * (1 - rach) + 0.98 * rach
    col = np.stack([val, val * 0.99, val * 0.97], -1)
    img = bpy.data.images.new("SB_FletchAtlas", size, size, alpha=False)
    px = np.ones((size, size, 4), dtype=np.float32); px[..., :3] = np.clip(col, 0, 1)
    img.pixels.foreach_set(px.ravel()); img.pack(); img.colorspace_settings.name = 'sRGB'
    return img

PLATE_W, PLATE_H = 0.074, 0.026

def plate_image(w=768, h=270):
    """Engraved brass maker's plate: a beaded border, a wren in flight, and Hollis Wren's mark."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont, ImageFilter
    def font(size, bold=False):
        for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
                  "C:/Windows/Fonts/georgiab.ttf" if bold else "C:/Windows/Fonts/georgia.ttf"):
            if os.path.exists(p): return ImageFont.truetype(p, size)
        return ImageFont.load_default()
    ink = Image.new("L", (w, h), 0); d = ImageDraw.Draw(ink)
    d.rounded_rectangle((10, 10, w - 10, h - 10), radius=h // 2 - 10, outline=255, width=5)
    d.rounded_rectangle((26, 26, w - 26, h - 26), radius=h // 2 - 26, outline=255, width=2)
    for k in range(46):                                                  # beads between the two borders
        t = k / 46; x = 18 + (w - 36) * t
        if 70 < x < w - 70:
            for y in (18, h - 18): d.ellipse((x - 3, y - 3, x + 3, y + 3), fill=255)
    # a wren in flight, left medallion
    cx, cy = 120, h // 2
    body = [(cx - 52, cy + 8), (cx - 20, cy - 10), (cx + 18, cy - 14), (cx + 40, cy - 22), (cx + 52, cy - 18), (cx + 44, cy - 10),
            (cx + 20, cy + 6), (cx - 10, cy + 18), (cx - 40, cy + 18)]
    d.line(body + [body[0]], fill=255, width=4)
    d.polygon([(cx - 6, cy - 8), (cx - 30, cy - 62), (cx + 6, cy - 46), (cx + 14, cy - 12)], outline=255, width=4)   # raised wing
    d.line([(cx - 52, cy + 8), (cx - 80, cy - 6)], fill=255, width=5); d.line([(cx - 50, cy + 14), (cx - 76, cy + 6)], fill=255, width=3)  # cocked tail
    d.ellipse((cx + 36, cy - 22, cx + 42, cy - 16), fill=255)
    d.line([(cx + 52, cy - 18), (cx + 66, cy - 16)], fill=255, width=3)
    d.ellipse((cx - 92, cy - 92, cx + 92, cy + 92), outline=255, width=3)
    f1, f2 = font(56, True), font(25)
    d.text((232, cy - 62), "HOLLIS WREN", font=f1, fill=255)
    d.text((238, cy + 16), "DAWNHOLD AVIARY \u00b7 SIEGEBIRD", font=f2, fill=255)
    for x in (36, w - 36):                                              # rivet holes
        d.ellipse((x - 9, cy - 9, x + 9, cy + 9), outline=255, width=3)
    ink = np.asarray(ink.filter(ImageFilter.GaussianBlur(1.1)), dtype=np.float32) / 255
    rng = np.random.default_rng(3)
    brush = np.repeat(rng.random((h, 1)), w, 1) * 0.5 + rng.random((h, w)) * 0.5
    base = np.array([0.80, 0.62, 0.30]) * (0.92 + 0.10 * brush[..., None])
    dark = np.array([0.20, 0.12, 0.05])
    yy, xx = np.mgrid[0:h, 0:w]
    edge = np.clip(1 - np.minimum(np.minimum(xx, w - xx), np.minimum(yy, h - yy)) / 30, 0, 1)[..., None]  # patina at the rim
    col = base * (1 - 0.35 * edge) + dark * 0.35 * edge
    col = col * (1 - 0.82 * ink[..., None]) + dark * 0.82 * ink[..., None]
    img = bpy.data.images.new("SB_MakerPlate", w, h, alpha=False)
    px = np.ones((h, w, 4), dtype=np.float32); px[..., :3] = np.clip(col[::-1], 0, 1)
    img.pixels.foreach_set(px.ravel()); img.pack(); img.colorspace_settings.name = 'sRGB'
    return img

V.feather_image_v4 = V.feather_image
_make_v4 = V.make_materials
def make_materials():
    V.feather_image = feather_image_v5
    _make_v4()
    V.feather_image = V.feather_image_v4
    B.textured(B.MATS["Fletch"], fletch_image())
    B.textured(B.MATS["MakerPlate"], plate_image())
    for nm, alpha in (("StoneGlass", 0.38),):
        m = B.MATS[nm]; p = m.node_tree.nodes["Principled BSDF"]
        p.inputs["Alpha"].default_value = alpha
        try: m.surface_render_method = 'BLENDED'
        except Exception: m.blend_method = 'BLEND'
    p = B.MATS["Gilt"].node_tree.nodes["Principled BSDF"]
    p.inputs["Coat Weight"].default_value = 0.4; p.inputs["Coat Roughness"].default_value = 0.05
B.make_materials = make_materials

# ---------------------------------------------------------------- surface probe
class Probe:
    """Raycasts the built Body in native space so ornaments sit exactly on its faceted surface."""
    def __init__(self, mb):
        verts = [G2B(p) for p in mb.v]
        self.t = BVHTree.FromPolygons(verts, [list(f) for f in mb.f])
    def hit(self, origin, direction):
        loc, nrm, _, _ = self.t.ray_cast(G2B(origin), G2B(Vector(direction).normalized()))
        if loc is None: raise RuntimeError("probe missed from %s" % (tuple(origin),))
        n = B2G(nrm).normalized()
        if n.dot(Vector(direction)) > 0: n = -n
        return B2G(loc), n

def basis(n, fwd=Vector((0, 1, 0))):
    n = Vector(n).normalized(); u = (fwd - n * fwd.dot(n)).normalized(); v = n.cross(u)
    return n, u, v

# ---------------------------------------------------------------- Calling Stones
STONE_R = 0.0158
STONE_LIFT = 0.011
STONES = []   # (centre, normal) in native space, exported as empties for the runtime

def gem(mb, c, A, U, Vv, r, mat, crown=0.55, table=0.5, pav=0.62, segs=8, phase=0.0):
    """Brilliant-ish cut: pavilion point, girdle, crown facets, table. Flat shaded."""
    lathe(mb, [(-r * pav, 0.0), (-r * 0.06, r * 0.96), (0.0, r), (r * 0.06, r * 0.96), (r * crown * 0.55, r * 0.78),
               (r * crown, r * table), (r * crown, 0.0)], tuple(c), (tuple(A), tuple(U), tuple(Vv)), mat, segs, flat=True, phase=phase)

def calling_stone(mb, probe, sx, at=None, R=None, lift=None, guards=True):
    """sx: -1 left shoulder, +1 right shoulder, 0 the heart stone (explicit at=(point, normal))."""
    R = STONE_R if R is None else R; lift = STONE_LIFT if lift is None else lift
    if at is None:
        p, n = probe.hit(Vector((sx * 0.060, 0.842, 0.30)), (0, 0, -1))
    else:
        p, n = Vector(at[0]), Vector(at[1]).normalized()
    A, U, Vv = basis(n, Vector((0, 0, 1)) if abs(n.z) < 0.5 else Vector((0, 1, 0)))
    # turned gilt pedestal pinned into the strake lifts the stone clear of the string and the rail cap
    if lift > 0:
        lathe(mb, [(-0.002, 0.0), (-0.002, 0.0105), (0.0015, 0.0100), (0.0045, 0.0062), (lift - 0.003, 0.0058), (lift, 0.0080), (lift + 0.0012, 0.0)],
              tuple(p), (tuple(A), tuple(U), tuple(Vv)), "Gilt", 20)
    seat = p + A * (lift + 0.0012)
    # gilt bezel cup, sunk a little into the strake
    lathe(mb, [(-0.0030, 0.0), (-0.0030, R + 0.0042), (0.0010, R + 0.0047), (0.0032, R + 0.0030),
               (0.0036, R + 0.0012), (0.0022, R + 0.0004), (0.0022, 0.0)], tuple(seat), (tuple(A), tuple(U), tuple(Vv)), "Gilt", 24)
    centre = seat + A * (0.0022 + R * 0.58)
    gem(mb, centre, A, U, Vv, R, "StoneGlass", phase=math.pi / 8)                        # clear faceted shell
    gem(mb, centre - A * 0.0006, A, U, Vv, R * 0.62, "CallingStone", crown=0.62, table=0.42, segs=8)  # glowing heart
    # six claw prongs gripping the crown
    for k in range(6):
        a = TAU * k / 6 + math.pi / 6; d = U * math.cos(a) + Vv * math.sin(a)
        pts = [seat + A * 0.0010 + d * (R + 0.0034), seat + A * (0.0040 + R * 0.35) + d * (R + 0.0024),
               centre + A * (R * 0.42) + d * (R * 0.80)]
        tube(mb, catmull(pts, 3), 0.0011, "Gilt", 6, rfun=lambda t: 0.0013 * (1 - 0.55 * t))
    # swept gilt wing guards either side of the bezel, like the stone is the bird's heart
    for side in ((-1, 1) if guards else ()):
        root = seat + U * (side * (R + 0.0030)) + A * 0.0006
        for j, (L, ang, w) in enumerate(((0.030, 0.30, 0.0050), (0.024, 0.55, 0.0042), (0.017, 0.82, 0.0034))):
            dirv = (U * side * math.cos(ang) - Vv * math.sin(ang) * sx).normalized()
            Vn = A.cross(dirv).normalized()
            outline = [(0.0, -w * 0.6), (L * 0.6, -w), (L, -w * 0.2), (L * 1.02, 0.0), (L * 0.7, w * 0.5), (0.0, w * 0.6)]
            prism(mb, outline, tuple(root + A * (0.0006 * j)), tuple(dirv), tuple(Vn), tuple(A), 0.0, 0.0011, "Gilt", 0.0003, 1)
    STONES.append((centre.copy(), A.copy(), sx))
    return seat, A

def sounding_wire(mb, probe, stone_seat, stone_n):
    """Brass sounding wire from the winch's rear bearing bar up the right flank to the stone bezel, on two
    turned standoffs pinned into the hull."""
    start = Vector((0.205, 0.745, -0.040))
    a, na = probe.hit(Vector((0.30, 0.790, 0.010)), (-1, 0, 0))
    b, nb = probe.hit(Vector((0.30, 0.830, 0.065)), (-1, 0, 0))
    lift = 0.009
    pa, pb = a + na * lift, b + nb * lift
    end = stone_seat + Vector((1, 0, 0)) * (STONE_R + 0.0040) + stone_n * 0.0006
    path = catmull([start, Vector((0.150, 0.768, -0.012)), pa, pb, end + Vector((0.006, -0.004, -0.004)), end], 6)
    tube(mb, path, 0.0012, "Brass", 6)
    for p_, n_ in ((a, na), (b, nb)):
        lathe(mb, [(0.0, 0.0), (0.0, 0.0030), (lift * 0.7, 0.0022), (lift, 0.0026), (lift + 0.0020, 0.0018), (lift + 0.0024, 0.0)],
              tuple(p_), basis(n_)[:3], "Gilt", 10)
    lathe(mb, [(0.0, 0.0), (0.0, 0.0034), (0.006, 0.0030), (0.008, 0.0)], tuple(start), 'x', "Gilt", 10)   # clamp on the bearing bar

# ---------------------------------------------------------------- maker's plate
PLATE = {}

def maker_plate(mb, probe):
    p, n = probe.hit(Vector((-0.30, 0.200, 0.072)), (1, 0, 0))
    A, U, Vv = basis(n)                      # U along the stock (forward), Vv up the flank
    if Vv.z < 0: Vv = -Vv
    c = p + A * 0.0004
    pts = []
    for k in range(28):
        t = TAU * k / 28; x, y = math.cos(t), math.sin(t)
        e = 4.0; xx = math.copysign(abs(x) ** (2 / e), x); yy = math.copysign(abs(y) ** (2 / e), y)
        pts.append((xx * PLATE_W / 2, yy * PLATE_H / 2))
    f0 = len(mb.f)
    prism(mb, pts, tuple(c), tuple(U), tuple(Vv), tuple(A), 0.0, 0.0010, "MakerPlate", 0.0003, 1)
    PLATE.update(dict(c=c, U=U, V=Vv, f0=f0, f1=len(mb.f)))
    for sxp in (-1, 1):
        V.rivet(mb, c + U * (sxp * (PLATE_W / 2 - 0.0034)) + A * 0.0010, A, 0.0016, "Gilt")

def plate_uvs(ob, mb):
    uv = ob.data.uv_layers.active.data; c, U, Vv = PLATE["c"], PLATE["U"], PLATE["V"]
    for fi in range(PLATE["f0"], PLATE["f1"]):
        if mb.m[fi] != "MakerPlate": continue
        for vi, li in zip(mb.f[fi], ob.data.polygons[fi].loop_indices):
            q = mb.v[vi] - c
            uv[li].uv = (0.5 - q.dot(U) / PLATE_W, 0.5 + q.dot(Vv) / PLATE_H)   # read left to right from the left flank

# ---------------------------------------------------------------- bolt and wings
_build_bolt_v4 = V.build_bolt
def build_bolt():
    """Siegebird IV bolt with its fletches in SB_Fletch (tinted at runtime by the carrying bird's plumage)."""
    fe = V.feather
    V.feather = lambda *a, **k: fe(*a, **{**k, "mat": "Fletch"})
    try: _build_bolt_v4()
    finally: V.feather = fe
V.build_bolt = build_bolt

_build_wings_v4 = V.build_wings
def build_wings():
    """Siegebird IV wings; the quills on every feather become polished gilt."""
    tb = V.tube
    def gilt_tube(mb, pts, r, mat, *a, **k): return tb(mb, pts, r, "Gilt" if mat == "Ivory" else mat, *a, **k)
    V.tube = gilt_tube
    try: return _build_wings_v4()
    finally: V.tube = tb
V.build_wings = build_wings

def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:]
    out = argv[argv.index("--out") + 1] if "--out" in argv else os.path.join(REPO, 'multiplayer', 'public', 'assets', 'crossbow.glb')
    B.setup_scene()
    body = V.build_body(); body.extend(V.build_sight())
    probe = Probe(body)
    seats = {}
    for sx in (-1, 1): seats[sx] = calling_stone(body, probe, sx)
    # the heart stone: set into the rear face of the rail cap, under the peep, facing the shooter
    calling_stone(body, probe, 0, at=(Vector((0.0, 0.4138, 0.133)), Vector((0, -1, 0.12))), R=0.0150, lift=0.0, guards=False)
    sounding_wire(body, probe, *seats[1])
    maker_plate(body, probe)
    B.OBJ["Body"] = body.to_object("Body", (0, 0, 0)); V.assign_grain_uvs(B.OBJ["Body"], body); plate_uvs(B.OBJ["Body"], body)
    B.OBJ["Wings"] = V.build_wings()
    V.build_moving()
    e = bpy.data.objects.new("SightArt", None); e.empty_display_size = 0.02; e.location = G2B((0.0, 0.900, 0.239)); B.ASSET.objects.link(e); B.OBJ["SightArt"] = e
    for k, (c, n, sx) in enumerate(STONES):               # runtime anchors for the stone light and glints
        e = bpy.data.objects.new("CallingStone_%s" % {-1: "L", 1: "R", 0: "Heart"}[sx], None); e.empty_display_size = 0.01
        e.location = G2B(c); B.ASSET.objects.link(e); B.OBJ[e.name] = e
    rep = {"build_seconds": round(time.time() - T0, 2), "stones": [[round(x, 4) for x in c] for c, _, _ in STONES]}
    if "--no-check" not in argv:
        B.clearance_sweep.__globals__["OBJ"] = B.OBJ
        rep["clearance"] = V.clearance_sweep()
        print("CLEARANCE unexpected=%d allowed=%d states=%d" % (len(rep["clearance"]["unexpected"]), rep["clearance"]["allowed_contacts"], rep["clearance"]["states"]))
        seen = set()
        for u in rep["clearance"]["unexpected"]:
            key = (u["a"], u["b"])
            if key in seen: continue
            seen.add(key); print("  HIT", u["a"], u["b"], "n=%d" % u["n"], "draw=%.3f rel=%s" % (u["state"]["draw"], u["state"]["release"]))
    rep["stats"] = B.stats()
    print("TRIANGLES", rep["stats"]["triangles"], json.dumps({k: v for k, v in rep["stats"]["per_object"].items() if not k.startswith("LiveCord")}))
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    B.export(os.path.abspath(out))
    os.makedirs(os.path.join(HERE, '..', 'out'), exist_ok=True)
    json.dump(rep, open(os.path.join(HERE, '..', 'out', 'build_report.json'), 'w'), indent=1, default=str)
    print("DONE %.1fs -> %s" % (time.time() - T0, out))

if __name__ == "__main__":
    main()
