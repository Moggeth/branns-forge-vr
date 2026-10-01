extends RefCounted
## Local projectile constraints, shared by arrows and bolts. No extra physics bodies.
## Death/dismemberment hands off the current pose, not the last rendered pose.
var game
var entries: Array = []

func setup(owner_game) -> void:
	game = owner_game

func bind(projectile: Node3D, surface: Node3D, hit: Dictionary = {}) -> Dictionary:
	_prune()
	var actor = hit.get("collider", game._owner(surface))
	if actor != null and str(actor.get_meta("kind", "")) not in ["enemy", "rat"]: actor = null
	var part := str(hit.get("part", ""))
	var bone_name := str(hit.get("bone_name", str(surface.bone_name) if surface is BoneAttachment3D else str(surface.name)))
	var body := _remains_body(surface)
	var point: Vector3 = hit.get("position", projectile.global_position)
	if body != null: surface = _remains_anchor(body, bone_name, point)
	var inverse := _pose(surface).affine_inverse()
	var direction: Vector3 = hit.get("direction", -projectile.global_basis.z.normalized())
	var entry := {"node": projectile, "surface": surface, "local": inverse * projectile.global_transform,
		"impact_local": inverse * point, "entry_direction_local": (inverse.basis * direction).normalized(), "penetration_depth": float(hit.get("penetration_depth", 0.0)),
		"actor": actor, "part": part, "bone_name": bone_name, "transferred": body != null}
	entries.append(entry)
	return entry

func update(entry: Dictionary) -> bool:
	if not is_instance_valid(entry.get("node")) or not is_instance_valid(entry.get("surface")): return false
	entry.node.global_transform = _pose(entry.surface) * entry.local
	entry.node.visible = entry.surface.is_visible_in_tree()
	return true

func tick() -> void:
	_prune()
	for entry in entries: update(entry)

func retarget(entry: Dictionary, surface: Node3D) -> void:
	# Read the live source bone even if a death callback just hid its visual.
	var old_pose := _pose(entry.surface)
	entry.node.global_transform = old_pose * entry.local
	var inverse := _pose(surface).affine_inverse()
	entry.impact_local = inverse * (old_pose * entry.impact_local)
	entry.entry_direction_local = (inverse.basis * old_pose.basis * entry.entry_direction_local).normalized()
	entry.local = inverse * entry.node.global_transform
	entry.surface = surface
	entry.node.visible = surface.is_visible_in_tree()
	entry.transferred = true

func release(projectile: Node3D) -> void:
	for entry in entries.duplicate():
		if entry.get("node") == projectile: entries.erase(entry)

func handoff(actor: Node3D, part: String, body: Node3D, source: Node3D = null) -> void:
	_prune()
	for entry in entries:
		if entry.get("actor") != actor or entry.get("transferred", false): continue
		var follows_source: bool = is_instance_valid(source) and is_instance_valid(entry.surface) and (entry.surface == source or source.is_ancestor_of(entry.surface))
		if is_instance_valid(source) and not entry.surface is BoneAttachment3D and not follows_source: continue
		if not follows_source and (part == "" or str(entry.part) != part): continue
		# Rigid mesh reparenting already preserves the exact piece. Skinned/baked
		# replacements need an explicit new anchor; never pick an unrelated bone.
		var target: Node3D = entry.surface if body.is_ancestor_of(entry.surface) and entry.surface.is_visible_in_tree() else _remains_anchor(body, str(entry.bone_name), _pose(entry.surface) * entry.impact_local)
		retarget(entry, target)

func _pose(surface: Node3D) -> Transform3D:
	if surface is BoneAttachment3D:
		var skeleton := surface.get_parent() as Skeleton3D
		if skeleton != null:
			var bone := skeleton.find_bone(surface.bone_name)
			if bone >= 0: return skeleton.global_transform * skeleton.get_bone_global_pose(bone)
	return surface.global_transform

func _remains_body(surface: Node3D) -> Node3D:
	var node: Node = surface
	while node != null:
		if node is Node3D and node.get_meta("remains", false): return node
		node = node.get_parent()
	return null

func _remains_anchor(body: Node3D, bone_name: String, point: Vector3) -> Node3D:
	if not body.get_meta("articulated_leg", false): return body
	var knee := body.get_node_or_null("SpringKnee") as Node3D
	var ankle := body.get_node_or_null("SpringKnee/SpringAnkle") as Node3D
	var label := bone_name.to_lower()
	if ankle != null and ("foot" in label or "toe" in label): return ankle
	if knee != null and ("knee" in label or "shin" in label): return knee
	# Legacy legs have rigid mesh names rather than authored bone names.
	var local := body.to_local(point)
	if ankle != null and local.y < (body.global_transform.affine_inverse() * ankle.global_position).y: return ankle
	if knee != null and local.y < knee.position.y: return knee
	return body

func _prune() -> void:
	for entry in entries.duplicate():
		if not is_instance_valid(entry.get("node")) or entry.node.is_queued_for_deletion(): entries.erase(entry)
