extends Node3D
## Read-only presenter for LandscapeRuntime.visual_event payloads (schema 1).
## Connect:  runtime.visual_event.connect(vfx.accept_event)
## Never touches height, collision, hydrology, saves or networking. Remove or
## set enabled=false and gameplay is unchanged.
##
## Every visual is a pure function of (visual_seed, samples, path, progress,
## clock), so forward, reverse (undo) and restore produce identical geometry.
## Moving pieces live in per-event MultiMeshes; settled geology is moved into
## one shared MultiMesh per kit mesh (constant node count for any history).

const KIT_PATH := "assets/spell_kit.glb"
const KIT_MESHES := ["lip_a", "lip_b", "lip_c", "crust_a", "wall_a", "wall_b", "chunk_a", "chunk_b", "chunk_c",
	"scarp_a", "scarp_b", "clod_a", "clod_b", "pebble", "root_seg", "sapling", "sprout", "leaf_puff", "swell"]
const LIPS := ["lip_a", "lip_b", "lip_c"]
## Real world_builder trees: W.tree(size = 4.4 * scale); crown centre sits ~0.72 of that height.
const REAL_TREE_CROWN_Y := 3.3
const REAL_TREE_CROWN_R := 1.5
const QUALITY := {"vr": 1.0, "rts": 0.8, "low": 0.45}
const CURVE_SMOOTH := 0
const CURVE_BACK := 1
const CURVE_FALL := 2

@export var enabled := true:
	set(value):
		enabled = value
		visible = value
		if not value: _clear_transient()
@export_enum("vr", "rts", "low") var quality_tier := "vr"
## Dust scale multiplier; raise for the tactical camera so puffs read from 30 m.
@export var dust_scale := 1.0
@export var tail_seconds := 1.8
@export var max_permanent_pieces := 3000
## When false Grow Forest saplings vanish after the event (the game's own trees take over).
@export var grow_saplings_persist := true

var _meshes: Dictionary = {}
var _surface: ShaderMaterial
var _dust_mat: ShaderMaterial
var _mote_mat: ShaderMaterial
var _quad: QuadMesh
var _active: Dictionary = {}          # operation_id -> fx
var _permanent: Dictionary = {}       # operation_id -> Array[[mesh, Transform3D, Color]]
var _perm_nodes: Dictionary = {}      # mesh -> MultiMeshInstance3D
var _perm_dirty := false
var _lights_in_use := 0
var _ready_ok := false

func _ready() -> void:
	_load_kit()

func _load_kit() -> void:
	if _ready_ok: return
	var base: String = (get_script() as Script).resource_path.get_base_dir()
	var scene := load(base.path_join(KIT_PATH)) as PackedScene
	if scene == null:
		push_warning("orchard_spell_vfx: kit missing; presenter disabled")
		return
	var root := scene.instantiate()
	for mesh_name in KIT_MESHES:
		var node := root.find_child(mesh_name, true, false) as MeshInstance3D
		if node != null: _meshes[mesh_name] = node.mesh
	root.free()
	_surface = ShaderMaterial.new()
	_surface.shader = load(base.path_join("shaders/kit_surface.gdshader"))
	_dust_mat = ShaderMaterial.new()
	_dust_mat.shader = load(base.path_join("shaders/dust_puff.gdshader"))
	_mote_mat = ShaderMaterial.new()
	_mote_mat.shader = load(base.path_join("shaders/magic_mote.gdshader"))
	_quad = QuadMesh.new()
	_quad.size = Vector2.ONE
	_ready_ok = _meshes.size() == KIT_MESHES.size()

# ---------------------------------------------------------------- public API

func accept_event(payload: Dictionary) -> void:
	if not enabled or payload.is_empty(): return
	_load_kit()
	if not _ready_ok: return
	var id := str(payload.get("operation_id", ""))
	if id.is_empty(): return
	var phase := str(payload.get("phase", ""))
	match phase:
		"started":
			_free_fx(id)
			var fx := _build_fx(payload)
			if fx.is_empty(): return
			if fx.reverse and _permanent.has(id):
				_permanent.erase(id)
				_perm_dirty = true
			_active[id] = fx
			_spawn_nodes(fx)
			_evaluate(fx)
		"animating":
			if not _active.has(id): return
			var fx: Dictionary = _active[id]
			fx.progress = float(payload.get("progress", 0.0))
			fx.clock = fx.progress * fx.duration
			_evaluate(fx)
		"settled", "cancelled":
			if not _active.has(id): return
			_settle(_active[id])
		"restore":
			restore_event(payload)
	if _perm_dirty: _rebuild_permanent()

## Rebuild settled geology for a stored operation without animation (save load,
## late join, presenter re-enable). Accepts a "started"-shaped payload.
func restore_event(payload: Dictionary) -> void:
	_load_kit()
	if not _ready_ok: return
	var fx := _build_fx(payload)
	if fx.is_empty() or fx.reverse: return
	fx.progress = 1.0
	_persist(fx)
	if _perm_dirty: _rebuild_permanent()

func forget_operation(operation_id: String) -> void:
	_free_fx(operation_id)
	if _permanent.erase(operation_id): _rebuild_permanent()

func clear_all() -> void:
	_clear_transient()
	_permanent.clear()
	_rebuild_permanent()

func active_count() -> int:
	return _active.size()

func permanent_piece_count() -> int:
	var n := 0
	for id in _permanent: n += (_permanent[id] as Array).size()
	return n

## Deterministic stepping for captures/tests; _process calls this in game.
func step(delta: float) -> void:
	for id in _active.keys():
		var fx: Dictionary = _active[id]
		if not fx.settled: continue
		fx.clock += delta
		fx.tail += delta
		_evaluate(fx)
		if fx.tail >= tail_seconds or fx.clock >= fx.max_seconds: _free_fx(id)

func _process(delta: float) -> void:
	if not _active.is_empty(): step(delta)

# ---------------------------------------------------------------- build

func _build_fx(p: Dictionary) -> Dictionary:
	var kind := str(p.get("operation_type", ""))
	var budget: Dictionary = p.get("quality_budget", {})
	var q: float = QUALITY.get(quality_tier, 1.0)
	var fx := {"id": str(p.operation_id), "kind": kind, "reverse": str(p.get("direction", "forward")) == "reverse",
		"progress": float(p.get("progress", 0.0)), "clock": 0.0, "tail": 0.0, "settled": false,
		"duration": maxf(float(p.get("duration_seconds", 1.2)), 0.2),
		"max_seconds": float(budget.get("max_effect_seconds", 4.0)),
		"max_debris": int(float(budget.get("max_live_debris", 36)) * q),
		"max_dust": int(float(budget.get("max_dust_particles", 160)) * q),
		"allow_light": int(budget.get("max_temporary_lights", 2)) > 0,
		"pieces": [], "dust": [], "motes": [], "nodes": {}, "light": null, "light_path": [], "light_color": Color.WHITE}
	var rng := RandomNumberGenerator.new()
	rng.seed = hash([int(p.get("visual_seed", 0)), fx.id])
	var ground := _Ground.new(p.get("terrain_samples", []))
	var path: Array = p.get("world_path", [])
	if path.is_empty(): return {}
	match kind:
		"sunder", "path", "ridge": _build_sunder(fx, rng, ground, path, q)
		"raise", "crater", "lower": _build_raise(fx, rng, ground, path, q, kind != "raise")
		"grow_forest", "forest", "grow": _build_grow(fx, rng, ground, path, p, q)
		_: _build_raise(fx, rng, ground, path, q * 0.5, false)
	return fx

