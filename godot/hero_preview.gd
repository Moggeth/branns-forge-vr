extends SceneTree
## Real Mobile-renderer asset capture. No service, XR, inventory or microphone.
func _initialize():
	call_deferred("capture")

func capture():
	var stage=Node3D.new()
	root.add_child(stage)
	var env=WorldEnvironment.new()
	env.environment=Environment.new()
	env.environment.background_mode=Environment.BG_COLOR
	env.environment.background_color=Color("101622")
	env.environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color=Color("adbad6")
	env.environment.ambient_light_energy=0.65
	env.environment.tonemap_mode=Environment.TONE_MAPPER_FILMIC
	stage.add_child(env)
	var object=Node3D.new()
	stage.add_child(object)
	if OS.get_cmdline_user_args().has("--axe"): preload("res://hero_axe.gd").new().build(object)
	else: preload("res://hero_hammer.gd").new().build(object)
	var triangles=0
	for child in object.get_children():
		if child is MeshInstance3D: triangles+=child.mesh.get_faces().size()/3
	var angle=0.0
	var output=""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--output="): output=arg.trim_prefix("--output=")
		if arg.begins_with("--angle="): angle=float(arg.trim_prefix("--angle="))
	object.rotation.y=deg_to_rad(angle)
	for spec in [[Vector3(-1,1.5,1.3),Color("ffe3bf"),3.0],[Vector3(1,0.9,-0.8),Color("9bc6ff"),4.0],[Vector3(0,0.3,1.5),Color("d6acff"),0.8]]:
		var light=OmniLight3D.new()
		light.position=spec[0]
		light.light_color=spec[1]
		light.light_energy=spec[2]
		light.omni_range=4
		stage.add_child(light)
	var camera=Camera3D.new()
	stage.add_child(camera)
	camera.position=Vector3(0.8,0.65,1.55)
	camera.look_at(Vector3(0,0.4 if OS.get_cmdline_user_args().has("--axe") else 0.35,0))
	camera.fov=34
	camera.current=true
	await create_timer(2).timeout
	await process_frame
	var result=root.get_texture().get_image().save_png(output)
	print("HERO_CAPTURE result=",result," triangles=",triangles," draw_calls=",Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	quit(result)
