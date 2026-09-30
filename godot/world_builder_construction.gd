extends Node
## Bounded, local-space timber structures. The builder persists records and resources.
const W = preload("res://world_zones.gd")
const KINDS := ["bridge", "ramp", "stairs", "boardwalk"]
const MAX_RECORDS := 32
const WIDTH := {"bridge": 4.0, "ramp": 3.0, "stairs": 3.0, "boardwalk": 3.4}
const LIMIT := {"bridge": 32.0, "ramp": 18.0, "stairs": 18.0, "boardwalk": 36.0}

var builder: Node
var root: Node3D


func setup(owner_builder: Node) -> void:
	builder = owner_builder
	root = owner_builder.root


func preview(kind: String, a: Vector3, b: Vector3) -> Dictionary:
	var result := {"valid": false, "reason": "", "lumber": 0, "kind": kind, "a": a, "b": b,
		"width": float(WIDTH.get(kind, 0.0)), "length": 0.0}
	if kind not in KINDS: return _reject(result, "Unknown construction type.")
	if builder == null or builder.game == null: return _reject(result, "The orchard is not ready.")
	if not _finite_point(a) or not _finite_point(b): return _reject(result, "Choose two points inside the orchard.")
	var aa := Vector2(a.x, a.z)
	var bb := Vector2(b.x, b.z)
	var length := aa.distance_to(bb)
	result.length = length
	result.lumber = _cost(kind, length)
	if length < 3.0: return _reject(result, "The endpoints must be at least 3 m apart.")
	if length > float(LIMIT[kind]): return _reject(result, "This %s is too long (maximum %.0f m)." % [kind, float(LIMIT[kind])])
	if absf(a.x) > 152.0 or absf(a.z) > 152.0 or absf(b.x) > 152.0 or absf(b.z) > 152.0:
		return _reject(result, "Keep both endpoints inside the orchard.")
	if builder.data.get("constructions", []).size() >= MAX_RECORDS:
		return _reject(result, "The settlement has reached its structure limit.")
	var landscape: Node = builder.game.landscape
	var ay: float = landscape.height_at(aa)
	var by: float = landscape.height_at(bb)
	var grade: float = absf(by - ay) / length
	var max_grade := 0.48 if kind == "ramp" else (0.90 if kind == "stairs" else 0.35)
	if grade > max_grade:
		return _reject(result, "The bank is too steep for this %s (%.0f%% grade)." % [kind, max_grade * 100.0])
	var wet := 0
	var unsupported := 0
	for i in range(1, 12):
		var t := float(i) / 12.0
		var at := aa.lerp(bb, t)
		var terrain: float = landscape.height_at(at)
		if landscape.water_at(at) > 0.45: wet += 1
		if terrain > lerpf(ay, by, t) + 0.5: return _reject(result, "High ground cuts through the proposed deck.")
		if lerpf(ay, by, t) - terrain > 4.5: unsupported += 1
	if unsupported > 0: return _reject(result, "The deck needs support taller than 4.5 m.")
	if kind == "bridge":
		if landscape.water_at(aa) > 0.45 or landscape.water_at(bb) > 0.45:
			return _reject(result, "Set both bridge endpoints on dry banks.")
		if wet == 0: return _reject(result, "A bridge must span water between two dry banks.")
	elif kind == "boardwalk":
		if wet == 0 and grade > 0.12: return _reject(result, "A dry, sloping route needs a ramp or stairs.")
	elif wet > 0:
		return _reject(result, "Use a bridge or boardwalk over water.")
	if _blocked_by_structure(aa, bb, result.width):
		return _reject(result, "The proposed deck overlaps another structure.")
	if _blocked_by_trees(aa, bb, result.width):
		return _reject(result, "A standing tree blocks the deck. Fell it first.")
	result.a = Vector3(a.x, ay + 0.20, a.z)
	result.b = Vector3(b.x, by + 0.20, b.z)
	if int(builder.data.get("wood", 0)) < int(result.lumber):
		return _reject(result, "Needs %d lumber; stockpile has %d." % [result.lumber, int(builder.data.get("wood", 0))])
	result.valid = true
	return result


