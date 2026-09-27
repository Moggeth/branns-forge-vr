extends Node
## Generated, untimed call-and-response with physical clappers and visual cues.
const ART=preload("res://world_zones.gd")
const SCENE=preload("res://workshop_scene.gd")
const CENTER=Vector3(185,0,65)
const LANDING=CENTER+Vector3(0,0,5)
const SAVE="user://echo_bells.json"
const NAMES=["SUN / CIRCLE","MOON / DIAMOND","STAR / CROSS"]
const COLORS=["edc879","abc0fa","91d7b8"]
const FIELDS=["schema","revision","medal","completions","bestLength","bestUnassistedLength"]
var game
var court:Node3D
var board:Node3D
var label:Label3D
var cue_label:Label3D
var medal:Node3D
var bells=[]
var clappers=[]
var glows=[]
var players=[]
var flash_left=[0.0,0.0,0.0]
var state=fresh_state()
var mode="idle"
var sequence=[]
var answer_index=0
var cue_index=0
var cue_wait=0.0
var assisted=false
var holder:Node3D
var held_bell=-1
var grab_position=Vector3.ZERO
var pull=Vector3.ZERO
var pull_armed=false
var persistence_enabled=false
var save_path=SAVE
var save_failed=false
var rng=RandomNumberGenerator.new()

static func fresh_state()->Dictionary:
	return {"schema":1,"revision":0,"medal":false,"completions":0,"bestLength":0,"bestUnassistedLength":0}

func setup(owner_game):
	game=owner_game; rng.randomize()
	persistence_enabled=not game.diagnostic_offline and not game.smoke
	if persistence_enabled: load_progress()
	_build(); _refresh()
	print("ECHO_BELLS_READY best=",state.bestLength," persistence=",persistence_enabled)

