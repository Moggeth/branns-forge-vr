shader_type spatial;
// Brann's Forge VR - portal veil surface (replacement for reference.gdshader; same uniform interface + theme + destination_view).
// Mesh contract (node "Veil" in every <zone_id>.glb):
//   COLOR.r = 0 at the aperture rim, 1 at the centre (smoothstepped ring falloff)
//   UV      = aperture-space 0..1, Godot top-left orientation (UV.y = 0 at the top of the opening)
// Aperture side = mesh front (+Z, the side the player walks in from). Rear shows a dimmer, mirrored, more veiled view.
// One pass, unshaded, alpha blend, no depth/screen reads, never writes depth. Mobile-renderer safe.
render_mode blend_mix, depth_draw_never, cull_disabled, unshaded, fog_disabled;

uniform vec4 edge_color : source_color = vec4(0.94, 0.78, 0.42, 1.0);
uniform vec4 core_color : source_color = vec4(1.0, 0.95, 0.8, 1.0);
uniform vec4 deep_color : source_color = vec4(0.25, 0.14, 0.05, 1.0);
uniform float energy : hint_range(0.0, 3.0) = 1.0;      // overall brightness (0 = dormant)
uniform float opacity : hint_range(0.0, 1.0) = 0.82;
uniform float swirl_speed = 0.35;
uniform float swirl_twist = 2.2;
uniform float arms = 3.0;
uniform float time_offset = 0.0;                        // per-portal phase
uniform float swell : hint_range(0.0, 1.0) = 0.0;       // entrance swell: bulges toward the player and brightens
uniform float swell_bulge = 0.16;
uniform float release : hint_range(0.0, 1.0) = 0.0;     // exit release: 0->1 expanding ring, 1 = finished
uniform float lod_detail : hint_range(0.0, 1.0) = 1.0;  // 1 near (noise), 0 far (analytic only)
// --- new ---
uniform int theme : hint_range(0, 11) = 7;
// 0 pinewood_ruins 1 sandstone_quarry 2 enchanted_kitchen 3 mushroom_glade 4 crystal_hollow 5 sky_garden
// 6 ember_foundry 7 forge_yard 8 orchard_highlands 9 gloamfen 10 starfall_ridge 11 cloudbreak_keep
uniform sampler2D destination_view : source_color, filter_linear_mipmap, repeat_disable;
uniform float view_strength : hint_range(0.0, 1.0) = 0.78;   // how clearly the destination reads at the centre
uniform float parallax_depth : hint_range(0.0, 0.2) = 0.06;  // bounded parallax of the destination image (UV units)
uniform float refract_amount : hint_range(0.0, 0.05) = 0.018; // bounded field distortion of the destination

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}
float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash21(i), hash21(i + vec2(1, 0)), f.x), mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), f.x), f.y);
}

varying float v_depth;
varying vec3 v_view_obj;

void vertex() {
	v_depth = COLOR.r;
	VERTEX.z += swell * swell_bulge * smoothstep(0.0, 1.0, COLOR.r);
	// camera position in object space -> view direction for parallax
	vec3 cam_obj = (inverse(MODEL_MATRIX) * vec4(INV_VIEW_MATRIX[3].xyz, 1.0)).xyz;
	v_view_obj = VERTEX - cam_obj;
}

