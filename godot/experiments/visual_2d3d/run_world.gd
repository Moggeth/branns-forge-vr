extends SceneTree

const BUILDER = preload("res://experiments/visual_2d3d/world_builder.gd")
var start_ms := Time.get_ticks_msec()

func argument(name: String, fallback := "") -> String:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--" + name + "="): return arg.substr(name.length() + 3)
	return fallback

func read_json(path: String) -> Dictionary:
	if not FileAccess.file_exists(path):
		push_error("Missing JSON: " + path)
		return {}
	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(data) != TYPE_DICTIONARY:
		push_error("Invalid JSON object: " + path)
		return {}
	return data

func write_json(path: String, data: Dictionary):
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		push_error("Cannot write: " + path)
		return
	file.store_string(JSON.stringify(data, "\t") + "\n")

func make_owned(node: Node, owner: Node):
	for child in node.get_children():
		child.owner = owner
		if not child.scene_file_path.is_empty(): continue
		make_owned(child, owner)

func _initialize():
	call_deferred("run")

func run():
	var spec_path := argument("spec")
	var benchmark_path := argument("benchmark")
	var out_dir := argument("out")
	var check_only := OS.get_cmdline_user_args().has("--check-only")
	if spec_path.is_empty() or benchmark_path.is_empty() or out_dir.is_empty():
		push_error("Usage: -- --spec=ABS.json --benchmark=ABS.json --out=ABS_DIR [--check-only]")
		quit(2)
		return
	DirAccess.make_dir_recursive_absolute(out_dir)
	var spec := read_json(spec_path)
	var benchmark := read_json(benchmark_path)
	if spec.is_empty() or benchmark.is_empty():
		quit(2)
		return
	var builder = BUILDER.new(spec)
	var valid: bool = builder.validate()
	var report := {"variant": spec.get("variant", "?"), "method": spec.get("method", "?"), "valid": valid, "errors": builder.errors, "metrics": builder.metrics, "render_status": "not_attempted", "spec_path": spec_path, "benchmark_path": benchmark_path}
	if not valid:
		write_json(out_dir.path_join("metrics.json"), report)
		push_error("World spec invalid: " + "; ".join(builder.errors))
		quit(2)
		return
	if check_only:
		report["elapsed_s"] = (Time.get_ticks_msec() - start_ms) / 1000.0
		write_json(out_dir.path_join("metrics.json"), report)
		print("WORLD_SPEC_CHECK_PASS ", spec.variant)
		quit()
		return
	var build_start := Time.get_ticks_msec()
	var scene: Node3D = builder.build()
	if scene == null or not builder.errors.is_empty():
		report["errors"] = builder.errors
		write_json(out_dir.path_join("metrics.json"), report)
		quit(2)
		return
	root.add_child(scene)
	await physics_frame
	var physics := scene.get_world_3d().direct_space_state
	var bridge_xz: Array = spec.crossing.center_xz
	var bridge_at := Vector3(float(bridge_xz[0]), 0, float(bridge_xz[1]))
	var bridge_hit := physics.intersect_ray(PhysicsRayQueryParameters3D.create(bridge_at + Vector3.UP * 10.0, bridge_at + Vector3.DOWN * 10.0))
	var bridge_collision_ok := not bridge_hit.is_empty() and str(bridge_hit.collider.name) == "WalkableDeckCollision"
	var spawn_xz: Array = spec.spawn_xz
	var spawn_at := Vector3(float(spawn_xz[0]), 0, float(spawn_xz[1]))
	var ground_hit := physics.intersect_ray(PhysicsRayQueryParameters3D.create(spawn_at + Vector3.UP * 10.0, spawn_at + Vector3.DOWN * 10.0))
	var ground_collision_ok := not ground_hit.is_empty() and str(ground_hit.collider.name) == "TerrainCollision"
	builder.metrics["bridge_collision_ok"] = bridge_collision_ok
	builder.metrics["spawn_ground_collision_ok"] = ground_collision_ok
	if not bridge_collision_ok or not ground_collision_ok:
		report["errors"] = ["Physical bridge or spawn ground raycast failed"]
		write_json(out_dir.path_join("metrics.json"), report)
		quit(2)
		return
	report["build_s"] = (Time.get_ticks_msec() - build_start) / 1000.0
	report["metrics"] = builder.metrics
	make_owned(scene, scene)
	var packed := PackedScene.new()
	var pack_error := packed.pack(scene)
	var scene_path := out_dir.path_join("world.tscn")
	if pack_error == OK: pack_error = ResourceSaver.save(packed, scene_path)
	if pack_error != OK:
		report["errors"] = ["Scene save failed: " + str(pack_error)]
		write_json(out_dir.path_join("metrics.json"), report)
		quit(2)
		return
	report["scene_path"] = scene_path
	var render_start := Time.get_ticks_msec()
	if DisplayServer.get_name() == "headless":
		report["render_status"] = "unavailable_headless_display"
	else:
		var viewport := SubViewport.new()
		viewport.name = "EvaluationViewport"
		viewport.size = Vector2i(1280, 720)
		viewport.transparent_bg = false
		viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
		root.add_child(viewport)
		var duplicate_scene := packed.instantiate()
		viewport.add_child(duplicate_scene)
		var camera := Camera3D.new()
		camera.current = true
		viewport.add_child(camera)
		var captured := []
		for view in benchmark.get("evaluation_cameras", []):
			camera.position = Vector3(float(view.position[0]), float(view.position[1]), float(view.position[2]))
			camera.fov = float(view.get("fov_deg", 72))
			var target := Vector3(float(view.target[0]), float(view.target[1]), float(view.target[2]))
			camera.look_at(target, Vector3(0, 0, -1) if bool(view.get("north_up", false)) else Vector3.UP)
			await RenderingServer.frame_post_draw
			await RenderingServer.frame_post_draw
			var image := viewport.get_texture().get_image()
			if image == null or image.is_empty():
				report["errors"] = ["Readback failed: " + str(view.id)]
				break
			var output := out_dir.path_join(str(view.id) + ".png")
			var result := image.save_png(output)
			if result != OK:
				report["errors"] = ["PNG save failed: " + output]
				break
			captured.append(output)
		viewport.queue_free()
		report["render_status"] = "complete" if captured.size() == benchmark.get("evaluation_cameras", []).size() else "failed"
		report["captures"] = captured
	report["render_s"] = (Time.get_ticks_msec() - render_start) / 1000.0
	report["elapsed_s"] = (Time.get_ticks_msec() - start_ms) / 1000.0
	write_json(out_dir.path_join("metrics.json"), report)
	print("WORLD_BUILD_COMPLETE ", spec.variant, " ", report.render_status, " ", scene_path)
	quit(0 if report.get("errors", []).is_empty() else 2)
