extends SceneTree

const Reprojection = preload("res://landscape_reprojection.gd")


func _initialize() -> void:
	call_deferred("_check")


func _check() -> void:
	var failures: Array[String] = []
	var live := Node3D.new()
	live.name = "LiveZone_orchard_highlands"
	root.add_child(live)
	var zone := Node3D.new()
	zone.name = "orchard_highlands"
	zone.position = Vector3(-360, 0, 0)
	live.add_child(zone)
	var plot := Node3D.new()
	plot.name = "OrchardPlot_00"
	plot.position = Vector3(0, 0, 0)
	zone.add_child(plot)
	var tree := Node3D.new()
	tree.name = "Tree_apple_1"
	tree.position = Vector3(2, 0, 0)
	plot.add_child(tree)
	var collider := CollisionShape3D.new()
	collider.shape = BoxShape3D.new()
	tree.add_child(collider)
	var portal := Node3D.new()
	portal.name = "OrchardPortal"
	portal.position = Vector3(5, 0, 0)
	portal.set_meta("kind", "portal")
	zone.add_child(portal)
	var sign := Node3D.new()
	sign.name = "OrchardFloatingSign"
	sign.position = Vector3(5, 4, 2)
	zone.add_child(sign)
	var resource := Node3D.new()
	resource.name = "orchard_highlands_resource_001"
	resource.position = Vector3(-358, 0, 2)
	resource.set_meta("zone", "orchard_highlands")
	resource.set_meta("resource_id", "lumber")
	live.add_child(resource)
	var holder := MultiMeshInstance3D.new()
	holder.name = "Woodland_fern_0_0"
	holder.position = Vector3.ZERO
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.mesh = BoxMesh.new()
	multi.instance_count = 2
	multi.custom_aabb = AABB(Vector3(-8, -1, -8), Vector3(16, 3, 16))
	multi.set_instance_transform(0, Transform3D(Basis.IDENTITY, Vector3(2, 0, 0)))
	multi.set_instance_transform(1, Transform3D(Basis.IDENTITY, Vector3(-2, 0, 0)))
	holder.multimesh = multi
	zone.add_child(holder)
	holder.set_meta("dressing_positions", PackedVector3Array([Vector3(2, 0, 0), Vector3(-2, 0, 0)]))
	var shadow := MultiMeshInstance3D.new()
	shadow.name = "Orchard_LeafShadow"
	shadow.multimesh = multi
	shadow.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_SHADOWS_ONLY
	shadow.set_meta("landscape_shared_instance_owner", holder)
	zone.add_child(shadow)
	var model: Dictionary = _model()
	var projection := Reprojection.new()
	var started: int = Time.get_ticks_msec()
	var initial: Dictionary = projection.setup(live, model)
	var initial_ms: int = Time.get_ticks_msec() - started
	if initial.instances != 2 or initial.anchors < 3: failures.append("scene anchors or instances not found: " + str(initial))
	if absf(plot.position.y - 2.0) > 0.01 or absf(tree.global_position.y - 2.0) > 0.01: failures.append("plot/tree ground placement incorrect")
	if absf(resource.position.y - 2.0) > 0.01: failures.append("sibling resource did not ground")
	if portal.position.y != 0.0 or sign.position.y != 4.0: failures.append("floating portal/sign moved")
	# Godot's headless rendering server returns identity MultiMesh poses even
	# immediately after set_instance_transform. Check the compiled CPU projection
	# here; a rendered run remains necessary to inspect actual instance placement.
	if absf(projection._instances[0].projected_y - 2.0) > 0.01: failures.append("fern did not ground")
	if multi.custom_aabb.size.y < 14.0: failures.append("instance AABB did not expand vertically")
	var before_other: float = projection._instances[1].projected_y
	var edited: Dictionary = model.duplicate(true)
	var water: PackedFloat32Array = edited.water
	water[_index(Vector2(2, 0))] = 1.0
	edited["water"] = water
	var dirty := Rect2(Vector2(1, -1), Vector2(3, 3))
	var touched: int = projection.refresh_region(live, edited, dirty)
	await physics_frame
	if touched < 2: failures.append("dirty change failed to reach tree and fern")
	if tree.visible or not collider.disabled: failures.append("wet tree or collision remained")
	if not projection._instances[0].invalid_hidden: failures.append("wet fern remained")
	if projection._instances[1].projected_y != before_other: failures.append("distant fern moved")
	var restored: int = projection.refresh_region(live, model, dirty)
	await physics_frame
	if restored != touched or not tree.visible or collider.disabled: failures.append("dry tree did not restore")
	if projection._instances[0].invalid_hidden or absf(projection._instances[0].projected_y - 2.0) > 0.01: failures.append("dry fern did not restore")
	var again: Dictionary = projection.setup(live, model)
	if absf(plot.position.y - 2.0) > 0.01: failures.append("second setup accumulated height")
	print("REPROJECTION_BENCHMARK anchors=", initial.anchors, " instances=", initial.instances, " initial_ms=", initial_ms, " dirty_updates=", touched, " second_setup=", again.updated)
	if failures.is_empty():
		print("REPROJECTION_CHECKS_PASS")
		quit(0)
	else:
		for failure in failures: push_error(failure)
		quit(1)


func _model() -> Dictionary:
	var height := PackedFloat32Array()
	var water := PackedFloat32Array()
	var slope := PackedFloat32Array()
	height.resize(81)
	water.resize(81)
	slope.resize(81)
	height.fill(2.0)
	return {"size": 9, "step": 2.0, "origin": Vector2(-8, -8), "height": height, "water": water, "slope": slope}


func _index(point: Vector2) -> int:
	return (roundi((point.y + 8) / 2.0) * 9) + roundi((point.x + 8) / 2.0)
