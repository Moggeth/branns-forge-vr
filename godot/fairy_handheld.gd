extends Node
## Fairy-sized manipulation: visual intent, swept contact, then a constrained scrape.
var fairy
var cue:Label3D
var item:Node3D
var target:Node3D
var home=Transform3D.IDENTITY
var age=0.0
var side=1.0
var scraping=false
var travelled=0.0
var ignited=false
var previous_tip=Vector3.ZERO
var target_origin=Vector3.ZERO
var cue_clock=0.0
var swing_hits=[]
var heat_cells_checked=0
func setup(owner):
	fairy=owner
	cue=Label3D.new(); fairy.game.add_child(cue); cue.font_size=24; cue.pixel_size=.0007
	cue.billboard=BaseMaterial3D.BILLBOARD_ENABLED; cue.modulate=Color("bdeeff"); cue.outline_size=4; cue.hide()
func cancel():
	if is_instance_valid(item):
		item.remove_meta("fairy_strike_owned")
		if item==fairy.carry: item.transform=home
	item=null; target=null; scraping=false; cue.hide()
func begin():
	if is_instance_valid(item) or not is_instance_valid(fairy.carry): return
	item=fairy.carry; home=item.transform; age=0; travelled=0; scraping=false; ignited=false; swing_hits.clear()
	previous_tip=tip()
	var box=fairy.game.firecraft.box
	if item.get_meta("fire_kind","")=="match" and item.get_meta("state","")=="fresh" and box.is_visible_in_tree() and fairy.avatar.global_position.distance_to(box.global_position)<fairy.cfg.match_reach:
		target=box; target_origin=box.global_position
		side=1 if box.to_local(fairy.avatar.global_position).x>=0 else -1
		item.set_meta("fairy_strike_owned",true)
	else: target=null
func tip()->Vector3:
	return item.to_global(Vector3(0,.115,0)) if item.get_meta("fire_kind","")=="match" else item.to_global(Vector3(0,.17,0))
func _obstruction(a:Vector3,b:Vector3)->Dictionary:
	if a.distance_squared_to(b)<.00000001: b=a+Vector3.UP*.0001
	var query=PhysicsRayQueryParameters3D.create(a,b,1|8); query.collide_with_areas=true; query.hit_from_inside=true
	var exclusions:Array[RID]=[]
	if is_instance_valid(fairy.avatar): exclusions.append(fairy.avatar.get_rid())
	for n in item.find_children("*","CollisionObject3D",true,false): exclusions.append(n.get_rid())
	if item is CollisionObject3D: exclusions.append(item.get_rid())
	query.exclude=exclusions
	return fairy.game.get_world_3d().direct_space_state.intersect_ray(query)
func tick(dt):
	cue_clock-=dt
	if cue_clock<=0:
		cue_clock=.08; cue.hide()
		if fairy.active and fairy.health>0 and not is_instance_valid(fairy.carry):
			var drawer=fairy.match_drawer_reachable() and not fairy.wants_box()
			var lift_box=fairy.wants_box() and fairy.can_carry(fairy.game.firecraft.box) and fairy.avatar.global_position.distance_to(fairy.game.firecraft.box.global_position)<.5
			var candidate=fairy.game.firecraft.box if drawer or lift_box else fairy.nearest_pickup()
			if is_instance_valid(candidate):
				cue.global_position=candidate.global_position+Vector3.UP*.15
				cue.text="Back / E: take one match\nShift + pickup: lift box" if drawer else "Back / E: "+str(candidate.get_meta("display_name",candidate.get_meta("fire_kind","Pick up")))
				cue.show()
	if not is_instance_valid(item): return
	if item!=fairy.carry or not fairy.active or fairy.health<=0: cancel(); return
	age+=dt
	if is_instance_valid(target):
		if not target.is_visible_in_tree() or target_origin.distance_to(target.global_position)>.12 or fairy.avatar.global_position.distance_to(target.global_position)>fairy.cfg.match_reach+.15:
			cancel(); fairy.note("The striker moved out of reach. Line up another swing."); return
		var desired:Vector3
		var local_tip:Vector3
		if age<.18:
			# Wind up above and outside the case, with a visible bat-like roll.
			item.transform=home; item.rotation.z+=side*sin(age/.18*PI*.5)*1.1
			desired=previous_tip.lerp(target.to_global(Vector3(side*.23,.11,-.075)),minf(1,dt*18))
		elif age<.32:
			var t=(age-.18)/.14
			local_tip=Vector3(side*lerpf(.23,.096,t),lerpf(.11,0,t),-.075)
			desired=target.to_global(local_tip)
		elif age<.59:
			# Match head radius keeps its centre outside the solid side panel.
			local_tip=Vector3(side*.096,0,lerpf(-.075,.075,(age-.32)/.27))
			desired=target.to_global(local_tip)
			var contact=_obstruction(target.to_global(Vector3(side*.15,0,local_tip.z)),target.to_global(Vector3(side*.06,0,local_tip.z)))
			if contact.is_empty() or (not target.is_ancestor_of(contact.collider) and contact.collider!=target.get_meta("body",target)):
				cancel(); return
			if not scraping: fairy.game.firecraft._sound("strike",desired)
			scraping=true
		else:
			# Recover gently so the celebratory swing does not blow its own flame out.
			item.transform=item.transform.interpolate_with(home,minf(1,dt*12))
			if age>.9: cancel()
			return
		var hit=_obstruction(previous_tip,desired)
		if not hit.is_empty() and not target.is_ancestor_of(hit.collider) and hit.collider!=target.get_meta("body",target):
			cancel(); fairy.note("Something blocks the swing. Come around to the matchbox side."); return
		item.global_position=desired-item.global_basis*Vector3(0,.115,0)
		if scraping:
			var old=target.to_local(previous_tip)
			if fairy.game.firecraft._can_strike(local_tip,old,dt):
				travelled+=absf(local_tip.z-old.z)
				fairy.art.sprinkle(desired,target.global_basis*Vector3(side*.15,.15,.3),Color("ffd584"),.22)
				if travelled>=fairy.cfg.match_scrape and not ignited:
					fairy.game.firecraft._light(item); ignited=true
					fairy.game.firecraft._sound("fire",desired)
					if item.has_meta("light"): item.get_meta("light").light_energy=.2
					for i in range(18):
						var a=i*2.4; var velocity=target.global_basis*Vector3(side*(.15+float(i%3)*.06),.15+sin(a)*.16,cos(a)*.3)
						fairy.art.sprinkle(desired,velocity,Color("ffc775"),.3+float(i%4)*.04)
					fairy.note("Fwoof! A very small hero with a very big match.")
		previous_tip=desired
	else:
		# Every carried object owns primary input. Generic objects get a physical swat.
		var t=clampf(age/.52,0,1); item.transform=home
		item.rotation.z+=sin(t*TAU)*1.05; item.rotation.x+=sin(t*PI)*.6
		var end=tip(); var hit=_obstruction(previous_tip,end)
		if not hit.is_empty():
			var collider=hit.collider
			if collider is RigidBody3D and collider not in swing_hits:
				collider.apply_impulse((end-previous_tip).normalized()*.12,hit.position-collider.global_position); swing_hits.append(collider)
			item.global_position+=hit.position-end
		if fairy.game.firecraft._burning(item): heat_sweep(previous_tip,tip())
		previous_tip=tip()
		if age>.52: cancel()

