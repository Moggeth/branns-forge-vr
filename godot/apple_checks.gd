extends SceneTree
## Actual-world fixture: tree target, wobble, detachment, rigid collision, grip and eating.
var failures: Array = []
var checks := 0
var game

func check(ok: bool, label: String):
	checks += 1
	if not ok:
		failures.append(label)
		print("APPLE_ASSERT ", label)

func _initialize(): run.call_deferred()

func run():
	game = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	await physics_frame
	game.set_process(false)
	game.smoke = true
	game.adventure.travel("orchard_highlands")
	var orchard: Array = game.apples.entries.filter(func(e): return e.zone == "orchard_highlands" and e.source != null)
	print("ORCHARD_PHYSICAL_APPLES count=",orchard.size())
	check(orchard.size() >= 16, "expanded orchard fruit remain reachable")
	var entry: Dictionary = orchard[0]
	var p: Vector3 = entry.collider.global_position
	var ray = PhysicsRayQueryParameters3D.create(p + Vector3(0, 0, 0.5), p - Vector3(0, 0, 0.5), 1)
	var hit = game.get_world_3d().direct_space_state.intersect_ray(ray)
	# A neighbouring fruit can legitimately be closer along this ray in a
	# denser grove. Validate the struck collider is an apple, not an exact index.
	var ray_hits_apple := false
	for candidate in game.apples.entries:
		if candidate.collider == hit.get("collider"): ray_hits_apple = true; break
	check(not hit.is_empty() and ray_hits_apple, "a bolt ray can hit an apple")
	game.apples.impact(entry.collider, 1.1, p, Vector3.RIGHT)
	check(entry.state == "attached" and absf(entry.wobble_speed) > 0.1, "a light hit jiggles without detaching")
	game.apples.tick(0.06)
	check(absf(entry.wobble) > 0.001, "jiggle visibly moves its attached instance")
	game.elapsed += 0.3
	var fallen = game.apples.impact(entry.collider, 42, p, Vector3.FORWARD * 42)
	check(fallen is RigidBody3D and entry.state == "loose" and entry.collider.collision_layer == 0, "a crossbow-speed hit knocks fruit loose")
	check(fallen.linear_velocity.length() > 5 and fallen.collision_layer == 8, "fallen apple carries shot momentum and has rigid collision")
	var hand = Node3D.new()
	game.add_child(hand)
	hand.global_position = fallen.global_position
	check(game.apples.try_grab(hand), "loose apple can be taken in hand")
	check(game.held.get(str(hand.get_instance_id())) == fallen and entry.state == "held", "grip owns the apple")
	game.adventure.hp = 37
	for bite in 3:
		game.elapsed += 0.4
		game.apples.bite(hand)
	check(entry.state == "eaten" and game.adventure.hp == 77, "three crunchy bites heal 40")
	game.elapsed += game.apples.REGROW_SECONDS + 0.1
	game.apples.tick(0.016)
	check(entry.state == "attached" and entry.collider.collision_layer == 1, "eaten fruit regrows on its tree")
	hand.global_position = entry.collider.global_position
	check(game.apples.try_grab(hand), "regrown fruit can be picked again")
	var mouth: Vector3 = game.camera.global_position + game.camera.global_basis * Vector3(0, -0.10, -0.12)
	hand.global_position = mouth - hand.global_basis * Vector3(0, -0.025, -0.055)
	game.adventure.hp = 50
	for bite in 3:
		game.elapsed += 0.4
		game.apples.tick(0.016)
	check(entry.state == "eaten" and game.adventure.hp == 90, "near-mouth gesture eats and heals without trigger")
	var bolt_target: Dictionary = orchard[2]
	var bolt = Node3D.new()
	game.add_child(bolt)
	bolt.global_position = bolt_target.collider.global_position + Vector3(0, 0, 0.44)
	bolt.set_meta("tip", Vector3.ZERO)
	game.siegebird.projectiles.append({"node": bolt, "velocity": Vector3(0, 0, -44), "hand": hand,
		"until": game.elapsed + 2.0, "zone": game.adventure.zone, "module": "", "truesight_at_fire": false,
		"grapple": false, "weapon": {}, "damage": 95.0})
	game.siegebird.tick(0.016)
	check(bolt_target.state == "loose" and is_instance_valid(bolt_target.body), "fired Siegebird bolt detaches apple")
	check(game.siegebird.projectiles.is_empty(), "bolt stops at struck apple")
	var other: Dictionary = orchard[1]
	var thrown = RigidBody3D.new()
	game.add_child(thrown)
	thrown.linear_velocity = Vector3.RIGHT * 4
	game.apples.on_tool_contact(thrown, other.collider)
	check(other.state == "loose" and is_instance_valid(other.body), "a thrown physical object can knock fruit free")
	print("APPLE_CHECK_RESULT ", JSON.stringify({"checks": checks, "failures": failures, "fruit": game.apples.entries.size()}))
	quit(0 if failures.is_empty() else 1)
