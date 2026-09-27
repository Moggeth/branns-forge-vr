extends Node
## Visual adapter for the three skinned guardian GLBs. Gameplay, shield physics,
## collision and death debris remain owned by the existing guardian/actor systems.

var asset_dir := "res://guardians/rigged"
const PART_MESH_NAMES := {"head": "Head", "arm_l": "LeftArm", "arm_r": "RightArm", "leg_l": "LeftLeg", "leg_r": "RightLeg"}
var game
var entries := {} # actor id -> visual, player, clips, legacy rig and shield mesh

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
		for kind in ["idle", "walk", "attack"]:
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
		for bone_name in ["Root", "Torso", "Head", "LeftArm", "RightArm", "LeftLeg", "RightLeg", "LeftKnee", "RightKnee", "LeftFoot", "RightFoot", "LeftShin", "RightShin"]:
			bones[bone_name] = _bone_index(skeleton, bone_name)
	var entry := {"actor": actor, "rig": rig, "guardian": guardian, "visual": visual,
		"player": player, "clips": clips, "shield": shield, "part_meshes": part_meshes, "distance": 0.0,
		"last": actor.global_position, "shattered": false, "active_clip": "",
		"skeleton": skeleton, "bones": bones, "hit_at": -100.0,
		"hit_direction": Vector3.ZERO, "hit_strength": 0.0, "marks": [], "foot_rest": {}}
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

func tick(_delta: float) -> void:
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
		if step < 0.5: entry.distance += step
		var phase := str(actor.get_meta("combat_phase", "idle"))
		var progress := clampf(float(actor.get_meta("combat_progress", 0.0)), 0.0, 1.0)
		var moving := step > 0.0001 and step < 0.5
		var gait := 0.0
		if phase in ["windup", "strike", "recovery"]:
			_seek(entry, "attack", progress)
		elif moving:
			# Mossward's authored walk covers 0.567m per cycle; 0.8m made its
			# planted foot visibly skate while the actor translated.
			var stride := 0.567 if str(entry.guardian.get("variant", "")) == "mossward" else 0.8
			if game.tuning != null: stride *= maxf(0.1, float(game.tuning.value("enemy.stride")))
			gait = fposmod(entry.distance / stride, 1.0)
			_seek(entry, "walk", gait)
		else:
			_seek(entry, "idle", fposmod(float(game.elapsed) * 0.5 + float(id % 17) / 17.0, 1.0))
		_apply_personality(entry, moving and not phase in ["windup", "strike", "recovery"], gait, phase)
		_plant_support_feet(entry, moving and not phase in ["windup", "strike", "recovery"], gait)
		_sync_shield(entry)

func _plant_support_feet(entry: Dictionary, moving: bool, gait: float) -> void:
	if str(entry.guardian.get("variant", "")) != "mossward": return
	var skeleton: Skeleton3D = entry.skeleton
	if skeleton == null: return
	var corrections: Array = []
	for side in ["Left", "Right"]:
		var phase := fposmod(gait + (0.5 if side == "Right" else 0.0), 1.0)
		if moving and phase >= 0.6: continue # swing foot must remain free
		var index: int = int(entry.bones.get(side + "Foot", -1))
		if index < 0 or not entry.foot_rest.has(side): continue
		var foot_world: Vector3 = skeleton.global_transform * skeleton.get_bone_global_pose(index).origin
		var ray := PhysicsRayQueryParameters3D.create(foot_world + Vector3.UP * 0.28, foot_world + Vector3.DOWN * 0.46, 1)
		var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
		if hit.is_empty() or hit.normal.y < 0.55: continue
		corrections.append(clampf(hit.position.y + float(entry.foot_rest[side]) - foot_world.y, -0.12, 0.12))
	if not corrections.is_empty():
		var correction := 0.0
		for value in corrections: correction += value
		entry.visual.position.y += correction / corrections.size()

## Add a short visible flinch after an impact. direction is a world-space push
## direction; strength is normalized to 0..1 by the damage caller.
func react_to_hit(actor: Node3D, direction: Vector3, strength: float = 1.0) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty() or entry.shattered: return
	entry.hit_at = float(game.elapsed)
	entry.hit_direction = actor.global_basis.inverse() * direction.normalized()
	entry.hit_strength = clampf(strength, 0.0, 1.0)

