extends Node
## Distinct native actions; deliberately independent of the model builders.
const CONTROLS={
"starter_hammer":"Swing: strike · Trigger: fiery Forge Pulse (3s) · fire defeats ghosts",
"apprentice_hammer":"Swing: strike · Trigger: fiery Forge Pulse (3s) · fire defeats ghosts",
"woodland_axe":"Swing: chop · Hold trigger while swinging: powered cleave",
"quarry_pick":"Swing: mine · Trigger: charge a seam-breaking strike (8s)\nStrike ore within 8s to fracture nearby seams",
"grappling_hook":"Aim + trigger: attach · Hold: reel · Release: pause\nLet go of the handle: detach",
"spore_lantern":"Carry: light · Trigger: slowing spore garden (6s)",
"forge_lantern_sol":"Grip: carry · other hand: grip and pull the brass shutter tab · Trigger: toggle light",
"forge_lantern_opus":"Grip: carry · other hand: grip and pull the brass shutter tab · Trigger: toggle light",
"crystal_resonator":"Swing: strike · Trigger: resonance fan / open seals (3s)",
"ember_gauntlet":"Swing: strike · Trigger: firebolt + brief ward (3s)",
"bomb_glove":"Grip, then hold trigger: form bomb · Release grip: throw",
"20dc22c5-7bcc-43df-b07f-e81eab521b0f":"Trigger: fire / release tether · Grip crank: wind / reel\nBelt: unlimited bolts · Brass tab: bolt / grapple"}
const ControlHints=preload("res://item_control_hints.gd")
var game
var cooldowns={}
var projectiles=[]
var gardens=[]
var charged_picks=[]
var grapple={}
var falling=false
var tether:MeshInstance3D
var controls:Label3D

func setup(owner_game):
	game=owner_game
	tether=MeshInstance3D.new(); game.add_child(tether)
	tether.material_override=WorkshopScene.material("dbc18b")
	controls=WorkshopScene.label(game,"",Vector3.ZERO,18)
	controls.pixel_size=0.0015
	controls.width=600; controls.autowrap_mode=TextServer.AUTOWRAP_WORD_SMART
	controls.no_depth_test=false

func trigger(hand,source)->bool:
	var item=game.held.get(str(hand.get_instance_id()))
	if not is_instance_valid(item): return false
	var id=str(item.get_meta("id",""))
	if not CONTROLS.has(id) or id=="bomb_glove" or item.get_meta("crossbow",false): return false
	if id=="woodland_axe": game.melee.alternate(item,hand); return true
	if id=="grappling_hook":
		if not grapple.is_empty(): return true
		var hit=game._ray(source,28)
		if hit.is_empty(): game._notice("Aim Swallow Line at stone, timber or a brass anchor, then hold trigger to reel."); return true
		var target=game._owner(hit.collider)
		if target!=null and target.get_meta("kind","") in ["enemy","rat","weapon","button"]: return true
		var goal:Vector3=hit.position+hit.normal*0.45-Vector3.UP*0.9
		if hit.normal.y>0.7: goal=hit.position+Vector3.UP*0.04
		if target!=null and target.get_meta("kind","")=="anchor": goal=target.get_meta("destination",goal)
		grapple={"item":item,"hand":hand,"point":hit.position,"goal":goal,"zone":game.adventure.zone,"anchor":hit.collider,"local":hit.collider.to_local(hit.position),"landing":hit.normal.y>0.7 or (target!=null and target.get_meta("kind","")=="anchor")}
		falling=false
		game.adventure.haptic(hand,"ready")
		game._notice("Swallow Line caught · hold trigger to reel. Release pauses; drop the handle to detach.",8)
		print("GRAPPLE attached goal=",goal)
		return true
	if game.elapsed<float(cooldowns.get(id,0)): return true
	cooldowns[id]=game.elapsed+(8.0 if id=="quarry_pick" else (6.0 if id=="spore_lantern" else 3.0))
	var origin:Vector3=source.global_position-source.global_basis.z*0.3
	match id:
		"starter_hammer","apprentice_hammer":
			pulse(origin,2.7,18,hand,Color("ff9b48"))
		"quarry_pick":
			_clear_pick_charge(item)
			item.set_meta("stonewhisper_charged_until",game.elapsed+8.0)
			if not item in charged_picks: charged_picks.append(item)
			var marker=item.find_child("ChargeGlow",true,false) as Node3D
			var at=item.to_local(marker.global_position) if marker!=null else Vector3(0,0.61,0.085)
			var crystal=item.get_meta("stonewhisper_crystal_material") if item.has_meta("stonewhisper_crystal_material") else null
			if crystal is StandardMaterial3D:
				crystal.emission_energy_multiplier=3.0
				# One short-range, shadowless light makes the charged head read in a
				# dark mine without paying for a light on every idle pick.
				var charge_light=OmniLight3D.new()
				charge_light.name="ResonanceChargeLight"
				charge_light.light_color=Color("85d9ff")
				charge_light.light_energy=0.8
				charge_light.omni_range=1.35
				charge_light.shadow_enabled=false
				item.add_child(charge_light)
				charge_light.position=at
				item.set_meta("stonewhisper_charge_light",charge_light)
			else:
				item.set_meta("stonewhisper_glow",WorkshopScene.ball(item,at,Vector3.ONE*0.09,WorkshopScene.material("97bed3",0.2,0.35,1.2)))
			game._effect(item.to_global(at),Color("97bed3"),0.55,0.36)
			game._notice("Stonewhisper is listening. Strike ore within eight seconds for a richer seam break.",6)
		"crystal_resonator":
			for angle in [-0.12,0.0,0.12]: launch(origin,(-source.global_basis.z).rotated(Vector3.UP,angle),Color("b984ed"),20,hand,"crystal")
		"spore_lantern":
			var hit=game._ray(source,5)
			var point:Vector3=hit.get("position",origin-source.global_basis.z*3)
			var target=game._owner(hit.get("collider"))
			if target!=null and target.get_meta("kind","") in ["resource","barrier"]: game.adventure.interact(target,"spore_lantern",hand)
			var node=Node3D.new(); game.adventure.zone_groups[game.adventure.zone].add_child(node); node.global_position=point
			for i in range(5):
				var p=Vector3(cos(i*2.4)*0.6,0,sin(i*2.4)*0.6)
				WorkshopScene.cylinder(node,p,0.022,0.16,WorkshopScene.material("d6c28a"))
				WorkshopScene.ball(node,p+Vector3.UP*0.10,Vector3(0.18,0.10,0.18),WorkshopScene.material("ba8acf",0,0.7,0.3))
			gardens.append({"node":node,"until":game.elapsed+6.0})
		"ember_gauntlet":
			launch(origin,-source.global_basis.z,Color("ff9750"),38,hand,"fire")
			game.shield_until=game.elapsed+2.0
	game.adventure.haptic(hand,"release")
	return true

