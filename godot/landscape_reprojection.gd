extends RefCounted
## Moves existing Orchard dressing with the heightfield without changing its
## authored X/Z placement. setup() captures immutable flat-world baselines.

const MAX_TREE_GRADE: float = 0.72

var _root: Node3D
var _terrain_root: Node3D
var _anchors: Array[Dictionary] = []
var _instances: Array[Dictionary] = []
var _model: Dictionary = {}


func setup(root: Node3D, model: Dictionary) -> Dictionary:
	_root = root
	_terrain_root = root if root.name == "orchard_highlands" else root.find_child("orchard_highlands", true, false) as Node3D
	if _terrain_root == null: _terrain_root = root
	_model = model
	_anchors.clear()
	_instances.clear()
	var candidates: Array[Node] = [root]
	candidates.append_array(root.find_children("*", "Node3D", true, false))
	var anchored: Dictionary = {}
	for candidate in candidates:
		if not candidate is Node3D: continue
		var node: Node3D = candidate
		if node == root or node == _terrain_root: continue
		var point: Vector3 = node.get_meta("_landscape_base_point", _terrain_root.to_local(node.global_position))
		if not _inside(Vector2(point.x, point.z)): continue
		if node is MultiMeshInstance3D and _is_dressing(node):
			_capture_instances(node)
		elif _is_anchor(node):
			if not node.has_meta("_landscape_base_point"):
				node.set_meta("_landscape_base_point", point)
				node.set_meta("_landscape_base_y", node.position.y)
			var entry := {"node": node, "point": point, "base_y": node.get_meta("_landscape_base_y"), "parent": null, "hidden": false, "collisions": []}
			_anchors.append(entry)
			anchored[node.get_instance_id()] = entry
	for entry in _anchors:
		var parent: Node = entry.node.get_parent()
		while parent != null and parent != root:
			if anchored.has(parent.get_instance_id()):
				entry.parent = anchored[parent.get_instance_id()]
				break
			parent = parent.get_parent()
		if _is_tree(entry.node):
			entry.collisions = entry.node.find_children("*", "CollisionShape3D", true, false)
	var changed: int = refresh_region(root, model, Rect2(Vector2(-10000, -10000), Vector2(20000, 20000)))
	return {"anchors": _anchors.size(), "instances": _instances.size(), "updated": changed}


func refresh_region(root: Node3D, model: Dictionary, bounds: Rect2) -> int:
	if root != _root: return 0
	_model = model
	var updated: int = 0
	for entry in _anchors:
		var point: Vector3 = entry.point
		if not bounds.has_point(Vector2(point.x, point.z)): continue
		var node: Node3D = entry.node
		if not is_instance_valid(node): continue
		var parent_delta: float = 0.0
		if entry.parent != null:
			var parent_point: Vector3 = entry.parent.point
			parent_delta = _height(Vector2(parent_point.x, parent_point.z))
		node.position.y = float(entry.base_y) + _height(Vector2(point.x, point.z)) - parent_delta
		if _is_tree(node): _set_anchor_valid(entry, not _invalid(Vector2(point.x, point.z)))
		updated += 1
	var touched: Dictionary = {}
	for entry in _instances:
		var point: Vector3 = entry.point
		if not bounds.has_point(Vector2(point.x, point.z)): continue
		var holder: MultiMeshInstance3D = entry.holder
		if not is_instance_valid(holder): continue
		var multi: MultiMesh = holder.multimesh
		if multi == null or int(entry.index) >= multi.instance_count: continue
		var current: Transform3D = multi.get_instance_transform(entry.index)
		var was_hidden: bool = current.origin.y < -100.0 or current.basis.x.length() < 0.01
		if was_hidden and not bool(entry.invalid_hidden): continue
		var hide: bool = bool(entry.flora) and _invalid(Vector2(point.x, point.z))
		var pose: Transform3D = entry.pose
		entry.projected_y = pose.origin.y + _height(Vector2(point.x, point.z))
		if hide:
			multi.set_instance_transform(entry.index, Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.001), Vector3(0, -200, 0)))
			entry.invalid_hidden = true
		else:
			pose.origin.y = entry.projected_y
			multi.set_instance_transform(entry.index, pose)
			entry.invalid_hidden = false
		touched[holder.get_instance_id()] = holder
		updated += 1
	for holder in touched.values(): _update_aabb(holder)
	return updated


func counts() -> Dictionary:
	return {"anchors": _anchors.size(), "instances": _instances.size()}


