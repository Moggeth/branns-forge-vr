extends Node
## The Ember Gallery: tactile finite pouring, fire trails, and gentle discoveries.
const ART=preload("res://world_zones.gd")
const SCENE=preload("res://workshop_scene.gd")
const CENTER=Vector3(250,0,70)
const ZONE="ember_gallery"
const SAVE="user://ember_gallery.json"
const CAPACITY=16.0
var game
var court:Node3D
var art
var vessels=[]
var streams=[]
var badge_lights=[]
var badges=[]
var board:Node3D
var label:Label3D
var state=fresh_state()
var persistence_enabled=false
var clock=0.0
var last_zone=""
var wet_cells=0
var popup_at=0.0
var immersion=1.0
var fluid
var pour_clock=0.0
var lamplighting
var fluid_audio

static func fresh_state()->Dictionary:
	return {"schema":1,"revision":0,"trail":false,"water":false,"discovery":false}
static func _valid(value)->bool:
	if not value is Dictionary or value.size()!=5: return false
	for key in fresh_state():
		if not value.has(key): return false
	for key in ["schema","revision"]:
		if not (value[key] is int or value[key] is float) or not is_finite(float(value[key])) or value[key]!=floorf(value[key]): return false
	if value.schema!=1 or value.revision<0 or value.revision>10000000: return false
	return value.trail is bool and value.water is bool and value.discovery is bool
func progress_snapshot()->Dictionary: return state.duplicate(true)
func restore_progress(value):
	if _valid(value): state=value.duplicate(true); _refresh()
func _save():
	if not persistence_enabled: return
	var f=FileAccess.open(SAVE+".tmp",FileAccess.WRITE)
	if f==null: print("EMBER_SAVE_ERROR open"); return
	f.store_string(JSON.stringify(state)); f.flush(); var error=f.get_error(); f.close()
	if error==OK:
		if FileAccess.file_exists(SAVE): DirAccess.copy_absolute(SAVE,SAVE+".bak")
		if DirAccess.rename_absolute(SAVE+".tmp",SAVE)!=OK: print("EMBER_SAVE_ERROR rename")
func setup(g):
	game=g; fluid=game.firecraft.fluid
	fluid_audio=preload("res://fluid_audio.gd").new(); fluid_audio.setup(self)
	persistence_enabled=not game.diagnostic_offline and not game.smoke
	if persistence_enabled:
		for suffix in ["",".bak"]:
			if FileAccess.file_exists(SAVE+suffix):
				var value=JSON.parse_string(FileAccess.get_file_as_string(SAVE+suffix))
				if _valid(value): state=value; break
	court=Node3D.new(); court.name="EmberGallery"; game.add_child(court); court.position=CENTER
	game.adventure.zone_groups[ZONE]=court
	game.scene.zones[ZONE]={"name":"The Ember Gallery","center":CENTER,"spawn":CENTER+Vector3(0,0,8),"environment":{"ambient_color":"9baed0","ambient_energy":.13,"sun_color":"97b9e0","sun_energy":.06,"sky_top":"111a35","sky_horizon":"263b54","fog_density":.008,"fog_color":"17252d"}}
	art=load("res://ember_gallery_art.gd").new(); art.setup(court)
	board=Node3D.new(); court.add_child(board); board.position=Vector3(3.9,1.9,5.5); board.rotation.y=-.18
	ART.box(board,Vector3.ZERO,Vector3(3.05,2.7,.1),"283b3f")
	for x in [-1.58,1.58]: ART.box(board,Vector3(x,-.75,0),Vector3(.1,4.15,.16),"775b3b")
	for y in [-1.39,1.39]: ART.box(board,Vector3(0,y,0),Vector3(3.25,.09,.16),"b58c56")
	ART.label(board,"THE EMBER GALLERY",Vector3(0,1.14,.08),31,"eecb86").pixel_size=.0037
	label=ART.label(board,"",Vector3(0,.70,.08),22,"ffe4b3"); label.pixel_size=.0033
	_button(Vector3(0,-.15,.14),"bottle","UNLIT BOTTLE",2.55)
	_button(Vector3(0,-.58,.14),"lit_bottle","LIT BOTTLE",2.55)
	_button(Vector3(0,-1.01,.14),"refill","REFILL CANS",2.55)
	_button(Vector3(5,1.2,8),"leave","RETURN TO FORGE",2.5)
	_button(Vector3(-5,1.5,7.5),"comfort","BRIGHTER / MOODY",2.6)
	_vessel("oil",Vector3(-5.55,1.03,5)); _vessel("water",Vector3(-4.5,1.03,5))
	ART.label(court,"OIL & WATER\nGrip / E: pick up or put down\nTrigger: open valve; tilt to pour\nDesktop: click to pour ahead\nTouch fuel with a lit torch to ignite",Vector3(-5,2.45,5),22,"ffe6b0").pixel_size=.0038
	for i in range(3):
		var badge=ART.cyl(board,Vector3(-.58+i*.58,.25,.13),.09,.035,"8e7856","cylinder",.05); badge.rotation.x=PI/2; badges.append(badge)
		var light=OmniLight3D.new(); board.add_child(light); light.position=Vector3(-.58+i*.58,.25,.25); light.light_color=Color("ffd09a"); light.omni_range=2.2; light.light_energy=0; light.shadow_enabled=false; badge_lights.append(light)
	lamplighting=preload("res://gallery_lamplighting.gd").new(); add_child(lamplighting); lamplighting.setup(self)
	_vessel("glimmer",Vector3(-6.3,1.03,5))
	court.visible=game.adventure.zone==ZONE; _refresh()
	print("EMBER_GALLERY_READY fluid=",fluid!=null," persistence=",persistence_enabled)
