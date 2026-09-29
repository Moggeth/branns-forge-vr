extends RefCounted
const FLIGHT=preload("res://phoenix_flight.gd")

static func run(game):
	await game.get_tree().physics_frame
	game.set_process(false)
	var failures:Array=[]
	var assertions=0
	var check=func(condition:bool,label:String):
		if not condition: failures.append(label)
	var bow=game.archery
	check.call(is_instance_valid(bow.bow),"authored bow is installed"); assertions+=1
	if not is_instance_valid(bow.bow): print("PHOENIX_BOW_RESULT missing artist asset"); game.get_tree().quit(2); return
	check.call(game.collection.homes.has(bow.ID) and game.collection.homes[bow.ID].item==bow.bow,"persistent collection home"); assertions+=1
	check.call(not game.melee.handles(bow.bow),"archery excluded from generic melee"); assertions+=1
	for side in ["left_hand","right_hand"]:
		var controller=XRController3D.new(); controller.tracker=StringName(side); game.qol.tracking_space.add_child(controller)
		game.grips._attach(controller,bow.bow)
		var socket=game.hand_socket(controller)
		check.call((-bow.bow.global_basis.z).dot(-socket.global_basis.z)>.999,"arrow firing axis follows pointing finger "+side); assertions+=1
		var thumb=socket.global_basis.x*(1.0 if side=="left_hand" else -1.0)
		check.call(bow.bow.global_basis.y.dot(thumb)>.999,"bow grip crosses curled fingers "+side); assertions+=1
		game.held.erase(str(controller.get_instance_id())); game.grips.grips.erase(str(controller.get_instance_id())); bow.bow.reparent(game)
		controller.queue_free()
	var p=Vector3.ZERO; var v=Vector3.FORWARD*40; var t=0.0
	for i in 120:
		var s=FLIGHT.step(p,v,Vector3.ZERO,t,1.0/120.0); p=s.position; v=s.velocity; t=s.age
	check.call(absf(p.x)<0.00001 and p.z< -38 and p.y< -2.6,"ordinary arrows have forward velocity and gravity"); assertions+=1
	var curve=FLIGHT.gesture(Basis.IDENTITY,Vector3.ZERO,Basis(Vector3.UP,0.45),Vector3.ZERO)
	check.call(curve.length()>0.4 and curve.y>0,"left gesture creates left turn"); assertions+=1
	var right_curve=FLIGHT.gesture(Basis.IDENTITY,Vector3.ZERO,Basis(Vector3.UP,-0.45),Vector3.ZERO)
	check.call(right_curve.y<0 and is_equal_approx(right_curve.length(),curve.length()),"mirrored gesture is symmetric"); assertions+=1
	var shifted=FLIGHT.gesture(Basis.IDENTITY,Vector3.ZERO,Basis.IDENTITY,Vector3(0.30,0,0))
	check.call(shifted.y<0 and shifted.length()>0.2,"physical bow translation shapes arc"); assertions+=1
	var roll=FLIGHT.gesture(Basis.IDENTITY,Vector3.ZERO,Basis(Vector3.FORWARD,.4),Vector3.ZERO)
	check.call(roll.y<0 and roll.length()>.2,"rolling the bow also steers the arc"); assertions+=1
	check.call(FLIGHT.turn_fraction(2.0)==1 and FLIGHT.turn_fraction(0)==0,"turn is finite and ends in ballistic flight"); assertions+=1
	var a=FLIGHT.wing_basis(Vector3.FORWARD*30,curve,.2)
	var b=FLIGHT.wing_basis(Vector3.FORWARD*30,right_curve,.2)
	check.call(a.x.y*b.x.y<0 and absf(a.determinant()-1)<.001,"wings bank opposite directions and preserve orientation"); assertions+=1
	var preview=Vector3.ZERO; var live=Vector3.ZERO
	for rate in [45,180]:
		p=Vector3.ZERO; v=Vector3.FORWARD*40; t=0
		for i in rate:
			var s=FLIGHT.step(p,v,curve,t,1.0/rate); p=s.position; v=s.velocity; t=s.age
		if rate==45: preview=p
		else: live=p
	check.call(preview.distance_to(live)<.025,"preview and flight agree across different rates"); assertions+=1
	var draw_hand=Node3D.new(); game.add_child(draw_hand)
	# Owner lookup uses the normal desktop hand, with physical input sampled on
	# an independent draw-hand node, allowing exact repeatable VR gestures.
	game.held.clear(); game.grips.grips.clear()
	game.grips._attach(game.desktop_hand,bow.bow)
	game.desktop_hand.global_position=Vector3(10000,5,10000); game.desktop_hand.global_basis=Basis.IDENTITY
	draw_hand.global_position=bow.quiver_grab.global_position
	check.call(bow.sample_trigger(draw_hand,true) and bow.busy(draw_hand),"back trigger picks one arrow"); assertions+=1
	check.call(bow.nocked.is_empty(),"quiver retrieval does not teleport arrow to string"); assertions+=1
	draw_hand.global_position=bow.rest.global_position
	check.call(bow.try_nock(draw_hand),"physical nock near arrow rest"); assertions+=1
	draw_hand.global_position=bow.rest.global_position+Vector3.BACK*0.6
	bow.nocked.draw=0.6
	bow.begin_curve()
	bow.bow.rotate_y(.35)
	bow.curve_state.curve=FLIGHT.gesture(bow.curve_state.basis,bow.curve_state.origin,bow.bow.global_basis,bow.bow.global_position)
	check.call(bow.sample_trigger(draw_hand,false) and bow.shots.size()==1 and bow.shots[0].curve.length()>.3,"draw-trigger release launches shaped arrow"); assertions+=1
	check.call(not bow.busy(draw_hand) and bow.nocked.is_empty(),"release clears draw ownership"); assertions+=1
	var shot=bow.shots[0]
	bow._tick_shots(.08)
	check.call(shot.wings.visible and shot.node.global_position.distance_to(draw_hand.global_position)>1,"moving phoenix wings appear only in turn"); assertions+=1
	for s in bow.shots.duplicate(): bow._retire_shot(s)
	bow.bow.rotation=Vector3.ZERO
	draw_hand.global_position=bow.rest.global_position
	bow.sample_trigger(draw_hand,true); bow.try_nock(draw_hand); bow.nocked.draw=.02
	bow.sample_trigger(draw_hand,false)
	check.call(bow.shots.is_empty() and bow.carry.is_empty(),"tiny accidental draw cannot shoot"); assertions+=1
	bow.desktop_press(); bow.desktop_update(true,false,.6)
	check.call(bow.desktop_down and bow.nocked.draw>.45,"desktop left press draws conventional arrow"); assertions+=1
	bow.desktop_update(false,false,.01)
	check.call(bow.shots.size()==1 and bow.shots[0].curve==Vector3.ZERO,"desktop left release fires ordinary arrow"); assertions+=1
	for s in bow.shots.duplicate(): bow._retire_shot(s)
	bow.desktop_press(); bow.desktop_update(true,true,.3)
	bow.cancel_draw()
	check.call(bow.nocked.is_empty() and not bow.desktop_down,"cancel handles desktop arrow without shooting"); assertions+=1
	bow.desktop_press(); bow.desktop_update(true,false,.4)
	game.held.erase(str(game.desktop_hand.get_instance_id()))
	check.call(not bow.fire() and bow.nocked.is_empty(),"dropping bow cancels instead of firing"); assertions+=1
	game.grips._attach(game.desktop_hand,bow.bow)
	# A real physics surface checks swept collision and persistent embedding.
	var wall=StaticBody3D.new(); game.add_child(wall); wall.global_position=Vector3(10000,5,9995)
	game.camera.global_position=Vector3(10000,5,10000); game.camera.global_basis=Basis.IDENTITY
	game.desktop_hand.position=Vector3(.35,-.35,-.55); game.desktop_hand.basis=Basis.IDENTITY
	var collider=CollisionShape3D.new(); var shape=BoxShape3D.new(); shape.size=Vector3(8,8,.10); collider.shape=shape; wall.add_child(collider)
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	game.desktop_hand.global_basis=Basis.IDENTITY
	bow.desktop_press(); bow.desktop_update(true,false,.8); bow.desktop_update(false,false,.01)
	for i in 15: bow._tick_shots(1.0/60)
	check.call(bow.shots.is_empty() and bow.embedded.size()==1,"high-speed arrow embeds in thin physics surface"); assertions+=1
	if not bow.embedded.is_empty():
		var embedded_arrow=bow.embedded[0].node
		check.call(embedded_arrow.get_parent()==wall and bow.embedded[0].until-game.elapsed==150,"embedded arrow follows surface and persists"); assertions+=1
	wall.queue_free(); draw_hand.queue_free()
	print("PHOENIX_BOW_RESULT ",JSON.stringify({"checks":assertions,"failures":failures}))
	game.get_tree().quit(0 if failures.is_empty() else 1)
