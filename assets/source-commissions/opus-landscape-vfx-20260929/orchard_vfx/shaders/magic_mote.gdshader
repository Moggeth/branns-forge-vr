shader_type spatial;
// Additive magical motes / embers. INSTANCE_CUSTOM = rgb (HDR allowed), intensity.
render_mode unshaded, blend_add, depth_draw_never, cull_disabled, shadows_disabled, fog_disabled;

varying vec4 v_mote;

void vertex() {
	v_mote = INSTANCE_CUSTOM;
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(length(MODEL_MATRIX[0].xyz), 0.0, 0.0, 0.0),
		vec4(0.0, length(MODEL_MATRIX[1].xyz), 0.0, 0.0), vec4(0.0, 0.0, 1.0, 0.0), vec4(0.0, 0.0, 0.0, 1.0));
}

void fragment() {
	float r = length(UV * 2.0 - 1.0);
	float core = smoothstep(0.35, 0.0, r);
	float halo = smoothstep(1.0, 0.2, r) * 0.35;
	ALBEDO = v_mote.rgb * (core * 2.0 + halo) * v_mote.a;
}
