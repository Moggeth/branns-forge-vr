extends Node
## Versioned declarative mechanics. Mutations stay inside package-owned objects.
const TYPES=["grabbable","material","emitter","sensor","reservoir","receiver","creature","field","climbable","grapple","portal","weakpoint","objective","maker","transformer","trigger","embodiment","returning_projectile"]
const OPS=["emit","heat","wet","power","move","scale","damage","repair","grow","cut","toggle","set_color","objective"]
const MATERIALS={"wood":{"ignition":180,"conductivity":.05,"absorption":.55,"hardness":1},"iron":{"ignition":1000,"conductivity":1,"absorption":0,"hardness":8},"crystal":{"ignition":1000,"conductivity":.9,"absorption":0,"hardness":5},"cloth":{"ignition":95,"conductivity":0,"absorption":1,"hardness":.4},"stone":{"ignition":1000,"conductivity":.05,"absorption":.1,"hardness":10}}
var game
var active:Array=[]
var held:Dictionary={}
var entries:Dictionary={}
var event_queue:Array=[]
var clock=0.0
var sense_clock=0.0
var sequence=0
var debris:Array=[]
var gravity_velocity=0.0
var field_falling=false
var stimuli:Array=[]
var light_root:Node3D
var light_pool:Array=[]
var projectiles=preload("res://living_projectiles.gd").new()

func setup(g):
	game=g
	projectiles.setup(self)
	light_root=Node3D.new(); light_root.name="LivingLightPool"; game.add_child(light_root)
	for i in range(8):
		var light=OmniLight3D.new(); light.omni_range=3; light.light_energy=0; light.shadow_enabled=false; light_root.add_child(light); light_pool.append(light)

func _exit_tree():
	if is_instance_valid(light_root): light_root.queue_free()

func vec(a,fallback=Vector3.ZERO)->Vector3:
	if a is Vector3: return a
	if a is Array and a.size()==3: return Vector3(float(a[0]),float(a[1]),float(a[2]))
	return fallback

func build(package:Dictionary,parent:Node3D)->Dictionary:
	var root=Node3D.new(); root.name="Living_"+str(package.get("id","package")); parent.add_child(root)
	root.position=vec(package.get("region",{}).get("origin",[0,0,0]))
	root.set_meta("living_package",str(package.get("id","")))
	var result={"root":root,"entities":{},"errors":[],"package":package.duplicate(true),"links":[],"active":false,"joints":[],"version":int(package.get("version",1))}
	result.errors=preload("res://living_component_schema.gd").validate(package)
	if not result.errors.is_empty(): root.hide(); return result
	for spec in package.get("entities",[]):
		var id=str(spec.get("id",""))
		if id.is_empty() or result.entities.has(id): result.errors.append("Missing or duplicate entity id "+id); continue
		var components={}
		for component in spec.get("components",[]):
			var type=str(component.get("type",""))
			if type not in TYPES: result.errors.append("Unsupported component "+type)
			components[type]=component.get("config",{}).duplicate(true)
		var show_details=not components.is_empty()
		var properties=MATERIALS.get(str(spec.get("material","wood")),MATERIALS.wood).duplicate(true)
		properties.merge(components.get("material",{}),true); components["material"]=properties
		var dynamic=components.has("grabbable") or not bool(spec.get("static",true))
		var node:PhysicsBody3D=RigidBody3D.new() if dynamic else StaticBody3D.new()
		node.name=id; root.add_child(node); node.position=vec(spec.get("position",[0,0,0])); node.collision_layer=0; node.collision_mask=0
		if node is RigidBody3D: node.freeze=true; node.mass=clampf(float(components.get("grabbable",{}).get("mass",1)),.05,20); node.continuous_cd=true
		var size=vec(spec.get("size",[.3,.3,.3]),Vector3.ONE*.3).clamp(Vector3.ONE*.015,Vector3.ONE*128)
		var shape:Shape3D; var mesh:Mesh
		match str(spec.get("shape","box")):
			"box": shape=BoxShape3D.new(); shape.size=size; mesh=BoxMesh.new(); mesh.size=size
			"sphere":
				shape=SphereShape3D.new(); shape.radius=size.x*.5; mesh=SphereMesh.new(); mesh.radius=size.x*.5; mesh.height=size.x; mesh.radial_segments=16; mesh.rings=8
			"cylinder":
				shape=CylinderShape3D.new(); shape.radius=size.x*.5; shape.height=size.y; mesh=CylinderMesh.new(); mesh.top_radius=size.x*.5; mesh.bottom_radius=size.x*.5; mesh.height=size.y; mesh.radial_segments=16
			_: result.errors.append("Unsupported shape on "+id); node.queue_free(); continue
		var collision=CollisionShape3D.new(); collision.shape=shape; node.add_child(collision)
		var visual=MeshInstance3D.new(); visual.mesh=mesh; node.add_child(visual)
		var material=_mat(str(spec.get("color","aa8866"))); visual.material_override=material
		node.set_meta("living_package",str(package.get("id",""))); node.set_meta("living_entity",id)
		node.set_meta("kind","floor" if not dynamic and size.x>2 and size.z>2 and size.y<1 else "solid")
		var reservoir=components.get("reservoir",{})
		var entry={"id":id,"node":node,"mesh":visual,"material":material,"components":components,"spec":spec,"owner":result,"home":node.position,"size":size,"base_color":material.albedo_color,"shape":collision,"state":{"heat":0.0,"wet":0.0,"power":float(components.get("receiver",{}).get("power",0)),"integrity":100.0,"burning":false,"amount":float(reservoir.get("amount",0)),"count":0,"complete":false,"enabled":true,"growth":1.0,"last_emit":-99.0,"last_sense":false,"memory":{},"cooldown":0.0},"recording":false,"samples":[],"replay":-1.0}
		result.entities[id]=entry
		if show_details: _decorate(entry)
	for link in package.get("links",[]):
		if not result.entities.has(str(link.get("from",""))) or not result.entities.has(str(link.get("to",""))): result.errors.append("Unresolved link "+str(link.get("id",""))); continue
		if str(link.get("type","")) not in ["signal","energy","fluid","tether","hinge"]: result.errors.append("Unsupported link type"); continue
		var line=MeshInstance3D.new(); line.mesh=BoxMesh.new(); line.material_override=_mat("d6ba74"); root.add_child(line)
		result.links.append({"spec":link.duplicate(true),"line":line,"from":result.entities[link.from],"to":result.entities[link.to],"joint":null,"active":true})
	for rule in package.get("rules",[]):
		for action in rule.get("actions",[]):
			if str(action.get("op","")) not in OPS: result.errors.append("Unsupported rule action "+str(action.get("op","")))
	root.tree_exiting.connect(func(): _dispose(result))
	root.hide(); return result

