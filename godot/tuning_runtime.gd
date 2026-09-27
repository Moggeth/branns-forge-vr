extends Node
## Small live parameter layer. The service owns validation/persistence/history.
const DEFAULTS = {
"crossbow.gravity":4.0,"crossbow.drag":0.12,"crossbow.trigger_break":0.72,"crossbow.bolt_lifetime":120.0,"crossbow.bolt_cap":20.0,"grapple.reel_speed":2.8,
"crossbow.bolt_speed":44.0,"crossbow.crank_reach":0.13,"crossbow.load_reach":0.19,"crossbow.damage":95.0,
"enemy.stride":1.0,"enemy.bob":1.0,"enemy.turn_speed":5.0,"enemy.windup":1.2,"enemy.recovery":2.5,"enemy.recoil":1.0,"enemy.death_scatter":1.0,
"grip.secondary_reach":0.18,"holster.reach":0.2,"holster.height":0.65,
"input.grip_press":0.6,"input.grip_release":0.5,"hands.pitch_degrees":-90.0,"hands.yaw_degrees":0.0,"hands.roll_degrees":0.0,"player.eye_height":1.7,
"bomb.formation_seconds":0.45,"bomb.radius":0.095,
"throw.gain":1.45,"throw.window_seconds":0.12,"throw.assist_lift":0.65,"throw.min_speed":1.0,"throw.max_speed":18.0,
"bomb.fuse_seconds":3.0,"bomb.impact_delay":0.85,"bomb.bounce":0.25,"bomb.gravity":1.0,
"bomb.blast_radius":3.2,"bomb.damage":45.0,"bomb.self_damage_ratio":0.65,
"vfx.intensity":1.0,"vfx.duration":0.75,"vfx.spark_count":24,"audio.volume":0.65,"haptics.strength":1.0,
"locomotion.speed":2.7,"combat.enemy_speed":1.0,
"playful.ring_curve":4.2,"playful.ring_drag":0.025,"playful.ring_recall_accel":28.0,"playful.ring_bounce":0.84,
"playful.ring_toss_gain":1.0,"playful.ring_gravity":1.1,"playful.ring_recall_speed":18.0,
"playful.magnet_range":4.5,"playful.magnet_pull":22.0,"playful.magnet_fling":4.2}
var game
var values=DEFAULTS.duplicate()
var runtime_overrides={}
var schema={}
var revision=-1
var page_index=0
var pending=false
var dragging=""
var draft_value=0.0
var drag_revision=-1
var slider_nodes={}
var last_throw={}
var history={}
const QUICK_KEYS=["input.grip_press","input.grip_release","throw.gain","locomotion.speed","player.eye_height","hands.pitch_degrees","hands.yaw_degrees","hands.roll_degrees"]
var quick_mode=false
var group_filter=""

func setup(owner_game):
	game=owner_game
	# Offline sliders still need the same bounds/steps as the connected service.
	var packaged=JSON.parse_string(FileAccess.get_file_as_string("res://tuning_schema.json"))
	if packaged is Dictionary: schema=packaged
	else: push_error("TUNING packaged schema missing or invalid; local edits are unavailable.")
	if game.get("lab_mode")==true or OS.get_cmdline_user_args().has("--playful-demo"):
		revision=0

func value(key:String)->float:
	return float(runtime_overrides.get(key,values.get(key,DEFAULTS.get(key,0.0))))

func ingest(snapshot):
	if not snapshot is Dictionary or not snapshot.has("values"): return
	if int(snapshot.get("revision",-1))==revision: return
	revision=int(snapshot.revision)
	for key in DEFAULTS:
		if snapshot.values.has(key): values[key]=snapshot.values[key]
	schema=snapshot.get("schema",{})
	print("TUNING applied revision=",revision)
	if game.qol!=null and game.qol.opened and game.qol.page in ["tuning","quick"] and dragging.is_empty():
		game.qol._build()

func sample(hand,velocity:Vector3,angular:Vector3):
	var key=str(hand.get_instance_id())
	if not history.has(key): history[key]=[]
	var samples:Array=history[key]
	samples.append({"t":game.elapsed,"v":velocity,"a":angular})
	while samples.size()>40 or (not samples.is_empty() and game.elapsed-float(samples[0].t)>0.3):
		samples.pop_front()

