extends RefCounted
## Opus woodland kit placed from the SAME masks that shade the Orchard ground.
## Each species is one textured mesh, chunked into bounded MultiMeshes for VR.
const Ground = preload("res://orchard_ground.gd")
const Foliage = preload("res://orchard_foliage.gd")
const GroundKitScript = preload("res://ground_kit.gd")
const Fields = preload("res://landscape_fields.gd")
const PREFIX := "res://assets/atmosphere/woodland/"
const SONNET_PREFIX := "res://assets/atmosphere/sonnet_bank/"
const SONNET_VARIANTS := {
	"rock_mossy_boulder": "bank_boulder",
	"rock_mossy_slab": "river_slab",
	"branch_fallen_mossy": "fallen_branch",
	"fern_bank_patch": "fern_patch",
}
# Retired legacy species. The chunky single-mesh flower_clump is superseded by the surface kit's PBR
# meadow_flowers (placed by ground_kit.gd as drifts). It is still *placed* so the shared RNG stream, and
# therefore every later asset and rock collision, stays identical; it is simply not emitted.
const RETIRED := ["flower_clump"]
# Understory rim: tufts/ferns that gather at stones and fallen wood. Own RNG, appended after the main pass,
# and counted well under the retired flower + legacy gk_grass instances (see HANDOFF.md budget table).
const RIM_PLANTS := {"grass_tuft": [3, 6], "fern_lady": [1, 2]}
const RIM_CHANCE := 0.72
const CHUNK := 64.0
const EXTENT := 153.0
const COUNTS := {
	"fern_sword": 1800, "fern_lady": 1400, "fern_bracken": 1200,
	"grass_tuft": 4300, "flower_clump": 1300,
	"branch_fallen_mossy": 140, "rock_mossy_boulder": 130,
	"rock_mossy_slab": 90, "litter_leaf_cluster": 2000,
	"fern_bank_patch": 480,
}
# Habitat art (2026-10-01): tree bases, path shoulders and real-river banks. Every pass owns a separate seed
# stream and a hard instance budget, so it can never shift the gameplay rocks/collision of the main pass.
const HABITAT_SEED := 61303
const HABITAT_CULL := 0.7            # tiny props fade sooner than full-size woodland, and cast no shadow
const TREE_BASE_MAX := 8
const TREE_BASE_TREES := 400
const PATH_EDGE_BUDGET := 190
const BANK_QUALITY_MAX := 1.15
const BANK_BUDGET := {
	"rock_mossy_boulder": 34, "rock_mossy_slab": 26, "fern_bank_patch": 90, "litter_leaf_cluster": 66,
	"grass_tuft": 66, "fern_lady": 40, "branch_fallen_mossy": 18,
}   # 340 at quality 1.0, 391 at the 1.15 cap (< 400)
const CULL := {"fern_sword": 48.0, "fern_lady": 48.0, "fern_bracken": 48.0,
	"grass_tuft": 43.0, "flower_clump": 41.0, "branch_fallen_mossy": 63.0,
	"rock_mossy_boulder": 85.0, "rock_mossy_slab": 85.0, "litter_leaf_cluster": 30.0,
	"fern_bank_patch": 48.0}

static func _kind(id: String) -> String:
	if id.begins_with("fern_"): return "fern"
	if id == "grass_tuft": return "grass"
	if id == "flower_clump": return "flower"
	if id == "litter_leaf_cluster": return "litter"
	return "rock" if id.begins_with("rock_") else "wood"

static func _chance(id: String, mask: Color, patch: float) -> float:
	var leaf := mask.g
	var bank := mask.b
	var stone := mask.a
	var profile := 0.2
	match _kind(id):
		"fern": profile = 0.22 + leaf * 0.49 + bank * 0.29
		"grass": profile = 0.75 - leaf * 0.33 - bank * 0.30
		"flower": profile = 0.19 + leaf * 0.21 + (1.0 - bank) * 0.16
		"litter": profile = 0.13 + leaf * 0.72
		"rock": profile = 0.13 + stone * 0.51 + bank * 0.35
		"wood": profile = 0.12 + leaf * 0.68
	return clampf(profile * (0.33 + patch * 0.92) * (1.0 - mask.r * 0.95), 0.0, 1.0)