func _dispose(result):
	projectiles.retire(result)
	# Dictionary owner references are cyclic; sever them when the owning scene exits.
	for e in result.entities.values():
		if is_instance_valid(e.node): entries.erase(e.node.get_instance_id())
		e.erase("owner"); e.erase("selected")
	result.entities.clear(); result.links.clear(); result.joints.clear()
	active.erase(result)
	for i in range(event_queue.size()-1,-1,-1):
		if event_queue[i].owner==result: event_queue.remove_at(i)

func _mat(color:String)->StandardMaterial3D:
	var m=StandardMaterial3D.new(); m.albedo_color=Color(color); m.roughness=.7; return m

func _decorate(e):
	var c=e.components; var s=e.size
	if c.has("returning_projectile") and str(c.returning_projectile.get("appearance","plain")) in ["ember_ring","wood_ring"]:
		var torus=TorusMesh.new(); torus.inner_radius=s.x*.32; torus.outer_radius=s.x*.5; torus.rings=16; torus.ring_segments=6
		e.mesh.mesh=torus
		if c.returning_projectile.appearance=="ember_ring": e.material.emission_enabled=true; e.material.emission=e.base_color; e.material.emission_energy_multiplier=.55
	if c.has("portal"):
		e.material.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA; e.base_color.a=.45; e.material.albedo_color=e.base_color; e.material.emission_enabled=true; e.material.emission=e.base_color; e.material.emission_energy_multiplier=.55
	if c.has("receiver") or c.has("emitter") or c.has("material"):
		# Virtual requests share eight native lights across the entire live workshop.
		e.light={"light_color":Color("ffad65"),"light_energy":0.0}
	if c.has("reservoir"):
		e.material.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA; e.base_color.a=.3; e.material.albedo_color=e.base_color
		var fill=MeshInstance3D.new(); fill.mesh=BoxMesh.new(); fill.mesh.size=Vector3(s.x*.75,s.y*.7,s.z*.75); fill.material_override=_mat("53bfd1"); e.node.add_child(fill); e.fill=fill
	if c.has("material") and float(c.material.get("ignition",1000))<1000:
		var flame=MeshInstance3D.new(); var cone=CylinderMesh.new(); cone.top_radius=.005; cone.bottom_radius=minf(.2,s.x*.6); cone.height=minf(.7,s.y*.6); cone.radial_segments=7; flame.mesh=cone
		var flame_material=_mat("ffac4d"); flame_material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED; flame.material_override=flame_material; flame.position.y=s.y*.5+cone.height*.3; e.node.add_child(flame); flame.hide(); e.flame=flame
	if c.has("creature"):
		for x in [-.22,.22]:
			var eye=MeshInstance3D.new(); var sphere=SphereMesh.new(); sphere.radius=maxf(.025,s.x*.065); sphere.height=sphere.radius*2; eye.mesh=sphere; eye.material_override=_mat("ffe0a2"); e.node.add_child(eye); eye.position=Vector3(x*s.x,s.y*.22,-s.z*.5)
	if c.has("field"):
		var field=MeshInstance3D.new(); var sphere=SphereMesh.new(); sphere.radius=float(c.field.get("radius",2)); sphere.height=sphere.radius*2; sphere.radial_segments=24; sphere.rings=12; field.mesh=sphere
		var m=_mat("80bfc9"); m.transparency=BaseMaterial3D.TRANSPARENCY_ALPHA; m.albedo_color.a=.055; m.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED; m.cull_mode=BaseMaterial3D.CULL_DISABLED; field.material_override=m; field.cast_shadow=GeometryInstance3D.SHADOW_CASTING_SETTING_OFF; e.node.add_child(field)
	if c.has("grapple") or c.has("maker"):
		var line=MeshInstance3D.new(); line.mesh=BoxMesh.new(); line.material_override=_mat("e4c987"); e.owner.root.add_child(line); line.hide(); e.line=line
	var label=Label3D.new(); label.text=str(e.spec.get("name",e.id))+"\n"+_hint(e); label.font_size=25; label.pixel_size=.0028; label.width=450; label.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART; label.position=Vector3(0,s.y*.5+.18,0); label.billboard=BaseMaterial3D.BILLBOARD_ENABLED; label.no_depth_test=false; label.modulate=Color("f1dec1"); e.node.add_child(label); label.hide(); e.label=label

func _hint(e)->String:
	var c=e.components
	if c.has("returning_projectile"): return "Grip / E: take · release / E: throw\nEmpty-hand trigger / click: recall"
	if c.has("portal"): return "Point + trigger: travel"
	if c.has("grapple"): return "Grip tool · trigger: attach / detach\nHold trigger: reel · release grip: let go"
	if c.has("maker"): return {"record":"Grip · trigger: record / replay gesture","join":"Grip · point + trigger: select two objects to hinge","paint":"Grip · point + trigger: paint a climbing surface"}.get(str(c.maker.get("mode","record")),"")
	if c.has("transformer"): return "Grip · point + trigger: "+str(c.transformer.get("operation","repair"))
	if c.has("climbable"): return "Grip surface · pull yourself up"
	if c.has("grabbable"): return "Grip to hold · release to throw"
	if c.has("objective"): return "Challenge: "+str(c.objective.get("event","triggered"))
	if c.has("trigger"): return "Point + trigger: activate"
	if c.has("receiver"): return "Receives linked power / signals"
	return "Point + trigger: inspect / interact"

func activate(result:Dictionary)->bool:
	if not result.errors.is_empty(): return false
	if result.active: return true
	result.active=true; active.append(result); result.root.show()
	for e in result.entities.values():
		entries[e.node.get_instance_id()]=e; e.node.collision_layer=8 if e.node is RigidBody3D else 5; e.node.collision_mask=9 if e.node is RigidBody3D else 0
		if e.node is RigidBody3D: e.node.freeze=false
	for link in result.links:
		if str(link.spec.type)=="hinge": _hinge(link,result)
	_emit(result,"activated",""); return true

