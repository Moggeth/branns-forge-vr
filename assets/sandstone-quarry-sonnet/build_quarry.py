"""Sandstone Quarry kit builder. Run: blender -b -P build_quarry.py
Blender Z-up; glTF exporter maps Blender -Y to Godot +Z, so asset fronts face Blender -Y."""
import bpy, bmesh, math, random, os, json
OUT = os.path.dirname(os.path.abspath(__file__))
ONLY = os.environ.get("QUARRY_ONLY")

def make_tex(name, base, var, seed, stripes=False, size=512):
    img = bpy.data.images.new(name, size, size)
    r = random.Random(seed); px = []
    for y in range(size):
        band = (math.sin(y/size*math.pi*2*7)*0.5+0.5) if stripes else 0.5
        for x in range(size):
            n = (r.random()-0.5)*var + (band-0.5)*var*1.2
            if stripes and (x//128 + y//96) % 2 == 0: n -= var*0.15
            px += [max(0,min(1,base[0]+n)), max(0,min(1,base[1]+n)), max(0,min(1,base[2]+n)), 1]
    img.pixels = px; img.pack()
    return img

_mats = {}
def mat(name, base, rough, var=0.12, seed=1, metal=0.0, stripes=False, emit=0.0):
    if name in _mats: return _mats[name]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    t = m.node_tree.nodes.new("ShaderNodeTexImage"); t.image = make_tex(name+"_tex", base, var, seed, stripes)
    m.node_tree.links.new(t.outputs[0], b.inputs["Base Color"])
    if emit:
        m.node_tree.links.new(t.outputs[0], b.inputs["Emission Color"]); b.inputs["Emission Strength"].default_value = emit
    b.inputs["Roughness"].default_value = rough; b.inputs["Metallic"].default_value = metal
    _mats[name] = m; return m

def M():
    return dict(
      sand=mat("Sandstone", (0.72,0.52,0.32), 0.9, 0.14, 1, stripes=True),
      pale=mat("CutStone", (0.80,0.66,0.46), 0.8, 0.08, 2),
      wood=mat("Timber", (0.42,0.26,0.13), 0.85, 0.12, 3, stripes=True),
      iron=mat("Iron", (0.22,0.22,0.24), 0.5, 0.06, 4, metal=0.8),
      rope=mat("Rope", (0.62,0.5,0.32), 0.95, 0.15, 5),
      glow=mat("Lantern", (1.0,0.68,0.25), 0.4, 0.15, 6, emit=1.6))

def box(name, size, loc, m, rot=(0,0,0), bevel=0.05):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        bv = o.modifiers.new("b","BEVEL"); bv.width = bevel; bv.segments = 1
        bpy.ops.object.modifier_apply(modifier="b")
    o.data.materials.append(m); return o

def rock(name, r, loc, m, seed, squash=0.7, sub=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=sub, radius=r, location=loc)
    o = bpy.context.object; o.name = name; rr = random.Random(seed)
    for v in o.data.vertices:
        f = 1+(rr.random()-0.5)*0.35
        v.co.x*=f; v.co.y*=f; v.co.z*=f*squash
    o.data.materials.append(m); return o

def cyl(name, r, h, loc, m, rot=(0,0,0), v=8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=v, radius=r, depth=h, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.data.materials.append(m); return o

def uv_all(objs):
    for o in objs:
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(island_margin=0.02); bpy.ops.object.mode_set(mode="OBJECT")
        o.select_set(False)

def fix_normals(objs):
    for o in objs:
        bm = bmesh.new(); bm.from_mesh(o.data)
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()

def export(name, objs):
    for o in bpy.data.objects: o.select_set(False)
    uv_all(objs); fix_normals(objs)
    # Preserve the authored shapes and UVs while consolidating rigid pieces by
    # material. Runtime MultiMesh placement otherwise issues one draw per tiny
    # chisel score / timber member, even though every placement is static.
    by_material = {}
    for o in objs:
        by_material.setdefault(o.data.materials[0].name, []).append(o)
    joined = []
    for material_name, pieces in by_material.items():
        for o in bpy.data.objects: o.select_set(False)
        for o in pieces: o.select_set(True)
        bpy.context.view_layer.objects.active = pieces[0]
        if len(pieces) > 1:
            bpy.ops.object.join()
        pieces[0].name = name + "_" + material_name
        joined.append(pieces[0])
    objs = joined
    for o in bpy.data.objects: o.select_set(False)
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT, name+".glb"), export_format="GLB",
        use_selection=True, export_apply=True, export_yup=True)
    return objs

