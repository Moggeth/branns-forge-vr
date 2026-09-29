extends Node
## Native adventure simulation. Generated scripts remain in the service sandbox.
const Horizon = preload("res://horizon.gd")
const OrchardHorizon = preload("res://orchard_vfx/orchard_horizon.gd")
const Navigation = preload("res://landscape_navigation.gd")
const TOOL_NAMES = {"apprentice_hammer":"Copperpot’s Promise", "woodland_axe":"Orchard’s Edge", "quarry_pick":"Stonewhisper", "bomb_glove":"Pocket Thunder", "grappling_hook":"Swallow Line", "spore_lantern":"Mooncap Lantern", "crystal_resonator":"Hollow’s Song", "ember_gauntlet":"The Last Hearth"}
const ORDER = ["apprentice_hammer", "woodland_axe", "quarry_pick", "bomb_glove", "grappling_hook", "spore_lantern", "crystal_resonator", "ember_gauntlet"]
const ZONES = ["forge_yard","sandstone_quarry","enchanted_kitchen","pinewood_ruins","mushroom_glade","crystal_hollow","sky_garden","ember_foundry","orchard_highlands","gloamfen","starfall_ridge","cloudbreak_keep"]
var game
var zone = "forge_yard"
var selected = "bomb_glove"
var hp = 100.0
var dying = false
var formation = {}
var ready_bombs = {}
var motion = {}
var thrown = []
var cache: Node3D
var panel: Label3D
var overlay: Label
var attack_at = 0.0
var local_resources = {}
var operation = false
var special_at = 0.0
var test_mode = false
var zone_groups = {}
var last_interaction = {"phase":"activate","hand":"right","squeeze":0.0,"formationSeconds":0.6}
var hollow: Node
var environment_grade_defaults: Dictionary = {}

func setup(owner_game):
	game = owner_game
	var world: WorldEnvironment = game.get_node_or_null("AdventureEnvironment") as WorldEnvironment
	if world != null:
		for property in ["tonemap_exposure", "tonemap_white", "ambient_light_source", "ambient_light_sky_contribution", "fog_mode", "fog_light_energy", "fog_sun_scatter", "fog_aerial_perspective", "fog_sky_affect", "fog_height", "fog_height_density", "adjustment_enabled", "adjustment_contrast", "adjustment_saturation"]:
			environment_grade_defaults[property] = world.environment.get(property)
	# Every core destination has one static, collision-free landscape mesh. Its zone
	# root is already culled on travel, so distant neighbouring rings never overlap.
	for horizon_zone in ZONES:
		if not game.scene.zones.has(horizon_zone): continue
		var horizon_root: Node3D = game.scene.zones[horizon_zone].root
		var horizon: Node3D
		if horizon_zone == "orchard_highlands":
			horizon = OrchardHorizon.new()
			horizon.name = "OrchardHorizon"
			horizon_root.add_child(horizon)
			for band in horizon.get_children(): band.add_to_group("distant_horizon")
		else:
			horizon = Horizon.build(horizon_zone,horizon_root)
			horizon.get_node("HorizonMesh").add_to_group("distant_horizon")
		game.scene.zones[horizon_zone]["horizon"] = horizon
	panel = Label3D.new()
	game.camera.add_child(panel)
	panel.position = Vector3(0,-0.34,-1.7)
	panel.font_size = 21
	panel.pixel_size = 0.0011
	panel.modulate = Color("ffebbb")
	panel.no_depth_test = true
	panel.visible = game.vr
	overlay = Label.new()
	game.hud.get_parent().add_child(overlay)
	overlay.custom_minimum_size.x=450
	overlay.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	overlay.add_theme_font_size_override("font_size",14)
	overlay.add_theme_color_override("font_color",Color("ffebbb"))
	for hand in game.hands: build_hand(hand)
	for enemy in game.scene.get("enemies", []):
		enemy.set_meta("alive", true)
		enemy.set_meta("home", enemy.global_position)
		var health={"skeleton":66,"wisp":44,"golem":110,"boss":440}.get(str(enemy.get_meta("enemy_type","skeleton")),66)
		enemy.set_meta("hp",health)
		enemy.set_meta("max_hp",health)
		enemy.set_meta("damage",30 if str(enemy.get_meta("enemy_type",""))=="boss" else 15)
		enemy.set_meta("attack_at", 0.0)
		enemy.set_meta("id", "enemy-"+str(enemy.get_instance_id()))
	# Parent visibility preserves each resource/enemy's own harvested/dead state.
	for zone_id in game.scene.get("zones",{}):
		var container=Node3D.new()
		container.name="LiveZone_"+zone_id
		game.add_child(container)
		zone_groups[zone_id]=container
	for child in game.get_children():
		if not child is Node3D or child==game.rig or child is DirectionalLight3D or child in zone_groups.values(): continue
		var child_zone=str(child.get_meta("zone","forge_yard"))
		if child in game.scene.rats: child_zone="enchanted_kitchen"
		for zone_id in game.scene.get("zones",{}):
			if game.scene.zones[zone_id].root==child: child_zone=zone_id
		if zone_groups.has(child_zone): child.reparent(zone_groups[child_zone])
	hollow = preload("res://hollow_challenge.gd").new()
	add_child(hollow)
	hollow.setup(game, zone_groups.get("crystal_hollow"))
	_apply_zone_environment("forge_yard")
	game._notice("Fire is ready from the start: desktop 1 then right-click, or grip Copperpot's Promise in VR and press trigger for Forge Pulse. Only fire hurts ghosts. Pocket Thunder: grip empty hand, hold trigger, release grip to throw.",12)

