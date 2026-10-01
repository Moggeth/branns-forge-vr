extends Node
## Visual adapter for the three skinned guardian GLBs. Gameplay, shield physics,
## collision and death debris remain owned by the existing guardian/actor systems.

var asset_dir := "res://guardians/rigged"
const PART_MESH_NAMES := {"head": "Head", "arm_l": "LeftArm", "arm_r": "RightArm", "leg_l": "LeftLeg", "leg_r": "RightLeg"}
var game
var entries := {} # actor id -> visual, player, clips, legacy rig and shield mesh
var feet := preload("res://guardian_foot_placement.gd").new()

func setup(owner_game) -> void:
	game = owner_game

## Call after guardians.attach(actor, variant). A missing/unimported GLB leaves the
## rigid guardian visible and usable. Returns true only when all clips exist.
func attach(actor: Node3D, variant: String) -> bool:
	if game == null or not is_instance_valid(actor): return false
	if entries.has(actor.get_instance_id()): return true
	var rig: Dictionary = game.animation.actors.get(actor.get_instance_id(), {})
	var guardian: Dictionary = game.guardians.guardians.get(actor.get_instance_id(), {})
	if rig.is_empty() or guardian.is_empty(): return false
	var path := asset_dir.path_join(variant + "_rig.glb")
	if not ResourceLoader.exists(path): return false
	var scene := load(path) as PackedScene
	if scene == null: return false
	var visual := scene.instantiate() as Node3D
	if visual == null: return false
	var player := _find_player(visual)
	var clips := {}
	if player != null:
		for kind in ["idle", "walk", "attack", "turn_left", "turn_right", "stagger", "hop_left", "hop_right", "inspect_arm"]:
			clips[kind] = _clip(player, kind)
	if player == null or clips.get("idle", "") == "" or clips.get("walk", "") == "" or clips.get("attack", "") == "":
		visual.free()
		return false
	visual.name = "AuthoredGuardianVisual"
	actor.add_child(visual)
	visual.position = Vector3.ZERO
	visual.rotation = Vector3.ZERO
	var shield := _find_mesh(visual, "Shield")
	if shield == null:
		visual.free()
		return false
	var part_meshes := {}
	for part in PART_MESH_NAMES:
		part_meshes[part] = _find_mesh(visual, PART_MESH_NAMES[part])
	var skeleton := _find_skeleton(visual)
	var bones := {}
	if skeleton != null:
		for bone_name in ["Root", "Torso", "Head", "Jaw", "LeftArm", "RightArm", "LeftLeg", "RightLeg", "LeftKnee", "RightKnee", "LeftFoot", "RightFoot", "LeftShin", "RightShin", "RightHand", "WeaponTip"]:
			bones[bone_name] = _bone_index(skeleton, bone_name)
	var entry := {"actor": actor, "rig": rig, "guardian": guardian, "visual": visual,
		"player": player, "clips": clips, "shield": shield, "part_meshes": part_meshes, "distance": 0.0,
		"last": actor.global_position, "shattered": false, "active_clip": "",
		"skeleton": skeleton, "bones": bones, "hit_at": -100.0,
		"hit_direction": Vector3.ZERO, "hit_strength": 0.0, "hit_region": "rib",
		"marks": [], "foot_rest": {}, "walk_weight": 0.0, "velocity": Vector3.ZERO,
		"facing": actor.rotation.y, "turn_clock": 0.0, "look_yaw": 0.0,
		"base_pose": [], "blend_from": [], "blend_age": 1.0, "pose_delta": 0.0,
		"injury_at": -100.0, "injury_part": "", "balance_step": false}
	entries[actor.get_instance_id()] = entry
	_set_legacy_parts(rig, false)
	_sync_shield(entry)
	_seek(entry, "idle", 0.0)
	if skeleton != null:
		for side in ["Left", "Right"]:
			var foot_index: int = int(bones.get(side + "Foot", -1))
			if foot_index >= 0:
				entry.foot_rest[side] = (skeleton.global_transform * skeleton.get_bone_global_pose(foot_index).origin).y - actor.global_position.y
	return true

