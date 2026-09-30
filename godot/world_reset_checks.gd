extends SceneTree
## Actual scene + disposable files. Never touches resident world or service saves.
const Reset = preload("res://world_reset.gd")
const Document = preload("res://landscape_world_document.gd")
var failures: Array[String] = []
var start := Time.get_ticks_usec()
func _initialize() -> void: run.call_deferred()
func check(value: bool, words: String) -> void:
	if not value: failures.append(words)
func text_at(path: String) -> String:
	return FileAccess.get_file_as_string(path)
func run() -> void:
	root.position = Vector2i(4200, 2400)
	root.size = Vector2i(960, 620)
	root.set_flag(Window.FLAG_NO_FOCUS, true)
	var game = load("res://main.tscn").instantiate()
	root.add_child(game)
	current_scene = game
	for frame in 18: await physics_frame
	var reset = game.world_reset
	check(reset.paths.is_empty(), "Offline scene must not inherit resident save paths")
	var folder := OS.get_environment("TEMP").path_join("brann-world-reset-" + str(Time.get_ticks_usec()))
	DirAccess.make_dir_recursive_absolute(folder)
	var paths: Array[String] = [folder.path_join("landscape_v1.json"), folder.path_join("world_builder_v1.json")]
	var dirty := Document.append(Document.create(game.landscape.seed, game.landscape.recipe),
		{"type":"raise", "center":[28.0,-74.0], "radius":9.0, "height":7.0, "seed":1})
	check(bool(dirty.ok), "Dirty world fixture must be a valid terrain document")
	var terrain_text := JSON.stringify(dirty.get("document", {}))
	var settlement: Dictionary = game.world_builder.fresh_state()
	settlement.wood = 27
	settlement.star_gems = 14
	settlement.workers = 3
	var settlement_text := JSON.stringify(settlement)
	Reset._write(paths[0], terrain_text)
	Reset._write(paths[1], settlement_text)
	var player := folder.path_join("player.json")
	var item := folder.path_join("crafted-item.glb")
	Reset._write(player, "character level 11 and quests")
	Reset._write(item, "crafted item untouched")
	reset.paths.assign(paths)
	game.travel_navigation.show_for(game, "map")
	game.travel_navigation.views[game.get_instance_id()].panel.reset_requested.emit()
	await process_frame
	check(is_instance_valid(reset.prompt), "Map reset button must open a confirmation")
	check(reset.prompt.title.contains("are you sure"), "Confirmation must explain intent")
	check(reset.prompt.dialog_text.contains("crafted items stay"), "Confirmation must state preserved character items")
	if DisplayServer.get_name() != "headless":
		for frame in 4: await process_frame
		await RenderingServer.frame_post_draw
		var output := ProjectSettings.globalize_path("res://../outputs/world-reset-review")
		DirAccess.make_dir_recursive_absolute(output)
		root.get_texture().get_image().save_png(output.path_join("confirmation-960.png"))
	reset.prompt.canceled.emit()
	await process_frame
	check(text_at(paths[0]) == terrain_text and text_at(paths[1]) == settlement_text, "Cancel must leave both saves byte-identical")
	check(not DirAccess.dir_exists_absolute(folder.path_join("world-reset-backups")), "Cancel must not create a reset backup or write")
	reset.confirm_vr()
	await process_frame
	check(current_scene == game, "Unarmed VR confirmation must be ignored")
	reset.arm_vr()
	reset.cancel()
	check(not reset.is_armed(), "VR cancellation must disarm reset")
	reset.arm_vr()
	game.elapsed += 16.0
	check(not reset.is_armed(), "VR confirmation must expire")
	reset.confirm_vr()
	await process_frame
	check(text_at(paths[0]) == terrain_text, "Expired confirmation must not write")
	var blocked: Array[String] = [paths[0], folder.path_join("blocked/world_builder_v1.json")]
	var failed := Reset.reset_files(blocked, game.landscape.seed, game.landscape.recipe)
	check(not failed.ok and text_at(paths[0]) == terrain_text, "Invalid reset location must preserve current terrain")
	var prepared := Reset.reset_files(paths, game.landscape.seed, game.landscape.recipe, {"test":"live snapshot"})
	check(bool(prepared.ok), "Fresh world files must commit")
	if prepared.ok:
		var clean: Dictionary = JSON.parse_string(text_at(paths[0]))
		check(Document.validate(clean).ok and clean.operations.is_empty() and int(clean.seed) == game.landscape.seed, "Reset must retain seed and produce an empty valid journal")
		check(JSON.parse_string(text_at(paths[1])).wood == 0, "Reset must clear settlement state")
		check(text_at(prepared.backup.path_join("landscape_v1.json")) == terrain_text, "Terrain backup must preserve exact original")
		check(text_at(prepared.backup.path_join("world_builder_v1.json")) == settlement_text, "Settlement backup must preserve exact original")
		check(text_at(prepared.backup.path_join("live-world.json")).contains("live snapshot"), "Backup must retain current live state")
		check(Reset.restore_files(prepared), "Reload-failure restoration must work")
		check(text_at(paths[0]) == terrain_text and text_at(paths[1]) == settlement_text, "Rollback must restore both saves")
	var old_id: int = game.get_instance_id()
	reset.request(game)
	reset.prompt.confirmed.emit()
	var deadline := Time.get_ticks_msec() + 12000
	while (current_scene == null or current_scene.get_instance_id() == old_id) and Time.get_ticks_msec() < deadline:
		await process_frame
	var rebuilt = current_scene
	check(rebuilt != null and rebuilt.get_instance_id() != old_id, "Confirmed reset must reload the actual game scene")
	if rebuilt != null and rebuilt.get_instance_id() != old_id:
		for frame in 20: await physics_frame
		check(not paused, "Reload must restore world processing")
		check(rebuilt.adventure.zone == "forge_yard", "Reset must return the Hero to the safe Forge entry")
		check(rebuilt.landscape.operation_count() == 0, "Rebuilt terrain must have no edits")
		check(rebuilt.world_builder.data.meteors.is_empty() and rebuilt.world_builder.data.wood == 0, "Rebuilt world must be fresh")
		var before: Vector3 = rebuilt.rig.global_position
		rebuilt._move_to(before + Vector3(0.15,0,0), true)
		check(rebuilt.rig.global_position.x > before.x + 0.08, "Hero must be able to walk after reset")
	check(text_at(player) == "character level 11 and quests" and text_at(item) == "crafted item untouched", "Character and crafted files must remain untouched")
	print("WORLD_RESET_RESULT ", JSON.stringify({"failures":failures, "seconds":float(Time.get_ticks_usec()-start)/1000000.0, "disposable_directory":folder}))
	quit(0 if failures.is_empty() else 1)
