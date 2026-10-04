"""Forgeling builder (bpy 4.5, headless, deterministic): Dawnhold's little stone-and-brass helpers.

    python3 build_forgeling.py        # writes forgeling.glb + build_report.json next to this file

Same 18-joint rig, part names and skinning as the skeleton warband (../skeleton-warband-20261004), so the game's
procedural motion, hit parts, dismemberment and crawl-outs work unchanged: Head (with the hinged HeadJaw), Torso,
LeftArm/RightArm, LeftLeg/RightLeg. Optional Gear_* nodes give three looks; Shield_Forge is always carried.

Look (Mitch: forgelings are "small brass-and-stone helpers"; goofy and charming, blue resonance magic):
a chunky dressed-stone bobble head with two big round crystal eyes in brass bezels and a brass grille jaw, a barrel
body with brass hoops and a glowing crystal heart window, brass elbow and knee balls, mitten hands and big brass boots.
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, '..', 'skeleton-warband-20261004'))
import build_skeleton as SK  # noqa: E402  (rig, Part, materials, UVs, AO)
TX = SK.TX
V = Vector
J = SK.J
OUT = HERE


# ------------------------------------------------------------------ materials
def stone_tex(n=512):
    low = TX.fbm(n, 3, 3, 211); mid = TX.fbm(n, 14, 3, 223); fleck = TX.value_noise(n, 160, 229)
    base = np.array([0.88, 0.8, 0.66], np.float32); cool = np.array([0.76, 0.7, 0.6], np.float32)
    c = TX.mix(np.broadcast_to(base, (n, n, 3)), np.broadcast_to(cool, (n, n, 3)), TX.smooth(0.3, 0.8, low) * 0.5)
    c = c * (0.9 + 0.14 * mid[..., None]) * (1 - 0.12 * TX.smooth(0.8, 0.95, fleck)[..., None])
    return np.clip(c, 0, 1), TX.normal_from_height(low * 0.5 + mid * 0.6 - fleck * 0.2, 3.0)


def brass_tex(n=256):
    low = TX.fbm(n, 5, 4, 241); dents = TX.fbm(n, 12, 2, 251); speck = TX.value_noise(n, 80, 257)
    bright = np.array([0.95, 0.74, 0.38], np.float32); worn = np.array([0.72, 0.52, 0.26], np.float32)
    c = TX.mix(np.broadcast_to(bright, (n, n, 3)), np.broadcast_to(worn, (n, n, 3)), TX.smooth(0.45, 0.8, low) * 0.6)
    c = c * (0.9 + 0.12 * dents[..., None])
    rough = 0.3 + 0.25 * TX.smooth(0.45, 0.8, low) + 0.08 * speck
    orm = np.stack([np.ones_like(rough), rough, np.full_like(rough, 0.95)], -1)
    return np.clip(c, 0, 1), TX.normal_from_height(dents * 0.6 + speck * 0.2, 3.0), np.clip(orm, 0, 1)


def make_materials():
    s_alb, s_nrm = stone_tex(); b_alb, b_nrm, b_orm = brass_tex(); f_alb, f_nrm = TX.fabric(); w_alb, w_nrm = TX.wood()
    M = {}
    M['stone'] = SK.material('Stone', {'albedo': SK.image('stone_albedo', s_alb), 'normal': SK.image('stone_normal', s_nrm, 'Non-Color')}, rough=0.86)
    M['brass'] = SK.material('Brass', {'albedo': SK.image('brass_albedo', b_alb), 'normal': SK.image('brass_normal', b_nrm, 'Non-Color'),
                                       'orm': SK.image('brass_orm', b_orm, 'Non-Color')}, rough=1, metal=1)
    M['leather'] = SK.material('Leather', {'albedo': SK.image('leather_albedo', f_alb), 'normal': SK.image('leather_normal', f_nrm, 'Non-Color')}, rough=0.85)
    M['wood'] = SK.material('Wood', {'albedo': SK.image('wood_albedo', w_alb), 'normal': SK.image('wood_normal', w_nrm, 'Non-Color')}, rough=0.78)
    M['glow'] = SK.material('Crystal', {}, rough=0.25, color=(0.25, 0.55, 1.0), emit=(0.35, 0.68, 1.0), vcol=False)
    M['dark'] = SK.material('Socket', {}, rough=0.9, color=(0.05, 0.05, 0.07), vcol=False)
    return M


SK.DENSITY.update({'Stone': 3.0, 'Brass': 3.5, 'Leather': 3.2, 'Wood': 2.2, 'Crystal': 1.0, 'Socket': 1.0})
BRASS, STONE, LEATHER = 'brass', 'stone', 'leather'
HC = V((0, 0.02, 1.53))  # head centre (head bone 1.40 -> 1.56)


def ring(P, c, r, tube, axis='Z', seg=20, **k):
    """A torus-ish band: closed tube around an axis."""
    pts = []
    for i in range(seg):
        a = i / seg * math.tau
        if axis == 'Z': pts.append(V(c) + V((math.cos(a) * r, math.sin(a) * r, 0)))
        else: pts.append(V(c) + V((math.cos(a) * r, 0, math.sin(a) * r)))  # 'Y': faces forward
    P.tube(pts, tube, seg=6, closed=True, **k)


def rivets(P, c, r, n, axis='Z', size=0.009, phase=0.0, arc=(0, math.tau), **k):
    for i in range(n):
        a = arc[0] + (arc[1] - arc[0]) * (i + phase) / n
        p = V(c) + (V((math.cos(a) * r, math.sin(a) * r, 0)) if axis == 'Z' else V((math.cos(a) * r, 0, math.sin(a) * r)))
        P.sphere(p, size, seg=6, rings=4, **k)


# ------------------------------------------------------------------ head
def build_head(P):
    P.use(bone='Head', mat=STONE, tint=(1, 1, 1))
    # chunky rounded block: a bevelled box, a little wider than tall, with a domed cap
    P.box(HC + V((0, 0, 0.0)), (0.33, 0.27, 0.22), bevel=0.06, smooth=True)
    P.sphere(HC + V((0, 0.01, 0.09)), 0.16, scale=(1.0, 0.82, 0.5), seg=14, rings=8)
    # brass brow band all round, with rivets
    band = [HC + V((math.cos(a) * 0.178, math.sin(a) * 0.148, 0.055)) for a in np.linspace(0, math.tau, 24, endpoint=False)]
    P.tube(band, 0.016, seg=6, closed=True, flat=(0.7, 1.4), mat=BRASS, up=(0, 0, 1))
    for a in np.linspace(0, math.tau, 12, endpoint=False):
        P.sphere(HC + V((math.cos(a) * 0.19, math.sin(a) * 0.16, 0.055)), 0.008, seg=6, rings=4, mat=BRASS)
    # big round crystal eyes in brass bezels (the goofy part), slightly cross-set
    for s in (-1, 1):
        e = HC + V((s * 0.075, -0.14, -0.005))
        P.cyl(e + V((0, 0.02, 0)), e + V((0, -0.012, 0)), 0.058, 0.056, seg=18, mat=BRASS)
        P.cyl(e + V((0, -0.006, 0)), e + V((0, -0.016, 0)), 0.046, 0.046, seg=18, mat='dark')
        P.sphere(e + V((0, -0.016, 0)), 0.04, scale=(1, 0.55, 1), seg=14, rings=8, mat='glow')
        P.sphere(e + V((s * -0.012, -0.036, 0.013)), 0.009, seg=6, rings=4, mat='glow')  # catch-light pupil
    # little stone nose stub and brass ear bolts
    P.box(HC + V((0, -0.148, -0.055)), (0.035, 0.03, 0.03), bevel=0.01, smooth=True)
    for s in (-1, 1):
        P.cyl(HC + V((s * 0.165, 0, -0.01)), HC + V((s * 0.2, 0, -0.01)), 0.03, 0.026, seg=10, mat=BRASS)
        P.cyl(HC + V((s * 0.2, 0, -0.01)), HC + V((s * 0.212, 0, -0.01)), 0.018, 0.012, seg=8, mat=BRASS)


def bobble(P, k=1.18):
    """Scale everything built so far for the head about the head centre: a bigger, friendlier bobble head."""
    for v in P.bm.verts: v.co = HC + (v.co - HC) * k


def build_jaw(P):
    """Brass grille jaw on the HeadJaw hinge: it chatters like the skeleton's, a happy grille mouth."""
    P.use(bone='HeadJaw', mat=BRASS)
    c = HC + V((0, -0.11, -0.11))
    P.box(c, (0.2, 0.08, 0.06), bevel=0.02, smooth=True)
    for k in range(5):
        x = -0.064 + k * 0.032
        P.box(c + V((x, -0.041, 0.004)), (0.012, 0.01, 0.034), mat='dark', bevel=0.003)
    P.box(HC + V((0, -0.11, -0.075)), (0.16, 0.07, 0.016), mat='dark', bevel=0.005)  # mouth shadow above the grille


