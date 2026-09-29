extends Node3D
## Visible creek surface compiled from hydrology's authoritative channel fields.
## One ribbon mesh per ~32 metres; no water collision blocks the Hero.

const CHUNK_SAMPLES: int = 16
const SURFACE_LIFT: float = 0.035
const RIVER_SHADER = preload("res://assets/orchard_kit/river_water.gdshader")
const POOL_SHADER_RESOURCE = preload("res://assets/orchard_kit/pool_water.gdshader")

var _chunks: Array[MeshInstance3D] = []
var _bounds: Array[Rect2] = []
var _model: Dictionary = {}
var _material: ShaderMaterial
var _pool_material: ShaderMaterial
var _route_snapshot: Array[Vector3] = []
var _pool_surface: MeshInstance3D


func setup(model: Dictionary) -> void:
	for chunk in _chunks: chunk.free()
	_chunks.clear()
	_bounds.clear()
	if _pool_surface != null:
		_pool_surface.free()
		_pool_surface = null
	_model = model
	_route_snapshot = (model.get("river_polyline", []) as Array[Vector3]).duplicate()
	if _material == null:
		_material = ShaderMaterial.new()
		_material.shader = RIVER_SHADER
	var route: Array[Vector3] = model.get("river_polyline", [])
	if route.size() < 2: return
	var chunk_count: int = ceili(float(route.size() - 1) / CHUNK_SAMPLES)
	for chunk_index in chunk_count:
		var surface := MeshInstance3D.new()
		surface.name = "LandscapeWater_%02d" % chunk_index
		surface.material_override = _material
		surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(surface)
		_chunks.append(surface)
		_bounds.append(Rect2())
		_rebuild(chunk_index)
	_rebuild_pools()


func refresh_region(model: Dictionary, dirty: Rect2) -> int:
	## Returns the number of water chunks rebuilt. The route may change after a
	## river redirect; a topology change requires setup(), still bounded to water.
	var route: Array[Vector3] = model.get("river_polyline", [])
	if route != _route_snapshot:
		setup(model)
		return _chunks.size()
	_model = model
	_rebuild_pools()
	var rebuilt: int = 0
	for i in _chunks.size():
		if _bounds[i].intersects(dirty):
			_rebuild(i)
			rebuilt += 1
	return rebuilt


func _rebuild_pools() -> void:
	var pool: PackedFloat32Array = _model.get("hydrology_pool", PackedFloat32Array())
	var levels: PackedFloat32Array = _model.get("water_level", PackedFloat32Array())
	var size: int = int(_model.get("size", 0))
	if pool.size() != size * size or levels.size() != pool.size(): return
	var step: float = float(_model.get("step", 2.0))
	var origin: Vector2 = _model.get("origin", Vector2.ZERO)
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var tangents := PackedFloat32Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	for index in pool.size():
		if pool[index] <= 0.1: continue
		var x: int = index % size
		var z: int = index / size
		var center: Vector2 = origin + Vector2(x, z) * step
		var y: float = levels[index] + SURFACE_LIFT
		var radius: float = step * 0.53
		var base: int = vertices.size()
		vertices.append(Vector3(center.x - radius, y, center.y - radius))
		vertices.append(Vector3(center.x + radius, y, center.y - radius))
		vertices.append(Vector3(center.x - radius, y, center.y + radius))
		vertices.append(Vector3(center.x + radius, y, center.y + radius))
		for corner in 4:
			normals.append(Vector3.UP)
			tangents.append_array(PackedFloat32Array([1.0, 0.0, 0.0, -1.0]))
		uvs.append_array(PackedVector2Array([Vector2(0, 0), Vector2(1, 0), Vector2(0, 1), Vector2(1, 1)]))
		indices.append_array(PackedInt32Array([base, base + 1, base + 2, base + 1, base + 3, base + 2]))
	if indices.is_empty():
		if _pool_surface != null:
			_pool_surface.free()
			_pool_surface = null
		return
	if _pool_surface == null:
		_pool_surface = MeshInstance3D.new()
		_pool_surface.name = "LandscapePools"
		if _pool_material == null:
			_pool_material = ShaderMaterial.new()
			_pool_material.shader = POOL_SHADER_RESOURCE
		_pool_surface.material_override = _pool_material
		_pool_surface.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		add_child(_pool_surface)
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TANGENT] = tangents
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	_pool_surface.mesh = mesh


func chunk_count() -> int:
	return _chunks.size()


