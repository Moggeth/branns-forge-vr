extends Node
## A small environmental circuit using the shared surface-fuel field, never another fluid solver.
const A=preload("res://world_zones.gd")
const ZONE="ember_creek"
const CENTER=Vector3(-410,0,120)
var game
var court:Node3D
var board:Label3D
var gate:Node3D
var stream:MeshInstance3D
var bellows:MeshInstance3D
var reveal:Label3D
var beacon:OmniLight3D
var carving_art:Node3D
var stage=0
var pour_until=0.0
var bellows_until=0.0
var gate_lift=0.0
var supplies=[]
var fluid
var clock=0.0
var wet_hint=0.0
var last_zone=""
func basin()->Vector3: return CENTER+Vector3(0,.12,1)
func carving()->Vector3: return CENTER+Vector3(0,1.4,-7)
func setup(g):
	game=g; fluid=game.firecraft.fluid; court=Node3D.new(); game.add_child(court); court.position=CENTER; court.name="EmberCreek"
	game.adventure.zone_groups[ZONE]=court
	game.scene.zones[ZONE]={"name":"Ember Creek","center":CENTER,"spawn":CENTER+Vector3(0,0,7),"environment":{"ambient_color":"8397b4","ambient_energy":.12,"sun_color":"879abb","sun_energy":.035,"sky_top":"080d20","sky_horizon":"192639","fog_density":.009,"fog_color":"142334"}}
	solid(Vector3(0,-.25,0),Vector3(14,.5,20),"32464d")
	for x in [-7,7]: solid(Vector3(x,2,0),Vector3(.5,4,20),"34404f")
	for z in [-10,10]: solid(Vector3(0,2,z),Vector3(14,4,.5),"34404f")
	# A raised, shallow tray concentrates a visible spill without hidden traps.
	solid(Vector3(0,.04,1),Vector3(3,.08,4),"687b7a")
	for x in [-1.6,1.6]: solid(Vector3(x,.13,1),Vector3(.15,.26,4.2),"ad8054")
	for z in [-1.1,3.1]: solid(Vector3(0,.13,z),Vector3(3.3,.26,.15),"ad8054")
	for i in range(8):
		A.rock(court,Vector3((-1 if i%2==0 else 1)*5,.4,6-i*1.7),Vector3(1.4,.8,1.5),"3e5360")
		A.cyl(court,Vector3((-1 if i%2==0 else 1)*5,.95,6-i*1.7),.07,.8,"638379","taper")
	gate=Node3D.new(); court.add_child(gate); gate.position=Vector3(0,1.6,-4)
	A.box(gate,Vector3.ZERO,Vector3(3.5,3.2,.22),"4f5e66"); A.body(gate,Vector3.ZERO,Vector3(3.5,3.2,.22))
	for x in [-5,5]: solid(Vector3(x,1.6,-4),Vector3(6,3.2,.3),"344552")
	for x in [-1.2,-.6,0,.6,1.2]: A.box(gate,Vector3(x,0,.15),Vector3(.07,3,.05),"b58958")
	A.label(gate,"THE CREEK KEEPER",Vector3(0,.6,.2),24,"bcd2ce").pixel_size=.0035
	board=A.label(court,"",Vector3(-3.7,2.25,3.7),24,"e1eacb"); board.pixel_size=.0035
	button(Vector3(-3.7,1.45,3.8),"oil","1 · POUR OIL")
	button(Vector3(-3.7,1.0,3.8),"water","2 · WATER SLUICE")
	button(Vector3(-3.7,.55,3.8),"dry","3 · BELLOWS")
	button(Vector3(3.6,1.5,4.7),"match","TAKE A LIT MATCH")
	button(Vector3(3.6,1.05,4.7),"reset","RESET CREEK")
	button(Vector3(3.6,.6,4.7),"leave","BACK TO BRANN")
	button(Vector3(3.6,.15,4.7),"comfort","BRIGHTER / MOODY")
	A.label(court,"EMBER CREEK\nTap signs with trigger; fairy darts work too.\nLight · quench · dry · relight · carry fire beyond.",Vector3(0,3.0,5.5),26,"ffe0a3").pixel_size=.0038
	A.label(court,"Shallow oil tray\nTouch the spill with your flame.",Vector3(0,.55,3.3),19,"d4e9df").pixel_size=.003
	A.cyl(court,Vector3(0,1.3,1),.12,2.5,"a18059"); A.cyl(court,Vector3(.25,2.5,1),.08,.7,"bb956b").rotation.z=PI/2
	stream=A.cyl(court,Vector3(.5,1.25,1),.035,2.3,"d2a759", "cylinder",.1); stream.hide()
	bellows=A.rock(court,Vector3(-2,.5,1),Vector3(.75,.6,.9),"88593f")
	A.cyl(court,Vector3(-1.5,.45,1),.12,.6,"ba9768").rotation.z=PI/2
	reveal=A.label(court,"THE FIREFLY AND THE RIVER\nA small light can change the way.",carving()-CENTER,26,"ffe0a5"); reveal.pixel_size=.004; reveal.hide()
	carving_art=Node3D.new(); court.add_child(carving_art); carving_art.position=Vector3(0,1.9,-7.3)
	var plaque=A.cyl(carving_art,Vector3.ZERO,.85,.18,"687a7f","disc"); plaque.rotation.x=PI/2
	for x in [-1,1]:
		for y in [-1,1]:
			var wing=A.rock(carving_art,Vector3(x*.27,y*.22,.13),Vector3(.43,.50,.12),"aabda6"); wing.rotation.z=-x*y*.4
	A.cyl(carving_art,Vector3(0,0,.18),.055,.55,"d9b675")
	for x in [-1.7,1.7]: A.cyl(court,Vector3(x,1.3,-7),.18,2.6,"607b86")
	beacon=OmniLight3D.new(); court.add_child(beacon); beacon.position=Vector3(0,2,-6.5); beacon.light_color=Color("ffca86"); beacon.omni_range=5; beacon.shadow_enabled=false; beacon.light_energy=0
	var n=Node3D.new(); game.adventure.zone_groups.forge_yard.add_child(n); n.position=Vector3(-7,0.6,5); n.set_meta("kind","button"); n.set_meta("action","creek:visit"); A.box(n,Vector3.ZERO,Vector3(2.8,.32,.12),"674d39"); A.body(n,Vector3.ZERO,Vector3(2.8,.32,.12)); A.label(n,"EMBER CREEK · K",Vector3(0,0,.08),23,"ffe0b5").pixel_size=.003
	court.hide(); refresh(); print("EMBER_CREEK_READY shared_fluid=true solo_taps=true session_only=true")
