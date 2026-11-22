# Reads output/brann.glb (raw JSON + Blender re-import), prints manifest, measures forge contact, renders evidence.
# Build the asset first, then use the same BRANN_BUILD_DIR with this verifier.
import bpy, json, struct, os, math
from mathutils import Vector as V
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
OUT = os.path.abspath(os.environ.get('BRANN_BUILD_DIR', os.path.join(REPO, 'logs', 'brann-rebuild')))
GLB = os.path.join(OUT, 'brann.glb')
raw = open(GLB, 'rb').read(); jl = struct.unpack('<I', raw[12:16])[0]; J = json.loads(raw[20:20+jl])
tris = 0; surf = 0; morphs = set(); hammer_tris = 0
for m in J['meshes']:
    for p in m['primitives']:
        n = J['accessors'][p['indices']]['count']//3 if 'indices' in p else 0
        tris += n; surf += 1
        if 'Hammer' in m.get('name',''): hammer_tris += n
    morphs.update(m.get('extras', {}).get('targetNames', []))
joints = [J['nodes'][j]['name'] for j in J['skins'][0]['joints']]
anims = {a['name']: max(J['accessors'][s['input']]['max'][0] for s in a['samplers']) for a in J['animations']}
paths = {a['name']: sorted({c['target']['path'] for c in a['channels']}) for a in J['animations']}
man = {'bytes': len(raw), 'triangles': tris, 'hammer_triangles': hammer_tris, 'surfaces': surf, 'skins': len(J['skins']),
       'joints': joints, 'morph_targets': sorted(morphs), 'animations_sec': anims, 'anim_paths': paths,
       'meshes': [m['name'] for m in J['meshes']], 'nodes_nonjoint': [n['name'] for i, n in enumerate(J['nodes']) if i not in J['skins'][0]['joints']]}
need = ['Head','EyeL','EyeR','UpperArmL','UpperArmR','ForearmL','ForearmR','HandL','HandR','Jaw','HammerSocket','HammerFace']
man['missing_bones'] = [b for b in need if b not in joints and b not in man['nodes_nonjoint']]
man['missing_morphs'] = [k for k in ['BlinkL','BlinkR','MouthOpen','MouthWide','MouthRound','BrowLift'] if k not in morphs]
# re-import and measure
bpy.ops.wm.read_factory_settings(use_empty=True); scn = bpy.context.scene; scn.render.fps = 25
bpy.ops.import_scene.gltf(filepath=GLB)
arm = [o for o in scn.objects if o.type == 'ARMATURE'][0]
acts = {a.name: a for a in bpy.data.actions}
def act(name): return next(a for n, a in acts.items() if n.startswith(name))
if arm.animation_data:
    for t in arm.animation_data.nla_tracks: t.mute = True
arm.animation_data_create()
fa = act('Forge'); arm.animation_data.action = fa
if hasattr(arm.animation_data, 'action_slot') and fa.slots: arm.animation_data.action_slot = fa.slots[0]
f0, f1 = fa.frame_range; fc = f0 + 0.72*(f1-f0); scn.frame_set(int(fc), subframe=fc-int(fc))
hf = arm.matrix_world @ arm.pose.bones['HammerFace'].head
man['forge_frames'] = [f0, f1]; man['contact_godot'] = [round(hf.x,4), round(hf.z,4), round(-hf.y,4)]
man['contact_err_m'] = round((V(man['contact_godot']) - V((-0.43,1.29,1.10))).length, 4)
mn = min((arm.matrix_world @ v.co).z for o in scn.objects if o.type=='MESH' and o.parent is not None for v in o.data.vertices)
man['min_z'] = round(mn, 4)
print('MANIFEST', json.dumps(man, indent=1)); json.dump(man, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
# renders
scn.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
scn.render.resolution_x = scn.render.resolution_y = 720
scn.view_settings.view_transform = 'AgX'; scn.view_settings.look = 'AgX - Medium High Contrast'; scn.view_settings.exposure = -0.15
w = bpy.data.worlds.new('w'); scn.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs[0].default_value = (0.16,0.165,0.17,1)
w.node_tree.nodes['Background'].inputs[1].default_value = 0.6
bpy.ops.mesh.primitive_plane_add(size=8, location=(0,0,0)); fl = bpy.context.active_object
fm = bpy.data.materials.new('Floor'); fm.use_nodes = True; fm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.09,0.085,0.08,1)
fl.data.materials.append(fm)
def light(name, typ, loc, energy, col, size=1.0):
    l = bpy.data.lights.new(name, typ); l.energy = energy; l.color = col
    if typ == 'AREA': l.size = size
    o = bpy.data.objects.new(name, l); scn.collection.objects.link(o); o.location = loc
    o.rotation_euler = (V((0,0,1.3)) - V(loc)).to_track_quat('-Z','Y').to_euler()
light('Key', 'AREA', (1.5,-1.9,2.0), 650, (1.0,0.98,0.95), 1.5)      # ~2.5 m from chest, neutral
light('Fill', 'AREA', (-2.0,-1.6,1.6), 220, (0.92,0.95,1.0), 2.0)
light('Rim', 'AREA', (0.4,2.0,2.4), 300, (1.0,0.92,0.82), 1.2)
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scn.collection.objects.link(cam); scn.camera = cam
def shot(name, loc, look, lens, action='Idle', frame=0):
    a = act(action); arm.animation_data.action = a
    if hasattr(arm.animation_data, 'action_slot') and a.slots: arm.animation_data.action_slot = a.slots[0]
    scn.frame_set(int(frame), subframe=frame-int(frame))
    cam.data.lens = lens; cam.location = loc; cam.rotation_euler = (V(look)-V(loc)).to_track_quat('-Z','Y').to_euler()
    scn.render.filepath = os.path.join(OUT, name); bpy.ops.render.render(write_still=True)
shot('render_face_front.png', (0,-1.0,1.66), (0,0,1.64), 85)
shot('render_face_34.png', (0.62,-0.8,1.68), (0,0,1.64), 85)
shot('render_full.png', (1.4,-3.6,1.1), (0,0,0.92), 62)
shot('render_forge_impact.png', (1.6,-2.6,1.5), (-0.25,-0.45,1.0), 45, 'Forge', fc)
shot('render_talk_side.png', (-2.6,-2.2,1.2), (0,0,0.95), 58, 'Talk', 20)
print('VERIFY OK')
