import bpy, os, json, glob
here = os.path.dirname(os.path.abspath(__file__)); res = {}
glb_dir = os.environ.get("QUARRY_GLB_DIR", here)
for f in sorted(glob.glob(os.path.join(glb_dir,"*.glb"))):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=f)
    imgs = {}
    for im in bpy.data.images:
        px = list(im.pixels); n = len(px)//4
        nb = sum(1 for i in range(0,len(px),4) if px[i]+px[i+1]+px[i+2] > 0.03)
        imgs[im.name] = round(nb/n,4)
    inward = 0; meshes = 0; nonmanifold_vol_neg = []
    for o in bpy.data.objects:
        if o.type != "MESH": continue
        meshes += 1; me = o.data; me.calc_loop_triangles(); vol = 0
        for t in me.loop_triangles:
            a,b,c = [me.vertices[i].co for i in t.vertices]; vol += a.dot(b.cross(c))/6
        if vol < 0: inward += 1; nonmanifold_vol_neg.append(o.name)
    res[os.path.basename(f)] = {"meshes":meshes,"embedded_images_nonblack_fraction":imgs,"meshes_with_inward_normals":inward,"inward_names":nonmanifold_vol_neg,
        "uv_layers_ok": all(len(o.data.uv_layers)>0 for o in bpy.data.objects if o.type=="MESH")}
json.dump(res, open(os.path.join(here,"verification.json"),"w"), indent=1); print(json.dumps(res)[:1500])
