extends Node
## Versioned creation loader: validate -> stage -> activate -> acknowledge.
## New scripts are never executed. Immutable declarative programs select registered primitives.
const SAVE="user://living_world.json"
const MAX_PACKAGES=16
const MAX_ENTITIES=192
var game
var components
var museum
var active={}
var wanted={}
var staging={}
var failures={}
var snapshot={"history":[],"packages":[],"generation":0}
var local_events=[]
var events_queue=[]
var ack_queue=[]
var network_busy=false
var updating=false
var inspect_enabled=false
var inspect_cooldown=0.0
var next_save=0.0
var dirty=false
var cached_states={}
var version_states={}
var network_retry_at=0.0
var hand_originals={}
var hand_signature=""
var session_id=str(Time.get_unix_time_from_system())+"-"+str(OS.get_process_id())
var request_seq=0
var catalog={}
var last_operation={}

func setup(owner_game):
	game=owner_game
	components=preload("res://living_components.gd").new(); add_child(components); components.setup(game)
	museum=preload("res://living_museum.gd").new(); add_child(museum); museum.setup(game)
	if not game.diagnostic_offline and not game.smoke and FileAccess.file_exists(SAVE):
		var bytes=FileAccess.get_file_as_bytes(SAVE)
		if bytes.size()<=4*1024*1024:
			var saved=JSON.parse_string(bytes.get_string_from_utf8())
			if saved is Dictionary and int(saved.get("schema",0))==1:
				cached_states=saved.get("packages",{})
				version_states=saved.get("versionStates",{})
				for id in cached_states:
					var entry=cached_states[id]
					if entry is Dictionary and entry.get("manifest") is Dictionary: wanted[id]=entry.manifest
				print("LIVING_CACHE entries=",wanted.size())
	print("LIVING_READY manifest_schema=1 native_scripts=false")

func history()->Array: return snapshot.get("history",[])

func sync(data:Dictionary):
	if data.is_empty(): return
	if int(data.get("generation",0))<int(snapshot.get("generation",0)): return
	snapshot=data.duplicate(true); catalog=data.get("catalog",{})
	wanted.clear()
	for package in data.get("packages",[]):
		if package is Dictionary and package.get("id") is String: wanted[package.id]=package.duplicate(true)
	museum.sync(data)

func validate(package:Dictionary)->Array:
	var errors=[]
	if int(package.get("schema",0))!=1: errors.append("Unsupported creation schema")
	var id=str(package.get("id",""))
	var regex=RegEx.new(); regex.compile("^[a-z0-9][a-z0-9_-]{0,63}$")
	if regex.search(id)==null: errors.append("Invalid creation identifier")
	if int(package.get("version",0))<1: errors.append("Invalid creation version")
	if package.get("kind","") not in ["item","region","rule","device"]: errors.append("Unsupported creation kind")
	for field in ["scope","provenance"]:
		if not package.get(field,{}) is Dictionary: errors.append("Invalid "+field)
	if not package.get("dependencies",[]) is Array: errors.append("Invalid dependency list")
	else:
		for dep in package.get("dependencies",[]):
			if not dep is Dictionary or not dep.get("id") is String or not (dep.get("version") is int or dep.get("version") is float): errors.append("Invalid dependency")
	if not errors.is_empty(): return errors
	var entities=package.get("entities",[])
	if not entities is Array or entities.size()>64: errors.append("Creation entity budget exceeded"); return errors
	var ids={}; var bodies=0
	for entity in entities:
		if not entity is Dictionary: errors.append("Invalid entity"); continue
		var eid=str(entity.get("id",""))
		if regex.search(eid)==null or ids.has(eid): errors.append("Invalid or duplicate entity id")
		ids[eid]=true
		for field in ["position","size"]:
			var v=entity.get(field,[])
			if not v is Array or v.size()!=3: errors.append("Invalid entity "+field); continue
			for n in v:
				if not (n is float or n is int) or not is_finite(float(n)) or absf(float(n))>4096: errors.append("Non-finite or excessive geometry")
		if entity.get("size") is Array and entity.size.size()==3:
			for n in entity.size:
				if (n is float or n is int) and (float(n)<0.015 or float(n)>128): errors.append("Invalid entity size")
		if not entity.get("components",[]) is Array: errors.append("Invalid component list"); continue
		if entity.get("shape","") not in ["box","sphere","cylinder"]: errors.append("Unknown entity shape")
		if not entity.get("static",true) or entity.get("components",[]).any(func(c):return c is Dictionary and c.get("type","")=="grabbable"): bodies+=1
		for component in entity.get("components",[]):
			if not component is Dictionary or not component.get("config",{}) is Dictionary: errors.append("Invalid component"); continue
			if component.get("type","")=="embodiment":
				var config=component.get("config",{}); var scope=package.get("scope",{})
				if scope.get("targetId","")!="player" or scope.get("kind","") not in ["instance","world"]: errors.append("Embodiment requires explicit player scope")
				for key in config:
					if key=="handColor":
						if not config[key] is String or not Color.html_is_valid(config[key]): errors.append("Invalid hand colour")
					elif key in ["handScale","fingerCurl","moveSpeed"]:
						if not (config[key] is float or config[key] is int): errors.append("Invalid embodiment number"); continue
						var limits={"handScale":[0.75,1.25],"fingerCurl":[0.5,1.4],"moveSpeed":[0.5,4.0]}[key]
						if not is_finite(float(config[key])) or config[key]<limits[0] or config[key]>limits[1]: errors.append("Embodiment setting outside limits")
					else: errors.append("Unsupported embodiment setting")
	if bodies>16: errors.append("Physics body budget exceeded")
	return errors

