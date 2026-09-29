extends RefCounted
## Placement-only adapter for Opus's Orchard Visual Kit. The landscape model
## remains the source of height, water, slope, collision and persistent state.
const Fields = preload("res://landscape_fields.gd")
const ASSET_ROOT := "res://assets/orchard_kit/"
const GROUP_NAME := "OrchardVisualKit"
const CHUNK_METRES := 64.0
const LIMITS := {"bank_stone_lip_8m": 100, "reed_clump": 600,
	"cliff_strata_wide": 40, "cliff_strata_tall": 24, "cliff_strata_low": 60,
	"boulder_medium": 200, "boulder_small": 500}
const VISIBILITY := {"bank_stone_lip_8m": 90.0, "reed_clump": 45.0,
	"cliff_strata_wide": 220.0, "cliff_strata_tall": 240.0,
	"cliff_strata_low": 160.0, "boulder_medium": 90.0, "boulder_small": 50.0}

static func plan(model: Dictionary) -> Dictionary:
	var result := {}
	for asset in LIMITS: result[asset] = []
	var size: int = int(model.get("size", 0))
	var step: float = float(model.get("step", 0.0))
	var height: PackedFloat32Array = model.get("height", PackedFloat32Array())
	var water: PackedFloat32Array = model.get("water", PackedFloat32Array())
	var widths: PackedFloat32Array = model.get("river_width", PackedFloat32Array())
	if size < 3 or step <= 0.0 or height.size() != size * size or water.size() != height.size() or widths.size() != height.size(): return result
	var origin: Vector2 = model.get("origin", Vector2.ZERO)
	var seed: int = int(model.get("seed", 0))
	var course: Array = model.get("river_polyline", [])
	var accepted_cliffs: Array[Vector2] = []
	var travelled := 0.0
	var next_stone := 4.0
	var next_reed := 1.0
	for i in range(1, course.size()):
		var a: Vector3 = course[i - 1]
		var b: Vector3 = course[i]
		var segment := Vector2(b.x - a.x, b.z - a.z)
		var length := segment.length()
		if length < 0.001: continue
		var tangent := segment / length
		var left := Vector2(-tangent.y, tangent.x)
		while next_stone <= travelled + length:
			var p := Vector2(a.x, a.z) + tangent * (next_stone - travelled)
			for side in [-1.0, 1.0]:
				var width: float = Fields.sample(model, "river_width", p)
				var edge: Vector2 = p + left * side * (width * 0.5 + 0.4)
				if _inside(model, edge):
					_add(result, "bank_stone_lip_8m", edge, Fields.sample(model, "height", edge) - 0.1, atan2(-left.x * side, -left.y * side), 1.0)
			next_stone += 8.0
		while next_reed <= travelled + length:
			var p := Vector2(a.x, a.z) + tangent * (next_reed - travelled)
			for side in [-1.0, 1.0]:
				var jitter := _unit(seed, floori(next_reed * 4.0), int(side) + 5)
				var width: float = Fields.sample(model, "river_width", p)
				var edge: Vector2 = p + left * side * (width * 0.5 + 0.3 + jitter * 2.2)
				if _inside(model, edge) and Fields.sample(model, "water", edge) < 0.08:
					if _unit(seed, floori(next_reed / 9.0), int(side) + 41) < 0.45: continue
					_add(result, "reed_clump", edge, Fields.sample(model, "height", edge) - 0.04,
						_unit(seed, floori(next_reed * 4.0), int(side) + 13) * TAU, 0.72 + jitter * 0.42)
			next_reed += 1.25
		travelled += length
	# Six-metre lattice candidates; both sides along the local contour must also
	# be steep. The low module fits ordinary four-metre cut walls; size it to the
	# measured relief and anchor its buried skirt at the downhill foot.
	for z in range(3, size - 3, 3):
		for x in range(3, size - 3, 3):
			var p := origin + Vector2(x, z) * step
			if Fields.sample(model, "water", p) > 0.04: continue
			var gx := (height[z * size + x + 1] - height[z * size + x - 1]) / (2.0 * step)
			var gz := (height[(z + 1) * size + x] - height[(z - 1) * size + x]) / (2.0 * step)
			var grade := Vector2(gx, gz).length()
			if grade <= 0.70: continue
			var downhill := -Vector2(gx, gz) / grade
			var contour := Vector2(-downhill.y, downhill.x)
			if Fields.sample(model, "slope", p + contour * 3.0) <= 0.70 or Fields.sample(model, "slope", p - contour * 3.0) <= 0.70: continue
			var roll := _unit(seed, x, z)
			if roll > 0.68: continue
			var foot := p + downhill * 1.8
			var upper := p - downhill * 2.5
			var lower := p + downhill * 2.5
			if not _inside(model, upper) or not _inside(model, lower): continue
			var relief := Fields.sample(model, "height", upper) - Fields.sample(model, "height", lower)
			if relief < 1.7: continue
			var scale := clampf((relief + 0.25) / 4.73, 0.4, 0.85)
			var too_close := false
			for previous in accepted_cliffs:
				if previous.distance_to(foot) < 6.0:
					too_close = true
					break
			if too_close: continue
			# Check the whole downhill edge, where a long mesh could otherwise
			# project into a stream despite its lattice point being dry.
			var wet := false
			for edge in [foot, lower, foot + contour * 2.5 * scale, foot - contour * 2.5 * scale]:
				if not _inside(model, edge) or Fields.sample(model, "water", edge) > 0.04:
					wet = true
					break
			if wet: continue
			var yaw := atan2(downhill.x, downhill.y)
			_add(result, "cliff_strata_low", foot, Fields.sample(model, "height", foot) - 0.25, yaw, scale)
			accepted_cliffs.append(foot)
			for n in range(2):
				var distance := 2.5 + 3.5 * _unit(seed, x + n * 31, z + 7)
				var scree := p + downhill * distance + contour * (n * 2.0 - 1.0)
				if not _inside(model, scree) or Fields.sample(model, "water", scree) > 0.04: continue
				var boulder := "boulder_medium" if n == 0 else "boulder_small"
				_add(result, boulder, scree, Fields.sample(model, "height", scree) - 0.12,
					_unit(seed, x + n, z + 19) * TAU, 0.8 + 0.4 * roll)
	return result