def tris(objs): return sum(sum(len(p.vertices)-2 for p in o.data.polygons) for o in objs)

# ---------------- assets ----------------
def a_boulder(k):
    return [rock("boulder", 1.1, (0,0,0.65), k["sand"], 7, 0.75, 3),
            rock("boulder2", 0.6, (1.0,0.4,0.35), k["sand"], 8, 0.7, 2),
            box("chisel_slab", (0.6,0.5,0.1), (-0.3,-1.15,0.06), k["pale"], rot=(0,0,0.4), bevel=0.02)]

def a_wall(k):
    o = []; z = 0; r = random.Random(3)
    for i,h in enumerate([0.65,0.5,0.6,0.45,0.55,0.5,0.4]):
        L = 6.0 - i*0.12 - r.random()*0.2; D = 1.7 - i*0.14
        o.append(box(f"layer{i}", (L,D,h*0.96), (r.uniform(-0.08,0.08), r.uniform(-0.05,0.05), z+h/2),
                     k["sand"] if i%2==0 else k["pale"], bevel=0.05))
        for j in range(3):   # chisel score marks on the front face
            x = r.uniform(-L/2+0.5, L/2-0.5)
            o.append(box(f"score{i}{j}", (0.05,0.03,h*0.6), (x,-D/2-0.005,z+h/2), k["wood"], bevel=0))
        z += h
    for x in (-2.2,-0.4,1.7):   # iron drill plugs
        o.append(cyl("plug", 0.07, 0.12, (x,-0.86,0.9), k["iron"], (math.pi/2,0,0)))
    for x in (-1.2,1.0):        # iron splitting wedges
        o.append(box("wedge", (0.12,0.14,0.4), (x,-0.9,1.9), k["iron"], bevel=0.01))
    o.append(box("shoreL",(0.28,0.28,1.6),(-2.6,-0.98,0.8),k["wood"],bevel=0.02))
    o.append(box("shoreR",(0.28,0.28,1.6),(2.6,-0.98,0.8),k["wood"],bevel=0.02))
    o.append(box("shoreB",(5.6,0.2,0.2),(0,-0.96,1.6),k["wood"],bevel=0.02))
    return o

def a_cliff(k):
    o = []; r = random.Random(5); z = 0
    for i in range(8):
        h = 0.6 + r.random()*0.2; w = 4.4 - i*0.28
        o.append(box(f"tier{i}", (w, w*r.uniform(0.85,1.0), h*0.97), (r.uniform(-0.2,0.2), r.uniform(-0.2,0.2), z+h/2),
                     k["sand"] if i%2==0 else k["pale"], rot=(0,0,r.uniform(-0.25,0.25)), bevel=0.06))
        z += h
    o.append(rock("cap", 1.5, (0.1,0,z+0.15), k["sand"], 21, 0.55, 2))
    o.append(box("ledge", (1.6,0.8,0.18), (0,-1.9,1.6), k["pale"], rot=(0,0,0.2), bevel=0.03))
    return o

def a_slabs(k):
    o = []; r = random.Random(9)
    for i in range(3): o.append(box(f"sleeper{i}", (0.2,1.0,0.14), (-0.55+i*0.55,0,0.07), k["wood"], bevel=0.02))
    for i in range(3):
        o.append(box(f"slab{i}", (1.7,0.95,0.26), (r.uniform(-.06,.06), r.uniform(-.05,.05), 0.27+i*0.27),
                     k["pale"], rot=(0,0,r.uniform(-.1,.1)), bevel=0.03))
    o.append(box("lean", (1.3,0.14,0.9), (0.2,-0.75,0.6), k["sand"], rot=(-0.3,0,0.05), bevel=0.03))
    o.append(box("strap", (0.08,1.05,1.0), (0.4,0,0.5), k["iron"], bevel=0.01))
    return o

