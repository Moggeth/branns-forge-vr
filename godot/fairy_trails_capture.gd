extends SceneTree
func _initialize(): run.call_deferred()
func run():
	Engine.max_fps=120
	var game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true; game._start_fairy()
	var fairy=game.fairy; fairy.test_mode=true; fairy._focus_lost(); fairy.window.hide(); game.hud.get_parent().hide()
	var folder=ProjectSettings.globalize_path("user://reviews/fairy-trails")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture-output="): folder=arg.trim_prefix("--capture-output=")
	DirAccess.make_dir_recursive_absolute(folder)
	for zone in game.fairy_trails.ZONES:
		game.adventure.travel(zone); var center=game.fairy_trails.rooms[zone].global_position
		fairy.avatar.global_position=center+Vector3(0,1.35,1); fairy.art.basis=Basis.IDENTITY
		for frame in range(30):
			game.elapsed+=.05; game.fairy_trails.tick(.05); fairy.art.animate(.05,0,false)
		if zone=="starlace_archive":
			fairy.avatar.global_position=game.fairy_trails.seals[1].node.global_position+Vector3(0,0,1); game.fairy_trails.pulse(fairy)
		game.camera.global_position=center+Vector3(3,2.3,6); game.camera.look_at(center+Vector3(0,1,-2))
		for frame in range(20): await process_frame
		await RenderingServer.frame_post_draw
		root.get_texture().get_image().save_png(folder+"/"+zone+".png")
	print("FAIRY_TRAILS_CAPTURE_RESULT screenshots=3"); quit()
