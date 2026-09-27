extends Node
## Visual-only feedback. No service requests, damage, inventory or input ownership.
## Root calls setup(game), then tick(delta) after adventure.tick(delta).
var enabled = true
var throw_arc_enabled = false
var game
var visuals: Node3D
var formations: Dictionary = {}
var flying: Dictionary = {}
var aims: Dictionary = {}
var enemy_cues: Dictionary = {}
var resource_visibility: Dictionary = {}
var next_aim = 0.0
var next_resources = 0.0
var gathered_count = 0
var last_hint = ""

const MINT = Color("97eed3")
const AMBER = Color("ffd38a")
const HOT = Color("ff9266")
const INK = Color("182b3a")

func setup(owner_game):
	game = owner_game
	visuals = Node3D.new()
	visuals.name = "InteractionFeedback"
	game.add_child(visuals)
	if not str(game.capture_path).is_empty(): enabled = false
	for resource in game.scene.get("resources", []):
		resource_visibility[resource.get_instance_id()] = resource.visible

func tick(_delta):
	if game == null or not is_instance_valid(visuals): return
	visuals.visible = enabled
	if not enabled: return
	_update_formation()
	_update_flying()
	_update_enemies()
	if game.elapsed >= next_aim:
		next_aim = game.elapsed + 0.05
		_update_aim()
	if game.elapsed >= next_resources:
		next_resources = game.elapsed + 0.08
		_update_gathering()

func _label(parent: Node3D, size = 24) -> Label3D:
	var label = Label3D.new()
	parent.add_child(label)
	label.font_size = size
	label.pixel_size = 0.0022
	label.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	label.modulate = MINT
	label.outline_modulate = INK
	label.outline_size = 7
	label.no_depth_test = false
	return label

func _lines(parent: Node3D) -> MeshInstance3D:
	var node = MeshInstance3D.new()
	node.mesh = ImmediateMesh.new()
	parent.add_child(node)
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	return node

func _draw(node: MeshInstance3D, points: PackedVector3Array, color: Color):
	var mesh: ImmediateMesh = node.mesh
	mesh.clear_surfaces()
	if points.is_empty(): return
	var material = StandardMaterial3D.new()
	material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color = color
	material.no_depth_test = false
	mesh.surface_begin(Mesh.PRIMITIVE_LINES, material)
	for point in points: mesh.surface_add_vertex(point)
	mesh.surface_end()

func _circle(radius: float, progress = 1.0) -> PackedVector3Array:
	var result = PackedVector3Array()
	var segments = maxi(1, ceili(40 * progress))
	for i in range(segments):
		var a = TAU * float(i) / 40.0 - PI/2
		var b = TAU * minf(float(i+1) / 40.0,progress) - PI/2
		result.append(Vector3(cos(a),sin(a),0)*radius)
		result.append(Vector3(cos(b),sin(b),0)*radius)
	return result

func _facing(node: Node3D, position: Vector3):
	node.global_position = position
	if position.distance_to(game.camera.global_position)>0.01:
		node.look_at(game.camera.global_position, Vector3.UP)

func _update_formation():
	var live = {}
	for key in game.adventure.formation:
		var orb = game.adventure.ready_bombs.get(key)
		if not is_instance_valid(orb): continue
		live[key] = true
		if not formations.has(key):
			var node = Node3D.new()
			visuals.add_child(node)
			formations[key] = {"root":node,"ring":_lines(node),"label":_label(node,23),"arc":_lines(visuals)}
		var entry = formations[key]
		var seconds = maxf(0, game.elapsed-float(game.adventure.formation[key]))
		var formation_seconds=maxf(0.01,float(orb.get_meta("formation_seconds",0.45)))
		var progress = clampf(seconds/formation_seconds,0,1)
		var ready = bool(orb.get_meta("ready", false))
		_facing(entry.root, orb.global_position)
		_draw(entry.ring,_circle(0.16,progress),MINT if ready else AMBER)
		entry.label.position = Vector3(0,0.24,0)
		entry.label.modulate = MINT if ready else AMBER
		entry.label.text = "READY · release to throw" if ready else "FORMING · %.1fs" % maxf(0,formation_seconds-seconds)
		entry.arc.visible = throw_arc_enabled and ready
		if throw_arc_enabled and ready and game.elapsed>=float(entry.get("arc_at",0)):
			entry.arc_at=game.elapsed+0.05
			var velocity:Vector3 = game.adventure.motion.get(key,{}).get("velocity",Vector3.ZERO)
			if game.get("tuning")!=null:
				if game.vr: velocity=game.tuning.estimate(game.tuning.history.get(key,[]),velocity)
				else: velocity=(-game.camera.global_basis.z*9*game.tuning.value("throw.gain")+Vector3.UP*(1.8+game.tuning.value("throw.assist_lift"))).limit_length(game.tuning.value("throw.max_speed"))
			elif not game.vr: velocity=-game.camera.global_basis.z*9+Vector3.UP*1.8
			_draw_arc(entry.arc,orb.global_position,velocity)
	for key in formations.keys():
		if not live.has(key):
			formations[key].root.queue_free()
			formations[key].arc.queue_free()
			formations.erase(key)

