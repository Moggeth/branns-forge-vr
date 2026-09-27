extends Node
## Copper Kite: bounded spring tractor for explicitly registered toy cargo only.
const HOME=Vector3(136,1.15,69)
const RANGE=4.5
const MAX_MASS=2.0
const MAX_ACCEL=22.0
const MAX_SPEED=6.0
var game
var stand:Node3D
var wand:Node3D
var orb:MeshInstance3D
var tether:MeshInstance3D
var label:Label3D
var holder:Node3D
var target:RigidBody3D
var registered={}
var last_camera_position=Vector3.ZERO
var clock=0.0
var charge=0.0
var hold_seconds=0.0
var pulse_at=0.0
var token=""
var secondary_down=false

func setup(owner_game):
	game=owner_game; token="copper_kite_"+str(get_instance_id())
	last_camera_position=game.camera.global_position
	stand=Node3D.new(); stand.name="CopperKiteStand"; game.add_child(stand); stand.position=HOME-Vector3.UP*1.15
	WorldZones.cyl(stand,Vector3(0,.5,0),.28,1.0,"536965")
	WorldZones.cyl(stand,Vector3(0,1.04,0),.43,.12,"b58652")
	var body=WorldZones.body(stand,Vector3(0,.52,0),Vector3(.58,1.04,.58),"magnetic_wand_stand")
	body.set_meta("magnetic_wand_stand",true)
	label=WorldZones.label(stand,"COPPER KITE\nGrip / E: take or put away\nTrigger / click: pull, then drop\nA / X: toss · marked blocks only",Vector3(0,1.85,0),20,"b5f6f2")
	label.billboard=BaseMaterial3D.BILLBOARD_ENABLED; label.pixel_size=.0035
	wand=Node3D.new(); wand.name="CopperKiteWand"; game.add_child(wand)
	var shaft=WorldZones.cyl(wand,Vector3(0,0,-.16),.035,.37,"674d35"); shaft.rotation.x=PI/2
	for z in [-.07,-.14,-.21]:
		var band=WorldZones.cyl(wand,Vector3(0,0,z),.041,.032,"b68243"); band.rotation.x=PI/2
	for side in [-1,1]:
		WorldZones.line(wand,Vector3(0,0,-.29),Vector3(side*.13,0,-.41),.035,"c38e52")
		WorldZones.line(wand,Vector3(side*.13,0,-.41),Vector3(side*.12,0,-.51),.035,"c38e52")
	orb=WorldZones.rock(wand,Vector3(0,0,-.43),Vector3.ONE*.105,"78d5cf")
	orb.material_override=WorldZones.mat("78d5cf",.4)
	tether=WorldZones.box(game,Vector3.ZERO,Vector3(.017,.017,1),"a2fff0",.8); tether.visible=false
	_home()
	if game.get("playful_feedback")!=null:
		label.hide()
		game.playful_feedback.register_hint("copper_kite",stand,"COPPER KITE","E equips · click pulls / drops · X tosses","Grip equips · trigger pulls / drops · A tosses",Vector3(0,2.4,0))
	print("MAGNETIC_WAND ready range=",_tuned("playful.magnet_range",RANGE,1.5,RANGE)," max_mass=",MAX_MASS)

func _tuned(key:String,fallback:float,minimum:float,maximum:float)->float:
	if game==null or game.get("tuning")==null:return fallback
	var result=float(game.tuning.value(key))
	return clampf(result,minimum,maximum) if is_finite(result) else fallback

func _key(hand)->String:return str(hand.get_instance_id())
func busy(hand)->bool:return is_instance_valid(holder) and holder==hand
func claims_trigger(hand)->bool:return busy(hand)

func _free_hand(hand)->bool:
	if not is_instance_valid(hand) or game.held.has(_key(hand)):return false
	for property in ["living","firecraft","siegebird","workshop","enchantments","playful_tools","cargo_playground","echo_bells"]:
		var system=game.get(property)
		if system!=null and system.has_method("busy") and system.busy(hand):return false
	return not game.adventure.formation.has(_key(hand))

