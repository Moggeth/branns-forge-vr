extends Node
class_name OrchardPlanetDressing
## Biome landmark + clutter dressing for the spherical Orchard, built only from existing zone_art GLB kits.
##
##   var dressing := OrchardPlanetDressing.new()
##   planet.root.add_child(dressing)
##   dressing.setup(planet)   # needs planet.root (Node3D) and planet.fields
##   dressing.build()
##   # integrator: dressing.tick(delta) each frame; dressing.reset() / cleanup() to remove.
##
## Everything is parented under one local-space "OrchardDressing" Node3D beneath planet.root.
## Landmarks are instantiated scenes (optional simple radial cylinder colliders); clutter is consolidated
## into one MultiMeshInstance3D per (asset, mesh part) with no collision and no shadow casting.
## Placement is deterministic from palette.seed; a change of fields.revision rebuilds (debounced).

const PALETTE_FILE := "orchard_planet_palette.json"
const REBUILD_DEBOUNCE := 0.4

var planet: Object
var root: Node3D
var fields: RefCounted
var phase := ""
var stats := {"landmark_pieces": 0, "clutter_instances": 0, "multimeshes": 0, "colliders": 0, "objects": 0}

var _palette: Dictionary = {}
var _holder: Node3D
var _asset_cache := {}   # path -> {"scene": PackedScene, "parts": Array, "aabb": AABB} or {} when missing
var _built_revision := -1
var _pending_rebuild := -1.0
var _rng := RandomNumberGenerator.new()
var _budget := {}
var _landmark_records: Array[Dictionary] = []
var _clutter_records: Array[Dictionary] = []

func setup(planet_runtime: Object) -> void:
	planet = planet_runtime
	root = planet_runtime.get("root")
	fields = planet_runtime.get("fields")
	set_process(false)  # the integrator drives tick(delta)
	_load_palette()

func set_phase(phase_name: String) -> void:
	## Reserved hook for future phase variants; currently stores the key only.
	phase = phase_name

func build() -> void:
	if root == null or fields == null:
		push_warning("OrchardPlanetDressing.build: setup() has not been given a root and fields")
		return
	if _palette.is_empty():
		_load_palette()
		if _palette.is_empty():
			return
	reset()
	_rng.seed = int(_palette.get("seed", 1))
	var b: Dictionary = _palette.get("budget", {})
	_budget = {
		"objects": int(b.get("max_objects", 220)),
		"landmark": int(b.get("max_landmark_pieces", 64)),
		"clutter": int(b.get("max_clutter_instances", 150)),
		"colliders": int(b.get("max_colliders", 14)),
	}
	_holder = Node3D.new()
	_holder.name = "OrchardDressing"
	root.add_child(_holder)

	var by_biome := _sample_candidates()
	var biomes: Dictionary = _palette.get("biomes", {})
	var clutter_jobs := {}   # path -> {"asset": info, "xforms": Array[Transform3D]}
	var names: Array = biomes.keys()
	names.sort()
	# Landmarks first so their budget is never starved by clutter.
	var used := {}  # biome -> Array[Vector3] landmark centres, kept so clutter avoids their footprints
	for biome in names:
		used[biome] = _place_landmarks(biome, biomes[biome], by_biome.get(biome, []))
	for biome in names:
		_place_clutter(biome, biomes[biome], by_biome.get(biome, []), used, clutter_jobs)
	_flush_clutter(clutter_jobs)
	stats["objects"] = int(stats["landmark_pieces"]) + int(stats["multimeshes"])
	_built_revision = _revision()
	_pending_rebuild = -1.0

func tick(delta: float) -> void:
	if fields == null or _holder == null:
		return
	var rev := _revision()
	if rev != _built_revision and _pending_rebuild < 0.0:
		_pending_rebuild = REBUILD_DEBOUNCE
	if _pending_rebuild >= 0.0:
		_pending_rebuild -= delta
		if _pending_rebuild < 0.0:
			build()

