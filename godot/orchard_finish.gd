class_name OrchardFinish
## Runtime equivalent of orchard_post_import.gd for GLBs loaded without the import script.
## Call once per instantiated scene (or on the Mesh before building a MultiMesh).
static func apply_tree(root: Node) -> void:
	for m in root.find_children("*", "MeshInstance3D", true, false):
		apply_mesh((m as MeshInstance3D).mesh)
	if root is MeshInstance3D: apply_mesh(root.mesh)

static func apply_mesh(mesh: Mesh) -> void:
	if mesh == null: return
	for s in mesh.get_surface_count():
		var mat := mesh.surface_get_material(s) as BaseMaterial3D
		if mat == null: continue
		mat.vertex_color_use_as_albedo = true
		mat.albedo_color = Color.WHITE
		mat.metallic = 0.0
		mat.cull_mode = BaseMaterial3D.CULL_DISABLED if mat.resource_name == "orchard_blossom" else BaseMaterial3D.CULL_BACK
