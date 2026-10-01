extends Node3D
## Friendly lumberjacks for the shared God/Hero world. Flat Orchard uses its
## established worker ledger and navigation; planet helpers use radial steps.

const WORKER_SCENE := "res://assets/worldbuilder/worker.glb"
const CARRY_SCENE := "res://assets/tree_cutting/log_y.glb"
const MAX_PLANET_WORKERS := 8
const WALK_SPEED := 2.1
const CHOP_INTERVAL := 0.85
const DELIVERY_RADIUS := 1.1

var game: Node3D
var planet
var workers: Array[Dictionary] = []
var _harvest_cooldown := 0.0

func setup(owner_game: Node3D) -> void:
	game = owner_game
	planet = game.get("orchard_planet")
	name = "GodRoleWorkers"
	game.add_child(self)

func active_workers() -> int:
	var total := 0
	for entry in workers:
		if is_instance_valid(entry.get("node", null)): total += 1
	return total

func summon(world_point: Vector3, zone: String) -> Dictionary:
	if game == null: return {"ok": false, "error": "Workers are not ready"}
	if zone != "orchard_planet":
		var builder = game.get("world_builder")
		if zone != "orchard_highlands" or builder == null or not builder.has_method("hire_worker"):
			return {"ok": false, "error": "Lumberjacks need an Orchard work site"}
		var result: String = builder.hire_worker(true)
		if not result.is_empty(): return {"ok": false, "error": result, "zone": zone}
		var marked := _mark_flat_trees(builder, world_point)
		return {"ok": true, "zone": zone, "existing_worker": true,
			"marked_trees": marked, "internal_lumber_cost": 0}
	planet = game.get("orchard_planet")
	if planet == null or planet.get("fields") == null or planet.get("gameplay") == null:
		return {"ok": false, "error": "Planet terrain is not ready"}
	if active_workers() >= MAX_PLANET_WORKERS:
		return {"ok": false, "error": "Eight planet lumberjacks are the limit"}
	var direction: Vector3 = (world_point - planet.center).normalized()
	if direction.length_squared() < 0.5:
		return {"ok": false, "error": "Aim at the planet surface"}
	if planet.fields.sample(direction).get("water", false):
		return {"ok": false, "error": "Choose dry ground for a lumberjack"}
	var tree := _nearest_tree(direction, 55.0)
	if tree == null:
		return {"ok": false, "error": "No standing harvestable tree near this work site"}
	var worker := Node3D.new()
	worker.name = "PlanetLumberjack_%02d" % active_workers()
	worker.set_meta("zone", "orchard_planet")
	add_child(worker)
	worker.global_position = planet.surface_point(direction)
	_orient(worker, direction, _tangent(direction, tree.global_position - worker.global_position))
	if not ResourceLoader.exists(WORKER_SCENE):
		worker.queue_free()
		return {"ok": false, "error": "Worker art is unavailable"}
	var packed: PackedScene = load(WORKER_SCENE)
	if packed == null:
		worker.queue_free()
		return {"ok": false, "error": "Worker art could not load"}
	var model := packed.instantiate()
	worker.add_child(model)
	var players := model.find_children("*", "AnimationPlayer", true, false)
	if not players.is_empty(): worker.set_meta("animator", players[0])
	var entry := {"node": worker, "home": direction, "target": tree, "phase": "walk",
		"chop_time": 0.0, "strikes": 0, "felling": null, "blocked_time": 0.0}
	workers.append(entry)
	_animate(worker, "Worker_Walk")
	return {"ok": true, "zone": zone, "worker": worker, "target": tree, "internal_lumber_cost": 0}

func _mark_flat_trees(builder: Node, world_point: Vector3) -> int:
	var choices: Array[Dictionary] = []
	var at: Vector3 = world_point - builder.center
	for key in builder.resource_by_key:
		if key in builder.data.harvested or key in builder.data.marked: continue
		var tree: Node3D = builder.resource_by_key[key]
		if not is_instance_valid(tree) or not tree.visible: continue
		choices.append({"point": tree.global_position - builder.center,
			"distance": tree.global_position.distance_to(world_point)})
	for key in builder.scenic_by_key:
		if key in builder.data.harvested or key in builder.data.marked: continue
		var record: Dictionary = builder.scenic_by_key[key]
		if not is_instance_valid(record.get("collision", null)) or record.collision.disabled: continue
		choices.append({"point": record.position,
			"distance": Vector2(at.x - record.position.x, at.z - record.position.z).length()})
	choices.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.distance) < float(b.distance))
	var marked := 0
	for choice in choices:
		if marked >= 3: break
		if builder.mark_harvest(choice.point).is_empty(): marked += 1
	return marked

