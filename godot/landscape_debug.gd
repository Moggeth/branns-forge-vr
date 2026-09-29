extends RefCounted
## Registered 2D world genome inspector. All layers use the height grid's X/Z axes.

const LAYERS := ["overview", "base_height", "height", "slope", "flow_direction", "flow_accumulation", "rivers", "moisture", "traversability", "deformation", "chunks", "vegetation"]


static func make_image(model: Dictionary, layer: String = "overview", scale: int = 2, chunk_cells: int = 16) -> Image:
	var size: int = int(model.get("size", 0))
	if size < 2 or layer not in LAYERS: return null
	var count: int = size * size
	var height: PackedFloat32Array = model.get("height", PackedFloat32Array())
	if height.size() != count: return null
	var image := Image.create_empty(size, size, false, Image.FORMAT_RGBA8)
	var base: PackedFloat32Array = model.get("base_height", PackedFloat32Array())
	var slope: PackedFloat32Array = model.get("slope", PackedFloat32Array())
	var moisture: PackedFloat32Array = model.get("moisture", PackedFloat32Array())
	var flow: PackedInt32Array = model.get("flow_direction", PackedInt32Array())
	var accumulation: PackedFloat32Array = model.get("flow_accumulation", PackedFloat32Array())
	var water: PackedFloat32Array = model.get("water", PackedFloat32Array())
	var river_distance: PackedFloat32Array = model.get("river_distance", PackedFloat32Array())
	var traversal: PackedFloat32Array = model.get("traversability", PackedFloat32Array())
	var suitability: PackedFloat32Array = model.get("vegetation_suitability", PackedFloat32Array())
	var stats := _range(height)
	var base_stats := _range(base)
	var delta_max := 0.001
	if base.size() == count:
		for i in count: delta_max = maxf(delta_max, absf(height[i] - base[i]))
	for z in size:
		for x in size:
			var i: int = z * size + x
			var elevation: float = _norm(height[i], stats)
			var grade: float = clampf(_at(slope, i, 0.0) / 0.7, 0.0, 1.0)
			var wetness: float = clampf(_at(moisture, i, 0.4), 0.0, 1.0)
			var water_depth: float = _at(water, i)
			var river_near: float = _at(river_distance, i, 100000.0)
			var color: Color
			match layer:
				"base_height": color = _terrain(_norm(_at(base, i, height[i]), base_stats), grade, wetness)
				"height": color = _terrain(elevation, grade, wetness)
				"slope": color = Color(grade, 0.85 * (1.0 - grade), 0.24 * (1.0 - grade))
				"flow_direction":
					var down: int = flow[i] if flow.size() == count else -1
					if down < 0: color = Color(0.1, 0.1, 0.1)
					else:
						var angle: float = atan2(float(down / size - z), float(down % size - x))
						color = Color.from_hsv(fposmod(angle / TAU, 1.0), 0.86, 0.9)
				"flow_accumulation":
					var flow_value: float = log(1.0 + _at(accumulation, i)) / log(1.0 + float(count))
					color = Color(0.05, 0.10, 0.13).lerp(Color(0.25, 0.78, 1.0), clampf(flow_value * 1.7, 0.0, 1.0))
				"rivers":
					color = Color(0.16, 0.19, 0.14)
					if river_near < 12.0: color = color.lerp(Color(0.53, 0.65, 0.40), 1.0 - river_near / 12.0)
					if water_depth > 0.01: color = Color(0.07, 0.43, 0.74)
				"moisture": color = Color(0.49, 0.30, 0.13).lerp(Color(0.07, 0.55, 0.74), wetness)
				"traversability": color = Color(0.67, 0.14, 0.12).lerp(Color(0.20, 0.72, 0.30), clampf(_at(traversal, i, 1.0), 0.0, 1.0))
				"deformation":
					var delta: float = (height[i] - _at(base, i, height[i])) / delta_max
					color = Color(0.95, 0.44, 0.19).lerp(Color(0.11, 0.12, 0.13), clampf(delta + 1.0, 0.0, 1.0)) if delta < 0.0 else Color(0.11, 0.12, 0.13).lerp(Color(0.33, 0.79, 0.93), clampf(delta, 0.0, 1.0))
				"chunks":
					color = _terrain(elevation, grade, wetness)
					if chunk_cells > 0 and (x % chunk_cells == 0 or z % chunk_cells == 0): color = Color(1.0, 0.68, 0.12)
				"vegetation":
					var value: float = _at(suitability, i, clampf(wetness * (1.0 - grade), 0.0, 1.0))
					color = Color(0.20, 0.17, 0.13).lerp(Color(0.16, 0.76, 0.25), clampf(value, 0.0, 1.0))
				"overview":
					color = _terrain(elevation, grade, wetness)
					if water_depth > 0.01: color = Color(0.10, 0.46, 0.75)
			image.set_pixel(x, z, color)
	if layer == "vegetation": _draw_instances(image, model)
	if scale > 1: image.resize(size * scale, size * scale, Image.INTERPOLATE_NEAREST)
	return image


static func export_fields(model: Dictionary, output_dir: String, layers: Array = []) -> Array[String]:
	var paths: Array[String] = []
	var absolute: String = ProjectSettings.globalize_path(output_dir)
	if DirAccess.make_dir_recursive_absolute(absolute) != OK: return paths
	var selected: Array = layers if not layers.is_empty() else LAYERS
	for layer in selected:
		var image := make_image(model, str(layer))
		if image == null: continue
		var path: String = absolute.path_join(str(layer) + ".png")
		if image.save_png(path) == OK: paths.append(path)
	return paths


static func _draw_instances(image: Image, model: Dictionary) -> void:
	var instances: Array = model.get("vegetation_instances", [])
	var origin: Vector2 = model.get("origin", Vector2.ZERO)
	var step: float = float(model.get("step", 2.0))
	for instance in instances:
		var point := Vector2(INF, INF)
		if instance is Vector2: point = instance
		elif instance is Vector3: point = Vector2(instance.x, instance.z)
		elif instance is Dictionary:
			var raw: Variant = instance.get("position", null)
			if raw is Vector2: point = raw
			elif raw is Vector3: point = Vector2(raw.x, raw.z)
			elif raw is Array and raw.size() >= 2: point = Vector2(float(raw[0]), float(raw[1]))
		var x: int = roundi((point.x - origin.x) / step)
		var z: int = roundi((point.y - origin.y) / step)
		if x >= 0 and z >= 0 and x < image.get_width() and z < image.get_height(): image.set_pixel(x, z, Color(0.97, 0.94, 0.65))


static func _range(values: PackedFloat32Array) -> Vector2:
	if values.is_empty(): return Vector2(0.0, 1.0)
	var low := INF
	var high := -INF
	for value in values:
		low = minf(low, value)
		high = maxf(high, value)
	return Vector2(low, maxf(high, low + 0.001))


static func _norm(value: float, limits: Vector2) -> float:
	return clampf((value - limits.x) / (limits.y - limits.x), 0.0, 1.0)


static func _at(values: PackedFloat32Array, index: int, fallback: float = 0.0) -> float:
	return values[index] if index < values.size() else fallback


static func _terrain(elevation: float, grade: float, wetness: float) -> Color:
	var low := Color(0.20, 0.35, 0.17).lerp(Color(0.18, 0.48, 0.24), wetness)
	var high := Color(0.70, 0.68, 0.50)
	var color: Color = low.lerp(high, clampf(elevation * 0.85, 0.0, 1.0))
	return color.lerp(Color(0.48, 0.45, 0.40), clampf((grade - 0.27) * 1.5, 0.0, 0.78))
