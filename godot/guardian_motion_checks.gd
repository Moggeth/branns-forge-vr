extends SceneTree
## --headless --xr-mode off --audio-driver Dummy --path godot
##   --script res://guardian_motion_checks.gd [--bench]

const Adapter = preload("res://guardian_authored_animation.gd")
const VARIANTS := ["mossward", "prismwatch", "cinderkeep"]
var failures: Array[String] = []
var pending: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var game := Fixture.new()
	root.add_child(game)
	var floor := StaticBody3D.new()
	game.add_child(floor)
	floor.rotation.z = 0.10
	var floor_shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(30.0, 0.3, 15.0)
	floor_shape.shape = box
	floor_shape.position.y = -0.15
	floor.add_child(floor_shape)
	var adapter = Adapter.new()
	game.add_child(adapter)
	adapter.setup(game)
	await physics_frame
	for variant in VARIANTS:
		var actor := _spawn(game, adapter, variant, Vector3.ZERO)
		if actor == null: continue
		var entry: Dictionary = adapter.entries[actor.get_instance_id()]
		for side in ["Left", "Right"]:
			var hip := int(entry.bones.get(side + "Leg", -1))
			var knee := int(entry.bones.get(side + "Knee", -1))
			var foot := int(entry.bones.get(side + "Foot", -1))
			if hip < 0 or knee < 0 or foot < 0:
				pending.append(variant + ": " + side + " knee/foot chain awaits art export")
			else:
				_check(entry.skeleton.get_bone_parent(knee) == hip and entry.skeleton.get_bone_parent(foot) == knee,
					variant + " " + side + " knee/foot hierarchy invalid")
		var root_pose := actor.global_transform
		game.elapsed += 0.016
		adapter.tick(0.016)
		_check(actor.global_transform.is_equal_approx(root_pose), variant + " idle moved gameplay root")
		_check(entry.shield.visible, variant + " carried shield hidden")
		var base_head := _bone_rotation(entry, "Head")
		var base_torso := _bone_rotation(entry, "Torso")
		adapter.react_to_hit(actor, Vector3.FORWARD, 0.65, null, "head")
		adapter.tick(0.016)
		var head_response := _bone_rotation(entry, "Head").angle_to(base_head)
		var torso_response := _bone_rotation(entry, "Torso").angle_to(base_torso)
		_check(head_response > torso_response + 0.02, variant + " head hit did not localize")
		game.elapsed += 0.8
		adapter.tick(0.016)
		base_head = _bone_rotation(entry, "Head")
		base_torso = _bone_rotation(entry, "Torso")
		var base_left := _bone_rotation(entry, "LeftArm")
		adapter.react_to_hit(actor, Vector3.FORWARD, 0.65, null, "arm_l")
		adapter.tick(0.016)
		var left_response := _bone_rotation(entry, "LeftArm").angle_to(base_left)
		var torso_arm_response := _bone_rotation(entry, "Torso").angle_to(base_torso)
		_check(left_response > torso_arm_response + 0.02, variant + " left-arm hit did not localize")
		game.elapsed += 0.7
		adapter.hide_part(actor, "arm_l")
		adapter.tick(0.016)
		_check(not entry.part_meshes.arm_l.visible and entry.injury_part == "arm_l", variant + " missing arm still visible")
		game.elapsed += 0.55
		adapter.tick(0.016)
		_check(absf(float(entry.get("look_yaw", 0.0))) < 0.25, variant + " head look ran beyond clamp")
		actor.global_position += Vector3(0.08, 0.0, 0.0)
		actor.set_meta("skeleton_missing_leg_l", true)
		adapter.tick(0.016)
		var hop_clip := str(entry.clips.get("hop_right", ""))
		if hop_clip == "": pending.append(variant + ": hop_right clip awaits art export")
		else: _check(str(entry.active_clip) == hop_clip, variant + " missing left leg did not choose right hop")
		_check(actor.global_transform.origin.distance_to(root_pose.origin + Vector3(0.08, 0.0, 0.0)) < 0.0001, variant + " pose moved actor root")
		actor.set_meta("combat_phase", "windup")
		actor.set_meta("combat_progress", 0.5)
		var before_attack: Array = entry.base_pose.duplicate(true)
		adapter.tick(0.016)
		_check(str(entry.active_clip) == str(entry.clips.attack), variant + " attack did not select clip")
		_check(entry.blend_from == before_attack and float(entry.blend_age) <= 0.02,
			variant + " attack transition did not start from prior pose")
		for blend_frame in range(6):
			game.elapsed += 0.016
			adapter.tick(0.016)
		_check(float(entry.blend_age) >= 0.09, variant + " attack blend did not resolve")
		var attack_pose := actor.global_transform
		actor.rotation.y += 0.2
		actor.set_meta("combat_phase", "idle")
		adapter.tick(0.016)
		_check(absf(float(entry.get("look_yaw", 0.0))) > 0.001, variant + " head had no facing lag")
		_check(actor.global_position.is_equal_approx(attack_pose.origin), variant + " turn changed actor origin")
		adapter.before_shatter(actor)
		_check(not entry.visual.visible, variant + " shatter left authored visual visible")
		adapter.after_restore(actor)
		_check(entry.visual.visible and entry.part_meshes.arm_l.visible, variant + " restore left part hidden")
		_check(entry.base_pose.size() == entry.skeleton.get_bone_count() and entry.blend_from.is_empty(), variant + " restore transition state stale")
		_check(entry.injury_at < -50.0 and entry.hit_strength == 0.0, variant + " restore injury state stale")
		actor.queue_free()
	if OS.get_cmdline_user_args().has("--bench"):
		await _benchmark(game, adapter)
	var report := {"variants": VARIANTS, "pending": pending, "failures": failures}
	print("GUARDIAN_MOTION_CHECK ", JSON.stringify(report))
	for failure in failures: push_error(failure)
	quit(0 if failures.is_empty() else 1)

