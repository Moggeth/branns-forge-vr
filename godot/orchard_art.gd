extends RefCounted
## Authored orchard kit adapter. GLBs are independent pieces; placement is seeded
## and chunked so the same registry can dress later generated landscapes.
const TreeKit = preload("res://tree_kit.gd")
const Finish = preload("res://orchard_finish.gd")
const PATH := "res://assets/orchard/"
const ASSETS := ["apple_tree_mature","apple_tree_mature_b","apple_tree_mature_autumn",
	"apple_tree_mature_lod1","apple_tree_mature_b_lod1","apple_tree_young",
	"apple_tree_young_autumn","apple_tree_young_lod1","apple_stump",
	"hedge_dense","hedge_dense_lod1","shrub_flowering","rock_mossy",
	"rock_mossy_small","rubble_split","wall_straight","wall_corner_broken",
	"wall_end_broken","path_straight","path_curve30","path_curve30_left",
	"mountain_cliff_chunk","mountain_peak_snow"]
const CHUNK := 64.0
static var _cache:Dictionary={}

static func available(id:String)->bool:
	return ASSETS.has(id) and ResourceLoader.exists(PATH+id+".glb")

static func _collect(node:Node,pose:Transform3D,parts:Array)->void:
	for child in node.get_children():
		if not child is Node3D: continue
		var local:Transform3D=pose*child.transform
		if child is MeshInstance3D and child.mesh!=null:
			# Godot 4.7 imports the first vertex-colour surface white unless its
			# albedo-from-vertex flag is restored. Fix the shared mesh once.
			Finish.apply_mesh(child.mesh)
			parts.append({"mesh":child.mesh,"pose":local,"material":child.material_override,"name":child.name})
		_collect(child,local,parts)

static func _parts(id:String)->Array:
	if _cache.has(id): return _cache[id]
	if not available(id): return []
	var scene:PackedScene=load(PATH+id+".glb")
	if scene==null: return []
	var instance:Node3D=scene.instantiate()
	var parts:Array=[]
	_collect(instance,Transform3D.IDENTITY,parts)
	instance.free()
	_cache[id]=parts
	return parts

static func _emit(root:Node3D,id:String,poses:Array)->void:
	var parts:Array=_parts(id)
	if parts.is_empty() or poses.is_empty(): return
	var chunks:Dictionary={}
	for placement in poses:
		var at:Vector3=placement.at
		var key:=Vector2i(floori(at.x/CHUNK),floori(at.z/CHUNK))
		if not chunks.has(key): chunks[key]=[]
		chunks[key].append(placement)
	for key in chunks:
		var origin:=Vector3((float(key.x)+0.5)*CHUNK,0,(float(key.y)+0.5)*CHUNK)
		var list:Array=chunks[key]
		for part_index in range(parts.size()):
			var part:Dictionary=parts[part_index]
			var mesh:Mesh=part.mesh
			var multi:=MultiMesh.new()
			multi.transform_format=MultiMesh.TRANSFORM_3D
			multi.mesh=mesh
			multi.instance_count=list.size()
			for index in range(list.size()):
				var placement:Dictionary=list[index]
				var pose:=Transform3D(Basis(Vector3.UP,placement.yaw).scaled(Vector3.ONE*placement.scale),placement.at-origin)
				multi.set_instance_transform(index,pose*part.pose)
			var holder:=MultiMeshInstance3D.new()
			holder.name="Orchard_%s_%s_%s_%d"%[id,key.x,key.y,part_index]
			if id.begins_with("apple_tree"):
				# Keep the per-instance placement address so a future carved route can
				# remove an individual canopy without rebuilding the whole grove.
				var addresses:Array=[]
				for placement in list: addresses.append(placement.at)
				holder.set_meta("builder_positions",addresses)
			holder.position=origin
			holder.multimesh=multi
			holder.material_override=part.material
			holder.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if id in ["hedge_dense","shrub_flowering","path_straight"] or id.begins_with("mountain") else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			holder.visibility_range_end=90.0 if id.begins_with("apple_tree") else (100.0 if id.begins_with("wall") else (75.0 if id in ["rock_mossy","rubble_split","path_straight"] else (60.0 if id in ["hedge_dense","shrub_flowering"] else 0.0)))
			holder.visibility_range_end_margin=10.0 if holder.visibility_range_end>0.0 else 0.0
			root.add_child(holder)

