extends SceneTree
## Offline economy/stream check. No service, player state, or live save access.
const GodRole = preload("res://god_role_runtime.gd")
const Fields = preload("res://orchard_planet_fields.gd")

class MockBuilder extends Node:
	var data := {"mana": 20.0, "wood": 7, "god_essence": 0}
	var saves := 0
	func save() -> bool:
		saves += 1
		return true
	func summon_encounter(_action: String, _point: Vector3, _zone: String) -> String:
		if float(data.mana) < 4.0: return "Need 4 Mana"
		data.mana -= 4.0
		return ""

class MockAdventure extends Node:
	var zone := "orchard_highlands"
	var zone_groups := {}
	var bites := 0
	func take_damage(_amount: float, _source: String) -> void:
		bites += 1

class MockWorkers extends Node:
	var accepted := true
	func summon(_point: Vector3, _zone: String) -> Dictionary:
		return {"ok": true, "internal_lumber_cost": 0} if accepted else {"ok": false, "error": "No work site"}

class MockView extends Node:
	var current_zone := "elsewhere"

class MockGame extends Node3D:
	var world_builder: Node
	var adventure: Node
	var god_workers: Node
	var world_builder_view = null
	var orchard_planet = null
	var scene := {"zones": {"orchard_highlands": {"bounds": Rect2(-100, -100, 200, 200)}}, "rats": []}
	var rig: Node3D
	var animation = null
	var remains = null

class MockPlanet extends Node:
	var center := Vector3(600.0, 0.0, 0.0)
	var radius := 85.0
	var built := true
	var fields
	var casts := 0
	func cast(_action: String, _point: Vector3) -> Dictionary:
		casts += 1
		return {"ok": true}
	func surface_point(direction: Vector3) -> Vector3:
		return center + fields.surface_point(direction)
	func normal_at(direction: Vector3) -> Vector3:
		return fields.normal_at(direction)

var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("run")

func check(value: bool, reason: String) -> void:
	if not value: failures.append(reason)