static func _asset(id: String) -> Dictionary:
	var variant: String = SONNET_VARIANTS.get(id, "")
	var variant_path := SONNET_PREFIX + variant + ".glb"
	var use_variant := not variant.is_empty() and ResourceLoader.exists(variant_path)
	var packed: PackedScene = load(variant_path if use_variant else PREFIX + id + ".glb")
	if packed == null: return {}
	var art: Node3D = packed.instantiate()
	var parts := art.find_children("*", "MeshInstance3D", true, false)
	if parts.size() != 1:
		art.free()
		push_error("WOODLAND asset requires exactly one mesh: " + id)
		return {}
	var mesh: Mesh = parts[0].mesh
	var source: StandardMaterial3D = mesh.surface_get_material(0) as StandardMaterial3D
	art.free()
	if source == null or source.albedo_texture == null or source.roughness_texture == null:
		push_error("WOODLAND texture import incomplete: " + id)
		return {}
	return {"mesh": mesh, "finish": Foliage.kit_material(_kind(id), source, id if use_variant else "")}

static func populate(root: Node3D) -> void:
	var scale := 1.0
	for arg in OS.get_cmdline_user_args():
		if arg == "--atmosphere-quality=low": scale = 0.47
		elif arg == "--atmosphere-quality=high": scale = 1.35
	var rng := RandomNumberGenerator.new()
	var model: Dictionary = root.get_meta("landscape_model", {})
	rng.seed = int(model.seed) if not model.is_empty() else 290929
	var trail: Array = root.get_meta("orchard_trail", [])
	var total := 0
	var rim_anchors: Array[Vector3] = []
	for id in COUNTS:
		var source := _asset(id)
		if source.is_empty(): continue
		var target: int = roundi(int(COUNTS[id]) * scale)
		var placements: Array[Transform3D] = []
		var attempts := 0
		while placements.size() < target and attempts < target * 24:
			attempts += 1
			var point := Vector3(rng.randf_range(-EXTENT, EXTENT), 0.0, rng.randf_range(-EXTENT, EXTENT))
			if not GroundKitScript._allowed("orchard_highlands", point, trail): continue
			if point.distance_to(Vector3(15, 0, -27)) < 10.5: continue
			if point.distance_to(Vector3(25, 0, -48)) < 6.0: continue
			var field_kind := "rock" if _kind(id) == "rock" else "shrub" if _kind(id) == "fern" else "grass"
			if not model.is_empty() and rng.randf() > GroundKitScript.field_chance(model, Vector2(point.x, point.z), field_kind): continue
			var mask := Ground.sample(Vector2(point.x, point.z))
			if mask.r > 0.48 or mask.b > 0.87: continue
			var patch := clampf(0.5 + 0.25 * sin(point.x * 0.077 + cos(point.z * 0.089)) +
				0.25 * cos(point.z * 0.071 - sin(point.x * 0.063)), 0.0, 1.0)
			if rng.randf() > _chance(id, mask, patch): continue
			var size := rng.randf_range(0.73, 1.23)
			if id == "fern_bracken": size *= 1.18
			elif id == "rock_mossy_slab": size *= 1.3
			elif id == "grass_tuft": size *= rng.randf_range(0.68, 1.05)
			var pose := Transform3D(Basis(Vector3.UP, rng.randf_range(0, TAU)).scaled(Vector3.ONE * size), point - Vector3.UP * (0.035 if _kind(id) == "rock" else 0.0))
			placements.append(pose)
			if _kind(id) == "rock":
				_rock_collision(root, id, pose)
				rim_anchors.append(point)
			elif id == "branch_fallen_mossy":
				rim_anchors.append(point)
		if RETIRED.has(id): continue
		_emit(root, id, source, placements)
		total += placements.size()
	total += _rim_pass(root, rim_anchors, trail, model, scale)
	print("WOODLAND_DRESSING density=", scale, " instances=", total, " assets=", COUNTS.size(), " chunk_m=", CHUNK)
	populate_habitat(root, trail, model, scale)

