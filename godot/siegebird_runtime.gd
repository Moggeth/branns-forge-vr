extends Node
## Native physical mechanism for the published Siegebird. Author coordinates are
## converted once; the asset remains intact and the two-hand grip solver owns aim.
const ITEM_ID="20dc22c5-7bcc-43df-b07f-e81eab521b0f"
const TURNS=2.0
const SPEED=24.0
const REACH=0.13
var game
var handle_pose=preload("res://anchored_hand.gd").new()
var extras
var weapons=[]
var occupied={}
var projectiles=[]
var embedded=[]
const BOLT_LIFETIME=120.0
const BOLT_CAP=20
const GRAVITY=2.4
const SkeletonContact=preload("res://skeleton_projectile_contact.gd")
var loose=[]
var supply:Node3D
var sounds={}
var audio_players=[]
var audio_index=0

func setup(owner_game):
	game=owner_game
	extras=preload("res://siegebird_extras.gd").new(); add_child(extras); extras.setup(game,self)
	supply=Node3D.new()
	game.grips.belt.add_child(supply)
	# The quiver belongs at the belt, close enough to retrieve without reaching
	# into empty air in front of the torso.
	supply.position=Vector3(0,-0.02,-0.07)
	var quiver_scene=load("res://assets/siegebird/quiver.glb")
	if quiver_scene is PackedScene:
		var quiver_art=quiver_scene.instantiate()
		quiver_art.name="SiegebirdQuiverArt"
		supply.add_child(quiver_art)
	else:
		push_error("SIEGEBIRD quiver art did not import")
	supply.visible=false
	for id in ["fire","click","seat"]: sounds[id]=sound_wave(id)
	for i in range(4):
		var player=AudioStreamPlayer3D.new(); game.add_child(player)
		player.max_distance=12; audio_players.append(player)

func sound_wave(id:String)->AudioStreamWAV:
	var bytes=PackedByteArray()
	var duration=0.23 if id=="fire" else 0.055
	var count=int(duration*22050)
	bytes.resize(count*2)
	var rng=RandomNumberGenerator.new(); rng.seed=72
	for i in range(count):
		var t=float(i)/22050.0
		var frequency=155.0 if id=="fire" else (850.0 if id=="click" else 480.0)
		var wave=(sin(TAU*frequency*t)*0.55+sin(TAU*frequency*2.37*t)*0.2+rng.randf_range(-0.2,0.2))*exp(-t*(22 if id=="fire" else 80))
		bytes.encode_s16(i*2,int(wave*18000))
	var stream=AudioStreamWAV.new(); stream.format=AudioStreamWAV.FORMAT_16_BITS; stream.mix_rate=22050; stream.data=bytes
	return stream

func sound(id:String,point:Vector3):
	if game.diagnostic_offline or DisplayServer.get_name()=="headless": return
	var player=audio_players[audio_index%audio_players.size()]; audio_index+=1
	player.global_position=point; player.stream=sounds[id]
	player.volume_db=(-14 if id=="fire" else -23)+linear_to_db(maxf(0.001,game.tuning.value("audio.volume")))
	player.play()

func busy(hand)->bool: return occupied.has(str(hand.get_instance_id()))

func author(p:Vector3)->Vector3: return Vector3(p.x,p.z,-p.y)

func find_part(node:Node,prefix:String):
	if str(node.name).begins_with(prefix): return node
	for child in node.get_children():
		var found=find_part(child,prefix)
		if found!=null: return found
	return null

const ASSEMBLY_PATH="res://assets/siegebird/siegebird.glb"
var config:Dictionary=JSON.parse_string(FileAccess.get_file_as_string("res://assets/siegebird/assembly.json").trim_prefix("\ufeff"))

func point(key:String)->Vector3:
	var p=config[key]
	return Vector3(p[0],p[1],p[2])

