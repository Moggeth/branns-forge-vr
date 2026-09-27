"""Brann's Forge skeleton guardian builder (Blender 4.5, run headless).

    blender -b --factory-startup --python builder/build_guardian.py -- <variant> [--no-render]

variant: mossward | prismwatch | cinderkeep | all
Outputs per variant under assets/<variant>/:
  <variant>.blend, <variant>_guardian.glb, <variant>_shield.glb,
  renders/*.png, manifest.json
Axes: authored in Blender Z-up with the character facing -Y. The glTF exporter's
+Y-up conversion maps Blender (x, y, z) -> Godot (x, z, -y), so faces +Z in Godot.
"""
import bpy, bmesh, json, math, os, sys
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GROUPS = ["Head", "Torso", "LeftArm", "RightArm", "LeftLeg", "RightLeg", "Shield"]


def gd(v):  # Blender -> Godot coordinates
    return [round(v[0], 4), round(v[2], 4), round(-v[1], 4)]


# ---------------------------------------------------------------- materials
def material(name, color, rough=0.6, metal=0.0, emit=None, emit_strength=0.0, alpha=1.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes["Principled BSDF"]
    c = Vector(int(color[i:i + 2], 16) / 255 for i in (0, 2, 4))
    c = [x ** 2.2 for x in c]  # sRGB hex -> linear
    p.inputs["Base Color"].default_value = (*c, 1)
    p.inputs["Roughness"].default_value = rough
    p.inputs["Metallic"].default_value = metal
    if emit:
        e = [(int(emit[i:i + 2], 16) / 255) ** 2.2 for i in (0, 2, 4)]
        p.inputs["Emission Color"].default_value = (*e, 1)
        p.inputs["Emission Strength"].default_value = emit_strength
    if alpha < 1:
        p.inputs["Alpha"].default_value = alpha
        m.surface_render_method = "BLENDED"
    m.use_backface_culling = False
    return m


# ---------------------------------------------------------------- mesh part builder
class Part:
    """Accumulates closed solids into one bmesh with per-face material slots."""

    def __init__(self, name):
        self.name, self.bm, self.mats = name, bmesh.new(), []

    def _slot(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def _tag(self, before, mat, smooth):
        idx = self._slot(mat)
        for f in set(self.bm.faces) - before:
            f.material_index, f.smooth = idx, smooth

    def sphere(self, c, r, mat, scale=(1, 1, 1), seg=12, rings=8, rot=None, smooth=True):
        b = set(self.bm.faces)
        m = Matrix.Translation(c) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*scale, 1))
        bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r, matrix=m)
        self._tag(b, mat, smooth)

    def box(self, c, size, mat, rot=None):
        b = set(self.bm.faces)
        m = Matrix.Translation(c) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
        bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        self._tag(b, mat, False)

    def cyl(self, a, b_, r1, r2, mat, seg=10, smooth=True):
        a, b_ = Vector(a), Vector(b_)
        d = b_ - a
        q = d.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
        m = Matrix.Translation((a + b_) / 2) @ q
        b = set(self.bm.faces)
        bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg,
                              radius1=r1, radius2=r2, depth=d.length, matrix=m)
        self._tag(b, mat, smooth)

    def bone(self, a, b_, r, mat, knob=1.0):
        """Long bone: shaft plus paired condyle knobs at each end."""
        a, b_ = Vector(a), Vector(b_)
        d = (b_ - a).normalized()
        side = d.cross(Vector((0, 1, 0)))
        if side.length < 0.1:
            side = d.cross(Vector((1, 0, 0)))
        side.normalize()
        self.cyl(a + d * r, b_ - d * r, r * 0.95, r * 0.8, mat, seg=9)
        for end, s in ((a, 1), (b_, -1)):
            for k in (-1, 1):
                self.sphere(end + d * r * 0.9 * s + side * k * r * 0.62, r * 1.18 * knob, mat, seg=9, rings=6)

    def tube(self, pts, r, mat, seg=8, closed=False, smooth=True):
        pts = [Vector(p) for p in pts]
        rs = r if isinstance(r, (list, tuple)) else [r] * len(pts)
        n = len(pts)
        b = set(self.bm.faces)
        rings, prev_nrm = [], None
        for i, p in enumerate(pts):
            if closed:
                t = (pts[(i + 1) % n] - pts[i - 1]).normalized()
            else:
                t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
            ref = prev_nrm or (Vector((0, 0, 1)) if abs(t.z) < 0.9 else Vector((1, 0, 0)))
            nrm = (ref - t * ref.dot(t)).normalized()
            prev_nrm = nrm
            bin_ = t.cross(nrm)
            rings.append([self.bm.verts.new(p + (nrm * math.cos(a) + bin_ * math.sin(a)) * rs[i])
                          for a in (k * math.tau / seg for k in range(seg))])
        for i in range(n if closed else n - 1):
            r0, r1 = rings[i], rings[(i + 1) % n]
            for k in range(seg):
                self.bm.faces.new((r0[k], r0[(k + 1) % seg], r1[(k + 1) % seg], r1[k]))
        if not closed:
            self.bm.faces.new(rings[0])
            self.bm.faces.new(list(reversed(rings[-1])))
        self._tag(b, mat, smooth)

    def prism(self, outline, y0, y1, mat, xf=None, smooth=False):
        """Extrude a 2D (u, v) outline along -Y..Y; u->x, v->z."""
        xf = xf or Matrix.Identity(4)
        b = set(self.bm.faces)
        front = [self.bm.verts.new(xf @ Vector((u, y0, v))) for u, v in outline]
        back = [self.bm.verts.new(xf @ Vector((u, y1, v))) for u, v in outline]
        n = len(outline)
        self.bm.faces.new(front)
        self.bm.faces.new(list(reversed(back)))
        for i in range(n):
            j = (i + 1) % n
            self.bm.faces.new((front[i], back[i], back[j], front[j]))
        self._tag(b, mat, smooth)

    def ring(self, outer, inner, y0, y1, mat, xf=None):
        """Closed frame between two outlines of equal point count."""
        xf = xf or Matrix.Identity(4)
        b = set(self.bm.faces)
        L = [[self.bm.verts.new(xf @ Vector((u, y, v))) for u, v in loop]
             for loop, y in ((outer, y0), (inner, y0), (inner, y1), (outer, y1))]
        n = len(outer)
        for i in range(n):
            j = (i + 1) % n
            for a in range(4):
                c = (a + 1) % 4
                self.bm.faces.new((L[a][i], L[a][j], L[c][j], L[c][i]))
        self._tag(b, mat, False)

    def finish(self, pivot, collection, transform=None):
        bm = self.bm
        if transform is not None:
            bmesh.ops.transform(bm, matrix=transform, verts=bm.verts)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bmesh.ops.translate(bm, vec=-Vector(pivot), verts=bm.verts)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        bm.free()
        for m in self.mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        ob.location = pivot
        collection.objects.link(ob)
        return ob


