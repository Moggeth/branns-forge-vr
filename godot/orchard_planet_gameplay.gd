extends Node3D
## Planet-local creatures, harvestables and magical construction. The terrain owns
## height changes; this node owns the resulting gameplay placements.
const TreeKit = preload("res://tree_kit.gd")
const WorldZones = preload("res://world_zones.gd")
const WorkshopScene = preload("res://workshop_scene.gd")
const MAX_PLACEMENTS := 180
const INITIAL_PLACEMENT_LIMIT := 110
const CASTS := {"raise": 14, "sunder": 20, "grove": 18, "forestline": 24, "treering": 24, "starfall": 30, "path": 6, "wall": 18, "fault": 24}
var planet
var fields
var terrain
var game
var placed: Array[Node3D] = []
var actors: Array[Node3D] = []
var commands: Array[Dictionary] = []
var _serial := 0
var _ore_serial := 0
var _ground_revision := -1

func setup(owner_planet) -> void:
	planet = owner_planet
	fields = planet.fields
	terrain = planet.terrain
	game = planet.game if planet.get("game") != null else null
	global_position = planet.center
	_ground_revision = fields.revision

func _direction(world_point: Vector3) -> Vector3:
	if world_point == Vector3.INF: return Vector3.ZERO
	return (world_point - planet.center).normalized()

func _tangent(direction: Vector3, hint: Vector3 = Vector3.ZERO) -> Vector3:
	var tangent := hint - direction * hint.dot(direction)
	if tangent.length_squared() < 0.0001:
		tangent = Vector3.FORWARD - direction * Vector3.FORWARD.dot(direction)
	if tangent.length_squared() < 0.0001:
		tangent = Vector3.RIGHT - direction * Vector3.RIGHT.dot(direction)
	return tangent.normalized()

func _basis(direction: Vector3, hint: Vector3 = Vector3.ZERO) -> Basis:
	var up: Vector3 = fields.normal_at(direction)
	return Basis.looking_at(_tangent(up, hint), up)

func _near(direction: Vector3, tangent: Vector3, metres: float) -> Vector3:
	return (direction * cos(metres / fields.radius) + tangent * sin(metres / fields.radius)).normalized()

func _surface(direction: Vector3) -> Vector3:
	return fields.surface_point(direction)

func _canonical(action: String) -> String:
	var key := action.to_lower().replace("_", "").replace(" ", "")
	match key:
		"raise", "raiseland", "raisedearth": return "raise"
		"sunder": return "sunder"
		"path", "carvepath": return "path"
		"wall", "earthenwall": return "wall"
		"fault", "crystalfault": return "fault"
		"grove", "growgrove", "forest": return "grove"
		"forestline", "treeline": return "forestline"
		"treering", "ring": return "treering"
		"starfall", "meteor": return "starfall"
	return ""

func preview(action: String, point: Vector3, start: Vector3 = Vector3.INF) -> Dictionary:
	if fields == null: return {"ok": false, "error": "Planet is not ready"}
	var kind := _canonical(action)
	if kind.is_empty(): return {"ok": false, "error": "Unknown planet spell"}
	var direction := _direction(point)
	if direction == Vector3.ZERO: return {"ok": false, "error": "Aim at the planet surface"}
	var start_direction := _direction(start)
	var length := 0.0
	var axis := _tangent(direction, start_direction - direction)
	var center := direction
	if start_direction != Vector3.ZERO:
		length = fields.radius * acos(clampf(start_direction.dot(direction), -1.0, 1.0))
		var heading := _tangent(start_direction, direction - start_direction * direction.dot(start_direction))
		center = _arc_direction(start_direction, heading, length * 0.5)
		axis = _tangent(center, heading)
	var radius := 5.5 if kind in ["raise", "grove"] else (8.0 if kind in ["forestline", "treering"] else (4.0 if kind == "starfall" else 7.0))
	if kind in ["forestline", "sunder", "path", "wall", "fault"] and length < 1.0: length = 12.0
	return {"ok": true, "action": kind, "direction": direction, "start_direction": start_direction,
		"position": planet.center + _surface(direction), "normal": fields.normal_at(direction),
		"axis": axis, "center_direction": center, "radius": radius, "length": length, "cost": CASTS[kind],
		"biome": fields.sample(direction).get("biome", "temperate")}

