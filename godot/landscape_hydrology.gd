extends RefCounted
## Deterministic, grid-based water compiler. Grid index is z * size + x.
## Coordinates and river_polyline are local to the landscape origin.

const WATER_INSET: float = 2.0
const GRAVEL_MARGIN: float = 1.5
const BANK_GRADE: float = 0.64 # tan(33 degrees): walkable, exposed bank face.
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
	var carve_ceiling := PackedFloat32Array()
	var water := PackedFloat32Array()
	var pool := PackedFloat32Array()
	var water_level := PackedFloat32Array()
	river_distance.resize(count)
	river_width.resize(count)
	river_depth.resize(count)
	carve_ceiling.resize(count)
	water.resize(count)
	pool.resize(count)
	water_level.resize(count)
	river_distance.fill(1000000.0)
	carve_ceiling.fill(1000000.0)
	water_level.fill(-1000000.0)
	var levels := PackedFloat32Array()
	levels.resize(route.size())
	var previous_level: float = _sample_height(height, size, step, origin, route[0]) - WATER_INSET
	for i in route.size():
		var current: float = _sample_height(height, size, step, origin, route[i]) - WATER_INSET
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
				var width: float = 6.2 + 1.8 * sin(float(i) * 0.055 + 0.3)
				var depth: float = 1.2 + 0.3 * sin(float(i) * 0.11)
				var level: float = lerpf(levels[i], levels[i + 1], t)
				var landing: float = 1.0 - smoothstep(7.0, 14.0, absf(p.x - 25.0))
				var grade: float = lerpf(BANK_GRADE, 0.42, landing)
				carve_ceiling[index] = minf(carve_ceiling[index], _channel_ceiling(distance, width, depth, level, grade))
				if distance >= river_distance[index]: continue
				river_distance[index] = distance
				river_width[index] = width
				river_depth[index] = depth
				water_level[index] = level
	for index in count:
		var distance: float = river_distance[index]
		if distance >= MAIN_REACH: continue
		var half_width: float = river_width[index] * 0.5
		# Take the lower profile where bends approach one another. Choosing only
		# the nearest segment can create a sharp seam between different levels.
		height[index] = minf(height[index], carve_ceiling[index])
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
	# Resolve the few junctions where a narrow tributary meets the deeper main
	# cut. Lower the high side until neighbouring terrain remains walkable.
	for pass_index in 4:
		for z in range(1, size - 1):
			for x in range(1, size - 1):
				var index: int = z * size + x
				if river_distance[index] >= MAIN_REACH: continue
				for dz in range(-1, 2):
					for dx in range(-1, 2):
						if dx == 0 and dz == 0: continue
						var neighbor: int = (z + dz) * size + x + dx
						var allowed: float = height[neighbor] + step * 0.65 * Vector2(dx, dz).length()
						height[index] = minf(height[index], allowed)
	for index in count:
		if river_distance[index] < river_width[index] * 0.5 and water_level[index] > -100.0:
			water[index] = maxf(water[index], water_level[index] - height[index])
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
	model["hydrology_base_moisture"] = moisture.duplicate()
	for index in count:
		var influence: float = exp(-river_distance[index] / 16.0)
		moisture[index] = clampf(maxf(moisture[index], 0.18 + 0.78 * influence), 0.0, 1.0)
	model["height"] = height
	model["hydrology_last_height"] = height.duplicate()
	model["flow_direction"] = downstream
	model["flow_accumulation"] = accumulation
	model["flow_surface"] = flow_surface
	model["river_distance"] = river_distance
	model["river_width"] = river_width
	model["river_depth"] = river_depth
	model["water"] = water
	model["hydrology_pool"] = pool
	model["water_level"] = water_level
	model["hydrology_channel_level"] = water_level.duplicate()
	model["moisture"] = moisture
	model["river_polyline"] = polyline
	return model


static func _channel_ceiling(distance: float, width: float, depth: float, level: float, grade: float) -> float:
	var half_width: float = width * 0.5
	if distance <= half_width:
		# Keep the visible ribbon wet to its edge, with a shallow submerged toe.
		var toe: float = smoothstep(maxf(0.0, half_width - 2.5), half_width, distance)
		return lerpf(level - depth, level - 0.12, toe)
	if distance <= half_width + GRAVEL_MARGIN:
		# A narrow shelf above the water is the physical gravel margin.
		return lerpf(level - 0.12, level + 0.10, (distance - half_width) / GRAVEL_MARGIN)
	# Join the uncut terrain at a 33-degree grade, without an outer lip.
	return level + 0.10 + grade * (distance - half_width - GRAVEL_MARGIN)


