extends Node
## One bounded contact route for native flame, surface fuel and authored materials.
const MAX_SWEEP=0.75
const MAX_HEAT_RADIUS=1.8
var game
var last_cells_checked=0
var wick_dwell={}
var fixtures=[]
var clock=0.0

func setup(owner_game):
	game=owner_game
	print("HEAT_CONTACTS_READY shared_sources=true fuel_pending=true")

func _blocked(a:Vector3,b:Vector3)->bool:
	if a.distance_squared_to(b)<.000001: b=a+Vector3.UP*.0001
	var query=PhysicsRayQueryParameters3D.create(a,b,1)
	query.collide_with_areas=false
	query.hit_from_inside=true
	var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
	return not hit.is_empty() and (hit.normal.is_zero_approx() or hit.position.distance_to(b)>.025)

func touch(point:Vector3,radius:float,heat:float,zone_id:String,kind:String="flame",source=null,dt:float=.1)->int:
	return sweep(point,point,radius,heat,zone_id,kind,source,dt)

func sweep(a:Vector3,b:Vector3,radius:float,heat:float,zone_id:String,kind:String="flame",source=null,dt:float=.1)->int:
	last_cells_checked=0
	if not a.is_finite() or not b.is_finite() or not is_finite(radius) or not is_finite(heat): return 0
	if radius<=0 or heat<=0 or zone_id!=game.adventure.zone or a.distance_to(b)>MAX_SWEEP: return 0
	radius=minf(radius,MAX_HEAT_RADIUS)
	if source!=null and (not is_instance_valid(source) or not source.is_visible_in_tree()): return 0
	var clip_query=PhysicsRayQueryParameters3D.create(a,b if a.distance_squared_to(b)>.000001 else a+Vector3.UP*.0001,1)
	clip_query.hit_from_inside=true
	clip_query.collide_with_areas=false
	var obstruction=game.get_world_3d().direct_space_state.intersect_ray(clip_query)
	if not obstruction.is_empty():
		if obstruction.normal.is_zero_approx(): return 0
		b=obstruction.position+obstruction.normal*.006
	var changed=0
	var fluid=game.firecraft.fluid if game.firecraft!=null else null
	if fluid!=null and fluid.fields.has(zone_id):
		var entry=fluid.fields[zone_id]
		if entry.ready:
			var field=entry.field
			var low=a.min(b)-Vector3(radius,0,radius); var high=a.max(b)+Vector3(radius,0,radius)
			var x0=maxi(0,int(floor((low.x-field.ORIGIN.x)/field.CELL)))
			var z0=maxi(0,int(floor((low.z-field.ORIGIN.y)/field.CELL)))
			var x1=mini(field.N-1,int(floor((high.x-field.ORIGIN.x)/field.CELL)))
			var z1=mini(field.N-1,int(floor((high.z-field.ORIGIN.y)/field.CELL)))
			for z in range(z0,z1+1):
				for x in range(x0,x1+1):
					var i=z*field.N+x; last_cells_checked+=1
					if field.fuel[i]<=.000001 or field.burning[i]>0: continue
					var target=field.point(i)+Vector3.UP*.03
					var nearest=Geometry3D.get_closest_point_to_segment(target,a,b)
					if nearest.distance_to(target)>radius or _blocked(nearest,target): continue
					changed+=fluid.ignite_near(field.point(i),.025)
		else:
			for request in entry.pending:
				var target:Vector3=request.pos+Vector3.UP*.03
				var nearest=Geometry3D.get_closest_point_to_segment(target,a,b)
				if nearest.distance_to(target)<=radius and not _blocked(nearest,target):
					changed+=fluid.ignite_near(request.pos,.06)
	if game.firecraft!=null:
		for prop in game.firecraft.props:
			if not is_instance_valid(prop) or prop==source or not prop.is_visible_in_tree(): continue
			if prop.get_meta("state","")!="fresh" or prop.get_meta("fire_kind","") not in ["match","vial"]: continue
			if str(prop.get_meta("zone",zone_id))!=zone_id: continue
			var tip=game.firecraft._tip(prop)
			var nearest=Geometry3D.get_closest_point_to_segment(tip,a,b)
			var key=str(prop.get_instance_id())+":"+str(source.get_instance_id() if is_instance_valid(source) else kind)
			if nearest.distance_to(tip)>radius or _blocked(nearest,tip): wick_dwell.erase(key); continue
			var duration=0.0 if kind=="fairy_match" or kind=="fuel" else .3
			wick_dwell[key]=float(wick_dwell.get(key,0))+dt
			if wick_dwell[key]>=duration:
				game.firecraft._light(prop); wick_dwell.erase(key); changed+=1
	if game.living!=null and game.living.components!=null:
		for entry in game.living.components.entries.values():
			if not is_instance_valid(entry.node) or not entry.node.is_visible_in_tree() or not entry.components.has("material"): continue
			var target=entry.node.global_position
			var reach=radius+minf(.35,entry.size.length()*.2)
			var nearest=Geometry3D.get_closest_point_to_segment(target,a,b)
			if nearest.distance_to(target)>reach or _blocked(nearest,target): continue
			entry.state.heat=minf(1000,float(entry.state.heat)+heat*dt)
			changed+=1
	for fixture in fixtures:
		if fixture.zone!=zone_id or not is_instance_valid(fixture.node): continue
		var target=fixture.node.global_position+Vector3.UP*.25
		var nearest=Geometry3D.get_closest_point_to_segment(target,a,b)
		if nearest.distance_to(target)>radius+.25 or _blocked(nearest,target): continue
		fixture.heat=minf(300,float(fixture.heat)+heat*dt)
		changed+=1
	_melt_snow(a,b,radius,heat*dt)
	return changed

