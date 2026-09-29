extends SceneTree
## Same-world headless spell and mining check. Must use --world-builder-preview.

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview"):
		push_error("Spell check requires an offline preview world")
		quit(1)
		return
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var invalidated: Array[String] = preload("res://landscape_compiler.gd").invalidated(["height"])
	if not invalidated.has("hydrology") or not invalidated.has("water_mesh") or not invalidated.has("ecology") or not invalidated.has("collision"):
		failures.append("world dependency plan incomplete")
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	game.adventure.travel("orchard_highlands")
	var builder: Node = game.world_builder
	var land: Node = game.landscape
	if builder == null or land == null:
		print("LANDSCAPE_SPELL_RESULT failures=[missing shared world]")
		quit(1)
		return
	var visual_events: Array[Dictionary] = []
	land.visual_event.connect(func(payload: Dictionary) -> void: visual_events.append(payload))
	var wall_mid := Vector2(-45.0, 39.0)
	var prior: float = land.height_at(wall_mid)
	builder.data.aether = 20.0
	var error: String = builder.cast_wall(Vector3(-65, 0, 39), Vector3(-25, 0, 39))
	if error != "": failures.append("wall: " + error)
	else:
		land._finish_transition()
		if land.height_at(wall_mid) < prior + 3.0: failures.append("wall not real terrain")
		if preload("res://orchard_ground.gd").exposure_sample(wall_mid).b < 0.5: failures.append("raised earth did not expose heaped soil")
		if str(land.operations[-1].get("feature", "")) != "earthen_wall": failures.append("wall provenance lost")
	builder.data.aether = 20.0
	error = builder.cast_tree_ring(Vector3(62, 0, -58))
	if error != "": failures.append("ring: " + error)
	elif builder.data.forest_spells.is_empty() or builder.data.forest_spells[-1].placements.size() < 10: failures.append("ring is not recognisable or persistent")
	builder.data.aether = 20.0
	var impact_at := Vector2(71.0, 44.0)
	var impact_before: float = land.height_at(impact_at)
	error = builder.cast_meteor(Vector3(impact_at.x, 0, impact_at.y))
	if error != "": failures.append("meteor: " + error)
	else:
		var meteor = builder.meteor_nodes.values()[-1]
		game.rig.global_position = builder.center + Vector3(impact_at.x, impact_before + 0.1, impact_at.y)
		game.shield_until = 0.0
		game.hurts_until = 0.0
		var health_before: float = game.adventure.hp
		meteor.advance(1.3)
		if game.adventure.hp >= health_before: failures.append("meteor did not hurt the nearby Hero")
		game.rig.global_position = builder.center + Vector3(5.0, land.height_at(Vector2(5.0, 5.0)) + 0.1, 5.0)
		if str(builder.data.meteors[-1].phase) != "landed": failures.append("meteor did not land")
		if land.operation_count() < 2 or str(land.operations[-1].type) != "crater": failures.append("meteor has no terrain crater")
		land._finish_transition()
		if land.height_at(impact_at) > impact_before - 2.0: failures.append("crater depth missing")
		if preload("res://orchard_ground.gd").exposure_sample(impact_at).g < 0.4: failures.append("crater did not expose cut ground")
		for i in 2:
			if not builder.mine_meteor(meteor.collider, meteor.gems[0].global_position, "quarry_pick", 3.0): failures.append("pick missed gem")
		if int(builder.data.star_gems) != 2: failures.append("mined gem ledger")
		var rock_top: Vector3 = meteor.global_position + Vector3.UP * 2.55
		for i in 2:
			if not builder.mine_meteor(meteor.collider, rock_top, "quarry_pick", 2.0): failures.append("pick missed star iron")
		if int(builder.data.star_iron) != 2: failures.append("mined iron ledger")
		builder.data.aether = 20.0
		var fault_at := Vector2(35.0, 48.0)
		var fault_before: float = land.height_at(fault_at)
		error = builder.cast_prism_fault(Vector3(20,0,48), Vector3(50,0,48))
		if error != "": failures.append("fault: " + error)
		else:
			land._finish_transition()
			if land.height_at(fault_at) < fault_before + 2.0: failures.append("fault not real terrain")
			if int(builder.data.star_gems) != 0: failures.append("fault did not spend gems")
		var prior_iron := int(builder.data.star_iron)
		builder.data.aether = 0.0
		error = builder.cast_wall(Vector3(-60,0,60), Vector3(-30,0,60))
		if error != "" or int(builder.data.star_iron) != prior_iron - 2: failures.append("iron-paid wall: " + error)
		land._finish_transition()
	if not builder._valid(builder.data): failures.append("settlement save invalid")
	var starts := 0
	var settles := 0
	for event in visual_events:
		if str(event.get("phase", "")) == "started" and str(event.get("operation_id", "")).begins_with("op-"): starts += 1
		if str(event.get("phase", "")) == "settled": settles += 1
	if starts < 4 or settles < 4: failures.append("visual event stream missing stable start/settle lifecycle (%d starts, %d settled)" % [starts, settles])
	var serialized_settlement: Variant = JSON.parse_string(JSON.stringify(builder.data))
	if not builder._valid(serialized_settlement): failures.append("settlement JSON round trip invalid")
	if not land.document.is_empty() and not preload("res://landscape_world_document.gd").validate(land.document).ok: failures.append("world command document invalid")
	var deadline := Time.get_ticks_msec() + 1000
	while not land.pending_hydrology.is_empty() and Time.get_ticks_msec() < deadline:
		await create_timer(0.02).timeout
	if not land.pending_hydrology.is_empty(): failures.append("hydrology worker did not settle")
	if land.last_compile_stages.is_empty(): failures.append("derived fields did not refresh")
	print("LANDSCAPE_SPELL_RESULT failures=", failures, " ops=", land.operation_count(), " hydro_ms=", land.last_hydrology_ms)
	quit(0 if failures.is_empty() else 1)
