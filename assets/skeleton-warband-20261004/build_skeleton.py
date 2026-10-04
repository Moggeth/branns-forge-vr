"""Skeleton warband builder (bpy 4.5, headless, deterministic).

    pip install bpy==4.5.*            # or: blender -b --python build_skeleton.py
    python3 build_skeleton.py         # writes skeleton.glb + build_report.json next to this file

One rigged body plus every variant's headgear, shoulder piece and shield, all skinned to the same 18-joint rig.
The game (multiplayer/client/skeleton-look.js) keeps one headgear/shield set per skeleton and drops the rest.

Authored in Blender Z-up facing -Y; the glTF exporter maps that to +Y up, facing +Z (asset-pose.js contract).
"Left*" joints sit at -X and carry the shield, exactly like the previous Mossward rig.
"""
import bpy, bmesh, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import textures as TX  # noqa: E402

OUT = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else HERE
V = Vector
FWD = V((0, -1, 0))

# ------------------------------------------------------------------ rig (Blender coords; heads/tails in metres)
# name: (head, tail, parent, deform)
JOINTS = {
    'Root': ((0, 0.015, 0.90), (0, 0.015, 0.99), None, True),
    'Torso': ((0, 0.03, 0.97), (0, 0.035, 1.40), 'Root', True),
    'Head': ((0, 0.035, 1.40), (0, 0.035, 1.56), 'Torso', True),
    'HeadJaw': ((0, -0.03, 1.44), (0, -0.14, 1.37), 'Head', True),
    'LeftArm': ((-0.19, 0.04, 1.355), (-0.225, 0.05, 1.06), 'Torso', True),
    'LeftForearm': ((-0.225, 0.05, 1.06), (-0.24, 0.03, 0.82), 'LeftArm', True),
    'LeftHand': ((-0.24, 0.03, 0.82), (-0.245, 0.02, 0.73), 'LeftForearm', True),
    'RightArm': ((0.19, 0.04, 1.355), (0.225, 0.05, 1.06), 'Torso', True),
    'RightForearm': ((0.225, 0.05, 1.06), (0.24, 0.03, 0.82), 'RightArm', True),
    'RightHand': ((0.24, 0.03, 0.82), (0.245, 0.02, 0.73), 'RightForearm', True),
    'WeaponTip': ((0.245, 0.02, 0.73), (0.245, 0.01, 0.70), 'RightHand', False),
    'LeftLeg': ((-0.105, 0.015, 0.86), (-0.115, -0.005, 0.465), 'Root', True),
    'LeftKnee': ((-0.115, -0.005, 0.465), (-0.12, 0.02, 0.085), 'LeftLeg', True),
    'LeftFoot': ((-0.12, 0.02, 0.085), (-0.125, -0.09, 0.02), 'LeftKnee', True),
    'RightLeg': ((0.105, 0.015, 0.86), (0.115, -0.005, 0.465), 'Root', True),
    'RightKnee': ((0.115, -0.005, 0.465), (0.12, 0.02, 0.085), 'RightLeg', True),
    'RightFoot': ((0.12, 0.02, 0.085), (0.125, -0.09, 0.02), 'RightKnee', True),
}
BONES = list(JOINTS)
J = {k: V(v[0]) for k, v in JOINTS.items()}
T = {k: V(v[1]) for k, v in JOINTS.items()}


def mirror(p):
    return V((-p[0], p[1], p[2]))


# ------------------------------------------------------------------ materials
def image(name, arr, colorspace='sRGB'):
    n = arr.shape[0]
    img = bpy.data.images.new(name, n, n, alpha=False)
    img.colorspace_settings.name = colorspace
    rgba = np.concatenate([arr[::-1], np.ones((n, n, 1), np.float32)], -1)  # Blender pixels start bottom-left
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.file_format = 'JPEG'
    img.pack()
    return img


