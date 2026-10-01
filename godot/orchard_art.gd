extends RefCounted
## Static orchard kit adapter. Grove and interactive trees use native TreeKit;
## other GLBs remain independent pieces batched by seeded placement and chunk.
const TreeKit = preload("res://tree_kit.gd")
const Finish = preload("res://orchard_finish.gd")
const Foliage = preload("res://orchard_foliage.gd")
const PATH := "res://assets/orchard/"
const ASSETS := ["apple_tree_mature","apple_tree_mature_b","apple_tree_mature_autumn",
	"apple_tree_mature_lod1","apple_tree_mature_b_lod1","apple_tree_young",
	"apple_tree_young_autumn","apple_tree_young_lod1","apple_stump",
	"hedge_dense","hedge_dense_lod1","shrub_flowering","rock_mossy",
	"rock_mossy_small","rubble_split","wall_straight","wall_corner_broken",
	"wall_end_broken","path_straight","path_curve30","path_curve30_left",
	"mountain_cliff_chunk","mountain_peak_snow"]
const CHUNK := 64.0
const GROVE_LOD_SWITCH := 32.0
const GROVE_VARIANTS := 3
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
			var leafy:bool=str(part.name).contains("Canopy") or str(part.name).contains("Foliage")
			holder.material_override=Foliage.material("tree" if id.begins_with("apple_tree") else "shrub") if leafy else part.material
			holder.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if id in ["hedge_dense","shrub_flowering","path_straight"] or id.begins_with("mountain") else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			holder.visibility_range_end=90.0 if id.begins_with("apple_tree") else (100.0 if id.begins_with("wall") else (75.0 if id in ["rock_mossy","rubble_split","path_straight"] else (60.0 if id in ["hedge_dense","shrub_flowering"] else 0.0)))
			holder.visibility_range_end_margin=10.0 if holder.visibility_range_end>0.0 else 0.0
			root.add_child(holder)
			if leafy and id.begins_with("apple_tree") and holder.cast_shadow==GeometryInstance3D.SHADOW_CASTING_SETTING_ON:
				# Same MultiMesh resource (so route clearing/hiding still affects both): the visible crown stops
				# casting its hard faceted hull; a leaf-gap shadow twin casts the dappled version instead.
				holder.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				var shadow:=MultiMeshInstance3D.new()
				shadow.name=holder.name+"_LeafShadow"
				shadow.position=origin
				shadow.multimesh=multi
				# The visible holder owns these shared instance transforms and bounds.
				shadow.set_meta("landscape_shared_instance_owner",holder)
				shadow.material_override=Foliage.shadow_material("tree")
				shadow.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
				shadow.visibility_range_end=holder.visibility_range_end
				shadow.visibility_range_end_margin=holder.visibility_range_end_margin
				root.add_child(shadow)

static func _pose(at:Vector3,scale:float,yaw:float)->Dictionary:
	return {"at":at,"scale":scale,"yaw":yaw}

static func upgrade_tree_visual(tree:Node3D)->void:
	# WorldZones already builds this tree with TreeKit. Its Crown, Trunk and Far
	# carry the native material, LOD and felling contract; leave them intact.
	pass

static func grove(root:Node3D,placements:Array,trail:Array=[])->void:
	var root_positions := PackedVector3Array()
	for placement in placements:
		root_positions.append(placement.position)
	root.set_meta("orchard_tree_positions",root_positions)
	var chunks:Dictionary={}
	for tree in placements:
		var at:Vector3=tree.position
		var key:=Vector2i(floori(at.x/CHUNK),floori(at.z/CHUNK))
		if not chunks.has(key): chunks[key]=[]
		var origin:=Vector3((float(key.x)+0.5)*CHUNK,0,(float(key.y)+0.5)*CHUNK)
		var local_tree:Dictionary=tree.duplicate()
		local_tree.position=at-origin
		chunks[key].append(local_tree)
	for key in chunks:
		var origin:=Vector3((float(key.x)+0.5)*CHUNK,0,(float(key.y)+0.5)*CHUNK)
		var apples:Array=[]
		var pines:Array=[]
		for tree in chunks[key]:
			if tree.species=="apple": apples.append(tree)
			else: pines.append(tree)
		if not apples.is_empty():
			# Both LODs receive the same seeds and scales. TreeKit caches their
			# three variant meshes; local positions keep chunk bounds small.
			_add_grove_lod(root,apples,key,origin,"near",0.0,GROVE_LOD_SWITCH)
			_add_grove_lod(root,apples,key,origin,"far",GROVE_LOD_SWITCH,0.0)
		if not pines.is_empty():
			# Preserve the prior pine FAR representation and its uncapped range.
			_add_grove_lod(root,pines,key,origin,"far",0.0,0.0)
	print("ORCHARD_ART tree_kit_trees=",placements.size()," chunks=",chunks.size())

static func _add_grove_lod(root:Node3D,placements:Array,key:Vector2i,origin:Vector3,lod:String,begin:float,end:float)->void:
	var grove:Node3D=TreeKit.make_grove(placements,{"lod":lod,"variants":GROVE_VARIANTS,
		"shadows":lod=="near","builder_addresses":true,"builder_origin":origin})
	grove.name="OrchardTreeKit_%s_%s_%s"%[lod,key.x,key.y]
	grove.position=origin
	for child in grove.get_children():
		if child is GeometryInstance3D:
			child.visibility_range_begin=begin
			child.visibility_range_end=end
			child.visibility_range_begin_margin=0.0
			child.visibility_range_end_margin=0.0
			child.visibility_range_fade_mode=GeometryInstance3D.VISIBILITY_RANGE_FADE_DISABLED
			if lod=="near" and child is MultiMeshInstance3D:
				# Share the visible instance transforms so route clearing and terrain
				# reprojection update the dappled shadow without a second pass.
				child.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
				var shadow:=MultiMeshInstance3D.new()
				shadow.name=child.name+"Shadow"
				shadow.multimesh=child.multimesh
				shadow.set_meta("landscape_shared_instance_owner",child)
				shadow.material_override=TreeKit.shadow_material()
				shadow.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
				shadow.transform=child.transform
				shadow.visibility_range_begin=child.visibility_range_begin
				shadow.visibility_range_end=child.visibility_range_end
				shadow.visibility_range_begin_margin=child.visibility_range_begin_margin
				shadow.visibility_range_end_margin=child.visibility_range_end_margin
				shadow.visibility_range_fade_mode=child.visibility_range_fade_mode
				grove.add_child(shadow)
	root.add_child(grove)

static func trail(root:Node3D,points:Array,w:Script)->void:
	# The authored trail is already painted into orchard_masks.png and remains
	# defined by OrchardExpansion.TRAIL for ecology, clearance and navigation.
	# Flat GLB slabs float or clip when the shared heightfield changes.
	return

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
