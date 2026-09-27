extends SceneTree
## Real main scene routing, no service or persistent user state (--playful-demo).
var failures=[]
var checks=0
func _initialize(): call_deferred("run")
func check(ok:bool,message:String):
	checks+=1
	if not ok: failures.append(message)
func run():
	if not OS.get_cmdline_user_args().has("--playful-demo"):
		push_error("Torch integration requires --playful-demo to isolate saves and service"); quit(1); return
	var start=Time.get_ticks_usec()
	var game=load("res://main.gd").new(); root.add_child(game); game.set_process(false); game.smoke=true
	for i in range(5): await physics_frame
	game.adventure.travel("ember_gallery")
	var torch=game.hearth_torch; var hand=game.desktop_hand; var key=str(hand.get_instance_id())
	check(game.diagnostic_offline and not game.ember_gallery.persistence_enabled,"Actual main is offline without save writers")
	hand.global_position=torch.stands[1].global_position
	check(game._grip(hand,true) and torch.busy(hand),"Actual desktop E routes to torch pickup")
	game.grips.tick(.02)
	check(not game.grips.grips.has(key),"Generic grip tick does not enroll the torch")
	var parent_before=torch.torch.get_parent()
	game.grips.adjust(hand,true)
	check(torch.torch.get_parent()==parent_before and not game.grips.adjusting.has(key),"Grip adjustment cannot detach managed torch")
	game.camera.look_at(game.camera.global_position+Vector3.FORWARD)
	game._trigger(hand,true); check(not torch.lit,"Actual trigger snuffs torch")
	game._trigger(hand,true); check(torch.lit,"Actual trigger relights torch")
	game._grip(hand,true)
	check(not torch.busy(hand) and is_instance_valid(torch.body) and not game.held.has(key),"Actual desktop E releases physically before generic weapon handling")
	for i in range(2): await physics_frame
	check(not torch.pickup_shape.disabled,"Pickup area restored after real routing release")
	torch.body.freeze=true; torch.body.global_position=game.ember_gallery.CENTER+Vector3(0,1.3,2)
	game.camera.global_position=torch.torch.global_position+Vector3(0,0,1.7); game.camera.look_at(torch.torch.global_position)
	hand.position=Vector3(.35,-.35,-.55)
	for i in range(2): await physics_frame
	check(game._grip(hand,true) and torch.busy(hand),"Actual aim ray re-grabs dropped torch away from stands")
	torch.home(); game.grips.tick(.02)
	# Every module-owned prop must keep its own release/adjustment policy.
	for kind in ["hearth_torch","ember_vessel","fire_supply"]:
		var prop=Node3D.new(); game.add_child(prop); prop.set_meta("kind",kind); game.held[key]=prop
		game.grips.bind(hand,prop); game.grips.tick(.02); game.grips.adjust(hand,true)
		check(not game.grips.grips.has(key) and not game.grips.adjusting.has(key) and not game.grips.release(hand),"Managed policy: "+kind)
		game.held.erase(key); prop.queue_free()
	# Ordinary two-handed weapons still take the established generic path.
	var a=Node3D.new(); game.add_child(a); a.position=Vector3(250,1,71)
	var b=Node3D.new(); game.add_child(b)
	var weapon=Node3D.new(); game.add_child(weapon); weapon.set_meta("kind","weapon"); weapon.set_meta("grip_min",0); weapon.set_meta("grip_max",.45)
	game.grips._attach(a,weapon); b.global_position=weapon.to_global(Vector3(0,.32,0))
	check(game.grips.try_grab(b) and game.grips._entries(weapon).size()==2,"Existing generic weapon still supports two hands")
	check(game.grips.release(b) and game.held.get(str(a.get_instance_id()))==weapon,"Existing two-handed release preserves survivor")
	game.held.clear(); game.grips.grips.clear(); game.grips.adjusting.clear()
	for player in game.firecraft.voices: player.stop()
	game.queue_free(); await process_frame
	print("HEARTH_TORCH_INTEGRATION ",JSON.stringify({"ok":failures.is_empty(),"checks":checks,"failures":failures,"seconds":(Time.get_ticks_usec()-start)/1000000.0}))
	quit(0 if failures.is_empty() else 1)
