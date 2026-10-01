extends Node
var game
var system
var snapshot={"available":6,"chambers":{},"revision":-1}
var initialized=false
var request_busy=false
var released={}
var seq=0
var session=""
var rack:Node3D
var stock_label:Label3D
var belt_label:Label3D
var reel_item:Node3D
var reel_owner=null
var rope=preload("res://traversal_tether.gd").new()
var next_sync=0.0
var profiles={}
var applied_versions={}
var retired=[]
const DESKTOP_REEL_REACH=3.0

func setup(g,s):
	game=g; system=s; session=str(Time.get_unix_time_from_system())+"-"+str(randi())
	rope.setup(g)
	# Deferred: the zone containers and other systems are ready before any UI action.
	_build_rack.call_deferred()

func _build_rack():
	belt_label=WorkshopScene.label(system.supply,"∞ bolts",Vector3(0,0.30,0),16); belt_label.pixel_size=0.0014
	# Supply racks belong at the workshop's west porch, with a walking gap to
	# the outdoor collection homes instead of sharing their sign plane.
	rack=Node3D.new(); game.adventure.zone_groups.forge_yard.add_child(rack); rack.position=Vector3(-3.4,0,1.35)
	WorldZones.box(rack,Vector3(0,0.85,0),Vector3(1.5,0.1,0.65),"775738")
	WorldZones.body(rack,Vector3(0,0.85,0),Vector3(1.5,0.1,0.65))
	for x in [-0.6,0.6]: WorldZones.box(rack,Vector3(x,0.4,0),Vector3(0.1,0.8,0.48),"44352b")
	WorldZones.box(rack,Vector3(0,1.4,-0.1),Vector3(1.7,0.66,0.06),"34483e")
	WorldZones.label(rack,"SIEGEBIRD · FIELD SUPPLIES",Vector3(0,1.6,-0.05),20)
	stock_label=WorldZones.label(rack,"BOLTS · FREE REFILLS\nTake one from your belt anytime",Vector3(0,1.38,-0.05),16)
	WorldZones.label(rack,"Grip reel · place on side socket\nFlip brass tab: bolt / grapple",Vector3(0,1.14,-0.05),13)
	var pack=Node3D.new(); rack.add_child(pack); pack.position=Vector3(-0.35,0.97,0); pack.set_meta("kind","siege_pack")
	WorldZones.box(pack,Vector3.ZERO,Vector3(0.3,0.12,0.27),"bd9767")
	for i in range(6): WorldZones.cyl(pack,Vector3(-0.10+i*0.04,0.075,0),0.009,0.3,"bec9c2")
	WorldZones.body(pack,Vector3.ZERO,Vector3(0.34,0.18,0.3))
	reel_item=Node3D.new(); rack.add_child(reel_item); reel_item.position=Vector3(0.42,0.97,0)
	WorldZones.cyl(reel_item,Vector3.ZERO,0.065,0.12,"cba260")
	for y in [-0.068,0.068]: WorldZones.cyl(reel_item,Vector3(0,y,0),0.083,0.018,"577c80")
	for y in range(6): WorldZones.cyl(reel_item,Vector3(0,-0.05+y*0.02,0),0.068,0.007,"e0c799")
	WorldZones.box(reel_item,Vector3(0,-0.09,0),Vector3(0.12,0.035,0.09),"cba260")

