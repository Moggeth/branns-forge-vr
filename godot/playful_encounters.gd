extends Node
signal bell_struck(index:int)
## Bellworks: an offline, physically played, persistent three-trial fair.
const ART = preload("res://world_zones.gd")
const SCENE = preload("res://workshop_scene.gd")
const CENTER = Vector3(120,0,65)
const MELODY = [0,2,1,0]
const COLORS = ["72daca","aeb7ff","ffb778","f8dc7d"]
const NAMES = ["MINT","MOON","EMBER","GOLD"]
const SAVE = "user://playful_encounters.json"
var game
var court: Node3D
var bells: Array = []
var label: Label3D
var reward: Node3D
var claim_label: Label3D
var state = fresh_state()
var clock = 0.0
var hit_until = 0.0
var save_path = SAVE
var persistence_enabled = false
var save_failed = false
var reward_applied = false

static func fresh_state()->Dictionary:
	return {"schema":1,"revision":0,"discovered":false,"stage":0,"notes":[],"melody":0,"gold":0,"ready":false,"claimed":false,"wins":0}

func setup(owner_game):
	game=owner_game
	persistence_enabled=not game.diagnostic_offline and not game.smoke
	if persistence_enabled: load_progress()
	_build()
	_refresh()
	print("BELLWORKS_READY stage=",state.stage," claimed=",state.claimed," persistence=",persistence_enabled)

func _build():
	court=Node3D.new(); court.name="BellworksFair"
	game.adventure.zone_groups.forge_yard.add_child(court); court.position=CENTER
	ART.floor_patch(court,Vector3.ZERO,Vector2(14,18),"798b74")
	for side in [-1,1]:
		# East-side gap opens onto the broad Copper Kite Cargo bridge.
		for span in [[0.0,18.0]] if side<0 else [[-5.35,7.3],[5.35,7.3]]:
			ART.box(court,Vector3(side*6.8,.5,span[0]),Vector3(.2,1,span[1]),"79604a")
			ART.body(court,Vector3(side*6.8,.5,span[0]),Vector3(.2,1,span[1]),"solid")
		for z in [-7,0,7]:
			if side>0 and z==0: continue
			ART.box(court,Vector3(side*6.5,2.1,z),Vector3(.15,4.2,.15),"5e5146")
			ART.box(court,Vector3(side*6.25,3.2,z),Vector3(.55,.85,.05),"e2af66")
	for z in [-8.8,8.8]:
		ART.box(court,Vector3(0,.5,z),Vector3(13.6,1,.2),"79604a")
		ART.body(court,Vector3(0,.5,z),Vector3(13.6,1,.2),"solid")
	ART.box(court,Vector3(0,.012,1),Vector3(10,.024,.12),"ffe2a2")
	var line_label=ART.label(court,"THROW FROM BEHIND THE GOLD LINE",Vector3(0,.045,2),22)
	line_label.rotation.x=-PI/2
	ART.label(court,"THE BELLWORKS",Vector3(0,4.2,-4),55,"ffe1a0")
	ART.label(court,"Three little trials. One very proud smith.",Vector3(0,3.75,-4),22)
	for x in [-4.8,4.8]: ART.box(court,Vector3(x,1.7,-4),Vector3(.18,3.4,.2),"795940")
	ART.box(court,Vector3(0,3.35,-4),Vector3(9.8,.18,.22),"ad8553")
	for i in range(4):
		var bell=ART.body(court,Vector3((i-1)*2.7,1.85,-4) if i<3 else Vector3(0,2,-5.8),Vector3(.95,1,.62),"playful_bell")
		bell.set_meta("playful_bell",i)
		ART.cyl(bell,Vector3.ZERO,.43,.6,COLORS[i],"taper",.18)
		ART.cyl(bell,Vector3(0,-.30,0),.49,.09,COLORS[i],"cylinder",.15)
		ART.rock(bell,Vector3(0,-.44,0),Vector3(.14,.2,.14),"544139")
		ART.label(bell,str(i+1)+" · "+NAMES[i],Vector3(0,.7,0),22,COLORS[i])
		bells.append(bell)
	var board=Node3D.new(); court.add_child(board); board.position=Vector3(-4.1,1.5,4.7)
	ART.box(board,Vector3.ZERO,Vector3(4.8,1.8,.12),"293d41")
	label=ART.label(board,"",Vector3(0,.14,.08),22)
	label.pixel_size=.0035
	_button(board,Vector3(-1.3,-.62,.09),"start","START / RESUME",1.9)
	var claim=_button(board,Vector3(1.15,-.62,.09),"claim","REWARD LOCKED",2.0)
	claim_label=claim.get_meta("label")
	_button(court,Vector3(-4.1,.42,4.8),"replay","REPLAY ALL TRIALS",2.3)
	reward=Node3D.new(); court.add_child(reward); reward.position=Vector3(4.3,0,2)
	ART.cyl(reward,Vector3(0,.35,0),.5,.7,"736653")
	ART.cyl(reward,Vector3(0,1,0),.32,.5,"ffd77a","taper",.45)
	ART.cyl(reward,Vector3(0,1.25,0),.42,.08,"ffe9a0")
	ART.label(reward,"BELLWRIGHT\nA melody earned",Vector3(0,1.8,0),23,"ffe0a0")
	var gate=_gate(game.adventure.zone_groups.forge_yard,Vector3(11,0,1),"enter","BELLWORKS FAIR")
	gate.rotation.y=-PI/2
	_gate(court,Vector3(5,0,6),"leave","BACK TO BRANN")
	if game.get("playful_feedback")!=null:
		game.playful_feedback.register_hint("bellworks",board,"BELLWORKS FAIR","Take the Sunskipper beside the board. E throws; left click recalls.","Grip the Sunskipper. Release to throw; trigger recalls.",Vector3(0,1.5,0))

