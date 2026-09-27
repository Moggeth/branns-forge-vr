extends RefCounted

static func run(game,failures:Array):
	game.set_process(false)
	var actions=game.item_actions
	var hand=Node3D.new(); game.add_child(hand); hand.position=Vector3(500,50,500)
	var key=str(hand.get_instance_id())
	var saved_hp=game.adventure.hp; var elapsed=game.elapsed
	for id in ["apprentice_hammer","woodland_axe","quarry_pick","spore_lantern","crystal_resonator","ember_gauntlet"]:
		var item=game.adventure._tool_model(id); game.add_child(item)
		game.held[key]=item
		game.adventure.hp=50
		if not actions.trigger(hand,hand): failures.append("missing native alternate: "+id)
		if id=="woodland_axe" and (game.adventure.hp!=50 or not item.get_meta("axe_power_armed",false)): failures.append("axe trigger must arm a physical cleave without healing")
		if id=="quarry_pick" and float(item.get_meta("stonewhisper_charged_until",0))<=game.elapsed: failures.append("pick resonance did not charge")
		if id=="quarry_pick":
			var outward=0
			for part in item.get_children():
				if part is MeshInstance3D and part.mesh is CylinderMesh and absf(part.position.x)>.20 and absf(part.position.y-.59)<.02:
					if part.global_basis.y.x*signf(part.position.x)>0: outward+=1
			if outward!=2: failures.append("pick spikes do not point outward")
			var sample_ore=Node3D.new(); game.add_child(sample_ore); sample_ore.set_meta("requires","pick")
			actions.resonant_mine(item,sample_ore,hand.global_position,hand)
			if int(sample_ore.get_meta("resonant_bonus",0))!=1 or float(item.get_meta("stonewhisper_charged_until",-1))!=0: failures.append("pick charge did not enrich physical ore strike")
			sample_ore.free()
		if id=="crystal_resonator" and actions.projectiles.size()!=3: failures.append("resonance fan missing")
		if id=="spore_lantern" and actions.gardens.is_empty(): failures.append("spore garden missing")
		if id=="ember_gauntlet" and game.shield_until<=game.elapsed: failures.append("ember ward missing")
		item.free()
	game.held.erase(key)
	for shot in actions.projectiles: shot.node.queue_free()
	for garden in actions.gardens: garden.node.queue_free()
	actions.projectiles.clear(); actions.gardens.clear(); actions.cooldowns.clear()
	game.adventure.hp=saved_hp
	# Sweep a real body toward a real obstacle, including vertical travel.
	var old_rig=game.rig.global_position
	game.rig.global_position=Vector3(500,50,500)
	var offset=game.camera.global_position-game.rig.global_position
	var wall=Node3D.new(); game.add_child(wall)
	wall.global_position=game.rig.global_position+Vector3(offset.x,3,offset.z)
	WorkshopScene.collision(wall,Vector3.ZERO,Vector3(4,0.2,4))
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	var before=game.rig.global_position
	var fraction=actions.move_rig(Vector3.UP*5)
	if fraction>=1 or game.rig.global_position.y>=wall.global_position.y: failures.append("grapple sweep passed through overhead obstacle")
	if game.rig.global_position.y<=before.y: failures.append("grapple cannot lift player")
	wall.free()
	game.rig.global_position=Vector3(500,50,500)
	var anchor=Node3D.new(); game.add_child(anchor)
	anchor.global_position=Vector3(500,53,495); anchor.set_meta("kind","anchor"); anchor.set_meta("destination",Vector3(500,52,496))
	WorkshopScene.collision(anchor,Vector3.ZERO,Vector3.ONE)
	var hook=game.adventure._tool_model("grappling_hook"); game.add_child(hook); hook.global_position=hand.global_position
	game.held[key]=hook; hand.look_at(anchor.global_position)
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	actions.trigger(hand,hand)
	if actions.grapple.is_empty(): failures.append("grapple failed to latch real surface")
	else:
		var mouse=InputEventMouseButton.new(); mouse.button_index=MOUSE_BUTTON_LEFT; mouse.pressed=true; Input.parse_input_event(mouse); Input.flush_buffered_events()
		var distance=game.rig.global_position.distance_to(actions.grapple.goal)
		for i in range(10): actions.tick(0.05)
		if game.rig.global_position.distance_to(actions.grapple.goal)>=distance: failures.append("holding trigger did not reel")
		if not actions.tether.visible or actions.tether.mesh==null: failures.append("grapple rope missing")
		mouse.pressed=false; Input.parse_input_event(mouse.duplicate()); Input.flush_buffered_events()
		var paused=game.rig.global_position; actions.tick(0.1)
		if not game.rig.global_position.is_equal_approx(paused): failures.append("release trigger did not pause reel")
		game.held.erase(key); actions.tick(0.01)
		if not actions.grapple.is_empty(): failures.append("dropping hook did not detach")
	actions.falling=false; game.held.erase(key); hook.free(); anchor.free()
	game.rig.global_position=old_rig
	var sample=preload("res://siegebird_checks.gd").load_sample(game)
	if sample!=null:
		var system=game.siegebird; var w=system.weapons.back()
		for side in ["right_hand","left_hand"]:
			var tracked=XRController3D.new(); game.add_child(tracked); tracked.tracker=side
			game.grips._attach(tracked,sample); system.tick(0.016)
			var aim=game.aim_source(tracked)
			var expected=aim.global_basis.x*(-1 if side=="right_hand" else 1)
			if sample.global_basis.z.dot(expected)<0.999: failures.append("Siegebird wrist roll "+side)
			game.held.erase(str(tracked.get_instance_id())); game.grips.grips.erase(str(tracked.get_instance_id())); sample.reparent(game); tracked.free()
		var surface=Node3D.new(); game.add_child(surface); surface.position=Vector3(500,40,500)
		var bolt=system.make_bolt(); bolt.position=Vector3(500,51,500)
		var tip=bolt.to_global(bolt.get_meta("tip"))
		system.projectiles.append({"node":bolt,"velocity":Vector3(10,0,0),"until":game.elapsed+10,"hand":hand})
		system.tick(0.1)
		if bolt.to_global(bolt.get_meta("tip")).y>=tip.y: failures.append("bolt gravity missing")
		system.projectiles.clear(); system.embed(bolt,surface)
		var old=bolt.global_position; surface.position.x+=1; system.tick(0.01)
		if absf(bolt.global_position.x-old.x-1)>0.001: failures.append("embedded bolt did not follow surface")
		surface.free(); system.tick(0.01)
		if not is_instance_valid(bolt): failures.append("bolt destroyed with target")
		var bolt_anchor=Node3D.new(); game.add_child(bolt_anchor)
		for i in range(22): system.embed(system.make_bolt(),bolt_anchor)
		if system.embedded.size()!=20: failures.append("embedded bolt cap")
		game.elapsed+=121; system.tick(0.01)
		if not system.embedded.is_empty(): failures.append("embedded bolt expiry")
		bolt_anchor.free(); system.weapons.erase(w); sample.free()
	game.elapsed=elapsed; hand.free(); game.set_process(true)
	print("ITEM_ACTION_CHECK actions / vertical sweep / mirrored roll / gravity / embedding / cap / expiry ",JSON.stringify(failures))

