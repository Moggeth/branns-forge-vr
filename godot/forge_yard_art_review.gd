extends SceneTree
## Real-game save-isolated views of the forge approach and new side dressing.

const OUTPUT := "res://../outputs/forge-yard-review"

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview") or DisplayServer.get_name() == "headless":
		push_error("FORGE_YARD_ART_REVIEW requires graphical --world-builder-preview")
		quit(1)
		return
	call_deferred("_run")

func _run() -> void:
	var output := ProjectSettings.globalize_path(OUTPUT)
	DirAccess.make_dir_recursive_absolute(output)
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	if not game.diagnostic_offline:
		push_error("FORGE_YARD_ART_REVIEW needs an isolated game")
		quit(1)
		return
	game.adventure.travel("forge_yard")
	await process_frame
	var view := SubViewport.new()
	view.size = Vector2i(1200, 750)
	view.world_3d = game.get_world_3d()
	view.msaa_3d = Viewport.MSAA_2X
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(view)
	var camera := Camera3D.new()
	camera.fov = 70.0
	camera.far = 250.0
	view.add_child(camera)
	camera.current = true
	var failures: Array[String] = []
	for frame in [
		{"name":"portal_approach", "eye":Vector3(0,1.7,3), "target":Vector3(0,2.0,15)},
		{"name":"side_garden", "eye":Vector3(11,1.7,4), "target":Vector3(9,1.2,-4)},
	]:
		camera.global_position = frame.eye
		camera.look_at(frame.target, Vector3.UP)
		for tick in 6: await process_frame
		await RenderingServer.frame_post_draw
		if view.get_texture().get_image().save_png(output.path_join(frame.name + ".png")) != OK:
			failures.append(frame.name)
	print("FORGE_YARD_ART_REVIEW ", JSON.stringify({"views":2,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
