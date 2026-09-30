extends Node
## Sunskipper: one physical returning ring; ownership never enters generic weapon code.
const FLIGHT=preload("res://chakram_flight.gd")
var bank=0.0
var desktop_bank=0.0
var scored_colliders:Array[RID]=[]
const HOME = Vector3(9.0,1.15,4.5)
const COURT_HOME = Vector3(117,1.15,68)
const SPEEDS = [5.0,9.0,14.0]
const MODES = ["SOFT TOSS","COURTYARD","LONG SHOT"]
var game
var stand: Node3D
var court_stand: Node3D
var ring: Node3D
var spinner: Node3D
var title: Label3D
var held_label: Label3D
var holder: Node3D
var caller: Node3D
var state = "home"
var mode = 1
var velocity = Vector3.ZERO
var flight_age = 0.0
var clock = 0.0
var charge_flash = 0.0
var bounce_count = 0
var last_zone = "forge_yard"
var reward = ""
var accent: StandardMaterial3D
var sound: AudioStreamPlayer3D
var sounds: Array[AudioStreamWAV] = []
var trail: Array[MeshInstance3D] = []
var trail_clock = 0.0
var last_camera_position = Vector3.ZERO
var target_receivers:Array[WeakRef]=[]
var throw_id=0
var launch_position=Vector3.ZERO
var last_bounce_ref:WeakRef
var last_bounce_at=-1.0

func setup(owner_game):
	game=owner_game
	last_camera_position=game.camera.global_position
	stand=Node3D.new(); stand.name="SunskipperStand"
	game.adventure.zone_groups.forge_yard.add_child(stand)
	stand.global_position=HOME-Vector3.UP*1.15
	WorldZones.cyl(stand,Vector3(0,.5,0),.28,1.0,"556864")
	WorldZones.cyl(stand,Vector3(0,1.04,0),.44,.12,"b28b50")
	WorldZones.cyl(stand,Vector3(0,.05,0),.45,.1,"334d48")
	var body=WorldZones.body(stand,Vector3(0,.53,0),Vector3(.58,1.06,.58),"playful_ring_stand")
	body.set_meta("playful_ring_stand",true)
	title=WorldZones.label(stand,"SUNSKIPPER",Vector3(0,1.8,0),30,"fff0a2")
	title.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	var controls=WorldZones.label(stand,"Grip / E: take or throw\nTrigger / click: toss power\nBank your wrist: curve\nEmpty-hand trigger: elastic recall",Vector3(0,1.51,0),17,"baf1e2")
	controls.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	court_stand=Node3D.new(); court_stand.name="SunskipperCourtStand"; game.add_child(court_stand)
	court_stand.global_position=COURT_HOME-Vector3.UP*1.15
	WorldZones.cyl(court_stand,Vector3(0,.5,0),.28,1.0,"556864")
	WorldZones.cyl(court_stand,Vector3(0,1.04,0),.44,.12,"b28b50")
	var court_body=WorldZones.body(court_stand,Vector3(0,.53,0),Vector3(.58,1.06,.58),"playful_ring_stand")
	court_body.set_meta("playful_ring_stand",true)
	var court_label=WorldZones.label(court_stand,"SUNSKIPPER\nGrip / E to retrieve",Vector3(0,1.65,0),25,"fff0a2")
	court_label.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	ring=Node3D.new(); ring.name="SunskipperReturningRing"; game.add_child(ring)
	ring.set_meta("kind","playful_ring")
	spinner=Node3D.new(); ring.add_child(spinner)
	accent=StandardMaterial3D.new(); accent.albedo_color=Color("81f5cf"); accent.emission_enabled=true; accent.emission=accent.albedo_color; accent.emission_energy_multiplier=.65
	var asset=load("res://assets/sunskipper-chakram.glb")
	if asset is PackedScene:
		spinner.add_child(asset.instantiate())
	else:
		push_error("Sunskipper model unavailable")
		var fallback=MeshInstance3D.new(); fallback.mesh=TorusMesh.new(); fallback.scale=Vector3.ONE*.3; spinner.add_child(fallback)
	# A small enamel glint also carries the earned Bellwright colour.
	var glint=WorldZones.rock(spinner,Vector3(.227,.020,0),Vector3(.014,.007,.014),"81f5cf"); glint.material_override=accent
	var token=TorusMesh.new(); token.inner_radius=.12; token.outer_radius=.17; token.rings=32; token.ring_segments=8
	var court_token=MeshInstance3D.new(); court_token.mesh=token; court_token.material_override=accent
	court_stand.add_child(court_token); court_token.position=Vector3(0,1.2,0)
	held_label=WorldZones.label(ring,MODES[mode],Vector3(0,.22,0),18,"fff0a2")
	held_label.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	sound=AudioStreamPlayer3D.new(); ring.add_child(sound); sound.max_distance=18; sound.volume_db=-15
	for pitch in [440.0,660.0,880.0]: sounds.append(_tone(pitch))
	for i in range(10):
		var spark=WorldZones.rock(game,Vector3.ZERO,Vector3.ONE*.045,"81f5cf")
		spark.material_override=accent; spark.visible=false; trail.append(spark)
	_home()
	var feedback=game.get("playful_feedback")
	if feedback!=null:
		feedback.register_hint("sunskipper",stand,"SUNSKIPPER","E: take / throw | Click: power / recall","Grip: take / throw | Trigger: power / recall",Vector3(0,2.15,0))
	print("PLAYFUL_TOOLS ready home=",HOME," mode=",MODES[mode])