func heat_sweep(a:Vector3,b:Vector3)->int:
	var changed=0
	heat_cells_checked=0
	# Heat belongs to the real, current held flame, never a stale action reference.
	if not is_instance_valid(item) or item!=fairy.carry or not fairy.active or fairy.health<=0: return 0
	if not item.is_visible_in_tree() or str(item.get_meta("zone",fairy.game.adventure.zone))!=fairy.game.adventure.zone: return 0
	if not item.has_meta("state") or not fairy.game.firecraft._burning(item): return 0
	# No teleport ignition, and never sweep out of or through solid geometry.
	if not a.is_finite() or not b.is_finite() or a.distance_to(b)>.75: return 0
	var hit=_obstruction(a,b)
	if not hit.is_empty():
		if hit.normal.is_zero_approx(): return 0 # Ray began inside a collider.
		b=hit.position+hit.normal*.005
	var fire=fairy.game.firecraft
	if fire.fluid!=null and fire.fluid.fields.has(fairy.game.adventure.zone):
		var entry=fire.fluid.fields[fairy.game.adventure.zone]
		if entry.ready:
			var f=entry.field
			# A <75cm sweep can touch only a handful of the 4096 grid cells.
			var low=a.min(b)-Vector3(.20,0,.20); var high=a.max(b)+Vector3(.20,0,.20)
			var x0=maxi(0,int(floor((low.x-f.ORIGIN.x)/f.CELL)))
			var z0=maxi(0,int(floor((low.z-f.ORIGIN.y)/f.CELL)))
			var x1=mini(f.N-1,int(floor((high.x-f.ORIGIN.x)/f.CELL)))
			var z1=mini(f.N-1,int(floor((high.z-f.ORIGIN.y)/f.CELL)))
			for z in range(z0,z1+1):
				for x in range(x0,x1+1):
					var i=z*f.N+x; heat_cells_checked+=1
					if f.fuel[i]<=0 or f.burning[i]>0: continue
					var point=f.point(i)+Vector3.UP*.035
					var near=Geometry3D.get_closest_point_to_segment(point,a,b)
					if near.distance_to(point)>.20 or not _obstruction(near,point).is_empty(): continue
					changed+=f.ignite_near(f.point(i),.025)
	for prop in fire.props:
		if not is_instance_valid(prop) or prop==item or not prop.is_visible_in_tree() or prop.get_meta("fire_kind","")!="vial": continue
		if str(prop.get_meta("zone",fairy.game.adventure.zone))!=fairy.game.adventure.zone: continue
		var point=fire._tip(prop)
		var near=Geometry3D.get_closest_point_to_segment(point,a,b)
		if prop.get_meta("state","")=="fresh" and near.distance_to(point)<.13 and _obstruction(near,point).is_empty():
			fire._light(prop); changed+=1
	if fairy.game.get("ember_gallery")!=null and fairy.game.ember_gallery.lamplighting!=null:
		var lighting=fairy.game.ember_gallery.lamplighting
		for lamp in lighting.lamps:
			if not is_instance_valid(lamp.root) or not lamp.root.is_visible_in_tree(): continue
			var point=lamp.root.global_position+Vector3.UP*1.1
			var near=Geometry3D.get_closest_point_to_segment(point,a,b)
			if near.distance_to(point)<.16 and _obstruction(near,point).is_empty(): changed+=lighting.touch(point,.01,false)
	if changed>0 and fairy.get("practice")!=null: fairy.practice.record("ignite")
	return changed