func _arc_direction(origin: Vector3, heading: Vector3, metres: float) -> Vector3:
	var angle: float = metres / fields.radius
	return (origin * cos(angle) + heading * sin(angle)).normalized()

func _line_points(plan: Dictionary, count: int) -> Array[Vector3]:
	var result: Array[Vector3] = []
	var start: Vector3 = plan.start_direction
	var finish: Vector3 = plan.direction
	if start == Vector3.ZERO:
		start = _near(finish, -plan.axis, plan.length * 0.5)
		finish = _near(finish, plan.axis, plan.length * 0.5)
	var heading := _tangent(start, finish - start * finish.dot(start))
	for i in count:
		result.append(_arc_direction(start, heading, plan.length * (float(i) + 0.5) / float(count)))
	return result

func cast(action: String, point: Vector3, start: Vector3 = Vector3.INF) -> Dictionary:
	var plan := preview(action, point, start)
	if not plan.get("ok", false): return plan
	var kind: String = plan.action
	var needed: int = {"grove": 10, "forestline": 11, "treering": 12, "starfall": 4, "fault": 4}.get(kind, 0)
	if placed.size() + needed > MAX_PLACEMENTS: return {"ok": false, "error": "This planet has reached its active object limit"}
	var direction: Vector3 = plan.direction
	var ops: Array[Dictionary] = []
	match kind:
		"raise": ops.append({"type": "raised_earth", "center": direction, "radius": plan.radius, "strength": 2.1})
		"starfall": ops.append({"type": "crater", "center": direction, "radius": plan.radius, "strength": 2.5})
		"sunder", "fault", "wall", "path":
			var segments := mini(16, maxi(1, ceili(plan.length / (34.0 if kind in ["wall", "path"] else 75.0))))
			var segment_length: float = plan.length / float(segments)
			for center in _line_points(plan, segments):
				var tangent := _tangent(center, plan.axis)
				match kind:
					"sunder": ops.append({"type": "sunder", "center": center, "radius": maxf(7.0, segment_length * 0.55), "strength": 2.3, "width": 1.6, "axis": tangent})
					"fault": ops.append({"type": "sunder", "center": center, "radius": maxf(7.0, segment_length * 0.55), "strength": 1.6, "width": 1.2, "axis": tangent})
					"wall": ops.append({"type": "raised_earth", "center": center, "radius": maxf(3.5, segment_length * 0.7), "strength": 2.4})
					"path": ops.append({"type": "path", "center": center, "radius": maxf(4.0, segment_length * 0.55), "width": 2.2, "strength": 1.0, "axis": tangent})
		"forestline":
			for center in _line_points(plan, mini(8, maxi(1, ceili(plan.length / 24.0)))):
				ops.append({"type": "forest", "center": center, "radius": 3.0, "strength": 0.7})
		_: ops.append({"type": "forest", "center": direction, "radius": plan.radius, "strength": 0.8})
	var result: Dictionary = {}
	for op in ops:
		result = terrain.queue_operation(op) if terrain != null else fields.apply_operation(op)
		if not result.get("ok", false): return result
	var count := 0
	var line_indices: Array[int] = []
	match kind:
		"grove": count = _plant_pattern(direction, plan.axis, "grove", 7)
		"forestline": count = _plant_line(plan, 8, false, line_indices)
		"treering": count = _plant_pattern(direction, plan.axis, "ring", 9)
		"starfall": count = _spawn_starfall(direction)
		"fault":
			var fault_points := _line_points(plan, 4)
			for i in fault_points.size():
				_ore(fault_points[i], i + 1, false)
				count += 1
	commands.append({"action": kind, "direction": [direction.x, direction.y, direction.z],
		"start_direction": [plan.start_direction.x, plan.start_direction.y, plan.start_direction.z],
		"axis": [plan.axis.x, plan.axis.y, plan.axis.z], "radius": plan.radius,
		"length": plan.length, "line_indices": line_indices})
	result["action"] = kind
	result["placed"] = count
	result["cost"] = plan.cost
	if kind in ["starfall", "fault"]: _register_mining()
	return result

