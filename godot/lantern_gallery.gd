extends Node
## A gentle six-call lantern parade; only actual releases can earn a hit.
const ART=preload("res://world_zones.gd")
const SCENE=preload("res://workshop_scene.gd")
const CENTER=Vector3(205,0,65)
const LANDING=CENTER+Vector3(0,0,5)
const SAVE="user://lantern_gallery.json"
const FIELDS=["schema","revision","medal","completions","bestShots"]
const NAMES=["AMBER SUN · ROUND","MINT LEAF · DIAMOND","VIOLET WINDOW · SQUARE"]
const COLORS=["ffc66d","83e5b2","c1a3ff"]
const PARADE=[0,2,1,2,0,1]
var game
var court:Node3D
var stand:Node3D
var label:Label3D
var medal:Node3D
var targets:Array[StaticBody3D]=[]
var markers:Array[Node3D]=[]
var state=fresh_state()
var active=false
var stage=0
var shots=0
var current_throw=-1
var last_throw=-1
var motion_clock=0.0
var receiver_ready=false
var persistence_enabled=false
var save_path=SAVE
var save_failed=false

static func fresh_state()->Dictionary:
	return {"schema":1,"revision":0,"medal":false,"completions":0,"bestShots":0}

func setup(owner_game):
	game=owner_game; persistence_enabled=not game.diagnostic_offline and not game.smoke
	if persistence_enabled: load_progress()
	_build(); receiver_ready=game.playful_tools.register_target_receiver(self); _refresh()
	print("LANTERN_GALLERY_READY receiver=",receiver_ready," best=",state.bestShots," persistence=",persistence_enabled)

func _build():
	court=Node3D.new(); court.name="LanternParadeCourt"
	game.adventure.zone_groups.forge_yard.add_child(court); court.position=CENTER
	ART.floor_patch(court,Vector3.ZERO,Vector2(14,18),"6d8275")
	for side in [-1,1]:
		_solid(Vector3(side*6.8,.4,0),Vector3(.2,.8,18),"52645b")
		_solid(Vector3(0,.4,side*8.8),Vector3(13.6,.8,.2),"52645b")
	ART.box(court,Vector3(0,.025,3),Vector3(11.4,.035,.13),"ffe0a0")
	var board=Node3D.new(); court.add_child(board); board.position=Vector3(0,3.85,-3.5)
	ART.box(board,Vector3.ZERO,Vector3(11.2,2.45,.15),"293e3c")
	label=ART.label(board,"",Vector3(0,0,.1),64,"fff2cd"); label.pixel_size=.005
	for i in range(3):
		var target=ART.body(court,_lantern_position(i,0),Vector3(1.3,1.3,.5),"lantern_gallery_target")
		target.name="Lantern"+str(i); targets.append(target)
		if i==0:
			var face=ART.cyl(target,Vector3.ZERO,.54,.18,COLORS[i],"cylinder",.5); face.rotation.x=PI/2
		elif i==1:
			var face=ART.box(target,Vector3.ZERO,Vector3(.77,.77,.18),COLORS[i],.5); face.rotation.z=PI/4
		else: ART.box(target,Vector3.ZERO,Vector3(1.02,1.02,.18),COLORS[i],.5)
		ART.cyl(target,Vector3(0,.74,0),.045,.34,"d6b875")
		ART.cyl(target,Vector3(0,-.75,0),.07,.4,COLORS[i])
		ART.label(target,NAMES[i],Vector3(0,-1.08,.03),30,COLORS[i]).pixel_size=.005
		var marker=Node3D.new(); target.add_child(marker); markers.append(marker)
		ART.label(marker,"THROW HERE",Vector3(0,.99,.08),32,"fff4c5").pixel_size=.005
		for side in [-1,1]: ART.box(marker,Vector3(side*.78,0,0),Vector3(.065,.62,.09),"fff4c5",.7)
	stand=Node3D.new(); court.add_child(stand); stand.position=Vector3(-4.9,0,4.5)
	ART.cyl(stand,Vector3(0,.5,0),.3,1,"6c7463")
	ART.cyl(stand,Vector3(0,1.05,0),.44,.12,"d6b875")
	var body=ART.body(stand,Vector3(0,.55,0),Vector3(.75,1.1,.75),"playful_ring_stand"); body.set_meta("playful_ring_stand",true)
	ART.label(stand,"SUNSKIPPER\nGrip / E: retrieve",Vector3(0,1.75,0),25).pixel_size=.004
	var controls=ART.label(court,"COURTYARD POWER\nGrip / E: take or throw\nTrigger / click: power or recall\nStand behind the gold line\nSix called lanterns. No time limit.",Vector3(4.5,2.2,4),24,"fff0cb"); controls.pixel_size=.0042
	_button(Vector3(-2.3,1.05,3.8),"start","START",1.9)
	_button(Vector3(0,1.05,3.8),"retry","PLAY AGAIN",2.1)
	_button(Vector3(2.3,1.05,3.8),"abandon","PUT AWAY",1.9)
	_button(Vector3(4.8,1.05,7.9),"leave","BELLWORKS",2.1)
	medal=Node3D.new(); court.add_child(medal); medal.position=Vector3(-4.7,1.2,7.6)
	ART.cyl(medal,Vector3(0,-.6,0),.3,.8,"77634d")
	ART.cyl(medal,Vector3.ZERO,.3,.1,"ffd37c","cylinder",.5).rotation.x=PI/2
	ART.label(medal,"PARADE KEEPER",Vector3(0,.58,0),24).pixel_size=.004
	if game.get("playful_feedback")!=null:
		game.playful_feedback.register_hint("lantern_gallery",stand,"LANTERN PARADE","E: throw | Click: power / recall | Match the called shape","Release grip: throw | Trigger: power / recall | Match the called shape",Vector3(0,2.3,0))

