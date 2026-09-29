shader_type particles;
// Motes drift in from the front hemisphere of the aperture and are absorbed by the surface.
// Closed-form path, deterministic per particle; no collision, no trails, no sub-emitters.
// Use with GPUParticles3D: amount 12-24, lifetime = travel_time, explosiveness 0, local_coords true,
// draw_pass_1 = QuadMesh with portal_mote_draw.gdshader. Node sits on FX_MoteEmitter (aperture centre).

uniform float travel_time = 2.4;
uniform vec2 half_size = vec2(0.7, 1.1);   // aperture half width / half height
uniform float start_reach = 1.5;           // how far out (m) motes appear
uniform float energy : hint_range(0.0, 2.0) = 1.0;
uniform vec4 tint : source_color = vec4(1.0, 0.9, 0.6, 1.0);

float hash(uint x) {
	x = ((x >> 16u) ^ x) * 73244475u;
	x = ((x >> 16u) ^ x) * 73244475u;
	x = (x >> 16u) ^ x;
	return float(x) / 4294967295.0;
}

void start() {
	uint s = RANDOM_SEED;
	CUSTOM = vec4(hash(s), hash(s + 1u), hash(s + 2u), 0.0);  // x,y,z: per-mote random, w: age 0..1
	CUSTOM.w = hash(s + 3u) * 0.0;
	ACTIVE = true;
	COLOR = tint;
}

void process() {
	CUSTOM.w += DELTA / max(LIFETIME, 0.001);
	float t = clamp(CUSTOM.w, 0.0, 1.0);
	float e = t * t * (3.0 - 2.0 * t);

	float ang = CUSTOM.x * 6.2831853 + t * 2.4;             // gentle swirl on the way in
	float rr = mix(0.55, 1.0, CUSTOM.y);
	vec3 s0 = vec3(cos(ang) * half_size.x * 1.15 * rr, sin(ang) * half_size.y * 0.9 * rr, start_reach * mix(0.35, 1.0, CUSTOM.z));
	vec3 s1 = vec3(cos(ang + 1.5) * 0.06, sin(ang + 1.5) * 0.06, 0.0);
	vec3 pos = mix(s0, s1, e);
	pos.y += 0.05 * sin(TIME * 2.0 + CUSTOM.x * 20.0) * (1.0 - e);

	TRANSFORM = mat4(vec4(1, 0, 0, 0), vec4(0, 1, 0, 0), vec4(0, 0, 1, 0), vec4(pos, 1));
	float fade = smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.75, 1.0, t));
	float size = (0.6 + 0.6 * CUSTOM.z) * mix(1.0, 0.35, e);
	TRANSFORM[0][0] = size; TRANSFORM[1][1] = size; TRANSFORM[2][2] = size;
	COLOR = vec4(tint.rgb * energy, fade * energy);
	if (t >= 1.0) { ACTIVE = false; }
}
