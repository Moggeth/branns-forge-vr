extends RefCounted
## Runtime primitive for declarative returning_projectile components.
## Flight owns only the existing package entity, never creates copies or moves players.
var engine
var flights={}

func setup(owner_engine): engine=owner_engine

func free_hand(hand)->bool:
	if not is_instance_valid(hand): return false
	var key=str(hand.get_instance_id())
	if engine.held.has(key): return false
	var ordinary=engine.game.get("held")
	if ordinary is Dictionary and ordinary.has(key): return false
	for name in ["firecraft","workshop","enchantments","siegebird","playful_tools","magnetic_wand","cargo_playground","echo_bells"]:
		var system=engine.game.get(name)
		if system!=null and system.has_method("busy") and system.busy(hand): return false
	var adventure=engine.game.get("adventure")
	if adventure!=null and adventure.get("formation") is Dictionary and adventure.formation.has(key): return false
	return true

func claims_trigger(hand)->bool:
	if not free_hand(hand): return false
	for flight in flights.values():
		if flight.hand==hand: return true
	return false

func flying(e)->bool: return is_instance_valid(e.node) and flights.has(e.node.get_instance_id())

func launch(e,hand,measured:Vector3):
	if not is_instance_valid(hand): return
	# A hand recalls one exact entity; a second throw retires its previous tether.
	for previous in flights.values().duplicate():
		if previous.hand==hand: _home(previous)
	var cfg=e.components.returning_projectile
	var source=engine.game.camera if hand==engine.game.get("desktop_hand") else engine.game.aim_source(hand)
	var speed=float(cfg.get("speed",8))
	var velocity=measured.limit_length(speed) if measured.length()>.65 else -source.global_basis.z*speed+Vector3.UP*.15
	velocity=velocity.limit_length(speed)
	e.node.freeze=true; e.node.collision_layer=0; e.node.collision_mask=0; e.node.linear_velocity=Vector3.ZERO
	var flight={"id":e.node.get_instance_id(),"entry":e,"hand":hand,"config":cfg,"velocity":velocity,"mode":"outbound","age":0.0,"bounces":0,"hits":{},"camera":engine.game.camera.global_position}
	flights[e.node.get_instance_id()]=flight
	engine._emit(e.owner,"projectile_thrown",e.id,{"speed":velocity.length()})
	engine._notice("Release to throw · empty-hand trigger / click recalls this creation.")

func recall(hand)->bool:
	if not free_hand(hand): return false
	for flight in flights.values():
		if flight.hand==hand:
			_return(flight); return true
	return false

func grabbed(e):
	if not flying(e): return
	flights.erase(e.node.get_instance_id())
	e.node.collision_mask=9

func retire(result):
	for flight in flights.values().duplicate():
		if flight.entry.get("owner")==result: _forget(flight)

func _forget(flight):
	flights.erase(flight.id)

func _home(flight):
	var e=flight.entry; _forget(flight)
	if not is_instance_valid(e.node) or not e.get("owner",{}).get("active",false): return
	e.node.position=e.home; e.node.rotation=Vector3.ZERO
	e.node.freeze=false; e.node.collision_layer=8; e.node.collision_mask=9
	e.node.linear_velocity=Vector3.ZERO; e.node.angular_velocity=Vector3.ZERO
	engine._emit(e.owner,"projectile_home",e.id)

func _return(flight):
	if flight.mode=="returning": return
	flight.mode="returning"
	flight.entry.node.freeze=true; flight.entry.node.collision_layer=0; flight.entry.node.collision_mask=0
	engine._emit(flight.entry.owner,"projectile_recalled",flight.entry.id)

func tick(delta):
	for flight in flights.values().duplicate():
		var e=flight.entry
		if not is_instance_valid(e.node) or not e.get("owner",{}).get("active",false): _forget(flight); continue
		if not is_instance_valid(flight.hand): _home(flight); continue
		if engine._held_entry(e): grabbed(e); continue
		if flight.camera.distance_to(engine.game.camera.global_position)>15: _home(flight); continue
		flight.camera=engine.game.camera.global_position
		flight.age+=delta
		if flight.age>16 or e.node.global_position.distance_to(e.owner.root.to_global(e.home))>100 or e.node.global_position.y < -30: _home(flight); continue
		if flight.age>=float(flight.config.get("returnAfter",3)): _return(flight)
		var remaining=delta
		while remaining>.00001 and flying(e):
			var step=minf(remaining,.02); remaining-=step; _step(flight,step)
		if flying(e): e.mesh.rotate_y(delta*15)

func _step(flight,delta):
	var e=flight.entry
	if flight.mode=="parked": return
	if flight.mode=="returning":
		if not free_hand(flight.hand): _home(flight); return
		var difference:Vector3=flight.hand.global_position-e.node.global_position
		if difference.length()<.24:
			var hand=flight.hand; _forget(flight)
			e.node.global_position=hand.global_position; e.node.collision_mask=9
			engine._hold_entry(e,hand)
			engine._emit(e.owner,"projectile_caught",e.id)
			return
		e.node.global_position+=difference.normalized()*minf(difference.length(),float(flight.config.get("returnSpeed",12))*delta)
		return
	flight.velocity+=Vector3.DOWN*float(flight.config.get("gravity",1))*delta
	flight.velocity=flight.velocity.limit_length(20)
	var start:Vector3=e.node.global_position; var finish:Vector3=start+flight.velocity*delta
	var query=PhysicsRayQueryParameters3D.create(start,finish,13)
	var exclude:Array[RID]=[e.node.get_rid()]
	for h in engine.held.values():
		if is_instance_valid(h.entry.node): exclude.append(h.entry.node.get_rid())
	query.exclude=exclude
	var hit=engine.game.get_world_3d().direct_space_state.intersect_ray(query)
	if hit.is_empty(): e.node.global_position=finish; return
	e.node.global_position=hit.position+hit.normal*.04
	var identity=hit.collider.get_instance_id()
	if not flight.hits.has(identity):
		flight.hits[identity]=true
		var detail={"position":[hit.position.x,hit.position.y,hit.position.z],"speed":flight.velocity.length()}
		engine._emit(e.owner,"projectile_hit",e.id,detail)
		var event=str(flight.config.get("hitEvent","projectile_hit"))
		if event!="projectile_hit": engine._emit(e.owner,event,e.id,detail)
	match str(flight.config.get("collision","return")):
		"return": _return(flight)
		"bounce":
			flight.bounces+=1; flight.velocity=flight.velocity.bounce(hit.normal)*float(flight.config.get("restitution",.5))
			if flight.bounces>=4 or flight.velocity.length()<1: _return(flight)
		"stop":
			flight.mode="parked"; e.node.freeze=false; e.node.collision_layer=8; e.node.collision_mask=9; e.node.linear_velocity=Vector3.ZERO
