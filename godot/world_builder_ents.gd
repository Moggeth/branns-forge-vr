extends Node

const Presentation = preload("res://world_builder_ent_presentation.gd")
const EntLog = preload("res://world_builder_ent_log.gd")
const IdleWander = preload("res://creature_idle_wander.gd")
## Awakens indexed orchard timber in place. The source tree remains the enemy body.
const ZONE := "orchard_highlands"
const MAX_ENTS := 8
const COST := 3.0
const CALM_COST := 2.0
const CALM_SECONDS := 90.0
const REACH := 5.0
const BURN_SECONDS := 12.0

signal ent_event(payload: Dictionary) # Optional art/animation listener; never owns source mesh.

var builder: Node
var game: Node3D
var active: Dictionary = {} # key -> original tree; never serialized
var clock := 0.0
var attack_at: Dictionary = {}
var fruit_entry_by_key: Dictionary = {}
var quenched_until: Dictionary = {}
var saved_motion_at: Dictionary = {}

func setup(owner_builder: Node) -> void:
	builder = owner_builder
	game = builder.game
	ent_event.connect(_present_event)
	if not builder.data.has("ents"): builder.data.ents = []
	if not builder.data.has("ent_seeds"): builder.data.ent_seeds = []
	restore()

static func valid_seeds(value: Variant) -> bool:
	if not value is Array or value.size() > MAX_ENTS: return false
	var seen := {}
	for item in value:
		if not item is Dictionary: return false
		if not item.get("key") is String or str(item.key).is_empty() or str(item.key).length() > 24 or seen.has(item.key): return false
		if str(item.get("species", "")) not in ["apple", "pine", "oak", "birch"]: return false
		seen[item.key] = true
	return true

func _present_event(payload: Dictionary) -> void:
	var tree: Node3D = payload.get("tree", null)
	if not is_instance_valid(tree): return
	var art: Node = tree.get_node_or_null("EntPresentation")
	if art != null: art.react(payload)

static func valid_records(value: Variant) -> bool:
	if not value is Array or value.size() > MAX_ENTS: return false
	var seen := {}
	for item in value:
		if not item is Dictionary: return false
		var key: Variant = item.get("key")
		if not key is String or key.length() > 24 or key.is_empty() or seen.has(key): return false
		seen[key] = true
		if str(item.get("state", "")) not in ["active", "calm", "dead"]: return false
		if str(item.get("species", "")) not in ["apple", "pine", "oak", "birch"]: return false
		for field in ["scale", "hp", "calm_left"]:
			if not item.get(field) is float and not item.get(field) is int: return false
			if not is_finite(float(item[field])): return false
		if float(item.scale) < 0.4 or float(item.scale) > 3.5: return false
		if float(item.hp) < 0 or float(item.hp) > 500: return false
		if float(item.calm_left) < 0 or float(item.calm_left) > CALM_SECONDS: return false
		if item.has("burn_left"):
			if not item.burn_left is float and not item.burn_left is int: return false
			if not is_finite(float(item.burn_left)) or float(item.burn_left) < 0.0 or float(item.burn_left) > BURN_SECONDS: return false
		if str(item.get("condition", "")) not in ["healthy", "burning"]: return false
		if item.has("position"):
			if not item.position is Array or item.position.size() != 2: return false
			for axis in item.position:
				if not axis is float and not axis is int: return false
				if not is_finite(float(axis)) or absf(float(axis)) > IdleWander.HOME_RADIUS: return false
			if Vector2(float(item.position[0]), float(item.position[1])).length() > IdleWander.HOME_RADIUS: return false
		if item.has("yaw"):
			if not item.yaw is float and not item.yaw is int: return false
			if not is_finite(float(item.yaw)) or absf(float(item.yaw)) > TAU: return false
	return true

func _record(key: String) -> Dictionary:
	for item in builder.data.ents:
		if str(item.key) == key: return item
	return {}

