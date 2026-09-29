extends SceneTree

const Runtime = preload("res://landscape_runtime.gd")
const Document = preload("res://landscape_world_document.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var root := Node3D.new()
	root.position = Vector3(20, 3, -10)
	get_root().add_child(root)
	var runtime: Node3D = Runtime.new()
	root.add_child(runtime)
	runtime.zone_root = root
	runtime.seed = 19
	var natural := PackedFloat32Array()
	natural.resize(25)
	runtime.model = {"size": 5, "step": 1.0, "origin": Vector2(-2, -2),
		"natural_height": natural, "height": natural.duplicate()}
	var first := {"type": "raise", "center": [0, 0], "radius": 2.0, "height": 2.0}
	var undone := {"type": "raise", "center": [1, 0], "radius": 2.0, "height": 1.0}
	var last := {"type": "lower", "center": [0, 0], "radius": 2.0, "depth": 1.0}
	var document: Dictionary = Document.create(19, "gentle_orchard")
	document = Document.append(document, first).document
	document = Document.append(document, undone).document
	document = Document.remove_last(document).document
	document = Document.append(document, last).document
	var save_path := "user://landscape_visual_history_check.json"
	var saved: Dictionary = Document.save(save_path, document)
	if not saved.ok: failures.append("save: " + str(saved.error))
	var loaded: Dictionary = Document.load_document(save_path, 19, "gentle_orchard")
	if not loaded.ok: failures.append("reload: " + str(loaded.error))
	else: document = loaded.document
	DirAccess.remove_absolute(ProjectSettings.globalize_path(save_path))
	runtime.document = document
	runtime.operations = Document.replay_operations(document)
	var events: Array[Dictionary] = runtime.get_visual_history_events()
	if events.size() != 2:
		failures.append("event count")
	else:
		if events[0].operation_id != "op-000001" or events[1].operation_id != "op-000003":
			failures.append("document IDs after undo")
		for event in events:
			if event.schema != 1 or event.phase != "restore" or event.progress != 1.0:
				failures.append("restore contract")
			if event.terrain_samples.size() > 384: failures.append("sample budget")
		var first_sample: Dictionary = _sample(events[0], 12)
		var last_sample: Dictionary = _sample(events[1], 12)
		if first_sample.is_empty() or last_sample.is_empty():
			failures.append("overlapping center sample")
		else:
			if first_sample.world_before != Vector3(20, 3, -10) or first_sample.world_target != Vector3(20, 5, -10):
				failures.append("first stage heights")
			if last_sample.world_before != Vector3(20, 5, -10) or last_sample.world_target != Vector3(20, 4, -10):
				failures.append("last stage heights")
		if events[0].visual_seed != 1028 or events[1].visual_seed != 3046:
			failures.append("deterministic seeds")
		var again: Array[Dictionary] = runtime.get_visual_history_events()
		if again.size() != 2 or again[0] != events[0] or again[1] != events[1]:
			failures.append("repeatability")
	if runtime.model.height != natural or runtime.model.natural_height != natural:
		failures.append("terrain mutated")
	print("LANDSCAPE_VISUAL_HISTORY_RESULT ", failures)
	quit(0 if failures.is_empty() else 1)

func _sample(event: Dictionary, index: int) -> Dictionary:
	for sample in event.terrain_samples:
		if int(sample.index) == index: return sample
	return {}
