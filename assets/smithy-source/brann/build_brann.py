# Brann Copperpot character builder for Blender 4.5. See HANDOFF.md.
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix, Quaternion
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.abspath(os.environ.get('BRANN_BUILD_DIR', os.path.join(REPO, 'logs', 'brann-rebuild')))
os.makedirs(OUT, exist_ok=True)
HAMMER_GLB = os.path.join(REPO, 'godot', 'assets', 'smithy', 'brann', 'hammer.glb')
V = Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
scn = bpy.context.scene
scn.render.fps = 25
COL = scn.collection

# ---------------------------------------------------------------- skeleton layout
B = {  # name: (head, tail, parent, deform)
 'Root': ((0,0,0),(0,0.0,0.12),None,False),
 'Hips': ((0,0,0.95),(0,0,1.08),'Root',True),
 'Spine': ((0,0,1.08),(0,0,1.25),'Hips',True),
 'Chest': ((0,0,1.25),(0,0,1.45),'Spine',True),
 'Neck': ((0,0.0,1.45),(0,-0.01,1.57),'Chest',True),
 'Head': ((0,-0.01,1.57),(0,-0.01,1.80),'Neck',True),
 'Jaw': ((0,-0.01,1.63),(0,-0.10,1.575),'Head',True),
 'EyeL': ((0.039,-0.088,1.684),(0.039,-0.12,1.684),'Head',True),
 'EyeR': ((-0.039,-0.088,1.684),(-0.039,-0.12,1.684),'Head',True),
 'Beard1': ((0,-0.10,1.56),(0,-0.12,1.48),'Jaw',True),
 'Beard2': ((0,-0.12,1.48),(0,-0.115,1.40),'Beard1',True),
 'BraidL1': ((0.035,-0.115,1.47),(0.040,-0.115,1.40),'Beard1',True),
 'BraidL2': ((0.040,-0.115,1.40),(0.046,-0.11,1.31),'BraidL1',True),
 'BraidR1': ((-0.035,-0.115,1.47),(-0.032,-0.12,1.41),'Beard1',True),
 'BraidR2': ((-0.032,-0.12,1.41),(-0.040,-0.115,1.34),'BraidR1',True),
 'ApronL': ((0.09,-0.16,0.98),(0.10,-0.17,0.55),'Hips',True),
 'ApronR': ((-0.09,-0.16,0.98),(-0.10,-0.17,0.55),'Hips',True),
}
for s, k in (('L',1),('R',-1)):
    B['Shoulder'+s] = ((0.03*k,0.0,1.42),(0.18*k,0.015,1.43),'Chest',True)
    B['UpperArm'+s] = ((0.20*k,0.015,1.42),(0.37*k,0.04,1.14),'Shoulder'+s,True)
    B['Forearm'+s] = ((0.37*k,0.04,1.14),(0.46*k,-0.02,0.87),'UpperArm'+s,True)
    B['Hand'+s] = ((0.46*k,-0.02,0.87),(0.485*k,-0.04,0.78),'Forearm'+s,True)
    B['Fingers'+s] = ((0.485*k,-0.04,0.78),(0.50*k,-0.05,0.72),'Hand'+s,True)
    B['Thigh'+s] = ((0.11*k,0,0.93),(0.12*k,0.0,0.52),'Hips',True)
    B['Shin'+s] = ((0.12*k,0.0,0.52),(0.12*k,0.015,0.11),'Thigh'+s,True)
    B['Foot'+s] = ((0.12*k,0.015,0.11),(0.125*k,-0.13,0.03),'Shin'+s,True)

def bdir(n): return (V(B[n][1])-V(B[n][0])).normalized()

# ---------------------------------------------------------------- metaball sculpt helpers
STIFF = 5.0; THR = 0.6
K = math.sqrt(1 - (THR/STIFF)**(1/3))
def mball(name, res):
    mb = bpy.data.metaballs.new(name); mb.resolution = res; mb.render_resolution = res; mb.threshold = THR
    ob = bpy.data.objects.new(name, mb); COL.objects.link(ob); return ob
def ball(ob, p, r, neg=False, s=STIFF):
    e = ob.data.elements.new(type='BALL'); e.co = p; e.radius = r/K; e.stiffness = s; e.use_negative = neg; return e
def ell(ob, p, size, rot=None, neg=False, s=STIFF):
    e = ob.data.elements.new(type='ELLIPSOID'); e.co = p; e.radius = 1/K
    e.size_x, e.size_y, e.size_z = size; e.stiffness = s; e.use_negative = neg
    if rot: e.rotation = rot
    return e
def cap(ob, a, b, r, s=STIFF):
    a, b = V(a), V(b); e = ob.data.elements.new(type='CAPSULE'); e.co = (a+b)/2
    e.radius = r/K; e.size_x = (b-a).length/2; e.stiffness = s
    e.rotation = V((1,0,0)).rotation_difference((b-a).normalized()); return e
def bake_mb(ob, name):
    dg = bpy.context.evaluated_depsgraph_get(); ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev); me.name = name
    o = bpy.data.objects.new(name, me); COL.objects.link(o); bpy.data.objects.remove(ob); return o
def decimate(o, tris):
    n = sum(len(p.vertices)-2 for p in o.data.polygons)
    if n <= tris: return
    m = o.modifiers.new('dec', 'DECIMATE'); m.ratio = tris/n
    dg = bpy.context.evaluated_depsgraph_get(); me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    old = o.data; o.modifiers.clear(); o.data = me; bpy.data.meshes.remove(old)

# ---------------------------------------------------------------- BODY: one continuous sculpt
body = mball('BodyMB', 0.0065)
ell(body, (0,0.005,0.96), (0.165,0.115,0.10))             # pelvis
ell(body, (0,-0.03,1.10), (0.19,0.16,0.13))              # sturdy belly
ell(body, (0,-0.01,1.29), (0.225,0.15,0.14))                # chest
ell(body, (0,0.0,1.39), (0.215,0.13,0.08))                # upper chest
for k in (1,-1):
    cap(body, (0.02*k,0.025,1.47), (0.16*k,0.02,1.425), 0.052)        # trapezius slope
    ell(body, (0.10*k,-0.085,1.33), (0.08,0.045,0.065))               # pecs
    ball(body, (0.20*k,0.01,1.40), 0.078)                           # deltoid
    s, sl = ('L' if k>0 else 'R'), None
    ua, fa, hd = B['UpperArm'+s], B['Forearm'+s], B['Hand'+s]
    cap(body, ua[0], V(ua[1])*0.55+V(ua[0])*0.45, 0.066)              # bicep mass
    cap(body, V(ua[1])*0.55+V(ua[0])*0.45, ua[1], 0.053)
    cap(body, fa[0], V(fa[0])*0.6+V(fa[1])*0.4, 0.056)                 # smith forearm
    cap(body, V(fa[0])*0.6+V(fa[1])*0.4, fa[1], 0.036)
    W = V(hd[0]); d = bdir('Hand'+s); n = V((-k,0,0))                 # palm faces inward
    l = d.cross(n).normalized(); n = l.cross(d).normalized()
    rot = Matrix((l, n, d)).transposed().to_quaternion()
    ell(body, W + d*0.045, (0.042, 0.02, 0.048), rot)                  # palm
    Kn = W + d*0.082
    for i in range(4):
        off = l*(-0.027+0.018*i); ln = 0.05 if i in (1,2) else 0.042
        cap(body, Kn+off, Kn+off+d*ln*0.6+n*0.006, 0.0105)
        cap(body, Kn+off+d*ln*0.6+n*0.006, Kn+off+d*ln+n*0.022, 0.0095)
    tb = W + d*0.03 - l*0.035*k*0 + l*(0.038) + n*0.012
    cap(body, tb, tb + d*0.04 + n*0.025 - l*0.008, 0.012)
    # legs / boots
    th, sh = B['Thigh'+s], B['Shin'+s]
    cap(body, th[0], th[1], 0.092); ball(body, th[1], 0.062)
    cap(body, sh[0], V(sh[0])*0.5+V(sh[1])*0.5, 0.062)
    cap(body, V(sh[0])*0.5+V(sh[1])*0.5, (0.12*k,0.012,0.13), 0.064)  # boot shaft
    ell(body, (0.122*k,-0.04,0.05), (0.058,0.13,0.058))               # boot foot
    ball(body, (0.12*k,0.04,0.055), 0.055)                            # heel
    cap(body, (0.12*k,0.012,0.10), (0.12*k,0.008,0.34), 0.072)        # tall boot shaft hides shin