func tick(delta: float) -> void:
	for id in entries.keys():
		var entry: Dictionary = entries[id]
		var actor = entry.actor
		if not is_instance_valid(actor):
			entries.erase(id)
			continue
		if entry.shattered or not bool(actor.get_meta("alive", true)): continue
		var moved: Vector3 = actor.global_position - entry.last
		entry.last = actor.global_position
		var step := Vector2(moved.x, moved.z).length()
		if step >= 0.5:
			feet.reset(entry)
			entry.velocity = Vector3.ZERO
			entry.base_pose.clear()
		_sync_shield(entry)
		if not actor.is_visible_in_tree(): continue
		if step < 0.5: entry.distance += step
		entry.pose_delta = clampf(delta, 0.0, 0.1)
		var desired_velocity := moved / maxf(delta, 0.001) if step < 0.5 else Vector3.ZERO
		entry.velocity = (entry.velocity as Vector3).lerp(desired_velocity, 1.0 - exp(-delta * 12.0))
		var turn := angle_difference(float(entry.facing), actor.rotation.y)
		entry.facing = actor.rotation.y
		var phase := str(actor.get_meta("combat_phase", "idle"))
		var progress := clampf(float(actor.get_meta("combat_progress", 0.0)), 0.0, 1.0)
		var moving := step > 0.0001 and step < 0.5
		entry.walk_weight = move_toward(float(entry.walk_weight), 1.0 if moving else 0.0, delta * 8.0)
		var gait := 0.0
		if phase in ["windup", "strike", "recovery"]:
			_seek(entry, "attack", progress)
		elif float(game.elapsed) - float(entry.hit_at) < 0.55 and float(entry.hit_strength) > 0.72:
			_seek(entry, "stagger", (float(game.elapsed) - float(entry.hit_at)) / 0.55)
		elif moving:
			var stride := 0.60
			if game.tuning != null: stride *= maxf(0.1, float(game.tuning.value("enemy.stride")))
			gait = fposmod(entry.distance / stride, 1.0)
			var locomotion := "walk"
			if actor.get_meta("skeleton_missing_leg_l", false): locomotion = "hop_right"
			elif actor.get_meta("skeleton_missing_leg_r", false): locomotion = "hop_left"
			_seek(entry, locomotion, gait)
		elif absf(turn) > 0.006:
			entry.turn_clock = fposmod(float(entry.turn_clock) + delta * 1.8, 1.0)
			gait = entry.turn_clock
			_seek(entry, "turn_left" if turn > 0.0 else "turn_right", gait)
		else:
			_seek(entry, "idle", fposmod(float(game.elapsed) * 0.5 + float(id % 17) / 17.0, 1.0))
		_apply_personality(entry, moving and not phase in ["windup", "strike", "recovery"], gait, phase)
		feet.apply(entry, delta, moving and not phase in ["windup", "strike", "recovery"], gait)
		_sync_shield(entry)
		var handoff = game.get("skeleton_pose_handoff")
		if handoff != null: handoff.sample(actor)

## Add a short visible flinch after an impact. direction is a world-space push
## direction; strength is normalized to 0..1 by the damage caller.
func react_to_hit(actor: Node3D, direction: Vector3, strength: float = 1.0, point = null, region := "") -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty() or entry.shattered: return
	entry.hit_at = float(game.elapsed)
	entry.hit_direction = actor.global_basis.inverse() * direction.normalized()
	entry.hit_strength = clampf(strength, 0.0, 1.0)
	if region == "" and point is Vector3:
		var local := actor.to_local(point)
		region = "head" if local.y >= 1.43 else ("leg_l" if local.x < 0 else "leg_r") if local.y < 0.78 else ("arm_l" if local.x < 0 else "arm_r") if absf(local.x) > 0.30 else "rib"
	entry.hit_region = region if region != "" else "rib"
	entry.balance_step = strength > 0.72
	if strength > 0.72:
		actor.set_meta("skeleton_stagger_until", float(game.elapsed) + 0.35)

