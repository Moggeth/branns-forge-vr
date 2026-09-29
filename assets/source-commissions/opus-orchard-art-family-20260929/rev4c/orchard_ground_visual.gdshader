// Brann's Forge VR - Orchard ground, rev-4 art-family pass 2026-09-29 (claude-opus-5-5).
// rev-4 summary: lifted turf ignores the authored "disturbed" mask alpha + slope soil (the real cause of
// the brown Raise disc), Raise tear = narrow intermittent foot rim + few rim cracks, Sunder strata warped
// and chipped into blocks, worn-mask areas read as dry trampled grass with scuffs, not paint.
// Drop-in: keeps EVERY uniform name/binding (grass_tex, soil_tex, micro_normal, macro_mask, exposure_tex,
// rain_wetness, snow_cover, palette uniforms, mask_origin_x). exposure_tex contract is unchanged
// (orchard_ground.gd apply_exposure_delta: r = fresh 0..1, g = cut depth / 4 m, b = heap / 2 m, 320 m @ 1 m/texel).
//
// Faults seen in real-game captures and fixed here:
//  * Raise painted a huge uniform dark disc: r goes to 1 for any change > 16 cm, and the old shader
//    turned all of r into soil. Now a heap keeps its turf; soil shows only where the ground was
//    STRETCHED (gradient of the heap, from 4 offset taps): a narrow torn stress seam on the shoulder,
//    tension cracks around it, a few fresh-stone outcrops at the crest.
//  * Sunder: dark trench + equally dark wide margin. Shallow (< ~0.3 m) change is now trampled/
//    disturbed turf with clods; bare soil starts at real depth. Walls get genuine strata keyed to
//    depth BELOW THE ORIGINAL SURFACE (cut_m), so the bands follow the actual cut from any view.
//    Floors get loose fallen topsoil and gravel instead of one flat colour.
//  * 1 m exposure texels showed as squares/patches: exposure UV is noise-warped by ~0.7 m and
//    thresholds are eroded by fine noise.
//  * Broad flat green fields: macro value/hue drift at 3 scales, aspect-based moisture (shaded
//    slopes cooler/lusher), clover/dry-tip clumps, near-field tuft breakup, roughness variation.
// Mobile renderer: opaque, 7 texture reads baseline (+4 exposure taps only inside disturbed ground).
shader_type spatial;
render_mode cull_back, diffuse_lambert, specular_schlick_ggx;

uniform sampler2D grass_tex : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D soil_tex : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D micro_normal : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D macro_mask : repeat_disable, filter_linear;   // r=path/exposed, g=leaf litter, b=damp/bank, a=disturbed
uniform sampler2D exposure_tex : hint_default_black, repeat_disable, filter_linear;
uniform float rain_wetness = 0.0;
uniform float snow_cover = 0.0;