func _tone(pitch:float)->AudioStreamWAV:
	var stream=AudioStreamWAV.new(); stream.format=AudioStreamWAV.FORMAT_16_BITS; stream.mix_rate=22050
	var data=PackedByteArray(); data.resize(6615*2)
	for i in range(6615):
		var t=float(i)/22050.0
		var sample=(sin(TAU*pitch*t)+.25*sin(TAU*pitch*2.01*t))*exp(-t*17)*minf(t*300,1)*10000
		data.encode_s16(i*2,int(sample))
	stream.data=data
	return stream

func _sound(index:int):
	sound.stream=sounds[clampi(index,0,2)]; sound.play()

func _key(hand)->String: return str(hand.get_instance_id())

func _live_receivers()->Array:
	var live=[]
	for i in range(target_receivers.size()-1,-1,-1):
		var receiver=target_receivers[i].get_ref()
		if not is_instance_valid(receiver) or receiver.is_queued_for_deletion():target_receivers.remove_at(i)
	for reference in target_receivers:live.append(reference.get_ref())
	return live

func register_target_receiver(receiver:Node)->bool:
	var live=_live_receivers()
	if not is_instance_valid(receiver) or receiver.is_queued_for_deletion() or not receiver.has_method("hit_target"):return false
	if receiver in live:return true
	if live.size()>=4:return false
	target_receivers.append(weakref(receiver));return true

func unregister_target_receiver(receiver:Node)->bool:
	var removed=false
	for i in range(target_receivers.size()-1,-1,-1):
		var node=target_receivers[i].get_ref()
		if not is_instance_valid(node) or node==receiver:
			removed=removed or node==receiver;target_receivers.remove_at(i)
	return removed

func _throw_context()->Dictionary:
	var collider=last_bounce_ref.get_ref() if last_bounce_ref!=null else null
	if not is_instance_valid(collider) or collider.is_queued_for_deletion():collider=null
	var context={"throwId":throw_id,"bounceCount":bounce_count,"launchPosition":launch_position if launch_position.is_finite() else Vector3.ZERO,"lastBounceCollider":collider,"lastBounceAt":last_bounce_at if is_finite(last_bounce_at) else -1.0,"flightAge":maxf(0,flight_age) if is_finite(flight_age) else 0.0}
	context.make_read_only()
	return context

func _announce_throw():
	var context=_throw_context()
	for receiver in _live_receivers():
		if is_instance_valid(receiver) and receiver in _live_receivers() and receiver.has_method("on_throw"):receiver.on_throw(context)

func _receiver_hit(collider,point:Vector3,incoming:Vector3)->bool:
	var context=_throw_context()
	for receiver in _live_receivers():
		if not is_instance_valid(receiver) or receiver not in _live_receivers():continue
		var consumed=receiver.hit_target(collider,point,incoming,context)
		if consumed is bool and consumed:return true
	return false

func _free_hand(hand)->bool:
	if not is_instance_valid(hand) or game.held.has(_key(hand)): return false
	for property in ["living","firecraft","siegebird","workshop","enchantments","magnetic_wand","cargo_playground","echo_bells"]:
		var system=game.get(property)
		if system!=null and system.has_method("busy") and system.busy(hand): return false
	return not game.adventure.formation.has(_key(hand))

func busy(hand)->bool: return is_instance_valid(holder) and holder==hand

func claims_trigger(hand)->bool:
	return busy(hand) or (state in ["flying","returning"] and caller==hand and _free_hand(hand))

func _pulse(position:Vector3,kind:String):
	var feedback=game.get("playful_feedback")
	if feedback!=null: feedback.pulse(position,kind)

func retrieve(hand)->bool:
	if is_instance_valid(holder): return holder==hand
	if not _free_hand(hand): return false
	_attach(hand)
	return true

