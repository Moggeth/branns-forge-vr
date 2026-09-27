extends Node3D

const BUILDER = preload("res://experiments/visual_2d3d/world_builder.gd")
const SPEC_BASE := "res://../experiments/visual-2d3d-20260928/"
const SCENE_BASE := "res://experiments/visual_2d3d/"
const GRAVITY := 24.0
const SPEED := 5.5
const SPRINT_SPEED := 9.0

var variant := "E"
var scene_path := ""
var log_path := ""
var smoke := false
var world: Node3D
var actor: CharacterBody3D
var camera: Camera3D
var label: Label
var log_file: FileAccess
var mouse_captured := false

func record(message: String) -> void:
	var line := Time.get_datetime_string_from_system() + " " + message
	print(line)
	if log_file != null:
		log_file.store_line(line)
		log_file.flush()

func _ready() -> void:
	if not log_path.is_empty():
		log_file = FileAccess.open(log_path, FileAccess.WRITE)
		if log_file == null: push_warning("Cannot open preview log: " + log_path)
	record("Preview startup Godot=" + Engine.get_version_info().string + " variant=" + variant + " renderer=" + RenderingServer.get_current_rendering_method())
	create_player()
	create_hud()
	if not switch_variant(variant, scene_path):
		get_tree().quit(2)
		return
	if smoke:
		call_deferred("run_smoke")
	else:
		capture_mouse(true)

func create_player() -> void:
	actor = CharacterBody3D.new()
	actor.name = "PreviewWalker"
	actor.collision_layer = 0
	actor.collision_mask = 1 | (1 << 19)
	actor.floor_snap_length = 0.35
	actor.safe_margin = 0.03
	add_child(actor)
	var shape := CollisionShape3D.new()
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.35
	capsule.height = 1.75
	shape.shape = capsule
	actor.add_child(shape)
	camera = Camera3D.new()
	camera.name = "WalkerCamera"
	camera.position.y = 0.65
	camera.fov = 75.0
	camera.current = true
	actor.add_child(camera)

func create_hud() -> void:
	var layer := CanvasLayer.new()
	add_child(layer)
	var panel := PanelContainer.new()
	panel.position = Vector2(18, 18)
	layer.add_child(panel)
	label = Label.new()
	label.add_theme_color_override("font_color", Color.WHITE)
	label.add_theme_font_size_override("font_size", 17)
	panel.add_child(label)
	update_hud()
	var crosshair := Label.new()
	crosshair.text = "+"
	crosshair.add_theme_font_size_override("font_size", 24)
	crosshair.set_anchors_and_offsets_preset(Control.PRESET_CENTER)
	layer.add_child(crosshair)

func update_hud() -> void:
	label.text = "Orchard Brook  |  Variant %s\nWASD move  •  Mouse look  •  Shift sprint  •  Space jump\nF1–F5 switch A–E  •  R reset  •  Esc release mouse  •  Click capture" % variant

func spec_path(code: String) -> String:
	if code == "B": return SPEC_BASE + "planning/artifacts/B/world_spec.json"
	return SPEC_BASE + "variants/" + code + "/world_spec.json"

func read_spec(code: String) -> Dictionary:
	var path := spec_path(code)
	if not FileAccess.file_exists(path):
		record("ERROR missing spec " + path)
		return {}
	var value = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(value) != TYPE_DICTIONARY:
		record("ERROR invalid spec JSON " + path)
		return {}
	return value

func switch_variant(code: String, selected_scene := "") -> bool:
	if not ["A", "B", "C", "D", "E"].has(code): return false
	var started := Time.get_ticks_msec()
	var spec := read_spec(code)
	if spec.is_empty(): return false
	var builder = BUILDER.new(spec)
	if not builder.validate():
		record("ERROR spec invalid " + code + " " + "; ".join(builder.errors))
		return false
	var new_world: Node3D
	if not selected_scene.is_empty():
		var packed := ResourceLoader.load(selected_scene) as PackedScene
		if packed == null:
			record("ERROR saved scene failed to load " + selected_scene)
			return false
		new_world = packed.instantiate() as Node3D
		record("Loaded saved scene " + selected_scene)
	else:
		new_world = builder.build()
		record("Built world from " + spec_path(code))
	if new_world == null: return false
	if world != null:
		remove_child(world)
		world.queue_free()
	world = new_world
	add_child(world)
	variant = code
	update_hud()
	reset_player(spec)
	record("Variant " + code + " ready in " + str((Time.get_ticks_msec() - started) / 1000.0) + " s; nodes=" + str(builder.metrics.get("node_count", "saved")))
	return true