static func refresh_after_terrain_change(model: Dictionary, dirty: Rect2) -> Dictionary:
	## Called once after a terrain transition settles. The watershed can extend
	## beyond dirty, so solve its small 161-square graph globally, but only alter
	## water and moisture in the changed region. Never carve a second time.
	var size: int = int(model.get("size", 0))
	var step: float = float(model.get("step", 2.0))
	var count: int = size * size
	var height: PackedFloat32Array = model.get("height", PackedFloat32Array())
	if size < 3 or step <= 0.0 or height.size() != count:
		push_error("Hydrology refresh needs a valid height grid")
		return {"water_dirty": dirty, "changed_water_cells": 0, "blocked_channel_cells": 0}
	var start: int = Time.get_ticks_usec()
	var origin: Vector2 = model.get("origin", Vector2(-160, -160))
	var zone: Rect2 = dirty.grow(step * 2.0)
	var x0: int = clampi(floori((zone.position.x - origin.x) / step), 0, size - 1)
	var z0: int = clampi(floori((zone.position.y - origin.y) / step), 0, size - 1)
	var x1: int = clampi(ceili((zone.end.x - origin.x) / step), 0, size - 1)
	var z1: int = clampi(ceili((zone.end.y - origin.y) / step), 0, size - 1)
	var previous_height: PackedFloat32Array = model.get("hydrology_last_height", PackedFloat32Array())
	var prior_water: PackedFloat32Array = model.get("water", PackedFloat32Array())
	var prior_flow: PackedFloat32Array = model.get("flow_accumulation", PackedFloat32Array())
	var prior_distance: PackedFloat32Array = model.get("river_distance", PackedFloat32Array())
	var prior_width: PackedFloat32Array = model.get("river_width", PackedFloat32Array())
	var simple_dry_raise: bool = previous_height.size() == count and prior_water.size() == count and prior_flow.size() == count and prior_distance.size() == count and prior_width.size() == count
	var changed_height: bool = false
	if simple_dry_raise:
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				var index: int = z * size + x
				if absf(height[index] - previous_height[index]) > 0.001: changed_height = true
				if height[index] < previous_height[index] - 0.001 or prior_water[index] > 0.01 or prior_flow[index] >= 32.0 or prior_distance[index] < prior_width[index] * 0.5 + step:
					simple_dry_raise = false
					break
			if not simple_dry_raise: break
	if not changed_height and previous_height.size() == count:
		# No height operator (for example a forest spell) needs no water work.
		var any_change: bool = false
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				if absf(height[z * size + x] - previous_height[z * size + x]) > 0.001:
					any_change = true
					break
			if any_change: break
		if not any_change:
			return {"water_dirty": dirty, "changed_water_cells": 0, "blocked_channel_cells": 0,
				"skipped_drainage": true, "elapsed_ms": float(Time.get_ticks_usec() - start) / 1000.0}
	if simple_dry_raise:
		for z in range(z0, z1 + 1):
			for x in range(x0, x1 + 1):
				var index: int = z * size + x
				previous_height[index] = height[index]
		model["hydrology_last_height"] = previous_height
		return {"water_dirty": dirty, "changed_water_cells": 0, "blocked_channel_cells": 0,
			"skipped_drainage": true, "elapsed_ms": float(Time.get_ticks_usec() - start) / 1000.0}
	var downstream := PackedInt32Array()
	var accumulation := PackedFloat32Array()
	var surface := PackedFloat32Array()
	downstream.resize(count)
	accumulation.resize(count)
	surface.resize(count)
	downstream.fill(-1)
	accumulation.fill(1.0)
	var order: Array[int] = _drainage(height, size, downstream, surface)
	for at in range(order.size() - 1, -1, -1):
		var index: int = order[at]
		if downstream[index] >= 0:
			accumulation[downstream[index]] += accumulation[index]
	model["flow_direction"] = downstream
	model["flow_accumulation"] = accumulation
	model["flow_surface"] = surface
	var water: PackedFloat32Array = model.get("water", PackedFloat32Array())
	var pool: PackedFloat32Array = model.get("hydrology_pool", PackedFloat32Array())
	var levels: PackedFloat32Array = model.get("water_level", PackedFloat32Array())
	var channel_levels: PackedFloat32Array = model.get("hydrology_channel_level", levels)
	var distances: PackedFloat32Array = model.get("river_distance", PackedFloat32Array())
	var widths: PackedFloat32Array = model.get("river_width", PackedFloat32Array())
	var moisture: PackedFloat32Array = model.get("moisture", PackedFloat32Array())
	var base_moisture: PackedFloat32Array = model.get("hydrology_base_moisture", PackedFloat32Array())
	if water.size() != count or levels.size() != count or channel_levels.size() != count or distances.size() != count or widths.size() != count:
		return {"water_dirty": dirty, "changed_water_cells": 0, "blocked_channel_cells": 0}
	if pool.size() != count:
		pool.resize(count)
	# A depression is not a magical spring. Only existing river water (or an
	# explicit future water source) can fill a fresh cut; an isolated impact
	# crater stays dry instead of instantly becoming a checkerboard pond.
	var source_water := water.duplicate()
	var source_pool := pool.duplicate()
	var changed: int = 0
	var blocked: int = 0
	for z in range(z0, z1 + 1):
		for x in range(x0, x1 + 1):
			var index: int = z * size + x
			var previous: float = water[index]
			var half_width: float = widths[index] * 0.5
			var in_channel: bool = distances[index] < half_width and channel_levels[index] > -100.0
			var channel_depth: float = maxf(0.0, channel_levels[index] - height[index]) if in_channel else 0.0
			# A spell may dam the old bed. The water must not render through
			# raised rock; the old downstream river is preserved, and a nearby
			# enclosed cut can hold a shallow, bounded pool at its spill level.
			if in_channel and channel_depth <= 0.01: blocked += 1
			var pool_depth: float = 0.0
			if surface[index] > height[index] + 0.15 and _near_water_source(source_water, source_pool, size, x, z):
				pool_depth = minf(1.5, surface[index] - height[index])
			water[index] = maxf(channel_depth, pool_depth)
			pool[index] = pool_depth
			levels[index] = height[index] + pool_depth if pool_depth > channel_depth else channel_levels[index]
			if moisture.size() == count and base_moisture.size() == count:
				var creek_influence: float = exp(-distances[index] / 16.0) if channel_depth > 0.01 else 0.0
				moisture[index] = clampf(maxf(base_moisture[index], maxf(0.18 + 0.78 * creek_influence, 0.5 if pool_depth > 0.1 else 0.0)), 0.0, 1.0)
			if absf(previous - water[index]) > 0.001: changed += 1
	model["water"] = water
	model["hydrology_last_height"] = height.duplicate()
	model["hydrology_pool"] = pool
	model["water_level"] = levels
	if moisture.size() == count: model["moisture"] = moisture
	return {"water_dirty": zone, "changed_water_cells": changed,
		"blocked_channel_cells": blocked,
		"elapsed_ms": float(Time.get_ticks_usec() - start) / 1000.0}


static func _near_water_source(water: PackedFloat32Array, pool: PackedFloat32Array, size: int, x: int, z: int) -> bool:
	for dz in range(-2, 3):
		for dx in range(-2, 3):
			var nx := x + dx
			var nz := z + dz
			if nx < 0 or nx >= size or nz < 0 or nz >= size: continue
			var index := nz * size + nx
			if water[index] > 0.02 and pool[index] <= 0.02: return true
	return false


static func isolated_refresh_snapshot(model: Dictionary) -> Dictionary:
	## Copy only primitive metadata and packed fields used by refresh. The result
	## has no SceneTree nodes or resources and can be passed to a worker Thread.
	## The caller merges the result only after checking its terrain revision.
	var snapshot: Dictionary = {}
	for key in ["size", "step", "origin", "height", "water", "water_level",
		"river_distance", "river_width", "moisture", "hydrology_base_moisture",
		"hydrology_pool", "hydrology_channel_level", "hydrology_last_height",
		"flow_accumulation"]:
		var value: Variant = model.get(key)
		if value is PackedFloat32Array:
			snapshot[key] = (value as PackedFloat32Array).duplicate()
		else:
			snapshot[key] = value
	return snapshot


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
