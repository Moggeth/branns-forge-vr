shader_type spatial;
// Additive unshaded glow for sparks, embers and the core pop. MultiMesh instance colour drives colour+alpha.
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, fog_disabled;

instance uniform vec4 tint : source_color = vec4(1.0);
varying vec4 inst;

void vertex() {
	inst = COLOR;
}

void fragment() {
	float rim = pow(abs(dot(normalize(NORMAL), normalize(VIEW))), 0.7);
	ALBEDO = inst.rgb * tint.rgb * (0.65 + 0.6 * rim);
	ALPHA = clamp(inst.a * tint.a, 0.0, 1.0);
}
