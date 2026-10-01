shader_type spatial;
// Pearly orchard water. Opaque on purpose: no alpha sorting, no depth/screen texture reads.
// Optional mesh contract: COLOR.r = shore proximity (1 at bank, 0 mid-channel); missing/0 is fine.
// Planet-fixed: patterns use local XYZ, flow runs along the local tangent plane (never world Y).
render_mode diffuse_burley, specular_schlick_ggx, cull_back;

uniform sampler2D ripple_normal : filter_linear_mipmap, repeat_enable;
uniform sampler2D ripple_noise : filter_linear_mipmap, repeat_enable;
uniform vec3 deep_col : source_color = vec3(0.10, 0.36, 0.42);
uniform vec3 shallow_col : source_color = vec3(0.36, 0.66, 0.62);
uniform vec3 pearl_col : source_color = vec3(0.95, 0.90, 0.97);
uniform vec3 magic_tint : source_color = vec3(0.55, 0.45, 1.0);
uniform float flow_speed = 0.06;
uniform float ripple_scale = 0.33;
uniform float ripple_strength = 0.55;
uniform float pearl_amount = 0.55;
uniform float magic_amount = 0.0;       // 0..1, raise near crystal/magical biomes
uniform float detail_fade_far = 90.0;

varying vec3 v_pos;
varying float v_shore;

void vertex() {
	v_pos = VERTEX;
	v_shore = COLOR.r;
}

void fragment() {
	vec3 up = normalize(v_pos);
	float dist = length(VERTEX);
	float lod = 1.0 - smoothstep(20.0, detail_fade_far, dist);
	vec3 flow_t = cross(up, vec3(0.0, 1.0, 0.0));
	flow_t = length(flow_t) < 0.05 ? vec3(1.0, 0.0, 0.0) : normalize(flow_t);
	vec3 w = pow(abs(up), vec3(4.0));
	w /= w.x + w.y + w.z;
	vec3 p1 = v_pos * ripple_scale + flow_t * TIME * flow_speed * 6.0;
	vec3 p2 = v_pos * ripple_scale * 1.9 - flow_t * TIME * flow_speed * 3.7 + 3.1;
	vec3 a = texture(ripple_normal, p1.zy).xyz * w.x + texture(ripple_normal, p1.xz).xyz * w.y + texture(ripple_normal, p1.xy).xyz * w.z;
	vec3 b = texture(ripple_normal, p2.zy).xyz * w.x + texture(ripple_normal, p2.xz).xyz * w.y + texture(ripple_normal, p2.xy).xyz * w.z;
	vec2 slope = ((a.xy + b.xy) - 1.0) * ripple_strength * lod;
	// Tangent-plane perturbation of the radial normal in object space.
	vec3 t1 = flow_t;
	vec3 t2 = cross(up, t1);
	vec3 n_obj = normalize(up + t1 * slope.x + t2 * slope.y);
	NORMAL = normalize((VIEW_MATRIX * MODEL_MATRIX * vec4(n_obj, 0.0)).xyz);

	float swirl = texture(ripple_noise, p1.zy * 0.12).r * w.x + texture(ripple_noise, p1.xz * 0.12).r * w.y + texture(ripple_noise, p1.xy * 0.12).r * w.z;
	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 3.0);
	float shore = clamp(v_shore, 0.0, 1.0);
	vec3 col = mix(deep_col, shallow_col, clamp(0.35 + swirl * 0.5 + shore * 0.5, 0.0, 1.0));
	col = mix(col, pearl_col, clamp(pearl_amount * (0.18 + fres * 0.9 + shore * 0.35), 0.0, 1.0));
	col = mix(col, magic_tint, magic_amount * 0.45);
	ALBEDO = col;
	ROUGHNESS = mix(0.06, 0.22, shore);
	SPECULAR = 0.8;
	METALLIC = 0.0;
	EMISSION = magic_tint * magic_amount * (0.1 + 0.2 * swirl);
}
