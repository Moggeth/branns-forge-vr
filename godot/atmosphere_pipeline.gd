extends RefCounted
## Single Orchard daylight/weather palette. Mobile-renderer fog and one tightly
## budgeted shadowed sun are cheaper and more stable in stereo than SDFGI.
static func apply(env: Environment, sun: DirectionalLight3D, sky: ProceduralSkyMaterial, hour: float, weather: String, quality: int = 1) -> void:
	var day := clampf(sin((hour - 6.0) / 24.0 * TAU) * 2.0, 0.0, 1.0)
	var low_sun := clampf(1.0 - absf(hour - 17.5) / 4.0, 0.0, 1.0) * day
	var cloud := 0.76 if weather == "rain" else (0.42 if weather == "snow" else 0.0)
	sky.sky_top_color = Color("101d39").lerp(Color("3c86bc"), day * (1.0 - cloud * 0.32))
	sky.sky_horizon_color = Color("263d58").lerp(Color("bbd2d8"), day)
	sky.sky_horizon_color = sky.sky_horizon_color.lerp(Color("e2b783"), low_sun * (1.0 - cloud))
	sky.ground_horizon_color = sky.sky_horizon_color
	sun.rotation_degrees = Vector3(-maxf(9.0, day * 54.0 - low_sun * 23.0), -42.0 + (hour - 12.0) * 5.0, 0.0)
	sun.light_color = Color("94acd5").lerp(Color("fff0c9"), day).lerp(Color("ffd39a"), low_sun * 0.75)
	sun.light_energy = lerpf(0.075, 1.38, day) * (1.0 - cloud * 0.43)
	sun.shadow_enabled = true
	sun.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL if quality == 0 else DirectionalLight3D.SHADOW_PARALLEL_2_SPLITS
	sun.directional_shadow_max_distance = [28.0, 44.0, 56.0][clampi(quality, 0, 2)]
	sun.directional_shadow_fade_start = 0.72
	sun.light_angular_distance = 0.55
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color("849bbc").lerp(Color("c7d7ce"), day).lerp(Color("8ba8ad"), cloud * 0.32)
	env.ambient_light_energy = lerpf(0.20, 0.43, day)
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.fog_enabled = true
	env.fog_light_color = sky.sky_horizon_color.lerp(Color("9fb6b9"), cloud * 0.4)
	env.fog_density = 0.0036 + cloud * 0.0034
	env.fog_height = 0.05
	env.fog_height_density = 0.020 + cloud * 0.034
	env.fog_aerial_perspective = 0.32
	env.fog_sky_affect = 0.22
	env.fog_sun_scatter = (0.28 + low_sun * 0.15) * (1.0 - cloud * 0.45)
