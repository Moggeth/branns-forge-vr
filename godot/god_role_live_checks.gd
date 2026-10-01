extends SceneTree
## Actual Main and RTS input, with diagnostic save isolation. Run with:
## --headless --xr-mode off --audio-driver Dummy --path godot \
## --script res://god_role_live_checks.gd --quit-after 1500 -- --orchard-planet-preview

class ProbeView extends "res://world_builder_view.gd":
	var cursor := Vector3.INF
	func _world_at(_screen: Vector2) -> Vector3:
		return cursor
	func _load_layout() -> void:
		pass
	func _save_layout() -> void:
		pass

var failures: Array[String] = []
var checks := 0
var started := Time.get_ticks_usec()
var capture_path := ""

func _initialize() -> void:
	create_timer(90.0).timeout.connect(func() -> void:
		printerr("GOD_ROLE_LIVE_RESULT timeout=90")
		quit(2))
	call_deferred("_run")

func _expect(ok: bool, label: String) -> void:
	checks += 1
	if not ok: failures.append(label)

func _key(code: Key, pressed := true) -> InputEventKey:
	var event := InputEventKey.new()
	event.keycode = code
	event.physical_keycode = code
	event.pressed = pressed
	return event

func _mouse(pressed: bool) -> InputEventMouseButton:
	var event := InputEventMouseButton.new()
	event.button_index = MOUSE_BUTTON_LEFT
	event.pressed = pressed
	event.position = Vector2(700, 300)
	return event

func _move() -> InputEventMouseMotion:
	var event := InputEventMouseMotion.new()
	event.position = Vector2(700, 300)
	return event

