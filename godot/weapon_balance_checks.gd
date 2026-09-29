extends SceneTree

# Run: Godot --headless --xr-mode off --path godot --script res://weapon_balance_checks.gd
class FakeGame extends Node3D:
	var elapsed := 0.0
	var diagnostic_offline := true
	var camera: Node3D
	var notices := []

	func _notice(message: String, _seconds := 0) -> void:
		notices.append(message)

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures := []
	var game := FakeGame.new()
	root.add_child(game)
	game.camera = Node3D.new()
	game.add_child(game.camera)
	var hand := Node3D.new()
	game.add_child(hand)
	var guardians = preload("res://guardians/skeleton_guardians.gd").new()
	game.add_child(guardians)
	guardians.setup(game)
	for variant in ["mossward", "prismwatch", "cinderkeep"]:
		var actor := Node3D.new()
		game.add_child(actor)
		actor.set_meta("hp", 66.0) # adventure_runtime.setup's live skeleton HP
		var shield := Node3D.new()
		actor.add_child(shield)
		var record := {"actor": actor, "variant": variant, "shield": shield,
			"state": "carried", "integrity": 110.0, "raise": 0.0}
		guardians.guardians[actor.get_instance_id()] = record
		hand.global_position = actor.global_position + Vector3.BACK * 2.0
		var melee: float = guardians.filter_damage(actor, 58.0, hand)
		var bolt: float = guardians.filter_damage(actor, 95.0, hand, "projectile")
		# A shielded guardian survives a frontal blow; an exposed basic skeleton
		# takes meaningful damage from either weapon. Keep these as feel bounds,
		# not a duplicate of the shield formula.
		if melee <= 0.0 or melee >= 58.0: failures.append(variant + " frontal melee not mitigated")
		if bolt <= 0.0 or bolt >= 95.0: failures.append(variant + " frontal bolt not mitigated")
		if melee >= 66.0 or bolt >= 66.0: failures.append(variant + " shield fails to prevent one-hit kill")
		if record.integrity >= 110.0: failures.append(variant + " shield takes no wear")
		hand.global_position = actor.global_position + Vector3.FORWARD * 2.0
		if not is_equal_approx(guardians.filter_damage(actor, 58.0, hand), 58.0):
			failures.append(variant + " rear strike was blocked")
		hand.global_position = actor.global_position + Vector3.BACK * 2.0
		if not is_equal_approx(guardians.filter_damage(actor, 190.0, hand, "headshot"), 190.0):
			failures.append(variant + " clear skull shot was blocked")
		if 58.0 * 2.0 < float(actor.get_meta("hp")):
			failures.append(variant + " exposed skeleton survives two hard blows")
		print("WEAPON_BALANCE ", variant, " melee=", melee, " bolt=", bolt,
			" headshot=190 rear=58 hp=66")
		guardians.guardians.erase(actor.get_instance_id())
		actor.queue_free()
	print("WEAPON_BALANCE_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
