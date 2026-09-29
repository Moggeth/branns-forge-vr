extends SceneTree

const Hydro = preload("res://landscape_hydrology.gd")
const Fields = preload("res://landscape_fields.gd")
const SIZE: int = 161
const STEP: float = 2.0
const ORIGIN := Vector2(-160, -160)


func _initialize() -> void:
	var failures: Array[String] = []
	var controls: Array[Vector2] = [Vector2(-160, -55), Vector2(-85, -43), Vector2(-25, -55), Vector2(25, -48), Vector2(90, -60), Vector2(160, -51)]
	var started: int = Time.get_ticks_msec()
	var first: Dictionary = Hydro.run(_fixture(43), controls)
	var first_ms: int = Time.get_ticks_msec() - started
	started = Time.get_ticks_msec()
	var second: Dictionary = Hydro.run(_fixture(43), controls)
	var repeat_ms: int = Time.get_ticks_msec() - started
	if first.height != second.height or first.river_polyline != second.river_polyline or first.flow_accumulation != second.flow_accumulation:
		failures.append("same seed and controls produced different fields")
	for key in ["height", "water", "water_level", "river_distance", "river_width", "river_depth", "flow_direction", "flow_accumulation", "flow_surface", "moisture"]:
		if first[key].size() != SIZE * SIZE: failures.append("wrong size for " + key)
	var wet_cells: int = 0
	var tributary_cells: int = 0
	var max_accumulation: float = 0.0
	for index in SIZE * SIZE:
		if first.water[index] > 0.0: wet_cells += 1
		if first.river_width[index] > 0.0 and first.river_width[index] < 5.0 and first.water[index] > 0.0: tributary_cells += 1
		max_accumulation = maxf(max_accumulation, first.flow_accumulation[index])
		var below: int = first.flow_direction[index]
		if below >= SIZE * SIZE: failures.append("flow leaves grid")
		if below == index: failures.append("self-loop in flow")
		if below >= 0 and first.flow_surface[below] >= first.flow_surface[index]: failures.append("flow surface rises downstream")
	if wet_cells < 100: failures.append("directed creek did not create water")
	if tributary_cells < 10: failures.append("drainage did not create tributaries")
	if max_accumulation < 145.0: failures.append("flow did not accumulate")
	var crossing: int = _index(Vector2(25, -48))
	if first.river_distance[crossing] > 3.0: failures.append("creek missed bridge crossing")
	if first.height[crossing] >= first.base_height[crossing] - 0.5: failures.append("creek was not carved at bridge")
	var camp: int = _index(Vector2(15, -27))
	if first.water[camp] > 0.0: failures.append("camp is underwater")
	var line: Array[Vector3] = first.river_polyline
	for i in range(1, line.size()):
		if line[i].y >= line[i - 1].y: failures.append("main river flows uphill"); break
	# Follow every downstream pointer: priority flood must form a tree to a boundary.
	for sample in range(0, SIZE * SIZE, 97):
		var at: int = sample
		var hops: int = 0
		while at >= 0 and hops <= SIZE * SIZE:
			at = first.flow_direction[at]
			hops += 1
		if hops > SIZE * SIZE: failures.append("flow cycle from " + str(sample))
	var previous_controls: Array[Vector2] = Hydro.default_controls(_fixture(40))
	var varied: int = 0
	for seed_value in range(41, 61):
		var candidate: Array[Vector2] = Hydro.default_controls(_fixture(seed_value))
		if candidate[3] != Vector2(25, -48): failures.append("seed variation displaced bridge")
		if candidate != previous_controls: varied += 1
		previous_controls = candidate
	if varied < 19: failures.append("seed variation repeats creek controls")
	if "--stress" in OS.get_cmdline_user_args():
		var stress_started: int = Time.get_ticks_msec()
		var wet_camp_count: int = 0
		var missed_crossing_count: int = 0
		var route_shapes: Dictionary = {}
		var worst_slope: float = 0.0
		var worst_seed: int = -1
		var worst_point := Vector2.ZERO
		var worst_bank_slope: float = 0.0
		var old_hotspot_slope: float = 0.0
		for seed_value in range(2000, 2020):
			var generated: Dictionary = Hydro.run(Fields.create(seed_value), [])
			Fields.derive(generated)
			if seed_value == 2014: old_hotspot_slope = generated.slope[_index(Vector2(54, -68))]
			if generated.water[camp] > 0.0: wet_camp_count += 1
			if generated.water[crossing] <= 0.0: missed_crossing_count += 1
			var route_points: Array[Vector3] = generated.river_polyline
			var sample: Vector3 = route_points[mini(40, route_points.size() - 1)]
			route_shapes[snappedf(sample.z, 1.0)] = true
			for index in SIZE * SIZE:
				var grade: float = generated.slope[index]
				if generated.river_distance[index] < 32.0:
					worst_bank_slope = maxf(worst_bank_slope, grade)
				if grade > worst_slope:
					worst_slope = grade
					worst_seed = seed_value
					worst_point = ORIGIN + Vector2(index % SIZE, index / SIZE) * STEP
		if wet_camp_count > 0: failures.append("stress seeds flooded camp: " + str(wet_camp_count))
		if missed_crossing_count > 0: failures.append("stress seeds missed crossing: " + str(missed_crossing_count))
		if route_shapes.size() < 8: failures.append("stress seeds made repetitive creek routes")
		if worst_bank_slope > 1.0: failures.append("bank slope exceeds traversable stress limit: " + str(worst_bank_slope))
		print("HYDROLOGY_STRESS seeds=20 ms=", Time.get_ticks_msec() - stress_started, " route_shapes=", route_shapes.size(), " wet_camps=", wet_camp_count, " missed_crossings=", missed_crossing_count, " max_slope=", snappedf(worst_slope, 0.001), " max_bank_slope=", snappedf(worst_bank_slope, 0.001), " seed2014_old_hotspot=", snappedf(old_hotspot_slope, 0.001), " worst_seed=", worst_seed, " worst_point=", worst_point)
	print("HYDROLOGY_BENCHMARK cells=", SIZE * SIZE, " first_ms=", first_ms, " repeat_ms=", repeat_ms, " wet=", wet_cells, " tributary=", tributary_cells, " max_flow=", max_accumulation)
	if failures.is_empty():
		print("HYDROLOGY_CHECKS_PASS")
		quit(0)
	else:
		for failure in failures: push_error(failure)
		quit(1)


func _fixture(seed_value: int) -> Dictionary:
	var height := PackedFloat32Array()
	var moisture := PackedFloat32Array()
	height.resize(SIZE * SIZE)
	moisture.resize(SIZE * SIZE)
	for z in SIZE:
		for x in SIZE:
			var p := ORIGIN + Vector2(x, z) * STEP
			var value: float = 3.0 + 0.006 * p.x + 2.0 * sin(p.x * 0.023) * cos(p.y * 0.019) + 0.6 * sin(p.y * 0.11 + seed_value)
			height[z * SIZE + x] = value
			moisture[z * SIZE + x] = 0.22
	return {"size": SIZE, "step": STEP, "origin": ORIGIN, "seed": seed_value, "height": height, "base_height": height.duplicate(), "moisture": moisture}


func _index(point: Vector2) -> int:
	return clampi(roundi((point.y - ORIGIN.y) / STEP), 0, SIZE - 1) * SIZE + clampi(roundi((point.x - ORIGIN.x) / STEP), 0, SIZE - 1)
