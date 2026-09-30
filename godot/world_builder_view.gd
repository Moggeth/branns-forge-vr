extends Window
## The second perspective is an input surface over the Hero's actual World3D.
signal hero_input_requested(event: InputEvent)
signal hero_focus_requested
signal targeting_changed(state: Dictionary)
const CommandPanel = preload("res://world_builder_command_panel.gd")
const HeroPip = preload("res://world_builder_pip.gd")
const Targeting = preload("res://world_builder_targeting.gd")
const SpellAtlas = preload("res://assets/worldbuilder/icons/spell-atlas.png")
const LINE_ACTIONS = ["path", "sunder", "forest", "wall", "fault", "bridge", "ramp", "stairs", "boardwalk"]
const ICON_INDICES = {"path":0,"sunder":1,"raise":2,"wall":3,"meteor":4,"fault":5,
	"grove":6,"forest":7,"ring":8,"awaken":9,"calm":9,"bridge":10,"ramp":11,
	"stairs":12,"boardwalk":13,"outpost":14,"tower":15,"platform":16,"gate":17,
	"barricade":18,"patrol":19,"golem":20,"harvest":21,"hire":22,"seed":8}

const TOP_HEIGHT = 64
const WINDOWED_SIZE = Vector2i(1280, 800)
const WINDOWED_MIN_SIZE = Vector2i(960, 620)
const ARRIVAL_SECONDS = 0.36
const ARRIVAL_MAX_DISTANCE = 180.0
const LAYOUT_FILE = "user://world-builder-view.cfg"

var game: Node3D
var builder: Node
var tactical_viewport: SubViewport
var world_picture: TextureRect
var camera: Camera3D
var overlay: Control
var top_panel: Panel
var command_panel: Control
var hero_pip: Control
var error_label: Label
var error_until := 0.0
var hero_hud_layer: CanvasLayer
var hero_hud_was_visible := true
var hero_3d_scale_before := 1.0
var hero_primary := false
var preferred_fullscreen := true
var preferred_window_size := WINDOWED_SIZE
var preferred_window_position := Vector2i(-1, -1)
var preferred_pip_position := Vector2(-1, -1)
var preferred_pip_size := Vector2(410, 263)
var pip_layout_touched := false
var target_visual: Node3D
var last_target_state: Dictionary = {}
var save_layout_at := INF
var catalogue: Array = []
var palette := "land"
var preview_details: Dictionary = {}
var preview_boundary: MeshInstance3D
var title_label: Label
var status_label: Label
var follow_button: Button
var quality_button: OptionButton
var fps_button: OptionButton
var selected := "path"
var first_point := Vector3.INF
var spell_drag_start := Vector3.INF
var hovered := Vector3.INF
var focus_point := Vector3.ZERO
var yaw := 0.64
var pitch := 1.04
var zoom := 85.0
var dragging := false
var hero_mouse_down := false
var last_mouse := Vector2.ZERO
var pan := Vector2.ZERO
var render_scale := 0.65
var refresh_limit := 120
var refresh_elapsed := 0.0
var message := "Choose a palette, then shape the shared world. F9 returns to the Hero."
var message_until := 0.0
var clock := 0.0
var marker: MeshInstance3D
var route_preview: MeshInstance3D
var requested_frames := 0
var slow_vr_seconds := 0.0
var frame_ms_ema := 8.3
var protected_vr := false
var follow_hero := false
var preview_valid: StandardMaterial3D
var preview_invalid: StandardMaterial3D
var companion_mode := false
var previous_embed_subwindows := true
var ui_scale := 1.0
var arrival_elapsed := ARRIVAL_SECONDS
var arrival_from := Transform3D.IDENTITY
var arrival_to := Transform3D.IDENTITY
var arrival_from_fov := 56.0
var arrival_to_fov := 56.0
var returning_to_hero := false
var return_overlay_from_alpha := 1.0
var hero_mouse_was_captured := false

func _enter_tree() -> void:
	previous_embed_subwindows = get_tree().root.gui_embed_subwindows
	get_tree().root.gui_embed_subwindows = false

func _exit_tree() -> void:
	get_tree().root.gui_embed_subwindows = previous_embed_subwindows
	if is_instance_valid(game) and game.is_inside_tree() and not game.is_queued_for_deletion():
		_restore_hero_hud()
		game.get_viewport().scaling_3d_scale = hero_3d_scale_before
	# Preview meshes live under the Orchard, outside this Window's ownership.
	# Also release them when a caller frees the Window without calling close().
	for preview in [marker, route_preview, preview_boundary, target_visual]:
		if is_instance_valid(preview) and not preview.is_queued_for_deletion(): preview.queue_free()

