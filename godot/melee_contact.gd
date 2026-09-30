extends Node
## Contact constraints are separate from tracked hands: real hands cannot be stopped.
const MIN_STRIKE_SPEED=1.0
const CUT_HEIGHT_TOLERANCE=0.18
const CUTS_TO_FELL=3
const BITE_DEPTH=0.045
const WITHDRAW_DISTANCE=0.10
const TREE_FELLING = preload("res://tree_felling.gd")
var game
var tracks={}

func setup(owner_game): game=owner_game

func handles(item)->bool:
	# Loose bones have their own full-body collider for thrown physics. While
	# gripped that collider is disabled, so the swept tip is their melee contact.
	return item.get_meta("kind","")=="weapon" and not item.get_meta("crossbow",false) and not item.get_meta("ranged",false)

func tick(delta):
	var seen=[]
	for key in game.held:
		var item=game.held[key]
		if item in seen or not is_instance_valid(item): continue
		seen.append(item)
		if not handles(item): continue
		var hand=game.grips.grips.get(key,{}).get("hand",game.desktop_hand)
		var id=item.get_instance_id()
		# The desktop attack resolves once at the animated camera-ray contact.
		# Sweeping the moving display model would apply a second VR-style hit.
		if not game.vr and hand==game.desktop_hand and item.get_parent()==game.desktop_hand:
			tracks.erase(id)
			continue
		var tip=item.get_meta("tip",Vector3.UP*0.65)
		if not tracks.has(id): tracks[id]={"previous":item.to_global(tip),"correction":Vector3.ZERO,"block":{},"item":item}
		var track=tracks[id]
		item.position-=track.correction
		track.correction=Vector3.ZERO
		var desired=item.to_global(tip)
		if game.grips.adjusting.has(key): track.previous=desired; track.block={}; continue
		var speed=desired.distance_to(track.previous)/maxf(delta,0.001)
		if not track.block.is_empty():
			var block=track.block
			var anchor:Vector3=block.target.to_global(block.local_point) if is_instance_valid(block.target) and block.has("local_point") else block.point
			if not is_instance_valid(block.target) or not block.target.is_visible_in_tree() or (desired-anchor).dot(block.normal)>WITHDRAW_DISTANCE or desired.distance_to(anchor)>0.32:
				if is_instance_valid(block.target) and block.get("blade",false) and block.target.get_meta("enemy_type","")=="skeleton" and speed>1.4 and game.skeleton_structure!=null:
					var torn=game.skeleton_structure.hit(block.target,anchor,block.normal,maxf(2.0,speed*0.8),"blade")
					if torn.detached and is_instance_valid(torn.item):
						_lodge_bone(item,torn.item)
						game._notice("A bone came free on the blade! Grip it with your other hand.",4)
				track.block={}
			else:
				constrain(item,track,desired,anchor-block.normal*BITE_DEPTH)
				continue
		if desired.distance_to(track.previous)>0.8: track.previous=desired; continue
		var query=PhysicsRayQueryParameters3D.create(track.previous,desired,1)
		var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
		if not hit.is_empty():
			var target=game._owner(hit.collider)
			if target==null: target=hit.collider
			var completed=false
			if speed>=MIN_STRIKE_SPEED: completed=strike(target,hit.position,hit.normal,speed,hand,item)
			if not completed:
				track.block={"target":target,"point":hit.position,"normal":hit.normal,"local_point":target.to_local(hit.position),"blade":_is_blade(item,hit.normal)}
				constrain(item,track,desired,hit.position-hit.normal*(BITE_DEPTH if speed>=MIN_STRIKE_SPEED else 0.0))
		track.previous=item.to_global(tip)
	for id in tracks.keys():
		if not is_instance_valid(tracks[id].item) or tracks[id].item not in seen: tracks.erase(id)

func constrain(item,track,desired:Vector3,stopped:Vector3):
	var before=item.position
	item.global_position+=stopped-desired
	track.correction=item.position-before
	track.previous=stopped

func _is_blade(item,normal:Vector3)->bool:
	# Orchard's Edge cuts along local +X in the Knuckles grip. A target
	# surface normal points back toward the handle when that edge lands.
	# Do not count a strike with the opposite, crushing poll as a blade cut.
	return str(item.get_meta("id",""))=="woodland_axe" and item.global_basis.x.normalized().dot(normal)<-0.35

