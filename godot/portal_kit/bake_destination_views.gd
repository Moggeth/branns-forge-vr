extends SceneTree
## Bake each actual destination into a small texture. Gates never render a second world per eye.

func _initialize() -> void:
	if DisplayServer.get_name() == "headless" or not OS.get_cmdline_user_args().has("--world-builder-preview"):
		push_error("Portal baking requires a graphical, offline --world-builder-preview")
		quit(1)
		return
	call_deferred("_bake")

func _bake() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	for i in 4: await physics_frame
	if not game.diagnostic_offline:
		quit(1)
		return
	game.rig.hide()
	game.player_avatar.hide()
	var view := SubViewport.new()
	view.size = Vector2i(448, 512)
	view.world_3d = game.get_world_3d()
	view.msaa_3d = Viewport.MSAA_2X
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(view)
	var camera := Camera3D.new()
	camera.fov = 74.0
	view.add_child(camera)
	camera.current = true
	for node in game.find_children("*","Label3D",true,false): node.hide()
	var output := ProjectSettings.globalize_path("res://portal_kit/views")
	DirAccess.make_dir_recursive_absolute(output)
	var failures: Array[String] = []
	for id in preload("res://portal_kit/portal_kit.gd").ZONES:
		await game.adventure.travel(id)
		var zone: Dictionary = game.scene.zones[id]
		camera.global_position = zone.capture_position
		camera.look_at(zone.capture_target, Vector3.UP)
		game.camera.global_transform = camera.global_transform
		for i in 6: await process_frame
		await RenderingServer.frame_post_draw
		var shot := view.get_texture().get_image()
		shot.convert(Image.FORMAT_RGB8)
		if shot.save_webp(output.path_join(id + ".webp"), true, 0.89) != OK: failures.append(id)
	print("PORTAL_VIEWS_BAKED ", JSON.stringify({"destinations":12,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
