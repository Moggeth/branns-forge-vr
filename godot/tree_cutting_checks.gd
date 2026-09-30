extends SceneTree
## Offline engine check: no main scene, save, service, API, or VR session.

const KIT = preload("res://tree_kit.gd")
const FELLING = preload("res://tree_felling.gd")
const MELEE = preload("res://melee_contact.gd")
const BUILDER = preload("res://world_builder_runtime.gd")

class FakeAdventure extends Node:
	var zone := "orchard_highlands"
	var zone_groups := {}
	var gather_calls := 0
	func gather(source: Node3D, _hand = null) -> void:
		gather_calls += 1
		source.set_meta("collecting", true)
		source.visible = false

class FakeGame extends Node3D:
	var adventure: FakeAdventure
	var camera: Node3D
	var melee: Node
	var world_builder: Node
	var elapsed := 0.0
	func _effect(_at: Vector3, _color: Color, _duration: float, _size: float) -> void: pass
	func _notice(_message: String, _duration: float = 3.0) -> void: pass
	func _set_collisions(node: Node, enabled: bool) -> void:
		if node is CollisionShape3D: node.disabled = not enabled
		for child in node.get_children(): _set_collisions(child, enabled)

func _initialize() -> void:
	create_timer(12.0).timeout.connect(func(): print("TREE_CUTTING_TIMEOUT"); quit(2))
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game := FakeGame.new()
	root.add_child(game)
	game.camera = Node3D.new()
	game.add_child(game.camera)
	game.camera.position = Vector3(6, 1.6, 0)
	game.adventure = FakeAdventure.new()
	game.add_child(game.adventure)
	game.adventure.zone_groups["orchard_highlands"] = game
	var tree := Node3D.new()
	game.add_child(tree)
	tree.set_meta("kind", "resource")
	tree.set_meta("requires", "axe")
	tree.set_meta("resource", "lumber")
	KIT.adapt_timber(tree, "apple", 1001, {"height": 5.0})
	var original: MeshInstance3D = tree.get_meta("trunk")
	tree.set_meta("trunk_mesh", original.mesh)
	tree.set_meta("trunk_material", original.material_override)
	var cut_y := 1.05
	for child in tree.get_children():
		if child is MeshInstance3D:
			for above in [false, true]:
				var mesh: ArrayMesh = FELLING.split_mesh(child.mesh, child.transform, cut_y, above)
				for surface in mesh.get_surface_count():
					var vertices: PackedVector3Array = mesh.surface_get_arrays(surface)[Mesh.ARRAY_VERTEX]
					for vertex in vertices:
						var y: float = (child.transform * vertex).y
						if above and y < cut_y - 0.001: failures.append("upper mesh below plane: " + child.name)
						if not above and y > cut_y + 0.001: failures.append("stump mesh above plane: " + child.name)
	var melee := MELEE.new()
	game.add_child(melee)
	melee.setup(game)
	game.melee = melee
	var point := tree.to_global(Vector3(0.28, cut_y, 0))
	if melee.chop(tree, point, Vector3.RIGHT): failures.append("first hit felled tree")
	if melee.chop(tree, point + Vector3.UP * 0.4, Vector3.RIGHT): failures.append("separate cut band felled tree")
	if melee.chop(tree, point + Vector3.UP * 0.04, Vector3.RIGHT): failures.append("second aligned hit felled tree")
	if not melee.chop(tree, point + Vector3.UP * 0.08, Vector3.RIGHT): failures.append("third aligned hit did not fell")
	if not tree.get_meta("felled", false): failures.append("felled state missing")
	if tree.get_meta("collecting", false): failures.append("lumber awarded before pickup")
	var felling: Node3D = null
	for child in game.get_children():
		if child is FELLING: felling = child
	if felling == null: failures.append("felling helper missing")
	else:
		if absf(felling.cut_y - cut_y) > 0.001: failures.append("fall plane does not use selected first-hit height")
		if felling.stump.get_child_count() < 2: failures.append("rooted stump missing geometry")
		felling._drop_log()
		if not is_instance_valid(felling.log): failures.append("physical log missing")
		else:
			if not felling.log is RigidBody3D: failures.append("log has no physics body")
			if tree.get_meta("collecting", false): failures.append("spawned log awarded lumber")
			game.camera.global_position = felling.log.global_position + Vector3(0.3, 0.35, 0)
			felling.log.age = 1.2
			await physics_frame
			if tree.get_meta("collecting", false): failures.append("standing near log awarded lumber without E/grip")
			if not felling.log.try_grab(game.camera, true): failures.append("standing reach grab rejected")
			for frame in 20: await physics_frame
			if not tree.get_meta("collecting", false): failures.append("log pickup did not call resource gather")
			if game.adventure.gather_calls != 1: failures.append("resource gather called more than once")
			if not felling.collected: failures.append("felling manager did not observe successful log pickup")
			tree.set_meta("collecting", false)
			tree.visible = true
			await process_frame
			await process_frame
			if tree.get_meta("felled", false): failures.append("tree did not reset on respawn")
	await _check_scenic(game, failures)
	print("TREE_CUTTING_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)

func _check_scenic(game: FakeGame, failures: Array[String]) -> void:
	var builder := BUILDER.new()
	game.add_child(builder)
	game.world_builder = builder
	builder.game = game
	builder.root = game
	builder.center = Vector3.ZERO
	builder.test_mode = true
	builder.data = builder.fresh_state()
	var proxy := StaticBody3D.new()
	game.add_child(proxy)
	var collision := CollisionShape3D.new()
	var cylinder := CylinderShape3D.new()
	cylinder.radius = 0.32
	cylinder.height = 2.5
	collision.shape = cylinder
	collision.position = Vector3(4.0, 1.25, 0.0)
	collision.set_meta("builder_species", "apple")
	collision.set_meta("builder_scale", 1.0)
	collision.set_meta("builder_seed", 4101)
	proxy.add_child(collision)
	var key := "40:0"
	builder.scenic_by_key[key] = {"position": Vector3(4, 0, 0), "collision": collision}
	var hit := Vector3(4.25, 1.0, 0)
	if builder.chop_scenic(hit, true, Vector3.RIGHT): failures.append("scenic first hit felled")
	if not builder.scenic_pending.has(key): failures.append("scenic tree did not reveal")
	if builder.chop_scenic(hit + Vector3.UP * 0.04, true, Vector3.RIGHT): failures.append("scenic second hit felled")
	if not builder.chop_scenic(hit + Vector3.UP * 0.08, true, Vector3.RIGHT): failures.append("scenic third hit did not fell")
	if key in builder.data.harvested or int(builder.data.wood) != 0: failures.append("scenic lumber awarded before log grab")
	var scenic: Node3D = builder.scenic_pending.get(key, null)
	if not is_instance_valid(scenic): return
	var felling: Node3D = null
	for child in game.get_children():
		if child is FELLING and child.source == scenic: felling = child
	if felling == null: failures.append("scenic felling helper missing"); return
	felling._drop_log()
	var log: RigidBody3D = felling.log
	log.age = 1.2
	game.camera.global_position = log.global_position + Vector3(0.3, 0.35, 0)
	await physics_frame
	if int(builder.data.wood) != 0: failures.append("scenic proximity awarded settlement wood")
	if not log.try_grab(game.camera, true): failures.append("scenic reach grab rejected")
	for frame in 20: await physics_frame
	if key not in builder.data.harvested or int(builder.data.wood) != 1: failures.append("scenic claim did not persist one lumber")
	if absf(float(builder.data.scenic_cut_heights.get(key, -1.0)) - 1.0) > 0.001: failures.append("scenic selected cut height not persisted")
	if game.adventure.gather_calls != 1: failures.append("scenic claim double-awarded inventory gather")
	if not builder.claim_scenic_log(scenic) or int(builder.data.wood) != 1: failures.append("scenic claim not idempotent")
	if not builder._valid(builder.data): failures.append("scenic save state invalid")
	var before_stumps := game.get_child_count()
	builder._restore_scenic_stump(key, float(builder.data.scenic_cut_heights[key]))
	if game.get_child_count() <= before_stumps: failures.append("saved scenic stump did not rebuild")
