extends Node
## Three bounded cargo bodies, tactile sorting and a persistent copper-flower reward.
const ART=preload("res://world_zones.gd")
const SCENE=preload("res://workshop_scene.gd")
const CENTER=Vector3(140,0,65)
const LANDING=Vector3(136,0,65)
const NAMES=["SUN","LEAF","MOON"]
const COLORS=["f3bd63","8ec89a","ada6ef"]
const SAVE="user://copper_kite_cargo.json"
var game
var cargo_root:Node3D
var bodies:Array=[]
var homes:Array=[]
var nests:Array=[]
var settled=[0.0,0.0,0.0]
var indicators:Array=[]
var indicator_states=[false,false,false]
var indicator_materials:Array=[]
var indicator_updates=0
var petals:Array=[]
var lever_pivot:Node3D
var lever_handle:Node3D
var lever_holder:Node3D
var lever_grab_position=Vector3.ZERO
var lever_pull=0.0
var lever_fired=false
var trophy:Node3D
var label:Label3D
var state={"schema":1,"revision":0,"discovered":false,"earned":false,"rounds":0}
var clock=0.0
var bloom=0.0
var launched=false
var can_launch=false
var ready_before=false
var registered=false
var persistence_enabled=false
var save_path=SAVE
var save_failed=false
var last_return_notice=-10.0

func setup(owner_game):
	game=owner_game; persistence_enabled=not game.diagnostic_offline and not game.smoke
	if persistence_enabled: load_progress()
	_build(); register_with_wand(); _refresh()
	print("CARGO_READY bodies=",bodies.size()," earned=",state.earned," persistence=",persistence_enabled)

