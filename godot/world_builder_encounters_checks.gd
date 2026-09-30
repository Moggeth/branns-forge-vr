extends SceneTree
## Pure offline ledger tests; no main scene, services, player data or save writes.
const Encounters = preload("res://world_builder_encounters.gd")

class MockBuilder extends Node:
	var center := Vector3.ZERO
	var data := {"mana": 10.0, "wood": 1, "encounter_history": []}
	func _unpack(value: Array) -> Vector3:
		return Vector3(float(value[0]), 0.0, float(value[1]))
	func _point_valid(value: Variant) -> bool:
		return value is Array and value.size() == 2 and (value[0] is int or value[0] is float) and (value[1] is int or value[1] is float) and is_finite(float(value[0])) and is_finite(float(value[1]))

func _initialize() -> void:
	call_deferred("_check")

func _new_threat(id: int, x: int, z: int, objective: String) -> Dictionary:
	return {"id": id, "at": [x, z], "state": "active", "alive": [0, 1, 2], "objective": objective, "elapsed": 0.0, "kills": [], "contained": true}

func _finish(encounters: Node, threat: Dictionary, enemy: Node3D, order: Array = [0, 1, 2]) -> Dictionary:
	for slot in order:
		encounters.unit_down(threat, int(slot), enemy)
		threat.alive.erase(slot)
	return encounters.complete(threat)

