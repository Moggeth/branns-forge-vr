extends Node3D
## Reusable quiet, non-rhythmic pouring and extinguishing. Exactly two pooled voices.
## Instantiate once, setup(parent), then update(state...) every rendered frame.
var pour_voice:AudioStreamPlayer3D
var hiss_voice:AudioStreamPlayer3D
var streams={}
var pour_gain=0.0
var hiss_gain=0.0
var water_mode=false
var hiss_hold=0.0
var initialized=false

func setup(owner_node:Node):
	if initialized: return
	if get_parent()==null: owner_node.add_child(self)
	streams={"oil":_stream(7201,"oil"),"water":_stream(9203,"water"),"hiss":_stream(4109,"hiss")}
	pour_voice=_voice(); hiss_voice=_voice()
	pour_voice.stream=streams.oil; hiss_voice.stream=streams.hiss
	initialized=true

func _voice()->AudioStreamPlayer3D:
	var voice=AudioStreamPlayer3D.new(); add_child(voice)
	voice.max_distance=10; voice.unit_size=1.5; voice.max_db=-12
	voice.volume_db=-80; voice.attenuation_filter_cutoff_hz=4200
	return voice

func update(pouring:bool,water:bool,position:Vector3,extinguishing:bool,delta:float):
	if not initialized: return
	if position.is_finite() and (pouring or extinguishing): global_position=position
	if pouring and water_mode!=water:
		water_mode=water
		pour_voice.stop(); pour_voice.stream=streams.water if water else streams.oil
		pour_gain=0.0
	if extinguishing: hiss_hold=.3
	else: hiss_hold=maxf(0,hiss_hold-maxf(0,delta))
	var smooth=1.0-exp(-maxf(0,delta)*8.0)
	pour_gain=lerpf(pour_gain,.1 if pouring else 0.0,smooth)
	hiss_gain=lerpf(hiss_gain,.12 if hiss_hold>0 else 0.0,smooth)
	_drive(pour_voice,pour_gain)
	_drive(hiss_voice,hiss_gain)

func _drive(voice:AudioStreamPlayer3D,gain:float):
	voice.volume_db=linear_to_db(maxf(.0001,gain))
	if gain>.0002:
		if not voice.playing: voice.play()
	elif voice.playing: voice.stop()

func stop():
	if not initialized: return
	pour_voice.stop(); hiss_voice.stop()
	pour_gain=0; hiss_gain=0; hiss_hold=0

func _stream(seed_value:int,kind:String)->AudioStreamWAV:
	var random=RandomNumberGenerator.new(); random.seed=seed_value
	var count=66150 # Three seconds at 22050 Hz, no rhythmic or tonal component.
	var samples=PackedFloat32Array(); samples.resize(count)
	var low=0.0; var soft=0.0; var contour=0.0
	for i in range(count):
		var noise=random.randf_range(-1,1)
		low=lerpf(low,noise,.12 if kind=="water" else .075)
		soft=lerpf(soft,low,.19 if kind=="hiss" else .055)
		contour=lerpf(contour,random.randf_range(-1,1),.0018)
		var texture=soft*1.8 if kind=="oil" else (soft*1.7+low*.25)
		if kind=="hiss": texture=soft*1.6+low*.35
		samples[i]=clampf(texture*(.8+clampf(contour*6,-.28,.28)),-.8,.8)
	# Blend the tail into the exact beginning so a looping stream has no click.
	var seam=2646
	for i in range(seam):
		var t=float(i)/float(seam-1)
		samples[count-seam+i]=lerpf(samples[count-seam+i],samples[i],t*t*(3-2*t))
	var data=PackedByteArray(); data.resize(count*2)
	for i in range(count): data.encode_s16(i*2,int(samples[i]*25000))
	var wav=AudioStreamWAV.new(); wav.format=AudioStreamWAV.FORMAT_16_BITS
	wav.mix_rate=22050; wav.data=data
	# Tail joins samples[seam-1], so resume at that frame, not frame zero.
	wav.loop_mode=AudioStreamWAV.LOOP_FORWARD; wav.loop_begin=seam-1; wav.loop_end=count
	return wav
