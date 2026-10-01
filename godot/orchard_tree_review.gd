extends SceneTree
## Native, save-isolated captures of the placed Orchard and a real lumber cut.
## Run graphically with --world-builder-preview; never starts the live service.

const OUTPUT := "res://../outputs/orchard-tree-review"
const SIZE := Vector2i(1200, 750)
const TreeKit = preload("res://tree_kit.gd")

var failures: Array[String] = []
var views: Array[Dictionary] = []
var orchard_geometry: Dictionary = {}
var triangle_cache: Dictionary = {}

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview") or DisplayServer.get_name() == "headless":
		push_error("ORCHARD_TREE_REVIEW requires graphical --world-builder-preview")
		quit(2)
		return
	create_timer(45.0).timeout.connect(func() -> void:
		printerr("ORCHARD_TREE_REVIEW timeout=45")
		quit(2))
	call_deferred("_run")

func _run() -> void:
	root.unfocusable = true
	root.position = Vector2i(-12000, -12000)
	root.size = SIZE
	var output := ProjectSettings.globalize_path(OUTPUT)
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--review-output="):
			output = arg.trim_prefix("--review-output=")
	if not output.is_absolute_path():
		push_error("--review-output needs an absolute path")
		quit(2)
		return
	if DirAccess.make_dir_recursive_absolute(output) != OK:
		push_error("Cannot create " + output)
		quit(2)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	if not game.diagnostic_offline:
		failures.append("Main did not enter save-isolated diagnostic mode")
		_finish(output)
		return
	game.adventure.travel("orchard_highlands")
	await process_frame
	var zone: Dictionary = game.scene.zones["orchard_highlands"]
	orchard_geometry = _geometry_stats(zone.root)
	var viewport := SubViewport.new()
	viewport.size = SIZE
	viewport.world_3d = game.get_world_3d()
	viewport.msaa_3d = Viewport.MSAA_2X
	viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(viewport)
	var camera := Camera3D.new()
	camera.far = 300.0
	viewport.add_child(camera)
	camera.current = true
	var plot: Node3D = zone.root.get_node_or_null("OrchardPlot_00")
	var placed_tree: Node3D = null
	if plot != null:
		for child in plot.get_children():
			if child is Node3D and child.has_meta("tree_species") and str(child.get_meta("tree_species")) == "apple":
				placed_tree = child
				break
	if placed_tree == null:
		failures.append("Cider Rows has no placed apple TreeKit node")
	else:
		var at: Vector3 = placed_tree.global_position
		await _capture(viewport, camera, output, "placed-ground", at + Vector3(3.6, 1.65, 5.4), at + Vector3(0, 2.25, 0), 68.0, placed_tree)
		await _capture(viewport, camera, output, "placed-rts", at + Vector3(12, 15, 16), at + Vector3(0, 1.6, 0), 55.0, placed_tree)
	var center: Vector3 = zone.center
	var land: Node = game.landscape
	# Isolated native specimen under copies of the live Orchard sun/atmosphere.
	# This shows the TreeKit silhouette without neighboring orchard canopies.
	var specimen_viewport := SubViewport.new()
	specimen_viewport.size = SIZE
	specimen_viewport.own_world_3d = true
	specimen_viewport.msaa_3d = Viewport.MSAA_2X
	specimen_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(specimen_viewport)
	var specimen_environment := WorldEnvironment.new()
	specimen_environment.environment = (game.get_node("AdventureEnvironment") as WorldEnvironment).environment.duplicate(true)
	specimen_viewport.add_child(specimen_environment)
	var orchard_sun := game.get_node_or_null("AdventureSun") as DirectionalLight3D
	if orchard_sun == null:
		failures.append("Orchard sun missing for specimen")
	else:
		var specimen_sun := orchard_sun.duplicate() as DirectionalLight3D
		specimen_viewport.add_child(specimen_sun)
	var specimen_floor := MeshInstance3D.new()
	var specimen_plane := PlaneMesh.new()
	specimen_plane.size = Vector2(24, 24)
	specimen_floor.mesh = specimen_plane
	var specimen_floor_skin := StandardMaterial3D.new()
	specimen_floor_skin.albedo_color = Color("7d9a63")
	specimen_floor.material_override = specimen_floor_skin
	specimen_viewport.add_child(specimen_floor)
	var specimen := TreeKit.make_tree("apple", 1001, {"height": 5.0, "collision": false, "fruit": true, "lod": "near"})
	specimen.name = "OrchardReviewSpecimen"
	specimen_viewport.add_child(specimen)
	var specimen_camera := Camera3D.new()
	specimen_viewport.add_child(specimen_camera)
	specimen_camera.current = true
	var sample: Vector3 = specimen.global_position
	await _capture(specimen_viewport, specimen_camera, output, "specimen-close", sample + Vector3(0, 2.5, 9.0), sample + Vector3(0, 2.55, 0), 52.0, specimen)
	await _capture(specimen_viewport, specimen_camera, output, "specimen-elevated", sample + Vector3(5.5, 7.5, 6.0), sample + Vector3(0, 2.2, 0), 48.0, specimen)
	specimen_viewport.queue_free()
	await process_frame
	var path_eye := Vector2(-12, 26)
	var path_look := Vector2(-25, 34)
	await _capture(viewport, camera, output, "path-ground",
		center + Vector3(path_eye.x, land.height_at(path_eye) + 1.7, path_eye.y),
		center + Vector3(path_look.x, land.height_at(path_look) + 1.0, path_look.y), 68.0)
	var brook_eye := Vector2(35, -38)
	var brook_look := Vector2(25, -48)
	await _capture(viewport, camera, output, "riverbank-ground",
		center + Vector3(brook_eye.x, land.height_at(brook_eye) + 1.7, brook_eye.y),
		center + Vector3(brook_look.x, land.height_at(brook_look) + 0.8, brook_look.y), 68.0)
	var timber: Node3D = null
	for candidate in game.scene.get("resources", []):
		if candidate is Node3D and str(candidate.get_meta("zone", "")) == "orchard_highlands" and str(candidate.get_meta("resource", "")) == "lumber" and str(candidate.get_meta("requires", "")) == "axe":
			timber = candidate
			break
	if timber == null:
		failures.append("Orchard lumber resource missing")
	else:
		var trunk: MeshInstance3D = timber.get_meta("trunk", null)
		if not is_instance_valid(trunk) or not timber.has_meta("trunk_mesh"):
			failures.append("Choppable tree lost trunk metadata")
		else:
			var base: Vector3 = timber.global_position
			var hit := timber.to_global(Vector3(0.25, 1.05, 0))
			var aim := base + Vector3(0, 1.12, 0)
			await _capture(viewport, camera, output, "timber-before", base + Vector3(2.5, 1.65, 3.4), aim, 61.0, timber)
			for index in range(2):
				if game.melee.chop(timber, hit + Vector3.UP * (0.035 * index), Vector3.RIGHT, null, 2.4, false):
					failures.append("Tree felled before third aligned hit")
				await _capture(viewport, camera, output, "cut-%d" % (index + 1), base + Vector3(2.5, 1.65, 3.4), aim, 61.0, timber)
			if not game.melee.chop(timber, hit + Vector3.UP * 0.07, Vector3.RIGHT, null, 2.4, false):
				failures.append("Third aligned hit did not fell tree")
			await _capture(viewport, camera, output, "cut-3-start", base + Vector3(2.5, 1.65, 3.4), aim, 61.0, timber)
			var felling: Node3D = null
			for child in game.adventure.zone_groups.get("orchard_highlands", game).get_children():
				if child.get_script() == preload("res://tree_felling.gd") and child.source == timber:
					felling = child
					break
			if felling == null:
				failures.append("TreeFelling helper missing after cut")
			else:
				await create_timer(1.85).timeout
				await _capture(viewport, camera, output, "fallen-and-log", base + Vector3(7.5, 3.25, 5.6), base + Vector3(0, 2.0, 0), 57.0, felling)
				if not is_instance_valid(felling.stump) or not is_instance_valid(felling.log):
					failures.append("Felled tree lost stump or physical log")
				await _capture(viewport, camera, output, "stump-and-log", base + Vector3(2.6, 1.85, 2.15), base + Vector3(0, 0.9, 0), 57.0, felling)
	_finish(output)

