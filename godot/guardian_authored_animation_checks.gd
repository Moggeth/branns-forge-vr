extends SceneTree
## Run: Godot --headless --xr-mode off --path godot --script res://guardian_authored_animation_checks.gd

const Adapter = preload("res://guardian_authored_animation.gd")
var failures := []

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var fixture := Fixture.new()
	root.add_child(fixture)
	var adapter = Adapter.new()
	fixture.add_child(adapter)
	adapter.setup(fixture)
	var available := 0
	for variant in ["mossward", "prismwatch", "cinderkeep"]:
		var actor := Node3D.new()
		fixture.add_child(actor)
		actor.set_meta("alive", true)
		var part := Node3D.new()
		actor.add_child(part)
		var old_shield := MeshInstance3D.new()
		actor.add_child(old_shield)
		fixture.animation.actors[actor.get_instance_id()] = {"pieces": [part]}
		fixture.guardians.guardians[actor.get_instance_id()] = {"state": "carried", "shield": old_shield}
		var asset: String = adapter.asset_dir.path_join(variant + "_rig.glb")
		if not ResourceLoader.exists(asset):
			if FileAccess.file_exists(asset): failures.append("asset exists but needs Godot import: " + variant)
			if adapter.attach(actor, variant): failures.append("missing asset attached: " + variant)
			if not part.visible or not old_shield.visible: failures.append("fallback hid legacy art: " + variant)
			actor.free()
			continue
		available += 1
		if not adapter.attach(actor, variant):
			failures.append("asset did not attach: " + variant)
			actor.free()
			continue
		var entry: Dictionary = adapter.entries[actor.get_instance_id()]
		if part.visible or old_shield.visible or not entry.shield.visible: failures.append("carried visuals wrong: " + variant)
		adapter.mark_damage(actor, "arm_r", actor.to_global(Vector3(0.4, 1.0, 0)), 0)
		if entry.marks.size() != 1 or not entry.marks[0].visible: failures.append("animated crack mark missing: " + variant)
		adapter.hide_part(actor, "arm_r")
		if entry.part_meshes.arm_r.visible or entry.marks[0].visible: failures.append("severed arm or crack stayed visible: " + variant)
		actor.global_position.x += 0.12
		var gameplay_pose: Transform3D = actor.global_transform
		adapter.tick(0.016)
		if not str(entry.active_clip).to_lower().ends_with("walk"): failures.append("walk clip not selected: " + variant)
		actor.set_meta("combat_phase", "windup")
		actor.set_meta("combat_progress", 0.5)
		adapter.tick(0.016)
		if not str(entry.active_clip).to_lower().ends_with("attack"): failures.append("attack clip not selected: " + variant)
		var clip: Animation = entry.player.get_animation(entry.active_clip)
		if absf(entry.player.current_animation_position - clip.length * 0.5) > 0.02: failures.append("combat progress not mapped: " + variant)
		if not actor.global_transform.is_equal_approx(gameplay_pose): failures.append("animation moved gameplay root: " + variant)
		fixture.guardians.guardians[actor.get_instance_id()].state = "loose"
		adapter.tick(0.016)
		if entry.shield.visible or not old_shield.visible: failures.append("stolen shield visuals wrong: " + variant)
		adapter.before_shatter(actor)
		if entry.visual.visible or not part.visible: failures.append("debris handoff wrong: " + variant)
		actor.set_meta("combat_phase", "idle")
		fixture.guardians.guardians[actor.get_instance_id()].state = "carried"
		adapter.after_restore(actor)
		if not entry.visual.visible or part.visible or old_shield.visible or not entry.shield.visible: failures.append("restore visuals wrong: " + variant)
		if not entry.part_meshes.arm_r.visible or not entry.marks.is_empty(): failures.append("arm/crack did not reset: " + variant)
		actor.free()
	if failures.is_empty():
		print("GUARDIAN_AUTHORED_ANIMATION_PASS assets=", available)
		quit(0)
	else:
		for failure in failures: push_error(failure)
		quit(1)

class Fixture extends Node3D:
	var animation = AnimationState.new()
	var guardians = GuardianState.new()
	var tuning = TuningState.new()
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
