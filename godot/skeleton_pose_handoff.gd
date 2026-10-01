extends Node
## CPU snapshot of the visible skinned guardian for physical debris.
const PART_BONES := {"head":"Head", "arm_l":"LeftArm", "arm_r":"RightArm", "leg_l":"LeftLeg", "leg_r":"RightLeg", "rib":"Torso"}
var game
var history := {}

func setup(owner_game) -> void:
	game = owner_game

## Called after the authored adapter has applied its clip, recoil and foot planting.
func sample(actor: Node3D) -> void:
	var entry: Dictionary = _entry(actor)
	if entry.is_empty() or entry.get("shattered", false): return
	var skeleton: Skeleton3D = entry.get("skeleton")
	if skeleton == null: return
	var poses := {}
	for part in PART_BONES:
		var index := int(entry.bones.get(PART_BONES[part], -1))
		if index >= 0: poses[part] = skeleton.global_transform * skeleton.get_bone_global_pose(index)
	var now := Time.get_ticks_usec() * 0.000001
	var previous: Dictionary = history.get(actor.get_instance_id(), {})
	if previous.get("current", {}).get("time", -1.0) == now: return
	history[actor.get_instance_id()] = {"previous": previous.get("current", {}), "current": {"time": now, "poses": poses}}

func forget(actor: Node3D) -> void:
	history.erase(actor.get_instance_id())

func capture(actor: Node3D, part: String) -> Dictionary:
	var entry: Dictionary = _entry(actor)
	if entry.is_empty() or entry.get("shattered", false): return {}
	var skeleton: Skeleton3D = entry.get("skeleton")
	var mesh: MeshInstance3D = entry.part_meshes.get(part) if part != "rib" else _find_mesh(entry.visual, "Torso")
	if skeleton == null or not is_instance_valid(mesh) or mesh.mesh == null or not mesh.visible: return {}
	var index := int(entry.bones.get(PART_BONES.get(part, ""), -1))
	if index < 0: return {}
	var world_pose: Transform3D = skeleton.global_transform * skeleton.get_bone_global_pose(index)
	var joints := {}
	if part.begins_with("leg"):
		var side := "Left" if part == "leg_l" else "Right"
		for label in ["Knee", "Foot"]:
			var joint_index := int(entry.bones.get(side + label, -1))
			if joint_index >= 0:
				joints[label.to_lower()] = world_pose.affine_inverse() * (skeleton.global_transform * skeleton.get_bone_global_pose(joint_index).origin)
	var baked := _bake(mesh, skeleton, world_pose)
	if baked == null or baked.get_surface_count() == 0: return {}
	var velocity := Vector3.ZERO
	var spin := Vector3.ZERO
	var pair: Dictionary = history.get(actor.get_instance_id(), {})
	var before: Dictionary = pair.get("previous", {})
	var current: Dictionary = pair.get("current", {})
	var before_pose: Transform3D = before.get("poses", {}).get(part, world_pose)
	var current_pose: Transform3D = current.get("poses", {}).get(part, world_pose)
	var dt := float(current.get("time", 0.0)) - float(before.get("time", 0.0))
	if dt > 0.001 and dt < 0.25:
		velocity = ((current_pose.origin - before_pose.origin) / dt).limit_length(12.0)
		var rotation := before_pose.basis.orthonormalized().get_rotation_quaternion().inverse() * current_pose.basis.orthonormalized().get_rotation_quaternion()
		spin = (current_pose.basis * rotation.get_axis() * rotation.get_angle() / dt).limit_length(20.0) if absf(rotation.get_angle()) > 0.0001 else Vector3.ZERO
	return {"mesh": baked, "transform": world_pose, "linear_velocity": velocity, "angular_velocity": spin,
		"material_override": mesh.material_override, "material_overlay": mesh.material_overlay, "joints": joints, "part": part}

func _entry(actor: Node3D) -> Dictionary:
	if game == null or game.get("guardian_authored") == null or game.guardian_authored == null: return {}
	return game.guardian_authored.entries.get(actor.get_instance_id(), {})

func _find_mesh(node: Node, target: String) -> MeshInstance3D:
	if node is MeshInstance3D and (str(node.name) == target or str(node.name).ends_with("_" + target)): return node
	for child in node.get_children():
		var found := _find_mesh(child, target)
		if found != null: return found
	return null