func _build_sunder(fx: Dictionary, rng: RandomNumberGenerator, g: _Ground, path: Array, q: float) -> void:
	var pl := _Polyline.new(path)
	var w := g.half_width(pl, true)
	var length: float = maxf(pl.length, 0.5)
	# Tear front reaches the end at 66% progress; the terrain keeps sinking after.
	var front := func(s: float) -> float: return 0.04 + 0.62 * s / length
	# 1. Stratified walls: panels stand on the new floor at the foot of each bank, top at the
	#    original surface, so the heightfield's cut reads as layered earth. They extend downward
	#    with the sinking terrain (scale Y follows real local cut depth).
	# rev-4 (real capture 03: evenly repeated stripe panels): walls come in RUNS of 1-4 overlapping
	# panels per side, each run with its own scale family, separated by 2-7 m slumped gaps where the
	# shader's chipped strata show alone. Panels vary 0.55-1.45 in width, some slump 0.2-0.6 m below
	# the lip, and yaw/lean vary so no two neighbours share a face plane.
	for side in [-1.0, 1.0]:
		var s_wall := rng.randf_range(0.0, 2.5)
		while s_wall < length - 0.3:
			var run: int = 1 + int(pow(rng.randf(), 1.4) * 3.99)
			var fam := rng.randf_range(0.55, 1.35)
			for k in run:
				if s_wall >= length - 0.3: break
				var at: Dictionary = pl.at(s_wall)
				var out: Vector3 = at.right * side
				var foot := _wall_foot(g, at.pos, out, w)
				var sxz := fam * rng.randf_range(0.8, 1.12)
				s_wall += sxz * rng.randf_range(0.9, 1.5)
				if foot.is_empty(): continue
				var depth: float = foot.depth
				var bpos: Vector3 = foot.pos
				var basis := _frame(out.rotated(Vector3.UP, rng.randf_range(-0.45, 0.45)))
				var lean := Basis(Vector3.BACK, deg_to_rad(rng.randf_range(4.0, 26.0)))   # top leans back into the bank
				var mesh: String = "wall_a" if rng.randf() < 0.55 else "wall_b"
				var slump := rng.randf_range(0.2, 0.6) if rng.randf() < 0.35 else 0.0
				var sy: float = clampf((depth - slump) / 1.8, 0.2, 1.6) * rng.randf_range(0.85, 1.1)
				var t0: float = front.call(s_wall)
				var top_before: float = bpos.y + depth - slump
				_piece(fx, mesh, Transform3D((basis * lean).scaled_local(Vector3(sxz, 0.04, sxz)), Vector3(bpos.x, top_before, bpos.z)),
					Transform3D((basis * lean).scaled_local(Vector3(sxz, sy, sxz * rng.randf_range(0.8, 1.2))), Vector3(bpos.x, top_before + 0.04, bpos.z)),
					t0 + 0.02, minf(t0 + 0.34, 1.0), CURVE_SMOOTH, 0.0, Vector3.ZERO, _earth_tint(rng, rng.randf_range(0.82, 1.05)) * Color(1, 1, 1, 0.9), true)
				# local rock fall below a slumped panel: 2-4 stones heaped at its foot
				if slump > 0.0:
					for j in 2 + rng.randi() % 3:
						var sp: Vector3 = bpos - out * rng.randf_range(0.2, 0.9) + at.tangent * rng.randf_range(-0.6, 0.6)
						sp.y = g.target(sp) + 0.05
						var cm: String = ["chunk_a", "chunk_b", "chunk_c", "clod_b"][rng.randi() % 4]
						var sb := Basis.from_euler(Vector3(rng.randf_range(-0.4, 0.4), rng.randf() * TAU, rng.randf_range(-0.4, 0.4))).scaled(Vector3.ONE * rng.randf_range(0.6, 1.2))
						_piece(fx, cm, Transform3D(sb, Vector3(bpos.x, top_before, bpos.z)), Transform3D(sb, sp), t0 + 0.12, minf(t0 + 0.32, 1.0),
							CURVE_FALL, 0.15, Vector3(rng.randf_range(-6, 6), 0, rng.randf_range(-6, 6)), _rock_tint(rng, cm), true)
			s_wall += rng.randf_range(2.0, 7.0)                 # slumped gap
	# 2. Fracture lips: torn sod plates in CLUMPS of 1-3 (one dominant plate, smaller shards around
	#    it), then 2.5-8 m of bare torn edge. Scale family per clump, stronger yaw, and some plates
	#    darker/earth-side up so the green tops never form a repeating rib.
	for side in [-1.0, 1.0]:
		var s := rng.randf_range(0.0, 3.0)
		while s < length:
			var clump: int = 1 + int(pow(rng.randf(), 1.6) * 2.99)
			var fam := rng.randf_range(0.55, 1.3)
			for k in clump:
				var at: Dictionary = pl.at(minf(s + k * rng.randf_range(0.5, 1.1), length))
				var out: Vector3 = at.right * side
				var hinge: Vector3 = at.pos + out * w * rng.randf_range(0.8, 1.05) + at.tangent * rng.randf_range(-0.4, 0.4)
				var basis := _frame(out.rotated(Vector3.UP, rng.randf_range(-0.9, 0.9)))
				var big := k == 0 and rng.randf() < 0.55
				var mesh: String = LIPS[rng.randi() % 3] if big else "crust_a"
				var tilt := -deg_to_rad(rng.randf_range(10.0, 34.0) if big else rng.randf_range(3.0, 16.0)) + _slope_pitch(g, hinge, basis.x)
				var size := fam * (1.0 if k == 0 else rng.randf_range(0.45, 0.75))
				var sc := Vector3(rng.randf_range(0.75, 1.2), rng.randf_range(0.8, 1.2), rng.randf_range(0.6, 1.3)) * size
				var t0: float = front.call(s)
				var hb: float = g.before(hinge)
				var ht: float = maxf(g.target(hinge), hb - 0.15)
				var tint := _earth_tint(rng, rng.randf_range(0.7, 1.0))
				_piece(fx, mesh, Transform3D(basis.scaled_local(sc * Vector3(1, 0.3, 1)), Vector3(hinge.x, hb - 0.1, hinge.z)),
					Transform3D((basis * Basis(Vector3.BACK, tilt) * Basis(Vector3.RIGHT, rng.randf_range(-0.3, 0.3))).scaled_local(sc),
					Vector3(hinge.x, ht + rng.randf_range(-0.05, 0.12), hinge.z)),
					t0, t0 + rng.randf_range(0.18, 0.3), CURVE_BACK, 0.0, Vector3.ZERO, tint, true)
			s += rng.randf_range(2.5, 8.0) * (1.0 / maxf(q, 0.5))   # clumps + long bare gaps, never a rail
	# 3. Loosened rock and clods: spall off the wall at the moving front, drop to the floor.
	for i in fx.max_debris:
		var s: float = rng.randf() * length
		var at: Dictionary = pl.at(s)
		var side: float = -1.0 if rng.randf() < 0.5 else 1.0
		var roll := rng.randf()
		var mesh := "clod_a" if roll < 0.3 else ("clod_b" if roll < 0.52 else ("chunk_a" if roll < 0.68 else ("chunk_b" if roll < 0.8 else ("chunk_c" if roll < 0.86 else "pebble"))))
		var sc := rng.randf_range(0.6, 1.25) * (1.0 if mesh != "pebble" else 1.8)
		var start: Vector3 = at.pos + at.right * side * w * rng.randf_range(0.55, 0.9) + at.tangent * rng.randf_range(-0.3, 0.3)
		var land: Vector3 = at.pos + at.right * side * w * rng.randf_range(-0.1, 0.45) + at.tangent * rng.randf_range(-0.2, 0.6)
		start.y = lerpf(g.before(start), g.target(start), 0.3)
		land.y = g.target(land) + 0.04 * sc
		var t0: float = front.call(s) + rng.randf_range(0.0, 0.12)
		var b0 := Basis.from_euler(Vector3(rng.randf() * TAU, rng.randf() * TAU, rng.randf() * TAU)).scaled(Vector3.ONE * sc)
		var b1 := Basis.from_euler(Vector3(rng.randf_range(-0.3, 0.3), rng.randf() * TAU, rng.randf_range(-0.3, 0.3))).scaled(Vector3.ONE * sc)
		_piece(fx, mesh, Transform3D(b0, start), Transform3D(b1, land), t0, minf(t0 + rng.randf_range(0.14, 0.24), 1.0),
			CURVE_FALL, rng.randf_range(0.08, 0.35), Vector3(rng.randf_range(-8, 8), rng.randf_range(-3, 3), rng.randf_range(-8, 8)),
			_rock_tint(rng, mesh), true)
	# 4. Dust only where the tear is moving right now: born AT the front, low, short-lived and
	#    thin enough that walls/lips stay readable; nothing is born after the front finishes.
	for i in int(fx.max_dust * 0.55):
		var s: float = rng.randf() * length
		var at: Dictionary = pl.at(s)
		var side: float = -1.0 if rng.randf() < 0.5 else 1.0
		var pos: Vector3 = at.pos + at.right * side * w * rng.randf_range(0.45, 1.0)
		pos.y = g.before(pos) - 0.05
		var vel: Vector3 = Vector3.UP * rng.randf_range(0.5, 1.3) + at.right * side * rng.randf_range(0.2, 0.7) + at.tangent * rng.randf_range(0.3, 1.1)
		var ea := rng.randf_range(0.85, 1.1)
		# rev-4: shorter life + smaller end size so dust is a travelling knot at the front, not a strip
		_dust(fx, pos, vel, _birth(fx, front.call(s) + rng.randf_range(0.0, 0.03)), rng.randf_range(0.45, 0.8),
			rng.randf_range(0.15, 0.3) * w, rng.randf_range(0.35, 0.65) * w, Color(0.52 * ea, 0.42 * ea, 0.31 * ea, rng.randf_range(0.28, 0.5)))
	# 5. Embers race along the fissure just ahead of the dust.
	for i in int(24 * q):
		var s: float = rng.randf() * length
		var at: Dictionary = pl.at(s)
		var pos: Vector3 = at.pos + at.right * rng.randf_range(-0.4, 0.4) * w
		pos.y = g.target(pos) + 0.1
		_mote(fx, pos, Vector3.UP * rng.randf_range(0.8, 2.2) + at.tangent * 0.4, _birth(fx, front.call(s)), rng.randf_range(0.4, 0.9),
			rng.randf_range(0.12, 0.24), Color(1.0, 0.55, 0.18, 1.8))
	fx.light_color = Color(1.0, 0.62, 0.3)
	for k in 9:
		var at: Dictionary = pl.at(length * k / 8.0)
		fx.light_path.append(at.pos + Vector3.UP * 0.6)