func _held(result:Dictionary)->bool:
	for entity in result.get("entities",{}).values():
		var node=entity.get("node") if entity is Dictionary else entity
		if not is_instance_valid(node): continue
		if node in game.held.values() or game.grips.is_stowed(node): return true
	if components.has_method("is_busy") and components.is_busy(result): return true
	return false

func _occupied_region(result:Dictionary)->bool:
	var manifest=result.get("manifest",{})
	if manifest.get("kind","")!="region": return false
	var region=manifest.get("region",{})
	var origin=_v(region.get("origin",[0,0,0])); var size=_v(region.get("size",[1,1,1]))
	var point=game.camera.global_position-origin
	return absf(point.x)<size.x*0.5+1 and absf(point.z)<size.z*0.5+1 and absf(point.y)<maxf(size.y,12.0)

func tick(delta):
	components.tick(delta); museum.tick(delta)
	_apply_embodiment()
	if not updating:
		for id in active.keys():
			if wanted.has(id): continue
			if _held(active[id]) or _occupied_region(active[id]):
				_ack({"id":id,"version":0},"deferred","Release this creation or leave its region before archiving."); continue
			_retire(id); break
		for id in wanted:
			var package=wanted[id]
			if active.has(id) and int(active[id].manifest.version)==int(package.version):
				_ack(package,"applied","Creation active in this session."); continue
			if failures.has(_token(package)): continue
			var manifest_errors=validate(package)
			if not manifest_errors.is_empty(): _reject(package,_token(package),manifest_errors); continue
			var group=_transaction_group(id)
			var blocked=false
			for member in group:
				if failures.has(_token(member)): blocked=true
				if active.has(member.id) and (_held(active[member.id]) or _occupied_region(active[member.id])): blocked=true
				for dep in member.get("dependencies",[]):
					var internal=group.any(func(p):return p.id==dep.id and int(p.version)==int(dep.version))
					if not internal and (not active.has(dep.id) or int(active[dep.id].manifest.version)!=int(dep.version)): blocked=true
			if blocked:
				for member in group:
					if not failures.has(_token(member)): _ack(member,"deferred","Waiting for dependencies, or for you to release the old creation and leave its region.")
				continue
			updating=true; _stage_group.call_deferred(group); break

	for id in snapshot.get("deployments",{}):
		if int(snapshot.deployments[id].get("version",-1))==0 and not active.has(id): _ack({"id":id,"version":0},"applied","Creation archived; its history remains available.")
	if (dirty or not active.is_empty()) and game.elapsed>next_save: _save(); next_save=game.elapsed+8
	if not game.diagnostic_offline and not network_busy and game.elapsed>=network_retry_at and (not ack_queue.is_empty() or not events_queue.is_empty()): _flush.call_deferred()