# neck & head
cap(body, (0,0.01,1.44), (0,-0.005,1.58), 0.079)
ell(body, (0,-0.005,1.685), (0.098,0.105,0.115))           # skull
ball(body, (0,0.02,1.70), 0.092)                           # cranium back
ell(body, (0,-0.05,1.605), (0.083,0.065,0.05))             # broad jaw
ball(body, (0,-0.088,1.578), 0.036)                        # heroic chin
for k in (1,-1):
    ball(body, (0.055*k,-0.078,1.655), 0.032)              # cheekbones
    ell(body, (0.103*k,0.0,1.672), (0.012,0.022,0.032))   # ears
    ball(body, (0.039*k,-0.093,1.684), 0.021, neg=True, s=4)   # eye sockets
cap(body, (-0.058,-0.088,1.708), (0.058,-0.088,1.708), 0.022)  # brow ridge
cap(body, (0,-0.098,1.695), (0,-0.122,1.655), 0.015)       # nose bridge
ball(body, (0,-0.121,1.651), 0.021)                        # nose ball
for k in (1,-1): ball(body, (0.016*k,-0.113,1.648), 0.013)  # nostril wings
ell(body, (0,-0.112,1.618), (0.026,0.016,0.007), neg=True, s=4)   # mouth slot
body = bake_mb(body, 'BrannBody')
decimate(body, 17000)
for v in body.data.vertices:
    if v.co.z < 0.0: v.co.z = 0.0
bmw = bmesh.new(); bmw.from_mesh(body.data); bmesh.ops.remove_doubles(bmw, verts=bmw.verts, dist=1e-5)
bmw.to_mesh(body.data); bmw.free()
body.data.shade_smooth()
bvh_body = BVHTree.FromObject(body, bpy.context.evaluated_depsgraph_get())
def front(x, z, y0=-1.0):
    hit = bvh_body.ray_cast(V((x,y0,z)), V((0,1,0)))
    return hit[0] if hit[0] else V((x,-0.1,z))

# ---------------------------------------------------------------- materials
sys.path.insert(0, HERE); import textures_brann as TX   # embedded procedural bitmaps
def mat(name, col, rough=0.7, metal=0.0, emit=None, spec=0.5):
    m = bpy.data.materials.new(name); m.use_nodes = True; p = m.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*col, 1); p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal; p.inputs['Specular IOR Level'].default_value = spec
    if emit: p.inputs['Emission Color'].default_value = (*emit,1); p.inputs['Emission Strength'].default_value = 1.0
    return m
def tmat(name, maps, metal=0.0, nstr=1.0):
    col, rough, nrm = maps; m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; p = nt.nodes['Principled BSDF']
    ib = nt.nodes.new('ShaderNodeTexImage'); ib.image = TX.img(name+'_BaseColor', col); nt.links.new(ib.outputs['Color'], p.inputs['Base Color'])
    io = nt.nodes.new('ShaderNodeTexImage'); io.image = TX.img(name+'_ORM', TX.orm(rough, metal), True)
    sep = nt.nodes.new('ShaderNodeSeparateColor'); nt.links.new(io.outputs['Color'], sep.inputs['Color'])
    nt.links.new(sep.outputs['Green'], p.inputs['Roughness']); p.inputs['Metallic'].default_value = metal  # explicit metallicFactor
    inn = nt.nodes.new('ShaderNodeTexImage'); inn.image = TX.img(name+'_Normal', nrm, True)
    nm = nt.nodes.new('ShaderNodeNormalMap'); nm.inputs['Strength'].default_value = nstr
    nt.links.new(inn.outputs['Color'], nm.inputs['Color']); nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    return m
M = {
 'skin': tmat('Skin', TX.skin(512), nstr=0.5), 'shirt': tmat('ShirtTealWeave', TX.weave(512, (0.16,0.36,0.36), 40, 21)),
 'trousers': tmat('TrousersDark', TX.weave(256, (0.11,0.10,0.095), 30, 31, twill=True)),
 'boots': tmat('BootLeather', TX.leather(256, (0.13,0.075,0.045), 41)),
 'apron': tmat('ApronOiledLeather', TX.leather(512, (0.17,0.085,0.045), 51, seams=True)),
 'patch': tmat('ApronPocketLeather', TX.leather(256, (0.26,0.14,0.07), 61, seams=True)),
 'copper': mat('DarkCopper', (0.42,0.20,0.11), 0.45, 1.0), 'glass': mat('LensGlass', (0.05,0.08,0.075), 0.28, 0.0, spec=0.2),
 'band': tmat('GoggleBandLeather', TX.leather(256, (0.12,0.08,0.055), 71)), 'hair': tmat('AmberRedHair', TX.hair(256, (0.50,0.15,0.045), 81)),
 'brow': mat('DarkAuburnBrow', (0.06,0.016,0.007), 0.72),
 'sclera': mat('Sclera', (0.70,0.66,0.61), 0.35), 'iris': mat('IrisBlueGrey', (0.12,0.22,0.30), 0.3),
 'pupil': mat('Pupil', (0.01,0.01,0.012), 0.2), 'mouth': mat('MouthInterior', (0.10,0.02,0.02), 0.6),
 'teeth': mat('Teeth', (0.62,0.58,0.50), 0.4), 'lips': mat('Lips', (0.42,0.18,0.13), 0.6),
 'button': mat('HornButton', (0.16,0.12,0.08), 0.45), 'gem': mat('PresenceGem', (0.25,0.75,0.85), 0.2, 0.0, (0.1,0.4,0.5)),
}
def cyl_uv(o, us=2.0, vs=1.5):
    me = o.data; uvl = me.uv_layers[0] if me.uv_layers else me.uv_layers.new(name='UVMap')
    for poly in me.polygons:
        uv = []
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.append([(math.atan2(co.x, -co.y)/(2*math.pi)+0.5)*us, co.z*vs])
        xs = [a for a, _ in uv]
        if max(xs) - min(xs) > us/2:
            for t in uv:
                if t[0] < us/2: t[0] += us
        for li, t in zip(poly.loop_indices, uv): uvl.data[li].uv = t
def add_mats(o, names):
    for n in names: o.data.materials.append(M[n])

