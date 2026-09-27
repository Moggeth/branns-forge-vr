extends Node
## Optional fresh-action tour. Existing activity progress is never erased by starting.
const ART=preload("res://world_zones.gd")
const SCENE=preload("res://workshop_scene.gd")
const SAVE="user://festival_relay.json"
const GARDEN="living-unfinished-lullaby"
const LANDING=Vector3(120,0,70)
const GARDEN_LANDING=Vector3(120,0,-84)
const FIELDS=["schema","revision","medal","completions","timedCompletions","bestSeconds"]
var game
var board:Node3D
var label:Label3D
var state=fresh_state()
var mode="idle"
var stage=0
var timed=false
var elapsed=0.0
var ring_hits=0
var cargo_baseline=0
var cargo_armed=false
var light_done=false
var sound_done=false
var light_armed=false
var garden_root_id=0
var garden_since=0.0
var preparing=false
var generation=0
var persistence_enabled=false
var save_path=SAVE
var save_failed=false
var refresh_in=0.0
var cargo_post={}
var garden_post={}

static func fresh_state()->Dictionary:
	return {"schema":1,"revision":0,"medal":false,"completions":0,"timedCompletions":0,"bestSeconds":0.0}

func setup(owner_game):
	game=owner_game; persistence_enabled=not game.diagnostic_offline and not game.smoke
	if persistence_enabled: load_progress()
	_build()
	if not game.playful_encounters.bell_struck.is_connected(_bell_struck): game.playful_encounters.bell_struck.connect(_bell_struck)
	_refresh()
	print("FESTIVAL_RELAY_READY completions=",state.completions," persistence=",persistence_enabled)

func _build():
	board=Node3D.new(); board.name="FestivalRelayBoard"
	game.playful_encounters.court.add_child(board)
	board.position=Vector3(2.5,1.55,7.8); board.rotation.y=PI
	ART.box(board,Vector3.ZERO,Vector3(3.2,2.5,.12),"354f4b")
	ART.label(board,"FESTIVAL RELAY",Vector3(0,1.05,.08),34,"ffe2a0").pixel_size=.0035
	label=ART.label(board,"",Vector3(0,.29,.08),30); label.pixel_size=.0035
	_button(Vector3(-.76,-.42,.1),"practice","PRACTICE",1.35)
	_button(Vector3(.76,-.42,.1),"timed","PERSONAL BEST",1.35)
	_button(Vector3(0,-.76,.1),"next","NEXT / PREPARE TASK",2.85)
	_button(Vector3(-.76,-1.08,.1),"restart","RESTART",1.35)
	_button(Vector3(.76,-1.08,.1),"abandon","ABANDON",1.35)

func _button(position,action,title,width,parent:Node3D=null):
	var button=Node3D.new(); (board if parent==null else parent).add_child(button); button.position=position
	button.set_meta("kind","button"); button.set_meta("action","festival:"+action)
	ART.box(button,Vector3.ZERO,Vector3(width,.24,.1),"527b66")
	SCENE.collision(button,Vector3.ZERO,Vector3(width,.24,.1))
	ART.label(button,title,Vector3(0,0,.06),24).pixel_size=.0035

func act(action:String):
	match action:
		"visit":
			if _travel_clear(): game.living.safe_travel(LANDING)
		"practice","timed":
			if mode=="running": _notice("A relay is already running. Use Restart or Abandon first."); return
			_start(action=="timed")
		"restart": _start(timed)
		"abandon":
			_abort(); _notice("Relay put away. Every earned medal and personal best stays yours."); _refresh()
		"next": await _next()

func _start(with_clock:bool):
	# A throw released before this run cannot become one of its fresh strikes.
	var ring=game.get("playful_tools") if game!=null else null
	if ring!=null and ring.get("state") in ["flying","returning"] and ring.has_method("_home"): ring._home()
	_abort(); mode="running"; timed=with_clock
	_notice("Festival Relay: three fresh Bellworks ring strikes. Any visible bell counts. NEXT takes you there. No time limit.")
	_refresh()

