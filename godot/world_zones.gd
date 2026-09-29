class_name WorldZones
extends RefCounted
const TreeAdapter = preload("res://tree_adapter.gd")
const LandmarkKit = preload("res://landmark_kit.gd")
const ForgeMaterials = preload("res://forge_materials.gd")
const OrchardGround = preload("res://orchard_ground.gd")
const OrchardDressing = preload("res://orchard_dressing.gd")
const AuthoredZoneKit = preload("res://authored_zone_kit.gd")

# Art is built in engine: shared low-poly meshes are batched per zone. Interactive
# objects remain individual root children so harvesting, combat and saving stay simple.
static var mats: Dictionary = {}
static var meshes: Dictionary = {}
static var serial: int = 0
static var world_font: FontFile

static func mat(hex: String, glow: float = 0.0) -> StandardMaterial3D:
	var key := hex + str(glow)
	if mats.has(key): return mats[key]
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(hex)
	m.roughness = 0.86
	if glow > 0.0:
		m.emission_enabled = true
		m.emission = Color(hex)
		m.emission_energy_multiplier = glow
	mats[key] = m
	return m

static func primitive(parent: Node3D, mesh_key: String, pos: Vector3, scale_value: Vector3, color: String, glow: float = 0.0) -> MeshInstance3D:
	if not meshes.has(mesh_key):
		if mesh_key == "box":
			meshes[mesh_key] = BoxMesh.new()
		elif mesh_key == "rock":
			var sphere := SphereMesh.new()
			sphere.radius = 0.5
			sphere.height = 1.0
			sphere.radial_segments = 7
			sphere.rings = 3
			# Duplicate triangle vertices and assign per-face normals for real facets.
			var faces: PackedVector3Array = sphere.get_faces()
			var normals := PackedVector3Array()
			for f in range(0,faces.size(),3):
				var normal: Vector3 = (faces[f+1]-faces[f]).cross(faces[f+2]-faces[f]).normalized()
				if normal.dot(faces[f]+faces[f+1]+faces[f+2]) < 0.0: normal = -normal
				for j in range(3): normals.append(normal)
			var arrays := []
			arrays.resize(Mesh.ARRAY_MAX)
			arrays[Mesh.ARRAY_VERTEX] = faces
			arrays[Mesh.ARRAY_NORMAL] = normals
			var faceted := ArrayMesh.new()
			faceted.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES,arrays)
			meshes[mesh_key] = faceted
		else:
			var cyl := CylinderMesh.new()
			cyl.bottom_radius = 0.5
			cyl.top_radius = 0.0 if mesh_key == "cone" else (0.25 if mesh_key == "taper" else 0.5)
			cyl.height = 1.0
			cyl.radial_segments = 7 if mesh_key != "disc" else 16
			meshes[mesh_key] = cyl
	var n := MeshInstance3D.new()
	n.mesh = meshes[mesh_key]
	n.material_override = mat(color, glow)
	n.position = pos
	n.scale = scale_value
	parent.add_child(n)
	return n

static func box(p: Node3D, v: Vector3, s: Vector3, c: String, glow: float = 0.0) -> MeshInstance3D:
	return primitive(p, "box", v, s, c, glow)

static func rock(p: Node3D, v: Vector3, s: Vector3, c: String) -> MeshInstance3D:
	return primitive(p, "rock", v, s, c)

static func cyl(p: Node3D, v: Vector3, radius: float, height: float, c: String, shape: String = "cylinder", glow: float = 0.0) -> MeshInstance3D:
	return primitive(p, shape, v, Vector3(radius*2.0,height,radius*2.0), c, glow)

static func body(p: Node3D, v: Vector3, s: Vector3, kind: String = "") -> StaticBody3D:
	var b := StaticBody3D.new()
	b.position = v
	p.add_child(b)
	var col := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = s
	col.shape = shape
	b.add_child(col)
	if not kind.is_empty(): b.set_meta("kind",kind)
	return b

static func label(p: Node3D, text: String, v: Vector3, size: int = 28, color: String = "fff0c8") -> Label3D:
	var n := Label3D.new()
	if world_font==null:
		world_font=ThemeDB.fallback_font.duplicate() as FontFile
		world_font.multichannel_signed_distance_field=true
		world_font.msdf_size=64
		world_font.msdf_pixel_range=16
	n.font=world_font
	n.text = text
	n.position = v
	n.font_size = size
	n.pixel_size = 0.005
	n.modulate = Color(color)
	n.outline_size = 2
	p.add_child(n)
	return n

static func line(p: Node3D, a: Vector3, b: Vector3, width: float, color: String) -> void:
	var n := box(p,(a+b)*0.5,Vector3(width,width,a.distance_to(b)),color)
	n.rotation = Basis.looking_at((b-a).normalized(),Vector3.RIGHT if abs((b-a).normalized().dot(Vector3.UP)) > 0.99 else Vector3.UP).get_euler()

static func bone(p: Node3D, a: Vector3, b: Vector3, width: float, color: String) -> void:
	# One rig/physics piece, with physical dimensions baked into the mesh.
	var n := MeshInstance3D.new()
	var shaft := CylinderMesh.new()
	shaft.height = a.distance_to(b)
	shaft.top_radius = width*0.35
	shaft.bottom_radius = width*0.43
	shaft.radial_segments = 7
	n.mesh = shaft
	n.material_override = mat(color)
	n.position = (a+b)*0.5
	var axis := (b-a).normalized()
	var cross_axis := axis.cross(Vector3.FORWARD).normalized()
	n.basis = Basis(cross_axis,axis,cross_axis.cross(axis))
	p.add_child(n)
	for end in [-1,1]:
		for side in [-1,1]:
			rock(n,Vector3(side*width*0.28,end*shaft.height*0.46,0),Vector3(width*0.95,width*1.25,width*1.05),"eadfc2")

static func skeleton_shield(p: Node3D) -> void:
	var n := box(p,Vector3(-0.47,1.04,0.20),Vector3(0.50,0.64,0.12),"675275")
	# Children are authored in normalized plate space, so they stay with the shield.
	for side in [-1,1]:
		box(n,Vector3(side*0.46,0,0.05),Vector3(0.08,1.03,1.15),"b99b66")
		box(n,Vector3(0,side*0.46,0.05),Vector3(0.9,0.08,1.15),"b99b66")
		for end in [-1,1]: rock(n,Vector3(side*0.39,end*0.39,0.63),Vector3(0.09,0.07,0.19),"e6cc8e")
	for x in [-0.23,0.23]: box(n,Vector3(x,0,0.51),Vector3(0.018,0.82,0.03),"473d56")
	rock(n,Vector3(0,0,0.59),Vector3(0.34,0.27,0.75),"c6b484")
	box(n,Vector3(0,0,0.59),Vector3(0.065,0.71,0.12),"ead5a2")

static func floor_patch(p: Node3D, v: Vector3, size: Vector2, color: String) -> void:
	var mesh=box(p,v+Vector3(0,-0.23,0),Vector3(size.x,0.46,size.y),color)
	if p.name=="starfall_ridge" and FileAccess.file_exists("res://assets/zone_art/starfall_ridge/placement.json"):
		# Keep the original floor collision, but let the authored strata skin
		# supply the visible ground instead of z-fighting with a flat box.
		mesh.visible=false
	if p.name=="forge_yard": ForgeMaterials.dress(mesh,"grass","c8d2ad")
	if p.name=="orchard_highlands":
		mesh.material_override=OrchardGround.material()
		mesh.set_meta("atmospheric_ground",true)
	body(p,v+Vector3(0,-0.23,0),Vector3(size.x,0.46,size.y),"floor")

static func entity(root: Node3D, zone: String, kind: String, pos: Vector3, group: String) -> Node3D:
	serial += 1
	var n := Node3D.new()
	n.name = "%s_%s_%03d" % [zone,kind,serial]
	n.position = pos
	n.set_meta("kind",kind)
	n.set_meta("id",n.name)
	n.set_meta("zone",zone)
	n.set_meta("base_position",pos)
	root.add_child(n)
	if not group.is_empty(): n.add_to_group(group)
	return n

