extends SceneTree
## Isolated actor timeline check; run with --world-builder-check to avoid saves.

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		push_error("Actor timing check requires isolated --world-builder-check mode")
		quit(2)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	game.adventure.test_mode = true
	var failures: Array = []
	await game._actor_checks(failures)
	print("ACTOR_TIMING_RESULT ", failures)
	quit(0 if failures.is_empty() else 1)
