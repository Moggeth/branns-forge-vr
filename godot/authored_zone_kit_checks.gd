extends SceneTree

const Kit = preload("res://authored_zone_kit.gd")
const HardContact = preload("res://hard_surface_contact.gd")
const WorldZones = preload("res://world_zones.gd")
const WorkshopScene = preload("res://workshop_scene.gd")

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
			if holder.visibility_range_end < 220.0:
				failures.append("authored kit disappears at full strategic zoom")
			var poses: Array = holder.get_meta("zone_kit_poses", [])
			# Godot's headless renderer does not expose MultiMesh GPU transforms.
			# Check the retained source poses, then verify actual pixels graphically.
			if poses.size() != 2 or (poses[0] as Transform3D).origin.distance_to(Vector3(1,0,2)) > 0.01 or (poses[1] as Transform3D).origin.distance_to(Vector3(2,0,3)) > 0.01 or (poses[1] as Transform3D).basis.determinant() >= (poses[0] as Transform3D).basis.determinant():
				failures.append("zone-local placement or per-instance scale drifted")
	var invalid := Kit.emit(parent,{"schema":1,"assets":{"rock":"../elsewhere.glb"},"placements":[]},"res://assets/orchard_kit")
	if not invalid.has("error"): failures.append("asset escaped the zone-kit directory")
	var collision_doc: Dictionary = JSON.parse_string(FileAccess.get_file_as_string("res://assets/orchard_kit/zone_kit_fixture.json"))
	collision_doc["asset_meta"] = {"rock":{"collision":{"shape":"box","size":[0.8,1.0,0.8],"offset":[0.0,0.5,0.0]},"surface_material":"wood"}}
	collision_doc.placements[0]["scale"] = [1.2, 0.6, 1.1]
	collision_doc.placements[0]["surface_material"] = "metal"
	for placement in collision_doc.placements: placement["collision"] = "asset_default"
	var collision_root := Node3D.new()
	root.add_child(collision_root)
	var collision_result: Dictionary = Kit.emit(collision_root, collision_doc, "res://assets/orchard_kit")
	var solids: Array = []
	for child in collision_root.get_children():
		if child is StaticBody3D: solids.append(child)
	if int(collision_result.get("colliders", 0)) != 2 or solids.size() != 2:
		failures.append("opt-in authored colliders did not match placements")
	else:
		if HardContact.material_for(solids[0]) != "metal" or HardContact.material_for(solids[1]) != "wood":
			failures.append("placement and asset material overrides lost precedence")
		var first_shape := solids[0].get_child(0) as CollisionShape3D
		if first_shape == null or first_shape.shape == null or not is_equal_approx(first_shape.position.y, 0.3) or (first_shape.shape as BoxShape3D).size.distance_to(Vector3(0.96, 0.6, 0.88)) > 0.01:
			failures.append("authored collision shape lost its size or offset")
	if Kit._surface_from_asset_name("fallen_log") != "wood" or Kit._surface_from_asset_name("tree_cloud_a") != "wood" or Kit._surface_from_asset_name("boulder_mossy_a") != "stone" or Kit._surface_from_asset_name("cordwood_ore_rack") != "":
		failures.append("asset-name surface fallback is ambiguous")
	var fixture_body := WorldZones.body(parent, Vector3.ZERO, Vector3.ONE, "solid", "wood")
	var anvil_body := WorkshopScene.collision(parent, Vector3.ZERO, Vector3.ONE, "metal")
	if HardContact.material_for(fixture_body) != "wood" or HardContact.material_for(anvil_body) != "metal":
		failures.append("common static-proxy surface metadata missing")
	var scaled_holder := collision_root.get_child(0) as MultiMeshInstance3D
	if scaled_holder == null:
		failures.append("nonuniform authored placement missing")
	else:
		var scaled_poses: Array = scaled_holder.get_meta("zone_kit_poses", [])
		if scaled_poses.is_empty() or not is_equal_approx((scaled_poses[0] as Transform3D).basis.x.length(), 1.2) or not is_equal_approx((scaled_poses[0] as Transform3D).basis.y.length(), 0.6):
			failures.append("nonuniform authored placement scale drifted: " + str((scaled_poses[0] as Transform3D).basis.get_scale() if not scaled_poses.is_empty() else Vector3.ZERO))
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