func place(kind: String, a: Vector3, b: Vector3) -> String:
	var plan := preview(kind, a, b)
	if not plan.valid: return str(plan.reason)
	var record := {"kind": kind, "a": _pack(plan.a), "b": _pack(plan.b), "width": float(plan.width)}
	if not valid_records([record]): return "The proposed structure could not be saved."
	builder.data.wood = int(builder.data.wood) - int(plan.lumber)
	if not builder.data.has("constructions"): builder.data.constructions = []
	builder.data.constructions.append(record)
	_render(record)
	builder._changed("Built a %s for %d lumber." % [kind, int(plan.lumber)])
	return ""


func restore() -> void:
	if builder == null: return
	for record in builder.data.get("constructions", []): _render(record)


func surface_height(point: Vector2, ground: float) -> float:
	if builder == null: return ground
	for record in builder.data.get("constructions", []):
		var deck := deck_height(record, point)
		if deck > -999.0: ground = maxf(ground, deck)
	return ground


func navigation_options() -> Dictionary:
	return {"constructions": builder.data.get("constructions", []) if builder != null else []}


static func valid_records(records: Variant) -> bool:
	if not records is Array or records.size() > MAX_RECORDS: return false
	for record in records:
		if not record is Dictionary or str(record.get("kind", "")) not in KINDS: return false
		if not _valid_packed(record.get("a")) or not _valid_packed(record.get("b")): return false
		var width: Variant = record.get("width")
		if not width is float and not width is int: return false
		if absf(float(width) - float(WIDTH[record.kind])) > 0.01: return false
		var a := Vector2(float(record.a[0]), float(record.a[2]))
		var b := Vector2(float(record.b[0]), float(record.b[2]))
		var distance := a.distance_to(b)
		if distance < 3.0 or distance > float(LIMIT[record.kind]) + 0.01: return false
		if absf(float(record.b[1]) - float(record.a[1])) / distance > 0.91: return false
	return true


static func deck_height(record: Dictionary, point: Vector2, margin: float = 0.0) -> float:
	var a := Vector2(float(record.a[0]), float(record.a[2]))
	var b := Vector2(float(record.b[0]), float(record.b[2]))
	var span := b - a
	var length_squared := span.length_squared()
	var t := (point - a).dot(span) / length_squared
	if t < -margin / sqrt(length_squared) or t > 1.0 + margin / sqrt(length_squared): return -1000.0
	var lateral := absf(span.cross(point - a)) / sqrt(length_squared)
	if lateral > float(record.width) * 0.5 + margin: return -1000.0
	var y := lerpf(float(record.a[1]), float(record.b[1]), clampf(t, 0.0, 1.0))
	if str(record.kind) == "stairs":
		var count := maxi(ceili(absf(float(record.b[1]) - float(record.a[1])) / 0.18), ceili(sqrt(length_squared) / 0.48))
		y = lerpf(float(record.a[1]), float(record.b[1]), floorf(clampf(t, 0.0, 0.9999) * count + 1.0) / float(count))
	return y


static func _valid_packed(value: Variant) -> bool:
	if not value is Array or value.size() != 3: return false
	for scalar in value:
		if not scalar is float and not scalar is int: return false
		if not is_finite(float(scalar)) or absf(float(scalar)) > 155.0: return false
	return true


static func _finite_point(point: Vector3) -> bool:
	return is_finite(point.x) and is_finite(point.y) and is_finite(point.z)


static func _pack(point: Vector3) -> Array:
	return [snappedf(point.x, 0.01), snappedf(point.y, 0.01), snappedf(point.z, 0.01)]


static func _cost(kind: String, length: float) -> int:
	return maxi(2, ceili(length * float(WIDTH.get(kind, 3.0)) / 10.0) + (2 if kind == "bridge" else 1))


static func _reject(result: Dictionary, reason: String) -> Dictionary:
	result.reason = reason
	return result


