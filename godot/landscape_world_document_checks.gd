extends SceneTree

const World = preload("res://landscape_world_document.gd")
const Ops = preload("res://landscape_operations.gd")
const PATH := "user://landscape_world_document_check_only.json"

func _initialize() -> void:
	var start := Time.get_ticks_usec()
	var failures: Array[String] = []
	var raise := {"type": "raise", "center": [20, 25], "radius": 16.0, "height": 4.0}
	var sunder := {"type": "sunder", "points": [[-50, -20], [0, -16], [50, -20]], "width": 8.0, "depth": 5.0, "height": 1.4, "shoulder": 5.0, "seed": 290929}
	var first: Dictionary = World.create(290929, "gentle_orchard")
	var added: Dictionary = World.append(first, raise)
	if not added.ok: failures.append("append raise: " + str(added.error))
	else: first = added.document
	added = World.append(first, sunder)
	if not added.ok: failures.append("append sunder: " + str(added.error))
	else: first = added.document
	if first.operations.size() != 2 or first.operations[0].id != "op-000001" or first.operations[1].id != "op-000002": failures.append("stable ordered IDs")
	var plain: Array = World.replay_operations(first)
	if plain.size() != 2 or plain[0].has("id") or not Ops.validate(plain[0]): failures.append("plain replay operations")
	var same: Dictionary = World.create(290929, "gentle_orchard")
	for op in [raise, sunder]: same = World.append(same, op).document
	if first.state_hash != same.state_hash: failures.append("deterministic state hash")
	var removed: Dictionary = World.remove_last(first)
	if not removed.ok: failures.append("undo operation")
	else:
		added = World.append(removed.document, sunder)
		if not added.ok or added.document.operations[1].id != "op-000003" or added.document.state_hash == first.state_hash: failures.append("undo preserves ID history")
	var duplicate: Dictionary = first.duplicate(true)
	duplicate.operations[1].id = duplicate.operations[0].id
	duplicate.state_hash = World.state_hash(duplicate)
	if World.validate(duplicate).ok: failures.append("duplicate ID accepted")
	var tampered: Dictionary = first.duplicate(true)
	tampered.operations[0].height = 999.0
	if World.validate(tampered).ok: failures.append("tampered hash accepted")
	if World.append(first, {"type": "raise", "center": [155, 0], "radius": 8.0, "height": 1.0}).ok: failures.append("out of bounds accepted")
	if World.append(first, {"type": "raise", "center": [0, 0], "radius": 8.0, "height": INF}).ok: failures.append("nonfinite value accepted")
	if World.append(first, {"type": "raise", "center": [0, 0], "radius": 8.0, "height": 1.0, "unknown": Vector3.ONE}).ok: failures.append("non-JSON payload accepted")
	var legacy := {"schema": 1, "seed": 290929, "recipe": "gentle_orchard", "operations": [raise, sunder]}
	_write(legacy)
	var loaded: Dictionary = World.load_document(PATH, 290929, "gentle_orchard")
	if not loaded.ok or not loaded.migrated or loaded.document.state_hash != first.state_hash: failures.append("schema 1 migration")
	var saved: Dictionary = World.save(PATH, first)
	if not saved.ok: failures.append("save migrated document: " + str(saved.error))
	loaded = World.load_document(PATH, 290929, "gentle_orchard")
	if not loaded.ok: failures.append("schema 2 round trip: " + str(loaded.error))
	elif loaded.migrated or loaded.document.state_hash != first.state_hash: failures.append("schema 2 round trip: identity changed")
	else:
		var heights := PackedFloat32Array()
		heights.resize(161 * 161)
		var model := {"size": 161, "step": 2.0, "origin": Vector2(-160, -160), "height": heights}
		if Ops.apply(model, World.replay_operations(first)) != Ops.apply(model, World.replay_operations(loaded.document)):
			failures.append("reloaded commands changed terrain")
	if World.load_document(PATH, 123, "gentle_orchard").ok: failures.append("wrong seed accepted")
	if World.load_document(PATH, 290929, "gentle_orchard", "future-generator").ok: failures.append("wrong generator accepted")
	_write(duplicate)
	if World.load_document(PATH, 290929, "gentle_orchard").ok or World.save(PATH, first).ok:
		failures.append("duplicate ID world overwritten")
	var newer := {"schema": 3, "seed": 290929, "recipe": "gentle_orchard", "operations": []}
	_write(newer)
	if World.load_document(PATH, 290929, "gentle_orchard").ok or World.save(PATH, first).ok:
		failures.append("newer world overwritten")
	var file := FileAccess.open(PATH, FileAccess.READ)
	if file == null or JSON.parse_string(file.get_as_text()).schema != 3: failures.append("newer world changed")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(PATH))
	var elapsed := float(Time.get_ticks_usec() - start) / 1000000.0
	print("LANDSCAPE_WORLD_DOCUMENT_RESULT failures=", failures, " seconds=", snappedf(elapsed, 0.001))
	quit(0 if failures.is_empty() else 1)

func _write(value: Dictionary) -> void:
	var file := FileAccess.open(PATH, FileAccess.WRITE)
	file.store_string(JSON.stringify(value))
	file.close()
