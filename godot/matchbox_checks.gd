extends SceneTree
var failures=[]
func check(ok,message):
	if not ok: failures.append(message)
func _initialize(): run.call_deferred()
func run():
	var game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame; await physics_frame
	game.set_process(false); game.smoke=true; game.adventure.test_mode=true; game.adventure.travel("forge_yard")
	game._start_fairy(); var fairy=game.fairy; fairy.test_mode=true; fairy.window.hide()
	var box=game.firecraft.box
	for angle in [.15,.6,1.1]:
		game.firecraft._attach(game.desktop_hand,box); box.set_meta("velocity",Vector3.ZERO); game.firecraft.release(game.desktop_hand)
		var body=box.get_meta("body"); body.global_position=game.firecraft.stand.global_position+Vector3(-.45,1.4,0); body.global_basis=Basis(Vector3.FORWARD,angle)
		for frame in range(180): await physics_frame
		check(body.linear_velocity.length()<.035 and body.angular_velocity.length()<.08,"Dropped box settles without jitter at angle "+str(angle))
		check(absf(body.global_basis.y.dot(Vector3.UP))>.94,"Dropped box lands flat at angle "+str(angle))
	# An open tray used to add a second, overlapping contact hull. Exercise the
	# troublesome tabletop case with the drawer fully extended.
	var table=StaticBody3D.new(); root.add_child(table); table.global_position=Vector3(100,2,100)
	var table_shape=CollisionShape3D.new(); var top=BoxShape3D.new(); top.size=Vector3(2,.1,2); table_shape.shape=top; table.add_child(table_shape)
	game.firecraft._attach(game.desktop_hand,box)
	game.firecraft.opening=1.0; game.firecraft.target_open=1.0; game.firecraft.tray.position.z=.16
	box.set_meta("velocity",Vector3.ZERO); game.firecraft.release(game.desktop_hand)
	var open_body=box.get_meta("body"); open_body.global_position=Vector3(100,2.75,100); open_body.global_basis=Basis(Vector3.FORWARD,.75)
	var hulls=0
	for child in open_body.get_children():
		if child is CollisionShape3D: hulls+=1
	check(hulls==1,"Matchbox has one stable hull, even with drawer open")
	for frame in range(180): await physics_frame
	var settled=open_body.global_position
	for frame in range(60): await physics_frame
	check(open_body.linear_velocity.length()<.035 and open_body.angular_velocity.length()<.08,"Open matchbox rests without tabletop jitter")
	check(open_body.global_position.distance_to(settled)<.03,"Open matchbox does not wander across tabletop")
	check(absf(open_body.global_basis.y.dot(Vector3.UP))>.94,"Open matchbox lands flat on tabletop")
	table.queue_free()
	game.firecraft.opening=1; game.firecraft.target_open=1
	fairy.avatar.global_position=box.global_position+Vector3.UP*.15
	fairy.grab_or_drop(); check(is_instance_valid(fairy.carry) and fairy.carry.get_meta("fire_kind","")=="match","Normal pickup chooses individual match over open box")
	fairy.drop(); fairy.keys[KEY_SHIFT]=true; fairy.grab_or_drop()
	check(fairy.carry==box,"Shift pickup deliberately selects whole open box"); fairy.drop(); fairy.keys.clear()
	game.ember_gallery.act("visit"); var combat=game.firecraft.fluid; var entry=combat.fields.ember_gallery
	while not entry.ready: combat.scan(entry)
	var f=entry.field; f.heights.fill(0); f.fuel.fill(0); f.burning.fill(0); f.wet.fill(0); f.weather="clear"
	var spot=f.point(32*64+32)
	var lifetimes=[]
	for rate in [.002,.002/(1.5*1.5)]:
		f.fuel.fill(0); f.burning.fill(0); f.burn_age.fill(0); f.unlit_evaporation_rate=rate; f.pour(spot,8,false)
		var seconds=0.0
		while f.total_fuel()>.01 and seconds<300:
			f.simulation(.2); seconds+=.2
		lifetimes.append(seconds)
	check(lifetimes[1]>lifetimes[0]*1.25 and lifetimes[1]<lifetimes[0]*1.8,"Unlit spill has a modest approximately 50 percent longer lifetime")
	f.fuel.fill(0); f.burning.fill(0); f.burn_age.fill(0); f.pour(spot,8,true)
	for i in range(25): f.simulation(.2)
	check(f.flames.multimesh.visible_instance_count>0,"Molotov remains visibly burning at five seconds")
	for i in range(25): f.simulation(.2)
	check(f.total_fuel()<.01 and f.flames.multimesh.visible_instance_count==0,"Molotov exhausted by ten seconds")
	print("SPILL_LIFETIME baseline_seconds=",lifetimes[0]," revised_seconds=",lifetimes[1]," burning_target_seconds=",f.spill_burn_seconds," remaining_at_10=",f.total_fuel())
	print("MATCHBOX_CHECK_RESULT ",JSON.stringify({"failures":failures})); quit(0 if failures.is_empty() else 1)
