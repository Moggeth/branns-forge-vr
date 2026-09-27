extends SceneTree
const Relay=preload("res://festival_relay.gd")
const Components=preload("res://living_components.gd")
class Bell:
	extends Node
	signal bell_struck(index:int)
	var court=Node3D.new()
class Cargo:
	extends Node
	var state={"rounds":4}
	var can_launch=true
	var launched=true
	var lever_holder=null
	var resets=0
	var cargo_root=Node3D.new()
	func act(action):
		if action=="reset": resets+=1; can_launch=false; launched=false
class Tool:
	extends Node
	var holder=null
class Fire:
	extends Node
	var holding=false
	func busy(_hand): return holding
class Travel:
	extends Node
	var active={}
	var wanted={}
	var components
	var destinations=[]
	var publishes=0
	func safe_travel(destination): destinations.append(destination); return true
	func publish(package):
		publishes+=1
		await get_tree().process_frame
		wanted[package.id]=package
		return {"status":"staged"}
class Actions:
	extends RefCounted
	var falling=false
class Game:
	extends Node3D
	var diagnostic_offline=true
	var smoke=false
	var held={}
	var playful_encounters=Bell.new()
	var cargo_playground=Cargo.new()
	var playful_tools=Tool.new()
	var magnetic_wand=Tool.new()
	var playful_feedback=null
	var living=Travel.new()
	var item_actions=Actions.new()
	var firecraft=Fire.new()
	var desktop_hand=Node3D.new()
	var hands=[]
	var camera=Camera3D.new()
	var rig=Node3D.new()
	var notices=[]
	func _notice(message,_seconds=0): notices.append(message)
	func aim_source(hand): return hand
	func initialize():
		for child in [playful_encounters,cargo_playground,playful_tools,magnetic_wand,living,rig,firecraft,desktop_hand]: add_child(child)
		rig.add_child(camera); camera.position.y=1.7
		add_child(playful_encounters.court)
		add_child(cargo_playground.cargo_root)
var checks=0
var failures=[]
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func bells(game):
	for i in range(3): game.playful_encounters.bell_struck.emit(3)
func step(engine,seconds):
	for i in range(ceili(seconds/.05)): engine.tick(.05)
