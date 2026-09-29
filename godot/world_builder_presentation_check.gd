extends SceneTree
## Graphical window check; requires --world-builder-check to enter the orchard offline.

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	var original_embed := root.gui_embed_subwindows
	var view: Window = load("res://world_builder_view.gd").new()
	view.visible = false
	game.add_child(view)
	view.setup(game, game.world_builder)
	await create_timer(0.7).timeout
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
	if is_instance_valid(view): failures.append("F9 did not return to the Hero")
	if root.gui_embed_subwindows != original_embed: failures.append("subwindow preference was not restored")
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
