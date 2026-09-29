extends SceneTree
## Offline regression for seeded apple growth forms and reachable fruit.

const TreeKit = preload("res://tree_kit.gd")
const HEIGHT := 4.62
const SEEDS := [290929, 7, 83, 421]

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var started := Time.get_ticks_usec()
	var failures: Array[String] = []
	var forms: Array = TreeKit.APPLE_FORMS.keys()
	var lowest_apple := INF
	var highest_apple := -INF
	var farthest_apple := 0.0
	if forms.size() != 5:
		failures.append("expected five apple forms")
	for seed in SEEDS:
		var chosen: String = TreeKit.apple_form(seed)
		var default_tree: Dictionary = TreeKit._skeleton("apple", seed, {"height": HEIGHT})
		var default_repeat: Dictionary = TreeKit._skeleton("apple", seed, {"height": HEIGHT})
		if not forms.has(chosen) or TreeKit.apple_form(seed) != chosen:
			failures.append("seed %d form selection changed" % seed)
		if default_tree != default_repeat or default_tree.form != chosen:
			failures.append("seed %d default skeleton changed on repeat" % seed)
		var silhouettes: Array = []
		var low_limb: Array = []
		var trunk: Dictionary = {}
		for form in forms:
			var options := {"height": HEIGHT, "form": form}
			var sk: Dictionary = TreeKit._skeleton("apple", seed, options)
			if sk != TreeKit._skeleton("apple", seed, options):
				failures.append("seed %d %s is not repeatable" % [seed, form])
			if sk.form != form:
				failures.append("seed %d did not force %s" % [seed, form])
			var silhouette := _silhouette(sk)
			if silhouettes.has(silhouette):
				failures.append("seed %d %s duplicates another silhouette" % [seed, form])
			silhouettes.append(silhouette)
			if trunk.is_empty():
				trunk = sk.trunk
			elif sk.trunk != trunk:
				failures.append("seed %d trunk changed across forms" % seed)
			var first_limb := _first_limb(sk)
			if low_limb.is_empty():
				low_limb = first_limb
			elif first_limb != low_limb:
				failures.append("seed %d low fruit limb changed across forms" % seed)
			if sk.reach_points.size() != 2:
				failures.append("seed %d %s lost reachable apples" % [seed, form])
			for point in sk.reach_points:
				var p: Vector3 = point
				var horizontal := Vector2(p.x - sk.trunk.base.x, p.z - sk.trunk.base.z).length()
				lowest_apple = minf(lowest_apple, p.y)
				highest_apple = maxf(highest_apple, p.y)
				farthest_apple = maxf(farthest_apple, horizontal)
				if p.y < 1.2 or p.y > 1.9 or horizontal > 2.3:
					failures.append("seed %d %s apple outside reach: %s" % [seed, form, str(p)])
			if sk.fruit.size() < 6:
				failures.append("seed %d %s has fewer than six apples" % [seed, form])
			if seed == SEEDS[0]:
				var node := Node3D.new()
				TreeKit.build_into(node, "apple", seed, {"height": HEIGHT, "form": form, "dynamic_fruit": true, "collision": false, "lod": "far"})
				if node.get_meta("apple_fruit", []).size() != 6:
					failures.append("%s lost the six interactive apples" % form)
				node.free()
		if default_tree != TreeKit._skeleton("apple", seed, {"height": HEIGHT, "form": chosen}):
			failures.append("seed %d default form differs from forced form" % seed)
	print("TREE_KIT_FORMS_CHECK seeds=", SEEDS.size(), " forms=", forms.size(),
		" reach_y=", Vector2(snappedf(lowest_apple, 0.01), snappedf(highest_apple, 0.01)),
		" reach_radius_max=", snappedf(farthest_apple, 0.01),
		" elapsed_ms=", snappedf(float(Time.get_ticks_usec() - started) / 1000.0, 0.01), " failures=", failures)
	quit(0 if failures.is_empty() else 1)

func _first_limb(sk: Dictionary) -> Array:
	for tube in sk.tubes:
		if tube.kind == "limb": return tube.points
	return []

func _silhouette(sk: Dictionary) -> Array:
	var shape := []
	for tube in sk.tubes:
		if tube.kind == "limb": shape.append(tube.points)
	for blob in sk.blobs:
		shape.append([blob.center, blob.radius])
	return shape
