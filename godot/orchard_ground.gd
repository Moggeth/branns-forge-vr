extends RefCounted
## One opaque surface with world-scale distribution and close-range detail maps.
const MASK_PATH := "res://assets/atmosphere/orchard_masks.png"
const SURFACE_MATERIALS := "res://assets/ground-surface-kit/materials/"
const EXTENT := 160.0
const RESOLUTION := 512
const BANK_RESOLUTION := 128
const EXPOSURE_RESOLUTION := 320
const EXPOSURE_FEATHER_M := 1.0
static var _material: ShaderMaterial
static var _mask_image: Image
static var _mask_texture: ImageTexture
static var _bank_image: Image
static var _bank_texture: ImageTexture
static var _bank_values := PackedByteArray()
static var _exposure_image: Image
static var _exposure_texture: ImageTexture

static func material() -> ShaderMaterial:
	if _material != null: return _material
	var source: Texture2D = load(MASK_PATH)
	_mask_image = source.get_image().duplicate()
	_mask_texture = ImageTexture.create_from_image(_mask_image)
	_material = ShaderMaterial.new()
	_material.shader = load("res://assets/orchard_kit/orchard_ground_visual.gdshader")
	var meadow := ResourceLoader.exists(SURFACE_MATERIALS+"meadow_albedo.png")
	var loam := ResourceLoader.exists(SURFACE_MATERIALS+"loam_albedo.png")
	_material.set_shader_parameter("grass_tex", load(SURFACE_MATERIALS+"meadow_albedo.png" if meadow else "res://assets/atmosphere/grass_albedo.png"))
	_material.set_shader_parameter("soil_tex", load(SURFACE_MATERIALS+"loam_albedo.png" if loam else "res://assets/atmosphere/soil_albedo.png"))
	_material.set_shader_parameter("micro_normal", load(SURFACE_MATERIALS+"meadow_normal.png" if ResourceLoader.exists(SURFACE_MATERIALS+"meadow_normal.png") else "res://assets/atmosphere/micro_normal.png"))
	# Sonnet ground refinement: the PBR meadow/loam grain was tiled at 0.60-0.68/m (1.5-1.7 m repeat), which
	# read as a fine speckled carpet at eye height. 0.40/0.44 per m (~2.5 m repeat) keeps grain visible on
	# the nearest ground while the shader's stylized drifts carry the large-scale value structure.
	_material.set_shader_parameter("grass_tile_per_m",0.40 if meadow else 0.23)
	_material.set_shader_parameter("soil_tile_per_m",0.44 if loam else 0.31)
	if ResourceLoader.exists(SURFACE_MATERIALS+"meadow_orm.png") and ResourceLoader.exists(SURFACE_MATERIALS+"loam_orm.png"):
		_material.set_shader_parameter("grass_orm",load(SURFACE_MATERIALS+"meadow_orm.png"))
		_material.set_shader_parameter("soil_orm",load(SURFACE_MATERIALS+"loam_orm.png"))
		_material.set_shader_parameter("use_authored_orm",1.0)
	_material.set_shader_parameter("macro_mask", _mask_texture)
	_exposure_image = Image.create(EXPOSURE_RESOLUTION, EXPOSURE_RESOLUTION, false, Image.FORMAT_RGBA8)
	_exposure_image.fill(Color(0.0, 0.0, 0.0, 0.0))
	_exposure_texture = ImageTexture.create_from_image(_exposure_image)
	_material.set_shader_parameter("exposure_tex", _exposure_texture)
	return _material


