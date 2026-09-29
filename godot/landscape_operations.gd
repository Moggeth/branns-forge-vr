extends RefCounted
## Deterministic heightfield commands. JSON-safe commands are replayed over the
## post-hydrology height array; animation and secondary systems consume the target.

const TYPES := ["raise", "lower", "sunder", "ridge", "flatten", "path", "crater", "smooth", "terrace"]
const MAX_COORD := 100000.0

static func validate(op: Dictionary) -> bool:
	var kind: String = str(op.get("type", ""))
	if kind not in TYPES: return false
	var needs_line: bool = kind in ["sunder", "ridge", "path"]
	if needs_line:
		var points: Variant = op.get("points")
		if not points is Array or points.size() < 2 or points.size() > 128: return false
		for point in points:
			if not _valid_point(point): return false
	else:
		if not _valid_point(op.get("center")): return false
	for key in ["radius", "width", "height", "depth", "shoulder", "target", "step"]:
		if op.has(key) and not _finite_number(op[key]): return false
	# World seeds are identifiers, not metre coordinates; normal map seeds exceed
	# the spatial bound and must not silently disable the strategic spell.
	if op.has("seed") and (not op.seed is int or absi(int(op.seed)) > 2147483647): return false
	if needs_line and float(op.get("width", 0.0)) <= 0.0: return false
	if not needs_line and float(op.get("radius", 0.0)) <= 0.0: return false
	if kind == "terrace" and float(op.get("step", 0.0)) <= 0.0: return false
	return true

static func bounds(op: Dictionary) -> Rect2:
	if not validate(op): return Rect2()
	var kind: String = str(op.type)
	var extent: float = float(op.get("radius", 0.0))
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	if kind in ["sunder", "ridge", "path"]:
		extent = float(op.width) * 0.5
		if kind == "sunder": extent += maxf(float(op.get("shoulder", extent)), 0.0)
		for raw in op.points:
			var point := _point(raw)
			lo = lo.min(point)
			hi = hi.max(point)
	else:
		lo = _point(op.center)
		hi = lo
	return Rect2(lo - Vector2.ONE * extent, hi - lo + Vector2.ONE * extent * 2.0)

static func affected_chunks(op: Dictionary, model: Dictionary, chunk_cells: int = 16) -> Array[Vector2i]:
	var result: Array[Vector2i] = []
	if not validate(op) or chunk_cells <= 0: return result
	var size: int = int(model.get("size", 0))
	var step: float = float(model.get("step", 0.0))
	if size < 2 or step <= 0.0: return result
	var origin: Vector2 = model.get("origin", Vector2.ZERO)
	var box := bounds(op)
	var low_x: int = clampi(int(floor((box.position.x - origin.x) / step)), 0, size - 1)
	var low_z: int = clampi(int(floor((box.position.y - origin.y) / step)), 0, size - 1)
	var high_x: int = clampi(int(ceil((box.end.x - origin.x) / step)), 0, size - 1)
	var high_z: int = clampi(int(ceil((box.end.y - origin.y) / step)), 0, size - 1)
	if box.end.x < origin.x or box.end.y < origin.y or box.position.x > origin.x + step * (size - 1) or box.position.y > origin.y + step * (size - 1): return result
	var last_chunk: int = (size - 2) / chunk_cells
	for cz in range(mini(low_z / chunk_cells, last_chunk), mini(high_z / chunk_cells, last_chunk) + 1):
		for cx in range(mini(low_x / chunk_cells, last_chunk), mini(high_x / chunk_cells, last_chunk) + 1):
			result.append(Vector2i(cx, cz))
	return result