func _capture(viewport: SubViewport, camera: Camera3D, output: String, id: String, eye: Vector3, target: Vector3, fov: float, subject: Node = null) -> void:
	camera.fov = fov
	camera.global_position = eye
	camera.look_at(target, Vector3.UP)
	for frame in 6: await process_frame
	await RenderingServer.frame_post_draw
	var rendering := {
		"draw_calls": roundi(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME)),
		"primitives": roundi(Performance.get_monitor(Performance.RENDER_TOTAL_PRIMITIVES_IN_FRAME)),
		"objects": roundi(Performance.get_monitor(Performance.RENDER_TOTAL_OBJECTS_IN_FRAME)),
		"fps": snappedf(Performance.get_monitor(Performance.TIME_FPS), 0.01),
		"process_ms": snappedf(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, 0.01),
		"physics_ms": snappedf(Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0, 0.01),
	}
	var image := viewport.get_texture().get_image()
	var path := output.path_join(id + ".png")
	var error := image.save_png(path) if not image.is_empty() else ERR_CANT_CREATE
	if error != OK: failures.append("Capture failed: " + id + " error=" + str(error))
	views.append({"id": id, "path": path, "camera": [eye.x, eye.y, eye.z], "target": [target.x, target.y, target.z], "width": image.get_width(), "height": image.get_height(), "save_error": error, "rendering": rendering, "subject_geometry": _geometry_stats(subject) if subject != null else {}})

