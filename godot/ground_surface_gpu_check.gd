extends SceneTree
## Same-camera Mobile renderer check for the legacy and shared Forge floor.
## No game scene, service, XR, save, or inventory is loaded.
const Palette = preload("res://ground_surface_palette.gd")
const Forge = preload("res://forge_materials.gd")

func _initialize() -> void:
	if DisplayServer.get_name() == "headless":
		push_error("GROUND_SURFACE_GPU_CHECK needs a graphical renderer")
		quit(1)
		return
	root.set_flag(Window.FLAG_NO_FOCUS,true)
	root.size = Vector2i(800,500)
	root.position = Vector2i(4000,4000)
	call_deferred("_run")

func _run() -> void:
	var output := ProjectSettings.globalize_path("res://../outputs/ground-surface-check")
	DirAccess.make_dir_recursive_absolute(output)
	var stage := Node3D.new()
	root.add_child(stage)
	var world := WorldEnvironment.new()
	world.environment = Environment.new()
	world.environment.background_mode = Environment.BG_COLOR
	world.environment.background_color = Color("8eb4ce")
	world.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	world.environment.ambient_light_color = Color("d9e0d3")
	world.environment.ambient_light_energy = 0.45
	stage.add_child(world)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-58,-35,0)
	light.light_energy = 1.2
	stage.add_child(light)
	var floor := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(20,0.46,20)
	floor.mesh = mesh
	floor.position.y = -0.23
	stage.add_child(floor)
	var camera := Camera3D.new()
	camera.position = Vector3(3,2.3,7)
	stage.add_child(camera)
	camera.look_at(Vector3(0,0,-1.2))
	camera.current = true
	var records := []
	for key in ["legacy","shared"]:
		floor.material_override = Forge.material("grass","c8d2ad") if key == "legacy" else Palette.material("forge_yard")
		for frame in 8: await process_frame
		await RenderingServer.frame_post_draw
		var stats := {"style":key,
			"draw_calls":roundi(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
			"objects":roundi(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME))}
		var image := root.get_texture().get_image()
		stats["save_error"] = image.save_png(output.path_join(key+".png"))
		records.append(stats)
	print("GROUND_SURFACE_GPU_RESULT ",JSON.stringify(records))
	quit(0 if records.all(func(record: Dictionary) -> bool: return record.save_error == OK and record.draw_calls > 0) else 1)