static func populate_habitat(root: Node3D, trail: Array, model: Dictionary, quality: float) -> int:
	## Independent art passes, appended after (never interleaved with) the legacy placement stream.
	var base := _tree_base_pass(root, trail, model, quality)
	var edge := _path_edge_pass(root, trail, model, quality)
	var bank := _bank_pass(root, trail, model, quality)
	print("ORCHARD_HABITAT density=", quality, " tree_base=", base, " path_edge=", edge, " bank=", bank)
	return base + edge + bank

static func _rim_pass(root: Node3D, anchors: Array[Vector3], trail: Array, model: Dictionary, quality: float) -> int:
	## Ecotone: plants hug the feet of boulders, slabs and logs, shaded side first, leaving the lawn between
	## them open. Deterministic (own seed), same exclusion/field rules as the main pass, batched per species.
	var rng := RandomNumberGenerator.new()
	rng.seed = (int(model.seed) if not model.is_empty() else 290929) + 4417
	var groups := {}
	for id in RIM_PLANTS: groups[id] = []
	for anchor in anchors:
		if rng.randf() > RIM_CHANCE: continue
		for id in RIM_PLANTS:
			var span: Array = RIM_PLANTS[id]
			var count := roundi(rng.randf_range(float(span[0]), float(span[1])) * quality)
			for k in range(count):
				var angle := rng.randf_range(0.0, TAU)
				# bias toward the north-west (shaded, damper) foot of the stone
				angle = lerp_angle(angle, 2.35, 0.35)
				var point := anchor + Vector3(cos(angle), 0.0, sin(angle)) * rng.randf_range(0.65, 1.7)
				if not GroundKitScript._allowed("orchard_highlands", point, trail): continue
				if point.distance_to(Vector3(15, 0, -27)) < 10.5 or point.distance_to(Vector3(25, 0, -48)) < 6.0: continue
				if not model.is_empty() and rng.randf() > GroundKitScript.field_chance(model, Vector2(point.x, point.z), "grass"): continue
				var mask := Ground.sample(Vector2(point.x, point.z))
				if mask.r > 0.48 or mask.b > 0.87: continue
				var size := rng.randf_range(0.7, 1.15)
				groups[id].append(Transform3D(Basis(Vector3.UP, rng.randf_range(0, TAU)).scaled(Vector3.ONE * size), point))
	var total := 0
	for id in groups:
		var source := _asset(id)
		if source.is_empty() or groups[id].is_empty(): continue
		_emit(root, id, source, groups[id], "rim_")
		total += groups[id].size()
	return total

static func _rock_collision(root: Node3D, id: String, pose: Transform3D) -> void:
	var body := StaticBody3D.new()
	body.name = "WoodlandRockCollision"
	body.set_meta("kind", "solid")
	body.transform = pose
	root.add_child(body)
	var shape := BoxShape3D.new()
	shape.size = Vector3(1.18, 0.68, 1.02) if id == "rock_mossy_boulder" else Vector3(1.42, 0.21, 0.96)
	var collider := CollisionShape3D.new()
	collider.shape = shape
	collider.position.y = shape.size.y * 0.48
	body.add_child(collider)