func _abort():
	generation+=1; mode="idle"; stage=0; elapsed=0.0; timed=false; ring_hits=0
	cargo_baseline=0; cargo_armed=false; light_done=false; sound_done=false; light_armed=false
	garden_root_id=0; garden_since=0.0

func _bell_struck(_index:int):
	if mode!="running" or stage!=0: return
	ring_hits+=1
	if ring_hits>=3:
		stage=1; cargo_baseline=int(game.cargo_playground.state.rounds)
		cargo_armed=not game.cargo_playground.can_launch and not game.cargo_playground.launched
		_notice("Ring leg complete! NEXT visits Cargo. If it is already ready or blooming, NEXT resets its parcels for this delivery.")
	_refresh()

func tick(delta):
	if mode=="running":
		elapsed=minf(604800.0,elapsed+maxf(0.0,delta))
		if stage==1:
			var cargo=game.cargo_playground
			if not cargo.can_launch and not cargo.launched: cargo_armed=true
			if cargo_armed and int(cargo.state.rounds)>cargo_baseline:
				stage=2; _bind_garden()
				_notice("Cargo leg complete! NEXT visits Lullaby. Hold the glow pebble beside SUN, then ring the held handbell beside SONG. Existing garden progress stays yours.")
		elif stage==2: _garden_tick()
	refresh_in-=delta
	if refresh_in<=0: refresh_in=.2; _refresh()

func _garden():
	if game==null or game.get("living")==null: return {}
	return game.living.active.get(GARDEN,{})

func _bind_garden():
	var built=_garden()
	if built.is_empty() or not built.get("active",false) or not is_instance_valid(built.get("root")): return
	var entities=built.get("entities",{})
	for id in ["sun-bud","song-bud","glow-pebble","handbell"]:
		if not entities.has(id) or not is_instance_valid(entities[id].get("node")): return
	garden_root_id=built.root.get_instance_id(); garden_since=game.living.components.clock
	light_armed=not _held_near(entities["glow-pebble"],entities["sun-bud"])

func _held_near(source,destination)->bool:
	return game.living.components._held_entry(source) and source.node.global_position.distance_to(destination.node.global_position)<=1.8

func _garden_tick():
	var built=_garden()
	if built.is_empty() or not built.get("active",false) or not is_instance_valid(built.get("root")): return
	if built.root.get_instance_id()!=garden_root_id: _bind_garden(); return
	var entities=built.entities
	var near=_held_near(entities["glow-pebble"],entities["sun-bud"])
	if not near: light_armed=true
	if near and light_armed: light_done=true
	if not sound_done and _held_near(entities.handbell,entities["song-bud"]):
		for stimulus in game.living.components.stimuli:
			# Canonical handbell emits strength 6; the finale emits 4. Fresh emission,
			# current ownership and source proximity exclude old/foreign sounds.
			if stimulus.kind!="sound" or stimulus.owner!=built or float(stimulus.strength)!=6.0: continue
			if float(stimulus.until)-1.5<=garden_since: continue
			if stimulus.position.distance_to(entities.handbell.node.global_position)>.35: continue
			if stimulus.position.distance_to(entities["song-bud"].node.global_position)>1.8: continue
			sound_done=true; break
	if light_done and sound_done: _complete()

func _complete():
	if mode!="running": return
	mode="complete"; state.completions=mini(1000000,int(state.completions)+1); state.medal=true
	if timed:
		state.timedCompletions=mini(state.completions,int(state.timedCompletions)+1)
		var result=clampf(elapsed,.001,604800.0)
		if state.bestSeconds==0 or result<float(state.bestSeconds): state.bestSeconds=result
	state.revision=mini(100000000,int(state.revision)+1)
	save_failed=not save_progress(); _refresh()
	_notice("Festival medal earned! Ring, cargo and a little garden music."+(" Time: %.1fs. Best: %.1fs."%[elapsed,state.bestSeconds] if timed else " A lovely untimed practice."))
	if game.get("playful_feedback")!=null: game.playful_feedback.pulse(game.camera.global_position,"reward")

