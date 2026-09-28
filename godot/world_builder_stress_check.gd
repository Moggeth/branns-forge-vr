extends SceneTree
## Desktop-only rehearsal of 24 authored skeletons plus the tactical viewport.
## It never loads or changes the player's settlement save.

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	var builder: Node = game.world_builder
	game.adventure.hp = 9999.0
	for i in range(8):
		builder.data.aether = 20.0
		var angle := TAU * float(i) / 8.0
		var point := Vector3(cos(angle) * 18.0, 0, sin(angle) * 18.0)
		var problem: String = builder.summon_patrol(point)
		if problem != "": push_error("WORLD_BUILDER_STRESS summon failed: " + problem); quit(1); return
		builder.tick(1.8)
	var live_count := 0
	for units in builder.summoned_nodes.values(): live_count += units.size()
	await create_timer(2.0).timeout
	var samples: Array[int] = []
	for i in range(16):
		await create_timer(0.25).timeout
		samples.append(Engine.get_frames_per_second())
	samples.sort()
	var sum := 0
	for fps in samples: sum += fps
	print("WORLD_BUILDER_STRESS ", JSON.stringify({"summoned": live_count, "view_fps": game.world_builder_view.refresh_limit, "scale": game.world_builder_view.render_scale, "desktop_fps_min": samples[0], "desktop_fps_median": samples[samples.size() / 2], "desktop_fps_mean": float(sum) / samples.size()}))
	quit(0 if live_count == 24 else 1)
