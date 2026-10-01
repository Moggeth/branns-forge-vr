extends SceneTree
## tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://orchard_planet_motion_checks.gd

class FakePlanet extends RefCounted:
	var center := Vector3(10.0, 0.0, -4.0)
	var radius := 85.0
	var raised := 0.0
	var slope := false
	func surface_point(direction: Vector3) -> Vector3:
		var incline := 30.0 * maxf(direction.normalized().x, 0.0) if slope else 0.0
		return center + direction.normalized() * (radius + raised + incline)
	func normal_at(point: Vector3) -> Vector3:
		return (point - center).normalized()
	func height_at(direction: Vector3) -> float:
		return radius + raised

class FakeAdventure extends RefCounted:
	var zone := "orchard_planet"

class FakeGame extends Node3D:
	var rig: Node3D
	var camera: Camera3D
	var adventure := FakeAdventure.new()

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var failures: Array[String] = []
	var game := FakeGame.new()
	root.add_child(game)
	game.rig = Node3D.new()
	game.add_child(game.rig)
	game.camera = Camera3D.new()
	game.rig.add_child(game.camera)
	game.camera.position = Vector3(0.15, 1.65, -0.05)
	var planet := FakePlanet.new()
	game.rig.global_position = planet.center + Vector3.UP * (planet.radius + 0.025)
	var motion = preload("res://orchard_planet_motion.gd").new().setup(planet, game)
	motion.enter()
	motion.tick(1.0 / 60.0)
	if not motion.grounded: failures.append("Starting surface did not ground the rig")
	var starting_feet: Vector3 = game.rig.global_position + (game.camera.global_position - game.rig.global_position).slide(Vector3.UP)
	var starting_pose: Vector3 = game.camera.position
	# A tangent is carried along the great circle through both poles and back.
	var circumference := TAU * planet.radius
	var fraction: float = motion.move(Vector3.FORWARD * circumference)
	var end_feet: Vector3 = game.rig.global_position + (game.camera.global_position - game.rig.global_position).slide(motion.surface_up(game.rig.global_position))
	if fraction < 0.999 or end_feet.distance_to(starting_feet) > 0.25:
		failures.append("A full great circle did not return to the start")
	if game.camera.position != starting_pose: failures.append("XR camera local offset changed during transport")
	if game.rig.global_basis.y.dot(Vector3.UP) < 0.999: failures.append("Rig up did not return after full orbit")
	planet.slope = true
	var slope_start := (game.rig.global_position - planet.center).length()
	if motion.move(Vector3.RIGHT * 2.0) < 0.99:
		failures.append("Walkable radial slope rejected tangent motion")
	if (game.rig.global_position - planet.center).length() < slope_start + 0.4:
		failures.append("Feet did not follow the raised radial slope")
	planet.slope = false
	motion.tick(1.0 / 60.0)
	var wall := StaticBody3D.new()
	wall.collision_layer = 1
	wall.collision_mask = 1
	game.add_child(wall)
	wall.global_position = planet.center + Vector3(4.0, planet.radius + 0.9, 0.0)
	var wall_shape := CollisionShape3D.new()
	var wall_box := BoxShape3D.new()
	wall_box.size = Vector3(0.3, 2.0, 4.0)
	wall_shape.shape = wall_box
	wall.add_child(wall_shape)
	await physics_frame
	if motion.move(Vector3.RIGHT * 5.0) > 0.8:
		failures.append("Oriented capsule crossed a radial wall")
	wall.queue_free()
	await physics_frame
	# Raised terrain must follow the new collider radius, and removing it must
	# permit a fall instead of leaving the player suspended at the old height.
	planet.raised = 1.25
	motion.tick(1.0 / 60.0)
	var raised_radius: float = (game.rig.global_position - planet.center).length()
	if raised_radius < planet.radius + 1.2: failures.append("Raised terrain left the feet buried")
	planet.raised = 0.0
	motion.tick(1.0 / 60.0)
	if motion.grounded: failures.append("Removed ground remained grounded")
	for index in range(60): motion.tick(1.0 / 60.0)
	if not motion.grounded or absf((game.rig.global_position - planet.center).length() - planet.radius - 0.025) > 0.06:
		failures.append("Fall after terrain removal did not land radially")
	if not motion.jump() or motion.jump(): failures.append("Jump did not enforce a single takeoff")
	var peak := (game.rig.global_position - planet.center).length()
	for index in range(120):
		motion.tick(1.0 / 60.0)
		peak = maxf(peak, (game.rig.global_position - planet.center).length())
	if peak < planet.radius + 0.8 or peak > planet.radius + 1.15 or not motion.grounded:
		failures.append("Radial jump apex or landing was wrong")
	# Bottomside rigid bodies keep radial gravity after the Hero leaves. Outside
	# the bounded volume, ordinary world gravity still applies.
	var body := RigidBody3D.new()
	body.collision_layer = 2
	body.collision_mask = 0
	body.can_sleep = false
	game.add_child(body)
	body.global_position = planet.center + Vector3.DOWN * (planet.radius + 4.0)
	var shape := CollisionShape3D.new()
	var sphere := SphereShape3D.new()
	sphere.radius = 0.2
	shape.shape = sphere
	body.add_child(shape)
	for index in range(30): await physics_frame
	if body.linear_velocity.y <= 0.5: failures.append("Bottomside prop did not accelerate toward center")
	var gravity_area_id: int = motion._gravity_area.get_instance_id()
	motion.leave()
	game.adventure.zone = "orchard"
	await physics_frame
	body.global_position = planet.center + Vector3.DOWN * (planet.radius + 4.0)
	body.linear_velocity = Vector3.ZERO
	for index in range(30): await physics_frame
	if body.linear_velocity.y <= 0.5: failures.append("Bottomside prop lost radial gravity after Hero left")
	body.global_position = planet.center + Vector3.DOWN * (planet.radius + 230.0)
	body.linear_velocity = Vector3.ZERO
	for index in range(30): await physics_frame
	if body.linear_velocity.y >= -0.5: failures.append("World gravity did not apply outside planet volume")
	if motion.active() or motion.move(Vector3.RIGHT) != 0.0:
		failures.append("Planet motion remained active in a flat zone")
	game.adventure.zone = "orchard_planet"
	motion.enter()
	if not is_instance_valid(motion._gravity_area) or motion._gravity_area.get_instance_id() != gravity_area_id:
		failures.append("Re-entering planet recreated its gravity volume")
	print("ORCHARD_PLANET_MOTION_RESULT ", JSON.stringify(failures))
	game.queue_free()
	quit(0 if failures.is_empty() else 1)