# ------------------------------------------------------------------ body
def build_torso(P):
    P.use(bone='Torso', mat=STONE)
    # barrel body: a swept stone drum, round in plan, wider at the chest
    prof = [(1.0, 0.15), (1.06, 0.195), (1.15, 0.225), (1.25, 0.235), (1.33, 0.22), (1.39, 0.17)]
    P.tube([V((0, 0.03, z)) for z, _ in prof], [r for _, r in prof], seg=18, flat=(1.0, 0.88), up=(0, -1, 0))
    for z, r in ((1.08, 0.21), (1.31, 0.226)):
        ring(P, (0, 0.03, z), r, 0.016, mat=BRASS)
        rivets(P, (0, 0.03, z), r + 0.012, 10, mat=BRASS, size=0.007)
    # crystal heart window on the chest
    hc = V((0, -0.175, 1.2))
    P.cyl(hc + V((0, 0.03, 0)), hc + V((0, -0.012, 0)), 0.07, 0.068, seg=20, mat=BRASS)
    P.cyl(hc + V((0, 0.0, 0)), hc + V((0, -0.016, 0)), 0.055, 0.055, seg=20, mat='dark')
    P.sphere(hc + V((0, -0.012, 0)), 0.045, scale=(1, 0.6, 1.15), seg=8, rings=6, mat='glow')
    for a in range(4):
        q = a * math.pi / 2 + math.pi / 4
        P.box(hc + V((math.cos(q) * 0.08, -0.008, math.sin(q) * 0.08)), (0.02, 0.016, 0.02), mat=BRASS, bevel=0.005)
    # collar and shoulder caps
    ring(P, (0, 0.03, 1.395), 0.12, 0.022, mat=BRASS)
    for s in (-1, 1):
        P.sphere((s * 0.19, 0.035, 1.35), 0.07, scale=(1, 1, 0.85), seg=12, rings=8, mat=BRASS)
        P.box((s * 0.15, 0.035, 1.37), (0.08, 0.1, 0.05), mat=STONE, bevel=0.02, smooth=True)
    # back: a little brass chimney stub always (the tall chimney is Gear_Chimney)
    P.cyl((0, 0.2, 1.24), (0, 0.24, 1.3), 0.03, 0.028, seg=10, mat=BRASS)
    # hips (Root): brass belt and stone hip block
    P.use(bone='Root', mat=STONE)
    P.tube([V((0, 0.03, 0.89)), V((0, 0.03, 0.96)), V((0, 0.03, 1.01))], [0.15, 0.165, 0.14], seg=16, flat=(1, 0.85), up=(0, -1, 0))
    ring(P, (0, 0.03, 0.955), 0.17, 0.02, mat=BRASS)
    P.box((0, -0.12, 0.955), (0.07, 0.02, 0.05), mat=BRASS, bevel=0.008)  # buckle
    P.box((0, -0.132, 0.955), (0.035, 0.01, 0.025), mat='glow', bevel=0.004)


