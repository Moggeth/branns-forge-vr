extends SceneTree
## Offline production UI/casting checks; optional native-resolution art captures.
const PanelScript = preload("res://world_builder_command_panel.gd")
const SpellScript = preload("res://world_builder_spells.gd")
var failures: Array[String] = []
var started := Time.get_ticks_usec()

func _initialize() -> void:
	call_deferred("_run")

func _check(condition: bool, message: String) -> void:
	if not condition: failures.append(message)

func _run() -> void:
	create_timer(60.0).timeout.connect(func(): push_error("COMMAND_PANEL watchdog"); quit(2))
	if OS.get_cmdline_user_args().has("--panel-capture"):
		await _capture()
		return
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		push_error("Pass --world-builder-check to isolate services and saves.")
		quit(2)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var builder: Node = game.world_builder
	var view: Window = load("res://world_builder_view.gd").new()
	view.visible = false
	game.add_child(view)
	view.setup(game,builder)
	view.set_process(false)
	var panel: Control = view.command_panel
	_check(view.tactical_viewport.world_3d == game.get_world_3d(),"native panel must inhabit shared world")
	_check(panel._atlas != null and panel._atlas_idx.size() >= 23,"illustrated spell atlas missing")
	_check(panel._atlas.get_size() == Vector2(1024,1536),"atlas grid dimensions changed")
	var key := InputEventKey.new()
	key.pressed = true
	key.keycode = KEY_F2
	_check(panel.handle_shortcut(key) and view.palette == "life","F2 selects Life")
	key.keycode = KEY_4
	panel.handle_shortcut(key)
	_check(view.selected == "awaken","current-palette shortcut selects awaken")
	key.keycode = KEY_8
	panel.handle_shortcut(key)
	_check(view.selected == "seed","Life slot 8 selects recovered-seed planting")
	key.keycode = KEY_4
	panel.handle_shortcut(key)
	var palette_counts := {}
	for spell in builder.spell_catalogue():
		var group: String = str(spell.palette)
		palette_counts[group] = int(palette_counts.get(group,0)) + 1
	for count in palette_counts.values():
		_check(int(count) <= 9,"every command must fit its nine-slot palette")
	key.echo = true
	key.keycode = KEY_1
	panel.handle_shortcut(key)
	_check(view.selected == "awaken","key repeats must not choose another spell")
	key.echo = false
	key.keycode = KEY_ESCAPE
	panel.handle_shortcut(key)
	_check(view.selected == "" and is_instance_valid(view) and not view.returning_to_hero,"Escape cancels targeting without closing survey")
	view._regen_preset(1.0)
	_check(is_equal_approx(game.tuning.value("worldbuilder.mana_regen_multiplier"),1.0),"Normal toggle tunes actual Mana source")
	view._regen_preset(4.0)
	_check(is_equal_approx(game.tuning.value("worldbuilder.mana_regen_multiplier"),4.0),"Testing toggle tunes actual Mana source")
	view.select_action("raise")
	builder.data.mana = 20.0
	var before: int = game.landscape.operation_count()
	view._act(Vector3(105,0,42))
	_check(view.selected == "raise" and game.landscape.operation_count() == before + 1,"successful casting retains spell and changes real topology")
	var reserve: float = builder.data.mana
	view._act(Vector3(108,0,42))
	_check(is_equal_approx(float(builder.data.mana),reserve) and game.landscape.operation_count() == before + 1,"cooldown repeat changes neither Mana nor topology")
	_check(builder.spell_cooldown_fraction("raise") > 0.99,"new cast displays full cooldown")
	view._cancel_targeting()
	_check(view.selected == "" and view.first_point == Vector3.INF,"cancel clears shape gesture")
	view.select_action("bridge")
	_check(view.palette == "construction" and view.selected == "bridge","construction shortcut selects line bridge")
	view.first_point = Vector3(-118,0,-70)
	view.hovered = Vector3(-100,0,-70)
	view._update_preview()
	_check(view.preview_boundary.visible and view.preview_boundary.mesh.get_surface_count() == 1,"bridge has endpoint/deck world preview")
	view.hovered = Vector3.INF
	view._update_preview()
	_check(not view.preview_boundary.visible,"preview clears outside world")
	_check(game.player_avatar.head != null,"adventurer has authored head")
	_check((game.camera.cull_mask & (1 << 1)) == 0 and (view.camera.cull_mask & (1 << 1)) != 0,"Hero omits self-head while strategic player sees it")
	for extent in [Vector2i(960,620),Vector2i(1280,720),Vector2i(1600,900),Vector2i(1920,1080),Vector2i(3840,2160)]:
		view.size = extent
		view._layout_ui()
		_check(panel._panel.position.x >= 0 and panel._panel.end.x <= extent.x,"panel fits native width " + str(extent))
		_check(panel._cards.back().end.y <= extent.y,"cards fit native height " + str(extent))
		_check(not panel.is_over_panel(Vector2(20,150)),"world outside command bar remains clickable")
		for palette_entry in panel.PALETTES:
			panel._palette = palette_entry.id
			var ids: Array = panel._by_palette[palette_entry.id]
			for index in ids.size():
				var label_area: Rect2 = panel._card_parts(panel._cards[index]).label
				var fs: int = panel._fs(11.5 if panel._compact else 12.5)
				var fitted: Dictionary = panel._fit(panel._catalogue[ids[index]].title,label_area.size.x-12.0*panel._s,fs,2,fs-2)
				_check(not fitted.truncated,"ability title shortened: " + str(ids[index]) + " at " + str(extent))
				_check(panel._font.get_height(fitted.fs)*fitted.lines.size()<=label_area.size.y,"ability label exceeds its band: " + str(ids[index]) + " at " + str(extent))
		for index in range(1,4): _check(panel._tabs[index].position.x>panel._tabs[index-1].position.x,"category keyboard order is horizontal")
	_check(panel._orb_mat!=null and panel._orb_rect.mouse_filter==Control.MOUSE_FILTER_IGNORE,"Mana shader exists without intercepting world input")
	view.close()
	await process_frame
	_check(not is_instance_valid(view),"headless survey lifecycle ends without animation frames")
	print("COMMAND_PANEL_RESULT ",JSON.stringify({"failures":failures,"seconds":(Time.get_ticks_usec()-started)/1000000.0}))
	quit(0 if failures.is_empty() else 1)