static func resource(root: Node3D, data: Dictionary, zone: String, pos: Vector3, resource_id: String, requires: String, amount: int = 3) -> Node3D:
	var n := entity(root,zone,"resource",pos,"adventure_resource")
	for key in ["resource","resource_id"]: n.set_meta(key,resource_id)
	n.set_meta("requires",requires)
	n.set_meta("amount",amount)
	n.set_meta("health",2)
	n.set_meta("hp",2)
	data.resources.append(n)
	return n

static func ore(root: Node3D, data: Dictionary, zone: String, pos: Vector3, resource_id: String, color: String) -> void:
	var n := resource(root,data,zone,pos,resource_id,"pick")
	rock(n,Vector3(0,0.65,0),Vector3(1.6,1.5,1.4),"575668")
	for i in range(5):
		var a: float = float(i)*TAU/5.0
		var crystal := cyl(n,Vector3(cos(a)*0.48,0.65+0.12*(i%3),sin(a)*0.48),0.19,0.85,color,"taper",0.2)
		crystal.rotation = Vector3(cos(a)*0.4,0,sin(a)*0.4)
	body(n,Vector3(0,0.7,0),Vector3(1.6,1.4,1.4))

static func tree(p: Node3D, pos: Vector3, h: float, pine: bool = false, apples: bool = false, pickups: int = 0) -> Node3D:
	return TreeAdapter.tree(p,pos,h,pine,apples,pickups)

static func flowers(p: Node3D, pos: Vector3, count: int, spread: float, color: String = "fff0bd") -> void:
	for i in range(count):
		var a: float = float(i)*2.39996
		var r: float = sqrt(float(i)/maxf(float(count),1.0))*spread
		var v := pos+Vector3(cos(a)*r,0.1,sin(a)*r)
		var blade := box(p,v,Vector3(0.07,0.25+0.06*(i%3),0.02),"7e9f49")
		blade.rotation.z = sin(a)*0.25
		if i%3 == 0:
			rock(p,v+Vector3(0,0.17,0),Vector3(0.16,0.07,0.16),color)
			rock(p,v+Vector3(0,0.21,0),Vector3.ONE*0.055,"e9bd55")

static func path(p: Node3D, start: Vector3, end: Vector3, color: String = "c5b999") -> void:
	var distance: float = start.distance_to(end)
	for i in range(int(distance/1.4)+1):
		var v := start.lerp(end,minf(float(i)*1.4/distance,1.0))
		var n := rock(p,v+Vector3(sin(i*2.1)*0.25,0.012,0),Vector3(1.6,0.08,1.15),color)
		n.rotation.y = i*0.78

static func arch(p: Node3D, pos: Vector3, radius: float, color: String, broken: bool = false) -> void:
	for side in [-1,1]:
		for j in range(4):
			box(p,pos+Vector3(side*radius,0.4+j*0.78,0),Vector3(0.72,0.74,0.9),color)
		body(p,pos+Vector3(side*radius,1.5,0),Vector3(0.8,3,0.95))
	for i in range(9):
		if broken and i == 3: continue
		var a: float = float(i)*PI/8.0
		var n := box(p,pos+Vector3(cos(a)*radius,3.05+sin(a)*radius,0),Vector3(0.75,0.77,0.95),color)
		n.rotation.z = a-PI/2.0

static func crate(p: Node3D, pos: Vector3, size: float = 1.0) -> void:
	box(p,pos+Vector3(0,size*0.5,0),Vector3.ONE*size,"8c603d")
	for side in [-1,1]:
		box(p,pos+Vector3(side*size*0.43,size*0.5,size*0.51),Vector3(size*0.12,size,size*0.06),"b38552")
		box(p,pos+Vector3(0,size*(0.5+side*0.43),size*0.51),Vector3(size,size*0.12,size*0.06),"b38552")
	line(p,pos+Vector3(-size*0.4,size*0.1,size*0.52),pos+Vector3(size*0.4,size*0.9,size*0.52),size*0.1,"bd9160")
	body(p,pos+Vector3(0,size*0.5,0),Vector3.ONE*size)

static func lantern(p: Node3D, pos: Vector3) -> void:
	box(p,pos,Vector3(0.24,0.4,0.24),"ffcb68",1.0)
	for side in [-1,1]:
		box(p,pos+Vector3(side*0.13,0,0),Vector3(0.035,0.44,0.28),"554534")
		box(p,pos+Vector3(0,side*0.23,0),Vector3(0.33,0.045,0.33),"554534")
	cyl(p,pos+Vector3(0,0.33,0),0.2,0.17,"554534","cone")

static func portal(root: Node3D, data: Dictionary, zone: String, pos: Vector3, target: String) -> void:
	var n := entity(root,zone,"portal",pos,"adventure_portal")
	var facing=Vector3(0,pos.y,-4) if zone=="forge_yard" else Vector3(data.zones[zone].center.x,pos.y,data.zones[zone].center.z)
	n.look_at(facing,Vector3.UP,true)
	n.set_meta("target_zone",target)
	n.set_meta("action","travel:"+target)
	var visuals := preload("res://portal_kit/portal_kit.gd").create(target) as Node3D
	visuals.name = "PortalVisuals"
	n.add_child(visuals)
	label(n,str(data.zones[target].name).to_upper(),Vector3(0,3.4,0.0),20)
	# A ray-targetable area keeps the travel action usable while the player can
	# physically step into the gateway. The old central StaticBody blocked it.
	var interaction := Area3D.new()
	interaction.name = "PortalInteraction"
	interaction.position = Vector3(0, 1.05, 0)
	interaction.collision_layer = 1
	interaction.collision_mask = 0
	n.add_child(interaction)
	var interaction_shape := CollisionShape3D.new()
	interaction_shape.name = "CollisionShape3D"
	var aperture := BoxShape3D.new()
	aperture.size = Vector3(1.1, 1.9, 0.12)
	interaction_shape.shape = aperture
	interaction.add_child(interaction_shape)
	data.portals.append(n)

static func enemy(root: Node3D, data: Dictionary, zone: String, pos: Vector3, type: String, variant: String = "") -> void:
	var n := entity(root,zone,"enemy",pos,"adventure_enemy")
	n.set_meta("enemy_type",type)
	if type=="skeleton" and variant!="": n.set_meta("guardian_variant",variant)
	var hp: int = {"skeleton":5,"wisp":4,"golem":8,"boss":30}[type]
	n.set_meta("health",hp)
	n.set_meta("hp",hp)
	n.set_meta("damage",24 if type == "boss" else 8)
	var drop: String = {"skeleton":"haunted_bone","wisp":"spore","golem":"iron","boss":"ember_core"}[type]
	n.set_meta("resource",drop)
	n.set_meta("drop",drop)
	n.set_meta("loot",{drop:1 if type == "boss" else 3})
	n.set_meta("alive",true)
	if type == "skeleton":
		for side in [-1,1]:
			bone(n,Vector3(side*0.16,0.13,0),Vector3(side*0.14,0.78,0),0.10,"d9cfad")
			rock(n,Vector3(side*0.15,0.1,0.06),Vector3(0.16,0.16,0.28),"e5d6b3")
			bone(n,Vector3(side*0.2,1.35,0),Vector3(side*0.45,0.9,0.1),0.10,"e5d6b3")
			rock(n,Vector3(side*0.39,1.15,0.05),Vector3.ONE*0.16,"e5d6b3")
		box(n,Vector3(0,1.1,0),Vector3(0.09,0.75,0.10),"e5d6b3")
		for i in range(4): box(n,Vector3(0,1.05+i*0.095,0),Vector3(0.41-i*0.022,0.045,0.21),"ddd0ae")
		skeleton_skull(n)
		skeleton_shield(n)
		box(n,Vector3(0.48,1.13,0.15),Vector3(0.07,0.92,0.06),"b4c0bc")
		box(n,Vector3(0.48,0.83,0.15),Vector3(0.26,0.06,0.11),"b59456")
	elif type == "wisp":
		rock(n,Vector3(0,1.1,0),Vector3(0.63,0.75,0.63),"83e7cc")
		for i in range(4):
			cyl(n,Vector3(cos(i*PI/2)*0.38,1.15,sin(i*PI/2)*0.38),0.15,0.6,"9374ca","taper",0.5)
		for side in [-1,1]: rock(n,Vector3(side*0.12,1.15,0.3),Vector3(0.07,0.11,0.04),"35566a")
	else:
		var s: float = 1.8 if type == "boss" else 1.0
		var shade := "514951" if type == "boss" else "8b8172"
		for side in [-1,1]:
			rock(n,Vector3(side*0.28,0.22,0.08)*s,Vector3(0.51,0.49,0.62)*s,shade)
			box(n,Vector3(side*0.26,0.6,0)*s,Vector3(0.39,0.66,0.43)*s,shade)
			rock(n,Vector3(side*0.65,1.14,0)*s,Vector3(0.47,0.78,0.55)*s,shade)
			box(n,Vector3(side*0.73,0.83,0.08)*s,Vector3(0.40,0.38,0.48)*s,shade)
		rock(n,Vector3(0,1.23,0)*s,Vector3(1.22,1.10,0.80)*s,shade)
		box(n,Vector3(0,1.07,0.405)*s,Vector3(0.13,0.73,0.02)*s,"ffad38",1.0)
		box(n,Vector3(0,1.4,0.40)*s,Vector3(0.47,0.11,0.035)*s,"ffbd44",1.0)
		rock(n,Vector3(0,1.99,0)*s,Vector3(0.62,0.56,0.53)*s,shade)
		for side in [-1,1]: box(n,Vector3(side*0.14,2.02,0.255)*s,Vector3(0.07,0.065,0.03)*s,"ffcc62",1.0)
		if type == "boss":
			for side in [-1,1]: cyl(n,Vector3(side*0.72,1.65,0)*s,0.15*s,0.55*s,"49424d","cone")
			label(n,"THE CINDER WARDEN",Vector3(0,4.4,0),32,"ffcf85")
	body(n,Vector3(0,1.8 if type == "boss" else 1.0,0),Vector3(2.6,3.7,1.5) if type == "boss" else Vector3(1.2,2.2,0.9))
	data.enemies.append(n)