def material(name, maps, rough=0.6, metal=0.0, color=(1, 1, 1), emit=None, vcol=True, normal_strength=1.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    p = nt.nodes['Principled BSDF']
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    base = None
    if 'albedo' in maps:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = maps['albedo']; base = t.outputs['Color']
    if vcol:
        a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'Col'
        mul = nt.nodes.new('ShaderNodeMix'); mul.data_type = 'RGBA'; mul.blend_type = 'MULTIPLY'; mul.inputs['Factor'].default_value = 1
        if base is not None: nt.links.new(base, mul.inputs['A'])
        else: mul.inputs['A'].default_value = (*color, 1)
        nt.links.new(a.outputs['Color'], mul.inputs['B'])
        base = mul.outputs['Result']
    if base is not None: nt.links.new(base, p.inputs['Base Color'])
    else: p.inputs['Base Color'].default_value = (*color, 1)
    if 'normal' in maps:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = maps['normal']
        nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = normal_strength
        nt.links.new(t.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    if 'orm' in maps:
        t = nt.nodes.new('ShaderNodeTexImage'); t.image = maps['orm']
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        nt.links.new(t.outputs['Color'], sep.inputs['Color'])
        nt.links.new(sep.outputs['Green'], p.inputs['Roughness']); nt.links.new(sep.outputs['Blue'], p.inputs['Metallic'])
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1)
        p.inputs['Emission Strength'].default_value = 1.0
        if 'albedo' in maps:
            nt.links.new(nt.nodes['Image Texture'].outputs['Color'], p.inputs['Emission Color'])
    return m


def make_materials():
    b_alb, b_nrm = TX.bone()
    w_alb, w_nrm = TX.wood()
    i_alb, i_nrm, i_orm = TX.iron()
    f_alb, f_nrm = TX.fabric()
    M = {}
    M['bone'] = material('Bone', {'albedo': image('bone_albedo', b_alb), 'normal': image('bone_normal', b_nrm, 'Non-Color')}, rough=0.64)
    M['cloth'] = material('Cloth', {'albedo': image('cloth_albedo', f_alb), 'normal': image('cloth_normal', f_nrm, 'Non-Color')}, rough=0.92)
    M['fabric'] = material('Fabric', {'albedo': bpy.data.images['cloth_albedo'], 'normal': bpy.data.images['cloth_normal']}, rough=0.9)
    M['wood'] = material('Wood', {'albedo': image('wood_albedo', w_alb), 'normal': image('wood_normal', w_nrm, 'Non-Color')}, rough=0.78)
    M['iron'] = material('Iron', {'albedo': image('iron_albedo', i_alb), 'normal': image('iron_normal', i_nrm, 'Non-Color'), 'orm': image('iron_orm', i_orm, 'Non-Color')}, rough=1, metal=1)
    M['glow'] = material('EyeGlow', {}, rough=1, color=(0.02, 0.05, 0.03), emit=(0.3, 0.85, 0.5), vcol=False)
    return M


# ------------------------------------------------------------------ mesh accumulation
class Part:
    """One skinned object: closed solids with rigid per-vertex joints, vertex colour and per-face materials."""

    def __init__(self, name, M):
        self.name, self.M, self.bm, self.mats = name, M, bmesh.new(), []
        self.lb = self.bm.verts.layers.int.new('bone')
        self.lb2 = self.bm.verts.layers.int.new('bone2')
        self.lw = self.bm.verts.layers.float.new('w2')
        self.lc = self.bm.verts.layers.float_color.new('Col')
        self.bone, self.tint, self.mat = 'Root', (1, 1, 1, 1), 'bone'

    def use(self, bone=None, mat=None, tint=None):
        if bone: self.bone = bone
        if mat: self.mat = mat
        if tint is not None: self.tint = tuple(tint) + ((1,) if len(tint) == 3 else ())
        return self

    def _slot(self, mat):
        m = self.M[mat]
        if m not in self.mats: self.mats.append(m)
        return self.mats.index(m)

    def _tag(self, verts, smooth=True, mat=None, tint=None, bone=None):
        idx = self._slot(mat or self.mat)
        bi = BONES.index(bone or self.bone)
        t = tuple(tint or self.tint)
        if len(t) == 3: t = t + (1,)
        faces = set()
        for v in verts:
            v[self.lb] = bi; v[self.lb2] = bi; v[self.lw] = 0.0; v[self.lc] = t
            faces.update(v.link_faces)
        for f in faces:
            f.material_index = idx; f.smooth = smooth
        return verts

    # primitives -----------------------------------------------------------
    def sphere(self, c, r, scale=(1, 1, 1), rot=None, seg=10, rings=7, **k):
        m = Matrix.Translation(V(c)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*scale, 1))
        out = bmesh.ops.create_uvsphere(self.bm, u_segments=seg, v_segments=rings, radius=r, matrix=m)
        return self._tag(out['verts'], **k)

    def box(self, c, size, rot=None, smooth=False, bevel=0.0, **k):
        m = Matrix.Translation(V(c)) @ (rot or Matrix.Identity(4)) @ Matrix.Diagonal((*size, 1))
        out = bmesh.ops.create_cube(self.bm, size=1.0, matrix=m)
        vs = out['verts']
        if bevel > 0:
            edges = list({e for v in vs for e in v.link_edges})
            res = bmesh.ops.bevel(self.bm, geom=vs + edges, offset=bevel, segments=1, affect='EDGES', profile=0.5)
            vs = list({v for f in res['faces'] for v in f.verts} | set(v for v in vs if v.is_valid))
            vs = [v for v in vs if v.is_valid]
        return self._tag(vs, smooth=smooth, **k)

    def tube(self, pts, r, seg=8, closed=False, flat=(1.0, 1.0), up=None, cap=True, smooth=True, **k):
        """Swept circle/ellipse through pts; r scalar or per-point list; flat scales the (normal, binormal) axes."""
        pts = [V(p) for p in pts]
        rs = r if isinstance(r, (list, tuple)) else [r] * len(pts)
        n = len(pts)
        rings, prev = [], None
        for i, p in enumerate(pts):
            t = (pts[(i + 1) % n] - pts[i - 1]) if closed else (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)])
            t.normalize()
            ref = prev or (V(up) if up else (V((0, 0, 1)) if abs(t.z) < 0.9 else V((1, 0, 0))))
            nrm = (ref - t * ref.dot(t)).normalized()
            prev = nrm
            b = t.cross(nrm)
            rings.append([self.bm.verts.new(p + (nrm * math.cos(a) * flat[0] + b * math.sin(a) * flat[1]) * rs[i])
                          for a in (q * math.tau / seg for q in range(seg))])
        for i in range(n if closed else n - 1):
            r0, r1 = rings[i], rings[(i + 1) % n]
            for q in range(seg):
                self.bm.faces.new((r0[q], r0[(q + 1) % seg], r1[(q + 1) % seg], r1[q]))
        if not closed and cap:
            self.bm.faces.new(rings[0]); self.bm.faces.new(list(reversed(rings[-1])))
        return self._tag([v for ring in rings for v in ring], smooth=smooth, **k)

    def cyl(self, a, b, r1, r2, seg=8, **k):
        return self.tube([a, b], [r1, r2], seg=seg, smooth=k.pop('smooth', True), **k)

    def long_bone(self, a, b, r, flare=0.65, knobs=True, seg=8, bend=0.0, head=None, **k):
        """Tapered shaft that flares at both ends (diaphysis/epiphysis), slight bow, condyle knobs."""
        a, b = V(a), V(b)
        d = (b - a); L = d.length; d.normalize()
        side = d.cross(V((0, 1, 0)))
        if side.length < 0.1: side = d.cross(V((1, 0, 0)))
        side.normalize()
        fwd = side.cross(d).normalized()
        pts, rs = [], []
        for i in range(9):
            t = i / 8
            pts.append(a + d * (L * t) + fwd * (math.sin(math.pi * t) * bend))
            e = abs(2 * t - 1)
            rs.append(r * (0.78 + flare * e ** 3.2))
        self.tube(pts, rs, seg=seg, **k)
        if knobs:
            for end, s in ((a, 1), (b, -1)):
                if head is not None and s == 1:
                    self.sphere(end + d * r * 0.4, r * head, seg=10, rings=7, **k)
                    continue
                for q in (-1, 1):
                    self.sphere(end + d * r * 0.55 * s + side * q * r * 0.55, r * 1.02, scale=(1, 1, 0.9), seg=8, rings=6, **k)

    def prism(self, outline, y0, y1, xf=None, smooth=False, **k):
        """Extrude a 2D outline (u -> x, v -> z) between y0..y1, then apply xf."""
        xf = xf or Matrix.Identity(4)
        front = [self.bm.verts.new(xf @ V((u, y0, v))) for u, v in outline]
        back = [self.bm.verts.new(xf @ V((u, y1, v))) for u, v in outline]
        nn = len(outline)
        self.bm.faces.new(front); self.bm.faces.new(list(reversed(back)))
        for i in range(nn):
            j = (i + 1) % nn
            self.bm.faces.new((front[i], back[i], back[j], front[j]))
        return self._tag(front + back, smooth=smooth, **k)

    def slab(self, outline, y0, y1, xf=None, bulge=0.0, rings=3, **k):
        """Curved plate: outline extruded, front face subdivided into rings and pushed out by bulge (dome)."""
        xf = xf or Matrix.Identity(4)
        cu = sum(u for u, _ in outline) / len(outline); cv = sum(v for _, v in outline) / len(outline)
        maxr = max(math.hypot(u - cu, v - cv) for u, v in outline)
        loops = []
        for i in range(rings + 1):
            s = 1 - i / (rings + 1) * 0.999
            loops.append([(cu + (u - cu) * s, cv + (v - cv) * s) for u, v in outline])
        def dome(u, v):
            q = math.hypot(u - cu, v - cv) / maxr
            return bulge * (1 - q * q)
        F = [[self.bm.verts.new(xf @ V((u, y0 - dome(u, v), v))) for u, v in loop] for loop in loops]
        B = [[self.bm.verts.new(xf @ V((u, y1 - dome(u, v) * 0.9, v))) for u, v in loop] for loop in loops]
        nn = len(outline)
        cF = self.bm.verts.new(xf @ V((cu, y0 - bulge, cv)))
        cB = self.bm.verts.new(xf @ V((cu, y1 - bulge * 0.9, cv)))
        for L, c, rev in ((F, cF, False), (B, cB, True)):
            for i in range(len(L) - 1):
                for j in range(nn):
                    q = (L[i][j], L[i][(j + 1) % nn], L[i + 1][(j + 1) % nn], L[i + 1][j])
                    self.bm.faces.new(q if not rev else tuple(reversed(q)))
            for j in range(nn):
                tri = (L[-1][j], L[-1][(j + 1) % nn], c)
                self.bm.faces.new(tri if not rev else tuple(reversed(tri)))
        for j in range(nn):
            jj = (j + 1) % nn
            self.bm.faces.new((F[0][j], B[0][j], B[0][jj], F[0][jj]))
        vs = [v for L in F + B for v in L] + [cF, cB]
        return self._tag(vs, smooth=k.pop('smooth', True), **k)

    def finish(self, collection, arm):
        bm = self.bm
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        bm.verts.index_update()
        skin = [(BONES[v[self.lb]], BONES[v[self.lb2]], v[self.lw]) for v in bm.verts]
        for layer in (self.lb, self.lb2): bm.verts.layers.int.remove(layer)
        bm.verts.layers.float.remove(self.lw)
        me = bpy.data.meshes.new(self.name)
        bm.to_mesh(me)
        for m in self.mats: me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me)
        collection.objects.link(ob)
        # Rigid skin from the per-vertex joint layers (w2 blends a second joint where a part spans two).
        groups = {b: ob.vertex_groups.new(name=b) for b in BONES if JOINTS[b][3]}
        for i, (n1, n2, w) in enumerate(skin):
            if n1 == n2 or w <= 0: groups[n1].add([i], 1.0, 'REPLACE')
            else:
                groups[n1].add([i], 1 - w, 'REPLACE'); groups[n2].add([i], w, 'REPLACE')
        ob.parent = arm
        mod = ob.modifiers.new('Armature', 'ARMATURE'); mod.object = arm
        bm.free()
        return ob


def blend_bone(part, verts, other, weight_fn):
    """Give verts a second joint with a smooth weight (cloth hems, hood drape)."""
    bi = BONES.index(other)
    for v in verts:
        w = max(0.0, min(1.0, weight_fn(v.co)))
        if w > 0: v[part.lb2] = bi; v[part.lw] = w


# ------------------------------------------------------------------ outlines
def ccw(pts):
    a = sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))
    return pts if a > 0 else list(reversed(pts))


def offset_poly(pts, d):
    n, out = len(pts), []
    for i in range(n):
        p0, p1, p2 = V(pts[i - 1]), V(pts[i]), V(pts[(i + 1) % n])
        e0, e1 = (p1 - p0).normalized(), (p2 - p1).normalized()
        n0, n1 = V((-e0.y, e0.x)), V((-e1.y, e1.x))
        m = n0 + n1
        m = m.normalized() if m.length > 1e-6 else n0
        k = d / max(0.35, m.dot(n0))
        out.append(tuple(p1 + m * k))
    return out


def circle(r, n=24, rx=None):
    rx = rx or r
    return ccw([(rx * math.cos(a), r * math.sin(a)) for a in (i * math.tau / n for i in range(n))])


def kite(w=0.29, top=0.40, bottom=-0.50, n=12):
    right = []
    for i in range(n + 1):
        v = top - 0.08 - (top - 0.08 - bottom) * i / n
        t = max(0.0, (0.14 - v) / (0.14 - bottom))
        right.append((w * (1 - t ** 1.6) ** 0.85 + 0.002, v))
    right[-1] = (0.0, bottom)
    arc = [(w * math.cos(a), top - 0.08 + 0.08 * math.sin(a)) for a in (math.pi / 2 * k / 6 for k in range(1, 6))]
    left = [(-u, v) for u, v in reversed(right[:-1])]
    return ccw(right + left + [(-u, v) for u, v in arc] + [(0, top)] + list(reversed(arc)))


def heater(w=0.27, top=0.33, bottom=-0.40, n=10):
    pts = [(w, top), (-w, top)]
    for i in range(n + 1):
        t = i / n
        a = math.pi * 0.5 * t
        pts.append((-w * math.cos(a) ** 0.9, top - 0.22 - (top - 0.22 - bottom) * math.sin(a)))
    pts = pts[:-1] + [(0, bottom)]
    for i in range(n - 1, -1, -1):
        t = i / n; a = math.pi * 0.5 * t
        pts.append((w * math.cos(a) ** 0.9, top - 0.22 - (top - 0.22 - bottom) * math.sin(a)))
    return ccw(pts)