func _blocked_by_structure(a: Vector2, b: Vector2, width: float) -> bool:
	if not builder.data.get("bridges", []).is_empty():
		var old_crossing := Vector2(25.0, -48.0)
		if Geometry2D.get_closest_point_to_segment(old_crossing, a, b).distance_to(old_crossing) < width * 0.5 + 3.0: return true
	for record in builder.data.get("constructions", []):
		var other_a := Vector2(float(record.a[0]), float(record.a[2]))
		var other_b := Vector2(float(record.b[0]), float(record.b[2]))
		for i in range(1, 12):
			var point := a.lerp(b, float(i) / 12.0)
			var closest := Geometry2D.get_closest_point_to_segment(point, other_a, other_b)
			if closest.distance_to(point) < (width + float(record.width)) * 0.5:
				var shared_endpoint := (a.distance_to(other_a) < 1.0 or a.distance_to(other_b) < 1.0 or b.distance_to(other_a) < 1.0 or b.distance_to(other_b) < 1.0)
				if not shared_endpoint or (point.distance_to(a) > width and point.distance_to(b) > width): return true
	return false


func _blocked_by_trees(a: Vector2, b: Vector2, width: float) -> bool:
	for key in builder.scenic_by_key:
		if key in builder.data.harvested: continue
		var tree: Vector3 = builder.scenic_by_key[key].position
		if Geometry2D.get_closest_point_to_segment(Vector2(tree.x, tree.z), a, b).distance_to(Vector2(tree.x, tree.z)) < width * 0.5 + 0.45: return true
	if builder.get("resource_by_key") is Dictionary:
		for key in builder.resource_by_key:
			if key in builder.data.harvested: continue
			var tree: Node3D = builder.resource_by_key[key]
			if not is_instance_valid(tree) or not tree.visible: continue
			var local: Vector3 = tree.global_position - builder.center
			if Geometry2D.get_closest_point_to_segment(Vector2(local.x, local.z), a, b).distance_to(Vector2(local.x, local.z)) < width * 0.5 + 0.55: return true
	return false


func _render(record: Dictionary) -> void:
	var a := Vector3(float(record.a[0]), float(record.a[1]), float(record.a[2]))
	var b := Vector3(float(record.b[0]), float(record.b[1]), float(record.b[2]))
	var horizontal := Vector2(b.x - a.x, b.z - a.z)
	var length := horizontal.length()
	var node := Node3D.new()
	node.name = "Built%s_%02d" % [str(record.kind).capitalize(), root.get_child_count()]
	root.add_child(node)
	node.position = (a + b) * 0.5
	node.rotation.y = atan2(horizontal.x, horizontal.y)
	var width := float(record.width)
	if str(record.kind) == "stairs":
		var steps := maxi(1, ceili(absf(b.y - a.y) / 0.18))
		steps = maxi(steps, ceili(length / 0.48))
		for i in steps:
			var t := (float(i) + 0.5) / float(steps)
			var y := lerpf(a.y, b.y, float(i + 1) / float(steps)) - node.position.y
			var pos := Vector3(0, y - 0.09, (t - 0.5) * length)
			W.box(node, pos, Vector3(width, 0.18, length / float(steps) + 0.02), "9b7048")
			W.body(node, pos, Vector3(width, 0.18, length / float(steps) + 0.02), "floor")
	else:
		var pitch := -atan2(b.y - a.y, length)
		var deck := Node3D.new()
		node.add_child(deck)
		deck.rotation.x = pitch
		W.box(deck, Vector3(0, -0.11, 0), Vector3(width, 0.22, length + 0.10), "9b7048")
		W.body(deck, Vector3(0, -0.11, 0), Vector3(width, 0.22, length + 0.10), "floor")
	if str(record.kind) in ["bridge", "boardwalk"]:
		for side in [-1.0, 1.0]:
			var rail := Node3D.new()
			node.add_child(rail)
			rail.rotation.x = -atan2(b.y - a.y, length)
			W.box(rail, Vector3(side * (width * 0.5 - 0.10), 0.48, 0), Vector3(0.15, 0.16, length), "745139")
			W.body(rail, Vector3(side * (width * 0.5 - 0.10), 0.48, 0), Vector3(0.15, 0.16, length), "solid")
			for end in [-1.0, 1.0]:
				W.box(rail, Vector3(side * (width * 0.5 - 0.10), 0.17, end * length * 0.48), Vector3(0.19, 0.52, 0.19), "63442e")