func _geometry_stats(origin: Node) -> Dictionary:
	var counts := {"mesh_nodes": 0, "multimesh_nodes": 0, "instances": 0, "mesh_triangles": 0, "instanced_triangles": 0}
	if origin == null: return counts
	var pending: Array[Node] = [origin]
	while not pending.is_empty():
		var node: Node = pending.pop_back()
		if node is MeshInstance3D and node.mesh != null:
			var triangles := _mesh_triangles(node.mesh)
			counts.mesh_nodes += 1
			counts.instances += 1
			counts.mesh_triangles += triangles
			counts.instanced_triangles += triangles
		elif node is MultiMeshInstance3D and node.multimesh != null and node.multimesh.mesh != null:
			var triangles := _mesh_triangles(node.multimesh.mesh)
			var instance_count: int = node.multimesh.instance_count
			counts.multimesh_nodes += 1
			counts.instances += instance_count
			counts.mesh_triangles += triangles
			counts.instanced_triangles += triangles * instance_count
		for child in node.get_children(): pending.append(child)
	return counts

func _mesh_triangles(mesh: Mesh) -> int:
	var key := mesh.get_instance_id()
	if not triangle_cache.has(key):
		triangle_cache[key] = mesh.get_faces().size() / 3
	return int(triangle_cache[key])

func _finish(output: String) -> void:
	var result := {"zone": "orchard_highlands", "save_isolated": true, "orchard_geometry": orchard_geometry,
		"geometry_note": "Scene geometry counts include all instances and shadow twins, including geometry outside each camera frustum.",
		"rendering_note": "Performance counters cover the full capture frame across viewports. FPS and process times include capture pacing and image readback; they are not gameplay benchmarks.",
		"views": views, "failures": failures}
	var file := FileAccess.open(output.path_join("result.json"), FileAccess.WRITE)
	if file == null:
		failures.append("Cannot write result.json")
	else:
		file.store_string(JSON.stringify(result, "  "))
		file.close()
	print("ORCHARD_TREE_REVIEW ", JSON.stringify({"views": views.size(), "failures": failures}))
	quit(0 if failures.is_empty() and views.size() == 12 else 1)