func _build_raise(fx: Dictionary, rng: RandomNumberGenerator, g: _Ground, path: Array, q: float, sinking: bool) -> void:
	var c: Vector3 = path[0]
	var r := g.radius(c)
	var dir_bias := Vector3.ZERO
	if path.size() > 1: dir_bias = ((path[path.size() - 1] as Vector3) - c).normalized()
	# The stress seam sits on the shoulder where the heave is steepest (~half height),
	# measured from the real samples, not a fixed fraction of the radius.
	var seam_r := g.seam_radius(c, r)
	# 1. Stress seam: two or three broken arcs (never a full ring). Turf crusts peel up,
	#    fresh stone shards shoulder out, small rough scarp faces look downhill.
	var arcs: int = 2 + int(rng.randf() < 0.6)
	var arc0 := rng.randf() * TAU
	for k in arcs:
		var a_start := arc0 + k * TAU / arcs + rng.randf_range(-0.3, 0.3)
		var span := rng.randf_range(0.5, 0.95) * TAU / arcs
		var a := a_start
		while a < a_start + span:
			var dir := Vector3(cos(a), 0, sin(a))
			var hinge := c + dir * seam_r * rng.randf_range(0.92, 1.08)
			var ht := g.target(hinge)
			var hb := g.before(hinge)
			var t0 := clampf(0.12 + rng.randf_range(0.0, 0.3), 0.0, 0.8)
			var roll := rng.randf()
			var face := -dir if not sinking else dir
			if roll < 0.45:        # peeled turf crust, hinge on the uphill side
				var basis := _frame(face.rotated(Vector3.UP, rng.randf_range(-0.5, 0.5)))
				var tilt := -deg_to_rad(rng.randf_range(12.0, 30.0)) + _slope_pitch(g, hinge, basis.x)
				var sc := Vector3.ONE * rng.randf_range(0.6, 1.05)
				_piece(fx, "crust_a" if rng.randf() < 0.65 else "lip_b", Transform3D(basis.scaled_local(sc * Vector3(1, 0.3, 1)), Vector3(hinge.x, hb - 0.1, hinge.z)),
					Transform3D((basis * Basis(Vector3.BACK, tilt)).scaled_local(sc), Vector3(hinge.x, ht + 0.03, hinge.z)),
					t0, t0 + 0.3, CURVE_BACK, 0.0, Vector3.ZERO, _earth_tint(rng, 1.0), true)
			elif roll < 0.9:       # fresh stone shard pushing out of the seam, leaning downhill
				var sc := rng.randf_range(0.55, 1.1)
				var b := Basis(Vector3.UP, a + rng.randf_range(-0.6, 0.6)) * Basis(Vector3.BACK, rng.randf_range(0.15, 0.55) * (1.0 if not sinking else -1.0))
				b = b.scaled(Vector3.ONE * sc)
				_piece(fx, "scarp_a" if rng.randf() < 0.55 else "scarp_b", Transform3D(b, Vector3(hinge.x, hb - 0.9 * sc, hinge.z)),
					Transform3D(b, Vector3(hinge.x, ht - 0.35 * sc, hinge.z)), t0, minf(t0 + 0.45, 1.0), CURVE_BACK, 0.0, Vector3.ZERO,
					_rock_tint(rng, "chunk_a"), true)
			else:                  # rev-3: rare, low stratified step (wall_b read as a dark box when larger)
				var basis := _frame(-face.rotated(Vector3.UP, rng.randf_range(-0.3, 0.3)))
				var sy := clampf(absf(ht - hb) * 0.2 / 1.8, 0.08, 0.22)
				var sxz := rng.randf_range(0.35, 0.55)
				_piece(fx, "wall_b", Transform3D(basis.scaled_local(Vector3(sxz, 0.02, sxz)), Vector3(hinge.x, ht, hinge.z)),
					Transform3D((basis * Basis(Vector3.BACK, deg_to_rad(25.0))).scaled_local(Vector3(sxz, sy, sxz)), Vector3(hinge.x, ht + 0.05, hinge.z)),
					t0 + 0.05, minf(t0 + 0.4, 1.0), CURVE_SMOOTH, 0.0, Vector3.ZERO, _earth_tint(rng, 1.0), true)
			a += rng.randf_range(1.8, 3.6) / maxf(seam_r, 1.0) / maxf(q, 0.5)   # sparse: the shader draws the seam itself
	# 2. Seam spall: clods and small stones break out of the seam and roll a short way downhill.
	for i in int(fx.max_debris * 0.45):
		var a := rng.randf() * TAU
		var dir := Vector3(cos(a), 0, sin(a))
		var bias := 1.0 + maxf(dir.dot(dir_bias), 0.0) * 0.25
		var start := c + dir * seam_r * rng.randf_range(0.9, 1.1)
		var land := c + dir * lerpf(seam_r, r, rng.randf_range(0.3, 1.0)) * bias
		start.y = lerpf(g.before(start), g.target(start), 0.5) - 0.1
		var roll := rng.randf()
		var mesh := "clod_a" if roll < 0.35 else ("clod_b" if roll < 0.6 else ("chunk_b" if roll < 0.78 else ("chunk_a" if roll < 0.88 else "pebble")))
		var sc := rng.randf_range(0.55, 1.05) * (1.0 if mesh != "pebble" else 1.8)
		land.y = g.target(land) + 0.04 * sc
		var t0 := rng.randf_range(0.15, 0.6)
		_piece(fx, mesh, Transform3D(Basis.from_euler(Vector3(rng.randf() * TAU, rng.randf() * TAU, 0)).scaled(Vector3.ONE * sc), start),
			Transform3D(Basis.from_euler(Vector3(0, rng.randf() * TAU, 0)).scaled(Vector3.ONE * sc), land),
			t0, minf(t0 + rng.randf_range(0.25, 0.4), 1.0), CURVE_FALL, rng.randf_range(0.1, 0.35),
			Vector3(rng.randf_range(-7, 7), 0, rng.randf_range(-7, 7)), _rock_tint(rng, mesh), true)
	# 3. Bedrock crown: a couple of angular outcrops shoulder through the crest (not boulders on top).
	if not sinking:
		for i in 2 + int(r > 6.0):
			var p := c + Vector3(rng.randf_range(-1, 1), 0, rng.randf_range(-1, 1)) * seam_r * 0.45
			var sc := rng.randf_range(1.1, 1.9)
			var b := Basis.from_euler(Vector3(rng.randf_range(-0.35, 0.35), rng.randf() * TAU, rng.randf_range(-0.35, 0.35))).scaled(Vector3.ONE * sc)
			_piece(fx, "scarp_b" if i == 0 else "chunk_c", Transform3D(b, Vector3(p.x, g.before(p) - 1.0 * sc, p.z)),
				Transform3D(b, Vector3(p.x, g.target(p) - 0.3 * sc, p.z)), 0.15 + i * 0.12, 0.95, CURVE_BACK, 0.0, Vector3.ZERO, _rock_tint(rng, "chunk_a"), true)
	# 4. Dust: small, low puffs spat from the seam while it opens; none after 70%.
	for i in int(fx.max_dust * 0.45):
		var a := rng.randf() * TAU
		var dir := Vector3(cos(a), 0, sin(a))
		var pos := c + dir * seam_r * rng.randf_range(0.9, 1.1)
		pos.y = lerpf(g.before(pos), g.target(pos), 0.5)
		_dust(fx, pos, dir * rng.randf_range(0.3, 0.9) + Vector3.UP * rng.randf_range(0.3, 0.8), _birth(fx, rng.randf_range(0.12, 0.7)),
			rng.randf_range(0.6, 1.1), rng.randf_range(0.25, 0.45), rng.randf_range(0.7, 1.3), Color(0.5, 0.41, 0.3, rng.randf_range(0.25, 0.45)))
	fx.light_color = Color(1.0, 0.7, 0.4)
	fx.light_path = [c + Vector3.UP * 1.2]