static func apply(model: Dictionary, ops: Array) -> PackedFloat32Array:
	var source: PackedFloat32Array = model.get("height", PackedFloat32Array())
	var size: int = int(model.get("size", 0))
	var step: float = float(model.get("step", 0.0))
	var result := source.duplicate()
	if size < 2 or step <= 0.0 or source.size() != size * size: return result
	var origin: Vector2 = model.get("origin", Vector2.ZERO)
	for raw in ops:
		if not raw is Dictionary or not validate(raw): continue
		var op: Dictionary = raw
		var box := bounds(op)
		if box.end.x < origin.x or box.end.y < origin.y or box.position.x > origin.x + step * (size - 1) or box.position.y > origin.y + step * (size - 1): continue
		var x0: int = clampi(int(floor((box.position.x - origin.x) / step)), 0, size - 1)
		var z0: int = clampi(int(floor((box.position.y - origin.y) / step)), 0, size - 1)
		var x1: int = clampi(int(ceil((box.end.x - origin.x) / step)), 0, size - 1)
		var z1: int = clampi(int(ceil((box.end.y - origin.y) / step)), 0, size - 1)
		var before := result.duplicate() if str(op.type) == "smooth" else PackedFloat32Array()
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				var index: int = z * size + x
				var position := origin + Vector2(x, z) * step
				result[index] = _evaluate(op, position, result[index], before, x, z, size)
	return result

static func _evaluate(op: Dictionary, position: Vector2, current: float, before: PackedFloat32Array, x: int, z: int, size: int) -> float:
	var kind: String = str(op.type)
	var distance: float = 0.0
	if kind in ["sunder", "ridge", "path"]:
		distance = _line_distance(position, op.points)
	else:
		distance = position.distance_to(_point(op.center))
	var radius: float = float(op.get("width", 0.0)) * 0.5 if kind in ["sunder", "ridge", "path"] else float(op.radius)
	var weight: float = 1.0 - _smoothstep(0.0, radius, distance)
	var amount: float = float(op.get("height", op.get("depth", 2.0)))
	match kind:
		"raise": return current + amount * weight
		"lower": return current - amount * weight
		"ridge": return current + amount * weight * weight
		"sunder":
			var shoulder: float = maxf(float(op.get("shoulder", radius)), 0.001)
			var rim: float = _smoothstep(radius * 0.6, radius, distance) * (1.0 - _smoothstep(radius, radius + shoulder, distance))
			var variation: float = 1.0 + 0.13 * sin(position.x * 0.47 + position.y * 0.31 + float(op.get("seed", 0)))
			return current - float(op.get("depth", 4.0)) * weight * variation + float(op.get("height", 1.2)) * rim
		"flatten", "path":
			var target: float = float(op.get("target", 0.0))
			return lerpf(current, target, weight)
		"crater":
			var lip: float = _smoothstep(radius * 0.62, radius * 0.82, distance) * (1.0 - _smoothstep(radius * 0.82, radius, distance))
			return current - float(op.get("depth", 3.0)) * weight + float(op.get("height", 0.8)) * lip
		"smooth":
			var mean: float = 0.0
			var count: int = 0
			for dz in range(-1, 2):
				for dx in range(-1, 2):
					mean += before[clampi(z + dz, 0, size - 1) * size + clampi(x + dx, 0, size - 1)]
					count += 1
			return lerpf(current, mean / count, weight)
		"terrace":
			var level: float = float(op.step)
			return lerpf(current, roundf(current / level) * level, weight)
	return current

static func _line_distance(point: Vector2, raw_points: Array) -> float:
	var best := INF
	for i in range(raw_points.size() - 1):
		var a := _point(raw_points[i])
		var b := _point(raw_points[i + 1])
		var delta := b - a
		var t := clampf((point - a).dot(delta) / maxf(delta.length_squared(), 0.000001), 0.0, 1.0)
		best = minf(best, point.distance_to(a + delta * t))
	return best

static func _smoothstep(a: float, b: float, value: float) -> float:
	var t := clampf((value - a) / maxf(b - a, 0.000001), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)

static func _point(raw: Array) -> Vector2:
	return Vector2(float(raw[0]), float(raw[1]))

static func _valid_point(raw: Variant) -> bool:
	return raw is Array and raw.size() == 2 and _finite_number(raw[0]) and _finite_number(raw[1]) and absf(float(raw[0])) <= MAX_COORD and absf(float(raw[1])) <= MAX_COORD

static func _finite_number(value: Variant) -> bool:
	return (value is float or value is int) and is_finite(float(value)) and absf(float(value)) <= MAX_COORD