func tick(delta):
	if hollow != null: hollow.tick(delta, zone)
	var resource_text = ""
	for key in game.state.get("resources",local_resources):
		var count = int(game.state.get("resources",local_resources)[key])
		if count > 0: resource_text += key.replace("_"," ")+" "+str(count)+"   "
	var text = "%s · Health %d/100%s" % [zone.replace("_"," ").capitalize(),ceili(hp)," · "+resource_text if not resource_text.is_empty() else ""]
	if game.quests!=null and not game.quests.data.is_empty(): text+=" · Level "+str(game.quests.data.get("level",1))
	text += "\n" + _requirements()
	if zone in ["pinewood_ruins", "crystal_hollow"]:
		text += "\nGhosts: only fire hurts them. Copperpot's Promise: desktop 1 then right-click; VR grip hammer then trigger."
	panel.text = text
	overlay.text = "%s · Health %d/100" % [zone.replace("_"," ").capitalize(),ceili(hp)]
	if game.quests!=null and not game.quests.data.is_empty(): overlay.text+=" · Level "+str(game.quests.data.get("level",1))
	overlay.text += "\n" + _requirements()
	if zone in ["pinewood_ruins", "crystal_hollow"]:
		overlay.text += "\nGhosts: only fire hurts them. Copperpot's Promise: press 1, then right-click for Forge Pulse."
	for hand in game.hands + [game.desktop_hand]:
		var key = str(hand.get_instance_id())
		var last = motion.get(key,{"position":hand.global_position,"rotation":hand.global_rotation})
		var velocity: Vector3 = (hand.global_position-last.position) / maxf(delta,0.001)
		var angular: Vector3 = (hand.global_rotation-last.rotation) / maxf(delta,0.001)
		if hand is XRController3D:
			var pose = hand.get_pose()
			if pose != null and pose.has_tracking_data:
				velocity = game.rig.global_basis * pose.linear_velocity
				angular = game.rig.global_basis.orthonormalized() * pose.angular_velocity
		motion[key] = {"position":hand.global_position,"rotation":hand.global_rotation,"velocity":velocity.limit_length(16),"angular":angular.limit_length(20)}
		game.tuning.sample(hand,velocity.limit_length(24),angular.limit_length(20))
		if formation.has(key):
			var bomb = ready_bombs.get(key)
			var progress = clampf((game.elapsed-float(formation[key]))/float(bomb.get_meta("formation_seconds",0.45)),0,1) if is_instance_valid(bomb) else 0.0
			if is_instance_valid(bomb): game.bomb_art.update_forming(bomb,progress)
			if progress >= 1 and is_instance_valid(bomb) and not bomb.get_meta("ready",false):
				bomb.set_meta("ready",true)
				haptic(hand,"ready")
	for i in range(thrown.size()-1,-1,-1):
		var entry = thrown[i]
		if not is_instance_valid(entry.node):
			thrown.remove_at(i)
			continue
		entry.velocity += Vector3.DOWN * delta * 9.8
		var start: Vector3 = entry.node.global_position
		var end: Vector3 = start + entry.velocity*delta
		var query = PhysicsRayQueryParameters3D.create(start,end,1)
		var hit = game.get_world_3d().direct_space_state.intersect_ray(query)
		entry.node.global_position = end if hit.is_empty() else hit.position + hit.normal*0.13
		entry.node.rotation += entry.angular*delta
		if not hit.is_empty() or entry.node.position.y < -10:
			game._set_collisions(entry.node,true)
			var target = game._owner(hit.get("collider"))
			if target != null and target.get_meta("kind","")=="apple" and game.apples!=null:
				game.apples.impact(target,entry.velocity.length(),hit.position,entry.velocity)
			elif target != null and target.get_meta("kind","")=="pumpkin" and game.pumpkins!=null:
				game.pumpkins.impact(target,entry.node,hit.position,hit.normal,entry.velocity)
			elif target != null: interact(target,entry.tool,entry.hand)
			haptic(entry.hand,"impact")
			thrown.remove_at(i)
	if not test_mode: _enemies(delta)
	if cache != null and is_instance_valid(cache): cache.rotation.y += delta*0.35

func _requirements() -> String:
	match int(game.state.get("tier",1)):
		1: return "Next: 3 lumber + 3 stone OR 3 rat tails → workshop buckets + lever → Tinker’s Bench"
		2: return "Next: 3 iron + 3 haunted bones → workshop buckets + lever → Enchanted Anvil"
		3: return "Next: defeat the Ember Warden, put 1 ember core in the bucket + pull the lever → Everburning Forge"
	return "The eternal forge is lit. Brann can forge world-bending inventions."

var destination_index = 1
func keyboard(event):
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			var hollow_hit = game._ray(game.camera,4)
			var hollow_target = game._owner(hollow_hit.get("collider"))
			if hollow_target != null and str(hollow_target.get_meta("kind","")).begins_with("hollow_"):
				var held_tool = game.held.get(str(game.desktop_hand.get_instance_id()))
				if hollow_target.get_meta("kind","") == "hollow_vault" or is_instance_valid(held_tool):
					interact(hollow_target,str(held_tool.get_meta("id",selected)) if is_instance_valid(held_tool) else "hand",game.desktop_hand)
					return true
		if selected == "bomb_glove" and not (game.echo_bells!=null and game.echo_bells.busy(game.desktop_hand)) and not game.held.has(str(game.desktop_hand.get_instance_id())) and not game.living.claims_trigger(game.desktop_hand) and not ((game.playful_tools!=null and game.playful_tools.claims_trigger(game.desktop_hand)) or (game.magnetic_wand!=null and game.magnetic_wand.claims_trigger(game.desktop_hand))):
			if event.pressed:
				var hit = game._ray(game.camera,8)
				var target = game._owner(hit.get("collider"))
				if target != null and (target.has_meta("action") or target.has_meta("living_package")): return false
				begin_bomb(game.desktop_hand)
			else: release(game.desktop_hand,true)
			return true
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode >= KEY_1 and event.physical_keycode <= KEY_8:
			select_tool(ORDER[event.physical_keycode-KEY_1],game.desktop_hand)
			return true
		match event.physical_keycode:
			KEY_F:
				destination_index = (destination_index+1)%ZONES.size()
				game._notice("Destination: "+ZONES[destination_index].replace("_"," ")+" · G to travel")
			KEY_G: travel(ZONES[destination_index])
			KEY_U: upgrade()
	return false

func button(action: String) -> bool:
	if action.begins_with("travel:"):
		travel(action.trim_prefix("travel:"))
		return true
	if action.begins_with("tool:"):
		select_tool(action.trim_prefix("tool:"),game.hands[1] if game.vr and game.hands.size()>1 else game.desktop_hand)
		return true
	if action == "upgrade":
		game._notice("Bring materials from your hip pouch to the Living Workshop buckets on the right, then grip and pull the lever.",12)
		return true
	return false

func select_tool(id: String, hand: Node3D):
	if operation: return
	if not TOOL_NAMES.has(id): return
	var tier = 1 if ORDER.find(id)<4 else (2 if ORDER.find(id)<6 else (3 if id=="crystal_resonator" else 4))
	if tier > int(game.state.get("tier",1)):
		game._notice("Brann needs a Tier %d workshop for %s. %s"%[tier,TOOL_NAMES[id],_requirements()],10)
		return
	var owned = ORDER.find(id)<4
	for item in game.state.get("tools",[]):
		if item.get("id","")==id: owned=true
	if game.online and not owned:
		operation = true
		await game._send_context()
		var response = await game._request("/api/vr/craft",{"id":id})
		operation = false
		if response.has("error"):
			game._notice(str(response.error))
			return
		await game._poll()
	_equip_tool(id,hand)

func dev_spawn_tool(id: String, hand: Node3D):
	if not TOOL_NAMES.has(id): return
	game.qol.cancel_forming()
	_equip_tool(id,hand,true)
	print("DEV_SPAWN tool=",id," tier=",game.state.get("tier",1))

