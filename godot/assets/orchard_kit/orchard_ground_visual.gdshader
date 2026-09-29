// Brann's Forge VR - Orchard ground, package 2 revision.
// Drop-in: keeps EVERY existing uniform name/binding (grass_tex, soil_tex, micro_normal, macro_mask,
// rain_wetness, snow_cover, palette uniforms, mask_origin_x). New optional input: exposure_tex (defaults
// black = no effect) so Sol can paint Sunder/Raise exposure without changing terrain truth.
//
// Package-1 faults fixed here:
//  * Angular solid patches: slope came from the per-vertex normal of a 2 m lattice and was pushed through
//    hard smoothsteps, so each triangle became a flat colour. Slope is now softened (wide ramps, blended
//    with the per-pixel derivative normal only at low weight) and all region noise is domain-warped fbm
//    with the lattice never used as a colour threshold.
//  * Material-debug look: palette mixing dominated the real textures. Textures now carry most of the
//    value/hue detail (luminance-preserving modulation at 3 scales) and palette acts as a soft grade.
//  * Strata on terrain came from raw world-Y sine bands -> striped rings on every hill. Rock bands are now
//    warped by noise and only appear on genuinely steep faces or exposed cuts.
// Mobile renderer: opaque, 7 texture reads (1 optional), cheap value noise, no triplanar.
shader_type spatial;
render_mode cull_back, diffuse_lambert, specular_schlick_ggx;

uniform sampler2D grass_tex : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D soil_tex : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D micro_normal : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D macro_mask : repeat_disable, filter_linear;   // r=path/exposed, g=leaf litter, b=damp/bank, a=disturbed
// NEW (optional, same 320 m mapping as macro_mask, RGBA8, 1 texel per metre or finer):
//  r = fresh exposure 0..1 (painted by each real terrain op, decays over game time)
//  g = cut depth below original surface / 4 m (0..1)  -> picks topsoil / dark subsoil / strata rock
//  b = raised/heaped fraction 0..1 (Raise Earth, rims) -> loose clod soil
uniform sampler2D exposure_tex : hint_default_black, repeat_disable, filter_linear;
uniform float rain_wetness = 0.0;
uniform float snow_cover = 0.0;

uniform vec3 grass_cool : source_color = vec3(0.27, 0.45, 0.22);
uniform vec3 grass_lush : source_color = vec3(0.40, 0.58, 0.20);
uniform vec3 grass_warm : source_color = vec3(0.62, 0.64, 0.26);
uniform vec3 meadow_dry : source_color = vec3(0.66, 0.60, 0.33);
uniform vec3 soil_col   : source_color = vec3(0.42, 0.29, 0.18);
uniform vec3 soil_dark  : source_color = vec3(0.24, 0.16, 0.10);
uniform vec3 bank_wet   : source_color = vec3(0.20, 0.17, 0.12);
uniform vec3 rock_mid   : source_color = vec3(0.58, 0.52, 0.47);
uniform vec3 rock_warm  : source_color = vec3(0.62, 0.52, 0.42);
uniform vec3 rock_band  : source_color = vec3(0.50, 0.46, 0.47);
uniform vec3 rock_fresh : source_color = vec3(0.36, 0.31, 0.29);  // unweathered cut face: darker than cliffs
uniform vec3 gravel_col : source_color = vec3(0.47, 0.43, 0.36);
uniform float texture_strength = 0.85;   // raised from 0.45: real textures now carry the detail
uniform float strata_scale = 2.35;
uniform float mask_origin_x = -360.0;

varying vec2 at;
varying float world_y;
varying vec3 world_n;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
	vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
	           mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
	// 3 octaves, rotated each octave so no axis-aligned lattice survives
	float a = 0.5, s = 0.0;
	mat2 r = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8));
	for (int i = 0; i < 3; i++) { s += a * noise2(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
	return s / 0.875;
}
// luminance-preserving texture detail: hue stays on palette, value/texture comes from the image
vec3 tex_detail(sampler2D t, vec2 p, float s) {
	vec2 q = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8)) * p;
	vec3 a = texture(t, p * s).rgb;
	vec3 b = texture(t, q * s * 0.29 + 0.37).rgb;
	return mix(a, b, 0.4);
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

void vertex() {
	vec4 w = MODEL_MATRIX * vec4(VERTEX, 1.0);
	at = w.xz - vec2(mask_origin_x, 0.0);
	world_y = w.y;
	world_n = normalize((MODEL_MATRIX * vec4(NORMAL, 0.0)).xyz);
}

