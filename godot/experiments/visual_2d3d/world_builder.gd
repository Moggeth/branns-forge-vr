extends RefCounted

const ASSETS := "res://assets/orchard/"
const FINISH = preload("res://orchard_finish.gd")
const ORCHARD_ART = preload("res://orchard_art.gd")
const ALLOWED := ["apple_tree_mature", "apple_tree_mature_b", "apple_tree_young", "apple_tree_mature_autumn", "hedge_dense", "shrub_flowering", "rock_mossy", "rock_mossy_small", "rubble_split", "wall_straight", "wall_corner_broken", "wall_end_broken", "path_straight", "path_curve30", "path_curve30_left", "mountain_cliff_chunk"]
const WALKABLE_SURFACE_ASSETS := ["path_straight", "path_curve30", "path_curve30_left"]
const PATH_HALF_WIDTH := 1.45

var spec: Dictionary
var metrics := {}
var errors: Array[String] = []
var rng := RandomNumberGenerator.new()
var asset_cache := {}

func _init(input: Dictionary):
	spec = input
	rng.seed = int(spec.get("seed", 1))

func v2(value) -> Vector2:
	return Vector2(float(value[0]), float(value[1]))

func valid_optional_glb(path: String) -> bool:
	return path.begins_with("res://assets/") and path.ends_with(".glb") and not path.contains("..") and not path.contains("\\") and ResourceLoader.exists(path)

func stream_carve_kind() -> String:
	var carve = spec.get("terrain", {}).get("stream_carve", "legacy")
	if typeof(carve) == TYPE_DICTIONARY: return str(carve.get("kind", "legacy"))
	return str(carve)

func stream_carve_parameters() -> Dictionary:
	var carve = spec.get("terrain", {}).get("stream_carve", {})
	return carve if typeof(carve) == TYPE_DICTIONARY else {}

func hill_height(p: Vector2) -> float:
	var t: Dictionary = spec.get("terrain", {})
	var height := float(t.get("base_y", t.get("base_height_m", t.get("base_height", 0.0))))
	var coefficient := float(t.get("gaussian_coefficient", 0.5))
	for hill in t.get("hills", []):
		var center: Vector2 = v2(hill.get("center_xz", [0, 0]))
		var radius := maxf(float(hill.get("radius_m", 1.0)), 0.1)
		var distance_sq := p.distance_squared_to(center)
		height += float(hill.get("amplitude_m", 0.0)) * exp(-coefficient * distance_sq / (radius * radius))
	return height

func smoothstep(a: float, b: float, value: float) -> float:
	var t := clampf((value - a) / maxf(b - a, 0.001), 0.0, 1.0)
	return t * t * (3.0 - 2.0 * t)

func terrain_height(p: Vector2) -> float:
	var height := hill_height(p)
	var kind := stream_carve_kind()
	if kind == "none": return height
	var distance := distance_to_polyline(p, spec["stream"]["points_xz"])
	if kind == "valley_channel":
		var carve := stream_carve_parameters()
		var valley_radius := maxf(float(carve.get("valley_radius_m", 12.0)), 0.1)
		height -= float(carve.get("valley_depth_m", 1.0)) * exp(-distance * distance / (valley_radius * valley_radius))
		var limits: Array = carve.get("channel_smoothstep_m", [1.2, 4.5])
		height -= float(carve.get("channel_depth_m", 1.9)) * (1.0 - smoothstep(float(limits[0]), float(limits[1]), distance))
		return height
	var stream_half := float(spec["stream"]["width_m"]) * 0.5
	var bank := clampf((distance - stream_half) / 2.0, 0.0, 1.0)
	height -= 1.8 * (1.0 - bank * bank * (3.0 - 2.0 * bank))
	return height

func water_height(p: Vector2) -> float:
	var kind := stream_carve_kind()
	if kind == "none":
		return float(spec.stream.get("c_water_y", terrain_height(p) + 0.2))
	if kind == "valley_channel":
		var carve := stream_carve_parameters()
		var distance := distance_to_polyline(p, spec.stream.points_xz)
		var valley_radius := maxf(float(carve.get("valley_radius_m", 12.0)), 0.1)
		var valley_ground := hill_height(p) - float(carve.get("valley_depth_m", 1.0)) * exp(-distance * distance / (valley_radius * valley_radius))
		return valley_ground - float(carve.get("water_below_ground_m", 1.35))
	return terrain_height(p) + 1.2