func _spawn(game: Fixture, adapter, variant: String, position: Vector3) -> Node3D:
	var actor := Node3D.new()
	game.add_child(actor)
	actor.global_position = position
	actor.set_meta("alive", true)
	actor.set_meta("combat_phase", "idle")
	var part := Node3D.new()
	actor.add_child(part)
	var old_shield := MeshInstance3D.new()
	actor.add_child(old_shield)
	game.animation.actors[actor.get_instance_id()] = {"pieces": [part]}
	game.guardians.guardians[actor.get_instance_id()] = {"state": "carried", "shield": old_shield, "variant": variant}
	if not adapter.attach(actor, variant):
		failures.append("Could not attach imported rig: " + variant)
		actor.queue_free()
		return null
	return actor

func _bone_rotation(entry: Dictionary, name: String) -> Quaternion:
	var index := int(entry.bones.get(name, -1))
	return entry.skeleton.get_bone_pose_rotation(index) if index >= 0 else Quaternion.IDENTITY

func _check(ok: bool, message: String) -> void:
	if not ok: failures.append(message)

func _benchmark(game: Fixture, adapter) -> void:
	for count in [12, 30, 60]:
		var actors: Array[Node3D] = []
		for index in range(count):
			var actor := _spawn(game, adapter, str(VARIANTS[index % VARIANTS.size()]), Vector3(float(index % 10) * 2.0, 0, float(index / 10) * 2.0))
			if actor != null: actors.append(actor)
		await physics_frame
		var start := Time.get_ticks_usec()
		for frame in range(30):
			game.elapsed += 1.0 / 60.0
			for actor in actors: actor.global_position.z += 0.60 / 60.0
			adapter.tick(1.0 / 60.0)
		var elapsed_ms := float(Time.get_ticks_usec() - start) / 1000.0
		print("GUARDIAN_MOTION_CPU ", JSON.stringify({"actors": actors.size(), "frames": 30, "total_ms": elapsed_ms, "ms_per_frame": elapsed_ms / 30.0}))
		for actor in actors: actor.queue_free()
		await process_frame

class Fixture extends Node3D:
	var animation = AnimationState.new()
	var guardians = GuardianState.new()
	var tuning = TuningState.new()
	var elapsed := 1.0
	var skeleton_pose_handoff = null
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
