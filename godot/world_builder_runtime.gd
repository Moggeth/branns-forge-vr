extends Node
## Persistent, bounded settlement edits in the same Orchard Highlands visited by the Hero.
## This module owns the world state. The overhead Window is only another controller.
const W = preload("res://world_zones.gd")
const ZONE = "orchard_highlands"
const SAVE = "user://world_builder_v1.json"
const BRIDGE = "res://assets/worldbuilder/orchard_bridge.glb"
const WORKER = "res://assets/worldbuilder/worker.glb"
const WORKER_WALK_SPEED = 2.1
const STOCKPILE = "res://assets/worldbuilder/stockpile.glb"
const WAYMARKER = "res://assets/worldbuilder/waymarker.glb"
const CAMP = Vector3(15, 0, -27)
const CROSSING = Vector3(25, 0, -48)
const MAX_PATHS = 96
const MAX_WAYMARKERS = 24
const MAX_GROVES = 24
const MAX_BRIDGES = 4
const MAX_THREATS = 8
const MAX_FOREST_SPELLS = 64
## Terrain operations are the durable safety budget (256 across all spells).
## Keep the same bound for save validation; only nearby rocks get individual nodes.
const MAX_METEOR_RECORDS = 256
const MAX_NEAR_METEORS = 20
const MAX_CONCURRENT_FALLS = 4
const METEOR_NEAR_DISTANCE = 52.0
const METEOR_REFRESH_SECONDS = 0.4
const Ecology = preload("res://landscape_ecology.gd")
const Navigation = preload("res://landscape_navigation.gd")
const Water = preload("res://landscape_water.gd")
const Meteor = preload("res://landscape_meteor.gd")
const TreeKit = preload("res://tree_kit.gd")
const TreeFelling = preload("res://tree_felling.gd")
const Spells = preload("res://world_builder_spells.gd")
const Construction = preload("res://world_builder_construction.gd")
const Ents = preload("res://world_builder_ents.gd")
const Encounters = preload("res://world_builder_encounters.gd")

signal forest_visual_event(payload: Dictionary)

var game: Node3D
var root: Node3D
var center := Vector3.ZERO
var data: Dictionary = {}
var worker_nodes: Array[Node3D] = []
var jobs: Array[Dictionary] = []
var growing_trees: Array[Dictionary] = []
var active_forest_visuals: Array[Dictionary] = []
var rendered_markers := 0
var summoned_nodes: Dictionary = {}
var warning_nodes: Dictionary = {}
var resource_by_key: Dictionary = {}
var scenic_by_key: Dictionary = {}
var scenic_instance_by_key: Dictionary = {}
var scenic_pending: Dictionary = {}
var meteor_nodes: Dictionary = {}
var distant_meteors: MultiMeshInstance3D
var meteor_refresh_remaining := 0.0
var test_mode := false
var save_path := SAVE
var save_blocked := false
var autosave_at := 0.0
var progress_message := ""
var progress_until := 0.0
var spells := Spells.new()
var construction: Node
var ents: Node
var encounters: Node
var starfall_presentation: Node3D

func setup(owner_game: Node3D, offline := false) -> void:
	game = owner_game
	test_mode = offline
	center = game.scene.zones[ZONE].center
	root = Node3D.new()
	root.name = "LivingOrchardSettlement"
	game.adventure.zone_groups[ZONE].add_child(root)
	root.global_position = center
	starfall_presentation=preload("res://starfall_presentation.gd").new()
	root.add_child(starfall_presentation)
	starfall_presentation.setup(game)
	distant_meteors = MultiMeshInstance3D.new()
	distant_meteors.name = "DistantMeteorites"
	root.add_child(distant_meteors)
	data = fresh_state()
	_index_timber()
	if not test_mode: _load()
	preload("res://orchard_ground.gd").sync_paths(data.paths)
	_build_brook()
	_build_camp()
	_rebuild_saved()
	construction = Construction.new()
	add_child(construction)
	construction.setup(self)
	construction.restore()
	ents = Ents.new()
	add_child(ents)
	ents.setup(self)
	encounters = Encounters.new()
	add_child(encounters)
	encounters.setup(self)
	_ensure_workers()
	print("WORLD_BUILDER_READY revision=", data.revision, " paths=", data.paths.size(), " groves=", data.groves.size(), " bridges=", data.bridges.size(), " wood=", data.wood)

static func fresh_state() -> Dictionary:
	return {"schema": 1, "revision": 0, "mana": 12.0, "spell_cooldowns": {}, "wood": 0, "workers": 1, "paths": [], "groves": [], "bridges": [], "constructions": [], "ents": [], "ent_seeds": [], "encounter_history": [], "forest_spells": [], "meteors": [], "star_gems": 0, "star_iron": 0, "harvested": [], "scenic_cut_heights": {}, "marked": [], "carried": [], "threats": []}

func spell_catalogue() -> Array[Dictionary]:
	return Spells.catalogue()

func spell_availability(action: String) -> String:
	return spells.availability(action, self)

func spell_cooldown_fraction(action: String) -> float:
	return spells.cooldown_fraction(action, self)

func construct(kind: String, a: Vector3, b: Vector3) -> String:
	if construction == null: return "The construction team is not ready."
	var ready := spells.begin(kind, self)
	if ready != "": return ready
	var result: String = construction.place(kind, a, b)
	if result == "":
		spells.success(kind, self)
		# Construction.place saves its structural edit; persist the cooldown too.
		save()
	return result

func cast_awaken(point: Vector3) -> String:
	if ents == null: return "The Orchard trees are not ready."
	var ready := spells.begin("awaken", self)
	if ready != "": return ready
	var result: String = ents.awaken(point)
	if result == "":
		if not data.ents.is_empty(): _cancel_tree_job(str(data.ents[-1].key))
		spells.success("awaken", self)
		save()
	return result

func calm_ent(point: Vector3) -> String:
	if ents == null: return "The Orchard trees are not ready."
	var ready := spells.begin("calm", self)
	if ready != "": return ready
	var result: String = ents.calm(point)
	if result == "":
		spells.success("calm", self)
		save()
	return result

func assemble_golem(_point: Vector3) -> String:
	return spell_availability("golem")

func _canonical_state(value: Variant) -> Variant:
	if not value is Dictionary: return value
	var candidate: Dictionary = value.duplicate(true)
	if not candidate.has("mana") and candidate.has("aether"): candidate.mana = candidate.aether
	candidate.erase("aether")
	if not candidate.has("spell_cooldowns"): candidate.spell_cooldowns = {}
	if not candidate.has("constructions"): candidate.constructions = []
	if not candidate.has("ents"): candidate.ents = []
	if not candidate.has("encounter_history"): candidate.encounter_history = []
	if not candidate.has("ent_seeds"): candidate.ent_seeds = []
	return candidate

