extends Node3D
## A portable, open rigid basket. Only actual tagged skeleton heads can enter it.
const SAVE="user://skull_basket.json"
const ART="res://assets/tree_cutting/skull_basket.glb"
const CAPACITY=3
const MAX_IDENTITIES=50000
const SOCKETS=[Vector3(-.145,-.035,-.035),Vector3(.145,-.035,-.035),Vector3(0,-.035,.085)]
var game
var basket:RigidBody3D
var contents=[]
var used_ids={}
var zone="forge_yard"
var save_path=SAVE
var persistence_ok=true
var next_save=0.0
var next_retry=0.0

func setup(owner_game,spawn_position=Vector3.INF):
	game=owner_game
	var saved={}
	if not game.diagnostic_offline and not game.smoke and FileAccess.file_exists(save_path):
		var file=FileAccess.open(save_path,FileAccess.READ)
		if file==null or file.get_length()>8*1024*1024: persistence_ok=false
		else:
			var parsed=JSON.parse_string(file.get_as_text())
			if parsed is Dictionary and parsed.get("contents") is Array and parsed.get("usedIds") is Dictionary and parsed.contents.size()<=CAPACITY:
				saved=parsed
				used_ids=parsed.usedIds
				zone=str(parsed.get("zone","forge_yard"))
			else: persistence_ok=false
		if not persistence_ok: push_warning("SKULL_BASKET invalid save; preserving it and refusing deposits")
	basket=RigidBody3D.new()
	basket.name="SkullBasket"
	basket.collision_layer=8
	basket.collision_mask=9
	basket.mass=1.1
	basket.continuous_cd=true
	basket.physics_material_override=PhysicsMaterial.new()
	basket.physics_material_override.friction=.9
	basket.add_to_group("pickup")
	basket.set_meta("kind","weapon")
	basket.set_meta("id","skull_basket")
	basket.set_meta("display_name","Skull basket · E carry/drop · F store/take")
	basket.set_meta("no_secondary_grip",true)
	game.add_child(basket)
	var starting=spawn_position if spawn_position!=Vector3.INF else game.scene.brann.global_position+Vector3(.8,.95,.45)
	if saved.get("position") is Array and saved.position.size()==3:
		starting=Vector3(float(saved.position[0]),float(saved.position[1]),float(saved.position[2]))
	basket.global_position=starting
	_make_colliders()
	if ResourceLoader.exists(ART):
		var scene=load(ART)
		if scene is PackedScene: basket.add_child(scene.instantiate())
	else: _fallback_visual()
	for skull_id in saved.get("contents",[]):
		if not skull_id is String or not used_ids.has(skull_id): persistence_ok=false; break
		var skull=_restored_skull(skull_id)
		_store_body(skull)
	if not persistence_ok: push_warning("SKULL_BASKET saved identities need recovery; refusing new deposits")
	print("SKULL_BASKET_READY stored=",contents.size()," zone=",zone," durable=",persistence_ok)

func _wall(size:Vector3,at:Vector3):
	var collision=CollisionShape3D.new()
	var box=BoxShape3D.new()
	box.size=size
	collision.shape=box
	collision.position=at
	basket.add_child(collision)

func _make_colliders():
	# The centre remains physically open for dropped VR skulls.
	_wall(Vector3(.58,.035,.40),Vector3(0,-.132,0))
	_wall(Vector3(.035,.28,.40),Vector3(-.272,0,0))
	_wall(Vector3(.035,.28,.40),Vector3(.272,0,0))
	_wall(Vector3(.58,.28,.035),Vector3(0,0,-.192))
	_wall(Vector3(.58,.28,.035),Vector3(0,0,.192))

func _fallback_visual():
	var material=StandardMaterial3D.new()
	material.albedo_color=Color("806046")
	material.roughness=.9
	for child in basket.get_children():
		if not child is CollisionShape3D: continue
		var mesh=MeshInstance3D.new()
		mesh.mesh=BoxMesh.new()
		mesh.mesh.size=child.shape.size
		mesh.material_override=material
		basket.add_child(mesh)
		mesh.position=child.position