func _solid(position,size,color):
	ART.box(court,position,size,color); ART.body(court,position,size,"solid")
func _button(position,action,title,width):
	var node=Node3D.new(); court.add_child(node); node.position=position
	node.set_meta("kind","button"); node.set_meta("action","lantern_gallery:"+action)
	ART.box(node,Vector3.ZERO,Vector3(width,.38,.12),"467464")
	SCENE.collision(node,Vector3.ZERO,Vector3(width,.38,.12))
	ART.label(node,title,Vector3(0,0,.075),25).pixel_size=.004

func try_grab(hand,desktop=false)->bool:
	if not is_instance_valid(hand) or not is_instance_valid(stand) or not stand.is_visible_in_tree(): return false
	if hand.global_position.distance_to(stand.global_position+Vector3.UP*1.15)>(1.8 if desktop else .48): return false
	return game.playful_tools.retrieve(hand)

func act(action:String):
	match action:
		"visit":
			if game.living.safe_travel(LANDING): _notice("Lantern Parade: start a round, then match the named shape. Six gentle throws; take all the time you need.")
		"start","retry":
			if not receiver_ready: _notice("The ring receiver is unavailable. Leave and reopen this activity."); return
			if action=="start" and active: _notice("Your parade is already playing. Follow the called lantern or choose PLAY AGAIN."); return
			_abort(); active=true; _refresh(); _notice("First lantern: "+NAMES[PARADE[0]]+". COURTYARD power works well; aim slightly up.")
		"abandon": _abort(); _refresh(); _notice("Parade put away. Your medal and best score stay yours.")
		"leave":
			if game.living.safe_travel(Vector3(120,0,70)): _abort(); _refresh()

func _abort():
	active=false; stage=0; shots=0; current_throw=-1; motion_clock=0
	for i in range(targets.size()): targets[i].position=_lantern_position(i,0)

func _lantern_position(index:int,time:float)->Vector3:
	return Vector3((index-1)*2.8+sin(time*.55+index*2.0)*.48,1.85+sin(time*.7+index*1.3)*.18,-2.0)

func tick(delta):
	if not is_finite(delta) or delta<0: return
	motion_clock=fmod(motion_clock+minf(delta,.25),TAU*20)
	for i in range(targets.size()): targets[i].position=_lantern_position(i,motion_clock)
	if active and game.camera.global_position.distance_to(CENTER)>25: _abort(); _refresh()