func _build():
	indicator_materials=[ART.mat("7a7161"),ART.mat("b7ed9c",.3)]
	cargo_root=Node3D.new(); cargo_root.name="CopperKiteCargo"
	game.adventure.zone_groups.forge_yard.add_child(cargo_root); cargo_root.position=CENTER
	ART.floor_patch(cargo_root,Vector3.ZERO,Vector2(12,14),"a59071")
	# A broad level bridge crosses the gap to Bellworks' east-side opening.
	ART.floor_patch(cargo_root,Vector3(-9.5,0,0),Vector2(9,3),"b0a080")
	for side in [-1,1]:
		_solid(Vector3(-9.5,.4,side*1.55),Vector3(9,.8,.15),"75593e")
		_solid(Vector3(5.85,.45,side*3.4),Vector3(.15,.9,6.5),"75593e")
		_solid(Vector3(0,.45,side*6.85),Vector3(12,.9,.15),"75593e")
		_solid(Vector3(-5.85,.45,side*4.3),Vector3(.15,.9,5.1),"75593e")
	ART.label(cargo_root,"COPPER KITE CARGO",Vector3(0,3.8,-4.8),42,"ffe6ac")
	ART.label(cargo_root,"Build a little balance. Grow a little wonder.",Vector3(0,3.35,-4.8),23)
	_solid(Vector3(0,.6,3),Vector3(6,.22,1.6),"695343")
	for x in [-2.6,2.6]: _solid(Vector3(x,.3,3),Vector3(.22,.6,1.2),"685441")
	for i in range(3):
		var nest=Vector3((i-1)*2.0,0,-2)
		nests.append(nest+Vector3(0,.85,0))
		_solid(nest+Vector3(0,.46,0),Vector3(1.45,.24,1.45),"69513d")
		for side in [-1,1]:
			_solid(nest+Vector3(side*.65,.64,0),Vector3(.12,.2,1.45),"b78f57")
			_solid(nest+Vector3(0,.64,side*.65),Vector3(1.2,.2,.12),"b78f57")
		ART.box(cargo_root,nest+Vector3(0,.587,0),Vector3(1.15,.014,1.15),COLORS[i])
		ART.label(cargo_root,NAMES[i]+" · "+str(i+1),nest+Vector3(0,1.32,-.7),23,COLORS[i])
		indicators.append(ART.rock(cargo_root,nest+Vector3(0,.48,.9),Vector3(.15,.15,.15),"7a7161"))
		indicators[-1].material_override=indicator_materials[0]
		var body=RigidBody3D.new(); body.name="Cargo"+NAMES[i]; cargo_root.add_child(body)
		body.mass=.6; body.collision_layer=8; body.collision_mask=9
		body.continuous_cd=true; body.linear_damp=.5; body.angular_damp=1.2
		body.set_meta("kind","cargo_block"); body.set_meta("cargo_id",i)
		var physics=PhysicsMaterial.new(); physics.friction=.8; physics.bounce=.05; body.physics_material_override=physics
		var shape=CollisionShape3D.new(); var box=BoxShape3D.new(); box.size=Vector3.ONE*.48; shape.shape=box; body.add_child(shape)
		ART.box(body,Vector3.ZERO,Vector3.ONE*.48,COLORS[i])
		for side in [-1,1]: ART.box(body,Vector3(0,side*.243,0),Vector3(.5,.022,.13),"dcc598")
		var face=ART.label(body,NAMES[i],Vector3(0,0,.247),19,"302f36"); face.pixel_size=.003
		var top=ART.label(body,str(i+1),Vector3(0,.257,0),30,"302f36"); top.rotation.x=-PI/2; top.pixel_size=.004
		homes.append(Vector3((i-1)*1.7,1.0,3)); body.position=homes[i]; bodies.append(body)
	var board=Node3D.new(); cargo_root.add_child(board); board.position=Vector3(0,1.3,5.2)
	ART.box(board,Vector3.ZERO,Vector3(5.4,1.4,.1),"30494a")
	label=ART.label(board,"",Vector3(0,0,.06),23); label.pixel_size=.0037
	_button(Vector3(3.9,.78,1.32),"launch","GROW COPPER BLOOM",2.1)
	_button(Vector3(0,.39,5.3),"reset","RESET THREE CARGO BLOCKS",3.2)
	var lever=Node3D.new(); cargo_root.add_child(lever); lever.position=Vector3(3.9,.75,1)
	ART.cyl(lever,Vector3.ZERO,.23,.7,"6d5541")
	lever_pivot=Node3D.new(); lever.add_child(lever_pivot); lever_pivot.position.y=.2; lever_pivot.rotation.x=-.45
	ART.box(lever_pivot,Vector3(0,.25,0),Vector3(.08,.5,.08),"c69954")
	lever_handle=ART.rock(lever_pivot,Vector3(0,.5,0),Vector3(.32,.18,.18),"e6c375")
	ART.label(lever,"GRIP + PULL TOWARD YOU\nOr point and click the button",Vector3(0,1.12,0),17).pixel_size=.003
	ART.cyl(cargo_root,Vector3(0,1,-5),.13,2,"668369")
	for i in range(6):
		var pivot=Node3D.new(); cargo_root.add_child(pivot); pivot.position=Vector3(0,2,-5); pivot.rotation.y=i*TAU/6
		var petal=ART.rock(pivot,Vector3(0,.4,.3),Vector3(.52,1.3,.20),COLORS[i%3]); petals.append({"pivot":pivot,"petal":petal})
	ART.rock(cargo_root,Vector3(0,2,-5),Vector3(.4,.4,.4),"ffe0a2")
	trophy=Node3D.new(); cargo_root.add_child(trophy); trophy.position=Vector3(4.0,1.3,-4)
	ART.cyl(trophy,Vector3(0,-.55,0),.37,.7,"76634d")
	for i in range(5):
		var angle=i*TAU/5
		ART.rock(trophy,Vector3(cos(angle)*.22,.05,sin(angle)*.22),Vector3(.25,.12,.25),"f5c96d")
	ART.rock(trophy,Vector3(0,.14,0),Vector3(.2,.25,.2),"ffe4a6")
	ART.label(trophy,"COPPER GARDENER\nEarned by careful hands",Vector3(0,.75,0),20)
	if game.get("playful_feedback")!=null:
		game.playful_feedback.register_hint("copper-cargo",board,"COPPER KITE CARGO","Click: pull / gently drop. X: toss. E: put wand away.","Trigger: pull / gently drop. A: toss. Release grip: put away.",Vector3(0,1.15,0))

