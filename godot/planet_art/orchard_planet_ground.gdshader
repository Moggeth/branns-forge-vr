shader_type spatial;
// Orchard planet ground. Everything is keyed to LOCAL mesh position / radial normal so patterns are
// fixed to the planet and continuous across cube-face seams. World Y is never used.
// Mesh COLOR = (fertile, mountain, arid, enchanted) biome weights; UV is ignored.
// Chunks use Godot's clockwise exterior winding, shared by rendering and collision.
render_mode diffuse_burley, specular_schlick_ggx, cull_back;

uniform sampler2D detail_noise : filter_linear_mipmap, repeat_enable;   // R macro, G cracks, B grain, A strata
uniform sampler2D detail_normal : filter_linear_mipmap, repeat_enable;  // RGB normal, A height
uniform sampler2D sparkle_tex : filter_linear_mipmap, repeat_enable;
uniform float planet_radius = 85.0;
uniform float macro_scale = 0.026;      // cycles per metre (~38 m)
uniform float mid_scale = 0.17;         // ~6 m
uniform float micro_scale = 0.62;       // ~1.6 m for normal/height
uniform float normal_strength = 0.85;
uniform float detail_fade_near = 14.0;  // micro detail fully on inside this view distance
uniform float detail_fade_far = 70.0;   // gone beyond (globe view keeps macro colour only)
uniform float facet_smoothing = 0.62;   // 0 = raw facets, 1 = pure radial normal (used when mesh normals are radial)
uniform float rock_slope_start = 0.16;  // 1 - dot(n, up): where rock begins to show
uniform float rock_slope_full = 0.42;
uniform float frost_latitude = 0.70;    // |local y| where frost starts creeping in
uniform float frost_height = 3.2;
uniform float magic_glow = 0.55;
uniform float magic_pulse_speed = 0.35;

uniform vec3 grass_warm : source_color = vec3(0.43, 0.50, 0.17);
uniform vec3 grass_cool : source_color = vec3(0.20, 0.38, 0.17);
uniform vec3 grass_dry : source_color = vec3(0.66, 0.58, 0.25);
uniform vec3 soil_col : source_color = vec3(0.34, 0.21, 0.12);
uniform vec3 moss_col : source_color = vec3(0.27, 0.36, 0.15);
uniform vec3 rock_dark : source_color = vec3(0.30, 0.27, 0.25);
uniform vec3 rock_light : source_color = vec3(0.58, 0.52, 0.43);
uniform vec3 ochre_stone : source_color = vec3(0.70, 0.54, 0.31);
uniform vec3 sand_col : source_color = vec3(0.80, 0.66, 0.42);
uniform vec3 frost_col : source_color = vec3(0.84, 0.91, 0.97);
uniform vec3 crystal_dark : source_color = vec3(0.15, 0.09, 0.26);
uniform vec3 crystal_glow : source_color = vec3(0.64, 0.38, 1.0);
uniform vec3 pearl_col : source_color = vec3(0.95, 0.88, 0.96);
uniform vec3 wet_mud : source_color = vec3(0.17, 0.12, 0.08);

varying vec3 v_pos;
varying vec3 v_nrm;
varying vec4 v_w;
varying float v_true_normals;

void vertex() {
	v_pos = VERTEX;
	v_nrm = NORMAL;
	v_w = COLOR;
	// 1.0 when the mesh supplies real (non radial) normals.
	v_true_normals = 1.0 - step(0.99995, dot(normalize(NORMAL), normalize(VERTEX)));
}

vec3 tri_w(vec3 n) {
	vec3 w = pow(abs(n), vec3(5.0));
	return w / (w.x + w.y + w.z + 1e-5);
}

vec4 tri_tex(sampler2D t, vec3 p, vec3 w) {
	return texture(t, p.zy) * w.x + texture(t, p.xz) * w.y + texture(t, p.xy) * w.z;
}

// Reoriented triplanar normal: returns object-space normal perturbation applied to base normal n.
vec3 tri_normal(sampler2D t, vec3 p, vec3 n, vec3 w, float strength) {
	vec3 tx = texture(t, p.zy).xyz * 2.0 - 1.0;
	vec3 ty = texture(t, p.xz).xyz * 2.0 - 1.0;
	vec3 tz = texture(t, p.xy).xyz * 2.0 - 1.0;
	tx.xy *= strength; ty.xy *= strength; tz.xy *= strength;
	// whiteout blend
	vec3 nx = vec3(tx.xy + n.zy, abs(tx.z) * n.x);
	vec3 ny = vec3(ty.xy + n.xz, abs(ty.z) * n.y);
	vec3 nz = vec3(tz.xy + n.xy, abs(tz.z) * n.z);
	return normalize(nx.zyx * w.x + ny.xzy * w.y + nz.xyz * w.z);
}

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

