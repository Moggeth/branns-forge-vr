extends SceneTree
## Synthetic save and transient actors only. Never touches the player's planet save.
## tools/godot/Godot_v4.7.2-stable_win64_console.exe --headless --xr-mode off --audio-driver Dummy --path godot --script res://orchard_planet_reset_checks.gd

class FakeScene extends RefCounted:
	var rats: Array[Node3D] = []
	var enemies: Array[Node3D] = []
	var resources: Array[Node3D] = []

class FakeAnimation extends RefCounted:
	var actors := {}

class FakeRole extends Node3D:
	var rats: Array[Node3D] = []
	var motes: Array[Dictionary] = []
	var _full_count := 1
	var _motion_cursor := 4
	var stopped := false
	var removed_far := 0
	func stop_rat_stream() -> void:
		stopped = true
	func _remove_far_rat(_rat: Node3D) -> void:
		removed_far += 1

class FakeWorkers extends Node3D:
	var workers: Array[Dictionary] = []

class FakeDeposits extends Node:
	var entries := {}

class FakeMining extends Node:
	var deposits: FakeDeposits

class FakeGameplay extends Node3D:
	var placed: Array[Node3D] = []

class ResetRuntime extends "res://orchard_planet_runtime.gd":
	var rebuilt := false
	func _backup_state() -> bool:
		return true
	func _diagnostic() -> bool:
		return true
	func leave() -> void:
		pass
	func ensure_built() -> void:
		rebuilt = true

class FakeGame extends Node3D:
	var diagnostic_offline := true
	var smoke := false
	var scene := FakeScene.new()
	var animation := FakeAnimation.new()
	var god_role: FakeRole
	var god_workers: FakeWorkers
	var mining: FakeMining

func _initialize() -> void:
	_run.call_deferred()

func _run() -> void:
	var failures: Array[String] = []
	var runtime := preload("res://orchard_planet_runtime.gd").new()
	root.add_child(runtime)
	var game := FakeGame.new()
	root.add_child(game)
	runtime.game = game
	var temporary := "user://orchard-reset-check-%d.json" % Time.get_ticks_usec()
	var contents := PackedByteArray([0, 1, 2, 13, 10, 255])
	var file := FileAccess.open(temporary, FileAccess.WRITE)
	if file == null:
		failures.append("Could not create isolated save fixture")
	else:
		file.store_buffer(contents)
		file.close()
		if not runtime._backup_state_path(temporary):
			failures.append("Isolated save backup failed")
		else:
			var backup: String = runtime._last_reset_backup
			var copy := FileAccess.open(backup, FileAccess.READ)
			if copy == null or copy.get_buffer(copy.get_length()) != contents:
				failures.append("Backup bytes differ from isolated save")
			if copy != null: copy.close()
			if not runtime._delete_saved_state(temporary) or FileAccess.file_exists(temporary):
				failures.append("Reset save deletion did not finish")
			DirAccess.remove_absolute(ProjectSettings.globalize_path(backup))
	var directory := "user://orchard-reset-check-dir-%d" % Time.get_ticks_usec()
	DirAccess.make_dir_recursive_absolute(ProjectSettings.globalize_path(directory))
	if runtime._delete_saved_state(directory): failures.append("Directory accepted as a deletable save")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(directory))
	game.god_role = FakeRole.new()
	game.add_child(game.god_role)
	game.god_workers = FakeWorkers.new()
	game.add_child(game.god_workers)
	var full := Node3D.new()
	var far := Node3D.new()
	var flat := Node3D.new()
	for rat in [full, far, flat]:
		game.add_child(rat)
		game.god_role.rats.append(rat)
		game.scene.rats.append(rat)
		game.animation.actors[rat.get_instance_id()] = {}
	full.set_meta("zone", "orchard_planet")
	full.set_meta("god_role_full", true)
	far.set_meta("zone", "orchard_planet")
	flat.set_meta("zone", "orchard_highlands")
	var planet_mote := Node3D.new()
	var flat_mote := Node3D.new()
	game.add_child(planet_mote)
	game.add_child(flat_mote)
	game.god_role.motes = [{"node": planet_mote, "zone": "orchard_planet"},
		{"node": flat_mote, "zone": "orchard_highlands"}]
	var worker := Node3D.new()
	game.add_child(worker)
	game.god_workers.workers.append({"node": worker})
	runtime._clear_reset_transients()
	if not game.god_role.stopped or game.god_role.rats != [flat] or game.scene.rats != [flat]:
		failures.append("Planet rats or stream survived reset")
	if game.god_role._full_count != 0 or game.god_role.removed_far != 1:
		failures.append("Batched rat counts/slots survived reset")
	if game.god_role.motes.size() != 1 or game.god_role.motes[0].node != flat_mote:
		failures.append("Planet motes survived or flat motes were removed")
	if not game.god_workers.workers.is_empty() or not worker.is_queued_for_deletion():
		failures.append("Planet lumberjacks survived reset")
	if game.animation.actors.has(full.get_instance_id()) or game.animation.actors.has(far.get_instance_id()):
		failures.append("Planet rat animation registry survived reset")
	if not game.animation.actors.has(flat.get_instance_id()):
		failures.append("Flat rat animation registry was removed")
	game.mining = FakeMining.new()
	game.add_child(game.mining)
	game.mining.deposits = FakeDeposits.new()
	game.mining.add_child(game.mining.deposits)
	var reset_runtime := ResetRuntime.new()
	root.add_child(reset_runtime)
	reset_runtime.game = game
	reset_runtime.root = Node3D.new()
	game.add_child(reset_runtime.root)
	reset_runtime.gameplay = FakeGameplay.new()
	reset_runtime.root.add_child(reset_runtime.gameplay)
	reset_runtime.built = true
	var ore := Node3D.new()
	ore.set_meta("planet_ore", true)
	reset_runtime.gameplay.add_child(ore)
	reset_runtime.gameplay.placed.append(ore)
	game.scene.resources.append(ore)
	game.mining.deposits.entries[ore.get_instance_id()] = {"target": ore, "zone": "orchard_planet"}
	var skeleton := Node3D.new()
	reset_runtime.gameplay.add_child(skeleton)
	reset_runtime.gameplay.placed.append(skeleton)
	game.scene.enemies.append(skeleton)
	game.animation.actors[skeleton.get_instance_id()] = {}
	var old_gameplay := reset_runtime.gameplay
	if not reset_runtime.reset() or not reset_runtime.rebuilt:
		failures.append("Planet reset fixture did not rebuild")
	if game.mining.deposits.entries.has(ore.get_instance_id()) or game.scene.resources.has(ore):
		failures.append("Planet ore retained a mining or scene registration")
	if game.scene.enemies.has(skeleton) or game.animation.actors.has(skeleton.get_instance_id()):
		failures.append("Summoned planet skeleton retained a scene or animation registration")
	if reset_runtime.gameplay != null or not old_gameplay.is_queued_for_deletion():
		failures.append("Summoned planet skeleton was not removed with gameplay")
	print("ORCHARD_PLANET_RESET_RESULT ", JSON.stringify(failures))
	runtime.queue_free()
	reset_runtime.queue_free()
	game.queue_free()
	quit(0 if failures.is_empty() else 1)
