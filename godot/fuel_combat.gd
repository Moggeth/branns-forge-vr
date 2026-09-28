extends Node
## Shared surface fuel. One fixed 24m patch per visited zone, retained for this session.
const Field=preload("res://weather_lab.gd")
const MAX_FIELDS=8
const SCAN_CELLS_PER_TICK=128
var game
var fields={}
var fear_sources=[]
var accumulator=0.0
var hurt_at=0.0
var rejected=0

func setup(g):
	game=g
	print("FUEL_COMBAT shared=true budget_potions=40 zone_fields=8 persistence=session inactive_zones=paused")

func remaining_fuel()->float:
	var total=0.0
	for entry in fields.values():
		total+=entry.field.total_fuel()
		for request in entry.pending: total+=request.get("amount",Field.FUEL_PER_POTION)
	return total

func reject(reason):
	rejected+=1
	game._notice(reason,4)
	print("FUEL_COMBAT_REJECT ",reason)

## Prefabs can reserve a centred empty patch before the first spill. No fuel is
## invented, and existing patch locations/contents never change on revisiting.
func prewarm_region(zone_id:String,center:Vector3,scan_ceiling:float,fixed=true)->bool:
	if fields.has(zone_id): return true
	if not center.is_finite() or not is_finite(scan_ceiling) or fields.size()>=MAX_FIELDS: return false
	var f=Field.new(); game.add_child(f); f.setup(null,true,true)
	f.ORIGIN=Vector2(floorf(center.x/Field.CELL)*Field.CELL-12,floorf(center.z/Field.CELL)*Field.CELL-12)
	f.heights.fill(1000); f.visible=false
	fields[zone_id]={"field":f,"scan":0,"plane":scan_ceiling,"pending":[],"touches":[],"ready":false,"fixed":fixed}
	return true

func impact(pos:Vector3,zone_id:String,lit:bool)->float:
	if remaining_fuel()+Field.FUEL_PER_POTION>Field.MAX_POTION_EQUIVALENTS*Field.FUEL_PER_POTION+.0001:
		reject("Fuel field is full. Let some fire burn away before pouring more."); return 0.0
	return pour(pos,zone_id,Field.FUEL_PER_POTION,lit)

## Returns exact admitted volume, including reserved fuel waiting for surface scanning.
## Container callers must subtract this result, never the attempted amount.
func pour(pos:Vector3,zone_id:String,amount:float,lit=false)->float:
	if not pos.is_finite() or not is_finite(amount) or amount<=0: return 0.0
	if zone_id!=game.adventure.zone:
		return 0.0
	var accepted=minf(amount,maxf(0,Field.MAX_POTION_EQUIVALENTS*Field.FUEL_PER_POTION-remaining_fuel()))
	if accepted<=.000001: return 0.0
	if fields.has(zone_id):
		var previous=fields[zone_id]
		if previous.field.cell_index(pos)<0:
			if previous.get("fixed",false) or previous.field.total_fuel()>.001 or not previous.pending.is_empty():
				return 0.0
			previous.field.queue_free(); fields.erase(zone_id)
	# Validate a support before reserving fuel. This prevents draining a held vessel
	# for a spill that a later asynchronous scan would reject.
	var query=PhysicsRayQueryParameters3D.create(pos+Vector3.UP*.4,pos+Vector3.DOWN*12,1)
	query.collide_with_areas=false
	var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
	if not hit.has("position") or hit.normal.y<=.5: return 0.0
	var surface:Vector3=hit.position
	if fields.has(zone_id):
		var existing=fields[zone_id]; var id=existing.field.cell_index(surface)
		if existing.field.fuel[id]>.00001 and absf(existing.field.heights[id]-surface.y)>.4:
			return 0.0 # One height per column: never move an existing puddle to another floor.
		for request in existing.pending:
			if existing.field.cell_index(request.pos)==id and absf(request.support-surface.y)>.4: return 0.0
	if not fields.has(zone_id):
		if not prewarm_region(zone_id,pos,pos.y+.4,false): return 0.0
	var entry=fields[zone_id]
	entry.pending.append({"pos":surface,"lit":lit,"amount":accepted,"support":surface.y})
	if entry.ready: flush(entry)
	return accepted

func scan(entry):
	var f=entry.field
	var space=game.get_world_3d().direct_space_state
	var finish=mini(Field.N*Field.N,entry.scan+SCAN_CELLS_PER_TICK)
	for i in range(entry.scan,finish):
		var p=f.point(i); p.y=entry.plane
		var query=PhysicsRayQueryParameters3D.create(p,p+Vector3.DOWN*12,1)
		query.collide_with_areas=false
		var hit=space.intersect_ray(query)
		if hit.has("position") and hit.normal.y>.5: f.heights[i]=hit.position.y
	entry.scan=finish
	if finish==Field.N*Field.N:
		entry.ready=true; flush(entry)
		print("FUEL_COMBAT_SURFACES ready cells=4096")

func flush(entry):
	var f=entry.field
	for request in entry.pending:
		var id=f.cell_index(request.pos)
		# This support was validated before accepting the exact reserved quantity.
		# A thin ledge can fall between grid-center rays; retain its sampled height.
		f.heights[id]=request.support
		f.pour(request.pos,request.amount,request.lit)
		f.drops.clear() # The actual bottle impact already owns splash particles.
		if request.lit: game.firecraft._sound("fire",request.pos)
	entry.pending.clear()
	for touch in entry.get("touches",[]):
		if touch.water: f.extinguish_near(touch.pos,touch.radius)
		else: f.ignite_near(touch.pos,touch.radius)
	entry.touches.clear()
	f.update_fluid_visuals()

