"""Reproducible stylized GAME PROP assembly; Blender 4.5 LTS, no external APIs.
Coordinates in this builder are Godot item-local: X across, Y forward, Z top.
The original authored shell is retained. New moving nodes have stable names.
"""
import bpy, json, math, time, sys, traceback
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'godot/assets/siegebird'
REPORT = ROOT / 'outputs/Siegebird-Rebuilt'
P = json.loads((OUT/'assembly.json').read_text(encoding='utf-8-sig'))
START = time.perf_counter()
TAU = math.tau
def v(p): return Vector((p[0], -p[2], p[1]))
def empty(name, pos=(0,0,0), parent=None):
    o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o)
    o.location=v(pos); o.parent=parent
    return o
def mat(name,color,metal=0,rough=.4,alpha=1):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,alpha); m.use_nodes=True
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,alpha)
    bs.inputs['Metallic'].default_value=metal; bs.inputs['Roughness'].default_value=rough
    bs.inputs['Alpha'].default_value=alpha
    if alpha<1: m.surface_render_method='DITHERED'
    return m
def finish(o,name,m,parent=None):
    o.name=name; o.data.materials.clear(); o.data.materials.append(m)
    if parent: o.parent=parent
    return o
def box(name,pos,size,m,parent=None,bevel=.003):
    bpy.ops.mesh.primitive_cube_add(size=1,location=v(pos)); o=bpy.context.object
    o.dimensions=(size[0],size[2],size[1]); bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        mod=o.modifiers.new('Crafted edges','BEVEL'); mod.width=bevel; mod.segments=2
        bpy.ops.object.modifier_apply(modifier=mod.name)
    return finish(o,name,m,parent)
def rod(name,a,b,r,m,parent=None,vertices=16):
    a,b=v(a),v(b); d=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=d.length,location=(a+b)*.5)
    o=bpy.context.object; o.rotation_mode='QUATERNION'; o.rotation_quaternion=d.to_track_quat('Z','Y')
    return finish(o,name,m,parent)
def ring(name,pos,major,minor,m,parent=None):
    bpy.ops.mesh.primitive_torus_add(major_segments=48,minor_segments=8,location=v(pos),major_radius=major,minor_radius=minor)
    o=bpy.context.object; o.rotation_euler.y=math.pi/2
    return finish(o,name,m,parent)
def gear(name,pos,r,n,m):
    root=empty(name,pos)
    # Deliberately relieved stylized tooth flanks. Clearance is sampled below.
    points=[]
    for i in range(n):
        for f,rr in [(-.50,.88),(-.32,.88),(-.18,1.00),(-.10,1.065),(.10,1.065),(.18,1.00),(.32,.88),(.50,.88)]:
            a=TAU*(i+f)/n; points.append((math.cos(a)*r*rr,math.sin(a)*r*rr))
    verts=[]
    for x in [-.010,.010]:
        verts += [v((x,y,z)) for y,z in points]
    count=len(points); faces=[]
    faces.append(tuple(reversed(range(count)))); faces.append(tuple(range(count,count*2)))
    for i in range(count):
        j=(i+1)%count; faces.append((i,j,count+j,count+i))
    mesh=bpy.data.meshes.new(name+'Mesh'); mesh.from_pydata(verts,[],faces); mesh.update()
    obj=bpy.data.objects.new(name+'Teeth',mesh); bpy.context.collection.objects.link(obj); obj.parent=root; obj.data.materials.append(m)
    # Flat decorative blue inserts read as pierced windows without booleans.
    for i in range(5):
        a=TAU*i/5
        rod(name+'Inlay',(.011,math.cos(a)*r*.52,math.sin(a)*r*.52),(.012,math.cos(a)*r*.52,math.sin(a)*r*.52),r*.13,steel,root)
    rod(name+'Hub',(-.017,0,0),(.019,0,0),r*.23,brass,root)
    return root

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(ROOT/'assets/siegebird/original.glb'))
for o in list(bpy.context.scene.objects):
    if o.name[:2] in ['05','09','11','12','13','14','15','16','17','19','20']:
        bpy.data.objects.remove(o,do_unlink=True)