def rounded_rect(w, h, r, n=4):
    pts = []
    for cx, cy, a0 in ((w - r, h - r, 0), (-w + r, h - r, 90), (-w + r, -h + r, 180), (w - r, -h + r, 270)):
        for k in range(n + 1):
            a = math.radians(a0 + 90 * k / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return ccw(pts)


def leaf(length=0.5, width=0.17, lobes=4, n=40):
    right = []
    for i in range(n + 1):
        t = i / n
        env = math.sin(math.pi * t) ** 0.75 * (0.55 + 0.45 * t)
        lobe = 0.5 + 0.5 * abs(math.cos(t * lobes * math.pi)) ** 0.6
        right.append((width * env * lobe, -length / 2 + length * t))
    base = -length / 2
    pts = [(0.014, base)] + right[1:-1] + [(0, length / 2)] + [(-u, v) for u, v in reversed(right[1:-1])] + [(-0.014, base), (0, base - 0.05)]
    return ccw(pts)


def simple_leaf(length=0.07, width=0.028, n=8):
    pts = []
    for i in range(n + 1):
        t = i / n
        pts.append((width * math.sin(math.pi * t) ** 0.8, -length / 2 + length * t))
    return ccw(pts + [(-u, v) for u, v in reversed(pts[1:-1])])


# ------------------------------------------------------------------ body
BONE_TINT = (1, 1, 1)
HEAD_C = V((0, 0.0, 1.55))


SKULL_R = 0.16
# Cartoon skull (Mitch, 2026-10-04: "keep the goofy cartoonish skull, but polished"): a big round bobble-head with huge
# dark eye sockets, soft brows, a rounded muzzle carrying chunky teeth and a wide hinged jaw. Friendly, not grim.
EYES = [V((s * 0.47, -0.86, 0.13)).normalized() for s in (-1, 1)]
NOSE = V((0, -0.97, -0.16)).normalized()
MUZZLE = V((0, -0.86, -0.5)).normalized()
EYE_RX, EYE_RY, EYE_TILT = 0.4, 0.37, 0.2  # socket half-angles (radians) and the droop of the outer corner
UPPER_EL, LOWER_EL, SMILE = -0.42, -0.6, 0.09  # elevation (sin) of the upper teeth and the jaw bar; the corners lift


def _g(d, c, w):
    """Smooth angular bump on the unit sphere: 1 at c, falling off with angular width ~sqrt(2w)."""
    return math.exp(-(1 - d.dot(c)) / w)


def eye_frame(e):
    side = V((1 if e.x >= 0 else -1, 0, 0))
    side = (side - e * side.dot(e)).normalized()
    up = e.cross(side).normalized()
    if up.z < 0: up = -up
    return side, up


def eye_r(d, e):
    """Elliptical socket coordinate: <1 inside the socket. The outer corner droops for a goofy, hangdog look."""
    side, up = eye_frame(e)
    if d.dot(e) <= 0: return 9.0
    u, v = d.dot(side), d.dot(up)
    c, s = math.cos(EYE_TILT), math.sin(EYE_TILT)
    u, v = u * c + v * s, -u * s + v * c
    return math.hypot(u / math.sin(EYE_RX), v / math.sin(EYE_RY))


def face_dir(a, el):
    """Direction across the face: azimuth a from straight ahead (-Y), elevation given as sin."""
    ce = math.sqrt(1 - el * el)
    return V((math.sin(a) * ce, -math.cos(a) * ce, el))


def skull_point(d, carve_on=True, extra=0.0):
    """Cranium surface along unit direction d: returns (position, carve depth, mouth shade)."""
    d = d.normalized()
    x, y, z = d
    m = 1.0 + extra
    sx, sy, sz = 1.0, 0.97, 0.98
    if z < -0.45:  # the base tucks under, so the head sits on the neck like a ball on a stick
        q = min(1.0, (-0.45 - z) / 0.55)
        sx *= 1 - 0.16 * q; sy *= 1 - 0.06 * q
    m += 0.06 * _g(d, MUZZLE, 0.06)  # rounded muzzle carrying the top teeth
    m += 0.02 * math.exp(-((y - 0.75) ** 2 + (z - 0.2) ** 2) / 0.2)  # full back of the head
    for e in EYES:
        side, up = eye_frame(e)
        brow = (e * math.cos(0.47) + (up * 0.95 - side * 0.3).normalized() * math.sin(0.47)).normalized()
        cheek = (e * math.cos(0.46) + (-up * 0.75 + side * 0.65).normalized() * math.sin(0.46)).normalized()
        m += 0.03 * _g(d, cheek, 0.01)
    carve = 0.0
    if carve_on:
        for e in EYES:
            r = eye_r(d, e)  # the cranium falls away under the socket bowl (build_skull), which owns the crisp rim
            t = min(1.0, max(0.0, (0.95 - r) / 0.1))
            carve = max(carve, 0.32 * t * t * (3 - 2 * t))
        carve = max(carve, 0.05 * _g(d, NOSE, 0.004))
    m -= carve
    # mouth: the band behind the teeth, dark so an open jaw shows a mouth rather than more bone
    a = math.atan2(x, -y)
    lift = SMILE * (a / 0.85) ** 2
    mouth = 1.0 if (abs(a) < 1.0 and LOWER_EL + lift - 0.02 < z < UPPER_EL + lift - 0.035) else 0.0
    return HEAD_C + V((x * sx, y * sy, z * sz)) * (SKULL_R * m), carve, mouth


def around(e, rho, phi):
    """Direction at angle rho from axis e, at azimuth phi (0 = outward/lateral, pi/2 = up)."""
    side, up = eye_frame(e)
    return (e * math.cos(rho) + (side * math.cos(phi) + up * math.sin(phi)) * math.sin(rho)).normalized()


def chiclet(P, c, w, d, h, yaw, tilt=0.0, tint=(0.97, 0.94, 0.85)):
    """One rounded cartoon tooth: a soft pillow (superellipsoid), slightly narrower at the root."""
    out = bmesh.ops.create_uvsphere(P.bm, u_segments=8, v_segments=6, radius=1.0)
    rot = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'X')
    sq = lambda t: math.copysign(abs(t) ** 0.5, t)
    vs = []
    for v in out['verts']:
        q = v.co
        v.co = V(c) + rot @ V((sq(q.x) * w, sq(q.y) * d, sq(q.z) * h))
        vs.append(v)
    P._tag(vs, tint=tint)


def tooth_row(P, el, n, span, h, up, skip=(), odd=None, sink=0.006):
    """Chunky teeth sitting on the face surface along elevation el; up=True hangs them from the upper jaw."""
    for i in range(n):
        if i in skip: continue
        u = (i - (n - 1) / 2) / ((n - 1) / 2)
        a = u * span
        d = face_dir(a, el + SMILE * u * u)
        p = skull_point(d, carve_on=False)[0]
        nrm = (p - HEAD_C).normalized()
        w = 0.0135 * (1.1 - 0.25 * abs(u))
        hh = h * (1.0 - 0.2 * abs(u)) * (1.2 if odd == i else 1.0)
        centre = p - nrm * sink + V((0, 0, -hh * 0.55 if up else hh * 0.55))
        tint = (0.99, 0.96, 0.88) if odd != i else (0.88, 0.8, 0.6)
        chiclet(P, centre, w, 0.0095, hh, a, tilt=-0.12 if up else 0.1, tint=tint)


def build_skull(P):
    """Big round cartoon skull: deep dark sockets with a pinpoint glow, soft brows and cheeks, heart nose, chunky teeth."""
    P.use(bone='Head', mat='bone', tint=BONE_TINT)
    c = HEAD_C
    out = bmesh.ops.create_uvsphere(P.bm, u_segments=52, v_segments=34, radius=1.0)
    verts = out['verts']
    shade = {}
    for v in verts:
        p, carve, mouth = skull_point(v.co)
        shade[v] = (carve, mouth)
        v.co = p
    P._tag(verts)
    for v in verts:  # crisp near-black sockets like the old cartoon skull; nose and mouth are warm shadow
        carve, mouth = shade[v]
        t = min(1.0, max(0.0, (carve - 0.02) / 0.06))
        k = 1 - (t * t * (3 - 2 * t)) * 0.97
        k = min(k, 1 - 0.9 * mouth)
        v[P.lc] = (k, k * 0.95, k * 0.88, 1)
    for e in EYES:
        socket_bowl(P, e)
        # a heavy cartoon brow ridge, low over the inner corner: grumpy-goofy, like the old skull's brow bars
        side, up = eye_frame(e)
        brow = [skull_point(around(e, 0.5 + 0.06 * abs(t), math.pi / 2 + t * 0.85 + 0.12), carve_on=False)[0] for t in np.linspace(-1, 1, 9)]
        P.tube(brow, [0.007 + 0.009 * math.cos(t * 1.2) for t in np.linspace(-1, 1, 9)], seg=8, flat=(0.8, 1.15))
        # a small warm pupil of light deep in each socket (own material: the game tints and pulses it)
        p = skull_point(e, carve_on=False)[0]
        P.sphere(c + (p - c) * 0.8, 0.0115, scale=(1, 0.5, 1.15), seg=10, rings=7, mat='glow')
    # nose: an inverted heart set into the face (dark inset)
    nos = ccw([(0.0, 0.0), (0.023, 0.016), (0.03, 0.043), (0.014, 0.064), (0.0, 0.053), (-0.014, 0.064), (-0.03, 0.043), (-0.023, 0.016)])
    np_ = skull_point(NOSE, carve_on=False)[0]
    P.prism(nos, -0.004, 0.02, xf=Matrix.Translation(np_ + V((0, -0.002, -0.03))) @ Matrix.Rotation(-0.3, 4, 'X'), smooth=True, tint=(0.12, 0.09, 0.07))
    # upper teeth in a slight smile along the muzzle; one is a little long and yellowed
    tooth_row(P, UPPER_EL, 8, 0.8, 0.019, True, odd=5, sink=0.001)
    # cervical vertebrae under the skull
    for k in range(3):
        z = 1.405 + k * 0.03
        P.cyl((0, 0.035, z - 0.011), (0, 0.035, z + 0.011), 0.024, 0.024, seg=8)
        P.box((0, 0.067, z), (0.016, 0.03, 0.016), bevel=0.004)