static func _emit(root: Node3D, id: String, source: Dictionary, placements: Array, tag: String = "", cull_scale: float = 1.0) -> void:
	var chunks: Dictionary = {}
	for pose in placements:
		var key := Vector2i(floori(pose.origin.x / CHUNK), floori(pose.origin.z / CHUNK))
		if not chunks.has(key): chunks[key] = []
		chunks[key].append(pose)
	for key in chunks:
		var origin := Vector3((float(key.x) + 0.5) * CHUNK, 0.0, (float(key.y) + 0.5) * CHUNK)
		var poses: Array = chunks[key]
		var batch := MultiMesh.new()
		batch.transform_format = MultiMesh.TRANSFORM_3D
		batch.mesh = source.mesh
		batch.instance_count = poses.size()
		batch.custom_aabb = AABB(Vector3(-CHUNK * 0.5 - 3, -0.1, -CHUNK * 0.5 - 3), Vector3(CHUNK + 6, 2.5, CHUNK + 6))
		for i in range(poses.size()):
			batch.set_instance_transform(i, Transform3D(poses[i].basis, poses[i].origin - origin))
		var holder := MultiMeshInstance3D.new()
		holder.name = "Woodland_" + tag + id + "_%d_%d" % [key.x, key.y]
		holder.position = origin
		holder.multimesh = batch
		var addresses := PackedVector3Array()
		for pose in poses: addresses.append(pose.origin)
		holder.set_meta("dressing_positions", addresses)
		var hidden := PackedByteArray()
		hidden.resize(poses.size())
		holder.set_meta("dressing_hidden", hidden)
		holder.material_override = source.finish
		holder.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if cull_scale >= 1.0 and _kind(id) in ["rock", "wood", "fern"] else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		holder.visibility_range_end = float(CULL[id]) * cull_scale
		holder.visibility_range_end_margin = 9.0
		root.add_child(holder)

static func clear_path(root: Node3D, a: Vector3, b: Vector3) -> void:
	# A carved route removes its old undergrowth and rock proxies immediately.
	var span := b - a
	for child in root.get_children():
		if child is StaticBody3D and child.name == "WoodlandRockCollision":
			var point: Vector3 = child.position
			var t := clampf((point - a).dot(span) / maxf(span.length_squared(), 0.001), 0.0, 1.0)
			if point.distance_to(a + span * t) < 2.2: child.queue_free()
		elif child is MultiMeshInstance3D and (child.name.begins_with("Woodland_") or child.name.begins_with("gk_grass")):
			var batch: MultiMesh = child.multimesh
			var addresses: PackedVector3Array = child.get_meta("dressing_positions", PackedVector3Array())
			var hidden: PackedByteArray = child.get_meta("dressing_hidden", PackedByteArray())
			for i in range(batch.instance_count):
				if hidden.size() == batch.instance_count and hidden[i] > 0: continue
				var point: Vector3 = addresses[i] if addresses.size() == batch.instance_count else batch.get_instance_transform(i).origin + child.position
				var t := clampf((point - a).dot(span) / maxf(span.length_squared(), 0.001), 0.0, 1.0)
				if point.distance_to(a + span * t) < 2.2:
					batch.set_instance_transform(i, Transform3D(Basis.IDENTITY.scaled(Vector3.ONE * 0.001), Vector3(0, -200, 0)))
					if hidden.size() == batch.instance_count: hidden[i] = 1
			if hidden.size() == batch.instance_count: child.set_meta("dressing_hidden", hidden)

static func brook_bank(root: Node3D, center_z: float) -> void:
	# Mossy stones follow the same meander as the water, but occur in loose runs
	# and gaps. Both variants remain a handful of draw calls, not eighty props.
	# Real hydrology present: populate_habitat() already placed the bank art from river_distance/river_width.
	# This legacy sine (which does not match the procedural rivers) now only serves model-less roots.
	var live_model: Dictionary = root.get_meta("landscape_model", {})
	if not live_model.is_empty():
		if not bool(root.get_meta("orchard_bank_dressed", false)):
			_bank_pass(root, root.get_meta("orchard_trail", []), live_model, 1.0)
		return
	var rng := RandomNumberGenerator.new()
	rng.seed = 290930
	var groups := {"rock_mossy_boulder": [], "rock_mossy_slab": []}
	for i in range(80):
		if i % 3 == 1 or rng.randf() > 0.76: continue
		var x := -28.0 + float(i) * 1.5 + rng.randf_range(-0.48, 0.48)
		var drift := sin(x * 0.078) * 1.1 + sin(x * 0.18) * 0.25
		var half_width := 2.2 + sin(x * 0.13) * 0.16
		for side in [-1.0, 1.0]:
			if rng.randf() > 0.78: continue
			var id := "rock_mossy_boulder" if rng.randf() > 0.42 else "rock_mossy_slab"
			var at := Vector3(x, -0.13, center_z + drift + side * (half_width + rng.randf_range(0.22, 0.62)))
			var size := rng.randf_range(0.42, 0.76)
			groups[id].append(Transform3D(Basis(Vector3.UP, rng.randf_range(0, TAU)).scaled(Vector3.ONE * size), at))
	for id in groups:
		var asset := _asset(id)
		if not asset.is_empty(): _emit(root, id, asset, groups[id])