func _build():
	court=Node3D.new(); court.name="EchoBellsCourt"; game.adventure.zone_groups.forge_yard.add_child(court); court.position=CENTER
	ART.floor_patch(court,Vector3.ZERO,Vector2(14,18),"859582")
	for side in [-1,1]:
		_solid(Vector3(side*6.8,.45,0),Vector3(.2,.9,18),"796a52")
		_solid(Vector3(0,.45,side*8.8),Vector3(13.6,.9,.2),"796a52")
	ART.label(court,"ECHO BELLS",Vector3(0,3.8,-1),44,"ffe3a6")
	ART.label(court,"Listen or watch. Remember. Ring it back.",Vector3(0,3.25,-1),26)
	cue_label=ART.label(court,"",Vector3(0,2.8,-1),40,"fff2c6"); cue_label.pixel_size=.0045
	for i in range(3):
		var bell=Node3D.new(); court.add_child(bell); bell.position=Vector3((i-1)*2.7,1.8,-1)
		bell.set_meta("kind","button"); bell.set_meta("action","echo:note"+str(i))
		SCENE.collision(bell,Vector3(0,-.15,0),Vector3(1.1,1.45,.9))
		ART.box(bell,Vector3(0,.6,0),Vector3(1.3,.12,.16),"927349")
		ART.cyl(bell,Vector3.ZERO,.36,.7,COLORS[i],"taper")
		ART.cyl(bell,Vector3(0,-.35,0),.46,.1,COLORS[i])
		var mark=Node3D.new(); bell.add_child(mark); mark.position=Vector3(0,.08,.42)
		if i==0: ART.cyl(mark,Vector3.ZERO,.17,.045,"fff0ba").rotation.x=PI/2
		elif i==1: ART.box(mark,Vector3.ZERO,Vector3(.26,.26,.045),"fff0ba").rotation.z=PI/4
		else:
			ART.box(mark,Vector3.ZERO,Vector3(.10,.36,.045),"fff0ba")
			ART.box(mark,Vector3.ZERO,Vector3(.36,.10,.045),"fff0ba")
		var clapper=Node3D.new(); bell.add_child(clapper); clapper.position=Vector3(0,-.65,.2)
		ART.cyl(clapper,Vector3(0,.16,0),.035,.32,"806e56")
		ART.rock(clapper,Vector3.ZERO,Vector3(.19,.18,.19),"e9d3a0")
		var glow=ART.rock(bell,Vector3(0,.83,0),Vector3(.34,.34,.14),COLORS[i]); glow.material_override=ART.mat(COLORS[i],.7); glow.visible=false
		ART.label(bell,str(i+1)+" · "+NAMES[i],Vector3(0,-1.16,.10),23).pixel_size=.004
		var player=AudioStreamPlayer3D.new(); bell.add_child(player); player.stream=_tone([392.0,523.25,659.25][i]); player.volume_db=-22; player.max_distance=16; player.unit_size=3
		bells.append(bell); clappers.append(clapper); glows.append(glow); players.append(player)
	board=Node3D.new(); court.add_child(board); board.position=Vector3(-4.4,1.65,3.8)
	ART.box(board,Vector3.ZERO,Vector3(4.4,2.5,.12),"354f50")
	ART.label(board,"YOUR LITTLE CONCERT",Vector3(0,1.03,.08),30).pixel_size=.0035
	label=ART.label(board,"",Vector3(0,.38,.08),30); label.pixel_size=.0035
	_button(board,Vector3(-1.04,-.32,.1),"practice","NEW ROUND",1.94)
	_button(board,Vector3(1.04,-.32,.1),"replay","REPLAY MELODY",1.94)
	_button(board,Vector3(-1.04,-.69,.1),"retry","RETRY",1.94)
	_button(board,Vector3(1.04,-.69,.1),"abandon","ABANDON",1.94)
	ART.label(board,"VR: grip clapper, pull 10cm, release\nDesktop: click a bell. No time limit.",Vector3(0,-1.07,.08),24).pixel_size=.0038
	_button(court,Vector3(4.5,1.1,6),"leave","BACK TO BELLWORKS",2.7)
	medal=Node3D.new(); court.add_child(medal); medal.position=Vector3(4.8,1.25,3.2)
	ART.cyl(medal,Vector3(0,-.62,0),.3,1.1,"827057")
	for i in range(3): ART.cyl(medal,Vector3((i-1)*.21,.10 if i==1 else 0,0),.14,.24,COLORS[i],"taper")
	ART.label(medal,"ECHO KEEPER",Vector3(0,.6,0),24).pixel_size=.004

func _solid(position,size,color):
	ART.box(court,position,size,color); ART.body(court,position,size,"solid")
func _button(parent,position,action,title,width):
	var node=Node3D.new(); parent.add_child(node); node.position=position
	node.set_meta("kind","button"); node.set_meta("action","echo:"+action)
	ART.box(node,Vector3.ZERO,Vector3(width,.28,.1),"58766b"); SCENE.collision(node,Vector3.ZERO,Vector3(width,.28,.1))
	ART.label(node,title,Vector3(0,0,.06),26).pixel_size=.0035

func _tone(frequency:float)->AudioStreamWAV:
	var wave=AudioStreamWAV.new(); wave.format=AudioStreamWAV.FORMAT_16_BITS; wave.mix_rate=22050
	var samples=PackedByteArray(); samples.resize(6615*2)
	for i in range(6615):
		var t=float(i)/22050.0
		var value=(sin(TAU*frequency*t)+.18*sin(TAU*frequency*2*t))*minf(1,t*100)*exp(-t*13)*.45
		samples.encode_s16(i*2,int(value*32767))
	wave.data=samples; return wave

func act(action:String):
	match action:
		"visit":
			if _travel_clear(): game.living.safe_travel(LANDING)
		"leave":
			if _travel_clear(): game.living.safe_travel(Vector3(120,0,70))
		"practice","start","new_round":
			_reset_run(); sequence=[rng.randi_range(0,2)]; _append_note(); _play_phrase()
		"replay","retry":
			if sequence.is_empty() or mode in ["idle","complete"]: _notice("Choose NEW ROUND to hear a little melody."); return
			assisted=true; _play_phrase()
		"abandon": _reset_run(); _refresh(); _notice("Concert put away. Your medal and best phrases stay yours.")
		"note0","note1","note2": _ring(int(action.right(1)))

