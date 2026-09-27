class_name ForgeMaterials
extends RefCounted

## Forge-yard-only material accents. Generated colour maps preserve the original
## simple silhouettes; physics and world batching stay unchanged.
const SOURCES={"grass":"res://assets/forge_materials/grass.png", "timber":"res://assets/forge_materials/timber.png", "stone":"res://assets/forge_materials/stone.png", "iron":"res://assets/forge_materials/iron.png"}
static var textures:Dictionary={}
static var materials:Dictionary={}

static func texture(kind:String)->Texture2D:
	if textures.has(kind): return textures[kind]
	var started=Time.get_ticks_usec()
	# ResourceLoader follows Godot's texture remap in exported PCKs. Image.load
	# remains a source-tree fallback for direct, editorless diagnostic runs.
	var imported=ResourceLoader.load(SOURCES[kind]) as Texture2D if ResourceLoader.exists(SOURCES[kind]) else null
	if imported!=null:
		textures[kind]=imported
	else:
		var image=Image.new()
		if image.load(SOURCES[kind])!=OK: return null
		image.generate_mipmaps()
		textures[kind]=ImageTexture.create_from_image(image)
	print("FORGE_MATERIAL loaded=",kind," route=", "imported" if imported!=null else "source", " size=",textures[kind].get_width(),"x",textures[kind].get_height()," ms=",snappedf((Time.get_ticks_usec()-started)/1000.0,0.1))
	return textures[kind]

static func material(kind:String,tint:String="ffffff")->StandardMaterial3D:
	var key=kind+":"+tint
	if materials.has(key): return materials[key]
	var m=StandardMaterial3D.new()
	m.albedo_color=Color(tint)
	m.albedo_texture=texture(kind)
	m.uv1_triplanar=true
	m.uv1_world_triplanar=true
	m.uv1_scale=Vector3.ONE*(0.48 if kind=="grass" else (0.8 if kind=="stone" else 1.7))
	m.texture_filter=BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
	m.roughness=0.95 if kind in ["grass","stone"] else (0.86 if kind=="timber" else 0.42)
	m.metallic=0.72 if kind=="iron" else 0.0
	materials[key]=m
	return m

static func dress(mesh:MeshInstance3D,kind:String,tint:String="ffffff")->MeshInstance3D:
	mesh.material_override=material(kind,tint)
	return mesh
