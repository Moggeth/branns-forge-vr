extends SceneTree

# Runs only in a disposable Godot project. Reports what the engine actually imported.
func _initialize() -> void:
	call_deferred("_run_check")

func _run_check() -> void:
	var row := {"meshes": 0, "material_slots": 0, "animations": [], "node_names": [],
		"bounds_min": [], "bounds_max": [], "errors": []}
	var resource := load("res://model.glb")
	if not resource is PackedScene:
		row["errors"].append("model.glb did not import as PackedScene")
	else:
		var instance: Node = resource.instantiate()
		get_root().add_child(instance)
		var found_bounds := false
		var bounds := AABB()
		var pending: Array[Node] = [instance]
		while not pending.is_empty():
			var node: Node = pending.pop_back()
			row["node_names"].append(node.name)
			for child in node.get_children():
				pending.append(child)
			if node is MeshInstance3D:
				var mesh_node: MeshInstance3D = node
				if mesh_node.mesh == null:
					continue
				row["meshes"] += 1
				var box: AABB = mesh_node.global_transform * mesh_node.mesh.get_aabb()
				bounds = bounds.merge(box) if found_bounds else box
				found_bounds = true
				for surface in range(mesh_node.mesh.get_surface_count()):
					if mesh_node.mesh.surface_get_material(surface) != null:
						row["material_slots"] += 1
			if node is AnimationPlayer:
				for clip in (node as AnimationPlayer).get_animation_list():
					row["animations"].append(clip)
		if not found_bounds:
			row["errors"].append("imported scene has no visible mesh")
		else:
			row["bounds_min"] = [bounds.position.x, bounds.position.y, bounds.position.z]
			var far := bounds.end
			row["bounds_max"] = [far.x, far.y, far.z]
		instance.queue_free()
	print("ASSET_LAB_IMPORT_RESULT ", JSON.stringify(row))
	quit(0 if row["errors"].is_empty() else 1)