func solid(pos,size,color): A.box(court,pos,size,color); return A.body(court,pos,size)
func button(pos,action,text):
	var n=Node3D.new(); court.add_child(n); n.position=pos; n.set_meta("kind","button"); n.set_meta("action","creek:"+action)
	A.box(n,Vector3.ZERO,Vector3(2.5,.32,.12),"536468"); A.body(n,Vector3.ZERO,Vector3(2.5,.32,.12)); A.label(n,text,Vector3(0,0,.08),21,"ffe7c7").pixel_size=.003
func visit():
	game.adventure.travel(ZONE)
	if not fluid.prewarm_region(ZONE,CENTER,3): game._notice("The eight fluid regions are full this session. Existing spill areas still work.",8); return
	game._notice("Ember Creek: oil, flame, water, bellows, flame again. Fairy darts can tap the signs.",8)
func field():
	return fluid.fields[ZONE].field if fluid!=null and fluid.fields.has(ZONE) and fluid.fields[ZONE].ready else null
func basin_fire()->bool:
	var f=field()
	return f!=null and fluid.nearest_fire(f,basin(),1.4)!=Vector3.INF
func act(action):
	if action=="visit": visit(); return
	if action=="leave": game.adventure.travel("forge_yard"); return
	if game.adventure.zone!=ZONE: return
	if action=="reset": reset(); return
	if action=="comfort":
		var env=game.scene.zones[ZONE].environment; env.ambient_energy=.32 if env.ambient_energy<.2 else .12; game.adventure._apply_zone_environment(ZONE); return
	if action=="oil":
		var accepted=fluid.pour(basin(),ZONE,8,false)
		if accepted>0: pour_until=clock+1; stream.material_override=A.mat("d2a759",.1)
		return
	if action=="water":
		var changed=fluid.extinguish_near(basin(),2.7); pour_until=clock+1; stream.material_override=A.mat("87cfee",.2)
		if changed>0 and stage==1: stage=2; game.playful_feedback.pulse(basin(),"progress",.5)
		refresh(); return
	if action=="dry":
		var f=field(); bellows_until=clock+.6
		if f!=null:
			for i in range(f.wet.size()):
				if f.point(i).distance_to(basin())<2.7: f.wet[i]=maxf(0,f.wet[i]-.45)
		refresh(); return
	if action=="match": take_match()
