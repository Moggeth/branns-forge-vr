"""Review renders (Cycles CPU, 2 threads): contact sheet + movement pose strip.

blender -b <out>/hero_source.blend --python-exit-code 1 --python hero/render_hero.py -- --out <ABS_DIR>
"""
import bpy, os, sys, json, math, time
import numpy as np
from mathutils import Vector

T0 = time.perf_counter()
argv = sys.argv[sys.argv.index('--') + 1:]
OUT = os.path.abspath(argv[argv.index('--out') + 1])
TILES = os.path.join(OUT, 'tiles'); os.makedirs(TILES, exist_ok=True)
HERE = os.path.dirname(os.path.abspath(__file__))
PAL = json.load(open(os.path.join(HERE, 'palettes.json'), encoding='utf-8'))
sc = bpy.context.scene
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'
sc.render.threads_mode = 'FIXED'; sc.render.threads = 2
sc.cycles.samples = 24; sc.cycles.use_denoising = True; sc.cycles.max_bounces = 4
sc.render.resolution_x, sc.render.resolution_y = 360, 520
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'

world = bpy.data.worlds.new('W'); sc.world = world; world.use_nodes = True
world.node_tree.nodes['Background'].inputs[0].default_value = (0.42, 0.52, 0.52, 1)
world.node_tree.nodes['Background'].inputs[1].default_value = 0.55
def light(name, kind, loc, rot, energy, color=(1, 1, 1), size=None):
    d = bpy.data.lights.new(name, kind); d.energy = energy; d.color = color
    if size: d.shadow_soft_size = size
    o = bpy.data.objects.new(name, d); o.location = loc; o.rotation_euler = [math.radians(a) for a in rot]
    sc.collection.objects.link(o)
light('Key', 'SUN', (0, 0, 5), (50, 0, 145), 3.2, (1.0, 0.93, 0.82), 0.12)   # warm key, front-left high
light('Rim', 'SUN', (0, 0, 5), (60, 0, -20), 1.6, (0.7, 0.85, 1.0), 0.05)   # cool rim from behind-right
bpy.ops.mesh.primitive_circle_add(vertices=48, radius=1.4, fill_type='NGON', location=(0, 0, 0))
g = bpy.context.active_object; gm = bpy.data.materials.new('Ground'); gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.32, 0.3, 0.24, 1)
gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
g.data.materials.append(gm)

for n in ('HeroBody_LOD', 'Glove.L', 'Glove.R'): bpy.data.objects[n].hide_render = True
cam_d = bpy.data.cameras.new('Cam'); cam_d.type = 'ORTHO'; cam_d.ortho_scale = 2.05
cam = bpy.data.objects.new('Cam', cam_d); sc.collection.objects.link(cam); sc.camera = cam
rig = bpy.data.objects['HeroRig']

def aim(az_deg, elev=6, target=(0, 0, 0.9), dist=6):
    a, e = math.radians(az_deg), math.radians(elev)
    # az 0 = in front of the hero (Blender +Y), 90 = hero's right (+X)
    cam.location = Vector(target) + Vector((math.sin(a) * math.cos(e), math.cos(a) * math.cos(e), math.sin(e))) * dist
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat('-Z', 'Y').to_euler()

def palette(name):
    for mat, hexv in PAL[name].items():
        if mat.startswith('_'): continue
        c = [(int(hexv[i:i + 2], 16) / 255) for i in (1, 3, 5)]
        c = [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
        bpy.data.materials[mat].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*c, 1)

def render(path):
    sc.render.filepath = path; bpy.ops.render.render(write_still=True); return path

def pose(action, frame):
    rig.animation_data.action = bpy.data.actions[action]; sc.frame_set(frame)

def sheet(rows, path, label_rows=None):
    arrs = []
    for row in rows:
        imgs = []
        for p in row:
            im = bpy.data.images.load(p); a = np.array(im.pixels[:], dtype=np.float32).reshape(im.size[1], im.size[0], 4)
            imgs.append(a); bpy.data.images.remove(im)
        arrs.append(np.concatenate(imgs, axis=1))
    full = np.concatenate(arrs[::-1], axis=0)   # Blender pixel rows start at the bottom
    h, w = full.shape[:2]
    out = bpy.data.images.new('sheet', w, h, alpha=True)
    out.pixels.foreach_set(full.ravel()); out.filepath_raw = path; out.file_format = 'PNG'; out.save()

GLOVES_ONLY = '--gloves-only' in argv
timings = {}
if not GLOVES_ONLY:
    timings = {}
    views = [('front', 0), ('three_quarter', 35), ('side', 90), ('back', 180), ('back_three_quarter', 215)]
    rows = []
    for var in ('emberwright', 'mosswarden'):
        palette(var); pose('Idle', 1); row = []
        for vname, az in views:
            aim(az, 6); t = time.perf_counter(); row.append(render(os.path.join(TILES, f'{var}_{vname}.png'))); timings[f'{var}_{vname}'] = round(time.perf_counter() - t, 2)
        rows.append(row)
    sheet(rows, os.path.join(OUT, 'contact_sheet.png'))

    # Face close-up (both variants) for the head/face review.
    cam_d.ortho_scale = 0.55
    row = []
    for var in ('emberwright', 'mosswarden'):
        palette(var); pose('Idle', 1)
        for az in (0, 40):
            aim(az, 4, (0, 0, 1.6)); row.append(render(os.path.join(TILES, f'{var}_face_{az}.png')))
    sheet([row], os.path.join(OUT, 'face_closeup.png'))

    # Movement pose strip: three-quarter view, variant A.
    cam_d.ortho_scale = 2.05; palette('emberwright')
    strip = [('Idle', 1), ('Walk', 1), ('Walk', 7), ('Run', 1), ('Run', 5), ('Attack', 6), ('Attack', 10), ('Hit', 4)]
    row = []
    for act, f in strip:
        pose(act, f); aim(55, 6)
        row.append(render(os.path.join(TILES, f'pose_{act}_{f}.png')))
    sheet([row], os.path.join(OUT, 'pose_strip.png'))

    # LOD comparison: high vs low, front + side, at the same framing.
    row = []
    pose('Idle', 1)
    for lod in (False, True):
        bpy.data.objects['HeroBody_LOD'].hide_render = not lod
        bpy.data.objects['HeroBody'].hide_render = lod; bpy.data.objects['HeroHead'].hide_render = lod
        for az in (35, 215):
            aim(az, 6); row.append(render(os.path.join(TILES, f'lod_{int(lod)}_{az}.png')))
    sheet([row], os.path.join(OUT, 'lod_compare.png'))
# VR gloves (parked at z=3 in the source scene; origin = GripAnchor = fist centre).
for n in ('HeroBody', 'HeroHead', 'HeroBody_LOD'): bpy.data.objects[n].hide_render = True
for n, x in (('Glove.L', -0.07), ('Glove.R', 0.07)):
    o = bpy.data.objects[n]; o.hide_render = False; o.location = (x, 0, 3.0)   # render-only placement
cam_d.ortho_scale = 0.42; row = []
for az in (0, 45, 180):
    aim(az, 15, (0, 0, 3.0), 4); row.append(render(os.path.join(TILES, f'gloves_{az}.png')))
sheet([row], os.path.join(OUT, 'vr_gloves.png'))
if not GLOVES_ONLY: json.dump({'render_seconds': round(time.perf_counter() - T0, 2), 'tiles': timings}, open(os.path.join(OUT, 'render_report.json'), 'w'), indent=2)
print('RENDER_DONE', round(time.perf_counter() - T0, 2))
