extends RefCounted
## Skeleton-only contact. Call after guardian_authored.tick, while the rendered
## attack pose and combat_progress refer to this frame. Damage stays with combat.
## Returns true once per attack when the visible right-arm sweep intersects the
## supplied Hero/fairy capsule. A new attack_started value resets the latch.

const STRIKE_BEGIN := 0.65
const STRIKE_END := 0.8
const SAMPLE_STEP := 0.0125
const BLADE_RADIUS := 0.105

var game
var states := {} # actor id -> {started, progress, target_from, target_to, hit}

func setup(owner_game) -> void:
	game = owner_game

func contact(actor: Node3D, target_from: Vector3, target_to: Vector3, target_radius: float) -> bool:
	if not is_instance_valid(actor) or not bool(actor.get_meta("alive", true)): return false
	if bool(actor.get_meta("skeleton_missing_arm_r", false)): return false
	var adapter = game.guardian_authored if game != null else null
	if adapter == null: return false
	var entry: Dictionary = adapter.entries.get(actor.get_instance_id(), {})
	if entry.is_empty() or bool(entry.get("shattered", false)): return false
	var started := float(actor.get_meta("attack_started", -1.0))
	var current := clampf(float(actor.get_meta("combat_progress", 0.0)), 0.0, 1.0)
	var id := actor.get_instance_id()
	var state: Dictionary = states.get(id, {})
	if state.is_empty() or not is_equal_approx(float(state.started), started):
		state = {"started": started, "progress": 0.0, "target_from": target_from,
			"target_to": target_to, "hit": false}
	states[id] = state
	var previous := float(state.progress)
	state.progress = current
	var old_from: Vector3 = state.target_from
	var old_to: Vector3 = state.target_to
	state.target_from = target_from
	state.target_to = target_to
	if bool(state.hit) or current <= STRIKE_BEGIN or previous >= STRIKE_END: return false
	# The attack clip is seeked in small progress increments so even a single
	# frame crossing the whole 0.15 strike window cannot tunnel through a head.
	var from_progress := maxf(previous, STRIKE_BEGIN)
	var to_progress := minf(current, STRIKE_END)
	if to_progress <= from_progress: return false
	var count := maxi(1, ceili((to_progress - from_progress) / SAMPLE_STEP))
	# Fast room-scale movement also needs finer samples through the strike.
	count = mini(64, maxi(count, ceili(maxf(old_from.distance_to(target_from), old_to.distance_to(target_to)) / 0.10)))
	var struck := false
	var previous_segment := {}
	var saved_pose := _save_pose(entry)
	# Contact probes must observe the unblended strike clip. _seek also advances
	# transition age and rewrites base_pose, so freeze and restore that state.
	entry.pose_delta = 0.0
	for index in range(count + 1):
		var fraction := float(index) / float(count)
		var progress := lerpf(from_progress, to_progress, fraction)
		adapter._seek(entry, "attack", progress)
		var segment := _weapon_segment(entry)
		if segment.is_empty(): continue
		var elapsed_fraction := clampf((progress - previous) / maxf(current - previous, 0.000001), 0.0, 1.0)
		var moving_from := old_from.lerp(target_from, elapsed_fraction)
		var moving_to := old_to.lerp(target_to, elapsed_fraction)
		if _segments_close(segment.a, segment.b, moving_from, moving_to, target_radius + BLADE_RADIUS):
			struck = true
		elif not previous_segment.is_empty():
			# Sweep both ends of the weapon between neighbouring clip samples.
			struck = _segments_close(previous_segment.a, segment.a, moving_from, moving_to, target_radius + BLADE_RADIUS) \
				or _segments_close(previous_segment.b, segment.b, moving_from, moving_to, target_radius + BLADE_RADIUS)
		previous_segment = segment
		if struck: break
	# Restore authored animation plus secondary bone personality, flinch and IK.
	_restore_pose(entry, saved_pose)
	if struck and _clear_path(actor, target_from, target_to, target_radius): state.hit = true
	else: struck = false
	return struck

func reset(actor: Node3D) -> void:
	if is_instance_valid(actor): states.erase(actor.get_instance_id())

func _weapon_segment(entry: Dictionary) -> Dictionary:
	var skeleton: Skeleton3D = entry.get("skeleton")
	if skeleton == null: return {}
	var right_mesh = entry.part_meshes.get("arm_r")
	if not is_instance_valid(right_mesh) or not right_mesh.visible: return {}
	var hand := _socket(entry, "RightHand")
	var tip := _socket(entry, "WeaponTip")
	if hand != Vector3.INF and tip != Vector3.INF:
		return {"a": hand, "b": tip}
	var arm_index := int(entry.bones.get("RightArm", -1))
	if arm_index < 0: return {}
	var arm_pose: Transform3D = skeleton.global_transform * skeleton.get_bone_global_pose(arm_index)
	# Legacy GLBs fuse forearm and weapon. Derive its lower half from actual
	# imported RightArm mesh bounds in the bone's bind space, then animate it.
	# Named RightHand/WeaponTip sockets on newer rigs override this fallback.
	if not entry.has("contact_bind_segment"):
		entry.contact_bind_segment = _bind_segment(skeleton, right_mesh, arm_index)
	var bind: Dictionary = entry.contact_bind_segment
	if bind.is_empty(): return {}
	return {"a": arm_pose * bind.a, "b": arm_pose * bind.b}

