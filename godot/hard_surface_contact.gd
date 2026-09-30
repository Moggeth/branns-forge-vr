extends RefCounted
## A visual/tool response to solid surfaces. Tracked hands remain unmodified.

const MIN_ENTRY := 0.18
const MAX_BITE := 0.035

static func regions(item: Node3D) -> Array[Dictionary]:
	var id := str(item.get_meta("id", ""))
	if id == "quarry_pick":
		if item.has_meta("hard_contact_regions"): return item.get_meta("hard_contact_regions")
		# Resolve the authored GLB markers when present. The fallback is the
		# documented source-space marker pose, not the broad physics proxy.
		var right := Vector3(0.32,0.535,0)
		var left := Vector3(-0.32,0.535,0)
		var right_marker := item.find_child("PickTipRight",true,false) as Node3D
		var left_marker := item.find_child("PickTipLeft",true,false) as Node3D
		if right_marker != null: right = item.to_local(right_marker.global_position)
		if left_marker != null: left = item.to_local(left_marker.global_position)
		var built: Array[Dictionary] = [
			{"name":"pick_point","local":right},
			{"name":"opposite_point","local":left},
			{"name":"shaft","local":Vector3(0,0.40,0)},
			{"name":"handle","local":Vector3(0,0.14,0)}]
		item.set_meta("hard_contact_regions",built)
		return built
	return [{"name":"working","local":item.get_meta("tip",Vector3.UP*0.65)}]

static func material_for(target: Node) -> String:
	if target == null: return ""
	var kind := str(target.get_meta("kind", ""))
	if kind == "meteor_ore": return "star_iron"
	if kind == "resource" and str(target.get_meta("requires", "")) in ["axe", "chop"]: return "wood"
	if target is StaticBody3D: return "stone"
	return ""

static func response(target: Node, item: Node3D, point: Vector3, normal: Vector3,
		motion: Vector3, speed: float, region: String = "working") -> Dictionary:
	var material := material_for(target)
	if material.is_empty(): return {}
	var outward := normal.normalized()
	if outward.length_squared() < 0.5: return {}
	var direction := motion.normalized()
	if direction.length_squared() < 0.5: direction = -outward
	var entry := clampf(-direction.dot(outward), 0.0, 1.0)
	var tool_id := str(item.get_meta("id", "")) if is_instance_valid(item) else ""
	var energy := 0.5 * clampf(float(item.get_meta("combat_mass", 1.2)) if is_instance_valid(item) else 1.2, 0.3, 8.0) * speed * speed * entry
	var sharp := region in ["pick_point", "opposite_point"] or (region == "working" and tool_id == "crystal_resonator")
	var bite := minf(MAX_BITE, 0.008 + speed * 0.003) if sharp and entry > 0.5 and speed > 1.5 else 0.0
	return {"point": point, "normal": outward, "material": material,
		"energy": energy, "entry": entry, "incidence": entry,
		"relative_velocity": direction * speed, "strike_region": region,
		"glance": entry < MIN_ENTRY,
		"block": entry >= MIN_ENTRY, "bite": bite, "tool": tool_id,
		"target": target}

static func desktop_pose(contact_pose: Transform3D, rest_pose: Transform3D,
		progress: float) -> Transform3D:
	# One intentional stop, a short recoil, then withdrawal. This is a visual
	# constraint on the held model, not on the camera or player's hand input.
	if progress <= 0.67: return contact_pose
	var withdrawal := smoothstep(0.67, 1.0, progress)
	var recoil := contact_pose
	recoil.origin += Vector3(0.035, 0.035, 0.075) * sin(withdrawal * PI)
	return recoil.interpolate_with(rest_pose, withdrawal)
