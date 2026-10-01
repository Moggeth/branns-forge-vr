extends SceneTree
## Headless fixture for existing ore, bounded geology slots, and staged strikes.
const Deposits = preload("res://mining_deposits.gd")
const WorldZones = preload("res://world_zones.gd")
var failures: Array[String] = []

class Fixture extends Node3D:
	var scene := {"zones": {}, "resources": [], "portals": [], "anchors": [], "enemies": []}
	var landscape = null
	var world_builder

class Builder extends Node:
	var data := {"mining_deposits": {}}

func _initialize() -> void: call_deferred("_run")

func _run() -> void:
	var began := Time.get_ticks_usec()
	var fixture := Fixture.new()
	root.add_child(fixture)
	fixture.world_builder = Builder.new()
	fixture.add_child(fixture.world_builder)
	var floor := StaticBody3D.new()
	floor.set_meta("kind", "floor")
	floor.collision_layer = 1
	floor.position.y = -0.25
	fixture.add_child(floor)
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(30, 0.5, 30)
	shape.shape = box
	floor.add_child(shape)
	var zone := {"center": Vector3.ZERO, "spawn": Vector3(0, 0, 8),
		"bounds": Rect2(Vector2(-15, -15), Vector2(30, 30))}
	fixture.scene.zones["sandstone_quarry"] = zone
	var ore := Node3D.new()
	ore.position = Vector3(-6, 0, -1)
	ore.set_meta("kind", "resource")
	ore.set_meta("resource_id", "iron")
	ore.set_meta("requires", "pick")
	ore.set_meta("zone", "sandstone_quarry")
	ore.set_meta("id", "sandstone_quarry_resource_test")
	ore.set_meta("amount", 3)
	fixture.add_child(ore)
	fixture.scene.resources.append(ore)
	var portal := Node3D.new()
	portal.position = Vector3(7.5, 0, 9.5)
	portal.set_meta("zone", "sandstone_quarry")
	fixture.add_child(portal)
	fixture.scene.portals.append(portal)
	var mining := Deposits.new()
	fixture.add_child(mining)
	mining.setup(fixture)
	for i in 3: await physics_frame
	_check(mining.stats.authored == 1, "authored ore registered exactly once")
	_check(mining.natural.size() > 0 and mining.natural.size() <= Deposits.MAX_NATURAL, "bounded natural slots on real floor")
	var seen := {}
	for target in mining.natural:
		var p: Vector3 = target.global_position
		var horizontal := Vector2(p.x, p.z)
		_check(absf(p.y) < 0.02, "natural deposit seated on floor")
		_check(mining._route_clear("sandstone_quarry", zone, horizontal) == false,
			"placed deposit reserves its own slot")
		_check(horizontal.distance_to(Vector2(0, 8)) >= 5.0, "spawn envelope open")
		_check(horizontal.distance_to(Vector2(7.5, 9.5)) >= 5.5, "portal envelope open")
		_check(not seen.has(target.get_meta("deposit_id")), "stable deposit ID unique")
		seen[target.get_meta("deposit_id")] = true
		_check(target.get_meta("kind") == "mining_deposit" and str(target.get_meta("resource_id")) in ["stone", "iron"], "deposit exposes resource metadata")
		var body: StaticBody3D = mining.entries[target.get_instance_id()].body
		var shell: MeshInstance3D = body.get_node("DepositShell")
		var collision: CollisionShape3D = body.get_child(1)
		_check(shell.mesh != null and collision.shape is ConcavePolygonShape3D and absf(body.scale.x - 0.35) < 0.001,
			"small shell visual and collision share actual rock facets")
	var candidate_a: Vector2 = mining._candidate(zone, "sandstone_quarry", "iron", 7)
	var candidate_b: Vector2 = mining._candidate(zone, "sandstone_quarry", "iron", 7)
	_check(candidate_a == candidate_b, "geology candidate deterministic")
	var pick := Node3D.new()
	pick.set_meta("id", "quarry_pick")
	pick.set_meta("combat_mass", 2.1)
	fixture.add_child(pick)
	var wrong := Node3D.new()
	wrong.set_meta("id", "woodland_axe")
	fixture.add_child(wrong)
	_check(not mining.strike(wrong, ore, ore.global_position + Vector3.UP * 0.65, Vector3.BACK, 2.4).handled,
		"axe cannot mine")
	var response := {}
	for i in 8:
		response = mining.strike(pick, ore, ore.global_position + Vector3.UP * 0.65, Vector3.BACK, 2.4,
			{"strike_region": "pick_point", "incidence": 1.0})
		if bool(response.get("extracted", false)): break
	_check(bool(response.get("extracted", false)) and response.resource == "iron" and response.amount == 3,
		"authored iron needs staged pick strikes and returns existing amount")
	_check(str(response.get("reward_id", "")).begins_with("mine:ore:sandstone_quarry:"), "authored reward ID stable")
	_check(not mining.strike(pick, ore, ore.global_position + Vector3.UP * 0.65, Vector3.BACK, 2.4).accepted,
		"extracted ore cannot double-pay before collection")
	await _reload_depleted(fixture.world_builder.data.mining_deposits.duplicate(true))
	if not mining.natural.is_empty():
		var deposit: Node3D = mining.natural[0]
		var ray := PhysicsRayQueryParameters3D.create(deposit.global_position + Vector3(0, 0.6, 2.0),
			deposit.global_position + Vector3(0, 0.6, -2.0), 1)
		var surface: Dictionary = fixture.get_world_3d().direct_space_state.intersect_ray(ray)
		_check(not surface.is_empty() and surface.collider == mining.entries[deposit.get_instance_id()].body,
			"ray reaches rendered shell instead of bounding-sphere empty air")
		for i in 8:
			response = mining.strike(pick, deposit, deposit.global_position + Vector3.UP * 0.33,
				Vector3.BACK, 2.4)
			if bool(response.get("extracted", false)): break
		_check(bool(response.get("extracted", false)) and not deposit.visible and response.amount == 1,
			"natural stone extracts once and retires collision")
		var stable: String = str(deposit.get_meta("deposit_id"))
		var persisted: Dictionary = fixture.world_builder.data.mining_deposits
		_check(Deposits.valid_records(persisted) and int(persisted[stable].remaining) == 0,
			"extraction stores validated depleted record")
		var damaged := persisted.duplicate(true)
		damaged[stable].sites = [{"point": [INF, 0, 0], "kind": "stone", "target": -1, "damage": 0.2, "stage": 0}]
		_check(not Deposits.valid_records(damaged), "invalid saved sites rejected")
		mining.records[stable].respawn = int(Time.get_unix_time_from_system()) - 1
		mining.tick(0.016)
		_check(deposit.visible and not deposit.get_meta("mining_extracted", false) and int(mining.records[stable].generation) == 1,
			"natural deposit respawns and advances saved generation")
	var golem := Node3D.new()
	golem.position = Vector3(3, 0, -3)
	golem.set_meta("kind", "enemy")
	golem.set_meta("enemy_type", "golem")
	fixture.add_child(golem)
	response = mining.strike(pick, golem, golem.global_position + Vector3.UP, Vector3.BACK, 2.4)
	_check(bool(response.accepted) and response.source == "golem_armor", "golem stone accepts measured point without ore registration")
	_check(Deposits.valid_records(fixture.world_builder.data.mining_deposits), "saved deposit records stay valid")
	if OS.get_cmdline_user_args().has("--full-world"):
		await _full_world()
	print("MINING_DEPOSITS_CHECKS ", {"failures": failures, "authored": mining.stats.authored,
		"natural": mining.stats.natural, "seconds": (Time.get_ticks_usec() - began) / 1000000.0})
	fixture.free()
	quit(0 if failures.is_empty() else 1)