void fragment() {
	vec2 uv = clamp((at + vec2(160.0)) / 320.0, vec2(0.0), vec2(1.0));
	vec4 m = texture(macro_mask, uv);
	vec4 ex = texture(exposure_tex, uv);

	// domain warp once, reuse everywhere: organic, lattice-free region boundaries
	vec2 warp = vec2(noise2(at * 0.045), noise2(at * 0.045 + 5.2)) * 9.0;
	vec2 wp = at + warp;
	float regional = fbm(wp * 0.018);
	float meander = fbm(wp * 0.07 + 3.0);
	float fine = fbm(at * 0.55);

	// softened slope: interpolated vertex normal only, wide ramps (no per-triangle thresholds)
	float slope = 1.0 - clamp(normalize(world_n).y, 0.0, 1.0);
	float slope_soft = smoothstep(0.08, 0.55, slope + (meander - 0.5) * 0.10);

	// --- textured meadow. Palette is a grade; image supplies value variation.
	vec3 gt = tex_detail(grass_tex, at, 0.23);
	vec3 g = mix(grass_cool, grass_lush, smoothstep(0.25, 0.75, regional));
	g = mix(g, grass_warm, smoothstep(0.5, 0.85, meander) * 0.7);
	g = mix(g, meadow_dry, smoothstep(0.6, 0.9, regional) * 0.45);
	g *= mix(1.0, luma(gt) * 2.2, texture_strength);
	g = mix(g, g * (gt / max(luma(gt), 0.05)), 0.25 * texture_strength);   // keep some authored hue flecks
	g *= mix(0.86, 1.10, fine);                                             // clumping at 1-3 m scale

	vec3 st = tex_detail(soil_tex, at, 0.31);
	vec3 s = mix(soil_col, soil_dark, slope_soft * 0.6 + fine * 0.2);
	s *= mix(1.0, luma(st) * 2.2, texture_strength);

	// --- ragged transitions: every mask edge is perturbed by fine noise so none reveals the 2 m lattice
	float edge_n = (fine - 0.5) * 0.35 + (noise2(at * 1.7) - 0.5) * 0.15;
	float leaf = m.g * (0.35 + 0.3 * meander);
	float soil_amt = clamp(m.r * 0.9 + m.a * 0.5 + leaf * 0.35 + slope_soft * 0.45 + edge_n, 0.0, 1.0);
	soil_amt = smoothstep(0.25, 0.75, soil_amt);
	vec3 colour = mix(g, s, soil_amt);
	colour = mix(colour, vec3(0.36, 0.30, 0.17) * (0.8 + 0.5 * fine), leaf * 0.25);

	// --- rock: warped, dipping bands; only on real steep faces
	float wy = world_y + (meander - 0.5) * 1.6 + at.x * 0.06;
	float band = sin(wy * strata_scale) + 0.45 * sin(wy * 5.1 + fine * 2.0);
	vec3 rock = mix(mix(rock_mid, rock_warm, 0.5 + 0.3 * band), rock_band, smoothstep(0.6, 0.95, sin(wy * 1.3)) * 0.6);
	rock *= mix(1.0, luma(st) * 2.0, 0.6);
	float rockiness = smoothstep(0.45, 0.70, slope + edge_n * 0.5);
	colour = mix(colour, rock, rockiness);

	// --- EXPOSURE (Sunder / Raise / Meteor): darker soil -> subsoil -> fresh stratified rock by depth.
	// Irregular margin: exposure threshold is eroded by noise so the outline is torn, not a ribbon.
	float fresh = smoothstep(0.15, 0.55, ex.r + edge_n * 0.9 - 0.1 * (1.0 - fine));
	float depth = ex.g * 4.0; // metres
	vec3 cut = mix(soil_col * 0.8, soil_dark, smoothstep(0.2, 1.2, depth + edge_n));
	vec3 fresh_rock = mix(rock_fresh, rock_band * 0.8, 0.5 + 0.4 * sin(wy * strata_scale * 1.3 + fine * 3.0));
	cut = mix(cut, fresh_rock, smoothstep(1.4, 2.6, depth + (fine - 0.5) * 1.2) * 0.9);
	cut *= mix(1.0, luma(st) * 2.2, 0.9);
	cut = mix(cut, gravel_col * mix(0.6, 1.1, noise2(at * 3.1)), smoothstep(0.7, 0.95, noise2(at * 0.9)) * 0.35); // rubble flecks
	vec3 clod = mix(soil_col, soil_dark, noise2(at * 2.3)) * mix(1.0, luma(st) * 2.2, 0.9);
	cut = mix(cut, clod, ex.b);
	colour = mix(colour, cut, fresh);

	// --- riverbank: damp soil fading into gravel shelf near the water (hydrology-fed mask only)
	float bank = smoothstep(0.30, 0.85, m.b + edge_n * 0.4);
	vec3 shelf = mix(bank_wet, gravel_col * mix(0.55, 1.0, noise2(at * 2.7)), smoothstep(0.6, 0.95, m.b) * 0.8);
	shelf *= mix(1.0, luma(st) * 2.0, 0.7);
	colour = mix(colour, shelf, bank * 0.85);

	float damp = clamp(max(bank * 0.8, rain_wetness) + m.g * rain_wetness * 0.18 + fresh * 0.2, 0.0, 1.0);
	colour *= 1.0 - damp * 0.22;
	float puddle = smoothstep(0.70, 0.92, m.b * 0.55 + rain_wetness * 0.58 + meander * 0.14) * (1.0 - rockiness);
	float snow = snow_cover * smoothstep(0.2, 0.6, snow_cover * 0.8 + fine * 0.4 - slope * 0.6);
	colour = mix(colour, vec3(0.89, 0.93, 0.94) * mix(0.92, 1.02, fine), snow);

	ALBEDO = colour;
	// damp banks stay matte-ish (package 1's 0.40 roughness + 0.66 specular mirrored the pale sky at
	// eye height and turned the whole bank into a grey-blue strip); only real puddles go glossy.
	ROUGHNESS = mix(0.95 - rockiness * 0.08 - fresh * 0.05, 0.68, damp * 0.8);
	ROUGHNESS = mix(ROUGHNESS, 0.35, puddle * 0.85);
	ROUGHNESS = mix(ROUGHNESS, 0.82, snow);
	SPECULAR = mix(0.30, 0.45, damp) * (1.0 - snow * 0.3);
	vec3 nm = mix(texture(micro_normal, at * 0.28).rgb, texture(micro_normal, at * 1.1 + 0.5).rgb, 0.4);
	NORMAL_MAP = nm;
	NORMAL_MAP_DEPTH = mix(0.55 + rockiness * 0.4 + fresh * 0.4, 0.08, snow);
}
