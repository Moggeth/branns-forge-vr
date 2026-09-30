extends SceneTree
## Single offline actual-engine batch. Uses runtime adapters, not diagram-only poses.
const HANDS=preload("res://hand_animation.gd")
var game
var stage:Node3D
var viewport:SubViewport
var camera:Camera3D
var config:Dictionary
var folder:String
var records:Array=[]
var errors:Array=[]
var checks=0
var capture_checks=0
var helpers:Array=[]
var frozen_materials:Dictionary={}

func _initialize():
	if not OS.get_cmdline_user_args().has("--weapon-inspection"):
		push_error("Offline --weapon-inspection flag is required"); quit(2); return
	run.call_deferred()

func vec(value:Array)->Vector3: return Vector3(value[0],value[1],value[2])
func check(ok:bool,label:String):
	checks+=1
	if label.begins_with("save "): capture_checks+=1
	if not ok: errors.append(label)

func run():
	var started=Time.get_ticks_usec()
	seed(0)
	var config_path=""
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--inspection-config="): config_path=arg.trim_prefix("--inspection-config=")
	if config_path.is_empty(): quit(2); return
	config=JSON.parse_string(FileAccess.get_file_as_string(config_path))
	folder=str(config.output); DirAccess.make_dir_recursive_absolute(folder)
	game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame
	check(game.diagnostic_offline and not game.vr,"no service, save writes or XR session")
	game.process_mode=Node.PROCESS_MODE_DISABLED
	game.hide()
	Engine.max_fps=0
	viewport=SubViewport.new(); root.add_child(viewport)
	viewport.size=Vector2i(int(config.size),int(config.size))
	viewport.own_world_3d=true; viewport.render_target_update_mode=SubViewport.UPDATE_DISABLED
	stage=Node3D.new(); viewport.add_child(stage)
	stage.process_mode=Node.PROCESS_MODE_DISABLED
	camera=Camera3D.new(); stage.add_child(camera); camera.current=true
	camera.projection=Camera3D.PROJECTION_ORTHOGONAL
	var environment=Environment.new(); environment.background_mode=Environment.BG_COLOR
	environment.background_color=Color("363c43"); environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color=Color("e1e6ee"); environment.ambient_light_energy=.5
	environment.tonemap_mode=Environment.TONE_MAPPER_FILMIC; camera.environment=environment
	for entry in [[Vector3(-2,3,2),1.2],[Vector3(2,1,-3),.7]]:
		var light=DirectionalLight3D.new(); stage.add_child(light)
		light.position=entry[0]; light.look_at(Vector3.ZERO); light.light_energy=entry[1]; light.shadow_enabled=false
	for spec in config.subjects:
		var before=Time.get_ticks_usec()
		var item=subject(spec)
		if item==null:
			errors.append(str(spec.id)+": actual item unavailable"); continue
		item.reparent(stage); item.transform=Transform3D.IDENTITY; item.show()
		if item is RigidBody3D: item.freeze=true
		game._set_collisions(item,false)
		sanitize(item)
		if spec.factory=="bow": game.archery.update_draw_visuals()
		check(bounds(item).size.length()>.03,str(spec.id)+": visible actual mesh is present")
		var subject_records=[]
		for view in [["front",Vector3(0,0,-3)],["back",Vector3(0,0,3)],["left",Vector3(-3,0,0)],["right",Vector3(3,0,0)],["top",Vector3(0,3,0)],["bottom",Vector3(0,-3,0)],["quarter",Vector3(1.8,.8,-2.5)]]:
			await capture(item,spec,"model",view[0],view[1],subject_records)
		for side in ["left_hand","right_hand","desktop"]:
			var hand=make_hand(side)
			if spec.factory=="ring": game.playful_tools._attach(hand)
			elif spec.factory=="wand":
				game.magnetic_wand.holder=hand; game.magnetic_wand._pose()
			else: game.grips._attach(hand,item)
			if spec.factory=="crossbow": game.siegebird.tick(0.0)
			if spec.factory=="bow": game.archery.update_draw_visuals()
			sanitize(item)
			HANDS.tick(hand,true,.25)
			var socket=game.hand_socket(hand)
			var forward=(item.global_basis*vec(spec.forward)).normalized()
			var up=(item.global_basis*vec(spec.up)).normalized()
			var forward_dot=forward.dot(-socket.global_basis.z)
			var up_dot=up.dot(Vector3.UP)
			if spec.get("check_forward",false): check(forward_dot>(.82 if side=="desktop" else .98),str(spec.id)+" "+side+" working face follows aim")
			if spec.get("check_up",false): check(up_dot>.93,str(spec.id)+" "+side+" upright visual")
			var arrow_origin=item.global_transform.origin
			if spec.factory=="crossbow": arrow_origin=item.to_global(item.get_meta("grip_axis_origin"))
			axis(arrow_origin,forward,Color("ffbe66")); axis(socket.global_position,-socket.global_basis.z,Color("69d3eb"))
			await capture(item,spec,side,"quarter",Vector3(1.8,.7,2.6),subject_records,hand,{"forward_dot":forward_dot,"up_dot":up_dot,"pose":pose_array(item.transform)})
			if side!="desktop": await capture(item,spec,side,"side",Vector3(3,.15,.2),subject_records,hand)
			else: await capture_fps(item,spec,hand,subject_records)
			clear_helpers()
			if side!="desktop" and spec.get("two_handed",false):
				await two_hands(item,spec,hand,side,subject_records)
			game.held.erase(str(hand.get_instance_id())); game.grips.grips.erase(str(hand.get_instance_id()))
			item.reparent(stage); item.transform=Transform3D.IDENTITY
			if hand is XRController3D: game.hands.erase(hand)
			hand.free()
		for side in [-1,1]:
			if not spec.get("holster",true): continue
			var slot=game.grips.slots[0 if side<0 else 1].root.duplicate(0)
			stage.add_child(slot); slot.transform=Transform3D.IDENTITY; sanitize(slot)
			item.reparent(slot); item.transform=game.grips._holster_pose(item,side)
			if spec.factory=="bow": game.archery.update_draw_visuals()
			await capture(item,spec,"holster-left" if side<0 else "holster-right","quarter",Vector3(1.8,.7,2.6),subject_records,slot)
			item.reparent(stage); item.transform=Transform3D.IDENTITY; slot.free()
		records.append({"id":spec.id,"name":spec.name,"factory":spec.factory,"holster":spec.get("holster",true),"two_handed":spec.get("two_handed",false),"views":subject_records,"seconds":(Time.get_ticks_usec()-before)/1000000.0})
		item.hide(); item.reparent(game)
	var report={"schema_version":1,"renderer":"Godot actual models, articulated gloves and runtime attachment paths","headset_acceptance":false,"saved_calibrations":"excluded; authored defaults only","checks":checks,"pose_checks":checks-capture_checks,"capture_checks":capture_checks,"failures":errors,"subjects":records,"special_cases":config.get("special_cases",[]),"seconds":(Time.get_ticks_usec()-started)/1000000.0}
	var output=FileAccess.open(folder.path_join("report.json"),FileAccess.WRITE)
	if output==null: quit(2); return
	output.store_string(JSON.stringify(report,"\t")); output.close()
	print("WEAPON_INSPECTION_RESULT ",JSON.stringify({"subjects":records.size(),"views":records.reduce(func(total,record):return total+record.views.size(),0),"checks":checks,"failures":errors,"seconds":report.seconds}))
	quit(0 if errors.is_empty() else 1)

