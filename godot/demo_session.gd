extends Node
## Explicit standalone-demo persistence. Never restores manifests or transient physics.
const PACKAGE_FILES={"living-unfinished-lullaby":"res://living_unfinished_lullaby.json","demo-ember-return":"res://living_returning_demo.json"}
const BELL_FIELDS=["schema","revision","discovered","stage","notes","melody","gold","ready","claimed","wins"]
const CARGO_FIELDS=["schema","revision","discovered","earned","rounds"]
const OPTIONAL_PROGRESS={
	"emberGallery":["ember_gallery","res://ember_gallery.gd"],
	"festival":["festival_relay","res://festival_relay.gd"],
	"echoBells":["echo_bells","res://echo_bells.gd"],
	"lanternGallery":["lantern_gallery","res://lantern_gallery.gd"]
}
const SAFE_HOME=Vector3(120,0,70)
var game
var enabled=false
var writable=false
var store
var manifests={}
var tuning_schema={}
var remembered={}
var applied={}
var clock=0.0
var due=-1.0
var next_sample=0.0
var saved_signature=""
var observed_signature=""
var status="disabled"
var saved_revision=0
var bankshot_saved={}
var optional_saved={}
var optional_scripts={}

func setup(owner_game,directory:String):
	game=owner_game
	if not game.diagnostic_offline or not _allowed_directory(directory): status="invalid_directory"; return
	tuning_schema=JSON.parse_string(FileAccess.get_file_as_string("res://tuning_schema.json"))
	for id in PACKAGE_FILES:
		var manifest=JSON.parse_string(FileAccess.get_file_as_string(PACKAGE_FILES[id]))
		if not manifest is Dictionary or manifest.get("id")!=id or int(manifest.get("version",0))!=1: status="invalid_manifest"; return
		manifests[id]=manifest
	var script=load("res://demo_save_store.gd")
	if script==null: status="store_unavailable"; return
	store=script.new()
	if not store.configure(directory,_valid): status="invalid_directory"; return
	enabled=true
	var result=store.load_progress(); status=str(result.get("status","io_error")); writable=bool(result.get("writable",false)); saved_revision=int(result.get("revision",0))
	var data=result.get("data",{})
	if writable and data is Dictionary and not data.is_empty():
		_restore(data)
	else: remembered=_fresh_packages()
	if writable:
		var current=_capture(); saved_signature=JSON.stringify(current) if status!="missing" else ""; observed_signature=JSON.stringify(current)
		if status=="missing": due=clock+1
	print("DEMO_SESSION status=",status," writable=",writable," revision=",saved_revision)

func _allowed_directory(directory:String)->bool:
	if directory in ["user://BellworksDemo","user://EmberGalleryDemo"]: return true
	var absolute=ProjectSettings.globalize_path(directory).replace("\\","/").simplify_path()
	var testing=false
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--demo-persistence-check=") or argument=="--demo-session-check": testing=true
	var temporary=OS.get_environment("TEMP").replace("\\","/").simplify_path().trim_suffix("/")
	return testing and not temporary.is_empty() and absolute.begins_with(temporary+"/") and absolute!=temporary

func _fresh_packages()->Dictionary:
	return {"living-unfinished-lullaby":{"enabled":false,"outcomes":{"sun":0,"hearth":0,"song":0}},"demo-ember-return":{"enabled":false,"outcomes":{"hits":0}}}

func _defaults()->Dictionary:
	var values={}
	for key in tuning_schema:
		if game.tuning.DEFAULTS.has(key): values[key]=tuning_schema[key].get("default",game.tuning.DEFAULTS[key])
	return values

func _fresh()->Dictionary:
	var data={"schema":1,"bellworks":game.playful_encounters.fresh_state(),"cargo":{"schema":1,"revision":0,"discovered":false,"earned":false,"rounds":0},"tuning":_defaults(),"packages":_fresh_packages()}
	if game.get("bankshot")!=null or not bankshot_saved.is_empty(): data["bankshot"]=preload("res://bankshot_challenge.gd").fresh_state()
	for key in OPTIONAL_PROGRESS:
		if game.get(OPTIONAL_PROGRESS[key][0])!=null or optional_saved.has(key): data[key]=_optional_script(key).fresh_state()
	return data

