extends SceneTree
const Cargo=preload("res://cargo_playground.gd")
class Wand:
	extends RefCounted
	var target=null
	var registered=[]
	var releases=0
	var holder=null
	func busy(hand)->bool: return holder==hand
	func register_body(body,owner)->bool:
		if body.get_parent()!=owner: return false
		registered.append(body); return true
	func release_target(body=null)->bool:
		if target==null or (body!=null and target!=body): return false
		target=null; releases+=1; return true
class Adventure:
	extends RefCounted
	var zone_groups={}
	var formation={}
	var haptics=[]
	func haptic(_hand,event): haptics.append(event)
class MockGame:
	extends Node3D
	var diagnostic_offline=true
	var smoke=false
	var adventure=Adventure.new()
	var held={}
	var camera:Camera3D
	var playful_feedback=null
	var magnetic_wand=Wand.new()
	var notices=[]
	func _notice(text,_duration=0): notices.append(text)
var failures=[]
var count=0
func check(condition,message):
	count+=1
	if not condition: failures.append(message); push_error(message)
func _initialize(): run.call_deferred()
func rest(cargo,index,at=-1):
	var body=cargo.bodies[index]
	body.position=cargo.nests[index if at<0 else at]
	body.linear_velocity=Vector3.ZERO; body.angular_velocity=Vector3.ZERO
