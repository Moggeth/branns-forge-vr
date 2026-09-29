shader_type spatial;
// Portal energy surface. Mesh contract (Surface_Near / Surface_Far in the GLBs):
//   COLOR.r = 0 at the aperture rim, 1 at the centre (works for any aperture outline)
//   UV      = aperture-space 0..1, centre 0.5
// One cheap pass: no depth/screen textures, no lights, alpha blend, never writes depth.
render_mode blend_mix, depth_draw_never, cull_disabled, unshaded, fog_disabled;

uniform vec4 edge_color : source_color = vec4(0.94, 0.78, 0.42, 1.0);
uniform vec4 core_color : source_color = vec4(1.0, 0.95, 0.8, 1.0);
uniform vec4 deep_color : source_color = vec4(0.25, 0.14, 0.05, 1.0);
uniform float energy : hint_range(0.0, 3.0) = 1.0;      // overall brightness (0 = dormant)
uniform float opacity : hint_range(0.0, 1.0) = 0.82;
uniform float swirl_speed = 0.35;
uniform float swirl_twist = 2.2;
uniform float arms = 3.0;
uniform float time_offset = 0.0;                        // set per portal so neighbours do not pulse in sync
uniform float swell : hint_range(0.0, 1.0) = 0.0;       // entrance swell: surface bulges toward the player and brightens
uniform float swell_bulge = 0.16;
uniform float release : hint_range(0.0, 1.0) = 0.0;     // exit release: 0->1 expanding ring, 1 = finished
uniform float lod_detail : hint_range(0.0, 1.0) = 1.0;  // 1 near (2-octave noise), 0 far (analytic pattern only)

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

void vertex() {
	v_depth = COLOR.r;
	// centre of the surface pushes toward +Z (the side the player approaches from)
	VERTEX.z += swell * swell_bulge * smoothstep(0.0, 1.0, COLOR.r);
}

void fragment() {
	float t = TIME + time_offset;
	vec2 p = (UV - vec2(0.5)) * 2.0;
	float r = length(p);
	float a = atan(p.y, p.x);
	float d = clamp(v_depth, 0.0, 1.0);

	// inward-flowing spiral: bands travel toward the centre and the twist tightens there
	float twist = a + swirl_twist * (1.0 - r) + t * swirl_speed * 2.0;
	float bands = 0.5 + 0.5 * sin(twist * arms + r * 7.0 + t * swirl_speed * 6.0);
	float grain = 0.5;
	if (lod_detail > 0.5) {
		vec2 q = vec2(cos(twist), sin(twist)) * r * 2.4;
		grain = vnoise(q * 2.5 + vec2(0.0, t * 0.4)) * 0.65 + vnoise(q * 5.0 - vec2(t * 0.3, 0.0)) * 0.35;
	}
	float pattern = mix(bands, grain, 0.45 * lod_detail);

	// rim glow follows the aperture outline through COLOR.r; centre stays soft so the view beyond reads through
	float rim = pow(1.0 - d, 2.2);
	float halo = smoothstep(0.0, 0.25, 1.0 - d) * 0.6;
	float core = smoothstep(0.55, 1.0, d);

	vec3 col = mix(deep_color.rgb, edge_color.rgb, clamp(pattern * 0.9 + rim, 0.0, 1.0));
	col = mix(col, core_color.rgb, core * (0.35 + 0.25 * pattern) + rim * 0.25);

	// exit release: a bright ring sweeps from centre to rim then fades
	float ring_pos = 1.0 - release;                     // in "depth" space: 1 centre -> 0 rim
	float ring = exp(-pow((d - ring_pos) * 9.0, 2.0)) * (1.0 - release) * step(0.0001, release);
	col += core_color.rgb * ring * 1.6;

	float a_base = opacity * (0.62 + 0.3 * pattern + halo + 0.3 * rim);
	float boost = energy * (1.0 + 0.8 * swell) + ring;
	ALBEDO = col * boost;
	ALPHA = clamp(a_base * clamp(energy, 0.0, 1.0) * (1.0 + 0.25 * swell) + ring * 0.5, 0.0, 1.0);
}