func _melt_snow(a:Vector3,b:Vector3,radius:float,heat_amount:float):
	if game.weather==null or not game.weather.enabled or not game.weather.coverage_ready or game.weather.zone!=game.adventure.zone: return
	var field=game.weather.engine
	var center=field.cell_index(b)
	if center<0: return
	var reach=ceili(radius/field.CELL)+1
	for z in range(maxi(0,int(center/field.N)-reach),mini(field.N,int(center/field.N)+reach+1)):
		for x in range(maxi(0,center%field.N-reach),mini(field.N,center%field.N+reach+1)):
			var i=z*field.N+x
			if field.snow[i]<=0: continue
			var point=field.point(i)
			if Geometry3D.get_closest_point_to_segment(point,a,b).distance_to(point)>radius: continue
			var melted=minf(field.snow[i],heat_amount*.0015)
			field.snow[i]-=melted; field.wet[i]=minf(1,field.wet[i]+melted*.6)
			field.set_meta("heat_dirty",true)

func hot_at(point:Vector3,zone_id:String,radius:float=.3)->bool:
	if zone_id!=game.adventure.zone: return false
	if game.firecraft!=null:
		for prop in game.firecraft.props:
			if is_instance_valid(prop) and prop.is_visible_in_tree() and str(prop.get_meta("zone",zone_id))==zone_id and game.firecraft._burning(prop) and game.firecraft._tip(prop).distance_to(point)<=radius+.12: return true
		var fluid=game.firecraft.fluid
		if fluid!=null and fluid.fields.has(zone_id):
			var entry=fluid.fields[zone_id]
			if entry.ready and fluid.nearest_fire(entry.field,point,radius)!=Vector3.INF: return true
	if game.hearth_torch!=null and game.hearth_torch.lit and game.hearth_torch.torch.is_visible_in_tree() and game.hearth_torch.tip_position().distance_to(point)<=radius+.15: return true
	if game.wyrmspout!=null:
		for flame in game.wyrmspout.flame_sources():
			if flame.distance_to(point)<=radius+.3: return true
	return false

func tick(delta:float):
	clock+=delta
	if clock<.1: return
	var dt=minf(clock,.2); clock=0
	if game.weather!=null and game.weather.engine!=null and game.weather.engine.has_meta("heat_dirty"):
		game.weather.engine.remove_meta("heat_dirty")
		game.weather.engine.update_field(); game.weather.engine.field_texture.update(game.weather.engine.field_image)
	var fluid=game.firecraft.fluid if game.firecraft!=null else null
	if fluid==null or not fluid.fields.has(game.adventure.zone): return
	var field=fluid.fields[game.adventure.zone].field
	if not fluid.fields[game.adventure.zone].ready: return
	for prop in game.firecraft.props:
		if not is_instance_valid(prop) or not prop.is_visible_in_tree() or prop.get_meta("state","")!="fresh" or str(prop.get_meta("zone",game.adventure.zone))!=game.adventure.zone: continue
		if fluid.nearest_fire(field,game.firecraft._tip(prop),.32)!=Vector3.INF: game.firecraft._light(prop)
	if game.living!=null and game.living.components!=null:
		for entry in game.living.components.entries.values():
			if not is_instance_valid(entry.node) or not entry.node.is_visible_in_tree() or not entry.components.has("material"): continue
			if fluid.nearest_fire(field,entry.node.global_position,.6)!=Vector3.INF: entry.state.heat=minf(1000,float(entry.state.heat)+120*dt)
	for fixture in fixtures:
		if fixture.zone!=game.adventure.zone or not is_instance_valid(fixture.node): continue
		if fluid.nearest_fire(field,fixture.node.global_position,.65)!=Vector3.INF: fixture.heat=minf(300,float(fixture.heat)+120*dt)
