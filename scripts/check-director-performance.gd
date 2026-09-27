extends SceneTree
## Isolated native Window experiment. Does not load the game, service, or save data.
const SAMPLE_SECONDS := 2.0
var world: World3D
var stage: Node3D
var secondary: Window
var started := 0.0
var phase := 0
var samples: Array[float] = []
var baseline: Dictionary

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	root.title = "Director performance probe: primary"
	root.size = Vector2i(640, 360)
	root.position = Vector2i(24, 24)
	world = root.world_3d
	stage = Node3D.new()
	root.add_child(stage)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-35, 25, 0)
	stage.add_child(light)
	for x in range(12):
		for z in range(12):
			var box := MeshInstance3D.new()
			box.mesh = BoxMesh.new()
			box.position = Vector3(x - 5.5, 0, z - 5.5)
			stage.add_child(box)
	var camera := Camera3D.new()
	stage.add_child(camera)
	camera.position = Vector3(15, 19, 22)
	camera.look_at(Vector3.ZERO)
	camera.current = true
	await process_frame
	started = Time.get_ticks_usec() / 1000000.0

func _process(delta: float) -> bool:
	if started == 0.0:
		return false
	samples.append(delta * 1000.0)
	if Time.get_ticks_usec() / 1000000.0 - started < SAMPLE_SECONDS:
		return false
	var result := _summary(samples)
	if phase == 0:
		baseline = result
		secondary = Window.new()
		secondary.title = "Director performance probe: shared world"
		secondary.size = Vector2i(640, 360)
		secondary.position = Vector2i(680, 24)
		secondary.world_3d = world
		secondary.set_flag(Window.FLAG_NO_FOCUS, true)
		root.add_child(secondary)
		var second_camera := Camera3D.new()
		secondary.add_child(second_camera)
		second_camera.position = Vector3(-15, 19, 22)
		second_camera.look_at(Vector3.ZERO)
		second_camera.current = true
		phase = 1
		samples.clear()
		started = Time.get_ticks_usec() / 1000000.0
		return false
	var preview := secondary.get_texture().get_image()
	var distinct_colors := {}
	for x in range(0, preview.get_width(), 40):
		for y in range(0, preview.get_height(), 40):
			distinct_colors[preview.get_pixel(x, y).to_html()] = true
	print("DIRECTOR_NATIVE_WINDOW_RESULT ", JSON.stringify({"shared_world": secondary.world_3d == world, "second_view_image": [preview.get_width(), preview.get_height()], "sampled_colors": distinct_colors.size(), "primary_only": baseline, "two_windows": result, "note": "synthetic 144-box scene; engine frame intervals include vsync/scheduler and do not measure headset GPU time"}))
	quit(0)
	return false

func _summary(values: Array[float]) -> Dictionary:
	var sorted := values.duplicate()
	sorted.sort()
	var total := 0.0
	for value in sorted:
		total += value
	return {"frames": sorted.size(), "mean_ms": snappedf(total / max(1, sorted.size()), 0.01), "p95_ms": snappedf(sorted[mini(sorted.size() - 1, int(ceil(sorted.size() * 0.95)) - 1)], 0.01), "max_ms": snappedf(sorted.back(), 0.01)}