func _equip_tool(id: String, hand: Node3D, developer: bool = false):
	release(hand,false)
	selected = id
	if id == "bomb_glove":
		game._notice("Pocket Thunder · grip an empty hand THEN press and hold trigger. Release grip to throw.")
		return
	var tool=null
	for existing in game.get_tree().get_nodes_in_group("pickup"):
		if is_instance_valid(existing) and existing.get_meta("kind","")=="weapon" and existing.get_meta("id","")==id and existing.get_meta("dev_spawn",false)==developer:
			tool=existing
			break
	if tool==null:
		tool=_tool_model(id)
		tool.set_meta("dev_spawn",developer)
		game.add_child(tool)
	for item in game.state.get("tools",[]):
		if item.get("id","")==id: tool.set_meta("haptics",item.get("haptics",{}))
	for key in game.held.keys():
		if game.held[key]==tool: game.held.erase(key)
	game.grips._attach(hand,tool)
	game._set_collisions(tool,false)
	haptic(hand,"ready")
	game._notice(("Dev spawn · " if developer else "Equipped ")+TOOL_NAMES[id])

func _tool_model(id: String) -> Node3D:
	var node = Node3D.new()
	node.set_meta("kind","weapon")
	node.set_meta("id",id)
	node.set_meta("combat_mass",{"woodland_axe":1.65,"quarry_pick":2.1,"apprentice_hammer":2.45,"crystal_resonator":3.0}.get(id,1.2))
	node.set_meta("builtin",true)
	node.set_meta("grip_min",-0.03)
	node.set_meta("grip_max",0.46)
	node.set_meta("display_name",TOOL_NAMES[id])
	node.add_to_group("pickup")
	if id=="woodland_axe":
		# The authored edge is +X. In the Knuckles grip +X faces along the
		# pointing finger; a 180-degree art flip made it face the player.
		var axe_mount=Node3D.new()
		axe_mount.name="AxeHeadOrientation"
		node.add_child(axe_mount)
		var authored_axe="res://weapons/orchards_edge.glb"
		if ResourceLoader.exists(authored_axe):
			var axe_scene=load(authored_axe) as PackedScene
			if axe_scene!=null:
				var axe_visual=axe_scene.instantiate()
				axe_visual.name="OrchardsEdge"
				axe_mount.add_child(axe_visual)
			else: preload("res://orchid_refined.gd").new().build(axe_mount)
		else: preload("res://orchid_refined.gd").new().build(axe_mount)
		axe_mount.rotation.y=0.0
		node.set_meta("tip",Vector3(0.43,0.62,0))
		node.set_meta("alternate_ability","Hold trigger while swinging to drive a heavier cleave through bones and timber.")
		game._collider(node,Vector3(0.52,0.9,0.15),Vector3(0.18,0.4,0))
		return node
	if id=="crystal_resonator":
		preload("res://hero_hammer.gd").new().build(node)
		game._collider(node,Vector3(0.35,0.7,0.2),Vector3(0,0.35,0))
		return node
	if id=="apprentice_hammer":
		preload("res://workshop_details.gd").hammer(node)
		game._collider(node,Vector3(0.46,0.73,0.22),Vector3(0,0.32,0))
		return node
	if id in ["quarry_pick","grappling_hook","spore_lantern","ember_gauntlet"]:
		preload("res://tool_details.gd").build(node,id)
		game._collider(node,Vector3(0.48,0.85,0.32),Vector3(0,0.4,0))
		return node
	var wood = Color("754622")
	var metal = Color("b3ced4")
	_box(node,Vector3(0,0.28,0),Vector3(0.055,0.65,0.065),wood)
	if id=="woodland_axe":
		_blade(node,[Vector2(-0.06,0.72),Vector2(0.15,0.8),Vector2(0.38,0.78),Vector2(0.44,0.49),Vector2(0.22,0.43),Vector2(0.12,0.57),Vector2(-0.06,0.57)],0.065,metal)
		_blade(node,[Vector2(0.35,0.77),Vector2(0.38,0.78),Vector2(0.44,0.49),Vector2(0.4,0.48)],0.075,Color("e4f8eb"))
	elif id=="quarry_pick":
		_blade(node,[Vector2(-0.43,0.41),Vector2(-0.25,0.65),Vector2(-0.06,0.72),Vector2(0.2,0.68),Vector2(0.43,0.51),Vector2(0.23,0.58),Vector2(-0.06,0.61),Vector2(-0.24,0.57)],0.08,metal)
	elif id=="grappling_hook":
		for x in [-1,1]:
			var hook = _box(node,Vector3(x*0.12,0.58,0),Vector3(0.08,0.3,0.08),metal)
			hook.rotation.z = x*-0.5
	else:
		game._sphere(node,Vector3(0,0.6,0),0.18,Color("bd86ed") if id!="ember_gauntlet" else Color("ff8029"))
	game._sphere(node,Vector3(0,0.2,0),0.06,Color("e6b257"))
	for i in range(6):
		var wrap = _box(node,Vector3(0,0.03+i*0.039,0),Vector3(0.068,0.018,0.081),Color("362c36"))
		wrap.rotation.y=i*0.15
	game._sphere(node,Vector3(0,0.62,0.075),0.037,Color("82e5c1"))
	game._collider(node,Vector3(0.35,0.7,0.2),Vector3(0,0.35,0))
	return node

func _blade(parent,outline:Array,depth:float,color:Color):
	var vertices = PackedVector3Array()
	for z in [-depth/2,depth/2]:
		for point in outline: vertices.append(Vector3(point.x,point.y,z))
	var n=outline.size()
	var indices=PackedInt32Array()
	for i in range(1,n-1):
		indices.append_array(PackedInt32Array([0,i+1,i,n,n+i,n+i+1]))
	for i in range(n):
		var j=(i+1)%n
		indices.append_array(PackedInt32Array([i,j,j+n,i,j+n,i+n]))
	var surface=SurfaceTool.new()
	surface.begin(Mesh.PRIMITIVE_TRIANGLES)
	for index in indices: surface.add_vertex(vertices[index])
	surface.generate_normals()
	var mesh=MeshInstance3D.new()
	mesh.mesh=surface.commit()
	var material=StandardMaterial3D.new()
	material.albedo_color=color
	material.metallic=0.65
	material.roughness=0.35
	mesh.material_override=material
	parent.add_child(mesh)

func _box(parent,position,size,color):
	var mesh = MeshInstance3D.new()
	var shape = BoxMesh.new()
	shape.size = size
	mesh.mesh = shape
	var material = StandardMaterial3D.new()
	material.albedo_color = color
	mesh.material_override = material
	parent.add_child(mesh)
	mesh.position = position
	return mesh

func begin_bomb(hand):
	var key = str(hand.get_instance_id())
	if formation.has(key) or game.held.has(key): return
	formation[key] = game.elapsed
	var orb = game.bomb_art.create_bomb(game.hand_socket(hand),game.tuning.value("bomb.radius"))
	game.bomb_art.update_forming(orb,0.0)
	orb.set_meta("formation_seconds",game.tuning.value("bomb.formation_seconds"))
	orb.set_meta("ready",false)
	ready_bombs[key] = orb
	haptic(hand,"formation")