func _button(parent,pos,action,title,width)->Node3D:
	var node=Node3D.new(); parent.add_child(node); node.position=pos
	node.set_meta("kind","button"); node.set_meta("action","playful_encounter:"+action)
	ART.box(node,Vector3.ZERO,Vector3(width,.24,.1),"486e67")
	SCENE.collision(node,Vector3.ZERO,Vector3(width,.24,.1))
	var text=ART.label(node,title,Vector3(0,0,.06),19); text.pixel_size=.0032
	node.set_meta("label",text)
	return node

func _gate(parent,pos,action,title)->Node3D:
	var node=Node3D.new(); parent.add_child(node); node.position=pos
	node.set_meta("kind","button"); node.set_meta("action","playful_encounter:"+action)
	for side in [-1,1]: ART.box(node,Vector3(side*.85,1.3,0),Vector3(.17,2.6,.2),"bd9357")
	ART.box(node,Vector3(0,2.65,0),Vector3(1.9,.2,.22),"e4bf75")
	var glass=ART.box(node,Vector3(0,1.3,0),Vector3(1.5,2.4,.04),"ae8646",.1)
	glass.material_override=glass.material_override.duplicate()
	glass.material_override.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA
	glass.material_override.albedo_color.a=.3
	SCENE.collision(node,Vector3(0,1.3,0),Vector3(1.6,2.6,.12))
	var title_label=ART.label(node,title,Vector3(0,2.1,.08),26); title_label.pixel_size=.003
	ART.label(node,"Point + trigger / click\nFree ring-throwing trials",Vector3(0,1,.08),18).pixel_size=.003
	return node

func act(action:String):
	if action=="enter":
		if game.living.safe_travel(CENTER+Vector3(0,0,5)): _discover()
	elif action=="leave": game.living.safe_travel(Vector3(9,0,2))
	elif action=="start":
		_discover()
		_notice("Take the Sunskipper from its stand. Throw from behind the gold line.")
	elif action=="claim":
		if state.ready and not state.claimed:
			state.claimed=true; state.wins+=1
			_changed(); _apply_reward(); _pulse(CENTER+Vector3(4.3,1.5,2),"reward")
			_notice("Bellwright earned! Your Sunskipper wears ember gold. Replay whenever you like.")
		else: _notice("Finish all three bell trials to earn the Bellwright reward." if not state.claimed else "Your Bellwright reward is already yours.")
	elif action=="replay":
		if state.claimed:
			state.stage=0; state.notes=[]; state.melody=0; state.gold=0; state.ready=false
			_changed(); _notice("A fresh performance! Your earned reward stays yours.")
		else: _notice("Finish your first performance before replaying all trials.")

func _discover():
	if not state.discovered: state.discovered=true; _changed()

func tick(delta):
	clock+=delta
	if bells.size()==4:
		bells[3].position.x=sin(clock*.8)*3.8
		bells[3].position.y=2+sin(clock*1.3)*.3
	_apply_reward()

func hit_target(node,position:Vector3,velocity:Vector3)->bool:
	if node==null or not is_instance_valid(node): return false
	var target=node
	while target!=null and not target.has_meta("playful_bell"): target=target.get_parent()
	if target==null or not target in bells: return false
	if not velocity.is_finite() or velocity.length()<1.0: return true
	if clock<hit_until: return true
	hit_until=clock+.65
	var feet=game.camera.global_position-CENTER
	if absf(feet.x)>5.8 or feet.z<1.0 or feet.z>8.4:
		_notice("Stand behind the gold line to score a throw."); return true
	_discover()
	var index=int(target.get_meta("playful_bell"))
	_pulse(position,"hit")
	bell_struck.emit(index)
	if state.ready: return true
	if state.stage==0:
		if index<3 and not index in state.notes:
			state.notes.append(index)
			if state.notes.size()==3: state.stage=1; _notice("Trial 1 complete! Play MINT, EMBER, MOON, MINT.")
	elif state.stage==1:
		if index==MELODY[int(state.melody)]:
			state.melody+=1
			if state.melody==MELODY.size(): state.stage=2; _notice("Melody complete! Catch the moving GOLD bell three times.")
		else:
			state.melody=1 if index==MELODY[0] else 0
			_notice("A playful wrong note. Start the melody again: MINT, EMBER, MOON, MINT.")
	elif state.stage==2 and index==3:
		state.gold+=1
		if state.gold==3:
			state.stage=3; state.ready=true
			_notice("All three trials complete! Claim your Bellwright reward at the board.")
			_pulse(position,"reward")
	_changed()
	return true