def socket_bowl(P, e, n=32, rings=5):
    """A smooth dark bowl for the eye: crisp elliptical rim (n points) curling into a deep, near-black hollow."""
    c = HEAD_C
    grid = []
    for i in range(rings + 1):
        r = 1.0 - i / rings * 0.995
        depth = 0.004 - 0.62 * (1 - r) ** 1.6 - 0.02 * (1 - r)  # lip sits just proud of the dome, then dives
        k = 1.0 if i == 0 else max(0.04, 0.14 - i * 0.06)
        ring = []
        for d in socket_outline(e, r, n):
            p = skull_point(d, carve_on=False)[0]
            v = P.bm.verts.new(c + (p - c) * (1 + depth))
            v[P.lc] = (k, k * 0.95, k * 0.88, 1)
            ring.append(v)
        grid.append(ring)
    for i in range(rings):
        for j in range(n):
            P.bm.faces.new((grid[i][j], grid[i][(j + 1) % n], grid[i + 1][(j + 1) % n], grid[i + 1][j]))
    cen = P.bm.verts.new(sum((v.co for v in grid[-1]), V()) / n)
    for j in range(n): P.bm.faces.new((grid[-1][j], grid[-1][(j + 1) % n], cen))
    vs = [v for ring in grid for v in ring] + [cen]
    cols = {v: tuple(v[P.lc]) for v in vs[:-1]}
    P._tag(vs)
    for v, col in cols.items(): v[P.lc] = col
    cen[P.lc] = (0.05, 0.047, 0.044, 1)


def socket_outline(e, r, n):
    side, up = eye_frame(e)
    c, s = math.cos(EYE_TILT), math.sin(EYE_TILT)
    out = []
    for k in range(n):
        t = k / n * math.tau
        u, v = math.cos(t) * math.sin(EYE_RX) * r, math.sin(t) * math.sin(EYE_RY) * r
        u, v = u * c - v * s, u * s + v * c
        out.append((e * math.sqrt(max(0.0, 1 - u * u - v * v)) + side * u + up * v).normalized())
    return out


def build_jaw(P):
    """Wide cartoon mandible on its own joint (HeadJaw) so the game can chatter, gape and clack it."""
    P.use(bone='HeadJaw', mat='bone')
    c = HEAD_C
    pts, rs = [], []
    for a in np.linspace(-1.08, 1.08, 15):
        p = skull_point(face_dir(a, LOWER_EL + SMILE * (a / 0.85) ** 2 * 0.9), carve_on=False, extra=0.006 + 0.03 * math.cos(a) ** 2)[0]
        pts.append(p); rs.append(0.0095 + 0.006 * math.cos(a) ** 2)
    P.tube(pts, rs, seg=10, flat=(1.3, 0.75), up=(0, 0, 1))
    chin = skull_point(face_dir(0, LOWER_EL - 0.05), carve_on=False, extra=0.07)[0]
    P.sphere(chin, 0.022, scale=(1.5, 0.75, 0.8), seg=12, rings=8)  # round chin
    for end in (pts[0], pts[-1]):  # rounded condyles where the jaw tucks into the cheeks
        P.sphere(end, 0.0115, scale=(1, 1, 0.9), seg=8, rings=6)
    # lower teeth meet the upper row when the mouth is shut (one gap for character)
    tooth_row(P, LOWER_EL + 0.04, 8, 0.76, 0.013, False, skip=(2,), sink=0.0)


def build_torso(P):
    P.use(bone='Torso', mat='bone')
    # spine: lumbar + thoracic vertebrae with spinous processes
    for k in range(11):
        z = 0.99 + k * 0.038
        bend = 0.018 * math.sin((k / 10) * math.pi)  # gentle thoracic curve
        y = 0.05 + bend
        P.cyl((0, y, z - 0.013), (0, y, z + 0.013), 0.024 - k * 0.0006, 0.024 - k * 0.0006, seg=8)
        P.box((0, y + 0.035, z - 0.004), (0.016, 0.04, 0.018), rot=Matrix.Rotation(-0.35, 4, 'X'), bevel=0.004, smooth=True)
        P.box((0, y + 0.01, z), (0.045 - k * 0.001, 0.012, 0.01), bevel=0.003, smooth=True)
    # ribs: elliptical cross-section; each sweeps back->side->front and slopes down; upper five meet the sternum
    for i in range(7):
        z = 1.335 - i * 0.046
        w = (0.125 + 0.03 * math.sin((i + 1) / 7 * math.pi)) * (1 - 0.04 * max(0, i - 4))
        back, front = 0.06, -0.105 + 0.004 * i
        span = 1.0 if i < 5 else 0.72
        for s_ in (-1, 1):
            pts = []
            for k in range(9):
                t = k / 8 * span
                a = math.pi * t
                x = s_ * (0.02 + w * math.sin(a) ** 0.85 * (1 - 0.15 * t))
                y = back + (front - back) * (1 - math.cos(a)) / 2
                zz = z - 0.022 * t ** 1.3 + 0.008 * math.sin(a)
                pts.append((x, y, zz))
            if i < 5:
                pts.append((s_ * 0.024, front - 0.008, pts[-1][2] - 0.012))
            P.tube(pts, 0.0085, seg=6, flat=(0.6, 1.0), up=(0, 0, 1))
    P.tube([(0, -0.118, 1.355), (0, -0.122, 1.27), (0, -0.112, 1.15)], [0.017, 0.015, 0.008], seg=6, flat=(0.45, 1))  # sternum
    P.box((0, -0.115, 1.36), (0.05, 0.016, 0.035), bevel=0.006, smooth=True)
    for s in (-1, 1):
        # clavicles to the shoulder
        P.tube([(s * 0.02, -0.11, 1.375), (s * 0.1, -0.085, 1.39), (s * 0.175, -0.01, 1.385)], [0.011, 0.012, 0.012], seg=6)
        # scapulae on the back
        P.tube([(s * 0.05, 0.095, 1.335), (s * 0.1, 0.085, 1.33), (s * 0.13, 0.06, 1.35)], [0.008, 0.009, 0.01], seg=5, flat=(0.6, 1))  # scapular spine
        P.sphere((s * 0.175, 0.03, 1.36), 0.03, scale=(1, 1, 0.9))  # shoulder socket
    # pelvis (Root): sacrum, iliac wings, pubic arch, hip sockets
    P.use(bone='Root')
    P.tube([(0, 0.085, 1.0), (0, 0.095, 0.93), (0, 0.07, 0.87)], [0.035, 0.03, 0.015], seg=7, flat=(1.4, 0.6))
    for s in (-1, 1):
        crest = [(s * 0.045, 0.075, 0.985), (s * 0.11, 0.06, 1.0), (s * 0.145, 0.0, 0.99), (s * 0.125, -0.045, 0.955)]
        P.tube(crest, [0.012, 0.014, 0.013, 0.011], seg=6, flat=(0.7, 1))
        P.tube([(s * 0.11, 0.02, 0.87), (s * 0.08, -0.04, 0.83), (s * 0.02, -0.06, 0.83)], [0.016, 0.014, 0.013], seg=6)
        P.sphere((s * 0.105, 0.015, 0.86), 0.03)
    P.tube([(0.03, 0.03, 0.97), (0, 0.035, 0.965), (-0.03, 0.03, 0.97)], 0.02, seg=6)


def build_loincloth(P):
    """Belt, tabard flaps and a hip pouch; Cloth takes the variant's colour, leather is vertex-tinted."""
    P.use(bone='Root', mat='cloth', tint=(1, 1, 1))
    leather = (0.36, 0.25, 0.17)
    pts = [(0.15 * math.cos(a), 0.035 + 0.1 * math.sin(a), 0.925 - 0.012 * math.sin(a)) for a in np.linspace(0, math.tau, 20, endpoint=False)]
    P.tube(pts, 0.017, seg=6, closed=True, flat=(0.5, 1.3), tint=leather)
    P.box((0.0, -0.07, 0.925), (0.045, 0.012, 0.04), mat='cloth', tint=(0.55, 0.5, 0.42), bevel=0.004, smooth=True)
    # flaps: front and back, curved, ragged hem; hem blends toward the thighs so walking drapes it
    for yy, w, L, side_bone in ((-0.072, 0.115, 0.34, None), (0.125, 0.11, 0.30, None)):
        hem = [(w, 0.0)]
        for k in range(11):
            u = w - 2 * w * k / 10
            hem.append((u * (1 + 0.15 * (k / 10)), -L - (0.045 if k % 2 else 0.0) - 0.02 * math.sin(k * 2.1)))
        hem.append((-w, 0.0))
        outline = ccw(hem)
        # bend: front flap bows forward over the thighs
        vs = P.prism(outline, -0.004, 0.004, xf=Matrix.Translation((0, yy, 0.92)), smooth=True)
        for v in vs:
            drop = 0.92 - v.co.z
            v.co.y += (-1 if yy < 0 else 1) * 0.06 * drop / 0.34 - (0.02 if yy < 0 else -0.02) * (v.co.x / 0.12) ** 2
        for v in vs:
            v[P.lc] = (1, 1, 1, 1)
        blend_bone(P, [v for v in vs if v.co.x < -0.01], 'LeftLeg', lambda co: (0.9 - co.z) / 0.5)
        blend_bone(P, [v for v in vs if v.co.x > 0.01], 'RightLeg', lambda co: (0.9 - co.z) / 0.5)
    # pouch on the hip
    P.use(tint=leather)
    P.sphere((0.15, -0.01, 0.88), 0.045, scale=(0.55, 0.9, 1.1), seg=8, rings=6, mat='cloth')
    P.box((0.15, -0.012, 0.92), (0.05, 0.075, 0.02), mat='cloth', bevel=0.005, smooth=True)


