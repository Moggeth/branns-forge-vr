// Brann's Forge VR - river surface, rev-4 2026-09-29 (deeper water, warmer shallows, less sky/foam whitening) (replaces WATER_SHADER in landscape_water.gd).
// Contract unchanged: UV.x = 0..1 across channel (left->right bank), UV.y = travelled_metres * 0.1,
// NORMAL = up, TANGENT = across. Every previous uniform name is kept (extra ones are optional).
// Opaque, no screen/depth reads (Mobile/VR).
//
// Real-game capture 00 showed a hard metallic blue-grey ribbon with repeated long streaks:
//  * streaks: the along-flow noise was stretched 12:1 and scrolled forever -> anisotropic smears.
//    Now ripples are ISOTROPIC value-noise normals advected with a two-phase flow map
//    (two samples half a cycle apart, cross-faded) so texture never stretches or repeats visibly.
//  * metallic: low roughness everywhere mirrored the pale sky radiance at grazing VR angles.
//    Engine specular is reduced and the reflection is a controlled fake whose colour is the
//    dark banks/vegetation near the edges and sky only mid-channel.
//  * colour: water now tints a real bed by depth-dependent absorption (reds absorb first) so shallows
//    show warm pebbles, the thalweg goes deep green-teal; no blue paint.
//  * hard edge: the last ~8% across becomes wet gravel/stones broken by pebble shapes, so the ribbon
//    meets the bank as a shoreline, not a cut.
shader_type spatial;
render_mode cull_disabled, shadows_disabled, specular_schlick_ggx;

uniform vec3 deep_col    : source_color = vec3(0.030, 0.100, 0.095);   // rev-4: deeper, readable   // in-scatter colour of deep water
uniform vec3 mid_col     : source_color = vec3(0.075, 0.19, 0.155);
uniform vec3 shallow_col : source_color = vec3(0.56, 0.45, 0.30);   // warmer ochre gravel   // lit gravel bed
uniform vec3 bed_dark    : source_color = vec3(0.20, 0.18, 0.13);   // gaps between stones
uniform vec3 foam_col    : source_color = vec3(0.74, 0.79, 0.76);
uniform vec3 sky_col     : source_color = vec3(0.55, 0.70, 0.86);
uniform vec3 bank_reflect_col : source_color = vec3(0.16, 0.22, 0.12); // reflected banks/vegetation
uniform vec3 wet_stone_col : source_color = vec3(0.26, 0.24, 0.20);
uniform float flow_speed = 0.35;
uniform float rain_wetness = 0.0;
uniform float fresnel_max = 0.22;
uniform float channel_width_m = 7.0;
uniform float absorb_depth_m = 2.2;    // metres of water at the thalweg (visual only)

varying vec3 wpos;

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
	vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
	           mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// cellular stones: x = distance to nearest centre, y = per-stone id
vec2 stones(vec2 p) {
	vec2 i = floor(p), f = fract(p); float d = 8.0; float id = 0.0;
	for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		vec2 o = vec2(float(x), float(y));
		float h = hash21(i + o);
		vec2 c = o + vec2(h, hash21(i + o + 3.7)) * 0.8 + 0.1;
		float dd = length((f - c) * vec2(1.0, 1.0 + h * 0.6));
		if (dd < d) { d = dd; id = h; }
	}
	return vec2(d, id);
}
// isotropic ripple slope from 3 noise taps (two octaves)
vec2 ripple(vec2 p) {
	float e = 0.35;
	float a = noise2(p) + 0.5 * noise2(p * 2.7 + 7.0);
	float bx = noise2(p + vec2(e, 0.0)) + 0.5 * noise2((p + vec2(e, 0.0)) * 2.7 + 7.0);
	float by = noise2(p + vec2(0.0, e)) + 0.5 * noise2((p + vec2(0.0, e)) * 2.7 + 7.0);
	return vec2(a - bx, a - by) / e;
}

void vertex() {
	wpos = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
}

