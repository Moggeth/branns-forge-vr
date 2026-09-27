extends Node
func run(game):
	game.set_process(false); game.smoke=true
	for i in range(3): await get_tree().physics_frame
	var folder=ProjectSettings.globalize_path("res://../outputs/bellworks")
	DirAccess.make_dir_recursive_absolute(folder)
	game.hud.get_parent().visible=false
	var garden=JSON.parse_string(FileAccess.get_file_as_string("res://living_unfinished_lullaby.json"))
	await game.living.publish(garden)
	await game.living._stage_group([garden])
	var views=[
		{"name":"01-forge-discovery","from":Vector3(5,2.2,8),"at":Vector3(10,1.3,2)},
		{"name":"02-bellworks-court","from":Vector3(121,3.1,72),"at":Vector3(120,1.9,61)},
		{"name":"03-sunskipper","from":Vector3(118.1,1.75,69.2),"at":Vector3(117,1.15,68)},
		{"name":"04-copper-kite-cargo","from":Vector3(135,3.6,73),"at":Vector3(140,1.4,64)},
		{"name":"05-copper-gardener","from":Vector3(139,2.4,63),"at":Vector3(140,2,60)},
		{"name":"06-unfinished-lullaby","from":Vector3(122,3.2,-80),"at":Vector3(120,1.4,-92)}]
	for view in views:
		game.camera.global_position=view.from; game.camera.look_at(view.at)
		if view.name=="03-sunskipper":
			game.playful_tools.ring.global_position=Vector3(117,1.35,68)
			game.playful_tools.ring.rotation=Vector3(.5,.25,.2)
			game.playful_tools.state="showcase"
		if view.name=="05-copper-gardener":
			game.cargo_playground.can_launch=true; game.cargo_playground.act("launch")
		for i in range(120 if view.name=="05-copper-gardener" else 20):
			game.cargo_playground.tick(.016); game.magnetic_wand.tick(.016)
			game.playful_encounters.tick(.016); game.playful_fair_art.tick(.016); game.playful_feedback.tick(.016)
			await get_tree().process_frame
		if DisplayServer.get_name()!="headless":
			await RenderingServer.frame_post_draw
			var error=game.get_viewport().get_texture().get_image().save_png(folder+"/"+view.name+".png")
			print("PLAYFUL_CAPTURE ",view.name," error=",error)
	print("PLAYFUL_SHOWCASE_DONE")
	get_tree().quit()
