extends RefCounted
## Copperpot's Promise: a small, forged copper-and-steel apprentice hammer.
## Keeps the established +Y handle axis and the original 0.46 x 0.73 x 0.22 m envelope.
const SEGMENTS := 12

var _surfaces: Dictionary = {}
var _materials: Dictionary = {}

func _material(color: String, metallic: float, roughness: float) -> StandardMaterial3D:
	var result := StandardMaterial3D.new()
	result.albedo_color = Color(color)
	result.metallic = metallic
	result.roughness = roughness
	return result

func _begin() -> void:
	_materials = {
		"steel": _material("82949a", 0.86, 0.29),
		"edge": _material("c1c9c4", 0.9, 0.22),
		"copper": _material("b56d3d", 0.78, 0.31),
		"brass": _material("d2a45c", 0.8, 0.27),
		"wood": _material("79502f", 0.0, 0.63),
		"leather": _material("3f302b", 0.0, 0.86),
		"stitch": _material("d2a45c", 0.38, 0.46),
		"stamp": _material("573a2d", 0.28, 0.68)
	}
	for key in _materials:
		var tool := SurfaceTool.new()
		tool.begin(Mesh.PRIMITIVE_TRIANGLES)
		_surfaces[key] = tool

func _triangle(key: String, a: Vector3, b: Vector3, c: Vector3) -> void:
	var tool: SurfaceTool = _surfaces[key]
	tool.add_vertex(a)
	tool.add_vertex(b)
	tool.add_vertex(c)

func _quad(key: String, a: Vector3, b: Vector3, c: Vector3, d: Vector3) -> void:
	_triangle(key, a, b, c)
	_triangle(key, a, c, d)

func _ring_box(key: String, rings: Array, center_y: float) -> void:
	# Each ring is (x, half-height, half-depth); the eight-sided section softens the forged edges.
	var ordered: Array = rings.duplicate()
	if ordered[0].x > ordered[ordered.size()-1].x: ordered.reverse()
	var sections: Array = []
	for ring in ordered:
		var x: float = ring.x
		var hy: float = ring.y
		var hz: float = ring.z
		var cut: float = minf(hy, hz) * 0.28
		var section: Array[Vector3] = [
			Vector3(x, center_y-hy+cut, -hz), Vector3(x, center_y+hy-cut, -hz),
			Vector3(x, center_y+hy, -hz+cut), Vector3(x, center_y+hy, hz-cut),
			Vector3(x, center_y+hy-cut, hz), Vector3(x, center_y-hy+cut, hz),
			Vector3(x, center_y-hy, hz-cut), Vector3(x, center_y-hy, -hz+cut)
		]
		sections.append(section)
	for s in range(sections.size()-1):
		var left: Array = sections[s]
		var right: Array = sections[s+1]
		for i in range(8):
			var next := (i+1)%8
			# Winding is chosen for outward-facing side normals along the X axis.
			_quad(key, left[i], right[i], right[next], left[next])
	var first: Array = sections[0]
	var last: Array = sections[sections.size()-1]
	for i in range(8):
		var next := (i+1)%8
		# Godot treats clockwise triangles as front-facing: lower and upper caps need opposite winding.
		_triangle(key, Vector3(ordered[0].x, center_y, 0), first[i], first[next])
		_triangle(key, Vector3(ordered[-1].x, center_y, 0), last[next], last[i])

func _lathe(key: String, profile: Array, sides := 12) -> void:
	var rings: Array = []
	for point in profile:
		var ring: Array[Vector3] = []
		for i in range(sides):
			var angle := TAU*float(i)/float(sides)
			ring.append(Vector3(cos(angle)*point.y, point.x, sin(angle)*point.y))
		rings.append(ring)
	for j in range(rings.size()-1):
		for i in range(sides):
			var next := (i+1)%sides
			# Reverse the ring quad so the outside of each turned section faces the camera.
			_quad(key, rings[j][i], rings[j][next], rings[j+1][next], rings[j+1][i])

