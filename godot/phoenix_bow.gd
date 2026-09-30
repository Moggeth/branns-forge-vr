extends Node
## Conventional physical archery plus a gesture-authored, non-homing phoenix arc.
const ID="phoenix_bow"
const TITLE="Emberwing"
const FLIGHT=preload("res://phoenix_flight.gd")
const ART="res://weapons/emberwing/"
const MAX_DRAW=0.68
const MIN_DRAW=0.09
const ARROW_TIP=Vector3(0,0,-0.78)
const HAND_NOCK=Vector3(0,-0.045,-0.10)
const ARROW_CAP=20
const INSTRUCTIONS="Grip: take bow · Free-hand trigger at back quiver or string: take arrow\nHold draw trigger, nock at rest, pull back, release to fire\nWhile nocked, hold bow trigger and move/turn bow to shape a phoenix arc"
var game
var bow:Node3D
var model:Node3D
var rest:Node3D
var guide:Node3D
var top:Node3D
var bottom:Node3D
var strings:Array=[]
var arrow_scene:PackedScene
var wing_scene:PackedScene
var quiver:Node3D
var quiver_grab:Node3D
var carry:Dictionary={}
var input_down:Dictionary={}
var nocked:Dictionary={}
var curve_state:Dictionary={}
var shots:Array=[]
var embedded:Array=[]
var preview:MeshInstance3D
var preview_mesh:ImmediateMesh
var voices:Array=[]
var sound_index=0
var pluck:AudioStreamWAV
var desktop_down=false
var hint:Label3D
var upper:Node3D
var lower:Node3D
var upper_rest=Basis.IDENTITY
var lower_rest=Basis.IDENTITY
var magic_materials:Array=[]

