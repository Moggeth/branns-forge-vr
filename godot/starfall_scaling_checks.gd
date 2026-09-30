extends SceneTree
## Offline 128-record persistence, dormant rendering, mining and impact contract.
const Meteor = preload("res://landscape_meteor.gd")
const Builder = preload("res://world_builder_runtime.gd")

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var builder: Node = game.world_builder
	var records: Array = []
	for i in 128:
		var x := -120.0 + float(i % 16) * 16.0
		var z := -112.0 + float(i / 16) * 32.0
		var at := Vector2(x, z)
		var record: Dictionary = Meteor.make_record(at, 9000 + i,
			game.landscape.height_at(at) - 1.4)
		record["id"] = "stress-%03d" % i
		record["phase"] = "landed"
		records.append(record)
	builder.data.meteors = records
	if not builder._valid(builder.data): failures.append("128 records rejected by save validation")
	var focus: Vector3 = builder.center + Vector3(-120.0, 3.0, -112.0)
	game.rig.global_position = focus
	var refresh_started := Time.get_ticks_usec()
	builder._refresh_meteor_visibility()
	var refresh_ms := float(Time.get_ticks_usec() - refresh_started) / 1000.0
	if builder.meteor_nodes.size() > Builder.MAX_NEAR_METEORS:
		failures.append("near meteor collider budget exceeded")
	if builder.distant_meteors.multimesh.instance_count + builder.meteor_nodes.size() != 128:
		failures.append("distant batch lost a meteor record")
	if not builder.meteor_nodes.has("stress-000"):
		failures.append("nearest meteor has no mineable collider")
	else:
		var near: Node3D = builder.meteor_nodes["stress-000"]
		if near.collider.process_mode == Node.PROCESS_MODE_DISABLED:
			failures.append("nearby meteor collider is disabled")
		var gem_position: Vector3 = near.gems[0].global_position
		if not builder.mine_meteor(near.collider, gem_position, "quarry_pick", 2.0):
			failures.append("nearby gem could not be mined")
		elif int(builder.data.meteors[0].veins[0]) != 1:
			failures.append("mining reward was not recorded")
	var path := "user://starfall_scaling_verification_%d.json" % Time.get_ticks_usec()
	builder.save_path = path
	builder.test_mode = false
	if not builder.save(): failures.append("128-record save failed")
	var reloaded: Node = Builder.new()
	root.add_child(reloaded)
	reloaded.save_path = path
	reloaded.data = Builder.fresh_state()
	reloaded._load()
	if reloaded.data.meteors.size() != 128 or int(reloaded.data.meteors[0].veins[0]) != 1 or reloaded.data.meteors[0].scars.size() != 1:
		failures.append("saved ore, scars or records did not reload")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
	game.rig.global_position = builder.center + Vector3(120.0, 3.0, 112.0)
	builder._refresh_meteor_visibility()
	if not builder.meteor_nodes.has("stress-127") or builder.meteor_nodes.has("stress-000"):
		failures.append("moving across the Orchard did not swap precise near colliders")
	# One in-flight rock tests that contact commits terrain in the same call.
	var impact_at := Vector2(10.0, 12.0)
	var before: float = game.landscape.height_at(impact_at)
	var falling: Dictionary = Meteor.make_record(impact_at, 19873, before)
	falling["id"] = "stress-impact"
	falling["phase"] = "falling"
	builder.data.meteors.append(falling)
	builder._render_meteor(falling, true)
	var started := Time.get_ticks_usec()
	builder.meteor_nodes["stress-impact"].advance(1.5)
	var impact_ms := float(Time.get_ticks_usec() - started) / 1000.0
	var after: float = game.landscape.height_at(impact_at)
	if after >= before - 1.0 or not game.landscape.transition.is_empty():
		failures.append("impact terrain was not committed at contact")
	if str(builder.data.meteors[-1].phase) != "landed":
		failures.append("impact phase was not recorded")
	await physics_frame
	var terrain_probe := impact_at + Vector2(5.0, 0.0)
	var point: Vector3 = builder.center + Vector3(terrain_probe.x, 0.0, terrain_probe.y)
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(
		PhysicsRayQueryParameters3D.create(point + Vector3.UP * 15.0,
			point + Vector3.DOWN * 15.0, 1))
	if hit.is_empty() or absf(float(hit.position.y) - (builder.center.y + game.landscape.height_at(terrain_probe))) > 0.35:
		failures.append("impact collider did not match the immediate terrain height")
	print("STARFALL_SCALING_RESULT ", JSON.stringify({"failures": failures,
		"records": 128, "near_nodes": builder.meteor_nodes.size(),
		"distant_instances": builder.distant_meteors.multimesh.instance_count,
		"refresh_ms": refresh_ms, "impact_call_ms": impact_ms}))
	quit(0 if failures.is_empty() else 1)
