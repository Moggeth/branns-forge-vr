extends SceneTree
const Legacy=preload("res://demo_session_checks.gd")
const Session=preload("res://demo_session.gd")
const Bank=preload("res://bankshot_challenge.gd")
class Game extends Legacy.FakeGame:
	var bankshot=null
var count=0
var failures=[]
func check(condition,message):
	count+=1
	if not condition: failures.append(message); push_error(message)
func _initialize(): run.call_deferred()
func make_game(with_bank):
	var game=Game.new(); root.add_child(game)
	game.playful_encounters=preload("res://playful_encounters.gd").new(); game.add_child(game.playful_encounters); game.playful_encounters.game=game
	game.cargo_playground=preload("res://cargo_playground.gd").new(); game.add_child(game.cargo_playground); game.cargo_playground.game=game
	game.tuning=preload("res://tuning_runtime.gd").new(); game.add_child(game.tuning); game.tuning.setup(game)
	game.playful_tools=Legacy.Toy.new(); game.add_child(game.playful_tools)
	game.rig=Node3D.new(); game.add_child(game.rig); game.camera=Camera3D.new(); game.rig.add_child(game.camera)
	game.living=Legacy.FakeLiving.new(); game.add_child(game.living)
	game.living.components=preload("res://living_components.gd").new(); game.living.add_child(game.living.components); game.living.components.setup(game)
	if with_bank:
		game.bankshot=Bank.new(); game.add_child(game.bankshot); game.bankshot.game=game
	return game
func run():
	var began=Time.get_ticks_usec()
	var folder=OS.get_environment("TEMP").replace("\\","/").path_join("brann-bankshot-migration-"+str(OS.get_process_id())+"-"+str(Time.get_ticks_usec()))
	var game=make_game(false); var session=Session.new(); game.add_child(session); session.setup(game,folder)
	var legacy=session._capture()
	check(not legacy.has("bankshot") and session._valid(legacy),"Existing schema1 payload without bankshot stays valid")
	game.playful_encounters.state.discovered=true; game.playful_encounters.state.notes=[0]; game.playful_encounters.state.revision=1
	check(session.save_now(),"Legacy shaped fixture saves without an invented bankshot record")
	game.free()
	game=make_game(true); session=Session.new(); game.add_child(session); session.setup(game,folder)
	check(session.writable and game.playful_encounters.state.notes==[0],"New adapter restores pre-bankshot schema1 progress unchanged")
	check(game.bankshot.state==Bank.fresh_state(),"Missing optional bankshot receives an honest fresh default")
	game.bankshot.state={"schema":1,"revision":6,"discovered":true,"stage":1,"shots":2,"completed":false,"medal":true,"bestShots":3,"replays":1}
	game.bankshot.current_throw=999
	check(session.save_now(),"New save includes validated partial bankshot and earned best result")
	var data=session._capture()
	check(data.has("bankshot") and not data.bankshot.has("current_throw"),"Optional payload contains outcomes without throw identity")
	var invalid=data.duplicate(true); invalid.bankshot.bestShots=0
	check(not session._valid(invalid),"Malformed optional medal cannot enter the existing demo namespace")
	game.free()
	game=make_game(true); session=Session.new(); game.add_child(session); session.setup(game,folder)
	check(session.writable and game.bankshot.state.stage==1 and game.bankshot.state.bestShots==3 and game.bankshot.state.medal,"Next process restores partial trial, medal and best")
	check(game.bankshot.current_throw==-1 and game.bankshot.scored_throw==-1,"Old flight identity cannot score after restart")
	check(session.reset() and game.bankshot.state==Bank.fresh_state(),"Explicit demo reset also clears optional Bankshot progress")
	check(session._valid(legacy),"Adding optional field never retires original schema1 validator shape")
	game.free(); await process_frame
	print("BANKSHOT_SESSION_CHECKS checks=",count," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