## Hide the living source immediately after its current pose is captured for
## physical remains, so the guardian cannot appear to regrow the detached part.
func hide_part(actor: Node3D, part: String) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty() or entry.shattered: return
	entry.injury_at = float(game.elapsed)
	entry.injury_part = part
	var mesh = entry.part_meshes.get(part)
	if is_instance_valid(mesh): mesh.visible = false
	for mark in entry.marks:
		if is_instance_valid(mark) and mark.get_meta("part", "") == part: mark.visible = false

## A small fracture rides the animated bone. The legacy debris mesh is hidden
## while the authored rig is alive, so marks on that mesh alone cannot be seen.
func mark_damage(actor: Node3D, part: String, point: Vector3, index: int) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty() or entry.shattered: return
	var skeleton: Skeleton3D = entry.skeleton
	var bone_name: String = {"head": "Head", "arm_l": "LeftArm", "arm_r": "RightArm",
		"leg_l": "LeftLeg", "leg_r": "RightLeg", "rib": "Torso"}.get(part, "")
	var bone: int = int(entry.bones.get(bone_name, -1))
	if skeleton == null or bone < 0: return
	var attachment := BoneAttachment3D.new()
	attachment.name = "FractureAttachment"
	attachment.bone_name = skeleton.get_bone_name(bone)
	attachment.set_meta("part", part)
	skeleton.add_child(attachment)
	var mark := MeshInstance3D.new()
	mark.name = "BoneCrack"
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.15, 0.012, 0.018)
	mark.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("41352f")
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mark.material_override = material
	attachment.add_child(mark)
	mark.position = attachment.to_local(point)
	mark.rotation.z = 0.42 + index * 0.62
	entry.marks.append(attachment)

