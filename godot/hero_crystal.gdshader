shader_type spatial;
render_mode depth_prepass_alpha;
uniform vec4 tint : source_color = vec4(0.28,0.045,0.54,1.0);
uniform float opacity = 0.86;
uniform float emission_strength = 0.38;
uniform sampler2D crystal_texture : source_color, filter_linear_mipmap, repeat_enable;
uniform float texture_influence : hint_range(0.0,1.0) = 0.40;
varying vec3 p;
varying vec3 local_normal;
void vertex(){p=VERTEX; local_normal=NORMAL;}
void fragment(){
	float rim=pow(1.0-max(dot(normalize(NORMAL),normalize(VIEW)),0.0),3.0);
	float bands=sin(p.y*46.0+p.x*13.0+sin(p.z*35.0)*0.6)*0.5+0.5;
	float fissure=1.0-smoothstep(0.008,0.025,abs(sin(p.y*31.0+p.x*9.0+sin(p.z*17.0)*0.7)));
	// The painting is sampled from three local planes. Broad crystal facets keep
	// their real lighting and silhouette; the painted veins appear as inclusions.
	vec3 weight=pow(abs(normalize(local_normal)),vec3(4.0));
	weight/=max(weight.x+weight.y+weight.z,0.0001);
	vec3 art_x=texture(crystal_texture,vec2(p.y*2.2-1.0,p.z*2.2+0.5)).rgb;
	vec3 art_y=texture(crystal_texture,vec2(p.x*1.2+0.5,p.z*2.2+0.5)).rgb;
	vec3 art_z=texture(crystal_texture,vec2(p.x*1.2+0.5,p.y*2.0-0.8)).rgb;
	vec3 art=art_x*weight.x+art_y*weight.y+art_z*weight.z;
	float inclusion=clamp(dot(art,vec3(0.2126,0.7152,0.0722))*1.4,0.0,1.0);
	vec3 base=mix(tint.rgb,vec3(0.56,0.24,0.81),bands*0.3+rim*0.55);
	ALBEDO=mix(base,art,texture_influence);
	ROUGHNESS=0.13+bands*0.08+(1.0-inclusion)*0.035;
	METALLIC=0.28;
	EMISSION=vec3(0.50,0.13,0.92)*emission_strength*(0.25+rim*1.5+fissure*0.7+inclusion*0.16);
	ALPHA=opacity+rim*(1.0-opacity);
}
