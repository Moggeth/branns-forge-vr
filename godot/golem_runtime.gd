extends Node
## Quarry sentinel gameplay and authored modular art. ActorAnimation owns the pose;
## AdventureRuntime owns health, loot and respawn. Nothing here moves the actor root.
const ART_PATH := "res://assets/golem/golem.glb"
const MiningDamage = preload("res://mining_damage.gd")
const PARTS := {"BodyCore":"body", "Head":"head", "ArmL":"arm_l", "ArmR":"arm_r", "LegL":"leg_l", "LegR":"leg_r"}
const ARMOR := {"ChestPlate":"chest", "ShoulderL":"arm_l", "ShoulderR":"arm_r", "ForearmL":"arm_l", "ForearmR":"arm_r"}
const ARMOR_HEALTH := 24.0
const SLAM_RADIUS := 1.65
const MAX_ARMOR_CHIPS := 20
const ARMOR_CHIP_LIFETIME := 12.0
var game
var animator
var entries := {}
var armor_chips := []
var ring_material: StandardMaterial3D

func setup(owner_game, owner_animator) -> void:
	game = owner_game
	animator = owner_animator
	ring_material = StandardMaterial3D.new()
	ring_material.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	ring_material.albedo_color = Color(1.0, 0.48, 0.13, 0.72)
	ring_material.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	ring_material.no_depth_test = false

func attach(actor: Node3D, rig: Dictionary) -> void:
	var entry := {"actor":actor, "rig":rig, "armor":{}, "armor_nodes":{}, "core":null,
		"core_scale":Vector3.ONE, "core_intact_material":null, "core_exposed_material":null,
		"marker":null, "mark":Vector3.ZERO, "art":false, "last_notice":-100.0,
		"unlocated_impact_at":-100.0, "armor_sites":[], "armor_cracks":{}}
	for region in ["chest", "head", "arm_l", "arm_r", "leg_l", "leg_r"]:
		entry.armor[region] = ARMOR_HEALTH
	entries[actor.get_instance_id()] = entry
	actor.set_meta("golem_stagger_until", 0.0)
	actor.set_meta("golem_core_exposed", false)
	actor.set_meta("golem_armor_sites", [])
	actor.set_meta("golem_slam_scale", 1.0)
	actor.set_meta("golem_move_scale", 1.0)
	actor.set_meta("surface_material", "stone")
	if not ResourceLoader.exists(ART_PATH): return
	var packed = load(ART_PATH)
	if not packed is PackedScene: return
	var visual = packed.instantiate()
	if not visual is Node3D:
		visual.queue_free()
		return
	visual.name = "GolemAuthoredArt"
	actor.add_child(visual)
	var parts := {}
	for part_name in PARTS:
		var part = visual.find_child(part_name, true, false)
		if not part is Node3D:
			push_warning("Golem art missing modular part %s; using procedural fallback" % part_name)
			visual.queue_free()
			return
		parts[part_name] = part
	# Import succeeds only when all six independent pieces are available. Reparent
	# with world pose retained, so each existing joint drives a genuine stone part.
	var authored_homes := []
	for part_name in PARTS:
		var part: Node3D = parts[part_name]
		var joint: Node3D = rig.joints[PARTS[part_name]]
		part.reparent(joint)
		authored_homes.append({"piece":part, "parent":joint, "transform":part.transform})
	for plate_name in ARMOR:
		var plate = actor.find_child(plate_name, true, false)
		if not plate is Node3D: continue
		# "chest" is a damage region; the puppet's corresponding joint is "body".
		var plate_joint: Node3D = rig.joints["body" if ARMOR[plate_name] == "chest" else ARMOR[plate_name]]
		plate.reparent(plate_joint)
		authored_homes.append({"piece":plate, "parent":plate_joint, "transform":plate.transform})
		entry.armor_nodes[plate_name] = plate
	entry.core = visual.find_child("CoreGlow", true, false)
	if entry.core == null: entry.core = actor.find_child("CoreGlow", true, false)
	_prepare_core(entry)
	for legacy in rig.pieces: legacy.visible = false
	rig.homes = authored_homes
	rig.pieces = authored_homes.map(func(home): return home.piece)
	entry.art = true
	_refresh_core(entry)

