extends Node
## Actual main scene, collision rays and input dispatch in disposable demo state.
var failures=[]
func check(ok,message):
	if not ok: failures.append(message)
func run(game):
	game.adventure.travel("pinewood_ruins")
	check(not game.echo_bells.court.is_visible_in_tree(),"Fixture begins outside the forge zone")
	game.qol.action("fair:echo")
	check(game.adventure.zone=="forge_yard" and game.echo_bells.court.is_visible_in_tree(),"Cross-zone pocket travel reveals destination scenery")
	check(Vector2(game.camera.global_position.x,game.camera.global_position.z).distance_to(Vector2(185,70))<.2,"Zone activation preserves safe destination")
	game.qol.action("fair:lantern")
	var toy=game.playful_tools
	for action in ["start","abandon"]:
		var button=null
		for node in game.lantern_gallery.court.get_children():
			if node.get_meta("action","")=="lantern_gallery:"+action: button=node; break
		check(button!=null,"Expected activity button exists")
		if button==null: continue
		game.camera.global_position=button.global_position+Vector3(0,0,2)
		game.camera.look_at(button.global_position)
		game.desktop_hand.global_transform=game.camera.global_transform
		await get_tree().physics_frame
		toy._home(); toy.retrieve(game.desktop_hand)
		if action=="abandon": toy.release(game.desktop_hand)
		var power=toy.mode
		game.elapsed+=1
		check(game._owner(game._ray(game.camera,6).get("collider"))==button,"Actual physics ray reaches requested button")
		game._trigger(game.desktop_hand,true)
		check(game.lantern_gallery.active==(action=="start"),"Actual desktop click reaches activity action with held/flying ring")
		check(toy.mode==power,"Button click cannot also change ring power")
		if action=="abandon": check(toy.state=="flying","Abandon click cannot also recall ring")
	toy._home()
	check(game.demo_session.save_now(),"Reviewed state remains saveable in disposable namespace")
	print("ACTIVITY_REVIEW_RESULT ",JSON.stringify(failures))
	return failures