# ---------------------------------------------------------------- weights
DEF = [n for n in B if B[n][3]]
def segdist(p, a, b):
    a, b = V(a), V(b); ab = b-a; t = max(0, min(1, (p-a).dot(ab)/ab.length_squared)); return (p-(a+ab*t)).length, t
BODY_BONES = ['Hips','Spine','Chest','Neck','Head','Jaw'] + [x+s for s in 'LR' for x in ('Shoulder','UpperArm','Forearm','Hand','Fingers','Thigh','Shin','Foot')]
def weigh(p, bones, top=3, power=4):
    ws = []
    for n in bones:
        if n.endswith('L') and n not in ('EyeL',) and p.x < -0.04: continue
        if n.endswith('R') and n not in ('EyeR',) and p.x > 0.04: continue
        d, _ = segdist(p, *B[n][:2]); ws.append((1/(d*d+1e-5)**(power/2), n))
    ws.sort(reverse=True); ws = ws[:top]; t = sum(w for w,_ in ws); return [(w/t, n) for w,n in ws if w/t > 0.03]
def skin_obj(o, fn):
    vgs = {}
    for v in o.data.vertices:
        for w, n in fn(v.co.copy()):
            if n not in vgs: vgs[n] = o.vertex_groups.new(name=n)
            vgs[n].add([v.index], w, 'REPLACE')
def body_w(p):
    if p.z > 1.50 and abs(p.x) < 0.13:
        if p.z < 1.638 and p.y < -0.04: return [(1,'Jaw')] if p.z < 1.61 else [(0.5,'Jaw'),(0.5,'Head')]
        if p.z > 1.58: return [(1,'Head')]
    return weigh(p, BODY_BONES)
skin_obj(body, body_w)

def dom(o, vi):
    best = max(((g.weight, o.vertex_groups[g.group].name) for g in o.data.vertices[vi].groups), default=(0,''))
    return best[1]
add_mats(body, ['skin','shirt','trousers','boots']); cyl_uv(body)
for poly in body.data.polygons:
    c = poly.center; dn = dom(body, poly.vertices[0])
    if c.z < 0.36: mi = 3
    elif c.z < 1.0 and not dn.startswith(('Hand','Fingers','Forearm')): mi = 2
    elif c.z > 1.38 and math.hypot(c.x, c.y-0.005) < 0.14 and dn in ('Neck','Chest','Head','Jaw','ShoulderL','ShoulderR'):
        mi = 0 if (-0.2425*(c.y-0.012) + 0.9701*(c.z-1.468)) > -0.006 else 1   # skin/shirt split on collar plane (hidden under band)
    elif dn.startswith(('Forearm','Hand','Fingers')) or dn in ('Head','Jaw'): mi = 0
    elif dn.startswith('UpperArm'):
        _, t = segdist(c, *B['UpperArm'+dn[-1]][:2]); mi = 1 if t < 0.82 else 0
    else: mi = 1
    poly.material_index = mi

def torus(bm, c, axis, R, r, seg=24, rs=8, sx=1.0, sy=1.0):
    q = V((0,0,1)).rotation_difference(V(axis).normalized()); vs = []
    for i in range(seg):
        a = 2*math.pi*i/seg; ring = []
        for j in range(rs):
            b = 2*math.pi*j/rs; rr = R + r*math.cos(b)
            p = V((rr*math.cos(a)*sx, rr*math.sin(a)*sy, r*math.sin(b)))
            ring.append(bm.verts.new(V(c) + q @ p))
        vs.append(ring)
    fs = []
    for i in range(seg):
        for j in range(rs):
            fs.append(bm.faces.new((vs[i][j], vs[(i+1)%seg][j], vs[(i+1)%seg][(j+1)%rs], vs[i][(j+1)%rs])))
    return fs
def box(bm, c, size, rot=None):
    r = bmesh.ops.create_cube(bm, size=1.0); vs = r['verts']
    m = Matrix.Diagonal((*size, 1.0)); q = rot or Quaternion()
    for v in vs: v.co = V(c) + q @ (m.to_3x3() @ v.co)
    return list({f for v in vs for f in v.link_faces})
def cyl(bm, c, axis, r, depth, seg=16):
    res = bmesh.ops.create_cone(bm, cap_ends=True, segments=seg, radius1=r, radius2=r, depth=depth)
    q = V((0,0,1)).rotation_difference(V(axis).normalized())
    for v in res['verts']: v.co = V(c) + q @ v.co
    return list({f for v in res['verts'] for f in v.link_faces})
# ---------------------------------------------------------------- APRON: split leather from body front + offset
# Separate cut sheet: bib + skirt hanging from the belly line well in front of the body, real thickness, drape folds.
AZ0, AZ1, ANU, ANZ = 0.40, 1.36, 26, 44
def apron_hw(z): return 0.225 if z < 1.12 else 0.225 + (0.135-0.225)*min(1, (z-1.12)/0.2)
def body_min_y(x, z): return min(front(x+dx, z).y for dx in (-0.04, -0.02, 0, 0.02, 0.04))
def apron_y(x, z, u):
    yb = body_min_y(x, z); y = yb - 0.034
    if z < 1.08:
        belly = body_min_y(x*0.8, 1.08); y = min(y, belly - 0.034 - 0.05*(1.08-z))
        y += 0.055*abs(u)**3                                       # wraps round the thighs
        y += 0.008*math.sin(u*math.pi*3.5+0.6)*min(1, (1.08-z)/0.35)  # hanging folds
    return min(y, yb - 0.026)
bm = bmesh.new(); grid_v = []; T = 0.007
for j in range(ANZ+1):
    z = AZ0 + (AZ1-AZ0)*j/ANZ; row = []
    for i in range(ANU+1):
        u = -1 + 2*i/ANU; x = u*apron_hw(z); y = apron_y(x, z, u)
        row.append((bm.verts.new((x, y, z)), bm.verts.new((x, y+T, z)), (u+1)/2, j/ANZ))
    grid_v.append(row)
uvq = []
for j in range(ANZ):
    for i in range(ANU):
        a, b, c, d = grid_v[j][i], grid_v[j][i+1], grid_v[j+1][i+1], grid_v[j+1][i]
        uvq.append((bm.faces.new((a[0], b[0], c[0], d[0])), [(q[2], q[3]) for q in (a,b,c,d)]))
        uvq.append((bm.faces.new((d[1], c[1], b[1], a[1])), [(q[2], q[3]) for q in (d,c,b,a)]))
rim = [grid_v[0][i] for i in range(ANU+1)] + [grid_v[j][ANU] for j in range(1, ANZ+1)] + \
      [grid_v[ANZ][i] for i in range(ANU-1, -1, -1)] + [grid_v[j][0] for j in range(ANZ-1, 0, -1)]
for a, b in zip(rim, rim[1:]+rim[:1]):
    uvq.append((bm.faces.new((a[0], a[1], b[1], b[0])), [(0.01,0.01)]*4))
pockets = []
for (px, pz, pw, ph) in ((-0.085, 0.80, 0.11, 0.10), (0.095, 0.84, 0.085, 0.085), (0.0, 1.235, 0.09, 0.07)):
    u = px/apron_hw(pz); py = apron_y(px, pz, u) - 0.004
    fs = box(bm, (px, py, pz), (pw, 0.006, ph)); pockets += fs
    for f in fs: uvq.append((f, [((l.vert.co.x-px)/pw+0.5, (l.vert.co.z-pz)/ph+0.5) for l in f.loops]))
    for sx in (-1, 1):                                             # copper rivets at pocket mouth
        for f in cyl(bm, (px+sx*pw*0.44, py-0.004, pz+ph*0.44), (0,-1,0), 0.005, 0.004, 8):
            f.material_index = 2; uvq.append((f, [(0.5,0.5)]*len(f.verts)))
