extends Node
## Physical tokens and the workshop ledger share one source of truth.
const ART=preload("res://workshop_art.gd")
const RESOURCES=ART.MATERIALS
var game
var root:Node3D
var table:Node3D
var buckets=[]
var labels={}
var tokens={}
var held={}
var pending={}
var released={}
var revision=-1
var stage_groups=[]
var stage_labels=[]
var stage_lights=[]
var lever:Node3D
var knob:Node3D
var lever_latched=false
var construction=false
var construction_until=0.0
var shown_tier=0
var reveal_tier=0
var pouch:Node3D
var pouch_contents:Node3D
var pouch_preview:Node3D
var pouch_index=0
var pouch_open=false
var pouch_carrier:Node3D
var pouch_home=Vector3(-0.38,-0.03,-0.22)
var pouch_label:Label3D
var sending=false
var next_settle=0.0
var sounds=[]
var impact_streams=[]
var reveal_stream
var sound_serial=0
var next_impact=0.0
var smoke_puffs=[]
var transition_copies=[]
var bucket_home=[]
var option_button:Node3D

func setup(owner_game):
	game=owner_game
	root=Node3D.new(); root.name="LivingWorkshop"; game.adventure.zone_groups.forge_yard.add_child(root)
	_build_table(); _build_pouch()
	stage_groups=ART.stages(game); _apply_tier(1)
	var board=game.scene.get("board")
	if is_instance_valid(board): board.visible=false; game._set_collisions(board,false)
	for button in game.scene.get("buttons",[]):
		if is_instance_valid(button) and button.global_position.x>3: button.visible=false; game._set_collisions(button,false)
	for i in range(8): impact_streams.append(load("res://audio/forge-impact-%d.wav"%(i+1)))
	reveal_stream=load("res://audio/forge-reveal.wav")
	for i in range(3):
		var audio=AudioStreamPlayer3D.new(); root.add_child(audio); audio.position=Vector3(4,1.3,-5); audio.max_distance=22; sounds.append(audio)
	for i in range(20):
		var puff=WorkshopScene.ball(root,Vector3.ZERO,Vector3.ONE,WorkshopScene.material("b9b9a5"))
		puff.material_override.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA; puff.material_override.albedo_color.a=0
		puff.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; puff.visible=false; smoke_puffs.append(puff)
	print("WORKSHOP_READY physical_pouch=true stages=4 token_ledger=true")

func _button(parent,action,pos,size,caption):
	var n=Node3D.new(); parent.add_child(n); n.position=pos; n.set_meta("kind","button"); n.set_meta("action",action)
	WorkshopScene.box(n,Vector3.ZERO,size,WorkshopScene.material("39655c",0.35)); WorkshopScene.collision(n,Vector3.ZERO,size)
	var text=ART.text(n,caption,Vector3(0,0,size.z/2+0.008),17 if size.x>0.5 else 14)
	text.pixel_size=0.0035 if size.x>0.5 else 0.0028
	return n