func setup(owner_game):
	game=owner_game
	if not ResourceLoader.exists(ART+"bow.glb"):
		print("EMBERWING awaiting validated artist assets")
		return
	arrow_scene=load(ART+"arrow.glb")
	wing_scene=load(ART+"wings.glb")
	bow=Node3D.new(); bow.name="Emberwing"
	game.add_child(bow)
	for pair in [["id",ID],["display_name",TITLE],["kind","weapon"],["ranged",true],["phoenix_bow",true],["no_secondary_grip",true],["display_height",1.48],["use_instructions",INSTRUCTIONS],["grip_min",-0.08],["grip_max",0.08]]: bow.set_meta(pair[0],pair[1])
	bow.add_to_group("pickup")
	var packed:PackedScene=load(ART+"bow.glb")
	model=packed.instantiate(); bow.add_child(model)
	rest=model.find_child("ArrowRest",true,false)
	guide=model.find_child("ArrowGuide",true,false)
	top=model.find_child("StringTop",true,false)
	bottom=model.find_child("StringBottom",true,false)
	upper=model.find_child("UpperLimb",true,false)
	lower=model.find_child("LowerLimb",true,false)
	if rest==null or top==null or bottom==null or arrow_scene==null or wing_scene==null:
		push_error("EMBERWING art contract incomplete"); bow.queue_free(); bow=null; return
	if upper!=null: upper_rest=upper.basis
	if lower!=null: lower_rest=lower.basis
	_bind_magic_materials()
	# Author axes are already game axes. Never run this bow through the generic
	# transverse haft transform (the source of previous 90-degree weapon errors).
	# The shaft crosses curled fingers on the palm's thumb axis (+/-X), while
	# the shot remains along the visible pointing axis (-Z) in either hand.
	bow.set_meta("grip_preferences",{"left_hand":Transform3D(Basis(Vector3.DOWN,Vector3.RIGHT,Vector3.BACK),Vector3(0,-0.045,-0.035)),"right_hand":Transform3D(Basis(Vector3.UP,Vector3.LEFT,Vector3.BACK),Vector3(0,-0.045,-0.035)),"desktop":Transform3D(Basis.IDENTITY,Vector3(-0.70,0.22,-0.55))})
	game._collider(bow,Vector3(0.14,0.17,0.13),Vector3.ZERO)
	game._collider(bow,Vector3(0.24,0.55,0.17),Vector3(0,0.36,0.01))
	game._collider(bow,Vector3(0.24,0.55,0.17),Vector3(0,-0.36,0.01))
	var thread=WorkshopScene.material("dec8a6",0.15,0.65)
	for i in 2:
		var mesh=CylinderMesh.new(); mesh.top_radius=0.0018; mesh.bottom_radius=0.0018; mesh.radial_segments=6
		var part=MeshInstance3D.new(); part.mesh=mesh; part.material_override=thread; part.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		bow.add_child(part); strings.append(part)
	preview_mesh=ImmediateMesh.new(); preview=MeshInstance3D.new(); preview.mesh=preview_mesh
	var glow=WorkshopScene.material("ffb751",0,0.7,1.5); glow.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	preview.material_override=glow; preview.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	game.add_child(preview)
	hint=WorkshopScene.label(bow,"",Vector3(0,0.19,0.13),17); hint.pixel_size=0.0009
	quiver=Node3D.new(); quiver.name="EmberwingBackQuiver"; game.add_child(quiver)
	var quiver_art:PackedScene=load("res://assets/siegebird/quiver.glb")
	if quiver_art!=null:
		var art=quiver_art.instantiate(); quiver.add_child(art)
		var bolt_tails=art.find_child("BoltFletching",true,false)
		if bolt_tails is MeshInstance3D: bolt_tails.hide()
	quiver_grab=Node3D.new(); quiver.add_child(quiver_grab); quiver_grab.position=Vector3(0,0.42,-0.045)
	for i in 3:
		var arrow=arrow_scene.instantiate(); quiver.add_child(arrow)
		arrow.rotation.x=-PI/2; arrow.scale=Vector3.ONE*0.9; arrow.position=Vector3((i-1)*0.024,0.42,-0.045)
	pluck=_sound()
	for i in 4:
		var voice=AudioStreamPlayer3D.new(); add_child(voice); voice.max_distance=24; voice.stream=pluck; voices.append(voice)
	game.collection.register(bow)
	var stand=game.collection.homes[ID].stand
	for label in stand.find_children("*","Label3D",true,false):
		if label.text=="Grip: take · Trigger: activate invention": label.text="Emberwing · back quiver supplies unlimited arrows\nDraw trigger releases · bow trigger bends the flight"
	print("EMBERWING ready conventional_draw=true gesture_arc=true unlimited_arrows=true")

func _key(hand)->String: return str(hand.get_instance_id())

func owner_hand()->Node3D:
	if not is_instance_valid(bow): return null
	for hand in game.hands+[game.desktop_hand]:
		if game.held.get(_key(hand))==bow: return hand
	return null

func busy(hand)->bool: return carry.has(_key(hand))

func controls_hand(hand)->bool:
	if owner_hand()==hand or busy(hand): return true
	if game.held.has(_key(hand)) or game.firecraft.busy(hand) or game.siegebird.busy(hand) or game.workshop.busy(hand) or game.enchantments.busy(hand) or (game.living!=null and game.living.claims_trigger(hand)): return false
	return owner_hand()!=null and (hand.global_position.distance_to(quiver_grab.global_position)<0.28 or hand.global_position.distance_to(rest.global_position)<0.20)

func equip(hand)->bool:
	if not is_instance_valid(bow): game._notice("Emberwing art is not installed yet."); return false
	if game.held.get(_key(hand))==bow: return true
	if owner_hand()!=null: game._notice("Emberwing is already in another hand."); return false
	game.adventure.release(hand,false)
	if game.held.has(_key(hand)): return false
	game.grips._attach(hand,bow)
	game._notice("Emberwing · draw-hand trigger: arrow / release · bow-hand trigger: bend the shot" if game.vr else "Emberwing · hold LMB to draw, release to fire · hold RMB and turn to bend",8)
	return true