func _solid(pos,size,color):
	ART.box(cargo_root,pos,size,color); ART.body(cargo_root,pos,size,"solid")

func _button(pos,action,title,width):
	var node=Node3D.new(); cargo_root.add_child(node); node.position=pos
	node.set_meta("kind","button"); node.set_meta("action","cargo:"+action)
	ART.box(node,Vector3.ZERO,Vector3(width,.29,.10),"477568")
	SCENE.collision(node,Vector3.ZERO,Vector3(width,.29,.10))
	var text=ART.label(node,title,Vector3(0,0,.06),20); text.pixel_size=.0032

func register_with_wand():
	if registered or game==null or game.get("magnetic_wand")==null: return
	var all_ok=true
	for body in bodies:
		if not game.magnetic_wand.register_body(body,cargo_root): all_ok=false
	registered=all_ok

func busy(hand)->bool: return is_instance_valid(lever_holder) and lever_holder==hand

func _hand_free(hand)->bool:
	if not is_instance_valid(hand): return false
	var held=game.get("held")
	if held is Dictionary and held.has(str(hand.get_instance_id())): return false
	for name in ["living","firecraft","siegebird","workshop","enchantments","playful_tools","magnetic_wand","echo_bells"]:
		var system=game.get(name)
		if system!=null and system.has_method("busy") and system.busy(hand): return false
	var adventure=game.get("adventure")
	var formation=adventure.get("formation")
	return not (formation is Dictionary and formation.has(str(hand.get_instance_id())))

func try_grab(hand,desktop=false)->bool:
	if desktop or not _hand_free(hand): return false
	if busy(hand): return true
	if is_instance_valid(lever_holder) or hand.global_position.distance_to(lever_handle.global_position)>.24: return false
	lever_holder=hand; lever_grab_position=hand.global_position; lever_fired=false
	_haptic(hand,"ready")
	return true

func release(hand)->bool:
	if not busy(hand): return false
	_haptic(hand,"release"); lever_holder=null; lever_fired=false
	return true

func _tick_lever(delta):
	if is_instance_valid(lever_holder):
		if not _hand_free(lever_holder) or lever_holder.global_position.distance_to(lever_handle.global_position)>.55:
			release(lever_holder)
		else:
			lever_pull=clampf((lever_holder.global_position-lever_grab_position).dot(cargo_root.global_basis.z)/.34,0,1)
			if lever_pull>=.76 and not lever_fired:
				lever_fired=true
				var accepted=can_launch and not launched
				act("launch"); _haptic(lever_holder,"ready" if accepted else "impact")
				_pulse(lever_handle.global_position,"progress" if accepted else "warning")
	else: lever_pull=move_toward(lever_pull,0.0,delta*3.5)
	lever_pivot.rotation.x=lerpf(-.45,.80,lever_pull)

func _haptic(hand,event):
	var adventure=game.get("adventure")
	if adventure is Object and adventure.has_method("haptic"): adventure.haptic(hand,event)

func tick(delta):
	clock+=delta; register_with_wand()
	if not state.discovered and game.camera.global_position.distance_to(CENTER+Vector3(0,1.6,0))<6:
		state.discovered=true; _changed()
	for i in range(bodies.size()):
		var body=bodies[i]
		if body.position.y< -2 or absf(body.position.x)>8 or absf(body.position.z)>9:
			_return_body(i)
			if clock-last_return_notice>4: _notice("Stray cargo returned to the starting tray."); last_return_notice=clock
		var local=body.position-nests[i]
		var held=game.get("magnetic_wand")!=null and game.magnetic_wand.get("target")==body
		var resting=not held and absf(local.x)<.46 and absf(local.z)<.46 and absf(local.y)<.20 and body.linear_velocity.length()<.22 and body.angular_velocity.length()<.5
		settled[i]=minf(1.1,settled[i]+delta) if resting else 0.0
		var lit=settled[i]>=1
		if indicator_states[i]!=lit:
			indicator_states[i]=lit; indicator_updates+=1
			indicators[i].material_override=indicator_materials[1 if lit else 0]
	can_launch=settled.all(func(seconds):return seconds>=1)
	_tick_lever(delta)
	if can_launch and not ready_before and not launched: _notice("All three nests balanced. Press the bloom lever!"); _pulse(CENTER+Vector3(0,1,-2),"progress")
	ready_before=can_launch
	bloom=move_toward(bloom,1.0 if launched else 0.0,delta*.65)
	for entry in petals: entry.petal.rotation.x=lerpf(-.1,1.05,bloom)
	trophy.visible=state.earned
	trophy.rotation.y=sin(clock*.6)*.15
	_refresh()