func tick(_delta: float) -> void:
	for index in range(armor_chips.size() - 1, -1, -1):
		var chip: Dictionary = armor_chips[index]
		if not is_instance_valid(chip.node):
			armor_chips.remove_at(index)
		elif game.elapsed >= float(chip.until):
			chip.node.queue_free()
			armor_chips.remove_at(index)
	for id in entries.keys():
		var entry: Dictionary = entries[id]
		var actor: Node3D = entry.actor
		if not is_instance_valid(actor):
			if is_instance_valid(entry.marker): entry.marker.queue_free()
			entries.erase(id)
			continue
		var marker = entry.marker
		if is_instance_valid(marker):
			if not actor.get_meta("alive", true) or str(actor.get_meta("combat_phase", "")) != "windup":
				cancel_slam(actor)
			else:
				var progress := clampf(float(actor.get_meta("combat_progress", 0.0)) / 0.65, 0.0, 1.0)
				marker.scale = Vector3.ONE * (0.68 + progress * 0.32)
				marker.rotation.y += 0.012
		if entry.core is MeshInstance3D and is_instance_valid(entry.core):
			var core: MeshInstance3D = entry.core
			core.scale = entry.core_scale * (1.0 + 0.05 * sin(game.elapsed * (8.0 if actor.get_meta("golem_core_exposed", false) else 3.0)))

func begin_slam(actor: Node3D, target: Vector3) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty(): return
	cancel_slam(actor)
	var mark := Vector3(target.x, target.y + 0.055, target.z)
	entry.mark = mark
	var marker := MeshInstance3D.new()
	marker.name = "GolemSlamWarning"
	var torus := TorusMesh.new()
	torus.inner_radius = SLAM_RADIUS - 0.065
	torus.outer_radius = SLAM_RADIUS
	torus.rings = 24
	torus.ring_segments = 5
	marker.mesh = torus
	marker.material_override = ring_material
	marker.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	game.add_child(marker)
	marker.global_position = mark
	entry.marker = marker
	actor.set_meta("golem_slam_mark", mark)

func slam(actor: Node3D) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty(): return
	var mark: Vector3 = entry.mark
	cancel_slam(actor)
	# The shared bounded stone profile supplies textured chips, slabs, dust and
	# spatial clacks. Two contact points sell the width of the heavy slam.
	_stone_contact(actor, mark + Vector3(0.62, 0.08, 0), Vector3.UP, 5.2, "golem_slam")
	_stone_contact(actor, mark + Vector3(-0.62, 0.08, 0), Vector3.UP, 5.2, "golem_slam")
	var player_delta: Vector3 = game.camera.global_position - mark
	if Vector2(player_delta.x, player_delta.z).length() <= SLAM_RADIUS and absf(player_delta.y) < 2.8:
		game.adventure.take_damage(float(actor.get_meta("damage", 15)) * float(actor.get_meta("golem_slam_scale", 1.0)), "golem's ground slam")
		for hand in game.hands: game.adventure.haptic(hand, "impact")
	if game.get("fairy") != null and game.fairy.active:
		var fairy_delta: Vector3 = game.fairy.avatar.global_position - mark
		if Vector2(fairy_delta.x, fairy_delta.z).length() <= SLAM_RADIUS and absf(fairy_delta.y) < 2.8:
			game.fairy.hurt(float(actor.get_meta("damage", 15)) * float(actor.get_meta("golem_slam_scale", 1.0)), "golem's ground slam")

func cancel_slam(actor: Node3D) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty(): return
	if is_instance_valid(entry.marker): entry.marker.queue_free()
	entry.marker = null
	if actor.has_meta("golem_slam_mark"): actor.remove_meta("golem_slam_mark")

