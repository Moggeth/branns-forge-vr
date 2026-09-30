shader_type canvas_item;
render_mode blend_mix;
// Tidal Glass mana orb. One ColorRect covers the orb's inner glass square.
// Fully procedural (hash value-noise) so there is no texture dependency and the
// result is deterministic. ~3 fbm-lite lookups + one mote grid per pixel; cheap at 140x140.

uniform float fill : hint_range(0.0, 1.0) = 0.65;        // smoothed liquid fraction
uniform float cost_frac : hint_range(0.0, 1.0) = 0.0;    // selected spell cost / max
uniform float afford : hint_range(0.0, 1.0) = 1.0;       // 1 = affordable
uniform float gain_pulse : hint_range(0.0, 1.0) = 0.0;   // recharge shimmer, decays in script
uniform float spend_pulse : hint_range(0.0, 1.0) = 0.0;  // spend ripple, decays in script
uniform vec4 deep_color : source_color = vec4(0.045, 0.030, 0.200, 1.0);
uniform vec4 body_color : source_color = vec4(0.300, 0.150, 0.720, 1.0);
uniform vec4 tide_color : source_color = vec4(0.200, 0.700, 0.880, 1.0);
uniform vec4 empty_color : source_color = vec4(0.018, 0.020, 0.048, 1.0);

float hash21(vec2 p) {
	p = fract(p * vec2(123.34, 456.21));
	p += dot(p, p + 45.32);
	return fract(p.x * p.y);
}

float vnoise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	float a = hash21(i);
	float b = hash21(i + vec2(1.0, 0.0));
	float c = hash21(i + vec2(0.0, 1.0));
	float d = hash21(i + vec2(1.0, 1.0));
	return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float ridge(vec2 p) {
	return 1.0 - abs(vnoise(p) * 2.0 - 1.0);
}

// wave height offset of the liquid surface at horizontal position x (unit disc space)
float surface_wave(float x, float amp, float t) {
	return (sin(x * 2.3 + t * 0.55) * 0.030 + sin(x * 4.6 - t * 0.38 + 1.7) * 0.014 + sin(x * 1.1 + t * 0.21) * 0.020) * amp;
}