func _build_grow(fx: Dictionary, rng: RandomNumberGenerator, g: _Ground, path: Array, p: Dictionary, q: float) -> void:
	var pl := _Polyline.new(path)
	var trees: Array = []
	if p.has("tree_positions"):
		trees = p.tree_positions
	else:
		var count: int = clampi(int(pl.length / 2.6) + 1, 1, 12)
		for k in count:
			var at: Dictionary = pl.at((k + 0.5) / count * pl.length)
			trees.append(at.pos + at.right * rng.randf_range(-2.4, 2.4) + at.tangent * rng.randf_range(-0.8, 0.8))
	var n := trees.size()
	if p.has("tree_positions") and not grow_saplings_persist:
		_build_grow_real(fx, rng, g, pl, trees, q)
		return
	var motes_each: int = maxi(2, int(fx.max_dust * 0.6) / maxi(n, 1))
	for i in n:
		var base: Vector3 = trees[i]
		base.y = g.surface(base, base.y)
		var along := pl.project(base) / maxf(pl.length, 0.01)
		var tb := along * 0.4 + rng.randf_range(0.0, 0.18)       # wave along the cast path, jittered
		var grown := rng.randf_range(1.2, 2.3)
		# roots reach out first, skimming just under the soil skin
		for k in 5:
			var a := (k + rng.randf_range(-0.3, 0.3)) / 5.0 * TAU
			var dir := Vector3(cos(a), -0.05, sin(a)).normalized()
			var bas := Basis.looking_at(-dir, Vector3.UP)
			var reach := rng.randf_range(0.8, 1.8) * grown * 0.6
			var t0 := tb + k * 0.02
			_piece(fx, "root_seg", Transform3D(bas.scaled_local(Vector3(1.4, 1.4, 0.01)), base + Vector3.UP * 0.06),
				Transform3D(bas.scaled_local(Vector3(1.8, 1.5, reach)), base + Vector3.UP * 0.02), t0, minf(t0 + 0.22, 1.0),
				CURVE_SMOOTH, 0.0, Vector3.ZERO, Color(rng.randf_range(0.85, 1.1), 0.95, 0.9, 0.6), true)
			_dust(fx, base + dir * reach, Vector3.UP * 0.35, _birth(fx, t0 + 0.18), 0.9, 0.15, 0.55, Color(0.45, 0.34, 0.22, 0.45))
		# sapling shoots up with an overshoot, then the canopy unfolds puff by puff
		var yaw := rng.randf() * TAU
		var lean := Basis.from_euler(Vector3(rng.randf_range(-0.08, 0.08), yaw, rng.randf_range(-0.08, 0.08)))
		var ts := tb + 0.14
		_piece(fx, "sapling", Transform3D(lean.scaled(Vector3(0.3, 0.02, 0.3)), base), Transform3D(lean.scaled(Vector3.ONE * grown), base),
			ts, minf(ts + 0.4, 1.0), CURVE_BACK, 0.0, Vector3.ZERO, Color(1, 1, 1, 0.0), grow_saplings_persist)
		var leaf_tint := _leaf_tint(rng)
		for tip in [Vector3(0.0, 1.62, 0.0), Vector3(0.42, 1.33, 0.1), Vector3(-0.36, 1.48, -0.15), Vector3(0.05, 1.2, 0.3)]:
			var world_tip: Vector3 = base + lean * (tip as Vector3) * grown
			var puff := rng.randf_range(0.7, 1.1) * grown * (1.0 if tip.x == 0.0 else 0.75)
			var tl := ts + 0.18 + rng.randf_range(0.0, 0.22)
			var pb := Basis.from_euler(Vector3(0, rng.randf() * TAU, 0))
			_piece(fx, "leaf_puff", Transform3D(pb.scaled(Vector3.ONE * 0.02), base + lean * (tip as Vector3) * grown * 0.5),
				Transform3D(pb.scaled(Vector3(puff, puff * rng.randf_range(0.85, 1.1), puff)), world_tip), tl, minf(tl + 0.3, 1.0),
				CURVE_BACK, 0.0, Vector3.ZERO, leaf_tint * Color(rng.randf_range(0.92, 1.08), rng.randf_range(0.94, 1.06), 1, 0), grow_saplings_persist)
		for m in motes_each:
			var a := rng.randf() * TAU
			var pos := base + Vector3(cos(a), 0.1, sin(a)) * rng.randf_range(0.3, 1.2)
			_mote(fx, pos, Vector3(-sin(a) * 0.5, rng.randf_range(0.6, 1.4), cos(a) * 0.5), _birth(fx, tb + rng.randf_range(0.0, 0.5)),
				rng.randf_range(0.8, 1.6), rng.randf_range(0.1, 0.2), Color(0.75, 1.0, 0.45, 1.6))
	fx.light_color = Color(0.7, 1.0, 0.55)
	for k in 5: fx.light_path.append((pl.at(pl.length * k / 4.0).pos as Vector3) + Vector3.UP * 1.5)

