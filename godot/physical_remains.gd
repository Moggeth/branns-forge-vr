extends Node
## Actual character meshes become rigid bodies. Loot remains authoritative elsewhere.
var game
var bodies=[]
var clack:AudioStreamWAV
var sound_at=0.0
var sounds=[]
var leg_joints: Dictionary = {}
const MAX_BODIES=120
const LIFETIME=90.0

func setup(owner_game): game=owner_game

func _bounds(node,relative:Transform3D)->AABB:
	var bounds=AABB()
	var found=false
	if node is MeshInstance3D:
		bounds=relative*node.mesh.get_aabb()
		found=true
	for child in node.get_children():
		if not child is Node3D: continue
		var box=_bounds(child,relative*child.transform)
		if box.size.length()>0:
			bounds=bounds.merge(box) if found else box
			found=true
	return bounds

func shatter(actor,impulse=Vector3.ZERO):
	var rig=game.animation.actors.get(actor.get_instance_id(),{})
	if rig.is_empty(): return
	if game.guardian_authored!=null: game.guardian_authored.before_shatter(actor)
	var count=0
	for home in rig.homes:
		var piece=home.piece
		if not is_instance_valid(piece): continue
		if not home.has("template"): home["template"]=piece.duplicate()
		var world_pose=piece.global_transform
		var box=_bounds(piece,Transform3D.IDENTITY)
		if box.size.length()<0.01: continue
		var body=RigidBody3D.new()
		body.name="PhysicalRemains"
		body.collision_layer=8
		body.collision_mask=9
		body.mass=clampf(box.size.x*box.size.y*box.size.z*120,0.12,3)
		body.continuous_cd=true
		body.contact_monitor=true
		body.max_contacts_reported=4
		body.physics_material_override=PhysicsMaterial.new()
		body.physics_material_override.friction=0.8
		body.physics_material_override.bounce=0.18
		game.add_child(body)
		body.global_transform=world_pose
		piece.reparent(body)
		home.piece=null
		var collider=CollisionShape3D.new()
		var shape=BoxShape3D.new()
		shape.size=box.size.max(Vector3.ONE*0.035)
		collider.shape=shape
		collider.position=box.get_center()
		body.add_child(collider)
		body.add_to_group("pickup")
		body.add_to_group("physical_remains")
		body.set_meta("kind","weapon")
		body.set_meta("id","bone_club")
		body.set_meta("display_name",("Skeleton bone" if rig.type=="skeleton" else "Fallen "+rig.type+" piece")+" · grip / throw")
		body.set_meta("remains",true)
		body.set_meta("source_actor",actor.get_instance_id())
		body.set_meta("born",game.elapsed)
		body.set_meta("zone",str(actor.get_meta("zone",game.adventure.zone)))
		body.set_meta("damage_at",0.0)
		body.set_meta("grip_min",-box.size.y*0.3)
		body.set_meta("grip_max",box.size.y*0.3)
		var part_name := str(home.parent.name).to_lower()
		body.set_meta("tip",Vector3(0,box.position.y if "leg" in part_name else maxf(0.1,box.end.y),0))
		if rig.type == "skeleton" and "leg" in part_name: add_articulated_leg(body,box,piece)
		var outward=(body.global_position-actor.global_position-Vector3.UP*0.8).normalized()
		body.linear_velocity=(impulse+outward*0.8+Vector3.UP*0.4)*game.tuning.value("enemy.death_scatter")
		body.angular_velocity=Vector3(sin(count*2.4),cos(count*1.7),sin(count))*3
		body.body_entered.connect(func(other): _impact(body,other))
		bodies.append(body)
		count+=1
	rig.pieces=[]
	print("REMAINS spawned=",count," type=",rig.type)
	_trim()

func _impact(body,other):
	if is_instance_valid(body) and not body.freeze and body.linear_velocity.length()>1.0: _clack(body.global_position)
	if not is_instance_valid(body) or body.freeze or body.linear_velocity.length()<2.0 or game.elapsed<float(body.get_meta("damage_at",0)): return
	if not body.get_meta("player_thrown",false): return
	var target=game._owner(other)
	if target!=null and target.get_meta("kind","")=="enemy":
		body.set_meta("damage_at",game.elapsed+0.45)
		game.adventure.hurt_enemy(target,clampf(body.linear_velocity.length()*body.mass*4,5,25),null,body.linear_velocity.normalized()*0.8)
	elif target!=null and target.get_meta("kind","")=="rat": game._kill_rat(target)

