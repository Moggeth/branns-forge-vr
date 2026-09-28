extends SceneTree
## Graphical offline capture of the live shared-world Window; no user save writes.

func _initialize() -> void:
	call_deferred("_capture")

func _capture() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	var builder: Node = game.world_builder
	builder.carve_path(Vector3(0, 0, -24), Vector3(18, 0, -43))
	builder.data.wood = 3
	builder.place_bridge(builder.CROSSING)
	builder.plant_grove(Vector3(46, 0, -61))
	var view: Window = game.world_builder_view
	if not is_instance_valid(view): push_error("WORLD_BUILDER_CAPTURE no view"); quit(1); return
	await create_timer(2.5).timeout
	await RenderingServer.frame_post_draw
	var shot: Image = view.get_texture().get_image()
	var path := "res://../outputs/world-builder-live.png"
	var result := shot.save_png(path)
	print("WORLD_BUILDER_CAPTURE result=", result, " size=", shot.get_size(), " world_shared=", view.tactical_viewport.world_3d == game.get_world_3d())
	var ground_view := SubViewport.new()
	ground_view.size = Vector2i(1280, 720)
	ground_view.world_3d = game.get_world_3d()
	ground_view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(ground_view)
	var ground_camera := Camera3D.new()
	ground_view.add_child(ground_camera)
	ground_camera.global_position = builder.center + Vector3(25, 1.8, -38)
	ground_camera.look_at(builder.center + builder.CROSSING + Vector3(0, 1.1, 0), Vector3.UP)
	ground_camera.current = true
	await create_timer(1.0).timeout
	await RenderingServer.frame_post_draw
	var ground_shot: Image = ground_view.get_texture().get_image()
	var ground_result := ground_shot.save_png("res://../outputs/world-builder-ground.png")
	print("WORLD_BUILDER_GROUND_CAPTURE result=", ground_result, " size=", ground_shot.get_size())
	ground_camera.global_position = builder.center + builder.CAMP + Vector3(0, 1.7, 5.0)
	ground_camera.look_at(builder.center + builder.CAMP + Vector3(0, 1.0, 0), Vector3.UP)
	await create_timer(0.5).timeout
	await RenderingServer.frame_post_draw
	var camp_result := ground_view.get_texture().get_image().save_png("res://../outputs/world-builder-camp.png")
	print("WORLD_BUILDER_CAMP_CAPTURE result=", camp_result)
	quit(0 if result == OK and ground_result == OK and camp_result == OK else 1)