func take_match():
	# Do not assume an XR controller exists in solo practice or a temporarily untracked headset.
	var fairy=game.fairy
	if fairy!=null and fairy.active and fairy.health>0:
		if is_instance_valid(fairy.carry): fairy.note("Put down your cargo first; X / Back mouse."); return
	elif not game.vr and game.held.has(str(game.desktop_hand.get_instance_id())): game._notice("Put down your held item first."); return
	for item in supplies.duplicate():
		if not is_instance_valid(item): supplies.erase(item)
		elif item not in game.held.values() and not game.firecraft._burning(item):
			game.firecraft.props.erase(item); if item.has_meta("body"): item.get_meta("body").queue_free()
			else: item.queue_free()
			supplies.erase(item)
	if supplies.size()>=6: game._notice("Use the matches already here; six at a time."); return
	var item=game.firecraft._prop("match",CENTER+Vector3(3,1.1,4)); supplies.append(item)
	game.firecraft._light(item)
	if fairy!=null and fairy.active and fairy.health>0: fairy.pick_up(item); return
	var hand=game.desktop_hand if not game.vr else null
	if game.vr:
		for candidate in game.hands:
			if candidate.get_is_active() and not game.held.has(str(candidate.get_instance_id())): hand=candidate; break
	if hand!=null: game.firecraft._attach(hand,item)
	else: game._notice("Your lit match waits beside the signs. Grip it when your hand is ready.")
func reset():
	# A closed gate must not strand either player on the far side during retry.
	var fairy=game.fairy
	if game.camera.global_position.z<CENTER.z-3:
		var spawn:Vector3=game.scene.zones[ZONE].spawn
		game.rig.global_position+=Vector3(spawn.x-game.camera.global_position.x,0,spawn.z-game.camera.global_position.z)
	if fairy!=null and fairy.active:
		if fairy.avatar.global_position.z<CENTER.z-3:
			fairy.detach(Vector3.ZERO); fairy.avatar.global_position=fairy.pocket(); fairy.camera_position=fairy.avatar.global_position; fairy.recall=false
		fairy.last_host=game.camera.global_position
	stage=0; gate_lift=0; gate.position.y=1.6; reveal.hide(); beacon.light_energy=0; pour_until=0; bellows_until=0; stream.hide()
	if fluid.fields.has(ZONE):
		var entry=fluid.fields[ZONE]; entry.pending.clear(); entry.touches.clear(); var f=entry.field
		f.fuel.fill(0); f.burning.fill(0); f.burn_age.fill(0); f.wet.fill(0); f.update_field(); f.field_texture.update(f.field_image); f.update_fluid_visuals()
	refresh(); game._notice("Creek reset. Your inventory and other areas are unchanged.")
func tick(dt):
	clock+=dt
	if game.adventure.zone!=ZONE: stream.hide(); return
	if not fluid.fields.has(ZONE):
		if not fluid.prewarm_region(ZONE,CENTER,3): return
	stream.visible=clock<pour_until; bellows.scale=Vector3(.75,.6*(.75 if clock<bellows_until else 1),.9)
	if stage==0 and basin_fire(): stage=1; refresh()
	elif stage==2 and basin_fire(): stage=3; refresh(); game.playful_feedback.pulse(basin(),"reward",.7)
	gate_lift=move_toward(gate_lift,1.0 if stage>=3 else 0.0,dt*.7); gate.position.y=1.6+gate_lift*3.7
	beacon.light_energy=move_toward(beacon.light_energy,.7 if stage==4 else .0,dt)
	if stage==3:
		for item in game.firecraft.props:
			if not is_instance_valid(item) or item not in game.held.values() or not item.is_visible_in_tree() or not game.firecraft._burning(item): continue
			var tip=game.firecraft._tip(item)
			if tip.distance_to(carving())<1.5 and game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(tip,carving(),1)).is_empty():
				stage=4; reveal.show(); refresh(); game.playful_feedback.pulse(carving(),"reward",1); print("EMBER_CREEK completed=true"); break
func refresh():
	if board==null: return
	board.text=["POUR · THEN LIGHT\nTap oil. Take a lit match.\nTouch its tip to the shallow spill.","QUENCH THE CREEK\nTap water while the spill burns.\nIf it burns out: oil + flame again.","DRY · THEN RELIGHT\nTap bellows, then touch flame to oil.\nIf fuel ran out, add one more pour.","FOLLOW THE FIRELIGHT\nThe gate rises. Carry a lit match\nto the carving beyond. Fresh matches are free.","THE CREEK KEEPER REMEMBERS\nA little fire, a little care.\nReset to play again; return when ready."][stage]
