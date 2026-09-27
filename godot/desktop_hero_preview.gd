extends RefCounted
## Isolated, offline actual-frame review. Never connects to or restarts a live session.

static func run(game,tool:String):
	if game.vr: game.get_tree().quit(2); return
	var output=""
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--preview-output="): output=argument.trim_prefix("--preview-output=")
	if output.is_empty(): game.get_tree().quit(2); return
	game.get_window().size=Vector2i(1600,900)
	if tool=="axe":
		var axe=game.adventure._tool_model("woodland_axe")
		game.add_child(axe)
		game.grips._attach(game.desktop_hand,axe)
	elif tool=="crossbow":
		var item=preload("res://siegebird_checks.gd").load_sample(game)
		if item==null: game.get_tree().quit(2); return
		game.grips._attach(game.desktop_hand,item)
	else: game.get_tree().quit(2); return
	if OS.get_cmdline_user_args().has("--preview-help"): game.desktop_help_panel.visible=true
	if OS.get_cmdline_user_args().has("--preview-fullscreen-check"):
		var previous=game.get_window().mode
		var toggle=InputEventKey.new()
		toggle.physical_keycode=KEY_F11
		toggle.pressed=true
		game._unhandled_input(toggle)
		if game.get_window().mode!=Window.MODE_FULLSCREEN:
			push_error("F11 did not enter actual fullscreen")
			game.get_tree().quit(3); return
		game._unhandled_input(toggle)
		if game.get_window().mode!=previous:
			push_error("F11 did not restore the previous window mode")
			game.get_tree().quit(3); return
		print("DESKTOP_FULLSCREEN_CHECK passed")
	await game.get_tree().create_timer(0.65).timeout
	await RenderingServer.frame_post_draw
	var result=game.get_viewport().get_texture().get_image().save_png(output)
	print("DESKTOP_HERO_PREVIEW ",tool," ",output," result=",result)
	game.get_tree().quit(0 if result==OK else 1)
