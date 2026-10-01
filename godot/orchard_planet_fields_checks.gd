extends SceneTree
const Fields = preload("res://orchard_planet_fields.gd")
const Terrain = preload("res://orchard_planet_terrain.gd")
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func _expect(condition: bool, message: String) -> void:
	if not condition:
		failures.append(message)

func _run() -> void:
	var started := Time.get_ticks_msec()
	var first := Fields.new()
	first.setup(229, 85.0)
	var second := Fields.new()
	second.setup(229, 85.0)
	for i in 60:
		var a := float(i) * 2.39996322972865
		var z := 1.0 - 2.0 * (float(i) + 0.5) / 60.0
		var d := Vector3(sqrt(1.0 - z*z) * cos(a), z, sqrt(1.0-z*z) * sin(a))
		_expect(is_equal_approx(first.height_at(d), second.height_at(d)), "seed repeat %d" % i)
		var sample: Dictionary = first.sample(d)
		var visual_sample: Dictionary = first.sample(d, true)
		_expect(absf(float(visual_sample["height"]) - float(sample["height"])) < 0.00001, "render height %d" % i)
		var sum := 0.0
		for weight in sample["weights"].values():
			sum += weight
		_expect(absf(sum - 1.0) < 0.001, "weights %d" % i)
		_expect(first.normal_at(d).dot(d) > 0.25, "outward normal %d" % i)
		_expect(absf(first.surface_point(d).length() - 85.0 - sample["height"]) < 0.001, "radial surface %d" % i)
	var circumference := 2.0 * PI * first.radius
	_expect(absf(circumference - 534.07) < 0.1, "circumference")
	var river_steps := 0
	for river in first._river:
		var path: Array[Vector3] = river["path"]
		river_steps += path.size() - 1
		for j in range(path.size() - 1):
			_expect(first._base_height(path[j + 1]) <= first._base_height(path[j]) + 0.0001, "river drains downhill")
	_expect(river_steps >= 8, "rivers have connected downhill reaches")
	var seam_a := Vector3(1, 0.37, 1).normalized()
	var seam_b := Vector3(1.0 + 0.000001, 0.37, 1).normalized()
	_expect(first.surface_point(seam_a).distance_to(first.surface_point(seam_b)) < 0.001, "continuous cube seam")
	var before := first.height_at(Vector3.RIGHT)
	var changed: Dictionary = first.apply_operation({"type":"raised_earth", "center":Vector3.RIGHT, "radius":5.0, "strength":2.0})
	_expect(changed["ok"] and first.height_at(Vector3.RIGHT) > before + 1.9, "raised earth")
	var sunder_before := first.height_at(Vector3.UP)
	first.apply_operation({"type":"sunder", "center":Vector3.UP, "axis":Vector3.RIGHT, "radius":5.0, "width":1.0, "strength":1.5})
	_expect(first.height_at(Vector3.UP) < sunder_before - 1.4, "sunder channel")
	var forest_before: float = first.sample(Vector3.LEFT)["weights"]["forest"]
	first.apply_operation({"type":"forest", "center":Vector3.LEFT, "radius":4.0, "strength":2.0})
	_expect(first.sample(Vector3.LEFT)["weights"]["forest"] > forest_before, "forest field")
	var save := JSON.stringify(first.snapshot())
	var replay := Fields.new()
	_expect(replay.load_snapshot(JSON.parse_string(save)), "snapshot replay")
	_expect(absf(replay.height_at(Vector3.RIGHT) - first.height_at(Vector3.RIGHT)) < 0.0001, "replayed height")
	var different := 0
	for seed_value in 20:
		var f := Fields.new()
		f.setup(seed_value + 1)
		var h := f.height_at(Vector3(0.24, 0.4, 0.88))
		_expect(is_finite(h), "finite seed %d" % seed_value)
		if absf(h - first.height_at(Vector3(0.24, 0.4, 0.88))) > 0.0001:
			different += 1
	_expect(different >= 18, "seed diversity")
	var production := Fields.new()
	production.setup(290929, 85.0)
	var anchors: Array[Dictionary] = production.region_anchors()
	_expect(anchors.size() == Fields.BIOMES.size(), "one seeded anchor per biome")
	var production_counts := {}
	var water_samples := 0
	for biome in Fields.BIOMES: production_counts[biome] = 0
	for i in 360:
		var y := 1.0 - 2.0 * (float(i) + 0.5) / 360.0
		var angle := float(i) * 2.399963229728653
		var direction := Vector3(sqrt(1.0 - y*y) * cos(angle), y, sqrt(1.0 - y*y) * sin(angle))
		var sampled: Dictionary = production.sample(direction)
		production_counts[sampled["biome"]] += 1
		if sampled["water"]: water_samples += 1
	for biome in Fields.BIOMES:
		_expect(int(production_counts[biome]) >= 2, "production globe has dominant %s samples" % biome)
	_expect(water_samples >= 3 and water_samples < 110, "water remains present without flooding the globe")
	var alpine: Vector3 = anchors[3]["direction"]
	var highland: Vector3 = anchors[2]["direction"]
	var desert: Vector3 = anchors[4]["direction"]
	var crystal: Vector3 = anchors[5]["direction"]
	var wetland: Vector3 = anchors[6]["direction"]
	_expect(production.height_at(alpine) >= 5.5, "broad alpine height")
	_expect(production.height_at(highland) >= 2.5 and production.height_at(crystal) >= 2.4, "rocky highland and crystal rises")
	_expect(production.sample(desert)["moisture"] < 0.34, "arid lowland is dry")
	_expect(production.sample(wetland)["moisture"] > 0.62, "wetland stays moist")
	var anchors_by_seed := {}
	for seed_value in range(290929, 290950):
		var regional := Fields.new()
		regional.setup(seed_value, 85.0)
		var centers: Array[Dictionary] = regional.region_anchors()
		var regional_river_steps := 0
		for river in regional._river:
			var path: Array[Vector3] = river["path"]
			regional_river_steps += path.size() - 1
			for j in range(path.size() - 1):
				_expect(regional._base_height(path[j + 1]) <= regional._base_height(path[j]) + 0.0001, "seed %d river drains downhill" % seed_value)
		_expect(regional_river_steps >= 7, "seed %d keeps connected rivers" % seed_value)
		var first_anchor: Vector3 = centers[0]["direction"]
		anchors_by_seed[first_anchor.snapped(Vector3.ONE * 0.001)] = true
		for anchor in centers:
			var biome: String = anchor["biome"]
			var direction: Vector3 = anchor["direction"]
			var sampled: Dictionary = regional.sample(direction)
			_expect(sampled["biome"] == biome, "seed %d has dominant %s center" % [seed_value, biome])
			var tangent := direction.cross(Vector3.UP).normalized()
			if tangent.length_squared() < 0.001: tangent = direction.cross(Vector3.RIGHT).normalized()
			var step := (direction + tangent / regional.radius).normalized()
			_expect(absf(regional.height_at(step) - regional.height_at(direction)) < 1.1, "seed %d smooth %s walking gradient" % [seed_value, biome])
	_expect(anchors_by_seed.size() >= 18, "seeded regional rotation varies across worlds")
	var terrain := Terrain.new()
	root.add_child(terrain)
	var cam := Camera3D.new()
	root.add_child(cam)
	cam.global_position = Vector3(0, 0, 180)
	terrain.setup(first, cam)
	for edge_step in 13:
		var v := -1.0 + float(edge_step) / 6.0
		_expect(terrain._direction(0, -1.0, v).distance_to(terrain._direction(4, 1.0, v)) < 0.000001, "cube face seam %d" % edge_step)
	for frame in 40:
		terrain.tick(1.0 / 60.0)
	var stats: Dictionary = terrain.statistics()
	_expect(stats["total"] == 54 and stats["built"] >= 1 and stats["built"] <= stats["visible"], "bounded visible build")
	_expect(stats["dirty"] >= 1, "invisible chunks deferred")
	var initial_dirty: int = stats["dirty"]
	var built_direction := Vector3.BACK
	for chunk in terrain._chunks:
		if chunk["built"]:
			built_direction = chunk["direction"]
			break
	var local_change: Dictionary = terrain.queue_operation({"type":"crater", "center":built_direction, "radius":3.0, "strength":1.0})
	_expect(local_change["ok"], "crater queued")
	var after: Dictionary = terrain.statistics()
	_expect(after["dirty"] > initial_dirty and after["dirty"] < 54, "local dirty cap")
	terrain.tick(0.1)
	_expect(terrain.statistics()["morphing"] <= 2, "bounded morph start")
	for chunk in terrain._chunks:
		if chunk["built"]:
			_expect(chunk["collision"].shape is ConcavePolygonShape3D, "matching concave collision")
			var mesh: ArrayMesh = chunk["mesh_node"].mesh
			var mesh_arrays := mesh.surface_get_arrays(0)
			var index: int = mesh_arrays[Mesh.ARRAY_INDEX][0]
			var mesh_vertex: Vector3 = mesh_arrays[Mesh.ARRAY_VERTEX][index]
			var collider_vertex: Vector3 = chunk["collision"].shape.get_faces()[0]
			_expect(mesh_vertex.distance_to(collider_vertex) < 0.00001, "visual collider match")
			break
	print("PLANET_FIELDS_CHECK ", {"failures": failures, "elapsed_seconds": float(Time.get_ticks_msec()-started)/1000.0, "chunks": stats, "production_biomes": production_counts, "water_samples": water_samples})
	quit(0 if failures.is_empty() else 1)