def a_scaffold(k):
    o = []
    for x in (-1.2,1.2):
        for y in (-0.8,0.8): o.append(box("post", (0.22,0.22,3.6), (x,y,1.8), k["wood"], bevel=0.02))
    for z in (0.6,2.0,3.4):
        for y in (-0.8,0.8): o.append(box("rail", (2.6,0.14,0.14), (0,y,z), k["wood"], bevel=0.02))
        for x in (-1.2,1.2): o.append(box("cross", (0.14,1.7,0.14), (x,0,z), k["wood"], bevel=0.02))
    for y in (-0.8,0.8):
        o.append(box("diag",(0.12,0.12,2.9),(0,y,1.3),k["wood"],rot=(0,math.radians(58),0),bevel=0.01))
    for i in range(6): o.append(box(f"deck{i}",(0.42,1.8,0.1),(-1.05+i*0.42,0,2.05),k["wood"],bevel=0.01))
    o.append(box("mast",(0.3,0.3,4.6),(0,0,3.5),k["wood"],bevel=0.02))
    o.append(box("jib",(3.6,0.22,0.24),(1.5,0,5.6),k["wood"],bevel=0.02))
    o.append(box("jibstay",(3.0,0.1,0.1),(1.1,0,5.0),k["wood"],rot=(0,math.radians(-22),0),bevel=0.01))
    o.append(cyl("rope",0.03,2.3,(3.1,0,4.35),k["rope"],v=6))
    o.append(box("hook",(0.14,0.06,0.28),(3.1,0,3.1),k["iron"],bevel=0.01))
    o.append(box("hangslab",(0.9,0.5,0.35),(3.1,0,2.7),k["pale"],bevel=0.03))
    o.append(box("counterweight",(0.7,0.5,0.5),(-0.5,0,5.6),k["sand"],bevel=0.04))
    o.append(box("sheave",(0.4,0.12,0.4),(3.4,0,5.6),k["iron"],bevel=0.02))
    return o

def a_gateway(k):
    o = []; r = random.Random(4)
    for sx in (-2.3,2.3):
        z = 0
        for i in range(6):
            w = 1.4 - (0.05 if i%2 else 0)
            o.append(box(f"pier{i}", (w,1.1,0.58), (sx, r.uniform(-.03,.03), z+0.3), k["sand"] if i%2 else k["pale"], bevel=0.05)); z += 0.6
        o.append(box("cap",(1.7,1.3,0.3),(sx,0,z+0.15),k["pale"],bevel=0.05))
        for i in range(3): o.append(cyl("stud",0.07,0.1,(sx,-0.58,0.7+i*1.0),k["iron"],(math.pi/2,0,0)))
    o.append(box("lintel",(6.4,1.2,0.8),(0,0,4.2),k["pale"],bevel=0.06))
    o.append(box("archstone",(1.0,1.25,0.9),(0,0,4.65),k["sand"],bevel=0.05))
    o.append(box("beam",(4.0,0.3,0.3),(0,-0.7,3.75),k["wood"],bevel=0.02))
    for sx in (-1.3,1.3): o.append(box("band",(0.12,1.25,0.82),(sx,0,4.2),k["iron"],bevel=0.01))
    for sx in (-1.4,1.4):
        o.append(cyl("chain",0.02,0.5,(sx,-0.7,3.35),k["iron"],v=6))
        o.append(box("lantern",(0.26,0.26,0.36),(sx,-0.7,3.0),k["glow"],bevel=0.03))
    return o

def a_portal(k):
    o = []
    for sx in (-2.0,2.0): o.append(box("block",(1.6,1.6,4.6),(sx,0,2.3),k["sand"],bevel=0.06))
    o.append(box("header",(5.6,1.6,1.4),(0,0,3.9),k["pale"],bevel=0.06))
    o.append(box("back",(3.2,0.3,3.2),(0,0.9,1.6),k["iron"],bevel=0))
    for sx in (-1.3,1.3): o.append(box("tpost",(0.34,0.34,3.2),(sx,-0.72,1.6),k["wood"],bevel=0.03))
    o.append(box("tbeam",(3.2,0.36,0.34),(0,-0.72,3.35),k["wood"],bevel=0.03))
    for sx,a in ((-0.85,45),(0.85,-45)):
        o.append(box("tbrace",(0.2,0.2,0.9),(sx,-0.72,2.95),k["wood"],rot=(0,math.radians(a),0),bevel=0.02))
    for sx in (-0.4,0.4): o.append(box("rail",(0.08,2.0,0.1),(sx,0,0.06),k["iron"],bevel=0))
    for sx in (-2.0,2.0):
        for i in range(3): o.append(cyl("stud",0.07,0.1,(sx,-0.85,0.8+i*1.2),k["iron"],(math.pi/2,0,0)))
    return o