func release(hand,desktop=false):
	if game.guardians!=null: game.guardians.cancel_grip(hand)
	for lantern in game.forge_lanterns:
		if lantern.release(hand): return
	if game.apples!=null and game.apples.release(hand): return
	if game.hearth_torch!=null and game.hearth_torch.release(hand): return
	if game.ember_gallery!=null and game.ember_gallery.release(hand): return
	if game.echo_bells!=null and game.echo_bells.release(hand): return
	if game.cargo_playground!=null and game.cargo_playground.release(hand): return
	if game.magnetic_wand!=null and game.magnetic_wand.release(hand): return
	if game.playful_tools!=null and game.playful_tools.release(hand): return
	if game.living!=null and game.living.release(hand): return
	if game.firecraft!=null and game.firecraft.release(hand): return
	if game.workshop!=null and game.workshop.release(hand): return
	if game.enchantments!=null and game.enchantments.release(hand): return
	if game.enchantments!=null and game.enchantments.park_weapon(hand): return
	if game.siegebird!=null and game.siegebird.release(hand): return
	var key = str(hand.get_instance_id())
	if formation.has(key):
		var orb = ready_bombs.get(key)
		formation.erase(key)
		ready_bombs.erase(key)
		if is_instance_valid(orb):
			var ready = orb.get_meta("ready",false)
			orb.queue_free()
			if ready:
				var velocity: Vector3 = game.tuning.release_velocity(hand,desktop)
				throw_bomb(hand.global_position,velocity,motion.get(key,{}).get("angular",Vector3.ZERO),hand)
				haptic(hand,"release")
	if game.held.has(key):
		if game.grips.release(hand): return
		var weapon = game.held[key]
		game.held.erase(key)
		game.previous_tips.erase(key)
		if is_instance_valid(weapon):
			if weapon.get_meta("remains",false):
				game.remains.release(weapon,game.tuning.release_velocity(hand,desktop),motion.get(key,{}).get("angular",Vector3.ZERO))
				haptic(hand,"release")
				return
			var velocity = game.tuning.release_velocity(hand,desktop)
			game.tool_physics.drop(weapon,velocity,motion.get(key,{}).get("angular",Vector3.ZERO))
			haptic(hand,"release")

func throw_bomb(position: Vector3,velocity: Vector3,angular: Vector3,hand):
	var body = RigidBody3D.new()
	body.collision_layer = 2
	body.collision_mask = 1
	body.mass = 0.3
	body.contact_monitor = true
	body.max_contacts_reported = 4
	body.continuous_cd = true
	game.add_child(body)
	body.add_to_group("magic_bomb")
	body.set_meta("spawned_at",game.elapsed)
	body.set_meta("fuse_at",game.elapsed+game.tuning.value("bomb.fuse_seconds"))
	body.set_meta("blast_radius",game.tuning.value("bomb.blast_radius"))
	body.set_meta("damage",game.tuning.value("bomb.damage"))
	body.set_meta("self_ratio",game.tuning.value("bomb.self_damage_ratio"))
	body.gravity_scale=game.tuning.value("bomb.gravity")
	var physics_material=PhysicsMaterial.new()
	physics_material.bounce=game.tuning.value("bomb.bounce")
	physics_material.friction=0.65
	body.physics_material_override=physics_material
	body.global_position = position
	game.bomb_art.create_bomb(body,game.tuning.value("bomb.radius"))
	var collider = CollisionShape3D.new()
	var sphere = SphereShape3D.new()
	sphere.radius = game.tuning.value("bomb.radius")
	collider.shape = sphere
	body.add_child(collider)
	body.linear_velocity = velocity
	body.angular_velocity = angular
	var impact_delay=game.tuning.value("bomb.impact_delay")
	body.body_entered.connect(func(_other):
		haptic(hand,"impact")
		if not body.get_meta("detonating",false):
			body.set_meta("detonating",true)
			body.set_meta("fuse_at",minf(float(body.get_meta("fuse_at",game.elapsed+impact_delay)),game.elapsed+impact_delay))
			_detonate_later(body,hand,impact_delay))
	_detonate_later(body,hand,game.tuning.value("bomb.fuse_seconds"))
	return body

func _detonate_later(body,hand,seconds):
	await game.get_tree().create_timer(seconds).timeout
	if not is_instance_valid(body) or body.get_meta("exploded",false): return
	body.set_meta("exploded",true)
	explode(body.global_position,float(body.get_meta("blast_radius",3.2)),float(body.get_meta("damage",45)),hand,float(body.get_meta("self_ratio",0.65)))
	body.queue_free()

func explode(position:Vector3,radius:float,damage:float,hand=null,self_ratio=-1.0,damage_type="blast"):
	if hollow != null: hollow.blast(position,radius,hand)
	if game.apples!=null: game.apples.blast(position,radius)
	if game.get("fairy")!=null and game.fairy.active and game.fairy.avatar.global_position.distance_to(position)<radius:
		game.fairy.hurt(damage*.5,"Caught in an explosion")
	game.bomb_art.explosion(position,radius,game.tuning.value("vfx.intensity"),game.tuning.value("vfx.duration"),int(game.tuning.value("vfx.spark_count")))
	for enemy in game.scene.get("enemies",[]):
		if is_instance_valid(enemy) and enemy.global_position.distance_to(position)<radius: hurt_enemy(enemy,damage,hand,(enemy.global_position-position+Vector3.UP*0.6).normalized()*3.5,damage_type)
	for rat in game.scene.rats:
		if rat.global_position.distance_to(position)<radius: game._kill_rat(rat)
	for wall in game.scene.get("barriers",[]):
		if is_instance_valid(wall) and wall.visible and wall.global_position.distance_to(position)<radius+1:
			wall.visible = false
			game._set_collisions(wall,false)
			game._notice("The seal shatters. A new path opens.")
	if game.camera.global_position.distance_to(position)<radius:
		take_damage(damage*(game.tuning.value("bomb.self_damage_ratio") if self_ratio<0 else self_ratio),"your bomb")
	haptic(hand,"impact")