## Grow Forest when world_builder_runtime owns the real trees (grow_saplings_persist=false).
## Real tree i starts at along*0.4 and scales 0.05->1 over the next 0.4 of progress (2.4 s total).
## The VFX never draws a second tree: it leads each one with a ground wave (sprouts + motes running
## down the cast line from t=0), a heave ring and surface root runners, then unfolds transient leaf
## clusters at the real crown height that bloom ahead of the real canopy and fold into it.
func _build_grow_real(fx: Dictionary, rng: RandomNumberGenerator, g: _Ground, pl: _Polyline, trees: Array, q: float) -> void:
	var length: float = maxf(pl.length, 0.5)
	# 1. Wave front: seedlings flicker up along the cast line, 0 -> 0.45 progress (first 0.5 s visible).
	var n_sprout: int = clampi(int(length * 3.0 * q), 10, 90)
	for k in n_sprout:
		var s := (float(k) + rng.randf()) / n_sprout * length
		var at: Dictionary = pl.at(s)
		var pos: Vector3 = at.pos + at.right * rng.randf_range(-3.2, 3.2)
		pos.y = g.surface(pos, at.pos.y)
		var t0 := 0.02 + s / length * 0.42
		var sc := rng.randf_range(1.8, 3.2)          # ~0.5 m: readable from the RTS camera
		var b := Basis(Vector3.UP, rng.randf() * TAU)
		_piece(fx, "sprout", Transform3D(b.scaled(Vector3(0.2, 0.02, 0.2) * sc), pos), Transform3D(b.scaled(Vector3.ONE * sc), pos),
			t0, minf(t0 + 0.12, 1.0), CURVE_BACK, 0.0, Vector3.ZERO, Color(rng.randf_range(0.9, 1.15), rng.randf_range(0.95, 1.1), 0.9, 0.0), false)
		if k % 2 == 0:
			_mote(fx, pos + Vector3.UP * 0.1, Vector3(0, rng.randf_range(0.8, 1.6), 0) + at.tangent * 0.6, _birth(fx, t0), rng.randf_range(0.5, 0.9),
				rng.randf_range(0.12, 0.2), Color(0.8, 1.0, 0.5, 1.8))
	var motes_each: int = maxi(3, int(fx.max_dust * 0.7) / maxi(trees.size(), 1))
	for i in trees.size():
		var base: Vector3 = trees[i]
		base.y = g.surface(base, base.y)
		var tb: float = pl.project(base) / length * 0.4           # identical to world_builder growth.start
		# 2. Heave ring: turf swells and cracks just before the trunk appears.
		var sb := Basis(Vector3.UP, rng.randf() * TAU)
		var sw := rng.randf_range(1.1, 1.5)
		_piece(fx, "swell", Transform3D(sb.scaled(Vector3(0.3, 0.01, 0.3) * sw), base + Vector3.DOWN * 0.1),
			Transform3D(sb.scaled(Vector3(sw, 0.9, sw)), base + Vector3.DOWN * 0.05), maxf(tb - 0.04, 0.0), minf(tb + 0.16, 1.0),
			CURVE_BACK, 0.0, Vector3.ZERO, Color(1, 1, 1, 0.5), false)
		# 3. Surface root runners race outward (legible from RTS), then stay as the flare's reach.
		var n_roots: int = 5 + rng.randi() % 3
		for k in n_roots:
			var a := (k + rng.randf_range(-0.35, 0.35)) / n_roots * TAU
			var dir := Vector3(cos(a), -0.08, sin(a)).normalized()
			var bas := Basis.looking_at(-dir, Vector3.UP)
			var reach := rng.randf_range(1.2, 2.4)
			var t0 := maxf(tb - 0.03, 0.0) + k * 0.012
			var tip: Vector3 = base + Vector3(dir.x, 0, dir.z) * reach
			_piece(fx, "root_seg", Transform3D(bas.scaled_local(Vector3(1.6, 1.6, 0.01)), base + Vector3.UP * 0.04),
				Transform3D(bas.scaled_local(Vector3(2.0, 1.7, reach)), base + Vector3.UP * 0.02), t0, minf(t0 + 0.18, 1.0),
				CURVE_SMOOTH, 0.0, Vector3.ZERO, Color(rng.randf_range(0.85, 1.05), 0.95, 0.9, 0.6), false)
			_dust(fx, tip, Vector3.UP * 0.4, _birth(fx, t0 + 0.12), 0.7, 0.12, 0.45, Color(0.45, 0.35, 0.23, 0.4))
		# 4. Unfolding crown: leaf clusters bloom at the real crown height while the real tree is at
		#    ~30-70% scale, then fold back into its canopy (scale -> 0) as it reaches full size.
		var yaw := rng.randf() * TAU
		var tint := _leaf_tint(rng)
		for j in 5:
			var ang := yaw + j * TAU / 5.0 + rng.randf_range(-0.3, 0.3)
			var off := Vector3(cos(ang), 0, sin(ang)) * REAL_TREE_CROWN_R * rng.randf_range(0.55, 0.85) + Vector3.UP * rng.randf_range(-0.3, 0.5)
			# rev-2: the real tree is ~55% grown at tb+0.2; bloom starts from ITS crown, never floats above it
			var crown: Vector3 = base + Vector3.UP * REAL_TREE_CROWN_Y * 0.95 + off * 1.15
			var puff := rng.randf_range(0.7, 1.0)
			var tl := tb + 0.18 + j * 0.02
			var pb := Basis.from_euler(Vector3(0, rng.randf() * TAU, 0))
			_piece(fx, "leaf_puff", Transform3D(pb.scaled(Vector3.ONE * 0.05), base + Vector3.UP * REAL_TREE_CROWN_Y * 0.6 + off * 0.4),
				Transform3D(pb.scaled(Vector3(puff, puff * 0.9, puff)), crown), tl, minf(tl + 0.14, 1.0),
				CURVE_BACK, 0.0, Vector3.ZERO, tint * Color(rng.randf_range(0.95, 1.1), rng.randf_range(0.95, 1.08), 1, 0), false)
			fx.pieces[-1]["fold"] = minf(tb + 0.38, 0.98)              # fold into the real canopy as it completes
		# 5. Motes spiral up the trunk to the crown in step with the real growth.
		for m in motes_each:
			var a := rng.randf() * TAU
			var pos := base + Vector3(cos(a), 0.15, sin(a)) * rng.randf_range(0.3, 0.9)
			_mote(fx, pos, Vector3(-sin(a) * 0.7, rng.randf_range(1.8, 3.2), cos(a) * 0.7), _birth(fx, tb + rng.randf_range(0.0, 0.3)),
				rng.randf_range(0.8, 1.3), rng.randf_range(0.1, 0.18), Color(0.78, 1.0, 0.48, 1.7))
	fx.light_color = Color(0.7, 1.0, 0.55)
	for k in 5: fx.light_path.append((pl.at(pl.length * k / 4.0).pos as Vector3) + Vector3.UP * 1.5)