func filter_hit(actor: Node3D, damage: float, hand, damage_type: String, impact_point, tool_id: String = "") -> float:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty(): return damage
	var tool := tool_id
	if tool == "" and is_instance_valid(hand) and game.held.has(str(hand.get_instance_id())):
		tool = str(game.held[str(hand.get_instance_id())].get_meta("id", ""))
	var pick := tool == "quarry_pick"
	var item: Node3D = null
	if pick and is_instance_valid(hand) and game.held.has(str(hand.get_instance_id())):
		item = game.held[str(hand.get_instance_id())]
	var context: Dictionary = item.get_meta("mining_contact", {}) if is_instance_valid(item) else {}
	if pick and not context.is_empty():
		if str(context.get("strike_region", "")) not in ["pick_point", "opposite_point", "working"] or \
			float(context.get("incidence", 1.0)) < 0.30 or float(context.get("energy", 0.0)) < 0.35:
			return 0.0
	var local := Vector3.ZERO
	var aimed := impact_point is Vector3
	if aimed: local = actor.to_local(impact_point)
	var core := aimed and absf(local.x) <= 0.34 and local.y >= 1.02 and local.y <= 1.54 and local.z >= 0.28
	if aimed and entry.core is MeshInstance3D and is_instance_valid(entry.core) and entry.core.mesh != null:
		var core_pose: Transform3D = actor.global_transform.affine_inverse() * entry.core.global_transform
		core = (core_pose * entry.core.mesh.get_aabb()).grow(0.08).has_point(local)
	if core:
		damage *= 2.6 if pick else 1.5
		_stagger(actor, 1.25 if pick else 0.55)
		actor.set_meta("golem_core_exposed", true)
		if game.elapsed - float(entry.last_notice) > 1.5:
			game._notice("Core exposed! Stonewhisper hits hardest here.", 2)
			entry.last_notice = game.elapsed
		_refresh_core(entry)
		return damage
	var region := "chest"
	if aimed:
		if local.y > 1.76: region = "head"
		elif local.y < 0.76: region = "leg_l" if local.x < 0 else "leg_r"
		elif local.x < -0.40: region = "arm_l"
		elif local.x > 0.40: region = "arm_r"
	var armor_left := float(entry.armor.get(region, 0.0))
	if armor_left > 0.0:
		if pick and aimed:
			var energy := float(context.get("energy", maxf(0.0, damage) * 0.1))
			var target := ["chest", "head", "arm_l", "arm_r", "leg_l", "leg_r"].find(region)
			var local_point: Vector3 = actor.to_local(impact_point)
			var mining: Dictionary = MiningDamage.apply(entry.armor_sites, local_point, "stone", energy, context, target)
			if not bool(mining.accepted): return 0.0
			entry.armor_sites = mining.sites
			actor.set_meta("golem_armor_sites", entry.armor_sites.duplicate(true))
			_show_armor_crack(entry, region, impact_point, int(mining.stage))
			# The plate absorbs the strike until a local fracture releases it.
			damage *= 0.26
			if bool(mining.extracted): entry.armor[region] = 0.0
		else:
			entry.armor[region] = maxf(0.0, armor_left - damage)
			damage *= 0.6 if damage_type == "physical" else 0.78
		if float(entry.armor[region]) <= 0.0:
			_break_armor(entry, region, impact_point if aimed else actor.global_position + Vector3.UP * 1.2, not aimed)
			damage *= 3.8 if pick else 1.25
	else:
		damage *= 1.35 if pick else 1.15
	if pick and aimed and region in ["leg_l", "leg_r"]: _stagger(actor, 0.75)
	return damage

func _break_armor(entry: Dictionary, region: String, point: Vector3, emit_fallback: bool) -> void:
	var actor: Node3D = entry.actor
	_clear_armor_crack(entry, region)
	for plate_name in entry.armor_nodes:
		if ARMOR[plate_name] == region and is_instance_valid(entry.armor_nodes[plate_name]):
			var plate: Node3D = entry.armor_nodes[plate_name]
			_chip_plate(actor, plate, point)
			plate.visible = false
	# Melee and projectiles emit their measured contact after damage resolves.
	# Only damage with no contact point needs an armour-break fallback here.
	if emit_fallback:
		var normal := (point - actor.global_position - Vector3.UP).normalized()
		if normal.length_squared() < 0.01: normal = Vector3.UP
		_stone_contact(actor, point, normal, 4.0, "golem_armor")
		entry.unlocated_impact_at = game.elapsed
	_stagger(actor, 0.95)
	if game.elapsed - float(entry.last_notice) > 1.2:
		game._notice("Golem %s armour cracks away." % region.replace("_", " "), 2)
		entry.last_notice = game.elapsed
	actor.set_meta("golem_broken_" + region, true)
	if region in ["arm_l", "arm_r"]:
		var broken_arms := int(actor.get_meta("golem_broken_arm_l", false)) + int(actor.get_meta("golem_broken_arm_r", false))
		actor.set_meta("golem_slam_scale", 1.0 - 0.2 * broken_arms)
	elif region in ["leg_l", "leg_r"]:
		var broken_legs := int(actor.get_meta("golem_broken_leg_l", false)) + int(actor.get_meta("golem_broken_leg_r", false))
		actor.set_meta("golem_move_scale", 1.0 - 0.25 * broken_legs)

