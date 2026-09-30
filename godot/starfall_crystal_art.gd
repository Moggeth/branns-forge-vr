extends RefCounted
## Authored crystal vocabulary for Starfall meteor veins and Crystal Fault spires.
## Opaque, bevelled, asymmetric faceted shells; internal depth/veins are faked
## in ONE shared shader (no transparency, no refraction, no lights per crystal).
## Geometry and materials are static-cached: 4 meteor + 6 fault meshes, 2
## ShaderMaterials sharing 1 Shader. Everything is deterministic from seeds.
##
## Vertex COLOR contract: r = 0 base..1 tip, g = per-facet random,
## b = hue mix (0 cyan .. 1 violet), a = 1 on bevel/chamfer strips.

const METEOR_VARIANTS := 4
const FAULT_VARIANTS := 6
const CYAN := Color(0.10, 0.88, 1.0)
const VIOLET := Color(0.66, 0.30, 1.0)
const AMBER := Color(1.0, 0.62, 0.16)

static var _shader: Shader
static var _meteor_material: ShaderMaterial
static var _fault_material: ShaderMaterial
static var _meteor_meshes: Array[ArrayMesh] = []
static var _fault_meshes: Array[ArrayMesh] = []

const _CODE := """
shader_type spatial;
render_mode cull_back, diffuse_burley, specular_schlick_ggx;
uniform vec3 core_a : source_color = vec3(0.10, 0.88, 1.0);
uniform vec3 core_b : source_color = vec3(0.66, 0.30, 1.0);
uniform vec3 hot : source_color = vec3(1.0, 0.62, 0.16);
uniform float glow = 1.5;
uniform float depth_scale = 0.32;
uniform float vein_scale = 4.5;
uniform float amber_share = 0.3;
instance uniform float heat : hint_range(0.0, 1.0) = 0.0;
instance uniform float seedv = 0.0;
varying vec3 mpos;
varying vec3 mnrm;
varying vec3 mview;
varying vec4 vc;

float veins(vec3 p) {
	float a = abs(sin(dot(p, vec3(0.7, 1.3, 0.4)) + sin(dot(p, vec3(1.1, -0.5, 0.9)) * 1.5) * 1.6));
	float b = abs(sin(dot(p, vec3(-1.2, 0.5, 1.1)) + sin(dot(p, vec3(0.6, 1.4, -0.7)) * 1.3) * 1.4));
	return max(1.0 - smoothstep(0.0, 0.035, a), (1.0 - smoothstep(0.0, 0.026, b)) * 0.7);
}

void vertex() {
	mpos = VERTEX;
	mnrm = NORMAL;
	mview = (inverse(MODELVIEW_MATRIX) * vec4(0.0, 0.0, 0.0, 1.0)).xyz - VERTEX;
	vc = COLOR;
}

void fragment() {
	vec3 V = normalize(mview);
	vec3 N = normalize(mnrm);
	float ndv = clamp(dot(N, V), 0.0, 1.0);
	float fres = pow(1.0 - ndv, 3.0);
	vec3 R = refract(-V, N, 0.7);
	float v1 = veins((mpos + R * depth_scale) * vein_scale + vec3(seedv));
	float v2 = veins((mpos + R * depth_scale * 2.3) * vein_scale * 0.6 + vec3(seedv * 1.7));
	float accent = step(1.0 - amber_share, fract(vc.g * 7.3 + seedv * 0.37));
	float tint = (fract(seedv * 3.17) - 0.5) * 0.06;
	vec3 hue = mix(core_a, core_b, smoothstep(0.3, 0.7, clamp(vc.b + (vc.g - 0.5) * 0.3 + tint, 0.0, 1.0)));
	vec3 vein_col = mix(hue, vec3(0.8, 1.0, 1.0), 0.25);
	vein_col = mix(vein_col, hot, accent * 0.6);
	// broad facet contrast: each facet catches a different fake key light
	float facet = 0.35 + 1.25 * vc.g;
	float key = clamp(dot(N, normalize(vec3(0.4, 0.8, 0.45))) * 0.5 + 0.5, 0.0, 1.0);
	float shade = mix(0.25, 1.0, key * key) * facet;
	float deep = (1.0 - vc.r) * 0.7 + 0.3;
	vec3 dark = mix(vec3(0.01, 0.09, 0.12), vec3(0.09, 0.02, 0.16), smoothstep(0.3, 0.7, vc.b));
	// dark gem body with a luminous core that reads through the base and centre of each facet
	vec3 inner = dark + hue * hue * deep * deep * (0.15 + 0.5 * ndv) * shade;
	float core = pow(ndv, 2.0) * (1.0 - vc.r) * 0.55;
	float vein_amt = (v1 * 0.32 + v2 * 0.18) * (0.3 + 0.7 * deep) * (0.4 + 0.6 * ndv);
	// glints sit on chamfers and facet edges, never on flat faces
	float edge_glint = vc.a * (0.15 + 0.9 * fres) * (0.5 + 0.5 * key);
	float sparkle = pow(clamp(sin(TIME * 1.3 + vc.g * 40.0 + seedv * 9.0), 0.0, 1.0), 24.0) * vc.a * (0.2 + fres);
	vec3 emit = inner + hue * hue * core + vein_col * vein_amt;
	emit += hue * fres * 0.45 + mix(hue, vec3(1.0), 0.45) * edge_glint * 0.55;
	emit += hot * smoothstep(0.8, 1.0, vc.r) * 0.16 * accent;
	emit += vec3(1.0) * sparkle * 0.55;
	ALBEDO = dark + hue * hue * (0.08 + 0.18 * vc.g);
	ALBEDO = mix(ALBEDO, hot * 0.5, heat * 0.6);
	EMISSION = emit * glow + hot * heat * (1.2 + v1 * 1.2);
	ROUGHNESS = mix(0.05 + 0.2 * vc.g, 0.03, vc.a);
	METALLIC = 0.25;
	SPECULAR = 1.0;
}
"""

