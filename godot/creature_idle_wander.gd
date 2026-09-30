extends RefCounted
## Small, seeded idle excursions. Callers own combat priority and route validation.
const HOME_RADIUS := 4.5
const MIN_PAUSE := 12.0
const PAUSE_SPREAD := 17.0
const MIN_TRIP := 1.0
const MAX_TRIP := 3.0

static func begin(state: Dictionary, seed: int, now: float) -> Dictionary:
	if state.has("rng"): return state
	var rng := RandomNumberGenerator.new()
	rng.seed = absi(seed) + 1
	return {"rng": rng.state, "phase": "pause", "next_at": now + _pause(rng), "goal": Vector3.ZERO, "route": [], "index": 0}

static func interrupt(state: Dictionary, now: float) -> Dictionary:
	if state.is_empty(): return state
	state.phase = "pause"
	state.route = []
	state.index = 0
	state.next_at = maxf(float(state.get("next_at", 0.0)), now + MIN_PAUSE)
	return state

static func step(state: Dictionary, seed: int, now: float, delta: float, position: Vector3,
		home: Vector3, speed: float, validate: Callable) -> Dictionary:
	state = begin(state, seed, now)
	if delta <= 0.0: return {"state": state, "position": position, "heading": Vector3.ZERO, "moving": false}
	var rng := RandomNumberGenerator.new()
	rng.state = int(state.rng)
	if str(state.phase) == "pause" and now >= float(state.next_at):
		var found := false
		for attempt in 6:
			var angle := rng.randf_range(-PI, PI)
			var distance := rng.randf_range(MIN_TRIP, MAX_TRIP)
			var candidate := home + Vector3(cos(angle) * distance, 0.0, sin(angle) * distance)
			if Vector2(position.x - candidate.x, position.z - candidate.z).length() < 0.7: continue
			var route: Array = validate.call(position, candidate)
			if route.is_empty(): continue
			state.route = route
			state.index = 1 if route.size() > 1 else 0
			state.goal = route[-1]
			state.phase = "walk"
			found = true
			break
		if not found: state.next_at = now + _pause(rng)
	state.rng = rng.state
	if str(state.phase) != "walk": return {"state": state, "position": position, "heading": Vector3.ZERO, "moving": false}
	var path: Array = state.route
	var index: int = int(state.index)
	while index < path.size() - 1 and _flat_distance(position, path[index]) < 0.22: index += 1
	state.index = index
	var target: Vector3 = path[index]
	var heading := Vector3(target.x - position.x, 0.0, target.z - position.z)
	var length := heading.length()
	if length < 0.03:
		state.phase = "pause"
		state.route = []
		state.next_at = now + _pause(rng)
		state.rng = rng.state
		return {"state": state, "position": position, "heading": Vector3.ZERO, "moving": false}
	var next_position := position + heading / length * minf(speed * delta, length)
	return {"state": state, "position": next_position, "heading": heading / length, "moving": true}

static func _pause(rng: RandomNumberGenerator) -> float:
	return MIN_PAUSE + rng.randf() * PAUSE_SPREAD

static func _flat_distance(a: Vector3, b: Vector3) -> float:
	return Vector2(a.x - b.x, a.z - b.z).length()
