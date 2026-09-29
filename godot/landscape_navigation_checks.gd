extends SceneTree

const Fields = preload("res://landscape_fields.gd")
const Hydro = preload("res://landscape_hydrology.gd")
const Navigation = preload("res://landscape_navigation.gd")
const Builder = preload("res://world_builder_runtime.gd")

class FakeLandscape:
	extends RefCounted
	var model: Dictionary
	var transition: Dictionary = {}
	var edits := 0
	func operation_count() -> int: return edits
	func height_at(point: Vector2) -> float: return Fields.sample(model, "height", point)
	func water_at(point: Vector2) -> float: return Fields.sample(model, "water", point)

class FakeGame:
	extends Node3D
	var landscape: FakeLandscape


func _initialize() -> void:
	call_deferred("_check")


func _check() -> void:
	var failures: Array[String] = []
	var model: Dictionary = Fields.create(43)
	Hydro.run(model, [])
	Fields.derive(model)
	var from := Vector2(25, -20)
	var to := Vector2(25, -90)
	var started: int = Time.get_ticks_usec()
	var path: Array[Vector2] = Navigation.route(model, from, to)
	var elapsed_ms: float = float(Time.get_ticks_usec() - started) / 1000.0
	if path.is_empty(): failures.append("route over existing bridge absent")
	if not path.is_empty():
		if path[0] != from or path[-1] != to: failures.append("route endpoints changed")
		if not Navigation.path_passable(model, path): failures.append("route contains an impassable edge")
		if Navigation.route(model, from, to) != path: failures.append("route is not deterministic")
		var near_crossing := false
		for point in path:
			if point.distance_to(Vector2(25, -48)) < 5.0: near_crossing = true
		if not near_crossing: failures.append("route avoided authored creek crossing")
	var remote_dirty := Rect2(Vector2(-140, 110), Vector2(8, 8))
	if Navigation.route_needs_replan(model, path, remote_dirty, 0, 0): failures.append("distant edit invalidated route")
	if not Navigation.route_needs_replan(model, path, Rect2(Vector2(20, -51), Vector2(10, 10)), 0, 0): failures.append("bridge edit did not invalidate route")
	if not Navigation.route_needs_replan(model, path, Rect2(), 0, 1): failures.append("operation count did not invalidate route")
	var synthetic := _flat_model()
	var straight: Array[Vector2] = Navigation.route(synthetic, Vector2(0, 0), Vector2(8, 0))
	if straight.is_empty() or not Navigation.path_passable(synthetic, straight): failures.append("flat route absent")
	var heights: PackedFloat32Array = synthetic.height
	for z in 9: heights[z * 9 + 4] = 4.0
	synthetic["height"] = heights
	var blocked: Array[Vector2] = Navigation.route(synthetic, Vector2(0, 0), Vector2(8, 0))
	if not blocked.is_empty(): failures.append("planner crossed an unwalkable height wall")
	if Navigation.path_passable(synthetic, straight): failures.append("height wall did not invalidate old path")
	_check_worker(model, failures)
	print("NAVIGATION_CHECK route_ms=%.3f waypoints=%d failures=%d" % [elapsed_ms, path.size(), failures.size()])
	for failure in failures: push_error(failure)
	if failures.is_empty(): print("NAVIGATION_CHECKS_PASS")
	quit(0 if failures.is_empty() else 1)


func _flat_model() -> Dictionary:
	var heights := PackedFloat32Array()
	var traversability := PackedFloat32Array()
	heights.resize(81)
	traversability.resize(81)
	traversability.fill(1.0)
	return {"size": 9, "step": 1.0, "origin": Vector2.ZERO, "height": heights, "traversability": traversability}


func _check_worker(model: Dictionary, failures: Array[String]) -> void:
	var fake_landscape := FakeLandscape.new()
	fake_landscape.model = model
	var fake_game := FakeGame.new()
	fake_game.landscape = fake_landscape
	root.add_child(fake_game)
	var builder := Builder.new()
	root.add_child(builder)
	builder.game = fake_game
	builder.data = Builder.fresh_state()
	builder.data.bridges.append([25.0, -48.0])
	var worker := Node3D.new()
	root.add_child(worker)
	worker.position = Vector3(25, 0, -20)
	var empty_route: Array[Vector2] = []
	worker.set_meta("nav_path", empty_route)
	worker.set_meta("nav_target", Vector2(INF, INF))
	worker.set_meta("nav_index", 0)
	worker.set_meta("nav_op_count", -1)
	worker.set_meta("nav_transitioning", false)
	worker.set_meta("nav_initialized", false)
	worker.set_meta("nav_bridge_available", false)
	var goal := Vector3(25, 0, -90)
	var started: int = Time.get_ticks_usec()
	var arrived := false
	for frame in 260:
		arrived = builder._worker_travel(worker, goal, 0.2, 2.1, 0.55)
		var point := Vector2(worker.position.x, worker.position.z)
		if worker.position.y + 0.01 < fake_landscape.height_at(point): failures.append("worker fell below terrain"); break
		if fake_landscape.water_at(point) > 0.45 and point.distance_to(Vector2(25, -48)) > 9.0: failures.append("worker entered creek away from bridge"); break
		if frame == 4:
			fake_landscape.edits = 1
		if frame == 5 and int(worker.get_meta("nav_op_count", -1)) != 1: failures.append("worker did not replan after landscape operation")
		if arrived: break
	if not arrived: failures.append("worker did not arrive after terrain route")
	print("NAVIGATION_WORKER_CHECK travel_ms=%.3f arrived=%s" % [float(Time.get_ticks_usec() - started) / 1000.0, str(arrived)])
