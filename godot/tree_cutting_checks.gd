extends SceneTree
## Offline engine check: no main scene, save, service, API, or VR session.

const KIT = preload("res://tree_kit.gd")
const FELLING = preload("res://tree_felling.gd")
const MELEE = preload("res://melee_contact.gd")

class FakeAdventure extends Node:
	var zone := "check"
	var zone_groups := {}
	func gather(source: Node3D, _hand = null) -> void:
		source.set_meta("collecting", true)
		source.visible = false

class FakeGame extends Node3D:
	var adventure: FakeAdventure
	var camera: Node3D
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
	game.adventure.zone_groups["check"] = game
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
			felling.log._claim()
			await physics_frame
			await physics_frame
			if not tree.get_meta("collecting", false): failures.append("log pickup did not call resource gather")
			if not felling.collected: failures.append("felling manager did not observe successful log pickup")
			tree.set_meta("collecting", false)
			tree.visible = true
			await process_frame
			await process_frame
			if tree.get_meta("felled", false): failures.append("tree did not reset on respawn")
	print("TREE_CUTTING_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
