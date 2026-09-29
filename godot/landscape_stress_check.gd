extends SceneTree
## Graphical, save-isolated desktop proxy for a 100 m spell while the Hero and
## strategic cameras view one World3D. Headset stereo timing remains separate.
const ABLATIONS := ["none", "orchard-kit", "horizon", "spell-vfx"]
var visual_ablation := "none"
var guardian_count := 24
var tactical_view := true

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if not args.has("--world-builder-preview"):
		push_error("Landscape stress requires --world-builder-preview to isolate saves")
		quit(1)
		return
	for arg in args:
		if arg.begins_with("--visual-ablation="):
			visual_ablation = arg.trim_prefix("--visual-ablation=")
		elif arg.begins_with("--guardian-count="):
			var count_arg := arg.trim_prefix("--guardian-count=")
			if count_arg not in ["0", "24"]:
				push_error("Unknown guardian count: %s (choose 0 or 24)" % count_arg)
				quit(2)
				return
			guardian_count = int(count_arg)
		elif arg.begins_with("--tactical-view="):
			var view_arg := arg.trim_prefix("--tactical-view=")
			if view_arg not in ["on", "off"]:
				push_error("Unknown tactical view: %s (choose on or off)" % view_arg)
				quit(2)
				return
			tactical_view = view_arg == "on"
	if not ABLATIONS.has(visual_ablation):
		push_error("Unknown visual ablation: %s (choose %s)" % [visual_ablation, ", ".join(ABLATIONS)])
		quit(2)
		return
	call_deferred("_check")