func _capture() -> void:
	root.title = "Brann's Forge — isolated command-panel review"
	root.unfocusable = true
	root.position = Vector2i(-12000,-12000)
	root.content_scale_size = Vector2i.ZERO
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	var background := ColorRect.new()
	background.color = Color("405852")
	background.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	root.add_child(background)
	var panel: Control = PanelScript.new()
	root.add_child(panel)
	panel.setup(SpellScript.catalogue())
	panel.set_icon_atlas(load("res://assets/worldbuilder/icons/spell-atlas.png"),4,6,load("res://world_builder_view.gd").ICON_INDICES)
	var state := {"mana":12.7,"max_mana":20.0,"wood":18,"selected":"meteor","palette":"land",
		"spell_cost":8.0,"feedback":"Choose an impact site. Mine the fallen core together.","seed":290929,
		"helpers":3,"availability":{"sunder":"Sunder recharges in 7.2 s."},"cooldowns":{"sunder":0.6},"regen":4.0}
	var directory := "res://../outputs/worldbuilder-panel"
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(directory))
	for extent in [Vector2i(960,620),Vector2i(1920,1080),Vector2i(3840,2160)]:
		root.size = extent
		panel.update_state(state)
		await process_frame
		panel.layout_for_size(Vector2(extent))
		await process_frame
		await process_frame
		panel._hover = "card:sunder"
		await RenderingServer.frame_post_draw
		var pixels := root.get_texture().get_image()
		var destination := directory + "/panel-%dx%d.png" % [extent.x,extent.y]
		_check(pixels.save_png(destination) == OK,"capture save " + destination)
		print("COMMAND_PANEL_CAPTURE ",destination," size=",pixels.get_size())
	print("COMMAND_PANEL_CAPTURE_RESULT ",JSON.stringify({"failures":failures,"seconds":(Time.get_ticks_usec()-started)/1000000.0}))
	quit(0 if failures.is_empty() else 1)
