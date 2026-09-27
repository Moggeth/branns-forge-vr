extends SceneTree
const Wand=preload("res://magnetic_wand.gd")
var failures=[]
var checks=0
class Adventure extends Node:
	var formation={}
	func haptic(_hand,_kind):pass
class Occupier extends Node:
	var occupied=null
	func busy(hand):return occupied==hand
class Grips extends Node:
	var stowed=null
	func is_stowed(body):return stowed==body
class Game extends Node3D:
	var held={}
	var adventure=Adventure.new()
	var playful_tools=Occupier.new()
	var living=null
	var firecraft=null
	var siegebird=null
	var workshop=null
	var enchantments=null
	var playful_feedback=null
	var grips=Grips.new()
	var desktop_hand=Node3D.new()
	var camera=Node3D.new()
	func initialize():
		for node in [adventure,playful_tools,grips,desktop_hand,camera]:add_child(node)
	func aim_source(hand):return hand
	func _notice(_text,_seconds=0):pass
	func _ray(_source,_distance):return {}
func _initialize():call_deferred("run")
func check(ok,message):
	checks+=1
	if not ok:failures.append(message)
func block(parent,position)->RigidBody3D:
	var node=RigidBody3D.new();parent.add_child(node);node.global_position=position
	node.mass=.6;node.collision_layer=8;node.collision_mask=9;node.continuous_cd=true
	var col=CollisionShape3D.new();var shape=BoxShape3D.new();shape.size=Vector3.ONE*.3;col.shape=shape;node.add_child(col)
	return node
func frames(count):
	for i in range(count):await physics_frame
