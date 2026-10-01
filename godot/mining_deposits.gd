extends Node3D
## Bounded mineable targets. Damage, collection, and art have separate owners.
## setup(game) registers authored ore nodes and places small natural
## deposits after physics has published the real floor. strike() returns data
## for the caller to collect; it never writes inventory or player saves.
const Damage = preload("res://mining_damage.gd")
const Fields = preload("res://landscape_fields.gd")
const Meteor = preload("res://landscape_meteor.gd")
const Art = preload("res://mining_visual_art.gd")
const MAX_NATURAL := 14
const MAX_ATTEMPTS_PER_ZONE := 48
const RESPAWN_SECONDS := 120.0
const ZONE_COUNTS := {
	"sandstone_quarry": {"stone": 3, "iron": 2},
	"crystal_hollow": {"crystal": 3},
	"ember_foundry": {"iron": 2},
	"starfall_ridge": {"crystal": 2},
}

var game
var entries: Dictionary = {} # target instance ID -> registration
var natural: Array[Node3D] = []
var records: Dictionary = {} # stable ID -> {kind,remaining,generation,respawn,sites}
var visuals: Dictionary = {} # stable ID -> scene nodes rebuilt from saved sites
var stats := {"authored": 0, "natural": 0, "rejected": 0}
var _placement_started := false
var _elapsed := 0.0

func setup(owner_game) -> void:
	game = owner_game
	name = "MiningDeposits"
	var builder = game.get("world_builder")
	if builder != null and builder.data is Dictionary:
		var saved: Variant = builder.data.get("mining_deposits", {})
		if valid_records(saved): records = saved.duplicate(true)
		else: push_warning("Invalid mining deposit records; preserving loaded state for review")
	_register_authored()
	_store()
	if not _placement_started:
		_placement_started = true
		call_deferred("_populate")

func _register_authored() -> void:
	if game == null or not game.scene is Dictionary: return
	for target in game.scene.get("resources", []):
		if not is_instance_valid(target) or not target is Node3D: continue
		if str(target.get_meta("requires", "")) not in ["pick", "mine"]: continue
		var kind := str(target.get_meta("resource_id", target.get_meta("resource", "")))
		if Damage.profile(kind).is_empty(): continue
		target.set_meta("surface_material", "glass" if kind=="crystal" else ("star_iron" if kind=="iron" else "stone"))
		var id: int = target.get_instance_id()
		if entries.has(id): continue
		var stable := "ore:%s:%s" % [str(target.get_meta("zone", "")), str(target.get_meta("id", target.name))]
		entries[id] = {"id": stable, "target": target, "kind": kind, "resource": kind, "natural": false,
			"zone": str(target.get_meta("zone", "")), "amount": clampi(int(target.get_meta("amount", 3)), 1, 5)}
		_ensure_record(stable, kind)
		var record: Dictionary = _refresh(stable, entries[id])
		if not record.is_empty() and int(record.remaining) == 0: _set_available(entries[id], false)
		elif not record.is_empty(): _sync_cracks(entries[id], record)
		stats.authored += 1

func _populate() -> void:
	if game == null or not is_instance_valid(game) or not game.scene is Dictionary: return
	# WorldZones and LandscapeRuntime create collision before this manager starts;
	# schedule after broadphase publication without a suspended coroutine that
	# can resume after this manager is freed during scene teardown.
	get_tree().physics_frame.connect(_populate_after_physics, CONNECT_ONE_SHOT)

func _populate_after_physics() -> void:
	if game == null or not is_instance_valid(game): return
	var zones: Dictionary = game.scene.get("zones", {})
	for zone_id in ZONE_COUNTS:
		if not zones.has(zone_id): continue
		var zone: Dictionary = zones[zone_id]
		for kind in ZONE_COUNTS[zone_id]:
			var requested: int = ZONE_COUNTS[zone_id][kind]
			var accepted := 0
			for attempt in MAX_ATTEMPTS_PER_ZONE:
				if accepted >= requested or natural.size() >= MAX_NATURAL: break
				var horizontal := _candidate(zone, str(zone_id), str(kind), attempt)
				if not horizontal.is_finite(): continue
				if not _route_clear(str(zone_id), zone, horizontal):
					stats.rejected += 1
					continue
				var floor := _ground(str(zone_id), zone, horizontal)
				if floor.is_empty():
					stats.rejected += 1
					continue
				var target := _add_natural(str(zone_id), str(kind), floor.position, attempt)
				if target != null: accepted += 1
	_store()
	print("MINING_DEPOSITS_READY ", stats)