func _stagger(actor: Node3D, seconds: float) -> void:
	actor.set_meta("golem_stagger_until", maxf(float(actor.get_meta("golem_stagger_until", 0.0)), game.elapsed + seconds))
	actor.set_meta("attack_damage_done", true)
	actor.set_meta("combat_phase", "recovery")
	actor.set_meta("combat_progress", 0.86)
	cancel_slam(actor)

func _show_armor_crack(entry: Dictionary, region: String, point: Vector3, stage: int) -> void:
	# Damage is authoritative in armor_sites. Art is an optional view, parented
	# to the moving plate so the crack follows animation without a new collider.
	var art_path := "res://mining_visual_art.gd"
	if not ResourceLoader.exists(art_path): return
	var plate: Node3D = null
	for plate_name in entry.armor_nodes:
		if ARMOR[plate_name] == region and is_instance_valid(entry.armor_nodes[plate_name]):
			plate = entry.armor_nodes[plate_name]
			break
	if plate == null: return
	var art = load(art_path)
	if art == null or not art.has_method("crack_mesh"): return
	var mesh = art.crack_mesh(stage, int(entry.actor.get_instance_id()) + region.hash())
	if not mesh is Mesh: return
	var crack: MeshInstance3D = entry.armor_cracks.get(region)
	if not is_instance_valid(crack):
		crack = MeshInstance3D.new()
		crack.name = "ArmorFracture_" + region
		plate.add_child(crack)
		entry.armor_cracks[region] = crack
	crack.mesh = mesh
	var local := plate.to_local(point)
	var outward := (point - plate.global_position).normalized()
	if outward.length_squared() < 0.25: outward = plate.global_basis.z.normalized()
	var local_normal := (plate.global_basis.inverse() * outward).normalized()
	crack.position = local + local_normal * 0.012
	crack.basis = Basis.looking_at(-local_normal, Vector3.UP if absf(local_normal.y) < 0.9 else Vector3.RIGHT)

func _clear_armor_crack(entry: Dictionary, region: String) -> void:
	var crack = entry.armor_cracks.get(region)
	if is_instance_valid(crack): crack.queue_free()
	entry.armor_cracks.erase(region)

func defeated(actor: Node3D, impact_point = null) -> void:
	cancel_slam(actor)
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	# An exact contact will emit at its actual point after this damage call.
	# Avoid a second centred sound/burst when armour also broke this frame.
	if not impact_point is Vector3 and (entry.is_empty() or game.elapsed - float(entry.unlocated_impact_at) > 0.065):
		_stone_contact(actor, actor.global_position + Vector3.UP * 1.25, Vector3.UP, 5.5, "golem_shatter")
	if not entry.is_empty():
		# A plate already thrown from the living actor has its own bounded rigid
		# fragment. Skip the hidden source when death scatters the remaining art.
		for home in entry.rig.homes:
			var piece = home.piece
			if not is_instance_valid(piece) or piece.visible or not ARMOR.has(str(piece.name)): continue
			if not home.has("template"): home.template = piece.duplicate()
			piece.queue_free()
			home.piece = null
	# PhysicalRemains.shatter uses our six authored stone pieces as bounded rigid
	# fragments, with the ordinary iron loot path left authoritative.

func restore(actor: Node3D) -> void:
	var entry: Dictionary = entries.get(actor.get_instance_id(), {})
	if entry.is_empty(): return
	cancel_slam(actor)
	for region in entry.armor_cracks.keys(): _clear_armor_crack(entry, str(region))
	entry.armor_sites = []
	actor.set_meta("golem_armor_sites", [])
	for region in entry.armor: entry.armor[region] = ARMOR_HEALTH
	for region in ["chest", "head", "arm_l", "arm_r", "leg_l", "leg_r"]:
		if actor.has_meta("golem_broken_" + region): actor.remove_meta("golem_broken_" + region)
	actor.set_meta("golem_core_exposed", false)
	actor.set_meta("golem_stagger_until", 0.0)
	actor.set_meta("golem_slam_scale", 1.0)
	actor.set_meta("golem_move_scale", 1.0)
	entry.armor_nodes.clear()
	for home in entry.rig.homes:
		var piece = home.piece
		if not is_instance_valid(piece): continue
		piece.visible = true
		if ARMOR.has(str(piece.name)): entry.armor_nodes[str(piece.name)] = piece
	entry.core = actor.find_child("CoreGlow", true, false)
	if entry.core is MeshInstance3D: entry.core_scale = entry.core.scale
	_refresh_core(entry)