func attach(item:Node3D,model:Node3D):
	if str(item.get_meta("id",""))!=ITEM_ID: return
	var parts={}
	for name in ["Bolt","Crank","CrankKnob","Pinion","Reduction","Drum","Sled","Clutch","Latch","Trigger","OpticRear","BoltSeat","GripAnchor"]:
		parts[name]=find_part(model,name)
		if parts[name]==null:
			push_error("SIEGEBIRD assembly contract missing "+name)
			return
	item.set_meta("crossbow",true)
	item.set_meta("grip_axis_origin",model.transform*parts.GripAnchor.position)
	item.set_meta("grip_min",(model.transform*parts.GripAnchor.position).y)
	item.set_meta("grip_max",(model.transform*Vector3(0,0.93,-0.155)).y)
	var instructions="Squeeze trigger through its short take-up to fire a loaded bolt. Free hand: grip the brass crank and turn forward until it clicks ready. Take an unlimited belt bolt, point its tip forwards along the rail, then release to seat. The crank stays still when firing. Grip embedded bolts along the shaft to recover them; release by the quiver to restash. Hold a bolt to stab, or throw it with a flick and release. Grip a reel and place it on the side socket; flip the brass tab for grapple shots. Wind to reel; trigger releases the tether."
	item.set_meta("description",instructions)
	item.set_meta("use_instructions",instructions)
	var ropes=find_part(model,"LiveCord")
	if ropes==null or ropes.get_child_count()!=20:
		push_error("SIEGEBIRD missing twenty authored cord segments"); return
	var label=WorkshopScene.label(model,"READY · TRIGGER",Vector3(-0.12,0.42,0.12),14)
	label.pixel_size=0.0011; label.rotation.x=PI/2
	var w={"item":item,"model":model,"bolt":parts.Bolt,"pivot":parts.Crank,"knob":parts.CrankKnob,"pinion":parts.Pinion,"reduction":parts.Reduction,"drum":parts.Drum,"drum_original_scale":parts.Drum.scale,"string":ropes,"sled":parts.Sled,"clutch":parts.Clutch,"latch":parts.Latch,"trigger":parts.Trigger,"optic":parts.OpticRear,"seat":parts.BoltSeat,"grip":parts.GripAnchor,"label":label,"draw":1.0,"angle":0.0,"loaded":true,"release":0.0,"owner":null,"ready_announced":false}
	w["status_material"]=WorkshopScene.material("79ccb2",0.25,0.3,0.5)
	w["status_lamp"]=WorkshopScene.ball(model,Vector3(-0.075,0.40,0.105),Vector3(0.018,0.018,0.010),w.status_material)
	w["flex"]=[]
	for node in model.find_children("*","MeshInstance3D",true,false):
		for i in range(node.get_blend_shape_count()):
			if node.mesh.get_blend_shape_name(i) in ["Drawn","Narrow"]: w.flex.append({"node":node,"index":i,"axis":node.mesh.get_blend_shape_name(i)})
	for cord in ropes.get_children():
		var material=ShaderMaterial.new(); material.shader=preload("res://siege_rope.gdshader")
		cord.material_override=material
	weapons.append(w)
	extras.attach(w)
	mechanism(w)
	print("SIEGEBIRD assembly v3 attached; named parts=true loaded=",w.loaded," turns=",TURNS)

func segment(node:Node3D,a:Vector3,b:Vector3):
	var direction=b-a
	node.position=(a+b)*0.5
	node.quaternion=Quaternion(Vector3.UP,direction.normalized())
	node.scale=Vector3(1,maxf(0.0001,direction.length()),1)

func mechanism(w):
	# The crank drives through a clutch. On release the gears/drum unwind,
	# while the crank and the player's other hand remain stationary.
	var draw_y=lerpf(float(config.draw_front),float(config.draw_rear),w.draw)
	var tip_y=0.80-0.03*w.draw
	var tip_x=sqrt(0.551*0.551+0.01*0.01-pow(tip_y-draw_y,2))
	for entry in w.flex: entry.node.set_blend_shape_value(entry.index,w.draw if entry.axis=="Drawn" else (0.551-tip_x)/0.053)
	w.pivot.rotation.x=w.angle
	w.knob.rotation.x=-w.angle
	w.pinion.rotation.x=w.draw*TAU*TURNS
	w.reduction.rotation.x=-w.draw*TAU*TURNS/2.0+PI/20
	w.drum.rotation.x=-w.draw*TAU*TURNS/2.0
	w.clutch.position=Vector3(0.243+(0.027 if w.release>0 else 0),0.54,0)
	w.latch.rotation.y=-0.8 if w.release>0 else 0.0
	w.trigger.rotation.x=-0.32 if w.release>0 else -0.26*float(w.get("trigger_pressure",0.0))
	var draw=lerpf(float(config.draw_front),float(config.draw_rear),w.draw)
	w.sled.position=Vector3(0,draw,0)
	for i in range(2):
		var bow=w.string.get_child(i)
		segment(bow,Vector3((-1 if i==0 else 1)*tip_x,tip_y,0.105),Vector3(0,draw,0.179))
		if bow.material_override is ShaderMaterial: bow.material_override.set_shader_parameter("span",bow.scale.y)
	# A side-routed cable avoids cutting through the stock or bolt channel.
	var cable=cable_path(draw)
	var distance=0.0
	for i in range(18):
		var cord=w.string.get_child(i+2)
		segment(cord,cable[i],cable[i+1])
		if cord.material_override is ShaderMaterial:
			cord.material_override.set_shader_parameter("span",cord.scale.y)
			cord.material_override.set_shader_parameter("travel",w.draw*float(config.travel)-distance)
		distance+=cord.scale.y
	w.bolt.visible=w.loaded
	if w.has("hook_art"): w.hook_art.visible=w.loaded and w.get("grapple_mode",false)
	_status(w)

func knob(w)->Vector3: return w.knob.global_position

func cranking(w)->bool:
	for entry in occupied.values():
		if entry.type=="crank" and entry.w==w: return true
	return false

