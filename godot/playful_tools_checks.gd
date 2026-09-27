extends SceneTree
## Standalone, offline, no main scene or service/save initialization.
const Tools = preload("res://playful_tools.gd")
var failures: Array[String] = []
var count = 0

class Adventure extends Node:
	var zone="forge_yard"
	var zone_groups={}
	var motion={}
	var formation={}
	func haptic(_hand,_kind): pass

class Occupier extends Node:
	var occupied: Node3D
	func busy(hand): return hand==occupied

class Encounter extends Node:
	var hits=0
	func hit_target(node,_position,_velocity):
		if not node.get_meta("playful_bell",false): return false
		hits+=1
		return true

class TargetReceiver extends Node:
	var target:Node3D
	var throws=[]
	var impacts=[]
	var consumed=0
	func on_throw(context):throws.append(context)
	func hit_target(collider,point,incoming,context)->bool:
		impacts.append({"collider":collider,"point":point,"velocity":incoming,"context":context})
		if collider!=target:return false
		consumed+=1;return true

class Game extends Node3D:
	var held={}
	var adventure=Adventure.new()
	var living=Occupier.new()
	var firecraft=null
	var siegebird=null
	var workshop=null
	var enchantments=null
	var playful_encounters=Encounter.new()
	var playful_feedback=null
	var desktop_hand=Node3D.new()
	var camera=Node3D.new()
	func initialize():
		add_child(adventure); add_child(living); add_child(playful_encounters)
		add_child(desktop_hand); add_child(camera)
		var zone=Node3D.new(); add_child(zone); adventure.zone_groups.forge_yard=zone
	func hand_socket(hand): return hand
	func aim_source(hand): return hand
	func _notice(_text,_duration=0): pass
	func _ray(_source,_length): return {}

func _initialize(): call_deferred("run")

func check(ok:bool,message:String):
	count+=1
	if not ok: failures.append(message)

