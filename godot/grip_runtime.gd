extends Node
## Held ownership stays in game.held; this module handles attachment and belt slots.
var game
var grips={}
var slots=[]
var belt:Node3D
var adjusting={}
var belt_following=false
var belt_looking_down=false
const GRIP_POSE_PATH="user://grip-poses-v1.json"
const WYRM_V1="f040e7a4-8c6b-42a5-af56-a74cd4936a47"
const WYRM_V2="55b0c0ee-2622-4207-a3ca-fa006701d47c"
var saved_poses:Dictionary={}

func setup(owner_game):
	game=owner_game
	_load_poses()
	belt=Node3D.new()
	belt.name="HipHolsters"
	game.rig.add_child(belt)
	for side in [-1,1]:
		var root=Node3D.new()
		belt.add_child(root)
		root.position=Vector3(side*0.25,0,0.05)
		_build_holster(root,side)
		var marker=game._sphere(root,Vector3(0,0.06,0),0.045,Color("65b49e"))
		var label=game.qol._label(root,"",Vector3(0,0.18,0),15)
		slots.append({"root":root,"item":null,"marker":marker,"label":label})
	_place_belt(1.0)

func _build_holster(root: Node3D, side: int):
	# A leather scabbard and brass mouth, rather than an untextured cube. Keep
	# the grab marker separate so it remains legible in a dim forge.
	var leather := StandardMaterial3D.new()
	leather.albedo_color = Color("63412b")
	leather.roughness = 0.87
	var brass := StandardMaterial3D.new()
	brass.albedo_color = Color("b7924d")
	brass.metallic = 0.65
	brass.roughness = 0.35
	for piece in [
		{"name":"Scabbard","y":-0.15,"radius":0.067,"height":0.34,"material":leather},
		{"name":"BrassMouth","y":0.04,"radius":0.079,"height":0.035,"material":brass},
		{"name":"BrassTip","y":-0.32,"radius":0.048,"height":0.045,"material":brass}]:
		var mesh := MeshInstance3D.new()
		mesh.name = piece.name
		var cylinder := CylinderMesh.new()
		cylinder.top_radius = piece.radius
		cylinder.bottom_radius = piece.radius * (0.72 if piece.name == "Scabbard" else 1.0)
		cylinder.height = piece.height
		cylinder.radial_segments = 10
		mesh.mesh = cylinder
		mesh.material_override = piece.material
		root.add_child(mesh)
		mesh.position.y = piece.y
	game.adventure._box(root,Vector3(-side*0.042,0.07,0.012),Vector3(0.12,0.045,0.075),Color("8c6540"))

func _holster_pose(item: Node3D, side: int) -> Transform3D:
	var id := str(item.get_meta("id", "")).to_lower()
	if item.get_meta("guardian_shield", false):
		return Transform3D(Basis(Vector3.FORWARD, side * 0.22) * Basis(Vector3.RIGHT, -PI * 0.5), Vector3(side * 0.04, -0.13, -0.07))
	if item.get_meta("crossbow", false):
		return Transform3D(Basis(Vector3.UP, side * PI * 0.5) * Basis(Vector3.RIGHT, -0.25), Vector3(side * 0.025, -0.12, -0.07))
	if item.get_meta("phoenix_bow",false):
		return Transform3D(Basis(Vector3.FORWARD,side*0.18),Vector3(0,0.12,0.08))
	if "axe" in id or "pick" in id:
		return Transform3D(Basis(Vector3.UP, side * 0.20), Vector3(0, -0.24, 0))
	if "hammer" in id or "mace" in id:
		return Transform3D(Basis(Vector3.UP, side * 0.12), Vector3(0, -0.22, 0))
	if id == "grappling_hook":
		return Transform3D(Basis(Vector3.UP, side * 0.35), Vector3(0, -0.18, 0))
	if id in ["spore_lantern", "crystal_resonator"]:
		return Transform3D(Basis(Vector3.FORWARD, side * 0.2), Vector3(0, -0.14, 0))
	if id.begins_with("forge_lantern_"):
		return Transform3D(Basis(Vector3.UP, side * 0.12), Vector3(0, -0.15, -0.055))
	if id in ["ember_gauntlet", "bomb_glove"]:
		return Transform3D(Basis(Vector3.RIGHT, -0.65), Vector3(0, -0.12, 0))
	if id == WYRM_V1 or id == WYRM_V2:
		return Transform3D(Basis(Vector3.RIGHT, -0.3), Vector3(0, -0.16, 0))
	return Transform3D(Basis.IDENTITY, Vector3(0, -0.22, 0))

