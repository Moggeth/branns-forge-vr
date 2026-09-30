extends SceneTree
## Offline seeded timing and terrain route checks. Never opens player saves.
const Wander = preload("res://creature_idle_wander.gd")
const Navigation = preload("res://landscape_navigation.gd")
const Ents = preload("res://world_builder_ents.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var home := Vector3.ZERO
	var states: Array = []
	for copy in 2:
		var state: Dictionary = {}
		var position := home
		var moving_frames := 0
		var idle_frames := 0
		for frame in 1500:
			var now := float(frame) * 0.1
			var result: Dictionary = Wander.step(state, 44, now, 0.1, position, home, 0.45,
				func(start: Vector3, goal: Vector3) -> Array: return [start, goal])
			state = result.state
			position = result.position
			if bool(result.moving): moving_frames += 1
			else: idle_frames += 1
			if Vector2(position.x, position.z).length() > Wander.HOME_RADIUS: failures.append("left home bounds")
		states.append({"position": position, "rng": state.rng, "moving": moving_frames, "idle": idle_frames})
	if states[0] != states[1]: failures.append("same seed diverged")
	if int(states[0].moving) < 20 or int(states[0].idle) < 1000: failures.append("wander did not alternate short walks and long rests")
	var interrupted := Wander.begin({}, 123, 0.0)
	interrupted.phase = "walk"
	interrupted.route = [Vector3.ZERO, Vector3.RIGHT]
	interrupted = Wander.interrupt(interrupted, 9.0)
	if interrupted.phase != "pause" or not interrupted.route.is_empty() or float(interrupted.next_at) < 21.0: failures.append("combat did not cancel walk immediately")
	var count := 9 * 9
	var heights := PackedFloat32Array()
	var water := PackedFloat32Array()
	var traversability := PackedFloat32Array()
	heights.resize(count); heights.fill(0.0)
	water.resize(count); water.fill(0.0)
	traversability.resize(count); traversability.fill(1.0)
	var model := {"size": 9, "step": 1.0, "origin": Vector2(-4, -4), "height": heights, "water": water, "traversability": traversability}
	var dry: Array[Vector2] = Navigation.route(model, Vector2(-2, 0), Vector2(2, 0))
	if dry.is_empty(): failures.append("dry terrain path absent")
	for z in 9: water[z * 9 + 4] = 2.0
	model.water = water
	if not Navigation.route(model, Vector2(-2, 0), Vector2(2, 0)).is_empty(): failures.append("water barrier crossed")
	water.fill(0.0); model.water = water
	for z in 9: traversability[z * 9 + 4] = 0.0
	model.traversability = traversability
	if not Navigation.route(model, Vector2(-2, 0), Vector2(2, 0)).is_empty(): failures.append("blocked terrain crossed")
	var record := {"key": "tree:1", "state": "calm", "species": "apple", "scale": 1.0, "condition": "healthy", "hp": 90.0, "calm_left": 30.0, "position": [1.2, -0.7], "yaw": 1.1}
	if not Ents.valid_records([record]): failures.append("saved Ent movement rejected")
	record.position = [100.0, 0.0]
	if Ents.valid_records([record]): failures.append("out of bounds saved Ent accepted")
	print("CREATURE_IDLE_WANDER_RESULT ", JSON.stringify({"failures": failures, "moving_frames": states[0].moving, "idle_frames": states[0].idle}))
	quit(0 if failures.is_empty() else 1)