def build_arm(P, side):
    s = -1 if side == 'Left' else 1
    sh, el, wr = J[side + 'Arm'], J[side + 'Forearm'], J[side + 'Hand']
    P.use(bone=side + 'Arm', mat=STONE)
    P.cyl(sh + V((0, 0, -0.04)), el + V((0, 0, 0.03)), 0.072, 0.064, seg=12)
    ring(P, (sh + el) / 2 + V((0, 0, 0.02)), 0.072, 0.012, mat=BRASS)
    P.use(bone=side + 'Forearm')
    P.sphere(el, 0.07, seg=12, rings=8, mat=BRASS)  # elbow ball
    P.cyl(el + V((0, 0, -0.03)), wr + V((0, 0, 0.02)), 0.066, 0.08, seg=12)  # forearm flares to the wrist
    ring(P, wr + V((0, 0, 0.035)), 0.082, 0.014, mat=BRASS)
    P.use(bone=side + 'Hand', mat=BRASS)
    # mitten hand: a chunky brass palm block, three thick fingers curled and a thumb
    P.box(wr + V((s * 0.004, 0, -0.045)), (0.09, 0.1, 0.08), bevel=0.025, smooth=True)
    curl = 1.25 if side == 'Left' else 0.9
    for f in range(3):
        y = -0.028 + f * 0.028
        p = wr + V((s * 0.006, y, -0.08)); ang = 0.0
        for k, ln in enumerate((0.03, 0.026)):
            ang += curl * (0.55 + 0.25 * k)
            q = p + V((0, -math.sin(ang), -math.cos(ang))) * ln
            P.cyl(p, q, 0.02, 0.018, seg=8); P.sphere(q, 0.018, seg=8, rings=5); p = q
    t0 = wr + V((s * 0.03, -0.035, -0.04)); t1 = t0 + V((s * 0.012, -0.03, -0.02))
    P.cyl(t0, t1, 0.016, 0.014, seg=8); P.sphere(t1, 0.015, seg=8, rings=5)