func _place_belt(delta):
	var forward=-game.camera.global_basis.z
	forward.y=0
	# A head is not a torso. Freeze yaw while looking down or browsing.
	var browsing=game.workshop!=null and game.workshop.pouch_open
	var gaze_y=(-game.camera.global_basis.z).y
	belt_looking_down=gaze_y < (-0.12 if belt_looking_down else -0.25)
	var reaching=false
	if game.vr:
		for hand in game.hands:
			if hand.global_position.distance_to(belt.global_position)<0.45: reaching=true
	var looking_down=belt_looking_down or reaching
	if browsing or looking_down: belt_following=false
	if forward.length()>0.1 and not browsing and not looking_down:
		var target=atan2(-forward.x,-forward.z)
		var difference=wrapf(target-belt.global_rotation.y,-PI,PI)
		if absf(difference)>deg_to_rad(55): belt_following=true
		if absf(difference)<deg_to_rad(8): belt_following=false
		if delta>=1.0: belt.global_rotation.y=target
		elif belt_following:
			belt.global_rotation.y=lerp_angle(belt.global_rotation.y,target,1-exp(-10*delta))
	belt.global_position=game.camera.global_position-Vector3.UP*game.tuning.value("holster.height")

func _key(hand): return str(hand.get_instance_id())

func _pose_key(item:Node3D,hand:Node3D)->String:
	var side=str(hand.tracker) if hand is XRController3D else "desktop"
	return "%s|%d|%s"%[str(item.get_meta("id","")),int(item.get_meta("creation_version",1)),side]

func _pose_to_array(pose:Transform3D)->Array:
	return [pose.basis.x.x,pose.basis.x.y,pose.basis.x.z,pose.basis.y.x,pose.basis.y.y,pose.basis.y.z,pose.basis.z.x,pose.basis.z.y,pose.basis.z.z,pose.origin.x,pose.origin.y,pose.origin.z]

func _array_to_pose(values)->Transform3D:
	if not values is Array or values.size()!=12: return Transform3D.IDENTITY
	for value in values:
		if not (value is float or value is int) or not is_finite(float(value)): return Transform3D.IDENTITY
	var pose=Transform3D(Basis(Vector3(values[0],values[1],values[2]),Vector3(values[3],values[4],values[5]),Vector3(values[6],values[7],values[8])),Vector3(values[9],values[10],values[11]))
	if absf(pose.basis.determinant()-1.0)>0.06 or pose.origin.length()>0.8: return Transform3D.IDENTITY
	return pose

func _load_poses():
	if game.diagnostic_offline or game.smoke or not FileAccess.file_exists(GRIP_POSE_PATH): return
	var data=JSON.parse_string(FileAccess.get_file_as_string(GRIP_POSE_PATH))
	if data is Dictionary:
		for key in data:
			var pose=_array_to_pose(data[key])
			if pose!=Transform3D.IDENTITY: saved_poses[key]=pose
	print("GRIP_POSES loaded=",saved_poses.size()," path=",GRIP_POSE_PATH)

func _save_pose(item:Node3D,hand:Node3D,pose:Transform3D):
	if game.diagnostic_offline or game.smoke: return
	var key=_pose_key(item,hand)
	saved_poses[key]=pose
	var data={}
	for entry in saved_poses: data[entry]=_pose_to_array(saved_poses[entry])
	var file=FileAccess.open(GRIP_POSE_PATH,FileAccess.WRITE)
	if file!=null:
		file.store_string(JSON.stringify(data,"\t"))
		print("GRIP_POSE_SAVED item=",item.get_meta("id","")," side=",key.get_slice("|",2))
	else: push_warning("Could not save grip pose: "+str(FileAccess.get_open_error()))