uniform vec3 grass_cool : source_color = vec3(0.25, 0.42, 0.21);
uniform vec3 grass_lush : source_color = vec3(0.37, 0.54, 0.19);
uniform vec3 grass_warm : source_color = vec3(0.58, 0.60, 0.26);
uniform vec3 meadow_dry : source_color = vec3(0.64, 0.58, 0.34);
uniform vec3 soil_col   : source_color = vec3(0.40, 0.28, 0.18);
uniform vec3 soil_dark  : source_color = vec3(0.22, 0.15, 0.10);
uniform vec3 bank_wet   : source_color = vec3(0.21, 0.18, 0.13);
uniform vec3 rock_mid   : source_color = vec3(0.55, 0.51, 0.47);
uniform vec3 rock_warm  : source_color = vec3(0.60, 0.51, 0.42);
uniform vec3 rock_band  : source_color = vec3(0.48, 0.45, 0.46);
uniform vec3 rock_fresh : source_color = vec3(0.50, 0.46, 0.41);
uniform vec3 gravel_col : source_color = vec3(0.47, 0.43, 0.36);
uniform vec3 clay_col   : source_color = vec3(0.52, 0.38, 0.24);
uniform float texture_strength = 0.85;
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
	float a = 0.5, s = 0.0;
	mat2 r = mat2(vec2(0.8, 0.6), vec2(-0.6, 0.8));
	for (int i = 0; i < 3; i++) { s += a * noise2(p); p = r * p * 2.03 + 11.7; a *= 0.5; }
	return s / 0.875;
}
// cellular edge distance (cracks / clods): x = F2-F1 (0 on a crack), y = cell id
vec2 cells(vec2 p) {
	vec2 i = floor(p), f = fract(p); float d1 = 8.0, d2 = 8.0; float id = 0.0;
	for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
		vec2 o = vec2(float(x), float(y));
		float h = hash21(i + o);
		vec2 c = o + vec2(h, hash21(i + o + 5.3)) * 0.85 + 0.075;
		float d = length(f - c);
		if (d < d1) { d2 = d1; d1 = d; id = h; } else if (d < d2) { d2 = d; }
	}
	return vec2(d2 - d1, id);
}
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
	// rev-4b: heightfield meshes carry no TANGENT array, so NORMAL_MAP lit each facet with an
	// undefined frame -> hard triangular light/dark tints. Build a stable +X-aligned frame here.
	vec3 t = vec3(1.0, 0.0, 0.0) - NORMAL * NORMAL.x;
	TANGENT = normalize(length(t) > 0.01 ? t : vec3(0.0, 0.0, 1.0));
	BINORMAL = normalize(cross(NORMAL, TANGENT)) * -1.0;
}

