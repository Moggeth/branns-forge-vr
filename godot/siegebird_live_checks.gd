extends RefCounted
static func settle(game,extras):
	var until=Time.get_ticks_msec()+4000
	while extras.request_busy and Time.get_ticks_msec()<until: await game.get_tree().process_frame
static func run(game):
	if game.service!="http://127.0.0.1:8788": push_error("Ledger check requires isolated fixture service"); game.get_tree().quit(2); return
	game.set_process(false)
	var failures=[]; var s=game.siegebird; var e=s.extras
	e.initialized=true
	await game._request("/test/supplies",{})
	await e._rpc("resume")
	var starting=int(e.snapshot.available)
	await game._request("/api/vr/context",{"position":{"x":-3.4,"y":1.7,"z":3.4},"zone":"forge_yard","visiting":false,"targets":[]})
	var bought=await e._rpc("buy")
	if bought.has("error") or int(e.snapshot.available)!=starting+6: failures.append("native pack purchase")
	var item=preload("res://siegebird_checks.gd").load_sample(game); var w=s.weapons.back()
	var hand=Node3D.new(); game.add_child(hand); var other=Node3D.new(); game.add_child(other)
	game.grips._attach(hand,item); s.tick(0.016)
	await e.draw_bolt(other)
	var key=str(other.get_instance_id()); var held=s.occupied.get(key,{})
	if held.get("type")!="bolt": failures.append("native finite draw")
	else:
		w.draw=1; w.release=0; s.mechanism(w)
		held.node.global_basis=item.global_basis; held.node.global_position=w.seat.global_position
		s.release(other); await settle(game,e)
		if not w.loaded or w.ammo_token.is_empty(): failures.append("native ledger seating")
		var count=s.projectiles.size(); s.trigger(hand); await settle(game,e)
		if w.loaded or s.projectiles.size()!=count+1: failures.append("native ledger firing")
		else:
			var shot=s.projectiles.back(); s.projectiles.erase(shot)
			var surface=StaticBody3D.new(); game.add_child(surface); surface.global_position=shot.node.global_position
			s.embed(shot.node,surface); var embedded=s.embedded.back()
			await e._recover(embedded,other)
			if s.occupied.get(key,{}).get("type")!="bolt": failures.append("native recover")
			else:
				var bolt=s.occupied[key].node; s.occupied.erase(key); await e.return_bolt(bolt)
				if int(e.snapshot.available)!=starting+6: failures.append("native round conservation")
	# Release during asynchronous draw must return the round rather than attach it later.
	var before=int(e.snapshot.available)
	e.draw_bolt(other); s.release(other); await settle(game,e)
	if int(e.snapshot.available)!=before or s.busy(other): failures.append("release during draw")
	# Exercise the mouse/keyboard route against the real finite-ammo service.
	# The VR sequence above has returned its round, so one desktop load must
	# decrement the quiver exactly once and leave a persisted chamber.
	game.set_process(true)
	game.held.erase(str(hand.get_instance_id()))
	game.grips.grips.erase(str(hand.get_instance_id()))
	w.loaded=false; w.draw=0; w.release=0; s.mechanism(w)
	game.grips._attach(game.desktop_hand,item)
	var auto_deadline=Time.get_ticks_msec()+4000
	while not w.loaded and Time.get_ticks_msec()<auto_deadline: await game.get_tree().process_frame
	if not w.loaded or int(e.snapshot.available)!=before-1: failures.append("desktop equip did not load one finite starter bolt")
	var desktop_count=s.projectiles.size()
	game._desktop_primary(); await settle(game,e)
	if w.loaded or s.projectiles.size()!=desktop_count+1: failures.append("desktop left click failed to fire authorized bolt")
	await s.desktop_reload(game.desktop_hand)
	if not w.loaded or w.draw<0.999 or int(e.snapshot.available)!=before-2:
		failures.append("desktop reload failed to cock and consume one finite bolt")
	if not e.snapshot.chambers.has(str(w.item.get_meta("id"))): failures.append("desktop chamber was not persisted")
	desktop_count=s.projectiles.size()
	game._desktop_primary(); await settle(game,e)
	if w.loaded or s.projectiles.size()!=desktop_count+1: failures.append("desktop left click failed to fire authorized bolt")
	print("SIEGE_LEDGER_RESULT ",failures)
	game.get_tree().quit(0 if failures.is_empty() else 1)