func tick(delta):
	for key in fields:
		var entry=fields[key]
		entry.field.visible=key==game.adventure.zone and entry.ready
		if key==game.adventure.zone and entry.ready:
			entry.field.light_observer=game.camera.global_position
			entry.field.tick_fire_lights(delta)
		if key==game.adventure.zone and not entry.ready: scan(entry)
	accumulator+=delta
	if accumulator<.1: return
	var dt=minf(accumulator,.2); accumulator=0.0; fear_sources.clear()
	if not fields.has(game.adventure.zone): return
	var entry=fields[game.adventure.zone]
	if not entry.ready: return
	var f=entry.field
	if f.total_fuel()<=.0001: return
	# Match outdoor exposure without allowing weather to move or erase the fuel grid.
	if game.weather!=null and game.weather.enabled and game.weather.coverage_ready and game.weather.zone==game.adventure.zone:
		var weather=game.weather.engine
		f.hour=weather.hour
		for i in range(Field.N*Field.N):
			var p=f.point(i); var j=weather.cell_index(p)
			if j>=0 and absf(weather.heights[j]-p.y)<.4: f.wet[i]=weather.wet[j]
	f.spill_burn_seconds=clampf(game.firecraft.cfg.get("spill_burn_seconds",8.0),5,10)
	f.unlit_evaporation_rate=.002/pow(clampf(game.firecraft.cfg.get("spill_unlit_lifetime_scale",1.5),1,3),2)
	f.elapsed+=dt; f.simulation(dt)
	apply_damage(f,dt)

func nearest_fire(f,pos:Vector3,radius:float)->Vector3:
	var result=Vector3.INF; var best=radius*radius
	var center=f.cell_index(pos)
	if center<0: return result
	var reach=ceili(radius/Field.CELL)
	var cx=center%Field.N; var cz=int(center/Field.N)
	for z in range(maxi(0,cz-reach),mini(Field.N,cz+reach+1)):
		for x in range(maxi(0,cx-reach),mini(Field.N,cx+reach+1)):
			var i=z*Field.N+x
			if f.burning[i]==0 or f.fuel[i]<.01: continue
			var p=f.point(i)
			var distance=pos.distance_squared_to(p)
			if distance<best: best=distance; result=p
	return result

func apply_damage(f,dt):
	for ghost in game.firecraft.ghosts:
		if not is_instance_valid(ghost) or not ghost.get_meta("alive",false) or not ghost.is_visible_in_tree(): continue
		var p=nearest_fire(f,ghost.global_position,game.firecraft.cfg.fear_radius)
		if p==Vector3.INF: continue
		if not fear_sources.has(p): fear_sources.append(p)
		if ghost.global_position.distance_to(p)<.7: game.firecraft.hurt_ghost(ghost,120*dt,"fire")
	var feet=game.camera.global_position-Vector3.UP*1.5
	if game.elapsed>=hurt_at and nearest_fire(f,feet,.8)!=Vector3.INF:
		hurt_at=game.elapsed+1.2; game.adventure.take_damage(5,"Emberdew fire")

func ignite_near(pos:Vector3,radius:float)->int:
	return _touch_near(pos,radius,false)

func extinguish_near(pos:Vector3,radius:float)->int:
	return _touch_near(pos,radius,true)

func _touch_near(pos:Vector3,radius:float,water:bool)->int:
	if not pos.is_finite() or not is_finite(radius) or radius<=0: return 0
	var devices=0
	if game.get("ember_gallery")!=null and game.ember_gallery.lamplighting!=null:
		devices=game.ember_gallery.lamplighting.touch(pos,radius,water)
	if not fields.has(game.adventure.zone): return devices
	var entry=fields[game.adventure.zone]
	# Pending fuel participates too, so a match/water touch during surface scanning
	# cannot be forgotten by the time the puddle becomes visible.
	for request in entry.get("pending",[]):
		if request.pos.distance_squared_to(pos)<=radius*radius: request.lit=not water
	if not entry.ready:
		# Coalesce repeated torch/water contacts while the short scan completes.
		var merged=false
		for touch in entry.touches:
			if touch.water==water and touch.pos.distance_squared_to(pos)<.04:
				touch.pos=pos; touch.radius=maxf(touch.radius,radius); merged=true; break
		if not merged and entry.touches.size()<128: entry.touches.append({"pos":pos,"radius":radius,"water":water})
		return devices
	var changed=entry.field.extinguish_near(pos,radius) if water else entry.field.ignite_near(pos,radius)
	if changed>0: entry.field.update_fluid_visuals()
	return changed+devices

func active_counts()->Dictionary:
	var result={"fuel":remaining_fuel(),"capacity":Field.MAX_POTION_EQUIVALENTS*Field.FUEL_PER_POTION,"fields":fields.size(),"pending_units":0.0,"puddles":0,"flames":0,"lights":0,"ready":false}
	for entry in fields.values():
		for request in entry.pending: result.pending_units+=request.amount
	if fields.has(game.adventure.zone):
		var entry=fields[game.adventure.zone]; result.ready=entry.ready
		result.puddles=maxi(0,entry.field.liquid.multimesh.visible_instance_count) if entry.ready else 0
		result.flames=maxi(0,entry.field.flames.multimesh.visible_instance_count) if entry.ready else 0
		for lamp in entry.field.fire_lights:
			if lamp.light_energy>.01: result.lights+=1
	return result
