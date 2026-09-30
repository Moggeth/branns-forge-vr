extends SceneTree
## Offline lifecycle and conservation check against the real orchard scene.
const Ents = preload("res://world_builder_ents.gd")

func _initialize() -> void:
	call_deferred("_check")

func _check() -> void:
	var failures: Array[String] = []
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	var builder: Node = game.world_builder
	if builder == null:
		failures.append("builder absent")
	else:
		builder.test_mode = true
		builder.data = builder.fresh_state()
		builder.data.mana = 20.0
		builder.data.ents = []
		var ents: Node = Ents.new()
		game.add_child(ents)
		ents.setup(builder)
		builder.ents = ents
		# Heat and water operate only in the active zone; exercise the Orchard.
		game.adventure.travel("orchard_highlands")
		var source: Node3D = null
		var source_key := ""
		for key in builder.resource_by_key:
			var candidate: Node3D = builder.resource_by_key[key]
			if is_instance_valid(candidate) and candidate.visible and str(candidate.get_meta("tree_species", "")) == "apple":
				source = candidate
				source_key = key
				break
		if source == null: failures.append("indexed apple tree absent")
		else:
			var at: Vector3 = source.global_position - builder.center
			var before_id := source.get_instance_id()
			var before_trunk: Variant = source.get_meta("trunk_mesh", null)
			var detail: Dictionary = ents.preview(at)
			if detail.reason != "" or detail.key != source_key or detail.species != "apple": failures.append("preview source identity/species")
			if ents.awaken(at) != "": failures.append("awaken rejected real apple tree")
			else:
				if ents.active.get(source_key) != source or source.get_instance_id() != before_id or source.get_meta("trunk_mesh", null) != before_trunk: failures.append("source mesh/entity replaced")
				if int(builder.data.ents.size()) != 1 or absf(float(builder.data.mana) - 17.0) > 0.01: failures.append("one record and one mana debit")
				if ents.awaken(at) == "": failures.append("repeat awakening charged or duplicated")
				if ents.calm(at) != "" or builder.data.ents[0].state != "calm": failures.append("finite guardian calm failed")
				game.adventure.hp = 30.0
				ents.tick(0.1)
				if game.apples.entries.is_empty(): failures.append("calm Ent did not create AppleRuntime fruit")
				else:
					var fruit: Dictionary = game.apples.entries.back()
					if not is_instance_valid(fruit.body) or str(fruit.body.get_meta("kind", "")) != "apple": failures.append("Ent fruit is not physical AppleRuntime apple")
					else:
						var hand := Node3D.new()
						game.add_child(hand)
						fruit.state = "held"
						fruit.held_by = hand
						game.held[str(hand.get_instance_id())] = fruit.body
						for bite in 3:
							fruit.next_bite = game.elapsed - 1.0
							game.apples.bite(hand)
						if game.adventure.hp <= 30.0: failures.append("Ent apple did not heal through three bites")
				ents.tick(90.1)
				if builder.data.ents[0].state != "active": failures.append("guardian calm did not expire")
				ents.on_hit(source, 1000.0)
				if builder.data.ents[0].state != "dead" or source_key not in builder.data.harvested or source.visible: failures.append("death/harvest reconciliation")
				var seeds: Array = game.adventure.zone_groups[builder.ZONE].find_children("Ent_magical_seed", "Node3D", true, false)
				if seeds.is_empty(): failures.append("fallen Ent left no magical seed")
				else:
					var drop: Node3D = seeds.back()
					if ents.claim_seed(drop) != "" or builder.data.ent_seeds.size() != 1: failures.append("Ent seed could not enter bounded local pouch")
					if builder.spell_availability("seed") != "": failures.append("Life palette seed action unavailable with carried seed")
					if ents.claim_seed(drop) == "" or builder.data.ent_seeds.size() != 1: failures.append("Ent seed claimed twice")
					var planted := false
					for x in range(-96, 97, 12):
						if planted: break
						for z in range(-96, 97, 12):
							var site := Vector3(float(x), 0.0, float(z))
							if ents.plant_seed(site) == "":
								planted = true
								if builder.data.ent_seeds.size() != 0 or not builder.resource_by_key.has(builder._key(site)) or str(builder.data.forest_spells.back().feature) != "ent_seed": failures.append("seed planting did not persist real harvestable tree")
								if not builder._valid(builder.data): failures.append("seed planting produced invalid save state")
								if builder.spell_availability("seed") == "": failures.append("Life palette seed action remained available after consumption")
								break
					if not planted: failures.append("carried seed found no valid planting site")
				var logs: Array = game.adventure.zone_groups[builder.ZONE].find_children("FallenEntTimber", "RigidBody3D", true, false)
				if logs.is_empty() or logs.back().get_meta("ent_key", "") != source_key or logs.back().find_children("*", "MeshInstance3D", true, false).is_empty(): failures.append("physical timber retains original mesh")
				else:
					var hand := Node3D.new()
					game.add_child(hand)
					hand.global_position = logs.back().global_position
					logs.back().age = 2.0
					if not logs.back().try_grab(hand, true) or not bool(logs.back().get_meta("ent_credited", false)): failures.append("physical timber cannot use ordinary grip route")
					var credited_wood := int(builder.data.wood)
					logs.back()._claim()
					if int(builder.data.wood) != credited_wood: failures.append("gripping credited timber duplicated lumber")
				var wood := int(builder.data.wood)
				ents.on_hit(source, 1000.0)
				if int(builder.data.wood) != wood or builder.data.harvested.count(source_key) != 1: failures.append("death duplicated timber")
				if not Ents.valid_records(builder.data.ents) or Ents.valid_records(builder.data.ents + builder.data.ents): failures.append("record validity/bounded uniqueness")
				ents.restore()
				if ents.active.has(source_key): failures.append("dead Ent restored as live tree")
		var scenic_key := ""
		for key in builder.scenic_by_key:
			if key in builder.data.harvested: continue
			var collision: CollisionShape3D = builder.scenic_by_key[key].collision
			if is_instance_valid(collision) and not collision.disabled and str(collision.get_meta("builder_species", "")) == "pine": scenic_key = key; break
		if scenic_key.is_empty(): failures.append("indexed scenic pine absent")
		else:
			var position: Vector3 = builder.scenic_by_key[scenic_key].position
			var scenic_preview: Dictionary = ents.preview(position)
			if scenic_preview.key != scenic_key or scenic_preview.species != "pine" or scenic_preview.scale <= 0.0: failures.append("scenic identity/size")
			builder.data.mana = 20.0
			if ents.awaken(position) != "": failures.append("scenic promotion rejected")
			else:
				var promoted: Node3D = ents.active[scenic_key]
				if builder.scenic_pending.get(scenic_key) != promoted or not promoted.has_meta("trunk_mesh"): failures.append("scenic not revealed from indexed tree")
				ents.active.clear()
				ents.restore()
				if ents.active.get(scenic_key) != promoted: failures.append("restore duplicated live scenic tree")
				var pine_hp: float = float(promoted.get_meta("hp", 0.0))
				ents.on_hit(promoted, 10.0)
				if absf(pine_hp - float(promoted.get_meta("hp", 0.0)) - 7.2) > 0.05: failures.append("pine physical defense lost")
				promoted.set_meta("burning", true)
				if ents.preview(position).reason == "": failures.append("active scenic available twice")
				ents.on_hit(promoted, 1000.0)
				if scenic_key not in builder.data.harvested or builder.scenic_pending.has(scenic_key): failures.append("scenic death ledger")
		var burning_source: Node3D = null
		for key in builder.resource_by_key:
			var candidate: Node3D = builder.resource_by_key[key]
			if is_instance_valid(candidate) and candidate.visible and not candidate.has_meta("ent_key"):
				burning_source = candidate
				break
		if burning_source == null: failures.append("burning fixture source absent")
		else:
			builder.data.mana = 20.0
			burning_source.set_meta("burning", true)
			var burning_at: Vector3 = burning_source.global_position - builder.center
			var warning: Dictionary = ents.preview(burning_at)
			if warning.condition != "burning" or not str(warning.risk).contains("Burning"): failures.append("burning risk preview")
			if ents.awaken(burning_at) != "" or int(burning_source.get_meta("damage", 0)) <= 15: failures.append("burning combat condition")
			else:
				var burning_key := str(burning_source.get_meta("ent_key", ""))
				game.heat_contacts.water(burning_source.global_position, 1.2, builder.ZONE)
				if ents._record(burning_key).condition != "healthy": failures.append("shared water quench hook")
				var hp_before: float = float(burning_source.get_meta("hp", 0.0))
				ents.on_hit(burning_source, 10.0, null, Vector3.ZERO, "fire")
				if ents._record(burning_key).condition != "burning" or int(burning_source.get_meta("damage", 0)) <= 15 or hp_before - float(burning_source.get_meta("hp", 0.0)) < 13.0: failures.append("fire hit did not ignite and amplify damage")
				ents.tick(12.1)
				if ents._record(burning_key).condition != "healthy": failures.append("burning condition persisted forever")
				game.heat_contacts.fixtures.append({"zone": builder.ZONE, "burning": true, "node": burning_source})
				ents.tick(0.3)
				if ents._record(burning_key).condition != "burning": failures.append("shared heat source did not ignite living Ent")
				game.heat_contacts.fixtures.pop_back()
				ents.on_hit(burning_source, 1000.0)
		var sample := {"key": "1:2", "state": "active", "species": "apple", "scale": 1.0, "condition": "burning", "hp": 10.0, "calm_left": 0.0}
		if not Ents.valid_records([sample]): failures.append("burning condition serialization")
		if not Ents.valid_seeds([{"key": "1:2", "species": "apple"}]) or Ents.valid_seeds([{"key": "1:2", "species": "apple"}, {"key": "1:2", "species": "pine"}]): failures.append("bounded seed schema")
		var excess_seeds: Array = []
		for i in 9: excess_seeds.append({"key": "%d:2" % i, "species": "pine"})
		if Ents.valid_seeds(excess_seeds): failures.append("seed pouch accepted more than eight records")
		var many: Array = []
		for i in 9:
			var another := sample.duplicate()
			another.key = "%d:2" % i
			many.append(another)
		if Ents.valid_records(many): failures.append("unbounded Ent records accepted")
	print("WORLD_BUILDER_ENTS_RESULT ", JSON.stringify({"failures": failures}))
	quit(0 if failures.is_empty() else 1)