func _rebuild(chunk_index: int) -> void:
	var route: Array[Vector3] = _model.river_polyline
	var first: int = chunk_index * CHUNK_SAMPLES
	var last: int = mini(route.size() - 1, first + CHUNK_SAMPLES)
	var vertices := PackedVector3Array()
	var normals := PackedVector3Array()
	var tangents := PackedFloat32Array()
	var uvs := PackedVector2Array()
	var indices := PackedInt32Array()
	var wet := PackedByteArray()
	var bounds_min := Vector2(INF, INF)
	var bounds_max := Vector2(-INF, -INF)
	var travelled: float = 0.0
	for before in first:
		var previous: Vector3 = route[before]
		var following: Vector3 = route[before + 1]
		travelled += Vector2(following.x - previous.x, following.z - previous.z).length()
	for i in range(first, last + 1):
		var p: Vector3 = route[i]
		var center := Vector2(p.x, p.z)
		# The authored route can be blocked by raised earth. Leave a physical
		# gap instead of drawing a ribbon through the new ridge. Its remaining
		# segments retain the original strictly descending water heights.
		wet.append(1 if _field("water", center) > 0.02 and _field("height", center) < p.y - 0.01 else 0)
		var prev: Vector3 = route[maxi(0, i - 1)]
		if i > first: travelled += Vector2(p.x - prev.x, p.z - prev.z).length()
		var next: Vector3 = route[mini(route.size() - 1, i + 1)]
		var tangent := Vector2(next.x - prev.x, next.z - prev.z).normalized()
		if tangent.length_squared() < 0.1: tangent = Vector2.RIGHT
		var normal := tangent.orthogonal()
		var width: float = clampf(_field("river_width", Vector2(p.x, p.z)), 3.0, 14.0)
		var edge: Vector2 = normal * width * 0.49
		var left := center - edge
		var right := center + edge
		vertices.append(Vector3(left.x, p.y + SURFACE_LIFT, left.y))
		vertices.append(Vector3(right.x, p.y + SURFACE_LIFT, right.y))
		var across := Vector3(right.x - left.x, 0.0, right.y - left.y).normalized()
		for bank in 2:
			normals.append(Vector3.UP)
			tangents.append_array(PackedFloat32Array([across.x, 0.0, across.z, -1.0]))
		uvs.append(Vector2(0.0, travelled * 0.1))
		uvs.append(Vector2(1.0, travelled * 0.1))
		bounds_min = bounds_min.min(left).min(right)
		bounds_max = bounds_max.max(left).max(right)
		if i > first and wet[i - first] != 0 and wet[i - first - 1] != 0:
			var base: int = (i - first) * 2
			indices.append_array(PackedInt32Array([base - 2, base - 1, base, base - 1, base + 1, base]))
	var arrays: Array = []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	arrays[Mesh.ARRAY_NORMAL] = normals
	arrays[Mesh.ARRAY_TANGENT] = tangents
	arrays[Mesh.ARRAY_TEX_UV] = uvs
	arrays[Mesh.ARRAY_INDEX] = indices
	var mesh := ArrayMesh.new()
	if indices.size() > 0:
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	_chunks[chunk_index].mesh = mesh
	_bounds[chunk_index] = Rect2(bounds_min, bounds_max - bounds_min).grow(2.0)


func _field(key: String, point: Vector2) -> float:
	return sample(_model, key, point)


static func sample(model: Dictionary, key: String, point: Vector2) -> float:
	var field: PackedFloat32Array = model.get(key, PackedFloat32Array())
	var size: int = int(model.get("size", 0))
	if field.size() != size * size or size == 0: return 0.0
	var step: float = float(model.get("step", 2.0))
	var origin: Vector2 = model.get("origin", Vector2.ZERO)
	var x: int = clampi(roundi((point.x - origin.x) / step), 0, size - 1)
	var z: int = clampi(roundi((point.y - origin.y) / step), 0, size - 1)
	return field[z * size + x]


static func crossing(model: Dictionary, hint: Vector2 = Vector2(25, -48)) -> Dictionary:
	## Deck spans across flow. Position is local and sits above the higher bank.
	var route: Array[Vector3] = model.get("river_polyline", [])
	if route.size() < 2: return {}
	var best_distance: float = INF
	var center := Vector3.ZERO
	var along := Vector2.RIGHT
	for i in route.size() - 1:
		var a: Vector3 = route[i]
		var b: Vector3 = route[i + 1]
		var a2 := Vector2(a.x, a.z)
		var span := Vector2(b.x - a.x, b.z - a.z)
		var t: float = clampf((hint - a2).dot(span) / maxf(span.length_squared(), 0.0001), 0.0, 1.0)
		var projection: Vector2 = a2 + span * t
		var distance: float = projection.distance_squared_to(hint)
		if distance >= best_distance: continue
		best_distance = distance
		center = a.lerp(b, t)
		along = span.normalized()
	var across: Vector2 = along.orthogonal()
	var width: float = maxf(3.0, sample(model, "river_width", Vector2(center.x, center.z)))
	var span: float = width + 7.0
	var near_bank: Vector2 = Vector2(center.x, center.z) - across * span * 0.5
	var far_bank: Vector2 = Vector2(center.x, center.z) + across * span * 0.5
	var deck_y: float = maxf(center.y + 0.65, maxf(sample(model, "height", near_bank), sample(model, "height", far_bank)) + 0.16)
	return {"position": Vector3(center.x, deck_y, center.z), "along": along, "across": across, "span": span, "water_y": center.y}