func try_grab(hand)->bool:
	var key=str(hand.get_instance_id())
	if busy(hand): return true
	if game.held.has(key): return false
	for w in weapons:
		if not is_instance_valid(w.item) or w.item not in game.held.values() or ((w.loaded or w.draw>=0.999) and not extras.tethered(w)) or w.release>0 or cranking(w): continue
		if hand.global_position.distance_to(knob(w))<game.tuning.value("crossbow.crank_reach"):
			var p=w.model.to_local(hand.global_position)-w.pivot.position
			occupied[key]={"type":"crank","hand":hand,"w":w,"angle":atan2(p.z,p.y)}
			handle_pose.attach(hand,w.knob,Transform3D(Basis(Vector3.UP,Vector3.RIGHT,Vector3.FORWARD),Vector3(0.035,0.025,0)),extras.setting(w,"crank_snap_seconds",0.08))
			game.adventure.haptic(hand,"ready")
			game._notice("Turn the crank to pull yourself towards the hook. Holding-hand trigger releases the line." if extras.tethered(w) else "Turn the crank around its axle. %d turn(s) draw the string; then place a belt bolt on the rail."%int(_turns(w)),5)
			return true
	if extras.try_grab(hand): return true
	if supply.visible and hand.global_position.distance_to(supply.global_position+Vector3.UP*0.10)<0.19:
		extras.draw_bolt(hand)
		return true
	for entry in loose:
		if is_instance_valid(entry.node) and hand.global_position.distance_to(entry.node.global_position)<REACH:
			if entry.node.get_meta("spent_shot",false): extras.recover_loose(entry,hand); return true
			entry.node.reparent(game.hand_socket(hand))
			entry.node.position=Vector3(0,0,-0.1); entry.node.rotation=Vector3(-PI/2,0,0)
			occupied[key]={"type":"bolt","hand":hand,"node":entry.node}
			entry.body.queue_free()
			loose.erase(entry)
			return true
	return false

func make_bolt()->Node3D:
	var bolt=Node3D.new(); game.add_child(bolt)
	for w in weapons:
		if not is_instance_valid(w.item): continue
		var copy=w.bolt.duplicate(0)
		bolt.add_child(copy)
		copy.transform=Transform3D(w.model.basis,Vector3.ZERO)
		copy.show()
		bolt.set_meta("tip",w.model.basis*Vector3(0,0.526,0))
		return bolt
	return bolt

func can_load(w,bolt)->bool:
	if w.loaded or w.get("pending",false) or w.release>0 or cranking(w) or w.draw<0.999 or extras.tethered(w): return false
	# The loose bolt origin is its nock, not its tip. Accept the cocked sled
	# through the forward seat, without a large spherical magnet around the gun.
	var rear=w.model.to_global(Vector3(0,float(config.draw_rear),float(config.rail_height)))
	var nearest=Geometry3D.get_closest_point_to_segment(bolt.global_position,rear,w.seat.global_position)
	return bolt.global_position.distance_to(nearest)<extras.setting(w,"load_reach",0.19) and bolt.global_basis.y.normalized().dot(w.item.global_basis.y.normalized())>0.70

func seat_bolt(w,bolt,hand):
	if not game.diagnostic_offline:
		extras.load_bolt(w,bolt,hand)
		return
	w.loaded=true
	sound("seat",bolt.global_position)
	bolt.queue_free()
	mechanism(w)
	if is_instance_valid(hand): game.adventure.haptic(hand,"ready")
	game._notice("Bolt seated. Siegebird is ready.")

func release(hand)->bool:
	var key=str(hand.get_instance_id())
	if not occupied.has(key): return false
	var entry=occupied[key]
	occupied.erase(key)
	if entry.type=="crank":
		handle_pose.detach(hand)
		return true
	if entry.type=="selector": return true
	if entry.type=="pending": extras.release_pending(hand); return true
	if entry.type=="reel": extras.release_reel(hand,entry); return true
	for w in weapons:
		if is_instance_valid(w.item) and w.item in game.held.values() and can_load(w,entry.node):
			seat_bolt(w,entry.node,hand)
			return true
	if entry.node.global_position.distance_to(supply.global_position)<0.23 and not game.diagnostic_offline:
		extras.return_bolt(entry.node); return true
	var bolt=entry.node
	var body=RigidBody3D.new()
	game.add_child(body)
	body.global_transform=bolt.global_transform
	body.collision_layer=8; body.collision_mask=9
	body.mass=0.08; body.continuous_cd=true
	body.linear_velocity=game.adventure.motion.get(key,{}).get("velocity",Vector3.ZERO).limit_length(18)
	body.angular_velocity=Vector3.ZERO
	bolt.reparent(body)
	var shape=CollisionShape3D.new()
	var box=BoxShape3D.new(); box.size=Vector3(0.035,0.80,0.035)
	shape.shape=box; shape.position.y=0.14; body.add_child(shape)
	loose.append({"node":bolt,"body":body,"until":game.elapsed+120,"zone":game.adventure.zone,"catch_until":game.elapsed+1.0,"load_hand":hand})
	if loose.size()>12:
		extras.retire(loose[0].node); loose[0].body.queue_free(); loose.pop_front()
	return true

func wind(w,delta_angle:float):
	# Ratchet accepts positive turns only: 10-tooth coaxial pinion / 20-tooth
	# take-up gear. Two crank turns = one drum turn = 0.255 m of string travel.
	if w.loaded or w.draw>=1.0 or w.release>0: return
	var accepted=clampf(delta_angle,0.0,0.7)
	var turns=_turns(w)
	var before=w.draw
	w.draw=minf(1.0,w.draw+accepted/(TAU*turns))
	w.angle+=(w.draw-before)*TAU*turns
	if w.draw>=0.999 and before<0.999:
		sound("seat",knob(w))
		game._notice("Siegebird cocked. Seating a bolt…" if not game.vr else "Siegebird cocked. Release the crank, then seat a bolt.",3)
	mechanism(w)

