extends RefCounted

static func run(game):
	var errors: Array = []
	var id = game.wyrmspout.ITEM_ID
	var until = Time.get_ticks_msec() + 12000
	while not game.imported.has(id) and Time.get_ticks_msec() < until:
		await game.get_tree().create_timer(0.1).timeout
	if not game.imported.has(id):
		print("WYRM_CHECK FAIL item did not import")
		game.get_tree().quit(1)
		return
	var item: Node3D = game.imported[id]
	var record = game.wyrmspout.records.get(item.get_instance_id())
	if record == null: errors.append("runtime not attached")
	else:
		var bounds = game._bounds(item, Transform3D.IDENTITY)
		if bounds.size.length() > 0.9: errors.append("item scale too large")
		if record.eyes.size() != 2: errors.append("missing eyes")
		if record.heat_nodes.size() < 8: errors.append("missing heat surfaces")
		if record.stream_lights.size() != game.wyrmspout.STREAM_LIGHT_COUNT: errors.append("moving light pool is not bounded")
		for light in record.stream_lights:
			if light.shadow_enabled: errors.append("stream light is casting expensive shadows")
		if game.wyrmspout.flame_mesh.get_surface_count() == 0 or game.wyrmspout.flame_material.shader == null: errors.append("missing faceted flame material")
		if game.wyrmspout.flame_sound == null: errors.append("missing flame sound")
		game.grips._attach(game.desktop_hand, item)
		game._set_collisions(item, false)
		var aim = -item.global_basis.z
		print("WYRM_AIM axis=",aim," barrel=",(record.muzzle.global_position-item.global_position).normalized()," controller=",-game.desktop_hand.global_basis.z)
		if aim.dot(-game.desktop_hand.global_basis.z) < 0.94: errors.append("muzzle does not aim forward")
		if not game.wyrmspout.start(game.desktop_hand): errors.append("primary trigger not accepted")
		game.wyrmspout._fire(record, 0.1)
		if record.drops.size() < 2 or not record.jets[0].visible: errors.append("flame packets did not emit progressively")
		elif float(record.drops[0].advance) <= float(record.drops[-1].advance): errors.append("slow-frame packets spawned at one time")
		var first_drop = record.drops[0]
		var velocity_before = first_drop.velocity.y
		game.wyrmspout._step_stream(record, 0.03)
		game.wyrmspout._update_stream_lights(record)
		if not record.drops.is_empty() and record.stream_lights[0].light_energy <= 0: errors.append("moving flame packet did not illuminate")
		if record.drops.has(first_drop) and first_drop.velocity.y >= velocity_before: errors.append("stream has no gravity droop")
		var ghost: Node3D = game.firecraft.ghosts[0]
		ghost.reparent(game.adventure.zone_groups[game.adventure.zone])
		ghost.global_position = record.muzzle.global_position - item.global_basis.z * 2.0 - Vector3.UP * 0.7
		var ghost_health = float(ghost.get_meta("hp"))
		game.wyrmspout._damage_cone(record.muzzle.global_position, -item.global_basis.z, 4.0)
		if float(ghost.get_meta("hp")) >= ghost_health: errors.append("real fire did not damage ghost")
		var heat_before = record.heat
		game.wyrmspout.vent(item)
		if record.heat > heat_before: errors.append("vent increased heat")
		var zone_group: Node3D = game.adventure.zone_groups[game.adventure.zone]
		var fuel_before=game.firecraft.fluid.remaining_fuel() if game.firecraft.fluid!=null else 0.0
		game.wyrmspout._ignite_surface({"position":zone_group.global_position + Vector3.UP * 0.05,"normal":Vector3.UP,"collider":zone_group})
		if game.firecraft.fluid!=null and game.firecraft.fluid.remaining_fuel()<=fuel_before: errors.append("ground impact did not feed liquid fire")
		if game.wyrmspout.patches.is_empty() and (game.firecraft.fluid == null or game.firecraft.fluid.remaining_fuel() <= 0.0): errors.append("surface flame did not persist")
		if game.wyrmspout.flame_sources().is_empty() and (game.firecraft.fluid == null or game.firecraft.fluid.active_counts().pending_units <= 0.0): errors.append("ghosts cannot detect surface fire")
		game.wyrmspout.diagnostic_force_trigger = true
		record.heat = 0.995
		game.wyrmspout.tick(0.1)
		if record.locked_until - game.elapsed < 2.9: errors.append("overheat lockout not three seconds")
		if record.firing: errors.append("flame did not stop on overheat")
		game.wyrmspout.diagnostic_force_trigger = false
	print("WYRM_CHECK ", "PASS" if errors.is_empty() else "FAIL " + str(errors))
	game.get_tree().quit(0 if errors.is_empty() else 1)
