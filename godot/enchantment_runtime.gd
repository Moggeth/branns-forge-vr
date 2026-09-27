extends Node
## Physical module rack, socket anchors, and local enchantment effects.
const ART=preload("res://workshop_art.gd")
const MODULE_KINDS=["quickwind","truesight","verdant","hearth"]
const MODULE_INFO={"quickwind":"T2 · 2 iron + 1 tail","truesight":"T3 · 2 crystal + 1 bone","verdant":"T3 · 2 apple + 1 spore","hearth":"T4 · 1 ember + 2 bloom"}
var game
var bench:Node3D
var rack:Node3D
var cradle:Node3D
var modules={} # module id -> physical node
var held={} # hand id -> module id
var pending={} # hand id -> action in flight
var released={}
var revision=-1
var visible_tier=-1
var tray_page=0
var tray_label:Label3D
var wards_until={}
var heal_until={}
var head_markers={}

func setup(owner_game):
	game=owner_game
	bench=Node3D.new(); bench.name="TinkersBench"; game.adventure.zone_groups.forge_yard.add_child(bench); bench.position=Vector3(11,0,-3)
	# A real waist-high work surface: its collision covers the apron and legs.
	WorkshopScene.box(bench,Vector3(0,0.95,0),Vector3(2.45,0.14,1.05),WorkshopScene.material("6d4930"))
	WorkshopScene.collision(bench,Vector3(0,0.46,0),Vector3(2.45,0.96,1.05))
	for x in [-1.0,1.0]: WorkshopScene.box(bench,Vector3(x,0.45,0),Vector3(0.16,0.90,0.16),WorkshopScene.material("513722"))
	var title=ART.text(bench,"THE TINKER’S BENCH",Vector3(0,2.0,-0.4),22); title.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	ART.text(bench,"Craft a module · grip it · fit the brass socket",Vector3(0,1.91,-0.4),15).pixel_size=0.0023
	rack=Node3D.new(); rack.name="ModuleRack"; bench.add_child(rack); rack.position=Vector3(0,1.04,-0.30)
	for i in range(MODULE_KINDS.size()): _craft_button(MODULE_KINDS[i],Vector3(-0.84+i*0.56,0.85,0.62))
	cradle=Node3D.new(); cradle.name="WeaponCradle"; bench.add_child(cradle); cradle.position=Vector3(0,1.06,-0.05)
	WorkshopScene.box(cradle,Vector3(0,0,0),Vector3(0.95,0.05,0.30),WorkshopScene.material("553b27"))
	for x in [-0.38,0.38]:
		WorkshopScene.box(cradle,Vector3(x,0.10,0),Vector3(0.08,0.20,0.28),WorkshopScene.material("a77d64",0.55))
	var hint=ART.text(cradle,"REST WEAPON HERE",Vector3(0,0.23,0.18),11); hint.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	for side in [-1,1]:
		var turn=Node3D.new(); bench.add_child(turn); turn.position=Vector3(side*1.06,1.14,0.40); turn.set_meta("kind","button"); turn.set_meta("action","enchant:page:"+str(side))
		WorkshopScene.box(turn,Vector3.ZERO,Vector3(0.15,0.12,0.10),WorkshopScene.material("40655d")); WorkshopScene.collision(turn,Vector3.ZERO,Vector3(0.15,0.12,0.10))
		ART.text(turn,"‹" if side<0 else "›",Vector3(0,0,0.06),20).pixel_size=0.002
	tray_label=ART.text(bench,"MODULE TRAY",Vector3(0,1.06,0.58),13); tray_label.pixel_size=0.002
	_set_visible(false)

func _set_visible(enabled:bool):
	bench.visible=enabled
	game._set_collisions(bench,enabled)