brass=mat('Warm machined brass',(.58,.35,.12),.72)
edge=mat('Polished golden edges',(.85,.61,.25),.7,.26)
steel=mat('Midnight blue enamel',(.065,.14,.21),.62,.32)
copper=mat('Copper fittings',(.53,.24,.12),.65)
wood=mat('Oiled walnut',(.23,.10,.055),0,.48)
leather=mat('Dark grip leather',(.07,.038,.025),0,.75)
stringmat=mat('Braided linen',(.71,.57,.34),.1,.65)
glass=mat('Amethyst optic',(.46,.19,.72),.1,.18,.22)
glow=mat('Mint sight pip',(.37,.95,.76),.1,.2)
bs=glow.node_tree.nodes.get('Principled BSDF'); bs.inputs['Emission Color'].default_value=(.2,.9,.6,1); bs.inputs['Emission Strength'].default_value=1.5

# Open double rail leaves a real channel for the shaft and draw shuttle.
box('RailBed',(0,.79,.16),(.060,.62,.024),steel)
for side in [-1,1]:
    box('Rail', (side*.043,.79,.137),(.022,.62,.022),steel)
    box('RailTrim',(side*.055,.79,.15),(.008,.61,.008),edge,bevel=.002)
    for y in [.52,.67,.83,1.05]:
        rod('RailBolt',(side*.043,y,.15),(side*.043,y,.158),.008,copper)

crank=empty('Crank',P['crank_center'])
ring('CrankRim',(0,0,0),.112,.011,edge,crank)
for i in range(6):
    a=TAU*i/6
    rod('WheelSpoke',(0,0,0),(0,math.cos(a)*.106,math.sin(a)*.106),.007,brass,crank)
rod('CrankArm',(.021,0,0),(.021,-.15,0),.014,copper,crank)
knob=empty('CrankKnob',(.065,-.15,0),crank)
rod('Knob',(-.036,0,0),(.038,0,0),.025,wood,knob)
for x in [-.036,.035]: ring('KnobFerrule',(x,0,0),.022,.004,edge,knob)
rod('CrankAxle',(.045,.54,0),(.32,.54,0),.015,steel)
box('DriveMount',(.085,.59,.015),(.10,.20,.075),steel)
for y in [.54,.648]:
    rod('Bearing',(.075,y,0),(.119,y,0),.027,brass)
    ring('BearingLip',(.12,y,0),.022,.004,edge)
    for z in [-.028,.028]: rod('MountRivet',(.137,y,z),(.141,y,z),.005,copper)
pinion=gear('Pinion',P['pinion_center'],P['pinion_radius'],10,brass)
reduction=gear('Reduction',P['gear_center'],P['gear_radius'],20,edge)
drum=empty('Drum',(.14,.648,0))
drum_radius=P['travel']/TAU
rod('DrumCore',(-.025,0,0),(.025,0,0),drum_radius,wood,drum,32)
for x in [-.028,.028]: rod('DrumFlange',(x-.003,0,0),(x+.003,0,0),drum_radius+.006,brass,drum,32)
for i in range(9): ring('WoundCord',(-.021+i*.005,0,0),drum_radius+.001,.0018,stringmat,drum)
rod('DrumAxle',(.045,.648,0),(.22,.648,0),.012,steel)
clutch=empty('Clutch',(.243,.54,0))
rod('ClutchSleeve',(-.01,0,0),(.01,0,0),.026,copper,clutch)
for a in range(6):
    angle=TAU*a/6
    box('ClutchDog',(.015,math.cos(angle)*.021,math.sin(angle)*.021),(.012,.009,.009),edge,clutch,.001)
pawl=empty('Latch',(.11,.535,.17))
rod('LatchFinger',(0,0,0),(-.09,0,.025),.01,brass,pawl)
box('ReleaseLever',(.04,0,-.01),(.05,.014,.022),copper,pawl)
# Sculpted palm swell, copper bird relief and a curved moving finger shoe.
box('PalmSwell',(0,.20,-.155),(.064,.085,.16),wood,bevel=.014)
for side in [-1,1]:
    box('GripCheek',(side*.034,.20,-.155),(.008,.065,.13),leather,bevel=.008)
    for i in range(5):
        rod('EmbossFeather',(side*.039,.225-i*.008,-.12),(side*.040,.20-i*.006,-.195),.0025,edge)
    rod('BirdBeak',(side*.041,.23,-.12),(side*.041,.24,-.14),.003,brass)