func _build_table():
	table=Node3D.new(); root.add_child(table); table.name="WorkshopTable"; table.position=Vector3(5.4,0.95,-4.7)
	preload("res://workshop_details.gd").clipped_box(table,Vector3.ZERO,Vector3(4.8,0.16,1.7),WorkshopScene.material("775639"))
	for x in [-2.05,2.05]:
		for z in [-0.6,0.6]: WorkshopScene.box(table,Vector3(x,-0.46,z),Vector3(0.15,0.9,0.15),WorkshopScene.material("523c2c"))
	WorkshopScene.collision(table,Vector3(0,-0.44,0),Vector3(4.8,1.04,1.7))
	WorkshopScene.box(table,Vector3(0,1.0,-0.78),Vector3(4.6,0.43,0.08),WorkshopScene.material("344d49"))
	labels.title=ART.text(table,"GROW THE FORGE",Vector3(0,1.1,-0.72),42)
	labels.status=ART.text(table,"1 POUCH   2 BUCKETS   3 LEVER",Vector3(0,0.93,-0.72),25)
	for i in range(4):
		var x=-1.65+i*1.1
		var mini=ART.mini(i+1); table.add_child(mini); mini.position=Vector3(x,0.13,-0.46); mini.scale=Vector3.ONE*0.78
		var caption=ART.text(table,ART.TITLES[i],Vector3(x,0.74,-0.45),19); caption.pixel_size=0.0028; caption.rotation.x=0
		var state_label=ART.text(table,"",Vector3(x,0.665,-0.45),18); state_label.pixel_size=0.0032; state_label.rotation.x=0; stage_labels.append(state_label)
		stage_lights.append(WorkshopScene.ball(table,Vector3(x,0.12,0.16),Vector3.ONE*0.045,WorkshopScene.material("6c7667")))
	for i in range(2):
		var bucket=ART.bucket(table,Vector3(-0.55+i*1.1,0.09,0.47)); buckets.append(bucket); bucket_home.append(bucket.position)
		var caption=ART.text(table,"",Vector3(-0.55+i*1.1,-0.09,0.88),19); caption.pixel_size=0.0035; labels["bucket"+str(i)]=caption
	labels.cost=ART.text(table,"",Vector3(-1.7,0.43,0.50),19); labels.cost.pixel_size=0.0035; labels.cost.width=450
	option_button=_button(table,"workshop:option",Vector3(-1.65,0.19,0.66),Vector3(1.0,0.18,0.16),"SWAP COST")
	lever=Node3D.new(); table.add_child(lever); lever.position=Vector3(2.02,0.13,0.36)
	WorkshopScene.cylinder(lever,Vector3(0,0.25,0),0.026,0.5,WorkshopScene.material("c7a25d",0.65))
	knob=Node3D.new(); lever.add_child(knob); knob.position=Vector3(0,0.5,0)
	WorkshopScene.box(knob,Vector3.ZERO,Vector3(0.22,0.075,0.075),WorkshopScene.material("d1ad6a",0.5))
	ART.text(table,"3 · GRIP + PULL",Vector3(2.0,-0.06,0.88),19).pixel_size=0.0035

func _build_pouch():
	pouch=Node3D.new(); game.grips.belt.add_child(pouch); pouch.name="MaterialPouch"; pouch.position=pouch_home
	WorkshopScene.ball(pouch,Vector3(0,-0.08,0),Vector3(0.30,0.31,0.20),WorkshopScene.material("77543a"))
	WorkshopScene.cylinder(pouch,Vector3(0,0.055,0),0.105,0.035,WorkshopScene.material("94734b"))
	WorkshopScene.cylinder(pouch,Vector3(0,0.074,0),0.080,0.008,WorkshopScene.material("342f28"))
	for side in [-1,1]:
		WorldZones.line(pouch,Vector3(side*0.08,0.065,0.045),Vector3(side*0.10,-0.025,0.10),0.008,"d0b777")
		WorkshopScene.ball(pouch,Vector3(side*0.10,-0.035,0.10),Vector3.ONE*0.025,WorkshopScene.material("d0b777"))
	WorkshopScene.box(pouch,Vector3(0,0.04,-0.092),Vector3(0.23,0.09,0.018),WorkshopScene.material("ac8854"))
	var clasp=_button(pouch,"workshop:pouch",Vector3(0,0.10,-0.08),Vector3(0.12,0.10,0.05),"LIFT"); clasp.rotation.x=-PI/3
	pouch_contents=Node3D.new(); pouch.add_child(pouch_contents); pouch_contents.position=Vector3(0,0.25,-0.02)
	pouch_label=ART.text(pouch_contents,"",Vector3(0,0.26,0),18); pouch_label.pixel_size=0.0023; pouch_label.billboard=BaseMaterial3D.BILLBOARD_ENABLED; pouch_label.width=390
	for side in [-1,1]:
		var button=_button(pouch_contents,"workshop:scroll:"+str(side),Vector3(side*0.21,0.03,0),Vector3(0.10,0.10,0.07),"‹" if side<0 else "›"); button.rotation.x=-PI/3
	_ui_layers(pouch)
	_update_pouch()

func _ui_layers(node):
	if node is StaticBody3D: node.collision_layer=4; node.collision_mask=0
	for child in node.get_children(): _ui_layers(child)

