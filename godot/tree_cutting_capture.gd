extends SceneTree
## Standalone graphical review of real imported cut GLBs; no playable scene.

const KIT = preload("res://tree_kit.gd")
const MELEE = preload("res://melee_contact.gd")

class FakeAdventure extends Node:
	var zone := "tree_capture"
	var zone_groups := {}
	func gather(_source: Node3D, _hand = null) -> void: pass

class FakeGame extends Node3D:
	var adventure: FakeAdventure
	var camera: Camera3D
	func _effect(_at: Vector3, _color: Color, _duration: float, _size: float) -> void: pass
	func _notice(_message: String, _duration: float = 3.0) -> void: pass
	func _set_collisions(node: Node, enabled: bool) -> void:
		if node is CollisionShape3D: node.disabled = not enabled
		for child in node.get_children(): _set_collisions(child, enabled)

func _initialize() -> void:
	call_deferred("_capture")

func _capture() -> void:
	root.size = Vector2i(1280, 800)
	var output := ProjectSettings.globalize_path("res://../outputs/tree-cutting")
	DirAccess.make_dir_recursive_absolute(output)
	var game := FakeGame.new()
	root.add_child(game)
	var environment := WorldEnvironment.new()
	var settings := Environment.new()
	settings.background_mode = Environment.BG_COLOR
	settings.background_color = Color("ced9d0")
	settings.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	settings.ambient_light_color = Color("d9dcce")
	settings.ambient_light_energy = 0.8
	environment.environment = settings
	game.add_child(environment)
	var sunlight := DirectionalLight3D.new()
	sunlight.rotation_degrees = Vector3(-45, -25, 0)
	sunlight.light_energy = 1.8
	game.add_child(sunlight)
	game.camera = Camera3D.new()
	game.camera.current = true
	game.camera.fov = 57.0
	game.add_child(game.camera)
	game.adventure = FakeAdventure.new()
	game.add_child(game.adventure)
	game.adventure.zone_groups["tree_capture"] = game
	var ground := MeshInstance3D.new()
	var ground_mesh := PlaneMesh.new()
	ground_mesh.size = Vector2(14, 14)
	ground.mesh = ground_mesh
	var ground_material := StandardMaterial3D.new()
	ground_material.albedo_color = Color("8a9970")
	ground.material_override = ground_material
	game.add_child(ground)
	var floor_body := StaticBody3D.new()
	var floor_shape := CollisionShape3D.new()
	var floor_box := BoxShape3D.new()
	floor_box.size = Vector3(14, 0.2, 14)
	floor_shape.shape = floor_box
	floor_body.position.y = -0.1
	floor_body.add_child(floor_shape)
	game.add_child(floor_body)
	var tree := Node3D.new()
	game.add_child(tree)
	tree.set_meta("kind", "resource")
	tree.set_meta("requires", "axe")
	tree.set_meta("resource", "lumber")
	KIT.adapt_timber(tree, "apple", 1001, {"height": 5.0})
	var trunk: MeshInstance3D = tree.get_meta("trunk")
	tree.set_meta("trunk_mesh", trunk.mesh)
	tree.set_meta("trunk_material", trunk.material_override)
	var melee := MELEE.new()
	game.add_child(melee)
	melee.setup(game)
	var cut_y := 1.05
	var hit := Vector3(0.25, cut_y, 0)
	game.camera.position = Vector3(2.45, 1.42, 0.3)
	game.camera.look_at(Vector3(0, cut_y, 0), Vector3.UP)
	for count in [1, 2]:
		melee.chop(tree, hit + Vector3.UP * (0.035 * (count - 1)), Vector3.RIGHT)
		await _save(output.path_join("cut-%d.png" % count))
	melee.chop(tree, hit + Vector3.UP * 0.07, Vector3.RIGHT)
	await _save(output.path_join("cut-3-start.png"))
	game.camera.position = Vector3(7.5, 3.25, 5.6)
	game.camera.look_at(Vector3(0, 2.3, 0), Vector3.UP)
	await create_timer(1.85).timeout
	await _save(output.path_join("felled-and-log.png"))
	game.camera.position = Vector3(2.6, 1.85, 2.15)
	game.camera.look_at(Vector3(0, 0.9, 0), Vector3.UP)
	await _save(output.path_join("stump-and-log.png"))
	await create_timer(2.8).timeout
	await _save(output.path_join("settled-log.png"))
	print("TREE_CUTTING_CAPTURE ", output)
	quit()

func _save(path: String) -> void:
	for frame in 5: await process_frame
	var error := root.get_texture().get_image().save_png(path)
	if error != OK: push_error("tree capture failed: %s (%d)" % [path, error])
