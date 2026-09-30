extends SceneTree
## Real held meshes and production swing transforms, without Main or player saves.
## Run graphically with --xr-mode off --audio-driver Dummy --path godot --script res://desktop_swing_capture.gd.
const Adventure=preload("res://adventure_runtime.gd")
const Grips=preload("res://grip_runtime.gd")
const Pose=preload("res://desktop_weapon_pose.gd")

class ModelHost extends Node3D:
	func _collider(_parent:Node3D,_size:Vector3,_center:Vector3)->void: pass

func _initialize()->void: call_deferred("_capture")

func _capture()->void:
	root.size=Vector2i(1280,800)
	var output=ProjectSettings.globalize_path("res://../outputs/desktop-swing")
	DirAccess.make_dir_recursive_absolute(output)
	var host=ModelHost.new(); root.add_child(host)
	var world=WorldEnvironment.new(); var environment=Environment.new()
	environment.background_mode=Environment.BG_COLOR
	environment.background_color=Color("434f58")
	environment.ambient_light_source=Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color=Color("d6dcdf"); environment.ambient_light_energy=.8
	world.environment=environment; host.add_child(world)
	var sun=DirectionalLight3D.new(); host.add_child(sun)
	sun.rotation_degrees=Vector3(-40,-30,0); sun.light_energy=1.9
	var camera=Camera3D.new(); host.add_child(camera)
	camera.position.y=1.65; camera.fov=75; camera.current=true
	var hand=Node3D.new(); camera.add_child(hand)
	var adventure=Adventure.new(); host.add_child(adventure); adventure.game=host
	var grips=Grips.new(); host.add_child(grips)
	var canvas=CanvasLayer.new(); host.add_child(canvas)
	var cross=Label.new(); canvas.add_child(cross)
	cross.text="+"; cross.position=Vector2(628,389); cross.add_theme_font_size_override("font_size",24)
	var caption=Label.new(); canvas.add_child(caption)
	caption.position=Vector2(24,24); caption.add_theme_font_size_override("font_size",24)
	var guide=Line2D.new(); canvas.add_child(guide)
	guide.points=PackedVector2Array([Vector2(890,185),Vector2(640,400),Vector2(345,645)])
	guide.width=2; guide.default_color=Color(.65,.82,.86,.25)
	for id in ["woodland_axe","quarry_pick","apprentice_hammer"]:
		var item=adventure._tool_model(id); hand.add_child(item)
		item.transform=grips._default_pose(item,hand)
		for phase in [{"name":"idle","p":-1.0},{"name":"windup","p":.2},{"name":"contact","p":.5},{"name":"follow","p":.8}]:
			var rest=Pose.idle(0,0,0)
			hand.transform=rest if phase.p<0 else Pose.swing(item,phase.p,rest,1.4)
			caption.text="%s · %s · production FPS pose"%[Adventure.TOOL_NAMES[id],phase.name]
			for frame in 5: await process_frame
			var path=output.path_join("%s-%s.png"%[id,phase.name])
			var error=root.get_texture().get_image().save_png(path)
			if error!=OK:
				push_error("swing capture failed: %s (%d)"%[path,error]); quit(5); return
		item.free()
	print("DESKTOP_SWING_CAPTURE ",output)
	host.free()
	quit()
