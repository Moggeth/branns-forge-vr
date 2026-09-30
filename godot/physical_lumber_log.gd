extends RigidBody3D
## The resource request is made only after the dropped log reaches the player.

const LOG_ART_PATH := "res://assets/tree_cutting/log_y.glb"
const PICKUP_DELAY := 1.1
const ASSIST_RADIUS := 2.15

var game: Node
var source: Node3D
var felling: Node
var age := 0.0
var claiming := false

func setup(owner_game: Node, resource: Node3D, owner_felling: Node) -> void:
	game = owner_game
	source = resource
	felling = owner_felling
	set_meta("kind", "lumber_log")
	set_meta("resource", "lumber")
	continuous_cd = true
	contact_monitor = true
	max_contacts_reported = 4
	linear_damp = 1.0
	angular_damp = 1.8
	var collision := CollisionShape3D.new()
	var shape := CylinderShape3D.new()
	shape.radius = 0.20
	shape.height = 0.90
	collision.shape = shape
	add_child(collision)
	var art: Node3D = load(LOG_ART_PATH).instantiate() if ResourceLoader.exists(LOG_ART_PATH) else null
	if art != null:
		add_child(art)
	else:
		# Diagnostic geometry until the authored log GLB is installed.
		var display := MeshInstance3D.new()
		var mesh := CylinderMesh.new()
		mesh.top_radius = 0.20
		mesh.bottom_radius = 0.20
		mesh.height = 0.90
		display.mesh = mesh
		var material := StandardMaterial3D.new()
		material.albedo_color = Color("8c6544")
		display.material_override = material
		add_child(display)
	rotation.z = PI * 0.5
	set_physics_process(true)

func _physics_process(delta: float) -> void:
	age += delta
	if not is_instance_valid(source) or game == null: return
	if claiming:
		if not source.visible:
			if is_instance_valid(felling): felling.log_collected()
			queue_free()
		elif not source.get_meta("collecting", false):
			# A failed gather request leaves the physical log in the world.
			freeze = false
			claiming = false
		return
	if age < PICKUP_DELAY: return
	var receiver: Node3D = game.camera if game.get("camera") is Node3D else game.rig
	var target: Vector3 = receiver.global_position + Vector3(0, -0.35, 0)
	var distance := global_position.distance_to(target)
	if distance > ASSIST_RADIUS: return
	if distance > 0.48:
		var pull := (target - global_position).normalized() * clampf((ASSIST_RADIUS - distance) * 7.0, 1.0, 9.0)
		apply_central_force(pull * mass)
		return
	_claim()

func _claim() -> void:
	if claiming: return
	claiming = true
	freeze = true
	game.adventure.gather(source)
