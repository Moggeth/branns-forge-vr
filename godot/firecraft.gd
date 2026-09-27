extends Node
## Emberdew: explicit fire damage, physical supplies, and bounded effects.
var game
var props=[]
var ghosts=[]
var pools=[]
var slider={}
var box:Node3D
var tray:Node3D
var dock:Node3D
var stand:Node3D
var opening=0.0
var target_open=0.0
var refill_at=0.0
var reload_at=0.0
var sounds={}
var voices=[]
var fluid
var cfg={"spill_burn_seconds":8.0,"spill_unlit_lifetime_scale":1.5,"match_seconds":10.0,"wick_seconds":10.0,"blowout_speed":1.8,"blowout_dwell":0.15,"light_dwell":0.3,"gentle_speed":0.55,"fire_seconds":8.0,"fire_radius":2.7,"fear_radius":6.0,"ghost_speed":0.65}

func setup(g):
	game=g
	if not game.diagnostic_offline or OS.get_cmdline_user_args().has("--playful-demo") or OS.get_cmdline_user_args().has("--experimental-fuel-combat") or OS.get_cmdline_user_args().has("--fuel-combat-check"):
		fluid=preload("res://fuel_combat.gd").new(); add_child(fluid); fluid.setup(game)
	_make_sounds()
	# Keep the common-goods bench in the east porch, behind the collection walk.
	# Its old z=3.5 position crowded the first row of invention displays.
	stand=Node3D.new(); game.adventure.zone_groups.forge_yard.add_child(stand); stand.position=Vector3(4.8,0,1.35)
	WorldZones.box(stand,Vector3(0,0.86,0),Vector3(1.7,0.12,0.7),"795232")
	WorldZones.body(stand,Vector3(0,0.86,0),Vector3(1.7,0.12,0.7))
	for x in [-0.7,0.7]: WorldZones.box(stand,Vector3(x,0.4,0),Vector3(0.13,0.8,0.5),"45352b")
	WorldZones.box(stand,Vector3(0,1.49,-0.035),Vector3(1.82,0.6,0.05),"34443c")
	WorldZones.label(stand,"EMBERDEW",Vector3(0,1.64,0),21)
	var instructions="Strike match · light wick\nThrow vial · fire defeats ghosts"
	if fluid!=null: instructions="Light wick · throw vial\nUnlit spills catch fire"
	WorldZones.label(stand,instructions,Vector3(0,1.36,0),12)
	WorldZones.label(stand,"Free refills · matchbox at left hip",Vector3(0,0.66,0.37),11)
	dock=Node3D.new(); game.grips.belt.add_child(dock); dock.position=Vector3(-0.32,0,0.1)
	WorldZones.box(dock,Vector3.ZERO,Vector3(0.16,0.08,0.22),"885a35")
	box=_prop("box",stand.global_position+Vector3(-0.48,1,0))
	_refill()
	for zone_id in ["pinewood_ruins","crystal_hollow"]:
		if not game.scene.zones.has(zone_id): continue
		var center:Vector3=game.scene.zones[zone_id].center
		for offset in [Vector3(-3,0,-2),Vector3(3,0,-4)]: _ghost(zone_id,center+offset)
	print("FIRECRAFT ready: ",ghosts.size()," ghosts; common goods at forge; tuning=res://firecraft.json")

