extends RefCounted
## Data-driven static environment dressing. Gameplay bodies remain in WorldZones.
## Zone-local GLB placements share meshes/materials and are chunked for culling.
const CHUNK_METRES := 64.0
const MAX_PLACEMENTS := 2000

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
	for entry in placements:
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
		if not grouped.has(group_key): grouped[group_key] = {"asset":asset_id,"chunk":key,"poses":[]}
		# Apply nonuniform scale in asset-local axes before yaw. Basis.scaled()
		# alone scales world axes and distorts angled ridge instances.
		grouped[group_key].poses.append(Transform3D(Basis(Vector3.UP, yaw) * Basis.IDENTITY.scaled(scale), at))
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
		cache[asset_id] = parts
	var holders := 0
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
			holders += 1
	# Only major authored solids opt into collision. Small flora, banks and
	# atmospheric pieces remain visual, so a dense kit stays cheap and walkable.
	var collider_count := 0
	var asset_meta: Dictionary = document.get("asset_meta", {})
	for entry in placements:
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
		solid.set_meta("kind", "solid")
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

static func _collect(node: Node3D, pose: Transform3D, parts: Array) -> void:
	for child in node.get_children():
		if not child is Node3D: continue
		var local: Transform3D = pose * child.transform
		if child is MeshInstance3D and child.mesh != null:
			parts.append({"mesh":child.mesh,"pose":local,"material":child.material_override})
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
