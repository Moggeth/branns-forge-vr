extends SceneTree
## Actual Main, offline/save-free RTS keyboard-gesture regression.
## --headless --xr-mode off --audio-driver Dummy --path godot
## --script res://world_builder_quick_cast_checks.gd --quit-after 1200 -- --world-builder-check

const Spells = preload("res://world_builder_spells.gd")

class ProbeView extends "res://world_builder_view.gd":
	var cursor := Vector3.INF
	var point_calls: Array[Dictionary] = []
	var line_calls: Array[Dictionary] = []
	var real_cast := false

	func _cursor_target() -> Vector3:
		return cursor

	func _world_at(_screen: Vector2) -> Vector3:
		return cursor

	func _act(local: Vector3) -> void:
		point_calls.append({"action": selected, "at": local})
		if real_cast: super._act(local)

	func _cast_line(a: Vector3, b: Vector3) -> String:
		line_calls.append({"action": selected, "from": a, "to": b})
		if real_cast: return super._cast_line(a, b)
		return ""

	# Never read or write a resident preference file during an offline fixture.
	func _load_layout() -> void:
		pass

	func _save_layout() -> void:
		pass

var failures: Array[String] = []
var checks := 0

func _initialize() -> void:
	create_timer(60.0).timeout.connect(func() -> void:
		printerr("WORLD_BUILDER_QUICK_CAST_RESULT timeout=60")
		quit(2))
	call_deferred("_run")

func _expect(ok: bool, label: String) -> void:
	checks += 1
	if not ok: failures.append(label)

func _key(code: Key, pressed := true, echo := false) -> InputEventKey:
	var event := InputEventKey.new()
	event.keycode = code
	event.physical_keycode = code
	event.pressed = pressed
	event.echo = echo
	return event

func _send(view: ProbeView, code: Key, pressed := true, echo := false) -> void:
	view._route_input(_key(code, pressed, echo))

func _clear(view: ProbeView) -> void:
	view.point_calls.clear()
	view.line_calls.clear()

