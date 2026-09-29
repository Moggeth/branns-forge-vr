extends RefCounted
## Isolated, offline actual-frame review. Never connects to or restarts a live session.

static func run(game,tool:String):
	if game.vr: game.get_tree().quit(2); return
	var output=""
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--preview-output="): output=argument.trim_prefix("--preview-output=")
	if output.is_empty(): game.get_tree().quit(2); return
	game.get_window().size=Vector2i(1600,900)
	if tool=="bow":
		if not game.archery.equip(game.desktop_hand): game.get_tree().quit(2); return
		if OS.get_cmdline_user_args().has("--preview-bow-flight"):
			game.set_process(false)
			game.adventure.travel("orchard_highlands")
			game.camera.global_position+=Vector3.UP*18
			game.camera.global_basis=Basis.IDENTITY
			game.archery.desktop_press()
			game.archery.nocked.draw=0.6
			game.archery.begin_curve(); game.archery.curve_state.curve=Vector3.UP*0.8
			game.archery.fire()
			game.archery._tick_shots(0.24)
			if game.archery.shots.is_empty(): game.get_tree().quit(3); return
			var shot=game.archery.shots[0]
			var subject:Vector3=shot.node.to_global(Vector3(0,0,-0.36))
			var observer=Camera3D.new(); game.add_child(observer)
			observer.global_position=subject+Vector3(0.6,0.2,0.75)
			observer.look_at(subject); observer.fov=45; observer.current=true
		if OS.get_cmdline_user_args().has("--preview-bow-draw"):
			var hand=Node3D.new(); game.add_child(hand)
			hand.global_position=game.archery.rest.global_position+game.archery.bow.global_basis.z*0.50
			var arrow=game.archery.arrow_scene.instantiate(); hand.add_child(arrow)
			game.archery.nocked={"node":arrow,"hand":hand,"draw":0.5,"desktop":false}
			if OS.get_cmdline_user_args().has("--preview-alternate"):
				game.archery.begin_curve()
				game.archery.curve_state.basis=game.archery.bow.global_basis*Basis(Vector3.UP,-0.32)
	elif tool=="axe":
		var axe=game.adventure._tool_model("woodland_axe")
		game.add_child(axe)
		game.grips._attach(game.desktop_hand,axe)
	elif tool=="crossbow":
		var item=preload("res://siegebird_checks.gd").load_sample(game)
		if item==null: game.get_tree().quit(2); return
		game.grips._attach(game.desktop_hand,item)
	elif game.adventure.TOOL_NAMES.has(tool):
		var item=game.adventure._tool_model(tool)
		game.add_child(item)
		game.grips._attach(game.desktop_hand,item)
	else: game.get_tree().quit(2); return
	if OS.get_cmdline_user_args().has("--preview-alternate") and tool!="bow":
		game.item_actions.trigger(game.desktop_hand,game.desktop_hand)
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
