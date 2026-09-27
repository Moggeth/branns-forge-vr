extends SceneTree
const Echo=preload("res://echo_bells.gd")
class Adventure:
	extends Node
	var zone_groups={}
	var formation={}
	var pulses=[]
	func haptic(_hand,event): pulses.append(event)
class Living:
	extends Node
	var destinations=[]
	var holding=false
	func safe_travel(destination): destinations.append(destination); return true
	func busy(_hand): return holding
class Game:
	extends Node3D
	var diagnostic_offline=true
	var smoke=false
	var held={}
	var adventure=Adventure.new()
	var living=Living.new()
	var camera=Camera3D.new()
	var desktop_hand=Node3D.new()
	var hands=[]
	var notices=[]
	func initialize():
		for child in [adventure,living,camera,desktop_hand]: add_child(child)
		var zone=Node3D.new(); add_child(zone); adventure.zone_groups.forge_yard=zone
	func _notice(message,_seconds=0): notices.append(message)
var checks=0
var failures=[]
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func listen(echo):
	for i in range(160):
		if echo.mode!="playing": return
		echo.tick(.05)
func answer(echo):
	var notes=echo.sequence.duplicate()
	for note in notes: echo.act("note"+str(note))
func _initialize(): run.call_deferred()
func run():
	var began=Time.get_ticks_usec()
	var game=Game.new(); root.add_child(game); game.initialize()
	var echo=Echo.new(); game.add_child(echo); echo.setup(game); echo.rng.seed=104
	check(echo.mode=="idle" and not echo.persistence_enabled,"Diagnostic setup is idle and cannot access normal save")
	check(echo.players.size()==3 and echo.glows.size()==3,"Exactly three pooled tone voices and visual note cues")
	check(echo.players.all(func(player):return player.stream is AudioStreamWAV and player.stream.data.size()==13230),"All three bounded audible note streams are present")
	check(echo.label.font_size*echo.label.pixel_size>=.09,"Main instructions meet physical readable glyph minimum")
	echo.act("visit"); check(echo.mode=="idle" and game.living.destinations[-1]==Echo.LANDING,"Visit safely arrives without starting")
	echo.act("note0"); check(echo.state==Echo.fresh_state(),"Free bell play cannot award progress")
	echo.act("practice")
	check(echo.sequence.size()==2 and echo.sequence[0]!=echo.sequence[1] and echo.mode=="playing","New generated phrase starts with two distinct consecutive notes")
	var phrase=echo.sequence.duplicate(); echo.act("note"+str(phrase[0]))
	check(echo.answer_index==0 and echo.mode=="playing","Clicks during presentation cannot answer early")
	echo.tick(.7)
	check(echo.cue_index==1 and echo.glows[int(phrase[0])].visible and echo.cue_label.text.contains(Echo.NAMES[int(phrase[0])]),"Cue names and illuminates exactly the played note")
	listen(echo)
	check(echo.mode=="answering" and echo.answer_index==0,"After full presentation response opens with no automatic answers")
	echo.tick(1000)
	check(echo.mode=="answering","Unlimited thinking time cannot fail an answer")
	answer(echo)
	check(echo.sequence.size()==3 and echo.sequence.slice(0,2)==phrase and echo.state.bestLength==2 and echo.state.bestUnassistedLength==2,"Correct phrase grows by one while preserving melody prefix and honest partial record")
	listen(echo); echo.act("note"+str((int(echo.sequence[0])+1)%3))
	check(echo.mode=="failed" and echo.state.bestLength==2 and echo.assisted,"Wrong note waits for retry and cannot improve record")
	var retry_phrase=echo.sequence.duplicate(); echo.act("retry")
	check(echo.sequence==retry_phrase and echo.assisted and echo.answer_index==0,"Retry preserves exact phrase but starts assisted response fresh")
	listen(echo); answer(echo); listen(echo); answer(echo); listen(echo); answer(echo)
	check(echo.mode=="complete" and echo.state.medal and echo.state.completions==1 and echo.state.bestLength==5,"Success through lengths2..5 earns one medal completion")
	check(echo.state.bestUnassistedLength==2,"Retry run cannot inflate first-listen record")
	var record=echo.progress_snapshot(); echo.act("note1"); echo.act("retry")
	check(echo.progress_snapshot()==record,"Extra bells and retry after completion cannot farm medals")
	echo.act("new_round"); echo.act("replay")
	check(echo.assisted and echo.mode=="playing","Explicit Replay melody marks assistance")
	echo.act("new_round")
	for i in range(4): listen(echo); answer(echo)
	check(echo.state.bestUnassistedLength==5 and echo.state.completions==2,"Fresh unassisted concert earns true five-note record")
	var retained=echo.progress_snapshot(); echo.act("abandon")
	check(echo.mode=="idle" and echo.sequence.is_empty() and echo.progress_snapshot()==retained,"Abandon removes transient melody and preserves achievements")
	# Use physical clapper grip/pull/release to answer a genuine new phrase.
	echo.act("new_round"); listen(echo)
	var hand=Node3D.new(); game.add_child(hand); var first=int(echo.sequence[0]); hand.global_position=echo.clappers[first].global_position
	check(not echo.try_grab(hand,true),"Desktop grip does not steal click-based bell input")
	game.living.holding=true; check(not echo.try_grab(hand),"Existing other-system hand ownership rejects clapper grab"); game.living.holding=false
	check(echo.try_grab(hand) and echo.busy(hand),"Free VR hand grips reachable clapper")
	hand.position+=Vector3.DOWN*.05; echo.tick(.02); echo.release(hand)
	check(echo.answer_index==0,"Short accidental pull below10cm does not ring")
	echo.tick(.2); hand.global_position=echo.clappers[first].global_position; echo.try_grab(hand)
	hand.position+=Vector3.DOWN*.12; echo.tick(.02)
	check(echo.pull_armed and echo.pull.length()<=.18 and echo.answer_index==0,"Clapper visibly moves within bounds and waits for release")
	check(echo.release(hand) and echo.answer_index==1 and not echo.busy(hand),"Release after deliberate physical pull answers one note")
	check(not echo.release(hand) and echo.answer_index==1,"Duplicate grip release cannot ring twice")
	var second=int(echo.sequence[1]); hand.global_position=echo.clappers[second].global_position; echo.try_grab(hand)
	hand.position+=Vector3.DOWN*.12; echo.release(hand)
	check(echo.mode=="playing" and echo.sequence.size()==3,"Fast pull/release in a single frame samples live hand displacement")
	listen(echo); hand.global_position=echo.clappers[int(echo.sequence[0])].global_position; echo.try_grab(hand)
	hand.position+=Vector3.RIGHT*.7; echo.tick(.02)
	check(not echo.busy(hand) and echo.answer_index==0,"Escaped hand disengages safely without a phantom note")
	hand.global_position=echo.clappers[int(echo.sequence[0])].global_position; echo.try_grab(hand); hand.position+=Vector3.DOWN*.12; echo.tick(.02)
	echo.restore_progress(retained)
	check(echo.mode=="idle" and echo.holder==null and echo.held_bell==-1 and echo.sequence.is_empty() and not echo.pull_armed,"Restoring durable progress clears actual held clapper and pending note")
	check(echo.clappers.all(func(node):return node.position.is_equal_approx(Vector3(0,-.65,.2))),"Restoration returns all clappers home immediately")
	game.living.holding=true; var travels=game.living.destinations.size(); echo.act("visit")
	check(game.living.destinations.size()==travels,"Travel rejects tools held in actual desktop hand"); game.living.holding=false
	check(not Echo._valid(null) and not Echo._valid([]) and not Echo._valid("record"),"Validator safely rejects nonobjects")
	for value in [-1,1,6,2.5,NAN,INF,true,"5"]:
		var invalid=retained.duplicate(); invalid.bestLength=value; check(not Echo._valid(invalid),"Invalid best length rejected: "+str(value))
	var invalid=retained.duplicate(); invalid.sequence=[0,1]; check(not Echo._valid(invalid),"Saved transient phrase is rejected")
	invalid=retained.duplicate(); invalid.medal=false; check(not Echo._valid(invalid),"Medal must match five-note completion")
	invalid=Echo.fresh_state(); invalid.bestLength=3; invalid.bestUnassistedLength=4; check(not Echo._valid(invalid),"Unassisted best cannot exceed any best")
	check(Echo._valid(JSON.parse_string(JSON.stringify(retained))),"JSON numeric round trip preserves strict valid achievements")
	var bare=Echo.new(); check(bare.restore_progress(retained) and bare.mode=="idle","Adapter can restore without visual setup"); bare.free()
	var fixture=OS.get_environment("TEMP").path_join("brann-echo-"+str(Time.get_ticks_usec())); DirAccess.make_dir_recursive_absolute(fixture)
	echo.save_path=fixture.path_join("echo.json"); echo.persistence_enabled=true
	check(echo.save_progress(),"Validated achievements atomically save to isolated TEMP fixture")
	echo.state.revision+=1; check(echo.save_progress(),"Second fixture save preserves validated backup")
	var file=FileAccess.open(echo.save_path,FileAccess.WRITE); file.store_string("broken"); file.close()
	echo.state=Echo.fresh_state(); echo.load_progress()
	check(echo.state==retained,"Corrupt primary recovers prior valid earned record")
	var interrupted=retained.duplicate(); interrupted.revision+=3
	file=FileAccess.open(echo.save_path+".tmp",FileAccess.WRITE); file.store_string(JSON.stringify(interrupted)); file.close()
	echo.load_progress(); check(echo.state.revision==interrupted.revision,"Highest valid temporary snapshot recovers interrupted write")
	for suffix in ["",".tmp",".bak"]: DirAccess.remove_absolute(echo.save_path+suffix)
	DirAccess.remove_absolute(fixture); echo.persistence_enabled=false
	await physics_frame
	var hit=game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(Echo.LANDING+Vector3.UP*2,Echo.LANDING-Vector3.UP,1))
	check(not hit.is_empty() and hit.normal.y>.9,"Pocket arrival has real walkable floor")
	var shape=CapsuleShape3D.new(); shape.radius=.22; shape.height=1.65
	var query=PhysicsShapeQueryParameters3D.new(); query.shape=shape; query.collision_mask=1; query.transform=Transform3D(Basis.IDENTITY,Echo.LANDING+Vector3.UP*.92)
	check(game.get_world_3d().direct_space_state.intersect_shape(query,1).is_empty(),"Pocket arrival has clear standing capsule space")
	game.free(); await process_frame
	print("ECHO_BELLS_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
