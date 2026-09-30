extends SceneTree
## Imported artist-kit gate. Run after Godot has imported the 18 GLBs and maps.
## --inspect-legacy prints the authored ground mesh/material routing without
## requiring the new kit. Neither mode loads the game or touches player saves.
const Kit = preload("res://ground_kit.gd")
const Palette = preload("res://ground_surface_palette.gd")
const Fields = preload("res://landscape_fields.gd")
const FAMILIES := ["meadow","loam","stone","sand","snow","ash"]
const KINDS := ["grass","fern","litter","wood","stone","debris","frost"]
const TRIANGLES_PER_PROP := 2500
const TOTAL_TRIANGLES := 25000
const MAX_SURFACES := 3
const PROFILE_EXTENT := {"forge_yard":15.0,"sandstone_quarry":15.0,"enchanted_kitchen":15.0,
	"pinewood_ruins":15.0,"mushroom_glade":15.0,"crystal_hollow":15.0,
	"ember_foundry":15.0,"orchard_highlands":160.0,"gloamfen":28.0,"starfall_ridge":28.0,
	"sky_garden":22.0,"cloudbreak_keep":28.0}
var failures: Array[String] = []
var report: Dictionary = {"props":0,"source_triangles":0,"source_surfaces":0,"zones":{}}

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	if OS.get_cmdline_user_args().has("--inspect-legacy"):
		_inspect_legacy()
		quit(0)
		return
	if not FileAccess.file_exists(Kit.SURFACE_MANIFEST):
		_fail("artist manifest not installed: "+Kit.SURFACE_MANIFEST)
		_finish()
		return
	_check_material_maps()
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(Kit.SURFACE_MANIFEST))
	if not data is Dictionary or int(data.get("schema",0)) != 1 or not data.get("props",[]) is Array:
		_fail("manifest requires schema 1 and props array")
		_finish()
		return
	var specs: Array = data.props
	if str(data.get("normal_convention","")) != "OpenGL +Y": _fail("normal-map convention must be OpenGL +Y")
	if str(data.get("orm_channels","")) != "R AO / G roughness / B metallic": _fail("ORM channel contract missing")
	if specs.size() != 18: _fail("expected 18 final props, found "+str(specs.size()))
	var seen: Dictionary = {}
	var zone_families: Dictionary = {}
	for zone_id in PROFILE_EXTENT: zone_families[zone_id] = []
	for raw in specs:
		if not raw is Dictionary:
			_fail("manifest prop is not an object")
			continue
		var spec: Dictionary = raw
		var id: String = str(spec.get("id",""))
		var asset: String = str(spec.get("asset",""))
		var kind: String = str(spec.get("kind",""))
		var zones: Variant = spec.get("zones",[])
		if id.is_empty() or seen.has(id):
			_fail("missing/duplicate prop id: "+id)
			continue
		seen[id] = true
		if kind not in KINDS: _fail(id+": unknown ecology kind "+kind)
		if not asset.begins_with("props/") or not asset.ends_with(".glb") or asset.contains(".."):
			_fail(id+": invalid relative GLB path "+asset)
			continue
		if not zones is Array or zones.is_empty():
			_fail(id+": no zone ecology")
			continue
		for zone_id in zones:
			if not PROFILE_EXTENT.has(zone_id):
				_fail(id+": unsupported flat-ground zone "+str(zone_id))
				continue
			zone_families[zone_id].append(id)
		var weight := float(spec.get("weight",0.0))
		var distance := float(spec.get("max_distance",55.0))
		var scale: Variant = spec.get("scale",[])
		if not is_finite(weight) or weight <= 0.0 or weight > 10.0: _fail(id+": invalid weight")
		if not is_finite(distance) or distance < 20.0 or distance > 95.0: _fail(id+": distance outside culling budget")
		if not scale is Array or scale.size()!=2 or not is_finite(float(scale[0])) or not is_finite(float(scale[1])) or float(scale[0]) < 0.3 or float(scale[1]) > 2.0 or float(scale[1]) < float(scale[0]):
			_fail(id+": invalid scale range")
		_check_prop(id,Kit.SURFACE_KIT+asset)
	for zone_id in PROFILE_EXTENT:
		var family_ids: Array = zone_families[zone_id]
		if family_ids.is_empty(): _fail("no authored clutter for "+zone_id)
		if Kit._surface_specs(zone_id).size() > Kit.SURFACE_SPEC_LIMIT: _fail(zone_id+": exceeds eight active prop families")
	if int(report.source_triangles) > TOTAL_TRIANGLES: _fail("source kit exceeds 25,000 triangles")
	if failures.is_empty(): _check_placement(seen)
	_finish()

