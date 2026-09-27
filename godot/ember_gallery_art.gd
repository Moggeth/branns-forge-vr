extends Node3D
## Static, collider-preserving art for the Ember Gallery. Coordinates are local.
## Interaction/lighting owners should parent to anchors, never modify baked meshes.
const ART = preload("res://workshop_art.gd")
const SUPPLY = Vector3(-5, 1.02, 5)
const FIRE = Vector3(-5, 1.12, -4)
const ENTRY = Vector3(0, 0, 8)
const ALCOVE = Vector3(8, 0, -5)
const BASINS = [Vector3(-4, 0.03, 0), Vector3(4, 0.03, 0), Vector3(0, 0.03, -6)]
const GUTTER_INLETS = [Vector3(-4, 0.272, -4.45), Vector3(4, 0.272, -4.45), Vector3(0, 0.272, -8.85)]
const STONE = "56636a"
const LIGHT_STONE = "82908e"
const DARK_STONE = "35434b"
const COPPER = "b78157"
const PATINA = "427a77"
var anchors: Dictionary = {}
var fills: Array[OmniLight3D] = []
var geometry: Node3D

func setup(parent_node: Node3D) -> void:
	parent_node.add_child(self)
	name = "EmberGalleryArt"
	geometry = Node3D.new(); geometry.name = "BakedStillhouse"; add_child(geometry)
	_structure()
	_channels()
	_workplaces()
	_details()
	_polish_metals()
	ART.bake(geometry)
	for pair in [["supply", SUPPLY], ["fire", FIRE], ["entry", ENTRY], ["alcove", ALCOVE]]:
		_anchor(pair[0], pair[1])
	for i in BASINS.size(): _anchor("basin_" + str(i), BASINS[i])
	for i in GUTTER_INLETS.size(): _anchor("gutter_" + str(i), GUTTER_INLETS[i])
	# These only preserve navigation: the handheld torch and real flame lights
	# provide the warm reveal. No global environment or directional light changes.
	_fill(Vector3(0, 4.0, 6.5), 0.38, 11.0)
	_fill(Vector3(-3.5, 3.8, -4.0), 0.13, 8.0)
	set_meta("basin_points", BASINS)
	set_meta("entry_point", ENTRY)
	set_meta("art_mesh_batches", geometry.find_children("*", "MeshInstance3D", true, false).size())

func _anchor(id: String, point: Vector3) -> void:
	var n = Marker3D.new(); n.name = id; n.position = point; add_child(n); anchors[id] = n

func world_point(id: String) -> Vector3:
	return anchors[id].global_position if anchors.has(id) else global_position

func _block(pos: Vector3, size: Vector3, color: String, kind: String = "stone", rotation_value: Vector3 = Vector3.ZERO) -> void:
	var mesh = WorldZones.box(geometry, pos, size, color); mesh.rotation = rotation_value
	var body = WorldZones.body(geometry, pos, size, kind); body.rotation = rotation_value
	body.set_meta("surface_material", "metal" if kind == "metal" else ("wood" if kind == "wood" else "stone"))

