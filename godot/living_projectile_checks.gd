extends SceneTree
## Service-published snapshots drive the real loader; no main scene or user saves.
var failures=[]
var checks=0
class Actions extends RefCounted:
	var falling=false
	func move_rig(_movement):return 1.0
class Grips extends RefCounted:
	func is_stowed(_body):return false
class Tuning extends RefCounted:
	var runtime_overrides={}
class Museum extends RefCounted:
	func tick(_delta):pass
	func sync(_snapshot):pass
	func trigger(_hand,_target):return false
class Occupier extends RefCounted:
	var hand=null
	func busy(candidate):return candidate==hand
class Game extends Node3D:
	var living
	var camera=Camera3D.new()
	var rig=Node3D.new()
	var desktop_hand=Node3D.new()
	var hands=[]
	var held={}
	var grips=Grips.new()
	var tuning=Tuning.new()
	var item_actions=Actions.new()
	var playful_tools=Occupier.new()
	var diagnostic_offline=true
	var smoke=true
	var elapsed=0.0
	func initialize():add_child(rig);rig.add_child(camera);add_child(desktop_hand);camera.position=Vector3(-3,1.5,9)
	func aim_source(hand):return hand
	func hand_socket(hand):return hand
	func _notice(_message,_duration=0):pass
var game
var runtime
func _initialize():call_deferred("run")
func check(ok,message):
	checks+=1
	if not ok:failures.append(message)
func step(count=1,delta=.02):
	for i in range(count):
		game.elapsed+=delta;runtime.tick(delta);await process_frame
func locate(snapshot):
	runtime.sync(snapshot)
	for i in range(30):
		await step()
		if runtime.active.has("demo-ember-return"):return
func grab_ring(entry):
	game.desktop_hand.global_position=entry.node.global_position
	return runtime.try_grab(game.desktop_hand)