func _restored_skull(skull_id:String)->RigidBody3D:
	var skull=RigidBody3D.new()
	skull.name="StoredSkeletonSkull"
	skull.mass=.35
	skull.collision_layer=8
	skull.collision_mask=9
	skull.set_meta("kind","weapon")
	skull.set_meta("id","bone_club")
	skull.set_meta("remains",true)
	skull.set_meta("skeleton_skull",true)
	skull.set_meta("skeleton_part","head")
	skull.set_meta("skull_id",skull_id)
	skull.set_meta("display_name","Skeleton Skull · grip / place in basket")
	skull.set_meta("born",game.elapsed)
	skull.set_meta("zone",zone)
	game.add_child(skull)
	var collider=CollisionShape3D.new()
	var shape=SphereShape3D.new()
	shape.radius=.095
	collider.shape=shape
	skull.add_child(collider)
	var bone=StandardMaterial3D.new()
	bone.albedo_color=Color("d7cbb0")
	bone.roughness=.9
	var head=MeshInstance3D.new()
	var sphere=SphereMesh.new()
	sphere.radius=.095
	sphere.height=.18
	head.mesh=sphere
	head.material_override=bone
	skull.add_child(head)
	var jaw=MeshInstance3D.new()
	var jaw_mesh=BoxMesh.new()
	jaw_mesh.size=Vector3(.11,.045,.065)
	jaw.mesh=jaw_mesh
	jaw.material_override=bone
	skull.add_child(jaw)
	jaw.position=Vector3(0,-.07,-.055)
	if game.remains!=null: game.remains.bodies.append(skull)
	return skull

func _stored_ids()->Array:
	var ids=[]
	for skull in contents:
		if is_instance_valid(skull): ids.append(str(skull.get_meta("skull_id","")))
	return ids

func _save()->bool:
	if game.diagnostic_offline or game.smoke: return true
	if not persistence_ok: return false
	var file=FileAccess.open(save_path+".tmp",FileAccess.WRITE)
	if file==null: push_warning("SKULL_BASKET cannot save"); return false
	var p=basket.global_position
	file.store_string(JSON.stringify({"schema":1,"zone":zone,"position":[p.x,p.y,p.z],"contents":_stored_ids(),"usedIds":used_ids}))
	file.close()
	if DirAccess.rename_absolute(save_path+".tmp",save_path)!=OK: push_warning("SKULL_BASKET cannot replace save"); return false
	return true

func _store_body(skull:RigidBody3D):
	skull.freeze=true
	skull.linear_velocity=Vector3.ZERO
	skull.angular_velocity=Vector3.ZERO
	skull.set_meta("basket_stored",true)
	skull.remove_from_group("pickup")
	skull.reparent(basket)
	skull.position=SOCKETS[contents.size()]
	skull.rotation=Vector3(0,contents.size()*.9,0)
	game._set_collisions(skull,false)
	contents.append(skull)

func deposit(skull:RigidBody3D)->bool:
	if not persistence_ok or not is_instance_valid(skull) or contents.size()>=CAPACITY: return false
	if not skull.get_meta("skeleton_skull",false) or str(skull.get_meta("skeleton_part",""))!="head": return false
	if skull in game.held.values() or game.grips.is_stowed(skull): return false
	var skull_id=str(skull.get_meta("skull_id",""))
	if not skull_id.begins_with("skull-") or skull_id.length()>150: return false
	var fresh=not used_ids.has(skull_id)
	if fresh:
		if used_ids.size()>=MAX_IDENTITIES: game._notice("Basket identity archive is full; preserve the save before continuing.",6); return false
		used_ids[skull_id]={"instanceId":game.quests.delivery_instance_id(),"state":"pending"}
	_store_body(skull)
	zone=game.adventure.zone
	if not _save():
		contents.pop_back()
		skull.reparent(game)
		skull.remove_meta("basket_stored")
		skull.add_to_group("pickup")
		game._set_collisions(skull,true)
		skull.freeze=false
		if fresh: used_ids.erase(skull_id)
		return false
	if fresh: _retry_pending()
	game._notice("Skeleton Skull stored · %d/%d in basket"%[contents.size(),CAPACITY],4)
	return true

func _retry_pending():
	if game.quests==null: return
	for skull_id in used_ids.keys():
		var entry=used_ids[skull_id]
		if not entry is Dictionary or entry.get("state")!="pending": continue
		if not game.quests.skull_delivered(skull_id,entry.get("instanceId")): return
		entry.state="queued"
		_save()

