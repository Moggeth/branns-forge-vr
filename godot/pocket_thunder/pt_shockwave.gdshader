shader_type spatial;
// Irregular fractured shock ring on the floor (PlaneMesh 2x2). Angular noise shatters the front,
// ragged spokes trail behind it, and a hot inner pool lights the blast centre briefly.
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, fog_disabled;

instance uniform float progress : hint_range(0.0, 1.0) = 0.0;
uniform vec4 hot_color : source_color = vec4(1.0, 0.6, 0.2, 1.0);
uniform vec4 cool_color : source_color = vec4(0.3, 0.95, 0.8, 1.0);
uniform float intensity = 1.0;

float hash(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float vnoise(float x) {
	float i = floor(x);
	float f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(hash(i), hash(i + 1.0), f);
}

void fragment() {
	vec2 p = UV * 2.0 - 1.0;
	float r = length(p);
	float a = atan(p.y, p.x) + 3.14159265;
	float front = 1.0 - pow(1.0 - progress, 3.0);
	float jag = vnoise(a * 4.2) * 0.55 + vnoise(a * 11.0 + 7.0) * 0.30 + vnoise(a * 29.0 + 3.0) * 0.15;
	float rad = mix(0.03, 0.96, front) * (0.80 + 0.28 * jag);
	float edge_w = mix(0.05, 0.016, front);
	float edge = exp(-pow((r - rad) / edge_w, 2.0));
	edge *= 0.45 + 0.55 * step(0.32, vnoise(a * 17.0 + 11.0)); // broken fracture edge
	float behind = clamp((rad - r) / 0.42, 0.0, 1.0);
	float spokes = step(0.62, vnoise(a * 9.0 + r * 5.0 * (1.0 + jag))) * (1.0 - behind) * step(r, rad) * step(0.1, r);
	float scuff = smoothstep(0.55, 1.0, vnoise(a * 41.0 + r * 30.0)) * (1.0 - behind) * step(r, rad);
	float pool = exp(-r * r / mix(0.03, 0.20, front)) * pow(1.0 - progress, 1.8);
	float fade = pow(1.0 - progress, 1.5) * smoothstep(0.0, 0.03, progress);
	vec3 col = mix(hot_color.rgb, cool_color.rgb, clamp(edge * 0.45 + spokes * 0.2, 0.0, 1.0));
	float lum = edge * 1.1 + spokes * 0.35 + scuff * 0.18;
	ALBEDO = col * intensity * min(1.4, lum) + hot_color.rgb * pool * 0.9;
	ALPHA = clamp(lum + pool * 0.75, 0.0, 1.0) * fade * step(r, 1.0);
}
