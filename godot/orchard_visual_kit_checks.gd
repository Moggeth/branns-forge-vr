extends SceneTree

const Fields = preload("res://landscape_fields.gd")
const Hydro = preload("res://landscape_hydrology.gd")
const Kit = preload("res://orchard_visual_kit.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var model: Dictionary = Fields.create(290929)
	Hydro.run(model, [])
	Fields.derive(model)
	var start := Time.get_ticks_usec()
	var first: Dictionary = Kit.plan(model)
	var elapsed_ms := float(Time.get_ticks_usec() - start) / 1000.0
	var second: Dictionary = Kit.plan(model)
	if first != second: failures.append("placement is not deterministic")
	for asset in Kit.LIMITS:
		if first[asset].size() > int(Kit.LIMITS[asset]): failures.append("instance cap exceeded: " + asset)
	if first.bank_stone_lip_8m.is_empty(): failures.append("river bank stones absent")
	if first.reed_clump.is_empty(): failures.append("river reeds absent")
	for pose in first.reed_clump:
		var p: Vector3 = pose.position
		if Fields.sample(model, "water", Vector2(p.x, p.z)) >= 0.08: failures.append("reed in water")
	# Derivation mutates packed field arrays; the synthetic cliff must not alter
	# the baseline model used for the subsequent render-count comparison.
	var steep: Dictionary = model.duplicate(true)
	var shaped: PackedFloat32Array = model.height.duplicate()
	var size: int = int(model.size)
	for z in range(30, 65):
		for x in range(100, 119): shaped[z * size + x] = float(x - 100) * 2.0
	steep["height"] = shaped
	Fields.derive(steep)
	var cliff_plan: Dictionary = Kit.plan(steep)
	var cliff_count: int = cliff_plan.cliff_strata_wide.size() + cliff_plan.cliff_strata_tall.size() + cliff_plan.cliff_strata_low.size()
	if cliff_count == 0: failures.append("steep terrain produced no cliff modules")
	var root := Node3D.new()
	get_root().add_child(root)
	var rendered: Dictionary = Kit.populate(root, model)
	if rendered != _counts(first): failures.append("render counts differ from plan")
	if root.get_node_or_null(Kit.GROUP_NAME) == null: failures.append("visual group missing")
	var steep_rendered: Dictionary = Kit.populate(root, steep)
	if int(steep_rendered.cliff_strata_wide) + int(steep_rendered.cliff_strata_tall) + int(steep_rendered.cliff_strata_low) != cliff_count:
		failures.append("cliff batch counts differ from plan")
	var instances := root.get_node_or_null(Kit.GROUP_NAME).find_children("*", "MultiMeshInstance3D", true, false)
	if instances.is_empty(): failures.append("no MultiMesh instances created")
	print("ORCHARD_VISUAL_KIT_CHECK counts=", _counts(first), " steep_cliffs=", cliff_count, " plan_ms=", snappedf(elapsed_ms, 0.01), " failures=", failures)
	quit(0 if failures.is_empty() else 1)

func _counts(plan: Dictionary) -> Dictionary:
	var counts := {}
	for asset in plan: counts[asset] = plan[asset].size()
	return counts