for f in pockets: f.material_index = 1
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
uvlay = bm.loops.layers.uv.new('UVMap')
for f, uvs in uvq:
    for l, t in zip(f.loops, uvs): l[uvlay].uv = t
apron_me = bpy.data.meshes.new('Apron'); bm.to_mesh(apron_me); bm.free()
apron = bpy.data.objects.new('BrannApron', apron_me); COL.objects.link(apron); apron_me.shade_smooth()
add_mats(apron, ['apron', 'patch', 'copper'])
def apron_w(p):
    f = max(0.0, min(1.0, (1.0 - p.z)/0.18))
    up = weigh(p + V((0, 0.06, 0)), ['Hips','Spine','Chest'])
    if f <= 0: return up
    wl = max(0.0, min(1.0, 0.5 + p.x/0.18)); th = 0.2*f
    out = [(w*(1-f), n) for w, n in up] + [(f*(1-0.2)*wl, 'ApronL'), (f*(1-0.2)*(1-wl), 'ApronR'), (th*wl, 'ThighL'), (th*(1-wl), 'ThighR')]
    return [(w, n) for w, n in out if w > 0.01]
skin_obj(apron, apron_w)
APRON_TOP = {k: V((0.11*k, apron_y(0.11*k, 1.345, 0.11*k/apron_hw(1.345)), 1.345)) for k in (1,-1)}

# ---------------------------------------------------------------- GEAR: torus/box helpers
gear = bmesh.new(); GM = {'shirt':0,'copper':1,'button':2,'band':3,'glass':4,'patch':5,'apron':6,'boots':7}
def tag(fs, m):
    for f in fs: f.material_index = GM[m]
tag(torus(gear, (0,0.012,1.468), (0,-0.25,1), 0.088, 0.019, seg=48, rs=12, sx=1.05, sy=0.95), 'shirt')       # collar: smooth closed band
for s,k in (('L',1),('R',-1)):
    a, b = V(B['UpperArm'+s][0]), V(B['UpperArm'+s][1]); c = a + (b-a)*0.84
    tag(torus(gear, c, b-a, 0.058, 0.02, rs=10), 'shirt')                                 # rolled sleeve cuff
    tag(torus(gear, c+(b-a).normalized()*0.022, b-a, 0.054, 0.013, rs=8), 'shirt')
    tag(torus(gear, (0.12*k,0.009,0.335), (0,0,1), 0.073, 0.016, rs=8), 'boots')              # folded boot cuff
    for zf, rf in ((0.17, 0.074), (0.225, 0.075)):                                            # stacked leather folds
        tag(torus(gear, (0.12*k,0.011,zf), (0,0.08,1), rf, 0.0075, rs=6), 'boots')
    r = bmesh.ops.create_uvsphere(gear, u_segments=24, v_segments=12, radius=1.0)             # rounded sole
    for v in r['verts']: v.co = V((0.122*k + v.co.x*0.068, -0.045 + v.co.y*0.15, max(0.0, 0.024 + v.co.z*0.026)))
    tag(list({f for v in r['verts'] for f in v.link_faces}), 'band')
    r = bmesh.ops.create_uvsphere(gear, u_segments=16, v_segments=10, radius=1.0)             # toe cap
    for v in r['verts']: v.co = V((0.122*k + v.co.x*0.056, -0.135 + v.co.y*0.05, max(0.03, 0.058 + v.co.z*0.042)))
    tag(list({f for v in r['verts'] for f in v.link_faces}), 'boots')
for i, z in enumerate((1.22, 1.30, 1.38)):
    p = front(0, z); tag(cyl(gear, p + V((0,-0.004,0)), (0,-1,0), 0.0075, 0.006, 10), 'button')
tag(torus(gear, (0,-0.02,1.005), (0,0,1), 0.19, 0.016, sx=1.03, sy=0.9, rs=6), 'band')  # belt (under apron)
for k in (1,-1):
    p = APRON_TOP[k]; tag(box(gear, p+V((0,-0.008,0.0)), (0.034,0.008,0.03)), 'copper')        # apron strap buckles
    tag(torus(gear, p+V((0,-0.012,0)), (0,-1,0), 0.011, 0.0028, seg=12, rs=5), 'copper')      # buckle ring
    # straps from apron top over shoulder to back
    pts = [p+V((0,-0.004,0.01)), front(0.12*k,1.42)+V((0,-0.014,0)), V((0.12*k,0.0,1.50)), V((0.11*k,0.12,1.40)), V((0.08*k,0.13,1.12))]
    for a, b in zip(pts, pts[1:]):
        c = (a+b)/2; d = (b-a); q = V((0,0,1)).rotation_difference(d.normalized())
        tag(box(gear, c, (0.03, 0.006, d.length+0.01), q), 'apron')
# goggles: band around head + raised lenses on forehead
tag(torus(gear, (0,0.0,1.752), (0,-0.10,1), 0.105,   # band rides behind goggle cups, no longer dips onto glabella
    0.0075, seg=32, rs=6, sx=1.0, sy=1.08), 'band')
for k in (1,-1):
    c = V((0.042*k,-0.112,1.758)); ax = V((0,-1,0.55))
    tag(cyl(gear, c, ax, 0.026, 0.03, 20), 'copper')                                        # deeper goggle cup
    tag(torus(gear, c + ax.normalized()*0.016, ax, 0.024, 0.0055, seg=20, rs=6), 'copper')
    tag(cyl(gear, c + ax.normalized()*0.011, ax, 0.020, 0.004, 20), 'glass')              # recessed lens
tag(box(gear, (0,-0.118,1.752), (0.024,0.008,0.012)), 'copper')                           # bridge
gm = bpy.data.meshes.new('Gear'); gear.to_mesh(gm); gear.free()
gearo = bpy.data.objects.new('BrannGear', gm); COL.objects.link(gearo); cyl_uv(gearo, 2.0, 2.0)
add_mats(gearo, list(GM.keys()))
def gear_w(p):
    if p.z > 1.70: return [(1,'Head')]
    if 1.40 < p.z < 1.52 and math.hypot(p.x, p.y-0.012) < 0.13: return [(0.6,'Neck'),(0.4,'Chest')]   # whole collar band
    if 1.30 < p.z < 1.37 and p.y < -0.12: return apron_w(p)
    if p.z > 1.44 and abs(p.x) < 0.1 and p.y > -0.06: return [(0.6,'Neck'),(0.4,'Chest')]
    return weigh(p, BODY_BONES, top=2)
skin_obj(gearo, gear_w)