func _append_note():
	sequence.append((int(sequence[-1])+1+rng.randi_range(0,1))%3)

func _play_phrase():
	_cancel_grip(); mode="playing"; cue_index=0; cue_wait=.65; answer_index=0
	for i in range(3): flash_left[i]=0.0; glows[i].visible=false
	_refresh()

func tick(delta):
	_tick_grip(delta)
	for i in range(glows.size()):
		flash_left[i]=maxf(0,flash_left[i]-delta); glows[i].visible=flash_left[i]>0
	if mode=="playing":
		cue_wait-=maxf(0,delta)
		if cue_wait<=0:
			if cue_index<sequence.size():
				var note=int(sequence[cue_index]); _sound(note); cue_index+=1; cue_wait=.95
				cue_label.text="WATCH %d / %d · %s"%[cue_index,sequence.size(),NAMES[note]]
			else:
				mode="answering"; _refresh()

func _sound(note:int):
	if note<0 or note>=players.size(): return
	flash_left[note]=.60; glows[note].visible=true
	if DisplayServer.get_name()!="headless": players[note].play()

func _ring(note:int):
	if note<0 or note>2: return
	if mode=="playing": _notice("Watch or listen to the melody first. Then it is your turn."); return
	_sound(note)
	if mode!="answering":
		if mode=="failed": _notice("Use RETRY to hear that phrase again.")
		return
	if note!=int(sequence[answer_index]):
		mode="failed"; assisted=true; _refresh(); _notice("That was a different note. No hurry: RETRY plays the same phrase again."); return
	answer_index+=1
	if answer_index<sequence.size(): _refresh(); return
	state.bestLength=maxi(int(state.bestLength),sequence.size())
	if not assisted: state.bestUnassistedLength=maxi(int(state.bestUnassistedLength),sequence.size())
	if sequence.size()==5:
		mode="complete"; state.medal=true; state.completions=mini(1000000,int(state.completions)+1)
		_notice("Echo Keeper medal! You remembered five notes."+(" A lovely assisted concert." if assisted else " Every phrase on the first listen!"))
	else:
		_append_note(); _play_phrase()
	state.revision=mini(100000000,int(state.revision)+1); save_failed=not save_progress(); _refresh()

func busy(hand)->bool: return is_instance_valid(holder) and holder==hand
func _hand_free(hand)->bool:
	if not is_instance_valid(hand): return false
	if game.get("held") is Dictionary and game.held.has(str(hand.get_instance_id())): return false
	for name in ["living","firecraft","siegebird","workshop","enchantments","playful_tools","magnetic_wand","cargo_playground"]:
		var system=game.get(name)
		if system!=null and system.has_method("busy") and system.busy(hand): return false
	var adventure=game.get("adventure")
	if adventure!=null and adventure.get("formation") is Dictionary and adventure.formation.has(str(hand.get_instance_id())): return false
	return true

func try_grab(hand,desktop=false)->bool:
	if desktop or mode=="playing" or not _hand_free(hand): return false
	if busy(hand): return true
	if is_instance_valid(holder): return false
	for i in range(clappers.size()):
		if hand.global_position.distance_to(clappers[i].global_position)<=.24:
			holder=hand; held_bell=i; grab_position=hand.global_position; pull=Vector3.ZERO; pull_armed=false; _haptic(hand,"ready"); return true
	return false

func _tick_grip(delta):
	if is_instance_valid(holder):
		if not _hand_free(holder) or holder.global_position.distance_to(grab_position)>.55: _cancel_grip()
		else:
			pull=(holder.global_position-grab_position).limit_length(.18)
			if pull.length()>=.10: pull_armed=true
	elif held_bell>=0: _cancel_grip()
	for i in range(clappers.size()):
		var destination=Vector3(0,-.65,.2)+(bells[i].global_basis.inverse()*pull if held_bell==i else Vector3.ZERO)
		clappers[i].position=clappers[i].position.move_toward(destination,maxf(0,delta)*1.8)