func _candidate(_zone: Dictionary, zone_id: String, kind: String, attempt: int) -> Vector2:
	# Authored ore is the geological evidence. Place a nearby continuation of
	# that vein, never free-floating noise across a floor with no mineral source.
	var anchors: Array[Vector2] = []
	for resource in game.scene.get("resources", []):
		if not is_instance_valid(resource) or str(resource.get_meta("zone", "")) != zone_id: continue
		if str(resource.get_meta("resource_id", "")) != kind: continue
		var position: Vector3 = resource.global_position
		anchors.append(Vector2(position.x, position.z))
	if anchors.is_empty(): return Vector2.INF
	var anchor: Vector2 = anchors[attempt % anchors.size()]
	var phase := float((zone_id + kind).hash() & 65535) / 65535.0 * TAU
	var angle := phase + float(attempt) * 2.39996323
	var radius := 3.25 + 1.9 * float((attempt * 7) % 11) / 10.0
	return anchor + Vector2(cos(angle), sin(angle)) * radius

func _route_clear(zone_id: String, zone: Dictionary, point: Vector2) -> bool:
	var bounds: Rect2 = zone.bounds.grow(-2.0)
	if not bounds.has_point(point): return false
	var center: Vector3 = zone.center
	var spawn: Vector3 = zone.spawn
	var c := Vector2(center.x, center.z)
	var s := Vector2(spawn.x, spawn.z)
	if point.distance_to(c) < 4.0 or point.distance_to(s) < 5.0: return false
	if _segment_distance(point, s, c) < 2.7: return false
	if zone_id == "sandstone_quarry" and _segment_distance(point, c + Vector2(0, 9), c + Vector2(4, -8)) < 3.0: return false
	if zone_id == "orchard_highlands":
		# The authored camp, crossing, and long walking corridors stay open.
		for local_site in [Vector2(15, -27), Vector2(25, -48), Vector2(0, 103)]:
			if point.distance_to(c + local_site) < 12.0: return false
	for portal in game.scene.get("portals", []):
		if not is_instance_valid(portal) or str(portal.get_meta("zone", "")) != zone_id: continue
		var p: Vector3 = portal.global_position
		var horizontal := Vector2(p.x, p.z)
		if point.distance_to(horizontal) < 5.5 or _segment_distance(point, c, horizontal) < 2.8: return false
	for group in ["resources", "anchors", "enemies"]:
		for actor in game.scene.get(group, []):
			if not is_instance_valid(actor) or str(actor.get_meta("zone", "")) != zone_id: continue
			var p: Vector3 = actor.global_position
			if point.distance_to(Vector2(p.x, p.z)) < (2.8 if group == "resources" else 2.5): return false
	for target in natural:
		if not is_instance_valid(target): continue
		var p: Vector3 = target.global_position
		if point.distance_to(Vector2(p.x, p.z)) < 3.0: return false
	return true

static func _segment_distance(point: Vector2, a: Vector2, b: Vector2) -> float:
	var delta := b - a
	if delta.length_squared() < 0.0001: return point.distance_to(a)
	return point.distance_to(a + delta * clampf((point - a).dot(delta) / delta.length_squared(), 0.0, 1.0))

