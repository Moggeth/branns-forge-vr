"""Preview render: the three forgeling looks side by side (python3 render_forgeling.py [samples]) -> renders/lineup.png"""
import bpy, math, os, sys
from mathutils import Vector
HERE = os.path.dirname(os.path.abspath(__file__)); OUT = os.path.join(HERE, 'renders'); os.makedirs(OUT, exist_ok=True)
SAMPLES = int(sys.argv[1]) if len(sys.argv) > 1 else 32
LOOKS = [['Gear_Chimney', 'Gear_Toolbelt'], ['Gear_Goggles', 'Gear_Toolbelt'], ['Gear_Chimney', 'Gear_Goggles']]
bpy.ops.wm.read_factory_settings(use_empty=True)
for i, keep in enumerate(LOOKS):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(HERE, 'forgeling.glb'))
    new = [o for o in bpy.data.objects if o not in before]
    for root in [o for o in new if o.parent is None]:
        root.location.x += (i - 1) * 0.8; root.rotation_euler.z = (i - 1) * -0.3
    for o in new:
        if (o.name.startswith('Gear_') or o.name.startswith('Shield_')) and not any(o.name.startswith(k) for k in keep + ['Shield_Forge']): o.hide_render = True
for m in bpy.data.materials:
    b = m.node_tree.nodes.get('Principled BSDF') if m.use_nodes else None
    if b and m.name.startswith('Crystal'): b.inputs['Emission Strength'].default_value = 1.6
bpy.ops.mesh.primitive_plane_add(size=12); g = bpy.context.object; gm = bpy.data.materials.new('g'); gm.use_nodes = True
gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.25, 0.36, 0.14, 1); g.data.materials.append(gm)
w = bpy.data.worlds.new('w'); bpy.context.scene.world = w; w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.5, 0.62, 0.8, 1)
bpy.ops.object.light_add(type='SUN', rotation=(math.radians(50), 0, math.radians(-30))); bpy.context.object.data.energy = 3.5
bpy.ops.object.camera_add(location=(0.6, -4.6, 1.3)); c = bpy.context.object; c.data.lens = 45
c.rotation_euler = (Vector((0, 0, 0.85)) - c.location).to_track_quat('-Z', 'Y').to_euler(); bpy.context.scene.camera = c
sc = bpy.context.scene; sc.render.engine = 'CYCLES'; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True; sc.cycles.device = 'CPU'
sc.render.resolution_x, sc.render.resolution_y = 1280, 720; sc.view_settings.view_transform = 'AgX'
sc.render.filepath = os.path.join(OUT, 'lineup.png'); bpy.ops.render.render(write_still=True)
