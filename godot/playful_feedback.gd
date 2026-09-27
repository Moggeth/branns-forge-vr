extends Node
## Small, pooled celebrations and nearby, readable instructions. No gameplay/save ownership.
const MAX_MOTES = 48
const MAX_VOICES = 6
const MAX_HINTS = 12
const FAR_DISTANCE = 11.0
const NEAR_DISTANCE = 4.0
const PALETTE = {"throw":Color("9fe4cf"), "recall":Color("a8dcec"), "catch":Color("fff0ac"), "hit":Color("ffd078"), "progress":Color("c7efb0"), "reward":Color("ffbd76"), "warning":Color("d9c3ec")}
var game
var visuals: Node3D
var enabled = true
var audio_enabled = true
var reduced_motion = false
var clock = 0.0
var hints = {}
var sounds = {}
var last_sound = {}
var voices: Array[AudioStreamPlayer3D] = []
var motes = []
var mesh: MultiMesh
var cursor = 0
var voice_cursor = 0
var sound_serial = 0

func setup(owner_game):
	if is_instance_valid(visuals): return
	game = owner_game
	visuals = Node3D.new()
	visuals.name = "PlayfulFeedback"
	game.add_child(visuals)
	var shard = PrismMesh.new()
	shard.size = Vector3(0.035, 0.07, 0.028)
	var material = StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.vertex_color_use_as_albedo = true
	shard.material = material
	mesh = MultiMesh.new()
	mesh.transform_format = MultiMesh.TRANSFORM_3D
	mesh.use_colors = true
	mesh.mesh = shard
	mesh.instance_count = MAX_MOTES
	var instance = MultiMeshInstance3D.new()
	instance.multimesh = mesh
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	instance.custom_aabb = AABB(Vector3(-10000,-10000,-10000),Vector3.ONE*20000)
	visuals.add_child(instance)
	for i in range(MAX_MOTES):
		motes.append({"position":Vector3.ZERO,"velocity":Vector3.ZERO,"life":0.0,"duration":1.0,"spin":0.0})
		mesh.set_instance_transform(i,Transform3D(Basis.IDENTITY.scaled(Vector3.ZERO),Vector3.ZERO))
	for i in range(MAX_VOICES):
		var voice = AudioStreamPlayer3D.new()
		voice.max_distance = 15.0
		voice.unit_size = 2.0
		voice.volume_db = -13.0
		voice.max_db = -10.0
		visuals.add_child(voice)
		voices.append(voice)
	for kind in PALETTE: sounds[kind] = _synthesize(kind)

func pulse(world_position: Vector3, kind: String, strength = 1.0):
	if not enabled or not is_instance_valid(visuals) or not world_position.is_finite(): return
	if not PALETTE.has(kind): kind = "hit"
	strength = clampf(float(strength),0.15,2.0)
	var amount = mini(MAX_MOTES, int((14 if kind == "reward" else 7)*strength))
	if reduced_motion: amount = mini(3,amount)
	for i in range(amount):
		var index = cursor % MAX_MOTES
		cursor = (cursor + 1) % MAX_MOTES
		var angle = float(index)*2.399963 + clock
		var mote = motes[index]
		mote.position = world_position
		mote.velocity = Vector3(cos(angle),0.7+float(index%4)*0.19,sin(angle))*0.85*strength
		if reduced_motion: mote.velocity *= 0.12
		mote.duration = 0.65 if kind != "reward" else 1.05
		mote.life = mote.duration
		mote.spin = angle
		mesh.set_instance_color(index,PALETTE[kind])
	_play_sound(world_position,kind,strength)

func _play_sound(world_position: Vector3, kind: String, strength: float):
	if not audio_enabled: return
	# Event storms cannot turn into an accidental continuous melody.
	if clock-float(last_sound.get(kind,-100.0)) < 0.11: return
	last_sound[kind] = clock
	var voice = voices[voice_cursor]
	voice_cursor = (voice_cursor+1)%MAX_VOICES
	voice.stop()
	voice.global_position = world_position
	voice.stream = sounds[kind]
	voice.pitch_scale = [0.98,1.0,1.025][sound_serial%3]
	sound_serial += 1
	voice.volume_db = -16.0 + minf(strength,1.5)*2.0
	voice.play()

