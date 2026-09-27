"""Deterministic shared game/web asset. Run in bundled Blender --background --python."""
import bpy, math, pathlib, time, json
from mathutils import Vector
started=time.perf_counter()
ROOT=pathlib.Path(__file__).resolve().parents[1]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
def material(name,color,metal,rough):
    m=bpy.data.materials.new(name); m.diffuse_color=(*color,1);m.use_nodes=True
    p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*color,1);p.inputs['Metallic'].default_value=metal;p.inputs['Roughness'].default_value=rough
    return m
silver=material('Honed moonsteel',(.48,.57,.61),.94,.23)
gold=material('Raised warm electrum',(.52,.29,.085),.88,.28)
dark=material('Recessed oxidised bronze',(.08,.052,.026),.82,.38)
enamel=material('Peacock enamel',(.015,.25,.22),.64,.19)
leather=material('Bound inner grip',(.032,.022,.014),.1,.67)
# Fine anisotropic-looking grain is an actual embedded metallic/roughness texture.
image=bpy.data.images.new('Brushed radial metal',width=512,height=128)
pixels=[]
for y in range(128):
    for x in range(512):
        grain=.5+.22*math.sin(y*2.9)+.12*math.sin(x*.91+y*.7)+.08*math.sin(x*.29+y*3.3)
        pixels.extend((1,.21+grain*.17,1,1))
image.pixels.foreach_set(pixels);image.file_format='PNG';image.pack()
for m in [silver,gold,dark]:
    nodes=m.node_tree.nodes;tex=nodes.new('ShaderNodeTexImage');tex.image=image;image.colorspace_settings.name='Non-Color'
    separate=nodes.new('ShaderNodeSeparateColor');m.node_tree.links.new(tex.outputs['Color'],separate.inputs[0])
    ramp=nodes.new('ShaderNodeMapRange');ramp.inputs['From Min'].default_value=0;ramp.inputs['From Max'].default_value=1;ramp.inputs['To Min'].default_value=.13;ramp.inputs['To Max'].default_value=.39
    m.node_tree.links.new(separate.outputs['Green'],ramp.inputs['Value'])
    # Bake-friendly glTF roughness reads the green channel directly; restrained grain.
    m.node_tree.links.new(separate.outputs['Green'],nodes.get('Principled BSDF').inputs['Roughness'])
def lathe(name,profile,mat,segments=160,start=0,end=math.tau):
    verts=[];faces=[]
    for j in range(segments+1):
        a=start+(end-start)*j/segments
        verts.extend((r*math.cos(a),r*math.sin(a),z) for r,z in profile)
    width=len(profile)
    for j in range(segments):
        for k in range(width-1):
            n=j*width+k;faces.append((n,n+width,n+width+1,n+1))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(obj);mesh.materials.append(mat)
    uv=mesh.uv_layers.new()
    for poly in mesh.polygons:
        poly.use_smooth=True
        for loop in poly.loop_indices:
            idx=mesh.loops[loop].vertex_index;uv.data[loop].uv=(idx//width/segments,idx%width/(width-1))
    return obj
# Closed lenticular blade profile, rounded inside where fingers hold it.
lathe('Continuous forged blade',[(.172,0),(.174,-.008),(.185,-.013),(.251,-.014),(.274,-.009),(.301,0),(.274,.009),(.251,.014),(.185,.013),(.174,.008),(.172,0)],silver)
for side in [-1,1]:
    lathe('Dark engraved channel',[(.195,side*.014),(.199,side*.016),(.248,side*.016),(.252,side*.014)],dark)
    for r in [.194,.252,.264]:
        lathe('Beaded electrum border',[(r-.0018,side*.013),(r-.0014,side*.018),(r+.0014,side*.018),(r+.0018,side*.013)],gold)
    # Mirrored sweeping wings, one at each clock position, inset enamel spine.
    for i in range(12):
        a=i*math.tau/12
        for feather in range(5):
            span=.30-feather*.024; r=.205+feather*.0083
            profile=[(r-.0014,side*.017),(r,side*(.0195+feather*.00015)),(r+.0014,side*.017)]
            lathe('Embossed sunbird feather',profile,gold,18,a+.035+feather*.016,a+span)
        lathe('Enamel flight quill',[(.224,side*.0168),(.227,side*.019),(.231,side*.017)],enamel,16,a+.32,a+.44)
        # Fine repeating inner tick marks and rivet heads, not sharp teeth.
        for j in range(3):
            q=a+j*.045
            lathe('Maker’s hatch',[(.182,side*.0135),(.186,side*.015),(.19,side*.0135)],gold,2,q,q+.014)
for center in [0,math.pi]:
    for i in range(7):
        a=center-.12+i*.035
        lathe('Recessed finger binding',[(.172,0),(.174,-.0085),(.188,-.014),(.191,-.013),(.177,-.006),(.175,0),(.177,.006),(.191,.013),(.188,.014),(.174,.0085),(.172,0)],leather,3,a,a+.022)
# Geometry is joined by material to keep render draw calls bounded.
for mat in [silver,gold,dark,enamel,leather]:
    bpy.ops.object.select_all(action='DESELECT')
    objects=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.data.materials and o.data.materials[0]==mat]
    for o in objects:o.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.join();objects[0].name=mat.name
out=ROOT/'godot/assets/sunskipper-chakram.glb';out.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(out),export_format='GLB',export_yup=True,export_materials='EXPORT',export_extras=False)
(ROOT/'outputs/chakram/sunskipper.glb').write_bytes(out.read_bytes())
stats={'meshes':sum(o.type=='MESH' for o in bpy.context.scene.objects),'triangles':sum(len(p.vertices)-2 for o in bpy.context.scene.objects if o.type=='MESH' for p in o.data.polygons),'bytes':out.stat().st_size,'seconds':time.perf_counter()-started}
(ROOT/'outputs/chakram/asset-stats.json').write_text(json.dumps(stats,indent=2))
with (ROOT/'logs/work-timing.csv').open('a') as f:f.write(f"chakram-asset-build,completed,{stats['seconds']:.6f}\n")
print('CHAKRAM_ASSET',json.dumps(stats))
