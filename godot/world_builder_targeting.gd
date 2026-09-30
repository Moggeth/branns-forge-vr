extends RefCounted
## Declarative footprints and geometry checks for the *implemented* survey actions.
## Gameplay remains authoritative; this is a truthful, cheap pre-cast preview.
const Ecology = preload("res://landscape_ecology.gd")
const Ops = preload("res://landscape_operations.gd")

static var _growth_cache_key: Array = []
static var _growth_cache_trees: Array[Dictionary] = []

const SPECS := {
	"path": {"kind":"line", "width":4.0, "paint_width":9.0, "minimum":3.0, "maximum":36.0},
	"sunder": {"kind":"line", "width":16.0, "minimum":8.0, "maximum":110.0},
	"wall": {"kind":"line", "width":13.0, "minimum":8.0, "maximum":85.0},
	"forest": {"kind":"line", "width":11.0, "minimum":6.0, "maximum":100.0},
	"fault": {"kind":"line", "width":8.0, "minimum":7.0, "maximum":65.0},
	"bridge": {"kind":"deck", "width":4.0, "minimum":3.0, "maximum":32.0},
	"ramp": {"kind":"deck", "width":3.0, "minimum":3.0, "maximum":18.0},
	"stairs": {"kind":"deck", "width":3.0, "minimum":3.0, "maximum":18.0},
	"boardwalk": {"kind":"deck", "width":3.4, "minimum":3.0, "maximum":36.0},
	"raise": {"kind":"circle", "radius":15.0, "height":3.6},
	"meteor": {"kind":"impact", "radius":10.0, "damage_radius":8.0, "delay":1.25},
	"grove": {"kind":"trees", "radius":3.1, "count":3},
	"ring": {"kind":"annulus", "inner":14.0, "outer":24.0},
	"awaken": {"kind":"tree", "radius":5.0},
	"calm": {"kind":"ent", "radius":5.0},
	"harvest": {"kind":"harvest", "radius":5.0},
	"hire": {"kind":"instant"},
	"seed": {"kind":"sprout", "radius":3.0},
	"patrol": {"kind":"triad", "radius":3.0, "hero_clearance":7.0},
}

static func spec(action: String) -> Dictionary:
	return SPECS.get(action, {}).duplicate(true)

static func is_targetable(entry: Dictionary) -> bool:
	return bool(entry.get("implemented", true)) and SPECS.has(str(entry.get("id", "")))