func trigger(hand,source) -> bool:
	var key = str(hand.get_instance_id())
	var id = game.held[key].get_meta("id",selected) if game.held.has(key) else selected
	if id=="starter_hammer": id="apprentice_hammer"
	if id=="woodland_axe" and game.held.has(key):
		game.melee.alternate(game.held[key],hand)
		return true
	var hit = game._ray(source,28 if id=="grappling_hook" else 4)
	var target = game._owner(hit.get("collider"))
	if target != null and target.get_meta("kind","")=="cache":
		recover()
		return true
	if target != null and target.get_meta("kind","")=="hollow_vault": return interact(target,"hand",hand)
	if not game.held.has(key) and id!="bomb_glove":
		if target!=null and target.get_meta("kind","")=="resource" and target.get_meta("requires","") in ["","hand","none"]:
			interact(target,"hand",hand)
		else: game._notice("Grip your tool to use it, or choose equipment from the workshop board.")
		return true
	if id=="bomb_glove" and not game.held.has(key):
		if not game.vr: return false
		game._notice("Grip an empty hand, then press and hold trigger to form Pocket Thunder. Release grip to throw.")
		return true
	if target != null and interact(target,id,hand): return true
	if id=="bone_club": return true
	if id in ORDER:
		if game.elapsed<attack_at: return true
		attack_at = game.elapsed+0.5
		var range_limit = 10.0 if id in ["spore_lantern","crystal_resonator","ember_gauntlet"] else 2.8
		for enemy in game.scene.get("enemies",[]):
			var diff: Vector3 = enemy.global_position+Vector3.UP-source.global_position
			if diff.length()<range_limit and diff.normalized().dot(-source.global_basis.z)>0.86:
				if id=="spore_lantern": enemy.set_meta("slow_until",game.elapsed+5)
				hurt_enemy(enemy,45 if id=="ember_gauntlet" else (30 if id=="crystal_resonator" else 22),hand,Vector3.ZERO,"fire" if id=="ember_gauntlet" else "physical")
		for rat in game.scene.rats:
			var diff: Vector3 = rat.global_position-source.global_position
			if diff.length()<2.8 and diff.normalized().dot(-source.global_basis.z)>0.65: game._kill_rat(rat)
		for dummy in game.scene.dummies:
			if dummy.global_position.distance_to(source.global_position)<3: game._dummy_hit(dummy)
		game._effect(source.global_position-source.global_basis.z,Color("f9dc8a"),0.2,0.4)
		haptic(hand,"release")
		return true
	return false

func interact(target,id,hand=null) -> bool:
	var kind = str(target.get_meta("kind",""))
	if kind.begins_with("hollow_") and hollow != null: return hollow.interact(target,id,hand)
	if kind=="anchor":
		if id!="grappling_hook" and id!="ember_gauntlet":
			game._notice("Swallow Line can reach this anchor. Bring Brann a Tier 2 offering.")
		else:
			var destination:Vector3 = target.get_meta("destination",target.global_position)
			game._effect(target.global_position,Color("a6edff"),0.5,0.5)
			var offset:Vector3=game.camera.global_position-game.rig.global_position
			game._move_to(destination-Vector3(offset.x,0,offset.z))
			motion.clear()
			game.tuning.history.clear()
			if game.rig.global_position.distance_to(destination-Vector3(offset.x,0,offset.z))>0.3:
				game._notice("The anchor's landing is obstructed. Try another ledge.")
				return true
			haptic(hand,"ready")
			game._notice("Swallow Line catches. Comfort teleport complete.")
		return true
	if kind=="enemy":
		if game.elapsed>=attack_at:
			attack_at=game.elapsed+0.45
			hurt_enemy(target,35 if id in ["crystal_resonator","ember_gauntlet"] else 22,hand,Vector3.ZERO,"fire" if id=="ember_gauntlet" else "physical")
		return true
	if kind=="resource":
		var requires = str(target.get_meta("requires",""))
		var valid = requires in ["","hand","none"] or (requires in ["axe","chop"] and id=="woodland_axe") or (requires in ["pick","mine"] and id in ["quarry_pick","crystal_resonator"]) or (requires=="magic" and id in ["spore_lantern","crystal_resonator","ember_gauntlet"])
		if valid: gather(target,hand)
		else: game._notice("This needs "+requires+". Choose a tool at Brann's yard.")
		return true
	if kind=="barrier" and ((target.get_meta("requires","") in ["chop","axe"] and id=="woodland_axe") or id in ["crystal_resonator","ember_gauntlet"]):
		target.visible=false
		game._set_collisions(target,false)
		haptic(hand,"impact")
		return true
	return false

func gather(target,hand=null):
	if not target.visible or target.get_meta("collecting",false): return
	target.set_meta("collecting",true)
	var resource = str(target.get_meta("resource",target.get_meta("resource_id","stone")))
	var amount = clampi(int(target.get_meta("amount",3))+int(target.get_meta("resonant_bonus",0)),1,5)
	if target.has_meta("resonant_bonus"): target.remove_meta("resonant_bonus")
	var id = str(target.get_meta("event_id","gather-"+str(Time.get_unix_time_from_system())+"-"+str(target.get_instance_id())))
	target.set_meta("event_id",id)
	var response = await game._request("/api/vr/gather",{"id":id,"resource":resource,"amount":amount})
	if response.has("error"):
		target.set_meta("collecting",false)
		game._notice(str(response.error))
		return
	target.visible=false
	game._set_collisions(target,false)
	game._notice("Collected %d %s. %s"%[amount,resource.replace("_"," "),_requirements()])
	if resource=="apple": hp=minf(100,hp+15)
	haptic(hand,"impact")
	if game.quests!=null: game.quests.ingest(response.get("rpg",{}),true)
	await game._poll()
	await game.get_tree().create_timer(35).timeout
	if is_instance_valid(target) and not target.get_meta("loot",false):
		if target.has_meta("trunk_mesh"):
			target.get_meta("trunk").mesh=target.get_meta("trunk_mesh")
			target.get_meta("trunk").material_override=target.get_meta("trunk_material",WorldZones.mat("825537"))
		for child in target.get_children():
			if str(child.name).begins_with("CutMark"): child.queue_free()
		target.visible=true
		target.set_meta("collecting",false)
		target.remove_meta("event_id")
		game._set_collisions(target,true)