static func barrier(root: Node3D, data: Dictionary, zone: String, pos: Vector3, requires: String = "bomb") -> void:
	var n := entity(root,zone,"barrier",pos,"adventure_wall")
	n.set_meta("requires",requires)
	n.set_meta("health",3)
	n.set_meta("hp",3)
	for i in range(3):
		for j in range(3): box(n,Vector3((i-1)*0.96,0.45+j*0.85,0),Vector3(0.92,0.81,0.60),"d29b67" if requires == "bomb" else "8e643e")
	for i in range(5): line(n,Vector3(-0.8+i*0.36,0.4+i*0.43,0.32),Vector3(-0.55+i*0.28,0.8+i*0.34,0.32),0.04,"6d554a")
	body(n,Vector3(0,1.3,0),Vector3(3.0,2.6,0.65))
	data.barriers.append(n)

static func anchor(root: Node3D, data: Dictionary, zone: String, pos: Vector3, destination: Vector3) -> void:
	var n := entity(root,zone,"anchor",pos,"grapple_anchor")
	n.set_meta("destination",destination)
	box(n,Vector3.ZERO,Vector3(0.4,0.5,0.4),"b89554")
	var ring := TorusMesh.new()
	ring.inner_radius = 0.23
	ring.outer_radius = 0.33
	ring.rings = 16
	ring.ring_segments = 6
	var visual := MeshInstance3D.new()
	visual.mesh = ring
	visual.material_override = mat("efd584",0.3)
	visual.rotation.x = PI/2.0
	visual.position.y = -0.45
	n.add_child(visual)
	body(n,Vector3(0,-0.3,0),Vector3(0.85,1.1,0.6))
	label(n,"GRAPPLE",Vector3(0,0.7,0),20,"eae2af")
	data.anchors.append(n)

static func batch_decorations(p: Node3D) -> void:
	# Solid architectural decoration gets collision before visual batching.
	for child in p.get_children():
		if not child is MeshInstance3D: continue
		var bounds: AABB=child.transform*child.mesh.get_aabb()
		if bounds.size.x<0.28 or bounds.size.y<0.10 or bounds.size.z<0.28 or bounds.get_center().y<0.15: continue
		var solid:=StaticBody3D.new()
		p.add_child(solid)
		solid.set_meta("kind","solid")
		var collider:=CollisionShape3D.new()
		collider.shape=child.mesh.create_convex_shape()
		collider.transform=child.transform
		solid.add_child(collider)
	# Only directly-owned decoration is batched; entities never enter this group.
	var groups: Dictionary = {}
	for child in p.get_children():
		if child is MeshInstance3D:
			var key := str(child.mesh.get_instance_id())+":"+str(child.material_override.get_instance_id())
			if not groups.has(key): groups[key] = []
			groups[key].append(child)
	for key in groups:
		var nodes: Array = groups[key]
		if nodes.size() < 3: continue
		var multi := MultiMesh.new()
		multi.transform_format = MultiMesh.TRANSFORM_3D
		multi.mesh = nodes[0].mesh
		multi.instance_count = nodes.size()
		var holder := MultiMeshInstance3D.new()
		holder.multimesh = multi
		holder.material_override = nodes[0].material_override
		p.add_child(holder)
		for i in range(nodes.size()):
			multi.set_instance_transform(i,nodes[i].transform)
			nodes[i].free()