func setup(owner_game: Node3D, owner_builder: Node) -> void:
	game = owner_game
	builder = owner_builder
	hero_3d_scale_before = game.get_viewport().scaling_3d_scale
	title = "Brann's Forge — Orchard Survey"
	companion_mode = bool(game.vr)
	size = WINDOWED_SIZE
	min_size = WINDOWED_MIN_SIZE
	initial_position = Window.WINDOW_INITIAL_POSITION_CENTER_SCREEN_WITH_MOUSE_FOCUS
	unresizable = false
	_load_layout()
	size = preferred_window_size
	if preferred_window_position.x >= 0:
		initial_position = Window.WINDOW_INITIAL_POSITION_ABSOLUTE
		position = preferred_window_position
	focus_point = builder.center + Vector3(19, 0, -39)
	tactical_viewport = SubViewport.new()
	tactical_viewport.name = "BuilderSharedWorld"
	tactical_viewport.size = Vector2i(832, 520)
	tactical_viewport.world_3d = game.get_world_3d()
	tactical_viewport.msaa_3d = Viewport.MSAA_2X
	tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(tactical_viewport)
	camera = Camera3D.new()
	camera.name = "OrchardSurveyCamera"
	camera.fov = 56.0
	camera.far = 490.0
	tactical_viewport.add_child(camera)
	camera.current = true
	_position_camera()
	_build_ui()
	_hide_hero_hud_for_pip()
	if hero_primary: _restore_hero_hud()
	_build_preview()
	var illustrated: Node3D = preload("res://world_builder_targeting_art.gd").new()
	set_target_visual(illustrated)
	illustrated.setup(game)
	last_target_state = {}
	_publish_targeting()
	size_changed.connect(_layout_ui)
	size_changed.connect(_schedule_layout_save)
	_layout_ui()
	close_requested.connect(close)
	visible = true
	if not companion_mode and DisplayServer.get_name() != "headless":
		hero_mouse_was_captured = game.desktop_look != null and game.desktop_look.captured
		game.desktop_look.release_capture()
		mode = Window.MODE_FULLSCREEN if preferred_fullscreen else Window.MODE_WINDOWED
		_start_arrival()
	grab_focus()
	print("WORLD_BUILDER_VIEW shared_world=", tactical_viewport.world_3d.get_instance_id(), " refresh=", refresh_limit, " scale=", render_scale, " mode=", mode, " companion=", companion_mode)

func tick(delta: float) -> void:
	if game == null or not is_instance_valid(builder): return
	clock += delta
	if clock >= save_layout_at:
		save_layout_at = INF
		_save_layout()
	frame_ms_ema = lerpf(frame_ms_ema, delta * 1000.0, clampf(delta * 2.0, 0.01, 0.15))
	if error_label != null:
		var remaining := error_until - clock
		error_label.modulate.a = clampf(remaining / 0.55, 0.0, 1.0) if remaining < 0.55 else 1.0
		error_label.visible = remaining > 0.0
	_advance_arrival(delta)
	if returning_to_hero: return
	if mode == Window.MODE_MINIMIZED:
		tactical_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
		return
	if bool(game.vr) and clock > 10.0 and not protected_vr:
		slow_vr_seconds = slow_vr_seconds + delta if frame_ms_ema > 13.8 else maxf(0.0, slow_vr_seconds - delta)
		if slow_vr_seconds > 2.0:
			protected_vr = true
			render_scale = 0.5
			refresh_limit = 20
			_layout_ui()
			_say("Builder view reduced to protect VR smoothness.")
	if refresh_limit > 0:
		refresh_elapsed += delta
		if refresh_elapsed >= 1.0 / float(refresh_limit):
			refresh_elapsed = fmod(refresh_elapsed, 1.0 / float(refresh_limit))
			tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
			requested_frames += 1
	else:
		tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	var axis := Vector3.ZERO
	if has_focus() and not hero_primary and not (game.get("travel_navigation")!=null and game.travel_navigation.is_open_for(self)):
		if Input.is_key_pressed(KEY_W): axis.z -= 1
		if Input.is_key_pressed(KEY_S): axis.z += 1
		if Input.is_key_pressed(KEY_A): axis.x -= 1
		if Input.is_key_pressed(KEY_D): axis.x += 1
	if axis.length_squared() > 0:
		follow_hero = false
		var forward := Vector3(-sin(yaw), 0, -cos(yaw))
		var right := Vector3(cos(yaw), 0, -sin(yaw))
		focus_point += (right * axis.x - forward * axis.z).normalized() * delta * zoom * 0.42
		focus_point.x = clampf(focus_point.x, builder.center.x - 132, builder.center.x + 132)
		focus_point.z = clampf(focus_point.z, builder.center.z - 132, builder.center.z + 132)
		_position_camera()
	elif follow_hero and is_instance_valid(game.camera):
		var hero_at: Vector3 = game.camera.global_position
		if focus_point.distance_to(Vector3(hero_at.x, 0, hero_at.z)) > 0.05:
			focus_point = Vector3(hero_at.x, 0, hero_at.z)
			_position_camera()
	_refresh_ui()
	_update_preview()

func close() -> void:
	if returning_to_hero: return
	if DisplayServer.get_name() == "headless":
		_finish_close()
		return
	if not companion_mode and is_instance_valid(game.camera):
		returning_to_hero = true
		arrival_from = camera.global_transform
		arrival_to = game.camera.global_transform
		arrival_from_fov = camera.fov
		arrival_to_fov = game.camera.fov
		arrival_elapsed = 0.0
		return_overlay_from_alpha = overlay.modulate.a
		return
	_finish_close()

func _finish_close() -> void:
	print("WORLD_BUILDER_VIEW closed requested_frames=", requested_frames,
		" frame_ms_ema=", snappedf(frame_ms_ema, 0.01), " rts_scale=", render_scale,
		" rts_fps_target=", refresh_limit, " vr_backoff=", protected_vr)
	_save_layout()
	_restore_hero_hud()
	game.get_viewport().scaling_3d_scale = hero_3d_scale_before
	if is_instance_valid(marker): marker.queue_free()
	if is_instance_valid(route_preview): route_preview.queue_free()
	if is_instance_valid(preview_boundary): preview_boundary.queue_free()
	if is_instance_valid(target_visual): target_visual.queue_free()
	visible = false
	if not companion_mode:
		game.get_window().grab_focus()
		if hero_mouse_was_captured and game.desktop_look != null:
			game.desktop_look.call_deferred("capture")
	queue_free()