// Per-theme moving signature. Returns pattern 0..1; p = centred aperture coords (y down), r, a polar.
float signature(int th, vec2 p, float r, float a, float t, float d) {
	float s = 0.5;
	if (th == 0) {        // pinewood: slow rising sap-motes and drifting needle bands
		s = 0.5 + 0.5 * sin(p.x * 9.0 + sin(p.y * 3.0 + t * 0.6) * 1.5) * 0.6 + 0.4 * smoothstep(0.85, 1.0, sin(p.y * 6.0 + t * 0.9 + p.x * 2.0));
	} else if (th == 1) { // quarry: horizontal strata sliding in steps, survey hairlines
		float strata = fract(p.y * 3.0 + floor(t * 0.5) * 0.12 + smoothstep(0.0, 1.0, fract(t * 0.5)) * 0.12);
		s = smoothstep(0.0, 0.1, strata) * (1.0 - smoothstep(0.85, 1.0, strata)) * 0.7 + 0.3 * step(0.985, cos(p.x * 6.2832));
	} else if (th == 2) { // kitchen: rising steam curls, warm convection
		vec2 q = vec2(p.x * 3.0 + sin(p.y * 4.0 + t) * 0.4, p.y * 2.0 + t * 0.8);
		s = 0.5 + 0.5 * sin(q.x * 2.0 + sin(q.y * 3.0) * 2.0);
	} else if (th == 3) { // mushroom: slow breathing spore rings radiating outward
		s = 0.5 + 0.5 * sin(r * 14.0 - t * 1.2 + sin(a * 5.0) * 0.6);
		s *= 0.6 + 0.4 * sin(t * 0.7 + a * 2.0);
	} else if (th == 4) { // crystal: faceted prismatic shards, slowly rotating facets
		float fa = floor((a + t * 0.15) * 6.0 / 6.2832);
		s = 0.35 + 0.65 * fract(sin(fa * 12.9898) * 43758.5) * (0.5 + 0.5 * sin(r * 8.0 - t * 1.4 + fa));
	} else if (th == 5) { // sky garden: soft cloud-drift lanes blowing sideways
		s = 0.5 + 0.5 * sin(p.y * 5.0 + sin(p.x * 2.0 - t * 0.9) * 1.6 - t * 0.3);
		s = mix(s, 1.0, 0.25);
	} else if (th == 6) { // ember foundry: upward heat shimmer with ember sparks
		float shimmer = 0.5 + 0.5 * sin(p.y * 10.0 + t * 3.0 + sin(p.x * 7.0) * 1.5);
		vec2 cell = vec2(p.x * 6.0, p.y * 6.0 + t * 1.6);
		float spark = step(0.93, hash21(floor(cell))) * smoothstep(0.35, 0.0, length(fract(cell) - 0.5));
		s = shimmer * 0.7 + spark;
	} else if (th == 7) { // forge yard (home): steady inward hearth spiral, the classic signature
		float tw = a + swirl_twist * (1.0 - r) + t * swirl_speed * 2.0;
		s = 0.5 + 0.5 * sin(tw * arms + r * 7.0 + t * swirl_speed * 6.0);
	} else if (th == 8) { // orchard: dappled leaf-light, gentle sway
		vec2 q = p * 4.0 + vec2(sin(t * 0.5) * 0.6, cos(t * 0.4) * 0.3);
		s = smoothstep(0.3, 0.8, 0.5 + 0.25 * (sin(q.x * 1.7 + q.y) + sin(q.y * 2.3 - q.x * 0.7 + t * 0.6)));
	} else if (th == 9) { // gloamfen: low mist ripples spreading from drifting wisps
		vec2 c1 = vec2(sin(t * 0.3) * 0.4, 0.3 + cos(t * 0.23) * 0.2);
		s = 0.5 + 0.5 * sin(length(p - c1) * 16.0 - t * 1.5) * smoothstep(1.2, 0.0, length(p - c1));
		s = mix(s, 0.5 + 0.5 * sin(p.y * 3.0 + t * 0.4), 0.4);
	} else if (th == 10) { // starfall: rotating star field with streaks across
		vec2 q = mat2(vec2(cos(t * 0.05), sin(t * 0.05)), vec2(-sin(t * 0.05), cos(t * 0.05))) * p * 7.0;
		float star = step(0.9, hash21(floor(q))) * smoothstep(0.3, 0.0, length(fract(q) - 0.5));
		float streak = smoothstep(0.03, 0.0, abs(fract(p.x * 0.5 + p.y * 0.8 - t * 0.25) - 0.5) - 0.01) * smoothstep(1.0, 0.2, r);
		s = 0.25 + star * 1.2 + streak * 0.5;
	} else {               // cloudbreak keep: banner-like vertical wind waves, bright breaks
		float wave = sin(p.x * 3.0 + sin(p.y * 2.0 + t * 1.1) * 1.2 - t * 0.8);
		s = 0.5 + 0.5 * wave;
		s = mix(s, 1.0, smoothstep(0.7, 1.0, sin(p.y * 1.5 - t * 0.35)) * 0.4);
	}
	return clamp(s, 0.0, 1.5);
}

