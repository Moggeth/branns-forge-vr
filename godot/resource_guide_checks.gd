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
		"workshop": {"donations": {"option": 0, "counts": {"iron": 1}}}}
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
	if hero.rows.size() != 12 or _amount(hero.rows, "Spores") != "0":
		failures.append("full zero-inclusive Hero wallet missing")
	if _state(result.costs, "Workshop tier 3 · option 1") != "Need materials":
		failures.append("workshop donation count did not affect cost")
	if _state(result.costs, "Starfall").find("8 Mana") < 0:
		failures.append("spell availability reason was not sampled")
	if _state(result.costs, "Earthen Wall").find("Ready") < 0:
		failures.append("star iron alternative was not recognised")
	if _state(result.costs, "Outpost").find("not available") < 0:
		failures.append("unimplemented action appears usable")
	if _state(result.costs, "Siegebird bolts / Emberwing arrows").find("Physical") < 0:
		failures.append("unlimited ammunition boundary missing")
	if result.items.size() < 8 or str(result.equipment_line).is_empty():
		failures.append("equipment catalogue or controls missing")
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
	print("RESOURCE_GUIDE_RESULT ", JSON.stringify({"failures": failures,
		"wallets": result.wallets.size(), "items": result.items.size(),
		"costs": result.costs.size()}))
	quit(0 if failures.is_empty() else 1)

func _amount(rows: Array, name: String) -> String:
	for row in rows:
		if str(row.get("name", "")) == name: return str(row.get("amount", ""))
	return "missing"

func _state(rows: Array, name: String) -> String:
	for row in rows:
		if str(row.get("name", "")) == name: return str(row.get("state", ""))
	return "missing"
