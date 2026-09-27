extends RefCounted
## Cheap world-scale colour variation under instanced grass and authored paths.
## Opaque and texture-free, so the 320 m ground costs one material/draw surface.
static var _material:ShaderMaterial

static func material()->ShaderMaterial:
	if _material!=null: return _material
	var shader:=Shader.new()
	shader.code="""
shader_type spatial;
render_mode cull_back, diffuse_lambert, specular_schlick_ggx;
varying vec2 ground_at;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float cell_noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() { ground_at = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz; }
void fragment() {
    float broad = cell_noise(ground_at * 0.075);
    float small = cell_noise(ground_at * 0.43);
    float scuff = cell_noise(ground_at * 1.9);
    vec3 meadow = mix(vec3(0.33, 0.43, 0.22), vec3(0.53, 0.58, 0.30), broad);
    vec3 dry = vec3(0.56, 0.48, 0.31);
    float earth = smoothstep(0.60, 0.78, broad + (small - 0.5) * 0.25);
    ALBEDO = mix(meadow, dry, earth * 0.45) * (0.94 + small * 0.10 + scuff * 0.04);
    ROUGHNESS = 0.96;
}
"""
	_material=ShaderMaterial.new()
	_material.shader=shader
	return _material
