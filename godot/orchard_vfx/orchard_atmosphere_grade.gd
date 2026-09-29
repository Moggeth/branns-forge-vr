extends RefCounted
## Orchard depth/form layer. Call IMMEDIATELY AFTER AtmospherePipeline.apply(env, sun, sky, hour, weather, quality)
## whenever that runs (it is idempotent; it only derives from what the pipeline just wrote plus hour/weather).
## Never sets a fixed daytime: every value is relative to the pipeline's own day/night/weather result.
##
## Why the Orchard read flat in captures:
##  * ambient = one flat COLOR at 0.43 vs sun 1.38 -> shaded slopes and lit slopes differ too little,
##    and there is no sky/ground split, so hills lose volume.
##  * noon sun at 54 deg elevation flattens the rolling meadow (few long shadows, low normal contrast).
##  * fog is uniform: near meadow, 150 m foothills and 400 m peaks separate only weakly.
## VR comfort: no bloom/flicker, no exposure animation, no screen-space effects (Mobile renderer).

static func apply_after(env: Environment, sun: DirectionalLight3D, hour: float, weather: String) -> void:
	if env == null: return
	var day := clampf(sin((hour - 6.0) / 24.0 * TAU) * 2.0, 0.0, 1.0)
	var cloud := 0.76 if weather == "rain" else (0.42 if weather == "snow" else 0.0)
	# 1. Sky-derived ambient: blue from above, ground bounce from below -> hills keep volume.
	#    Pipeline's ambient energy is kept, slightly reduced in clear daylight to let the sun model form.
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = lerpf(0.35, 0.65, day)
	env.ambient_light_energy *= lerpf(1.0, 0.85, day * (1.0 - cloud))
	# 2. Depth: stronger aerial perspective (distance takes the sky colour), modest distance density,
	#    valley height fog stays thin so near geometry is never hidden.
	env.fog_aerial_perspective = lerpf(0.32, 0.55, day)
	env.fog_density *= lerpf(1.0, 0.8, day * (1.0 - cloud))
	env.fog_sky_affect = 0.3
	# 3. Mild grade (static, comfortable): a touch of contrast so value separates the planes.
	env.adjustment_enabled = true
	env.adjustment_contrast = lerpf(1.02, 1.1, day)
	env.adjustment_saturation = lerpf(0.95, 1.05, day * (1.0 - cloud * 0.5))
	if sun == null: return
	# 4. Cap noon elevation at ~44 deg (pipeline uses up to 54) for longer shadows and slope modelling;
	#    morning/evening angles are untouched so the day cycle is unchanged.
	sun.rotation_degrees.x = maxf(sun.rotation_degrees.x, -44.0)
	sun.directional_shadow_blend_splits = true
	sun.shadow_normal_bias = 1.2
	# 5. Wet weather: slightly darker, cooler sun and a softer shadow edge (wetness itself is in the
	#    ground/river shaders via rain_wetness).
	if cloud > 0.0:
		sun.light_angular_distance = lerpf(0.55, 2.0, cloud)
