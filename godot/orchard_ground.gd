extends RefCounted
## One opaque surface with world-scale distribution and close-range detail maps.
const MASK_PATH := "res://assets/atmosphere/orchard_masks.png"
const EXTENT := 160.0
const RESOLUTION := 512
static var _material: ShaderMaterial
static var _mask_image: Image
static var _mask_texture: ImageTexture

static func material() -> ShaderMaterial:
	if _material != null: return _material
	var source: Texture2D = load(MASK_PATH)
	_mask_image = source.get_image().duplicate()
	_mask_texture = ImageTexture.create_from_image(_mask_image)
	var shader := Shader.new()
	shader.code = """
shader_type spatial;
render_mode cull_back, diffuse_lambert, specular_schlick_ggx;
uniform sampler2D grass_tex : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D soil_tex : source_color, repeat_enable, filter_linear_mipmap;
uniform sampler2D micro_normal : hint_normal, repeat_enable, filter_linear_mipmap;
uniform sampler2D macro_mask : repeat_disable, filter_linear;
uniform float rain_wetness = 0.0;
uniform float snow_cover = 0.0;
varying vec2 at;
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise2(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
               mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void vertex() { at = (MODEL_MATRIX * vec4(VERTEX, 1.0)).xz - vec2(-360.0, 0.0); }
void fragment() {
    vec2 uv = clamp((at + vec2(160.0)) / 320.0, vec2(0.0), vec2(1.0));
    vec4 m = texture(macro_mask, uv);
    float regional = noise2(at * 0.021);
    float meander = noise2(at * 0.11);
    float breakup = noise2(at * 0.39);
    vec3 grass = texture(grass_tex, at * 0.28).rgb;
    vec3 soil = texture(soil_tex, at * 0.31).rgb;
    float leaf = m.g * (0.38 + 0.24 * meander);
    float exposed = clamp(m.r * 0.86 + m.a * 0.36 + leaf * 0.40 +
                          smoothstep(0.70, 0.87, regional + (meander - 0.5) * 0.20) * 0.24, 0.0, 1.0);
    vec3 colour = mix(grass, soil, exposed);
    colour *= mix(0.88, 1.10, regional) * mix(0.97, 1.03, breakup);
    colour = mix(colour, vec3(0.34, 0.31, 0.18), leaf * 0.22);
    float damp = clamp(max(m.b * 0.55, rain_wetness) + m.g * rain_wetness * 0.18, 0.0, 1.0);
    colour *= 1.0 - damp * 0.22;
    float puddle = smoothstep(0.68, 0.90, m.b * 0.58 + rain_wetness * 0.58 + meander * 0.14);
    colour = mix(colour, vec3(0.89, 0.93, 0.94), snow_cover * (0.79 + 0.16 * regional));
    ALBEDO = colour;
    ROUGHNESS = mix(0.93 - exposed * 0.06, 0.48, max(damp * 0.78, puddle * 0.72));
    ROUGHNESS = mix(ROUGHNESS, 0.82, snow_cover);
    SPECULAR = mix(0.35, 0.69, damp);
    NORMAL_MAP = texture(micro_normal, at * 0.28).rgb;
    NORMAL_MAP_DEPTH = mix(0.24, 0.07, snow_cover);
}
"""
	_material = ShaderMaterial.new()
	_material.shader = shader
	_material.set_shader_parameter("grass_tex", load("res://assets/atmosphere/grass_albedo.png"))
	_material.set_shader_parameter("soil_tex", load("res://assets/atmosphere/soil_albedo.png"))
	_material.set_shader_parameter("micro_normal", load("res://assets/atmosphere/micro_normal.png"))
	_material.set_shader_parameter("macro_mask", _mask_texture)
	return _material

static func weather(wet: float, snow: float) -> void:
	if _material == null: return
	_material.set_shader_parameter("rain_wetness", clampf(wet, 0.0, 1.0))
	_material.set_shader_parameter("snow_cover", clampf(snow, 0.0, 1.0))

static func sync_paths(paths: Array) -> void:
	if _material == null: material()
	var source: Texture2D = load(MASK_PATH)
	_mask_image = source.get_image().duplicate()
	for entry in paths:
		if not entry is Dictionary or not entry.has("a") or not entry.has("b"): continue
		var a: Array = entry.a
		var b: Array = entry.b
		if a.size() != 2 or b.size() != 2: continue
		_paint_segment(Vector2(float(a[0]), float(a[1])), Vector2(float(b[0]), float(b[1])))
	_mask_texture.update(_mask_image)

static func add_path(a: Vector3, b: Vector3) -> void:
	if _mask_image == null: material()
	_paint_segment(Vector2(a.x, a.z), Vector2(b.x, b.z))
	_mask_texture.update(_mask_image)

static func sample(at: Vector2) -> Color:
	# Same authored/mutable mask drives both the ground and ecological placement.
	if _mask_image == null: material()
	var x := clampi(floori((at.x + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var z := clampi(floori((at.y + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	return _mask_image.get_pixel(x, z)

static func _paint_segment(a: Vector2, b: Vector2) -> void:
	var low := a.min(b) - Vector2.ONE * 5.0
	var high := a.max(b) + Vector2.ONE * 5.0
	var x0 := clampi(floori((low.x + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var x1 := clampi(ceili((high.x + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var z0 := clampi(floori((low.y + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var z1 := clampi(ceili((high.y + EXTENT) / (EXTENT * 2.0) * RESOLUTION), 0, RESOLUTION - 1)
	var span := b - a
	for z in range(z0, z1 + 1):
		for x in range(x0, x1 + 1):
			var point := Vector2((float(x) + 0.5) / RESOLUTION * EXTENT * 2.0 - EXTENT, (float(z) + 0.5) / RESOLUTION * EXTENT * 2.0 - EXTENT)
			var t := clampf((point - a).dot(span) / maxf(span.length_squared(), 0.001), 0.0, 1.0)
			var distance := point.distance_to(a + span * t)
			if distance >= 4.5: continue
			var route := 1.0 - smoothstep(2.0, 4.5, distance)
			var prior := _mask_image.get_pixel(x, z)
			prior.r = maxf(prior.r, route)
			_mask_image.set_pixel(x, z, prior)
