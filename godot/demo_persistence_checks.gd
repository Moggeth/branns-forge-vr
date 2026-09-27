extends Node
var failures=[]
func check(condition,message):
	if not condition: failures.append(message)

func pump(game,count=12):
	for i in range(count):
		game.elapsed+=.05
		game.living.tick(.05)
		game.demo_session.tick(.05)
		await get_tree().process_frame

func run(game,phase:String):
	game.set_process(false); game.smoke=true
	await get_tree().physics_frame
	await get_tree().physics_frame
	check(game.diagnostic_offline,"Demo never connects to service")
	check(not game.playful_encounters.persistence_enabled and not game.cargo_playground.persistence_enabled and not game.bankshot.persistence_enabled,"Normal game save writers stay disabled")
	var session=game.demo_session
	check(session!=null and session.enabled,"Dedicated demo adapter starts")
	if session==null: finish(game,phase); return
	await pump(game)
	var trial=game.playful_encounters
	var cargo=game.cargo_playground
	if phase.begins_with("ember-"):
		var review=load("res://ember_walkthrough.gd").new(); game.add_child(review)
		failures.append_array(await review.run(game,phase))
	elif phase=="activity-review":
		var review=load("res://activity_review_walkthrough.gd").new(); game.add_child(review)
		failures.append_array(await review.run(game))
	elif phase=="seed":
		check(trial.state.stage==0 and not cargo.state.earned,"New fixture starts fresh")
		trial.act("enter")
		for index in [0,1,2,0,2,1,0,3,3,3]:
			trial.tick(.7)
			trial.hit_target(trial.bells[index],trial.bells[index].global_position,Vector3(0,0,-8))
		trial.act("claim")
		check(trial.state.claimed and game.playful_tools.reward=="bellwright","Actual trial progression earns ring cosmetic")
		for i in range(cargo.bodies.size()):
			cargo.bodies[i].freeze=true; cargo.bodies[i].position=cargo.nests[i]
			cargo.bodies[i].linear_velocity=Vector3.ZERO; cargo.bodies[i].angular_velocity=Vector3.ZERO
		cargo.tick(1.1); cargo.act("launch")
		check(cargo.state.earned,"Actual settled delivery earns cargo cosmetic")
		for filename in ["living_unfinished_lullaby.json","living_returning_demo.json"]:
			await game.living.publish(JSON.parse_string(FileAccess.get_file_as_string("res://"+filename)))
		await pump(game)
		check(game.living.active.has("living-unfinished-lullaby") and game.living.active.has("demo-ember-return"),"Both authored demos activate")
		if game.living.active.has("living-unfinished-lullaby"):
			var built=game.living.active["living-unfinished-lullaby"]
			var e=built.entities
			e["glow-pebble"].node.global_position=e["sun-bud"].node.global_position+Vector3.UP*.5
			e["warm-pebble"].node.global_position=e["hearth-bud"].node.global_position+Vector3.UP*.5
			e.handbell.node.global_position=e["song-bud"].node.global_position+Vector3.UP*.5
			game.living.components._hold_entry(e.handbell,game.desktop_hand)
			# Position the desktop hand with the held bell inside its sound sensor.
			game.desktop_hand.global_position=e["song-bud"].node.global_position+Vector3.UP*.5
			game.living.components.trigger(game.desktop_hand,null)
			game.living.release(game.desktop_hand)
			await pump(game)
			check(e.chorus.state.complete,"Real light/warmth/handbell solve garden")
		if game.living.active.has("demo-ember-return"):
			var built=game.living.active["demo-ember-return"]
			for i in range(3): game.living.components._emit(built,"projectile_hit","ring",{})
			await pump(game)
			check(built.entities.lantern.state.complete,"Cinderloop package rules reach objective")
		# Actual release and swept collision complete the new optional challenge.
		game.bankshot.act("visit")
		var directions=[Vector3(.19,.10,-1),Vector3(-.21,.10,-1),Vector3(.16,.075,-1)]
		for stage in range(3):
			await get_tree().physics_frame
			game.camera.global_position=Vector3(165,1.7,71)
			game.camera.look_at(game.camera.global_position+directions[stage])
			game.desktop_hand.global_transform=game.camera.global_transform
			var toy=game.playful_tools
			toy._home(); toy.last_camera_position=game.camera.global_position; toy.mode=1
			toy.retrieve(game.desktop_hand); game._grip(game.desktop_hand,true)
			for step in range(220):
				toy.tick(.02)
				if toy.state=="held": break
		check(game.bankshot.state.completed and game.bankshot.state.bestShots==3,"Real ricochets earn Bankshot medal before save")
		game.playful_tools._home()
		game.tuning.commit({"values":{"playful.ring_toss_gain":1.25,"playful.magnet_pull":15}})
		check(is_equal_approx(game.tuning.value("playful.ring_toss_gain"),1.25),"Real offline tuning control applies")
		check(session.save_now(),"Earned progress writes to isolated demo save")
		# A second write gives recovery a fully earned backup too.
		game.tuning.commit({"values":{"playful.ring_gravity":1.2}})
		check(session.save_now(),"Second valid revision can be recovered")
	elif phase in ["resume","recover","resume-close"]:
		check(session.writable,"Recovered progress remains writable")
		check(game.bankshot.state.completed and game.bankshot.state.bestShots==3 and game.bankshot.medal.visible,"Bankshot medal and best survive new process")
		if phase=="resume-close": check(is_equal_approx(game.tuning.value("playful.magnet_fling"),5.0),"Window-close hook persists final unsampled changes")
		check(trial.state.claimed and trial.state.stage==3,"Bell trial reward survives process relaunch")
		trial.tick(.01)
		check(game.playful_tools.reward=="bellwright","Earned ring appearance is reconstructed")
		check(cargo.state.earned and cargo.trophy.visible,"Cargo trophy survives process relaunch")
		check(is_equal_approx(game.tuning.value("playful.ring_toss_gain"),1.25),"Tuning survives process relaunch")
		check(game.playful_tools.holder==null and game.magnetic_wand.holder==null,"Hands and flights are transient")
		for i in range(cargo.bodies.size()): check(cargo.bodies[i].position.distance_to(cargo.homes[i])<.3,"Cargo bodies restart on tray")
		check(game.living.active.has("living-unfinished-lullaby") and game.living.active.has("demo-ember-return"),"Enabled authored experiments return")
		if game.living.active.has("living-unfinished-lullaby"):
			var e=game.living.active["living-unfinished-lullaby"].entities
			check(e.chorus.state.complete and e.chorus.state.count==3,"Garden completion survives relaunch")
			check(is_equal_approx(e.crown.node.position.y,2.6) and e["crown-light"].state.power==2,"Earned garden reveal is reconstructed")
			check(e["glow-pebble"].node.position.distance_to(e["glow-pebble"].home)<.4,"Starter pebble pose is transient")
		if game.living.active.has("demo-ember-return"):
			var e=game.living.active["demo-ember-return"].entities
			check(e.lantern.state.complete and e.lantern.state.power==2,"Cinderloop completion and light survive relaunch")
	elif phase=="close":
		game.tuning.values["playful.magnet_fling"]=5.0
		game._notification(NOTIFICATION_WM_CLOSE_REQUEST)
	elif phase=="incompatible":
		check(not session.save_now(),"Unsupported save cannot be overwritten automatically")
	elif phase=="reset":
		game.qol.action("demo:reset")
		check(game.qol.demo_reset_until>game.elapsed,"First reset press only requests confirmation")
		game.qol.action("demo:reset")
		check(not trial.state.claimed and not cargo.state.earned,"Confirmed reset clears only demo rewards")
		check(game.living.active.is_empty() and game.living.wanted.is_empty(),"Reset removes the two demo packages")
	elif phase in ["fresh","fresh-recover"]:
		check(session.writable,"Fresh/reset recovery remains writable")
		check(not game.bankshot.state.medal and game.bankshot.state.bestShots==0,"Reset Bankshot progress cannot resurrect")
		check(trial.state.stage==0 and not trial.state.claimed and not cargo.state.earned,"Reset remains fresh after relaunch")
		check(is_equal_approx(game.tuning.value("playful.ring_toss_gain"),1.0),"Reset restores default tuning")
		check(game.living.active.is_empty() and game.living.wanted.is_empty(),"Old package progress cannot resurrect after reset")
	elif phase=="arcade-seed":
		var walkthrough=load("res://arcade_walkthrough.gd").new(); add_child(walkthrough)
		failures.append_array(await walkthrough.run(game))
		check(session.save_now(),"Both arcade medals persist in demo namespace")
	elif phase=="arcade-resume":
		check(game.echo_bells.mode=="idle" and game.echo_bells.state.medal and game.echo_bells.state.bestUnassistedLength==5,"Echo medal survives relaunch without melody/hand state")
		check(not game.lantern_gallery.active and game.lantern_gallery.state.medal and game.lantern_gallery.state.bestShots==6,"Parade best survives relaunch without flight/round state")
	elif phase=="festival-seed":
		var walkthrough=load("res://festival_walkthrough.gd").new(); add_child(walkthrough)
		failures.append_array(await walkthrough.run(game))
		check(session.save_now(),"Relay completion persists in isolated demo namespace")
	elif phase=="festival-resume":
		check(game.festival_relay.mode=="idle","Relaunch never restores an in-flight relay or timer")
		check(game.festival_relay.progress_snapshot().get("medal",false),"Earned relay medal survives a new process")
	elif phase=="arcade-capture":
		game.hud.get_parent().visible=false
		var folder=ProjectSettings.globalize_path("res://../outputs/bellworks-arcade")
		DirAccess.make_dir_recursive_absolute(folder)
		var views=[
			{"name":"01-echo-bells","from":Vector3(185,2.3,70),"at":Vector3(185,1.7,64)},
			{"name":"02-echo-instructions","from":Vector3(180.6,1.9,72),"at":Vector3(180.6,1.65,68.8)},
			{"name":"03-clapper-detail","from":Vector3(183.1,1.65,66),"at":Vector3(182.3,1.55,64)},
			{"name":"04-lantern-parade","from":Vector3(205,2.2,72.5),"at":Vector3(205,2.5,63)},
			{"name":"05-travel-page-two","from":Vector3(185,1.7,70),"at":Vector3(185,1.7,64)}]
		for view in views:
			game.camera.global_position=view.from; game.camera.look_at(view.at)
			if view.name=="01-echo-bells": game.echo_bells.act("practice"); game.echo_bells.tick(.7)
			if view.name=="04-lantern-parade": game.lantern_gallery.act("start")
			if view.name=="05-travel-page-two":
				game.qol.page="travel"; game.qol.travel_page=1; game.qol.toggle(); game.qol.tick(.016)
			for i in range(12):
				if view.name=="04-lantern-parade": game.lantern_gallery.tick(.016)
				await get_tree().process_frame
			if DisplayServer.get_name()!="headless":
				await RenderingServer.frame_post_draw
				check(game.get_viewport().get_texture().get_image().save_png(folder+"/"+view.name+".png")==OK,"Arcade capture saved")
		game.echo_bells.act("abandon"); game.lantern_gallery.act("abandon")
	elif phase=="festival-capture":
		game.hud.get_parent().visible=false
		var folder=ProjectSettings.globalize_path("res://../outputs/bellworks-festival")
		DirAccess.make_dir_recursive_absolute(folder)
		var views=[
			{"name":"01-relay-board","from":Vector3(122.5,1.85,68.4),"at":Vector3(122.5,1.55,72.8)},
			{"name":"02-practice","from":Vector3(122.5,1.7,69.2),"at":Vector3(122.5,1.6,72.8)},
			{"name":"03-personal-best","from":Vector3(122.5,1.7,69.2),"at":Vector3(122.5,1.6,72.8)},
			{"name":"04-cargo-waypoint","from":Vector3(135.5,1.8,64),"at":Vector3(135.5,1.65,60.6)},
			{"name":"05-garden-waypoint","from":Vector3(123.5,1.8,-87),"at":Vector3(123.5,1.55,-83.5)}]
		for view in views:
			if view.name=="02-practice": game.festival_relay.act("practice")
			if view.name=="03-personal-best":
				game.festival_relay.act("abandon"); game.festival_relay.act("timed"); game.festival_relay.elapsed=42.0
			if view.name=="04-cargo-waypoint": game.festival_relay.stage=1
			if view.name=="05-garden-waypoint":
				var package=JSON.parse_string(FileAccess.get_file_as_string("res://living_unfinished_lullaby.json"))
				await game.living.publish(package); await game.living._stage_group([package])
				game.festival_relay.stage=2
			game.camera.global_position=view.from; game.camera.look_at(view.at)
			for i in range(15):
				game.festival_relay.tick(.016); game.festival_relay_art.tick(.016); await get_tree().process_frame
			if DisplayServer.get_name()!="headless":
				await RenderingServer.frame_post_draw
				check(game.get_viewport().get_texture().get_image().save_png(folder+"/"+view.name+".png")==OK,"Relay capture saved")
		game.festival_relay.act("abandon")
	elif phase=="bankshot-capture":
		game.hud.get_parent().visible=false
		var folder=ProjectSettings.globalize_path("res://../outputs/bellworks-bankshot")
		DirAccess.make_dir_recursive_absolute(folder)
		var views=[
			{"name":"01-bankshot-court","from":Vector3(166,3.2,73),"at":Vector3(165,1.8,63)},
			{"name":"02-bankshot-board","from":Vector3(160.7,1.65,73.8),"at":Vector3(160.4,1.5,71)},
			{"name":"03-earned-medal","from":Vector3(171,1.8,72),"at":Vector3(169.7,1.6,70)}]
		for view in views:
			game.camera.global_position=view.from; game.camera.look_at(view.at)
			if view.name=="03-earned-medal": game.bankshot.medal.show()
			for i in range(15):
				game.bankshot_art.tick(.016); await get_tree().process_frame
			if DisplayServer.get_name()!="headless":
				await RenderingServer.frame_post_draw
				check(game.get_viewport().get_texture().get_image().save_png(folder+"/"+view.name+".png")==OK,"Capture saved")
		game.bankshot._refresh()
	elif phase=="capture":
		trial.act("enter")
		game.qol.page="demo"; game.qol.toggle()
		session.save_now(); game.qol.tick(.016)
		await get_tree().process_frame
		if DisplayServer.get_name()!="headless":
			await RenderingServer.frame_post_draw
			var destination=ProjectSettings.globalize_path("res://../outputs/bellworks-persistent")
			DirAccess.make_dir_recursive_absolute(destination)
			game.get_viewport().get_texture().get_image().save_png(destination+"/demo-menu.png")
	else: check(false,"Unknown fixture phase")
	game.qol.page="demo"; game.qol._build()
	check(game.demo_help.rows().size()==6,"Demo controls fit existing palm layout")
	finish(game,phase)

func finish(game,phase):
	for node in game.find_children("*","AudioStreamPlayer3D",true,false): node.stop()
	await get_tree().create_timer(.15).timeout
	print("DEMO_PERSISTENCE_RESULT ",JSON.stringify({"phase":phase,"failures":failures}))
	get_tree().quit(0 if failures.is_empty() else 1)