func _valid(value: Variant) -> bool:
	if not value is Dictionary or int(value.get("schema", 0)) != 1: return false
	for field in ["revision", "wood", "workers"]:
		if not value.get(field) is float and not value.get(field) is int: return false
	if not value.get("mana") is float and not value.get("mana") is int: return false
	if value.get("spell_cooldowns") is not Dictionary or value.spell_cooldowns.size() > Spells.ENTRIES.size(): return false
	for action in value.spell_cooldowns:
		if not action is String or Spells.entry(action).is_empty(): return false
		var remaining: Variant = value.spell_cooldowns[action]
		if not remaining is float and not remaining is int or not is_finite(float(remaining)) or float(remaining) < 0.0 or float(remaining) > float(Spells.entry(action).cooldown): return false
	if value.get("paths") is not Array or value.paths.size() > MAX_PATHS: return false
	if value.get("groves") is not Array or value.groves.size() > MAX_GROVES: return false
	if value.get("bridges") is not Array or value.bridges.size() > MAX_BRIDGES: return false
	if not Construction.valid_records(value.get("constructions")): return false
	if not Ents.valid_records(value.get("ents")): return false
	if not Ents.valid_seeds(value.get("ent_seeds", [])): return false
	if not Encounters.valid_history(value.get("encounter_history")): return false
	if value.get("harvested") is not Array or value.harvested.size() > 512: return false
	if value.get("scenic_cut_heights", {}) is not Dictionary or value.get("scenic_cut_heights", {}).size() > 512: return false
	for key in value.get("scenic_cut_heights", {}):
		if not key is String or key.length() > 24: return false
		var height: Variant = value.scenic_cut_heights[key]
		if not height is float and not height is int or not is_finite(float(height)) or float(height) < 0.25 or float(height) > 3.0: return false
	if value.get("marked") is not Array or value.marked.size() > 512: return false
	if value.get("carried", []) is not Array or value.get("carried", []).size() > 5: return false
	if value.get("threats", []) is not Array or value.get("threats", []).size() > MAX_THREATS: return false
	if value.get("forest_spells", []) is not Array or value.get("forest_spells", []).size() > MAX_FOREST_SPELLS: return false
	if value.get("meteors", []) is not Array or value.get("meteors", []).size() > MAX_METEOR_RECORDS: return false
	if int(value.get("star_gems", 0)) < 0 or int(value.get("star_gems", 0)) > 200: return false
	if int(value.get("star_iron", 0)) < 0 or int(value.get("star_iron", 0)) > 200: return false
	for rock in value.get("meteors", []):
		if not rock is Dictionary or not _point_valid(rock.get("center", [])) or not Meteor._valid_record(rock): return false
		if not rock.get("id", "") is String or str(rock.id).length() > 32: return false
		if str(rock.get("phase", "")) not in ["falling", "landed"]: return false
	for grove in value.get("forest_spells", []):
		if not grove is Dictionary or not grove.get("region") is Dictionary or not grove.get("seed") is float and not grove.get("seed") is int: return false
		# Old saves only have a region/seed. New saves pin each tree's identity
		# so later land-shaping cannot silently relocate an existing grove.
		if grove.has("placements"):
			if not grove.placements is Array or grove.placements.size() > 30: return false
			for placement in grove.placements:
				if not placement is Array or placement.size() != 5 or not _point_valid([placement[0], placement[1]]): return false
				if not placement[2] is float and not placement[2] is int or int(placement[2]) not in [0, 1, 2, 3]: return false
				if not placement[3] is float and not placement[3] is int or not is_finite(float(placement[3])) or float(placement[3]) < 0.4 or float(placement[3]) > 2.0: return false
				if not placement[4] is float and not placement[4] is int or not is_finite(float(placement[4])) or absf(float(placement[4])) > TAU + 0.01: return false
	for field in ["harvested", "marked"]:
		for key in value[field]:
			if not key is String or key.length() > 24: return false
	for load in value.get("carried", []):
		if not load is Dictionary or not load.get("key") is String or not load.get("worker") is float and not load.get("worker") is int or not load.get("amount") is float and not load.get("amount") is int: return false
		if int(load.worker) < 0 or int(load.worker) >= 5 or int(load.amount) < 1 or int(load.amount) > 5: return false
	for threat in value.get("threats", []):
		if not threat is Dictionary or not _point_valid(threat.get("at")) or str(threat.get("state", "")) not in ["warning", "active"]: return false
		if not Encounters.valid_threat(threat): return false
		if not threat.get("alive") is Array or threat.alive.size() > 3: return false
		if not threat.get("id") is float and not threat.get("id") is int: return false
		for slot in threat.alive:
			if int(slot) not in [0, 1, 2]: return false
	if int(value.get("workers", 0)) < 1 or int(value.workers) > 5: return false
	if int(value.get("wood", -1)) < 0 or int(value.wood) > 200: return false
	if not is_finite(float(value.mana)) or float(value.mana) < 0 or float(value.mana) > 20: return false
	for path in value.paths:
		if not path is Dictionary or not _point_valid(path.get("a")) or not _point_valid(path.get("b")): return false
	for field in ["groves", "bridges"]:
		for point in value[field]:
			if not _point_valid(point): return false
	return true

func _point_valid(value: Variant) -> bool:
	return value is Array and value.size() == 2 and (value[0] is float or value[0] is int) and (value[1] is float or value[1] is int) and is_finite(float(value[0])) and is_finite(float(value[1])) and absf(float(value[0])) < 155 and absf(float(value[1])) < 155

func _load() -> void:
	if not FileAccess.file_exists(save_path): return
	var bytes := FileAccess.get_file_as_bytes(save_path)
	if bytes.size() > 2097152: push_warning("WORLD_BUILDER save too large; keeping the world untouched"); save_blocked = true; return
	var candidate: Variant = _canonical_state(JSON.parse_string(bytes.get_string_from_utf8()))
	if _valid(candidate):
		data = candidate
		if not data.has("carried"): data.carried = []
		if not data.has("threats"): data.threats = []
		if not data.has("forest_spells"): data.forest_spells = []
		if not data.has("meteors"): data.meteors = []
		if not data.has("star_gems"): data.star_gems = 0
		if not data.has("star_iron"): data.star_iron = 0
		if not data.has("scenic_cut_heights"): data.scenic_cut_heights = {}
	else:
		push_warning("WORLD_BUILDER invalid save; preserving file and starting an empty settlement")
		save_blocked = true

func save() -> bool:
	if test_mode: return true
	if save_blocked: return false
	var temporary := save_path + ".tmp"
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null: push_warning("WORLD_BUILDER save open failed: " + str(FileAccess.get_open_error())); return false
	file.store_string(JSON.stringify(data)); file.close()
	if DirAccess.rename_absolute(ProjectSettings.globalize_path(temporary), ProjectSettings.globalize_path(save_path)) != OK:
		push_warning("WORLD_BUILDER atomic save replace failed")
		return false
	return true

func tick(delta: float) -> void:
	if game == null: return
	if starfall_presentation!=null: starfall_presentation.tick(delta)
	meteor_refresh_remaining -= delta
	if meteor_refresh_remaining <= 0.0:
		meteor_refresh_remaining = METEOR_REFRESH_SECONDS
		_refresh_meteor_visibility()
	_tick_resources(delta)
	if ents != null: ents.tick(delta)
	_sync_threats(delta)
	for i in range(growing_trees.size() - 1, -1, -1):
		var growth: Dictionary = growing_trees[i]
		if not is_instance_valid(growth.node): growing_trees.remove_at(i); continue
		growth.elapsed = float(growth.elapsed) + delta
		var progress := clampf(float(growth.elapsed) / 2.4, 0, 1)
		if growth.has("start"):
			var local_progress := clampf((progress - float(growth.start)) / 0.4, 0.0, 1.0)
			growth.node.scale = Vector3.ONE * lerpf(0.05, 1.0, smoothstep(0.0, 1.0, local_progress))
		else:
			growth.node.scale = Vector3.ONE * lerpf(0.08, 1.0, smoothstep(0.0, 1.0, progress))
		if progress >= 1.0: growing_trees.remove_at(i)
	for i in range(active_forest_visuals.size() - 1, -1, -1):
		var visual: Dictionary = active_forest_visuals[i]
		visual.elapsed = minf(float(visual.elapsed) + delta, 2.4)
		var phase := "settled" if float(visual.elapsed) >= 2.4 else "animating"
		forest_visual_event.emit(_forest_visual_phase(visual.payload, phase, float(visual.elapsed) / 2.4))
		if phase == "settled": active_forest_visuals.remove_at(i)
	_for_each_worker(delta)

func _tick_resources(delta: float) -> void:
	var remaining_cooldowns: bool = not data.spell_cooldowns.is_empty()
	_tick_cooldowns(delta)
	if data.mana < 20.0:
		data.mana = mana_after_regen(float(data.mana), delta, game.tuning.value("worldbuilder.mana_regen_multiplier"))
	if (data.mana < 20.0 or remaining_cooldowns) and game.elapsed >= autosave_at:
		autosave_at = game.elapsed + 15.0
		save()

static func mana_after_regen(current: float, delta: float, multiplier: float) -> float:
	return minf(20.0, current + maxf(delta, 0.0) * 0.055 * clampf(multiplier, 1.0, 8.0))

func _tick_cooldowns(delta: float) -> void:
	for action in data.spell_cooldowns.keys():
		data.spell_cooldowns[action] = maxf(0.0, float(data.spell_cooldowns[action]) - maxf(delta, 0.0))
		if float(data.spell_cooldowns[action]) <= 0.0: data.spell_cooldowns.erase(action)

func _index_timber() -> void:
	resource_by_key.clear()
	scenic_by_key.clear()
	scenic_instance_by_key.clear()
	for resource in game.scene.resources:
		if not is_instance_valid(resource) or str(resource.get_meta("zone", "")) != ZONE or str(resource.get_meta("resource_id", "")) != "lumber": continue
		resource_by_key[_key(resource.global_position - center)] = resource
	var trunk_group: Node3D = game.scene.zones[ZONE].root.get_node_or_null("OrchardGroveTrunks")
	if trunk_group != null:
		for child in trunk_group.get_children():
			if child is CollisionShape3D and child.has_meta("builder_timber"):
				var local: Vector3 = child.position
				local.y = 0
				scenic_by_key[_key(local)] = {"position": local, "collision": child}
	var orchard_root: Node3D = game.scene.zones[ZONE].root
	for holder in orchard_root.find_children("*", "MultiMeshInstance3D", true, false):
		if not holder.has_meta("builder_positions"): continue
		var positions: Array = holder.get_meta("builder_positions")
		for index in positions.size():
			var key := _key(positions[index])
			if not scenic_instance_by_key.has(key): scenic_instance_by_key[key] = []
			scenic_instance_by_key[key].append({"holder": holder, "index": index})