static func build(root: Node3D) -> Dictionary:
	serial = 0
	var data := {"zones":{},"resources":[],"barriers":[],"anchors":[],"enemies":[],"portals":[]}
	var specs := [
		["forge_yard","Forge Yard",Vector3(0,0,0),1,"8ea45d"],
		["sandstone_quarry","Sandstone Quarry",Vector3(52,0,0),2,"d8ab78"],
		["enchanted_kitchen","Enchanted Kitchen",Vector3(0,0,52),1,"c8b894"],
		["pinewood_ruins","Pinewood Ruins",Vector3(-52,0,0),1,"82955b"],
		["mushroom_glade","Mushroom Glade",Vector3(-52,0,52),2,"7d9b77"],
		["crystal_hollow","Crystal Hollow",Vector3(52,0,52),3,"68667c"],
		["sky_garden","Sky Garden",Vector3(-52,0,-52),3,"8ea668"],
		["ember_foundry","Ember Foundry",Vector3(52,0,-52),4,"68606a"],
		["orchard_highlands","Orchard Highlands",Vector3(-360,0,0),2,"91a568"],
		["gloamfen","Gloamfen",Vector3(-155,0,115),2,"657d78"],
		["starfall_ridge","Starfall Ridge",Vector3(155,0,110),3,"6d7793"],
		["cloudbreak_keep","Cloudbreak Keep",Vector3(-155,0,-155),3,"a5b8ad"]]
	for spec in specs:
		var p := Node3D.new()
		p.name = spec[0]
		p.position = spec[2]
		root.add_child(p)
		var center: Vector3 = spec[2]
		# Orchard Highlands is the broad playtest slice: a long walk, a wide
		# meadow and a perimeter grove in one continuous physical zone.
		# 320 x 320 m of walkable orchard: 11.1 times the former 96 x 96 m.
		# Its center is farther west so the floor and collision do not overlap
		# Gloamfen, Cloudbreak Keep or the home zones.
		var extent: float = 160.0 if spec[0]=="orchard_highlands" else (28.0 if spec[0] in ["gloamfen","starfall_ridge","cloudbreak_keep"] else (22.0 if spec[0] == "sky_garden" else 15.0))
		data.zones[spec[0]] = {"name":spec[1],"center":center,"spawn":center+Vector3(0,0,8),"bounds":Rect2(Vector2(center.x-extent,center.z-extent),Vector2.ONE*extent*2.0),"tier":spec[3],"root":p}
		data.zones[spec[0]]["environment"] = {"ambient_color":"c5d7df","ambient_energy":0.38,"sun_color":"ffe6bd","sun_energy":1.05,"sky_top":"438dd5","sky_horizon":"82b8e2","fog_color":"adc5d8","fog_density":0.001}
		# Orchard ground/collision is compiled from the shared heightfield at runtime.
		if spec[0] not in ["sky_garden","crystal_hollow","ember_foundry","cloudbreak_keep","orchard_highlands"]: floor_patch(p,Vector3.ZERO,Vector2(extent*2.0,extent*2.0),spec[4])
	data.zones.forge_yard.spawn = Vector3(0,0,0)
	data.zones.crystal_hollow.environment = {"ambient_color":"738bbf","ambient_energy":0.32,"sun_color":"b3cdf7","sun_energy":0.05,"sky_top":"202a46","sky_horizon":"303d59","fog_color":"35486a","fog_density":0.012}
	data.zones.ember_foundry.environment = {"ambient_color":"a77678","ambient_energy":0.38,"sun_color":"ffad6b","sun_energy":0.70,"sky_top":"704869","sky_horizon":"d58a67","fog_color":"8e5e70","fog_density":0.006}
	data.zones.enchanted_kitchen.environment = {"ambient_color":"ddd2b9","ambient_energy":0.32,"sun_color":"ffe2ad","sun_energy":0.95,"sky_top":"438dd5","sky_horizon":"82b8e2","fog_color":"c5ba9e","fog_density":0.001}
	data.zones.orchard_highlands.environment = {"ambient_color":"b9caca","ambient_energy":0.38,"sun_color":"fff1c6","sun_energy":0.95,"sky_top":"5192d7","sky_horizon":"b9d9e7","fog_color":"bbd6ca","fog_density":0.0008}
	data.zones.gloamfen.environment = {"ambient_color":"73908c","ambient_energy":0.18,"sun_color":"abc4c0","sun_energy":0.58,"sky_top":"1b3349","sky_horizon":"4e7a77","fog_color":"496f6a","fog_density":0.012}
	data.zones.starfall_ridge.environment = {"ambient_color":"8196b0","ambient_energy":0.25,"sun_color":"ecd9b9","sun_energy":0.72,"sky_top":"263e72","sky_horizon":"718dc2","fog_color":"667c96","fog_density":0.0025}
	data.zones.cloudbreak_keep.environment = {"ambient_color":"d6e7e4","ambient_energy":0.48,"sun_color":"ffffff","sun_energy":1.05,"sky_top":"4c94d6","sky_horizon":"d1e8ee","fog_color":"bbd7e4","fog_density":0.003}
	var views := {
		"forge_yard":[Vector3(5.5,1.8,6.5),Vector3(-1,1.7,-4)],
		"sandstone_quarry":[Vector3(-6,1.8,9),Vector3(2,1.8,-5)],
		"enchanted_kitchen":[Vector3(5.5,1.8,7.0),Vector3(-1,1.8,-5)],
		"pinewood_ruins":[Vector3(4,1.8,8),Vector3(-1,1.8,-5)],
		"mushroom_glade":[Vector3(0,1.8,7.0),Vector3(1,2.0,-5)],
		"crystal_hollow":[Vector3(5.5,1.8,7),Vector3(-1,2.0,-6)],
		"sky_garden":[Vector3(2,1.8,8),Vector3(-2,3.0,-9)],
		"ember_foundry":[Vector3(5,1.8,8),Vector3(0,2.6,-7)],
		"orchard_highlands":[Vector3(5,1.8,11),Vector3(-2,1.8,-10)],
		"gloamfen":[Vector3(3,1.8,11),Vector3(0,2.4,-11)],
		"starfall_ridge":[Vector3(6,1.8,11),Vector3(-4,3.0,-12)],
		"cloudbreak_keep":[Vector3(1,1.8,10),Vector3(0,3.0,-12)]}
	for id in views:
		data.zones[id]["capture_position"] = data.zones[id].center + views[id][0]
		data.zones[id]["capture_target"] = data.zones[id].center + views[id][1]
	forge(data.zones.forge_yard.root)
	quarry(root,data)
	kitchen(data.zones.enchanted_kitchen.root)
	pinewood(root,data)
	mushroom(root,data)
	crystal_hollow(root,data)
	sky(root,data)
	foundry(root,data)
	load("res://world_expeditions.gd").populate(root,data)
	# A compact waystone garden gives every initial zone immediate access. Tools
	# govern opportunities within locations; inventive alternate routes remain valid.
	var destinations := ["pinewood_ruins","sandstone_quarry","enchanted_kitchen","mushroom_glade","crystal_hollow","sky_garden","ember_foundry"]
	for i in range(destinations.size()):
		var target: String = destinations[i]
		portal(root,data,"forge_yard",Vector3(-10.5+i*3.5,0,10.8),target)
		var c: Vector3 = data.zones[target].center
		portal(root,data,target,c+Vector3(7.5,0,9.5),"forge_yard")
	# An outer ring makes exploration feel like a journey. Its return gates lead
	# back to the parent region, so the hub keeps its intimate seven-way garden.
	var branches={"pinewood_ruins":"orchard_highlands","mushroom_glade":"gloamfen","crystal_hollow":"starfall_ridge","sky_garden":"cloudbreak_keep"}
	for parent_id in branches:
		var child_id: String=branches[parent_id]
		portal(root,data,parent_id,data.zones[parent_id].center+Vector3(-8.5,0,9.5),child_id)
		portal(root,data,child_id,data.zones[child_id].center+Vector3(7.5,0,19.5),parent_id)
	for id in data.zones:
		backdrop(data.zones[id].root,id)
		var z: Dictionary = data.zones[id]
		if id != "forge_yard":
			label(z.root,z.name.to_upper(),Vector3(0,3.8,12.8),38)
		batch_decorations(z.root)
		# Zone art is placed after legacy dressing has been batched. A manifest can
		# improve any region without teaching this world builder new mesh types.
		var zone_art_path := "res://assets/zone_art/%s/placement.json" % id
		if FileAccess.file_exists(zone_art_path):
			var art_result: Dictionary = AuthoredZoneKit.load_into(z.root, zone_art_path)
			if art_result.has("error"):
				push_error("Zone art %s: %s" % [id, art_result.error])
			else:
				z["authored_art"] = art_result
				if id in ["sky_garden", "cloudbreak_keep"]:
					# The authored posts include their own visible gold rings. Keep
					# the grapple target bodies, but hide duplicate primitive rings.
					for grapple in data.anchors:
						if grapple.get_meta("zone", "") != id: continue
						for piece in grapple.get_children():
							if piece is VisualInstance3D: piece.visible = false
		GroundKit.populate(z.root,id,float(z.bounds.size.x)*0.5)
		if id == "orchard_highlands": OrchardDressing.populate(z.root)
		# These masses are one or two batched surfaces inside their own container.
		# The container prevents decoration batching from adding convex canopy-like
		# collision around them; only the kit's deliberate simple proxies are solid.
		if id in ["sandstone_quarry","crystal_hollow","ember_foundry","cloudbreak_keep"] and not z.has("authored_art"):
			var landmark_kit = LandmarkKit.new(id)
			if id=="cloudbreak_keep":
				# Shape existing islands without introducing new bridges or grapple routes.
				landmark_kit.island_underside(Vector3(0,0,10),Vector2(28,24),12.0,{"name":"main_underside","spurs":4})
				landmark_kit.island_underside(Vector3(-16,2.2,-8),Vector2(13,12),7.5,{"name":"west_underside"})
				landmark_kit.island_underside(Vector3(15,4.2,-15),Vector2(12,12),8.0,{"name":"east_underside"})
				landmark_kit.island_underside(Vector3(-3,6,-25),Vector2(14,12),8.5,{"name":"north_underside"})
			else:
				landmark_kit.add_suggested()
			data.zones[id]["landmarks"] = landmark_kit.build(z.root)
	return data