func _check_material_maps() -> void:
	for family in FAMILIES:
		for channel in ["albedo","normal","orm"]:
			var path: String = Kit.SURFACE_KIT+"materials/"+family+"_"+channel+".png"
			if not ResourceLoader.exists(path):
				_fail("missing imported map: "+path)
				continue
			var texture := load(path) as Texture2D
			if texture == null:
				_fail("map did not import: "+path)
				continue
			var width := texture.get_width()
			var height := texture.get_height()
			if width != height or width < 256 or width > 4096 or (width & (width-1)) != 0:
				_fail("map must be square power-of-two 256..4096: "+path)
			var image := texture.get_image()
			if image == null or image.is_empty():
				_fail("map pixels unavailable: "+path)
				continue
			var low := 1.0
			var high := 0.0
			var blue := 0.0
			for z in range(4,32,3):
				for x in range(4,32,3):
					var colour: Color = image.get_pixel(floori(float(x*width)/32.0),floori(float(z*height)/32.0))
					var value: float = colour.g if channel == "orm" else colour.r
					low = minf(low,value)
					high = maxf(high,value)
					blue += colour.b
			if high-low < 0.005: _fail("map has no sampled variation: "+path)
			if channel == "orm" and blue/100.0 > 0.25: _fail("ORM blue metallic channel too high for ground: "+path)
			if channel == "normal" and blue/100.0 < 0.45: _fail("normal blue channel does not face outward: "+path)

