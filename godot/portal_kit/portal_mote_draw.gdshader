shader_type spatial;
// Soft round billboard for portal motes and the exit-release burst. Additive, unshaded, no depth write.
render_mode blend_add, unshaded, depth_draw_never, cull_disabled, fog_disabled, particle_trails_disabled;

uniform float mote_size = 0.05;

void vertex() {
	// camera-facing quad, scaled by the per-particle transform scale
	vec3 sc = vec3(length(MODEL_MATRIX[0].xyz), length(MODEL_MATRIX[1].xyz), length(MODEL_MATRIX[2].xyz));
	MODELVIEW_MATRIX = VIEW_MATRIX * mat4(INV_VIEW_MATRIX[0], INV_VIEW_MATRIX[1], INV_VIEW_MATRIX[2], MODEL_MATRIX[3]);
	MODELVIEW_MATRIX = MODELVIEW_MATRIX * mat4(vec4(sc.x, 0, 0, 0), vec4(0, sc.y, 0, 0), vec4(0, 0, sc.z, 0), vec4(0, 0, 0, 1));
	VERTEX *= mote_size * 2.0;
}

void fragment() {
	float d = length(UV - vec2(0.5)) * 2.0;
	float soft = pow(clamp(1.0 - d, 0.0, 1.0), 1.8);
	ALBEDO = COLOR.rgb;
	ALPHA = soft * COLOR.a;
}
