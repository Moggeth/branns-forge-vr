extends SceneTree

const Fields = preload("res://landscape_fields.gd")
const Ecology = preload("res://landscape_ecology.gd")


func _initialize() -> void:
	var failures: Array[String] = []
	var model: Dictionary = Fields.create(814)
	var count: int = model.size * model.size
	var river := PackedFloat32Array()
	var width := PackedFloat32Array()
	var water := PackedFloat32Array()
	river.resize(count)
	width.resize(count)
	water.resize(count)
	for z in range(model.size):
		for x in range(model.size):
			var i: int = z * model.size + x
			var local_z: float = model.origin.y + z * model.step
			river[i] = absf(local_z + 60.0)
			width[i] = 6.0
			water[i] = 1.0 if river[i] < 3.0 else 0.0
	model["river_distance"] = river
	model["river_width"] = width
	model["water"] = water
	var started := Time.get_ticks_usec()
	Ecology.build_fields(model)
	var field_ms := float(Time.get_ticks_usec() - started) / 1000.0
	started = Time.get_ticks_usec()
	var generated: Dictionary = Ecology.generate(model)
	var generate_ms := float(Time.get_ticks_usec() - started) / 1000.0
	var repeat: Dictionary = Ecology.generate(model)
	if generated != repeat: failures.append("repeated generation changed instances")
	if generated.trees.size() < 80 or generated.trees.size() > 1500: failures.append("tree count implausible")
	var ids := {}
	for kind in ["trees", "rocks", "shrubs"]:
		for item in generated[kind]:
			if ids.has(item.id): failures.append("duplicate instance id")
			ids[item.id] = true
			var point := Vector2(item.position.x, item.position.z)
			if absf(point.y + 60.0) < 3.0: failures.append("instance placed in water")
			if item.kind == "tree" and point.distance_to(Vector2(15.0, -27.0)) < 12.0: failures.append("tree placed in camp")
			if absf(Fields.sample(model, "height", point) - item.position.y) > 0.001: failures.append("instance not grounded")
	var dirty := Rect2(Vector2(-20.0, -20.0), Vector2(40.0, 40.0))
	var local: Dictionary = Ecology.generate(model, -1, dirty)
	for kind in ["trees", "rocks", "shrubs"]:
		var expected := {}
		for item in generated[kind]:
			if dirty.has_point(Vector2(item.position.x, item.position.z)): expected[item.id] = true
		if expected.size() != local[kind].size(): failures.append("dirty region count differs: " + kind)
		for item in local[kind]:
			if not expected.has(item.id): failures.append("dirty region changed a stable cell: " + kind)
	var before: PackedFloat32Array = model.vegetation_suitability.duplicate()
	var exclusion := PackedFloat32Array()
	exclusion.resize(count)
	for z in range(model.size):
		for x in range(model.size):
			var point: Vector2 = model.origin + Vector2(x, z) * model.step
			if dirty.has_point(point): exclusion[z * model.size + x] = 1.0
	model["exclusion"] = exclusion
	Ecology.build_fields(model, dirty)
	if Fields.sample(model, "vegetation_suitability", Vector2.ZERO) != 0.0: failures.append("dirty exclusion not applied")
	if model.vegetation_suitability[0] != before[0]: failures.append("dirty field update touched distant cell")
	var ring := {"type": "ring", "center": [60.0, 45.0], "radius": 22.0, "width": 12.0}
	var line := {"type": "line", "points": [[-95.0, 55.0], [-35.0, 75.0]], "width": 13.0}
	var polygon := {"type": "polygon", "points": [[-110.0, -110.0], [-65.0, -110.0], [-65.0, -70.0], [-110.0, -70.0]]}
	for region in [ring, line, polygon]:
		var grown: Array[Dictionary] = Ecology.grow(model, region, 491)
		if grown.is_empty(): failures.append("grow region produced no trees: " + region.type)
		if grown != Ecology.grow(model, region, 491): failures.append("grow region not deterministic: " + region.type)
		for item in grown:
			if not Ecology._in_region(region, Vector2(item.position.x, item.position.z)): failures.append("grown tree outside region")
	print("LANDSCAPE_ECOLOGY_CHECK fields_ms=%.3f instances_ms=%.3f counts=%d/%d/%d failures=%d" % [field_ms, generate_ms, generated.trees.size(), generated.rocks.size(), generated.shrubs.size(), failures.size()])
	for failure in failures: push_error(failure)
	quit(0 if failures.is_empty() else 1)