func _default_wyrm_pose(item:Node3D,hand:Node3D)->Transform3D:
	var side=1.0 if hand is XRController3D and str(hand.tracker).begins_with("left") else -1.0
	var id=str(item.get_meta("id",""))
	var basis=Basis(Vector3.RIGHT,-PI/2) if id==WYRM_V1 else Basis.IDENTITY
	if hand is XRController3D:
		# Both generations now aim down the visible index (-Z). The second
		# generation's authored dorsal roll is corrected around that same axis.
		if id==WYRM_V2: basis=Basis(Vector3.BACK,-side*PI/2)*basis
		return Transform3D(basis,Vector3(0,-0.018,-0.035))
	return Transform3D(basis,Vector3(-0.12,-0.04,-0.16))

## These props own their attachment, release and secondary controls. Still curl
## the visual hand, but never enroll them in generic weapon grips or holsters.
func _managed(item)->bool:
	return is_instance_valid(item) and str(item.get_meta("kind","")) in ["hearth_torch","ember_vessel","fire_supply","apple"]

func _point(item,hand)->Vector3:
	var local_point=item.to_local(hand.global_position)
	var axis=item.get_meta("grip_axis_origin",Vector3.ZERO)
	return Vector3(axis.x,clampf(local_point.y,float(item.get_meta("grip_min",0)),float(item.get_meta("grip_max",0.35))),axis.z)

func _entries(item)->Array:
	var result=[]
	for key in grips:
		if game.held.get(key)==item and grips[key].item==item: result.append(key)
	return result

func bind(hand,item):
	if _managed(item): return
	if item.get_meta("remains",false): game.remains.grab(item)
	for slot in slots:
		if slot.item==item: slot.item=null
	game.adventure.thrown=game.adventure.thrown.filter(func(entry):return entry.node!=item)
	grips[_key(hand)]={"hand":hand,"item":item,"point":item.to_local(hand.global_position),"basis":game.hand_socket(hand).global_basis.inverse()*item.global_basis}
	game._set_collisions(item,false)

func try_grab(hand)->bool:
	var key=_key(hand)
	if game.held.has(key): return true
	for slot in slots:
		if is_instance_valid(slot.item) and hand.global_position.distance_to(slot.root.global_position)<game.tuning.value("holster.reach"):
			var item=slot.item
			slot.item=null
			_attach(hand,item)
			game._notice("Tool drawn. Hold A while gripping to adjust its angle.",5)
			return true
	# A second hand may grab only the actual handle, never via distance pickup.
	for item in game.held.values():
		if not is_instance_valid(item) or _managed(item) or item.get_meta("no_secondary_grip",false) or _entries(item).size()>=2: continue
		var point=_point(item,hand)
		if hand.global_position.distance_to(item.to_global(point))>game.tuning.value("grip.secondary_reach"): continue
		var entries=_entries(item)
		if entries.is_empty(): continue
		if point.distance_to(grips[entries[0]].point)<0.08: continue
		game.held[key]=item
		grips[key]={"hand":hand,"item":item,"point":point,"basis":game.hand_socket(hand).global_basis.inverse()*item.global_basis}
		game.adventure.haptic(hand,"ready")
		game._notice("Two hands. Release either hand to pass the grip; hold A to slide it.",5)
		return true
	return false

