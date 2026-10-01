extends RefCounted
## Data-driven static environment dressing. Gameplay bodies remain in WorldZones.
## Zone-local GLB placements share meshes/materials and are chunked for culling.
const CHUNK_METRES := 64.0
const MAX_PLACEMENTS := 2000
const SURFACE_MATERIALS := ["stone", "wood", "metal", "glass", "bone"]

static func load_into(root: Node3D, manifest_path: String) -> Dictionary:
	if not FileAccess.file_exists(manifest_path): return {"error":"missing manifest: " + manifest_path}
	var document: Variant = JSON.parse_string(FileAccess.get_file_as_string(manifest_path))
	if not document is Dictionary: return {"error":"invalid manifest JSON: " + manifest_path}
	return emit(root, document, manifest_path.get_base_dir())

static func emit(root: Node3D, document: Dictionary, asset_dir: String) -> Dictionary:
	if int(document.get("schema", 0)) != 1: return {"error":"unsupported zone-kit schema"}
	var assets: Variant = document.get("assets", {})
	var placements: Variant = document.get("placements", [])
	if not assets is Dictionary or not placements is Array or placements.size() > MAX_PLACEMENTS:
		return {"error":"invalid zone-kit assets or placement count"}
	var grouped: Dictionary = {}
	for placement_index in placements.size():
		var entry: Variant = placements[placement_index]
		if not entry is Dictionary: return {"error":"placement must be an object"}
		var asset_id: String = str(entry.get("asset", ""))
		if not assets.has(asset_id): return {"error":"unknown asset: " + asset_id}
		var position: Variant = entry.get("position", [])
		if not position is Array or position.size() != 3: return {"error":"position needs three metres: " + asset_id}
		var scale := _scale_vector(entry.get("scale", 1.0))
		if scale == Vector3.ZERO: return {"error":"invalid scale: " + asset_id}
		var at := Vector3(float(position[0]), float(position[1]), float(position[2]))
		var yaw := deg_to_rad(float(entry.get("yaw_degrees", 0.0)))
		var key := Vector2i(floori(at.x / CHUNK_METRES), floori(at.z / CHUNK_METRES))
		var group_key := asset_id + ":" + str(key.x) + ":" + str(key.y)
		if not grouped.has(group_key): grouped[group_key] = {"asset":asset_id,"chunk":key,"poses":[],"indices":[]}
		# Apply nonuniform scale in asset-local axes before yaw. Basis.scaled()
		# alone scales world axes and distorts angled ridge instances.
		grouped[group_key].poses.append(Transform3D(Basis(Vector3.UP, yaw) * Basis.IDENTITY.scaled(scale), at))
		grouped[group_key].indices.append(placement_index)
	var cache: Dictionary = {}
	for asset_id in assets:
		var filename: String = str(assets[asset_id])
		if filename.is_empty() or filename.get_file() != filename or filename.get_extension().to_lower() != "glb":
			return {"error":"asset filename must be a local GLB: " + str(asset_id)}
		var scene_path := asset_dir.path_join(filename)
		if not ResourceLoader.exists(scene_path): return {"error":"missing GLB: " + scene_path}
		var scene := load(scene_path) as PackedScene
		if scene == null: return {"error":"unloadable GLB: " + scene_path}
		var visual := scene.instantiate() as Node3D
		if visual == null: return {"error":"non-3D GLB: " + scene_path}
		var parts: Array = []
		_collect(visual, Transform3D.IDENTITY, parts)
		visual.free()
		if parts.is_empty(): return {"error":"GLB has no meshes: " + scene_path}
		if bool(document.get("vertex_color_multiply", false)):
			for part_index in range(parts.size()):
				var part: Dictionary = parts[part_index]
				if not part.mesh is ArrayMesh: return {"error":"vertex-colour GLB needs ArrayMesh: " + scene_path}
				var copy := (part.mesh as ArrayMesh).duplicate(true) as ArrayMesh
				for surface_index in range(copy.get_surface_count()):
					var source := copy.surface_get_material(surface_index) as StandardMaterial3D
					if source == null: return {"error":"vertex-colour material missing: " + scene_path}
					var finish := source.duplicate() as StandardMaterial3D
					finish.vertex_color_use_as_albedo = true
					copy.surface_set_material(surface_index, finish)
				part.mesh = copy
				if part.material is StandardMaterial3D:
					var override_finish := (part.material as StandardMaterial3D).duplicate() as StandardMaterial3D
					override_finish.vertex_color_use_as_albedo = true
					part.material = override_finish
				parts[part_index] = part
		_ground_finish(asset_dir.get_file(), str(asset_id), parts)
		cache[asset_id] = parts
	var holders := 0
	var visual_by_placement: Dictionary = {}
	for group_key in grouped:
		var group: Dictionary = grouped[group_key]
		var chunk: Vector2i = group.chunk
		var origin := Vector3(float(chunk.x) * CHUNK_METRES, 0.0, float(chunk.y) * CHUNK_METRES)
		var poses: Array = group.poses
		var parts: Array = cache[group.asset]
		for part_index in range(parts.size()):
			var part: Dictionary = parts[part_index]
			var multi := MultiMesh.new()
			multi.transform_format = MultiMesh.TRANSFORM_3D
			multi.mesh = part.mesh
			multi.instance_count = poses.size()
			for index in range(poses.size()):
				var pose: Transform3D = poses[index]
				pose.origin -= origin
				multi.set_instance_transform(index, pose * part.pose)
			var holder := MultiMeshInstance3D.new()
			holder.name = "ZoneKit_%s_%s_%d" % [group.asset, str(chunk), part_index]
			holder.multimesh = multi
			# Headless renderers cannot read back MultiMesh transforms reliably.
			# These source poses also support future local hide/regrowth updates.
			holder.set_meta("zone_kit_poses", poses.duplicate())
			holder.material_override = part.material
			holder.position = origin
			# Survey zoom reaches 185 m; authored landmarks should not blink out
			# while a strategic player inspects the same world from above.
			holder.visibility_range_end = float(document.get("visibility_metres", 240.0))
			holder.visibility_range_end_margin = 8.0
			root.add_child(holder)
			for index in poses.size():
				var placement_index: int = group.indices[index]
				if not visual_by_placement.has(placement_index): visual_by_placement[placement_index] = []
				var original: Transform3D = poses[index]
				original.origin -= origin
				visual_by_placement[placement_index].append({"holder": holder, "index": index, "transform": original * part.pose})
			holders += 1
	# Only major authored solids opt into collision. Small flora, banks and
	# atmospheric pieces remain visual, so a dense kit stays cheap and walkable.
	var collider_count := 0
	var asset_meta: Dictionary = document.get("asset_meta", {})
	for placement_index in placements.size():
		var entry: Dictionary = placements[placement_index]
		if str(entry.get("collision", "none")) != "asset_default": continue
		var asset_id: String = str(entry.get("asset", ""))
		var meta: Variant = asset_meta.get(asset_id, {})
		if not meta is Dictionary: continue
		var specs: Variant = meta.get("collision", [])
		if specs is Dictionary: specs = [specs]
		if not specs is Array or specs.is_empty(): continue
		var at_values: Array = entry.position
		var at := Vector3(float(at_values[0]), float(at_values[1]), float(at_values[2]))
		var yaw := deg_to_rad(float(entry.get("yaw_degrees", 0.0)))
		var scale := _scale_vector(entry.get("scale", 1.0))
		var solid := StaticBody3D.new()
		solid.name = "ZoneArtSolid_%s" % asset_id
		if _tree_asset(asset_id):
			solid.set_meta("kind", "authored_tree")
			solid.set_meta("authored_tree_asset", asset_id)
			solid.set_meta("zone", str(root.name))
			solid.set_meta("id", "%s_authored_tree_%d" % [str(root.name), placement_index])
			solid.set_meta("base_position", at)
			solid.set_meta("authored_tree_parts", cache[asset_id])
			solid.set_meta("authored_tree_scale", scale)
			solid.set_meta("authored_tree_views", visual_by_placement.get(placement_index, []))
			solid.set_meta("chop_band", Vector2(0.25, 2.2))
		else:
			solid.set_meta("kind", "solid")
		var surface := str(entry.get("surface_material", meta.get("surface_material", "")))
		if not surface.is_empty() and surface not in SURFACE_MATERIALS:
			solid.free()
			return {"error":"invalid surface_material for " + asset_id}
		if surface.is_empty(): surface = _surface_from_asset_name(asset_id)
		if not surface.is_empty(): solid.set_meta("surface_material", surface)
		solid.position = at
		solid.rotation.y = yaw
		for spec in specs:
			if not spec is Dictionary: continue
			var shape: Shape3D
			match str(spec.get("shape", "")):
				"box":
					var size: Variant = spec.get("size", [])
					if not size is Array or size.size() != 3: continue
					var box_shape := BoxShape3D.new()
					box_shape.size = Vector3(float(size[0]), float(size[1]), float(size[2])) * scale
					shape = box_shape
				"cylinder":
					var cylinder := CylinderShape3D.new()
					cylinder.radius = float(spec.get("radius", 0.0)) * maxf(scale.x, scale.z)
					cylinder.height = float(spec.get("height", 0.0)) * scale.y
					shape = cylinder
				_:
					continue
			var offset: Variant = spec.get("offset", [0, 0, 0])
			if not offset is Array or offset.size() != 3: continue
			var collision := CollisionShape3D.new()
			collision.shape = shape
			collision.position = Vector3(float(offset[0]), float(offset[1]), float(offset[2])) * scale
			solid.add_child(collision)
			collider_count += 1
		if solid.get_child_count() == 0:
			solid.free()
		else:
			root.add_child(solid)
	var result := {"assets":cache.size(),"placements":placements.size(),"holders":holders,"colliders":collider_count}
	print("ZONE_KIT ", JSON.stringify(result))
	return result

