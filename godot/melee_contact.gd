extends Node
## Contact constraints are separate from tracked hands: real hands cannot be stopped.
signal hard_surface_contact(event: Dictionary)
const HardContact = preload("res://hard_surface_contact.gd")
const MIN_STRIKE_SPEED=1.0
const CUT_HEIGHT_TOLERANCE=0.18
const CUTS_TO_FELL=3
const BITE_DEPTH=0.045
const WITHDRAW_DISTANCE=0.10
const TREE_FELLING = preload("res://tree_felling.gd")
var game
var tracks={}
var desktop_contact: Dictionary = {}

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
		var regions: Array[Dictionary]=HardContact.regions(item)
		if not tracks.has(id):
			var previous_regions={}
			for region in regions: previous_regions[region.name]=item.to_global(region.local)
			tracks[id]={"previous":previous_regions[regions[0].name],"regions":previous_regions,"correction":Vector3.ZERO,"block":{},"item":item}
		var track=tracks[id]
		item.position-=track.correction
		track.correction=Vector3.ZERO
		var current={}
		for region in regions: current[region.name]=item.to_global(region.local)
		if game.grips.adjusting.has(key):
			track.regions=current; track.previous=current[regions[0].name]; track.block={}
			continue
		if not track.block.is_empty():
			var block=track.block
			var desired:Vector3=current[block.region]
			var speed=desired.distance_to(track.regions.get(block.region,desired))/maxf(delta,0.001)
			var anchor:Vector3=block.target.to_global(block.local_point) if is_instance_valid(block.target) and block.has("local_point") else block.point
			if not is_instance_valid(block.target) or not block.target.is_visible_in_tree() or (desired-anchor).dot(block.normal)>WITHDRAW_DISTANCE or desired.distance_to(anchor)>(0.10 if block.get("glance",false) else 0.32):
				if is_instance_valid(block.target) and block.get("blade",false) and block.target.get_meta("enemy_type","")=="skeleton" and speed>1.4 and game.skeleton_structure!=null:
					var torn=game.skeleton_structure.hit(block.target,anchor,block.normal,maxf(2.0,speed*0.8),"blade")
					if torn.detached and is_instance_valid(torn.item):
						_lodge_bone(item,torn.item)
						game._notice("A bone came free on the blade! Grip it with your other hand.",4)
				track.block={}
			else:
				constrain(item,track,desired,anchor+block.normal*0.008 if block.get("glance",false) else anchor-block.normal*float(block.get("bite",BITE_DEPTH)))
				for region in regions: track.regions[region.name]=item.to_global(region.local)
				continue
		var best={}
		var best_region=""
		var best_desired=Vector3.ZERO
		var best_speed=0.0
		var best_fraction=INF
		for region in regions:
			var start:Vector3=track.regions.get(region.name,current[region.name])
			var finish:Vector3=current[region.name]
			var length=start.distance_to(finish)
			if length<0.0001 or length>2.5: continue
			var query=PhysicsRayQueryParameters3D.create(start,finish,1)
			var candidate=game.get_world_3d().direct_space_state.intersect_ray(query)
			if candidate.is_empty(): continue
			var fraction:float=start.distance_to(candidate.position)/length
			if fraction<best_fraction:
				best=candidate; best_region=region.name; best_desired=finish
				best_speed=length/maxf(delta,0.001); best_fraction=fraction
		var hit=best
		if not hit.is_empty():
			var target=game._owner(hit.collider)
			if target==null: target=hit.collider
			var motion:Vector3=best_desired-track.regions.get(best_region,best_desired)
			var response=HardContact.response(target,item,hit.position,hit.normal,motion,best_speed,best_region)
			var completed=false
			if best_speed>=MIN_STRIKE_SPEED: completed=strike(target,hit.position,hit.normal,best_speed,hand,item,best_region)
			if not response.is_empty() and best_speed>=MIN_STRIKE_SPEED:
				response["completed"] = completed
				response["damage_result"] = "mined" if completed and response.material=="star_iron" else "contact"
				hard_surface_contact.emit(response)
			if not completed or response.get("block",false) or response.get("glance",false):
				var bite:float=float(response.get("bite",BITE_DEPTH)) if best_speed>=MIN_STRIKE_SPEED else 0.0
				var glance:bool=bool(response.get("glance",false))
				track.block={"target":target,"point":hit.position,"normal":hit.normal,"local_point":target.to_local(hit.position),"blade":_is_blade(item,hit.normal),"bite":bite,"region":best_region,"glance":glance}
				constrain(item,track,best_desired,hit.position+hit.normal*0.008 if glance else hit.position-hit.normal*bite)
		for region in regions: track.regions[region.name]=item.to_global(region.local)
		track.previous=track.regions[regions[0].name]
	for id in tracks.keys():
		if not is_instance_valid(tracks[id].item) or tracks[id].item not in seen: tracks.erase(id)