func _capture_instances(holder: MultiMeshInstance3D) -> void:
	var multi: MultiMesh = holder.multimesh
	if multi == null: return
	var flora: bool = _is_flora(holder)
	var addresses: Variant = holder.get_meta("builder_positions", holder.get_meta("dressing_positions", []))
	var base_poses: Array = holder.get_meta("_landscape_base_poses", [])
	if base_poses.size() != multi.instance_count:
		base_poses = []
		for i in multi.instance_count: base_poses.append(multi.get_instance_transform(i))
		holder.set_meta("_landscape_base_poses", base_poses)
	for i in multi.instance_count:
		var pose: Transform3D = base_poses[i]
		if pose.origin.y < -100.0 or pose.basis.x.length() < 0.01: continue
		var point: Vector3 = addresses[i] if addresses.size() == multi.instance_count else _terrain_root.to_local(holder.to_global(pose.origin))
		if not _inside(Vector2(point.x, point.z)): continue
		_instances.append({"holder": holder, "index": i, "pose": pose, "point": point, "flora": flora, "invalid_hidden": false, "projected_y": pose.origin.y})


func _update_aabb(holder: MultiMeshInstance3D) -> void:
	var multi: MultiMesh = holder.multimesh
	var original: AABB = multi.custom_aabb
	var low: float = 0.0
	var high: float = 2.0
	for i in multi.instance_count:
		var pose: Transform3D = multi.get_instance_transform(i)
		if pose.origin.y < -100.0 or pose.basis.x.length() < 0.01: continue
		low = minf(low, pose.origin.y - 3.0)
		high = maxf(high, pose.origin.y + 14.0)
	multi.custom_aabb = AABB(Vector3(original.position.x, low, original.position.z), Vector3(original.size.x, high - low, original.size.z))


func _set_anchor_valid(entry: Dictionary, valid: bool) -> void:
	var node: Node3D = entry.node
	if not valid and not bool(entry.hidden):
		if not node.visible: return
		node.visible = false
		entry.hidden = true
		for collider in entry.collisions:
			if is_instance_valid(collider): collider.set_deferred("disabled", true)
	elif valid and bool(entry.hidden):
		node.visible = true
		entry.hidden = false
		for collider in entry.collisions:
			if is_instance_valid(collider): collider.set_deferred("disabled", false)


func _height(point: Vector2) -> float:
	return _sample("height", point)


func _invalid(point: Vector2) -> bool:
	return _sample("water", point) > 0.08 or _sample("slope", point) > MAX_TREE_GRADE


func _sample(key: String, point: Vector2) -> float:
	var field: PackedFloat32Array = _model.get(key, PackedFloat32Array())
	var size: int = int(_model.get("size", 0))
	if field.size() != size * size or size < 2: return 0.0
	var origin: Vector2 = _model.get("origin", Vector2.ZERO)
	var step: float = float(_model.get("step", 2.0))
	var fx: float = clampf((point.x - origin.x) / step, 0.0, size - 1.0)
	var fz: float = clampf((point.y - origin.y) / step, 0.0, size - 1.0)
	var x: int = floori(fx)
	var z: int = floori(fz)
	var nx: int = mini(size - 1, x + 1)
	var nz: int = mini(size - 1, z + 1)
	return lerpf(lerpf(field[z * size + x], field[z * size + nx], fx - x), lerpf(field[nz * size + x], field[nz * size + nx], fx - x), fz - z)


func _inside(point: Vector2) -> bool:
	var size: int = int(_model.get("size", 0))
	var origin: Vector2 = _model.get("origin", Vector2.ZERO)
	var extent: float = (size - 1) * float(_model.get("step", 2.0))
	return point.x >= origin.x and point.y >= origin.y and point.x <= origin.x + extent and point.y <= origin.y + extent


static func _is_anchor(node: Node3D) -> bool:
	if str(node.get_meta("kind", "")) == "portal": return false
	if str(node.get_meta("zone", "")) == "orchard_highlands" and node.has_meta("resource_id"): return true
	if node is CollisionShape3D and node.has_meta("builder_timber"): return true
	for prefix in ["OrchardPlot_", "Tree_", "GroundRockCollision", "WoodlandRockCollision", "OrchardArtSolid", "RouteWaymarker", "GrownGrove_", "BuiltOrchardBridge"]:
		if node.name.begins_with(prefix): return true
	return false


static func _is_tree(node: Node3D) -> bool:
	return node.name.begins_with("Tree_") or node.has_meta("builder_timber") or str(node.get_meta("resource_id", "")) == "lumber"


static func _is_dressing(node: MultiMeshInstance3D) -> bool:
	return node.has_meta("builder_positions") or node.has_meta("dressing_positions") or node.name.begins_with("Orchard_") or node.name.begins_with("Woodland_") or node.name.begins_with("gk_")


static func _is_flora(node: MultiMeshInstance3D) -> bool:
	var name: String = node.name.to_lower()
	return name.contains("tree") or name.contains("grass") or name.contains("fern") or name.contains("flower") or name.contains("clover") or name.contains("seedhead") or name.contains("hedge") or name.contains("shrub") or name.contains("litter") or name.contains("silhouette")
