extends SceneTree
const Encounters=preload("res://playful_encounters.gd")
class Toy:
	extends RefCounted
	var rewards=[]
	func unlock_reward(id): rewards.append(id)
class MockGame:
	extends Node3D
	var diagnostic_offline=true
	var smoke=false
	var adventure={"zone_groups":{}}
	var camera:Camera3D
	var playful_tools=Toy.new()
	var playful_feedback=null
	var notices=[]
	func _notice(text,_duration=0): notices.append(text)
var failures=[]
var checks=0
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func hit(encounter,index):
	encounter.tick(.7)
	encounter.hit_target(encounter.bells[index],encounter.bells[index].global_position,Vector3(0,0,-12))
func _initialize(): run.call_deferred()
func run():
	var began=Time.get_ticks_usec()
	var game=MockGame.new(); root.add_child(game)
	var zone=Node3D.new(); game.add_child(zone); game.adventure.zone_groups.forge_yard=zone
	game.camera=Camera3D.new(); game.add_child(game.camera); game.camera.position=Encounters.CENTER+Vector3(0,1.7,5)
	var fair=Encounters.new(); game.add_child(fair); fair.setup(game)
	check(not fair.persistence_enabled,"Diagnostic setup must disable save reads and writes")
	fair.act("start")
	check(fair.state.discovered and not fair.state.ready and not fair.state.claimed,"Discovery is distinct from completion and reward")
	fair.act("claim")
	check(not fair.state.claimed and game.playful_tools.rewards.is_empty(),"Early claim cannot unlock reward")
	game.camera.position.z=Encounters.CENTER.z
	hit(fair,0)
	check(fair.state.notes.is_empty(),"Throws from in front of gold line cannot score")
	game.camera.position.z=Encounters.CENTER.z+5
	fair.hit_target(fair.bells[0],Vector3.ZERO,Vector3.ZERO)
	check(fair.state.notes.is_empty(),"A stationary contact cannot score")
	hit(fair,0); hit(fair,0)
	check(fair.state.notes.size()==1,"Repeated same bell cannot finish distinct-bell trial")
	hit(fair,1); hit(fair,2)
	check(fair.state.stage==1,"Three different bells advance to melody")
	hit(fair,0); hit(fair,1)
	check(fair.state.melody==0,"Wrong melody resets sequence")
	for note in Encounters.MELODY: hit(fair,note)
	check(fair.state.stage==2 and fair.bells[3].visible,"Ordered melody unlocks moving golden bell")
	var previous=fair.bells[3].position; fair.tick(.5)
	check(previous.distance_to(fair.bells[3].position)>.01,"Golden target physically moves")
	hit(fair,0)
	check(fair.state.gold==0,"Wrong bell does not advance golden trial")
	hit(fair,3); hit(fair,3); hit(fair,3)
	check(fair.state.ready and not fair.state.claimed,"Final trial becomes reward-ready without auto-claim")
	fair.act("claim"); fair.act("claim")
	check(fair.state.claimed and fair.state.wins==1 and game.playful_tools.rewards==["bellwright"],"Claim is idempotent and grants earned cosmetic once")
	fair.act("replay")
	check(fair.state.stage==0 and not fair.state.ready and fair.state.claimed and fair.reward.visible,"Replay resets trials while preserving permanent trophy")
	var snapshot=fair.progress_snapshot(); snapshot.notes.append(2)
	check(fair.state.notes.is_empty(),"Snapshot cannot mutate live progression")
	var forged=Node3D.new(); game.add_child(forged); forged.set_meta("playful_bell",3)
	check(not fair.hit_target(forged,Vector3.ZERO,Vector3.FORWARD*12),"Foreign tagged targets cannot grant progress")
	# Only unique work fixtures are ever writable, never any user:// save.
	var folder=ProjectSettings.globalize_path("res://../work/bellworks-check-"+str(OS.get_process_id())+"-"+str(Time.get_ticks_usec()))
	DirAccess.make_dir_recursive_absolute(folder)
	fair.save_path=folder+"/progress.json"; fair.persistence_enabled=true
	check(fair.save_progress(),"Atomic initial fixture save succeeds")
	var initial_revision=fair.state.revision
	fair.state.revision+=1; fair.state.notes=[0]
	check(fair.save_progress() and FileAccess.file_exists(fair.save_path+".bak"),"Repeated save keeps recoverable previous snapshot")
	var restored=Encounters.new(); restored.save_path=fair.save_path; restored.persistence_enabled=true; restored.load_progress()
	check(restored.state.notes==[0] and restored.state.claimed,"Earned reward and partial next-run progress survive reload")
	var corrupt=FileAccess.open(fair.save_path,FileAccess.WRITE); corrupt.store_string("{broken"); corrupt.close()
	restored.state=Encounters.fresh_state(); restored.load_progress()
	check(restored.state.revision==initial_revision and restored.state.claimed,"Corrupt primary restores last valid backup")
	var pending=fair.state.duplicate(true); pending.revision+=1; pending.notes=[0,1]
	var temporary=FileAccess.open(fair.save_path+".tmp",FileAccess.WRITE); temporary.store_string(JSON.stringify(pending)); temporary.close()
	restored.load_progress()
	check(restored.state.notes==[0,1],"Interrupted replacement recovers newer valid temporary snapshot")
	var before=FileAccess.get_file_as_bytes(fair.save_path)
	restored.persistence_enabled=false; restored.state.revision+=4; restored.save_progress(); restored.load_progress()
	check(FileAccess.get_file_as_bytes(fair.save_path)==before,"Disabled diagnostic persistence leaves existing fixture untouched")
	var invalid=Encounters.fresh_state(); invalid.stage=3; invalid.ready=true
	check(not fair._valid(invalid),"Malformed completion state cannot award a trophy")
	restored.free(); game.free()
	print("BELLWORKS_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0," fixture=",folder)
	quit(0 if failures.is_empty() else 1)
