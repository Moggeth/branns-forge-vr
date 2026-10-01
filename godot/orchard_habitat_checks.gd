extends SceneTree
## Deterministic, save-free native contract for added Orchard habitat dressing.

const Fields = preload("res://landscape_fields.gd")
const Hydro = preload("res://landscape_hydrology.gd")
const Ecology = preload("res://landscape_ecology.gd")
const Expansion = preload("res://orchard_expansion.gd")
const Dressing = preload("res://orchard_dressing.gd")
const Ground = preload("res://orchard_ground.gd")

const SEED := 290929
const LIMITS := {"base": 3200, "bank": 400, "edge": 220}
const QUALITIES := [0.47, 1.15]

func _initialize() -> void:
	if DisplayServer.get_name() != "headless":
		root.unfocusable = true
		root.position = Vector2i(-12000, -12000)
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var model: Dictionary = Fields.create(SEED)
	Hydro.run(model, [])
	Fields.derive(model)
	Ground.sync_paths([])
	var ecology: Dictionary = Ecology.generate(model)
	var positions := PackedVector3Array()
	for candidate in ecology.trees:
		var point: Vector3 = candidate.position
		point.y = 0.0
		if Expansion._clear(point): positions.append(point)
	if positions.is_empty(): failures.append("fixture has no orchard tree bases")
	var report := {}
	for quality in QUALITIES:
		var first := _build(model, positions, quality, failures)
		var second := _build(model, positions, quality, failures)
		var label := str(quality)
		if first.signature != second.signature: failures.append("placement changed across identical inputs at quality " + label)
		if first.counts != second.counts: failures.append("counts changed across identical inputs at quality " + label)
		for kind in LIMITS:
			var count: int = first.counts[kind]
			if count <= 0: failures.append("missing habitat " + kind + " at quality " + label)
			if count > int(LIMITS[kind]): failures.append("habitat budget exceeded: " + kind + " quality=" + label + " count=" + str(count))
		if first.total != first.counts.base + first.counts.edge + first.counts.bank:
			failures.append("populate_habitat return differs from placed instances at quality " + label)
		if not first.root.get_meta("orchard_bank_dressed", false): failures.append("real bank placement flag missing")
		report[label] = first.counts
		_check_clear_path(first.root, failures)
		first.root.free()
		second.root.free()
	print("ORCHARD_HABITAT_RESULT ", JSON.stringify({"trees": positions.size(), "counts": report,
		"transform_readback": "unavailable_headless" if DisplayServer.get_name() == "headless" else "checked",
		"failures": failures}))
	quit(0 if failures.is_empty() else 1)

func _build(model: Dictionary, positions: PackedVector3Array, quality: float, failures: Array[String]) -> Dictionary:
	var stage := Node3D.new()
	root.add_child(stage)
	stage.set_meta("orchard_tree_positions", positions)
	var total: int = Dressing.populate_habitat(stage, Expansion.TRAIL, model, quality)
	var counts := {"base": 0, "edge": 0, "bank": 0}
	var signature: Array[String] = []
	for child in stage.get_children():
		if not child is MultiMeshInstance3D: continue
		var kind := ""
		for candidate in counts:
			if child.name.begins_with("Woodland_" + candidate + "_"):
				kind = candidate
				break
		if kind.is_empty(): continue
		var batch: MultiMesh = child.multimesh
		if batch == null: failures.append("missing habitat MultiMesh: " + child.name); continue
		var addresses: PackedVector3Array = child.get_meta("dressing_positions", PackedVector3Array())
		var hidden: PackedByteArray = child.get_meta("dressing_hidden", PackedByteArray())
		if addresses.size() != batch.instance_count or hidden.size() != batch.instance_count:
			failures.append("address/hidden count mismatch: " + child.name)
			continue
		counts[kind] += batch.instance_count
		signature.append(child.name + ":" + str(batch.instance_count))
		for index in range(batch.instance_count):
			var at: Vector3 = addresses[index]
			if hidden[index] != 0: failures.append("new habitat instance starts hidden: " + child.name)
			if Fields.sample(model, "water", Vector2(at.x, at.z)) > 0.02:
				failures.append("habitat under water: " + child.name)
			if Ground.sample(Vector2(at.x, at.z)).r > 0.48 or _distance_to_trail(at, Expansion.TRAIL) < 3.1:
				failures.append("habitat overlaps path: " + child.name)
			signature.append(str(at) + ":" + str(batch.get_instance_transform(index)))
	return {"root": stage, "total": total, "counts": counts, "signature": signature}

func _distance_to_trail(point: Vector3, trail: Array) -> float:
	var distance := INF
	for index in range(trail.size() - 1):
		var a: Vector3 = trail[index]
		var b: Vector3 = trail[index + 1]
		var span := b - a
		var t := clampf((point - a).dot(span) / maxf(span.length_squared(), 0.001), 0.0, 1.0)
		distance = minf(distance, point.distance_to(a + span * t))
	return distance

func _check_clear_path(stage: Node3D, failures: Array[String]) -> void:
	for child in stage.get_children():
		if not child is MultiMeshInstance3D or not child.name.begins_with("Woodland_"): continue
		var positions: PackedVector3Array = child.get_meta("dressing_positions", PackedVector3Array())
		if positions.is_empty(): continue
		var point: Vector3 = positions[0]
		Dressing.clear_path(stage, point + Vector3(-0.25, 0, 0), point + Vector3(0.25, 0, 0))
		var hidden: PackedByteArray = child.get_meta("dressing_hidden", PackedByteArray())
		if hidden.is_empty() or hidden[0] != 1:
			failures.append("clear_path did not hide an actual habitat instance")
		# The Dummy headless renderer always reads MultiMesh transforms as identity,
		# even before clearing. Verify the GPU transform in the offscreen native run.
		elif DisplayServer.get_name() != "headless" and child.multimesh.get_instance_transform(0).origin.y > -100.0:
			failures.append("clear_path hidden flag did not remove rendered instance")
		Dressing.clear_path(stage, point + Vector3(-0.25, 0, 0), point + Vector3(0.25, 0, 0))
		if child.get_meta("dressing_hidden", PackedByteArray())[0] != 1:
			failures.append("clear_path repeat lost hidden instance")
		return
	failures.append("no habitat instance available to test clear_path")
