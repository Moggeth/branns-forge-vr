shader_type spatial;
// Shell chips: forged metal that cools from ember glow. Instance colour rgb = glow colour, a = glow amount.
varying vec4 heat;

void vertex() {
	heat = COLOR;
}

void fragment() {
	ALBEDO = vec3(0.13, 0.19, 0.27);
	METALLIC = 0.85;
	ROUGHNESS = 0.42;
	EMISSION = heat.rgb * heat.a * 2.2;
}