## The physical part belongs to the legacy debris rig. Hide its skinned mesh
## as well so an injured living guardian does not appear to regrow it.
func hide_part(actor: Node3D, part: String) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty() or entry.shattered: return
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
	var walk_mix := 1.0 if walking else 0.0
	var attack_mix := 0.25 if phase in ["windup", "strike", "recovery"] else 1.0
	var wobble := sin(cycle) * walk_mix
	var step_bounce := pow(absf(sin(cycle)), 1.4) * walk_mix
	var uneven := sin(cycle + (0.35 if variant == "mossward" else -0.2)) * walk_mix
	var hit_age := float(game.elapsed) - float(entry.hit_at)
	var hit := maxf(0.0, 1.0 - hit_age / 0.42) * float(entry.hit_strength)
	var push: Vector3 = entry.hit_direction * hit
	# The attack remains legible and the shield stays on the animated left arm.
	# These restrained secondary rotations make the rigid-bone walk feel fragile.
	_bone_add(entry, "Torso", Vector3(-0.05 * step_bounce - push.z * 0.19, 0.05 * uneven, -0.075 * wobble - push.x * 0.22) * attack_mix)
	_bone_add(entry, "Head", Vector3(0.025 * step_bounce + push.z * 0.15, -0.06 * uneven, 0.07 * wobble + push.x * 0.18) * attack_mix)
	_bone_add(entry, "RightArm", Vector3(0.11 * sin(cycle + 0.7) * walk_mix, 0.0, 0.07 * uneven + push.x * 0.13) * attack_mix)
	_bone_add(entry, "LeftArm", Vector3(0.04 * sin(cycle + 2.0) * walk_mix, 0.0, -0.025 * uneven) * attack_mix)
	if variant != "mossward":
		_bone_add(entry, "LeftLeg", Vector3(0.08 * maxf(0.0, sin(cycle)) * walk_mix, 0.0, -0.035 * wobble) * attack_mix)
		_bone_add(entry, "RightLeg", Vector3(0.08 * maxf(0.0, -sin(cycle)) * walk_mix, 0.0, 0.035 * wobble) * attack_mix)
	# Later rigs may split the legs at a knee. Drive either common naming
	# convention without changing how today's single-piece leg assets work.
	var left_flex := (0.0 if variant == "mossward" else 0.42) * maxf(0.0, sin(cycle)) * walk_mix * attack_mix
	var right_flex := (0.0 if variant == "mossward" else 0.42) * maxf(0.0, -sin(cycle)) * walk_mix * attack_mix
	_bone_add(entry, "LeftKnee", Vector3(left_flex, 0.0, 0.0))
	_bone_add(entry, "RightKnee", Vector3(right_flex, 0.0, 0.0))
	if int(entry.bones.get("LeftKnee", -1)) < 0: _bone_add(entry, "LeftShin", Vector3(left_flex, 0.0, 0.0))
	if int(entry.bones.get("RightKnee", -1)) < 0: _bone_add(entry, "RightShin", Vector3(right_flex, 0.0, 0.0))
	entry.visual.position.y = 0.025 * step_bounce - 0.018 * hit
	entry.visual.position.x = -push.x * 0.045
	entry.visual.position.z = -push.z * 0.045

func _bone_add(entry: Dictionary, name: String, rotation: Vector3) -> void:
	var index: int = int(entry.bones.get(name, -1))
	if index < 0: return
	var skeleton: Skeleton3D = entry.skeleton
	skeleton.set_bone_pose_rotation(index, skeleton.get_bone_pose_rotation(index) * Quaternion.from_euler(rotation))

## Call immediately before remains.shatter(actor). The existing rig homes supply
## the same physical bone debris as before, at their current legacy pose.
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
	var name: String = entry.clips[kind]
	if entry.active_clip != name:
		player.play(name)
		player.pause()
		entry.active_clip = name
	var animation: Animation = player.get_animation(name)
	player.seek(clampf(fraction, 0.0, 0.9999) * animation.length, true)

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