func _plant_line(plan: Dictionary, requested: int, restoring: bool = false, chosen: Array[int] = []) -> int:
	var count := mini(requested, MAX_PLACEMENTS - placed.size())
	var grown := 0
	var points := _line_points(plan, count)
	for i in points.size():
		if restoring and not chosen.has(i): continue
		var direction: Vector3 = points[i]
		if not restoring and fields.sample(direction).get("water", false): continue
		_serial += 1
		_tree(direction, fields.seed * 100003 + _serial, grown < 3)
		if not restoring: chosen.append(i)
		grown += 1
	return grown

func _place(node: Node3D, direction: Vector3, tangent: Vector3 = Vector3.ZERO) -> Node3D:
	add_child(node)
	node.position = _surface(direction)
	node.basis = _basis(direction, tangent)
	node.set_meta("planet_direction", direction)
	node.set_meta("zone", "orchard_planet")
	placed.append(node)
	return node

func _tree(direction: Vector3, seed: int, interactive: bool, species_hint: String = "auto") -> Node3D:
	var species := species_hint if species_hint in ["apple", "pine"] else ("apple" if interactive or fields.sample(direction).get("moisture", 0.5) > 0.37 else "pine")
	var tree: Node3D = TreeKit.make_tree(species, seed, {"height": 4.7 if species == "apple" else 6.1,
		"lod": "near" if interactive else "far", "lod_switch": 24.0 if interactive else 0.0,
		"choppable": interactive, "collision": true, "fruit": species == "apple", "shadows": interactive})
	tree.set_meta("planet_tree", true)
	if interactive:
		tree.set_meta("kind", "resource")
		tree.set_meta("resource", "lumber")
		tree.set_meta("resource_id", "lumber")
		tree.set_meta("requires", "axe")
		tree.set_meta("amount", 1)
		tree.set_meta("hp", 2)
		tree.set_meta("trunk", tree.get_node_or_null("Trunk"))
		if tree.get_node_or_null("Trunk") != null: tree.set_meta("trunk_mesh", tree.get_node("Trunk").mesh)
	_place(tree, direction)
	if interactive and game != null and game.get("scene") != null and game.scene.get("resources") != null:
		game.scene.resources.append(tree)
	if interactive and species == "apple":
		var fruit := Node3D.new()
		fruit.name = "PlanetApple_%d" % seed
		fruit.set_meta("kind", "resource")
		fruit.set_meta("resource", "apple")
		fruit.set_meta("resource_id", "apple")
		fruit.set_meta("requires", "")
		fruit.set_meta("amount", 1)
		TreeKit.dress_apple_pickup(fruit, 1)
		_place(fruit, direction, Vector3.RIGHT)
		var offset := Vector3(0.65, 1.7, 0.15)
		fruit.set_meta("planet_offset", offset)
		fruit.position += fruit.basis * offset
		if game != null and game.get("scene") != null and game.scene.get("resources") != null:
			game.scene.resources.append(fruit)
	return tree

func _plant_pattern(direction: Vector3, axis: Vector3, pattern: String, requested: int) -> int:
	var count := mini(requested, MAX_PLACEMENTS - placed.size())
	var grown := 0
	var side := direction.cross(axis).normalized()
	for i in count:
		var offset := Vector2.ZERO
		match pattern:
			"line": offset = Vector2((float(i) - float(count - 1) * 0.5) * 2.15, 0.4 * sin(float(i) * 2.7))
			"ring": offset = Vector2(cos(TAU * float(i) / count), sin(TAU * float(i) / count)) * 5.4
			_: offset = Vector2(cos(float(i) * 2.4), sin(float(i) * 2.4)) * (1.2 + 1.4 * sqrt(float(i)))
		var target: Vector3 = (direction + (axis * offset.x + side * offset.y) / fields.radius).normalized()
		if fields.sample(target).get("water", false): continue
		_serial += 1
		_tree(target, fields.seed * 100003 + _serial, i < 3)
		grown += 1
	return grown

