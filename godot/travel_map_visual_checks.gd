extends SceneTree
## Offline rendered layout checks. Never starts the game, service or XR session.
var failures: Array = []
func _initialize() -> void: run.call_deferred()
func run() -> void:
	root.position=Vector2i(4200,2400)
	root.set_flag(Window.FLAG_NO_FOCUS,true)
	root.content_scale_size=Vector2i.ZERO
	var panel=load("res://travel_map_panel.gd").new()
	root.add_child(panel)
	var data: Dictionary={"current":"forge_yard","selected":"orchard_highlands","notice":"Travel is free. Choose a destination, then G.","equipment_line":"Held: Stonewhisper · LMB mine · RMB charge resonance · E drop",
		"destinations":[],"wallets":[{"title":"Hero pouch / Brann's workshop","description":"Saved by the forge. Donation buckets reserve offerings; settlement stock is separate.","rows":[{"name":"Lumber","amount":"32","purpose":"Workshop construction; this is separate from settlement timber."},{"name":"Crystal","amount":"6","purpose":"Gathered expedition material; not a Starfall star gem."}]},{"title":"Orchard settlement","description":"One shared saved stockpile for world-building; never added to your Hero pouch.","rows":[{"name":"Mana","amount":"18.4 / 20","purpose":"Regenerates; casts terrain, forest and encounter spells."},{"name":"Star gems","amount":"14","purpose":"Two star gems and 2 Mana create a Crystal Fault."}]}],"items":[{"name":"Siegebird","state":"Ready to equip","description":"R loads an unlimited bolt; LMB fires. Hold R to reel an attached grappling cable."}],"costs":[]}
	for id in ["forge_yard","orchard_highlands","pinewood_ruins","sandstone_quarry","enchanted_kitchen","mushroom_glade","crystal_hollow","sky_garden","ember_foundry","gloamfen","starfall_ridge","cloudbreak_keep","glowroot_grotto","starlace_archive","moonwater_causeway"]:
		data.destinations.append({"id":id,"name":id.replace("_"," ").capitalize(),"available":true,"reason":"","description":"Explore the hills, winding stream and magical landforms. Carried progress stays intact.","resources":"Mine Starfall veins for star gems and star iron. Open Supplies for resource uses."})
	for i in 30: data.costs.append({"name":"Crystal Fault" if i%2==0 else "Earthen Wall","cost":"2 Mana + 2 star gems" if i%2==0 else "4 Mana or 2 star iron","state":"Need 2 more star gems" if i%2==0 else "Cooldown · 4.2s","description":"Terrain spells use the Orchard settlement stockpile. Hero crystals cannot pay this cost."})
	var directory=ProjectSettings.globalize_path("res://../outputs/travel-guide-review")
	DirAccess.make_dir_recursive_absolute(directory)
	for dimensions in [Vector2i(960,620),Vector2i(1920,1080),Vector2i(3840,2160)]:
		root.size=dimensions
		panel.set_model(data)
		for page in ["map","supplies"]:
			panel.set_page(page)
			for frame in 5: await process_frame
			await RenderingServer.frame_post_draw
			var bounds: Rect2=panel._panel.get_global_rect()
			print("FOLIO_LAYOUT requested=",dimensions," viewport=",root.get_visible_rect()," control=",panel.size," panel=",bounds," minimum=",panel._panel.get_combined_minimum_size())
			if not Rect2(Vector2.ZERO,Vector2(dimensions)).encloses(bounds): failures.append("Panel exceeds viewport: "+str(dimensions)+" "+page)
			root.get_texture().get_image().save_png(directory+"/%dx%d-%s.png"%[dimensions.x,dimensions.y,page])
			if page=="supplies":
				panel._sup_scroll.scroll_vertical=220
				var before:int=panel._sup_scroll.scroll_vertical
				panel.set_model(data)
				if panel._sup_scroll.scroll_vertical!=before: failures.append("Live refresh resets scroll")
	print("TRAVEL_MAP_VISUAL_RESULT ",JSON.stringify({"failures":failures,"output":directory}))
	panel.queue_free()
	await process_frame
	quit(0 if failures.is_empty() else 1)