func distance_to_polyline(p: Vector2, points: Array) -> float:
	var nearest := INF
	for i in range(points.size() - 1):
		var a: Vector2 = v2(points[i])
		var b: Vector2 = v2(points[i + 1])
		var ab := b - a
		var t := clampf((p - a).dot(ab) / maxf(ab.length_squared(), 0.0001), 0.0, 1.0)
		nearest = minf(nearest, p.distance_to(a + t * ab))
	return nearest

func validate() -> bool:
	errors.clear()
	var required := ["version", "variant", "method", "seed", "bounds_m", "spawn_xz", "goal_xz", "path_xz", "stream", "crossing", "terrain", "regions", "objects", "exclusions", "provenance"]
	for key in required:
		if not spec.has(key): errors.append("Missing field: " + key)
	if not errors.is_empty(): return false
	if int(spec.version) != 1: errors.append("Expected world_spec version 1")
	for descriptor in [spec.crossing, spec.get("landmark", {})]:
		var path := str(descriptor.get("asset_glb", ""))
		if not path.is_empty() and not valid_optional_glb(path): errors.append("Optional GLB must be an imported res://assets/*.glb: " + path)
	if float(spec.terrain.get("gaussian_coefficient", 0.5)) <= 0.0: errors.append("Gaussian coefficient must be positive")
	if not ["legacy", "none", "valley_channel"].has(stream_carve_kind()): errors.append("Unknown stream carve profile")
	metrics["gaussian_coefficient"] = float(spec.terrain.get("gaussian_coefficient", 0.5))
	metrics["stream_carve_profile"] = stream_carve_kind()
	if spec.bounds_m.size() != 2:
		errors.append("bounds_m must contain width and depth")
	else:
		var width := float(spec.bounds_m[0])
		var depth := float(spec.bounds_m[1])
		if width < 20.0 or depth < 20.0 or width > 256.0 or depth > 256.0:
			errors.append("World bounds must be between 20 and 256 metres per side")
		metrics["bounds_width_m"] = width
		metrics["bounds_depth_m"] = depth
	if spec.path_xz.size() < 3: errors.append("Path requires at least three vertices")
	if spec.stream.get("points_xz", []).size() < 2: errors.append("Stream requires at least two vertices")
	if not errors.is_empty(): return false
	var crossing: Dictionary = spec.crossing
	var center := v2(crossing.get("center_xz", [999, 999]))
	if center.length() > 8.0: errors.append("Crossing is outside the benchmark neighbourhood")
	if float(spec.stream.get("width_m", 0)) < 3.0: errors.append("Stream is too narrow")
	if float(crossing.get("width_m", 0)) < 3.0: errors.append("Bridge is too narrow")
	if float(crossing.get("length_m", 0)) < float(spec.stream.width_m) + 1.0: errors.append("Bridge does not span stream plus banks")
	if distance_to_polyline(center, spec.stream.points_xz) > 1.5: errors.append("Bridge center misses the stream")
	if v2(spec.path_xz[0]).distance_to(v2(spec.spawn_xz)) > 2.5: errors.append("Path misses spawn")
	if v2(spec.path_xz[-1]).distance_to(v2(spec.goal_xz)) > 2.5: errors.append("Path misses goal")
	var nearest_path := distance_to_polyline(center, spec.path_xz)
	if nearest_path > 1.5: errors.append("Path misses bridge center")
	# yaw=0 follows Godot forward (-Z); the deck length is along local Z.
	var bridge_axis := Vector2(sin(float(crossing.get("yaw_rad", 0))), cos(float(crossing.get("yaw_rad", 0))))
	var near_segment := Vector2.RIGHT
	var best := INF
	for i in range(spec.path_xz.size() - 1):
		var a := v2(spec.path_xz[i])
		var b := v2(spec.path_xz[i + 1])
		var midpoint := (a + b) * 0.5
		if midpoint.distance_to(center) < best:
			best = midpoint.distance_to(center)
			near_segment = (b - a).normalized()
	metrics["bridge_route_alignment"] = absf(bridge_axis.dot(near_segment))
	if float(metrics.bridge_route_alignment) < 0.7: errors.append("Bridge deck is misaligned with route")
	var max_grade := 0.0
	for i in range(spec.path_xz.size() - 1):
		var a := v2(spec.path_xz[i])
		var b := v2(spec.path_xz[i + 1])
		var steps := maxi(1, int(ceil(a.distance_to(b))))
		for j in steps:
			var p := a.lerp(b, float(j) / steps)
			var q := a.lerp(b, float(j + 1) / steps)
			if p.distance_to(center) > 5.0 and q.distance_to(center) > 5.0:
				max_grade = maxf(max_grade, absf(terrain_height(p) - terrain_height(q)) / maxf(p.distance_to(q), 0.01))
			if distance_to_polyline(p, spec.stream.points_xz) < float(spec.stream.width_m) * 0.5 and p.distance_to(center) > float(crossing.length_m) * 0.5 + 1.0:
				errors.append("Route enters non-ford stream away from bridge")
	metrics["max_route_grade"] = max_grade
	if max_grade > 0.24: errors.append("Route grade exceeds 0.24")
	for object in spec.objects:
		if not ALLOWED.has(str(object.get("asset_id", ""))): errors.append("Unknown common asset: " + str(object.get("asset_id", "")))
		var xyz: Array = object.get("position_xyz", object.get("center_xyz", []))
		if xyz.size() != 3:
			errors.append("Object has no 3D position")
		else:
			var p := Vector2(float(xyz[0]), float(xyz[2]))
			if not WALKABLE_SURFACE_ASSETS.has(str(object.asset_id)) and distance_to_polyline(p, spec.path_xz) < PATH_HALF_WIDTH + 0.5 and p.distance_to(v2(spec.goal_xz)) > 3.0:
				errors.append("Object obstructs path: " + str(object.asset_id))
	metrics["route_length_m"] = route_length()
	metrics["bridge_width_m"] = float(crossing.width_m)
	metrics["bridge_length_m"] = float(crossing.length_m)
	metrics["path_bridge_offset_m"] = nearest_path
	return errors.is_empty()