# ---------------------------------------------------------------- 2D outline helpers
def offset_poly(pts, d):
    """Inset a CCW polygon by d using mitred edge normals."""
    n, out = len(pts), []
    for i in range(n):
        p0, p1, p2 = (Vector(pts[i - 1]), Vector(pts[i]), Vector(pts[(i + 1) % n]))
        e0, e1 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n0, n1 = Vector((-e0.y, e0.x)), Vector((-e1.y, e1.x))
        m = (n0 + n1)
        m = m.normalized() if m.length > 1e-6 else n0
        k = d / max(0.35, m.dot(n0))
        out.append(tuple(p1 + m * k))
    return out


def ccw(pts):
    area = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1]
               for i in range(len(pts)))
    return pts if area > 0 else list(reversed(pts))


def kite_outline(w=0.34, top=0.52, bottom=-0.56, n=14):
    right = []
    for i in range(n + 1):  # right side, top to bottom
        v = top - 0.06 - (top - 0.06 - bottom) * i / n
        t = max(0.0, (0.18 - v) / (0.18 - bottom))
        right.append((w * (1 - t ** 1.7) ** 0.9 + 0.001, v))
    right[-1] = (0.0, bottom)
    arc = [(w * math.cos(a), top - 0.06 + 0.06 * math.sin(a)) for a in
           (math.pi / 2 * k / 6 for k in range(1, 6))]
    left = [(-u, v) for u, v in reversed(right[:-1])]
    pts = right + left + [(-u, v) for u, v in arc] + [(0, top)] + list(reversed(arc))
    return ccw(pts)


def hex_outline(w=0.36, h=0.58, shoulder=0.30):
    return ccw([(0, h), (w, shoulder), (w, -shoulder), (0, -h), (-w, -shoulder), (-w, shoulder)])


