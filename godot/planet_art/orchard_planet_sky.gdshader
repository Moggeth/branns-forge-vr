shader_type sky;
// Planet-relative sky. "Up" is supplied by orchard_planet_art.gd (camera radial) instead of world Y.
// altitude01: 0 on the ground -> 1 high above the planet (stars fade in, horizon haze thins).
uniform vec3 planet_up = vec3(0.0, 1.0, 0.0);
uniform vec3 sun_dir = vec3(0.5, 0.7, 0.4);
uniform float altitude01 = 0.0;
uniform vec3 zenith_day : source_color = vec3(0.22, 0.46, 0.86);
uniform vec3 horizon_day : source_color = vec3(0.86, 0.84, 0.74);
uniform vec3 horizon_dusk : source_color = vec3(1.0, 0.56, 0.34);
uniform vec3 zenith_night : source_color = vec3(0.02, 0.03, 0.10);
uniform vec3 ground_haze : source_color = vec3(0.45, 0.50, 0.40);
uniform vec3 sun_col : source_color = vec3(1.0, 0.93, 0.78);
uniform float star_density = 0.985;

float hash13(vec3 p) {
	p = fract(p * 0.1031);
	p += dot(p, p.zyx + 31.32);
	return fract((p.x + p.y) * p.z);
}

void sky() {
	vec3 d = normalize(EYEDIR);
	vec3 up = normalize(planet_up);
	vec3 sd = normalize(sun_dir);
	float h = dot(d, up);
	float sun_elev = dot(up, sd);
	float day = smoothstep(-0.18, 0.25, sun_elev);
	float dusk = 1.0 - smoothstep(0.0, 0.3, abs(sun_elev + 0.03));
	float space = smoothstep(0.1, 0.9, altitude01);

	float haze = exp(-max(h, 0.0) * 4.5) * (1.0 - space * 0.9);
	vec3 zen = mix(zenith_night, zenith_day, day);
	vec3 hor = mix(zenith_night * 3.0, horizon_day, day);
	hor = mix(hor, horizon_dusk, dusk * 0.85 * (0.4 + 0.6 * pow(max(dot(d, sd), 0.0), 2.0)));
	vec3 col = mix(zen, hor, haze);
	col = mix(col, ground_haze * (0.15 + 0.85 * day), smoothstep(0.0, -0.25, h) * (1.0 - space));
	col = mix(col, vec3(0.005, 0.008, 0.02), space * 0.9);

	// sun: disc + warm aureole
	float sdot = max(dot(d, sd), 0.0);
	col += sun_col * (smoothstep(0.9993, 0.9997, sdot) * 3.0 + pow(sdot, 90.0) * 0.5 + pow(sdot, 6.0) * 0.12 * day);

	// stars: fade out by daylight, stronger in space
	float vis = clamp((1.0 - day) + space, 0.0, 1.0) * smoothstep(-0.02, 0.1, h + space);
	vec3 cell = floor(d * 140.0);
	float star = step(star_density, hash13(cell)) * smoothstep(0.7, 0.2, length(fract(d * 140.0) - 0.5));
	col += vec3(0.9, 0.95, 1.0) * star * vis * 1.2;
	COLOR = col;
}
