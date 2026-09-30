extends SceneTree

const Meteor = preload("res://landscape_meteor.gd")
const Melee = preload("res://melee_contact.gd")
const Hard = preload("res://hard_surface_contact.gd")

class FakeGrips:
	var grips := {}
	var adjusting := {}

class FakeAdventure:
	var pulses := 0
	func haptic(_hand, _kind) -> void: pulses += 1
	func hurt_enemy(target,damage: float,_hand,_impulse,_damage_type,_point) -> void:
		target.set_meta("hp",float(target.get_meta("hp",100.0))-damage)

class FakeBuilder:
	var meteor
	var mines := 0
	func mine_meteor(_target, point: Vector3, tool_id: String, speed: float, normal: Vector3 = Vector3.ZERO) -> bool:
		var reward: Dictionary = meteor.strike(point,tool_id,speed*0.45,normal)
		if reward.get("ok",false): mines += 1
		return reward.get("ok",false)

class FakeGame extends Node3D:
	var held := {}
	var grips := FakeGrips.new()
	var desktop_hand := Node3D.new()
	var vr := true
	var atelier = null
	var sunfall = null
	var guardians = null
	var skeleton_structure = null
	var impact_feedback = null
	var last_inputs := {}
	var adventure := FakeAdventure.new()
	var world_builder := FakeBuilder.new()
	var camera := Camera3D.new()
	func _owner(collider): return collider

