extends SceneTree
## Isolated shared-world weather/material checks. Never touches the player's save.
var failures: Array[String] = []

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--atmosphere-test"):
		push_error("ATMOSPHERE test requires --atmosphere-test to isolate player saves")
		quit(1)
		return
	call_deferred("_run")

func check(ok: bool, message: String) -> void:
	if not ok: failures.append(message)

func _run() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	game.set_process(false)
	game.adventure.travel("orchard_highlands")
	game.weather = load("res://weather_runtime.gd").new()
	game.add_child(game.weather)
	game.weather.setup(game)
	for i in range(300):
		await process_frame
		if game.weather.zone == "orchard_highlands" and not game.weather.rebuilding and game.weather.coverage_ready: break
	check(game.weather.coverage_ready, "Orchard weather scan completed")
	check(game.weather.zone == "orchard_highlands", "Orchard participates in native weather")
	var woodland: Array = game.scene.zones.orchard_highlands.root.find_children("Woodland_fern_sword*", "MultiMeshInstance3D", true, false)
	check(not woodland.is_empty(), "Authored undergrowth is present as batched instances")
	var wet_material: ShaderMaterial = load("res://orchard_ground.gd").material()
	check(wet_material != null, "Orchard layered material exists")
	var day_hour := 16.0
	game.weather.engine.hour = day_hour
	game.weather.engine.set_weather("clear")
	game.weather.tick(.1)
	var clear_fog: float = game.weather.env.fog_density
	check(game.weather.sun.directional_shadow_max_distance <= [28.0, 44.0, 56.0][game.orchard_atmosphere.quality], "Shadow range follows the selected quality budget")
	check(game.weather.env.fog_height_density > 0.0, "Near-ground atmospheric depth enabled")
	game.weather.engine.set_weather("rain")
	for i in range(15): game.weather.tick(.1)
	var rain_fog: float = game.weather.env.fog_density
	check(game.weather.engine.wind_strength > 1.0, "Rain and foliage use the same stronger wind")
	check(game.weather.engine.wet[0] > 0.0, "Rain accumulates surface wetness")
	check(float(wet_material.get_shader_parameter("rain_wetness")) > 0.0, "Ground physically darkens and smooths when wet")
	check(game.weather.env.fog_density > clear_fog, "Rain thickens distance fog")
	check(game.weather.engine.rain.multimesh.visible_instance_count <= game.weather.engine.rain_budget, "Rain has a hard particle budget")
	check(float(game.orchard_atmosphere.water_material().get_shader_parameter("rain")) > 0.0, "Rain reaches the brook surface")
	game.weather.engine.hour = 0.0
	game.weather.engine.set_weather("clear")
	game.weather.tick(.1)
	check(game.weather.engine.stars.visible, "Night stars remain available")
	check(game.weather.engine.stars.global_position.distance_to(game.camera.global_position) < 0.01, "Night stars follow the Orchard Hero")
	var builder: Node = game.world_builder
	var carved := false
	for holder in woodland:
		for i in range(holder.multimesh.instance_count):
			var positions: PackedVector3Array = holder.get_meta("dressing_positions")
			var point: Vector3 = positions[i]
			if absf(point.x) > 130.0 or absf(point.z) > 130.0: continue
			builder.data.mana = 20.0
			var result: String = builder.carve_path(point - Vector3(2.0, 0, 0), point + Vector3(2.0, 0, 0))
			check(result == "", "World-builder can carve through the woodland kit")
			var hidden: PackedByteArray = holder.get_meta("dressing_hidden")
			check(hidden[i] == 1, "Carved route removes undergrowth immediately")
			check(float(load("res://orchard_ground.gd").sample(Vector2(point.x, point.z)).r) > 0.50, "Carved route changes the shared ground mask")
			carved = true
			break
		if carved: break
	check(carved, "Found a woodland test placement away from the boundary")
	print("ATMOSPHERE_RESULT ", JSON.stringify({"failures": failures, "wetness": game.weather.engine.wet[0], "fog_clear": clear_fog, "fog_rain": rain_fog, "rain_budget": game.weather.engine.rain_budget}))
	quit(0 if failures.is_empty() else 1)