func _initialize(): run.call_deferred()
func run():
	var began=Time.get_ticks_usec()
	var game=Game.new(); root.add_child(game); game.initialize()
	var engine=Components.new(); game.add_child(engine); engine.setup(game); game.living.components=engine
	var relay=Relay.new(); game.add_child(relay); relay.setup(game)
	check(not relay.persistence_enabled and relay.mode=="idle","Diagnostic setup never enables real saves")
	check(relay.board.position==Vector3(2.5,1.55,7.8) and relay.board.basis.z.z<-.99,"Board faces inward and avoids the fair landing")
	check(not relay.cargo_post.root.visible and relay.cargo_post.colliders.all(func(node):return node.collision_layer==0),"Idle wayfinding post has no visible UI or invisible hit areas")
	bells(game); check(relay.ring_hits==0,"Idle bell strikes cannot bank future progress")
	relay.act("visit"); check(relay.mode=="idle" and game.living.destinations.size()==1,"Visit only shows board without starting")
	relay.act("practice"); relay.tick(1)
	check(relay.mode=="running" and not relay.timed,"Practice starts untimed")
	check(relay.cargo_post.root.visible and relay.cargo_post.colliders.size()==3,"Active cargo has exactly three wayfinding buttons")
	game.firecraft.holding=true; await relay.act("next")
	check(game.living.destinations.size()==1,"Firecraft grip blocks travel even outside shared held dictionary")
	game.firecraft.holding=false
	relay.act("timed"); check(not relay.timed and relay.elapsed==1,"Repeated start cannot silently reset or switch current run")
	bells(game); check(relay.stage==1 and relay.ring_hits==3 and not relay.cargo_armed,"Three fresh visible-gold strikes advance without changing Bellworks")
	relay.tick(.1); check(relay.stage==1,"Pre-existing cargo completion cannot satisfy new leg")
	var hand=Node3D.new(); game.add_child(hand); game.magnetic_wand.holder=hand
	await relay.act("next")
	check(game.cargo_playground.resets==0,"Held tool prevents destructive reset and travel")
	game.magnetic_wand.holder=null
	await relay.act("next"); await relay.act("next")
	check(game.cargo_playground.resets==1 and relay.cargo_armed,"NEXT explicitly resets ready cargo once; repeated NEXT preserves work")
	game.cargo_playground.state.rounds=5; game.cargo_playground.can_launch=true; game.cargo_playground.launched=true; relay.tick(.1)
	check(relay.stage==2 and game.living.destinations.size()==3,"Fresh cargo completion advances without automatic teleport")
	relay.act("next"); relay.act("next")
	check(game.living.publishes==1 and relay.preparing,"Duplicate NEXT cannot publish twice while awaiting response")
	await process_frame; await process_frame
	await relay.act("next")
	check(game.living.publishes==1 and game.living.wanted.has(Relay.GARDEN),"Wanted garden waits for ready without republishing")
	var package=game.living.wanted[Relay.GARDEN]
	var stage_root=Node3D.new(); game.add_child(stage_root)
	var built=engine.build(package,stage_root); engine.activate(built); game.living.active[Relay.GARDEN]=built
	step(engine,.2)
	var e=built.entities
	# An already-held light and old bell note must not count on first bind.
	e["glow-pebble"].node.global_position=e["sun-bud"].node.global_position+Vector3.UP*.4
	hand.global_position=e["glow-pebble"].node.global_position; engine.try_grab(hand)
	e.handbell.node.global_position=e["song-bud"].node.global_position+Vector3.UP*.4
	engine._stimulus(e.handbell,"sound",6); step(engine,.1)
	relay.tick(.1); relay.tick(.1)
	check(not relay.light_done and not relay.sound_done,"Held-before-bind light and pre-stage sound cannot complete leg")
	relay._refresh()
	check(relay.garden_post.root.get_parent()==built.root and relay.garden_post.root.visible,"Garden route post belongs to active package root")
	engine.release(hand); relay.tick(.1)
	hand.global_position=e["glow-pebble"].node.global_position; engine.try_grab(hand); relay.tick(.1)
	check(relay.light_done and not relay.sound_done,"New physical grip presentation satisfies light independently of objective")
	engine.release(hand)
	hand.global_position=e.handbell.node.global_position; engine.try_grab(hand); relay.tick(.1)
	check(not relay.sound_done,"Holding silent bell with an old stimulus does not satisfy fresh song")
	# Objectives are intentionally already complete; new sensory play still counts.
	for id in ["sun-bud","song-bud"]: e[id].state.complete=true
	engine.trigger(hand,null); step(engine,.1); relay.tick(.1)
	check(relay.mode=="complete" and relay.state.medal and relay.state.completions==1,"Real held handbell trigger completes practice even in completed garden")
	check(relay.state.timedCompletions==0 and relay.state.bestSeconds==0,"Practice awards medal without a timed record")
	var completed=relay.progress_snapshot(); relay.tick(2); bells(game)
	check(relay.progress_snapshot()==completed,"Completion is idempotent and ignores later hits")
	engine.release(hand)
	relay.act("timed"); relay.tick(10); bells(game)
	check(not relay.cargo_armed,"A new run requires a fresh cargo delivery again")
	await relay.act("next"); game.cargo_playground.state.rounds+=1; relay.tick(.1)
	check(relay.stage==2 and game.living.publishes==1,"Existing garden is reused without publishing or resetting")
	var before_complete=e["sun-bud"].state.complete
	relay.light_done=true; relay.sound_done=true; relay.tick(.1)
	check(relay.state.timedCompletions==1 and relay.state.bestSeconds>10,"Optional completed clock records a positive personal best")
	check(e["sun-bud"].state.complete==before_complete,"Relay does not erase garden objectives")
	var achievement=relay.progress_snapshot(); relay.act("restart"); relay.tick(3); relay.act("abandon")
	check(relay.mode=="idle" and relay.elapsed==0 and relay.progress_snapshot()==achievement,"Restart and abandon discard transient run but preserve achievements")
	check(not relay.garden_post.root.visible and relay.garden_post.colliders.all(func(node):return node.collision_layer==0),"Abandon removes garden post interaction without removing garden")
	relay.act("timed"); relay.stage=2; relay.elapsed=99
	check(relay.restore_progress(achievement) and relay.mode=="idle" and not relay.timed and relay.stage==0,"Restoring achievements never resumes an old run or timer")
	check(not Relay._valid(null) and not Relay._valid([]) and not Relay._valid("invalid"),"Validator rejects nonobjects safely")
	for value in [NAN,INF,-1,604801,"5",true]:
		var invalid=achievement.duplicate(); invalid.bestSeconds=value
		check(not Relay._valid(invalid),"Reject invalid best seconds "+str(value))
	var invalid=achievement.duplicate(); invalid.medal=false; check(not Relay._valid(invalid),"Medal must agree with completions")
	invalid=achievement.duplicate(); invalid.timedCompletions=invalid.completions+1; check(not Relay._valid(invalid),"Timed count cannot exceed completions")
	invalid=achievement.duplicate(); invalid.stage=2; check(not Relay._valid(invalid),"Persistence rejects transient run fields")
	check(Relay._valid(JSON.parse_string(JSON.stringify(achievement))),"JSON numeric round trip validates")
	# Atomic recovery fixtures live only in OS TEMP, never the normal save namespace.
	var fixture=OS.get_environment("TEMP").path_join("brann-festival-"+str(Time.get_ticks_usec()))
	DirAccess.make_dir_recursive_absolute(fixture)
	relay.save_path=fixture.path_join("relay.json"); relay.persistence_enabled=true
	check(relay.save_progress(),"Validated fixture save succeeds")
	relay.state.revision+=1; relay.state.completions+=1
	check(relay.save_progress(),"Second save preserves previous valid backup")
	var file=FileAccess.open(relay.save_path,FileAccess.WRITE); file.store_string("broken"); file.close()
	relay.state=Relay.fresh_state(); relay.load_progress()
	check(relay.state==achievement,"Corrupt primary recovers validated prior backup")
	var recovered=achievement.duplicate(); recovered.revision+=2
	file=FileAccess.open(relay.save_path+".tmp",FileAccess.WRITE); file.store_string(JSON.stringify(recovered)); file.close()
	relay.load_progress(); check(relay.state.revision==recovered.revision,"Highest valid interrupted temporary save wins recovery")
	for suffix in ["",".tmp",".bak"]: DirAccess.remove_absolute(relay.save_path+suffix)
	DirAccess.remove_absolute(fixture)
	relay.persistence_enabled=false
	relay.act("practice"); engine.deactivate(built); relay._refresh()
	check(not relay.garden_post.root.visible and relay.garden_post.colliders.all(func(node):return node.collision_layer==0),"Inactive garden never leaves a hidden post collision behind")
	built.root.free(); relay._refresh()
	check(not is_instance_valid(relay.garden_post.root),"Garden retirement frees its post without orphan objects")
	game.free()
	await process_frame
	print("FESTIVAL_RELAY_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
