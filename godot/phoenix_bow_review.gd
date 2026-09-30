extends RefCounted
## Offline, actual-engine hand/arrow clearance plate. No service or XR session.
const HAND_ANIMATION=preload("res://hand_animation.gd")

static func run(game,output:String):
	game.set_process(false)
	game.get_window().size=Vector2i(1600,1200)
	var folder=output.get_base_dir()
	DirAccess.make_dir_recursive_absolute(folder)
	for canvas in game.find_children("*","CanvasLayer",true,false): canvas.visible=false
	for control in game.find_children("*","Control",true,false): control.hide()
	for light in game.find_children("*","Light3D",true,false): light.hide()
	var camera=Camera3D.new(); game.add_child(camera)
	camera.current=true; camera.projection=Camera3D.PROJECTION_ORTHOGONAL; camera.size=1.55
	var environment=Environment.new()
	environment.background_mode=Environment.BG_COLOR; environment.background_color=Color("363c43")
	environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color=Color("e1e6ee"); environment.ambient_light_energy=0.50
	environment.tonemap_mode=Environment.TONE_MAPPER_FILMIC; environment.glow_enabled=false
	camera.environment=environment
	var centre=Vector3(10000,5,10000)
	for light in [[Vector3(-1,2,1),1.3],[Vector3(1,0,-2),0.7]]:
		var sun=DirectionalLight3D.new(); game.add_child(sun)
		sun.global_position=centre+light[0]; sun.look_at(centre)
		sun.light_energy=light[1]; sun.shadow_enabled=false
	var archery=game.archery
	archery.cancel_draw()
	archery.hint.hide(); archery.quiver.hide(); archery.preview.hide()
	var records=[]
	var failed=false
	for side in ["left_hand","right_hand"]:
		var holder=XRController3D.new(); holder.tracker=StringName(side); game.add_child(holder)
		var drawing=XRController3D.new(); drawing.tracker=StringName("right_hand" if side=="left_hand" else "left_hand"); game.add_child(drawing)
		game.hands.append(holder); game.hands.append(drawing)
		game.adventure.build_hand(holder); game.adventure.build_hand(drawing)
		game.grips._attach(holder,archery.bow)
		var pose:Transform3D=archery.bow.get_meta("grip_preferences")[side]
		var socket=game.hand_socket(holder)
		holder.global_transform=Transform3D(Basis.IDENTITY,centre)*pose.affine_inverse()*socket.transform.affine_inverse()
		drawing.set_meta("archery_arrow",true)
		HAND_ANIMATION.tick(holder,true,.25); HAND_ANIMATION.tick(drawing,true,.25)
		var arrow=archery.arrow_scene.instantiate(); game.add_child(arrow)
		for draw in [0.0,0.55]:
			var nock=archery.rest.global_position+archery.bow.global_basis.z*draw
			var draw_socket=game.hand_socket(drawing)
			var draw_basis=Basis(Vector3.UP,.10 if side=="left_hand" else -.10)
			var draw_transform=Transform3D(draw_basis,nock-draw_basis*archery.HAND_NOCK)
			drawing.global_transform=draw_transform*draw_socket.transform.affine_inverse()
			archery.nocked={"node":arrow,"hand":drawing,"draw":draw,"desktop":false}
			arrow.global_transform=Transform3D(Basis.IDENTITY,nock)
			archery.update_draw_visuals()
			var stem="%s-%s"%[side.trim_suffix("_hand"),"braced" if draw==0.0 else "drawn"]
			for angle in ["quarter","side"]:
				camera.global_position=centre+(Vector3(1.3,.25,2.3) if angle=="quarter" else Vector3(2.5,.08,.25))
				camera.look_at(centre+Vector3(0,.04,.19))
				await RenderingServer.frame_post_draw
				var path=folder.path_join("mechanics-%s-%s.png"%[stem,angle])
				var result=game.get_viewport().get_texture().get_image().save_png(path)
				failed=failed or result!=OK
				records.append({"file":path.get_file(),"side":side,"draw_m":draw,"view":angle})
		archery.nocked.clear(); arrow.free()
		game.held.erase(str(holder.get_instance_id())); game.grips.grips.erase(str(holder.get_instance_id()))
		archery.bow.reparent(game)
		game.hands.erase(holder); game.hands.erase(drawing)
		holder.free(); drawing.free()
	var file=FileAccess.open(folder.path_join("mechanics.json"),FileAccess.WRITE)
	if file==null: failed=true
	else: file.store_string(JSON.stringify({"views":records,"renderer":"Godot actual imported bow and articulated game gloves; synthetic controller poses","headset_acceptance":false},"\t")); file.close()
	print("EMBERWING_MECHANICS_PREVIEW ",JSON.stringify({"views":records.size(),"failed":failed,"folder":folder}))
	game.get_tree().quit(1 if failed else 0)
