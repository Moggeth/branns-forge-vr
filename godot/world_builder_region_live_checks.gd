extends SceneTree
## Real-source summon check in the playable scene. Use -- --world-builder-check
## so main.gd runs offline and never reads or writes the normal player save.
const Spells = preload("res://world_builder_spells.gd")
const CASES = [
	{"zone":"sandstone_quarry", "action":"duelist", "type":"skeleton", "count":1},
	{"zone":"sandstone_quarry", "action":"golem", "type":"golem", "count":1},
	{"zone":"pinewood_ruins", "action":"shield_patrol", "type":"skeleton", "count":2},
	{"zone":"pinewood_ruins", "action":"ghosts", "type":"ghost", "count":2},
	{"zone":"orchard_highlands", "action":"patrol", "type":"skeleton", "count":3},
	{"zone":"orchard_highlands", "action":"rat_swarm", "type":"rat", "count":3},
]

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		print("WORLD_BUILDER_REGION_LIVE_RESULT ", JSON.stringify({"failures": ["required offline --world-builder-check flag absent"]}))
		quit(2)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var builder: Node = game.world_builder
	if builder == null:
		failures.append("live world builder absent")
		_finish(failures)
		return
	builder.test_mode = true
	builder.data = builder.fresh_state()
	var spawned := {}
	for spec in CASES:
		var zone := str(spec.zone)
		var action := str(spec.action)
		await game.adventure.travel(zone)
		if str(game.adventure.zone) != zone:
			failures.append("live Hero could not enter %s" % zone)
			continue
		var center: Vector3 = game.scene.zones[zone].center
		game.camera.global_position = center + Vector3(0, 2.0, 80.0 if zone == "orchard_highlands" else 13.0)
		builder.data.mana = 20.0
		builder.data.spell_cooldowns.clear()
		await physics_frame
		var point := _find_site(builder, center, zone, action)
		if point == Vector3.INF:
			failures.append("no safe real floor for %s in %s" % [action, zone])
			continue
		var before := float(builder.data.mana)
		var error: String = builder.summon_encounter(action, point, zone)
		if error != "":
			failures.append("cast %s in %s: %s" % [action, zone, error])
			continue
		var cost := float(Spells.entry(action).get("mana", 0.0))
		if absf(float(builder.data.mana) - (before - cost)) > 0.001: failures.append("Mana cost %s" % action)
		var threat: Dictionary = builder.data.threats.back()
		if str(threat.zone) != zone or str(threat.kind) != action: failures.append("saved zone/kind %s" % action)
		builder.tick(2.1)
		if str(threat.state) != "active":
			failures.append("warning did not activate %s" % action)
			continue
		var id := str(int(threat.id))
		var units: Array = builder.summoned_nodes.get(id, [])
		if units.size() != int(spec.count):
			failures.append("wrong live actor count %s: %d" % [action, units.size()])
			continue
		spawned[action] = units
		for unit in units:
			_check_actor(game, zone, action, str(spec.type), unit.node, failures)
	if spawned.has("ghosts"):
		var ghost: Node3D = spawned.ghosts[0].node
		var hp := float(ghost.get_meta("hp", -1.0))
		game.firecraft.hurt_ghost(ghost, 1.0, "physical")
		if absf(float(ghost.get_meta("hp", -1.0)) - hp) > 0.001: failures.append("physical hit damaged a fire-only ghost")
		game.firecraft.hurt_ghost(ghost, 1.0, "fire")
		if float(ghost.get_meta("hp", hp)) >= hp: failures.append("fire failed to damage a ghost")
	if spawned.has("rat_swarm"):
		var rat: Node3D = spawned.rat_swarm[0].node
		game._kill_rat(rat)
		if bool(rat.get_meta("alive", true)): failures.append("real rat kill did not resolve")
		var tail_found := false
		for tail in get_nodes_in_group("pickup"):
			if tail is Node3D and str(tail.get_meta("kind", "")) == "tail" and str(tail.get_meta("id", "")) == str(rat.get_meta("id", "")):
				tail_found = tail.get_parent() == game.adventure.zone_groups.orchard_highlands
		if not tail_found: failures.append("summoned rat tail was not left in its own region")
	var roundtrip: Variant = builder._canonical_state(JSON.parse_string(JSON.stringify(builder.data)))
	if not builder._valid(roundtrip): failures.append("six real encounter records failed JSON validation")
	game.queue_free()
	await process_frame
	_finish(failures)

func _find_site(builder: Node, center: Vector3, zone: String, action: String) -> Vector3:
	var offsets: Array = [-9.0, -6.0, -3.0, 0.0, 3.0, 6.0, 9.0]
	if zone == "orchard_highlands": offsets = [-45.0, -30.0, -15.0, 0.0, 15.0, 30.0, 45.0]
	for x in offsets:
		for z in offsets:
			var point := center + Vector3(float(x), 0.0, float(z))
			if builder.encounter_target_error(action, point, zone) == "": return point
	return Vector3.INF

func _check_actor(game: Node3D, zone: String, action: String, expected_type: String, actor: Node3D, failures: Array[String]) -> void:
	if not is_instance_valid(actor): failures.append("missing actor %s" % action); return
	if str(actor.get_meta("zone", "")) != zone or actor.get_parent() != game.adventure.zone_groups[zone]: failures.append("actor left its region %s" % action)
	if not bool(actor.get_meta("alive", false)) or not actor.visible: failures.append("actor not alive %s" % action)
	var type := str(actor.get_meta("enemy_type", "rat"))
	if type != expected_type: failures.append("wrong gameplay type %s: %s" % [action, type])
	if expected_type == "rat":
		if not game.scene.rats.has(actor) or not game.animation.actors.has(actor.get_instance_id()): failures.append("rat absent from real rat simulation/animation")
	elif expected_type == "ghost":
		if not game.firecraft.ghosts.has(actor) or not game.scene.enemies.has(actor): failures.append("ghost absent from Firecraft combat source")
	else:
		if not game.scene.enemies.has(actor) or not game.animation.actors.has(actor.get_instance_id()): failures.append("enemy absent from Adventure/ActorAnimation %s" % action)
		if float(actor.get_meta("hp", 0.0)) <= 0.0 or float(actor.get_meta("max_hp", 0.0)) <= 0.0: failures.append("enemy lacks combat health %s" % action)
		if expected_type == "golem" and not game.animation.golem_runtime.entries.has(actor.get_instance_id()): failures.append("golem lacks modular gameplay adapter")

func _finish(failures: Array[String]) -> void:
	print("WORLD_BUILDER_REGION_LIVE_RESULT ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)