func _in_lane(position)->bool:
	if not position is Vector3 or not position.is_finite(): return false
	var local:Vector3=position-CENTER
	return absf(local.x)<=5.7 and local.z>=3 and local.z<=8.3 and local.y>=0 and local.y<=4

func on_throw(context:Dictionary):
	var id=context.get("throwId",-1)
	if not _integer(id,9007199254740991) or int(id)<=last_throw: return
	last_throw=int(id); current_throw=-1
	if not active or not _in_lane(context.get("launchPosition")): return
	if shots>=1000000: _notice("A full million throws! Choose PLAY AGAIN for another parade."); return
	current_throw=int(id); shots+=1; _refresh()

func hit_target(collider,position:Vector3,velocity:Vector3,context:Dictionary)->bool:
	var index=targets.find(collider)
	if index<0: return false
	var id=context.get("throwId",-1)
	var valid=active and _integer(id,9007199254740991) and int(id)==current_throw and _in_lane(context.get("launchPosition"))
	valid=valid and velocity.is_finite() and velocity.length()>=1 and position.is_finite()
	if not valid: return true
	current_throw=-1
	if index!=PARADE[stage]:
		_notice("That was "+NAMES[index]+". Look for "+NAMES[PARADE[stage]]+" with the bright brackets. No hurry.")
		_pulse(position,"warning"); return true
	stage+=1
	if stage==PARADE.size():
		active=false; state.medal=true; state.completions=mini(1000000,int(state.completions)+1)
		if state.bestShots==0 or shots<state.bestShots: state.bestShots=shots
		state.revision=mini(100000000,int(state.revision)+1); save_failed=not save_progress()
		print("LANTERN_GALLERY_COMPLETE shots=",shots," best=",state.bestShots," save_failed=",save_failed)
		_notice("Parade keeper medal! Six lanterns in %d throws. Best: %d. Play again whenever you like."%[shots,state.bestShots]); _pulse(position,"reward")
	else:
		_notice("Lantern %d of 6! Next: "%stage+NAMES[PARADE[stage]]); _pulse(position,"progress")
	_refresh(); return true

func _refresh():
	if label==null: return
	for i in range(markers.size()): markers[i].visible=active and i==PARADE[mini(stage,5)]
	medal.visible=state.medal
	var heading="LANTERN PARADE · SIX FRIENDLY LIGHTS"
	var callout="Choose START. Match name, shape and color."
	if active: callout="CALL %d / 6: "%[stage+1]+NAMES[PARADE[stage]]
	elif stage==6: callout="PARADE COMPLETE · MEDAL EARNED"
	label.text=heading+"\n"+callout+"\nThrows: %d  ·  Best: %s  ·  No time limit"%[shots,str(state.bestShots) if state.bestShots>0 else "not set"]
	if save_failed: label.text+="\nSave unavailable; keep this session open."

func _notice(message):
	if game!=null: game._notice(message,7)
func _pulse(position,kind):
	if game!=null and game.get("playful_feedback")!=null: game.playful_feedback.pulse(position,kind)
func progress_snapshot()->Dictionary: return state.duplicate(true)
func restore_progress(data)->bool:
	if not _valid(data): return false
	state=data.duplicate(true)
	for key in ["schema","revision","completions","bestShots"]: state[key]=int(state[key])
	_abort(); _refresh(); return true
static func _integer(value,maximum)->bool:
	return (value is int or value is float) and is_finite(float(value)) and value>=0 and value<=maximum and float(value)==floor(float(value))
static func _valid(value)->bool:
	if not value is Dictionary or value.size()!=FIELDS.size() or not value.keys().all(func(key):return key in FIELDS) or not _integer(value.get("schema"),1) or value.schema!=1: return false
	if not value.medal is bool: return false
	for key in ["revision","completions","bestShots"]:
		if not _integer(value[key],100000000 if key=="revision" else 1000000): return false
	if value.medal!=(value.completions>0): return false
	return value.bestShots>=6 if value.medal else value.bestShots==0
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
