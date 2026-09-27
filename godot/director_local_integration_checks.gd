extends SceneTree
## Run with --headless --xr-mode off --script ... -- --director-mode --director-window.

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var director = game.director
	var view = game.director_local_view
	if director == null or not director.local_mode or director.tactical_viewport != null or director.session_id != "":
		failures.append("native match still uses browser/JPEG service path")
	if not is_instance_valid(view):
		failures.append("native Director window missing")
	else:
		if view.tactical_viewport.world_3d != game.get_world_3d():
			failures.append("Director does not share Hero world")
		view._on_action_pressed()
		if director.phase != "running": failures.append("Director could not start local round")
		view.selected_lane = "west"
		view._cast_hotkey(0)
		if director.warnings.size() != 1 or view.budget >= 8.0:
			failures.append("card hotkey did not place charged in-world summon")
		view._cast_hotkey(0)
		if director.warnings.size() != 1:
			failures.append("cooldown allowed a duplicate summon")
		game.elapsed += 2.3
		director.tick(0.02)
		if director.summons.size() != 2 or not director.summons[0].get_meta("director_spawned", false):
			failures.append("Director summon did not become two shared-world enemies")
		view.close()
		await process_frame
		if is_instance_valid(view): failures.append("Director window did not close independently")
	print("DIRECTOR_LOCAL_INTEGRATION ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)