func _forbidden(body)->bool:
	if not body is RigidBody3D or not is_instance_valid(body):return true
	if body.mass>MAX_MASS or body.mass<=0 or body.freeze:return true
	if body.get_meta("kind","") in ["bomb","player","enemy","rat"]:return true
	for field in ["fuse_at","detonating","living_id","living_package","source_actor","assembly_owner"]:
		if body.has_meta(field):return true
	for field in ["held_by","physics_owner","gripped_by"]:
		if body.has_meta(field) and str(body.get_meta(field)) not in ["","0"]:return true
	if body in game.held.values():return true
	var grips=game.get("grips")
	if grips!=null and grips.has_method("is_stowed") and grips.is_stowed(body):return true
	return false

func register_body(body,owner_root)->bool:
	if _forbidden(body) or not is_instance_valid(owner_root) or body.get_parent()!=owner_root:return false
	if body.has_meta("magnetic_owner") and body.get_meta("magnetic_owner")!=token:return false
	registered[body.get_instance_id()]={"body":body,"owner":owner_root}
	body.set_meta("magnetic_owner",token); body.add_to_group("copper_kite_cargo")
	return true

func revoke_body(body):
	if not is_instance_valid(body):return
	release_target(body)
	registered.erase(body.get_instance_id())
	if body.get_meta("magnetic_owner","")==token:body.remove_meta("magnetic_owner"); body.remove_from_group("copper_kite_cargo")

func can_move(body)->bool:
	if not is_instance_valid(body) or _forbidden(body):return false
	var entry=registered.get(body.get_instance_id(),{})
	return not entry.is_empty() and is_instance_valid(entry.owner) and body.get_parent()==entry.owner and body.get_meta("magnetic_owner","")==token and body.is_in_group("copper_kite_cargo")

func try_grab(hand,desktop=false)->bool:
	if busy(hand):return true
	if is_instance_valid(holder) or not _free_hand(hand):return false
	var nearby=hand.global_position.distance_to(HOME)<(1.8 if desktop else .48)
	if desktop:
		var hit=game._ray(game.camera,3)
		if hit.has("collider") and hit.collider.get_meta("magnetic_wand_stand",false):nearby=true
	if not nearby:return false
	holder=hand; wand.visible=true; _pose(); game.adventure.haptic(hand,"ready")
	game._notice("Copper Kite: aim at a marked block. Trigger / click pulls or drops; A / X tosses. Release grip / E puts away.",7)
	return true

func release(hand)->bool:
	if not busy(hand):return false
	release_target(); _home(); game.adventure.haptic(hand,"release"); return true

func release_target(body=null,gentle=true)->bool:
	if not is_instance_valid(target):target=null;return false
	if body!=null and target!=body:return false
	if gentle and can_move(target):target.linear_velocity=target.linear_velocity.limit_length(2)
	target=null; hold_seconds=0; pulse_at=0; charge=0; tether.visible=false
	return true

func _source()->Node3D:return game.camera if holder==game.desktop_hand else game.aim_source(holder)
func _muzzle()->Vector3:return wand.to_global(Vector3(0,0,-.43))
func _hold_point()->Vector3:return _muzzle()-_source().global_basis.z*.75

func _pose():
	if not is_instance_valid(holder):return
	var source=_source(); wand.global_basis=source.global_basis
	wand.global_position=source.global_position+source.global_basis*Vector3(.1,-.12,-.18)

func _clear_path(body)->bool:
	var query=PhysicsRayQueryParameters3D.create(_muzzle(),body.global_position,1)
	query.exclude=[body.get_rid()]
	return game.get_world_3d().direct_space_state.intersect_ray(query).is_empty()

func _find_target():
	var origin=_muzzle(); var forward=-_source().global_basis.z
	var best=null; var score=INF
	for entry in registered.values():
		var body=entry.body
		if not can_move(body):continue
		var offset:Vector3=body.global_position-origin; var distance=offset.length()
		if distance<.1 or distance>_tuned("playful.magnet_range",RANGE,1.5,RANGE):continue
		var alignment=forward.dot(offset.normalized())
		if alignment<.88 or not _clear_path(body):continue
		var candidate=distance+(1-alignment)*12
		if candidate<score:score=candidate;best=body
	return best

