extends SceneTree
## Headless check for projectile scripts and local gravity invariants.
const Flight = preload("res://phoenix_flight.gd")
const Bow = preload("res://phoenix_bow.gd")
const Crossbow = preload("res://siegebird_runtime.gd")
const Ring = preload("res://playful_tools.gd")
const Living = preload("res://living_projectiles.gd")
const Stream = preload("res://wyrmspout_runtime.gd")
const Fire = preload("res://firecraft.gd")

func _initialize() -> void:
	var failures: Array[String] = []
	var top := Flight.step(Vector3.UP * 85.0, Vector3.RIGHT * 12.0, Vector3.ZERO, 0.0, 0.1, Vector3.DOWN)
	var bottom := Flight.step(Vector3.DOWN * 85.0, Vector3.RIGHT * 12.0, Vector3.ZERO, 0.0, 0.1, Vector3.UP)
	if top.velocity.y >= -0.5 or bottom.velocity.y <= 0.5:
		failures.append("Arrow gravity did not reverse on the underside")
	var preview := Flight.step(Vector3.DOWN * 85.0, Vector3.RIGHT * 12.0, Vector3.ZERO, 0.0, 0.1, Vector3.UP)
	if preview.position.distance_to(bottom.position) > 0.00001:
		failures.append("Preview and live arrow solvers differ")
	var wing := Flight.wing_basis(bottom.velocity, Vector3.ZERO, 0.0, Vector3.DOWN)
	if absf(wing.y.dot(bottom.velocity.normalized())) > 0.001:
		failures.append("Underside wings are not perpendicular to flight")
	var toss: Vector3 = Ring.launch_velocity(Vector3.ZERO, Vector3.RIGHT, 1, true, 1.0, Vector3.DOWN)
	if toss.y >= 0.0: failures.append("Bottomside ring launch used world up")
	print("ORCHARD_PLANET_PROJECTILE_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
