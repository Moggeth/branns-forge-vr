extends RefCounted
## One catalogue for the map, keyboard palette, and runtime spell checks.

const ENTRIES = [
	{"id":"path", "title":"Carve Path", "palette":"Land", "cost":"1–6 Mana", "mana":1.0, "gesture":"line", "cooldown":2.0, "description":"Draw a lasting route for the Hero and workers.", "icon":"route"},
	{"id":"sunder", "title":"Sunder", "palette":"Land", "cost":"5 Mana", "mana":5.0, "gesture":"line", "cooldown":12.0, "description":"Open a traversable ravine.", "icon":"rift"},
	{"id":"raise", "title":"Raise Earth", "palette":"Land", "cost":"4 Mana", "mana":4.0, "gesture":"point", "cooldown":8.0, "description":"Raise a lasting hill.", "icon":"hill"},
	{"id":"wall", "title":"Earthen Wall", "palette":"Land", "cost":"4 Mana or 2 star iron", "mana":4.0, "gesture":"line", "cooldown":8.0, "description":"Draw a defensive ridge.", "icon":"wall"},
	{"id":"meteor", "title":"Starfall", "palette":"Land", "cost":"8 Mana", "mana":8.0, "gesture":"point", "cooldown":20.0, "description":"Call a damaging meteorite with mineable remains.", "icon":"meteor"},
	{"id":"fault", "title":"Crystal Fault", "palette":"Land", "cost":"2 Mana + 2 star gems", "mana":2.0, "gems":2, "gesture":"line", "cooldown":10.0, "description":"Raise a crystal lined ridge.", "icon":"crystal"},
	{"id":"grove", "title":"Grow Grove", "palette":"Life", "cost":"3 Mana", "mana":3.0, "gesture":"point", "cooldown":6.0, "description":"Grow three harvestable trees.", "icon":"trees"},
	{"id":"forest", "title":"Grow Forest", "palette":"Life", "cost":"3 Mana", "mana":3.0, "gesture":"line", "cooldown":8.0, "description":"Grow a living forest along a drawn line.", "icon":"forest"},
	{"id":"ring", "title":"Tree Ring", "palette":"Life", "cost":"4 Mana", "mana":4.0, "gesture":"point", "cooldown":10.0, "description":"Grow a harvestable ring of trees.", "icon":"ring"},
	{"id":"awaken", "title":"Awaken Ent", "palette":"Life", "cost":"3 Mana", "mana":3.0, "gesture":"point", "cooldown":15.0, "description":"Awaken a nearby tree; calm it later for 2 Mana.", "icon":"ent"},
	{"id":"bridge", "title":"Bridge", "palette":"Construction", "cost":"3+ lumber", "wood":3, "gesture":"line", "cooldown":2.0, "description":"Span water between dry banks with a walkable bridge; final lumber follows length.", "icon":"bridge"},
	{"id":"ramp", "title":"Ramp", "palette":"Construction", "cost":"3+ lumber", "wood":3, "gesture":"line", "cooldown":3.0, "description":"Build an accessible slope; final cost follows length.", "icon":"ramp"},
	{"id":"stairs", "title":"Stairs", "palette":"Construction", "cost":"3+ lumber", "wood":3, "gesture":"line", "cooldown":3.0, "description":"Build a stepped ascent; final cost follows length.", "icon":"stairs"},
	{"id":"boardwalk", "title":"Boardwalk", "palette":"Construction", "cost":"3+ lumber", "wood":3, "gesture":"line", "cooldown":3.0, "description":"Build a raised walkable route; final cost follows length.", "icon":"boardwalk"},
	{"id":"outpost", "title":"Outpost", "palette":"Construction", "cost":"5 lumber", "wood":5, "gesture":"point", "cooldown":5.0, "description":"Establish a small work site.", "icon":"outpost", "implemented":false},
	{"id":"tower", "title":"Tower", "palette":"Construction", "cost":"5 lumber", "wood":5, "gesture":"point", "cooldown":5.0, "description":"Build a lookout tower.", "icon":"tower", "implemented":false},
	{"id":"platform", "title":"Platform", "palette":"Construction", "cost":"4 lumber", "wood":4, "gesture":"point", "cooldown":4.0, "description":"Build a walkable elevated deck.", "icon":"platform", "implemented":false},
	{"id":"gate", "title":"Gate", "palette":"Construction", "cost":"4 lumber", "wood":4, "gesture":"point", "cooldown":4.0, "description":"Build a passable gate.", "icon":"gate", "implemented":false},
	{"id":"barricade", "title":"Barricade", "palette":"Construction", "cost":"2 lumber", "wood":2, "gesture":"line", "cooldown":3.0, "description":"Build a defensive obstacle.", "icon":"barricade", "implemented":false},
	{"id":"patrol", "title":"Skeleton Patrol", "palette":"Encounters", "cost":"4 Mana", "mana":4.0, "gesture":"point", "cooldown":12.0, "description":"Warn the Hero before three skeletons rise.", "icon":"skeleton"},
	{"id":"golem", "title":"Assemble Golem", "palette":"Encounters", "cost":"Recovered timber, stone and metal heart", "gesture":"point", "cooldown":20.0, "description":"Future construction from recovered physical timber, stone and a metal heart.", "icon":"golem", "implemented":false},
	{"id":"harvest", "title":"Mark Harvest", "palette":"Life", "cost":"Free", "gesture":"point", "cooldown":0.0, "description":"Assign a helper to a standing tree; delivered timber enters the stockpile.", "icon":"axe"},
	{"id":"hire", "title":"Hire Helper", "palette":"Construction", "cost":"2 lumber", "wood":2, "gesture":"button", "cooldown":0.0, "description":"Equip another lumberjack at the work site.", "icon":"worker"},
	{"id":"calm", "title":"Calm Ent", "palette":"Life", "cost":"2 Mana", "mana":2.0, "gesture":"point", "cooldown":10.0, "description":"Calm an awakened tree for a short time.", "icon":"hand"}
]

