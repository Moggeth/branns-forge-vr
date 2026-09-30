extends RefCounted
## Read-only snapshot for the Map / Supplies overlay. No save or service calls.
const Spells = preload("res://world_builder_spells.gd")
const Hints = preload("res://item_control_hints.gd")
const Interactions = preload("res://item_interactions.gd")
const DirectorView = preload("res://director_local_view.gd")

const HERO_MATERIALS := [
	["rat_tail", "Rat tails", "Tier 2 offering or Quickwind mechanism; five can earn a forging favour."],
	["lumber", "Lumber", "Three with three stone can open workshop tier 2. Separate from settlement timber."],
	["stone", "Stone", "Three with three Hero lumber can open workshop tier 2."],
	["iron", "Iron", "Tier 3 offering or Quickwind mechanism."],
	["apple", "Apples", "Eating fruit restores Hero health; Verdant restorative module."],
	["spore", "Spores", "Verdant restorative module."],
	["crystal", "Crystals", "Truesight optic module; separate from Starfall star gems."],
	["haunted_bone", "Haunted bones", "Tier 3 offering or Truesight optic module."],
	["sky_bloom", "Sky blooms", "Hearth ward module."],
	["ember_core", "Ember cores", "Tier 4 offering or Hearth ward module."],
]

static func build(game: Node) -> Dictionary:
	var result := {"equipment_line": "No item held", "wallets": [], "items": [], "costs": []}
	if game == null: return result
	var state: Dictionary = game.state if game.state is Dictionary else {}
	var hero_balance: Dictionary = state.get("resources", {}) if state.get("resources", {}) is Dictionary else {}
	var workshop_state: Dictionary = state.get("workshop", {}) if state.get("workshop", {}) is Dictionary else {}
	var hero_rows: Array[Dictionary] = []
	for spec in HERO_MATERIALS:
		var amount := int(state.get("tails", hero_balance.get("rat_tail", 0))) if spec[0] == "rat_tail" else int(hero_balance.get(spec[0], 0))
		hero_rows.append(_row(spec[1], str(amount) if game.online else "—", _material_use(workshop_state, spec)))
	var locations := _workshop_locations(workshop_state, game.workshop)
	hero_rows.append(_row("Reserved workshop offerings", _count_text(locations.bucket) if game.online else "—",
		"Already removed from the pouch and saved in the selected donation buckets. Pull the lever to commit, or withdraw them."))
	hero_rows.append(_row("Loose workshop pieces", _count_text(locations.loose) if game.online else "—",
		"Physical pieces already removed from the pouch; return them to the pouch or place them in a bucket."))
	hero_rows.append(_row("Held workshop pieces", _count_text(locations.held) if game.online else "—",
		"Physical pieces in a hand; also already removed from the pouch. These three location rows never add to the pouch count."))
	hero_rows.append(_row("Forging favours", str(int(state.get("favours", 0))) if game.online else "—",
		"Earn by handing five rat tails to Brann; used by eligible commissions."))
	hero_rows.append(_row("Workshop tier", "%d / 4" % int(state.get("tier", 1)) if game.online else "—",
		"Unlocks built-in tools and invention capabilities."))
	result.wallets.append({"title": "Hero pouch / Brann's workshop",
		"description": "One saved Hero ledger. Pouch, bucket, loose and held pieces are separate locations for the same materials; death drops carried pouch materials.",
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
		"description": "Take a belt bolt and load the crossbow, or draw an arrow from the back quiver."})
	return result

static func _material_use(workshop_state: Dictionary, spec: Array) -> String:
	for material in workshop_state.get("materials", []):
		if material is Dictionary and str(material.get("id", "")) == str(spec[0]):
			return str(material.get("use", spec[2]))
	return str(spec[2])

static func _workshop_locations(workshop_state: Dictionary, workshop: Node) -> Dictionary:
	var result := {"bucket": {}, "loose": {}, "held": {}}
	var held_ids: Dictionary = {}
	if workshop != null and workshop.held is Dictionary:
		for token_id in workshop.held.values(): held_ids[str(token_id)] = true
	for token in workshop_state.get("tokens", []):
		if not token is Dictionary: continue
		var resource := str(token.get("resource", ""))
		var place := str(token.get("place", ""))
		var group: String = "bucket" if place == "bucket" else ("held" if held_ids.has(str(token.get("id", ""))) else "loose")
		result[group][resource] = int(result[group].get(resource, 0)) + 1
	return result

