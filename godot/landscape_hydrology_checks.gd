extends SceneTree

const Hydro = preload("res://landscape_hydrology.gd")
const Fields = preload("res://landscape_fields.gd")
const Ops = preload("res://landscape_operations.gd")
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
	# On flat terrain, the authored visual profile is measurable independent of
	# the procedural hills: inset water, a wet bed, gravel, then a walkable bank.
	var flat_height := PackedFloat32Array()
	flat_height.resize(SIZE * SIZE)
	var flat_moisture := PackedFloat32Array()
	flat_moisture.resize(SIZE * SIZE)
	var flat: Dictionary = Hydro.run({"size": SIZE, "step": STEP, "origin": ORIGIN, "seed": 1,
		"height": flat_height, "moisture": flat_moisture},
		[Vector2(-160, -48), Vector2(160, -48)])
	var center: int = _index(Vector2(-140, -48))
	var gravel: int = _index(Vector2(-140, -44))
	var bank: int = _index(Vector2(-140, -42))
	var rim: int = _index(Vector2(-140, -40))
	if flat.water_level[center] > -1.5 or flat.water_level[center] < -2.5: failures.append("water surface lacks two-metre inset")
	if flat.water[center] < 0.6 or flat.height[center] >= flat.water_level[center]: failures.append("main bed is not submerged")
	if absf(flat.height[gravel] - flat.water_level[gravel]) > 0.35: failures.append("gravel margin is absent")
	if flat.height[bank] <= flat.height[gravel] + 0.4 or flat.height[rim] <= flat.height[bank] + 0.4: failures.append("graded bank is absent")
	if flat.height[rim] - flat.height[bank] > STEP * 0.8: failures.append("bank grade exceeds 40 degrees")
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
	# A settled raise must re-solve drainage without recarving the player's
	# mound, drying the covered channel, or changing distant existing water.
	var edited: Dictionary = Hydro.run(_fixture(43), controls)
	var original_height: PackedFloat32Array = edited.height.duplicate()
	var original_water: PackedFloat32Array = edited.water.duplicate()
	var ridge_point: Vector3 = edited.river_polyline[70]
	var ridge_cell: int = _index(Vector2(ridge_point.x, ridge_point.z))
	var ridge_x: int = ridge_cell % SIZE
	var ridge_z: int = ridge_cell / SIZE
	var raised: PackedFloat32Array = edited.height
	for dz in range(-2, 3):
		for dx in range(-2, 3):
			raised[(ridge_z + dz) * SIZE + ridge_x + dx] += 5.0
	edited["height"] = raised
	var ridge_box := Rect2(Vector2(ridge_point.x, ridge_point.z) - Vector2(5, 5), Vector2(10, 10))
	var refresh_started: int = Time.get_ticks_usec()
	var result: Dictionary = Hydro.refresh_after_terrain_change(edited, ridge_box)
	var refresh_ms: float = float(Time.get_ticks_usec() - refresh_started) / 1000.0
	if int(result.blocked_channel_cells) < 1: failures.append("raise did not block channel")
	if edited.water[ridge_cell] > 0.01: failures.append("water remained inside raised ridge")
	if edited.height[ridge_cell] < original_height[ridge_cell] + 4.9: failures.append("refresh recarved raised terrain")
	var far_cell: int = _index(Vector2(120, 120))
	if edited.water[far_cell] != original_water[far_cell]: failures.append("raise changed distant water")
	for index in SIZE * SIZE:
		var below: int = edited.flow_direction[index]
		if below >= 0 and edited.flow_surface[below] >= edited.flow_surface[index]:
			failures.append("edited drainage flows uphill"); break
	var repeated: Dictionary = Hydro.run(_fixture(43), controls)
	var repeated_height: PackedFloat32Array = repeated.height
	for dz in range(-2, 3):
		for dx in range(-2, 3):
			repeated_height[(ridge_z + dz) * SIZE + ridge_x + dx] += 5.0
	repeated["height"] = repeated_height
	Hydro.refresh_after_terrain_change(repeated, ridge_box)
	if edited.flow_direction != repeated.flow_direction or edited.water != repeated.water:
		failures.append("terrain refresh was not deterministic")
	edited["height"] = original_height.duplicate()
	Hydro.refresh_after_terrain_change(edited, ridge_box)
	if absf(edited.water[ridge_cell] - original_water[ridge_cell]) > 0.01:
		failures.append("undo did not restore creek water")
	# A newly cut dry hollow remains dry. An otherwise identical hollow with an
	# existing water source can collect a bounded pool at its spill height.
	var hollow: Dictionary = Hydro.run(_fixture(43), controls)
	var hollow_cell: int = -1
	for z in range(115, 145):
		for x in range(115, 145):
			var dry := true
			for dz in range(-2, 3):
				for dx in range(-2, 3):
					if hollow.water[(z + dz) * SIZE + x + dx] > 0.02: dry = false
			if dry: hollow_cell = z * SIZE + x; break
		if hollow_cell >= 0: break
	if hollow_cell < 0:
		failures.append("could not locate a dry cut site")
		hollow_cell = 135 * SIZE + 135
	var hollow_center := ORIGIN + Vector2(hollow_cell % SIZE, hollow_cell / SIZE) * STEP
	var hollow_box := Rect2(hollow_center - Vector2(2, 2), Vector2(4, 4))
	var cut: PackedFloat32Array = hollow.height
	cut[hollow_cell] -= 4.0
	hollow["height"] = cut
	Hydro.refresh_after_terrain_change(hollow, hollow_box)
	if hollow.water[hollow_cell] > 0.01: failures.append("dry closed cut filled without a water source")
	hollow = Hydro.run(_fixture(43), controls)
	cut = hollow.height
	cut[hollow_cell] -= 4.0
	hollow["height"] = cut
	var supplied: PackedFloat32Array = hollow.water
	supplied[hollow_cell] = 0.5
	hollow["water"] = supplied
	Hydro.refresh_after_terrain_change(hollow, hollow_box)
	if hollow.water[hollow_cell] < 0.1: failures.append("closed cut did not collect water")
	# The visual-review Sunder crosses only a 25 cm procedural tributary.
	# That trickle must not become an unlimited source for a metre-deep pool.
	var sunder: Dictionary = Hydro.run(Fields.create(290929), [])
	var sunder_op := {"type": "sunder", "points": [[-69.0, -5.0], [-24.0, -5.0]],
		"width": 8.0, "depth": 4.2, "height": 1.2, "shoulder": 4.0, "seed": 290929}
	var trickle_cell: int = _index(Vector2(-31, -4))
	if sunder.water[trickle_cell] <= 0.1 or sunder.water[trickle_cell] >= Hydro.POOL_SOURCE_DEPTH:
		failures.append("Sunder fixture lost its shallow tributary")
	sunder["height"] = Ops.apply(sunder, [sunder_op])
	Hydro.refresh_after_terrain_change(sunder, Ops.bounds(sunder_op))
	for z in range(-10, 1, 2):
		for x in range(-50, -19, 2):
			if sunder.hydrology_pool[_index(Vector2(x, z))] > 0.1:
				failures.append("shallow tributary instantly filled dry Sunder trench")
				break
	var live_model: Dictionary = Hydro.run(_fixture(43), controls)
	supplied = live_model.water
	supplied[hollow_cell] = 0.5
	live_model["water"] = supplied
	var live_height: float = live_model.height[hollow_cell]
	var live_water: float = live_model.water[hollow_cell]
	var live_flow: float = live_model.flow_accumulation[hollow_cell]
	var isolated: Dictionary = Hydro.isolated_refresh_snapshot(live_model)
	var isolated_height: PackedFloat32Array = isolated.height
	isolated_height[hollow_cell] -= 4.0
	isolated["height"] = isolated_height
	Hydro.refresh_after_terrain_change(isolated, hollow_box)
	if isolated.water[hollow_cell] < 0.1: failures.append("isolated refresh failed to collect water")
	if live_model.height[hollow_cell] != live_height or live_model.water[hollow_cell] != live_water or live_model.flow_accumulation[hollow_cell] != live_flow:
		failures.append("isolated refresh modified live model")
	var threaded: Dictionary = Hydro.isolated_refresh_snapshot(live_model)
	var threaded_height: PackedFloat32Array = threaded.height
	threaded_height[hollow_cell] -= 4.0
	threaded["height"] = threaded_height
	var worker := Thread.new()
	var thread_error: Error = worker.start(Callable(self, "_refresh_on_worker").bind(threaded, hollow_box))
	if thread_error != OK:
		failures.append("hydrology worker failed to start")
	else:
		var worker_result: Dictionary = worker.wait_to_finish()
		if threaded.water[hollow_cell] < 0.1 or int(worker_result.get("changed_water_cells", 0)) < 1:
			failures.append("worker did not compute isolated hydrology")
		if live_model.height[hollow_cell] != live_height or live_model.water[hollow_cell] != live_water:
			failures.append("hydrology worker modified live model")
	var dry_hill: Dictionary = Hydro.run(_fixture(43), controls)
	var dry_refresh_ms: float = -1.0
	var dry_x: int = -1
	var dry_z: int = -1
	for z in range(12, SIZE - 12):
		for x in range(12, SIZE - 12):
			var dry_enough: bool = true
			for dz in range(-3, 4):
				for dx in range(-3, 4):
					var at: int = (z + dz) * SIZE + x + dx
					if dry_hill.water[at] > 0.01 or dry_hill.flow_accumulation[at] >= 10.0 or dry_hill.river_distance[at] < 12.0:
						dry_enough = false
						break
				if not dry_enough: break
			if dry_enough: dry_x = x; dry_z = z; break
		if dry_x >= 0: break
	if dry_x < 0:
		failures.append("could not find dry hill test site")
	else:
		var hill_height: PackedFloat32Array = dry_hill.height
		hill_height[dry_z * SIZE + dry_x] += 2.0
		dry_hill["height"] = hill_height
		var dry_point: Vector2 = ORIGIN + Vector2(dry_x, dry_z) * STEP
		var fast: Dictionary = Hydro.refresh_after_terrain_change(dry_hill, Rect2(dry_point - Vector2(2, 2), Vector2(4, 4)))
		dry_refresh_ms = float(fast.elapsed_ms)
		if not bool(fast.get("skipped_drainage", false)): failures.append("ordinary dry hill did not use fast hydrology path")
		if float(fast.elapsed_ms) > 5.0: failures.append("dry hill hydrology was unexpectedly slow")
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
	print("HYDROLOGY_BENCHMARK cells=", SIZE * SIZE, " first_ms=", first_ms, " repeat_ms=", repeat_ms, " refresh_ms=", snappedf(refresh_ms, 0.01), " dry_raise_ms=", snappedf(dry_refresh_ms, 0.01), " wet=", wet_cells, " tributary=", tributary_cells, " max_flow=", max_accumulation)
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


func _refresh_on_worker(snapshot: Dictionary, box: Rect2) -> Dictionary:
	return Hydro.refresh_after_terrain_change(snapshot, box)
