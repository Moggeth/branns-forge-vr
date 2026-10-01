extends RefCounted
## Brann's Forge VR - garden clusters (Sonnet 5.5 art pass, iteration 2).
## Replaces the box-stalk + rock-petal WorldZones.flowers with batched, textured ground-surface-kit props:
## meadow_flowers bouquets, grass_tuft cushions and seedhead_grass spikes. No collisions, no resource entities,
## no lights. Cost per call: at most 3 MultiMeshInstance3D draws (old: 1 MeshInstance3D per stalk / petal / centre,
## up to ~2.3 nodes per flower), <= 14 bouquets / 18 tufts / 8 seedheads, cast_shadow off, 40 m visibility range.
## Deterministic: the layout seed derives only from pos, count and spread.
##
## Delegation (WorldZones.flowers body):
##   const GardenArt = preload("res://ground_garden_art.gd")
##   static func flowers(p, pos, count, spread, color := "fff0bd") -> void: GardenArt.flowers(p, pos, count, spread, color)
const KIT := "res://assets/ground-surface-kit/props/"
const DEFAULT_COLOR := "fff0bd"
const MAX_BOUQUETS := 14
const MAX_TUFTS := 18
const MAX_SEEDS := 8
static var _meshes: Dictionary = {}
static var _tinted: Dictionary = {}

static func _mesh(id: String) -> Mesh:
	if _meshes.has(id): return _meshes[id]
	var packed := load(KIT + id + ".glb") as PackedScene
	var mesh: Mesh = null
	if packed != null:
		var scene := packed.instantiate()
		var parts: Array = scene.find_children("*", "MeshInstance3D", true, false)
		var part: MeshInstance3D = scene if scene is MeshInstance3D else (parts[0] if not parts.is_empty() else null)
		if part != null: mesh = part.mesh
		scene.free()
	if mesh == null: push_warning("ground_garden_art: missing prop " + id)
	_meshes[id] = mesh
	return mesh

## Petal tint for non-default colours: a copy of the textured bouquet with a half-strength albedo tint, so gloamfen's
## blue and any future colours still read as the requested hue while stems keep their green.
static func _bouquet_mesh(color: String) -> Mesh:
	var mesh := _mesh("meadow_flowers")
	if mesh == null or color.to_lower() == DEFAULT_COLOR or mesh.get_surface_count() == 0: return mesh
	if _tinted.has(color): return _tinted[color]
	var base := mesh.surface_get_material(0)
	if not base is StandardMaterial3D: return mesh
	var copy := mesh.duplicate() as Mesh
	var tinted := (base as StandardMaterial3D).duplicate() as StandardMaterial3D
	tinted.albedo_color = Color.WHITE.lerp(Color(color), 0.55)
	copy.surface_set_material(0, tinted)
	_tinted[color] = copy
	return copy

static func _holder(p: Node3D, pos: Vector3, mesh: Mesh, poses: Array, radius: float, name: String) -> void:
	if mesh == null or poses.is_empty(): return
	var multi := MultiMesh.new()
	multi.transform_format = MultiMesh.TRANSFORM_3D
	multi.mesh = mesh
	multi.instance_count = poses.size()
	for i in range(poses.size()): multi.set_instance_transform(i, poses[i])
	multi.custom_aabb = AABB(Vector3(-radius - 1.0, -0.3, -radius - 1.0), Vector3((radius + 1.0) * 2.0, 2.4, (radius + 1.0) * 2.0))
	var holder := MultiMeshInstance3D.new()
	holder.name = "gk_grass_garden_" + name
	holder.multimesh = multi
	holder.position = pos
	var addresses := PackedVector3Array()
	for pose in poses: addresses.append(pos + pose.origin)
	holder.set_meta("dressing_positions", addresses)
	var hidden := PackedByteArray()
	hidden.resize(poses.size())
	holder.set_meta("dressing_hidden", hidden)
	holder.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	holder.visibility_range_end = 40.0
	holder.visibility_range_end_margin = 6.0
	p.add_child(holder)

static func _pose(rng: RandomNumberGenerator, at: Vector3, size: float, lean: float) -> Transform3D:
	var basis := Basis(Vector3.UP, rng.randf() * TAU)
	basis = basis * Basis(Vector3.RIGHT, rng.randf_range(-lean, lean)) * Basis(Vector3.FORWARD, rng.randf_range(-lean, lean))
	return Transform3D(basis.scaled(Vector3(size, size * rng.randf_range(0.9, 1.15), size)), at)

## Contract of the old WorldZones.flowers: p = parent, pos = floor-level centre, count = density hint, spread = radius.
static func flowers(p: Node3D, pos: Vector3, count: int, spread: float, color: String = DEFAULT_COLOR) -> void:
	if p == null or count <= 0 or spread <= 0.0: return
	var rng := RandomNumberGenerator.new()
	rng.seed = hash(Vector3i(roundi(pos.x * 4.0), roundi(pos.y * 4.0), roundi(pos.z * 4.0))) ^ (count * 7919) ^ int(spread * 131.0)
	var bouquets: Array = []
	var tufts: Array = []
	var seeds: Array = []
	var n_bouquet := clampi(int(ceil(float(count) * 0.4)), 3, MAX_BOUQUETS)
	var n_tuft := clampi(int(ceil(float(count) * 0.5)), 4, MAX_TUFTS)
	var n_seed := clampi(int(ceil(float(count) * 0.2)), 2, MAX_SEEDS)
	# Garden bed, not a scatter: bouquets sit in 2-3 irregular drifts (sunflower-seed packing per drift keeps
	# neighbours apart), with grass cushions skirting every drift and a few seedhead spikes at the rim.
	var drifts := clampi(int(round(spread * 0.9)), 2, 3)
	var centres: Array = []
	for d in range(drifts):
		var a := rng.randf() * TAU
		var r := spread * (0.25 + 0.4 * rng.randf())
		centres.append(Vector2(cos(a) * r, sin(a) * r))
	for i in range(n_bouquet):
		var c: Vector2 = centres[i % drifts]
		var k := float(floori(float(i) / float(drifts)))
		var a := k * 2.39996 + rng.randf() * 0.5
		var r := minf(sqrt(k + 0.6) * spread * 0.2, spread * 0.55)
		var at := Vector3(c.x + cos(a) * r, 0.0, c.y + sin(a) * r)
		bouquets.append(_pose(rng, at, rng.randf_range(1.7, 2.8), 0.10))
	for i in range(n_tuft):
		var c: Vector2 = centres[i % drifts]
		var a := rng.randf() * TAU
		var r := spread * (0.15 + 0.55 * sqrt(rng.randf()))
		var at := Vector3(c.x * 0.5 + cos(a) * r, 0.0, c.y * 0.5 + sin(a) * r)
		tufts.append(_pose(rng, at, rng.randf_range(1.5, 2.4), 0.14))
	for i in range(n_seed):
		var a := rng.randf() * TAU
		var r := spread * rng.randf_range(0.55, 1.0)
		seeds.append(_pose(rng, Vector3(cos(a) * r, 0.0, sin(a) * r), rng.randf_range(0.9, 1.5), 0.12))
	_holder(p, pos, _bouquet_mesh(color), bouquets, spread, "GardenBouquets")
	_holder(p, pos, _mesh("grass_tuft"), tufts, spread, "GardenTufts")
	_holder(p, pos, _mesh("seedhead_grass"), seeds, spread, "GardenSeedheads")