func act(action:String):
	if action=="visit":
		if game.living.safe_travel(LANDING) and not state.discovered: state.discovered=true; _changed()
	elif action=="reset":
		if is_instance_valid(lever_holder): release(lever_holder)
		for i in range(bodies.size()): _return_body(i)
		launched=false; can_launch=false; ready_before=false; _refresh()
		_notice("Three fresh parcels. Your earned flower stays yours.")
	elif action=="launch":
		if launched: _notice("The copper flower is already blooming. Reset the cargo for another delivery."); return
		if not can_launch: _notice("Settle SUN, LEAF and MOON in their matching nests first. Let them rest for a moment."); return
		launched=true; state.discovered=true; state.earned=true; state.rounds+=1; _changed()
		_notice("Copper Gardener earned! Your careful delivery brought the flower to life.")
		_pulse(CENTER+Vector3(0,2,-5),"reward")

func _return_body(index):
	var body=bodies[index]
	if game.get("magnetic_wand")!=null: game.magnetic_wand.release_target(body)
	body.linear_velocity=Vector3.ZERO; body.angular_velocity=Vector3.ZERO
	body.position=homes[index]; body.rotation=Vector3.ZERO; body.sleeping=false; settled[index]=0.0

func _refresh():
	if label==null: return
	var count=settled.filter(func(seconds):return seconds>=1).size()
	label.text="Match SUN, LEAF and MOON to their nests.\nPull with the wand; gently drop each parcel.\nResting safely: %d / 3 · %s"%[count,"BLOOM DELIVERED" if launched else ("PRESS THE BLOOM LEVER" if can_launch else "No timer. Take your time.")]
	if save_failed: label.text+="\nSave unavailable; keep this session open."
	trophy.visible=state.earned

func progress_snapshot()->Dictionary:
	var result=state.duplicate(true); result["ready"]=can_launch; result["launched"]=launched; result["settled"]=settled.duplicate(); result["body_count"]=bodies.size(); return result

func _notice(text):
	if game!=null: game._notice(text,5)

func _pulse(pos,kind):
	if game!=null and game.get("playful_feedback")!=null: game.playful_feedback.pulse(pos,kind)

func _changed():
	state.revision+=1; save_failed=not save_progress(); _refresh()

func _valid(value)->bool:
	if not value is Dictionary or value.get("schema")!=1 or not value.get("discovered") is bool or not value.get("earned") is bool: return false
	for key in ["revision","rounds"]:
		if not (value.get(key) is int or value.get(key) is float) or not is_finite(float(value[key])) or float(value[key])!=floor(float(value[key])) or value[key]<0 or value[key]>10000000: return false
	return value.earned==(value.rounds>0) and (not value.earned or value.discovered)

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
		state=best; state.revision=int(state.revision); state.rounds=int(state.rounds)

func save_progress()->bool:
	if not persistence_enabled: return true
	var file=FileAccess.open(save_path+".tmp",FileAccess.WRITE)
	if file==null: push_warning("CARGO_SAVE cannot write snapshot"); return false
	file.store_string(JSON.stringify(state)); file.flush(); var error=file.get_error(); file.close()
	if error!=OK or _read(save_path+".tmp")==null: push_warning("CARGO_SAVE invalid temporary snapshot"); return false
	if _read(save_path)!=null and DirAccess.copy_absolute(save_path,save_path+".bak")!=OK: push_warning("CARGO_SAVE cannot preserve backup"); return false
	if DirAccess.rename_absolute(save_path+".tmp",save_path)!=OK: push_warning("CARGO_SAVE replacement interrupted; temporary snapshot retained"); return false
	return true