func _run() -> void:
	if not OS.get_cmdline_user_args().has("--orchard-planet-preview"):
		printerr("GOD_ROLE_LIVE_RESULT requires --orchard-planet-preview")
		quit(2)
		return
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--god-role-capture="):
			capture_path = argument.trim_prefix("--god-role-capture=")
	root.unfocusable = true
	root.position = Vector2i(-12000, -12000)
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	_expect(game.diagnostic_offline and game.world_builder.test_mode, "Main is not save-isolated")
	game.world_builder.data = game.world_builder.fresh_state()
	game.world_builder.data.mana = 20.0
	await game.adventure.travel("orchard_highlands")
	var view := ProbeView.new()
	view.visible = false
	game.add_child(view)
	game.world_builder_view = view
	view.setup(game, game.world_builder)
	view._advance_arrival(view.ARRIVAL_SECONDS)
	view._set_focus(false, false)
	var role = game.god_role
	_expect(role != null and game.god_workers != null, "God-role modules absent from Main")
	_expect(view.command_panel._by_palette["encounters"][3] == "rat_swarm", "F4/4 is not Rat Stream")
	_expect(view.command_panel._by_palette["life"].has("hire"), "Lumberjack card absent")
	_expect(view.command_panel.size.x <= view.pane_layout.rts.size.x and view.command_panel.size.y <= view.pane_layout.rts.size.y, "Resource footer/panel leaves RTS pane")
	var target := Vector3(30, 0, -65)
	view.cursor = target
	view._route_input(_key(KEY_F4))
	_expect(view.palette == "encounters", "F4 did not select encounters palette")
	var mana_before: float = game.world_builder.data.mana
	view._route_input(_key(KEY_4))
	_expect(role.stream_active and role.rats.size() == 1 and view.quick_cast_action == "rat_swarm", "F4/4 press did not spawn first real rat")
	for i in 36: role.tick(1.0 / 60.0)
	_expect(role.rats.size() >= 4 and role.rats.size() <= 5 and float(game.world_builder.data.mana) < mana_before, "Held key did not stream six rats/s with Mana cost")
	view._route_input(_key(KEY_4, false))
	var stopped: int = role.rats.size()
	role.tick(0.25)
	_expect(not role.stream_active and role.rats.size() == stopped, "Key release did not stop Rat Stream")
	view.select_action("rat_swarm")
	view._route_input(_mouse(true))
	_expect(role.stream_active and view.rat_stream_mouse, "Mouse hold did not start Rat Stream")
	view._route_input(_mouse(false))
	_expect(not role.stream_active and not view.rat_stream_mouse, "Mouse release did not stop Rat Stream")
	for i in 2:
		if i < role.rats.size(): role.on_enemy_defeated(role.rats[i])
	_expect(role.motes.size() >= 2, "Real rat deaths did not create visible Essence")
	view._route_input(_move())
	_expect(role.essence() >= 2 and role.motes.is_empty(), "RTS mouse sweep did not collect Essence")
	var site := Vector3.INF
	for candidate in [Vector3(30, 0, -65), Vector3(15, 0, -55), Vector3(-22, 0, -60), Vector3(39, 0, 20)]:
		var at: Vector3 = game.world_builder.center + candidate
		if game.world_builder.encounter_target_error("patrol", at, "orchard_highlands") == "":
			site = candidate
			break
	_expect(site != Vector3.INF, "No clear actual Orchard Skeleton Squad site")
	if site != Vector3.INF:
		view.cursor = site
		view.select_action("patrol")
		var squad_mana: float = game.world_builder.data.mana
		var squad_essence: int = role.essence()
		var threats_before: int = game.world_builder.data.threats.size()
		view._route_input(_mouse(true))
		view._route_input(_mouse(false))
		_expect(game.world_builder.data.threats.size() == threats_before + 1 and role.essence() == squad_essence - 2 and is_equal_approx(float(game.world_builder.data.mana), squad_mana - 4.0), "RTS Skeleton Squad did not spend 4 Mana and 2 Essence exactly once")
		_expect(float(game.world_builder.data.spell_cooldowns.get("patrol", 0.0)) > 11.9, "RTS Skeleton Squad cooldown missing")
	game.world_builder.data.mana = 20.0
	var timber: Node3D
	var nearest := INF
	for tree in game.world_builder.resource_by_key.values():
		if not is_instance_valid(tree) or not tree.visible: continue
		var distance: float = tree.global_position.distance_to(game.world_builder.center + game.world_builder.CAMP)
		if distance < nearest:
			nearest = distance
			timber = tree
	_expect(timber != null, "No standing Orchard tree for live worker")
	if timber != null:
		view.cursor = timber.global_position - game.world_builder.center
		view.select_action("hire")
		var workers_before: int = game.world_builder.data.workers
		var wood_before: int = game.world_builder.data.wood
		view._route_input(_mouse(true))
		view._route_input(_mouse(false))
		_expect(int(game.world_builder.data.workers) == workers_before + 1 and int(game.world_builder.data.wood) == wood_before and is_equal_approx(float(game.world_builder.data.mana), 17.0), "RTS lumberjack did not spend 3 Mana without Lumber charge")
		_expect(not game.world_builder.data.marked.is_empty(), "Summoned lumberjack did not receive nearby tree jobs")
		for i in 720:
			if int(game.world_builder.data.wood) > wood_before: break
			game.world_builder.tick(0.25)
		_expect(int(game.world_builder.data.wood) > wood_before, "Lumberjack did not harvest and deliver wood")
	await game.adventure.travel("orchard_planet")
	await physics_frame
	view._change_region("orchard_planet")
	view._advance_arrival(view.ARRIVAL_SECONDS)
	view._position_camera()
	_expect(view.current_zone == "orchard_planet" and game.orchard_planet.built, "RTS did not follow travel to built planet")
	var planet = game.orchard_planet
	_expect(view.camera.global_position.distance_to(planet.center) < planet.radius + 200.0, "RTS camera remained over the flat Orchard after planet travel")
	var planet_tree: Node3D
	var closest := INF
	for candidate in planet.gameplay.placed:
		if not is_instance_valid(candidate) or not candidate.visible: continue
		if not candidate.get_meta("planet_tree", false) or candidate.get_meta("requires", "") != "axe": continue
		var direction: Vector3 = (candidate.global_position - planet.center).normalized()
		if planet.fields.sample(direction).get("water", false): continue
		var distance: float = candidate.global_position.distance_to(game.rig.global_position)
		if distance < closest:
			closest = distance
			planet_tree = candidate
	_expect(planet_tree != null, "No harvestable dry tree on the planet")
	if planet_tree != null:
		var planet_at: Vector3 = planet_tree.global_position
		view.cursor = planet_at - planet.center
		game.world_builder.data.mana = 20.0
		view._route_input(_key(KEY_F4))
		var planet_rat_before: int = role.rats.size()
		view._route_input(_key(KEY_4))
		_expect(role.stream_active and role.rats.size() == planet_rat_before + 1 and str(role.rats[-1].get_meta("zone", "")) == "orchard_planet", "Planet F4/4 did not spawn a radial shared-world rat")
		for i in 24: role.tick(1.0 / 60.0)
		view._route_input(_key(KEY_4, false))
		_expect(not role.stream_active and role.rats.size() >= planet_rat_before + 3, "Planet key release or held stream failed")
		var planet_motes_before: int = role.motes.size()
		for i in 2: role.on_enemy_defeated(role.rats[-1])
		_expect(role.motes.size() == planet_motes_before + 2, "Planet rat deaths did not leave surface Essence")
		view._route_input(_move())
		_expect(role.essence() >= 2, "Planet RTS mouse did not collect surface Essence")
		if not capture_path.is_empty():
			view.select_action("rat_swarm")
			view._refresh_ui()
			view.tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
			for frame in 5:
				view.tick(1.0 / 60.0)
				await process_frame
			await RenderingServer.frame_post_draw
			var picture: Image = view.get_texture().get_image()
			_expect(DisplayServer.get_name() != "headless" and not picture.is_empty() and picture.save_png(capture_path) == OK, "Native God-role capture failed")
		view.select_action("patrol")
		game.world_builder.data.spell_cooldowns.erase("patrol")
		var planet_squad_mana: float = game.world_builder.data.mana
		var planet_squad_essence: int = role.essence()
		var planet_actors_before: int = planet.gameplay.actors.size()
		view._route_input(_mouse(true))
		view._route_input(_mouse(false))
		_expect(planet.gameplay.actors.size() == planet_actors_before + 3 and role.essence() == planet_squad_essence - 2 and is_equal_approx(float(game.world_builder.data.mana), planet_squad_mana - 4.0), "Planet RTS Skeleton Squad did not spawn three actors and spend both currencies")
		var planet_wood_before: int = game.world_builder.data.wood
		game.world_builder.data.mana = 20.0
		view.select_action("hire")
		view._route_input(_mouse(true))
		view._route_input(_mouse(false))
		_expect(game.god_workers.active_workers() >= 1 and is_equal_approx(float(game.world_builder.data.mana), 17.0) and int(game.world_builder.data.wood) == planet_wood_before, "Planet RTS lumberjack did not charge 3 Mana without Lumber")
		for i in 480:
			if int(game.world_builder.data.wood) > planet_wood_before: break
			game.god_workers.tick(0.25)
			await process_frame
		_expect(int(game.world_builder.data.wood) > planet_wood_before, "Planet lumberjack did not deliver wood")
	view._refresh_ui()
	var panel = view.command_panel
	_expect(int(panel._state.get("essence", -1)) == role.essence() and int(panel._state.get("wood", -1)) == int(game.world_builder.data.wood), "RTS resource footer has stale Essence or Lumber")
	if not panel._stacked:
		var label_width: float = (panel._info.size.x - 2.0 * (11.0 if panel._compact else 15.0) * panel._s) / 3.0 - panel._font.get_height(panel._fs(12.0)) * 0.9 - 8.0 * panel._s
		for label in ["Essence 200", "Lumber 200", "Helpers 13"]:
			_expect(not panel._fit(label, label_width, panel._fs(12.0), 1, panel._fs(12.0) - 1).truncated, "RTS resource footer clips " + label)
	view._cancel_quick_cast()
	view.queue_free()
	var report := {"checks": checks, "failures": failures, "seconds": (Time.get_ticks_usec() - started) / 1000000.0, "rats": role.rats.size(), "essence": role.essence(), "wood": game.world_builder.data.wood}
	game.queue_free()
	await process_frame
	await process_frame
	print("GOD_ROLE_LIVE_RESULT ", JSON.stringify(report))
	quit(0 if failures.is_empty() else 1)