func _draw_arc(node: MeshInstance3D, origin: Vector3, velocity: Vector3):
	var points=PackedVector3Array()
	var previous=origin
	var gravity=float(game.tuning.value("bomb.gravity")) if game.get("tuning")!=null else 1.0
	for i in range(1,33):
		var time=float(i)*0.06
		var point=origin+velocity*time+Vector3.DOWN*4.9*gravity*time*time
		var query=PhysicsRayQueryParameters3D.create(previous,point,1)
		var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
		if not hit.is_empty(): point=hit.position
		if i%2==1 or not hit.is_empty():
			points.append(previous)
			points.append(point)
		if not hit.is_empty(): break
		previous=point
	_draw(node,points,MINT)

func _update_flying():
	var live={}
	for bomb in game.get_tree().get_nodes_in_group("magic_bomb"):
		if not is_instance_valid(bomb) or bomb.get_meta("exploded",false): continue
		var key=bomb.get_instance_id()
		live[key]=true
		if not flying.has(key):
			var root=Node3D.new()
			visuals.add_child(root)
			var born=float(bomb.get_meta("spawned_at",game.elapsed))
			flying[key]={"root":root,"ring":_lines(root),"label":_label(root,22),"born":born,"fuse_at":born+2.6,"impacted":false}
		var entry=flying[key]
		if bomb.get_meta("detonating",false) and not entry.impacted:
			entry.impacted=true
			entry.fuse_at=minf(float(entry.fuse_at),game.elapsed+0.35)
		var deadline=float(bomb.get_meta("fuse_at",entry.fuse_at))
		var remaining=maxf(0,deadline-game.elapsed)
		var nearby=game.camera.global_position.distance_to(bomb.global_position)<float(bomb.get_meta("blast_radius",3.2))
		entry.root.visible=game.camera.global_position.distance_to(bomb.global_position)<35
		_facing(entry.root,bomb.global_position)
		var color=HOT if nearby or remaining<0.6 else AMBER
		_draw(entry.ring,_circle(0.18,clampf(remaining/2.6,0.025,1)),color)
		entry.label.position=Vector3(0,0.28,0)
		entry.label.modulate=color
		entry.label.text=("MOVE BACK · " if nearby else "ARMED · ")+"%.1fs"%remaining
	for key in flying.keys():
		if not live.has(key):
			flying[key].root.queue_free()
			flying.erase(key)

func _update_aim():
	for entry in aims.values(): entry.root.visible=false
	last_hint=""
	if game.get("qol")!=null and bool(game.qol.opened): return
	var sources: Array=[]
	if game.vr:
		for hand in game.hands:
			if hand.get_is_active(): sources.append(hand)
	else: sources.append(game.camera)
	for source in sources:
		var key=str(source.get_instance_id())
		var hand=source if game.vr else game.desktop_hand
		var held_key=str(hand.get_instance_id())
		var tool=""
		if game.held.has(held_key) and is_instance_valid(game.held[held_key]): tool=str(game.held[held_key].get_meta("id",""))
		elif game.adventure.selected=="bomb_glove": tool="bomb_glove"
		var hit=game._ray(source,28)
		var target=game._owner(hit.get("collider"))
		if target==null or not target is Node3D or not target.is_visible_in_tree(): continue
		var distance=source.global_position.distance_to(hit.position)
		var verdict=describe_target(target,tool,distance)
		if verdict.is_empty(): continue
		if not aims.has(key):
			var root=Node3D.new()
			visuals.add_child(root)
			aims[key]={"root":root,"brackets":_lines(root),"label":_label(root,27)}
		var entry=aims[key]
		entry.root.visible=true
		entry.root.global_transform=Transform3D.IDENTITY
		var color=MINT if verdict.compatible else AMBER
		var bounds=_target_bounds(target)
		_draw(entry.brackets,_brackets(bounds),color)
		entry.label.global_position=target.get_meta("hint_position",Vector3(bounds.get_center().x,bounds.end.y+0.22,bounds.get_center().z))
		entry.label.modulate=color
		entry.label.text=str(verdict.reason)
		last_hint=str(verdict.reason)