static func _count_text(counts: Dictionary) -> String:
	if counts.is_empty(): return "None"
	var parts: Array[String] = []
	for resource in counts.keys(): parts.append("%s %d" % [str(resource).replace("_", " "), int(counts[resource])])
	parts.sort()
	return ", ".join(parts)

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
	var seen_ids: Dictionary = {}
	var owned: Dictionary = {}
	for spec in state.get("tools", []):
		if spec is Dictionary: owned[str(spec.get("id", ""))] = true
	var recipes: Dictionary = {}
	for spec in state.get("recipes", []):
		if spec is Dictionary: recipes[str(spec.get("id", ""))] = spec
	for id in game.adventure.ORDER:
		seen_ids[str(id)] = true
		var index: int = game.adventure.ORDER.find(id)
		var tier := 1 if index < 4 else (2 if index < 6 else (3 if id == "crystal_resonator" else 4))
		var recipe: Dictionary = recipes.get(id, {})
		var acquired: bool = index < 4 or bool(owned.get(id, false)) or bool(recipe.get("owned", false))
		var state_text := "Held" if held != null and str(held.get_meta("id", "")) == id else (
			"Owned" if acquired else ("Available · free to craft" if int(state.get("tier", 1)) >= tier else "Locked · workshop tier %d" % tier))
		var controls := _built_in_controls(id, game.vr, recipe)
		items.append({"name": str(game.adventure.TOOL_NAMES.get(id, id)), "state": state_text,
			"description": controls})
	for spec in state.get("items", []):
		if not spec is Dictionary: continue
		var id := str(spec.get("id", ""))
		seen_ids[id] = true
		var installed: bool = game.imported.has(id)
		var ready: bool = installed and bool(game.imported[id].get_meta("delivery_ready", true))
		var instructions := str(spec.get("useInstructions", "")).strip_edges()
		if instructions == "" and installed:
			instructions = str(game.imported[id].get_meta("use_instructions", "")).strip_edges()
		if instructions == "": instructions = str(spec.get("requestedFunction", "")).strip_edges()
		if instructions == "": instructions = str(spec.get("description", "")).strip_edges()
		if instructions == "": instructions = "Brann has not supplied use instructions for this delivery; inspect or refine it at the workshop."
		items.append({"name": str(spec.get("name", id)),
			"state": "Held" if held != null and str(held.get_meta("id", "")) == id else ("Ready to equip" if ready else "Brann is finishing it"),
			"description": instructions})
	if game.collection != null:
		for id in game.collection.homes.keys():
			var home: Dictionary = game.collection.homes[id]
			_native_item(game, home.get("item"), str(id), seen_ids, items)
	if game.siegebird != null:
		for weapon in game.siegebird.weapons:
			if weapon is Dictionary:
				_native_item(game, weapon.get("item"), "siegebird", seen_ids, items)
	if game.archery != null: _native_item(game, game.archery.bow, "emberwing", seen_ids, items)
	if game.skull_basket != null:
		var basket: Node3D = game.skull_basket.basket
		if is_instance_valid(basket):
			_native_item(game, basket, "skull_basket", seen_ids, items,
				"Stores %d / 3 physical skeleton skulls for Brann's first job. FPS: F stores/takes; VR: release a skull into the opening." % game.skull_basket.contents.size())
	if game.hearth_torch != null:
		_native_item(game, game.hearth_torch.torch, "hearthlight", seen_ids, items,
			"Carry for light; fuel and flame are managed on the physical torch.")
	if game.firecraft != null:
		_native_item(game, game.firecraft.box, "emberdew_matchbox", seen_ids, items,
			"Free refillable matches. Open the drawer, strike a match, then light a vial wick.")
		var matches := 0
		var vials := 0
		for prop in game.firecraft.props:
			if not is_instance_valid(prop): continue
			if str(prop.get_meta("fire_kind", "")) == "match": matches += 1
			elif str(prop.get_meta("fire_kind", "")) == "vial": vials += 1
		items.append({"name": "Emberdew matches", "state": "%d physical matches in the world" % matches,
			"description": "Free refills at the forge; a lit match lasts about 10 seconds."})
		items.append({"name": "Emberdew vials", "state": "%d physical vials in the world" % vials,
			"description": "Free refills at the forge. Light the wick, then throw; fire defeats ghosts."})
	if held != null:
		_native_item(game, held, str(held.get_meta("id", held.name)), seen_ids, items)