func _optional_script(key:String):
	# Paths come only from the fixed registry, never from saved data.
	if not optional_scripts.has(key): optional_scripts[key]=load(OPTIONAL_PROGRESS[key][1])
	return optional_scripts[key]

func _only(value,keys:Array)->bool:
	return value is Dictionary and value.size()==keys.size() and value.keys().all(func(key):return key in keys)

func _integer(value,maximum)->bool:
	return (value is int or value is float) and is_finite(float(value)) and value>=0 and value<=maximum and float(value)==floor(float(value))

func _valid(data:Dictionary)->bool:
	var allowed=["schema","bellworks","cargo","tuning","packages"]
	if data.has("bankshot"): allowed.append("bankshot")
	for key in OPTIONAL_PROGRESS:
		if data.has(key): allowed.append(key)
	if not _only(data,allowed) or not _integer(data.get("schema"),1) or data.schema!=1: return false
	if data.has("bankshot") and not preload("res://bankshot_challenge.gd")._valid(data.bankshot): return false
	for key in OPTIONAL_PROGRESS:
		if data.has(key):
			var script=_optional_script(key)
			if script==null or not script._valid(data[key]): return false
	if not _only(data.bellworks,BELL_FIELDS) or not _integer(data.bellworks.get("schema"),1) or data.bellworks.schema!=1 or not game.playful_encounters._valid(data.bellworks): return false
	if not _only(data.cargo,CARGO_FIELDS) or not _integer(data.cargo.get("schema"),1) or data.cargo.schema!=1 or not game.cargo_playground._valid(data.cargo): return false
	if not data.tuning is Dictionary or data.tuning.size()>tuning_schema.size(): return false
	for key in data.tuning:
		if not tuning_schema.has(key) or not game.tuning.DEFAULTS.has(key): return false
		var number=data.tuning[key]; var spec=tuning_schema[key]
		if not (number is int or number is float) or not is_finite(float(number)) or number<spec.min or number>spec.max: return false
		if spec.get("type","")=="integer" and float(number)!=floor(float(number)): return false
	if not _only(data.packages,PACKAGE_FILES.keys()): return false
	for id in PACKAGE_FILES:
		var item=data.packages[id]
		if not _only(item,["enabled","outcomes"]) or not item.enabled is bool: return false
		var keys=["sun","hearth","song"] if id=="living-unfinished-lullaby" else ["hits"]
		if not _only(item.outcomes,keys): return false
		for key in keys:
			if not _integer(item.outcomes[key],1 if id=="living-unfinished-lullaby" else 3): return false
	return true

func _select(value,fields:Array)->Dictionary:
	var selected={}
	for field in fields: selected[field]=value[field]
	return selected.duplicate(true)

func _capture()->Dictionary:
	_capture_outcomes()
	var settings={}
	for key in tuning_schema:
		if game.tuning.DEFAULTS.has(key): settings[key]=game.tuning.values.get(key,game.tuning.DEFAULTS[key])
	var data={"schema":1,"bellworks":_select(game.playful_encounters.state,BELL_FIELDS),"cargo":_select(game.cargo_playground.state,CARGO_FIELDS),"tuning":settings,"packages":remembered.duplicate(true)}
	if game.get("bankshot")!=null: data["bankshot"]=game.bankshot.progress_snapshot()
	elif not bankshot_saved.is_empty(): data["bankshot"]=bankshot_saved.duplicate(true)
	for key in OPTIONAL_PROGRESS:
		var module=game.get(OPTIONAL_PROGRESS[key][0])
		if module!=null: data[key]=module.progress_snapshot()
		elif optional_saved.has(key): data[key]=optional_saved[key].duplicate(true)
	return data

