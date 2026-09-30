extends SceneTree
## Fast, save-free binding and real-reel check:
## Godot --headless --xr-mode off --path godot --script res://item_control_checks.gd
const Hints=preload("res://item_control_hints.gd")
const Extras=preload("res://siegebird_extras.gd")
const Actions=preload("res://item_interactions.gd")

class Zone:
	var zone:="forge_yard"

class Game extends Node3D:
	var vr:=false
	var camera:=Node3D.new()
	var adventure:=Zone.new()
	var siegebird
	var messages:=[]
	var elapsed:=1.0
	var desktop_hand:=Node3D.new()
	var melee:=Melee.new()
	func _notice(message, _seconds=3): messages.append(message)
	func _effect(_position, _color, _duration, _radius): pass

class Melee:
	func alternate(item, _hand): item.set_meta("axe_power_armed",true)

class System extends Node:
	var w
	var extras
	var mechanisms:=0
	func desktop_weapon(_hand): return w
	func mechanism(_w): mechanisms+=1

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures:=[]
	var catalog=JSON.parse_string(FileAccess.get_file_as_string("res://weapon_inspection_catalog.json"))
	if catalog==null or catalog.subjects.size()!=20:
		failures.append("review catalogue is not the expected 20 items")
	else:
		for subject in catalog.subjects:
			var item:=Node3D.new()
			item.set_meta("id",subject.id)
			var fps:String=Hints.desktop(null,item,null) if subject.id!="siegebird" else ""
			var vr:String=Hints.vr(null,item)
			if not Hints.has(subject.id) or (subject.id!="siegebird" and fps.is_empty()) or vr.is_empty(): failures.append("missing control binding: "+subject.id)
			if fps.contains("Trigger") or fps.contains("trigger"): failures.append("VR control leaked into FPS hint: "+subject.id)
			if subject.id!="siegebird" and (not fps.contains("Space jump") or not fps.contains("E ")): failures.append("FPS hint omitted movement/drop: "+subject.id)
			item.free()
	var game:=Game.new()
	root.add_child(game)
	game.add_child(game.camera)
	game.add_child(game.desktop_hand)
	var system:=System.new()
	game.add_child(system)
	game.siegebird=system
	var extras:=Extras.new()
	game.add_child(extras)
	extras.game=game
	extras.system=system
	system.extras=extras
	var hand:=Node3D.new()
	game.add_child(hand)
	var item:=Node3D.new()
	game.add_child(item)
	item.set_meta("id",Hints.SIEGEBIRD)
	var socket:=Node3D.new()
	item.add_child(socket)
	system.w={"item":item,"reel_socket":socket,"reel_installed":false,"grapple_mode":false,"loaded":true}
	extras.rack=Node3D.new()
	game.add_child(extras.rack)
	extras.reel_item=Node3D.new()
	extras.rack.add_child(extras.reel_item)
	extras.reel_item.position=Vector3(0.42,0.97,0)
	game.camera.position=Vector3(0,1,1)
	if not extras.desktop_toggle_reel(hand) or extras.reel_item.get_parent()!=socket or extras.reel_owner!=system.w or not system.w.reel_installed:
		failures.append("FPS C did not install the existing rack reel")
	var with_reel:String=Hints.desktop(game,item,hand)
	if not with_reel.contains("RMB") or not with_reel.contains("C at rack") or not with_reel.contains("unlimited bolts"):
		failures.append("fitted reel hint omits mode and free bolts")
	if not with_reel.contains("X throw") or not with_reel.contains("Space jump"): failures.append("Siegebird hint omitted throw/jump")
	game.camera.position=Vector3(20,1,20)
	extras.desktop_toggle_reel(hand)
	if not system.w.reel_installed: failures.append("FPS removed reel away from supply rack")
	game.camera.position=Vector3(0,1,1)
	extras.rope.state={"item":item}
	extras.desktop_toggle_reel(hand)
	if not system.w.reel_installed: failures.append("FPS removed reel from live tether")
	extras.rope.state.clear()
	extras.desktop_toggle_reel(hand)
	if system.w.reel_installed or extras.reel_owner!=null or extras.reel_item.get_parent()!=extras.rack or system.w.grapple_mode:
		failures.append("FPS reel did not return as the same rack item")
	var generated:=Node3D.new()
	generated.set_meta("use_instructions","Hold trigger to spark")
	if Hints.desktop(game,generated,hand).contains("trigger"): failures.append("generated VR prose shown as FPS binding")
	var actions:=Actions.new()
	game.add_child(actions)
	actions.game=game
	var axe:=Node3D.new()
	game.add_child(axe)
	axe.set_meta("id","woodland_axe")
	actions.desktop_axe_state(axe,true)
	if not axe.get_meta("axe_power_ready",false) or not axe.get_meta("axe_power_armed",false) or not is_instance_valid(axe.get_meta("axe_power_marker",null)):
		failures.append("held RMB failed to arm visible axe cleave")
	actions.desktop_axe_state(axe,false)
	if axe.get_meta("axe_power_ready",true) or axe.get_meta("axe_power_armed",true) or axe.get_meta("axe_power_marker").visible:
		failures.append("released RMB left axe powered")
	print("ITEM_CONTROL_RESULT ",JSON.stringify(failures))
	generated.free()
	game.free()
	quit(0 if failures.is_empty() else 5)
