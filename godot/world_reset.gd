extends Node
## Explicitly confirmed Orchard reset. Character/service saves are never touched.
const Document = preload("res://landscape_world_document.gd")
const Builder = preload("res://world_builder_runtime.gd")
const BOOT_NOTICE := "brann_world_reset_complete"
const EXPLANATION := "Reset the Orchard to its original landscape?\n\nTerrain edits, grown forests, buildings, meteorites and settlement resources will be cleared.\nYour level, quests, workshop and crafted items stay. A world backup is kept."
var game
var prompt: ConfirmationDialog
var armed_until := -1.0
var busy := false
var paths: Array[String] = []

func setup(owner_game) -> void:
	game = owner_game
	if not game.diagnostic_offline and not game.smoke:
		paths.assign(["user://landscape_v1.json", game.world_builder.save_path])
	if get_tree().root.has_meta(BOOT_NOTICE):
		var backup := str(get_tree().root.get_meta(BOOT_NOTICE))
		get_tree().root.remove_meta(BOOT_NOTICE)
		get_tree().paused = false
		game.adventure.travel.call_deferred("forge_yard")
		game._notice("World reset. Returned to Brann's Forge. Your character progress is intact.", 12)
		print("WORLD_RESET reload_complete backup=", backup)

func request(target: Node = null) -> void:
	if busy or is_instance_valid(prompt): return
	prompt = ConfirmationDialog.new()
	prompt.title = "Reset World — are you sure?"
	prompt.dialog_text = "Reset Little Orchard to its original planet?\n\nIts terrain edits, grown trees, summoned encounters and meteorites will be cleared. Your character, the original Orchard and settlement resources stay. A planet backup is kept." if game.adventure.zone == "orchard_planet" else EXPLANATION
	prompt.get_label().autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	prompt.get_label().custom_minimum_size.x = 520
	prompt.ok_button_text = "Yes, Reset World"
	prompt.get_cancel_button().text = "Cancel"
	prompt.exclusive = true
	prompt.confirmed.connect(_confirmed)
	prompt.canceled.connect(cancel)
	(target if target != null else game).add_child(prompt)
	prompt.popup_centered(Vector2i(590, 270))
	prompt.get_cancel_button().grab_focus()

func arm_vr() -> void:
	if busy: return
	armed_until = game.elapsed + 15.0
	game._notice("Are you sure? Reset World clears the Orchard and keeps character progress. Press Yes, reset world within 15 seconds; Close cancels.", 15)

func is_armed() -> bool:
	return armed_until >= 0.0 and game.elapsed < armed_until

func confirm_vr() -> void:
	if not is_armed() or busy: return
	armed_until = -1.0
	_execute.call_deferred()

func cancel() -> void:
	armed_until = -1.0
	if is_instance_valid(prompt): prompt.queue_free()
	prompt = null

func _confirmed() -> void:
	if not is_instance_valid(prompt) or busy: return
	cancel()
	_execute.call_deferred()