func run():
	var started=Time.get_ticks_usec()
	var game=Game.new(); root.add_child(game); game.initialize()
	var toy=Tools.new(); game.add_child(toy); toy.setup(game)
	var hand=game.desktop_hand
	hand.global_position=Tools.HOME; game.camera.global_position=Tools.HOME
	var other=Node3D.new(); game.add_child(other); other.global_position=Tools.HOME
	check(toy.state=="home","Starts at retrieval stand")
	check(toy.try_grab(hand,true),"Desktop E collects ring at stand")
	check(toy.busy(hand) and toy.claims_trigger(hand),"Held ring claims grip and trigger")
	check(not toy.retrieve(other),"Second hand cannot duplicate or steal held ring")
	check(toy.trigger(hand) and toy.mode==2,"Held trigger cycles charge")
	check(toy.trigger(hand) and toy.mode==0,"Charge wraps to soft toss")
	toy.trigger(hand)
	check(toy.release(hand),"Release launches desktop ring")
	check(not toy.busy(hand) and toy.claims_trigger(hand),"Flying ring reserves recall trigger only")
	check(toy.velocity.z< -8 and toy.velocity.length()<10,"Desktop toss follows camera at selected speed")
	check(not toy.release(hand),"Duplicate release does not relaunch")
	check(not toy.trigger(other),"Unrelated hand trigger remains available")
	check(toy.trigger(hand) and toy.state=="returning","Original empty hand recalls")
	for i in range(100): toy.tick(.02)
	check(toy.busy(hand),"Recall catches in original hand")
	toy.release(hand); game.held[str(hand.get_instance_id())]=Node3D.new()
	check(not toy.claims_trigger(hand) and not toy.trigger(hand),"Equipped ordinary item keeps trigger")
	toy.state="returning"; toy.tick(.02)
	check(toy.state=="home","Occupied hand sends ring to stand without overwrite")
	game.held[str(hand.get_instance_id())].free(); game.held.clear()
	game.living.occupied=hand
	check(not toy.retrieve(hand),"Living ownership prevents ring attachment")
	game.living.occupied=null
	game.adventure.formation[str(hand.get_instance_id())]=1
	check(not toy.retrieve(hand),"Bomb formation prevents ring attachment")
	game.adventure.formation.clear()
	check(Tools.launch_velocity(Vector3(30,20,0),Vector3.FORWARD,2,false).length()<=21.001,"Physical toss speed capped")
	check(Tools.launch_velocity(Vector3(2,3,0),Vector3.FORWARD,1,false).normalized().distance_to(Vector3(2,3,0).normalized())<.001,"Physical throw preserves underarm direction")
	check(Tools.launch_velocity(Vector3.ZERO,Vector3.FORWARD,0,false).z< -4,"Gentle VR release has accessible forward launch")
	toy.retrieve(hand); toy.release(hand); game.adventure.zone="sky_garden"; toy.tick(.02)
	check(toy.state=="home","Travel recovers loose ring")
	game.adventure.zone="forge_yard"; toy.tick(.02)
	toy.retrieve(hand); toy.release(hand); game.camera.position+=Vector3(30,0,0); toy.tick(.02)
	check(toy.state=="home","Same-zone portal teleport also recovers loose ring")
	hand.global_position=Tools.COURT_HOME; game.camera.global_position=Tools.COURT_HOME; toy.tick(.02)
	check(toy.try_grab(hand,true),"Court stand retrieves the same ring")
	check(toy.ring.get_parent()==hand,"Court retrieval attaches original instance")
	game.camera.position+=Vector3(30,0,0); toy.tick(.02)
	check(toy.busy(hand),"Held ring travels safely with owner")
	toy.release(hand); toy.flight_age=12.01; toy.tick(.02)
	check(toy.state=="home","Timeout cannot lose ring")
	toy.retrieve(hand); toy.release(hand); toy.ring.global_position.y=-13; toy.tick(.02)
	check(toy.state=="home","Below-world rescue returns to stand")
	toy.unlock_reward("bellwright")
	check(toy.reward=="bellwright" and toy.title.text.contains("BELLWRIGHT"),"Earned Bellwright skin applies without saving")
	# Real physics-world collision, not a manually invoked callback.
	var bell=StaticBody3D.new(); game.add_child(bell); bell.position=Vector3(0,2,-2); bell.set_meta("playful_bell",true)
	var collision=CollisionShape3D.new(); var box=BoxShape3D.new(); box.size=Vector3(2,2,.12); collision.shape=box; bell.add_child(collision)
	await physics_frame
	await physics_frame
	hand.global_position=Vector3(0,2,0); game.camera.global_position=hand.global_position
	toy.tick(.02)
	toy.retrieve(hand); toy.release(hand); toy.ring.global_position=hand.global_position; toy.velocity=Vector3(0,0,-21)
	for i in range(7): toy.tick(.02)
	check(game.playful_encounters.hits==1,"Swept flight strikes thin Bellworks collider exactly once")
	check(toy.state=="returning" or toy.state=="held","Bell impact recalls ring")
	for i in range(200): toy.tick(.02)
	check(game.playful_encounters.hits==1,"Momentum recall cannot score duplicate bell hits")
	check(toy.busy(hand),"Real collision loop ends with catch")
	bell.set_meta("playful_bell",false)
	toy.release(hand); toy.ring.global_position=Vector3(0,2,0); toy.velocity=Vector3(0,0,-21)
	for i in range(6): toy.tick(.02)
	check(toy.bounce_count==1 and toy.velocity.z>0,"Ordinary scenery bounces physical throw")
	check(toy.trail.size()==10,"Trail uses bounded reusable geometry")
	# Registered receiver consumes a real wall-bank-target flight; no fake hit calls.
	var receiver=TargetReceiver.new();game.add_child(receiver)
	check(toy.register_target_receiver(receiver),"Explicit receiver registration succeeds")
	var bank_target=StaticBody3D.new();game.add_child(bank_target);bank_target.position=Vector3(0,2,1.5)
	var target_col=CollisionShape3D.new();var target_shape=BoxShape3D.new();target_shape.size=Vector3(2,2,.06);target_col.shape=target_shape;bank_target.add_child(target_col)
	receiver.target=bank_target
	await physics_frame;await physics_frame
	toy.retrieve(hand);game.camera.position=Vector3(0,2,.2);toy.tick(.02)
	var earlier_throw_id=toy.throw_id;var earlier_bell_hits=game.playful_encounters.hits
	check(toy.release(hand),"Bankshot begins with actual release")
	check(toy.throw_id==earlier_throw_id+1 and receiver.throws.size()==1,"Actual release increments and announces one throw ID")
	check(not toy.release(hand) and receiver.throws.size()==1,"Duplicate release cannot announce phantom throw")
	var launch=receiver.throws[0]
	check(launch.is_read_only() and launch.launchPosition==game.camera.global_position,"Throw context immutable and scoped to camera launch position")
	check(launch.bounceCount==0 and launch.lastBounceCollider==null and launch.lastBounceAt==-1 and launch.flightAge==0,"Each new throw resets all bounce provenance")
	for i in range(100):toy.tick(.02)
	check(receiver.consumed==1,"Real thin wall bounce reaches registered thin target exactly once")
	check(receiver.impacts.size()==2,"Receiver sees wall then target only, never repeats a scored target")
	var wall_context=receiver.impacts[0].context
	var bank_context=receiver.impacts[1].context if receiver.impacts.size()>1 else {}
	check(wall_context.bounceCount==0 and wall_context.lastBounceCollider==null,"Wall callback observes only previous bounces")
	check(not bank_context.is_empty() and bank_context.throwId==launch.throwId and bank_context.bounceCount==1 and bank_context.lastBounceCollider==bell,"Target sees authentic same-throw designated wall provenance")
	check(not bank_context.is_empty() and bank_context.lastBounceAt>=0 and bank_context.flightAge>=bank_context.lastBounceAt,"Bounce timestamp uses finite elapsed flight time")
	check(game.playful_encounters.hits==earlier_bell_hits and toy.busy(hand),"Consumed custom target recalls safely without extra Bellworks score")
	# Receiver refusal preserves the established Bellworks callback behavior.
	bank_target.collision_layer=0;bell.set_meta("playful_bell",true)
	await physics_frame;await physics_frame
	toy.release(hand)
	check(receiver.throws[1].throwId>launch.throwId and receiver.throws[1].lastBounceCollider==null,"Next throw cannot inherit previous wall")
	check(launch.bounceCount==0 and launch.flightAge==0 and bank_context.bounceCount==1,"Previously delivered context snapshots do not mutate")
	for i in range(50):toy.tick(.02)
	check(game.playful_encounters.hits==earlier_bell_hits+1,"Refused custom target still invokes normal Bellworks")
	check(toy.bounce_count==0,"Consumed Bellworks hit is not recorded as a physical bounce")
	# Four weak receivers maximum; duplicate registration does not consume a slot.
	var extra=[]
	for i in range(4):var item=TargetReceiver.new();game.add_child(item);extra.append(item)
	for i in range(3):check(toy.register_target_receiver(extra[i]),"Additional receiver fits bounded registry")
	check(not toy.register_target_receiver(extra[3]),"Fifth receiver rejected")
	check(toy.register_target_receiver(receiver) and toy.target_receivers.size()==4,"Duplicate receiver registration is idempotent")
	extra[1].free()
	check(toy.register_target_receiver(extra[3]) and toy.target_receivers.size()==4,"Freed weak receiver is pruned before registration")
	check(toy.unregister_target_receiver(extra[3]) and not toy.unregister_target_receiver(extra[3]),"Explicit unregister reports removal once")
	var invalid=Node.new();game.add_child(invalid)
	check(not toy.register_target_receiver(invalid) and not toy.register_target_receiver(null),"Missing receiver method and null are rejected")
	# Corrupt numeric context cannot leak infinities or mutate game physics state.
	var saved_launch=toy.launch_position;var saved_age=toy.flight_age;var saved_bounce_at=toy.last_bounce_at
	toy.launch_position=Vector3(INF,0,0);toy.flight_age=NAN;toy.last_bounce_at=INF
	var finite=toy._throw_context()
	check(finite.launchPosition.is_finite() and is_finite(finite.flightAge) and is_finite(finite.lastBounceAt),"Receiver context remains finite under invalid numeric inputs")
	toy.launch_position=saved_launch;toy.flight_age=saved_age;toy.last_bounce_at=saved_bounce_at
	toy.last_bounce_ref=weakref(bell);bell.free()
	check(toy._throw_context().lastBounceCollider==null,"Freed bounce collider becomes null in future snapshots")
	check(toy.unregister_target_receiver(receiver),"Challenge receiver can be retired explicitly")
	print("PLAYFUL_TOOLS_CHECK_RESULT ",JSON.stringify({"checks":count,"failures":failures,"elapsed_seconds":float(Time.get_ticks_usec()-started)/1000000.0}))
	toy.sound.stop()
	# AudioServer retires playback on its own mixing boundary, even headless.
	await create_timer(.1).timeout
	game.free()
	await create_timer(.1).timeout
	quit(0 if failures.is_empty() else 1)