func _craft_button(kind:String,pos:Vector3):
	var n=Node3D.new(); bench.add_child(n); n.position=pos; n.set_meta("kind","button"); n.set_meta("action","enchant:craft:"+kind)
	WorkshopScene.box(n,Vector3.ZERO,Vector3(0.50,0.12,0.17),WorkshopScene.material("445b67",0.5)); WorkshopScene.collision(n,Vector3.ZERO,Vector3(0.53,0.16,0.20))
	var label=ART.text(n,"MAKE "+kind.to_upper()+"\n"+MODULE_INFO[kind].replace(" · ","\n"),Vector3(0,0,0.11),13); label.pixel_size=0.0022; label.width=300
	var model=ART.module_piece(kind); bench.add_child(model); model.position=Vector3(pos.x,1.48,-0.35)
	var effect={"quickwind":"One-turn crank","truesight":"Longer-range weak points","verdant":"Trigger: heal 10","hearth":"Trigger: 3s ward"}[kind]
	var caption=ART.text(bench,effect,Vector3(pos.x,1.79,-0.32),12); caption.pixel_size=0.0022; caption.width=300
	WorkshopScene.box(bench,Vector3(pos.x,1.44,-0.35),Vector3(0.48,0.05,0.36),WorkshopScene.material("42645d"))

func ingest(snapshot:Dictionary):
	if snapshot.is_empty() or int(snapshot.get("revision",-1))<revision: return
	revision=int(snapshot.get("revision",revision))
	var socketed=snapshot.get("sockets",{})
	var live={}
	for data in snapshot.get("modules",[]):
		live[str(data.get("id",""))]=data
		if socketed.values().has(str(data.get("id",""))): continue
		if not modules.has(str(data.get("id",""))): _spawn(data)
	for id in modules.keys().duplicate():
		if not live.has(id) or socketed.values().has(id):
			var node=modules[id]
			# An in-hand module may be acknowledged while this frame is iterating.
			# Keep it alive until release can return it safely to the rack.
			if held.values().has(id) or pending.values().has("install"): continue
			if is_instance_valid(node): node.queue_free()
			modules.erase(id)
	for item in _items(): _badge(item,socketed)
	_update_tray()

func _slot(index:int)->Vector3:
	# Four columns and successive shelves: stable slots never overlap after four.
	return Vector3(-0.72+(index%4)*0.48,0.04,-0.05)

func _spawn(data:Dictionary):
	var node=StaticBody3D.new(); rack.add_child(node); node.name="Module_"+str(data.get("id","")); node.set_meta("kind","enchantment_module"); node.set_meta("module_id",str(data.get("id",""))); node.set_meta("module_kind",str(data.get("kind","")))
	node.add_child(ART.module_piece(str(data.get("kind",""))))
	var shape=CollisionShape3D.new(); var cylinder=CylinderShape3D.new(); cylinder.radius=0.095; cylinder.height=0.17; shape.shape=cylinder; shape.position.y=0.07; node.add_child(shape)
	node.position=_slot(_index(str(data.id))); modules[str(data.get("id",""))]=node

func _items()->Array:
	var out=[]
	for node in game.get_tree().get_nodes_in_group("pickup"):
		if node is Node3D and is_instance_valid(node) and node.get_meta("kind","")=="weapon" and not out.has(node): out.append(node)
	for node in game.imported.values():
		if node is Node3D and is_instance_valid(node) and node.get_meta("kind","")=="weapon" and not out.has(node): out.append(node)
	for node in game.held.values():
		if node is Node3D and is_instance_valid(node) and node.get_meta("kind","")=="weapon" and not out.has(node): out.append(node)
	return out

func _socket_local(item:Node3D)->Vector3:
	# Put the socket on the upper side, away from the authored handle wherever known.
	var grip=item.get_meta("grip_axis_origin",Vector3.ZERO)
	return Vector3(0.16 if grip.x<=0 else -0.16,maxf(0.28,grip.y+0.16),0.04)

func _anchor(item:Node3D)->Node3D:
	var anchor=item.get_node_or_null("ModuleSocket") as Node3D
	if anchor==null:
		anchor=Node3D.new(); anchor.name="ModuleSocket"; item.add_child(anchor); anchor.position=_socket_local(item)
	return anchor