static func _tree_asset(asset_id: String) -> bool:
	var name := asset_id.to_lower()
	return name.begins_with("tree_") or name.begins_with("fen_tree_") or name.begins_with("conifer_") or name in ["deadpine", "heart_arch_tree"]

## Materialize one struck tree from its batched GLB parts. The existing collider
## becomes the resource body; the other trees in its MultiMesh stay batched.
static func ensure_choppable(target: Node3D, game: Node) -> Node3D:
	if not is_instance_valid(target) or not target.has_meta("authored_tree_parts"): return null
	if target.get_meta("authored_tree_revealed", false): return target
	var scale: Vector3 = target.get_meta("authored_tree_scale", Vector3.ONE)
	var trunk: MeshInstance3D = null
	var trunk_score := -INF
	for part in target.get_meta("authored_tree_parts", []):
		var visual := MeshInstance3D.new()
		visual.name = str(part.get("name", "AuthoredTreePart"))
		visual.mesh = part.mesh
		visual.material_override = part.material
		visual.transform = Transform3D(Basis.IDENTITY.scaled(scale), Vector3.ZERO) * part.pose
		visual.set_meta("tree_cut_surface", true)
		target.add_child(visual)
		var bounds: AABB = visual.transform * visual.mesh.get_aabb()
		var low := bounds.position.y <= 0.6 and bounds.end.y >= 0.45
		var narrow := maxf(bounds.size.x, bounds.size.z) < maxf(bounds.size.y, 0.1) * 1.2
		var score := (100.0 if str(visual.name).to_lower().contains("trunk") or str(visual.name).to_lower().contains("stem") else 0.0) + (10.0 if low and narrow else 0.0) + bounds.size.y
		if low and score > trunk_score:
			trunk = visual
			trunk_score = score
	if trunk != null:
		target.set_meta("trunk", trunk)
		target.set_meta("trunk_mesh", trunk.mesh)
		target.set_meta("trunk_material", trunk.material_override)
	for view in target.get_meta("authored_tree_views", []):
		var holder: MultiMeshInstance3D = view.holder
		if is_instance_valid(holder): holder.multimesh.set_instance_transform(int(view.index), Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.001), Vector3(0, -200, 0)))
	target.set_meta("kind", "resource")
	target.set_meta("resource", "lumber")
	target.set_meta("resource_id", "lumber")
	target.set_meta("requires", "axe")
	target.set_meta("amount", 1)
	target.set_meta("authored_tree_revealed", true)
	target.set_meta("authored_tree_game", game)
	target.add_to_group("adventure_resource")
	if not target in game.scene.resources: game.scene.resources.append(target)
	return target