## Keep established dressing in place when one spell changes a small spherical cap.
## This updates only transforms within the cap; direct unknown field edits retain
## the debounced full rebuild fallback above.
func refresh_cap(direction: Vector3, angular_radius: float) -> void:
	if _holder == null or fields == null:
		return
	var centre := direction.normalized()
	var cutoff := cos(angular_radius + 0.025)
	for record in _landmark_records:
		var d: Vector3 = record["direction"]
		if d.dot(centre) < cutoff or not is_instance_valid(record["node"]):
			continue
		var up := d.lerp(_up_at(d), float(record["tilt"])).normalized()
		var xf := Transform3D(_basis_for(up, float(record["yaw"]), float(record["scale"])), fields.surface_point(d) + up * float(record["offset"]))
		record["node"].transform = xf
		if is_instance_valid(record["collider"]):
			record["collider"].transform = xf
	for record in _clutter_records:
		var mm: MultiMesh = record["mesh"]
		var placements: Array = record["placements"]
		var part: Transform3D = record["part"]
		for i in placements.size():
			var p: Dictionary = placements[i]
			var d: Vector3 = p["direction"]
			if d.dot(centre) < cutoff:
				continue
			var up := _up_at(d)
			var xf := Transform3D(_basis_for(up, float(p["yaw"]), float(p["scale"])), fields.surface_point(d) + up * float(p["lift"]))
			mm.set_instance_transform(i, xf * part)
	_built_revision = _revision()
	_pending_rebuild = -1.0

func reset() -> void:
	if is_instance_valid(_holder):
		_holder.queue_free()
	_holder = null
	stats = {"landmark_pieces": 0, "clutter_instances": 0, "multimeshes": 0, "colliders": 0, "objects": 0}
	_built_revision = -1
	_pending_rebuild = -1.0
	_landmark_records.clear()
	_clutter_records.clear()

func cleanup() -> void:
	reset()

# ---------------------------------------------------------------- palette / assets

func _load_palette() -> void:
	var path: String = (get_script() as Script).resource_path.get_base_dir().path_join(PALETTE_FILE)
	if not FileAccess.file_exists(path):
		push_warning("OrchardPlanetDressing: palette missing at %s" % path)
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if parsed is Dictionary:
		_palette = parsed
	else:
		push_warning("OrchardPlanetDressing: palette JSON did not parse")

func _asset(rel: String) -> Dictionary:
	if _asset_cache.has(rel):
		return _asset_cache[rel]
	var info := {}
	var path: String = String(_palette.get("assets_root", "res://assets/zone_art/")) + rel
	if ResourceLoader.exists(path):
		var scene := load(path) as PackedScene
		if scene != null:
			var inst := scene.instantiate()
			var parts: Array = []
			var aabb := AABB()
			var have := false
			if inst is Node3D:
				for p in _collect_parts(inst as Node3D, Transform3D.IDENTITY):
					parts.append(p)
					var mesh: Mesh = p["mesh"]
					var box: AABB = (p["xf"] as Transform3D) * mesh.get_aabb()
					aabb = box if not have else aabb.merge(box)
					have = true
			inst.free()
			if have:
				info = {"scene": scene, "parts": parts, "aabb": aabb}
	if info.is_empty():
		push_warning("OrchardPlanetDressing: asset unavailable %s" % path)
	_asset_cache[rel] = info
	return info

func _collect_parts(node: Node3D, parent_xf: Transform3D) -> Array:
	var out: Array = []
	var xf := parent_xf * node.transform
	if node is MeshInstance3D and (node as MeshInstance3D).mesh != null and node.visible:
		var mi := node as MeshInstance3D
		var override: Material = mi.material_override
		out.append({"mesh": mi.mesh, "xf": xf, "override": override})
	for c in node.get_children():
		if c is Node3D:
			out.append_array(_collect_parts(c as Node3D, xf))
	return out

# ---------------------------------------------------------------- sampling

func _revision() -> int:
	var r: Variant = fields.get("revision")
	return int(r) if r != null else 0

func _info(d: Vector3) -> Dictionary:
	var s: Variant = fields.sample(d)
	var biome := ""
	var weights := {}
	var water := 0.0
	if s is Dictionary:
		biome = str(s.get("biome", ""))
		weights = s.get("weights", {})
		water = float(s.get("water", 0.0))
	elif s is String or s is StringName:
		biome = str(s)
	elif s is Object:
		biome = str(s.get("biome"))
		var w: Variant = s.get("weights")
		weights = w if w is Dictionary else {}
		var wt: Variant = s.get("water")
		water = float(wt) if wt != null else 0.0
	return {"biome": biome, "weights": weights, "water": water}

