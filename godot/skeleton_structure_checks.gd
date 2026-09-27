extends SceneTree
## Run: tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --path godot --script res://skeleton_structure_checks.gd

class FakeAnimation extends Node:
	var actors := {}

class FakeRemains extends Node:
	var bodies := []
	func _impact(_body, _other) -> void: pass
	func _trim() -> void: pass

class FakeAdventure extends Node:
	var zone := "test"
	var zone_groups := {}

class FakeGame extends Node3D:
	var animation: FakeAnimation
	var remains: FakeRemains
	var adventure: FakeAdventure
	var guardians = null
	var elapsed := 1.0

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var failures := []
	var game := FakeGame.new()
	root.add_child(game)
	game.animation = FakeAnimation.new()
	game.add_child(game.animation)
	game.remains = FakeRemains.new()
	game.add_child(game.remains)
	game.adventure = FakeAdventure.new()
	game.add_child(game.adventure)
	var actor := Node3D.new()
	game.add_child(actor)
	actor.set_meta("enemy_type", "skeleton")
	actor.set_meta("alive", true)
	actor.set_meta("zone", "test")
	var joints := {}
	var homes := []
	var pieces := []
	for key in ["head", "body", "arm_l", "arm_r", "leg_l", "leg_r"]:
		var joint := Node3D.new()
		joint.name = key
		joint.position = _joint_position(key)
		actor.add_child(joint)
		joints[key] = joint
		var piece := Node3D.new()
		joint.add_child(piece)
		var mesh := MeshInstance3D.new()
		mesh.mesh = BoxMesh.new()
		mesh.mesh.size = Vector3(0.4, 0.045, 0.2) if key == "body" else Vector3(0.12, 0.42, 0.12)
		piece.add_child(mesh)
		homes.append({"piece": piece, "parent": joint, "transform": piece.transform})
		pieces.append(piece)
	game.animation.actors[actor.get_instance_id()] = {"homes": homes, "pieces": pieces, "joints": joints, "type": "skeleton"}
	var structure := preload("res://skeleton_structure.gd").new()
	game.add_child(structure)
	structure.setup(game)
	var arm_point := actor.to_global(Vector3(0.45, 1.12, 0.0))
	var light: Dictionary = structure.hit(actor, arm_point, Vector3.RIGHT, 1.8, "blunt")
	if light.region != "arm_r" or not light.cracked or light.detached: failures.append("light arm hit should crack only")
	var heavy: Dictionary = structure.hit(actor, arm_point, Vector3.RIGHT, 3.0, "blunt")
	if not heavy.detached or not heavy.item is RigidBody3D: failures.append("second arm hit did not detach")
	else:
		if not heavy.item.is_in_group("pickup") or not heavy.item.get_meta("remains", false): failures.append("arm is not a pickup remain")
		if homes[3].piece != null or not homes[3].has("template"): failures.append("arm home cannot restore")
		if game.remains.bodies.size() != 1: failures.append("detached arm absent from remains lifetime list")
		if float(actor.get_meta("skeleton_attack_scale", 1.0)) >= 1.0: failures.append("lost arm did not degrade attack")
	var duplicate: Dictionary = structure.hit(actor, arm_point, Vector3.RIGHT, 9.0, "blunt")
	if duplicate.detached or game.remains.bodies.size() != 1: failures.append("arm detached twice")
	var rib_point := actor.to_global(Vector3(0.0, 1.04, 0.11))
	var rib: Dictionary = structure.hit(actor, rib_point, Vector3.FORWARD, 4.0, "blade")
	if not rib.detached or rib.region != "rib": failures.append("rib cut did not localize")
	var leg_point := actor.to_global(Vector3(-0.18, 0.48, 0.0))
	var leg: Dictionary = structure.hit(actor, leg_point, Vector3.LEFT, 5.2, "blunt")
	if not leg.detached or float(actor.get_meta("skeleton_move_scale", 1.0)) >= 1.0: failures.append("leg loss did not degrade movement")
	var head_point := actor.to_global(Vector3(0.0, 1.53, 0.0))
	var head: Dictionary = structure.hit(actor, head_point, Vector3.UP, 5.3, "blunt")
	if not head.detached or head.region != "head": failures.append("head hit did not localize")
	if not actor.get_meta("alive", false): failures.append("missing head killed living skeleton")
	structure.reset(actor)
	if not actor.get_meta("skeleton_missing_parts", []).is_empty() or float(actor.get_meta("skeleton_move_scale", 0.0)) != 1.0: failures.append("respawn reset did not clear damage")
	print("SKELETON_STRUCTURE_RESULT ", JSON.stringify(failures))
	for home in homes:
		if home.has("template") and is_instance_valid(home.template): home.template.free()
	game.free()
	quit(0 if failures.is_empty() else 1)

func _joint_position(key: String) -> Vector3:
	match key:
		"head": return Vector3(0, 1.5, 0)
		"body": return Vector3(0, 1.04, 0)
		"arm_l": return Vector3(-0.45, 1.12, 0)
		"arm_r": return Vector3(0.45, 1.12, 0)
		"leg_l": return Vector3(-0.18, 0.48, 0)
		"leg_r": return Vector3(0.18, 0.48, 0)
	return Vector3.ZERO
