extends RefCounted
## Offline check of the actual Main mouse callbacks, not only their input adapter.

static func run(game) -> void:
	var failures: Array[String] = []
	if game.vr or game.desktop_look == null: failures.append("desktop look was not installed")
	# Travel is the same path used by death recovery. A valid respawn must let
	# desktop movement leave the forge instead of trapping the capsule in props.
	game.adventure.travel("orchard_highlands")
	game.adventure.travel("forge_yard")
	await game.get_tree().physics_frame
	var respawn_origin: Vector3 = game.rig.position
	for direction in [Vector3.FORWARD, Vector3.BACK, Vector3.LEFT, Vector3.RIGHT]:
		game.rig.position = respawn_origin
		game._move_to(respawn_origin + direction * 0.35)
		if game.rig.position.distance_to(respawn_origin) < 0.2:
			failures.append("desktop player cannot walk after forge respawn: %s" % str(direction))
	game.rig.position = respawn_origin
	var blocker := StaticBody3D.new()
	blocker.name = "RespawnObstructionFixture"
	blocker.collision_layer = 1
	blocker.collision_mask = 0
	blocker.set_meta("kind", "solid")
	game.add_child(blocker)
	blocker.global_position = game.scene.zones.forge_yard.spawn + Vector3(0, 0.8, 4)
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1.5, 1.6, 1.5)
	shape.shape = box
	blocker.add_child(shape)
	await game.get_tree().physics_frame
	game.adventure.dying = true
	game.adventure.hp = 0
	game.adventure._finish_death_recovery()
	var recovered: Vector3 = game.rig.global_position
	if recovered.distance_to(blocker.global_position - Vector3.UP * 0.8) < 0.9:
		failures.append("death recovery placed Hero inside an occupied forge spawn")
	if game.adventure.dying or game.adventure.hp != 100 or game.adventure.zone != "forge_yard":
		failures.append("death recovery did not reset health and location")
	game._move_to(recovered + Vector3(0, 0, 0.35))
	if game.rig.global_position.distance_to(recovered) < 0.2:
		failures.append("desktop player cannot walk after obstructed death recovery")
	blocker.queue_free()
	game.desktop_last_position = game.rig.global_position
	game.desktop_bob_strength = 0.0
	var key := str(game.desktop_hand.get_instance_id())
	var old_held: Dictionary = game.held.duplicate()
	var hammer: Node3D = game.scene.hammer
	game.held = {key: hammer}
	game.desktop_swing_ready = 0.0
	var left := InputEventMouseButton.new()
	left.button_index = MOUSE_BUTTON_LEFT
	left.pressed = true
	var right := InputEventMouseButton.new()
	right.button_index = MOUSE_BUTTON_RIGHT
	right.pressed = true
	var actions = preload("res://desktop_hero_actions.gd")
	var primary: Dictionary = actions.route(left, false, false, Callable(game, "_desktop_primary"), Callable(game, "_desktop_alternate"))
	if not primary.handled or game.desktop_swing_ready <= game.elapsed:
		failures.append("left click did not use held hammer's primary strike")
	if game.item_actions.cooldowns.has("starter_hammer"):
		failures.append("left click wrongly fired the hammer alternate")
	var secondary: Dictionary = actions.route(right, false, false, Callable(game, "_desktop_primary"), Callable(game, "_desktop_alternate"))
	if not secondary.handled or float(game.item_actions.cooldowns.get("starter_hammer", 0.0)) <= game.elapsed:
		failures.append("right click did not fire the hammer alternate")
	if game.desktop_look != null:
		var previous_yaw: float = game.rig.rotation.y
		game.desktop_look.capture()
		var motion := InputEventMouseMotion.new()
		motion.screen_relative = Vector2(16, -8)
		if not game.desktop_look.handle_event(motion) or is_equal_approx(previous_yaw, game.rig.rotation.y):
			failures.append("captured mouse motion did not turn the Hero")
		game.desktop_look.release_capture()
	var axe=game.adventure._tool_model("woodland_axe")
	game.add_child(axe)
	game.grips._attach(game.desktop_hand,axe)
	if absf(axe.rotation.y+PI/2)>0.001: failures.append("desktop axe still presents broadside")
	var previous_strength:float=game.desktop_bob_strength
	game.rig.global_position+=Vector3(0.1,0,0)
	game._desktop_weapon_motion(0.016)
	if game.desktop_bob_strength<=previous_strength: failures.append("walking did not animate held weapon")
	game.held={key:hammer}
	game.desktop_swing_ready=0
	game._desktop_primary()
	if game.desktop_swing_started<0 or game.desktop_swing_ready<=game.elapsed: failures.append("melee click did not begin visible swing")
	var crossbow=preload("res://siegebird_checks.gd").load_sample(game)
	if crossbow==null: failures.append("Siegebird asset missing from desktop test")
	else:
		game.grips._attach(game.desktop_hand,crossbow)
		game.siegebird.tick(0.016)
		var w=game.siegebird.desktop_weapon(game.desktop_hand)
		var before:int=game.siegebird.projectiles.size()
		game._desktop_primary()
		if game.siegebird.projectiles.size()!=before+1: failures.append("desktop left click did not fire loaded Siegebird")
		await game.siegebird.desktop_reload(game.desktop_hand)
		if not w.loaded or w.draw<0.999: failures.append("desktop R path did not cock and seat a bolt")
		before=game.siegebird.projectiles.size()
		game._desktop_primary()
		if game.siegebird.projectiles.size()!=before+1: failures.append("desktop reload did not allow another shot")
	if game.desktop_help_panel==null or game.desktop_help_panel.visible: failures.append("desktop controls panel not initially collapsed")
	if game.info.text.contains("\n"): failures.append("desktop quick hint became cluttered")
	game.held = old_held
	axe.queue_free()
	print("DESKTOP_HERO_INTEGRATION_RESULT ", JSON.stringify(failures))
	game.get_tree().quit(0 if failures.is_empty() else 1)
