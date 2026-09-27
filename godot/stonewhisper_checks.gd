extends SceneTree

var failures:Array=[]

func _initialize(): run.call_deferred()

func run():
	var game=load("res://main.tscn").instantiate(); root.add_child(game)
	await physics_frame; await physics_frame
	game.set_process(false); game.adventure.test_mode=true
	var hand=Node3D.new(); game.add_child(hand); hand.global_position=Vector3(500,50,500)
	var item=game.adventure._tool_model("quarry_pick"); game.add_child(item)
	game.held[str(hand.get_instance_id())]=item
	var tips=0
	for part in item.get_children():
		if part is MeshInstance3D and part.mesh is CylinderMesh and absf(part.position.x)>.20 and absf(part.position.y-.59)<.02:
			if part.basis.y.x*signf(part.position.x)>0: tips+=1
	if tips!=2: failures.append("both spikes must point away from the pick eye")
	if not game.item_actions.trigger(hand,hand): failures.append("alternate action did not activate")
	if float(item.get_meta("stonewhisper_charged_until",0))<=game.elapsed: failures.append("charged window missing")
	if game.item_actions.projectiles.size()!=0: failures.append("obsolete stone dart still launches")
	var ore=Node3D.new(); game.add_child(ore); ore.set_meta("requires","pick")
	game.item_actions.resonant_mine(item,ore,hand.global_position,hand)
	if int(ore.get_meta("resonant_bonus",0))!=1: failures.append("strike has no material bonus")
	if float(item.get_meta("stonewhisper_charged_until",-1))!=0: failures.append("strike did not consume charge")
	ore.free(); item.free(); hand.free()
	print("STONEWHISPER_CHECK_RESULT ",JSON.stringify({"failures":failures}))
	quit(0 if failures.is_empty() else 1)
