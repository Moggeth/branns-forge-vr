extends Node
## One tactile Hearthlight, shared by its stands. Real light, no inventory duplication.
const HOME=Vector3(6.2,1.05,1.35)
const LIGHT_RANGE=8.0
var game
var torch:Node3D
var light:OmniLight3D
var flame:Node3D
var striker:Node3D
var holder:Node3D
var body:RigidBody3D
var stands:Array[Node3D]=[]
var resting:Node3D
var lit=true
var shadows_enabled=true
var clock=0.0
var strike_time=0.0
var previous=Vector3.ZERO
var velocity=Vector3.ZERO
var embers:Array[MeshInstance3D]=[]
var dwell={}
var ignition_clock=0.0
var crackle:AudioStreamPlayer3D
var click:AudioStreamPlayer3D
var dropped_zone="forge_yard"
var pickup_shape:CollisionShape3D

func setup(g):
	game=g
	torch=Node3D.new(); torch.name="Hearthlight"; game.add_child(torch)
	torch.set_meta("kind","hearth_torch"); torch.set_meta("title","Hearthlight"); torch.set_meta("display_name","Hearthlight")
	_build_torch()
	create_stand(game.adventure.zone_groups.forge_yard,HOME)
	home()
	print("HEARTHLIGHT ready range=8m shadow_lights=1 flicker_max=5percent loose_layer=8")

func create_stand(parent:Node3D,local_position:Vector3)->Node3D:
	var stand=Node3D.new(); parent.add_child(stand); stand.position=local_position
	stand.set_meta("kind","hearth_torch_stand")
	WorldZones.cyl(stand,Vector3(0,-.15,0),.23,.09,"574437")
	WorldZones.body(stand,Vector3(0,-.15,0),Vector3(.46,.09,.46))
	WorldZones.cyl(stand,Vector3(0,-.21,0),.27,.045,"283835")
	WorldZones.box(stand,Vector3(0,-.64,0),Vector3(.14,.83,.14),"694a30")
	WorldZones.cyl(stand,Vector3(0,-1,0),.31,.08,"283835")
	var area=Area3D.new(); stand.add_child(area); area.collision_layer=1; area.collision_mask=0
	var col=CollisionShape3D.new(); area.add_child(col); var shape=BoxShape3D.new(); shape.size=Vector3(.5,.75,.5); col.shape=shape
	WorldZones.box(stand,Vector3(0,.66,-.04),Vector3(.62,.25,.035),"283835")
	WorldZones.label(stand,"HEARTHLIGHT",Vector3(0,.72,-.015),21).pixel_size=.0022
	WorldZones.label(stand,"Grip to carry · Trigger: light / snuff\nTouch flame to fuel",Vector3(0,.62,-.015),12).pixel_size=.0016
	stands.append(stand)
	return stand

func _metal(n:MeshInstance3D):
	var mat=n.material_override.duplicate(); mat.metallic=.72; mat.roughness=.34; n.material_override=mat

func _build_torch():
	WorldZones.cyl(torch,Vector3(0,-.015,0),.031,.42,"69442d","taper")
	WorldZones.cyl(torch,Vector3(0,-.08,0),.033,.19,"302c29")
	for i in range(8):
		var band=WorldZones.cyl(torch,Vector3(0,-.165+i*.024,0),.035,.008,"90633e")
		band.rotation.z=.08
	for y in [-.23,.05,.17]: _metal(WorldZones.cyl(torch,Vector3(0,y,0),.043,.024,"ba8149"))
	_metal(WorldZones.cyl(torch,Vector3(0,.2,0),.08,.075,"876548","taper"))
	WorldZones.cyl(torch,Vector3(0,.245,0),.044,.035,"382b21")
	for i in range(6):
		var a=TAU*i/6
		var rail=WorldZones.box(torch,Vector3(cos(a)*.067,.286,sin(a)*.067),Vector3(.013,.16,.015),"c89159")
		rail.rotation.y=-a; _metal(rail)
	for y in [.22,.35]:
		var ring=MeshInstance3D.new(); torch.add_child(ring); var mesh=TorusMesh.new(); mesh.inner_radius=.061; mesh.outer_radius=.079; mesh.rings=16; mesh.ring_segments=6; ring.mesh=mesh; ring.position.y=y; ring.material_override=WorldZones.mat("b6814e"); _metal(ring)
	# A small leaf crest, hammered into the pommel.
	for side in [-1,1]:
		var leaf=WorldZones.rock(torch,Vector3(side*.016,-.205,.029),Vector3(.018,.037,.008),"e3b773"); leaf.rotation.z=side*.5; _metal(leaf)
	striker=Node3D.new(); torch.add_child(striker); striker.position=Vector3(.055,.16,0)
	_metal(WorldZones.cyl(striker,Vector3.ZERO,.023,.017,"9eaaad"))
	WorldZones.box(striker,Vector3(0,.025,0),Vector3(.012,.06,.018),"594839")
	flame=Node3D.new(); torch.add_child(flame); flame.position.y=.265
	for row in [[.033,.16,"ff863c",.075],[.022,.11,"ffce70",.05],[.012,.065,"fff1c4",.03]]:
		var f=WorldZones.cyl(flame,Vector3(0,row[3],0),row[0],row[1],row[2],"cone",1.7)
		f.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	for i in range(8):
		var ember=WorldZones.cyl(flame,Vector3.ZERO,.003,.01,"ffbc62","cone",1.2); ember.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; ember.set_meta("authored_scale",ember.scale); embers.append(ember)
	light=OmniLight3D.new(); torch.add_child(light); light.position.y=.4; light.light_color=Color("ffc28a"); light.light_energy=2.7; light.omni_range=LIGHT_RANGE; light.omni_attenuation=1.25
	light.shadow_enabled=true; light.shadow_bias=.035; light.shadow_normal_bias=.45; light.distance_fade_enabled=true; light.distance_fade_begin=16; light.distance_fade_length=6; light.distance_fade_shadow=14
	# The cage should not shadow its own light into a flickering lattice.
	for child in torch.get_children():
		if child is MeshInstance3D: child.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var area=Area3D.new(); torch.add_child(area); area.collision_layer=1; area.collision_mask=0
	var col=CollisionShape3D.new(); area.add_child(col); var shape=CapsuleShape3D.new(); shape.radius=.075; shape.height=.61; col.shape=shape; col.position.y=.065
	pickup_shape=col
	crackle=AudioStreamPlayer3D.new(); torch.add_child(crackle); crackle.position.y=.3; crackle.max_distance=9; crackle.unit_size=1.5; crackle.volume_db=-20; crackle.stream=_sound(true)
	click=AudioStreamPlayer3D.new(); torch.add_child(click); click.max_distance=8; click.volume_db=-16; click.stream=_sound(false)