void fragment() {
	vec2 uv = clamp((at + vec2(160.0)) / 320.0, vec2(0.0), vec2(1.0));
	vec4 m = texture(macro_mask, uv);

	vec2 warp = vec2(noise2(at * 0.045), noise2(at * 0.045 + 5.2)) * 9.0;
	vec2 wp = at + warp;
	float broad = fbm(wp * 0.006 + 2.0);
	float regional = fbm(wp * 0.018);
	float meander = fbm(wp * 0.07 + 3.0);
	float fine = fbm(at * 0.55);
	// rev-4b: view distance, NOT fwidth(at). Screen derivatives of world xz differ per terrain triangle
	// (each facet has its own plane), so the old fade jumped at triangle edges -> the hard yellow/olive
	// triangular tints seen in real tactical captures 00/03/06 and in preview iter1.
	float dist_fade = 1.0 - smoothstep(12.0, 40.0, length(VERTEX));   // 1 near the viewer

	vec3 nw = normalize(world_n);
	float slope = 1.0 - clamp(nw.y, 0.0, 1.0);
	float slope_soft = smoothstep(0.08, 0.55, slope + (meander - 0.5) * 0.10);
	float aspect = dot(nw.xz, normalize(vec2(-0.55, 0.83))) * smoothstep(0.03, 0.25, slope); // + = shaded side

	// --- textured meadow with macro/micro breakup
	vec3 gt = tex_detail(grass_tex, at, 0.23);
	vec3 g = mix(grass_cool, grass_lush, smoothstep(0.25, 0.75, regional));
	g = mix(g, grass_warm, smoothstep(0.5, 0.85, meander) * 0.6);
	g = mix(g, meadow_dry, smoothstep(0.55, 0.85, broad) * 0.5 + smoothstep(0.1, 0.4, -aspect) * 0.07);   // rev-3: halved, vertex-normal aspect showed triangles
	g = mix(g, grass_cool * 0.85, smoothstep(0.1, 0.5, aspect) * 0.16);            // moist shaded slopes
	g *= mix(0.84, 1.1, broad);                                                     // field-scale value drift
	g *= mix(1.0, luma(gt) * 2.2, texture_strength);
	g = mix(g, g * (gt / max(luma(gt), 0.05)), 0.25 * texture_strength);
	g *= mix(0.86, 1.10, fine);
	// clumps from smooth noise only (rev-2: cell-id patches drew hard yellow polygons)
	float clump = noise2(at * 0.9 + warp * 0.1) * 0.6 + noise2(at * 2.1) * 0.4;
	g *= mix(0.86, 1.06, clump);                                                    // clover / tussock clumps
	g = mix(g, meadow_dry * 0.9, smoothstep(0.66, 0.86, fbm(wp * 0.11 + 7.0)) * 0.3); // soft dry seed-head drifts
	g *= mix(1.0, 0.86 + 0.24 * noise2(at * 4.3), dist_fade * 0.8);                  // near-field tufts

	vec3 st = tex_detail(soil_tex, at, 0.31);
	vec3 s = mix(soil_col, soil_dark, slope_soft * 0.6 + fine * 0.2);
	s *= mix(1.0, luma(st) * 2.2, texture_strength);

	// rev-4: exposure is read BEFORE the base soil mix. Real-game capture 05/06 fault: the authored
	// orchard_masks.png carries broad soft alpha "disturbed" blobs (14 % of the map, up to 0.93) and
	// m.a*0.5 + slope_soft*0.45 turned any Raise flank that landed on a blob into one flat brown disc.
	// (The isolated preview used a synthetic mask with a = 0, so it looked green there.)
	// Lifted turf (heap > ~10 cm) now suppresses mask/slope soil completely; the rim shader below draws
	// the only bare earth on a heap.
	vec2 euv = uv + (vec2(noise2(at * 0.9), noise2(at * 0.9 + 7.1)) - 0.5) * (1.4 / 320.0);  // hide texels
	vec4 ex = texture(exposure_tex, euv);
	float lifted = smoothstep(0.03, 0.12, ex.b) * step(0.004, ex.r);

	float edge_n = (fine - 0.5) * 0.35 + (noise2(at * 1.7) - 0.5) * 0.15;
	float leaf = m.g * (0.35 + 0.3 * meander);
	// disturbed mask = worn, drier grass with only a few broken bare scuffs in its core, never a paint disc
	float scuff = smoothstep(0.62, 0.82, noise2(at * 0.42 + 3.3) * 0.7 + noise2(at * 1.9) * 0.3);
	float worn = m.a * (1.0 - lifted);
	g = mix(g, mix(meadow_dry, grass_warm, 0.5) * 0.9, smoothstep(0.1, 0.8, worn) * 0.35);
	float steep = smoothstep(0.30, 0.55, slope + edge_n * 0.3) * (1.0 - lifted);   // only real banks go bare
	// rev-4c: RAISED PATH. Real rev4b captures 04 vs 06: the brown band is the authored path (m.r),
	// present before the Raise; the heap lifted it and m.r*0.9 kept painting an unbroken road over the
	// hill. Inside lifted ground the tread now fractures into tilted compacted slabs with open joints,
	// fewer and smaller with height (heap B + noise), and the lost tread becomes turf that rolled over it
	// plus a few fresh-earth/stone rubble pockets. Outside the heap the path is untouched.
	float path = m.r;
	float path_lift = 0.0, path_keep = 1.0, path_joint = 0.0, path_rubble = 0.0;
	vec2 pc = vec2(1.0, 1.0);
	if (lifted > 0.0 && path > 0.03) {
		path_lift = smoothstep(0.12, 0.9, ex.b * 2.0 + (noise2(at * 0.6 + 2.0) - 0.5) * 0.35) * lifted;
		pc = cells(at * vec2(0.48, 0.6) + warp * 0.08);                         // ~2 m tread slabs
		float survive = step(mix(-0.1, 0.5, path_lift), pc.y);                  // higher -> fewer slabs (rev-4c tuned: ~half survive at full lift)
		float slab = survive * smoothstep(0.06, 0.16, pc.x + (fine - 0.5) * 0.06); // open joints between slabs
		path_keep = mix(1.0, slab, path_lift);
		path_joint = path * path_lift * survive * smoothstep(0.07, 0.02, pc.x);  // dark torn joint lines
		float lost = path * path_lift * (1.0 - survive);
		path_rubble = lost * smoothstep(0.48, 0.72, noise2(at * 1.4 + 5.0) * 0.7 + noise2(at * 4.1) * 0.3);
	}
	float soil_amt = clamp(path * path_keep * 0.9 + worn * scuff * 0.7 + leaf * 0.35 + steep * 0.6 + edge_n, 0.0, 1.0);
	soil_amt = smoothstep(0.3, 0.75, soil_amt);
	vec3 colour = mix(g, s, soil_amt);
	if (path_lift > 0.0) {
		// slabs: tilted tread catches light unevenly (per-slab value), turf that rolled over the lost
		// tread is a touch drier, joints/rubble are fresh dark earth with pale stone chips
		colour *= mix(1.0, mix(0.82, 1.1, pc.y), path * path_keep * path_lift);
		colour = mix(colour, colour * vec3(1.04, 1.0, 0.86), path * (1.0 - path_keep) * 0.5);
		vec3 fresh_earth = mix(soil_dark, clay_col * 0.85, smoothstep(0.4, 0.8, noise2(at * 2.3))) * mix(1.0, luma(st) * 2.2, 0.8);
		fresh_earth = mix(fresh_earth, rock_fresh * mix(0.8, 1.05, fine), smoothstep(0.7, 0.85, noise2(at * 3.7 + 1.0)) * 0.5);
		colour = mix(colour, soil_dark * 0.8, clamp(path_joint, 0.0, 1.0) * 0.85);
		colour = mix(colour, fresh_earth, clamp(path_rubble, 0.0, 1.0));
	}
	colour = mix(colour, vec3(0.36, 0.30, 0.17) * (0.8 + 0.5 * fine), leaf * 0.25);

	float wy = world_y + (meander - 0.5) * 1.6 + at.x * 0.06;
	float band = sin(wy * strata_scale) + 0.45 * sin(wy * 5.1 + fine * 2.0);
	vec3 rock = mix(mix(rock_mid, rock_warm, 0.5 + 0.3 * band), rock_band, smoothstep(0.6, 0.95, sin(wy * 1.3)) * 0.6);
	rock *= mix(1.0, luma(st) * 2.0, 0.6);
	float rockiness = smoothstep(0.50, 0.75, slope + edge_n * 0.5) * (1.0 - lifted * 0.85);
	colour = mix(colour, rock, rockiness);

	// --- EXPOSURE -------------------------------------------------------------------------------
	float fresh = 0.0;
	float wall_amt = 0.0;
	if (ex.r > 0.004) {
		float o = 1.5 / 320.0;
		vec4 ex_l = texture(exposure_tex, euv - vec2(o, 0.0));
		vec4 ex_r = texture(exposure_tex, euv + vec2(o, 0.0));
		vec4 ex_d = texture(exposure_tex, euv - vec2(0.0, o));
		vec4 ex_u = texture(exposure_tex, euv + vec2(0.0, o));
		float cut_m = ex.g * 4.0;
		float heap_m = ex.b * 2.0;
		float cut_grad = length(vec2(ex_r.g - ex_l.g, ex_u.g - ex_d.g)) * 4.0 / 3.0;    // m per m
		float heap_grad = length(vec2(ex_r.b - ex_l.b, ex_u.b - ex_d.b)) * 2.0 / 3.0;
		float n1 = noise2(at * 2.3), n2 = noise2(at * 0.8 + 4.0);

		// 1) disturbed turf everywhere the ground moved: flattened, browner grass, scattered clods
		float moved = ex.r * (1.0 - lifted) * (1.0 - smoothstep(0.02, 0.2, ex.g) * 0.3); // heaved turf stays green (rev-4)
		vec2 cl = cells(at * 2.6);
		// rev-4b: FILLED sparse clods (cell interior), not F2-F1 edge lines (those drew a crack net)
		float clods = smoothstep(0.1, 0.22, cl.x) * step(0.86, cl.y) * moved;
		vec3 trampled = mix(colour, mix(colour, soil_col, 0.3) * 0.88, moved * 0.3);
		trampled = mix(trampled, mix(soil_dark, soil_col, cl.y) * mix(1.0, luma(st) * 2.2, 0.8), clods * 0.8);
		colour = trampled;

		// 2) SUNDER cut: bare ground only where really deep or on walls; strata by depth below original
		float bare_cut = smoothstep(0.22, 0.5, cut_m + (n1 - 0.5) * 0.3) + smoothstep(0.25, 0.6, cut_grad);
		bare_cut = clamp(bare_cut, 0.0, 1.0) * ex.r;
		// rev-4: strata are warped at three scales along the wall (layers pinch, thicken and dip) and
		// broken into chipped blocks so the cut no longer reads as one regular stripe panel.
		vec2 blk = cells(at * vec2(0.55, 0.9) + vec2(world_y * 0.4, 0.0));
		float pinch = (noise2(at * 0.21 + 1.7) - 0.5) * 0.9 + (noise2(at * 0.07) - 0.5) * 0.8;
		float dz = cut_m * mix(0.75, 1.3, noise2(at * 0.33)) + pinch + (fine - 0.5) * 0.25 + (blk.y - 0.5) * 0.35;
		vec3 strata = mix(vec3(0.20, 0.16, 0.10), soil_dark, smoothstep(0.02, 0.12, dz));       // root mat
		strata = mix(strata, soil_col * 1.05, smoothstep(0.42, 0.52, dz));                         // subsoil
		strata = mix(strata, gravel_col * mix(0.7, 1.05, n1), smoothstep(0.95, 1.05, dz));         // gravel lens
		strata = mix(strata, clay_col, smoothstep(1.3, 1.42, dz));                                  // clay
		strata = mix(strata, mix(rock_fresh, rock_band * 0.8, 0.5 + 0.4 * sin(wy * strata_scale * 1.3 + fine * 3.0)),
			smoothstep(2.1, 2.3, dz));                                                               // bedrock
		strata *= mix(1.0, luma(st) * 2.2, 0.85);
		strata *= mix(0.78, 1.08, blk.y) * mix(0.7, 1.0, smoothstep(0.0, 0.06, blk.x));   // chipped joints + block value
		wall_amt = smoothstep(0.35, 0.9, cut_grad) * ex.r;
		// floor: loose fallen topsoil/rubble on flat low ground (keeps floor darker, not one colour)
		float floor_amt = (1.0 - wall_amt) * smoothstep(0.4, 0.8, cut_m);
		vec3 loose = mix(soil_dark * 0.95, soil_col * 0.8, cl.y * 0.6) * mix(1.0, luma(st) * 2.2, 0.9);
		loose = mix(loose, gravel_col * mix(0.55, 1.0, n1), smoothstep(0.08, 0.2, cl.x) * step(0.7, cl.y) * 0.8);   // filled gravel pieces
		vec3 cut_col = mix(strata, loose, floor_amt * 0.7);
		colour = mix(colour, cut_col, bare_cut);

		// 3) RAISE heap: turf rides up intact; stretch tears a narrow seam + tension cracks
		// rev-2: the seam is ONE narrow contour on the lower shoulder (0.55-0.95 m of heave, wobbling),
		// only where the heave is steep; the rest of the flank keeps its turf with sparse cracks.
		// rev-4 (real capture 05/06: full dark ring + dense crack mesh). The tear is now the FOOT RIM only,
		// 0.08-0.45 m of heave (~0.5-1 m wide on a real flank), intermittent along its length via a
		// stretched noise so it reads as torn sod lips with intact grass bridges, never a closed ring.
		float stretch = heap_grad + (n1 - 0.5) * 0.12;
		float contour = heap_m + (n2 - 0.5) * 0.14 + (fine - 0.5) * 0.10;
		float along = noise2(at * 0.55 + warp * 0.12) * 0.75 + noise2(at * 2.2) * 0.25;   // breaks the rim into runs
		float seam = smoothstep(0.07, 0.14, contour) * smoothstep(0.48, 0.30, contour) * smoothstep(0.16, 0.30, stretch)
			* smoothstep(0.36, 0.52, along);
		// lifted sod edge: thin bright-ish turf lip right above the tear (catches light, reads as a torn edge)
		float lip = smoothstep(0.42, 0.50, contour) * smoothstep(0.66, 0.52, contour) * smoothstep(0.40, 0.55, along) * smoothstep(0.16, 0.3, stretch);
		// only a few short tension cracks hugging the rim, on a coarse lattice (no crack net over the mound)
		vec2 crack = cells(at * vec2(0.9, 1.3) + warp * 0.2);
		float near_seam = smoothstep(0.1, 0.4, contour) * smoothstep(1.1, 0.6, contour);
		float cracks = smoothstep(0.03, 0.008, crack.x) * near_seam * smoothstep(0.2, 0.35, stretch) * ex.r * step(0.78, crack.y)
			* smoothstep(0.45, 0.6, along);
		float crest = smoothstep(0.85, 0.98, ex.b) * smoothstep(0.1, 0.02, heap_grad);
		float outcrop = crest * smoothstep(0.84, 0.92, noise2(at * 0.9 + 9.0));
		vec3 torn = mix(soil_dark, clay_col * 0.8, smoothstep(0.55, 0.8, n1)) * mix(1.0, luma(st) * 2.2, 0.85);
		torn = mix(torn, rock_fresh * mix(0.85, 1.1, n2), smoothstep(0.72, 0.85, noise2(at * 3.3)) * 0.3);  // sparse rock chips in the seam (rev-3)
		colour = mix(colour, colour * vec3(1.08, 1.1, 0.92), lip * ex.r * 0.6);
		colour = mix(colour, soil_dark * 0.85 * mix(1.0, luma(st) * 2.2, 0.8), cracks * 0.7);
		colour = mix(colour, torn, clamp(seam * ex.r, 0.0, 1.0));
		colour = mix(colour, mix(rock_fresh, rock_mid, n2) * mix(1.0, luma(st) * 2.0, 0.6), outcrop);
		fresh = clamp(bare_cut + seam * ex.r + cracks * 0.5 + outcrop, 0.0, 1.0);
	}

	// --- riverbank: damp soil fading into gravel shelf near the water
	float bank = smoothstep(0.30, 0.85, m.b + edge_n * 0.4);
	vec2 pb = cells(at * 1.7);
	vec3 shelf = mix(bank_wet, gravel_col * mix(0.55, 1.05, pb.y), smoothstep(0.6, 0.95, m.b) * smoothstep(0.02, 0.12, pb.x + 0.05));
	shelf *= mix(1.0, luma(st) * 2.0, 0.7);
	colour = mix(colour, shelf, bank * 0.85);

	float damp = clamp(max(bank * 0.8, rain_wetness) + m.g * rain_wetness * 0.18 + fresh * 0.25, 0.0, 1.0);
	colour *= 1.0 - damp * 0.24;
	float puddle = smoothstep(0.70, 0.92, m.b * 0.55 + rain_wetness * 0.58 + meander * 0.14) * (1.0 - rockiness);
	float snow = snow_cover * smoothstep(0.2, 0.6, snow_cover * 0.8 + fine * 0.4 - slope * 0.6);
	colour = mix(colour, vec3(0.89, 0.93, 0.94) * mix(0.92, 1.02, fine), snow);

	ALBEDO = colour;
	float rough_var = mix(0.9, 1.0, noise2(at * 1.3));
	ROUGHNESS = mix((0.95 - rockiness * 0.1 - fresh * 0.08) * rough_var, 0.66, damp * 0.8);
	ROUGHNESS = mix(ROUGHNESS, 0.35, puddle * 0.85);
	ROUGHNESS = mix(ROUGHNESS, 0.82, snow);
	SPECULAR = mix(0.30, 0.45, damp) * (1.0 - snow * 0.3);
	vec3 nm = mix(texture(micro_normal, at * 0.28).rgb, texture(micro_normal, at * 1.1 + 0.5).rgb, 0.4);
	NORMAL_MAP = nm;
	NORMAL_MAP_DEPTH = mix(0.6 + rockiness * 0.4 + fresh * 0.5 + wall_amt * 0.4, 0.08, snow);
}
