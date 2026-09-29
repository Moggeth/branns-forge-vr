// Brann's Forge VR - source-fed pools (replacement for POOL_SHADER in landscape_water.gd).
// Pools are built from 2 m quads, so the square edges must NOT be visible: tint is uniform and
// darker than the damp bank band the ground shader paints from macro_mask.b around them.
shader_type spatial;
render_mode cull_disabled, shadows_disabled, specular_schlick_ggx;
uniform vec3 deep_col : source_color = vec3(0.04, 0.14, 0.15);
uniform vec3 sky_col  : source_color = vec3(0.55, 0.70, 0.86);
varying vec2 world_xz;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
	vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
	           mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() { world_xz = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz; }
void fragment() {
	vec2 p = world_xz * 0.6 + vec2(TIME * 0.05, -TIME * 0.03);
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 4.0);
	ALBEDO = mix(deep_col, sky_col, fres * 0.55);
	ROUGHNESS = 0.1;
	SPECULAR = 0.55;
	NORMAL_MAP = normalize(vec3(noise2(p) - 0.5, noise2(p + 5.0) - 0.5, 2.0)) * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = 0.4;
}