def build_leg(P, side):
    s = -1 if side == 'Left' else 1
    hip, kn, an = J[side + 'Leg'], J[side + 'Knee'], J[side + 'Foot']
    P.use(bone=side + 'Leg', mat=STONE)
    P.sphere(hip, 0.075, seg=10, rings=7, mat=BRASS)
    P.cyl(hip + V((0, 0, -0.03)), kn + V((0, 0, 0.04)), 0.095, 0.08, seg=12)
    ring(P, (hip + kn) / 2, 0.09, 0.013, mat=BRASS)
    P.use(bone=side + 'Knee')
    P.sphere(kn, 0.078, seg=12, rings=8, mat=BRASS)
    P.cyl(kn + V((0, 0, -0.03)), an + V((0, 0, 0.06)), 0.072, 0.085, seg=12)
    P.use(bone=side + 'Foot', mat=BRASS)
    # big brass boot: cuff, rounded toe cap, sole
    P.cyl(an + V((0, 0, 0.07)), an + V((0, 0, 0.02)), 0.092, 0.096, seg=14)
    P.box(an + V((0, -0.035, -0.04)), (0.16, 0.25, 0.09), bevel=0.035, smooth=True)
    P.sphere(an + V((0, -0.135, -0.04)), 0.08, scale=(1, 0.8, 0.62), seg=12, rings=7)
    P.box(an + V((0, -0.045, -0.082)), (0.17, 0.27, 0.02), mat='wood', bevel=0.006)
    rivets(P, an + V((0, 0, 0.045)), 0.096, 6, size=0.007, arc=(math.pi * 1.1, math.pi * 1.9))


# ------------------------------------------------------------------ gear and shield
def gear_chimney(P):
    P.use(bone='Head', mat=BRASS)
    top = HC + V((0.0, 0.03, 0.15))
    P.cyl(top, top + V((0, 0, 0.11)), 0.035, 0.03, seg=12)
    P.cyl(top + V((0, 0, 0.1)), top + V((0, 0, 0.13)), 0.045, 0.045, seg=12)
    P.sphere(top + V((0, 0, 0.145)), 0.03, seg=10, rings=7, mat='glow')  # an ember of resonance on top


def gear_goggles(P):
    P.use(bone='Head', mat=BRASS)
    for s in (-1, 1):
        c = HC + V((s * 0.075, -0.07, 0.115))
        P.cyl(c + V((0, 0.02, -0.02)), c + V((0, -0.025, 0.02)), 0.04, 0.036, seg=14)
        P.sphere(c + V((0, -0.025, 0.02)), 0.03, scale=(1, 0.4, 1), seg=10, rings=6, mat='glow')
    P.tube([HC + V((math.cos(a) * 0.178, math.sin(a) * 0.15, 0.1)) for a in np.linspace(0.15, math.pi - 0.15, 10)], 0.008, seg=5, mat=LEATHER, tint=(0.38, 0.25, 0.16))


def gear_toolbelt(P):
    """A leather tool belt slung over the hips: pouches, a brass spanner and a little hammer."""
    P.use(bone='Root', mat=LEATHER, tint=(0.46, 0.3, 0.18))
    pts = [V((math.cos(a) * 0.19, 0.03 + math.sin(a) * 0.165, 0.915 + 0.03 * math.sin(a + 0.6))) for a in np.linspace(0, math.tau, 22, endpoint=False)]
    P.tube(pts, 0.016, seg=6, closed=True, flat=(0.45, 1.5))
    for a, w in ((-2.2, 0.06), (-1.2, 0.05), (-0.25, 0.055)):
        c = V((math.cos(a) * 0.2, 0.03 + math.sin(a) * 0.175, 0.88))
        P.box(c, (w, 0.045, 0.07), rot=SK.Matrix.Rotation(a + math.pi / 2, 4, 'Z'), bevel=0.012, smooth=True)
        P.box(c + V((0, 0, 0.034)), (w + 0.01, 0.05, 0.014), rot=SK.Matrix.Rotation(a + math.pi / 2, 4, 'Z'), bevel=0.005, tint=(0.36, 0.22, 0.13))
    P.use(mat=BRASS)
    P.cyl((0.205, -0.02, 0.93), (0.215, -0.03, 0.8), 0.009, 0.009, seg=6)  # spanner shaft
    P.box((0.215, -0.03, 0.79), (0.03, 0.012, 0.03), bevel=0.004)
    P.cyl((-0.19, -0.06, 0.95), (-0.205, -0.08, 0.83), 0.009, 0.009, seg=6, mat='wood')  # hammer handle
    P.box((-0.19, -0.06, 0.955), (0.06, 0.025, 0.025), bevel=0.005)


