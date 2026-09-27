extends Node
## Sunskipper bank shots: one real panel rebound, three changing bell positions.
const ART=preload("res://world_zones.gd")
const SCENE=preload("res://workshop_scene.gd")
const CENTER=Vector3(165,0,65)
const LANDING=CENTER+Vector3(0,0,6)
const TARGETS=[Vector3(3,1.5,2),Vector3(-3,1.8,1),Vector3(2.2,1.3,0)]
const SAVE="user://bankshot_challenge.json"
const FIELDS=["schema","revision","discovered","stage","shots","completed","medal","bestShots","replays"]
var game
var court:Node3D
var panel:StaticBody3D
var target:StaticBody3D
var medal:Node3D
var stand:Node3D
var label:Label3D
var target_label:Label3D
var state=fresh_state()
var current_throw=-1
var last_throw=-1
var scored_throw=-1
var persistence_enabled=false
var save_path=SAVE
var save_failed=false

static func fresh_state()->Dictionary:
	return {"schema":1,"revision":0,"discovered":false,"stage":0,"shots":0,"completed":false,"medal":false,"bestShots":0,"replays":0}

func setup(owner_game):
	game=owner_game; persistence_enabled=not game.diagnostic_offline and not game.smoke
	if persistence_enabled: load_progress()
	_build(); _refresh()
	game.playful_tools.register_target_receiver(self)
	print("BANKSHOT_READY stage=",state.stage," best=",state.bestShots," persistence=",persistence_enabled)

func _build():
	court=Node3D.new(); court.name="BankshotBellCourt"
	game.adventure.zone_groups.forge_yard.add_child(court); court.position=CENTER
	ART.floor_patch(court,Vector3.ZERO,Vector2(14,18),"8b967d")
	for side in [-1,1]:
		_solid(Vector3(side*6.8,.45,0),Vector3(.2,.9,18),"79634c")
		_solid(Vector3(0,.45,side*8.8),Vector3(13.6,.9,.2),"79634c")
	ART.box(court,Vector3(0,.015,3),Vector3(11.6,.03,.12),"f5d78a")
	panel=ART.body(court,Vector3(0,1.65,-4),Vector3(9,3.3,.2),"bankshot_panel")
	ART.box(panel,Vector3.ZERO,Vector3(9,3.3,.2),"446a69")
	ART.label(court,"BANKSHOT BELL",Vector3(0,3.85,-4),46,"ffe4a4")
	ART.label(court,"One bounce. Three little surprises.",Vector3(0,3.43,-4),21)
	target=ART.body(court,TARGETS[0],Vector3(1.5,1.5,.3),"bankshot_target")
	ART.cyl(target,Vector3.ZERO,.42,.65,"edc377","taper",.12)
	ART.cyl(target,Vector3(0,-.34,0),.49,.08,"ffe0a2")
	target_label=ART.label(target,"",Vector3(0,1.05,0),23,"fff0bc")
	var board=Node3D.new(); court.add_child(board); board.position=Vector3(-4.6,1.5,6)
	ART.box(board,Vector3.ZERO,Vector3(3.8,1.8,.12),"304949")
	label=ART.label(board,"",Vector3(0,.05,.08),22); label.pixel_size=.0032
	_button(board,Vector3(-.9,-.65,.08),"start","HOW TO PLAY",1.6)
	_button(board,Vector3(.9,-.65,.08),"replay","PLAY AGAIN",1.6)
	_button(court,Vector3(4.5,1.1,7),"leave","BACK TO BELLWORKS",2.4)
	stand=Node3D.new(); court.add_child(stand); stand.position=Vector3(-4.8,0,3.8)
	ART.cyl(stand,Vector3(0,.5,0),.27,1,"6c7463")
	ART.cyl(stand,Vector3(0,1.04,0),.43,.12,"c1985b")
	var body=ART.body(stand,Vector3(0,.55,0),Vector3(.75,1.1,.75),"playful_ring_stand")
	body.set_meta("playful_ring_stand",true)
	ART.label(stand,"SUNSKIPPER\nGrip / E to retrieve",Vector3(0,1.65,0),23).pixel_size=.0034
	medal=Node3D.new(); court.add_child(medal); medal.position=Vector3(4.7,1.1,5)
	ART.cyl(medal,Vector3(0,-.55,0),.33,.8,"77634d")
	ART.cyl(medal,Vector3.ZERO,.26,.1,"ffd37c","cylinder",.25).rotation.x=PI/2
	ART.label(medal,"THE BANKSHOT BELL\nA bounce well earned",Vector3(0,.65,0),20)
	if game.get("playful_feedback")!=null:
		game.playful_feedback.register_hint("bankshot",board,"BANKSHOT BELL","E: throw. Click: power / recall. Bounce off the teal panel first.","Release grip: throw. Trigger: power / recall. Panel, then bell.",Vector3(0,1.4,0))

func _solid(pos,size,color):
	ART.box(court,pos,size,color); ART.body(court,pos,size,"solid")

func _button(parent,pos,action,title,width):
	var node=Node3D.new(); parent.add_child(node); node.position=pos
	node.set_meta("kind","button"); node.set_meta("action","bankshot:"+action)
	ART.box(node,Vector3.ZERO,Vector3(width,.25,.1),"47766c")
	SCENE.collision(node,Vector3.ZERO,Vector3(width,.25,.1))
	ART.label(node,title,Vector3(0,0,.06),18).pixel_size=.003

func try_grab(hand,desktop=false)->bool:
	if not is_instance_valid(hand) or not is_instance_valid(stand): return false
	if hand.global_position.distance_to(stand.global_position+Vector3.UP*1.15)>(1.8 if desktop else .48): return false
	return game.playful_tools.retrieve(hand)