for side in [-1,1]:
    rod('BirdHead',(side*.038,.232,-.13),(side*.042,.232,-.13),.010,edge)
    rod('BirdEye',(side*.043,.235,-.127),(side*.044,.235,-.127),.002,steel)
    rod('BirdBack',(side*.040,.225,-.134),(side*.040,.186,-.189),.003,edge)
    rod('BirdTail',(side*.040,.186,-.189),(side*.040,.172,-.211),.003,edge)
# Small countersunk copper fasteners and leather edge stitching frame the bird.
for side in [-1,1]:
    for z in [-.105,-.204]:
        rod('GripScrew',(side*.038,.20,z),(side*.043,.20,z),.005,copper)
        box('ScrewSlot',(side*.0435,.20,z),(.001,.006,.0015),steel,bevel=0)
    for i in range(9):
        z=-.108-i*.011
        rod('LeatherStitch',(side*.039,.176,z),(side*.039,.179,z-.004),.0008,stringmat,vertices=6)
box('GripHeel',(0,.20,-.232),(.066,.071,.011),copper,bevel=.004)
trigger=empty('Trigger',(0,.267,-.10))
for i in range(7):
    a=i/7; b=(i+1)/7
    rod('TriggerShoe',(0,.018*a,-.046*a),(0,.018*b,-.046*b),.007,brass,trigger)
box('TriggerFingerPad',(0,.018,-.046),(.024,.012,.021),copper,trigger,bevel=.004)
for a,b in [((-.022,.24,-.19),(-.022,.35,-.19)),((-.022,.35,-.19),(-.022,.35,-.075)),((-.022,.35,-.075),(-.022,.285,-.075))]:
    rod('FingerGuard',a,b,.0045,brass)
# Cable runs on the right side of the stock, clear of the bolt channel.
guide_z=drum_radius+.001+.024
rod('GuideAxle',(.085,.455,guide_z),(.158,.455,guide_z),.006,steel)
rod('GroovedGuide',(.135,.455,guide_z),(.145,.455,guide_z),.0222,brass,vertices=32)
for x in [.134,.146]: ring('GuideFlange',(x,.455,guide_z),.024,.0035,edge)
box('GuideMount',(.095,.455,guide_z),(.025,.06,.045),steel)
sled=empty('Sled',(0,P['draw_rear'],0))
for side in [-1,1]:
    box('ShuttleRunner',(side*.071,0,.16),(.014,.043,.022),copper,sled)
box('StringShoe',(0,-.010,.181),(.148,.014,.013),brass,sled)
box('DrawEar',(.092,0,.137),(.10,.022,.012),copper,sled)

# Raised, open optic: no plate across the bolt path or the viewing aperture.
optic=empty('OpticRear',P['optic_rear'])
for y in [.63,.88]:
    for side in [-1,1]:
        rod('OpticUpright',(side*.088,y,.20),(side*.088,y,.385),.01,steel)
    box('OpticTop',(0,y,.389),(.196,.019,.018),steel)
    box('OpticFoot',(0,y,.231),(.19,.019,.018),brass)
for x in [-.088,.088]:
    for z in [.231,.389]: rod('OpticCage',(x,.63,z),(x,.88,z),.005,edge)
# Elongated, cut amethyst with a clearly visible faceted silhouette.
verts=[v((0,.637,.315)),v((0,.871,.315))]
for y in [.68,.832]:
    for i in range(6):
        a=TAU*i/6
        verts.append(v((math.cos(a)*.063,y,.315+math.sin(a)*.063)))
faces=[]
for i in range(6):
    j=(i+1)%6
    faces.extend([(0,2+j,2+i),(2+i,2+j,8+j,8+i),(1,8+i,8+j)])
mesh=bpy.data.meshes.new('CutAmethyst'); mesh.from_pydata(verts,[],faces); mesh.update()
o=bpy.data.objects.new('Amethyst',mesh); bpy.context.collection.objects.link(o); o.data.materials.append(glass)
# Apertures in planes normal to the rail (Blender Z).
for y,r,m in [(.628,.022,edge),(.876,.004,glow)]:
    bpy.ops.mesh.primitive_torus_add(major_segments=32,minor_segments=6,location=v((0,y,.315)),major_radius=r,minor_radius=.002)
    finish(bpy.context.object,'Reticle',m)