static func restore_batch(resource: Node3D) -> void:
	if not is_instance_valid(resource) or not resource.get_meta("authored_tree_revealed", false): return
	for child in resource.get_children():
		if child is MeshInstance3D and child.get_meta("tree_cut_surface", false): child.queue_free()
	for view in resource.get_meta("authored_tree_views", []):
		var holder: MultiMeshInstance3D = view.holder
		if is_instance_valid(holder): holder.multimesh.set_instance_transform(int(view.index), view.transform)
	var game: Node = resource.get_meta("authored_tree_game", null)
	if is_instance_valid(game): game.scene.resources.erase(resource)
	for key in ["resource", "resource_id", "requires", "amount", "trunk", "trunk_mesh", "trunk_material", "felled", "cut_bands", "cut_height", "authored_tree_game"]:
		if resource.has_meta(key): resource.remove_meta(key)
	resource.set_meta("kind", "authored_tree")
	resource.set_meta("authored_tree_revealed", false)
	resource.remove_from_group("adventure_resource")

static func _surface_from_asset_name(asset_id: String) -> String:
	# Names denote a whole collision proxy, not individual triangles/materials.
	# Mixed or unknown assets deliberately retain the runtime's stone default.
	var name := asset_id.to_lower()
	if name.begins_with("tree_") or name.begins_with("fen_tree_") or name.begins_with("conifer_") or name in ["deadpine", "fallen_log", "heart_arch_tree"]:
		return "wood"
	if name.begins_with("boulder") or name.begins_with("cliff_") or name.begins_with("ruin_") or name.begins_with("standing_stone") or name in ["cairn_stack", "cut_slab_stack", "strata_wall"]:
		return "stone"
	return ""