func deactivate(result:Dictionary):
	for key in held.keys():
		if held[key].entry.owner==result: _release_key(key,false)
	projectiles.retire(result)
	for e in result.entities.values():
		entries.erase(e.node.get_instance_id()); e.node.collision_layer=0; e.node.collision_mask=0
		if e.node is RigidBody3D: e.node.freeze=true
		if e.has("tether"): _detach(e)
	for joint in result.joints:
		if is_instance_valid(joint): joint.queue_free()
	result.joints.clear(); result.active=false; active.erase(result); result.root.hide()

func is_busy(result:Dictionary)->bool:
	for h in held.values():
		if h.entry.owner==result: return true
	for e in result.entities.values():
		if e.recording or e.has("tether"): return true
	return false

func busy(hand)->bool: return held.has(str(hand.get_instance_id()))
func claims_trigger(hand)->bool: return busy(hand) or projectiles.claims_trigger(hand)

func serialize(result:Dictionary)->Dictionary:
	var data={}
	for id in result.entities:
		var e=result.entities[id]; var p=e.home if projectiles.flying(e) else e.node.position; var r=Vector3.ZERO if projectiles.flying(e) else e.node.rotation
		var scale_value=e.node.scale
		data[id]={"state":e.state.duplicate(true),"position":[p.x,p.y,p.z],"rotation":[r.x,r.y,r.z],"scale":[scale_value.x,scale_value.y,scale_value.z],"color":e.base_color.to_html(),"climbable":e.components.has("climbable"),"samples":e.samples.duplicate(true)}
	var joined=[]
	for link in result.links:
		if str(link.spec.id).begins_with("joined_"): joined.append(link.spec.duplicate(true))
	return {"schema":1,"entities":data,"joined":joined}

func restore(result:Dictionary,data:Dictionary):
	for id in data.get("entities",{}):
		if not result.entities.has(id): continue
		var saved=data.entities[id]; var e=result.entities[id]
		for key in e.state:
			if saved.get("state",{}).has(key): e.state[key]=saved.state[key]
		e.node.position=vec(saved.get("position"),e.home); e.node.rotation=vec(saved.get("rotation")); e.node.scale=vec(saved.get("scale"),Vector3.ONE*float(e.state.get("growth",1))).clamp(Vector3.ONE*.1,Vector3.ONE*2)
		e.state.last_emit=-99.0; e.state.cooldown=0.0
		if not e.state.memory.is_empty(): e.state.memory.time=clock
		if saved.get("color","") is String and Color.html_is_valid(saved.get("color","")): e.base_color=Color(saved.color)
		if saved.get("climbable",false): e.components["climbable"]={}
		e.samples=saved.get("samples",[]).slice(0,128)
		if e.samples.size()>1 and e.components.has("maker"): e.replay=0.0
	for spec in data.get("joined",[]).slice(0,16):
		if not spec is Dictionary or spec.get("type")!="hinge" or not result.entities.has(spec.get("from")) or not result.entities.has(spec.get("to")): continue
		var line=MeshInstance3D.new(); line.mesh=BoxMesh.new(); line.material_override=_mat("d6ba74"); result.root.add_child(line)
		var link={"spec":spec.duplicate(true),"line":line,"from":result.entities[spec.from],"to":result.entities[spec.to],"joint":null,"active":true}; result.links.append(link)
		sequence=maxi(sequence,int(str(spec.get("id","joined_0")).trim_prefix("joined_"))+1)
		if result.active: _hinge(link,result)

func inspect(target)->Dictionary:
	var e=_entry(target)
	if e.is_empty(): return {}
	return {"packageId":str(e.owner.package.id),"entityId":e.id,"version":e.owner.version,"name":str(e.spec.get("name",e.id)),"components":e.components.keys(),"state":e.state.duplicate(true),"controls":_hint(e)}

func _entry(node)->Dictionary:
	while is_instance_valid(node) and node!=game:
		if entries.has(node.get_instance_id()): return entries[node.get_instance_id()]
		node=node.get_parent()
	return {}

func _notice(message:String):
	if game.has_method("_notice"): game._notice(message)

func _emit(result,event:String,id:String,detail:Dictionary={}):
	if event_queue.size()<128: event_queue.append({"owner":result,"event":event,"id":id,"detail":detail})
	if game.get("living")!=null and game.living.has_method("record_event"):
		var entity=result.entities.get(id,{})
		game.living.record_event(entity.get("node",result.root),event,detail)

func trigger(hand,target)->bool:
	var key=str(hand.get_instance_id()); var h=held.get(key,{})
	if h.is_empty() and projectiles.recall(hand): return true
	if not h.is_empty() and not h.get("climbing",false):
		var entry=h.entry
		if entry.components.has("returning_projectile") and not entry.components.has("trigger"):
			_notice(_hint(entry)); return true
		if entry.components.has("grapple"): _grapple(entry,hand); return true
		if entry.components.has("transformer"):
			var hit=_point(hand,8); var other=_entry(hit.get("collider"))
			if not other.is_empty(): _transform(other,str(entry.components.transformer.get("operation","repair")),float(entry.components.transformer.get("amount",1)))
			return true
		if entry.components.has("maker"): _maker(entry,hand); return true
		if entry.components.has("trigger"): target=entry.node
	var e=_entry(target)
	if e.is_empty(): return false
	if e.components.has("portal"):
		if clock<float(e.state.cooldown): return true
		e.state.cooldown=clock+1.0
		var destination=vec(e.components.portal.get("destination"))
		if game.get("living")!=null and game.living.has_method("safe_travel"):
			if game.living.safe_travel(destination): _emit(e.owner,"arrived",e.id); _notice("Through the portal · "+str(e.spec.get("name",e.id)))
			else: _notice("The destination is not safe to enter yet.")
		return true
	_emit(e.owner,"triggered",e.id)
	if e.components.has("trigger"):
		var event=str(e.components.trigger.get("event","triggered"))
		if event!="triggered": _emit(e.owner,event,e.id)
	if e.components.has("receiver") and not e.components.has("trigger"): e.state.enabled=not e.state.enabled
	if e.components.has("emitter"): _pulse(e)
	if e.components.has("transformer"): _transform(e,str(e.components.transformer.get("operation","repair")),float(e.components.transformer.get("amount",1)))
	_notice(str(e.spec.get("name",e.id))+" · "+_hint(e)); return true