static func apply_exposure_delta(before_model: Dictionary, after_model: Dictionary, bounds: Rect2, operation_type: String = "") -> int:
	## Models share size/step/origin and carry their own row-major height arrays.
	## Call once when an operation's target height is known, not every animation frame.
	if not bounds.has_area(): return 0
	var size: int = int(before_model.get("size", 0))
	var step: float = float(before_model.get("step", 0.0))
	var origin: Vector2 = before_model.get("origin", Vector2.ZERO)
	var before: PackedFloat32Array = before_model.get("height", PackedFloat32Array())
	var after: PackedFloat32Array = after_model.get("height", PackedFloat32Array())
	if size < 2 or step <= 0.0 or before.size() != size * size or after.size() != size * size:
		push_warning("Orchard exposure skipped: incompatible height fields")
		return 0
	if int(after_model.get("size", 0)) != size or not is_equal_approx(float(after_model.get("step", 0.0)), step) or after_model.get("origin", Vector2.ZERO) != origin:
		push_warning("Orchard exposure skipped: heightfield mappings differ")
		return 0
	if _exposure_image == null: material()
	var low := bounds.position - Vector2.ONE * EXPOSURE_FEATHER_M
	var high := bounds.end + Vector2.ONE * EXPOSURE_FEATHER_M
	if high.x < -EXTENT or high.y < -EXTENT or low.x > EXTENT or low.y > EXTENT: return 0
	var x0 := clampi(floori((low.x + EXTENT) / (EXTENT * 2.0) * EXPOSURE_RESOLUTION), 0, EXPOSURE_RESOLUTION - 1)
	var x1 := clampi(ceili((high.x + EXTENT) / (EXTENT * 2.0) * EXPOSURE_RESOLUTION), 0, EXPOSURE_RESOLUTION - 1)
	var z0 := clampi(floori((low.y + EXTENT) / (EXTENT * 2.0) * EXPOSURE_RESOLUTION), 0, EXPOSURE_RESOLUTION - 1)
	var z1 := clampi(ceili((high.y + EXTENT) / (EXTENT * 2.0) * EXPOSURE_RESOLUTION), 0, EXPOSURE_RESOLUTION - 1)
	var painted := 0
	for z in range(z0, z1 + 1):
		for x in range(x0, x1 + 1):
			var point := Vector2(float(x) + 0.5, float(z) + 0.5) * (EXTENT * 2.0 / EXPOSURE_RESOLUTION) - Vector2.ONE * EXTENT
			var change := _height_sample(after, size, step, origin, point) - _height_sample(before, size, step, origin, point)
			# The four offset samples feather a real change about one metre beyond its edge.
			var nearby := absf(change)
			for offset in [Vector2.LEFT, Vector2.RIGHT, Vector2.UP, Vector2.DOWN]:
				var neighbour: Vector2 = point + offset * EXPOSURE_FEATHER_M
				if bounds.has_point(neighbour):
					nearby = maxf(nearby, absf(_height_sample(after, size, step, origin, neighbour) - _height_sample(before, size, step, origin, neighbour)) * 0.45)
			if nearby <= 0.01: continue
			var fresh := smoothstep(0.01, 0.16, nearby)
			var cut := clampf(-change / 4.0, 0.0, 1.0)
			var heap := clampf(change / 2.0, 0.0, 1.0)
			var prior := _exposure_image.get_pixel(x, z)
			# The latest real height change determines cut versus heap locally;
			# older exposure survives around it. Undo can be rebuilt by replay.
			var changed_here := absf(change) > 0.01
			var result := Color(maxf(prior.r, fresh), cut if changed_here else prior.g, heap if changed_here else prior.b, 0.0)
			if result != prior:
				_exposure_image.set_pixel(x, z, result)
				painted += 1
	if painted > 0: _exposure_texture.update(_exposure_image)
	return painted


static func reset_exposure() -> void:
	if _exposure_image == null: material()
	_exposure_image.fill(Color(0.0, 0.0, 0.0, 0.0))
	_exposure_texture.update(_exposure_image)


static func exposure_sample(at: Vector2) -> Color:
	if _exposure_image == null: material()
	var x := clampi(floori((at.x + EXTENT) / (EXTENT * 2.0) * EXPOSURE_RESOLUTION), 0, EXPOSURE_RESOLUTION - 1)
	var z := clampi(floori((at.y + EXTENT) / (EXTENT * 2.0) * EXPOSURE_RESOLUTION), 0, EXPOSURE_RESOLUTION - 1)
	return _exposure_image.get_pixel(x, z)