func _structure() -> void:
	_block(Vector3(0, -0.16, 0), Vector3(20, 0.32, 20), DARK_STONE, "floor")
	# Closed roof and walls actually occlude the sun; open central entrance remains.
	_block(Vector3(-9.75, 3.25, 0), Vector3(0.5, 6.5, 20), STONE)
	_block(Vector3(9.75, 3.25, 0), Vector3(0.5, 6.5, 20), STONE)
	_block(Vector3(0, 3.25, -9.75), Vector3(19, 6.5, 0.5), STONE)
	for side in [-1.0, 1.0]:
		_block(Vector3(side * 6.5, 3.25, 9.75), Vector3(6, 6.5, 0.5), STONE)
		_block(Vector3(side * 4.9, 6.97, 0), Vector3(10.1, 0.4, 20), DARK_STONE, "stone", Vector3(0, 0, -side * 0.13))
	_block(Vector3(0, 5.75, 9.75), Vector3(7, 1.5, 0.5), STONE)
	# Floor courses and copper centre line lead to the safe exit even without flame.
	for z in range(-9, 10):
		WorldZones.box(geometry, Vector3(0, 0.008, z), Vector3(2.6, 0.015, 0.95), LIGHT_STONE if z % 3 == 0 else STONE)
		for side in [-1, 1]: WorldZones.box(geometry, Vector3(side * 1.25, 0.019, z), Vector3(0.035, 0.009, 0.68), COPPER)
	for x in [-8.0, -6.5, 6.5, 8.0]:
		for z in range(-8, 9, 2):
			WorldZones.box(geometry, Vector3(x, 0.009, z), Vector3(1.42, 0.014, 1.85), STONE if posmod(z, 4) == 0 else DARK_STONE)
	# Four low-poly vaulted ribs: chunky ashlar, repeated forged copper inlays.
	for z in [-8.0, -3.0, 3.0, 8.0]:
		for side in [-1.0, 1.0]:
			_block(Vector3(side * 8.7, 2.2, z), Vector3(0.7, 4.4, 0.8), LIGHT_STONE)
			_block(Vector3(side * 8.7, 0.16, z), Vector3(1.05, 0.32, 1.05), STONE)
			_block(Vector3(side * 8.7, 4.22, z), Vector3(1.0, 0.3, 1.0), COPPER, "metal")
		for i in range(12):
			var t = (i + 0.5) / 12.0 * PI
			var p = Vector3(cos(t) * 8.7, 4.25 + sin(t) * 2.5, z)
			var tangent = Vector3(-sin(t) * 8.7, cos(t) * 2.5, 0).normalized()
			var angle = atan2(tangent.y, tangent.x)
			WorldZones.box(geometry, p, Vector3(2.18, 0.4, 0.66), LIGHT_STONE).rotation.z = angle
			WorldZones.box(geometry, p + Vector3(0, -0.17, 0.36), Vector3(1.95, 0.04, 0.035), COPPER).rotation.z = angle
	# Shadow alcove has a narrow open doorway towards the central gallery.
	_block(Vector3(6.45, 1.9, -7.25), Vector3(0.32, 3.8, 4.5), DARK_STONE)
	_block(Vector3(6.45, 1.9, -2.05), Vector3(0.32, 3.8, 1.2), DARK_STONE)
	_block(Vector3(6.45, 3.48, -4.15), Vector3(0.32, 0.65, 3.1), LIGHT_STONE)
	_block(Vector3(8.0, 3.86, -5.5), Vector3(3.5, 0.22, 7.5), DARK_STONE)
	_block(Vector3(8.0, 1.9, -1.6), Vector3(3.2, 3.8, 0.28), DARK_STONE)
	# Raised leaf wall carving is intentionally non-emissive: light uncovers it.
	for i in range(7):
		var z = -5.0 + (i - 3) * 0.30
		for side in [-1.0, 1.0]:
			var leaf = _facet(Vector3(9.40, 1.75 + side * 0.22, z), Vector3(0.15, 0.25, 0.46), COPPER)
			leaf.rotation.x = side * 0.63
			WorldZones.line(geometry, Vector3(9.30, 1.75, z - 0.12), Vector3(9.30, 1.75 + side * 0.30, z + 0.12), 0.024, LIGHT_STONE)
	WorldZones.line(geometry, Vector3(9.30, 1.75, -6.2), Vector3(9.30, 1.75, -3.8), 0.06, PATINA)