func _up_at(d: Vector3) -> Vector3:
	var n: Vector3 = fields.normal_at(d)
	return n.normalized() if n.length_squared() > 0.0001 else d

func _random_dir() -> Vector3:
	var z := _rng.randf_range(-1.0, 1.0)
	var t := _rng.randf_range(0.0, TAU)
	var r := sqrt(maxf(0.0, 1.0 - z * z))
	return Vector3(r * cos(t), z, r * sin(t))

func _sample_candidates() -> Dictionary:
	var sp: Dictionary = _palette.get("sampling", {})
	var count := int(sp.get("candidates", 1000))
	var out := {}
	for i in count:
		var d := _random_dir()
		var info := _info(d)
		var biome: String = info["biome"]
		if biome == "":
			continue
		var wl := float(sp.get("wetland_water_reject", 0.65)) if biome == "wetland" else float(sp.get("water_reject", 0.3))
		if float(info["water"]) >= wl:
			continue
		if not out.has(biome):
			out[biome] = []
		out[biome].append({"d": d, "up_dot": _up_at(d).dot(d), "weight": float((info["weights"] as Dictionary).get(biome, 1.0))})
	return out

func _pick_spread(cands: Array, want: int, min_angle: float, min_dot: float, avoid: Array) -> Array:
	var chosen: Array = []
	var cos_sep := cos(min_angle)
	var order := cands.duplicate()
	# deterministic shuffle so clusters differ per biome but never per run
	for i in range(order.size() - 1, 0, -1):
		var j := _rng.randi_range(0, i)
		var tmp = order[i]
		order[i] = order[j]
		order[j] = tmp
	# prefer strongly-weighted biome sites; the weight floor keeps drift sites inside the biome core
	var strong: Array = order.filter(func(c): return float(c["weight"]) >= 0.55)
	if strong.size() >= want * 2:
		order = strong
	for c in order:
		if chosen.size() >= want:
			break
		if float(c["up_dot"]) < min_dot:
			continue
		var d: Vector3 = c["d"]
		var ok := true
		for o in chosen:
			if d.dot(o) > cos_sep:
				ok = false
				break
		if ok:
			for o in avoid:
				if d.dot(o) > cos_sep:
					ok = false
					break
		if ok:
			chosen.append(d)
	return chosen

# ---------------------------------------------------------------- placement maths

func _tangent_frame(up: Vector3) -> Array:
	var ref := Vector3.UP if absf(up.dot(Vector3.UP)) < 0.95 else Vector3.RIGHT
	var east := ref.cross(up).normalized()
	var north := up.cross(east).normalized()
	return [east, north]

func _move_dir(d: Vector3, east: Vector3, north: Vector3, metres: Vector2) -> Vector3:
	var r := float(fields.radius)
	return (d + (east * metres.x + north * metres.y) / r).normalized()

func _basis_for(up: Vector3, yaw: float, uniform_scale: float) -> Basis:
	var east: Vector3 = _tangent_frame(up)[0]
	var fwd := up.cross(east).normalized()
	var b := Basis(east, up, -fwd)  # right, up, back
	b = b.orthonormalized()
	b = b * Basis(Vector3.UP, yaw)
	return b.scaled(Vector3.ONE * uniform_scale)

func _size_guard(info: Dictionary, s: float, role: String) -> float:
	var g: Dictionary = _palette.get("size_guard_m", {})
	var ext := (info["aabb"] as AABB).size
	var biggest := maxf(ext.x, maxf(ext.y, ext.z))
	if biggest <= 0.0001:
		return s
	var maxm := float(g.get("landmark_max" if role == "landmark" else "clutter_max", 10.0))
	var minm := float(g.get("min", 0.12))
	return clampf(s, minm / biggest, maxm / biggest)

func _range_scale(entry: Dictionary, default_lo := 0.9, default_hi := 1.1) -> float:
	var sr: Array = entry.get("scale", [default_lo, default_hi])
	return _rng.randf_range(float(sr[0]), float(sr[1]))

# ---------------------------------------------------------------- landmarks