func _candidate(point: Vector3) -> Dictionary:
	var nearest := ""
	var best := REACH
	var scenic := false
	for key in builder.resource_by_key:
		var tree: Node3D = builder.resource_by_key[key]
		if not is_instance_valid(tree) or not tree.visible: continue
		var distance := Vector2(tree.global_position.x - builder.center.x - point.x, tree.global_position.z - builder.center.z - point.z).length()
		if distance < best: nearest = key; best = distance; scenic = false
	for key in builder.scenic_by_key:
		var source: Dictionary = builder.scenic_by_key[key]
		if not is_instance_valid(source.collision) or source.collision.disabled: continue
		var place: Vector3 = source.position
		var distance := Vector2(place.x - point.x, place.z - point.z).length()
		if distance < best: nearest = key; best = distance; scenic = true
	if nearest.is_empty(): return {}
	var species := "apple"
	var scale := 1.0
	var tree: Node3D = null
	if scenic:
		var collision: CollisionShape3D = builder.scenic_by_key[nearest].collision
		species = str(collision.get_meta("builder_species", "apple"))
		scale = float(collision.get_meta("builder_scale", 1.0))
	else:
		tree = builder.resource_by_key[nearest]
		species = str(tree.get_meta("tree_species", "pine" if str(tree.name).to_lower().contains("pine") else "apple"))
		scale = clampf(float(tree.get_meta("tree_height", 5.0)) / 5.0, 0.4, 3.5)
	var global_point: Vector3 = builder.center + (builder.scenic_by_key[nearest].position if scenic else tree.global_position - builder.center)
	var burning := bool(tree.get_meta("burning", false)) if tree != null else false
	if game.get("heat_contacts") != null and game.heat_contacts.has_method("hot_at"):
		burning = burning or game.heat_contacts.hot_at(global_point + Vector3.UP, ZONE, 0.8)
	return {"key": nearest, "scenic": scenic, "species": species, "scale": clampf(scale, 0.4, 3.5), "condition": "burning" if burning else "healthy"}

func preview(point: Vector3) -> Dictionary:
	var result := {"reason": "", "key": "", "species": "", "scale": 0.0, "condition": "", "risk": ""}
	if not builder._inside(point): result.reason = "Outside the orchard boundary."; return result
	var source := _candidate(point)
	if source.is_empty(): result.reason = "Point near a standing tree."; return result
	for field in ["key", "species", "scale", "condition"]: result[field] = source[field]
	if source.key in builder.data.harvested: result.reason = "This tree has already been harvested."
	elif not _record(source.key).is_empty(): result.reason = "This tree has already awakened."
	elif source.key in builder.data.marked or builder.scenic_pending.has(source.key): result.reason = "This tree is already claimed for harvest."
	elif _living_count() >= MAX_ENTS: result.reason = "Eight Ents are already awake."
	elif float(builder.data.mana) < COST: result.reason = "Need 3 Mana to awaken a tree."
	result.risk = "Burning Ent: spreads shared heat and strikes hard." if source.condition == "burning" else ("Pine Ent: sturdy, wide defense." if source.species == "pine" else "Apple Ent: can drop healing fruit; hostile until calmed.")
	return result

func awaken(point: Vector3) -> String:
	var choice := preview(point)
	if not str(choice.reason).is_empty(): return choice.reason
	var key: String = choice.key
	var tree: Node3D = builder.resource_by_key.get(key, null)
	if not is_instance_valid(tree): tree = builder._reveal_scenic(key)
	if not is_instance_valid(tree): return "That tree is no longer available."
	var hp := (130.0 if choice.species == "pine" else 92.0) * float(choice.scale)
	var record := {"key": key, "state": "active", "species": choice.species, "scale": choice.scale, "condition": choice.condition, "hp": hp, "calm_left": 0.0, "burn_left": BURN_SECONDS if choice.condition == "burning" else 0.0}
	_activate(tree, record)
	for i in range(builder.data.ents.size() - 1, -1, -1):
		if builder.data.ents.size() < MAX_ENTS: break
		if str(builder.data.ents[i].state) == "dead": builder.data.ents.remove_at(i)
	builder.data.ents.append(record)
	builder.data.mana = float(builder.data.mana) - COST
	ent_event.emit({"phase": "awaken", "key": key, "tree": tree, "species": choice.species, "scale": choice.scale, "condition": choice.condition})
	builder._changed("An existing %s tree awakened as an Ent. %s" % [choice.species, choice.risk])
	return ""

func _living_count() -> int:
	var count := 0
	for record in builder.data.ents:
		if str(record.state) != "dead": count += 1
	return count

