extends Node
var failures=[]
var count=0
func check(ok,message):
	count+=1
	if not ok: failures.append(message); print("EMBER_ASSERT ",message)
func pose(game,at,target):
	game.camera.global_position=at; game.camera.look_at(target); game.desktop_hand.transform=Transform3D(Basis.IDENTITY,Vector3(.35,-.35,-.55))
func run(game,phase):
	var gallery=game.ember_gallery; var fluid=game.firecraft.fluid; var torch=game.hearth_torch
	gallery.act("visit")
	await get_tree().physics_frame; await get_tree().physics_frame
	check(fluid!=null,"Surface fuel is enabled in the playable showcase")
	check(not gallery.persistence_enabled,"Offline diagnostic cannot write normal gallery progress")
	check(game.adventure.zone==gallery.ZONE and gallery.court.visible,"Travel reveals actual gallery")
	if phase=="ember-resume":
		check(gallery.state.trail and gallery.state.water and gallery.state.discovery,"All earned seals restore in a fresh process")
		check(fluid.fields.is_empty() or fluid.remaining_fuel()==0,"Transient spills are not replayed on relaunch")
		check(game.demo_session.save_now(),"Restored snapshot remains writable")
		check(game.demo_session.reset(),"Explicit demo reset remains available")
		check(not gallery.state.trail and not gallery.state.water and not gallery.state.discovery and not fluid.fields.has(gallery.ZONE),"Confirmed reset clears new seals and transient gallery field")
		return failures
	if phase=="ember-capture":
		await capture(game); return failures
	var hand=game.desktop_hand
	var oil=gallery.vessels[0]; var water=gallery.vessels[1]
	pose(game,oil.global_position+Vector3(0,.4,2),oil.global_position+Vector3.UP*.18)
	check(game._grip(hand,true) and gallery.busy(hand),"Real aiming ray and main grip pick up oil")
	check(not game.adventure.keyboard(_click()),"Held vessel blocks bomb formation")
	game._trigger(hand,true); check(oil.get_meta("open"),"Main trigger opens finite oil valve")
	pose(game,gallery.CENTER+Vector3(-4,1.7,3),gallery.CENTER+Vector3(-4,.1,0))
	var before=float(oil.get_meta("remaining"))
	for i in range(40):
		game.elapsed+=.05; gallery.tick(.05); fluid.tick(.05)
		await get_tree().physics_frame
	check(float(oil.get_meta("remaining"))<before-3,"Continuous desktop stream consumes measured fuel")
	check(fluid.remaining_fuel()>3,"Continuous pour creates visible retained fuel")
	check(oil.get_meta("stream").visible,"Stream links spout and hit surface")
	check(oil.get_meta("stream").basis.x.length()<.04,"Stream retains authored narrow diameter")
	game._trigger(hand,true); check(not oil.get_meta("open"),"Valve closes")
	game.adventure.release(hand,true); await get_tree().physics_frame
	check(not gallery.busy(hand) and oil.has_meta("body"),"Release creates physical can")
	check(oil.get_meta("body").collision_layer==8,"Loose vessel does not block player capsule")
	gallery.home(); await get_tree().physics_frame
	pose(game,water.global_position+Vector3(0,.4,2),water.global_position+Vector3.UP*.18)
	check(game._grip(hand,true) and game.held.get(str(hand.get_instance_id()))==water,"Water is physically retrievable after oil")
	game.adventure.release(hand,true); gallery.home()
	# Actual bottle release/rigid collision makes a new puddle, not a direct impact call.
	pose(game,gallery.CENTER+Vector3(0,1.7,4),gallery.CENTER+Vector3(0,.2,-4))
	gallery.act("bottle"); var bottle=game.held.get(str(hand.get_instance_id()))
	check(is_instance_valid(bottle) and bottle.get_meta("state")=="fresh","Supply provides an unlit physical bottle")
	game.adventure.release(hand,true)
	check(bottle.get_meta("body").linear_velocity.length()>7,"Desktop E throws bottle forwards")
	for i in range(100): await get_tree().physics_frame
	check(not is_instance_valid(bottle) or bottle.get_meta("shattered",false),"Bottle shatters through real collision")
	# Continuous trail in a shallow basin: conserved fuel, contact ignition, extinction.
	var base=gallery.CENTER+Vector3(-4,.12,0)
	for i in range(7): fluid.pour(base+Vector3(0,0,-i*.3),gallery.ZONE,2.0,false)
	var entry=fluid.fields[gallery.ZONE]
	while not entry.ready: fluid.scan(entry)
	var f=entry.field
	check(fluid.ignite_near(base,.5)>0,"Torch-sized flame contact ignites fuel")
	for i in range(35): f.simulation(.1); gallery.tick(.1)
	check(gallery.state.trail,"A real spreading flame front earns trail seal")
	gallery.pour_at(water,base,1)
	check(f.wet[f.cell_index(base)]>.8,"Water leaves a wet firebreak")
	for i in range(4): gallery.pour_at(water,base+Vector3(0,0,-i*.3),.5)
	check(gallery.state.water,"Extinguishing fire earns water seal")
	var kept=fluid.remaining_fuel(); gallery.act("leave"); fluid.tick(0)
	check(not f.visible and is_equal_approx(kept,fluid.remaining_fuel()),"Leaving pauses and hides puddles")
	gallery.act("visit"); fluid.tick(0)
	check(f.visible,"Returning preserves existing surface field")
	torch.home(); pose(game,torch.torch.global_position+Vector3(0,.1,2),torch.torch.global_position)
	check(game._grip(hand,true) and torch.busy(hand),"Main ray retrieves gallery torch")
	game._trigger(hand,true); check(not torch.lit,"Main trigger snuffs torch")
	game._trigger(hand,true); torch.tick(.1); check(torch.lit and torch.light.light_energy>2 and torch.light.shadow_enabled,"Kindled torch really illuminates with shadows")
	pose(game,gallery.CENTER+Vector3(7,1.6,-4.5),gallery.CENTER+Vector3(8.6,1.5,-5)); torch.tick(.1); gallery.tick(.1)
	check(gallery.state.discovery,"Carried functional light discovers shadow alcove")
	game.adventure.release(hand,true); check(not torch.busy(hand),"Torch main release clears ownership")
	check(game.demo_session.save_now(),"Gallery seals persist through demo adapter")
	var forged=gallery.fresh_state(); forged.revision=[]; check(not gallery._valid(forged),"Malformed revision rejected without crash")
	print("EMBER_WALKTHROUGH ",JSON.stringify({"checks":count,"failures":failures,"fuel":fluid.active_counts()}))
	return failures