func _token(package)->String:
	return str(package.id)+":"+str(package.version)+":"+str(snapshot.get("generation",0))

func _transaction_group(id)->Array:
	var transaction=str(snapshot.get("deployments",{}).get(id,{}).get("transactionId", ""))
	if transaction in ["", "<null>"]: return [wanted[id].duplicate(true)]
	var group=[]
	for candidate in wanted:
		if str(snapshot.get("deployments",{}).get(candidate,{}).get("transactionId",""))==transaction:
			group.append(wanted[candidate].duplicate(true))
	return group

func _stage_group(group:Array):
	var started=Time.get_ticks_usec()
	var replacements={}; var errors=[]
	for package in group:
		errors.append_array(validate(package)); replacements[package.id]=package
	if not errors.is_empty():
		for package in group: _reject(package,_token(package),errors)
		return
	var future={}
	for id in active: future[id]=active[id].manifest
	future.merge(replacements,true)
	var count=0; var dynamic_count=0
	for package in future.values():
		count+=package.entities.size()
		for entity in package.entities:
			if not entity.get("static",true) or entity.get("components",[]).any(func(c):return c.get("type","")=="grabbable"): dynamic_count+=1
		for dep in package.get("dependencies",[]):
			if not future.has(dep.id) or int(future[dep.id].version)!=int(dep.version): errors.append("Dependency version conflict")
	if count>MAX_ENTITIES or future.size()>MAX_PACKAGES or dynamic_count>32: errors.append("Active world budget reached; archive a test package first.")
	if not errors.is_empty():
		for package in group: _reject(package,_token(package),errors)
		return
	var prepared={}
	for package in group:
		var container=Node3D.new(); add_child(container); container.name="Staging_"+package.id; container.hide()
		var build_package=package.duplicate(true)
		for entity in build_package.entities: entity.components=entity.get("components",[]).filter(func(c):return c.get("type","")!="embodiment")
		var built=components.build(build_package,container)
		if not built is Dictionary or not built.get("errors",[]).is_empty() or not is_instance_valid(built.get("root")):
			errors=built.get("errors",["Creation builder returned no world"]) if built is Dictionary else ["Invalid builder result"]
			if errors.is_empty(): errors=["Creation builder returned no world"]
			container.queue_free(); break
		built["manifest"]=package; built["container"]=container; prepared[package.id]=built
		for eid in built.get("entities",{}):
			var entity=built.entities[eid]; var node=entity.get("node") if entity is Dictionary else entity
			if is_instance_valid(node): node.set_meta("living_package",package.id); node.set_meta("living_entity",eid); node.set_meta("living_version",package.version)
		var saved=version_states.get(package.id+":"+str(package.version),cached_states.get(package.id,{}))
		if int(saved.get("version",0))==int(package.version) and components.has_method("restore"): components.restore(built,saved.get("state",{}))
	if not errors.is_empty():
		for built in prepared.values(): built.container.queue_free()
		for package in group: _reject(package,_token(package),errors)
		return
	await get_tree().process_frame
	var cancelled=false
	for package in group:
		if not wanted.has(package.id) or int(wanted[package.id].version)!=int(package.version): cancelled=true
		if active.has(package.id) and (_held(active[package.id]) or _occupied_region(active[package.id])): cancelled=true
	if cancelled:
		for built in prepared.values(): built.container.queue_free()
		for package in group: _ack(package,"deferred","Previous version is in use, or a newer request arrived.")
		updating=false; return
	# All construction and validation precedes a single non-yielding transaction.
	var previous={}
	for id in prepared:
		if active.has(id): previous[id]=active[id]; components.deactivate(active[id])
	var success=true
	for built in prepared.values():
		if not components.activate(built): success=false; break
	if not success:
		for built in prepared.values(): components.deactivate(built); built.container.queue_free()
		for old in previous.values(): components.activate(old)
		for package in group: _reject(package,_token(package),["Activation refused; previous versions restored"])
		return
	for id in prepared:
		var built=prepared[id]; var package=built.manifest
		active[id]=built; built.container.show()
		if previous.has(id): _preserve_state(previous[id]); previous[id].container.queue_free()
		_ack(package,"applied","Creation active in this session.")
		record_event(package.id,"version_applied",{"version":package.version,"milliseconds":float(Time.get_ticks_usec()-started)/1000})
		print("LIVING_APPLIED id=",package.id," version=",package.version," ms=",float(Time.get_ticks_usec()-started)/1000)
	dirty=true; updating=false
	_save()
	game._notice(str(group[0].name)+( " and its companion creations" if group.size()>1 else "")+" · ready.",5)