func try_grab(hand)->bool:
	var key=str(hand.get_instance_id())
	if held.has(key): return true
	if not projectiles.free_hand(hand): return false
	var nearest={}; var distance=.22
	for e in entries.values():
		if not e.node.visible or not (e.components.has("grabbable") or e.components.has("climbable")): continue
		var local:Vector3=e.node.to_local(hand.global_position); var half:Vector3=e.size*.5
		var gap=local.distance_to(local.clamp(-half,half))
		if gap<distance and not _held_entry(e): nearest=e; distance=gap
	if nearest.is_empty() and hand==game.get("desktop_hand"):
		var source=game.camera; var query=PhysicsRayQueryParameters3D.create(source.global_position,source.global_position-source.global_basis.z*3,13)
		var hit=game.get_world_3d().direct_space_state.intersect_ray(query); var aimed=_entry(hit.get("collider"))
		if not aimed.is_empty() and aimed.components.has("returning_projectile") and not _held_entry(aimed):
			nearest=aimed; nearest.node.global_position=hand.global_position
	if nearest.is_empty(): return false
	return _hold_entry(nearest,hand)

func _hold_entry(nearest,hand)->bool:
	if not projectiles.free_hand(hand) or _held_entry(nearest): return false
	var key=str(hand.get_instance_id())
	projectiles.grabbed(nearest)
	var climb=nearest.components.has("climbable") and not nearest.components.has("grabbable")
	# Movable creations share the calibrated socket with authored tools. Keep
	# climbing and release motion sampled from the unfiltered controller.
	var attach_pose: Transform3D = hand.global_transform if climb else game.hand_socket(hand).global_transform
	held[key]={"entry":nearest,"hand":hand,"climbing":climb,"previous":hand.global_position,"velocity":Vector3.ZERO,"offset":attach_pose.affine_inverse()*nearest.node.global_transform}
	hand.set_meta("anchored_grip",true)
	if not climb:
		if nearest.node is RigidBody3D: nearest.node.freeze=true; nearest.node.linear_velocity=Vector3.ZERO
		nearest.node.collision_layer=0
	else: game.item_actions.falling=false
	_emit(nearest.owner,"grabbed",nearest.id); _notice(_hint(nearest)); return true

func _held_entry(e)->bool:
	for h in held.values():
		if h.entry==e: return true
	return false

func release(hand)->bool: return _release_key(str(hand.get_instance_id()))

func _release_key(key:String,throw_projectile=true)->bool:
	if not held.has(key): return false
	var h=held[key]; var e=h.entry; held.erase(key)
	var desktop=is_instance_valid(h.hand) and h.hand==game.desktop_hand
	var release_velocity:Vector3=(game.tuning.release_velocity(h.hand,true) if str(game.get("desktop_release_mode"))=="throw" else Vector3.ZERO) if desktop else h.velocity
	if is_instance_valid(h.hand): h.hand.set_meta("anchored_grip",false)
	if is_instance_valid(e.node):
		if h.climbing: game.item_actions.falling=true
		else:
			e.node.collision_layer=8 if e.node is RigidBody3D else 5
			if e.node is RigidBody3D:
				e.node.freeze=false; e.node.linear_velocity=release_velocity.limit_length(12)
				if desktop and str(game.get("desktop_release_mode"))!="throw": e.node.angular_velocity=Vector3.ZERO
		if e.has("tether"): _detach(e)
		if e.recording: e.recording=false; e.replay=0.0; _emit(e.owner,"recorded",e.id,{"samples":e.samples.size()})
		_emit(e.owner,"released",e.id)
		if throw_projectile and e.components.has("returning_projectile") and e.owner.active and (not desktop or str(game.get("desktop_release_mode"))=="throw"): projectiles.launch(e,h.hand,release_velocity)
	return true

func _point(hand,distance:float)->Dictionary:
	var source=game.aim_source(hand); var query=PhysicsRayQueryParameters3D.create(source.global_position,source.global_position-source.global_basis.z*distance,13)
	var excluded:Array[RID]=[]
	for h in held.values(): excluded.append(h.entry.node.get_rid())
	query.exclude=excluded
	return game.get_world_3d().direct_space_state.intersect_ray(query)

func _grapple(e,hand):
	if e.has("tether"): _detach(e); return
	var hit=_point(hand,float(e.components.grapple.get("range",25)))
	if hit.is_empty() or not hit.collider is StaticBody3D: _notice("Aim at a solid surface, then squeeze trigger."); return
	var landing=hit.normal.y>.7; var goal:Vector3=hit.position+hit.normal*.55-Vector3.UP*.9
	if landing: goal=hit.position+Vector3.UP*.04
	e.tether={"anchor":hit.collider,"local":hit.collider.to_local(hit.position),"goal":goal+(Vector3.UP if landing else Vector3.ZERO),"landing_goal":goal,"approach":landing,"landing":landing,"hand":hand}
	game.item_actions.falling=false; _emit(e.owner,"attached",e.id); _notice("Hook attached · hold trigger to reel; tap to detach")

func _detach(e):
	e.erase("tether")
	if e.has("line"): e.line.hide()
	game.item_actions.falling=true