func _key(local: Vector3) -> String:
	return "%d:%d" % [roundi(local.x * 10.0), roundi(local.z * 10.0)]

func _pack(point: Vector3) -> Array:
	return [snappedf(point.x, 0.1), snappedf(point.z, 0.1)]

func _unpack(value: Array) -> Vector3:
	return Vector3(float(value[0]), 0.0, float(value[1]))

func _inside(local: Vector3) -> bool:
	return absf(local.x) <= 145.0 and absf(local.z) <= 145.0

func _near_path(point: Vector3) -> bool:
	for segment in data.paths:
		var a := _unpack(segment.a)
		var b := _unpack(segment.b)
		var span := b - a
		var t := clampf((point - a).dot(span) / maxf(span.length_squared(), 0.001), 0.0, 1.0)
		if point.distance_to(a + span * t) < 2.2: return true
	return false

func can_path(a: Vector3, b: Vector3) -> String:
	if not _inside(a) or not _inside(b): return "Outside the orchard boundary."
	var length := a.distance_to(b)
	if length < 3.0 or length > 36.0: return "Choose a route between 3 and 36 metres."
	if data.paths.size() >= MAX_PATHS: return "The route ledger is full."
	var cost := ceili(length / 7.0)
	var ready := spells.begin("path", self)
	if ready != "": return ready
	if float(data.mana) < cost: return "Need %d Mana to carve this route." % cost
	return ""

func carve_path(a: Vector3, b: Vector3) -> String:
	a.y = 0; b.y = 0
	var problem := can_path(a, b)
	if problem != "": return problem
	data.mana = float(data.mana) - ceili(a.distance_to(b) / 7.0)
	spells.success("path", self)
	data.paths.append({"a": _pack(a), "b": _pack(b)})
	preload("res://orchard_ground.gd").add_path(a,b)
	_render_path(a, b)
	_clear_grove_collision(a, b)
	_changed("A route now crosses the orchard. Walk it in VR or first person.")
	return ""

func cast_sunder(a: Vector3, b: Vector3) -> String:
	if not _inside(a) or not _inside(b): return "Draw within the Orchard boundary."
	var distance := Vector2(a.x, a.z).distance_to(Vector2(b.x, b.z))
	if distance < 8.0 or distance > 110.0: return "Draw a scar between 8 and 110 metres long."
	if float(data.mana) < 5.0: return "Need 5 Mana to sunder the land."
	var ready := spells.begin("sunder", self)
	if ready != "": return ready
	var op := {"type":"sunder", "points":[_pack(a), _pack(b)], "width":8.0, "depth":4.2, "height":1.2, "shoulder":4.0, "seed":int(data.revision) + game.landscape.seed}
	var result: String = game.landscape.apply_magic(op)
	if result != "": return result
	data.mana = float(data.mana) - 5.0
	spells.success("sunder", self)
	_changed("The earth is opening. The scar remains in the world.")
	return ""

func cast_raise(point: Vector3) -> String:
	if not _inside(point): return "Choose ground within the Orchard."
	if float(data.mana) < 4.0: return "Need 4 Mana to raise earth."
	var ready := spells.begin("raise", self)
	if ready != "": return ready
	var op := {"type":"raise", "center":_pack(point), "radius":15.0, "height":3.6}
	var result: String = game.landscape.apply_magic(op)
	if result != "": return result
	data.mana = float(data.mana) - 4.0
	spells.success("raise", self)
	_changed("A hill rises beneath the same sky the Hero can see.")
	return ""


func cast_wall(a: Vector3, b: Vector3) -> String:
	if not _inside(a) or not _inside(b): return "Draw the wall within the Orchard."
	var distance := Vector2(a.x, a.z).distance_to(Vector2(b.x, b.z))
	if distance < 8.0 or distance > 85.0: return "Draw a wall between 8 and 85 metres."
	var use_iron := int(data.star_iron) >= 2
	if not use_iron and float(data.mana) < 4.0: return "Need 4 Mana or 2 mined star iron for an earthen wall."
	var ready := spells.begin("wall", self)
	if ready != "": return ready
	var op := {"type":"ridge", "points":[_pack(a),_pack(b)], "width":13.0, "height":4.0,
		"feature":"earthen_wall"}
	var result: String = game.landscape.apply_magic(op)
	if result != "": return result
	if use_iron: data.star_iron = int(data.star_iron) - 2
	else: data.mana = float(data.mana) - 4.0
	spells.success("wall", self)
	_changed("An earthen wall rises. Its slope and collision are real.")
	return ""


func cast_tree_ring(point: Vector3) -> String:
	if not _inside(point) or absf(point.x) > 119.0 or absf(point.z) > 119.0: return "Choose a ring with room inside the Orchard."
	if float(data.mana) < 4.0: return "Need 4 Mana to grow a tree ring."
	var ready := spells.begin("ring", self)
	if ready != "": return ready
	if data.forest_spells.size() >= MAX_FOREST_SPELLS: return "The grove ledger is full."
	var region := {"type":"ring", "center":_pack(point), "radius":19.0, "width":10.0}
	var spell_seed: int = int(game.landscape.seed) + int(data.revision) * 101 + 8357
	var trees: Array[Dictionary] = Ecology.grow_ring(game.landscape.model, Vector2(point.x, point.z), 19.0, spell_seed)
	if trees.size() < 10: return "That ring needs gentler, drier ground with more space."
	if trees.size() > 30: trees.resize(30)
	data.forest_spells.append({"region":region,"seed":spell_seed,"placements":_pack_forest(trees),"feature":"tree_ring"})
	_render_forest(trees, true)
	data.mana = float(data.mana) - 4.0
	spells.success("ring", self)
	_changed("A ring of harvestable trees is growing around the chosen ground.")
	return ""


func cast_meteor(point: Vector3) -> String:
	if not _inside(point) or absf(point.x) > 132.0 or absf(point.z) > 132.0: return "Call Starfall farther inside the Orchard."
	if float(data.mana) < 8.0: return "Need 8 Mana to call Starfall."
	var ready := spells.begin("meteor", self)
	if ready != "": return ready
	if data.meteors.size() >= MAX_METEOR_RECORDS: return "The Orchard's impact record is full."
	if game.landscape.operation_count() >= game.landscape.MAX_OPERATIONS: return "The landscape cannot record another impact."
	var at := Vector2(point.x,point.z)
	var record: Dictionary = Meteor.make_record(at, int(game.landscape.seed) + int(data.revision) * 503 + 2903, game.landscape.height_at(at))
	record["id"] = "meteor-%06d" % (int(data.revision) + 1)
	record["phase"] = "falling"
	data.meteors.append(record)
	_refresh_meteor_visibility()
	data.mana = float(data.mana) - 8.0
	spells.success("meteor", self)
	_changed("STARFALL! Leave the glowing impact site; then mine its gems with Stonewhisper.")
	return ""


func _render_meteor(record: Dictionary, animate: bool) -> void:
	var id := str(record.id)
	if meteor_nodes.has(id) and is_instance_valid(meteor_nodes[id]): return
	var meteor := Meteor.new()
	root.add_child(meteor)
	meteor.setup(record, animate)
	if starfall_presentation!=null: starfall_presentation.watch_meteor(meteor)
	meteor.impact_ready.connect(_meteor_impact.bind(id))
	meteor.inventory_changed.connect(_meteor_inventory.bind(id))
	meteor_nodes[id] = meteor