# ---------------------------------------------------------------------------------------------------------
# Habitat art. Everything below reuses _asset()/_emit() (existing textured families, chunked MultiMeshes,
# dressing_positions / dressing_hidden metadata, "Woodland_" names so clear_path() carves it too). Placements
# are y=0; the framework grounds them. No collision, no new meshes, no lights, no per-frame work.
# ---------------------------------------------------------------------------------------------------------

static func _habitat_seed(model: Dictionary, stream: int) -> int:
	return (int(model.seed) if not model.is_empty() else 290929) + HABITAT_SEED + stream * 101

static func _water_margin(model: Dictionary, point: Vector3) -> float:
	## Metres from the actual water edge. river_distance is distance to the river centreline and river_width is the
	## full channel width at that nearest point, so the edge is where distance == width / 2 (see hydrology run()).
	if model.is_empty() or not model.has("river_distance"): return 1000.0
	var at := Vector2(point.x, point.z)
	if Fields.sample(model, "water", at) > 0.02: return -1.0
	return Fields.sample(model, "river_distance", at) - Fields.sample(model, "river_width", at) * 0.5

static func _habitat_ok(point: Vector3, trail: Array, model: Dictionary, max_path: float, margin: float) -> bool:
	if not GroundKitScript._allowed("orchard_highlands", point, trail): return false
	if point.distance_to(Vector3(15, 0, -27)) < 10.5 or point.distance_to(Vector3(25, 0, -48)) < 6.0: return false
	if Ground.sample(Vector2(point.x, point.z)).r > max_path: return false
	if not model.is_empty():
		if GroundKitScript.field_chance(model, Vector2(point.x, point.z), "grass") <= 0.0: return false
		if _water_margin(model, point) < margin: return false
	return true

static func _habitat_pose(yaw: float, size: float, point: Vector3, sink: float = 0.0) -> Transform3D:
	return Transform3D(Basis(Vector3.UP, yaw).scaled(Vector3.ONE * size), Vector3(point.x, -sink, point.z))

static func _emit_groups(root: Node3D, groups: Dictionary, tag: String) -> int:
	var total := 0
	for id in groups:
		var poses: Array = groups[id]
		if poses.is_empty(): continue
		var source := _asset(str(id))
		if source.is_empty(): continue
		_emit(root, str(id), source, poses, tag, HABITAT_CULL)
		total += poses.size()
	return total

