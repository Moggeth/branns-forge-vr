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
		if burst.get("burst_light") != null: live_lights += 1
	if live_lights > 4: failures.append("explosion light budget exceeded")
	art.tick(1.0)
	if not art.bursts.is_empty(): failures.append("explosions were not released after their lifetime")
	print("BOMB_VISUAL_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
