extends RefCounted
## Deterministic, continuous fields on the unit sphere. Coordinates are planet-local.
const BIOMES := ["temperate", "forest", "highland", "alpine", "desert", "crystal", "wetland", "magical", "ruins"]
const TAU_F := PI * 2.0
const REGION_OUTER := 0.96
const REGION_CORE := 0.18
var radius := 85.0
var seed := 1
var revision := 0
var operations: Array[Dictionary] = []
var _shape: FastNoiseLite
var _detail: FastNoiseLite
var _wet: FastNoiseLite
var _heat: FastNoiseLite
var _magic: FastNoiseLite
var _river: Array[Dictionary] = []
var _regions: Array[Dictionary] = []

func setup(new_seed: int = 1, new_radius: float = 85.0) -> void:
	seed = new_seed
	radius = maxf(10.0, new_radius)
	revision = 0
	operations.clear()
	_shape = _noise(seed, 0.73)
	_detail = _noise(seed + 7919, 3.1)
	_wet = _noise(seed + 17231, 1.31)
	_heat = _noise(seed + 26711, 0.92)
	_magic = _noise(seed + 40933, 2.2)
	_make_regions()
	_make_rivers()

func _make_regions() -> void:
	_regions.clear()
	var rng := RandomNumberGenerator.new()
	rng.seed = absi(seed) * 104729 + 53
	var axis := Vector3(rng.randf_range(-1.0, 1.0), rng.randf_range(-1.0, 1.0), rng.randf_range(-1.0, 1.0)).normalized()
	if axis.length_squared() < 0.01: axis = Vector3.UP
	var turn := Quaternion(axis, rng.randf() * TAU_F)
	for i in BIOMES.size():
		var y := 1.0 - 2.0 * (float(i) + 0.5) / float(BIOMES.size())
		var a := float(i) * 2.399963229728653
		var r := sqrt(maxf(0.0, 1.0 - y * y))
		var direction := (turn * Vector3(r * cos(a), y, r * sin(a))).normalized()
		_regions.append({"biome": BIOMES[i], "direction": direction})

func region_anchors() -> Array[Dictionary]:
	return _regions.duplicate(true)

func _region_masks(d: Vector3) -> Array[float]:
	var result: Array[float] = []
	for region in _regions:
		var direction: Vector3 = region["direction"]
		result.append(_smooth(cos(REGION_OUTER), cos(REGION_CORE), d.dot(direction)))
	return result

func _noise(noise_seed: int, frequency: float) -> FastNoiseLite:
	var n := FastNoiseLite.new()
	n.seed = noise_seed
	n.noise_type = FastNoiseLite.TYPE_SIMPLEX
	n.frequency = frequency
	n.fractal_type = FastNoiseLite.FRACTAL_FBM
	n.fractal_octaves = 3
	n.fractal_gain = 0.5
	return n

func _n(n: FastNoiseLite, d: Vector3) -> float:
	return n.get_noise_3dv(d * 3.0)

func _base_height(d: Vector3) -> float:
	var continental := _n(_shape, d)
	var ridge := 1.0 - absf(_n(_detail, d))
	var regions := _region_masks(d)
	var relief := 3.7 * regions[2] + 8.0 * regions[3] - 0.9 * regions[4] + 3.7 * regions[5] - 1.0 * regions[6] + 1.1 * regions[7] + 0.6 * regions[8]
	var rocky := (0.3 * regions[2] + 0.6 * regions[3] + 0.55 * regions[5]) * _n(_detail, d * 2.3)
	return 2.7 * continental + 1.2 * (ridge - 0.5) + 0.45 * _n(_detail, d * 2.0) + relief + rocky

func _make_rivers() -> void:
	_river.clear()
	var rng := RandomNumberGenerator.new()
	rng.seed = seed * 6364136223846793005 + 17
	for river_index in 7:
		var source := Vector3.ZERO
		var best := -INF
		for attempt in 16:
			var z := rng.randf_range(-0.9, 0.9)
			var a := rng.randf() * TAU_F
			var candidate := Vector3(sqrt(1.0 - z * z) * cos(a), z, sqrt(1.0 - z * z) * sin(a))
			var score := _base_height(candidate) + rng.randf_range(-0.3, 0.3)
			if score > best:
				best = score
				source = candidate
		var path: Array[Vector3] = [source]
		var cursor := source
		var heading := cursor.cross(Vector3.UP).normalized()
		for step in 26:
			var best_next := cursor
			var best_score := INF
			for choice in 12:
				var angle := float(choice) * TAU_F / 12.0
				var tangent := (heading * cos(angle) + cursor.cross(heading) * sin(angle)).normalized()
				var next := (cursor + tangent * 0.025).normalized()
				var score := _base_height(next) + 0.002 * float(choice)
				if score < best_score:
					best_score = score
					best_next = next
			if best_next == cursor or best_score >= _base_height(cursor):
				break
			heading = (best_next - cursor * best_next.dot(cursor)).normalized()
			cursor = best_next
			path.append(cursor)
			if _base_height(cursor) < -1.65:
				break
		_river.append({"path": path, "lake": cursor})

