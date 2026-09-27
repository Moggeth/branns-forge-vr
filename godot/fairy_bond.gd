extends Node
## Small cooperative rituals, using actual proximity and voluntary perching.
const A=preload("res://world_zones.gd")
var fairy
var shoulder:Node3D
var borrowed:OmniLight3D
var seed:MeshInstance3D
var charge=0.0
var light_until=0.0
var pulse_ready=0.0
var last_zone=""
var last_spark=0.0
func setup(owner):
	fairy=owner; last_zone=fairy.game.adventure.zone
	shoulder=Node3D.new(); fairy.game.add_child(shoulder); shoulder.name="FriendlyShoulder"
	seed=A.cyl(shoulder,Vector3.ZERO,.018,.035,"7bdcff","disc",.6)
	borrowed=OmniLight3D.new(); shoulder.add_child(borrowed); borrowed.light_color=Color("88cdff"); borrowed.omni_range=4.5; borrowed.light_energy=0; borrowed.shadow_enabled=false
	update_shoulder()
func update_shoulder():
	var camera=fairy.game.camera
	var yaw=Basis(Vector3.UP,camera.global_rotation.y)
	if fairy.game.player_avatar!=null:
		shoulder.global_position=fairy.game.player_avatar.shoulder_position()
	else:
		shoulder.global_position=camera.global_position+yaw*Vector3(.28,-.27,.08)
	shoulder.global_basis=Basis.IDENTITY # Head turns never roll the passenger.
func stop():
	charge=0; light_until=0; borrowed.light_energy=0; shoulder.hide()
func tick(dt):
	update_shoulder(); shoulder.visible=fairy.active
	if last_zone!=fairy.game.adventure.zone: stop(); last_zone=fairy.game.adventure.zone
	if not fairy.active: return
	var friendly=fairy.perch==shoulder or fairy.perch==fairy.practice_hand
	for hand in fairy.game.hands:
		if hand.get_is_active() and fairy.perched_on(hand): friendly=true
	if friendly and fairy.health>0 and is_instance_valid(fairy.perch):
		charge=minf(2,charge+dt)
		if charge>=2:
			if light_until<fairy.game.elapsed: fairy.note("A little light to keep! Your friend glows for 20 seconds after you leave.")
			light_until=fairy.game.elapsed+20
	else: charge=0
	var amount=clampf((light_until-fairy.game.elapsed)/2,0,1)
	borrowed.light_energy=amount*.65; seed.visible=amount>0 or fairy.avatar.global_position.distance_to(shoulder.global_position)<1.5
	seed.scale=Vector3(.036,.035,.036)*(1+.12*sin(fairy.game.elapsed*3))
	if amount>0 and fairy.game.elapsed>last_spark:
		last_spark=fairy.game.elapsed+.14; fairy.art.sprinkle(shoulder.global_position,Vector3.UP*.07,Color("a5e8ff"),.8)
func perch_on_shoulder():
	update_shoulder()
	if fairy.health<=0 or fairy.recall: return
	if fairy.perch==shoulder: fairy.detach(Vector3.UP*.5); return
	if fairy.avatar.global_position.distance_to(shoulder.global_position)>.8: fairy.note("Fly beside your friend's shoulder, then F / A to perch (or H / D-pad down + A)."); return
	if not fairy._clear(fairy.avatar.global_position,shoulder.global_position): fairy.note("Come around to the open shoulder."); return
	fairy.attach(shoulder)
func duet()->bool:
	if not is_instance_valid(fairy.perch) or charge<1.5 or fairy.game.elapsed<pulse_ready: return false
	pulse_ready=fairy.game.elapsed+10
	fairy.health=minf(18,fairy.health+4)
	if not fairy.game.adventure.dying: fairy.game.adventure.hp=minf(100,fairy.game.adventure.hp+6)
	fairy.art.burst(fairy.avatar.global_position,Color("a2fff0"))
	if fairy.game.fairy_trails!=null: fairy.game.fairy_trails.ripple(fairy.avatar.global_position,Color("a2fff0"))
	for hand in fairy.game.hands:
		if hand.get_is_active(): fairy.game.adventure.haptic(hand,"ready")
	fairy.note("Duet! A little healing for both of you. Ready again in ten seconds.")
	return true
