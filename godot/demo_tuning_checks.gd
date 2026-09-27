extends SceneTree
## Standalone demo slider/help checks; adapter writes are mocked and no state files touched.
const Tuner=preload("res://tuning_runtime.gd")
const Help=preload("res://demo_help.gd")
var failures=[]
class Qol extends Node:
	var builds=0
	var opened=false
	var page="demo"
	func _build(): builds+=1
class Adapter extends Node:
	var game
	var calls=0
	var succeeds=true
	var saved={}
	func save_now()->bool:
		calls+=1
		saved=game.tuning.values.duplicate()
		return succeeds
	func status_text()->String:return "Save failed; session changes remain active."
class Museum extends Node:
	var entered=false
	func act(action):entered=action=="enter"
class Living extends Node:
	var museum=Museum.new()
class Game extends Node:
	var lab_mode=false
	var diagnostic_offline=true
	var vr=false
	var qol=Qol.new()
	var tuning
	var demo_session=Adapter.new()
	var living=Living.new()
	var playful_tools=null
	var magnetic_wand=null
	var notices=[]
	var requests=0
	func _notice(text,_seconds=0):notices.append(text)
	func _request(_url,_body):requests+=1;return {}
func _initialize():call_deferred("run")
func check(ok,message):
	if not ok:failures.append(message)
func run():
	check(OS.get_cmdline_user_args().has("--playful-demo"),"Runner must exercise the real demo commit branch")
	var game=Game.new();root.add_child(game)
	for child in [game.qol,game.demo_session,game.living]:game.add_child(child)
	game.living.add_child(game.living.museum)
	game.demo_session.game=game
	var tuner=Tuner.new();game.add_child(tuner);game.tuning=tuner;tuner.setup(game)
	check(tuner.schema.size()==Tuner.DEFAULTS.size(),"Offline setup loads every slider bound")
	check(tuner.schema["playful.magnet_pull"].min==10 and tuner.schema["playful.magnet_pull"].max==22,"Offline sliders use actual packaged range")
	check(tuner.revision==0,"Offline slider revision starts usable")
	tuner.dragging="playful.magnet_pull";tuner.draft_value=14;tuner.drag_revision=0
	tuner.slider_input(null,false)
	check(tuner.value("playful.magnet_pull")==14,"Actual slider release updates local setting")
	check(game.demo_session.calls==1 and game.demo_session.saved["playful.magnet_pull"]==14,"Adapter observes applied value before saving")
	check(tuner.revision==1 and tuner.local_undo.size()==1,"Successful local edit records revision and undo")
	var prior=tuner.values.duplicate()
	for invalid in ["14",true,NAN,INF,9,23]:
		tuner.commit({"values":{"playful.ring_gravity":2,"playful.magnet_pull":invalid}})
		check(tuner.values==prior,"Invalid batch must be atomic")
	tuner.commit({"values":{"vfx.spark_count":2.5}})
	tuner.commit({"values":{"unknown.setting":1}})
	tuner.commit({"values":{"playful.magnet_pull":12},"expectedRevision":0})
	tuner.commit({"values":{"playful.magnet_pull":12},"action":"undo"})
	check(tuner.values==prior and tuner.local_undo.size()==1 and game.demo_session.calls==1,"Rejected input cannot mutate undo or persist")
	tuner.commit({"action":"undo","expectedRevision":1})
	check(tuner.value("playful.magnet_pull")==22 and tuner.revision==2,"Undo restores original value with a new revision")
	check(game.demo_session.saved["playful.magnet_pull"]==22,"Undo result is saved through adapter")
	tuner.commit({"action":"undo"})
	check(game.demo_session.calls==2,"Empty undo does not claim a save")
	game.demo_session.succeeds=false
	tuner.commit({"values":{"playful.magnet_pull":12}})
	check(tuner.value("playful.magnet_pull")==12 and str(game.notices.back()).contains("Save failed"),"Failed persistence retains session value and truthful status")
	var adapter=game.demo_session;game.demo_session=null
	tuner.commit({"values":{"playful.magnet_pull":13}})
	check(str(game.notices.back()).contains("for this session"),"Missing adapter admits reset-on-exit fallback")
	for i in range(30):tuner.commit({"values":{"playful.magnet_pull":10+float(i%12)}})
	check(tuner.local_undo.size()<=20,"Demo undo history is bounded")
	check(game.requests==0,"Offline local edits make no service requests")
	var help=Help.new();game.add_child(help);help.setup(game)
	check(help.rows().size()==6,"Help leaves two palm rows for root save/reset")
	for row in help.rows():check(str(row[0]).length()<=16,"Help button label remains compact")
	for action in ["ring","cargo","garden","cinderloop"]:
		check(help.act(action),"Help action handled "+action)
		check(help.hint_text(action).split("\n").size()<=3 and help.hint_text(action).length()<210,"Help notice remains bounded "+action)
	check(help.hint_text("cargo").contains("X flings"),"Desktop help uses desktop fling control")
	game.vr=true;check(help.hint_text("cargo").contains("A flings"),"VR help uses controller fling control")
	help.act("demo:archive");check(game.living.museum.entered,"Archive button reuses existing route")
	help.act("demo:tuning");check(game.qol.page=="tuning" and tuner.group_filter=="playful","Help opens existing playful tuning group")
	check(not help.act("demo:save") and not help.act("demo:reset"),"Save/reset remain coordinator owned")
	game.demo_session=adapter
	game.free();await process_frame
	print("DEMO_TUNING_RESULT ",JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
