extends SceneTree
## Run against the same live scene used by the native launcher, with service I/O disabled.
const Layout = preload("res://smithy_layout.gd")
const Terrain = preload("res://terrain_safety.gd")

var failures: Array[String] = []
var route_probes := 0
var game: Node3D

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview"):
		push_error("Smithy checks require --world-builder-preview to isolate the save")
		quit(1)
		return
	call_deferred("_run")

func check(condition: bool, message: String) -> void:
	if not condition: failures.append(message)

func walk_segment(start: Vector3, end: Vector3, route: String) -> void:
	var steps := ceili(start.distance_to(end) / 0.18)
	for i in steps + 1:
		var feet := start.lerp(end, float(i) / maxi(1,steps))
		route_probes += 1
		var support := Terrain.floor_hit(game, feet, 2.6, 2.0, 0.68, 1)
		if support.is_empty() or absf(support.position.y - feet.y) > 0.26 or not game._player_capsule_clear(feet + Vector3.UP * 0.025):
			var space := game.get_world_3d().direct_space_state
			var ray := PhysicsRayQueryParameters3D.create(feet + Vector3.UP * 2.6, feet - Vector3.UP * 0.2, 1)
			var hit := space.intersect_ray(ray)
			var details := ""
			for obstacle in game.respawn_recovery.overlaps(feet + Vector3.UP * .025):
				details += " %s@%s" % [obstacle.collider.get_path(),obstacle.collider.global_position.snapped(Vector3.ONE*0.1)]
			failures.append("%s obstructed at %s by %s" % [route, feet.snapped(Vector3.ONE*0.01), hit.collider.get_path() if not hit.is_empty() else "no floor"] + details)
			return