func _stone_contact(actor: Node3D, point: Vector3, normal: Vector3, speed: float, tool: String) -> void:
	if game.impact_feedback != null:
		game.impact_feedback.contact(actor, point, normal, speed, tool, "stone")

func _chip_plate(actor: Node3D, plate: Node3D, hit: Vector3) -> void:
	var bounds := _mesh_bounds(plate, Transform3D.IDENTITY)
	if bounds.size.length() < 0.025: return
	var body := RigidBody3D.new()
	body.name = "GolemArmorChip"
	body.collision_layer = 8
	body.collision_mask = 9
	body.mass = clampf(bounds.size.x * bounds.size.y * bounds.size.z * 40.0, 0.15, 1.2)
	body.continuous_cd = true
	body.physics_material_override = PhysicsMaterial.new()
	body.physics_material_override.friction = 0.8
	body.physics_material_override.bounce = 0.18
	var parent: Node = game
	var groups = game.adventure.get("zone_groups") if game.adventure != null else null
	if groups is Dictionary:
		parent = groups.get(str(actor.get_meta("zone", "")), game)
	parent.add_child(body)
	body.global_transform = plate.global_transform
	for child in actor.get_children():
		if child is PhysicsBody3D: body.add_collision_exception_with(child)
	var fragment: Node3D = plate.duplicate()
	fragment.name = "Detached" + str(plate.name)
	body.add_child(fragment)
	fragment.transform = Transform3D.IDENTITY
	fragment.visible = true
	var collider := CollisionShape3D.new()
	var shape := BoxShape3D.new()
	shape.size = bounds.size.max(Vector3.ONE * 0.04)
	collider.shape = shape
	collider.position = bounds.get_center()
	body.add_child(collider)
	var outward := hit - actor.global_position - Vector3.UP
	if outward.length_squared() < 0.04: outward = actor.global_basis.z
	body.linear_velocity = outward.normalized() * 2.0 + Vector3.UP * 1.6
	body.angular_velocity = Vector3(2.6, 3.2, -2.1)
	armor_chips.append({"node":body, "until":game.elapsed + ARMOR_CHIP_LIFETIME})
	while armor_chips.size() > MAX_ARMOR_CHIPS:
		var oldest: Dictionary = armor_chips.pop_front()
		if is_instance_valid(oldest.node): oldest.node.queue_free()

func _mesh_bounds(node: Node3D, relative: Transform3D) -> AABB:
	var bounds := AABB()
	var found := false
	if node is MeshInstance3D and node.mesh != null:
		bounds = relative * node.mesh.get_aabb()
		found = true
	for child in node.get_children():
		if not child is Node3D: continue
		var child_bounds := _mesh_bounds(child, relative * child.transform)
		if child_bounds.size.length() < 0.001: continue
		bounds = bounds.merge(child_bounds) if found else child_bounds
		found = true
	return bounds

func _prepare_core(entry: Dictionary) -> void:
	var core = entry.core
	if not core is MeshInstance3D or not is_instance_valid(core): return
	entry.core_scale = core.scale
	entry.core_intact_material = core.material_override
	var source: Material = core.material_override
	if source == null and core.mesh != null and core.mesh.get_surface_count() > 0:
		source = core.mesh.surface_get_material(0)
	if not source is StandardMaterial3D: return
	var source_standard: StandardMaterial3D = source
	# Duplicate the imported PBR material. Albedo/normal/ORM/emission maps and
	# UVs stay intact; only the core's light energy rises when the weakpoint opens.
	var exposed: StandardMaterial3D = source_standard.duplicate(true)
	exposed.emission_enabled = true
	exposed.emission_energy_multiplier = maxf(1.8, source_standard.emission_energy_multiplier * 1.8)
	entry.core_exposed_material = exposed

func _refresh_core(entry: Dictionary) -> void:
	var core = entry.core
	if not core is MeshInstance3D or not is_instance_valid(core): return
	core.material_override = entry.core_exposed_material if entry.actor.get_meta("golem_core_exposed", false) and entry.core_exposed_material != null else entry.core_intact_material