## Pure read-only action description; usable by a native smoke assertion.
func describe_target(target:Node3D,tool:String,distance:float) -> Dictionary:
	if tool=="starter_hammer": tool="apprentice_hammer"
	var kind=str(target.get_meta("kind",""))
	var action=str(target.get_meta("action",""))
	if kind=="discovery": return {"compatible":distance<=6,"reason":str(target.get_meta("hint","Explore"))}
	if not action.is_empty():
		if distance>6: return {"compatible":false,"reason":"Move closer to select"}
		if action.begins_with("travel:"):
			return {"compatible":true,"reason":"Travel · "+action.trim_prefix("travel:").replace("_"," ").capitalize()}
		if action.begins_with("tool:"):
			var id=action.trim_prefix("tool:")
			var level=1 if game.adventure.ORDER.find(id)<4 else (2 if game.adventure.ORDER.find(id)<6 else (3 if id=="crystal_resonator" else 4))
			return {"compatible":int(game.state.get("tier",1))>=level,"reason":("Choose · " if int(game.state.get("tier",1))>=level else "Needs Tier %d · "%level)+str(game.adventure.TOOL_NAMES.get(id,id))}
		return {"compatible":true,"reason":"Upgrade workshop" if action=="upgrade" else action.capitalize()}
	if kind=="anchor":
		var valid=tool=="grappling_hook"
		return {"compatible":valid,"reason":"Trigger: attach · hold to reel" if valid else "Needs Swallow Line · Tier 2"}
	if kind in ["weapon","tail","cache"]:
		var range_limit=float(game.qol.settings.get("reach",3.0)) if game.get("qol")!=null else (0.45 if game.vr else 3.0)
		var title={"weapon":"Grip · "+str(target.get_meta("display_name","tool")),"tail":"Grip · rat tail","cache":"Grip · recover your materials"}[kind]
		return {"compatible":distance<=range_limit,"reason":title if distance<=range_limit else "Move within reach · "+title.trim_prefix("Grip · ")}
	if kind=="resource":
		var resource=str(target.get_meta("resource",target.get_meta("resource_id","material"))).replace("_"," ")
		var requires=str(target.get_meta("requires",""))
		var valid=requires in ["","hand","none"] or (requires in ["axe","chop"] and tool=="woodland_axe") or (requires in ["pick","mine"] and tool in ["quarry_pick","crystal_resonator"]) or (requires=="magic" and tool in ["spore_lantern","crystal_resonator","ember_gauntlet"])
		if target.get_meta("collecting",false): return {"compatible":false,"reason":"Gathering · "+resource}
		if distance>4: return {"compatible":false,"reason":"Move closer · "+resource}
		var needed={"axe":"Orchard’s Edge","chop":"Orchard’s Edge","pick":"Stonewhisper","mine":"Stonewhisper","magic":"Mooncap Lantern"}.get(requires,"your hands")
		return {"compatible":valid,"reason":("Gather %d · "%int(target.get_meta("amount",3))+resource) if valid else "Needs "+str(needed)+" · "+resource}
	if kind=="barrier":
		var requires=str(target.get_meta("requires","bomb"))
		var valid=(requires in ["axe","chop"] and tool=="woodland_axe") or tool in ["crystal_resonator","ember_gauntlet","bomb_glove"]
		var action_text="Throw a bomb · break the seal" if tool=="bomb_glove" else "Strike · open a new path"
		if distance>4 and tool!="bomb_glove": return {"compatible":false,"reason":"Move closer · sealed path"}
		return {"compatible":valid,"reason":action_text if valid else "Needs a bomb or Hollow’s Song"}
	if kind in ["enemy","rat","dummy"]:
		var title=str(target.get_meta("enemy_type",kind)).capitalize()
		if not target.get_meta("alive",true): return {}
		if tool=="bomb_glove": return {"compatible":true,"reason":"Throw · "+title+" · keep your distance"}
		var range_limit=10 if tool in ["spore_lantern","crystal_resonator","ember_gauntlet"] else 4.0
		return {"compatible":not tool.is_empty() and distance<=range_limit,"reason":("Strike · "+title) if not tool.is_empty() and distance<=range_limit else ("Move closer · "+title if not tool.is_empty() else "Grip a tool to strike")}
	return {}