func retrieve()->RigidBody3D:
	if contents.is_empty(): return null
	var skull:RigidBody3D=contents.pop_back()
	skull.reparent(game)
	skull.global_position=basket.to_global(Vector3(.46,.05,0))
	skull.remove_meta("basket_stored")
	skull.add_to_group("pickup")
	skull.set_meta("zone",game.adventure.zone)
	skull.set_meta("born",game.elapsed)
	game._set_collisions(skull,true)
	skull.freeze=false
	skull.sleeping=false
	skull.linear_velocity=Vector3.ZERO
	_save()
	game._notice("Skull taken from basket · %d/%d remain"%[contents.size(),CAPACITY],4)
	return skull

func _inside(skull:RigidBody3D)->bool:
	var local=basket.to_local(skull.global_position)
	return absf(local.x)<.225 and absf(local.z)<.155 and local.y>-.09 and local.y<.22

func _held()->bool:
	return basket in game.held.values()

func tick(_delta=0.0):
	if basket==null: return
	if _held(): zone=game.adventure.zone
	basket.visible=zone==game.adventure.zone or _held()
	if not basket.visible:
		basket.freeze=true
		return
	if not _held() and basket.freeze: basket.freeze=false
	if contents.size()<CAPACITY and game.remains!=null:
		for skull in game.remains.bodies:
			if not is_instance_valid(skull) or not skull.get_meta("skeleton_skull",false) or skull.get_meta("basket_stored",false): continue
			if _inside(skull) and deposit(skull): break
	if game.elapsed>=next_retry:
		next_retry=game.elapsed+4
		_retry_pending()
	if game.elapsed>=next_save:
		next_save=game.elapsed+10
		_save()

func _aimed_skull()->RigidBody3D:
	var source=game.camera
	var start=source.global_position
	var query=PhysicsRayQueryParameters3D.create(start,start-source.global_basis.z*3.25)
	query.exclude=[basket.get_rid()]
	var hit=game.get_world_3d().direct_space_state.intersect_ray(query)
	var target=hit.get("collider")
	return target if target is RigidBody3D and target.get_meta("skeleton_skull",false) else null

func _looking_at_basket()->bool:
	var hit=game._ray(game.camera,3.0)
	return hit.get("collider")==basket

func desktop_action(keycode:int,_hand:Node3D)->bool:
	if keycode!=KEY_F: return false
	if _held():
		var skull=_aimed_skull()
		if skull!=null:
			if not deposit(skull): game._notice("Point at a loose Skeleton Skull; the basket holds three.",4)
			return true
		if not contents.is_empty(): retrieve(); return true
		game._notice("Look at a loose Skeleton Skull and press F to store it.",4)
		return true
	if _looking_at_basket():
		if contents.is_empty(): game._notice("The basket is empty. Press E to carry it.",4)
		else: retrieve()
		return true
	return false

func try_grab(hand:Node3D,desktop:bool)->bool:
	if not basket.visible or game.held.has(str(hand.get_instance_id())): return false
	var nearby=hand.global_position.distance_to(basket.global_position)<.48
	if desktop: nearby=_looking_at_basket()
	if not nearby: return false
	basket.freeze=true
	game.grips._attach(hand,basket)
	zone=game.adventure.zone
	game._notice("Basket carried · E drop · F store a loose skull",4)
	return true

func release(hand:Node3D,desktop:bool)->bool:
	var key=str(hand.get_instance_id())
	if game.held.get(key)!=basket: return false
	game.grips.grips.erase(key)
	game.grips.adjusting.erase(key)
	game.held.erase(key)
	basket.reparent(game)
	zone=game.adventure.zone
	game._set_collisions(basket,true)
	basket.freeze=false
	basket.sleeping=false
	basket.linear_velocity=game.tuning.release_velocity(hand,desktop).limit_length(12)
	basket.angular_velocity=game.adventure.motion.get(key,{}).get("angular",Vector3.ZERO).limit_length(10)
	_save()
	game.adventure.haptic(hand,"release")
	return true

func _exit_tree():
	if is_instance_valid(basket) and basket.is_inside_tree(): _save()
