extends RefCounted
## Stable world-cell vegetation. Every candidate depends only on seed, cell and shared fields,
## so a dirty rectangle can be regenerated without changing its neighbours.

const Fields = preload("res://landscape_fields.gd")
const SPACING := {"tree": 6.0, "rock": 5.0, "shrub": 3.2}
const MIN_DISTANCE := {"tree": 4.5, "rock": 3.5, "shrub": 2.3}


static func build_fields(model: Dictionary, bounds: Rect2 = Rect2()) -> void:
	var size: int = int(model.size)
	var count := size * size
	var trees: PackedFloat32Array = model.get("vegetation_suitability", PackedFloat32Array())
	var rocks: PackedFloat32Array = model.get("rock_suitability", PackedFloat32Array())
	var shrubs: PackedFloat32Array = model.get("shrub_suitability", PackedFloat32Array())
	var full_update := not bounds.has_area() or trees.size() != count or rocks.size() != count or shrubs.size() != count
	if full_update:
		trees.resize(count)
		rocks.resize(count)
		shrubs.resize(count)
	var origin: Vector2 = model.origin
	var step: float = model.step
	var x0 := 0 if full_update else clampi(floori((bounds.position.x - origin.x) / step), 0, size - 1)
	var x1 := size - 1 if full_update else clampi(ceili((bounds.end.x - origin.x) / step), 0, size - 1)
	var z0 := 0 if full_update else clampi(floori((bounds.position.y - origin.y) / step), 0, size - 1)
	var z1 := size - 1 if full_update else clampi(ceili((bounds.end.y - origin.y) / step), 0, size - 1)
	var seed: int = int(model.seed)
	var pockets := FastNoiseLite.new()
	pockets.seed = seed + 6101
	pockets.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	pockets.frequency = 0.014
	pockets.fractal_type = FastNoiseLite.FRACTAL_FBM
	pockets.fractal_octaves = 2
	var open_spaces := FastNoiseLite.new()
	open_spaces.seed = seed + 6203
	open_spaces.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	open_spaces.frequency = 0.007
	for z in range(z0, z1 + 1):
		for x in range(x0, x1 + 1):
			var i := z * size + x
			var p := origin + Vector2(x, z) * step
			var slope: float = (model.slope as PackedFloat32Array)[i]
			var moisture: float = (model.moisture as PackedFloat32Array)[i]
			var elevation: float = (model.height as PackedFloat32Array)[i]
			var river_distance: float = _field_at(model, "river_distance", i, 1000000.0)
			var river_width: float = _field_at(model, "river_width", i, 0.0)
			var water: float = _field_at(model, "water", i, 0.0)
			var path_distance: float = _field_at(model, "path_distance", i, 1000000.0)
			var exclusion: float = _field_at(model, "exclusion", i, 0.0)
			var clearing: float = _field_at(model, "clearing", i, 0.0)
			var camp_clear := 1.0 - smoothstep(12.0, 23.0, p.distance_to(Vector2(15.0, -27.0)))
			var open_factor := 1.0 - smoothstep(0.20, 0.60, open_spaces.get_noise_2d(p.x, p.y)) * 0.60
			var cluster := clampf(0.43 + pockets.get_noise_2d(p.x, p.y) * 1.0, 0.0, 1.0) * open_factor
			var dry := 1.0 - smoothstep(0.10, 0.48, moisture)
			var water_clear := smoothstep(maxf(3.5, river_width * 0.5 + 2.0), maxf(8.0, river_width * 0.5 + 7.0), river_distance)
			var path_clear := smoothstep(2.0, 7.0, path_distance)
			var common := (1.0 - clampf(exclusion + clearing + camp_clear, 0.0, 1.0)) * (1.0 if water <= 0.05 else 0.0)
			var elevation_tree := 1.0 - smoothstep(7.0, 19.0, elevation)
			trees[i] = clampf(common * water_clear * path_clear * (1.0 - smoothstep(0.19, 0.60, slope)) * elevation_tree * (0.40 + moisture * 0.72) * cluster, 0.0, 1.0)
			rocks[i] = clampf(common * (0.13 + slope * 1.7 + dry * 0.30) * (0.60 + (1.0 - cluster) * 0.5) * smoothstep(1.0, 5.0, river_distance), 0.0, 1.0)
			shrubs[i] = clampf(common * smoothstep(2.0, 5.5, river_distance) * smoothstep(1.0, 4.0, path_distance) * (1.0 - smoothstep(0.38, 0.85, slope)) * (0.35 + moisture * 0.6) * (0.35 + cluster * 0.8), 0.0, 1.0)
	model["vegetation_suitability"] = trees
	model["rock_suitability"] = rocks
	model["shrub_suitability"] = shrubs


