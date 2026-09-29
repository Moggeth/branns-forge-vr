extends RefCounted
## Deterministic, grid-based water compiler. Grid index is z * size + x.
## Coordinates and river_polyline are local to the landscape origin.

const MAIN_BANK: float = 25.0
const MAIN_REACH: float = 34.0
const TRIBUTARY_THRESHOLD: float = 145.0


static func run(model: Dictionary, river_controls: Array[Vector2]) -> Dictionary:
	var size: int = int(model.get("size", 0))
	var step: float = float(model.get("step", 2.0))
	if size < 3 or step <= 0.0:
		push_error("Hydrology needs a square height grid and positive step")
		return model
	var count: int = size * size
	var height: PackedFloat32Array = model.get("height", PackedFloat32Array())
	if height.size() != count:
		push_error("Hydrology height size does not match size * size")
		return model
	height = height.duplicate()
	var origin: Vector2 = model.get("origin", Vector2(-160, -160))
	var controls: Array[Vector2] = river_controls
	if controls.size() < 2:
		controls = default_controls(model)
	var route: Array[Vector2] = _sample_route(controls, step, int(model.get("seed", 1)))
	var river_distance := PackedFloat32Array()
	var river_width := PackedFloat32Array()
	var river_depth := PackedFloat32Array()
	var water := PackedFloat32Array()
	var water_level := PackedFloat32Array()
	river_distance.resize(count)
	river_width.resize(count)
	river_depth.resize(count)
	water.resize(count)
	water_level.resize(count)
	river_distance.fill(1000000.0)
	water_level.fill(-1000000.0)
	var levels := PackedFloat32Array()
	levels.resize(route.size())
	var previous_level: float = _sample_height(height, size, step, origin, route[0]) - 0.7
	for i in route.size():
		var current: float = _sample_height(height, size, step, origin, route[i]) - 0.7
		if i > 0:
			# A directed river always descends, even when its controls cross a rise.
			current = minf(current, previous_level - route[i].distance_to(route[i - 1]) * 0.0015)
		levels[i] = current
		previous_level = current
	var polyline: Array[Vector3] = []
	for i in route.size():
		polyline.append(Vector3(route[i].x, levels[i], route[i].y))
	for i in route.size() - 1:
		var a: Vector2 = route[i]
		var b: Vector2 = route[i + 1]
		var tangent: Vector2 = b - a
		var length_sq: float = tangent.length_squared()
		if length_sq < 0.0001: continue
		var first_x: int = maxi(0, floori((minf(a.x, b.x) - MAIN_REACH - origin.x) / step))
		var last_x: int = mini(size - 1, ceili((maxf(a.x, b.x) + MAIN_REACH - origin.x) / step))
		var first_z: int = maxi(0, floori((minf(a.y, b.y) - MAIN_REACH - origin.y) / step))
		var last_z: int = mini(size - 1, ceili((maxf(a.y, b.y) + MAIN_REACH - origin.y) / step))
		for z in range(first_z, last_z + 1):
			for x in range(first_x, last_x + 1):
				var p := origin + Vector2(x, z) * step
				var t: float = clampf((p - a).dot(tangent) / length_sq, 0.0, 1.0)
				var distance: float = p.distance_to(a + tangent * t)
				var index: int = z * size + x
				if distance >= river_distance[index]: continue
				river_distance[index] = distance
				var width: float = 6.2 + 1.8 * sin(float(i) * 0.055 + 0.3)
				var depth: float = 1.2 + 0.3 * sin(float(i) * 0.11)
				river_width[index] = width
				river_depth[index] = depth
				water_level[index] = lerpf(levels[i], levels[i + 1], t)
	for index in count:
		var distance: float = river_distance[index]
		if distance >= MAIN_REACH: continue
		var half_width: float = river_width[index] * 0.5
		var bank_t: float = clampf((distance - half_width) / MAIN_BANK, 0.0, 1.0)
		var ease: float = bank_t * bank_t * (3.0 - 2.0 * bank_t)
		var carve_weight: float = 1.0 - ease
		var bed: float = water_level[index] - river_depth[index]
		# Fade the *amount removed* into the existing ground. The former profile
		# ended below that ground and made a near-vertical lip at its outer edge.
		if distance < half_width + MAIN_BANK:
			height[index] -= maxf(0.0, height[index] - bed) * carve_weight
		if distance < half_width and height[index] < water_level[index]:
			water[index] = water_level[index] - height[index]
	var downstream := PackedInt32Array()
	var accumulation := PackedFloat32Array()
	downstream.resize(count)
	accumulation.resize(count)
	downstream.fill(-1)
	accumulation.fill(1.0)
	var flow_surface := PackedFloat32Array()
	flow_surface.resize(count)
	var order: Array[int] = _drainage(height, size, downstream, flow_surface)
	# Reverse priority-flood order guarantees that upstream cells contribute first.
	for at in range(order.size() - 1, -1, -1):
		var index: int = order[at]
		if downstream[index] >= 0:
			accumulation[downstream[index]] += accumulation[index]
	for index in count:
		if river_distance[index] < river_width[index] * 0.6: continue
		if accumulation[index] < TRIBUTARY_THRESHOLD: continue
		if downstream[index] < 0 or height[index] + 0.001 < height[downstream[index]]: continue
		var x: int = index % size
		var z: int = index / size
		if x < 2 or z < 2 or x >= size - 2 or z >= size - 2: continue
		var radius: float = minf(2.4, 0.75 + sqrt(accumulation[index] / TRIBUTARY_THRESHOLD) * 0.45)
		var channel_depth: float = minf(0.9, 0.28 + accumulation[index] / 1800.0)
		# The drainage network is secondary: it joins the directed creek without
		# changing its water level or requiring a global hydraulic simulation.
		for dz in range(-2, 3):
			for dx in range(-2, 3):
				var near_index: int = (z + dz) * size + x + dx
				var d: float = Vector2(dx, dz).length() * step
				if d > radius + step: continue
				var influence: float = 1.0 - smoothstep(radius, radius + step, d)
				var cut: float = channel_depth * influence
				height[near_index] -= cut
				river_depth[near_index] = maxf(river_depth[near_index], cut)
				river_width[near_index] = maxf(river_width[near_index], radius * 2.0)
				river_distance[near_index] = minf(river_distance[near_index], d)
				if d <= radius: water[near_index] = maxf(water[near_index], cut * 0.7)
	# Named work sites are composable dry clearing masks. Drainage still informs
	# moisture nearby, but a random tributary cannot bisect an authored plot.
	var natural_ground: PackedFloat32Array = model.get("base_height", PackedFloat32Array())
	if natural_ground.size() == count:
		for site in model.get("protected_sites", []):
			var low_x: int = maxi(0, floori((site.x - 17.0 - origin.x) / step))
			var high_x: int = mini(size - 1, ceili((site.x + 17.0 - origin.x) / step))
			var low_z: int = maxi(0, floori((site.y - 17.0 - origin.y) / step))
			var high_z: int = mini(size - 1, ceili((site.y + 17.0 - origin.y) / step))
			for z in range(low_z, high_z + 1):
				for x in range(low_x, high_x + 1):
					var index: int = z * size + x
					var distance: float = (origin + Vector2(x,z) * step).distance_to(site)
					if distance >= 17.0: continue
					var allow_channel: float = smoothstep(7.0, 17.0, distance)
					height[index] = lerpf(natural_ground[index], height[index], allow_channel)
					water[index] *= allow_channel
	# Publish drainage from the carved surface, so navigation and world rules
	# consume the same terrain that is rendered and collided with.
	downstream.fill(-1)
	accumulation.fill(1.0)
	order = _drainage(height, size, downstream, flow_surface)
	for at in range(order.size() - 1, -1, -1):
		var index: int = order[at]
		if downstream[index] >= 0:
			accumulation[downstream[index]] += accumulation[index]
	for index in count:
		if water[index] > 0.0 and water_level[index] < -100.0:
			water_level[index] = height[index] + water[index]
	var moisture: PackedFloat32Array = model.get("moisture", PackedFloat32Array())
	if moisture.size() != count:
		moisture.resize(count)
	for index in count:
		var influence: float = exp(-river_distance[index] / 16.0)
		moisture[index] = clampf(maxf(moisture[index], 0.18 + 0.78 * influence), 0.0, 1.0)
	model["height"] = height
	model["flow_direction"] = downstream
	model["flow_accumulation"] = accumulation
	model["flow_surface"] = flow_surface
	model["river_distance"] = river_distance
	model["river_width"] = river_width
	model["river_depth"] = river_depth
	model["water"] = water
	model["water_level"] = water_level
	model["moisture"] = moisture
	model["river_polyline"] = polyline
	return model


