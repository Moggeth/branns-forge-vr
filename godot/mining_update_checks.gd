extends SceneTree
## End-to-end source game, offline fixture. No resident save/service calls.
var failures: Array[String] = []
var started := Time.get_ticks_usec()
func _initialize() -> void:
	if not OS.get_cmdline_user_args().has("--world-builder-check"): quit(2); return
	call_deferred("_run")

func _run() -> void:
	create_timer(40.0).timeout.connect(func(): quit(2))
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	await physics_frame
	game.set_process(false)
	game.adventure.hp = 9999
	var builder = game.world_builder
	var err: String = builder.cast_meteor(Vector3(38,0,32))
	if err != "": failures.append(err); _finish(); return
	var meteor = builder.meteor_nodes.values()[-1]
	game.rig.global_position = meteor.global_position+Vector3(0,4,4)
	meteor.advance(1.3)
	game.landscape._finish_transition()
	# Landing seats the shell with a 1.1 s tween; publish the final collider pose.
	await create_timer(1.2).timeout
	await physics_frame
	var point: Vector3 = meteor.gems[0].global_position
	var normal: Vector3 = (point - meteor.core.global_position).normalized()
	var ray := PhysicsRayQueryParameters3D.create(point+normal*3,meteor.core.global_position)
	var hit: Dictionary = game.get_world_3d().direct_space_state.intersect_ray(ray)
	if hit.get("collider") == meteor.collider:
		point = hit.position; normal = hit.normal
	else:
		# Some peripheral seams are below the bank; use the exposed upper facet.
		hit = game.get_world_3d().direct_space_state.intersect_ray(PhysicsRayQueryParameters3D.create(meteor.core.global_position+Vector3.UP*5,meteor.core.global_position))
		if hit.get("collider") == meteor.collider:
			point = hit.position; normal = hit.normal
		else:
			failures.append("no actual meteor facet contact")
			print("MINING_CONTACT_DIAG hit=",hit," meteor=",meteor.collider.global_transform," layer=",meteor.collider.collision_layer)
	var old_gems: int = builder.data.star_gems
	var old_ore: int = builder.data.star_iron
	var context := {"energy":2.0,"incidence":0.9,"strike_region":"pick_point"}
	for i in 10:
		if game.mining.pickups.pending_count()>0: break
		builder.mine_meteor(meteor.collider,point,"quarry_pick",3.0,normal,context)
		if i==0 and game.mining.pickups.pending_count()!=0: failures.append("instant extraction on first hit")
	if game.mining.pickups.pending_count()!=1: failures.append("did not free exactly one physical chunk")
	if builder.data.star_gems!=old_gems or builder.data.star_iron!=old_ore: failures.append("resources credited before collection")
	if meteor.record.scars.is_empty(): failures.append("no persistent mining scar")
	if not builder._valid(JSON.parse_string(JSON.stringify(builder.data))):
		failures.append("mining world save invalid")
		print("MINING_SAVE_DIAG pending=",preload("res://mining_pickups.gd").valid_records(builder.data.mining_pending)," deposits=",preload("res://mining_deposits.gd").valid_records(builder.data.mining_deposits)," meteor=",preload("res://landscape_meteor.gd")._valid_record(meteor.to_record())," record=",JSON.stringify(meteor.to_record()))
	var pending: Array = game.mining.pickups.save_pending()
	game.mining.pickups.load_pending(pending)
	var body = game.mining.pickups.active.values()[0] if not game.mining.pickups.active.is_empty() else null
	if body==null or not game.mining.pickups.collect(body): failures.append("reloaded chunk not collectible")
	if game.mining.pickups.collect(body): failures.append("chunk credited twice")
	if int(builder.data.star_gems)+int(builder.data.star_iron)!=old_gems+old_ore+1: failures.append("collection ledger not once-only")
	if game.mining.pickups.pending_count()!=0: failures.append("collected reward remained pending")
	var credit_id: String = builder.data.mining_claimed[-1] if not builder.data.mining_claimed.is_empty() else ""
	if credit_id.is_empty(): failures.append("missing durable claim identity")
	# Persistence restored independently of transient scene object IDs.
	var loaded = preload("res://landscape_meteor.gd").new()
	game.add_child(loaded); loaded.setup(meteor.to_record(),false)
	if JSON.stringify(loaded.to_record())!=JSON.stringify(meteor.to_record()): failures.append("meteor roundtrip changed state")
	var tool: Node3D = game.adventure._tool_model("quarry_pick")
	game.add_child(tool)
	for group in game.adventure.zone_groups.values(): group.visible = true
	var deposit = game.scene.resources.filter(func(v): return v.get_meta("requires","") in ["pick","mine"] and v.is_visible_in_tree())[0]
	var at: Vector3 = deposit.global_position+Vector3.UP*.4
	var result: Dictionary = game.mining.deposits.strike(tool,deposit,at,Vector3.UP,3.0,{"energy":4.0,"incidence":1.0,"strike_region":"shaft"})
	if result.get("accepted",false): failures.append("shaft mined ordinary deposit")
	for i in 10:
		result = game.mining.deposits.strike(tool,deposit,at,Vector3.UP,3.0,context)
		if result.get("extracted",false): break
	if not result.get("extracted",false) or str(result.get("reward_id","")).is_empty(): failures.append("ordinary ore staged extraction failed")
	if not builder._valid(JSON.parse_string(JSON.stringify(builder.data))): failures.append("ordinary deposit save invalid")
	loaded.queue_free(); tool.queue_free(); game.queue_free()
	await process_frame
	_finish()

func _finish() -> void:
	print("MINING_UPDATE_RESULT ",JSON.stringify({"failures":failures,"elapsed_ms":(Time.get_ticks_usec()-started)/1000.0}))
	quit(0 if failures.is_empty() else 1)
