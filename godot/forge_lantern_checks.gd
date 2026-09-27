extends SceneTree
## Focused Asset Lab-to-game check. Run with --xr-mode off --script res://forge_lantern_checks.gd.
var game
var failures: Array[String] = []
var checks := 0

func check(ok: bool, message: String) -> void:
	checks += 1
	if not ok:
		failures.append(message)
		print("LANTERN_ASSERT ", message)

func _initialize() -> void:
	run.call_deferred()

func run() -> void:
	game = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	await physics_frame
	game.set_process(false)
	game.smoke = true
	check(not game.forge_lanterns.is_empty(), "at least one authored lantern was registered")
	if "--expect-pair" in OS.get_cmdline_user_args():
		check(game.forge_lanterns.size() == 2, "both independent lantern variants registered")
		if game.forge_lanterns.size() == 2:
			var sol_stand: Node3D = game.collection.homes["forge_lantern_sol"].stand
			var opus_stand: Node3D = game.collection.homes["forge_lantern_opus"].stand
			check(sol_stand.global_position.distance_to(opus_stand.global_position) >= 1.9,
				"comparison stands have separate reach space")
			for home_id in game.collection.homes:
				if str(home_id).begins_with("forge_lantern_"): continue
				var other: Node3D = game.collection.homes[home_id].stand
				check(other.global_position.distance_to(sol_stand.global_position) > 1.45 and
					other.global_position.distance_to(opus_stand.global_position) > 1.45,
					"other collection home does not overlap lantern study: " + str(home_id))
	for lantern in game.forge_lanterns:
		await check_lantern(lantern)
	print("FORGE_LANTERN_RESULT ", JSON.stringify({"checks": checks, "failures": failures,
		"variants": game.forge_lanterns.size()}))
	game.queue_free()
	await process_frame
	quit(0 if failures.is_empty() else 1)

func check_lantern(lantern) -> void:
	var id: String = lantern.id
	var item: Node3D = lantern.item
	check(game.collection.homes.has(id), id + " has a collection home")
	check(is_instance_valid(lantern.grip) and is_instance_valid(lantern.flame), id + " has grip and flame sockets")
	check(is_instance_valid(lantern.hinge) and is_instance_valid(lantern.thumb), id + " has moving shutter and tab")
	check(lantern.hinge.is_ancestor_of(lantern.thumb), id + " shutter tab moves with hinge")
	check(lantern.hinge.find_children("*", "MeshInstance3D", true, false).size() > 2,
		id + " has authored moving shutter geometry")
	check(item.get_meta("ranged", false) and not game.melee.handles(item), id + " does not use melee damage")
	check(lantern.light != null and not lantern.light.shadow_enabled, id + " uses one inexpensive unshadowed light")
	var home = game.collection.homes[id]
	check(item.global_position.distance_to(game.collection.display_position(home)) < 0.01,
		id + " rests at its authored collection height")
	check(absf(item.rotation.y - float(item.get_meta("display_yaw"))) < 0.01,
		id + " faces the approach direction on its stand")
	# Headless OpenXR exposes no tracked controllers; use explicit controller
	# nodes so the same authored per-hand pose path is exercised.
	var hand := XRController3D.new()
	hand.tracker = "left_hand"
	game.rig.add_child(hand)
	hand.position = Vector3(0, 1.35, 0)
	var support := XRController3D.new()
	support.tracker = "right_hand"
	game.rig.add_child(support)
	support.position = Vector3(0.25, 1.35, 0)
	game.grips._attach(hand, item)
	var socket: Node3D = game.hand_socket(hand)
	check(lantern.grip.global_position.distance_to(socket.global_position) < 0.035,
		id + " grip marker sits within 3.5 cm of the held hand")
	check(lantern.trigger(hand), id + " trigger opens shutter")
	for i in range(32): lantern.tick(1.0 / 60.0)
	check(lantern.hinge.rotation.y > 1.5, id + " shutter reaches open pose")
	check(lantern.light.light_energy > 1.9, id + " open shutter illuminates world")
	check(lantern.trigger(hand), id + " trigger closes shutter")
	for i in range(32): lantern.tick(1.0 / 60.0)
	check(lantern.light.light_energy < 0.25, id + " shut lantern falls to ember glow")
	support.global_position = lantern.thumb.global_position
	check(lantern.try_grab_shutter(support, false), id + " other hand grips brass tab")
	# Move the hand along this lantern's authored hinge arc, not a fixed world
	# direction: the two artists placed their tabs on different sides.
	var hinge_origin: Vector3 = lantern.hinge.global_position
	var hinge_axis: Vector3 = lantern.hinge.global_basis.y.normalized()
	support.global_position = hinge_origin + (support.global_position - hinge_origin).rotated(hinge_axis, 0.5)
	for i in range(12): lantern.tick(1.0 / 60.0)
	check(lantern.hinge.rotation.y > 0.15, id + " hand motion moves shutter")
	check(lantern.release(support) and not lantern.busy(support), id + " releases shutter independently")
	game.held.erase(str(hand.get_instance_id()))
	game.grips.grips.erase(str(hand.get_instance_id()))
	item.reparent(game)
	item.rotation = Vector3.ZERO
	item.global_position = Vector3(400, 1.0, 400)
	var table := StaticBody3D.new()
	game.add_child(table)
	table.collision_layer = 1
	table.global_position = Vector3(400, 0.1, 400)
	var table_shape := CollisionShape3D.new()
	table_shape.shape = BoxShape3D.new()
	table_shape.shape.size = Vector3(2, 0.2, 2)
	table.add_child(table_shape)
	game.tool_physics.drop(item, Vector3.ZERO, Vector3.ZERO)
	check(item.has_meta("drop_body"), id + " becomes a physics item when dropped")
	var body: RigidBody3D = item.get_meta("drop_body")
	var shape: CollisionShape3D = body.get_child(body.get_child_count() - 1) as CollisionShape3D
	check(shape != null and shape.shape.get_debug_mesh() != null, id + " drop body has a collision volume")
	for i in range(95): await physics_frame
	check(body.global_position.y > 0.15 and body.global_position.y < 0.40,
		id + " comes to rest on a physical table")
	check(body.linear_velocity.length() < 0.3, id + " settles rather than shaking indefinitely")
	check(game.collection.return_item(id), id + " returns to same stand")
	check(not item.has_meta("drop_body"), id + " leaves no old rigid body after return")
	table.queue_free()
	hand.queue_free()
	support.queue_free()