static func catalogue() -> Array[Dictionary]:
	var result: Array[Dictionary] = []
	for entry in ENTRIES: result.append(entry.duplicate(true))
	return result

static func entry(action: String) -> Dictionary:
	for item in ENTRIES:
		if item.id == action: return item.duplicate(true)
	return {}

func availability(action: String, builder: Node) -> String:
	var item := entry(action)
	if item.is_empty(): return "Unknown spell."
	if not bool(item.get("implemented", true)): return "%s is not available yet." % item.title
	var remaining := float(builder.data.get("spell_cooldowns", {}).get(action, 0.0))
	if remaining > 0.001: return "%s recharges in %.1f s." % [item.title, remaining]
	if action == "wall" and int(builder.data.get("star_iron", 0)) >= 2: return ""
	if float(builder.data.get("mana", 0.0)) < float(item.get("mana", 0.0)):
		return "Need %s to cast %s." % [item.cost, item.title]
	if int(builder.data.get("wood", 0)) < int(item.get("wood", 0)): return "Need %s to build %s." % [item.cost, item.title]
	if int(builder.data.get("star_gems", 0)) < int(item.get("gems", 0)): return "Need %s to cast %s." % [item.cost, item.title]
	if int(builder.data.get("star_iron", 0)) < int(item.get("iron", 0)): return "Need %s to cast %s." % [item.cost, item.title]
	return ""

func cooldown_fraction(action: String, builder: Node) -> float:
	var item := entry(action)
	if item.is_empty(): return 0.0
	return clampf(float(builder.data.get("spell_cooldowns", {}).get(action, 0.0)) / maxf(float(item.cooldown), 0.001), 0.0, 1.0)

func begin(action: String, builder: Node) -> String:
	# No resources are reserved here. Failed geometry or terrain calls spend nothing.
	return availability(action, builder)

func success(action: String, builder: Node) -> void:
	var item := entry(action)
	if not item.is_empty(): builder.data.spell_cooldowns[action] = float(item.cooldown)
