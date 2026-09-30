extends SceneTree
## Graphical window check; requires --world-builder-check to enter the orchard offline.

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	game.camera.global_position = game.world_builder.center + Vector3(16, 2, -20)
	game.camera.look_at(game.world_builder.center + Vector3(19, 0, -39))
	var original_embed := root.gui_embed_subwindows
	var original_game_mode := game.get_window().mode
	var view: Window = load("res://world_builder_view.gd").new()
	view.visible = false
	game.add_child(view)
	game.world_builder_view = view
	view.setup(game, game.world_builder)
	if view.arrival_elapsed != 0.0 or view.camera.global_position.distance_to(game.camera.global_position) > 0.05:
		failures.append("desktop survey did not begin at the Hero camera")
	if view.overlay.modulate.a > 0.05:
		failures.append("survey controls did not fade in with the camera")
	view._advance_arrival(0.08)
	var interrupted_pose: Transform3D = view.camera.global_transform
	view.zoom = clampf(view.zoom - 6.0, 28.0, 185.0)
	view._position_camera()
	if view.camera.global_transform.origin.distance_to(interrupted_pose.origin) > 0.05 or view.arrival_elapsed != 0.0:
		failures.append("zoom during survey arrival snapped the camera")
	if view.arrival_to.origin.distance_to(interrupted_pose.origin) < 0.05:
		failures.append("zoom during survey arrival did not retarget the camera")
	if view.tactical_viewport.world_3d != game.get_world_3d():
		failures.append("desktop survey lost the live Hero world")
	if view.hero_pip.picture.texture != game.get_viewport().get_texture():
		failures.append("Hero inset is not the actual existing Hero viewport")
	if view.hero_pip.get_children().filter(func(n: Node) -> bool: return n is SubViewport or n is Camera3D).size() != 0:
		failures.append("Hero inset created an unnecessary renderer or camera")
	if view.refresh_limit != 120 or view.fps_button.selected != 2:
		failures.append("desktop survey does not default to a 120 fps redraw target")
	if view.hero_hud_layer != null and view.hero_hud_layer.visible:
		failures.append("screen-space FPS HUD obscures the live Hero inset")
	await create_timer(0.7).timeout
	if view.arrival_elapsed < view.ARRIVAL_SECONDS or view.camera.global_position.distance_to(view.arrival_to.origin) > 0.05:
		failures.append("survey camera did not settle promptly over the orchard")
	if game.get_window().mode != original_game_mode:
		failures.append("opening the survey changed the Hero window mode")
	var desktop_size := view.size
	var desktop_mode := view.mode
	if desktop_mode != Window.MODE_FULLSCREEN: failures.append("desktop survey did not open fullscreen")
	if view.tactical_viewport.size != Vector2i(roundi(desktop_size.x * view.render_scale), roundi(desktop_size.y * view.render_scale)):
		failures.append("tactical viewport did not follow fullscreen size")
	var shot: Image = view.get_texture().get_image()
	var shot_path := "res://../outputs/world-builder-presentation.png"
	if shot.save_png(shot_path) != OK: failures.append("could not save desktop survey capture")
	if view.ui_scale < 1.5: failures.append("fullscreen controls did not scale for high resolution")
	var f11 := InputEventKey.new()
	f11.keycode = KEY_F11
	f11.pressed = true
	view._input(f11)
	await create_timer(0.2).timeout
	if view.mode != Window.MODE_WINDOWED or view.size != view.WINDOWED_SIZE:
		failures.append("F11 did not restore the windowed survey")
	if view.unresizable: failures.append("survey window cannot be resized")
	view.size = Vector2i(1100, 700)
	await create_timer(0.2).timeout
	if view.tactical_viewport.size != Vector2i(roundi(1100 * view.render_scale), roundi(700 * view.render_scale)):
		failures.append("tactical viewport did not resize with window")
	var f9 := InputEventKey.new()
	f9.keycode = KEY_F9
	f9.pressed = true
	view._input(f9)
	await process_frame
	if not is_instance_valid(view) or not view.hero_primary:
		failures.append("F9 did not make Hero primary while keeping RTS visible")
	else:
		if view.world_picture.texture != game.get_viewport().get_texture() or view.hero_pip.picture.texture != view.tactical_viewport.get_texture():
			failures.append("swap did not display both live perspectives")
		view._input(f9)
		if view.hero_primary: failures.append("second F9 did not restore RTS primary")
		view.close()
		if not view.returning_to_hero: failures.append("explicit close did not start Hero return")
		var return_from: Transform3D = view.camera.global_transform
		var return_to: Transform3D = game.camera.global_transform
		if return_from.origin.distance_to(return_to.origin) < 1.0:
			failures.append("return check started too near the Hero")
		view._advance_arrival(0.12)
		var return_mid: Transform3D = view.camera.global_transform
		if return_mid.origin.distance_to(return_from.origin) < 0.05 or return_mid.origin.distance_to(return_to.origin) < 0.05:
			failures.append("return camera did not move between survey and Hero")
		if view.overlay.modulate.a >= view.return_overlay_from_alpha:
			failures.append("survey controls did not fade during return")
		view._advance_arrival(view.ARRIVAL_SECONDS)
		await process_frame
		if is_instance_valid(view): failures.append("F9 did not finish the return to the Hero")
	if root.gui_embed_subwindows != original_embed: failures.append("subwindow preference was not restored")
	var quick_return: Window = load("res://world_builder_view.gd").new()
	quick_return.visible = false
	game.add_child(quick_return)
	game.world_builder_view = quick_return
	quick_return.setup(game, game.world_builder)
	quick_return.hero_mouse_was_captured = true
	await process_frame
	var early_pose: Transform3D = quick_return.camera.global_transform
	quick_return.close()
	if not quick_return.returning_to_hero or quick_return.camera.global_transform.origin.distance_to(early_pose.origin) > 0.05:
		failures.append("close during arrival snapped instead of reversing the camera")
	quick_return._advance_arrival(quick_return.ARRIVAL_SECONDS)
	await process_frame
	if is_instance_valid(quick_return): failures.append("close during arrival did not finish the return")
	if not game.desktop_look.captured: failures.append("return did not restore captured Hero mouse input")
	game.desktop_look.release_capture()
	if game.get_window().mode != original_game_mode: failures.append("return changed the Hero window mode")
	game.vr = true
	var companion: Window = load("res://world_builder_view.gd").new()
	companion.visible = false
	game.add_child(companion)
	companion.setup(game, game.world_builder)
	await create_timer(0.2).timeout
	if companion.mode != Window.MODE_WINDOWED or not companion.companion_mode:
		failures.append("VR companion did not remain windowed")
	if companion.tactical_viewport.world_3d != game.get_world_3d():
		failures.append("VR companion lost the live Hero world")
	var escape := InputEventKey.new()
	escape.keycode = KEY_ESCAPE
	escape.pressed = true
	companion._input(escape)
	await process_frame
	if is_instance_valid(companion): failures.append("Escape did not close the VR companion")
	if root.gui_embed_subwindows != original_embed: failures.append("VR companion did not restore subwindow preference")
	print("WORLD_BUILDER_PRESENTATION ", JSON.stringify({"failures": failures, "desktop_mode": desktop_mode, "desktop_size": desktop_size, "capture": shot_path}))
	quit(0 if failures.is_empty() else 1)