func constrain(item,track,desired:Vector3,stopped:Vector3):
	var before=item.position
	item.global_position+=stopped-desired
	track.correction=item.position-before
	track.previous=stopped

func desktop_hard_contact(item: Node3D, target: Node3D, point: Vector3,
		normal: Vector3, speed: float, contact_pose: Transform3D,
		completed: bool = false) -> bool:
	var motion: Vector3 = -game.camera.global_basis.z if game != null and game.camera != null else -normal
	var response := HardContact.response(target,item,point,normal,motion,speed,"pick_point" if str(item.get_meta("id", "")) == "quarry_pick" else "working")
	desktop_contact.clear()
	if response.is_empty(): return false
	response["completed"] = completed
	response["damage_result"] = "mined" if completed and response.material == "star_iron" else "contact"
	hard_surface_contact.emit(response)
	if not bool(response.block): return false
	desktop_contact={"item":item,"pose":contact_pose}
	return true

func desktop_contact_pose(item: Node3D, rest_pose: Transform3D,
		progress: float) -> Transform3D:
	if desktop_contact.get("item") != item: return Transform3D()
	return HardContact.desktop_pose(desktop_contact.pose,rest_pose,progress)

func desktop_contact_active(item: Node3D) -> bool:
	return desktop_contact.get("item") == item

func clear_desktop_contact() -> void:
	desktop_contact.clear()

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

func strike(target,point:Vector3,normal:Vector3,speed:float,hand,item,strike_region:String="working")->bool:
	if game.atelier!=null: game.atelier.impact(item,speed)
	if game.sunfall!=null and game.sunfall.is_sunfall(item):
		var motion=(point-tracks.get(item.get_instance_id(),{}).get("previous",point)).normalized()*speed
		if motion.length()<0.01: motion=-normal*speed
		return game.sunfall.impact(item,target,point,normal,speed,hand,motion)
	game.adventure.haptic(hand,"impact")
	var kind=target.get_meta("kind","")
	if kind=="meteor_ore" and game.world_builder!=null:
		if str(item.get_meta("id", "")) == "quarry_pick" and strike_region not in ["pick_point", "opposite_point", "working"]: return false
		return game.world_builder.mine_meteor(target,point,str(item.get_meta("id","")),speed,normal)
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
		return chop(target,point,normal,hand,speed) if item.get_meta("id","")=="woodland_axe" else false
	if kind=="resource" and item.get_meta("id","")=="quarry_pick":
		game.item_actions.resonant_mine(item,target,point,hand)
		game.adventure.interact(target,"quarry_pick",hand)
		return target.get_meta("collecting",false) or not target.visible
	if kind=="dummy":
		game._dummy_hit(target)
		mark(target,point,normal,0.13,speed,str(item.get_meta("id","")))
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
		if game.impact_feedback!=null:
			var enemy_material: String={"skeleton":"bone","golem":"stone","ent":"wood"}.get(str(target.get_meta("enemy_type","")),"flesh")
			game.impact_feedback.contact(target,point,normal,speed,str(item.get_meta("id","")),enemy_material)
		elif target.get_meta("enemy_type","")=="skeleton":
			game.remains._clack(point)
		if not target.get_meta("alive",true): return true
		# The blade stops when it has spent its energy inside bone. A stronger
		# swing or a freshly severed part lets it continue along its path.
		return not blade or shielded or result.get("detached",false) or remaining_energy>9.0 or effective_speed<1.8
	if kind=="rat": game._kill_rat(target); return true
	return false

func chop(target,point:Vector3,normal:Vector3,hand=null,speed:float=2.4)->bool:
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
	if game.impact_feedback!=null:
		game.impact_feedback.contact(target,point,normal,speed,"woodland_axe","wood")
	notch(target,bands[selected])
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

func mark(target,point:Vector3,normal:Vector3,size:float,speed:float=2.4,tool_id:String=""):
	var chip=game.adventure._box(target,target.to_local(point+normal*0.002),Vector3(size,0.035,0.018),Color("c89358"))
	chip.name="CutMark"
	chip.look_at(point+normal,Vector3.UP if absf(normal.y)<0.9 else Vector3.RIGHT,true)
	if game.impact_feedback!=null:
		game.impact_feedback.contact(target,point,normal,speed,tool_id,"wood")

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
