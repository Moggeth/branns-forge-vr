extends SceneTree

## Visual-contract and lifecycle check for Pocket Thunder's replaceable art layer.
## Run with --headless --xr-mode off --path godot --script res://bomb_visual_checks.gd.

class FakeGame extends Node3D:
	pass

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var game := FakeGame.new()
	root.add_child(game)
	var art := preload("res://bomb_visuals.gd").new()
	game.add_child(art)
	art.setup(game)
	if art.stage == null or art.stage.get_parent() != game:
		failures.append("visual stage was not attached to the live world")
	var bomb := art.create_bomb(game, 0.095)
	if bomb == null or not bomb.get_meta("bomb_visual", false):
		failures.append("bomb art did not create a recognizable world object")
	else:
		art.update_forming(bomb, 0.0)
		if not is_equal_approx(float(bomb.get_meta("formation_progress", -1)), 0.0):
			failures.append("formation did not accept start state")
		art.update_forming(bomb, 1.0)
		if not is_equal_approx(float(bomb.get_meta("formation_progress", -1)), 1.0):
			failures.append("formation did not accept complete state")
		if bomb.get_child_count() < 6:
			failures.append("bomb silhouette has too few articulated parts")
	var installed_scene = art.bomb_scene
	art.bomb_scene = null
	var fallback := art.create_bomb(game, 0.095)
	art.update_forming(fallback, 0.4)
	art.tick(0.01)
	if fallback.find_child("Heart", true, false) == null:
		failures.append("missing imported art left the bomb invisible")
	art.bomb_scene = installed_scene
	var projectile := Node3D.new()
	game.add_child(projectile)
	projectile.add_to_group("magic_bomb")
	projectile.global_position = Vector3(0, 2, 0)
	art.tick(0.04)
	projectile.global_position += Vector3(0, 0, -0.5)
	art.tick(0.04)
	if art.trails.is_empty(): failures.append("flying bomb has no trail")
	projectile.set_meta("exploded", true)
	art.tick(0.04)
	if not art.trails.is_empty(): failures.append("exploded bomb kept its flight trail")
	for i in range(5):
		art.explosion(Vector3(float(i), 0, 0), 3.0, 1.0, 0.4, 16)
	if art.bursts.size() != 5: failures.append("simultaneous explosions were dropped")
	var live_lights := 0
	for burst in art.bursts:
		if burst.get("light") != null: live_lights += 1
	if live_lights > 2: failures.append("explosion light budget exceeded")
	art.tick(3.0)
	if not art.bursts.is_empty(): failures.append("explosions were not released after their lifetime")
	for i in range(12): art.explosion(Vector3(float(i), 0, 0), 3.0, 1.0, 0.4, 16)
	if art.bursts.size() != art.MAX_BURSTS: failures.append("simultaneous explosion rig budget was not enforced")
	var tick_samples: Array[float] = []
	for frame in range(60):
		var started := Time.get_ticks_usec()
		art.tick(1.0 / 60.0)
		tick_samples.append(float(Time.get_ticks_usec() - started) / 1000.0)
	tick_samples.sort()
	print("BOMB_VISUAL_CPU ", JSON.stringify({"bursts": art.MAX_BURSTS, "tick_p95_ms": tick_samples[56], "tick_max_ms": tick_samples.back()}))
	art.tick(3.0)
	if not art.bursts.is_empty(): failures.append("recycled explosions were not released")
	print("BOMB_VISUAL_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
