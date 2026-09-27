extends Node
## Event-driven first-person Hero mouse look. The host decides when world input is available.

var rig: Node3D
var camera: Camera3D
var sensitivity := 0.0026
var pitch_limit := 1.2
var enabled := true
var captured := false
var _window: Window
var _saved_accumulation := true

func setup(hero_rig: Node3D, hero_camera: Camera3D, hero_window: Window) -> void:
	rig = hero_rig
	camera = hero_camera
	_window = hero_window
	if _window != null:
		_window.focus_exited.connect(release_capture)

func set_enabled(value: bool) -> void:
	enabled = value
	if not enabled:
		release_capture()

func capture() -> void:
	if not enabled or captured or rig == null or camera == null:
		return
	captured = true
	_saved_accumulation = Input.use_accumulated_input
	Input.use_accumulated_input = false
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED

func release_capture() -> void:
	if not captured:
		return
	captured = false
	Input.use_accumulated_input = _saved_accumulation
	if Input.mouse_mode == Input.MOUSE_MODE_CAPTURED:
		Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func handle_event(event: InputEvent) -> bool:
	if not enabled:
		return false
	if event is InputEventKey and event.pressed and not event.echo and event.physical_keycode == KEY_ESCAPE:
		if captured:
			release_capture()
			return true
		return false
	if event is InputEventMouseButton and event.pressed and event.button_index in [MOUSE_BUTTON_LEFT, MOUSE_BUTTON_RIGHT]:
		if not captured:
			capture()
			return true # Reacquiring must not also swing or fire a held tool.
	if event is InputEventMouseMotion and captured:
		apply_motion(event.screen_relative)
		return true
	return false

func apply_motion(relative: Vector2) -> void:
	if not enabled or not captured or rig == null or camera == null:
		return
	# Read the current transform so keyboard/gamepad turns and external camera changes coexist.
	rig.rotation.y -= relative.x * sensitivity
	camera.rotation.x = clampf(camera.rotation.x - relative.y * sensitivity, -pitch_limit, pitch_limit)

func _exit_tree() -> void:
	release_capture()
