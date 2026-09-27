extends SceneTree
const Bank=preload("res://bankshot_challenge.gd")
class Adventure:
	extends Node
	var zone="forge_yard"
	var zone_groups={}
	var motion={}
	var formation={}
	func haptic(_hand,_kind): pass
class Travel:
	extends Node
	func busy(_hand): return false
	func safe_travel(_destination): return true
class Game:
	extends Node3D
	var diagnostic_offline=true
	var smoke=false
	var held={}
	var adventure=Adventure.new()
	var living=Travel.new()
	var playful_tools
	var playful_encounters=null
	var playful_feedback=null
	var bankshot
	var camera=Node3D.new()
	var desktop_hand=Node3D.new()
	var notices=[]
	func initialize():
		add_child(adventure); add_child(living); add_child(camera); add_child(desktop_hand)
		var zone=Node3D.new(); add_child(zone); adventure.zone_groups.forge_yard=zone
	func _notice(message,_seconds=0): notices.append(message)
	func hand_socket(hand): return hand
	func aim_source(hand): return hand
	func _ray(_source,_length): return {}
var failures=[]
var checks=0
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func _initialize(): run.call_deferred()
func context(id,bank,bounces=1,panel=null)->Dictionary:
	return {"throwId":id,"bounceCount":bounces,"launchPosition":Bank.LANDING+Vector3.UP*1.7,"lastBounceCollider":bank.panel if panel==null else panel,"lastBounceAt":.8,"flightAge":1.5}
func run():
	var began=Time.get_ticks_usec()
	var game=Game.new(); root.add_child(game); game.initialize()
	game.camera.position=Bank.LANDING+Vector3.UP*1.7; game.desktop_hand.transform=game.camera.transform
	game.playful_tools=preload("res://playful_tools.gd").new(); game.add_child(game.playful_tools); game.playful_tools.setup(game)
	var bank=Bank.new(); game.add_child(bank); game.bankshot=bank; bank.setup(game)
	check(not bank.persistence_enabled and not bank.state.medal,"Diagnostic setup has fresh progress and no normal-save access")
	bank.act("visit")
	check(bank.state.discovered and not bank.state.completed,"Visiting discovers the trial without awarding a medal")
	var event=context(100,bank)
	bank.on_throw(event); bank.on_throw(event)
	check(bank.state.shots==1,"Duplicate throw callbacks count a release only once")
	var direct=event.duplicate(); direct.bounceCount=0; direct.lastBounceCollider=null; direct.lastBounceAt=-1
	check(bank.hit_target(bank.target,bank.target.global_position,Vector3.BACK*8,direct) and bank.state.stage==0,"Direct target hit recalls without scoring")
	var foreign=StaticBody3D.new(); game.add_child(foreign)
	check(not bank.hit_target(bank.panel,bank.panel.global_position,Vector3.FORWARD*8,event),"Designated panel collision remains a real physical bounce")
	check(not bank.hit_target(foreign,Vector3.ZERO,Vector3.FORWARD*8,event),"Unrelated collider is not consumed by challenge")
	var wrong=context(101,bank,1,foreign); bank.on_throw(wrong); bank.hit_target(bank.target,Vector3.ZERO,Vector3.BACK*7,wrong)
	check(bank.state.stage==0,"A bounce from another wall cannot satisfy panel requirement")
	var twice=context(102,bank,2); bank.on_throw(twice); bank.hit_target(bank.target,Vector3.ZERO,Vector3.BACK*7,twice)
	check(bank.state.stage==0,"An intervening second collision invalidates bank provenance")
	var outside=context(103,bank); outside.launchPosition=Bank.CENTER; bank.on_throw(outside); bank.hit_target(bank.target,Vector3.ZERO,Vector3.BACK*7,outside)
	check(bank.state.stage==0 and bank.state.shots==3,"Off-line throws cannot score or count as eligible attempts")
	var good=context(104,bank); bank.on_throw(good); bank.hit_target(bank.target,Vector3.ZERO,Vector3.BACK*7,good); bank.hit_target(bank.target,Vector3.ZERO,Vector3.BACK*7,good)
	check(bank.state.stage==1 and bank.state.shots==4,"A valid bank advances once and preserves actual attempt count")
	bank.act("replay")
	check(bank.state.stage==0 and bank.state.shots==0 and not bank.state.medal,"Replay cannot create an unearned best score or medal")
	# Prove all three stages with actual Sunskipper release, swept collision,
	# panel reflection and target callback, at default COURTYARD speed/gravity.
	bank.state=Bank.fresh_state(); bank.last_throw=-1; bank.current_throw=-1; bank.scored_throw=-1; bank._refresh()
	var directions=[Vector3(.19,.10,-1),Vector3(-.21,.10,-1),Vector3(.16,.075,-1)]
	for stage in range(3):
		await physics_frame
		game.camera.position=Bank.LANDING+Vector3.UP*1.7
		game.camera.look_at(game.camera.position+directions[stage])
		game.desktop_hand.global_transform=game.camera.global_transform
		var toy=game.playful_tools; toy._home(); toy.last_camera_position=game.camera.position; toy.mode=1
		toy.retrieve(game.desktop_hand); toy.release(game.desktop_hand)
		for step in range(220):
			toy.tick(.02)
			if toy.state=="held": break
		check(bank.state.stage==stage+1,"Real default-power bank flight reaches stage "+str(stage+1)+" direction="+str(directions[stage])+" actual="+str(bank.state.stage))
		print("BANKSHOT_FLIGHT stage=",stage+1," launch=",Bank.LANDING+Vector3.UP*1.7," direction=",directions[stage].normalized()," power=COURTYARD actual_stage=",bank.state.stage)
	check(bank.state.completed and bank.state.medal and bank.state.shots==3 and bank.state.bestShots==3,"Three real throws complete medal with a genuine best score")
	bank.act("replay")
	check(bank.state.medal and bank.state.bestShots==3 and not bank.state.completed and bank.state.replays==1,"Replay preserves medal/best while starting a fresh round")
	var invalid=Bank.fresh_state(); invalid.medal=true
	check(not Bank._valid(invalid),"Malformed medal without a completed best result is rejected")
	var folder=OS.get_environment("TEMP").replace("\\","/").path_join("brann-bankshot-"+str(OS.get_process_id())+"-"+str(Time.get_ticks_usec()))
	DirAccess.make_dir_recursive_absolute(folder); bank.save_path=folder+"/bank.json"; bank.persistence_enabled=true
	check(bank.save_progress(),"Isolated native bankshot snapshot saves")
	bank.state.shots=2; bank.state.stage=1; bank.state.discovered=true; bank.state.revision+=1
	check(bank.save_progress(),"Partial round preserves atomic prior snapshot")
	var loaded=Bank.new(); loaded.save_path=bank.save_path; loaded.persistence_enabled=true; loaded.load_progress()
	check(loaded.state.stage==1 and loaded.state.medal and loaded.state.bestShots==3,"Partial round and permanent best restore together")
	var file=FileAccess.open(bank.save_path,FileAccess.WRITE); file.store_string("broken"); file.close(); loaded.load_progress()
	check(loaded.state.stage==0 and loaded.state.bestShots==3,"Corrupt primary recovers prior validated medal snapshot")
	var snapshot=bank.progress_snapshot(); snapshot.shots=500
	check(bank.state.shots==2,"Public progress copy cannot mutate score")
	loaded.free(); game.playful_tools.sound.stop()
	# AudioServer releases WAV playback on its mixing boundary, not scene frames.
	await create_timer(.1).timeout
	game.free(); await create_timer(.1).timeout
	print("BANKSHOT_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
