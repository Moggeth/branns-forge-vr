extends SceneTree
## Run with --headless --xr-mode off --audio-driver Dummy --script res://skeleton_pose_handoff_checks.gd
const Handoff = preload("res://skeleton_pose_handoff.gd")
const Adapter = preload("res://guardian_authored_animation.gd")
const Remains = preload("res://physical_remains.gd")
const Structure = preload("res://skeleton_structure.gd")
var failures: Array[String] = []

class FixtureGame extends Node:
	var guardian_authored
	var skeleton_pose_handoff
	var animation
	var tuning
	var adventure
	var elapsed := 1.0

class FixtureAnimation extends Node:
	var actors := {}

class FixtureTuning extends Node:
	func value(_key: String) -> float: return 1.0

class FixtureAdventure extends Node:
	var zone := "fixture"

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var scene := load("res://guardians/rigged/mossward_rig.glb") as PackedScene
	var actor := Node3D.new()
	root.add_child(actor)
	var visual := scene.instantiate() as Node3D
	actor.add_child(visual)
	var adapter := Adapter.new()
	root.add_child(adapter)
	var skeleton: Skeleton3D = adapter._find_skeleton(visual)
	var mesh: MeshInstance3D = adapter._find_mesh(visual,"LeftLeg")
	var game := FixtureGame.new()
	root.add_child(game)
	game.guardian_authored = adapter
	game.animation = FixtureAnimation.new()
	game.add_child(game.animation)
	game.tuning = FixtureTuning.new()
	game.add_child(game.tuning)
	game.adventure = FixtureAdventure.new()
	game.add_child(game.adventure)
	var entry := {"skeleton":skeleton,"visual":visual,"shattered":false,"part_meshes":{"leg_l":mesh},
		"bones":{"LeftLeg":adapter._bone_index(skeleton,"LeftLeg"),
			"LeftKnee":adapter._bone_index(skeleton,"LeftKnee"),"LeftFoot":adapter._bone_index(skeleton,"LeftFoot")}}
	adapter.entries[actor.get_instance_id()] = entry
	var handoff := Handoff.new()
	root.add_child(handoff)
	handoff.setup(game)
	game.skeleton_pose_handoff = handoff
	var initial := handoff.capture(actor,"leg_l")
	_check(not initial.is_empty(),"initial authored leg snapshot")
	if initial.is_empty(): _finish(); return
	var initial_box: AABB = initial.mesh.get_aabb()
	var original_world: AABB = mesh.global_transform * mesh.mesh.get_aabb()
	var baked_world: AABB = initial.transform * initial_box
	_check(original_world.position.distance_to(baked_world.position)<0.02 and original_world.size.distance_to(baked_world.size)<0.02,
		"rest skin/bind reproduces source mesh bounds")
	handoff.sample(actor)
	OS.delay_msec(20)
	skeleton.set_bone_pose_rotation(int(entry.bones.LeftLeg),Quaternion(Vector3.FORWARD,0.42))
	skeleton.set_bone_pose_rotation(adapter._bone_index(skeleton,"LeftKnee"),Quaternion(Vector3.RIGHT,0.30))
	skeleton.force_update_all_bone_transforms()
	handoff.sample(actor)
	var posed := handoff.capture(actor,"leg_l")
	_check(not posed.is_empty(),"posed authored leg snapshot")
	if not posed.is_empty():
		_check(posed.mesh.get_aabb().position.distance_to(initial_box.position)>0.005,"asymmetric pose changes baked leg vertices")
		_check(posed.mesh.surface_get_material(0)==mesh.mesh.surface_get_material(0),"authored material retained")
		_check(posed.linear_velocity.is_finite() and posed.angular_velocity.is_finite(),"finite inherited velocities")
		_check(posed.angular_velocity.length()>0.01,"sampled rotation produces angular motion")
		_check(posed.joints.has("knee") and posed.joints.has("foot"),"actual knee and foot anchors captured")
		var body := RigidBody3D.new()
		root.add_child(body)
		body.global_transform = posed.transform
		body.set_meta("tip",Vector3.DOWN)
		var display := MeshInstance3D.new()
		display.mesh = posed.mesh
		body.add_child(display)
		var remains := Remains.new()
		root.add_child(remains)
		remains.add_articulated_leg(body,posed.mesh.get_aabb(),display,true,posed.joints)
		_check(display.visible,"authored leg remains visible during articulation")
		_check(body.get_node("SpringKnee").position.distance_to(posed.joints.knee)<0.001,"spring knee matches animated knee")
		_check(body.get_node_or_null("ArticulatedFootCollider")!=null,"full foot collider")
		_check(body.get_meta("articulated_leg",false),"spring joints enabled")
		remains._tick_leg_joints(0.016)
		_check(body.get_meta("tip",Vector3.ZERO).is_finite(),"held club tip finite")
		var vertices := 0
		for surface in range(posed.mesh.get_surface_count()): vertices += posed.mesh.surface_get_array_len(surface)
		var capture_started := Time.get_ticks_usec()
		for repetition in range(10): handoff.capture(actor,"leg_l")
		var capture_ms := (Time.get_ticks_usec()-capture_started)*0.0001
		body.angular_velocity = Vector3(3,0,0)
		var spring_started := Time.get_ticks_usec()
		for repetition in range(10): remains._tick_leg_joints(0.016)
		var spring_ms := (Time.get_ticks_usec()-spring_started)*0.0001
		print("SKELETON_POSE_COST vertices=",vertices," surfaces=",posed.mesh.get_surface_count()," capture_ms_each=",snappedf(capture_ms,0.001)," spring_ms_each=",snappedf(spring_ms,0.001))
		# Death migrates the same posed art once and respects an already absent part.
		var joint := Node3D.new()
		actor.add_child(joint)
		var legacy := MeshInstance3D.new()
		legacy.mesh = BoxMesh.new()
		joint.add_child(legacy)
		legacy.visible = false
		var home := {"piece":legacy,"parent":joint,"transform":legacy.transform}
		var absent := {"piece":null,"parent":joint,"transform":Transform3D.IDENTITY}
		var rig := {"homes":[home,absent],"pieces":[legacy],"joints":{"leg_l":joint},"type":"skeleton"}
		entry["rig"] = rig
		entry["guardian"] = {}
		game.animation.actors[actor.get_instance_id()] = rig
		remains.setup(game)
		remains.shatter(actor)
		_check(remains.bodies.size()==1,"death creates one authored leg and no missing-part duplicate")
		if remains.bodies.size()==1:
			var corpse: RigidBody3D = remains.bodies[0]
			_check(corpse.get_node_or_null("AuthoredDetached_leg_l")!=null,"death retains authored leg")
			_check(corpse.global_position.distance_to(posed.transform.origin)<0.01,"death keeps current leg pose")
			var full_collider:CollisionShape3D=null
			for child in corpse.get_children():
				if child is CollisionShape3D and child.name!="ArticulatedFootCollider": full_collider=child
			_check(full_collider!=null and full_collider.shape is BoxShape3D and
				(full_collider.shape as BoxShape3D).size.y>=posed.mesh.get_aabb().size.y-0.01,
				"death collider spans hip through foot")
			_check(corpse.get_node_or_null("ArticulatedFootCollider")!=null,"death keeps foot collider")
	_variant_capture_costs(game,adapter,handoff)
	_finish()

