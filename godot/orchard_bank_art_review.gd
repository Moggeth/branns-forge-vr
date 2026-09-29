extends SceneTree
## Save-isolated close views of real Orchard dressing placements, not a prop stage.

const OUTPUT := "res://../outputs/orchard-bank-review"
const IDS := ["rock_mossy_boulder", "rock_mossy_slab", "branch_fallen_mossy", "fern_bank_patch"]
var failures: Array[String] = []

func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-preview") or DisplayServer.get_name() == "headless":
		push_error("ORCHARD_BANK_ART_REVIEW requires graphical --world-builder-preview")
		quit(1)
		return
	call_deferred("_run")

func _run() -> void:
	var output := ProjectSettings.globalize_path(OUTPUT)
	DirAccess.make_dir_recursive_absolute(output)
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await process_frame
	if not game.diagnostic_offline:
		failures.append("game did not enter save-isolated diagnostic mode")
		quit(1)
		return
	game.adventure.travel("orchard_highlands")
	await process_frame
	var zone: Dictionary = game.scene.zones["orchard_highlands"]
	var view := SubViewport.new()
	view.size = Vector2i(1200, 750)
	view.world_3d = game.get_world_3d()
	view.msaa_3d = Viewport.MSAA_2X
	view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	root.add_child(view)
	var camera := Camera3D.new()
	camera.far = 250.0
	camera.fov = 62.0
	view.add_child(camera)
	camera.current = true
	var result := {"zone": "orchard_highlands", "save_isolated": true, "views": [], "failures": failures}
	for id in IDS:
		var selected := _nearby_instance(zone.root, id)
		if selected.is_empty():
			failures.append("no placed " + id)
			continue
		var point: Vector3 = selected.point
		camera.global_position = point + Vector3(2.4, 1.7, 3.2)
		camera.look_at(point + Vector3(0, 0.35, 0), Vector3.UP)
		for frame in 6: await process_frame
		await RenderingServer.frame_post_draw
		var image := view.get_texture().get_image()
		var path := output.path_join(id + ".png")
		if image.save_png(path) != OK: failures.append("capture failed: " + id)
		result.views.append({"id": id, "path": path, "placed": selected.total,
			"draw_calls": roundi(Performance.get_monitor(Performance.RENDER_TOTAL_DRAW_CALLS_IN_FRAME))})
	var file := FileAccess.open(output.path_join("result.json"), FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(result, "  "))
		file.close()
	print("ORCHARD_BANK_ART_REVIEW ", JSON.stringify({"views": result.views.size(), "failures": failures}))
	quit(0 if failures.is_empty() and result.views.size() == IDS.size() else 1)

func _nearby_instance(zone_root: Node3D, id: String) -> Dictionary:
	var closest := INF
	var chosen := Vector3.ZERO
	var total := 0
	for child in zone_root.get_children():
		if not child is MultiMeshInstance3D or not child.name.begins_with("Woodland_" + id + "_"): continue
		var holder := child as MultiMeshInstance3D
		var batch := holder.multimesh
		for i in range(batch.instance_count):
			var position := holder.to_global(batch.get_instance_transform(i).origin)
			var distance := position.distance_squared_to(zone_root.to_global(Vector3(0, 0, 0)))
			if distance < closest:
				closest = distance
				chosen = position
			total += 1
	return {} if total == 0 else {"point": chosen, "total": total}