## Main calls this each desktop frame while Orchard's Edge is equipped.
func desktop_axe_state(item: Node3D, held: bool) -> void:
	if not is_instance_valid(item) or str(item.get_meta("id",""))!="woodland_axe": return
	var previous:bool=bool(item.get_meta("axe_power_ready",false))
	if held and not bool(item.get_meta("axe_power_armed",false)):
		game.melee.alternate(item,game.desktop_hand)
	item.set_meta("axe_power_ready",held)
	if not held: item.set_meta("axe_power_armed",false)
	var marker:MeshInstance3D=item.get_meta("axe_power_marker") if item.has_meta("axe_power_marker") else null
	if held and not is_instance_valid(marker):
		marker=MeshInstance3D.new()
		marker.name="PowerCleaveReady"
		var sphere:=SphereMesh.new()
		sphere.radius=0.055
		sphere.height=0.11
		marker.mesh=sphere
		var material:=StandardMaterial3D.new()
		material.albedo_color=Color("ffc26b")
		material.emission_enabled=true
		material.emission=Color("ff8f35")
		material.emission_energy_multiplier=1.4
		marker.material_override=material
		item.add_child(marker)
		marker.position=item.get_meta("tip",Vector3.UP*0.65)
		item.set_meta("axe_power_marker",marker)
	if is_instance_valid(marker):
		marker.visible=held
		if held: marker.scale=Vector3.ONE*(0.85+0.15*sin(game.elapsed*13.0))
	if held and not previous: game._effect(item.to_global(item.get_meta("tip",Vector3.UP*0.65)),Color("ffad60"),0.14,0.14)

func desktop_axe_impact(item: Node3D, point: Vector3, powered: bool) -> void:
	if not is_instance_valid(item) or str(item.get_meta("id",""))!="woodland_axe" or not powered: return
	if game.impact_feedback!=null: game.impact_feedback.contact(null,point,Vector3.UP,3.2,"woodland_axe","wood")
	game._notice("Powered cleave!",2)