func _tube(key: String, points: Array[Vector3], radius: float, sides := 5) -> void:
	var rings: Array = []
	var previous_right := Vector3.ZERO
	for j in range(points.size()):
		var axis := (points[min(j+1, points.size()-1)]-points[max(0,j-1)]).normalized()
		var right := axis.cross(Vector3.UP if absf(axis.y)<0.95 else Vector3.RIGHT).normalized() if j == 0 else (previous_right-axis*previous_right.dot(axis)).normalized()
		previous_right = right
		var forward := axis.cross(right).normalized()
		var ring: Array[Vector3] = []
		for i in range(sides):
			var angle := TAU*float(i)/float(sides)
			ring.append(points[j]+radius*(right*cos(angle)+forward*sin(angle)))
		rings.append(ring)
	for j in range(rings.size()-1):
		for i in range(sides):
			var next := (i+1)%sides
			_quad(key, rings[j][i], rings[j+1][i], rings[j+1][next], rings[j][next])

func _ribbon_line(key: String, a: Vector3, b: Vector3, width: float, z: float) -> void:
	# Flat raised strokes make a readable stamped maker's mark on the forward cheek.
	var direction := (b-a).normalized()
	var offset := Vector3(-direction.y, direction.x, 0)*width*0.5
	var aa := Vector3(a.x, a.y, z)
	var bb := Vector3(b.x, b.y, z)
	# Invert the XY ribbon so its +Z face is front-facing under Godot's clockwise convention.
	_quad(key, aa-offset, aa+offset, bb+offset, bb-offset)