func _powered(item,hand)->bool:
	if str(item.get_meta("id",""))!="woodland_axe" or not item.get_meta("axe_power_armed",false): return false
	if hand==game.desktop_hand: return Input.is_mouse_button_pressed(MOUSE_BUTTON_RIGHT) or game.last_inputs.get(str(hand.get_instance_id())+"t",false)
	return game.last_inputs.get(str(hand.get_instance_id())+"t",false)

func _lodge_bone(axe:Node3D,bone:RigidBody3D)->void:
	bone.freeze=true
	bone.linear_velocity=Vector3.ZERO
	bone.angular_velocity=Vector3.ZERO
	bone.collision_layer=0
	bone.collision_mask=0
	bone.reparent(axe,true)
	bone.set_meta("lodged_on_axe",true)

func strike(target,point:Vector3,normal:Vector3,speed:float,hand,item)->bool:
	if game.atelier!=null: game.atelier.impact(item,speed)
	if game.sunfall!=null and game.sunfall.is_sunfall(item):
		var motion=(point-tracks.get(item.get_instance_id(),{}).get("previous",point)).normalized()*speed
		if motion.length()<0.01: motion=-normal*speed
		return game.sunfall.impact(item,target,point,normal,speed,hand,motion)
	game.adventure.haptic(hand,"impact")
	var kind=target.get_meta("kind","")
	if kind=="meteor_ore" and game.world_builder!=null:
		return game.world_builder.mine_meteor(target,point,str(item.get_meta("id","")),speed)
	if str(kind).begins_with("hollow_"):
		return game.adventure.interact(target,str(item.get_meta("id","apprentice_hammer")),hand)
	if kind=="apple" and game.apples!=null:
		game.apples.impact(target,speed,point,-normal*speed)
		return true
	if kind=="pumpkin" and game.pumpkins!=null:
		var motion=(point-tracks.get(item.get_instance_id(),{}).get("previous",point)).normalized()*speed
		if motion.length()<0.01: motion=-normal*speed
		return game.pumpkins.impact(target,item,point,normal,motion)
	if kind=="builder_forest" and game.world_builder!=null and str(item.get_meta("id", ""))=="woodland_axe":
		return game.world_builder.chop_scenic(point,_is_blade(item,normal),normal,hand)
	if kind=="resource" and target.get_meta("requires","") in ["axe","chop"]:
		return chop(target,point,normal,hand) if item.get_meta("id","")=="woodland_axe" else false
	if kind=="resource" and item.get_meta("id","")=="quarry_pick":
		game.item_actions.resonant_mine(item,target,point,hand)
		game.adventure.interact(target,"quarry_pick",hand)
		return target.get_meta("collecting",false) or not target.visible
	if kind=="dummy":
		game._dummy_hit(target)
		mark(target,point,normal,0.13)
		return false
	if kind=="enemy":
		var direction=(point-tracks.get(item.get_instance_id(),{}).get("previous",point)).normalized()
		if direction.length_squared()<0.01: direction=-normal
		var powered=_powered(item,hand)
		var effective_speed=speed*(2.8 if powered else 1.0)
		var mass=clampf(float(item.get_meta("combat_mass",item.mass if item is RigidBody3D else 1.2)),0.3,8.0)
		var impact_force=effective_speed*sqrt(mass/1.65)
		var remaining_energy=0.5*mass*effective_speed*effective_speed
		var blade=_is_blade(item,normal)
		var guardian=game.guardians.guardians.get(target.get_instance_id(),{}) if game.guardians!=null else {}
		var high_head_strike=target.to_local(point).y>=1.43
		var shielded=not high_head_strike and not guardian.is_empty() and guardian.state=="carried" and game.guardians._is_frontal(guardian,hand.global_position if hand is Node3D else game.camera.global_position)
		var result={}
		if target.get_meta("enemy_type","")=="skeleton" and game.skeleton_structure!=null and not shielded:
			result=game.skeleton_structure.hit(target,point,direction,impact_force,"blade" if blade else "blunt")
			# Audible contact on every connected bone strike, not only when a
			# whole limb breaks free. PhysicalRemains pools and throttles the clack.
			game.remains._clack(point)
			remaining_energy-=5.5 if blade else 3.0
			if powered and blade:
				var cut_regions=[result.get("region","")]
				for reach in [0.22,0.44]:
					var follow=point+direction*reach
					var local=target.to_local(follow)
					if local.y<0.18 or local.y>1.85 or absf(local.x)>0.75: continue
					var region=game.skeleton_structure.region_at(target,follow)
					if cut_regions.has(region): continue
					if remaining_energy<4.5: break
					game.skeleton_structure.hit(target,follow,direction,impact_force*(1.0-reach*0.8),"blade")
					cut_regions.append(region)
					remaining_energy-=5.0
		var damage=clampf(impact_force*(7.0 if blade else 5.8),6.0,58.0)
		if result.get("detached",false): damage+=10.0
		var impulse=direction*clampf(impact_force*(0.8 if blade else 1.35),1.0,7.0)
		# Keep living skeleton feet planted. The impulse still drives local hit
		# animation and, on death, the physical bone scatter.
		if target.get_meta("enemy_type","")!="skeleton":
			target.set_meta("knock_velocity",Vector3(impulse.x,0,impulse.z))
		game.adventure.hurt_enemy(target,damage,hand,impulse,"physical",point)
		if result.get("detached",false):
			game.remains._clack(point)
			game._effect(point,Color("efddba"),0.2,0.28)
		if not target.get_meta("alive",true): return true
		# The blade stops when it has spent its energy inside bone. A stronger
		# swing or a freshly severed part lets it continue along its path.
		return not blade or shielded or result.get("detached",false) or remaining_energy>9.0 or effective_speed<1.8
	if kind=="rat": game._kill_rat(target); return true
	return false