func _update_pouch():
	pouch_contents.visible=pouch_open; game._set_collisions(pouch_contents,pouch_open)
	if is_instance_valid(pouch_preview): pouch_preview.free()
	pouch_preview=ART.material_piece(RESOURCES[pouch_index]); pouch_contents.add_child(pouch_preview); pouch_preview.position=Vector3(0,0.035,0)
	var resource=RESOURCES[pouch_index]; var count=int(game.state.get("resources",{}).get(resource,0))
	pouch_label.text=resource.replace("_"," ").capitalize()+" × "+str(count)+"\n"+("GRIP ONE" if count>0 else "NONE HELD")+" · ‹ / › BROWSE"
	pouch_preview.scale=Vector3.ONE*(1.0 if count>0 else 0.65)

func costs()->Dictionary:
	var tier=int(game.state.get("tier",1))+1; var option=int(game.state.get("workshop",{}).get("donations",{}).get("option",0))
	for upgrade in game.state.get("upgrades",[]):
		if int(upgrade.tier)==tier and option<upgrade.costs.size(): return upgrade.costs[option]
	return {}

func ingest(snapshot:Dictionary):
	if snapshot.is_empty() or int(snapshot.get("revision",-1))<revision: return
	revision=int(snapshot.get("revision",revision))
	_sync_tokens(snapshot.get("tokens",[])); _update_pouch(); _labels()
	var tier=int(game.state.get("tier",1))
	if not construction: _apply_tier(tier)

func _labels():
	var tier=int(game.state.get("tier",1)); var cost=costs(); var counts=game.state.get("workshop",{}).get("donations",{}).get("counts",{})
	for i in range(4):
		stage_labels[i].text="BUILT" if i+1<tier else ("CURRENT" if i+1==tier else ("NEXT" if i==tier else "LATER"))
		stage_lights[i].material_override.albedo_color=Color("e6b769" if i+1==tier else ("90bca1" if i+1<tier else "687566"))
	for i in range(2):
		buckets[i].visible=i<cost.size()
		labels["bucket"+str(i)].text=""
		if i<cost.size():
			var resource=cost.keys()[i]; labels["bucket"+str(i)].text=resource.replace("_"," ").capitalize()+"  %d / %d"%[int(counts.get(resource,0)),int(cost[resource])]
	option_button.visible=tier==1
	game._set_collisions(option_button,option_button.visible)
	labels.cost.text="TIER %d → %d\n%s"%[tier,tier+1,"Tails" if int(game.state.get("workshop",{}).get("donations",{}).get("option",0))==0 else "Wood + stone"] if tier==1 else ("NEXT: "+ART.TITLES[tier] if tier<4 else "ALL STAGES\nBUILT")
	if not construction: labels.status.text="ALL STAGES BUILT" if tier==4 else ("READY · PULL LEVER" if ready() else "1 POUCH   2 BUCKETS   3 LEVER")

func ready()->bool:
	var cost=costs(); var counts=game.state.get("workshop",{}).get("donations",{}).get("counts",{})
	if cost.is_empty(): return false
	for resource in cost:
		if int(counts.get(resource,0))!=int(cost[resource]): return false
	return true

func _v(value)->Vector3: return Vector3(float(value.get("x",0)),float(value.get("y",0)),float(value.get("z",0)))
func token_data(id):
	for entry in game.state.get("workshop",{}).get("tokens",[]):
		if str(entry.id)==str(id): return entry
	return {}
func token_held(id)->bool: return held.values().has(id)

