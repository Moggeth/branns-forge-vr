class_name GroundKit
## Deterministic, batched dressing. A stable seed makes iteration and bug reports
## reproducible; future map generation can vary that seed without changing art.
const Foliage = preload("res://orchard_foliage.gd")
const PATH="res://assets/ground-kit/"
const GRASS=["gk_grass_meadow_tuft","gk_grass_meadow_tuft_small","gk_grass_clover_patch","gk_grass_seedhead_clump"]
const ROCKS=["gk_rock_mossy_boulder","gk_rock_sandstone_ledge","gk_rock_split_shards"]
const ROCK_SIZES=[Vector3(1.34,0.63,1.08),Vector3(1.69,0.51,1.20),Vector3(0.95,0.95,0.63)]
const ZONE_DENSITY={"forge_yard":[110,7],"pinewood_ruins":[85,8],"orchard_highlands":[7200,120],"mushroom_glade":[80,7],"sandstone_quarry":[30,10]}
const ORCHARD_CHUNK := 64.0

static func _mesh(asset:String)->Mesh:
	var scene=load(PATH+asset+".glb")
	if not scene is PackedScene:
		push_error("Ground kit asset did not import: "+asset)
		return null
	var art=scene.instantiate()
	var meshes:Array=art.find_children("*","MeshInstance3D",true,false)
	var mesh_node:MeshInstance3D=art if art is MeshInstance3D else (meshes[0] if not meshes.is_empty() else null)
	var result:Mesh=mesh_node.mesh if mesh_node!=null else null
	art.free()
	return result

static func _allowed(id:String,p:Vector3,trail:Array=[])->bool:
	if id=="forge_yard":
		if p.length()<6.5 or (absf(p.x)<9.5 and p.z<1.2) or p.z>8.3: return false
	if id=="orchard_highlands":
		if absf(p.x)<3.7 and p.z>-40 and p.z<24: return false
		if absf(p.x-33.0)<3.5 and p.z>-35 and p.z<17: return false
		if p.distance_to(Vector3(27,0,-30))<4.5: return false
		for i in range(trail.size()-1):
			var a:Vector3=trail[i]
			var segment:Vector3=trail[i+1]-a
			var t:float=clampf((p-a).dot(segment)/segment.length_squared(),0,1)
			if p.distance_to(a+segment*t)<3.1: return false
	if id=="pinewood_ruins" and absf(p.x)<2.0 and p.z>-12 and p.z<12: return false
	if id=="mushroom_glade" and absf(p.x)<2.5 and p.z>-10 and p.z<11: return false
	return true