static func _tree_base_pass(root: Node3D, trail: Array, model: Dictionary, quality: float) -> int:
	## Leaf drift that gathers on the lee side of each trunk, a couple of mossy twigs, a fern and grass tufts at the
	## root margin. Clustered into 1-2 lobes (never a ring), nothing inside ~1.1 m of the trunk so roots stay clear.
	var positions: Variant = root.get_meta("orchard_tree_positions", PackedVector3Array())
	if not (positions is PackedVector3Array or positions is Array): return 0
	var rng := RandomNumberGenerator.new()
	rng.seed = _habitat_seed(model, 1)
	var q := clampf(quality, 0.47, 1.12)
	var slots: Array[String] = ["litter_leaf_cluster", "litter_leaf_cluster", "grass_tuft", "litter_leaf_cluster",
		"branch_fallen_mossy", "grass_tuft", "fern_lady", "litter_leaf_cluster"]
	var lee := atan2(0.30, 0.95)   # downwind of the Foliage default wind: leaves pile up there
	var groups := {"litter_leaf_cluster": [], "grass_tuft": [], "branch_fallen_mossy": [], "fern_lady": []}
	var seen := 0
	for entry in positions:
		if seen >= TREE_BASE_TREES: break
		if not entry is Vector3: continue
		seen += 1
		var tree_at: Vector3 = entry
		var count := clampi(roundi(rng.randf_range(5.0, 8.0) * q), 2, TREE_BASE_MAX)
		var lobes: Array[float] = [lee + rng.randf_range(-0.7, 0.7), rng.randf_range(0.0, TAU)]
		for slot in range(count):
			var id: String = slots[slot]
			var lobe: float = lobes[0] if rng.randf() < 0.7 else lobes[1]
			var angle: float = lobe + (rng.randf() + rng.randf() - 1.0) * 0.75
			var radius: float = 1.15 + pow(rng.randf(), 1.6) * 1.5
			var yaw: float = rng.randf_range(0.0, TAU)
			var size: float = rng.randf_range(0.8, 1.25)
			match id:
				"grass_tuft":
					radius = rng.randf_range(1.35, 2.7)
					size = rng.randf_range(0.7, 1.0)
				"branch_fallen_mossy":
					radius = rng.randf_range(1.6, 3.0)
					angle = rng.randf_range(0.0, TAU)
					yaw = angle + PI * 0.5 + rng.randf_range(-0.5, 0.5)   # lies tangent to the trunk
					size = rng.randf_range(0.32, 0.55)
				"fern_lady":
					radius = rng.randf_range(1.9, 3.1)
					size = rng.randf_range(0.7, 1.0)
			var point := Vector3(tree_at.x + cos(angle) * radius, 0.0, tree_at.z + sin(angle) * radius)
			if not _habitat_ok(point, trail, model, 0.30, 0.6): continue
			groups[id].append(_habitat_pose(yaw, size, point))
	return _emit_groups(root, groups, "base_")

static func _path_edge_pass(root: Node3D, trail: Array, model: Dictionary, quality: float) -> int:
	## Sparse stones, dried leaves and tufts on the SHOULDERS of the authored trail (3.3-5.2 m off the line; the
	## existing exclusion keeps the tread itself clear). Runs and gaps from a noise, not a regular dotted border.
	if trail.size() < 2: return 0
	var rng := RandomNumberGenerator.new()
	rng.seed = _habitat_seed(model, 2)
	var run := FastNoiseLite.new()
	run.seed = _habitat_seed(model, 3) % 2147483647
	run.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	run.frequency = 0.07
	var budget := roundi(float(PATH_EDGE_BUDGET) * clampf(quality, 0.47, 1.15))
	var groups := {"rock_mossy_boulder": [], "litter_leaf_cluster": [], "grass_tuft": [], "fern_lady": [], "branch_fallen_mossy": []}
	var placed := 0
	for i in range(trail.size() - 1):
		var a: Vector3 = trail[i]
		var b: Vector3 = trail[i + 1]
		var seg := Vector3(b.x - a.x, 0.0, b.z - a.z)
		var length := seg.length()
		if length < 0.5: continue
		var dir := seg / length
		var normal := Vector3(-dir.z, 0.0, dir.x)
		var along := rng.randf_range(0.0, 2.0)
		var guard := 0
		while along < length and placed < budget and guard < 600:
			guard += 1
			along += rng.randf_range(1.5, 3.3)
			var centre := Vector3(a.x + dir.x * along, 0.0, a.z + dir.z * along)
			var tempo := run.get_noise_2d(centre.x, centre.z)
			if tempo < -0.06: continue   # a gap in the run
			for side in [-1.0, 1.0]:
				if placed >= budget: break
				if rng.randf() > 0.42 + 0.5 * tempo: continue
				var lateral := rng.randf_range(3.3, 5.2)
				var point := centre + normal * float(side) * lateral + dir * rng.randf_range(-0.9, 0.9)
				if not _habitat_ok(point, trail, model, 0.45, 0.8): continue
				var pick := rng.randf()
				if pick < 0.30:
					groups["rock_mossy_boulder"].append(_habitat_pose(rng.randf_range(0.0, TAU), rng.randf_range(0.2, 0.42), point, 0.04))
					placed += 1
					if rng.randf() < 0.5 and placed < budget:   # a pebble companion beside the stone
						var chip := point + Vector3(rng.randf_range(-0.7, 0.7), 0.0, rng.randf_range(-0.7, 0.7))
						if _habitat_ok(chip, trail, model, 0.45, 0.8):
							groups["rock_mossy_boulder"].append(_habitat_pose(rng.randf_range(0.0, TAU), rng.randf_range(0.12, 0.24), chip, 0.03))
							placed += 1
				elif pick < 0.66:
					groups["litter_leaf_cluster"].append(_habitat_pose(rng.randf_range(0.0, TAU), rng.randf_range(0.75, 1.2), point))
					placed += 1
				elif pick < 0.86:
					groups["grass_tuft"].append(_habitat_pose(rng.randf_range(0.0, TAU), rng.randf_range(0.7, 1.05), point))
					placed += 1
				elif pick < 0.93:
					groups["fern_lady"].append(_habitat_pose(rng.randf_range(0.0, TAU), rng.randf_range(0.65, 0.95), point))
					placed += 1
				else:
					var yaw := atan2(-dir.z, dir.x) + rng.randf_range(-0.6, 0.6)
					groups["branch_fallen_mossy"].append(_habitat_pose(yaw, rng.randf_range(0.34, 0.55), point))
					placed += 1
	return _emit_groups(root, groups, "edge_")

