extends Node3D
## The tracked adventurer body shared by the headset and Little Wing's window.
## Authored parts stay separate so the arms can follow real controllers.

const BODY_PATH = "res://assets/player/player.glb"
const BODY_BACK_OFFSET = 0.095
var game
var body: Node3D
var shoulder: Node3D
var head: Node3D
var player: AnimationPlayer
var arms: Dictionary = {}
var last_position := Vector3.ZERO

func setup(owner_game):
	game = owner_game
	var scene = load(BODY_PATH)
	if not scene is PackedScene:
		push_error("PLAYER_AVATAR missing authored player GLB")
		return
	body = scene.instantiate()
	body.name = "AdventurerBody"
	add_child(body)
	shoulder = body.find_child("ShoulderPerch", true, false)
	head = body.find_child("Head", true, false)
	player = body.find_child("AnimationPlayer", true, false)
	for side in ["L", "R"]:
		var upper = body.find_child("UpperArm_" + side, true, false)
		var lower = body.find_child("Forearm_" + side, true, false)
		var wrist = body.find_child("Wrist_" + side, true, false)
		if upper != null and lower != null and wrist != null:
			arms[side] = {"upper": upper, "lower": lower, "wrist": wrist,
				"upper_rest": lower.position, "lower_rest": wrist.position}
	if head != null:
		# Only the first-person camera omits the player's own head. The fairy
		# shares this world and sees the complete model from her own camera.
		for mesh in head.find_children("*", "MeshInstance3D", true, false): mesh.layers = 1 << 1
		if head is MeshInstance3D: head.layers = 1 << 1
		game.camera.cull_mask &= ~(1 << 1)
	if player != null:
		player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL
		for name in player.get_animation_list():
			var animation = player.get_animation(name)
			if animation != null: animation.loop_mode = Animation.LOOP_LINEAR
	last_position = game.camera.global_position
	print("PLAYER_AVATAR ready shoulder=", shoulder != null, " tracked_arms=", arms.size(), " animations=", player.get_animation_list() if player != null else [])

func shoulder_position() -> Vector3:
	if shoulder != null: return shoulder.global_position
	return game.camera.global_position + Basis(Vector3.UP, game.camera.global_rotation.y) * Vector3(0.24, -0.27, 0)

func _process(delta):
	if body == null or game == null or delta <= 0: return
	var eye = game.camera.global_position
	var foot_y = game.rig.global_position.y
	# Place the chest beneath the tracked head rather than through the view.
	# Use head yaw only, so looking down cannot shove the torso forward.
	var facing = -game.camera.global_basis.z
	facing.y = 0.0
	if facing.length_squared() < 0.01: facing = -game.rig.global_basis.z
	facing = facing.normalized()
	global_position = Vector3(eye.x, foot_y, eye.z) - facing * BODY_BACK_OFFSET
	global_rotation = Vector3(0, game.camera.global_rotation.y, 0)
	# Respect the tracked eye height without making every user's body a fixed
	# 1.73 m costume. Clamp out bad runtime floor calibration.
	var eye_height = eye.y - foot_y
	var body_scale = clampf(eye_height / 1.61, 0.82, 1.18)
	scale = Vector3.ONE * body_scale
	var speed = Vector2(eye.x - last_position.x, eye.z - last_position.z).length() / maxf(delta, 0.001)
	last_position = eye
	if player != null:
		var animation_name = "walk" if speed > 0.30 and speed < 8 else "idle"
		if player.has_animation(animation_name):
			if player.current_animation != animation_name: player.play(animation_name, 0.16)
			player.advance(delta)
	if head != null:
		head.rotation.x = clampf(game.camera.global_rotation.x, -0.55, 0.55)
	if not game.vr: return
	for hand in game.hands:
		if not hand.get_is_active(): continue
		var side = "L" if str(hand.tracker).begins_with("left") else "R"
		if not arms.has(side): continue
		var arm = arms[side]
		var upper: Node3D = arm.upper
		var lower: Node3D = arm.lower
		# The glove cuff lives behind the palm, along the calibrated hand socket's
		# local +Z. Aim the authored wrist at that cuff, not the controller origin.
		var socket: Node3D = game.hand_socket(hand)
		var target: Vector3 = socket.to_global(Vector3(0, 0, 0.083))
		var shoulder_point = upper.global_position
		var reach = target - shoulder_point
		if reach.length() < 0.06: continue
		# A small outward/downward elbow bend keeps the authored sleeve readable
		# and leaves the tracked hand geometry free of bulky duplicate fingers.
		var elbow = shoulder_point + reach * 0.49 + global_basis * Vector3(-0.055 if side == "L" else 0.055, -0.10, 0)
		_point_segment(upper, arm.upper_rest, elbow)
		# Pin authored child pivots to tracked targets after scaling. The model's
		# original links have small X/Z offsets, so scale alone leaves a gap.
		lower.global_position=elbow
		_point_segment(lower, arm.lower_rest, target)
		arm.wrist.global_position=target

func _point_segment(segment: Node3D, rest: Vector3, target: Vector3):
	if rest.length_squared() < 0.01: return
	var direction = target - segment.global_position
	if direction.length_squared() < 0.001: return
	var local_direction = segment.get_parent().global_basis.inverse() * direction.normalized()
	segment.quaternion = Quaternion(rest, local_direction.normalized())
	# The original art has fixed-length links. Controller reach varies wildly in
	# VR, so extend along the limb axis while retaining its authored width.
	var parent_scale: Vector3 = segment.get_parent().global_basis.get_scale()
	var intended_length: float = direction.length() / maxf(0.001, parent_scale.y)
	segment.scale = Vector3(1.0, clampf(intended_length / rest.length(), 0.55, 1.85), 1.0)
