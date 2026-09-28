extends Window
## The second perspective is an input surface over the Hero's actual World3D.
const ACTIONS = ["harvest", "path", "bridge", "grove", "patrol"]
const TITLES = ["MARK TIMBER", "CARVE PATH", "BUILD BRIDGE", "GROW GROVE", "MUSTER BONES"]
const HINTS = ["Choose an orchard tree. A helper fells it and carries the timber home.", "Choose route endpoints 3–36 m apart. The path costs aether.", "Build the Windfall Brook crossing for 3 lumber.", "Grow three harvestable trees for 3 aether.", "Warn the Hero, then raise three skeletons for 4 aether."]
const TOP_HEIGHT = 64
const BOTTOM_HEIGHT = 106

var game: Node3D
var builder: Node
var tactical_viewport: SubViewport
var world_picture: TextureRect
var camera: Camera3D
var overlay: Control
var top_panel: Panel
var bottom_panel: Panel
var title_label: Label
var status_label: Label
var hint_label: Label
var feedback_label: Label
var buttons: Array[Button] = []
var hire_button: Button
var follow_button: Button
var quality_button: OptionButton
var fps_button: OptionButton
var selected := "harvest"
var first_point := Vector3.INF
var hovered := Vector3.INF
var focus_point := Vector3.ZERO
var yaw := 0.64
var pitch := 1.04
var zoom := 85.0
var dragging := false
var last_mouse := Vector2.ZERO
var pan := Vector2.ZERO
var render_scale := 0.65
var refresh_limit := 30
var refresh_elapsed := 0.0
var message := "Choose timber to start a crossing."
var message_until := 0.0
var clock := 0.0
var marker: MeshInstance3D
var route_preview: MeshInstance3D
var requested_frames := 0
var slow_vr_seconds := 0.0
var protected_vr := false
var follow_hero := false
var preview_valid: StandardMaterial3D
var preview_invalid: StandardMaterial3D

func setup(owner_game: Node3D, owner_builder: Node) -> void:
	game = owner_game
	builder = owner_builder
	title = "Brann's Forge — Orchard Survey"
	size = Vector2i(1280, 800)
	min_size = Vector2i(960, 620)
	initial_position = Window.WINDOW_INITIAL_POSITION_CENTER_SCREEN_WITH_MOUSE_FOCUS
	unresizable = true
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
	_build_preview()
	size_changed.connect(_layout_ui)
	_layout_ui()
	close_requested.connect(close)
	visible = true
	grab_focus()
	print("WORLD_BUILDER_VIEW shared_world=", tactical_viewport.world_3d.get_instance_id(), " refresh=", refresh_limit, " scale=", render_scale)

func tick(delta: float) -> void:
	if game == null or not is_instance_valid(builder): return
	clock += delta
	if mode == Window.MODE_MINIMIZED:
		tactical_viewport.render_target_update_mode = SubViewport.UPDATE_DISABLED
		return
	if bool(game.vr) and clock > 10.0 and not protected_vr:
		slow_vr_seconds = slow_vr_seconds + delta if Engine.get_frames_per_second() < 72.0 else maxf(0.0, slow_vr_seconds - delta)
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
	var axis := Vector3.ZERO
	if has_focus():
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
	print("WORLD_BUILDER_VIEW closed")
	if is_instance_valid(marker): marker.queue_free()
	if is_instance_valid(route_preview): route_preview.queue_free()
	visible = false
	queue_free()

