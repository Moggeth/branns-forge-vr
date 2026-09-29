extends RefCounted
## Deterministic local A* over the authoritative landscape grid (local X/Z metres).
## Routes may cross the creek only at the authored bridge returned by Water.crossing.

const Water = preload("res://landscape_water.gd")
const NEIGHBORS := [Vector2i(1, 0), Vector2i(0, 1), Vector2i(-1, 0), Vector2i(0, -1), Vector2i(1, 1), Vector2i(-1, 1), Vector2i(-1, -1), Vector2i(1, -1)]


static func route(model: Dictionary, from_local: Vector2, to_local: Vector2, options: Dictionary = {}) -> Array[Vector2]:
	var result: Array[Vector2] = []
	if not _valid(model): return result
	var size: int = model.size
	var start: int = _index(model, from_local)
	var goal: int = _index(model, to_local)
	var bridge: Dictionary = _bridge(model, options)
	if not _cell_passable(model, start, bridge, options) or not _cell_passable(model, goal, bridge, options): return result
	if start == goal: return [from_local, to_local]
	var count: int = size * size
	var cost := PackedFloat32Array()
	var parent := PackedInt32Array()
	var closed := PackedByteArray()
	cost.resize(count)
	parent.resize(count)
	closed.resize(count)
	cost.fill(INF)
	parent.fill(-1)
	cost[start] = 0.0
	var heap: Array[Vector2] = []
	_heap_push(heap, Vector2(_heuristic(start, goal, size), start))
	while not heap.is_empty():
		var current: int = int(_heap_pop(heap).y)
		if closed[current] != 0: continue
		if current == goal: break
		closed[current] = 1
		var x: int = current % size
		var z: int = current / size
		for offset in NEIGHBORS:
			var nx: int = x + offset.x
			var nz: int = z + offset.y
			if nx < 0 or nz < 0 or nx >= size or nz >= size: continue
			var neighbor: int = nz * size + nx
			if closed[neighbor] != 0 or not _edge_passable(model, current, neighbor, bridge, options): continue
			# Diagonal moves cannot cut through a blocked corner.
			if offset.x != 0 and offset.y != 0:
				if not _edge_passable(model, current, z * size + nx, bridge, options) or not _edge_passable(model, current, nz * size + x, bridge, options): continue
			var distance: float = 1.41421356237 if offset.x != 0 and offset.y != 0 else 1.0
			var water: PackedFloat32Array = model.get("water", PackedFloat32Array())
			var wet_cost: float = 0.3 if water.size() == count and water[neighbor] > float(options.get("max_water", 0.45)) else 0.0
			var traversability: PackedFloat32Array = model.get("traversability", PackedFloat32Array())
			var rough_cost: float = (1.0 - traversability[neighbor]) * 0.4 if traversability.size() == count else 0.0
			var next_cost: float = cost[current] + distance * (1.0 + wet_cost + rough_cost)
			if next_cost >= cost[neighbor]: continue
			cost[neighbor] = next_cost
			parent[neighbor] = current
			_heap_push(heap, Vector2(next_cost + _heuristic(neighbor, goal, size), neighbor))
	if parent[goal] < 0: return result
	var reversed: Array[Vector2] = []
	var at: int = goal
	while at != start:
		reversed.append(_position(model, at))
		at = parent[at]
		if at < 0: return []
	reversed.append(_position(model, start))
	reversed.reverse()
	# Exact endpoints are useful to actors; intermediate waypoints stay on grid.
	reversed[0] = from_local
	reversed[-1] = to_local
	return reversed


static func path_passable(model: Dictionary, path: Array[Vector2], options: Dictionary = {}) -> bool:
	if not _valid(model) or path.is_empty(): return false
	var bridge: Dictionary = _bridge(model, options)
	for i in path.size():
		var at: int = _index(model, path[i])
		if not _cell_passable(model, at, bridge, options): return false
		if i == 0: continue
		var before: int = _index(model, path[i - 1])
		if before == at: continue
		# Sample long user-supplied segments too, not just routes from this planner.
		var a: Vector2 = path[i - 1]
		var b: Vector2 = path[i]
		var pieces: int = maxi(1, ceili(a.distance_to(b) / (float(model.step) * 0.5)))
		var previous: int = before
		for piece in range(1, pieces + 1):
			var next: int = _index(model, a.lerp(b, float(piece) / float(pieces)))
			if next != previous and not _edge_passable(model, previous, next, bridge, options): return false
			previous = next
	return true