func subject(spec:Dictionary):
	match str(spec.factory):
		"builtin":
			var item=game.adventure._tool_model(str(spec.id)); game.add_child(item); return item
		"collection":
			if spec.id=="starter_hammer": return game.scene.hammer
			return game.collection.homes.get(str(spec.id),{}).get("item")
		"crossbow": return preload("res://siegebird_checks.gd").load_sample(game)
		"bow":
			game.archery.cancel_draw(); game.archery.hint.hide(); game.archery.quiver.hide(); return game.archery.bow
		"ring": return game.playful_tools.ring
		"wand": return game.magnetic_wand.wand
		"wyrm":
			var item=Node3D.new(); game.add_child(item)
			var model=(load("res://assets/wyrmspout.glb") as PackedScene).instantiate(); item.add_child(model)
			var bounds=game._bounds(model,Transform3D.IDENTITY)
			model.scale*=minf(1.0,.46/maxf(bounds.size.x,maxf(bounds.size.y,bounds.size.z)))
			item.set_meta("id",game.grips.WYRM_V2); item.set_meta("kind","weapon"); item.set_meta("creation_version",2)
			game.wyrmspout.attach(item,model); return item
		"shield":
			for record in game.guardians.guardians.values():
				if record.variant==spec.variant:
					var item=game.guardians.yank(record.actor)
					# Normal frames sync the authored/legacy shield visibility after theft.
					game.guardian_authored._sync_shield(game.guardian_authored.entries[record.actor.get_instance_id()])
					return item
	return null