func take_arrow(hand,existing:Node3D=null)->bool:
	if busy(hand) or game.held.has(_key(hand)) or owner_hand()==null or owner_hand()==hand: return false
	var arrow=existing if existing!=null else arrow_scene.instantiate()
	if arrow.get_parent()!=null: arrow.reparent(game.hand_socket(hand))
	else: game.hand_socket(hand).add_child(arrow)
	arrow.transform=Transform3D(Basis.IDENTITY,HAND_NOCK)
	carry[_key(hand)]={"node":arrow,"hand":hand}
	hand.set_meta("archery_arrow",true)
	game.adventure.haptic(hand,"ready")
	return true

func sample_trigger(hand,pressed:bool)->bool:
	var key=_key(hand)
	var previous=bool(input_down.get(key,false)); input_down[key]=pressed
	var claimed=controls_hand(hand)
	if _blocked():
		cancel_draw(); return false
	if hand==owner_hand():
		if pressed and not previous and not nocked.is_empty(): begin_curve()
		elif not pressed and previous: curve_state.clear()
		return true
	if pressed and not previous and claimed and not busy(hand):
		if take_arrow(hand) and hand.global_position.distance_to(rest.global_position)<0.20: try_nock(hand)
	elif not pressed and previous and busy(hand):
		if not nocked.is_empty() and nocked.hand==hand: fire()
		else: _return_arrow(key)
	return claimed

func try_nock(hand)->bool:
	var key=_key(hand)
	if not carry.has(key) or not nocked.is_empty() or owner_hand()==null: return false
	# Deliberately local. A trigger at the back gives you an arrow, never an
	# automatically teleported nock; bring its held nock to the actual rest.
	if game.hand_socket(hand).to_global(HAND_NOCK).distance_to(rest.global_position)>0.19: return false
	nocked=carry[key]; nocked["draw"]=0.0; nocked["desktop"]=false
	game.adventure.haptic(hand,"ready")
	var holder=owner_hand()
	if holder is XRController3D and holder.get_float("trigger")>0.55: begin_curve()
	return true

func begin_curve():
	if nocked.is_empty(): return
	curve_state={"basis":bow.global_basis.orthonormalized(),"origin":bow.global_position,"curve":Vector3.ZERO}
	game.adventure.haptic(owner_hand(),"ready")

func _aim()->Vector3:
	if not nocked.is_empty() and nocked.get("desktop",false):
		var ray=game._ray(game.camera,50)
		var target:Vector3=ray.get("position",game.camera.global_position-game.camera.global_basis.z*50)
		var forward=-game.camera.global_basis.z.normalized()
		var direction=target-rest.global_position
		# A camera ray can hit something between the eye and the displayed bow.
		# Never reverse the arrow towards the player's face in that case.
		return direction.normalized() if direction.dot(forward)>0.08 else forward
	if not nocked.is_empty() and not nocked.get("desktop",false):
		var aim_anchor=guide.global_position if guide!=null else rest.global_position
		var direction=aim_anchor-game.hand_socket(nocked.hand).to_global(HAND_NOCK)
		if direction.length()>0.09 and direction.normalized().dot(-bow.global_basis.z)>0.1: return direction.normalized()
	return -bow.global_basis.z.normalized()

func _nock_position()->Vector3:
	if nocked.is_empty(): return rest.global_position
	if nocked.get("desktop",false): return rest.global_position+bow.global_basis.z*float(nocked.draw)
	# Clamp to human bow length; tracking glitches do not launch super-arrows.
	return rest.global_position+(game.hand_socket(nocked.hand).to_global(HAND_NOCK)-rest.global_position).limit_length(MAX_DRAW)

func _speed(draw:float)->float: return 10.0+48.0*pow(clampf(draw/MAX_DRAW,0,1),0.8)

