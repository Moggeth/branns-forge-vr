extends SceneTree
const Session=preload("res://demo_session.gd")
class Toy:
	extends Node
	var reward=""
	var mode=1
	var accent=StandardMaterial3D.new()
	var title=Label3D.new()
	func _init(): add_child(title)
	func _home(): pass
	func unlock_reward(id): reward=id
class FakeLiving:
	extends Node3D
	var active={}
	var wanted={}
	var cached_states={}
	var version_states={}
	var updating=false
	var can_travel=true
	var travels=[]
	var components
	var archive_syncs=0
	func _demo_archive_sync(): archive_syncs+=1
	func safe_travel(destination)->bool:
		if can_travel: travels.append(destination)
		return can_travel
	func _retire(id):
		var built=active[id]; cached_states[id]={"state":components.serialize(built),"version":1}
		components.deactivate(built); built.root.free(); active.erase(id)
class FakeActions:
	extends RefCounted
	var falling=false
	func move_rig(_value): return 1.0
class FakeGame:
	extends Node3D
	var diagnostic_offline=true
	var smoke=false
	var vr=false
	var lab_mode=false
	var playful_encounters
	var cargo_playground
	var tuning
	var living
	var playful_tools
	var magnetic_wand=null
	var camera
	var rig
	var qol=null
	var item_actions=FakeActions.new()
	var notices=[]
	func _notice(message,_duration=0): notices.append(message)
var checks=0
var failures=[]
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func _initialize(): run.call_deferred()
func make_game():
	var game=FakeGame.new(); root.add_child(game)
	game.playful_encounters=preload("res://playful_encounters.gd").new(); game.add_child(game.playful_encounters); game.playful_encounters.game=game
	game.cargo_playground=preload("res://cargo_playground.gd").new(); game.add_child(game.cargo_playground); game.cargo_playground.game=game
	game.tuning=preload("res://tuning_runtime.gd").new(); game.add_child(game.tuning); game.tuning.setup(game)
	game.playful_tools=Toy.new(); game.add_child(game.playful_tools)
	game.rig=Node3D.new(); game.add_child(game.rig); game.rig.position=Vector3(120,0,-84)
	game.camera=Camera3D.new(); game.rig.add_child(game.camera); game.camera.position.y=1.7
	game.living=FakeLiving.new(); game.add_child(game.living)
	game.living.components=preload("res://living_components.gd").new(); game.living.add_child(game.living.components); game.living.components.setup(game)
	return game
func activate(game,session,id):
	var manifest=session.manifests[id].duplicate(true)
	var built=game.living.components.build(manifest,game.living); built.manifest=manifest
	game.living.components.activate(built); game.living.active[id]=built; game.living.wanted[id]=manifest
	return built
