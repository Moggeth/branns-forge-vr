extends RefCounted
## Opus woodland kit placed from the SAME masks that shade the Orchard ground.
## Each species is one textured mesh, chunked into bounded MultiMeshes for VR.
const Ground = preload("res://orchard_ground.gd")
const Foliage = preload("res://orchard_foliage.gd")
const GroundKitScript = preload("res://ground_kit.gd")
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

static func _emit(root: Node3D, id: String, source: Dictionary, placements: Array, tag: String = "") -> void:
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
		holder.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON if _kind(id) in ["rock", "wood", "fern"] else GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		holder.visibility_range_end = float(CULL[id])
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