def build_arm(P, side):
    s = -1 if side == 'Left' else 1
    pre = side
    P.use(bone=pre + 'Arm', mat='bone', tint=BONE_TINT)
    sh, el, wr = J[pre + 'Arm'], J[pre + 'Forearm'], J[pre + 'Hand']
    P.long_bone(sh + V((0, 0, -0.02)), el + V((0, 0, 0.015)), 0.019, head=1.55, bend=0.006)
    P.use(bone=pre + 'Forearm')
    side_v = V((s, 0, 0))
    P.long_bone(el + V((0, 0, -0.012)) + side_v * 0.008, wr + V((0, 0, 0.01)) + side_v * 0.01, 0.0135, knobs=False, seg=7)  # radius
    P.long_bone(el + V((0, 0.018, -0.005)) - side_v * 0.006, wr + V((0, 0.01, 0.012)) - side_v * 0.006, 0.012, knobs=False, seg=7)  # ulna
    P.sphere(el + V((0, 0.02, 0.0)), 0.022, scale=(1, 1, 0.9))  # elbow (olecranon)
    build_hand(P, pre, s)


def build_hand(P, pre, s):
    """Carpals, metacarpals, curled 3-segment fingers and a thumb. The shield hand closes on the grip."""
    P.use(bone=pre + 'Hand')
    wr = J[pre + 'Hand']
    P.sphere(wr + V((0, 0, -0.022)), 0.026, scale=(1.0, 0.75, 0.9), seg=8, rings=6)
    curl = 1.25 if pre == 'Left' else 0.95
    for f in range(4):
        y = -0.024 + f * 0.016
        base = wr + V((s * 0.006, y, -0.04))
        tip = base + V((s * 0.004, -0.002, -0.05))
        P.cyl(base, tip, 0.0075, 0.0068, seg=5)
        # phalanges curling inward (toward -Y palm side then up)
        p = tip
        ang = 0.0
        lens = (0.03, 0.022, 0.017)
        for k, ln in enumerate(lens):
            ang += curl * (0.45 + 0.2 * k)
            d = V((0, -math.sin(ang), -math.cos(ang)))
            q = p + d * ln
            P.cyl(p, q, 0.0066 - k * 0.0008, 0.0058 - k * 0.0008, seg=5)
            p = q
    tb = wr + V((s * 0.012, -0.03, -0.03))
    t1 = tb + V((s * 0.012, -0.025, -0.025)); t2 = t1 + V((0, -0.02, -0.02))
    P.cyl(tb, t1, 0.008, 0.007, seg=6); P.cyl(t1, t2, 0.007, 0.006, seg=6); P.sphere(t2, 0.0065, seg=6, rings=4)


def build_leg(P, side):
    s = -1 if side == 'Left' else 1
    P.use(bone=side + 'Leg', mat='bone', tint=BONE_TINT)
    hip, kn, an = J[side + 'Leg'], J[side + 'Knee'], J[side + 'Foot']
    P.sphere(hip + V((-s * 0.006, 0, 0.002)), 0.03)  # femoral head
    P.tube([hip, hip + V((s * 0.03, 0.0, -0.035))], 0.016, seg=7)  # neck to the shaft
    P.long_bone(hip + V((s * 0.03, 0, -0.045)), kn + V((0, 0, 0.022)), 0.022, bend=0.01)
    P.use(bone=side + 'Knee')
    P.sphere(kn + V((0, -0.03, 0.0)), 0.023, scale=(1.1, 0.7, 1.15))  # kneecap
    P.long_bone(kn + V((0, 0, -0.012)), an + V((0, 0, 0.022)), 0.019, flare=0.8, seg=8)  # tibia
    P.cyl(kn + V((s * 0.03, 0.012, -0.04)), an + V((s * 0.028, 0.012, 0.02)), 0.009, 0.008, seg=6)  # fibula
    P.use(bone=side + 'Foot')
    P.sphere(an + V((0, 0.035, -0.04)), 0.03, scale=(0.9, 1.25, 0.85), seg=8, rings=6)  # heel
    P.sphere(an + V((0, -0.015, -0.035)), 0.034, scale=(1.25, 1.2, 0.7), seg=8, rings=6)  # tarsals
    for k in range(5):
        x = an.x + s * (-0.03 + k * 0.016)
        a = V((x, -0.045, -0.04))
        b = V((x + s * 0.003 * (k - 2), -0.115 - 0.01 * (2 - abs(k - 2)) * 0.5, -0.07))
        a.z += an.z; b.z += an.z
        P.cyl(a, b, 0.0085, 0.0075, seg=5)
        P.sphere(b, 0.0092, seg=5, rings=4)
        c = b + V((0, -0.024, -0.006))
        P.cyl(b, c, 0.0075, 0.0062, seg=5)


# ------------------------------------------------------------------ gear (variant pieces)


def gear_moss_cap(P):
    """Mossward: moss cushion over the crown, a red toadstool and a curled sprout (the original's silhouette)."""
    P.use(bone='Head', mat='fabric', tint=(0.22, 0.36, 0.1))
    out = bmesh.ops.create_uvsphere(P.bm, u_segments=20, v_segments=10, radius=1.0)
    vs = []
    for v in out['verts']:
        d = v.co.normalized()
        if d.z < 0.25:
            d.z = 0.25 + (d.z - 0.25) * 0.15
        n = 1 + 0.12 * math.sin(d.x * 9) * math.sin(d.y * 7)
        v.co = HEAD_C + V((d.x * 0.15, d.y * 0.16 + 0.015, (d.z - 0.25) * 0.11 + 0.11)) * n
        vs.append(v)
    P._tag(vs)
    for v in vs:
        g = 0.75 + 0.25 * math.sin(v.co.x * 60) * math.cos(v.co.y * 50)
        v[P.lc] = (0.2 * g, 0.36 * g, 0.1 * g, 1)
    for i, (x, y) in enumerate([(-0.11, -0.04), (0.12, 0.02), (0.05, 0.12), (-0.07, 0.1), (0.0, -0.1)]):
        P.sphere(HEAD_C + V((x, y, 0.07 + 0.04 * math.cos(i))), 0.04, scale=(1, 1, 0.55), seg=8, rings=5, tint=(0.28, 0.42, 0.12))
    # toadstool
    P.use(tint=(0.88, 0.84, 0.72))
    P.cyl(HEAD_C + V((0.07, 0.03, 0.12)), HEAD_C + V((0.085, 0.035, 0.19)), 0.012, 0.01, seg=7)
    cap = P.sphere(HEAD_C + V((0.087, 0.036, 0.19)), 0.042, scale=(1, 1, 0.5), seg=12, rings=6, tint=(0.62, 0.12, 0.05))
    for k in range(5):
        a = k * 1.3
        P.sphere(HEAD_C + V((0.087 + 0.027 * math.cos(a), 0.036 + 0.027 * math.sin(a), 0.205)), 0.007, scale=(1, 1, 0.5), seg=6, rings=4, tint=(0.95, 0.9, 0.8))
    # sprout
    P.use(tint=(0.3, 0.5, 0.15))
    st = [HEAD_C + V((-0.04, 0.02, 0.13)), HEAD_C + V((-0.05, 0.015, 0.18)), HEAD_C + V((-0.035, 0.0, 0.215)), HEAD_C + V((-0.012, -0.012, 0.225))]
    P.tube(st, [0.006, 0.005, 0.004, 0.0035], seg=5)
    for side, rot in ((1, 0.6), (-1, -0.7)):
        xf = Matrix.Translation(st[-1]) @ Matrix.Rotation(rot, 4, 'Y') @ Matrix.Translation((side * 0.02, 0, 0.01))
        P.slab(simple_leaf(0.05, 0.016), -0.002, 0.002, xf=xf @ Matrix.Rotation(math.pi / 2 * side, 4, 'Y'), bulge=0.004, rings=1)