func _check_prop(id: String, path: String) -> void:
	if not ResourceLoader.exists(path):
		_fail(id+": missing imported GLB "+path)
		return
	var packed := load(path) as PackedScene
	if packed == null:
		_fail(id+": GLB did not import")
		return
	var scene := packed.instantiate() as Node3D
	if scene == null:
		_fail(id+": GLB has no 3D root")
		return
	var parts: Array = scene.find_children("*","MeshInstance3D",true,false)
	if scene is MeshInstance3D: parts.push_front(scene)
	if parts.size() != 1:
		_fail(id+": expected one merged MeshInstance3D, found "+str(parts.size()))
		scene.free()
		return
	var part := parts[0] as MeshInstance3D
	if not scene.transform.is_equal_approx(Transform3D.IDENTITY) or not part.transform.is_equal_approx(Transform3D.IDENTITY):
		_fail(id+": unapplied GLB transform; runtime batches only mesh data")
	var mesh := part.mesh as ArrayMesh
	if mesh == null:
		_fail(id+": imported mesh is not ArrayMesh")
		scene.free()
		return
	var bounds := mesh.get_aabb()
	if not bounds.position.is_finite() or not bounds.size.is_finite() or bounds.size.x < 0.05 or bounds.size.y < 0.02 or bounds.size.z < 0.05 or bounds.size.x > 4.0 or bounds.size.y > 3.0 or bounds.size.z > 4.0:
		_fail(id+": non-finite or out-of-scale geometry "+str(bounds))
	if bounds.position.y < -0.20 or bounds.position.y > 0.20:
		_fail(id+": origin is not near ground contact "+str(bounds.position.y))
	var triangles := 0
	var surfaces := mesh.get_surface_count()
	if surfaces < 1 or surfaces > MAX_SURFACES: _fail(id+": surface count outside 1..3")
	for surface in range(surfaces):
		if mesh.surface_get_primitive_type(surface) != Mesh.PRIMITIVE_TRIANGLES:
			_fail(id+": non-triangle surface")
			continue
		var arrays := mesh.surface_get_arrays(surface)
		if not arrays[Mesh.ARRAY_VERTEX] is PackedVector3Array or not arrays[Mesh.ARRAY_NORMAL] is PackedVector3Array or not arrays[Mesh.ARRAY_TEX_UV] is PackedVector2Array:
			_fail(id+": missing position/normal/UV arrays")
			continue
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		var uv: PackedVector2Array = arrays[Mesh.ARRAY_TEX_UV]
		var indices: PackedInt32Array = arrays[Mesh.ARRAY_INDEX] if arrays[Mesh.ARRAY_INDEX] is PackedInt32Array else PackedInt32Array()
		if vertices.size() < 3 or normals.size()!=vertices.size() or uv.size()!=vertices.size():
			_fail(id+": incomplete position/normal/UV arrays")
		for v in vertices:
			if not v.is_finite():
				_fail(id+": non-finite vertex")
				break
		for normal in normals:
			if not normal.is_finite() or normal.length_squared() < 0.5:
				_fail(id+": missing or non-finite normal")
				break
		for uv_point in uv:
			if not uv_point.is_finite():
				_fail(id+": non-finite UV")
				break
		if not indices.is_empty() and indices.size()%3 != 0:
			_fail(id+": index count is not triangular")
		for vertex_index in indices:
			if vertex_index < 0 or vertex_index >= vertices.size():
				_fail(id+": index outside vertex range")
				break
		triangles += indices.size()/3 if not indices.is_empty() else vertices.size()/3
		var finish: Material = part.material_override if part.material_override != null else mesh.surface_get_material(surface)
		if not finish is StandardMaterial3D:
			_fail(id+": surface requires imported StandardMaterial3D")
			continue
		var pbr := finish as StandardMaterial3D
		if pbr.albedo_texture == null or pbr.normal_texture == null or pbr.roughness_texture == null:
			_fail(id+": imported albedo/normal/ORM map missing")
		if pbr.roughness_texture_channel != BaseMaterial3D.TEXTURE_CHANNEL_GREEN:
			_fail(id+": ORM roughness is not green channel")
	if triangles < 1 or triangles > TRIANGLES_PER_PROP: _fail(id+": triangle budget exceeded: "+str(triangles))
	report.props = int(report.props)+1
	report.source_triangles = int(report.source_triangles)+triangles
	report.source_surfaces = int(report.source_surfaces)+surfaces
	scene.free()

func _check_placement(known: Dictionary) -> void:
	var placed_by_id: Dictionary = {}
	var total_instances := 0
	var total_holders := 0
	for zone_id in PROFILE_EXTENT:
		var zone := Node3D.new()
		zone.name = zone_id
		root.add_child(zone)
		var model := _model() if zone_id == "orchard_highlands" else {}
		var start := Time.get_ticks_usec()
		Kit._populate_surface_kit(zone,zone_id,float(PROFILE_EXTENT[zone_id]),model,[])
		var instances := 0
		var holders := 0
		var surfaces := 0
		var signature: Array[String] = []
		for node in zone.get_children():
			if not node is MultiMeshInstance3D:
				_fail(zone_id+": per-prop node or collider emitted")
				continue
			var holder := node as MultiMeshInstance3D
			var batch := holder.multimesh
			if batch == null or batch.instance_count < 1:
				_fail(zone_id+": empty batch")
				continue
			if holder.visibility_range_end < 20.0 or holder.visibility_range_end > 95.0:
				_fail(zone_id+": unbounded draw distance")
			if zone_id == "orchard_highlands" and (holder.get_meta("dressing_positions",PackedVector3Array()) as PackedVector3Array).size()!=batch.instance_count:
				_fail(zone_id+": reprojection positions missing")
			var id: String = holder.name.trim_prefix("gk_grass_surface_").trim_prefix("GroundSurface_")
			id = id.substr(0,id.rfind("_"))
			id = id.substr(0,id.rfind("_"))
			placed_by_id[id] = int(placed_by_id.get(id,0))+batch.instance_count
			for index in range(batch.instance_count):
				var pose := batch.get_instance_transform(index)
				if not pose.origin.is_finite() or not pose.basis.is_finite():
					_fail(zone_id+": non-finite instance pose")
					break
				var at: Vector3 = pose.origin+holder.position
				if index < 2: signature.append(holder.name+":"+str(at))
				if Kit.SURFACE_ISLANDS.has(zone_id) and not _on_island(zone_id,at):
					_fail(zone_id+": clutter placed off elevated island at "+str(at))
					break
			instances += batch.instance_count
			holders += 1
			surfaces += batch.mesh.get_surface_count()
		var ceiling: int = int(Kit.SURFACE_BUDGET[zone_id])
		if instances < 1 or instances > ceiling: _fail(zone_id+": instance count outside 1.."+str(ceiling)+": "+str(instances))
		if holders > Kit.SURFACE_SPEC_LIMIT*(25 if zone_id=="orchard_highlands" else 1): _fail(zone_id+": holder budget exceeded")
		report.zones[zone_id] = {"instances":instances,"holders":holders,"material_surfaces":surfaces,"placement_ms":snappedf(float(Time.get_ticks_usec()-start)/1000.0,0.1)}
		if zone_id == "forge_yard":
			var repeat := Node3D.new()
			repeat.name = zone_id
			root.add_child(repeat)
			Kit._populate_surface_kit(repeat,zone_id,float(PROFILE_EXTENT[zone_id]),{},[])
			var again: Array[String] = []
			for repeated in repeat.get_children():
				for index in range(mini(2,repeated.multimesh.instance_count)):
					again.append(repeated.name+":"+str(repeated.multimesh.get_instance_transform(index).origin+repeated.position))
			if again != signature: _fail("seeded Forge placements changed on repeat")
			repeat.free()
		total_instances += instances
		total_holders += holders
		zone.free()
	for id in known:
		if int(placed_by_id.get(id,0)) < 1: _fail(id+": never instantiated in any zone")
	report["instances"] = total_instances
	report["holders"] = total_holders

