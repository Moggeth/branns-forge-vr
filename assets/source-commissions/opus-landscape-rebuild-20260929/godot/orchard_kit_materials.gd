extends RefCounted
## Shared opaque materials for the Orchard visual kit GLBs (output/glb/*.glb).
## The GLBs carry flat per-face COLOR_0; Godot 4.7's glTF importer does not enable
## vertex_color_use_as_albedo, so placement code must apply these as material_override
## (MeshInstance3D) or as the MultiMesh instance material. Two materials total for the whole kit
## keeps draw-call batching and the Mobile renderer's pipeline count minimal.
static var _rock: StandardMaterial3D
static var _foliage: StandardMaterial3D

static func rock() -> StandardMaterial3D:
	if _rock == null:
		_rock = StandardMaterial3D.new()
		_rock.resource_name = "OrchardRock_VC"
		_rock.vertex_color_use_as_albedo = true
		_rock.vertex_color_is_srgb = false  # Blender writes linear COLOR_0
		_rock.roughness = 0.88
		_rock.metallic_specular = 0.3
	return _rock

static func foliage() -> StandardMaterial3D:
	if _foliage == null:
		_foliage = StandardMaterial3D.new()
		_foliage.resource_name = "OrchardFoliage_VC"
		_foliage.vertex_color_use_as_albedo = true
		_foliage.vertex_color_is_srgb = false
		_foliage.roughness = 0.8
		_foliage.metallic_specular = 0.25
		_foliage.cull_mode = BaseMaterial3D.CULL_DISABLED  # single-sided reed/grass blades
		_foliage.backlight_enabled = true
		_foliage.backlight = Color(0.22, 0.28, 0.08)  # cheap sun-through-leaf glow, no SSS
	return _foliage

static func for_asset(name: String) -> StandardMaterial3D:
	return foliage() if name.begins_with("reed") or name.begins_with("grass") or name.begins_with("tree") else rock()

## Loads a kit GLB and returns its Mesh (for MultiMesh.mesh). Material must be set by caller
## via MultiMeshInstance3D.material_override = for_asset(name).
static func mesh(glb_path: String) -> Mesh:
	var scene: PackedScene = load(glb_path)
	var root := scene.instantiate()
	var mi := root.find_children("*", "MeshInstance3D", true, false)[0] as MeshInstance3D
	var m := mi.mesh
	root.free()
	return m