func _maker(e,hand):
	var mode=str(e.components.maker.get("mode","record"))
	if mode=="record":
		if e.recording: e.recording=false; e.replay=0.0; _emit(e.owner,"recorded",e.id,{"samples":e.samples.size()}); _notice("Gesture captured. Its ribbon now replays your motion.")
		else: e.recording=true; e.samples.clear(); e.replay=-1.0; _notice("Recording movement · squeeze trigger again to finish")
		return
	var hit=_point(hand,8); var other=_entry(hit.get("collider"))
	if other.is_empty(): _notice("Point at a workshop-package object."); return
	if mode=="paint":
		other.components["climbable"]={}; other.base_color=Color("83bbab"); other.material.albedo_color=other.base_color
		if other.has("label"): other.label.text=str(other.spec.get("name",other.id))+"\nGrip to climb"
		_emit(other.owner,"painted",other.id); _notice("Climbing surface painted. Grip and pull.")
	elif mode=="join":
		if other.components.has("returning_projectile") or (e.has("selected") and e.selected.components.has("returning_projectile")): e.erase("selected"); _notice("Returning projectiles must stay free of physical joints."); return
		if not e.has("selected"): e.selected=other; _notice("First piece selected. Point at the second and squeeze.")
		elif e.selected!=other and is_instance_valid(e.selected.node):
			var joined_count=0
			for existing in e.owner.links:
				if str(existing.spec.id).begins_with("joined_"): joined_count+=1
			if joined_count>=16 or e.owner.links.size()>=96: _notice("This package has reached its joint limit."); return
			var selected=e.selected; e.erase("selected")
			if not selected.node is RigidBody3D and not other.node is RigidBody3D: _notice("At least one piece must be movable."); return
			if selected.owner!=e.owner or other.owner!=e.owner: _notice("Join pieces belonging to this maker's package."); return
			var line=MeshInstance3D.new(); line.mesh=BoxMesh.new(); line.material_override=_mat("d6ba74"); e.owner.root.add_child(line)
			var link={"spec":{"id":"joined_"+str(sequence),"from":selected.id,"to":other.id,"type":"hinge","config":{}},"line":line,"from":selected,"to":other,"joint":null,"active":true}; sequence+=1
			e.owner.links.append(link); _hinge(link,e.owner); _emit(e.owner,"joined",e.id,{"from":selected.id,"to":other.id}); _notice("A hinge now joins those pieces.")

func _hinge(link,result):
	if link.from.components.has("returning_projectile") or link.to.components.has("returning_projectile"): return
	if not link.from.node is RigidBody3D and not link.to.node is RigidBody3D: return
	var joint=HingeJoint3D.new(); result.root.add_child(joint); joint.global_position=(link.from.node.global_position+link.to.node.global_position)*.5
	var axis=vec(link.spec.get("config",{}).get("axis",[0,1,0]),Vector3.UP).normalized()
	if axis.length()>.1: joint.global_basis=Basis(Quaternion(Vector3.FORWARD,axis))
	joint.node_a=joint.get_path_to(link.from.node); joint.node_b=joint.get_path_to(link.to.node); joint.exclude_nodes_from_collision=true; link.joint=joint; result.joints.append(joint)

func _segment(line,a:Vector3,b:Vector3,width=.012):
	var difference=b-a
	if difference.length()<.001: line.hide(); return
	line.show(); line.global_position=(a+b)*.5; line.look_at(b,Vector3.RIGHT if absf(difference.normalized().dot(Vector3.UP))>.98 else Vector3.UP); line.scale=Vector3(width,width,difference.length())

func _transform(e,operation:String,amount:float):
	if not is_instance_valid(e.node): return
	match operation:
		"repair":
			e.state.integrity=100.0; e.state.heat=0.0; e.state.burning=false; e.node.show(); e.node.scale=Vector3.ONE; e.state.growth=1.0; e.material.albedo_color=e.base_color; _emit(e.owner,"repaired",e.id)
		"grow":
			if e.node is RigidBody3D: _notice("Plant the object before growing it."); return
			var scale_value=clampf(float(e.state.growth)+amount*.2,.2,2)
			if _player_clear(e,e.node.position,Vector3.ONE*scale_value): e.node.scale=Vector3.ONE*scale_value; e.state.growth=scale_value; _emit(e.owner,"grown",e.id,{"scale":scale_value})
		"cut":
			if e.state.integrity<=0: return
			e.state.integrity=maxf(0,float(e.state.integrity)-35*amount*float(e.components.get("weakpoint",{}).get("multiplier",1))); e.state.growth=maxf(.2,float(e.state.growth)*.85); e.node.scale=Vector3.ONE*float(e.state.growth)
			if debris.size()<20:
				var chip=RigidBody3D.new(); e.owner.root.add_child(chip); chip.global_position=e.node.global_position+Vector3.UP*e.size.y*.4; chip.mass=.15; chip.collision_layer=8; chip.collision_mask=9
				var visual=MeshInstance3D.new(); visual.mesh=BoxMesh.new(); visual.mesh.size=e.size.clamp(Vector3.ONE*.05,Vector3.ONE*.4)*.4; visual.material_override=e.material.duplicate(); chip.add_child(visual)
				var collision=CollisionShape3D.new(); collision.shape=BoxShape3D.new(); collision.shape.size=visual.mesh.size; chip.add_child(collision); chip.linear_velocity=Vector3(.4,1.0,.3); debris.append({"node":chip,"until":clock+40,"owner":e.owner})
			_emit(e.owner,"cut",e.id)
		"join": e.state.integrity=minf(100,float(e.state.integrity)+25); _emit(e.owner,"joined",e.id)

func _pulse(e):
	var config=e.components.get("emitter",{}); var kind=str(config.get("kind","light")); var signal_name=str(config.get("signal",kind)); e.state.last_emit=clock
	# Repetitive simulation pulses are internal; only user actions and transitions enter provenance.
	_stimulus(e,kind,float(config.get("strength",1)))
	if event_queue.size()<128: event_queue.append({"owner":e.owner,"event":"signal:"+signal_name,"id":e.id,"detail":{"kind":kind,"strength":float(config.get("strength",1))}})

func _action(result,source:String,action:Dictionary):
	var target=str(action.get("target",source)); var e=result.entities.get(target,{})
	if e.is_empty(): return
	var value=float(action.get("value",1)); var op=str(action.get("op",""))
	match op:
		"emit":
			if event_queue.size()<128: event_queue.append({"owner":result,"event":"signal:"+str(action.get("signal","pulse")),"id":target,"detail":{"strength":value}})
			_stimulus(e,str(action.get("signal","pulse")),value)
		"heat": e.state.heat=clampf(float(e.state.heat)+value,0,1000)
		"wet": e.state.wet=clampf(float(e.state.wet)+value,0,100)
		"power": e.state.power=clampf(value,0,100)
		"move":
			var destination=e.node.position+vec(action.get("vector")).limit_length(5)
			if _player_clear(e,destination,e.node.scale): e.node.position=destination
		"scale":
			if e.node is StaticBody3D:
				var next_scale=vec(action.get("vector"),Vector3.ONE).clamp(Vector3.ONE*.2,Vector3.ONE*2)
				if _player_clear(e,e.node.position,next_scale): e.node.scale=next_scale; e.state.growth=e.node.scale.x
		"damage":
			var multiplier=float(e.components.get("weakpoint",{}).get("multiplier",1)); e.state.integrity=maxf(0,float(e.state.integrity)-absf(value)*multiplier)
		"repair","grow","cut": _transform(e,op,clampf(value,.1,2))
		"toggle": e.state.enabled=not e.state.enabled
		"set_color": e.base_color=Color(str(action.get("color","ffffff"))); e.material.albedo_color=e.base_color
		"objective": _objective(e)

