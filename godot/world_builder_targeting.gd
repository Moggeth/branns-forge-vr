extends RefCounted
## Declarative footprints and geometry checks for the *implemented* survey actions.
## Gameplay remains authoritative; this is a truthful, cheap pre-cast preview.

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
	elif action == "ring" and availability == "" and (absf(point.x) > 119.0 or absf(point.z) > 119.0):
		result["reason"] = "Choose a ring with room inside the Orchard."
	elif action == "ring" and availability == "" and builder.data.forest_spells.size() >= builder.MAX_FOREST_SPELLS:
		result["reason"] = "The grove ledger is full."
	elif action == "meteor" and availability == "" and (absf(point.x) > 132.0 or absf(point.z) > 132.0):
		result["reason"] = "Call Starfall farther inside the Orchard."
	elif action == "meteor" and availability == "" and builder.data.meteors.size() >= builder.MAX_METEORS:
		result["reason"] = "The Orchard already holds its maximum of ten meteorites."
	elif action == "patrol" and availability == "":
		var hero: Vector3 = game.camera.global_position - builder.center
		result["hero_clearance_center"] = Vector3(hero.x, 0, hero.z)
		if point.distance_to(Vector3(hero.x, 0, hero.z)) < 7.0:
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
