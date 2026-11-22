extends Node3D
## Brann's imported body poses and runtime face use independent animation channels.

const MODEL_PATH := "res://assets/smithy/brann/brann.glb"
const FACE_CHANNELS: Array[StringName] = [&"BlinkL", &"BlinkR", &"MouthOpen", &"MouthWide", &"MouthRound", &"BrowLift"]
const LOOPING: Array[StringName] = [&"Idle", &"Listen", &"Talk"]
const STRIKE_PHASE := 0.72

var skeleton: Skeleton3D
var player: AnimationPlayer
var rune: MeshInstance3D
var rune_material: StandardMaterial3D
var clips: Dictionary[StringName, StringName] = {}
var channels: Dictionary[StringName, Array] = {}
var head_bone := -1
var eye_bones: Array[int] = []
var face_bone := -1
var face_marker: Node3D
var pose := &"Idle"
var forging := false
var next_blink := 2.1
var gaze_yaw := 0.0
var gaze_pitch := 0.0
var mouth_open := 0.0

var _blink_time := -1.0
var _clock := 0.0
var _inspect_at := 16.0
var _was_engaged := false
var _was_presenting := false
var _before_aim: Dictionary[int, Quaternion] = {}
var _aim_axes: Dictionary[int, Basis] = {}
var _forge_entry: Array[Transform3D] = []


func _ready() -> void:
	var source := load(MODEL_PATH) as PackedScene
	if source == null:
		push_error("The Brann character export is missing.")
		return
	var model := source.instantiate() as Node3D
	add_child(model)
	var skeletons := model.find_children("*", "Skeleton3D", true, false)
	if not skeletons.is_empty(): skeleton = skeletons[0] as Skeleton3D
	player = model.find_child("AnimationPlayer", true, false) as AnimationPlayer
	if skeleton == null or player == null:
		push_error("Brann needs the skinned character export and its embedded animations.")
		return

	for clip in player.get_animation_list():
		clips[StringName(str(clip).get_file())] = clip
	for loop in LOOPING:
		if clips.has(loop):
			player.get_animation(clips[loop]).loop_mode = Animation.LOOP_LINEAR
	player.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_MANUAL

	head_bone = skeleton.find_bone("Head")
	for name in ["EyeL", "EyeR"]:
		var index := skeleton.find_bone(name)
		if index >= 0: eye_bones.append(index)
	var character_axes := skeleton.global_basis.inverse() * global_basis
	for bone: int in [head_bone] + eye_bones:
		if bone >= 0:
			_aim_axes[bone] = skeleton.get_bone_global_rest(bone).basis.inverse() * character_axes
	face_bone = skeleton.find_bone("HammerFace")
	face_marker = model.find_child("HammerFace", true, false) as Node3D
	for mesh: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		for key in FACE_CHANNELS:
			var index := mesh.find_blend_shape_by_name(key)
			if index < 0: continue
			if not channels.has(key): channels[key] = []
			channels[key].append([mesh, index])

	rune = model.find_child("PresenceIndicator", true, false) as MeshInstance3D
	if rune != null and rune.get_active_material(0) is StandardMaterial3D:
		rune_material = rune.get_active_material(0).duplicate() as StandardMaterial3D
		rune.set_surface_override_material(0, rune_material)

	_change_pose(&"Idle", 0.0)
	print("BRANN_RIG_READY ", JSON.stringify({"bones": skeleton.get_bone_count(), "clips": clips.keys(), "face": channels.keys()}))


func _change_pose(next: StringName, blend: float) -> void:
	if not clips.has(next): return
	pose = next
	player.play(clips[next], blend)
	player.advance(0.0)


func _clear_look() -> void:
	for bone in _before_aim:
		skeleton.set_bone_pose_rotation(bone, _before_aim[bone])
	_before_aim.clear()


func _aim(bone: int, yaw: float, pitch: float) -> void:
	if bone < 0: return
	var before := skeleton.get_bone_pose_rotation(bone)
	_before_aim[bone] = before
	# The exported bones have their own rest axes. Convert character up and right
	# into those axes so the head and each eye turn the same way in Blender and Godot.
	var axes := _aim_axes[bone]
	var up := axes.y.normalized()
	var right := axes.x.normalized()
	skeleton.set_bone_pose_rotation(bone, before * Quaternion(up,yaw) * Quaternion(right,pitch))


func _set_face(key: StringName, weight: float) -> void:
	for channel in channels.get(key, []):
		channel[0].set_blend_shape_value(channel[1], weight)


func face_value(key: StringName) -> float:
	var targets: Array = channels.get(key, [])
	return 0.0 if targets.is_empty() else targets[0][0].get_blend_shape_value(targets[0][1])


