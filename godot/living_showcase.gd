extends Node
## Deterministic offline visual/performance review; never writes player state.
func run(game):
	game.set_process(false); game.smoke=true
	var demos=JSON.parse_string(FileAccess.get_file_as_string("res://living_demo_packages.json"))
	for package in demos: game.living.wanted[package.id]=package
	for i in range(70):
		game.elapsed+=.016; game.living.tick(.016); await get_tree().process_frame
	var history=demos.duplicate(true)
	game.living.museum.sync({"history":history,"packages":demos,"catalog":{"demoPackages":demos},"deployments":{}})
	var total=0; var worst=0; var samples=[]
	for i in range(240):
		var start=Time.get_ticks_usec(); game.living.tick(1.0/90.0); var cost=Time.get_ticks_usec()-start
		total+=cost; worst=maxi(worst,cost); samples.append(cost)
	samples.sort()
	print("LIVING_PROFILE packages=",game.living.active.size()," entities=",game.living.components.entries.size()," mean_us=",total/240.0," p95_us=",samples[228]," max_us=",worst)
	var folder=ProjectSettings.globalize_path("res://../work/living-showcase")
	DirAccess.make_dir_recursive_absolute(folder)
	for view in [{"name":"forge-archive-gate","from":Vector3(-5,2.5,4),"at":Vector3(-11,1.3,2)},{"name":"museum","from":Vector3(-120,2.6,-4),"at":Vector3(-120,1.9,12)},{"name":"test-garden","from":Vector3(120,10,18),"at":Vector3(120,1,-9)},{"name":"maker-tools","from":Vector3(120,2,-14),"at":Vector3(120,1.2,-18)}]:
		game.camera.global_position=view.from; game.camera.look_at(view.at)
		for i in range(12): await get_tree().process_frame
		if DisplayServer.get_name()!="headless":
			await RenderingServer.frame_post_draw
			var error=game.get_viewport().get_texture().get_image().save_png(folder+"/"+view.name+".png")
			print("LIVING_CAPTURE ",view.name," result=",error," draws=",Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))
	print("LIVING_SHOWCASE_DONE")
	get_tree().quit()