func _channels() -> void:
	for i in BASINS.size():
		var p: Vector3 = BASINS[i]
		_block(p + Vector3(0, -0.015, 0), Vector3(2.8, 0.03, 2.8), PATINA, "metal")
		for side in [-1.0, 1.0]:
			_block(p + Vector3(side * 1.46, 0.075, 0), Vector3(0.15, 0.15, 3.07), LIGHT_STONE)
			# Keep a wide inlet in the rear rim: the actual gutter joins without a lip.
			_block(p + Vector3(side * 1.0, 0.075, -1.46), Vector3(1.06, 0.15, 0.15), LIGHT_STONE)
		_block(p + Vector3(0, 0.075, 1.46), Vector3(3.07, 0.15, 0.15), LIGHT_STONE)
		for n in range(-3, 4):
			WorldZones.box(geometry, p + Vector3(n * 0.39, 0.003, 0), Vector3(0.01, 0.005, 2.65), COPPER)
			WorldZones.box(geometry, p + Vector3(0, 0.003, n * 0.39), Vector3(2.65, 0.005, 0.01), COPPER)
		# Shallow slope: lip 0.25 -> basin 0.03. Three metres, no hidden deep pit.
		var length = 1.4 if i == 2 else 3.0
		var centre = p + Vector3(0, 0.11, -1.46 - length * 0.5)
		var angle = atan2(0.22, length)
		_block(centre, Vector3(0.74, 0.045, length), PATINA, "metal", Vector3(angle, 0, 0))
		for side in [-1.0, 1.0]:
			_block(centre + Vector3(side * 0.44, 0.07, 0), Vector3(0.13, 0.14, length), COPPER, "metal", Vector3(angle, 0, 0))

func _workplaces() -> void:
	# Left supply bench, top anchor at 1.02; thick collidable work surface.
	_block(Vector3(-5, 0.92, 5), Vector3(3.4, 0.2, 1.3), "795a45", "wood")
	for x in [-6.35, -3.65]:
		for z in [4.5, 5.5]: _block(Vector3(x, 0.43, z), Vector3(0.18, 0.86, 0.18), DARK_STONE)
	WorldZones.box(geometry, Vector3(-5, 0.8, 5.66), Vector3(3.4, 0.1, 0.04), COPPER)
	for x in [-6.2, -3.8]:
		WorldZones.cyl(geometry, Vector3(x, 1.05, 5), 0.17, 0.04, COPPER)
	# Cold fire altar: flame, functional warm light and interaction belong to owner.
	_block(Vector3(-5, 0.18, -4), Vector3(1.7, 0.36, 1.7), LIGHT_STONE)
	_block(Vector3(-5, 0.67, -4), Vector3(1.04, 0.62, 1.04), DARK_STONE)
	_block(Vector3(-5, 1.03, -4), Vector3(1.45, 0.10, 1.45), COPPER, "metal")
	for side in [-1.0, 1.0]:
		_block(Vector3(-5 + side * 0.63, 1.13, -4), Vector3(0.13, 0.16, 1.34), COPPER, "metal")
		_block(Vector3(-5, 1.13, -4 + side * 0.63), Vector3(1.34, 0.16, 0.13), COPPER, "metal")
	for i in range(7): _facet(Vector3(-5 + sin(i * 2.4) * 0.38, 1.115, -4 + cos(i * 2.4) * 0.38), Vector3(0.26, 0.09, 0.2), "2c3438")
	# Low plinth and copper bas-relief in the torch alcove.
	_block(Vector3(8.6, 0.25, -5.0), Vector3(1.2, 0.5, 2.3), LIGHT_STONE)
	WorldZones.cyl(geometry, Vector3(8.6, 0.85, -5), 0.40, 0.7, PATINA, "taper")
	WorldZones.cyl(geometry, Vector3(8.6, 1.27, -5), 0.29, 0.15, COPPER)
	# A pale carved ember in a copper crown, entirely revealed by real light.
	_facet(Vector3(8.6, 1.59, -5), Vector3(0.49, 0.55, 0.49), LIGHT_STONE)
	WorldZones.cyl(geometry, Vector3(8.6, 1.89, -5), 0.17, 0.36, LIGHT_STONE, "cone")
	for i in range(6):
		var angle = i * TAU / 6
		var p = Vector3(8.6 + cos(angle) * 0.23, 1.53, -5 + sin(angle) * 0.23)
		var prong = WorldZones.cyl(geometry, p, 0.035, 0.40, COPPER, "cone")
		prong.rotation = Vector3(sin(angle) * 0.18, 0, -cos(angle) * 0.18)
	WorldZones.cyl(geometry, Vector3(8.6, 1.37, -5), 0.27, 0.08, COPPER)
	WorldZones.body(geometry, Vector3(8.6, 1.285, -5), Vector3(0.78, 1.57, 0.78), "stone")

