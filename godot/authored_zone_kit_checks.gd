extends SceneTree

const Kit = preload("res://authored_zone_kit.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var parent := Node3D.new()
	root.add_child(parent)
	var result: Dictionary = Kit.load_into(parent, "res://assets/orchard_kit/zone_kit_fixture.json")
	if result.has("error") or int(result.get("placements", 0)) != 2 or int(result.get("holders", 0)) < 1:
		failures.append("authored GLB placements did not load")
	else:
		var holder := parent.get_child(0) as MultiMeshInstance3D
		if holder == null or holder.multimesh.instance_count != 2:
			failures.append("placements were not batched")
		else:
			var poses: Array = holder.get_meta("zone_kit_poses", [])
			# Godot's headless renderer does not expose MultiMesh GPU transforms.
			# Check the retained source poses, then verify actual pixels graphically.
			if poses.size() != 2 or (poses[0] as Transform3D).origin.distance_to(Vector3(1,0,2)) > 0.01 or (poses[1] as Transform3D).origin.distance_to(Vector3(2,0,3)) > 0.01 or (poses[1] as Transform3D).basis.determinant() >= (poses[0] as Transform3D).basis.determinant():
				failures.append("zone-local placement or per-instance scale drifted")
	var invalid := Kit.emit(parent,{"schema":1,"assets":{"rock":"../elsewhere.glb"},"placements":[]},"res://assets/orchard_kit")
	if not invalid.has("error"): failures.append("asset escaped the zone-kit directory")
	for argument in OS.get_cmdline_user_args():
		if not argument.begins_with("--kit-capture="): continue
		root.size = Vector2i(960, 600)
		var camera := Camera3D.new()
		parent.add_child(camera)
		camera.global_position = Vector3(1.5, 2.1, 6.0)
		camera.look_at(Vector3(1.5, 0.2, 2.5))
		camera.current = true
		var sunlight := DirectionalLight3D.new()
		parent.add_child(sunlight)
		sunlight.rotation = Vector3(-0.9, -0.6, 0.0)
		await create_timer(0.3).timeout
		await RenderingServer.frame_post_draw
		var path := argument.trim_prefix("--kit-capture=")
		if root.get_texture().get_image().save_png(path) != OK: failures.append("graphical capture failed")
	print("AUTHORED_ZONE_KIT_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
