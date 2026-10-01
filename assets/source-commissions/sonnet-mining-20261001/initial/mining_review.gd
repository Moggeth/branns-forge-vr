extends SceneTree
## Native review: budgets, winding checks and GPU captures into ./review/.
## godot.exe --xr-mode off --audio-driver Dummy --path <this folder> --position -32000,-32000 --resolution 64x64 --no-focus --script res://mining_review.gd

const Art = preload("res://mining_visual_art.gd")
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var t0 := Time.get_ticks_usec()
	Art.warm_cache()
	print("WARM_MS ", (Time.get_ticks_usec() - t0) / 1000.0)
	_budgets()
	var out := ProjectSettings.globalize_path("res://review")
	DirAccess.make_dir_recursive_absolute(out)
	await _capture_cracks(out)
	await _capture_items(out)
	await _capture_site(out)
	print("MINING_REVIEW failures=", failures)
	quit(0 if failures.is_empty() else 1)

func _check_winding(label: String, mesh: ArrayMesh, flat_up: bool, outward: bool = true) -> void:
	var bad := 0
	var centre := mesh.get_aabb().get_center()
	for s in mesh.get_surface_count():
		var arrays := mesh.surface_get_arrays(s)
		var v: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var n: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		for i in range(0, v.size(), 3):
			var cw := (v[i + 2] - v[i]).cross(v[i + 1] - v[i]).normalized()  # points at viewer for a clockwise front face
			if cw.dot(n[i]) < 0.99: bad += 1
			elif flat_up and n[i].z < -0.25: bad += 1  # steep sliver/chip walls may undercut slightly; only genuinely downward faces are wrong
			elif outward and n[i].dot((v[i] + v[i + 1] + v[i + 2]) / 3.0 - centre) < -0.0005: bad += 1
	var total := 0
	for s2 in mesh.get_surface_count(): total += (mesh.surface_get_arrays(s2)[Mesh.ARRAY_VERTEX] as PackedVector3Array).size() / 3
	print("WINDING ", label, " flagged=", bad, "/", total)
	if bad > maxi(2, total / 100): failures.append("%s: %d mis-wound/inward triangles" % [label, bad])

func _budgets() -> void:
	var cache_meshes := 0
	for stage in range(1, 4):
		for v in 4:
			var m: ArrayMesh = Art.crack_mesh(stage, v)
			var tris := Art.triangle_count(m)
			var box := m.get_aabb()
			print("CRACK s%d v%d tris=%d surfaces=%d aabb=%s" % [stage, v, tris, m.get_surface_count(), box])
			if tris > 1500: failures.append("crack tris %d" % tris)
			if m.get_surface_count() > 3: failures.append("crack surfaces")
			if maxf(box.size.x, box.size.y) > 0.34: failures.append("crack footprint %s" % box.size)
			_check_winding("crack s%d v%d" % [stage, v], m, true, false)
			cache_meshes += 1
	for v in 6:
		var c: ArrayMesh = Art.crystal_mesh(v)
		var ch: ArrayMesh = Art.shell_chip_mesh(v)
		print("CRYSTAL v%d tris=%d aabb=%s | CHIP tris=%d aabb=%s" % [v, Art.triangle_count(c), c.get_aabb().size, Art.triangle_count(ch), ch.get_aabb().size])
		if Art.triangle_count(c) > 500 or Art.triangle_count(ch) > 500: failures.append("chunk tris")
		_check_winding("crystal %d" % v, c, false, false)
		_check_winding("chip %d" % v, ch, false)
		cache_meshes += 2
	print("CACHE meshes=", cache_meshes, " materials=", Art.KINDS.size() + Art.EXTRA_KINDS.size(), " shaders=2")

func _stage(size: Vector2i, bg: Color) -> Array:
	var vp := SubViewport.new()
	vp.size = size
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(vp)
	var st := Node3D.new()
	vp.add_child(st)
	var env := WorldEnvironment.new()
	env.environment = Environment.new()
	env.environment.background_mode = Environment.BG_COLOR
	env.environment.background_color = bg
	env.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.environment.ambient_light_color = Color("8c97a6")
	env.environment.ambient_light_energy = 0.55
	env.environment.glow_enabled = true
	env.environment.glow_intensity = 0.6
	st.add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-40, -30, 0)
	sun.light_energy = 1.5
	st.add_child(sun)
	var cam := Camera3D.new()
	cam.fov = 45.0
	st.add_child(cam)
	cam.current = true
	return [vp, st, cam]

func _wall(parent: Node3D, w: float, h: float) -> void:
	var wall := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(w, h)
	wall.mesh = q
	wall.material_override = Art.material("stone")
	parent.add_child(wall)

