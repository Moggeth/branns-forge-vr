extends SceneTree
## Real root, animation and collision check. Uses offline builder state only.
const Ents = preload("res://world_builder_ents.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var builder: Node = game.world_builder
	builder.test_mode = true
	builder.data = builder.fresh_state()
	builder.data.mana = 20.0
	var ents: Node = Ents.new()
	game.add_child(ents)
	ents.setup(builder)
	builder.ents = ents
	var source: Node3D = null
	for key in builder.resource_by_key:
		var candidate: Node3D = builder.resource_by_key[key]
		if is_instance_valid(candidate) and candidate.visible and str(candidate.get_meta("tree_species", "")) == "apple":
			var local: Vector3 = game.scene.zones.orchard_highlands.root.to_local(candidate.global_position)
			var route: Array[Vector2] = preload("res://landscape_navigation.gd").route(game.landscape.model, Vector2(local.x, local.z), Vector2(local.x + 2.0, local.z))
			if not route.is_empty(): source = candidate; break
	if source == null: failures.append("no routable apple tree")
	else:
		var original: Vector3 = source.global_position
		var trunk: Variant = source.get_meta("trunk_mesh", null)
		if ents.awaken(source.global_position - builder.center) != "": failures.append("awaken failed")
		else:
			var key := str(source.get_meta("ent_key", ""))
			if ents.calm(source.global_position - builder.center) != "": failures.append("calm failed")
			game.adventure.travel("orchard_highlands")
			game.camera.global_position = original + Vector3(50, 2, 50)
			var furthest := 0.0
			var moving := 0
			for frame in 2100:
				game.elapsed = float(frame) * 0.05
				ents.tick(0.05)
				game.animation.tick(0.05)
				var distance := Vector2(source.global_position.x - original.x, source.global_position.z - original.z).length()
				furthest = maxf(furthest, distance)
				if str(source.get_meta("idle_wander", {}).get("phase", "")) == "walk": moving += 1
				if distance > 4.5: failures.append("Ent wandered outside home radius"); break
				if frame == 1700: ents._record(key).calm_left = 60.0
				if moving > 8: break
				if frame % 20 == 0: await physics_frame
			if furthest < 0.02 or moving < 8: failures.append("calm Ent did not visibly wander")
			if source.get_meta("trunk_mesh", null) != trunk or ents.active.get(key) != source: failures.append("Ent body/visual source changed")
			if source.get_node_or_null("EntPresentation") == null: failures.append("Ent visual detached")
			if not builder._valid(builder.data): failures.append("wander record invalid for persistence")
			if not ents._record(key).has("position"): failures.append("Ent displacement not persisted")
			ents.active.clear()
			ents.restore()
			if ents.active.get(key) != source or source.global_position.distance_to(original) < 0.02: failures.append("Ent restore reset displacement or duplicated body")
			var state: Dictionary = source.get_meta("idle_wander", {})
			var stopped := preload("res://creature_idle_wander.gd").interrupt(state, game.elapsed)
			if stopped.get("phase", "") != "pause": failures.append("combat did not interrupt Ent walk")
	game.adventure.travel("pinewood_ruins")
	var skeleton: Node3D = null
	for enemy in game.scene.enemies:
		if is_instance_valid(enemy) and str(enemy.get_meta("zone", "")) == "pinewood_ruins" and str(enemy.get_meta("enemy_type", "")) == "skeleton":
			skeleton = enemy
			break
	if skeleton == null: failures.append("real skeleton absent")
	else:
		var original: Vector3 = skeleton.global_position
		game.camera.global_position = original + Vector3(40, 2, 40)
		var moving := 0
		var walk_pose := false
		for frame in 700:
			game.elapsed = 200.0 + float(frame) * 0.1
			game.adventure._enemies(0.1)
			game.animation.tick(0.1)
			if str(skeleton.get_meta("idle_wander", {}).get("phase", "")) == "walk": moving += 1
			var rig: Dictionary = game.animation.actors.get(skeleton.get_instance_id(), {})
			if str(rig.get("state", "")) == "walk": walk_pose = true
			if frame % 20 == 0: await physics_frame
		if moving < 5 or skeleton.global_position.distance_to(original) < 0.02: failures.append("idle skeleton did not walk")
		if not walk_pose: failures.append("skeleton did not enter walk animation")
		game.camera.global_position = skeleton.global_position + Vector3(0, 1.7, 2.0)
		game.elapsed += 0.1
		game.adventure._enemies(0.1)
		if str(skeleton.get_meta("idle_wander", {}).get("phase", "")) == "walk": failures.append("combat did not interrupt skeleton walk")
	print("CREATURE_IDLE_WANDER_SCENE_RESULT ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)