func route_length() -> float:
	var length := 0.0
	for i in range(spec.path_xz.size() - 1): length += v2(spec.path_xz[i]).distance_to(v2(spec.path_xz[i + 1]))
	return length

func material(color: Color, roughness := 1.0, metallic := 0.0) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = roughness
	m.metallic = metallic
	return m

func mesh_from_triangles(vertices: PackedVector3Array, mat: Material) -> MeshInstance3D:
	var arrays := []
	arrays.resize(Mesh.ARRAY_MAX)
	arrays[Mesh.ARRAY_VERTEX] = vertices
	var normals := PackedVector3Array()
	for i in range(0, vertices.size(), 3):
		var n := (vertices[i + 1] - vertices[i]).cross(vertices[i + 2] - vertices[i]).normalized()
		for _j in 3: normals.append(n)
	arrays[Mesh.ARRAY_NORMAL] = normals
	var mesh := ArrayMesh.new()
	mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
	mesh.surface_set_material(0, mat)
	var node := MeshInstance3D.new()
	node.mesh = mesh
	return node

func append_quad(out: PackedVector3Array, a: Vector3, b: Vector3, c: Vector3, d: Vector3):
	out.append_array(PackedVector3Array([a, c, b, a, d, c]))

func build_terrain(root: Node3D):
	var vertices := PackedVector3Array()
	var width := float(spec.bounds_m[0])
	var depth := float(spec.bounds_m[1])
	var cells_x := int(ceil(width))
	var cells_z := int(ceil(depth))
	var step_x := width / cells_x
	var step_z := depth / cells_z
	for iz in cells_z:
		for ix in cells_x:
			var x := -width * 0.5 + ix * step_x
			var z := -depth * 0.5 + iz * step_z
			var a := Vector3(x, terrain_height(Vector2(x, z)), z)
			var b := Vector3(x + step_x, terrain_height(Vector2(x + step_x, z)), z)
			var c := Vector3(x + step_x, terrain_height(Vector2(x + step_x, z + step_z)), z + step_z)
			var d := Vector3(x, terrain_height(Vector2(x, z + step_z)), z + step_z)
			append_quad(vertices, a, d, c, b)
	var ground := mesh_from_triangles(vertices, material(Color("719757")))
	ground.name = "Terrain"
	root.add_child(ground)
	var body := StaticBody3D.new()
	body.name = "TerrainCollision"
	root.add_child(body)
	var shape := CollisionShape3D.new()
	var collision := ConcavePolygonShape3D.new()
	collision.set_faces(vertices)
	shape.shape = collision
	body.add_child(shape)
	metrics["terrain_triangles"] = vertices.size() / 3