func _position_camera() -> void:
	if camera == null: return
	var was_arriving := arrival_elapsed < ARRIVAL_SECONDS
	var current_transform := camera.global_transform
	var current_fov := camera.fov
	var horizontal := cos(pitch) * zoom
	camera.global_position = focus_point + Vector3(sin(yaw) * horizontal, sin(pitch) * zoom, cos(yaw) * horizontal)
	camera.look_at(focus_point, Vector3.UP)
	if was_arriving:
		arrival_from = current_transform
		arrival_to = camera.global_transform
		arrival_from_fov = current_fov
		arrival_to_fov = 56.0
		arrival_elapsed = 0.0
		camera.global_transform = current_transform
		camera.fov = current_fov
	else:
		camera.fov = 56.0

func _start_arrival() -> void:
	if not is_instance_valid(game.camera): return
	arrival_to = camera.global_transform
	arrival_from = game.camera.global_transform
	if arrival_from.origin.distance_to(arrival_to.origin) > ARRIVAL_MAX_DISTANCE: return
	arrival_from_fov = game.camera.fov
	arrival_to_fov = 56.0
	arrival_elapsed = 0.0
	camera.global_transform = arrival_from
	camera.fov = arrival_from_fov
	overlay.modulate.a = 0.0

func _advance_arrival(delta: float) -> void:
	if arrival_elapsed >= ARRIVAL_SECONDS: return
	arrival_elapsed = minf(arrival_elapsed + delta, ARRIVAL_SECONDS)
	var fraction := arrival_elapsed / ARRIVAL_SECONDS
	var eased := 1.0 - pow(1.0 - fraction, 3.0)
	camera.global_transform = arrival_from.interpolate_with(arrival_to, eased)
	camera.fov = lerpf(arrival_from_fov, arrival_to_fov, eased)
	overlay.modulate.a = lerpf(return_overlay_from_alpha, 0.0, eased) if returning_to_hero else eased
	if returning_to_hero and arrival_elapsed >= ARRIVAL_SECONDS:
		_finish_close()

func _build_ui() -> void:
	world_picture = TextureRect.new()
	world_picture.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	world_picture.texture = tactical_viewport.get_texture()
	world_picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	world_picture.stretch_mode = TextureRect.STRETCH_SCALE
	world_picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(world_picture)
	overlay = Control.new()
	overlay.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	overlay.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(overlay)
	top_panel = _panel(Vector2.ZERO, Vector2(size.x, TOP_HEIGHT))
	title_label = _label(top_panel, "THE ORCHARD  ·  ONE SHARED WORLD", Vector2(18,8), Vector2(390,22), 18, Color("efddb6"))
	status_label = _label(top_panel, "", Vector2(18,34), Vector2(760,22), 12, Color("b0c9be"))
	quality_button = OptionButton.new()
	quality_button.position = Vector2(760,8)
	quality_button.size = Vector2(170,31)
	for text in ["World detail 100%", "World detail 65%", "World detail 50%"]: quality_button.add_item(text)
	quality_button.select(1)
	quality_button.tooltip_text = "Render the same live world at a smaller resolution to save GPU time. Text and icons stay crisp."
	quality_button.item_selected.connect(_quality)
	top_panel.add_child(quality_button)
	fps_button = OptionButton.new()
	fps_button.size = Vector2(150,31)
	for text in ["Survey 30 fps", "Survey 60 fps", "Survey 120 fps", "Survey uncapped"]: fps_button.add_item(text)
	fps_button.select(2)
	fps_button.tooltip_text = "Survey redraw target. 120 fps is the desktop default; actual rate depends on the display and GPU. VR automatically backs off when its frame rate suffers."
	fps_button.item_selected.connect(_fps)
	top_panel.add_child(fps_button)
	follow_button = Button.new()
	follow_button.size = Vector2(166,31)
	follow_button.tooltip_text = "F: follow the adventurer in the same live world. Pan or orbit to free the camera."
	follow_button.pressed.connect(_toggle_follow)
	top_panel.add_child(follow_button)
	catalogue = builder.spell_catalogue()
	command_panel = CommandPanel.new()
	command_panel.name = "WorldBuilderCommandPanel"
	overlay.add_child(command_panel)
	command_panel.setup(catalogue)
	command_panel.set_icon_atlas(SpellAtlas, 4, 6, ICON_INDICES)
	command_panel.spell_selected.connect(select_action)
	command_panel.palette_selected.connect(_select_palette)
	command_panel.regen_preset_selected.connect(_regen_preset)
	command_panel.cancel_targeting.connect(_cancel_targeting)
	hero_pip = HeroPip.new()
	hero_pip.name = "LiveHeroPicture"
	hero_pip.position = preferred_pip_position if preferred_pip_position.x >= 0.0 else Vector2(size.x - 426, TOP_HEIGHT + 14)
	hero_pip.size = preferred_pip_size
	overlay.add_child(hero_pip)
	hero_pip.setup(game.get_viewport().get_texture())
	hero_pip.return_requested.connect(func() -> void:
		if hero_primary: focus_survey()
		else: _focus_hero())
	hero_pip.swap_requested.connect(swap_primary)
	hero_pip.layout_changed.connect(_pip_changed)
	_apply_primary_textures()
	error_label = _label(overlay, "", Vector2.ZERO, Vector2(660, 70), 25, Color("ff696d"))
	error_label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	error_label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	error_label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.95))
	error_label.add_theme_constant_override("shadow_offset_x", 2)
	error_label.add_theme_constant_override("shadow_offset_y", 3)
	error_label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	error_label.visible = false
	_refresh_ui()

