extends SceneTree

const Fields = preload("res://landscape_fields.gd")
const Hydro = preload("res://landscape_hydrology.gd")
const Water = preload("res://landscape_water.gd")


func _initialize() -> void:
	call_deferred("_check")


func _check() -> void:
	var failures: Array[String] = []
	var started: int = Time.get_ticks_msec()
	var model: Dictionary = Hydro.run(Fields.create(43), [])
	var water: Node3D = Water.new()
	root.add_child(water)
	water.setup(model)
	var generation_ms: int = Time.get_ticks_msec() - started
	if water.chunk_count() < 5: failures.append("creek was not divided into local chunks")
	for chunk in water.get_children():
		if not chunk is MeshInstance3D: failures.append("unexpected water child")
		elif chunk.mesh == null or chunk.mesh.get_surface_count() != 1: failures.append("water mesh absent")
		if chunk is CollisionObject3D: failures.append("water blocks collision")
	var crossing: Dictionary = Water.crossing(model)
	if crossing.is_empty(): failures.append("crossing missing")
	else:
		if Vector2(crossing.position.x, crossing.position.z).distance_to(Vector2(25, -48)) > 5.0: failures.append("bridge placement missed existing crossing")
		if crossing.position.y <= crossing.water_y: failures.append("bridge deck submerged")
		if absf(crossing.along.dot(crossing.across)) > 0.01: failures.append("bridge is not across stream")
		if crossing.span <= Water.sample(model, "river_width", Vector2(crossing.position.x, crossing.position.z)): failures.append("bridge does not reach banks")
	var original_mesh: Mesh = water.get_child(0).mesh
	var far_dirty := Rect2(Vector2(-150, 120), Vector2(8, 8))
	var unaffected: int = water.refresh_region(model, far_dirty)
	if unaffected != 0 or water.get_child(0).mesh != original_mesh: failures.append("distant water rebuilt")
	var near_dirty := Rect2(Vector2(-155, -60), Vector2(15, 15))
	var affected: int = water.refresh_region(model, near_dirty)
	if affected < 1 or affected >= water.chunk_count(): failures.append("dirty region did not rebuild locally")
	var shortened: Dictionary = model.duplicate()
	var shorter: Array[Vector3] = model.river_polyline.duplicate()
	shorter.resize(shorter.size() / 2)
	shortened["river_polyline"] = shorter
	var reset: int = water.refresh_region(shortened, near_dirty)
	if reset != water.chunk_count(): failures.append("changed river route did not rebuild water")
	print("WATER_BENCHMARK grid_plus_mesh_ms=", generation_ms, " chunks=", water.chunk_count(), " local_rebuilt=", affected)
	if failures.is_empty():
		print("WATER_CHECKS_PASS")
		quit(0)
	else:
		for failure in failures: push_error(failure)
		quit(1)
