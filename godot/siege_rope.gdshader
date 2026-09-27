shader_type spatial;
uniform float span=1.0;
uniform float travel=0.0;
void fragment(){
 float phase=(UV.y*span-travel)*900.0+UV.x*18.8496;
 float visibility=1.0-smoothstep(0.6,3.0,fwidth(phase));
 float braid=0.5+0.5*sin(phase)*visibility;
 ALBEDO=mix(vec3(0.23,0.14,0.06),vec3(0.84,0.70,0.44),smoothstep(0.15,0.85,braid));
 ROUGHNESS=0.8;
}