func release(hand)->bool:
	if not busy(hand): return false
	var note=held_bell
	var distance=hand.global_position.distance_to(grab_position)
	var should_ring=(pull_armed or distance>=.10) and _hand_free(hand) and distance<=.55
	_cancel_grip(); _haptic(hand,"impact" if should_ring else "release")
	if should_ring: _ring(note)
	return true

func _cancel_grip():
	holder=null; held_bell=-1; pull=Vector3.ZERO; pull_armed=false

func _travel_clear()->bool:
	if is_instance_valid(holder): _notice("Release the clapper before travelling."); return false
	var hands=[]
	if game.get("hands") is Array: hands.append_array(game.hands)
	if is_instance_valid(game.get("desktop_hand")): hands.append(game.desktop_hand)
	for hand in hands:
		if not _hand_free(hand): _notice("Put away held tools before travelling."); return false
	return true

func _reset_run():
	_cancel_grip(); mode="idle"; sequence=[]; answer_index=0; cue_index=0; cue_wait=0; assisted=false
	for i in range(players.size()): players[i].stop(); flash_left[i]=0.0; glows[i].visible=false
	for clapper in clappers: clapper.position=Vector3(0,-.65,.2)

func _refresh():
	if label==null: return
	var text="Generated melodies: 2 to 5 notes.\nWatch the named bell or listen.\nNEW ROUND begins untimed practice."
	if mode=="playing": text="WATCH / LISTEN · %d notes\nWait for YOUR TURN.\nReplay and Retry are always available."%sequence.size()
	elif mode=="answering": text="YOUR TURN · %d / %d correct\nClick a bell, or pull + release its clapper.\nNo timer. Replay if you need a reminder."%[answer_index,sequence.size()]
	elif mode=="failed": text="A DIFFERENT NOTE · try again\nRETRY keeps this same melody.\nYour earned records stay yours."
	elif mode=="complete": text="ECHO KEEPER MEDAL EARNED\nFive notes remembered!\nNEW ROUND makes a fresh concert."
	text+="\nBest: %d · First listen: %d"%[state.bestLength,state.bestUnassistedLength]
	if save_failed: text+="\nSave unavailable; session progress only."
	label.text=text; medal.visible=state.medal
	if mode!="playing": cue_label.text="YOUR TURN · %d / %d"%[answer_index,sequence.size()] if mode=="answering" else {"idle":"Click bells freely, or choose NEW ROUND","failed":"RETRY when you are ready","complete":"ECHO KEEPER · WELL REMEMBERED"}.get(mode,"")
	else: cue_label.text="READY TO LISTEN · %d NOTES"%sequence.size()

func _notice(message):
	if game!=null: game._notice(message,6)
func _haptic(hand,event):
	if game!=null and game.get("adventure")!=null and game.adventure.has_method("haptic"): game.adventure.haptic(hand,event)
func progress_snapshot()->Dictionary: return state.duplicate(true)
func restore_progress(data)->bool:
	if not _valid(data): return false
	state=data.duplicate(true)
	for key in ["schema","revision","completions","bestLength","bestUnassistedLength"]: state[key]=int(state[key])
	_reset_run(); _refresh(); return true
static func _integer(value,maximum)->bool:
	return (value is int or value is float) and is_finite(float(value)) and value>=0 and value<=maximum and float(value)==floor(float(value))
static func _valid(value)->bool:
	if not value is Dictionary or value.size()!=FIELDS.size() or not value.keys().all(func(key):return key in FIELDS) or not _integer(value.get("schema"),1) or value.schema!=1: return false
	if not value.medal is bool: return false
	for key in ["revision","completions","bestLength","bestUnassistedLength"]:
		if not _integer(value[key],100000000 if key=="revision" else (1000000 if key=="completions" else 5)): return false
	if value.bestLength==1 or value.bestUnassistedLength==1 or value.bestUnassistedLength>value.bestLength: return false
	return value.medal==(value.completions>0) and (not value.medal or value.bestLength==5) and (value.bestLength!=5 or value.medal)
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