func _execute() -> void:
	if busy: return
	if paths.size() != 2:
		game._notice("Reset World is unavailable in this offline diagnostic.", 6)
		return
	busy = true
	if game.adventure.zone == "orchard_planet":
		if game.get("god_role") != null: game.god_role.stop_rat_stream()
		await game.adventure.travel("forge_yard")
		if game.adventure.zone != "forge_yard" or game.adventure.travelling:
			busy = false
			game._notice("Planet reset paused: the Forge landing is not ready.", 10)
			return
		if not game.orchard_planet.reset():
			busy = false
			game._notice("Planet was not reset: its backup or save removal failed.", 10)
			return
		game._notice("Little Orchard reset. Returned to the Forge; character progress and the original Orchard are intact.", 10)
		busy = false
		return
	var terrain = game.landscape
	var builder = game.world_builder
	var result := reset_files(paths, terrain.seed, terrain.recipe,
		{"landscape": terrain.document, "settlement": builder.data})
	if not result.ok:
		busy = false
		game._notice("World was not reset: " + str(result.error), 10)
		push_warning("WORLD_RESET " + str(result.error))
		return
	# Prevent the old scene's autosave or shutdown callbacks overwriting the reset.
	var old_enabled: bool = terrain.save_enabled
	var old_blocked: bool = builder.save_blocked
	terrain.save_enabled = false
	builder.save_blocked = true
	var tree := get_tree()
	tree.root.set_meta(BOOT_NOTICE, result.backup)
	var was_paused := tree.paused
	tree.paused = true
	var error := tree.reload_current_scene()
	if error != OK:
		var restored := restore_files(result)
		tree.root.remove_meta(BOOT_NOTICE)
		tree.paused = was_paused
		terrain.save_enabled = old_enabled
		builder.save_blocked = old_blocked
		busy = false
		game._notice("Reload failed; " + ("the old world was restored." if restored else "recover the preserved world backup: " + str(result.backup)), 12)
		push_error("WORLD_RESET reload failed: " + str(error))
	else: print("WORLD_RESET confirmed backup=", result.backup)

static func _write(path: String, text: String) -> bool:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null: return false
	file.store_string(text)
	file.flush()
	var error := file.get_error()
	file.close()
	return error == OK

static func reset_files(save_paths: Array[String], seed: int, recipe: String, live_snapshot: Dictionary = {}) -> Dictionary:
	if save_paths.size() != 2: return {"ok": false, "error": "World save paths are unavailable."}
	var absolute: Array[String] = []
	for index in 2:
		var path := ProjectSettings.globalize_path(save_paths[index]).simplify_path()
		if path.get_file() != ["landscape_v1.json", "world_builder_v1.json"][index] or DirAccess.dir_exists_absolute(path):
			return {"ok": false, "error": "World save location is invalid."}
		absolute.append(path)
	if absolute[0].get_base_dir() != absolute[1].get_base_dir(): return {"ok": false, "error": "World saves must share a directory."}
	var backup := absolute[0].get_base_dir().path_join("world-reset-backups").path_join(Time.get_datetime_string_from_system(true).replace(":", "-") + "-" + str(Time.get_ticks_usec()))
	if DirAccess.make_dir_recursive_absolute(backup) != OK: return {"ok": false, "error": "Cannot create the world backup."}
	var originals := {}
	for path in absolute:
		var preserved := backup.path_join(path.get_file())
		originals[path] = preserved if FileAccess.file_exists(path) else ""
		if FileAccess.file_exists(path) and DirAccess.copy_absolute(path, preserved) != OK:
			return {"ok": false, "error": "Cannot preserve the old world save."}
	if not _write(backup.path_join("live-world.json"), JSON.stringify(live_snapshot)):
		return {"ok": false, "error": "Cannot preserve the current world snapshot."}
	var fresh := [Document.create(seed, recipe), Builder.fresh_state()]
	var result := {"ok": false, "backup": backup, "originals": originals, "error": ""}
	for index in 2:
		if not _write(absolute[index] + ".reset.tmp", JSON.stringify(fresh[index])):
			result.error = "Cannot prepare fresh world files."
			return result
	for path in absolute:
		if DirAccess.rename_absolute(path + ".reset.tmp", path) != OK:
			var restored := restore_files(result)
			result.error = "Cannot replace world files; " + ("the old world was restored." if restored else "the preserved backup needs recovery: " + backup)
			return result
	result.ok = true
	return result

static func restore_files(result: Dictionary) -> bool:
	var restored := true
	for path in result.get("originals", {}):
		var source: String = result.originals[path]
		if source.is_empty():
			if FileAccess.file_exists(path) and DirAccess.remove_absolute(path) != OK: restored = false
		elif DirAccess.copy_absolute(source, path) != OK: restored = false
	return restored