void fragment() {
	vec2 p = (UV - 0.5) * 2.0;          // -1..1, y down
	float r = length(p);
	float px = fwidth(r);
	float disc = 1.0 - smoothstep(1.0 - px * 1.5, 1.0, r);
	float t = TIME;

	// --- surface -----------------------------------------------------------
	float f = clamp(fill, 0.0, 1.0);
	float amp = smoothstep(0.0, 0.10, f) * (1.0 - smoothstep(0.90, 0.99, f));   // calm when nearly empty / brimming
	amp *= 1.0 + spend_pulse * 1.6 + gain_pulse * 0.6;
	float level = 1.0 - 2.0 * f;                                                 // surface y in disc space
	float sy = level + surface_wave(p.x, amp, t);
	float depth = p.y - sy;                                                      // >0 below the surface
	float liquid = smoothstep(-px * 1.5, px * 1.5, depth) * step(0.001, f);
	if (f > 0.995) liquid = 1.0;

	// --- circulating, domain-warped flow -----------------------------------
	float ang = t * 0.045 * (1.15 - r * 0.6);
	mat2 rot = mat2(vec2(cos(ang), -sin(ang)), vec2(sin(ang), cos(ang)));
	vec2 q = rot * p;
	vec2 warp = vec2(vnoise(q * 1.7 + vec2(t * 0.05, 3.1)), vnoise(q * 1.7 + vec2(8.2, -t * 0.04))) - 0.5;
	vec2 q2 = q + warp * 0.85;

	float body_n = vnoise(q2 * 2.1 + vec2(0.0, t * 0.03));
	float caustic = pow(ridge(q2 * 2.6 + vec2(t * 0.06, -t * 0.03)), 7.0);
	caustic += 0.7 * pow(ridge(q2 * 4.4 + vec2(-t * 0.05, t * 0.045) + 5.0), 9.0);
	float wisp = smoothstep(0.55, 0.85, vnoise(q2 * 1.3 + vec2(t * 0.02, 9.0)));

	// --- liquid colour -----------------------------------------------------
	float dn = clamp((p.y - level) / max(1.0 + (1.0 - level) * 0.5, 0.2), 0.0, 1.0);   // 0 at surface, 1 deep
	vec3 col = mix(body_color.rgb, deep_color.rgb, smoothstep(0.0, 0.95, dn));
	col *= 0.80 + 0.45 * body_n;
	col += tide_color.rgb * caustic * 0.58 * (1.0 - dn * 0.45);
	col += mix(body_color.rgb, tide_color.rgb, 0.5) * wisp * 0.22;
	// subsurface glow just under the meniscus
	col += tide_color.rgb * exp(-max(depth, 0.0) * 9.0) * 0.20;

	// sparse motes: one hashed candidate per grid cell, slow upward drift
	vec2 mp = q2 * 9.0 + vec2(0.0, t * 0.18);
	vec2 cell = floor(mp);
	float h = hash21(cell);
	if (h > 0.90) {
		vec2 cpos = vec2(hash21(cell + 3.7), hash21(cell + 9.1)) * 0.6 + 0.2;
		float d = length(fract(mp) - cpos);
		float tw = 0.5 + 0.5 * sin(t * 0.7 + h * 60.0);
		col += vec3(0.65, 0.85, 1.0) * smoothstep(0.16, 0.0, d) * tw * 0.42;
	}

	// selected-spell cost marker: thin line + faint band, never a pie slice
	if (cost_frac > 0.001 && f > 0.001) {
		float mf = afford > 0.5 ? max(f - cost_frac, 0.0) : min(cost_frac, 1.0);
		float my = 1.0 - 2.0 * mf + surface_wave(p.x, amp, t) * 0.6;
		vec3 mc = afford > 0.5 ? vec3(1.0, 0.82, 0.48) : vec3(1.0, 0.36, 0.28);
		float line = 1.0 - smoothstep(0.004, 0.014 + px, abs(p.y - my));
		float breathe = 0.85 + 0.15 * sin(t * 1.8);
		col = mix(col, mc, line * 0.32 * breathe);
		if (afford > 0.5) col += mc * step(sy, p.y) * step(p.y, my) * 0.05;
	}

	// meniscus line + body pulse
	float men = 1.0 - smoothstep(0.0, 0.022 + px * 1.5, abs(depth));
	col += mix(tide_color.rgb, vec3(1.0), 0.45) * men * (0.55 + 0.35 * gain_pulse);
	col += vec3(0.25, 0.75, 1.0) * gain_pulse * 0.10 * (1.0 - dn);
	col += vec3(1.0, 0.85, 0.6) * spend_pulse * men * 0.35;
	float ring_r = (1.0 - gain_pulse) * 1.05;
	col += tide_color.rgb * gain_pulse * 0.22 * (1.0 - smoothstep(0.0, 0.10, abs(r - ring_r))) * liquid * step(0.0001, gain_pulse);

	// --- empty glass: much darker, faint wisps only -------------------------
	vec3 ecol = empty_color.rgb + vec3(0.02, 0.025, 0.06) * wisp * (0.5 + 0.5 * body_n) + body_color.rgb * 0.02 * caustic;
	vec3 base = mix(ecol, col, liquid);

	// --- glass: rim, refraction darkening, highlights ------------------------
	float rim = smoothstep(0.72, 1.0, r);
	base = mix(base, base * 0.45 + vec3(0.02, 0.03, 0.08), rim * 0.65);
	base += vec3(0.10, 0.16, 0.30) * pow(rim, 3.0) * 0.55;
	// window-like crescent, upper left
	float a = atan(p.y, p.x);
	float arc_mask = smoothstep(-2.65, -2.35, a) * (1.0 - smoothstep(-1.55, -1.25, a));
	float arc_ring = 1.0 - smoothstep(0.0, 0.045, abs(r - 0.865));
	base += vec3(0.85, 0.92, 1.0) * arc_ring * arc_mask * 0.30;
	float gloss = 1.0 - smoothstep(0.0, 0.42, length((p - vec2(-0.34, -0.46)) * vec2(1.0, 1.7)));
	base += vec3(0.55, 0.65, 0.9) * gloss * 0.10;
	float spec = 1.0 - smoothstep(0.0, 0.055, length((p - vec2(-0.47, -0.55)) * vec2(1.0, 1.25)));
	base += vec3(1.0) * spec * 0.22;

	// legibility scrim under the numerals; darkens liquid, not the glass rim
	float scrim = 1.0 - smoothstep(0.0, 1.0, length((p - vec2(0.0, 0.10)) / vec2(0.70, 0.42)));
	base *= 1.0 - scrim * 0.42;

	COLOR = vec4(base, disc);
}
