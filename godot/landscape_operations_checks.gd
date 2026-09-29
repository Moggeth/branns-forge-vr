extends SceneTree

const Ops = preload("res://landscape_operations.gd")

func _initialize() -> void:
	var failures: Array[String] = []
	var heights := PackedFloat32Array()
	heights.resize(161 * 161)
	var model := {"size": 161, "step": 2.0, "origin": Vector2(-160, -160), "height": heights, "base_height": heights.duplicate()}
	var sunder := {"type": "sunder", "points": [[-50, -20], [0, -16], [50, -20]], "width": 8.0, "depth": 5.0, "height": 1.4, "shoulder": 5.0, "seed": 17}
	var raise := {"type": "raise", "center": [20, 25], "radius": 16.0, "height": 4.0}
	var operations: Array = [sunder, raise]
	if not Ops.validate(sunder) or Ops.validate({"type": "sunder", "points": [[0, 0]], "width": 1.0}): failures.append("command validation")
	var normal_world_seed: Dictionary = sunder.duplicate(true)
	normal_world_seed.seed = 290929
	if not Ops.validate(normal_world_seed): failures.append("world seed rejected as coordinate")
	var start: int = Time.get_ticks_usec()
	var scar: PackedFloat32Array = Ops.apply(model, [sunder])
	var elapsed_ms: float = float(Time.get_ticks_usec() - start) / 1000.0
	var first: PackedFloat32Array = Ops.apply(model, operations)
	var replay: PackedFloat32Array = Ops.apply(model, operations)
	if first != replay: failures.append("deterministic replay")
	if model.height != heights: failures.append("source mutated")
	if scar == first or Ops.apply(model, []) != heights: failures.append("undo by operation removal")
	if first[72 * 161 + 80] > -2.0: failures.append("sunder centre did not descend")
	if first[93 * 161 + 90] <= 0.0: failures.append("raise did not elevate")
	var chunks: Array[Vector2i] = Ops.affected_chunks(sunder, model)
	if chunks.is_empty() or chunks.size() >= 100: failures.append("dirty chunks unbounded")
	var outside := {"type": "raise", "center": [900, 900], "radius": 10.0, "height": 3.0}
	if Ops.apply(model, [outside]) != heights or not Ops.affected_chunks(outside, model).is_empty(): failures.append("outside region changed world")
	var edge := {"type": "raise", "center": [160, 160], "radius": 4.0, "height": 2.0}
	if Vector2i(10, 10) in Ops.affected_chunks(edge, model): failures.append("edge emitted nonexistent chunk")
	var other_ops: Array = [
		{"type": "ridge", "points": [[-10, 30], [10, 30]], "width": 8.0, "height": 3.0},
		{"type": "path", "points": [[-10, -40], [10, -40]], "width": 8.0, "target": 1.0},
		{"type": "crater", "center": [-40, 40], "radius": 10.0, "depth": 3.0},
		{"type": "smooth", "center": [0, 0], "radius": 8.0},
		{"type": "terrace", "center": [20, 20], "radius": 8.0, "step": 1.0},
	]
	for op in other_ops:
		if not Ops.validate(op): failures.append("valid operator rejected: " + str(op.type))
		if Ops.apply(model, [op]) != Ops.apply(model, [op]): failures.append("operator replay: " + str(op.type))
	print("LANDSCAPE_OPS_BENCHMARK sunder_m=100 cells=25921 compose_ms=", snappedf(elapsed_ms, 0.001), " dirty_chunks=", chunks.size())
	print("LANDSCAPE_OPS_RESULT ", failures)
	quit(0 if failures.is_empty() else 1)