func _apply_personality(entry: Dictionary, walking: bool, gait: float, phase: String) -> void:
	var skeleton: Skeleton3D = entry.skeleton
	if skeleton == null: return
	var variant := str(entry.guardian.get("variant", "mossward"))
	var cycle := gait * TAU
	var walk_mix := float(entry.walk_weight)
	var attack_mix := 0.25 if phase in ["windup", "strike", "recovery"] else 1.0
	var wobble := sin(cycle) * walk_mix
	var step_bounce := pow(absf(sin(cycle)), 1.4) * walk_mix
	var uneven := sin(cycle + (0.35 if variant == "mossward" else -0.2)) * walk_mix
	var hit_age := float(game.elapsed) - float(entry.hit_at)
	# A damped sideways jolt reads as loose bone without moving the gameplay root.
	var hit := maxf(0.0, 1.0 - hit_age / 0.45) * (0.82 + 0.18 * cos(hit_age * 25.0)) * float(entry.hit_strength)
	var push: Vector3 = entry.hit_direction * hit
	var region := str(entry.hit_region)
	var body_hit := 1.0 if region == "rib" else 0.25 if region == "arm_l" else 0.12
	var head_hit := 1.2 if region == "head" else 0.28
	var local_velocity: Vector3 = entry.actor.global_basis.inverse() * entry.velocity
	var lean := Vector3(-clampf(local_velocity.z * 0.05, -0.08, 0.08), 0.0, clampf(local_velocity.x * 0.035, -0.06, 0.06))
	var actor: Node3D = entry.actor
	var turn := angle_difference(float(entry.get("head_facing", actor.rotation.y)), actor.rotation.y)
	entry.head_facing = lerp_angle(float(entry.get("head_facing", actor.rotation.y)), actor.rotation.y, 1.0 - exp(-float(entry.pose_delta) * 7.0))
	entry.look_yaw = clampf(-turn, -0.24, 0.24)
	var injury_age := float(game.elapsed) - float(entry.injury_at)
	var glance := sin(clampf((injury_age - 0.15) / 1.15, 0.0, 1.0) * PI) if str(entry.injury_part).begins_with("arm") else 0.0
	var glance_yaw := (-0.65 if entry.injury_part == "arm_l" else 0.65) * glance
	_bone_add(entry, "Torso", lean + Vector3(-0.05 * step_bounce, 0.05 * uneven, -0.075 * wobble) * attack_mix + Vector3(-push.z * 0.31, 0.0, -push.x * 0.34) * body_hit)
	_bone_add(entry, "Head", Vector3(0.025 * step_bounce + 0.18 * glance, -0.06 * uneven + entry.look_yaw + glance_yaw, 0.07 * wobble) * attack_mix + Vector3(push.z * 0.38, 0.0, push.x * 0.4) * head_hit)
	_bone_add(entry, "Jaw", Vector3((sin(float(game.elapsed) * 17.0) * 0.02 + 0.025) * walk_mix + 0.1 * hit, 0, 0))
	_bone_add(entry, "RightArm", Vector3(0.07 * sin(cycle + 0.7) * walk_mix, 0.0, 0.04 * uneven) * attack_mix + Vector3(push.z * 0.45, 0.0, push.x * 0.45) * (1.0 if region == "arm_r" else 0.10))
	_bone_add(entry, "LeftArm", Vector3(0.035 * sin(cycle + 2.0) * walk_mix, 0.0, -0.02 * uneven) * attack_mix + Vector3(push.z * 0.34, 0, push.x * 0.38) * (1.0 if region == "arm_l" else 0.08))
	_bone_add(entry, "LeftKnee", Vector3(hit * 0.13 if region == "leg_l" else 0.0, 0, 0))
	_bone_add(entry, "RightKnee", Vector3(hit * 0.13 if region == "leg_r" else 0.0, 0, 0))
	if actor.get_meta("skeleton_missing_arm_l", false):
		_bone_add(entry, "Torso", Vector3(0, -0.07, 0.055) * attack_mix)
		_bone_add(entry, "RightArm", Vector3(0.06, 0, -0.07) * attack_mix)
	entry.visual.position.y = 0.025 * step_bounce - 0.035 * hit
	entry.visual.position.x = -push.x * 0.11 * body_hit
	entry.visual.position.z = -push.z * 0.11 * body_hit

func _bone_add(entry: Dictionary, name: String, rotation: Vector3) -> void:
	var index: int = int(entry.bones.get(name, -1))
	if index < 0: return
	var skeleton: Skeleton3D = entry.skeleton
	skeleton.set_bone_pose_rotation(index, skeleton.get_bone_pose_rotation(index) * Quaternion.from_euler(rotation))

## Called by remains.shatter after it captures authored parts in their current
## pose. Legacy homes remain available for actors without an imported rig.
func before_shatter(actor: Node3D) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty(): return
	entry.shattered = true
	entry.visual.visible = false
	_set_legacy_parts(entry.rig, true)
	var shield = entry.guardian.get("shield")
	if is_instance_valid(shield): shield.visible = true

## Call after animation.restore(actor), before making the actor visible again.
func after_restore(actor: Node3D) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty(): return
	for mark in entry.marks:
		if is_instance_valid(mark): mark.queue_free()
	entry.marks.clear()
	entry.shattered = false
	entry.distance = 0.0
	entry.last = actor.global_position
	entry.hit_at = -100.0
	entry.hit_strength = 0.0
	entry.hit_region = "rib"
	entry.walk_weight = 0.0
	entry.velocity = Vector3.ZERO
	entry.facing = actor.rotation.y
	entry.injury_at = -100.0
	entry.balance_step = false
	entry.base_pose.clear()
	entry.blend_from.clear()
	entry.blend_age = 1.0
	entry.pose_delta = 0.0
	entry.head_facing = actor.rotation.y
	feet.reset(entry)
	actor.remove_meta("skeleton_stagger_until")
	var handoff = game.get("skeleton_pose_handoff")
	if handoff != null: handoff.forget(actor)
	entry.visual.position = Vector3.ZERO
	entry.visual.visible = true
	for mesh in entry.part_meshes.values():
		if is_instance_valid(mesh): mesh.visible = true
	_set_legacy_parts(entry.rig, false)
	_sync_shield(entry)
	_seek(entry, "idle", 0.0)

