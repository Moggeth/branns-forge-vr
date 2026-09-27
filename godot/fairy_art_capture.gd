extends SceneTree
## Fast, isolated Mobile-renderer art review. No game state or service calls.
## Godot --path godot --xr-mode off --rendering-method mobile --script res://fairy_art_capture.gd -- --capture-output=<folder>

func _initialize() -> void:
	_capture.call_deferred()

func _capture() -> void:
	var folder := ProjectSettings.globalize_path("user://reviews/fairy-art")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture-output="):
			folder = arg.trim_prefix("--capture-output=")
	DirAccess.make_dir_recursive_absolute(folder)

	var stage := Node3D.new()
	root.add_child(stage)
	var world := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("182b43")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("a9c7e0")
	environment.ambient_light_energy = 0.65
	world.environment = environment
	stage.add_child(world)
	var sun := DirectionalLight3D.new()
	sun.light_color = Color("e1f1ff")
	sun.light_energy = 0.65
	sun.rotation_degrees = Vector3(-30, -35, 0)
	stage.add_child(sun)

	var fairy := preload("res://fairy_art.gd").new()
	stage.add_child(fairy)
	fairy.setup()
	var camera := Camera3D.new()
	camera.fov = 55
	stage.add_child(camera)
	camera.make_current()
	var poses := {
		"front": Vector3(0, 0.07, -0.68),
		"side": Vector3(0.68, 0.07, -0.13),
		"back": Vector3(0, 0.07, 0.68),
	}
	for name in poses:
		camera.position = poses[name]
		camera.look_at(Vector3(0, 0.025, 0))
		for i in range(12):
			fairy.animate(1.0 / 60.0, 0.0, true)
			await process_frame
		await RenderingServer.frame_post_draw
		var target := folder.path_join(name + ".png")
		var error := root.get_texture().get_image().save_png(target)
		if error != OK:
			push_error("FAIRY_ART_CAPTURE failed " + target + " error=" + str(error))
			quit(2)
			return
		print("FAIRY_ART_CAPTURE ", target)
	quit()
