extends "res://arcade_session_checks.gd"
## Focused audit regressions only; real bounded store in a disposable TEMP directory.
class FullGame extends Game:
	var bankshot
	var festival_relay
class FailedStore extends RefCounted:
	var status="io_error"
	var writable=true
	func save_progress(_data):return false
func make_game(_with_arcades=true):
	var game=FullGame.new();root.add_child(game)
	game.playful_encounters=preload("res://playful_encounters.gd").new();game.add_child(game.playful_encounters);game.playful_encounters.game=game
	game.cargo_playground=preload("res://cargo_playground.gd").new();game.add_child(game.cargo_playground);game.cargo_playground.game=game
	game.tuning=preload("res://tuning_runtime.gd").new();game.add_child(game.tuning);game.tuning.setup(game)
	game.playful_tools=Legacy.Toy.new();game.add_child(game.playful_tools)
	game.rig=Node3D.new();game.add_child(game.rig);game.camera=Camera3D.new();game.rig.add_child(game.camera)
	game.living=Legacy.FakeLiving.new();game.add_child(game.living)
	game.echo_bells=echo_script.new();game.add_child(game.echo_bells);game.echo_bells.game=game
	game.lantern_gallery=gallery_script.new();game.add_child(game.lantern_gallery);game.lantern_gallery.game=game
	game.festival_relay=Festival.new();game.add_child(game.festival_relay);game.festival_relay.game=game
	game.bankshot=Bank.new();game.add_child(game.bankshot);game.bankshot.game=game
	return game
func run():
	var began=Time.get_ticks_usec()
	echo_script=load("res://echo_bells.gd");gallery_script=load("res://lantern_gallery.gd")
	var folder=OS.get_environment("TEMP").replace("\\","/").path_join("brann-persistence-edges-"+str(OS.get_process_id())+"-"+str(began))
	var game=make_game();var session=attach(game,folder)
	var baseline=session._capture()
	for wrong in [null,[],{},"1",true,false,NAN,INF,-1,0,1.1,2]:
		for key in ["bankshot","festival","echoBells","lanternGallery","bellworks","cargo"]:
			var bad=baseline.duplicate(true);bad[key].schema=wrong
			check(not session._valid(bad),"Malformed schema safely rejected: "+key+" "+str(wrong))
		var bad_top=baseline.duplicate(true);bad_top.schema=wrong
		check(not session._valid(bad_top),"Malformed top-level schema safely rejected")
	for contract in [Bank,Festival,echo_script,gallery_script]:
		for wrong in [[],{},"1",true]:
			var bad=contract.fresh_state();bad.schema=wrong
			check(not contract._valid(bad),"Direct module validator is type-safe")
	check(session.reset(),"Establish fresh retained snapshots via explicit reset")
	var earned={
		"bankshot":{"schema":1,"revision":1,"discovered":true,"stage":3,"shots":4,"completed":true,"medal":true,"bestShots":4,"replays":0},
		"festival":{"schema":1,"revision":1,"medal":true,"completions":1,"timedCompletions":1,"bestSeconds":42.5},
		"echoBells":{"schema":1,"revision":1,"medal":true,"completions":1,"bestLength":5,"bestUnassistedLength":4},
		"lanternGallery":{"schema":1,"revision":1,"medal":true,"completions":1,"bestShots":8}
	}
	var properties={"bankshot":"bankshot","festival":"festival_relay","echoBells":"echo_bells","lanternGallery":"lantern_gallery"}
	for key in properties:game.get(properties[key]).state=earned[key].duplicate(true)
	check(session.save_now(),"Commit newly earned rewards after fresh reset")
	for key in earned:
		var retained=session.bankshot_saved if key=="bankshot" else session.optional_saved[key]
		check(retained==earned[key],"Successful save refreshes retained snapshot: "+key)
	# Neither a failed transaction nor a plain capture may advance the retained data.
	var actual_store=session.store;session.store=FailedStore.new()
	game.echo_bells.state.revision=2;game.echo_bells.state.completions=2
	check(not session.save_now() and session.optional_saved.echoBells==earned.echoBells,"Failed disk transaction retains only last committed rewards")
	session.store=actual_store
	game.echo_bells.state.bestLength=NAN
	check(not session.save_now() and session.optional_saved.echoBells==earned.echoBells,"Invalid snapshot cannot poison retained records")
	game.echo_bells.state=earned.echoBells.duplicate(true)
	game.echo_bells.state.completions=3;game.echo_bells.state.revision=3;session._capture()
	check(session.optional_saved.echoBells==earned.echoBells,"Read-only capture never promotes uncommitted progress")
	for key in properties:game.set(properties[key],null)
	game.cargo_playground.state.discovered=true;game.cargo_playground.state.revision+=1
	check(session.save_now(),"Unrelated save succeeds after all optional modules detach")
	var disk=session.store.load_progress().data
	for key in earned:
		check(disk[key]==JSON.parse_string(JSON.stringify(earned[key])),"Module detach preserves last committed record on disk: "+key)
	check(session.reset(),"Explicit reset clears detached records")
	for key in earned:
		check(not session._capture()[key].medal,"Detached reward remains cleared: "+key)
	# Envelope parsing occurs before payload validation; malformed JSON types must
	# also be safe here, while genuine future schema/kind stays incompatible.
	var envelope_path=folder.path_join("malformed-envelope.json")
	var wrapper={"schema":1,"kind":"bellworks-demo","revision":1,"progress":session._capture()}
	for wrong in [null,[],{},"1",true,false,1.5]:
		var malformed=wrapper.duplicate(true);malformed.schema=wrong
		write_envelope(envelope_path,malformed)
		check(actual_store._read(envelope_path).state=="corrupt","Malformed envelope schema safely classified corrupt")
	for wrong in [null,[],{},1,true,false]:
		var malformed=wrapper.duplicate(true);malformed.kind=wrong
		write_envelope(envelope_path,malformed)
		check(actual_store._read(envelope_path).state=="corrupt","Malformed envelope kind safely classified corrupt")
	for pair in [["schema",2],["kind","another-game"]]:
		var future=wrapper.duplicate(true);future[pair[0]]=pair[1];write_envelope(envelope_path,future)
		check(actual_store._read(envelope_path).state=="incompatible","Explicit incompatible envelopes remain protected")
	write_envelope(envelope_path,wrapper)
	check(actual_store._read(envelope_path).state=="valid","Current valid envelope still loads")
	# A malformed primary with no backups must block writes without exceptions.
	var broken_folder=folder.path_join("malformed-only")
	DirAccess.make_dir_recursive_absolute(broken_folder)
	var malformed=wrapper.duplicate(true);malformed.schema=[]
	write_envelope(broken_folder.path_join("progress.json"),malformed)
	var isolated=preload("res://demo_save_store.gd").new();isolated.configure(broken_folder,session._valid)
	var result=isolated.load_progress()
	check(result.status=="corrupt" and not result.writable,"Malformed primary blocks writes cleanly without a backup")
	game.free();await process_frame
	print("PERSISTENCE_EDGE_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)

func write_envelope(path,data):
	var file=FileAccess.open(path,FileAccess.WRITE)
	file.store_string(JSON.stringify(data));file.close()
