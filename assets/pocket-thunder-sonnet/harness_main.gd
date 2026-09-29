extends Node3D
var elapsed = 0.0
var vis
func _ready():
	get_window().size = Vector2i(480, 360)
	var env = WorldEnvironment.new(); var e = Environment.new()
	e.background_mode = Environment.BG_COLOR; e.background_color = Color(0.55, 0.7, 0.85)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR; e.ambient_light_color = Color(0.7, 0.75, 0.8); e.ambient_light_energy = 0.7
	env.environment = e; add_child(env)
	var sun = DirectionalLight3D.new(); sun.rotation_degrees = Vector3(-50, 30, 0); sun.light_energy = 1.0; add_child(sun)
	var floor = MeshInstance3D.new(); var pm = PlaneMesh.new(); pm.size = Vector2(60, 60); floor.mesh = pm
	var fm = StandardMaterial3D.new(); fm.albedo_color = Color(0.32, 0.5, 0.2); floor.material_override = fm; add_child(floor)
	var body = StaticBody3D.new(); var cs = CollisionShape3D.new(); var bx = BoxShape3D.new(); bx.size = Vector3(60, 1, 60); cs.shape = bx; body.position.y = -0.5; body.add_child(cs); add_child(body)
	vis = load("res://pocket_thunder_visuals.gd").new(); add_child(vis); vis.setup(self)
	var cam = Camera3D.new(); add_child(cam); cam.current = true
	var times = [-0.05, 0.03, 0.08, 0.15, 0.25, 0.4, 0.6, 0.9]
	var views = [[Vector3(0, 1.6, 4.2), Vector3(0, 0.4, 0)], [Vector3(0, 9, 7), Vector3(0, 0, 0)]]
	var sheet = Image.create(480 * 4, 360 * 4, false, Image.FORMAT_RGB8)
	# bomb model close-up first
	var holder = Node3D.new(); add_child(holder); holder.position = Vector3(0, 0.6, 0)
	for v in range(2):
		cam.position = views[v][0]; cam.look_at(views[v][1])
		for ti in range(8):
			for b in vis.bursts.duplicate(): pass
			vis.explosion(Vector3(0, 0.05, 0), 2.2, 1.0, 0.75, 24, Vector3(1, 0.2, 0))
			var target = maxf(times[ti], 0.0) + (0.75 * 0.06 if ti == 0 else 0.0)
			var t = 0.0
			var dt = 1.0 / 60.0
			var steps = int(round((times[ti] + 0.06 * 0.75 * 1.0) / dt)) if ti > 0 else 2
			for s in range(steps): vis.tick(dt); elapsed += dt
			await RenderingServer.frame_post_draw
			await RenderingServer.frame_post_draw
			var img = get_viewport().get_texture().get_image(); img.convert(Image.FORMAT_RGB8)
			sheet.blit_rect(img, Rect2i(0, 0, 480, 360), Vector2i((ti % 4) * 480, (v * 2 + ti / 4) * 360))
			# flush blast
			for s in range(300): vis.tick(dt)
	sheet.save_png(OS.get_environment("PT_OUT"))
	# model view
	var bomb = vis.create_bomb(holder, 0.095 * 3.0)
	cam.position = Vector3(0.2, 0.9, 1.3); cam.look_at(Vector3(0, 0.6, 0))
	var sheet2 = Image.create(480 * 3, 360, false, Image.FORMAT_RGB8)
	for i in range(3):
		vis.update_forming(bomb, [0.4, 0.7, 1.0][i])
		vis.tick(0.016)
		await RenderingServer.frame_post_draw
		await RenderingServer.frame_post_draw
		var im = get_viewport().get_texture().get_image(); im.convert(Image.FORMAT_RGB8)
		sheet2.blit_rect(im, Rect2i(0, 0, 480, 360), Vector2i(i * 480, 0))
	sheet2.save_png(OS.get_environment("PT_OUT2"))
	get_tree().quit()