func _activate(tree: Node3D, record: Dictionary) -> void:
	var key: String = record.key
	var origin: Vector3 = tree.get_meta("ent_origin", tree.global_position)
	tree.set_meta("ent_origin", origin)
	if tree.get_parent() != game.adventure.zone_groups[ZONE]: tree.reparent(game.adventure.zone_groups[ZONE], true)
	if record.has("position"):
		var offset := Vector2(float(record.position[0]), float(record.position[1]))
		var root: Node3D = game.scene.zones.orchard_highlands.root
		var local: Vector3 = root.to_local(origin + Vector3(offset.x, 0.0, offset.y))
		local.y = game.landscape.height_at(Vector2(local.x, local.z))
		tree.global_position = root.to_global(local)
	if record.has("yaw"): tree.rotation.y = float(record.yaw)
	tree.set_meta("kind", "enemy")
	tree.set_meta("enemy_type", "ent")
	tree.set_meta("ent_key", key)
	tree.set_meta("zone", ZONE)
	tree.set_meta("id", "orchard-ent-" + key)
	tree.set_meta("home", origin)
	tree.set_meta("alive", true)
	tree.set_meta("hp", float(record.hp))
	tree.set_meta("max_hp", (130.0 if record.species == "pine" else 92.0) * float(record.scale))
	tree.set_meta("damage", 25 if record.condition == "burning" else 15)
	tree.set_meta("ent_species", record.species)
	tree.set_meta("ent_condition", record.condition)
	tree.set_meta("burning", record.condition == "burning")
	tree.set_meta("ent_calm", str(record.state) == "calm")
	tree.set_meta("attack_at", 0.0)
	if tree not in game.scene.enemies: game.scene.enemies.append(tree)
	active[key] = tree
	if record.condition == "burning" and not record.has("burn_left"): record.burn_left = BURN_SECONDS
	var art: Node3D = tree.get_node_or_null("EntPresentation")
	if art == null:
		art = Presentation.new()
		tree.add_child(art)
		art.rotation.y = PI # Authored face +Z; enemy facing convention is -Z.
		art.setup(tree, str(record.species), float(record.scale), str(record.condition))
	art.react({"phase": "calm" if str(record.state) == "calm" else "restore"})

func restore() -> void:
	active.clear()
	if not valid_records(builder.data.get("ents", [])): return
	for record in builder.data.ents:
		if record.state == "dead" or record.key in builder.data.harvested: continue
		var tree: Node3D = builder.resource_by_key.get(record.key, null)
		if not is_instance_valid(tree): tree = builder.scenic_pending.get(record.key, null)
		if not is_instance_valid(tree): tree = builder._reveal_scenic(record.key)
		if is_instance_valid(tree): _activate(tree, record)

func calm(point: Vector3) -> String:
	var chosen := ""
	var best := REACH
	for key in active:
		var tree: Node3D = active[key]
		if not is_instance_valid(tree) or not bool(tree.get_meta("alive", false)): continue
		var distance := Vector2(tree.global_position.x - builder.center.x - point.x, tree.global_position.z - builder.center.z - point.z).length()
		if distance < best: chosen = key; best = distance
	if chosen.is_empty(): return "Point near a living Ent."
	var record := _record(chosen)
	if record.state == "calm": return "This Ent is already calm."
	if float(builder.data.mana) < CALM_COST: return "Need 2 Mana to calm an Ent."
	builder.data.mana = float(builder.data.mana) - CALM_COST
	record.state = "calm"
	record.calm_left = CALM_SECONDS
	active[chosen].set_meta("ent_calm", true)
	ent_event.emit({"phase": "calm", "key": chosen, "tree": active[chosen], "duration": CALM_SECONDS})
	builder._changed("The Ent guards the grove for 90 seconds.")
	return ""

