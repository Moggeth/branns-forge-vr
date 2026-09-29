extends SceneTree

const Fields = preload("res://landscape_fields.gd")


func _initialize() -> void:
	var failures: Array[String] = []
	var started := Time.get_ticks_usec()
	var a: Dictionary = Fields.create(41931)
	var elapsed_ms := float(Time.get_ticks_usec() - started) / 1000.0
	var b: Dictionary = Fields.create(41931)
	var c: Dictionary = Fields.create(41932)
	if a.size != 161 or a.step != 2.0 or a.origin != Vector2(-160.0, -160.0): failures.append("default grid geometry")
	for field in ["landform", "regional", "detail", "base_height", "height", "moisture", "slope", "curvature", "traversability"]:
		if not a.has(field) or a[field].size() != 161 * 161: failures.append("missing or incorrectly sized field: " + field)
	if a.height != b.height or a.moisture != b.moisture: failures.append("same seed is not deterministic")
	if a.height == c.height: failures.append("different seeds give identical terrain")
	if a.feature_controls != b.feature_controls: failures.append("feature controls are not deterministic")
	if a.feature_controls.hill_center == c.feature_controls.hill_center: failures.append("hill placement ignores seed")
	var low := INF
	var high := -INF
	var max_slope := 0.0
	for i in range(a.height.size()):
		low = minf(low, a.height[i])
		high = maxf(high, a.height[i])
		max_slope = maxf(max_slope, a.slope[i])
	if high - low < 5.0: failures.append("landform elevation lacks variety")
	if max_slope > 1.1: failures.append("unsafe needle slope: " + str(max_slope))
	if absf(Fields.sample(a, "height", Vector2(15, -27))) > 0.4: failures.append("camp protection")
	if absf(Fields.sample(a, "height", Vector2(25, -48))) > 0.4: failures.append("crossing protection")
	var centre_index: int = Fields.index(a, 80, 80)
	if absf(Fields.sample(a, "height", Vector2.ZERO) - a.height[centre_index]) > 0.0001: failures.append("grid sampling")
	var old: float = a.height[centre_index]
	a.height[centre_index] = old + 5.0
	Fields.derive(a)
	if absf(Fields.sample(a, "height", Vector2.ZERO) - old - 5.0) > 0.0001: failures.append("authoritative height replacement")
	for recipe in Fields.RECIPES:
		var model: Dictionary = Fields.create(41931, recipe, 33, 10.0)
		if model.height.size() != 1089: failures.append("recipe or scale: " + recipe)
	var batch_started := Time.get_ticks_usec()
	var batch_min_range := INF
	var batch_max_grade := 0.0
	var hill_centers := {}
	var valley_centers := {}
	for seed in range(20):
		var variant: Dictionary = Fields.create(seed + 2000)
		hill_centers[variant.feature_controls.hill_center] = true
		valley_centers[variant.feature_controls.valley_center_z] = true
		var variant_low := INF
		var variant_high := -INF
		for i in range(variant.height.size()):
			variant_low = minf(variant_low, variant.height[i])
			variant_high = maxf(variant_high, variant.height[i])
			batch_max_grade = maxf(batch_max_grade, variant.slope[i])
		batch_min_range = minf(batch_min_range, variant_high - variant_low)
	if batch_min_range < 5.0: failures.append("one or more seed variants lacks relief")
	if batch_max_grade > 1.1: failures.append("one or more seed variants has unsafe needle slopes")
	if hill_centers.size() < 18 or valley_centers.size() < 18: failures.append("major features repeat across seeds")
	var batch_ms := float(Time.get_ticks_usec() - batch_started) / 1000.0
	print("LANDSCAPE_FIELDS_CHECK generation_ms=%.3f range=%.3f..%.3f max_grade=%.3f batch20_ms=%.3f batch_min_range=%.3f batch_max_grade=%.3f failures=%d" % [elapsed_ms, low, high, max_slope, batch_ms, batch_min_range, batch_max_grade, failures.size()])
	for failure in failures: push_error(failure)
	quit(0 if failures.is_empty() else 1)
