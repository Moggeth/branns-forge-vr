extends SceneTree
## Offline full-scene check. No live service writes and no player save is read.

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var builder: Node = game.world_builder
	if builder == null or game.adventure.zone != "orchard_highlands": failures.append("builder world/arrival missing")
	else:
		var view: Window = load("res://world_builder_view.gd").new()
		view.visible = false
		game.add_child(view)
		view.setup(game, builder)
		if view.tactical_viewport.world_3d != game.get_world_3d(): failures.append("survey is not the Hero's live World3D")
		if view.camera.get_viewport() != view.tactical_viewport: failures.append("survey camera detached")
		if builder.worker_nodes.is_empty(): failures.append("no live helper in the shared world")
		else:
			var animator: AnimationPlayer = builder.worker_nodes[0].get_meta("animator", null)
			if animator == null or not animator.has_animation("Worker_Idle") or not animator.has_animation("Worker_Walk") or not animator.has_animation("Worker_Chop"):
				failures.append("Opus helper clips not imported: " + str(animator.get_animation_list() if animator != null else []))
			else:
				var helper: Node3D = builder.worker_nodes[0]
				for clip in ["Worker_Idle", "Worker_Walk", "Worker_Chop"]:
					if animator.get_animation(clip).loop_mode != Animation.LOOP_LINEAR: failures.append(clip + " does not loop")
				var initial_position: Vector3 = helper.position
				builder._for_each_worker(0.1)
				var moved: float = Vector2(initial_position.x, initial_position.z).distance_to(Vector2(helper.position.x, helper.position.z))
				if moved <= 0.001: failures.append("idle helper did not start walking home")
				elif str(helper.get_meta("clip", "")) != "Worker_Walk" or absf(animator.speed_scale - moved / 0.1 / builder.WORKER_WALK_SPEED) > 0.02:
					failures.append("walk cadence does not match ground movement")
				builder._worker_travel(helper, helper.position, 0.1, 1.4, 0.55)
				if str(helper.get_meta("clip", "")) != "Worker_Idle" or absf(animator.speed_scale - 1.0) > 0.01: failures.append("stopped helper did not return to normal idle")
				builder._set_worker_animation(helper, "Worker_Chop")
				if str(helper.get_meta("clip", "")) != "Worker_Chop": failures.append("worker did not enter work animation")
		if builder.root.find_children("*", "MeshInstance3D", true, false).is_empty(): failures.append("authored work site absent")
		if not builder._valid(builder.data): failures.append("fresh state invalid")
		var before_mana: float = builder.data.mana
		var path_error: String = builder.carve_path(Vector3(0, 0, -25), Vector3(18, 0, -45))
		if path_error != "" or builder.data.paths.size() != 1 or float(builder.data.mana) >= before_mana: failures.append("path did not spend mana and change live land: " + path_error)
		if builder.root.find_children("RouteWaymarker", "Node3D", true, false).is_empty(): failures.append("authored route marker absent from live world")
		var timber: Node3D
		for candidate in game.scene.resources:
			if str(candidate.get_meta("zone", "")) == builder.ZONE and str(candidate.get_meta("resource_id", "")) == "lumber": timber = candidate; break
		if timber == null: failures.append("no timber to commission")
		else:
			var mark_error: String = builder.mark_harvest(timber.global_position - builder.center)
			if mark_error != "" or builder.data.marked.size() != 1: failures.append("harvest order missing: " + mark_error)
			else:
				builder.worker_nodes[0].position = timber.global_position - builder.center + Vector3(1, 0, 0)
				for i in range(40): builder._for_each_worker(0.1)
				if timber.visible or builder.data.carried.is_empty() or not builder.data.marked.is_empty(): failures.append("helper did not fell tree and carry timber")
				builder.worker_nodes[0].position = builder.CAMP + Vector3(0, 0, 1.4)
				builder._for_each_worker(0.1)
				if int(builder.data.wood) < 2 or not builder.data.carried.is_empty(): failures.append("helper did not return timber to the settlement")
				builder.data.wood = 3
				var bridge_error: String = builder.place_bridge(builder.CROSSING)
				if bridge_error != "" or builder.data.bridges.size() != 1 or int(builder.data.wood) != 0: failures.append("bridge did not consume timber: " + bridge_error)
				var bridge: Node = builder.root.get_node_or_null("BuiltOrchardBridge")
				if bridge == null or bridge.find_children("*", "MeshInstance3D", true, false).is_empty(): failures.append("bridge absent from shared world")
				if bridge == null or bridge.find_children("*", "CollisionShape3D", true, false).is_empty(): failures.append("walkable bridge collider absent")
				if bridge != null:
					var has_walkway := false
					for collision in bridge.find_children("*", "CollisionShape3D", true, false):
						var kind: String = str(collision.get_parent().get_meta("kind", ""))
						if kind == "floor": has_walkway = true
						if kind not in ["floor", "solid"]: failures.append("bridge collider lacks floor/solid gameplay tag")
					if not has_walkway: failures.append("bridge deck is not navigable")
					await physics_frame
					var deck_point: Vector3 = bridge.global_position
					var deck_ray := PhysicsRayQueryParameters3D.create(deck_point + Vector3.UP * 2.0, deck_point + Vector3.DOWN * 2.0, 1)
					var deck_hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(deck_ray)
					if deck_hit.is_empty() or str(deck_hit.collider.get_meta("kind", "")) != "floor": failures.append("Hero's downward ray misses the bridge deck")
		var grove_error: String = builder.plant_grove(Vector3(55, 0, -63))
		if grove_error != "" or builder.data.groves.size() != 1: failures.append("new grove absent: " + grove_error)
		if builder.growing_trees.size() != 3: failures.append("live grove did not begin visibly growing")
		else:
			builder.tick(2.5)
			if not builder.growing_trees.is_empty(): failures.append("grove growth did not settle")
		if builder.scenic_by_key.size() < 300: failures.append("the authored forest is not addressable as harvestable trees")
		else:
			var scenic_key := ""
			for key in builder.scenic_by_key:
				if builder._inside(builder.scenic_by_key[key].position):
					scenic_key = str(key)
					break
			if scenic_key.is_empty(): failures.append("no reachable authored timber inside the orchard")
			else:
				var scenic_point: Vector3 = builder.scenic_by_key[scenic_key].position
				var scenic_error: String = builder.mark_harvest(scenic_point)
				if scenic_error != "" or scenic_key not in builder.data.marked: failures.append("lumberjack cannot be assigned to the authored forest: " + scenic_error)
				else:
					builder.worker_nodes[0].position = scenic_point + Vector3(1, 0, 0)
					for i in range(40): builder._for_each_worker(0.1)
					await physics_frame
					if scenic_key not in builder.data.harvested or not builder.scenic_by_key[scenic_key].collision.disabled:
						failures.append("authored tree did not fall in the live scene")
			var hero_tree_key := ""
			for key in builder.scenic_by_key:
				if key not in builder.data.harvested and not builder.scenic_by_key[key].collision.disabled and builder._inside(builder.scenic_by_key[key].position):
					hero_tree_key = key
					break
			if hero_tree_key == "": failures.append("no forest tree available for Hero axe")
			else:
				var before_wood: int = int(builder.data.wood)
				var axe := Node3D.new()
				axe.set_meta("id", "woodland_axe")
				game.add_child(axe)
				var trunk: StaticBody3D = builder.scenic_by_key[hero_tree_key].collision.get_parent()
				var proxy: CollisionShape3D = builder.scenic_by_key[hero_tree_key].collision
				var hit: Vector3 = proxy.global_position + Vector3.DOWN * (proxy.shape.height * 0.5 - 1.0)
				for i in range(3): game.melee.strike(trunk, hit, Vector3.LEFT, 2.4, game.desktop_hand, axe)
				if hero_tree_key in builder.data.harvested or int(builder.data.wood) != before_wood: failures.append("Hero axe awarded scenic lumber before log pickup")
				var revealed: Node3D = builder.scenic_pending.get(hero_tree_key, null)
				if not is_instance_valid(revealed) or not revealed.get_meta("felled", false): failures.append("Hero axe did not fell the revealed forest tree")
				elif not builder.claim_scenic_log(revealed) or hero_tree_key not in builder.data.harvested or int(builder.data.wood) != before_wood + 1:
					failures.append("intentional scenic log claim did not change the shared forest ledger")
		var patrol_error: String = builder.summon_patrol(Vector3(75, 0, -60))
		if patrol_error != "" or builder.data.threats.size() != 1: failures.append("encounter order missing: " + patrol_error)
		else:
			builder.tick(2.0)
			var threat_id := str(int(builder.data.threats[0].id))
			var units: Array = builder.summoned_nodes.get(threat_id, [])
			if units.size() != 3: failures.append("patrol not physically spawned in Hero's live world")
			for unit in units: unit.node.set_meta("alive", false)
			builder.tick(0.1)
			if not builder.data.threats.is_empty(): failures.append("defeated patrol still exists in strategic state")
		var snapshot: Variant = JSON.parse_string(JSON.stringify(builder.data))
		if not builder._valid(snapshot): failures.append("world edits do not validate for persistent reload")
		var original: Variant = JSON.parse_string(JSON.stringify(builder.data))
		builder.save_path = "user://world_builder_verification_%d.json" % Time.get_ticks_msec()
		builder.test_mode = false
		if not builder.save(): failures.append("persistent save failed")
		builder.data = builder.fresh_state()
		builder._load()
		if builder.data != original: failures.append("persistent world state failed round-trip")
		DirAccess.remove_absolute(ProjectSettings.globalize_path(builder.save_path))
		builder.test_mode = true
		view._quality(2)
		view._sync_hero_resolution()
		var expected_half := Vector2i(view.pane_layout.rts.size * 0.5).max(Vector2i(64, 64))
		if view.tactical_viewport.size != expected_half: failures.append("builder quality setting is ignored")
		view._quality(0)
		view._sync_hero_resolution()
		var expected_full := Vector2i(view.pane_layout.rts.size).max(Vector2i(64, 64))
		if view.tactical_viewport.size != expected_full: failures.append("builder full quality does not match its pane")
		view.close()
		await process_frame
		if is_instance_valid(view): failures.append("builder window did not close cleanly")
	print("WORLD_BUILDER_RESULT ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)