func _next():
	if mode!="running": _notice("Choose Practice or Personal Best on the relay board to start."); return
	if preparing: _notice("The garden is being prepared. Try NEXT when it is ready."); return
	if not _travel_clear(): return
	if stage==0: game.living.safe_travel(LANDING); return
	if stage==1:
		var cargo=game.cargo_playground
		if not cargo_armed and (cargo.can_launch or cargo.launched):
			cargo.act("reset"); cargo_armed=true
			_notice("Fresh relay delivery: the ready cargo was reset. Settle the three parcels and pull the bloom lever.")
		game.living.safe_travel(Vector3(136,0,65)); return
	var built=_garden()
	if built.is_empty():
		if game.living.wanted.has(GARDEN): _notice("Lullaby is arriving. Use NEXT again when its garden is ready."); return
		var package=JSON.parse_string(FileAccess.get_file_as_string("res://living_unfinished_lullaby.json"))
		if not package is Dictionary: _notice("The packaged Lullaby garden is unavailable."); return
		var request_generation=generation
		preparing=true
		var response=await game.living.publish(package)
		preparing=false
		if request_generation!=generation or mode!="running" or stage!=2: return
		_notice("Lullaby is arriving. Use NEXT when the garden is ready." if not response.has("error") else "Lullaby could not be prepared. Try NEXT again.")
		return
	if not built.get("active",false): _notice("Wait for the garden to finish arriving, then use NEXT."); return
	if not _travel_clear(): return
	if game.living.safe_travel(GARDEN_LANDING): _notice("Hold the glow pebble close to SUN. Grip the handbell and trigger/click beside SONG. Both must be fresh actions in this leg.")

func _travel_clear()->bool:
	if game.get("firecraft")!=null:
		var hands=[]
		if game.get("hands") is Array: hands.append_array(game.hands)
		if is_instance_valid(game.get("desktop_hand")): hands.append(game.desktop_hand)
		for hand in hands:
			if is_instance_valid(hand) and game.firecraft.busy(hand): _notice("Release the held match, vial or matchbox before travelling."); return false
	if game.get("held") is Dictionary and not game.held.is_empty(): _notice("Put down held inventions before travelling to the next relay task."); return false
	for name in ["playful_tools","magnetic_wand"]:
		var tool=game.get(name)
		if tool!=null and is_instance_valid(tool.get("holder")): _notice("Put away the held tool before travelling to the next relay task."); return false
	if game.get("cargo_playground")!=null and is_instance_valid(game.cargo_playground.get("lever_holder")): _notice("Release the cargo lever before travelling."); return false
	if game.living.get("components")!=null and not game.living.components.held.is_empty(): _notice("Put down the held garden invention before travelling."); return false
	return true

func _refresh():
	if label==null: return
	_sync_posts()
	var best="no best yet" if state.bestSeconds==0 else "best %.1fs"%state.bestSeconds
	var text="Three familiar places, one little relay.\nPractice has no clock. Personal Best has no limit.\nMedals: %d · %s"%[state.completions,best]
	if mode=="running":
		var task="RING: %d / 3 fresh bell strikes"%ring_hits
		if stage==1: task="CARGO: settle parcels, then bloom\nNEXT resets already ready cargo" if not cargo_armed else "CARGO: settle parcels, then bloom"
		if stage==2: task="GARDEN: held light %s · fresh song %s"%["yes" if light_done else "no","yes" if sound_done else "no"]
		text=task+"\nNEXT travels to this task.\n"+("%.1fs · %s"%[elapsed,best] if timed else "Untimed practice · take your time")
	elif mode=="complete": text="FESTIVAL MEDAL EARNED\nThree places, a job well done.\n"+("%.1fs · %s"%[elapsed,best] if timed else "A lovely untimed practice.")
	if save_failed: text+="\nSave unavailable; progress is session-only."
	label.text=text

func _post(parent:Node3D,position:Vector3,turn:float)->Dictionary:
	var node=Node3D.new(); node.name="FestivalWayfinding"; parent.add_child(node); node.position=position; node.rotation.y=turn
	ART.box(node,Vector3.ZERO,Vector3(2.4,1.5,.1),"354f4b")
	var text=ART.label(node,"",Vector3(0,.35,.08),24,"ffe2a0"); text.pixel_size=.0035
	_button(Vector3(0,-.10,.08),"next","NEXT RELAY TASK",2.15,node)
	_button(Vector3(0,-.39,.08),"visit","RETURN TO RELAY BOARD",2.15,node)
	_button(Vector3(0,-.68,.08),"abandon","ABANDON RELAY",2.15,node)
	return {"root":node,"label":text,"colliders":node.find_children("*","CollisionObject3D",true,false)}

