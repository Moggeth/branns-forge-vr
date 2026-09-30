extends Node
## Persistent, localized skeleton damage. The animation rig still owns attached pieces;
## physical_remains owns loose pieces after they leave the living actor.

const PARTS := ["head", "arm_l", "arm_r", "leg_l", "leg_r", "rib"]
const BREAK_FORCE := {"head": 5.0, "arm_l": 3.2, "arm_r": 3.2, "leg_l": 3.7, "leg_r": 3.7, "rib": 3.8}
const MAX_CRACKS_PER_PART := 3

var game
var records := {} # actor instance id -> {stress, missing, marks, alive}

func setup(owner_game) -> void:
	game = owner_game

func reset(actor: Node3D) -> void:
	if not is_instance_valid(actor): return
	var rig: Dictionary = game.animation.actors.get(actor.get_instance_id(), {}) if game != null and game.animation != null else {}
	for home in rig.get("homes", []):
		for candidate in [home.get("piece"), home.get("template")]:
			if not is_instance_valid(candidate): continue
			for child in candidate.get_children():
				if str(child.name) == "BoneCrack": child.queue_free()
	records.erase(actor.get_instance_id())
	for part in PARTS:
		actor.remove_meta("skeleton_missing_" + part)
	actor.set_meta("skeleton_missing_parts", [])
	actor.set_meta("skeleton_cracked_parts", [])
	actor.set_meta("skeleton_move_scale", 1.0)
	actor.set_meta("skeleton_attack_scale", 1.0)

func state(actor: Node3D) -> Dictionary:
	return records.get(actor.get_instance_id(), {})

## force is weapon speed in metres/second. style is "blunt" or "blade".
## Returns {region, cracked, detached, item, stagger}. Damage/HP remains owned by adventure.
func hit(actor: Node3D, point: Vector3, direction: Vector3, force: float, style := "blunt") -> Dictionary:
	var result := {"region": "", "cracked": false, "detached": false, "item": null, "stagger": 0.0}
	if not is_instance_valid(actor) or actor.get_meta("enemy_type", "") != "skeleton" or not actor.get_meta("alive", true): return result
	if game == null or game.animation == null: return result
	var rig: Dictionary = game.animation.actors.get(actor.get_instance_id(), {})
	if rig.is_empty(): return result
	var part := region_at(actor, point)
	result.region = part
	var record: Dictionary = records.get(actor.get_instance_id(), {})
	if record.is_empty():
		record = {"stress": {}, "missing": {}, "marks": {}, "alive": true}
		records[actor.get_instance_id()] = record
	if record.missing.has(part): return result
	var relevant := _homes_for(rig, part, point)
	if relevant.is_empty(): return result
	var weight := 1.45 if style == "blade" else 1.0
	var stress := float(record.stress.get(part, 0.0)) + maxf(force, 0.0) * weight
	record.stress[part] = stress
	result.stagger = clampf(force * (0.11 if style == "blunt" else 0.07), 0.0, 0.85)
	if game.get("elapsed") != null:
		actor.set_meta("slow_until", maxf(float(actor.get_meta("slow_until", 0.0)), float(game.elapsed) + result.stagger))
	var can_detach := part != "rib" or _is_rib(relevant[0].piece)
	if stress >= float(BREAK_FORCE[part]) and can_detach:
		# A guardian's separate shield must leave its arm before the arm is removed.
		if part == "arm_l" and game.get("guardians") != null and game.guardians != null and game.guardians.guardians.has(actor.get_instance_id()):
			game.guardians.yank(actor)
		var item := _detach(actor, rig, part, relevant, direction, force)
		if item != null:
			if game.get("guardian_authored") != null and game.guardian_authored != null:
				game.guardian_authored.hide_part(actor, part)
			record.missing[part] = true
			actor.set_meta("skeleton_missing_" + part, true)
			actor.set_meta("skeleton_missing_parts", record.missing.keys())
			_update_degradation(actor, record)
			result.detached = true
			result.item = item
			return result
	if int(record.marks.get(part, 0)) < MAX_CRACKS_PER_PART:
		var crack_index := int(record.marks.get(part, 0))
		_mark_crack(relevant[0].piece, point, crack_index)
		if game.get("guardian_authored") != null and game.guardian_authored != null:
			game.guardian_authored.mark_damage(actor, part, point, crack_index)
		record.marks[part] = int(record.marks.get(part, 0)) + 1
	result.cracked = true
	actor.set_meta("skeleton_cracked_parts", record.stress.keys())
	return result

func region_at(actor: Node3D, point: Vector3) -> String:
	var local := actor.to_local(point)
	if local.y >= 1.43: return "head"
	if local.y < 0.78: return "leg_l" if local.x < 0.0 else "leg_r"
	if absf(local.x) >= 0.30: return "arm_l" if local.x < 0.0 else "arm_r"
	return "rib"

func _homes_for(rig: Dictionary, part: String, point: Vector3) -> Array:
	var output := []
	if part != "rib":
		for home in rig.homes:
			if is_instance_valid(home.piece) and home.parent == rig.joints.get(part): output.append(home)
		return output
	var best: Dictionary = {}
	var distance := INF
	for home in rig.homes:
		if not is_instance_valid(home.piece) or home.parent != rig.joints.get("body"): continue
		var box := _bounds(home.piece, Transform3D.IDENTITY)
		# The procedural skeleton has separate, thin horizontal ribs. Imported
		# guardians have one torso group, which can crack but cannot shed a rib.
		if box.size.x < 0.26 or box.size.y > 0.13: continue
		var candidate: float = home.piece.to_global(box.get_center()).distance_squared_to(point)
		if candidate < distance:
			distance = candidate
			best = home
	if not best.is_empty(): output.append(best)
	if output.is_empty():
		# Imported guardian torsos are a single group: they show cracks, while
		# keeping their torso attached until the normal death shatter.
		for home in rig.homes:
			if is_instance_valid(home.piece) and home.parent == rig.joints.get("body"):
				output.append(home)
				break
	return output