void fragment() {
	vec3 up = normalize(v_pos);
	float dist = length(VERTEX);
	float lod = 1.0 - smoothstep(detail_fade_near, detail_fade_far, dist);
	float height = length(v_pos) - planet_radius;

	// Geometric normal in object space.
	vec3 facet = normalize(cross(dFdx(v_pos), dFdy(v_pos)));
	if (dot(facet, up) < 0.0) facet = -facet;
	vec3 gn = normalize(mix(facet, up, facet_smoothing));
	gn = normalize(mix(gn, normalize(v_nrm), v_true_normals));
	float slope_raw = 1.0 - clamp(dot(mix(facet, normalize(v_nrm), v_true_normals), up), 0.0, 1.0);

	vec3 p_macro = v_pos * macro_scale;
	vec3 p_mid = v_pos * mid_scale + 7.31;
	vec3 wgt = tri_w(up); // blend by the radial direction so that seams are identical on both faces
	vec4 nm = tri_tex(detail_noise, p_macro, wgt);
	vec4 nd = tri_tex(detail_noise, p_mid, wgt);
	float macro = nm.r;
	float strata = nm.a;

	// ---- biome weights, domain-warped so edges are organic ----
	vec4 bw = max(v_w, vec4(0.0));
	float s = bw.x + bw.y + bw.z + bw.w;
	bw /= max(s, 0.001);
	vec4 warp = vec4(macro - 0.5, nd.r - 0.5, nm.b - 0.5, nd.b - 0.5) * 0.55;
	bw = max(bw + warp * (bw.x + 0.2), vec4(0.0));
	bw = pow(bw, vec4(1.6));
	bw /= dot(bw, vec4(1.0)) + 1e-4;

	// ---- exposure: slope plus noise decides rock ----
	float rock_mask = smoothstep(rock_slope_start, rock_slope_full, slope_raw + (nd.r - 0.5) * 0.16 + (macro - 0.5) * 0.10);
	rock_mask = max(rock_mask, bw.y * smoothstep(0.35, 0.8, nd.g * 0.4 + macro * 0.7) * 0.8);

	// ---- grass / soil ----
	float wet = 1.0 - smoothstep(-0.6, 0.5, height);
	vec3 grass = mix(grass_cool, grass_warm, smoothstep(0.25, 0.75, macro));
	grass = mix(grass, grass_dry, smoothstep(0.6, 0.95, nd.r * 0.6 + macro * 0.5) * 0.55);
	grass *= 0.82 + 0.36 * nd.b;
	float bare = smoothstep(0.62, 0.9, nd.g * 0.55 + nm.b * 0.45 + slope_raw * 1.4);
	vec3 fertile = mix(grass, soil_col * (0.8 + 0.5 * nd.b), bare * 0.75);
	fertile = mix(fertile, moss_col, wet * 0.5);
	fertile = mix(fertile, wet_mud, smoothstep(-0.9, -1.35, height));

	// ---- rock with elevation-contoured strata (continuous around the planet) ----
	float strat_coord = fract((length(v_pos) * 0.55) + (macro - 0.5) * 0.9 + nd.r * 0.12);
	float band = 0.5 + 0.5 * sin(strat_coord * 6.2831853 * 3.0) * (0.6 + 0.4 * strata);
	vec3 rock = mix(rock_dark, rock_light, clamp(band * 0.7 + nm.a * 0.35 + nd.b * 0.2, 0.0, 1.0));
	rock = mix(rock, moss_col * 1.1, (1.0 - smoothstep(0.1, 0.6, slope_raw)) * smoothstep(0.45, 0.8, nd.r) * 0.6);

	// ---- arid: dune sand with worn ochre flagstone/ruin paving ----
	float cracks = nd.g;
	float paving = smoothstep(0.55, 0.75, nm.g);
	vec3 arid = mix(sand_col, ochre_stone, 0.35 + 0.45 * nm.r);
	arid = mix(arid, ochre_stone * 0.72, paving * 0.7 + cracks * 0.35);
	arid *= 0.85 + 0.3 * nd.b;

	// ---- enchanted: violet strata rock with glowing fault cracks ----
	vec3 ench = mix(crystal_dark, crystal_dark * 2.3 + vec3(0.06, 0.02, 0.12), nm.a * 0.6 + nd.b * 0.3);
	float fault = smoothstep(0.62, 0.95, nm.g) * smoothstep(0.3, 0.7, nd.r + 0.2);

	// ---- frost ----
	float lat = abs(up.y);
	float frost_amt = smoothstep(frost_latitude, frost_latitude + 0.14, lat + (macro - 0.5) * 0.12)
		+ smoothstep(frost_height, frost_height + 1.8, height + (nd.r - 0.5) * 1.2);
	frost_amt = clamp(frost_amt, 0.0, 1.0) * (1.0 - smoothstep(0.35, 0.65, slope_raw)) * (0.75 + 0.25 * nd.b);

	// ---- combine ----
	vec3 flat_col = fertile * bw.x + arid * bw.z;
	float flat_w = bw.x + bw.z;
	vec3 col = mix(flat_col / max(flat_w, 1e-3), rock, clamp(rock_mask * (0.35 + bw.y * 1.2 + 0.3), 0.0, 1.0));
	col = mix(col, rock, bw.y * 0.85);
	col = mix(col, ench, bw.w * 0.9);
	col = mix(col, frost_col * (0.93 + 0.07 * nd.b), frost_amt);
	// worn path / ruin paving: pearly pale lines where arid+ruin weight meets fertile weight
	float path_edge = bw.z * smoothstep(0.1, 0.4, bw.x);
	col = mix(col, ochre_stone * (0.9 + 0.2 * nd.b), path_edge * 0.35 * paving);

	// ---- micro normal + height ----
	vec3 n_obj = gn;
	float micro_h = 0.5;
	if (lod > 0.01) {
		vec3 p_micro = v_pos * micro_scale;
		vec4 mh = tri_tex(detail_normal, p_micro, wgt);
		micro_h = mh.a;
		float st = normal_strength * lod * mix(0.7, 1.35, rock_mask);
		n_obj = tri_normal(detail_normal, p_micro, gn, wgt, st);
		float height_mix = mix(0.88, 1.12, micro_h);
		col *= mix(1.0, height_mix, lod);
	}
	// cavity darkening and macro tint for tactile grit, survives in the distance
	float cavity = mix(1.0, 0.72 + 0.28 * micro_h, lod);
	col *= mix(0.9, 1.1, macro) * cavity;

	// ---- glints, fault light ----
	float t = TIME * magic_pulse_speed;
	float pulse = 0.65 + 0.35 * sin(t * 6.2831853 + macro * 14.0);
	vec3 emis = crystal_glow * fault * bw.w * magic_glow * pulse * 1.6;
	float fleck = texture(sparkle_tex, v_pos.xz * 0.9).r * wgt.y + texture(sparkle_tex, v_pos.zy * 0.9).r * wgt.x + texture(sparkle_tex, v_pos.xy * 0.9).r * wgt.z;
	float tw = smoothstep(0.55, 0.9, sin(t * 9.0 + hash13(floor(v_pos * 6.0)) * 40.0) * 0.5 + 0.5);
	emis += mix(crystal_glow, pearl_col, 0.4) * fleck * tw * bw.w * 0.35 * lod * magic_glow;

	// ---- roughness / specular ----
	float rough = mix(0.93, 0.62, wet * bw.x * 0.5);
	rough = mix(rough, 0.78 - 0.18 * band, rock_mask);
	rough = mix(rough, 0.88, bw.z);
	rough = mix(rough, 0.34 + 0.2 * (1.0 - fault), bw.w);
	rough = mix(rough, 0.42 + 0.2 * micro_h, frost_amt);
	rough = mix(rough, 0.35, smoothstep(-0.9, -1.35, height) * 0.7);

	ALBEDO = clamp(col, 0.0, 1.0);
	ROUGHNESS = clamp(rough, 0.05, 1.0);
	SPECULAR = mix(0.35, 0.65, frost_amt + bw.w * 0.5);
	METALLIC = bw.w * 0.06;
	AO = clamp(cavity * (1.0 - 0.15 * rock_mask * (1.0 - micro_h)), 0.0, 1.0);
	AO_LIGHT_AFFECT = 0.35;
	EMISSION = emis;
	// Object-space normal -> view space (mesh node must carry rotation only; planet chunks are unscaled).
	NORMAL = normalize((VIEW_MATRIX * MODEL_MATRIX * vec4(n_obj, 0.0)).xyz);
}