func _initialize() -> void: call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var game := FakeGame.new()
	root.add_child(game)
	game.add_child(game.desktop_hand)
	game.add_child(game.camera)
	var meteor := Meteor.new()
	game.add_child(meteor)
	meteor.setup(Meteor.make_record(Vector2.ZERO,77,0.0),false)
	game.world_builder.meteor=meteor
	var item := Node3D.new()
	item.set_meta("kind","weapon")
	item.set_meta("id","quarry_pick")
	item.set_meta("combat_mass",2.1)
	game.add_child(item)
	game.held["vr_right"]=item
	var vr_hand := Node3D.new()
	game.add_child(vr_hand)
	game.grips.grips["vr_right"]={"hand":vr_hand}
	var melee := Melee.new()
	game.add_child(melee)
	melee.setup(game)
	var events: Array[Dictionary] = []
	melee.hard_surface_contact.connect(func(event): events.append(event))
	var authored: Node3D = load("res://weapons/stonewhisper.glb").instantiate()
	authored.set_meta("id","quarry_pick")
	game.add_child(authored)
	var actual_tip := authored.find_child("PickTipRight",true,false) as Node3D
	if actual_tip == null or Hard.regions(authored)[0].local.distance_to(authored.to_local(actual_tip.global_position)) > 0.005:
		failures.append("pick point does not follow authored tip marker")
	await physics_frame
	# A long between-frame swing crosses the complete rock. The earliest swept
	# functional point must stop even though the final pose is inside it.
	item.position=Vector3(3.0,0.65,0)
	melee.tick(0.016)
	item.position.x=1.0
	melee.tick(0.016)
	var track: Dictionary=melee.tracks.get(item.get_instance_id(),{})
	if game.world_builder.mines != 1: failures.append("swept pick point failed to mine")
	if track.get("block",{}).is_empty(): failures.append("successful mine did not arrest held pick")
	if events.is_empty() or events[0].get("strike_region","") not in ["pick_point","opposite_point"]:
		failures.append("point region not reported")
	var arrested: Vector3=item.to_global(Hard.regions(item)[1].local)
	if arrested.x < 1.5 or arrested.x > 2.15: failures.append("pick penetrated far past visible rock")
	melee.tick(0.016)
	melee.tick(0.033)
	if game.world_builder.mines != 1: failures.append("embedded pick farmed repeated rewards")
	item.position.x += 0.8
	melee.tick(0.016)
	if not track.get("block",{}).is_empty(): failures.append("outward pull did not release pick")
	# A shaft-first approach is still solid contact, but cannot mine.
	item.position=Vector3(0,0.65,3.0)
	melee.tracks.erase(item.get_instance_id())
	melee.tick(0.033)
	item.position.z=1.1
	melee.tick(0.033)
	if game.world_builder.mines != 1: failures.append("wooden shaft mined rock")
	if events.is_empty() or events[-1].get("strike_region","") not in ["shaft","handle"]:
		failures.append("shaft region not reported")
	item.position=Vector3(3.0,0.65,0)
	melee.tracks.erase(item.get_instance_id())
	melee.tick(0.033)
	item.position.x=1.0
	melee.tick(0.033)
	if game.world_builder.mines != 2: failures.append("second 30 Hz point stroke did not mine once")
	melee.tick(0.033)
	if game.world_builder.mines != 2: failures.append("30 Hz embedded stroke mined twice")
	var normal := Vector3.RIGHT
	var plan: Dictionary=Hard.response(meteor.collider,item,Vector3.ZERO,normal,Vector3.LEFT*2.0,2.0,"pick_point")
	if not plan.block or plan.bite <= 0 or plan.material != "star_iron": failures.append("sharp normal-entry bite")
	var scrape: Dictionary=Hard.response(meteor.collider,item,Vector3.ZERO,normal,Vector3.FORWARD*2.0,2.0,"shaft")
	if scrape.block or scrape.bite != 0: failures.append("shaft scrape embedded")
	var shaft_hit: Dictionary=Hard.response(meteor.collider,item,Vector3.ZERO,normal,Vector3.LEFT*2.0,2.0,"shaft")
	if not shaft_hit.block or shaft_hit.bite != 0 or shaft_hit.sharp or shaft_hit.energy >= plan.energy:
		failures.append("shaft contact failed to arrest with reduced energy")
	var axe := Node3D.new()
	axe.set_meta("id","woodland_axe")
	axe.set_meta("combat_mass",1.65)
	game.add_child(axe)
	axe.basis = Basis(Vector3.UP,PI)
	var wood := Node3D.new()
	wood.set_meta("kind","enemy")
	wood.set_meta("enemy_type","ent")
	wood.set_meta("hp",100.0)
	wood.set_meta("alive",true)
	game.add_child(wood)
	var edge_wood: Dictionary=Hard.response(wood,axe,Vector3(0.2,0.9,0),normal,Vector3.LEFT*2.4,2.4)
	if edge_wood.material != "wood" or edge_wood.strike_region != "blade_edge" or edge_wood.bite <= 0 or not edge_wood.block:
		failures.append("axe edge did not bite Ent timber")
	var golem := Node3D.new()
	golem.set_meta("kind","enemy")
	golem.set_meta("enemy_type","golem")
	golem.set_meta("hp",100.0)
	golem.set_meta("alive",true)
	game.add_child(golem)
	var edge_stone: Dictionary=Hard.response(golem,axe,Vector3.ZERO,normal,Vector3.LEFT*2.4,2.4)
	if edge_stone.material != "stone" or edge_stone.bite != 0 or edge_stone.hardness <= edge_wood.hardness:
		failures.append("axe edge penetrated hard golem stone")
	var timber := Node3D.new()
	timber.set_meta("kind","resource")
	timber.set_meta("requires","chop")
	game.add_child(timber)
	if Hard.material_for(timber) != "wood": failures.append("choppable resource is not wood")
	var curtain := StaticBody3D.new()
	curtain.set_meta("surface_material", "cloth")
	game.add_child(curtain)
	if Hard.material_for(curtain) != "": failures.append("soft surface metadata became hard stone")
	var glass := StaticBody3D.new()
	glass.set_meta("surface_material", "glass")
	game.add_child(glass)
	var glass_hit: Dictionary = Hard.response(glass,axe,Vector3.ZERO,normal,Vector3.LEFT*2.4,2.4)
	if glass_hit.material != "glass" or glass_hit.bite != 0: failures.append("glass metadata ignored")
	var skeleton := Node3D.new()
	skeleton.set_meta("kind","enemy")
	skeleton.set_meta("enemy_type","skeleton")
	skeleton.set_meta("hp",100.0)
	skeleton.set_meta("alive",true)
	game.add_child(skeleton)
	var edge_bone: Dictionary=Hard.response(skeleton,axe,Vector3.ZERO,normal,Vector3.LEFT*2.4,2.4)
	if edge_bone.material != "bone" or edge_bone.bite <= 0 or edge_bone.block:
		failures.append("bone response overrode structural lodge result")
	axe.basis = Basis.IDENTITY
	var poll_wood: Dictionary=Hard.response(wood,axe,Vector3.ZERO,normal,Vector3.LEFT*2.4,2.4)
	if poll_wood.strike_region != "axe_poll" or poll_wood.bite != 0 or poll_wood.sharp:
		failures.append("axe poll acted like blade edge")
	if scrape.sharp:
		failures.append("non-tip pick strike transferred full tip energy")
	axe.basis = Basis(Vector3.UP,PI)
	var contact_point := Vector3(0.2,0.9,0)
	var previous_events := events.size()
	var bone_completed: bool=melee.strike(skeleton,contact_point,normal,2.4,vr_hand,axe)
	if events.size() != previous_events+1 or events[-1].material != "bone" or events[-1].normal != normal or events[-1].point != contact_point or events[-1].completed != bone_completed:
		failures.append("skeleton lost exact physical contact event")
	previous_events = events.size()
	var ent_completed: bool=melee.strike(wood,contact_point,normal,2.4,vr_hand,axe)
	if events.size() != previous_events+1 or events[-1].material != "wood" or events[-1].normal != normal or events[-1].completed != ent_completed:
		failures.append("Ent lost exact physical contact event")
	previous_events = events.size()
	var golem_completed: bool=melee.strike(golem,contact_point,normal,2.4,vr_hand,axe)
	if events.size() != previous_events+1 or events[-1].material != "stone" or events[-1].bite != 0 or events[-1].completed != golem_completed:
		failures.append("golem stone lost exact blocked contact event")
	var pose := Hard.desktop_pose(Transform3D.IDENTITY,Transform3D(Basis.IDENTITY,Vector3(1,0,0)),0.6)
	if pose.origin.length_squared() > 0.0001: failures.append("FPS contact did not dwell")
	if not melee.desktop_hard_contact(item,meteor.collider,Vector3.ZERO,Vector3.BACK,2.4,
			Transform3D.IDENTITY,true): failures.append("FPS hard contact not latched")
	if not melee.desktop_contact_active(item) or melee.desktop_contact_pose(item,Transform3D(Basis.IDENTITY,Vector3(1,0,0)),0.6).origin.length_squared() > 0.0001:
		failures.append("FPS held pose did not arrest at contact")
	var late_pose: Transform3D=melee.desktop_contact_pose(item,Transform3D(Basis.IDENTITY,Vector3(1,0,0)),0.95)
	if late_pose.origin.x < 0.7: failures.append("FPS pose did not withdraw")
	melee.clear_desktop_contact()
	if melee.desktop_contact_active(item): failures.append("FPS contact failed to reset")
	print("HARD_SURFACE_CONTACT_RESULT ",failures)
	quit(0 if failures.is_empty() else 1)