func _load_layout() -> void:
	if bool(game.get("diagnostic_offline")): return
	var settings := ConfigFile.new()
	if settings.load(LAYOUT_FILE) != OK: return
	preferred_fullscreen = bool(settings.get_value("window", "fullscreen", true))
	preferred_window_size = Vector2i(settings.get_value("window", "size", WINDOWED_SIZE))
	preferred_window_size = preferred_window_size.max(WINDOWED_MIN_SIZE)
	preferred_window_position = Vector2i(settings.get_value("window", "position", Vector2i(-1, -1)))
	preferred_pip_position = Vector2(settings.get_value("layout", "pip_position", Vector2(-1, -1)))
	preferred_pip_size = Vector2(settings.get_value("layout", "pip_size", Vector2(410, 263)))
	hero_primary = bool(settings.get_value("layout", "hero_primary", false))

func _save_layout() -> void:
	if bool(game.get("diagnostic_offline")): return
	if mode == Window.MODE_WINDOWED:
		preferred_window_size = size.max(WINDOWED_MIN_SIZE)
		preferred_window_position = position
	var settings := ConfigFile.new()
	settings.load(LAYOUT_FILE)
	settings.set_value("window", "fullscreen", preferred_fullscreen)
	settings.set_value("window", "size", preferred_window_size)
	settings.set_value("window", "position", preferred_window_position)
	settings.set_value("layout", "hero_primary", hero_primary)
	if hero_pip != null:
		settings.set_value("layout", "pip_position", hero_pip.position)
		settings.set_value("layout", "pip_size", hero_pip.size)
	var error := settings.save(LAYOUT_FILE)
	if error != OK: push_warning("WORLD_BUILDER_VIEW layout save failed: %d" % error)

func _schedule_layout_save() -> void:
	_sync_hero_resolution()
	if mode == Window.MODE_WINDOWED:
		preferred_window_size = size.max(WINDOWED_MIN_SIZE)
		preferred_window_position = position
	save_layout_at = clock + 0.7

func _pip_changed() -> void:
	pip_layout_touched = true
	_schedule_layout_save()

func _apply_primary_textures() -> void:
	if world_picture == null or hero_pip == null: return
	if is_instance_valid(command_panel): command_panel.visible = not hero_primary
	# The root texture already contains the FPS HUD. Keep its top rows clear.
	if is_instance_valid(top_panel): top_panel.visible = not hero_primary
	world_picture.texture = game.get_viewport().get_texture() if hero_primary else tactical_viewport.get_texture()
	hero_pip.picture.texture = tactical_viewport.get_texture() if hero_primary else game.get_viewport().get_texture()
	hero_pip.caption = "RTS · LIVE VIEW" if hero_primary else "HERO · LIVE VIEW"
	hero_pip.return_button.text = "Focus RTS" if hero_primary else "Focus Hero"
	hero_pip.queue_redraw()
	hero_pip.keep_inside(Vector2(size))
	_sync_hero_resolution()

func _sync_hero_resolution() -> void:
	if companion_mode or hero_pip == null: return
	if hero_primary:
		game.get_viewport().scaling_3d_scale = hero_3d_scale_before
	else:
		var hero_size := Vector2(game.get_viewport().size)
		var inset_size: Vector2 = hero_pip.content_rect_screen().size
		var needed := maxf(inset_size.x / maxf(hero_size.x, 1.0), inset_size.y / maxf(hero_size.y, 1.0))
		game.get_viewport().scaling_3d_scale = minf(hero_3d_scale_before, clampf(needed * 1.25, 0.5, 1.0))

func swap_primary() -> void:
	hero_primary = not hero_primary
	if hero_primary: _restore_hero_hud()
	else: _hide_hero_hud_for_pip()
	_apply_primary_textures()
	if hero_primary: hero_focus_requested.emit()
	elif game.desktop_look != null: game.desktop_look.release_capture()
	hero_mouse_down = false
	_schedule_layout_save()
	_say("Hero fills the view; RTS stays in the inset." if hero_primary else "RTS fills the view; Hero stays in the inset.")

func _focus_hero() -> void:
	if not hero_primary: swap_primary()
	grab_focus()
	_say("Hero has the large live view. Esc frees the cursor; F9 returns to RTS.")

func focus_survey() -> void:
	if not visible: visible = true
	if hero_primary: swap_primary()
	if preferred_fullscreen and not companion_mode: mode = Window.MODE_FULLSCREEN
	if game.desktop_look != null: game.desktop_look.release_capture()
	grab_focus()

func set_target_visual(visual: Node3D) -> void:
	## Optional art module: update_targeting(targeting_state) runs on hover changes.
	if is_instance_valid(target_visual): target_visual.queue_free()
	target_visual = visual
	if visual != null: game.adventure.zone_groups[builder.ZONE].add_child(visual)
	last_target_state = {}
	_publish_targeting()

func _hide_hero_hud_for_pip() -> void:
	var node: Node = game.get("hud")
	if not is_instance_valid(node): return
	while node != null and not node is CanvasLayer: node = node.get_parent()
	if node is CanvasLayer:
		hero_hud_layer = node
		hero_hud_was_visible = hero_hud_layer.visible
		hero_hud_layer.visible = false

func _restore_hero_hud() -> void:
	if is_instance_valid(hero_hud_layer): hero_hud_layer.visible = hero_hud_was_visible

func _panel(pos: Vector2, extent: Vector2) -> Panel:
	var panel := Panel.new()
	panel.position = pos
	panel.size = extent
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	var skin := StyleBoxFlat.new()
	skin.bg_color = Color(0.035, 0.075, 0.085, 0.94)
	skin.border_color = Color("95ad9b")
	skin.set_border_width_all(1)
	panel.add_theme_stylebox_override("panel", skin)
	overlay.add_child(panel)
	return panel

