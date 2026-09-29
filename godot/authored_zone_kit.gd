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
		var scale: float = float(entry.get("scale", 1.0))
		if scale <= 0.0 or scale > 8.0: return {"error":"invalid scale: " + asset_id}
		var at := Vector3(float(position[0]), float(position[1]), float(position[2]))
		var yaw := deg_to_rad(float(entry.get("yaw_degrees", 0.0)))
		var key := Vector2i(floori(at.x / CHUNK_METRES), floori(at.z / CHUNK_METRES))
		var group_key := asset_id + ":" + str(key.x) + ":" + str(key.y)
		if not grouped.has(group_key): grouped[group_key] = {"asset":asset_id,"chunk":key,"poses":[]}
		grouped[group_key].poses.append(Transform3D(Basis(Vector3.UP, yaw).scaled(Vector3.ONE * scale), at))
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
	var result := {"assets":cache.size(),"placements":placements.size(),"holders":holders}
	print("ZONE_KIT ", JSON.stringify(result))
	return result

static func _collect(node: Node3D, pose: Transform3D, parts: Array) -> void:
	for child in node.get_children():
		if not child is Node3D: continue
		var local: Transform3D = pose * child.transform
		if child is MeshInstance3D and child.mesh != null:
			parts.append({"mesh":child.mesh,"pose":local,"material":child.material_override})
		_collect(child, local, parts)
