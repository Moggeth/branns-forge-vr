extends Node
## Visual acknowledgement of input; crafting success remains the service's responsibility.
var game
var entries={}
var hover_target:Node3D
var last_scan=0.0

func register_button(target:Node3D):
	if entries.has(target.get_instance_id()): return
	for child in target.get_children():
		if child is MeshInstance3D and child.material_override is StandardMaterial3D:
			var material=child.material_override.duplicate()
			child.material_override=material
			entries[target.get_instance_id()]={"target":target,"mesh":child,"material":material,"color":material.albedo_color,"position":child.position,"until":0.0,"allowed":true}
			return

func press(target:Node3D,hand:Node3D)->bool:
	register_button(target)
	if not entries.has(target.get_instance_id()): return true
	var entry=entries[target.get_instance_id()]
	if game.elapsed<float(entry.until)-0.3: return false
	entry.until=game.elapsed+0.65
	entry.allowed=true
	var action=str(target.get_meta("action",""))
	if action.begins_with("tool:"):
		for recipe in game.state.get("recipes",[]):
			if recipe.id==action.trim_prefix("tool:"): entry.allowed=recipe.get("available",false)
	if action=="upgrade":
		entry.allowed=false
		for upgrade in game.state.get("upgrades",[]):
			if not upgrade.get("available",false): continue
			for cost in upgrade.get("costs",[]):
				var enough=true
				for resource in cost:
					if int(game.state.get("resources",{}).get(resource,0))<int(cost[resource]): enough=false
				if enough: entry.allowed=true
	if hand is XRController3D: hand.trigger_haptic_pulse("haptic",110,0.22,0.045,0)
	print("UI_PRESS action=",action," available=",entry.allowed)
	return true

func _process(_delta):
	if game==null: return
	if game.elapsed>=last_scan:
		last_scan=game.elapsed+0.05
		hover_target=null
		var sources=([game.qol.menu_hand()] if game.qol.opened else game.hands) if game.vr else [game.camera]
		for hand in sources:
			if hand is XRController3D and not hand.get_is_active(): continue
			var source=game.aim_source(hand) if hand is XRController3D else hand
			var query=PhysicsRayQueryParameters3D.create(source.global_position,source.global_position-source.global_basis.z*6,4 if game.qol.opened else 1)
			var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
			var target=game._owner(hit.get("collider"))
			if target!=null and target.has_meta("action") and not str(target.get_meta("action")).contains("slider:"):
				hover_target=target
				register_button(target)
	for key in entries.keys():
		var entry=entries[key]
		if not is_instance_valid(entry.target) or not is_instance_valid(entry.mesh):
			entries.erase(key)
			continue
		var pressed=game.elapsed<entry.until
		var hovered=entry.target==hover_target
		var color:Color=entry.color
		if hovered: color=color.lerp(Color("86c7b5"),0.55)
		if pressed: color=Color("edbd71") if not entry.allowed or entry.until-game.elapsed>0.5 else Color("70c5a5")
		entry.material.albedo_color=color
		entry.material.emission_enabled=hovered or pressed
		entry.material.emission=color
		entry.material.emission_energy_multiplier=0.18
		entry.mesh.position=entry.position+Vector3(0,0,-0.008 if pressed else (0.008 if hovered else 0.0))