static func plan(action: String, start: Vector3, point: Vector3, builder: Node, game: Node3D, availability: String) -> Dictionary:
	var result: Dictionary = spec(action)
	result["id"] = action
	result["reason"] = availability
	result["valid"] = availability == ""
	if point == Vector3.INF: return result
	if action == "hire": return result
	if result.kind in ["line", "deck"]:
		if start == Vector3.INF:
			result["stage"] = "start"
			return result
		var length := Vector2(start.x, start.z).distance_to(Vector2(point.x, point.z))
		result["length"] = length
		result["stage"] = "end"
		if result.kind == "deck":
			var deck: Dictionary = builder.construction.preview(action, start, point)
			for key in deck: result[key] = deck[key]
			if availability != "": result["reason"] = availability
		elif action == "path":
			result["cost"] = ceili(start.distance_to(point) / 7.0)
			if availability == "": result["reason"] = builder.can_path(start, point)
		elif availability == "" and (length < float(result.minimum) or length > float(result.maximum)):
			result["reason"] = "Draw between %.0f and %.0f metres." % [float(result.minimum), float(result.maximum)]
		if result.reason == "" and action in ["sunder", "wall", "fault"]:
			result["reason"] = _terrain_reason(action, start, point, builder, game)
		if result.reason == "" and action == "forest":
			if builder.data.forest_spells.size() >= builder.MAX_FOREST_SPELLS:
				result["reason"] = "The grove ledger is full."
			else:
				var region := {"type":"line", "points":[builder._pack(start), builder._pack(point)], "width":11.0}
				var forest_seed: int = int(game.landscape.seed) + int(builder.data.revision) * 101 + 7501
				var trees := _growth("forest", region, forest_seed, builder, game, start, point)
				if trees.is_empty(): result["reason"] = "Trees cannot take root on that slope or in water."
				else: result["tree_positions"] = _positions(trees, 30)
	elif action == "raise" and availability == "":
		result["reason"] = _terrain_reason(action, Vector3.INF, point, builder, game)
	elif action == "ring" and availability == "" and (absf(point.x) > 119.0 or absf(point.z) > 119.0):
		result["reason"] = "Choose a ring with room inside the Orchard."
	elif action == "ring" and availability == "" and builder.data.forest_spells.size() >= builder.MAX_FOREST_SPELLS:
		result["reason"] = "The grove ledger is full."
	elif action == "ring" and availability == "":
		var ring_seed: int = int(game.landscape.seed) + int(builder.data.revision) * 101 + 8357
		var trees := _growth("ring", {}, ring_seed, builder, game, Vector3.INF, point)
		if trees.size() < 10: result["reason"] = "That ring needs gentler, drier ground with more space."
		else: result["tree_positions"] = _positions(trees, 30)
	elif action == "meteor" and availability == "" and (absf(point.x) > 132.0 or absf(point.z) > 132.0):
		result["reason"] = "Call Starfall farther inside the Orchard."
	elif action == "meteor" and availability == "" and builder.data.meteors.size() >= builder.MAX_METEORS:
		result["reason"] = "The Orchard already holds its maximum of ten meteorites."
	elif action == "meteor" and availability == "" and game.landscape.operation_count() >= game.landscape.MAX_OPERATIONS:
		result["reason"] = "The landscape cannot record another impact."
	elif action == "patrol" and availability == "":
		var hero: Vector3 = game.camera.global_position - builder.center
		result["hero_clearance_center"] = Vector3(hero.x, 0, hero.z)
		if builder.data.threats.size() >= builder.MAX_THREATS:
			result["reason"] = "Too many patrols are active in the orchard."
		elif point.distance_to(Vector3(hero.x, 0, hero.z)) < 7.0:
			result["reason"] = "Give the Hero at least seven metres of warning."
	elif action == "grove" and availability == "":
		if point.distance_to(builder.CAMP) < 7.0:
			result["reason"] = "Choose a clearing away from camp."
		elif builder.data.groves.size() >= builder.MAX_GROVES:
			result["reason"] = "The grove ledger is full."
		else:
			for value in builder.data.groves:
				if builder._unpack(value).distance_to(point) < 9.0:
					result["reason"] = "Leave more room between groves."
					break
	elif action == "seed" and availability == "":
		if point.distance_to(builder.CAMP) < 7.0: result["reason"] = "Choose clear Orchard soil away from camp."
		elif not game.landscape.passable(Vector2(point.x, point.z)): result["reason"] = "The seed needs walkable, dry soil."
		elif builder.data.forest_spells.size() >= builder.MAX_FOREST_SPELLS: result["reason"] = "The grove ledger is full."
		elif builder.resource_by_key.has(builder._key(point)) or builder.scenic_by_key.has(builder._key(point)): result["reason"] = "A tree already occupies that soil."
		else:
			for existing in builder.resource_by_key.values():
				if is_instance_valid(existing) and Vector2(existing.global_position.x - builder.center.x, existing.global_position.z - builder.center.z).distance_to(Vector2(point.x, point.z)) < 3.0:
					result["reason"] = "Leave room for the roots."
					break
			if result.reason == "":
				for scenic in builder.scenic_by_key.values():
					var scenic_point: Vector3 = scenic.position
					if Vector2(scenic_point.x, scenic_point.z).distance_to(Vector2(point.x, point.z)) < 3.0:
						result["reason"] = "Leave room for the roots."
						break
	elif action == "awaken" and availability == "":
		var ent: Dictionary = builder.ents.preview(point)
		for key in ent: result[key] = ent[key]
	elif action == "calm" and availability == "":
		var nearest := INF
		var chosen := ""
		for key in builder.ents.active:
			var tree: Node3D = builder.ents.active[key]
			if not is_instance_valid(tree) or not bool(tree.get_meta("alive", false)): continue
			var distance := Vector2(tree.global_position.x - builder.center.x - point.x, tree.global_position.z - builder.center.z - point.z).length()
			if distance < nearest and distance < 5.0: nearest = distance; chosen = str(key)
		if chosen == "": result["reason"] = "Point near a living Ent."
		else:
			var record: Dictionary = builder.ents._record(chosen)
			if str(record.get("state", "")) == "calm": result["reason"] = "This Ent is already calm."
	elif action == "harvest" and availability == "":
		result["reason"] = _harvest_reason(point, builder)
	result["valid"] = str(result.get("reason", "")) == ""
	return result

