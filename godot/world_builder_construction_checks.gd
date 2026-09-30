extends SceneTree
## Isolated construction/physics/navigation fixture; no player save or live game.
const Construction = preload("res://world_builder_construction.gd")
const Navigation = preload("res://landscape_navigation.gd")

class FakeLandscape:
	extends Node
	func height_at(point: Vector2) -> float:
		if point.y > 4.0 and point.y < 9.0: return clampf((point.x + 4.0) / 8.0, 0.0, 1.0) * 2.0
		if point.y < -4.0: return clampf((point.x + 4.0) / 8.0, 0.0, 1.0) * 4.0
		return -0.3 if absf(point.x) < 1.5 else 0.0
	func water_at(point: Vector2) -> float:
		return 1.0 if absf(point.y) < 2.0 and absf(point.x) < 1.5 else 0.0

class FakeGame:
	extends Node3D
	var landscape: FakeLandscape

class FakeBuilder:
	extends Node
	var game: FakeGame
	var root: Node3D
	var data := {"wood": 30, "revision": 0, "constructions": [], "harvested": []}
	var scenic_by_key := {}
	func _changed(_message: String) -> void:
		data.revision += 1

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game := FakeGame.new()
	root.add_child(game)
	game.landscape = FakeLandscape.new()
	game.add_child(game.landscape)
	var builder := FakeBuilder.new()
	game.add_child(builder)
	builder.game = game
	builder.root = Node3D.new()
	game.add_child(builder.root)
	var module := Construction.new()
	game.add_child(module)
	module.setup(builder)
	var a := Vector3(-5, 0, 0)
	var b := Vector3(5, 0, 0)
	var preview: Dictionary = module.preview("bridge", a, b)
	if not preview.valid or preview.lumber != 6: failures.append("bridge preview/cost incorrect: " + str(preview))
	var before := builder.data.duplicate(true)
	var invalid: String = module.place("bridge", Vector3(-1, 0, 0), b)
	if invalid.is_empty() or builder.data != before: failures.append("invalid wet-bank bridge mutated settlement")
	builder.data.wood = 0
	before = builder.data.duplicate(true)
	invalid = module.place("bridge", a, b)
	if invalid.is_empty() or builder.data != before: failures.append("insufficient lumber mutated settlement")
	builder.data.wood = 30
	var result: String = module.place("bridge", a, b)
	if not result.is_empty() or int(builder.data.wood) != 24 or builder.data.constructions.size() != 1 or int(builder.data.revision) != 1:
		failures.append("valid bridge did not atomically debit and record: " + result)
	if not Construction.valid_records(builder.data.constructions): failures.append("placed record failed persistence validation")
	var corrupt: Array = builder.data.constructions.duplicate(true)
	corrupt[0].a[0] = INF
	if Construction.valid_records(corrupt): failures.append("nonfinite saved record accepted")
	await physics_frame
	var query := PhysicsRayQueryParameters3D.create(Vector3(0, 2, 0), Vector3(0, -2, 0), 1)
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty() or str(hit.collider.get_meta("kind", "")) != "floor" or absf(float(hit.position.y) - 0.2) > 0.03:
		failures.append("bridge floor ray missed constructed deck: " + str(hit))
	var rail_query := PhysicsRayQueryParameters3D.create(Vector3(0, 0.65, 0), Vector3(0, 0.65, 3), 1)
	var rail_hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(rail_query)
	if rail_hit.is_empty() or str(rail_hit.collider.get_meta("kind", "")) != "solid": failures.append("bridge rail does not contain the Hero")
	if absf(module.surface_height(Vector2.ZERO, -0.3) - 0.2) > 0.02: failures.append("worker deck height differs from collider")
	for entry in [
		{"kind": "ramp", "a": Vector3(-4, 0, 6), "b": Vector3(4, 0, 6)},
		{"kind": "stairs", "a": Vector3(-4, 0, -6), "b": Vector3(4, 0, -6)},
		{"kind": "boardwalk", "a": Vector3(-5, 0, 12), "b": Vector3(5, 0, 12)}]:
		var plan: Dictionary = module.preview(entry.kind, entry.a, entry.b)
		if not plan.valid: failures.append(str(entry.kind) + " preview rejected: " + str(plan.reason)); continue
		var construction_result: String = module.place(entry.kind, entry.a, entry.b)
		if not construction_result.is_empty(): failures.append(str(entry.kind) + " placement rejected: " + construction_result)
	await physics_frame
	for sample in [Vector2(0, 6), Vector2(0, -6), Vector2(0, 12)]:
		var top: float = module.surface_height(sample, game.landscape.height_at(sample))
		var floor_ray := PhysicsRayQueryParameters3D.create(Vector3(sample.x, top + 1.0, sample.y), Vector3(sample.x, top - 1.0, sample.y), 1)
		var floor_hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(floor_ray)
		if floor_hit.is_empty() or str(floor_hit.collider.get_meta("kind", "")) != "floor" or absf(float(floor_hit.position.y) - top) > 0.1:
			failures.append("constructed walkway height/collision disagree at " + str(sample))
	var model := _model()
	var start := Vector2(-8, 0)
	var goal := Vector2(8, 0)
	if not Navigation.route(model, start, goal, {"allow_bridge": false}).is_empty(): failures.append("wet barrier was passable without construction")
	var options := module.navigation_options()
	options.allow_bridge = false
	var path: Array[Vector2] = Navigation.route(model, start, goal, options)
	if path.is_empty() or not Navigation.path_passable(model, path, options): failures.append("free bridge did not make a passable worker route")
	print("CONSTRUCTION_CHECK failures=", failures)
	for failure in failures: push_error(failure)
	quit(0 if failures.is_empty() else 1)

func _model() -> Dictionary:
	var size := 25
	var count := size * size
	var heights := PackedFloat32Array()
	var water := PackedFloat32Array()
	var traverse := PackedFloat32Array()
	heights.resize(count)
	water.resize(count)
	traverse.resize(count)
	for z in size:
		for x in size:
			var index := z * size + x
			heights[index] = -0.3 if absf(float(x - 12)) < 1.5 else 0.0
			water[index] = 1.0 if absf(float(x - 12)) < 1.5 else 0.0
			traverse[index] = 1.0
	return {"size": size, "step": 1.0, "origin": Vector2(-12, -12), "height": heights,
		"water": water, "traversability": traverse}
