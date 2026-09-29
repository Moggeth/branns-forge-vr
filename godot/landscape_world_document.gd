extends RefCounted
## Versioned, replayable Orchard terrain history. No mesh or mutable derived field is saved.
const Ops = preload("res://landscape_operations.gd")
const SCHEMA := 2
const GENERATOR_VERSION := "orchard-1"
const MAX_OPERATIONS := 256
const MAX_BYTES := 262144
const MAX_OPERATION_BYTES := 8192
const MAX_ABS_SEED := 2147483647
const WORLD_LIMIT := 157.0

static func create(seed: int, recipe: String, generator_version: String = GENERATOR_VERSION) -> Dictionary:
	var document := {"schema": SCHEMA, "generator_version": generator_version,
		"seed": seed, "recipe": recipe, "next_id": 1, "operations": []}
	document["state_hash"] = state_hash(document)
	return document

static func load_document(path: String, expected_seed: int, expected_recipe: String, expected_generator_version: String = GENERATOR_VERSION) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {"ok": true, "document": create(expected_seed, expected_recipe, expected_generator_version), "migrated": false, "missing": true}
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null: return _failure("cannot open world document")
	if file.get_length() > MAX_BYTES: return _failure("world document exceeds size limit")
	var source: Variant = JSON.parse_string(file.get_as_text())
	if not source is Dictionary: return _failure("invalid world document JSON")
	var schema: Variant = source.get("schema")
	if not _integer_in_range(schema, 0, 1000000): return _failure("invalid world document schema")
	if int(schema) > SCHEMA: return _failure("world document uses a newer schema")
	if int(schema) != 1 and int(schema) != SCHEMA: return _failure("unsupported world document schema")
	if not _valid_seed(source.get("seed")) or not source.get("recipe") is String:
		return _failure("invalid world identity")
	if source.seed != expected_seed or source.recipe != expected_recipe:
		return _failure("world seed or recipe differs from the saved world")
	if int(schema) == 1:
		if expected_generator_version != GENERATOR_VERSION:
			return _failure("legacy world has no matching generator version")
		var old_ops: Variant = source.get("operations")
		if not old_ops is Array or old_ops.size() > MAX_OPERATIONS: return _failure("invalid legacy operations")
		var migrated := create(expected_seed, expected_recipe, expected_generator_version)
		for raw in old_ops:
			if not raw is Dictionary: return _failure("invalid legacy operation")
			var operation: Dictionary = raw.duplicate(true)
			if operation.has("seed") and _valid_seed(operation.seed): operation.seed = int(operation.seed)
			var added := append(migrated, operation)
			if not added.ok: return _failure("invalid legacy operation: " + str(added.error))
			migrated = added.document
		return {"ok": true, "document": migrated, "migrated": true, "missing": false}
	var checked := validate(source)
	if not checked.ok: return checked
	if source.generator_version != expected_generator_version:
		return _failure("world generator version differs from the saved world")
	return {"ok": true, "document": source.duplicate(true), "migrated": false, "missing": false}

static func validate(document: Dictionary) -> Dictionary:
	if not _integer_in_range(document.get("schema"), SCHEMA, SCHEMA): return _failure("unsupported world document schema")
	if not _valid_seed(document.get("seed")): return _failure("invalid world seed")
	if not document.get("recipe") is String or str(document.recipe).is_empty() or str(document.recipe).length() > 64:
		return _failure("invalid world recipe")
	if not document.get("generator_version") is String or str(document.generator_version).is_empty() or str(document.generator_version).length() > 64:
		return _failure("invalid generator version")
	var ops: Variant = document.get("operations")
	if not ops is Array or ops.size() > MAX_OPERATIONS: return _failure("invalid operation count")
	var next_id: Variant = document.get("next_id")
	if not _integer_in_range(next_id, 1, 1000000000): return _failure("invalid next operation ID")
	var seen := {}
	var last_number := 0
	for op in ops:
		if not op is Dictionary or not _valid_operation(op): return _failure("invalid operation payload")
		var id_text: String = op.id
		if seen.has(id_text): return _failure("duplicate operation ID")
		seen[id_text] = true
		var number := int(id_text.trim_prefix("op-"))
		if number <= last_number: return _failure("operation IDs are out of order")
		last_number = number
	if int(next_id) <= last_number: return _failure("next operation ID would collide")
	if not document.get("state_hash") is String or str(document.state_hash) != state_hash(document):
		return _failure("world replay hash mismatch")
	if JSON.stringify(document).length() > MAX_BYTES: return _failure("world document exceeds size limit")
	return {"ok": true, "error": ""}