func _prop(kind,pos):
	var n=Node3D.new(); game.adventure.zone_groups[game.adventure.zone].add_child(n); n.global_position=pos
	n.set_meta("fire_kind",kind); n.set_meta("kind","fire_supply"); n.set_meta("zone",game.adventure.zone)
	n.set_meta("state","fresh"); n.set_meta("born",game.elapsed); n.set_meta("previous",pos)
	if kind=="box":
		WorldZones.box(n,Vector3.ZERO,Vector3(0.16,0.055,0.22),"aa5835")
		WorldZones.box(n,Vector3(0,0.03,0),Vector3(0.13,0.004,0.17),"efc57f")
		WorldZones.box(n,Vector3(0,0.035,0),Vector3(0.026,0.004,0.08),"b95728")
		for x in [-0.082,0.082]:
			WorldZones.box(n,Vector3(x,0,0),Vector3(0.008,0.038,0.18),"3e3438")
			for z in range(8): WorldZones.box(n,Vector3(x*1.02,0,-0.075+z*0.021),Vector3(0.008,0.039,0.003),"b28661")
		tray=Node3D.new(); n.add_child(tray)
		WorldZones.box(tray,Vector3(0,-0.02,0),Vector3(0.145,0.012,0.2),"cfa96a")
		WorldZones.box(tray,Vector3(0,0,0.105),Vector3(0.15,0.055,0.012),"d6ac74")
		for x in range(6):
			WorldZones.box(tray,Vector3(-0.052+x*0.021,-0.008,0),Vector3(0.008,0.008,0.14),"f7d5a1")
			WorldZones.rock(tray,Vector3(-0.052+x*0.021,-0.005,0.066),Vector3(0.012,0.012,0.016),"d85137")
	elif kind=="match":
		WorldZones.box(n,Vector3(0,0.055,0),Vector3(0.009,0.11,0.009),"e6c690")
		WorldZones.rock(n,Vector3(0,0.115,0),Vector3(0.015,0.022,0.015),"ca4a31")
	else:
		var glass=WorldZones.cyl(n,Vector3(0,0.075,0),0.048,0.15,"bce9dd")
		var mat=glass.material_override.duplicate(); mat.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA; mat.albedo_color=Color(0.65,0.88,0.82,0.24); mat.cull_mode=BaseMaterial3D.CULL_DISABLED; glass.material_override=mat
		WorldZones.cyl(n,Vector3(0,0.055,0),0.039,0.1,"df8532", "cylinder",0.15)
		WorldZones.cyl(n,Vector3(0,0.155,0),0.026,0.035,"9a693f")
		WorldZones.cyl(n,Vector3(0,0.19,0),0.007,0.045,"f1d7a9")
		WorldZones.box(n,Vector3(0,0.075,0.049),Vector3(0.055,0.055,0.003),"f3d697")
	var area=Area3D.new(); n.add_child(area); area.collision_layer=1; area.collision_mask=0
	var shape=CollisionShape3D.new(); var geom=BoxShape3D.new(); geom.size=Vector3(0.16,0.07,0.22) if kind=="box" else Vector3(0.07,0.19,0.07); shape.shape=geom; shape.position.y=0 if kind=="box" else 0.08; area.add_child(shape)
	props.append(n); return n

func _tip(n)->Vector3: return n.to_global(Vector3(0,0.115 if n.get_meta("fire_kind")=="match" else 0.215,0))
func _held(hand): return game.held.get(str(hand.get_instance_id()))
func busy(hand)->bool: return slider.get("hand")==hand or (is_instance_valid(_held(hand)) and _held(hand).has_meta("fire_kind"))
func _attach(hand,n):
	if n.has_meta("body"):
		var body=n.get_meta("body"); n.reparent(game); n.remove_meta("body"); body.queue_free()
	n.reparent(game.hand_socket(hand)); n.transform=Transform3D.IDENTITY
	if n.get_meta("fire_kind")!="box":
		var side=1.0 if hand is XRController3D and str(hand.tracker).begins_with("left") else -1.0
		n.basis=Basis(Vector3.FORWARD,Vector3.RIGHT*side,Vector3.DOWN*side)
	n.position=Vector3(0,-0.025,-0.04); game.held[str(hand.get_instance_id())]=n
	n.set_meta("previous",n.global_position); n.set_meta("zone",game.adventure.zone)
	game.adventure.haptic(hand,"ready")

func try_grab(hand,desktop=false)->bool:
	var pos:Vector3=hand.global_position
	if box.is_visible_in_tree():
		if opening>0.65 and pos.distance_to(tray.to_global(Vector3(0,0.02,0.05)))<0.085:
			if props.filter(func(n):return is_instance_valid(n) and n.get_meta("fire_kind")=="match").size()>=12:
				game._notice("Use or drop the matches you already have."); return true
			_attach(hand,_prop("match",pos)); game._notice("Strike a dark side panel, then move gently.",4); return true
		if pos.distance_to(tray.to_global(Vector3(0,0,0.12)))<0.08:
			slider={"hand":hand,"start":box.to_local(pos).z,"open":opening}; return true
	var best=null; var reach=0.14
	if desktop:
		var hit=game._ray(game.camera,3)
		if hit.has("collider"):
			var owner=game._owner(hit.collider)
			if owner in props: best=owner
	for n in props:
		if not is_instance_valid(n) or not n.is_visible_in_tree() or n in game.held.values(): continue
		var d=pos.distance_to(n.global_position)
		if d<reach: best=n; reach=d
	if best==null: return false
	_attach(hand,best)
	game._notice("Matchbox: pull end tray or tap trigger. Stow at left hip." if best==box else "Touch a lit match gently to the wick. Then throw.",5)
	return true

