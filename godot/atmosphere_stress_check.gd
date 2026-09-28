extends SceneTree
## Save-isolated graphical stress: playable Orchard, 24 skeletons, clear then rain.

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--atmosphere-test"):
		push_error("ATMOSPHERE stress requires --atmosphere-test to isolate player saves")
		quit(1)
		return
	call_deferred("_check")

func _sample(seconds: float) -> Dictionary:
	var values: Array[int] = []
	var draw: Array[int] = []
	var process_ms: Array[float] = []
	var count := roundi(seconds * 5.0)
	for i in range(count):
		await create_timer(0.2).timeout
		values.append(Engine.get_frames_per_second())
		draw.append(roundi(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)))
		process_ms.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
	values.sort()
	draw.sort()
	process_ms.sort()
	var total := 0
	for frame in values: total += frame
	return {"fps_min":values[0], "fps_median":values[values.size() / 2], "fps_mean":float(total) / values.size(),
		"draws_median":draw[draw.size() / 2], "process_ms_median":process_ms[process_ms.size() / 2]}

func _check() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	game.adventure.travel("orchard_highlands")
	game.adventure.hp = 9999.0
	game.rig.global_position = game.world_builder.center + Vector3(35, 0, -42)
	var second_view := OS.get_cmdline_user_args().has("--atmosphere-second-view")
	if second_view: game.call("_open_world_builder_view")
	game.weather = load("res://weather_runtime.gd").new()
	game.add_child(game.weather)
	game.weather.setup(game)
	for i in range(300):
		await process_frame
		if game.weather.coverage_ready and not game.weather.rebuilding: break
	if not game.weather.coverage_ready:
		push_error("ATMOSPHERE_STRESS weather scan timeout")
		quit(1)
		return
	var builder: Node = game.world_builder
	for i in range(8):
		builder.data.aether = 20.0
		var angle := TAU * float(i) / 8.0
		var at := Vector3(cos(angle) * 18.0, 0, sin(angle) * 18.0)
		var problem: String = builder.summon_patrol(at)
		if problem != "":
			push_error("ATMOSPHERE_STRESS summon failed: " + problem)
			quit(1)
			return
		builder.tick(1.8)
	game.weather.engine.cycle = false
	game.weather.engine.automatic = false
	game.weather.engine.hour = 16.0
	game.weather.engine.set_weather("clear")
	await create_timer(1.4).timeout
	var clear: Dictionary = await _sample(3.0)
	game.weather.engine.set_weather("rain")
	await create_timer(1.4).timeout
	var rain: Dictionary = await _sample(3.0)
	var live_count := 0
	for units in builder.summoned_nodes.values(): live_count += units.size()
	print("ATMOSPHERE_STRESS ", JSON.stringify({"skeletons":live_count, "clear":clear, "rain":rain,
		"rain_visible":game.weather.engine.rain.multimesh.visible_instance_count,
		"quality":game.orchard_atmosphere.quality, "second_view":second_view}))
	quit(0 if live_count == 24 else 1)