func desktop_weapon(hand:Node3D):
	if not is_instance_valid(hand): return null
	var item=game.held.get(str(hand.get_instance_id()))
	if not is_instance_valid(item): return null
	for w in weapons:
		if is_instance_valid(w.item) and w.item==item: return w
	return null

func desktop_reload_deferred(hand_id:int,automatic:bool=false):
	# A grip can disappear before its queued auto-load starts (for example on
	# travel, drop, or teardown). Defer the ID, not a soon-to-be-freed Object.
	var hand=instance_from_id(hand_id) as Node3D
	if is_instance_valid(hand): desktop_reload(hand,automatic)

func desktop_reload(hand:Node3D,automatic:bool=false):
	if game.vr: return
	var w=desktop_weapon(hand)
	if w==null or w.loaded or w.get("desktop_reloading",false) or extras.tethered(w): return
	w.desktop_reloading=true
	# A restored chamber is authoritative. Wait for the initial ledger resume before
	# taking a new finite bolt, and let the same command work offline in checks.
	if not game.diagnostic_offline:
		var deadline=Time.get_ticks_msec()+5000
		while (not extras.initialized or extras.request_busy or int(extras.snapshot.revision)<0) and Time.get_ticks_msec()<deadline:
			await game.get_tree().process_frame
		if not extras.initialized or extras.request_busy or int(extras.snapshot.revision)<0:
			w.desktop_reloading=false
			if not automatic: game._notice("Quiver is still connecting. Try R again.",3)
			return
	if w.loaded or desktop_weapon(hand)!=w:
		w.desktop_reloading=false
		return
	if not automatic: game._notice("Cranking Siegebird…",2)
	while w.release>0.001 and desktop_weapon(hand)==w:
		await game.get_tree().process_frame
	while w.draw<0.999 and desktop_weapon(hand)==w:
		wind(w,minf(0.7,game.get_process_delta_time()*TAU*_turns(w)/0.85))
		await game.get_tree().process_frame
	if desktop_weapon(hand)!=w:
		w.desktop_reloading=false
		return
	if game.diagnostic_offline:
		w.loaded=true
		mechanism(w)
		w.desktop_reloading=false
		return
	var draw_response=await extras._rpc("draw")
	if draw_response.has("error"):
		w.desktop_reloading=false
		return
	var token=str(draw_response.token)
	if desktop_weapon(hand)!=w:
		await extras._rpc("return",{"token":token})
		w.desktop_reloading=false
		return
	var load_response=await extras._rpc("load",{"token":token,"weaponId":str(w.item.get_meta("id"))})
	if load_response.has("error"):
		await extras._rpc("return",{"token":token})
	else:
		w.ammo_token=token
		w.loaded=true
		mechanism(w)
		sound("seat",w.seat.global_position)
		game._notice("Siegebird loaded · left click to fire · R to reload.",4)
	w.desktop_reloading=false

func _turns(w)->float:
	return 1.0 if game.enchantments!=null and game.enchantments.quickwind(w.item) else TURNS

func trigger(hand)->bool:
	if busy(hand): return true
	var item=game.held.get(str(hand.get_instance_id()))
	if not is_instance_valid(item): return false
	for w in weapons:
		if not is_instance_valid(w.item) or w.item!=item: continue
		if extras.trigger(w,hand): return true
		if w.release>0: return true
		if cranking(w):
			game._notice("Release the crank before firing."); return true
		if not w.loaded or w.draw<0.999:
			game._notice(("Siegebird is loading…" if w.get("desktop_reloading",false) else "Press R to cock and seat a quiver bolt.") if not game.vr else ("Place a bolt on the cocked rail." if w.draw>=0.999 else "Grip the crank with your free hand: %d turn(s)."%int(_turns(w))))
			return true
		if not game.diagnostic_offline and not w.get("fire_authorized",false):
			extras.fire_bolt(w,hand); return true
		w.fire_authorized=false
		var bolt=make_bolt()
		bolt.set_meta("ammo_token",w.get("ammo_token","")); bolt.set_meta("spent_shot",true)
		bolt.global_basis=item.global_basis
		bolt.global_position=w.seat.global_position
		var hot=game.heat_contacts!=null and game.heat_contacts.hot_at(bolt.to_global(bolt.get_meta("tip",Vector3.UP*.35)),game.adventure.zone,.43)
		if hot:
			var ember=WorldZones.rock(bolt,bolt.get_meta("tip",Vector3.UP*.35),Vector3.ONE*.048,"ffbb68")
			ember.material_override=WorldZones.mat("ffad55",1.35)
			game._effect(bolt.global_position,Color("ffad55"),.12,.12)
		var module_kind=game.enchantments.kind_for(item) if game.enchantments!=null else ""
		# Module state is captured at fire time so changing hands/optics cannot alter a shot.
		projectiles.append({"node":bolt,"velocity":item.global_basis.y.normalized()*extras.setting(w,"bolt_speed",44.0),"hand":hand,"until":game.elapsed+12,"zone":game.adventure.zone,"module":module_kind,"truesight_at_fire":game.enchantments.truesight_optics(w),"grapple":w.get("grapple_mode",false),"weapon":w,"damage":extras.setting(w,"damage",95.0),"hot":hot})
		w.loaded=false; w.release=float(config.release_seconds); w.owner=hand
		game.adventure.haptic(hand,"impact")
		sound("fire",bolt.global_position)
		game._effect(bolt.global_position,Color("c080ff"),0.09,0.16)
		mechanism(w)
		print("SIEGEBIRD fired")
		return true
	return false