func _ground(zone_id: String, zone: Dictionary, point: Vector2) -> Dictionary:
	var center: Vector3 = zone.center
	var y := center.y
	if zone_id == "orchard_highlands":
		if game.get("landscape") == null or game.landscape.model.is_empty(): return {}
		var land = game.landscape
		var local: Vector3 = land.zone_root.to_local(Vector3(point.x, 0, point.y))
		var uv := Vector2(local.x, local.z)
		if not land.passable(uv): return {}
		var slope: float = Fields.sample(land.model, "slope", uv)
		var moisture: float = Fields.sample(land.model, "moisture", uv)
		if slope < 0.08 or slope > 0.38 or moisture > 0.72: return {}
		y = land.zone_root.to_global(Vector3(local.x, land.height_at(uv), local.z)).y
	var ray := PhysicsRayQueryParameters3D.create(Vector3(point.x, y + 7.0, point.y), Vector3(point.x, y - 5.0, point.y), 1)
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
	if hit.is_empty() or float(hit.normal.y) < 0.80: return {}
	var owner: Node = hit.collider
	while owner != null and owner != game and not owner.has_meta("kind"): owner = owner.get_parent()
	if owner == null or str(owner.get_meta("kind", "")) != "floor": return {}
	if absf(float(hit.position.y) - y) > (0.25 if zone_id == "orchard_highlands" else 2.0): return {}
	return {"position": hit.position, "normal": hit.normal}

func _add_natural(zone_id: String, kind: String, floor_point: Vector3, ordinal: int) -> Node3D:
	var stable := "natural:%s:%s:%d" % [zone_id, kind, ordinal]
	var target := Node3D.new()
	target.name = "NaturalDeposit_%s_%s_%d" % [zone_id, kind, ordinal]
	target.position = floor_point
	target.set_meta("kind", "mining_deposit")
	target.set_meta("surface_material", "glass" if kind=="crystal" else ("star_iron" if kind=="iron" else "stone"))
	target.set_meta("requires", "pick")
	target.set_meta("resource_id", kind)
	target.set_meta("resource", kind)
	target.set_meta("zone", zone_id)
	target.set_meta("deposit_id", stable)
	add_child(target)
	var body := StaticBody3D.new()
	body.collision_layer = 1
	body.collision_mask = 0
	body.position.y = 0.53
	body.scale = Vector3.ONE * 0.35
	target.add_child(body)
	var rock_mesh: ArrayMesh = Meteor._rock_mesh()
	var shell := MeshInstance3D.new()
	shell.name = "DepositShell"
	shell.mesh = rock_mesh
	shell.material_override = Art.material("iron" if kind == "iron" else "stone")
	body.add_child(shell)
	var shape := CollisionShape3D.new()
	shape.shape = rock_mesh.create_trimesh_shape()
	body.add_child(shape)
	if kind == "crystal":
		for i in 3:
			var crystal := MeshInstance3D.new()
			crystal.name = "CrystalVein%d" % i
			crystal.mesh = Art.crystal_mesh(ordinal * 7 + i)
			crystal.scale = Vector3.ONE * (5.2 if i == 0 else 3.8)
			crystal.position = [Vector3(0, 1.55, 0), Vector3(-0.67, 1.27, 0.18), Vector3(0.58, 1.30, -0.2)][i]
			body.add_child(crystal)
	var id := target.get_instance_id()
	entries[id] = {"id": stable, "target": target, "kind": kind, "resource": kind, "natural": true,
		"zone": zone_id, "amount": 1, "body": body}
	var record := _ensure_record(stable, kind)
	if int(record.remaining) == 0: _set_available(entries[id], false)
	else: _sync_cracks(entries[id], record)
	natural.append(target)
	stats.natural += 1
	return target

static func valid_records(value: Variant) -> bool:
	if not value is Dictionary or value.size() > 64: return false
	for key in value:
		if not key is String or key.is_empty() or key.length() > 96: return false
		if key.contains("/") or key.contains("\\") or key.contains("..") or key.contains("\n"): return false
		var record: Variant = value[key]
		if not record is Dictionary: return false
		if Damage.profile(str(record.get("kind", ""))).is_empty(): return false
		for field in ["remaining", "generation", "respawn"]:
			if not (record.get(field) is int or record.get(field) is float): return false
			if not is_finite(float(record[field])) or float(record[field]) != float(int(record[field])): return false
		if int(record.remaining) not in [0, 1]: return false
		if int(record.generation) < 0 or int(record.generation) > 100000: return false
		if float(record.respawn) < 0.0 or float(record.respawn) > 4102444800.0: return false
		if not Damage.valid_sites(record.get("sites", null)): return false
		for site in record.sites:
			if str(site.kind) != str(record.kind): return false
			if not site.has("normal"): continue
			if not site.normal is Array or site.normal.size() != 3: return false
			for component in site.normal:
				if not (component is int or component is float) or not is_finite(float(component)) or absf(float(component)) > 1.01: return false
	return true