func tick(delta: float) -> void:
	if planet == null or planet.get("fields") == null: return
	_harvest_cooldown = maxf(0.0, _harvest_cooldown - delta)
	for entry in workers:
		var worker: Node3D = entry.get("node", null)
		if not is_instance_valid(worker): continue
		match str(entry.phase):
			"walk": _walk_to_tree(entry, delta)
			"chop": _chop(entry, delta)
			"wait_log": _wait_for_log(entry, delta)
			"carry": _carry_home(entry, delta)
			"idle":
				entry.idle_time = float(entry.get("idle_time", 0.0)) + delta
				if float(entry.idle_time) >= 2.0:
					entry.idle_time = 0.0
					_find_job(entry)
			_: _find_job(entry)

func _nearest_tree(direction: Vector3, max_metres: float, excluding: Node3D = null) -> Node3D:
	var result: Node3D
	var best := max_metres
	var gameplay = planet.get("gameplay")
	if gameplay == null: return null
	for candidate in gameplay.placed:
		if not is_instance_valid(candidate) or candidate == excluding or not candidate.visible: continue
		if not candidate.get_meta("planet_tree", false) or candidate.get_meta("requires", "") != "axe": continue
		if candidate.get_meta("felled", false) or candidate.get_meta("collecting", false): continue
		var taken := false
		for entry in workers:
			if entry.get("target", null) == candidate and str(entry.get("phase", "")) in ["walk", "chop", "wait_log"]:
				taken = true
				break
		if taken: continue
		var target_direction: Vector3 = (candidate.global_position - planet.center).normalized()
		var distance: float = planet.radius * direction.angle_to(target_direction)
		if distance < best:
			best = distance
			result = candidate
	return result

func _find_job(entry: Dictionary) -> void:
	var worker: Node3D = entry.node
	var direction: Vector3 = (worker.global_position - planet.center).normalized()
	var tree := _nearest_tree(direction, 70.0)
	if tree == null:
		entry.phase = "idle"
		_animate(worker, "Worker_Idle")
		return
	entry.target = tree
	entry.phase = "walk"
	entry.blocked_time = 0.0
	_animate(worker, "Worker_Walk")

func _walk_to_tree(entry: Dictionary, delta: float) -> void:
	var tree: Node3D = entry.target
	if not is_instance_valid(tree) or not tree.visible or tree.get_meta("felled", false):
		entry.target = null
		entry.phase = "search"
		return
	var goal: Vector3 = (tree.global_position - planet.center).normalized()
	if _walk(entry.node, goal, delta, 1.05):
		entry.phase = "chop"
		entry.chop_time = 0.0
		_animate(entry.node, "Worker_Chop")
	else:
		entry.blocked_time = float(entry.blocked_time) + delta if entry.node.get_meta("planet_step_blocked", false) else 0.0
		if float(entry.blocked_time) > 2.0:
			entry.phase = "search"
			entry.target = null
			_animate(entry.node, "Worker_Idle")

func _chop(entry: Dictionary, delta: float) -> void:
	var tree: Node3D = entry.target
	if not is_instance_valid(tree) or not tree.visible or tree.get_meta("felled", false):
		entry.phase = "search"
		entry.target = null
		return
	entry.chop_time = float(entry.chop_time) + delta
	if float(entry.chop_time) < CHOP_INTERVAL or _harvest_cooldown > 0.0: return
	entry.chop_time = 0.0
	_harvest_cooldown = 1.0
	entry.strikes = int(entry.strikes) + 1
	var up: Vector3 = tree.global_basis.y.normalized()
	var toward: Vector3 = _tangent(up, entry.node.global_position - tree.global_position)
	var hit: Vector3 = tree.to_global(Vector3(0.0, 0.85, 0.0)) + toward * 0.12
	var band := {"height": 0.85, "hits": int(entry.strikes), "point": hit, "normal": toward}
	if game.get("melee") != null:
		game.melee.notch(tree, band)
		if game.melee.has_method("_authored_chips"):
			game.melee._authored_chips(tree, hit, toward, int(entry.strikes))
	if int(entry.strikes) < 3: return
	var felling := preload("res://tree_felling.gd").new()
	tree.get_parent().add_child(felling)
	tree.set_meta("cut_height", 0.85)
	felling.start(game, tree, 0.85, toward)
	tree.set_meta("felled", true)
	tree.set_meta("cut_bands", [])
	entry.felling = felling
	entry.phase = "wait_log"
	_animate(entry.node, "Worker_Idle")