func _reject(package,token,errors):
	failures[token]=errors; _ack(package,"rejected","; ".join(errors))
	game._notice("Brann kept the working version: "+str(errors[0]),6)
	print("LIVING_REJECTED id=",package.get("id")," errors=",errors)
	updating=false

func _retire(id):
	var old=active[id]; _preserve_state(old); components.deactivate(old); old.container.queue_free(); active.erase(id); dirty=true
	_ack({"id":id,"version":0},"applied","Creation archived; its history remains available.")

func _preserve_state(result):
	# Child teardown clears cyclic entity dictionaries. Keep the last good snapshot.
	if result.get("entities",{}).is_empty() or not is_instance_valid(components): return
	var package=result.manifest
	var state=components.serialize(result) if components.has_method("serialize") else {}
	cached_states[package.id]={"manifest":package,"version":package.version,"state":state}
	version_states[package.id+":"+str(package.version)]={"version":package.version,"state":state}
	while version_states.size()>64: version_states.erase(version_states.keys()[0])

func _save():
	if game.diagnostic_offline or game.smoke: dirty=false; return
	for result in active.values(): _preserve_state(result)
	var save_packages={}
	for id in active:
		if cached_states.has(id): save_packages[id]=cached_states[id]
	var text=JSON.stringify({"schema":1,"packages":save_packages,"versionStates":version_states})
	if text.length()>4*1024*1024: push_warning("LIVING_SAVE exceeds budget"); return
	var file=FileAccess.open(SAVE+".tmp",FileAccess.WRITE)
	if file==null: push_warning("LIVING_SAVE cannot open temporary file"); return
	file.store_string(text); file.close()
	var error=DirAccess.rename_absolute(SAVE+".tmp",SAVE)
	if error!=OK: push_warning("LIVING_SAVE replacement failed "+str(error)); return
	dirty=false

func _exit_tree():
	if game!=null: _save()

func _ack(package,status,reason):
	var ack={"id":package.id,"version":package.version,"generation":int(snapshot.get("deployments",{}).get(package.id,{}).get("generation",snapshot.get("generation",0))),"status":status,"reason":reason,"clientId":session_id}
	var key=JSON.stringify(ack)
	if last_operation.get("ack:"+package.id,"")==key: return
	last_operation["ack:"+package.id]=key
	if OS.get_cmdline_user_args().has("--playful-demo"):
		if not snapshot.has("deployments"): snapshot["deployments"]={}
		snapshot.deployments[package.id]=ack.duplicate(true)
		_demo_archive_sync()
	ack_queue.append(ack)
	if ack_queue.size()>64: ack_queue.pop_front()

func _flush():
	if network_busy: return
	network_busy=true
	var is_ack=not ack_queue.is_empty()
	var payload=ack_queue.pop_front() if is_ack else events_queue.pop_front()
	var response=await game._request("/api/vr/living/"+("ack" if is_ack else "event"),payload)
	if response.has("error"):
		print("LIVING_NETWORK ",str(response.error)); network_retry_at=game.elapsed+3
		if is_ack and response.get("transportError",false) and last_operation.get("ack:"+str(payload.id),"")==JSON.stringify(payload) and int(payload.get("generation",0))==int(snapshot.get("deployments",{}).get(payload.id,{}).get("generation",snapshot.get("generation",0))): ack_queue.append(payload)
	network_busy=false

func _request_id()->String:
	request_seq+=1; return "native-"+session_id+"-"+str(request_seq)

func publish(package:Dictionary):
	if game.diagnostic_offline:
		wanted[package.id]=package.duplicate(true); _demo_archive_sync(); return {"status":"staged"}
	var response=await game._request("/api/vr/living/publish",{"package":package,"requestId":_request_id()})
	if response.has("error"): game._notice(str(response.error),6)
	else: game._notice("Brann is preparing "+str(package.name)+".",4); await game._poll()
	return response