func _label(parent: Control, words: String, pos: Vector2, extent: Vector2, font_size: int, color: Color) -> Label:
	var label := Label.new()
	label.text = words
	label.position = pos
	label.size = extent
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func _layout_ui() -> void:
	if top_panel == null: return
	ui_scale = clampf(minf(float(size.x) / 1440.0, float(size.y) / 900.0), 1.0, 2.0)
	overlay.scale = Vector2.ONE
	top_panel.scale = Vector2.ONE * ui_scale
	var width := float(size.x) / ui_scale
	top_panel.size.x = width
	tactical_viewport.size = Vector2i(maxi(1, roundi(float(size.x) * render_scale)), maxi(1, roundi(float(size.y) * render_scale)))
	quality_button.position = Vector2(width - 350, 8)
	fps_button.position = Vector2(width - 175, 8)
	follow_button.position = Vector2(width - 526, 8)
	title_label.size.x = maxf(160.0, width - 558)
	status_label.size.x = width - 36
	command_panel.layout_for_size(Vector2(size))
	if hero_pip != null:
		if preferred_pip_position.x < 0.0 and not pip_layout_touched:
			hero_pip.position = Vector2(size.x - hero_pip.size.x - 16.0, TOP_HEIGHT * ui_scale + 14.0)
		hero_pip.keep_inside(Vector2(size))
		_sync_hero_resolution()
	if error_label != null:
		error_label.position = Vector2((size.x - error_label.size.x) * 0.5, maxf(TOP_HEIGHT + 80.0, size.y * 0.38))

func _spell(action: String) -> Dictionary:
	for entry in catalogue:
		if str(entry.id) == action: return entry
	return {}

func _availability(action: String) -> String:
	return builder.spell_availability(action)

func _refresh_ui() -> void:
	if status_label == null: return
	status_label.text = "Seed %d · %d earth edits · %d gems · %d star iron · %.1f ms/frame   |   WASD pan · right/middle-drag orbit · wheel zoom · F11 fullscreen · F9 Hero" % [game.landscape.seed, game.landscape.operation_count(), int(builder.data.star_gems), int(builder.data.star_iron), frame_ms_ema]
	follow_button.text = "F  Following Hero" if follow_hero else "F  Find Hero"
	var availability := {}
	var cooldowns := {}
	for entry in catalogue:
		availability[entry.id] = _availability(str(entry.id))
		cooldowns[entry.id] = builder.spell_cooldown_fraction(str(entry.id))
	var words: String = message if clock < message_until else (builder.progress_message if game.elapsed < builder.progress_until else "Right-click / Esc cancels. F9 returns to the Hero.")
	var cost := float(_spell(selected).get("mana", 0.0))
	if hovered != Vector3.INF and selected != "":
		var plan := _preview_plan()
		preview_details = plan
		if str(plan.get("reason", "")) != "": words = str(plan.reason)
		elif selected == "meteor": words = "Starfall in %.2f s · 8 m damage zone · 10 m impact." % float(plan.get("delay", 1.25))
		elif selected in ["bridge", "ramp", "stairs", "boardwalk"] and plan.has("length"):
			words = "%.1f m %s · %d lumber. Choose two endpoints or drag." % [float(plan.length), selected, int(plan.lumber)]
		elif selected == "path" and (first_point != Vector3.INF or spell_drag_start != Vector3.INF):
			cost = float(plan.get("cost", ceili(_line_start().distance_to(hovered) / 7.0)))
			words = "Route %.1f m · %.0f Mana" % [_line_start().distance_to(hovered), cost]
		elif selected == "awaken" and str(plan.get("risk", "")) != "": words = str(plan.risk)
	command_panel.update_state({"mana":float(builder.data.mana),"max_mana":20.0,
		"wood":int(builder.data.wood),"selected":selected,"palette":palette,"spell_cost":cost,
		"feedback":words,"seed":game.landscape.seed,"helpers":int(builder.data.workers),
		"availability":availability,"cooldowns":cooldowns,"regen":game.tuning.value("worldbuilder.mana_regen_multiplier")})

func select_action(action: String) -> void:
	var entry := _spell(action)
	if entry.is_empty() or not Targeting.is_targetable(entry):
		show_error("This action is not available yet.")
		return
	if action == "hire":
		var hire_problem := _availability(action)
		if hire_problem != "": show_error(hire_problem)
		else:
			var hire_result: String = builder.hire_worker()
			if hire_result != "": show_error(hire_result)
			else: _say(builder.progress_message)
		_refresh_ui()
		return
	selected = action
	palette = str(entry.palette).to_lower()
	first_point = Vector3.INF
	spell_drag_start = Vector3.INF
	_say(str(entry.description) + " " + _gesture(action))
	_refresh_ui()

func _gesture(action: String) -> String:
	return "Choose two endpoints or drag a line." if action in LINE_ACTIONS else ("Acts instantly at the work site." if action == "hire" else "Click a place in the world.")

func _select_palette(id: String) -> void:
	palette = id.to_lower()
	for entry in catalogue:
		if str(entry.palette).to_lower() == palette and Targeting.is_targetable(entry):
			select_action(str(entry.id))
			return

func _regen_preset(multiplier: float) -> void:
	# This testing preference is local to the running game; never rewrite live tuning files.
	game.tuning.runtime_overrides["worldbuilder.mana_regen_multiplier"] = 4.0 if multiplier > 2.0 else 1.0
	_say("Mana regeneration: Testing 4x" if multiplier > 2.0 else "Mana regeneration: Normal 1x")
	_refresh_ui()