func make_hand(side:String)->Node3D:
	var hand:Node3D
	if side=="desktop": hand=Node3D.new(); stage.add_child(hand)
	else:
		hand=XRController3D.new(); hand.tracker=StringName(side); stage.add_child(hand); game.hands.append(hand)
		game.adventure.build_hand(hand)
		# Index points forwards, thumb points up: a repeatable upright power grip.
		var socket=game.hand_socket(hand)
		var roll=PI/2 if side=="left_hand" else -PI/2
		hand.basis=Basis(Vector3.BACK,roll)*socket.basis.inverse()
	return hand

func two_hands(item:Node3D,spec:Dictionary,hand:Node3D,side:String,list:Array):
	var support=make_hand("right_hand" if side=="left_hand" else "left_hand")
	var axis_origin:Vector3=item.get_meta("grip_axis_origin",Vector3.ZERO)
	var point=Vector3(axis_origin.x,float(item.get_meta("grip_max",.35)),axis_origin.z)
	support.global_position=item.to_global(point)
	var attached=game.grips.try_grab(support)
	check(attached and game.grips._entries(item).size()==2,str(spec.id)+" "+side+" physical second grip")
	if attached:
		game.grips.tick(.016)
		if spec.factory=="crossbow": game.siegebird.tick(0.0)
		var initial=(item.global_basis*vec(spec.forward)).normalized()
		var rest_basis=hand.basis
		hand.basis=hand.basis*Basis(Vector3.UP,.65)
		game.grips.tick(.016)
		if spec.factory=="crossbow":
			game.siegebird.tick(0.0)
			var direction=(support.global_position-hand.global_position).normalized()
			check((item.global_basis*vec(spec.forward)).normalized().dot(direction)>.99,str(spec.id)+" "+side+" two hands determine flight direction")
			check((item.global_basis*vec(spec.forward)).normalized().dot(initial)>.999,str(spec.id)+" "+side+" rear wrist cannot steer rail")
		HANDS.tick(support,true,.25)
		await capture(item,spec,"two-hand-"+side.trim_suffix("_hand"),"quarter",Vector3(1.8,.7,2.6),list,support,{"rear_wrist_yaw_degrees":rad_to_deg(.65)})
		hand.basis=rest_basis
	game.held.erase(str(support.get_instance_id())); game.grips.grips.erase(str(support.get_instance_id()))
	game.hands.erase(support); support.free()
	item.transform=game.grips.pose_for(item,hand)
	game.grips.grips[str(hand.get_instance_id())].basis=item.basis

func sanitize(node:Node):
	if node is Label3D or node is Light3D or node is GPUParticles3D: node.hide()
	if node is CollisionShape3D: node.disabled=true
	if node is MeshInstance3D and node.mesh!=null:
		if node.material_override!=null: node.material_override=freeze_material(node.material_override)
		for surface in node.mesh.get_surface_count():
			var material=node.get_active_material(surface)
			if material is ShaderMaterial: node.set_surface_override_material(surface,freeze_material(material))
	for child in node.get_children(): sanitize(child)

func freeze_material(material:Material)->Material:
	if not material is ShaderMaterial or material.shader==null: return material
	var key=material.get_instance_id()
	if frozen_materials.has(key): return frozen_materials[key]
	var copy=material.duplicate() as ShaderMaterial
	copy.shader=material.shader.duplicate()
	var clock=RegEx.new(); clock.compile("\\bTIME\\b")
	copy.shader.code=clock.sub(copy.shader.code,"0.0",true)
	frozen_materials[key]=copy
	return copy

func bounds(node:Node3D)->AABB:
	var result=AABB(); var first=true
	for mesh in node.find_children("*","MeshInstance3D",true,false):
		if not mesh.visible or mesh.mesh==null: continue
		var box: AABB=mesh.global_transform*mesh.get_aabb()
		result=box if first else result.merge(box); first=false
	return result