## Where a sunder wall meets the new floor on one side: walks outward from the path centre and
## returns {pos (on the floor at the wall foot), depth (original surface minus floor)}.
func _wall_foot(g: _Ground, centre: Vector3, out: Vector3, w: float) -> Dictionary:
	var floor_y := g.target(centre)
	var max_cut := g.before(centre) - floor_y
	if max_cut < 0.25: return {}
	var best := 0.0
	for k in range(1, 9):
		var d := w * k / 8.0
		var p := centre + out * d
		if g.before(p) - g.target(p) >= max_cut * 0.72: best = d
	var foot := centre + out * best
	foot.y = g.target(foot)
	return {"pos": foot, "depth": g.before(foot) - foot.y}

# ---------------------------------------------------------------- piece helpers

func _piece(fx: Dictionary, mesh: String, from: Transform3D, to: Transform3D, t0: float, t1: float, curve: int, arc: float, spin: Vector3, tint: Color, permanent: bool) -> void:
	fx.pieces.append({"mesh": mesh, "from": from, "to": to, "t0": clampf(t0, 0.0, 0.98), "t1": clampf(maxf(t1, t0 + 0.05), 0.02, 1.0),
		"curve": curve, "arc": arc, "spin": spin, "tint": tint, "perm": permanent, "slot": -1})

func _dust(fx: Dictionary, pos: Vector3, vel: Vector3, birth: float, life: float, s0: float, s1: float, col: Color) -> void:
	if fx.dust.size() >= fx.max_dust: return
	fx.dust.append({"p": pos, "v": vel, "b": birth, "l": life, "s0": s0 * dust_scale, "s1": s1 * dust_scale, "c": col})

func _mote(fx: Dictionary, pos: Vector3, vel: Vector3, birth: float, life: float, size: float, col: Color) -> void:
	fx.motes.append({"p": pos, "v": vel, "b": birth, "l": life, "s0": size, "s1": size * 0.4, "c": col})

func _birth(fx: Dictionary, forward_progress: float) -> float:
	var t := clampf(forward_progress, 0.0, 1.0)
	return (1.0 - t if fx.reverse else t) * fx.duration

## Pitch (radians about local Z) that lays a slab's +X along the settled ground.
func _slope_pitch(g: _Ground, hinge: Vector3, x_dir: Vector3) -> float:
	return atan2(g.target(hinge + x_dir * 0.7) - g.target(hinge), 0.7)

func _frame(out: Vector3) -> Basis:
	var x := Vector3(out.x, 0, out.z).normalized()
	return Basis(x, Vector3.UP, x.cross(Vector3.UP))

func _earth_tint(rng: RandomNumberGenerator, v: float) -> Color:
	var k := rng.randf_range(0.9, 1.08) * v
	return Color(k, k * rng.randf_range(0.96, 1.02), k * rng.randf_range(0.92, 1.0), 1.0)

