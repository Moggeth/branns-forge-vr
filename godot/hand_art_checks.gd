extends RefCounted
## Validate imported hand scene contract in the actual Godot game, not only Blender.

static func run(game) -> void:
	game.set_process(false)
	var failures=[]
	var fake=Node3D.new()
	game.add_child(fake)
	game.adventure.build_hand(fake)
	var joints:Array=fake.get_meta("finger_joints",[])
	var thumb:Array=fake.get_meta("thumb_joints",[])
	if joints.size()!=12 or thumb.size()!=2: failures.append("missing imported finger pivots")
	if not is_instance_valid(fake.get_meta("index_tip",null)): failures.append("missing fingertip marker")
	if joints.size()==12:
		var old=joints[0].rotation
		preload("res://hand_animation.gd").tick(fake,true,0.1)
		if joints[0].rotation.is_equal_approx(old): failures.append("grip animation did not move index")
	var scene=load("res://assets/hands/pocket_thunder_hand_L.glb")
	if not scene is PackedScene: failures.append("left hand did not import")
	else:
		var left=scene.instantiate()
		fake.add_child(left)
		if left.find_child("L_Thumb_2",true,false)==null: failures.append("left thumb pivot missing")
		left.queue_free()
	fake.queue_free()
	print("HAND_ART_RESULT ",JSON.stringify(failures))
	game.get_tree().quit(0 if failures.is_empty() else 1)
