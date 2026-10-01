extends Node3D
## Physical, explicitly claimed meteor rewards. The caller owns durable persistence.
## Stable reward IDs and an idempotent credit callback are required for crash-safe credit.

signal pending_changed(records: Array)
signal collected(reward: Dictionary)

const MAX_ACTIVE := 16
const MAX_PENDING := 6144
const PICKUP_RADIUS := 0.085
const REST_SECONDS := 8.0

var credit_callback: Callable
var art_callback: Callable
var observer: Node3D
var pending: Dictionary = {} # Stable ID -> JSON-safe reward and position record.
var active: Dictionary = {} # Stable ID -> RigidBody3D.
var ages: Dictionary = {}
var sequence := 0
var rebalance_elapsed := 0.0
var _shared_gem_mesh: Mesh
var _shared_iron_mesh: Mesh
var _gem_material: Material
var _iron_material: Material

func setup(container: Node3D, credit: Callable, art: Callable = Callable(), auto_collect_observer: Node3D = null) -> void:
	if get_parent() != null: get_parent().remove_child(self)
	container.add_child(self)
	credit_callback = credit
	art_callback = art
	observer = auto_collect_observer
	_activate_waiting()

func spawn(reward: Dictionary, point: Vector3, normal: Vector3 = Vector3.UP) -> Node3D:
	var kind := str(reward.get("kind", ""))
	if kind not in ["meteor_gem", "star_iron", "stone", "iron", "crystal"]: return null
	var units := int(reward.get("units", 0))
	if units < 1 or units > 64: return null
	if not point.is_finite(): return null
	var id := str(reward.get("id", ""))
	if id.is_empty():
		# For persistent meteor rewards, callers must supply an ID derived from the
		# meteor and vein/ore strike. This fallback is only session-local.
		sequence += 1
		id = "session-%d-%d" % [Time.get_ticks_usec(), sequence]
	if pending.has(id): return active.get(id)
	if id.length() > 128 or pending.size() >= MAX_PENDING: return null
	var outward := normal.normalized() if normal.is_finite() and normal.length_squared() > 0.01 else Vector3.UP
	var origin := point + outward * 0.24 + Vector3.UP * 0.12
	var entry := {"id": id, "kind": kind, "units": units,
		"position": [origin.x, origin.y, origin.z],
		"normal": [outward.x, outward.y, outward.z],
		"auto_collect": bool(reward.get("auto_collect", false)) and kind in ["stone", "iron", "crystal"]}
	pending[id] = entry
	_rebalance()
	pending_changed.emit(save_pending())
	return active.get(id)

func collect(target: Node, hand: Node3D = null) -> bool:
	if target == null or not is_instance_valid(target): return false
	var id := str(target.get_meta("mining_reward_id", ""))
	if id.is_empty() or not pending.has(id): return false
	if not active.has(id) or active[id] != target: return false
	if not credit_callback.is_valid(): return false
	var reward: Dictionary = pending[id].duplicate(true)
	# The callback must atomically/idempotently apply reward.id to its ledger.
	# A false result leaves the physical reward available for a later retry.
	if not bool(credit_callback.call(reward.duplicate(true))): return false
	pending.erase(id)
	active.erase(id)
	ages.erase(id)
	target.remove_from_group("pickup")
	target.queue_free()
	collected.emit(reward)
	_rebalance()
	pending_changed.emit(save_pending())
	return true

func try_grab(hand: Node3D, desktop: bool = false, camera: Node3D = null) -> bool:
	if hand == null or not is_instance_valid(hand): return false
	if desktop:
		if camera == null or not is_instance_valid(camera): return false
		var ray := PhysicsRayQueryParameters3D.create(camera.global_position,
			camera.global_position - camera.global_basis.z * 3.0)
		var hit: Dictionary = camera.get_world_3d().direct_space_state.intersect_ray(ray)
		var collider: Variant = hit.get("collider")
		return collect(collider, hand) if collider is Node else false
	var target: Node3D = null
	var distance := 0.45 * 0.45
	for body in active.values():
		if not is_instance_valid(body): continue
		var square: float = body.global_position.distance_squared_to(hand.global_position)
		if square < distance:
			target = body
			distance = square
	return collect(target, hand) if target != null else false