func _smooth(a: float, b: float, x: float) -> float:
	var t := clampf((x - a) / maxf(b - a, 0.00001), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)

func _angle(a: Vector3, b: Vector3) -> float:
	return acos(clampf(a.dot(b), -1.0, 1.0))

func _segment_distance(d: Vector3, a: Vector3, b: Vector3) -> float:
	var delta := b - a
	var t := clampf((d - a).dot(delta) / maxf(delta.length_squared(), 0.000001), 0.0, 1.0)
	return _angle(d, (a + delta * t).normalized())

func _hydrology(d: Vector3) -> Dictionary:
	var closest := INF
	var lake := INF
	for channel in _river:
		var path: Array[Vector3] = channel["path"]
		for i in range(path.size() - 1):
			closest = minf(closest, _segment_distance(d, path[i], path[i + 1]))
		lake = minf(lake, _angle(d, channel["lake"]))
	var river_width := 1.8 / radius
	var lake_width := 3.2 / radius
	var river_mask := 1.0 - _smooth(river_width * 0.45, river_width * 1.8, closest)
	var lake_mask := 1.0 - _smooth(lake_width * 0.4, lake_width * 1.25, lake)
	return {"river": river_mask, "lake": lake_mask, "water": maxf(river_mask, lake_mask)}

func _operation_height(d: Vector3) -> float:
	var total := 0.0
	for op in operations:
		var center: Vector3 = op["center"]
		var reach: float = op["radius"] / radius
		var distance := _angle(d, center)
		var weight := 1.0 - _smooth(reach * 0.25, reach, distance)
		match op["type"]:
			"path":
				var axis: Vector3 = op["axis"]
				var across := absf(asin(clampf(d.dot(center.cross(axis).normalized()), -1.0, 1.0)))
				var strip := 1.0 - _smooth(op["width"] * 0.35 / radius, op["width"] / radius, across)
				var ends := 1.0 - _smooth(reach*0.85, reach, distance)
				var hydro := _hydrology(d)
				var current: float = _base_height(d) - 1.5*hydro.river - 1.1*hydro.lake + total
				total += (float(op["target"]) - current) * strip * ends
			"raised_earth": total += op["strength"] * weight
			"crater":
				var u := distance / maxf(reach, 0.0001)
				total += op["strength"] * (-weight + 0.55 * exp(-pow((u - 0.78) * 9.0, 2.0)))
			"sunder":
				var axis: Vector3 = op["axis"]
				var along := _angle(d, center)
				var cross_distance := absf(asin(clampf(d.dot(center.cross(axis).normalized()), -1.0, 1.0)))
				var across := 1.0 - _smooth(0.0, maxf(op["width"] / radius, 0.0001), cross_distance)
				total -= op["strength"] * across * (1.0 - _smooth(reach * 0.7, reach, along))
	return total

func height_at(direction: Vector3) -> float:
	var d := direction.normalized()
	if d == Vector3.ZERO:
		return 0.0
	var hydro := _hydrology(d)
	return _base_height(d) - 1.5 * hydro["river"] - 1.1 * hydro["lake"] + _operation_height(d)

func surface_point(direction: Vector3) -> Vector3:
	var d := direction.normalized()
	return d * (radius + height_at(d))

func normal_at(direction: Vector3) -> Vector3:
	var d := direction.normalized()
	var tangent := d.cross(Vector3.UP).normalized()
	if tangent.length_squared() < 0.1:
		tangent = d.cross(Vector3.RIGHT).normalized()
	var bitangent := d.cross(tangent).normalized()
	var e := 0.001
	var dx := surface_point((d + tangent * e).normalized()) - surface_point((d - tangent * e).normalized())
	var dy := surface_point((d + bitangent * e).normalized()) - surface_point((d - bitangent * e).normalized())
	var result := dx.cross(dy).normalized()
	return result if result.dot(d) > 0.0 else -result

