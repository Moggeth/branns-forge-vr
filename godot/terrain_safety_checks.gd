extends SceneTree
## Offline source-scene terrain/collider and player recovery contract.
const Safety = preload("res://terrain_safety.gd")
class MotionGame extends Node3D:
	var rig: Node3D
	var vr := false
	var landscape = null
	func _owner(node: Node) -> Node:
		while node != null and node != self:
			if node.has_meta("kind"): return node
			node = node.get_parent()
		return null
	func _player_capsule_clear(feet: Vector3) -> bool:
		var shape := CapsuleShape3D.new()
		shape.radius = .2
		shape.height = 1.5
		var query := PhysicsShapeQueryParameters3D.new()
		query.shape = shape
		query.collision_mask = 1
		query.transform = Transform3D(Basis.IDENTITY, feet + Vector3.UP * .95)
		return get_world_3d().direct_space_state.intersect_shape(query, 1).is_empty()
var failures: Array[String] = []
var started := Time.get_ticks_usec()

func _initialize() -> void:
	_run.call_deferred()

func _check(value: bool, description: String) -> void:
	if not value: failures.append(description)

func _box(game: MotionGame, at: Vector3, size: Vector3, angle := 0.0) -> void:
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.set_meta("kind", "floor")
	game.add_child(body)
	body.position = at
	body.rotation.z = angle
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = size
	collision.shape = shape
	body.add_child(collision)

func _motion_fixture() -> void:
	var game := MotionGame.new()
	root.add_child(game)
	game.rig = Node3D.new()
	game.add_child(game.rig)
	_box(game, Vector3(-3.3,-.1,0), Vector3(3,.2,4))
	_box(game, Vector3(0,1.8,0), Vector3(5.6,.2,4), deg_to_rad(40.0))
	await physics_frame
	var motion = preload("res://desktop_locomotion.gd").new()
	game.rig.global_position = Vector3(-3.0,.02,0)
	for i in 280: motion.step(game, Vector3(.02,0,0), 1.0/60.0)
	_check(game.rig.global_position.x > 1.0 and game.rig.global_position.y > 2.0,
		"walkable 40-degree incline can be climbed")
	game.free()

func _run() -> void:
	await _motion_fixture()
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		push_error("Use isolated --world-builder-check mode")
		quit(2)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	game.set_process(false)
	root.add_child(game)
	await physics_frame
	var land = game.landscape
	var local := Vector2(-78, 35)
	var point: Vector3 = land.zone_root.to_global(Vector3(local.x, 0, local.y))
	var original: float = land.height_at(local)
	var preferred := Vector3(point.x, point.y + original + .02, point.z)
	var raised := {"type":"raise", "center":[local.x,local.y], "radius":14.0, "height":7.5}
	_check(land.apply_impact_magic(raised).is_empty(), "raised terrain edit accepted")
	await physics_frame
	var expected: float = Safety.orchard_height(game, preferred)
	var support: Dictionary = game.respawn_recovery.support(preferred)
	_check(expected > preferred.y + 6.0, "current terrain height increased")
	_check(not support.is_empty() and absf(float(support.position.y)-expected)<.22, "raised spawn uses current collider")
	var found: Dictionary = game.respawn_recovery.find(preferred)
	_check(not found.is_empty(), "raised spawn finds supported clear volume")
	if not found.is_empty():
		_check(float(found.feet.y)>preferred.y+6.0, "spawn is above raised ground")
		_check(game.respawn_recovery.overlaps(found.feet).is_empty(), "raised spawn capsule is clear")
		game.rig.global_position=preferred
		game.desktop_locomotion.reset()
		game.desktop_locomotion.step(game,Vector3.ZERO,1.0/60.0)
		_check(game.rig.global_position.y>preferred.y+6.0, "engulfed desktop rig escapes upward")
	var crater := {"type":"crater", "center":[local.x,local.y], "radius":10.0,
		"depth":2.8, "height":1.15, "seed":991}
	_check(land.apply_impact_magic(crater).is_empty(), "impact crater accepted")
	await physics_frame
	var crater_y: float = Safety.orchard_height(game, preferred)
	var crater_hit: Dictionary = game.respawn_recovery.support(preferred)
	_check(not crater_hit.is_empty() and absf(float(crater_hit.position.y)-crater_y)<.22,
		"crater height and collider match at contact")
	if not found.is_empty():
		game.rig.global_position = Vector3(preferred.x, float(found.feet.y), preferred.z)
		game.desktop_locomotion.reset()
		for i in 120: game.desktop_locomotion.step(game, Vector3.ZERO, 1.0/60.0)
		_check(game.desktop_locomotion.grounded and absf(game.rig.global_position.y-crater_y-.02)<.12,
			"unsupported crater cut makes Hero fall to current floor")
	# No raycast should accept an old surface after the authoritative height changes.
	var saved_height: PackedFloat32Array = land.model.height
	var stale_height := saved_height.duplicate()
	var index: int = roundi((local.y-land.model.origin.y)/land.model.step)*int(land.model.size) + roundi((local.x-land.model.origin.x)/land.model.step)
	stale_height[index] += 10.0
	land.model["height"] = stale_height
	_check(game.respawn_recovery.support(preferred).is_empty(), "stale collider cannot certify modified spawn")
	game.rig.global_position = preferred
	game.desktop_locomotion.reset()
	game.desktop_locomotion.step(game, Vector3.ZERO, 1.0/60.0)
	_check(game.rig.global_position == preferred, "pending raised collider holds Hero above the old surface")
	land.model["height"] = saved_height
	print("TERRAIN_SAFETY_RESULT ", JSON.stringify({"failures":failures,
		"seconds":float(Time.get_ticks_usec()-started)/1000000.0}))
	quit(0 if failures.is_empty() else 1)