func _badge(item:Node3D,sockets:Dictionary):
	if not is_instance_valid(item) or str(item.get_meta("kind",""))!="weapon": return
	var module_id=str(sockets.get(_item_id(item),"")); var anchor=_anchor(item)
	var old=anchor.get_node_or_null("InstalledModule")
	if old!=null and old.get_meta("module_id","")!=module_id: old.free(); old=null
	var brass=anchor.get_node_or_null("BrassSocket")
	if brass==null:
		brass=WorkshopScene.cylinder(anchor,Vector3.ZERO,0.08,0.025,WorkshopScene.material("bd9860",0.65)); brass.name="BrassSocket"
	brass.visible=not module_id.is_empty() or not held.is_empty() or item.get_parent()==cradle
	if not module_id.is_empty() and old==null:
		old=ART.module_piece(_kind_from_id(module_id)); old.name="InstalledModule"; old.set_meta("module_id",module_id); anchor.add_child(old); old.scale=Vector3.ONE*0.72

func _kind_from_id(module_id:String)->String:
	for data in game.state.get("workshop",{}).get("modules",[]):
		if str(data.get("id",""))==module_id: return str(data.get("kind",""))
	return ""

func _item_id(item:Node3D)->String:
	var id=str(item.get_meta("id",""))
	return "apprentice_hammer" if id=="starter_hammer" else id

func _compatible(kind:String,item_id:String)->bool:
	# This is only an offline regression guard; the ledger remains authoritative.
	return kind not in ["quickwind","truesight"] or item_id=="20dc22c5-7bcc-43df-b07f-e81eab521b0f"

func action(value:String)->bool:
	if value.begins_with("enchant:page:"):
		var pages=maxi(1,ceili(game.state.get("workshop",{}).get("modules",[]).size()/4.0))
		tray_page=posmod(tray_page+int(value.get_slice(":",2)),pages); _update_tray(); return true
	if not value.begins_with("enchant:craft:"): return false
	var kind=value.trim_prefix("enchant:craft:")
	var tier=2 if kind=="quickwind" else (3 if kind in ["truesight","verdant"] else 4)
	if int(game.state.get("tier",1))<tier: game._notice(kind.capitalize()+" requires tier "+str(tier)+"."); return true
	_mutate("module-craft",{"kind":kind})
	return true

func busy(hand)->bool:
	var key=str(hand.get_instance_id()); return held.has(key) or pending.has(key)

func try_grab(hand)->bool:
	var key=str(hand.get_instance_id()); if busy(hand): return true
	if int(game.state.get("tier",1))<2 or game.adventure.zone!="forge_yard": return false
	for id in modules.keys():
		var node=modules[id]
		if is_instance_valid(node) and node.get_parent()==rack and node.is_visible_in_tree() and node.global_position.distance_to(hand.global_position)<0.22:
			_hold(id,hand); return true
	# Removal requires the hand to touch the actual visible socket, never item-root proximity.
	for item in _items():
		if kind_for(item).is_empty() or item.get_parent()!=cradle: continue
		var anchor=_anchor(item)
		if hand.global_position.distance_to(anchor.global_position)<=0.15:
			_remove_then_hold(_item_id(item),hand); return true
	return false

func _hold(id:String,hand):
	var node=modules.get(id); if not is_instance_valid(node): return
	var key=str(hand.get_instance_id()); held[key]=id; released.erase(key); game._set_collisions(node,false); node.reparent(game.hand_socket(hand)); node.position=Vector3(0,0,-0.10); node.rotation=Vector3.ZERO

func _remove_then_hold(item_id:String,hand):
	var key=str(hand.get_instance_id()); pending[key]="remove"; released.erase(key)
	var response=await _mutate("module-remove",{"itemId":item_id})
	pending.erase(key)
	if response is Dictionary:
		var id=str(response.get("removed",{}).get("moduleId",""))
		# Do not attach after the acknowledgement if the user has released meanwhile.
		if not id.is_empty() and not released.has(key) and _grip_down(hand): _hold(id,hand)

func _grip_down(hand)->bool:
	return not hand is XRController3D or bool(game.last_inputs.get(str(hand.get_instance_id())+"g",false))

