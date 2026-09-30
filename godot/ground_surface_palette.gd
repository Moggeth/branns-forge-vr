class_name GroundSurfacePalette
extends RefCounted
## Shared world-scale finish for the small, flat zone floors. The Orchard's
## heightfield keeps its own path/exposure/water shader and is never replaced.
const ROOT := "res://assets/ground-surface-kit/materials/"
const SHADER := preload("res://ground_surface_palette.gdshader")
const GRASS := "res://assets/forge_materials/grass.png"
const STONE := "res://assets/forge_materials/stone.png"
const SOIL := "res://assets/atmosphere/soil_albedo.png"
const MICRO := "res://assets/atmosphere/micro_normal.png"
const FAMILY := {
	"forge_yard": ["meadow", "loam", Color("bec8a3")],
	"sandstone_quarry": ["sand", "stone", Color("d2af89")],
	"enchanted_kitchen": ["stone", "loam", Color("c5b69d")],
	"pinewood_ruins": ["loam", "meadow", Color("929b78")],
	"mushroom_glade": ["loam", "meadow", Color("7f9a79")],
	"crystal_hollow": ["stone", "loam", Color("828198")],
	"sky_garden": ["meadow", "stone", Color("a5b99a")],
	"ember_foundry": ["ash", "stone", Color("777178")],
	"gloamfen": ["loam", "meadow", Color("788b83")],
	"starfall_ridge": ["stone", "ash", Color("8990a6")],
	"cloudbreak_keep": ["snow", "stone", Color("bdc9c8")],
}
static var _materials: Dictionary = {}
static var _flat_orm: Texture2D
static var _wetness := 0.0
static var _snow := 0.0

static func _texture(path: String, fallback: String) -> Texture2D:
	var candidate := path if ResourceLoader.exists(path) else fallback
	return load(candidate) as Texture2D

static func _orm() -> Texture2D:
	if _flat_orm == null:
		var image := Image.create(1, 1, false, Image.FORMAT_RGBA8)
		image.fill(Color(1.0, 0.9, 0.0, 1.0))
		_flat_orm = ImageTexture.create_from_image(image)
	return _flat_orm

static func material(zone_id: String) -> ShaderMaterial:
	if _materials.has(zone_id): return _materials[zone_id]
	if not FAMILY.has(zone_id): return null
	var profile: Array = FAMILY[zone_id]
	var main: String = profile[0]
	var accent: String = profile[1]
	var finish := ShaderMaterial.new()
	finish.shader = SHADER
	finish.set_shader_parameter("base_albedo", _texture(ROOT + main + "_albedo.png", GRASS if main in ["meadow", "snow"] else SOIL if main in ["loam", "ash"] else STONE))
	finish.set_shader_parameter("accent_albedo", _texture(ROOT + accent + "_albedo.png", GRASS if accent == "meadow" else SOIL if accent == "loam" else STONE))
	finish.set_shader_parameter("base_normal", _texture(ROOT + main + "_normal.png", MICRO))
	finish.set_shader_parameter("base_orm", _texture(ROOT + main + "_orm.png", "") if ResourceLoader.exists(ROOT + main + "_orm.png") else _orm())
	finish.set_shader_parameter("accent_orm", _texture(ROOT + accent + "_orm.png", "") if ResourceLoader.exists(ROOT + accent + "_orm.png") else _orm())
	finish.set_shader_parameter("tint", profile[2])
	finish.set_shader_parameter("tile_per_m", 0.58 if main in ["meadow", "loam", "snow"] else 0.72)
	finish.set_shader_parameter("accent_amount", 0.28 if main in ["meadow", "loam"] else 0.20)
	finish.set_shader_parameter("normal_strength", 0.48 if main in ["meadow", "snow"] else 0.65)
	finish.set_shader_parameter("rain_wetness", _wetness)
	finish.set_shader_parameter("snow_cover", _snow)
	_materials[zone_id] = finish
	return finish

static func weather(wet: float, snow: float) -> void:
	_wetness = clampf(wet,0.0,1.0)
	_snow = clampf(snow,0.0,1.0)
	for finish in _materials.values():
		finish.set_shader_parameter("rain_wetness",_wetness)
		finish.set_shader_parameter("snow_cover",_snow)

static func apply_floor(mesh: MeshInstance3D, zone_id: String) -> void:
	if mesh == null or not mesh.visible or zone_id == "orchard_highlands": return
	var finish := material(zone_id)
	if finish != null:
		mesh.material_override = finish
		mesh.set_meta("ground_surface_family", FAMILY[zone_id][0])