static func populate(root: Node3D, model: Dictionary) -> Dictionary:
	var start := Time.get_ticks_usec()
	var old := root.get_node_or_null(GROUP_NAME)
	if old != null:
		root.remove_child(old)
		old.free()
	var group := Node3D.new()
	group.name = GROUP_NAME
	root.add_child(group)
	var placements: Dictionary = plan(model)
	var counts := {}
	for asset in placements:
		var poses: Array = placements[asset]
		counts[asset] = poses.size()
		if poses.is_empty(): continue
		var path: String = ASSET_ROOT + asset + ".glb"
		if not ResourceLoader.exists(path): continue
		var mesh := _mesh(path)
		if mesh == null: continue
		var buckets := {}
		for pose in poses:
			var position: Vector3 = pose.position
			var chunk := Vector2i(floori((position.x + 160.0) / CHUNK_METRES), floori((position.z + 160.0) / CHUNK_METRES))
			if not buckets.has(chunk): buckets[chunk] = []
			buckets[chunk].append(pose)
		for chunk in buckets:
			var holder := MultiMeshInstance3D.new()
			holder.name = "%s_%d_%d" % [asset, chunk.x, chunk.y]
			var multi := MultiMesh.new()
			multi.transform_format = MultiMesh.TRANSFORM_3D
			multi.mesh = mesh
			multi.instance_count = buckets[chunk].size()
			for j in multi.instance_count:
				var pose: Dictionary = buckets[chunk][j]
				multi.set_instance_transform(j, Transform3D(Basis(Vector3.UP, pose.yaw).scaled(Vector3.ONE * pose.scale), pose.position))
			holder.multimesh = multi
			holder.material_override = _material(asset)
			holder.visibility_range_end = VISIBILITY[asset]
			if asset == "reed_clump": holder.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			group.add_child(holder)
	print("ORCHARD_VISUAL_KIT counts=", counts, " placement_ms=", snappedf(float(Time.get_ticks_usec() - start) / 1000.0, 0.01))
	return counts

static func _add(result: Dictionary, asset: String, p: Vector2, y: float, yaw: float, scale: float) -> void:
	if result[asset].size() >= int(LIMITS[asset]): return
	result[asset].append({"position": Vector3(p.x, y, p.y), "yaw": yaw, "scale": scale})

static func _inside(model: Dictionary, p: Vector2) -> bool:
	var origin: Vector2 = model.origin
	var extent: float = float(int(model.size) - 1) * float(model.step)
	return p.x >= origin.x and p.y >= origin.y and p.x <= origin.x + extent and p.y <= origin.y + extent

static func _unit(seed: int, a: int, b: int) -> float:
	var n: int = (seed * 137 + a * 92821 + b * 68917) & 0x7fffffff
	n = ((n >> 13) ^ n) & 0x7fffffff
	return float((n * (n * n * 15731 + 789221) + 1376312589) & 0x7fffffff) / 2147483647.0

static func _mesh(path: String) -> Mesh:
	var scene: PackedScene = load(path)
	if scene == null: return null
	var sample := scene.instantiate()
	var nodes := sample.find_children("*", "MeshInstance3D", true, false)
	var mesh: Mesh = (nodes[0] as MeshInstance3D).mesh if not nodes.is_empty() else null
	sample.free()
	return mesh

static func _material(asset: String) -> Material:
	var kit = load(ASSET_ROOT + "orchard_kit_materials.gd")
	return kit.for_asset(asset) if kit != null else null