func attach(w):
	w["grapple_mode"]=false; w["reel_installed"]=false; w["pending"]=false; w["ammo_token"]=""
	if not game.diagnostic_offline: w.loaded=false; w.draw=0
	# Authored fittings retain the same interaction pivots. Older assets still work.
	var socket=system.find_part(w.model,"ReelSocketArt")
	if socket==null:
		socket=Node3D.new(); w.model.add_child(socket); socket.position=Vector3(-0.23,0.53,0.02)
		WorldZones.box(socket,Vector3.ZERO,Vector3(0.035,0.10,0.10),"ba935e")
	w["reel_socket"]=socket
	var tab=system.find_part(w.model,"SelectorArt")
	if tab==null: tab=WorldZones.box(w.model,Vector3(-0.20,0.42,0.08),Vector3(0.075,0.04,0.045),"d7b375")
	w["selector"]=tab
	var hook=Node3D.new(); w.bolt.add_child(hook); w["hook_art"]=hook
	for angle in [0.0,TAU/3,TAU*2/3]:
		var radial=Vector3(cos(angle),0,sin(angle))*0.043
		WorldZones.line(hook,Vector3(0,0.44,0),Vector3(0,0.49,0)+radial,0.008,"a5bbb6")
		WorldZones.line(hook,Vector3(0,0.49,0)+radial,Vector3(0,0.44,0)+radial*0.8,0.008,"a5bbb6")
	hook.hide()
	w["reticles"]=[]
	for i in range(3):
		var dot=WorldZones.rock(game,Vector3.ZERO,Vector3.ONE*(0.0024 if i==1 else 0.0015),"ffcc6c")
		dot.material_override=WorkshopScene.material("ffb85e",0,0.5,1.1); dot.hide(); w.reticles.append(dot)

func setting(w,key,fallback):
	var base=game.tuning.value("crossbow."+key) if key in ["bolt_speed","damage","load_reach"] else fallback
	return float(profiles.get(str(w.item.get_meta("id","")),{}).get(key,base))

func _sync(data):
	if int(data.get("revision",-1))<int(snapshot.get("revision",-1)): return
	snapshot=data
	for w in system.weapons:
		if not is_instance_valid(w.item) or w.get("pending",false): continue
		var token=str(snapshot.get("chambers",{}).get(str(w.item.get_meta("id")),""))
		if not token.is_empty(): w.ammo_token=token; w.loaded=true; w.draw=1; system.mechanism(w)

func _rpc(action,fields={}):
	if request_busy: return {"error":"Please wait for the current supply action."}
	request_busy=true; seq+=1
	var body=fields.duplicate(); body.action=action; body.requestId=session+"-"+str(seq)
	var response={}
	for attempt in range(2):
		response=await game._request("/api/vr/supplies",body)
		if not response.has("error"): break
		# Retry the SAME request ID, so uncertain completion cannot charge twice.
	if not response.has("error"): _sync(response)
	else: game._notice(str(response.error),4)
	request_busy=false; return response

func interact(target,hand)->bool:
	if target==null or target.get_meta("kind","")!="siege_pack": return false
	buy.call_deferred(); return true
func buy():
	game._notice("Siegebird's belt quiver now supplies unlimited bolts.",4)
	system.sound("seat",rack.global_position)

func draw_bolt(hand):
	var key=str(hand.get_instance_id())
	if not initialized or request_busy: game._notice("Quiver connecting. Try again shortly."); return
	system.occupied[key]={"type":"pending","hand":hand}; released.erase(key)
	var response=await _rpc("draw")
	system.occupied.erase(key)
	if response.has("error"): return
	if released.get(key,false): await _rpc("return",{"token":response.token}); released.erase(key); return
	var bolt=system.make_bolt(); bolt.set_meta("ammo_token",response.token)
	_hold_bolt(hand,bolt)
func _hold_bolt(hand,bolt):
	bolt.reparent(game.hand_socket(hand)); bolt.position=Vector3(0,0,-0.1); bolt.rotation=Vector3(-PI/2,0,0)
	system.occupied[str(hand.get_instance_id())]={"type":"bolt","hand":hand,"node":bolt}; game.adventure.haptic(hand,"ready")
func release_pending(hand): released[str(hand.get_instance_id())]=true

func load_bolt(w,bolt,hand):
	if request_busy: _drop(bolt); return
	w.pending=true; bolt.reparent(game); bolt.hide()
	var response=await _rpc("load",{"token":str(bolt.get_meta("ammo_token","")),"weaponId":str(w.item.get_meta("id"))})
	w.pending=false
	if response.has("error"): bolt.show(); _drop(bolt); return
	w.ammo_token=response.token; w.loaded=true; system.sound("seat",w.seat.global_position); bolt.queue_free(); system.mechanism(w)
	if is_instance_valid(hand): game.adventure.haptic(hand,"ready")
	game._notice("Hook bolt seated. Fire at solid scenery, then grip and turn the crank to reel in." if w.grapple_mode else "Bolt seated. Siegebird is ready.",4)
