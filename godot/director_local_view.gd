extends Window
## Native, local director station. Instantiate, add to the scene tree, then call setup(game, director).
## A throttled SubViewport shares the hero's World3D; the Window UI remains live.

const CARD_ORDER = ["skeletons", "wisps", "golem", "gloom"]
const CARDS = {
	"skeletons": {"name":"BONE PATROL", "cost":3.0, "cooldown":5.0, "count":2},
	"wisps": {"name":"WANDERING LIGHTS", "cost":2.0, "cooldown":4.0, "count":2},
	"golem": {"name":"STONE SENTINEL", "cost":5.0, "cooldown":9.0, "count":1},
	"gloom": {"name":"DUSK VEIL", "cost":4.0, "cooldown":18.0, "count":0},
}
const LANE_ORDER = ["west", "north", "east"]

var game: Node3D
var director: Node
var tactical_viewport: SubViewport
var world_picture: TextureRect
var camera: Camera3D
var overlay: Control
var top_panel: Panel
var bottom_panel: Panel
var header: Label
var status: Label
var help: Label
var action_button: Button
var budget_bar: ProgressBar
var card_buttons: Dictionary = {}
var lane_buttons: Dictionary = {}
var hero_marker: Panel
var hero_marker_text: Label
var stone_markers: Array[Panel] = []
var stone_marker_texts: Array[Label] = []
var quality_button: OptionButton
var refresh_button: OptionButton
var render_scale = 0.75
var refresh_limit = 60
var refresh_elapsed = 0.0
var requested_frames = 0
var selected_card = "skeletons"
var selected_lane = "north"
var budget = 8.0
var ready_at: Dictionary = {}
var yaw = 0.64
var pitch = 1.10
var zoom = 30.0
var dragging = false
var last_mouse = Vector2.ZERO
var previous_phase = ""
var message = "Select a card, then choose an approach."
var message_until = 0.0
var ui_elapsed = 0.0
var perf_elapsed = 0.0
var frame_ms_samples: Array[float] = []

func setup(owner_game: Node3D, owner_director: Node) -> void:
	game = owner_game
	director = owner_director
	title = "Brann's Forge — Director"
	size = Vector2i(1280, 800)
	min_size = Vector2i(960, 620)
	initial_position = Window.WINDOW_INITIAL_POSITION_CENTER_SCREEN_WITH_MOUSE_FOCUS
	unresizable = true
	tactical_viewport = SubViewport.new()
	tactical_viewport.name = "DirectorTacticalViewport"
	tactical_viewport.size = Vector2i(960, 600)
	tactical_viewport.world_3d = game.get_world_3d()
	tactical_viewport.msaa_3d = Viewport.MSAA_2X
	tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	add_child(tactical_viewport)
	camera = Camera3D.new()
	camera.name = "LocalDirectorCamera"
	camera.fov = 55.0
	camera.far = 90.0
	tactical_viewport.add_child(camera)
	camera.current = true
	_position_camera()
	_build_ui()
	size_changed.connect(_layout_ui)
	_layout_ui()
	close_requested.connect(close)
	previous_phase = str(director.phase)
	visible = true
	grab_focus()
	print("DIRECTOR_LOCAL opened size=", size, " world=", tactical_viewport.world_3d.get_instance_id(), " scale=", render_scale, " refresh=", refresh_limit)

