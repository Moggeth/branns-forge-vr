extends SceneTree
## Captures the actual shared 3D world, not illustrative mockups.
## Run graphically with --world-builder-preview to protect player saves.

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview"):
		push_error("Gallery requires an offline preview world")
		quit(1)
		return
	call_deferred("_run")

func _run() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	game.adventure.hp = 9999.0
	game.adventure.travel("orchard_highlands")
	game._open_world_builder_view()
	var view: Window = game.world_builder_view
	var builder: Node = game.world_builder
	var land: Node = game.landscape
	if view == null or builder == null or land == null:
		push_error("No shared tactical world to capture")
		quit(1)
		return
	view.tactical_viewport.size = Vector2i(1400, 900)
	view.refresh_limit = 0
	var output := ProjectSettings.globalize_path("res://../docs/images/terraforming")
	DirAccess.make_dir_recursive_absolute(output)
	var errors: Array[String] = []
	builder.data.mana = 20.0
	var result: String = builder.cast_sunder(Vector3(-69,0,-5), Vector3(-24,0,-5))
	if result != "": errors.append("sunder " + result)
	else:
		land._finish_transition()
		await _capture(view, builder.center + Vector3(-45,0,-5), 49.0, output.path_join("01-sunder.jpg"))
	builder.data.mana = 20.0
	result = builder.cast_wall(Vector3(-66,0,42), Vector3(-26,0,42))
	if result != "": errors.append("wall " + result)
	else:
		land._finish_transition()
		await _capture(view, builder.center + Vector3(-46,0,42), 47.0, output.path_join("02-earthen-wall.jpg"))
	builder.data.mana = 20.0
	await _capture(view, builder.center + Vector3(58,0,-73), 67.0, output.path_join("03-before-tree-ring.jpg"))
	result = builder.cast_tree_ring(Vector3(58,0,-73))
	if result != "": errors.append("ring " + result)
	else:
		builder.tick(2.5)
		await _capture(view, builder.center + Vector3(58,0,-73), 67.0, output.path_join("03-tree-ring.jpg"))
	builder.data.mana = 20.0
	result = builder.cast_meteor(Vector3(-20,0,75))
	if result != "": errors.append("starfall " + result)
	else:
		var meteor = builder.meteor_nodes.values()[-1]
		meteor.advance(0.72)
		await _capture(view, builder.center + Vector3(-20,0,75), 51.0, output.path_join("04-starfall.jpg"))
		meteor.advance(0.6)
		land._finish_transition()
		await create_timer(0.7).timeout
		await _capture(view, builder.center + Vector3(-20,0,75), 45.0, output.path_join("05-meteorite.jpg"))
		await _capture(view, builder.center + Vector3(-20,0,75), 29.0, output.path_join("05-meteorite-close.jpg"))
		for i in 2:
			builder.mine_meteor(meteor.collider, meteor.gems[0].global_position, "quarry_pick", 3.0)
	builder.data.mana = 20.0
	result = builder.cast_prism_fault(Vector3(6,0,75), Vector3(46,0,75))
	if result != "": errors.append("fault " + result)
	else:
		land._finish_transition()
		await _capture(view, builder.center + Vector3(26,0,75), 45.0, output.path_join("06-crystal-fault.jpg"))
	print("LANDSCAPE_SPELL_GALLERY errors=", errors, " directory=", output)
	quit(0 if errors.is_empty() else 1)

func _capture(view: Window, focus: Vector3, distance: float, path: String) -> void:
	view.focus_point = focus
	view.yaw = 0.64
	view.pitch = 0.62 if path.ends_with("-close.jpg") else 0.84
	view.zoom = distance * 0.88
	view._position_camera()
	view.tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	for i in 5: await process_frame
	await RenderingServer.frame_post_draw
	var image: Image = view.tactical_viewport.get_texture().get_image()
	var error: Error = image.save_jpg(path, 0.89)
	if error != OK: push_error("Could not save spell view: " + path + " code=" + str(error))
	view.tactical_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