func tick(delta):
	extras.tick(delta)
	for hand in game.hands:
		hand.set_meta("siege_trigger",-1.0)
		if hand.has_meta("siege_finger_target"): hand.remove_meta("siege_finger_target")
	supply.visible=game.vr
	for entry in occupied.values():
		if entry.type=="bolt": supply.visible=true
	for w in weapons:
		if not is_instance_valid(w.item): continue
		var entries=game.grips._entries(w.item)
		if not entries.is_empty():
			supply.visible=true
			var holding_hand=game.grips.grips[entries[0]].hand
			w.trigger_pressure=clampf(holding_hand.get_float("trigger"),0,1) if holding_hand is XRController3D else 0.0
			holding_hand.set_meta("siege_trigger",w.trigger_pressure)
			w.trigger.rotation.x=-0.26*w.trigger_pressure
		else: w.trigger_pressure=0.0; w.trigger.rotation.x=0.0
		if entries.size()==1 and not game.grips.adjusting.has(entries[0]):
			var hand=game.grips.grips[entries[0]].hand
			var aim=game.aim_source(hand)
			# Same authored/calibrated pose as initial attachment. Two hands remain
			# governed by their positions in grip_runtime, never this one-hand path.
			w.item.global_transform=aim.global_transform*game.grips.pose_for(w.item,hand)
			game.grips.grips[entries[0]].point=w.item.to_local(hand.global_position)
			game.grips.grips[entries[0]].basis=game.hand_socket(hand).global_basis.inverse()*w.item.global_basis
		if w.release>0:
			w.release=maxf(0,w.release-delta)
			w.draw=w.release/float(config.release_seconds)
			mechanism(w)
		# Seat against the final pose this frame, after one/two-hand aiming and sear movement.
		if not entries.is_empty():
			var holder=game.grips.grips[entries[0]].hand
			var target=w.trigger.to_global(Vector3(0,0.018,-0.046))
			holder.set_meta("siege_finger_target",target)
			var joints=holder.get_meta("finger_joints",[])
			if joints.size()>=3: preload("res://hand_animation.gd").seat_index(joints.slice(0,3),target,delta)
		_status(w)
	for key in occupied.keys():
		var entry=occupied[key]
		if entry.type=="crank":
			var w=entry.w
			if not is_instance_valid(w.item) or w.item not in game.held.values(): handle_pose.detach(entry.hand); occupied.erase(key); continue
			var p=w.model.to_local(entry.hand.global_position)-w.pivot.position
			var distance=entry.hand.global_position.distance_to(knob(w))
			entry["away"]=float(entry.get("away",0))+delta if distance>extras.setting(w,"crank_break_distance",0.38) else 0.0
			if distance>0.65 or entry.away>0.15 or (entry.hand is XRController3D and not entry.hand.get_is_active()):
				handle_pose.detach(entry.hand); occupied.erase(key); game._notice("Crank released — hand moved out of reach.",2); continue
			var angle=atan2(p.z,p.y)
			var change=wrapf(angle-entry.angle,-PI,PI)
			entry.angle=angle
			if Vector2(p.y,p.z).length()<0.08: continue
			var was_ready=w.draw>=0.999
			var before=int(w.draw*_turns(w)*20)
			if extras.tethered(w): extras.reel(w,maxf(0,change),delta)
			else: wind(w,change)
			if int(w.draw*_turns(w)*20)!=before:
				sound("click",knob(w))
				game.adventure.haptic(entry.hand,"release")
			if not was_ready and w.draw>=0.999: game.adventure.haptic(entry.hand,"ready")
		elif entry.type=="bolt":
			for w in weapons:
				if is_instance_valid(w.item) and w.item in game.held.values() and can_load(w,entry.node):
					w.label.text="RELEASE TO SEAT"
					w.status_text="RELEASE TO SEAT"
	# A deliberate drop may arrive at the rail after grip release. Only fresh,
	# slow drops qualify; old floor bolts and flying ammunition never auto-load.
	for entry in loose.duplicate():
		if game.elapsed>float(entry.get("catch_until",-1)) or entry.zone!=game.adventure.zone or not is_instance_valid(entry.node) or not is_instance_valid(entry.body): continue
		if entry.body.linear_velocity.length()>3.0 or entry.node.get_meta("spent_shot",false) or extras.request_busy: continue
		for w in weapons:
			if is_instance_valid(w.item) and w.item in game.held.values() and can_load(w,entry.node):
				loose.erase(entry)
				entry.node.reparent(game)
				entry.body.queue_free()
				seat_bolt(w,entry.node,entry.get("load_hand"))
				break
	handle_pose.tick(delta)
	for entry in occupied.values():
		if entry.type=="bolt": _knife_contact(entry.node,entry.hand,delta)
	for entry in loose:
		if is_instance_valid(entry.node): _knife_contact(entry.node,null,delta)
	for shot in projectiles.duplicate():
		if shot.get("zone",game.adventure.zone)!=game.adventure.zone:
			if is_instance_valid(shot.node): extras.retire(shot.node); shot.node.queue_free()
			projectiles.erase(shot); continue
		if not is_instance_valid(shot.node): projectiles.erase(shot); continue
		var start=shot.node.to_global(shot.node.get_meta("tip",Vector3.UP*0.35))
		var drag=maxf(0.00001,game.tuning.value("crossbow.drag"))
		var decay=exp(-drag*delta)
		var terminal=Vector3.DOWN*game.tuning.value("crossbow.gravity")/drag
		var end=start+(shot.velocity-terminal)*(1.0-decay)/drag+terminal*delta
		if shot.get("hot",false) and game.heat_contacts!=null:
			var steps=mini(10,maxi(1,ceili(start.distance_to(end)/.6)))
			for segment in range(steps):
				game.heat_contacts.sweep(start.lerp(end,float(segment)/steps),start.lerp(end,float(segment+1)/steps),.18,95,shot.zone,"hot_bolt",shot.node,delta/steps)
		shot.velocity=shot.velocity*decay+terminal*(1.0-decay)
		var hit=_projectile_contact(start,end)
		var forward=shot.velocity.normalized()
		shot.node.global_basis=Basis.looking_at(forward,Vector3.RIGHT if absf(forward.dot(Vector3.UP))>0.98 else Vector3.UP)*Basis(Vector3.RIGHT,Vector3.FORWARD,Vector3.UP)
		var tip=shot.node.get_meta("tip",Vector3.UP*0.35)
		shot.node.global_position=(end if hit.is_empty() else hit.position+forward*0.045)-shot.node.global_basis*tip
		if not hit.is_empty():
			if shot.get("hot",false) and game.heat_contacts!=null:
				game.heat_contacts.touch(hit.position+hit.normal*.035,.45,240,shot.zone,"hot_bolt_impact",shot.node,.1)
			var target=game._owner(hit.collider)
			var embed_surface:Node3D=hit.get("surface",hit.collider)
			if target!=null:
				match str(target.get_meta("kind","")):
					"pumpkin":
						if game.pumpkins!=null:
							var stabber=Node3D.new(); stabber.set_meta("pointed",true)
							game.pumpkins.impact(target,stabber,hit.position,hit.normal,shot.velocity)
							stabber.free()
					"apple":
						var fallen=game.apples.impact(target,shot.velocity.length(),hit.position,shot.velocity)
						if is_instance_valid(fallen): embed_surface=fallen
					"enemy":
						var skeleton_hit=str(target.get_meta("enemy_type",""))=="skeleton"
						var headshot=skeleton_hit and str(hit.get("part",""))=="head"
						game.adventure.hurt_enemy(target,_projectile_damage(target,float(shot.get("damage",95)),headshot),shot.hand,shot.velocity.normalized(),"headshot" if headshot else ("fire" if shot.get("hot",false) else "projectile"),hit.position)
						if skeleton_hit and not target.get_meta("alive",true):
							embed_surface=_fallen_bone(target,hit.position,str(hit.get("part","")))
					"rat": game._kill_rat(target)
					"dummy": game._dummy_hit(target)
			extras.impact(shot,hit,target)
			embed(shot.node,embed_surface)
			projectiles.erase(shot)
		elif game.elapsed>shot.until:
			extras.retire(shot.node); shot.node.queue_free(); projectiles.erase(shot)
	for entry in embedded.duplicate():
		if not is_instance_valid(entry.node): embedded.erase(entry); continue
		if game.elapsed>entry.until:
			extras.retire(entry.node); entry.node.queue_free(); embedded.erase(entry)
		elif is_instance_valid(entry.surface) and entry.surface.is_visible_in_tree(): entry.node.global_transform=entry.surface.global_transform*entry.local
		elif is_instance_valid(entry.surface) and not entry.surface.is_visible_in_tree(): entry.node.visible=false
	for entry in loose.duplicate():
		entry.body.freeze=entry.get("zone",game.adventure.zone)!=game.adventure.zone
		entry.body.visible=not entry.body.freeze
		if not is_instance_valid(entry.node) or entry.node.get_parent()!=entry.body or game.elapsed>entry.until:
			if is_instance_valid(entry.node): extras.retire(entry.node)
			entry.body.queue_free(); loose.erase(entry)

