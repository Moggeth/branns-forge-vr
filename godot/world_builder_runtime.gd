extends Node
## Persistent, bounded settlement edits in the same Orchard Highlands visited by the Hero.
## This module owns the world state. The overhead Window is only another controller.
const W = preload("res://world_zones.gd")
const ZONE = "orchard_highlands"
const SAVE = "user://world_builder_v1.json"
const BRIDGE = "res://assets/worldbuilder/orchard_bridge.glb"
const WORKER = "res://assets/worldbuilder/worker.glb"
const STOCKPILE = "res://assets/worldbuilder/stockpile.glb"
const WAYMARKER = "res://assets/worldbuilder/waymarker.glb"
const CAMP = Vector3(15, 0, -27)
const CROSSING = Vector3(25, 0, -48)
const MAX_PATHS = 96
const MAX_WAYMARKERS = 24
const MAX_GROVES = 24
const MAX_BRIDGES = 4
const MAX_THREATS = 8

var game: Node3D
var root: Node3D
var center := Vector3.ZERO
var data: Dictionary = {}
var worker_nodes: Array[Node3D] = []
var jobs: Array[Dictionary] = []
var growing_trees: Array[Dictionary] = []
var rendered_markers := 0
var summoned_nodes: Dictionary = {}
var warning_nodes: Dictionary = {}
var resource_by_key: Dictionary = {}
var scenic_by_key: Dictionary = {}
var scenic_cuts: Dictionary = {}
var test_mode := false
var save_path := SAVE
var save_blocked := false
var autosave_at := 0.0
var progress_message := ""
var progress_until := 0.0

func setup(owner_game: Node3D, offline := false) -> void:
	game = owner_game
	test_mode = offline
	center = game.scene.zones[ZONE].center
	root = Node3D.new()
	root.name = "LivingOrchardSettlement"
	game.adventure.zone_groups[ZONE].add_child(root)
	root.global_position = center
	data = fresh_state()
	_index_timber()
	if not test_mode: _load()
	preload("res://orchard_ground.gd").sync_paths(data.paths)
	_build_brook()
	_build_camp()
	_rebuild_saved()
	_ensure_workers()
	print("WORLD_BUILDER_READY revision=", data.revision, " paths=", data.paths.size(), " groves=", data.groves.size(), " bridges=", data.bridges.size(), " wood=", data.wood)

static func fresh_state() -> Dictionary:
	return {"schema": 1, "revision": 0, "aether": 12.0, "wood": 0, "workers": 1, "paths": [], "groves": [], "bridges": [], "harvested": [], "marked": [], "carried": [], "threats": []}

func _valid(value: Variant) -> bool:
	if not value is Dictionary or int(value.get("schema", 0)) != 1: return false
	for field in ["revision", "wood", "workers"]:
		if not value.get(field) is float and not value.get(field) is int: return false
	if not value.get("aether") is float and not value.get("aether") is int: return false
	if value.get("paths") is not Array or value.paths.size() > MAX_PATHS: return false
	if value.get("groves") is not Array or value.groves.size() > MAX_GROVES: return false
	if value.get("bridges") is not Array or value.bridges.size() > MAX_BRIDGES: return false
	if value.get("harvested") is not Array or value.harvested.size() > 512: return false
	if value.get("marked") is not Array or value.marked.size() > 512: return false
	if value.get("carried", []) is not Array or value.get("carried", []).size() > 5: return false
	if value.get("threats", []) is not Array or value.get("threats", []).size() > MAX_THREATS: return false
	for field in ["harvested", "marked"]:
		for key in value[field]:
			if not key is String or key.length() > 24: return false
	for load in value.get("carried", []):
		if not load is Dictionary or not load.get("key") is String or not load.get("worker") is float and not load.get("worker") is int or not load.get("amount") is float and not load.get("amount") is int: return false
		if int(load.worker) < 0 or int(load.worker) >= 5 or int(load.amount) < 1 or int(load.amount) > 5: return false
	for threat in value.get("threats", []):
		if not threat is Dictionary or not _point_valid(threat.get("at")) or str(threat.get("state", "")) not in ["warning", "active"]: return false
		if not threat.get("alive") is Array or threat.alive.size() > 3: return false
		if not threat.get("id") is float and not threat.get("id") is int: return false
		for slot in threat.alive:
			if int(slot) not in [0, 1, 2]: return false
	if int(value.get("workers", 0)) < 1 or int(value.workers) > 5: return false
	if int(value.get("wood", -1)) < 0 or int(value.wood) > 200: return false
	if not is_finite(float(value.get("aether", -1))) or float(value.aether) < 0 or float(value.aether) > 20: return false
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
	if bytes.size() > 131072: push_warning("WORLD_BUILDER save too large; keeping the world untouched"); save_blocked = true; return
	var candidate: Variant = JSON.parse_string(bytes.get_string_from_utf8())
	if _valid(candidate):
		data = candidate
		if not data.has("carried"): data.carried = []
		if not data.has("threats"): data.threats = []
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
	_sync_threats(delta)
	for i in range(growing_trees.size() - 1, -1, -1):
		var growth: Dictionary = growing_trees[i]
		if not is_instance_valid(growth.node): growing_trees.remove_at(i); continue
		growth.elapsed = float(growth.elapsed) + delta
		var progress := clampf(float(growth.elapsed) / 2.4, 0, 1)
		growth.node.scale = Vector3.ONE * lerpf(0.08, 1.0, smoothstep(0.0, 1.0, progress))
		if progress >= 1.0: growing_trees.remove_at(i)
	if data.aether < 20.0:
		data.aether = minf(20.0, float(data.aether) + delta * 0.055)
		if game.elapsed >= autosave_at:
			autosave_at = game.elapsed + 15.0
			save()
	_for_each_worker(delta)

