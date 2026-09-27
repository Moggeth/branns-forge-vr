extends SceneTree
## Short local measurement; closes only the Godot process launched with this script.

func _initialize() -> void:
	call_deferred("_sample")

func _sample() -> void:
	var game = load("res://main.tscn").instantiate()
	root.add_child(game)
	await create_timer(3.0).timeout
	var view = game.director_local_view
	if not is_instance_valid(view):
		push_error("DIRECTOR_VR_PERF missing native director window")
		quit(1)
		return
	var samples: Array[float] = []
	var last = Time.get_ticks_usec()
	for _frame in range(360):
		await process_frame
		var now = Time.get_ticks_usec()
		samples.append(float(now - last) / 1000.0)
		last = now
	samples.sort()
	var sum_ms = 0.0
	for ms in samples: sum_ms += ms
	var report = {
		"xr": game.vr,
		"director_world_shared": view.tactical_viewport.world_3d == game.get_world_3d(),
		"render_scale": view.render_scale,
		"director_refresh_limit": view.refresh_limit,
		"frames": samples.size(),
		"mean_frame_ms": snappedf(sum_ms / float(samples.size()), 0.01),
		"p95_frame_ms": snappedf(samples[int(0.95 * float(samples.size() - 1))], 0.01),
		"p99_frame_ms": snappedf(samples[int(0.99 * float(samples.size() - 1))], 0.01),
		"engine_fps": Engine.get_frames_per_second(),
		"draw_calls": Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),
	}
	print("DIRECTOR_VR_PERF ", JSON.stringify(report))
	quit()