static func generate(model: Dictionary, seed: int = -1, bounds: Rect2 = Rect2()) -> Dictionary:
	## Empty bounds means the complete world. A nonempty bounds returns only centres inside it.
	if not model.has("vegetation_suitability"): build_fields(model)
	if seed == -1: seed = int(model.seed)
	var result := {"trees": [], "rocks": [], "shrubs": []}
	var world := _world_bounds(model)
	var query: Rect2 = bounds if bounds.has_area() else world
	for kind in SPACING:
		var item_bounds: Rect2 = query.intersection(world)
		if not item_bounds.has_area(): continue
		var cell: float = SPACING[kind]
		var x0 := floori(item_bounds.position.x / cell) - 1
		var x1 := ceili(item_bounds.end.x / cell) + 1
		var z0 := floori(item_bounds.position.y / cell) - 1
		var z1 := ceili(item_bounds.end.y / cell) + 1
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				var point := _candidate(seed, kind, x, z)
				if not query.has_point(point) or not world.has_point(point): continue
				if Fields.sample(model, "water", point) > 0.05: continue
				var suitability := Fields.sample(model, _field_name(kind), point)
				if _unit(seed, x, z, _salt(kind) + 3) > suitability * _density(kind): continue
				if not _accepted(seed, kind, x, z, point): continue
				var instance := _instance(model, seed, kind, x, z, point)
				(result[_plural(kind)] as Array).append(instance)
	return result


static func grow(model: Dictionary, region: Dictionary, seed: int) -> Array[Dictionary]:
	## JSON-friendly region: {type:line, points:[[x,z],...], width:m},
	## {type:ring, center:[x,z], radius:m, width:m},
	## {type:circle, center:[x,z], radius:m}, or {type:polygon, points:[...]}.
	if not model.has("vegetation_suitability"): build_fields(model)
	var box := _region_bounds(region)
	var result: Array[Dictionary] = []
	if not box.has_area(): return result
	var world := _world_bounds(model)
	var cell := 4.5
	var x0 := floori(box.position.x / cell) - 1
	var x1 := ceili(box.end.x / cell) + 1
	var z0 := floori(box.position.y / cell) - 1
	var z1 := ceili(box.end.y / cell) + 1
	for z in range(z0, z1 + 1):
		for x in range(x0, x1 + 1):
			var point := _candidate(seed, "growth", x, z)
			if not world.has_point(point) or not _in_region(region, point): continue
			if Fields.sample(model, "water", point) > 0.05: continue
			var suitable := Fields.sample(model, "vegetation_suitability", point)
			if suitable < 0.08 or _unit(seed, x, z, 533) > clampf(suitable * 1.8, 0.0, 1.0): continue
			if not _accepted(seed, "growth", x, z, point): continue
			var instance := _instance(model, seed, "tree", x, z, point)
			instance.id = "growth:%d:%d:%d" % [seed, x, z]
			result.append(instance)
	return result


static func grow_ring(model: Dictionary, center: Vector2, radius: float, seed: int) -> Array[Dictionary]:
	## A ring is a deliberate spell rather than a random forest mask. Angular
	## slots keep its silhouette legible while small seeded shifts and shared
	## water/slope/path fields keep the trees grounded in this landscape.
	var rng := RandomNumberGenerator.new()
	rng.seed = seed
	var trees: Array[Dictionary] = []
	var world := _world_bounds(model)
	for slot in 18:
		for attempt in 4:
			var angle := TAU * float(slot) / 18.0 + rng.randf_range(-0.10, 0.10)
			var distance := radius + rng.randf_range(-2.0, 2.0)
			var point := center + Vector2(cos(angle), sin(angle)) * distance
			if not world.has_point(point): continue
			if Fields.sample(model, "water", point) > 0.05: continue
			if Fields.sample(model, "slope", point) > 0.58: continue
			if model.has("path_distance") and Fields.sample(model, "path_distance", point) < 3.5: continue
			if model.has("exclusion") and Fields.sample(model, "exclusion", point) > 0.65: continue
			var crowded := false
			for other in trees:
				var at: Vector3 = other.position
				if point.distance_squared_to(Vector2(at.x, at.z)) < 4.2 * 4.2: crowded = true; break
			if crowded: continue
			var species_roll := rng.randf()
			trees.append({"id":"ring:%d:%d" % [seed,slot], "kind":"tree",
				"species":"oak" if species_roll < 0.55 else "birch" if species_roll < 0.82 else "pine",
				"position":Vector3(point.x, Fields.sample(model, "height", point), point.y),
				"rotation":rng.randf_range(0.0, TAU), "scale":rng.randf_range(0.86, 1.18)})
			break
	return trees


static func _field_at(model: Dictionary, field: String, i: int, fallback: float) -> float:
	var values: PackedFloat32Array = model.get(field, PackedFloat32Array())
	return values[i] if i < values.size() else fallback


static func _field_name(kind: String) -> String:
	if kind == "tree": return "vegetation_suitability"
	if kind == "rock": return "rock_suitability"
	return "shrub_suitability"


static func _plural(kind: String) -> String:
	return "trees" if kind == "tree" else "rocks" if kind == "rock" else "shrubs"