func _run() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		print("WORLD_BUILDER_QUICK_CAST_RESULT ", JSON.stringify({"failures": ["offline flag required"]}))
		quit(2)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var builder: Node = game.world_builder
	_expect(game.diagnostic_offline and builder != null, "Main did not start in isolated offline mode")
	if builder == null:
		_finish(game, null)
		return
	builder.test_mode = true
	builder.data = builder.fresh_state()
	var view := ProbeView.new()
	view.visible = false
	game.add_child(view)
	game.world_builder_view = view
	view.setup(game, builder)
	view._advance_arrival(view.ARRIVAL_SECONDS)
	view.cursor = Vector3(20, 0, -40)
	_expect(view.quick_cast_enabled, "quick cast is not enabled by default")
	_expect(not view.hero_focus, "RTS did not start with keyboard focus")
	_expect(view.command_panel != null, "real command panel absent")

	# A point spell fires once on key down. Echo/release must not repeat it.
	_send(view, KEY_3)
	_expect(view.point_calls.size() == 1 and view.point_calls[0].action == "raise" and view.point_calls[0].at == Vector3(20, 0, -40), "Land 3 did not cast the fresh point once")
	_send(view, KEY_3, true, true)
	_send(view, KEY_3, false)
	_expect(view.point_calls.size() == 1, "point echo or release cast twice")
	view.cursor = Vector3(-12, 0, -54)
	_send(view, KEY_KP_3)
	_expect(view.point_calls.size() == 2 and view.point_calls[1].at == view.cursor, "keypad point missed new cursor location")
	_send(view, KEY_KP_3, false)
	_clear(view)

	# The line anchor is the press location; only the same key's release casts.
	var start := Vector3(5, 0, -24)
	var finish := Vector3(27, 0, -34)
	view.cursor = start
	_send(view, KEY_1)
	_expect(view.first_point == start and view.quick_cast_key >= 0 and view.quick_cast_action == "path", "line press did not arm preview anchor")
	_expect(view.preview_boundary.mesh.get_surface_count() == 0 and not view.preview_boundary.visible, "authored preview rebuilt invisible fallback geometry")
	view.cursor = finish
	_send(view, KEY_2, false)
	_expect(view.line_calls.is_empty() and view.first_point == start, "different key release ended line")
	var wheel := InputEventMouseButton.new()
	wheel.button_index = MOUSE_BUTTON_WHEEL_UP
	wheel.pressed = true
	wheel.position = Vector2(100, 200)
	view._route_input(wheel)
	_expect(view.first_point == start and view.quick_cast_action == "path", "zoom wheel cancelled held line")
	_send(view, KEY_1, true, true)
	_expect(view.line_calls.is_empty(), "line key echo cast")
	_send(view, KEY_1, false)
	_expect(view.line_calls.size() == 1 and view.line_calls[0].from == start and view.line_calls[0].to == finish, "line release did not use original anchor and fresh endpoint")
	_expect(view.first_point == Vector3.INF and view.quick_cast_key == -1, "finished line retained gesture state")
	_clear(view)
	view.cursor = start
	_send(view, KEY_1)
	view.cursor = finish
	_send(view, KEY_3)
	_send(view, KEY_1, false)
	_expect(view.line_calls.is_empty() and view.point_calls.size() == 1 and view.point_calls[0].action == "raise" and view.point_calls[0].at == finish, "new digit did not replace armed line safely")
	_clear(view)

	# Invalid release clears the gesture without spending or replaying a stale point.
	view.cursor = start
	_send(view, KEY_KP_1)
	view.cursor = Vector3.INF
	_send(view, KEY_KP_1, false)
	_expect(view.line_calls.is_empty() and view.first_point == Vector3.INF and view.quick_cast_key == -1, "off-world release cast or retained line")
	view.cursor = finish
	_send(view, KEY_KP_1, false)
	_expect(view.line_calls.is_empty(), "orphan release reused previous anchor")

	# An empty slot and an unavailable card must not replay the last selection.
	_clear(view)
	_send(view, KEY_7)
	_send(view, KEY_7, false)
	_expect(view.point_calls.is_empty() and view.line_calls.is_empty(), "empty Land slot cast a previous spell")
	view._select_palette("construction")
	_send(view, KEY_5)
	_send(view, KEY_5, false)
	_expect(view.point_calls.is_empty() and view.line_calls.is_empty(), "unavailable Construction slot cast a previous spell")
	view._select_palette("land")

	# Every context change interrupts an armed line. Its later key-up is inert.
	var interruptions := ["selection", "palette", "focus", "region", "escape", "right_click", "mode", "pointer_loss"]
	for interruption in interruptions:
		view._select_palette("land")
		view.set_quick_cast(true)
		view._set_focus(false, false)
		view.cursor = start
		_clear(view)
		_send(view, KEY_1)
		_expect(view.first_point == start, "line could not arm before " + interruption)
		match interruption:
			"selection": view.select_action("raise")
			"palette": view._select_palette("life")
			"focus": view._set_focus(true, false)
			"region": view._change_region("pinewood_ruins")
			"escape": _send(view, KEY_ESCAPE)
			"right_click":
				var right := InputEventMouseButton.new()
				right.button_index = MOUSE_BUTTON_RIGHT
				right.pressed = true
				right.position = Vector2(100, 200)
				view._route_input(right)
			"mode": view.set_quick_cast(false)
			"pointer_loss": view._release_pointer()
		view.cursor = finish
		_send(view, KEY_1, false)
		_expect(view.line_calls.is_empty() and view.first_point == Vector3.INF and view.quick_cast_key == -1, interruption + " let an old line cast")
		if interruption == "region": view._change_region("orchard_highlands")
	view._set_focus(false, false)
	view._select_palette("land")
	view.set_quick_cast(true)
	for modal_key in [KEY_M, KEY_I]:
		_clear(view)
		view.cursor = start
		_send(view, KEY_1)
		_send(view, modal_key)
		_expect(game.travel_navigation.is_open_for(view), "map/supplies shortcut failed to open modal: " + str(modal_key))
		view.cursor = finish
		_send(view, KEY_1, false)
		_expect(view.line_calls.is_empty() and view.first_point == Vector3.INF and view.quick_cast_key == -1, "modal open let armed line finish: " + str(modal_key))
		_send(view, modal_key)
		_expect(not game.travel_navigation.is_open_for(view), "map/supplies modal did not close: " + str(modal_key))

	# FPS focus forwards digits and Q to the Hero, without mutating RTS mode.
	_clear(view)
	view._set_focus(true, false)
	var before_toggle: bool = view.quick_cast_enabled
	_send(view, KEY_3)
	_send(view, KEY_Q)
	_expect(view.quick_cast_enabled == before_toggle and view.point_calls.is_empty(), "FPS focus accepted RTS quick cast or Q")
	view._set_focus(false, false)
	_send(view, KEY_Q)
	_expect(not view.quick_cast_enabled, "RTS Q did not turn quick cast off")
	_send(view, KEY_3)
	_expect(view.selected == "raise" and view.point_calls.is_empty(), "selector mode cast on digit press")
	var left := InputEventMouseButton.new()
	left.button_index = MOUSE_BUTTON_LEFT
	left.pressed = true
	left.position = Vector2(100, 200)
	view.cursor = Vector3(11, 0, -18)
	view._route_input(left)
	_expect(view.point_calls.size() == 1 and view.point_calls[0].at == view.cursor, "selector mode lost legacy mouse placement")
	_send(view, KEY_Q)
	_expect(view.quick_cast_enabled, "RTS Q did not restore quick cast")

	# The real builder must commit the requested action exactly once, with cost and cooldown.
	_clear(view)
	builder.data = builder.fresh_state()
	view.real_cast = true
	view._select_palette("land")
	view.cursor = Vector3(30, 0, -65)
	var mana_before := float(builder.data.mana)
	_send(view, KEY_5)
	_send(view, KEY_5, true, true)
	_send(view, KEY_5, false)
	var meteors: Array = builder.data.meteors
	_expect(meteors.size() == 1, "real Starfall was not committed exactly once")
	if meteors.size() == 1:
		_expect(Vector2(meteors[0].center[0], meteors[0].center[1]).distance_to(Vector2(30, -65)) < 0.2, "real Starfall landed at stale location")
	_expect(absf(float(builder.data.mana) - (mana_before - float(Spells.entry("meteor").mana))) < 0.001, "real Starfall Mana cost mismatch")
	_expect(builder.spell_cooldown_fraction("meteor") > 0.99, "real Starfall cooldown missing")
	_send(view, KEY_5)
	_expect(builder.data.meteors.size() == 1 and absf(float(builder.data.mana) - (mana_before - 8.0)) < 0.001, "cooldown allowed a second Starfall")
	builder.data.mana = 20.0
	view.cursor = Vector3(18, 0, -45)
	var sunder_mana := float(builder.data.mana)
	var operations_before: int = game.landscape.operation_count()
	_send(view, KEY_2)
	_expect(game.landscape.operation_count() == operations_before and float(builder.data.mana) == sunder_mana, "Sunder spent or changed terrain on key down")
	view.cursor = Vector3(48, 0, -49)
	_send(view, KEY_2, false)
	_expect(game.landscape.operation_count() == operations_before + 1 and str(game.landscape.operations.back().type) == "sunder", "Sunder release did not commit a real terrain operation")
	_expect(absf(float(builder.data.mana) - (sunder_mana - float(Spells.entry("sunder").mana))) < 0.001, "Sunder charged wrong Mana")
	_expect(builder.spell_cooldown_fraction("sunder") > 0.99, "Sunder cooldown missing")
	var invalid_mana := float(builder.data.mana)
	var paths_before: int = builder.data.paths.size()
	_clear(view)
	view.cursor = Vector3(4, 0, -28)
	_send(view, KEY_1)
	view.cursor = Vector3.INF # UI or outside-world hit from _cursor_target().
	_send(view, KEY_1, false)
	_expect(view.line_calls.is_empty() and builder.data.paths.size() == paths_before and float(builder.data.mana) == invalid_mana and view.quick_cast_key == -1, "invalid real-builder release spent Mana or left a gesture")
	view.real_cast = false

	# Hire is a button action: one key-down, no release or echo duplicate.
	builder.data.wood = 8
	view._select_palette("life")
	var workers_before := int(builder.data.workers)
	_send(view, KEY_6)
	_send(view, KEY_6, true, true)
	_send(view, KEY_6, false)
	_expect(int(builder.data.workers) == workers_before + 1, "Hire Helper was missed or called twice")
	view.cursor = start
	view._select_palette("land")
	_send(view, KEY_1)
	view._finish_close()
	_expect(view.first_point == Vector3.INF and view.quick_cast_key == -1, "window close retained armed line before disposal")
	await process_frame
	_expect(not is_instance_valid(view), "window close did not dispose armed gesture")
	_finish(game, null)

func _finish(game: Node3D, view: Window) -> void:
	if is_instance_valid(view): view.queue_free()
	if is_instance_valid(game): game.queue_free()
	await process_frame
	print("WORLD_BUILDER_QUICK_CAST_RESULT ", JSON.stringify({"checks": checks, "failures": failures}))
	quit(0 if failures.is_empty() else 1)