func estimate(samples:Array,current:Vector3)->Vector3:
	# Preserve the strongest recent deliberate motion when release is slightly late.
	var chosen=current
	for sample_value in samples:
		if game.elapsed-float(sample_value.t)<=value("throw.window_seconds") and sample_value.v.length()>chosen.length():
			chosen=sample_value.v
	if chosen.length()<value("throw.min_speed"):
		return current.limit_length(value("throw.max_speed"))
	return (chosen*value("throw.gain")+Vector3.UP*value("throw.assist_lift")).limit_length(value("throw.max_speed"))

func release_velocity(hand,desktop=false)->Vector3:
	var key=str(hand.get_instance_id())
	var current:Vector3=game.adventure.motion.get(key,{}).get("velocity",Vector3.ZERO)
	var result=Vector3.ZERO
	if desktop:
		result=(-game.camera.global_basis.z*9.0*value("throw.gain")+Vector3.UP*(1.8+value("throw.assist_lift"))).limit_length(value("throw.max_speed"))
	else:
		result=estimate(history.get(key,[]),current)
	last_throw={"rawSpeed":snappedf(current.length(),0.01),"launchSpeed":snappedf(result.length(),0.01),"velocity":game._vec(result),"revision":revision,"zone":game.adventure.zone}
	print("THROW ",JSON.stringify(last_throw))
	history.erase(key)
	return result

func _keys():
	if not group_filter.is_empty():
		return DEFAULTS.keys().filter(func(key):return str(key).begins_with(group_filter+"."))
	return DEFAULTS.keys()

func build_menu(quick=false):
	if quick_mode!=quick: page_index=0
	quick_mode=quick
	slider_nodes.clear()
	var keys=QUICK_KEYS if quick else _keys()
	page_index=posmod(page_index,int(ceil(keys.size()/5.0)))
	var start=page_index*5
	for index in range(start,mini(start+5,keys.size())):
		var key=keys[index]
		var entry=schema.get(key,{})
		var row=index-start
		var label=str(entry.get("label",key.get_slice(".",1).replace("_"," ").capitalize()))
		var text=game.qol._label(game.qol.menu,label+"  "+str(values[key]),Vector3(0,0.19-row*0.082,0.025),16)
		game.qol.buttons.append(text)
		var body=StaticBody3D.new()
		body.collision_layer=4
		game.qol.menu.add_child(body)
		body.position=Vector3(0,0.158-row*0.082,0.015)
		body.set_meta("action","qol:slider:"+key)
		var shape=CollisionShape3D.new()
		var box=BoxShape3D.new()
		box.size=Vector3(0.64,0.032,0.032)
		shape.shape=box
		body.add_child(shape)
		game.adventure._box(body,Vector3.ZERO,Vector3(0.64,0.013,0.012),Color("527477"))
		var knob=game.adventure._box(body,Vector3.ZERO,Vector3(0.016,0.031,0.025),Color("eac681"))
		game.qol.buttons.append(body)
		slider_nodes[key]={"body":body,"knob":knob,"label":text}
		_show_value(key,values[key])
	var return_to_all=not quick and not group_filter.is_empty() and page_index==0
	game.qol._button("All settings" if return_to_all else "Previous","tune:all" if return_to_all else "tune:prev",Vector3(-0.245,-0.25,0.015),0.23)
	game.qol._button("Next","tune:next",Vector3(0,-0.25,0.015),0.23)
	game.qol._button("Undo last","tune:undo",Vector3(0.245,-0.25,0.015),0.23)

func grip_state(amount:float,was_gripped:bool,click=false)->bool:
	var press=value("input.grip_press")
	var release=minf(value("input.grip_release"),press-0.05)
	return click or amount>(release if was_gripped else press)

func _show_value(key,n):
	if not slider_nodes.has(key): return
	var entry=schema.get(key,{})
	var lo=float(entry.get("min",0))
	var hi=float(entry.get("max",maxf(DEFAULTS[key]*2,1)))
	slider_nodes[key].knob.position.x=(inverse_lerp(lo,hi,float(n))-0.5)*0.64
	slider_nodes[key].label.text=str(entry.get("label",key.get_slice(".",1).replace("_"," ").capitalize()))+"  "+str(snappedf(n,0.001))

