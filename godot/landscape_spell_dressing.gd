extends Node3D
## Small, persistent visual consequences of the same parametric commands that
## edit the ground. No collision: terrain itself remains the source of physics.
const Art = preload("res://landscape_asset_library.gd")
const Fields = preload("res://landscape_fields.gd")
const CrystalArt = preload("res://starfall_crystal_art.gd")
const ASSETS := {
	"split": "res://assets/landscape/geo_boulder_split_b.glb",
	"spire": "res://assets/landscape/geo_spell_spire.glb",
}
const MAX_DRESSED_OPERATIONS := 64

var _meshes: Dictionary = {}
var _records: Array[Dictionary] = []
var crystal_art = CrystalArt.new()

func setup(model: Dictionary, operations: Array) -> void:
	for kind in ASSETS: _meshes[kind] = Art.tuned_mesh(ASSETS[kind])
	for i in operations.size():
		if i < operations.size() - MAX_DRESSED_OPERATIONS: continue
		add_operation(operations[i], model, 0.0)

func add_operation(op: Dictionary, target_model: Dictionary, duration: float) -> void:
	var group := Node3D.new()
	group.name = "LandscapeSpell_%03d" % _records.size()
	add_child(group)
	# Keep one record per operation for undo, including spells whose artwork is
	# supplied by OrchardSpellVfx instead of persistent dressing meshes.
	var placements := _placements(op)
	var anchors: Array[Dictionary] = []
	for p in placements:
		var mesh: Mesh = crystal_art.mesh_for_fault(int(op.get("seed",0))+anchors.size()*7919) if str(p.kind)=="spire" else _meshes.get(p.kind)
		if mesh == null: continue
		var point: Vector2 = p.position
		var ground := Fields.sample(target_model, "height", point)
		var item := MeshInstance3D.new()
		item.name = str(p.kind).capitalize()
		item.mesh = mesh
		if str(p.kind) == "spire":
			var seed_value:=int(op.get("seed",0))+anchors.size()*7919
			item.mesh=crystal_art.mesh_for_fault(seed_value)
			item.add_to_group("landscape_crystal")
			item.set_meta("crystal_seed",seed_value)
			item.set_instance_shader_parameter("seedv",float(absi(seed_value)%997)/97.0)
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
		"ridge":
			var points: Array = op.get("points", [])
			if points.size() < 2: return result
			var a := Vector2(float(points[0][0]), float(points[0][1]))
			var b := Vector2(float(points[-1][0]), float(points[-1][1]))
			var across := (b - a).normalized().orthogonal()
			var crystal_fault := str(op.get("feature", "")) == "crystal_fault"
			for i in 4:
				var at: Vector2 = a.lerp(b, float(i + 1) / 5.0) + across * (1.3 if i % 2 == 0 else -1.3)
				result.append({"kind":"spire" if crystal_fault else "split", "position":at,
					"angle":atan2(across.x,across.y) + i * 0.62, "scale":0.6 if crystal_fault else 0.43})
	return result