func fire()->bool:
	if nocked.is_empty(): return false
	var holder=owner_hand()
	if holder==null or _blocked() or (holder is XRController3D and not holder.get_is_active()): cancel_draw(); return false
	var draw=float(nocked.draw)
	if draw<MIN_DRAW: cancel_draw(); return false
	var arrow:Node3D=nocked.node
	var hand=nocked.hand
	var aim=_aim()
	var curve=Vector3.ZERO
	if not curve_state.is_empty(): aim=-curve_state.basis.z; curve=curve_state.curve
	arrow.reparent(game.adventure.zone_groups[game.adventure.zone])
	arrow.global_basis=Basis.looking_at(aim,Vector3.RIGHT if absf(aim.y)>0.98 else Vector3.UP)
	arrow.global_position=_nock_position()
	var wing:Node3D=wing_scene.instantiate(); game.adventure.zone_groups[game.adventure.zone].add_child(wing); wing.visible=false
	var shot={"node":arrow,"wings":wing,"position":arrow.to_global(ARROW_TIP),"velocity":aim*_speed(draw),"curve":curve,"age":0.0,"hand":hand,"zone":game.adventure.zone,"until":game.elapsed+12.0,"damage":30+65*draw/MAX_DRAW}
	shots.append(shot)
	var obstructed=game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(rest.global_position,shot.position,1))
	if not obstructed.is_empty():
		shot.node.global_position=obstructed.position-shot.node.global_basis*ARROW_TIP
		_impact(shot,obstructed)
	carry.erase(_key(hand)); nocked.clear(); curve_state.clear()
	hand.set_meta("archery_arrow",false)
	game.adventure.haptic(owner_hand(),"release")
	if not game.diagnostic_offline and not voices.is_empty():
		var voice=voices[sound_index%voices.size()]; sound_index+=1
		voice.global_position=bow.global_position; voice.volume_db=-14+linear_to_db(maxf(0.001,game.tuning.value("audio.volume"))); voice.pitch_scale=0.88+draw*0.28; voice.play()
	while shots.size()>12: _retire_shot(shots[0])
	print("EMBERWING_SHOT draw=",snappedf(draw,.01)," curve_degrees=",snappedf(rad_to_deg(curve.length()),.1))
	return true

func _return_arrow(key:String):
	if not carry.has(key): return
	if is_instance_valid(carry[key].hand): carry[key].hand.set_meta("archery_arrow",false)
	if is_instance_valid(carry[key].node): carry[key].node.queue_free()
	carry.erase(key)

func cancel_draw():
	if not nocked.is_empty() and nocked.get("desktop",false) and is_instance_valid(nocked.node): nocked.node.queue_free()
	for key in carry.keys(): _return_arrow(key)
	nocked.clear(); curve_state.clear(); desktop_down=false

func desktop_press():
	if owner_hand()!=game.desktop_hand or _blocked() or desktop_down: return
	desktop_down=true
	var arrow=arrow_scene.instantiate(); bow.add_child(arrow)
	nocked={"node":arrow,"hand":game.desktop_hand,"draw":0.0,"desktop":true}

func desktop_update(pressed:bool,bending:bool,delta:float):
	if not desktop_down: return
	if _blocked() or owner_hand()!=game.desktop_hand: cancel_draw(); return
	if not pressed: fire(); desktop_down=false; return
	nocked.draw=minf(MAX_DRAW,float(nocked.draw)+delta*0.82)
	if bending and curve_state.is_empty(): begin_curve()
	elif not bending: curve_state.clear()

func _blocked()->bool:
	return game.qol.opened or (game.discoveries!=null and game.discoveries.opened) or (game.fairy!=null and game.fairy.active and not game.vr) or (is_instance_valid(game.world_builder_view) and game.world_builder_view.has_focus()) or (is_instance_valid(game.director_local_view) and game.director_local_view.has_focus())

