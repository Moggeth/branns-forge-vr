extends SceneTree
var game
var fairy
var creek
var checks=0
var failures=[]
var idle={"stick":Vector3.ZERO,"boost":false,"brake":false}
func check(ok,message):
	checks+=1
	if not ok: failures.append(message); print("CREEK_ASSERT ",message)
func _initialize(): run.call_deferred()
func advance(seconds):
	for i in range(ceili(seconds/.1)):
		game.elapsed+=.1; game.firecraft.fluid.tick(.1); creek.tick(.1)
func touch_oil():
	var field=creek.field(); var best=-1; var volume=0.0
	for i in range(field.fuel.size()):
		if field.fuel[i]>volume: volume=field.fuel[i]; best=i
	if best<0: return
	var match_item=fairy.carry
	fairy.orientation=Basis.IDENTITY
	var offset=Vector3(0,-.045,-.07)+match_item.transform*Vector3(0,.115,0)
	fairy.avatar.global_position=field.point(best)+Vector3.UP*.10-offset
	fairy.held_heat_tip=Vector3.INF
	fairy.tick(.02,idle); creek.tick(.02)
func tap_control(action):
	for node in creek.court.get_children():
		if node.get_meta("action","")=="creek:"+action:
			fairy.avatar.global_position=node.global_position+Vector3(0,0,1); fairy.orientation=Basis.IDENTITY; fairy.next_world_control=0
			fairy.shoot(false); return
	check(false,"Control not found: "+action)
func run():
	game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true; game._start_fairy(); fairy=game.fairy; fairy.test_mode=true; fairy.window.hide(); creek=game.ember_creek
	game._button("creek:visit"); fairy.tick(.02,idle)
	await physics_frame; await physics_frame
	while not game.firecraft.fluid.fields[creek.ZONE].ready: game.firecraft.fluid.scan(game.firecraft.fluid.fields[creek.ZONE])
	check(game.adventure.zone==creek.ZONE and creek.stage==0,"Real visit action starts creek without VR hands")
	creek.act("water"); creek.act("dry"); check(creek.stage==0,"Out-of-order valves cannot solve challenge")
	creek.act("match"); check(is_instance_valid(fairy.carry) and game.firecraft._burning(fairy.carry),"Solo match dispenser equips actual lit match without XR hands")
	tap_control("oil"); check(creek.field().total_fuel()>7.9,"Oil tap admits finite shared-grid volume")
	touch_oil(); check(creek.basin_fire() and creek.stage==1,"Carried match tip ignites shared spill and advances stage")
	advance(.3); await capture("01-burning-creek.png"); var before=creek.field().total_fuel(); tap_control("water")
	check(creek.stage==2 and not creek.basin_fire(),"Water valve actually extinguishes burning shared cells")
	check(creek.field().total_fuel()>=before-.001,"Water leaves unburnt fuel for reuse")
	touch_oil(); check(not creek.basin_fire() and creek.stage==2,"Wet fuel refuses immediate relight")
	tap_control("dry"); touch_oil(); check(creek.stage==3 and creek.basin_fire(),"Bellows dries existing wetness so same fuel reignites")
	advance(2); check(creek.gate.position.y>4,"Physical gate opens after complete fluid sequence")
	fairy.drop(); creek.act("match")
	var item=fairy.carry; var offset=Vector3(0,-.045,-.07)+item.transform*Vector3(0,.115,0)
	fairy.avatar.global_position=creek.carving()+Vector3.FORWARD*.5-offset; fairy.tick(.02,idle); creek.tick(.1)
	check(creek.stage==4 and creek.reveal.visible,"Carried live fire reveals actual carving beyond gate")
	advance(.6); await capture("02-creek-carving.png")
	var held_before=fairy.carry; creek.reset()
	check(fairy.avatar.global_position.z>CENTER_Z_FOR_TEST(),"Reset safely returns fairy from beyond gate")
	check(creek.stage==0 and creek.field().total_fuel()==0 and not creek.reveal.visible and is_instance_valid(held_before) and fairy.carry==held_before,"Reset clears puzzle while preserving carried item")
	check(is_equal_approx(creek.gate.position.y,1.6) and creek.beacon.light_energy==0,"Reset closes gate and removes celebration light")
	creek.act("match"); check(fairy.carry==held_before,"Occupied fairy hands are never overwritten")
	creek.act("oil"); advance(2); creek.act("leave")
	check(game.adventure.zone=="forge_yard","Return action exits safely")
	var remaining=creek.field().total_fuel(); creek.act("oil"); check(is_equal_approx(creek.field().total_fuel(),remaining),"Off-zone tap action cannot add fuel")
	fairy.stop(); game.adventure.travel(creek.ZONE); var vr_before=game.vr; game.vr=true; creek.act("match"); game.vr=vr_before
	check(creek.supplies.size()>=2,"No-active-hand fallback creates reachable supply without null dereference")
	print("EMBER_CREEK_RESULT ",JSON.stringify({"checks":checks,"failures":failures})); quit(0 if failures.is_empty() else 1)

func CENTER_Z_FOR_TEST(): return creek.CENTER.z-3
func capture(name):
	if not OS.get_cmdline_user_args().has("--creek-capture"): return
	game.hud.get_parent().hide()
	game.camera.global_position=creek.CENTER+Vector3(6,3.3,7) if creek.stage<4 else creek.CENTER+Vector3(2,2.1,-4.8)
	game.camera.look_at(creek.basin() if creek.stage<4 else creek.carving())
	var folder=ProjectSettings.globalize_path("user://reviews/ember-creek")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--capture-output="): folder=arg.trim_prefix("--capture-output=")
	DirAccess.make_dir_recursive_absolute(folder)
	for i in range(15): await process_frame
	await RenderingServer.frame_post_draw
	root.get_texture().get_image().save_png(folder+"/"+name)