func _drop(bolt):
	var body=RigidBody3D.new(); game.add_child(body); body.global_transform=bolt.global_transform; bolt.reparent(body)
	body.collision_layer=8; body.collision_mask=9; body.mass=0.08
	var shape=CollisionShape3D.new(); var box=BoxShape3D.new(); box.size=Vector3(0.035,0.80,0.035); shape.shape=box; body.add_child(shape)
	system.loose.append({"node":bolt,"body":body,"until":game.elapsed+120,"zone":game.adventure.zone})

func fire_bolt(w,hand):
	if request_busy or w.pending: return
	w.pending=true
	var response=await _rpc("fire",{"weaponId":str(w.item.get_meta("id"))})
	w.pending=false
	if response.has("error"): return
	w.ammo_token=response.token
	if w.item not in game.held.values():
		await _rpc("recover",{"token":response.token}); await _rpc("return",{"token":response.token}); w.loaded=false; system.mechanism(w); return
	w.fire_authorized=true
	var current_hand=hand
	if game.held.get(str(hand.get_instance_id()))!=w.item:
		var entries=game.grips._entries(w.item)
		if not entries.is_empty(): current_hand=game.grips.grips[entries[0]].hand
	system.trigger(current_hand)

func try_grab(hand)->bool:
	if not is_instance_valid(reel_item): return false
	for w in system.weapons:
		if not is_instance_valid(w.item) or w.item not in game.held.values(): continue
		if w.reel_installed and hand.global_position.distance_to(w.selector.global_position)<0.10:
			if tethered(w): rope.detach(); game._notice("Tether released.")
			w.grapple_mode=not w.grapple_mode; system.occupied[str(hand.get_instance_id())]={"type":"selector","hand":hand}; system.mechanism(w); game.adventure.haptic(hand,"ready"); return true
	if reel_item.is_visible_in_tree() and hand.global_position.distance_to(reel_item.global_position)<0.14 and reel_item not in system.occupied.values().map(func(e):return e.get("node")):
		if reel_owner!=null:
			if tethered(reel_owner): game._notice("Release the tether before removing the reel."); return true
			reel_owner.reel_installed=false; reel_owner.grapple_mode=false
			system.mechanism(reel_owner)
		reel_owner=null; reel_item.reparent(game.hand_socket(hand)); reel_item.position=Vector3(0,0,-0.08)
		system.occupied[str(hand.get_instance_id())]={"type":"reel","hand":hand,"node":reel_item}; return true
	for entry in system.embedded.duplicate():
		if not is_instance_valid(entry.node) or not entry.node.is_visible_in_tree(): continue
		var a=entry.node.global_position; var b=entry.node.to_global(entry.node.get_meta("tip",Vector3.UP*0.35))
		if hand.global_position.distance_to(Geometry3D.get_closest_point_to_segment(hand.global_position,a,b))<0.12:
			_recover.call_deferred(entry,hand); return true
	return false

func _recover(entry,hand):
	if request_busy or not is_instance_valid(entry.node): return
	var key=str(hand.get_instance_id()); system.occupied[key]={"type":"pending","hand":hand}; released.erase(key)
	var response={}
	if not game.diagnostic_offline: response=await _rpc("recover",{"token":str(entry.node.get_meta("ammo_token",""))})
	system.occupied.erase(key)
	if response.has("error"): return
	system.embedded.erase(entry)
	if game.get("projectile_attachments")!=null: game.projectile_attachments.release(entry.node)
	if not rope.state.is_empty() and rope.state.get("bolt")==entry.node: rope.detach()
	if released.get(key,false):
		if not game.diagnostic_offline: await _rpc("return",{"token":str(entry.node.get_meta("ammo_token",""))})
		entry.node.queue_free(); released.erase(key); return
	entry.node.set_meta("spent_shot",false)
	_hold_bolt(hand,entry.node); system.sound("seat",entry.node.global_position)