func _on_island(zone_id: String, at: Vector3) -> bool:
	for island in Kit.SURFACE_ISLANDS[zone_id]:
		var center: Vector3 = island[0]
		var half: Vector2 = island[1]*0.5-Vector2.ONE*1.4
		if absf(at.y-center.y) < 0.05 and absf(at.x-center.x) <= half.x+0.01 and absf(at.z-center.z) <= half.y+0.01:
			return true
	return false

func _model() -> Dictionary:
	var model := {"size":33,"step":10.0,"origin":Vector2(-160,-160),"seed":290929}
	for field in ["height","water","slope","vegetation_suitability","shrub_suitability","rock_suitability"]:
		var values := PackedFloat32Array()
		values.resize(33*33)
		values.fill(0.0 if field in ["height","water","slope"] else 0.8)
		model[field] = values
	return model

func _inspect_legacy() -> void:
	for entry in [["pinewood_ruins","ground_patch.glb"],["starfall_ridge","ground_skin.glb"],
		["sky_garden","island_under_sky_main.glb"],["cloudbreak_keep","island_under_cloud_main.glb"]]:
		var path := "res://assets/zone_art/%s/%s" % entry
		var packed := load(path) as PackedScene
		if packed == null:
			print("LEGACY_GROUND missing=",path)
			continue
		var scene := packed.instantiate()
		var parts: Array = scene.find_children("*","MeshInstance3D",true,false)
		if scene is MeshInstance3D: parts.push_front(scene)
		for part in parts:
			for surface in range(part.mesh.get_surface_count()):
				var pbr := part.mesh.surface_get_material(surface) as StandardMaterial3D
				print("LEGACY_GROUND path=",path," mesh=",part.name," surface=",surface," material=",pbr.resource_name if pbr!=null else "null"," tris=",part.mesh.surface_get_arrays(surface)[Mesh.ARRAY_INDEX].size()/3,
					" albedo=",pbr!=null and pbr.albedo_texture!=null," normal=",pbr!=null and pbr.normal_texture!=null," orm=",pbr!=null and pbr.roughness_texture!=null)
		scene.free()

func _fail(message: String) -> void:
	failures.append(message)

func _finish() -> void:
	report["failures"] = failures
	print("GROUND_KIT_ART_RESULT ",JSON.stringify(report))
	quit(0 if failures.is_empty() else 1)
