extends RefCounted
## Shared GPU wind for batched grass, shrub leaves and authored tree crowns.
## The trunk stays still; only foliage vertices above their attachment bend.
static var _materials: Dictionary = {}
static var _kit_materials: Dictionary = {}
static var _wind := Vector2(0.95, 0.30)
static var _strength := 0.65
static var _wetness := 0.0

static func material(kind: String, tint: Color = Color.WHITE) -> ShaderMaterial:
	var key := kind + ":" + tint.to_html()
	if _materials.has(key): return _materials[key]
	var two_sided := kind == "grass"
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode CULL_MODE, diffuse_lambert, specular_schlick_ggx;
uniform vec4 tint : source_color = vec4(1.0);
uniform vec2 wind_dir = vec2(0.95, 0.30);
uniform float wind_strength = 0.65;
uniform float wetness = 0.0;
uniform float anchor_y = 0.0;
uniform float flex_height = 1.0;
uniform float bend_scale = 0.10;
uniform float canopy = 0.0;
varying vec3 world_at;
varying float crown_y;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() {
    vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
    world_at = world;
    crown_y = VERTEX.y;
    float flex = clamp((VERTEX.y - anchor_y) / flex_height, 0.0, 1.0);
    float phase = TIME * 1.24 + world.x * 0.19 + world.z * 0.13;
    float breeze = sin(phase) * 0.64 + sin(phase * 1.67 + world.x * 0.37) * 0.36;
    VERTEX.xz += wind_dir * breeze * wind_strength * bend_scale * flex * flex;
}
void fragment() {
    vec3 c = COLOR.rgb * tint.rgb;
    if (canopy > 0.5) {
        // Stylized canopy response: crowns read as lit masses of leaf clumps instead of flat faceted green.
        // Underside falls into cool shade, the top catches warm sun, clump noise breaks every big facet.
        float top = clamp((crown_y - 2.2) / 3.4, 0.0, 1.0);
        float clump = n2(world_at.xz * 0.9 + world_at.y * 0.5) * 0.65 + n2(world_at.xz * 2.6 + 5.0) * 0.35;
        c *= mix(vec3(0.74, 0.86, 0.90), vec3(1.10, 1.08, 0.94), top);
        c *= mix(0.90, 1.09, clump);
        c = mix(c, c * vec3(1.14, 1.08, 0.70), top * smoothstep(0.55, 0.85, clump) * 0.45);
    }
    ALBEDO = c * mix(1.0, 0.82, wetness);
    ROUGHNESS = mix(0.92, 0.68, wetness);
    SPECULAR = mix(0.35, 0.54, wetness);
}
""".replace("CULL_MODE", "cull_disabled" if two_sided else "cull_back")
	var result := ShaderMaterial.new()
	result.shader = shader
	result.set_shader_parameter("tint", tint)
	result.set_shader_parameter("wind_dir", _wind)
	result.set_shader_parameter("wind_strength", _strength)
	result.set_shader_parameter("wetness", _wetness)
	if kind == "grass":
		result.set_shader_parameter("anchor_y", 0.02)
		result.set_shader_parameter("flex_height", 0.60)
		result.set_shader_parameter("bend_scale", 0.075)
	elif kind == "shrub":
		result.set_shader_parameter("anchor_y", 0.22)
		result.set_shader_parameter("flex_height", 1.45)
		result.set_shader_parameter("bend_scale", 0.10)
	else:
		result.set_shader_parameter("canopy", 1.0)
		result.set_shader_parameter("anchor_y", 2.0)
		result.set_shader_parameter("flex_height", 3.2)
		result.set_shader_parameter("bend_scale", 0.12)
	_materials[key] = result
	return result

static func shadow_material(kind: String = "tree") -> ShaderMaterial:
	## Shadow-caster proxy for canopies. The crown's faceted hull casts one large hard-edged polygon; this
	## material is used on a SHADOWS_ONLY twin of the same mesh and discards a deterministic world-space
	## clump pattern, so leaf gaps let dappled light through and the silhouette edge is ragged. Shadow
	## strength/bias/filter are untouched. Wind matches the visible crown so shadow and mesh stay locked.
	var key := "shadow:" + kind
	if _materials.has(key): return _materials[key]
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode cull_disabled, unshaded, shadows_disabled, depth_draw_opaque;
uniform vec2 wind_dir = vec2(0.95, 0.30);
uniform float wind_strength = 0.65;
uniform float anchor_y = 2.0;
uniform float flex_height = 3.2;
uniform float bend_scale = 0.12;
uniform float hole_level = 0.40;
varying vec3 world_at;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() {
    vec3 world = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
    float flex = clamp((VERTEX.y - anchor_y) / flex_height, 0.0, 1.0);
    float phase = TIME * 1.24 + world.x * 0.19 + world.z * 0.13;
    float breeze = sin(phase) * 0.64 + sin(phase * 1.67 + world.x * 0.37) * 0.36;
    VERTEX.xz += wind_dir * breeze * wind_strength * bend_scale * flex * flex;
    world_at = world;
}
void fragment() {
    // x/z-dominant so front and back hull layers punch the same holes for a near-vertical sun.
    vec2 q = world_at.xz * 1.35 + world_at.y * vec2(0.18, 0.12);
    float leaf = n2(q) * 0.55 + n2(q * 2.7 + 3.1) * 0.30 + n2(q * 6.1 + 9.4) * 0.15;
    ALBEDO = vec3(0.0);
    ALPHA = leaf > hole_level ? 1.0 : 0.0;
    ALPHA_SCISSOR_THRESHOLD = 0.5;
}
"""
	var result := ShaderMaterial.new()
	result.shader = shader
	result.set_shader_parameter("wind_dir", _wind)
	result.set_shader_parameter("wind_strength", _strength)
	if kind == "shrub":
		result.set_shader_parameter("anchor_y", 0.22)
		result.set_shader_parameter("flex_height", 1.45)
		result.set_shader_parameter("bend_scale", 0.10)
	_materials[key] = result
	return result