func _run() -> void:
	game = load("res://main.tscn").instantiate()
	root.add_child(game)
	for i in 4: await physics_frame
	check(game.diagnostic_offline, "Native smoke fixture must isolate service requests")
	await game.adventure.travel("forge_yard")
	game.set_process(false)
	game.state = JSON.parse_string(FileAccess.get_file_as_string("res://workshop_fixture.json"))
	for recipe in game.state.recipes: recipe.available = true
	game.collection.sync()
	var collection = game.collection
	var archive_items: Array[Node3D] = []
	# Exercise more than two complete folios. These are test pickups only.
	for i in Layout.SLOTS_PER_FOLIO * 2 + 5:
		var item := Node3D.new()
		game.add_child(item)
		item.set_meta("id", "smithy-fixture-%d" % i)
		item.set_meta("kind", "weapon")
		item.add_to_group("pickup")
		game._collider(item, Vector3(0.13,0.13,0.13), Vector3.ZERO)
		collection.register(item)
		archive_items.append(item)
	for i in 3: await physics_frame
	var chimney := game.adventure.zone_groups.forge_yard.find_child("ForgeSmoke", true, false) as Node3D
	chimney._process(0.17)
	for mote in chimney.motes:
		check(mote.scale.length() < 0.045, "Furnace embers must stay centimetre-sized as they fade")
	var gate_count := 0
	var crossing := Vector3(0,0,4)
	walk_segment(Layout.SPAWN, crossing, "spawn to courtyard")
	for portal in game.scene.portals:
		if portal.get_meta("zone") != "forge_yard": continue
		gate_count += 1
		var approach: Vector3 = portal.to_global(Vector3(0,0,1.35))
		walk_segment(crossing, approach, str(portal.get_meta("target_zone")))
		walk_segment(approach, portal.to_global(Vector3(0,0,-0.7)), "through " + str(portal.get_meta("target_zone")))
	check(gate_count == Layout.DESTINATIONS.size(), "Every destination must have a hub gate")
	walk_segment(crossing, Layout.ARMORY_ENTRY, "yard to armory")
	# Both cross-aisles run alongside the ends of the banks.
	for bay in Layout.BAY_COUNT:
		var middle := Layout.bay_center(bay)
		var aisle_start := Vector3(Layout.ARMORY_ENTRY.x - 0.9, 0, middle.z)
		walk_segment(Vector3(aisle_start.x,0,4), aisle_start, "west gallery")
		walk_segment(aisle_start, middle, "bay %d" % bay)
		for slot in Layout.SLOTS_PER_BAY:
			var index := bay * Layout.SLOTS_PER_BAY + slot
			var stand := Layout.stand_position(index)
			var viewing := stand + Vector3(0,0,0.93 if Layout.stand_yaw(index) == 0 else -0.93)
			walk_segment(Vector3(stand.x,0,middle.z), viewing, "stand %d" % index)
	var first: Node3D = archive_items.front()
	var last: Node3D = archive_items.back()
	var address: Vector3 = collection.homes[first.get_meta("id")].stand.global_position
	check(first.is_visible_in_tree() and not last.is_visible_in_tree(), "Only the open folio displays its stored weapons")
	var hand := Node3D.new()
	game.add_child(hand)
	game.grips._attach(hand, first)
	game._button("armory:next")
	game._button("armory:next")
	for i in 3: await physics_frame
	check(last.is_visible_in_tree() and first.is_visible_in_tree(), "Changing folios must preserve a held weapon and expose the selected rack")
	check(first in game.held.values() and not collection.return_item(first.get_meta("id")), "Returning a weapon cannot steal it from a hand")
	var home = collection.homes[last.get_meta("id")]
	var control: Node3D = home.recall
	var canvas_ray := PhysicsRayQueryParameters3D.create(control.to_global(Vector3(0,0,0.75)),control.global_position,1)
	var hit := game.get_world_3d().direct_space_state.intersect_ray(canvas_ray)
	check(not hit.is_empty() and game._owner(hit.collider).get_meta("action","") == "collection:"+str(home.id), "An active stand's return control owns the ray over stored folios")
	game.held.erase(str(hand.get_instance_id()))
	game.grips.grips.erase(str(hand.get_instance_id()))
	game.tool_physics.drop(first,Vector3.ZERO,Vector3.ZERO)
	check(collection.return_item(first.get_meta("id")) and not first.is_visible_in_tree(), "Returning to an archived folio parks the dropped item safely")
	game._button("armory:previous")
	game._button("armory:previous")
	for i in 3: await physics_frame
	check(first.is_visible_in_tree() and first.global_position.distance_to(address + Vector3.UP*0.98)<0.02, "Restoring a folio preserves pose and address")
	check(collection.homes.starter_hammer.item.is_visible_in_tree(), "The first hammer remains at Brann's bench")
	_check_brann_character()
	for button in game.scene.buttons:
		if button.get_parent() != game.scene.board: continue
		var ray := PhysicsRayQueryParameters3D.create(button.to_global(Vector3(0,0,0.85)), button.global_position, 1)
		var front := game.get_world_3d().direct_space_state.intersect_ray(ray)
		check(not front.is_empty() and game._owner(front.collider) == button, "Player ray reaches " + str(button.get_meta("action")))
	# Re-present an existing display to cover both first delivery and registry reconciliation.
	var before: int = game.workshop_delivery.strike_count
	await game.workshop_delivery.present(first, "smithy-fixture-delivery")
	check(game.workshop_delivery.strike_count >= before + 3 and collection.is_docked(first), "A commission strikes three times and reaches its assigned stand")
	check(first.get_meta("delivery_ready") and first.is_in_group("pickup"), "A completed delivery can be picked up again")
	game.workshop._apply_tier(4)
	for i in 3: await physics_frame
	walk_segment(Vector3(-1.65,0,-1.3),Vector3(-1.65,0,-5.55),"west hearth aisle")
	walk_segment(Vector3(-1.65,0,-5.55),Vector3(0,0,-6.85),"foundry doorway approach")
	walk_segment(Vector3(0,0,-6.85),Vector3(0,0,-9.25),"through the unlocked foundry door")
	for gate in game.adventure.zone_groups.forge_yard.get_children():
		if not gate.get_meta("action","") in ["museum:enter","playful_encounter:enter"]: continue
		walk_segment(gate.to_global(Vector3(0,0,0.6)),gate.to_global(Vector3(0,0,-0.6)),str(gate.get_meta("action")))
		var ray := PhysicsRayQueryParameters3D.create(gate.to_global(Vector3(0,1.15,0.9)),gate.to_global(Vector3(0,1.15,-0.2)),1)
		ray.collide_with_areas = true
		var pocket_hit := game.get_world_3d().direct_space_state.intersect_ray(ray)
		check(not pocket_hit.is_empty() and game._owner(pocket_hit.collider) == gate, "Pocket doorway responds to the travel ray")
	print("SMITHY_RESULT ", JSON.stringify({"homes":collection.homes.size(),"bays":collection.bays.size(),"stand_capacity":Layout.SLOTS_PER_FOLIO,"route_probes":route_probes,"failures":failures}))
	quit(0 if failures.is_empty() else 1)


