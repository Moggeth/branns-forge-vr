extends RefCounted
## An offline, real-scene melee slice. Run Godot with --skeleton-combat-check.

static func run(game) -> void:
	game.set_process(false)
	var failures := []
	var data := {"enemies": []}
	preload("res://world_zones.gd").enemy(game, data, "forge_yard", Vector3(25, 0, 25), "skeleton")
	var actor: Node3D = data.enemies[0]
	actor.set_meta("hp", 200.0)
	actor.set_meta("max_hp", 200.0)
	game.animation.register(actor)
	var axe: Node3D = game.adventure._tool_model("woodland_axe")
	game.add_child(axe)
	axe.global_position = actor.global_position + Vector3(0, 0, 1)
	axe.global_basis = Basis.IDENTITY
	var mount: Node3D = axe.get_node("AxeHeadOrientation")
	if mount.basis.x.dot(Vector3.RIGHT) < 0.99: failures.append("axe art faces backwards in the Knuckles grip")
	if axe.get_meta("tip",Vector3.ZERO).x < 0.4: failures.append("axe contact tip still points at the poll")
	if not game.melee._is_blade(axe,Vector3.LEFT) or game.melee._is_blade(axe,Vector3.RIGHT):
		failures.append("blade/poll contact sides are reversed")
	var point: Vector3 = actor.to_global(Vector3(0.45, 1.12, 0))
	game.melee.tracks[axe.get_instance_id()] = {"previous": point - Vector3.RIGHT * 0.12, "item": axe, "correction": Vector3.ZERO, "block": {}}
	var hp_before := float(actor.get_meta("hp"))
	var first_through: bool = game.melee.strike(actor, point, Vector3.LEFT, 2.4, game.desktop_hand, axe)
	if first_through and not actor.get_meta("skeleton_missing_arm_r", false): failures.append("ordinary axe passed through intact bone without severing it")
	if float(actor.get_meta("hp")) >= hp_before or game.skeleton_structure.state(actor).is_empty(): failures.append("ordinary axe contact did not damage local structure")
	game.melee.strike(actor, point, Vector3.LEFT, 2.4, game.desktop_hand, axe)
	if not actor.get_meta("skeleton_missing_arm_r", false): failures.append("repeat arm strike did not detach arm")
	if actor.get_meta("knock_velocity", Vector3.ZERO).length() > 0.01: failures.append("living skeleton slid from an ordinary hit")
	var arm: RigidBody3D = null
	for body in game.remains.bodies:
		if is_instance_valid(body) and body.get_meta("source_actor", -1) == actor.get_instance_id() and body.get_meta("skeleton_part", "") == "arm_r": arm = body
	if arm == null or not arm.visible or not arm.is_in_group("pickup"): failures.append("detached arm is not a visible pickup")
	var left_point: Vector3 = actor.to_global(Vector3(-0.45, 1.12, 0))
	game.melee.tracks[axe.get_instance_id()].previous = left_point - Vector3.RIGHT * 0.12
	game.melee.alternate(axe, game.desktop_hand)
	game.last_inputs[str(game.desktop_hand.get_instance_id()) + "t"] = true
	var powered_through: bool = game.melee.strike(actor, left_point, Vector3.LEFT, 2.4, game.desktop_hand, axe)
	if not powered_through: failures.append("powered cleave should carry through a severed arm")
	if not actor.get_meta("skeleton_missing_arm_l", false): failures.append("powered strike did not break fresh arm")
	if not actor.get_meta("alive", false): failures.append("local dismemberment killed skeleton too early")
	var head_point: Vector3 = actor.to_global(Vector3(0, 1.55, 0))
	var head_hit: Dictionary = game.skeleton_structure.hit(actor, head_point, Vector3.FORWARD, 5.5, "blade")
	if not head_hit.get("detached", false) or not actor.get_meta("skeleton_missing_head", false): failures.append("living skeleton could not be decapitated")
	var leg_point: Vector3 = actor.to_global(Vector3(0.22, 0.48, 0))
	var leg_hit: Dictionary = game.skeleton_structure.hit(actor, leg_point, Vector3.FORWARD, 5.5, "blunt")
	if not leg_hit.get("detached", false) or not is_instance_valid(leg_hit.get("item")): failures.append("living skeleton leg did not detach")
	else:
		var leg: RigidBody3D = leg_hit.item
		if not game.melee.handles(leg): failures.append("detached leg cannot be swung as a weapon")
		if leg.get_meta("tip", Vector3.ZERO).y > -0.1: failures.append("detached leg melee tip does not reach the foot")
		if not leg.get_meta("articulated_leg", false) or leg.get_node_or_null("SpringKnee") == null or leg.get_node_or_null("SpringKnee/SpringAnkle") == null:
			failures.append("detached leg lacks springy knee and ankle")
		else:
			leg.angular_velocity = Vector3(5, 0, 0)
			game.remains._tick_leg_joints(0.016)
			if absf(leg.get_node("SpringKnee").rotation.x) < 0.0001: failures.append("detached knee did not react to motion")
		var collider: CollisionShape3D = null
		for child in leg.get_children():
			if child is CollisionShape3D: collider = child
		if collider == null or not collider.shape is BoxShape3D or collider.position.y - (collider.shape as BoxShape3D).size.y * 0.5 > leg.get_meta("tip").y + 0.05:
			failures.append("detached leg collider does not cover its foot")
		if leg.get_node_or_null("ArticulatedFootCollider") == null: failures.append("articulated foot lacks its own collision volume")
	game.last_inputs.erase(str(game.desktop_hand.get_instance_id()) + "t")
	var rig: Dictionary = game.animation.actors[actor.get_instance_id()]
	for body in game.remains.bodies:
		if is_instance_valid(body) and body.get_meta("source_actor", -1) == actor.get_instance_id():
			game.remains.bodies.erase(body)
			body.queue_free()
	for home in rig.homes:
		if home.has("template") and is_instance_valid(home.template): home.template.free()
	game.skeleton_structure.records.erase(actor.get_instance_id())
	game.animation.actors.erase(actor.get_instance_id())
	game.melee.tracks.erase(axe.get_instance_id())
	axe.queue_free()
	actor.queue_free()
	print("SKELETON_COMBAT_RESULT ", JSON.stringify(failures))
	game.get_tree().quit(0 if failures.is_empty() else 1)