static func weather(wind: Vector2, strength: float, wet: float) -> void:
	_wind = wind.normalized() if wind.length() > 0.01 else Vector2.RIGHT
	_strength = clampf(strength, 0.0, 2.0)
	_wetness = clampf(wet, 0.0, 1.0)
	for shader_material in _materials.values():
		shader_material.set_shader_parameter("wind_dir", _wind)
		shader_material.set_shader_parameter("wind_strength", _strength)
		shader_material.set_shader_parameter("wetness", _wetness)
	for shader_material in _kit_materials.values():
		shader_material.set_shader_parameter("wind_dir", _wind)
		shader_material.set_shader_parameter("wind_strength", _strength)
		shader_material.set_shader_parameter("wetness", _wetness)

static func kit_material(kind: String, source: StandardMaterial3D, variant: String = "") -> ShaderMaterial:
	# Opus's nine GLBs use the same tiny palette atlas. Retain their authored UV
	# colour and roughness while driving the whole library from one weather wind.
	# Sonnet additions have separate atlases: key those by asset to avoid a rock
	# silently borrowing the first imported rock's texture.
	var key := kind if variant.is_empty() else kind + ":" + variant
	if _kit_materials.has(key): return _kit_materials[key]
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode CULL_MODE, diffuse_lambert, specular_schlick_ggx;
uniform sampler2D palette : source_color, filter_nearest_mipmap;
uniform sampler2D surface_orm : filter_nearest_mipmap;
uniform vec2 wind_dir = vec2(0.95, 0.30);
uniform float wind_strength = 0.65;
uniform float wetness = 0.0;
uniform float sway = 0.0;
varying vec3 at;
void vertex() {
    at = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xyz;
    float flex = clamp(UV.x * UV.x, 0.0, 1.0);
    float phase = TIME * 1.24 + at.x * 0.19 + at.z * 0.13;
    float breeze = sin(phase) * 0.64 + sin(phase * 1.67 + at.x * 0.37) * 0.36;
    VERTEX.xz += wind_dir * breeze * wind_strength * sway * flex;
}
void fragment() {
    vec3 base = texture(palette, UV).rgb;
    float base_rough = texture(surface_orm, UV).g;
    ALBEDO = base * mix(1.0, 0.81, wetness);
    ROUGHNESS = mix(base_rough, min(base_rough, 0.42), wetness * 0.75);
    SPECULAR = mix(0.42, 0.66, wetness);
}
""".replace("CULL_MODE", "cull_disabled" if kind in ["fern", "grass", "flower", "litter"] else "cull_back")
	var finish := ShaderMaterial.new()
	finish.shader = shader
	finish.set_shader_parameter("palette", source.albedo_texture)
	finish.set_shader_parameter("surface_orm", source.roughness_texture)
	finish.set_shader_parameter("wind_dir", _wind)
	finish.set_shader_parameter("wind_strength", _strength)
	finish.set_shader_parameter("wetness", _wetness)
	finish.set_shader_parameter("sway", 0.12 if kind == "grass" else (0.085 if kind == "fern" else (0.035 if kind == "flower" else 0.0)))
	_kit_materials[key] = finish
	return finish
