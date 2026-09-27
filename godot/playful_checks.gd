extends Node
var failures=[]
func check(ok,message):
	if not ok: failures.append(message)

func run(game):
	game.set_process(false); game.smoke=true
	await get_tree().physics_frame
	await get_tree().physics_frame
	var trial=game.playful_encounters
	var tools=game.playful_tools
	game._button("playful_encounter:enter")
	check(game.rig.global_position.distance_to(trial.CENTER+Vector3(0,0,5))<.2,"Real gate action reaches safe court landing")
	var before=game.rig.global_position
	game._move_to(before+Vector3(0,0,-.3))
	check(game.rig.global_position.distance_to(before)>.2,"Court floor supports normal locomotion")
	check(not trial.state.ready and trial.state.discovered,"Arrival discovers but does not complete trials")
	tools.tick(.016) # Record the gate jump before beginning a new throw.
	tools.retrieve(game.desktop_hand)
	check(game._trigger_allowed(game.desktop_hand,true),"Held toy permits trigger while grip held")
	var mode=tools.mode
	game._trigger(game.desktop_hand,true)
	check(tools.mode==(mode+1)%3,"Main trigger changes ring power")
	game._grip(game.desktop_hand,true)
	check(tools.state=="flying","Desktop E releases ring through main grip route")
	var click=InputEventMouseButton.new(); click.button_index=MOUSE_BUTTON_LEFT; click.pressed=true
	check(not game.adventure.keyboard(click),"Desktop bomb handler yields to recall")
	game._trigger(game.desktop_hand,true)
	check(tools.state=="returning" and game.adventure.formation.is_empty(),"Main trigger recalls without creating a bomb")
	for i in range(80): tools.tick(.02)
	check(tools.busy(game.desktop_hand),"Recall catches in original empty hand")
	# One real swept flight through the game's authored target; no synthetic score call.
	game.adventure.release(game.desktop_hand,true)
	var target=trial.bells[0]
	tools.ring.global_position=target.global_position+Vector3(0,0,2)
	tools.velocity=Vector3(0,0,-10)
	for i in range(25):
		trial.tick(.02); tools.tick(.02)
	check(0 in trial.state.notes,"Real swept ring hit advances integrated challenge")
	check(tools.state in ["returning","held"],"Scored throw returns ring")
	game._button("playful_encounter:leave")
	check(game.rig.global_position.distance_to(Vector3(9,0,2))<.2,"Return gate landing remains unobstructed")
	check(not trial.persistence_enabled,"Integrated diagnostics cannot write player progress")
	var cargo=game.cargo_playground
	var wand=game.magnetic_wand
	game.qol.action("fair:cargo")
	check(game.rig.global_position.distance_to(cargo.LANDING)<.2,"Palm travel reaches cargo landing")
	# Walk from annex through the real bridge and opened fair railing.
	for i in range(40): game._move_to(game.rig.global_position+Vector3(-.25,0,0))
	check(game.rig.global_position.x<127,"Connected bridge accepts normal capsule locomotion")
	tools._home()
	game.camera.global_position=wand.HOME+Vector3(0,.5,1)
	game.camera.look_at(wand.HOME)
	game._grip(game.desktop_hand,true)
	check(wand.busy(game.desktop_hand),"Main grip picks up Copper Kite")
	check(not tools.retrieve(game.desktop_hand),"Toys cannot steal each other's occupied hand")
	var parcel=cargo.bodies[0]
	game.camera.global_position=cargo.CENTER+Vector3(0,1.65,5)
	game.camera.look_at(parcel.global_position)
	wand.tick(.016)
	game._trigger(game.desktop_hand,true)
	check(wand.target==parcel,"Main trigger selects registered real cargo")
	check(not game.adventure.keyboard(click),"Desktop bomb handler yields to magnet")
	for i in range(60):
		await get_tree().physics_frame
		wand.tick(1.0/60.0)
	game._trigger(game.desktop_hand,true)
	check(wand.target==null and parcel.linear_velocity.length()<=.201,"Main trigger gently releases physical cargo")
	game._grip(game.desktop_hand,true)
	check(not wand.busy(game.desktop_hand),"Desktop E returns wand without creating weapon/bomb")
	# The actual grip and release router own a physical cargo lever safely.
	var lever_hand=Node3D.new(); game.add_child(lever_hand)
	lever_hand.global_position=cargo.lever_handle.global_position
	check(game._grip(lever_hand,false) and cargo.busy(lever_hand),"Main VR grip takes cargo lever")
	game._trigger(lever_hand,false)
	check(game.adventure.formation.is_empty(),"Lever trigger cannot start a bomb")
	game.adventure.release(lever_hand,false)
	check(not cargo.busy(lever_hand),"Main release frees cargo lever")
	lever_hand.queue_free()
	# Exercise the real palm/action/grip routes and actual ricochet receiver.
	var bank=game.bankshot
	tools._home(); game.qol.action("fair:bankshot")
	check(Vector2(game.camera.global_position.x,game.camera.global_position.z).distance_to(Vector2(165,71))<.2,"Palm travel reaches Bankshot court")
	var ring_hand=Node3D.new(); game.add_child(ring_hand)
	ring_hand.global_position=bank.stand.global_position+Vector3.UP*1.15
	check(game._grip(ring_hand,false) and tools.busy(ring_hand),"Main VR grip retrieves ring from Bankshot stand")
	tools._home(); ring_hand.queue_free()
	var directions=[Vector3(.19,.10,-1),Vector3(-.21,.10,-1),Vector3(.16,.075,-1)]
	for stage in range(3):
		await get_tree().physics_frame
		game.camera.global_position=Vector3(165,1.7,71)
		game.camera.look_at(game.camera.global_position+directions[stage])
		game.desktop_hand.global_transform=game.camera.global_transform
		tools._home(); tools.last_camera_position=game.camera.global_position; tools.mode=1
		tools.retrieve(game.desktop_hand); game._grip(game.desktop_hand,true)
		for step in range(220):
			tools.tick(.02)
			if tools.state=="held": break
		check(bank.state.stage==stage+1,"Real main-input bank shot reaches stage "+str(stage+1))
	check(bank.state.completed and bank.state.bestShots==3 and not bank.persistence_enabled,"Integrated three-shot medal has no normal save writes")
	game._button("bankshot:replay")
	check(bank.state.stage==0 and bank.state.medal and bank.state.bestShots==3,"Main replay preserves earned medal")
	tools._home(); game._button("bankshot:leave")
	check(Vector2(game.camera.global_position.x,game.camera.global_position.z).distance_to(Vector2(120,70))<.2,"Bankshot return button reaches Bellworks")
	# Publish through the same native package staging/activation as runtime content.
	for filename in ["living_unfinished_lullaby.json","living_returning_demo.json"]:
		var package=JSON.parse_string(FileAccess.get_file_as_string("res://"+filename))
		await game.living.publish(package)
		await game.living._stage_group([package])
		check(game.living.active.has(package.id),"Optional experiment activates: "+package.id)
	await get_tree().physics_frame
	game.living.museum.visit_id="living-unfinished-lullaby"
	check(game.living.museum.visit_experiment(),"Museum visits actual active authored region")
	check(Vector2(game.camera.global_position.x,game.camera.global_position.z).distance_to(Vector2(120,-84))<.2,"Lullaby visitor landing is clear")
	game.living.safe_travel(Vector3(-3,0,8))
	var entry=game.living.active["demo-ember-return"].entities.ring
	game.living.components._hold_entry(entry,game.desktop_hand)
	game.adventure.release(game.desktop_hand,true)
	check(game.living.claims_trigger(game.desktop_hand),"Released Living ring retains recall trigger")
	check(not game.adventure.keyboard(click),"Desktop bomb handler yields to Living recall")
	check(game._trigger_allowed(game.desktop_hand,true),"Living recall is allowed through grip gate")
	game._trigger(game.desktop_hand,true)
	var flight=game.living.components.projectiles.flights.get(entry.node.get_instance_id(),{})
	check(flight.get("mode")=="returning" and game.adventure.formation.is_empty(),"Main trigger recalls Living projectile without bomb")
	game.living.components.projectiles._home(flight)
	game.qol.action("fair:tuning")
	check(game.qol.page=="tuning" and game.tuning.group_filter=="playful" and game.tuning.slider_nodes.size()==5,"Focused playful sliders fit palm page")
	var context=game._playful_context()
	check(context.has("bellworks") and context.has("copperKite") and context.copperKite.settled.size()==3,"Brann context reflects actual new activities")
	check(not cargo.persistence_enabled,"Cargo integration diagnostics cannot write player saves")
	# Allow owned audio streams to retire before a short-lived diagnostic exits.
	for node in game.find_children("*","AudioStreamPlayer3D",true,false): node.stop()
	await get_tree().create_timer(.15).timeout
	print("PLAYFUL_CHECK_RESULT ",JSON.stringify(failures))
	get_tree().quit(0 if failures.is_empty() else 1)
