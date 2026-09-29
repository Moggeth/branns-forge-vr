shader_type spatial;
// Soft dissolving smoke puffs on low-poly spheres (no billboards). Instance colour rgb = tint, a = life remaining.
render_mode unshaded, blend_mix, cull_back, depth_draw_never, fog_disabled;

varying vec4 inst;
varying vec3 lp;

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

float vnoise(vec3 p) {
	vec3 i = floor(p);
	vec3 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y),
		f.z);
}

void vertex() {
	inst = COLOR;
	lp = VERTEX * 4.0 + vec3(inst.a * 3.0);
}

void fragment() {
	float n = vnoise(lp * 2.2) * 0.65 + vnoise(lp * 5.0) * 0.35;
	float edge = pow(abs(dot(normalize(NORMAL), normalize(VIEW))), 0.8);
	float a = clamp((inst.a * 1.6 - n) * 3.0, 0.0, 1.0) * edge;
	ALBEDO = inst.rgb;
	ALPHA = a * 0.42;
}