func _wait_for_log(entry: Dictionary, delta: float) -> void:
	var felling: Node = entry.felling
	if not is_instance_valid(felling):
		entry.phase = "search"
		return
	var log: RigidBody3D = felling.log
	if not is_instance_valid(log): return
	var goal: Vector3 = (log.global_position - planet.center).normalized()
	if not _walk(entry.node, goal, delta, 1.3): return
	log.freeze = true
	log.queue_free()
	var tree: Node3D = entry.target
	if is_instance_valid(tree):
		tree.set_meta("collecting", true)
		tree.visible = false
		if game.has_method("_set_collisions"): game._set_collisions(tree, false)
	felling.log_collected()
	entry.phase = "carry"
	_add_carry_log(entry.node)
	_animate(entry.node, "Worker_Walk")

func _carry_home(entry: Dictionary, delta: float) -> void:
	if not _walk(entry.node, entry.home, delta, DELIVERY_RADIUS): return
	var carry: Node = entry.node.get_node_or_null("CarryLog")
	if carry != null: carry.queue_free()
	var builder = game.get("world_builder")
	if builder != null and builder.get("data") is Dictionary:
		builder.data.wood = mini(200, int(builder.data.get("wood", 0)) + 1)
		if builder.has_method("_changed"):
			builder._changed("A planet lumberjack delivered 1 lumber to the shared stockpile.")
	entry.target = null
	entry.felling = null
	entry.strikes = 0
	entry.phase = "search"
	_animate(entry.node, "Worker_Idle")

func _walk(worker: Node3D, destination: Vector3, delta: float, stop_radius: float) -> bool:
	var from: Vector3 = (worker.global_position - planet.center).normalized()
	var goal: Vector3 = destination.normalized()
	var distance: float = planet.radius * from.angle_to(goal)
	if distance <= stop_radius:
		worker.set_meta("planet_step_blocked", false)
		return true
	var forward := _tangent(from, goal - from * goal.dot(from))
	var step := minf(minf(WALK_SPEED * delta, 0.22), distance - stop_radius)
	var next := (from * cos(step / planet.radius) + forward * sin(step / planet.radius)).normalized()
	var old_height: float = planet.fields.height_at(from)
	var new_height: float = planet.fields.height_at(next)
	if planet.fields.sample(next).get("water", false) or absf(new_height - old_height) > 0.32:
		worker.set_meta("planet_step_blocked", true)
		_animate(worker, "Worker_Idle")
		return false
	worker.set_meta("planet_step_blocked", false)
	worker.global_position = planet.surface_point(next)
	_orient(worker, next, forward)
	_animate(worker, "Worker_Walk")
	return distance - step <= stop_radius

func _tangent(up: Vector3, hint: Vector3) -> Vector3:
	var tangent: Vector3 = hint.slide(up)
	if tangent.length_squared() < 0.0001: tangent = Vector3.FORWARD.slide(up)
	if tangent.length_squared() < 0.0001: tangent = Vector3.RIGHT.slide(up)
	return tangent.normalized()

func _orient(worker: Node3D, direction: Vector3, heading: Vector3) -> void:
	var up: Vector3 = planet.fields.normal_at(direction)
	worker.global_basis = Basis.looking_at(_tangent(up, heading), up)

func _animate(worker: Node3D, clip: String) -> void:
	var player: AnimationPlayer = worker.get_meta("animator", null)
	if not is_instance_valid(player): return
	var actual := clip
	if not player.has_animation(actual):
		for name in player.get_animation_list():
			if str(name).ends_with(clip): actual = str(name); break
	if player.has_animation(actual) and str(worker.get_meta("clip", "")) != actual:
		player.play(actual, 0.16)
		worker.set_meta("clip", actual)

func _add_carry_log(worker: Node3D) -> void:
	if worker.get_node_or_null("CarryLog") != null or not ResourceLoader.exists(CARRY_SCENE): return
	var packed: PackedScene = load(CARRY_SCENE)
	if packed == null: return
	var log := packed.instantiate()
	log.name = "CarryLog"
	worker.add_child(log)
	log.position = Vector3(0.32, 1.12, 0.0)
	log.rotation.z = PI * 0.5
