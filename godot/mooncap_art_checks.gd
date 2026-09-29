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
	hand.global_position=Vector3(2,1.5,2)
	var item=game.adventure._tool_model("spore_lantern")
	game.add_child(item)
	game.held[str(hand.get_instance_id())]=item
	if not item.get_meta("mooncap_authored",false): failures.append("authored Mooncap Lantern not loaded")
	var glow=item.find_child("MooncapGlow",true,false) as MeshInstance3D
	var anchor=item.find_child("LightAnchor",true,false) as Node3D
	if glow==null: failures.append("luminous mooncap mesh missing")
	if anchor==null: failures.append("light anchor missing")
	var lights=item.find_children("*","OmniLight3D",true,false)
	if lights.size()!=1: failures.append("expected exactly one held lantern light")
	elif lights[0].shadow_enabled: failures.append("held light should be shadowless")
	if not game.item_actions.trigger(hand,hand): failures.append("spore-garden action rejected")
	if game.item_actions.gardens.size()!=1: failures.append("spore garden did not spawn")
	game.item_actions.trigger(hand,hand)
	if game.item_actions.gardens.size()!=1: failures.append("spore garden cooldown ignored")
	print("MOONCAP_ART_CHECK_RESULT ",JSON.stringify({"failures":failures,"lights":lights.size(),"garden_count":game.item_actions.gardens.size()}))
	quit(0 if failures.is_empty() else 1)
