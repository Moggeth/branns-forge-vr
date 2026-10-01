extends SceneTree
## Headless, save-isolated check of the river-to-ground material binding.
const Ground = preload("res://orchard_ground.gd")

var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var material: ShaderMaterial = Ground.material()
	var texture: ImageTexture = material.get_shader_parameter("macro_mask")
	var untouched := Ground.sample(Vector2(0.0, -40.0))
	var authored_blue := texture.get_image().get_pixel(256, 192).b
	_check(material.get_shader_parameter("live_bank") == null, "authored mask is fallback before river binding")
	var model := _river_model(-40.0)
	var start := Time.get_ticks_usec()
	var first := Ground.sync_bank(model)
	var full_ms := float(Time.get_ticks_usec() - start) / 1000.0
	_check(first > 0 and first <= 512 * 512, "initial bank rebuild")
	_check(Ground.sample(Vector2(0.0, -40.0)).b > 0.95, "first river wets its bank")
	_check(Ground.sample(Vector2(0.0, 40.0)).b < 0.05, "old authored blue does not wet remote ground")
	var painted := Ground.sample(Vector2(0.0, -40.0))
	_check(_same_other_channels(untouched, painted), "bank update preserves red green alpha")
	_check(texture.get_image().get_pixel(256, 192).b == authored_blue, "bank binding leaves authored blue untouched")
	_check(material.get_shader_parameter("live_bank") > 0.5, "live bank shader binding enabled")
	var bank_texture: ImageTexture = material.get_shader_parameter("bank_tex")
	_check(bank_texture != null and bank_texture.get_width() == 128, "filtered 128-pixel bank texture bound")
	var gpu_bank := bank_texture.get_image().get_pixel(64, 48).r
	var cpu_bank := Ground.sample(Vector2(0.0, -40.0)).b
	var source_bank := Ground._bank_image.get_pixel(64, 48).r
	_check(absf(source_bank - cpu_bank) < 0.02, "bank source image and CPU sample agree: %s / %s (readback %s)" % [source_bank, cpu_bank, gpu_bank])
	if DisplayServer.get_name() != "headless":
		_check(absf(gpu_bank - cpu_bank) < 0.02, "rendered bank texture and CPU sample agree: %s / %s" % [gpu_bank, cpu_bank])
	model = _river_model(40.0)
	Ground.sync_bank(model)
	_check(Ground.sample(Vector2(0.0, -40.0)).b < 0.05, "shifted river clears its former bank")
	_check(Ground.sample(Vector2(0.0, 40.0)).b > 0.95, "shifted river paints its new bank")
	var path_point := Vector2(80.0, 80.0)
	for z in range(-130, 131, 20):
		for x in range(-130, 131, 20):
			if Ground.sample(Vector2(x, z)).r < 0.2:
				path_point = Vector2(x, z)
				break
		if Ground.sample(path_point).r < 0.2: break
	var before_path := Ground.sample(path_point)
	Ground.sync_paths([{"a": [path_point.x - 10.0, path_point.y], "b": [path_point.x + 10.0, path_point.y]}])
	var after_path := Ground.sample(path_point)
	_check(after_path.r > before_path.r, "saved path paints red")
	_check(is_equal_approx(after_path.g, before_path.g) and is_equal_approx(after_path.a, before_path.a), "saved path preserves litter and stone channels")
	_check(Ground.sample(Vector2(0.0, 40.0)).b > 0.95 and Ground.sample(Vector2(0.0, -40.0)).b < 0.05, "saved paths retain shifted river bank")
	_check(texture.get_image().get_pixel(256, 192).b == authored_blue, "path reload preserves authored blue")
	model = _river_model(44.0)
	start = Time.get_ticks_usec()
	var local_count := Ground.sync_bank(model, Rect2(Vector2(-20.0, 30.0), Vector2(40.0, 28.0)))
	var local_ms := float(Time.get_ticks_usec() - start) / 1000.0
	_check(local_count > 0 and local_count < first / 4, "local hydrology update stays bounded")
	var unchanged := Ground.sync_bank(model, Rect2(Vector2(-20.0, 30.0), Vector2(40.0, 28.0)))
	_check(unchanged == 0, "unchanged local bank skips texture upload")
	_check(Ground.sample(Vector2(0.0, 44.0)).b > 0.95, "local river shift paints new bank")
	_check(Ground.sample(Vector2(0.0, 40.0)).b > 0.5, "local bank retains near-water transition")
	_check(Ground.sample(path_point).r == after_path.r, "local update preserves saved path")
	_check(material.get_shader_parameter("macro_mask") == texture, "material keeps live texture binding")
	print("ORCHARD_BANK_MASK_RESULT ", JSON.stringify({"failures": failures, "full_ms": full_ms, "local_ms": local_ms, "full_texels": first, "local_texels": local_count}))
	quit(0 if failures.is_empty() else 1)

func _river_model(line_z: float) -> Dictionary:
	var size := 33
	var distance := PackedFloat32Array()
	var width := PackedFloat32Array()
	distance.resize(size * size)
	width.resize(size * size)
	for z in range(size):
		for x in range(size):
			var index := z * size + x
			distance[index] = absf(-160.0 + float(z) * 10.0 - line_z)
			width[index] = 8.0
	return {"size": size, "step": 10.0, "origin": Vector2(-160.0, -160.0), "river_distance": distance, "river_width": width}

func _same_other_channels(a: Color, b: Color) -> bool:
	return is_equal_approx(a.r, b.r) and is_equal_approx(a.g, b.g) and is_equal_approx(a.a, b.a)

func _check(ok: bool, label: String) -> void:
	if not ok: failures.append(label)