func run():
	var start=Time.get_ticks_usec()
	var args=OS.get_cmdline_user_args()
	if args.is_empty():push_error("Pass isolated snapshot bundle after --");quit(2);return
	var bundle=JSON.parse_string(FileAccess.get_file_as_string(args[0]))
	game=Game.new();root.add_child(game);game.initialize()
	runtime=preload("res://living_runtime.gd").new();game.add_child(runtime);game.living=runtime
	runtime.game=game;runtime.museum=Museum.new()
	runtime.components=preload("res://living_components.gd").new();runtime.add_child(runtime.components);runtime.components.setup(game)
	var engine=runtime.components;var hand=game.desktop_hand
	WorldZones.body(game,Vector3(-3,-.15,6),Vector3(12,.3,12),"solid")
	await locate(bundle.one)
	check(runtime.active.has("demo-ember-return"),"Published snapshot stages and activates without restart")
	if not runtime.active.has("demo-ember-return"):finish(start);return
	var built=runtime.active["demo-ember-return"];var ring=built.entities.ring
	check(runtime.ack_queue.any(func(ack):return ack.status=="applied"),"Native applied acknowledgement generated")
	check(ring.mesh.mesh is TorusMesh,"Declarative ring appearance builds palm-sized torus")
	for bad_case in ["mass","size","grabbable","speed","event","link"]:
		var bad=bundle.one.packages[0].duplicate(true)
		match bad_case:
			"mass":bad.entities[1].components[0].config.mass=4
			"size":bad.entities[1].size=[2,2,2]
			"grabbable":bad.entities[1].components.remove_at(0)
			"speed":bad.entities[1].components[1].config.speed=INF
			"event":bad.entities[1].components[1].config.hitEvent="arbitrary_native"
			"link":bad.links=[{"id":"joint","from":"ring","to":"stand","type":"hinge","config":{}}]
		check(not preload("res://living_component_schema.gd").validate(bad).is_empty(),"Independent native validation rejects "+bad_case)
	var link={"from":ring,"to":built.entities.stand,"spec":{"config":{}},"joint":null}
	engine._hinge(link,built)
	check(link.joint==null,"Runtime maker/restored joints cannot attach returning projectile")
	await physics_frame;await physics_frame
	game.camera.look_at(ring.node.global_position,Vector3.UP)
	hand.global_position=game.camera.global_position+Vector3(0,-.2,-.5)
	check(runtime.try_grab(hand),"Desktop aimed E reaches palm-sized ring within three metres")
	engine._release_key(str(hand.get_instance_id()),false)
	ring.node.position=ring.home;game.camera.rotation=Vector3.ZERO
	var other=Node3D.new();game.add_child(other);other.global_position=ring.node.global_position
	check(grab_ring(ring),"Generated ring uses existing grip mechanism")
	check(not runtime.try_grab(other),"Second hand cannot steal held entity")
	var old_id=ring.node.get_instance_id();runtime.sync(bundle.two);await step(4)
	check(runtime.active["demo-ember-return"].version==1 and ring.node.get_instance_id()==old_id,"Held exact v1 survives desired v2")
	check(runtime.ack_queue.any(func(ack):return ack.status=="deferred"),"Held replacement reports deferred")
	check(runtime.release(hand),"Existing release launches generated ring")
	await step(8)
	check(runtime.active["demo-ember-return"].version==2,"Release permits immutable v2 activation")
	check(engine.projectiles.flights.is_empty(),"Replacement retires all old-flight references")
	check(not runtime.claims_trigger(hand),"Old hand cannot recall replaced version")
	built=runtime.active["demo-ember-return"];ring=built.entities.ring
	check(grab_ring(ring),"Replacement ring remains usable")
	runtime.release(hand)
	check(engine.projectiles.flights.size()==1 and runtime.claims_trigger(hand) and not runtime.busy(hand),"Flight claims recall input without claiming grip ownership")
	check(ring.node.linear_velocity==Vector3.ZERO and ring.node.freeze,"Native rigid simulation cannot double-integrate flight")
	var saved=engine.serialize(built)
	check(saved.entities.ring.position==[ring.home.x,ring.home.y,ring.home.z],"Transient flight serializes authored home rather than stale air position")
	await step(5)
	check(runtime.trigger(hand,null),"Empty-hand trigger starts recall")
	await step(30)
	check(runtime.busy(hand) and engine.held[str(hand.get_instance_id())].entry.node==ring.node,"Recall catches exact original instance")
	check(engine.projectiles.flights.is_empty(),"Catch clears flight state")
	# Real thin geometry hit drives only package-local configured rule targets.
	var wall=WorldZones.body(game,Vector3(-3,1.2,5.8),Vector3(2,2,.08),"solid")
	await physics_frame;await physics_frame
	var rig_before=game.rig.global_transform
	hand.global_position=Vector3(-3,1.2,7);engine.tick(.02)
	engine.held[str(hand.get_instance_id())].velocity=Vector3.ZERO
	runtime.release(hand)
	await step(45)
	check(runtime.local_events.any(func(event):return event.event=="projectile_hit"),"Swept throw strikes thin world geometry")
	check(float(built.entities.lantern.state.power)>0,"Impact invokes existing bounded package power rule")
	check(int(built.entities.lantern.state.count)==1,"Return flight does not score duplicate impact objective")
	check(game.rig.global_transform==rig_before,"Throw and recall never teleport the player")
	check(runtime.local_events.any(func(event):return event.event=="signal:ring_chime"),"Configured valid hit signal emitted")
	# A newly occupied native-toy hand must never be overwritten by a catch.
	if not runtime.busy(hand):grab_ring(ring)
	runtime.release(hand);game.playful_tools.hand=hand
	check(not runtime.claims_trigger(hand) and not engine.projectiles.recall(hand),"Native toy keeps ownership and input during loose flight")
	var flight=engine.projectiles.flights.values()[0];engine.projectiles._return(flight)
	await step(2)
	check(not runtime.busy(hand) and engine.projectiles.flights.is_empty(),"Occupied-hand recall returns own object home")
	game.playful_tools.hand=null
	check(ring.node.position.distance_to(ring.home)<.05,"Occupied-hand recovery restores package home")
	# Flight may be physically intercepted by another free hand, with no old tether.
	grab_ring(ring);runtime.release(hand);other.global_position=ring.node.global_position
	check(runtime.try_grab(other),"Other free hand may catch by physically gripping the ring")
	check(not runtime.claims_trigger(hand) and engine.projectiles.flights.is_empty(),"Physical interception cancels previous owner's recall")
	runtime.release(other);engine.projectiles.retire(built)
	# Bounce/stop use supported config on newly built packages, not mutation of archive.
	for mode in ["bounce","stop"]:
		var spec=bundle.one.packages[0].duplicate(true);spec.id="projectile-"+mode
		spec.entities=spec.entities.slice(0,2);spec.rules=[];spec.entities[1].components[1].config.collision=mode
		var holder=Node3D.new();game.add_child(holder);var test=engine.build(spec,holder);engine.activate(test)
		var item=test.entities.ring;item.node.global_position=Vector3(-3,1.2,6.6);other.global_position=item.node.global_position
		engine._hold_entry(item,other);engine.held[str(other.get_instance_id())].velocity=Vector3(0,0,-8);engine.release(other)
		for i in range(9):engine.tick(.02)
		var state=engine.projectiles.flights.get(item.node.get_instance_id(),{})
		check(not state.is_empty() and ((mode=="bounce" and state.velocity.z>0) or (mode=="stop" and state.mode=="parked")),"Configured collision response: "+mode)
		engine.deactivate(test);holder.free()
	# A whole-scene long teleport recovers loose items, never moves their callers.
	grab_ring(ring);runtime.release(hand);game.camera.position.x+=30;await step()
	check(engine.projectiles.flights.is_empty(),"Long player travel severs loose recall and restores home")
	# Removal through same coordinator cleans entities and transient references.
	runtime.sync(bundle.removed);await step(6)
	check(not runtime.active.has("demo-ember-return") and engine.projectiles.flights.is_empty(),"Normal unpublish retires entity and all flight state")
	check(runtime.ack_queue.any(func(ack):return ack.version==0 and ack.status=="applied"),"Removal acknowledgement generated")
	finish(start)
func finish(start):
	print("LIVING_PROJECTILE_RESULT ",JSON.stringify({"checks":checks,"failures":failures,"elapsed_seconds":float(Time.get_ticks_usec()-start)/1000000.0}))
	game.free();await process_frame;quit(0 if failures.is_empty() else 1)
