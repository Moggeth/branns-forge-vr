extends RefCounted
## Small explicit dependency graph for terrain edits. Geometry/collision update as
## the spell animates; hydrology can solve off-thread; these dependent layers
## converge on the main thread after the matching terrain revision returns.
const Fields = preload("res://landscape_fields.gd")
const Ecology = preload("res://landscape_ecology.gd")

const DEPENDENCIES := {
	"height": ["slope", "curvature", "hydrology", "terrain_mesh", "collision", "reprojection"],
	"slope": ["traversability", "ecology"],
	"hydrology": ["water", "moisture"],
	"water": ["traversability", "ecology", "water_mesh"],
	"moisture": ["ecology"],
}

static func invalidated(changed: Array[String]) -> Array[String]:
	var reached := {}
	var queue: Array[String] = changed.duplicate()
	while not queue.is_empty():
		var field: String = queue.pop_front()
		if reached.has(field): continue
		reached[field] = true
		for child in DEPENDENCIES.get(field, []): queue.append(str(child))
	var ordered: Array[String] = []
	for field in ["height", "slope", "curvature", "hydrology", "water", "moisture", "traversability", "ecology", "terrain_mesh", "collision", "water_mesh", "reprojection"]:
		if reached.has(field): ordered.append(field)
	return ordered

static func settle_after_hydrology(model: Dictionary, bounds: Rect2, water: Node) -> Dictionary:
	var stage_ms := {}
	var stamp := Time.get_ticks_usec()
	Fields.derive_region(model, bounds)
	stage_ms["derived_fields"] = _elapsed(stamp)
	stamp = Time.get_ticks_usec()
	Ecology.build_fields(model, bounds)
	stage_ms["ecology"] = _elapsed(stamp)
	stamp = Time.get_ticks_usec()
	if water != null: water.refresh_region(model, bounds)
	stage_ms["water_mesh"] = _elapsed(stamp)
	return stage_ms

static func _elapsed(started: int) -> float:
	return float(Time.get_ticks_usec() - started) / 1000.0
