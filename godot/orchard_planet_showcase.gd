extends SceneTree
## Full-game, offline visual pass. Run windowed with --xr-mode off,
## --audio-driver Dummy, --resolution 960x540, and --orchard-planet-preview.
## No service, user save, or external runtime is used in preview mode.
## Visual review caught night-side ambient and inward water winding; both were
## corrected. Capture the full game again after changes to ground/water/rendering.

const PREVIEW_FLAG := "--orchard-planet-preview"
const SETTLE_FRAMES := 48
var game: Node3D
var planet
var camera: Camera3D
var output_dir := ""
var frame_samples: Array[float] = []
var failures: Array[String] = []
var captures: Array[Dictionary] = []
var started_usec := 0

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has(PREVIEW_FLAG):
		push_error("Planet showcase requires " + PREVIEW_FLAG + " for offline setup")
		quit(2)
		return
	started_usec = Time.get_ticks_usec()
	output_dir = ProjectSettings.globalize_path("res://../logs")
	DirAccess.make_dir_recursive_absolute(output_dir)
	_run.call_deferred()

func _run() -> void:
	game = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	root.size = Vector2i(960, 540)
	DisplayServer.window_set_size(Vector2i(960, 540))
	game.set_process(false)
	game.set_process_input(false)
	if not bool(game.get("diagnostic_offline")):
		_fail("Main did not enable diagnostic mode")
		return
	await game.adventure.travel("orchard_planet")
	await physics_frame
	planet = game.orchard_planet
	if game.adventure.zone != "orchard_planet" or planet == null or not planet.built:
		_fail("Travel did not enter a built planet")
		return
	camera = game.camera
	camera.far = 500.0
	camera.current = true
	# The survey Window is instantiated against the same 3D world. Captures use
	# the game's real camera/viewport so they include the shared hero rendering.
	var survey := preload("res://world_builder_view.gd").new()
	survey.visible = false
	game.add_child(survey)
	survey.setup(game, game.world_builder)
	var shared_world: bool = survey.tactical_viewport.world_3d == game.get_world_3d()
	if not shared_world: failures.append("RTS Window has a different world")
	# setup() temporarily shrinks the Hero render texture for its picture-in-picture
	# pane. Keep the shared RTS world but restore a full-size Hero capture target.
	survey.hide()
	survey.set_process(false)
	survey._restore_hero_resolution()
	root.content_scale_size = Vector2i(960, 540)
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	root.size = Vector2i(960, 540)
	if game.get("player_avatar") != null: game.player_avatar.hide()
	for canvas in game.find_children("*", "CanvasLayer", true, false):
		canvas.hide()
	var anchors: Array[Dictionary] = planet.fields.region_anchors()
	var by_biome := {}
	for entry in anchors: by_biome[str(entry["biome"])] = entry["direction"]
	var views := ["temperate", "alpine", "crystal", "desert", "ruins", "water"]
	_overview_camera()
	await _settle(SETTLE_FRAMES)
	await _capture("overview", {"view":"RTS whole globe", "shared_world":shared_world})
	for biome in views:
		var direction: Vector3 = _water_direction() if biome == "water" else by_biome.get(biome, Vector3.UP)
		if biome == "water": _water_camera(direction)
		else: _ground_camera(direction)
		await _settle(SETTLE_FRAMES)
		var sample: Dictionary = planet.fields.sample(direction)
		await _capture(biome, {"biome":biome, "field":sample.get("biome", ""), "water":sample.get("water",false), "river":sample.get("river",0.0), "lake":sample.get("lake",0.0)})
	var effect_direction: Vector3 = by_biome.get("temperate", Vector3.UP)
	var effect_point: Vector3 = planet.surface_point(effect_direction)
	var sunder: Dictionary = planet.cast("sunder", effect_point)
	var tree_direction: Vector3 = (effect_direction + effect_direction.cross(Vector3.UP).normalized() * 0.14).normalized()
	var trees: Dictionary = planet.cast("ring", planet.surface_point(tree_direction))
	if not sunder.get("ok", false): failures.append("Sunder rejected: " + str(sunder))
	if not trees.get("ok", false): failures.append("Tree Ring rejected: " + str(trees))
	_ground_camera(effect_direction)
	await _settle(SETTLE_FRAMES)
	await _capture("sunder-trees", {"sunder":sunder.get("ok",false), "trees":trees.get("placed",0), "revision":planet.fields.revision})
	var report := {"captures":captures,"failures":failures,"meshes":_mesh_count(),"frames":frame_samples.size(),
		"median_frame_wall_ms":_median(frame_samples),"wall_seconds":float(Time.get_ticks_usec()-started_usec)/1000000.0,
		"gpu_time_ms":"unavailable"}
	print("ORCHARD_PLANET_SHOWCASE_RESULT ", JSON.stringify(report))
	quit(0 if failures.is_empty() else 1)

