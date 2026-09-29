extends Node3D
## Layered Orchard horizon: three faceted ridge bands (foothills, blue hills,
## far peaks) that replace stepped pyramidal backdrop mountains. Each band is a
## single low-poly mesh (~400 tris) centred on this node; aerial perspective is
## baked into vertex colour and finished by the scene's own depth/height fog, so
## weather and day-night lighting still act on it. No transparency.
## Place this node at the Orchard centre (y = valley floor). It never has collision.

@export var seed := 7
@export var radii := PackedFloat32Array([150.0, 230.0, 340.0])
@export var heights := PackedFloat32Array([18.0, 42.0, 85.0])
@export var colours := PackedColorArray([Color(0.2, 0.36, 0.15), Color(0.22, 0.34, 0.36), Color(0.42, 0.5, 0.6)])
@export var haze_colour := Color(0.72, 0.8, 0.82)
## Gaps to keep the tallest band away from the cast/work directions (radians, width).
@export var low_sectors := PackedVector2Array([Vector2(0.0, 0.6)])

func _ready() -> void:
	rebuild()

func rebuild() -> void:
	for child in get_children(): child.queue_free()
	var mat := StandardMaterial3D.new()
	mat.vertex_color_use_as_albedo = true
	mat.roughness = 1.0
	mat.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	mat.diffuse_mode = BaseMaterial3D.DIFFUSE_LAMBERT_WRAP
	for band in radii.size():
		var mi := MeshInstance3D.new()
		mi.name = "HorizonBand%d" % band
		mi.mesh = _band(band)
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		mi.extra_cull_margin = 64.0
		add_child(mi)

func _ridge(band: int, a: float, noise: FastNoiseLite) -> float:
	var h: float = heights[band]
	var n := noise.get_noise_2d(cos(a) * 60.0, sin(a) * 60.0) * 0.5 + 0.5
	var detail := noise.get_noise_2d(cos(a) * 190.0 + 500.0, sin(a) * 190.0) * 0.5 + 0.5
	var shape: float
	if band == 0: shape = pow(n, 1.3) * 0.8 + detail * 0.2                 # rounded foothills
	elif band == 1: shape = pow(n, 1.6) * 0.75 + detail * 0.25
	else: shape = pow(n, 2.4) * 0.85 + pow(detail, 2.0) * 0.3            # sparse, sharper peaks
	for sector in low_sectors:
		var d := absf(wrapf(a - sector.x, -PI, PI))
		shape *= lerpf(0.45, 1.0, smoothstep(sector.y * 0.6, sector.y, d)) if band == 2 else 1.0
	return h * (0.18 + shape)

func _band(band: int) -> ArrayMesh:
	var noise := FastNoiseLite.new()
	noise.seed = seed * 31 + band * 7
	noise.frequency = 0.02
	noise.fractal_octaves = 3
	var segs: int = [72, 84, 96][mini(band, 2)]
	var r: float = radii[band]
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var base_col: Color = colours[band]
	var rng := RandomNumberGenerator.new()
	rng.seed = seed + band
	var ring: Array = []
	for i in segs + 1:
		var a := float(i % segs) / segs * TAU
		var top := _ridge(band, a, noise)
		var dir := Vector3(cos(a), 0, sin(a))
		# ridge line sits deeper than its base, so slopes face the valley and catch sun/shade
		var shoulder := top * 0.55
		ring.append([dir * (r - 20.0) + Vector3.DOWN * 8.0, dir * (r + top * 0.25) + Vector3.UP * shoulder, dir * (r + top * 0.6) + Vector3.UP * top])
	for i in segs:
		var j := i + 1
		for layer in 2:
			var a0: Vector3 = ring[i][layer]
			var a1: Vector3 = ring[i][layer + 1]
			var b0: Vector3 = ring[j][layer]
			var b1: Vector3 = ring[j][layer + 1]
			var k := rng.randf_range(0.9, 1.08)
			# lower facets sink into valley haze; upper facets hold the silhouette colour
			var col := base_col.lerp(haze_colour, 0.3 if layer == 0 else 0.0) * k
			col.a = 1.0
			for tri in [[a0, b0, a1], [a1, b0, b1]]:
				var nrm := ((tri[2] as Vector3) - (tri[0] as Vector3)).cross((tri[1] as Vector3) - (tri[0] as Vector3)).normalized()
				if nrm.dot(-(tri[0] as Vector3).normalized()) < 0.0:
					nrm = -nrm
					tri = [tri[0], tri[2], tri[1]]
				for v in tri:
					st.set_color(col)
					st.set_normal(nrm)
					st.add_vertex(v)
	return st.commit()

## Static grade for the Orchard Environment. Day-night/weather code should keep
## animating sun/sky energy and colour; this only sets the atmosphere shape.
static func apply_orchard_grade(env: Environment, sun: DirectionalLight3D = null) -> void:
	env.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	env.tonemap_exposure = 1.0
	env.tonemap_white = 6.0
	env.ambient_light_source = Environment.AMBIENT_SOURCE_SKY
	env.ambient_light_sky_contribution = 0.55
	env.ambient_light_energy = 0.75
	env.fog_enabled = true
	env.fog_mode = Environment.FOG_MODE_EXPONENTIAL
	env.fog_light_color = Color(0.7, 0.78, 0.8)
	env.fog_light_energy = 1.0
	env.fog_sun_scatter = 0.12
	env.fog_density = 0.0028
	env.fog_aerial_perspective = 0.35
	env.fog_sky_affect = 0.25
	env.fog_height = 3.0          # valley haze pools below ~3 m above the Orchard floor
	env.fog_height_density = 0.035
	env.adjustment_enabled = true
	env.adjustment_contrast = 1.08
	env.adjustment_saturation = 1.06
	if sun != null:
		sun.light_energy = 1.25
		sun.light_color = Color(1.0, 0.93, 0.8)
		sun.shadow_enabled = true