func slider_input(source,pressed:bool):
	if pressed:
		var query=PhysicsRayQueryParameters3D.create(source.global_position,source.global_position-source.global_basis.z*5,4)
		var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
		var target=game._owner(hit.get("collider"))
		if target!=null and str(target.get_meta("action","")).begins_with("qol:slider:"):
			var key=str(target.get_meta("action")).trim_prefix("qol:slider:")
			if pending: return
			if dragging.is_empty(): drag_revision=revision
			dragging=key
			var entry=schema.get(key,{})
			var local_point=target.to_local(hit.position)
			var fraction=clampf(local_point.x/0.64+0.5,0,1)
			draft_value=snappedf(lerpf(float(entry.get("min",0)),float(entry.get("max",1)),fraction),float(entry.get("step",0.01)))
			_show_value(key,draft_value)
	elif not dragging.is_empty():
		var key=dragging
		dragging=""
		commit({"values":{key:draft_value},"expectedRevision":drag_revision})

var local_undo=[]

func commit(body:Dictionary):
	if game.lab_mode or OS.get_cmdline_user_args().has("--playful-demo"):
		_commit_local(body)
		return
	if pending: return
	if game.diagnostic_offline: return
	if revision<0:
		game._notice("Tuning service is not connected yet.")
		return
	pending=true
	if not body.has("expectedRevision"): body["expectedRevision"]=revision
	var response=await game._request("/api/vr/tuning",body)
	pending=false
	if response.has("error"):
		game._notice("Tuning not applied: "+str(response.error))
		await game._poll()
	else:
		ingest(response)
		game._notice("Tuning saved · revision %d."%revision,5)

func _commit_local(body:Dictionary)->bool:
	# Validate the entire request before creating undo history or changing any value.
	for key in body:
		if key not in ["values","action","expectedRevision"]: return _local_reject("Unknown tuning request.")
	if body.has("expectedRevision"):
		var expected=body.expectedRevision
		if typeof(expected) not in [TYPE_INT,TYPE_FLOAT] or not is_finite(float(expected)) or expected!=revision:
			return _local_reject("Tuning changed. Try the slider again.")
	if body.has("values")==body.has("action"): return _local_reject("Choose an edit or undo.")
	var next=values.duplicate()
	var undo=body.get("action","")=="undo"
	if body.has("action"):
		if not undo: return _local_reject("Unknown local tuning action.")
		if local_undo.is_empty(): return _local_reject("No earlier tuning to restore.")
		next=local_undo.back().duplicate()
	else:
		if not body.values is Dictionary or body.values.is_empty(): return _local_reject("No tuning values supplied.")
		for key in body.values:
			if not DEFAULTS.has(key) or not schema.has(key): return _local_reject("Unknown tuning setting.")
			var candidate=body.values[key]
			if typeof(candidate) not in [TYPE_INT,TYPE_FLOAT] or not is_finite(float(candidate)):
				return _local_reject("Tuning needs a finite number.")
			var rule=schema[key]
			if candidate<rule.min or candidate>rule.max or (rule.get("type","")=="integer" and candidate!=floor(candidate)):
				return _local_reject("That tuning value is outside its limits.")
			next[key]=candidate
	if next==values: return false
	if undo: local_undo.pop_back()
	else:
		local_undo.append(values.duplicate())
		if local_undo.size()>20: local_undo.pop_front()
	values=next
	revision+=1
	if game.get("qol")!=null: game.qol._build()
	var message="Animation lab tuning applied for this session." if game.get("lab_mode")==true else "Demo tuning applied for this session."
	var adapter=game.get("demo_session")
	if adapter!=null and adapter.has_method("save_now"):
		if adapter.save_now(): message="Demo tuning saved."
		else: message="Tuning applied; "+str(adapter.status_text()) if adapter.has_method("status_text") else "Tuning applied, but demo save failed."
	game._notice(message,5)
	print("TUNING local revision=",revision," undo_depth=",local_undo.size())
	return true

func _local_reject(message:String)->bool:
	game._notice(message,4)
	return false

func action(value_text):
	match value_text:
		"playful": group_filter="playful"; page_index=0; quick_mode=false
		"all": group_filter=""; page_index=0
		"prev": page_index-=1
		"next": page_index+=1
		"undo": commit({"action":"undo"})
	game.qol._build()