func chop(target,point:Vector3,normal:Vector3,hand=null)->bool:
	if target.get_meta("collecting",false) or target.get_meta("felled",false) or not target.visible: return true
	var bands=target.get_meta("cut_bands",[])
	var height=target.to_local(point).y
	var allowed: Vector2 = target.get_meta("chop_band", Vector2(0.3, 2.2))
	if height < allowed.x or height > allowed.y: return false
	var selected=-1
	for i in range(bands.size()):
		if absf(bands[i].height-height)<=CUT_HEIGHT_TOLERANCE: selected=i; break
	if selected<0:
		bands.append({"height":height,"hits":0,"point":point,"normal":normal})
		selected=bands.size()-1
	bands[selected].hits+=1
	target.set_meta("cut_bands",bands)
	game._effect(point,Color("cba36c"),0.32,0.14+0.05*bands[selected].hits)
	notch(target,bands[selected])
	for chip in range(2+bands[selected].hits*2):
		var spread=Vector3(randf_range(-0.16,0.16),randf_range(-0.10,0.18),randf_range(-0.16,0.16))
		game._effect(point+spread,Color("e0b982"),0.12,randf_range(0.035,0.07))
	_authored_chips(target,point,normal,int(bands[selected].hits))
	if bands[selected].hits<CUTS_TO_FELL:
		game._notice("Cut %d / 3 · strike this height again."%bands[selected].hits,3)
		return false
	var felling= TREE_FELLING.new()
	game.adventure.zone_groups.get(game.adventure.zone,game).add_child(felling)
	target.set_meta("cut_height",float(bands[selected].height))
	felling.start(game,target,float(bands[selected].height),normal)
	target.set_meta("felled",true)
	target.set_meta("cut_bands",[])
	game._notice("Timber down! Reach for the log to collect lumber.",4)
	return true

func mark(target,point:Vector3,normal:Vector3,size:float):
	var chip=game.adventure._box(target,target.to_local(point+normal*0.002),Vector3(size,0.035,0.018),Color("c89358"))
	chip.name="CutMark"
	chip.look_at(point+normal,Vector3.UP if absf(normal.y)<0.9 else Vector3.RIGHT,true)
	game._effect(point,Color("cba36c"),0.4,size)