static func profile(game):
	var sample=preload("res://siegebird_checks.gd").load_sample(game)
	if sample==null: return
	var surface=Node3D.new(); game.add_child(surface)
	WorkshopScene.box(surface,Vector3(0,1.4,-1),Vector3(3.4,1.8,0.12),WorkshopScene.material("705f49"))
	game.camera.global_position=Vector3(0,1.8,3)
	game.camera.look_at(Vector3(0,1.4,-1))
	sample.hide()
	for count in [0,20]:
		if count==20:
			for i in range(20):
				var bolt=game.siegebird.make_bolt()
				bolt.rotation.x=-PI/2
				bolt.global_position=Vector3((i%5-2)*0.55,0.85+floorf(i/5.0)*0.35,-0.70)
				game.siegebird.embed(bolt,surface)
		for i in range(30): await game.get_tree().process_frame
		var samples=[]; var begin=Time.get_ticks_usec()
		for i in range(120):
			await game.get_tree().process_frame
			var measured=Time.get_ticks_usec()
			game.siegebird.tick(0.0)
			samples.append((Time.get_ticks_usec()-measured)/1000.0)
		samples.sort()
		print("BOLT_PROFILE ",JSON.stringify({"bolts":count,"median_bolt_update_ms":samples[60],"wall_seconds":(Time.get_ticks_usec()-begin)/1000000.0,"draw_calls":Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME),"objects":Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)}))
