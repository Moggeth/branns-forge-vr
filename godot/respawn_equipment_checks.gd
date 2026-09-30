extends SceneTree
## Actual offline Main: multiple equipment proxies, late deliveries, HMD offset,
## and death during an FPS windup. No service, user saves or VR runtime.
var failures: Array[String] = []
var started := Time.get_ticks_usec()

func _initialize() -> void:
	call_deferred("_run")

func _check(ok: bool, message: String) -> void:
	if not ok: failures.append(message)

func _weapon(game: Node3D, id: String, at: Vector3) -> Node3D:
	var item := Node3D.new()
	item.name = "RecoveryFixture_" + id
	item.set_meta("kind", "weapon")
	item.set_meta("id", id)
	item.add_to_group("pickup")
	game.add_child(item)
	item.global_position = at
	var body := StaticBody3D.new()
	body.collision_layer = 1 | 8
	body.collision_mask = 0
	item.add_child(body)
	var collision := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = Vector3(0.7, 0.7, 0.7)
	collision.shape = shape
	body.add_child(collision)
	return item

func _run() -> void:
	create_timer(40.0).timeout.connect(func(): push_error("RESPAWN_EQUIPMENT watchdog"); quit(2))
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		push_error("Require --world-builder-check for isolation")
		quit(2)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var recovery = game.respawn_recovery
	var preferred: Vector3 = game.scene.zones.forge_yard.spawn + Vector3(0, 0, 4)
	var initial: Dictionary = recovery.find(preferred)
	_check(not initial.is_empty(), "Forge has a supported clear baseline")
	if initial.is_empty(): quit(1); return
	preferred = initial.feet
	var equipment: Array[Node3D] = []
	for entry in [["sunfall_fixture", Vector3(-0.14, 0.85, 0)], ["siegebird_fixture", Vector3(0.12, 1.1, 0.12)], ["wyrm_fixture", Vector3(0, 0.55, -0.14)]]:
		equipment.append(_weapon(game, entry[0], preferred + entry[1]))
	# One takes the authored collection-home route; two use safe equipment slots.
	game.collection.register(equipment[0])
	equipment[0].global_position = preferred + Vector3(-0.14, 0.85, 0)
	var held: Node3D = _weapon(game, "held_fixture", preferred + Vector3(0, 2.3, 0))
	# Actual grips disable the held body's collider; match that contract here.
	(held.get_child(0) as StaticBody3D).collision_layer = 0
	var hand_key := str(game.desktop_hand.get_instance_id())
	var old_held: Dictionary = game.held.duplicate()
	game.held[hand_key] = held
	game.adventure.dying = true
	await physics_frame
	await physics_frame
	_check(recovery.overlaps(preferred).size() >= 3, "Fixture covers spawn with all three equipment proxies")
	# Lateral room-scale HMD displacement must be honoured when placing the body.
	var camera_pose: Transform3D = game.camera.transform
	game.camera.position += Vector3(0.16, 0, -0.10)
	var result: Dictionary = await recovery.recover(preferred)
	_check(result.get("ok", false), "Recovery finds and verifies a supported spawn")
	_check(int(result.get("relocated", 0)) >= 3, "All obstructing tools move before input resumes")
	_check(recovery.overlaps(result.get("feet", preferred)).is_empty(), "Verified body volume has no equipment or static overlaps")
	_check(Vector2(game.camera.global_position.x, game.camera.global_position.z).distance_to(Vector2(result.feet.x, result.feet.z)) < 0.001, "Recovery accounts for HMD offset")
	_check(game.held[hand_key] == held, "Recovery preserves intentionally held equipment")
	game.camera.transform = camera_pose
	# A delayed delivery into the reserved capsule is relocated during the guard.
	var late := _weapon(game, "late_fixture", result.feet + Vector3.UP * 0.9)
	await physics_frame
	game.elapsed += 0.1
	recovery.tick(0.1)
	await physics_frame
	await physics_frame
	_check(recovery.overlaps(result.feet).is_empty(), "Late delivery cannot trap the stationary respawned Hero")
	# A windup is cancelled while dying, even though input has already stopped.
	game.desktop_swing_item = held
	game.desktop_swing_started = game.elapsed - 0.20
	game.desktop_swing_contact = false
	game._desktop_weapon_motion(0.016)
	_check(game.desktop_swing_started < 0 and not game.desktop_swing_contact, "Death suspends an in-progress melee strike")
	game.held = old_held
	game.adventure.dying = false
	for item in equipment: item.queue_free()
	held.queue_free()
	late.queue_free()
	print("RESPAWN_EQUIPMENT_RESULT ", JSON.stringify({"failures": failures, "seconds": (Time.get_ticks_usec() - started) / 1000000.0}))
	quit(0 if failures.is_empty() else 1)