for side in [-1,1]:
    box('CrystalProng',(side*.059,.75,.256),(.01,.1,.016),brass)
bolt=empty('Bolt',P['bolt_seat'])
rod('BoltShaft',(0,-.235,0),(0,.43,0),.006,wood,bolt)
rod('BoltCollar',(0,.425,0),(0,.455,0),.011,copper,bolt)
# Faceted stylized point, aligned along forward Y.
bpy.ops.mesh.primitive_cone_add(vertices=4,radius1=.022,radius2=0,depth=.078,location=v((0,.487,0)))
finish(bpy.context.object,'BoltPoint',steel,bolt)
for side in [-1,1]: box('Fletching',(side*.011,-.19,0),(.019,.07,.003),steel,bolt,.001)
box('TopFletching',(0,-.19,.01),(.003,.07,.019),copper,bolt,.001)
empty('BoltSeat',P['bolt_seat']); empty('GripAnchor',(0,.20,-.155)); empty('SupportAnchor',(0,.93,.025))

# Batch cosmetic grip details by material; stitching should not cost one draw per stitch.
for material in [copper,steel,stringmat]:
    details=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.name.startswith(('GripScrew','ScrewSlot','LeatherStitch','GripHeel')) and o.data.materials[0]==material]
    if len(details)>1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in details: o.select_set(True)
        bpy.context.view_layer.objects.active=details[0]
        bpy.ops.object.join()
        bpy.context.object.name='GripFinish_'+material.name

# Bake each fixed mesh transform; parents retain the stable motion pivots.
for o in bpy.context.scene.objects:
    if o.type=='MESH':
        o.data.transform(o.matrix_basis); o.matrix_basis=Matrix.Identity(4)
        o.data.update()

# Controlled limb flex keeps the laminations and string anchors together.
flex=[]
for o in bpy.context.scene.objects:
    if o.type=='MESH' and o.name[:2] in ['06','07','08','18']:
        o.shape_key_add(name='Basis')
        key=o.shape_key_add(name='Drawn')
        for vertex in key.data:
            weight=max(0,min(1,(abs(vertex.co.x)-.15)/.40))**2
            vertex.co.z-=.03*weight
        narrow=o.shape_key_add(name='Narrow')
        for vertex in narrow.data:
            weight=max(0,min(1,(abs(vertex.co.x)-.15)/.40))**2
            vertex.co.x-=math.copysign(.053*weight,vertex.co.x)
        flex.append((key,narrow))

ropes=empty('LiveCord')
rope_parts=[rod('BowCord' if i<2 else 'DrawCord',(0,0,0),(0,1,0),.002 if i<2 else .0018,stringmat,ropes,8) for i in range(20)]
def rope_pose(o,a,b):
    a,b=v(a),v(b); d=b-a
    o.location=(a+b)*.5; o.rotation_quaternion=d.to_track_quat('Z','Y')
    o.scale=(1,1,d.length)

def cable_path(draw_y):
    r=.024; z=P['travel']/TAU+.001+r; dy=draw_y-.455; dz=.137-z
    d2=dy*dy+dz*dz; h=math.sqrt(d2-r*r)
    ny=(r*dy-dz*h)/d2; nz=(r*dz+dy*h)/d2
    angle=math.atan2(nz,ny)-TAU
    arc=[(.14,.455+r*math.cos(-math.pi/2+(angle+math.pi/2)*i/16),z+r*math.sin(-math.pi/2+(angle+math.pi/2)*i/16)) for i in range(17)]
    return [(.14,.648,P['travel']/TAU+.001)]+arc+[(.14,draw_y,.137)]