func _check() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	game.adventure.travel("orchard_highlands")
	if tactical_view: game._open_world_builder_view()
	var builder: Node = game.world_builder
	if builder == null or (tactical_view and game.world_builder_view == null):
		push_error("Landscape stress needs the live world-builder scene")
		quit(1)
		return
	if not _apply_visual_ablation(game):
		quit(1)
		return
	game.adventure.hp = 9999.0
	var main_viewport: RID = root.get_viewport_rid()
	var tactical_viewport: RID = RID()
	if tactical_view: tactical_viewport = game.world_builder_view.tactical_viewport.get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(main_viewport, true)
	if tactical_view: RenderingServer.viewport_set_measure_render_time(tactical_viewport, true)
	for i in guardian_count / 3:
		builder.data.aether = 20.0
		var angle := TAU * float(i) / 8.0
		var problem: String = builder.summon_patrol(Vector3(cos(angle) * 19.0,0,sin(angle) * 19.0))
		if not problem.is_empty(): push_error(problem); quit(1); return
		builder.tick(1.8)
	await create_timer(1.0).timeout
	var baseline: Dictionary = await _sample(120, main_viewport, tactical_viewport, game.world_builder_view)
	builder.data.aether = 20.0
	var cast_start := Time.get_ticks_usec()
	var error: String = builder.cast_sunder(Vector3(-52,0,16),Vector3(52,0,16))
	if not error.is_empty(): push_error(error); quit(1); return
	var command_ms := float(Time.get_ticks_usec() - cast_start) / 1000.0
	var deform: Dictionary = await _sample(190, main_viewport, tactical_viewport, game.world_builder_view)
	await physics_frame
	var state: Dictionary = {"adapter":RenderingServer.get_video_adapter_name(),
		"visual_ablation":visual_ablation,
		"skeletons":guardian_count,"tactical_view":tactical_view,
		"terrain_chunks":game.landscape.chunks.size(),
		"affected_operations":game.landscape.operation_count(),
		"command_ms":snappedf(command_ms,0.01),"target_ms":snappedf(game.landscape.last_operation_ms,0.01),
		"last_rebuild_ms":snappedf(game.landscape.last_rebuild_ms,0.01),
		"baseline":baseline,"during":deform,
		"second_view_fps":game.world_builder_view.refresh_limit if tactical_view else 0,
		"second_view_scale":game.world_builder_view.render_scale if tactical_view else 0.0,
		"draw_calls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)}
	if tactical_view:
		var output := ProjectSettings.globalize_path("res://../outputs/landscape-tactical-sunder.png")
		var capture: Error = game.world_builder_view.tactical_viewport.get_texture().get_image().save_png(output)
		state["tactical_capture"] = output if capture == OK else "failed"
	else:
		state["tactical_capture"] = "disabled"
	print("LANDSCAPE_STRESS ", JSON.stringify(state))
	quit(0 if game.landscape.operation_count() == 1 and game.landscape.transition.is_empty() else 1)

func _apply_visual_ablation(game: Node3D) -> bool:
	match visual_ablation:
		"orchard-kit":
			var kit: Node3D = game.landscape.get_node_or_null("OrchardVisualKit")
			if kit == null:
				push_error("Landscape stress cannot find OrchardVisualKit")
				return false
			kit.visible = false
			# Hydrology can rebuild the kit during Sunder. Hide replacements as they enter.
			game.landscape.child_entered_tree.connect(_hide_rebuilt_orchard_kit)
		"horizon":
			var horizon: Node3D = game.scene.zones["orchard_highlands"].get("horizon")
			if horizon == null:
				push_error("Landscape stress cannot find OrchardHorizon")
				return false
			horizon.visible = false
		"spell-vfx":
			if game.orchard_spell_vfx == null:
				push_error("Landscape stress cannot find OrchardSpellVfx")
				return false
			game.orchard_spell_vfx.enabled = false
	return true

func _hide_rebuilt_orchard_kit(node: Node) -> void:
	if node.name == "OrchardVisualKit" and node is Node3D:
		(node as Node3D).visible = false

func _sample(frames: int, main_viewport: RID, tactical_viewport: RID, view: Window) -> Dictionary:
	var wall: Array[float] = []
	var cpu: Array[float] = []
	var fps: Array[int] = []
	var main_gpu: Array[float] = []
	var tactical_gpu: Array[float] = []
	var main_draws: Array[float] = []
	var tactical_draws: Array[float] = []
	var last_tactical_frame: int = int(view.requested_frames) if view != null else -1
	var last := Time.get_ticks_usec()
	for i in frames:
		await process_frame
		var now := Time.get_ticks_usec()
		wall.append(float(now - last) / 1000.0)
		cpu.append(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0)
		fps.append(Engine.get_frames_per_second())
		last = now
		await RenderingServer.frame_post_draw
		var gpu_ms := RenderingServer.viewport_get_measured_render_time_gpu(main_viewport)
		if gpu_ms > 0.0: main_gpu.append(gpu_ms)
		main_draws.append(float(RenderingServer.viewport_get_render_info(main_viewport,
			RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE,
			RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME)))
		if view != null and view.requested_frames != last_tactical_frame:
			last_tactical_frame = view.requested_frames
			gpu_ms = RenderingServer.viewport_get_measured_render_time_gpu(tactical_viewport)
			if gpu_ms > 0.0: tactical_gpu.append(gpu_ms)
			tactical_draws.append(float(RenderingServer.viewport_get_render_info(tactical_viewport,
				RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE,
				RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME)))
	wall.sort()
	cpu.sort()
	fps.sort()
	return {"fps_min":fps[0],"fps_median":fps[fps.size()/2],
		"wall_p95_ms":snappedf(wall[int(wall.size()*0.95)],0.01),
		"wall_max_ms":snappedf(wall[-1],0.01),
		"cpu_p95_ms":snappedf(cpu[int(cpu.size()*0.95)],0.01),
		"main_view":_render_sample(main_gpu, main_draws),
		"tactical_view":_render_sample(tactical_gpu, tactical_draws)}

func _render_sample(gpu: Array[float], draws: Array[float]) -> Dictionary:
	gpu.sort()
	draws.sort()
	return {"gpu_samples":gpu.size(),
		"gpu_p95_ms":snappedf(gpu[int(gpu.size() * 0.95)], 0.01) if not gpu.is_empty() else null,
		"draw_samples":draws.size(),
		"draw_calls_median":draws[draws.size() / 2] if not draws.is_empty() else null,
		"draw_calls_p95":draws[int(draws.size() * 0.95)] if not draws.is_empty() else null}