func _full_world() -> void:
	var fixture := Fixture.new()
	root.add_child(fixture)
	fixture.world_builder = Builder.new()
	fixture.add_child(fixture.world_builder)
	fixture.scene = WorldZones.build(fixture)
	var mining := Deposits.new()
	fixture.add_child(mining)
	mining.setup(fixture)
	for i in 3: await physics_frame
	_check(mining.stats.authored >= 7, "full world authored ore registered")
	_check(mining.stats.natural > 0 and mining.stats.natural <= Deposits.MAX_NATURAL,
		"full world natural placement bounded")
	var by_zone := {}
	for target in mining.natural:
		var zone_id: String = str(target.get_meta("zone", ""))
		by_zone[zone_id] = int(by_zone.get(zone_id, 0)) + 1
	print("MINING_FULL_WORLD ", {"authored": mining.stats.authored, "natural": mining.stats.natural,
		"by_zone": by_zone, "rejected": mining.stats.rejected})
	fixture.free()

func _reload_depleted(saved: Dictionary) -> void:
	var fixture := Fixture.new()
	root.add_child(fixture)
	fixture.world_builder = Builder.new()
	fixture.add_child(fixture.world_builder)
	fixture.world_builder.data.mining_deposits = saved
	var ore := Node3D.new()
	ore.set_meta("kind", "resource")
	ore.set_meta("resource_id", "iron")
	ore.set_meta("requires", "pick")
	ore.set_meta("zone", "sandstone_quarry")
	ore.set_meta("id", "sandstone_quarry_resource_test")
	fixture.add_child(ore)
	fixture.scene.resources.append(ore)
	var mining := Deposits.new()
	fixture.add_child(mining)
	mining.setup(fixture)
	await physics_frame
	var stable := "ore:sandstone_quarry:sandstone_quarry_resource_test"
	_check(not ore.visible and int(mining.records[stable].remaining) == 0,
		"saved exhausted ore stays unavailable after reload")
	mining.records[stable].respawn = int(Time.get_unix_time_from_system()) - 1
	mining.tick(0.016)
	_check(ore.visible and int(mining.records[stable].generation) == 1 and
		int(fixture.world_builder.data.mining_deposits[stable].generation) == 1,
		"reload resumes finite ore at next saved generation")
	fixture.free()

func _check(condition: bool, label: String) -> void:
	if not condition: failures.append(label)
