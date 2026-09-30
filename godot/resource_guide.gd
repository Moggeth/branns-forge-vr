extends RefCounted
## Read-only snapshot for the Map / Supplies overlay. No save or service calls.
const Spells = preload("res://world_builder_spells.gd")
const Hints = preload("res://item_control_hints.gd")
const DirectorView = preload("res://director_local_view.gd")

const HERO_MATERIALS := [
	["rat_tail", "Rat tails", "Three open the first workshop tier; five can earn a forging favour at Brann."],
	["lumber", "Lumber", "Three with three stone can open workshop tier 2. Separate from settlement timber."],
	["stone", "Stone", "Three with three Hero lumber can open workshop tier 2."],
	["iron", "Iron", "Three with three haunted bones can open workshop tier 3."],
	["apple", "Apples", "Eating collected fruit restores Hero health."],
	["spore", "Spores", "Gathered expedition material; no current workshop tier cost."],
	["crystal", "Crystals", "Gathered expedition material; not a Starfall star gem."],
	["haunted_bone", "Haunted bones", "Three with three iron can open workshop tier 3."],
	["sky_bloom", "Sky blooms", "Gathered expedition material; no current workshop tier cost."],
	["ember_core", "Ember cores", "One from the Ember Warden can open workshop tier 4."],
]

static func build(game: Node) -> Dictionary:
	var result := {"equipment_line": "No item held", "wallets": [], "items": [], "costs": []}
	if game == null: return result
	var state: Dictionary = game.state if game.state is Dictionary else {}
	var hero_balance: Dictionary = state.get("resources", {}) if state.get("resources", {}) is Dictionary else {}
	var hero_rows: Array[Dictionary] = []
	for spec in HERO_MATERIALS:
		var amount := int(state.get("tails", hero_balance.get("rat_tail", 0))) if spec[0] == "rat_tail" else int(hero_balance.get(spec[0], 0))
		hero_rows.append(_row(spec[1], str(amount) if game.online else "—", spec[2]))
	hero_rows.append(_row("Forging favours", str(int(state.get("favours", 0))) if game.online else "—",
		"Earn by handing five rat tails to Brann; used by eligible commissions."))
	hero_rows.append(_row("Workshop tier", "%d / 4" % int(state.get("tier", 1)) if game.online else "—",
		"Unlocks built-in tools and invention capabilities."))
	result.wallets.append({"title": "Hero pouch / Brann's workshop",
		"description": "Saved by the forge service. Death drops carried materials in a recoverable satchel.",
		"rows": hero_rows})
	var builder: Node = game.world_builder
	if builder != null:
		var b: Dictionary = builder.data
		var mana := "%.1f / 20" % float(b.get("mana", 0.0))
		result.wallets.append({"title": "Orchard settlement",
			"description": "Separate saved ledger. Hero pouch lumber and crystals cannot pay these costs.",
			"rows": [
				_row("Mana", mana, "Regenerates; pays for land, life and encounter spells."),
				_row("Stockpile lumber", str(int(b.get("wood", 0))), "Delivered by helpers or recovered physical timber; builds structures and hires helpers."),
				_row("Star gems", str(int(b.get("star_gems", 0))), "Mined from Starfall; two plus 2 Mana raise a Crystal Fault."),
				_row("Star iron", str(int(b.get("star_iron", 0))), "Mined from Starfall; two build an Earthen Wall before Mana is used."),
				_row("Ent seeds", str(b.get("ent_seeds", []).size()), "Recovered from fallen Ents; one plants a magical tree.")
			]})
	var fairy: Node = game.fairy
	result.wallets.append({"title": "Little Wing",
		"description": "Local fairy actions use time gates, not Hero or settlement currency.",
		"rows": [_row("Health", "%d / 18" % ceili(float(fairy.health)) if fairy != null else "Not active",
			"Respawns locally; darts, dust and reveal spend no material.")]})
	var view: Node = game.director_local_view
	result.wallets.append({"title": "War Director round",
		"description": "Sparks are round-only and never exchange for Orchard Mana.",
		"rows": [_row("Sparks", "%.1f / 10" % float(view.budget) if view != null else "No local round",
			"Start at 8; regenerate 0.55 per second while a round runs.")]})
	result.equipment_line = _equipment_line(game)
	_build_items(game, state, result.items)
	_build_hero_costs(game, state, hero_balance, result.costs)
	_build_builder_costs(builder, result.costs)
	_build_fairy_costs(game, fairy, result.costs)
	_build_director_costs(game, view, result.costs)
	result.costs.append({"name": "Siegebird bolts / Emberwing arrows", "cost": "Free, unlimited",
		"state": "Physical loading/drawing still required",
		"description": "Bolt tokens track held/loaded/fired objects; legacy available=6 is not remaining ammo."})
	return result

