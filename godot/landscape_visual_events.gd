extends RefCounted
## Read-only data contract for a terrain visual presenter. The landscape runtime
## remains authoritative for height, collision, drainage, saves, and spell timing.
## Emit started after apply_magic/undo_last creates transition, advance once per
## frame after its eased height update, and settled before transition.clear().

const Ops = preload("res://landscape_operations.gd")
const SCHEMA := 1
const MAX_SAMPLES := 512

static func started(operation: Dictionary, operation_id: String, world_seed: int, transition: Dictionary, model: Dictionary, zone_root: Node3D, quality_budget: Dictionary = {}) -> Dictionary:
	if zone_root == null or not Ops.validate(operation) or operation_id.is_empty(): return {}
	var before: PackedFloat32Array = transition.get("before", PackedFloat32Array())
	var target: PackedFloat32Array = transition.get("target", PackedFloat32Array())
	var changed: PackedInt32Array = transition.get("indices", PackedInt32Array())
	var size: int = int(model.get("size", 0))
	var step: float = float(model.get("step", 0.0))
	if size < 2 or step <= 0.0 or before.size() != size * size or target.size() != before.size(): return {}
	var origin: Vector2 = model.get("origin", Vector2.ZERO)
	var local_box: Rect2 = transition.get("bounds", Ops.bounds(operation))
	var world_path: Array[Vector3] = []
	var raw_points: Array = operation.get("points", [operation.get("center", [])])
	for raw in raw_points:
		if not raw is Array or raw.size() != 2: return {}
		var local := Vector2(float(raw[0]), float(raw[1]))
		var x: int = clampi(roundi((local.x - origin.x) / step), 0, size - 1)
		var z: int = clampi(roundi((local.y - origin.y) / step), 0, size - 1)
		world_path.append(zone_root.to_global(Vector3(local.x, target[z * size + x], local.y)))
	var samples: Array[Dictionary] = []
	var low_y := INF
	var high_y := -INF
	for index in changed:
		if index < 0 or index >= before.size(): return {}
		low_y = minf(low_y, minf(before[index], target[index]))
		high_y = maxf(high_y, maxf(before[index], target[index]))
	if changed.is_empty():
		low_y = 0.0
		high_y = 0.0
	var cap: int = clampi(int(quality_budget.get("max_terrain_samples", MAX_SAMPLES)), 0, MAX_SAMPLES)
	var stride: int = maxi(1, ceili(float(changed.size()) / float(maxi(cap, 1))))
	if cap > 0:
		for n in range(0, changed.size(), stride):
			var index: int = changed[n]
			var local := origin + Vector2(index % size, index / size) * step
			samples.append({"index": index, "world_before": zone_root.to_global(Vector3(local.x, before[index], local.y)),
				"world_target": zone_root.to_global(Vector3(local.x, target[index], local.y))})
	var world_bounds := AABB()
	var first := true
	for corner in [local_box.position, Vector2(local_box.end.x, local_box.position.y), local_box.end, Vector2(local_box.position.x, local_box.end.y)]:
		for elevation in [low_y, high_y]:
			var point := zone_root.to_global(Vector3(corner.x, elevation, corner.y))
			if first:
				world_bounds = AABB(point, Vector3.ZERO)
				first = false
			else: world_bounds = world_bounds.expand(point)
	var id_number: int = int(operation_id.trim_prefix("op-"))
	var visual_seed: int = int(operation.get("seed", world_seed + id_number * 1009))
	return {"schema": SCHEMA, "operation_id": operation_id, "operation_type": str(operation.type),
		"phase": "started", "progress": 0.0, "eased_progress": 0.0,
		"visual_seed": visual_seed, "world_path": world_path, "world_bounds": world_bounds,
		"local_bounds": local_box, "grid_origin": origin, "grid_step": step, "grid_size": size,
		"changed_count": changed.size(), "terrain_samples": samples, "field_name": "height",
		"duration_seconds": float(transition.get("duration", 0.0)), "quality_budget": quality_budget.duplicate(true)}

static func advance(event: Dictionary, phase: String, progress: float) -> Dictionary:
	if event.is_empty() or phase not in ["animating", "settled", "cancelled"]: return {}
	var next: Dictionary = event.duplicate(false)
	next["phase"] = phase
	next["progress"] = clampf(progress, 0.0, 1.0)
	var t: float = next.progress
	next["eased_progress"] = t * t * (3.0 - 2.0 * t)
	return next
