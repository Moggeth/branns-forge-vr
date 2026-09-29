extends Node
## Real scene proof: an overhead command changes the same mesh and collider used
## by the Hero. This check runs offline and never touches the player's save.
const Fields = preload("res://landscape_fields.gd")

func run(game: Node3D) -> void:
	var failures: Array[String] = []
	var land = game.landscape
	var builder = game.world_builder
	if land == null or builder == null:
		_finish(game, ["missing live systems"])
		return
	await game.get_tree().physics_frame
	_check(land.chunks.size() == 25, "expected 25 terrain chunks", failures)
	_check(land.model.has("flow_accumulation") and land.model.has("vegetation_suitability"), "missing shared world fields", failures)
	var crossing := Vector2(25, -48)
	_check(land.water_at(crossing) > 0.1, "crossing is not a carved stream", failures)
	_check(land.water_at(Vector2(15, -27)) < 0.1, "camp became flooded", failures)
	var hit := _ground_hit(game, Vector2(0, 0))
	_check(not hit.is_empty(), "no terrain collision beneath central clearing", failures)
	if not hit.is_empty():
		_check(float(hit.normal.y) > 0.75, "terrain collision normal faces down or is too steep", failures)
		_check(absf(float(hit.position.y) - land.height_at(Vector2(0, 0))) < 0.11, "visible and physical ground disagree", failures)
	var scar_at := Vector2(0, 14)
	var scar_before: float = land.height_at(scar_at)
	var untouched_before: float = land.height_at(Vector2(90, 90))
	var command := {"type":"sunder", "points":[[-52.0, 14.0],[52.0, 14.0]], "width":8.0, "depth":4.2, "height":1.2, "shoulder":4.0, "seed":9}
	var started := Time.get_ticks_usec()
	var error: String = land.apply_magic(command)
	_check(error.is_empty(), "sunder rejected: " + error, failures)
	await game.get_tree().create_timer(1.55).timeout
	_check(land.height_at(scar_at) < scar_before - 3.0, "sunder did not carve a ravine", failures)
	_check(is_equal_approx(land.height_at(Vector2(90,90)), untouched_before), "local edit changed distant ground", failures)
	_check(land.transition.is_empty(), "sunder transition did not settle", failures)
	hit = _ground_hit(game, scar_at)
	_check(not hit.is_empty() and absf(float(hit.position.y) - land.height_at(scar_at)) < 0.15, "ravine collider not aligned", failures)
	var raise_at := Vector2(-78, 35)
	var raise_before: float = land.height_at(raise_at)
	error = land.apply_magic({"type":"raise", "center":[raise_at.x, raise_at.y], "radius":14.0, "height":3.8})
	_check(error.is_empty(), "raise rejected: " + error, failures)
	await game.get_tree().create_timer(1.28).timeout
	_check(land.height_at(raise_at) > raise_before + 3.2, "raise did not lift a hill", failures)
	var grove_before: int = builder.data.forest_spells.size()
	error = builder.cast_forest(Vector3(-105, 0, -9), Vector3(-63, 0, -9))
	_check(error.is_empty(), "forest rejected: " + error, failures)
	_check(builder.data.forest_spells.size() == grove_before + 1, "forest not recorded", failures)
	if error.is_empty():
		var saved: Array = builder.data.forest_spells[-1].placements
		_check(not saved.is_empty(), "forest placements were not saved", failures)
		if not saved.is_empty():
			var tree_at := Vector2(float(saved[0][0]), float(saved[0][1]))
			var tree_y: float = game.landscape.height_at(tree_at)
			error = land.apply_magic({"type":"raise", "center":[tree_at.x,tree_at.y], "radius":9.0, "height":2.1})
			_check(error.is_empty(), "forest-height edit rejected: " + error, failures)
			await game.get_tree().create_timer(0.95).timeout
			var reloaded: Array[Dictionary] = builder._unpack_forest(saved)
			_check(Vector2(reloaded[0].position.x,reloaded[0].position.z).distance_to(tree_at) < 0.001, "forest moved after terrain edit", failures)
			_check(float(reloaded[0].position.y) > tree_y + 1.0, "forest did not follow raised ground", failures)
			_check(builder._valid(builder.data), "forest save no longer validates", failures)
			_check(land.undo_last(), "forest-height undo rejected", failures)
			await game.get_tree().create_timer(0.8).timeout
	_check(land.operation_count() == 2, "terrain command history not kept", failures)
	var changed: bool = land.undo_last()
	_check(changed, "undo rejected", failures)
	await game.get_tree().create_timer(0.98).timeout
	_check(absf(land.height_at(raise_at) - raise_before) < 0.05, "undo did not replay prior terrain", failures)
	print("LANDSCAPE_LIVE_METRICS initial_ms=", snappedf(land.initial_ms,0.01), " target_ms=", snappedf(land.last_operation_ms,0.01), " rebuild_ms=", snappedf(land.last_rebuild_ms,0.01), " demo_seconds=", snappedf(float(Time.get_ticks_usec()-started)/1000000.0,0.01), " chunks=", land.chunks.size())
	_finish(game, failures)

static func _ground_hit(game: Node3D, local: Vector2) -> Dictionary:
	var zone: Vector3 = game.scene.zones.orchard_highlands.center
	var base := zone + Vector3(local.x, game.landscape.height_at(local), local.y)
	var ray := PhysicsRayQueryParameters3D.create(base + Vector3.UP * 2.0, base + Vector3.DOWN * 2.0, 1)
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
	return hit

static func _check(ok: bool, reason: String, failures: Array[String]) -> void:
	if not ok: failures.append(reason)

static func _finish(game: Node3D, failures: Array[String]) -> void:
	print("LANDSCAPE_LIVE_RESULT ", failures)
	game.get_tree().quit(0 if failures.is_empty() else 1)
