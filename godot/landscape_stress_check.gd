extends SceneTree
## Graphical, save-isolated desktop proxy for a 100 m spell while the Hero and
## strategic cameras view one World3D. Headset stereo timing remains separate.

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview"):
		push_error("Landscape stress requires --world-builder-preview to isolate saves")
		quit(1)
		return
	call_deferred("_check")

func _check() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	game.adventure.travel("orchard_highlands")
	game._open_world_builder_view()
	var builder: Node = game.world_builder
	if builder == null or game.world_builder_view == null:
		push_error("Landscape stress needs the live dual-view scene")
		quit(1)
		return
	game.adventure.hp = 9999.0
	for i in 8:
		builder.data.aether = 20.0
		var angle := TAU * float(i) / 8.0
		var problem: String = builder.summon_patrol(Vector3(cos(angle) * 19.0,0,sin(angle) * 19.0))
		if not problem.is_empty(): push_error(problem); quit(1); return
		builder.tick(1.8)
	await create_timer(1.0).timeout
	var baseline: Dictionary = await _sample(120)
	builder.data.aether = 20.0
	var cast_start := Time.get_ticks_usec()
	var error: String = builder.cast_sunder(Vector3(-52,0,16),Vector3(52,0,16))
	if not error.is_empty(): push_error(error); quit(1); return
	var command_ms := float(Time.get_ticks_usec() - cast_start) / 1000.0
	var deform: Dictionary = await _sample(190)
	await physics_frame
	var state: Dictionary = {"adapter":RenderingServer.get_video_adapter_name(),
		"skeletons":24,"terrain_chunks":game.landscape.chunks.size(),
		"affected_operations":game.landscape.operation_count(),
		"command_ms":snappedf(command_ms,0.01),"target_ms":snappedf(game.landscape.last_operation_ms,0.01),
		"last_rebuild_ms":snappedf(game.landscape.last_rebuild_ms,0.01),
		"baseline":baseline,"during":deform,"second_view_fps":game.world_builder_view.refresh_limit,
		"second_view_scale":game.world_builder_view.render_scale,
		"draw_calls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)}
	var output := ProjectSettings.globalize_path("res://../outputs/landscape-tactical-sunder.png")
	var capture: Error = game.world_builder_view.tactical_viewport.get_texture().get_image().save_png(output)
	state["tactical_capture"] = output if capture == OK else "failed"
	print("LANDSCAPE_STRESS ", JSON.stringify(state))
	quit(0 if game.landscape.operation_count() == 1 and game.landscape.transition.is_empty() else 1)

func _sample(frames: int) -> Dictionary:
	var wall: Array[float] = []
	var cpu: Array[float] = []
	var fps: Array[int] = []
	var last := Time.get_ticks_usec()
	for i in frames:
		await process_frame
		var now := Time.get_ticks_usec()
		wall.append(float(now - last) / 1000.0)
		cpu.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
		fps.append(Engine.get_frames_per_second())
		last = now
	wall.sort()
	cpu.sort()
	fps.sort()
	return {"fps_min":fps[0],"fps_median":fps[fps.size()/2],
		"wall_p95_ms":snappedf(wall[int(wall.size()*0.95)],0.01),
		"wall_max_ms":snappedf(wall[-1],0.01),
		"cpu_p95_ms":snappedf(cpu[int(cpu.size()*0.95)],0.01)}