func _place_landmarks(biome: String, def: Dictionary, cands: Array) -> Array:
	var sp: Dictionary = _palette.get("sampling", {})
	var recipes: Array = def.get("landmarks", [])
	var wanted := 0
	for r in recipes:
		wanted += int(r.get("count", 1))
	var centres := _pick_spread(cands, wanted, float(sp.get("landmark_min_angle", 0.3)), float(sp.get("landmark_min_up_dot", 0.94)), [])
	var placed: Array = []
	var ci := 0
	for r in recipes:
		for k in int(r.get("count", 1)):
			if ci >= centres.size():
				return placed
			var d: Vector3 = centres[ci]
			ci += 1
			if _build_landmark(r, d, float(sp.get("landmark_tilt_follow", 0.4))):
				placed.append(d)
	return placed

func _build_landmark(recipe: Dictionary, centre: Vector3, tilt_follow: float) -> bool:
	var pieces: Array = recipe.get("pieces", [])
	if int(stats["landmark_pieces"]) + pieces.size() > int(_budget["landmark"]):
		return false
	var cup := _up_at(centre)
	var frame := _tangent_frame(centre)
	var site_yaw := _rng.randf_range(0.0, TAU)
	var group := Node3D.new()
	group.name = String(recipe.get("name", "landmark"))
	_holder.add_child(group)
	var any := false
	for p in pieces:
		var info := _asset(String(p["asset"]))
		if info.is_empty():
			continue
		var at: Array = p.get("at", [0, 0])
		var rot := Vector2(float(at[0]), float(at[1])).rotated(site_yaw)
		var d := _move_dir(centre, frame[0], frame[1], rot)
		var radial := d
		var up := radial.lerp(_up_at(d), tilt_follow).normalized()
		var s := _size_guard(info, _range_scale(p), "landmark")
		var yaw := site_yaw + deg_to_rad(float(p.get("yaw", 0.0))) + _rng.randf_range(-0.15, 0.15)
		var bas := _basis_for(up, yaw, s)
		var sink := float(p.get("sink", 0.0)) * (info["aabb"] as AABB).size.y * s
		var pos: Vector3 = fields.surface_point(d) + up * (float(p.get("lift", 0.0)) - sink)
		var node := (info["scene"] as PackedScene).instantiate() as Node3D
		if node == null:
			continue
		node.transform = Transform3D(bas, pos)
		_disable_extras(node)
		group.add_child(node)
		stats["landmark_pieces"] = int(stats["landmark_pieces"]) + 1
		any = true
		var collider: StaticBody3D = null
		if bool(p.get("collide", false)) and int(stats["colliders"]) < int(_budget["colliders"]):
			collider = _add_collider(group, info, Transform3D(bas, pos), s)
		_landmark_records.append({"node": node, "collider": collider, "direction": d, "yaw": yaw, "scale": s, "offset": float(p.get("lift", 0.0)) - sink, "tilt": tilt_follow})
	if not any:
		group.queue_free()
	return any

func _disable_extras(n: Node) -> void:
	# kits may carry cameras/lights/animation from the DCC export; the planet owns lighting.
	for c in n.get_children():
		if c is Camera3D or c is Light3D:
			c.queue_free()
		else:
			_disable_extras(c)

func _add_collider(group: Node3D, info: Dictionary, xf: Transform3D, s: float) -> StaticBody3D:
	var box := info["aabb"] as AABB
	var body := StaticBody3D.new()
	body.name = "LandmarkBody"
	body.transform = xf
	body.collision_layer = 1
	body.collision_mask = 0
	var shape := CylinderShape3D.new()
	var footprint := minf(box.size.x, box.size.z) * 0.5 * 0.8
	var rad := maxf(0.2, footprint)  # authored metres; the body basis carries the uniform placement scale
	shape.radius = rad
	shape.height = maxf(0.3, box.size.y * 0.95)
	var cs := CollisionShape3D.new()
	cs.shape = shape
	cs.position = box.get_center()
	body.add_child(cs)
	group.add_child(body)
	stats["colliders"] = int(stats["colliders"]) + 1
	return body

# ---------------------------------------------------------------- clutter