func tick(delta: float) -> void:
	if delta <= 0: return
	clock += delta
	for key in active.keys():
		var tree: Node3D = active[key]
		if not is_instance_valid(tree): active.erase(key); continue
		var record := _record(key)
		if record.is_empty() or record.state == "dead": continue
		if record.state == "calm":
			_guard(tree, delta)
			if game.adventure.zone == ZONE and tree.is_visible_in_tree() and not _guard_target_near(tree):
				game.adventure._idle_wander(tree, delta, true)
			else:
				tree.set_meta("idle_wander", IdleWander.interrupt(tree.get_meta("idle_wander", {}), game.elapsed))
			record.calm_left = maxf(0.0, float(record.calm_left) - delta)
			if float(record.calm_left) <= 0.0:
				record.state = "active"
				tree.set_meta("ent_calm", false)
				ent_event.emit({"phase": "hostile", "key": key, "tree": tree})
				builder._changed("The Ent's calm has ended.")
		if record.condition == "healthy" and game.heat_contacts != null and game.adventure.zone == ZONE and clock >= float(attack_at.get(key + ":heat_check", 0.0)):
			attack_at[key + ":heat_check"] = clock + 0.25
			if clock >= float(quenched_until.get(key, 0.0)) and game.heat_contacts.hot_at(tree.global_position + Vector3.UP * 0.7, ZONE, 0.8):
				_ignite(tree, record)
				builder._changed("Shared heat ignited the Ent; its strike now burns.")
		if record.condition == "burning":
			record.burn_left = maxf(0.0, float(record.get("burn_left", BURN_SECONDS)) - delta)
			if float(record.burn_left) <= 0.0:
				_extinguish(tree, record)
				builder._changed("The Ent's flames burned out.")
		if record.condition == "burning" and game.get("heat_contacts") != null and clock >= float(attack_at.get(key, 0.0)):
			game.heat_contacts.touch(tree.global_position + Vector3.UP * 0.5, 1.1, 350.0, ZONE, "flame", tree, 0.1)
			attack_at[key] = clock + 0.35
			if record.state == "active" and game.adventure.zone == ZONE and tree.global_position.distance_to(game.rig.global_position) < 1.8:
				game.adventure.take_damage(7.0, "burning Ent")
		if record.species == "apple" and record.state == "calm" and clock >= float(attack_at.get(key + ":fruit", 0.0)):
			_spawn_apple(tree, key)
			attack_at[key + ":fruit"] = clock + 30.0
		_save_motion(key, tree, record)

func _guard_target_near(tree: Node3D) -> bool:
	for enemy in game.scene.enemies:
		if not is_instance_valid(enemy) or enemy == tree or enemy.has_meta("ent_key"): continue
		if bool(enemy.get_meta("alive", false)) and str(enemy.get_meta("zone", "")) == ZONE and tree.global_position.distance_to(enemy.global_position) < 4.0: return true
	return false

func _save_motion(key: String, tree: Node3D, record: Dictionary) -> void:
	if clock < float(saved_motion_at.get(key, 0.0)): return
	var origin: Vector3 = tree.get_meta("ent_origin", tree.global_position)
	var offset := Vector2(tree.global_position.x - origin.x, tree.global_position.z - origin.z)
	var saved: Array = record.get("position", [0.0, 0.0])
	var yaw := wrapf(tree.rotation.y, -PI, PI)
	if Vector2(float(saved[0]), float(saved[1])).distance_to(offset) < 0.15 and absf(wrapf(yaw - float(record.get("yaw", yaw)), -PI, PI)) < 0.15: return
	record.position = [snappedf(offset.x, 0.01), snappedf(offset.y, 0.01)]
	record.yaw = yaw
	saved_motion_at[key] = clock + 3.0
	if not builder.test_mode: builder.save()

func _spawn_apple(tree: Node3D, key: String) -> void:
	if game.apples == null or game.apples.apple_mesh == null: return
	var entry: Dictionary = {}
	if fruit_entry_by_key.has(key):
		var index: int = int(fruit_entry_by_key[key])
		if index < 0 or index >= game.apples.entries.size(): return
		entry = game.apples.entries[index]
		if str(entry.state) != "attached": return
	else:
		var index: int = game.apples.entries.size()
		game.apples._add(tree, Vector3(0.75, 1.45 * float(_record(key).scale), 0.2), ZONE, null, null, -1, {})
		fruit_entry_by_key[key] = index
		entry = game.apples.entries[index]
	game.apples._detach(entry, Vector3.UP * 1.2 + Vector3.RIGHT * 0.5)

func _guard(tree: Node3D, _delta: float) -> void:
	var key := str(tree.get_meta("ent_key")) + ":guard"
	if clock < float(attack_at.get(key, 0.0)): return
	attack_at[key] = clock + 2.0
	var chosen: Node3D = null
	var nearest := 4.0
	for enemy in game.scene.enemies:
		if not is_instance_valid(enemy) or enemy == tree or enemy.has_meta("ent_key") or not bool(enemy.get_meta("alive", false)): continue
		if str(enemy.get_meta("zone", "")) != ZONE: continue
		var distance: float = tree.global_position.distance_to(enemy.global_position)
		if distance < nearest: nearest = distance; chosen = enemy
	if chosen != null: game.adventure.hurt_enemy(chosen, 12.0 * float(_record(str(tree.get_meta("ent_key"))).scale), null, (chosen.global_position - tree.global_position).normalized() * 2.0)

