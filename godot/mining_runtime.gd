extends Node
## Shared physical extraction/collection. World Builder owns the durable ledger.
const Pickups = preload("res://mining_pickups.gd")
const Deposits = preload("res://mining_deposits.gd")
const Hard = preload("res://hard_surface_contact.gd")
var game
var pickups: Node3D
var deposits: Node
var syncing := false
var retry_at := 0.0

func setup(owner_game) -> void:
	game = owner_game
	var data: Dictionary = game.world_builder.data
	for key in ["mining_pending", "mining_claimed", "mining_outbox"]:
		if not data.has(key): data[key] = []
	if not data.has("mining_deposits"): data.mining_deposits = {}
	if not data.has("mining_epoch"): data.mining_epoch = str(Time.get_ticks_usec())+"-"+str(int(Time.get_unix_time_from_system()))
	pickups = Pickups.new()
	pickups.setup(game, _credit, _pickup_art, game.camera)
	pickups.load_pending(data.mining_pending.filter(func(v): return str(v.id) not in data.mining_claimed))
	pickups.pending_changed.connect(_pending_changed)
	deposits = Deposits.new()
	add_child(deposits)
	deposits.setup(game)
	print("MINING_READY pending=", pickups.pending_count(), " claimed=", data.mining_claimed.size())

func tick(delta: float) -> void:
	pickups.tick(delta)
	deposits.tick(delta)
	if not syncing and not game.diagnostic_offline and game.elapsed >= retry_at and not game.world_builder.data.mining_outbox.is_empty():
		_flush_hero_reward()

func contact(item: Node3D, target: Node3D, point: Vector3, normal: Vector3, speed: float, region: String, hand) -> Dictionary:
	var motion: Vector3 = -normal * speed
	if hand == game.desktop_hand: motion = -game.camera.global_basis.z * speed
	elif game.melee.tracks.has(item.get_instance_id()):
		var previous: Vector3 = game.melee.tracks[item.get_instance_id()].get("previous", point)
		if point.distance_squared_to(previous) > 0.00001: motion = (point-previous).normalized() * speed
	var response := Hard.response(target,item,point,normal,motion,speed,region)
	response.incidence = float(response.get("entry", 1.0))
	if region == "working" and hand == game.desktop_hand: response.strike_region = "pick_point"
	if game.elapsed < float(item.get_meta("stonewhisper_charged_until", 0.0)):
		response.energy = float(response.get("energy",speed)) * 1.6
		game.item_actions._clear_pick_charge(item)
	return response

func strike(item: Node3D, target: Node3D, point: Vector3, normal: Vector3, speed: float, context: Dictionary) -> bool:
	if not can_extract(): return false
	var result: Dictionary = deposits.strike(item,target,point,normal,speed,context)
	target.set_meta("mining_last_result", result.get("damage_result", "contact"))
	if result.get("accepted", false): game.world_builder.save()
	if result.get("extracted", false):
		var reward := {"id":str(result.get("reward_id", "")), "kind":str(result.get("resource", "stone")), "units":int(result.get("amount",1)), "auto_collect":false}
		spawn_reward(reward,point,normal)
	return bool(result.get("accepted", result.get("ok", false)))

func can_extract() -> bool:
	if pickups.pending_count() < Pickups.MAX_PENDING: return true
	game._notice("Collect some loose mining chunks before breaking more free.", 2)
	return false

func spawn_reward(reward: Dictionary, point: Vector3, normal: Vector3) -> void:
	reward = reward.duplicate(true)
	reward.id = (str(game.world_builder.data.mining_epoch)+":"+str(reward.get("id",""))).sha256_text().substr(0,48)
	if str(reward.get("id", "")) in game.world_builder.data.mining_claimed: return
	pickups.spawn(reward, point, normal)
	game._notice("A %s chunk came free. E / free-hand grip to collect." % str(reward.kind).replace("meteor_gem","star-gem").replace("_"," "), 2)

func try_grab(hand: Node3D, desktop: bool) -> bool:
	return pickups.try_grab(hand,desktop,game.camera)

func _pending_changed(records: Array) -> void:
	game.world_builder.data.mining_pending = records
	game.world_builder.save()

func _credit(reward: Dictionary) -> bool:
	var data: Dictionary = game.world_builder.data
	var id := str(reward.id)
	if id in data.mining_claimed: return true
	if data.mining_claimed.size() >= 8192: return false
	var before := data.duplicate(true)
	var kind := str(reward.kind)
	var units := int(reward.units)
	if kind not in ["meteor_gem", "star_iron"] and data.mining_outbox.size() >= Pickups.MAX_PENDING:
		game._notice("The workshop connection is backed up. This chunk will wait here safely.", 3)
		return false
	if kind in ["meteor_gem", "star_iron"]:
		var key := "star_gems" if kind == "meteor_gem" else "star_iron"
		if int(data[key]) + units > 200:
			game._notice("Your star-material stockpile is full. Spend some before collecting.", 3)
			return false
		data[key] = int(data[key]) + units
	else:
		data.mining_outbox.append({"id":id,"resource":kind,"amount":units})
	data.mining_claimed.append(id)
	# Claim and pending removal are in the SAME atomic world save; service writes
	# use that stable ID and can be retried after a crash without duplicate credit.
	data.mining_pending = pickups.save_pending().filter(func(v): return str(v.id) != id)
	if not game.world_builder.save():
		game.world_builder.data = before
		return false
	var use := "Two focus Crystal Fault." if kind == "meteor_gem" else ("Two raise an Earthen Wall." if kind == "star_iron" else "Goes to your Hero pouch for Brann's workshop.")
	game._notice("Collected %d %s. %s" % [units,kind.replace("meteor_gem","star-gem").replace("_"," "),use], 3)
	if game.impact_feedback != null:
		game.impact_feedback.contact(null,game.camera.global_position,Vector3.UP,0.6,"quarry_pick","glass" if kind in ["crystal","meteor_gem"] else "metal")
	return true

func _flush_hero_reward() -> void:
	syncing = true
	var reward: Dictionary = game.world_builder.data.mining_outbox[0].duplicate(true)
	var response: Dictionary = await game._request("/api/vr/gather", reward)
	if not response.has("error"):
		game.world_builder.data.mining_outbox.erase(reward)
		game.world_builder.save()
		if game.quests != null: game.quests.ingest(response.get("rpg",{}),true)
		await game._poll()
	retry_at = game.elapsed + (10.0 if response.has("error") else 0.1)
	syncing = false

func _pickup_art(kind: String) -> Node3D:
	if not ResourceLoader.exists("res://mining_visual_art.gd"): return null
	var art = load("res://mining_visual_art.gd")
	var node := MeshInstance3D.new()
	node.mesh = art.crystal_mesh(3) if kind in ["meteor_gem","crystal"] else art.shell_chip_mesh(2)
	if kind in ["meteor_gem","crystal"]: node.position.y = -0.085
	return node