func _sync_tokens(items:Array):
	var wanted={}
	for token in items: wanted[str(token.id)]=token
	for id in tokens.keys():
		if not wanted.has(id):
			if is_instance_valid(tokens[id]): tokens[id].queue_free()
			tokens.erase(id)
	var bucket_slots={}
	for id in wanted:
		var data=wanted[id]
		if not tokens.has(id):
			var body=RigidBody3D.new(); body.name="WorkshopMaterial"; game.adventure.zone_groups.get(str(data.zone),root).add_child(body)
			body.mass=0.12; body.collision_layer=8; body.collision_mask=9; body.freeze=true
			body.set_meta("kind","workshop_token"); body.set_meta("token_id",id); body.set_meta("resource",str(data.resource)); body.add_child(ART.material_piece(str(data.resource)))
			var col=CollisionShape3D.new(); col.shape=BoxShape3D.new(); col.shape.size=Vector3(0.20,0.15,0.22); col.position.y=0.075; body.add_child(col); tokens[id]=body
		var node=tokens[id]
		if token_held(id): continue
		if data.place=="bucket":
			var bucket_index=costs().keys().find(str(data.resource)); bucket_index=maxi(0,bucket_index)
			if node.get_parent()!=buckets[bucket_index]: node.reparent(buckets[bucket_index])
			var slot=int(bucket_slots.get(str(data.resource),0)); bucket_slots[str(data.resource)]=slot+1
			node.freeze=true; node.collision_layer=0; node.collision_mask=0
			node.position=Vector3((slot%3-1)*0.115,0.14+floori(slot/3.0)*0.10,0); node.rotation=Vector3.ZERO
		else:
			var parent=game.adventure.zone_groups.get(str(data.zone),root)
			if node.get_parent()!=parent: node.reparent(parent)
			var signature=JSON.stringify(data.position)+str(data.zone)
			if node.get_meta("saved_position","")!=signature:
				node.global_position=_v(data.position); node.set_meta("saved_position",signature); node.set_meta("settle_at",game.elapsed+1.6)
			node.freeze=str(data.zone)!=game.adventure.zone; node.collision_layer=8; node.collision_mask=9

func _apply_tier(tier:int):
	if shown_tier==tier: return
	shown_tier=tier
	for i in range(stage_groups.size()): stage_groups[i].visible=i+2<=tier; game._set_collisions(stage_groups[i],i+2<=tier)
	ART.apply_gates(game,tier)

func sync_state(): ingest(game.state.get("workshop",{}))
func busy(hand)->bool:
	var key=str(hand.get_instance_id()); return held.has(key) or pending.has(key)
func grip_down(hand)->bool:
	return not hand is XRController3D or bool(game.last_inputs.get(str(hand.get_instance_id())+"g",false))

func try_grab(hand)->bool:
	if busy(hand): return true
	var key=str(hand.get_instance_id())
	if pouch_carrier==null and hand.global_position.distance_to(pouch.global_position)<0.19:
		pouch_carrier=hand
		held[key]="pouch"
		pouch.reparent(game.hand_socket(hand),true)
		game.adventure.haptic(hand,"ready")
		return true
	if pouch_open and hand.global_position.distance_to(pouch_preview.global_position+Vector3.UP*0.06)<0.16:
		pending[key]=true; released.erase(key); _take(hand); return true
	var closest=""; var distance=0.24
	for id in tokens:
		var node=tokens[id]
		if not is_instance_valid(node) or not node.is_visible_in_tree() or token_held(id): continue
		var d=node.global_position.distance_to(hand.global_position)
		if d<distance: closest=id; distance=d
	if not closest.is_empty():
		pending[key]=true; released.erase(key); _grab_token(closest,hand); return true
	if game.adventure.zone=="forge_yard" and hand.global_position.distance_to(knob.global_position)<0.19:
		held[key]="lever"; released.erase(key); game.adventure.haptic(hand,"ready"); return true
	return false

func _take(hand):
	var key=str(hand.get_instance_id())
	var result=await _send_action("material-take",{"resource":RESOURCES[pouch_index]})
	pending.erase(key)
	if not result.has("error") and result.has("token") and not released.has(key): _hold(str(result.token.id),hand)

func _grab_token(id,hand):
	var key=str(hand.get_instance_id()); var data=token_data(id); var response={}
	if data.get("place","")=="bucket": response=await _send_action("withdraw",{"tokenId":id})
	pending.erase(key)
	if not response.has("error") and not released.has(key): _hold(id,hand)

func _hold(id,hand):
	if not tokens.has(id) or token_held(id): return
	var node=tokens[id]; held[str(hand.get_instance_id())]=id; node.freeze=true; node.collision_layer=0; node.collision_mask=0
	node.reparent(game.hand_socket(hand)); node.transform=Transform3D.IDENTITY; node.position=Vector3(0,-0.04,-0.045)
	game.adventure.haptic(hand,"ready")

func release(hand)->bool:
	var key=str(hand.get_instance_id())
	if pending.has(key): released[key]=true; return true
	if not held.has(key): return false
	var id=held[key]
	if id=="pouch":
		held.erase(key)
		pouch_carrier=null
		pouch_open=false
		_update_pouch()
		pouch.reparent(game.grips.belt,true)
		var return_tween=create_tween().set_parallel(true)
		return_tween.tween_property(pouch,"position",pouch_home,0.22).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		return_tween.tween_property(pouch,"rotation",Vector3.ZERO,0.22).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		return true
	if id=="lever": held.erase(key); lever.rotation.x=0; lever_latched=false; return true
	pending[key]=true; _release_token(id,hand); return true

