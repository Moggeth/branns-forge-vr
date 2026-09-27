extends RefCounted
## Offline movie capture exercises the production wind/load/fire functions.
static func capture(game,w,folder:String):
	DirAccess.make_dir_recursive_absolute(folder)
	game.set_process(false)
	var system=game.siegebird
	var owner=Node3D.new(); game.add_child(owner)
	var loader=Node3D.new(); game.add_child(loader)
	game.held[str(owner.get_instance_id())]=w.item
	w.draw=0; w.angle=0; w.loaded=false; w.release=0
	var loose=system.make_bolt()
	loose.global_basis=w.item.global_basis
	var layer=CanvasLayer.new(); game.add_child(layer)
	var title=Label.new(); layer.add_child(title); title.position=Vector2(48,36)
	title.add_theme_font_size_override("font_size",30)
	var caption=Label.new(); layer.add_child(caption); caption.position=Vector2(48,82)
	caption.add_theme_font_size_override("font_size",22)
	title.text="SIEGEBIRD  /  Brann's Forge"
	for frame in range(168):
		var phase=""
		if frame<72:
			phase="Wind the crank · the drum draws the string"
			system.wind(w,TAU*system.TURNS/72.0)
			loose.visible=false
		elif frame<108:
			phase="Pick up a bolt · align it · release to seat"
			loose.visible=true
			var t=float(frame-72)/35.0
			loose.global_position=w.seat.global_position+w.item.global_basis*Vector3(0.30*(1-t),-0.10*(1-t),0.25*(1-t))
			if frame==107:
				system.occupied[str(loader.get_instance_id())]={"type":"bolt","hand":loader,"node":loose}
				system.release(loader)
		elif frame<132:
			phase="Cocked and loaded · the crystal sight stays clear"
		else:
			phase="Trigger · clutch releases · crank stays still"
			if frame==132: system.trigger(owner)
			system.tick(1.0/24.0)
		caption.text=phase
		system.mechanism(w)
		w.label.visible=false
		var a=lerpf(-0.70,0.60,float(frame)/167.0)
		game.camera.global_position=w.item.to_global(Vector3(1.35*cos(a),0.40+1.35*sin(a),0.85))
		game.camera.look_at(w.item.to_global(Vector3(0,0.40,0)),w.item.global_basis.z)
		await RenderingServer.frame_post_draw
		var error=game.get_viewport().get_texture().get_image().save_png(folder.path_join("%04d.png"%frame))
		if error!=OK: push_error("Siegebird frame capture failed: "+str(error)); game.get_tree().quit(4); return
	game.held.erase(str(owner.get_instance_id()))
	print("SIEGEBIRD_MOVIE frames=168 fps=24 production_wind_load_fire=true")
	game.get_tree().quit()