func _enemies(delta):
	for enemy in game.scene.get("enemies",[]):
		if is_instance_valid(enemy) and enemy.get_meta("enemy_type","")=="ghost": continue
		if is_instance_valid(enemy) and enemy.get_meta("director_paused",false): continue
		if not is_instance_valid(enemy) or not enemy.get_meta("alive",true): continue
		if not enemy.is_visible_in_tree(): continue
		var fairy_target=game.get("fairy")!=null and game.fairy.attracts(enemy) and absf(game.fairy.avatar.global_position.y-enemy.global_position.y)<2.8
		enemy.set_meta("fairy_target",fairy_target)
		var destination:Vector3=game.fairy.avatar.global_position if fairy_target else game.camera.global_position
		var diff:Vector3 = destination-enemy.global_position
		diff.y=0
		var distance = diff.length()
		var home:Vector3 = enemy.get_meta("home",enemy.global_position)
		var orchard_ground: bool = zone=="orchard_highlands" and str(enemy.get_meta("zone",""))=="orchard_highlands" and str(enemy.get_meta("enemy_type","skeleton")) not in ["wisp","ghost"] and game.landscape!=null
		if distance>10 or zone=="forge_yard":
			enemy.set_meta("combat_phase","idle")
			enemy.set_meta("attack_damage_done",true)
			if orchard_ground:
				var home_route: Dictionary = _orchard_pursuit(enemy,home)
				if bool(home_route.available):
					enemy.global_position += home_route.direction*minf(delta*0.45,enemy.global_position.distance_to(home))
					_orchard_ground_enemy(enemy)
			else:
				enemy.global_position = enemy.global_position.move_toward(home,delta*0.45)
			continue
		var type = str(enemy.get_meta("enemy_type","skeleton"))
		var speed = (0.48 if type in ["boss","golem"] else 0.72)*game.tuning.value("combat.enemy_speed")
		if type=="skeleton": speed*=float(enemy.get_meta("skeleton_move_scale",1.0))
		if game.elapsed<float(enemy.get_meta("slow_until",0)): speed*=0.25
		var knock:Vector3=enemy.get_meta("knock_velocity",Vector3.ZERO)
		if type=="skeleton" and enemy.get_meta("alive",true):
			knock=Vector3.ZERO
			enemy.set_meta("knock_velocity",Vector3.ZERO)
		if knock.length()>0.02:
			enemy.global_position+=Vector3(knock.x,0,knock.z)*delta
			enemy.set_meta("knock_velocity",knock.move_toward(Vector3.ZERO,delta*7.0))
		var heading: Vector3 = diff.normalized()
		var attack_distance: float = distance
		if orchard_ground:
			var chase: Dictionary = _orchard_pursuit(enemy,destination)
			heading = chase.direction if bool(chase.available) else Vector3.ZERO
			if not bool(chase.available) or float(chase.remaining)>distance+3.0: attack_distance = INF
		if distance>1.8 and str(enemy.get_meta("combat_phase","idle")) not in ["windup","strike"]:
			enemy.global_position += heading*speed*delta
			if orchard_ground: _orchard_ground_enemy(enemy)
		# Procedural enemy faces are authored toward local +Z, unlike Godot cameras.
		if heading.length_squared()>0.001:
			var turn=game.tuning.value("enemy.turn_speed")
			enemy.rotation.y=lerp_angle(enemy.rotation.y,atan2(heading.x,heading.z),clampf(delta*turn,0,1)) if delta>0 else atan2(heading.x,heading.z)
		if type=="boss" and distance<10 and game.elapsed>float(enemy.get_meta("wave_at",0)):
			enemy.set_meta("wave_at",game.elapsed+9)
			_boss_wave(enemy,game.rig.global_position)
		_step_attack(enemy,attack_distance,type)

func _orchard_pursuit(enemy: Node3D, destination: Vector3) -> Dictionary:
	var zone_root: Node3D = game.scene.zones.orchard_highlands.root
	var from_local: Vector3 = zone_root.to_local(enemy.global_position)
	var to_local: Vector3 = zone_root.to_local(destination)
	var terrain = game.landscape
	var transition: Dictionary = terrain.transition
	var dirty: Rect2 = transition.get("bounds", Rect2())
	var result: Dictionary = Navigation.pursuit(terrain.model, enemy.get_meta("orchard_nav", {}),
		Vector2(from_local.x,from_local.z),Vector2(to_local.x,to_local.z),
		terrain.operation_count(),dirty,not transition.is_empty(),game.elapsed)
	enemy.set_meta("orchard_nav",result.state)
	var dir: Vector2 = result.direction
	return {"direction": zone_root.global_basis * Vector3(dir.x,0,dir.y),
		"remaining": result.remaining,"available": result.available}

func _orchard_ground_enemy(enemy: Node3D) -> void:
	var zone_root: Node3D = game.scene.zones.orchard_highlands.root
	var local: Vector3 = zone_root.to_local(enemy.global_position)
	local.y = game.landscape.height_at(Vector2(local.x,local.z))
	enemy.global_position = zone_root.to_global(local)

func _step_attack(enemy,distance,type):
	if not enemy.get_meta("alive",true): return
	if type=="skeleton" and float(enemy.get_meta("skeleton_attack_scale",1.0))<=0.31: return
	var phase=str(enemy.get_meta("combat_phase","idle"))
	if phase=="idle" and distance<2.5:
		enemy.set_meta("attack_fairy",enemy.get_meta("fairy_target",false))
		enemy.set_meta("attack_started",game.elapsed)
		enemy.set_meta("attack_windup",game.tuning.value("enemy.windup"))
		enemy.set_meta("attack_recovery",game.tuning.value("enemy.recovery"))
		enemy.set_meta("attack_damage_done",false)
		phase="windup"
		game._notice(type.capitalize()+" raises its weapon — step back!",2)
	if phase not in ["windup","strike","recovery"]: return
	var age=game.elapsed-float(enemy.get_meta("attack_started",game.elapsed))
	var attack_scale=maxf(0.3,float(enemy.get_meta("skeleton_attack_scale",1.0))) if type=="skeleton" else 1.0
	var windup=float(enemy.get_meta("attack_windup",1.2))/attack_scale
	var recovery=float(enemy.get_meta("attack_recovery",2.5))/attack_scale
	var strike=0.18
	var progress=0.0
	if age<windup:
		phase="windup"
		progress=age/windup*0.65
	elif age<windup+strike:
		phase="strike"
		progress=0.65+(age-windup)/strike*0.15
	elif age<windup+strike+recovery:
		phase="recovery"
		progress=0.8+(age-windup-strike)/recovery*0.2
	else: phase="idle"
	if age>=windup+strike*0.5 and not enemy.get_meta("attack_damage_done",false):
		enemy.set_meta("attack_damage_done",true)
		if enemy.get_meta("attack_fairy",false):
			if game.get("fairy")!=null and game.fairy.active and game.fairy.avatar.global_position.distance_to(enemy.global_position+Vector3.UP)<2.3:
				game.fairy.hurt(float(enemy.get_meta("damage",12)),type+" caught you")
		elif game.camera.global_position.distance_to(enemy.global_position+Vector3.UP)<2.8:
			take_damage(float(enemy.get_meta("damage",12)),type)
	enemy.set_meta("combat_phase",phase)
	enemy.set_meta("combat_progress",progress)