func _details() -> void:
	# Sturdy copper distillation pipe runs and expansion joints along left wall.
	for y in [1.8, 2.35]:
		WorldZones.line(geometry, Vector3(-9.15, y, -8), Vector3(-9.15, y, 7), 0.13, COPPER)
		for z in [-7.0, -4.0, 0.0, 4.0, 7.0]:
			WorldZones.box(geometry, Vector3(-9.16, y, z), Vector3(0.27, 0.28, 0.16), PATINA)
	for z in [-6.0, 2.0]:
		_block(Vector3(-7.65, 0.17, z), Vector3(1.4, 0.34, 1.4), LIGHT_STONE)
		WorldZones.cyl(geometry, Vector3(-7.65, 1.0, z), 0.62, 1.36, COPPER)
		WorldZones.cyl(geometry, Vector3(-7.65, 1.83, z), 0.64, 0.35, PATINA, "taper")
		WorldZones.cyl(geometry, Vector3(-7.65, 2.13, z), 0.20, 0.36, COPPER)
		# Collider stays through batching, protecting a thrown bottle from vanishing.
		WorldZones.body(geometry, Vector3(-7.65, 1.05, z), Vector3(1.2, 1.5, 1.2), "metal")
		for y in [0.49, 1.47]: WorldZones.cyl(geometry, Vector3(-7.65, y, z), 0.64, 0.08, DARK_STONE)
		WorldZones.line(geometry, Vector3(-7.65, 2.18, z), Vector3(-9.15, 2.35, z), 0.13, COPPER)
	# Distant forged leaf seal: readable silhouette, no floating UI plate.
	for side in [-1.0, 1.0]:
		for i in range(5):
			var leaf = _facet(Vector3(side * (0.3 + i * 0.17), 4.5 - i * 0.27, -9.45), Vector3(0.63, 0.26, 0.08), COPPER)
			leaf.rotation.z = side * 0.52
	WorldZones.box(geometry, Vector3(0, 4.03, -9.42), Vector3(0.08, 2.2, 0.08), COPPER)
	# Two dim entry guide studs, not a competing source of flame-like bloom.
	for side in [-1.0, 1.0]:
		WorldZones.box(geometry, Vector3(side * 3.25, 1.2, 9.44), Vector3(0.13, 1.1, 0.08), "8cbbb9", 0.15)

func _fill(pos: Vector3, energy: float, radius: float) -> void:
	var light = OmniLight3D.new(); light.name = "MoonFill" + str(fills.size())
	add_child(light); light.position = pos; light.light_color = Color("aacbe4")
	light.light_energy = energy; light.omni_range = radius; light.omni_attenuation = 1.3
	light.shadow_enabled = false; fills.append(light)

func _polish_metals() -> void:
	# Duplicate the shared world materials locally; never recolor other regions.
	var copper = WorldZones.mat(COPPER).duplicate()
	copper.metallic = 0.58; copper.roughness = 0.34
	var patina = WorldZones.mat(PATINA).duplicate()
	patina.metallic = 0.28; patina.roughness = 0.64
	for mesh in geometry.find_children("*", "MeshInstance3D", true, false):
		if mesh.material_override == WorldZones.mat(COPPER): mesh.material_override = copper
		elif mesh.material_override == WorldZones.mat(PATINA): mesh.material_override = patina

func _facet(pos: Vector3, size: Vector3, color: String) -> MeshInstance3D:
	# Built-in primitive retains outward winding through SurfaceTool batching.
	# The shared custom rock mesh disappeared in exported GPU screenshots.
	var mesh = SphereMesh.new(); mesh.radius = 0.5; mesh.height = 1.0
	mesh.radial_segments = 8; mesh.rings = 4
	var part = MeshInstance3D.new(); part.mesh = mesh; part.material_override = WorldZones.mat(color)
	geometry.add_child(part); part.position = pos; part.scale = size
	return part
