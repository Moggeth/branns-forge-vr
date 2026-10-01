extends SceneTree
## Run only this disposable fixture: Godot --headless --xr-mode off --audio-driver Dummy
## --path godot --script res://guardian_foot_placement_checks.gd

const FootPlacement = preload("res://guardian_foot_placement.gd")
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var stage := Node3D.new()
	root.add_child(stage)
	var ground := StaticBody3D.new()
	stage.add_child(ground)
	var collision := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(20, 0.2, 20)
	collision.shape = box
	ground.add_child(collision)
	ground.position.y = -0.1
	var actor := Node3D.new()
	stage.add_child(actor)
	var visual := Node3D.new()
	actor.add_child(visual)
	var skeleton := Skeleton3D.new()
	visual.add_child(skeleton)
	var bones := {}
	for side in ["Left", "Right"]:
		var hip := skeleton.get_bone_count()
		var leg_name: String = side + "Leg"
		skeleton.add_bone(leg_name)
		bones[leg_name] = hip
		skeleton.set_bone_rest(hip, Transform3D(Basis.IDENTITY, Vector3(-0.2 if side == "Left" else 0.2, 0.94, 0)))
		var knee := skeleton.get_bone_count()
		var knee_name: String = side + "Knee"
		skeleton.add_bone(knee_name)
		bones[knee_name] = knee
		skeleton.set_bone_parent(knee, hip)
		skeleton.set_bone_rest(knee, Transform3D(Basis.IDENTITY, Vector3(0, -0.42, -0.08)))
		var ankle := skeleton.get_bone_count()
		var ankle_name: String = side + "Foot"
		skeleton.add_bone(ankle_name)
		bones[ankle_name] = ankle
		skeleton.set_bone_parent(ankle, knee)
		skeleton.set_bone_rest(ankle, Transform3D(Basis.IDENTITY, Vector3(0, -0.42, 0.08)))
	skeleton.reset_bone_poses()
	await physics_frame
	var entry := {"actor": actor, "visual": visual, "skeleton": skeleton, "bones": bones,
		"foot_rest": {"Left": 0.10, "Right": 0.10}}
	var helper = FootPlacement.new()
	helper.apply(entry, 1.0 / 60.0, false, 0.0)
	_check(entry.foot_placement.rays_last_update == 2, "standing uses two rays")
	var initial := _foot(skeleton, bones.LeftFoot)
	_check(absf(initial.y - 0.10) < 0.04, "foot follows flat ground")
	actor.position.x += 0.08
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, true, 0.12)
	var locked := _foot(skeleton, bones.LeftFoot)
	_check(absf(locked.x - initial.x) < 0.025, "planted foot locks world X through translation")
	_check(absf(actor.position.x - 0.08) < 0.0001, "IK does not translate gameplay actor")
	_check(entry.foot_placement.rays_last_update <= 2, "walking ray budget")
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 120.0, true, 0.12)
	var fast_frame := _foot(skeleton, bones.LeftFoot)
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 30.0, true, 0.12)
	_check(_foot(skeleton, bones.LeftFoot).distance_to(fast_frame) < 0.005,
		"stance is stable across frame rates")
	_check(_foot(skeleton, bones.LeftKnee).z > _foot(skeleton, bones.LeftLeg).z + 0.02,
		"knee pole bends forward along guardian +Z")
	# A turn should keep a reachable contact and release it on the next swing.
	actor.rotation.y = 0.25
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, true, 0.2)
	for frame in 6:
		_clear_pose(skeleton)
		helper.apply(entry, 1.0 / 60.0, true, 0.2)
	_check(_foot(skeleton, bones.LeftFoot).y > initial.y + 0.03, "turn step lifts foot")
	_check(entry.foot_placement.Left.has("turn_elapsed"), "turn step lasts across frames")
	for frame in 10:
		_clear_pose(skeleton)
		helper.apply(entry, 1.0 / 60.0, true, 0.2)
	_check(not entry.foot_placement.Left.has("turn_elapsed"), "turn step settles")
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, true, 0.8)
	_check(not entry.foot_placement.Left.has("anchor"), "swing releases old contact")
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, true, 0.05)
	_check(entry.foot_placement.Left.has("anchor"), "new stance replants")
	entry["balance_step"] = true
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, false, 0.0)
	_check(entry.foot_placement.Right.has("turn_elapsed"), "balance cue starts alternate foot step")
	entry["balance_step"] = false
	for frame in 15:
		_clear_pose(skeleton)
		helper.apply(entry, 1.0 / 60.0, false, 0.0)
	_check(not entry.foot_placement.Right.has("turn_elapsed"), "balance step settles")
	# Sloped support produces a bounded ankle tilt.
	ground.rotation.z = 0.12
	await physics_frame
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, false, 0.0)
	var tilt: Vector3 = skeleton.get_bone_pose_rotation(bones.LeftFoot).get_euler()
	_check(absf(tilt.z) > 0.03 and absf(tilt.z) < 0.19, "slope gives bounded ankle roll")
	# A missing limb cannot retain a phantom world contact.
	actor.set_meta("skeleton_missing_leg_l", true)
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, false, 0.0)
	_check(not entry.foot_placement.has("Left") and entry.foot_placement.rays_last_update == 1,
		"missing leg leaves sole support and one ray")
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, true, 0.4)
	_check(not entry.foot_placement.Right.has("anchor") and entry.foot_placement.rays_last_update == 0,
		"surviving foot releases contact during hop flight")
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, true, 0.82)
	_check(entry.foot_placement.Right.has("anchor"), "surviving foot replants on hop landing")
	actor.set_meta("skeleton_missing_leg_l", false)
	actor.position.x = 2.0
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, false, 0.0)
	_check(entry.foot_placement.Left.anchor.x > 1.5, "teleport discards old anchor")
	actor.position.x = 50.0
	_clear_pose(skeleton)
	helper.apply(entry, 1.0 / 60.0, false, 0.0)
	_check(not entry.foot_placement.Left.has("anchor"), "missed terrain leaves free foot")
	_check(_foot(skeleton, bones.LeftFoot).y > 0.0, "missed terrain never snaps foot down")
	helper.reset(entry)
	_check(not entry.has("foot_placement"), "restore clears contacts")
	ground.rotation = Vector3.ZERO
	await physics_frame
	_check_installed_rigs(stage, helper)
	stage.queue_free()
	if failures.is_empty():
		print("GUARDIAN_FOOT_PLACEMENT_PASS")
		quit(0)
	else:
		for failure in failures: push_error(failure)
		quit(1)