static func default_controls(model: Dictionary) -> Array[Vector2]:
	## Vary basin-scale composition with the seed while preserving the authored
	## bridge and keeping the camp north of the creek dry.
	var origin: Vector2 = model.get("origin", Vector2(-160, -160))
	var extent: float = (int(model.get("size", 161)) - 1) * float(model.get("step", 2.0))
	var rng := RandomNumberGenerator.new()
	rng.seed = int(model.get("seed", 1)) * 7919 + 11731
	return [
		Vector2(origin.x, -55 + rng.randf_range(-8, 8)),
		# Pass south of Mossy Terrace, leaving its authored approach dry.
		Vector2(-85 + rng.randf_range(-19, 19), -76 + rng.randf_range(-10, 10)),
		# Remain south of the camp, then turn toward the fixed crossing.
		Vector2(-25 + rng.randf_range(-13, 13), -65 + rng.randf_range(-7, 7)),
		Vector2(25, -48),
		# Bend north again before Pine Windbreak; no seed floods that plot.
		Vector2(91 + rng.randf_range(-19, 19), -48 + rng.randf_range(-8, 8)),
		Vector2(origin.x + extent, -54 + rng.randf_range(-10, 10)),
	]


static func _sample_route(controls: Array[Vector2], step: float, seed_value: int) -> Array[Vector2]:
	var route: Array[Vector2] = []
	for segment in controls.size() - 1:
		var a: Vector2 = controls[maxi(0, segment - 1)]
		var b: Vector2 = controls[segment]
		var c: Vector2 = controls[segment + 1]
		var d: Vector2 = controls[mini(controls.size() - 1, segment + 2)]
		var pieces: int = maxi(2, ceili(b.distance_to(c) / step))
		for j in pieces:
			var t: float = float(j) / pieces
			var t2: float = t * t
			var t3: float = t2 * t
			var p: Vector2 = 0.5 * ((2.0 * b) + (-a + c) * t + (2.0 * a - 5.0 * b + 4.0 * c - d) * t2 + (-a + 3.0 * b - 3.0 * c + d) * t3)
			var normal: Vector2 = (c - b).orthogonal().normalized()
			var wave: float = sin(t * PI) * (1.25 * sin(float(segment) * 2.37 + t * 8.7 + seed_value * 0.013) + 0.55 * sin(t * 19.1 + seed_value * 0.037))
			route.append(p + normal * wave)
	route.append(controls[-1])
	return route