static func _bank_profile(id: String, offset: float) -> float:
	## Where (metres outside the water edge) each family belongs: stones hug the waterline, ferns/tufts sit a little
	## back, litter collects on the dry rim. Smooth ramps, so the families overlap into a natural ecotone.
	match id:
		"rock_mossy_boulder", "rock_mossy_slab": return smoothstep(0.35, 0.75, offset) * (1.0 - smoothstep(1.2, 2.0, offset))
		"fern_bank_patch": return smoothstep(0.7, 1.3, offset) * (1.0 - smoothstep(2.6, 3.6, offset))
		"litter_leaf_cluster": return smoothstep(1.4, 2.2, offset)
		"grass_tuft": return smoothstep(1.0, 1.8, offset) * 0.8
		"fern_lady": return smoothstep(1.2, 2.0, offset) * (1.0 - smoothstep(3.0, 3.6, offset))
		"branch_fallen_mossy": return smoothstep(0.5, 1.0, offset) * (1.0 - smoothstep(1.6, 2.6, offset))
	return 0.0

static func _bank_tangent(model: Dictionary, point: Vector3) -> Vector2:
	## Direction along the bank: perpendicular to the gradient of river_distance (which points away from water).
	var gx := Fields.sample(model, "river_distance", Vector2(point.x + 1.0, point.z)) - Fields.sample(model, "river_distance", Vector2(point.x - 1.0, point.z))
	var gz := Fields.sample(model, "river_distance", Vector2(point.x, point.z + 1.0)) - Fields.sample(model, "river_distance", Vector2(point.x, point.z - 1.0))
	var away := Vector2(gx, gz)
	if away.length() < 0.001: return Vector2.RIGHT
	away = away.normalized()
	return Vector2(-away.y, away.x)