func _refresh_meteor_visibility() -> void:
	if distant_meteors == null or game == null: return
	var viewer: Vector3 = game.rig.global_position - center
	var candidates: Array[Dictionary] = []
	var desired: Dictionary = {}
	var falling_count := 0
	for record in data.meteors:
		if str(record.get("phase", "")) == "falling":
			if falling_count < MAX_CONCURRENT_FALLS:
				desired[str(record.id)] = true
				falling_count += 1
			continue
		var at: Array = record.center
		var distance := Vector2(viewer.x, viewer.z).distance_squared_to(Vector2(float(at[0]), float(at[1])))
		if distance <= METEOR_NEAR_DISTANCE * METEOR_NEAR_DISTANCE:
			candidates.append({"id": str(record.id), "distance": distance})
	candidates.sort_custom(func(a: Dictionary, b: Dictionary) -> bool: return float(a.distance) < float(b.distance))
	for i in mini(MAX_NEAR_METEORS, candidates.size()): desired[str(candidates[i].id)] = true
	for id in meteor_nodes.keys():
		if desired.has(id): continue
		var old: Node = meteor_nodes[id]
		meteor_nodes.erase(id)
		if is_instance_valid(old): old.queue_free()
	var far: Array[Dictionary] = []
	for record in data.meteors:
		var id := str(record.id)
		if desired.has(id):
			if not meteor_nodes.has(id): _render_meteor(record, str(record.phase) == "falling")
		elif str(record.get("phase", "")) == "landed":
			far.append(record)
	var batch := MultiMesh.new()
	batch.transform_format = MultiMesh.TRANSFORM_3D
	batch.mesh = Meteor._rock_mesh()
	batch.instance_count = far.size()
	for i in far.size():
		var record: Dictionary = far[i]
		var at: Array = record.center
		var scale_factor := 0.65 if _meteor_depleted(record) else 1.0
		var basis := Basis(Vector3.UP, float(record.rotation)).scaled(Vector3.ONE * scale_factor)
		batch.set_instance_transform(i, Transform3D(basis,
			Vector3(float(at[0]), float(record.ground_y) + 0.65, float(at[1]))))
	distant_meteors.multimesh = batch


func _meteor_depleted(record: Dictionary) -> bool:
	if int(record.get("ore", 0)) > 0: return false
	for count in record.get("veins", []):
		if int(count) > 0: return false
	return true


func _meteor_impact(event: Dictionary, id: String) -> void:
	if not meteor_nodes.has(id): return
	var meteor = meteor_nodes[id]
	var record: Dictionary = meteor.to_record()
	var result: String = game.landscape.apply_impact_magic(Meteor.crater_operation(record))
	if result != "":
		push_warning("STARFALL terrain edit failed: " + result)
		return
	# Plant the visible rock's lowest point into the actual crater bed rather
	# than applying a fixed sink offset that can leave the meteor floating.
	var at:Array=record.center
	var bed:float=game.landscape.height_at(Vector2(float(at[0]),float(at[1])))
	var shell_bottom:float=meteor.core.mesh.get_aabb().position.y*meteor.core.scale.y+meteor.core.position.y
	record.ground_y = bed-shell_bottom-0.12
	meteor.record.ground_y = record.ground_y
	var sink := create_tween()
	sink.tween_property(meteor, "position:y", float(record.ground_y), 1.1)
	for i in data.meteors.size():
		if str(data.meteors[i].get("id", "")) == id:
			record.phase = "landed"
			data.meteors[i] = record
			break
	meteor_refresh_remaining = 0.0
	var impact: Vector3 = center + event.center
	var hero_local: Vector3 = game.rig.global_position - center
	var hero_damage: float = Meteor.damage_at(event, hero_local)
	if game.adventure.zone == ZONE and hero_damage > 0.0: game.adventure.take_damage(hero_damage, "Starfall")
	for enemy in game.scene.enemies:
		if not is_instance_valid(enemy) or not bool(enemy.get_meta("alive", false)): continue
		if str(enemy.get_meta("zone", "")) != ZONE: continue
		var damage: float = Meteor.damage_at(event, enemy.global_position - center)
		if damage > 0.0: game.adventure.hurt_enemy(enemy, damage, null, (enemy.global_position - impact).normalized() * 4.0)
	_changed("Starfall struck. Mine its core with a pick for star-gems and iron.")


func _meteor_inventory(record: Dictionary, id: String) -> void:
	for i in data.meteors.size():
		if str(data.meteors[i].get("id", "")) == id:
			record.phase = "landed"
			data.meteors[i] = record
			break
	meteor_refresh_remaining = 0.0


func mine_meteor(target: Node3D, point: Vector3, tool_id: String, speed: float, normal: Vector3 = Vector3.ZERO) -> bool:
	var meteor: Node = target.get_parent()
	if meteor == null or not meteor_nodes.values().has(meteor): return false
	var reward: Dictionary = meteor.strike(point, tool_id, maxf(0.0, speed) * 0.45, normal)
	if not bool(reward.get("ok", false)):
		if str(reward.get("reason", "")) == "pick_required": game._notice("A mining pick can break the star-metal.", 2)
		return false
	if str(reward.kind) == "meteor_gem":
		data.star_gems = mini(200, int(data.star_gems) + 1)
		_changed("A star-gem came free. Two gems can focus a Crystal Fault spell.")
	else:
		data.star_iron = mini(200, int(data.star_iron) + 1)
		_changed("Star iron recovered. Two pieces can raise an earthen wall.")
	return true


func cast_prism_fault(a: Vector3, b: Vector3) -> String:
	if not _inside(a) or not _inside(b): return "Draw the crystal fault within the Orchard."
	var distance := Vector2(a.x,a.z).distance_to(Vector2(b.x,b.z))
	if distance < 7.0 or distance > 65.0: return "Draw a crystal fault between 7 and 65 metres."
	if int(data.star_gems) < 2: return "Mine two star gems from a meteorite first."
	if float(data.mana) < 2.0: return "Need 2 Mana to awaken those gems."
	var ready := spells.begin("fault", self)
	if ready != "": return ready
	var op := {"type":"ridge", "points":[_pack(a),_pack(b)], "width":8.0, "height":4.6,
		"feature":"crystal_fault", "seed":int(game.landscape.seed) + int(data.revision) * 37}
	var result: String = game.landscape.apply_magic(op)
	if result != "": return result
	data.star_gems = int(data.star_gems) - 2
	data.mana = float(data.mana) - 2.0
	spells.success("fault", self)
	_changed("Your mined gems raised a lasting, luminous crystal fault.")
	return ""

func cast_forest(a: Vector3, b: Vector3) -> String:
	if not _inside(a) or not _inside(b): return "Draw within the Orchard boundary."
	var distance := Vector2(a.x, a.z).distance_to(Vector2(b.x, b.z))
	if distance < 6.0 or distance > 100.0: return "Draw a grove between 6 and 100 metres long."
	if float(data.mana) < 3.0: return "Need 3 Mana to grow a forest."
	var ready := spells.begin("forest", self)
	if ready != "": return ready
	if data.forest_spells.size() >= MAX_FOREST_SPELLS: return "The grove ledger is full."
	var region := {"type":"line", "points":[_pack(a), _pack(b)], "width":11.0}
	var spell_seed: int = int(game.landscape.seed) + int(data.revision) * 101 + 7501
	var trees: Array[Dictionary] = Ecology.grow(game.landscape.model, region, spell_seed)
	if trees.is_empty(): return "Trees cannot take root on that slope or in water."
	data.forest_spells.append({"region":region, "seed":spell_seed, "placements":_pack_forest(trees)})
	var roots: Array[Vector3] = _render_forest(trees, true, a, b)
	if not roots.is_empty():
		var payload: Dictionary = _forest_visual_payload(a, b, roots, spell_seed, data.forest_spells.size())
		forest_visual_event.emit(payload.duplicate(false))
		active_forest_visuals.append({"payload": payload, "elapsed": 0.0})
	data.mana = float(data.mana) - 3.0
	spells.success("forest", self)
	_changed("A living forest has taken root where you drew it.")
	return ""

func _pack_forest(trees: Array[Dictionary]) -> Array:
	var placements: Array = []
	for record in trees:
		if placements.size() >= 30: break
		var at: Vector3 = record.position
		var species: int = ["oak", "birch", "pine", "apple"].find(str(record.species))
		placements.append([snappedf(at.x, 0.01), snappedf(at.z, 0.01), species, snappedf(float(record.scale), 0.001), snappedf(float(record.rotation), 0.001)])
	return placements

func _unpack_forest(placements: Array) -> Array[Dictionary]:
	var trees: Array[Dictionary] = []
	for value in placements:
		var at := Vector2(float(value[0]), float(value[1]))
		trees.append({"position": Vector3(at.x, game.landscape.height_at(at), at.y), "species": ["oak", "birch", "pine", "apple"][int(value[2])], "scale":float(value[3]), "rotation":float(value[4])})
	return trees