func hurt_enemy(enemy,damage,hand=null,impulse=Vector3.ZERO,damage_type="physical",impact_point=null):
	if enemy.get_meta("enemy_type","")=="ghost":
		if game.firecraft!=null: game.firecraft.hurt_ghost(enemy,damage,damage_type)
		return
	if not enemy.get_meta("alive",true): return
	if game.guardians!=null: damage=game.guardians.filter_damage(enemy,damage,hand,damage_type)
	if game.elapsed<float(enemy.get_meta("exposed_until",-100.0)) and (game.guardians==null or not game.guardians.guardians.has(enemy.get_instance_id())): damage*=1.5
	if game.animation!=null: game.animation.hit(enemy,impulse if impulse.length()>0 else enemy.global_position-game.camera.global_position)
	if game.guardian_authored!=null:
		game.guardian_authored.react_to_hit(enemy,impulse if impulse.length()>0 else enemy.global_position-game.camera.global_position,clampf(float(damage)/35.0,0.15,1.0))
	if str(enemy.get_meta("enemy_type",""))=="boss" and game.elapsed<float(enemy.get_meta("exposed_until",0)): damage*=2
	var health = float(enemy.get_meta("hp",60))-damage
	enemy.set_meta("hp",health)
	# Bone strikes read best at the actual contact. A large chest-centred orb
	# disguised limb failure and made strong chops feel like generic HP damage.
	if str(enemy.get_meta("enemy_type",""))!="skeleton": game._effect(enemy.global_position+Vector3.UP,Color("ffe0a0"),0.3,0.7)
	elif impact_point!=null: game._effect(impact_point,Color("efddba"),0.11,0.16)
	haptic(hand,"impact")
	if health>0:
		game._notice("%s · %d health"%[str(enemy.get_meta("enemy_type","guardian")).capitalize(),ceili(health)],2)
		return
	enemy.set_meta("alive",false)
	if game.quests!=null and not enemy.get_meta("director_spawned",false): game.quests.enemy_defeated(enemy,str(enemy.get_meta("enemy_type","skeleton")))
	enemy.set_meta("combat_phase","dead")
	enemy.set_meta("attack_at",0.0)
	game.remains.shatter(enemy,impulse)
	enemy.visible=false
	game._set_collisions(enemy,false)
	if enemy.get_meta("director_spawned",false):
		game._notice("Director's creature dispersed. Keep moving toward the waystones.",3)
		return
	var loot = enemy.get_meta("loot",{str(enemy.get_meta("resource","haunted_bone")):3})
	for resource in loot:
		var drop = Node3D.new()
		game.add_child(drop)
		drop.global_position=enemy.global_position+Vector3.UP*0.35
		drop.reparent(zone_groups.get(str(enemy.get_meta("zone",zone)),game))
		drop.set_meta("kind","resource")
		drop.set_meta("resource",resource)
		drop.set_meta("requires","hand")
		drop.set_meta("amount",loot[resource])
		drop.set_meta("loot",true)
		drop.add_to_group("pickup")
		game._sphere(drop,Vector3.ZERO,0.2,Color("ffc466"))
		game._collider(drop,Vector3.ONE*0.45,Vector3.ZERO)
		var label = Label3D.new()
		drop.add_child(label)
		label.position.y=0.45
		label.text=resource.replace("_"," ").to_upper()+" · GRIP"
		label.font_size=26
		label.pixel_size=0.003
		label.billboard=BaseMaterial3D.BILLBOARD_ENABLED
	game._notice("Guardian defeated. Grip its glowing materials.")
	if str(enemy.get_meta("enemy_type",""))!="boss":
		await game.get_tree().create_timer(45).timeout
		if is_instance_valid(enemy):
			enemy.global_position=enemy.get_meta("home")
			enemy.set_meta("hp",enemy.get_meta("max_hp",60))
			enemy.set_meta("quest_death_recorded",false)
			enemy.set_meta("alive",true)
			game.animation.restore(enemy)
			if game.skeleton_structure!=null: game.skeleton_structure.reset(enemy)
			enemy.visible=true
			game._set_collisions(enemy,true)

func _boss_wave(enemy,mark:Vector3):
	game._notice("Ember Warden marks the ground — leave the glowing circle!",2)
	var ring=MeshInstance3D.new()
	var mesh=TorusMesh.new()
	mesh.inner_radius=2.15
	mesh.outer_radius=2.3
	mesh.rings=24
	mesh.ring_segments=8
	ring.mesh=mesh
	var material=StandardMaterial3D.new()
	material.shading_mode=BaseMaterial3D.SHADING_MODE_UNSHADED
	material.albedo_color=Color("ff663a")
	ring.material_override=material
	game.add_child(ring)
	ring.global_position=mark+Vector3.UP*0.07
	await game.get_tree().create_timer(2).timeout
	if is_instance_valid(ring): ring.queue_free()
	if not is_instance_valid(enemy) or not enemy.get_meta("alive",false): return
	game._effect(mark+Vector3.UP*0.4,Color("ff6c26"),0.5,4.5)
	var delta:Vector3=game.rig.global_position-mark
	if Vector2(delta.x,delta.z).length()<2.3: take_damage(35,"the Warden's eruption")
	enemy.set_meta("exposed_until",game.elapsed+3)
	game._notice("The Warden's core is exposed — strike now for double damage!",3)

func take_damage(amount:float,source:String):
	if dying or game.elapsed<game.shield_until or game.elapsed<game.hurts_until: return
	if game.guardians!=null: amount=game.guardians.player_guard(amount,source)
	if hollow != null and hollow.reward_claimed(): amount *= 0.8
	game.hurts_until=game.elapsed+1.0
	hp=maxf(0,hp-amount)
	for hand in game.hands: haptic(hand,"impact")
	game._notice("%s hit you · %d health. Keep some distance."%[source.capitalize(),ceili(hp)])
	if hp<=0: die()

func die():
	if dying: return
	dying=true
	var death_position = game.rig.global_position
	var death_zone = zone
	var response = await game._request("/api/vr/death",{"position":game._vec(death_position),"zone":death_zone})
	if response.has("error"):
		game._notice("Recovery service unavailable. Health restored; no resources discarded.")
	else:
		await game._poll()
		_sync_cache()
		game._notice("Brann pulled you home. Your tools are safe; recover your materials at "+death_zone.replace("_"," ")+".",12)
	_finish_death_recovery()

func _finish_death_recovery() -> void:
	hp=100
	travel("forge_yard")
	if not game.vr:
		# Arrive on the open approach rather than in the crowded workshop.
		game.rig.global_position=game._safe_respawn_position(game.scene.zones.forge_yard.spawn+Vector3(0,0,4))
		game.desktop_last_position=game.rig.global_position
		print("DESKTOP_RESPAWN zone=forge_yard feet=",game.rig.global_position)
	game.shield_until=game.elapsed+8
	dying=false

func _sync_cache():
	var drop = game.state.get("drop")
	if drop==null or not drop is Dictionary:
		if is_instance_valid(cache): cache.queue_free()
		cache=null
		return
	if is_instance_valid(cache):
		if str(cache.get_meta("drop_id",""))==str(drop.get("id","")): return
		cache.queue_free()
	cache=Node3D.new()
	game.add_child(cache)
	var position=drop.get("position",{})
	cache.global_position=Vector3(position.get("x",0),position.get("y",0)+0.5,position.get("z",0))
	cache.reparent(zone_groups.get(str(drop.get("zone",zone)),game))
	cache.set_meta("kind","cache")
	cache.set_meta("drop_id",drop.get("id",""))
	cache.add_to_group("pickup")
	game._sphere(cache,Vector3.ZERO,0.35,Color("78eee0"))
	game._collider(cache,Vector3.ONE*0.8,Vector3.ZERO)
	var label=Label3D.new()
	cache.add_child(label)
	label.position.y=0.7
	label.text="YOUR MATERIALS · GRIP TO RECOVER"
	label.font_size=30
	label.pixel_size=0.003
	label.billboard=BaseMaterial3D.BILLBOARD_ENABLED

func recover():
	if operation or not is_instance_valid(cache): return
	operation=true
	await game._send_context()
	var response=await game._request("/api/vr/recover",{"id":game.state.get("drop",{}).get("id","")})
	operation=false
	if response.has("error"): game._notice(str(response.error))
	else:
		await game._poll()
		_sync_cache()
		game._notice("Every dropped material recovered.")