static func forge(p: Node3D) -> void:
	# The authored shell keeps Brann, the boards and all upgrade anchors where
	# they are.  Only broad architectural members receive simple collision.
	ForgeMaterials.dress(box(p,Vector3(0,-0.01,-3.8),Vector3(17,0.08,7.8),"bca47e"),"stone","c5b8a1")
	for asset in ["res://assets/forge-yard/forge_shelter.glb","res://assets/forge-yard/forge_detail_kit.glb"]:
		var scene: PackedScene = load(asset)
		if scene == null:
			push_error("FORGE_ARCHITECTURE missing="+asset)
			continue
		var architecture := scene.instantiate()
		architecture.name = "Authored_"+asset.get_file().get_basename()
		p.add_child(architecture)
	for x in [-8.3,-4.6,4.6,8.3]:
		for z in [-7.35,-0.45]: body(p,Vector3(x,2.0,z),Vector3(0.45,4.0,0.45),"solid")
	for x in [-8.3,8.3]: body(p,Vector3(x,2.0,-3.9),Vector3(0.45,4.0,0.45),"solid")
	for x in [-5.5,5.5]: body(p,Vector3(x,1.5,-7.58),Vector3(5.0,3.0,0.35),"solid")
	body(p,Vector3(0,3.42,-7.58),Vector3(3.0,0.62,0.35),"solid")
	for x in [-1.3,1.3]: body(p,Vector3(x,1.3,2.7),Vector3(0.34,2.6,0.36),"solid")
	# A real rear doorway lets the final foundry connect to the original forge.
	var gate=Node3D.new(); p.add_child(gate); gate.name="FoundryGate"; gate.add_to_group("foundry_gate")
	ForgeMaterials.dress(box(gate,Vector3(0,1.4,-7.6),Vector3(2.9,2.8,0.16),"73553c"),"timber","8c6e55")
	for y in [0.6,2.2]: box(gate,Vector3(0,y,-7.48),Vector3(2.95,0.13,0.10),"b49b67")
	body(gate,Vector3(0,1.4,-7.6),Vector3(2.9,2.8,0.2),"solid")
	label(gate,"THE HEARTH BEYOND\nAwakens with the Everburning Forge",Vector3(0,3.16,-7.35),17)
	var smoke=preload("res://forge_atmosphere.gd").new()
	p.add_child(smoke)
	smoke.name="ForgeSmoke"
	smoke.position=Vector3(-3.1,7.99,-4.9)
	# The authored lantern meshes provide the silhouettes; two cheap lights give
	# the front posts a warm pool without doubling the geometry.
	for x in [-8.3,8.3]: glow_light(p,Vector3(x,3.0,-0.45),"ffd08b",0.4,3.2)
	glow_light(p,Vector3(-3.1,1.6,-3.9),"ff9a43",1.8,7.0)
	# Low garden walls, apple trees, winding flagstone approaches.
	for side in [-1,1]:
		for j in range(7): box(p,Vector3(side*14,0.6,-11+j*3),Vector3(0.65,1.2,2.85),"a2a38c")
		for j in range(3):
			if j!=1: tree(p,Vector3(side*(11.0+j%2),0,-9+j*6),4.5+j*0.5,false,j==2) # Keep the future workshop wings clear.
		flowers(p,Vector3(side*9,0,4),35,2.7)
	path(p,Vector3(0,0,8),Vector3(0,0,0))
	for v in [Vector3(-6,0,1.3),Vector3(6.7,0,2.0)]: crate(p,v,0.95)
	for x in [-5,0,5]:
		box(p,Vector3(x,0.015,6.9),Vector3(2.5,0.02,0.6),"b9a679")
	# The seven authored gates carry their own destination names; a second
	# floating waystone caption here overlapped them from the garden path.

static func quarry(root: Node3D, data: Dictionary) -> void:
	var id := "sandstone_quarry"
	var p: Node3D = data.zones[id].root
	var c: Vector3 = data.zones[id].center
	# The Sonnet kit replaces only the old decorative perimeter. Gameplay ore,
	# barrier, golem and the shared floor remain at their established positions.
	if not FileAccess.file_exists("res://assets/zone_art/sandstone_quarry/placement.json"):
		for i in range(11):
			var x: float = -15+i*3.0
			var h: float = 5.5+float(i%4)*1.2
			box(p,Vector3(x,h*0.5,-12.5),Vector3(3.6,h,4.5),["cd8b59","d99d63","b97655"][i%3])
			box(p,Vector3(x+0.4,h+0.9,-13.4),Vector3(3.0,1.8,3.0),"dea570")
		for side in [-1,1]:
			for i in range(5):
				rock(p,Vector3(side*14,2+i%3,-6+i*4),Vector3(5,6+i%3,4.5),"cf915d")
		for i in range(20): rock(p,Vector3(sin(i*2.4)*11,0.18,cos(i*3.1)*10),Vector3(0.5,0.4,0.6),"ca9266")
	for i in range(3): ore(root,data,id,c+Vector3(-6+i*5,0,-1+(i%2)*5),"iron","e4b54e")
	for i in range(3): ore(root,data,id,c+Vector3(-8+i*6,0,-7),"stone","a5b6bb")
	arch(p,Vector3(5,0,-10),1.8,"b68159")
	barrier(root,data,id,c+Vector3(5,0,-10))
	ore(root,data,id,c+Vector3(5,0,-13),"crystal","b784e0")
	for i in range(4): crate(p,Vector3(-10+i%2*1.2,0,4+floorf(float(i)/2)*1.2),1.1)
	box(p,Vector3(-9,2.8,-8),Vector3(1.4,2.5,0.09),"a9583f")
	label(p,"THE QUARRY\nIRON IN THE SUN",Vector3(-9,2.8,-7.93),24)
	enemy(root,data,id,c+Vector3(2,0,-5),"golem")
	path(p,Vector3(0,0,9),Vector3(4,0,-8),"e8ba86")

