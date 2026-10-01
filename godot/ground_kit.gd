class_name GroundKit
## Deterministic, batched dressing. A stable seed makes iteration and bug reports
## reproducible; future map generation can vary that seed without changing art.
const Foliage = preload("res://orchard_foliage.gd")
const Fields = preload("res://landscape_fields.gd")
const PATH="res://assets/ground-kit/"
const GRASS=["gk_grass_meadow_tuft","gk_grass_meadow_tuft_small","gk_grass_clover_patch","gk_grass_seedhead_clump"]
const ROCKS=["gk_rock_mossy_boulder","gk_rock_sandstone_ledge","gk_rock_split_shards"]
const ROCK_SIZES=[Vector3(1.34,0.63,1.08),Vector3(1.69,0.51,1.20),Vector3(0.95,0.95,0.63)]
const ZONE_DENSITY={"forge_yard":[110,7],"pinewood_ruins":[85,8],"orchard_highlands":[7200,120],"mushroom_glade":[80,7],"sandstone_quarry":[30,10],
	# Other biomes use their existing authored zone art until surface-kit props import.
	"enchanted_kitchen":[0,0],"crystal_hollow":[0,0],"ember_foundry":[0,0],"gloamfen":[0,0],"starfall_ridge":[0,0],
	"sky_garden":[0,0],"cloudbreak_keep":[0,0]}
const ORCHARD_CHUNK := 64.0
# The pre-PBR gk_grass_* blades (flat green sticks) are superseded by the surface kit's grass/fern/flower
# props. Fraction of their authored clusters still emitted, per zone. RNG draws are NOT skipped, so rock
# placement and collision (drawn after the grass loop from the same stream) stay bit-identical.
const LEGACY_GRASS_KEEP := {"orchard_highlands":0.0,"pinewood_ruins":0.30,"mushroom_glade":0.30,"sandstone_quarry":0.50}
# Ecology tuning for the surface-kit pass. Anchors are placed stones/wood/debris (plus optional tree roots);
# understory kinds gather around them and thin out over open lawn.
const ANCHOR_KINDS := ["stone","wood","debris"]
const ANCHOR_SHARE := 0.30
const ANCHOR_CELL := 4.0
const ANCHOR_RADIUS := 3.4
const SURFACE_KIT := "res://assets/ground-surface-kit/"
const SURFACE_MANIFEST := SURFACE_KIT + "manifest.json"
const SURFACE_SPEC_LIMIT := 8 # Caps Orchard at eight asset families x 25 visible chunks.
const SURFACE_BUDGET := {"forge_yard":110,"pinewood_ruins":100,"orchard_highlands":1400,"mushroom_glade":100,
	"sandstone_quarry":75,"enchanted_kitchen":65,"crystal_hollow":45,"ember_foundry":50,"gloamfen":105,"starfall_ridge":85,
	"sky_garden":70,"cloudbreak_keep":85}
const SURFACE_ISLANDS := {
	"sky_garden":[[Vector3(0,0,6),Vector2(22,18)],[Vector3(-10,1.8,-11),Vector2(10,10)],[Vector3(10,3.2,-10),Vector2(9,9)]],
	"cloudbreak_keep":[[Vector3(0,0,10),Vector2(28,24)],[Vector3(-16,2.2,-8),Vector2(13,12)],
		[Vector3(15,4.2,-15),Vector2(12,12)],[Vector3(-3,6,-25),Vector2(14,12)]],
}
const SURFACE_KIND_PRIORITY := {
	"orchard_highlands":["grass","fern","litter","wood","stone","debris","frost"],
	"pinewood_ruins":["fern","litter","wood","grass","stone","debris","frost"],
	"mushroom_glade":["fern","litter","wood","stone","grass","debris","frost"],
	"gloamfen":["litter","fern","wood","stone","grass","debris","frost"],
	"sky_garden":["grass","litter","fern","wood","stone","debris","frost"],
	"cloudbreak_keep":["frost","debris","stone","grass","litter","wood","fern"],
}
static var _surface_mesh_cache: Dictionary = {}

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
	# The portal interaction area is nonblocking; procedural rocks must leave
	# enough clear floor for a standing player on both sides of each gate.
	if id in ["pinewood_ruins", "mushroom_glade"] and p.z > 7.0 and p.z < 12.5:
		if absf(p.x - 7.5) < 2.0 or absf(p.x + 8.5) < 2.0: return false
	if id == "orchard_highlands" and p.distance_to(Vector3(7.5, 0, 19.5)) < 2.5: return false
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