func build_strip(root: Node3D, name: String, points: Array, width: float, color: Color, is_stream := false):
	var vertices := PackedVector3Array()
	var samples: Array[Vector2] = []
	for i in range(points.size() - 1):
		var a := v2(points[i])
		var b := v2(points[i + 1])
		var steps := maxi(1, int(ceil(a.distance_to(b))))
		for j in steps: samples.append(a.lerp(b, float(j) / steps))
	samples.append(v2(points[-1]))
	for i in range(samples.size() - 1):
		var p := samples[i]
		var q := samples[i + 1]
		if not is_stream and (p.distance_to(v2(spec.crossing.center_xz)) < 3.0 or q.distance_to(v2(spec.crossing.center_xz)) < 3.0): continue
		var before: Vector2 = samples[maxi(i - 1, 0)]
		var after: Vector2 = samples[mini(i + 2, samples.size() - 1)]
		var dp := (q - before).normalized()
		var dq := (after - p).normalized()
		var sp := Vector2(-dp.y, dp.x) * width * 0.5
		var sq := Vector2(-dq.y, dq.x) * width * 0.5
		var h1 := water_height(p) if is_stream else terrain_height(p) + 0.06
		var h2 := water_height(q) if is_stream else terrain_height(q) + 0.06
		append_quad(vertices, Vector3(p.x - sp.x, h1, p.y - sp.y), Vector3(p.x + sp.x, h1, p.y + sp.y), Vector3(q.x + sq.x, h2, q.y + sq.y), Vector3(q.x - sq.x, h2, q.y - sq.y))
	var node := mesh_from_triangles(vertices, material(color, 0.65 if is_stream else 1.0))
	node.name = name
	root.add_child(node)
	metrics[name.to_snake_case() + "_triangles"] = vertices.size() / 3

func add_box(root: Node3D, name: String, position: Vector3, size: Vector3, mat: Material, collision := true):
	var mesh := BoxMesh.new()
	mesh.size = size
	var node := MeshInstance3D.new()
	node.name = name
	node.mesh = mesh
	node.material_override = mat
	node.position = position
	root.add_child(node)
	if collision:
		var body := StaticBody3D.new()
		body.name = name + "Collision"
		body.position = position
		root.add_child(body)
		var shape := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = size
		shape.shape = box
		body.add_child(shape)

func add_collision_box(root: Node3D, name: String, position: Vector3, size: Vector3):
	var body := StaticBody3D.new()
	body.name = name
	body.collision_layer = 1 | (1 << 19)
	body.position = position
	root.add_child(body)
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)

func instantiate_optional_glb(parent: Node3D, path: String, name: String) -> Node3D:
	var packed := load(path) as PackedScene
	if packed == null:
		errors.append("Cannot load optional GLB: " + path)
		return null
	var visual := packed.instantiate() as Node3D
	if visual == null:
		errors.append("Optional GLB root is not Node3D: " + path)
		return null
	visual.name = name
	parent.add_child(visual)
	if path.begins_with(ASSETS): FINISH.apply_tree(visual)
	return visual