func _button(at,action,title,width):
	var n=Node3D.new(); (board if action in ["bottle","lit_bottle","refill"] else court).add_child(n); n.position=at; n.set_meta("kind","button"); n.set_meta("action","ember:"+action)
	ART.box(n,Vector3.ZERO,Vector3(width,.34,.13),"48645f"); SCENE.collision(n,Vector3.ZERO,Vector3(width,.34,.13))
	ART.label(n,title,Vector3(0,0,.075),23).pixel_size=.0034
func _vessel(kind,at):
	var n=Node3D.new(); court.add_child(n); n.position=at; n.set_meta("kind","ember_vessel"); n.set_meta("display_name", "Emberdew oil can" if kind=="oil" else ("Moonwater luminous channel can" if kind=="glimmer" else "Stillhouse water can")); n.set_meta("fluid",kind); n.set_meta("remaining",CAPACITY); n.set_meta("open",false); n.set_meta("home",n.global_transform); n.set_meta("zone",ZONE)
	var color="bb7542" if kind=="oil" else ("81c9ff" if kind=="glimmer" else "458a98")
	ART.cyl(n,Vector3(0,.16,0),.12,.3,color)
	ART.cyl(n,Vector3(0,.025,0),.13,.035,"bfa36b")
	ART.cyl(n,Vector3(0,.31,0),.12,.04,"bfa36b")
	ART.cyl(n,Vector3(0,.35,0),.06,.05,"526160")
	var spout=ART.cyl(n,Vector3(0,.28,-.19),.022,.28,"d2b77e"); spout.rotation.x=PI/2
	for x in [-.145,.145]: ART.box(n,Vector3(x,.15,.02),Vector3(.02,.22,.05),"71523b")
	ART.box(n,Vector3(0,.24,.13),Vector3(.2,.025,.04),"d2b77e")
	var text=ART.label(n,"",Vector3(0,.17,.125),20,"fff2c4"); text.pixel_size=.0017; n.set_meta("label",text)
	var area=Area3D.new(); n.add_child(area); area.collision_layer=1; area.collision_mask=0
	var collision=CollisionShape3D.new(); var shape=BoxShape3D.new(); shape.size=Vector3(.34,.42,.38); collision.shape=shape; collision.position.y=.18; area.add_child(collision)
	var stream=ART.cyl(game,Vector3.ZERO,.013,1,"dba758" if kind=="oil" else "78c2db", "cylinder",.12); stream.visible=false
	n.set_meta("stream",stream); vessels.append(n); streams.append(stream); _vessel_label(n)
func _vessel_label(n):
	n.get_meta("label").text=("MOONWATER" if n.get_meta("fluid")=="glimmer" else str(n.get_meta("fluid")).to_upper())+"\n%d%%"%roundi(float(n.get_meta("remaining"))/CAPACITY*100)+(" · OPEN" if n.get_meta("open") else "")
func busy(hand)->bool:
	return is_instance_valid(hand) and game.held.get(str(hand.get_instance_id())) in vessels
