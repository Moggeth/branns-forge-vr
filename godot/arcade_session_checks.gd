extends SceneTree
## Real bounded store and arcade modules; fixture game never loads main or player state.
const Legacy=preload("res://demo_session_checks.gd")
const Session=preload("res://demo_session.gd")
const Bank=preload("res://bankshot_challenge.gd")
const Festival=preload("res://festival_relay.gd")
var echo_script
var gallery_script
var failures=[]
var checks=0
class Game extends Legacy.FakeGame:
	var echo_bells
	var lantern_gallery
func _initialize():run.call_deferred()
func check(ok,message):
	checks+=1
	if not ok:failures.append(message);push_error(message)
func make_game(with_arcades=true):
	var game=Game.new() if with_arcades else Legacy.FakeGame.new();root.add_child(game)
	game.playful_encounters=preload("res://playful_encounters.gd").new();game.add_child(game.playful_encounters);game.playful_encounters.game=game
	game.cargo_playground=preload("res://cargo_playground.gd").new();game.add_child(game.cargo_playground);game.cargo_playground.game=game
	game.tuning=preload("res://tuning_runtime.gd").new();game.add_child(game.tuning);game.tuning.setup(game)
	game.playful_tools=Legacy.Toy.new();game.add_child(game.playful_tools)
	game.rig=Node3D.new();game.add_child(game.rig);game.camera=Camera3D.new();game.rig.add_child(game.camera)
	game.living=Legacy.FakeLiving.new();game.add_child(game.living)
	if with_arcades:
		game.echo_bells=echo_script.new();game.add_child(game.echo_bells);game.echo_bells.game=game
		game.lantern_gallery=gallery_script.new();game.add_child(game.lantern_gallery);game.lantern_gallery.game=game
		running(game)
	return game
func attach(game,folder):
	var session=Session.new();game.add_child(session);session.setup(game,folder);return session
func idle(game)->bool:
	var echo=game.echo_bells;var gallery=game.lantern_gallery
	return echo.mode=="idle" and echo.holder==null and echo.held_bell==-1 and echo.sequence.is_empty() and echo.answer_index==0 and echo.cue_index==0 and not echo.assisted and not echo.pull_armed and not gallery.active and gallery.stage==0 and gallery.shots==0 and gallery.current_throw==-1 and gallery.motion_clock==0
func running(game):
	var echo=game.echo_bells;var gallery=game.lantern_gallery
	echo.mode="answering";echo.holder=game.camera;echo.held_bell=1;echo.sequence=[0,1,2];echo.answer_index=1;echo.cue_index=3;echo.assisted=true;echo.pull_armed=true
	gallery.active=true;gallery.stage=3;gallery.shots=17;gallery.current_throw=10;gallery.motion_clock=2.5