func _clear_pick_charge(item:Node3D)->void:
	item.set_meta("stonewhisper_charged_until",0.0)
	var crystal=item.get_meta("stonewhisper_crystal_material") if item.has_meta("stonewhisper_crystal_material") else null
	if crystal is StandardMaterial3D:
		crystal.emission_energy_multiplier=float(item.get_meta("stonewhisper_crystal_rest",0.9))
	if item.has_meta("stonewhisper_glow"):
		var glow=item.get_meta("stonewhisper_glow")
		if is_instance_valid(glow): glow.queue_free()
		item.remove_meta("stonewhisper_glow")
	if item.has_meta("stonewhisper_charge_light"):
		var charge_light=item.get_meta("stonewhisper_charge_light")
		if is_instance_valid(charge_light): charge_light.queue_free()
		item.remove_meta("stonewhisper_charge_light")
	charged_picks.erase(item)

func resonant_mine(item,target,point:Vector3,hand)->void:
	if game.elapsed>float(item.get_meta("stonewhisper_charged_until",0)): return
	if not target.is_visible_in_tree() or target.get_meta("collecting",false): return
	if not str(target.get_meta("requires", "")) in ["pick","mine"]: return
	_clear_pick_charge(item)
	target.set_meta("resonant_bonus",1)
	if game.impact_feedback!=null: game.impact_feedback.contact(target,point,Vector3.UP,4.5,"quarry_pick","stone")
	var fractured=0
	for ore in game.scene.get("resources",[]):
		if ore==target or not is_instance_valid(ore) or not ore.is_visible_in_tree() or ore.get_meta("collecting",false): continue
		if str(ore.get_meta("zone",""))!=game.adventure.zone: continue
		if not str(ore.get_meta("requires","")) in ["pick","mine"]: continue
		if ore.global_position.distance_to(point)>6.5: continue
		game.adventure.interact(ore,"quarry_pick",hand)
		if game.impact_feedback!=null: game.impact_feedback.contact(ore,ore.global_position+Vector3.UP*0.6,Vector3.UP,2.2,"quarry_pick","stone")
		fractured+=1
		if fractured>=2: break
	game.adventure.haptic(hand,"impact")
	game._notice("A richer strike%s"%[" · %d nearby seam%s fractured."%[fractured,"" if fractured==1 else "s"] if fractured>0 else "."],3)

func launch(point:Vector3,direction:Vector3,color:Color,damage:float,hand,kind:String):
	var node=game._sphere(game,point,0.045,color)
	node.scale=Vector3(0.7,0.7,1.8)
	projectiles.append({"node":node,"velocity":direction*15,"damage":damage,"hand":hand,"kind":kind,"color":color,"until":game.elapsed+2,"zone":game.adventure.zone})

func pulse(point:Vector3,radius:float,damage:float,hand,color:Color):
	game._effect(point,color,0.5,radius*0.6)
	for enemy in game.scene.get("enemies",[]):
		if enemy.is_visible_in_tree() and enemy.global_position.distance_to(point)<radius:
			enemy.set_meta("slow_until",game.elapsed+2)
			game.adventure.hurt_enemy(enemy,damage,hand,Vector3.ZERO,"fire")
	for dummy in game.scene.dummies:
		if dummy.global_position.distance_to(point)<radius: game._dummy_hit(dummy)
	for rat in game.scene.rats:
		if rat.global_position.distance_to(point)<radius: game._kill_rat(rat)

func move_rig(displacement:Vector3)->float:
	var query=PhysicsShapeQueryParameters3D.new()
	var capsule=CapsuleShape3D.new(); capsule.radius=0.20; capsule.height=1.6
	query.shape=capsule; query.collision_mask=1
	var offset:Vector3=game.camera.global_position-game.rig.global_position
	query.transform=Transform3D(Basis.IDENTITY,game.rig.global_position+Vector3(offset.x,0.87,offset.z))
	query.motion=displacement
	var travel=game.get_world_3d().direct_space_state.cast_motion(query)
	var fraction=float(travel[0]) if travel.size()>0 else 0.0
	game.rig.global_position+=displacement*maxf(0,fraction-0.005)
	return fraction

func detach():
	if grapple.is_empty(): return
	if is_instance_valid(grapple.get("item")): grapple.item.set_meta("reeling",false)
	grapple.clear(); tether.hide(); falling=true
	game.tuning.history.clear(); game.adventure.motion.clear()
	print("GRAPPLE detached")