static func populate(root:Node3D,id:String,extent:float)->void:
	if not ZONE_DENSITY.has(id): return
	var counts:Array=ZONE_DENSITY[id]
	var rng=RandomNumberGenerator.new()
	rng.seed=298190+id.hash()
	var trail:Array=root.get_meta("orchard_trail",[])
	var transforms:Dictionary={}
	for name in GRASS+ROCKS: transforms[name]=[]
	var grass_count:int=counts[0]
	for cluster in range(ceili(float(grass_count)/4.0)):
		var center=Vector3(rng.randf_range(-extent+2,extent-2),0,rng.randf_range(-extent+2,extent-2))
		for local_index in range(4):
			var at=center+Vector3(rng.randf_range(-1.0,1.0),0,rng.randf_range(-1.0,1.0))
			if not _allowed(id,at,trail): continue
			var choice=rng.randf()
			var name=GRASS[0] if choice<0.46 else (GRASS[1] if choice<0.74 else (GRASS[2] if choice<0.91 else GRASS[3]))
			var size=rng.randf_range(0.78,1.16)
			if name==GRASS[3]: size=minf(size,1.0)
			transforms[name].append(Transform3D(Basis(Vector3.UP,rng.randf_range(0,TAU)).scaled(Vector3.ONE*size),at))
	var rock_count:int=counts[1]
	for i in range(rock_count):
		for retry in range(25):
			var at=Vector3(rng.randf_range(-extent+2,extent-2),0,rng.randf_range(-extent+2,extent-2))
			if not _allowed(id,at,trail): continue
			var kind=i%ROCKS.size()
			if id=="sandstone_quarry": kind=1 if i%3!=0 else 2
			var size=rng.randf_range(0.72,1.32)
			var yaw=rng.randf_range(0,TAU)
			var pose=Transform3D(Basis(Vector3.UP,yaw).scaled(Vector3.ONE*size),at-Vector3.UP*0.025)
			transforms[ROCKS[kind]].append(pose)
			var solid=StaticBody3D.new()
			solid.name="GroundRockCollision"
			solid.set_meta("kind","solid")
			root.add_child(solid)
			solid.transform=pose
			var collider=CollisionShape3D.new()
			var shape=BoxShape3D.new()
			shape.size=ROCK_SIZES[kind]*Vector3(0.76,0.83,0.76)
			collider.shape=shape
			collider.position.y=ROCK_SIZES[kind].y*0.45
			solid.add_child(collider)
			break
	for name in GRASS+ROCKS:
		var poses:Array=transforms[name]
		if poses.is_empty(): continue
		var mesh=_mesh(name)
		if mesh==null: continue
		var chunks:Dictionary={}
		for pose in poses:
			var key:=Vector2i(floori(pose.origin.x/ORCHARD_CHUNK),floori(pose.origin.z/ORCHARD_CHUNK)) if id=="orchard_highlands" else Vector2i.ZERO
			if not chunks.has(key): chunks[key]=[]
			chunks[key].append(pose)
		# The GLB's pale showroom finish washes out against playable daylight.
		# Tint its authored vertex shading as a zone material, keeping the kit batched.
		var finish:Material
		if name in GRASS:
			var tint:Color=Color("769b54") if name==GRASS[0] else (Color("9bb963") if name==GRASS[1] else (Color("719655") if name==GRASS[2] else Color("a7b46c")))
			finish=Foliage.material("grass",tint)
		else:
			var rock_finish:=StandardMaterial3D.new()
			rock_finish.vertex_color_use_as_albedo=true
			rock_finish.roughness=0.95
			finish=rock_finish
			rock_finish.albedo_color=Color("a18c72") if id=="sandstone_quarry" else Color("929184")
		for key in chunks:
			var origin:=Vector3((float(key.x)+0.5)*ORCHARD_CHUNK,0,(float(key.y)+0.5)*ORCHARD_CHUNK) if id=="orchard_highlands" else Vector3.ZERO
			var list:Array=chunks[key]
			var multi=MultiMesh.new()
			multi.transform_format=MultiMesh.TRANSFORM_3D
			multi.mesh=mesh
			multi.instance_count=list.size()
			multi.custom_aabb=AABB(Vector3(-ORCHARD_CHUNK*0.5-2,-0.1,-ORCHARD_CHUNK*0.5-2),Vector3(ORCHARD_CHUNK+4,2.2,ORCHARD_CHUNK+4)) if id=="orchard_highlands" else AABB(Vector3(-extent-2,-0.1,-extent-2),Vector3((extent+2)*2,2.2,(extent+2)*2))
			for i in range(list.size()): multi.set_instance_transform(i,Transform3D(list[i].basis,list[i].origin-origin))
			var holder=MultiMeshInstance3D.new()
			holder.name=name+"_%s_%s"%[key.x,key.y]
			holder.position=origin
			holder.multimesh=multi
			if id=="orchard_highlands" and name in GRASS:
				var addresses:=PackedVector3Array()
				for pose in list: addresses.append(pose.origin)
				holder.set_meta("dressing_positions",addresses)
				var hidden:=PackedByteArray()
				hidden.resize(list.size())
				holder.set_meta("dressing_hidden",hidden)
			holder.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if name in GRASS else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			holder.material_override=finish
			if id=="orchard_highlands" and name in GRASS:
				holder.visibility_range_end=75.0
				holder.visibility_range_end_margin=8.0
			root.add_child(holder)
	print("GROUND_KIT zone=",id," grass=",grass_count," rocks=",rock_count," chunked=",id=="orchard_highlands")