static func _native_item(game: Node, value: Variant, fallback_id: String,
		seen_ids: Dictionary, items: Array, explicit_description: String = "") -> void:
	if not value is Node3D or not is_instance_valid(value): return
	var item: Node3D = value
	var id := str(item.get_meta("id", fallback_id))
	if seen_ids.has(id): return
	seen_ids[id] = true
	var state := "Held" if item in game.held.values() else (
		"On belt" if game.grips != null and game.grips.is_stowed(item) else (
			"At collection stand" if game.collection != null and item.get_parent() == game.collection.root else "In world"))
	var description := explicit_description
	if description == "":
		description = str(item.get_meta("use_instructions", item.get_meta("description", ""))).strip_edges()
	if description == "":
		if Hints.has(id):
			description = Hints.vr(game, item) if game.vr else Hints.desktop(game, item, game.desktop_hand)
		elif Interactions.CONTROLS.has(id):
			description = str(Interactions.CONTROLS[id])
		else:
			description = "Grip from the collection; this creation has no authored action instructions yet."
	items.append({"name": str(item.get_meta("display_name", item.get_meta("title", item.name))),
		"state": state, "description": description})

static func _built_in_controls(id: String, vr: bool, recipe: Dictionary) -> String:
	if id == "bomb_glove":
		return "Grip an empty hand, hold trigger to form a bomb, then release grip to throw." if vr else "Hold LMB with an empty hand to form Pocket Thunder; release to throw."
	var controls := str(Hints.VR.get(id, "")) if vr else str(Hints.DESKTOP.get(id, ""))
	if controls != "": return controls
	if Interactions.CONTROLS.has(id): return str(Interactions.CONTROLS[id])
	controls = str(recipe.get("description", "")).strip_edges()
	return controls if controls != "" else "This tool has no authored control description; inspect it at Brann's workshop."

static func _build_hero_costs(game: Node, state: Dictionary, balance: Dictionary, costs: Array) -> void:
	var tier := int(state.get("tier", 1))
	var workshop_state: Dictionary = state.get("workshop", {})
	var donations: Dictionary = workshop_state.get("donations", {})
	var selected := int(donations.get("option", 0))
	var donated: Dictionary = donations.get("counts", {})
	var reserved_total := 0
	for amount in donated.values(): reserved_total += int(amount)
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
				parts.append("%s: pouch %d + bucket %d / %d" % [str(resource).replace("_", " "), have, placed, int(option[resource])])
				if have + placed < int(option[resource]): affordable = false
			var fully_offered := i == selected
			for resource in option:
				if int(donated.get(resource, 0)) != int(option[resource]): fully_offered = false
			var status := "Withdraw offerings to change option" if i != selected and reserved_total > 0 else (
				"Ready to pull lever" if fully_offered else ("Can fill buckets" if affordable else "Need materials"))
			costs.append({"name": "Workshop tier %d · option %d" % [tier + 1, i + 1],
				"cost": " + ".join(parts),
				"state": status,
				"description": "Pouch, loose pieces and reserved bucket pieces are the same Hero materials. Select this option, fill its buckets, then pull the lever."})
	for module in workshop_state.get("catalog", []):
		if not module is Dictionary: continue
		var ingredients: Dictionary = module.get("costs", {})
		var text_parts: Array[String] = []
		var affordable := true
		for resource in ingredients:
			var have: int = int(state.get("tails", 0)) if resource == "rat_tail" else int(balance.get(resource, 0))
			text_parts.append("%s %d/%d" % [str(resource).replace("_", " "), have, int(ingredients[resource])])
			if have < int(ingredients[resource]): affordable = false
		costs.append({"name": str(module.get("name", "Workshop module")),
			"cost": " + ".join(text_parts),
			"state": "Requires workshop tier %d" % int(module.get("tier", 1)) if tier < int(module.get("tier", 1)) else ("Materials ready" if affordable else "Need materials"),
			"description": str(module.get("description", "Craft at Brann's workshop."))})
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
