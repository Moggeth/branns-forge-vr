shader_type spatial;
// Additive, unlit, depth-tested geometry skin for crack / dust-ring / root-growth presentation.
// Order independent (blend_add), no depth write -> no sorting failures. Mesh is built on the real surface.
// Disc mode (mode 0): UV = (angle 0..1, radius 0..1). Root mode (mode 1): UV = (along 0..1, across 0..1).
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, shadows_disabled, fog_disabled;

uniform sampler2D crack_noise : filter_linear_mipmap, repeat_enable;
instance uniform float progress = 0.0;
instance uniform float mode = 0.0;
instance uniform float seed = 0.0;
instance uniform vec4 tint : source_color = vec4(0.72, 0.45, 1.0, 1.0);

void fragment() {
	float p = clamp(progress, 0.0, 1.0);
	float life = 1.0 - smoothstep(0.62, 1.0, p);
	vec3 col = vec3(0.0);
	float a = 0.0;
	if (mode < 0.5) {
		float r = UV.y;
		float front = clamp(p * 1.35, 0.0, 1.0);
		float crack = texture(crack_noise, vec2(UV.x * 3.0 + seed, r * 1.7 + seed * 0.37)).g;
		crack = smoothstep(0.38, 0.92, crack);
		float inside = smoothstep(front, front - 0.22, r);
		float tip = exp(-pow((r - front) * 14.0, 2.0)) * (1.0 - smoothstep(0.85, 1.0, p));
		float edge = 1.0 - smoothstep(0.82, 1.0, r);
		float heat = 1.0 - smoothstep(0.0, 0.8, p - r * 0.35);
		a = (crack * inside * (0.35 + 0.65 * heat) + tip * 0.55) * edge * life;
		col = mix(tint.rgb, vec3(1.0, 0.9, 0.7), crack * heat * 0.45 + tip * 0.3);
	} else {
		float along = UV.x;
		float across = abs(UV.y * 2.0 - 1.0);
		float reach = p * 1.2;
		float grown = smoothstep(reach, reach - 0.1, along);
		float core = smoothstep(1.0, 0.15, across);
		float pulse = 0.55 + 0.45 * sin(along * 20.0 - TIME * 3.0 + seed * 6.0);
		float tip = exp(-pow((along - reach) * 18.0, 2.0));
		a = grown * core * (0.55 * pulse + tip) * life;
		col = mix(tint.rgb, vec3(1.0, 0.95, 0.75), tip * 0.5);
	}
	ALBEDO = col * a * tint.a;
	ALPHA = 1.0;
}