func _cancel_targeting() -> void:
	selected = ""
	first_point = Vector3.INF
	spell_drag_start = Vector3.INF
	_say("Targeting cancelled. Choose another spell with 1–9.")
	_refresh_ui()

func _quality(index: int) -> void:
	render_scale = [1.0, 0.65, 0.5][index]
	_layout_ui()
	_say("Tactical render scale %d%%" % roundi(render_scale * 100))

func _fps(index: int) -> void:
	refresh_limit = [30, 60, 120, 0][index]
	_say("Tactical view uncapped" if refresh_limit == 0 else "Tactical redraw target %d fps" % refresh_limit)

func _toggle_follow() -> void:
	follow_hero = not follow_hero
	_say("Following the Hero in real time." if follow_hero else "Survey camera is free.")

func _say(words: String) -> void:
	message = words
	message_until = clock + 5.0
	print("WORLD_BUILDER_VIEW ", words)

func show_error(words: String) -> void:
	_say(words)
	error_label.text = words
	error_until = clock + 2.0
	error_label.modulate.a = 1.0
	error_label.visible = true

func _build_preview() -> void:
	marker = MeshInstance3D.new()
	marker.name = "SurveyCursor"
	var mesh := CylinderMesh.new()
	mesh.top_radius = 0.6
	mesh.bottom_radius = 0.6
	mesh.height = 0.04
	marker.mesh = mesh
	preview_valid = _preview_material(Color("85f3d4"))
	preview_invalid = _preview_material(Color("ed8065"))
	marker.material_override = preview_valid
	marker.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	game.adventure.zone_groups[builder.ZONE].add_child(marker)
	marker.visible = false
	route_preview = MeshInstance3D.new()
	route_preview.name = "SurveyRoutePreview"
	route_preview.mesh = BoxMesh.new()
	route_preview.material_override = preview_valid
	route_preview.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	game.adventure.zone_groups[builder.ZONE].add_child(route_preview)
	route_preview.visible = false
	preview_boundary = MeshInstance3D.new()
	preview_boundary.name = "SurveyFootprint"
	preview_boundary.mesh = ImmediateMesh.new()
	preview_boundary.material_override = preview_valid
	preview_boundary.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	game.adventure.zone_groups[builder.ZONE].add_child(preview_boundary)
	preview_boundary.visible = false

func _preview_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.albedo_color.a = 0.65
	material.no_depth_test = true
	return material

func _line_start() -> Vector3:
	return first_point if first_point != Vector3.INF else spell_drag_start

func _preview_plan() -> Dictionary:
	if selected == "": return {}
	return Targeting.plan(selected, _line_start(), hovered, builder, game, _availability(selected))

func targeting_state() -> Dictionary:
	## Read-only contract for the illustrated target layer and command panel.
	var state := _preview_plan()
	state["first_point"] = _line_start()
	state["hovered"] = hovered
	state["hovered_world"] = builder.center + hovered if hovered != Vector3.INF else Vector3.INF
	state["world_origin"] = builder.center
	state["first_world"] = builder.center + _line_start() if _line_start() != Vector3.INF else Vector3.INF
	state["footprint"] = Targeting.spec(selected)
	state["selected"] = selected
	state["terrain_revision"] = game.landscape.world_revision
	return state

func _publish_targeting() -> void:
	var state := targeting_state()
	if state == last_target_state: return
	last_target_state = state.duplicate(true)
	targeting_changed.emit(state)
	if is_instance_valid(target_visual) and target_visual.has_method("update_targeting"):
		target_visual.call("update_targeting", state)

func _ground_preview(local: Vector3) -> Vector3:
	return builder.center + Vector3(local.x, game.landscape.height_at(Vector2(local.x,local.z)) + 0.18,local.z)

func _boundary_line(mesh: ImmediateMesh, a: Vector3, b: Vector3) -> void:
	mesh.surface_add_vertex(a)
	mesh.surface_add_vertex(b)

func _preview_circle(mesh: ImmediateMesh, point: Vector3, radius: float, segments: int = 48) -> void:
	for i in segments:
		var a := point + Vector3(cos(TAU * i / segments), 0, sin(TAU * i / segments)) * radius
		var b := point + Vector3(cos(TAU * (i + 1) / segments), 0, sin(TAU * (i + 1) / segments)) * radius
		_boundary_line(mesh, _ground_preview(a), _ground_preview(b))

func _preview_arrow(mesh: ImmediateMesh, a: Vector3, b: Vector3, side: Vector3, width: float) -> void:
	var direction := (b - a).normalized()
	var tip := _ground_preview(b)
	_boundary_line(mesh, _ground_preview(b - direction * 3.0 + side * width), tip)
	_boundary_line(mesh, _ground_preview(b - direction * 3.0 - side * width), tip)