func tick(delta: float) -> void:
	if game == null or not is_instance_valid(director):
		return
	ui_elapsed += delta
	perf_elapsed += delta
	if delta > 0.0 and delta < 0.25: frame_ms_samples.append(delta * 1000.0)
	if perf_elapsed >= 10.0 and not frame_ms_samples.is_empty():
		frame_ms_samples.sort()
		var p95: float = frame_ms_samples[int(0.95 * float(frame_ms_samples.size() - 1))]
		print("DIRECTOR_PERF xr=", game.vr, " fps=", Engine.get_frames_per_second(), " p95_frame_ms=", snappedf(p95, 0.1), " director_cap=", refresh_limit, " scale=", render_scale, " draw_calls=", Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
		frame_ms_samples.clear()
		perf_elapsed = 0.0
	_schedule_3d_refresh(delta)
	if director.phase == "running":
		budget = minf(10.0, budget + delta * 0.55)
	if previous_phase != str(director.phase):
		if director.phase == "waiting" and previous_phase in ["adventurer_win", "director_win"]:
			budget = 8.0
			ready_at.clear()
		previous_phase = str(director.phase)
	_position_camera()
	_refresh_ui()

func _schedule_3d_refresh(delta: float) -> void:
	if refresh_limit == 0:
		return # UPDATE_ALWAYS is selected for uncapped rendering.
	refresh_elapsed = minf(refresh_elapsed + delta, 2.0 / float(refresh_limit))
	if refresh_elapsed >= 1.0 / float(refresh_limit):
		refresh_elapsed -= 1.0 / float(refresh_limit)
		tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
		requested_frames += 1

func close() -> void:
	print("DIRECTOR_LOCAL closed")
	visible = false
	queue_free()

func _exit_tree() -> void:
	game = null
	director = null

func _position_camera() -> void:
	if camera == null or not is_instance_valid(director):
		return
	var center: Vector3 = director.center
	var horizontal = cos(pitch) * zoom
	camera.global_position = center + Vector3(sin(yaw) * horizontal, sin(pitch) * zoom, cos(yaw) * horizontal)
	camera.look_at(center + Vector3(0, 0.8, 0), Vector3.UP)

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
	top_panel = _panel(Vector2(0, 0), Vector2(1280, 102))
	header = _label(top_panel, "THE DIRECTOR'S TABLE", Vector2(24, 9), Vector2(700, 34), 27, Color("ffe4aa"))
	status = _label(top_panel, "", Vector2(25, 48), Vector2(1110, 44), 18, Color("e9e9dc"))
	bottom_panel = _panel(Vector2(0, 643), Vector2(1280, 157))
	help = _label(bottom_panel, "Hover an approach + 1–4 to cast · W/N/E selects approach · click card then lane · right-drag orbit · wheel zoom · F11 fullscreen", Vector2(20, 9), Vector2(1210, 24), 15, Color("c7d8d4"))
	budget_bar = ProgressBar.new()
	budget_bar.position = Vector2(20, 39)
	budget_bar.size = Vector2(280, 22)
	budget_bar.max_value = 10
	budget_bar.show_percentage = false
	bottom_panel.add_child(budget_bar)
	for i in range(CARD_ORDER.size()):
		var kind: String = CARD_ORDER[i]
		var card: Dictionary = CARDS[kind]
		var button = Button.new()
		button.position = Vector2(20 + i * 235, 72)
		button.size = Vector2(226, 72)
		button.text = "%d  %s\n%d sparks · %ds recharge" % [i + 1, card.name, int(card.cost), int(card.cooldown)]
		button.pressed.connect(_on_card_pressed.bind(kind))
		button.add_theme_color_override("font_color", Color("f5eddd"))
		button.add_theme_color_override("font_disabled_color", Color("d0d7d5"))
		button.add_theme_color_override("font_hover_color", Color("fff1c7"))
		var disabled_style = StyleBoxFlat.new()
		disabled_style.bg_color = Color("26343a")
		disabled_style.border_color = Color("82989b")
		disabled_style.set_border_width_all(1)
		button.add_theme_stylebox_override("disabled", disabled_style)
		bottom_panel.add_child(button)
		card_buttons[kind] = button
	action_button = Button.new()
	action_button.position = Vector2(969, 74)
	action_button.size = Vector2(286, 65)
	action_button.pressed.connect(_on_action_pressed)
	bottom_panel.add_child(action_button)
	quality_button = OptionButton.new()
	quality_button.position = Vector2(1070, 9)
	quality_button.size = Vector2(185, 31)
	quality_button.add_item("Render 100%", 0)
	quality_button.add_item("Render 75%", 1)
	quality_button.add_item("Render 50%", 2)
	quality_button.item_selected.connect(_on_quality_selected)
	top_panel.add_child(quality_button)
	quality_button.select(1)
	refresh_button = OptionButton.new()
	refresh_button.position = Vector2(865, 9)
	refresh_button.size = Vector2(180, 31)
	refresh_button.add_item("View 30 fps", 0)
	refresh_button.add_item("View 60 fps", 1)
	refresh_button.add_item("View uncapped", 2)
	refresh_button.item_selected.connect(_on_refresh_selected)
	top_panel.add_child(refresh_button)
	refresh_button.select(1)
	for lane in LANE_ORDER:
		var marker = Button.new()
		marker.text = lane.to_upper() + " APPROACH"
		marker.size = Vector2(168, 40)
		marker.mouse_entered.connect(_on_lane_hover.bind(lane))
		marker.pressed.connect(_on_lane_pressed.bind(lane))
		overlay.add_child(marker)
		lane_buttons[lane] = marker
	var hero = _field_marker("HERO", Color("7de3dd"), 122)
	hero_marker = hero.panel
	hero_marker_text = hero.label
	for i in range(3):
		var stone = _field_marker("WAYSTONE %d" % (i + 1), Color("ffe2a0"), 154)
		stone_markers.append(stone.panel)
		stone_marker_texts.append(stone.label)

func _field_marker(value: String, color: Color, width: int) -> Dictionary:
	var panel = Panel.new()
	panel.size = Vector2(width, 36)
	panel.mouse_filter = Control.MOUSE_FILTER_IGNORE
	var style = StyleBoxFlat.new()
	style.bg_color = Color(0.025, 0.055, 0.075, 0.94)
	style.border_color = color
	style.set_border_width_all(2)
	style.set_corner_radius_all(7)
	panel.add_theme_stylebox_override("panel", style)
	overlay.add_child(panel)
	var label = _label(panel, value, Vector2(7, 1), Vector2(width - 14, 34), 17, color)
	label.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	label.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
	return {"panel": panel, "label": label}

func _layout_ui() -> void:
	if top_panel == null:
		return
	var width = float(size.x)
	tactical_viewport.size = Vector2i(maxi(1, roundi(width * render_scale)), maxi(1, roundi(float(size.y) * render_scale)))
	top_panel.size.x = width
	bottom_panel.position.y = float(size.y) - 157.0
	bottom_panel.size.x = width
	quality_button.position.x = width - 205.0
	refresh_button.position.x = width - 395.0
	status.size.x = width - 45.0
	help.size.x = width - 40.0
	var action_width = 210.0
	var card_space = width - action_width - 54.0
	var card_width = maxf(130.0, (card_space - 3.0 * 8.0) / 4.0)
	for i in range(CARD_ORDER.size()):
		var button: Button = card_buttons[CARD_ORDER[i]]
		button.position.x = 20.0 + i * (card_width + 8.0)
		button.size.x = card_width
	action_button.position.x = width - action_width - 18.0
	action_button.size.x = action_width

func _panel(pos: Vector2, panel_size: Vector2) -> Panel:
	var panel = Panel.new()
	panel.position = pos
	panel.size = panel_size
	panel.mouse_filter = Control.MOUSE_FILTER_STOP
	var style = StyleBoxFlat.new()
	style.bg_color = Color(0.04, 0.08, 0.11, 0.92)
	style.border_color = Color("9fbfae")
	style.set_border_width_all(1)
	panel.add_theme_stylebox_override("panel", style)
	overlay.add_child(panel)
	return panel

func _label(parent: Control, value: String, pos: Vector2, dimensions: Vector2, font_size: int, color: Color) -> Label:
	var label = Label.new()
	label.text = value
	label.position = pos
	label.size = dimensions
	label.add_theme_font_size_override("font_size", font_size)
	label.add_theme_color_override("font_color", color)
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	parent.add_child(label)
	return label

func _refresh_ui() -> void:
	var phase = str(director.phase)
	var left = maxi(0, ceili(float(director.ROUND_SECONDS) - float(director.round_time)))
	var claimed = 0
	for beacon in director.beacons:
		if beacon.claimed:
			claimed += 1
	var hp = maxi(0, ceili(float(game.adventure.hp)))
	header.text = "THE DIRECTOR'S TABLE  ·  %s" % phase.replace("_", " ").to_upper()
	status.text = "Waystones %d / 3     Adventurer %d HP     Time %02d:%02d     Sparks %.1f / 10     %s" % [claimed, hp, left / 60, left % 60, budget, message if ui_elapsed < message_until else ""]
	budget_bar.value = budget
	action_button.visible = phase != "running"
	action_button.disabled = not phase in ["waiting", "adventurer_win", "director_win"]
	action_button.text = "BEGIN ROUND" if phase == "waiting" else "REMATCH"
	for kind in CARD_ORDER:
		var button: Button = card_buttons[kind]
		var card: Dictionary = CARDS[kind]
		var cooling = maxf(0.0, float(ready_at.get(kind, 0.0)) - ui_elapsed)
		button.disabled = phase != "running" or budget < float(card.cost) or cooling > 0.0
		button.text = "%d  %s%s\n%d sparks · %s" % [CARD_ORDER.find(kind) + 1, card.name, "  ✓" if selected_card == kind else "", int(card.cost), "%.1fs remaining" % cooling if cooling > 0.0 else "READY"]
	for lane in LANE_ORDER:
		var button: Button = lane_buttons[lane]
		var world: Vector3 = director.center + director.LANES[lane] + Vector3(0, 1.1, 0)
		button.visible = phase == "running" and not camera.is_position_behind(world)
		if button.visible:
			var viewport_ratio = Vector2(size) / Vector2(tactical_viewport.size)
			var marker_at: Vector2 = camera.unproject_position(world) * viewport_ratio - button.size * 0.5
			button.position = Vector2(clampf(marker_at.x, 0.0, float(size.x) - button.size.x), clampf(marker_at.y, 106.0, float(size.y) - 205.0))
		button.modulate = Color("ffd68e") if selected_lane == lane else Color.WHITE
	_project_marker(hero_marker, game.camera.global_position + Vector3(0, 2.0, 0))
	hero_marker_text.text = "◆ HERO  %d HP" % hp
	for i in range(stone_markers.size()):
		var marker = stone_markers[i]
		if i >= director.beacons.size():
			marker.visible = false
			continue
		var beacon: Dictionary = director.beacons[i]
		_project_marker(marker, beacon.root.global_position + Vector3(0, 2.25, 0))
		var label = stone_marker_texts[i]
		label.text = "%d  %s" % [i + 1, "AWAKE" if beacon.claimed else ("CHARGING %d%%" % roundi(float(beacon.charge) / 1.8 * 100.0) if float(beacon.charge) > 0.0 else "WAYSTONE")]
		label.add_theme_color_override("font_color", Color("9af5c2") if beacon.claimed else Color("ffe2a0"))

func _project_marker(marker: Panel, point: Vector3) -> void:
	marker.visible = not camera.is_position_behind(point)
	if not marker.visible:
		return
	var viewport_ratio = Vector2(size) / Vector2(tactical_viewport.size)
	var projected = camera.unproject_position(point) * viewport_ratio - marker.size * 0.5
	marker.position = Vector2(clampf(projected.x, 0.0, float(size.x) - marker.size.x), clampf(projected.y, 106.0, float(size.y) - 205.0))

func _on_card_pressed(kind: String) -> void:
	selected_card = kind
	if kind == "gloom":
		_play_card(kind, selected_lane)
	else:
		_say("%s ready. Choose an approach." % CARDS[kind].name)

func _on_lane_hover(lane: String) -> void:
	selected_lane = lane

func _on_lane_pressed(lane: String) -> void:
	selected_lane = lane
	_play_card(selected_card, lane)

func _cast_hotkey(index: int) -> void:
	if index < 0 or index >= CARD_ORDER.size(): return
	selected_card = CARD_ORDER[index]
	_play_card(selected_card, selected_lane)

func _play_card(kind: String, lane: String) -> void:
	if director.phase != "running":
		_say("Begin the round first.")
		return
	var card: Dictionary = CARDS[kind]
	if ui_elapsed < float(ready_at.get(kind, 0.0)):
		_say("That card is recharging.")
		return
	if budget < float(card.cost):
		_say("Need %.1f more sparks." % (float(card.cost) - budget))
		return
	var live = director.warnings.reduce(func(total, w): return total + (2 if w.type in ["skeletons", "wisps"] else 1), 0)
	for enemy in director.summons:
		if is_instance_valid(enemy) and enemy.get_meta("alive", true):
			live += 1
	if int(card.count) > 0 and live + int(card.count) > 9:
		_say("Too many enemies on the field.")
		return
	budget -= float(card.cost)
	ready_at[kind] = ui_elapsed + float(card.cooldown)
	director.apply_command({"type": kind, "lane": lane})
	_say("%s sent to the %s approach." % [card.name.capitalize(), lane])
	_refresh_ui()

func _on_action_pressed() -> void:
	if director.phase == "waiting":
		director.apply_command({"type":"start"})
		_say("Round begun. Direct the forest!")
	elif director.phase in ["adventurer_win", "director_win"]:
		director.apply_command({"type":"rematch"})
		budget = 8.0
		ready_at.clear()
		_say("Rematch ready. Press Begin Round when both players are set.")

func _on_quality_selected(index: int) -> void:
	render_scale = [1.0, 0.75, 0.5][index]
	_layout_ui()
	tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ONCE
	_say("Director render scale %d%%" % roundi(render_scale * 100.0))

func _on_refresh_selected(index: int) -> void:
	refresh_limit = [30, 60, 0][index]
	refresh_elapsed = 0.0
	tactical_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS if refresh_limit == 0 else SubViewport.UPDATE_ONCE
	_say("Director view uncapped" if refresh_limit == 0 else "Director view %d fps" % refresh_limit)

func _say(value: String) -> void:
	message = value
	message_until = ui_elapsed + 4.0
	print("DIRECTOR_LOCAL ", value)

func _input(event: InputEvent) -> void:
	# This callback belongs to the Window viewport. Handle only its own focused input.
	if not visible or not has_focus():
		return
	if event is InputEventKey and event.pressed and not event.echo:
		if event.keycode >= KEY_1 and event.keycode <= KEY_4:
			_cast_hotkey(event.keycode - KEY_1)
		elif event.keycode in [KEY_W, KEY_N, KEY_E]:
			selected_lane = {KEY_W:"west", KEY_N:"north", KEY_E:"east"}[event.keycode]
		elif event.keycode == KEY_ENTER:
			_play_card(selected_card, selected_lane)
		elif event.keycode == KEY_R:
			yaw = 0.64
			pitch = 1.10
			zoom = 30.0
			_position_camera()
		elif event.keycode == KEY_F11:
			mode = Window.MODE_WINDOWED if mode == Window.MODE_FULLSCREEN else Window.MODE_FULLSCREEN
		set_input_as_handled()
	elif event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_RIGHT or event.button_index == MOUSE_BUTTON_MIDDLE:
			dragging = event.pressed
			last_mouse = event.position
			set_input_as_handled()
		elif event.pressed and event.button_index in [MOUSE_BUTTON_WHEEL_UP, MOUSE_BUTTON_WHEEL_DOWN]:
			zoom = clampf(zoom + (-3.0 if event.button_index == MOUSE_BUTTON_WHEEL_UP else 3.0), 25.0, 65.0)
			_position_camera()
			set_input_as_handled()
	elif event is InputEventMouseMotion and dragging:
		var movement: Vector2 = event.position - last_mouse
		last_mouse = event.position
		yaw -= movement.x * 0.006
		pitch = clampf(pitch + movement.y * 0.004, 0.38, 1.25)
		_position_camera()
		set_input_as_handled()
