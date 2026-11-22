extends Node
## Presence and interaction are independent of the speech connection.

var game
var distance := 0.0
var phase := "away"
var leaving_since := -1.0
@export var departure_grace_seconds := 6.0
@export var conversation_max_distance := 6.0


func setup(owner_game):
	game = owner_game


func proximity():
	var offset: Vector3 = game.camera.global_position - game.scene.brann.global_position
	distance = Vector2(offset.x,offset.z).length()
	if game.adventure.zone != "forge_yard":
		game.visiting = false
		leaving_since = -1.0
	elif game.visiting:
		if distance < 2.9: leaving_since = -1.0
		elif distance > 3.2 and leaving_since < 0.0: leaving_since = game.elapsed
		if distance > conversation_max_distance or (leaving_since >= 0.0 and game.elapsed - leaving_since > departure_grace_seconds):
			game.visiting = false
	elif distance < 2.6:
		game.visiting = true
		leaving_since = -1.0
	phase = "leaving" if game.visiting and leaving_since >= 0.0 else ("near" if game.visiting else "away")


func tick(delta: float) -> void:
	var brann = game.scene.brann
	var voice = game.state.get("voiceClient",{})
	var status := str(voice.get("phase","idle")) if voice.get("connected",false) else "error"
	if not game.visiting: status = "idle"
	if game.speech_level > 0.04 and game.visiting: status = "speaking"
	var camera: Vector3 = game.camera.global_position
	var towards := Vector2(camera.x - brann.global_position.x, camera.z - brann.global_position.z)
	var engaged: bool = game.visiting and towards.y > 0.05 and towards.length() < conversation_max_distance
	brann.tick(delta, camera, engaged, status == "speaking", game.speech_level, game.workshop_delivery.revealing)
	var color := Color("74837c")
	var caption := ""
	match status:
		"opening", "connecting": color = Color("ffc573"); caption = "One moment…"
		"listening": color = Color("85e7cb"); caption = "I'm listening"
		"speaking": color = Color("ffd58a")
		"error": color = Color("c78980"); caption = "Tap to talk"
	if phase == "leaving": caption = "Heading out?"
	var glow: StandardMaterial3D = brann.rune_material
	if glow != null:
		glow.albedo_color = color
		glow.emission_enabled = status != "idle"
		glow.emission = color
		glow.emission_energy_multiplier = 0.5 + 0.25 * game.speech_level
	var label: Label3D = brann.get_meta("presence_label")
	if label.text != caption: label.text = caption