static func _pose(at:Vector3,scale:float,yaw:float)->Dictionary:
	return {"at":at,"scale":scale,"yaw":yaw}

static func upgrade_tree_visual(tree:Node3D)->void:
	# Keep TreeKit's trunk collider, apple reach points and fruit physics.
	# Replace only its rendered crown with the commissioned mesh.
	if not available("apple_tree_mature"): return
	var id:String="apple_tree_mature_b" if int(tree.get_meta("tree_seed",0))%2==0 else "apple_tree_mature"
	var scene:PackedScene=load(PATH+id+".glb")
	if scene==null: return
	var art:Node3D=scene.instantiate()
	Finish.apply_tree(art)
	art.name="AuthoredOrchardTree"
	art.scale=Vector3.ONE*(float(tree.get_meta("tree_height",4.8))/4.68)
	for node in art.find_children("*","MeshInstance3D",true,false):
		# ShootableApples supplies the visible fruit on an interactive tree.
		if "Fruit" in node.name: node.visible=false
		else:
			node.visibility_range_end=85.0
			node.visibility_range_end_margin=2.0
	for child_name in ["Crown","Far","LeafCards"]:
		var child:Node3D=tree.get_node_or_null(child_name)
		if child!=null: child.visible=false
	var far:MeshInstance3D=tree.get_node_or_null("Far")
	if far!=null:
		far.visible=true
		far.visibility_range_begin=85.0
		far.visibility_range_begin_margin=2.0
	tree.add_child(art)

static func grove(root:Node3D,placements:Array,trail:Array=[])->void:
	var authored:Dictionary={}
	for id in ASSETS:
		if id.begins_with("apple_tree"): authored[id]=[]
	var fallback:Array=[]
	var distant:Array=[]
	for tree in placements:
		var young:bool=int(tree.seed)%7==0
		var autumn:bool=int(tree.seed)%13==0
		var variant_b:bool=int(tree.seed)%3==0
		var far:bool=not trail.is_empty() and not _near_path(tree.position,trail,20.0)
		var id:String="apple_tree_mature"
		if young: id="apple_tree_young_lod1" if far else "apple_tree_young"
		elif autumn and not far: id="apple_tree_mature_autumn"
		elif variant_b: id="apple_tree_mature_b_lod1" if far else "apple_tree_mature_b"
		elif far: id="apple_tree_mature_lod1"
		if tree.species=="apple" and available(id):
			authored[id].append(_pose(tree.position,tree.scale,float(tree.seed%628)/100.0))
			distant.append(tree)
		else: fallback.append(tree)
	for id in authored: _emit(root,id,authored[id])
	var far_chunks:Dictionary={}
	for tree in distant:
		var key:=Vector2i(floori(tree.position.x/80.0),floori(tree.position.z/80.0))
		if not far_chunks.has(key): far_chunks[key]=[]
		var origin:=Vector3((float(key.x)+0.5)*80.0,0,(float(key.y)+0.5)*80.0)
		var local_tree:Dictionary=tree.duplicate()
		local_tree.position=tree.position-origin
		far_chunks[key].append(local_tree)
	for key in far_chunks:
		var far_grove:Node3D=TreeKit.make_grove(far_chunks[key],{"lod":"far","variants":3,"shadows":false,"builder_addresses":true,"builder_origin":Vector3((float(key.x)+0.5)*80.0,0,(float(key.y)+0.5)*80.0)})
		far_grove.name="OrchardDistantSilhouettes_%s_%s"%[key.x,key.y]
		far_grove.position=Vector3((float(key.x)+0.5)*80.0,0,(float(key.y)+0.5)*80.0)
		for child in far_grove.get_children():
			if child is GeometryInstance3D:
				child.visibility_range_begin=90.0
				child.visibility_range_begin_margin=4.0
		root.add_child(far_grove)
	if not fallback.is_empty(): root.add_child(TreeKit.make_grove(fallback,{"lod":"far","variants":3,"shadows":false,"builder_addresses":true}))
	var authored_count:=0
	for id in authored: authored_count+=authored[id].size()
	print("ORCHARD_ART authored_trees=",authored_count," fallback_trees=",fallback.size())

