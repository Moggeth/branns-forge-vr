extends SceneTree
## Native, isolated TreeKit renderer comparison. No Main, saves, service or XR.
## Export the historical script first, for example:
##   git show 8eb84cb:godot/tree_kit.gd > work/orchard-tree-baseline.gd
## Run graphically with --xr-mode off --audio-driver Dummy and
##   -- --baseline-script=<absolute path> [--gpu-output=<absolute JSON path>]

const CurrentKit = preload("res://tree_kit.gd")
const SIZE := Vector2i(1200, 750)
const WARMUP_FRAMES := 30
const SAMPLE_FRAMES := 60

func _initialize() -> void:
	create_timer(55.0).timeout.connect(func() -> void:
		printerr("ORCHARD_TREE_GPU timeout=55")
		quit(2))
	call_deferred("_run")

func _run() -> void:
	if DisplayServer.get_name() == "headless":
		printerr("ORCHARD_TREE_GPU requires a native graphical renderer")
		quit(2)
		return
	var baseline_path := ""
	var output_path := ""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--baseline-script="): baseline_path = arg.trim_prefix("--baseline-script=")
		if arg.begins_with("--gpu-output="): output_path = arg.trim_prefix("--gpu-output=")
	if not baseline_path.is_absolute_path() or not FileAccess.file_exists(baseline_path):
		printerr("ORCHARD_TREE_GPU needs an existing absolute --baseline-script path")
		quit(2)
		return
	if output_path != "" and not output_path.is_absolute_path():
		printerr("ORCHARD_TREE_GPU --gpu-output must be absolute")
		quit(2)
		return
	var source := FileAccess.get_file_as_string(baseline_path)
	if not source.begins_with("class_name TreeKit") or source.find("\n") < 0:
		printerr("ORCHARD_TREE_GPU baseline is not the historical TreeKit source")
		quit(2)
		return
	# Avoid registering a second global TreeKit class. Only the class declaration
	# is removed; the rest of the historical source is compiled unchanged.
	var baseline := GDScript.new()
	baseline.source_code = source.substr(source.find("\n") + 1)
	if baseline.reload() != OK:
		printerr("ORCHARD_TREE_GPU could not compile the baseline script")
		quit(2)
		return
	Engine.max_fps = 0
	DisplayServer.window_set_vsync_mode(DisplayServer.VSYNC_DISABLED)
	root.unfocusable = true
	root.position = Vector2i(-12000, -12000)
	root.size = SIZE
	root.position = Vector2i(-12000, -12000)
	if not root.unfocusable or root.position.x > -1000 or not root.visible:
		printerr("ORCHARD_TREE_GPU diagnostic window is not visible, offscreen and unfocusable")
		quit(2)
		return
	var stage := Node3D.new()
	root.add_child(stage)
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color("c5d2d1")
	environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.environment.ambient_light_color = Color("b5bfac")
	stage.add_child(environment)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-48, -32, 0)
	sun.shadow_enabled = true
	stage.add_child(sun)
	var ground := MeshInstance3D.new()
	var plane := PlaneMesh.new()
	plane.size = Vector2(90, 80)
	ground.mesh = plane
	var ground_material := StandardMaterial3D.new()
	ground_material.albedo_color = Color("78895e")
	ground.material_override = ground_material
	stage.add_child(ground)
	var camera := Camera3D.new()
	camera.far = 180.0
	stage.add_child(camera)
	camera.current = true
	var placements := _placements()
	var rid := root.get_viewport_rid()
	RenderingServer.viewport_set_measure_render_time(rid, true)
	var results: Array[Dictionary] = []
	for lod in ["near", "far"]:
		if lod == "near":
			camera.position = Vector3(0, 2.8, 28)
			camera.look_at(Vector3(0, 2.8, -4))
		else:
			camera.position = Vector3(56, 31, 69)
			camera.look_at(Vector3(0, 2.5, -4))
		for version in ["baseline", "installed"]:
			var kit: Script = baseline if version == "baseline" else CurrentKit
			var grove: Node3D = kit.call("make_grove", placements, {"lod":lod,"variants":3,"shadows":false})
			stage.add_child(grove)
			if lod == "near": _dapple_shadows(grove, kit)
			# Shader compilation and instance upload happen before the sample window.
			for frame in WARMUP_FRAMES:
				await process_frame
				await RenderingServer.frame_post_draw
			var samples := await _sample(rid)
			# Readback is deliberately outside the timed window.
			var capture_path: String = output_path.get_basename() + "-" + version + "-" + lod + ".png" if output_path != "" else ""
			if capture_path != "" and root.get_texture().get_image().save_png(capture_path) != OK:
				printerr("ORCHARD_TREE_GPU cannot save capture: ", capture_path)
				quit(2)
				return
			results.append({"version":version,"lod":lod,"tree_count":placements.size(),
				"source_triangles":int(grove.get_meta("triangles",0)),
				"gpu_ms":_summary(samples.gpu),"render_cpu_ms":_summary(samples.render_cpu),
				"wall_frame_ms":_summary(samples.wall),"draw_calls":_summary(samples.draws),
				"capture":capture_path})
			grove.queue_free()
			await process_frame
	RenderingServer.viewport_set_measure_render_time(rid, false)
	var result := {"device":RenderingServer.get_video_adapter_name(),"renderer":RenderingServer.get_rendering_device().get_device_name() if RenderingServer.get_rendering_device() != null else "unknown",
		"resolution":"1200x750","warmup_frames":WARMUP_FRAMES,"sample_frames":SAMPLE_FRAMES,
		"baseline_source_sha256":FileAccess.get_sha256(baseline_path),"results":results,
		"scope":"Native desktop mono isolated 60-tree scene, identical camera/light/shadows per LOD. Wall frame includes engine scheduling; this is not the full Orchard, headset stereo, or VR frame time."}
	if output_path != "":
		var file := FileAccess.open(output_path, FileAccess.WRITE)
		if file == null:
			printerr("ORCHARD_TREE_GPU cannot write result: ", output_path)
			quit(2)
			return
		file.store_string(JSON.stringify(result, "  "))
		file.close()
	print("ORCHARD_TREE_GPU_RESULT ", JSON.stringify(result))
	quit()

