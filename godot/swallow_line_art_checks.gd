extends SceneTree

var failures:Array=[]

func _initialize(): run.call_deferred()

func run():
	var game=load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	await physics_frame
	game.set_process(false)
	game.adventure.test_mode=true
	var hand=Node3D.new()
	game.add_child(hand)
	var item=game.adventure._tool_model("grappling_hook")
	game.add_child(item)
	game.held[str(hand.get_instance_id())]=item
	if not item.get_meta("swallow_line_authored",false): failures.append("authored Swallow Line not loaded")
	var spool=item.find_child("SpoolPivot",true,false) as Node3D
	var tip=item.find_child("HookTip",true,false) as Node3D
	if spool==null: failures.append("functional spool pivot missing")
	if tip==null: failures.append("hook tip marker missing")
	if spool!=null:
		if not item.has_meta("spool") or item.get_meta("spool")!=spool: failures.append("gameplay reel not connected to authored pivot")
		if not item.has_meta("tether_origin") or item.get_meta("tether_origin")!=tip: failures.append("tether does not start at authored hook tip")
		if spool.find_children("*","MeshInstance3D",true,false).size()<2: failures.append("spool has no visible moving drum and flanges")
		var before=spool.rotation.x
		item.set_meta("reeling",true)
		game.item_actions.tick(0.25)
		if spool.rotation.x-before<0.9: failures.append("held reel did not turn")
	if tip!=null and item.to_local(tip.global_position).y<0.6: failures.append("hook tip below the reel")
	print("SWALLOW_LINE_ART_CHECK_RESULT ",JSON.stringify({"failures":failures,"pivot":spool!=null,"tip":tip!=null}))
	quit(0 if failures.is_empty() else 1)