static func field_chance(model:Dictionary, at:Vector2, kind:String)->float:
	# Orchard decoration samples the same post-hydrology fields as live terrain.
	# Existing dressing positions stay fixed; reprojection handles later edits.
	if model.is_empty(): return 1.0
	if Fields.sample(model,"water",at)>0.05: return 0.0
	var slope:=Fields.sample(model,"slope",at)
	if kind!="rock" and slope>0.62: return 0.0
	var suitability:=Fields.sample(model,"rock_suitability" if kind=="rock" else "shrub_suitability" if kind=="shrub" else "vegetation_suitability",at)
	if suitability<0.035: return 0.0
	var grade_weight:=1.0 if kind=="rock" else 1.0-smoothstep(0.26,0.62,slope)
	return clampf((0.18+suitability*2.4)*grade_weight,0.0,1.0)

static func populate(root:Node3D,id:String,extent:float)->void:
	if not ZONE_DENSITY.has(id): return
	var counts:Array=ZONE_DENSITY[id]
	var rng=RandomNumberGenerator.new()
	var model:Dictionary=root.get_meta("landscape_model",{}) if id=="orchard_highlands" else {}
	rng.seed=(int(model.seed) if not model.is_empty() else 298190)+id.hash()
	var trail:Array=root.get_meta("orchard_trail",[])
	var transforms:Dictionary={}
	for name in GRASS+ROCKS: transforms[name]=[]
	var grass_count:int=counts[0]
	for cluster in range(ceili(float(grass_count)/4.0)):
		var center=Vector3(rng.randf_range(-extent+2,extent-2),0,rng.randf_range(-extent+2,extent-2))
		var keep_cluster:bool=float((cluster*37)%100)<float(LEGACY_GRASS_KEEP.get(id,1.0))*100.0
		for local_index in range(4):
			var at=center+Vector3(rng.randf_range(-1.0,1.0),0,rng.randf_range(-1.0,1.0))
			if not _allowed(id,at,trail): continue
			if not model.is_empty() and rng.randf()>field_chance(model,Vector2(at.x,at.z),"grass"): continue
			var choice=rng.randf()
			var name=GRASS[0] if choice<0.46 else (GRASS[1] if choice<0.74 else (GRASS[2] if choice<0.91 else GRASS[3]))
			var size=rng.randf_range(0.78,1.16)
			if name==GRASS[3]: size=minf(size,1.0)
			var grass_yaw:float=rng.randf_range(0,TAU)
			if keep_cluster: transforms[name].append(Transform3D(Basis(Vector3.UP,grass_yaw).scaled(Vector3.ONE*size),at))
	var rock_count:int=counts[1]
	for i in range(rock_count):
		for retry in range(25):
			var at=Vector3(rng.randf_range(-extent+2,extent-2),0,rng.randf_range(-extent+2,extent-2))
			if not _allowed(id,at,trail): continue
			if not model.is_empty() and rng.randf()>field_chance(model,Vector2(at.x,at.z),"rock"): continue
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
	_populate_surface_kit(root,id,extent,model,trail)