func _index_timber() -> void:
	resource_by_key.clear()
	scenic_by_key.clear()
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
	if float(data.aether) < cost: return "Need %d aether to carve this route." % cost
	return ""

func carve_path(a: Vector3, b: Vector3) -> String:
	a.y = 0; b.y = 0
	var problem := can_path(a, b)
	if problem != "": return problem
	data.aether = float(data.aether) - ceili(a.distance_to(b) / 7.0)
	data.paths.append({"a": _pack(a), "b": _pack(b)})
	preload("res://orchard_ground.gd").add_path(a,b)
	_render_path(a, b)
	_clear_grove_collision(a, b)
	_changed("A route now crosses the orchard. Walk it in VR or first person.")
	return ""

func mark_harvest(local: Vector3) -> String:
	if not _inside(local): return "Outside the orchard boundary."
	var selected := ""
	var best := 5.0
	for key in resource_by_key:
		if key in data.harvested or key in data.marked: continue
		var tree: Node3D = resource_by_key[key]
		if not is_instance_valid(tree) or not tree.visible: continue
		var distance := tree.global_position.distance_to(center + local)
		if distance < best: selected = key; best = distance
	for key in scenic_by_key:
		if key in data.harvested or key in data.marked: continue
		var record: Dictionary = scenic_by_key[key]
		if not is_instance_valid(record.collision) or record.collision.disabled: continue
		var distance: float = local.distance_to(record.position)
		if distance < best: selected = key; best = distance
	if selected == "": return "Point near a standing timber tree."
	data.marked.append(selected)
	jobs.append({"key": selected, "assigned": false, "progress": 0.0})
	_changed("A lumberjack is heading for the marked tree.")
	return ""

func chop_scenic(global_hit: Vector3, blade: bool) -> bool:
	if not blade: return false
	var local: Vector3 = global_hit - center
	if local.y < 0.25 or local.y > 1.8: return false
	var nearest := ""
	var best := 1.1
	for key in scenic_by_key:
		if key in data.harvested: continue
		var point: Vector3 = scenic_by_key[key].position
		var distance := Vector2(local.x - point.x, local.z - point.z).length()
		if distance < best: best = distance; nearest = key
	if nearest == "": return false
	var cut: Dictionary = scenic_cuts.get(nearest, {"height": local.y, "hits": 0})
	if absf(float(cut.height) - local.y) > 0.20: cut = {"height": local.y, "hits": 0}
	cut.hits = int(cut.hits) + 1
	scenic_cuts[nearest] = cut
	game._effect(global_hit, Color("d5ab72"), 0.28, 0.12)
	if int(cut.hits) < 3:
		game._notice("Orchard cut %d / 3 · strike near the same height." % int(cut.hits), 2)
		return false
	var point: Vector3 = scenic_by_key[nearest].position
	_hide_scenic(point)
	scenic_cuts.erase(nearest)
	data.harvested.append(nearest)
	data.marked.erase(nearest)
	for i in range(jobs.size() - 1, -1, -1):
		if str(jobs[i].key) == nearest: jobs.remove_at(i)
	for worker in worker_nodes:
		if str(worker.get_meta("job", "")) == nearest: worker.set_meta("job", "")
	data.wood = mini(200, int(data.wood) + 1)
	W.cyl(root, point + Vector3(0, 0.14, 0), 0.37, 0.28, "9a754e")
	_changed("The Hero felled a tree. The settlement gained 1 lumber.")
	return true

func plant_grove(local: Vector3) -> String:
	if not _inside(local) or local.distance_to(CAMP) < 7.0: return "Choose a clearing away from camp."
	if data.groves.size() >= MAX_GROVES: return "The grove ledger is full."
	if float(data.aether) < 3.0: return "Need 3 aether to grow a grove."
	for value in data.groves:
		if _unpack(value).distance_to(local) < 9.0: return "Leave more room between groves."
	data.aether = float(data.aether) - 3.0
	data.groves.append(_pack(local))
	_render_grove(local, true)
	_changed("New trees have taken root. Their timber can support future work.")
	return ""

