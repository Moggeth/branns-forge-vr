extends SceneTree
## Save-isolated graphical evidence for every playable zone. Run with --world-builder-preview.

const OUTPUT := "res://../outputs/environment-art-review"
const SIZE := Vector2i(1200, 750)
const ORDER := ["forge_yard", "sandstone_quarry", "enchanted_kitchen", "pinewood_ruins", "mushroom_glade", "crystal_hollow", "sky_garden", "ember_foundry", "orchard_highlands", "gloamfen", "starfall_ridge", "cloudbreak_keep"]

var failures: Array[String] = []
var captures: Array[Dictionary] = []
var zones: Array[Dictionary] = []
var audit_notes: Array[String] = []
var started_ms := 0

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview"):
		push_error("ENVIRONMENT_ART_REVIEW requires --world-builder-preview for save isolation")
		quit(1)
		return
	if DisplayServer.get_name() == "headless":
		push_error("ENVIRONMENT_ART_REVIEW requires a graphical renderer")
		quit(1)
		return
	started_ms = Time.get_ticks_msec()
	call_deferred("_run")

func _run() -> void:
	var no_horizon := OS.get_cmdline_user_args().has("--review-hide-horizon")
	var correct_fog := OS.get_cmdline_user_args().has("--review-correct-fog")
	var suffix := ("-corrected-fog" if correct_fog else "") + ("-no-horizon" if no_horizon else "")
	var output := ProjectSettings.globalize_path(OUTPUT + suffix)
	if DirAccess.make_dir_recursive_absolute(output) != OK:
		push_error("ENVIRONMENT_ART_REVIEW cannot create " + output)
		quit(1)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	if not game.diagnostic_offline:
		failures.append("game did not enter save-isolated diagnostic mode")
		_finish(output)
		return
	var review_view := SubViewport.new()
	review_view.name = "EnvironmentArtReviewSharedWorld"
	review_view.size = SIZE
	review_view.world_3d = game.get_world_3d()
	review_view.msaa_3d = Viewport.MSAA_2X
	review_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(review_view)
	var camera := Camera3D.new()
	camera.far = 550.0
	review_view.add_child(camera)
	camera.current = true
	for id in ORDER:
		if not game.scene.zones.has(id):
			failures.append("missing zone: " + id)
			continue
		var zone: Dictionary = game.scene.zones[id]
		var center: Vector3 = zone.center
		var counts := _scene_counts(zone.root)
		var record := {"id": id, "name": zone.name, "center": _vector(center), "tier": zone.tier,
			"scene_counts": counts, "views": []}
		zones.append(record)
		# Travel applies the same per-zone atmosphere a player sees. Offline mode
		# prevents persistence and service traffic; only the review camera moves.
		game.adventure.travel(id)
		await process_frame
		var env: Environment = game.get_node("AdventureEnvironment").environment
		var zone_density: float = float(zone.environment.get("fog_density", 0.0))
		# OrchardHorizon applies its own authored grade after the zone palette.
		var expected_density: float = env.fog_density if id == "orchard_highlands" else zone_density
		record["fog_density_zone_setting"] = zone_density
		record["fog_density_expected"] = expected_density
		record["fog_density_actual_before_review_override"] = env.fog_density
		if not is_equal_approx(env.fog_density, expected_density):
			audit_notes.append(id + ": fog density " + str(env.fog_density) + " differs from zone setting " + str(expected_density))
		if correct_fog:
			# Review-only diagnostic: show intended authored art behind the fog
			# regression. This mutates only the disposable process Environment.
			env.fog_density = expected_density
		record["fog_density_captured"] = env.fog_density
		if no_horizon and zone.has("horizon"):
			zone.horizon.visible = false
		var eye: Vector3 = zone.capture_position
		var target: Vector3 = zone.capture_target
		await _capture(id, "ground-eye", eye, target, 76.0, review_view, camera, output, record)
		var extent: float = float(zone.bounds.size.x) * 0.5
		var reach: float = minf(extent * 0.7, 40.0)
		var survey_eye := center + Vector3(reach * 0.8, maxf(22.0, reach * 1.25), reach)
		var survey_target := center + Vector3(0, 1.0, -minf(8.0, extent * 0.25))
		# Enclosed destinations need the survey camera below their roofs.
		if id == "enchanted_kitchen":
			survey_eye = center + Vector3(0, 4.0, 9.5)
			survey_target = center + Vector3(0, 0.5, -4.0)
		elif id == "crystal_hollow":
			survey_eye = center + Vector3(3.0, 5.5, 9.0)
			survey_target = center + Vector3(-1.0, 1.0, -6.0)
		await _capture(id, "elevated-rts", survey_eye, survey_target, 56.0, review_view, camera, output, record)
	_finish(output)