def shield_forge(P):
    """Round brass-rimmed stone shield with a crystal boss, skinned to the shield hand like the skeleton's."""
    P.use(bone='LeftHand', mat=STONE)
    xf = Matrix.Translation(SK.SHIELD_GRIP + V((-0.06, -0.07, 0.03))) @ Matrix.Rotation(-0.35, 4, 'Z') @ Matrix.Rotation(math.pi / 2, 4, 'Z')
    outline = SK.circle(0.21, 28)
    P.slab(outline, -0.012, 0.014, xf=xf, bulge=0.02, rings=3)
    SK.rim(P, outline, -0.02, 0.02, mat=BRASS, width=0.024, xf=xf)
    boss = xf @ V((0, -0.035, 0))
    P.sphere(boss, 0.055, scale=(1, 0.6, 1), seg=12, rings=8, mat=BRASS)
    P.sphere(xf @ V((0, -0.058, 0)), 0.03, scale=(1, 0.6, 1), seg=10, rings=6, mat='glow')
    for a in range(8):
        q = a * math.tau / 8
        P.sphere(xf @ V((math.cos(q) * 0.17, -0.02, math.sin(q) * 0.17)), 0.011, seg=6, rings=4, mat=BRASS)


GEAR = {'Gear_Chimney': gear_chimney, 'Gear_Goggles': gear_goggles, 'Gear_Toolbelt': gear_toolbelt, 'Shield_Forge': shield_forge}


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    col = bpy.data.collections.new('Forgeling'); bpy.context.scene.collection.children.link(col)
    M = make_materials()
    ad = bpy.data.armatures.new('SkeletonRig'); arm = bpy.data.objects.new('SkeletonRig', ad); col.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = {}
    for name, (h, t, parent, deform) in SK.JOINTS.items():
        b = ad.edit_bones.new(name); b.head = h; b.tail = t; b.use_deform = deform; b.roll = 0
        if parent: b.parent = eb[parent]
        eb[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    body = {}
    P = SK.Part('Head', M); build_head(P); build_jaw(P); bobble(P); body['Head'] = P
    P = SK.Part('Torso', M); build_torso(P); body['Torso'] = P
    for s in ('Left', 'Right'):
        P = SK.Part(s + 'Arm', M); build_arm(P, s); body[s + 'Arm'] = P
        P = SK.Part(s + 'Leg', M); build_leg(P, s); body[s + 'Leg'] = P
    objs = {n: p.finish(col, arm) for n, p in body.items()}
    gear = {}
    for name, fn in GEAR.items():
        P = SK.Part(name, M); fn(P)
        if name in ('Gear_Chimney', 'Gear_Goggles'): bobble(P)  # headgear sits on the scaled-up head
        gear[name] = P.finish(col, arm)
    for ob in list(objs.values()) + list(gear.values()): SK.box_uvs(ob)
    body_list = list(objs.values())
    SK.bake_ao(body_list, body_list, strength=0.55)
    SK.bake_ao(list(gear.values()), body_list, strength=0.45)
    tris = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in list(objs.values()) + list(gear.values())}
    path = os.path.join(OUT, 'forgeling.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, export_apply=False, export_skins=True,
                              export_animations=False, export_image_format='JPEG', export_jpeg_quality=84,
                              export_vertex_color='MATERIAL', export_normals=True, export_tangents=False,
                              export_def_bones=False, export_materials='EXPORT', use_selection=False, export_extras=True)
    report = {'tris': tris, 'body_tris': sum(tris[n] for n in objs), 'bytes': os.path.getsize(path), 'joints': SK.BONES}
    with open(os.path.join(OUT, 'build_report.json'), 'w') as f: json.dump(report, f, indent=1)
    print(json.dumps({k: report[k] for k in ('body_tris', 'bytes')}), json.dumps(tris))
    if '--blend' in sys.argv: bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'forgeling_source.blend'))


if __name__ == '__main__':
    build()