static func kitchen(p: Node3D) -> void:
	# Warm, oversized farmhouse interior: open front makes navigation legible.
	for x in range(-7,8):
		for z in range(-7,8): box(p,Vector3(x*1.6,0.018,z*1.6),Vector3(1.56,0.06,1.56),"d5c4a1" if (x+z)%3 else "c6b38f")
	box(p,Vector3(0,2.65,-12),Vector3(24,5.3,0.35),"d4c09c")
	for side in [-1,1]:
		box(p,Vector3(side*12,2.65,0),Vector3(0.35,5.3,24),"cbb591")
		body(p,Vector3(side*12,2.65,0),Vector3(0.35,5.3,24))
		for z in [-10,-4,3,10]: box(p,Vector3(side*11.78,2.6,z),Vector3(0.3,5.2,0.3),"855b3c")
	body(p,Vector3(0,2.65,-12),Vector3(24,5.3,0.35))
	for x in [-10,-5,0,5,10]: box(p,Vector3(x,5.15,0),Vector3(0.3,0.35,24),"8c613e")
	for z in [-11,-4,4,11]: box(p,Vector3(0,5.1,z),Vector3(24,0.35,0.3),"916440")
	# Sheltered roof leaves the front edge open to sunlight.
	box(p,Vector3(0,5.45,-1.5),Vector3(24.5,0.2,22),"b38656")
	for side in [-1,1]:
		for i in range(5):
			var v := Vector3(side*10.6,0,-8+i*3.1)
			box(p,v+Vector3(0,0.58,0),Vector3(2,1.16,2.8),"8b633f")
			box(p,v+Vector3(0,1.21,0),Vector3(2.2,0.16,3),"bd9665")
			body(p,v+Vector3(0,0.65,0),Vector3(2.2,1.3,3))
			for j in [-1,1]:
				cyl(p,v+Vector3(0,1.46,j*0.66),0.32,0.38,"8f633f","taper")
				cyl(p,v+Vector3(0,1.70,j*0.66),0.24,0.08,"bd8d58")
		box(p,Vector3(side*11.5,3.25,-4),Vector3(0.85,0.14,12),"8d623e")
		for i in range(9):
			var v := Vector3(side*11.5,3.53,-9+i*1.25)
			cyl(p,v,0.18+(i%2)*0.07,0.42,["a97448","798d6a","bc9672"][i%3],"taper")
			line(p,Vector3(side*10.9,4.5,-9+i*1.25),Vector3(side*10.9,3.9,-9+i*1.25),0.04,"8b6f44")
			rock(p,Vector3(side*10.9,3.9,-9+i*1.25),Vector3(0.2,0.5,0.26),"738451")
	# Hearth with arched mantle, warm embers and tall chimney.
	box(p,Vector3(0,1.25,-10.7),Vector3(4,2.5,1.1),"62594d")
	for side in [-1,1]: box(p,Vector3(side*1.7,1.25,-10),Vector3(0.65,2.5,1.0),"9f9785")
	for i in range(7):
		var a: float = float(i)*PI/6
		var voussoir := box(p,Vector3(cos(a)*1.6,2.1+sin(a)*1.4,-10),Vector3(0.72,0.73,1),"a6a08d")
		voussoir.rotation.z = a-PI/2
	box(p,Vector3(0,4.1,-10.7),Vector3(2.4,2.3,1.1),"9c9789")
	for i in range(7):
		cyl(p,Vector3(-1.1+i*0.36,0.5,-10),0.19,0.5+(i%3)*0.3,"ffbc4f","cone",1.2)
	box(p,Vector3(0,0.027,-2),Vector3(6,0.035,8),"a65b47")
	box(p,Vector3(0,0.05,-2),Vector3(5.5,0.015,7.5),"bd7151")
	box(p,Vector3(0,1.10,-2),Vector3(4.3,0.19,2.8),"a57647")
	for x in [-1.7,1.7]:
		for z in [-3,-1]: box(p,Vector3(x,0.55,z),Vector3(0.2,1.1,0.2),"805535")
	body(p,Vector3(0,0.7,-2),Vector3(4.3,1.4,2.8))
	for i in range(3):
		rock(p,Vector3(-1.2+i*1.1,1.5,-2),Vector3(0.75,0.69,0.73),"d88a34")
		cyl(p,Vector3(-1.2+i*1.1,1.88,-2),0.06,0.2,"6c793d")
	# Floating enchanted teacups, torus handles and sparkling sugar.
	for side in [-1,1]:
		var v := Vector3(side*5.7,2.1,-4)
		cyl(p,v,0.38,0.40,"e7dec5","taper")
		cyl(p,v+Vector3(0,0.22,0),0.24,0.015,"805944","disc")
		cyl(p,v+Vector3(0,-0.22,0),0.50,0.045,"d9d4bd","disc")
		var torus := TorusMesh.new()
		torus.inner_radius = 0.12
		torus.outer_radius = 0.18
		var handle := MeshInstance3D.new()
		handle.mesh = torus
		handle.material_override = mat("e7dec5")
		handle.position = v+Vector3(0.36,0.05,0)
		handle.rotation.x = PI/2
		p.add_child(handle)
		for i in range(9):
			var a: float = float(i)*TAU/9
			cyl(p,v+Vector3(cos(a)*0.7,sin(i*1.9)*0.4,sin(a)*0.5),0.055,0.2,"9bd1f6","taper",0.8)
	for x in [-5.5,5.5]:
		lantern(p,Vector3(x,3.8,-7.5))
		glow_light(p,Vector3(x,3.2,-7.5),"ffd394",1.3,9)
	glow_light(p,Vector3(0,1.8,-8.8),"ffa856",2.6,11)
	glow_light(p,Vector3(0,3.0,-1),"ffe0a4",1.3,10)
	label(p,"THE ENCHANTED KITCHEN",Vector3(0,4.6,-9.5),42)
	label(p,"A little mischief. A very good supper.",Vector3(0,3.95,-9.4),25)

static func pinewood(root: Node3D, data: Dictionary) -> void:
	var id := "pinewood_ruins"
	var p: Node3D = data.zones[id].root
	var c: Vector3 = data.zones[id].center
	for i in range(14):
		var a: float = float(i)*TAU/14
		var tree_position := Vector3(cos(a)*12.5,0,sin(a)*12.5)
		# The two northern waystones need a walkable approach through the grove.
		if tree_position.z > 7.5 and absf(tree_position.x) > 5.0 and absf(tree_position.x) < 11.0:
			tree_position.z += 4.5
		tree(p,tree_position,5.5+(i%3),i%3!=0,i%3==0)
	for v in [Vector3(-6,0,4),Vector3(5,0,2),Vector3(-7,0,-4)]:
		var n := resource(root,data,id,c+v,"lumber","axe")
		tree(n,Vector3.ZERO,4.7,false,true,1)
		var reach_points: Array = n.get_meta("reach_points",[])
		var fruit_pos: Vector3 = c+v+(reach_points[0] if not reach_points.is_empty() else Vector3(0.75,1.8,0.55))
		var apple := resource(root,data,id,fruit_pos,"apple","",1)
		apple.set_meta("host_tree",n)
	arch(p,Vector3(0,0,-6),1.8,"949b91",true)
	for side in [-1,1]:
		for i in range(4):
			box(p,Vector3(side*(3.2+i*1.6),0.5+(i%2)*0.3,-6),Vector3(1.5,1+(i%2)*0.6,1),"949b91")
		for i in range(3): rock(p,Vector3(side*(3.5+i),0.5,1+i*2),Vector3(1.2,1.0,1.3),"a0a698")
	for i in range(6):
		box(p,Vector3(-2+i*0.8,0.10,-7.7),Vector3(0.76,0.2,2.1),"a7ac9c")
	for i in range(7): flowers(p,Vector3(sin(i*2.1)*8,0,cos(i*2.1)*8),30,2.2)
	path(p,Vector3(0,0,10),Vector3(0,0,-6))
	enemy(root,data,id,c+Vector3(0,0,-8.7),"skeleton","mossward")
	enemy(root,data,id,c+Vector3(5,0,-8.5),"skeleton","mossward")
	barrier(root,data,id,c+Vector3(-5,0,-9),"chop")
	label(p,"THE ORCHARD REMEMBERS",Vector3(-6,2.2,6),26)

static func mushroom(root: Node3D, data: Dictionary) -> void:
	var id := "mushroom_glade"
	var p: Node3D = data.zones[id].root
	var c: Vector3 = data.zones[id].center
	for i in range(13):
		var a: float = float(i)*TAU/13
		# Leave real gaps in the stone ring at the two portal approaches.
		var stone_position := Vector3(cos(a)*14,3,sin(a)*14)
		if stone_position.z > 8.0 and absf(stone_position.x) > 5.0 and absf(stone_position.x) < 11.0:
			continue
		rock(p,Vector3(cos(a)*14,3,sin(a)*14),Vector3(4.0,6.0+(i%3),4.5),"828d91")
		rock(p,Vector3(cos(a)*14,6,sin(a)*14),Vector3(4.1,0.8,4.6),"86a465")
	# Shallow enchanted pool with stepping stones; water is safe to walk through.
	cyl(p,Vector3(1,0.025,-3),5.8,0.035,"75c9c3","disc",0.1)
	for i in range(9):
		rock(p,Vector3(-4+i*1.1,0.06,-1.8+sin(i)*0.5),Vector3(1.0,0.20,0.8),"a4afa4")
	for i in range(9):
		var a: float = float(i)*2.4
		var v := Vector3(cos(a)*(8+i%3),0,sin(a)*(8+i%3))
		if v.z > 5.0 and abs(v.x) < 6.0: v.x += 7.0 if v.x >= 0 else -7.0
		var h: float = 2.0+float(i%3)*1.4
		cyl(p,v+Vector3(0,h*0.48,0),0.34,h*0.96,"d2c7b0","taper")
		cyl(p,v+Vector3(0,h,0),h*0.55,h*0.035,"d5c0ba","disc")
		rock(p,v+Vector3(0,h*1.13,0),Vector3(h*1.15,h*0.30,h*1.15),["9b64bb","af7cc9","8b5caf"][i%3])
		for j in range(5):
			var b: float = float(j)*TAU/5
			rock(p,v+Vector3(cos(b)*h*0.32,h*1.23,sin(b)*h*0.32),Vector3(0.3,0.07,0.27),"d7b8de")
		body(p,v+Vector3(0,h*0.45,0),Vector3(0.65,h*0.9,0.65))
	for i in range(5):
		var n := resource(root,data,id,c+Vector3(-7+i*3,0,4+(i%2)*2),"spore","",3)
		for j in range(3):
			cyl(n,Vector3((j-1)*0.28,0.22,0),0.05,0.44,"b8d2a6")
			rock(n,Vector3((j-1)*0.28,0.47,0),Vector3(0.38,0.25,0.38),"b789d6")
		body(n,Vector3(0,0.4,0),Vector3(1,0.8,0.7))
	box(p,Vector3(3,3,-12),Vector3(2,6,0.07),"85d4d3",0.2)
	box(p,Vector3(3.3,3,-11.95),Vector3(0.35,6,0.03),"b0e5df",0.2)
	rock(p,Vector3(-4,1.3,-8),Vector3(2,2.9,1.2),"b3b7a7")
	label(p,"◉",Vector3(-4,1.8,-7.35),82,"60aaa1")
	for i in range(8): flowers(p,Vector3(sin(i*3.4)*10,0,cos(i*3.4)*10),25,1.8,"9bd3dd")
	enemy(root,data,id,c+Vector3(-4,0,-4),"wisp")

