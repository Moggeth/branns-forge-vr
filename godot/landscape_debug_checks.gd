extends SceneTree

const Fields = preload("res://landscape_fields.gd")
const Hydrology = preload("res://landscape_hydrology.gd")
const Ecology = preload("res://landscape_ecology.gd")
const Debug = preload("res://landscape_debug.gd")
const Navigation = preload("res://landscape_navigation.gd")
const LANDMARKS := [Vector2(-78,83), Vector2(-112,-40), Vector2(-25,-109), Vector2(82,-83), Vector2(73,93), Vector2(0,103)]


func _initialize() -> void:
	var failures: Array[String] = []
	var output_dir := ProjectSettings.globalize_path("res://../output/landscape-debug")
	if DirAccess.make_dir_recursive_absolute(output_dir) != OK:
		push_error("Cannot create landscape debug output")
		quit(1)
		return
	var model: Dictionary = Fields.create(2000)
	Hydrology.run(model, [])
	Fields.derive(model)
	Ecology.build_fields(model)
	model["vegetation_instances"] = Ecology.generate(model).trees
	var maps: Array[String] = Debug.export_fields(model, output_dir.path_join("seed-2000-fields"))
	if maps.size() != Debug.LAYERS.size(): failures.append("missing registered field PNGs")
	var batch_start: int = Time.get_ticks_usec()
	var thumb_size := 161 * 2
	var sheet := Image.create_empty(thumb_size * 4, thumb_size * 5, false, Image.FORMAT_RGBA8)
	var html := "<!doctype html><html><meta name='viewport' content='width=device-width,initial-scale=1'><title>Orchard seeds</title><style>body{font:16px system-ui;background:#171b17;color:#f4ecd8;padding:20px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px}figure{margin:0}img{width:100%;image-rendering:pixelated}a{color:#b7dbad}</style><h1>Orchard seed gallery</h1><p><a href='seed-2000-fields/overview.png'>Seed 2000 world genome maps</a></p><main>"
	var metrics: Array[Dictionary] = []
	for n in 20:
		var seed: int = 2000 + n
		var variant: Dictionary = model if n == 0 else Fields.create(seed)
		if n > 0:
			Hydrology.run(variant, [])
			Fields.derive(variant)
			Ecology.build_fields(variant)
		var report := _metrics(variant)
		metrics.append(report)
		if not report.river_descends: failures.append("river ascends on seed %d" % seed)
		if report.bridge_distance > 4.0: failures.append("bridge leaves river on seed %d" % seed)
		if report.max_grade > 1.0: failures.append("unsafe needle slope on seed %d" % seed)
		var routes_ok := 0
		var unreachable: Array[Vector2] = []
		for landmark in LANDMARKS:
			if not Navigation.route(variant, Vector2(15,-27), landmark).is_empty(): routes_ok += 1
			else: unreachable.append(landmark)
		report["reachable_landmarks"] = routes_ok
		if routes_ok < LANDMARKS.size():
			var details := []
			for point in unreachable:
				details.append({"at":point, "water":Fields.sample(variant,"water",point), "slope":Fields.sample(variant,"slope",point), "trav":Fields.sample(variant,"traversability",point), "wet_route":Navigation.route(variant,Vector2(15,-27),point,{"max_water":1.0}).size(), "soft_route":Navigation.route(variant,Vector2(15,-27),point,{"max_water":1.0,"max_step":1.2,"max_grade":0.9}).size()})
			failures.append("landmark unreachable on seed %d (%d/%d): %s" % [seed,routes_ok,LANDMARKS.size(),str(details)])
		var image := Debug.make_image(variant, "overview")
		var path: String = output_dir.path_join("seed-%d.png" % seed)
		if image == null or image.save_png(path) != OK: failures.append("overview export seed %d" % seed)
		else: sheet.blit_rect(image, Rect2i(0, 0, thumb_size, thumb_size), Vector2i(n % 4 * thumb_size, n / 4 * thumb_size))
		html += "<figure><img src='seed-%d.png' alt='Seed %d terrain overview'><figcaption>Seed %d · %.0f%% walkable · %.2f max grade</figcaption></figure>" % [seed, seed, seed, report.walkable_fraction * 100.0, report.max_grade]
	html += "</main></html>"
	if sheet.save_png(output_dir.path_join("contact-sheet.png")) != OK: failures.append("contact sheet export")
	var page := FileAccess.open(output_dir.path_join("index.html"), FileAccess.WRITE)
	if page == null: failures.append("gallery export")
	else: page.store_string(html)
	var report_file := FileAccess.open(output_dir.path_join("seed-metrics.json"), FileAccess.WRITE)
	if report_file == null: failures.append("metrics export")
	else: report_file.store_string(JSON.stringify(metrics, "  "))
	var batch_ms: float = float(Time.get_ticks_usec() - batch_start) / 1000.0
	var direction := Debug.make_image(model, "flow_direction", 1)
	if direction == null or direction.get_width() != 161: failures.append("flow direction image")
	if Debug.make_image(model, "unknown") != null: failures.append("invalid layer accepted")
	var min_walk := 1.0
	var max_grade := 0.0
	for report in metrics:
		min_walk = minf(min_walk, report.walkable_fraction)
		max_grade = maxf(max_grade, report.max_grade)
	print("LANDSCAPE_DEBUG_RESULT failures=", failures, " maps=", maps.size(), " seed20_ms=", snappedf(batch_ms, 0.01), " min_walkable=", snappedf(min_walk, 0.001), " max_grade=", snappedf(max_grade, 0.001), " output=", output_dir)
	quit(0 if failures.is_empty() else 1)


func _metrics(model: Dictionary) -> Dictionary:
	var walkable := 0
	var max_grade := 0.0
	var max_index := 0
	for i in model.height.size():
		if model.traversability[i] >= 0.5: walkable += 1
		if model.slope[i] > max_grade:
			max_grade = model.slope[i]
			max_index = i
	var descends := true
	var route: Array = model.get("river_polyline", [])
	for i in range(1, route.size()):
		if route[i].y > route[i - 1].y + 0.0001: descends = false
	var bridge_distance := INF
	for point in route: bridge_distance = minf(bridge_distance, Vector2(point.x, point.z).distance_to(Vector2(25, -48)))
	var grid_size: int = model.size
	var at: Vector2 = model.origin + Vector2(max_index % grid_size, max_index / grid_size) * float(model.step)
	return {"seed": int(model.seed), "walkable_fraction": float(walkable) / model.height.size(), "max_grade": max_grade, "max_grade_at": [at.x, at.y], "max_grade_river_distance": model.river_distance[max_index], "river_descends": descends, "bridge_distance": bridge_distance}
