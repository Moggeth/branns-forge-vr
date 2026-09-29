extends SceneTree

const ASSETS := [
	"geo_boulder_mossy_a", "geo_boulder_split_b", "geo_slab_streamside_c",
	"geo_outcrop_bank_straight", "geo_outcrop_ridge_tall",
	"geo_earth_rupture_roots", "geo_spell_spire"]
const Art = preload("res://landscape_asset_library.gd")

func _initialize() -> void:
	var failures: Array[String] = []
	var triangles := 0
	for name in ASSETS:
		var path := "res://assets/landscape/%s.glb" % name
		var mesh: ArrayMesh = Art.tuned_mesh(path)
		if mesh == null: failures.append("missing mesh in " + name); continue
		for surface in mesh.get_surface_count():
			triangles += mesh.surface_get_array_index_len(surface) / 3
			var material: Material = mesh.surface_get_material(surface)
			if material is StandardMaterial3D and not material.vertex_color_use_as_albedo:
				failures.append("vertex colours disabled in " + name)
	print("LANDSCAPE_ASSET_RESULT failures=", failures, " assets=", ASSETS.size(), " triangles=", triangles)
	quit(0 if failures.is_empty() else 1)