func _bake(source: MeshInstance3D, skeleton: Skeleton3D, body_pose: Transform3D) -> ArrayMesh:
	var output := ArrayMesh.new()
	var skin: Skin = source.skin
	var inv_body := body_pose.affine_inverse()
	var bind_poses: Array[Transform3D] = []
	var bind_normals: Array[Basis] = []
	var valid_binds: Array[bool] = []
	if skin != null:
		for bind in range(skin.get_bind_count()):
			var name := skin.get_bind_name(bind)
			var bone_index := skeleton.find_bone(name) if name != "" else skin.get_bind_bone(bind)
			var valid := bone_index >= 0 and bone_index < skeleton.get_bone_count()
			valid_binds.append(valid)
			var pose := skeleton.global_transform * skeleton.get_bone_global_pose(bone_index) * skin.get_bind_pose(bind) if valid else Transform3D.IDENTITY
			bind_poses.append(pose)
			bind_normals.append(pose.basis.inverse().transposed() if valid else Basis.IDENTITY)
	for surface in range(source.mesh.get_surface_count()):
		var arrays: Array = source.mesh.surface_get_arrays(surface)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		if vertices.is_empty(): continue
		var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		var tangents: PackedFloat32Array = arrays[Mesh.ARRAY_TANGENT]
		var bones: PackedInt32Array = arrays[Mesh.ARRAY_BONES]
		var weights: PackedFloat32Array = arrays[Mesh.ARRAY_WEIGHTS]
		var influences := 8 if source.mesh.surface_get_format(surface) & Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS else 4
		var skinned_vertices := PackedVector3Array()
		var skinned_normals := PackedVector3Array()
		var skinned_tangents := PackedFloat32Array()
		skinned_vertices.resize(vertices.size())
		if not normals.is_empty(): skinned_normals.resize(normals.size())
		if not tangents.is_empty(): skinned_tangents.resize(tangents.size())
		for vertex in range(vertices.size()):
			var position := Vector3.ZERO
			var normal := Vector3.ZERO
			var tangent := Vector3.ZERO
			var total := 0.0
			if skin != null and bones.size() >= (vertex + 1) * influences and weights.size() >= (vertex + 1) * influences:
				for influence in range(influences):
					var slot := vertex * influences + influence
					var weight := weights[slot]
					var bind := bones[slot]
					if weight <= 0.0 or bind < 0 or bind >= bind_poses.size() or not valid_binds[bind]: continue
					var pose := bind_poses[bind]
					position += (pose * vertices[vertex]) * weight
					if not normals.is_empty(): normal += (bind_normals[bind] * normals[vertex]) * weight
					if not tangents.is_empty(): tangent += (pose.basis * Vector3(tangents[vertex*4],tangents[vertex*4+1],tangents[vertex*4+2])) * weight
					total += weight
			if total <= 0.0001:
				position = source.global_transform * vertices[vertex]
				if not normals.is_empty(): normal = source.global_basis.inverse().transposed() * normals[vertex]
				if not tangents.is_empty(): tangent = source.global_basis * Vector3(tangents[vertex*4],tangents[vertex*4+1],tangents[vertex*4+2])
			else:
				position /= total
				if not normals.is_empty(): normal /= total
				if not tangents.is_empty(): tangent /= total
			skinned_vertices[vertex] = inv_body * position
			if not normals.is_empty(): skinned_normals[vertex] = (body_pose.basis.transposed() * normal).normalized()
			if not tangents.is_empty():
				var local_tangent := (inv_body.basis * tangent).normalized()
				if not normals.is_empty(): local_tangent = (local_tangent - skinned_normals[vertex] * local_tangent.dot(skinned_normals[vertex])).normalized()
				skinned_tangents[vertex*4] = local_tangent.x
				skinned_tangents[vertex*4+1] = local_tangent.y
				skinned_tangents[vertex*4+2] = local_tangent.z
				skinned_tangents[vertex*4+3] = tangents[vertex*4+3]
		arrays[Mesh.ARRAY_VERTEX] = skinned_vertices
		if not normals.is_empty(): arrays[Mesh.ARRAY_NORMAL] = skinned_normals
		if not tangents.is_empty(): arrays[Mesh.ARRAY_TANGENT] = skinned_tangents
		arrays[Mesh.ARRAY_BONES] = null
		arrays[Mesh.ARRAY_WEIGHTS] = null
		output.add_surface_from_arrays(source.mesh.surface_get_primitive_type(surface), arrays)
		var material: Material = source.get_surface_override_material(surface)
		if material == null: material = source.mesh.surface_get_material(surface)
		if material != null: output.surface_set_material(output.get_surface_count() - 1, material)
	return output