func _render_forest(trees: Array[Dictionary], animate: bool, from: Vector3 = Vector3.ZERO, to: Vector3 = Vector3.ZERO) -> Array[Vector3]:
	var roots: Array[Vector3] = []
	var index := 0
	for record in trees:
		if index >= 30: break
		index += 1
		var at: Vector3 = record.position
		var key := _key(at)
		if resource_by_key.has(key): continue
		roots.append(center + at)
		var timber: Node3D = W.resource(game.adventure.zone_groups[ZONE], game.scene, ZONE, center + at, "lumber", "axe", 2)
		W.tree(timber, Vector3.ZERO, 4.4 * float(record.scale), str(record.species) == "pine", str(record.species) == "apple")
		timber.rotation.y = float(record.rotation)
		timber.set_meta("landscape_growth", true)
		if animate:
			timber.scale = Vector3.ONE * 0.05
			var growth: Dictionary = {"node": timber, "elapsed": 0.0}
			if from != to:
				var segment := Vector2(to.x - from.x, to.z - from.z)
				var along := clampf(Vector2(at.x - from.x, at.z - from.z).dot(segment) / segment.length_squared(), 0.0, 1.0)
				growth.start = along * 0.4
			growing_trees.append(growth)
		resource_by_key[key] = timber
		if key in data.harvested:
			timber.visible = false
			game._set_collisions(timber, false)
	return roots

func _forest_visual_payload(a: Vector3, b: Vector3, roots: Array[Vector3], spell_seed: int, spell_index: int) -> Dictionary:
	var world_path: Array[Vector3] = [center + Vector3(a.x, game.landscape.height_at(Vector2(a.x, a.z)), a.z),
		center + Vector3(b.x, game.landscape.height_at(Vector2(b.x, b.z)), b.z)]
	return {"schema": 1, "operation_id": "forest-%d" % spell_index, "operation_type": "grow_forest",
		"phase": "started", "progress": 0.0, "eased_progress": 0.0, "direction": "forward",
		"visual_seed": spell_seed, "world_path": world_path, "tree_positions": roots,
		"terrain_samples": [], "duration_seconds": 2.4,
		"quality_budget": {"max_live_debris": 36, "max_dust_particles": 160,
			"max_temporary_lights": 2, "max_effect_seconds": 4.0}}

func _forest_visual_phase(started: Dictionary, phase: String, progress: float) -> Dictionary:
	var payload: Dictionary = started.duplicate(false)
	payload.phase = phase
	payload.progress = clampf(progress, 0.0, 1.0)
	payload.eased_progress = payload.progress * payload.progress * (3.0 - 2.0 * payload.progress)
	return payload

func mark_harvest(local: Vector3) -> String:
	if not _inside(local): return "Outside the orchard boundary."
	var selected := ""
	var best := 5.0
	for key in resource_by_key:
		if key in data.harvested or key in data.marked or _ent_live(str(key)): continue
		var tree: Node3D = resource_by_key[key]
		if not is_instance_valid(tree) or not tree.visible: continue
		var distance := tree.global_position.distance_to(center + local)
		if distance < best: selected = key; best = distance
	for key in scenic_by_key:
		if key in data.harvested or key in data.marked or _ent_live(str(key)): continue
		if scenic_pending.has(key): continue
		var record: Dictionary = scenic_by_key[key]
		if not is_instance_valid(record.collision) or record.collision.disabled: continue
		var distance: float = local.distance_to(record.position)
		if distance < best: selected = key; best = distance
	if selected == "": return "Point near a standing timber tree."
	data.marked.append(selected)
	jobs.append({"key": selected, "assigned": false, "progress": 0.0})
	_changed("A lumberjack is heading for the marked tree.")
	return ""

func _ent_live(key: String) -> bool:
	for record in data.get("ents", []):
		if str(record.get("key", "")) == key and str(record.get("state", "")) in ["active", "calm"]: return true
	return false

func _cancel_tree_job(key: String) -> void:
	data.marked.erase(key)
	for i in range(jobs.size() - 1, -1, -1):
		if str(jobs[i].key) == key: jobs.remove_at(i)
	for worker in worker_nodes:
		if str(worker.get_meta("job", "")) == key: worker.set_meta("job", "")

func chop_scenic(global_hit: Vector3, blade: bool, normal: Vector3 = Vector3.RIGHT, hand = null) -> bool:
	if not blade: return false
	var local: Vector3 = global_hit - center
	var nearest := ""
	var best := 1.1
	for key in scenic_by_key:
		if key in data.harvested or _ent_live(str(key)): continue
		var point: Vector3 = scenic_by_key[key].position
		var distance := Vector2(local.x - point.x, local.z - point.z).length()
		if distance < best: best = distance; nearest = key
	if nearest == "": return false
	var collision: CollisionShape3D = scenic_by_key[nearest].collision
	var trunk_height: float = collision.shape.height if collision.shape is CylinderShape3D else 2.5
	var hit_height: float = global_hit.y - (collision.global_position.y - trunk_height * 0.5)
	if hit_height < 0.25 or hit_height > 1.8: return false
	var timber: Node3D = scenic_pending.get(nearest, null)
	if not is_instance_valid(timber): timber = _reveal_scenic(nearest)
	if not is_instance_valid(timber): return false
	return game.melee.chop(timber, global_hit, normal, hand)

func _reveal_scenic(key: String) -> Node3D:
	if key in data.harvested or not scenic_by_key.has(key): return null
	var record: Dictionary = scenic_by_key[key]
	var collision: CollisionShape3D = record.collision
	if not is_instance_valid(collision): return null
	var trunk_height: float = collision.shape.height if collision.shape is CylinderShape3D else 2.5
	var base: Vector3 = collision.global_position - Vector3.UP * trunk_height * 0.5
	var resource := Node3D.new()
	resource.name = "ScenicTimber_" + key.replace(":", "_")
	game.adventure.zone_groups[ZONE].add_child(resource)
	resource.global_position = base
	resource.rotation.y = float(collision.get_meta("builder_rotation", 0.0))
	resource.set_meta("kind", "resource")
	resource.set_meta("requires", "axe")
	resource.set_meta("resource", "lumber")
	resource.set_meta("amount", 1)
	resource.set_meta("scenic_builder_key", key)
	var species := str(collision.get_meta("builder_species", "apple"))
	var scale: float = float(collision.get_meta("builder_scale", 1.0))
	var seed: int = int(collision.get_meta("builder_seed", abs(hash(key)) % 100000))
	var tree_info: Dictionary = TreeKit.adapt_timber(resource, species, seed, {"height": 5.0 * scale})
	resource.set_meta("trunk", tree_info.trunk)
	resource.set_meta("trunk_mesh", tree_info.trunk.mesh)
	resource.set_meta("trunk_material", tree_info.trunk.material_override)
	scenic_pending[key] = resource
	_hide_scenic(record.position)
	# The Hero now owns this tree's fall. A queued worker must not harvest the
	# same scenic key while the physical log is still waiting for a grab.
	data.marked.erase(key)
	for i in range(jobs.size() - 1, -1, -1):
		if str(jobs[i].key) == key: jobs.remove_at(i)
	for worker in worker_nodes:
		if str(worker.get_meta("job", "")) == key: worker.set_meta("job", "")
	return resource

func claim_scenic_log(resource: Node3D) -> bool:
	var key := str(resource.get_meta("scenic_builder_key", ""))
	if key == "" or not scenic_by_key.has(key): return false
	if key in data.harvested: return true # Retry cannot award settlement wood twice.
	if scenic_pending.get(key, null) != resource or not resource.get_meta("felled", false): return false
	data.harvested.append(key)
	data.scenic_cut_heights[key] = float(resource.get_meta("cut_height", 1.0))
	data.marked.erase(key)
	for i in range(jobs.size() - 1, -1, -1):
		if str(jobs[i].key) == key: jobs.remove_at(i)
	for worker in worker_nodes:
		if str(worker.get_meta("job", "")) == key: worker.set_meta("job", "")
	data.wood = mini(200, int(data.wood) + 1)
	scenic_pending.erase(key)
	_changed("The Hero collected a fallen log. The settlement gained 1 lumber.")
	return true

func plant_grove(local: Vector3) -> String:
	if not _inside(local) or local.distance_to(CAMP) < 7.0: return "Choose a clearing away from camp."
	if data.groves.size() >= MAX_GROVES: return "The grove ledger is full."
	if float(data.mana) < 3.0: return "Need 3 Mana to grow a grove."
	var ready := spells.begin("grove", self)
	if ready != "": return ready
	for value in data.groves:
		if _unpack(value).distance_to(local) < 9.0: return "Leave more room between groves."
	data.mana = float(data.mana) - 3.0
	spells.success("grove", self)
	data.groves.append(_pack(local))
	_render_grove(local, true)
	_changed("New trees have taken root. Their timber can support future work.")
	return ""