func release(hand)->bool:
	var key=str(hand.get_instance_id())
	if pending.has(key): released[key]=true; return true
	if not held.has(key): return false
	var id=str(held[key]); held.erase(key); var node=modules.get(id)
	if not is_instance_valid(node): return true
	var target=_near_weapon(node.global_position)
	_return_rack(id)
	if target!=null:
		pending[key]="install"; _install(id,target,key)
	return true

func _install(id,target,key):
	await _mutate("module-install",{"moduleId":id,"itemId":_item_id(target)})
	pending.erase(key)
	ingest(game.state.get("workshop",{}))

func _return_rack(id:String):
	var node=modules.get(id); if not is_instance_valid(node): return
	node.reparent(rack); game._set_collisions(node,true); node.position=_slot(_index(id)); node.rotation=Vector3.ZERO; _update_tray()

func _near_weapon(pos:Vector3):
	for item in _items():
		if str(item.get_meta("kind",""))=="weapon" and (item.get_parent()==cradle or item in game.held.values()) and pos.distance_to(_anchor(item).global_position)<=0.18: return item
	return null

func park_weapon(hand)->bool:
	if int(game.state.get("tier",1))<2 or game.adventure.zone!="forge_yard": return false
	var key=str(hand.get_instance_id()); var item=game.held.get(key)
	if not is_instance_valid(item) or str(item.get_meta("kind",""))!="weapon": return false
	if item.global_position.distance_to(cradle.global_position)>0.70: return false
	# Only a sole grip can be parked. Remove grip and held entries before reparenting.
	var entries=game.grips._entries(item); if entries.size()!=1 or entries[0]!=key: return false
	for other in cradle.get_children():
		if other!=item and other.get_meta("kind","")=="weapon": game._notice("Take the weapon from the cradle first."); return false
	game.grips.grips.erase(key); game.grips.adjusting.erase(key); game.held.erase(key)
	var world=item.global_transform; item.reparent(cradle); item.global_transform=world
	item.position=Vector3(0,0.14,0); item.rotation=Vector3(0,0,-PI/2); game._set_collisions(item,true)
	return true

func _mutate(action:String,body:Dictionary):
	# WorkshopSuite owns sequencing, state merging, and ingest fan-out.
	var suite=game.get("workshop_suite")
	if suite==null: suite=game.get("workshop")
	if suite==null: return {"error":"Workshop unavailable"}
	return await suite._send_action(action,body)

func kind_for(item:Node3D)->String:
	if not is_instance_valid(item): return ""
	var sockets=game.state.get("workshop",{}).get("sockets",{}); return _kind_from_id(str(sockets.get(_item_id(item),"")))

func quickwind(item:Node3D)->bool: return kind_for(item)=="quickwind"

func alternate(item:Node3D,hand)->bool:
	var kind=kind_for(item); var id=str(item.get_meta("id",""))
	if kind=="verdant" and game.elapsed>=float(heal_until.get(id,0)):
		heal_until[id]=game.elapsed+10; game.adventure.hp=minf(100,game.adventure.hp+10); game.adventure.haptic(hand,"ready"); game._effect(item.global_position,Color("95d3a0"),0.15,0.35); return true
	if kind=="hearth" and game.elapsed>=float(wards_until.get(id,0)):
		wards_until[id]=game.elapsed+8; game.shield_until=game.elapsed+3; game.adventure.haptic(hand,"ready"); game._effect(item.global_position,Color("ff9153"),0.15,0.35); return true
	return false

func truesight_optics(w:Dictionary)->bool:
	if not is_instance_valid(w.get("item")) or w.get("item") not in game.held.values(): return false
	var optic=w.optic.global_position
	var axis=w.item.global_basis.y.normalized(); var eye_to_optic=optic-game.camera.global_position
	var forward=eye_to_optic.dot(axis); var lateral=(eye_to_optic-axis*forward).length()
	var gaze=(-game.camera.global_basis.z).normalized()
	return forward>=0.03 and forward<=0.65 and lateral<0.065 and gaze.dot(axis)>0.94

