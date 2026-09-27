extends RefCounted

static func run(game, output_path: String):
	var id = game.wyrmspout.ITEM_ID
	var until = Time.get_ticks_msec() + 12000
	while not game.imported.has(id) and Time.get_ticks_msec() < until:
		await game.get_tree().create_timer(0.1).timeout
	if not game.imported.has(id):
		print("WYRM_CAPTURE FAIL version 2 did not import")
		game.get_tree().quit(1)
		return
	var weapon: Node3D = game.imported[id]
	# Existing collection pieces are revealed serially at the anvil first.
	until = Time.get_ticks_msec() + 24000
	while not weapon.get_meta("delivery_ready", false) and Time.get_ticks_msec() < until:
		await game.get_tree().create_timer(0.1).timeout
	if not weapon.get_meta("delivery_ready", false):
		print("WYRM_CAPTURE FAIL version 2 was not delivered")
		game.get_tree().quit(1)
		return
	game.adventure.travel("sandstone_quarry")
	if game.weather != null:
		game.weather.engine.hour = 13.0
		game.weather.engine.cycle = false
		game.weather.engine.automatic = false
		game.weather.engine.set_weather("clear")
	game.rig.global_position = Vector3(0, 0, 0)
	var framing = game.scene.zones["sandstone_quarry"]
	# Clear the foreground ore cart so the moving stream, not a nearby prop,
	# determines the captured flame length.
	game.camera.global_position = framing.center + Vector3(0, 1.8, 7.0)
	game.camera.look_at(framing.center + Vector3(0, 1.25, -5.0), Vector3.UP)
	game.grips._attach(game.desktop_hand, weapon)
	game._set_collisions(weapon, false)
	var record = game.wyrmspout.records[weapon.get_instance_id()]
	record.heat = 0.63
	game.wyrmspout.diagnostic_force_trigger = true
	game.wyrmspout.start(game.desktop_hand)
	await game.get_tree().create_timer(0.7).timeout
	print("WYRM_CAPTURE_STREAM packets=",record.drops.size()," muzzle=",record.muzzle.global_position)
	if OS.get_cmdline_user_args().has("--wyrmspout-side"):
		var observer=Camera3D.new(); game.add_child(observer)
		observer.global_position=record.muzzle.global_position+Vector3(2.6,0.8,-2.5)
		observer.look_at(record.muzzle.global_position+Vector3(0,-0.45,-2.9))
		observer.fov=65; observer.current=true
		await game.get_tree().create_timer(0.15).timeout
	await RenderingServer.frame_post_draw
	var image = game.get_viewport().get_texture().get_image()
	DirAccess.make_dir_recursive_absolute(output_path.get_base_dir())
	var error = image.save_png(output_path)
	print("WYRM_CAPTURE ", "PASS " + output_path if error == OK else "FAIL " + str(error))
	game.get_tree().quit(0 if error == OK else 1)