func run():
	var began=Time.get_ticks_usec()
	var game=MockGame.new(); root.add_child(game)
	var zone=Node3D.new(); game.add_child(zone); game.adventure.zone_groups.forge_yard=zone
	game.camera=Camera3D.new(); game.add_child(game.camera); game.camera.position=Cargo.CENTER+Vector3(0,1.7,4)
	var cargo=Cargo.new(); game.add_child(cargo); cargo.setup(game)
	check(not cargo.persistence_enabled,"Diagnostics disable real save access")
	check(cargo.bodies.size()==3 and game.magnetic_wand.registered.size()==3,"Exactly three owned cargo bodies register with wand")
	cargo.tick(.1)
	check(cargo.state.discovered and not cargo.state.earned,"Approaching discovers cargo without earning reward")
	cargo.act("launch")
	check(not cargo.state.earned,"Lever cannot bypass unsolved cargo puzzle")
	var hand=Node3D.new(); game.add_child(hand); hand.global_position=cargo.lever_handle.global_position
	check(not cargo.try_grab(hand,true),"Desktop keeps button activation rather than invisible hand capture")
	game.held[str(hand.get_instance_id())]=Node3D.new()
	check(not cargo.try_grab(hand),"A generic occupied hand cannot grab the lever")
	game.held[str(hand.get_instance_id())].free(); game.held.clear()
	game.magnetic_wand.holder=hand
	check(not cargo.try_grab(hand),"A wand-holding hand cannot grab the lever")
	game.magnetic_wand.holder=null; game.adventure.formation[str(hand.get_instance_id())]={}
	check(not cargo.try_grab(hand),"Bomb formation prevents lever ownership")
	game.adventure.formation.clear()
	check(cargo.try_grab(hand) and cargo.busy(hand),"Nearby free grip acquires the real lever handle")
	hand.position.z+=.28; cargo.tick(.016)
	check(not cargo.state.earned and game.adventure.haptics[-1]=="impact","Premature physical pull rejects completion with haptic feedback")
	var rejection_count=game.adventure.haptics.size(); cargo.tick(.016)
	check(game.adventure.haptics.size()==rejection_count,"A held pull emits one attempt rather than repeated rejection")
	check(cargo.release(hand) and not cargo.busy(hand),"Grip release relinquishes lever ownership")
	cargo.tick(.5)
	check(is_zero_approx(cargo.lever_pull),"Released lever visibly springs back")
	hand.global_position=cargo.lever_handle.global_position; cargo.try_grab(hand); hand.position.x+=1; cargo.tick(.016)
	check(not cargo.busy(hand),"Moving a gripped hand beyond safe reach disengages the lever")
	for i in range(3): rest(cargo,i,(i+1)%3)
	cargo.tick(1.1)
	check(not cargo.can_launch and cargo.settled==[0.0,0.0,0.0],"Wrong parcels in nests do not count")
	for i in range(3): rest(cargo,i)
	game.magnetic_wand.target=cargo.bodies[0]; cargo.tick(1.1)
	check(not cargo.can_launch and cargo.settled[0]==0,"Magnet-held parcel cannot satisfy resting condition")
	game.magnetic_wand.release_target(); cargo.bodies[0].linear_velocity=Vector3.RIGHT*2; cargo.tick(1.1)
	check(not cargo.can_launch,"Moving cargo cannot satisfy resting condition")
	rest(cargo,0); cargo.tick(.5)
	check(not cargo.can_launch,"Cargo must remain stable for a full second")
	cargo.tick(.6)
	check(cargo.can_launch and not cargo.state.earned,"Three settled parcels become ready without awarding reward")
	hand.global_position=cargo.lever_handle.global_position; cargo.try_grab(hand); hand.position.z+=.28; cargo.tick(.016)
	check(cargo.launched and game.adventure.haptics[-1]=="ready" and cargo.lever_pivot.rotation.x>0,"Physical grip pull opens the flower and animates the handle with acceptance haptic")
	cargo.release(hand); cargo.act("launch"); cargo.tick(1.0)
	check(cargo.state.earned and cargo.state.rounds==1 and cargo.bloom>0,"Lever blooms and rewards once per solved delivery")
	var updates=cargo.indicator_updates; var material=cargo.indicators[0].material_override
	for i in range(20): cargo.tick(.01)
	check(cargo.indicator_updates==updates and cargo.indicators[0].material_override==material,"Steady cargo reuses cached indicator materials without reassignments")
	game.magnetic_wand.target=cargo.bodies[1]; cargo.act("reset")
	check(game.magnetic_wand.target==null and cargo.bodies[1].position==cargo.homes[1],"Reset releases magnetic ownership before moving parcels")
	check(cargo.state.earned and not cargo.launched and cargo.bodies.size()==3,"Reset preserves permanent reward and reuses three bodies")
	cargo.bodies[2].position=Vector3(0,-3,0); cargo.tick(.1)
	check(cargo.bodies[2].position==cargo.homes[2],"Lost cargo returns without creating duplicates")
	# Real physics drop into the troughs: settle and check floor/bridge continuity.
	for i in range(3): rest(cargo,i); cargo.bodies[i].position.y+=.3
	for i in range(150): await physics_frame; cargo.tick(1.0/60.0)
	check(cargo.can_launch,"Actual rigid bodies fall and settle into matching receiving troughs")
	var space=game.get_world_3d().direct_space_state
	for x in [126.5,128.0,131.0,134.5,137.0]:
		var hit=space.intersect_ray(PhysicsRayQueryParameters3D.create(Vector3(x,2,65),Vector3(x,-1,65),1))
		check(not hit.is_empty() and hit.normal.y>.9,"Bridge and annex have continuous walkable floor at x="+str(x))
	var capsule=CapsuleShape3D.new(); capsule.radius=.22; capsule.height=1.65
	var query=PhysicsShapeQueryParameters3D.new(); query.shape=capsule; query.collision_mask=1
	query.transform=Transform3D(Basis.IDENTITY,Vector3(131,.92,65))
	check(space.intersect_shape(query,1).is_empty(),"Bridge has clear standing capsule space")
	var folder=ProjectSettings.globalize_path("res://../work/cargo-check-"+str(OS.get_process_id())+"-"+str(Time.get_ticks_usec()))
	DirAccess.make_dir_recursive_absolute(folder); cargo.save_path=folder+"/cargo.json"; cargo.persistence_enabled=true
	check(cargo.save_progress(),"Initial isolated reward save succeeds")
	cargo.state.revision+=1; cargo.state.rounds+=1
	check(cargo.save_progress(),"Repeated reward save preserves backup")
	var restored=Cargo.new(); restored.persistence_enabled=true; restored.save_path=cargo.save_path; restored.load_progress()
	check(restored.state.earned and restored.state.rounds==2,"Earned trophy survives a new module session")
	var file=FileAccess.open(cargo.save_path,FileAccess.WRITE); file.store_string("broken"); file.close(); restored.load_progress()
	check(restored.state.earned and restored.state.rounds==1,"Damaged primary recovers valid prior earned reward")
	var pending=cargo.state.duplicate(); pending.revision+=1; pending.rounds=3
	file=FileAccess.open(cargo.save_path+".tmp",FileAccess.WRITE); file.store_string(JSON.stringify(pending)); file.close(); restored.load_progress()
	check(restored.state.rounds==3,"Interrupted replacement recovers newer validated temporary save")
	var bytes=FileAccess.get_file_as_bytes(cargo.save_path)
	restored.persistence_enabled=false; restored.save_progress(); restored.load_progress()
	check(FileAccess.get_file_as_bytes(cargo.save_path)==bytes,"Diagnostic save is a no-op even with a configured fixture")
	check(not cargo._valid({"schema":1,"revision":1,"rounds":0,"earned":true,"discovered":true}),"Malformed unearned trophy state is rejected")
	restored.free(); game.free()
	print("CARGO_CHECKS checks=",count," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
