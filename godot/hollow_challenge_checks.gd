extends SceneTree
## Run with Godot --headless --xr-mode off --path godot --script res://hollow_challenge_checks.gd.

class MockAdventure:
	extends Node
	var haptic_count = 0
	var challenge
	func haptic(_hand, _event): haptic_count += 1
	func interact(target, id, hand): return challenge.interact(target,id,hand)

class MockGame:
	extends Node3D
	var scene = {"zones": {"crystal_hollow": {"center": Vector3(52,0,52)}}}
	var adventure = MockAdventure.new()
	var atelier = null
	var sunfall = null
	var camera = Node3D.new()
	var desktop_hand = Node3D.new()
	var held = {}
	var ray_target: Node
	var notices = []
	func _init():
		add_child(adventure)
		add_child(camera)
		camera.add_child(desktop_hand)
	func _notice(message, _seconds = 0): notices.append(message)
	func _effect(_position, _color, _duration, _scale): pass
	func _ray(_source, _distance): return {"collider": ray_target}
	func _owner(collider): return collider
	func _collider(parent: Node3D, size: Vector3, center: Vector3):
		var body = StaticBody3D.new()
		parent.add_child(body)
		var shape = CollisionShape3D.new()
		var box = BoxShape3D.new()
		box.size = size
		shape.shape = box
		shape.position = center
		body.add_child(shape)
	func _set_collisions(node: Node, enabled: bool):
		if node is CollisionShape3D: node.disabled = not enabled
		for child in node.get_children(): _set_collisions(child,enabled)

var failures = []
var test_path = "user://hollow_challenge_test.json"

func _initialize():
	call_deferred("_run")

func check(condition: bool, label: String):
	if not condition: failures.append(label)

func _run():
	DirAccess.remove_absolute(ProjectSettings.globalize_path(test_path))
	var game = MockGame.new()
	root.add_child(game)
	var zone = Node3D.new()
	game.add_child(zone)
	var challenge = load("res://hollow_challenge.gd").new()
	challenge.save_path = test_path
	game.add_child(challenge)
	challenge.setup(game,zone)
	check(not challenge.reward_claimed(),"fresh ward locked")
	challenge.interact(challenge.devices.vault,"hand")
	check(not challenge.reward_claimed(),"sealed vault cannot be claimed")
	check(challenge.interact(challenge.devices.fracture,"apprentice_hammer"),"wrong tool handled")
	check(not challenge.progress.fracture,"wrong tool leaves seal closed")
	challenge.blast(challenge.devices.fracture.global_position,2.0)
	check(challenge.progress.fracture,"bomb opens fracture")
	check(challenge.interact(challenge.devices.song,"apprentice_hammer"),"first hammer beat")
	check(not challenge.progress.song,"one beat is insufficient")
	challenge.interact(challenge.devices.song,"apprentice_hammer")
	challenge.interact(challenge.devices.song,"apprentice_hammer")
	check(challenge.progress.song,"third beat opens song")
	check(not challenge.veil.visible,"vault opens after both seals")
	challenge.interact(challenge.devices.vault,"hand")
	check(challenge.reward_claimed(),"ward claimed")
	check(FileAccess.file_exists(test_path),"progress saved")
	var remembered = load("res://hollow_challenge.gd").new()
	remembered.save_path = test_path
	game.add_child(remembered)
	remembered.setup(game,zone)
	check(remembered.reward_claimed(),"ward survives reload")
	check(remembered.progress.fracture and remembered.progress.song,"seals survive reload")
	check(remembered.journal_line().contains("20%"),"journal explains ward")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(test_path))
	var alternate = load("res://hollow_challenge.gd").new()
	alternate.save_path = test_path
	game.add_child(alternate)
	alternate.setup(game,zone)
	var input_runtime = load("res://adventure_runtime.gd").new()
	game.add_child(input_runtime)
	input_runtime.game = game
	input_runtime.hollow = alternate
	var tool = Node3D.new()
	game.add_child(tool)
	tool.set_meta("id","quarry_pick")
	game.held[str(game.desktop_hand.get_instance_id())] = tool
	var click = InputEventMouseButton.new()
	click.button_index = MOUSE_BUTTON_LEFT
	click.pressed = true
	game.ray_target = alternate.devices.fracture
	check(input_runtime.keyboard(click),"desktop click reaches fracture")
	tool.set_meta("id","crystal_resonator")
	game.ray_target = alternate.devices.song
	check(input_runtime.keyboard(click),"desktop click reaches song")
	check(alternate.progress.fracture and alternate.progress.song,"pick and resonator route")
	check(not alternate.reward_claimed(),"opening alone does not claim reward")
	check(not alternate.veil.visible,"open vault veil hidden")
	check(not alternate.devices.vault.get_child(0).get_child(0).disabled,"open vault target collider active")
	game.held.clear()
	game.ray_target = alternate.devices.vault
	check(input_runtime.trigger(game.desktop_hand,game.camera),"empty hand reaches open vault")
	check(alternate.reward_claimed(),"empty hand claims ward")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(test_path))
	var impact = load("res://hollow_challenge.gd").new()
	impact.save_path = test_path
	game.add_child(impact)
	impact.setup(game,zone)
	game.adventure.challenge = impact
	var melee = load("res://melee_contact.gd").new()
	game.add_child(melee)
	melee.game = game
	tool.set_meta("id","quarry_pick")
	check(melee.strike(impact.devices.fracture,Vector3.ZERO,Vector3.UP,3,game.desktop_hand,tool),"physical pick impact routed")
	tool.set_meta("id","apprentice_hammer")
	for beat in range(3): melee.strike(impact.devices.song,Vector3.ZERO,Vector3.UP,3,game.desktop_hand,tool)
	check(impact.progress.fracture and impact.progress.song,"physical impacts solve both seals")
	check(melee.strike(impact.devices.vault,Vector3.ZERO,Vector3.UP,3,game.desktop_hand,tool),"physical vault interaction routed")
	check(impact.reward_claimed(),"physical vault impact claims ward")
	DirAccess.remove_absolute(ProjectSettings.globalize_path(test_path))
	print("HOLLOW_CHECK_RESULT ",JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
