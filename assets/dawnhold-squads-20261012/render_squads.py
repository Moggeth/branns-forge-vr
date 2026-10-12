"""Turnaround and close-up renders for the Dawnhold squads (Cycles, CPU). Called from build_squads.py --render.

Poses are set by turning bones about world axes from their current posed frame, so they read the same on every unit.
Writes renders/<unit>_<view>.png with a transparent background and a shadow catcher; compose_sheets.py lays them out.
"""
import bpy, math, os
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'renders'); os.makedirs(OUT, exist_ok=True)
V = Vector

# bone -> list of (world axis, degrees), applied parent first. Character faces -Y; -X about X raises an arm forward.
POSES = {
    'forgeling': [('Root', 'Z', 8), ('Torso', 'X', -4), ('LeftArm', 'Z', 50), ('LeftArm', 'Y', 14), ('LeftForearm', 'X', -12),
                  ('RightArm', 'X', -10), ('RightArm', 'Y', -14), ('RightForearm', 'X', -55), ('Head', 'X', 6), ('Head', 'Z', -6),
                  ('LeftLeg', 'X', -8), ('RightLeg', 'X', 6)],
    'anvilback': [('Root', 'Z', 6), ('Torso', 'X', -6), ('LeftArm', 'Z', 62), ('LeftArm', 'Y', 10), ('LeftForearm', 'X', -8),
                  ('RightArm', 'X', 6), ('RightArm', 'Y', -18), ('RightForearm', 'X', -20), ('Head', 'X', 8),
                  ('LeftLeg', 'Y', 6), ('RightLeg', 'Y', -6)],
    'glintshot': [('Root', 'Z', 6), ('RightArm', 'X', -62), ('RightForearm', 'X', -24), ('LeftArm', 'X', -24),
                  ('LeftArm', 'Y', 8), ('LeftForearm', 'X', -62), ('Head', 'X', -4), ('Head', 'Z', 4),
                  ('LeftLeg', 'X', -12), ('RightLeg', 'X', 8)],
    'mender': [('Root', 'Z', -6), ('RightArm', 'X', -14), ('RightArm', 'Y', -16), ('RightForearm', 'X', -58), ('LeftArm', 'X', -20),
               ('LeftForearm', 'X', -50), ('Head', 'Y', 8), ('Head', 'X', 8), ('LeftLeg', 'X', -6), ('RightLeg', 'X', 4)],
    'fusewick': [('Root', 'Z', -10), ('Torso', 'X', -10), ('RightArm', 'X', -20), ('RightArm', 'Y', -70), ('RightForearm', 'Y', -40),
                 ('LeftArm', 'Y', 25), ('LeftForearm', 'X', -60), ('Head', 'Y', -10), ('Head', 'Z', 12),
                 ('LeftLeg', 'X', -22), ('LeftKnee', 'X', 30), ('RightLeg', 'X', 14), ('RightKnee', 'X', 12)],
    'crew': [('Torso', 'X', -14), ('RightArm', 'X', -42), ('LeftArm', 'X', -42), ('RightForearm', 'X', -20), ('LeftForearm', 'X', -20),
             ('LeftLeg', 'X', -25), ('LeftKnee', 'X', 25), ('RightLeg', 'X', 18), ('Head', 'X', 10)],
}


def pose(arm, steps):
    bpy.context.view_layer.update()
    for bn, axis, deg in steps:
        pb = arm.pose.bones[bn]
        m = pb.matrix.copy(); h = pb.head.copy()
        r = Matrix.Rotation(math.radians(deg), 4, axis)
        pb.matrix = Matrix.Translation(h) @ r @ Matrix.Translation(-h) @ m
        bpy.context.view_layer.update()


def stage(scale_z=1.0):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.use_denoising = True
    sc.render.film_transparent = True; sc.view_settings.view_transform = 'AgX'; sc.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.62, 0.72, 0.9, 1)
    w.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.75
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(48), math.radians(8), math.radians(-38)))
    s = bpy.context.object; s.data.energy = 3.8; s.data.angle = math.radians(6); s.data.color = (1.0, 0.95, 0.86)
    bpy.ops.object.light_add(type='AREA', location=(3.0, 2.5, 2.4)); r = bpy.context.object
    r.data.energy = 220; r.data.size = 2.5; r.data.color = (0.75, 0.85, 1.0)
    r.rotation_euler = (V((0, 0, 1.0 * scale_z)) - r.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.ops.mesh.primitive_plane_add(size=30); g = bpy.context.object; g.is_shadow_catcher = True
    for m in bpy.data.materials:
        if not m.use_nodes: continue
        b = m.node_tree.nodes.get('Principled BSDF')
        if b and m.name in ('Crystal', 'Ember', 'Hearth', 'Catchlight'):
            b.inputs['Emission Strength'].default_value = {'Crystal': 1.6, 'Ember': 3.0, 'Hearth': 2.4, 'Catchlight': 4.0}[m.name]


def cam(loc, target, lens):
    if 'Cam' in bpy.data.objects: c = bpy.data.objects['Cam']
    else:
        bpy.ops.object.camera_add(); c = bpy.context.object; c.name = 'Cam'
    c.location = loc; c.data.lens = lens
    c.rotation_euler = (V(target) - V(loc)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.camera = c
    return c


def shoot(path, w, h, samples):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = w, h; sc.cycles.samples = samples
    sc.render.filepath = path; bpy.ops.render.render(write_still=True)


def render_unit(name, arm, quick=False, extra=None):
    pose(arm, POSES.get(name, []))
    height = max((arm.matrix_world @ V(b.tail_local)).z for b in arm.data.bones) + 0.25
    stage(height / 1.8)
    if extra: extra()
    S = 24 if quick else 64
    mid = height * 0.5
    dist = 3.4 * height / 1.8 + 1.5
    views = {'front': 0, 'three': -38, 'side': -90, 'back': 180} if not quick else {'three': -38}
    for v, deg in views.items():
        a = math.radians(deg - 90)
        cam((math.cos(a) * dist, math.sin(a) * dist, mid + 0.45), (0, 0, mid), 50)
        shoot(os.path.join(OUT, f'{name}_{v}.png'), 640, 900, S)
    if name == 'crew':
        for v, deg in ({'cart_three': -40, 'cart_side': -90, 'cart_rear': 145} if not quick else {'cart_three': -40}).items():
            a = math.radians(deg - 90)
            cam((math.cos(a) * 5.2, -1.0 + math.sin(a) * 5.2, 1.9), (0, -1.0, 0.7), 50)
            shoot(os.path.join(OUT, f'{v}.png'), 1280, 900, S)
    hc = max((arm.matrix_world @ arm.pose.bones['Head'].head).z, 0.5) + 0.12
    a = math.radians(-28 - 90)
    cam((math.cos(a) * 1.25, math.sin(a) * 1.25, hc + 0.12), (0, 0, hc - 0.05), 70)
    shoot(os.path.join(OUT, f'{name}_face.png'), 900, 900, S)