func grab(body):
	body.freeze=true
	body.linear_velocity=Vector3.ZERO
	body.angular_velocity=Vector3.ZERO

func add_articulated_leg(body: RigidBody3D, box: AABB, original: Node3D) -> void:
	# The legacy death mesh is rigid. Replace only its detached leg display with
	# a shaped, three-section bone that retains a springy knee and ankle when carried.
	# Collision on the rigid body still spans the complete original leg; its
	# swept melee tip follows the articulated foot while gripped.
	original.visible = false
	var top := box.end.y
	var bottom := box.position.y
	var knee_y := lerpf(top, bottom, 0.48)
	var ankle_y := lerpf(top, bottom, 0.87)
	var bone_mat := StandardMaterial3D.new()
	bone_mat.albedo_color = Color("d9cfad")
	bone_mat.roughness = 0.82
	_bone_piece(body, "UpperLeg", Vector3(0, (top + knee_y) * 0.5, 0), top - knee_y, bone_mat)
	var knee := Node3D.new()
	knee.name = "SpringKnee"
	body.add_child(knee)
	knee.position.y = knee_y
	_bone_joint(knee, Vector3.ZERO, 0.095, bone_mat)
	_bone_piece(knee, "LowerLeg", Vector3(0, (ankle_y - knee_y) * 0.5, 0), knee_y - ankle_y, bone_mat)
	var ankle := Node3D.new()
	ankle.name = "SpringAnkle"
	knee.add_child(ankle)
	ankle.position.y = ankle_y - knee_y
	_bone_joint(ankle, Vector3.ZERO, 0.078, bone_mat)
	var foot := MeshInstance3D.new()
	foot.name = "ArticulatedFoot"
	var foot_mesh := PrismMesh.new()
	foot_mesh.size = Vector3(0.14, 0.09, 0.22)
	foot.mesh = foot_mesh
	foot.material_override = bone_mat
	ankle.add_child(foot)
	foot.position = Vector3(0, bottom - ankle_y + 0.04, 0.06)
	for toe_index in range(3):
		var toe := MeshInstance3D.new()
		toe.name = "ToeBone%d" % toe_index
		var toe_mesh := CapsuleMesh.new()
		toe_mesh.radius = 0.015
		toe_mesh.height = 0.09
		toe.mesh = toe_mesh
		toe.material_override = bone_mat
		foot.add_child(toe)
		toe.position = Vector3((toe_index - 1) * 0.04, -0.016, 0.095)
		toe.rotation.x = PI * 0.5
	var foot_collider := CollisionShape3D.new()
	foot_collider.name = "ArticulatedFootCollider"
	var foot_shape := BoxShape3D.new()
	foot_shape.size = Vector3(0.15, 0.10, 0.30)
	foot_collider.shape = foot_shape
	body.add_child(foot_collider)
	foot_collider.transform = body.global_transform.affine_inverse() * foot.global_transform
	leg_joints[body.get_instance_id()] = {"body":body,"knee":knee,"ankle":ankle,"foot":foot,"foot_collider":foot_collider,"angle":0.0,"speed":0.0,"last_basis":body.global_basis,"rest_tip":body.get_meta("tip")}
	body.set_meta("articulated_leg", true)

func _bone_piece(parent: Node3D, label: String, pos: Vector3, height: float, material: Material) -> void:
	var root := Node3D.new()
	root.name = label
	parent.add_child(root)
	root.position = pos
	var shaft := MeshInstance3D.new()
	var tapered := CylinderMesh.new()
	tapered.top_radius = 0.050 if label == "UpperLeg" else 0.043
	tapered.bottom_radius = 0.039 if label == "UpperLeg" else 0.035
	tapered.height = maxf(0.13, height)
	tapered.radial_segments = 10
	shaft.mesh = tapered
	shaft.material_override = material
	root.add_child(shaft)
	for end in [-1, 1]:
		for lobe in [-1, 1]:
			var knob := MeshInstance3D.new()
			var round := SphereMesh.new()
			round.radius = 0.043 if label == "UpperLeg" else 0.036
			round.height = round.radius * 1.7
			knob.mesh = round
			knob.material_override = material
			root.add_child(knob)
			knob.position = Vector3(lobe * round.radius * 0.56, end * height * 0.46, 0)

func _bone_joint(parent: Node3D, pos: Vector3, radius: float, material: Material) -> void:
	var mesh := MeshInstance3D.new()
	mesh.name = "JointKnob"
	var sphere := SphereMesh.new()
	sphere.radius = radius
	sphere.height = radius * 2
	mesh.mesh = sphere
	mesh.material_override = material
	parent.add_child(mesh)
	mesh.position = pos

