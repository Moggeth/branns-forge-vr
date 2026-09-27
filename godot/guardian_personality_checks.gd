extends SceneTree
## Run: Godot --headless --xr-mode off --path godot --script res://guardian_personality_checks.gd

const Adapter = preload("res://guardian_authored_animation.gd")
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var fixture := Fixture.new()
	root.add_child(fixture)
	var adapter := Adapter.new()
	fixture.add_child(adapter)
	adapter.setup(fixture)
	for variant in ["mossward", "prismwatch", "cinderkeep"]:
		var actor := Node3D.new()
		fixture.add_child(actor)
		actor.set_meta("alive", true)
		var part := Node3D.new()
		actor.add_child(part)
		var shield := MeshInstance3D.new()
		actor.add_child(shield)
		fixture.animation.actors[actor.get_instance_id()] = {"pieces": [part]}
		fixture.guardians.guardians[actor.get_instance_id()] = {"state": "carried", "shield": shield, "variant": variant}
		if not adapter.attach(actor, variant):
			failures.append(variant + " did not attach")
			actor.free()
			continue
		var entry: Dictionary = adapter.entries[actor.get_instance_id()]
		if entry.skeleton == null: failures.append(variant + " has no skeleton")
		else:
			for bone_name in ["Torso", "Head", "LeftLeg", "RightLeg"]:
				if int(entry.bones.get(bone_name, -1)) < 0: failures.append(variant + " missing " + bone_name)
		actor.position.x += 0.12
		var gameplay_pose := actor.global_transform
		adapter.tick(0.016)
		if entry.visual.position.y <= 0.0: failures.append(variant + " lacks step bounce")
		if entry.skeleton != null and int(entry.bones.get("Torso", -1)) >= 0:
			var torso: int = entry.bones.Torso
			var gait_pose: Quaternion = entry.skeleton.get_bone_pose_rotation(torso)
			adapter._seek(entry, "walk", 0.12 / 0.8)
			if gait_pose.angle_to(entry.skeleton.get_bone_pose_rotation(torso)) < 0.01:
				failures.append(variant + " lacks bone sway")
		if not entry.shield.visible: failures.append(variant + " lost shield while walking")
		if not actor.global_transform.is_equal_approx(gameplay_pose): failures.append(variant + " moved gameplay root")
		fixture.elapsed += 0.016
		adapter.react_to_hit(actor, Vector3.RIGHT, 1.0)
		adapter.tick(0.016)
		if entry.visual.position.x >= -0.02: failures.append(variant + " lacks impact recoil")
		actor.set_meta("combat_phase", "strike")
		actor.set_meta("combat_progress", 0.72)
		fixture.elapsed += 0.016
		adapter.tick(0.016)
		if not str(entry.active_clip).to_lower().ends_with("attack"): failures.append(variant + " lost attack")
		fixture.elapsed += 0.5
		actor.set_meta("combat_phase", "idle")
		adapter.tick(0.016)
		if absf(entry.visual.position.x) > 0.001: failures.append(variant + " recoil did not settle")
		adapter.before_shatter(actor)
		adapter.after_restore(actor)
		if entry.visual.position != Vector3.ZERO: failures.append(variant + " restore kept recoil")
		actor.free()
	if failures.is_empty():
		print("GUARDIAN_PERSONALITY_PASS")
		quit(0)
	else:
		for failure in failures: push_error(failure)
		quit(1)

class Fixture extends Node3D:
	var animation := AnimationState.new()
	var guardians := GuardianState.new()
	var tuning := TuningState.new()
	var elapsed := 1.0
	func _ready() -> void:
		add_child(animation)
		add_child(guardians)
		add_child(tuning)

class AnimationState extends Node:
	var actors := {}

class GuardianState extends Node:
	var guardians := {}

class TuningState extends Node:
	func value(_key: String) -> float: return 1.0