func _click():
	var event=InputEventMouseButton.new(); event.button_index=MOUSE_BUTTON_LEFT; event.pressed=true; return event
func capture(game):
	var gallery=game.ember_gallery; var fluid=game.firecraft.fluid; var torch=game.hearth_torch
	var folder=ProjectSettings.globalize_path("res://../outputs/ember-gallery")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--ember-output="): folder=arg.trim_prefix("--ember-output=")
	DirAccess.make_dir_recursive_absolute(folder)
	game.hud.get_parent().hide(); game.qol.menu.hide()
	pose(game,gallery.CENTER+Vector3(1.2,2.3,8.8),gallery.CENTER+Vector3(-1.4,1.6,-2))
	torch.home(); torch.set_lit(false)
	await snap(game,folder+"/01-moonlit-stillhouse.png")
	# Same camera, only torch changes: genuine warm light reveals copper and stone.
	pose(game,gallery.CENTER+Vector3(7.3,1.65,-3.8),gallery.CENTER+Vector3(9.4,1.4,-5))
	torch.torch.reparent(game); torch.torch.global_position=gallery.CENTER+Vector3(7.5,1.1,-5.3)
	torch.set_lit(false); torch.tick(.02)
	await snap(game,folder+"/02-alcove-unlit.png")
	torch.set_lit(true); torch.tick(.02)
	await snap(game,folder+"/03-alcove-torch.png")
	pose(game,gallery.CENTER+Vector3(.4,2.2,4),gallery.CENTER+Vector3(-3.9,.6,-2))
	for i in range(12): fluid.pour(gallery.CENTER+Vector3(-4,.14,1-i*.42),gallery.ZONE,8,false)
	var entry=fluid.fields[gallery.ZONE]
	while not entry.ready: fluid.scan(entry)
	fluid.ignite_near(gallery.CENTER+Vector3(-4,.12,1),.7)
	for i in range(35): game.elapsed+=.1; fluid.tick(.1); gallery.tick(.1)
	torch.torch.global_position=game.camera.global_position+Vector3(1.2,-.2,.8)
	torch.tick(.02)
	await snap(game,folder+"/04-river-of-fire.png")
	# Repeatable full-capacity GPU load. Simulation is frozen during GPU measurement.
	entry.field.fuel.fill(0); entry.field.burning.fill(0); entry.field.wet.fill(0)
	for z in range(5):
		for x in range(8): fluid.pour(gallery.CENTER+Vector3(-7+x*1.6,.14,1-z*1.5),gallery.ZONE,8,true)
	fluid.tick(.1)
	var stress_start=fluid.active_counts()
	check(stress_start.fuel>300,"GPU stress admits approximately forty bottles")
	await snap(game,folder+"/05-forty-potion-stress.png")
	var viewport=game.get_viewport().get_viewport_rid(); RenderingServer.viewport_set_measure_render_time(viewport,true)
	var gpu=[]; var cpu=[]; var frame=[]; var before=Time.get_ticks_usec()
	for i in range(210):
		await get_tree().process_frame
		game.elapsed+=1.0/60; entry.field.tick_fire_lights(1.0/60); torch.tick(1.0/60)
		await RenderingServer.frame_post_draw
		if i>=30:
			gpu.append(RenderingServer.viewport_get_measured_render_time_gpu(viewport)); cpu.append(RenderingServer.viewport_get_measured_render_time_cpu(viewport)); frame.append((Time.get_ticks_usec()-before)/1000.0)
		before=Time.get_ticks_usec()
	gpu.sort(); cpu.sort(); frame.sort()
	var result={"device":RenderingServer.get_video_adapter_name(),"resolution":str(game.get_viewport().get_visible_rect().size),"samples":gpu.size(),"gpu_median_ms":gpu[90],"gpu_p95_ms":gpu[171],"render_cpu_median_ms":cpu[90],"wall_frame_median_ms":frame[90],"wall_frame_p95_ms":frame[171],"draw_calls":RenderingServer.viewport_get_render_info(viewport,RenderingServer.VIEWPORT_RENDER_INFO_TYPE_VISIBLE,RenderingServer.VIEWPORT_RENDER_INFO_DRAW_CALLS_IN_FRAME),"fuel":fluid.active_counts(),"stress_start":stress_start,"note":"Desktop mono GPU rendering at fixed 40-bottle load; fluid consumption paused. Not stereo VR or complete game frame time."}
	var file=FileAccess.open(folder+"/performance.json",FileAccess.WRITE); file.store_string(JSON.stringify(result,"  ")); file.close()
	print("EMBER_GPU_RESULT ",JSON.stringify(result))
	entry.field.fuel.fill(0); entry.field.burning.fill(0); entry.field.wet.fill(0); entry.field.update_fluid_visuals()
	gallery.home(); torch.home(); torch.set_lit(true)
	var oil=gallery.vessels[0]
	pose(game,oil.global_position+Vector3(0,.4,2),oil.global_position+Vector3.UP*.18)
	await get_tree().physics_frame
	game._grip(game.desktop_hand,true)
	pose(game,gallery.CENTER+Vector3(3,1.65,2.4),gallery.CENTER+Vector3(4,.15,0))
	game._trigger(game.desktop_hand,true)
	torch.torch.reparent(game); torch.torch.global_position=game.camera.global_position+Vector3(.6,-.2,.6)
	torch.tick(.02)
	for i in range(6): gallery.tick(.1); fluid.tick(.1)
	check(gallery.busy(game.desktop_hand) and oil.get_meta("stream").visible,"Captured pouring uses actual held vessel and narrow stream")
	await snap(game,folder+"/06-physical-pouring.png")
	game.adventure.release(game.desktop_hand,true); gallery.home()

func snap(game,path):
	for i in range(8): await get_tree().process_frame
	await RenderingServer.frame_post_draw
	game.get_viewport().get_texture().get_image().save_png(path)