func release_reel(hand,entry):
	for w in system.weapons:
		if is_instance_valid(w.item) and w.item in game.held.values() and entry.node.global_position.distance_to(w.reel_socket.global_position)<0.22:
			reel_owner=w; w.reel_installed=true; w.grapple_mode=true
			reel_item.reparent(w.reel_socket); reel_item.transform=Transform3D.IDENTITY; reel_item.rotation.z=PI/2
			game.adventure.haptic(hand,"ready"); game._notice("Grapple reel attached. Fire, then crank to pull yourself in. Trigger cuts the line.",6); system.mechanism(w); return
	_return_reel_to_rack()

## FPS has one hand, so C transfers the same physical reel between the rack
## and the held Siegebird. It cannot create a second reel or break a tether.
func desktop_toggle_reel(hand: Node3D) -> bool:
	if game.vr: return false
	var w=system.desktop_weapon(hand)
	if w==null: return false
	if not is_instance_valid(reel_item) or not is_instance_valid(rack):
		game._notice("Siegebird's reel stand is still loading.",3)
		return true
	if tethered(w):
		game._notice("Release the tether before moving the reel.",3)
		return true
	if game.adventure.zone!="forge_yard" or game.camera.global_position.distance_to(rack.to_global(Vector3(0,1,0)))>DESKTOP_REEL_REACH:
		game._notice("Stand near Siegebird's supply rack to fit or return its reel.",4)
		return true
	if reel_owner==w and w.reel_installed:
		w.reel_installed=false
		w.grapple_mode=false
		reel_owner=null
		_return_reel_to_rack()
		system.mechanism(w)
		game._notice("Grapple reel returned to its stand. Siegebird fires standard bolts.",4)
		return true
	if reel_owner!=null or reel_item.get_parent()!=rack:
		game._notice("The reel is already fitted or held in another hand.",3)
		return true
	reel_owner=w
	w.reel_installed=true
	w.grapple_mode=true
	reel_item.reparent(w.reel_socket)
	reel_item.transform=Transform3D.IDENTITY
	reel_item.rotation.z=PI/2
	system.mechanism(w)
	game._notice("Grapple reel fitted. LMB fires hook bolts, RMB switches bolt mode, hold R to reel after impact.",6)
	return true

func _return_reel_to_rack() -> void:
	if not is_instance_valid(reel_item) or not is_instance_valid(rack): return
	reel_item.reparent(rack)
	reel_item.position=Vector3(0.42,0.97,0)
	reel_item.rotation=Vector3.ZERO

func tethered(w)->bool: return not rope.state.is_empty() and rope.state.item==w.item
func trigger(w,hand)->bool:
	if w.pending: return true
	if tethered(w): rope.detach(); game._notice("Line released."); return true
	return false
func reel(w,angle,delta):
	if angle<=0: return
	w.angle+=angle; system.mechanism(w)
	w.pinion.rotation.x=w.angle; w.reduction.rotation.x=-w.angle/2+PI/20; w.drum.rotation.x=-w.angle/2
	if is_instance_valid(reel_item): reel_item.rotate_y(angle/2)
	var fraction=rope.reel(minf(angle*0.45,delta*setting(w,"reel_speed",2.2)))
	if fraction<0.05 and game.elapsed>float(w.get("blocked_at",0)):
		w.blocked_at=game.elapsed+2; game._notice("Line taut — path blocked. Trigger releases it.",3)

func impact(shot,hit,target):
	var stone=true
	if target!=null and str(target.get_meta("kind","")) in ["resource","enemy","dummy"]: stone=false
	system.sound("click" if stone else "seat",hit.position)
	if game.impact_feedback!=null: game.impact_feedback.contact(target,hit.position,hit.normal,shot.velocity.length()*0.18,"crossbow_bolt")
	# Stone/metal get a shallow bite. Timber/flesh retain more shaft depth.
	shot.node.global_position-=shot.velocity.normalized()*(0.035 if stone else -0.035)
	if shot.get("grapple",false) and is_instance_valid(shot.weapon.item) and shot.weapon.item in game.held.values():
		if shot.weapon.item.global_position.distance_to(hit.position)<28 and rope.attach(shot.weapon.item,hit):
			rope.state["bolt"]=shot.node; game._notice("Grapple caught. Grip the crank and wind to reel yourself in. Trigger releases.",6); game.adventure.haptic(shot.hand,"ready")
		else: game._notice("The hook needs solid scenery or a brass anchor.",3)

