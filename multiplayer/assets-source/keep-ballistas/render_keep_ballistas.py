"""Cycles review renders of keep_ballistas.glb (imports the exported file, so it checks what ships).

    python3 render_keep_ballistas.py GLB OUT_DIR [samples]
Writes hero.png (both, three-quarter), sunlance-*.png and gnashjaw-*.png (front, side, operator view, fire pose).
"""
import math
import os
import sys

import bpy
from mathutils import Euler, Vector

glb, out = os.path.abspath(sys.argv[-3] if len(sys.argv) > 3 else sys.argv[-2]), None
args = [a for a in sys.argv[1:] if not a.endswith('.py')]
glb, out = os.path.abspath(args[0]), os.path.abspath(args[1])
samples = int(args[2]) if len(args) > 2 else 48
os.makedirs(out, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
O = bpy.data.objects
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = samples
scene.cycles.use_denoising = True
scene.render.resolution_x, scene.render.resolution_y = 1280, 800
scene.view_settings.view_transform = 'Khronos PBR Neutral'
scene.view_settings.exposure = -0.4

# The importer turns vertex colours into a Color Attribute node only when asked; wire it for the review.
for m in bpy.data.materials:
    nt = m.node_tree
    if not nt:
        continue
    bsdf = next((n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf or bsdf.inputs['Base Color'].is_linked or bsdf.inputs['Emission Strength'].default_value > 0:
        continue
    attr = nt.nodes.new('ShaderNodeVertexColor')
    nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])

world = bpy.data.worlds.new('w')
scene.world = world
bg = world.node_tree.nodes['Background']
sky = world.node_tree.nodes.new('ShaderNodeTexSky')
try:
    sky.sky_type = 'NISHITA'
    sky.sun_elevation = math.radians(38)
    sky.sun_rotation = math.radians(210)
except Exception:
    pass
world.node_tree.links.new(sky.outputs['Color'], bg.inputs['Color'])
bg.inputs['Strength'].default_value = 0.12
sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
sun.data.energy = 2.4
sun.data.angle = math.radians(2)
sun.rotation_euler = Euler((math.radians(52), 0, math.radians(215)))
scene.collection.objects.link(sun)

# Meadow-ish ground disc
bpy.ops.mesh.primitive_circle_add(vertices=48, radius=30, fill_type='NGON')
ground = bpy.context.active_object
gm = bpy.data.materials.new('ground')
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.16, 0.27, 0.09, 1)
gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.95
ground.data.materials.append(gm)

cam = bpy.data.objects.new('Cam', bpy.data.cameras.new('Cam'))
scene.collection.objects.link(cam)
scene.camera = cam

sroot, groot = O['S_Root'], O['G_Root']
for name in ('S_Bolt', 'G_Harpoon'):
    O[name].hide_render = True


def load_bolts():
    # Loaded projectiles: copies of the bolt meshes parked at each cradle's nock.
    for name, nock, cradle in (('S_Bolt', 'S_Nock', 'S_Cradle'), ('G_Harpoon', 'G_Nock', 'G_Cradle')):
        c = O[name].copy()
        c.hide_render = False
        scene.collection.objects.link(c)
        c.parent = O[cradle]
        c.matrix_parent_inverse.identity()
        c.location = O[nock].location
        c.rotation_euler = O[name].rotation_euler
        c.scale = O[name].scale


load_bolts()


def string(prefix, limbs):
    # The bow string is drawn in code in the game; here two thin cylinders join each limb tip to the nock.
    import bmesh
    for side in limbs:
        tip, nock = O[f'{prefix}_{side}_Tip'], O[f'{prefix}_Nock']
        me = bpy.data.meshes.new('str'); bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=5, radius1=.012, radius2=.012, depth=1)
        # STRETCH_TO aims local +Y at the target from the origin: lay the unit cylinder along +Y from 0 to 1.
        import mathutils; bmesh.ops.rotate(bm, verts=bm.verts, matrix=mathutils.Matrix.Rotation(-1.5707963, 3, 'X')); bmesh.ops.translate(bm, verts=bm.verts, vec=(0, .5, 0)); bm.to_mesh(me)
        ob = bpy.data.objects.new(f'{prefix}_{side}_String', me); scene.collection.objects.link(ob)
        c = ob.constraints.new('COPY_LOCATION'); c.target = tip
        st = ob.constraints.new('STRETCH_TO'); st.target = nock; st.rest_length = 1
        sm = bpy.data.materials.new('str'); sm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (.85, .8, .7, 1); me.materials.append(sm)


string('S', ('WingL', 'WingR'))
string('G', ('HornL', 'HornR'))


def look(at, frm, lens=40):
    cam.location = Vector(frm)
    d = Vector(at) - Vector(frm)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
    cam.data.lens = lens


def pose(prefix, yaw=0.0, pitch=0.0, flex=0.0, jaw=0.0, spin=0.0):
    # glTF import converts Y-up back to Z-up, so the pivots spin about their Blender axes.
    O[f'{prefix}_Turret'].rotation_euler = Euler((0, 0, yaw))
    O[f'{prefix}_Cradle'].rotation_euler = Euler((pitch, 0, 0))
    limbs = ('WingL', 'WingR') if prefix == 'S' else ('HornL', 'HornR')
    O[f'{prefix}_{limbs[0]}'].rotation_euler = Euler((0, 0, -flex))
    O[f'{prefix}_{limbs[1]}'].rotation_euler = Euler((0, 0, flex))
    if prefix == 'G':
        O['G_Jaw'].rotation_euler = Euler((-jaw, 0, 0))
        O['G_Drum'].rotation_euler = Euler((spin, 0, 0))
    else:
        O['S_Crank'].rotation_euler = Euler((spin, 0, 0))


def shot(name):
    scene.render.filepath = os.path.join(out, name + '.png')
    bpy.ops.render.render(write_still=True)


sroot.location = (-2.1, 0, 0)
groot.location = (2.1, 0, 0)
pose('S', yaw=math.radians(-12), pitch=math.radians(6))
pose('G', yaw=math.radians(12), pitch=math.radians(6))
look((0, 0.6, 1.3), (5.5, 9.5, 3.4), 32)
shot('hero')

# Singles
groot.location = (100, 0, 0)
sroot.location = (0, 0, 0)
pose('S', yaw=0, pitch=math.radians(4))
look((0, 0.2, 1.4), (3.4, 4.6, 2.3), 38); shot('sunlance-front')
look((0, 0.2, 1.4), (5.2, -0.4, 1.9), 38); shot('sunlance-side')
look((0, 1.5, 1.6), (0, -2.9, 2.25), 26); shot('sunlance-operator')
pose('S', yaw=0, pitch=math.radians(4), flex=math.radians(14))
look((0, 0.2, 1.4), (-3.6, 4.2, 2.8), 38); shot('sunlance-drawn')

sroot.location = (100, 0, 0)
groot.location = (0, 0, 0)
pose('G', yaw=0, pitch=math.radians(4))
look((0, 0.4, 1.4), (3.2, 4.6, 2.1), 38); shot('gnashjaw-front')
look((0, 0.2, 1.4), (5.2, -0.4, 1.9), 38); shot('gnashjaw-side')
look((0, 1.5, 1.6), (0, -2.9, 2.4), 26); shot('gnashjaw-operator')
pose('G', yaw=0, pitch=math.radians(4), flex=math.radians(10), jaw=math.radians(32))
look((0, 0.6, 1.3), (-2.2, 4.4, 1.7), 38); shot('gnashjaw-chomp')