static func _height_sample(values: PackedFloat32Array, size: int, step: float, origin: Vector2, at: Vector2) -> float:
	var gx := clampf((at.x - origin.x) / step, 0.0, float(size - 1))
	var gz := clampf((at.y - origin.y) / step, 0.0, float(size - 1))
	var x0 := floori(gx)
	var z0 := floori(gz)
	var x1 := mini(x0 + 1, size - 1)
	var z1 := mini(z0 + 1, size - 1)
	var a := lerpf(values[z0 * size + x0], values[z0 * size + x1], gx - float(x0))
	var b := lerpf(values[z1 * size + x0], values[z1 * size + x1], gx - float(x0))
	return lerpf(a, b, gz - float(z0))

static func weather(wet: float, snow: float) -> void:
	if _material == null: return
	_material.set_shader_parameter("rain_wetness", clampf(wet, 0.0, 1.0))
	_material.set_shader_parameter("snow_cover", clampf(snow, 0.0, 1.0))

static func sync_paths(paths: Array) -> void:
	if _material == null: material()
	var source: Texture2D = load(MASK_PATH)
	_mask_image = source.get_image().duplicate()
	for entry in paths:
		if not entry is Dictionary or not entry.has("a") or not entry.has("b"): continue
		var a: Array = entry.a
		var b: Array = entry.b
		if a.size() != 2 or b.size() != 2: continue
		_paint_segment(Vector2(float(a[0]), float(a[1])), Vector2(float(b[0]), float(b[1])))
	_mask_texture.update(_mask_image)

static func sync_bank(model: Dictionary, bounds: Rect2 = Rect2()) -> int:
	## Rebuild once on setup, then update only the accepted hydrology region.
	if _material == null: material()
	var size: int = int(model.get("size", 0))
	var step: float = float(model.get("step", 0.0))
	var origin: Vector2 = model.get("origin", Vector2.ZERO)
	var distances: PackedFloat32Array = model.get("river_distance", PackedFloat32Array())
	var widths: PackedFloat32Array = model.get("river_width", PackedFloat32Array())
	if size < 2 or step <= 0.0 or distances.size() != size * size or widths.size() != size * size:
		push_warning("Orchard bank skipped: incompatible river fields")
		return 0
	var full := _bank_image == null or not bounds.has_area()
	if _bank_image == null:
		_bank_image = Image.create(BANK_RESOLUTION, BANK_RESOLUTION, false, Image.FORMAT_L8)
		_bank_image.fill(Color.BLACK)
		_bank_texture = ImageTexture.create_from_image(_bank_image)
		_material.set_shader_parameter("bank_tex", _bank_texture)
		_bank_values.resize(BANK_RESOLUTION * BANK_RESOLUTION)
	var region: Rect2 = Rect2(Vector2.ONE * -EXTENT, Vector2.ONE * EXTENT * 2.0) if full else bounds.grow(step * 2.0 + 9.0)
	if region.end.x < -EXTENT or region.end.y < -EXTENT or region.position.x > EXTENT or region.position.y > EXTENT: return 0
	var x0 := clampi(floori((region.position.x + EXTENT) / (EXTENT * 2.0) * BANK_RESOLUTION), 0, BANK_RESOLUTION - 1)
	var x1 := clampi(ceili((region.end.x + EXTENT) / (EXTENT * 2.0) * BANK_RESOLUTION), 0, BANK_RESOLUTION - 1)
	var z0 := clampi(floori((region.position.y + EXTENT) / (EXTENT * 2.0) * BANK_RESOLUTION), 0, BANK_RESOLUTION - 1)
	var z1 := clampi(ceili((region.end.y + EXTENT) / (EXTENT * 2.0) * BANK_RESOLUTION), 0, BANK_RESOLUTION - 1)
	var changed := 0
	for z in range(z0, z1 + 1):
		for x in range(x0, x1 + 1):
			var point := Vector2(float(x) + 0.5, float(z) + 0.5) * (EXTENT * 2.0 / BANK_RESOLUTION) - Vector2.ONE * EXTENT
			var distance := _height_sample(distances, size, step, origin, point)
			var width := _height_sample(widths, size, step, origin, point)
			var bank := 1.0 - smoothstep(0.0, 8.0, maxf(0.0, distance - width * 0.5)) if width > 0.01 else 0.0
			var value := clampi(roundi(bank * 255.0), 0, 255)
			var index := z * BANK_RESOLUTION + x
			if not full and _bank_values[index] == value: continue
			_bank_values[index] = value
			var level := float(value) / 255.0
			_bank_image.set_pixel(x, z, Color(level, level, level))
			changed += 1
	if changed > 0: _bank_texture.update(_bank_image)
	_material.set_shader_parameter("live_bank", 1.0)
	return changed

