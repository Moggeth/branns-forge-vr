extends Node
## Actual main grip/release, ray button and swept flight checks in a temporary demo.
var failures=[]
var game
func check(ok,message):
	if not ok: failures.append(message)
func step(count=1):
	for i in range(count):
		await get_tree().physics_frame
		game.elapsed+=1.0/60.0
		game.echo_bells.tick(1.0/60.0)
		game.lantern_gallery.tick(1.0/60.0)
		game.playful_tools.tick(1.0/60.0)
func run(owner_game):
	game=owner_game
	var echo=game.echo_bells
	var gallery=game.lantern_gallery
	game.qol.page="travel"; game.qol.travel_page=0; game.qol._build()
	check(game.qol._travel_rows().size()>=16,"Destinations have a bounded paged menu")
	game.qol.action("places:next")
	check(game.qol.travel_page==1,"More places reaches second page")
	var actions=[]
	for button in game.qol.buttons:
		actions.append(button.get_meta("action"))
		if str(button.get_meta("action")).begins_with("qol:fair:"): check(button.position.y>=-.19,"Travel destinations cannot overlap page/footer controls")
	check("qol:fair:echo" in actions and "qol:fair:lantern" in actions,"Both new games are visibly discoverable")
	game.qol.action("fair:echo")
	check(Vector2(game.camera.global_position.x,game.camera.global_position.z).distance_to(Vector2(185,70))<.2,"Palm travel reaches Echo Bells")
	game._button("echo:practice")
	var hand=Node3D.new(); game.add_child(hand)
	for round_index in range(4):
		for i in range(420):
			if echo.mode=="answering": break
			await step()
		check(echo.mode=="answering","Visual/audio phrase reaches untimed response")
		if echo.mode!="answering": break
		var phrase=echo.sequence.duplicate()
		if round_index==0:
			var first=int(phrase.pop_front())
			game.camera.global_position=echo.bells[first].global_position+Vector3(0,0,2)
			game.camera.look_at(echo.bells[first].global_position)
			var click=InputEventMouseButton.new(); click.button_index=MOUSE_BUTTON_LEFT; click.pressed=true
			check(not game.adventure.keyboard(click),"Desktop bomb input yields to the visible bell button")
			game._trigger(game.desktop_hand,true)
			check(echo.answer_index==1,"Real desktop aiming ray rings its visible bell")
		for note in phrase:
			hand.global_position=echo.clappers[int(note)].global_position
			check(game._grip(hand,false) and echo.busy(hand),"Main grip owns requested bell clapper")
			check(not game.playful_tools.retrieve(hand),"Clapper ownership prevents ring stealing hand")
			game._trigger(hand,false)
			check(game.adventure.formation.is_empty(),"Clapper trigger cannot form a bomb")
			hand.global_position+=Vector3(0,0,.13); await step(2)
			game.adventure.release(hand,false); await step(2)
			check(not echo.busy(hand),"Main release rings and frees clapper")
	check(echo.mode=="complete" and echo.state.bestUnassistedLength==5 and echo.state.medal,"Four actual physical phrases earn Echo Keeper")
	hand.queue_free()
	game._button("echo:abandon")
	check(echo.state.medal and echo.mode=="idle","Abandon preserves earned Echo medal")
	game.qol.action("fair:lantern")
	check(Vector2(game.camera.global_position.x,game.camera.global_position.z).distance_to(Vector2(205,70))<.2,"Palm travel reaches Lantern Parade")
	game._button("lantern_gallery:start")
	var toy=game.playful_tools
	# Each release flies through the live moving collision target at default settings.
	for stage in range(6):
		var target=gallery.targets[gallery.PARADE[stage]]
		game.camera.global_position=Vector3(target.global_position.x,1.7,70)
		game.camera.look_at(target.global_position+Vector3.UP*.25)
		game.desktop_hand.global_transform=game.camera.global_transform
		toy._home(); toy.last_camera_position=game.camera.global_position; toy.mode=1
		toy.retrieve(game.desktop_hand); game._grip(game.desktop_hand,true)
		for i in range(220):
			await step()
			if toy.state=="held": break
		check(gallery.stage==stage+1,"Real moving-lantern hit advances call "+str(stage+1))
	check(gallery.state.medal and gallery.state.bestShots==6,"Six actual releases earn a six-shot parade medal")
	toy._home(); game._button("lantern_gallery:abandon")
	check(gallery.state.medal and not gallery.active,"Put away preserves parade medal")
	check(not echo.persistence_enabled and not gallery.persistence_enabled,"Arcade diagnostics cannot touch normal saves")
	print("ARCADE_WALKTHROUGH_RESULT ",JSON.stringify(failures))
	return failures