def a_lantern(k):
    return [box("post",(0.16,0.16,1.7),(0,0,0.85),k["wood"],bevel=0.02),
            box("arm",(0.5,0.1,0.1),(0.22,0,1.6),k["wood"],bevel=0.01),
            box("cap",(0.3,0.3,0.06),(0.4,0,1.72),k["iron"],bevel=0.01),
            box("lamp",(0.22,0.22,0.3),(0.4,0,1.5),k["glow"],bevel=0.03),
            box("foot",(0.4,0.4,0.16),(0,0,0.08),k["sand"],bevel=0.03)]

ASSETS = {"spoil_boulder":a_boulder,"strata_wall":a_wall,"cliff_mass":a_cliff,"cut_slab_stack":a_slabs,
          "scaffold_crane":a_scaffold,"quarry_gateway":a_gateway,"mine_portal":a_portal,"lantern_post":a_lantern}

# solid footprints (cx, cz, hx, hz), Godot local asset space; open spans/overhead excluded
FOOT = {"spoil_boulder":[(0.3,0,1.6,1.3)],"strata_wall":[(0,0,3,0.85)],"cliff_mass":[(0,0,2.3,2.3)],
        "cut_slab_stack":[(0,0,0.9,0.7)],"scaffold_crane":[(0,0,1.3,0.95)],
        "quarry_gateway":[(-2.3,0,0.8,0.65),(2.3,0,0.8,0.65)],"mine_portal":[(-2,0,0.9,0.85),(2,0,0.9,0.85)],
        "lantern_post":[(0.1,0,0.3,0.25)]}

# ---------------- placement ----------------
def P(a,x,z,yaw=0,s=1.0): return {"asset":a,"position":[x,0,z],"yaw_degrees":yaw,"scale":s}
def layout():
    L = []
    # back wall (z=-14.6) around the mine portal at (5,-14.6)
    for x in (-12,-6,0): L.append(P("strata_wall",x,-14.6))
    L.append(P("mine_portal",5,-14.6)); L.append(P("strata_wall",10.5,-14.6)); L.append(P("strata_wall",13.5,-14.6,0,0.5))
    # side walls face inward
    for z in (-11,-5,1,7,13): L.append(P("strata_wall",-14.6,z,90))
    for z in (-11,-5,1,7): L.append(P("strata_wall",14.6,z,-90))
    # front wall with gateway at x=7 (opening x 5.4..8.6)
    for x in (-12,-6,0): L.append(P("strata_wall",x,14.6,180))
    L.append(P("quarry_gateway",7,14.6,180)); L.append(P("strata_wall",12.5,14.6,180,0.9))
    L.append(P("spoil_boulder",3.4,14.4,0,0.8))
    # tall rim behind walls, corners and back
    for x,z,s,y in ((-14.4,-14.4,1.15,20),(14.4,-14.4,1.15,-15),(-14.4,14.4,1.0,60),(14.5,12.5,1.0,10),
                    (-8.5,-15.3,1.3,10),(-2.5,-15.3,1.5,40),(11.5,-15.3,1.3,-30),(-15.3,-3,1.2,70),(15.3,-2,1.3,-20)):
        L.append(P("cliff_mass",x,z,y,s))
    # work dressing at the sides
    L += [P("scaffold_crane",-12,-11.5,0),P("scaffold_crane",11.5,-8.5,180,0.9),P("scaffold_crane",-12,7,90,0.85),
          P("cut_slab_stack",-11.5,-3,20),P("cut_slab_stack",-11,3,-15),P("cut_slab_stack",11.5,3,90),
          P("cut_slab_stack",11.5,9.5,-30),P("cut_slab_stack",-5,-12.4,5),P("cut_slab_stack",1.5,-12.6,-10),
          P("spoil_boulder",-12.5,-8,10,1.1),P("spoil_boulder",-4.5,-11.5,50,0.9),P("spoil_boulder",12.3,-1,0,1.2),
          P("spoil_boulder",-9.5,11.5,80,1.0),P("spoil_boulder",-3.5,12.5,0,0.8),P("spoil_boulder",10.5,-12,30,1.0),
          P("spoil_boulder",1.2,-11,0,0.7),P("spoil_boulder",-11.8,-0.5,100,0.7)]
    # lantern posts marking the route (auto-filtered when they would crowd a resource)
    for z in (11,7,3,-1,-5):
        L.append(P("lantern_post",9.2,z,180)); L.append(P("lantern_post",4.9,z,0))
    return L