func _is_rib(piece: Node3D) -> bool:
	var box := _bounds(piece, Transform3D.IDENTITY)
	return box.size.x >= 0.26 and box.size.y <= 0.13

func _detach(actor: Node3D, rig: Dictionary, part: String, homes: Array, direction: Vector3, force: float) -> RigidBody3D:
	if homes.is_empty(): return null
	var body := RigidBody3D.new()
	body.name = "LooseSkeleton_" + part
	body.collision_layer = 8
	body.collision_mask = 9
	body.continuous_cd = true
	body.contact_monitor = true
	body.max_contacts_reported = 4
	var zone_parent: Node = game
	if game.get("adventure") != null and game.adventure != null:
		zone_parent = game.adventure.zone_groups.get(str(actor.get_meta("zone", game.adventure.zone)), game)
	zone_parent.add_child(body)
	body.global_transform = homes[0].piece.global_transform
	for home in homes:
		var piece: Node3D = home.piece
		if not is_instance_valid(piece): continue
		if not home.has("template"): home["template"] = piece.duplicate()
		piece.reparent(body, true)
		piece.visible = true
		home.piece = null
		rig.pieces.erase(piece)
	var box := _bounds(body, Transform3D.IDENTITY)
	if box.size.length() < 0.01:
		body.queue_free()
		return null
	var collider := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = box.size.max(Vector3.ONE * 0.035)
	collider.shape = shape
	collider.position = box.get_center()
	body.add_child(collider)
	body.mass = clampf(box.size.x * box.size.y * box.size.z * 120.0, 0.12, 2.5)
	body.add_to_group("pickup")
	body.add_to_group("physical_remains")
	body.set_meta("kind", "weapon")
	body.set_meta("id", "bone_club")
	body.set_meta("display_name", ("Skeleton rib" if part == "rib" else "Skeleton " + part.replace("_", " ")) + " · grip / throw")
	body.set_meta("remains", true)
	body.set_meta("source_actor", actor.get_instance_id())
	body.set_meta("skeleton_part", part)
	if part=="head" and game.get("remains")!=null and game.remains!=null: game.remains.tag_skull(body,actor)
	body.set_meta("born", float(game.elapsed))
	body.set_meta("zone", str(actor.get_meta("zone", game.adventure.zone if game.get("adventure") != null else "")))
	body.set_meta("damage_at", 0.0)
	body.set_meta("grip_min", -box.size.y * 0.3)
	body.set_meta("grip_max", box.size.y * 0.3)
	# Detached legs are usually grabbed at the hip. Their foot is the far end
	# and must be the swept melee point while held; the old +Y tip only reached
	# the knee, making the visible foot pass through enemies.
	body.set_meta("tip", Vector3(0.0, box.position.y if part.begins_with("leg") else maxf(0.1, box.end.y), 0.0))
	if part.begins_with("leg") and game.get("remains") != null and game.remains != null:
		game.remains.add_articulated_leg(body,box,body.get_child(0))
	var outward := direction.normalized() if direction.length_squared() > 0.001 else (point_from_actor(body, actor) + Vector3.UP * 0.4).normalized()
	body.linear_velocity = outward * clampf(force * 0.85, 1.2, 7.0) + Vector3.UP * 0.5
	body.angular_velocity = Vector3(1.3, 2.0, 0.8)
	if game.get("remains") != null and game.remains != null:
		body.body_entered.connect(func(other): game.remains._impact(body, other))
		game.remains.bodies.append(body)
		game.remains._trim()
	return body

func point_from_actor(body: Node3D, actor: Node3D) -> Vector3:
	return body.global_position - actor.global_position - Vector3.UP * 0.8

func _update_degradation(actor: Node3D, record: Dictionary) -> void:
	var legs := int(record.missing.has("leg_l")) + int(record.missing.has("leg_r"))
	var arms := int(record.missing.has("arm_l")) + int(record.missing.has("arm_r"))
	actor.set_meta("skeleton_move_scale", 1.0 - 0.36 * legs)
	actor.set_meta("skeleton_attack_scale", 1.0 - 0.35 * arms - (0.25 if record.missing.has("head") else 0.0))

func _mark_crack(piece: Node3D, point: Vector3, index: int) -> void:
	var mark := MeshInstance3D.new()
	mark.name = "BoneCrack"
	var mesh := BoxMesh.new()
	mesh.size = Vector3(0.13, 0.012, 0.012)
	mark.mesh = mesh
	var material := StandardMaterial3D.new()
	material.albedo_color = Color("504536")
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mark.material_override = material
	piece.add_child(mark)
	var box := _bounds(piece, Transform3D.IDENTITY)
	var local := piece.to_local(point)
	mark.position = local.clamp(box.position, box.end)
	mark.rotation.z = 0.45 + index * 0.65

func _bounds(node: Node3D, relative: Transform3D) -> AABB:
	var bounds := AABB()
	var found := false
	if node is MeshInstance3D and node.mesh != null:
		bounds = relative * node.mesh.get_aabb()
		found = true
	for child in node.get_children():
		if not child is Node3D: continue
		var child_box := _bounds(child, relative * child.transform)
		if child_box.size.length() > 0.0:
			bounds = bounds.merge(child_box) if found else child_box
			found = true
	return bounds