func reset_player(spec := {}) -> void:
	if spec.is_empty(): spec = read_spec(variant)
	var spawn: Array = spec.get("spawn_xz", [-30, 29])
	var goal: Array = spec.get("goal_xz", [24, -27])
	var x := float(spawn[0])
	var z := float(spawn[1])
	var hit := world.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x, 30, z), Vector3(x, -20, z)))
	var ground_y := float(hit.position.y) if not hit.is_empty() else 0.0
	actor.global_position = Vector3(x, ground_y + 1.0, z)
	actor.velocity = Vector3.ZERO
	actor.rotation.y = atan2(x - float(goal[0]), z - float(goal[1]))
	camera.rotation.x = 0.0
	record("Spawn " + str(actor.global_position) + " ground_hit=" + str(not hit.is_empty()))

func capture_mouse(enabled: bool) -> void:
	mouse_captured = enabled
	Input.mouse_mode = Input.MOUSE_MODE_CAPTURED if enabled else Input.MOUSE_MODE_VISIBLE

func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and mouse_captured:
		actor.rotate_y(-event.relative.x * 0.0025)
		camera.rotation.x = clampf(camera.rotation.x - event.relative.y * 0.0025, -1.45, 1.45)
	elif event is InputEventMouseButton and event.pressed and not mouse_captured:
		capture_mouse(true)
	elif event is InputEventKey and event.pressed and not event.echo:
		match event.keycode:
			KEY_ESCAPE: capture_mouse(false)
			KEY_R: reset_player()
			KEY_F1, KEY_F2, KEY_F3, KEY_F4, KEY_F5:
				var code := "ABCDE"[event.keycode - KEY_F1]
				switch_variant(code)

func _physics_process(delta: float) -> void:
	if smoke or actor == null or world == null: return
	var input := Vector2.ZERO
	if Input.is_physical_key_pressed(KEY_A): input.x -= 1
	if Input.is_physical_key_pressed(KEY_D): input.x += 1
	if Input.is_physical_key_pressed(KEY_W): input.y -= 1
	if Input.is_physical_key_pressed(KEY_S): input.y += 1
	var direction := (actor.global_transform.basis * Vector3(input.x, 0, input.y)).normalized()
	var speed := SPRINT_SPEED if Input.is_physical_key_pressed(KEY_SHIFT) else SPEED
	actor.velocity.x = direction.x * speed
	actor.velocity.z = direction.z * speed
	if actor.is_on_floor():
		if Input.is_physical_key_pressed(KEY_SPACE): actor.velocity.y = 5.8
	else:
		actor.velocity.y -= GRAVITY * delta
	actor.move_and_slide()
	if actor.global_position.y < -12:
		record("Fall recovery at " + str(actor.global_position))
		reset_player()

func run_smoke() -> void:
	for _frame in 12:
		await get_tree().physics_frame
		actor.velocity = Vector3(0, -2, 0)
		actor.move_and_slide()
	var spec := read_spec(variant)
	var before := actor.global_position
	var next_path: Array = spec.path_xz[1]
	var towards := (Vector3(float(next_path[0]), before.y, float(next_path[1])) - before).normalized()
	for _step in 12:
		await get_tree().physics_frame
		actor.velocity = Vector3(towards.x * SPEED, -2, towards.z * SPEED)
		actor.move_and_slide()
	var moved := Vector2(actor.global_position.x - before.x, actor.global_position.z - before.z).length()
	var spawn: Array = spec.spawn_xz
	var x := float(spawn[0])
	var z := float(spawn[1])
	var hit := world.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x, 30, z), Vector3(x, -20, z)))
	var crossing: Array = spec.crossing.center_xz
	var bridge_at := Vector3(float(crossing[0]), 0, float(crossing[1]))
	var bridge_query := PhysicsRayQueryParameters3D.create(bridge_at + Vector3.UP * 10, bridge_at + Vector3.DOWN * 10)
	if not str(spec.crossing.get("asset_glb", "")).is_empty(): bridge_query.collision_mask = 1 << 19
	var bridge_hit := world.get_world_3d().direct_space_state.intersect_ray(bridge_query)
	var bridge_ok: bool = not bridge_hit.is_empty() and str(bridge_hit.collider.name) == "WalkableDeckCollision"
	var ok: bool = not hit.is_empty() and str(hit.collider.name) == "TerrainCollision" and actor.is_on_floor() and moved > 0.4 and bridge_ok and camera != null
	record("SMOKE " + ("PASS" if ok else "FAIL") + " " + variant + " spawn_collider=" + (str(hit.collider.name) if not hit.is_empty() else "none") + " walker_floor=" + str(actor.is_on_floor()) + " moved_m=" + str(moved) + " bridge=" + (str(bridge_hit.collider.name) if not bridge_hit.is_empty() else "none"))
	get_tree().quit(0 if ok else 2)

func _exit_tree() -> void:
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE
	if log_file != null:
		log_file.store_line(Time.get_datetime_string_from_system() + " Preview exit")
		log_file.close()
