extends SceneTree
var failures=[]
var count=0
func check(ok,label):
	count+=1
	if not ok: failures.append(label)
func _initialize(): run.call_deferred()
func run():
	var game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true
	game.ember_gallery.act("visit"); await physics_frame
	var gallery=game.ember_gallery; var system=gallery.lamplighting; var lamp=system.lamps[0]
	var point=lamp.root.global_position+Vector3.UP
	check(system.lamps.size()==3 and system.channels.size()==29,"Bounded three lamps and 29 channel cells")
	check(not lamp.lit and lamp.fuel==0,"Lamps start empty and dark")
	check(system.touch(point,.3,false)==0,"Empty lamp cannot ignite")
	var oil=gallery.vessels[0]; var water=gallery.vessels[1]; var moon=gallery.vessels[2]
	var before=float(oil.get_meta("remaining"))
	check(is_equal_approx(gallery.pour_at(oil,point,2),2.0),"Actual oil vessel fills reservoir")
	check(is_equal_approx(float(oil.get_meta("remaining")),before-2),"Accepted oil deducted from can")
	check(is_equal_approx(system.pour(point,"oil",100),2.0) and lamp.fuel==4,"Reservoir clamps to capacity")
	check(system.pour(point,"glimmer",1)==0,"Moonwater is not lamp fuel")
	check(game.firecraft.fluid.ignite_near(point,.3)>0 and lamp.lit,"Shared torch heat interface ignites lamp")
	system.tick(1); check(lamp.fuel<4 and lamp.light.light_energy>0,"Burning consumes oil and casts useful light")
	var fuel=lamp.fuel; gallery.pour_at(water,point,.2)
	check(not lamp.lit and lamp.wet>0 and lamp.fuel==fuel,"Water snuffs flame without erasing stored oil")
	system.touch(point,.3,false); check(not lamp.lit,"Wet wick cannot instantly reignite")
	system.tick(8.1)
	var match_item=game.firecraft._prop("match",point-Vector3.UP*.015); game.firecraft._light(match_item)
	system.tick(.02); check(lamp.lit,"Real burning match relights a dry wick")
	game.firecraft._extinguish(match_item)
	var lamp_fuel=lamp.fuel; game.adventure.travel("forge_yard"); system.tick(10)
	check(lamp.fuel==lamp_fuel,"Unvisited zone pauses reservoir consumption")
	check(system.pour(point,"oil",1)==0,"Other zones cannot fill gallery lamps")
	game.adventure.travel(gallery.ZONE)
	check(gallery.pour_at(moon,point,1)==0,"Moonwater refuses incorrect surface without consuming it")
	var moon_before=float(moon.get_meta("remaining")); var total=0.0
	for i in range(100): total+=gallery.pour_at(moon,system.inlet,.1); system.tick(.1)
	var stored=0.0
	for cell in system.channels: stored+=cell.fuel
	check(is_equal_approx(stored,total),"Channel flow conserves every accepted unit")
	check(is_equal_approx(moon_before-float(moon.get_meta("remaining")),total),"Finite moonwater supply matches stored amount")
	check(system.reveal.visible and system.channel_light.light_energy>0,"Flow reaches alcove and illuminates discovery")
	check(system.channels.all(func(c):return c.fuel>=0 and c.fuel<=system.CELL_CAPACITY+.00001),"All channel capacities bounded")
	check(system.channels.all(func(c):return c.mesh.scale.y<=.0181) and lamp.flame.scale.y<.32,"Animation retains authored fluid depth and flame dimensions")
	var last=system.channels.back(); var wet_before=last.fuel
	check(system.pour(last.mesh.global_position,"water",.1)>0 and last.fuel<wet_before,"Water washes luminous channel fluid away")
	check(system.lamps.all(func(l):return not l.light.shadow_enabled) and not system.channel_light.shadow_enabled,"No extra dynamic shadow maps")
	system.reset(); check(system.lamps.all(func(l):return l.fuel==0 and not l.lit) and system.channels.all(func(c):return c.fuel==0),"Reset cleans reservoirs and channels")
	if OS.get_cmdline_user_args().has("--lamp-capture"):
		for l in system.lamps: system.pour(l.root.global_position+Vector3.UP,"oil",3); system.touch(l.root.global_position+Vector3.UP,.4,false)
		for cell in system.channels: cell.fuel=system.CELL_CAPACITY
		system.tick(.01); game.hud.get_parent().hide()
		game.camera.global_position=gallery.CENTER+Vector3(4.5,2,-1); game.camera.look_at(gallery.CENTER+Vector3(8,1,-4.5))
		for i in range(12): await process_frame
		await RenderingServer.frame_post_draw
		var path=ProjectSettings.globalize_path("res://../outputs/ember-lamplighting.png"); root.get_texture().get_image().save_png(path)
		var rid=root.get_viewport_rid(); RenderingServer.viewport_set_measure_render_time(rid,true); var samples=[]
		for i in range(120):
			await process_frame; await RenderingServer.frame_post_draw
			samples.append(RenderingServer.viewport_get_measured_render_time_gpu(rid))
		samples.sort(); print("LAMP_GPU_RESULT ",JSON.stringify({"median_ms":samples[60],"p95_ms":samples[114],"samples":120,"scope":"desktop gallery view only; VR unverified"}))
	print("LAMPLIGHTING_CHECK_RESULT ",JSON.stringify({"checks":count,"failures":failures})); quit(0 if failures.is_empty() else 1)