func trigger(hand)->bool:
	var n=_held(hand)
	if not is_instance_valid(n) or not n.has_meta("fire_kind"): return false
	if n==box: target_open=0.0 if opening>0.5 else 1.0
	else: game._notice("Strike the match on the box side. Hold its flame gently against a vial wick.",4)
	return true

func release(hand)->bool:
	if slider.get("hand")==hand: slider.clear(); return true
	var n=_held(hand)
	if not is_instance_valid(n) or not n.has_meta("fire_kind"): return false
	game.held.erase(str(hand.get_instance_id()))
	if n==box and hand.global_position.distance_to(dock.global_position)<0.3:
		n.reparent(dock); n.transform=Transform3D.IDENTITY; return true
	var velocity:Vector3=n.get_meta("velocity",Vector3.ZERO)
	if hand==game.desktop_hand and n.get_meta("fire_kind")=="vial": velocity=-game.camera.global_basis.z*8+Vector3.UP*1.2
	var root=game.adventure.zone_groups[game.adventure.zone]
	var body=RigidBody3D.new(); root.add_child(body); body.global_transform=n.global_transform; n.reparent(body)
	body.mass=0.15; body.collision_layer=8; body.collision_mask=9; body.continuous_cd=true
	# A single hull supports the whole matchbox, including its extended tray.
	# Two overlapping colliders used to fight over a tabletop contact point and
	# occasionally kept the lightweight box awake and visibly juddering.
	var shape=CollisionShape3D.new(); var geom=BoxShape3D.new()
	geom.size=Vector3(0.16,0.06,0.22+opening*0.16) if n==box else Vector3(0.06,0.16,0.06)
	geom.margin=.002; shape.shape=geom
	shape.position=Vector3(0,0,opening*0.08) if n==box else Vector3(0,0.07,0)
	body.add_child(shape)
	if n==box:
		target_open=opening # Finish drawer travel before dropping; keep its hull fixed.
		body.linear_damp=1.2; body.angular_damp=5.0
		var material=PhysicsMaterial.new(); material.friction=.85; material.bounce=0; body.physics_material_override=material
	body.linear_velocity=velocity.limit_length(14); n.set_meta("body",body); n.set_meta("impact_speed",velocity.length())
	if n.get_meta("fire_kind")=="vial":
		body.contact_monitor=true; body.max_contacts_reported=4; body.body_entered.connect(func(_other): _impact.call_deferred(n))
	return true

func _impact(n):
	if not is_instance_valid(n) or n.get_meta("shattered",false) or float(n.get_meta("impact_speed",0))<1.1: return
	n.set_meta("shattered",true)
	var pos=n.global_position
	_sound("glass",pos)
	_splash(pos,_burning(n))
	if fluid!=null: fluid.impact(pos,str(n.get_meta("zone")),_burning(n))
	elif _burning(n): _pool(pos,str(n.get_meta("zone")))
	else: game._effect(pos,Color("d7934b"),0.45,0.5)
	game._effect(pos,Color("d2f5ef"),0.25,0.6)
	_remove(n)

func _remove(n):
	props.erase(n)
	for key in game.held.keys():
		if game.held[key]==n: game.held.erase(key)
	if n.has_meta("body"): n.get_meta("body").queue_free()
	else: n.queue_free()

func _flame(parent,pos,size):
	var root=Node3D.new(); parent.add_child(root); root.position=pos
	WorldZones.cyl(root,Vector3(0,size*0.5,0),size*0.27,size,"ff772e","cone",2.0)
	WorldZones.cyl(root,Vector3(0,size*0.25,0.002),size*0.14,size*0.5,"ffe59c","cone",2.0)
	return root

