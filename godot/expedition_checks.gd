extends Node
## Exercises the real assembled scene, zone travel and physical spawn support.
func run(game):
	await game.get_tree().physics_frame
	var failures=[]
	var zones=game.scene.get("zones",{})
	var expected=["orchard_highlands","gloamfen","starfall_ridge","cloudbreak_keep"]
	# Existing fairy/adventure modules add their own five destinations at setup.
	if zones.size()<12: failures.append("expected at least twelve base destinations")
	var links={}
	for portal in game.scene.get("portals",[]):
		var source=str(portal.get_meta("zone",""))
		var target=str(portal.get_meta("target_zone",""))
		if not links.has(source): links[source]=[]
		links[source].append(target)
	var reached=["forge_yard"]
	var index=0
	while index<reached.size():
		for target in links.get(reached[index],[]):
			if not reached.has(target): reached.append(target)
		index+=1
	for id in expected:
		if not reached.has(id): failures.append("unreachable "+id)
		if not links.get(id,[]).has({"orchard_highlands":"pinewood_ruins","gloamfen":"mushroom_glade","starfall_ridge":"crystal_hollow","cloudbreak_keep":"sky_garden"}[id]): failures.append("no return "+id)
		game.adventure.travel(id)
		if game.adventure.zone!=id: failures.append("travel "+id)
		var spawn:Vector3=zones[id].spawn
		var ray=PhysicsRayQueryParameters3D.create(spawn+Vector3.UP*2.0,spawn+Vector3.DOWN*4.0,1)
		if game.get_world_3d().direct_space_state.intersect_ray(ray).is_empty(): failures.append("unsupported spawn "+id)
	for id in game.adventure.ZONES:
		var horizon: Node3D = zones.get(id,{}).get("horizon")
		if horizon==null or not is_instance_valid(horizon):
			failures.append("missing horizon "+id)
			continue
		var horizon_stats: Dictionary = horizon.get_meta("stats",{})
		if int(horizon_stats.get("triangles",0))<100 or int(horizon_stats.get("triangles",0))>10000: failures.append("horizon budget "+id)
		if not horizon.get_node("HorizonMesh").is_in_group("distant_horizon"): failures.append("horizon weather group "+id)
	var orchard_apples=0
	var timber_count=0
	for node in game.scene.get("resources",[]):
		var resource_id=str(node.get_meta("resource",""))
		var node_zone=str(node.get_meta("zone",""))
		if node_zone=="orchard_highlands" and resource_id=="apple":
			orchard_apples+=1
			if node.global_position.y<1.3 or node.global_position.y>2.1: failures.append("unreachable orchard apple")
		if node_zone in ["orchard_highlands","pinewood_ruins"] and resource_id=="lumber":
			timber_count+=1
			if not node.has_meta("trunk") or not node.has_meta("trunk_mesh"): failures.append("timber lost chop contract")
			elif node.get_meta("trunk").get_parent()!=node: failures.append("timber trunk not direct child")
	if orchard_apples!=5: failures.append("orchard apple count")
	if timber_count<8: failures.append("timber count")
	var rewards={"orchard_highlands":"lumber","gloamfen":"spore","starfall_ridge":"crystal","cloudbreak_keep":"sky_bloom"}
	for id in rewards:
		var found=false
		for node in game.scene.get("resources",[]):
			if node.get_meta("zone","")==id and node.get_meta("resource","")==rewards[id]: found=true
		if not found: failures.append("missing resource "+id)
	game.adventure.travel("forge_yard")
	print("EXPEDITION_RESULT ",JSON.stringify(failures)," zones=",zones.size()," reachable=",reached.size())
	game.get_tree().quit(0 if failures.is_empty() else 2)