func run():
	var began=Time.get_ticks_usec()
	var folder=OS.get_environment("TEMP").replace("\\","/").path_join("brann-demo-session-"+str(OS.get_process_id())+"-"+str(Time.get_ticks_usec()))
	var game=make_game(); var session=Session.new(); game.add_child(session); session.setup(game,folder)
	check("user://BellworksDemo".is_absolute_path() and session._allowed_directory("user://BellworksDemo"),"Canonical user namespace passes string-only path guards without reading or writing it")
	check(session.enabled and session.writable,"Explicit test fixture enables persistence while game remains diagnostic")
	check(game.diagnostic_offline and not game.playful_encounters.persistence_enabled and not game.cargo_playground.persistence_enabled,"Demo adapter never enables real Bellworks or cargo saves")
	check(session._valid(session._capture()),"Fresh snapshot passes strict payload validation")
	session.tick(1.1)
	check(FileAccess.file_exists(folder.path_join("progress.json")),"Fresh demo autosaves after debounce")
	var original_revision=session.saved_revision
	session.tick(2)
	check(session.saved_revision==original_revision,"Idle ticks do not repeatedly rewrite unchanged saves")
	game.playful_encounters.state={"schema":1,"revision":5,"discovered":true,"stage":3,"notes":[0,1,2],"melody":4,"gold":3,"ready":true,"claimed":true,"wins":1}
	game.cargo_playground.state={"schema":1,"revision":2,"discovered":true,"earned":true,"rounds":2}
	game.tuning.values["audio.volume"]=.42
	var lullaby=activate(game,session,"living-unfinished-lullaby")
	lullaby.entities["sun-bud"].state.complete=true; lullaby.entities["sun-bud"].state.count=1
	lullaby.entities["hearth-bud"].state.complete=true; lullaby.entities["hearth-bud"].state.count=1
	lullaby.entities["glow-pebble"].node.position=Vector3(400,300,200)
	var cinder=activate(game,session,"demo-ember-return"); cinder.entities.lantern.state.count=2
	cinder.entities.ring.node.position=Vector3(600,300,500); cinder.entities.ring.state.heat=900
	check(session.save_now(),"Snapshot saves rewards, tuning and current package outcomes")
	check(lullaby.entities.chorus.state.count==2,"First observation preserves earned live outcomes rather than clearing them")
	var payload=session._capture(); var serialized=JSON.stringify(payload)
	check(not serialized.contains("position") and not serialized.contains("manifest") and not serialized.contains("velocity") and not serialized.contains("heat"),"Payload excludes manifests, transforms, flight and heat")
	var invalid=payload.duplicate(true); invalid.packages["unowned"]={"enabled":true,"outcomes":{}}
	check(not session._valid(invalid),"Unknown package cannot enter saved state")
	invalid=payload.duplicate(true); invalid.tuning["audio.volume"]=NAN
	check(not session._valid(invalid),"Nonfinite tuning is rejected")
	invalid=payload.duplicate(true); invalid.bellworks["flight"]="held"
	check(not session._valid(invalid),"Extra untrusted outcome fields are rejected")
	game.living.wanted.erase("living-unfinished-lullaby"); game.living._retire("living-unfinished-lullaby")
	check(session.save_now(),"Archiving a garden persists its disabled status")
	check(not session.remembered["living-unfinished-lullaby"].enabled and session.remembered["living-unfinished-lullaby"].outcomes.sun==1,"Archived package keeps prior objective outcomes")
	check(not game.living.cached_states.has("living-unfinished-lullaby"),"Only demo package transient runtime snapshots are scrubbed")
	game.free()
	game=make_game(); session=Session.new(); game.add_child(session); session.setup(game,folder)
	check(game.playful_encounters.state.claimed and game.playful_tools.reward=="bellwright" and game.cargo_playground.state.earned,"New session restores earned Bellwright and Copper Gardener rewards")
	check(is_equal_approx(game.tuning.values["audio.volume"],.42),"New session restores local bounded tuning")
	check(not game.living.wanted.has("living-unfinished-lullaby") and game.living.wanted.has("demo-ember-return"),"Restore respects disabled garden and enabled Cinderloop")
	check(game.living.wanted["demo-ember-return"]==session.manifests["demo-ember-return"],"Restored manifest comes solely from canonical packaged JSON")
	lullaby=activate(game,session,"living-unfinished-lullaby"); cinder=activate(game,session,"demo-ember-return"); session.tick(.3)
	check(lullaby.entities["sun-bud"].state.complete and lullaby.entities.chorus.state.count==2,"Reactivated archived garden restores partial one-shot objectives")
	check(lullaby.entities["sun-petal-left"].node.position.is_equal_approx(Vector3(-5.72,1.39,-2)),"Partial garden leaf positions are deterministically rebuilt from canonical data")
	check(cinder.entities.lantern.state.count==2 and cinder.entities.lantern.state.power==2,"Cinderloop lantern progress and light restore together")
	check(cinder.entities.ring.node.position.is_equal_approx(Vector3(-3,1.12,7)) and cinder.entities.ring.state.heat==0,"Thrown ring position and heat start from safe canonical state")
	lullaby.entities["song-bud"].state.complete=true; lullaby.entities["song-bud"].state.count=1
	# A real completion event reaches native rules in play; simulate that outcome here.
	lullaby.entities.chorus.state.count=3; lullaby.entities.chorus.state.complete=true
	session.save_now(); game.living.wanted.erase("living-unfinished-lullaby"); game.living._retire("living-unfinished-lullaby"); session.tick(.3)
	lullaby=activate(game,session,"living-unfinished-lullaby"); session.tick(.3)
	check(lullaby.entities.chorus.state.complete and lullaby.entities.crown.state.power==1.4 and lullaby.entities["crown-light"].state.power==2,"Completed garden restores both spinning and glowing reward state")
	check(is_equal_approx(lullaby.entities.crown.node.position.y,2.6),"Completed crown is restored exactly once without repeated lifting")
	var current_revision=session.saved_revision; game.living.can_travel=false
	check(not session.reset() and game.playful_encounters.state.claimed and session.saved_revision==current_revision,"Blocked safe landing prevents destructive reset")
	game.living.can_travel=true; game.living.wanted["unrelated"]={"id":"unrelated","version":1}
	game.living.cached_states.unrelated={"keep":true}; game.tuning.dragging="audio.volume"; game.tuning.local_undo.append({"audio.volume":.42})
	check(session.reset(),"Explicit reset succeeds after safe travel")
	check(not game.playful_encounters.state.claimed and not game.cargo_playground.state.earned and game.playful_tools.reward=="","Reset clears only demo-owned challenge rewards")
	check(game.living.active.is_empty() and game.living.wanted.has("unrelated") and game.living.cached_states.has("unrelated"),"Reset retires only the two authorised demo packages")
	check(game.tuning.local_undo.is_empty() and game.tuning.dragging.is_empty() and game.tuning.values["audio.volume"]==.65,"Reset clears stale slider edits and restores tuning defaults")
	check(game.living.travels[-1]==Session.SAFE_HOME,"Reset returns to Bellworks before retiring the garden floor")
	game.free()
	# Explicit incompatible primary must block autosave until user-authorized reset.
	var file=FileAccess.open(folder.path_join("progress.json"),FileAccess.WRITE); file.store_string('{"schema":99,"kind":"bellworks-demo","revision":40,"progress":{}}'); file.close()
	game=make_game(); session=Session.new(); game.add_child(session); session.setup(game,folder)
	check(session.enabled and not session.writable and session.status_text().contains("Reset demo"),"Incompatible saves stay blocked with actionable status")
	var bytes=FileAccess.get_file_as_bytes(folder.path_join("progress.json")); session.tick(3)
	check(not session.save_now() and FileAccess.get_file_as_bytes(folder.path_join("progress.json"))==bytes,"Blocked session cannot overwrite incompatible primary")
	check(session.reset() and session.writable,"Explicit reset recovers incompatible demo namespace")
	var rejected=Session.new(); game.add_child(rejected); rejected.setup(game,"user://living_world.json")
	check(not rejected.enabled,"Adapter refuses normal-adventure save namespaces")
	game.free()
	print("DEMO_SESSION_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0," fixture=",folder)
	quit(0 if failures.is_empty() else 1)