func rollback(id:String,version:int):
	if game.diagnostic_offline:
		if version==0: wanted.erase(id); _demo_archive_sync(); return {"status":"staged"}
		for entry in history():
			if entry.get("id","")==id and int(entry.get("version",0))==version: wanted[id]=entry; return {"status":"staged"}
		return {"error":"Version unavailable"}
	var response=await game._request("/api/vr/living/rollback",{"id":id,"version":version,"requestId":_request_id()})
	if response.has("error"): game._notice(str(response.error),6)
	else: await game._poll()
	return response

func request_version(entry:Dictionary):
	var id=str(entry.get("id",""))
	if entry.get("kind","")=="legacy" or entry.has("modelUrl"):
		if game.imported.has(id):
			var returned=game.collection.return_item(id)
			game._notice("That exact version is at its named collection stand." if returned else "That version is held, holstered, or still arriving. Release it before recalling it.",5)
		else:
			var spec=entry.get("spec",entry).duplicate(true)
			for known in game.state.get("items",[]):
				if str(known.id)==id: spec=known.duplicate(true); break
			spec.id=id; spec.name=entry.get("name",spec.get("name","Historical invention")); spec.description=spec.get("description","")
			spec.modelUrl=entry.get("modelUrl",spec.get("modelUrl",""))
			if not str(spec.modelUrl).is_empty(): game._import_item(spec)
		return
	await rollback(id,int(entry.get("version",1)))

func record_event(entity,event:String,detail={}):
	var package_id=""; var entity_id=""
	if entity is Node:
		package_id=str(entity.get_meta("living_package","")); entity_id=str(entity.get_meta("living_entity",""))
	elif entity is String: package_id=entity
	elif entity is Dictionary: package_id=str(entity.get("packageId","")); entity_id=str(entity.get("entityId",""))
	var record={"packageId":package_id,"entityId":entity_id,"event":event,"detail":detail}
	local_events.append(record)
	if local_events.size()>80: local_events.pop_front()
	if not game.diagnostic_offline: events_queue.append(record)
	if events_queue.size()>64: events_queue.pop_front()
	dirty=true

func busy(hand)->bool: return components.busy(hand) if components.has_method("busy") else false
func claims_trigger(hand)->bool: return components.claims_trigger(hand)
func try_grab(hand)->bool: return components.try_grab(hand)
func release(hand)->bool: return components.release(hand)
func trigger(hand,target=null)->bool:
	if museum.trigger(hand,target): return true
	if inspect_enabled:
		var info=inspect_ray(hand)
		if not info.is_empty():
			game._notice(str(info.get("name","Creation"))+"\n"+str(info.get("prompt",info.get("summary","No recorded prompt for this original scenery."))),8)
		return true
	return components.trigger(hand,target)

func inspect_ray(hand)->Dictionary:
	var hit=game._ray(game.aim_source(hand) if hand is XRController3D else game.camera,8)
	if hit.is_empty(): return {}
	var target=game._owner(hit.collider)
	if target==null: return {}
	var data=components.inspect(target)
	if not data is Dictionary: data={}
	var id=str(target.get_meta("living_package",""))
	if active.has(id):
		var package=active[id].manifest
		data.merge({"name":package.name,"version":package.version,"prompt":package.get("provenance",{}).get("prompt",""),"provenance":package.get("provenance",{}),"dependencies":package.get("dependencies",[])},true)
	else:
		var legacy_id=str(target.get_meta("id",""))
		for entry in history():
			if entry.get("id","")==legacy_id: data=entry.duplicate(true); data["prompt"]=entry.get("provenance",{}).get("prompt",""); break
	data["causes"]=local_events.filter(func(e):return e.packageId==id).slice(-6)
	return data

func visit_arena():
	if not active.has("living-climb-arena"): game._notice("Prepare the climbing arena first."); return false
	return safe_travel(Vector3(120,0,0))