func build_bridge(root: Node3D):
	var crossing: Dictionary = spec.crossing
	var c := v2(crossing.center_xz)
	var yaw := float(crossing.yaw_rad)
	var bridge := Node3D.new()
	bridge.name = "Bridge"
	bridge.position = Vector3(c.x, float(spec.terrain.get("base_y", spec.terrain.get("base_height_m", 0.0))) + 0.45, c.y)
	bridge.rotation.y = yaw
	root.add_child(bridge)
	var length := float(crossing.length_m)
	var width := float(crossing.width_m)
	var stone := material(Color("8e8980"))
	var dark := material(Color("656865"))
	var specialist_path := str(crossing.get("asset_glb", ""))
	if specialist_path.is_empty():
		add_box(bridge, "WalkableDeck", Vector3(0, 0, 0), Vector3(width, 0.36, length), stone)
	else:
		var visual := instantiate_optional_glb(bridge, specialist_path, "SpecialistBridgeVisual")
		if visual != null:
			visual.position.y = float(crossing.get("asset_y_offset_m", 0.0))
			visual.rotation.y = float(crossing.get("asset_yaw_offset_rad", 0.0))
			visual.scale = Vector3.ONE * float(crossing.get("asset_scale", 1.0))
		add_collision_box(bridge, "WalkableDeckCollision", Vector3.ZERO, Vector3(width, 0.36, length))
		metrics["bridge_visual_asset"] = specialist_path
		metrics["bridge_collision_fallback"] = true
		return
	for side in [-1.0, 1.0]:
		add_box(bridge, "Parapet", Vector3(side * (width * 0.5 + 0.16), 0.55, 0), Vector3(0.32, 0.85, length), dark)
		for end in [-1.0, 1.0]: add_box(bridge, "Pier", Vector3(side * (width * 0.5 - 0.2), -0.85, end * (length * 0.5 - 0.45)), Vector3(0.65, 1.6, 0.9), stone)
	metrics["bridge_visual_asset"] = "procedural"
	metrics["bridge_collision_fallback"] = false

func build_landmark(root: Node3D):
	var landmark: Dictionary = spec.get("landmark", {})
	var path := str(landmark.get("asset_glb", ""))
	if path.is_empty(): return
	var goal := v2(spec.goal_xz)
	var position := Vector3(goal.x, terrain_height(goal), goal.y)
	var coordinates: Array = landmark.get("position_xyz", [])
	if coordinates.size() == 3: position = Vector3(float(coordinates[0]), float(coordinates[1]), float(coordinates[2]))
	var pivot := Node3D.new()
	pivot.name = "Landmark"
	pivot.position = position
	pivot.rotation.y = float(landmark.get("yaw_rad", 0.0))
	root.add_child(pivot)
	var visual := instantiate_optional_glb(pivot, path, "SpecialistLandmarkVisual")
	if visual != null:
		visual.scale = Vector3.ONE * float(landmark.get("scale", 1.0))
		visual.position.y = float(landmark.get("asset_y_offset_m", 0.0))
	var collider := StaticBody3D.new()
	collider.name = "LandmarkFallbackCollision"
	collider.collision_layer = 1 | (1 << 18)
	pivot.add_child(collider)
	var shape := CollisionShape3D.new()
	var cylinder := CylinderShape3D.new()
	cylinder.radius = maxf(float(landmark.get("collision_radius_m", 0.6)), 0.2)
	cylinder.height = maxf(float(landmark.get("collision_height_m", 2.0)), 0.2)
	shape.position.y = cylinder.height * 0.5
	shape.shape = cylinder
	collider.add_child(shape)
	metrics["landmark_visual_asset"] = path
	metrics["landmark_collision_fallback"] = true

func point_in_polygon(p: Vector2, polygon: Array) -> bool:
	var inside := false
	for i in polygon.size():
		var a := v2(polygon[i])
		var b := v2(polygon[(i + 1) % polygon.size()])
		if (a.y > p.y) != (b.y > p.y) and p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x: inside = not inside
	return inside

func excluded(p: Vector2) -> bool:
	if distance_to_polyline(p, spec.path_xz) < PATH_HALF_WIDTH + 1.2: return true
	if distance_to_polyline(p, spec.stream.points_xz) < float(spec.stream.width_m) * 0.5 + 1.0: return true
	if p.distance_to(v2(spec.crossing.center_xz)) < 6.0: return true
	if p.distance_to(v2(spec.spawn_xz)) < 4.0 or p.distance_to(v2(spec.goal_xz)) < 5.0: return true
	for zone in spec.exclusions:
		if zone.has("polygon_xz") and point_in_polygon(p, zone.polygon_xz): return true
		if zone.has("center_xz") and p.distance_to(v2(zone.center_xz)) < float(zone.get("radius_m", 0)): return true
	return false

func add_asset(root: Node3D, id: String, position: Vector3, yaw: float, scale: float):
	if not asset_cache.has(id): asset_cache[id] = load(ASSETS + id + ".glb")
	var packed: PackedScene = asset_cache[id]
	if packed == null:
		errors.append("Cannot load asset " + id)
		return
	var node := packed.instantiate() as Node3D
	if node == null:
		errors.append("Asset root is not Node3D: " + id)
		return
	node.name = id
	node.position = position
	node.rotation.y = yaw
	node.scale = Vector3.ONE * scale
	FINISH.apply_tree(node)
	root.add_child(node)
	metrics["asset_instances"] = int(metrics.get("asset_instances", 0)) + 1
	if not WALKABLE_SURFACE_ASSETS.has(id): add_footprint(root, id, position, scale)