func _rock_tint(rng: RandomNumberGenerator, mesh: String) -> Color:
	var k := rng.randf_range(0.82, 1.12)
	var warm := rng.randf_range(0.97, 1.06)
	return Color(k * warm, k, k / warm, 0.9 if mesh == "clod_a" else 0.5)

func _leaf_tint(rng: RandomNumberGenerator) -> Color:
	var roll := rng.randf()
	if roll < 0.25: return Color(1.25, 1.12, 0.6, 0)    # sunlit yellow-green
	if roll < 0.5: return Color(0.62, 0.82, 0.95, 0)    # deep blue-green
	if roll < 0.47: return Color(1.35, 0.85, 0.5, 0)    # one early-turning crown
	return Color(rng.randf_range(0.8, 1.05), rng.randf_range(0.88, 1.08), rng.randf_range(0.7, 0.95), 0)

# ---------------------------------------------------------------- nodes

func _spawn_nodes(fx: Dictionary) -> void:
	var counts := {}
	for piece in fx.pieces:
		piece.slot = int(counts.get(piece.mesh, 0))
		counts[piece.mesh] = piece.slot + 1
	for mesh_name in counts:
		fx.nodes[mesh_name] = _make_mmi(_meshes[mesh_name], _surface, counts[mesh_name])
	if not fx.dust.is_empty(): fx.nodes["_dust"] = _make_mmi(_quad, _dust_mat, fx.dust.size())
	if not fx.motes.is_empty(): fx.nodes["_motes"] = _make_mmi(_quad, _mote_mat, fx.motes.size())
	if fx.allow_light and _lights_in_use < 2 and not fx.light_path.is_empty():
		var light := OmniLight3D.new()
		light.shadow_enabled = false
		light.light_color = fx.light_color
		light.omni_range = 7.0
		light.light_energy = 0.0
		add_child(light)
		fx.light = light
		_lights_in_use += 1

func _make_mmi(mesh: Mesh, material: Material, count: int) -> MultiMeshInstance3D:
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_custom_data = true
	mm.mesh = mesh
	mm.instance_count = count
	var node := MultiMeshInstance3D.new()
	node.multimesh = mm
	node.material_override = material
	node.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF if material != _surface else GeometryInstance3D.SHADOW_CASTING_SETTING_ON
	add_child(node)
	return node

func _free_fx(id: String) -> void:
	if not _active.has(id): return
	var fx: Dictionary = _active[id]
	for key in fx.nodes: (fx.nodes[key] as Node).queue_free()
	fx.nodes.clear()
	if fx.light != null:
		(fx.light as Node).queue_free()
		_lights_in_use -= 1
	_active.erase(id)

func _clear_transient() -> void:
	for id in _active.keys(): _free_fx(id)

# ---------------------------------------------------------------- evaluation

func _evaluate(fx: Dictionary) -> void:
	var p: float = 1.0 - fx.progress if fx.reverse else fx.progress
	var global_e: float = p * p * (3.0 - 2.0 * p)
	for piece in fx.pieces:
		var node: MultiMeshInstance3D = fx.nodes.get(piece.mesh)
		if node == null: continue
		node.multimesh.set_instance_transform(piece.slot, _piece_xform(piece, p))
		node.multimesh.set_instance_custom_data(piece.slot, piece.tint)
	_eval_particles(fx, "_dust", fx.dust)
	_eval_particles(fx, "_motes", fx.motes)
	if fx.light != null:
		var light: OmniLight3D = fx.light
		var lp: Array = fx.light_path
		var f := clampf(p / 0.7, 0.0, 1.0) * (lp.size() - 1)
		var i := mini(int(f), lp.size() - 1)
		light.position = (lp[i] as Vector3).lerp(lp[mini(i + 1, lp.size() - 1)], f - i)
		var fade := 1.0 - clampf(fx.tail / 0.8, 0.0, 1.0)
		light.light_energy = 1.4 * sin(PI * clampf(fx.progress, 0.0, 1.0) * 0.5 + 0.2) * fade * (0.6 if fx.reverse else 1.0)
	fx["global_e"] = global_e

func _piece_xform(piece: Dictionary, p: float) -> Transform3D:
	var u := clampf((p - piece.t0) / (piece.t1 - piece.t0), 0.0, 1.0)
	var from: Transform3D = piece.from
	var to: Transform3D = piece.to
	var e: float
	match int(piece.curve):
		CURVE_BACK:
			var c1 := 1.9
			e = 1.0 + (c1 + 1.0) * pow(u - 1.0, 3) + c1 * pow(u - 1.0, 2)
		CURVE_FALL:
			e = u * u
			if u > 0.82:  # one small bounce as it lands
				var b := (u - 0.82) / 0.18
				e = 1.0 - sin(b * PI) * 0.06
		_:
			e = u * u * (3.0 - 2.0 * u)
	var pos := from.origin.lerp(to.origin, e)
	if piece.curve == CURVE_FALL:
		pos = from.origin.lerp(to.origin, u).lerp(pos, 0.6)
		pos.x = lerpf(from.origin.x, to.origin.x, 1.0 - pow(1.0 - u, 2))
		pos.z = lerpf(from.origin.z, to.origin.z, 1.0 - pow(1.0 - u, 2))
		pos.y = lerpf(from.origin.y, to.origin.y, e) + piece.arc * 4.0 * u * (1.0 - u)
	var s0 := from.basis.get_scale()
	var s1 := to.basis.get_scale()
	var q := Quaternion(from.basis.orthonormalized()).slerp(Quaternion(to.basis.orthonormalized()), clampf(e, 0.0, 1.0))
	var spin: Vector3 = piece.spin * (1.0 - u) * u
	var basis := Basis(q) * Basis.from_euler(spin)
	var scale := s0.lerp(s1, e).max(Vector3.ONE * 0.001)
	if piece.has("fold"):   # transient bloom that folds back into the real canopy
		var f := clampf((p - float(piece.fold)) / 0.14, 0.0, 1.0)
		scale *= maxf(1.0 - f * f * (3.0 - 2.0 * f), 0.001)
	return Transform3D(basis.scaled_local(scale), pos)

func _eval_particles(fx: Dictionary, key: String, list: Array) -> void:
	var node: MultiMeshInstance3D = fx.nodes.get(key)
	if node == null: return
	var clock: float = fx.clock
	for i in list.size():
		var d: Dictionary = list[i]
		var age: float = clock - d.b
		var a: float = age / d.l
		if a <= 0.0 or a >= 1.0:
			node.multimesh.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ONE * 0.0001), d.p))
			node.multimesh.set_instance_custom_data(i, Color(0, 0, 0, 0))
			continue
		var drift: Vector3 = d.v * (1.0 - exp(-age * 1.6)) / 1.6
		var s: float = lerpf(d.s0, d.s1, sqrt(a))
		node.multimesh.set_instance_transform(i, Transform3D(Basis.from_scale(Vector3.ONE * s), d.p + drift))
		var col: Color = d.c
		col.a *= smoothstep(0.0, 0.12, a) * (1.0 - smoothstep(0.45, 1.0, a))
		node.multimesh.set_instance_custom_data(i, col)