func tick(delta:float):
	if not is_instance_valid(bow): return
	var holder=owner_hand()
	if holder==null or _blocked() or (holder is XRController3D and not holder.get_is_active()): cancel_draw()
	if not game.vr: desktop_update(Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT),Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT),delta)
	var facing=game.grips.belt.global_basis
	quiver.global_basis=facing
	quiver.global_position=game.camera.global_position+facing*Vector3(0.24,-0.56,0.20)
	quiver.visible=game.vr and holder!=null
	for entry in carry.values():
		if game.held.has(_key(entry.hand)) or (entry.hand is XRController3D and not entry.hand.get_is_active()): cancel_draw(); break
		if nocked.is_empty(): try_nock(entry.hand)
	if not nocked.is_empty():
		if not nocked.get("desktop",false):
			var draw_position=game.hand_socket(nocked.hand).to_global(HAND_NOCK)
			var separation=rest.global_position.distance_to(draw_position)
			var direction=(rest.global_position-draw_position).normalized()
			if separation>1.05 or (separation>0.19 and direction.dot(-bow.global_basis.z)<0.1): cancel_draw()
			else: nocked.draw=clampf((rest.global_position-draw_position).dot(_aim()),0,MAX_DRAW)
		if not nocked.is_empty():
			var arrow:Node3D=nocked.node
			var direction=_aim()
			arrow.global_position=_nock_position()
			arrow.global_basis=Basis.looking_at(direction,Vector3.RIGHT if absf(direction.dot(bow.global_basis.y))>0.98 else bow.global_basis.y.normalized())
			if not curve_state.is_empty(): curve_state.curve=FLIGHT.gesture(curve_state.basis,curve_state.origin,bow.global_basis,bow.global_position)
	update_draw_visuals()
	var amount=0.0 if nocked.is_empty() else float(nocked.draw)/MAX_DRAW
	hint.visible=holder!=null
	hint.text="PHOENIX ARC · %.0f°"%rad_to_deg(curve_state.curve.length()) if not curve_state.is_empty() else ("DRAW · %.0f%%"%(amount*100) if not nocked.is_empty() else "BACK QUIVER / STRING · DRAW TRIGGER")
	_draw_preview()
	_tick_shots(delta)
	for entry in embedded.duplicate():
		if not is_instance_valid(entry.node) or game.elapsed>entry.until:
			if is_instance_valid(entry.node): entry.node.queue_free()
			embedded.erase(entry)

func _bind_magic_materials():
	# Copy only emissive materials, once per shared source. The bow's small
	# inlays brighten without modifying other imported instances or adding lights.
	var copies:Dictionary={}
	for mesh in model.find_children("*","MeshInstance3D",true,false):
		for surface in mesh.mesh.get_surface_count():
			var original=mesh.get_active_material(surface)
			if not original is StandardMaterial3D or not original.emission_enabled: continue
			var key=original.get_instance_id()
			if not copies.has(key):
				var material=original.duplicate()
				copies[key]=material
				magic_materials.append({"material":material,"base":material.emission_energy_multiplier,"eye":"eye" in original.resource_name.to_lower()})
			mesh.set_surface_override_material(surface,copies[key])

func update_draw_visuals():
	var amount=0.0 if nocked.is_empty() else clampf(float(nocked.draw)/MAX_DRAW,0,1)
	if upper!=null: upper.basis=upper_rest*Basis(Vector3.RIGHT,amount*0.09)
	if lower!=null: lower.basis=lower_rest*Basis(Vector3.RIGHT,-amount*0.09)
	# Nock sockets are parented to their authored limbs. Their complete world
	# transforms include the actual root pivot, avoiding a floating string end.
	var nock=_nock_position()
	_segment(strings[0],top.global_position,nock)
	_segment(strings[1],bottom.global_position,nock)
	var bending=not curve_state.is_empty()
	for entry in magic_materials:
		var multiplier=(1.0+0.25*amount+(0.85 if bending else 0.0)) if entry.eye else (1.0+0.45*amount+(0.40 if bending else 0.0))
		entry.material.emission_energy_multiplier=entry.base*multiplier

func _segment(node:Node3D,a:Vector3,b:Vector3):
	var direction=b-a
	node.global_position=(a+b)*0.5
	node.global_basis=Basis(Quaternion(Vector3.UP,direction.normalized()))
	node.scale=Vector3(1,direction.length()/2.0,1)

func _draw_preview():
	preview_mesh.clear_surfaces(); preview.visible=not curve_state.is_empty() and not nocked.is_empty()
	if not preview.visible: return
	var direction=-curve_state.basis.z
	var position=_nock_position()+direction*0.78
	var velocity=direction*_speed(float(nocked.draw))
	var age=0.0
	preview_mesh.surface_begin(Mesh.PRIMITIVE_LINES)
	for i in 26:
		var next=FLIGHT.step(position,velocity,curve_state.curve,age,1.0/45.0)
		preview_mesh.surface_add_vertex(position); preview_mesh.surface_add_vertex(next.position)
		position=next.position; velocity=next.velocity; age=next.age
	preview_mesh.surface_end()