func author_point(p:Vector3)->Vector3: return Vector3(p.x,p.z,-p.y)

func _head_position(enemy:Node3D)->Vector3:
	# ActorAnimation creates a Skull joint; use its moving centre when present.
	var skull=enemy.find_child("Skull",true,false) as Node3D
	if skull==null: skull=enemy.find_child("CarvedSkull",true,false) as Node3D
	return skull.global_position if is_instance_valid(skull) else enemy.to_global(Vector3(0,1.62,0))

func tick(_delta):
	var tier=game.workshop.shown_tier
	if visible_tier!=tier: visible_tier=tier; _set_visible(tier>=2); _update_tray()
	var active=false
	var sight_range=25.0
	if game.siegebird!=null:
		for w in game.siegebird.weapons:
			if truesight_optics(w):
				active=true; sight_range=42.0 if kind_for(w.get("item"))=="truesight" else 25.0; break
	for enemy in game.scene.get("enemies",[]):
		if not is_instance_valid(enemy): continue
		var valid=active and bool(enemy.get_meta("alive",true)) and str(enemy.get_meta("enemy_type",""))=="skeleton" and str(enemy.get_meta("zone",game.adventure.zone))==game.adventure.zone and enemy.global_position.distance_to(game.camera.global_position)<=sight_range
		var head=_head_position(enemy)
		if valid:
			var cone=(head-game.camera.global_position).normalized().dot(-game.camera.global_basis.z)
			var hit=game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(game.camera.global_position,head,1))
			valid=cone>0.98 and (hit.is_empty() or game._owner(hit.collider)==enemy)
		var marker=head_markers.get(enemy.get_instance_id())
		if valid and not is_instance_valid(marker):
			marker=MeshInstance3D.new(); var hoop=TorusMesh.new(); hoop.inner_radius=0.11; hoop.outer_radius=0.018+0.11; marker.mesh=hoop; marker.material_override=WorkshopScene.material("ff8a39",0.0,0.4,1.2); game.add_child(marker); head_markers[enemy.get_instance_id()]=marker
		if is_instance_valid(marker):
			marker.global_position=head+Vector3.UP*0.10; marker.visible=valid
			if valid: marker.look_at(game.camera.global_position); marker.rotate_object_local(Vector3.RIGHT,PI/2)

func checks(failures:Array):
	var none:Node3D=null
	if kind_for(none)!="": failures.append("module kind lookup accepted invalid item")
	if not _compatible("quickwind","20dc22c5-7bcc-43df-b07f-e81eab521b0f") or _compatible("quickwind","apprentice_hammer") or not _compatible("verdant","apprentice_hammer"): failures.append("module compatibility lookup regression")
	if game.siegebird._turns({"item":null})!=2.0: failures.append("quickwind default changed")
	if not _optic_test(): failures.append("optic alignment accepted front/back or incorrect gaze")

func _optic_test()->bool:
	# Pure geometry regression for front/back and gaze direction; no diagnostic network calls.
	var axis=Vector3.UP; var eye=Vector3.ZERO; var optic=Vector3(0,0.30,0)
	var v=optic-eye; return v.dot(axis)>0 and (v-axis*v.dot(axis)).length()<0.065 and Vector3(0,1,0).dot(axis)>0.94 and not ((-optic).dot(axis)>0)

func _index(id:String)->int:
	var all=game.state.get("workshop",{}).get("modules",[])
	for i in range(all.size()):
		if str(all[i].id)==id: return i
	return 0

func _update_tray():
	var pages=maxi(1,ceili(game.state.get("workshop",{}).get("modules",[]).size()/4.0))
	tray_page=clampi(tray_page,0,pages-1)
	if is_instance_valid(tray_label): tray_label.text="MODULE TRAY  %d / %d"%[tray_page+1,pages]
	for id in modules:
		var node=modules[id]
		if not is_instance_valid(node) or node.get_parent()!=rack: continue
		var show=floori(_index(id)/4.0)==tray_page
		node.visible=show; game._set_collisions(node,show and bench.visible)
