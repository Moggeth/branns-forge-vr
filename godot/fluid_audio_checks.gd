extends SceneTree
var failures=[]
func _initialize(): call_deferred("run")
func run():
	var audio=preload("res://fluid_audio.gd").new(); audio.setup(root)
	if audio.get_child_count()!=2: failures.append("exactly two reusable voices")
	var old=audio.pour_voice.get_instance_id()
	audio.setup(root)
	if audio.get_child_count()!=2 or audio.pour_voice.get_instance_id()!=old: failures.append("setup is idempotent")
	var rms={}
	for key in audio.streams:
		var stream=audio.streams[key]; var sum=0.0; var peak=0.0
		for i in range(stream.data.size()/2):
			var value=stream.data.decode_s16(i*2)/32768.0
			sum+=value*value; peak=maxf(peak,absf(value))
		rms[key]=sqrt(sum/(stream.data.size()/2))
		if peak>.65 or rms[key]>.2 or rms[key]<.005: failures.append("bounded useful signal "+key)
		var end=stream.data.decode_s16((stream.loop_end-1)*2)
		var begin=stream.data.decode_s16(stream.loop_begin*2)
		if end!=begin: failures.append("seam continuity "+key)
		if stream.loop_mode!=AudioStreamWAV.LOOP_FORWARD: failures.append("looping "+key)
	print("FLUID_AUDIO_RESULT ",JSON.stringify({"failures":failures,"voices":audio.get_child_count(),"rms":rms}))
	audio.queue_free(); await process_frame
	quit(0 if failures.is_empty() else 1)