func _overview_camera() -> void:
	camera.global_position = planet.center + Vector3(0, 55, 165)
	camera.look_at(planet.center, Vector3.UP)

func _ground_camera(direction: Vector3) -> void:
	var up := direction.normalized()
	var ground: Vector3 = planet.surface_point(up)
	var tangent := up.cross(Vector3.RIGHT).normalized()
	if tangent.length_squared() < 0.01: tangent = up.cross(Vector3.FORWARD).normalized()
	camera.global_position = ground + up * 1.8
	camera.look_at(ground + tangent * 14.0 + up * 0.5, up)

func _water_camera(direction: Vector3) -> void:
	var up := direction.normalized()
	var ground: Vector3 = planet.surface_point(up)
	var tangent := up.cross(Vector3.RIGHT).normalized()
	if tangent.length_squared() < 0.01: tangent = up.cross(Vector3.FORWARD).normalized()
	camera.global_position = ground + up * 9.0 - tangent * 6.0
	camera.look_at(ground + up * 0.3, up)

func _water_direction() -> Vector3:
	for river in planet.fields._river:
		return river["lake"]
	for i in 500:
		var d := Vector3(cos(float(i)*2.39996), sin(float(i)*0.37), sin(float(i)*2.39996)).normalized()
		if planet.fields.sample(d)["water"]: return d
	return Vector3.FORWARD

func _settle(frames: int) -> void:
	for i in 1200:
		var before := Time.get_ticks_usec()
		planet.tick(1.0/60.0)
		await process_frame
		frame_samples.append(float(Time.get_ticks_usec()-before)/1000.0)
		var stats: Dictionary = planet.terrain.statistics()
		if i >= frames and int(stats["dirty"]) == 0 and int(stats["morphing"]) == 0: break
	await RenderingServer.frame_post_draw

func _capture(label: String, details: Dictionary) -> void:
	await RenderingServer.frame_post_draw
	var image := root.get_texture().get_image()
	var path := output_dir.path_join("planet-showcase-" + label + ".png")
	var error := image.save_png(path)
	var stats := {"label":label,"path":path,"save_error":error,"size":[image.get_width(),image.get_height()],
		"draw_calls":roundi(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		"primitives":roundi(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)),
		"objects":roundi(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)),
		"fps":Engine.get_frames_per_second(),"cpu_process_ms":"unavailable: main processing disabled in capture",
		"meshes":_mesh_count(),"terrain":planet.terrain.statistics()}
	stats.merge(details)
	captures.append(stats)
	print("ORCHARD_PLANET_SHOWCASE_CAPTURE ", JSON.stringify(stats))
	if error != OK or image.get_width() < 640: failures.append("Capture failed: " + label)

func _mesh_count() -> Dictionary:
	var direct := 0
	var batches := 0
	var instances := 0
	for node in planet.root.find_children("*", "MeshInstance3D", true, false):
		if node.is_visible_in_tree() and node.mesh != null: direct += 1
	for node in planet.root.find_children("*", "MultiMeshInstance3D", true, false):
		if node.is_visible_in_tree() and node.multimesh != null:
			batches += 1
			instances += node.multimesh.visible_instance_count if node.multimesh.visible_instance_count >= 0 else node.multimesh.instance_count
	return {"direct":direct,"batches":batches,"instances":instances}

func _median(values: Array[float]) -> float:
	if values.is_empty(): return 0.0
	var sorted := values.duplicate()
	sorted.sort()
	return sorted[sorted.size()/2]

func _fail(message: String) -> void:
	push_error(message)
	print("ORCHARD_PLANET_SHOWCASE_RESULT ", JSON.stringify({"failures":[message]}))
	quit(1)