static func _surface_specs(zone_id: String) -> Array:
	if not FileAccess.file_exists(SURFACE_MANIFEST): return []
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(SURFACE_MANIFEST))
	if not parsed is Dictionary or int(parsed.get("schema",0)) != 1 or not parsed.get("props",[]) is Array:
		push_error("Ground surface manifest requires schema 1 and a props array")
		return []
	var selected: Array = []
	for raw in parsed.props:
		if not raw is Dictionary: continue
		var prop: Dictionary = raw
		var asset: String = str(prop.get("asset",""))
		var zones: Variant = prop.get("zones",[])
		if not zones is Array or zone_id not in zones: continue
		if not asset.begins_with("props/") or not asset.ends_with(".glb") or asset.contains("..") or not ResourceLoader.exists(SURFACE_KIT+asset):
			push_error("Invalid ground surface asset: "+asset)
			continue
		if not str(prop.get("kind", "")) in ["grass","fern","litter","wood","stone","debris","frost"]: continue
		var weight: float = clampf(float(prop.get("weight",1.0)),0.0,10.0)
		if weight <= 0.0: continue
		selected.append(prop)
	if selected.size() <= SURFACE_SPEC_LIMIT: return selected
	# Round-robin kinds so a long, stone-first manifest cannot silently remove
	# every grass/fern from a meadow. Scarcer biome props win within each kind.
	var priority: Array = SURFACE_KIND_PRIORITY.get(zone_id,["stone","debris","litter","grass","wood","fern","frost"])
	var chosen: Array = []
	var used: Dictionary = {}
	while chosen.size() < SURFACE_SPEC_LIMIT:
		var progress := false
		for kind in priority:
			var best: Dictionary = {}
			var best_score := -1.0
			for spec in selected:
				var id: String = str(spec.get("id",""))
				if str(spec.kind) != kind or used.has(id): continue
				var score := 10.0/maxf(float(spec.zones.size()),1.0)+float(spec.get("weight",1.0))*0.05
				if score > best_score:
					best = spec
					best_score = score
			if best.is_empty(): continue
			chosen.append(best)
			used[str(best.id)] = true
			progress = true
			if chosen.size() >= SURFACE_SPEC_LIMIT: break
		if not progress: break
	print("GROUND_SURFACE_SELECT zone=",zone_id," eligible=",selected.size()," selected=",chosen.map(func(spec: Dictionary) -> String: return str(spec.id)))
	return chosen

static func _anchor_key(p: Vector3) -> Vector2i:
	return Vector2i(floori(p.x/ANCHOR_CELL),floori(p.z/ANCHOR_CELL))

static func _anchor_add(grid: Dictionary, p: Vector3) -> void:
	var key := _anchor_key(p)
	if not grid.has(key): grid[key] = []
	grid[key].append(Vector2(p.x,p.z))

static func _anchor_proximity(grid: Dictionary, p: Vector3) -> float:
	## 0 on open ground, 1 right beside a rock/log/trunk. Constant-time 3x3 cell lookup.
	if grid.is_empty(): return 0.0
	var origin := _anchor_key(p)
	var flat := Vector2(p.x,p.z)
	var nearest := ANCHOR_RADIUS
	for dz in range(-1,2):
		for dx in range(-1,2):
			var cell: Variant = grid.get(origin+Vector2i(dx,dz),null)
			if cell == null: continue
			for anchor in cell: nearest = minf(nearest,flat.distance_to(anchor))
	return 1.0-smoothstep(0.7,ANCHOR_RADIUS,nearest)

static func _surface_island_point(rng: RandomNumberGenerator, zone_id: String) -> Vector3:
	var islands: Array = SURFACE_ISLANDS[zone_id]
	var total := 0.0
	for island in islands: total += float(island[1].x*island[1].y)
	var roll := rng.randf()*total
	for island in islands:
		roll -= float(island[1].x*island[1].y)
		if roll > 0.0: continue
		var center: Vector3 = island[0]
		var half: Vector2 = island[1]*0.5-Vector2.ONE*1.4
		return center+Vector3(rng.randf_range(-half.x,half.x),0,rng.randf_range(-half.y,half.y))
	return islands[0][0]