func _light(n):
	if n.get_meta("state")!="fresh": return
	n.set_meta("state","lit"); n.set_meta("lit_at",game.elapsed)
	_sound("strike",n.global_position)
	var is_match=n.get_meta("fire_kind")=="match"
	var label=Label3D.new(); n.add_child(label); label.position=Vector3(0,0.29,0); label.font_size=22; label.pixel_size=0.001; label.billboard=BaseMaterial3D.BILLBOARD_ENABLED; label.modulate=Color("ffde9d"); n.set_meta("timer_label",label)
	n.set_meta("until",game.elapsed+cfg.match_seconds if is_match else game.elapsed+cfg.wick_seconds)
	n.set_meta("flame",_flame(n,Vector3(0,0.12 if is_match else 0.22,0),0.055 if is_match else 0.11))
	var light=OmniLight3D.new(); n.add_child(light); light.light_color=Color("ffbc65"); light.omni_range=1.4; light.light_energy=0.5; light.position.y=0.15; n.set_meta("light",light)
	for hand in game.hands:
		if _held(hand)==n: game.adventure.haptic(hand,"ready")
	print("FIRECRAFT lit ",n.get_meta("fire_kind"))

func _extinguish(n):
	n.set_meta("state","spent")
	if n.has_meta("timer_label"): n.get_meta("timer_label").text="Spent"
	if n.has_meta("flame"): n.get_meta("flame").queue_free(); n.remove_meta("flame")
	if n.has_meta("light"): n.get_meta("light").queue_free(); n.remove_meta("light")
	game._notice("Match spent." if n.get_meta("fire_kind")=="match" else "Wick burned out — this vial is no longer armed.",2)

func _refill():
	if game.adventure.zone!="forge_yard": return
	var count=props.filter(func(n):return is_instance_valid(n) and n.get_meta("fire_kind")=="vial").size()
	for x in [0.16,0.5]:
		var pos=stand.global_position+Vector3(x,0.93,0)
		if count>=6: break
		if props.any(func(n):return is_instance_valid(n) and n.global_position.distance_to(pos)<0.15): continue
		_prop("vial",pos); count+=1