func _refresh():
	if label==null: return
	var instruction="TRIAL 1 / 3 · THE THREE VOICES\nRing MINT, MOON and EMBER in any order.\nDifferent bells rung: %d / 3"%state.notes.size()
	if state.stage==1: instruction="TRIAL 2 / 3 · THE SMITH'S MELODY\nMINT > EMBER > MOON > MINT\nCorrect notes: %d / 4 · wrong notes restart melody"%state.melody
	elif state.stage==2: instruction="TRIAL 3 / 3 · CATCH A SUNBEAM\nStrike the moving GOLD bell.\nGolden chimes: %d / 3"%state.gold
	elif state.ready: instruction="A BELLWRIGHT'S PERFORMANCE!\nAll three trials completed.\n"+("Your reward is earned. Replay at the left sign." if state.claimed else "CLAIM REWARD below to keep your trophy and ring colour.")
	label.text=instruction+("\nSave unavailable; keep this session open." if save_failed else "")
	claim_label.text="REWARD EARNED" if state.claimed else ("CLAIM REWARD" if state.ready else "REWARD LOCKED")
	reward.visible=state.claimed
	for i in range(bells.size()):
		bells[i].visible=(i==3) if state.stage==2 else (i<3)
		bells[i].collision_layer=1 if bells[i].visible else 0

func _apply_reward():
	if state.claimed and not reward_applied and game!=null and game.get("playful_tools")!=null:
		game.playful_tools.unlock_reward("bellwright"); reward_applied=true

func _notice(text):
	if game!=null: game._notice(text,5)

func _pulse(position,kind):
	if game!=null and game.get("playful_feedback")!=null: game.playful_feedback.pulse(position,kind)

func progress_snapshot()->Dictionary: return state.duplicate(true)

func _changed():
	state.revision+=1
	save_failed=not save_progress()
	_refresh()

func _valid(value)->bool:
	if not value is Dictionary or value.get("schema")!=1: return false
	for key in ["discovered","ready","claimed"]:
		if not value.get(key) is bool: return false
	for key in ["revision","stage","melody","gold","wins"]:
		if not (value.get(key) is int or value.get(key) is float) or not is_finite(float(value[key])) or float(value[key])!=floor(float(value[key])): return false
	if value.revision<0 or value.revision>100000000 or value.stage<0 or value.stage>3 or value.melody<0 or value.melody>4 or value.gold<0 or value.gold>3 or value.wins<0 or value.wins>1000000: return false
	if not value.get("notes") is Array or value.notes.size()>3: return false
	var unique=[]
	for note in value.notes:
		if not (note is int or note is float) or not is_finite(float(note)) or float(note)!=floor(float(note)): return false
		if int(note) not in [0,1,2] or int(note) in unique: return false
		unique.append(int(note))
	if value.stage>=1 and unique.size()!=3: return false
	if value.stage>=2 and value.melody!=4: return false
	if value.ready!=(value.stage==3) or (value.stage==3 and value.gold!=3): return false
	if value.claimed and value.wins<1: return false
	return true

func _read(path:String):
	if not FileAccess.file_exists(path): return null
	var file=FileAccess.open(path,FileAccess.READ)
	if file==null or file.get_length()>8192: return null
	var parser=JSON.new()
	if parser.parse(file.get_as_text())!=OK: return null
	var value=parser.data
	return value if _valid(value) else null

func load_progress():
	if not persistence_enabled: return
	var best=null
	for suffix in ["",".tmp",".bak"]:
		var candidate=_read(save_path+suffix)
		if candidate!=null and (best==null or candidate.revision>best.revision): best=candidate
	if best!=null:
		state=best
		for key in ["revision","stage","melody","gold","wins"]: state[key]=int(state[key])
		for i in range(state.notes.size()): state.notes[i]=int(state.notes[i])

func save_progress()->bool:
	if not persistence_enabled: return true
	var file=FileAccess.open(save_path+".tmp",FileAccess.WRITE)
	if file==null: push_warning("BELLWORKS_SAVE cannot write temporary snapshot"); return false
	file.store_string(JSON.stringify(state)); file.flush(); var error=file.get_error(); file.close()
	if error!=OK or _read(save_path+".tmp")==null: push_warning("BELLWORKS_SAVE snapshot validation failed"); return false
	if _read(save_path)!=null:
		if DirAccess.copy_absolute(save_path,save_path+".bak")!=OK: push_warning("BELLWORKS_SAVE backup unavailable"); return false
	if DirAccess.rename_absolute(save_path+".tmp",save_path)!=OK:
		push_warning("BELLWORKS_SAVE replacement failed; temporary snapshot retained"); return false
	return true
