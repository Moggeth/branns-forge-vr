extends SceneTree

const HeroLook = preload("res://desktop_hero_look.gd")
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func check(ok: bool, name: String) -> void:
	if not ok:
		failures.append(name)

func _run() -> void:
	var rig := Node3D.new()
	root.add_child(rig)
	var camera := Camera3D.new()
	rig.add_child(camera)
	var look := HeroLook.new()
	root.add_child(look)
	look.setup(rig, camera, root)
	look.capture()
	check(look.captured, "capture starts")
	var motion := InputEventMouseMotion.new()
	motion.screen_relative = Vector2(100, -50)
	check(look.handle_event(motion), "captured motion consumed")
	check(is_equal_approx(rig.rotation.y, -0.26), "yaw follows mouse immediately")
	check(is_equal_approx(camera.rotation.x, 0.13), "pitch follows mouse immediately")
	camera.rotation.x = 0.4 # Simulate a second look device changing pitch.
	look.apply_motion(Vector2(0, 1000))
	check(is_equal_approx(camera.rotation.x, -look.pitch_limit), "pitch clamps from current camera angle")
	var escape := InputEventKey.new()
	escape.pressed = true
	escape.physical_keycode = KEY_ESCAPE
	check(look.handle_event(escape) and not look.captured, "Escape releases cursor")
	check(not look.handle_event(motion), "released motion ignored")
	var click := InputEventMouseButton.new()
	click.pressed = true
	click.button_index = MOUSE_BUTTON_LEFT
	check(look.handle_event(click) and look.captured, "first click only reacquires")
	check(not look.handle_event(click), "captured click passes to gameplay")
	look.set_enabled(false)
	check(not look.captured and not look.handle_event(click), "blocked gameplay releases and ignores input")
	look.set_enabled(true)
	look.capture()
	root.focus_exited.emit()
	check(not look.captured, "window focus loss releases")
	var joy := InputEventJoypadMotion.new()
	joy.axis = JOY_AXIS_RIGHT_X
	joy.axis_value = 0.8
	check(not look.handle_event(joy), "gamepad input remains available")
	look.queue_free()
	rig.queue_free()
	print("DESKTOP_HERO_LOOK_CHECK_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