func tick(delta):
	if game.elapsed>reload_at:
		reload_at=game.elapsed+3
		if FileAccess.file_exists("res://firecraft.json"):
			var parsed=JSON.parse_string(FileAccess.get_file_as_string("res://firecraft.json"))
			if parsed is Dictionary:
				for key in cfg:
					if parsed.get(key) is float or parsed.get(key) is int: cfg[key]=clampf(float(parsed[key]),1,1800) if key.begins_with("spill_") else clampf(float(parsed[key]),0.05,120 if key=="fire_seconds" else 30)
	if game.elapsed>refill_at: refill_at=game.elapsed+3; _refill()
	if not slider.is_empty(): target_open=clampf(float(slider.open)+(box.to_local(slider.hand.global_position).z-float(slider.start))/0.16,0,1)
	opening=move_toward(opening,target_open,delta*4); tray.position.z=opening*0.16
	var flames=[]
	for n in props.duplicate():
		if not is_instance_valid(n): props.erase(n); continue
		if n.has_meta("body"): n.get_meta("body").freeze=not n.is_visible_in_tree()
		if not n.is_visible_in_tree(): continue
		if n in game.held.values() or n.get_parent()==dock:
			if str(n.get_meta("zone"))!=game.adventure.zone: n.set_meta("previous",n.global_position)
			n.set_meta("zone",game.adventure.zone)
		var velocity:Vector3=(n.global_position-n.get_meta("previous",n.global_position))/maxf(delta,0.001)
		n.set_meta("previous",n.global_position); n.set_meta("velocity",velocity)
		if n in game.held.values(): n.set_meta("zone",game.adventure.zone)
		if n.has_meta("body"): n.set_meta("impact_speed",maxf(float(n.get_meta("impact_speed",0))*0.85,maxf(velocity.length(),n.get_meta("body").linear_velocity.length())))
		var kind=n.get_meta("fire_kind"); var state=n.get_meta("state")
		if kind=="match" and state=="fresh" and box.is_visible_in_tree() and not n.get_meta("fairy_strike_owned",false):
			var p:Vector3=box.to_local(_tip(n)); var old:Vector3=n.get_meta("strike_point",p)
			if _can_strike(p,old,delta): _light(n)
			n.set_meta("strike_point",p)
		if n.get_meta("state")=="lit":
			if game.elapsed>=float(n.get_meta("until")): _extinguish(n); continue
			if kind=="match":
				var fast=velocity.length()>cfg.blowout_speed and game.elapsed-float(n.get_meta("lit_at"))>0.35
				var gust=float(n.get_meta("gust",0))+delta if fast else 0.0; n.set_meta("gust",gust)
				if gust>cfg.blowout_dwell: _extinguish(n); continue
			if n.has_meta("timer_label"): n.get_meta("timer_label").text=str(ceili(float(n.get_meta("until"))-game.elapsed))+"s"
			flames.append(_tip(n))
			if n.has_meta("flame"): n.get_meta("flame").scale=Vector3.ONE*(0.86+0.14*sin(game.elapsed*18))
		if kind=="vial" and state=="fresh":
			var gentle=props.any(func(m):return is_instance_valid(m) and m.get_meta("fire_kind")=="match" and _burning(m) and m.is_visible_in_tree() and _can_light(_tip(m).distance_to(_tip(n)),Vector3(m.get_meta("velocity",Vector3.ZERO)).length()))
			var dwell=float(n.get_meta("dwell",0))+delta if gentle else 0.0; n.set_meta("dwell",dwell)
			if dwell>=cfg.light_dwell: _light(n)
		if n!=box and (n.global_position.y< -12 or (n not in game.held.values() and ((state=="spent" and game.elapsed-float(n.get_meta("born"))>35) or (kind=="match" and game.elapsed-float(n.get_meta("born"))>60)))): _remove(n)
		elif n==box and n.global_position.y< -12:
			if n.has_meta("body"): var body=n.get_meta("body"); n.reparent(dock); n.remove_meta("body"); body.queue_free()
			n.transform=Transform3D.IDENTITY
	for pool in pools.duplicate():
		if game.elapsed>pool.until: pool.node.queue_free(); pools.erase(pool); continue
		if pool.zone!=game.adventure.zone: continue
		flames.append(pool.node.global_position)
		for child in pool.flames:
			child.scale=Vector3(1,0.85+0.3*sin(game.elapsed*9+child.position.x*8),1)
			child.rotation.z=0.13*sin(game.elapsed*7+child.position.z*4)
		for ghost in ghosts:
			if ghost.get_meta("alive",false) and ghost.is_visible_in_tree() and ghost.global_position.distance_to(pool.node.global_position)<cfg.fire_radius: hurt_ghost(ghost,120*delta,"fire")
		if game.camera.global_position.distance_to(pool.node.global_position)<1.7 and game.elapsed>pool.hurt_at:
			pool.hurt_at=game.elapsed+1.2; game.adventure.take_damage(5,"Emberdew fire")
	if fluid!=null:
		fluid.tick(delta)
		flames.append_array(fluid.fear_sources)
	if game.wyrmspout!=null: flames.append_array(game.wyrmspout.flame_sources())
	if game.get("hearth_torch")!=null and game.hearth_torch.lit and game.hearth_torch.torch.is_visible_in_tree(): flames.append(game.hearth_torch.tip_position())
	_tick_ghosts(delta,flames)

func _pool(pos,zone_id):
	_sound("fire",pos)
	while pools.size()>=4: var old=pools.pop_front(); old.node.queue_free()
	var root=Node3D.new(); game.adventure.zone_groups[zone_id].add_child(root); root.global_position=pos
	var ground=game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(pos+Vector3.UP*0.1,pos+Vector3.DOWN*4,1))
	if ground.has("position"): root.global_position=ground.position+Vector3.UP*0.03
	var flames=[]
	for i in range(18):
		var angle=i*2.39996; var radius=sqrt(float(i)/18)*cfg.fire_radius*0.8
		var spot=Vector3(cos(angle)*radius,0,sin(angle)*radius)
		WorldZones.cyl(root,spot,0.32,0.015,"db6127","cylinder",0.6)
		flames.append(_flame(root,spot,0.3+0.3*absf(sin(i*7))))
	var light=OmniLight3D.new(); root.add_child(light); light.position.y=0.7; light.light_color=Color("ff9d48"); light.light_energy=2; light.omni_range=7
	pools.append({"node":root,"zone":zone_id,"until":game.elapsed+cfg.fire_seconds,"flames":flames,"hurt_at":0.0})
	game.bomb_art.explosion(pos,2.7,1.0,0.85,24)
	print("FIRECRAFT vial shattered lit; active pools=",pools.size())