void fragment() {
	vec2 mpos = vec2(UV.x * channel_width_m, UV.y * 10.0);   // across, along (metres)
	// meandering thalweg -> asymmetric depth, never a straight deep line
	float thal = 0.5 + 0.22 * sin(mpos.y * 0.09 + 1.3) + 0.08 * sin(mpos.y * 0.23);
	float off = (UV.x - thal) / (UV.x < thal ? max(thal, 0.1) : max(1.0 - thal, 0.1));
	float depth = 1.0 - smoothstep(0.15, 1.0, abs(off));
	depth = clamp(depth + (noise2(wpos.xz * 0.3) - 0.5) * 0.3, 0.0, 1.0);

	// --- two-phase flow-mapped ripples (no stretching, no visible scroll repeat)
	float speed = mix(0.3, 1.0, depth) * flow_speed * 3.0;                 // m/s, faster in the thalweg
	vec2 flow = vec2(0.12 * sin(mpos.y * 0.4 + UV.x * 3.0), -1.0) * speed;  // slight cross-current
	float cyc = TIME * 0.45;
	float ph0 = fract(cyc), ph1 = fract(cyc + 0.5);
	float w0 = 1.0 - abs(ph0 * 2.0 - 1.0);
	vec2 q = mpos * vec2(1.3, 1.3);
	vec2 s0 = ripple(q + flow * ph0 * 2.2);
	vec2 s1 = ripple(q + flow * ph1 * 2.2 + vec2(3.1, 7.7));
	vec2 slope = mix(s1, s0, w0);
	vec2 fine = ripple(mpos * 3.4 + flow * TIME * 0.9 + 11.0) * 0.35;      // chop, small-scale only

	// --- bed: stationary world-space stones seen through water, refracted by the surface slope
	vec2 bedp = wpos.xz * 1.35 + slope * 0.12 * (0.3 + depth);
	vec2 st = stones(bedp);
	vec2 st2 = stones(wpos.xz * 3.1 + 5.0);
	float stone_mask = smoothstep(0.55, 0.3, st.x);
	vec3 bed = mix(bed_dark, shallow_col * mix(0.75, 1.15, st.y), stone_mask);
	bed = mix(bed, bed_dark * 1.2, smoothstep(0.45, 0.2, st2.x) * 0.3);
	bed *= mix(0.85, 1.1, noise2(wpos.xz * 0.5));
	// caustic flicker on shallow bed (cheap: ripple magnitude)
	bed *= 1.0 + clamp(dot(slope, vec2(0.6, 0.8)), 0.0, 1.0) * 0.35 * (1.0 - depth);

	// --- absorption + in-scatter by depth (reds die first -> warm shallows, green-teal depth)
	float dm = depth * absorb_depth_m + 0.05;
	vec3 T = exp(-dm * vec3(2.4, 1.15, 1.35));
	vec3 scatter = mix(mid_col, deep_col, smoothstep(0.3, 0.9, depth));
	vec3 colour = bed * T + scatter * (1.0 - T);

	// --- controlled fake reflection: banks/vegetation near edges, sky mid-channel
	vec3 n_ts = normalize(vec3((slope + fine) * 0.22, 1.0));
	float ndv = clamp(dot(normalize(NORMAL + (TANGENT * n_ts.x + BINORMAL * n_ts.y) * 0.6), VIEW), 0.0, 1.0);
	float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
	float edge_reflect = smoothstep(0.35, 0.95, abs(off));
	vec3 refl = mix(sky_col * 0.62, bank_reflect_col, edge_reflect * 0.9);   // rev-4: less pale sky sheen
	colour = mix(colour, refl, fres * fresnel_max * 1.4);

	// --- foam: waterline lace + riffle patches over shallow stones (isotropic, broken)
	float lace = smoothstep(0.86, 0.98, abs(off) + (noise2(q * 1.6 + flow * TIME * 0.5) - 0.5) * 0.25);
	float riffle_zone = smoothstep(0.6, 0.85, noise2(vec2(mpos.x * 0.35, mpos.y * 0.09))) * (1.0 - depth);
	float bubbles = smoothstep(0.62, 0.9, noise2(q * 2.2 + flow * ph0 * 3.0) * w0 + noise2(q * 2.2 + flow * ph1 * 3.0 + 4.0) * (1.0 - w0));
	float foam = clamp(lace * 0.55 + riffle_zone * bubbles * 0.9, 0.0, 1.0);
	colour = mix(colour, foam_col, foam * 0.32);

	// --- shoreline: last stretch becomes wet gravel/stones breaking the ribbon edge
	float shore = smoothstep(0.9, 1.02, abs(off) + (0.35 - st2.x) * 0.3 + (noise2(wpos.xz * 0.7) - 0.5) * 0.2);
	vec3 wet = mix(wet_stone_col * 0.6, wet_stone_col * mix(0.8, 1.1, st2.y), smoothstep(0.5, 0.25, st2.x));
	colour = mix(colour, wet, shore * 0.9);

	float rings = rain_wetness * smoothstep(0.9, 1.0, noise2(wpos.xz * 3.0 + floor(TIME * 3.0)));
	ALBEDO = colour + rings * 0.04;
	ROUGHNESS = mix(0.16, 0.45, foam) + rings * 0.2 + shore * 0.25 + (1.0 - depth) * 0.06;
	SPECULAR = mix(0.28, 0.4, shore);
	METALLIC = 0.0;
	NORMAL_MAP = n_ts * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = mix(0.5, 0.9, depth) * (1.0 - shore * 0.6);
}
