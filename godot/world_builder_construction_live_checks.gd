extends SceneTree
## Actual Orchard river, structure floor and worker navigation; isolated save mode.
const Navigation = preload("res://landscape_navigation.gd")

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var builder: Node = game.world_builder
	if builder == null or builder.construction == null:
		failures.append("live builder construction module missing")
	else:
		builder.data.wood = 200
		var route: Array = game.landscape.model.river_polyline
		var selected := {}
		var examined := 0
		for index in range(4, route.size() - 4, 3):
			var at: Vector3 = route[index]
			var center: Vector2 = Vector2(at.x, at.z)
			if absf(center.x) > 110.0 or absf(center.y) > 110.0: continue
			if center.distance_to(Vector2(25, -48)) < 24.0: continue
			var before: Vector3 = route[index - 2]
			var after: Vector3 = route[index + 2]
			var along: Vector2 = Vector2(after.x - before.x, after.z - before.z).normalized()
			if along.length_squared() < 0.9: continue
			var across: Vector2 = along.orthogonal()
			for half_span in [9.0, 11.0, 13.0, 15.0]:
				var a2: Vector2 = center - across * float(half_span)
				var b2: Vector2 = center + across * float(half_span)
				var a := Vector3(a2.x, 0, a2.y)
				var b := Vector3(b2.x, 0, b2.y)
				var plan: Dictionary = builder.construction.preview("bridge", a, b)
				examined += 1
				if plan.valid:
					var record := {"kind": "bridge", "a": [plan.a.x, plan.a.y, plan.a.z], "b": [plan.b.x, plan.b.y, plan.b.z], "width": plan.width}
					var proposed: Array[Vector2] = Navigation.route(game.landscape.model, a2, b2, {"allow_bridge": false, "constructions": [record]})
					if not proposed.is_empty():
						selected = {"a": a, "b": b, "plan": plan}
						break
			if not selected.is_empty(): break
		if selected.is_empty(): failures.append("no valid unmarked river banks among %d surveyed spans" % examined)
		else:
			var result: String = builder.construction.place("bridge", selected.a, selected.b)
			if not result.is_empty(): failures.append("surveyed free bridge placement failed: " + result)
			else:
				await physics_frame
				var midpoint: Vector3 = (selected.plan.a + selected.plan.b) * 0.5
				var ray := PhysicsRayQueryParameters3D.create(midpoint + builder.center + Vector3.UP * 2.0, midpoint + builder.center + Vector3.DOWN * 2.0, 1)
				var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
				if hit.is_empty() or str(hit.collider.get_meta("kind", "")) != "floor": failures.append("live free bridge has no Hero floor collision: " + str(hit))
				var options := {"allow_bridge": false, "constructions": builder.data.constructions}
				var from := Vector2(selected.a.x, selected.a.z)
				var to := Vector2(selected.b.x, selected.b.z)
				var path: Array[Vector2] = Navigation.route(game.landscape.model, from, to, options)
				if path.is_empty() or not Navigation.path_passable(game.landscape.model, path, options): failures.append("live worker planner cannot cross free bridge")
				var on_wet_deck := false
				for point in path:
					if game.landscape.water_at(point) > 0.45 and builder.construction.surface_height(point, -1000.0) > -999.0: on_wet_deck = true
				if not on_wet_deck: failures.append("live worker route avoids built river deck")
				if not builder.worker_nodes.is_empty():
					var worker: Node3D = builder.worker_nodes[0]
					worker.position = Vector3(from.x, game.landscape.height_at(from), from.y)
					worker.set_meta("nav_initialized", false)
					var arrived := false
					var crossed_wet := false
					for tick in 320:
						arrived = builder._worker_travel(worker, Vector3(to.x, 0, to.y), 0.05, 2.1, 0.55)
						var at := Vector2(worker.position.x, worker.position.z)
						if game.landscape.water_at(at) > 0.45:
							crossed_wet = true
							if absf(worker.position.y - builder.construction.surface_height(at, game.landscape.height_at(at))) > 0.03:
								failures.append("worker height diverged from built deck")
								break
						if arrived: break
					if not arrived or not crossed_wet: failures.append("actual lumberjack did not travel across free bridge")
				print("LIVE_CONSTRUCTION span=", selected.plan.length, " lumber=", selected.plan.lumber, " from=", selected.a, " to=", selected.b, " waypoints=", path.size())
	print("LIVE_CONSTRUCTION_RESULT failures=", failures)
	for failure in failures: push_error(failure)
	quit(0 if failures.is_empty() else 1)