func _variant_capture_costs(game: FixtureGame, adapter: Node, handoff: Node) -> void:
	for variant in ["mossward","prismwatch","cinderkeep"]:
		var actor := Node3D.new()
		root.add_child(actor)
		var visual := (load("res://guardians/rigged/"+variant+"_rig.glb") as PackedScene).instantiate()
		actor.add_child(visual)
		var skeleton: Skeleton3D=adapter._find_skeleton(visual)
		var leg: MeshInstance3D=adapter._find_mesh(visual,"LeftLeg")
		var bones:={}
		for name in ["LeftLeg","LeftKnee","LeftFoot"]: bones[name]=adapter._bone_index(skeleton,name)
		adapter.entries[actor.get_instance_id()]={"skeleton":skeleton,"visual":visual,"shattered":false,
			"part_meshes":{"leg_l":leg},"bones":bones}
		var sample:Dictionary=handoff.capture(actor,"leg_l")
		_check(not sample.is_empty(),variant+" weighted leg captured")
		if sample.is_empty(): continue
		_check(sample.joints.has("knee") and sample.joints.has("foot"),variant+" knee/foot pivots captured")
		var vertices:=0
		var tangents:=0
		var normal_mapped:=false
		var lower_weights:={"knee":0,"foot":0}
		var skin:Skin=leg.skin
		for surface in range(leg.mesh.get_surface_count()):
			vertices+=leg.mesh.surface_get_array_len(surface)
			var arrays:Array=leg.mesh.surface_get_arrays(surface)
			var tangent_array:PackedFloat32Array=arrays[Mesh.ARRAY_TANGENT]
			tangents+=tangent_array.size()/4
			var material:Material=leg.mesh.surface_get_material(surface)
			if material is BaseMaterial3D and material.normal_enabled: normal_mapped=true
			var bind_indices:PackedInt32Array=arrays[Mesh.ARRAY_BONES]
			var bind_weights:PackedFloat32Array=arrays[Mesh.ARRAY_WEIGHTS]
			var influences:=8 if leg.mesh.surface_get_format(surface) & Mesh.ARRAY_FLAG_USE_8_BONE_WEIGHTS else 4
			for vertex in range(leg.mesh.surface_get_array_len(surface)):
				for influence in range(influences):
					var slot:=vertex*influences+influence
					if slot>=bind_indices.size() or slot>=bind_weights.size() or bind_weights[slot]<0.1: continue
					var bind:=bind_indices[slot]
					if bind<0 or bind>=skin.get_bind_count(): continue
					var bind_name:=skin.get_bind_name(bind)
					if bind_name=="": bind_name=skeleton.get_bone_name(skin.get_bind_bone(bind))
					if bind_name.begins_with("LeftKnee"): lower_weights.knee+=1
					if bind_name.begins_with("LeftFoot"): lower_weights.foot+=1
		_check(not normal_mapped or tangents==vertices,variant+" normal map has baked tangent vectors")
		_check(lower_weights.knee>0 and lower_weights.foot>0,variant+" has weighted knee and foot mesh vertices")
		var started:=Time.get_ticks_usec()
		for repetition in range(10): handoff.capture(actor,"leg_l")
		var capture_ms:float=(Time.get_ticks_usec()-started)*0.0001
		var body:=RigidBody3D.new()
		root.add_child(body)
		body.global_transform=sample.transform
		body.set_meta("tip",Vector3.DOWN)
		var display:=MeshInstance3D.new()
		display.mesh=sample.mesh
		body.add_child(display)
		var remains:=Remains.new()
		root.add_child(remains)
		remains.add_articulated_leg(body,sample.mesh.get_aabb(),display,true,sample.joints)
		_check(body.get_node_or_null("ArticulatedFootCollider")!=null,variant+" authored foot collider")
		print("SKELETON_VARIANT_COST variant=",variant," vertices=",vertices," tangents=",tangents," weighted=",lower_weights,
			" normal_map=",normal_mapped," capture_ms_each=",snappedf(capture_ms,0.001))
		actor.queue_free()
		body.queue_free()
		remains.queue_free()

func _check(ok: bool, label: String) -> void:
	if not ok: failures.append(label)

func _finish() -> void:
	print("SKELETON_POSE_HANDOFF_RESULT ",JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
