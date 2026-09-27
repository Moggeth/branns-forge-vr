extends RefCounted

static func run(game,failures:Array):
	game.set_process(false)
	var saved=game.state.duplicate(true); var hp=game.adventure.hp; var shield=game.shield_until
	var hand=Node3D.new(); game.add_child(hand); var key=str(hand.get_instance_id())
	var item=game.adventure._tool_model("woodland_axe"); game.add_child(item)
	game.state.workshop.modules=[{"id":"test-verdant","kind":"verdant"},{"id":"test-hearth","kind":"hearth"}]
	game.state.workshop.sockets={"woodland_axe":"test-verdant"}
	game.adventure.hp=50
	if not game.enchantments.alternate(item,hand) or game.adventure.hp!=60: failures.append("verdant effect not applied")
	game.enchantments.alternate(item,hand)
	if game.adventure.hp!=60: failures.append("verdant cooldown bypass")
	game.state.workshop.sockets.woodland_axe="test-hearth"
	if not game.enchantments.alternate(item,hand) or game.shield_until<game.elapsed+2.9: failures.append("hearth ward missing")
	game.grips._attach(hand,item); item.global_position=game.enchantments.cradle.global_position
	if not game.enchantments.park_weapon(hand) or game.held.has(key) or item.get_parent()!=game.enchantments.cradle: failures.append("tinker physical weapon parking")
	game.enchantments._badge(item,game.state.workshop.sockets)
	if item.get_node_or_null("ModuleSocket/InstalledModule")==null: failures.append("physical socket badge")
	game.state.workshop.sockets.woodland_axe="test-verdant"; game.enchantments._badge(item,game.state.workshop.sockets)
	if item.get_node("ModuleSocket/InstalledModule").get_meta("module_id","")!="test-verdant": failures.append("replacement module badge stays stale")
	for i in range(6): game.state.workshop.modules.append({"id":"tray-%d"%i,"kind":"verdant"})
	if game.enchantments._index("tray-5")!=7: failures.append("module rack home identity")
	game.enchantments._spawn({"id":"tray-5","kind":"verdant"}); game.enchantments.tray_page=0; game.enchantments._update_tray()
	if game.enchantments.modules["tray-5"].visible: failures.append("off-page modules visible")
	game.enchantments.tray_page=1; game.enchantments._update_tray()
	if not game.enchantments.modules["tray-5"].visible: failures.append("module paging hides owned item")
	game.enchantments.modules["tray-5"].queue_free(); game.enchantments.modules.erase("tray-5"); game.enchantments.tray_page=0
	var crossbow=preload("res://siegebird_checks.gd").load_sample(game)
	if crossbow!=null:
		var mechanism=game.siegebird.weapons.back(); game.held[key]=crossbow
		game.state.workshop.modules.append({"id":"test-quickwind","kind":"quickwind"})
		game.state.workshop.sockets[game.siegebird.ITEM_ID]="test-quickwind"
		if game.siegebird._turns(mechanism)!=1: failures.append("quickwind required turns")
		mechanism.draw=0; mechanism.loaded=false; mechanism.release=0
		for step in range(36): game.siegebird.wind(mechanism,TAU/36.0)
		if mechanism.draw<0.999: failures.append("quickwind one physical turn did not cock")
		game.siegebird.mechanism(mechanism)
		if not mechanism.drum.scale.is_equal_approx(mechanism.drum_original_scale): failures.append("quickwind changed clearances by scaling the drum")
		var view=game.camera.global_transform
		crossbow.global_transform=Transform3D.IDENTITY; crossbow.position=Vector3(100,50,100)
		var optic=mechanism.optic.global_position
		game.camera.global_position=optic-Vector3.UP*0.3; game.camera.look_at(optic,Vector3.FORWARD)
		if not game.enchantments.truesight_optics(mechanism): failures.append("aligned true optic not detected")
		game.camera.global_position=optic+Vector3.UP*0.3; game.camera.look_at(optic,Vector3.FORWARD)
		if game.enchantments.truesight_optics(mechanism): failures.append("optic accepted eye in front")
		game.camera.global_position=optic-Vector3.UP*0.3+Vector3.RIGHT*0.2; game.camera.look_at(optic,Vector3.FORWARD)
		if game.enchantments.truesight_optics(mechanism): failures.append("optic accepted lateral eye")
		game.camera.global_transform=view
		game.siegebird.weapons.erase(mechanism); crossbow.queue_free()
	game.held.erase(key); game.grips.grips.erase(key)
	game.grips._place_belt(1.0)
	hand.global_position=game.workshop.pouch.global_position
	if not game.workshop.try_grab(hand) or game.workshop.pouch_carrier!=hand:
		failures.append("hip pouch cannot be lifted")
	else:
		hand.global_position=game.camera.global_position+Vector3(0,-0.38,-0.30)
		game.workshop.tick(0.016)
		if not game.workshop.pouch_open: failures.append("lifted pouch did not open")
		game.workshop.release(hand)
		if game.workshop.pouch_carrier!=null or game.workshop.pouch_open or game.workshop.pouch.get_parent()!=game.grips.belt:
			failures.append("released pouch did not return to belt")
	item.queue_free(); hand.queue_free(); game.state=saved; game.adventure.hp=hp; game.shield_until=shield
	game.enchantments.heal_until.clear(); game.enchantments.wards_until.clear()
	if game.smoke and not game.diagnostic_offline:
		var old_position=game.rig.global_position; var old_zone=game.adventure.zone
		game.adventure.travel("forge_yard"); game.rig.global_position=Vector3(5,0,-3)
		await game._send_context()
		await game._request("/api/vr/gather",{"id":"workshop-smoke-material","resource":"iron","amount":1})
		await game._poll()
		var before=int(game.state.resources.iron)
		var physical_hand=Node3D.new(); game.add_child(physical_hand); var physical_key=str(physical_hand.get_instance_id())
		game.workshop.pouch_index=3
		await game.workshop._take(physical_hand)
		var token_id=str(game.workshop.held.get(physical_key,""))
		if token_id.is_empty() or int(game.state.resources.iron)!=before-1: failures.append("physical pouch debit and attachment")
		else:
			physical_hand.global_position=game.workshop.pouch.global_position
			await game.workshop._release_token(token_id,physical_hand)
			if int(game.state.resources.iron)!=before or not game.workshop.token_data(token_id).is_empty(): failures.append("physical pouch return did not conserve")
		physical_hand.queue_free(); game.adventure.travel(old_zone); game.rig.global_position=old_position
	game.set_process(true)
	print("WORKSHOP_CHECK pouch conservation / physical lever / cradle / sockets / module effects / optic geometry complete")
