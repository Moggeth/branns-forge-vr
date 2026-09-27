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

func camera_pose(view: Dictionary, benchmark: Dictionary, spec: Dictionary) -> Dictionary:
	var position := Vector3(float(view.position[0]), float(view.position[1]), float(view.position[2]))
	var target := Vector3(float(view.target[0]), float(view.target[1]), float(view.target[2]))
	if absf(float(spec.bounds_m[0]) - 80.0) < 0.01 and absf(float(spec.bounds_m[1]) - 80.0) < 0.01:
		return {"position": position, "target": target}
	var original_spawn: Array = benchmark.fixed_gameplay.spawn_xz
	var original_goal: Array = benchmark.fixed_gameplay.goal_xz
	var spawn_delta := Vector3(float(spec.spawn_xz[0]) - float(original_spawn[0]), 0, float(spec.spawn_xz[1]) - float(original_spawn[1]))
	var goal_delta := Vector3(float(spec.goal_xz[0]) - float(original_goal[0]), 0, float(spec.goal_xz[1]) - float(original_goal[1]))
	var crossing_delta := Vector3(float(spec.crossing.center_xz[0]), 0, float(spec.crossing.center_xz[1]))
	match str(view.id):
		"overhead": position.y *= maxf(float(spec.bounds_m[0]) / 80.0, float(spec.bounds_m[1]) / 80.0)
		"approach":
			position += spawn_delta
			target += crossing_delta
		"crossing":
			position += crossing_delta
			target += crossing_delta
		"landmark":
			position += goal_delta
			target += goal_delta
		"reverse":
			position += goal_delta
			target += crossing_delta
	return {"position": position, "target": target}

func sample_route_collision(scene: Node3D, spec: Dictionary) -> Dictionary:
	var physics := scene.get_world_3d().direct_space_state
	var points: Array = spec.path_xz
	var goal := Vector2(float(spec.goal_xz[0]), float(spec.goal_xz[1]))
	var checked := 0
	var deck_hits := 0
	var missing := 0
	var blockers := 0
	var previous_y := NAN
	var max_step := 0.0
	for i in range(points.size() - 1):
		var a := Vector2(float(points[i][0]), float(points[i][1]))
		var b := Vector2(float(points[i + 1][0]), float(points[i + 1][1]))
		var steps := maxi(1, int(ceil(a.distance_to(b) / 2.0)))
		for j in steps:
			var p := a.lerp(b, float(j) / steps)
			if p.distance_to(goal) < 3.0: continue
			var origin := Vector3(p.x, 20.0, p.y)
			var hit := physics.intersect_ray(PhysicsRayQueryParameters3D.create(origin, origin + Vector3.DOWN * 40.0))
			checked += 1
			if hit.is_empty():
				missing += 1
				continue
			var collider_name := str(hit.collider.name)
			if collider_name == "WalkableDeckCollision": deck_hits += 1
			elif collider_name != "TerrainCollision": blockers += 1
			var y := float(hit.position.y)
			if not is_nan(previous_y): max_step = maxf(max_step, absf(y - previous_y))
			previous_y = y
	return {"samples": checked, "bridge_deck_hits": deck_hits, "missing_hits": missing, "blocking_hits": blockers, "max_sampled_step_m": max_step, "pass": checked > 0 and deck_hits > 0 and missing == 0 and blockers == 0 and max_step < 0.8}

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
	report["camera_mode"] = "benchmark_fixed" if spec.bounds_m == [80, 80] else "anchor_following_scaled_overhead"
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
	var bridge_query := PhysicsRayQueryParameters3D.create(bridge_at + Vector3.UP * 10.0, bridge_at + Vector3.DOWN * 10.0)
	if not str(spec.crossing.get("asset_glb", "")).is_empty(): bridge_query.collision_mask = 1 << 19
	var bridge_hit := physics.intersect_ray(bridge_query)
	var bridge_collision_ok := not bridge_hit.is_empty() and str(bridge_hit.collider.name) == "WalkableDeckCollision"
	var spawn_xz: Array = spec.spawn_xz
	var spawn_at := Vector3(float(spawn_xz[0]), 0, float(spawn_xz[1]))
	var ground_hit := physics.intersect_ray(PhysicsRayQueryParameters3D.create(spawn_at + Vector3.UP * 10.0, spawn_at + Vector3.DOWN * 10.0))
	var ground_collision_ok := not ground_hit.is_empty() and str(ground_hit.collider.name) == "TerrainCollision"
	builder.metrics["bridge_collision_ok"] = bridge_collision_ok
	builder.metrics["spawn_ground_collision_ok"] = ground_collision_ok
	var expanded_world := absf(float(spec.bounds_m[0]) - 80.0) >= 0.01 or absf(float(spec.bounds_m[1]) - 80.0) >= 0.01
	if expanded_world:
		builder.metrics["route_physics"] = sample_route_collision(scene, spec)
	var landmark_collision_ok := true
	var landmark: Dictionary = spec.get("landmark", {})
	if not str(landmark.get("asset_glb", "")).is_empty():
		var landmark_pivot := scene.get_node_or_null("Landmark") as Node3D
		if landmark_pivot == null:
			landmark_collision_ok = false
		else:
			var landmark_at := landmark_pivot.global_position
			var landmark_query := PhysicsRayQueryParameters3D.create(landmark_at + Vector3.UP * 10.0, landmark_at + Vector3.DOWN * 10.0)
			landmark_query.collision_mask = 1 << 18
			var landmark_hit := physics.intersect_ray(landmark_query)
			landmark_collision_ok = not landmark_hit.is_empty() and str(landmark_hit.collider.name) == "LandmarkFallbackCollision"
		builder.metrics["landmark_collision_ok"] = landmark_collision_ok
	if not bridge_collision_ok or not ground_collision_ok or not landmark_collision_ok or (expanded_world and not bool(builder.metrics.route_physics.pass)):
		report["errors"] = ["Physical bridge, landmark, spawn ground, or expanded route check failed"]
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
		var camera_poses := {}
		for view in benchmark.get("evaluation_cameras", []):
			var pose := camera_pose(view, benchmark, spec)
			camera.position = pose.position
			camera.fov = float(view.get("fov_deg", 72))
			var target: Vector3 = pose.target
			camera_poses[str(view.id)] = {"position": [camera.position.x, camera.position.y, camera.position.z], "target": [target.x, target.y, target.z]}
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
		report["camera_poses"] = camera_poses
	report["render_s"] = (Time.get_ticks_msec() - render_start) / 1000.0
	report["elapsed_s"] = (Time.get_ticks_msec() - start_ms) / 1000.0
	write_json(out_dir.path_join("metrics.json"), report)
	print("WORLD_BUILD_COMPLETE ", spec.variant, " ", report.render_status, " ", scene_path)
	quit(0 if report.get("errors", []).is_empty() else 2)