func _sound(looped:bool)->AudioStreamWAV:
	var rate=16000; var count=rate*3 if looped else int(rate*.22)
	var data=PackedByteArray(); data.resize(count*2)
	var rng=RandomNumberGenerator.new(); rng.seed=91387 if looped else 412
	var smooth=0.0; var pop=0.0
	for i in range(count):
		var t=float(i)/rate; var noise=rng.randf_range(-1,1); smooth=lerpf(smooth,noise,.045)
		if looped and rng.randf()<.0007: pop=rng.randf_range(.12,.35)
		pop*=.963
		var sample=smooth*.7+noise*pop if looped else noise*.2*exp(-t*35)+sin(t*TAU*1600)*.065*exp(-t*50)
		var edge=minf(1,minf(float(i),float(count-1-i))/200)
		data.encode_s16(i*2,int(clampf(sample*edge,-1,1)*23000))
	var wav=AudioStreamWAV.new(); wav.format=AudioStreamWAV.FORMAT_16_BITS; wav.mix_rate=rate; wav.data=data
	if looped: wav.loop_mode=AudioStreamWAV.LOOP_FORWARD; wav.loop_begin=0; wav.loop_end=count
	return wav

func busy(hand)->bool: return is_instance_valid(holder) and holder==hand
func tip_position()->Vector3: return torch.to_global(Vector3(0,.38,0))
func _belongs(node:Node,ancestor:Node)->bool:
	return is_instance_valid(node) and (node==ancestor or ancestor.is_ancestor_of(node))

func try_grab(hand,desktop=false)->bool:
	if is_instance_valid(holder) or is_instance_valid(game.held.get(str(hand.get_instance_id()))): return false
	var target=false; var hit={}
	if desktop: hit=game._ray(game.camera,3)
	if torch.is_visible_in_tree():
		target=hand.global_position.distance_to(torch.global_position)<.2
		if hit.has("collider"): target=target or _belongs(hit.collider,torch)
	if not target:
		for station in stands:
			if not is_instance_valid(station) or not station.is_visible_in_tree(): continue
			if hand.global_position.distance_to(station.global_position)<.24 or (hit.has("collider") and _belongs(hit.collider,station)):
				resting=station; target=true; break
	if not target: return false
	_clear_body()
	torch.reparent(game.hand_socket(hand)); torch.transform=Transform3D.IDENTITY
	if hand is XRController3D:
		var side=1.0 if str(hand.tracker).begins_with("left") else -1.0
		torch.basis=Basis(Vector3.FORWARD,Vector3.RIGHT*side,Vector3.DOWN*side)
		torch.position=Vector3(0,-.025,-.04)
	else: torch.position=Vector3(.3,-.22,-.6)
	holder=hand; game.held[str(hand.get_instance_id())]=torch
	pickup_shape.set_deferred("disabled",true)
	previous=torch.global_position; velocity=Vector3.ZERO; torch.set_meta("zone",game.adventure.zone)
	game.adventure.haptic(hand,"ready"); game._notice("Hearthlight · Trigger to kindle / snuff. Touch the flame to fuel or a wick.",5)
	return true

func trigger(hand)->bool:
	if not busy(hand): return false
	set_lit(not lit); strike_time=.22; game.adventure.haptic(hand,"ready")
	game._notice("Hearthlight kindled." if lit else "Hearthlight snuffed. Trigger to relight.",2)
	if not bool(game.get("smoke")): click.play()
	return true