static func crystal_cluster(p: Node3D, v: Vector3, size: float, color: String) -> void:
	for j in range(5):
		var a: float = float(j)*2.4
		preload("res://crystal_art.gd").shard(p,v+Vector3(cos(a)*size*0.25,size*(0.55+0.14*(j%3)),sin(a)*size*0.25),Vector3(size*0.32,size*(1.1+0.2*(j%3)),size*0.32),Color(color))

static func crystal_hollow(root: Node3D, data: Dictionary) -> void:
	var id := "crystal_hollow"
	var p: Node3D = data.zones[id].root
	var c: Vector3 = data.zones[id].center
	floor_patch(p,Vector3(0,0,6.5),Vector2(30,17),"777688")
	floor_patch(p,Vector3(0,0,-10.5),Vector2(30,9),"737285")
	box(p,Vector3(0,-5,-4),Vector3(30,0.25,5),"356d9d",0.4)
	box(p,Vector3(0,11,0),Vector3(31,2.0,31),"313c53")
	for i in range(6):
		var a: float = float(i)*TAU/6
		glow_light(p,Vector3(cos(a)*8,2.0,sin(a)*8),"68c9ea" if i%2 else "d184d2",1.8,10)
	CrystalHollowArt.add(p)
	# Physically supported plank bridge above a genuine gap.
	for i in range(9):
		box(p,Vector3(0,0.045,-1.3-i*0.57),Vector3(2.2,0.13,0.53),"a18266")
	body(p,Vector3(0,-0.04,-3.6),Vector3(2.2,0.18,5.3),"floor")
	for side in [-1,1]:
		for z in [-1,-3.5,-6]: box(p,Vector3(side*1.13,0.6,z),Vector3(0.12,1.2,0.12),"705742")
		line(p,Vector3(side*1.13,1.0,-1),Vector3(side*1.13,0.85,-3.5),0.055,"bfaa83")
		line(p,Vector3(side*1.13,0.85,-3.5),Vector3(side*1.13,1.0,-6),0.055,"bfaa83")
	for i in range(4): ore(root,data,id,c+Vector3(-7+i*4.5,0,-10),"crystal","7adfe6" if i%2 else "d993d9")
	enemy(root,data,id,c+Vector3(3,0,-8),"golem")
	enemy(root,data,id,c+Vector3(-5,0,-7.5),"skeleton","prismwatch")
	anchor(root,data,id,c+Vector3(4,3,-8),c+Vector3(4,0,-8))
	crate(p,Vector3(-6,0,5),0.8)
	label(p,"EVERY STONE HOLDS A LITTLE SKY",Vector3(0,6.2,-10.9),26,"b7e5ed")

static func island(p: Node3D, pos: Vector3, size: Vector2, authored_edges: bool = false) -> void:
	floor_patch(p,pos,size,"92aa69")
	# Keep the authoritative top collision while an authored kit supplies the
	# cliff lip and underside. The old box/cone would show through that shell.
	if authored_edges: return
	box(p,pos+Vector3(0,-0.8,0),Vector3(size.x,1.15,size.y),"b3b7a5")
	var base := primitive(p,"cone",pos+Vector3(0,-3.4,0),Vector3(size.x,5.3,size.y),"8d98a1")
	base.rotation.z = PI
	for i in range(5): rock(p,pos+Vector3(sin(i*2.4)*size.x*0.3,0.13,cos(i*2.4)*size.y*0.3),Vector3(0.9,0.13,0.7),"c2c7b2")

static func sky(root: Node3D, data: Dictionary) -> void:
	var id := "sky_garden"
	var p: Node3D = data.zones[id].root
	var c: Vector3 = data.zones[id].center
	var authored := FileAccess.file_exists("res://assets/zone_art/sky_garden/placement.json")
	island(p,Vector3(0,0,6),Vector2(22,18),authored)
	island(p,Vector3(-10,1.8,-11),Vector2(10,10),authored)
	island(p,Vector3(10,3.2,-10),Vector2(9,9),authored)
	if not authored:
		for side in [-1,1]:
			for j in range(4):
				var v := Vector3(side*10,0,0+j*3)
				box(p,v+Vector3(0,0.75,0),Vector3(0.35,1.5,0.35),"c4cbb7")
				box(p,v+Vector3(0,0.55,1.5),Vector3(0.25,0.25,2.8),"bdc7b2")
			flowers(p,Vector3(side*7,0,5),45,2.2)
	# The windmill sits high across open air; gold rings have explicit safe landing points.
	if not authored:
		cyl(p,Vector3(-10,4.8,-11),1.4,6,"c8c8aa","taper")
		cyl(p,Vector3(-10,8.1,-11),1.8,1.6,"b8704b","cone")
		arch(p,Vector3(-10,1.8,-9.65),0.65,"aab2a0")
	var rotor=Node3D.new(); p.add_child(rotor); rotor.name="WindmillRotor"; rotor.position=Vector3(-10,6.6,-9.45)
	if authored:
		var authored_rotor := load("res://assets/zone_art/sky_garden/windmill_rotor.glb") as PackedScene
		if authored_rotor != null: rotor.add_child(authored_rotor.instantiate())
	else:
		for i in range(4):
			var arm=Node3D.new(); rotor.add_child(arm); arm.rotation.z=i*PI/2+0.4
			line(arm,Vector3.ZERO,Vector3(3.2,0,0),0.12,"8f7957")
			for side in [-1,1]: line(arm,Vector3(1,side*0.30,0),Vector3(3.2,side*0.30,0),0.065,"ba9b68")
			for j in range(6): line(arm,Vector3(1+j*0.42,-0.3,0),Vector3(1+j*0.42,0.3,0),0.065,"cbb583")
	for v in [Vector3(-7,1.8,-8),Vector3(8,3.2,-8),Vector3(-4,0,0)]:
		if not authored:
			box(p,v+Vector3(0,2.1,0),Vector3(0.23,4.2,0.23),"95794e")
			box(p,v+Vector3(0.9,4,0),Vector3(2,0.18,0.18),"95794e")
		anchor(root,data,id,c+v+Vector3(1.8,3.5,0),c+v+Vector3(1,0,0.7))
	for i in range(3):
		var n := resource(root,data,id,c+Vector3(9+(i%2),3.2,-10+i*1.2),"sky_bloom","",3)
		cyl(n,Vector3(0,0.5,0),0.04,1,"7eaa7c")
		for j in range(5): rock(n,Vector3(cos(j*TAU/5)*0.21,1,sin(j*TAU/5)*0.21),Vector3(0.35,0.14,0.35),"e9e6bc")
		rock(n,Vector3(0,1.06,0),Vector3.ONE*0.18,"94deda")
		body(n,Vector3(0,0.6,0),Vector3(0.8,1.3,0.8))
	if not authored:
		for i in range(6):
			var v := Vector3(-20+i*8,-3-i%2,21)
			rock(p,v,Vector3(6,2,3),"e5eef0")
	if not authored: label(p,"THE WIND KNOWS ANOTHER WAY",Vector3(0,2.9,0),27)

