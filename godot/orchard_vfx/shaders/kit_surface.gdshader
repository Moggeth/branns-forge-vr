shader_type spatial;
// Shared by every spell-kit MultiMesh. Albedo = authored vertex colour (COLOR_0)
// x per-instance tint (INSTANCE_CUSTOM.rgb). INSTANCE_CUSTOM.a = fresh-earth
// darkening (1 = just exposed, damp; 0 = weathered).
render_mode cull_back, diffuse_lambert_wrap, specular_disabled;

uniform float vertex_gamma = 1.0;      // set 2.2 if the importer hands us sRGB bytes as linear
uniform float cavity_strength = 0.4;   // cheap ambient-occlusion from facet orientation
uniform vec3 sun_side_warm = vec3(1.04, 1.0, 0.94);

varying vec4 v_tint;
varying float v_up;

void vertex() {
	v_tint = INSTANCE_CUSTOM;
	v_up = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz).y;
}

void fragment() {
	vec3 base = pow(COLOR.rgb, vec3(vertex_gamma)) * v_tint.rgb;
	float cavity = mix(1.0 - cavity_strength, 1.0, smoothstep(-0.7, 0.55, v_up));
	float damp = mix(1.0, 0.72, v_tint.a * (1.0 - smoothstep(0.55, 0.9, v_up)));
	ALBEDO = base * cavity * damp * mix(vec3(1.0), sun_side_warm, smoothstep(0.2, 0.9, v_up));
	ROUGHNESS = mix(0.95, 0.78, v_tint.a);
}
