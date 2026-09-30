extends SceneTree
## Offline Main-scene contract for bounded Starfall presentation and reward state.
const Meteor = preload("res://landscape_meteor.gd")
const CrystalArt = preload("res://starfall_crystal_art.gd")
var failures: Array[String] = []
var started := Time.get_ticks_usec()

func _initialize() -> void:
	_run.call_deferred()

func _check(ok: bool, reason: String) -> void:
	if not ok: failures.append(reason)

func _geometry(mesh: ArrayMesh, label: String) -> Dictionary:
	var triangles := 0
	var wrong := 0
	var degenerate := 0
	for surface in mesh.get_surface_count():
		var arrays: Array = mesh.surface_get_arrays(surface)
		var vertices: PackedVector3Array = arrays[Mesh.ARRAY_VERTEX]
		var normals: PackedVector3Array = arrays[Mesh.ARRAY_NORMAL]
		_check(vertices.size() == normals.size() and vertices.size() % 3 == 0,
			label + " has complete vertex/normal triangles")
		for i in range(0, vertices.size()-2, 3):
			var area: Vector3 = (vertices[i+1]-vertices[i]).cross(vertices[i+2]-vertices[i])
			if area.length() < 0.000001:
				degenerate += 1
			else:
				# Godot's ArrayMesh front face is clockwise, so the conventional
				# (b-a)x(c-a) cross product points opposite an outward normal.
				if area.dot(normals[i]) >= 0.0: wrong += 1
			triangles += 1
	_check(triangles > 30 and triangles < 12000 and degenerate == 0,
		label + " has a bounded nondegenerate mesh")
	_check(wrong == 0, label + " exterior winding matches its normals")
	return {"triangles":triangles,"wrong":wrong,"degenerate":degenerate}

func _fault(game: Node3D) -> void:
	var dressing: Node3D = game.landscape.dressing
	var baseline := get_nodes_in_group("landscape_crystal").size()
	var op := {"type":"ridge", "feature":"crystal_fault", "points":[[1.0,18.0],[27.0,18.0]], "seed":1337}
	dressing.add_operation(op, game.landscape.model, 0.0)
	var nodes: Array[Node] = []
	var fault_group: Node3D = dressing._records.back().group
	for crystal in fault_group.get_children():
		if crystal is MeshInstance3D and crystal.is_in_group("landscape_crystal"): nodes.append(crystal)
	_check(nodes.size() == 4 and get_nodes_in_group("landscape_crystal").size() == baseline + 4,
		"Crystal Fault installs four grouped spires")
	var art := CrystalArt.new()
	for node in nodes:
		var mesh: ArrayMesh = node.mesh
		_check(mesh != null and mesh.surface_get_material(0) == art.fault_material(),
			"fault spire uses shared luminous crystal material")
		_check(node.get_child_count() == 0, "fault spire has no per-crystal light")
	dressing.remove_last()
	await physics_frame
	_check(get_nodes_in_group("landscape_crystal").size() == baseline,
		"removed Crystal Fault releases its grouped spires")