func _capture_outcomes():
	for id in PACKAGE_FILES:
		if not remembered.has(id): remembered[id]=_fresh_packages()[id]
		remembered[id].enabled=game.living.wanted.has(id) and int(game.living.wanted[id].get("version",0))==1
		var active=game.living.active.get(id,{})
		if not active.is_empty() and int(active.get("manifest",active.get("package",{})).get("version",0))!=1: continue
		var entities=active.get("entities",{})
		if entities.is_empty():
			# Retirement may occur between samples; read only whitelisted outcomes
			# from its in-memory snapshot before discarding transient cached physics.
			entities=game.living.cached_states.get(id,{}).get("state",{}).get("entities",{})
		if id=="living-unfinished-lullaby":
			for bud in ["sun","hearth","song"]:
				var outcome=entities.get(bud+"-bud",{}).get("state",{})
				if outcome.get("complete",false): remembered[id].outcomes[bud]=1
		else:
			var outcome=entities.get("lantern",{}).get("state",{})
			remembered[id].outcomes.hits=maxi(int(remembered[id].outcomes.hits),clampi(int(outcome.get("count",0)),0,3))
		if not active.is_empty() and applied.get(id)!=active.root.get_instance_id(): _apply_outcomes(id,active)
		game.living.cached_states.erase(id); game.living.version_states.erase(id+":1")

func _apply_outcomes(id:String,built:Dictionary):
	if int(built.get("manifest",built.get("package",{})).get("version",0))!=1: return
	var entities=built.entities
	var outcome=remembered[id].outcomes
	if id=="living-unfinished-lullaby":
		var total=0
		for bud in ["sun","hearth","song"]:
			var count=int(outcome[bud]); total+=count
			_set_objective(entities[bud+"-bud"],count,1)
			for suffix in ["-petal-left","-petal-right"]:
				var part=entities[bud+suffix]; var spec=_spec(id,bud+suffix)
				part.node.position=_vector(spec.position)+(Vector3(-.2 if suffix.ends_with("left") else .2,.35,0) if count==1 else Vector3.ZERO)
				_set_color(part,_spec(id,bud+"-bud").color if count==1 else spec.color)
		_set_objective(entities.chorus,total,3)
		for key in ["crown","crown-light"]:
			entities[key].node.position=_vector(_spec(id,key).position)+(Vector3.UP*.5 if total==3 else Vector3.ZERO)
		entities.crown.state.power=1.4 if total==3 else 0.0
		entities["crown-light"].state.power=2.0 if total==3 else 0.0
		_set_color(entities.crown,"#f4ca78" if total==3 else _spec(id,"crown").color)
	else:
		var hits=int(outcome.hits); _set_objective(entities.lantern,hits,3)
		entities.lantern.state.power=2.0 if hits>0 else 0.0
		_set_color(entities.lantern,"#ffca72" if hits>0 else _spec(id,"lantern").color)
	applied[id]=built.root.get_instance_id()

func _set_objective(entry,count,goal):
	entry.state.count=count; entry.state.complete=count>=goal
	if count>=goal: _set_color(entry,"#e1b65c")
	if entry.has("label"): entry.label.text=str(entry.spec.get("name",entry.id))+"\n"+str(count)+" / "+str(goal)+(" · Complete" if count>=goal else "")

func _set_color(entry,color):
	entry.base_color=Color(color); entry.material.albedo_color=entry.base_color

func _spec(id,key)->Dictionary:
	for entity in manifests[id].entities:
		if entity.id==key: return entity
	return {}

func _vector(value)->Vector3: return Vector3(float(value[0]),float(value[1]),float(value[2]))

func _remember_optional(data:Dictionary):
	# Only call after a validated restore or committed save, never from capture.
	bankshot_saved=data.get("bankshot",{}).duplicate(true)
	optional_saved.clear()
	for key in OPTIONAL_PROGRESS:
		if data.has(key): optional_saved[key]=data[key].duplicate(true)