func tick(delta: float) -> void:
	var elapsed := maxf(delta, 0.0)
	rebalance_elapsed += elapsed
	for id in active.keys():
		var body: RigidBody3D = active[id]
		if not is_instance_valid(body):
			active.erase(id)
			ages.erase(id)
			continue
		ages[id] = float(ages.get(id, 0.0)) + elapsed
		if float(ages[id]) >= REST_SECONDS and body.sleeping:
			body.freeze = true
		if observer != null and is_instance_valid(observer) and bool(pending[id].get("auto_collect", false)):
			if observer.global_position.distance_squared_to(body.global_position) <= 0.45 * 0.45:
				collect(body, observer)
	if rebalance_elapsed >= 0.5:
		rebalance_elapsed = 0.0
		_rebalance()

func save_pending() -> Array:
	var result: Array = []
	var ids := pending.keys()
	ids.sort()
	for id in ids:
		var entry: Dictionary = pending[id].duplicate(true)
		if active.has(id) and is_instance_valid(active[id]):
			var position: Vector3 = active[id].global_position
			entry.position = [position.x, position.y, position.z]
		result.append(entry)
	return result

func load_pending(records: Array) -> void:
	if not valid_records(records): return
	for body in active.values():
		if is_instance_valid(body):
			body.remove_from_group("pickup")
			body.collision_layer = 0
			body.collision_mask = 0
			body.visible = false
			body.queue_free()
	active.clear()
	ages.clear()
	pending.clear()
	for value in records:
		if not value is Dictionary: continue
		var id := str(value.get("id", ""))
		var kind := str(value.get("kind", ""))
		var coordinates: Variant = value.get("position", [])
		if id.is_empty() or pending.has(id) or kind not in ["meteor_gem", "star_iron", "stone", "iron", "crystal"]: continue
		if int(value.get("units", 0)) < 1 or int(value.get("units", 0)) > 64: continue
		if not coordinates is Array or coordinates.size() != 3: continue
		var p := Vector3(float(coordinates[0]), float(coordinates[1]), float(coordinates[2]))
		if not p.is_finite(): continue
		pending[id] = {"id": id, "kind": kind, "units": int(value.units),
			"position": [p.x, p.y, p.z], "normal": value.get("normal", [0.0, 1.0, 0.0]),
			"auto_collect": bool(value.get("auto_collect", false)) and kind in ["stone", "iron", "crystal"]}
	_rebalance()

func active_count() -> int: return active.size()
func pending_count() -> int: return pending.size()

static func valid_records(records: Variant) -> bool:
	if not records is Array or records.size() > MAX_PENDING: return false
	var seen: Dictionary = {}
	for entry in records:
		if not entry is Dictionary: return false
		var id: Variant = entry.get("id")
		var kind: Variant = entry.get("kind")
		var units: Variant = entry.get("units")
		if not id is String or id.is_empty() or id.length() > 128 or seen.has(id): return false
		if not kind is String or kind not in ["meteor_gem", "star_iron", "stone", "iron", "crystal"]: return false
		if not (units is int or units is float) or not is_finite(float(units)) or floorf(float(units)) != float(units) or units < 1 or units > 64: return false
		if not _valid_vector(entry.get("position")) or not _valid_vector(entry.get("normal")): return false
		if not entry.get("auto_collect") is bool: return false
		seen[id] = true
	return true

static func _valid_vector(value: Variant) -> bool:
	if not value is Array or value.size() != 3: return false
	for component in value:
		if not (component is float or component is int) or not is_finite(float(component)): return false
	return true

