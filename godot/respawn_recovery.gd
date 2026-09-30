extends RefCounted
## Recovery is a short transaction: reserve floor, clear equipment, flush physics,
## verify the body volume, then permit input. Never return an unchecked spawn.
const BODY_MASK := 1 | 8
const SAFE_ITEM_SPOTS := [Vector3(-7.5, 1.0, 8.5), Vector3(-6.0, 1.0, 8.5), Vector3(-4.5, 1.0, 8.5), Vector3(-7.5, 1.0, 10.0), Vector3(-6.0, 1.0, 10.0), Vector3(-4.5, 1.0, 10.0)]
var game
var recovering := false
var watch_until := -1.0
var arrival := Vector3.ZERO
var next_watch := 0.0
var relocation_count := 0

func setup(owner_game) -> void:
	game = owner_game

func capsule(feet: Vector3) -> PhysicsShapeQueryParameters3D:
	var shape := CapsuleShape3D.new()
	shape.radius = 0.28
	shape.height = 1.72
	var query := PhysicsShapeQueryParameters3D.new()
	query.shape = shape
	query.collision_mask = BODY_MASK
	query.transform = Transform3D(Basis.IDENTITY, feet + Vector3.UP * 0.93)
	return query

func overlaps(feet: Vector3) -> Array[Dictionary]:
	return game.get_world_3d().direct_space_state.intersect_shape(capsule(feet), 64)

func _movable(collider: Node) -> Node3D:
	if not is_instance_valid(collider): return null
	var item: Node3D = game._owner(collider)
	if item == null or item in game.held.values(): return null
	if game.grips != null and game.grips.is_stowed(item): return null
	if item.get_meta("kind", "") in ["enemy", "brann", "floor", "solid", "portal", "button"]: return null
	if item.is_in_group("pickup") or item.get_meta("kind", "") in ["weapon", "skeleton_bone", "apple", "matchbox", "bottle"] or item.has_meta("drop_body"):
		return item
	if collider is RigidBody3D and collider.is_in_group("pickup"): return collider
	return null

func support(candidate: Vector3) -> Dictionary:
	var query := PhysicsRayQueryParameters3D.create(candidate + Vector3.UP * 4.0, candidate + Vector3.DOWN * 5.0, BODY_MASK)
	var excluded: Array[RID] = []
	# Loose equipment must not be mistaken for the support floor or obscure it.
	for attempt in 24:
		var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(query)
		if hit.is_empty(): return {}
		var owner: Node3D = game._owner(hit.collider)
		if owner != null and owner.get_meta("kind", "") == "floor" and hit.normal.y >= 0.8: return hit
		if _movable(hit.collider) == null: return {}
		excluded.append(hit.collider.get_rid())
		query.exclude = excluded
	return {}

func find(preferred: Vector3, allow_equipment: bool = false) -> Dictionary:
	var offsets := [Vector3.ZERO]
	for radius in [2.0, 4.0, 6.0, 8.0, 12.0, 16.0, 20.0]:
		for i in 16:
			var angle := TAU * float(i) / 16.0
			offsets.append(Vector3(sin(angle), 0, cos(angle)) * radius)
	for offset in offsets:
		var floor_hit := support(preferred + offset)
		if floor_hit.is_empty(): continue
		var feet: Vector3 = floor_hit.position + Vector3.UP * 0.025
		var blocked := overlaps(feet)
		var removable := true
		for hit in blocked:
			if _movable(hit.collider) == null:
				removable = false
				break
		if blocked.is_empty() or (allow_equipment and removable):
			return {"feet": feet, "blockers": blocked}
	return {}

func _relocate(item: Node3D) -> bool:
	if item == null: return false
	var id := str(item.get_meta("collection_id", item.get_meta("id", "")))
	if game.collection != null and game.collection.homes.has(id):
		if game.collection.return_item(id):
			relocation_count += 1
			return true
	var body: Node3D = item.get_meta("drop_body", item)
	if not is_instance_valid(body): body = item
	if body is RigidBody3D:
		body.linear_velocity = Vector3.ZERO
		body.angular_velocity = Vector3.ZERO
		body.sleeping = true
	var local: Vector3 = SAFE_ITEM_SPOTS[relocation_count % SAFE_ITEM_SPOTS.size()]
	local.z += floorf(float(relocation_count) / SAFE_ITEM_SPOTS.size()) * 1.5
	body.reparent(game.adventure.zone_groups.forge_yard)
	body.global_position = game.scene.zones.forge_yard.center + local
	body.force_update_transform()
	relocation_count += 1
	print("RESPAWN_ITEM_RECOVERY id=", id, " position=", body.global_position)
	return true

func clear_equipment(feet: Vector3) -> void:
	var seen := {}
	for hit in overlaps(feet):
		var item := _movable(hit.collider)
		if item == null or seen.has(item.get_instance_id()): continue
		seen[item.get_instance_id()] = true
		_relocate(item)

func recover(preferred: Vector3) -> Dictionary:
	if recovering: return {"ok": false, "reason": "Recovery already in progress"}
	recovering = true
	relocation_count = 0
	var started := Time.get_ticks_usec()
	# Prefer the intended open approach, returning obstructing tools to their homes.
	var reserved := find(preferred, true)
	if not reserved.is_empty(): clear_equipment(reserved.feet)
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	var valid := find(preferred)
	if valid.is_empty():
		recovering = false
		push_error("RESPAWN no supported clear player volume; input remains suspended")
		return {"ok": false, "reason": "The recovery area is obstructed. Retry recovery."}
	var feet: Vector3 = valid.feet
	var head_offset: Vector3 = game.camera.global_position - game.rig.global_position
	head_offset.y = 0.0
	game.rig.global_position = feet - head_offset
	game.desktop_last_position = game.rig.global_position
	game.desktop_swing_started = -1.0
	game.desktop_swing_item = null
	game.desktop_locomotion.reset()
	game.held_pose.refresh(game)
	game.previous_tips.clear()
	if game.melee != null: game.melee.tracks.clear()
	arrival = feet
	watch_until = game.elapsed + 1.5
	next_watch = game.elapsed
	recovering = false
	print("RESPAWN_VERIFIED relocated=", relocation_count, " feet=", feet, " seconds=", (Time.get_ticks_usec() - started) / 1000000.0)
	return {"ok": true, "feet": feet, "relocated": relocation_count}

func tick(_delta: float) -> void:
	if game == null or game.elapsed > watch_until or game.elapsed < next_watch: return
	var feet := Vector3(game.camera.global_position.x, game.rig.global_position.y, game.camera.global_position.z)
	if Vector2(feet.x, feet.z).distance_to(Vector2(arrival.x, arrival.z)) > 0.45:
		watch_until = -1.0
		return
	next_watch = game.elapsed + 0.08
	# Delayed deliveries cannot trap a stationary player after clearance passed.
	clear_equipment(feet)