func _release_token(id,hand):
	var key=str(hand.get_instance_id()); var node=tokens.get(id)
	if not is_instance_valid(node): pending.erase(key); held.erase(key); return
	var position=node.global_position; var action_name="material-place"; var body={"tokenId":id,"zone":game.adventure.zone,"position":game._vec(position)}
	var data=token_data(id); var bucket_index=costs().keys().find(str(data.get("resource","")))
	if game.adventure.zone=="forge_yard" and bucket_index>=0 and position.distance_to(buckets[bucket_index].global_position+Vector3.UP*0.18)<0.34:
		action_name="donate"; body={"tokenId":id,"option":int(game.state.get("workshop",{}).get("donations",{}).get("option",0))}
	elif position.distance_to(pouch.global_position)<0.23: action_name="material-return"; body={"tokenId":id}
	# Stop following the hand immediately, but keep the piece reserved during the save.
	node.reparent(game.adventure.zone_groups[game.adventure.zone]); node.global_position=position; node.freeze=true
	var response=await _send_action(action_name,body)
	held.erase(key); pending.erase(key)
	if response.has("error"):
		if is_instance_valid(node): node.freeze=false; node.collision_layer=8; node.collision_mask=9; node.set_meta("settle_at",game.elapsed+1.5)
	else:
		_sync_tokens(game.state.get("workshop",{}).get("tokens",[])); game.adventure.haptic(hand,"ready")
		if action_name=="donate": game._notice(str(data.resource).replace("_"," ").capitalize()+" accepted. Your offering is saved.",4)

func action(value:String)->bool:
	if value=="workshop:pouch": pouch_open=not pouch_open; _update_pouch(); return true
	if value.begins_with("workshop:scroll:"): pouch_index=posmod(pouch_index+int(value.get_slice(":",2)),RESOURCES.size()); _update_pouch(); return true
	if value=="workshop:option": _send_action("option",{"option":1-int(game.state.get("workshop",{}).get("donations",{}).get("option",0))}); return true
	return false

func _send_action(action_name:String,body:Dictionary)->Dictionary:
	if game.diagnostic_offline: return {"error":"Visual preview: no materials are spent."}
	while sending: await get_tree().process_frame
	sending=true
	body=body.duplicate(true); body.requestId="workshop-%s-%s-%s"%[str(Time.get_unix_time_from_system()).replace(".","-"),str(Time.get_ticks_usec()),action_name]
	var response={}
	for attempt in range(2):
		await game._send_context()
		response=await game._request("/api/vr/workshop/"+action_name,body)
		if not response.has("error") or not response.get("transportError",false): break
	if not response.has("error"):
		# Poll responses contain voice/jobs/items; action responses intentionally do not.
		if int(response.get("workshop",{}).get("revision",0))>=revision:
			if response.has("committedTier"): _construction(int(response.committedTier))
			game.state.merge(response,true); ingest(response.get("workshop",{}))
			if game.enchantments!=null: game.enchantments.ingest(response.get("workshop",{}))
	else: game._notice(str(response.error),8)
	sending=false
	return response

func _construction(tier:int):
	construction=true; construction_until=game.elapsed+5; reveal_tier=tier; next_impact=game.elapsed; labels.status.text="Brann is building…"
	for bucket in buckets:
		for child in bucket.get_children():
			if child is RigidBody3D:
				var copy=ART.material_piece(str(child.get_meta("resource","stone"))); bucket.add_child(copy); copy.transform=child.transform; transition_copies.append(copy)
	game._notice("The offering is accepted. Brann is expanding the workshop.",5)

func _sound(stream,volume):
	if DisplayServer.get_name()=="headless": return
	var player=sounds[sound_serial%sounds.size()]; sound_serial+=1; player.stream=stream; player.volume_db=volume; player.play()

func _lever_angle(point:Vector3)->float:
	var local=table.to_local(point)-lever.position
	return clampf(atan2(local.z,local.y),0,1.2)