func place_bridge(local: Vector3) -> String:
	if local.distance_to(CROSSING) > 10.0: return "Place the crossing at the marked brook site."
	if data.bridges.size() >= MAX_BRIDGES or not data.bridges.is_empty(): return "This brook already has a bridge."
	if int(data.wood) < 3: return "Need 3 lumber in the settlement stockpile."
	var ready := spells.begin("bridge", self)
	if ready != "": return ready
	data.wood = int(data.wood) - 3
	spells.success("bridge", self)
	data.bridges.append(_pack(CROSSING))
	_render_bridge(CROSSING)
	_changed("The bridge is built. Follow the new crossing in first person.")
	return ""

func hire_worker() -> String:
	if int(data.workers) >= 5: return "Five helpers is enough for this work site."
	if int(data.wood) < 2: return "Need 2 lumber to equip another helper."
	data.wood = int(data.wood) - 2
	data.workers = int(data.workers) + 1
	_ensure_workers()
	_changed("A new helper joins the work site.")
	return ""

func summon_patrol(local: Vector3) -> String:
	if not _inside(local): return "Outside the orchard boundary."
	if data.threats.size() >= MAX_THREATS: return "Too many patrols are active in the orchard."
	if float(data.mana) < 4.0: return "Need 4 Mana to call a skeleton patrol."
	var ready := spells.begin("patrol", self)
	if ready != "": return ready
	var hero_local: Vector3 = game.camera.global_position - center
	if local.distance_to(Vector3(hero_local.x, 0, hero_local.z)) < 7.0: return "Give the Hero at least seven metres of warning."
	data.mana = float(data.mana) - 4.0
	spells.success("patrol", self)
	var threat := {"id": int(data.revision) + 1, "at": _pack(local), "state": "warning", "delay": 1.7, "alive": [0, 1, 2]}
	encounters.prepare(threat)
	data.threats.append(threat)
	_changed("A violet warning marks where three skeletons will rise. " + encounters.brief(threat))
	return ""

func _sync_threats(delta: float) -> void:
	if game.animation == null: return
	for threat in data.threats.duplicate():
		var id := str(int(threat.id))
		if str(threat.state) == "warning":
			if not warning_nodes.has(id):
				var warning := Node3D.new()
				warning.name = "SkeletonPatrolWarning_" + id
				warning.position = _unpack(threat.at)
				root.add_child(warning)
				W.cyl(warning, Vector3(0, 0.10, 0), 1.3, 0.12, "9869b7", "disc", 0.7)
				W.label(warning, "BONES ARE STIRRING", Vector3(0, 1.7, 0), 18, "edc8ff")
				warning_nodes[id] = warning
			threat.delay = maxf(0.0, float(threat.get("delay", 1.7)) - delta)
			if float(threat.delay) > 0.0: continue
			if warning_nodes.has(id):
				warning_nodes[id].queue_free()
				warning_nodes.erase(id)
			threat.state = "active"
			_spawn_threat(threat)
			_changed("Three skeletons rise in the live orchard. The Hero can fight them.")
			continue
		if not summoned_nodes.has(id): _spawn_threat(threat)
		encounters.tick_threat(threat, delta)
		var units: Array = summoned_nodes.get(id, [])
		var changed := false
		for unit in units:
			if int(unit.slot) not in threat.alive: continue
			if not is_instance_valid(unit.node) or not bool(unit.node.get_meta("alive", true)):
				encounters.unit_down(threat, int(unit.slot), unit.node)
				threat.alive.erase(int(unit.slot))
				changed = true
		if threat.alive.is_empty():
			var reward: Dictionary = encounters.complete(threat)
			data.threats.erase(threat)
			summoned_nodes.erase(id)
			_changed(str(reward.message))
			continue
		if changed:
			data.revision = int(data.revision) + 1
			print("WORLD_BUILDER patrol defeated id=", id, " remaining=", data.threats.size())
			save()

func _spawn_threat(threat: Dictionary) -> void:
	var id := str(int(threat.id))
	if summoned_nodes.has(id): return
	var units: Array = []
	var at: Vector3 = _unpack(threat.at)
	for slot in threat.alive:
		var position := center + at + Vector3((float(slot) - 1.0) * 1.4, 0, 0)
		W.enemy(game, game.scene, ZONE, position, "skeleton", "mossward")
		var enemy: Node3D = game.scene.enemies.back()
		enemy.set_meta("alive", true)
		enemy.set_meta("home", position)
		enemy.set_meta("hp", 56)
		enemy.set_meta("max_hp", 56)
		enemy.set_meta("damage", 11)
		enemy.set_meta("world_builder_patrol", id)
		enemy.set_meta("id", "orchard-patrol-%s-%d" % [id, int(slot)])
		enemy.reparent(game.adventure.zone_groups[ZONE])
		game.animation.register(enemy)
		game.guardians.attach(enemy, "mossward")
		game.guardian_authored.attach(enemy, "mossward")
		units.append({"slot": int(slot), "node": enemy})
	summoned_nodes[id] = units

func _changed(message: String) -> void:
	data.revision = int(data.revision) + 1
	progress_message = message
	progress_until = game.elapsed + 6.0
	print("WORLD_BUILDER revision=", data.revision, " wood=", data.wood, " Mana=", snappedf(float(data.mana), 0.1), " paths=", data.paths.size(), " marked=", data.marked.size(), " :: ", message)
	save()

func _rebuild_saved() -> void:
	for key in data.harvested:
		if resource_by_key.has(str(key)):
			var tree: Node3D = resource_by_key[str(key)]
			tree.visible = false
			game._set_collisions(tree, false)
			W.cyl(root, tree.global_position - center + Vector3(0, 0.14, 0), 0.37, 0.28, "9a754e")
		elif scenic_by_key.has(str(key)):
			var point: Vector3 = scenic_by_key[str(key)].position
			_hide_scenic(point)
			_restore_scenic_stump(str(key), float(data.scenic_cut_heights.get(str(key), 1.0)))
	for value in data.groves: _render_grove(_unpack(value))
	for entry in data.forest_spells:
		_render_forest(_unpack_forest(entry.placements) if entry.has("placements") else Ecology.grow(game.landscape.model, entry.region, int(entry.seed)), false)
	_refresh_meteor_visibility()
	for segment in data.paths:
		var a := _unpack(segment.a)
		var b := _unpack(segment.b)
		_render_path(a, b)
		_clear_grove_collision(a, b)
	for value in data.bridges: _render_bridge(_unpack(value))
	_jobs_from_marked()

func _build_brook() -> void:
	# The shared hydrology field carves the bed and owns the flowing water ribbon.
	# This sign remains an authored gameplay cue at the stable crossing control.
	var y: float = game.landscape.height_at(Vector2(CROSSING.x, CROSSING.z))
	W.label(root, "THE BROOK CROSSING\n3 lumber · build from the map", CROSSING + Vector3(0, y + 2.25, -3.2), 20, "fff0c8")

func _build_camp() -> void:
	var camp := Node3D.new()
	camp.name = "LumberjackCamp"
	camp.position = CAMP + Vector3.UP * game.landscape.height_at(Vector2(CAMP.x, CAMP.z))
	root.add_child(camp)
	if ResourceLoader.exists(STOCKPILE):
		var site: PackedScene = load(STOCKPILE)
		camp.add_child(site.instantiate())
		# The authored pad stays walkable; only the rack, block and planks collide.
		W.body(camp, Vector3(0, 0.42, -0.45), Vector3(2.0, 0.84, 0.80), "solid")
		W.body(camp, Vector3(-0.72, 0.25, 0.34), Vector3(0.48, 0.50, 0.48), "solid")
		W.body(camp, Vector3(0.60, 0.18, 0.34), Vector3(1.0, 0.36, 0.58), "solid")
	else:
		W.box(camp, Vector3(0, 0.16, 0), Vector3(5.0, 0.3, 3.6), "8f6948")
		W.body(camp, Vector3(0, 0.16, 0), Vector3(5.0, 0.3, 3.6), "solid")
	W.label(camp, "WINDFALL WORK SITE", Vector3(0, 2.65, 1.2), 20, "ffe6b4")

func _render_path(a: Vector3, b: Vector3) -> void:
	var direction := (b - a).normalized()
	var across := Vector3(-direction.z, 0, direction.x)
	# orchard_ground.add_path/sync_paths paints this route on the live terrain.
	# Keep the entrance marker; a one-time mesh strip cannot follow later spells.
	# A sign at the route entrance makes a carved route legible on foot.
	if rendered_markers < MAX_WAYMARKERS and ResourceLoader.exists(WAYMARKER):
		var marker: PackedScene = load(WAYMARKER)
		var post := Node3D.new()
		post.name = "RouteWaymarker"
		post.position = a + across * 2.1
		post.position.y = game.landscape.height_at(Vector2(post.position.x, post.position.z))
		post.rotation.y = atan2(direction.z, direction.x)
		post.add_child(marker.instantiate())
		root.add_child(post)
		W.body(post, Vector3(0, 0.75, 0), Vector3(0.2, 1.5, 0.2), "solid")
		rendered_markers += 1

