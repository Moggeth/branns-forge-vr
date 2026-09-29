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
varying vec3 v_world;

float hash31(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float noise3(vec3 p) {
	vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x), mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
	           mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x), mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
}

void vertex() {
	v_tint = INSTANCE_CUSTOM;
	v_up = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz).y;
	v_world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec3 base = pow(COLOR.rgb, vec3(vertex_gamma)) * v_tint.rgb;
	float cavity = mix(1.0 - cavity_strength, 1.0, smoothstep(-0.7, 0.55, v_up));
	float damp = mix(1.0, 0.72, v_tint.a * (1.0 - smoothstep(0.55, 0.9, v_up)));
	// live-revision: world-space grain inside each flat facet (soil crumbs / rock grain), no textures
	float grain = noise3(v_world * 9.0) * 0.6 + noise3(v_world * 2.5) * 0.4;
	ALBEDO = base * cavity * damp * mix(vec3(1.0), sun_side_warm, smoothstep(0.2, 0.9, v_up)) * mix(0.84, 1.12, grain);
	ROUGHNESS = mix(0.95, 0.72, v_tint.a) - grain * 0.06;
}
