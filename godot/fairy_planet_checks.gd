extends SceneTree
## tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://fairy_planet_checks.gd

class FakeAdventure extends RefCounted:
	var zone := "orchard_planet"

class FakePlanet extends RefCounted:
	var center := Vector3(100.0, 0.0, 0.0)
	var radius := 85.0
	func height_at(_direction: Vector3) -> float:
		return radius

class FakeGame extends Node3D:
	var adventure := FakeAdventure.new()
	var orchard_planet := FakePlanet.new()
	var camera: Camera3D
	var player_avatar = null
	var animation = null
	func local_up_at(point: Vector3) -> Vector3:
		return (point - orchard_planet.center).normalized() if adventure.zone == "orchard_planet" else Vector3.UP

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var failures: Array[String] = []
	var game := FakeGame.new()
	root.add_child(game)
	game.camera = Camera3D.new()
	game.add_child(game.camera)
	game.camera.global_position = game.orchard_planet.center + Vector3.DOWN * (game.orchard_planet.radius + 1.7)
	game.camera.global_basis = Basis.looking_at(Vector3.FORWARD, Vector3.DOWN)
	var fairy := preload("res://fairy_coop.gd").new()
	game.add_child(fairy)
	fairy.game = game
	fairy.avatar = CharacterBody3D.new()
	game.add_child(fairy.avatar)
	fairy.avatar.global_position = game.camera.global_position
	if fairy.pocket().distance_to(game.camera.global_position) > 0.8:
		failures.append("Bottomside pocket offset is not local to the host")
	if fairy._below_world(fairy.avatar.global_position):
		failures.append("Healthy bottomside fairy was killed by global Y")
	if not fairy._below_world(game.orchard_planet.center + Vector3.DOWN * 60.0):
		failures.append("Underground radial boundary was not detected")
	fairy._align_to_host()
	if fairy.orientation.y.dot(Vector3.DOWN) < 0.999:
		failures.append("Respawn orientation is not radially upright")
	fairy.turn(0.4, 0.2, 0.0)
	if fairy.orientation.y.dot(Vector3.DOWN) < 0.9:
		failures.append("Planet yaw/pitch lost the local up frame")
	fairy.acro = true
	fairy.turn(0.0, 0.0, 0.3)
	var rolled_up: Vector3 = fairy.orientation.y
	fairy.avatar.global_position = game.orchard_planet.center + Vector3.RIGHT * (game.orchard_planet.radius + 1.7)
	fairy._align_planet_flight()
	if fairy.orientation.y.dot(rolled_up) > 0.2:
		failures.append("Acrobatic orientation did not parallel transport around globe")
	if fairy.last_planet_up.dot(Vector3.RIGHT) < 0.999:
		failures.append("Transported radial normal did not update")
	var enemy := Node3D.new()
	game.add_child(enemy)
	enemy.global_position = game.camera.global_position
	if (fairy.head_position(enemy) - enemy.global_position).dot(Vector3.DOWN) < 1.4:
		failures.append("Enemy head offset used world Y on bottomside")
	var bond := preload("res://fairy_bond.gd").new()
	game.add_child(bond)
	bond.fairy = fairy
	bond.shoulder = Node3D.new()
	game.add_child(bond.shoulder)
	bond.update_shoulder()
	if bond.shoulder.global_basis.y.dot(Vector3.DOWN) < 0.999:
		failures.append("Shoulder perch remained world upright")
	game.adventure.zone = "forge_yard"
	if fairy._on_planet() or not fairy._below_world(Vector3(0.0, -13.0, 0.0)):
		failures.append("Flat-zone boundary changed")
	print("FAIRY_PLANET_RESULT ", JSON.stringify(failures))
	game.queue_free()
	quit(0 if failures.is_empty() else 1)
