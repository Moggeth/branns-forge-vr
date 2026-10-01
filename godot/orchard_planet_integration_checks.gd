extends RefCounted
## Offline real-game acceptance: spherical travel, grounding, spells, economy,
## shared survey world and returning to ordinary terrain. Never reads live saves.
var failures: Array[String] = []

func check(value: bool, message: String) -> void:
	if not value: failures.append(message)

func run(game) -> void:
	var started := Time.get_ticks_usec()
	await game.get_tree().process_frame
	game.set_process(false)
	check(game.diagnostic_offline, "diagnostic must disable live service and saves")
	# Enter through the foggy Orchard to catch stale environment state.
	await game.adventure.travel("orchard_highlands")
	await game.adventure.travel("orchard_planet")
	await game.get_tree().physics_frame
	var planet = game.orchard_planet
	check(game.adventure.zone == "orchard_planet", "new destination did not arrive")
	check(planet.built, "lazy planet not built")
	check(not game.get_node("AdventureEnvironment").environment.fog_enabled, "flat Orchard fog leaked into planet atmosphere")
	check(game.orchard_planet_motion.active(), "radial motion inactive")
	for i in 30: game.orchard_planet_motion.tick(1.0/90.0)
	check(game.orchard_planet_motion.grounded, "arrival does not stand on physical ground")
	var arrival_up: Vector3 = (game.rig.global_position-planet.center).normalized()
	var ray := PhysicsRayQueryParameters3D.create(planet.center+arrival_up*(planet.radius+14), planet.center+arrival_up*(planet.radius-14), 1)
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
	check(not hit.is_empty() and planet.terrain.is_ancestor_of(hit.get("collider")), "terrain outside ray missed actual collider")
	if not hit.is_empty(): check(hit.normal.dot(arrival_up)>0.7, "terrain triangles face inward")
	var feet_before: Vector3 = game.rig.global_position
	game.orchard_planet_motion.move(-game.rig.global_basis.z*0.4)
	check(game.rig.global_position.distance_to(feet_before)>0.05, "FPS is stuck against planet ground")
	var view = preload("res://world_builder_view.gd").new()
	view.visible = false
	game.add_child(view)
	view.setup(game, game.world_builder)
	check(view.tactical_viewport.world_3d == game.get_world_3d(), "RTS disconnected from Hero world")
	check(view.current_zone == "orchard_planet", "survey is in wrong region")
	view._position_camera()
	var point: Vector3 = planet.surface_point(Vector3(0.65,0.4,-0.3).normalized())
	var before: float = planet.fields.height_at((point-planet.center).normalized())
	var result: Dictionary = planet.cast("raise", point)
	check(result.get("ok", false), "Raise Earth failed")
	check(planet.fields.height_at((point-planet.center).normalized()) > before+1.0, "spell has no real topology")
	result = planet.cast("ring", point)
	check(result.get("ok", false) and result.get("placed",0)>0, "Tree Ring did not place actual trees")
	result = planet.cast("meteor", point)
	check(result.get("ok", false) and result.get("placed",0)==4, "Starfall ore missing")
	result = planet.cast("patrol", point)
	check(result.get("ok", false) and result.get("spawned",0)==3, "planet summons unavailable")
	for i in 60:
		planet.tick(1.0/60.0)
		await game.get_tree().process_frame
	for actor in planet.gameplay.actors:
		check(actor.global_basis.y.normalized().dot((actor.global_position-planet.center).normalized())>0.75, "creature has flat-world orientation")
	# Sample both hemispheres, including the antipodal south pole. The tracked
	# camera remains local to the rig, rather than being turned independently.
	for direction in [Vector3.RIGHT, Vector3.DOWN, Vector3.BACK]:
		game.rig.global_basis = Basis(Quaternion(Vector3.UP, direction))
		game.rig.global_position = planet.surface_point(direction)+direction*0.12
		game.orchard_planet_motion.grounded = false
		game.orchard_planet_motion.vertical_speed = 0.0
		for i in 12: game.orchard_planet_motion.tick(1.0/90.0)
		check(game.rig.global_basis.y.dot(direction)>0.98, "up flips at globe hemisphere")
		check(game.orchard_planet_motion.surface_up(game.camera.global_position).dot(direction)>0.98, "HMD is detached from local up")
		check(game.gravity_direction_at(game.rig.global_position).dot(-direction)>0.98, "gravity still world down")
		if game.orchard_planet_motion.grounded:
			check(game.orchard_planet_motion.jump(), "jump unavailable on southern side")
			game.orchard_planet_motion.tick(0.05)
			check(game.orchard_planet_motion.vertical_speed>0, "jump went into surface")
	await game.adventure.travel("forge_yard")
	check(game.adventure.zone=="forge_yard" and not game.orchard_planet_motion.active(), "cannot return to ordinary world")
	check(game.rig.global_basis.y.dot(Vector3.UP)>0.99, "planet tilt persisted outside globe")
	view.queue_free()
	print("ORCHARD_PLANET_INTEGRATION_RESULT ", JSON.stringify(failures), " seconds=", (Time.get_ticks_usec()-started)/1000000.0)
	game.get_tree().quit(0 if failures.is_empty() else 1)