func _target_bounds(target:Node3D) -> AABB:
	var found=false
	var result=AABB(target.global_position-Vector3(0.25,0,0.25),Vector3(0.5,0.75,0.5))
	var pending:Array[Node]=[target]
	while not pending.is_empty():
		var node=pending.pop_back()
		if node is MeshInstance3D and node.mesh!=null and node.is_visible_in_tree():
			var bounds=node.global_transform*node.get_aabb()
			result=result.merge(bounds) if found else bounds
			found=true
		for child in node.get_children():
			if child is Node3D and not child is Label3D: pending.append(child)
	return result.grow(0.05)

func _brackets(bounds:AABB) -> PackedVector3Array:
	var points=PackedVector3Array()
	for x in [0,1]:
		for y in [0,1]:
			for z in [0,1]:
				var corner=bounds.position+Vector3(x,y,z)*bounds.size
				for axis in [Vector3(1 if x==0 else -1,0,0),Vector3(0,1 if y==0 else -1,0),Vector3(0,0,1 if z==0 else -1)]:
					points.append(corner)
					points.append(corner+axis*minf(0.22,bounds.size.length()*0.16))
	return points

func _update_enemies():
	for enemy in game.scene.get("enemies",[]):
		if not is_instance_valid(enemy): continue
		var key=enemy.get_instance_id()
		var active=enemy.is_visible_in_tree() and enemy.get_meta("alive",true) and enemy.global_position.distance_to(game.camera.global_position)<16
		var windup=maxf(0,float(enemy.get_meta("attack_at",0))-game.elapsed)
		var exposed=maxf(0,float(enemy.get_meta("exposed_until",0))-game.elapsed)
		if not active or (windup<=0 and exposed<=0):
			if enemy_cues.has(key): enemy_cues[key].root.visible=false
			continue
		if not enemy_cues.has(key):
			var root=Node3D.new()
			visuals.add_child(root)
			enemy_cues[key]={"root":root,"ring":_lines(root),"label":_label(root,30)}
		var entry=enemy_cues[key]
		entry.root.visible=true
		entry.root.global_position=enemy.global_position+Vector3.UP*0.06
		entry.ring.rotation.x=PI/2
		entry.label.position=Vector3(0,2.2 if str(enemy.get_meta("enemy_type",""))!="boss" else 3.6,0)
		if windup>0:
			_draw(entry.ring,_circle(2.8,clampf(1-windup/1.2,0.02,1)),HOT)
			entry.label.modulate=HOT
			entry.label.text="STEP BACK · %.1fs"%windup
		else:
			_draw(entry.ring,_circle(0.8),MINT)
			entry.label.modulate=MINT
			entry.label.text="CORE EXPOSED · DOUBLE DAMAGE"

func _update_gathering():
	var resources:Array=game.scene.get("resources",[]).duplicate()
	for pickup in game.get_tree().get_nodes_in_group("pickup"):
		if pickup.get_meta("kind","")=="resource" and not resources.has(pickup): resources.append(pickup)
	for resource in resources:
		if not is_instance_valid(resource): continue
		var key=resource.get_instance_id()
		var was_visible=bool(resource_visibility.get(key,resource.visible))
		if was_visible and not resource.visible and resource.get_meta("collecting",false):
			gathered(resource.global_position,str(resource.get_meta("resource","material")),int(resource.get_meta("amount",3)))
		resource_visibility[key]=resource.visible

func gathered(position:Vector3,resource:String,amount:int):
	if not enabled or position.distance_to(game.camera.global_position)>12: return
	gathered_count+=1
	var root=Node3D.new()
	visuals.add_child(root)
	root.global_position=position+Vector3.UP*0.85
	var label=_label(root,34)
	label.text="+%d %s"%[amount,resource.replace("_"," ")]
	label.modulate=MINT
	var tween=create_tween().set_parallel(true)
	tween.tween_property(root,"position:y",root.position.y+0.6,1.0).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
	tween.tween_property(label,"modulate:a",0.0,0.35).set_delay(0.7)
	tween.chain().tween_callback(root.queue_free)
	for i in range(5):
		var mote=MeshInstance3D.new()
		var mesh=BoxMesh.new()
		mesh.size=Vector3.ONE*0.035
		mote.mesh=mesh
		var mat=StandardMaterial3D.new()
		mat.albedo_color=MINT
		mat.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
		mote.material_override=mat
		root.add_child(mote)
		var angle=float(i)*TAU/5
		mote.position=Vector3(cos(angle)*0.08,-0.2,sin(angle)*0.08)
		var sparkle=create_tween().set_parallel(true)
		sparkle.tween_property(mote,"position",Vector3(cos(angle)*0.35,0.25,sin(angle)*0.35),0.65)
		sparkle.tween_property(mote,"scale",Vector3.ZERO,0.65)