func tick(delta):
	if not retired.is_empty() and not request_busy: _retire_next.call_deferred()
	if not initialized and not request_busy:
		initialized=true
		if not game.diagnostic_offline: _resume.call_deferred()
	if game.elapsed>next_sync:
		next_sync=game.elapsed+0.5
		if game.state.has("supplies") and not request_busy: _sync(game.state.supplies)
		profiles=game.state.get("interactionProfiles",{})
		if is_instance_valid(belt_label): belt_label.text="∞ bolts"
		if is_instance_valid(stock_label): stock_label.text="BOLTS · FREE REFILLS\nTake one from your belt anytime"
	for w in system.weapons:
		if not is_instance_valid(w.item): continue
		var id=str(w.item.get_meta("id","")); var revision=int(profiles.get(id,{}).get("revision",0))
		if revision>int(applied_versions.get(id,0)):
			applied_versions[id]=revision
			game._notice("Siegebird's live adjustments are ready.",3)
			print("INTERACTION_PROFILE_APPLIED id=",id," revision=",revision)
		if not rope.state.is_empty() and rope.state.item==w.item: rope.tick(w.reel_socket.global_position)
		var active=game.enchantments!=null and game.enchantments.truesight_optics(w)
		for i in range(w.reticles.size()):
			var dot=w.reticles[i]; dot.visible=active
			if not active: continue
			var distance=[5.0,10.0,20.0][i]; var speed=setting(w,"bolt_speed",44)
			var drag=maxf(0.00001,game.tuning.value("crossbow.drag"))
			var flight=-log(maxf(0.001,1.0-distance*drag/speed))/drag
			var drop=game.tuning.value("crossbow.gravity")/drag*(flight-(1-exp(-drag*flight))/drag)
			var aim:Vector3=w.seat.global_position+w.item.global_basis.y*distance+Vector3.DOWN*drop
			var eye:Vector3=game.camera.global_position; var axis=w.item.global_basis.y.normalized()
			var ray:Vector3=aim-eye; var depth=(w.optic.global_position-eye).dot(axis)
			if ray.dot(axis)>0.01: dot.global_position=eye+ray*(depth/ray.dot(axis))
	if not rope.state.is_empty() and not rope.valid(): rope.detach(rope.state.get("zone")==game.adventure.zone)
func _resume():
	await _rpc("resume")

func return_bolt(bolt):
	if request_busy: _drop(bolt); return
	bolt.reparent(game); bolt.hide()
	var result=await _rpc("return",{"token":str(bolt.get_meta("ammo_token",""))})
	if result.has("error"): bolt.show(); _drop(bolt)
	else: bolt.queue_free(); game._notice("Bolt returned to quiver.",2)

func retire(bolt):
	if game.diagnostic_offline: return
	var token=str(bolt.get_meta("ammo_token",""))
	if not token.is_empty() and token not in retired: retired.append(token)
func _retire_next():
	if retired.is_empty() or request_busy: return
	var token=retired[0]
	var result=await _rpc("discard",{"token":token})
	if not result.has("error"): retired.erase(token)
	else: retired.erase(token) # resume may already have retired it; never synthesize stock

func recover_loose(entry,hand):
	if request_busy: return
	var key=str(hand.get_instance_id()); system.occupied[key]={"type":"pending","hand":hand}; released.erase(key)
	var result={}
	if not game.diagnostic_offline: result=await _rpc("recover",{"token":str(entry.node.get_meta("ammo_token",""))})
	system.occupied.erase(key)
	if result.has("error"): return
	system.loose.erase(entry); entry.node.reparent(game); entry.body.queue_free(); entry.node.set_meta("spent_shot",false)
	if released.get(key,false): return_bolt(entry.node); released.erase(key)
	else: _hold_bolt(hand,entry.node)