func _run() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-check"):
		push_error("Use isolated --world-builder-check mode")
		quit(2)
		return
	var game: Node3D = load("res://main.tscn").instantiate()
	game.set_process(false)
	root.add_child(game)
	for i in 60:
		if not game.adventure.travelling: break
		await physics_frame
	await physics_frame
	var builder = game.world_builder
	var presenter: Node3D = builder.starfall_presentation
	var event_art: Node3D = presenter.events
	_check(presenter.lights.size() == 3 and presenter.audio.size() == 6,
		"presentation allocates exactly three shared crystal lights and six audio voices")
	_check(event_art._slots.size() == 6 and event_art._lights.size() == 2,
		"event effect has six slots and two temporary lights")
	var batches := 0
	for child in event_art.get_children():
		if child is MultiMeshInstance3D:
			batches += 1
			_check(child.multimesh.instance_count <= 6*56, "event batch instance count is bounded")
	_check(batches == 4, "four MultiMeshes carry event particles")
	var art := CrystalArt.new()
	var geometry := {}
	for i in CrystalArt.METEOR_VARIANTS:
		var mesh: ArrayMesh = art._meteor_mesh(i)
		_check(mesh == art._meteor_mesh(i) and mesh.get_surface_count() == 1,
			"meteor crystal uses one cached surface")
		geometry["meteor"+str(i)] = _geometry(mesh, "meteor crystal "+str(i))
	for i in CrystalArt.FAULT_VARIANTS:
		var mesh: ArrayMesh = art._fault_mesh(i)
		_check(mesh == art._fault_mesh(i) and mesh.get_surface_count() == 1,
			"fault crystal uses one cached surface")
		geometry["fault"+str(i)] = _geometry(mesh, "fault crystal "+str(i))
	var sound_order: Array[String] = []
	event_art.sound_requested.connect(func(kind: String, _position: Vector3, _strength: float) -> void:
		sound_order.append(kind))
	var meteors: Array[Node3D] = []
	for i in 8:
		var local := Vector2(float(i)*2.0, 20.0)
		var record: Dictionary = Meteor.make_record(local, 8000+i,
			game.landscape.height_at(local))
		var meteor := Meteor.new()
		builder.root.add_child(meteor)
		meteor.setup(record, false)
		presenter.watch_meteor(meteor)
		meteors.append(meteor)
		_check(meteor.gems.size() == 6 and meteor.remaining_gems() == 12,
			"meteor retains six strikeable veins and twelve gem units")
		for gem in meteor.gems:
			_check(gem.is_in_group("landscape_crystal") and gem.get_child_count() == 0,
				"meteor vein joins shared light group without per-gem light")
			_check(gem.mesh is ArrayMesh and gem.mesh.surface_get_material(0) == art.meteor_material(),
				"meteor vein uses shared luminous crystal material")
		meteor.visual_event.emit({"phase":"descent","seed":int(record.seed),"progress":.7})
		meteor.visual_event.emit({"phase":"impact","seed":int(record.seed)})
		meteor.visual_event.emit({"phase":"crystal_reveal","seed":int(record.seed)})
	_check(event_art.active_slots() == 6 and event_art._watched.size() == 8,
		"eight simultaneous meteors stay within six event slots")
	_check(sound_order.slice(0,3) == ["entry","impact","crystal_chime"],
		"sound hooks retain descent-impact-reveal order")
	_check(presenter.next_audio == sound_order.size(), "sound hooks reach bounded voice pool")
	presenter.next_sources = 0.0
	presenter.tick(.2)
	var live_lights := 0
	for light in presenter.lights:
		if light.light_energy > 0.0: live_lights += 1
	_check(live_lights <= 3, "nearby crystal illumination never exceeds three shared lights")
	for i in 65: event_art.tick(.1)
	_check(event_art.active_slots() == 0 and event_art._light_owner == [-1,-1],
		"all impact slots and temporary lights expire")
	for meteor in meteors: meteor.queue_free()
	await physics_frame
	_check(event_art._watched.is_empty(), "freed meteor watchers do not leak")
	# A real World Builder meteor signals through the impact callback. The crater
	# height and physics surface must already match when advance() returns.
	var site := Vector2(-78,35)
	var before_height: float = game.landscape.height_at(site)
	var impact_record: Dictionary = Meteor.make_record(site, 99001, before_height)
	impact_record["id"] = "presentation-fixture-impact"
	impact_record["phase"] = "falling"
	builder.data.meteors.append(impact_record)
	builder._render_meteor(impact_record, true)
	var impact_meteor: Node3D = builder.meteor_nodes[impact_record.id]
	var before_ops: int = game.landscape.operation_count()
	impact_meteor.advance(Meteor.FALL_SECONDS)
	_check(game.landscape.operation_count() == before_ops+1,
		"real meteor contact records one crater immediately")
	_check(game.landscape.height_at(site) < before_height-1.0,
		"real meteor contact changes height before callback returns")
	var probe_site := site + Vector2(4,0)
	var expected: float = game.landscape.height_at(probe_site)
	var world_at: Vector3 = game.landscape.zone_root.to_global(Vector3(probe_site.x,expected,probe_site.y))
	var ray := PhysicsRayQueryParameters3D.create(world_at+Vector3.UP*2.0,world_at-Vector3.UP*2.0,1)
	var immediate_hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
	await physics_frame
	var next_hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
	_check(immediate_hit.is_empty() or absf(float(immediate_hit.get("position",Vector3.ZERO).y)-world_at.y)<.22,
		"contact never exposes the obsolete collider")
	_check(not next_hit.is_empty() and absf(float(next_hit.get("position",Vector3.ZERO).y)-world_at.y)<.22,
		"real meteor collider matches current terrain by the next physics frame")
	var gem: MeshInstance3D = impact_meteor.gems[0]
	var result: Dictionary = impact_meteor.strike(gem.global_position,"quarry_pick",1.0)
	_check(result.get("ok",false) and result.get("kind","") == "meteor_gem" and
		impact_meteor.remaining_gems() == 11 and impact_meteor.record.scars.size() == 1,
		"mining the authored gem retains reward and saved scar state")
	await _fault(game)
	print("STARFALL_PRESENTATION_RESULT ",JSON.stringify({"failures":failures,"geometry":geometry,
		"seconds":float(Time.get_ticks_usec()-started)/1000000.0}))
	quit(0 if failures.is_empty() else 1)
