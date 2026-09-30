extends SceneTree
## Full native scene, synthetic snapshot; no network calls or player save writes.
const Guide = preload("res://resource_guide.gd")

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	game.state = {"tier": 2, "tails": 4, "favours": 1,
		"resources": {"rat_tail": 4, "lumber": 5, "stone": 2, "iron": 1,
			"apple": 3, "spore": 0, "crystal": 6, "haunted_bone": 0,
			"sky_bloom": 0, "ember_core": 0},
		"tools": [{"id": "grappling_hook"}], "recipes": [], "items": [],
		"upgrades": [{"tier": 3, "name": "The enchanted anvil",
			"costs": [{"iron": 3, "haunted_bone": 3}]}],
		"workshop": {"donations": {"option": 0, "counts": {"iron": 1}},
			"tokens": [
				{"id": "bucket-iron", "resource": "iron", "place": "bucket"},
				{"id": "loose-crystal", "resource": "crystal", "place": "loose"},
				{"id": "held-spore", "resource": "spore", "place": "loose"}],
			"materials": [{"id": "spore", "use": "Verdant restorative module."}],
			"catalog": [{"name": "Truesight", "tier": 3, "costs": {"crystal": 2, "haunted_bone": 1},
				"description": "Weak-point optic module."}]}}
	game.workshop.held["test-hand"] = "held-spore"
	game.online = true
	game.world_builder.data.mana = 1.0
	game.world_builder.data.wood = 7
	game.world_builder.data.star_gems = 2
	game.world_builder.data.star_iron = 3
	var result: Dictionary = Guide.build(game)
	if result.wallets.size() != 4: failures.append("wallet ownership sections missing")
	var hero: Dictionary = result.wallets[0]
	var orchard: Dictionary = result.wallets[1]
	if _amount(hero.rows, "Lumber") != "5" or _amount(orchard.rows, "Stockpile lumber") != "7":
		failures.append("Hero and settlement lumber were merged")
	if _amount(hero.rows, "Crystals") != "6" or _amount(orchard.rows, "Star gems") != "2":
		failures.append("ordinary crystals and Starfall gems were merged")
	if hero.rows.size() != 15 or _amount(hero.rows, "Spores") != "0":
		failures.append("full zero-inclusive Hero wallet missing")
	if _amount(hero.rows, "Reserved workshop offerings") != "iron 1" or _amount(hero.rows, "Loose workshop pieces") != "crystal 1" or _amount(hero.rows, "Held workshop pieces") != "spore 1":
		failures.append("physical workshop pieces were merged or double counted")
	if not str(hero.description).contains("same materials"):
		failures.append("workshop bucket ownership is unexplained")
	if _state(result.costs, "Truesight").find("tier 3") < 0:
		failures.append("module tier requirement missing")
	if _state(result.costs, "Workshop tier 3 · option 1") != "Need materials":
		failures.append("workshop donation count did not affect cost")
	if _state(result.costs, "Starfall").find("8 Mana") < 0:
		failures.append("spell availability reason was not sampled")
	if _state(result.costs, "Earthen Wall").find("Ready") < 0:
		failures.append("star iron alternative was not recognised")
	game.world_builder.data.spell_cooldowns["raise"] = 3.5
	if _state(Guide.build(game).costs, "Raise Earth").find("recharges") < 0:
		failures.append("native spell cooldown reason missing")
	game.world_builder.data.spell_cooldowns.erase("raise")
	if _state(result.costs, "Outpost").find("not available") < 0:
		failures.append("unimplemented action appears usable")
	if _state(result.costs, "Siegebird bolts / Emberwing arrows").find("Physical") < 0:
		failures.append("unlimited ammunition boundary missing")
	if result.items.size() < 15 or str(result.equipment_line).is_empty():
		failures.append("equipment catalogue or controls missing")
	if not _description(result.items, "Pocket Thunder").contains("LMB"):
		failures.append("Pocket Thunder desktop use is blank or omits the actual input")
	game.vr = true
	if not _description(Guide.build(game).items, "Pocket Thunder").contains("trigger"):
		failures.append("Pocket Thunder VR use is blank or omits the actual input")
	game.vr = false
	for entry in result.items:
		if str(entry.get("description", "")).strip_edges() == "":
			failures.append("empty item use: " + str(entry.get("name", "")))
	for native_name in ["Emberwing", "Hearthlight", "Emberdew matches", "Emberdew vials"]:
		if _state(result.items, native_name) == "missing": failures.append("native item omitted: " + native_name)
	if _state(result.items, "Skull basket · E carry/drop · F store/take") == "missing":
		failures.append("quest basket omitted")
	var invented: Array = [
		{"id": "wyrm-v1", "name": "Wyrm Spout v1"},
		{"id": "wyrm-v2", "name": "Wyrm Spout v2"},
		{"id": "sunfall-test", "name": "Sunfall Sledge"}]
	for spec in invented:
		var native := Node3D.new()
		native.set_meta("id", spec.id)
		native.set_meta("display_name", spec.name)
		native.set_meta("use_instructions", "Native generated item controls")
		game.add_child(native)
		game.imported[spec.id] = native
		game.state.items.append({"id": spec.id, "name": spec.name,
			"useInstructions": "Native generated item controls"})
	result = Guide.build(game)
	for spec in invented:
		if _state(result.items, spec.name) != "Ready to equip": failures.append("generated item omitted: " + spec.name)
	var crossbow := Node3D.new()
	crossbow.set_meta("id", "20dc22c5-7bcc-43df-b07f-e81eab521b0f")
	crossbow.set_meta("display_name", "Siegebird")
	crossbow.set_meta("use_instructions", "Crank and seat a free belt bolt")
	game.add_child(crossbow)
	game.siegebird.weapons.append({"item": crossbow})
	result = Guide.build(game)
	if _state(result.items, "Siegebird") == "missing": failures.append("native crossbow omitted")
	if str(result.costs[-1].description).contains("available=6") or str(result.costs[-1].description).contains("legacy"):
		failures.append("implementation-era ammo field leaked into product copy")
	game.state.resources.iron = 0
	game.state.resources.haunted_bone = 0
	game.state.workshop.tokens = []
	for i in 3:
		game.state.workshop.tokens.append({"id": "iron-%d" % i, "resource": "iron", "place": "bucket"})
		game.state.workshop.tokens.append({"id": "bone-%d" % i, "resource": "haunted_bone", "place": "bucket"})
	game.state.workshop.donations.counts = {"iron": 3, "haunted_bone": 3}
	result = Guide.build(game)
	if _state(result.costs, "Workshop tier 3 · option 1") != "Ready to pull lever" or _amount(result.wallets[0].rows, "Iron") != "0":
		failures.append("fully reserved offering was not ready or doubled into pouch")
	var held_pick := Node3D.new()
	held_pick.set_meta("id", "quarry_pick")
	held_pick.set_meta("display_name", "Stonewhisper")
	game.add_child(held_pick)
	game.held[str(game.desktop_hand.get_instance_id())] = held_pick
	result = Guide.build(game)
	if not str(result.equipment_line).contains("RMB charge resonance") or _state(result.items, "Stonewhisper") != "Held":
		failures.append("held tool name and actual control hints missing")
	game.held.erase(str(game.desktop_hand.get_instance_id()))
	game.online = false
	result = Guide.build(game)
	if _amount(result.wallets[0].rows, "Lumber") != "—":
		failures.append("offline Hero balance was presented as authoritative zero")
	game.online = true
	var fairy: Node = load("res://fairy_coop.gd").new()
	game.add_child(fairy)
	game.fairy = fairy
	fairy.next_reveal = game.elapsed + 3.0
	var director: Node = load("res://director_runtime.gd").new()
	game.add_child(director)
	game.director = director
	var view: Window = load("res://director_local_view.gd").new()
	view.visible = false
	game.add_child(view)
	game.director_local_view = view
	view.budget = 1.0
	director.phase = "running"
	result = Guide.build(game)
	if _state(result.costs, "Faelight reveal").find("Recharges") < 0:
		failures.append("fairy action timer missing")
	if _state(result.costs, "Bone Patrol").find("Need 2.0 more Sparks") < 0:
		failures.append("Director Sparks affordability missing")
	view.budget = 10.0
	view.ready_at["golem"] = view.ui_elapsed + 4.0
	result = Guide.build(game)
	if _state(result.costs, "Stone Sentinel").find("Recharges") < 0:
		failures.append("Director card cooldown missing")
	view.ready_at.clear()
	for i in 4: director.warnings.append({"type": "skeletons"})
	result = Guide.build(game)
	if _state(result.costs, "Bone Patrol").find("Too many enemies") < 0:
		failures.append("Director field-cap reason missing")
	print("RESOURCE_GUIDE_RESULT ", JSON.stringify({"failures": failures,
		"wallets": result.wallets.size(), "items": result.items.size(),
		"costs": result.costs.size()}))
	game.queue_free()
	await process_frame
	quit(0 if failures.is_empty() else 1)

func _amount(rows: Array, name: String) -> String:
	for row in rows:
		if str(row.get("name", "")) == name: return str(row.get("amount", ""))
	return "missing"

func _state(rows: Array, name: String) -> String:
	for row in rows:
		if str(row.get("name", "")) == name: return str(row.get("state", ""))
	return "missing"

func _description(rows: Array, name: String) -> String:
	for row in rows:
		if str(row.get("name", "")) == name: return str(row.get("description", ""))
	return "missing"