def gear_iron_helm(P):
    """Rustguard: dented iron kettle-helm with a brim and a stub of nasal bar, worn high so the big eyes show."""
    P.use(bone='Head', mat='iron', tint=(1, 1, 1))
    out = bmesh.ops.create_uvsphere(P.bm, u_segments=24, v_segments=12, radius=1.0)
    vs = []
    for v in out['verts']:
        d = v.co.normalized()
        z = max(d.z, -0.05)
        dent = 1 - 0.06 * math.exp(-((d.x - 0.5) ** 2 + (d.y + 0.3) ** 2 + (d.z - 0.6) ** 2) / 0.05)
        v.co = HEAD_C + V((d.x * 0.165, d.y * 0.175, z * 0.155 + 0.075)) * dent
        vs.append(v)
    P._tag(vs, smooth=True)
    P.tube([HEAD_C + V((0.19 * math.cos(a), 0.2 * math.sin(a) + 0.005, 0.08 - 0.012 * math.cos(a * 2))) for a in np.linspace(0, math.tau, 24, endpoint=False)],
           0.012, seg=6, closed=True, flat=(2.6, 0.5), up=(0, 0, 1))  # brim
    P.box(HEAD_C + V((0, -0.182, 0.07)), (0.02, 0.012, 0.06), rot=Matrix.Rotation(-0.25, 4, 'X'), bevel=0.004, smooth=True)  # nasal
    for a in np.linspace(0, math.tau, 10, endpoint=False):
        P.sphere(HEAD_C + V((0.168 * math.cos(a), 0.176 * math.sin(a), 0.105)), 0.008, seg=6, rings=4)


def drape(P, rows, cols=22, ragged=0.0, seed=1):
    """Cloth surface of revolution. rows: [(z, radius, back_offset, open_angle)] top to bottom; azimuth 0 faces front (-Y).
    open_angle leaves the front open (a hood's face hole); 0 closes the ring. Returns the rows of verts."""
    grid = []
    for i, (z, r, yoff, a0) in enumerate(rows):
        ring = []
        closed = a0 <= 0
        n = cols if closed else cols + 1
        for k in range(n):
            a = (k / cols) * math.tau if closed else a0 + (math.tau - 2 * a0) * k / cols
            zz = z
            if i == len(rows) - 1 and ragged:
                zz -= ragged * (0.5 + 0.5 * math.sin(k * 2.7 + seed)) * (1 if k % 2 else 0.4)
            ring.append(P.bm.verts.new((math.sin(a) * r, -math.cos(a) * r * 1.04 + yoff, zz)))
        grid.append((ring, closed))
    for i in range(len(grid) - 1):
        (r0, closed), (r1, _) = grid[i], grid[i + 1]
        n = len(r0)
        for k in range(n if closed else n - 1):
            P.bm.faces.new((r0[k], r1[k], r1[(k + 1) % n], r0[(k + 1) % n]))
    vs = [v for ring, _ in grid for v in ring]
    P._tag(vs)
    return [ring for ring, _ in grid]


def gear_hood(P):
    """Thornhood: a deep, peaked cloth hood framing the face, its mantle falling onto the shoulders, a thorn circlet."""
    P.use(bone='Head', mat='fabric', tint=(0.34, 0.3, 0.24))
    cz = HEAD_C.z
    rows = [(cz + 0.215, 0.015, 0.1, 0.0), (cz + 0.2, 0.08, 0.075, 0.0), (cz + 0.17, 0.14, 0.05, 0.25), (cz + 0.12, 0.178, 0.03, 0.5),
            (cz + 0.05, 0.19, 0.02, 0.62), (cz - 0.03, 0.188, 0.025, 0.66), (cz - 0.1, 0.17, 0.035, 0.6), (cz - 0.15, 0.17, 0.04, 0.5),
            (cz - 0.19, 0.22, 0.03, 0.45), (cz - 0.23, 0.27, 0.025, 0.42)]
    grid = drape(P, rows, cols=22, ragged=0.04)
    vs = [v for ring in grid for v in ring]
    for v in vs:
        n = 0.78 + 0.22 * math.sin(v.co.z * 70 + v.co.x * 40)
        inner = 1.0
        v[P.lc] = (0.34 * n * inner, 0.3 * n * inner, 0.23 * n * inner, 1)
    blend_bone(P, vs, 'Torso', lambda co: (cz - 0.12 - co.z) / 0.08)
    # thorn twig circlet across the brow
    P.use(mat='wood', tint=(0.45, 0.36, 0.28))
    tw = [HEAD_C + V((0.178 * math.sin(a), -0.178 * math.cos(a) * 1.05, 0.105 + 0.015 * math.sin(a * 5))) for a in np.linspace(-1.3, 1.3, 10)]
    P.tube(tw, 0.007, seg=5)
    for k, p in enumerate(tw[1:-1]):
        d = (p - HEAD_C); d.z = 0; d.normalize()
        P.cyl(p, p + d * 0.03 + V((0, 0, 0.02 if k % 2 else -0.004)), 0.004, 0.0005, seg=4)


def gear_bare_cracks(P):
    """Old Bones: no hat; a cracked crown (dark inset seams) and a chipped brow, plus a bit of lichen."""
    P.use(bone='Head', mat='bone', tint=(0.32, 0.27, 0.2))
    crack = [HEAD_C + V((0.03, -0.06, 0.15)), HEAD_C + V((0.06, -0.02, 0.145)), HEAD_C + V((0.05, 0.03, 0.15)), HEAD_C + V((0.09, 0.07, 0.125)), HEAD_C + V((0.12, 0.09, 0.09))]
    P.tube(crack, 0.0045, seg=4)
    P.tube([HEAD_C + V((0.06, -0.02, 0.145)), HEAD_C + V((0.1, -0.05, 0.12)), HEAD_C + V((0.13, -0.06, 0.08))], 0.004, seg=4)
    P.use(mat='fabric', tint=(0.55, 0.6, 0.35))
    for x, y, z in ((-0.1, 0.06, 0.11), (-0.12, 0.0, 0.1), (-0.08, 0.1, 0.1)):
        P.sphere(HEAD_C + V((x, y, z)), 0.028, scale=(1, 1, 0.35), seg=7, rings=4)


def gear_flower_crown(P):
    """Bloomcaller: a woven vine crown of white daisies and leaves."""
    P.use(bone='Head', mat='fabric', tint=(0.25, 0.42, 0.12))
    ring = [HEAD_C + V((0.158 * math.cos(a), 0.165 * math.sin(a), 0.08 + 0.012 * math.sin(a * 3))) for a in np.linspace(0, math.tau, 20, endpoint=False)]
    P.tube(ring, 0.009, seg=5, closed=True)
    for k in range(9):
        a = k / 9 * math.tau + 0.2
        p = HEAD_C + V((0.163 * math.cos(a), 0.17 * math.sin(a), 0.095))
        out = (p - HEAD_C); out.z = 0; out.normalize()
        rot = out.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        if k % 3 == 1:
            P.slab(simple_leaf(0.06, 0.02), -0.002, 0.002, xf=Matrix.Translation(p) @ rot @ Matrix.Rotation(0.4, 4, 'X'), bulge=0.003, rings=1, tint=(0.3, 0.5, 0.15))
            continue
        tilt = Matrix.Translation(p) @ Matrix.Rotation(math.atan2(out.y, out.x) - math.pi / 2, 4, 'Z') @ Matrix.Rotation(-1.0, 4, 'X')
        daisy = ccw([((0.02 if q % 2 == 0 else 0.007) * math.cos(q * math.pi / 8), (0.02 if q % 2 == 0 else 0.007) * math.sin(q * math.pi / 8)) for q in range(16)])
        P.prism(daisy, -0.0015, 0.0015, xf=tilt @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Rotation(math.pi / 2, 4, 'X'), tint=(0.95, 0.93, 0.86))
        P.sphere(tilt @ V((0, -0.003, 0)), 0.008, scale=(1, 0.6, 1), seg=6, rings=4, tint=(0.95, 0.72, 0.15))


def gear_antlers(P):
    """Antlerbound: weathered antlers lashed to the skull and a fur mantle on the shoulders."""
    P.use(bone='Head', mat='bone', tint=(0.78, 0.68, 0.52))
    for s in (-1, 1):
        base = HEAD_C + V((s * 0.09, 0.02, 0.11))
        main = [base, base + V((s * 0.05, 0.02, 0.05)), base + V((s * 0.11, 0.05, 0.075)), base + V((s * 0.17, 0.09, 0.085)), base + V((s * 0.215, 0.13, 0.08))]
        P.tube(main, [0.017, 0.014, 0.012, 0.009, 0.005], seg=6)
        for i, (k, d) in enumerate(((1, V((0, -0.04, 0.07))), (2, V((s * 0.02, -0.02, 0.075))), (3, V((s * 0.03, 0.0, 0.06))))):
            p = main[k]
            P.tube([p, p + d * 0.6 + V((0, 0, 0.005)), p + d], [0.009 - i * 0.001, 0.007 - i * 0.001, 0.003], seg=5)
        P.sphere(base, 0.024, scale=(1, 1, 0.7), seg=8, rings=5)  # burr
    P.use(bone='Torso', mat='fabric', tint=(0.36, 0.27, 0.19))
    rows = [(1.43, 0.085, 0.035, 0.0), (1.415, 0.15, 0.03, 0.0), (1.39, 0.23, 0.025, 0.0), (1.35, 0.27, 0.02, 0.0), (1.3, 0.275, 0.02, 0.0)]
    grid = drape(P, rows, cols=26, ragged=0.05, seed=3)
    for v in (v for ring in grid for v in ring):
        n = 0.7 + 0.3 * math.sin(v.co.x * 90) * math.sin(v.co.y * 70 + v.co.z * 40)
        v[P.lc] = (0.36 * n, 0.27 * n, 0.19 * n, 1)
    P.use(mat='bone', tint=(0.9, 0.85, 0.72))
    for s in (-1, 1):
        P.cyl((s * 0.06, -0.16, 1.36), (s * 0.03, -0.17, 1.30), 0.01, 0.003, seg=5)  # claw toggles


