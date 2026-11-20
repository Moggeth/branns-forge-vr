// Spatial billboard smoke puff (Godot 4.x, mobile-safe). One quad per particle.
// Engineering animates bounded instanced particles; INSTANCE_CUSTOM.y = normalized age 0..1.
shader_type spatial;
render_mode blend_mix, unshaded, depth_draw_never, cull_disabled, shadows_disabled;

uniform vec4 source_gray : source_color = vec4(0.42, 0.40, 0.39, 1.0);
uniform vec4 sky_blue : source_color = vec4(0.62, 0.74, 0.90, 1.0);
uniform float max_alpha : hint_range(0.0, 1.0) = 0.55;
uniform float swirl_speed = 0.12;

varying float age;
varying float seed;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
	vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void vertex() {
	age = clamp(INSTANCE_CUSTOM.y, 0.0, 1.0);
	seed = INSTANCE_CUSTOM.x * 17.0;
	// camera-facing billboard keeping instance scale
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0, 0, 0), vec4(0, length(MODEL_MATRIX[1].xyz), 0, 0), vec4(0, 0, 1, 0), vec4(0, 0, 0, 1));
}

void fragment() {
	vec2 c = UV - 0.5;
	vec2 p = UV * 3.0 + vec2(seed, TIME * swirl_speed + age * 1.5);
	float n = vnoise(p) * 0.6 + vnoise(p * 2.3 + 4.1) * 0.3 + vnoise(p * 5.1) * 0.1;
	float puff = (1.0 - smoothstep(0.12, 0.5, length(c) + (n - 0.5) * 0.35));
	float fade = smoothstep(0.0, 0.12, age) * (1.0 - smoothstep(0.55, 1.0, age)); // no popping, no strobe
	ALBEDO = mix(source_gray.rgb, sky_blue.rgb, smoothstep(0.1, 0.9, age)) * (0.9 + 0.2 * n);
	ALPHA = puff * fade * max_alpha;
}
