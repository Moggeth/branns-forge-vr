"""Deterministic Blender 4.5 builder for the Brann's Forge Hero (remote player body).

blender -b --factory-startup --python-exit-code 1 --python hero/build_hero.py -- --out <ABS_DIR> [--render]

Blender authoring axes: metres, +Z up, character faces +Y, character right = +X.
glTF export converts this to +Y up, -Z forward, right = +X (the engine contract).
Every visible part is rigidly weighted (1.0) to one bone: cheap skinning, crisp
stylised articulation, no weight-paint drift between builds.
"""
import bpy, bmesh, math, os, sys, json, time
from mathutils import Matrix, Vector, Euler, Quaternion

T0 = time.perf_counter()
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[argv.index('--out') + 1]) if '--out' in argv else os.path.abspath('out')
RENDER = '--render' in argv
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24

# ---------------------------------------------------------------- materials
# Six shared materials. Variants re-tint the *same* six (see hero-view.js PALETTES).
MATS = {}
def material(name, rgb, rough, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    MATS[name] = m
    return m
def srgb(h):
    c = [(h >> s & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)
# Variant A "Emberwright" defaults are baked into the GLB.
material('HeroSkin', srgb(0xd9a07a), 0.62)
material('HeroHair', srgb(0x4a2c1c), 0.70)
material('HeroCloth', srgb(0x9a3b2a), 0.88)     # tunic, sleeves, cape (primary tint)
material('HeroTrim', srgb(0xc9a25a), 0.85)      # scarf, trousers band, hem (secondary tint)
material('HeroLeather', srgb(0x5b3a24), 0.66)
material('HeroMetal', srgb(0x9a958a), 0.38, 0.85)
MAT_ORDER = ['HeroSkin', 'HeroHair', 'HeroCloth', 'HeroTrim', 'HeroLeather', 'HeroMetal']

# ---------------------------------------------------------------- armature
BONES = [  # name, head, tail, parent
    ('Root', (0, 0, 0), (0, 0.18, 0), None),
    ('Hips', (0, 0, 0.93), (0, 0, 1.04), 'Root'),
    ('Spine', (0, 0, 1.04), (0, 0, 1.22), 'Hips'),
    ('Chest', (0, 0, 1.22), (0, 0, 1.47), 'Spine'),
    ('Neck', (0, 0, 1.47), (0, 0.01, 1.54), 'Chest'),
    ('Skull', (0, 0.01, 1.54), (0, 0.01, 1.76), 'Neck'),
    ('Cape', (0, -0.13, 1.44), (0, -0.17, 1.0), 'Chest'),
]
for s, x in (('L', -1), ('R', 1)):
    BONES += [
        (f'UpperArm.{s}', (0.205 * x, 0, 1.425), (0.25 * x, 0, 1.15), 'Chest'),
        (f'Forearm.{s}', (0.25 * x, 0, 1.15), (0.275 * x, 0.02, 0.91), f'UpperArm.{s}'),
        (f'Palm.{s}', (0.275 * x, 0.02, 0.91), (0.28 * x, 0.025, 0.81), f'Forearm.{s}'),
        (f'UpperLeg.{s}', (0.1 * x, 0, 0.93), (0.1 * x, 0.005, 0.5), 'Hips'),
        (f'LowerLeg.{s}', (0.1 * x, 0.005, 0.5), (0.1 * x, -0.01, 0.095), f'UpperLeg.{s}'),
        (f'Foot.{s}', (0.1 * x, -0.01, 0.095), (0.1 * x, 0.15, 0.03), f'LowerLeg.{s}'),
    ]
BONE_NAMES = [b[0] for b in BONES]
arm_data = bpy.data.armatures.new('HeroRig')
rig = bpy.data.objects.new('HeroRig', arm_data)
scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
for name, h, t, p in BONES:
    e = arm_data.edit_bones.new(name)
    e.head, e.tail, e.roll = Vector(h), Vector(t), 0.0
    if p: e.parent = arm_data.edit_bones[p]; e.use_connect = False
bpy.ops.object.mode_set(mode='OBJECT')

# ---------------------------------------------------------------- geometry kit
class Builder:
    def __init__(self, lod):
        self.lod, self.bm = lod, bmesh.new()
        self.dl = self.bm.verts.layers.deform.verify()
        self.tris = 0
    def _finish(self, verts, mat, bone, smooth):
        mi, gi = MAT_ORDER.index(mat), BONE_NAMES.index(bone)
        vs = set(verts)
        for v in vs: v[self.dl][gi] = 1.0
        for f in {f for v in vs for f in v.link_faces}:
            f.material_index, f.smooth = mi, smooth
    def _place(self, verts, loc, size, rot):
        m = Matrix.Translation(loc) @ Euler([math.radians(a) for a in rot]).to_matrix().to_4x4() @ Matrix.Diagonal((*size, 1))
        bmesh.ops.transform(self.bm, matrix=m, verts=verts)
    def sphere(self, mat, bone, loc, size, rot=(0, 0, 0), seg=(14, 9), lo=(8, 6), smooth=True, high_only=False):
        if high_only and self.lod: return
        u, v = lo if self.lod else seg
        r = bmesh.ops.create_uvsphere(self.bm, u_segments=u, v_segments=v, radius=1)
        self._place(r['verts'], loc, size, rot); self._finish(r['verts'], mat, bone, smooth)
    def cone(self, mat, bone, loc, r1, r2, depth, rot=(0, 0, 0), sy=1.0, seg=14, lo=7, caps=True, smooth=True, high_only=False):
        """Frustum along local Z, r1 at -depth/2 (bottom), r2 at top."""
        if high_only and self.lod: return
        r = bmesh.ops.create_cone(self.bm, cap_ends=caps, cap_tris=False, segments=lo if self.lod else seg,
                                  radius1=r1, radius2=r2, depth=depth)
        self._place(r['verts'], loc, (1, sy, 1), rot); self._finish(r['verts'], mat, bone, smooth)
    def box(self, mat, bone, loc, size, rot=(0, 0, 0), bevel=0.25, high_only=False):
        if high_only and self.lod: return
        r = bmesh.ops.create_cube(self.bm, size=1)
        verts = r['verts']
        if bevel and not self.lod:
            self.bm.edges.index_update()   # sets are address-ordered: sort so bevel output order is reproducible
            edges = sorted({e for v in verts for e in v.link_edges}, key=lambda e: e.index)
            b = bmesh.ops.bevel(self.bm, geom=verts + edges, offset=bevel * 0.5, offset_type='PERCENT' if False else 'OFFSET',
                                segments=2, affect='EDGES', profile=0.5)
            verts = list({v for f in b['faces'] for v in f.verts} | set(verts))
            verts = [v for v in verts if v.is_valid]
        self._place(verts, loc, size, rot); self._finish(verts, mat, bone, False)
    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        # Explicit, fixed triangulation: export-time triangulation picked different diagonals per run.
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces[:], quad_method='FIXED', ngon_method='EAR_CLIP')
        self.bm.to_mesh(me); self.bm.free()
        for n in MAT_ORDER: me.materials.append(MATS[n])
        me.set_sharp_from_angle(angle=math.radians(48))
        ob = bpy.data.objects.new(name, me)
        scene.collection.objects.link(ob)
        for n in BONE_NAMES: ob.vertex_groups.new(name=n)
        ob.parent = rig
        mod = ob.modifiers.new('Rig', 'ARMATURE'); mod.object = rig
        # Drop unused material slots so the GLB carries only what it uses.
        # Blender's slot pop() re-indexes faces itself (a manual remap double-shifted them).
        used = {p.material_index for p in me.polygons}
        for i in reversed(range(len(me.materials))):
            if i not in used: me.materials.pop(index=i)
        me.calc_loop_triangles()
        return ob, len(me.loop_triangles)

def build_head(b):
    """Face/hair. High LOD: separate HeroHead mesh so a first-person body can hide it."""
    S = 'Skull'
    b.sphere('HeroSkin', S, (0, 0.012, 1.635), (0.104, 0.112, 0.125), seg=(18, 12), lo=(10, 7))   # cranium/face
    b.sphere('HeroSkin', S, (0, 0.045, 1.575), (0.083, 0.075, 0.06), seg=(18, 11), lo=(6, 4))       # jaw & cheeks
    b.sphere('HeroSkin', S, (0, 0.125, 1.618), (0.019, 0.03, 0.026), rot=(-12, 0, 0), seg=(10, 7), lo=(5, 4))  # nose
    for x in (-1, 1):
        b.sphere('HeroSkin', S, (0.103 * x, 0.0, 1.628), (0.018, 0.032, 0.04), rot=(0, 0, -18 * x), seg=(9, 6), high_only=True)  # ears
        b.sphere('HeroHair', S, (0.042 * x, 0.108, 1.648), (0.014, 0.008, 0.017), seg=(8, 6), high_only=True)  # eyes
        b.box('HeroHair', S, (0.045 * x, 0.111, 1.676), (0.042, 0.016, 0.013), rot=(0, 10 * x, 0), bevel=0.4, high_only=True)  # brows
    # Short practical beard: chin strap + moustache give the face a readable lower edge.
    b.sphere('HeroHair', S, (0, 0.07, 1.552), (0.075, 0.06, 0.05), seg=(16, 10), lo=(6, 4))
    b.box('HeroHair', S, (0, 0.122, 1.592), (0.07, 0.022, 0.016), rot=(0, 0, 0), bevel=0.45, high_only=True)
    # Hair: crown cap set back so the forehead stays open, swept fringe locks, tied tail.
    b.sphere('HeroHair', S, (0, -0.018, 1.675), (0.116, 0.118, 0.1), rot=(-12, 0, 0), seg=(16, 10), lo=(8, 5))
    # Swept forelock lying on the scalp (reads as a side part, keeps the brow line clear).
    b.sphere('HeroHair', S, (0.025, 0.06, 1.728), (0.085, 0.062, 0.034), rot=(-28, 0, -14), seg=(12, 7), lo=(6, 4))
    b.sphere('HeroHair', S, (-0.07, 0.045, 1.705), (0.04, 0.05, 0.03), rot=(-30, 20, 0), seg=(10, 6), high_only=True)
    for x in (-1, 1):  # sideburns joining hair to beard
        b.box('HeroHair', S, (0.089 * x, 0.045, 1.622), (0.018, 0.034, 0.085), rot=(0, 0, 6 * x), bevel=0.45, high_only=True)
    b.sphere('HeroHair', S, (0, -0.118, 1.655), (0.04, 0.04, 0.042), seg=(10, 7), lo=(6, 4))  # knot
    b.cone('HeroHair', S, (0, -0.128, 1.575), 0.014, 0.032, 0.14, rot=(10, 0, 0), seg=8, lo=5)  # tail
    b.cone('HeroLeather', S, (0, -0.128, 1.645), 0.03, 0.03, 0.022, rot=(-70, 0, 0), seg=8, high_only=True)  # hair tie

def build_body(b):
    hi = not b.lod
    # Torso: tunic frustum flaring to the hem, rounded chest, shoulders.
    b.cone('HeroCloth', 'Spine', (0, 0.0, 1.13), 0.165, 0.155, 0.22, sy=0.74, seg=16, lo=8)
    b.sphere('HeroCloth', 'Chest', (0, 0.008, 1.33), (0.185, 0.135, 0.16), seg=(16, 10), lo=(8, 6))
    b.cone('HeroCloth', 'Hips', (0, 0.0, 0.88), 0.215, 0.17, 0.2, sy=0.78, seg=16, lo=8)        # skirt of the tunic
    b.cone('HeroTrim', 'Hips', (0, 0.0, 0.783), 0.222, 0.216, 0.03, sy=0.79, seg=16, lo=8, high_only=False)  # hem band
    b.box('HeroCloth', 'Hips', (0, 0.15, 0.85), (0.15, 0.03, 0.17), rot=(8, 0, 0), bevel=0.3)    # front tabard flap
    b.box('HeroTrim', 'Hips', (0, 0.162, 0.785), (0.155, 0.032, 0.03), rot=(8, 0, 0), bevel=0.3, high_only=True)
    for x in (-1, 1):
        b.sphere('HeroCloth', 'Chest', (0.19 * x, 0.0, 1.41), (0.075, 0.075, 0.07), seg=(12, 8), lo=(6, 4))
    # Scarf/cowl: ring of trim cloth plus the hood bunched at the back of the neck.
    b.cone('HeroTrim', 'Chest', (0, 0.0, 1.47), 0.15, 0.1, 0.085, sy=0.9, seg=16, lo=8)
    b.sphere('HeroTrim', 'Chest', (0, -0.1, 1.47), (0.12, 0.07, 0.065), seg=(12, 7), lo=(6, 4))
    b.cone('HeroTrim', 'Chest', (0.06, 0.13, 1.37), 0.05, 0.03, 0.14, rot=(-8, 0, -12), sy=0.45, seg=8, lo=4, high_only=True)  # scarf tail
    b.cone('HeroSkin', 'Neck', (0, 0.01, 1.51), 0.05, 0.045, 0.08, seg=10, lo=6)
    # Leather: belt, buckle, bandolier strap, pouches, satchel.
    b.cone('HeroLeather', 'Hips', (0, 0.0, 1.0), 0.178, 0.172, 0.06, sy=0.77, seg=16, lo=8)
    b.box('HeroMetal', 'Hips', (0, 0.142, 1.0), (0.065, 0.02, 0.055), bevel=0.35)
    b.box('HeroLeather', 'Hips', (0, 0.146, 1.0), (0.032, 0.022, 0.03), bevel=0.2, high_only=True)
    b.box('HeroLeather', 'Chest', (-0.005, 0.14, 1.255), (0.045, 0.022, 0.4), rot=(-6, -38, 0), bevel=0.3)   # strap front
    b.box('HeroLeather', 'Chest', (-0.005, -0.132, 1.255), (0.045, 0.022, 0.4), rot=(6, 38, 0), bevel=0.3)   # strap back
    b.box('HeroMetal', 'Chest', (0.045, 0.13, 1.36), (0.03, 0.012, 0.03), rot=(0, -36, 0), bevel=0.4, high_only=True)
    b.box('HeroLeather', 'Hips', (0.15, 0.08, 0.96), (0.075, 0.05, 0.085), rot=(0, 0, 24), bevel=0.35)    # pouch R
    b.box('HeroLeather', 'Hips', (0.15, 0.1, 0.995), (0.08, 0.045, 0.03), rot=(-10, 0, 24), bevel=0.4, high_only=True)  # flap
    b.box('HeroMetal', 'Hips', (0.163, 0.118, 0.975), (0.014, 0.01, 0.014), rot=(0, 0, 24), bevel=0.4, high_only=True)
    b.box('HeroLeather', 'Hips', (-0.17, 0.04, 0.955), (0.055, 0.06, 0.09), rot=(0, 0, -8), bevel=0.35)    # pouch L
    b.box('HeroLeather', 'Hips', (-0.145, -0.12, 0.93), (0.13, 0.065, 0.11), rot=(0, 0, 30), bevel=0.35)   # satchel (back L)
    b.box('HeroLeather', 'Hips', (-0.145, -0.128, 0.975), (0.135, 0.07, 0.035), rot=(-8, 0, 30), bevel=0.4, high_only=True)
    # Cape: curved, flaring half-shell from the shoulders (flattened frustum), trimmed hem.
    b.cone('HeroCloth', 'Cape', (0, -0.15, 1.13), 0.215, 0.15, 0.6, rot=(-8, 0, 0), sy=0.3, seg=16, lo=8)
    b.cone('HeroTrim', 'Cape', (0, -0.192, 0.835), 0.222, 0.218, 0.035, rot=(-8, 0, 0), sy=0.31, seg=16, high_only=True)
    # Bedroll strapped high across the shoulders, over the cape: strong back silhouette.
    b.cone('HeroTrim', 'Chest', (0, -0.2, 1.37), 0.058, 0.058, 0.4, rot=(0, 90, 0), seg=12, lo=6)
    for x in (-1, 1):
        b.cone('HeroLeather', 'Chest', (0.12 * x, -0.2, 1.37), 0.063, 0.063, 0.024, rot=(0, 90, 0), seg=12, high_only=True)
    # Left pauldron (restrained metal) on a leather backing.
    b.sphere('HeroLeather', 'UpperArm.L', (-0.225, 0.0, 1.425), (0.09, 0.09, 0.06), rot=(0, -18, 0), seg=(12, 8), lo=(6, 4))
    b.sphere('HeroMetal', 'UpperArm.L', (-0.235, 0.0, 1.445), (0.085, 0.085, 0.05), rot=(0, -22, 0), seg=(12, 8), lo=(6, 4))
    b.sphere('HeroMetal', 'UpperArm.L', (-0.29, 0.0, 1.43), (0.012, 0.012, 0.012), seg=(6, 4), high_only=True)
    for s, x in (('L', -1), ('R', 1)):
        # Arms: sleeve, elbow, leather bracer, palm/fingers (fingerless glove).
        b.cone('HeroCloth', f'UpperArm.{s}', (0.228 * x, 0, 1.29), 0.05, 0.062, 0.28, rot=(0, -9 * x, 0), seg=10, lo=6)
        b.sphere('HeroCloth', f'Forearm.{s}', (0.25 * x, 0.0, 1.15), (0.05, 0.05, 0.05), seg=(10, 6), lo=(5, 4))
        b.cone('HeroLeather', f'Forearm.{s}', (0.264 * x, 0.012, 1.02), 0.04, 0.052, 0.2, rot=(0, -6 * x, 0), seg=10, lo=6)
        b.cone('HeroTrim', f'Forearm.{s}', (0.268 * x, 0.014, 1.11), 0.054, 0.054, 0.02, rot=(0, -6 * x, 0), seg=10, high_only=True)
        b.cone('HeroMetal', f'Forearm.{s}', (0.264 * x, 0.012, 0.99), 0.046, 0.046, 0.018, rot=(0, -6 * x, 0), seg=10, high_only=True)
        build_hand(b, s, x)
        # Legs: trousers, knee, boot shaft with folded cuff, foot, sole.
        b.cone(TROUSER, f'UpperLeg.{s}', (0.1 * x, 0.002, 0.71), 0.062, 0.084, 0.42, seg=10, lo=6)
        b.sphere(TROUSER, f'LowerLeg.{s}', (0.1 * x, 0.012, 0.5), (0.062, 0.064, 0.06), seg=(10, 6), lo=(5, 4))
        b.cone(TROUSER, f'LowerLeg.{s}', (0.1 * x, 0.004, 0.42), 0.05, 0.06, 0.14, seg=10, lo=6)
        b.cone('HeroLeather', f'LowerLeg.{s}', (0.1 * x, 0.0, 0.225), 0.056, 0.058, 0.27, seg=12, lo=6)
        b.cone('HeroLeather', f'LowerLeg.{s}', (0.1 * x, 0.002, 0.37), 0.064, 0.078, 0.07, seg=12, lo=6)       # cuff
        b.cone('HeroMetal', f'LowerLeg.{s}', (0.1 * x, 0.0, 0.17), 0.06, 0.06, 0.014, seg=12, high_only=True)  # strap ring
        b.box('HeroLeather', f'Foot.{s}', (0.1 * x, 0.055, 0.055), (0.105, 0.24, 0.1), rot=(0, 0, 0), bevel=0.35)
        b.box('HeroHair', f'Foot.{s}', (0.1 * x, 0.055, 0.012), (0.112, 0.25, 0.024), bevel=0.3)                 # sole
        b.sphere('HeroLeather', f'Foot.{s}', (0.1 * x, 0.15, 0.06), (0.055, 0.06, 0.05), seg=(10, 6), lo=(5, 4))  # toe cap

TROUSER = 'HeroHair'  # replaced below before building (kept as a single switch for palette review)

def build_hand(b, s, x):
    """Fingerless-glove fist closed around a 32 mm haft whose axis runs along +Y (forward) at rest."""
    P = f'Palm.{s}'
    cx, cy, cz = 0.282 * x, 0.03, 0.86
    # Leather glove shell wraps the back and palm; bare curled fingers wrap the haft below it.
    b.box('HeroLeather', P, (cx - 0.006 * x, cy - 0.004, cz + 0.008), (0.054, 0.088, 0.078), bevel=0.55)
    b.box('HeroSkin', P, (cx - 0.022 * x, cy + 0.002, cz - 0.034), (0.046, 0.084, 0.04), bevel=0.7)        # finger roll
    if not b.lod:
        for i in range(4):  # proximal knuckles on the outer edge read at distance and in VR
            b.sphere('HeroSkin', P, (cx + 0.006 * x, cy - 0.031 + i * 0.021, cz - 0.026), (0.013, 0.011, 0.013), seg=(8, 6))
        b.box('HeroMetal', P, (cx + 0.021 * x, cy - 0.004, cz + 0.016), (0.006, 0.05, 0.026), bevel=0.4)      # riveted back plate
    b.cone('HeroSkin', P, (cx - 0.036 * x, cy + 0.046, cz - 0.004), 0.011, 0.014, 0.046, rot=(-72, 0, 14 * x), seg=8, lo=4)  # thumb over the haft
    b.sphere('HeroSkin', P, (cx - 0.036 * x, cy + 0.068, cz - 0.011), (0.0115, 0.0115, 0.0115), seg=(8, 6), high_only=True)  # thumb tip
    b.cone('HeroLeather', P, (cx - 0.004 * x, cy - 0.004, cz + 0.056), 0.036, 0.04, 0.03, seg=12, lo=6)  # cuff (capped in leather: reads as the sleeve end on floating VR hands)
    b.cone('HeroTrim', P, (cx - 0.004 * x, cy - 0.004, cz + 0.071), 0.041, 0.041, 0.008, seg=12, caps=False, high_only=True)  # stitched rim band

def hand_center(x):
    return Vector((0.282 * x - 0.018 * x, 0.03, 0.835))

# ---------------------------------------------------------------- build LODs
def build(lod, trouser):
    global TROUSER
    TROUSER = trouser
    out = {}
    if lod:
        b = Builder(1); build_head(b); build_body(b)
        out['HeroBody_LOD'] = b.to_object('HeroBody_LOD')
    else:
        b = Builder(0); build_head(b); out['HeroHead'] = b.to_object('HeroHead')
        b = Builder(0); build_body(b); out['HeroBody'] = b.to_object('HeroBody')
    return out
meshes = {**build(0, 'HeroHair'), **build(1, 'HeroHair')}  # dark trousers
tri = {k: v[1] for k, v in meshes.items()}

# ---------------------------------------------------------------- sockets
bpy.context.view_layer.update()
def socket(name, bone, world_loc, world_rot=Matrix.Identity(3)):
    e = bpy.data.objects.new(name, None)
    e.empty_display_type, e.empty_display_size = 'ARROWS', 0.06
    scene.collection.objects.link(e)
    e.parent, e.parent_type, e.parent_bone = rig, 'BONE', bone
    bpy.context.view_layer.update()
    e.matrix_world = Matrix.Translation(world_loc) @ world_rot.to_4x4()
    return e
# Blender->glTF: (x, y, z) -> (x, z, -y). A Blender rotation whose columns are
# (+X, +Z, -Y) in glTF terms is the identity, so build sockets in glTF axes.
C_GLTF = Matrix(((1, 0, 0), (0, 0, 1), (0, -1, 0)))   # Blender vector -> glTF vector
def gltf_basis(right, up, back):
    # Exporter converts an object rotation as C @ R @ C^-1, so author R = C^-1 @ R_gltf @ C.
    return C_GLTF.inverted() @ Matrix((right, up, back)).transposed() @ C_GLTF
EYE = Vector((0, 0.06, 1.645))
socket('Head', 'Skull', EYE)                      # eye centre; -Z = gaze, +Y = up (glTF)
socket('Hand.L', 'Palm.L', hand_center(-1))       # palm centre, same axes as the body at rest
socket('Hand.R', 'Palm.R', hand_center(1))
# WeaponGrip: inside the right fist. Local +Y = haft axis toward the weapon head
# (out of the thumb side), local -Z = strike/edge direction, +X = palm normal side.
# At rest the haft points forward (-Z world) and the edge points down (-Y world).
socket('WeaponGrip', 'Palm.R', hand_center(1) + Vector((0, 0.01, 0.0)),
       gltf_basis((1, 0, 0), (0, 0, -1), (0, 1, 0)))
socket('WeaponGrip.L', 'Palm.L', hand_center(-1) + Vector((0, 0.01, 0.0)),
       gltf_basis((1, 0, 0), (0, 0, -1), (0, 1, 0)))

# ---------------------------------------------------------------- animation
REST = {pb.name: pb.bone.matrix_local.to_3x3() for pb in rig.pose.bones}
for pb in rig.pose.bones: pb.rotation_mode = 'QUATERNION'
def key(act_pose, frame):
    """act_pose: {bone: (rx, ry, rz[, tx, ty, tz])} in armature axes (deg, m)."""
    for pb in rig.pose.bones:
        v = act_pose.get(pb.name, (0, 0, 0))
        R = Euler([math.radians(a) for a in v[:3]], 'XYZ').to_matrix()
        r = REST[pb.name]
        pb.rotation_quaternion = (r.inverted() @ R @ r).to_quaternion()
        pb.location = r.inverted() @ Vector(v[3:6] if len(v) > 3 else (0, 0, 0))
        pb.keyframe_insert('rotation_quaternion', frame=frame)
        pb.keyframe_insert('location', frame=frame)
rig.animation_data_create()
CLIPS = {}
def clip(name, frames, poses, loop):
    act = bpy.data.actions.new(name); act.use_fake_user = True
    rig.animation_data.action = act
    for f, p in poses: key(p, f)
    CLIPS[name] = {'frames': frames, 'seconds': round(frames / 24, 4), 'loop': loop}
    return act
sin = lambda t: math.sin(2 * math.pi * t)
cos = lambda t: math.cos(2 * math.pi * t)

def idle(t):
    br = sin(t)
    return {'Hips': (0, 0, 0, 0, 0, -0.004 * (1 - cos(t)) / 2), 'Chest': (-1.5 * br, 0, 0), 'Spine': (0.5 * br, 0, 0),
            'Skull': (1.5 * sin(t + .25), 3 * sin(t * 0.5) if False else 2 * sin(t), 0), 'Cape': (2 + 1.5 * br, 0, 0),
            'UpperArm.L': (2 * br, 0, -4), 'UpperArm.R': (2 * br, 0, 4), 'Forearm.L': (12, 0, 0), 'Forearm.R': (12, 0, 0),
            'UpperLeg.L': (0, 0, -1), 'UpperLeg.R': (0, 0, 1)}
clip('Idle', 48, [(i * 6, idle(i / 8)) for i in range(9)], True)   # loops key 0..N: exporter clips start at frame 0

def gait(t, run):
    a, k, arm, lean, bob = (42, 75, 38, -10, 0.035) if run else (26, 38, 20, -3, 0.02)
    p = {}
    for s, ph in (('L', 0.0), ('R', 0.5)):
        u = t + ph
        swing = sin(u) * a                         # + = leg forward
        knee = max(0.0, -sin(u + 0.15)) * k + (8 if run else 4)   # bend during back/recovery
        p[f'UpperLeg.{s}'] = (swing, 0, 0)
        p[f'LowerLeg.{s}'] = (-knee, 0, 0)
        p[f'Foot.{s}'] = (max(0, -swing) * 0.4 - 4, 0, 0)
        p[f'UpperArm.{s}'] = (-sin(u) * arm, 0, (-6 if s == 'L' else 6) * (1.6 if run else 1))
        p[f'Forearm.{s}'] = ((65 if run else 18) + max(0, -sin(u)) * (20 if run else 12), 0, 0)
    p['Hips'] = (0, 0, sin(t) * (7 if run else 5), 0, 0, -bob * (cos(2 * t) * 0.5 + 0.5))
    p['Spine'] = (lean * 0.5, 0, 0)
    p['Chest'] = (lean * 0.5, 0, -sin(t) * (9 if run else 6))
    p['Skull'] = (-lean * 0.8, 0, sin(t) * 3)
    p['Cape'] = ((22 if run else 9) + sin(2 * t) * 4, 0, 0)
    return p
clip('Walk', 24, [(i * 3, gait(i / 8, False)) for i in range(9)], True)
clip('Run', 16, [(i * 2, gait(i / 8, True)) for i in range(9)], True)

REST_ARM = {'UpperArm.L': (0, 0, -4), 'UpperArm.R': (0, 0, 4), 'Forearm.L': (12, 0, 0), 'Forearm.R': (12, 0, 0)}
clip('Attack', 18, [
    (1, REST_ARM),
    (6, {'UpperArm.R': (165, 0, 18), 'Forearm.R': (40, 0, 0), 'UpperArm.L': (40, 0, -10), 'Forearm.L': (50, 0, 0),
         'Spine': (6, 0, 12), 'Chest': (6, 0, 14), 'Skull': (-6, 0, -10), 'UpperLeg.L': (14, 0, 0), 'UpperLeg.R': (-10, 0, 0), 'Cape': (6, 0, 0)}),
    (10, {'UpperArm.R': (35, 0, -10), 'Forearm.R': (8, 0, 0), 'UpperArm.L': (-10, 0, -10), 'Forearm.L': (40, 0, 0),
          'Spine': (-12, 0, -14), 'Chest': (-10, 0, -16), 'Skull': (12, 0, 12), 'UpperLeg.L': (24, 0, 0), 'LowerLeg.L': (-18, 0, 0),
          'UpperLeg.R': (-14, 0, 0), 'Hips': (0, 0, 0, 0, 0.03, -0.04), 'Cape': (18, 0, 0)}),
    (18, REST_ARM)], False)
clip('Hit', 12, [
    (1, REST_ARM),
    (4, {'Spine': (14, 0, 6), 'Chest': (12, 0, 8), 'Skull': (-14, 0, 10), 'UpperArm.L': (30, 0, -30), 'UpperArm.R': (30, 0, 30),
         'Forearm.L': (60, 0, 0), 'Forearm.R': (60, 0, 0), 'Hips': (0, 0, 0, 0, -0.04, -0.02), 'UpperLeg.L': (10, 0, 0),
         'LowerLeg.L': (-14, 0, 0), 'Cape': (-6, 0, 0)}),
    (12, REST_ARM)], False)
rig.animation_data.action = bpy.data.actions['Idle']
scene.frame_set(1)

# ---------------------------------------------------------------- VR gloves (reusable, unskinned)
def build_gloves():
    objs = []
    for s, x in (('L', -1), ('R', 1)):
        b = Builder(0)
        build_hand(b, s, x)
        ob, n = b.to_object(f'Glove.{s}')
        ob.modifiers.clear(); ob.parent = None; ob.vertex_groups.clear()
        # Re-centre so the glove origin is the grip anchor (fist centre).
        c = hand_center(x) + Vector((0, 0.01, 0))
        ob.data.transform(Matrix.Translation(-c))
        ob.location = (0.25 * x, 0, 3.0)  # parked away from the hero in the source scene
        g = bpy.data.objects.new(f'GripAnchor.{s}', None); g.empty_display_type = 'ARROWS'; g.empty_display_size = 0.05
        scene.collection.objects.link(g); g.parent = ob
        g.matrix_parent_inverse.identity(); g.matrix_basis = gltf_basis((1, 0, 0), (0, 0, -1), (0, 1, 0)).to_4x4()
        objs += [ob, g]; tri[f'Glove.{s}'] = n
    return objs
gloves = build_gloves()

# ---------------------------------------------------------------- export
def export(path, objs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_yup=True,
                              export_apply=False, export_animations=True, export_animation_mode='ACTIONS',
                              export_skins=True, export_def_bones=False, export_extras=False,
                              export_force_sampling=True, export_frame_step=1, export_optimize_animation_size=True,
                              export_anim_single_armature=True, export_reset_pose_bones=True,
                              export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
socks = [o for o in scene.objects if o.type == 'EMPTY' and o.parent == rig]
hi = [rig, meshes['HeroBody'][0], meshes['HeroHead'][0], meshes['HeroBody_LOD'][0], *socks]
export(os.path.join(OUT, 'hero.glb'), hi)
export(os.path.join(OUT, 'hero_lod.glb'), [rig, meshes['HeroBody_LOD'][0], *socks])
bpy.ops.object.select_all(action='DESELECT')
for o in gloves: o.select_set(True)
bpy.context.view_layer.objects.active = gloves[0]
gl = {g.name: g for g in gloves}
gl['Glove.L'].location = (-0.12, 0, 0); gl['Glove.R'].location = (0.12, 0, 0)  # side by side; each origin = grip
bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, 'hero_hands.glb'), export_format='GLB', use_selection=True,
                          export_animations=False, export_yup=True, export_materials='EXPORT')
gl['Glove.L'].location = (-0.25, 0, 3.0); gl['Glove.R'].location = (0.25, 0, 3.0)

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'hero_source.blend'), compress=True)
report = {'triangles': tri, 'high_lod_triangles': tri['HeroBody'] + tri['HeroHead'], 'low_lod_triangles': tri['HeroBody_LOD'],
          'materials': MAT_ORDER, 'bones': BONE_NAMES, 'clips': CLIPS, 'sockets': [s.name for s in socks],
          'bytes': {f: os.path.getsize(os.path.join(OUT, f)) for f in ('hero.glb', 'hero_lod.glb', 'hero_hands.glb')},
          'build_seconds': round(time.perf_counter() - T0, 3)}
with open(os.path.join(OUT, 'build_report.json'), 'w', encoding='utf-8') as f: json.dump(report, f, indent=2)
print('HERO_REPORT', json.dumps(report))