static func trail(root:Node3D,points:Array,w:Script)->void:
	if not available("path_straight"):
		for i in range(points.size()-1): w.path(root,points[i],points[i+1],"bdab80" if i%2 else "c9b98e")
		return
	var poses:Array=[]
	for i in range(points.size()-1):
		var a:Vector3=points[i]
		var b:Vector3=points[i+1]
		var segment:Vector3=b-a
		var distance:float=segment.length()
		var direction:Vector3=segment/distance
		var yaw:float=atan2(direction.x,direction.z)
		for j in range(ceili(distance/3.8)):
			var t:float=(float(j)+0.5)/float(ceili(distance/3.8))
			poses.append(_pose(a.lerp(b,t)+Vector3.UP*0.025,1.0,yaw))
	_emit(root,"path_straight",poses)

static func _near_path(point:Vector3,trail:Array,clearance:float=5.4)->bool:
	for i in range(trail.size()-1):
		var a:Vector3=trail[i]
		var segment:Vector3=trail[i+1]-a
		var t:float=clampf((point-a).dot(segment)/segment.length_squared(),0,1)
		if point.distance_to(a+segment*t)<clearance: return true
	return false

static func _collider(root:Node3D,at:Vector3,width:float,height:float,depth:float,yaw:float)->void:
	var body:=StaticBody3D.new()
	body.name="OrchardArtSolid"
	body.set_meta("kind","solid")
	body.position=at+Vector3.UP*height*0.5
	body.rotation.y=yaw
	root.add_child(body)
	var shape:=BoxShape3D.new()
	shape.size=Vector3(width,height,depth)
	var collision:=CollisionShape3D.new()
	collision.shape=shape
	body.add_child(collision)

static func place_features(root:Node3D,trail:Array,plots:Array,seed:int)->void:
	var rng:=RandomNumberGenerator.new()
	rng.seed=seed+73
	var placements:Dictionary={}
	for id in ASSETS: placements[id]=[]
	for i in range(570):
		var at:=Vector3(rng.randf_range(-148,148),0,rng.randf_range(-148,148))
		if at.length()<44 or _near_path(at,trail): continue
		var plot_clear:=true
		for plot in plots:
			if at.distance_to(plot.at)<11.0: plot_clear=false; break
		if not plot_clear: continue
		var choice:int=i%10
		var id:String="hedge_dense" if choice<4 else ("shrub_flowering" if choice<7 else ("rock_mossy" if choice<9 else "rubble_split"))
		if not available(id): continue
		var scale:float=rng.randf_range(0.75,1.30)
		var yaw:float=rng.randf_range(0,TAU)
		placements[id].append(_pose(at,scale,yaw))
		if id=="rock_mossy": _collider(root,at,1.0*scale,0.6*scale,0.9*scale,yaw)
		if id=="hedge_dense": _collider(root,at,3.0*scale,1.25*scale,1.05*scale,yaw)
	for plot in plots:
		if plot.kind in ["stone","ruin"]:
			for j in range(4):
				var at:Vector3=plot.at+Vector3(-13+j*8,0,12)
				var id:String="wall_end_broken" if j==3 else "wall_straight"
				if available(id):
					placements[id].append(_pose(at,1.0,0.0))
					_collider(root,at,3.9,1.35,0.65,0.0)
	for i in range(8):
		var a:float=TAU*float(i)/8.0
		var at:=Vector3(cos(a)*226,0,sin(a)*226)
		if available("mountain_cliff_chunk"): placements.mountain_cliff_chunk.append(_pose(at,1.0,a+PI*0.5))
	for i in range(3):
		var a:float=TAU*float(i)/3.0+0.4
		var at:=Vector3(cos(a)*395,0,sin(a)*395)
		if available("mountain_peak_snow"): placements.mountain_peak_snow.append(_pose(at,1.0,a+PI*0.5))
	for id in ASSETS: _emit(root,id,placements[id])
	root.set_meta("orchard_art_library",ASSETS)