func _attach(hand,item):
	game.tool_physics.detach(item)
	if game.melee!=null: game.melee.tracks.erase(item.get_instance_id())
	item.reparent(game.hand_socket(hand))
	var preferences=item.get_meta("grip_preferences",{})
	var side=str(hand.tracker) if hand is XRController3D else "desktop"
	if preferences.has(side): item.transform=preferences[side]
	elif saved_poses.has(_pose_key(item,hand)): item.transform=saved_poses[_pose_key(item,hand)]
	else:
		if str(item.get_meta("id","")) in [WYRM_V1,WYRM_V2]:
			item.transform=_default_wyrm_pose(item,hand)
		elif hand is XRController3D:
			var thumb_side=1.0 if str(hand.tracker).begins_with("left") else -1.0
			# Authored handle +Y crosses the curled fingers toward the thumb.
			# Palm is -Y in the calibrated visual; finger tips begin along -Z.
			item.basis=Basis(Vector3.FORWARD,Vector3.RIGHT*thumb_side,Vector3.DOWN*thumb_side)
			var grip_y=clampf(0.13,float(item.get_meta("grip_min",0)),float(item.get_meta("grip_max",0.35)))
			item.position=Vector3(0,-0.045,-0.035)-item.basis*Vector3(0,grip_y,0)
		else:
			item.position=Vector3(-0.03,-0.16,-0.28) if str(item.get_meta("id",""))=="woodland_axe" else Vector3.ZERO
			item.rotation=Vector3(-0.4,-PI/2,0.45) if str(item.get_meta("id",""))=="woodland_axe" else Vector3(-0.3,0,0)
			# Keep the haft pose, but turn the authored +X edge away from the
			# player around the haft's own +Y axis.
			if str(item.get_meta("id",""))=="woodland_axe": item.basis=item.basis*Basis(Vector3.UP,PI)
	game.held[_key(hand)]=item
	bind(hand,item)
	item.set_meta("controls_until",game.elapsed+8.0)
	game.adventure.haptic(hand,"ready")
	if not game.vr and item.get_meta("crossbow",false): game.siegebird.desktop_reload_deferred.call_deferred(hand.get_instance_id(),true)

func adjust(hand,pressed):
	var key=_key(hand)
	if not game.held.has(key): return
	var item=game.held[key]
	if _managed(item): return
	if not grips.has(key): bind(hand,item)
	if pressed and not adjusting.has(key):
		for owner_key in _entries(item):
			grips[owner_key].basis=game.hand_socket(grips[owner_key].hand).global_basis.inverse()*item.global_basis
		adjusting[key]=true
		if _entries(item).size()==1: item.reparent(game)
		game._notice("Grip loose · reposition your hand along the handle, then release A.",5)
	elif not pressed and adjusting.has(key):
		adjusting.erase(key)
		var point=_point(item,hand)
		if hand.global_position.distance_to(item.to_global(point))<game.tuning.value("grip.secondary_reach")*1.5:
			grips[key].point=point
		if _entries(item).size()==1:
			item.reparent(game.hand_socket(hand))
			item.position=-(item.basis*grips[key].point)
		grips[key].basis=game.hand_socket(hand).global_basis.inverse()*item.global_basis
		var preferences=item.get_meta("grip_preferences",{})
		var side=str(hand.tracker) if hand is XRController3D else "desktop"
		preferences[side]=game.hand_socket(hand).global_transform.affine_inverse()*item.global_transform
		item.set_meta("grip_preferences",preferences)
		_save_pose(item,hand,preferences[side])
		game.tuning.history.erase(key)
		game.adventure.haptic(hand,"ready")

func release(hand)->bool:
	var key=_key(hand)
	if not game.held.has(key): return false
	var item=game.held[key]
	if _managed(item): return false
	if not grips.has(key): bind(hand,item)
	var others=_entries(item)
	others.erase(key)
	adjusting.erase(key)
	grips.erase(key)
	if not others.is_empty():
		game.held.erase(key)
		var survivor=grips[others[0]].hand
		item.reparent(game if adjusting.has(others[0]) else game.hand_socket(survivor))
		grips[others[0]].basis=game.hand_socket(survivor).global_basis.inverse()*item.global_basis
		game.previous_tips.clear()
		game.tuning.history.clear()
		game.adventure.haptic(survivor,"ready")
		return true
	var velocity=game.adventure.motion.get(key,{}).get("velocity",Vector3.ZERO)
	for slot in slots:
		if is_instance_valid(slot.item): continue
		if velocity.length()>1.2 or hand.global_position.distance_to(slot.root.global_position)>game.tuning.value("holster.reach"): continue
		game.held.erase(key)
		item.reparent(slot.root)
		item.transform=_holster_pose(item, -1 if slot.root.position.x < 0 else 1)
		slot.item=item
		game._set_collisions(item,false)
		game.tuning.history.erase(key)
		game.adventure.haptic(hand,"ready")
		game._notice("Holstered. Squeeze at this hip to draw it.",5)
		print("HOLSTER stored=",item.get_meta("id","weapon"))
		return true
	return false