func try_grab(hand,desktop=false)->bool:
	if busy(hand): return true
	if is_instance_valid(holder) or not _free_hand(hand): return false
	var reach=1.8 if desktop else .48
	var close=hand.global_position.distance_to(ring.global_position)<reach
	var at_stand=stand.is_visible_in_tree() and hand.global_position.distance_to(HOME)<reach
	at_stand=at_stand or (court_stand.is_visible_in_tree() and hand.global_position.distance_to(COURT_HOME)<reach)
	if desktop:
		var hit=game._ray(game.camera,3.0)
		if hit.has("collider") and hit.collider.get_meta("playful_ring_stand",false): at_stand=true
	if not close and not at_stand: return false
	return retrieve(hand)

func _attach(hand):
	holder=hand; caller=hand; state="held"; velocity=Vector3.ZERO; flight_age=0; bank=0
	ring.reparent(game.hand_socket(hand)); ring.transform=Transform3D.IDENTITY
	ring.position=Vector3(.09,-.02,-.22); ring.rotation=Vector3(.2,0,0)
	ring.visible=true; held_label.visible=true
	_clear_trail(); _sound(1)
	_pulse(ring.global_position,"catch")
	game.adventure.haptic(hand,"ready")
	game._notice("Sunskipper: bank your wrist to curve. Trigger changes power; release throws in VR. Desktop E drops, X throws, Q / R bank.",7)

func trigger(hand)->bool:
	if busy(hand):
		mode=(mode+1)%SPEEDS.size(); charge_flash=.4
		held_label.text=MODES[mode]; _sound(mode)
		game.adventure.haptic(hand,"ready")
		game._notice("Sunskipper · "+MODES[mode]+". Release grip in VR; desktop X throws, E drops.",3)
		return true
	if state in ["flying","returning"] and caller==hand and _free_hand(hand):
		state="returning"; _pulse(ring.global_position,"recall"); game.adventure.haptic(hand,"release"); return true
	return false

func release(hand)->bool:
	if not busy(hand): return false
	var desktop_drop=hand==game.desktop_hand and str(game.get("desktop_release_mode"))!="throw"
	var source=game.camera if hand==game.desktop_hand else game.aim_source(hand)
	var tracked:Vector3=game.adventure.motion.get(_key(hand),{}).get("velocity",Vector3.ZERO)
	velocity=Vector3.ZERO if desktop_drop else launch_velocity(tracked,-source.global_basis.z,mode,hand==game.desktop_hand,_tuned("playful.ring_toss_gain",1,.5,1.5))
	bank=0.0 if desktop_drop else (deg_to_rad(desktop_bank) if hand==game.desktop_hand else FLIGHT.bank_angle(ring.global_basis.y,velocity))
	scored_colliders.clear()
	ring.reparent(game); holder=null; state="dropped" if desktop_drop else "flying"; flight_age=0; bounce_count=0
	if not desktop_drop: throw_id+=1
	launch_position=game.camera.global_position;last_bounce_ref=null;last_bounce_at=-1.0
	if not desktop_drop: ring.global_position+=velocity.normalized()*.12
	held_label.visible=false; _sound(0); game.adventure.haptic(hand,"release")
	if not desktop_drop:
		_pulse(ring.global_position,"throw")
		_announce_throw()
		print("PLAYFUL_TOOLS throw mode=",mode," speed=",snappedf(velocity.length(),.1))
	return true

static func launch_velocity(tracked:Vector3,forward:Vector3,power:int,desktop:bool,toss_gain:float=1.0)->Vector3:
	var speed:float=SPEEDS[clampi(power,0,2)]
	toss_gain=clampf(toss_gain,.5,1.5) if is_finite(toss_gain) else 1.0
	# A deliberate physical toss preserves direction, including underarm throws.
	if not desktop and tracked.length()>.65: return (tracked*(.75+speed*.09)*toss_gain).limit_length(21)
	return ((forward.normalized()*speed+Vector3.UP*.32)*toss_gain).limit_length(21)

func _tuned(key:String,fallback:float,minimum:float,maximum:float)->float:
	if game==null or game.get("tuning")==null: return fallback
	var result=float(game.tuning.value(key))
	return clampf(result,minimum,maximum) if is_finite(result) else fallback