func _restore(data:Dictionary):
	_remember_optional(data)
	for key in OPTIONAL_PROGRESS:
		var module=game.get(OPTIONAL_PROGRESS[key][0])
		if module!=null: module.restore_progress(data.get(key,_optional_script(key).fresh_state()))
	if game.get("bankshot")!=null:
		game.bankshot.state=data.get("bankshot",preload("res://bankshot_challenge.gd").fresh_state()).duplicate(true)
		for key in ["revision","stage","shots","bestShots","replays"]: game.bankshot.state[key]=int(game.bankshot.state[key])
		game.bankshot.current_throw=-1; game.bankshot.scored_throw=-1; game.bankshot._refresh()
	game.playful_encounters.state=data.bellworks.duplicate(true)
	for key in ["revision","stage","melody","gold","wins"]: game.playful_encounters.state[key]=int(game.playful_encounters.state[key])
	for i in range(game.playful_encounters.state.notes.size()): game.playful_encounters.state.notes[i]=int(game.playful_encounters.state.notes[i])
	game.playful_encounters.reward_applied=false; game.playful_encounters._refresh(); game.playful_encounters._apply_reward()
	game.cargo_playground.state=data.cargo.duplicate(true)
	for key in ["revision","rounds"]: game.cargo_playground.state[key]=int(game.cargo_playground.state[key])
	game.cargo_playground._refresh()
	game.tuning.values=_defaults(); game.tuning.values.merge(data.tuning,true); game.tuning.local_undo.clear(); game.tuning.runtime_overrides.clear()
	game.tuning.dragging=""; game.tuning.drag_revision=-1; game.tuning.revision+=1
	remembered=data.packages.duplicate(true); applied.clear()
	for id in PACKAGE_FILES:
		game.living.cached_states.erase(id); game.living.version_states.erase(id+":1")
		if remembered[id].enabled: game.living.wanted[id]=manifests[id].duplicate(true)
		else: game.living.wanted.erase(id)
	if game.living.has_method("_demo_archive_sync"): game.living._demo_archive_sync()

func tick(delta):
	if not enabled or not writable: return
	clock+=delta
	if clock>=next_sample:
		next_sample=clock+.25
		var signature=JSON.stringify(_capture())
		if signature!=observed_signature: observed_signature=signature; due=clock+1
	if due>=0 and clock>=due: save_now()

func save_now()->bool:
	if not enabled or not writable: return false
	var data=_capture()
	if not _valid(data): status="invalid_data"; due=clock+4; return false
	var signature=JSON.stringify(data)
	if signature==saved_signature: due=-1; return true
	if not store.save_progress(data):
		status=str(store.status); writable=bool(store.writable); due=clock+4 if writable else -1; return false
	_remember_optional(data)
	saved_signature=signature; observed_signature=signature; due=-1; saved_revision=int(store.revision); status="ready"
	print("DEMO_SESSION saved revision=",saved_revision)
	return true

func reset()->bool:
	if not enabled: return false
	if game.living.updating: status="busy"; return false
	if not game.living.safe_travel(SAFE_HOME): status="unsafe_reset"; return false
	var fresh=_fresh()
	if not store.reset_progress(fresh): status=str(store.status); writable=bool(store.writable); return false
	for id in PACKAGE_FILES:
		game.living.wanted.erase(id)
		if game.living.active.has(id): game.living._retire(id)
		game.living.cached_states.erase(id); game.living.version_states.erase(id+":1")
	if game.get("magnetic_wand")!=null: game.magnetic_wand._home()
	game.cargo_playground.act("reset")
	game.cargo_playground.bloom=0
	if game.get("playful_tools")!=null:
		var toy=game.playful_tools; toy._home(); toy.reward=""; toy.mode=1
		toy.accent.albedo_color=Color("81f5cf"); toy.accent.emission=toy.accent.albedo_color; toy.title.text="SUNSKIPPER"
	if game.get("ember_gallery")!=null: game.ember_gallery.reset_session()
	if game.get("hearth_torch")!=null: game.hearth_torch.home()
	_restore(fresh)
	writable=true; status="ready"; saved_revision=1; due=-1; saved_signature=JSON.stringify(_capture()); observed_signature=saved_signature
	game._notice("Demo reset. Your main adventure saves are unchanged.",5)
	return true

func status_text()->String:
	if not enabled: return "Demo saving unavailable: "+status.replace("_"," ")
	if not writable: return "Demo save needs attention ("+status.replace("_"," ")+"). Reset demo to start fresh."
	if status in ["io_error","invalid_data"]: return "Demo save failed; progress remains in this session."
	if status=="unsafe_reset": return "Reset paused: the return landing is obstructed."
	if status=="busy": return "Finish loading the invention, then reset again."
	if due>=0: return "Demo changes waiting to save."
	return "Demo progress recovered and saved locally." if status=="recovered" else "Demo progress saved locally."
