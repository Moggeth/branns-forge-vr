extends Node3D
## Small, persistent visual consequences of the same parametric commands that
## edit the ground. No collision: terrain itself remains the source of physics.
const Art = preload("res://landscape_asset_library.gd")
const Fields = preload("res://landscape_fields.gd")
const ASSETS := {
	"rupture": "res://assets/landscape/geo_earth_rupture_roots.glb",
	"split": "res://assets/landscape/geo_boulder_split_b.glb",
	"moss": "res://assets/landscape/geo_boulder_mossy_a.glb",
}
const MAX_DRESSED_OPERATIONS := 64

var _meshes: Dictionary = {}
var _records: Array[Dictionary] = []

func setup(model: Dictionary, operations: Array) -> void:
	for kind in ASSETS: _meshes[kind] = Art.tuned_mesh(ASSETS[kind])
	for i in operations.size():
		if i < operations.size() - MAX_DRESSED_OPERATIONS: continue
		add_operation(operations[i], model, 0.0)

func add_operation(op: Dictionary, target_model: Dictionary, duration: float) -> void:
	var group := Node3D.new()
	group.name = "LandscapeSpell_%03d" % _records.size()
	add_child(group)
	var placements := _placements(op)
	var anchors: Array[Dictionary] = []
	for p in placements:
		var mesh: Mesh = _meshes.get(p.kind)
		if mesh == null: continue
		var point: Vector2 = p.position
		var ground := Fields.sample(target_model, "height", point)
		var item := MeshInstance3D.new()
		item.name = str(p.kind).capitalize()
		item.mesh = mesh
		item.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_ON
		item.position = Vector3(point.x, ground, point.y)
		item.rotation.y = float(p.angle)
		item.scale = Vector3.ONE * float(p.scale)
		group.add_child(item)
		anchors.append({"node":item, "at":point})
		if duration > 0.0:
			item.position.y -= 1.6
			item.scale *= 0.12
			var tween := create_tween().set_parallel(true)
			tween.tween_property(item, "position:y", ground, duration).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
			tween.tween_property(item, "scale", Vector3.ONE * float(p.scale), duration * 0.75).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_records.append({"group":group,"anchors":anchors})
	if _records.size() > MAX_DRESSED_OPERATIONS:
		var old: Dictionary = _records.pop_front()
		(old.group as Node3D).queue_free()

func remove_last() -> void:
	if _records.is_empty(): return
	var record: Dictionary = _records.pop_back()
	(record.group as Node3D).queue_free()

func refresh_region(model: Dictionary, bounds: Rect2) -> void:
	for record in _records:
		for anchor in record.anchors:
			var at: Vector2 = anchor.at
			if not bounds.has_point(at): continue
			var item: MeshInstance3D = anchor.node
			if is_instance_valid(item): item.position.y = Fields.sample(model,"height",at)

static func _placements(op: Dictionary) -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	match str(op.get("type", "")):
		"sunder":
			var points: Array = op.points
			if points.size() < 2: return result
			var a := Vector2(float(points[0][0]), float(points[0][1]))
			var b := Vector2(float(points[-1][0]), float(points[-1][1]))
			var across := (b - a).normalized().orthogonal()
			for i in 3:
				var at: Vector2 = a.lerp(b, float(i + 1) / 4.0) + across * (5.5 if i % 2 == 0 else -5.5)
				result.append({"kind":"rupture" if i == 1 else "split", "position":at,
					"angle":atan2(across.x,across.y) + i * 0.7, "scale":0.67 if i == 1 else 0.58})
		"raise":
			var center := Vector2(float(op.center[0]), float(op.center[1]))
			var radius: float = float(op.get("radius", 12.0))
			for i in 3:
				var angle: float = i * TAU / 3.0 + float(op.get("seed",0)) * 0.31
				result.append({"kind":"moss", "position":center + Vector2(cos(angle),sin(angle)) * radius * 0.67,
					"angle":angle,"scale":0.52})
	return result