func tick(delta):
	if pouch_carrier!=null:
		if not is_instance_valid(pouch_carrier):
			pouch_carrier=null
			for held_key in held.keys():
				if held[held_key]=="pouch": held.erase(held_key)
			pouch_open=false
			_update_pouch()
			pouch.reparent(game.grips.belt,true)
			pouch.position=pouch_home
		elif pouch_carrier is XRController3D and not pouch_carrier.get_is_active():
			release(pouch_carrier)
		else:
			var lifted=pouch.global_position.y>game.grips.belt.global_position.y+0.17 and pouch.global_position.distance_to(game.camera.global_position)<0.85
			if lifted!=pouch_open:
				pouch_open=lifted
				_update_pouch()
				if lifted: game.adventure.haptic(pouch_carrier,"ready")
	for key in held.keys():
		if held[key]!="lever": continue
		var hand=instance_from_id(int(key))
		if not is_instance_valid(hand): held.erase(key); continue
		lever.rotation.x=_lever_angle(hand.global_position)
		if lever.rotation.x>=0.95 and not lever_latched and not construction:
			lever_latched=true
			if ready(): _send_action("commit",{"tier":int(game.state.get("tier",1))+1})
			else: game._notice("Fill each marked bucket before pulling the lever."); game.adventure.haptic(hand,"impact")
	if construction:
		var progress=clampf(1-(construction_until-game.elapsed)/5.0,0,1)
		for i in range(buckets.size()): buckets[i].position=bucket_home[i]+Vector3(0,0,-minf(progress*4,1)*0.8)
		for i in range(smoke_puffs.size()):
			var puff=smoke_puffs[i]; var t=fposmod(progress*2+i/20.0,1)
			puff.visible=true; puff.position=Vector3((i%5-2)*3.0,0.5+t*3.8,-4-floori(i/5.0)*1.8)
			puff.scale=Vector3.ONE*(1.6+t*1.5); puff.material_override.albedo_color.a=sin(PI*t)*sin(PI*progress)*0.42
		if game.elapsed>=next_impact: next_impact=game.elapsed+0.47; _sound(impact_streams[(sound_serial*3)%8],-19)
		if game.elapsed>=construction_until:
			construction=false; _apply_tier(reveal_tier); _sound(reveal_stream,-14)
			for puff in smoke_puffs: puff.visible=false
			for copy in transition_copies: if is_instance_valid(copy): copy.queue_free()
			transition_copies.clear()
			for i in range(buckets.size()): buckets[i].position=bucket_home[i]
			game.workshop_delivery.flourish(table.global_position+Vector3.UP,20,Color("ffd28c"),0.7)
			_labels(); game._notice(ART.TITLES[reveal_tier-1]+" is ready. Explore your new workshop wing!",10)
	if game.elapsed>=next_settle and not sending and not game.smoke and not game.diagnostic_offline:
		next_settle=game.elapsed+0.4
		for id in tokens:
			var node=tokens[id]
			if not is_instance_valid(node) or token_held(id) or token_data(id).get("place","")!="loose" or not node.is_visible_in_tree(): continue
			if game.elapsed<float(node.get_meta("settle_at",1e20)): continue
			node.set_meta("settle_at",1e20)
			if node.global_position.y < -10: node.global_position=game.camera.global_position-Vector3.UP*0.5
			if node.global_position.distance_to(_v(token_data(id).position))>0.03: _send_action("material-place",{"tokenId":id,"zone":game.adventure.zone,"position":game._vec(node.global_position)})
			break

func checks(failures:Array):
	if stage_groups.size()!=3 or buckets.size()!=2: failures.append("workshop architecture or buckets")
	if _lever_angle(table.to_global(lever.position+Vector3(0,0.5,0)))>0.01: failures.append("lever auto pull")
	if _lever_angle(table.to_global(lever.position+Vector3(0,0.1,0.5)))<0.95: failures.append("lever physical travel")
	if RESOURCES.size()!=10: failures.append("pouch materials")
	for button in pouch.get_children():
		for child in button.get_children():
			if child is StaticBody3D and child.collision_layer!=4: failures.append("pouch blocks locomotion")

func _exit_tree():
	for player in sounds:
		if is_instance_valid(player): player.stop(); player.stream=null
	impact_streams.clear(); reveal_stream=null