func trigger(hand)->bool:
	if not busy(hand):return false
	_pose()
	if is_instance_valid(target):
		if can_move(target):
			target.sleeping=false
			target.linear_velocity=target.linear_velocity.limit_length(.2)
			target.angular_velocity=target.angular_velocity.limit_length(.3)
			game.adventure.haptic(hand,"release")
			print("MAGNETIC_WAND drop cargo=",target.name)
		release_target(null,false)
		return true
	target=_find_target(); hold_seconds=0; pulse_at=0
	if is_instance_valid(target):
		target.sleeping=false; game.adventure.haptic(hand,"ready"); _pulse(target.global_position,"recall")
		print("MAGNETIC_WAND capture cargo=",target.name," mass=",target.mass)
		game._notice("Guide the block into its nest. Trigger / click drops gently; A / X tosses.",4)
	else:game._notice("Aim at a marked cargo block within %.1fm and clear of walls."%_tuned("playful.magnet_range",RANGE,1.5,RANGE),3)
	return true

func secondary(hand)->bool:
	if not busy(hand):return false
	if not is_instance_valid(target):game._notice("Pull a marked block first; A / X will toss it.",3);return true
	if can_move(target):
		_pose();target.sleeping=false
		target.linear_velocity=(-_source().global_basis.z*_tuned("playful.magnet_fling",4.2,1,5.8)+Vector3.UP*.8).limit_length(MAX_SPEED)
		_pulse(target.global_position,"throw");game.adventure.haptic(hand,"release")
		print("MAGNETIC_WAND toss cargo=",target.name)
	release_target(null,false)
	return true

static func spring_acceleration(offset:Vector3,body_velocity:Vector3,acceleration_limit:float=MAX_ACCEL)->Vector3:
	acceleration_limit=clampf(acceleration_limit,10,MAX_ACCEL) if is_finite(acceleration_limit) else MAX_ACCEL
	return (offset*30-body_velocity*10+Vector3.UP*9.8).limit_length(acceleration_limit)

func _physics_process(delta):
	if game==null or not is_instance_valid(target):return
	if not is_instance_valid(holder) or not _free_hand(holder) or not can_move(target):release_target();return
	_pose()
	var reach=_tuned("playful.magnet_range",RANGE,1.5,RANGE)
	if target.global_position.distance_to(_muzzle())>reach+.5 or not _clear_path(target):release_target();return
	hold_seconds+=delta
	var offset=_hold_point()-target.global_position
	var acceleration=spring_acceleration(offset,target.linear_velocity,_tuned("playful.magnet_pull",MAX_ACCEL,10,MAX_ACCEL))
	target.apply_central_force(acceleration*target.mass)
	if target.linear_velocity.length()>MAX_SPEED:target.linear_velocity=target.linear_velocity.limit_length(MAX_SPEED)
	target.angular_velocity=target.angular_velocity.limit_length(4)
	charge=1-clampf(offset.length()/reach,0,1)
	if offset.length()<.25 and hold_seconds>pulse_at:
		pulse_at=hold_seconds+.7; game.adventure.haptic(holder,"ready")

func tick(delta):
	clock+=maxf(delta,0)
	var jumped=last_camera_position.distance_to(game.camera.global_position)>15
	last_camera_position=game.camera.global_position
	if jumped:release_target()
	if is_instance_valid(holder):
		if not _free_hand(holder):_home()
		else:
			_pose()
			var pressed=holder is XRController3D and holder.is_button_pressed("ax_button")
			if pressed and not secondary_down:secondary(holder)
			secondary_down=pressed
	else:
		if is_instance_valid(target):release_target()
		wand.visible=stand.is_visible_in_tree(); wand.global_position=HOME; wand.rotation=Vector3(-.7,sin(clock)*.1,0)
	stand.visible=game.camera.global_position.distance_to(HOME)<35
	orb.scale=Vector3.ONE*(1+sin(clock*7)*.06+charge*.4)
	tether.visible=is_instance_valid(target) and is_instance_valid(holder)
	if tether.visible:
		var a=_muzzle(); var b=target.global_position
		tether.global_position=(a+b)*.5
		if a.distance_to(b)>.001:tether.look_at(b,Vector3.RIGHT if absf((b-a).normalized().y)>.98 else Vector3.UP)
		tether.scale=Vector3(.017,.017,maxf(.001,a.distance_to(b)))

func _home():
	release_target(); holder=null; secondary_down=false; wand.global_position=HOME; wand.rotation=Vector3(-.7,0,0)

func _pulse(position:Vector3,kind:String):
	if game.get("playful_feedback")!=null:game.playful_feedback.pulse(position,kind)