RES = [(-6,-1),(-1,3),(4,-1),(-8,-7),(-2,-7),(4,-7),(2,-5),(5,-10),(5,-13)]
def rects(pl):
    a = math.radians(pl["yaw_degrees"]); c,s = math.cos(a),math.sin(a); k = pl["scale"]
    out = []
    for cx,cz,hx,hz in FOOT[pl["asset"]]:
        x = pl["position"][0] + k*(cx*c+cz*s); z = pl["position"][2] + k*(-cx*s+cz*c)
        out.append((x,z,hx*k,hz*k,a))
    return out
def rect_dist(px,pz,r):
    x,z,hx,hz,a = r; dx,dz = px-x, pz-z; c,s = math.cos(a),math.sin(a)
    lx = dx*c - dz*s; lz = dx*s + dz*c
    ex,ez = max(abs(lx)-hx,0), max(abs(lz)-hz,0); return math.hypot(ex,ez)
def rect_aabb(r):
    x,z,hx,hz,a = r; c,s = abs(math.cos(a)),abs(math.sin(a))
    ex = hx*c+hz*s; ez = hx*s+hz*c; return x-ex,x+ex,z-ez,z+ez
def violations(pl):
    v = []
    for r in rects(pl):
        for res in RES:
            if rect_dist(res[0],res[1],r) < 1.2: v.append(f"resource {res}")
        x0,x1,z0,z1 = rect_aabb(r)
        for name,(a0,a1,b0,b1) in {"route":(5.5,8.5,-9.0,15.5),"gate approach":(3.8,8.5,-11.0,-8.0)}.items():
            if x0<a1 and x1>a0 and z0<b1 and z1>b0: v.append(name)
    return v

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True); k = M()
    names = [ONLY] if ONLY else list(ASSETS); tri = {}
    for i,n in enumerate(names):
        objs = ASSETS[n](k); objs = export(n, objs); tri[n] = tris(objs)
        for o in objs: o.location.x += i*9 - 30
    if ONLY: return
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,"quarry.blend"))
    kept, dropped = [], []
    for pl in layout():
        v = violations(pl)
        (dropped if v else kept).append((pl,v))
    # Collision stays a small authored proxy layer rather than forcing every
    # decorative mesh into expensive trimesh physics. The intent file is owned
    # by game integration and survives a visual rebuild of this source kit.
    collision_path = os.path.join(OUT, "collision_intent.json")
    collision_meta = json.load(open(collision_path)) if os.path.exists(collision_path) else {}
    placements = [dict(p, **({"collision":"asset_default"} if p["asset"] in collision_meta else {})) for p,_ in kept]
    man = {"schema":1,"assets":{n:n+".glb" for n in ASSETS},"asset_meta":collision_meta,"placements":placements}
    json.dump(man, open(os.path.join(OUT,"placement_sandstone_quarry.json"),"w"), indent=1)
    usage = {}
    for p,_ in kept: usage[p["asset"]] = usage.get(p["asset"],0)+1
    json.dump({"unique_triangles":sum(tri.values()),"per_asset_triangles":tri,"material_families":sorted(_mats),
        "placements":len(kept),"placement_counts":usage,"placed_triangles":sum(tri[a]*c for a,c in usage.items()),
        "dropped_for_gameplay_clearance":[{"asset":p["asset"],"position":p["position"],"why":v} for p,v in dropped]},
        open(os.path.join(OUT,"stats.json"),"w"), indent=1)
    print("done", tri, "dropped", len(dropped))
main()
