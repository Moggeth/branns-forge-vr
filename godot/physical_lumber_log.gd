extends RigidBody3D
## The resource request is made only after the dropped log reaches the player.

const LOG_ART_PATH := "res://assets/tree_cutting/log_y.glb"
const PICKUP_DELAY := 1.1
const ASSIST_RADIUS := 2.15
const ASSIST_SPEED := 5.5

var game: Node
var source: Node3D
var felling: Node
var age := 0.0
var claiming := false
var pickup_requested := false
var pickup_hand: Node3D
var pickup_desktop := false

func setup(owner_game: Node, resource: Node3D, owner_felling: Node) -> void:
	game = owner_game
	source = resource
	felling = owner_felling
	set_meta("kind", "lumber_log")
	set_meta("resource", "lumber")
	add_to_group("physical_lumber_log")
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
			pickup_requested = false
		return
	if not pickup_requested: return
	if not is_instance_valid(pickup_hand):
		pickup_requested = false
		freeze = false
		return
	var target: Vector3 = pickup_hand.global_position
	if pickup_desktop: target -= pickup_hand.global_basis.y.normalized() * 0.38
	global_position = global_position.move_toward(target, ASSIST_SPEED * delta)
	if global_position.distance_to(target) <= 0.18: _claim()

func try_grab(hand: Node3D, desktop: bool = false) -> bool:
	# Called by the ordinary E/grip input path. A low fallen log is selected
	# within comfortable standing reach, then tethered to the hand/chest.
	if claiming or pickup_requested or age < PICKUP_DELAY or not is_instance_valid(source) or not is_instance_valid(hand): return false
	if global_position.distance_to(hand.global_position) > ASSIST_RADIUS: return false
	pickup_requested = true
	pickup_hand = hand
	pickup_desktop = desktop
	freeze = true
	return true

func _claim() -> void:
	if claiming: return
	claiming = true
	freeze = true
	if source.has_meta("scenic_builder_key"):
		if game.world_builder.claim_scenic_log(source):
			source.set_meta("collecting", true)
			source.visible = false
			if is_instance_valid(felling): felling.log_collected()
			queue_free()
		else:
			freeze = false
			claiming = false
			pickup_requested = false
	else:
		game.adventure.gather(source)
