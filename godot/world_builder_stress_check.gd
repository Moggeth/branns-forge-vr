extends SceneTree
## Desktop-only rehearsal of 24 authored skeletons plus the tactical viewport.
## It never loads or changes the player's settlement save.

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	var builder: Node = game.world_builder
	game.adventure.hp = 9999.0
	for i in range(8):
		builder.data.aether = 20.0
		var angle := TAU * float(i) / 8.0
		var point := Vector3(cos(angle) * 18.0, 0, sin(angle) * 18.0)
		var problem: String = builder.summon_patrol(point)
		if problem != "": push_error("WORLD_BUILDER_STRESS summon failed: " + problem); quit(1); return
		builder.tick(1.8)
	var live_count := 0
	for units in builder.summoned_nodes.values(): live_count += units.size()
	var main_viewport: RID = game.get_viewport().get_viewport_rid()
	var tactical_viewport: RID = game.world_builder_view.tactical_viewport.get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(main_viewport, true)
	RenderingServer.viewport_set_measure_render_time(tactical_viewport, true)
	await create_timer(2.0).timeout
	var samples: Array[int] = []
	var cpu_ms: Array[float] = []
	var main_draws: Array[int] = []
	var tactical_draws: Array[int] = []
	var main_gpu_ms: Array[float] = []
	var tactical_gpu_ms: Array[float] = []
	for i in range(16):
		await create_timer(0.25).timeout
		await RenderingServer.frame_post_draw
		samples.append(Engine.get_frames_per_second())
		cpu_ms.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
		main_draws.append(RenderingServer.viewport_get_render_info(main_viewport, RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE, RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME))
		tactical_draws.append(RenderingServer.viewport_get_render_info(tactical_viewport, RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE, RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME))
		var main_gpu := RenderingServer.viewport_get_measured_render_time_gpu(main_viewport)
		var tactical_gpu := RenderingServer.viewport_get_measured_render_time_gpu(tactical_viewport)
		if main_gpu > 0.0: main_gpu_ms.append(main_gpu)
		if tactical_gpu > 0.0: tactical_gpu_ms.append(tactical_gpu)
	samples.sort()
	cpu_ms.sort()
	main_draws.sort()
	tactical_draws.sort()
	main_gpu_ms.sort()
	tactical_gpu_ms.sort()
	var sum := 0
	for fps in samples: sum += fps
	print("WORLD_BUILDER_STRESS ", JSON.stringify({"summoned": live_count, "view_fps": game.world_builder_view.refresh_limit, "scale": game.world_builder_view.render_scale, "desktop_fps_min": samples[0], "desktop_fps_median": samples[samples.size() / 2], "desktop_fps_mean": float(sum) / samples.size(), "cpu_process_p95_ms": cpu_ms[int(cpu_ms.size() * 0.95)], "main_draws_median": main_draws[main_draws.size() / 2], "tactical_draws_median": tactical_draws[tactical_draws.size() / 2], "main_gpu_p95_ms": main_gpu_ms[int(main_gpu_ms.size() * 0.95)] if not main_gpu_ms.is_empty() else null, "tactical_gpu_p95_ms": tactical_gpu_ms[int(tactical_gpu_ms.size() * 0.95)] if not tactical_gpu_ms.is_empty() else null, "scope": "Two desktop viewports; not stereo VR"}))
	RenderingServer.viewport_set_measure_render_time(main_viewport, false)
	RenderingServer.viewport_set_measure_render_time(tactical_viewport, false)
	game.world_builder_view.close()
	await process_frame
	quit(0 if live_count == 24 else 1)