func _hide_scenic(point: Vector3) -> void:
	var key := _key(point)
	if scenic_by_key.has(key):
		var collision: CollisionShape3D = scenic_by_key[key].collision
		if is_instance_valid(collision): collision.set_deferred("disabled", true)
	for entry in scenic_instance_by_key.get(key, []):
		var holder: MultiMeshInstance3D = entry.holder
		if is_instance_valid(holder): holder.multimesh.set_instance_transform(int(entry.index), Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.001), Vector3(0, -200, 0)))

func _restore_scenic_stump(key: String, height: float) -> void:
	if not scenic_by_key.has(key): return
	var collision: CollisionShape3D = scenic_by_key[key].collision
	if not is_instance_valid(collision): return
	var trunk_height: float = collision.shape.height if collision.shape is CylinderShape3D else 2.5
	var temporary := Node3D.new()
	root.add_child(temporary)
	temporary.global_position = collision.global_position - Vector3.UP * trunk_height * 0.5
	temporary.rotation.y = float(collision.get_meta("builder_rotation", 0.0))
	var species := str(collision.get_meta("builder_species", "apple"))
	var seed: int = int(collision.get_meta("builder_seed", abs(hash(key)) % 100000))
	var scale: float = float(collision.get_meta("builder_scale", 1.0))
	var tree_info: Dictionary = TreeKit.adapt_timber(temporary, species, seed, {"height": 5.0 * scale})
	temporary.set_meta("trunk", tree_info.trunk)
	var permanent := TreeFelling.new()
	root.add_child(permanent)
	permanent.restore_stump(temporary, height)
	temporary.queue_free()

func _clear_grove_collision(a: Vector3, b: Vector3) -> void:
	# The authored canopy is instanced; clearing one placement removes its visible
	# instances and its exact trunk proxy without rebuilding the 320 m orchard.
	var orchard_root: Node3D = game.scene.zones[ZONE].root
	preload("res://orchard_dressing.gd").clear_path(orchard_root, a, b)
	var trunk_group: Node3D = orchard_root.get_node_or_null("OrchardGroveTrunks")
	if trunk_group == null: return
	var span := b - a
	for child in trunk_group.get_children():
		if not child is CollisionShape3D or child.disabled: continue
		var point: Vector3 = child.position
		var t := clampf((point - a).dot(span) / maxf(span.length_squared(), 0.001), 0.0, 1.0)
		if point.distance_to(a + span * t) < 2.25:
			child.set_deferred("disabled", true)
	for holder in orchard_root.find_children("*", "MultiMeshInstance3D", true, false):
		if not holder.has_meta("builder_positions"): continue
		var positions: Array = holder.get_meta("builder_positions")
		for i in range(positions.size()):
			var point: Vector3 = positions[i]
			var t := clampf((point - a).dot(span) / maxf(span.length_squared(), 0.001), 0.0, 1.0)
			if point.distance_to(a + span * t) < 2.25:
				holder.multimesh.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.001), Vector3(0, -200, 0)))

func _render_grove(local: Vector3, animate := false) -> void:
	var grove := Node3D.new()
	grove.name = "GrownGrove_%02d" % data.groves.size()
	grove.position = local + Vector3.UP * game.landscape.height_at(Vector2(local.x, local.z))
	root.add_child(grove)
	for i in range(3):
		var a := float(i) * TAU / 3.0 + 0.2
		var pos := Vector3(cos(a) * 2.5, 0, sin(a) * 2.5)
		var place := local + pos
		place.y = game.landscape.height_at(Vector2(place.x, place.z))
		var timber: Node3D = W.resource(game.adventure.zone_groups[ZONE], game.scene, ZONE, center + place, "lumber", "axe", 2)
		W.tree(timber, Vector3.ZERO, 4.5, i == 2, i != 2)
		if animate:
			timber.scale = Vector3.ONE * 0.08
			growing_trees.append({"node": timber, "elapsed": 0.0})
		resource_by_key[_key(timber.global_position - center)] = timber
		if _key(timber.global_position - center) in data.harvested:
			timber.visible = false
			game._set_collisions(timber, false)
	W.rock(grove, Vector3(0, 0.12, 0), Vector3(0.65, 0.25, 0.60), "a1a895")

func _render_bridge(local: Vector3) -> void:
	var crossing := Node3D.new()
	crossing.name = "BuiltOrchardBridge"
	var bridge_plan: Dictionary = preload("res://landscape_water.gd").crossing(game.landscape.model, Vector2(local.x, local.z))
	crossing.position = bridge_plan.position
	crossing.rotation.y = atan2(bridge_plan.across.x, bridge_plan.across.y)
	root.add_child(crossing)
	if ResourceLoader.exists(BRIDGE):
		var scene: PackedScene = load(BRIDGE)
		if scene != null:
			var model := scene.instantiate()
			crossing.add_child(model)
			# Opus asset's deck long axis is local +Z, matching the brook crossing.
			var imported_walkway := false
			for body in model.find_children("*", "StaticBody3D", true, false):
				var is_deck := "walkway" in body.name.to_lower()
				body.set_meta("kind", "floor" if is_deck else "solid")
				imported_walkway = imported_walkway or is_deck
			# Godot versions can differ in how they import -colonly nodes.
			if not imported_walkway: W.body(crossing, Vector3(0, 0.08, 0), Vector3(3.6, 0.18, 5.0), "floor")
			return
	W.box(crossing, Vector3.ZERO, Vector3(3.6, 0.20, 6.0), "9c7650")
	W.body(crossing, Vector3.ZERO, Vector3(3.6, 0.20, 6.0), "floor")

func _jobs_from_marked() -> void:
	jobs.clear()
	for key in data.marked:
		if (resource_by_key.has(str(key)) or scenic_by_key.has(str(key))) and not str(key) in data.harvested and not _ent_live(str(key)):
			jobs.append({"key": str(key), "assigned": false, "progress": 0.0})

func _ensure_workers() -> void:
	while worker_nodes.size() < int(data.workers):
		var index := worker_nodes.size()
		var worker := Node3D.new()
		worker.name = "Lumberjack_%02d" % index
		worker.position = CAMP + Vector3(-1.5 + float(index) * 0.75, 0, 1.4)
		worker.position.y = game.landscape.height_at(Vector2(worker.position.x, worker.position.z))
		root.add_child(worker)
		worker.set_meta("job", "")
		worker.set_meta("chop", 0.0)
		worker.set_meta("carry_amount", 0)
		var empty_route: Array[Vector2] = []
		worker.set_meta("nav_path", empty_route)
		worker.set_meta("nav_target", Vector2(INF, INF))
		worker.set_meta("nav_index", 0)
		worker.set_meta("nav_op_count", -1)
		worker.set_meta("nav_transitioning", false)
		worker.set_meta("nav_initialized", false)
		worker.set_meta("nav_bridge_available", false)
		worker.set_meta("nav_construction_count", -1)
		if ResourceLoader.exists(WORKER):
			var scene: PackedScene = load(WORKER)
			if scene != null:
				var model := scene.instantiate()
				worker.add_child(model)
				var players := model.find_children("*", "AnimationPlayer", true, false)
				if not players.is_empty():
					worker.set_meta("animator", players[0])
					for clip in ["Worker_Idle", "Worker_Walk", "Worker_Chop"]:
						var animation: Animation = players[0].get_animation(clip)
						if animation != null: animation.loop_mode = Animation.LOOP_LINEAR
					_set_worker_animation(worker, "Worker_Idle")
		else:
			W.cyl(worker, Vector3(0, 0.54, 0), 0.22, 1.05, "6d85a1", "taper")
			W.rock(worker, Vector3(0, 1.17, 0), Vector3(0.48, 0.48, 0.48), "e0b77e")
			W.box(worker, Vector3(0.33, 0.52, 0), Vector3(0.12, 0.65, 0.12), "b58a5d")
		worker_nodes.append(worker)
		for pending in data.carried:
			if int(pending.worker) != index: continue
			var key: String = str(pending.key)
			worker.set_meta("carry_key", key)
			worker.set_meta("carry_amount", int(pending.amount))
			if resource_by_key.has(key): worker.position = resource_by_key[key].global_position - center
			elif scenic_by_key.has(key): worker.position = scenic_by_key[key].position
			worker.position.y = _worker_surface_height(worker, Vector2(worker.position.x, worker.position.z))
			_add_carried_log(worker)
			break

