extends SceneTree
## Observational native GPU benchmark of installed Orchard and simultaneous views.
## Run graphically with -- --world-builder-check; no live service or player save.

const View = preload("res://world_builder_view.gd")
const SAMPLE_SECONDS := 2.0
var started := Time.get_ticks_usec()

func _initialize() -> void:
	create_timer(35.0).timeout.connect(func() -> void:
		printerr("WORLD_BUILDER_VIEW_PERF timeout=35")
		quit(2))
	call_deferred("_check")

func _check() -> void:
	if DisplayServer.get_name() == "headless" or not OS.get_cmdline_user_args().has("--world-builder-check"):
		printerr("WORLD_BUILDER_VIEW_PERF needs native GPU and --world-builder-check")
		quit(2)
		return
	root.unfocusable = true
	root.position = Vector2i(-12000, -12000)
	root.size = Vector2i(1280, 800)
	root.content_scale_size = Vector2i.ZERO
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	if game.world_builder == null or game.adventure.zone != "orchard_highlands":
		printerr("WORLD_BUILDER_VIEW_PERF offline Orchard did not load")
		quit(1)
		return
	var view: Window = View.new()
	view.visible = false
	view.unfocusable = true
	game.add_child(view)
	game.world_builder_view = view
	view.setup(game, game.world_builder)
	view.mode = Window.MODE_WINDOWED
	view.size = Vector2i(1280, 800)
	view.position = Vector2i(-10600, -12000)
	view.select_action("meteor")
	view.hovered = Vector3(20,0,-40)
	view._update_preview()
	var capture_dir := ProjectSettings.globalize_path("res://../outputs/world-builder-live-review")
	DirAccess.make_dir_recursive_absolute(capture_dir)
	var hero_rid: RID = game.get_viewport().get_viewport_rid()
	var rts_rid: RID = view.tactical_viewport.get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(hero_rid, true)
	RenderingServer.viewport_set_measure_render_time(rts_rid, true)
	await create_timer(0.8).timeout
	var samples: Array[Dictionary] = []
	for hero_is_primary in [false, true]:
		if view.hero_primary != hero_is_primary: view.swap_primary()
		for target in [60, 120]:
			view._fps(1 if target == 60 else 2)
			await create_timer(0.5).timeout
			samples.append(await _sample(game, view, hero_rid, rts_rid, target))
	RenderingServer.viewport_set_measure_render_time(hero_rid, false)
	RenderingServer.viewport_set_measure_render_time(rts_rid, false)
	# GPU readback stalls; keep all screenshots outside measured windows.
	for hero_is_primary in [false,true]:
		if view.hero_primary != hero_is_primary: view.swap_primary()
		for i in 4: await process_frame
		await RenderingServer.frame_post_draw
		var shot := view.get_texture().get_image()
		if shot.save_png(capture_dir.path_join("hero-primary.png" if hero_is_primary else "rts-primary.png")) != OK:
			printerr("WORLD_BUILDER_VIEW_PERF capture write failed")
			quit(1)
			return
	view.visible = false
	view.queue_free()
	await process_frame
	print("WORLD_BUILDER_VIEW_PERF ", JSON.stringify({"samples": samples, "wall_seconds": (Time.get_ticks_usec() - started) / 1000000.0, "scope": "Installed offline Orchard, desktop Vulkan; neither headset nor display-refresh guarantee"}))
	quit(0)

func _sample(game: Node3D, view: Window, hero_rid: RID, rts_rid: RID, target: int) -> Dictionary:
	var frame_ms: Array[float] = []
	var cpu_ms: Array[float] = []
	var hero_gpu_ms: Array[float] = []
	var rts_gpu_ms: Array[float] = []
	var frame_count := 0
	var begin := Time.get_ticks_usec()
	var last_frame := begin
	while (Time.get_ticks_usec() - begin) / 1000000.0 < SAMPLE_SECONDS:
		await process_frame
		var now := Time.get_ticks_usec()
		frame_count += 1
		frame_ms.append((now - last_frame) / 1000.0)
		last_frame = now
		cpu_ms.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
		var hero_gpu := RenderingServer.viewport_get_measured_render_time_gpu(hero_rid)
		var rts_gpu := RenderingServer.viewport_get_measured_render_time_gpu(rts_rid)
		if hero_gpu > 0.0: hero_gpu_ms.append(hero_gpu)
		if rts_gpu > 0.0: rts_gpu_ms.append(rts_gpu)
	var seconds := (Time.get_ticks_usec() - begin) / 1000000.0
	return {"primary": "hero" if view.hero_primary else "rts", "target_fps": target,
		"observed_fps": snappedf(frame_count / seconds, 0.1), "frame_p95_ms": _p95(frame_ms),
		"cpu_p95_ms": _p95(cpu_ms), "hero_gpu_p95_ms": _p95(hero_gpu_ms),
		"rts_gpu_p95_ms": _p95(rts_gpu_ms), "hero_3d_scale": game.get_viewport().scaling_3d_scale,
		"rts_3d_scale": view.render_scale, "rts_frames_requested": view.requested_frames,
		"rts_viewport_pixels": view.tactical_viewport.size}

func _p95(values: Array[float]) -> Variant:
	if values.is_empty(): return null
	values.sort()
	return snappedf(values[mini(ceili(values.size() * 0.95) - 1, values.size() - 1)], 0.01)
