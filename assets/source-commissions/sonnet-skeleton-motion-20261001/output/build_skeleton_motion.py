"""Deterministic skeleton guardian motion builder (Blender 4.5, background).

blender -b --python output/build_skeleton_motion.py -- --out ABS_DIR [--rigs mossward,prismwatch,cinderkeep]

Reads ../input/<rig>_rig.glb relative to this file, strips old animation, adds
knee/foot (where missing) and hand/weapon sockets, authors procedural clips with
analytic two-bone leg IK, then writes <rig>_rig.glb + <rig>_rig.blend + manifest.json + HANDOFF.md.

Conventions: Blender armature space is +X side, +Z up, -Y forward (glTF/Godot +Z forward).
Per-bone pose is (pitch, yaw, roll) radians about the bone head in armature axes:
  pitch +  = rotation about +X : top leans forward / hanging limb swings BACKWARD
  yaw   +  = rotation about +Z : turns toward Godot +X (anatomical left of a +Z-facing body)
  roll  +  = rotation about +Y : top leans toward +X
"""
import bpy, sys, os, math, json, struct
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
IN_DIR = os.path.normpath(os.path.join(HERE, '..', 'input'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = HERE
RIGS = ['mossward', 'prismwatch', 'cinderkeep']
for i, a in enumerate(argv):
    if a == '--out': OUT = os.path.abspath(argv[i + 1])
    if a == '--rigs': RIGS = argv[i + 1].split(',')
os.makedirs(OUT, exist_ok=True)

FPS = 24
STRIDE = 0.60            # metres per full walk cycle (two steps)
SUPPORT = 0.60           # fraction of cycle each foot is on the ground
CLIPS = {'idle': (48, True), 'walk': (24, True), 'attack': (40, False), 'hop_left': (20, False),
         'hop_right': (20, False), 'turn_left': (24, False), 'turn_right': (24, False), 'stagger': (28, False)}
BONES = ['Root', 'Torso', 'Head', 'LeftArm', 'RightArm', 'LeftLeg', 'LeftKnee', 'LeftFoot',
         'RightLeg', 'RightKnee', 'RightFoot', 'RightHand', 'WeaponTip']
# personality: base = standing crouch of the root, wind = attack coil, look = head scan, sway = upper body wobble
CH = {
    'mossward': dict(base=-0.035, bounce=1.0, sway=1.0, arm=1.0, wind=1.0, look=1.0, lift=0.09),
    'prismwatch': dict(base=-0.020, bounce=0.8, sway=0.8, arm=0.9, wind=0.9, look=1.4, lift=0.10),
    'cinderkeep': dict(base=-0.045, bounce=1.15, sway=1.2, arm=0.75, wind=1.25, look=0.7, lift=0.085),
}


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def curve(t, keys):
    if t <= keys[0][0]: return keys[0][1]
    if t >= keys[-1][0]: return keys[-1][1]
    i = 0
    for i in range(len(keys) - 1):
        if keys[i][0] <= t <= keys[i + 1][0]: break

    def tang(j):
        if j == 0: return (keys[1][1] - keys[0][1]) / (keys[1][0] - keys[0][0])
        if j == len(keys) - 1: return (keys[-1][1] - keys[-2][1]) / (keys[-1][0] - keys[-2][0])
        return (keys[j + 1][1] - keys[j - 1][1]) / (keys[j + 1][0] - keys[j - 1][0])
    t0, v0 = keys[i]; t1, v1 = keys[i + 1]
    h = t1 - t0; s = (t - t0) / h
    m0 = tang(i) * h; m1 = tang(i + 1) * h
    return ((2 * s**3 - 3 * s**2 + 1) * v0 + (s**3 - 2 * s**2 + s) * m0
            + (-2 * s**3 + 3 * s**2) * v1 + (s**3 - s**2) * m1)


def g2(v): return (round(v.x, 4), round(v.z, 4), round(-v.y, 4))   # blender -> (x, up, fwd)


# ---------------------------------------------------------------- scene prep
def load_rig(name):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(IN_DIR, name + '_rig.glb'))
    for o in list(bpy.data.objects):
        if o.type == 'MESH' and o.name.startswith('Icosphere') and not o.vertex_groups:
            bpy.data.objects.remove(o)       # importer bone-shape helper, not guardian geometry
    for o in list(bpy.data.objects):
        if o.type == 'CAMERA' or o.type == 'LIGHT': bpy.data.objects.remove(o)
    arm = [o for o in bpy.data.objects if o.type == 'ARMATURE'][0]
    if arm.animation_data: arm.animation_data_clear()
    for a in list(bpy.data.actions): bpy.data.actions.remove(a)
    for pb in arm.pose.bones: pb.matrix_basis = Matrix.Identity(4)
    sc = bpy.context.scene
    sc.render.fps = FPS
    return arm


def mesh_of(suffix):
    return [o for o in bpy.data.objects if o.type == 'MESH' and o.name.endswith(suffix)][0]


def mat_verts(obj):
    out = {}
    for p in obj.data.polygons:
        n = obj.data.materials[p.material_index].name
        out.setdefault(n, set()).update(p.vertices)
    return {k: [obj.data.vertices[i].co.copy() for i in v] for k, v in out.items()}


def add_bones(arm, info):
    """Knee/foot where missing + hand/weapon sockets. Returns socket info."""
    have = {b.name for b in arm.data.bones}
    leg_top = max(v.co.z for v in mesh_of('LeftLeg').data.vertices)
    ankle_z, knee_z = 0.127 * leg_top, 0.534 * leg_top            # Mossward's authored joint ratios
    ra = mesh_of('RightArm')
    shoulder = arm.data.bones['RightArm'].head_local.copy()
    verts = [v.co.copy() for v in ra.data.vertices]
    tip = max(verts, key=lambda v: (v - shoulder).length)
    mv = mat_verts(ra)
    if 'Grip_Leather' in mv:
        pts = mv['Grip_Leather']; weapon = True
    else:
        ivory = mv['Bone_Ivory']; low = min(v.z for v in ivory)
        pts = [v for v in ivory if v.z < low + 0.05]; weapon = False
    hand = sum(pts, Vector()) / len(pts)
    if not weapon and 'Prism_Crystal' in mv: weapon = 'crystal'
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = arm.data.edit_bones
    hip_z = eb['LeftLeg'].head.z
    added = []
    for side, sx in (('Left', -1), ('Right', 1)):
        if side + 'Knee' in have: continue
        x = eb[side + 'Leg'].head.x
        k = eb.new(side + 'Knee'); k.head = (x, -0.01, knee_z); k.tail = (x, -0.01, knee_z + (hip_z - knee_z - 0.01))
        k.parent = eb[side + 'Leg']
        f = eb.new(side + 'Foot'); f.head = (x, 0.0, ankle_z); f.tail = (x, 0.0, ankle_z + (knee_z - ankle_z))
        f.parent = k
        added += [side + 'Knee', side + 'Foot']
    h = eb.new('RightHand'); h.head = hand; h.tail = hand + Vector((0, 0, -0.06)); h.parent = eb['RightArm']; h.use_deform = False
    w = eb.new('WeaponTip'); w.head = tip; w.tail = tip + Vector((0, 0, -0.05)); w.parent = h; w.use_deform = False
    bpy.ops.object.mode_set(mode='OBJECT')
    # discrete anatomical weights for the bones we just added
    if added:
        for side in ('Left', 'Right'):
            m = mesh_of(side + 'Leg')
            vgs = {n: (m.vertex_groups.get(n) or m.vertex_groups.new(name=n)) for n in (side + 'Leg', side + 'Knee', side + 'Foot')}
            for v in m.data.vertices:
                z = v.co.z
                wf = 1.0 - smooth(ankle_z - 0.018, ankle_z + 0.018, z)
                wk = (1.0 - smooth(knee_z - 0.02, knee_z + 0.02, z)) * (1.0 - wf)
                wl = max(0.0, 1.0 - wf - wk)
                for vg in vgs.values():
                    try: vg.remove([v.index])
                    except RuntimeError: pass
                for n, wt in ((side + 'Leg', wl), (side + 'Knee', wk), (side + 'Foot', wf)):
                    if wt > 0.0005: vgs[n].add([v.index], wt, 'REPLACE')
    info['sockets'] = {'RightHand': g2(hand), 'WeaponTip': g2(tip), 'weapon': weapon, 'added_bones': added,
                       'ankle_z': round(ankle_z, 4), 'knee_z': round(knee_z, 4)}


# ---------------------------------------------------------------- leg IK
class Leg:
    def __init__(self, arm, side):
        b = arm.data.bones
        P = lambda n: (-b[n].head_local.y, b[n].head_local.z)
        self.H, self.K, self.A = P(side + 'Leg'), P(side + 'Knee'), P(side + 'Foot')
        self.l1 = math.hypot(self.K[0] - self.H[0], self.K[1] - self.H[1])
        self.l2 = math.hypot(self.A[0] - self.K[0], self.A[1] - self.K[1])
        self.phi1r = math.atan2(self.K[0] - self.H[0], self.H[1] - self.K[1])
        self.phi2r = math.atan2(self.A[0] - self.K[0], self.K[1] - self.A[1])
        m = mesh_of(side + 'Leg')
        fw = [-v.co.y for v in m.data.vertices]
        self.heel = self.A[0] - min(fw); self.toe = max(fw) - self.A[0]
        self.ay = self.A[1]; self.L = self.l1 + self.l2; self.side = side

    def solve(self, rootY, af, au, beta, yaw=0.0):
        hf, hu = self.H[0], self.H[1] + rootY
        df, du = af - hf, au - hu
        d = math.hypot(df, du); dmax = 0.998 * self.L; dmin = abs(self.l1 - self.l2) + 0.03
        if d > dmax: df, du, d = df * dmax / d, du * dmax / d, dmax
        if d < dmin: df, du, d = df * dmin / d, du * dmin / d, dmin
        c = max(-1.0, min(1.0, (self.l1**2 + d * d - self.l2**2) / (2 * self.l1 * d)))
        phi1 = math.atan2(df, -du) + math.acos(c)
        kf, ku = self.l1 * math.sin(phi1), -self.l1 * math.cos(phi1)
        phi2 = math.atan2(df - kf, -(du - ku))
        thigh = -(phi1 - self.phi1r); shin = -(phi2 - self.phi2r)
        s = self.side
        return {s + 'Leg': (thigh, yaw, 0.0), s + 'Knee': (shin - thigh, 0.0, 0.0),
                s + 'Foot': (beta + (phi2 - self.phi2r), 0.0, 0.0)}

    def roll(self, beta):
        """ankle displacement that keeps the heel (beta<0) or toe (beta>0) on the ground"""
        pf = self.toe if beta >= 0 else -self.heel
        rf, ru = -pf, self.ay
        c, s = math.cos(beta), math.sin(beta)
        return rf * c + ru * s - rf, -rf * s + ru * c - ru


# ---------------------------------------------------------------- clips
class Ctx: pass


def base_pose():
    return {b: (0.0, 0.0, 0.0) for b in BONES}


def plant(c, rootY, pose, fl=0.015, fr=-0.015, extra=None):
    for side, f in (('Left', fl), ('Right', fr)):
        L = c.legs[side]
        pose.update(L.solve(rootY, f, L.ay, 0.0))


def clip_idle(t, c):
    k = c.ch; tau = 2 * math.pi * t
    rootY = k['base'] + 0.011 * k['bounce'] * math.sin(tau)
    p = base_pose()
    p['Torso'] = (0.03 + 0.03 * math.sin(tau - 0.6), 0.05 * math.sin(tau + 2.0) + 0.02 * math.sin(2 * tau), 0.035 * k['sway'] * math.sin(tau + 1.0))
    p['Head'] = (-0.04 + 0.05 * math.sin(tau - 1.2), 0.20 * k['look'] * math.sin(tau) + 0.06 * math.sin(2 * tau + 0.5), 0.04 * math.sin(tau + 0.6))
    p['RightArm'] = (0.05 + 0.04 * math.sin(tau - 0.9), 0.0, -0.05 - 0.02 * math.sin(tau - 0.3))
    p['LeftArm'] = (-0.03 + 0.02 * math.sin(tau - 1.5), 0.0, 0.03 + 0.015 * math.sin(tau - 0.5))
    plant(c, rootY, p)
    return rootY, p


def walk_foot(c, leg, ph):
    F0 = 0.5 * STRIDE * SUPPORT                        # 0.18 : half the stance travel
    S = STRIDE * SUPPORT                               # 0.36 : stance foot travel relative to body
    def stance(q):
        f = F0 - S * q / SUPPORT
        beta = curve(q, [(0, -0.17), (0.10, 0.0), (0.36, 0.0), (SUPPORT, 0.50)])
        df, dy = leg.roll(beta)
        return f + df, leg.ay + dy, beta
    if ph < SUPPORT: return stance(ph)
    a = stance(SUPPORT); b = stance(0.0)
    s = (ph - SUPPORT) / (1 - SUPPORT); e = s * s * (3 - 2 * s)
    f = a[0] + (b[0] - a[0]) * e
    y = a[1] + (b[1] - a[1]) * e + c.ch['lift'] * math.sin(math.pi * s)
    return f, y, a[2] + (b[2] - a[2]) * e


def clip_walk(t, c):
    k = c.ch; tau = 2 * math.pi * t
    st = {}; w = {}; hipys = {}
    D = 0.915 * c.legs['Left'].L
    for side, off in (('Left', 0.0), ('Right', 0.5)):
        ph = (t + off) % 1.0
        st[side] = walk_foot(c, c.legs[side], ph)
        w[side] = 0.0 if ph >= SUPPORT else smooth(0, 0.08, ph) * (1 - smooth(0.52, SUPPORT, ph))
        L = c.legs[side]
        hipys[side] = st[side][1] + math.sqrt(max(D * D - (st[side][0] - L.H[0]) ** 2, 0.01)) - L.H[1]
    tw = w['Left'] + w['Right']
    rootY = (w['Left'] * hipys['Left'] + w['Right'] * hipys['Right']) / tw
    rootY = k['base'] * 0.0 + rootY + (0.006 * k['bounce'] * math.sin(2 * tau + 0.4))
    p = base_pose()
    for side in ('Left', 'Right'):
        f, y, b = st[side]
        p.update(c.legs[side].solve(rootY, f, y, b))
    g = math.cos(2 * math.pi * (t - 0.3))                  # +1 when the Left-named leg carries the weight
    tY = -0.08 * k['sway'] * math.cos(tau - 0.15)
    tR = -0.055 * k['sway'] * g + 0.015 * math.sin(3 * tau + 0.7)
    tP = 0.07 + 0.025 * math.sin(2 * tau - 0.3) + 0.02 * math.sin(3 * tau + 1.1)
    p['Torso'] = (tP, tY, tR)
    p['Head'] = (-0.04 + 0.05 * math.sin(2 * tau + 0.8), -0.7 * tY * k['look'] + 0.03 * math.sin(tau + 1.3),
                 -0.7 * tR + 0.02 * math.sin(3 * tau + 2.0))
    p['RightArm'] = (-0.30 * k['arm'] * math.cos(tau - 0.15), 0.0, -0.06 - 0.02 * math.sin(2 * tau))
    p['LeftArm'] = (0.10 * k['arm'] * math.cos(tau - 0.15), 0.0, 0.04 + 0.015 * math.sin(2 * tau))
    return rootY, p


def clip_attack(t, c):
    k = c.ch; wd = k['wind']
    rootY = curve(t, [(0, k['base']), (0.40, -0.06 * wd), (0.65, -0.10 * wd), (0.72, -0.07 * wd), (0.80, -0.13 * wd), (0.90, -0.09 * wd), (1.0, k['base'])])
    p = base_pose()
    tremble = 0.025 * math.sin(55 * t) * smooth(0.45, 0.6, t) * (1 - smooth(0.65, 0.68, t))
    arm = curve(t, [(0, 0.07), (0.10, 0.35), (0.25, 1.50), (0.45, 2.35), (0.60, 2.72), (0.65, 2.78), (0.70, 1.75),
                    (0.74, 0.35), (0.78, -0.96), (0.80, -1.19), (0.84, -1.37), (0.90, -0.96), (0.96, -0.40), (1.0, 0.07)])
    p['RightArm'] = (arm + tremble, 0.0, -curve(t, [(0, 0.05), (0.40, 0.22), (0.65, 0.30), (0.80, 0.08), (1, 0.05)]))
    p['LeftArm'] = (curve(t, [(0, -0.03), (0.65, 0.15), (0.80, -0.30), (0.92, -0.10), (1, -0.03)]) * k['arm'], 0.0,
                    curve(t, [(0, 0.03), (0.65, 0.12), (0.80, 0.02), (1, 0.03)]))
    ty = curve(t, [(0, 0), (0.30, 0.25), (0.62, 0.45), (0.66, 0.45), (0.78, -0.30), (0.90, -0.12), (1.0, 0)]) * wd
    tp = curve(t, [(0, 0.03), (0.35, -0.10), (0.65, -0.18), (0.80, 0.38), (0.90, 0.28), (1.0, 0.05)])
    tr = curve(t, [(0, 0), (0.65, 0.08), (0.80, -0.05), (1, 0)])
    p['Torso'] = (tp, ty, tr)
    p['Head'] = (curve(t, [(0, -0.03), (0.65, -0.18), (0.82, 0.22), (1, -0.03)]), -0.6 * ty * k['look'], -0.5 * tr)
    plant(c, rootY, p)
    return rootY, p


def clip_hop(t, c, side):
    k = c.ch; sx = -1 if side == 'Left' else 1
    other = 'Right' if side == 'Left' else 'Left'
    H = 0.15; take = -0.012
    if t < 0.25: rootY = curve(t, [(0, k['base']), (0.10, k['base'] - 0.075), (0.25, take)])
    elif t < 0.72:
        s = (t - 0.25) / 0.47; rootY = take + 4 * H * s * (1 - s)
    else: rootY = curve(t, [(0.72, take), (0.80, k['base'] - 0.085), (1.0, k['base'])])
    B = 4 * ((t - 0.25) / 0.47) * (1 - (t - 0.25) / 0.47) if 0.25 <= t <= 0.72 else 0.0
    p = base_pose()
    L = c.legs[side]; O = c.legs[other]
    hipY = L.H[1] + rootY
    if 0.25 <= t <= 0.72:
        au = max(L.ay, hipY - L.L * (0.985 - 0.10 * B)); beta = 0.35 * B
    else: au = L.ay; beta = 0.0
    p.update(L.solve(rootY, 0.0, au, beta))
    wl = smooth(0.0, 0.2, t) * (1 - smooth(0.80, 0.98, t))
    of = 0.015 + (0.12 - 0.015) * wl
    ou = O.ay + (max(O.ay, hipY - 0.50) - O.ay) * wl
    p.update(O.solve(rootY, of, ou, 0.25 * wl))
    env = smooth(0.15, 0.30, t) * (1 - smooth(0.72, 0.90, t))
    p['Torso'] = (0.06 + 0.10 * smooth(0.0, 0.2, t) * (1 - smooth(0.8, 1.0, t)) + 0.05 * math.sin(math.pi * (t % 1)), 0.0,
                  sx * 0.09 * smooth(0.0, 0.2, t) * (1 - smooth(0.8, 1.0, t)))
    p['Head'] = (-0.10 * env, 0.0, -0.5 * p['Torso'][2])
    p['RightArm'] = (-0.30 * env + 0.05, 0.0, -0.05 - 0.45 * env)
    p['LeftArm'] = (-0.12 * env - 0.03, 0.0, 0.03 + 0.25 * env)
    return rootY, p


def clip_turn(t, c, d):
    k = c.ch
    lead = 'Right' if d > 0 else 'Left'; foll = 'Left' if d > 0 else 'Right'
    sxl = 1 if lead == 'Right' else -1
    p = base_pose()
    wins = {lead: (0.05, 0.50), foll: (0.50, 0.95)}
    rest_f = {'Left': 0.015, 'Right': -0.015}
    lifting = {}; targets = {}
    for side in (lead, foll):
        a, b = wins[side]; L = c.legs[side]
        s = (t - a) / (b - a)
        if 0 < s < 1:
            bump = math.sin(math.pi * s); lifting[side] = bump
            f = rest_f[side] + 0.05 * bump; u = L.ay + 0.075 * bump ** 1.2; yaw = d * 0.42 * bump; beta = 0.3 * bump
        else:
            f, u, yaw, beta = rest_f[side], L.ay, 0.0, 0.0
        lifting.setdefault(side, 0.0)
        targets[side] = (L, f, u, beta, yaw)
    b1, b2 = lifting[lead], lifting[foll]
    rootY = k['base'] - 0.012 - 0.02 * (b1 + b2)
    for side in (lead, foll):
        L, f, u, beta, yaw = targets[side]
        p.update(L.solve(rootY, f, u, beta, yaw))
    ty = d * curve(t, [(0, 0), (0.25, 0.50), (0.55, 0.28), (0.85, 0.06), (1, 0)])
    p['Torso'] = (0.04, ty, 0.05 * (-sxl * b1 + sxl * b2))
    p['Head'] = (-0.03, d * curve(t, [(0, 0), (0.15, 0.62), (0.5, 0.38), (0.85, 0.08), (1, 0)]), 0.0)
    p['RightArm'] = (0.05 - d * 0.10 * math.sin(2 * math.pi * t), 0.0, -0.07 - 0.05 * (b1 + b2))
    p['LeftArm'] = (-0.03 + d * 0.06 * math.sin(2 * math.pi * t), 0.0, 0.05 + 0.05 * (b1 + b2))
    return rootY, p


def clip_stagger(t, c):
    k = c.ch
    rootY = curve(t, [(0, k['base']), (0.08, -0.12), (0.20, -0.09), (0.45, -0.13), (0.70, -0.06), (1, k['base'])])
    p = base_pose()
    tp = curve(t, [(0, 0.03), (0.08, -0.30), (0.20, -0.52), (0.40, 0.14), (0.60, -0.06), (0.80, 0.04), (1.0, 0.03)])
    ty = curve(t, [(0, 0), (0.12, 0.28), (0.30, -0.18), (0.55, 0.08), (1, 0)])
    tr = curve(t, [(0, 0), (0.15, -0.20), (0.35, 0.16), (0.60, -0.06), (1, 0)]) * k['sway']
    p['Torso'] = (tp, ty, tr)
    p['Head'] = (curve(t, [(0, -0.04), (0.12, -0.55), (0.30, -0.20), (0.50, 0.18), (0.75, -0.04), (1, -0.04)]), -0.5 * ty, -0.6 * tr)
    p['RightArm'] = (curve(t, [(0, 0.05), (0.15, -0.60), (0.40, 0.10), (1, 0.05)]), 0.0,
                     -curve(t, [(0, 0.05), (0.18, 0.80), (0.50, 0.20), (1, 0.05)]))
    p['LeftArm'] = (curve(t, [(0, -0.03), (0.15, -0.35), (0.40, 0.10), (1, -0.03)]) * k['arm'], 0.0,
                    curve(t, [(0, 0.03), (0.20, 0.55), (0.50, 0.12), (1, 0.03)]))
    s = (t - 0.12) / 0.40
    bump = math.sin(math.pi * s) if 0 < s < 1 else 0.0
    L = c.legs['Left']; R = c.legs['Right']
    p.update(L.solve(rootY, 0.015 - 0.10 * bump, L.ay + 0.11 * bump, 0.3 * bump))
    p.update(R.solve(rootY, -0.015, R.ay, 0.0))
    return rootY, p


def make_clip(name, t, c):
    if name == 'idle': return clip_idle(t, c)
    if name == 'walk': return clip_walk(t, c)
    if name == 'attack': return clip_attack(t, c)
    if name == 'hop_left': return clip_hop(t, c, 'Left')
    if name == 'hop_right': return clip_hop(t, c, 'Right')
    if name == 'turn_left': return clip_turn(t, c, 1)
    if name == 'turn_right': return clip_turn(t, c, -1)
    if name == 'stagger': return clip_stagger(t, c)


# ---------------------------------------------------------------- baking
def bake(arm, c):
    rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
    head = {b.name: b.head_local.copy() for b in arm.data.bones}
    arm.animation_data_create()
    for pb in arm.pose.bones: pb.rotation_mode = 'QUATERNION'
    for name, (n, loop) in CLIPS.items():
        act = bpy.data.actions.new(name); act.use_fake_user = True
        arm.animation_data.action = act
        prev = {}
        for f in range(n + 1):
            t = f / n
            if loop and f == n: t = 0.0
            rootY, pose = make_clip(name, t, c)
            for b in BONES:
                pitch, yaw, roll = pose[b]
                R = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(roll, 4, 'Y') @ Matrix.Rotation(pitch, 4, 'X')
                tr = Vector((0, 0, rootY)) if b == 'Root' else Vector()
                W = Matrix.Translation(tr) @ Matrix.Translation(head[b]) @ R @ Matrix.Translation(-head[b])
                loc, q, _ = (rest[b].inverted() @ W @ rest[b]).decompose()
                if b in prev: q.make_compatible(prev[b])
                prev[b] = q.copy()
                pb = arm.pose.bones[b]
                pb.location = loc; pb.rotation_quaternion = q; pb.scale = (1, 1, 1)
                pb.keyframe_insert('location', frame=f, group=b)
                pb.keyframe_insert('rotation_quaternion', frame=f, group=b)
        act.frame_range = (0, n)
        track = arm.animation_data.nla_tracks.new(); track.name = name
        track.strips.new(name, 0, act)
    arm.animation_data.action = None


def bone_world(arm, name, frame):
    bpy.context.scene.frame_set(frame)
    ev = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
    return (arm.matrix_world @ ev.pose.bones[name].matrix).translation.copy()


def measure(arm, c):
    out = {}
    def play(name):
        for tr in arm.animation_data.nla_tracks: tr.mute = (tr.name != name)
    # walk: flat-foot slip. Foot should travel back at STRIDE/(duration) per second
    play('walk'); n, _ = CLIPS['walk']
    per_frame = STRIDE / n
    slips = []; ankle_y = []
    for f in range(int(0.14 * n) + 1, int(0.36 * n)):
        a = g2(bone_world(arm, 'LeftFoot', f)); b = g2(bone_world(arm, 'LeftFoot', f + 1))
        slips.append(abs((a[2] - b[2]) - per_frame)); ankle_y.append(a[1])
    out['walk_flatfoot_slip_m_per_frame_max'] = round(max(slips), 5)
    out['walk_flatfoot_ankle_y_range'] = [round(min(ankle_y), 4), round(max(ankle_y), 4)]
    # attack: tip forward travel through strike
    play('attack'); n, _ = CLIPS['attack']
    tr_ = {}
    for ph in (0.0, 0.40, 0.60, 0.65, 0.70, 0.75, 0.80, 0.90, 1.0):
        tr_[str(ph)] = g2(bone_world(arm, 'WeaponTip', round(ph * n)))
    out['attack_weapon_tip_xyz_by_phase'] = tr_
    # hop: sole heights
    for nm, bone in (('hop_left', 'LeftFoot'), ('hop_right', 'RightFoot')):
        play(nm); n, _ = CLIPS[nm]
        ys = [g2(bone_world(arm, bone, f))[1] for f in range(n + 1)]
        out[nm + '_ankle_y_min_max'] = [round(min(ys), 4), round(max(ys), 4)]
        flight = [round(i / n, 3) for i, y in enumerate(ys) if y > c.legs['Left'].ay + 0.012]
        out[nm + '_airborne_phase'] = [flight[0], flight[-1]] if flight else []
    for tr in arm.animation_data.nla_tracks: tr.mute = False
    return out


# ---------------------------------------------------------------- export
def glb_summary(path):
    with open(path, 'rb') as fh:
        fh.read(12); ln, _ = struct.unpack('<II', fh.read(8)); j = json.loads(fh.read(ln))
    return {'animations': [a['name'] for a in j.get('animations', [])],
            'joints': [j['nodes'][i]['name'] for i in j['skins'][0]['joints']] if j.get('skins') else [],
            'meshes': sorted(m['name'] for m in j['meshes']),
            'cameras': len(j.get('cameras', [])), 'lights': len(j.get('extensions', {}).get('KHR_lights_punctual', {}).get('lights', []))}


def export(arm, path):
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    want = dict(filepath=path, export_format='GLB', use_selection=False, export_animations=True,
                export_animation_mode='ACTIONS', export_force_sampling=True, export_frame_range=False,
                export_skins=True, export_def_bones=False, export_cameras=False, export_lights=False,
                export_apply=False, export_yup=True, export_materials='EXPORT', export_optimize_animation_size=False,
                export_reset_pose_bones=True)
    kw = {k: v for k, v in want.items() if k in props}
    for tr in arm.animation_data.nla_tracks: tr.mute = False
    bpy.ops.export_scene.gltf(**kw)
    s = glb_summary(path)
    if sorted(set(s['animations'])) != sorted(CLIPS):
        kw['export_animation_mode'] = 'NLA_TRACKS'
        bpy.ops.export_scene.gltf(**kw)
        s = glb_summary(path)
    return s


def tri_count():
    return sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in bpy.data.objects if o.type == 'MESH')