static func append(document: Dictionary, raw: Dictionary) -> Dictionary:
	var checked := validate(document)
	if not checked.ok: return checked
	if document.operations.size() >= MAX_OPERATIONS: return _failure("operation limit reached")
	if raw.has("id"): return _failure("operation ID is assigned by the world document")
	if not _valid_operation_payload(raw): return _failure("invalid operation payload")
	var result: Dictionary = document.duplicate(true)
	var number: int = result.next_id
	var operation: Dictionary = raw.duplicate(true)
	operation["id"] = "op-%06d" % number
	result.operations.append(operation)
	result.next_id = number + 1
	result.state_hash = state_hash(result)
	checked = validate(result)
	if not checked.ok: return checked
	return {"ok": true, "document": result, "error": ""}

static func remove_last(document: Dictionary) -> Dictionary:
	var checked := validate(document)
	if not checked.ok: return checked
	if document.operations.is_empty(): return _failure("no operation to undo")
	var result: Dictionary = document.duplicate(true)
	result.operations.pop_back()
	result.state_hash = state_hash(result)
	return {"ok": true, "document": result, "error": ""}

static func replay_operations(document: Dictionary) -> Array:
	var plain: Array = []
	if not validate(document).ok: return plain
	for raw in document.operations:
		var operation: Dictionary = raw.duplicate(true)
		operation.erase("id")
		if operation.has("seed") and _valid_seed(operation.seed): operation.seed = int(operation.seed)
		plain.append(operation)
	return plain

static func state_hash(document: Dictionary) -> String:
	var replay := {"generator_version": document.get("generator_version"), "seed": document.get("seed"),
		"recipe": document.get("recipe"), "operations": document.get("operations", [])}
	# Godot's JSON parser returns numeric Variants as floats. Canonicalize through
	# that parser so an in-memory command and the same command after reload hash alike.
	var canonical: Variant = JSON.parse_string(JSON.stringify(replay, "", true))
	return JSON.stringify(canonical, "", true).sha256_text()

static func save(path: String, document: Dictionary) -> Dictionary:
	var checked := validate(document)
	if not checked.ok: return checked
	# A failed load must never turn into an overwrite of an invalid or newer save.
	if FileAccess.file_exists(path):
		var prior := load_document(path, int(document.seed), str(document.recipe), str(document.generator_version))
		if not prior.ok: return _failure("existing world document protected: " + str(prior.error))
	var temp := path + ".tmp"
	var file := FileAccess.open(temp, FileAccess.WRITE)
	if file == null: return _failure("cannot open temporary world document")
	file.store_string(JSON.stringify(document, "", true))
	file.flush()
	file.close()
	var temp_path := ProjectSettings.globalize_path(temp)
	var final_path := ProjectSettings.globalize_path(path)
	if DirAccess.rename_absolute(temp_path, final_path) != OK: return _failure("cannot replace world document")
	return {"ok": true, "error": ""}

static func _valid_operation(op: Dictionary) -> bool:
	if not op.get("id") is String: return false
	var id_text: String = op.id
	if not id_text.begins_with("op-") or id_text.length() != 9: return false
	for i in range(3, 9):
		if id_text.unicode_at(i) < 48 or id_text.unicode_at(i) > 57: return false
	if int(id_text.trim_prefix("op-")) < 1: return false
	var payload: Dictionary = op.duplicate(true)
	payload.erase("id")
	return _valid_operation_payload(payload)

static func _valid_operation_payload(op: Dictionary) -> bool:
	var checked_op: Dictionary = op.duplicate(true)
	if checked_op.has("seed") and _valid_seed(checked_op.seed): checked_op.seed = int(checked_op.seed)
	if not Ops.validate(checked_op): return false
	if not _json_safe(op, 0) or JSON.stringify(op).length() > MAX_OPERATION_BYTES: return false
	var box: Rect2 = Ops.bounds(checked_op)
	if not is_finite(box.position.x) or not is_finite(box.position.y) or not is_finite(box.end.x) or not is_finite(box.end.y): return false
	if box.position.x < -WORLD_LIMIT or box.position.y < -WORLD_LIMIT or box.end.x > WORLD_LIMIT or box.end.y > WORLD_LIMIT: return false
	return true

static func _json_safe(value: Variant, depth: int) -> bool:
	if depth > 4: return false
	if value is Dictionary:
		if value.size() > 32: return false
		for key in value:
			if not key is String or not _json_safe(value[key], depth + 1): return false
		return true
	if value is Array:
		if value.size() > 128: return false
		for item in value:
			if not _json_safe(item, depth + 1): return false
		return true
	if value is String: return value.length() <= 256
	if value is int: return absi(value) <= 2147483647
	if value is float: return is_finite(value) and absf(value) <= 2147483647.0
	return value is bool or value == null

static func _valid_seed(value: Variant) -> bool:
	return _integer_in_range(value, -MAX_ABS_SEED, MAX_ABS_SEED)

static func _integer_in_range(value: Variant, minimum: int, maximum: int) -> bool:
	return (value is int or value is float) and is_finite(float(value)) and float(value) >= minimum and float(value) <= maximum and float(value) == floorf(float(value))

static func _failure(message: String) -> Dictionary:
	return {"ok": false, "error": message}