func embed(bolt:Node3D,surface:Node3D):
	var owner=game._owner(surface)
	if owner!=null and owner.get_meta("kind","")=="enemy" and not owner.get_meta("alive",true):
		extras._drop(bolt); return
	var zone=game.adventure.zone_groups.get(game.adventure.zone,game)
	var local=surface.global_transform.affine_inverse()*bolt.global_transform
	bolt.reparent(zone)
	for child in bolt.find_children("*","MeshInstance3D",true,false): child.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	embedded.append({"node":bolt,"until":game.elapsed+game.tuning.value("crossbow.bolt_lifetime"),"zone":zone,"surface":surface,"local":local})
	while embedded.size()>int(game.tuning.value("crossbow.bolt_cap")):
		var old=embedded.pop_front()
		if is_instance_valid(old.node): extras.retire(old.node); old.node.queue_free()
	print("BOLT_EMBED count=",embedded.size()," lifetime=",BOLT_LIFETIME)

func _projectile_contact(start: Vector3,end: Vector3) -> Dictionary:
	var space=game.get_world_3d().direct_space_state
	var excluded: Array[RID]=[]
	var world_hit := {}
	# The interaction box is useful for hand targeting, but has no physical
	# bone surface. Skip only that box and retain all scenery/shield hits.
	for attempt in range(24):
		var query=PhysicsRayQueryParameters3D.create(start,end,1,excluded)
		world_hit=space.intersect_ray(query)
		if world_hit.is_empty(): break
		var target=game._owner(world_hit.collider)
		if target==null or str(target.get_meta("kind",""))!="enemy" or str(target.get_meta("enemy_type",""))!="skeleton": break
		excluded.append(world_hit.collider.get_rid())
		world_hit={}
	var limit=start.distance_squared_to(world_hit.position) if not world_hit.is_empty() else start.distance_squared_to(end)
	var bone_hit := {}
	for actor in game.scene.get("enemies",[]):
		if not is_instance_valid(actor) or str(actor.get_meta("enemy_type",""))!="skeleton" or not actor.get_meta("alive",true): continue
		if str(actor.get_meta("zone",game.adventure.zone))!=game.adventure.zone: continue
		if Geometry3D.get_closest_point_to_segment(actor.global_position+Vector3.UP,start,end).distance_squared_to(actor.global_position+Vector3.UP)>4.0: continue
		var contact := {}
		if game.guardians!=null and game.guardians.has_method("projectile_contact"):
			contact=game.guardians.projectile_contact(actor,start,end)
		if contact.is_empty():
			var rig: Dictionary=game.animation.actors.get(actor.get_instance_id(),{})
			contact=SkeletonContact.contact(actor,rig,start,end)
		if contact.is_empty(): continue
		var distance=start.distance_squared_to(contact.position)
		if distance>limit: continue
		limit=distance
		bone_hit={"position":contact.position,"normal":contact.normal,"collider":actor,"surface":contact.surface,"part":contact.part}
	return bone_hit if not bone_hit.is_empty() else world_hit