func add_footprint(root: Node3D, id: String, position: Vector3, scale: float):
	var collider := StaticBody3D.new()
	collider.name = id + "Footprint"
	collider.position = position
	root.add_child(collider)
	var shape := CollisionShape3D.new()
	var cylinder := CylinderShape3D.new()
	cylinder.radius = (0.55 if id.begins_with("apple_tree") else 0.35) * scale
	cylinder.height = 1.8 * scale
	shape.position.y = cylinder.height * 0.5
	shape.shape = cylinder
	collider.add_child(shape)

func build_objects(root: Node3D):
	for obj in spec.objects:
		var c: Array = obj.get("position_xyz", obj.get("center_xyz", [0, 0, 0]))
		add_asset(root, str(obj.asset_id), Vector3(float(c[0]), float(c[1]), float(c[2])), float(obj.get("yaw_rad", 0)), float(obj.get("scale", 1)))
	var placed := 0
	var batches := {}
	var half_width := float(spec.bounds_m[0]) * 0.5
	var half_depth := float(spec.bounds_m[1]) * 0.5
	var area_ratio := float(spec.bounds_m[0]) * float(spec.bounds_m[1]) / 6400.0
	for region in spec.regions:
		var density := clampf(float(region.get("tree_density", 0)), 0.0, 1.0)
		var polygon: Array = region.get("polygon_xz", [])
		if polygon.size() < 3 or density <= 0: continue
		var samples := mini(int(240 * area_ratio), int(640 * density * area_ratio))
		for _i in samples:
			var p := Vector2(rng.randf_range(-half_width + 2.0, half_width - 2.0), rng.randf_range(-half_depth + 2.0, half_depth - 2.0))
			if not point_in_polygon(p, polygon) or excluded(p): continue
			var ids := ["apple_tree_mature", "apple_tree_mature_b", "apple_tree_young", "shrub_flowering", "rock_mossy_small"]
			var id: String = ids[rng.randi_range(0, ids.size() - 1)]
			var position := Vector3(p.x, terrain_height(p), p.y)
			var scale := rng.randf_range(0.8, 1.18)
			if not batches.has(id): batches[id] = []
			batches[id].append({"at": position, "yaw": rng.randf_range(-PI, PI), "scale": scale})
			add_footprint(root, id, position, scale)
			placed += 1
	for id in batches:
		var first_child := root.get_child_count()
		ORCHARD_ART._emit(root, id, batches[id])
		for child_index in range(first_child, root.get_child_count()):
			var holder := root.get_child(child_index) as MultiMeshInstance3D
			if holder != null: holder.visibility_range_end = 0.0
	metrics["asset_instances"] = int(metrics.get("asset_instances", 0)) + placed
	metrics["procedural_foliage"] = placed

func build() -> Node3D:
	if not validate(): return null
	var root := Node3D.new()
	root.name = "OrchardBrook_" + str(spec.variant)
	build_terrain(root)
	build_strip(root, "Stream", spec.stream.points_xz, float(spec.stream.width_m), Color("438eaa"), true)
	build_strip(root, "Path", spec.path_xz, PATH_HALF_WIDTH * 2.0, Color("af8156"))
	build_bridge(root)
	build_objects(root)
	build_landmark(root)
	var sun := DirectionalLight3D.new()
	sun.name = "CommonSun"
	sun.rotation_degrees = Vector3(-48, -28, 0)
	sun.light_energy = 1.25
	root.add_child(sun)
	var world := WorldEnvironment.new()
	world.name = "CommonEnvironment"
	world.environment = Environment.new()
	world.environment.background_mode = Environment.BG_COLOR
	world.environment.background_color = Color("a9c6ce")
	world.environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	world.environment.ambient_light_color = Color("b6c4b8")
	world.environment.ambient_light_energy = 0.75
	root.add_child(world)
	metrics["node_count"] = count_nodes(root)
	return root

func count_nodes(root: Node) -> int:
	var count := 1
	for child in root.get_children(): count += count_nodes(child)
	return count