func _settle(fx: Dictionary) -> void:
	if fx.settled: return
	fx.settled = true
	fx.progress = 1.0
	fx.clock = maxf(fx.clock, fx.duration)
	_evaluate(fx)
	if not fx.reverse: _persist(fx)
	# Pieces are handed to the shared permanent MultiMeshes; only dust/motes/light linger.
	for key in fx.nodes.keys():
		if str(key).begins_with("_"): continue
		(fx.nodes[key] as Node).queue_free()
		fx.nodes.erase(key)

func _persist(fx: Dictionary) -> void:
	var kept: Array = []
	for piece in fx.pieces:
		if piece.perm: kept.append([piece.mesh, _piece_xform(piece, 1.0), piece.tint * Color(1, 1, 1, 0.35)])
	if kept.is_empty(): return
	_permanent[fx.id] = kept
	_perm_dirty = true

func _rebuild_permanent() -> void:
	_perm_dirty = false
	var total := permanent_piece_count()
	var ids := _permanent.keys()
	while total > max_permanent_pieces and not ids.is_empty():  # oldest settled operations fade first
		total -= (_permanent[ids[0]] as Array).size()
		_permanent.erase(ids[0])
		ids.remove_at(0)
	var buckets := {}
	for id in _permanent:
		for entry in _permanent[id]: (buckets.get_or_add(entry[0], []) as Array).append(entry)
	for mesh_name in KIT_MESHES:
		var list: Array = buckets.get(mesh_name, [])
		var node: MultiMeshInstance3D = _perm_nodes.get(mesh_name)
		if list.is_empty():
			if node != null: node.multimesh.instance_count = 0
			continue
		if node == null:
			node = _make_mmi(_meshes[mesh_name], _surface, 0)
			node.name = "Permanent_" + mesh_name
			_perm_nodes[mesh_name] = node
		node.multimesh.instance_count = list.size()
		for i in list.size():
			node.multimesh.set_instance_transform(i, list[i][1])
			node.multimesh.set_instance_custom_data(i, list[i][2])

# ---------------------------------------------------------------- geometry helpers

class _Ground:
	var xz := PackedVector2Array()
	var hb := PackedFloat32Array()
	var ht := PackedFloat32Array()

	func _init(samples: Array) -> void:
		for s in samples:
			var b: Vector3 = s.get("world_before", Vector3.ZERO)
			var t: Vector3 = s.get("world_target", b)
			xz.append(Vector2(b.x, b.z))
			hb.append(b.y)
			ht.append(t.y)

	func _nearest(p: Vector3) -> int:
		var best := -1
		var best_d := INF
		var q := Vector2(p.x, p.z)
		for i in xz.size():
			var d := xz[i].distance_squared_to(q)
			if d < best_d:
				best_d = d
				best = i
		return best

	func before(p: Vector3) -> float:
		var i := _nearest(p)
		return p.y if i < 0 else hb[i]

	func target(p: Vector3) -> float:
		var i := _nearest(p)
		return p.y if i < 0 else ht[i]

	func surface(p: Vector3, fallback: float) -> float:
		var i := _nearest(p)
		if i < 0 or xz[i].distance_to(Vector2(p.x, p.z)) > 2.0: return fallback
		return ht[i]

	func half_width(pl: _Polyline, cut: bool) -> float:
		var w := 0.0
		for i in xz.size():
			if (hb[i] - ht[i] if cut else ht[i] - hb[i]) > 0.12:
				w = maxf(w, pl.distance(Vector3(xz[i].x, 0, xz[i].y)))
		return clampf(w, 0.6, 6.0) if w > 0.0 else 1.2

	## Mean horizontal distance of samples whose heave is 35-65% of the peak: the steep shoulder.
	func seam_radius(c: Vector3, r: float) -> float:
		var peak := 0.0
		for i in xz.size(): peak = maxf(peak, absf(ht[i] - hb[i]))
		if peak < 0.1: return r * 0.6
		var total := 0.0
		var count := 0
		for i in xz.size():
			var k := absf(ht[i] - hb[i]) / peak
			if k > 0.35 and k < 0.65:
				total += xz[i].distance_to(Vector2(c.x, c.z))
				count += 1
		return clampf(total / count, r * 0.3, r * 0.9) if count > 0 else r * 0.6

	func radius(c: Vector3) -> float:
		var r := 0.0
		for i in xz.size():
			if absf(ht[i] - hb[i]) > 0.08: r = maxf(r, xz[i].distance_to(Vector2(c.x, c.z)))
		return clampf(r, 1.0, 12.0) if r > 0.0 else 3.0

class _Polyline:
	var pts: Array = []
	var cum := PackedFloat32Array()
	var length := 0.0

	func _init(path: Array) -> void:
		for p in path: pts.append(p)
		if pts.size() == 1: pts.append((pts[0] as Vector3) + Vector3(0.01, 0, 0))
		cum.append(0.0)
		for i in range(1, pts.size()):
			length += _flat(pts[i] - pts[i - 1]).length()
			cum.append(length)

	static func _flat(v: Vector3) -> Vector3:
		return Vector3(v.x, 0, v.z)

	func at(s: float) -> Dictionary:
		s = clampf(s, 0.0, length)
		var i := 1
		while i < pts.size() - 1 and cum[i] < s: i += 1
		var a: Vector3 = pts[i - 1]
		var b: Vector3 = pts[i]
		var seg := maxf(cum[i] - cum[i - 1], 0.0001)
		var t := _flat(b - a).normalized()
		if t == Vector3.ZERO: t = Vector3.FORWARD
		return {"pos": a.lerp(b, (s - cum[i - 1]) / seg), "tangent": t, "right": t.cross(Vector3.UP).normalized()}

	func distance(p: Vector3) -> float:
		var best := INF
		for i in range(1, pts.size()):
			var a := _flat(pts[i - 1])
			var b := _flat(pts[i])
			best = minf(best, Geometry3D.get_closest_point_to_segment(_flat(p), a, b).distance_to(_flat(p)))
		return best

	func project(p: Vector3) -> float:
		var best := INF
		var best_s := 0.0
		for i in range(1, pts.size()):
			var a := _flat(pts[i - 1])
			var b := _flat(pts[i])
			var c := Geometry3D.get_closest_point_to_segment(_flat(p), a, b)
			var d := c.distance_to(_flat(p))
			if d < best:
				best = d
				best_s = cum[i - 1] + a.distance_to(c)
		return best_s