func _position_camera() -> void:
	if camera == null: return
	var horizontal := cos(pitch) * zoom
	camera.global_position = focus_point + Vector3(sin(yaw) * horizontal, sin(pitch) * zoom, cos(yaw) * horizontal)
	camera.look_at(focus_point, Vector3.UP)

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
	top_panel = _panel(Vector2.ZERO, Vector2(1280, TOP_HEIGHT))
	title_label = _label(top_panel, "THE ORCHARD SURVEY", Vector2(20, 3), Vector2(640, 29), 22, Color("ffe2a6"))
	status_label = _label(top_panel, "", Vector2(21, 34), Vector2(900, 25), 15, Color("e6e9d8"))
	bottom_panel = _panel(Vector2(0, 800 - BOTTOM_HEIGHT), Vector2(1280, BOTTOM_HEIGHT))
	hint_label = _label(bottom_panel, "", Vector2(20, 4), Vector2(1220, 20), 14, Color("c6dcd0"))
	feedback_label = _label(bottom_panel, "", Vector2(20, 26), Vector2(1220, 20), 14, Color("ffdfa4"))
	for i in range(ACTIONS.size()):
		var button := Button.new()
		button.position = Vector2(20 + i * 200, 51)
		button.size = Vector2(190, 48)
		button.text = "%d  %s\n%s" % [i + 1, TITLES[i], ["helper + timber", "aether / distance", "3 lumber", "3 aether", "4 aether"][i]]
		button.tooltip_text = HINTS[i]
		button.pressed.connect(select_action.bind(ACTIONS[i]))
		bottom_panel.add_child(button)
		buttons.append(button)
	hire_button = Button.new()
	hire_button.position = Vector2(1010, 51)
	hire_button.size = Vector2(190, 48)
	hire_button.text = "6  HIRE HELPER\n2 lumber"
	hire_button.tooltip_text = "Hire another lumberjack. Up to five can work independently."
	hire_button.pressed.connect(_hire)
	bottom_panel.add_child(hire_button)
	quality_button = OptionButton.new()
	quality_button.position = Vector2(920, 8)
	quality_button.size = Vector2(168, 31)
	for item in ["Render 100%", "Render 65%", "Render 50%"]: quality_button.add_item(item)
	quality_button.select(1)
	quality_button.item_selected.connect(_quality)
	top_panel.add_child(quality_button)
	fps_button = OptionButton.new()
	fps_button.position = Vector2(1094, 8)
	fps_button.size = Vector2(165, 31)
	for item in ["View 30 fps", "View 60 fps"]: fps_button.add_item(item)
	fps_button.select(0)
	fps_button.item_selected.connect(_fps)
	top_panel.add_child(fps_button)
	follow_button = Button.new()
	follow_button.position = Vector2(742, 8)
	follow_button.size = Vector2(166, 31)
	follow_button.text = "F  Find Hero"
	follow_button.tooltip_text = "Follow the VR player in the same live world. Pan or orbit to stop following."
	follow_button.pressed.connect(_toggle_follow)
	top_panel.add_child(follow_button)
	_refresh_ui()

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
	var width := float(size.x)
	tactical_viewport.size = Vector2i(maxi(1, roundi(width * render_scale)), maxi(1, roundi(float(size.y) * render_scale)))
	top_panel.size.x = width
	bottom_panel.position.y = float(size.y) - BOTTOM_HEIGHT
	bottom_panel.size.x = width
	quality_button.position.x = width - 360
	fps_button.position.x = width - 185
	follow_button.position.x = width - 538
	status_label.size.x = width - 50
	hint_label.size.x = width - 40
	feedback_label.size.x = width - 40
	var action_width := maxf(132, (width - 40 - 5 * 8) / 6.0)
	for i in range(buttons.size()):
		buttons[i].position.x = 20 + i * (action_width + 8)
		buttons[i].size.x = action_width
	hire_button.position.x = 20 + 5 * (action_width + 8)
	hire_button.size.x = action_width

func _refresh_ui() -> void:
	if status_label == null: return
	status_label.text = "Settlement: %d lumber  ·  %.1f / 20 aether  ·  %d helpers  ·  %d paths  ·  %d patrols" % [int(builder.data.wood), float(builder.data.aether), int(builder.data.workers), builder.data.paths.size(), builder.data.threats.size()]
	var action_index := ACTIONS.find(selected)
	hint_label.text = HINTS[action_index] + "    WASD pan · right-drag orbit · wheel zoom · F11 fullscreen · Esc close"
	var route_hint := ""
	if selected == "path" and first_point != Vector3.INF and hovered != Vector3.INF:
		var length := first_point.distance_to(hovered)
		var problem: String = builder.can_path(first_point, hovered)
		route_hint = ("Route %.1f m · %d aether" % [length, ceili(length / 7.0)]) if problem == "" else problem
	feedback_label.text = route_hint if route_hint != "" else ("Choose the second end of the route." if first_point != Vector3.INF else (message if clock < message_until else builder.progress_message if game.elapsed < builder.progress_until else "Edits appear live for the Hero and persist between visits."))
	for i in range(buttons.size()):
		var unaffordable := (i == 2 and int(builder.data.wood) < 3) or (i == 3 and float(builder.data.aether) < 3.0) or (i == 4 and float(builder.data.aether) < 4.0)
		buttons[i].modulate = Color("ffe1a1") if selected == ACTIONS[i] else (Color("df907c") if unaffordable else Color.WHITE)
	hire_button.disabled = int(builder.data.wood) < 2 or int(builder.data.workers) >= 5
	follow_button.text = "F  Following Hero" if follow_hero else "F  Find Hero"

func select_action(action: String) -> void:
	if action not in ACTIONS: return
	selected = action
	first_point = Vector3.INF
	_say(HINTS[ACTIONS.find(action)])

func _hire() -> void:
	var result: String = builder.hire_worker()
	_say(result if result != "" else "A helper joins the work site.")

func _quality(index: int) -> void:
	render_scale = [1.0, 0.65, 0.5][index]
	_layout_ui()
	_say("Tactical render scale %d%%" % roundi(render_scale * 100))

func _fps(index: int) -> void:
	refresh_limit = [30, 60][index]
	_say("Tactical view %d fps" % refresh_limit)