func _objective(e):
	if e.state.complete: return
	e.state.count=int(e.state.count)+1
	var goal=int(e.components.get("objective",{}).get("count",1))
	if int(e.state.count)>=goal:
		e.state.complete=true; e.base_color=Color("e1b65c"); e.material.albedo_color=e.base_color; _emit(e.owner,"objective_complete",e.id); _notice("Challenge complete · "+str(e.spec.get("name",e.id)))
	if e.has("label"): e.label.text=str(e.spec.get("name",e.id))+"\n"+str(e.state.count)+" / "+str(goal)+(" · Complete" if e.state.complete else "")

func _player_clear(e,position:Vector3,object_scale:Vector3)->bool:
	if e.node is RigidBody3D: return true
	var world:Vector3=e.owner.root.to_global(position); var half:Vector3=e.size*object_scale*.5
	var feet:Vector3=Vector3(game.camera.global_position.x,game.rig.global_position.y,game.camera.global_position.z)
	var relative:Vector3=feet-world
	# Conservative standing capsule bounds; transforms wait instead of trapping the player.
	return absf(relative.x)>half.x+.25 or absf(relative.z)>half.z+.25 or feet.y+1.7<world.y-half.y or feet.y>world.y+half.y

func _events():
	var processed=0
	while not event_queue.is_empty() and processed<64:
		var event=event_queue.pop_front(); processed+=1; var result=event.owner
		if not result.active: continue
		if str(event.event).begins_with("signal:"):
			var visited=event.get("visited",[]).duplicate(); visited.append(event.id)
			for link in result.links:
				if link.spec.type=="signal" and link.from.id==event.id and link.to.id not in visited and event_queue.size()<128:
					event_queue.append({"owner":result,"event":event.event,"id":link.to.id,"detail":event.detail,"visited":visited})
		for e in result.entities.values():
			var objective=e.components.get("objective",{})
			if not objective.is_empty() and str(objective.get("event",""))==event.event and str(objective.get("target",event.id))==event.id: _objective(e)
		for rule in result.package.get("rules",[]):
			if str(rule.get("event",""))!=event.event or str(rule.get("target",event.id)) not in [event.id,"*"]: continue
			for action in rule.get("actions",[]): _action(result,event.id,action)
	# Feedback loops cannot carry work into later frames forever.
	if processed>=64: event_queue.clear()

func _stimulus(e,kind:String,strength:float):
	stimuli.append({"position":e.node.global_position,"kind":kind,"strength":strength,"until":clock+1.5,"owner":e.owner})
	if stimuli.size()>64: stimuli.pop_front()
	if kind=="sound" and DisplayServer.get_name()!="headless":
		if not e.has("audio"):
			var audio=AudioStreamPlayer3D.new(); audio.max_distance=12; audio.unit_size=2; audio.volume_db=-18; e.node.add_child(audio); e.audio=audio
			var wave=AudioStreamWAV.new(); wave.format=AudioStreamWAV.FORMAT_16_BITS; wave.mix_rate=22050; var data=PackedByteArray(); data.resize(6615*2)
			for i in range(6615):
				var t=float(i)/22050; var sample=sin(t*TAU*660)*exp(-t*15)*.55; data.encode_s16(i*2,int(sample*32767))
			wave.data=data; audio.stream=wave
		e.audio.play()

func tick(delta:float):
	delta=clampf(delta,0,.05); clock+=delta; sense_clock+=delta
	for i in range(stimuli.size()-1,-1,-1):
		if stimuli[i].until<clock or not stimuli[i].owner.active: stimuli.remove_at(i)
	var climb_motion=Vector3.ZERO; var climb_hands=0
	for key in held.keys():
		var h=held[key]; var e=h.entry
		if not is_instance_valid(h.hand) or not is_instance_valid(e.node): held.erase(key); continue
		var movement:Vector3=h.hand.global_position-h.previous
		h.velocity=h.velocity.lerp(movement/maxf(delta,.001),.5); h.previous=h.hand.global_position
		if h.climbing:
			var local:Vector3=e.node.to_local(h.hand.global_position); var half:Vector3=e.size*.5
			if local.distance_to(local.clamp(-half,half))>.65: _release_key(key); continue
			climb_motion-=movement; climb_hands+=1; game.item_actions.falling=false
		else: e.node.global_transform=game.hand_socket(h.hand).global_transform*h.offset
	if climb_hands>0:
		game.item_actions.move_rig((climb_motion/climb_hands).limit_length(.12))
		for h in held.values():
			if h.climbing: h.previous=h.hand.global_position
	for result in active:
		for e in result.entities.values(): _tick_entity(e,delta)
		for link in result.links: _tick_link(link,delta)
	projectiles.tick(delta)
	_apply_fields(delta)
	_update_lights()
	_update_labels()
	if sense_clock>=.15:
		sense_clock=0
		for result in active:
			for e in result.entities.values():
				if e.components.has("sensor"): _sense(e)
	_events()
	for i in range(debris.size()-1,-1,-1):
		if not is_instance_valid(debris[i].node): debris.remove_at(i)
		elif clock>debris[i].until or not debris[i].owner.active: debris[i].node.queue_free(); debris.remove_at(i)

func _update_lights():
	var candidates=[]
	for e in entries.values():
		if not e.has("light") or float(e.light.light_energy)<=.01: continue
		var distance=e.node.global_position.distance_squared_to(game.camera.global_position)
		if distance<324: candidates.append({"entry":e,"distance":distance})
	candidates.sort_custom(func(a,b): return a.distance<b.distance)
	for i in range(light_pool.size()):
		var light=light_pool[i]
		if i<candidates.size():
			var e=candidates[i].entry; light.global_position=e.node.global_position; light.light_color=e.light.light_color; light.light_energy=float(e.light.light_energy)
		else: light.light_energy=0