func run():
	var started=Time.get_ticks_usec()
	var game=Game.new();root.add_child(game);game.initialize()
	game.desktop_hand.position=Wand.HOME;game.camera.position=Wand.HOME+Vector3.UP*.45
	var wand=Wand.new();game.add_child(wand);wand.setup(game)
	var hand=game.desktop_hand
	var cargo=Node3D.new();game.add_child(cargo)
	var body=block(cargo,Vector3(136,1.1,66.7))
	var floor_body=WorldZones.body(game,Vector3(136,-.15,66),Vector3(12,.3,14),"solid")
	check(not wand.can_move(body),"Unregistered rigid bodies are rejected")
	check(wand.register_body(body,cargo),"Cargo ownership registered explicitly")
	check(wand.can_move(body),"Registered lightweight loose block accepted")
	check(not wand.register_body(floor_body,game),"Static world never registered")
	body.mass=3;check(not wand.can_move(body),"Heavy cargo rejected");body.mass=.6
	body.freeze=true;check(not wand.can_move(body),"Frozen or externally held bodies rejected");body.freeze=false
	for field in ["fuse_at","source_actor","living_id","assembly_owner"]:
		body.set_meta(field,1);check(not wand.can_move(body),"Unsafe metadata rejected: "+field);body.remove_meta(field)
	for kind in ["bomb","enemy","player","rat"]:
		body.set_meta("kind",kind);check(not wand.can_move(body),"Live actor or bomb rejected: "+kind)
	body.set_meta("kind","cargo")
	body.set_meta("held_by","left");check(not wand.can_move(body),"Foreign held metadata rejected");body.remove_meta("held_by")
	game.held["foreign"]=body;check(not wand.can_move(body),"Generic held item rejected");game.held.clear()
	game.grips.stowed=body;check(not wand.can_move(body),"Holstered cargo rejected");game.grips.stowed=null
	body.reparent(game);check(not wand.can_move(body),"Foreign reparent revokes eligibility");body.reparent(cargo)
	game.playful_tools.occupied=hand;check(not wand.try_grab(hand,true),"Sunskipper hand cannot also take wand");game.playful_tools.occupied=null
	game.adventure.formation[str(hand.get_instance_id())]=true;check(not wand.try_grab(hand,true),"Forming bomb reserves hand");game.adventure.formation.clear()
	check(wand.try_grab(hand,true) and wand.busy(hand) and wand.claims_trigger(hand),"Wand grips and claims its trigger")
	var second=Node3D.new();game.add_child(second);second.position=Wand.HOME
	check(not wand.try_grab(second,true),"Second hand cannot duplicate wand")
	check(not wand.trigger(second),"Other hand trigger remains unclaimed")
	await frames(2)
	check(wand.trigger(hand) and wand.target==body,"Aim and trigger acquires registered cargo")
	var initial_distance=body.global_position.distance_to(wand._hold_point())
	await frames(45)
	var final_distance=body.global_position.distance_to(wand._hold_point())
	check(final_distance<initial_distance*.45,"Real physics spring pulls cargo toward hold point")
	check(not body.freeze and body.get_parent()==cargo,"Pull preserves rigid physics and owner parent")
	wand.tick(.02)
	check(wand.tether.visible and wand.tether.scale.x<.02,"Charged tether is thin and visible")
	check(Wand.spring_acceleration(Vector3(100,100,100),Vector3.ZERO).length()<=Wand.MAX_ACCEL+.001,"Tractor acceleration hard limited")
	check(wand.trigger(hand) and wand.target==null and body.linear_velocity.length()<=.201,"Next trigger gently drops for precise nest placement")
	check(wand.trigger(hand) and wand.target==body,"Dropped cargo can be pulled again")
	check(wand.secondary(hand) and wand.target==null and body.linear_velocity.z < -4,"Explicit secondary action launches charge")
	check(body.linear_velocity.length()<Wand.MAX_SPEED,"Launch speed bounded")
	body.global_position=Vector3(136,1.1,66.7);body.linear_velocity=Vector3.ZERO
	await frames(2);wand.trigger(hand)
	check(wand.target==body,"Body can be reacquired")
	var blocker=WorldZones.body(game,Vector3(136,1.6,67.8),Vector3(2,3,.1),"solid")
	await frames(3)
	check(wand.target==null,"Intervening world wall breaks tractor safely")
	wand.trigger(hand);check(wand.target==null,"Cannot acquire cargo through wall")
	blocker.free();await frames(2)
	body.global_position=Vector3(136,1.1,66.7);body.linear_velocity=Vector3.ZERO;wand.trigger(hand)
	body.mass=3;await frames(2)
	check(wand.target==null,"Mass changes invalidate active charge");body.mass=.6
	body.global_position=Vector3(136,1.1,66.7);body.linear_velocity=Vector3.ZERO;wand.trigger(hand)
	body.set_meta("held_by","foreign");await frames(2)
	check(wand.target==null,"Foreign claim drops charge without moving its parent");body.remove_meta("held_by")
	body.global_position=Vector3(136,1.1,66.7);body.linear_velocity=Vector3.ZERO;wand.trigger(hand)
	body.linear_velocity=Vector3(5,0,0)
	check(wand.release_target(body) and wand.target==null,"Cargo reset can release only its own charged body")
	check(body.linear_velocity.length()<=2.001,"Dropping cargo damps momentum without freezing it")
	wand.trigger(hand);game.camera.position+=Vector3(30,0,0);wand.tick(.02)
	check(wand.target==null and wand.busy(hand),"Travel drops cargo while retaining wand")
	check(wand.release(hand) and not wand.busy(hand),"Grip release puts away wand safely")
	check(wand.wand.global_position.distance_to(Wand.HOME)<.01,"Wand returns to retrieval stand")
	wand.revoke_body(body);check(not wand.can_move(body),"Explicit revocation removes whitelist")
	print("MAGNETIC_WAND_CHECK_RESULT ",JSON.stringify({"checks":checks,"failures":failures,"physics_initial_distance":initial_distance,"physics_final_distance":final_distance,"elapsed_seconds":float(Time.get_ticks_usec()-started)/1000000.0}))
	game.free();await process_frame;quit(0 if failures.is_empty() else 1)