func _toggle_follow() -> void:
	follow_hero = not follow_hero
	_say("Following the Hero in real time." if follow_hero else "Survey camera is free.")

func _say(words: String) -> void:
	message = words
	message_until = clock + 5.0
	print("WORLD_BUILDER_VIEW ", words)

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

func _preview_material(color: Color) -> StandardMaterial3D:
	var material := StandardMaterial3D.new()
	material.albedo_color = color
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	material.albedo_color.a = 0.65
	material.no_depth_test = true
	return material

func _update_preview() -> void:
	if marker == null: return
	marker.visible = hovered != Vector3.INF
	if marker.visible:
		marker.global_position = builder.center + hovered + Vector3.UP * 0.15
		marker.scale = Vector3.ONE * (1.0 + sin(clock * 4.0) * 0.08)
		var valid := true
		if selected == "path" and first_point != Vector3.INF: valid = builder.can_path(first_point, hovered) == ""
		elif selected == "bridge": valid = hovered.distance_to(builder.CROSSING) <= 10.0 and int(builder.data.wood) >= 3 and builder.data.bridges.is_empty()
		elif selected == "grove": valid = float(builder.data.aether) >= 3.0 and hovered.distance_to(builder.CAMP) >= 7.0
		elif selected == "patrol": valid = float(builder.data.aether) >= 4.0 and builder.data.threats.size() < builder.MAX_THREATS
		marker.material_override = preview_valid if valid else preview_invalid
		route_preview.material_override = marker.material_override
	route_preview.visible = selected == "path" and first_point != Vector3.INF and hovered != Vector3.INF
	if route_preview.visible:
		var a: Vector3 = builder.center + first_point
		var b: Vector3 = builder.center + hovered
		var span: Vector3 = b - a
		route_preview.global_position = (a + b) * 0.5 + Vector3.UP * 0.08
		route_preview.scale = Vector3(2.0, 0.025, maxf(span.length(), 0.01))
		route_preview.rotation.y = atan2(span.x, span.z)

func _world_at(screen: Vector2) -> Vector3:
	if screen.y < TOP_HEIGHT or screen.y > float(size.y) - BOTTOM_HEIGHT: return Vector3.INF
	var scaled := screen * Vector2(tactical_viewport.size) / Vector2(size)
	var origin := camera.project_ray_origin(scaled)
	var direction := camera.project_ray_normal(scaled)
	if absf(direction.y) < 0.001: return Vector3.INF
	var t: float = (builder.center.y - origin.y) / direction.y
	if t <= 0: return Vector3.INF
	var point: Vector3 = origin + direction * t - builder.center
	point.y = 0
	return point if builder._inside(point) else Vector3.INF

func _act(local: Vector3) -> void:
	var result := ""
	match selected:
		"harvest": result = builder.mark_harvest(local)
		"path":
			if first_point == Vector3.INF:
				first_point = local
				_say("Route start set. Choose its other end.")
				return
			result = builder.carve_path(first_point, local)
			if result == "": first_point = Vector3.INF
		"bridge": result = builder.place_bridge(local)
		"grove": result = builder.plant_grove(local)
		"patrol": result = builder.summon_patrol(local)
	_say(result if result != "" else builder.progress_message)

func _input(event: InputEvent) -> void:
	if not visible or not has_focus(): return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode >= KEY_1 and event.keycode <= KEY_5: select_action(ACTIONS[event.keycode - KEY_1])
		elif event.keycode == KEY_6: _hire()
		elif event.keycode == KEY_F: _toggle_follow()
		elif event.keycode == KEY_ESCAPE:
			if first_point != Vector3.INF: first_point = Vector3.INF; _say("Route preview cancelled.")
			else: close()
		elif event.keycode == KEY_F9: close()
		elif event.keycode == KEY_F11: mode = Window.MODE_WINDOWED if mode == Window.MODE_FULLSCREEN else Window.MODE_FULLSCREEN
		set_input_as_handled()
	elif event is InputEventMouseButton:
		if event.button_index in [MOUSE_BUTTON_RIGHT, MOUSE_BUTTON_MIDDLE]:
			dragging = event.pressed
			last_mouse = event.position
			set_input_as_handled()
		elif event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
			var location := _world_at(event.position)
			if location != Vector3.INF: _act(location); set_input_as_handled()
		elif event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			zoom = clampf(zoom + (-6.0 if event.button_index == MOUSE_BUTTON_WHEEL_UP else 6.0), 28.0, 185.0)
			_position_camera()
			set_input_as_handled()
	elif event is InputEventMouseMotion:
		hovered = _world_at(event.position)
		if dragging:
			follow_hero = false
			var movement: Vector2 = event.position - last_mouse
			last_mouse = event.position
			yaw -= movement.x * 0.006
			pitch = clampf(pitch + movement.y * 0.004, 0.42, 1.36)
			_position_camera()
			set_input_as_handled()