func tick(delta):
	if not is_instance_valid(ring): return
	clock+=maxf(delta,0); charge_flash=maxf(0,charge_flash-delta)
	court_stand.visible=game.camera.global_position.distance_to(COURT_HOME)<30
	if last_camera_position.distance_to(game.camera.global_position)>15 and state in ["flying","returning"]: _home()
	last_camera_position=game.camera.global_position
	var zone=str(game.adventure.zone)
	if zone!=last_zone:
		last_zone=zone
		if state!="held": _home()
	if state=="held" and not is_instance_valid(holder): _home()
	if state=="held":
		# A gripped metal ring stays fixed in the palm; spin belongs to flight.
		if holder==game.get("desktop_hand"):
			var direction=(1.0 if Input.is_physical_key_pressed(KEY_R) else 0.0)-(1.0 if Input.is_physical_key_pressed(KEY_Q) else 0.0)
			desktop_bank=clampf(desktop_bank+direction*60*delta,-65,65)
			ring.rotation.z=-deg_to_rad(desktop_bank)
			held_label.text=MODES[mode]+" · bank %d°"%roundi(desktop_bank)
	elif state=="home":
		ring.global_position=HOME+Vector3.UP*(.1+sin(clock*2)*.025)
		ring.rotation=Vector3(.12,clock*.5,0)
		ring.visible=stand.is_visible_in_tree()
	else:
		var remaining=minf(maxf(delta,0),.25)
		while remaining>0.00001 and state in ["flying","returning","dropped"]:
			var step=minf(remaining,.02); remaining-=step; _flight_step(step)
		spinner.rotate_y(delta*22)
		trail_clock+=delta
		if trail_clock>.025:
			trail_clock=0
			for i in range(trail.size()-1,0,-1):
				trail[i].global_position=trail[i-1].global_position; trail[i].visible=trail[i-1].visible
			trail[0].global_position=ring.global_position; trail[0].visible=state in ["flying","returning"]

func _flight_step(delta):
	if state=="dropped":
		# The desktop drop falls in place and stays retrievable; it never enters
		# the scoring/recall flight path or receives camera-forward launch speed.
		velocity+=Vector3.DOWN*9.8*delta
		var start=ring.global_position
		var hit=game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(start,start+velocity*delta,1))
		if hit.is_empty(): ring.global_position=start+velocity*delta
		else:
			ring.global_position=hit.position+hit.normal*.08
			velocity=Vector3.ZERO
			state="resting"
		if ring.global_position.y< -12: _home()
		return
	flight_age+=delta
	if flight_age>12 or ring.global_position.y < -12: _home(); return
	var destination=Vector3.ZERO
	if state=="returning":
		if not is_instance_valid(caller) or not _free_hand(caller): _home(); return
		destination=game.hand_socket(caller).global_position
		if ring.global_position.distance_to(destination)<.35: _attach(caller); return
		velocity=FLIGHT.recall(velocity,destination-ring.global_position,delta,_tuned("playful.ring_recall_speed",18,4,18),_tuned("playful.ring_recall_accel",28,6,60))
		bank=move_toward(bank,0,delta*1.5)
	else:
		velocity=FLIGHT.glide(velocity,bank,delta,_tuned("playful.ring_gravity",1.1,0,3),_tuned("playful.ring_curve",4.2,0,9),_tuned("playful.ring_drag",.025,0,.2))
	var start=ring.global_position
	var finish=start+velocity*delta
	var query=PhysicsRayQueryParameters3D.create(start,finish,1)
	query.exclude=scored_colliders
	var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty():
		if state=="returning" and Geometry3D.get_closest_point_to_segment(destination,start,finish).distance_to(destination)<.35: _attach(caller); return
		ring.global_position=finish
	else:
		ring.global_position=hit.position+hit.normal*.08
		var encounter=game.get("playful_encounters")
		if _receiver_hit(hit.collider,hit.position,velocity) or (encounter!=null and encounter.hit_target(hit.collider,hit.position,velocity)):
			# Scoring targets become transparent to this one return, never duplicate hits.
			if hit.collider is CollisionObject3D: scored_colliders.append(hit.collider.get_rid())
			state="returning"; _sound(2)
		else:
			velocity=FLIGHT.ricochet(velocity,hit.normal,_tuned("playful.ring_bounce",.84,.4,1)); bounce_count+=1; _sound(0)
			last_bounce_ref=weakref(hit.collider); last_bounce_at=flight_age
			bank*=.65
			if is_instance_valid(caller): game.adventure.haptic(caller,"impact")
			_pulse(hit.position,"hit")
			if bounce_count>=6 or velocity.length()<1.2: state="returning"
	if velocity.length()>.15:
		var direction=velocity.normalized()
		var up=Vector3.UP.rotated(direction,bank)
		if absf(up.dot(direction))<.98: ring.global_basis=Basis.looking_at(direction,up)
	if flight_age>7: state="returning"

func _clear_trail():
	for spark in trail: spark.visible=false

func _home():
	holder=null; caller=null; state="home"; velocity=Vector3.ZERO; flight_age=0; bank=0; scored_colliders.clear()
	if ring.get_parent()!=game: ring.reparent(game)
	ring.global_position=HOME+Vector3.UP*.1; ring.rotation=Vector3.ZERO
	ring.visible=stand.is_visible_in_tree(); held_label.visible=false; _clear_trail()

func unlock_reward(id:String):
	if id.is_empty() or reward==id: return
	reward=id; accent.albedo_color=Color("ffb85d"); accent.emission=accent.albedo_color
	title.text="SUNSKIPPER · BELLWRIGHT"
	print("PLAYFUL_TOOLS reward=",id)
