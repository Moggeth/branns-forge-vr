extends SceneTree
const Legacy=preload("res://demo_session_checks.gd")
const Session=preload("res://demo_session.gd")
const Festival=preload("res://festival_relay.gd")
const Bank=preload("res://bankshot_challenge.gd")
class Game extends Legacy.FakeGame:
	var bankshot=null
	var festival_relay=null
var checks=0
var failures=[]
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func _initialize(): run.call_deferred()
func make_game(with_festival=true,old_game=false):
	var game=Legacy.FakeGame.new() if old_game else Game.new(); root.add_child(game)
	game.playful_encounters=preload("res://playful_encounters.gd").new(); game.add_child(game.playful_encounters); game.playful_encounters.game=game
	game.cargo_playground=preload("res://cargo_playground.gd").new(); game.add_child(game.cargo_playground); game.cargo_playground.game=game
	game.tuning=preload("res://tuning_runtime.gd").new(); game.add_child(game.tuning); game.tuning.setup(game)
	game.playful_tools=Legacy.Toy.new(); game.add_child(game.playful_tools)
	game.rig=Node3D.new(); game.add_child(game.rig); game.camera=Camera3D.new(); game.rig.add_child(game.camera)
	game.living=Legacy.FakeLiving.new(); game.add_child(game.living)
	game.living.components=preload("res://living_components.gd").new(); game.living.add_child(game.living.components); game.living.components.setup(game)
	if with_festival:
		game.festival_relay=Festival.new(); game.add_child(game.festival_relay); game.festival_relay.game=game
	return game
func attach(game,folder):
	var session=Session.new(); game.add_child(session); session.setup(game,folder); return session
func running(relay):
	relay.mode="running"; relay.stage=2; relay.elapsed=42.5; relay.timed=true; relay.ring_hits=2
func idle(relay)->bool:
	return relay.mode=="idle" and relay.stage==0 and relay.elapsed==0.0 and not relay.timed and relay.ring_hits==0
func run():
	var began=Time.get_ticks_usec()
	var folder=OS.get_environment("TEMP").replace("\\","/").path_join("brann-festival-session-"+str(OS.get_process_id())+"-"+str(began))
	var game=make_game(false,true); var session=attach(game,folder)
	var legacy=session._capture()
	check(session.writable and not legacy.has("festival") and not legacy.has("bankshot") and session._valid(legacy),"Truly old game and original schema1 payload remain compatible")
	var bank_only=legacy.duplicate(true); bank_only["bankshot"]=Bank.fresh_state()
	check(session._valid(bank_only),"Bankshot-only save stays valid without Festival")
	check(session.store.save_progress(bank_only),"Bankshot-only fixture writes through real bounded store")
	game.free()
	game=make_game(); session=attach(game,folder)
	check(session.writable and game.festival_relay.state==Festival.fresh_state(),"Legacy migration starts Festival with no invented achievements")
	check(session._capture().has("bankshot"),"Absent Bankshot module preserves its existing optional record")
	var earned={"schema":1,"revision":8,"medal":true,"completions":3,"timedCompletions":2,"bestSeconds":57.25}
	check(game.festival_relay.restore_progress(earned),"Real relay accepts earned medal and timed personal best")
	running(game.festival_relay)
	check(session.save_now(),"Real store saves earned progress during an unfinished replay")
	var snapshot=session._capture()
	check(snapshot.festival==earned and snapshot.festival.size()==6,"Snapshot contains only the six durable fields, never active timer or stage")
	var revision=session.saved_revision
	game.festival_relay.elapsed=99.0; game.festival_relay.stage=3; session.tick(.5)
	check(session.save_now() and session.saved_revision==revision,"Timer and partial-stage changes cause no save or invented completion")
	var copy=game.festival_relay.progress_snapshot(); copy.medal=false
	check(game.festival_relay.state.medal,"Snapshot mutations cannot remove live medal")
	game.free()
	game=make_game(); running(game.festival_relay); session=attach(game,folder)
	check(session.writable and game.festival_relay.state==earned,"Fresh adapter restores medal, totals and timed best")
	check(idle(game.festival_relay),"Restore aborts every active relay transient")
	var valid=session._capture()
	for bad in [null,[],"festival"]:
		var data=valid.duplicate(true); data.festival=bad
		check(not session._valid(data),"Malformed optional field rejected safely: "+str(bad))
	for pair in [["revision",-1],["revision",100000001],["revision",1.5],["completions",1000001],["completions",1.5],["timedCompletions",4],["timedCompletions",-1],["bestSeconds",NAN],["bestSeconds",INF],["bestSeconds","57"],["bestSeconds",0],["bestSeconds",-1],["bestSeconds",604801],["medal",false],["schema",2]]:
		var data=valid.duplicate(true); data.festival[pair[0]]=pair[1]
		check(not session._valid(data),"Invalid Festival bound/invariant rejected: "+str(pair))
	var extra=valid.duplicate(true); extra.festival.elapsed=4
	check(not session._valid(extra),"Transient or unknown fields cannot leak into persisted relay data")
	var practice=valid.duplicate(true); practice.festival={"schema":1,"revision":1,"medal":true,"completions":1,"timedCompletions":0,"bestSeconds":0.0}
	check(session._valid(practice),"Practice earns medal without manufacturing a timed best")
	practice.festival.bestSeconds=1.0
	check(not session._valid(practice),"Untimed completion cannot claim a timed best")
	var bounds=valid.duplicate(true); bounds.festival={"schema":1,"revision":100000000,"medal":true,"completions":1000000,"timedCompletions":1000000,"bestSeconds":604800.0}
	check(session._valid(bounds),"Documented inclusive finite upper limits remain valid")
	game.free()
	game=make_game(false,true); session=attach(game,folder)
	var json_earned=JSON.parse_string(JSON.stringify(earned))
	check(session.writable and session._capture().festival==json_earned,"A game with no relay property retains optional earned data")
	game.playful_encounters.state.discovered=true; game.playful_encounters.state.revision+=1
	check(session.save_now() and session.store.load_progress().data.festival==json_earned,"Unrelated save without relay module preserves medal and best on disk")
	check(session.reset() and session._capture().festival==Festival.fresh_state(),"Explicit reset without relay module clears retained optional rewards")
	game.free()
	game=make_game(); session=attach(game,folder)
	check(session.writable and game.festival_relay.state==Festival.fresh_state(),"Later relay cannot resurrect rewards cleared while module was absent")
	game.festival_relay.restore_progress(earned); running(game.festival_relay)
	check(session.reset() and idle(game.festival_relay) and game.festival_relay.state==Festival.fresh_state(),"Successful reset aborts run and removes all relay achievements")
	game.festival_relay.restore_progress(earned); running(game.festival_relay); game.living.can_travel=false
	check(not session.reset() and game.festival_relay.state==earned and game.festival_relay.elapsed==42.5,"Unsafe reset preserves current relay run and earned medal")
	check(session._valid(legacy) and session._valid(bank_only),"Original and Bankshot-only migrations remain valid after all operations")
	game.free(); await process_frame
	print("FESTIVAL_SESSION_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