func tick(delta):
	controls.visible=false
	for index in range(charged_picks.size()-1,-1,-1):
		var charged=charged_picks[index]
		if not is_instance_valid(charged):
			charged_picks.remove_at(index)
		elif game.elapsed>float(charged.get_meta("stonewhisper_charged_until",0)):
			_clear_pick_charge(charged)
	for key in game.held:
		var item=game.held[key]
		var id=str(item.get_meta("id",""))
		if item.has_meta("spool") and item.get_meta("reeling",false): item.get_meta("spool").rotate_x(delta*4)
		if (ControlHints.has(id) or item.has_meta("use_instructions")) and not game.qol.opened and game.elapsed<float(item.get_meta("controls_until",0)):
			# Desktop controls live in the readable corner HUD. A head-locked 3D
			# billboard becomes enormous when a weapon is held near the camera.
			if not game.vr: continue
			var instruction=ControlHints.vr(game,item)
			controls.text=instruction
			controls.global_position=item.global_position+Vector3.UP*0.30
			controls.look_at(game.camera.global_position,Vector3.UP,true)
			controls.visible=true
			break
	if not grapple.is_empty():
		if not is_instance_valid(grapple.item) or grapple.item not in game.held.values() or game.grips.is_stowed(grapple.item) or game.adventure.zone!=grapple.zone:
			var changed_zone=game.adventure.zone!=grapple.zone
			detach()
			if changed_zone: falling=false
		else:
			if not is_instance_valid(grapple.anchor) or not grapple.anchor.is_visible_in_tree(): detach(); return
			grapple.point=grapple.anchor.to_global(grapple.local)
			var hand=grapple.hand
			var reeling=hand.get_float("trigger")>0.5 or hand.is_button_pressed("trigger_click") if hand is XRController3D else Input.is_mouse_button_pressed(MOUSE_BUTTON_LEFT)
			if reeling and not game.qol.opened:
				var offset:Vector3=game.camera.global_position-game.rig.global_position
				var difference:Vector3=grapple.goal-Vector3(offset.x,0,offset.z)-game.rig.global_position
				move_rig(difference.limit_length(delta*game.tuning.value("grapple.reel_speed")))
				if difference.length()<0.15 and grapple.landing: detach(); falling=false; game._notice("Swallow Line · landing reached."); return
			var tether_origin=grapple.item.get_meta("tether_origin",null)
			var a:Vector3=tether_origin.global_position if is_instance_valid(tether_origin) else grapple.item.to_global(Vector3(0,0.48,0))
			var b=grapple.point
			var mesh=SurfaceTool.new(); mesh.begin(Mesh.PRIMITIVE_TRIANGLES)
			for axis in [Vector3.UP,Vector3.RIGHT]:
				var width=axis*0.008
				for p in [a-width,a+width,b+width,a-width,b+width,b-width,b+width,a+width,a-width,b-width,b+width,a-width]: mesh.add_vertex(p)
			mesh.generate_normals(); tether.mesh=mesh.commit(); tether.show()
			grapple.item.set_meta("reeling",reeling)
	if falling:
		if move_rig(Vector3.DOWN*delta*3.0)<0.95: falling=false
	for shot in projectiles.duplicate():
		if shot.zone!=game.adventure.zone: shot.node.queue_free(); projectiles.erase(shot); continue
		var a=shot.node.global_position; var b=a+shot.velocity*delta
		var query=PhysicsRayQueryParameters3D.create(a,b,1)
		query.collide_with_areas=shot.kind=="fire"
		var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
		if shot.kind=="fire" and game.heat_contacts!=null and a.distance_to(b)<=.75:
			game.heat_contacts.sweep(a,hit.position if not hit.is_empty() else b,.22,310,game.adventure.zone,"firebolt",shot.node,delta)
		shot.node.global_position=b
		if not hit.is_empty():
			if shot.kind=="fire" and game.heat_contacts!=null: game.heat_contacts.touch(hit.position,.45,360,game.adventure.zone,"firebolt_impact",shot.node,.1)
			var target=game._owner(hit.collider)
			if target!=null:
				if target.get_meta("kind","")=="enemy": game.adventure.hurt_enemy(target,shot.damage,shot.hand,Vector3.ZERO,"fire" if shot.kind=="fire" else "physical")
				elif target.get_meta("kind","")=="dummy": game._dummy_hit(target)
				elif target.get_meta("kind","")=="rat": game._kill_rat(target)
				elif shot.kind=="crystal": game.adventure.interact(target,"crystal_resonator",shot.hand)
				elif shot.kind=="fire": game.adventure.interact(target,"ember_gauntlet",shot.hand)
			if game.impact_feedback!=null and shot.kind!="fire": game.impact_feedback.contact(target,hit.position,hit.normal,shot.velocity.length()*0.25,str(shot.kind))
		if not hit.is_empty() or game.elapsed>shot.until: shot.node.queue_free(); projectiles.erase(shot)
	for garden in gardens.duplicate():
		if game.elapsed>garden.until: garden.node.queue_free(); gardens.erase(garden); continue
		if not garden.node.is_visible_in_tree(): continue
		for enemy in game.scene.get("enemies",[]):
			if enemy.is_visible_in_tree() and enemy.global_position.distance_to(garden.node.global_position)<3: enemy.set_meta("slow_until",game.elapsed+1)
