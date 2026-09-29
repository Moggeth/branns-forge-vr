import bpy, sys, os, math, json
from mathutils import Vector
args = sys.argv[sys.argv.index("--")+1:]
out = args[0]; glb = args[1]; cam = args[2:]
bpy.ops.wm.read_factory_settings(use_empty=True)
here = os.path.dirname(os.path.abspath(__file__))
if glb != "PLACE":
    bpy.ops.import_scene.gltf(filepath=os.path.join(here, glb+".glb"))
else:
    man = json.load(open(os.path.join(here,"placement_sandstone_quarry.json")))
    for p in man["placements"]:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=os.path.join(here, man["assets"][p["asset"]]))
        new = [o for o in bpy.data.objects if o not in before]
        e = bpy.data.objects.new("e",None); bpy.context.scene.collection.objects.link(e)
        for r in [o for o in new if o.parent is None]: r.parent = e
        x,y,z = p["position"]; sc = p.get("scale",1)
        e.location=(x,-z,y); e.rotation_euler=(0,0,math.radians(p.get("yaw_degrees",0))); e.scale=(sc,sc,sc)
    bpy.ops.mesh.primitive_plane_add(size=34, location=(0,0,-0.02))
    fl = bpy.context.object; m = bpy.data.materials.new("fl"); m.use_nodes=True
    m.node_tree.nodes["Principled BSDF"].inputs[0].default_value=(0.5,0.38,0.24,1); fl.data.materials.append(m)
w = bpy.data.worlds.new("w"); w.use_nodes=True
w.node_tree.nodes["Background"].inputs[0].default_value=(0.55,0.65,0.8,1)
w.node_tree.nodes["Background"].inputs[1].default_value=0.8; bpy.context.scene.world=w
sun = bpy.data.lights.new("sun","SUN"); sun.energy=4
so=bpy.data.objects.new("sun",sun); so.rotation_euler=(math.radians(50),0,math.radians(35)); bpy.context.scene.collection.objects.link(so)
c = bpy.data.cameras.new("c"); co = bpy.data.objects.new("c",c); bpy.context.scene.collection.objects.link(co); bpy.context.scene.camera=co
if cam:
    v=[float(x) for x in cam]; co.location=v[:3]; tgt=Vector(v[3:6])
else:
    co.location=(4,-5,3); tgt=Vector((0,0,0.6))
co.rotation_euler=(tgt-co.location).to_track_quat("-Z","Y").to_euler()
c.lens = 24 if cam else 35
s=bpy.context.scene; s.render.resolution_x=1280; s.render.resolution_y=720
ids=[e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
s.render.engine="BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE"
s.render.filepath=os.path.join(here,out); bpy.ops.render.render(write_still=True)