static func _row(name: String, amount: String, purpose: String) -> Dictionary:
	return {"name": name, "amount": amount, "purpose": purpose}

static func _held_item(game: Node) -> Node3D:
	if game.held is Dictionary:
		if not game.vr and game.desktop_hand != null:
			var desktop: Variant = game.held.get(str(game.desktop_hand.get_instance_id()))
			if desktop is Node3D and is_instance_valid(desktop): return desktop
		for value in game.held.values():
			if value is Node3D and is_instance_valid(value): return value
	return null

static func _equipment_line(game: Node) -> String:
	var item := _held_item(game)
	if item != null:
		var title := str(item.get_meta("display_name", item.get_meta("id", item.name)))
		var controls: String = Hints.vr(game, item) if game.vr else Hints.desktop(game, item, game.desktop_hand)
		return "Held: %s · %s" % [title, controls]
	if game.adventure != null and str(game.adventure.selected) == "bomb_glove":
		return "Selected: Pocket Thunder · form in an empty hand; release to throw"
	return "No item held · Tools menu / number keys equip owned tools"

static func _build_items(game: Node, state: Dictionary, items: Array) -> void:
	if game.adventure == null: return
	var held := _held_item(game)
	var owned: Dictionary = {}
	for spec in state.get("tools", []):
		if spec is Dictionary: owned[str(spec.get("id", ""))] = true
	var recipes: Dictionary = {}
	for spec in state.get("recipes", []):
		if spec is Dictionary: recipes[str(spec.get("id", ""))] = spec
	for id in game.adventure.ORDER:
		var index: int = game.adventure.ORDER.find(id)
		var tier := 1 if index < 4 else (2 if index < 6 else (3 if id == "crystal_resonator" else 4))
		var recipe: Dictionary = recipes.get(id, {})
		var acquired: bool = index < 4 or bool(owned.get(id, false)) or bool(recipe.get("owned", false))
		var state_text := "Held" if held != null and str(held.get_meta("id", "")) == id else (
			"Owned" if acquired else ("Available · free to craft" if int(state.get("tier", 1)) >= tier else "Locked · workshop tier %d" % tier))
		var controls := str(Hints.VR.get(id, "")) if game.vr else str(Hints.DESKTOP.get(id, ""))
		items.append({"name": str(game.adventure.TOOL_NAMES.get(id, id)), "state": state_text,
			"description": controls})
	for spec in state.get("items", []):
		if not spec is Dictionary: continue
		var id := str(spec.get("id", ""))
		var installed: bool = game.imported.has(id)
		var ready: bool = installed and bool(game.imported[id].get_meta("delivery_ready", true))
		items.append({"name": str(spec.get("name", id)),
			"state": "Held" if held != null and str(held.get_meta("id", "")) == id else ("Ready to equip" if ready else "Brann is finishing it"),
			"description": str(spec.get("useInstructions", spec.get("description", "Inspect in Inventions.")))})
	if held != null and not game.adventure.TOOL_NAMES.has(str(held.get_meta("id", ""))):
		var found := false
		for entry in items:
			if str(entry.name) == str(held.get_meta("display_name", "")): found = true
		if not found:
			items.append({"name": str(held.get_meta("display_name", held.name)), "state": "Held",
				"description": Hints.vr(game, held) if game.vr else Hints.desktop(game, held, game.desktop_hand)})

