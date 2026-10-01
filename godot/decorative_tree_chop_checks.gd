extends SceneTree

const WorldZones = preload("res://world_zones.gd")
const TreeAdapter = preload("res://tree_adapter.gd")
const AuthoredZoneKit = preload("res://authored_zone_kit.gd")
const Melee = preload("res://melee_contact.gd")
const TreeFelling = preload("res://tree_felling.gd")

class FakeAdventure extends Node:
	var zone := "pinewood_ruins"
	var zone_groups := {}

class FakeGame extends Node3D:
	var scene: Dictionary = {}
	var adventure: FakeAdventure
	var camera: Node3D
	var impact_feedback: Node
	func _notice(_message: String, _duration: float = 3.0) -> void: pass
	func _effect(_point: Vector3, _color: Color, _duration: float, _size: float) -> void: pass
	func _set_collisions(node: Node, enabled: bool) -> void:
		if node is CollisionShape3D: node.disabled = not enabled
		for child in node.get_children(): _set_collisions(child, enabled)

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var world := Node3D.new()
	root.add_child(world)
	var data: Dictionary = WorldZones.build(world)
	var count := 0
	for resource in data.resources:
		if not resource.get_meta("decorative_timber", false): continue
		count += 1
		if str(resource.get_meta("zone", "")) == "": failures.append("decorative tree has no zone")
		if resource.get_meta("kind", "") != "resource" or resource.get_meta("requires", "") != "axe": failures.append("decorative tree is not axe timber")
		if not resource.has_meta("trunk") or not resource.has_meta("trunk_mesh"): failures.append("decorative tree has no cuttable trunk")
		if resource.get_node_or_null("ChopProxy") == null: failures.append("decorative tree has no trunk collider")
	if count < 30: failures.append("playable decorative trees were not registered")
	var backdrop := Node3D.new()
	world.add_child(backdrop)
	var small := TreeAdapter.tree(backdrop, Vector3.ZERO, 1.4, true)
	if small.get_meta("decorative_timber", false): failures.append("small backdrop was registered as timber")
	var apple_host: Node3D = null
	for zone in data.zones:
		for tree in data.zones[zone].root.find_children("*", "Node3D", true, false):
			if tree.get_meta("decorative_timber", false) and tree.get_meta("tree_species", "") == "apple" and not tree.get_meta("reach_points", []).is_empty():
				apple_host = tree
				break
		if apple_host != null: break
	if apple_host == null: failures.append("no playable apple tree found")
	else:
		var fruit := TreeAdapter.hanging_apple(WorldZones, world, data, str(apple_host.get_meta("zone")), apple_host)
		if fruit == null or fruit.get_meta("host_tree", null) != apple_host: failures.append("hanging apple lost its host")
	var game := FakeGame.new()
	game.scene = data
	world.add_child(game)
	game.adventure = FakeAdventure.new()
	game.add_child(game.adventure)
	for zone in data.zones: game.adventure.zone_groups[zone] = game
	game.camera = Node3D.new()
	game.add_child(game.camera)
	var authored_count := 0
	var authored_species := {}
	var imported_tree: Node3D = null
	for proxy in world.find_children("*", "StaticBody3D", true, false):
		if proxy.get_meta("kind", "") != "authored_tree": continue
		authored_count += 1
		if imported_tree == null: imported_tree = proxy
		var species := str(proxy.get_meta("authored_tree_asset", ""))
		if authored_species.has(species): continue
		authored_species[species] = true
		var views: Array = proxy.get_meta("authored_tree_views", [])
		if views.is_empty(): failures.append(species + " has no batched visual address"); continue
		var first: Dictionary = views[0]
		var holder: MultiMeshInstance3D = first.holder
		var before: Transform3D = holder.multimesh.get_instance_transform(int(first.index))
		if AuthoredZoneKit.ensure_choppable(proxy, game) != proxy: failures.append(species + " could not be revealed")
		if proxy.get_meta("kind", "") != "resource" or not proxy in data.resources: failures.append(species + " was not registered as lumber")
		# Headless renderers do not reliably read back changed MultiMesh transforms.
		if not proxy.get_meta("authored_tree_revealed", false): failures.append(species + " was not marked revealed")
		if DisplayServer.get_name() != "headless" and holder.multimesh.get_instance_transform(int(first.index)) == before: failures.append(species + " remained batched after reveal")
		var cut_surfaces := 0
		for child in proxy.get_children():
			if child is MeshInstance3D and child.get_meta("tree_cut_surface", false): cut_surfaces += 1
		if cut_surfaces == 0: failures.append(species + " has no cuttable GLB surfaces")
		AuthoredZoneKit.restore_batch(proxy)
		if proxy.get_meta("kind", "") != "authored_tree" or proxy in data.resources: failures.append(species + " did not return to batched state")
		if holder.multimesh.get_instance_transform(int(first.index)) != before: failures.append(species + " visual transform was not restored")
	if authored_count != 81: failures.append("authored tree proxy count changed: " + str(authored_count))
	# Reusing the same imported placement below must wait for the queued preview
	# meshes to leave the scene; ordinary play has many frames between respawns.
	await process_frame
	if imported_tree == null: failures.append("no imported authored tree available for felling")
	else:
		game.adventure.zone = str(imported_tree.get_meta("zone"))
		AuthoredZoneKit.ensure_choppable(imported_tree, game)
		var melee := Melee.new()
		game.add_child(melee)
		melee.setup(game)
		var hit: Vector3 = imported_tree.to_global(Vector3(0.2, 0.95, 0))
		if melee.chop(imported_tree, hit, Vector3.RIGHT): failures.append("authored tree fell on first hit")
		if melee.chop(imported_tree, hit + Vector3.UP * 0.04, Vector3.RIGHT): failures.append("authored tree fell on second hit")
		if not melee.chop(imported_tree, hit + Vector3.UP * 0.08, Vector3.RIGHT): failures.append("authored tree did not fall on third hit")
		var felling: Node3D = null
		for child in game.get_children():
			if child is TreeFelling: felling = child
		if felling == null: failures.append("authored tree has no felling actor")
		else:
			if felling.stump.get_child_count() == 0 or felling.upper.get_child_count() == 0: failures.append("authored GLB did not split into stump and crown")
			felling._drop_log()
			if felling.log == null: failures.append("authored tree did not produce a physical log")
			felling.log_collected()
			imported_tree.visible = false
			imported_tree.set_meta("collecting", true)
			imported_tree.visible = true
			imported_tree.set_meta("collecting", false)
			felling._process(0.0)
			if imported_tree.get_meta("kind", "") != "authored_tree" or imported_tree in data.resources: failures.append("authored tree did not rebatch after respawn")
	print("DECORATIVE_TREE_CHOP_RESULT ", JSON.stringify({"trees": count, "authored": authored_count, "species": authored_species.size(), "failures": failures}))
	quit(0 if failures.is_empty() else 1)