func _spawn_starfall(direction: Vector3) -> int:
	var count := mini(4, MAX_PLACEMENTS - placed.size())
	var tangent := _tangent(direction)
	var side := direction.cross(tangent).normalized()
	for i in count:
		var at: Vector3 = (direction + (tangent * cos(float(i) * TAU / count) + side * sin(float(i) * TAU / count)) * 1.9 / fields.radius).normalized()
		_ore(at, i, true)
	return count

func _ore(direction: Vector3, index: int, from_starfall: bool = false) -> Node3D:
	var data := {"resources": []}
	WorldZones.ore(self, data, "orchard_planet", _surface(direction), "iron" if index % 2 == 0 else "crystal", "72d9eb" if index % 2 else "e1a75b")
	var ore: Node3D = data.resources.back()
	_ore_serial += 1
	ore.set_meta("id", "orchard-ore-%d-%d" % [fields.seed, _ore_serial])
	ore.set_meta("zone", "orchard_planet")
	ore.basis = _basis(direction)
	ore.set_meta("planet_ore", true)
	ore.set_meta("planet_starfall_ore", from_starfall)
	if from_starfall: ore.set_meta("planet_reward", "star_iron" if index % 2 == 0 else "meteor_gem")
	ore.set_meta("planet_direction", direction)
	placed.append(ore)
	if game != null and game.get("scene") != null and game.scene.get("resources") != null:
		game.scene.resources.append(ore)
	return ore

func _register_mining() -> void:
	if game != null and game.get("mining") != null and game.mining.get("deposits") != null:
		var deposits: Node = game.mining.deposits
		deposits._register_authored()
		# Physical starfall rock still uses the iron/crystal damage profiles, but
		# its extracted chunks feed the existing World Builder star-material ledger.
		for node in placed:
			if not is_instance_valid(node) or not node.get_meta("planet_starfall_ore", false): continue
			var id := node.get_instance_id()
			if deposits.entries.has(id): deposits.entries[id]["resource"] = node.get_meta("planet_reward")

func _seed_cluster(anchor: Vector3, requested: int, interactive_count: int, species_hint: String = "auto") -> void:
	var tangent := _tangent(anchor)
	var side := anchor.cross(tangent).normalized()
	var grown := 0
	for attempt in requested * 3:
		if grown >= requested or placed.size() + 2 > INITIAL_PLACEMENT_LIMIT: break
		var angle := float(attempt) * 2.399963229728653
		var distance := 2.5 + 2.65 * sqrt(float(attempt))
		var direction: Vector3 = (anchor + (tangent * cos(angle) + side * sin(angle)) * distance / fields.radius).normalized()
		if fields.sample(direction).get("water", false): continue
		_serial += 1
		_tree(direction, fields.seed * 100003 + _serial, grown < interactive_count, species_hint)
		grown += 1

func _seed_direction(index: int, count: int) -> Vector3:
	var y := 1.0 - 2.0 * (float(index) + 0.5) / float(count)
	var a := float(index) * 2.399963229728653
	var r := sqrt(maxf(0.0, 1.0 - y * y))
	return Vector3(r * cos(a), y, r * sin(a))

func _enemy(direction: Vector3, kind: String) -> Node3D:
	var actor: Node3D
	if kind == "rat":
		actor = WorkshopScene.make_rat(actors.size())
		actor.set_meta("zone", "orchard_planet")
		actor.set_meta("alive", true)
		actor.set_meta("hp", 18.0)
		actor.set_meta("max_hp", 18.0)
		_place(actor, direction)
	else:
		var data := {"enemies": []}
		actor = WorldZones.enemy(self, data, "orchard_planet", _surface(direction), kind)
		actor.basis = _basis(direction)
		placed.append(actor)
		actor.set_meta("hp", 110.0 if kind == "golem" else (66.0 if kind == "skeleton" else 44.0))
		actor.set_meta("max_hp", actor.get_meta("hp"))
	actor.set_meta("planet_actor", true)
	actor.set_meta("zone", "orchard_planet")
	actor.set_meta("home_direction", direction)
	actor.set_meta("home", planet.center + _surface(direction))
	actors.append(actor)
	if game != null and game.get("scene") != null:
		if kind == "rat" and game.scene.get("rats") != null: game.scene.rats.append(actor)
		elif kind != "rat" and game.scene.get("enemies") != null: game.scene.enemies.append(actor)
		if game.get("animation") != null and not game.animation.actors.has(actor.get_instance_id()): game.animation.register(actor)
	return actor