func upgrade():
	if not game.smoke:
		game._notice("Fill the Living Workshop buckets and pull their lever.",10); return
	await game._send_context()
	var tier=int(game.state.get("tier",1))+1
	for upgrade in game.state.get("upgrades",[]):
		if int(upgrade.tier)!=tier: continue
		for option in range(upgrade.costs.size()):
			var cost=upgrade.costs[option]; var enough=true
			for resource in cost:
				if int(game.state.resources.get(resource,0))<int(cost[resource]): enough=false
			if not enough: continue
			await game.workshop._send_action("option",{"option":option})
			for resource in cost:
				for i in range(int(cost[resource])):
					var taken=await game.workshop._send_action("material-take",{"resource":resource})
					if taken.has("error"): return
					await game.workshop._send_action("donate",{"tokenId":taken.token.id,"option":option})
			await game.workshop._send_action("commit",{"tier":tier})
			return

func travel(id:String):
	motion.clear()
	if game.tuning!=null: game.tuning.history.clear()
	if not game.scene.get("zones",{}).has(id): return
	zone=id
	_apply_zone_environment(id)
	var data=game.scene.zones[id]
	game.rig.global_position=data.get("spawn",Vector3.ZERO)
	game.rig.rotation=Vector3.ZERO
	game.camera.rotation.x=0
	game.desktop_pitch=0
	game.visiting=id=="forge_yard"
	game.shield_until=game.elapsed+3
	game._notice(data.get("name",id.replace("_"," "))+" · Explore, gather and invent. F / G selects another destination.",6)
	if hollow != null: hollow.on_travel(id)

func _apply_zone_environment(id:String):
	for zone_id in zone_groups: zone_groups[zone_id].visible=zone_id==id
	if game.orchard_spell_vfx != null: game.orchard_spell_vfx.visible = id == "orchard_highlands"
	var settings=game.scene.get("zones",{}).get(id,{}).get("environment",{})
	if settings.is_empty(): return
	var world: WorldEnvironment = game.get_node_or_null("AdventureEnvironment") as WorldEnvironment
	if world != null and id != "orchard_highlands":
		# In Godot 4.7, assigning fog_mode also resets fog_density to 1.0.
		# Restore the Orchard grade first so the destination's density wins.
		for property in environment_grade_defaults:
			world.environment.set(property, environment_grade_defaults[property])
	for child in game.get_children():
		if child is WorldEnvironment:
			var env=child.environment
			env.ambient_light_color=Color(settings.get("ambient_color","d7e6d3"))
			env.ambient_light_energy=float(settings.get("ambient_energy",0.38))
			env.fog_enabled=float(settings.get("fog_density",0))>0
			env.fog_light_color=Color(settings.get("fog_color","b6cfdd"))
			env.fog_density=float(settings.get("fog_density",0))
			if env.sky!=null and env.sky.sky_material is ProceduralSkyMaterial:
				env.sky.sky_material.sky_top_color=Color(settings.get("sky_top","77abe0"))
				env.sky.sky_material.sky_horizon_color=Color(settings.get("sky_horizon","d7e6d3"))
				env.sky.sky_material.ground_horizon_color=Color(settings.get("sky_horizon","d7e6d3"))
		if child is DirectionalLight3D:
			child.light_color=Color(settings.get("sun_color","ffe6bd"))
			child.light_energy=float(settings.get("sun_energy",1.05))
	if world != null and id == "orchard_highlands":
		OrchardHorizon.apply_orchard_grade(world.environment, game.get_node_or_null("AdventureSun") as DirectionalLight3D)
		world.environment.fog_height += game.scene.zones.orchard_highlands.root.global_position.y
	sync_horizon()

func sync_horizon():
	if zone == "orchard_highlands": return
	var destination: Dictionary = game.scene.get("zones",{}).get(zone,{})
	var horizon: Node3D = destination.get("horizon")
	if horizon==null or not is_instance_valid(horizon): return
	var world: WorldEnvironment = game.get_node_or_null("AdventureEnvironment") as WorldEnvironment
	if world==null: return
	var sun: DirectionalLight3D = game.get_node_or_null("AdventureSun") as DirectionalLight3D
	Horizon.sync_to_environment(horizon,world.environment,sun)

func haptic(hand,event:String):
	last_interaction={"phase":event,"hand":"left" if hand!=null and hand is XRController3D and str(hand.tracker).begins_with("left") else "right","squeeze":1.0 if event in ["formation","ready"] else 0.0,"formationSeconds":game.tuning.value("bomb.formation_seconds")}
	if hand==null or not is_instance_valid(hand) or not hand is XRController3D: return
	var defaults={"formation":{"amplitude":0.15,"duration":0.6,"frequency":70},"ready":{"amplitude":0.55,"duration":0.12,"frequency":140},"release":{"amplitude":0.25,"duration":0.055,"frequency":100},"impact":{"amplitude":0.65,"duration":0.16,"frequency":65}}
	var pattern=defaults.get(event,defaults.impact)
	if event=="formation": pattern.duration=game.tuning.value("bomb.formation_seconds")
	var key=str(hand.get_instance_id())
	if game.held.has(key):
		var config=game.held[key].get_meta("haptics",{})
		if config is Dictionary and config.has(event): pattern=config[event]
	if pattern is Dictionary:
		hand.trigger_haptic_pulse("haptic",clampf(float(pattern.get("frequency",100)),0,320),clampf(float(pattern.get("amplitude",0.4))*game.tuning.value("haptics.strength"),0,1),clampf(float(pattern.get("duration",0.1)),0.01,2),0)

func build_hand(hand):
	var visual=Node3D.new()
	game.hand_socket(hand).add_child(visual)
	hand.set_meta("hand_visual",visual)
	var tag="L" if hand is XRController3D and str(hand.tracker).begins_with("left") else "R"
	var scene_path="res://assets/hands/pocket_thunder_hand_%s.glb"%tag
	var scene=load(scene_path)
	if not scene is PackedScene:
		push_error("Pocket Thunder hand art missing: "+scene_path)
		return
	var art=scene.instantiate()
	visual.add_child(art)
	var joints=[]
	for finger in ["Index","Middle","Ring","Pinky"]:
		for segment in [1,2,3]:
			var joint=art.find_child("%s_%s_%d"%[tag,finger,segment],true,false)
			if joint==null: push_error("Pocket Thunder finger joint missing: %s_%s_%d"%[tag,finger,segment])
			else: joints.append(joint)
	var thumb_joints=[]
	for segment in [1,2]:
		var joint=art.find_child("%s_Thumb_%d"%[tag,segment],true,false)
		if joint==null: push_error("Pocket Thunder thumb joint missing: %s_Thumb_%d"%[tag,segment])
		else: thumb_joints.append(joint)
	hand.set_meta("finger_joints",joints)
	hand.set_meta("thumb_joints",thumb_joints)
	hand.set_meta("index_tip",art.find_child(tag+"_Index_Tip",true,false))