func tick(delta: float):
	if not is_instance_valid(visuals): return
	delta = maxf(0.0,delta)
	clock += delta
	visuals.visible = enabled
	if not enabled:
		for voice in voices: voice.stop()
	for i in range(MAX_MOTES):
		var mote = motes[i]
		if mote.life <= 0: continue
		mote.life = maxf(0.0,mote.life-delta)
		mote.position += mote.velocity*delta
		mote.velocity.y -= delta*0.75
		var size = minf(1.0,mote.life/0.22) if enabled else 0.0
		var rotation = Basis(Vector3.UP,mote.spin+clock*2.0)
		mesh.set_instance_transform(i,Transform3D(rotation.scaled(Vector3.ONE*size),mote.position))
	_update_hints()

func register_hint(id: String, stand: Node3D, title: String, desktop_text: String, vr_text: String, offset = Vector3(0,1.6,0)) -> bool:
	if not is_instance_valid(stand) or not is_instance_valid(visuals): return false
	if hints.has(id): unregister_hint(id)
	if hints.size() >= MAX_HINTS: return false
	var root = Node3D.new()
	root.name = "Discover_" + id
	visuals.add_child(root)
	var label = Label3D.new()
	label.font_size = 28
	label.pixel_size = 0.0025
	label.width = 680
	label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.outline_size = 9
	label.outline_modulate = Color("182531")
	label.modulate = Color("fff2cf")
	label.no_depth_test = false
	root.add_child(label)
	var halo = MeshInstance3D.new()
	var ring = TorusMesh.new()
	ring.inner_radius = 0.47
	ring.outer_radius = 0.51
	ring.rings = 20
	ring.ring_segments = 4
	halo.mesh = ring
	halo.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var material = StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = Color("d0b97c")
	halo.material_override = material
	root.add_child(halo)
	hints[id] = {"stand":weakref(stand),"root":root,"label":label,"halo":halo,"offset":offset,"title":title,"desktop":desktop_text,"vr":vr_text,"status":"","near":false}
	_update_hints()
	return true

func set_hint_status(id: String, value: String):
	if hints.has(id): hints[id].status = value

func unregister_hint(id: String):
	if not hints.has(id): return
	var root = hints[id].root
	if is_instance_valid(root):
		root.visible = false
		root.queue_free()
	hints.erase(id)

func _update_hints():
	if game == null or not is_instance_valid(game.camera): return
	for id in hints.keys():
		var hint = hints[id]
		var stand = hint.stand.get_ref()
		if not is_instance_valid(stand):
			unregister_hint(id)
			continue
		var distance = game.camera.global_position.distance_to(stand.global_position)
		hint.root.visible = enabled and stand.is_visible_in_tree() and distance < FAR_DISTANCE
		if not hint.root.visible: continue
		hint.root.global_position = stand.global_position
		hint.label.position = hint.offset
		hint.halo.position = Vector3(0,0.04,0)
		hint.near = distance < NEAR_DISTANCE
		hint.halo.scale = Vector3.ONE*(1.15 if hint.near else 1.0)
		hint.halo.material_override.albedo_color = Color("ffedb0") if hint.near else Color("b5a583")
		var content = str(hint.title)
		if hint.near:
			content += "\n" + str(hint.vr if game.vr else hint.desktop)
			if not str(hint.status).is_empty(): content += "\n"+str(hint.status)
		else:
			content += "\n▼ Come closer to try"
		if hint.label.text != content: hint.label.text = content

func _synthesize(kind: String) -> AudioStreamWAV:
	# Hand-shaped soft pluck/chime partials; rendered once, no files or external audio.
	var frequencies = {"throw":[392.0],"recall":[440.0,587.33],"catch":[523.25,659.25],"hit":[659.25,783.99],"progress":[523.25,659.25,783.99],"reward":[392.0,523.25,659.25,783.99],"warning":[329.63,392.0]}
	var notes = frequencies[kind]
	var duration = 0.70 if kind == "reward" else 0.36
	var rate = 22050
	var count = int(duration*rate)
	var bytes = PackedByteArray()
	bytes.resize(count*2)
	for i in range(count):
		var t = float(i)/float(rate)
		var sample = 0.0
		for j in range(notes.size()):
			var age = t-float(j)*0.038
			if age < 0: continue
			var frequency = float(notes[j])
			var envelope = (1.0-exp(-age*200.0))*exp(-age*9.5)*clampf((duration-t)/0.04,0.0,1.0)
			sample += (sin(TAU*frequency*age)+0.15*sin(TAU*frequency*2.0*age))*envelope
		sample *= 0.22/float(notes.size())
		bytes.encode_s16(i*2,int(clampf(sample,-0.8,0.8)*32767.0))
	var stream = AudioStreamWAV.new()
	stream.format = AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate = rate
	stream.stereo = false
	stream.data = bytes
	return stream