func _held(hand): return game.held.get(str(hand.get_instance_id()))
func try_grab(hand,desktop=false)->bool:
	if not is_instance_valid(hand) or game.held.has(str(hand.get_instance_id())): return false
	var chosen=null
	if desktop:
		var hit=game._ray(game.camera,3)
		if hit.has("collider"):
			var owner=game._owner(hit.collider)
			if owner in vessels: chosen=owner
	else:
		var best=.4
		for n in vessels:
			if n in game.held.values() or not n.is_visible_in_tree(): continue
			var dist=hand.global_position.distance_to(n.global_position+Vector3.UP*.15)
			if dist<best: chosen=n; best=dist
	if chosen==null or chosen in game.held.values(): return false
	if chosen.has_meta("body"):
		var body=chosen.get_meta("body"); chosen.reparent(game); chosen.remove_meta("body"); body.queue_free()
	chosen.reparent(game.hand_socket(hand)); chosen.transform=Transform3D.IDENTITY
	if hand is XRController3D:
		var side=1.0 if str(hand.tracker).begins_with("left") else -1.0
		chosen.basis=Basis(Vector3.FORWARD,Vector3.RIGHT*side,Vector3.DOWN*side)
	chosen.position=Vector3(.14,-.2,-.38) if desktop else Vector3(0,-.12,-.03)
	game._set_collisions(chosen,false)
	game.held[str(hand.get_instance_id())]=chosen; chosen.set_meta("open",false); _vessel_label(chosen)
	game.adventure.haptic(hand,"ready"); game._notice("Trigger opens the valve. Tilt to pour; trigger closes. Refill at the gallery bench.",6); return true
func trigger(hand)->bool:
	if not busy(hand): return false
	var n=_held(hand); n.set_meta("open",not n.get_meta("open")); _vessel_label(n); game.adventure.haptic(hand,"release"); return true
func release(hand)->bool:
	if not busy(hand): return false
	var n=_held(hand); n.set_meta("open",false); n.get_meta("stream").visible=false; game.held.erase(str(hand.get_instance_id())); _vessel_label(n)
	game._set_collisions(n,true)
	var b=RigidBody3D.new(); game.add_child(b); b.global_transform=n.global_transform; n.reparent(b); n.set_meta("body",b); n.set_meta("zone",game.adventure.zone)
	b.mass=.6; b.collision_layer=8; b.collision_mask=9; b.continuous_cd=true
	var col=CollisionShape3D.new(); var shape=BoxShape3D.new(); shape.size=Vector3(.27,.35,.28); col.shape=shape; col.position.y=.16; b.add_child(col)
	b.linear_velocity=game.tuning.release_velocity(hand,hand==game.desktop_hand).limit_length(4)
	return true
func home():
	for n in vessels:
		for key in game.held.keys():
			if game.held[key]==n: game.held.erase(key)
		var body=n.get_meta("body") if n.has_meta("body") else null; n.reparent(court); n.global_transform=n.get_meta("home"); n.remove_meta("body")
		if is_instance_valid(body): body.queue_free()
		game._set_collisions(n,true)
		n.set_meta("zone",ZONE); n.set_meta("open",false); n.get_meta("stream").hide(); _vessel_label(n)
func pour_at(n,point:Vector3,amount:float)->float:
	if n not in vessels or fluid==null: return 0
	amount=clampf(amount,0,float(n.get_meta("remaining")))
	if amount<=0: return 0
	var kind=str(n.get_meta("fluid"))
	var used=lamplighting.pour(point,kind,amount) if lamplighting!=null else 0.0
	if used>0 or kind=="glimmer":
		n.set_meta("remaining",maxf(0,float(n.get_meta("remaining"))-used)); _vessel_label(n); return used
	if n.get_meta("fluid")=="oil": used=fluid.pour(point,game.adventure.zone,amount,false)
	else:
		var affected=fluid.extinguish_near(point,.65); wet_cells+=affected; used=amount
		if affected>=1: n.set_meta("hiss_until",clock+.25)
		if wet_cells>=3: _earn("water")
	n.set_meta("remaining",maxf(0,float(n.get_meta("remaining"))-used)); _vessel_label(n); return used