def build(name, manifest):
    arm = load_rig(name)
    before = tri_count()
    info = {'triangles': before}
    add_bones(arm, info)
    c = Ctx(); c.ch = CH[name]
    c.legs = {s: Leg(arm, s) for s in ('Left', 'Right')}
    info['leg'] = {s: {'thigh': round(c.legs[s].l1, 4), 'shin': round(c.legs[s].l2, 4), 'ankle_height': round(c.legs[s].ay, 4),
                       'heel': round(c.legs[s].heel, 4), 'toe': round(c.legs[s].toe, 4)} for s in c.legs}
    bake(arm, c)
    info['measure'] = measure(arm, c)
    blend = os.path.join(OUT, name + '_rig.blend'); glb = os.path.join(OUT, name + '_rig.glb')
    bpy.context.scene.frame_set(0)
    bpy.ops.wm.save_as_mainfile(filepath=blend)
    summ = export(arm, glb)
    info['bones'] = [b.name for b in arm.data.bones]
    info['clips'] = {k: {'frames': n + 1, 'fps': FPS, 'duration_s': round(n / FPS, 4), 'loop': loop} for k, (n, loop) in CLIPS.items()}
    info['export'] = summ
    info['triangles_after'] = tri_count()
    manifest[name] = info
    print('BUILT', name, json.dumps(info['measure']), summ['animations'])


manifest = {}
mpath = os.path.join(OUT, 'manifest.json')
if os.path.exists(mpath) and '--rigs' in argv:
    manifest = json.load(open(mpath))
for r in RIGS: build(r, manifest)
manifest['_conventions'] = {
    'stride_m_per_cycle': STRIDE, 'support_fraction': SUPPORT, 'walk_cycle_s': CLIPS['walk'][0] / FPS,
    'axes': 'Godot +Y up, +Z forward; Left* bones are the -X side (carry the shield)',
    'attack_phases': {'anticipation': [0, 0.65], 'strike_crossing': [0.65, 0.80], 'recovery': [0.80, 1.0]},
    'hop_flight_fraction': [0.25, 0.72], 'jaw': 'not authored (Head is one rigid skinned mesh)'}
json.dump(manifest, open(mpath, 'w'), indent=1)
print('MANIFEST', mpath)
