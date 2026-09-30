shader_type spatial;
render_mode cull_back, diffuse_lambert, specular_schlick_ggx;

uniform sampler2D base_albedo : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D accent_albedo : source_color, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D base_normal : hint_normal, repeat_enable, filter_linear_mipmap_anisotropic;
uniform sampler2D base_orm : repeat_enable, filter_linear_mipmap;
uniform sampler2D accent_orm : repeat_enable, filter_linear_mipmap;
uniform vec3 tint : source_color = vec3(1.0);
uniform float tile_per_m = 0.58;
uniform float accent_amount = 0.28;
uniform float normal_strength = 0.55;
uniform float rain_wetness = 0.0;
uniform float snow_cover = 0.0;
varying vec3 world_at;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float smooth_noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
	           mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() { world_at = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz; }
void fragment() {
	vec2 at = world_at.xz;
	float broad = smooth_noise(at * 0.038 + 4.7);
	float middle = smooth_noise(at * 0.16 - 7.2);
	vec2 warp = vec2(smooth_noise(at * 0.11), smooth_noise(at * 0.11 + 17.0)) * 0.38;
	vec2 uv = (at + warp) * tile_per_m;
	vec2 uv_alt = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8)) * uv * 0.71 + 13.7;
	float blend = smoothstep(0.47, 0.76, broad * 0.68 + middle * 0.32) * accent_amount;
	vec3 first = texture(base_albedo, uv).rgb;
	vec3 second = texture(accent_albedo, uv_alt).rgb;
	vec3 colour = mix(first, second, blend);
	colour *= tint * mix(0.89, 1.08, broad) * mix(0.96, 1.04, middle);
	float wet = rain_wetness * (0.7 + broad * 0.3);
	float snow = snow_cover * smoothstep(0.25, 0.68, broad * 0.45 + middle * 0.25 + snow_cover * 0.5);
	colour *= 1.0 - wet * 0.19;
	ALBEDO = mix(colour, vec3(0.86, 0.90, 0.91) * mix(0.92, 1.03, middle), snow);
	float rough_a = texture(base_orm, uv).g;
	float rough_b = texture(accent_orm, uv_alt).g;
	ROUGHNESS = mix(clamp(mix(rough_a, rough_b, blend), 0.48, 1.0), 0.54, wet * 0.8);
	ROUGHNESS = mix(ROUGHNESS, 0.86, snow);
	SPECULAR = mix(0.34, 0.50, wet) * (1.0 - snow * 0.3);
	NORMAL_MAP = texture(base_normal, uv).rgb;
	NORMAL_MAP_DEPTH = mix(normal_strength, 0.10, snow);
}
