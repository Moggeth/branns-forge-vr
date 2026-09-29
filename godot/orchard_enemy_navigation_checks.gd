extends SceneTree

const Adventure = preload("res://adventure_runtime.gd")
const Navigation = preload("res://landscape_navigation.gd")

class FakeLandscape:
	extends RefCounted
	var model: Dictionary
	var transition: Dictionary = {}
	var edits := 0
	func operation_count() -> int: return edits

class FakeGame:
	extends Node3D
	var scene: Dictionary = {}
	var landscape: FakeLandscape
	var elapsed := 0.0

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var heights := PackedFloat32Array()
	var traversability := PackedFloat32Array()
	heights.resize(169)
	traversability.resize(169)
	traversability.fill(1.0)
	var model := {"size": 13,"step": 1.0,"origin": Vector2.ZERO,
		"height": heights,"traversability": traversability}
	var terrain := FakeLandscape.new()
	terrain.model = model
	var game := FakeGame.new()
	root.add_child(game)
	var zone := Node3D.new()
	zone.name = "orchard_highlands"
	game.add_child(zone)
	game.scene = {"zones": {"orchard_highlands": {"root": zone}}}
	game.landscape = terrain
	var enemy := Node3D.new()
	zone.add_child(enemy)
	enemy.position = Vector3(4, 0, 6)
	enemy.set_meta("zone","orchard_highlands")
	enemy.set_meta("enemy_type","skeleton")
	var target := Vector3(8, 0, 6)
	var adventure := Adventure.new()
	game.add_child(adventure)
	adventure.game = game
	var initial: Dictionary = adventure._orchard_pursuit(enemy, target)
	if not bool(initial.available) or float(initial.remaining) > 5.0: failures.append("flat initial pursuit")
	for z in range(2, 11): heights[z * 13 + 6] = 4.0
	model.height = heights
	terrain.model = model
	terrain.edits = 1
	terrain.transition = {"bounds": Rect2(Vector2(5,2), Vector2(2,9))}
	var during: Dictionary = adventure._orchard_pursuit(enemy, target)
	if bool(during.available): failures.append("enemy moved during dirty edit")
	terrain.transition = {}
	game.elapsed = 1.0
	var rerouted: Dictionary = adventure._orchard_pursuit(enemy, target)
	if not bool(rerouted.available) or float(rerouted.remaining) <= 8.0: failures.append("ravine did not cause detour")
	var state: Dictionary = enemy.get_meta("orchard_nav", {})
	var path: Array[Vector2] = state.get("path", [])
	if not Navigation.path_passable(model, path): failures.append("new route crossed ravine")
	var started := Time.get_ticks_usec()
	var reached := false
	for frame in 140:
		game.elapsed += 0.2
		var motion: Dictionary = adventure._orchard_pursuit(enemy, target)
		if not bool(motion.available): failures.append("route vanished during pursuit"); break
		enemy.global_position += motion.direction * 0.4
		var x := roundi(enemy.position.x)
		var z := roundi(enemy.position.z)
		if x == 6 and z >= 2 and z <= 10: failures.append("enemy entered ravine"); break
		if enemy.position.distance_to(target) < 0.6: reached = true; break
	if not reached: failures.append("enemy did not reach target around ravine")
	print("ORCHARD_ENEMY_NAV_RESULT failures=",failures," travel_ms=",snappedf(float(Time.get_ticks_usec()-started)/1000.0,0.001))
	quit(0 if failures.is_empty() else 1)
