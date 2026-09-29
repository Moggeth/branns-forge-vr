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
	if not item.get_meta("stonewhisper_authored",false): failures.append("authored pick was not loaded")
	for name in ["Grip","PickTipLeft","PickTipRight","ChargeGlow","HitCentre"]:
		if item.find_child(name,true,false)==null: failures.append("missing named marker: "+name)
	var left=item.find_child("PickTipLeft",true,false) as Node3D
	var right=item.find_child("PickTipRight",true,false) as Node3D
	if left!=null and right!=null:
		if left.global_basis.y.x>-.9 or right.global_basis.y.x<.9:
			failures.append("pick tips do not point outward")
		if absf(item.to_local(left.global_position).x)<.29 or absf(item.to_local(right.global_position).x)<.29:
			failures.append("pick tip span is too narrow")
	var crystal=item.get_meta("stonewhisper_crystal_material",null)
	if not crystal is StandardMaterial3D: failures.append("charge crystal lacks a unique material")
	var rest=float(item.get_meta("stonewhisper_crystal_rest",0.0))
	var physical=item.find_children("*","CollisionShape3D",true,false)
	if physical.is_empty() or not physical[0].shape is BoxShape3D or physical[0].shape.size.x<.68:
		failures.append("pick collider does not cover both visible tips")
	if not game.item_actions.trigger(hand,hand): failures.append("alternate action did not activate")
	if float(item.get_meta("stonewhisper_charged_until",0))<=game.elapsed: failures.append("charged window missing")
	if crystal is StandardMaterial3D and crystal.emission_energy_multiplier<=rest: failures.append("authored crystal did not brighten on charge")
	var charge_light=item.get_node_or_null("ResonanceChargeLight") as OmniLight3D
	if charge_light==null or charge_light.shadow_enabled or charge_light.omni_range>1.5: failures.append("bounded charge light missing")
	if game.item_actions.projectiles.size()!=0: failures.append("obsolete stone dart still launches")
	var ore=Node3D.new(); game.add_child(ore); ore.set_meta("requires","pick")
	game.item_actions.resonant_mine(item,ore,hand.global_position,hand)
	if int(ore.get_meta("resonant_bonus",0))!=1: failures.append("strike has no material bonus")
	if float(item.get_meta("stonewhisper_charged_until",-1))!=0: failures.append("strike did not consume charge")
	if crystal is StandardMaterial3D and not is_equal_approx(crystal.emission_energy_multiplier,rest): failures.append("crystal did not return to rest")
	if item.has_meta("stonewhisper_charge_light"): failures.append("consumed charge light remained attached")
	game.elapsed+=8.1
	game.item_actions.trigger(hand,hand)
	if float(item.get_meta("stonewhisper_charged_until",0))<=game.elapsed: failures.append("second charge did not start")
	game.held.erase(str(hand.get_instance_id()))
	game.elapsed+=9.0
	game.item_actions.tick(0.01)
	if float(item.get_meta("stonewhisper_charged_until",-1))!=0: failures.append("dropped charge did not expire")
	ore.free(); item.free(); hand.free()
	print("STONEWHISPER_CHECK_RESULT ",JSON.stringify({"failures":failures}))
	quit(0 if failures.is_empty() else 1)