static func _build_hero_costs(game: Node, state: Dictionary, balance: Dictionary, costs: Array) -> void:
	var tier := int(state.get("tier", 1))
	var donations: Dictionary = state.get("workshop", {}).get("donations", {})
	var selected := int(donations.get("option", 0))
	var donated: Dictionary = donations.get("counts", {})
	for upgrade in state.get("upgrades", []):
		if not upgrade is Dictionary or int(upgrade.get("tier", 0)) != tier + 1: continue
		var options: Array = upgrade.get("costs", [])
		for i in options.size():
			var option: Dictionary = options[i]
			var parts: Array[String] = []
			var affordable := true
			for resource in option:
				var have: int = int(state.get("tails", 0)) if resource == "rat_tail" else int(balance.get(resource, 0))
				var placed: int = int(donated.get(resource, 0)) if i == selected else 0
				parts.append("%s %d/%d" % [str(resource).replace("_", " "), have + placed, int(option[resource])])
				if have + placed < int(option[resource]): affordable = false
			costs.append({"name": "Workshop tier %d · option %d" % [tier + 1, i + 1],
				"cost": " + ".join(parts),
				"state": "Ready to donate at Brann" if affordable else "Need materials",
				"description": "Use the physical pouch, buckets and lever. Select this option at the workshop."})
	if tier >= 4:
		costs.append({"name": "Workshop tiers", "cost": "Complete", "state": "All tiers unlocked", "description": "Built-in recipes stay free."})
	if not game.online:
		costs.append({"name": "Forge service", "cost": "—", "state": "Offline",
			"description": "Saved Hero balances and workshop availability require the forge service."})

static func _build_builder_costs(builder: Node, costs: Array) -> void:
	if builder == null: return
	for entry in Spells.catalogue():
		var action := str(entry.id)
		var reason: String = builder.spell_availability(action)
		if reason == "" and action == "meteor" and builder.game.landscape.operation_count() >= builder.game.landscape.MAX_OPERATIONS:
			reason = "The landscape cannot record another impact."
		var detail := str(entry.get("description", ""))
		if action in ["path", "bridge", "ramp", "stairs", "boardwalk"]:
			detail += " Exact cost and terrain restrictions appear at placement."
		if action == "wall": detail += " Two star iron are used before the 4 Mana alternative."
		if action == "meteor": detail += " Requires room in the durable terrain-operation journal."
		costs.append({"name": str(entry.title), "cost": str(entry.cost),
			"state": reason if reason != "" else "Ready · valid placement required",
			"description": detail})

static func _build_fairy_costs(game: Node, fairy: Node, costs: Array) -> void:
	var now := float(game.elapsed)
	for spec in [["Fairy dart", 0.4, "next_shot", "Damages enemies; no ammo."],
		["Dust mark", 0.45, "next_ping", "Marks a place briefly; no materials."],
		["Faelight reveal", 5.0, "next_reveal", "Shows nearby weak points/secrets; no materials."]]:
		var status := "Little Wing not active"
		if fairy != null:
			var remaining := maxf(0.0, float(fairy.get(spec[2])) - now)
			status = "Resting" if float(fairy.health) <= 0.0 else ("Ready" if remaining <= 0.0 else "Recharges in %.1f s" % remaining)
		costs.append({"name": spec[0], "cost": "Free · %.2f s action timer" % float(spec[1]),
			"state": status, "description": spec[3]})

static func _build_director_costs(game: Node, view: Node, costs: Array) -> void:
	for kind in DirectorView.CARD_ORDER:
		var card: Dictionary = DirectorView.CARDS[kind]
		var status := "Open a War Director round"
		if view != null and game.director != null:
			var live := 0
			for warning in game.director.warnings:
				live += 2 if str(warning.type) in ["skeletons", "wisps"] else 1
			for enemy in game.director.summons:
				if is_instance_valid(enemy) and bool(enemy.get_meta("alive", true)): live += 1
			var remaining := maxf(0.0, float(view.ready_at.get(kind, 0.0)) - float(view.ui_elapsed))
			if str(game.director.phase) != "running": status = "Begin the round first" if str(game.director.phase) == "waiting" else "Round over"
			elif remaining > 0.0: status = "Recharges in %.1f s" % remaining
			elif float(view.budget) < float(card.cost): status = "Need %.1f more Sparks" % (float(card.cost) - float(view.budget))
			elif int(card.count) > 0 and live + int(card.count) > 9: status = "Too many enemies on the field"
			else: status = "Ready · choose an approach"
		costs.append({"name": str(card.name).capitalize(),
			"cost": "%d Sparks · %.0f s cooldown" % [int(card.cost), float(card.cooldown)],
			"state": status, "description": "War Director Sparks are separate from Orchard Mana."})