func run():
	var began=Time.get_ticks_usec()
	echo_script=load("res://echo_bells.gd");gallery_script=load("res://lantern_gallery.gd")
	if echo_script==null or gallery_script==null:
		push_error("Both arcade contract scripts must exist before adapter integration checks");quit(1);return
	var folder=OS.get_environment("TEMP").replace("\\","/").path_join("brann-arcade-session-"+str(OS.get_process_id())+"-"+str(began))
	var game=make_game(false);var session=attach(game,folder)
	var legacy=session._capture()
	check(session.writable and session._valid(legacy) and legacy.size()==5,"Original schema1 without optional properties remains valid")
	var records={"bankshot":Bank.fresh_state(),"festival":Festival.fresh_state(),"echoBells":echo_script.fresh_state(),"lanternGallery":gallery_script.fresh_state()}
	for mask in range(16):
		var shape=legacy.duplicate(true)
		for index in range(4):
			if mask & (1<<index):shape[records.keys()[index]]=records.values()[index].duplicate(true)
		check(session._valid(shape),"All optional subsets remain schema1-compatible: "+str(mask))
	check(session.store.save_progress(legacy),"Original payload written only to isolated TEMP fixture")
	game.free()
	game=make_game();session=attach(game,folder)
	check(game.echo_bells.state==echo_script.fresh_state() and game.lantern_gallery.state==gallery_script.fresh_state(),"Missing optional records invent no achievement")
	check(idle(game),"Loading legacy data calls both arcade restore contracts")
	var echo={"schema":1,"revision":9,"medal":true,"completions":2,"bestLength":5,"bestUnassistedLength":4}
	var gallery={"schema":1,"revision":4,"medal":true,"completions":3,"bestShots":8}
	game.echo_bells.restore_progress(echo);game.lantern_gallery.restore_progress(gallery);running(game)
	check(session.save_now(),"Earned records save during unfinished replays")
	var captured=session._capture()
	check(captured.echoBells==echo and captured.lanternGallery==gallery,"Only exact durable records enter payload")
	check(captured.echoBells.size()==6 and captured.lanternGallery.size()==5,"Transient melody, hand, stage, shots and motion excluded")
	var revision=session.saved_revision
	game.echo_bells.sequence=[2,2,1,0];game.lantern_gallery.shots=90;session.tick(.5)
	check(session.save_now() and session.saved_revision==revision,"Transient play does not rewrite achievements")
	for key in ["echoBells","lanternGallery"]:
		for invalid in [null,[],"record",false]:
			var malformed=captured.duplicate(true);malformed[key]=invalid
			check(not session._valid(malformed),"Malformed optional record rejected: "+key)
		for field in captured[key]:
			var missing=captured.duplicate(true);missing[key].erase(field)
			check(not session._valid(missing),"Required record field enforced: "+key+"."+field)
		var extra=captured.duplicate(true);extra[key].activeRun=true
		check(not session._valid(extra),"Unknown transient field rejected: "+key)
		for pair in [["schema",2],["revision",-1],["revision",100000001],["revision",1.5],["revision",true],["revision",NAN],["completions",1000001],["completions",INF],["completions","2"],["medal",false],["medal",1]]:
			var invalid=captured.duplicate(true);invalid[key][pair[0]]=pair[1]
			check(not session._valid(invalid),"Common bound/type/invariant: "+key+" "+str(pair))
	for pair in [["bestLength",1],["bestLength",4],["bestLength",6],["bestLength",2.5],["bestLength",NAN],["bestUnassistedLength",1],["bestUnassistedLength",6],["bestUnassistedLength",INF],["bestUnassistedLength","4"]]:
		var invalid=captured.duplicate(true);invalid.echoBells[pair[0]]=pair[1]
		check(not session._valid(invalid),"Echo phrase bound/invariant: "+str(pair))
	for bad in [0,5,1000001,8.5,true,"8",NAN,INF]:
		var invalid=captured.duplicate(true);invalid.lanternGallery.bestShots=bad
		check(not session._valid(invalid),"Gallery best requires finite completed six-hit round: "+str(bad))
	for length in [0,2,3,4]:
		var partial=captured.duplicate(true);partial.echoBells={"schema":1,"revision":1,"medal":false,"completions":0,"bestLength":length,"bestUnassistedLength":length}
		check(session._valid(partial),"Echo whole-phrase best may precede full completion: "+str(length))
	var impossible_echo=captured.duplicate(true);impossible_echo.echoBells={"schema":1,"revision":1,"medal":false,"completions":0,"bestLength":5,"bestUnassistedLength":4}
	check(not session._valid(impossible_echo),"Completing the fifth phrase necessarily earns the medal")
	var invalid_order=captured.duplicate(true);invalid_order.echoBells={"schema":1,"revision":1,"medal":false,"completions":0,"bestLength":2,"bestUnassistedLength":3}
	check(not session._valid(invalid_order),"Unassisted best cannot exceed overall best")
	var maxima=captured.duplicate(true)
	maxima.echoBells={"schema":1,"revision":100000000,"medal":true,"completions":1000000,"bestLength":5,"bestUnassistedLength":5}
	maxima.lanternGallery={"schema":1,"revision":100000000,"medal":true,"completions":1000000,"bestShots":1000000}
	check(session._valid(maxima),"Inclusive documented maxima accepted")
	var bytes=FileAccess.get_file_as_bytes(folder.path_join("progress.json"))
	game.lantern_gallery.state.bestShots=NAN
	check(not session.save_now() and FileAccess.get_file_as_bytes(folder.path_join("progress.json"))==bytes,"Invalid live snapshot cannot overwrite valid save")
	game.lantern_gallery.restore_progress(gallery)
	game.free()
	game=make_game();session=attach(game,folder)
	check(game.echo_bells.state==echo and game.lantern_gallery.state==gallery,"Real modules normalize JSON numbers and restore earned arcade records")
	check(idle(game),"Restore aborts actual active melodies, held clapper, gallery flight and motion")
	game.free()
	game=make_game(false);session=attach(game,folder)
	check(session._capture().echoBells==JSON.parse_string(JSON.stringify(echo)) and session._capture().lanternGallery==JSON.parse_string(JSON.stringify(gallery)),"Truly absent module properties retain loaded optional records")
	game.playful_encounters.state.discovered=true;game.playful_encounters.state.revision+=1
	check(session.save_now() and session.store.load_progress().data.echoBells.bestLength==5 and session.store.load_progress().data.lanternGallery.bestShots==8,"Unrelated save cannot erase absent-module achievements")
	check(session.reset() and session._capture().echoBells==echo_script.fresh_state() and session._capture().lanternGallery==gallery_script.fresh_state(),"Explicit reset clears remembered records even with modules absent")
	game.free()
	game=make_game();session=attach(game,folder)
	check(game.echo_bells.state==echo_script.fresh_state() and game.lantern_gallery.state==gallery_script.fresh_state(),"Cleared achievements cannot resurrect when modules return")
	game.echo_bells.restore_progress(echo);game.lantern_gallery.restore_progress(gallery);running(game)
	game.living.can_travel=false
	check(not session.reset() and game.echo_bells.holder==game.camera and game.lantern_gallery.shots==17 and game.echo_bells.state==echo,"Blocked reset preserves current runs and achievements")
	game.living.can_travel=true
	check(session.reset() and idle(game) and game.echo_bells.state==echo_script.fresh_state() and game.lantern_gallery.state==gallery_script.fresh_state(),"Successful explicit reset invokes both transient-clearing restore contracts")
	game.free();await process_frame
	print("ARCADE_SESSION_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
