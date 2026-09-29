shader_type spatial;
// Short pressure ripple: thin travelling fresnel band, not a filled glass dome.
render_mode unshaded, blend_add, cull_disabled, depth_draw_never, fog_disabled;

instance uniform float progress : hint_range(0.0, 1.0) = 0.0;
uniform vec4 hot_color : source_color = vec4(1.0, 0.62, 0.24, 1.0);
uniform vec4 cool_color : source_color = vec4(0.3, 0.95, 0.8, 1.0);
uniform float intensity = 0.6;

void fragment() {
	float ndv = abs(dot(normalize(NORMAL), normalize(VIEW)));
	float rim = pow(1.0 - ndv, 3.4);
	float band = exp(-pow((ndv - mix(0.15, 0.5, progress)) / 0.16, 2.0)); // thin shell band that sweeps inward on screen
	float crack = 0.75 + 0.25 * sin(UV.x * 61.0 + sin(UV.y * 23.0) * 3.0);
	float fade = pow(1.0 - progress, 2.8) * smoothstep(0.0, 0.05, progress);
	ALBEDO = mix(hot_color.rgb, cool_color.rgb, progress) * intensity * (rim * 0.8 + band * 0.35) * crack;
	ALPHA = clamp(rim * 0.55 + band * 0.12, 0.0, 1.0) * fade;
}