func is_stowed(item)->bool:
	for slot in slots:
		if slot.item==item: return true
	return false

func tick(delta):
	_place_belt(delta)
	for key in grips.keys():
		if not is_instance_valid(grips[key].item) or _managed(grips[key].item) or game.held.get(key)!=grips[key].item:
			grips.erase(key)
			adjusting.erase(key)
	for hand in game.hands+[game.desktop_hand]:
		var key=_key(hand)
		var visual=hand.get_meta("hand_visual") if hand.has_meta("hand_visual") else null
		if is_instance_valid(visual): visual.position=visual.position.lerp(Vector3.ZERO,clampf(delta*18,0,1))
		if game.held.has(key) and not grips.has(key) and not _managed(game.held[key]): bind(hand,game.held[key])
		preload("res://hand_animation.gd").tick(hand,game.held.has(key) or (game.siegebird!=null and game.siegebird.busy(hand)) or (game.archery!=null and game.archery.busy(hand)),delta)
	var solved=[]
	for item in game.held.values():
		if item in solved or not is_instance_valid(item): continue
		solved.append(item)
		var entries=_entries(item)
		if entries.size()<2: continue
		var active=entries.filter(func(key):return not adjusting.has(key))
		if active.is_empty():
			if item.get_parent()!=game: item.reparent(game)
			continue
		var a=grips[active[0]]
		var basis=game.hand_socket(a.hand).global_basis*a.basis
		if active.size()==2:
			var b=grips[active[1]]
			var local_axis:Vector3=b.point-a.point
			var world_axis:Vector3=b.hand.global_position-a.hand.global_position
			if local_axis.length()>0.06 and world_axis.length()>0.06:
				var from=(basis*local_axis).normalized()
				var to=world_axis.normalized()
				var cross=from.cross(to)
				if cross.length()>0.0001: basis=Basis(cross.normalized(),acos(clampf(from.dot(to),-1,1)))*basis
				elif from.dot(to)<-0.999: basis=Basis((basis*Vector3.RIGHT).normalized(),PI)*basis
		item.global_basis=basis
		item.global_position=a.hand.global_position-basis*a.point
		if active.size()==2:
			var support=grips[active[1]]
			var visual=support.hand.get_meta("hand_visual") if support.hand.has_meta("hand_visual") else null
			if is_instance_valid(visual):
				visual.position=game.hand_socket(support.hand).to_local(item.to_global(support.point)).limit_length(0.15)
	for slot in slots:
		var near=false
		var nearby_hand=null
		for hand in game.hands:
			if hand.global_position.distance_to(slot.root.global_position)<game.tuning.value("holster.reach"):
				near=true
				nearby_hand=hand
		var can_stow=near and game.held.has(_key(nearby_hand)) and not _managed(game.held.get(_key(nearby_hand)))
		if can_stow and not slot.get("near",false) and not is_instance_valid(slot.item):
			game.adventure.haptic(nearby_hand,"ready")
		slot["near"]=near
		slot.marker.scale=Vector3.ONE*(1.5 if near else 0.6)
		slot.label.text=("Occupied" if game.held.has(_key(nearby_hand)) else "Grip to draw") if near and is_instance_valid(slot.item) else ("Release to stow" if can_stow else "")
		slot.root.visible=game.vr or game.capture_grips
