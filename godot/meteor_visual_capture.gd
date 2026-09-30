extends SceneTree
## Actual GPU view of the generated shell from three player-relevant angles.
## Output is ignored under outputs/meteor-contact; no game or save is loaded.

const Meteor = preload("res://landscape_meteor.gd")

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview"):
		push_error("Meteor capture requires --world-builder-preview")
		quit(1)
		return
	call_deferred("_run")

func _run() -> void:
	var output := ProjectSettings.globalize_path("res://../outputs/meteor-contact")
	DirAccess.make_dir_recursive_absolute(output)
	var viewport := SubViewport.new()
	viewport.size = Vector2i(900,600)
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(viewport)
	var stage := Node3D.new()
	viewport.add_child(stage)
	var environment := WorldEnvironment.new()
	environment.environment = Environment.new()
	environment.environment.background_mode = Environment.BG_COLOR
	environment.environment.background_color = Color("202938")
	environment.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.environment.ambient_light_color = Color("91a0b3")
	environment.environment.ambient_light_energy = 0.6
	stage.add_child(environment)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-45,-35,0)
	light.light_energy = 1.6
	stage.add_child(light)
	var meteor := Meteor.new()
	stage.add_child(meteor)
	meteor.setup(Meteor.make_record(Vector2.ZERO,421,0.0),false)
	var camera := Camera3D.new()
	camera.fov = 54.0
	stage.add_child(camera)
	camera.current = true
	var views := {"near":Vector3(0.0,1.45,5.0),
		"side":Vector3(5.0,1.15,0.0),
		"high":Vector3(0.0,4.1,4.0)}
	var failures: Array[String] = []
	for label in views:
		camera.position = views[label]
		camera.look_at(meteor.core.global_position,Vector3.UP)
		for i in 4: await process_frame
		await RenderingServer.frame_post_draw
		var image: Image = viewport.get_texture().get_image()
		var path: String = output.path_join("meteor-%s.png" % label)
		if image.save_png(path) != OK: failures.append("save " + label)
	for x in [-0.6,-0.2,0.2,0.6]:
		var query := PhysicsRayQueryParameters3D.create(Vector3(x,0.8,4.0),Vector3(x,0.8,0.0))
		var hit: Dictionary = meteor.get_world_3d().direct_space_state.intersect_ray(query)
		if hit.get("collider") != meteor.collider:
			failures.append("mined capture missed surface")
			continue
		meteor.strike(hit.position,"quarry_pick",1.0,hit.normal)
	camera.position = views.near
	camera.look_at(meteor.core.global_position,Vector3.UP)
	for i in 4: await process_frame
	await RenderingServer.frame_post_draw
	if viewport.get_texture().get_image().save_png(output.path_join("meteor-mined.png")) != OK:
		failures.append("save mined")
	print("METEOR_VISUAL_CAPTURE ",failures," directory=",output)
	quit(0 if failures.is_empty() else 1)