func _shot(vp: SubViewport, path: String) -> void:
	for i in 4: await process_frame
	await RenderingServer.frame_post_draw
	if vp.get_texture().get_image().save_png(path) != OK: failures.append("save " + path)
	vp.queue_free()

func _capture_cracks(out: String) -> void:
	var s := _stage(Vector2i(1800, 1300), Color("1c222c"))
	var vp: SubViewport = s[0]; var st: Node3D = s[1]; var cam: Camera3D = s[2]
	_wall(st, 2.2, 1.6)
	for stage in range(1, 4):
		for v in 4:
			var mi := MeshInstance3D.new()
			mi.mesh = Art.crack_mesh(stage, v)
			mi.position = Vector3(-0.78 + v * 0.52, 0.5 - (stage - 1) * 0.5, 0.0)
			st.add_child(mi)
	cam.position = Vector3(0, 0.0, 1.9)
	await _shot(vp, out.path_join("cracks_front.png"))
	# grazing depth read
	var g := _stage(Vector2i(1500, 700), Color("1c222c"))
	_wall(g[1], 1.6, 1.0)
	for k in 2:
		var mi := MeshInstance3D.new()
		mi.mesh = Art.crack_mesh(3, k)
		mi.position = Vector3(-0.22 + k * 0.44, 0.0, 0.0)
		g[1].add_child(mi)
	g[2].position = Vector3(0.9, 0.35, 0.55)
	g[2].look_at(Vector3(0, 0, 0))
	await _shot(g[0], out.path_join("cracks_grazing.png"))

func _capture_items(out: String) -> void:
	var s := _stage(Vector2i(1600, 800), Color("171c24"))
	var st: Node3D = s[1]; var cam: Camera3D = s[2]
	var floor_mesh := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(1.4, 0.7)
	floor_mesh.mesh = pm
	floor_mesh.material_override = Art.material("stone")
	floor_mesh.position.y = -0.1
	st.add_child(floor_mesh)
	for i in 6:
		var c := MeshInstance3D.new()
		c.mesh = Art.crystal_mesh(i)
		c.position = Vector3(-0.5 + i * 0.2, 0.0, 0.15)
		st.add_child(c)
		var ch := MeshInstance3D.new()
		ch.mesh = Art.shell_chip_mesh(i)
		ch.position = Vector3(-0.5 + i * 0.2, -0.03, -0.18)
		st.add_child(ch)
	# one chip per material kind for a distinct-material read
	for i in Art.KINDS.size():
		var kind: String = Art.KINDS[i]
		if kind == "crystal": continue
		var ch2 := MeshInstance3D.new()
		ch2.mesh = Art.shell_chip_mesh(i + 1)
		ch2.material_override = Art.material(kind)
		ch2.position = Vector3(-0.4 + i * 0.17, -0.03, -0.02)
		st.add_child(ch2)
	cam.position = Vector3(0.0, 0.5, 0.75)
	cam.look_at(Vector3(0, -0.03, -0.02))
	await _shot(s[0], out.path_join("items.png"))

func _capture_site(out: String) -> void:
	var s := _stage(Vector2i(1600, 800), Color("232a35"))
	var st: Node3D = s[1]; var cam: Camera3D = s[2]
	var ground := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(8, 5)
	ground.mesh = pm
	ground.material_override = Art.material("stone")
	st.add_child(ground)
	for stage in range(1, 4):
		for v in 3:
			Art.decorate_site(st, Vector3(-1.6 + (stage - 1) * 1.6 + v * 0.5 - 0.5, 0.0, -0.3 + v * 0.8), Vector3.UP, stage, v + stage)
	cam.position = Vector3(0, 1.0, 3.4)   # ground-level mining view
	cam.look_at(Vector3(0, 0, 0))
	await _shot(s[0], out.path_join("site_ground.png"))
	var r := _stage(Vector2i(1600, 800), Color("232a35"))
	var g2 := MeshInstance3D.new()
	g2.mesh = pm
	g2.material_override = Art.material("stone")
	r[1].add_child(g2)
	for stage in range(1, 4):
		for v in 3:
			Art.decorate_site(r[1], Vector3(-1.6 + (stage - 1) * 1.6 + v * 0.5 - 0.5, 0.0, -0.3 + v * 0.8), Vector3.UP, stage, v + stage)
	r[2].position = Vector3(0, 7.0, 4.5)   # RTS height
	r[2].look_at(Vector3(0, 0, 0.3))
	await _shot(r[0], out.path_join("site_rts.png"))