func _foot(skeleton: Skeleton3D, index: int) -> Vector3:
	return skeleton.global_transform * skeleton.get_bone_global_pose(index).origin

func _clear_pose(skeleton: Skeleton3D) -> void:
	for index in skeleton.get_bone_count(): skeleton.set_bone_pose_rotation(index, Quaternion.IDENTITY)

func _check(ok: bool, description: String) -> void:
	if not ok: failures.append(description)

func _check_installed_rigs(stage: Node3D, helper: RefCounted) -> void:
	for variant in ["mossward", "prismwatch", "cinderkeep"]:
		var path: String = "res://guardians/rigged/" + variant + "_rig.glb"
		if not ResourceLoader.exists(path):
			print("GUARDIAN_FOOT_RIG_PENDING ", variant, " (not imported)")
			continue
		var packed := load(path) as PackedScene
		if packed == null:
			failures.append(variant + " rig did not load")
			continue
		var rig := packed.instantiate() as Node3D
		var rig_actor := Node3D.new()
		stage.add_child(rig_actor)
		rig_actor.add_child(rig)
		var rig_skeleton := _find_skeleton(rig)
		if rig_skeleton == null:
			failures.append(variant + " skeleton missing")
			rig_actor.free()
			continue
		var rig_bones := {}
		for side in ["Left", "Right"]:
			for suffix in ["Leg", "Knee", "Shin", "Foot"]:
				var bone_name: String = side + suffix
				var bone_index := rig_skeleton.find_bone(bone_name)
				if bone_index < 0:
					for index in rig_skeleton.get_bone_count():
						if str(rig_skeleton.get_bone_name(index)).begins_with(bone_name + "_"):
							bone_index = index
							break
				rig_bones[bone_name] = bone_index
		var complete := true
		for side in ["Left", "Right"]:
			var knee_index: int = int(rig_bones[side + "Knee"])
			if knee_index < 0: knee_index = int(rig_bones[side + "Shin"])
			if int(rig_bones[side + "Leg"]) < 0 or knee_index < 0 or int(rig_bones[side + "Foot"]) < 0:
				complete = false
			elif rig_skeleton.get_bone_parent(knee_index) != int(rig_bones[side + "Leg"]) or rig_skeleton.get_bone_parent(int(rig_bones[side + "Foot"])) != knee_index:
				failures.append(variant + " leg hierarchy does not match IK chain: " + side)
		if not complete:
			print("GUARDIAN_FOOT_RIG_PENDING ", variant, " (articulated leg not installed)")
			rig_actor.free()
			continue
		var rig_rest := {}
		for side in ["Left", "Right"]:
			rig_rest[side] = clampf(_foot(rig_skeleton, int(rig_bones[side + "Foot"])).y, 0.015, 0.24)
		var rig_entry := {"actor": rig_actor, "visual": rig, "skeleton": rig_skeleton,
			"bones": rig_bones, "foot_rest": rig_rest}
		helper.apply(rig_entry, 1.0 / 60.0, false, 0.0)
		for side in ["Left", "Right"]:
			var hip_point := _foot(rig_skeleton, int(rig_bones[side + "Leg"]))
			var real_knee: int = int(rig_bones[side + "Knee"])
			if real_knee < 0: real_knee = int(rig_bones[side + "Shin"])
			var knee_point := _foot(rig_skeleton, real_knee)
			var foot_point := _foot(rig_skeleton, int(rig_bones[side + "Foot"]))
			print("GUARDIAN_FOOT_RIG ", variant, " ", side, " hip=", hip_point,
				" knee=", knee_point, " ankle=", foot_point, " sole=", rig_rest[side])
			_check(knee_point.z > hip_point.z + 0.005, variant + " actual knee bends forward " + side)
			_check(absf(foot_point.y - float(rig_rest[side])) < 0.06, variant + " actual sole height " + side)
		var planted_x := _foot(rig_skeleton, int(rig_bones["LeftFoot"])).x
		rig_actor.position.x = 0.08
		rig_skeleton.reset_bone_poses()
		helper.apply(rig_entry, 1.0 / 60.0, true, 0.12)
		_check(absf(_foot(rig_skeleton, int(rig_bones["LeftFoot"])).x - planted_x) < 0.03,
			variant + " actual foot contact locks across movement")
		rig_actor.position.x = 0.0
		var player := _find_player(rig)
		if player != null:
			var idle_name := ""
			for clip_name in player.get_animation_list():
				if str(clip_name).to_lower() == "idle" or str(clip_name).to_lower().ends_with("/idle"):
					idle_name = str(clip_name)
					break
			if idle_name != "":
				player.play(idle_name)
				player.pause()
				player.seek(0.0, true)
				var idle_ankle_y := _foot(rig_skeleton, int(rig_bones["LeftFoot"])).y
				helper.reset(rig_entry)
				helper.apply(rig_entry, 1.0 / 60.0, false, 0.0)
				var corrected_y := _foot(rig_skeleton, int(rig_bones["LeftFoot"])).y
				print("GUARDIAN_FOOT_IDLE ", variant, " ankle_before=", idle_ankle_y,
					" after=", corrected_y, " bind_sole=", rig_rest.Left)
				_check(absf(corrected_y - float(rig_rest.Left)) < 0.01,
					variant + " idle ankle aligns with bind sole offset")
				var idle_clip := player.get_animation(idle_name)
				for fraction in [0.25, 0.5, 0.75]:
					player.seek(float(fraction) * idle_clip.length, true)
					var animated_y := _foot(rig_skeleton, int(rig_bones["LeftFoot"])).y
					helper.reset(rig_entry)
					helper.apply(rig_entry, 1.0 / 60.0, false, 0.0)
					var grounded_y := _foot(rig_skeleton, int(rig_bones["LeftFoot"])).y
					print("GUARDIAN_FOOT_IDLE_PHASE ", variant, " fraction=", fraction,
						" animated=", animated_y, " grounded=", grounded_y)
					_check(absf(grounded_y - float(rig_rest.Left)) < 0.012,
						variant + " crouch preserves sole ground contact")
		for side in ["Left", "Right"]:
			var leg_mesh := _find_mesh(rig, side + "Leg")
			if leg_mesh != null:
				var local_bounds := leg_mesh.get_aabb()
				print("GUARDIAN_FOOT_BIND_MESH ", variant, " ", side,
					" local_y_min=", local_bounds.position.y,
					" local_y_max=", local_bounds.end.y)
		rig_actor.free()

func _find_skeleton(node: Node) -> Skeleton3D:
	if node is Skeleton3D: return node
	for child in node.get_children():
		var found := _find_skeleton(child)
		if found != null: return found
	return null

func _find_player(node: Node) -> AnimationPlayer:
	if node is AnimationPlayer: return node
	for child in node.get_children():
		var found := _find_player(child)
		if found != null: return found
	return null

func _find_mesh(node: Node, target: String) -> MeshInstance3D:
	if node is MeshInstance3D and (str(node.name) == target or str(node.name).ends_with("_" + target)):
		return node
	for child in node.get_children():
		var found := _find_mesh(child, target)
		if found != null: return found
	return null
