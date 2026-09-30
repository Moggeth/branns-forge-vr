extends RefCounted
## Run with: Godot --headless --xr-mode off --path godot -- --desktop-focus-check

class ConsumingNavigation:
	extends RefCounted
	var calls := 0
	func input_event(_event: InputEvent, _game: Node) -> bool:
		calls += 1
		return true

class WeaponProbe:
	extends RefCounted
	var presses := 0
	func primary() -> void: presses += 1
	func alternate() -> bool:
		presses += 1
		return true

static func run(game: Node) -> void:
	var failures: Array[String] = []
	var checks := 0
	var original_navigation = game.travel_navigation
	var original_held: Dictionary = game.held.duplicate()
	var original_swing: float = game.desktop_swing_started
	var originally_captured: bool = game.desktop_look.captured
	game.desktop_look.set_enabled(true)
	game.held.clear()
	var yaw: float = game.rig.rotation.y
	for keycode in [KEY_Q, KEY_R]:
		var key := InputEventKey.new()
		key.pressed = true
		key.physical_keycode = keycode
		game._unhandled_input(key)
		checks += 1
		if not is_equal_approx(game.rig.rotation.y, yaw):
			failures.append("desktop key %d still snaps Hero yaw" % keycode)

	var escape := InputEventKey.new()
	escape.pressed = true
	escape.physical_keycode = KEY_ESCAPE
	var navigation := ConsumingNavigation.new()
	game.travel_navigation = navigation
	game.desktop_look.capture()
	game._unhandled_input(escape)
	checks += 1
	if game.desktop_look.captured or navigation.calls != 0:
		failures.append("Escape did not release capture before modal keyboard routing")
	game.travel_navigation = original_navigation

	var left := InputEventMouseButton.new()
	left.pressed = true
	left.button_index = MOUSE_BUTTON_LEFT
	var hand_key := str(game.desktop_hand.get_instance_id())
	game.held = {}
	game.held[hand_key] = game.scene.hammer
	game.desktop_swing_started = -1.0
	game._unhandled_input(left)
	checks += 1
	if not game.desktop_look.captured or game.desktop_swing_started >= 0.0:
		failures.append("first Hero click did not reacquire without swinging")
	game.desktop_look.release_capture()

	var probe := WeaponProbe.new()
	var actions = preload("res://desktop_hero_actions.gd")
	var routed: Dictionary = actions.route(left, true, false, Callable(probe, "primary"), Callable(probe, "alternate"))
	checks += 1
	if routed.handled or probe.presses != 0:
		failures.append("UI-owned left click reached weapon route")
	var right := InputEventMouseButton.new()
	right.pressed = true
	right.button_index = MOUSE_BUTTON_RIGHT
	routed = actions.route(right, true, false, Callable(probe, "primary"), Callable(probe, "alternate"))
	checks += 1
	if routed.handled or probe.presses != 0:
		failures.append("UI-owned right click reached weapon route")

	game.held = original_held
	game.desktop_swing_started = original_swing
	if originally_captured: game.desktop_look.capture()
	print("DESKTOP_FOCUS_INPUT_RESULT checks=", checks, " failures=", JSON.stringify(failures))
	game.get_tree().quit(0 if failures.is_empty() else 1)