func on_melee(tree: Node3D, damage: float, hand = null, impulse: Vector3 = Vector3.ZERO) -> bool:
	return on_hit(tree, damage, hand, impulse, "physical")

func on_hit(tree: Node3D, damage: float, _hand = null, _impulse: Vector3 = Vector3.ZERO, _type: String = "physical") -> bool:
	if not is_instance_valid(tree) or not tree.has_meta("ent_key"): return false
	var key := str(tree.get_meta("ent_key"))
	var record := _record(key)
	if record.is_empty() or record.state == "dead": return true
	if record.state == "calm":
		record.state = "active"
		record.calm_left = 0.0
		tree.set_meta("ent_calm", false)
		ent_event.emit({"phase": "hostile", "key": key, "tree": tree})
	var first_ignition: bool = _type == "fire" and record.condition != "burning"
	if _type == "fire": _ignite(tree, record)
	var applied := maxf(0.0, damage) * (1.35 if _type == "fire" else (0.72 if record.species == "pine" else 1.0))
	record.hp = maxf(0.0, float(record.hp) - applied)
	tree.set_meta("hp", float(record.hp))
	ent_event.emit({"phase": "hit", "key": key, "tree": tree, "damage": applied, "hp": float(record.hp)})
	if float(record.hp) > 0.0:
		if first_ignition: builder._changed("A fire strike ignited the Ent; keep clear of its burning roots.")
		return true
	_die(tree, record)
	return true

func _ignite(tree: Node3D, record: Dictionary) -> void:
	record.condition = "burning"
	record.burn_left = BURN_SECONDS
	tree.set_meta("ent_condition", "burning")
	tree.set_meta("burning", true)
	tree.set_meta("damage", 25)
	ent_event.emit({"phase": "ignite", "key": record.key, "tree": tree, "condition": "burning"})

func _extinguish(tree: Node3D, record: Dictionary) -> void:
	if record.condition != "burning": return
	record.condition = "healthy"
	record.burn_left = 0.0
	tree.set_meta("ent_condition", "healthy")
	tree.set_meta("burning", false)
	tree.set_meta("damage", 15)
	ent_event.emit({"phase": "quenched", "key": record.key, "tree": tree, "condition": "healthy"})

func on_water(point: Vector3, radius: float, zone_id: String) -> int:
	if zone_id != ZONE or radius <= 0.0: return 0
	var count := 0
	for key in active:
		var tree: Node3D = active[key]
		if not is_instance_valid(tree) or tree.global_position.distance_to(point) > radius + 0.8: continue
		var record := _record(key)
		if record.condition != "burning": continue
		_extinguish(tree, record)
		quenched_until[key] = clock + 3.0
		count += 1
	if count > 0: builder._changed("Water quenched %d burning Ent%s." % [count, "" if count == 1 else "s"])
	return count

func _die(tree: Node3D, record: Dictionary) -> void:
	if record.state == "dead": return
	record.state = "dead"
	record.calm_left = 0.0
	var key: String = record.key
	_spawn_timber(tree, maxi(1, roundi(float(record.scale))))
	ent_event.emit({"phase": "fallen", "key": key, "tree": tree, "species": record.species, "condition": record.condition})
	tree.set_meta("alive", false)
	tree.set_meta("felled", true)
	tree.set_meta("cut_height", 1.0)
	tree.visible = false
	game._set_collisions(tree, false)
	if tree in game.scene.enemies: game.scene.enemies.erase(tree)
	active.erase(key)
	if key not in builder.data.harvested:
		builder.data.harvested.append(key)
		builder.scenic_pending.erase(key)
		builder.data.scenic_cut_heights[key] = 1.0
		if builder.scenic_by_key.has(key): builder._restore_scenic_stump(key, 1.0)
		builder.data.wood = mini(200, int(builder.data.wood) + maxi(1, roundi(float(record.scale))))
		_spawn_pickup(tree.global_position + Vector3.UP * 0.45, "magical_seed", 1, key, str(record.species))
		builder._changed("The Ent fell. Timber reached the stockpile; grip its magical seed to carry it.")

func _spawn_timber(tree: Node3D, amount: int) -> void:
	# One movable piece uses the felled tree's actual trunk mesh and material.
	# Its lumber is credited through the keyed settlement ledger, never gathered twice.
	var body := EntLog.new()
	body.name = "FallenEntTimber"
	game.adventure.zone_groups[ZONE].add_child(body)
	body.global_position = tree.global_position + Vector3.UP * 0.45
	body.setup(game, tree, null)
	body.mass = float(amount) * 4.0

