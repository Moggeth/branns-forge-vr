extends SceneTree
var game
var fairy
var folder=""
func _initialize(): run.call_deferred()
func snap(viewport,file):
	for i in range(10): await process_frame
	await RenderingServer.frame_post_draw
	viewport.get_texture().get_image().save_png(folder+"/"+file)
func run():
	folder=ProjectSettings.globalize_path("res://../outputs/fairy-coop")
	DirAccess.make_dir_recursive_absolute(folder)
	game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true; game.adventure.travel("forge_yard")
	game._start_fairy(); fairy=game.fairy; fairy.test_mode=true; fairy.window.show(); fairy._focus_lost()
	game.hud.get_parent().hide()
	# Actual animated model and the game's normal hand geometry, posed for review.
	var palm=Node3D.new(); game.add_child(palm); palm.position=Vector3(1.7,1.3,1.0); game.adventure.build_hand(palm); palm.rotation.z=PI
	fairy.avatar.global_position=palm.global_position+Vector3.UP*.12; fairy.orientation=Basis.IDENTITY; fairy.attach(palm)
	fairy.art.animate(.05,0,true)
	game.camera.global_position=Vector3(1.7,1.57,.37); game.camera.look_at(fairy.avatar.global_position+Vector3.UP*.02)
	await snap(root,"01-little-wing-perched.png")
	fairy.toggle_view(); fairy.camera_position=fairy.avatar.global_position+Vector3(0,.2,1.1); fairy._camera_tick(.1); fairy._hud()
	await snap(fairy.window,"02-fairy-desktop-view.png")
	fairy.detach(Vector3.ZERO); fairy.avatar.global_position=Vector3(1,1.35,2)
	palm.hide()
	for i in range(4): fairy.leave_mark(Vector3(-.8+i*.5,.08,1.6),Vector3.UP,i)
	game.camera.global_position=Vector3(.1,1.5,3.5); game.camera.look_at(Vector3(.1,.2,1.5))
	await snap(root,"03-dust-markers.png")
	fairy.avatar.global_position=Vector3(1.7,1.4,1); fairy.art.basis=Basis.IDENTITY
	var match_item=game.firecraft._prop("match",fairy.avatar.global_position); fairy.pick_up(match_item); game.firecraft._light(match_item); fairy.art.animate(.03,.7,false)
	fairy.carrier.global_transform=Transform3D(Basis.IDENTITY,fairy.avatar.global_position+Vector3(0,-.045,-.07))
	game.camera.global_position=Vector3(1.7,1.5,.35); game.camera.look_at(fairy.avatar.global_position)
	await snap(root,"04-carrying-fire.png")
	game.camera.global_position=Vector3(4.5,1.6,4.5); game.camera.look_at(Vector3(4.65,1.0,3.5))
	await snap(root,"05-common-goods.png")
	fairy.drop(); game.firecraft._extinguish(match_item)
	var matchbox=game.firecraft.box
	var new_match=game.firecraft._prop("match",matchbox.global_position)
	fairy.avatar.global_position=matchbox.global_position+Vector3(.28,.08,.12)
	fairy.orientation=Basis.looking_at(matchbox.global_position-fairy.avatar.global_position)
	fairy.art.basis=fairy.orientation
	fairy.carrier.global_transform=Transform3D(fairy.orientation,fairy.avatar.global_position+fairy.orientation*Vector3(0,-.045,-.07))
	fairy.pick_up(new_match); fairy.use_supply()
	game.camera.cull_mask=0xFFFFF & ~fairy.Art.BODY_LAYER
	game.camera.global_position=fairy.avatar.global_position+Vector3.UP*.04; game.camera.look_at(matchbox.global_position+Vector3(.096,0,0))
	for frame in range(46):
		game.elapsed+=.02; fairy.handheld.tick(.02); fairy.art.animate(.02,0,false); game.firecraft.tick(.02)
		if frame==7: await snap(root,"06-match-windup.png")
		if frame==23: await snap(root,"07-match-scrape.png")
		if frame==31: await snap(root,"08-match-ignition.png")
	var vp=fairy.window.get_viewport_rid(); RenderingServer.viewport_set_measure_render_time(vp,true)
	var samples=[]
	for i in range(150):
		fairy.art.animate(1.0/60,0,false)
		await process_frame; await RenderingServer.frame_post_draw
		if i>=30: samples.append(RenderingServer.viewport_get_measured_render_time_gpu(vp))
	samples.sort()
	var data={"device":RenderingServer.get_video_adapter_name(),"samples":samples.size(),"fairy_view_resolution":str(fairy.window.size),"gpu_median_ms":samples[60],"gpu_p95_ms":samples[114],"fairy_meshes":fairy.art.find_children("*","MeshInstance3D",true,false).size(),"note":"Desktop secondary-window render only; both windows visible. Not stereo VR frame time or hardware controller acceptance."}
	var file=FileAccess.open(folder+"/performance.json",FileAccess.WRITE); file.store_string(JSON.stringify(data,"  ")); file.close()
	print("FAIRY_CAPTURE_RESULT ",JSON.stringify(data)); quit()