# ---------------------------------------------------------------- HAIR + BEARD: carved metaball volume
hb = mball('HairMB', 0.005)
ell(hb, (0,0.018,1.742), (0.104,0.112,0.062))
ell(hb, (0,0.045,1.68), (0.098,0.075,0.085))
for k in (1,-1):
    cap(hb, (0.094*k,-0.02,1.705), (0.093*k,-0.028,1.665), 0.012); cap(hb, (0.093*k,-0.028,1.665), (0.092*k,-0.035,1.62), 0.017)  # tapered sideburns
    cap(hb, (0.09*k,-0.035,1.62), (0.065*k,-0.085,1.565), 0.024)                  # jaw beard
    cap(hb, (0.065*k,-0.085,1.565), (0.0,-0.112,1.545), 0.03)
    cap(hb, (0.006*k,-0.13,1.645), (0.036*k,-0.124,1.634), 0.0125)              # moustache
    cap(hb, (0.036*k,-0.124,1.634), (0.062*k,-0.104,1.60), 0.012)
ell(hb, (0,-0.105,1.505), (0.072,0.05,0.06))                                     # beard mass
for k, sgn in ((1,1),(-1,-1)):
    s = 'L' if k > 0 else 'R'; a = V(B['Braid'+s+'1'][0]); b = V(B['Braid'+s+'2'][1])
    for i in range(13):
        t = i/12; p = a.lerp(b, t); w = 0.005*math.sin(i*2.4 + (0.8 if k<0 else 0))   # plaited wrap
        ball(hb, p + V((w, 0.004*math.cos(i*2.4), 0)), 0.0175 - 0.009*t, s=6)          # real taper
for x in (-0.06, -0.03, 0.0, 0.03, 0.06):                                          # swept locks break the helmet
    cap(hb, (x, -0.088, 1.752), (x*1.15, 0.03, 1.805), 0.02)
for k in (1,-1): ball(hb, (0.072*k,-0.06,1.66), 0.03, neg=True)                  # keep cheeks clear
hair = bake_mb(hb, 'BrannHairBeard'); decimate(hair, 7000)
bm = bmesh.new(); bm.from_mesh(hair.data); bm.normal_update()
for v in bm.verts:   # carved strand grooves: flow follows head on top, vertical in beard
    p = v.co
    if p.z > 1.66: g = math.sin(math.atan2(p.x, p.y+0.01)*26 + p.z*30)
    else: g = math.sin(p.x*230 + p.z*18 + 2*math.sin(p.z*60))
    v.co += v.normal*(0.0032 if p.z > 1.66 else 0.0021)*g
bm.to_mesh(hair.data); bm.free(); hair.data.shade_smooth(); add_mats(hair, ['hair'])
gb = bmesh.new()   # copper braid bands
for k in (1,-1):
    s = 'L' if k > 0 else 'R'
    a, b = V(B['Braid'+s+'1'][0]), V(B['Braid'+s+'2'][1])
    for t in (0.28, 0.58, 0.9):                                    # 3 wrap bands sized to the taper
        torus(gb, a.lerp(b, t), b-a, (0.0175-0.009*t)*0.95, 0.0035, seg=14, rs=6)
bands_me = bpy.data.meshes.new('BraidBands'); gb.to_mesh(bands_me); gb.free()
for poly in bands_me.polygons: poly.material_index = 1
bands = bpy.data.objects.new('BraidBands', bands_me); COL.objects.link(bands)
hair.data.materials.append(M['copper'])
bpy.ops.object.select_all(action='DESELECT'); hair.select_set(True); bands.select_set(True)
bpy.context.view_layer.objects.active = hair; bpy.ops.object.join(); cyl_uv(hair, 2.0, 3.0)
def hair_w(p):
    if p.z > 1.64 or (p.y > -0.05 and p.z > 1.60): return [(1,'Head')]
    if p.z > 1.585 and p.y > -0.075: return [(0.6,'Head'),(0.4,'Jaw')]
    if abs(p.x) > 0.022 and p.z < 1.475: return weigh(p, ['BraidL1','BraidL2'] if p.x>0 else ['BraidR1','BraidR2'], 2, 2)
    if p.z > 1.585: return [(0.3,'Head'),(0.7,'Jaw')]
    return weigh(p, ['Jaw','Beard1','Beard2'], 2, 2)
skin_obj(hair, hair_w)

# ---------------------------------------------------------------- EYES
ER = 0.0175
eb = bmesh.new()
for s in 'LR':
    c = V(B['Eye'+s][0])
    r = bmesh.ops.create_uvsphere(eb, u_segments=24, v_segments=16, radius=ER)
    rx = Matrix.Rotation(math.radians(90), 3, 'X')                 # sphere pole -> -Y gaze axis
    for v in r['verts']: v.co = c + rx @ v.co
    for f in {f for v in r['verts'] for f in v.link_faces}:
        d = (f.calc_center_median() - c).normalized(); fw = -d.y
        f.material_index = 2 if fw > 0.975 else (1 if fw > 0.83 else 0)
em = bpy.data.meshes.new('Eyes'); eb.to_mesh(em); eb.free()
eyes = bpy.data.objects.new('BrannEyes', em); COL.objects.link(eyes); em.shade_smooth()
add_mats(eyes, ['sclera','iris','pupil'])
skin_obj(eyes, lambda p: [(1, 'EyeL' if p.x > 0 else 'EyeR')])

# ---------------------------------------------------------------- FACE RIG mesh: lids, lips, mouth interior, teeth, brows
fb = bmesh.new(); PART = {}
def sph(c, R, a, e):  # forward is -Y
    return V(c) + R*V((math.sin(a)*math.cos(e), -math.cos(a)*math.cos(e), math.sin(e)))
LID_OPEN, LID_CLOSED, LID_TOP = math.radians(14), math.radians(-34), math.radians(95)
lid_info = {}
for s in 'LR':
    c = V(B['Eye'+s][0]); R = ER*1.13; na, ne = 14, 7; grid = []
    for i in range(na+1):
        a = math.radians(-85 + 170*i/na); row = []
        for j in range(ne+1):
            e = LID_OPEN + (LID_TOP-LID_OPEN)*j/ne; v = fb.verts.new(sph(c, R, a, e)); row.append(v)
            lid_info[v] = (s, c, R, a, j/ne)
        grid.append(row)
    for i in range(na):
        for j in range(ne):
            f = fb.faces.new((grid[i][j], grid[i+1][j], grid[i+1][j+1], grid[i][j+1])); f.material_index = 0
    for i in range(na):   # lower lid rim (static)
        a0, a1 = math.radians(-80+160*i/na), math.radians(-80+160*(i+1)/na)
        q = [fb.verts.new(sph(c, R*0.99, a0, math.radians(-48))), fb.verts.new(sph(c, R*0.99, a1, math.radians(-48))),
             fb.verts.new(sph(c, R*0.99, a1, math.radians(-30))), fb.verts.new(sph(c, R*0.99, a0, math.radians(-30)))]
        fb.faces.new(q).material_index = 0
mp = front(0, 1.618); MC = V((0, mp.y - 0.003, 1.618))
lips = []
for f in torus(fb, MC, (0,-1,0), 0.021, 0.0062, seg=28, rs=8, sx=1.0, sy=0.30):
    f.material_index = 1
    for v in f.verts: lips.append(v)
lips = set(lips)
for v in lips: v.co.z += 0.0075*((v.co.x - MC.x)/0.021)**2 - 0.0015; v.co.y -= 0.002   # upturned corners: a smile
inner = []
r = bmesh.ops.create_uvsphere(fb, u_segments=16, v_segments=10, radius=1.0)
for v in r['verts']: v.co = MC + V((v.co.x*0.021, 0.012 + max(v.co.y,-0.2)*0.014, v.co.z*0.013)); inner.append(v)
for f in {f for v in r['verts'] for f in v.link_faces}: f.material_index = 2
inner = set(inner); teethU, teethL = set(), set()
for z, st in ((0.0035, teethU), (-0.0045, teethL)):
    fs = box(fb, MC + V((0, 0.003, z)), (0.026, 0.005, 0.0045))
    for f in fs: f.material_index = 3; st.update(f.verts)