func _add_carried_log(worker: Node3D) -> void:
	if worker.get_node_or_null("CarryLog") != null: return
	var log := W.cyl(worker, Vector3(0.34, 1.14, 0.08), 0.11, 0.76, "a97b4d")
	log.name = "CarryLog"
	log.rotation.z = PI * 0.5

func _set_worker_animation(worker: Node3D, clip: String) -> void:
	var player: AnimationPlayer = worker.get_meta("animator", null)
	if player == null or not is_instance_valid(player): return
	var actual := clip
	if not player.has_animation(actual):
		for name in player.get_animation_list():
			if str(name).ends_with(clip): actual = str(name); break
	if not player.has_animation(actual) or str(worker.get_meta("clip", "")) == actual: return
	if clip != "Worker_Walk": player.speed_scale = 1.0
	player.play(actual, 0.16)
	worker.set_meta("clip", actual)

func _animate_worker_travel(worker: Node3D, distance: float, delta: float) -> void:
	if distance <= 0.001 or delta <= 0.0:
		_set_worker_animation(worker, "Worker_Idle")
		return
	_set_worker_animation(worker, "Worker_Walk")
	var player: AnimationPlayer = worker.get_meta("animator", null)
	if player != null and is_instance_valid(player):
		# The authored walk cycle is one second long at the normal 2.1 m/s pace.
		# Match its cadence to the displacement actually achieved this frame.
		player.speed_scale = clampf(distance / delta / WORKER_WALK_SPEED, 0.25, 1.5)

func _for_each_worker(delta: float) -> void:
	for worker in worker_nodes:
		if not is_instance_valid(worker): continue
		if int(worker.get_meta("carry_amount", 0)) > 0:
			var destination := CAMP + Vector3(0.0, 0, 1.4)
			if not _worker_travel(worker, destination, delta, WORKER_WALK_SPEED, 0.55): continue
			var delivered: int = int(worker.get_meta("carry_amount", 0))
			var delivered_key: String = str(worker.get_meta("carry_key", ""))
			worker.set_meta("carry_amount", 0)
			worker.set_meta("carry_key", "")
			var log: Node3D = worker.get_node_or_null("CarryLog")
			if log != null: log.queue_free()
			for i in range(data.carried.size() - 1, -1, -1):
				if str(data.carried[i].key) == delivered_key: data.carried.remove_at(i)
			data.wood = mini(200, int(data.wood) + delivered)
			_changed("Timber arrived at the work site. Build or hire with it.")
			continue
		var key := str(worker.get_meta("job", ""))
		if key == "":
			for job in jobs:
				if not bool(job.assigned):
					job.assigned = true
					key = str(job.key)
					worker.set_meta("job", key)
					break
		if key == "":
			_worker_travel(worker, CAMP + Vector3(0, 0, 1.4), delta, 1.4, 0.55)
			continue
		if not resource_by_key.has(key) and not scenic_by_key.has(key): worker.set_meta("job", ""); continue
		if key in data.harvested: worker.set_meta("job", ""); continue
		if _ent_live(key): _cancel_tree_job(key); continue
		if scenic_pending.has(key): worker.set_meta("job", ""); continue
		var target: Node3D = resource_by_key.get(key, null)
		if target != null and not is_instance_valid(target): worker.set_meta("job", ""); continue
		var target_position: Vector3 = target.global_position - center if target != null else scenic_by_key[key].position
		var place: Vector3 = target_position + Vector3(1.0, 0, 0)
		if not _worker_travel(worker, place, delta, WORKER_WALK_SPEED, 1.2):
			continue
		_set_worker_animation(worker, "Worker_Chop")
		var chop := float(worker.get_meta("chop", 0.0)) + delta
		worker.set_meta("chop", chop)
		if chop < 3.5: continue
		worker.set_meta("chop", 0.0)
		worker.set_meta("job", "")
		if target != null:
			target.visible = false
			game._set_collisions(target, false)
		else: _hide_scenic(target_position)
		data.harvested.append(key)
		data.marked.erase(key)
		var yield_amount: int = clampi(int(target.get_meta("amount", 2)), 1, 5) if target != null else 1
		worker.set_meta("carry_key", key)
		worker.set_meta("carry_amount", yield_amount)
		data.carried.append({"key": key, "worker": worker_nodes.find(worker), "amount": yield_amount})
		_add_carried_log(worker)
		W.cyl(root, target_position + Vector3(0, 0.14, 0), 0.37, 0.28, "9a754e")
		for i in range(jobs.size() - 1, -1, -1):
			if str(jobs[i].key) == key: jobs.remove_at(i)
		_changed("The tree is felled. Your helper is carrying its timber home.")

func _worker_travel(worker: Node3D, destination: Vector3, delta: float, speed: float, stop_radius: float) -> bool:
	var here := Vector2(worker.position.x, worker.position.z)
	var goal := Vector2(destination.x, destination.z)
	if here.distance_to(goal) <= stop_radius:
		worker.position.y = _worker_surface_height(worker, here)
		_animate_worker_travel(worker, 0.0, delta)
		return true
	var model: Dictionary = game.landscape.model
	var op_count: int = game.landscape.operation_count()
	var transitioning: bool = not game.landscape.transition.is_empty()
	var path: Array[Vector2] = worker.get_meta("nav_path")
	var old_goal: Vector2 = worker.get_meta("nav_target")
	var bridge_available: bool = not data.bridges.is_empty() or not data.constructions.is_empty()
	var path_index: int = int(worker.get_meta("nav_index", 0))
	var off_route: bool = not path.is_empty() and path_index < path.size() and here.distance_to(path[path_index]) > 10.0
	if not bool(worker.get_meta("nav_initialized", false)) or old_goal.distance_to(goal) > 0.5 or int(worker.get_meta("nav_op_count", -1)) != op_count or bool(worker.get_meta("nav_transitioning", false)) != transitioning or bool(worker.get_meta("nav_bridge_available", false)) != bridge_available or int(worker.get_meta("nav_construction_count", -1)) != data.constructions.size() or off_route:
		var options := {"allow_bridge": not data.bridges.is_empty()}
		if construction != null: options.merge(construction.navigation_options(), true)
		path = Navigation.route(model, here, goal, options)
		worker.set_meta("nav_path", path)
		worker.set_meta("nav_target", goal)
		worker.set_meta("nav_index", 0)
		worker.set_meta("nav_op_count", op_count)
		worker.set_meta("nav_transitioning", transitioning)
		worker.set_meta("nav_bridge_available", bridge_available)
		worker.set_meta("nav_construction_count", data.constructions.size())
		worker.set_meta("nav_initialized", true)
		worker.set_meta("nav_bridge", Water.crossing(model) if not data.bridges.is_empty() else {})
	if path.is_empty():
		worker.position.y = _worker_surface_height(worker, here)
		_animate_worker_travel(worker, 0.0, delta)
		return false
	var index: int = int(worker.get_meta("nav_index", 0))
	while index < path.size() - 1 and here.distance_to(path[index]) < 0.4:
		index += 1
	worker.set_meta("nav_index", index)
	var waypoint: Vector2 = path[index]
	var heading: Vector2 = waypoint - here
	if heading.length() < 0.01:
		_animate_worker_travel(worker, 0.0, delta)
		return here.distance_to(goal) <= stop_radius
	var step: float = minf(delta * speed, heading.length())
	var next: Vector2 = here + heading.normalized() * step
	worker.position.x = next.x
	worker.position.z = next.y
	worker.position.y = _worker_surface_height(worker, next)
	worker.rotation.y = atan2(heading.x, heading.y)
	_animate_worker_travel(worker, here.distance_to(next), delta)
	return next.distance_to(goal) <= stop_radius

func _worker_surface_height(worker: Node3D, point: Vector2) -> float:
	var ground: float = game.landscape.height_at(point)
	if construction != null: ground = construction.surface_height(point, ground)
	var bridge: Dictionary = worker.get_meta("nav_bridge", {})
	if bridge.is_empty() or game.landscape.water_at(point) <= 0.45: return ground
	var center_2d := Vector2(bridge.position.x, bridge.position.z)
	var relative: Vector2 = point - center_2d
	if absf(relative.dot(bridge.along)) <= 2.5 and absf(relative.dot(bridge.across)) <= float(bridge.span) * 0.5:
		return maxf(ground, bridge.position.y)
	return ground
