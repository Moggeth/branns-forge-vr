shader_type spatial;
render_mode depth_prepass_alpha;
uniform vec4 tint : source_color = vec4(0.57,0.16,0.86,1.0);
uniform float opacity : hint_range(0.1,1.0) = 0.68;
uniform float glow : hint_range(0.0,4.0) = 0.65;
uniform float vein_scale : hint_range(1.0,30.0) = 12.0;
varying vec3 local_position;
void vertex(){ local_position = VERTEX; }
void fragment(){
	vec3 p = local_position * vein_scale;
	float seam = abs(sin(p.y + p.x*0.7 + sin(p.z*1.3)*0.4));
	float veins = 1.0-smoothstep(0.025,0.09,seam);
	float rim = pow(1.0-max(dot(normalize(NORMAL),normalize(VIEW)),0.0),3.0);
	float pulse = 0.96+0.04*sin(TIME*1.6);
	ALBEDO = mix(tint.rgb,vec3(0.87,0.70,1.0),veins*0.5+rim*0.25);
	EMISSION = tint.rgb*glow*pulse*(0.3+veins*1.2+rim*0.55);
	ROUGHNESS = 0.22;
	METALLIC = 0.12;
	ALPHA = clamp(opacity+rim*0.18+veins*0.15,0.0,1.0);
}
