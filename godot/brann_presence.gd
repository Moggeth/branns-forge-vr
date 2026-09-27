extends Node
## Presentation and proximity are separate from microphone/session authority.
var game
var distance=0.0
var phase="away"
var leaving_since=-1.0
var last_voice="idle"
var greeting=0.0
var glance_next=5.0
var glance_until=0.0
var glance_side=1.0
var pupils=[]
@export var departure_grace_seconds=6.0
@export var conversation_max_distance=6.0
@export var gaze_follow_speed=3.0
@export var glance_interval_seconds=6.5

func setup(owner_game):
	game=owner_game
	for part in game.scene.brann.get_meta("speech_head").get_children():
		if part.get_meta("pupil",false): pupils.append({"node":part,"home":part.position})

func proximity():
	var p=game.camera.global_position-game.scene.brann.global_position
	distance=Vector2(p.x,p.z).length()
	if game.adventure.zone!="forge_yard":
		game.visiting=false
		leaving_since=-1
	elif game.visiting:
		if distance<2.9: leaving_since=-1
		elif distance>3.2 and leaving_since<0: leaving_since=game.elapsed
		if distance>conversation_max_distance or (leaving_since>=0 and game.elapsed-leaving_since>departure_grace_seconds): game.visiting=false
	elif distance<2.6:
		game.visiting=true
		leaving_since=-1
	phase="leaving" if game.visiting and leaving_since>=0 else ("near" if game.visiting else "away")

func tick(delta):
	var head=game.scene.brann.get_meta("speech_head")
	var voice=game.state.get("voiceClient",{})
	var status=str(voice.get("phase","idle")) if voice.get("connected",false) else "error"
	if not game.visiting: status="idle"
	if game.speech_level>0.04 and game.visiting: status="speaking"
	if status=="listening" and last_voice not in ["listening","speaking"]: greeting=game.elapsed
	last_voice=status
	if game.elapsed>glance_next:
		glance_until=game.elapsed+0.75
		glance_next=game.elapsed+glance_interval_seconds+sin(game.elapsed)*1.5
		glance_side*=-1
	var point=game.scene.brann.to_local(game.camera.global_position)-head.position
	var engaged=game.visiting and point.z>0
	var yaw=clampf(atan2(point.x,point.z),-0.7,0.7) if engaged else 0.0
	var pitch=clampf(-atan2(point.y,maxf(0.1,Vector2(point.x,point.z).length())),-0.3,0.3) if engaged else 0.04
	if engaged and game.elapsed<glance_until: yaw+=glance_side*0.2
	var nod=sin(clampf((game.elapsed-greeting)*3,0,PI))*0.07 if greeting>0 else 0.0
	head.rotation.y=lerp_angle(head.rotation.y,yaw,clampf(delta*gaze_follow_speed,0,1))
	head.rotation.x=lerpf(head.rotation.x,pitch+nod,clampf(delta*gaze_follow_speed,0,1))+sin(game.elapsed*11)*game.speech_level*0.002
	head.rotation.z=sin(game.elapsed*6)*game.speech_level*0.012
	for pupil in pupils:
		pupil.node.position=pupil.home+Vector3(clampf(yaw-head.rotation.y,-0.3,0.3)*0.025,clampf(-pitch,-0.3,0.3)*0.02,0)
	var color=Color("74837c")
	var caption=""
	match status:
		"opening","connecting": color=Color("ffc573"); caption="One moment…"
		"listening": color=Color("85e7cb"); caption="I'm listening"
		"speaking": color=Color("ffd58a")
		"error": color=Color("c78980"); caption="Tap to talk"
	if phase=="leaving": caption="Heading out?"
	var rune=game.scene.brann.get_meta("presence_rune")
	var pulse=1.0+sin(game.elapsed*4)*0.12 if status in ["opening","connecting"] else 1.0+game.speech_level*0.25
	rune.scale=Vector3(0.075,0.09,0.035)*pulse
	rune.material_override.albedo_color=color
	rune.material_override.emission_enabled=status!="idle"
	rune.material_override.emission=color
	rune.material_override.emission_energy_multiplier=0.5
	game.scene.brann.get_meta("presence_label").text=caption