void fragment() {
	float t = TIME + time_offset;
	vec2 p = (UV - vec2(0.5)) * 2.0;
	float r = length(p);
	float a = atan(p.y, p.x);
	float d = clamp(v_depth, 0.0, 1.0);
	bool front = FRONT_FACING;

	float sig = signature(theme, p, r, a, t, d);
	float grain = 0.5;
	if (lod_detail > 0.5) {
		grain = vnoise(p * 3.0 + vec2(t * 0.15, -t * 0.2)) * 0.65 + vnoise(p * 7.0 - vec2(0.0, t * 0.3)) * 0.35;
	}
	float pattern = mix(sig, grain, 0.25 * lod_detail);

	// destination: bounded parallax (looks "deeper" than the surface) + field refraction
	vec3 vd = normalize(v_view_obj);
	vec2 par = clamp(vd.xy / max(abs(vd.z), 0.35), vec2(-1.0), vec2(1.0)) * parallax_depth * vec2(1.0, -1.0);
	vec2 refr = (vec2(grain, sig) - 0.5) * refract_amount * (0.4 + 0.6 * (1.0 - d)) * lod_detail;
	vec2 duv = UV + par * (front ? 1.0 : -1.0) + refr;
	duv = mix(vec2(0.5), duv, 0.94);                    // slight zoom-in hides parallax edges
	if (!front) duv.x = 1.0 - duv.x;                   // rear: view mirrors as if seen through
	vec3 dest = texture(destination_view, clamp(duv, vec2(0.002), vec2(0.998))).rgb;

	// sculpted rim: bright lip, dark undercut, soft halo
	float rim = pow(1.0 - d, 2.4);
	float lip = smoothstep(0.0, 0.06, d) * smoothstep(0.22, 0.06, d);
	float undercut = smoothstep(0.08, 0.2, d) * smoothstep(0.38, 0.2, d);
	float core = smoothstep(0.12, 0.66, d);

	vec3 field = mix(deep_color.rgb, edge_color.rgb, clamp(pattern * 0.8 + rim * 0.8, 0.0, 1.0));
	field = mix(field, core_color.rgb, lip * 0.8);
	field *= 1.0 - undercut * 0.35;

	// veil: destination dominates the centre, energy field dominates the rim
	float see = view_strength * core * (front ? 1.0 : 0.82);
	see *= 0.85 + 0.15 * (1.0 - swell);
	vec3 col = mix(field, dest * (0.9 + 0.2 * pattern) + edge_color.rgb * 0.06, see);
	col += core_color.rgb * rim * 0.25 + edge_color.rgb * pattern * 0.12 * (1.0 - see);
	if (!front) col = mix(col, deep_color.rgb + edge_color.rgb * 0.3, 0.25);  // rear reads cooler/denser

	// entrance swell: centre brightens & clears; exit release: a single soft ring rim-ward then fade
	col += core_color.rgb * swell * core * 0.35;
	float ring_pos = 1.0 - release;
	float ring = exp(-pow((d - ring_pos) * 8.0, 2.0)) * (1.0 - release) * step(0.0001, release);
	col += core_color.rgb * ring * 1.2;

	float boost = energy * (1.0 + 0.6 * swell) + ring * 0.6;
	ALBEDO = col * mix(boost, 1.0, see * 0.6);          // keep destination colours near natural
	float a_base = opacity * (0.55 + 0.25 * pattern * (1.0 - see) + 0.35 * rim + lip * 0.3 + see * 0.35);
	a_base = mix(a_base, 0.94, see);
	ALPHA = clamp(a_base * clamp(energy, 0.0, 1.0) * (1.0 + 0.2 * swell) + ring * 0.4, 0.0, 1.0) * smoothstep(0.0, 0.03, d + 0.03);
}
