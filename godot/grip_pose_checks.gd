extends SceneTree
var game
var failures:Array=[]
var checks=0

func _initialize(): run.call_deferred()

func check(ok:bool,description:String):
	checks+=1
	if not ok: failures.append(description)

func run():
	game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame
	game.set_process(false)
	for side in ["left_hand","right_hand"]:
		var hand=XRController3D.new(); hand.tracker=StringName(side); game.qol.tracking_space.add_child(hand)
		for id in [game.grips.WYRM_V1,game.grips.WYRM_V2]:
			var item=Node3D.new(); item.set_meta("kind","weapon"); item.set_meta("id",id); item.set_meta("creation_version",2 if id==game.grips.WYRM_V2 else 1)
			game.add_child(item); game.grips._attach(hand,item)
			var socket=game.hand_socket(hand)
			var authored_forward=Vector3.UP if id==game.grips.WYRM_V1 else Vector3.FORWARD
			check((item.global_basis*authored_forward).normalized().dot(-socket.global_basis.z)>0.98, "forward axis "+id+" "+side)
			if id==game.grips.WYRM_V2:
				var expected_roll=Vector3.DOWN if side=="left_hand" else Vector3.UP
				check((item.basis*Vector3.RIGHT).dot(expected_roll)>0.98,"dorsal roll "+side)
			check(game.grips._pose_key(item,hand).ends_with(side),"side-specific persistence key")
			game.held.erase(str(hand.get_instance_id())); game.grips.grips.erase(str(hand.get_instance_id())); item.queue_free()
		var axe=game.adventure._tool_model("woodland_axe")
		game.add_child(axe); game.grips._attach(hand,axe)
		var edge=(axe.global_basis*Vector3.RIGHT).normalized()
		var tip_direction=(axe.to_global(axe.get_meta("tip"))-axe.to_global(Vector3(0,0.62,0))).normalized()
		var mount=axe.get_node("AxeHeadOrientation")
		check(edge.dot(tip_direction)>0.98,"axe contact tip faces the visible blade "+side)
		check((mount.global_basis*Vector3.RIGHT).normalized().dot(edge)>0.98,"axe head rotates around haft "+side)
		check(edge.dot(-game.hand_socket(hand).global_basis.z)>0.98,"axe blade points away from player along index "+side)
		check(game.melee._is_blade(axe,-edge) and not game.melee._is_blade(axe,edge),"axe blade and poll are distinct "+side)
		game.held.erase(str(hand.get_instance_id())); game.grips.grips.erase(str(hand.get_instance_id())); axe.queue_free()
		hand.queue_free()
	var pose=Transform3D(Basis(Vector3.FORWARD,0.21),Vector3(0.02,-0.03,-0.04))
	check(game.grips._array_to_pose(game.grips._pose_to_array(pose)).is_equal_approx(pose),"calibrated grip save round-trip")
	check(game.grips._array_to_pose([1,2]).is_equal_approx(Transform3D.IDENTITY),"invalid pose rejected")
	game.player_avatar._process(0.016)
	var head_forward: Vector3 = -game.camera.global_basis.z
	head_forward.y = 0
	head_forward = head_forward.normalized()
	var body_delta: Vector3 = game.player_avatar.global_position - game.camera.global_position
	check(Vector2(body_delta.x,body_delta.z).length() >= 0.09 and body_delta.dot(head_forward) < -0.09,"torso rests behind the headset instead of in front")
	for slot in game.grips.slots:
		check(slot.root.get_node_or_null("Scabbard") != null and slot.root.get_node_or_null("BrassMouth") != null,"holster has authored leather/brass geometry")
	var axe_pose_item := Node3D.new()
	axe_pose_item.set_meta("id", "woodland_axe")
	var bow_pose_item := Node3D.new()
	bow_pose_item.set_meta("crossbow", true)
	check(not game.grips._holster_pose(axe_pose_item,1).is_equal_approx(game.grips._holster_pose(bow_pose_item,1)),"axe and crossbow have distinct holster poses")
	axe_pose_item.free()
	bow_pose_item.free()
	print("GRIP_POSE_RESULT ",JSON.stringify({"checks":checks,"failures":failures}))
	quit(0 if failures.is_empty() else 1)