func safe_travel(destination:Vector3)->bool:
	if not destination.is_finite() or destination.length()>5000: return false
	var space=game.get_world_3d().direct_space_state
	var floor_hit=space.intersect_ray(PhysicsRayQueryParameters3D.create(destination+Vector3.UP*3,destination-Vector3.UP*4,1))
	if floor_hit.is_empty() or floor_hit.normal.y<0.65: game._notice("That destination needs a clear landing."); return false
	var feet:Vector3=floor_hit.position+Vector3.UP*0.04
	var capsule=CapsuleShape3D.new(); capsule.radius=0.22; capsule.height=1.65
	var query=PhysicsShapeQueryParameters3D.new(); query.shape=capsule; query.collision_mask=1; query.transform=Transform3D(Basis.IDENTITY,feet+Vector3.UP*0.87)
	if not space.intersect_shape(query,1).is_empty(): game._notice("The landing is obstructed."); return false
	# Hidden region geometry still collides: reveal the zone owning a valid landing.
	var landing_node:Node=floor_hit.collider
	while landing_node!=null:
		var landing_zone=""
		for zone_id in game.adventure.zone_groups:
			if game.adventure.zone_groups[zone_id]==landing_node: landing_zone=str(zone_id); break
		if not landing_zone.is_empty():
			if game.adventure.zone!=landing_zone:
				game.adventure.zone=landing_zone
				game.adventure._apply_zone_environment(landing_zone)
			break
		landing_node=landing_node.get_parent()
	var offset:Vector3=game.camera.global_position-game.rig.global_position
	game.rig.global_position=feet-Vector3(offset.x,0,offset.z)
	game.tuning.history.clear(); game.adventure.motion.clear(); game.previous_tips.clear()
	game.item_actions.detach(); game.item_actions.falling=false
	if game.siegebird.extras!=null: game.siegebird.extras.rope.detach(false)
	return true

func _v(a)->Vector3: return Vector3(float(a[0]),float(a[1]),float(a[2]))

func _apply_embodiment():
	var config={}; var ids=active.keys(); ids.sort()
	for id in ids:
		for entity in active[id].manifest.get("entities",[]):
			for component in entity.get("components",[]):
				if component.get("type","")=="embodiment": config.merge(component.get("config",{}),true)
	var all_hands:Array=[]
	all_hands.append_array(game.hands)
	if game.desktop_hand!=null: all_hands.append(game.desktop_hand)
	var signature=JSON.stringify(config)+str(all_hands.size())
	if signature==hand_signature: return
	hand_signature=signature
	if config.has("moveSpeed"): game.tuning.runtime_overrides["locomotion.speed"]=float(config.moveSpeed)
	else: game.tuning.runtime_overrides.erase("locomotion.speed")
	for hand in all_hands:
		if not is_instance_valid(hand): continue
		hand.set_meta("living_curl",float(config.get("fingerCurl",1.0)))
		if not hand.has_meta("hand_visual"): continue
		var visual=hand.get_meta("hand_visual")
		if not is_instance_valid(visual): continue
		var key=str(hand.get_instance_id())
		if not hand_originals.has(key):
			var meshes=[]
			for mesh in visual.find_children("*","MeshInstance3D",true,false): meshes.append({"node":mesh,"material":mesh.material_override})
			hand_originals[key]={"scale":visual.scale,"meshes":meshes}
		var original=hand_originals[key]
		visual.scale=original.scale*float(config.get("handScale",1.0))
		for entry in original.meshes:
			if not is_instance_valid(entry.node): continue
			if config.has("handColor") and entry.material is StandardMaterial3D:
				var material=entry.material.duplicate(); material.albedo_color=Color(config.handColor); entry.node.material_override=material
			else: entry.node.material_override=entry.material

func _demo_archive_sync():
	if not OS.get_cmdline_user_args().has("--playful-demo"): return
	var records=snapshot.get("history",[]).duplicate(true)
	var keys={}
	for entry in records:
		var package=entry.get("package",entry)
		keys[str(package.id)+":"+str(int(package.version))]=true
	var packages=wanted.values().duplicate()
	for result in active.values(): packages.append(result.manifest)
	for package in packages:
		var key=str(package.id)+":"+str(int(package.version))
		if not keys.has(key): records.append(package.duplicate(true)); keys[key]=true
	snapshot["history"]=records
	snapshot["demoPackages"]=[]
	for filename in ["living_unfinished_lullaby.json","living_returning_demo.json"]:
		var package=JSON.parse_string(FileAccess.get_file_as_string("res://"+filename))
		if package is Dictionary: snapshot.demoPackages.append(package)
	museum.sync(snapshot)
