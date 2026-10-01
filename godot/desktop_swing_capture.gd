extends SceneTree
## Native 30 fps deterministic samples of production held models and camera pose.
const Adventure = preload("res://adventure_runtime.gd")
const Grips = preload("res://grip_runtime.gd")
const Pose = preload("res://desktop_weapon_pose.gd")
const FPS := 30.0

class ModelHost extends Node3D:
	func _collider(_parent: Node3D, _size: Vector3, _center: Vector3) -> void: pass

func _initialize() -> void: call_deferred("_capture")

func _capture() -> void:
	if DisplayServer.get_name() == "headless": quit(2); return
	create_timer(120.0).timeout.connect(func(): quit(2))
	root.unfocusable = true
	root.size = Vector2i(1280, 800)
	root.position = Vector2i(-16000, -16000)
	var output := ProjectSettings.globalize_path("res://../outputs/desktop-swing")
	DirAccess.make_dir_recursive_absolute(output)
	var host := ModelHost.new()
	root.add_child(host)
	var world := WorldEnvironment.new()
	var environment := Environment.new()
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = Color("434f58")
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	environment.ambient_light_color = Color("d6dcdf")
	environment.ambient_light_energy = 0.8
	world.environment = environment
	host.add_child(world)
	var sun := DirectionalLight3D.new()
	host.add_child(sun)
	sun.rotation_degrees = Vector3(-40, -30, 0)
	sun.light_energy = 1.9
	var camera := Camera3D.new()
	host.add_child(camera)
	camera.position.y = 1.65
	camera.fov = 75
	camera.current = true
	var hand := Node3D.new()
	camera.add_child(hand)
	var adventure := Adventure.new()
	host.add_child(adventure)
	adventure.game = host
	var grips := Grips.new()
	host.add_child(grips)
	var canvas := CanvasLayer.new()
	host.add_child(canvas)
	var cross := Label.new()
	canvas.add_child(cross)
	cross.text = "+"
	cross.position = Vector2(628, 389)
	cross.add_theme_font_size_override("font_size", 24)
	var caption := Label.new()
	canvas.add_child(caption)
	caption.position = Vector2(24, 24)
	caption.add_theme_font_size_override("font_size", 24)
	var guide := Line2D.new()
	canvas.add_child(guide)
	guide.points = PackedVector2Array([Vector2(890, 185), Vector2(640, 400), Vector2(345, 645)])
	guide.width = 2
	guide.default_color = Color(0.65, 0.82, 0.86, 0.25)
	root.position = Vector2i(-16000, -16000)
	var failures: Array[String] = []
	var began := Time.get_ticks_usec()
	for id in ["woodland_axe", "quarry_pick", "apprentice_hammer"]:
		var item: Node3D = adventure._tool_model(id)
		hand.add_child(item)
		item.transform = grips._default_pose(item, hand)
		var profile: Dictionary = Pose.profile(item)
		var duration: float = float(profile.get("duration", 0.55))
		var contact: float = float(profile.get("contact", 0.5))
		for mode in ["normal", "slow"]:
			var total: float = duration * (1.0 if mode == "normal" else 2.0)
			var frames := maxi(2, ceili(total * FPS) + 1)
			var directory := output.path_join("%s-%s" % [id, mode])
			DirAccess.make_dir_recursive_absolute(directory)
			var previous_frames := DirAccess.get_files_at(directory)
			for filename in previous_frames:
				if filename.begins_with("frame-") and filename.ends_with(".png"):
					DirAccess.remove_absolute(directory.path_join(filename))
			for index in frames:
				var seconds := minf(float(index) / FPS, total)
				var progress := clampf(seconds / total, 0.0, 1.0)
				var rest: Transform3D = Pose.idle(0.0, 0.0, 0.0)
				hand.transform = Pose.swing(item, progress, rest, 1.4)
				caption.text = "%s | %s | %03d ms / %03d ms | contact %03d ms" % [Adventure.TOOL_NAMES[id], mode, roundi(seconds * 1000.0), roundi(total * 1000.0), roundi(contact * total * 1000.0)]
				await process_frame
				await RenderingServer.frame_post_draw
				var path := directory.path_join("frame-%03d.png" % index)
				var image: Image = root.get_texture().get_image()
				if image.is_empty() or image.save_png(path) != OK:
					failures.append(path)
					break
			if not failures.is_empty(): break
		item.free()
		if not failures.is_empty(): break
	print("DESKTOP_SWING_CAPTURE ", {"directory": output, "failures": failures, "seconds": (Time.get_ticks_usec() - began) / 1000000.0})
	host.free()
	quit(0 if failures.is_empty() else 1)
