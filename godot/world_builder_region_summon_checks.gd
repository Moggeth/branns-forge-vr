extends SceneTree
## Offline, save-isolated region and encounter contract. No playable scene starts.
const Builder = preload("res://world_builder_runtime.gd")
const Spells = preload("res://world_builder_spells.gd")
const W = preload("res://world_zones.gd")
const Encounters = preload("res://world_builder_encounters.gd")

class FlatTerrain extends RefCounted:
	func height_at(_point: Vector2) -> float: return 0.0
	func water_at(_point: Vector2) -> float: return 0.0

class TestGame extends Node3D:
	var scene := {"zones": {}, "enemies": [], "rats": []}
	var adventure := {"zone": "pinewood_ruins", "zone_groups": {}}
	var camera: Camera3D
	var landscape := FlatTerrain.new()
	var elapsed := 0.0
	var animation: Node

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game := TestGame.new()
	root.add_child(game)
	game.camera = Camera3D.new()
	game.add_child(game.camera)
	game.animation = Node.new()
	game.add_child(game.animation)
	for spec in [["pinewood_ruins", Vector3(-52, 0, 0), 15.0], ["orchard_highlands", Vector3(-360, 0, 0), 160.0]]:
		var zone: String = spec[0]
		var center: Vector3 = spec[1]
		var extent: float = spec[2]
		var group := Node3D.new()
		group.name = zone
		game.add_child(group)
		game.adventure.zone_groups[zone] = group
		game.scene.zones[zone] = {"center": center, "name": zone}
		if zone == "pinewood_ruins": W.body(group, center + Vector3(0, -0.25, 0), Vector3(extent * 2.0, 0.5, extent * 2.0), "floor")
	game.camera.global_position = Vector3(-52, 1.8, 11)
	var builder: Node = Builder.new()
	game.add_child(builder)
	builder.game = game
	builder.center = Vector3(-360, 0, 0)
	builder.data = Builder.fresh_state()
	builder.test_mode = true
	builder.encounters = Encounters.new()
	game.add_child(builder.encounters)
	builder.encounters.setup(builder)
	await physics_frame
	for entry in builder.spell_catalogue():
		if not entry.has("regions"): failures.append("action lacks explicit region capability: " + str(entry.id))
	for action in ["patrol", "duelist", "shield_patrol", "rat_swarm", "ghosts", "golem"]:
		if not Spells.supports_region(action, "pinewood_ruins"): failures.append("encounter not portable: " + action)
	if Spells.supports_region("raise", "pinewood_ruins"): failures.append("Orchard terraforming leaked into Pinewood")
	var target := Vector3(-52, 0, -3)
	if builder.encounter_target_error("patrol", target) != "": failures.append("walkable Pinewood floor was rejected")
	var before := float(builder.data.mana)
	if builder.encounter_target_error("ghosts", Vector3(-52, 0, 10)) == "": failures.append("Hero overlap accepted")
	if builder.encounter_target_error("ghosts", Vector3(-36, 0, -3)) == "": failures.append("boundary accepted")
	if float(builder.data.mana) != before: failures.append("invalid targeting spent Mana")
	W.body(game.adventure.zone_groups.pinewood_ruins, Vector3(-46, 0.8, -3), Vector3(1.5, 1.6, 1.5), "solid")
	await physics_frame
	if builder.encounter_target_error("duelist", Vector3(-46, 0, -3)) == "": failures.append("solid overlap accepted")
	if float(builder.data.mana) != before: failures.append("blocked site spent Mana")
	var error: String = builder.summon_encounter("patrol", target)
	if error != "": failures.append("valid summon failed: " + error)
	elif builder.data.threats.size() != 1 or str(builder.data.threats[0].zone) != "pinewood_ruins" or str(builder.data.threats[0].kind) != "patrol": failures.append("summon lost region or kind")
	if absf(float(builder.data.mana) - (before - 4.0)) > 0.001: failures.append("valid summon cost mismatch")
	game.camera.global_position = target + Vector3(0, 1.8, 0)
	if builder._threat_clear_of_hero(builder.data.threats[0]): failures.append("warning would spawn through Hero")
	game.camera.global_position = Vector3(-52, 1.8, 11)
	var delay := float(builder.data.threats[0].delay)
	game.adventure.zone = "orchard_highlands"
	builder._sync_threats(10.0)
	if float(builder.data.threats[0].delay) != delay: failures.append("inactive region warning consumed tick budget")
	var legacy := Builder.fresh_state()
	legacy.threats = [{"id": 6, "at": [10.0, 10.0], "state": "active", "alive": [0, 1, 2]}]
	if not builder._valid(legacy): failures.append("legacy Orchard patrol rejected")
	var migrated: Dictionary = builder._canonical_state(legacy)
	if not builder._valid(migrated) or str(migrated.threats[0].zone) != "orchard_highlands" or str(migrated.threats[0].kind) != "patrol": failures.append("legacy patrol zone migration failed")
	if not builder._valid(builder.data): failures.append("new region state invalid")
	var path := "user://world_builder_region_summon_%d.json" % Time.get_ticks_usec()
	builder.save_path = path
	builder.test_mode = false
	if not builder.save(): failures.append("isolated region save failed")
	builder.data = Builder.fresh_state()
	builder._load()
	if builder.data.threats.size() != 1 or str(builder.data.threats[0].zone) != "pinewood_ruins" or str(builder.data.threats[0].kind) != "patrol" or not builder.data.threats[0].has("at_y"): failures.append("region summon lost on reload")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	print("WORLD_BUILDER_REGION_SUMMON_RESULT ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)
