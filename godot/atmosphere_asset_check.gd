extends SceneTree
## Checks the imported one-surface woodland kit before scattering it in VR.

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var ids := ["fern_sword", "fern_lady", "fern_bracken", "grass_tuft", "flower_clump", "branch_fallen_mossy", "rock_mossy_boulder", "rock_mossy_slab", "litter_leaf_cluster"]
	var failures: Array[String] = []
	for id in ids:
		var packed: PackedScene = load("res://assets/atmosphere/woodland/" + id + ".glb")
		if packed == null:
			failures.append(id + " missing")
			continue
		var art: Node = packed.instantiate()
		var parts := art.find_children("*", "MeshInstance3D", true, false)
		if parts.size() != 1:
			failures.append(id + " does not have one mesh")
			art.free()
			continue
		var mesh: Mesh = parts[0].mesh
		var finish: Material = mesh.surface_get_material(0)
		if mesh.get_surface_count() != 1 or finish == null:
			failures.append(id + " does not have one textured surface")
		var textures: Array[String] = []
		for property in finish.get_property_list():
			if "texture" in str(property.name) and finish.get(property.name) is Texture2D:
				textures.append(str(property.name))
		print("ATMOSPHERE_ASSET id=", id, " surfaces=", mesh.get_surface_count(), " material=", finish.get_class(), " textures=", textures)
		art.free()
	print("ATMOSPHERE_ASSET_RESULT ", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