func tick(delta: float, looking_at: Vector3, engaged: bool, responding: bool, speaking_level: float, presenting: bool) -> void:
	if skeleton == null or player == null: return
	delta = maxf(delta, 0.0)
	_clock += delta
	var arrived := engaged and not _was_engaged
	_was_engaged = engaged
	if not presenting: _was_presenting = false

	if not forging:
		var reveal := presenting and not _was_presenting
		_was_presenting = presenting
		_clear_look()
		var priority := &"Present" if reveal and clips.has(&"Present") else (&"Greet" if arrived and clips.has(&"Greet") else &"")
		if priority != &"":
			_change_pose(priority, 0.18)
		elif not (pose in [&"Greet", &"Inspect", &"Present"] and player.is_playing()):
			var next := &"Idle"
			if engaged:
				next = &"Talk" if responding else &"Listen"
			elif _clock >= _inspect_at and clips.has(&"Inspect"):
				_inspect_at = _clock + 17.0 + 5.0 * sin(_clock)
				next = &"Inspect"
			if pose != next or not player.is_playing(): _change_pose(next, 0.22)
		player.advance(delta)

		var direction := to_local(looking_at) - Vector3(0,1.62,0)
		var want_yaw := clampf(atan2(direction.x,direction.z), -0.68, 0.68) if engaged else 0.0
		var want_pitch := clampf(-atan2(direction.y,Vector2(direction.x,direction.z).length()), -0.25, 0.25) if engaged else 0.0
		var face_blend := 1.0 - exp(-delta * 6.0)
		gaze_yaw = lerpf(gaze_yaw, want_yaw, face_blend)
		gaze_pitch = lerpf(gaze_pitch, want_pitch, face_blend)
		_aim(head_bone, gaze_yaw * 0.82, gaze_pitch * 0.76)
		for eye in eye_bones:
			_aim(eye, clampf(want_yaw - gaze_yaw * 0.82,-0.24,0.24), clampf(want_pitch - gaze_pitch * 0.76,-0.15,0.15))

	_update_face(delta, engaged, speaking_level)


func _update_face(delta: float, engaged: bool, speaking_level: float) -> void:
	next_blink -= delta
	if next_blink <= 0.0 and _blink_time < 0.0:
		_blink_time = 0.0
		next_blink = 3.8 + 1.45 * sin(_clock * 0.73)
	var blink := 0.0
	if _blink_time >= 0.0:
		_blink_time += delta
		blink = smoothstep(0.0,0.075,_blink_time) * (1.0 - smoothstep(0.075,0.19,_blink_time))
		if _blink_time >= 0.19: _blink_time = -1.0
	_set_face(&"BlinkL", blink)
	_set_face(&"BlinkR", blink)

	# The voice service supplies an amplitude envelope. Shape the jaw and lips
	# along that envelope without attributing phonemes to it.
	var level := clampf(speaking_level,0.0,1.0) if engaged else 0.0
	mouth_open = lerpf(mouth_open, pow(level,0.72), 1.0 - exp(-delta * 22.0))
	var articulation := 0.5 + 0.5 * sin(_clock * 29.0 + 0.55 * sin(_clock * 9.0))
	_set_face(&"MouthOpen", mouth_open * lerpf(0.78,1.0,articulation))
	_set_face(&"MouthWide", mouth_open * articulation * 0.46)
	_set_face(&"MouthRound", mouth_open * (1.0 - articulation) * 0.47)
	_set_face(&"BrowLift", (0.10 if engaged and not forging else 0.0) + 0.28 * mouth_open)


func pose_forge(phase: float) -> void:
	if skeleton == null or player == null or not clips.has(&"Forge"): return
	_clear_look()
	if pose != &"Forge":
		if phase < 0.22:
			for bone in skeleton.get_bone_count():
				_forge_entry.append(skeleton.get_bone_pose(bone))
		player.stop(true)
		_change_pose(&"Forge", 0.0)
	forging = true
	var animation := player.get_animation(clips[&"Forge"])
	player.seek(animation.length * clampf(phase,0.0,1.0), true, true)
	# Fade into the first wind-up. All later cycles and the impact use the authored pose.
	if phase >= 0.22:
		_forge_entry.clear()
	elif not _forge_entry.is_empty():
		var amount := smoothstep(0.0,0.22,phase)
		for bone in skeleton.get_bone_count():
			var next := skeleton.get_bone_pose(bone)
			skeleton.set_bone_pose(bone, _forge_entry[bone].interpolate_with(next,amount))
	skeleton.force_update_all_bone_transforms()


func stop_forging() -> void:
	forging = false
	_forge_entry.clear()


func strike_point() -> Vector3:
	if face_bone >= 0:
		return skeleton.to_global(skeleton.get_bone_global_pose(face_bone).origin)
	if face_marker != null:
		return face_marker.global_position
	return Vector3.INF