func tick(delta):
	clock+=delta; pour_clock+=delta
	if lamplighting!=null: lamplighting.tick(delta)
	var pouring=false; var is_water=false; var hiss=false; var audio_point=Vector3.ZERO
	var pour_dt=minf(pour_clock,.2) if pour_clock>=.1 else 0.0
	if pour_dt>0: pour_clock=0.0
	for n in vessels:
		var hand=null
		for candidate in [game.desktop_hand]+game.hands:
			if is_instance_valid(candidate) and _held(candidate)==n: hand=candidate; break
		var stream=n.get_meta("stream"); stream.hide()
		if hand==null:
			if n.has_meta("body"):
				n.get_meta("body").visible=str(n.get_meta("zone"))==game.adventure.zone
				n.get_meta("body").freeze=not n.get_meta("body").visible
				if n.global_position.y < -8: home()
			continue
		var tilt=clampf((-n.global_basis.y.dot(Vector3.UP)+.75)/.75,0,1)
		if hand==game.desktop_hand: tilt=1
		if not n.get_meta("open") or tilt<.08 or float(n.get_meta("remaining"))<=0: continue
		var tip=n.to_global(Vector3(0,.28,-.33))
		var query=PhysicsRayQueryParameters3D.create(tip,tip+Vector3.DOWN*5,1); query.collide_with_areas=false
		var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
		if hit.is_empty() or hit.normal.y<.5: continue
		var end:Vector3=hit.position+Vector3.UP*.025
		var accepted=pour_at(n,end,pour_dt*3.5*tilt) if pour_dt>0 else float(n.get_meta("last_pour",0))
		if pour_dt>0:
			n.set_meta("last_pour",accepted)
			if accepted<=0 and clock>popup_at:
				popup_at=clock+5; game._notice("Full or unsuitable surface. Moonwater belongs in the blue inlet; oil fills lamp bowls or the floor.",4)
		if accepted>0:
			pouring=true; is_water=n.get_meta("fluid")=="water"; hiss=clock<float(n.get_meta("hiss_until",-1)); audio_point=end
			stream.show(); stream.global_position=(tip+end)*.5; var axis=(end-tip).normalized()
			var side=Vector3.RIGHT if absf(axis.dot(Vector3.RIGHT))<.9 else Vector3.FORWARD
			stream.basis=Basis(side.cross(axis).normalized(),axis,side.cross(axis).normalized().cross(axis).normalized()).scaled(Vector3(.026,tip.distance_to(end),.026))
	fluid_audio.update(pouring and not game.smoke,is_water,audio_point,hiss and not game.smoke,delta)
	if game.adventure.zone!=ZONE: return
	if fluid!=null and fluid.fields.has(ZONE):
		var f=fluid.fields[ZONE].field; var burning_count=0
		for value in f.burning: burning_count+=int(value>0)
		if burning_count>=24: _earn("trail")
	if game.get("hearth_torch")!=null and game.hearth_torch.lit:
		var alcove=CENTER+Vector3(8,1.5,-5)
		if game.camera.global_position.distance_to(alcove)<2.3 and game.hearth_torch.tip_position().distance_to(alcove)<3.5: _earn("discovery")
	if int(clock*2)!=int((clock-delta)*2): _refresh()
func _earn(key):
	if state[key]: return
	state[key]=true; state.revision+=1; _save(); _refresh()
	game._notice({"trail":"A river of fire! The copper seal remembers your experiment.","water":"Fire tamed. Water leaves the fuel wet, so it cannot immediately reignite.","discovery":"Lamplighter's nook discovered. Your torch brought its carving out of the shadows."}[key],6)
	game.firecraft._sound("strike",CENTER+Vector3(0,2,5))
func _refresh():
	if label==null: return
	label.text="Pour oil. Touch it with fire.\nQuench with water.\nExplore the torchlit alcove."
	for i in range(badges.size()):
		var earned=bool(state[["trail","water","discovery"][i]])
		badges[i].material_override=ART.mat("f5c66d" if earned else "746959",.6 if earned else 0)
		badge_lights[i].light_energy=.22 if earned else 0
func act(action):
	match action:
		"visit":
			game.adventure.travel(ZONE)
			if fluid!=null: fluid.prewarm_region(ZONE,CENTER,2.5)
			if game.get("hearth_torch")!=null and not is_instance_valid(game.hearth_torch.holder): game.hearth_torch.home()
			game._notice("Welcome to the Ember Gallery. Oil and water are on the left; take a torch and experiment.",9)
		"leave": game.adventure.travel("forge_yard")
		"refill":
			for n in vessels: n.set_meta("remaining",CAPACITY); _vessel_label(n)
			game._notice("All three cans refilled. Existing puddles remain where you left them.")
		"comfort":
			immersion=1.0-immersion
			game.get_node("AdventureEnvironment").environment.ambient_light_energy=lerpf(.32,.13,immersion)
			game._notice("Brighter surroundings" if immersion==0 else "Moody firelight")
		"bottle","lit_bottle":
			var hand=game.desktop_hand
			if game.vr:
				hand=null
				for candidate in game.hands:
					if not game.held.has(str(candidate.get_instance_id())): hand=candidate; break
			if hand==null or game.held.has(str(hand.get_instance_id())): game._notice("Put down what you are holding first."); return
			if game.firecraft.props.filter(func(p):return is_instance_valid(p) and p.get_meta("fire_kind","")=="vial").size()>=40: game._notice("Forty bottles are already out. Use those first."); return
			var vial=game.firecraft._prop("vial",hand.global_position); game.firecraft._attach(hand,vial)
			if action=="lit_bottle": game.firecraft._light(vial)
			game._notice("Release grip to throw. Desktop E throws forward. Lit wicks last ten seconds.")

func reset_session():
	home(); wet_cells=0
	if lamplighting!=null: lamplighting.reset()
	if fluid!=null and fluid.fields.has(ZONE):
		fluid.fields[ZONE].field.queue_free(); fluid.fields.erase(ZONE)
	for n in vessels: n.set_meta("remaining",CAPACITY); _vessel_label(n)