func _ensure_record(stable: String, kind: String) -> Dictionary:
	if records.has(stable): return records[stable]
	if records.size() >= 64: return {}
	var record := {"kind": kind, "remaining": 1, "generation": 0, "respawn": 0, "sites": []}
	records[stable] = record
	return record

func _store() -> void:
	if game == null: return
	var builder = game.get("world_builder")
	if builder != null and builder.data is Dictionary:
		builder.data["mining_deposits"] = records.duplicate(true)

func _refresh(stable: String, entry: Dictionary = {}) -> Dictionary:
	var record: Dictionary = records.get(stable, {})
	if record.is_empty(): return record
	if int(record.remaining) == 0 and int(record.respawn) > 0 and Time.get_unix_time_from_system() >= float(record.respawn):
		record.remaining = 1
		record.generation = int(record.generation) + 1
		record.respawn = 0
		record.sites = []
		records[stable] = record
		if not entry.is_empty(): _sync_cracks(entry, record)
		if not entry.is_empty() and is_instance_valid(entry.target) and not bool(entry.get("golem", false)):
			_set_available(entry, true)
		_store()
	return record

func _set_available(entry: Dictionary, available: bool) -> void:
	var target: Node3D = entry.target
	if not is_instance_valid(target): return
	target.visible = available
	if available:
		if target.has_meta("mining_extracted"): target.remove_meta("mining_extracted")
	else: target.set_meta("mining_extracted", true)
	for body in target.find_children("*", "CollisionObject3D", true, false):
		if not body is CollisionObject3D: continue
		if not body.has_meta("mining_original_layer"):
			body.set_meta("mining_original_layer", body.collision_layer)
		body.collision_layer = int(body.get_meta("mining_original_layer")) if available else 0

func _sync_cracks(entry: Dictionary, record: Dictionary) -> void:
	var stable: String = str(entry.id)
	for node in visuals.get(stable, []):
		if is_instance_valid(node): node.free()
	visuals[stable] = []
	if int(record.remaining) == 0 or not is_instance_valid(entry.target): return
	var target: Node3D = entry.target
	for i in mini(record.sites.size(), 8):
		var site: Dictionary = record.sites[i]
		var coords: Array = site.point
		var point := Vector3(float(coords[0]), float(coords[1]), float(coords[2]))
		var normals: Array = site.get("normal", [0.0, 0.0, 1.0])
		var normal := Vector3(float(normals[0]), float(normals[1]), float(normals[2])).normalized()
		if bool(entry.get("golem", false)):
			point = target.to_global(point)
			normal = (target.global_basis * normal).normalized()
		var facet: Dictionary = _facet_projection(target, point, normal, bool(entry.natural))
		var stage := 3 if int(site.stage)>=1 else (2 if float(site.damage)>=0.6 else 1)
		var seed := (stable + ":" + str(i)).hash()
		var node: Node3D = Art.decorate_site(target, facet.point, facet.normal, stage, seed)
		visuals[stable].append(node)

func _facet_projection(target: Node3D, point: Vector3, normal: Vector3, natural_target: bool) -> Dictionary:
	if natural_target: return {"point": point, "normal": normal}
	var best_point := point
	var best_normal := normal
	var best_distance := 0.45
	var origin := point + normal * 0.55
	for child in target.find_children("*", "MeshInstance3D", true, false):
		var mesh_node := child as MeshInstance3D
		if not mesh_node.is_visible_in_tree() or mesh_node.mesh == null or str(mesh_node.name).begins_with("MiningSite"): continue
		var faces: PackedVector3Array = mesh_node.mesh.get_faces()
		for index in range(0, faces.size(), 3):
			var a := mesh_node.to_global(faces[index])
			var b := mesh_node.to_global(faces[index + 1])
			var c := mesh_node.to_global(faces[index + 2])
			var hit = Geometry3D.ray_intersects_triangle(origin, -normal, a, b, c)
			if hit == null: continue
			var distance: float = point.distance_to(hit)
			if distance >= best_distance: continue
			best_distance = distance
			best_point = hit
			best_normal = (c - a).cross(b - a).normalized()
			if best_normal.dot(normal) < 0.0: best_normal = -best_normal
	return {"point": best_point, "normal": best_normal}