brow = {}
NB, NR = 14, 8
for k in (1,-1):
    rings = []
    for i in range(NB+1):
        t = i/NB; x = 0.021 + 0.050*t; z = 1.709 + 0.009*math.sin(math.pi*min(1, t*1.25)) - 0.004*t
        p = front(x*k, z) + V((0,-0.0035,0)); r = (0.0075*(1-t)**0.6 + 0.002)*min(1, 0.45 + t*4)   # tapered head, no midline bridge
        ring = []
        for j in range(NR):
            a = 2*math.pi*j/NR; v = fb.verts.new(p + V((0, math.cos(a)*r*0.7, math.sin(a)*r*0.75))); brow[v] = (k, t*4); ring.append(v)
        rings.append(ring)
    for i in range(NB):
        for j in range(NR):
            fb.faces.new((rings[i][j], rings[i+1][j], rings[i+1][(j+1)%NR], rings[i][(j+1)%NR])).material_index = 4
    for rg in (rings[0], rings[-1][::-1]): fb.faces.new(rg[::-1] if rg is rings[0] else rg).material_index = 4
fme = bpy.data.meshes.new('FaceRig');
fb.verts.index_update(); idx = {v: v.index for v in fb.verts}
lid_i = {idx[v]: d for v, d in lid_info.items()}; lips_i = {idx[v] for v in lips}; inner_i = {idx[v] for v in inner}
tU = {idx[v] for v in teethU}; tL = {idx[v] for v in teethL}; brow_i = {idx[v]: d for v, d in brow.items()}
fb.to_mesh(fme); fb.free()
face = bpy.data.objects.new('BrannFace', fme); COL.objects.link(face); fme.shade_smooth()
add_mats(face, ['skin','lips','mouth','teeth','brow']); cyl_uv(face)
def face_w(p, i=None): return [(1,'Head')]
for v in fme.vertices:
    pass
vgH = face.vertex_groups.new(name='Head'); vgJ = face.vertex_groups.new(name='Jaw')
for v in fme.vertices:
    low = (v.index in tL) or ((v.index in lips_i or v.index in inner_i) and v.co.z < MC.z - 0.0005)
    (vgJ if low else vgH).add([v.index], 1.0, 'REPLACE')
face.shape_key_add(name='Basis', from_mix=False)
def key(name, fn):
    sk = face.shape_key_add(name=name, from_mix=False)
    for v in fme.vertices:
        r = fn(v.index, v.co.copy())
        if r is not None: sk.data[v.index].co = r
for s in 'LR':
    def blink(i, co, s=s):
        if i not in lid_i or lid_i[i][0] != s: return None
        _, c, R, a, t = lid_i[i]; e = LID_CLOSED + (LID_TOP-LID_CLOSED)*t
        return sph(c, R, a, e)                       # lid slides over the eye sphere surface
    key('Blink'+s, blink)
def mouth(dz_low, sx, sz, fwd, i, co):
    if not (i in lips_i or i in inner_i or i in tL or i in tU): return None
    rel = co - MC; low = rel.z < -0.0005 or i in tL
    out = V((rel.x*sx, rel.y - fwd*(1-abs(rel.x)/0.03), rel.z*sz))
    if low: out.z -= dz_low
    elif i in lips_i or i in inner_i: out.z += dz_low*0.25
    if i in inner_i: out.y += 0.002
    return MC + out
key('MouthOpen', lambda i, co: mouth(0.019, 1.0, 1.0, 0.0, i, co))
key('MouthWide', lambda i, co: mouth(0.003, 1.32, 0.8, -0.002, i, co))
key('MouthRound', lambda i, co: mouth(0.008, 0.66, 1.6, 0.006, i, co))
def browlift(i, co):
    if i not in brow_i: return None
    k, j = brow_i[i]; return co + V((0, -0.001, 0.0065 + 0.0015*j))
key('BrowLift', browlift)

# ---------------------------------------------------------------- PRESENCE gem
gp = front(-0.095, 1.37)
pg = bmesh.new(); bmesh.ops.create_icosphere(pg, subdivisions=1, radius=1.0)
for v in pg.verts: v.co = V((v.co.x*0.022, v.co.y*0.009, v.co.z*0.026))
pme = bpy.data.meshes.new('PresenceIndicator'); pg.to_mesh(pme); pg.free()
presence = bpy.data.objects.new('PresenceIndicator', pme); COL.objects.link(presence); pme.materials.append(M['gem'])
presence_pos = gp + V((0,-0.03,0))

# ---------------------------------------------------------------- HAMMER (supplied project data)
bpy.ops.import_scene.gltf(filepath=HAMMER_GLB)
hms = [o for o in bpy.context.selected_objects if o.type == 'MESH']
for o in bpy.context.selected_objects:
    if o.type != 'MESH': continue
bpy.ops.object.select_all(action='DESELECT')
for o in hms:
    o.select_set(True); bpy.context.view_layer.objects.active = o
    o.data = o.data.copy(); o.data.transform(o.matrix_world); o.parent = None; o.matrix_world = Matrix()
if len(hms) > 1: bpy.ops.object.join()
hammer = bpy.context.view_layer.objects.active; hammer.name = 'NPCHammer'
for o in list(bpy.data.objects):
    if o.type == 'EMPTY': bpy.data.objects.remove(o)
FACE_L, GRIP_L = V((-0.2285, 0.0, 0.48)), V((0.0, 0.0, 0.15))   # hammer.glb coords converted to Blender
def frame(z_dir, face_dir):
    Z = V(z_dir).normalized(); f = V(face_dir); f = (f - Z*f.dot(Z)).normalized(); X = -f; Y = Z.cross(X)
    return Matrix((X, Y, Z)).transposed()
def hammer_mat(R, grip_world):
    m = R.to_4x4(); m.translation = V(grip_world) - R @ GRIP_L; return m
W_R = V(B['HandR'][0]); dR = bdir('HandR')
n_R = V((1,0,0)); l_R = dR.cross(n_R).normalized(); n_R = l_R.cross(dR).normalized()
GRIP_REST = W_R + dR*0.062 + n_R*0.026
H_REST = hammer_mat(frame((0.05,-0.30,-0.95), (0,-1,0)), GRIP_REST)
hammer.data.transform(H_REST)

# ---------------------------------------------------------------- ARMATURE
ad = bpy.data.armatures.new('BrannRig'); arm = bpy.data.objects.new('BrannRig', ad); COL.objects.link(arm)
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='EDIT')
for n, (h, t, par, d) in B.items():
    eb_ = ad.edit_bones.new(n); eb_.head = h; eb_.tail = t; eb_.use_deform = d; eb_.roll = 0
for n, (h, t, par, d) in B.items():
    if par: ad.edit_bones[n].parent = ad.edit_bones[par]