func glow_color(seed_value: int) -> Color:
	return CYAN.lerp(VIOLET, _hue_for(seed_value) * 0.85)

func warm_color() -> Color:
	return AMBER

func warm_cache() -> void:
	# Compile the authored vocabulary during world setup rather than on a cast.
	_meteor_mesh(0)
	_fault_mesh(0)

func decorate_meteor(meteor: Node3D, gems: Array) -> void:
	var base := 0
	if "record" in meteor and meteor.record is Dictionary:
		base = int(meteor.record.get("seed", 0))
	var material := meteor_material()
	for i in gems.size():
		var gem := gems[i] as MeshInstance3D
		if gem == null: continue
		var s := hash(base * 31 + i * 7919)
		gem.mesh = _meteor_mesh(absi(s) % METEOR_VARIANTS)
		gem.material_override = null
		gem.set_instance_shader_parameter("seedv", float(absi(s) % 997) / 97.0)
		gem.set_instance_shader_parameter("heat", 0.0)
	# material is bound on the shared mesh; reference kept alive by the cache
	assert(material != null)

func mesh_for_fault(seed_value: int) -> Mesh:
	return _fault_mesh(absi(hash(seed_value)) % FAULT_VARIANTS)

func meteor_material() -> ShaderMaterial:
	if _meteor_material == null:
		_meteor_material = _make_material(1.25, 0.3)
	return _meteor_material

func fault_material() -> ShaderMaterial:
	if _fault_material == null:
		_fault_material = _make_material(1.45, 0.25)
		_fault_material.set_shader_parameter("vein_scale", 2.6)
		_fault_material.set_shader_parameter("depth_scale", 0.5)
	return _fault_material

func _make_material(glow_value: float, amber: float) -> ShaderMaterial:
	if _shader == null:
		_shader = Shader.new()
		_shader.code = _CODE
	var material := ShaderMaterial.new()
	material.shader = _shader
	material.set_shader_parameter("glow", glow_value)
	material.set_shader_parameter("amber_share", amber)
	return material