static func _surface_mesh(asset: String) -> Mesh:
	if _surface_mesh_cache.has(asset): return _surface_mesh_cache[asset]
	var packed := load(SURFACE_KIT+asset) as PackedScene
	if packed == null: return null
	var scene := packed.instantiate()
	var parts: Array = scene.find_children("*","MeshInstance3D",true,false)
	var part: MeshInstance3D = scene if scene is MeshInstance3D else (parts[0] if parts.size()==1 else null)
	var mesh: Mesh = part.mesh if part != null else null
	if parts.size() > 1 or mesh == null:
		push_error("Ground surface prop needs one merged mesh: "+asset)
	scene.free()
	if mesh != null: _surface_mesh_cache[asset] = mesh
	return mesh

static func _surface_kind_chance(kind: String, zone_id: String, point: Vector3, model: Dictionary, patch: float = 1.0, id: String = "") -> float:
	var chance := 1.0
	if not model.is_empty():
		chance = field_chance(model,Vector2(point.x,point.z),"rock" if kind in ["stone","debris"] else "shrub" if kind in ["fern","wood"] else "grass")
		var mask: Color = load("res://orchard_ground.gd").sample(Vector2(point.x,point.z))
		if mask.r > 0.42 or mask.b > 0.82: return 0.0
		if kind in ["grass","fern","litter"]: chance *= 1.0-mask.a*0.45
		# Ecology from the same mask that paints the ground: stones and ferns gather on damp banks, litter
		# and fallen wood under the leaf-litter mask, so props explain the shader instead of ignoring it.
		if kind == "stone": chance *= 0.55+mask.b*1.7+mask.a*0.5
		elif kind == "fern": chance *= 0.70+mask.b*1.1+mask.g*0.5
		elif kind in ["litter","wood"]: chance *= 0.30+mask.g*2.0
	elif zone_id in ["sandstone_quarry","starfall_ridge","crystal_hollow","ember_foundry"] and kind in ["grass","fern"]:
		chance *= 0.17
	elif zone_id == "enchanted_kitchen" and kind in ["grass","fern"]:
		chance *= 0.24
	return clampf(chance*patch,0.0,1.0)

static func _surface_normal(model: Dictionary, point: Vector3) -> Vector3:
	if model.is_empty(): return Vector3.UP
	var at := Vector2(point.x,point.z)
	var step := maxf(float(model.get("step",2.0))*0.5,0.5)
	var dx := Fields.sample(model,"height",at+Vector2(step,0))-Fields.sample(model,"height",at-Vector2(step,0))
	var dz := Fields.sample(model,"height",at+Vector2(0,step))-Fields.sample(model,"height",at-Vector2(0,step))
	return Vector3(-dx,2.0*step,-dz).normalized()

static func _surface_pose(model: Dictionary, point: Vector3, kind: String, size: float, yaw: float) -> Transform3D:
	var normal := _surface_normal(model,point)
	var orientation := Basis(Quaternion(Vector3.UP,normal)).slerp(Basis.IDENTITY,0.30 if kind in ["grass","fern","litter"] else 0.05)
	return Transform3D((orientation*Basis(Vector3.UP,yaw)).scaled(Vector3.ONE*size),point-Vector3.UP*(0.018 if kind in ["stone","debris","wood"] else 0.0))