func _tick_leg_joints(delta: float) -> void:
	for id in leg_joints.keys():
		var joint: Dictionary = leg_joints[id]
		var body: RigidBody3D = joint.body
		if not is_instance_valid(body):
			leg_joints.erase(id)
			continue
		if not body.is_visible_in_tree() and not _protected(body): continue
		if body.sleeping and not _protected(body): continue
		var prior: Basis = joint.last_basis
		var turn := wrapf(body.global_rotation.x - prior.get_euler().x, -PI, PI) / maxf(delta, 0.001)
		joint.last_basis = body.global_basis
		var target := clampf((body.angular_velocity.x + turn) * 0.055, -0.28, 0.32)
		# A fairly stiff damped joint retains the recognizable leg silhouette.
		joint.speed += (target - float(joint.angle)) * 28.0 * delta
		joint.speed *= exp(-8.0 * delta)
		joint.angle = clampf(float(joint.angle) + float(joint.speed) * delta, -0.32, 0.48)
		joint.knee.rotation.x = joint.angle
		joint.ankle.rotation.x = -joint.angle * 0.7
		body.set_meta("tip", body.to_local(joint.foot.global_position))
		var collision_pose: Transform3D = body.global_transform.affine_inverse() * joint.foot.global_transform
		if not joint.foot_collider.transform.is_equal_approx(collision_pose): joint.foot_collider.transform = collision_pose

func release(body,velocity,angular):
	body.reparent(game)
	body.set_meta("zone",game.adventure.zone)
	body.set_meta("born",game.elapsed)
	body.set_meta("player_thrown",true)
	game._set_collisions(body,true)
	body.freeze=false
	body.sleeping=false
	body.linear_velocity=velocity
	body.angular_velocity=angular.limit_length(15)

func _protected(body):
	if body in game.held.values() or game.grips.is_stowed(body): return true
	# A bone wedged onto an axe should not expire while that axe is being used.
	if body.get_meta("lodged_on_axe",false):
		var carrier=body.get_parent()
		return is_instance_valid(carrier) and (carrier in game.held.values() or game.grips.is_stowed(carrier))
	return false

func _trim():
	bodies=bodies.filter(func(b):return is_instance_valid(b))
	while bodies.size()>MAX_BODIES:
		var index=bodies.find_custom(func(b):return not _protected(b))
		if index<0: break
		bodies[index].queue_free()
		bodies.remove_at(index)

func tick():
	_tick_leg_joints(game.get_process_delta_time())
	for body in bodies:
		if not is_instance_valid(body) or _protected(body): continue
		if game.elapsed-float(body.get_meta("born",0))>LIFETIME or body.global_position.y< -20:
			body.queue_free()
			continue
		var active=str(body.get_meta("zone",""))==game.adventure.zone
		body.visible=active
		body.freeze=not active
	_trim()

func _exit_tree():
	if game==null or game.animation==null: return
	for rig in game.animation.actors.values():
		for home in rig.homes:
			if home.has("template") and is_instance_valid(home.template): home.template.free()

func _clack(point):
	if game.diagnostic_offline or DisplayServer.get_name()=="headless" or game.elapsed<sound_at or game.tuning.value("audio.volume")<=0: return
	sounds=sounds.filter(func(p):return is_instance_valid(p))
	if sounds.size()>=6: return
	sound_at=game.elapsed+0.07
	if clack==null:
		clack=AudioStreamWAV.new()
		clack.format=AudioStreamWAV.FORMAT_16_BITS
		clack.mix_rate=22050
		var bytes=PackedByteArray()
		bytes.resize(2205*2)
		var rng=RandomNumberGenerator.new()
		rng.seed=991
		for i in range(2205):
			var t=float(i)/22050
			var value=(sin(t*TAU*930)*0.4+rng.randf_range(-1,1)*0.6)*exp(-t*70)
			bytes.encode_s16(i*2,int(value*18000))
		clack.data=bytes
	var player=AudioStreamPlayer3D.new()
	game.add_child(player)
	player.global_position=point
	player.stream=clack
	player.pitch_scale=randf_range(0.90,1.12)
	player.max_distance=12
	player.volume_db=linear_to_db(game.tuning.value("audio.volume"))-14
	player.finished.connect(player.queue_free)
	sounds.append(player)
	player.play()
