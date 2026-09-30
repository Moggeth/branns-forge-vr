extends Node3D
## Adapter: authored visual events, fixed-cost nearby crystal light, spatial sound.
const CrystalArt = preload("res://starfall_crystal_art.gd")
const EventArt = preload("res://starfall_event_art.gd")
const LIGHT_COUNT := 3
const AUDIO_COUNT := 6
static var streams := {}
var game
var events: Node3D
var crystal_art = CrystalArt.new()
var lights: Array[OmniLight3D] = []
var audio: Array[AudioStreamPlayer3D] = []
var next_sources := 0.0
var light_sources: Array[Node3D] = []
var next_audio := 0

func setup(owner_game) -> void:
	game=owner_game
	crystal_art.warm_cache()
	events=EventArt.new()
	add_child(events)
	events.setup(game)
	events.cull_distance=180.0
	events.sound_requested.connect(_sound)
	events.haptic_requested.connect(_haptic)
	for index in LIGHT_COUNT:
		var light:=OmniLight3D.new()
		light.name="SharedCrystalLight%d"%index
		light.shadow_enabled=false
		light.omni_range=6.5
		light.light_energy=0.0
		add_child(light)
		lights.append(light)
	for index in AUDIO_COUNT:
		var player:=AudioStreamPlayer3D.new()
		player.max_distance=95.0
		player.unit_size=8.0
		add_child(player)
		audio.append(player)
	# One-time cached synthesis, never on the cast/impact frame.
	for kind in ["entry","impact","crystal_chime"]:
		if not streams.has(kind): streams[kind]=_stream(kind)

func watch_meteor(meteor: Node3D) -> void:
	meteor.set_crystal_art(crystal_art)
	for gem in meteor.gems:
		gem.add_to_group("landscape_crystal")
		gem.set_meta("crystal_seed",int(meteor.record.seed))
	events.watch_meteor(meteor)

func tick(delta: float) -> void:
	events.tick(delta)
	var in_zone: bool=game.adventure.zone=="orchard_highlands"
	if game.elapsed>=next_sources:
		next_sources=game.elapsed+0.2
		light_sources.clear()
		if in_zone:
			var eye:Vector3=game.camera.global_position
			if is_instance_valid(game.world_builder_view) and game.world_builder_view.has_focus(): eye=game.world_builder_view.focus_point
			var distances:Array[float]=[]
			for source in get_tree().get_nodes_in_group("landscape_crystal"):
				if not source is Node3D or not source.is_visible_in_tree(): continue
				var offset:Vector3=source.global_position-eye
				var distance:float=Vector2(offset.x,offset.z).length_squared()
				if distance>40.0*40.0: continue
				var index:=0
				while index<distances.size() and distances[index]<distance: index+=1
				if index>=LIGHT_COUNT: continue
				distances.insert(index,distance)
				light_sources.insert(index,source)
				if distances.size()>LIGHT_COUNT: distances.pop_back(); light_sources.pop_back()
	for index in lights.size():
		var light:=lights[index]
		var live:bool=in_zone and index<light_sources.size() and is_instance_valid(light_sources[index]) and light_sources[index].is_visible_in_tree()
		light.light_energy=lerpf(light.light_energy,0.58 if live else 0.0,clampf(delta*9.0,0.0,1.0))
		if live:
			var source:=light_sources[index]
			light.global_position=source.global_position+Vector3.UP*0.35
			light.light_color=crystal_art.glow_color(int(source.get_meta("crystal_seed",0)))

func _sound(kind:String,position:Vector3,strength:float) -> void:
	if game.adventure.zone!="orchard_highlands" or not streams.has(kind): return
	var volume:float=game.tuning.value("audio.volume") if game.tuning!=null else 1.0
	if volume<=0.0: return
	var player:=audio[next_audio%AUDIO_COUNT]
	next_audio+=1
	player.stop()
	player.global_position=position
	player.stream=streams[kind]
	player.volume_db=-10.0+linear_to_db(maxf(strength,0.05)*volume)
	player.play()

func _haptic(position:Vector3,strength:float,duration:float) -> void:
	if not game.vr or game.adventure.zone!="orchard_highlands": return
	var distance:float=game.camera.global_position.distance_to(position)
	if distance>18.0: return
	for hand in game.hands:
		if hand.get_is_active(): hand.trigger_haptic_pulse("haptic",0.0,clampf(strength*(1.0-distance/18.0)*0.35,0.0,0.35),duration,0.0)

static func _stream(kind:String) -> AudioStreamWAV:
	const RATE:=22050
	var duration:=1.2 if kind=="impact" else (0.75 if kind=="entry" else 1.1)
	var count:=int(duration*RATE)
	var bytes:=PackedByteArray()
	bytes.resize(count*2)
	var rng:=RandomNumberGenerator.new()
	rng.seed=hash(kind)
	var low:=0.0
	for index in count:
		var t:=float(index)/RATE
		var noise:=rng.randf_range(-1.0,1.0)
		low=lerpf(low,noise,0.045)
		var sample:=0.0
		if kind=="impact": sample=(sin(t*TAU*46.0)*0.55+low*1.7+noise*exp(-t*32.0)*0.25)*exp(-t*4.5)
		elif kind=="entry": sample=(low*1.4+sin(TAU*(180.0*t+210.0*t*t))*0.12)*sin(PI*t/duration)*0.75
		else: sample=(sin(t*TAU*880.0)*0.28+sin(t*TAU*1320.0)*0.14+sin(t*TAU*1762.0)*0.10)*exp(-t*5.0)
		var envelope:=minf(t*160.0,1.0)*minf((duration-t)*40.0,1.0)
		bytes.encode_s16(index*2,int(clampf(sample*envelope,-1.0,1.0)*22000.0))
	var stream:=AudioStreamWAV.new()
	stream.format=AudioStreamWAV.FORMAT_16_BITS
	stream.mix_rate=RATE
	stream.data=bytes
	return stream
