extends SceneTree
## Isolated offline feedback test: never loads main scene, network, or player state.
class FakeGame extends Node3D:
	var camera: Camera3D
	var vr = false

var failures: Array[String] = []

func _initialize(): call_deferred("run")

func check(condition: bool, message: String):
	if not condition: failures.append(message)

func run():
	var game = FakeGame.new()
	root.add_child(game)
	game.camera = Camera3D.new()
	game.add_child(game.camera)
	game.camera.position = Vector3(0,1.6,2)
	var feedback = load("res://playful_feedback.gd").new()
	game.add_child(feedback)
	feedback.setup(game)
	feedback.audio_enabled = false
	var initial_count = feedback.visuals.get_child_count()
	for i in range(1200):
		feedback.pulse(Vector3.ZERO,["throw","recall","hit","catch","progress","reward","warning"][i%7],1.5)
		feedback.tick(0.001)
	check(feedback.motes.size() == 48,"Mote pool must remain bounded after 1200 events")
	check(feedback.voices.size() == 6,"Spatial audio voice pool bounded")
	check(feedback.visuals.get_child_count() == initial_count,"Events must not allocate scene nodes")
	feedback.tick(3.0)
	for mote in feedback.motes: check(mote.life == 0.0,"Expired motes must retire")
	# The headless dummy renderer does not retain MultiMesh transforms for readback.
	# GPU visibility is checked by the coordinated rendered pass; lifetime is authoritative here.
	var stand = Node3D.new()
	game.add_child(stand)
	check(feedback.register_hint("ring",stand,"Sunskipper","E: hold · Click: throw","Grip: hold · Trigger: recall"),"Stand hint registers")
	feedback.set_hint_status("ring","Three targets await")
	feedback.tick(0.01)
	check(feedback.hints.ring.label.text.contains("E: hold"),"Nearby desktop controls are visible")
	check(feedback.hints.ring.label.text.contains("Three targets await"),"Live progress is shown")
	game.vr = true
	feedback.tick(0.01)
	check(feedback.hints.ring.label.text.contains("Grip: hold"),"VR hint uses VR controls")
	game.camera.position.z = 8.0
	feedback.tick(0.01)
	check(feedback.hints.ring.root.visible and feedback.hints.ring.label.text.contains("Come closer"),"Distant stand provides a discovery prompt")
	game.camera.position.z = 20.0
	feedback.tick(0.01)
	check(not feedback.hints.ring.root.visible,"Faraway instructions do not clutter other zones")
	game.camera.position.z = 2.0
	stand.hide()
	feedback.tick(0.01)
	check(not feedback.hints.ring.root.visible,"Hidden stand cannot leak a discovery marker")
	stand.free()
	feedback.tick(0.01)
	check(feedback.hints.is_empty(),"Freed stands remove hint registrations")
	for i in range(13):
		var another = Node3D.new()
		game.add_child(another)
		feedback.register_hint(str(i),another,"Trial","E","Grip")
	check(feedback.hints.size() == 12,"Hint count is capped")
	for kind in feedback.sounds:
		var sound: AudioStreamWAV = feedback.sounds[kind]
		check(sound.mix_rate == 22050 and not sound.stereo,"Procedural sounds must be spatial mono")
		var peak = 0
		for i in range(sound.data.size()/2): peak = maxi(peak,absi(sound.data.decode_s16(i*2)))
		check(peak > 100 and peak < 12000,"Sound must be audible and comfortably bounded")
	feedback.audio_enabled = true
	feedback.pulse(Vector3.ONE,"reward")
	check(feedback.voices[0].global_position == Vector3.ONE,"Feedback audio emits at the event position")
	var serial = feedback.sound_serial
	feedback.pulse(Vector3.ONE,"reward")
	check(feedback.sound_serial == serial,"Same-kind sound storms are rate limited")
	feedback.enabled = false
	feedback.tick(0.01)
	check(not feedback.visuals.visible,"Feedback visibility can be disabled")
	for voice in feedback.voices: check(not voice.playing,"Disabled feedback silences active voices")
	game.free()
	await process_frame
	print("PLAYFUL_FEEDBACK_RESULT ",JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