func tick(_delta): pass

func act(action:String):
	if action=="visit":
		if game.living.safe_travel(LANDING):
			if not state.discovered: state.discovered=true; _changed()
			_notice("Bankshot Bell: stand behind the gold line. Bounce the Sunskipper off the teal panel, then catch the bell.")
	elif action=="leave": game.living.safe_travel(Vector3(120,0,70))
	elif action=="start": _notice("Use COURTYARD power. Aim a little upward at the panel toward the bell's side. It must hit panel, then bell; direct hits don't score.")
	elif action=="replay":
		state.replays+=1; state.stage=0; state.shots=0; state.completed=false
		current_throw=-1; scored_throw=-1; _changed()
		_notice("A fresh three-bell round. Your medal and best score stay yours.")

func _in_lane(position)->bool:
	if not position is Vector3 or not position.is_finite(): return false
	var local:Vector3=position-CENTER
	return absf(local.x)<=5.8 and local.z>=3 and local.z<=8.3 and local.y>=0 and local.y<=4

func on_throw(context:Dictionary):
	var id=context.get("throwId",-1)
	if not _integer(id,1000000000) or int(id)<=last_throw: return
	last_throw=int(id)
	if state.completed or not _in_lane(context.get("launchPosition")): current_throw=-1; return
	current_throw=int(id); state.shots+=1; state.discovered=true; _changed()

func hit_target(collider,position:Vector3,velocity:Vector3,context:Dictionary)->bool:
	if collider==panel: return false
	if collider!=target: return false
	if state.completed: return true
	var id=int(context.get("throwId",-1))
	var valid=id==current_throw and id!=scored_throw and _in_lane(context.get("launchPosition"))
	valid=valid and int(context.get("bounceCount",0))==1 and context.get("lastBounceCollider")==panel
	valid=valid and float(context.get("lastBounceAt",-1))>=0 and float(context.get("lastBounceAt",-1))<=float(context.get("flightAge",0))
	valid=valid and velocity.is_finite() and velocity.length()>=1
	if not valid:
		current_throw=-1
		_notice("Panel first, then bell in the same throw. Use the gold line and avoid a second bounce."); return true
	scored_throw=id; current_throw=-1; state.stage+=1
	if state.stage==3:
		state.completed=true; state.medal=true
		if state.bestShots==0 or state.shots<state.bestShots: state.bestShots=state.shots
		_notice("Bankshot medal earned in %d throws! Best: %d. Play again whenever you like."%[state.shots,state.bestShots])
		_pulse(position,"reward")
	else:
		_notice("A lovely bank shot! Bell %d of 3 is waiting in a new spot."%[state.stage+1]); _pulse(position,"progress")
	_changed()
	return true

func _refresh():
	if label==null: return
	target.position=TARGETS[mini(2,int(state.stage))]; target.visible=not state.completed; target.collision_layer=0 if state.completed else 1
	target_label.text="BELL %d / 3 · PANEL FIRST"%[mini(3,int(state.stage)+1)]
	medal.visible=state.medal
	label.text=("ROUND COMPLETE" if state.completed else "BELL %d / 3"%[state.stage+1])+"\nTeal panel > bell. No second bounce.\nStand behind the gold line.\nThrows: %d · Best: %s"%[state.shots,str(state.bestShots) if state.bestShots>0 else "not set"]
	if save_failed: label.text+="\nSave unavailable; keep this session open."

func progress_snapshot()->Dictionary: return state.duplicate(true)
func _notice(text):
	if game!=null: game._notice(text,6)
func _pulse(position,kind):
	if game!=null and game.get("playful_feedback")!=null: game.playful_feedback.pulse(position,kind)
func _changed():
	state.revision+=1; save_failed=not save_progress(); _refresh()
static func _integer(value,maximum)->bool:
	return (value is int or value is float) and is_finite(float(value)) and value>=0 and value<=maximum and float(value)==floor(float(value))
static func _valid(value)->bool:
	if not value is Dictionary or value.size()!=FIELDS.size() or not value.keys().all(func(key):return key in FIELDS) or not _integer(value.get("schema"),1) or value.schema!=1: return false
	for key in ["discovered","completed","medal"]:
		if not value[key] is bool: return false
	for key in ["revision","stage","shots","bestShots","replays"]:
		if not _integer(value[key],100000000 if key=="revision" else 1000000): return false
	if value.stage>3 or value.shots<value.stage or value.completed!=(value.stage==3): return false
	if value.medal!=(value.bestShots>=3) or (value.completed and not value.medal): return false
	if value.completed and value.bestShots>value.shots: return false
	if (value.stage>0 or value.shots>0 or value.medal) and not value.discovered: return false
	return true
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
	if best!=null:
		state=best
		for key in ["revision","stage","shots","bestShots","replays"]: state[key]=int(state[key])
func save_progress()->bool:
	if not persistence_enabled: return true
	var file=FileAccess.open(save_path+".tmp",FileAccess.WRITE)
	if file==null: push_warning("BANKSHOT_SAVE cannot write snapshot"); return false
	file.store_string(JSON.stringify(state)); file.flush(); var error=file.get_error(); file.close()
	if error!=OK or _read(save_path+".tmp")==null: push_warning("BANKSHOT_SAVE invalid temporary snapshot"); return false
	if _read(save_path)!=null and DirAccess.copy_absolute(save_path,save_path+".bak")!=OK: push_warning("BANKSHOT_SAVE cannot preserve backup"); return false
	if DirAccess.rename_absolute(save_path+".tmp",save_path)!=OK: push_warning("BANKSHOT_SAVE replacement interrupted"); return false
	return true
