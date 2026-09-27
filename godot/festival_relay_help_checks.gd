extends SceneTree
## Help-only fixture: no main scene, network or save state.
const Help=preload("res://demo_help.gd")
var failures=[]
class Relay extends Node:
	var actions=[]
	func act(action):actions.append(action)
class Game extends Node:
	var vr=false
	var festival_relay
	var notices=[]
	func _notice(message,_seconds):notices.append(message)
func _initialize():call_deferred("run")
func check(ok,message):
	if not ok:failures.append(message)
func run():
	var game=Game.new();root.add_child(game)
	game.festival_relay=Relay.new();game.add_child(game.festival_relay)
	var help=Help.new();game.add_child(help);help.setup(game)
	check(help.rows().size()==6,"Demo page remains six rows")
	var relay_rows=0
	for row in help.rows():
		check(str(row[0]).length()<=16,"Compact button labels")
		if row[1]=="demo:relay":relay_rows+=1
	check(relay_rows==1,"One discoverable relay row")
	for vr in [false,true]:
		game.vr=vr
		for action in ["ring","cargo","garden","cinderloop","relay"]:
			var message=help.hint_text(action)
			check(message.length()>0 and message.length()<210 and message.split("\n").size()<=3,"Bounded help "+action)
	check(help.act("demo:relay"),"Relay visit action handled")
	check(game.festival_relay.actions==["visit"],"Help visit never implicitly starts or abandons")
	check(str(game.notices.back()).contains("Practice or Timed"),"Explicit start choices explained")
	check(str(game.notices.back()).contains("Restart or Abandon"),"Exit/restart discoverable")
	var relay=game.festival_relay;game.festival_relay=null
	check(help.act("demo:relay") and str(game.notices.back()).contains("not ready"),"Missing optional module handled")
	game.festival_relay=relay
	check(not help.act("demo:reset") and not help.act("demo:save"),"Persistence controls remain coordinator owned")
	game.free();await process_frame
	print("FESTIVAL_RELAY_HELP_RESULT ",JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
