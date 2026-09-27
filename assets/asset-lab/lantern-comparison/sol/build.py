"""Build the Cinderleaf hand lantern with Blender 4.5.13.

blender --background --factory-startup --python-exit-code 2 --python build.py -- --out ABS_DIR
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

tail = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
parser = argparse.ArgumentParser()
parser.add_argument('--out', type=Path, required=True)
args = parser.parse_args(tail)
if not args.out.is_absolute():
    parser.error('--out must be absolute')
OUT = args.out.resolve()
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def rgba(s):
    v = [int(s[i:i+2], 16)/255 for i in (0, 2, 4)]
    return tuple((c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4) for c in v) + (1,)


def mat(name, color, metal=0, rough=.5, glow=None, texture=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = rgba(color)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    if glow:
        p.inputs['Emission Color'].default_value = rgba(glow)
        p.inputs['Emission Strength'].default_value = 2.2
    if texture:
        im = bpy.data.images.new('Cinderleaf patinated copper albedo', width=64, height=64, alpha=True)
        pix = []
        base = rgba(color)
        for y in range(64):
            for x in range(64):
                n = (math.sin(x*12.9898+y*78.233)*43758.5453) % 1
                stripe = math.sin(y*.5+x*.12)*.045
                fac = .83+.17*n+stripe
                if n > .975:
                    pix.extend((.14,.29,.22,1))
                else:
                    pix.extend(tuple(min(1,c*fac) for c in base[:3])+(1,))
        im.pixels.foreach_set(pix)
        im.filepath_raw = str(OUT/'patina.png')
        im.file_format = 'PNG'
        im.save()
        im.pack()
        tx = m.node_tree.nodes.new('ShaderNodeTexImage')
        tx.image = im
        m.node_tree.links.new(tx.outputs['Color'], p.inputs['Base Color'])
    return m


COPPER = mat('Mottled verdigris copper', '477965', .58, .53, texture=True)
GOLD = mat('Worn golden edges', 'ba8650', .76, .34)
IRON = mat('Blue-black forged iron', '242e34', .66, .49)
LEATHER = mat('Charcoal leather grip', '43352d', .08, .82)
GLASS = mat('Warm opal panes', 'c88c49', .12, .43, 'e18032')
FIRE = mat('Core ember', 'ffda86', .0, .44, 'ffb34b')


def assign(o, material, parent=None):
    o.data.materials.append(material)
    if parent:
        o.parent = parent
    return o


def cube(name, loc, scale, material, parent=None, bevel=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.object
    o.name = name
    o.dimensions = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = o.modifiers.new('soft forged edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 1
        o.modifiers.new('weighted corner normals', 'WEIGHTED_NORMAL')
    return assign(o, material, parent)


def cyl(name, loc, radius, depth, material, vertices=8, parent=None, r2=None):
    if r2 is None or abs(r2-radius) < 1e-7:
        bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc)
    else:
        bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=r2, depth=depth, location=loc)
    o = bpy.context.object
    o.name = name
    return assign(o, material, parent)


def rod(name, a, b, radius, material, parent=None, vertices=8):
    mid = (Vector(a)+Vector(b))/2
    direction = Vector(b)-Vector(a)
    o = cyl(name, mid, radius, direction.length, material, vertices, parent)
    o.rotation_euler = direction.to_track_quat('Z', 'Y').to_euler()
    return o


def empty(name, loc, parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = loc
    o.empty_display_size = .012
    if parent:
        o.parent = parent
    return o


# A squat octagonal hearth on four exposed ribs, with a peaked cowl.
cyl('Foot', (0,0,.018), .050, .012, IRON)
cyl('Foot gold lip', (0,0,.026), .055, .007, GOLD)
cyl('Ash cup', (0,0,.041), .045, .026, COPPER)
cyl('Ember dish', (0,0,.060), .038, .008, GOLD)
cyl('HoneyGlass', (0,0,.128), .041, .130, GLASS)
cyl('FlameCore', (0,0,.116), .013, .058, FIRE, 6, r2=.001)
empty('Flame', (0,0,.124))
for i in range(8):
    a = i*math.tau/8
    x,y = .050*math.cos(a), .050*math.sin(a)
    rod('Rib %02d'%i, (x,y,.054), (x,y,.200), .0044, IRON, vertices=6)
    cyl('Rib stud %02d'%i, (x,y,.051), .006, .005, GOLD, 6)
cyl('Lower brass crown', (0,0,.054), .056, .008, GOLD)
cyl('Upper brass crown', (0,0,.203), .057, .009, GOLD)
cyl('Rain cowl', (0,0,.218), .062, .029, COPPER, r2=.026)
cyl('Cowl finial', (0,0,.239), .014, .019, GOLD, r2=.004)

# A fixed, tactile bail: 85 mm of wrapped horizontal grip with open finger space.
rod('Bail left', (-.052,0,.224), (-.052,0,.306), .006, IRON)
rod('Bail right', (.052,0,.224), (.052,0,.306), .006, IRON)
rod('Bail upper left', (-.052,0,.306), (-.039,0,.322), .006, GOLD)
rod('Bail upper right', (.052,0,.306), (.039,0,.322), .006, GOLD)
rod('GripWrap', (-.040,0,.322), (.040,0,.322), .013, LEATHER)
for i in range(7):
    x = -.034+i*.0113
    rod('Grip stitch %02d'%i, (x,0,.322), (x+.003,0,.325), .0012, GOLD, vertices=5)
empty('Grip', (0,0,.322))

# Hinged front shutter. The panel lies in front of the glass at rest. In Blender
# its local Z hinge maps to Godot +Y; opening uses a negative angle, away from glass.
hinge = empty('ShutterHinge', (-.056,-.066,.126))
def sh(name, loc, scale, material, bevel=0):
    o = cube(name, loc, scale, material, bevel=bevel)
    # Blender's parent inverse keeps the designed world pose while exporting
    # a real child of the hinge for Godot rotation.
    o.parent = hinge
    o.matrix_parent_inverse = hinge.matrix_world.inverted()
    return o

sh('Shutter left stile', (-.053,-.069,.126), (.007,.006,.129), GOLD, .001)
sh('Shutter right stile', (.053,-.069,.126), (.007,.006,.129), GOLD, .001)
sh('Shutter bottom rail', (0,-.069,.064), (.112,.006,.007), GOLD, .001)
sh('Shutter top rail', (0,-.069,.188), (.112,.006,.007), GOLD, .001)
for i,z in enumerate((.083,.104,.126,.148,.169)):
    o = sh('Angled shutter louvre %d'%i, (0,-.069,z), (.101,.004,.010), COPPER, .001)
    o.rotation_euler[0] = math.radians(25)
for z in (.078,.174):
    o = cyl('Hinge barrel', (-.057,-.069,z), .005, .025, IRON, 8)
    o.parent = hinge
    o.matrix_parent_inverse = hinge.matrix_world.inverted()
sh('ShutterThumb', (.062,-.080,.127), (.014,.010,.026), GOLD, .002)

# Source contains a demonstrative open pose; export rests closed. Animation is
# useful for checking both extremes in Blender and for downstream interaction.
hinge.rotation_mode = 'XYZ'
hinge.rotation_euler.z = 0
hinge.keyframe_insert(data_path='rotation_euler', frame=1)
hinge.rotation_euler.z = math.radians(-105)
hinge.keyframe_insert(data_path='rotation_euler', frame=20)
hinge.rotation_euler.z = 0
bpy.context.scene.frame_set(1)
if hinge.animation_data and hinge.animation_data.action:
    hinge.animation_data.action.name = 'Shutter open outward'

# Save editable scene before adding studio-only lighting.
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source.blend'))
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.context.scene.objects:
    if o.type in {'MESH','EMPTY'}:
        o.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(OUT/'model.glb'), export_format='GLB', use_selection=True,
                          export_apply=True, export_animations=True, export_image_format='AUTO')

world = bpy.context.scene.world
world.color = (.055,.065,.075)
bpy.context.scene.render.engine = 'BLENDER_EEVEE_NEXT'
bpy.context.scene.render.resolution_x = 840
bpy.context.scene.render.resolution_y = 840
bpy.context.scene.render.resolution_percentage = 100
bpy.context.scene.render.image_settings.file_format = 'PNG'
bpy.context.scene.view_settings.view_transform = 'AgX'

def area(loc, power, color, size):
    bpy.ops.object.light_add(type='AREA', location=loc)
    o = bpy.context.object
    o.data.energy = power
    o.data.color = color
    o.data.shape = 'DISK'
    o.data.size = size
    o.rotation_euler = (Vector((0,0,.15))-o.location).to_track_quat('-Z','Y').to_euler()
area((-.4,-.5,.7), 70, (1,.78,.53), .55)
area((.2,.45,.5), 85, (.43,.8,1), .45)

def shot(name, loc, pose=0):
    bpy.context.scene.frame_set(20 if pose else 1)
    bpy.context.view_layer.update()
    bpy.ops.object.camera_add(location=loc)
    cam = bpy.context.object
    cam.rotation_euler = (Vector((0,0,.17))-cam.location).to_track_quat('-Z','Y').to_euler()
    cam.data.type='ORTHO'
    cam.data.ortho_scale=.47
    bpy.context.scene.camera=cam
    bpy.context.scene.render.filepath=str(OUT/name)
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(cam, do_unlink=True)

shot('front.png', (0,-.75,.28))
shot('three_quarter.png', (.55,-.65,.38))
shot('open.png', (.48,-.65,.34), -105)
print('Cinderleaf lantern ready:', OUT)
