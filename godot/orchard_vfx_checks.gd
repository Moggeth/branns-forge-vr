extends SceneTree
## Synthetic presenter contract check. No game world or save files are opened.

const Presenter = preload("res://orchard_vfx/orchard_spell_vfx.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var vfx: Node3D = Presenter.new()
	vfx.grow_saplings_persist = false
	vfx.max_permanent_pieces = 500
	root.add_child(vfx)
	await process_frame
	var samples: Array[Dictionary] = []
	for x in range(-6, 7, 2):
		for z in range(-4, 5, 2):
			var at := Vector3(x, 0, z)
			samples.append({"world_before": at, "world_target": at + Vector3.DOWN * 2.0})
	var sunder := _event("op-1", "sunder", 101, samples)
	vfx.accept_event(sunder)
	_check(vfx.active_count() == 1 and vfx.get_child_count() <= 14, "sunder start exceeded transient node budget", failures)
	vfx.accept_event(_phase(sunder, "animating", 0.5))
	vfx.accept_event(_phase(sunder, "settled", 1.0))
	var sunder_pieces: int = vfx.permanent_piece_count()
	_check(sunder_pieces > 0 and sunder_pieces <= 500, "sunder permanent pieces missing or unbounded", failures)
	vfx.step(5.0)
	await process_frame
	_check(vfx.active_count() == 0 and vfx.get_child_count() <= 11, "sunder tail retained transient nodes", failures)
	var reverse: Dictionary = sunder.duplicate(false)
	reverse.direction = "reverse"
	vfx.accept_event(reverse)
	_check(vfx.permanent_piece_count() == 0, "undo kept old geology", failures)
	vfx.accept_event(_phase(reverse, "animating", 0.5))
	vfx.accept_event(_phase(reverse, "settled", 1.0))
	vfx.step(5.0)
	await process_frame
	_check(vfx.active_count() == 0 and vfx.permanent_piece_count() == 0, "undo left active or permanent geology", failures)
	vfx.restore_event(sunder)
	_check(vfx.permanent_piece_count() == sunder_pieces and vfx.active_count() == 0, "restore differs from settled sunder", failures)
	var grow := _event("forest-1", "grow_forest", 202, [])
	grow.tree_positions = [Vector3(-4, 0, -1), Vector3(0, 0, 2), Vector3(5, 0, -2)]
	vfx.accept_event(grow)
	_check(vfx.active_count() == 1 and vfx.get_child_count() <= 25, "grow start exceeded transient node budget", failures)
	vfx.accept_event(_phase(grow, "animating", 0.5))
	vfx.accept_event(_phase(grow, "settled", 1.0))
	var grow_pieces: Array = vfx._permanent.get("forest-1", [])
	_check(not grow_pieces.is_empty(), "grow root pieces missing", failures)
	for piece in grow_pieces:
		if str(piece[0]) in ["sapling", "leaf_puff"]: failures.append("temporary sapling persisted beside game tree")
	vfx.step(5.0)
	await process_frame
	_check(vfx.active_count() == 0 and vfx.get_child_count() <= 11, "grow tail retained transient nodes", failures)
	# The presenter is dynamically typed here; GDScript cannot infer this call's return.
	var grow_count: int = vfx.permanent_piece_count()
	vfx.forget_operation("forest-1")
	_check(vfx.permanent_piece_count() == sunder_pieces and grow_count > sunder_pieces, "forget did not remove forest roots", failures)
	vfx.restore_event(grow)
	_check(vfx.permanent_piece_count() == grow_count, "grow restore differed from settle", failures)
	for i in 12:
		var another := _event("op-extra-%d" % i, "raise", 300 + i, samples)
		vfx.restore_event(another)
		_check(vfx.permanent_piece_count() <= 500 and vfx.get_child_count() <= 11, "history exceeded permanent budget", failures)
	vfx.clear_all()
	await process_frame
	_check(vfx.active_count() == 0 and vfx.permanent_piece_count() == 0, "clear_all retained presenter state", failures)
	print("ORCHARD_VFX_RESULT failures=", failures, " initial_sunder_pieces=", sunder_pieces, " grow_pieces=", grow_count)
	quit(0 if failures.is_empty() else 1)

func _event(id: String, kind: String, seed: int, samples: Array[Dictionary]) -> Dictionary:
	return {"schema": 1, "operation_id": id, "operation_type": kind, "phase": "started",
		"direction": "forward", "progress": 0.0, "visual_seed": seed,
		"world_path": [Vector3(-6, 0, 0), Vector3(6, 0, 0)], "terrain_samples": samples,
		"duration_seconds": 1.2,
		"quality_budget": {"max_live_debris": 12, "max_dust_particles": 32,
			"max_temporary_lights": 1, "max_effect_seconds": 4.0}}

func _phase(started: Dictionary, phase: String, progress: float) -> Dictionary:
	var event: Dictionary = started.duplicate(false)
	event.phase = phase
	event.progress = progress
	return event

func _check(ok: bool, reason: String, failures: Array[String]) -> void:
	if not ok: failures.append(reason)