def rounded_rect(w, h, r, n=4):
    pts = []
    for cx, cy, a0 in ((w - r, h - r, 0), (-w + r, h - r, 90), (-w + r, -h + r, 180), (w - r, -h + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return ccw(pts)


def leaf_outline(length=0.62, width=0.2, lobes=4, n=64):
    """Oak leaf: rounded lobes along a tapered blade, plus a stem."""
    right = []
    for i in range(n + 1):
        t = i / n
        env = math.sin(math.pi * t) ** 0.75 * (0.55 + 0.45 * t)
        lobe = 0.45 + 0.55 * abs(math.cos(t * lobes * math.pi)) ** 0.6
        right.append((width * env * lobe, -length / 2 + length * t))
    base = -length / 2
    stem = [(0.018, base - 0.06), (0.0, base - 0.075), (-0.018, base - 0.06)]
    pts = [(0.018, base)] + right[1:-1] + [(0, length / 2)] + [(-u, v) for u, v in reversed(right[1:-1])] + [(-0.018, base)] + list(reversed(stem))
    return ccw(pts)


def flame_outline(k=1.0):
    """Three-tongue stylised flame, CCW."""
    pts = [(0, -0.17), (0.09, -0.15), (0.14, -0.08), (0.155, 0.0), (0.145, 0.07), (0.13, 0.15),
           (0.09, 0.08), (0.065, 0.1), (0.05, 0.17), (0.015, 0.26), (-0.03, 0.17), (-0.06, 0.1),
           (-0.075, 0.06), (-0.1, 0.1), (-0.125, 0.16), (-0.145, 0.06), (-0.155, -0.02),
           (-0.13, -0.1), (-0.08, -0.15)]
    return ccw([(u * k, v * k) for u, v in pts])


def stadium(w, h, n=6):
    pts = []
    for cy, a0 in ((h / 2 - w / 2, 0), (-h / 2 + w / 2, 180)):
        for k in range(n + 1):
            a = math.radians(a0 + 180 * k / n)
            pts.append((w / 2 * math.cos(a), cy + w / 2 * math.sin(a)))
    return ccw(pts)


# ---------------------------------------------------------------- variants
VARIANTS = {
    "mossward": dict(
        title="Mossward", zone="Pinewood Ruins", scale=0.96, thick=1.0, width=1.0,
        bone="E9DDC0", accent="5E7F3E", cloth="6E8A45", trim="3B2F25", mood="anxious",
        shield=dict(kind="kite", t=0.05, rim=0.05, face="5E7F3E", back="6B4B32",
                    rim_col="3A3A3F", stud="B08A4E", emblem="EDE3C6",
                    yaw=12, center=(-0.44, -0.25, 0.84))),
    "prismwatch": dict(
        title="Prismwatch", zone="Crystal Hollow", scale=0.97, thick=0.95, width=0.97,
        bone="ECE0C4", accent="6A4BA0", cloth="6F4FA6", trim="B8913F", mood="curious",
        shield=dict(kind="hex", t=0.055, rim=0.06, face="4E5A7A", back="434C68",
                    rim_col="55607F", stud="C49A45", emblem="B79AF0",
                    yaw=14, center=(-0.45, -0.26, 0.86))),
    "cinderkeep": dict(
        title="Cinderkeep", zone="Ember Foundry", scale=0.92, thick=1.32, width=1.14,
        bone="E6D6B6", accent="7A4A2E", cloth="6A4330", trim="2C2522", mood="stern",
        shield=dict(kind="door", t=0.06, rim=0.07, face="2B2A2C", back="3A3634",
                    rim_col="A8623A", stud="C9794A", emblem="B8683F",
                    yaw=10, center=(-0.47, -0.27, 0.86))),
}


def build_shield(V, M):
    """Returns (Part in plate-local coords, info dict). Front face is -Y (Godot +Z)."""
    S = V["shield"]
    t, rim = S["t"], S["rim"]
    part = Part("Shield")
    y_front, y_back = -t / 2, t / 2
    if S["kind"] == "kite":
        outer = kite_outline()
    elif S["kind"] == "hex":
        outer = hex_outline()
    else:
        outer = rounded_rect(0.36, 0.52, 0.07)
    inner = offset_poly(outer, rim)
    plate = offset_poly(outer, rim * 0.5)
    part.prism(plate, y_front, y_back, M["face_back"])
    # Front face skin (colored) sits proud of the core so front/back read differently.
    part.prism(inner, y_front - 0.006, y_front + 0.004, M["face"])
    part.ring(outer, inner, y_front - 0.022, y_back + 0.02, M["rim"])  # thick safe rim
    top_v = max(v for _, v in outer)
    bot_v = min(v for _, v in outer)
    half_w = max(u for u, _ in outer)
    yf = y_front - 0.006
    # Rivets around the rim, both faces.
    mid = offset_poly(outer, rim * 0.5)
    step = max(1, len(mid) // 12)
    for i, (u, v) in enumerate(mid[::step]):
        part.sphere((u, y_front - 0.022, v), 0.017, M["stud"], scale=(1, 0.6, 1), seg=8, rings=5)
        part.sphere((u, y_back + 0.02, v), 0.013, M["stud"], scale=(1, 0.6, 1), seg=8, rings=5)

    kind = S["kind"]
    if kind == "kite":
        # Plank seams + raised ivory oak leaf with midrib and acorn cap.
        for u in (-0.2, -0.1, 0.0, 0.1, 0.2):
            v0, v1 = top_v - 0.09, bot_v + 0.1 + abs(u) * 1.35
            part.box((u + 0.05, yf - 0.001, (v0 + v1) / 2), (0.008, 0.004, v0 - v1), M["seam"])
        leaf = leaf_outline()
        xf = Matrix.Translation((0, 0, 0.06))
        part.prism(leaf, yf - 0.026, yf + 0.002, M["emblem"], xf=xf)
        part.tube([(0, yf - 0.03, -0.29 + 0.06), (0, yf - 0.032, 0.0), (0, yf - 0.028, 0.3)], 0.008, M["emblem_shade"])
        for s in (-1, 1):
            for k in range(4):
                v = -0.18 + k * 0.13
                t_ = (v + 0.06 + 0.31) / 0.62
                reach = 0.2 * math.sin(math.pi * t_) ** 0.75 * (0.55 + 0.45 * t_) * 0.7
                part.tube([(0, yf - 0.03, v + 0.06), (s * reach, yf - 0.028, v + 0.06 + reach * 0.8)], 0.005, M["emblem_shade"], seg=6)
        part.sphere((0, yf - 0.02, -0.34), 0.045, M["emblem"], scale=(1, 0.5, 0.8))
    elif kind == "hex":
        gem = offset_poly(outer, rim + 0.035)
        mid_ring = [(u * 0.62, v * 0.66) for u, v in gem]
        table = [(u * 0.3, v * 0.34) for u, v in gem]
        b = set(part.bm.faces)
        bm = part.bm
        L0 = [bm.verts.new(Vector((u, yf + 0.002, v))) for u, v in gem]
        L1 = [bm.verts.new(Vector((u, yf - 0.045, v))) for u, v in mid_ring]
        L2 = [bm.verts.new(Vector((u, yf - 0.062, v))) for u, v in table]
        n = len(gem)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((L0[i], L0[j], L1[j], L1[i]))
            bm.faces.new((L1[i], L1[j], L2[j], L2[i]))
        bm.faces.new(L2)
        bm.faces.new(list(reversed(L0)))
        part._tag(b, M["crystal"], False)
        # Cyan glimmer veins riding the facets.
        for pts in ([(-0.14, -0.30), (-0.05, -0.1), (-0.09, 0.08), (0.02, 0.26)],
                    [(0.16, -0.18), (0.06, -0.02), (0.12, 0.2)]):
            path = []
            for u, v in pts:
                r = max(abs(u) / 0.3, abs(v) / 0.45)
                path.append((u, yf - 0.064 + min(1, r) * 0.05, v))
            part.tube(path, 0.006, M["glimmer"], seg=6)
        # Brass braces with pyramid studs at top, bottom and both flanks.
        for u, v in ((0, top_v - 0.03), (0, bot_v + 0.03), (half_w - 0.02, 0), (-half_w + 0.02, 0)):
            part.box((u, 0, v), (0.12, t + 0.07, 0.12), M["stud"],
                     rot=Matrix.Rotation(math.radians(45) if u == 0 else 0, 4, "Y"))
            b = set(part.bm.faces)
            bmesh.ops.create_cone(part.bm, cap_ends=True, segments=4, radius1=0.04, radius2=0.0,
                                  depth=0.04, matrix=Matrix.Translation((u, y_front - 0.065, v)) @ Matrix.Rotation(math.pi / 2, 4, "X"))
            part._tag(b, M["stud"], False)
    else:
        # Furnace door: copper flame emblem, three glowing vent slots in copper bezels.
        part.prism(flame_outline(), yf - 0.024, yf + 0.002, M["emblem"], xf=Matrix.Translation((0, 0, 0.14)))
        part.prism(flame_outline(0.45), yf - 0.03, yf - 0.02, M["glow"],
                   xf=Matrix.Translation((0, 0, 0.1)))
        for u in (-0.12, 0.0, 0.12):
            slot = stadium(0.055, 0.2)
            bez = offset_poly(slot, -0.018)
            xf = Matrix.Translation((u, 0, -0.22))
            part.ring(bez, slot, yf - 0.018, yf + 0.004, M["emblem"], xf=xf)
            part.prism(slot, yf - 0.004, yf + 0.004, M["glow"], xf=xf)
        # Hinges on the outer (-u) edge.
        for v in (0.28, -0.28):
            part.box((-half_w + 0.02, 0, v), (0.1, t + 0.08, 0.13), M["stud"])
            part.cyl((-half_w - 0.035, 0, v - 0.08), (-half_w - 0.035, 0, v + 0.08), 0.03, 0.03, M["rim"], seg=10)
            part.box((-half_w + 0.14, y_front - 0.02, v), (0.22, 0.02, 0.07), M["stud"])
        # Latch block on the leading edge.
        part.box((half_w - 0.01, 0, 0.0), (0.07, t + 0.07, 0.16), M["stud"])

    # ---- rear furniture: back boards, central hand grip, rim grip, brackets
    grip_y = y_back + 0.065
    if kind == "kite":
        for u in (-0.2, -0.1, 0.0, 0.1, 0.2):
            part.box((u + 0.05, y_back + 0.002, 0.0), (0.008, 0.004, 0.62 - abs(u)), M["seam_back"])
    elif kind == "door":
        part.prism(offset_poly(outer, rim + 0.02), y_back + 0.001, y_back + 0.014, M["heat"])  # copper heat shield, no wood
        for v in (0.24, -0.24):
            part.box((0, y_back + 0.022, v), (0.5, 0.012, 0.05), M["rim"])
    else:
        part.ring(offset_poly(outer, rim + 0.05), offset_poly(outer, rim + 0.075), y_back, y_back + 0.012, M["rim"])
    # Central grip: vertical leather-wrapped bar on two iron brackets.
    gh = 0.13
    for s in (-1, 1):
        part.box((0, y_back + 0.035, s * (gh + 0.02)), (0.07, 0.07, 0.035), M["bracket"])
    part.cyl((0, grip_y, -gh - 0.02), (0, grip_y, gh + 0.02), 0.019, 0.019, M["bracket"], seg=10)
    part.cyl((0, grip_y, -gh + 0.01), (0, grip_y, gh - 0.01), 0.024, 0.024, M["leather"], seg=10)
    # Rim grip: curved bar hugging the leading (+u) edge, reachable from behind.
    ru = half_w - rim - 0.06
    if kind == "kite":
        ru = 0.22
    arc = [(ru + 0.035 * math.sin(math.pi * k / 6), y_back + 0.02 + 0.05 * math.sin(math.pi * k / 6), -0.16 + 0.32 * k / 6)
           for k in range(7)]
    part.tube(arc, 0.018, M["bracket"], seg=8)
    part.tube(arc[1:-1], 0.022, M["leather"], seg=8)
    for p in (arc[0], arc[-1]):
        part.box((p[0], y_back + 0.012, p[2]), (0.06, 0.025, 0.05), M["bracket"])
    info = dict(grip=Vector((0, grip_y, 0)), rim_grip=Vector(arc[3]), top=top_v, bottom=bot_v,
                half_w=half_w, t=t + 0.042 + 0.09)
    info["tip"] = Vector((0, 0, top_v + 0.0))
    return part, info


def build_character(V, M, col):
    th, wd = V["thick"], V["width"]
    B, D = M["bone"], M["socket"]
    r_long = 0.028 * th
    parts = {}

    # ---------- legs (pivot at hip)
    for side, name in ((-1, "LeftLeg"), (1, "RightLeg")):
        P = Part(name)
        hip = Vector((side * 0.13 * wd, 0, 0.80))
        knee = Vector((side * 0.14 * wd, -0.03, 0.45))
        ankle = Vector((side * 0.145 * wd, 0.0, 0.085))
        P.sphere(hip + Vector((-side * 0.015, 0, 0)), 0.038 * th, B)
        P.bone(hip + Vector((0, 0, -0.03)), knee, r_long * 1.05, B)
        P.sphere(knee + Vector((0, -0.035, 0.0)), 0.03 * th, B, scale=(1, 0.7, 1.1))
        P.bone(knee + Vector((side * -0.012, 0, -0.03)), ankle + Vector((side * -0.012, 0, 0)), r_long * 0.85, B)
        P.cyl(knee + Vector((side * 0.03, 0.01, -0.05)), ankle + Vector((side * 0.028, 0.01, 0.02)), 0.012 * th, 0.011 * th, B, seg=7)
        if V["title"] == "Cinderkeep":
            P.sphere(knee + Vector((0, -0.05, 0.01)), 0.052, M["stud"], scale=(1, 0.6, 1))
        # foot: heel, tarsal block, five metatarsals/toes
        P.sphere(ankle + Vector((0, 0.045, -0.045)), 0.035 * th, B, scale=(0.9, 1.1, 0.9))
        P.sphere(ankle + Vector((0, -0.03, -0.05)), 0.04 * th, B, scale=(1.3, 1.2, 0.7))
        for k in range(5):
            x = ankle.x + side * (-0.035 + k * 0.018) * wd
            a = Vector((x, -0.06, 0.03))
            b = Vector((x + side * 0.004 * (k - 2), -0.15 - 0.012 * (2 - abs(k - 1.5)), 0.016))
            P.cyl(a, b, 0.009 * th, 0.008 * th, B, seg=6)
            P.sphere(b, 0.013 * th, B, seg=8, rings=5)
            P.sphere(b + Vector((0, -0.022, -0.003)), 0.011 * th, B, scale=(1, 1.3, 1), seg=8, rings=5)
        parts[name] = (P, hip)

    # ---------- torso (pivot at lumbar/pelvis)
    T = Part("Torso")
    pelvis_z = 0.86
    T.tube([(0.13 * wd * math.cos(a), 0.07 * math.sin(a) + 0.01, pelvis_z - 0.02 * math.sin(a))
            for a in (k * math.tau / 16 for k in range(16))], 0.022 * th, B, closed=True)
    for s in (-1, 1):
        T.sphere((s * 0.12 * wd, 0.02, pelvis_z + 0.05), 0.07 * th, B, scale=(0.9, 0.45, 0.8),
                 rot=Matrix.Rotation(s * 0.35, 4, "Y"))
    T.sphere((0, 0.06, pelvis_z + 0.01), 0.05 * th, B, scale=(0.8, 0.6, 1.1))
    vz = [pelvis_z + 0.06 + k * 0.047 for k in range(12)]
    for k, z in enumerate(vz):  # spine: separate vertebrae
        T.cyl((0, 0.05, z - 0.016), (0, 0.05, z + 0.016), 0.024 * th, 0.024 * th, B, seg=8)
        T.box((0, 0.085, z), (0.018, 0.04, 0.02), B)
    for i in range(6):  # ribs: open at the front, sweeping down
        z = 1.34 - i * 0.052
        rx = (0.14 + 0.02 * math.sin(i / 5 * math.pi)) * wd * (1.0 - 0.05 * max(0, i - 3))
        ry = 0.1 * (1 - 0.03 * i)
        pts = []
        for k in range(19):
            a = math.radians(-60 + 300 * k / 18)
            pts.append((rx * math.cos(a), ry * math.sin(a) + 0.01, z - 0.05 * (1 - math.sin(a)) / 2))
        T.tube(pts[:9], 0.012 * th, B, seg=6)
        T.tube(pts[10:], 0.012 * th, B, seg=6)
    T.box((0, -0.095, 1.24), (0.035, 0.018, 0.2), B)  # sternum
    T.box((0, -0.095, 1.36), (0.05, 0.018, 0.05), B)
    for s in (-1, 1):
        T.tube([(s * 0.02, -0.08, 1.4), (s * 0.12 * wd, -0.05, 1.42), (s * 0.2 * wd, 0.0, 1.4)], 0.014 * th, B, seg=6)
        T.prism(ccw([(0, 0.07), (0.07, 0.04), (0.04, -0.09), (-0.01, -0.07)]), 0.1, 0.12, B,
                xf=Matrix.Translation((s * 0.11 * wd, 0, 1.3)) @ Matrix.Diagonal((s, 1, 1, 1)))
    # Cloth: front and back flaps with ragged hems, belt.
    T.tube([(0.14 * wd * math.cos(a), 0.085 * math.sin(a) + 0.01, pelvis_z + 0.045)
            for a in (k * math.tau / 16 for k in range(16))], 0.016, M["trim"], closed=True)
    for yy, w in ((-0.085, 0.13), (0.09, 0.11)):
        hem = [(w, 0.0)]
        for k in range(9):
            u = w - 2 * w * k / 8
            hem.append((u, -0.28 - (0.05 if k % 2 else 0.0) - 0.03 * math.sin(k * 1.7)))
        hem += [(-w, 0.0)]
        T.prism(ccw(hem), yy - 0.006, yy + 0.006, M["cloth"], xf=Matrix.Translation((0, 0, pelvis_z + 0.04)))
    mood = V["mood"]
    if mood == "anxious":  # moss rag over the left shoulder + little vine
        T.prism(ccw([(-0.02, 0.0), (0.16, 0.02), (0.18, -0.12), (0.12, -0.08), (0.08, -0.16), (0.04, -0.1), (-0.01, -0.13)]),
                -0.105, -0.093, M["cloth"], xf=Matrix.Translation((-0.2, 0, 1.43)))
        T.tube([(-0.02, -0.1, 1.35), (-0.08, -0.12, 1.3), (-0.12, -0.11, 1.22), (-0.1, -0.12, 1.14)], 0.006, M["accent"], seg=6)
        for p in ((-0.08, -0.13, 1.3), (-0.11, -0.13, 1.18)):
            T.sphere(p, 0.022, M["accent"], scale=(1, 0.3, 0.6), seg=8, rings=5)
    elif mood == "curious":  # sash with brass brooch
        T.tube([(-0.2, -0.06, 1.4), (-0.08, -0.12, 1.28), (0.06, -0.12, 1.12), (0.14, -0.09, 0.98)], 0.022, M["cloth"], seg=8)
        T.sphere((-0.1, -0.13, 1.3), 0.025, M["stud"], scale=(1, 0.5, 1))
    else:  # smith: apron bib strap and ring
        T.tube([(-0.15, -0.05, 1.42), (-0.05, -0.12, 1.2), (0.06, -0.12, 1.0)], 0.018, M["trim"], seg=6)
        T.tube([(-0.15, 0.03, 1.42), (-0.06, 0.12, 1.2), (0.06, 0.12, 1.0)], 0.018, M["trim"], seg=6)
        T.tube([(0.035 * math.cos(a) + 0.05, -0.1, 0.94 + 0.035 * math.sin(a)) for a in (k * math.tau / 12 for k in range(12))],
               0.007, M["stud"], closed=True, seg=6)
    parts["Torso"] = (T, Vector((0, 0.03, pelvis_z + 0.07)))

    # ---------- head (pivot at the neck base)
    H = Part("Head")
    neck = Vector((0, 0.04, 1.44))
    for k in range(3):
        z = neck.z + 0.012 + k * 0.03
        H.cyl((0, 0.04, z - 0.011), (0, 0.04, z + 0.011), 0.021 * th, 0.021 * th, B, seg=8)
    hs = 1.28 + (0.08 if mood == "stern" else 0)
    c = Vector((0, -0.015, 1.535))
    H.sphere(c, 0.125 * hs, B, scale=(1.0, 1.08, 1.0), seg=18, rings=12)
    H.sphere(c + Vector((0, -0.07, -0.06)) * hs, 0.085 * hs, B, scale=(1.05, 0.9, 0.8), seg=14, rings=8)  # face/maxilla
    for s in (-1, 1):  # cheekbones and sockets
        H.sphere(c + Vector((s * 0.07, -0.08, -0.05)) * hs, 0.035 * hs, B, scale=(1, 0.8, 0.7))
        big = 0.05 if mood == "anxious" else (0.045 if mood == "curious" and s < 0 else 0.04)
        H.sphere(c + Vector((s * 0.05, -0.105, -0.005)) * hs, big * hs, D, scale=(1, 0.5, 1.1 if mood != "stern" else 0.8))
        if mood == "anxious":  # worried brows lifted at the centre
            H.tube([c + Vector((s * 0.1, -0.11, 0.035)) * hs, c + Vector((s * 0.02, -0.125, 0.07)) * hs], 0.012, B, seg=6)
        elif mood == "stern":  # heavy brows angled down
            H.tube([c + Vector((s * 0.1, -0.11, 0.05)) * hs, c + Vector((s * 0.015, -0.13, 0.02)) * hs], 0.02, B, seg=6)
    H.prism(ccw([(-0.018, 0.0), (0.018, 0.0), (0.0, 0.04)]), -0.155 * hs, -0.12 * hs, D,
            xf=Matrix.Translation(c + Vector((0, 0.0, -0.085)) * hs))
    for i in range(8):  # upper teeth
        u = (i - 3.5) * 0.014
        H.box(c + Vector((u, -0.135 + abs(u) * 0.4, -0.115)) * hs, (0.011, 0.012, 0.022), B)
    jaw_open = {"anxious": 0.035, "curious": 0.02, "stern": 0.0}[mood]
    jaw = [c + Vector((0.075 * math.cos(a), -0.02 - 0.1 * math.sin(a), -0.13 - jaw_open * math.sin(a)
                       - (0.012 if mood == "stern" else 0))) * hs for a in (math.pi * k / 10 for k in range(11))]
    H.tube(jaw, 0.02 * th, B, seg=8)
    for i in range(6):  # lower teeth
        u = (i - 2.5) * 0.015
        H.box(c + Vector((u, -0.115 + abs(u) * 0.3 - (0.01 if mood == "stern" else 0), -0.122 - jaw_open)) * hs, (0.011, 0.012, 0.02), B)
    for s in (-1, 1):
        H.tube([c + Vector((s * 0.075, -0.02, -0.13)) * hs, c + Vector((s * 0.08, 0.02, -0.06)) * hs], 0.016 * th, B, seg=7)
    if mood == "curious":  # brass circlet with a lavender crystal
        H.tube([c + Vector((0.13 * math.cos(a), 0.14 * math.sin(a), 0.04 - 0.02 * math.sin(a))) * hs
                for a in (k * math.tau / 20 for k in range(20))], 0.011, M["stud"], closed=True, seg=6)
        b = set(H.bm.faces)
        for d in (1, -1):
            bmesh.ops.create_cone(H.bm, cap_ends=True, segments=5, radius1=0.028, radius2=0.0, depth=0.04,
                                  matrix=Matrix.Translation(c + Vector((0.03, -0.14, 0.06 + d * 0.02))) @ Matrix.Rotation(0 if d > 0 else math.pi, 4, "X"))
        H._tag(b, M["crystal"], False)
    head_rot = {"anxious": Matrix.Rotation(0.12, 4, "Y"), "curious": Matrix.Rotation(-0.22, 4, "Y"), "stern": Matrix.Rotation(-0.08, 4, "X")}[mood]
    head_xf = Matrix.Translation(neck) @ head_rot @ Matrix.Translation(-neck)
    parts["Head"] = (H, neck, head_xf)

    # ---------- arms (pivot at shoulder)
    SH = V["shield"]
    shield_part, info = build_shield(V, M)
    yaw = Matrix.Rotation(math.radians(SH["yaw"]), 4, "Z")
    shield_xf = Matrix.Translation(SH["center"]) @ yaw
    grip_world = shield_xf @ info["grip"]
    for side, name in ((-1, "LeftArm"), (1, "RightArm")):
        A = Part(name)
        sh = Vector((side * 0.225 * wd, 0.0, 1.37))
        if side < 0:
            wrist = grip_world + Vector((0.0, 0.035, -0.085))
            elbow = Vector((-0.31 * wd, 0.06, 1.1))
        else:
            elbow = Vector((0.29 * wd, 0.0, 1.09))
            wrist = Vector((0.33 * wd, -0.1, 0.86))
        A.sphere(sh, 0.036 * th, B)
        A.bone(sh + Vector((0, 0, -0.03)), elbow, r_long * 0.9, B)
        A.sphere(elbow + Vector((0, 0.02, 0)), 0.024 * th, B)
        d = (wrist - elbow)
        perp = d.cross(Vector((0, 0, 1))).normalized() * 0.013
        A.cyl(elbow + perp, wrist + perp, 0.012 * th, 0.011 * th, B, seg=7)
        A.cyl(elbow - perp, wrist - perp * 0.6, 0.013 * th, 0.01 * th, B, seg=7)
        A.sphere(wrist, 0.022 * th, B, scale=(1.1, 1, 0.8))
        if side < 0:  # fist wrapped around the vertical central grip
            g = grip_world
            for k in range(4):
                z = g.z + 0.04 - k * 0.025
                ring = [g + Vector((0.035 * math.cos(a), 0.033 * math.sin(a), 0)) for a in
                        (math.radians(v) for v in (60, 0, -60, -120, -170))]
                pts = [Vector((p.x, p.y, z)) for p in ring]
                A.tube(pts, 0.009 * th, B, seg=6)
                A.sphere(pts[0], 0.011 * th, B, seg=6, rings=4)
            A.tube([wrist, g + Vector((0.04, 0.02, -0.03)), g + Vector((0.04, -0.03, 0.03))], 0.01 * th, B, seg=6)  # thumb
            A.sphere(g + Vector((-0.02, 0.035, -0.0)), 0.03 * th, B, scale=(1, 0.7, 1.2))  # palm heel
            A.tube([wrist, g + Vector((-0.02, 0.035, 0))], 0.02 * th, B, seg=7)
        else:  # open, slightly clawed hand
            fwd = Vector((0, -0.25, -1)).normalized()
            palm = wrist + fwd * 0.045
            A.sphere(palm, 0.03 * th, B, scale=(1.1, 0.6, 1.0))
            for k in range(4):
                base = palm + Vector((0.02 * (k - 1.5), -0.005, -0.025))
                curl = 0.35 if mood == "anxious" else 0.2
                j1 = base + Vector((0.005 * (k - 1.5), -0.02, -0.035))
                j2 = j1 + Vector((0, -0.03 - curl * 0.03, -0.025 + curl * 0.02))
                A.tube([base, j1, j2], 0.0075 * th, B, seg=6)
                A.sphere(j1, 0.009 * th, B, seg=6, rings=4)
            A.tube([palm + Vector((-0.02, -0.01, 0.0)), palm + Vector((-0.04, -0.04, -0.03)), palm + Vector((-0.035, -0.07, -0.045))], 0.008 * th, B, seg=6)
        parts[name] = (A, sh)

    return parts, shield_part, shield_xf, info


def mats_for(V):
    S = V["shield"]
    return dict(
        bone=material("Bone_Ivory", V["bone"], 0.55),
        socket=material("Bone_Socket", "2A211E", 0.9),
        cloth=material(V["title"] + "_Cloth", V["cloth"], 0.9),
        trim=material(V["title"] + "_Leather", V["trim"], 0.7),
        accent=material(V["title"] + "_Leaf", V["accent"], 0.7),
        face=material(V["title"] + "_ShieldFace", S["face"], 0.8, 0.2 if S["kind"] != "kite" else 0.0),
        face_back=material(V["title"] + "_ShieldCore", S["back"], 0.85, 0.3 if S["kind"] == "door" else 0.0),
        rim=material(V["title"] + "_ShieldRim", S["rim_col"], 0.45, 0.8),
        stud=material(V["title"] + "_Studs", S["stud"], 0.35, 0.9),
        bracket=material("Iron_Bracket", "3B3A3E", 0.5, 0.8),
        leather=material("Grip_Leather", "6A4028", 0.8),
        seam=material("Mossward_Seam", "2F3B24", 0.9),
        seam_back=material("Mossward_SeamBack", "3F2A1C", 0.9),
        emblem=material(V["title"] + "_Emblem", S["emblem"], 0.5, 0.6 if S["kind"] == "door" else 0.0),
        emblem_shade=material("Mossward_LeafVein", "BFB08E", 0.6),
        crystal=material("Prism_Crystal", "B89BF2", 0.08, 0.0, emit="8E6DE0", emit_strength=0.6, alpha=0.78),
        glimmer=material("Prism_Glimmer", "8FF3FF", 0.2, emit="6EF0FF", emit_strength=4.0),
        glow=material("Cinder_VentGlow", "FFB347", 0.4, emit="FF9A2E", emit_strength=6.0),
        heat=material("Cinder_HeatPlate", "8C4E2E", 0.4, 0.9),
    )


# ---------------------------------------------------------------- export / render
def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True,
                              export_cameras=False, export_lights=False, export_yup=True,
                              export_apply=True, export_materials="EXPORT", export_image_format="NONE")


def render_views(out_dir, variant, shield_center):
    scn = bpy.context.scene
    for eng in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scn.render.engine = eng
            break
        except TypeError:
            pass
    scn.render.resolution_x, scn.render.resolution_y = 900, 1100
    scn.render.film_transparent = False
    world = bpy.data.worlds.new("RenderWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.62, 0.58, 0.52, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scn.world = world
    scn.view_settings.view_transform = "AgX" if "AgX" in [i.identifier for i in scn.view_settings.bl_rna.properties["view_transform"].enum_items] else "Filmic"
    rig = []
    for name, rot, energy in (("Key", (math.radians(50), 0, math.radians(-35)), 3.5), ("Rim", (math.radians(60), 0, math.radians(160)), 2.0)):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = energy
        lo = bpy.data.objects.new(name, ld)
        lo.rotation_euler = rot
        scn.collection.objects.link(lo)
        rig.append(lo)
    # ground disc for contact/scale
    bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1.2, fill_type="NGON")
    ground = bpy.context.active_object
    ground.name = "RenderGround"
    ground.data.materials.append(material("RenderGround", "B9AE9C", 0.95))
    rig.append(ground)
    cd = bpy.data.cameras.new("Cam")
    cam = bpy.data.objects.new("Cam", cd)
    scn.collection.objects.link(cam)
    scn.camera = cam
    rig.append(cam)
    target = Vector((0, 0, 0.85))
    views = {
        "front": (Vector((0, -4.2, 0.95)), target, 35),
        "side": (Vector((-4.2, 0, 0.95)), target, 35),
        "back": (Vector((0, 4.2, 0.95)), target, 35),
        "hero": (Vector((-1.9, -2.5, 1.45)), Vector((-0.15, 0, 0.95)), 38),
        "shield_rear": (Vector((0.35, 1.25, 1.35)), Vector(shield_center) + Vector((0, 0.05, 0)), 30),
    }
    os.makedirs(out_dir, exist_ok=True)
    files = []
    for view, (loc, look, lens) in views.items():
        cam.location = loc
        cam.rotation_euler = (look - loc).to_track_quat("-Z", "Y").to_euler()
        cd.lens = lens
        if view == "shield_rear":
            cd.lens = 45
        scn.render.filepath = os.path.join(out_dir, f"{variant}_{view}.png")
        bpy.ops.render.render(write_still=True)
        files.append(os.path.relpath(scn.render.filepath, ROOT).replace("\\", "/"))
    for o in rig:
        bpy.data.objects.remove(o, do_unlink=True)
    return files


def build(variant, do_render=True):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    V = VARIANTS[variant]
    M = mats_for(V)
    out = os.path.join(ROOT, "assets", variant)
    os.makedirs(out, exist_ok=True)
    col = bpy.data.collections.new(V["title"] + "_Guardian")
    bpy.context.scene.collection.children.link(col)
    parts, shield_part, shield_xf, info = build_character(V, M, col)
    S = V["scale"]
    SM = Matrix.Diagonal((S, S, S, 1))
    objs = {}
    for name, entry in parts.items():
        part, pivot = entry[0], entry[1]
        xf = SM @ (entry[2] if len(entry) > 2 else Matrix.Identity(4))
        objs[name] = part.finish(SM @ Vector(pivot), col, transform=xf)
    # Character shield: origin at the central grip.
    grip_char = SM @ (shield_xf @ info["grip"])
    objs["Shield"] = shield_part.finish(grip_char, col, transform=SM @ shield_xf)
    # Standalone shield: same size/materials, identity rotation, origin at grip.
    sp, sinfo = build_shield(V, M)
    scol = bpy.data.collections.new(V["title"] + "_ShieldProp")
    bpy.context.scene.collection.children.link(scol)
    prop = sp.finish(SM @ sinfo["grip"], scol, transform=SM)
    prop.name = prop.data.name = f"{V['title']}Shield"
    prop.location = (0, 0, 0)
    # Scale sanity: toes on the floor.
    minz = min((o.location + v.co).z for o in objs.values() for v in o.data.vertices)
    for o in objs.values():
        o.location.z -= minz
    grip_char.z -= minz
    blend = os.path.join(out, f"{variant}.blend")
    export([objs[g] for g in GROUPS], os.path.join(out, f"{variant}_guardian.glb"))
    export([prop], os.path.join(out, f"{variant}_shield.glb"))
    scol.hide_render = True
    renders = []
    if do_render:
        renders = render_views(os.path.join(out, "renders"), variant, objs["Shield"].location)
    scol.hide_render = False
    prop.location = (1.5, 0, 1.0)  # keep visible beside the character in the .blend
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    # ---------------- manifest (Godot coordinates, metres)
    allv = [o.location + v.co for o in objs.values() for v in o.data.vertices]
    height = max(v.z for v in allv)
    g = lambda v: gd(Vector(v) * S)
    grip = sinfo["grip"]
    pv = [v.co for v in prop.data.vertices]
    lo = [min(v[i] for v in pv) for i in range(3)]
    hi = [max(v[i] for v in pv) for i in range(3)]
    center = [(a + b) / 2 for a, b in zip(lo, hi)]
    size = [b - a for a, b in zip(lo, hi)]
    manifest = {
        "variant": variant, "title": V["title"], "zone": V["zone"],
        "files": {"blend": f"assets/{variant}/{variant}.blend",
                  "character_glb": f"assets/{variant}/{variant}_guardian.glb",
                  "shield_glb": f"assets/{variant}/{variant}_shield.glb",
                  "builder": "builder/build_guardian.py", "renders": renders},
        "axes": "Godot: +Y up, +Z forward, +X right; toes at y=0",
        "height_m": round(height, 3),
        "groups": {n: {"origin": gd(objs[n].location), "triangles": tri_count(objs[n]),
                       "materials": [m.name for m in objs[n].data.materials]} for n in GROUPS},
        "triangles_total": sum(tri_count(objs[n]) for n in GROUPS),
        "materials_total": len({m.name for n in GROUPS for m in objs[n].data.materials}),
        "shield_prop": {
            "mesh": prop.name,
            "origin": "central hand grip",
            "triangles": tri_count(prop),
            "forward_normal": [0, 0, 1],
            "central_grip": [0, 0, 0],
            "central_grip_axis": [0, 1, 0],
            "rim_grip": g(sinfo["rim_grip"] - grip),
            "rim_grip_axis": [0, 1, 0],
            "item_tip": g(sinfo["tip"] - grip),
            "broad_phase_box": {"center": gd(Vector(center)), "size": [round(size[0], 4), round(size[2], 4), round(size[1], 4)]},
            "character_grip_position": gd(grip_char),
        },
    }
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump(manifest, f, indent=2)
    print("BUILT", variant, "tris", manifest["triangles_total"], "height", manifest["height_m"])
    return manifest


if __name__ == "__main__":
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else ["mossward"]
    names = list(VARIANTS) if argv[0] == "all" else [argv[0]]
    for n in names:
        build(n, do_render="--no-render" not in argv)