func _set_legacy_parts(rig: Dictionary, show: bool) -> void:
	for piece in rig.pieces:
		if is_instance_valid(piece): piece.visible = show

func _sync_shield(entry: Dictionary) -> void:
	var carried: bool = str(entry.guardian.get("state", "")) == "carried"
	entry.shield.visible = carried
	var old_shield = entry.guardian.get("shield")
	if is_instance_valid(old_shield): old_shield.visible = not carried

func _seek(entry: Dictionary, kind: String, fraction: float) -> void:
	var player: AnimationPlayer = entry.player
	var name: String = str(entry.clips.get(kind, ""))
	if name == "": name = entry.clips.walk if kind.begins_with("hop") else entry.clips.idle
	var skeleton: Skeleton3D = entry.skeleton
	var changed: bool = entry.active_clip != name
	if changed and not entry.base_pose.is_empty():
		entry.blend_from = entry.base_pose.duplicate()
		entry.blend_age = 0.0
	if skeleton != null: skeleton.reset_bone_poses()
	if entry.active_clip != name:
		player.play(name)
		player.pause()
		entry.active_clip = name
	var animation: Animation = player.get_animation(name)
	player.seek(clampf(fraction, 0.0, 0.9999) * animation.length, true)
	if skeleton == null: return
	var delta := float(entry.get("pose_delta", 0.0))
	entry.blend_age = float(entry.blend_age) + delta
	var blend := smoothstep(0.0, 0.09 if kind == "attack" else 0.16, float(entry.blend_age))
	var snapshot: Array = []
	for index in range(skeleton.get_bone_count()):
		var position := skeleton.get_bone_pose_position(index)
		var rotation := skeleton.get_bone_pose_rotation(index)
		var scale := skeleton.get_bone_pose_scale(index)
		if delta > 0.0 and blend < 1.0 and entry.blend_from.size() == skeleton.get_bone_count():
			var previous: Array = entry.blend_from[index]
			position = (previous[0] as Vector3).lerp(position, blend)
			rotation = (previous[1] as Quaternion).slerp(rotation, blend)
			scale = (previous[2] as Vector3).lerp(scale, blend)
			skeleton.set_bone_pose_position(index, position)
			skeleton.set_bone_pose_rotation(index, rotation)
			skeleton.set_bone_pose_scale(index, scale)
		snapshot.append([position, rotation, scale])
	entry.base_pose = snapshot

func _clip(player: AnimationPlayer, suffix: String) -> String:
	for name in player.get_animation_list():
		var value := str(name)
		if value.to_lower() == suffix or value.to_lower().ends_with("/" + suffix): return value
	return ""

func _find_player(node: Node) -> AnimationPlayer:
	if node is AnimationPlayer: return node
	for child in node.get_children():
		var found := _find_player(child)
		if found != null: return found
	return null

func _find_skeleton(node: Node) -> Skeleton3D:
	if node is Skeleton3D: return node
	for child in node.get_children():
		var found := _find_skeleton(child)
		if found != null: return found
	return null

func _bone_index(skeleton: Skeleton3D, name: String) -> int:
	var exact := skeleton.find_bone(name)
	if exact >= 0: return exact
	# Godot disambiguates same-named mesh nodes and bones on GLB import.
	for index in range(skeleton.get_bone_count()):
		if str(skeleton.get_bone_name(index)).begins_with(name + "_"): return index
	return -1

func _find_mesh(node: Node, target: String) -> MeshInstance3D:
	var name := str(node.name)
	if node is MeshInstance3D and (name == target or name.ends_with("_" + target)): return node
	for child in node.get_children():
		var found := _find_mesh(child, target)
		if found != null: return found
	return null