func _ghost(zone_id,pos):
	var g=Node3D.new(); game.adventure.zone_groups[zone_id].add_child(g); g.global_position=pos
	g.set_meta("kind","enemy"); g.set_meta("enemy_type","ghost"); g.set_meta("zone",zone_id); g.set_meta("id","ghost-"+str(g.get_instance_id())); g.set_meta("alive",true); g.set_meta("hp",36.0); g.set_meta("home",pos); g.set_meta("attack_at",0.0)
	var art=Node3D.new(); g.add_child(art); g.set_meta("art",art)
	var mesh=SurfaceTool.new(); mesh.begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in range(16):
		var a=i*TAU/16; var b=(i+1)*TAU/16
		var p=Vector3(cos(a)*0.4,0.35+(0.1 if i%2==0 else 0),sin(a)*0.4)
		var q=Vector3(cos(b)*0.4,0.35+(0.1 if (i+1)%2==0 else 0),sin(b)*0.4)
		var t=Vector3(cos(a)*0.29,1.08,sin(a)*0.29); var u=Vector3(cos(b)*0.29,1.08,sin(b)*0.29)
		for v in [p,t,u,p,u,q,t,Vector3(0,1.35,0),u]: mesh.add_vertex(v)
	mesh.generate_normals()
	var visual=MeshInstance3D.new(); art.add_child(visual); visual.mesh=mesh.commit()
	var mat=WorldZones.mat("bbe4dd",0.35).duplicate(); mat.cull_mode=BaseMaterial3D.CULL_DISABLED; mat.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA; mat.albedo_color.a=0.8; visual.material_override=mat
	for x in [-0.105,0.105]: WorldZones.rock(art,Vector3(x,1.02,0.275),Vector3(0.075,0.13,0.045),"23314a")
	WorldZones.rock(art,Vector3(0,0.84,0.32),Vector3(0.08,0.1,0.035),"23314a")
	for x in [-0.48,0.48]: WorldZones.rock(art,Vector3(x,0.7,0),Vector3(0.14,0.23,0.16),"bbe4dd")
	var area=Area3D.new(); g.add_child(area); area.collision_layer=1; area.collision_mask=0
	var shape=CollisionShape3D.new(); var capsule=CapsuleShape3D.new(); capsule.radius=0.4; capsule.height=1.35; shape.shape=capsule; shape.position.y=0.7; area.add_child(shape)
	ghosts.append(g); game.scene.enemies.append(g); return g

func hurt_ghost(g,damage,damage_type):
	if not g.get_meta("alive",false): return
	if damage_type!="fire":
		if game.elapsed>float(g.get_meta("hint_at",0)):
			g.set_meta("hint_at",game.elapsed+4); game._notice("The ghost is untouchable. Only FIRE can destroy it.",3)
		return
	g.set_meta("hp",float(g.get_meta("hp"))-damage)
	if float(g.get_meta("hp"))>0: return
	g.set_meta("alive",false); game._set_collisions(g,false)
	if game.quests!=null: game.quests.enemy_defeated(g,"ghost")
	game._effect(g.global_position+Vector3.UP*0.8,Color("ffe3a0"),0.65,1.2)
	var tween=create_tween(); tween.tween_property(g,"scale",Vector3(0.05,1.8,0.05),0.45); tween.tween_callback(g.hide)
	print("FIRECRAFT ghost defeated by fire")