## render_only keeps the same seeded geography and water, but avoids finite-
## difference normals when only vertex colour and moisture are needed.
func sample(direction: Vector3, render_only: bool = false) -> Dictionary:
	var d := direction.normalized()
	var hydro := _hydrology(d)
	var height: float = _base_height(d) - 1.5 * hydro["river"] - 1.1 * hydro["lake"] + _operation_height(d)
	var regions := _region_masks(d)
	var moisture := clampf(0.52 + 0.4 * _n(_wet, d) + 0.25 * hydro["water"] + 0.35 * regions[1] - 0.48 * regions[4] + 0.42 * regions[6], 0.0, 1.0)
	var temperature := clampf(0.62 - 0.42 * absf(d.y) + 0.24 * _n(_heat, d) - maxf(height, 0.0) * 0.07 + 0.35 * regions[4] - 0.18 * regions[3], 0.0, 1.0)
	var normal: Vector3 = d if render_only else normal_at(d)
	var slope := 0.15 if render_only else acos(clampf(normal.dot(d), -1.0, 1.0)) / (PI * 0.5)
	var magic := clampf(0.5 + _n(_magic, d) + 0.42 * regions[5] + 0.48 * regions[7], 0.0, 1.0)
	var weights := {
		"temperate": 0.2 + 0.55 * moisture * temperature,
		"forest": _smooth(0.43, 0.72, moisture) * (1.0 - slope),
		"highland": _smooth(0.9, 2.4, height) * (1.0 - _smooth(3.0, 5.0, height)),
		"alpine": _smooth(2.7, 4.8, height) * (1.0 - temperature * 0.4),
		"desert": (1.0 - _smooth(0.2, 0.48, moisture)) * temperature,
		"crystal": _smooth(0.7, 0.94, magic) * _smooth(0.2, 2.0, height),
		"wetland": _smooth(0.62, 0.88, moisture) * (1.0 - _smooth(0.0, 1.4, height)),
		"magical": _smooth(0.65, 0.9, magic),
		"ruins": 0.08 + 0.27 * _smooth(0.75, 0.92, magic) * (1.0 - slope),
	}
	for i in BIOMES.size():
		weights[BIOMES[i]] += 2.7 * regions[i]
	for op in operations:
		if op["type"] == "forest":
			var weight := 1.0 - _smooth(0.0, op["radius"] / radius, _angle(d, op["center"]))
			weights["forest"] += op["strength"] * weight
	var total := 0.0
	for key in weights:
		weights[key] = maxf(0.0, weights[key])
		total += weights[key]
	for key in weights:
		weights[key] /= maxf(total, 0.0001)
	var biome := "temperate"
	for key in weights:
		if weights[key] > weights[biome]:
			biome = key
	var water: bool = float(hydro["water"]) > 0.45 or height < -1.7
	return {"height": height, "radius": radius + height, "normal": normal, "weights": weights, "biome": biome, "moisture": moisture, "temperature": temperature, "slope": slope, "water": water, "river": hydro["river"], "lake": hydro["lake"], "suitability": clampf((1.0 - slope) * moisture * (1.0 if not water else 0.0), 0.0, 1.0)}

func apply_operation(input: Dictionary) -> Dictionary:
	var kind := str(input.get("type", ""))
	if not kind in ["raised_earth", "sunder", "crater", "forest", "path"]:
		return {"ok": false, "error": "Unknown operation"}
	var center: Vector3 = input.get("center", input.get("direction", Vector3.ZERO))
	if center.length_squared() < 0.01:
		return {"ok": false, "error": "Missing unit direction"}
	center = center.normalized()
	var reach := clampf(float(input.get("radius", 5.0)), 0.2, radius * 0.6)
	var strength := clampf(float(input.get("strength", 2.0)), -10.0, 10.0)
	var axis: Vector3 = input.get("axis", Vector3.UP)
	if absf(center.dot(axis.normalized())) > 0.95:
		axis = Vector3.RIGHT
	axis = (axis - center * axis.dot(center)).normalized()
	var width := clampf(float(input.get("width", 1.2)), 0.2, reach)
	var op := {"type": kind, "center": center, "radius": reach, "strength": strength, "axis": axis, "width": width}
	if kind == "path": op["target"] = float(input.get("target", height_at(center)))
	operations.append(op)
	revision += 1
	return {"ok": true, "revision": revision, "center": center, "direction": center, "angular_radius": reach / radius, "radius": reach}

func snapshot() -> Dictionary:
	var saved: Array[Dictionary] = []
	for op in operations:
		var center: Vector3 = op["center"]
		var axis: Vector3 = op["axis"]
		saved.append({"type": op["type"], "center": [center.x, center.y, center.z], "axis": [axis.x, axis.y, axis.z], "radius": op["radius"], "strength": op["strength"], "width": op["width"]})
		if op.has("target"): saved.back()["target"] = op["target"]
	return {"version": 1, "seed": seed, "radius": radius, "operations": saved}

func load_snapshot(data: Dictionary) -> bool:
	if int(data.get("version", 0)) != 1:
		return false
	setup(int(data.get("seed", 1)), float(data.get("radius", 85.0)))
	for saved in data.get("operations", []):
		if not saved is Dictionary:
			return false
		var c: Array = saved.get("center", [])
		var a: Array = saved.get("axis", [])
		if c.size() != 3 or a.size() != 3:
			return false
		var payload := {"type": saved.get("type", ""), "center": Vector3(c[0], c[1], c[2]), "axis": Vector3(a[0], a[1], a[2]), "radius": saved.get("radius", 5.0), "strength": saved.get("strength", 2.0), "width": saved.get("width", 1.2)}
		if saved.has("target"): payload["target"] = saved["target"]
		var result := apply_operation(payload)
		if not result["ok"]:
			return false
	return true
