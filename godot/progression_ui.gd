extends RefCounted

# Display only: prices and availability always come from the service ledger.
const PATH = ["Basic tools · axe, pick, hammer, bomb glove", "Stocked workshop · grapple, lantern, inventions", "Enchanted anvil · Hollow's Song", "Everburning forge · The Last Hearth"]
const PLACES = {"rat_tail":"Enchanted Kitchen", "lumber":"Pinewood Ruins", "stone":"Sandstone Quarry", "iron":"Sandstone Quarry", "haunted_bone":"Pinewood Ruins", "ember_core":"Ember Foundry boss"}

static func summary(state:Dictionary)->String:
	var tier=int(state.get("tier",1))
	var lines:PackedStringArray=["WORKSHOP  %d / 4"%tier]
	var upgrades:Array=state.get("upgrades",[])
	var next:Dictionary={}
	for upgrade in upgrades:
		if int(upgrade.tier)==tier+1: next=upgrade
	if not next.is_empty():
		lines.append("NEXT · "+str(next.name))
		var resources:Dictionary=state.get("resources",{})
		var choices:PackedStringArray=[]
		for cost in next.get("costs",[]):
			var ingredients:PackedStringArray=[]
			for resource in cost:
				var owned=int(state.get("tails",0)) if resource=="rat_tail" else int(resources.get(resource,0))
				ingredients.append("%s %d/%d"%[str(resource).replace("_"," "),owned,int(cost[resource])])
			choices.append(" + ".join(ingredients))
		if not choices.is_empty(): lines.append(" OR ".join(choices))
		var places:PackedStringArray=[]
		for cost in next.get("costs",[]):
			for resource in cost:
				var place=str(PLACES.get(resource,""))
				if not place.is_empty() and not places.has(place): places.append(place)
		if not places.is_empty(): lines.append("Find at "+", ".join(places))
		lines.append("Pouch → buckets → lever")
	else:
		lines.append("All forge tiers unlocked" if tier>=4 else "Talk to Brann for the next step")
	return "\n".join(lines)

static func update_cards(buttons:Array,state:Dictionary):
	for button in buttons:
		if not button.has_meta("availability_label"): continue
		var id=str(button.get_meta("action","")).trim_prefix("tool:")
		var label:Label3D=button.get_meta("availability_label")
		for recipe in state.get("recipes",[]):
			if str(recipe.id)!=id: continue
			label.text="TIER %d · "%int(recipe.tier)+("AVAILABLE · FREE" if recipe.get("available",false) else "LOCKED")
			label.modulate=Color("b7e3cb") if recipe.get("available",false) else Color("ddbb74")
