extends SceneTree
## Live tuning behavior in isolated native scene. No service/player saves.
const Ring=preload("res://playful_tools.gd")
const Wand=preload("res://magnetic_wand.gd")
const Tuner=preload("res://tuning_runtime.gd")
var failures=[]
class Adventure extends Node:
	var zone="forge_yard"
	var zone_groups={}
	var motion={}
	var formation={}
	func haptic(_hand,_kind):pass
class Game extends Node3D:
	var tuning
	var qol=null
	var held={}
	var adventure=Adventure.new()
	var playful_feedback=null
	var playful_encounters=null
	var desktop_hand=Node3D.new()
	var camera=Node3D.new()
	func initialize():
		for node in [adventure,desktop_hand,camera]:add_child(node)
		var zone=Node3D.new();add_child(zone);adventure.zone_groups.forge_yard=zone
	func hand_socket(hand):return hand
	func aim_source(hand):return hand
	func _notice(_text,_duration=0):pass
	func _ray(_source,_length):return {}
func _initialize():call_deferred("run")
func check(ok,message):
	if not ok:failures.append(message)
func run():
	var game=Game.new();root.add_child(game);game.initialize()
	var ring=Ring.new();game.add_child(ring);ring.setup(game)
	var wand=Wand.new();game.add_child(wand);wand.setup(game);wand.set_physics_process(false)
	check(ring._tuned("playful.ring_recall_speed",18,4,18)==18,"Missing tuning keeps original recall default")
	check(wand._tuned("playful.magnet_pull",22,10,22)==22,"Missing tuning keeps original pull default")
	var tuner=Tuner.new();game.add_child(tuner);game.tuning=tuner;tuner.setup(game)
	var schema=JSON.parse_string(FileAccess.get_file_as_string("res://tuning_schema.json"))
	for key in Tuner.DEFAULTS:check(Tuner.DEFAULTS[key]==schema[key].default,"Schema/default parity "+key)
	tuner.group_filter="playful"
	check(tuner._keys().size()==10,"Playful group contains ten bounded settings")
	for key in Tuner.QUICK_KEYS:check(not str(key).begins_with("playful."),"Quick menu stays focused")
	game.camera.position=Vector3(0,10,0);game.desktop_hand.position=game.camera.position
	ring.retrieve(game.desktop_hand);ring.release(game.desktop_hand)
	check(absf(ring.velocity.z+9)<.001,"Default toss speed preserved")
	var initial_y=ring.velocity.y;ring._flight_step(.1)
	check(absf(ring.velocity.y-(initial_y-.11))<.001,"Default ring gravity preserved")
	tuner.ingest({"revision":1,"values":{"playful.ring_toss_gain":.5,"playful.ring_gravity":3.0,"playful.ring_recall_speed":4.0,"playful.magnet_range":1.5,"playful.magnet_pull":10.0,"playful.magnet_fling":1.0},"schema":schema})
	initial_y=ring.velocity.y;ring._flight_step(.1)
	check(absf(ring.velocity.y-(initial_y-.3))<.001,"New gravity changes existing flight")
	ring.retrieve(game.desktop_hand);ring.release(game.desktop_hand)
	check(absf(ring.velocity.z+4.5)<.001,"Updated toss gain applies to next release")
	ring.state="returning";ring.ring.global_position=Vector3(0,10,-10);ring.velocity=Vector3.ZERO
	ring._flight_step(.1)
	check(ring.velocity.z>0 and ring.velocity.z<=4 and ring.ring.global_position.z< -9.5,"Updated recall speed caps active elastic return without a snap")
	tuner.ingest({"revision":2,"values":{"playful.ring_recall_speed":18.0},"schema":schema})
	ring._flight_step(.1)
	check(ring.velocity.z>4 and ring.velocity.z<6,"Second revision accelerates return without recreation")
	check(Ring.launch_velocity(Vector3.ONE*100,Vector3.FORWARD,2,false,100).length()<=21.001,"Tracked launch remains hard capped")
	check(Ring.launch_velocity(Vector3.ZERO,Vector3.FORWARD,2,true,100).length()<=21.001,"Desktop launch remains hard capped")
	check(Wand.spring_acceleration(Vector3(100,0,0),Vector3.ZERO,100).length()<=22.001,"Pull cap cannot exceed original hard maximum")
	check(absf(Wand.spring_acceleration(Vector3(100,0,0),Vector3.ZERO,10).length()-10)<.001,"Less pull reduces actual acceleration")
	check(Wand.spring_acceleration(Vector3.ZERO,Vector3.ZERO,10).y>9.79,"Minimum pull still supports gravity compensation")
	tuner.runtime_overrides["playful.magnet_range"]=100
	check(wand._tuned("playful.magnet_range",4.5,1.5,4.5)==4.5,"Runtime override cannot bypass range cap")
	tuner.runtime_overrides["playful.magnet_range"]=NAN
	check(wand._tuned("playful.magnet_range",4.5,1.5,4.5)==4.5,"Nonfinite value falls back to safe default")
	tuner.runtime_overrides.clear()
	var cargo=Node3D.new();game.add_child(cargo)
	var body=RigidBody3D.new();cargo.add_child(body);body.mass=.6;body.position=Vector3(.1,9.88,-3)
	body.collision_layer=8;body.collision_mask=0
	wand.register_body(body,cargo);wand.holder=game.desktop_hand;wand._pose()
	check(wand._find_target()==null,"Short range cannot acquire distant registered cargo")
	tuner.ingest({"revision":3,"values":{"playful.magnet_range":4.5},"schema":schema})
	check(wand._find_target()==body,"Live range update allows newly reachable cargo")
	wand.target=body;wand.secondary(game.desktop_hand)
	check(absf(body.linear_velocity.z+1)<.001,"Live fling strength controls actual released body")
	tuner.ingest({"revision":4,"values":{"playful.magnet_fling":5.8,"playful.magnet_range":1.5},"schema":schema})
	wand.target=body;wand._physics_process(.01)
	check(wand.target==null,"Reducing range releases cargo outside bounded tether")
	wand.target=body;wand.secondary(game.desktop_hand)
	check(absf(body.linear_velocity.z+5.8)<.001 and body.linear_velocity.length()<=6,"Strong fling stays under hard speed cap")
	game.free();await process_frame
	print("PLAYFUL_TUNING_RESULT ",JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