func _hue_for(seed_value: int) -> float:
	return float(absi(hash(seed_value * 13 + 5)) % 1000) / 1000.0

func _meteor_mesh(variant: int) -> ArrayMesh:
	if _meteor_meshes.is_empty():
		for i in METEOR_VARIANTS: _meteor_meshes.append(_build_cluster(1000 + i, false, meteor_material()))
	return _meteor_meshes[variant]

func _fault_mesh(variant: int) -> ArrayMesh:
	if _fault_meshes.is_empty():
		for i in FAULT_VARIANTS: _fault_meshes.append(_build_cluster(5000 + i, true, fault_material()))
	return _fault_meshes[variant]

# --- geometry -------------------------------------------------------------

func _build_cluster(seed_value: int, fault: bool, material: Material) -> ArrayMesh:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var data := {"v": PackedVector3Array(), "n": PackedVector3Array(), "c": PackedColorArray()}
	var hue_base := rng.randf()
	if fault:
		# main spire ~2.2m; base at y=0 so the host can plant it in terrain
		_shard(data, rng, Vector3(0.0, -0.1, 0.0), Vector3(rng.randf_range(-0.07, 0.07), 1.0, rng.randf_range(-0.07, 0.07)),
			0.3, 2.3, rng.randi_range(5, 7), hue_base)
		var count := rng.randi_range(7, 9)
		for i in count:
			var a := TAU * (float(i) + rng.randf() * 0.6) / count
			var r := rng.randf_range(0.28, 0.62)
			var lean := rng.randf_range(0.25, 0.7)
			var dir := Vector3(cos(a) * lean, 1.0, sin(a) * lean).normalized()
			_shard(data, rng, Vector3(cos(a) * r, -0.1, sin(a) * r), dir, rng.randf_range(0.11, 0.2),
				rng.randf_range(0.6, 1.5), rng.randi_range(5, 6), hue_base + rng.randf_range(-0.2, 0.2))
	else:
		# fits 1.35m tall x ~0.76m wide, centred on origin like the old cylinder
		_shard(data, rng, Vector3(0.0, -0.68, 0.0), Vector3(rng.randf_range(-0.06, 0.06), 1.0, rng.randf_range(-0.06, 0.06)),
			0.2, 1.35, rng.randi_range(5, 7), hue_base)
		var count := rng.randi_range(3, 5)
		for i in count:
			var a := TAU * (float(i) + rng.randf() * 0.5) / count
			var lean := rng.randf_range(0.3, 0.75)
			var dir := Vector3(cos(a) * lean, 1.0, sin(a) * lean).normalized()
			_shard(data, rng, Vector3(cos(a) * 0.15, -0.68, sin(a) * 0.15), dir, rng.randf_range(0.09, 0.15),
				rng.randf_range(0.55, 0.95), rng.randi_range(5, 6), hue_base + rng.randf_range(-0.25, 0.25))
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = data.v
	arrays[Mesh.ARRAY_NORMAL] = data.n
	arrays[Mesh.ARRAY_COLOR] = data.c
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, material)
	return mesh

