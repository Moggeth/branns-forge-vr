extends RefCounted
## Independent foot contacts for the authored guardian skeletons. Call after the
## animation clip and upper-body personality have been posed for this frame.

const PLANT_FRACTION := 0.6
const TELEPORT_DISTANCE := 0.7
const MAX_REACH_CORRECTION := 0.38
const SWING_CLEARANCE := 0.10
const MIN_GROUND_NORMAL := 0.55
const TURN_TRIGGER_RADIANS := 0.13
const TURN_STEP_SECONDS := 0.22
const TURN_STEP_LIFT := 0.085

func reset(entry: Dictionary) -> void:
	entry.erase("foot_placement")

func apply(entry: Dictionary, delta: float, walking: bool, gait: float) -> void:
	var actor: Node3D = entry.get("actor")
	var skeleton: Skeleton3D = entry.get("skeleton")
	if not is_instance_valid(actor) or not is_instance_valid(skeleton): return
	var state: Dictionary = entry.get("foot_placement", {})
	var moved := actor.global_position.distance_to(state.get("actor_position", actor.global_position))
	if moved > TELEPORT_DISTANCE or delta > 0.35:
		state.clear()
	state["actor_position"] = actor.global_position
	# Guardian GLBs face +Z. This pole puts both knees ahead of their hips.
	var actor_forward := actor.global_basis.z.normalized()
	var previous_forward: Vector3 = state.get("last_forward", actor_forward)
	var turn_angle := acos(clampf(previous_forward.dot(actor_forward), -1.0, 1.0))
	state["last_forward"] = actor_forward
	state["turn_accumulated"] = float(state.get("turn_accumulated", 0.0)) + turn_angle
	var balance_requested := bool(entry.get("balance_step", actor.get_meta("skeleton_balance_step", false)))
	var balance_edge := balance_requested and not bool(state.get("balance_last", false))
	state["balance_last"] = balance_requested
	var missing_left := bool(actor.get_meta("skeleton_missing_leg_l", false))
	var missing_right := bool(actor.get_meta("skeleton_missing_leg_r", false))
	var has_turn_step := false
	for side in ["Left", "Right"]:
		if state.has(side) and float(state[side].get("turn_elapsed", -1.0)) >= 0.0:
			has_turn_step = true
	if not has_turn_step and (float(state.turn_accumulated) >= TURN_TRIGGER_RADIANS or balance_edge):
		var step_side: String = "Right" if str(state.get("next_turn_side", "Left")) == "Right" else "Left"
		if missing_left: step_side = "Right"
		if missing_right: step_side = "Left"
		state["next_turn_side"] = "Left" if step_side == "Right" else "Right"
		state["turn_accumulated"] = 0.0
		if not (missing_left and missing_right):
			var step_state: Dictionary = state.get(step_side, {})
			step_state["turn_elapsed"] = 0.0
			state[step_side] = step_state
	var one_legged := missing_left != missing_right
	var query_count := 0
	for side in ["Left", "Right"]:
		var hip: int = int(entry.bones.get(side + "Leg", -1))
		var knee: int = int(entry.bones.get(side + "Knee", entry.bones.get(side + "Shin", -1)))
		if knee < 0: knee = int(entry.bones.get(side + "Shin", -1))
		var ankle: int = int(entry.bones.get(side + "Foot", -1))
		var missing := bool(actor.get_meta("skeleton_missing_leg_l" if side == "Left" else "skeleton_missing_leg_r", false))
		if missing or hip < 0 or knee < 0 or ankle < 0:
			state.erase(side)
			continue
		if skeleton.get_bone_parent(knee) != hip or skeleton.get_bone_parent(ankle) != knee:
			state.erase(side)
			continue
		var foot_world := _bone_world(skeleton, ankle)
		var phase := fposmod(gait + (0.5 if side == "Right" else 0.0), 1.0)
		var planting := not walking or phase < PLANT_FRACTION
		var side_state: Dictionary = state.get(side, {})
		# The surviving foot supports a hop on landing, then follows the authored
		# takeoff pose freely while the guardian is airborne.
		if one_legged and walking:
			planting = gait < 0.25 or gait >= 0.72
			if not planting:
				side_state["planting"] = false
				side_state.erase("anchor")
				side_state.erase("turn_elapsed")
				state[side] = side_state
				continue
		var anchor: Vector3 = side_state.get("anchor", foot_world)
		var just_planted := side_state.is_empty() or (planting and not bool(side_state.get("planting", false)))
		var target_xz := foot_world
		if planting and not just_planted:
			target_xz.x = anchor.x
			target_xz.z = anchor.z
		# A long turn or a contact outside the leg's reach starts a new step.
		var hip_world := _bone_world(skeleton, hip)
		var planar_error := Vector2(target_xz.x - hip_world.x, target_xz.z - hip_world.z).length()
		if planting and planar_error > MAX_REACH_CORRECTION:
			just_planted = true
			target_xz = foot_world
		var turning := side_state.has("turn_elapsed")
		if turning:
			var turn_progress := clampf(float(side_state.turn_elapsed) / TURN_STEP_SECONDS, 0.0, 1.0)
			if not side_state.has("turn_from"):
				side_state["turn_from"] = anchor
				side_state["turn_to"] = foot_world + actor_forward * 0.06
				var to_point: Vector3 = side_state.turn_to
				to_point.y = anchor.y
				side_state["turn_to"] = to_point
			var turn_from: Vector3 = side_state.turn_from
			var turn_to: Vector3 = side_state.turn_to
			target_xz = turn_from.lerp(turn_to, turn_progress)
		var hit := _ground_at(actor, target_xz, foot_world.y)
		query_count += 1
		if hit.is_empty() or float(hit.normal.y) < MIN_GROUND_NORMAL:
			# A missing floor is a free leg, never a snap to an old contact.
			side_state["planting"] = false
			side_state.erase("anchor")
			side_state.erase("turn_elapsed")
			side_state.erase("turn_from")
			side_state.erase("turn_to")
			state[side] = side_state
			continue
		var sole_height := clampf(float(entry.get("foot_rest", {}).get(side, 0.08)), 0.015, 0.24)
		var target: Vector3 = hit.position + Vector3.UP * sole_height
		if turning:
			var progress := clampf(float(side_state.turn_elapsed) / TURN_STEP_SECONDS, 0.0, 1.0)
			target.y += TURN_STEP_LIFT * sin(PI * progress)
			if progress >= 1.0:
				side_state.erase("turn_elapsed")
				side_state.erase("turn_from")
				side_state.erase("turn_to")
				anchor = target
				side_state["anchor"] = anchor
			else:
				side_state["turn_elapsed"] = float(side_state.turn_elapsed) + minf(delta, 0.05)
		elif planting:
			if just_planted:
				anchor = target
			else:
				anchor.y = target.y
			target = anchor
			side_state["anchor"] = anchor
		else:
			side_state.erase("anchor")
			# Authoring supplies the stride. IK only adds toe clearance and terrain following.
			target.y = maxf(target.y + SWING_CLEARANCE * sin(PI * (phase - PLANT_FRACTION) / (1.0 - PLANT_FRACTION)), foot_world.y)
		var correction := target - foot_world
		if correction.length() > MAX_REACH_CORRECTION:
			target = foot_world + correction.normalized() * MAX_REACH_CORRECTION
		_solve_leg(skeleton, hip, knee, ankle, target, actor_forward)
		_tilt_foot(skeleton, ankle, hit.normal, actor)
		side_state["planting"] = planting
		state[side] = side_state
	state["rays_last_update"] = query_count
	entry["foot_placement"] = state