func build(parent: Node3D, height := 0.60) -> Dictionary:
	_surfaces.clear()
	_begin()
	var head_y := height
	# Tapered hardwood core; its full length and handedness remain compatible with current grip code.
	_lathe("wood", [Vector2(0.006,0.031), Vector2(0.025,0.031), Vector2(0.045,0.032), Vector2(0.27,0.030), Vector2(height-0.06,0.038), Vector2(height-0.025,0.048), Vector2(height,0.044)])
	# Continuous leather sleeve plus a fine raised spiral that reads clearly at hand scale.
	_lathe("leather", [Vector2(0.048,0.038), Vector2(0.058,0.043), Vector2(0.22,0.040), Vector2(0.248,0.035)])
	var spiral: Array[Vector3] = []
	for i in range(97):
		var t := float(i)/96.0
		var angle := t*TAU*7.0
		var radius := lerpf(0.044,0.041,t)
		spiral.append(Vector3(cos(angle)*radius,0.057+t*0.177,sin(angle)*radius))
	_tube("stitch", spiral, 0.0017, 5)
	# Staggered ferrules and butt cap conceal the transitions at the hand and pommel.
	_lathe("copper", [Vector2(0.018,0.038), Vector2(0.024,0.047), Vector2(0.035,0.047), Vector2(0.041,0.039)])
	for y in [0.045, 0.247, height-0.105]:
		_lathe("brass", [Vector2(y-0.007,0.041), Vector2(y-0.004,0.049), Vector2(y+0.004,0.049), Vector2(y+0.007,0.041)])
	# The steel head has broad, softly chamfered faces and a narrow bright ground edge.
	_ring_box("steel", [Vector3(-0.2285,0.059,0.070), Vector3(-0.211,0.073,0.086), Vector3(-0.176,0.083,0.100), Vector3(0.176,0.083,0.100), Vector3(0.211,0.073,0.086), Vector3(0.2285,0.059,0.070)], head_y)
	for side in [-1.0,1.0]:
		_ring_box("edge", [Vector3(side*0.210,0.069,0.076), Vector3(side*0.223,0.065,0.072), Vector3(side*0.2285,0.058,0.067)], head_y)
		_ring_box("copper", [Vector3(side*0.174,0.061,0.101), Vector3(side*0.187,0.067,0.107), Vector3(side*0.200,0.061,0.101)], head_y)
	# Raised eye socket joins handle to head; two copper shoulders and flush rivets show the assembly.
	_lathe("copper", [Vector2(head_y-0.113,0.043), Vector2(head_y-0.101,0.058), Vector2(head_y-0.087,0.059), Vector2(head_y-0.073,0.047)])
	_lathe("steel", [Vector2(head_y-0.075,0.048), Vector2(head_y-0.064,0.058), Vector2(head_y-0.049,0.058), Vector2(head_y-0.038,0.045)])
	for side in [-1.0,1.0]:
		_lathe("brass", [Vector2(head_y-0.118,0.056), Vector2(head_y-0.113,0.062), Vector2(head_y-0.108,0.056)])
		# Tiny front-facing pin heads live on the cheek and stay inside the inherited depth envelope.
		var px: float = side*0.132
		var pin_points: Array[Vector3] = []
		for i in range(8):
			var a := TAU*float(i)/8.0
			pin_points.append(Vector3(px+cos(a)*0.008, head_y+sin(a)*0.008, 0.102))
		var pin_center := Vector3(px, head_y, 0.102)
		for i in range(8): _triangle("brass", pin_center, pin_points[(i+1)%8], pin_points[i])
	# A small copper medallion carries a recessed-looking BC mark on the front face.
	var badge := [Vector3(-0.052,head_y-0.050,0.103), Vector3(-0.048,head_y-0.055,0.105), Vector3(0.048,head_y-0.055,0.105), Vector3(0.052,head_y-0.050,0.103), Vector3(0.052,head_y+0.050,0.103), Vector3(0.048,head_y+0.055,0.105), Vector3(-0.048,head_y+0.055,0.105), Vector3(-0.052,head_y+0.050,0.103)]
	for i in range(1,7): _triangle("copper", badge[0], badge[i+1], badge[i])
	var z_mark := 0.109
	# B
	_ribbon_line("stamp", Vector3(-0.022,head_y-0.026,0), Vector3(-0.022,head_y+0.026,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(-0.022,head_y+0.026,0), Vector3(-0.002,head_y+0.026,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(-0.002,head_y+0.026,0), Vector3(0.004,head_y+0.018,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(0.004,head_y+0.018,0), Vector3(-0.002,head_y+0.004,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(-0.002,head_y+0.004,0), Vector3(-0.022,head_y+0.004,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(-0.022,head_y+0.004,0), Vector3(-0.002,head_y+0.004,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(-0.002,head_y+0.004,0), Vector3(0.004,head_y-0.008,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(0.004,head_y-0.008,0), Vector3(-0.002,head_y-0.026,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(-0.002,head_y-0.026,0), Vector3(-0.022,head_y-0.026,0), 0.0045, z_mark)
	# C
	_ribbon_line("stamp", Vector3(0.022,head_y+0.026,0), Vector3(0.008,head_y+0.026,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(0.008,head_y+0.026,0), Vector3(0.004,head_y+0.018,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(0.004,head_y+0.018,0), Vector3(0.004,head_y-0.018,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(0.004,head_y-0.018,0), Vector3(0.008,head_y-0.026,0), 0.0045, z_mark)
	_ribbon_line("stamp", Vector3(0.008,head_y-0.026,0), Vector3(0.022,head_y-0.026,0), 0.0045, z_mark)
	var mesh_count := 0
	var triangle_count := 0
	for key in _surfaces:
		var tool: SurfaceTool = _surfaces[key]
		tool.generate_normals()
		var mesh := tool.commit()
		if mesh.get_surface_count() == 0: continue
		var instance := MeshInstance3D.new()
		instance.name = "CopperpotPromise_"+str(key).capitalize()
		instance.mesh = mesh
		instance.material_override = _materials[key]
		parent.add_child(instance)
		mesh_count += 1
		triangle_count += int(mesh.get_faces().size()/3)
	return {"mesh_count":mesh_count,"triangle_count":triangle_count,"height":height,"bounds":Vector3(0.414,height+0.094,0.206)}
