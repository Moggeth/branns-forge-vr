extends SceneTree
## tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://god_role_workers_checks.gd

class FakeFields extends RefCounted:
	var radius := 20.0
	func surface_point(direction: Vector3) -> Vector3:
		return direction.normalized() * radius
	func normal_at(direction: Vector3) -> Vector3:
		return direction.normalized()
	func height_at(_direction: Vector3) -> float:
		return radius
	func sample(_direction: Vector3) -> Dictionary:
		return {"water": false}

class FakePlanet extends Node3D:
	var center := Vector3(300.0, 0.0, 0.0)
	var radius := 20.0
	var fields := FakeFields.new()
	var gameplay: Node3D
	func surface_point(direction: Vector3) -> Vector3:
		return center + fields.surface_point(direction)

class FakeGameplay extends Node3D:
	var placed: Array[Node3D] = []

class FakeBuilder extends Node:
	var center := Vector3.ZERO
	var data := {"wood": 0, "harvested": [], "marked": []}
	var resource_by_key := {}
	var scenic_by_key := {}
	var hired := 0
	var changed := 0
	func hire_worker(free_equipment: bool = false) -> String:
		if not free_equipment: return "Charged twice"
		hired += 1
		return ""
	func mark_harvest(local: Vector3) -> String:
		for key in resource_by_key:
			if key in data.marked: continue
			if local.distance_to(resource_by_key[key].global_position - center) < 5.0:
				data.marked.append(key)
				return ""
		return "No tree"
	func _changed(_message: String) -> void:
		changed += 1

class FakeMelee extends Node:
	var cuts := 0
	func notch(_tree: Node3D, _band: Dictionary) -> void:
		cuts += 1

class FakeGame extends Node3D:
	var orchard_planet: FakePlanet
	var world_builder: FakeBuilder
	var melee: FakeMelee
	func _set_collisions(_target: Node, _enabled: bool) -> void:
		pass

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var failures: Array[String] = []
	var game := FakeGame.new()
	root.add_child(game)
	game.orchard_planet = FakePlanet.new()
	game.add_child(game.orchard_planet)
	game.orchard_planet.gameplay = FakeGameplay.new()
	game.add_child(game.orchard_planet.gameplay)
	game.orchard_planet.gameplay.global_position = game.orchard_planet.center
	game.world_builder = FakeBuilder.new()
	game.add_child(game.world_builder)
	game.melee = FakeMelee.new()
	game.add_child(game.melee)
	var direction: Vector3 = (Vector3.DOWN + Vector3.RIGHT * 0.13).normalized()
	var tree := preload("res://tree_kit.gd").make_tree("apple", 1001,
		{"height": 4.7, "choppable": true, "collision": true})
	game.orchard_planet.gameplay.add_child(tree)
	tree.global_position = game.orchard_planet.surface_point(direction)
	tree.global_basis = Basis.looking_at(Vector3.FORWARD, direction)
	tree.set_meta("planet_tree", true)
	tree.set_meta("requires", "axe")
	tree.set_meta("trunk", tree.get_node_or_null("Trunk"))
	if tree.get_node_or_null("Trunk") != null: tree.set_meta("trunk_mesh", tree.get_node("Trunk").mesh)
	game.orchard_planet.gameplay.placed.append(tree)
	var module := preload("res://god_role_workers.gd").new()
	module.setup(game)
	var spawn_direction := (Vector3.DOWN - Vector3.RIGHT * 0.1).normalized()
	var result: Dictionary = module.summon(game.orchard_planet.surface_point(spawn_direction), "orchard_planet")
	if not result.get("ok", false): failures.append("Planet summon failed: " + str(result))
	else:
		var worker: Node3D = result.worker
		if worker.global_basis.y.dot(spawn_direction) < 0.99:
			failures.append("Bottomside lumberjack is not radially upright")
		if worker.get_child_count() == 0: failures.append("Authored worker model is missing")
		var delivered := false
		for step in 700:
			module.tick(0.1)
			if module.workers[0].phase == "wait_log":
				var felling: Node = module.workers[0].felling
				if is_instance_valid(felling) and not is_instance_valid(felling.log): felling._drop_log()
			if int(game.world_builder.data.wood) > 0:
				delivered = true
				break
		if not delivered: failures.append("Planet worker did not cut, collect and deliver lumber")
		if game.melee.cuts != 3: failures.append("Lumberjack did not make three visible tree cuts")
		if not tree.get_meta("felled", false) or tree.visible: failures.append("Live planet tree did not fall and stay harvested")
		if game.world_builder.changed != 1: failures.append("Lumber delivery did not update shared ledger once")
		if module.active_workers() != 1: failures.append("Worker count lost live helper")
		var second := module.summon(game.orchard_planet.surface_point(Vector3.UP), "orchard_planet")
		if second.get("ok", false): failures.append("Summon succeeded without a standing tree")
	var flat_tree := Node3D.new()
	game.add_child(flat_tree)
	flat_tree.global_position = Vector3(2.0, 0.0, 0.0)
	game.world_builder.resource_by_key["tree-a"] = flat_tree
	var flat_result: Dictionary = module.summon(flat_tree.global_position, "orchard_highlands")
	if not flat_result.get("ok", false) or game.world_builder.hired != 1 or flat_result.get("marked_trees", 0) != 1:
		failures.append("Flat summon did not reuse and assign the established worker")
	if int(game.world_builder.data.wood) != 1:
		failures.append("Flat worker summon charged the shared lumber ledger")
	if module.summon(Vector3.ZERO, "forbidden").get("ok", false):
		failures.append("Unsupported zone accepted a worker")
	print("GOD_ROLE_WORKERS_RESULT ", JSON.stringify(failures))
	game.queue_free()
	quit(0 if failures.is_empty() else 1)