def pose(draw,angle=None):
    tip_y=.80-.03*draw
    draw_y=P['draw_front']-P['travel']*draw
    tip_x=math.sqrt(.551**2+.01**2-(tip_y-draw_y)**2)
    for key,narrow in flex:
        key.value=draw
        narrow.value=(.551-tip_x)/.053
    a=draw*TAU*P['crank_turns'] if angle is None else angle
    crank.rotation_euler.x=a
    knob.rotation_euler.x=-a
    pinion.rotation_euler.x=draw*TAU*P['crank_turns']
    reduction.rotation_euler.x=-draw*TAU*P['crank_turns']/2+math.pi/20
    drum.rotation_euler.x=-draw*TAU*P['crank_turns']/2
    travel=P['draw_front']-P['travel']*draw
    sled.location=v((0,travel,0))
    for i,side in enumerate([-1,1]): rope_pose(rope_parts[i],(side*tip_x,tip_y,.105),(0,travel,.179))
    cable=cable_path(travel)
    for i in range(18): rope_pose(rope_parts[i+2],cable[i],cable[i+1])
    bpy.context.view_layer.update()

def tree(o):
    deps=bpy.context.evaluated_depsgraph_get()
    ev=o.evaluated_get(deps); mesh=ev.to_mesh()
    verts=[ev.matrix_world@p.co for p in mesh.vertices]
    b=BVHTree.FromPolygons(verts,[tuple(p.vertices) for p in mesh.polygons],all_triangles=False,epsilon=0.00001)
    ev.to_mesh_clear(); return b

# Targeted swept intersections. Intended contact pairs (shaft/bearing, string/shoe,
# optic brackets/stock) are not treated as unintended penetrations.
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
def descendant(o,root):
    while o.parent:
        o=o.parent
        if o==root: return True
    return False
def descendants(root): return [o for o in meshes if descendant(o,root)]
moving=descendants(crank)+descendants(pinion)+descendants(reduction)+descendants(sled)+descendants(clutch)+descendants(bolt)+rope_parts
fixed=[o for o in meshes if not o.parent and o.name.startswith(('01','02','05','06','07','08','Rail','Optic'))]
violations=[]
anchor_contacts=0
fixed_trees={o.name:tree(o) for o in fixed}
for i in range(129):
    pose(i/128)
    # Gear teeth are tested against one another at all sampled phases.
    g1=next(o for o in descendants(pinion) if 'Teeth' in o.name)
    g2=next(o for o in descendants(reduction) if 'Teeth' in o.name)
    if tree(g1).overlap(tree(g2)): violations.append({'frame':i,'a':g1.name,'b':g2.name})
    for a in moving:
        ta=tree(a)
        for b in fixed:
            if a.parent==sled and b.name.startswith('Rail'): continue # carriage contacts rails by design
            hits=ta.overlap(tree(b) if b.data.shape_keys else fixed_trees[b.name])
            if hits:
                # Cord is tied to the outer tip ferrules: only those contact faces are allowed.
                if a.name.startswith('BowCord') and b.name.startswith('08') and all(abs((b.matrix_world@b.data.polygons[j].center).x)>.51 for _,j in hits):
                    anchor_contacts+=1
                    continue
                pair={'frame':i,'a':a.name,'b':b.name}
                if not any(x['a']==a.name and x['b']==b.name for x in violations): violations.append(pair)
pose(1)
REPORT.mkdir(parents=True,exist_ok=True)
report={'samples':129,'intended_tip_contacts':anchor_contacts,'checks':'gear teeth, crank, sled, clutch, bolt and dynamic ropes vs fixed shell/rails/optic','violations':violations,'limits':'Triangle surface intersections only; not a solid containment or continuous clearance proof. Hands, solid containment and exported runtime require additional checks.','seconds':time.perf_counter()-START}
(REPORT/'assembly-review.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
if violations:
    with (ROOT/'logs/work-timing.csv').open('a',encoding='utf-8') as f: f.write(f'siegebird-blender-build,rejected-intersections,{time.perf_counter()-START}\n')
    raise RuntimeError('Assembly intersections found; prior game asset preserved. See assembly-review.json')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'assets/siegebird/Siegebird.blend'))
bpy.ops.export_scene.gltf(filepath=str(OUT/'siegebird.glb'),export_format='GLB',export_animations=False,export_extras=True)
print('SIEGEBIRD_BUILD',json.dumps(report))
with (ROOT/'logs/work-timing.csv').open('a',encoding='utf-8') as f: f.write(f'siegebird-blender-build,completed,{time.perf_counter()-START}\n')

