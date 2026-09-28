extends RefCounted

static func load_sample(game):
	var file=game.siegebird.ASSEMBLY_PATH
	# Review a commission in the actual mechanism without replacing the installed asset.
	for argument in OS.get_cmdline_user_args():
		if argument.begins_with("--siegebird-review-asset="):
			file=argument.trim_prefix("--siegebird-review-asset=")
	if not FileAccess.file_exists(file): return null
	var doc=GLTFDocument.new(); var state=GLTFState.new()
	if doc.append_from_buffer(FileAccess.get_file_as_bytes(file),"",state)!=OK: return null
	var model=doc.generate_scene(state)
	var item=Node3D.new(); game.add_child(item); item.add_child(model)
	var bounds=game._bounds(model,Transform3D.IDENTITY)
	var ratio=1.1/maxf(bounds.size.x,maxf(bounds.size.y,bounds.size.z))
	model.scale*=ratio
	model.position-=Vector3(bounds.get_center().x,bounds.position.y,bounds.get_center().z)*ratio
	item.set_meta("id",game.siegebird.ITEM_ID); item.set_meta("kind","weapon")
	game.siegebird.attach(item,model)
	return item

static func run(game,failures:Array):
	var prior_offline=game.diagnostic_offline; game.diagnostic_offline=true
	var tracked=XRController3D.new(); game.add_child(tracked); tracked.tracker="right_hand"
	game.hands.append(tracked)
	var pointer=game.aim_source(tracked)
	if game.aim_source(pointer)!=pointer: failures.append("calibrated pointer was transformed twice")
	game.hands.erase(tracked); tracked.queue_free()
	var root=Node3D.new(); game.add_child(root)
	var shape=preload("res://workshop_details.gd").clipped_box(root,Vector3.ZERO,Vector3(0.6,0.3,0.4),WorkshopScene.material("ffffff"))
	var arrays=shape.mesh.surface_get_arrays(0)
	for i in range(arrays[Mesh.ARRAY_VERTEX].size()):
		if arrays[Mesh.ARRAY_NORMAL][i].dot(arrays[Mesh.ARRAY_VERTEX][i])<=0:
			failures.append("beveled hammer/anvil face points inward"); break
	root.free()
	var item=load_sample(game)
	if item==null:
		print("SIEGEBIRD_CHECK asset absent; mechanism integration requires the locally published Siegebird GLB")
		return
	game.set_process(false)
	var system=game.siegebird
	var w=system.weapons.back()
	for binding in [["ReelSocketArt","reel_socket",Vector3(-0.23,0.53,0.02)],["SelectorArt","selector",Vector3(-0.20,0.42,0.08)]]:
		var authored=system.find_part(w.model,binding[0])
		if authored!=null:
			if w[binding[1]]!=authored: failures.append("authored fitting replaced by fallback: "+binding[0])
			if not authored.position.is_equal_approx(binding[2]): failures.append("authored fitting moved interaction point: "+binding[0])
	var string_length=-1.0
	# Exact tangent at the spool, and sampled pulley arc stays on its groove.
	for draw in [0.0,0.5,1.0]:
		var path=system.cable_path(lerpf(0.79,0.535,draw))
		var radial:Vector3=path[0]-Vector3(0.14,0.648,0)
		if absf(radial.normalized().dot((path[1]-path[0]).normalized()))>0.0001: failures.append("spool cable not tangent")
		var center=Vector3(0.14,0.455,0.255/TAU+0.001+0.024)
		for p in path.slice(1,18):
			if absf(p.distance_to(center)-0.024)>0.00001: failures.append("cable leaves guide groove")
		if absf((path[17]-center).normalized().dot((path[18]-path[17]).normalized()))>0.0001: failures.append("guide exit not tangent")
	for step in range(33):
		w.draw=float(step)/32; system.mechanism(w)
		var length=w.string.get_child(0).scale.y+w.string.get_child(1).scale.y
		if string_length<0: string_length=length
		if absf(length-string_length)>0.0001: failures.append("bowstring stretches during draw")
	w.draw=1; system.mechanism(w)
	var hand=Node3D.new(); game.add_child(hand); hand.position=Vector3(500,50,500)
	var other=Node3D.new(); game.add_child(other)
	game.adventure.build_hand(other)
	# Finger contact remains attached when the palm rolls; world-up must not steer it.
	var visual=other.get_meta("hand_visual"); var fingers=other.get_meta("finger_joints")
	for roll in [0.0,PI/2,PI]:
		visual.rotation.z=roll
		for joint in fingers.slice(0,3): joint.rotation=Vector3.ZERO
		var finger_target=fingers[0].global_position+visual.global_basis*Vector3(0,-0.025,-0.048)
		preload("res://hand_animation.gd").seat_index(fingers.slice(0,3),finger_target,0.016)
		if fingers[2].to_global(Vector3(0,0,-0.025)).distance_to(finger_target)>0.004: failures.append("rolled trigger finger lost contact")
	visual.rotation=Vector3.ZERO
	game.grips._attach(hand,item)
	system.tick(0.016)
	if item.global_basis.y.dot(-hand.global_basis.z)<0.999: failures.append("crossbow single-hand firing axis differs from pointer")
	var target=Node3D.new(); game.add_child(target); target.set_meta("kind","dummy")
	target.global_position=w.model.to_global(system.author(Vector3(0,-0.179,0.78)))+item.global_basis.y*3.0
	WorkshopScene.collision(target,Vector3.ZERO,Vector3.ONE*0.5)
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	var count=system.projectiles.size()
	var crank_before=w.angle
	# Loaded interlock prevents a crank grab, even at its exact handle position.
	other.global_position=system.knob(w)
	if system.try_grab(other): failures.append("loaded crossbow allowed crank grab")
	# Defensive firing interlock also handles a stale tracked crank owner.
	system.occupied[str(other.get_instance_id())]={"type":"crank","hand":other,"w":w,"angle":0.0}
	game._trigger(hand,false)
	if system.projectiles.size()!=count or not w.loaded: failures.append("fired with other hand in mechanism")
	system.occupied.erase(str(other.get_instance_id()))
	var matchstick=game.firecraft._prop("match",w.seat.global_position-Vector3.UP*.115)
	game._set_collisions(matchstick,false)
	game.firecraft._light(matchstick)
	game._trigger(hand,false)
	if w.loaded or system.projectiles.size()!=count+1: failures.append("holding trigger did not fire loaded crossbow")
	if not system.projectiles.back().get("hot",false): failures.append("bolt held at a flame did not retain heat on firing")
	game.firecraft._remove(matchstick)
	game._trigger(hand,false)
	if system.projectiles.size()!=count+1: failures.append("crossbow dry trigger launched another bolt")
	print("BOLT_CHECK target=",target.global_position," bolt=",system.projectiles.back().node.global_position," tip=",system.projectiles.back().node.get_meta("tip")," velocity=",system.projectiles.back().velocity)
	system.tick(0.11)
	if int(target.get_meta("hits",0))!=1: failures.append("visible bolt did not collide with training target")
	target.queue_free()
	if w.draw!=0.0: failures.append("firing did not release string energy")
	if absf(w.angle-crank_before)>0.0001 or absf(w.pivot.rotation.x-crank_before)>0.0001: failures.append("firing backspun the hand crank")
	if not is_equal_approx(w.pinion.rotation.x,0.0): failures.append("drive did not unwind independently of crank")
	var bolt=system.make_bolt()
	bolt.global_basis=item.global_basis
	bolt.global_position=w.model.to_global(system.author(Vector3(0,-0.179,0.78)))
	if system.can_load(w,bolt): failures.append("uncocked crossbow accepted a bolt")
	system.wind(w,-0.2)
	if w.draw!=0: failures.append("ratchet winds backwards")
	# Exercise the actual hand/crank angular sampling, including -PI/PI wrap.
	other.global_position=system.knob(w)
	if not system.try_grab(other): failures.append("physical crank was not grabbable")
	system.tick(0.1)
	if other.get_meta("hand_visual").global_position.distance_to(system.knob(w))>0.09: failures.append("crank hand did not seat on knob")
	var before_escape=w.draw
	other.global_position+=Vector3.ONE
	system.tick(0.2)
	if system.busy(other) or other.get_meta("anchored_grip",false): failures.append("unreasonable hand separation did not release")
	if absf(w.draw-before_escape)>0.001: failures.append("escape gesture wound crank")
	other.global_position=system.knob(w); system.try_grab(other)
	var start=system.occupied.get(str(other.get_instance_id()),{}).get("angle",0.0)
	for i in range(129):
		var angle=start+i*TAU*system.TURNS/128.0
		other.global_position=w.model.to_global(w.pivot.position+Vector3(w.knob.position.x,cos(angle)*0.15,sin(angle)*0.15))
		system.tick(0.016)
	# Ready rail must not accept a bolt until the reload hand releases the crank.
	bolt.global_basis=item.global_basis
	bolt.global_position=w.seat.global_position
	if system.can_load(w,bolt): failures.append("loading allowed while gripping crank")
	system.release(other)
	system.tick(0.2)
	if other.get_meta("anchored_grip",false): failures.append("released hand stayed anchored")
	if w.draw<0.999: failures.append("two physical crank turns did not cock crossbow")
	bolt.global_basis=item.global_basis
	bolt.global_position=w.model.to_global(system.author(Vector3(0,-0.179,0.78)))
	if not system.can_load(w,bolt): failures.append("aligned bolt rejected from cocked rail")
	bolt.global_basis=item.global_basis*Basis(Vector3.RIGHT,PI)
	if system.can_load(w,bolt): failures.append("backwards bolt accepted")
	bolt.global_basis=Basis.IDENTITY
	if system.can_load(w,bolt): failures.append("sideways bolt accepted")
	bolt.global_basis=item.global_basis
	system.occupied[str(other.get_instance_id())]={"type":"bolt","hand":other,"node":bolt}
	if not system.release(other) or not w.loaded: failures.append("manual bolt release did not seat")
	# A physical reel snaps to the side socket and its selector can detach a tether.
	var extras=system.extras
	var old_state=game.state.duplicate(true); var old_time=game.elapsed
	game.state["interactionProfiles"]={system.ITEM_ID:{"damage":117.0}}
	game.elapsed+=1; extras.next_sync=0; extras.tick(0.016)
	if extras.setting(w,"damage",95)!=117: failures.append("live profile did not reach existing weapon")
	game.state=old_state; game.elapsed=old_time; extras.profiles={}
	if not is_instance_valid(extras.reel_item): await game.get_tree().process_frame
	var reel=extras.reel_item
	reel.reparent(game); reel.global_position=w.reel_socket.global_position
	extras.release_reel(other,{"node":reel})
	if not w.reel_installed or not w.grapple_mode or reel.get_parent()!=w.reel_socket: failures.append("physical reel socket failed")
	# A fitted reel must not prevent an actual dropped bolt from seating at the
	# rear sled. Exercise the same release/next-frame path as a player's drop.
	for fitted in [false,true]:
		w.reel_installed=fitted; w.grapple_mode=fitted; w.loaded=false; w.draw=1; system.mechanism(w)
		var dropped=system.make_bolt(); dropped.global_basis=item.global_basis*Basis(Vector3.RIGHT,0.5)
		var rear=w.model.to_global(Vector3(0,0.535,0.179))
		dropped.global_position=rear+item.global_basis.z*0.10
		if not system.can_load(w,dropped): failures.append("moderately tilted bolt rejected at rear sled, reel="+str(fitted))
		dropped.global_position=rear+item.global_basis.x*0.30
		if system.can_load(w,dropped): failures.append("bolt magnet reaches too far sideways")
		dropped.global_position=rear+item.global_basis.z*0.24
		system.occupied[str(other.get_instance_id())]={"type":"bolt","hand":other,"node":dropped}
		system.release(other)
		if w.loaded: failures.append("distant dropped bolt seated before reaching rail")
		dropped.global_position=rear+item.global_basis.z*0.08
		system.tick(0.016)
		if not w.loaded: failures.append("dropped bolt not caught at sled, reel="+str(fitted))
		if system.loose.any(func(e): return e.node==dropped): failures.append("seated bolt retained loose physics ownership")
	var anchor=StaticBody3D.new(); game.add_child(anchor); anchor.global_position=w.item.global_position+Vector3(0,0,2)
	anchor.set_meta("kind","anchor"); anchor.set_meta("destination",game.rig.global_position+Vector3(0,0,1))
	if not extras.rope.attach(w.item,{"collider":anchor,"position":anchor.global_position,"normal":Vector3.UP}): failures.append("grapple attachment rejected scenery")
	extras.rope.tick(w.reel_socket.global_position)
	if not extras.rope.rope.visible: failures.append("grapple rope invisible")
	system._status(w)
	if not "CRANK" in w.label.text or not "RELEASE LINE" in w.label.text: failures.append("tether controls not visible on weapon")
	if not extras.trigger(w,hand) or not extras.rope.state.is_empty(): failures.append("trigger did not release tether")
	anchor.queue_free(); extras.rope.detach(false)
	var old_zone=game.adventure.zone; var old_rig=game.rig.global_transform; var old_camera=game.camera.transform
	game.adventure.travel("sky_garden"); game.camera.position=Vector3(0,1.7,0)
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	var sky_anchor=null
	for candidate in game.scene.anchors:
		if candidate.get_meta("zone","")=="sky_garden": sky_anchor=candidate; break
	if sky_anchor!=null:
		var surface=sky_anchor.find_children("*","StaticBody3D",true,false)[0]
		extras.rope.attach(w.item,{"collider":surface,"position":sky_anchor.global_position,"normal":Vector3.FORWARD})
		var before_reel=game.rig.global_position
		other.global_position=system.knob(w)
		if not system.try_grab(other): failures.append("attached tether crank not grabbable")
		var reel_start=system.occupied.get(str(other.get_instance_id()),{}).get("angle",0.0)
		for step in range(30):
			var reel_angle=reel_start+(step+1)*0.1
			other.global_position=w.model.to_global(w.pivot.position+Vector3(w.knob.position.x,cos(reel_angle)*0.15,sin(reel_angle)*0.15))
			system.tick(0.016)
		if game.rig.global_position.distance_to(before_reel)<0.1: failures.append("physical crank did not reel player towards anchor")
		system.release(other)
		for step in range(1200):
			if extras.rope.state.is_empty(): break
			extras.rope.reel(0.08)
		var landing:Vector3=sky_anchor.get_meta("destination")
		var gap=game.rig.global_position.distance_to(landing)
		if gap>0.3: failures.append("Sky Garden reel landing blocked: "+str(gap))
		extras.rope.detach(false)
	game.adventure.travel(old_zone); game.rig.global_transform=old_rig; game.camera.transform=old_camera
	reel.reparent(extras.rack); reel.position=Vector3(0.42,0.97,0); extras.reel_owner=null; w.reel_installed=false; w.grapple_mode=false
	# Existing support solver must hold the line when the rear wrist turns.
	other.global_position=item.to_global(item.get_meta("grip_axis_origin")+Vector3(0,0.32,0))
	if not game.grips.try_grab(other): failures.append("crossbow support grip missing")
	game.grips.tick(0.016)
	var axis=item.global_basis.y
	hand.rotate_y(0.8)
	game.grips.tick(0.016); system.tick(0.016)
	if item.global_basis.y.dot(axis)<0.995: failures.append("rear wrist steered two-hand crossbow")
	# Looking into the pouch must not rotate the inventory out of reach.
	var saved_camera=game.camera.global_transform; var saved_belt=game.grips.belt.global_transform
	var saved_open=game.workshop.pouch_open
	game.grips.belt.global_rotation=Vector3.ZERO
	game.camera.global_rotation=Vector3(-1.0,1.6,0)
	game.workshop.pouch_open=false; game.grips._place_belt(0.2)
	if absf(game.grips.belt.global_rotation.y)>0.001: failures.append("hip belt chased downward gaze")
	game.camera.global_rotation=Vector3(0,1.6,0)
	game.workshop.pouch_open=true; game.grips._place_belt(0.2)
	if absf(game.grips.belt.global_rotation.y)>0.001: failures.append("open pouch chased head turn")
	game.workshop.pouch_open=false; game.grips._place_belt(0.2)
	if absf(game.grips.belt.global_rotation.y)<0.01: failures.append("belt never resumes following")
	for step in range(120): game.grips._place_belt(0.016)
	if absf(game.grips.belt.global_rotation.y-1.6)>0.16: failures.append("belt stopped at edge of follow dead zone")
	game.camera.global_transform=saved_camera; game.grips.belt.global_transform=saved_belt; game.workshop.pouch_open=saved_open
	var knife=system.make_bolt(); knife.global_basis=Basis.IDENTITY
	var dummy=Node3D.new(); game.add_child(dummy); dummy.set_meta("kind","dummy"); dummy.global_position=Vector3(600,50,600)
	WorkshopScene.collision(dummy,Vector3.ZERO,Vector3.ONE*0.08)
	await game.get_tree().physics_frame
	await game.get_tree().physics_frame
	knife.global_position=dummy.global_position-knife.get_meta("tip")-Vector3(0.1,0,0)
	system._knife_contact(knife,hand,0.05)
	knife.global_position+=Vector3(0.2,0,0)
	system._knife_contact(knife,hand,0.05)
	if int(dummy.get_meta("hits",0))!=1: failures.append("held bolt tip did not stab dummy")
	knife.queue_free(); dummy.queue_free()
	for key in [str(hand.get_instance_id()),str(other.get_instance_id())]:
		game.held.erase(key); game.grips.grips.erase(key); system.occupied.erase(key)
	for shot in system.projectiles: shot.node.queue_free()
	system.projectiles.clear(); system.weapons.erase(w)
	item.queue_free(); hand.queue_free(); other.queue_free()
	game.diagnostic_offline=prior_offline
	game.set_process(true)
	print("SIEGEBIRD_CHECK clutch / crank-lock / forward-only seat / mesh normals / trigger / dry fire / two-turn crank / bolt loading / two-hand aim complete")