func _tick_shots(delta:float):
	for shot in shots.duplicate():
		if not is_instance_valid(shot.node) or shot.zone!=game.adventure.zone or game.elapsed>shot.until: _retire_shot(shot); continue
		# Fixed bounded substeps keep the arc and swept contact stable at low fps.
		var steps=mini(24,maxi(1,ceili(delta*180)))
		for i in steps:
			var dt=delta/steps
			var next=FLIGHT.step(shot.position,shot.velocity,shot.curve,shot.age,dt)
			var query=PhysicsRayQueryParameters3D.create(shot.position,next.position,1)
			var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
			shot.velocity=next.velocity; shot.age=next.age
			shot.position=next.position if hit.is_empty() else hit.position
			var direction:Vector3=shot.velocity.normalized()
			shot.node.global_basis=Basis.looking_at(direction,Vector3.RIGHT if absf(direction.y)>0.98 else Vector3.UP)
			shot.node.global_position=shot.position-shot.node.global_basis*ARROW_TIP
			if not hit.is_empty():
				_impact(shot,hit); break
		if shots.has(shot):
			var active=shot.curve.length()>0.03 and shot.age<FLIGHT.CURVE_SECONDS
			shot.wings.visible=active
			if active:
				shot.wings.global_position=shot.node.to_global(Vector3(0,0,-0.36))
				shot.wings.global_basis=FLIGHT.wing_basis(shot.velocity,shot.curve,shot.age)
				var fade=sin(PI*clampf(shot.age/FLIGHT.CURVE_SECONDS,0,1))
				shot.wings.scale=Vector3.ONE*maxf(0.002,fade*1.1)

func _impact(shot:Dictionary,hit:Dictionary):
	var target=game._owner(hit.collider)
	if target!=null:
		match str(target.get_meta("kind","")):
			"enemy":
				var head=str(target.get_meta("enemy_type",""))=="skeleton" and hit.position.distance_to(game.enchantments._head_position(target))<0.28
				game.adventure.hurt_enemy(target,float(shot.damage)*(1.8 if head else 1.0),shot.hand,shot.velocity.normalized(),"headshot" if head else "projectile",hit.position)
			"rat": game._kill_rat(target)
			"dummy": game._dummy_hit(target)
			"apple": game.apples.impact(target,shot.velocity.length(),hit.position,shot.velocity)
			"pumpkin":
				var point=Node3D.new(); point.set_meta("pointed",true)
				game.pumpkins.impact(target,point,hit.position,hit.normal,shot.velocity); point.free()
	shot.node.global_position+=shot.velocity.normalized()*0.035
	if is_instance_valid(hit.collider) and hit.collider is Node3D: shot.node.reparent(hit.collider)
	embedded.append({"node":shot.node,"until":game.elapsed+150})
	while embedded.size()>ARROW_CAP:
		var old=embedded.pop_front()
		if is_instance_valid(old.node): old.node.queue_free()
	shot.wings.queue_free(); shots.erase(shot)

func _retire_shot(shot:Dictionary):
	if is_instance_valid(shot.node): shot.node.queue_free()
	if is_instance_valid(shot.wings): shot.wings.queue_free()
	shots.erase(shot)

func _sound()->AudioStreamWAV:
	var bytes=PackedByteArray(); bytes.resize(11024)
	for i in 5512:
		var t=float(i)/22050.0
		var wave=(sin(TAU*174*t)+0.4*sin(TAU*347*t)+0.16*sin(TAU*701*t))*exp(-t*26)
		bytes.encode_s16(i*2,int(wave*11000))
	var audio=AudioStreamWAV.new(); audio.format=AudioStreamWAV.FORMAT_16_BITS; audio.mix_rate=22050; audio.data=bytes
	return audio
