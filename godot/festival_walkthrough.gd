extends Node
## Real main-input relay walkthrough. Only used by isolated diagnostic fixtures.
var failures=[]
var game
func check(ok,message):
	if not ok: failures.append(message)
func step(count=1):
	for i in range(count):
		await get_tree().physics_frame
		game.elapsed+=1.0/60.0
		game.playful_encounters.tick(1.0/60.0)
		game.cargo_playground.tick(1.0/60.0)
		game.magnetic_wand.tick(1.0/60.0)
		game.playful_tools.tick(1.0/60.0)
		game.living.tick(1.0/60.0)
		game.festival_relay.tick(1.0/60.0)
func position_magnet(point:Vector3):
	game.camera.global_basis=Basis.IDENTITY
	game.camera.global_position=point-Vector3(.1,-.12,-1.36)
	game.desktop_hand.global_transform=game.camera.global_transform
func run(owner_game):
	game=owner_game
	var relay=game.festival_relay
	game._button("festival:practice")
	check(relay.mode=="running" and not relay.timed and relay.stage==0,"Root action starts untimed practice")
	# Three fresh actual Sunskipper throws, without rewriting the old bell trial.
	var toy=game.playful_tools
	for hit in range(3):
		toy._home()
		game.camera.global_position=Vector3(117.3,1.7,70)
		game.camera.look_at(game.camera.global_position+Vector3(0,.045,-1))
		game.desktop_hand.global_transform=game.camera.global_transform
		toy.last_camera_position=game.camera.global_position; toy.mode=1
		toy.retrieve(game.desktop_hand); game._grip(game.desktop_hand,true)
		for tick in range(180):
			await step()
			if toy.state=="held": break
	check(relay.stage==1,"Three real bell throws advance relay")
	toy._home(); game._button("festival:next")
	await step(2)
	var cargo=game.cargo_playground
	var wand=game.magnetic_wand
	game.camera.global_position=wand.HOME+Vector3(0,.5,1)
	game.camera.look_at(wand.HOME); game.desktop_hand.global_transform=game.camera.global_transform
	check(game._grip(game.desktop_hand,true) and wand.busy(game.desktop_hand),"Main E retrieves cargo wand")
	# Move every parcel using real spring forces, never write their transforms.
	for i in range(3):
		var body=cargo.bodies[i]
		position_magnet(body.global_position)
		wand.tick(.016); game._trigger(game.desktop_hand,true)
		check(wand.target==body,"Main trigger captures parcel "+str(i))
		if wand.target!=body: continue
		var high=body.global_position; high.y=1.8
		position_magnet(high); await step(60)
		var destination=cargo.cargo_root.to_global(cargo.nests[i]); destination.y=1.8
		for frame in range(120):
			position_magnet(high.lerp(destination,(frame+1)/120.0)); await step()
		await step(30)
		destination.y=1.06; position_magnet(destination); await step(65)
		game._trigger(game.desktop_hand,true); await step(90)
		check(cargo.settled[i]>=1,"Parcel rests in nest after actual carry/drop "+str(i))
	game._grip(game.desktop_hand,true)
	check(not wand.busy(game.desktop_hand),"E puts wand away before lever")
	var hand=Node3D.new(); game.add_child(hand); hand.global_position=cargo.lever_handle.global_position
	check(game._grip(hand,false) and cargo.busy(hand),"Main grip takes physical bloom lever")
	hand.global_position+=Vector3(0,0,.29); await step(2)
	game.adventure.release(hand,false); hand.queue_free()
	check(relay.stage==2,"Fresh physical cargo delivery advances relay")
	game._button("festival:next")
	for i in range(180):
		await step()
		if game.living.active.has("living-unfinished-lullaby"): break
	check(game.living.active.has("living-unfinished-lullaby"),"NEXT prepares existing canonical garden")
	if game.living.active.has("living-unfinished-lullaby"):
		game._button("festival:next"); await step(2)
		check(game.camera.global_position.z< -70,"Ready garden NEXT uses declared landing")
		var e=game.living.active["living-unfinished-lullaby"].entities
		game.desktop_hand.global_position=e["glow-pebble"].node.global_position
		check(game._grip(game.desktop_hand,false),"Main grip takes real light pebble")
		game.desktop_hand.global_position=e["sun-bud"].node.global_position+Vector3.UP*.4
		await step(10)
		game.adventure.release(game.desktop_hand,false); await step(2)
		game.desktop_hand.global_position=e.handbell.node.global_position
		check(game._grip(game.desktop_hand,false),"Main grip takes real handbell")
		game.desktop_hand.global_position=e["song-bud"].node.global_position+Vector3.UP*.4
		await step(2); game._trigger(game.desktop_hand,false); await step(8)
		game.adventure.release(game.desktop_hand,false)
	check(relay.mode=="complete","Light presentation plus fresh triggered song complete relay")
	print("FESTIVAL_WALKTHROUGH_RESULT ",JSON.stringify(failures))
	return failures