func _shard(data: Dictionary, rng: RandomNumberGenerator, base: Vector3, axis: Vector3,
		radius: float, length: float, sides: int, hue: float) -> void:
	axis = axis.normalized()
	var t1 := axis.cross(Vector3.RIGHT if absf(axis.x) < 0.9 else Vector3.FORWARD).normalized()
	var t2 := axis.cross(t1)
	var h_frac := [-0.04, 0.05, 0.62, 0.86]
	var r_frac := [0.82, 1.0, 0.92, 0.55]
	var rings: Array = []
	var twist := rng.randf() * TAU
	var delta := PI / sides * rng.randf_range(0.14, 0.24)
	var corner_r: Array = []
	var corner_a: Array = []
	for i in sides:
		corner_a.append(TAU * (float(i) + rng.randf_range(-0.22, 0.22)) / sides + twist)
		corner_r.append(rng.randf_range(0.82, 1.14))
	for k in 4:
		var ring: Array = []
		var shear := rng.randf_range(-0.05, 0.05) * radius * k
		for i in sides:
			for pair in 2:
				var ang: float = corner_a[i] + (delta if pair == 1 else -delta) + k * 0.05
				var rr: float = radius * r_frac[k] * corner_r[i] * (1.0 + (0.08 if pair == 0 else 0.0))
				ring.append(base + axis * (h_frac[k] * length) + t1 * (cos(ang) * rr + shear) + t2 * (sin(ang) * rr))
		rings.append(ring)
	var apex := base + axis * length + t1 * rng.randf_range(-0.35, 0.35) * radius + t2 * rng.randf_range(-0.35, 0.35) * radius
	var centre := base + axis * (length * 0.45)
	var hue_c := clampf(hue, 0.0, 1.0) if absf(hue - 0.5) <= 0.5 else fposmod(hue, 1.0)
	var facet_id := 0
	for k in 3:
		for i in sides:
			var a0: Vector3 = rings[k][i * 2]
			var b0: Vector3 = rings[k][i * 2 + 1]
			var a1: Vector3 = rings[k][((i + 1) % sides) * 2]
			var b1: Vector3 = rings[k + 1][i * 2 + 1]
			var a1n: Vector3 = rings[k + 1][((i + 1) % sides) * 2]
			var a0n: Vector3 = rings[k + 1][i * 2]
			var hk0 := float(k) / 3.0
			var hk1 := float(k + 1) / 3.0
			# bevel strip at the corner
			_quad(data, centre, a0, b0, b1, a0n, hk0, hk1, rng.randf(), hue_c, 1.0)
			# broad facet
			facet_id += 1
			_quad(data, centre, b0, a1, a1n, b1, hk0, hk1, rng.randf(), hue_c, 0.0)
	for i in sides:
		var a0: Vector3 = rings[3][i * 2]
		var b0: Vector3 = rings[3][i * 2 + 1]
		var a1: Vector3 = rings[3][((i + 1) % sides) * 2]
		_tri(data, centre, a0, b0, apex, 0.86, 1.0, rng.randf(), hue_c, 1.0)
		_tri(data, centre, b0, a1, apex, 0.86, 1.0, rng.randf(), hue_c, 0.0)

func _quad(data: Dictionary, centre: Vector3, a: Vector3, b: Vector3, c: Vector3, d: Vector3,
		h0: float, h1: float, facet: float, hue: float, edge: float) -> void:
	var normal := (c - a).cross(d - b)
	if normal.dot((a + b + c + d) * 0.25 - centre) < 0.0: normal = -normal
	normal = normal.normalized()
	# vertex order chosen so the (a,b,c) winding is clockwise seen from outside
	var tri_a := [a, c, b]
	var tri_b := [a, d, c]
	if (b - a).cross(c - a).dot(normal) < 0.0:
		tri_a = [a, b, c]
		tri_b = [a, c, d]
	var heights := {a: h0, b: h0, c: h1, d: h1}
	for tri in [tri_a, tri_b]:
		for p in tri:
			_push(data, p, normal, Color(heights[p], facet, hue, edge))

func _tri(data: Dictionary, centre: Vector3, a: Vector3, b: Vector3, c: Vector3,
		h0: float, h1: float, facet: float, hue: float, edge: float) -> void:
	var normal := (b - a).cross(c - a).normalized()
	if normal.dot((a + b + c) / 3.0 - centre) < 0.0: normal = -normal
	var order := [a, c, b]
	if (b - a).cross(c - a).dot(normal) < 0.0: order = [a, b, c]
	for p in order:
		_push(data, p, normal, Color(h1 if p == c else h0, facet, hue, edge))

func _push(data: Dictionary, p: Vector3, n: Vector3, col: Color) -> void:
	data.v.append(p)
	data.n.append(n)
	data.c.append(col)