func _bind_segment(skeleton: Skeleton3D, mesh: MeshInstance3D, arm_index: int) -> Dictionary:
	var box := mesh.get_aabb()
	if box.size.length_squared() < 0.00001: return {}
	var mesh_to_bind: Transform3D = skeleton.global_transform.affine_inverse() * mesh.global_transform
	var bone_from_bind: Transform3D = skeleton.get_bone_global_rest(arm_index).affine_inverse()
	var low := Vector3.INF
	var high := -Vector3.INF
	for x in [box.position.x, box.end.x]:
		for y in [box.position.y, box.end.y]:
			for z in [box.position.z, box.end.z]:
				var corner: Vector3 = bone_from_bind * (mesh_to_bind * Vector3(x, y, z))
				low = low.min(corner)
				high = high.max(corner)
	var center := Vector3((low.x + high.x) * 0.5, 0.0, (low.z + high.z) * 0.5)
	return {"a": center + Vector3.UP * lerpf(low.y, high.y, 0.43),
		"b": center + Vector3.UP * low.y}

func _save_pose(entry: Dictionary) -> Dictionary:
	var skeleton: Skeleton3D = entry.skeleton
	var bones := []
	for index in range(skeleton.get_bone_count()):
		bones.append([skeleton.get_bone_pose_position(index), skeleton.get_bone_pose_rotation(index), skeleton.get_bone_pose_scale(index)])
	return {"bones": bones, "visual": entry.visual.transform,
		"clip": str(entry.active_clip), "time": (entry.player as AnimationPlayer).current_animation_position,
		"base_pose": (entry.get("base_pose", []) as Array).duplicate(true),
		"blend_from": (entry.get("blend_from", []) as Array).duplicate(true),
		"blend_age": float(entry.get("blend_age", 1.0)),
		"pose_delta": float(entry.get("pose_delta", 0.0))}

func _restore_pose(entry: Dictionary, saved: Dictionary) -> void:
	var player: AnimationPlayer = entry.player
	if str(saved.clip) != "":
		if player.current_animation != str(saved.clip):
			player.play(str(saved.clip))
			player.pause()
		player.seek(float(saved.time), true)
	entry.active_clip = str(saved.clip)
	var skeleton: Skeleton3D = entry.skeleton
	for index in range(skeleton.get_bone_count()):
		var pose: Array = saved.bones[index]
		skeleton.set_bone_pose_position(index, pose[0])
		skeleton.set_bone_pose_rotation(index, pose[1])
		skeleton.set_bone_pose_scale(index, pose[2])
	entry.visual.transform = saved.visual
	entry.base_pose = saved.base_pose
	entry.blend_from = saved.blend_from
	entry.blend_age = saved.blend_age
	entry.pose_delta = saved.pose_delta

func _clear_path(actor: Node3D, target_from: Vector3, target_to: Vector3, target_radius: float) -> bool:
	# World geometry between the guardian chest and victim blocks the swing.
	# Endpoint tolerance allows the target's own collider to terminate the ray.
	var world := actor.get_world_3d()
	if world == null: return true
	var destination := target_from.lerp(target_to, 0.5)
	var origin := actor.global_position + Vector3.UP * 1.12
	if origin.distance_squared_to(destination) < 0.01: return true
	var query := PhysicsRayQueryParameters3D.create(origin, destination, 1)
	var result: Dictionary = world.direct_space_state.intersect_ray(query)
	return result.is_empty() or result.position.distance_to(destination) <= target_radius + 0.08

func _socket(entry: Dictionary, name: String) -> Vector3:
	var skeleton: Skeleton3D = entry.skeleton
	var bone := skeleton.find_bone(name)
	if bone < 0:
		for index in range(skeleton.get_bone_count()):
			if str(skeleton.get_bone_name(index)).begins_with(name + "_"):
				bone = index
				break
	if bone >= 0: return skeleton.global_transform * skeleton.get_bone_global_pose(bone).origin
	var node := entry.visual.find_child(name, true, false) as Node3D
	if node != null: return node.global_position
	return Vector3.INF

static func _segments_close(a: Vector3, b: Vector3, c: Vector3, d: Vector3, reach: float) -> bool:
	# Segment/segment closest points, including degenerate capsule or weapon.
	var u := b - a
	var v := d - c
	var w := a - c
	var uu := u.dot(u)
	var vv := v.dot(v)
	var uv := u.dot(v)
	var uw := u.dot(w)
	var vw := v.dot(w)
	var denom := uu * vv - uv * uv
	var s := 0.0
	var t := 0.0
	if uu <= 0.000001 and vv <= 0.000001: return a.distance_squared_to(c) <= reach * reach
	if uu <= 0.000001:
		t = clampf(vw / vv, 0.0, 1.0)
	elif vv <= 0.000001:
		s = clampf(-uw / uu, 0.0, 1.0)
	else:
		if denom > 0.000001: s = clampf((uv * vw - vv * uw) / denom, 0.0, 1.0)
		t = clampf((uv * s + vw) / vv, 0.0, 1.0)
		s = clampf((uv * t - uw) / uu, 0.0, 1.0)
	return (w + u * s - v * t).length_squared() <= reach * reach