func notch(target,band):
	if not target.has_meta("trunk"): return
	var trunk=target.get_meta("trunk")
	if not is_instance_valid(trunk): return
	var wedge_path := "res://assets/tree_cutting/cut_wedge_%d.glb" % clampi(int(band.hits), 1, 3)
	if ResourceLoader.exists(wedge_path):
		# Authored wedges follow the actual surface of an uncut TreeKit trunk.
		# Retain its original mesh so the lip does not hover over a second hole.
		trunk.mesh = target.get_meta("trunk_mesh", trunk.mesh)
		_authored_cut(target, band, trunk)
		return
	var profiles=[]
	var levels=[-0.5,0.5]
	for cut in target.get_meta("cut_bands",[band]):
		var center=trunk.to_local(cut.point)
		var y=clampf(center.y,-0.38,0.38)
		profiles.append({"y":y,"angle":atan2(center.z,center.x),"hits":cut.hits})
		for level in [y-0.12,y-0.065,y,y+0.065,y+0.12]:
			if not levels.has(level): levels.append(level)
	levels.sort()
	var rings=[]
	for level in levels:
		var ring=[]
		for i in range(32):
			var a=TAU*i/32
			var r=lerpf(0.5,0.25,level+0.5)
			for cut in profiles:
				var vertical=maxf(0.0,1.0-absf(level-cut.y)/0.12)
				var width=0.55+0.16*cut.hits
				var around=maxf(0.0,1.0-absf(angle_difference(cut.angle,a))/width)
				r-=vertical*around*(0.07+0.055*cut.hits)
			ring.append(Vector3(cos(a)*maxf(r,0.04),level,sin(a)*maxf(r,0.04)))
		rings.append(ring)
	var s=SurfaceTool.new()
	s.begin(Mesh.PRIMITIVE_TRIANGLES)
	var bark: Color=target.get_meta("trunk_color",Color("825537"))
	for j in range(levels.size()-1):
		for i in range(32):
			var k=(i+1)%32
			var exposed=false
			for cut in profiles:
				if absf((levels[j]+levels[j+1])*0.5-cut.y)<0.085 and absf(angle_difference(cut.angle,TAU*(i+0.5)/32))<0.55+0.16*cut.hits: exposed=true
			s.set_color(Color("d9b179") if exposed else bark.darkened(0.04*float(i%3)))
			for v in [rings[j][i],rings[j][k],rings[j+1][k],rings[j][i],rings[j+1][k],rings[j+1][i]]: s.add_vertex(v)
	s.generate_normals()
	trunk.mesh=s.commit()
	# TreeKit's shared shader consumes vertex colours; retain its material and
	# wind/emission conventions instead of replacing it with a flat override.
	_authored_cut(target,band,trunk)

func _authored_cut(target: Node3D, band: Dictionary, trunk: MeshInstance3D) -> void:
	var old := target.get_node_or_null("CutWedge")
	if old != null: old.free()
	var hit_index: int = clampi(int(band.hits), 1, 3)
	var path := "res://assets/tree_cutting/cut_wedge_%d.glb" % hit_index
	if not ResourceLoader.exists(path): return
	var wedge: Node3D = load(path).instantiate()
	wedge.name = "CutWedge"
	target.add_child(wedge)
	var outward: Vector3 = target.global_basis.inverse() * band.normal
	outward.y = 0.0
	if outward.length_squared() < 0.01: outward = Vector3.RIGHT
	outward = outward.normalized()
	var local_y: float = (float(band.height) - trunk.position.y) / maxf(absf(trunk.transform.basis.y.y), 0.001)
	var unit_radius: float = lerpf(0.5, 0.25, clampf(local_y + 0.5, 0.0, 1.0))
	var radius: float = unit_radius * maxf(trunk.transform.basis.x.length(), trunk.transform.basis.z.length())
	var centre: Vector3 = trunk.transform * Vector3(0, local_y, 0)
	centre.y = float(band.height)
	wedge.position = centre + outward * radius
	wedge.rotation.y = -atan2(outward.z, outward.x)
	var stage_spread: float = {1: 1.8, 2: 1.5, 3: 1.12}.get(hit_index, 1.0)
	wedge.scale = Vector3(radius, radius * stage_spread, radius * stage_spread)

func _authored_chips(target: Node3D, point: Vector3, normal: Vector3, hit_index: int) -> void:
	for i in range(2 + hit_index):
		var path := "res://assets/tree_cutting/chip_%s.glb" % ("a" if i % 2 == 0 else "b")
		if not ResourceLoader.exists(path): continue
		var chip: Node3D = load(path).instantiate()
		target.get_parent().add_child(chip)
		chip.global_position = point + Vector3(randf_range(-0.08,0.08),randf_range(-0.05,0.08),randf_range(-0.08,0.08))
		chip.scale = Vector3.ONE * randf_range(0.7,1.3)
		var travel := (normal + Vector3(randf_range(-0.5,0.5),0.7,randf_range(-0.5,0.5))).normalized() * randf_range(0.24,0.5)
		var tween := create_tween()
		tween.tween_property(chip,"global_position",chip.global_position + travel,0.36).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tween.tween_property(chip,"transparency",1.0,0.28) if chip is GeometryInstance3D else tween.tween_interval(0.28)
		tween.tween_callback(chip.queue_free)

func alternate(item,hand):
	item.set_meta("axe_power_armed",true)
	item.set_meta("axe_power_started",game.elapsed)
	game.adventure.haptic(hand,"ready")
	game._notice("Hold RMB through the swing: powered cleave." if hand==game.desktop_hand else "Hold trigger and swing: powered cleave.",3)
