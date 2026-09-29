extends SceneTree
## Deterministic, save-isolated captures of the real Orchard from Hero and survey views.
## Graphical run: Godot --xr-mode off --audio-driver Dummy --path godot
##   --script res://landscape_visual_review.gd -- --world-builder-preview --landscape-seed=290929

const SEED := 290929
const OUTPUT := "res://../outputs/landscape-visual-review"
var failures: Array[String] = []
var captures: Array[Dictionary] = []
var start_ms := 0

func _initialize() -> void:
	var args := OS.get_cmdline_user_args()
	if not args.has("--world-builder-preview") or not args.has("--landscape-seed=%d" % SEED):
		push_error("LANDSCAPE_VISUAL_REVIEW requires offline preview and fixed seed %d" % SEED)
		quit(1)
		return
	if DisplayServer.get_name() == "headless":
		push_error("LANDSCAPE_VISUAL_REVIEW requires graphical rendering")
		quit(1)
		return
	start_ms = Time.get_ticks_msec()
	call_deferred("_run")

func _run() -> void:
	var output := ProjectSettings.globalize_path(OUTPUT)
	var directory_error := DirAccess.make_dir_recursive_absolute(output)
	if directory_error != OK:
		push_error("LANDSCAPE_VISUAL_REVIEW cannot make output: " + output)
		quit(1)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	if not game.diagnostic_offline:
		failures.append("game is not in save-isolated diagnostic mode")
		_finish(output)
		return
	game.adventure.hp = 9999.0
	game.adventure.travel("orchard_highlands")
	game._open_world_builder_view()
	await process_frame
	var builder: Node = game.world_builder
	var land: Node = game.landscape
	var tactical: Window = game.world_builder_view
	if builder == null or land == null or tactical == null or land.seed != SEED:
		failures.append("shared Orchard world, survey view, or fixed seed unavailable")
		_finish(output)
		return
	tactical.refresh_limit = 0
	tactical.tactical_viewport.size = Vector2i(1200, 750)
	var hero_view := SubViewport.new()
	hero_view.size = Vector2i(1200, 750)
	hero_view.world_3d = game.get_world_3d()
	hero_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(hero_view)
	var eye := Camera3D.new()
	eye.fov = 76.0
	eye.far = 490.0
	hero_view.add_child(eye)
	eye.current = true
	var brook := Vector2(25, -48)
	var sunder := Vector2(-46, -5)
	var raise_at := Vector2(-43, 44)
	var grow := Vector2(61, -73)
	await _pair("00-brook-bank-natural", builder, land, tactical, hero_view, eye, brook, Vector2(25, -48), Vector2(35, -38), 48.0, output)
	await _pair("01-sunder-before", builder, land, tactical, hero_view, eye, sunder, sunder, Vector2(-57, 7), 49.0, output)
	builder.data.aether = 20.0
	var error: String = builder.cast_sunder(Vector3(-69, 0, -5), Vector3(-24, 0, -5))
	if error.is_empty():
		await create_timer(0.48).timeout
		await _pair("02-sunder-during", builder, land, tactical, hero_view, eye, sunder, sunder, Vector2(-57, 7), 49.0, output)
		land._finish_transition()
		await _await_hydrology(land)
		await _pair("03-sunder-after", builder, land, tactical, hero_view, eye, sunder, sunder, Vector2(-57, 7), 49.0, output)
	else: failures.append("sunder: " + error)
	await _pair("04-raise-before", builder, land, tactical, hero_view, eye, raise_at, raise_at, Vector2(-55, 55), 45.0, output)
	builder.data.aether = 20.0
	error = builder.cast_raise(Vector3(raise_at.x, 0, raise_at.y))
	if error.is_empty():
		await create_timer(0.40).timeout
		await _pair("05-raise-during", builder, land, tactical, hero_view, eye, raise_at, raise_at, Vector2(-55, 55), 45.0, output)
		land._finish_transition()
		await _await_hydrology(land)
		await _pair("06-raise-after", builder, land, tactical, hero_view, eye, raise_at, raise_at, Vector2(-55, 55), 45.0, output)
	else: failures.append("raise: " + error)
	await _pair("07-grow-before", builder, land, tactical, hero_view, eye, grow, grow, Vector2(50, -59), 59.0, output)
	builder.data.aether = 20.0
	error = builder.cast_forest(Vector3(45, 0, -73), Vector3(77, 0, -73))
	if error.is_empty():
		builder.tick(0.55)
		await _pair("08-grow-during", builder, land, tactical, hero_view, eye, grow, grow, Vector2(50, -59), 59.0, output)
		builder.tick(3.0)
		await _pair("09-grow-after", builder, land, tactical, hero_view, eye, grow, grow, Vector2(50, -59), 59.0, output)
	else: failures.append("grow: " + error)
	_finish(output)

func _await_hydrology(land: Node) -> void:
	# The visual target is the stable world, including bank/ecology placement.
	# A review capture taken before the worker merge can miss the final dressing.
	for frame in 90:
		if land.pending_hydrology.is_empty(): return
		await process_frame
	failures.append("hydrology did not settle before visual capture")

func _pair(label: String, builder: Node, land: Node, tactical: Window, hero_view: SubViewport, eye: Camera3D, focus: Vector2, look: Vector2, eye_at: Vector2, distance: float, output: String) -> void:
	var center: Vector3 = builder.center
	var ground: float = land.height_at(eye_at)
	eye.global_position = center + Vector3(eye_at.x, ground + 1.7, eye_at.y)
	var target_height: float = land.height_at(look)
	eye.look_at(center + Vector3(look.x, target_height + 1.2, look.y), Vector3.UP)
	tactical.focus_point = center + Vector3(focus.x, land.height_at(focus), focus.y)
	tactical.yaw = 0.64
	tactical.pitch = 0.84
	tactical.zoom = distance * 0.88
	tactical._position_camera()
	tactical.tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	for frame in 5: await process_frame
	await RenderingServer.frame_post_draw
	for angle in ["hero-eye", "tactical"]:
		var viewport: SubViewport = hero_view if angle == "hero-eye" else tactical.tactical_viewport
		var image := viewport.get_texture().get_image()
		var path := output.path_join(label + "-" + angle + ".png")
		var result := image.save_png(path)
		if result != OK or image.is_empty(): failures.append("capture failed: " + path + " error=" + str(result))
		captures.append({"stage": label, "view": angle, "path": path, "width": image.get_width(), "height": image.get_height(), "save_error": result})
	tactical.tactical_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED

func _finish(output: String) -> void:
	var report := {"name": "LANDSCAPE_VISUAL_REVIEW", "seed": SEED, "save_isolated": true,
		"captures": captures, "failures": failures, "elapsed_seconds": snappedf(float(Time.get_ticks_msec() - start_ms) / 1000.0, 0.01)}
	var manifest := output.path_join("result.json")
	var file := FileAccess.open(manifest, FileAccess.WRITE)
	if file == null: failures.append("cannot write result manifest: " + manifest)
	else:
		file.store_string(JSON.stringify(report, "  "))
		file.close()
	print("LANDSCAPE_VISUAL_REVIEW ", JSON.stringify(report))
	quit(0 if failures.is_empty() and captures.size() == 20 else 1)