func _ground_at(actor: Node3D, point: Vector3, foot_y: float) -> Dictionary:
	var center_y := maxf(point.y, foot_y)
	var start := Vector3(point.x, center_y + 0.42, point.z)
	var end := Vector3(point.x, center_y - 0.82, point.z)
	var query := PhysicsRayQueryParameters3D.create(start, end, 1)
	if actor is CollisionObject3D: query.exclude = [(actor as CollisionObject3D).get_rid()]
	return actor.get_world_3d().direct_space_state.intersect_ray(query)

func _bone_world(skeleton: Skeleton3D, bone: int) -> Vector3:
	return skeleton.global_transform * skeleton.get_bone_global_pose(bone).origin

func _solve_leg(skeleton: Skeleton3D, hip: int, knee: int, ankle: int, target_world: Vector3, forward_world: Vector3) -> void:
	var h := _bone_world(skeleton, hip)
	var k := _bone_world(skeleton, knee)
	var a := _bone_world(skeleton, ankle)
	var upper := h.distance_to(k)
	var lower := k.distance_to(a)
	if upper < 0.025 or lower < 0.025: return
	var reach := target_world - h
	var distance := clampf(reach.length(), absf(upper - lower) + 0.005, upper + lower - 0.005)
	var direction := reach.normalized() if reach.length() > 0.001 else (a - h).normalized()
	var pole := forward_world - direction * forward_world.dot(direction)
	if pole.length_squared() < 0.0001: pole = (k - h) - direction * (k - h).dot(direction)
	if pole.length_squared() < 0.0001: pole = Vector3.RIGHT.cross(direction)
	if pole.length_squared() < 0.0001: return
	pole = pole.normalized()
	var along := (upper * upper + distance * distance - lower * lower) / (2.0 * distance)
	var outward := sqrt(maxf(0.0, upper * upper - along * along))
	var desired_knee := h + direction * along + pole * outward
	_rotate_bone_toward(skeleton, hip, k - h, desired_knee - h)
	k = _bone_world(skeleton, knee)
	a = _bone_world(skeleton, ankle)
	var desired_ankle := h + direction * distance
	_rotate_bone_toward(skeleton, knee, a - k, desired_ankle - k)

func _rotate_bone_toward(skeleton: Skeleton3D, bone: int, from: Vector3, to: Vector3) -> void:
	if from.length_squared() < 0.000001 or to.length_squared() < 0.000001: return
	var delta := Quaternion(from.normalized(), to.normalized())
	var world_rotation := skeleton.global_transform.basis.get_rotation_quaternion()
	var bone_rotation := skeleton.get_bone_global_pose(bone).basis.get_rotation_quaternion()
	var in_skeleton := world_rotation.inverse() * delta * world_rotation
	var local_delta := bone_rotation.inverse() * in_skeleton * bone_rotation
	skeleton.set_bone_pose_rotation(bone, (skeleton.get_bone_pose_rotation(bone) * local_delta).normalized())

func _tilt_foot(skeleton: Skeleton3D, ankle: int, ground_normal: Vector3, actor: Node3D) -> void:
	var local_normal := actor.global_basis.inverse() * ground_normal
	var pitch := clampf(atan2(local_normal.z, local_normal.y), -0.22, 0.22)
	var roll := clampf(-atan2(local_normal.x, local_normal.y), -0.18, 0.18)
	var tilt := Quaternion.from_euler(Vector3(pitch, 0.0, roll))
	skeleton.set_bone_pose_rotation(ankle, (skeleton.get_bone_pose_rotation(ankle) * tilt).normalized())