func place_bridge(local: Vector3) -> String:
	if local.distance_to(CROSSING) > 10.0: return "Place the crossing at the marked brook site."
	if data.bridges.size() >= MAX_BRIDGES or not data.bridges.is_empty(): return "This brook already has a bridge."
	if int(data.wood) < 3: return "Need 3 lumber in the settlement stockpile."
	data.wood = int(data.wood) - 3
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
	if float(data.aether) < 4.0: return "Need 4 aether to call a skeleton patrol."
	var hero_local: Vector3 = game.camera.global_position - center
	if local.distance_to(Vector3(hero_local.x, 0, hero_local.z)) < 7.0: return "Give the Hero at least seven metres of warning."
	data.aether = float(data.aether) - 4.0
	data.threats.append({"id": int(data.revision) + 1, "at": _pack(local), "state": "warning", "delay": 1.7, "alive": [0, 1, 2]})
	_changed("A violet warning marks where three skeletons will rise.")
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
		var units: Array = summoned_nodes.get(id, [])
		var changed := false
		for unit in units:
			if int(unit.slot) not in threat.alive: continue
			if not is_instance_valid(unit.node) or not bool(unit.node.get_meta("alive", true)):
				threat.alive.erase(int(unit.slot))
				changed = true
		if threat.alive.is_empty():
			data.threats.erase(threat)
			summoned_nodes.erase(id)
			changed = true
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
	print("WORLD_BUILDER revision=", data.revision, " wood=", data.wood, " aether=", snappedf(float(data.aether), 0.1), " paths=", data.paths.size(), " marked=", data.marked.size(), " :: ", message)
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
			W.cyl(root, point + Vector3(0, 0.14, 0), 0.37, 0.28, "9a754e")
	for value in data.groves: _render_grove(_unpack(value))
	for segment in data.paths:
		var a := _unpack(segment.a)
		var b := _unpack(segment.b)
		_render_path(a, b)
		_clear_grove_collision(a, b)
	for value in data.bridges: _render_bridge(_unpack(value))
	_jobs_from_marked()

func _build_brook() -> void:
	var brook := Node3D.new()
	brook.name = "WindfallBrook"
	root.add_child(brook)
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	var water_material: ShaderMaterial = preload("res://orchard_atmosphere.gd").water_material()
	for i in range(80):
		var x0 := -28.0 + float(i) * 1.5
		var x1 := x0 + 1.5
		var drift0 := sin(x0 * 0.078) * 1.1 + sin(x0 * 0.18) * 0.25
		var drift1 := sin(x1 * 0.078) * 1.1 + sin(x1 * 0.18) * 0.25
		var half_width0 := 2.2 + sin(x0 * 0.13) * 0.16
		var half_width1 := 2.2 + sin(x1 * 0.13) * 0.16
		var a := Vector3(x0, 0.075, CROSSING.z + drift0 - half_width0)
		var b := Vector3(x0, 0.075, CROSSING.z + drift0 + half_width0)
		var c := Vector3(x1, 0.075, CROSSING.z + drift1 - half_width1)
		var d := Vector3(x1, 0.075, CROSSING.z + drift1 + half_width1)
		var tint := Color("a8dcc9") if i % 9 == 0 else Color("65baa9")
		for point in [a, b, c, b, d, c]:
			surface.set_color(tint)
			surface.set_normal(Vector3.UP)
			surface.add_vertex(point)
	# The authored shoreline kit replaces the old metronomic row of primitives.
	var stream := MeshInstance3D.new()
	stream.name = "WindfallWater"
	stream.mesh = surface.commit()
	stream.mesh.surface_set_material(0, water_material)
	stream.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	brook.add_child(stream)
	preload("res://orchard_dressing.gd").brook_bank(brook, CROSSING.z)
	W.label(brook, "THE BROOK CROSSING\n3 lumber · build from the map", CROSSING + Vector3(0, 2.25, -3.2), 20, "fff0c8")
	# The water is shallow and physically walkable; the bridge is a useful dry route.