func _placements() -> Array:
	var placements: Array = []
	for row in 6:
		for column in 10:
			var index := row * 10 + column
			placements.append({"species":"apple","position":Vector3((float(column)-4.5)*5.0,0,(float(row)-2.5)*6.0),
				"seed":1000+index*37,"scale":0.84+float(index%7)*0.055,"yaw":float(index%17)*0.37})
	return placements

func _dapple_shadows(grove: Node3D, kit: Script) -> void:
	for node in grove.get_children():
		if not node is MultiMeshInstance3D: continue
		var holder: MultiMeshInstance3D = node
		holder.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var shadow := MultiMeshInstance3D.new()
		shadow.name = holder.name + "Shadow"
		shadow.multimesh = holder.multimesh
		shadow.material_override = kit.call("shadow_material")
		shadow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
		grove.add_child(shadow)

func _sample(rid: RID) -> Dictionary:
	var gpu: Array[float] = []
	var render_cpu: Array[float] = []
	var wall: Array[float] = []
	var draws: Array[float] = []
	var previous := Time.get_ticks_usec()
	for frame in SAMPLE_FRAMES:
		await process_frame
		var now := Time.get_ticks_usec()
		await RenderingServer.frame_post_draw
		var gpu_ms := RenderingServer.viewport_get_measured_render_time_gpu(rid)
		if gpu_ms > 0.0: gpu.append(gpu_ms)
		var cpu_ms := RenderingServer.viewport_get_measured_render_time_cpu(rid)
		if cpu_ms > 0.0: render_cpu.append(cpu_ms)
		wall.append(float(now - previous) / 1000.0)
		draws.append(float(RenderingServer.viewport_get_render_info(rid,
			RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE,
			RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME)))
		previous = now
	return {"gpu":gpu,"render_cpu":render_cpu,"wall":wall,"draws":draws}

func _summary(values: Array[float]) -> Dictionary:
	if values.is_empty(): return {"samples":0}
	values.sort()
	return {"samples":values.size(),"median":snappedf(values[values.size()/2],0.001),
		"p95":snappedf(values[mini(values.size()-1,int(ceil(float(values.size())*0.95))-1)],0.001)}