func _update_preview() -> void:
	if marker == null: return
	_publish_targeting()
	var spec: Dictionary = Targeting.spec(selected)
	var showing := hovered != Vector3.INF and selected != "" and not spec.is_empty() and str(spec.kind) != "instant"
	var art_active := is_instance_valid(target_visual) and target_visual.has_method("update_targeting")
	marker.visible = showing and not art_active
	preview_boundary.visible = showing and not art_active
	route_preview.visible = false
	var mesh: ImmediateMesh = preview_boundary.mesh
	mesh.clear_surfaces()
	if not showing: return
	var plan := _preview_plan()
	var valid := bool(plan.get("valid", false))
	var skin := preview_valid if valid else preview_invalid
	marker.global_position = _ground_preview(hovered)
	marker.scale = Vector3.ONE * (1.0 + sin(clock * 4.0) * 0.05)
	marker.material_override = skin
	preview_boundary.material_override = skin
	mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	var start := _line_start()
	if selected in LINE_ACTIONS and start != Vector3.INF:
		var direction := Vector2(hovered.x - start.x, hovered.z - start.z).normalized()
		var side := Vector3(-direction.y,0,direction.x)
		var half_width := float(plan.get("width", spec.get("width", 2.0))) * 0.5
		for edge in [-1.0,1.0]:
			for i in 24:
				var a: Vector3 = start.lerp(hovered,float(i)/24.0) + side * half_width * edge
				var b: Vector3 = start.lerp(hovered,float(i+1)/24.0) + side * half_width * edge
				if selected in ["bridge","ramp","stairs","boardwalk"] and plan.has("a"):
					a.y = plan.a.lerp(plan.b,float(i)/24.0).y + 0.10
					b.y = plan.a.lerp(plan.b,float(i+1)/24.0).y + 0.10
					_boundary_line(mesh, builder.center + a, builder.center + b)
				else: _boundary_line(mesh,_ground_preview(a),_ground_preview(b))
		for point in [start,hovered]:
			_boundary_line(mesh,_ground_preview(point - side * half_width),_ground_preview(point + side * half_width))
			# Vertical endpoints make the actual crossing/deck height readable from RTS.
			var endpoint: Vector3 = plan.a if point == start and plan.has("a") else plan.get("b",point)
			_boundary_line(mesh,_ground_preview(point),builder.center + endpoint + Vector3.UP * 1.2)
		_preview_arrow(mesh, start, hovered, side, minf(half_width, 2.0))
	else:
		match str(spec.kind):
			"annulus":
				_preview_circle(mesh, hovered, float(spec.inner))
				_preview_circle(mesh, hovered, float(spec.outer))
			"trees":
				_preview_circle(mesh, hovered, float(spec.radius))
				for i in 3:
					var angle := TAU * i / 3.0 + 0.2
					_preview_circle(mesh, hovered + Vector3(cos(angle), 0, sin(angle)) * 2.5, 0.55, 16)
			"triad":
				_preview_circle(mesh, hovered, float(spec.radius))
				if plan.has("hero_clearance_center"):
					_preview_circle(mesh, plan.hero_clearance_center, 7.0, 32)
				for i in 3:
					_preview_circle(mesh, hovered + Vector3(cos(TAU * i / 3.0), 0, sin(TAU * i / 3.0)) * 1.8, 0.48, 16)
			"impact":
				_preview_circle(mesh, hovered, float(spec.radius))
				_preview_circle(mesh, hovered, float(spec.damage_radius))
				_preview_circle(mesh, hovered, 1.0, 20)
			"circle":
				_preview_circle(mesh, hovered, float(spec.radius))
				_preview_circle(mesh, hovered, float(spec.radius) * 0.65)
				_preview_circle(mesh, hovered, float(spec.radius) * 0.30)
			"harvest":
				_preview_circle(mesh, hovered, 0.7, 24)
				var tip := _ground_preview(hovered)
				_boundary_line(mesh, tip + Vector3(-0.8, 0.8, 0), tip + Vector3(0.8, 0, 0))
				_boundary_line(mesh, tip + Vector3(-0.2, 0.9, 0), tip + Vector3(0.6, 0.3, 0))
			"sprout":
				_preview_circle(mesh, hovered, float(spec.radius), 24)
				var root := _ground_preview(hovered)
				_boundary_line(mesh, root, root + Vector3.UP * 2.0)
				_boundary_line(mesh, root + Vector3.UP, root + Vector3(0.8, 1.5, 0))
				_boundary_line(mesh, root + Vector3.UP, root + Vector3(-0.8, 1.5, 0))
			"tree", "ent":
				_preview_circle(mesh, hovered, float(spec.radius))
				var trunk := _ground_preview(hovered)
				_boundary_line(mesh, trunk, trunk + Vector3.UP * 3.0)
				_boundary_line(mesh, trunk + Vector3.UP * 3.0, trunk + Vector3(0.8, 1.6, 0))
				_boundary_line(mesh, trunk + Vector3.UP * 3.0, trunk + Vector3(-0.8, 1.6, 0))
			_:
				_preview_circle(mesh, hovered, float(spec.get("radius", 0.8)))
	mesh.surface_end()

func _world_at(screen: Vector2) -> Vector3:
	var scaled := Vector2.ZERO
	if hero_primary:
		if hero_pip == null: return Vector3.INF
		var content: Rect2 = hero_pip.content_rect_screen()
		if not content.has_point(screen): return Vector3.INF
		scaled = (screen - content.position) * Vector2(tactical_viewport.size) / content.size
	else:
		if screen.y < TOP_HEIGHT * ui_scale or command_panel.is_over_panel(screen): return Vector3.INF
		if hero_pip != null and hero_pip.contains_screen_point(screen): return Vector3.INF
		scaled = screen * Vector2(tactical_viewport.size) / Vector2(size)
	var origin := camera.project_ray_origin(scaled)
	var direction := camera.project_ray_normal(scaled)
	var query := PhysicsRayQueryParameters3D.create(origin, origin + direction * 700.0, 2)
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty(): return Vector3.INF
	var point: Vector3 = hit.position - builder.center
	point.y = game.landscape.height_at(Vector2(point.x, point.z))
	return point if builder._inside(point) else Vector3.INF