func _projectile_damage(target: Node3D, base_damage: float, headshot: bool) -> float:
	if str(target.get_meta("enemy_type",""))!="skeleton": return base_damage
	# The default skeleton has 66 HP. A body bolt must not one-shot it even
	# when a live interaction profile increases the base crossbow damage.
	if headshot:
		return maxf(base_damage*2.0,float(target.get_meta("max_hp",66))) if str(target.get_meta("guardian_variant",""))=="" else base_damage*2.0
	return minf(base_damage*0.35,32.0)

func _fallen_bone(actor: Node3D, point: Vector3, part: String) -> Node3D:
	var nearest: Node3D=null
	var distance:=INF
	for body in game.remains.bodies:
		if not is_instance_valid(body) or int(body.get_meta("source_actor",-1))!=actor.get_instance_id(): continue
		for piece in body.get_children():
			if not piece is Node3D: continue
			if part=="head" and piece.name!="Skull": continue
			var candidate:float=piece.global_position.distance_squared_to(point)
			if candidate<distance:
				distance=candidate
				nearest=piece
	return nearest if nearest!=null else game.adventure.zone_groups.get(game.adventure.zone,game)

func checks(failures:Array):
	if _turns({"item":null})!=TURNS: failures.append("quickwind default turns changed")
	# The strict optic geometry must reject a point behind the eye and sideways gaze.
	var axis=Vector3.UP; var optic=Vector3(0,0.30,0); var behind=Vector3(0,-0.30,0)
	if optic.dot(axis)<0.03 or behind.dot(axis)>=0.03 or Vector3.RIGHT.dot(axis)>0.94: failures.append("optic front/back/gaze regression")