static func add_path(a: Vector3, b: Vector3) -> void:
	if _mask_image == null: material()
	_paint_segment(Vector2(a.x, a.z), Vector2(b.x, b.z))
	_mask_texture.update(_mask_image)

static func sample(at: Vector2) -> Color:
	# Same authored/mutable mask drives both the ground and ecological placement.
	if _mask_image == null: material()
	var x := clampi(floori((at.x + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var z := clampi(floori((at.y + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var color := _mask_image.get_pixel(x, z)
	if _bank_image != null: color.b = _bank_sample(at)
	return color

static func _bank_sample(at: Vector2) -> float:
	## Match the shader's filtered bank texture at local X/Z coordinates.
	var u := clampf((at.x + EXTENT) / (EXTENT * 2.0) * BANK_RESOLUTION - 0.5, 0.0, BANK_RESOLUTION - 1.0)
	var v := clampf((at.y + EXTENT) / (EXTENT * 2.0) * BANK_RESOLUTION - 0.5, 0.0, BANK_RESOLUTION - 1.0)
	var x0 := floori(u)
	var z0 := floori(v)
	var x1 := mini(x0 + 1, BANK_RESOLUTION - 1)
	var z1 := mini(z0 + 1, BANK_RESOLUTION - 1)
	var a := lerpf(float(_bank_values[z0 * BANK_RESOLUTION + x0]), float(_bank_values[z0 * BANK_RESOLUTION + x1]), u - x0)
	var b := lerpf(float(_bank_values[z1 * BANK_RESOLUTION + x0]), float(_bank_values[z1 * BANK_RESOLUTION + x1]), u - x0)
	return lerpf(a, b, v - z0) / 255.0

static func _paint_segment(a: Vector2, b: Vector2) -> void:
	var low := a.min(b) - Vector2.ONE * 5.0
	var high := a.max(b) + Vector2.ONE * 5.0
	var x0 := clampi(floori((low.x + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var x1 := clampi(ceili((high.x + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var z0 := clampi(floori((low.y + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var z1 := clampi(ceili((high.y + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var span := b - a
	for z in range(z0, z1 + 1):
		for x in range(x0, x1 + 1):
			var point := Vector2((float(x) + 0.5) / RESOLUTION * EXTENT * 2.0 - EXTENT, (float(z) + 0.5) / RESOLUTION * EXTENT * 2.0 - EXTENT)
			var t := clampf((point - a).dot(span) / maxf(span.length_squared(), 0.001), 0.0, 1.0)
			var distance := point.distance_to(a + span * t)
			if distance >= 4.5: continue
			var route := 1.0 - smoothstep(2.0, 4.5, distance)
			var prior := _mask_image.get_pixel(x, z)
			prior.r = maxf(prior.r, route)
			_mask_image.set_pixel(x, z, prior)