func _sync_posts():
	var cargo=game.get("cargo_playground")
	if cargo_post.is_empty() and cargo!=null and is_instance_valid(cargo.get("cargo_root")):
		cargo_post=_post(cargo.cargo_root,Vector3(-4.5,1.65,-4.4),0)
	var garden=_garden()
	if not garden.is_empty() and garden.get("active",false) and is_instance_valid(garden.get("root")):
		if garden_post.is_empty() or not is_instance_valid(garden_post.root) or garden_post.root.get_parent()!=garden.root:
			if not garden_post.is_empty() and is_instance_valid(garden_post.root): garden_post.root.queue_free()
			garden_post=_post(garden.root,Vector3(3.5,1.55,6.5),PI)
	for post in [cargo_post,garden_post]:
		if post.is_empty() or not is_instance_valid(post.root): continue
		var show_post=mode!="idle"
		if post.root==garden_post.get("root"):
			show_post=show_post and not garden.is_empty() and garden.get("active",false) and garden.get("root")==post.root.get_parent()
		post.root.visible=show_post
		for collider in post.colliders:
			if is_instance_valid(collider): collider.collision_layer=1 if show_post else 0
		post.label.text="FESTIVAL · "+(["RING: THREE FRESH HITS","CARGO: SORT + BLOOM","GARDEN: HELD LIGHT + SONG"][stage] if mode=="running" else "MEDAL EARNED")

func _notice(message):
	if game!=null: game._notice(message,7)
func progress_snapshot()->Dictionary: return state.duplicate(true)
func restore_progress(data)->bool:
	if not _valid(data): return false
	state=data.duplicate(true)
	for key in ["schema","revision","completions","timedCompletions"]: state[key]=int(state[key])
	state.bestSeconds=float(state.bestSeconds); _abort(); _refresh(); return true

static func _integer(value,maximum)->bool:
	return (value is int or value is float) and is_finite(float(value)) and value>=0 and value<=maximum and float(value)==floor(float(value))
static func _valid(value)->bool:
	if not value is Dictionary or value.size()!=FIELDS.size() or not value.keys().all(func(key):return key in FIELDS) or not _integer(value.get("schema"),1) or value.schema!=1: return false
	if not value.medal is bool: return false
	for key in ["revision","completions","timedCompletions"]:
		if not _integer(value[key],100000000 if key=="revision" else 1000000): return false
	if value.timedCompletions>value.completions or value.medal!=(value.completions>0): return false
	if not (value.bestSeconds is int or value.bestSeconds is float) or not is_finite(float(value.bestSeconds)) or value.bestSeconds<0 or value.bestSeconds>604800: return false
	return (value.bestSeconds==0)==(value.timedCompletions==0)

func _read(path):
	if not FileAccess.file_exists(path): return null
	var file=FileAccess.open(path,FileAccess.READ)
	if file==null or file.get_length()>4096: return null
	var parser=JSON.new()
	if parser.parse(file.get_as_text())!=OK: return null
	return parser.data if _valid(parser.data) else null
func load_progress():
	if not persistence_enabled: return
	var best=null
	for suffix in ["",".tmp",".bak"]:
		var value=_read(save_path+suffix)
		if value!=null and (best==null or value.revision>best.revision): best=value
	if best!=null: restore_progress(best)
func save_progress()->bool:
	if not persistence_enabled: return true
	if not _valid(state): return false
	var file=FileAccess.open(save_path+".tmp",FileAccess.WRITE)
	if file==null: return false
	file.store_string(JSON.stringify(state)); file.flush(); var error=file.get_error(); file.close()
	if error!=OK or _read(save_path+".tmp")==null: return false
	if _read(save_path)!=null and DirAccess.copy_absolute(save_path,save_path+".bak")!=OK: return false
	return DirAccess.rename_absolute(save_path+".tmp",save_path)==OK