static func _growth(action: String, region: Dictionary, seed: int, builder: Node, game: Node3D, start: Vector3, point: Vector3) -> Array[Dictionary]:
	## Ecology's pure candidate query makes the verdict and ghost positions match
	## the next cast. Cache unchanged cursor/revision; no meshes or state are built.
	var key: Array = [action, seed, int(builder.data.revision), int(game.landscape.world_revision), start, point]
	if key != _growth_cache_key:
		_growth_cache_key = key
		_growth_cache_trees = Ecology.grow_ring(game.landscape.model, Vector2(point.x, point.z), 19.0, seed) if action == "ring" else Ecology.grow(game.landscape.model, region, seed)
	return _growth_cache_trees

static func _positions(trees: Array[Dictionary], limit: int) -> Array[Vector3]:
	var positions: Array[Vector3] = []
	for tree in trees:
		if positions.size() >= limit: break
		positions.append(tree.position)
	return positions

static func _terrain_reason(action: String, start: Vector3, point: Vector3, builder: Node, game: Node3D) -> String:
	var op := {}
	match action:
		"raise": op = {"type":"raise", "center":builder._pack(point), "radius":15.0, "height":3.6}
		"sunder": op = {"type":"sunder", "points":[builder._pack(start), builder._pack(point)], "width":8.0, "depth":4.2, "height":1.2, "shoulder":4.0, "seed":int(builder.data.revision) + int(game.landscape.seed)}
		"wall": op = {"type":"ridge", "points":[builder._pack(start), builder._pack(point)], "width":13.0, "height":4.0, "feature":"earthen_wall"}
		"fault": op = {"type":"ridge", "points":[builder._pack(start), builder._pack(point)], "width":8.0, "height":4.6, "feature":"crystal_fault", "seed":int(game.landscape.seed) + int(builder.data.revision) * 37}
		_: return ""
	if not Ops.validate(op): return "The earth could not understand that shape."
	if game.landscape.operation_count() >= game.landscape.MAX_OPERATIONS:
		return "This landscape has reached its recorded spell limit."
	var box: Rect2 = Ops.bounds(op)
	if box.position.x < -157.0 or box.position.y < -157.0 or box.end.x > 157.0 or box.end.y > 157.0:
		return "Keep the spell within the Orchard boundary."
	if Ops.affected_chunks(op, game.landscape.model, game.landscape.CHUNK_CELLS).is_empty():
		return "That spell missed the landscape."
	return ""

static func _harvest_reason(point: Vector3, builder: Node) -> String:
	for key in builder.resource_by_key:
		if key in builder.data.harvested or key in builder.data.marked or builder._ent_live(str(key)): continue
		var tree: Node3D = builder.resource_by_key[key]
		if is_instance_valid(tree) and tree.visible and tree.global_position.distance_to(builder.center + point) < 5.0: return ""
	for key in builder.scenic_by_key:
		if key in builder.data.harvested or key in builder.data.marked or builder._ent_live(str(key)) or builder.scenic_pending.has(key): continue
		var record: Dictionary = builder.scenic_by_key[key]
		if is_instance_valid(record.collision) and not record.collision.disabled and point.distance_to(record.position) < 5.0: return ""
	return "Point near a standing timber tree."