def gear_moss_rag(P):
    """Mossward: a moss cushion grown over the shield-side shoulder, trailing a vine down the collarbone."""
    P.use(bone='Torso', mat='fabric', tint=(0.27, 0.4, 0.15))
    for i, (x, y, z, r) in enumerate(((-0.17, 0.02, 1.4, 0.05), (-0.13, -0.03, 1.395, 0.04), (-0.2, 0.06, 1.385, 0.04), (-0.1, 0.05, 1.39, 0.035))):
        vs = P.sphere((x, y, z), r, scale=(1, 1, 0.5), seg=9, rings=5)
        for v in vs:
            g = 0.8 + 0.2 * math.sin(v.co.x * 80 + i) * math.cos(v.co.y * 60)
            v[P.lc] = (0.22 * g, 0.38 * g, 0.12 * g, 1)
    P.tube([(-0.08, -0.08, 1.385), (-0.05, -0.115, 1.34), (-0.07, -0.125, 1.27), (-0.045, -0.125, 1.2)], 0.005, seg=5, tint=(0.25, 0.42, 0.12))
    for p, r in (((-0.05, -0.12, 1.34), 0.6), ((-0.065, -0.13, 1.25), -0.5)):
        P.slab(simple_leaf(0.045, 0.016), -0.002, 0.002, xf=Matrix.Translation(p) @ Matrix.Rotation(math.pi / 2, 4, 'X') @ Matrix.Rotation(r, 4, 'Y') @ Matrix.Translation((0, 0, 0.02)), bulge=0.003, rings=1, tint=(0.3, 0.5, 0.15))


def gear_pauldron(P):
    """Rustguard: one riveted iron pauldron on the strike arm and a forearm bracer."""
    P.use(bone='RightArm', mat='iron', tint=(1, 1, 1))
    sh = J['RightArm']
    for i in range(3):
        out = bmesh.ops.create_uvsphere(P.bm, u_segments=14, v_segments=7, radius=1.0)
        vs = []
        for v in out['verts']:
            d = v.co.normalized()
            z = max(d.z, 0.0)
            v.co = sh + V((0.02 + d.x * 0.085, d.y * 0.09, 0.03 - i * 0.04 + z * 0.06 - i * 0.004)) + V((i * 0.01, 0, 0))
            vs.append(v)
        P._tag(vs)
    P.use(bone='RightForearm')
    el, wr = J['RightForearm'], J['RightHand']
    P.cyl(el + (wr - el) * 0.35, el + (wr - el) * 0.9, 0.032, 0.03, seg=10, smooth=True)
    for t in (0.4, 0.85):
        P.tube([el + (wr - el) * t + V((0.034 * math.cos(a), 0.034 * math.sin(a), 0)) for a in np.linspace(0, math.tau, 10, endpoint=False)], 0.004, seg=4, closed=True)


# ------------------------------------------------------------------ shields
SHIELD_GRIP = V((-0.272, -0.015, 0.775))  # inside the left fist, rest pose


def shield_frame(yaw=0.0):
    """Plate-local (u, depth, v) -> rest pose. Relaxed carry: hanging at the side, face outward and a little forward."""
    # local: u across the face, y = depth (-y is the front face), v up. Rest: face points -X (out), turned 35 deg to the front.
    return (Matrix.Translation(SHIELD_GRIP + V((-0.065, 0, 0.02)))
            @ Matrix.Rotation(math.radians(-90 + 35 + yaw), 4, 'Z')
            @ Matrix.Rotation(math.radians(-6), 4, 'X'))


def shield_back(P, xf, back_y, h=0.12):
    """Rear furniture shared by all shields: two leather straps on iron brackets around the grip."""
    P.use(mat='iron', tint=(1, 1, 1))
    for vz in (-h, h):
        P.box(xf @ V((0.0, back_y + 0.022, vz)), (0.06, 0.03, 0.03), rot=xf.to_3x3().to_4x4(), bevel=0.004, smooth=True)
    P.use(mat='fabric', tint=(0.32, 0.21, 0.13))
    P.tube([xf @ V((0.0, back_y + 0.045, -h)), xf @ V((0.0, back_y + 0.06, 0.0)), xf @ V((0.0, back_y + 0.045, h))], 0.016, seg=6, flat=(1.0, 0.55))


def rim(P, outline, y0, y1, mat='iron', width=0.03, xf=None, tint=(1, 1, 1)):
    inner = offset_poly(outline, width)
    xf = xf or Matrix.Identity(4)
    L = [[P.bm.verts.new(xf @ V((u, y, v))) for u, v in loop] for loop, y in ((outline, y0), (inner, y0), (inner, y1), (outline, y1))]
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        for a in range(4):
            c = (a + 1) % 4
            P.bm.faces.new((L[a][i], L[a][j], L[c][j], L[c][i]))
    return P._tag([v for l in L for v in l], smooth=False, mat=mat, tint=tint)


def studs(P, outline, y, xf, every=2, r=0.011, inset=0.015):
    pts = offset_poly(outline, inset)
    for i, (u, v) in enumerate(pts[::every]):
        P.sphere(xf @ V((u, y, v)), r, scale=(1, 0.6, 1), seg=6, rings=4, mat='iron', tint=(0.9, 0.85, 0.75))


def shield_kite(P):
    xf = shield_frame()
    P.use(bone='LeftHand', mat='wood', tint=(0.32, 0.5, 0.2))  # painted green planks
    o = kite()
    P.slab(offset_poly(o, 0.01), -0.016, 0.016, xf=xf, bulge=0.035, rings=3)
    rim(P, o, -0.03 - 0.035 * 0.2, 0.02, width=0.028, xf=xf)
    studs(P, o, -0.032, xf)
    # raised bone-white oak leaf
    lf = leaf(0.46, 0.15)
    P.prism(lf, -0.055, -0.04, xf=xf @ Matrix.Translation((0, 0, 0.0)), mat='wood', tint=(0.92, 0.88, 0.74), smooth=False)
    P.tube([xf @ V((0, -0.058, -0.24)), xf @ V((0, -0.06, 0.0)), xf @ V((0, -0.056, 0.22))], 0.006, seg=5, mat='wood', tint=(0.7, 0.62, 0.45))
    shield_back(P, xf, 0.016)


def shield_round(P):
    xf = shield_frame()
    P.use(bone='LeftHand', mat='wood', tint=(0.75, 0.62, 0.5))
    o = circle(0.3, 28)
    P.slab(offset_poly(o, 0.01), -0.015, 0.015, xf=xf, bulge=0.04, rings=3)
    rim(P, o, -0.034, 0.02, width=0.026, xf=xf)
    # iron boss + four radial bands with rivets
    out = bmesh.ops.create_uvsphere(P.bm, u_segments=16, v_segments=8, radius=1.0)
    vs = []
    for v in out['verts']:
        d = v.co.normalized()
        y = min(d.y, 0.0)
        v.co = xf @ V((d.x * 0.085, -0.055 + y * 0.06, d.z * 0.085))
        vs.append(v)
    P._tag(vs, mat='iron', tint=(1, 1, 1))
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        P.box(xf @ V((math.cos(a) * 0.18, -0.052, math.sin(a) * 0.18)), (0.2, 0.008, 0.03), rot=xf.to_3x3().to_4x4() @ Matrix.Rotation(-a, 4, 'Y'), mat='iron', tint=(1, 1, 1), bevel=0.003)
        for t in (0.11, 0.2, 0.27):
            P.sphere(xf @ V((math.cos(a) * t, -0.058, math.sin(a) * t)), 0.008, seg=6, rings=4, mat='iron', tint=(0.9, 0.85, 0.75))
    shield_back(P, xf, 0.015)


def shield_heater(P):
    xf = shield_frame()
    P.use(bone='LeftHand', mat='wood', tint=(0.48, 0.2, 0.14))
    o = heater()
    P.slab(offset_poly(o, 0.01), -0.016, 0.016, xf=xf, bulge=0.03, rings=3)
    rim(P, o, -0.03, 0.02, width=0.024, xf=xf, tint=(0.62, 0.48, 0.3))
    # pale chevron and a thorn-ring sigil
    chev = ccw([(-0.26, 0.02), (0.0, -0.18), (0.26, 0.02), (0.26, 0.1), (0.0, -0.1), (-0.26, 0.1)])
    P.prism(chev, -0.048, -0.04, xf=xf, mat='wood', tint=(0.88, 0.8, 0.62))
    P.tube([xf @ V((0.07 * math.cos(a), -0.05, 0.18 + 0.07 * math.sin(a))) for a in np.linspace(0, math.tau, 14, endpoint=False)], 0.008, seg=5, closed=True, mat='iron', tint=(0.85, 0.8, 0.7))
    studs(P, o, -0.031, xf, every=3)
    shield_back(P, xf, 0.016)


def shield_buckler(P):
    """Old Bones: a small battered plank buckler, one board split and lashed."""
    xf = shield_frame()
    P.use(bone='LeftHand', mat='wood', tint=(0.66, 0.58, 0.48))
    o = circle(0.22, 18)
    P.slab(offset_poly(o, 0.01), -0.016, 0.016, xf=xf, bulge=0.02, rings=2)
    bite = ccw([(0.13, 0.2), (0.22, 0.04), (0.24, 0.22)])
    P.prism(bite, -0.02, 0.02, xf=xf, mat='wood', tint=(0.12, 0.1, 0.08))  # dark split
    P.use(mat='fabric', tint=(0.42, 0.33, 0.2))
    for vz in (0.12, -0.06):
        P.tube([xf @ V((u, -0.022 - 0.004 * math.cos(u * 12), vz)) for u in np.linspace(-0.2, 0.2, 7)], 0.007, seg=5)
    P.sphere(xf @ V((0, -0.035, 0)), 0.045, scale=(1, 0.5, 1), seg=10, rings=6, mat='iron', tint=(0.8, 0.7, 0.6))
    shield_back(P, xf, 0.016, h=0.08)