func _update_labels():
	var nearby=[]
	for e in entries.values():
		if not e.has("label"): continue
		e.label.hide()
		var distance=e.label.global_position.distance_to(game.camera.global_position)
		if distance<5: nearby.append({"entry":e,"distance":distance,"priority":distance-(3 if _held_entry(e) else 0)})
	nearby.sort_custom(func(a,b): return a.priority<b.priority)
	for i in range(mini(3,nearby.size())):
		var e=nearby[i].entry; e.label.show(); e.label.modulate.a=clampf((5-float(nearby[i].distance))*1.25,0,1)

func _tick_entity(e,delta:float):
	var s=e.state; var c=e.components
	if c.has("material"):
		var cfg=c.material; var ignition=float(cfg.get("ignition",280)); var damp=float(s.wet)
		s.heat=maxf(0,float(s.heat)-delta*(2+damp*.1)); s.wet=maxf(0,damp-delta*.35)
		if not s.burning and float(s.heat)>=ignition and damp<20: s.burning=true; _emit(e.owner,"ignited",e.id)
		if s.burning:
			s.heat=maxf(float(s.heat),ignition+10); s.integrity=maxf(0,float(s.integrity)-delta*3/maxf(.1,float(cfg.get("hardness",1))))
			if damp>20 or float(s.integrity)<=0: s.burning=false; s.heat=0.0; _emit(e.owner,"extinguished",e.id)
			else: e.material.albedo_color=e.base_color.lerp(Color("b35528"),.45)
		if e.has("light"): e.light.light_color=Color("ff9d46"); e.light.light_energy=(.65+.12*sin(clock*17)) if s.burning else 0.0
		if e.has("flame"): e.flame.visible=s.burning; e.flame.scale=Vector3(1+.07*sin(clock*11),1+.12*sin(clock*17),1)
	if c.has("emitter") and s.enabled:
		if clock-float(s.last_emit)>=float(c.emitter.get("interval",1)): _pulse(e)
		if str(c.emitter.get("kind","light"))=="heat":
			for other in e.owner.entities.values():
				if other==e or not other.components.has("material"): continue
				var distance=e.node.global_position.distance_to(other.node.global_position)
				if distance<2: other.state.heat=minf(1000,float(other.state.heat)+float(c.emitter.get("strength",10))*delta/(1+distance*distance))
		if e.has("light") and c.emitter.get("kind","light")=="light": e.light.light_energy=minf(3,float(c.emitter.get("strength",1)))
	# Authored heat emitters and burning materials also join the native fire
	# network. Package-owned signals still work as before; this is the bridge to
	# bottles, matches, Wyrmspout, weather and other world objects.
	var world_heat=(s.burning if c.has("material") else false) or (c.has("emitter") and s.enabled and str(c.emitter.get("kind",""))=="heat")
	if world_heat and game.heat_contacts!=null and e.owner.active and e.node.is_visible_in_tree() and clock-float(s.get("last_heat_contact",-99))>=.12:
		s.last_heat_contact=clock
		var intensity=100.0 if s.burning else maxf(10,float(c.emitter.get("strength",10)))
		game.heat_contacts.touch(e.node.global_position,clampf(e.size.length()*.35,.32,1.2),intensity,game.adventure.zone,"living_heat",e.node,.12)
	if c.has("receiver"):
		var power=clampf(float(s.power),0,100) if s.enabled else 0.0; var kind=str(c.receiver.get("kind","light"))
		if kind=="light" and e.has("light"): e.light.light_color=Color(str(c.receiver.get("color","8eceef"))); e.light.light_energy=minf(4,power); e.material.emission_enabled=power>.01; e.material.emission=e.light.light_color; e.material.emission_energy_multiplier=minf(2,power)
		elif kind=="door" and not _held_entry(e):
			var destination=e.node.position.lerp(e.home+Vector3.UP*minf(3,power),1-exp(-delta*2))
			if _player_clear(e,destination,e.node.scale): e.node.position=destination
		elif kind=="motor": e.mesh.rotate_y(delta*minf(5,power))
	if c.has("reservoir") and e.has("fill"):
		var ratio=clampf(float(s.amount)/maxf(.1,float(c.reservoir.get("capacity",10))),.001,1); e.fill.scale.y=ratio; e.fill.position.y=e.size.y*.35*(ratio-1)
	if c.has("creature"): _creature(e,delta)
	if e.has("tether"):
		var t=e.tether
		if not is_instance_valid(t.anchor) or not _held_entry(e): _detach(e)
		else:
			var point=t.anchor.to_global(t.local); _segment(e.line,e.node.global_position,point)
			var pressed=t.hand.get_float("trigger")>.5 if t.hand is XRController3D else true
			if pressed:
				var offset:Vector3=game.camera.global_position-game.rig.global_position; var difference:Vector3=t.goal-game.rig.global_position-Vector3(offset.x,0,offset.z)
				if difference.length()<.1:
					if t.approach: t.approach=false; t.goal=t.landing_goal
					elif t.landing: _detach(e); game.item_actions.falling=false
				else: game.item_actions.move_rig(difference.limit_length(delta*float(c.grapple.get("reelSpeed",2)))); game.item_actions.falling=false
	if e.recording and e.samples.size()<128:
		if e.samples.is_empty() or vec(e.samples[-1]).distance_to(e.node.position)>.025: e.samples.append([e.node.position.x,e.node.position.y,e.node.position.z])
	elif float(e.replay)>=0 and e.samples.size()>1:
		e.replay=fmod(float(e.replay)+delta*12,e.samples.size()-1); var i=int(e.replay); _segment(e.line,e.owner.root.to_global(vec(e.samples[i])),e.owner.root.to_global(vec(e.samples[i+1])),.03)