func _rebalance() -> void:
	if observer != null and is_instance_valid(observer):
		var ids := pending.keys()
		ids.sort_custom(func(a, b):
			var a_pos: Vector3 = active[a].global_position if active.has(a) and is_instance_valid(active[a]) else _entry_position(pending[a])
			var b_pos: Vector3 = active[b].global_position if active.has(b) and is_instance_valid(active[b]) else _entry_position(pending[b])
			var a_distance := a_pos.distance_squared_to(observer.global_position)
			var b_distance := b_pos.distance_squared_to(observer.global_position)
			return str(a) < str(b) if is_equal_approx(a_distance, b_distance) else a_distance < b_distance)
		var desired: Dictionary = {}
		for i in mini(ids.size(), MAX_ACTIVE): desired[ids[i]] = true
		for id in active.keys():
			if desired.has(id): continue
			var body: RigidBody3D = active[id]
			if is_instance_valid(body):
				var position: Vector3 = body.global_position
				pending[id].position = [position.x, position.y, position.z]
				body.collision_layer = 0
				body.collision_mask = 0
				body.visible = false
				body.queue_free()
			active.erase(id)
			ages.erase(id)
		for id in ids:
			if active.size() >= MAX_ACTIVE: break
			if not active.has(id): _create_body(id)
	else:
		_activate_waiting()

func _entry_position(entry: Dictionary) -> Vector3:
	var coordinates: Array = entry.position
	return Vector3(float(coordinates[0]), float(coordinates[1]), float(coordinates[2]))

func _activate_waiting() -> void:
	if not is_inside_tree(): return
	for id in pending.keys():
		if active.size() >= MAX_ACTIVE: break
		if active.has(id): continue
		_create_body(id)

func _create_body(id: String) -> void:
	if not is_inside_tree() or active.has(id) or not pending.has(id): return
	var entry: Dictionary = pending[id]
	var coordinates: Array = entry.position
	var body := RigidBody3D.new()
	body.name = "MiningPickup_" + str(id).validate_node_name()
	body.mass = 0.25
	body.linear_damp = 2.5
	body.angular_damp = 3.5
	body.can_sleep = true
	body.contact_monitor = false
	body.continuous_cd = true
	body.collision_layer = 1
	body.collision_mask = 1
	body.set_meta("kind", "mining_pickup")
	body.set_meta("mining_reward_id", id)
	body.set_meta("resource", entry.kind)
	body.set_meta("amount", entry.units)
	body.add_to_group("pickup")
	add_child(body)
	body.global_position = Vector3(float(coordinates[0]), float(coordinates[1]), float(coordinates[2]))
	var collision := CollisionShape3D.new()
	var shape := SphereShape3D.new()
	shape.radius = PICKUP_RADIUS
	collision.shape = shape
	body.add_child(collision)
	var visual: Node3D = null
	if art_callback.is_valid():
		var supplied: Variant = art_callback.call(entry.kind)
		if supplied is Node3D: visual = supplied
	if visual == null: visual = _fallback_visual(entry.kind)
	body.add_child(visual)
	body.linear_velocity = Vector3(0.4, 0.7, 0.2)
	active[id] = body
	ages[id] = 0.0

func _fallback_visual(kind: String) -> Node3D:
	var visual := MeshInstance3D.new()
	if kind == "meteor_gem":
		if _shared_gem_mesh == null:
			var mesh := CylinderMesh.new()
			mesh.top_radius = 0.02
			mesh.bottom_radius = 0.13
			mesh.height = 0.34
			mesh.radial_segments = 6
			_shared_gem_mesh = mesh
		var material := _gem_material as StandardMaterial3D
		if material == null:
			material = StandardMaterial3D.new()
			material.albedo_color = Color(0.3, 0.86, 0.98)
			material.emission_enabled = true
			material.emission = Color(0.06, 0.3, 0.42)
			_gem_material = material
		visual.mesh = _shared_gem_mesh
		visual.material_override = _gem_material
	else:
		if _shared_iron_mesh == null:
			var mesh := SphereMesh.new()
			mesh.radius = 0.14
			mesh.height = 0.24
			mesh.radial_segments = 8
			mesh.rings = 4
			_shared_iron_mesh = mesh
		var material := _iron_material as StandardMaterial3D
		if material == null:
			material = StandardMaterial3D.new()
			material.albedo_color = Color(0.43, 0.39, 0.38)
			material.metallic = 0.7
			_iron_material = material
		visual.mesh = _shared_iron_mesh
		visual.material_override = _iron_material
	return visual
