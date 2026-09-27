class_name CrystalHollowArt
extends RefCounted

const LAYOUT_PATH = "res://assets/crystal-hollow/layout.json"
const ASSET_ROOT = "res://assets/crystal-hollow/glb/"

static func _vec(values: Array) -> Vector3:
	return Vector3(float(values[0]),float(values[1]),float(values[2]))

static func _collider(parent: Node3D, at: Vector3, size: Vector3, rotation_y: float = 0.0) -> void:
	var body := StaticBody3D.new()
	body.set_meta("kind","solid")
	parent.add_child(body)
	body.position = at
	body.rotation.y = rotation_y
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)

static func _cylinder_collider(parent: Node3D, at: Vector3, radius: float, height: float) -> void:
	var body := StaticBody3D.new()
	body.set_meta("kind","solid")
	parent.add_child(body)
	body.position = at
	var shape := CollisionShape3D.new()
	var cylinder := CylinderShape3D.new()
	cylinder.radius = radius
	cylinder.height = height
	shape.shape = cylinder
	body.add_child(shape)

static func add(parent: Node3D) -> Dictionary:
	var manifest = JSON.parse_string(FileAccess.get_file_as_string(LAYOUT_PATH))
	if not manifest is Dictionary or manifest.get("schema","") != "brann.crystal_hollow.layout/1":
		push_error("CRYSTAL_ART invalid layout manifest")
		return {"pieces":0,"colliders":0}
	var scenes := {}
	var placed := 0
	var walls: Array = []
	for placement in manifest.get("placements",[]):
		var piece := str(placement.get("piece",""))
		if not scenes.has(piece): scenes[piece] = load(ASSET_ROOT+piece+".glb")
		var scene: PackedScene = scenes[piece]
		if scene == null:
			push_error("CRYSTAL_ART missing="+piece)
			continue
		var item := scene.instantiate() as Node3D
		parent.add_child(item)
		item.position = _vec(placement.position)
		item.rotation.y = deg_to_rad(float(placement.get("rotation_y_deg",0.0)))
		item.scale = Vector3.ONE*float(placement.get("scale",1.0))
		placed += 1
		if piece.begins_with("cave_wall_"): walls.append(placement)
	var colliders := 0
	for proxy in manifest.get("collision_proxies",[]):
		var shape_kind := str(proxy.get("shape",""))
		if shape_kind == "ring_of_boxes":
			# The wall proxy is authored in each module's local space.
			for wall in walls:
				var origin := Node3D.new()
				parent.add_child(origin)
				origin.position = _vec(wall.position)
				origin.rotation.y = deg_to_rad(float(wall.get("rotation_y_deg",0.0)))
				_collider(origin,Vector3(0,5.9,-1.2),Vector3(7.4,11.8,2.6))
				colliders += 1
		elif shape_kind == "box":
			_collider(parent,_vec(proxy.position),_vec(proxy.size))
			colliders += 1
		elif shape_kind == "cylinder":
			_cylinder_collider(parent,_vec(proxy.position),float(proxy.radius),float(proxy.height))
			colliders += 1
	print("CRYSTAL_ART pieces=",placed," colliders=",colliders," authored_tris=",manifest.get("placed_triangles",0))
	return {"pieces":placed,"colliders":colliders}