func _check() -> void:
	var failures: Array[String] = []
	var builder := MockBuilder.new()
	root.add_child(builder)
	var encounters: Node = Encounters.new()
	root.add_child(encounters)
	encounters.setup(builder)
	var enemy := Node3D.new()
	root.add_child(enemy)
	var first := _new_threat(1, 0, 0, "contain")
	if encounters.complete(first).awarded: failures.append("incomplete patrol rewarded")
	enemy.global_position = Vector3(0, 0, 0)
	var result: Dictionary = _finish(encounters, first, enemy)
	if not result.awarded or builder.data.encounter_history.size() != 1 or absf(float(builder.data.mana) - 12.0) > 0.01 or int(builder.data.wood) != 2: failures.append("first completed objective failed atomic reward")
	if encounters.complete(first).awarded or builder.data.encounter_history.size() != 1: failures.append("duplicate patrol paid twice")
	var same_cell := _new_threat(2, 12, 12, "swift")
	same_cell.elapsed = 5.0
	enemy.global_position = Vector3(12, 0, 12)
	if _finish(encounters, same_cell, enemy).awarded: failures.append("same area repeat paid progression")
	var too_slow := _new_threat(3, 48, 0, "swift")
	too_slow.elapsed = 46.0
	enemy.global_position = Vector3(48, 0, 0)
	if _finish(encounters, too_slow, enemy).awarded: failures.append("failed time objective paid")
	var wrong_order := _new_threat(4, 72, 0, "captain_last")
	enemy.global_position = Vector3(72, 0, 0)
	if _finish(encounters, wrong_order, enemy, [1, 0, 2]).awarded: failures.append("failed order objective paid")
	var offsite := _new_threat(5, 96, 0, "contain")
	enemy.global_position = Vector3(119, 0, 0)
	if _finish(encounters, offsite, enemy).awarded: failures.append("failed location objective paid")
	var varied := _new_threat(6, 48, 24, "captain_last")
	enemy.global_position = Vector3(48, 0, 24)
	if not _finish(encounters, varied, enemy, [0, 2, 1]).awarded or builder.data.encounter_history.size() != 2 or int(builder.data.wood) != 3: failures.append("varied order/location bonus failed")
	var legacy := {"id": 7, "at": [120, 0], "state": "active", "alive": []}
	if encounters.complete(legacy).awarded: failures.append("legacy incomplete metadata rewarded")
	var malformed := _new_threat(8, 120, 0, "swift")
	malformed.kills = [0, 0, 1]
	malformed.alive = []
	if encounters.complete(malformed).awarded or Encounters.valid_threat(malformed): failures.append("duplicate unit kill accepted")
	var before: Dictionary = builder.data.duplicate(true)
	var full := _new_threat(9, 144, 0, "swift")
	full.kills = [0, 1, 2]
	full.alive = []
	builder.data.mana = 20.0
	builder.data.wood = 200
	if encounters.complete(full).awarded or builder.data.encounter_history.size() != 2: failures.append("full resources consumed ledger without reward")
	builder.data = before.duplicate(true)
	var invalid_resources := _new_threat(10, 144, 24, "swift")
	invalid_resources.kills = [0, 1, 2]
	invalid_resources.alive = []
	builder.data.mana = NAN
	if encounters.complete(invalid_resources).awarded or builder.data.encounter_history.size() != 2: failures.append("invalid resources mutated completion ledger")
	builder.data = before.duplicate(true)
	var forged: Array = builder.data.encounter_history.duplicate(true)
	forged.append(forged[0].duplicate(true))
	if Encounters.valid_history(forged): failures.append("duplicate history accepted")
	var capped: Array = []
	for i in 41: capped.append({"id": i, "cell": "%d:0" % i, "objective": "swift", "mana": 2.0, "wood": 0})
	if Encounters.valid_history(capped): failures.append("unbounded history accepted")
	if not Encounters.valid_history(builder.data.encounter_history): failures.append("valid history rejected")
	var roundtrip: Variant = JSON.parse_string(JSON.stringify(builder.data))
	if not roundtrip is Dictionary or not Encounters.valid_history(roundtrip.encounter_history): failures.append("completed reward history failed JSON round-trip")
	else:
		builder.data = roundtrip
		builder.data.wood = float(builder.data.wood)
		var restored: Variant = JSON.parse_string(JSON.stringify(_new_threat(11, 144, 24, "swift")))
		restored.kills = [0.0, 1.0, 2.0]
		restored.alive = []
		if not Encounters.valid_threat(restored) or not encounters.complete(restored).awarded: failures.append("restored whole-number wood/kills blocked valid reward")
	var fractional: Variant = JSON.parse_string(JSON.stringify(builder.data.encounter_history))
	fractional[0].id = 1.5
	if Encounters.valid_history(fractional): failures.append("fractional reward id accepted")
	fractional[0].id = 1.0
	fractional[0].wood = 0.5
	if Encounters.valid_history(fractional): failures.append("fractional lumber reward accepted")
	var fractional_threat := _new_threat(12, 144, 48, "contain")
	fractional_threat.kills = [0.5]
	if Encounters.valid_threat(fractional_threat): failures.append("fractional kill slot accepted")
	if OS.get_cmdline_user_args().has("--integration"):
		await _real_patrol(failures)
	print("WORLD_BUILDER_ENCOUNTERS_RESULT ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)

func _real_patrol(failures: Array[String]) -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var builder: Node = game.world_builder
	if builder == null: failures.append("live builder absent"); return
	builder.test_mode = true
	builder.data = builder.fresh_state()
	builder.data.mana = 20.0
	var at := Vector3(42, 0, 42)
	var error: String = builder.summon_patrol(at)
	if error != "" or builder.data.threats.size() != 1: failures.append("live patrol summon: " + error); return
	var threat: Dictionary = builder.data.threats[0]
	if not Encounters.valid_threat(threat): failures.append("live patrol objective metadata invalid"); return
	builder._sync_threats(1.8)
	if str(threat.state) != "active": failures.append("live patrol never activated"); return
	var id := str(int(threat.id))
	if not builder.summoned_nodes.has(id): failures.append("live patrol actors absent"); return
	var units: Array = builder.summoned_nodes[id]
	var order: Array = [0, 2, 1] if str(threat.objective) == "captain_last" else [0, 1, 2]
	var checked_active := false
	for slot in order:
		for unit in units:
			if int(unit.slot) != int(slot): continue
			unit.node.global_position = builder.center + at
			unit.node.set_meta("alive", false)
			builder._sync_threats(0.1)
			if not checked_active:
				checked_active = true
				var active_save: Variant = builder._canonical_state(JSON.parse_string(JSON.stringify(builder.data)))
				if not builder._valid(active_save) or active_save.threats.size() != 1 or not Encounters.valid_threat(active_save.threats[0]): failures.append("active patrol objective failed full builder JSON reload")
	if builder.data.threats.size() != 0 or builder.data.encounter_history.size() != 1:
		failures.append("live completed patrol did not earn one keyed reward")
	elif not str(builder.progress_message).contains("objective complete"):
		failures.append("live patrol reward message absent")
	var completed_save: Variant = builder._canonical_state(JSON.parse_string(JSON.stringify(builder.data)))
	if not builder._valid(completed_save) or completed_save.encounter_history.size() != 1: failures.append("rewarded patrol failed full builder JSON reload")
	else:
		builder.data = completed_save
		var preserved_wood := int(builder.data.wood)
		if builder.encounters.complete(threat).awarded or int(builder.data.wood) != preserved_wood or builder.data.encounter_history.size() != 1: failures.append("rewarded patrol paid again after JSON reload")