func _spawn_pickup(at: Vector3, resource: String, amount: int, source_key: String = "", species: String = "apple") -> void:
	var drop := Node3D.new()
	drop.name = "Ent_" + resource
	game.adventure.zone_groups[ZONE].add_child(drop)
	drop.global_position = at
	drop.set_meta("kind", "resource")
	drop.set_meta("resource", resource)
	drop.set_meta("requires", "hand")
	drop.set_meta("amount", amount)
	if resource == "magical_seed":
		drop.set_meta("ent_seed_key", source_key)
		drop.set_meta("ent_seed_species", species)
	drop.set_meta("loot", true)
	drop.add_to_group("pickup")
	game._sphere(drop, Vector3.ZERO, 0.15, Color("a6ea8a") if resource == "magical_seed" else Color("e6b967"))
	game._collider(drop, Vector3.ONE * 0.35, Vector3.ZERO)

func claim_seed(drop: Node3D) -> String:
	if not is_instance_valid(drop) or str(drop.get_meta("resource", "")) != "magical_seed": return "Touch a fallen Ent's magical seed."
	var key: String = str(drop.get_meta("ent_seed_key", ""))
	var species: String = str(drop.get_meta("ent_seed_species", ""))
	if key.is_empty() or key not in builder.data.harvested or species not in ["apple", "pine", "oak", "birch"]: return "This seed has no fallen Ent source."
	if bool(drop.get_meta("ent_seed_claimed", false)): return "This seed was already taken."
	for seed in builder.data.ent_seeds:
		if str(seed.key) == key: return "This Ent's seed is already in your pouch."
	if builder.data.ent_seeds.size() >= MAX_ENTS: return "Your seed pouch holds eight seeds."
	drop.set_meta("ent_seed_claimed", true)
	builder.data.ent_seeds.append({"key": key, "species": species})
	drop.visible = false
	game._set_collisions(drop, false)
	drop.queue_free()
	builder._changed("Magical %s seed collected. Point at clear Orchard soil and plant it." % species)
	return ""

func plant_seed(local: Vector3) -> String:
	if builder.data.ent_seeds.is_empty(): return "Carry a magical seed from a fallen Ent first."
	if not builder._inside(local) or local.distance_to(builder.CAMP) < 7.0: return "Choose clear Orchard soil away from camp."
	if builder.data.forest_spells.size() >= builder.MAX_FOREST_SPELLS: return "The grove ledger is full."
	var at := Vector2(local.x, local.z)
	if not game.landscape.passable(at): return "The seed needs walkable, dry soil."
	var key: String = builder._key(local)
	if builder.resource_by_key.has(key) or builder.scenic_by_key.has(key): return "A tree already occupies that soil."
	for existing in builder.resource_by_key.values():
		if is_instance_valid(existing) and Vector2(existing.global_position.x - builder.center.x, existing.global_position.z - builder.center.z).distance_to(at) < 3.0: return "Leave room for the roots."
	for scenic in builder.scenic_by_key.values():
		var point: Vector3 = scenic.position
		if Vector2(point.x, point.z).distance_to(at) < 3.0: return "Leave room for the roots."
	var seed: Dictionary = builder.data.ent_seeds[0]
	var planted := Vector3(at.x, game.landscape.height_at(at), at.y)
	var rotation := float(absi(hash(seed.key)) % 6283) / 1000.0
	var trees: Array[Dictionary] = [{"position": planted, "species": str(seed.species), "scale": 1.0, "rotation": rotation}]
	var placement: Array = builder._pack_forest(trees)
	if placement.size() != 1: return "The seed could not form a persistent tree."
	var record := {"region": {"type": "ent_seed", "points": [builder._pack(local)]}, "seed": absi(hash(seed.key)), "placements": placement, "feature": "ent_seed"}
	builder.data.forest_spells.append(record)
	var roots: Array[Vector3] = builder._render_forest(trees, true)
	if roots.is_empty():
		builder.data.forest_spells.pop_back()
		return "The seed could not take root there."
	builder.data.ent_seeds.remove_at(0)
	var payload: Dictionary = builder._forest_visual_payload(local, local, roots, int(record.seed), builder.data.forest_spells.size())
	builder.forest_visual_event.emit(payload.duplicate(false))
	builder.active_forest_visuals.append({"payload": payload, "elapsed": 0.0})
	builder._changed("A magical %s seed grew into a real harvestable tree." % str(seed.species))
	return ""