func _tick_link(link,delta:float):
	if not is_instance_valid(link.from.node) or not is_instance_valid(link.to.node): return
	var a=link.from; var b=link.to; var cfg=link.spec.get("config",{}); var type=str(link.spec.type)
	_segment(link.line,a.node.global_position,b.node.global_position,.018 if type=="fluid" else .009)
	if type=="energy":
		var source=float(a.state.power)
		if a.components.has("emitter") and a.state.enabled: source=maxf(source,float(a.components.emitter.get("strength",1)))
		var power=source*float(cfg.get("conductance",1))*float(b.components.get("material",{}).get("conductivity",1))
		var was=float(b.state.power); b.state.power=lerpf(was,power,1-exp(-delta*5))
		if was<.1 and float(b.state.power)>=.1: _emit(b.owner,"powered",b.id)
	elif type=="fluid":
		var available=float(a.state.amount); var capacity=float(b.components.get("reservoir",{}).get("capacity",100))
		var flow=minf(available,minf(maxf(0,capacity-float(b.state.amount)),delta*float(cfg.get("rate",1))))
		if flow>0:
			a.state.amount=available-flow; b.state.amount=float(b.state.amount)+flow; b.state.wet=minf(100,float(b.state.wet)+flow*10*float(b.components.get("material",{}).get("absorption",1)))
			if float(b.state.amount)>=capacity-.001 and not b.get("filled",false): b.filled=true; _emit(b.owner,"filled",b.id)
	elif type=="tether":
		var vector:Vector3=a.node.global_position-b.node.global_position; var length=float(cfg.get("length",2))
		if vector.length()>length:
			var force=vector.normalized()*minf(50,(vector.length()-length)*25)
			if b.node is RigidBody3D and not b.node.freeze: b.node.apply_central_force(force)
			if a.node is RigidBody3D and not a.node.freeze: a.node.apply_central_force(-force)
	elif type=="hinge" and link.joint!=null:
		var speed=float(cfg.get("speed",0)); link.joint.set_flag(HingeJoint3D.FLAG_ENABLE_MOTOR,absf(speed)>.01); link.joint.set_param(HingeJoint3D.PARAM_MOTOR_TARGET_VELOCITY,speed); link.joint.set_param(HingeJoint3D.PARAM_MOTOR_MAX_IMPULSE,1.0)

func _sense(e):
	var cfg=e.components.sensor; var kind=str(cfg.get("kind","motion")); var radius=float(cfg.get("radius",4)); var detected=false; var position=Vector3.ZERO
	if kind=="motion": detected=e.node.global_position.distance_to(game.camera.global_position)<radius; position=game.camera.global_position
	else:
		for stimulus in stimuli:
			var distance=e.node.global_position.distance_to(stimulus.position)
			if stimulus.kind==kind and distance<radius and stimulus.strength/(1+distance*distance)>=float(cfg.get("threshold",.1)): detected=true; position=stimulus.position; break
		for other in e.owner.entities.values():
			if detected: break
			if other==e: continue
			var emitter=other.components.get("emitter",{}); var strength=float(emitter.get("strength",0)); var distance=e.node.global_position.distance_to(other.node.global_position)
			var matches=str(emitter.get("kind",""))==kind or (kind=="signal" and str(emitter.get("signal",""))==str(cfg.get("signal","pulse")))
			if kind=="heat" and other.state.burning: matches=true; strength=50
			if matches and other.state.enabled and distance<radius and strength/(1+distance*distance)>=float(cfg.get("threshold",.1)): detected=true; position=other.node.global_position; break
	if detected:
		e.state.memory={"position":[position.x,position.y,position.z],"time":clock,"kind":kind}
		if not e.state.last_sense:
			_emit(e.owner,"sensed",e.id,{"kind":kind})
			if cfg.has("signal") and event_queue.size()<128: event_queue.append({"owner":e.owner,"event":"signal:"+str(cfg.signal),"id":e.id,"detail":{"kind":kind}})
	e.state.last_sense=detected

func _creature(e,delta:float):
	if _held_entry(e) or not e.state.enabled: return
	var cfg=e.components.creature; var mode=str(cfg.get("mode","investigate")); var target=game.camera.global_position; var distance=e.node.global_position.distance_to(target); var radius=float(cfg.get("radius",5))
	if mode=="investigate":
		if e.state.memory.is_empty() or clock-float(e.state.memory.get("time",0))>15: return
		target=vec(e.state.memory.position)
	elif distance>radius: return
	var direction:Vector3=target-e.node.global_position; direction.y=0
	if mode=="flee": direction=-direction
	if direction.length()<.8 and mode!="flee": return
	var motion=direction.normalized()*float(cfg.get("speed",.7))*delta
	var query=PhysicsShapeQueryParameters3D.new(); query.shape=e.shape.shape; query.transform=e.node.global_transform; query.motion=motion; query.exclude=[e.node.get_rid()]; query.collision_mask=1
	var sweep=game.get_world_3d().direct_space_state.cast_motion(query); e.node.global_position+=motion*maxf(0,float(sweep[0])-.01)
	if direction.length()>.01: e.node.rotation.y=lerp_angle(e.node.rotation.y,atan2(-direction.x,-direction.z),delta*4)

func _apply_fields(delta:float):
	for e in entries.values():
		if e.node is RigidBody3D: e.node.gravity_scale=1
		if not e.state.burning: e.material.albedo_color=e.base_color
	var player_gravity=1.0; var inside=false
	for field in entries.values():
		if not field.components.has("field") or not field.state.enabled: continue
		var cfg=field.components.field; var radius=float(cfg.get("radius",2)); var strength=clampf(float(cfg.get("strength",.3)),0,2); var center=field.node.global_position
		for e in entries.values():
			if e==field or center.distance_to(e.node.global_position)>radius: continue
			if cfg.get("kind","gravity")=="gravity" and e.node is RigidBody3D: e.node.gravity_scale=strength
			elif cfg.get("kind","")=="visibility": e.material.albedo_color=e.base_color.darkened(clampf(1-strength,0,.85))
		if cfg.get("kind","gravity")=="gravity" and center.distance_to(game.camera.global_position)<radius: inside=true; player_gravity=strength
	if inside and held.is_empty():
		game.item_actions.falling=false; field_falling=true
		gravity_velocity=minf(3,gravity_velocity+delta*9.8*player_gravity)
		if game.item_actions.move_rig(Vector3.DOWN*gravity_velocity*delta)<.95: gravity_velocity=0
	else:
		gravity_velocity=0
		if field_falling: game.item_actions.falling=true; field_falling=false
