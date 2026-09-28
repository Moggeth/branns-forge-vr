extends SceneTree
## Graphical, save-isolated daylight/rain/night capture of the actual Orchard world.

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--atmosphere-test"):
		push_error("ATMOSPHERE capture requires --atmosphere-test to isolate player saves")
		quit(1)
		return
	call_deferred("_capture")

func _capture() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	game.adventure.travel("orchard_highlands")
	game.weather = load("res://weather_runtime.gd").new()
	game.add_child(game.weather)
	game.weather.setup(game)
	var builder: Node = game.world_builder
	var view := SubViewport.new()
	view.size = Vector2i(1600, 900)
	view.world_3d = game.get_world_3d()
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(view)
	var eye := Camera3D.new()
	view.add_child(eye)
	eye.fov = 76.0
	var shaft_ground: Vector3 = game.orchard_atmosphere.beams[0].global_position - Vector3.UP * 6.0
	var positions := [
		{"name":"orchard-camp-day", "at":builder.center + builder.CAMP + Vector3(9, 1.7, 6), "toward":builder.center + builder.CAMP + Vector3(0, 1.0, 0), "hour":16.0, "mode":"clear"},
		{"name":"orchard-sunbeams", "at":shaft_ground + Vector3(4, 1.7, 5), "toward":shaft_ground + Vector3(0, 2.0, 0), "hour":17.0, "mode":"clear"},
		{"name":"orchard-brook-rain", "at":builder.center + Vector3(25, 1.8, -38), "toward":builder.center + builder.CROSSING + Vector3(0, 1.1, 0), "hour":15.0, "mode":"rain"},
		{"name":"orchard-camp-night", "at":builder.center + builder.CAMP + Vector3(9, 1.7, 6), "toward":builder.center + builder.CAMP + Vector3(0, 1.0, 0), "hour":0.0, "mode":"clear"},
	]
	var results: Dictionary = {}
	for frame in range(300):
		await process_frame
		if game.weather.coverage_ready and not game.weather.rebuilding: break
	if not game.weather.coverage_ready:
		push_error("ATMOSPHERE_VISUAL weather coverage never finished")
		quit(1)
		return
	game.weather.engine.cycle = false
	game.weather.engine.automatic = false
	for shot in positions:
		eye.global_position = shot.at
		eye.look_at(shot.toward, Vector3.UP)
		eye.current = true
		game.rig.global_position = shot.at - Vector3.UP * 1.7
		game.weather.engine.hour = shot.hour
		game.weather.engine.set_weather(shot.mode)
		if shot.mode == "rain":
			for i in range(40): game.weather.tick(0.1)
		else: game.weather.tick(0.1)
		await create_timer(0.65).timeout
		await RenderingServer.frame_post_draw
		var path: String = "res://../outputs/" + str(shot.name) + ".png"
		var result := view.get_texture().get_image().save_png(path)
		results[shot.name] = {"result":result, "fps":Engine.get_frames_per_second(), "fog":game.weather.env.fog_density}
	var fern_holders: Array = game.scene.zones.orchard_highlands.root.find_children("Woodland_fern_sword*", "MultiMeshInstance3D", true, false)
	var cleared := false
	for holder in fern_holders:
		var locations: PackedVector3Array = holder.get_meta("dressing_positions")
		for i in range(locations.size()):
			var point: Vector3 = locations[i]
			if absf(point.x) > 130.0 or absf(point.z) > 130.0: continue
			builder.data.aether = 20.0
			var problem: String = builder.carve_path(point - Vector3(2, 0, 0), point + Vector3(2, 0, 0))
			var actual: Transform3D = holder.multimesh.get_instance_transform(i)
			cleared = problem.is_empty() and actual.origin.y < -100.0
			break
		if cleared: break
	results["path_clear_gpu"] = cleared
	print("ATMOSPHERE_VISUAL ", JSON.stringify(results))
	quit(0 if results.size() == positions.size() + 1 and cleared else 1)
