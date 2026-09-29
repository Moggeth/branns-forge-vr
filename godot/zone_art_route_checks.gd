extends SceneTree

## Fast acceptance check for authored zone dressing: core routes and gather sites
## must remain physically accessible after old visuals are replaced.
const World = preload("res://world_zones.gd")

const ZONES := {
	"sandstone_quarry": {
		"resources": {"iron": 3, "stone": 3, "crystal": 1},
		"barriers": 1,
		"clear": [[0, 12], [0, 8], [0, 3], [0, -3], [2, -6],
			[-6, -1], [-1, 3], [4, -1], [-8, -7], [-2, -7], [4, -7], [5, -10], [5, -13]],
	},
	"ember_foundry": {
		"resources": {"iron": 1},
		"barriers": 0,
		"clear": [[0, 12], [0, 8], [0, 3], [0, -3], [0, -7], [5, -5], [-7, -7]],
	},
	"enchanted_kitchen": {
		"resources": {},
		"barriers": 0,
		"clear": [[0, 11], [5, 7], [5, 2], [5, -3], [5, -7], [0, -6]],
	},
	"mushroom_glade": {
		"resources": {"spore": 5},
		"barriers": 0,
		"clear": [[0, 12], [0, 8], [0, 3], [0, -3], [0, -9],
			[-7, 4], [-4, 6], [-1, 4], [2, 6], [5, 4]],
	},
}

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var checked: Dictionary = {}
	var arguments := OS.get_cmdline_user_args()
	var require_authored := arguments.has("--require-authored")
	var selected: Array[String] = []
	for argument in arguments:
		if argument.begins_with("--zone="):
			for id in argument.trim_prefix("--zone=").split(",", false):
				selected.append(id)
	for id in selected:
		if not ZONES.has(id): failures.append("unknown zone: " + id)
	var scene := Node3D.new()
	root.add_child(scene)
	var data: Dictionary = World.build(scene)
	await physics_frame
	var space := scene.get_world_3d().direct_space_state
	var capsule := CapsuleShape3D.new()
	capsule.radius = 0.28
	capsule.height = 1.6
	var shape_query := PhysicsShapeQueryParameters3D.new()
	shape_query.shape = capsule
	shape_query.collision_mask = 1
	for id in ZONES:
		if not selected.is_empty() and not selected.has(id): continue
		var expected: Dictionary = ZONES[id]
		var zone: Dictionary = data.zones[id]
		var art: Dictionary = zone.get("authored_art", {})
		if require_authored and int(art.get("assets", 0)) < 5:
			failures.append(id + ": authored kit missing or too small")
		var counts: Dictionary = {}
		for item in data.resources:
			if str(item.get_meta("zone", "")) == id:
				var kind := str(item.get_meta("resource", ""))
				counts[kind] = int(counts.get(kind, 0)) + 1
		for kind in expected.resources:
			if int(counts.get(kind, 0)) != int(expected.resources[kind]):
				failures.append(id + ": " + kind + " count changed to " + str(counts.get(kind, 0)))
		var barriers := 0
		for item in data.barriers:
			if str(item.get_meta("zone", "")) == id: barriers += 1
		if barriers != int(expected.barriers):
			failures.append(id + ": barrier count changed to " + str(barriers))
		for point in expected.clear:
			shape_query.transform = Transform3D(Basis.IDENTITY,
				zone.center + Vector3(float(point[0]), 0.9, float(point[1])))
			for hit in space.intersect_shape(shape_query, 32):
				var collider: CollisionObject3D = hit.collider
				if collider.name.begins_with("ZoneArtSolid"):
					failures.append(id + ": new art blocks " + str(point) + " with " + collider.name)
					break
		checked[id] = {"art": art, "resources": counts, "barriers": barriers,
			"route_samples": expected.clear.size()}
	print("ZONE_ART_ROUTE_RESULT ", JSON.stringify({"failures": failures, "checked": checked}))
	quit(0 if failures.is_empty() else 1)