hs = ad.edit_bones.new('HammerSocket'); hs.head = GRIP_REST; hs.tail = GRIP_REST + H_REST.to_3x3() @ V((0,0,0.1))
hs.align_roll(H_REST.to_3x3() @ V((-1,0,0))); hs.parent = ad.edit_bones['HandR']
hf = ad.edit_bones.new('HammerFace'); FACE_REST = H_REST @ FACE_L; hf.head = FACE_REST
hf.tail = FACE_REST + H_REST.to_3x3() @ V((-0.03,0,0)); hf.parent = hs; hf.use_deform = False
bpy.ops.object.mode_set(mode='OBJECT')
B['HammerSocket'] = (tuple(GRIP_REST), None, 'HandR', True)
for o in (body, apron, gearo, hair, eyes, face, hammer):
    o.parent = arm; md = o.modifiers.new('Armature', 'ARMATURE'); md.object = arm
vg = hammer.vertex_groups.new(name='HammerSocket'); vg.add(list(range(len(hammer.data.vertices))), 1.0, 'REPLACE')
presence.parent = arm; presence.parent_type = 'BONE'; presence.parent_bone = 'Chest'
presence.matrix_world = Matrix.Translation(presence_pos)

# ---------------------------------------------------------------- ANIMATION
pb = arm.pose.bones
for p in pb: p.rotation_mode = 'QUATERNION'
ANIM_BONES = [n for n in B if n != 'Root'] + ['HammerSocket']
def q_world(name, axis, deg):
    rest = ad.bones[name].matrix_local.to_3x3()
    return Quaternion(rest.inverted() @ V(axis), math.radians(deg))
def pose(d):
    for p in pb: p.rotation_quaternion = Quaternion(); p.location = V()
    for name, rots in d.items():
        q = Quaternion()
        for ax, deg in rots: q = q @ q_world(name, ax, deg)
        pb[name].rotation_quaternion = q
def keyall(f):
    for n in ANIM_BONES:
        pb[n].keyframe_insert('rotation_quaternion', frame=f); pb[n].keyframe_insert('location', frame=f)
X, Y, Z = (1,0,0), (0,1,0), (0,0,1)
def secondary(t, amp=1.0, lag=0.0):
    w = 2*math.pi*t
    return {'Beard1': [(X, 2.5*amp*math.sin(w-0.6-lag))], 'Beard2': [(X, 3.5*amp*math.sin(w-1.2-lag))],
            'BraidL1': [(X, 4*amp*math.sin(w-0.9-lag)), (Y, 3*amp*math.sin(w-0.4))], 'BraidL2': [(X, 6*amp*math.sin(w-1.6-lag))],
            'BraidR1': [(X, 4*amp*math.sin(w-1.1-lag)), (Y, -3*amp*math.sin(w-0.7))], 'BraidR2': [(X, 6*amp*math.sin(w-1.9-lag))],
            'ApronL': [(X, -2*amp*math.sin(w-0.8))], 'ApronR': [(X, -2*amp*math.sin(w-1.0))]}
BASE = {'UpperArmL': [(X,-4),(Y,6)], 'UpperArmR': [(X,-6),(Y,-4)], 'ForearmL': [(X,-12)], 'ForearmR': [(X,-28)],
        'FingersL': [(X,-15)], 'FingersR': [(X, -55)], 'HandR': [(Z, 0)]}
def merge(*ds):
    out = {}
    for d in ds:
        for k, v in d.items(): out.setdefault(k, []).extend(v)
    return out
CLIPS = {}
def make_clip(name, nf, fn, step=5):
    arm.animation_data_create(); arm.animation_data.action = None
    for f in list(range(0, nf, step)) + [nf]:
        pose(fn(f/nf)); keyall(f)
    act = arm.animation_data.action; act.name = name; act.use_fake_user = True; CLIPS[name] = (act, nf)
    return act
S = math.sin; TAU = 2*math.pi
make_clip('Idle', 100, lambda t: merge(BASE, secondary(t), {
    'Hips': [(Y, 1.6*S(TAU*t))], 'Spine': [(Y, -1.0*S(TAU*t)), (X, 1.2*S(2*TAU*t))], 'Chest': [(X, -1.8*S(2*TAU*t)), (Y, -0.8*S(TAU*t))],
    'ShoulderL': [(Y, 1.5*S(2*TAU*t))], 'ShoulderR': [(Y, -1.5*S(2*TAU*t))],
    'Head': [(Z, 6*S(TAU*t+0.5)), (X, 2*S(2*TAU*t+1)), (Y, -1.6*S(TAU*t))],
    'ThighL': [(Y, -1.6*S(TAU*t))], 'ThighR': [(Y, -1.6*S(TAU*t))], 'FootL': [(Y, 1.6*S(TAU*t))], 'FootR': [(Y, 1.6*S(TAU*t))],
    'EyeL': [(Z, 5*S(TAU*t+0.5))], 'EyeR': [(Z, 5*S(TAU*t+0.5))]}))
make_clip('Listen', 100, lambda t: merge(BASE, secondary(t, 0.7), {
    'Spine': [(X, 4 + 1*S(TAU*t))], 'Chest': [(X, 3 - 1.5*S(2*TAU*t))],
    'Head': [(Y, 9 + 2*S(TAU*t)), (X, 5 + 3*max(0, S(2*TAU*t))), (Z, 4)],
    'UpperArmL': [(X,-14),(Y,4)], 'ForearmL': [(X,-55)], 'HandL': [(X, -10)],
    'EyeL': [(Z, 3)], 'EyeR': [(Z, 3)]}))
def talk(t):
    g = S(TAU*2*t); g2 = S(TAU*3*t+1)
    return merge(BASE, secondary(t, 1.2), {
        'Spine': [(X, 2), (Z, 3*S(TAU*t))], 'Chest': [(Z, 2.5*g), (X, 1.5*g2)],
        'Head': [(X, 4*g2), (Z, -5*S(TAU*t)), (Y, 3*g)], 'Jaw': [(X, -3 - 3*max(0, S(TAU*6*t)))],
        'ShoulderL': [(Z, -4 - 3*g)], 'UpperArmL': [(X, -28 - 12*g), (Y, -10 + 6*g2)], 'ForearmL': [(X, -55 - 20*g2)],
        'HandL': [(Z, 20*g), (Y, 15*g2)], 'FingersL': [(X, -10 - 10*g)],
        'UpperArmR': [(X, -8 - 3*g2), (Y, -4)], 'ForearmR': [(X, -32 - 4*g)]})
make_clip('Talk', 100, talk)
def greet(t):
    up = math.sin(math.pi*min(1, t/0.85))**0.7 if t < 0.85 else 0.0; wave = S(TAU*3*t)
    return merge(BASE, secondary(t, 1.5), {
        'Spine': [(X, -2*up), (Z, 5*up)], 'Chest': [(Z, 4*up)], 'Head': [(Y, 5*up), (X, -3*up), (Z, 4*up)],
        'ShoulderL': [(Y, -12*up)], 'UpperArmL': [(X, -55*up), (Y, -40*up)], 'ForearmL': [(X, -85*up), (Z, 15*up*wave)],
        'HandL': [(Y, -18*up*wave), (X, 10*up)], 'FingersL': [(X, 10*up)]})