func _tick_ghosts(delta,flames):
	for g in ghosts:
		if not g.get_meta("alive",false) or not g.is_visible_in_tree(): continue
		var art=g.get_meta("art"); art.position.y=0.18+sin(game.elapsed*2+g.get_instance_id()%10)*0.09
		var fairy_target=game.get("fairy")!=null and game.fairy.attracts(g)
		var player:Vector3=game.fairy.avatar.global_position if fairy_target else game.camera.global_position
		if not fairy_target: player.y=g.global_position.y
		var nearest=Vector3.INF; var distance=cfg.fear_radius
		for flame in flames:
			var d=g.global_position.distance_to(flame)
			if d<distance: nearest=flame; distance=d
			if (g.global_position+Vector3.UP*0.8).distance_to(flame)<0.6: hurt_ghost(g,70*delta,"fire")
		var direction=Vector3.ZERO
		if nearest!=Vector3.INF:
			direction=g.global_position-nearest; g.set_meta("attack_at",game.elapsed+2)
		elif player.distance_to(g.global_position)<9: direction=player-g.global_position
		else: direction=Vector3(g.get_meta("home"))-g.global_position
		if not fairy_target or nearest!=Vector3.INF: direction.y=0
		if direction.length()>0.3: g.global_position+=direction.normalized()*cfg.ghost_speed*delta
		var facing=Vector3(player.x,g.global_position.y,player.z)
		if facing.distance_to(g.global_position)>0.01: g.look_at(facing,Vector3.UP,true)
		if nearest==Vector3.INF and player.distance_to(g.global_position)<1.1 and game.elapsed>float(g.get_meta("attack_at")):
			g.set_meta("attack_at",game.elapsed+2.5)
			if fairy_target: game.fairy.hurt(8,"Ghost chill")
			else: game.adventure.take_damage(8,"Ghost chill")

func showcase():
	game.rig.position=Vector3.ZERO; game.camera.global_position=stand.global_position+Vector3(1.9,1.8,2.7); game.camera.look_at(stand.global_position+Vector3(0,1,0))
	target_open=1; opening=1; tray.position.z=0.16; _light(props.filter(func(n):return n.get_meta("fire_kind")=="vial")[0])

func _burning(n)->bool:
	return n.get_meta("state")=="lit" and game.elapsed<float(n.get_meta("until",0))

func _can_strike(p:Vector3,old:Vector3,delta:float)->bool:
	return absf(absf(p.x)-0.085)<0.027 and absf(p.y)<0.045 and absf(p.z)<0.11 and absf(p.z-old.z)>0.002 and absf(p.z-old.z)/maxf(delta,0.001)>0.15

func _can_light(distance:float,speed:float)->bool:
	return distance<0.065 and speed<cfg.gentle_speed

func show_ghosts():
	game.adventure.travel("pinewood_ruins")
	var g=ghosts[0]; var p=g.global_position
	_pool(p+Vector3(3.4,0,0),"pinewood_ruins")
	game.rig.position=Vector3.ZERO; game.camera.global_position=p+Vector3(2,1.6,4.5); game.camera.look_at(p+Vector3(0.8,0.6,0))