func build() -> void:
	for node in placed:
		if not is_instance_valid(node): continue
		if game != null and game.get("scene") != null:
			if game.scene.get("enemies") != null: game.scene.enemies.erase(node)
			if game.scene.get("rats") != null: game.scene.rats.erase(node)
			if game.scene.get("resources") != null: game.scene.resources.erase(node)
			if game.get("animation") != null: game.animation.actors.erase(node.get_instance_id())
		node.queue_free()
	placed.clear()
	actors.clear()
	commands.clear()
	_serial = 0
	_ore_serial = 0
	_ground_revision = fields.revision
	# Seed broad orchard and woodland pockets from the same regional anchors as
	# the terrain. Dry and high regions retain only sparse pines.
	var anchors: Array[Dictionary] = fields.region_anchors()
	for region in anchors:
		var biome: String = region["biome"]
		var direction: Vector3 = region["direction"]
		match biome:
			"temperate": _seed_cluster(direction, 16, 6)
			"forest": _seed_cluster(direction, 18, 6)
			"wetland": _seed_cluster(direction, 8, 2)
			"magical": _seed_cluster(direction, 8, 2)
			"highland", "alpine", "crystal", "ruins": _seed_cluster(direction, 2, 0, "pine")
	for i in 12:
		_ore(_seed_direction(i * 7 + 3, 89), i)
	for i in 10:
		var direction := _seed_direction(i * 3 + 1, 31)
		_enemy(direction, ["skeleton", "rat", "wisp", "golem"][i % 4])
	_register_mining()

func tick(_delta: float) -> void:
	# The owner runtime advances enemies tangentially. Re-seat static placements
	# after terrain edits, retaining their radial orientation and usable collision.
	if fields.revision == _ground_revision: return
	_ground_revision = fields.revision
	for node in placed:
		if not is_instance_valid(node) or node.get_meta("planet_actor", false): continue
		if node.has_meta("planet_direction"):
			var direction: Vector3 = node.get_meta("planet_direction")
			var offset: Vector3 = node.get_meta("planet_offset", Vector3.ZERO)
			node.basis = _basis(direction)
			node.position = _surface(direction) + node.basis * offset

func snapshot() -> Dictionary:
	return {"version": 1, "commands": commands.duplicate(true)}

func load_snapshot(data: Dictionary) -> bool:
	if int(data.get("version", 0)) != 1: return false
	build()
	commands.clear()
	for command in data.get("commands", []):
		if not command is Dictionary: return false
		var d: Array = command.get("direction", [])
		var a: Array = command.get("axis", [])
		if d.size() != 3 or a.size() != 3: return false
		var direction := Vector3(float(d[0]), float(d[1]), float(d[2])).normalized()
		var axis := Vector3(float(a[0]), float(a[1]), float(a[2])).normalized()
		var s: Array = command.get("start_direction", [])
		if not s.is_empty() and s.size() != 3: return false
		var start_direction := Vector3(float(s[0]), float(s[1]), float(s[2])).normalized() if s.size() == 3 else Vector3.ZERO
		var line_plan := {"direction": direction, "start_direction": start_direction, "axis": axis, "length": float(command.get("length", 12.0))}
		match str(command.get("action", "")):
			"grove": _plant_pattern(direction, axis, "grove", 7)
			"forestline":
				var chosen: Array[int] = []
				for index in command.get("line_indices", range(8)): chosen.append(int(index))
				_plant_line(line_plan, 8, true, chosen)
			"treering": _plant_pattern(direction, axis, "ring", 9)
			"starfall": _spawn_starfall(direction)
			"fault":
				var fault_points := _line_points(line_plan, 4)
				for i in fault_points.size(): _ore(fault_points[i], i + 1, false)
		commands.append(command.duplicate(true))
	_register_mining()
	return true