static func route_needs_replan(model: Dictionary, path: Array[Vector2], dirty: Rect2, previous_op_count: int, current_op_count: int, options: Dictionary = {}) -> bool:
	if path.is_empty() or previous_op_count != current_op_count: return true
	if not dirty.has_area(): return not path_passable(model, path, options)
	var margin: float = float(model.get("step", 2.0))
	for i in path.size():
		if dirty.grow(margin).has_point(path[i]): return true
		if i > 0 and Rect2(path[i - 1], Vector2.ZERO).expand(path[i]).grow(margin).intersects(dirty): return true
	return false


static func replan_if_needed(model: Dictionary, path: Array[Vector2], from_local: Vector2, to_local: Vector2, dirty: Rect2, previous_op_count: int, current_op_count: int, options: Dictionary = {}) -> Array[Vector2]:
	if route_needs_replan(model, path, dirty, previous_op_count, current_op_count, options):
		return route(model, from_local, to_local, options)
	return path


static func _valid(model: Dictionary) -> bool:
	var size: int = int(model.get("size", 0))
	return size >= 2 and float(model.get("step", 0.0)) > 0.0 and (model.get("height", PackedFloat32Array()) as PackedFloat32Array).size() == size * size


static func _bridge(model: Dictionary, options: Dictionary) -> Dictionary:
	# Water.crossing expects a typed river polyline; bare test or dry models have none.
	if not bool(options.get("allow_bridge", true)) or not model.has("river_polyline"): return {}
	return Water.crossing(model)


static func _index(model: Dictionary, point: Vector2) -> int:
	var size: int = model.size
	var step: float = model.step
	var origin: Vector2 = model.origin
	var x: int = clampi(roundi((point.x - origin.x) / step), 0, size - 1)
	var z: int = clampi(roundi((point.y - origin.y) / step), 0, size - 1)
	return z * size + x


static func _position(model: Dictionary, index: int) -> Vector2:
	return (model.origin as Vector2) + Vector2(index % int(model.size), index / int(model.size)) * float(model.step)


static func _cell_passable(model: Dictionary, index: int, bridge: Dictionary, options: Dictionary) -> bool:
	var count: int = int(model.size) * int(model.size)
	var traversability: PackedFloat32Array = model.get("traversability", PackedFloat32Array())
	if traversability.size() == count and traversability[index] < float(options.get("min_traversability", 0.22)): return false
	var water: PackedFloat32Array = model.get("water", PackedFloat32Array())
	if water.size() == count and water[index] > float(options.get("max_water", 0.45)) and not _on_bridge(_position(model, index), bridge, options): return false
	return true


static func _edge_passable(model: Dictionary, a: int, b: int, bridge: Dictionary, options: Dictionary) -> bool:
	if not _cell_passable(model, b, bridge, options): return false
	var heights: PackedFloat32Array = model.height
	var a_bridge: bool = _on_bridge(_position(model, a), bridge, options)
	var b_bridge: bool = _on_bridge(_position(model, b), bridge, options)
	if a_bridge and b_bridge: return true # Deck spans the carved channel.
	var rise: float = absf(heights[a] - heights[b])
	var distance: float = _position(model, a).distance_to(_position(model, b))
	return rise <= float(options.get("max_step", 0.9)) and rise <= distance * float(options.get("max_grade", 0.65))


static func _on_bridge(point: Vector2, bridge: Dictionary, options: Dictionary) -> bool:
	if bridge.is_empty(): return false
	var center := Vector2(bridge.position.x, bridge.position.z)
	var delta: Vector2 = point - center
	return absf(delta.dot(bridge.along)) <= float(options.get("bridge_half_width", 2.5)) and absf(delta.dot(bridge.across)) <= float(bridge.span) * 0.5


static func _heuristic(a: int, b: int, size: int) -> float:
	var dx: int = absi(a % size - b % size)
	var dz: int = absi(a / size - b / size)
	return float(maxi(dx, dz)) + 0.41421356237 * float(mini(dx, dz))


static func _heap_push(heap: Array[Vector2], value: Vector2) -> void:
	heap.append(value)
	var at: int = heap.size() - 1
	while at > 0:
		var parent: int = (at - 1) / 2
		if _before(heap[parent], value): break
		heap[at] = heap[parent]
		at = parent
	heap[at] = value


static func _heap_pop(heap: Array[Vector2]) -> Vector2:
	var first: Vector2 = heap[0]
	var last: Vector2 = heap.pop_back()
	if heap.is_empty(): return first
	var at: int = 0
	while at * 2 + 1 < heap.size():
		var child: int = at * 2 + 1
		if child + 1 < heap.size() and _before(heap[child + 1], heap[child]): child += 1
		if _before(last, heap[child]): break
		heap[at] = heap[child]
		at = child
	heap[at] = last
	return first


static func _before(a: Vector2, b: Vector2) -> bool:
	return a.x < b.x or (a.x == b.x and a.y <= b.y)
