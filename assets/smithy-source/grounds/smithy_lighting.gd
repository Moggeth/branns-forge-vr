# Smithy hub lighting for Godot 4.x Mobile renderer. Attach to a Node3D; call apply() or let _ready do it.
# High-visibility warm daylight, soft sky, warm hearth contrast. No flicker above 0.5 Hz amplitude 8% (no strobe).
extends Node3D

@export var hearth_pos := Vector3(-3.1, 0.9, -4.4)
@export var lantern_positions: Array[Vector3] = [Vector3(-8.3, 2.6, -0.45), Vector3(-4.6, 2.6, -0.45), Vector3(4.6, 2.6, -0.45), Vector3(8.3, 2.6, -0.45)]
var _hearth: OmniLight3D
var _t := 0.0

func _ready() -> void:
	apply()

func apply() -> void:
	var env := Environment.new()
	var sky_mat := ProceduralSkyMaterial.new()
	sky_mat.sky_top_color = Color(0.38, 0.58, 0.88)
	sky_mat.sky_horizon_color = Color(0.78, 0.84, 0.90)
	sky_mat.ground_horizon_color = Color(0.62, 0.60, 0.52)
	sky_mat.ground_bottom_color = Color(0.30, 0.30, 0.24)
	sky_mat.sun_angle_max = 25.0
	var sky := Sky.new(); sky.sky_material = sky_mat
	env.background_mode = Environment.BG_SKY; env.sky = sky
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_energy = 0.75          # bright shade under the roof; VR needs readable interiors
	env.reflected_light_source = Environment.REFLECTION_SOURCE_SKY
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.glow_enabled = false                 # keep mobile cheap; emissive lanterns read without glow
	env.fog_enabled = false
	var we := WorldEnvironment.new(); we.environment = env; add_child(we)

	var sun := DirectionalLight3D.new()
	sun.light_color = Color(1.0, 0.93, 0.82)
	sun.light_energy = 1.25
	sun.rotation_degrees = Vector3(-48, -35, 0)   # from front-right, lights the open +Z forecourt and gable
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = 30.0
	sun.shadow_blur = 1.5
	add_child(sun)

	# Hearth: the single shadowless warm key inside the hall (mobile budget: 1 hearth + up to 4 lamps, all no shadow)
	_hearth = OmniLight3D.new()
	_hearth.light_color = Color(1.0, 0.56, 0.24)
	_hearth.light_energy = 2.2
	_hearth.omni_range = 6.0
	_hearth.omni_attenuation = 1.4
	_hearth.position = hearth_pos
	add_child(_hearth)
	for p in lantern_positions:
		var l := OmniLight3D.new()
		l.light_color = Color(1.0, 0.74, 0.42); l.light_energy = 0.6; l.omni_range = 3.0
		l.position = p; add_child(l)

func _process(delta: float) -> void:
	# slow, gentle breathing (0.3 Hz, ±6%) — never strobe
	_t += delta
	if _hearth:
		_hearth.light_energy = 2.2 * (1.0 + 0.06 * sin(_t * TAU * 0.3) * sin(_t * 1.7))