make_clip('Greet', 50, greet)
def inspect(t):
    lift = math.sin(math.pi*min(1, t/0.9))**0.8 if t < 0.9 else 0.0; turn = S(TAU*t)
    return merge(BASE, secondary(t, 1.0), {
        'Spine': [(X, 4*lift), (Z, -6*lift)], 'Chest': [(X, 4*lift)], 'Head': [(X, 16*lift), (Z, -14*lift)],
        'UpperArmR': [(X, -38*lift), (Y, 8*lift)], 'ForearmR': [(X, -72*lift)], 'HandR': [(Y, 40*lift*turn), (Z, 25*lift)],
        'UpperArmL': [(X, -35*lift), (Y, 5*lift)], 'ForearmL': [(X, -75*lift)], 'HandL': [(Z, -30*lift*turn)],
        'EyeL': [(X, 12*lift), (Z, -10*lift)], 'EyeR': [(X, 12*lift), (Z, -10*lift)]})
make_clip('Inspect', 75, inspect)
def present(t):
    o = math.sin(math.pi*min(1, t/0.9))**0.6 if t < 0.9 else 0.0
    return merge(BASE, secondary(t, 1.0), {
        'Spine': [(X, 3*o), (Z, 6*o)], 'Head': [(X, 4*o), (Z, 6*o), (Y, 4*o)],
        'UpperArmL': [(X, -42*o), (Y, -14*o)], 'ForearmL': [(X, -38*o)], 'HandL': [(Z, -70*o), (X, 15*o)], 'FingersL': [(X, 12*o)]})
make_clip('Present', 50, present)

# Forge: torso/off-hand FK + baked IK so the hammer face lands on the contact marker at phase 0.72
TARGET = V((-0.43, -1.10, 1.29))        # Godot (-0.43,1.29,1.10) in Blender axes
NF, CONTACT = 25, 18                     # 25 fps -> 1.0 s clip, contact frame 18 = phase 0.72
TILT = math.radians(35)
R_C = frame((0, -math.cos(TILT), math.sin(TILT)), (0, -math.sin(TILT), -math.cos(TILT)))
H_C = Matrix.Translation(TARGET - R_C @ FACE_L) @ R_C.to_4x4()
hand_rest = ad.bones['HandR'].matrix_local
hand_to_h = hand_rest.inverted() @ H_REST
PIV = V((-0.2, -0.16, 1.40))
def hammer_at(phi):
    r = Matrix.Translation(PIV) @ Matrix.Rotation(math.radians(phi), 4, 'X') @ Matrix.Translation(-PIV)
    return r @ H_C
FK = [(0, -38, 12), (10, -100, 2), (15, -40, 18), (CONTACT, 0, 30), (20, -10, 28), (NF, -38, 12)]
def forge_pose(lean, f):
    t = f/NF; s = lean/30.0
    return merge(secondary(t, 1.6, lag=0.3), {
        'Spine': [(X, lean*0.45), (Z, -6*s)], 'Chest': [(X, lean*0.55), (Z, -5*s)], 'Neck': [(X, -lean*0.35)],
        'Head': [(X, -lean*0.25 + 8), (Z, -10)], 'EyeL': [(X, 10), (Z, -6)], 'EyeR': [(X, 10), (Z, -6)],
        'ShoulderR': [(Z, 14*s+4)], 'ShoulderL': [(Z, -6*s)],
        'UpperArmL': [(X, -20 - lean*0.5), (Y, 18)], 'ForearmL': [(X, -60)], 'HandL': [(X, 20)], 'FingersL': [(X, -30)],
        'ThighL': [(X, -4*s)], 'ThighR': [(X, -4*s)], 'ShinL': [(X, 6*s)], 'ShinR': [(X, 6*s)], 'FootL': [(X, -2*s)], 'FootR': [(X, -2*s)],
        'FingersR': [(X, -55)], 'ForearmR': [(X, -40)]})
tgt = bpy.data.objects.new('IKTarget', None); COL.objects.link(tgt); tgt.rotation_mode = 'QUATERNION'
arm.animation_data.action = None
def lerp_key(f):
    for (f0, p0, l0), (f1, p1, l1) in zip(FK, FK[1:]):
        if f0 <= f <= f1:
            u = (f-f0)/(f1-f0); u = u*u*(3-2*u); return p0+(p1-p0)*u, l0+(l1-l0)*u
for f in range(NF+1):
    phi, lean = lerp_key(f); pose(forge_pose(lean, f)); keyall(f)
    hm = hammer_at(phi); hand = hm @ hand_to_h.inverted()
    tgt.location = hand.translation; tgt.rotation_quaternion = hand.to_quaternion()
    tgt.keyframe_insert('location', frame=f); tgt.keyframe_insert('rotation_quaternion', frame=f)
forge_act = arm.animation_data.action; forge_act.name = 'Forge'; forge_act.use_fake_user = True
ik = pb['ForearmR'].constraints.new('IK'); ik.target = tgt; ik.chain_count = 3; ik.use_tail = True; ik.use_stretch = False
cr = pb['HandR'].constraints.new('COPY_ROTATION'); cr.target = tgt
bpy.context.view_layer.objects.active = arm; arm.select_set(True); bpy.ops.object.mode_set(mode='POSE')
bpy.ops.pose.select_all(action='SELECT')
bpy.ops.nla.bake(frame_start=0, frame_end=NF, only_selected=False, visual_keying=True, clear_constraints=True,
                 use_current_action=True, bake_types={'POSE'})
bpy.ops.object.mode_set(mode='OBJECT')
forge_act = arm.animation_data.action; forge_act.name = 'Forge'; forge_act.use_fake_user = True; CLIPS['Forge'] = (forge_act, NF)
bpy.data.objects.remove(tgt)
for p in pb:
    for c in list(p.constraints): p.constraints.remove(c)
scn.frame_set(CONTACT)
fw = arm.matrix_world @ pb['HammerFace'].head
err = (fw - TARGET).length
print('FORGE_CONTACT_BLENDER', tuple(round(x,4) for x in fw), 'err', round(err,4))
# hand/hammer rigidity check
scn.frame_set(10); rel10 = pb['HandR'].matrix.inverted() @ pb['HammerSocket'].matrix
scn.frame_set(CONTACT); rel18 = pb['HandR'].matrix.inverted() @ pb['HammerSocket'].matrix
print('HAMMER_IN_HAND_DRIFT', round((rel10.translation-rel18.translation).length, 6))

# NLA tracks so each clip exports with its exact name
arm.animation_data.action = None
for name, (act, nf) in CLIPS.items():
    tr = arm.animation_data.nla_tracks.new(); tr.name = name; st = tr.strips.new(name, 0, act); tr.mute = False
    for fc in act.fcurves:
        for kp in fc.keyframe_points: kp.interpolation = 'BEZIER' if name != 'Forge' else 'LINEAR'
scn.frame_set(0)

# ---------------------------------------------------------------- export
bpy.ops.object.select_all(action='DESELECT')
for o in (arm, body, apron, gearo, hair, eyes, face, hammer, presence): o.select_set(True)
glb = os.path.join(OUT, 'brann.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_animations=True,
    export_animation_mode='NLA_TRACKS', export_morph=True, export_skins=True, export_yup=True,
    export_force_sampling=True, export_frame_step=1, export_def_bones=False, export_morph_animation=False,
    export_anim_single_armature=True, export_reset_pose_bones=True, export_image_format='JPEG', export_jpeg_quality=88)
for tr in arm.animation_data.nla_tracks: tr.mute = True
arm.animation_data.action = CLIPS['Idle'][0]
try: bpy.ops.file.pack_all()
except Exception as e: print('pack', e)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'brann.blend'))
print('BUILD OK', os.path.getsize(glb))