static func _sample_height(height: PackedFloat32Array, size: int, step: float, origin: Vector2, p: Vector2) -> float:
	var x: int = clampi(roundi((p.x - origin.x) / step), 0, size - 1)
	var z: int = clampi(roundi((p.y - origin.y) / step), 0, size - 1)
	return height[z * size + x]


static func _drainage(height: PackedFloat32Array, size: int, downstream: PackedInt32Array, flow_surface: PackedFloat32Array) -> Array[int]:
	var count: int = size * size
	var visited := PackedByteArray()
	visited.resize(count)
	var order: Array[int] = []
	var heap: Array[Vector2] = []
	for z in size:
		for x in size:
			if x != 0 and z != 0 and x != size - 1 and z != size - 1: continue
			var index: int = z * size + x
			visited[index] = 1
			flow_surface[index] = height[index]
			_heap_push(heap, Vector2(height[index], index))
	while not heap.is_empty():
		var item: Vector2 = _heap_pop(heap)
		var index: int = int(item.y)
		var x: int = index % size
		var z: int = index / size
		order.append(index)
		for dz in range(-1, 2):
			for dx in range(-1, 2):
				if dx == 0 and dz == 0: continue
				var nx: int = x + dx
				var nz: int = z + dz
				if nx < 0 or nz < 0 or nx >= size or nz >= size: continue
				var neighbor: int = nz * size + nx
				if visited[neighbor] != 0: continue
				visited[neighbor] = 1
				downstream[neighbor] = index
				var flow_height: float = maxf(height[neighbor], item.x + 0.0001)
				flow_surface[neighbor] = flow_height
				_heap_push(heap, Vector2(flow_height, neighbor))
	return order


static func _heap_push(heap: Array[Vector2], value: Vector2) -> void:
	heap.append(value)
	var at: int = heap.size() - 1
	while at > 0:
		var parent: int = (at - 1) / 2
		if heap[parent].x <= value.x: break
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
		if child + 1 < heap.size() and heap[child + 1].x < heap[child].x: child += 1
		if heap[child].x >= last.x: break
		heap[at] = heap[child]
		at = child
	heap[at] = last
	return first