func _build_camp() -> void:
	var camp := Node3D.new()
	camp.name = "LumberjackCamp"
	camp.position = CAMP
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
	var count := maxi(2, ceili(a.distance_to(b) / 1.25))
	var surface := SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(count):
		var t0 := float(i) / count
		var t1 := float(i + 1) / count
		var point0 := a.lerp(b, t0) + Vector3.UP * 0.095 + across * (0.10 * sin(float(i) * 2.3))
		var point1 := a.lerp(b, t1) + Vector3.UP * 0.095 + across * (0.10 * sin(float(i + 1) * 2.3))
		var width0 := 1.42 + 0.10 * sin(float(i) * 1.7)
		var width1 := 1.42 + 0.10 * sin(float(i + 1) * 1.7)
		var tint := Color("c9ad7d") if i % 4 else Color("ddc18e")
		for point in [point0 - across * width0, point0 + across * width0, point1 - across * width1, point0 + across * width0, point1 + across * width1, point1 - across * width1]:
			surface.set_color(tint)
			surface.set_normal(Vector3.UP)
			surface.add_vertex(point)
	var mesh := MeshInstance3D.new()
	mesh.name = "CarvedPath_%02d" % data.paths.size()
	mesh.mesh = surface.commit()
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("aa906a")
	material.vertex_color_use_as_albedo = true
	material.roughness = 1.0
	material.cull_mode = BaseMaterial3D.CULL_DISABLED
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mesh.mesh.surface_set_material(0, material)
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	root.add_child(mesh)
	# A sign at the route entrance makes a carved route legible on foot.
	if rendered_markers < MAX_WAYMARKERS and ResourceLoader.exists(WAYMARKER):
		var marker: PackedScene = load(WAYMARKER)
		var post := Node3D.new()
		post.name = "RouteWaymarker"
		post.position = a + across * 2.1
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
	var orchard_root: Node3D = game.scene.zones[ZONE].root
	for holder in orchard_root.find_children("*", "MultiMeshInstance3D", true, false):
		if not holder.has_meta("builder_positions"): continue
		var positions: Array = holder.get_meta("builder_positions")
		for i in range(positions.size()):
			if _key(positions[i]) == key:
				holder.multimesh.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.001), Vector3(0, -200, 0)))

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
	grove.position = local
	root.add_child(grove)
	for i in range(3):
		var a := float(i) * TAU / 3.0 + 0.2
		var pos := Vector3(cos(a) * 2.5, 0, sin(a) * 2.5)
		var timber: Node3D = W.resource(game.adventure.zone_groups[ZONE], game.scene, ZONE, center + local + pos, "lumber", "axe", 2)
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
	crossing.position = local + Vector3(0, 0.17, 0)
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
		if (resource_by_key.has(str(key)) or scenic_by_key.has(str(key))) and not str(key) in data.harvested:
			jobs.append({"key": str(key), "assigned": false, "progress": 0.0})

func _ensure_workers() -> void:
	while worker_nodes.size() < int(data.workers):
		var index := worker_nodes.size()
		var worker := Node3D.new()
		worker.name = "Lumberjack_%02d" % index
		worker.position = CAMP + Vector3(-1.5 + float(index) * 0.75, 0, 1.4)
		root.add_child(worker)
		worker.set_meta("job", "")
		worker.set_meta("chop", 0.0)
		worker.set_meta("carry_amount", 0)
		if ResourceLoader.exists(WORKER):
			var scene: PackedScene = load(WORKER)
			if scene != null:
				var model := scene.instantiate()
				worker.add_child(model)
				var players := model.find_children("*", "AnimationPlayer", true, false)
				if not players.is_empty():
					worker.set_meta("animator", players[0])
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
	player.play(actual, 0.16)
	worker.set_meta("clip", actual)

func _for_each_worker(delta: float) -> void:
	for worker in worker_nodes:
		if not is_instance_valid(worker): continue
		if int(worker.get_meta("carry_amount", 0)) > 0:
			_set_worker_animation(worker, "Worker_Walk")
			var destination := CAMP + Vector3(0.0, 0, 1.4)
			var home_direction: Vector3 = destination - worker.position
			home_direction.y = 0
			if home_direction.length() > 0.55:
				worker.position += home_direction.normalized() * minf(delta * 2.1, home_direction.length())
				worker.rotation.y = atan2(home_direction.x, home_direction.z)
				continue
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
			_set_worker_animation(worker, "Worker_Idle")
			worker.position = worker.position.move_toward(CAMP + Vector3(0, 0, 1.4), delta * 1.4)
			continue
		if not resource_by_key.has(key) and not scenic_by_key.has(key): worker.set_meta("job", ""); continue
		if key in data.harvested: worker.set_meta("job", ""); continue
		var target: Node3D = resource_by_key.get(key, null)
		if target != null and not is_instance_valid(target): worker.set_meta("job", ""); continue
		var target_position: Vector3 = target.global_position - center if target != null else scenic_by_key[key].position
		var place: Vector3 = target_position + Vector3(1.0, 0, 0)
		var direction: Vector3 = place - worker.position
		direction.y = 0
		if direction.length() > 1.2:
			_set_worker_animation(worker, "Worker_Walk")
			worker.position += direction.normalized() * minf(delta * 2.1, direction.length() - 1.1)
			worker.rotation.y = atan2(direction.x, direction.z)
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