func run_checks():
	var failures=[]
	if not _can_strike(Vector3(0.085,0,0.03),Vector3(0.085,0,0),0.02): failures.append("valid striker stroke")
	if _can_strike(Vector3(0,0.08,0.03),Vector3.ZERO,0.02) or _can_strike(Vector3(0.085,0,0),Vector3(0.085,0,0),0.02): failures.append("false striker ignition")
	if not _can_light(0.03,0.1) or _can_light(0.03,2) or _can_light(0.3,0.1): failures.append("gentle wick contact")
	var g=ghosts[0]; var hp=g.get_meta("hp")
	for kind in ["physical","blast","crystal"]: game.adventure.hurt_enemy(g,1000,null,Vector3.ZERO,kind)
	if g.get_meta("hp")!=hp or not g.get_meta("alive"): failures.append("non-fire immunity")
	game.adventure.hurt_enemy(g,1,null,Vector3.ZERO,"fire")
	if g.get_meta("hp")!=hp-1: failures.append("fire damage routing")
	var m=_prop("match",Vector3(0,2,0)); _light(m)
	if absf(float(m.get_meta("until"))-game.elapsed-10)>0.01: failures.append("match 10 seconds")
	_extinguish(m); _light(m)
	if m.get_meta("state")!="spent": failures.append("spent match relit")
	var v=_prop("vial",Vector3(0,2,0)); _light(v)
	if absf(float(v.get_meta("until"))-game.elapsed-10)>0.01: failures.append("wick 10 seconds")
	v.set_meta("impact_speed",3); _impact(v)
	if pools.size()!=1: failures.append("lit impact pool")
	var cold=_prop("vial",Vector3(0,2,0)); cold.set_meta("impact_speed",3); _impact(cold)
	if pools.size()!=1: failures.append("cold impact fire")
	for i in range(5): _pool(Vector3(0,0,0),"forge_yard")
	if pools.size()!=4: failures.append("pool bound")
	var fast=_prop("match",Vector3(0,2,0)); _light(fast); fast.set_meta("lit_at",game.elapsed-1); fast.set_meta("gust",cfg.blowout_dwell); fast.set_meta("previous",fast.global_position-Vector3.RIGHT)
	tick(0.02)
	if fast.get_meta("state")!="spent": failures.append("fast motion extinguishing")
	var expired=_prop("vial",Vector3(0,2,0)); _light(expired); expired.set_meta("until",game.elapsed-0.1); tick(0.02)
	if expired.get_meta("state")!="spent": failures.append("wick timeout")
	var physical=_prop("vial",stand.global_position+Vector3(0,2,0))
	_attach(game.desktop_hand,physical)
	if not busy(game.desktop_hand): failures.append("held ownership")
	physical.set_meta("velocity",Vector3(0,-3,0)); release(game.desktop_hand)
	if busy(game.desktop_hand) or not physical.has_meta("body"): failures.append("physical release")
	physical.get_meta("body").global_position=stand.global_position+Vector3(0,1.7,0)
	for frame in range(60): await game.get_tree().physics_frame
	if is_instance_valid(physical) and not physical.get_meta("shattered",false): failures.append("real rigid-body impact")
	game.adventure.hurt_enemy(g,1000,null,Vector3.ZERO,"fire")
	if g.get_meta("alive"): failures.append("fire death")
	print("FIRE_CHECK ","PASS" if failures.is_empty() else str(failures))
	game.get_tree().quit(0 if failures.is_empty() else 1)


func _make_sounds():
	for kind in ["strike","glass","fire"]:
		var duration=0.22 if kind=="strike" else 0.65
		var count=int(22050*duration); var bytes=PackedByteArray(); bytes.resize(count*2)
		var rng=RandomNumberGenerator.new(); rng.seed=7812
		var smooth=0.0
		for i in range(count):
			var t=float(i)/22050; var noise=rng.randf_range(-1,1); smooth=lerpf(smooth,noise,0.08)
			var sample=noise*0.3 if kind=="strike" else (smooth*1.6 if kind=="fire" else (sin(t*TAU*2100)+sin(t*TAU*3271))*0.2+noise*0.12)
			sample*=exp(-t*(12 if kind=="glass" else 5))*minf(1,t*400)
			bytes.encode_s16(i*2,int(clampf(sample,-1,1)*24000))
		var wav=AudioStreamWAV.new(); wav.format=AudioStreamWAV.FORMAT_16_BITS; wav.mix_rate=22050; wav.data=bytes; sounds[kind]=wav
	for i in range(6):
		var player=AudioStreamPlayer3D.new(); game.add_child(player); player.max_distance=14; player.volume_db=-12; voices.append(player)

func _sound(kind,pos):
	if game.diagnostic_offline and (game.smoke or not OS.get_cmdline_user_args().has("--playful-demo")): return
	for player in voices:
		if player.playing: continue
		player.global_position=pos; player.stream=sounds[kind]; player.play(); return

func _splash(pos,lit):
	var root=Node3D.new(); game.adventure.zone_groups[game.adventure.zone].add_child(root); root.global_position=pos
	for i in range(16):
		var angle=i*2.4; var velocity=Vector3(cos(angle),0.5+float(i%4)*0.3,sin(angle))*(1.4 if lit else 0.65)
		var drop=WorldZones.rock(root,Vector3.ZERO,Vector3(0.07,0.12,0.06),"ffb447" if lit else "ccede6")
		var tween=create_tween(); tween.set_parallel(true); tween.tween_property(drop,"position",velocity,0.35).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT); tween.tween_property(drop,"scale",Vector3.ONE*0.1,0.65)
	var cleanup=create_tween(); cleanup.tween_interval(0.8); cleanup.tween_callback(root.queue_free)