def shield_living(P):
    """Bloomcaller: a bark-rimmed slab of living wood with fresh leaves and moss."""
    xf = shield_frame()
    P.use(bone='LeftHand', mat='wood', tint=(0.72, 0.6, 0.44))
    o = circle(0.29, 22, rx=0.25)
    P.slab(offset_poly(o, 0.01), -0.02, 0.02, xf=xf, bulge=0.05, rings=3)
    rim(P, o, -0.045, 0.03, width=0.035, mat='wood', xf=xf, tint=(0.3, 0.22, 0.15))
    # growth rings carved into the face
    for r in (0.07, 0.13, 0.19):
        P.tube([xf @ V((r * 0.86 * math.cos(a), -0.068 + r * r * 0.6, r * math.sin(a))) for a in np.linspace(0, math.tau, 18, endpoint=False)], 0.0045, seg=4, closed=True, mat='wood', tint=(0.42, 0.32, 0.22))
    P.use(mat='fabric', tint=(0.3, 0.5, 0.16))
    for k in range(6):
        a = k * 1.05 + 0.3
        p = xf @ V((0.24 * math.cos(a), -0.05, 0.27 * math.sin(a)))
        P.slab(simple_leaf(0.07, 0.024), -0.002, 0.002, xf=Matrix.Translation(p) @ xf.to_3x3().to_4x4() @ Matrix.Rotation(a - math.pi / 2, 4, 'Y') @ Matrix.Translation((0, 0, 0.03)), bulge=0.005, rings=1)
    for x, z in ((-0.12, 0.17), (0.1, -0.2), (0.16, 0.08)):
        P.sphere(xf @ V((x, -0.07, z)), 0.035, scale=(1, 0.3, 0.8), seg=7, rings=4, tint=(0.24, 0.4, 0.12))
    shield_back(P, xf, 0.02)


def shield_tower(P):
    """Antlerbound: tall rounded planks with iron bands and a bleached skull trophy."""
    xf = shield_frame(yaw=-4)
    P.use(bone='LeftHand', mat='wood', tint=(0.55, 0.45, 0.36))
    o = rounded_rect(0.22, 0.42, 0.08)
    o = [(u, v - 0.05) for u, v in o]
    P.slab(offset_poly(o, 0.01), -0.016, 0.016, xf=xf, bulge=0.05, rings=3)
    rim(P, o, -0.035, 0.02, width=0.025, xf=xf, tint=(0.8, 0.8, 0.8))
    for vz in (0.22, -0.32):
        P.box(xf @ V((0, -0.05, vz)), (0.44, 0.012, 0.04), rot=xf.to_3x3().to_4x4(), mat='iron', tint=(1, 1, 1), bevel=0.003)
        for u in (-0.17, 0.0, 0.17):
            P.sphere(xf @ V((u, -0.058, vz)), 0.009, seg=6, rings=4, mat='iron', tint=(0.9, 0.85, 0.75))
    # small animal skull trophy (bone) lashed to the face
    P.use(mat='bone', tint=(0.92, 0.88, 0.78))
    P.sphere(xf @ V((0, -0.08, 0.02)), 0.06, scale=(0.9, 0.6, 1.1), seg=10, rings=7)
    P.sphere(xf @ V((0, -0.095, -0.07)), 0.035, scale=(0.75, 0.6, 1.3), seg=8, rings=6)
    for s in (-1, 1):
        P.tube([xf @ V((s * 0.04, -0.09, 0.07)), xf @ V((s * 0.1, -0.1, 0.12)), xf @ V((s * 0.13, -0.09, 0.2))], [0.009, 0.007, 0.003], seg=5)
        P.sphere(xf @ V((s * 0.025, -0.13, 0.03)), 0.013, seg=6, rings=4, tint=(0.08, 0.07, 0.06))
    shield_back(P, xf, 0.016)


SHIELDS = {'Shield_Kite': shield_kite, 'Shield_Round': shield_round, 'Shield_Heater': shield_heater,
           'Shield_Buckler': shield_buckler, 'Shield_Living': shield_living, 'Shield_Tower': shield_tower}
GEAR = {'Gear_MossCap': gear_moss_cap, 'Gear_MossRag': gear_moss_rag, 'Gear_IronHelm': gear_iron_helm, 'Gear_Pauldron': gear_pauldron,
        'Gear_Hood': gear_hood, 'Gear_Cracks': gear_bare_cracks, 'Gear_FlowerCrown': gear_flower_crown, 'Gear_Antlers': gear_antlers}


# ------------------------------------------------------------------ post: UVs, AO, export
DENSITY = {'Bone': 4.0, 'Cloth': 3.2, 'Fabric': 3.2, 'Wood': 2.2, 'Iron': 3.5, 'EyeGlow': 1.0}


def box_uvs(ob):
    """World-space box projection in metres x density; textures tile, so seams are noise-on-noise."""
    me = ob.data
    uv = me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        n = poly.normal
        ax = max(range(3), key=lambda i: abs(n[i]))
        dens = DENSITY.get(me.materials[poly.material_index].name, 3.0)
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            if ax == 0: u, v = co.y, co.z
            elif ax == 1: u, v = co.x, co.z
            else: u, v = co.x, co.y
            uv.data[li].uv = (u * dens, v * dens)


def bake_ao(objs, occluders, rays=20, dist=0.09, strength=0.7):
    """Per-vertex ambient occlusion against the body (+ the object itself), multiplied into Col."""
    import random
    rnd = random.Random(7)
    dirs = []
    for i in range(rays):
        u, v = (i + 0.5) / rays, rnd.random()
        r = math.sqrt(u); th = math.tau * v
        dirs.append(V((r * math.cos(th), r * math.sin(th), math.sqrt(max(0, 1 - u)))))
    for ob in objs:
        polys, verts = [], []
        for src in set(occluders) | {ob}:
            base = len(verts)
            verts += [v.co.copy() for v in src.data.vertices]
            polys += [[base + i for i in p.vertices] for p in src.data.polygons]
        tree = BVHTree.FromPolygons(verts, polys)
        me = ob.data
        col = me.color_attributes['Col'].data
        for vi, v in enumerate(me.vertices):
            n = v.normal
            if n.length < 1e-6: continue
            t = n.orthogonal().normalized(); b = n.cross(t)
            o = v.co + n * 0.002
            hit = 0
            for d in dirs:
                w = t * d.x + b * d.y + n * d.z
                if tree.ray_cast(o, w, dist)[0] is not None: hit += 1
            ao = 1 - strength * hit / rays
            # soil and age: darker toward the feet
            dirt = 1 - 0.28 * max(0.0, min(1.0, (0.32 - v.co.z) / 0.3))
            c = col[vi].color
            col[vi].color = (c[0] * ao * dirt, c[1] * ao * dirt, c[2] * ao * dirt * 0.97, 1)


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    col = bpy.data.collections.new('Skeleton'); scene.collection.children.link(col)
    M = make_materials()
    # armature
    ad = bpy.data.armatures.new('SkeletonRig')
    arm = bpy.data.objects.new('SkeletonRig', ad); col.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, (h, t, parent, deform) in JOINTS.items():
        b = ad.edit_bones.new(name); b.head = h; b.tail = t; b.use_deform = deform; b.roll = 0
        if parent: b.parent = eb[parent]
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')

    body = {}
    P = Part('Head', M); build_skull(P); build_jaw(P); body['Head'] = P
    P = Part('Torso', M); build_torso(P); build_loincloth(P); body['Torso'] = P
    for s in ('Left', 'Right'):
        P = Part(s + 'Arm', M); build_arm(P, s); body[s + 'Arm'] = P
        P = Part(s + 'Leg', M); build_leg(P, s); body[s + 'Leg'] = P
    objs = {n: p.finish(col, arm) for n, p in body.items()}
    gear = {}
    for name, fn in {**GEAR, **SHIELDS}.items():
        P = Part(name, M); fn(P); gear[name] = P.finish(col, arm)
    for ob in list(objs.values()) + list(gear.values()):
        box_uvs(ob)
    body_list = list(objs.values())
    bake_ao(body_list, body_list)
    bake_ao(list(gear.values()), body_list, strength=0.55)

    tris = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in list(objs.values()) + list(gear.values())}
    path = os.path.join(OUT, 'skeleton.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                              export_animations=False, export_image_format='JPEG', export_jpeg_quality=86,
                              export_vertex_color='MATERIAL', export_normals=True, export_tangents=False,
                              export_def_bones=False, export_materials='EXPORT', use_selection=False, export_extras=True)
    report = {'tris': tris, 'body_tris': sum(tris[n] for n in objs), 'bytes': os.path.getsize(path), 'joints': BONES}
    with open(os.path.join(OUT, 'build_report.json'), 'w') as f: json.dump(report, f, indent=1)
    print(json.dumps({k: report[k] for k in ('body_tris', 'bytes')}), json.dumps(tris))
    if '--blend' in sys.argv: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'skeleton_source.blend'))


if __name__ == '__main__':
    build()