func _place_clutter(biome: String, def: Dictionary, cands: Array, landmark_sites: Dictionary, jobs: Dictionary) -> void:
	var table: Array = []
	var total_w := 0.0
	for e in def.get("clutter", []):
		var w := float(e.get("w", 1.0))
		if w > 0.0 and not _asset(String(e["asset"])).is_empty():
			table.append(e)
			total_w += w
	if table.is_empty() or cands.is_empty():
		return
	var sp: Dictionary = _palette.get("sampling", {})
	var target := int(def.get("clutter_per_biome", 16))
	var radius_m := float(def.get("cluster_radius_m", 6.0))
	# Clutter drifts: around the landmark sites of this biome (set dressing) and a few free clusters.
	var cluster_centres: Array = (landmark_sites[biome] as Array).duplicate()
	var free := _pick_spread(cands, maxi(2, target / 7), float(sp.get("clutter_min_angle", 0.13)), float(sp.get("clutter_min_up_dot", 0.85)), [])
	cluster_centres.append_array(free)
	if cluster_centres.is_empty():
		return
	var per_cluster := int(ceil(float(target) / float(cluster_centres.size())))
	var min_dot := float(sp.get("clutter_min_up_dot", 0.85))
	var water_rej := float(sp.get("wetland_water_reject", 0.65)) if biome == "wetland" else float(sp.get("water_reject", 0.3))
	var placed := 0
	for centre in cluster_centres:
		var frame := _tangent_frame(centre)
		var tries := per_cluster * 4
		var got := 0
		while got < per_cluster and tries > 0 and placed < target:
			tries -= 1
			if int(stats["clutter_instances"]) >= int(_budget["clutter"]):
				return
			# gaussian-ish radial falloff so clusters read as drifts rather than discs
			var a := _rng.randf_range(0.0, TAU)
			var rr := radius_m * sqrt(_rng.randf()) * _rng.randf_range(0.4, 1.0)
			var d := _move_dir(centre, frame[0], frame[1], Vector2(cos(a), sin(a)) * rr)
			var info := _info(d)
			if float(info["water"]) >= water_rej:
				continue
			if float((info["weights"] as Dictionary).get(biome, 1.0)) < 0.35:
				continue
			var up := _up_at(d)
			if up.dot(d) < min_dot:
				continue
			var entry := _weighted_pick(table, total_w)
			var ainfo := _asset(String(entry["asset"]))
			var s := _size_guard(ainfo, _range_scale(entry), "clutter")
			var yaw := _rng.randf_range(0.0, TAU)
			var bas := _basis_for(up, yaw, s)
			var pos: Vector3 = fields.surface_point(d) + up * float(entry.get("lift", 0.0))
			var key := String(entry["asset"])
			if not jobs.has(key):
				jobs[key] = {"asset": ainfo, "xforms": [], "placements": []}
			(jobs[key]["xforms"] as Array).append(Transform3D(bas, pos))
			(jobs[key]["placements"] as Array).append({"direction": d, "yaw": yaw, "scale": s, "lift": float(entry.get("lift", 0.0))})
			stats["clutter_instances"] = int(stats["clutter_instances"]) + 1
			got += 1
			placed += 1

func _weighted_pick(table: Array, total_w: float) -> Dictionary:
	var t := _rng.randf() * total_w
	for e in table:
		t -= float(e.get("w", 1.0))
		if t <= 0.0:
			return e
	return table[table.size() - 1]

func _flush_clutter(jobs: Dictionary) -> void:
	var keys: Array = jobs.keys()
	keys.sort()
	for key in keys:
		var job: Dictionary = jobs[key]
		var xforms: Array = job["xforms"]
		var parts: Array = (job["asset"] as Dictionary)["parts"]
		for part in parts:
			if int(stats["multimeshes"]) + int(stats["landmark_pieces"]) >= int(_budget["objects"]):
				return
			var mm := MultiMesh.new()
			mm.transform_format = MultiMesh.TRANSFORM_3D
			mm.mesh = part["mesh"]
			mm.instance_count = xforms.size()
			for i in xforms.size():
				mm.set_instance_transform(i, (xforms[i] as Transform3D) * (part["xf"] as Transform3D))
			var inst := MultiMeshInstance3D.new()
			inst.name = "Clutter_%s" % String(key).get_file().get_basename()
			inst.multimesh = mm
			inst.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
			if part["override"] != null:
				inst.material_override = part["override"]
			_holder.add_child(inst)
			_clutter_records.append({"mesh": mm, "placements": job["placements"], "part": part["xf"]})
			stats["multimeshes"] = int(stats["multimeshes"]) + 1