func run() -> void:
	var started := Time.get_ticks_msec()
	var game := MockGame.new()
	root.add_child(game)
	game.world_builder = MockBuilder.new()
	game.add_child(game.world_builder)
	game.adventure = MockAdventure.new()
	game.add_child(game.adventure)
	var zone_root := Node3D.new()
	game.add_child(zone_root)
	game.adventure.zone_groups["orchard_highlands"] = zone_root
	game.rig = Node3D.new()
	game.add_child(game.rig)
	game.rig.position = Vector3(80, 0, 80)
	game.god_workers = MockWorkers.new()
	game.add_child(game.god_workers)
	var role := GodRole.new()
	game.add_child(role)
	role.setup(game)
	var target := Vector3(10, 0, 10)
	var started_stream: Dictionary = role.start_rat_stream(target, "orchard_highlands")
	check(started_stream.get("ok", false) and role.rats.size() == 1, "First rat enters shared world immediately")
	for frame in 20: role.tick(0.25)
	check(role.rats.size() >= 29 and role.rats.size() <= 31, "Holding emits about six rats per second")
	check(game.scene.rats.size() == role.rats.size(), "Rat stream uses ordinary damage target array")
	check(float(game.world_builder.data.mana) < 18.0 and float(game.world_builder.data.mana) > 17.0, "Rat stream spends bounded Mana")
	var rat: Node3D = role.rats[0]
	var point: Vector3 = rat.global_position
	check(rat.get_meta("zone", "") == "orchard_highlands" and rat.get_meta("god_role_rat", false), "Rat has existing combat identity and correct zone")
	check(role.on_enemy_defeated(rat, point), "God rat death is handled without old respawn")
	check(role.motes.size() == 1 and role.rats.size() == game.scene.rats.size(), "Death drops one visible mote and retires rat")
	check(not role.on_enemy_defeated(rat, point) and role.motes.size() == 1, "Repeat death hook is idempotent")
	var collected: Dictionary = role.collect_near(point)
	check(collected.get("collected", 0) == 1 and role.essence() == 1 and role.motes.is_empty(), "God cursor collects physical essence")
	for frame in 3: role.tick(0.25)
	check(game.world_builder.saves >= 1, "Essence collection saves even while rats keep streaming")
	role.stop_rat_stream()
	var resting := role.rats.size()
	role.tick(0.25)
	check(role.rats.size() == resting, "Release stops Rat Stream")
	check(not role.start_rat_stream(Vector3.INF, "orchard_highlands").get("ok", true), "Invalid cursor cannot start stream")
	check(role.start_rat_stream(target, "orchard_highlands").get("ok", false), "Valid cursor restarts stream")
	game.adventure.zone = "elsewhere"
	role.tick(0.25)
	check(not role.stream_active, "Travel stops held stream")
	game.adventure.zone = "orchard_highlands"
	check(not role.cast_skeleton(target, "orchard_highlands").get("ok", true), "Skeleton squad needs Essence")
	game.world_builder.data.god_essence = 5
	var squad: Dictionary = role.cast_skeleton(target, "orchard_highlands")
	check(squad.get("ok", false) and role.essence() == 3, "Skeleton squad spends two Essence after existing summon succeeds")
	game.world_builder.data.mana = 3.0
	var old_wood: int = game.world_builder.data.wood
	var worker: Dictionary = role.cast_workers(target, "orchard_highlands")
	check(worker.get("ok", false) and worker.get("paid") == "mana" and game.world_builder.data.mana == 0.0, "Worker spends three Mana")
	check(game.world_builder.data.wood == old_wood, "Worker wrapper preserves Lumber ledger")
	game.world_builder.data.god_essence = 3
	worker = role.cast_workers(target, "orchard_highlands")
	check(worker.get("ok", false) and worker.get("paid") == "essence" and role.essence() == 0, "Worker may spend three Essence")
	game.god_workers.accepted = false
	game.world_builder.data.god_essence = 3
	worker = role.cast_workers(target, "orchard_highlands")
	check(not worker.get("ok", true) and role.essence() == 3, "Failed worker placement spends nothing")
	game.world_builder_view = MockView.new()
	game.add_child(game.world_builder_view)
	var fallen := Node3D.new()
	game.add_child(fallen)
	fallen.global_position = target
	fallen.set_meta("zone", "orchard_highlands")
	fallen.set_meta("enemy_type", "skeleton")
	check(not role.on_enemy_defeated(fallen) and role.motes.size() == 1, "FPS enemy death leaves Essence even when RTS surveys elsewhere")
	check(role.collect_near(target).get("collected", 0) == 2, "Skeleton mote grants two Essence")
	game.world_builder_view.current_zone = "orchard_highlands"
	game.world_builder.data.mana = 20.0
	check(role.start_rat_stream(target, "orchard_highlands").get("ok", false), "Flat performance stream starts")
	for i in 300:
		if role.rats.size() >= GodRole.MAX_RATS: break
		if float(game.world_builder.data.mana) < 1.0: game.world_builder.data.mana = 20.0
		role._emit_rat()
	role.stop_rat_stream()
	check(role.rats.size() == GodRole.MAX_RATS and role._far_instances.mesh.get_surface_count() > 1, "256 rats share merged authored mesh surfaces")
	var flat_total := 0.0
	var flat_max := 0.0
	for frame in 120:
		var before_tick := Time.get_ticks_usec()
		role.tick(1.0 / 60.0)
		var elapsed_ms := float(Time.get_ticks_usec() - before_tick) / 1000.0
		flat_total += elapsed_ms
		flat_max = maxf(flat_max, elapsed_ms)
	game.rig.global_position = role.rats[0].global_position + Vector3(1.0, 0.0, 1.0)
	for frame in 12: role.tick(1.0 / 60.0)
	check(role._full_count > 0 and role._full_count <= GodRole.MAX_FULL_RATS, "Approaching batched rats promotes a bounded group to actual animated rat rigs")
	var isolated_rat := role._light_rat()
	game.add_child(isolated_rat)
	isolated_rat.global_position = Vector3.ZERO
	isolated_rat.set_meta("kind", "rat")
	var obstacle := Node3D.new()
	obstacle.set_meta("kind", "resource")
	game.add_child(obstacle)
	obstacle.global_position = Vector3(0.4, 0.0, 0.0)
	var obstacle_body := StaticBody3D.new()
	obstacle_body.collision_layer = 1
	obstacle.add_child(obstacle_body)
	var obstacle_shape := CollisionShape3D.new()
	var obstacle_box := BoxShape3D.new()
	obstacle_box.size = Vector3(0.25, 0.6, 0.4)
	obstacle_shape.shape = obstacle_box
	obstacle_body.add_child(obstacle_shape)
	await physics_frame
	await process_frame
	check(not role._obstacle_clear(isolated_rat, Vector3(0.8, 0.0, 0.0), Vector3.UP), "Rat movement cannot clip through a physical tree/resource")
	var planet_game := MockGame.new()
	root.add_child(planet_game)
	planet_game.world_builder = MockBuilder.new()
	planet_game.add_child(planet_game.world_builder)
	planet_game.adventure = MockAdventure.new()
	planet_game.add_child(planet_game.adventure)
	planet_game.adventure.zone = "orchard_planet"
	var planet_zone := Node3D.new()
	planet_game.add_child(planet_zone)
	planet_game.adventure.zone_groups["orchard_planet"] = planet_zone
	planet_game.scene.zones["orchard_planet"] = {"center": Vector3(600, 0, 0)}
	planet_game.rig = Node3D.new()
	planet_game.add_child(planet_game.rig)
	planet_game.rig.global_position = Vector3(600, 0, -150)
	planet_game.orchard_planet = MockPlanet.new()
	planet_game.add_child(planet_game.orchard_planet)
	planet_game.orchard_planet.fields = Fields.new()
	planet_game.orchard_planet.fields.setup(290929, 85.0)
	var planet_role := GodRole.new()
	planet_game.add_child(planet_role)
	planet_role.setup(planet_game)
	var planet_target: Vector3 = planet_game.orchard_planet.surface_point(Vector3.RIGHT)
	planet_game.world_builder.data.god_essence = 4
	var planet_squad: Dictionary = planet_role.cast_skeleton(planet_target, "orchard_planet")
	check(planet_squad.get("ok", false) and planet_game.orchard_planet.casts == 1 and planet_role.essence() == 2 and is_equal_approx(float(planet_game.world_builder.data.mana), 16.0), "Planet skeleton squad spends both currencies after a successful cast")
	check(not planet_role.cast_skeleton(planet_target, "orchard_planet").get("ok", true) and planet_game.orchard_planet.casts == 1, "Planet skeleton squad obeys shared cooldown")
	check(planet_role.start_rat_stream(planet_target, "orchard_planet").get("ok", false), "Planet performance stream starts")
	for i in 300:
		if planet_role.rats.size() >= GodRole.MAX_RATS: break
		if float(planet_game.world_builder.data.mana) < 1.0: planet_game.world_builder.data.mana = 20.0
		planet_role._emit_rat()
	planet_role.stop_rat_stream()
	check(planet_role.rats.size() == GodRole.MAX_RATS, "Planet rat cap is 256")
	var planet_total := 0.0
	var planet_max := 0.0
	for frame in 120:
		var before_tick := Time.get_ticks_usec()
		planet_role.tick(1.0 / 60.0)
		var elapsed_ms := float(Time.get_ticks_usec() - before_tick) / 1000.0
		planet_total += elapsed_ms
		planet_max = maxf(planet_max, elapsed_ms)
	role.stop_rat_stream()
	game.queue_free()
	planet_game.queue_free()
	if failures.is_empty():
		print("GOD_ROLE_CHECKS_PASS ", {"elapsed_seconds": float(Time.get_ticks_msec() - started) / 1000.0, "streamed": resting, "saves": game.world_builder.saves, "flat_256_mean_ms": flat_total / 120.0, "flat_256_max_ms": flat_max, "planet_256_mean_ms": planet_total / 120.0, "planet_256_max_ms": planet_max})
	else:
		for failure in failures: push_error(failure)
		print("GOD_ROLE_CHECKS_FAIL ", failures)
	quit(0 if failures.is_empty() else 1)