func _capture(id: String, view_name: String, position: Vector3, target: Vector3, fov: float,
		viewport: SubViewport, camera: Camera3D, output: String, record: Dictionary) -> void:
	camera.fov = fov
	camera.global_position = position
	camera.look_at(target, Vector3.UP)
	for frame in 5:
		await process_frame
	await RenderingServer.frame_post_draw
	# Sample before PNG readback. Capture pacing makes FPS and process-time
	# counters meaningless here, but draw calls and object counts remain useful.
	var render_metrics := {
		"draw_calls": roundi(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		"objects": roundi(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)),
	}
	var image := viewport.get_texture().get_image()
	var path := output.path_join(id + "-" + view_name + ".png")
	var result := image.save_png(path)
	if result != OK or image.is_empty():
		failures.append("capture failed: " + path + " error=" + str(result))
	var capture := {"zone": id, "view": view_name, "path": path,
		"camera_position": _vector(position), "camera_target": _vector(target),
		"width": image.get_width(), "height": image.get_height(), "save_error": result,
		"render_metrics": render_metrics,
		"image_metrics": _image_metrics(image)}
	captures.append(capture)
	record.views.append(capture)

func _scene_counts(zone_root: Node) -> Dictionary:
	var counts := {"mesh_instances": 0, "multimesh_instances": 0, "lights": 0,
		"visible_geometry_nodes": 0, "named_landmarks": 0}
	var pending: Array[Node] = [zone_root]
	while not pending.is_empty():
		var node: Node = pending.pop_back()
		if node is MeshInstance3D:
			counts.mesh_instances += 1
			if node.visible: counts.visible_geometry_nodes += 1
		elif node is MultiMeshInstance3D:
			counts.multimesh_instances += 1
			if node.visible: counts.visible_geometry_nodes += 1
		elif node is Light3D:
			counts.lights += 1
		if node.name.to_lower().contains("landmark"):
			counts.named_landmarks += 1
		for child in node.get_children(): pending.append(child)
	return counts

func _image_metrics(image: Image) -> Dictionary:
	if image.is_empty(): return {}
	var sum_luma := 0.0
	var dark := 0
	var bright := 0
	var colors := {}
	var samples := 0
	for y in range(18, image.get_height(), 36):
		for x in range(18, image.get_width(), 36):
			var color := image.get_pixel(x, y)
			var luma: float = 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b
			sum_luma += luma
			if luma < 0.12: dark += 1
			if luma > 0.9: bright += 1
			var key := "%d-%d-%d" % [int(color.r * 8), int(color.g * 8), int(color.b * 8)]
			colors[key] = true
			samples += 1
	return {"sample_count": samples, "mean_luminance": snappedf(sum_luma / maxf(1.0, float(samples)), 0.001),
		"dark_fraction": snappedf(float(dark) / maxf(1.0, float(samples)), 0.001),
		"bright_fraction": snappedf(float(bright) / maxf(1.0, float(samples)), 0.001),
		"quantized_color_bins": colors.size()}

func _vector(point: Vector3) -> Array[float]:
	return [snappedf(point.x, 0.01), snappedf(point.y, 0.01), snappedf(point.z, 0.01)]

func _finish(output: String) -> void:
	var report := {"name": "ENVIRONMENT_ART_REVIEW", "save_isolated": true,
		"renderer": DisplayServer.get_name(), "zone_count": zones.size(), "captures": captures,
		"zones": zones, "audit_notes": audit_notes, "review_corrected_fog": OS.get_cmdline_user_args().has("--review-correct-fog"),
		"review_hidden_horizon": OS.get_cmdline_user_args().has("--review-hide-horizon"), "failures": failures,
		"elapsed_seconds": snappedf(float(Time.get_ticks_msec() - started_ms) / 1000.0, 0.01)}
	var path := output.path_join("result.json")
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		failures.append("cannot write manifest: " + path)
	else:
		file.store_string(JSON.stringify(report, "  "))
		file.close()
	print("ENVIRONMENT_ART_REVIEW ", JSON.stringify({"zone_count": zones.size(), "capture_count": captures.size(), "failures": failures, "elapsed_seconds": report.elapsed_seconds}))
	quit(0 if failures.is_empty() and zones.size() == ORDER.size() and captures.size() == ORDER.size() * 2 else 1)