func _check_brann_character() -> void:
	var brann = game.scene.brann
	check(brann.skeleton != null and brann.player != null, "Brann's runtime has a skinned skeleton and animation player")
	if brann.skeleton == null or brann.player == null: return
	var required := ["Head", "EyeL", "EyeR", "UpperArmR", "ForearmR", "HandR", "UpperArmL", "ForearmL", "HandL", "Jaw"]
	for bone in required:
		check(brann.skeleton.find_bone(bone) >= 0, "Brann's articulated rig includes " + bone)
	for name in [&"Idle", &"Greet", &"Listen", &"Talk", &"Forge", &"Inspect"]:
		check(brann.clips.has(name), "Brann's embedded body clip: " + name)
	for name in brann.FACE_CHANNELS:
		check(brann.channels.has(name), "Brann's independent facial control: " + name)

	var visitor: Vector3 = brann.global_position + Vector3(0.74,1.72,1.58)
	brann.stop_forging()
	brann.tick(0.3,visitor,false,false,0.0,false)
	brann.next_blink = 0.01
	brann.tick(0.075,visitor,true,false,0.0,false)
	check(brann.pose == &"Greet", "A visitor approaching Brann starts his greeting gesture")
	check(brann.face_value(&"BlinkL") > 0.96 and brann.face_value(&"BlinkR") > 0.96, "Both eyes close through the exported skin")
	brann.tick(0.13,visitor,true,false,0.0,false)
	check(brann.face_value(&"BlinkL") < 0.001, "Brann's blink returns to the open shape")
	for frame in 72: brann.tick(1.0/30.0,visitor,true,false,0.0,false)
	check(brann.pose == &"Listen" and brann.gaze_yaw > 0.20 and brann.gaze_yaw < 0.69, "Brann settles into listening and looks towards the visitor")
	var previous_camera: Transform3D = game.camera.global_transform
	var previous_voice := [game.visiting, game.speech_target, game.speech_level, game.speech_seen]
	game.camera.global_position = visitor
	game.visiting = true
	game.speech_target = 0.78
	game.speech_seen = game.elapsed
	game._speech_tick(0.25)
	check(brann.pose == &"Talk" and brann.face_value(&"MouthOpen") > 0.5, "The native speech envelope drives the authored talk clip and mouth shape")
	check(brann.face_value(&"MouthWide") + brann.face_value(&"MouthRound") > 0.15, "Speech independently shapes the lips")
	game.speech_target = 0.0
	game._speech_tick(0.35)
	check(brann.pose == &"Listen" and brann.face_value(&"MouthOpen") < 0.02, "Speech ending returns to closed-mouth listening")
	game.camera.global_transform = previous_camera
	game.visiting = previous_voice[0]
	game.speech_target = previous_voice[1]
	game.speech_level = previous_voice[2]
	game.speech_seen = previous_voice[3]

	if not brann.clips.has(&"Forge"): return
	var right_elbow: int = brann.skeleton.find_bone("ForearmR")
	var wrist: int = brann.skeleton.find_bone("HandR")
	if right_elbow < 0 or wrist < 0: return
	var station: Vector3 = game.workshop_delivery.billet.get_parent_node_3d().to_global(game.workshop_delivery.CONTACT)
	brann.pose_forge(0.42)
	var raise: Vector3 = brann.strike_point()
	var elbow_raise: Quaternion = brann.skeleton.get_bone_pose_rotation(right_elbow)
	var wrist_raise: Quaternion = brann.skeleton.get_bone_pose_rotation(wrist)
	brann.pose_forge(brann.STRIKE_PHASE)
	var contact: Vector3 = brann.strike_point()
	var error := contact.distance_to(station)
	check(error < 0.005, "The animated hammer face reaches the billet within 5 mm. Actual error: " + str(error))
	check(raise.is_finite() and raise.distance_to(contact) > 0.3, "The forge clip raises the hammer through a visible swing")
	check(elbow_raise.angle_to(brann.skeleton.get_bone_pose_rotation(right_elbow)) > 0.10, "The elbow articulates during the strike")
	check(wrist_raise.angle_to(brann.skeleton.get_bone_pose_rotation(wrist)) > 0.03, "The wrist adjusts the hammer orientation")
	brann.pose_forge(0.84)
	check(brann.strike_point().distance_to(contact) > 0.045, "The hammer rebounds after contact")
	brann.tick(0.016,visitor,true,false,0.0,true)
	brann.stop_forging()
	brann.tick(0.016,visitor,true,false,0.0,true)
	check(brann.pose == &"Present", "Brann presents the creation after releasing the forge pose")
	brann.tick(0.016,visitor,true,false,0.0,false)
	print("BRANN_CHARACTER_RESULT ", JSON.stringify({"bone_count":brann.skeleton.get_bone_count(), "clips":brann.clips.keys(), "face":brann.channels.keys(), "hammer_contact_m":error}))
