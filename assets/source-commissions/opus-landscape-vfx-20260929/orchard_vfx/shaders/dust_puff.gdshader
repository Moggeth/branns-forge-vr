shader_type spatial;
// Camera-facing soil dust. One draw per event (MultiMesh). INSTANCE_CUSTOM = rgb, opacity.
// Opaque-ish core with a lumpy, soft rim; unshaded but self-shaded top/bottom so it
// keeps volume in flat sky light. Participates in fog so distant dust sits in haze.
render_mode unshaded, blend_mix, depth_draw_never, cull_disabled, shadows_disabled;

varying vec4 v_puff;
varying float v_seed;

void vertex() {
	v_puff = INSTANCE_CUSTOM;
	v_seed = float(INSTANCE_ID) * 1.618;
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0),
		vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, length(MODEL_MATRIX[2].xyz), 0.0), vec4(0.0, 0.0, 0.0, 1.0));
}

void fragment() {
	vec2 d = UV * 2.0 - 1.0;
	float ang = atan(d.y, d.x);
	float lump = sin(ang * 5.0 + v_seed) * 0.07 + sin(ang * 9.0 - v_seed * 2.0) * 0.04;
	float r = length(d) + lump;
	float body = smoothstep(1.0, 0.25, r);
	float shade = mix(0.72, 1.12, clamp(0.5 - d.y * 0.6, 0.0, 1.0));
	ALBEDO = v_puff.rgb * shade;
	ALPHA = body * v_puff.a;
}
