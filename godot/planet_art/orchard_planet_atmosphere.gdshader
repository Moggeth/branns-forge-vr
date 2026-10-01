shader_type spatial;
// Thin limb-scattering shell. Additive + no depth write = no sorting problems; one cheap pass.
// Visible only from outside (back faces culled), so ground-level view is untouched.
// Use a sphere mesh of radius ~planet_radius + 10..16, outward winding.
render_mode unshaded, blend_add, cull_back, depth_draw_never, shadows_disabled, fog_disabled;

uniform vec3 sun_dir_world = vec3(0.5, 0.7, 0.4);   // direction TOWARD the sun, world space
uniform vec3 day_col : source_color = vec3(0.45, 0.72, 1.0);
uniform vec3 dusk_col : source_color = vec3(1.0, 0.55, 0.32);
uniform vec3 night_col : source_color = vec3(0.10, 0.12, 0.30);
uniform float rim_power = 3.2;
uniform float intensity = 0.8;

void fragment() {
	vec3 n = normalize(NORMAL);
	float ndv = clamp(dot(n, normalize(VIEW)), 0.0, 1.0);
	float rim = pow(1.0 - ndv, rim_power);
	rim *= smoothstep(0.0, 0.18, 1.0 - ndv);             // no veil across the planet disc
	vec3 nw = normalize((INV_VIEW_MATRIX * vec4(n, 0.0)).xyz);
	float sun = dot(nw, normalize(sun_dir_world));
	float day = smoothstep(-0.2, 0.55, sun);
	float dusk = 1.0 - smoothstep(0.0, 0.35, abs(sun + 0.02));
	vec3 col = mix(night_col, day_col, day);
	col = mix(col, dusk_col, dusk * 0.8);
	ALBEDO = col * rim * intensity * (0.12 + 0.88 * smoothstep(-0.45, 0.2, sun));
	ALPHA = 1.0;
}