static func foundry(root: Node3D, data: Dictionary) -> void:
	var id := "ember_foundry"
	var p: Node3D = data.zones[id].root
	var c: Vector3 = data.zones[id].center
	var authored := FileAccess.file_exists("res://assets/zone_art/ember_foundry/placement.json")
	box(p,Vector3(0,-0.7,0),Vector3(31,0.25,31),"ed803a",0.9)
	floor_patch(p,Vector3(0,0,7),Vector2(24,15),"6e6870")
	floor_patch(p,Vector3(0,0,-7),Vector2(22,10),"68616c")
	floor_patch(p,Vector3(0,0,-1),Vector2(4,4),"7d7273")
	# Keep lava and gameplay floors authoritative while an authored kit replaces
	# the old primitive perimeter, gate, floor decals and static braziers.
	if not authored:
		for i in range(14):
			var a: float = float(i)*TAU/14
			rock(p,Vector3(cos(a)*15,2.8,sin(a)*15),Vector3(3.6,5.8+i%3,3.6),"685764")
		for x in [-10,-6,6,10]:
			box(p,Vector3(x,3.2,-11.6),Vector3(1.05,6.4,1.05),"716674")
			box(p,Vector3(x,6.4,-11.6),Vector3(1.45,0.43,1.45),"867781")
		box(p,Vector3(0,3.7,-12.5),Vector3(9,7.4,1.3),"635665")
		arch(p,Vector3(0,0,-11.8),2.0,"92807d")
		box(p,Vector3(0,2.1,-11.72),Vector3(3.2,4.2,0.10),"3e3946")
		box(p,Vector3(0,2.3,-11.62),Vector3(0.1,3.9,0.04),"ffc36b",1.2)
		box(p,Vector3(0,3.7,-11.59),Vector3(1.9,0.12,0.06),"ffc36b",1.2)
		for side in [-1,1]:
			box(p,Vector3(side*4.4,4.7,-11.3),Vector3(1.7,3.4,0.08),"a85d45")
			label(p,"♜",Vector3(side*4.4,4.7,-11.22),80,"efb971")
			for z in [-8,4,10]:
				box(p,Vector3(side*9,0.65,z),Vector3(0.85,1.3,0.85),"8b7d7e")
				cyl(p,Vector3(side*9,1.4,z),0.55,0.3,"52434c","taper")
				for j in range(3): cyl(p,Vector3(side*9+(j-1)*0.21,1.8,z),0.16,0.65-(j%2)*0.12,"ffb94f","cone",1.2)
		for i in range(12):
			box(p,Vector3(-10+(i%6)*4,0.01,2+floorf(float(i)/6)*5),Vector3(3.94,0.05,4.94),"766c74" if i%2 else "6d6570")
		for i in range(10):
			cyl(p,Vector3(sin(i*3.2)*13,0.5,cos(i*2.4)*13),0.04,0.1,"ffd983","taper",1.0)
	enemy(root,data,id,c+Vector3(0,0,-7),"boss")
	enemy(root,data,id,c+Vector3(5,0,-5),"skeleton","cinderkeep")
	ore(root,data,id,c+Vector3(-7,0,-7),"iron","e7a55b")
	label(p,"THE CINDER WARDEN",Vector3(0,5.9,-11.4),38,"ffcf9d")
	label(p,"One ember. A forge changed forever.",Vector3(0,1.5,4),25,"edd2b1")
	glow_light(p,Vector3(-7,1,0),"ff7639",2.2,11)
	glow_light(p,Vector3(7,1,-5),"ff9945",2.2,11)

static func glow_light(p: Node3D, pos: Vector3, color: String, energy: float, radius: float) -> void:
	var light := OmniLight3D.new()
	light.position = pos
	light.light_color = Color(color)
	light.light_energy = energy
	light.omni_range = radius
	p.add_child(light)

static func backdrop(p: Node3D, id: String) -> void:
	if id == "sky_garden" and FileAccess.file_exists("res://assets/zone_art/sky_garden/placement.json"): return
	if id in ["crystal_hollow","enchanted_kitchen","orchard_highlands","gloamfen","starfall_ridge","cloudbreak_keep"]: return
	if id == "sky_garden":
		# A layered archipelago gives the islands a scale reference in the open air.
		for i in range(8):
			var v := Vector3(-39+i*11.5,-5.0+(i%3)*3.0,-28-(i%2)*10)
			var width: float = 5.0+(i%3)*1.4
			var tip := primitive(p,"cone",v-Vector3(0,3.0,0),Vector3(width,6,width*0.8),"819cab")
			tip.rotation.z = PI
			rock(p,v,Vector3(width,1,width*0.8),"a2ba8d")
			tree(p,v+Vector3(0,0.3,0),1.4+(i%3)*0.5,true)
			box(p,v+Vector3(width*0.25,-3.5,0),Vector3(0.20,7,0.2),"a0d9e5",0.1)
		for i in range(11):
			var v := Vector3(-48+i*9.0,8.0+(i%3)*2.2,-41-(i%2)*7)
			for j in range(3): rock(p,v+Vector3(j*1.8,sin(j*2.0)*0.6,0),Vector3(4.6,2.2,2.8),"e1edf2")
		return
	var hot: bool = id == "ember_foundry"
	var sand: bool = id == "sandstone_quarry"
	for i in range(15):
		var a: float = float(i)*TAU/15.0
		var radius: float = 22.0+float(i%3)*2.0
		var height: float = 7.0+float((i*7)%5)*1.7
		var v := Vector3(cos(a)*radius,height*0.28-1.0,sin(a)*radius)
		var color: String = ["735e72","826779","936b78"][i%3] if hot else (["b97c58","cf986d","d7ad7e"][i%3] if sand else ["7f99aa","8ca5b1","a1b4b7"][i%3])
		rock(p,v,Vector3(11.5,height,10.0),color)
		if not hot and not sand:
			rock(p,v+Vector3(0,height*0.30,0),Vector3(6.0,height*0.2,5.3),"bac8c0")
			var foreground_position := Vector3(cos(a)*19,0.4,sin(a)*19)
			if id == "forge_yard" and foreground_position.distance_to(Vector3(10.5,0.4,10.8)) < 6.0:
				foreground_position += Vector3(cos(a),0,sin(a))*8.0
			rock(p,foreground_position,Vector3(8,2.4,7),"79916d")
	if not hot:
		for i in range(7):
			var v := Vector3(-34+i*11,13+(i%3)*2.0,-34-(i%2)*5)
			for j in range(3): rock(p,v+Vector3(j*1.4,sin(j*2)*0.5,0),Vector3(3.6,1.7,2.1),"e6eef0")

# One compound mesh root keeps the complete skull together through rigging and death.
static func skeleton_skull(parent:Node3D)->MeshInstance3D:
	var cranium=SphereMesh.new()
	cranium.radius=0.175
	cranium.height=0.33
	cranium.radial_segments=16
	cranium.rings=8
	var head=MeshInstance3D.new()
	head.name="CarvedSkull"
	head.mesh=cranium
	head.position=Vector3(0,1.65,-0.018)
	head.material_override=mat("e5d6b3")
	parent.add_child(head)
	for side in [-1,1]:
		rock(head,Vector3(side*0.082,0.0,0.139),Vector3(0.112,0.112,0.038),"403945")
		var brow=box(head,Vector3(side*0.081,0.061,0.155),Vector3(0.128,0.032,0.05),"eee0bf")
		brow.rotation.z=side*0.12
		rock(head,Vector3(side*0.125,-0.065,0.115),Vector3(0.08,0.078,0.09),"dfcdab")
		box(head,Vector3(side*0.106,-0.119,0.056),Vector3(0.037,0.10,0.065),"d7c6a3")
	var nose=primitive(head,"cone",Vector3(0,-0.048,0.165),Vector3(0.048,0.063,0.02),"403945")
	nose.rotation.z=PI
	box(head,Vector3(0,-0.117,0.118),Vector3(0.18,0.063,0.051),"493e40")
	for i in range(6):
		var x=(i-2.5)*0.029
		box(head,Vector3(x,-0.096,0.155),Vector3(0.024,0.043,0.038),"f2e4c4")
		box(head,Vector3(x,-0.149,0.148),Vector3(0.023,0.026,0.033),"dfcfab")
	rock(head,Vector3(0,-0.18,0.075),Vector3(0.235,0.065,0.145),"d7c6a3")
	return head
