extends SceneTree

const Events = preload("res://landscape_visual_events.gd")

func _initialize() -> void:
	# Node3D.to_global needs the test root inside the SceneTree. Calling the
	# contract here directly produced false world-coordinate failures.
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var root := Node3D.new()
	root.position = Vector3(20, 3, -10)
	get_root().add_child(root)
	var before := PackedFloat32Array([0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
	var target := before.duplicate()
	target[4] = 2.0
	var model := {"size": 3, "step": 2.0, "origin": Vector2(-2, -2)}
	var op := {"type": "raise", "center": [0, 0], "radius": 2.0, "height": 2.0}
	var transition := {"before": before, "target": target, "indices": PackedInt32Array([4]),
		"bounds": Rect2(Vector2(-2, -2), Vector2(4, 4)), "duration": 1.1}
	var event: Dictionary = Events.started(op, "op-000001", 19, transition, model, root, {"max_terrain_samples": 1, "max_particles": 64})
	if event.is_empty(): failures.append("valid operation rejected")
	else:
		if event.operation_id != "op-000001" or event.visual_seed != 1028: failures.append("identity or deterministic seed")
		if event.world_path[0] != Vector3(20, 5, -10): failures.append("local-to-world path")
		if event.terrain_samples.size() != 1 or event.terrain_samples[0].world_before != Vector3(20, 3, -10): failures.append("changed sample")
		if event.terrain_samples[0].world_target != Vector3(20, 5, -10): failures.append("target sample")
		if not event.world_bounds.has_point(Vector3(20, 5, -10)): failures.append("world bounds")
		var progress: Dictionary = Events.advance(event, "animating", 0.25)
		if progress.phase != "animating" or absf(progress.eased_progress - 0.15625) > 0.00001: failures.append("eased phase")
		if event.phase != "started" or before[4] != 0.0 or target[4] != 2.0: failures.append("event mutated terrain")
		if Events.advance(event, "invalid", 0.5) != {}: failures.append("invalid phase accepted")
	var no_samples: Dictionary = Events.started(op, "op-000001", 19, transition, model, root, {"max_terrain_samples": 0})
	if no_samples.terrain_samples.size() != 0 or no_samples.changed_count != 1: failures.append("sample budget")
	print("LANDSCAPE_VISUAL_EVENTS_RESULT ", failures)
	quit(0 if failures.is_empty() else 1)