static func _bank_pass(root: Node3D, trail: Array, model: Dictionary, quality: float) -> int:
	## Curated bank art from the REAL hydrology fields (model.river_distance / river_width, same semantics as
	## landscape_hydrology.run): candidates are grid cells 0.3-3.6 m outside the water edge, thinned by a run/gap
	## noise so props gather in stretches with bare gaps between. Each family has an offset profile and a budget;
	## total stays under 400 (BANK_BUDGET at BANK_QUALITY_MAX). Model-less roots keep the legacy brook_bank().
	if model.is_empty(): return 0
	var distance: PackedFloat32Array = model.get("river_distance", PackedFloat32Array())
	var width: PackedFloat32Array = model.get("river_width", PackedFloat32Array())
	var size: int = model.size
	if distance.size() != size * size or width.size() != size * size: return 0
	root.set_meta("orchard_bank_dressed", true)
	var step: float = model.step
	var origin: Vector2 = model.origin
	var rng := RandomNumberGenerator.new()
	rng.seed = _habitat_seed(model, 4)
	var run_a := FastNoiseLite.new()
	run_a.seed = _habitat_seed(model, 5) % 2147483647
	run_a.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	run_a.frequency = 0.045
	var run_b := FastNoiseLite.new()
	run_b.seed = _habitat_seed(model, 6) % 2147483647
	run_b.noise_type = FastNoiseLite.TYPE_SIMPLEX_SMOOTH
	run_b.frequency = 0.07
	var cells: Array[Vector3] = []   # x, z = cell centre; y = metres outside the water edge
	for zi in range(size):
		for xi in range(size):
			var i := zi * size + xi
			var offset := distance[i] - width[i] * 0.5
			if distance[i] > 40.0 or width[i] <= 0.0 or offset < 0.3 or offset > 3.6: continue
			var centre := origin + Vector2(float(xi), float(zi)) * step
			cells.append(Vector3(centre.x, offset, centre.y))
	var q := clampf(quality, 0.47, BANK_QUALITY_MAX)
	var groups := {}
	for id in BANK_BUDGET:
		var kind: String = id
		groups[kind] = []
		var target := roundi(float(BANK_BUDGET[kind]) * q)
		var weights := PackedFloat32Array()
		weights.resize(cells.size())
		var total_weight := 0.0
		var rocky := kind.begins_with("rock_") or kind == "branch_fallen_mossy"
		for c in range(cells.size()):
			var cell := cells[c]
			var tempo := run_b.get_noise_2d(cell.x + 137.0, cell.z - 91.0) if rocky else run_a.get_noise_2d(cell.x, cell.z)
			var w := _bank_profile(kind, cell.y) * smoothstep(-0.10, 0.32, tempo)
			weights[c] = w
			total_weight += w
		if total_weight <= 0.0 or target <= 0: continue
		for c in range(cells.size()):
			if groups[kind].size() >= target: break
			if weights[c] <= 0.0: continue
			if rng.randf() > minf(1.0, float(target) * weights[c] / total_weight): continue
			var cell := cells[c]
			var point := Vector3(cell.x + rng.randf_range(-step * 0.5, step * 0.5), 0.0, cell.z + rng.randf_range(-step * 0.5, step * 0.5))
			if not _habitat_ok(point, trail, model, 0.48, 0.45): continue
			var yaw: float = rng.randf_range(0.0, TAU)
			var scale_by: float = rng.randf_range(0.7, 1.15)
			var sink := 0.0
			match kind:
				"rock_mossy_boulder":
					scale_by = rng.randf_range(0.34, 0.62)
					sink = 0.05
				"rock_mossy_slab":
					scale_by = rng.randf_range(0.4, 0.75)
					sink = 0.04
					var tangent := _bank_tangent(model, point)
					yaw = atan2(-tangent.y, tangent.x) + rng.randf_range(-0.4, 0.4)   # slabs lie along the bank
				"branch_fallen_mossy":
					scale_by = rng.randf_range(0.34, 0.6)
					var drift := _bank_tangent(model, point)
					yaw = atan2(-drift.y, drift.x) + rng.randf_range(-0.5, 0.5)
				"litter_leaf_cluster": scale_by = rng.randf_range(0.8, 1.25)
				"grass_tuft": scale_by = rng.randf_range(0.7, 1.05)
				"fern_lady": scale_by = rng.randf_range(0.7, 1.0)
			groups[kind].append(_habitat_pose(yaw, scale_by, point, sink))
	return _emit_groups(root, groups, "bank_")