static func _populate_surface_kit(root: Node3D, zone_id: String, extent: float, model: Dictionary, trail: Array) -> void:
	if not SURFACE_BUDGET.has(zone_id): return
	# Diagnostic A/B capture of the same camera and surface shader without
	# authored prop batches; normal play never sets this flag.
	if OS.get_cmdline_user_args().has("--ground-surface-quality=off"): return
	var specs := _surface_specs(zone_id)
	if specs.is_empty(): return
	var budget: int = SURFACE_BUDGET[zone_id]
	var quality := 1.0
	for arg in OS.get_cmdline_user_args():
		if arg == "--atmosphere-quality=low": quality = 0.50
		elif arg == "--atmosphere-quality=high": quality = 1.25
	budget = roundi(float(budget)*quality)
	var rng := RandomNumberGenerator.new()
	rng.seed = (int(model.seed) if not model.is_empty() else 298190)+zone_id.hash()+67129
	var patch_noise := FastNoiseLite.new()
	patch_noise.seed = int(rng.seed) % 2147483647
	patch_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	patch_noise.frequency = 0.075
	# Deliberate gaps: a second, slower field opens clean lawn/soil between understory drifts so the ground
	# shader (not another tuft) is what you see across them.
	var gap_noise := FastNoiseLite.new()
	gap_noise.seed = int(rng.seed+11) % 2147483647
	gap_noise.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	gap_noise.frequency = 0.036
	var anchors: Dictionary = {}
	# Optional hook: the orchard can publish tree base positions (Vector3 array) so litter/ferns gather at roots.
	var tree_roots: Variant = root.get_meta("orchard_tree_positions",[])
	if tree_roots is Array or tree_roots is PackedVector3Array:
		for tree_at in tree_roots:
			if tree_at is Vector3: _anchor_add(anchors,tree_at)
	var meshes: Dictionary = {}
	var weights: Array[float] = []
	var total_weight := 0.0
	for spec in specs:
		var asset: String = str(spec.asset)
		var mesh := _surface_mesh(asset)
		if mesh == null: continue
		var id: String = str(spec.get("id",asset.get_file().get_basename()))
		if meshes.has(id): continue
		meshes[id] = {"mesh":mesh,"spec":spec,"poses":[]}
		total_weight += clampf(float(spec.get("weight",1.0)),0.0,10.0)
		weights.append(total_weight)
	if meshes.is_empty() or total_weight <= 0.0: return
	var ids := meshes.keys()
	var has_anchor_kind := false
	for id in ids:
		if str(meshes[id].spec.kind) in ANCHOR_KINDS: has_anchor_kind = true
	var anchor_target := roundi(float(budget)*ANCHOR_SHARE) if has_anchor_kind else 0
	var anchors_placed := 0
	var placed := 0
	for attempt in range(budget*18):
		if placed >= budget: break
		var selected := rng.randf()*total_weight
		var slot := 0
		while slot < weights.size()-1 and selected > weights[slot]: slot += 1
		var id: String = ids[slot]
		var record: Dictionary = meshes[id]
		var spec: Dictionary = record.spec
		var kind: String = str(spec.kind)
		var anchor_phase := anchors_placed < anchor_target and attempt < budget*5
		if anchor_phase and not kind in ANCHOR_KINDS: continue
		var p := _surface_island_point(rng,zone_id) if SURFACE_ISLANDS.has(zone_id) else Vector3(rng.randf_range(-extent+2,extent-2),0,rng.randf_range(-extent+2,extent-2))
		if not _allowed(zone_id,p,trail): continue
		if zone_id != "orchard_highlands" and Vector2(p.x,p.z).length() < 3.0: continue
		if zone_id=="sky_garden" and (p.distance_to(Vector3(7.5,0,9.5)) < 3.0 or p.distance_to(Vector3(-8.5,0,9.5)) < 3.0): continue
		if zone_id=="cloudbreak_keep" and p.distance_to(Vector3(7.5,0,19.5)) < 3.0: continue
		var patch := 0.08+0.86*smoothstep(-0.32,0.26,patch_noise.get_noise_2d(p.x,p.z))
		var near := 0.0 if anchor_phase else _anchor_proximity(anchors,p)
		var ecology := 1.0
		if kind in ["grass","fern","litter"] or id == "meadow_flowers":
			var open_lawn := smoothstep(0.18,0.46,gap_noise.get_noise_2d(p.x,p.z))
			ecology = lerpf(1.0-open_lawn*0.88,1.0,near)*(0.40+1.35*near)
			if id == "meadow_flowers":
				# Flowers are drifts at gap edges and rock feet, never a uniform sprinkle.
				ecology *= smoothstep(0.45,0.78,patch_noise.get_noise_2d(p.x*1.7+90.0,p.z*1.7)*0.5+0.5)*(0.55+near*0.9)
		if rng.randf() > _surface_kind_chance(kind,zone_id,p,model,patch,id)*ecology: continue
		var limits: Variant = spec.get("scale",[0.8,1.2])
		var low := 0.8
		var high := 1.2
		if limits is Array and limits.size()==2:
			low = clampf(float(limits[0]),0.3,2.0)
			high = clampf(float(limits[1]),low,2.0)
		var size := rng.randf_range(low,high)
		var pose := _surface_pose(model,p,kind,size,rng.randf_range(0,TAU))
		record.poses.append(pose)
		meshes[id] = record
		placed += 1
		if kind in ANCHOR_KINDS:
			_anchor_add(anchors,p)
			anchors_placed += 1
	var holders := 0
	for id in ids:
		var record: Dictionary = meshes[id]
		var spec: Dictionary = record.spec
		var kind: String = str(spec.kind)
		var chunks: Dictionary = {}
		for pose in record.poses:
			# Align the 320 m Orchard to exactly five 64 m chunks per axis.
			var key := Vector2i(floori((pose.origin.x+extent)/ORCHARD_CHUNK),floori((pose.origin.z+extent)/ORCHARD_CHUNK)) if zone_id=="orchard_highlands" else Vector2i.ZERO
			if not chunks.has(key): chunks[key]=[]
			chunks[key].append(pose)
		for key in chunks:
			var origin := Vector3(-extent+(float(key.x)+0.5)*ORCHARD_CHUNK,0,-extent+(float(key.y)+0.5)*ORCHARD_CHUNK) if zone_id=="orchard_highlands" else Vector3.ZERO
			var poses: Array = chunks[key]
			var multi := MultiMesh.new()
			multi.transform_format = MultiMesh.TRANSFORM_3D
			multi.mesh = record.mesh
			multi.instance_count = poses.size()
			multi.custom_aabb = AABB(Vector3(-ORCHARD_CHUNK*0.5-2,-2,-ORCHARD_CHUNK*0.5-2),Vector3(ORCHARD_CHUNK+4,8,ORCHARD_CHUNK+4)) if zone_id=="orchard_highlands" else AABB(Vector3(-extent-2,-2,-extent-2),Vector3((extent+2)*2,12 if SURFACE_ISLANDS.has(zone_id) else 8,(extent+2)*2))
			var addresses := PackedVector3Array()
			for i in range(poses.size()):
				multi.set_instance_transform(i,Transform3D(poses[i].basis,poses[i].origin-origin))
				if zone_id=="orchard_highlands": addresses.append(poses[i].origin)
			var holder := MultiMeshInstance3D.new()
			holder.name = ("gk_grass_surface_" if kind in ["grass","fern","litter","frost"] else "GroundSurface_")+id+"_%d_%d"%[key.x,key.y]
			holder.position = origin
			holder.multimesh = multi
			holder.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if kind in ["grass","fern","litter","frost"] else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
			holder.visibility_range_end = clampf(float(spec.get("max_distance",55.0)),20.0,95.0)
			holder.visibility_range_end_margin = 8.0
			if zone_id=="orchard_highlands":
				holder.set_meta("dressing_positions",addresses)
				var hidden := PackedByteArray()
				hidden.resize(poses.size())
				holder.set_meta("dressing_hidden",hidden)
			root.add_child(holder)
			holders += 1
	print("GROUND_SURFACE zone=",zone_id," instances=",placed," props=",ids.size()," holders=",holders," quality=",quality)