## Invoked by the offline Siegebird check. A real layer-1 interaction box
## surrounds separated visible meshes, so this tests the complete ray choice.
func projectile_checks(failures:Array) -> void:
	var actor:=Node3D.new()
	actor.name="ProjectileContactFixture"
	game.add_child(actor)
	actor.global_position=Vector3(800,40,800)
	actor.set_meta("kind","enemy")
	actor.set_meta("enemy_type","skeleton")
	actor.set_meta("zone",game.adventure.zone)
	actor.set_meta("alive",true)
	actor.set_meta("max_hp",66)
	var box:=StaticBody3D.new()
	actor.add_child(box)
	box.position=Vector3(0,1,0)
	var collision:=CollisionShape3D.new()
	box.add_child(collision)
	var shape:=BoxShape3D.new()
	shape.size=Vector3(1.2,2.2,0.9)
	collision.shape=shape
	var visual:=Node3D.new()
	actor.add_child(visual)
	var joints:={"head":Node3D.new(),"body":Node3D.new()}
	var homes:=[]
	for spec in [["head",Vector3(0,1.65,0),Vector3(0.32,0.30,0.24)],["body",Vector3(0,1.05,0),Vector3(0.40,0.07,0.20)],["body",Vector3(0,1.28,0),Vector3(0.34,0.07,0.20)]]:
		var joint:Node3D=joints[spec[0]]
		if joint.get_parent()==null: visual.add_child(joint)
		var piece:=Node3D.new()
		piece.name="Skull" if spec[0]=="head" else "Rib"
		joint.add_child(piece)
		piece.position=spec[1]
		var mesh:=MeshInstance3D.new()
		piece.add_child(mesh)
		var bone:=BoxMesh.new()
		bone.size=spec[2]
		mesh.mesh=bone
		homes.append({"piece":piece,"parent":joint,"transform":piece.transform})
	var id:=actor.get_instance_id()
	game.animation.actors[id]={"homes":homes,"joints":joints}
	game.scene.enemies.append(actor)
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	var origin:Vector3=actor.global_position
	var gap:=_projectile_contact(origin+Vector3(0.15,1.16,0.6),origin+Vector3(0.15,1.16,-0.6))
	if not gap.is_empty(): failures.append("bolt stopped inside empty skeletal gap")
	var skull:=_projectile_contact(origin+Vector3(0,1.65,0.6),origin+Vector3(0,1.65,-0.6))
	if skull.is_empty() or skull.get("part","")!="head": failures.append("bolt missed visible skull")
	var torso:=_projectile_contact(origin+Vector3(0,1.05,0.6),origin+Vector3(0,1.05,-0.6))
	if torso.is_empty() or torso.get("part","")!="rib": failures.append("bolt missed visible rib")
	if _projectile_damage(actor,95.0,true)<66.0 or _projectile_damage(actor,95.0,false)>=66.0:
		failures.append("skull and body damage no longer differ")
	if not torso.is_empty():
		var bolt:=Node3D.new()
		game.add_child(bolt)
		bolt.global_position=torso.position
		embed(bolt,torso.surface)
		var entry:Dictionary=embedded.back()
		torso.surface.global_position+=Vector3(0.3,0.1,0)
		if (torso.surface.global_transform*entry.local).origin.distance_to(bolt.global_position+Vector3(0.3,0.1,0))>0.001:
			failures.append("embedded bolt lost animated bone attachment")
		embedded.erase(entry)
		bolt.queue_free()
	game.scene.enemies.erase(actor)
	game.animation.actors.erase(id)
	actor.queue_free()

func _knife_contact(bolt,hand,delta):
	var tip=bolt.to_global(bolt.get_meta("tip",Vector3.UP*0.35))
	var previous:Vector3=bolt.get_meta("knife_tip",tip)
	bolt.set_meta("knife_tip",tip)
	if previous.distance_to(tip)<0.012 or previous.distance_to(tip)>0.6 or delta<=0: return
	if game.elapsed<float(bolt.get_meta("knife_next",0.0)): return
	if previous.distance_to(tip)/delta<0.8: return
	var hit=game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(previous,tip,1))
	if hit.is_empty(): return
	var target=game._owner(hit.collider)
	if target==null: return
	var kind=str(target.get_meta("kind",""))
	if kind=="enemy": game.adventure.hurt_enemy(target,24.0,hand)
	elif kind=="dummy": game._dummy_hit(target)
	elif kind=="rat": game._kill_rat(target)
	else: return
	bolt.set_meta("knife_next",game.elapsed+0.4)
	sound("seat",hit.position)
	if hand!=null: game.adventure.haptic(hand,"impact")

func cable_path(draw_y:float)->Array:
	var r=0.024; var z=float(config.travel)/TAU+0.001+r
	var dy=draw_y-0.455; var dz=0.137-z
	var d2=dy*dy+dz*dz; var h=sqrt(d2-r*r)
	var angle=atan2((r*dz+dy*h)/d2,(r*dy-dz*h)/d2)-TAU
	var path=[Vector3(0.14,0.648,float(config.travel)/TAU+0.001)]
	for i in range(17):
		var a=lerpf(-PI/2,angle,float(i)/16)
		path.append(Vector3(0.14,0.455+r*cos(a),z+r*sin(a)))
	path.append(Vector3(0.14,draw_y,0.137))
	return path

func _status(w):
	var message="WIND - %d%%"%roundi(w.draw*100)
	var color=Color("bf9573")
	if w.get("pending",false): message="ONE MOMENT"; color=Color("c1b2ed")
	elif extras.tethered(w): message="GRIP + TURN CRANK TO REEL\nTRIGGER: RELEASE LINE"; color=Color("85d7bd")
	elif w.loaded:
		message="TRIGGER: FIRE HOOK\nTHEN GRIP + TURN CRANK" if w.get("grapple_mode",false) else "READY - SQUEEZE"
		color=Color("85d7bd")
	elif w.draw>=0.999: message="PLACE BOLT"; color=Color("edbf72")
	if w.get("status_text","")==message: return
	w.status_text=message
	w.label.text=message; w.label.modulate=color
	w.status_material.albedo_color=color; w.status_material.emission=color