static func _density(kind: String) -> float:
	return 0.82 if kind == "tree" else 0.44 if kind == "rock" else 0.78


static func _salt(kind: String) -> int:
	return 17 if kind == "tree" else 41 if kind == "rock" else 73 if kind == "shrub" else 101


static func _candidate(seed: int, kind: String, x: int, z: int) -> Vector2:
	var cell: float = SPACING.get(kind, 4.5)
	var salt := _salt(kind)
	return Vector2((float(x) + 0.16 + _unit(seed, x, z, salt) * 0.68) * cell, (float(z) + 0.16 + _unit(seed, x, z, salt + 1) * 0.68) * cell)


static func _accepted(seed: int, kind: String, x: int, z: int, point: Vector2) -> bool:
	var threshold: float = MIN_DISTANCE.get(kind, 3.3)
	var rank := _unit(seed, x, z, _salt(kind) + 2)
	for dz in range(-1, 2):
		for dx in range(-1, 2):
			if dx == 0 and dz == 0: continue
			var other := _candidate(seed, kind, x + dx, z + dz)
			if point.distance_squared_to(other) >= threshold * threshold: continue
			var other_rank := _unit(seed, x + dx, z + dz, _salt(kind) + 2)
			if other_rank > rank or (other_rank == rank and (z + dz < z or (z + dz == z and x + dx < x))): return false
	return true


static func _instance(model: Dictionary, seed: int, kind: String, x: int, z: int, point: Vector2) -> Dictionary:
	var h := Fields.sample(model, "height", point)
	var variation := _unit(seed, x, z, _salt(kind) + 5)
	var species := "oak" if variation < 0.55 else "birch" if variation < 0.85 else "pine"
	if kind == "rock": species = "boulder" if variation < 0.22 else "fieldstone"
	if kind == "shrub": species = "fern" if variation < 0.55 else "bramble"
	return {
		"id": "%s:%d:%d:%d" % [kind, seed, x, z], "kind": kind, "species": species,
		"position": Vector3(point.x, h, point.y),
		"rotation": TAU * _unit(seed, x, z, _salt(kind) + 6),
		"scale": lerpf(0.75, 1.3, _unit(seed, x, z, _salt(kind) + 7)),
	}


static func _world_bounds(model: Dictionary) -> Rect2:
	var origin: Vector2 = model.origin
	var span: float = float(int(model.size) - 1) * float(model.step)
	return Rect2(origin, Vector2.ONE * span)


static func _region_bounds(region: Dictionary) -> Rect2:
	var kind: String = str(region.get("type", ""))
	if kind in ["circle", "ring"]:
		var center := _point(region.get("center", []))
		var radius: float = float(region.get("radius", 0.0))
		if radius <= 0.0: return Rect2()
		var reach := radius + maxf(0.0, float(region.get("width", 0.0))) * 0.5
		return Rect2(center - Vector2.ONE * reach, Vector2.ONE * reach * 2.0)
	if kind not in ["line", "polygon"]: return Rect2()
	var points: Array = region.get("points", [])
	if points.size() < (2 if kind == "line" else 3): return Rect2()
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for raw in points:
		var point := _point(raw)
		lo = lo.min(point)
		hi = hi.max(point)
	var margin: float = maxf(0.0, float(region.get("width", 0.0))) * 0.5
	return Rect2(lo - Vector2.ONE * margin, hi - lo + Vector2.ONE * margin * 2.0)


static func _in_region(region: Dictionary, point: Vector2) -> bool:
	var kind: String = str(region.get("type", ""))
	if kind == "circle": return point.distance_to(_point(region.center)) <= float(region.radius)
	if kind == "ring": return absf(point.distance_to(_point(region.center)) - float(region.radius)) <= float(region.get("width", 4.0)) * 0.5
	var raw_points: Array = region.get("points", [])
	if kind == "line":
		for i in range(raw_points.size() - 1):
			var a := _point(raw_points[i])
			var b := _point(raw_points[i + 1])
			var delta := b - a
			var t := clampf((point - a).dot(delta) / maxf(delta.length_squared(), 0.0001), 0.0, 1.0)
			if point.distance_to(a + delta * t) <= float(region.get("width", 4.0)) * 0.5: return true
		return false
	if kind == "polygon":
		var polygon := PackedVector2Array()
		for raw in raw_points: polygon.append(_point(raw))
		return Geometry2D.is_point_in_polygon(point, polygon)
	return false


static func _point(raw: Variant) -> Vector2:
	if raw is Vector2: return raw
	if raw is Array and raw.size() >= 2: return Vector2(float(raw[0]), float(raw[1]))
	return Vector2.ZERO


static func _unit(seed: int, x: int, z: int, salt: int) -> float:
	var value := x * 73856093 ^ z * 19349663 ^ seed * 83492791 ^ salt * 2654435761
	value = (value ^ (value >> 13)) * 1274126177
	return float((value ^ (value >> 16)) & 0x7fffffff) / 2147483647.0
