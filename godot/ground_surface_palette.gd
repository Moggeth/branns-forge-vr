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
	"pinewood_ruins": ["loam", "meadow", Color("e6dcc0")],
	"mushroom_glade": ["loam", "meadow", Color("c4d4c0")],
	"crystal_hollow": ["stone", "loam", Color("828198")],
	"sky_garden": ["meadow", "stone", Color("a5b99a")],
	"ember_foundry": ["ash", "stone", Color("777178")],
	"gloamfen": ["loam", "meadow", Color("b0c4bc")],
	"starfall_ridge": ["stone", "ash", Color("8990a6")],
	"cloudbreak_keep": ["snow", "stone", Color("bdc9c8")],
}
# Per-zone hue drift (rgb = tint multiplier of the 6-18 m patches, a = strength). Keeps each floor one coherent
# biome while giving it two readable colour regions: lawn/moss for greens, rust/ochre for quarry and foundry.
const DRIFT := {
	"forge_yard": Color(0.84, 1.00, 0.74, 0.30),
	"pinewood_ruins": Color(0.90, 1.00, 0.84, 0.30),
	"mushroom_glade": Color(0.80, 0.92, 1.00, 0.30),
	"sandstone_quarry": Color(1.10, 0.88, 0.68, 0.30),
	"sky_garden": Color(0.86, 1.06, 0.86, 0.30),
	"gloamfen": Color(0.78, 0.92, 0.90, 0.30),
	"ember_foundry": Color(1.18, 0.80, 0.66, 0.34),
	"enchanted_kitchen": Color(1.08, 0.92, 0.78, 0.26),
	"crystal_hollow": Color(0.82, 0.86, 1.12, 0.30),
	"starfall_ridge": Color(0.82, 0.90, 1.08, 0.26),
	"cloudbreak_keep": Color(0.90, 0.98, 1.06, 0.20),
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
	# Sonnet refinement: larger repeat (less carpet speckle), stronger accent transitions and per-family
	# contrast/hue drift ("contrast", "drift_amount" are new uniforms in ground_surface_palette.gdshader).
	# final grade: loam repeats every ~1.6 m (0.62/m; leaf fragments ~10-15 cm instead of banana-chip 30+ cm), normal 0.30 so the denser tile does not sparkle.
	# iter2 (superseded): loam repeats every ~4.2 m (was 2.5 m) and its albedo is a calmer, lighter revised map; contrast is a
	# gentle luminance-only 1.08 so dark families are never crushed.
	finish.set_shader_parameter("tile_per_m", 0.62 if main == "loam" else 0.40 if main in ["meadow", "snow"] else 0.52)
	finish.set_shader_parameter("accent_amount", 0.34 if main == "loam" else 0.42 if main == "meadow" else 0.30)
	finish.set_shader_parameter("contrast", 1.08 if main in ["meadow", "loam", "stone", "sand"] else 1.04)
	finish.set_shader_parameter("drift_amount", DRIFT.get(zone_id, Color(0.0, 0.0, 0.0, 0.0)))
	finish.set_shader_parameter("normal_strength", 0.48 if main in ["meadow", "snow"] else 0.30 if main == "loam" else 0.65)
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
