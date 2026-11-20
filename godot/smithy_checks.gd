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
	var canvas_ray := PhysicsRayQueryParameters3D.create(home.stand.to_global(Vector3(0,0.46,1.0)),home.stand.to_global(Vector3(0,0.46,0.4)),1)
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
	game.workshop_delivery.working_pose(0.0)
	var hammer: Node3D = game.scene.brann.get_meta("smith_hammer")
	check(hammer.to_global(game.workshop_delivery.HAMMER_FACE).distance_to(game.workshop_delivery.CONTACT) < 0.005, "Brann's hammer face must meet the billet")
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
	print("SMITHY_RESULT ", JSON.stringify({"homes":collection.homes.size(),"bays":collection.bays.size(),"stand_capacity":Layout.SLOTS_PER_FOLIO,"route_probes":route_probes,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