func capture(item:Node3D,spec:Dictionary,mode:String,view:String,direction:Vector3,list:Array,extra:Node3D=null,metrics:Dictionary={}):
	var box=bounds(item)
	if extra!=null: box=box.merge(bounds(extra))
	var target=box.get_center()
	var span=maxf(.4,maxf(box.size.x,maxf(box.size.y,box.size.z))*1.28)
	camera.projection=Camera3D.PROJECTION_ORTHOGONAL
	camera.size=span; camera.position=target+direction.normalized()*maxf(3,span*3)
	camera.look_at(target,Vector3.BACK if absf(direction.normalized().y)>.99 else Vector3.UP)
	var record={"file":"%s/%s-%s.png"%[spec.id,mode,view],"mode":mode,"view":view,"span_m":span,"camera_direction":[direction.x,direction.y,direction.z]}
	record["resolution"]=[viewport.size.x,viewport.size.y]
	record.merge(metrics)
	if config.get("render",true):
		DirAccess.make_dir_recursive_absolute(folder.path_join(str(spec.id)))
		if mode=="model" and view=="front":
			# Imported material/texture uploads need a settled first draw. Subsequent
			# poses are already warm; do not accept a shader-cache-dependent first PNG.
			viewport.render_target_update_mode=SubViewport.UPDATE_ALWAYS
			await RenderingServer.frame_post_draw
			await RenderingServer.frame_post_draw
		viewport.render_target_update_mode=SubViewport.UPDATE_ONCE
		await RenderingServer.frame_post_draw
		check(viewport.get_texture().get_image().save_png(folder.path_join(record.file))==OK,"save "+record.file)
	list.append(record)

func capture_fps(item:Node3D,spec:Dictionary,hand:Node3D,list:Array):
	# The production rest offset and camera FOV, rather than a reframed studio view.
	hand.position=game.desktop_hand.position
	if spec.factory=="bow": game.archery.update_draw_visuals()
	if spec.factory=="wand":
		# This managed gadget follows the camera, not DesktopHand's rest offset.
		var previous=game.camera.global_transform
		game.camera.global_transform=Transform3D.IDENTITY
		game.magnetic_wand.holder=game.desktop_hand; game.magnetic_wand._pose()
		game.camera.global_transform=previous; game.magnetic_wand.holder=hand
	viewport.size=Vector2i(int(config.size),roundi(int(config.size)*9.0/16.0))
	camera.projection=Camera3D.PROJECTION_PERSPECTIVE
	camera.fov=game.camera.fov; camera.position=Vector3.ZERO; camera.basis=Basis.IDENTITY
	var record={"file":"%s/desktop-player.png"%spec.id,"mode":"desktop","view":"player","fov_degrees":camera.fov,"hand_position":[hand.position.x,hand.position.y,hand.position.z]}
	record["resolution"]=[viewport.size.x,viewport.size.y]
	if config.get("render",true):
		viewport.render_target_update_mode=SubViewport.UPDATE_ONCE
		await RenderingServer.frame_post_draw
		check(viewport.get_texture().get_image().save_png(folder.path_join(record.file))==OK,"save "+record.file)
	list.append(record); hand.position=Vector3.ZERO
	if spec.factory=="wand": game.magnetic_wand._pose()
	viewport.size=Vector2i(int(config.size),int(config.size))

func axis(origin:Vector3,direction:Vector3,color:Color):
	var node=MeshInstance3D.new(); stage.add_child(node)
	var shape=CylinderMesh.new(); shape.top_radius=0.0; shape.bottom_radius=.012; shape.height=.06
	node.mesh=shape; node.position=origin+direction*.24; node.quaternion=Quaternion(Vector3.UP,direction)
	var material=StandardMaterial3D.new(); material.albedo_color=color; material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED; node.material_override=material
	helpers.append(node)
	var line=MeshInstance3D.new(); stage.add_child(line)
	var mesh=ImmediateMesh.new(); mesh.surface_begin(Mesh.PRIMITIVE_LINES,material); mesh.surface_add_vertex(origin); mesh.surface_add_vertex(origin+direction*.22); mesh.surface_end()
	line.mesh=mesh; helpers.append(line)

func clear_helpers():
	for node in helpers: node.free()
	helpers.clear()

func pose_array(pose:Transform3D)->Array:
	return [pose.basis.x.x,pose.basis.x.y,pose.basis.x.z,pose.basis.y.x,pose.basis.y.y,pose.basis.y.z,pose.basis.z.x,pose.basis.z.y,pose.basis.z.z,pose.origin.x,pose.origin.y,pose.origin.z]
