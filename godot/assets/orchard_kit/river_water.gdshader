// Brann's Forge VR - river surface, package 2 revision (replaces WATER_SHADER in landscape_water.gd).
// UV contract unchanged: UV.x = 0..1 across channel (left->right bank), UV.y = travelled_metres * 0.1.
// Opaque, no screen/depth reads (Mobile/VR). Package-1 read as a straight blue-grey strip because:
// symmetric depth profile, strong fresnel sky mix (grey at eye height), streaks too weak to read as motion.
// Now: asymmetric meandering thalweg, visible bed (pebbles/gravel) in shallows, advected flow ripples at
// two speeds, riffle foam, and fresnel capped so the water never turns sky-grey.
shader_type spatial;
render_mode cull_disabled, shadows_disabled, specular_schlick_ggx;

uniform vec3 deep_col    : source_color = vec3(0.04, 0.13, 0.12);
uniform vec3 mid_col     : source_color = vec3(0.09, 0.24, 0.20);
uniform vec3 shallow_col : source_color = vec3(0.34, 0.36, 0.25);  // gravel bed through thin water
uniform vec3 bed_dark    : source_color = vec3(0.17, 0.17, 0.12);
uniform vec3 foam_col    : source_color = vec3(0.80, 0.86, 0.82);
uniform vec3 sky_col     : source_color = vec3(0.55, 0.70, 0.86);
uniform float flow_speed = 0.35;
uniform float rain_wetness = 0.0;
uniform float fresnel_max = 0.28;   // was 0.55: prevents the grey-strip look at VR eye height
uniform float channel_width_m = 7.0; // for isotropic bed detail; set per ribbon if known

float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
	vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
	           mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
// cellular pebbles for the visible bed
float pebbles(vec2 p) {
	vec2 i = floor(p), f = fract(p); float d = 1.0;
	for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		vec2 o = vec2(float(x), float(y));
		vec2 c = o + vec2(hash21(i + o), hash21(i + o + 3.7)) * 0.8 + 0.1;
		d = min(d, length(f - c));
	}
	return d;
}

void fragment() {
	// metres: across (0..width), along
	vec2 mpos = vec2(UV.x * channel_width_m, UV.y * 10.0);
	// thalweg swings side to side along the reach so the deep line is never straight
	float thal = 0.5 + 0.22 * sin(mpos.y * 0.09 + 1.3) + 0.08 * sin(mpos.y * 0.23);
	float off = (UV.x - thal) / (UV.x < thal ? max(thal, 0.1) : max(1.0 - thal, 0.1));
	float depth = 1.0 - smoothstep(0.2, 1.0, abs(off));   // 1 deep, 0 at the waterline
	depth = clamp(depth + (noise2(mpos * 0.35) - 0.5) * 0.25, 0.0, 1.0);

	// two advected ripple layers (different speeds) -> reads as moving water, not scrolling texture
	float t = TIME * flow_speed * 10.0;
	float speed = mix(0.35, 1.0, depth);                  // faster in the thalweg
	vec2 f1 = vec2(mpos.x * 1.1, mpos.y * 0.45 - t * speed);
	vec2 f2 = vec2(mpos.x * 2.3 + 4.0, mpos.y * 1.1 - t * speed * 1.35);
	float r1 = noise2(f1), r2 = noise2(f2);
	float streak = noise2(vec2(mpos.x * 3.0, mpos.y * 0.25 - t * speed));

	// bed visibility in shallows: pebbles + dark gaps, gently distorted by ripples
	vec2 bedp = mpos * 1.6 + (vec2(r1, r2) - 0.5) * 0.25;
	float peb = pebbles(bedp);
	vec3 bed = mix(bed_dark, shallow_col, smoothstep(0.15, 0.45, peb)) * mix(0.8, 1.15, noise2(mpos * 0.7));
	vec3 water = mix(mid_col, deep_col, smoothstep(0.35, 0.95, depth));
	vec3 colour = mix(bed, water, smoothstep(0.0, 0.55, depth));
	colour += (streak - 0.5) * 0.06 * (0.3 + depth);
	colour += (r1 + r2 - 1.0) * 0.025;

	// riffle foam: waterline lace + broken lines where the bed is shallow and flow is fast
	float lace = smoothstep(0.88, 1.0, abs(off) + (r2 - 0.5) * 0.18) * smoothstep(0.45, 0.75, r1);
	float riffle = smoothstep(0.72, 0.9, noise2(vec2(mpos.x * 0.6, mpos.y * 0.12)) ) * smoothstep(0.55, 0.8, streak) * (1.0 - depth * 0.6);
	float foam = clamp(lace + riffle * 0.6, 0.0, 1.0);
	colour = mix(colour, foam_col, foam * 0.6);

	float fres = pow(1.0 - clamp(dot(NORMAL, VIEW), 0.0, 1.0), 5.0);
	colour = mix(colour, sky_col * 0.85, fres * fresnel_max);
	float rings = rain_wetness * smoothstep(0.93, 1.0, noise2(mpos * 3.0 + TIME));
	ALBEDO = colour + rings * 0.05;
	ROUGHNESS = mix(0.06, 0.4, foam) + rings * 0.2 + (1.0 - depth) * 0.08;
	SPECULAR = 0.5;
	METALLIC = 0.0;
	vec2 nrm = vec2(r1 - 0.5, r2 - 0.5) + vec2(noise2(f2 * 2.1) - 0.5, 0.0) * 0.5;
	NORMAL_MAP = normalize(vec3(nrm * 0.8, 1.0)) * 0.5 + 0.5;
	NORMAL_MAP_DEPTH = mix(0.35, 0.8, depth);
}
