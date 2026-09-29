extends SceneTree

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var owner = Node.new()
	root.add_child(owner)
	var music = preload("res://adaptive_music.gd").new()
	music.setup(owner)
	if music.voices.size() != music.CUES.size(): failures.append("one reusable voice per cue")
	for zone in ["forge_yard", "enchanted_kitchen", "sky_garden"]:
		if music._zone_state(zone) != "settlement": failures.append("settlement " + zone)
	for zone in ["mushroom_glade", "crystal_hollow", "gloamfen", "starfall_ridge"]:
		if music._zone_state(zone) != "mysterious": failures.append("mysterious " + zone)
	if music._zone_state("pinewood_ruins") != "exploration": failures.append("exploration")
	music.set_context("gloamfen", false, false)
	if music.desired_state != "mysterious": failures.append("zone change")
	music.set_context("gloamfen", true, false)
	if music.desired_state != "combat" or music.active_state != "combat": failures.append("combat priority")
	music.set_context("gloamfen", false, true)
	if music.desired_state != "rts" or music.active_state != "rts": failures.append("tactical priority")
	for cue in music.CUES:
		var stream: AudioStreamWAV = music.CUES[cue]
		if stream == null or stream.get_length() < 15.0 or stream.get_length() > 17.0:
			failures.append("cue length " + cue)
	music.stop()
	music._start("settlement")
	var settlement_voice: int = music.active_voice
	music.levels[settlement_voice] = 0.11
	music._start("rts")
	var rts_voice: int = music.active_voice
	music.levels[rts_voice] = 0.08
	music._start("settlement")
	if music.active_voice != settlement_voice or not is_equal_approx(music.levels[settlement_voice], 0.11):
		failures.append("rapid A-B-A change cut the fading A cue")
	if music.enabled and not music.voices[settlement_voice].playing:
		failures.append("rapid A-B-A change stopped the audible A voice")
	music._start("combat")
	if music.active_voice in [settlement_voice, rts_voice] or not is_equal_approx(music.levels[rts_voice], 0.08):
		failures.append("rapid third cue evicted an audible transition")
	music.stop()
	owner.queue_free()
	await process_frame
	print("ADAPTIVE_MUSIC_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
