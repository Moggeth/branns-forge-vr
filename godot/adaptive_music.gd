extends Node
## A restrained, original five-cue score with intentional space for world audio.
## setup(game), then tick(delta) from the game loop. Each cue has one reusable
## voice so a rapid A-B-A change can fade back into A without cutting it off.

const CUES = {
	"exploration": preload("res://audio/music/exploration.wav"),
	"combat": preload("res://audio/music/combat.wav"),
	"settlement": preload("res://audio/music/settlement.wav"),
	"mysterious": preload("res://audio/music/mysterious.wav"),
	"rts": preload("res://audio/music/rts.wav"),
}
const CUE_ORDER = ["exploration", "combat", "settlement", "mysterious", "rts"]
const MYSTERY_ZONES = ["mushroom_glade", "crystal_hollow", "gloamfen", "starfall_ridge"]
const SETTLEMENT_ZONES = ["forge_yard", "enchanted_kitchen", "sky_garden"]

var game: Node
var voices: Array[AudioStreamPlayer] = []
var levels = [0.0, 0.0, 0.0, 0.0, 0.0]
var active_voice = -1
var active_state = ""
var desired_state = "exploration"
var scan_timer = 0.0
var phrase_timer = 0.0
var quiet_timer = 5.0
var threat_hold = 0.0
var rng = RandomNumberGenerator.new()
var enabled = true

func setup(owner_game: Node) -> void:
	game = owner_game
	if get_parent() == null: owner_game.add_child(self)
	rng.seed = 11973
	for index in range(CUE_ORDER.size()):
		var voice = AudioStreamPlayer.new()
		voice.name = "MusicVoice_%s" % CUE_ORDER[index]
		voice.volume_db = -80.0
		add_child(voice)
		voices.append(voice)
	# The headless dummy driver has leaked WAV playback in other runtime checks.
	enabled = DisplayServer.get_name() != "headless"

func tick(delta: float) -> void:
	if not enabled or game == null: return
	var step = maxf(0.0, delta)
	scan_timer -= step
	if scan_timer <= 0.0:
		scan_timer = 0.5
		var zone = str(game.adventure.zone) if game.adventure != null else "forge_yard"
		var tactical = is_instance_valid(game.director_local_view) and game.director_local_view.has_focus()
		tactical = tactical or (is_instance_valid(game.world_builder_view) and game.world_builder_view.has_focus())
		var danger = _nearby_danger()
		set_context(zone, danger, tactical)
	var target_gain = 0.0
	if active_voice >= 0:
		phrase_timer -= step
		if phrase_timer <= 0.0 and desired_state != "combat":
			active_voice = -1
			active_state = ""
			quiet_timer = rng.randf_range(14.0, 28.0)
		else:
			var master = clampf(float(game.tuning.value("audio.volume")), 0.0, 1.0) if game.tuning != null else 0.65
			target_gain = 0.28 * master
	else:
		quiet_timer -= step
		if quiet_timer <= 0.0:
			_start(desired_state)
	for index in range(voices.size()):
		var goal = target_gain if index == active_voice else 0.0
		# Roughly 3 seconds to fade up, 2 seconds to fade down.
		var speed = 0.33 if goal > levels[index] else 0.5
		levels[index] = move_toward(levels[index], goal, speed * step * 0.18)
		voices[index].volume_db = linear_to_db(maxf(0.0001, levels[index]))
		if levels[index] < 0.0005 and index != active_voice and voices[index].playing:
			voices[index].stop()

func set_context(zone: String, danger: bool, tactical: bool) -> void:
	if danger: threat_hold = 8.0
	else: threat_hold = maxf(0.0, threat_hold - 0.5)
	var next_state = "rts" if tactical else ("combat" if threat_hold > 0.0 else _zone_state(zone))
	if next_state == desired_state: return
	desired_state = next_state
	if active_voice >= 0 or next_state == "combat" or next_state == "rts":
		_start(next_state)
	else:
		quiet_timer = minf(quiet_timer, 4.0)

func _zone_state(zone: String) -> String:
	if zone in MYSTERY_ZONES: return "mysterious"
	if zone in SETTLEMENT_ZONES: return "settlement"
	return "exploration"

func _nearby_danger() -> bool:
	if game.adventure == null or game.camera == null: return false
	if game.adventure.dying or game.elapsed < game.hurts_until: return true
	var player_position: Vector3 = game.camera.global_position
	for enemy in game.scene.get("enemies", []):
		if not is_instance_valid(enemy) or not enemy.get_meta("alive", false): continue
		if not enemy.is_visible_in_tree(): continue
		if enemy.global_position.distance_squared_to(player_position) < 100.0: return true
	return false

func _start(state: String) -> void:
	if not CUES.has(state): return
	var index = CUE_ORDER.find(state)
	if index < 0: return
	# A fading cue keeps its playback position and current gain if we return to
	# it before the fade has completed. The five existing cues never evict one
	# another, even under rapid combat / RTS / exploration transitions.
	if not voices[index].playing:
		voices[index].stream = CUES[state]
		if voices[index].stream is AudioStreamWAV:
			voices[index].stream.loop_mode = AudioStreamWAV.LOOP_FORWARD
		if levels[index] < 0.0005: levels[index] = 0.0
		voices[index].volume_db = linear_to_db(maxf(0.0001, levels[index]))
		if enabled: voices[index].play()
	active_voice = index
	active_state = state
	phrase_timer = rng.randf_range(26.0, 42.0) if state != "combat" and state != "rts" else 999999.0
	quiet_timer = 0.0
	print("MUSIC cue=", state)

func stop() -> void:
	for voice in voices: voice.stop()
	levels = [0.0, 0.0, 0.0, 0.0, 0.0]
	active_voice = -1
	active_state = ""
	quiet_timer = 5.0