func _act(local: Vector3) -> void:
	if selected == "": return
	var available := _availability(selected)
	if available != "": show_error(available); return
	var result := ""
	if selected in LINE_ACTIONS:
		if first_point == Vector3.INF:
			first_point = local
			_say("Start set. Choose the other end, or drag a line.")
			return
		result = _cast_line(first_point,local)
		if result == "": first_point = Vector3.INF
	else:
		match selected:
			"harvest": result = builder.mark_harvest(local)
			"hire": result = builder.hire_worker()
			"grove": result = builder.plant_grove(local)
			"patrol": result = builder.summon_patrol(local)
			"raise": result = builder.cast_raise(local)
			"ring": result = builder.cast_tree_ring(local)
			"meteor": result = builder.cast_meteor(local)
			"awaken": result = builder.cast_awaken(local)
			"calm": result = builder.calm_ent(local)
			"seed": result = builder.ents.plant_seed(local)
			"golem": result = builder.assemble_golem(local)
			_: result = "This construction is not available yet."
	if result != "": show_error(result)
	else: _say(builder.progress_message)
	# Keep selection after successful casts, including unsuccessful placement attempts.
	_refresh_ui()

func _cast_line(a: Vector3,b: Vector3) -> String:
	match selected:
		"path": return builder.carve_path(a,b)
		"sunder": return builder.cast_sunder(a,b)
		"forest": return builder.cast_forest(a,b)
		"wall": return builder.cast_wall(a,b)
		"fault": return builder.cast_prism_fault(a,b)
		"bridge","ramp","stairs","boardwalk": return builder.construct(selected,a,b)
	return "Unknown line spell."

func _input(event: InputEvent) -> void:
	if not visible or not has_focus() or returning_to_hero: return
	if game.get("travel_navigation")!=null and game.travel_navigation.input_event(event,self): return
	var header_height: float = 0.0 if hero_primary else TOP_HEIGHT * ui_scale
	if hero_primary and event is InputEventKey:
		var hero_key := event as InputEventKey
		if not (hero_key.pressed and not hero_key.echo and hero_key.keycode in [KEY_F9, KEY_F11]):
			hero_input_requested.emit(event)
			set_input_as_handled()
			return
	if event is InputEventKey and event.pressed and not event.echo:
		if command_panel.handle_shortcut(event):
			set_input_as_handled()
			return
		if event.keycode == KEY_F: _toggle_follow()
		elif event.keycode == KEY_F9:
			if companion_mode: close()
			elif hero_primary: focus_survey()
			else: _focus_hero()
		elif event.keycode == KEY_F11:
			if mode == Window.MODE_FULLSCREEN or mode == Window.MODE_EXCLUSIVE_FULLSCREEN:
				mode = Window.MODE_WINDOWED
				size = preferred_window_size
				preferred_fullscreen = false
			else:
				preferred_window_size = size
				preferred_window_position = position
				mode = Window.MODE_FULLSCREEN
				preferred_fullscreen = true
			_schedule_layout_save()
		else: return
		set_input_as_handled()
	elif event is InputEventMouseButton:
		var in_hero: bool = hero_primary and not hero_pip.contains_screen_point(event.position) and not command_panel.is_over_panel(event.position) and event.position.y >= header_height
		if in_hero or (hero_primary and hero_mouse_down and not event.pressed):
			if event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE]: hero_mouse_down = event.pressed
			hero_input_requested.emit(event)
			set_input_as_handled()
			return
		var in_rts_pip: bool = hero_primary and hero_pip.content_rect_screen().has_point(event.position)
		if not in_rts_pip and (command_panel.is_over_panel(event.position) or event.position.y < header_height): return
		if event.button_index in [MOUSE_BUTTON_RIGHT,MOUSE_BUTTON_MIDDLE]:
			if event.button_index == MOUSE_BUTTON_RIGHT and event.pressed: _cancel_targeting()
			dragging = event.pressed
			last_mouse = event.position
			set_input_as_handled()
		elif event.button_index == MOUSE_BUTTON_LEFT:
			var location := _world_at(event.position)
			if event.pressed and selected in LINE_ACTIONS and location != Vector3.INF:
				spell_drag_start = location
				set_input_as_handled()
			elif not event.pressed and spell_drag_start != Vector3.INF:
				var start := first_point if first_point != Vector3.INF else spell_drag_start
				spell_drag_start = Vector3.INF
				if location != Vector3.INF and Vector2(start.x,start.z).distance_to(Vector2(location.x,location.z)) >= 3.0:
					var result := _cast_line(start,location)
					if result == "": first_point = Vector3.INF
					else: first_point = start
					if result != "": show_error(result)
					else: _say(builder.progress_message)
				elif location != Vector3.INF: _act(location)
				set_input_as_handled()
			elif event.pressed and location != Vector3.INF:
				_act(location)
				set_input_as_handled()
		elif event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP,MOUSE_BUTTON_WHEEL_DOWN]:
			zoom = clampf(zoom + (-6.0 if event.button_index == MOUSE_BUTTON_WHEEL_UP else 6.0),28.0,185.0)
			_position_camera()
			set_input_as_handled()
	elif event is InputEventMouseMotion:
		if hero_primary and not hero_pip.contains_screen_point(event.position) and not command_panel.is_over_panel(event.position) and event.position.y >= header_height and not dragging:
			hero_input_requested.emit(event)
			return
		hovered = _world_at(event.position)
		if dragging:
			follow_hero = false
			var movement: Vector2 = event.position - last_mouse
			last_mouse = event.position
			yaw -= movement.x * 0.006
			pitch = clampf(pitch + movement.y * 0.004,0.42,1.36)
			_position_camera()
			set_input_as_handled()