func strike(item: Node3D, target: Node3D, point: Vector3, normal: Vector3,
		speed: float, context: Dictionary = {}) -> Dictionary:
	var result := {"handled": false, "accepted": false, "reason": "not_mineable", "extracted": false,
		"resource": "", "amount": 0, "source": "", "target": target, "reward_id": ""}
	if not is_instance_valid(item) or not is_instance_valid(target) or not point.is_finite(): return result
	if str(item.get_meta("id", "")) != "quarry_pick": return result
	var entry: Dictionary = entries.get(target.get_instance_id(), {})
	if entry.is_empty() and str(target.get_meta("enemy_type", "")) == "golem":
		entry = {"id": "golem:%s" % str(target.get_meta("id", target.name)),
			"target": target, "kind": "stone", "resource": "stone", "natural": false,
			"zone": str(target.get_meta("zone", "")), "amount": 1, "golem": true}
	if entry.is_empty(): return result
	result.handled = true
	result.source = "golem_armor" if bool(entry.get("golem", false)) else ("natural" if bool(entry.natural) else "authored_ore")
	var stable: String = entry.id
	var record: Dictionary = _ensure_record(stable, str(entry.kind))
	if record.is_empty(): result.reason = "record_limit"; return result
	record = _refresh(stable, entry)
	if int(record.remaining) <= 0 or target.get_meta("collecting", false) or not target.is_visible_in_tree():
		result.reason = "unavailable"
		return result
	if not normal.is_finite() or normal.length_squared() < 0.25 or not is_finite(speed):
		result.reason = "invalid_contact"
		return result
	var limit := 1.2 if bool(entry.natural) else (2.4 if bool(entry.get("golem", false)) else 1.8)
	if point.distance_to(target.global_position + Vector3.UP * (1.1 if bool(entry.get("golem", false)) else 0.4)) > limit:
		result.reason = "off_target"
		return result
	var incidence := clampf(float(context.get("incidence", 1.0)), 0.0, 1.0)
	var damage_context := {"strike_region": str(context.get("strike_region", "pick_point")), "incidence": incidence}
	var energy := float(context.get("energy", 0.5 * float(item.get_meta("combat_mass", 2.1)) * speed * speed * incidence))
	if bool(context.get("charged", false)): energy *= 1.35
	var local_site := bool(entry.get("golem", false))
	var site_point: Vector3 = target.to_local(point) if local_site else point
	var site_normal: Vector3 = (target.global_basis.inverse() * normal).normalized() if local_site else normal.normalized()
	var applied: Dictionary = Damage.apply(record.sites, site_point, str(entry.kind), energy, damage_context, -1)
	result.merge(applied, true)
	if not bool(applied.accepted): return result
	record.sites = applied.sites
	if not record.sites.is_empty():
		var nearest := INF
		var selected := -1
		for i in record.sites.size():
			var coordinates: Array = record.sites[i].point
			var stored := Vector3(float(coordinates[0]), float(coordinates[1]), float(coordinates[2]))
			var distance := stored.distance_squared_to(site_point)
			if distance < nearest: nearest = distance; selected = i
		if selected >= 0:
			record.sites[selected].normal = [snappedf(site_normal.x, 0.001), snappedf(site_normal.y, 0.001), snappedf(site_normal.z, 0.001)]
	result.resource = str(entry.resource)
	result.amount = int(entry.amount) if bool(applied.extracted) else 0
	if bool(applied.extracted):
		record.remaining = 0
		record.respawn = int(Time.get_unix_time_from_system() + (35.0 if result.source == "authored_ore" else RESPAWN_SECONDS))
		result.reward_id = "mine:%s:g%d" % [stable, int(record.generation)]
		if not bool(entry.get("golem", false)): _set_available(entry, false)
	records[stable] = record
	_sync_cracks(entry, record)
	_store()
	return result

func tick(delta: float) -> void:
	if not is_finite(delta) or delta < 0.0: return
	for id in entries.keys():
		var entry: Dictionary = entries[id]
		var target: Node3D = entry.target
		if not is_instance_valid(target):
			entries.erase(id)
			continue
		_refresh(str(entry.id), entry)