func set_lit(value:bool):
	lit=value; flame.visible=lit; light.visible=lit and torch.is_visible_in_tree()
	if not lit: crackle.stop(); dwell.clear()

func set_shadows(enabled:bool):
	shadows_enabled=enabled; light.shadow_enabled=enabled

func release(hand)->bool:
	if not busy(hand): return false
	game.held.erase(str(hand.get_instance_id())); holder=null
	pickup_shape.set_deferred("disabled",false)
	dropped_zone=game.adventure.zone
	body=RigidBody3D.new(); game.adventure.zone_groups[dropped_zone].add_child(body); body.global_transform=torch.global_transform
	torch.reparent(body); body.mass=.55; body.collision_layer=8; body.collision_mask=9; body.continuous_cd=true
	var col=CollisionShape3D.new(); body.add_child(col); var shape=CapsuleShape3D.new(); shape.radius=.07; shape.height=.6; col.shape=shape; col.position.y=.06
	var desktop=hand==game.desktop_hand
	body.linear_velocity=(game.tuning.release_velocity(hand,true).limit_length(10) if str(game.get("desktop_release_mode"))=="throw" else Vector3.ZERO) if desktop else velocity.limit_length(10)
	body.angular_velocity=Vector3.ZERO if desktop and str(game.get("desktop_release_mode"))!="throw" else Vector3(.2,0,.4)
	torch.set_meta("body",body)
	return true

func _clear_body():
	if is_instance_valid(body): torch.reparent(game); body.queue_free(); body=null
	if torch.has_meta("body"): torch.remove_meta("body")

func home():
	for key in game.held.keys():
		if game.held[key]==torch: game.held.erase(key)
	holder=null; _clear_body()
	pickup_shape.set_deferred("disabled",false)
	for station in stands:
		if station.is_visible_in_tree(): resting=station; break
	if not is_instance_valid(resting): resting=stands[0]
	torch.reparent(resting); torch.transform=Transform3D.IDENTITY; torch.position.y=.09
	previous=torch.global_position; velocity=Vector3.ZERO; dwell.clear()

func tick(delta:float):
	if delta<=0: return
	clock+=delta
	if is_instance_valid(body):
		body.freeze=not torch.is_visible_in_tree()
		if body.global_position.y< -12 or body.global_position.distance_to(game.camera.global_position)>100: home()
	if is_instance_valid(holder):
		if not busy(holder) or game.held.get(str(holder.get_instance_id()))!=torch: home()
	velocity=velocity.lerp((torch.global_position-previous)/maxf(delta,.001),.65); previous=torch.global_position
	var active=lit and torch.is_visible_in_tree()
	light.visible=active; flame.visible=lit
	light.shadow_enabled=shadows_enabled and active and game.camera.global_position.distance_to(torch.global_position)<16
	if not active:
		crackle.stop(); dwell.clear(); return
	if not bool(game.get("smoke")) and not crackle.playing: crackle.play()
	# Incommensurate slow waves; ±5% light variation, never a flash or strobe.
	light.light_energy=2.7*(1+.032*sin(clock*2.1)+.018*sin(clock*3.7+.8))
	flame.scale=Vector3(1+.025*sin(clock*3),1+.07*sin(clock*4.4),1)
	for i in range(embers.size()):
		var age=fmod(clock*.55+i*.127,1.0); var a=i*2.4+age*.8
		embers[i].position=Vector3(cos(a)*.055*age,.12+age*.38,sin(a)*.055*age)
		embers[i].scale=Vector3(embers[i].get_meta("authored_scale"))*(1-age)
	strike_time=maxf(0,strike_time-delta); striker.rotation.z=-.7*sin(strike_time/.22*PI)
	ignition_clock+=delta
	if ignition_clock>=.1:
		ignition_clock=0
		if game.get("heat_contacts")!=null: game.heat_contacts.touch(tip_position(),.35,260,game.adventure.zone,"torch",torch,.1)
		elif game.firecraft!=null and game.firecraft.fluid!=null and game.firecraft.fluid.has_method("ignite_near"): game.firecraft.fluid.ignite_near(tip_position(),.35)
	if game.firecraft!=null:
		var contacts={}
		for prop in game.firecraft.props:
			if not is_instance_valid(prop) or not prop.is_visible_in_tree() or prop.get_meta("state","")!="fresh" or prop.get_meta("fire_kind","")=="box": continue
			var id=prop.get_instance_id()
			if game.firecraft._tip(prop).distance_to(tip_position())<.09 and velocity.length()<.8 and Vector3(prop.get_meta("velocity",Vector3.ZERO)).length()<.8:
				contacts[id]=float(dwell.get(id,0))+delta
				if contacts[id]>=.3: game.firecraft._light(prop)
		dwell=contacts

func status()->Dictionary:
	return {"lit":lit,"held":is_instance_valid(holder),"dropped":is_instance_valid(body),"range":light.omni_range,"light_visible":light.visible,"shadow":light.shadow_enabled,"energy":light.light_energy,"stands":stands.size()}
