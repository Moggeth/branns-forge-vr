extends SceneTree
## Graphical-only preview of the actual local Director window. Does not start a round.

func _initialize() -> void:
	call_deferred("_capture")

func _capture() -> void:
	var game = load("res://main.tscn").instantiate()
	root.add_child(game)
	await create_timer(3.0).timeout
	var view = game.director_local_view
	if not is_instance_valid(view):
		push_error("DIRECTOR_LOCAL_CAPTURE no native window")
		quit(1)
		return
	await RenderingServer.frame_post_draw
	var image: Image = view.get_texture().get_image()
	var destination = "res://../outputs/director-local-live.png"
	var result = image.save_png(destination)
	print("DIRECTOR_LOCAL_CAPTURE result=", result, " size=", image.get_size(), " world_shared=", view.tactical_viewport.world_3d == game.get_world_3d())
	quit(0 if result == OK else 1)
