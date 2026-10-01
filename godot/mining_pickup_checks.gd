extends SceneTree
## Run: Godot --headless --xr-mode off --audio-driver Dummy --path godot --script res://mining_pickup_checks.gd
const Pickups = preload("res://mining_pickups.gd")
var credited: Dictionary = {}
var calls := 0

func _initialize() -> void:
	call_deferred("_run")

func _credit(reward: Dictionary) -> bool:
	calls += 1
	var id := str(reward.id)
	if credited.has(id): return false
	credited[id] = int(reward.units)
	return true

func _run() -> void:
	var failures: Array[String] = []
	var stage := Node3D.new()
	root.add_child(stage)
	var floor := StaticBody3D.new()
	stage.add_child(floor)
	var floor_shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(20.0, 0.2, 20.0)
	floor_shape.shape = box
	floor.add_child(floor_shape)
	floor.position.y = -0.1
	var pickups := Pickups.new()
	pickups.setup(stage, Callable(self, "_credit"))
	var first: Node3D = pickups.spawn({"id": "meteor-a-vein-0", "kind": "meteor_gem", "units": 1}, Vector3.UP, Vector3.UP)
	if first == null or not first is RigidBody3D: failures.append("rare reward is not a rigid body")
	if first != null and (first.get_meta("kind", "") != "mining_pickup" or not first.is_in_group("pickup")):
		failures.append("pickup route metadata")
	var has_shape := false
	if first != null:
		for child in first.get_children():
			if child is CollisionShape3D and child.shape is SphereShape3D: has_shape = true
	if not has_shape: failures.append("physics collision missing")
	if pickups.spawn({"id": "meteor-a-vein-0", "kind": "meteor_gem", "units": 1}, Vector3.UP) != first:
		failures.append("duplicate spawn made another reward")
	if pickups.spawn({"id": "invalid-point", "kind": "crystal", "units": 1}, Vector3(INF, 0.0, 0.0)) != null:
		failures.append("nonfinite point accepted")
	for i in 20:
		pickups.spawn({"id": "meteor-b-%d" % i, "kind": "star_iron", "units": 1}, Vector3(0.0, 1.0, 0.0))
	if pickups.active_count() != Pickups.MAX_ACTIVE or pickups.pending_count() != 21:
		failures.append("active cap lost queued rewards")
	var saved: Array = pickups.save_pending()
	if saved.size() != 21: failures.append("save lost queued rewards")
	if not Pickups.valid_records(saved) or Pickups.valid_records(saved + [saved[0]]):
		failures.append("record schema duplicate validation")
	var json_records: Variant = JSON.parse_string(JSON.stringify(saved))
	if not Pickups.valid_records(json_records): failures.append("JSON round-trip record validation")
	if json_records is Array:
		var fractional: Array = json_records.duplicate(true)
		fractional[0].units = 1.5
		if Pickups.valid_records(fractional): failures.append("fractional units accepted")
	var bad: Array = saved.duplicate(true)
	bad[0].normal = [INF, 0.0, 0.0]
	if Pickups.valid_records(bad): failures.append("nonfinite normal record accepted")
	if first != null:
		if not pickups.collect(first): failures.append("first deliberate collection failed")
		if pickups.collect(first): failures.append("duplicate collection credited again")
	if calls != 1 or credited.size() != 1 or pickups.pending_count() != 20 or pickups.active_count() != Pickups.MAX_ACTIVE:
		failures.append("credit/cap transition")
	var remaining: Array = pickups.save_pending()
	pickups.load_pending(remaining)
	if pickups.pending_count() != 20 or pickups.active_count() != Pickups.MAX_ACTIVE:
		failures.append("reload did not restore pending and cap")
	var observer := Node3D.new()
	stage.add_child(observer)
	observer.global_position = Vector3(100.0, 1.0, 0.0)
	pickups.observer = observer
	pickups.spawn({"id": "near-observer", "kind": "crystal", "units": 1}, observer.global_position)
	if not pickups.active.has("near-observer") or pickups.active_count() != Pickups.MAX_ACTIVE or pickups.pending_count() != 21:
		failures.append("nearest live cap lost nearby reward")
	pickups.spawn({"id": "normal-fallback", "kind": "crystal", "units": 1}, Vector3(0.0, 1.0, 0.0), Vector3(INF, 0.0, 0.0))
	if not Pickups.valid_records(pickups.save_pending()): failures.append("hostile normal was not sanitized")
	await physics_frame
	await physics_frame
	for body in pickups.active.values():
		if not is_instance_valid(body) or not body is RigidBody3D or body.collision_layer == 0:
			failures.append("reloaded body has no physics")
			break
	stage.queue_free()
	if failures.is_empty():
		print("MINING_PICKUP_CHECKS PASS")
		quit(0)
	else:
		for failure in failures: push_error(failure)
		quit(1)