static func _ground_finish(zone_id: String, asset_id: String, parts: Array) -> void:
	# Keep authored relief, rock sides and water. Only known ground surfaces adopt
	# the shared world-scale soil/weather finish; never override a whole island.
	var finish_zone := ""
	if zone_id == "pinewood_ruins" and asset_id == "ground_patch": finish_zone = zone_id
	elif zone_id in ["sky_garden", "cloudbreak_keep"] and asset_id.begins_with("island_under_"): finish_zone = zone_id
	if finish_zone.is_empty(): return
	var finish := GroundSurfacePalette.material(finish_zone)
	if finish == null: return
	for index in parts.size():
		var part: Dictionary = parts[index]
		if not part.mesh is ArrayMesh: continue
		var mesh := (part.mesh as ArrayMesh).duplicate() as ArrayMesh
		for surface in mesh.get_surface_count():
			var material := mesh.surface_get_material(surface)
			var surface_name := str(material.resource_name).to_lower() if material != null else ""
			if surface_name in ["pw_ground", "turf"]:
				mesh.surface_set_material(surface, finish)
		part.mesh = mesh
		parts[index] = part

static func _collect(node: Node3D, pose: Transform3D, parts: Array) -> void:
	for child in node.get_children():
		if not child is Node3D: continue
		var local: Transform3D = pose * child.transform
		if child is MeshInstance3D and child.mesh != null:
			parts.append({"name":child.name,"mesh":child.mesh,"pose":local,"material":child.material_override})
		_collect(child, local, parts)

static func _scale_vector(value: Variant) -> Vector3:
	var result := Vector3.ZERO
	if value is Array and value.size() == 3:
		result = Vector3(float(value[0]), float(value[1]), float(value[2]))
	elif value is float or value is int:
		result = Vector3.ONE * float(value)
	if not result.is_finite() or result.x <= 0.0 or result.y <= 0.0 or result.z <= 0.0 or result.x > 8.0 or result.y > 8.0 or result.z > 8.0:
		return Vector3.ZERO
	return result
