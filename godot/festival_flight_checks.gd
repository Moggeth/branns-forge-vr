extends SceneTree
## Isolated regression: no old ring flight may count in a freshly started relay.
const Legacy=preload("res://bankshot_checks.gd")
class Game extends Legacy.Game:
	var cargo_playground
var checks=0
var failures=[]
func check(condition,message):
	checks+=1
	if not condition: failures.append(message); push_error(message)
func _initialize(): run.call_deferred()
func launch(game):
	var toy=game.playful_tools
	game.camera.look_at(game.playful_encounters.bells[0].global_position+Vector3.UP*.2)
	game.desktop_hand.global_transform=game.camera.global_transform
	toy.last_camera_position=game.camera.position
	toy.retrieve(game.desktop_hand); toy.release(game.desktop_hand)
func advance(game,seconds):
	for step in range(ceili(seconds/.02)):
		game.playful_encounters.tick(.02); game.playful_tools.tick(.02)
func run():
	var began=Time.get_ticks_usec()
	var game=Game.new(); root.add_child(game); game.initialize()
	game.camera.position=Vector3(120,1.7,70); game.desktop_hand.transform=game.camera.transform
	game.playful_tools=preload("res://playful_tools.gd").new(); game.add_child(game.playful_tools); game.playful_tools.setup(game)
	game.playful_encounters=preload("res://playful_encounters.gd").new(); game.add_child(game.playful_encounters); game.playful_encounters.setup(game)
	game.cargo_playground=preload("res://cargo_playground.gd").new(); game.add_child(game.cargo_playground); game.cargo_playground.game=game
	var relay=preload("res://festival_relay.gd").new(); game.add_child(relay); relay.game=game
	game.playful_encounters.bell_struck.connect(relay._bell_struck)
	await physics_frame
	var toy=game.playful_tools
	launch(game); advance(game,.3)
	check(toy.state=="flying" and toy.flight_age>=.29,"Reproducer has a real pre-start swept flight approaching the bell")
	var before=toy.throw_id
	relay.act("timed")
	check(toy.state=="home" and toy.caller==null and toy.holder==null,"Starting retires the previously released ring flight")
	advance(game,1.5)
	check(relay.mode=="running" and relay.ring_hits==0 and toy.throw_id==before,"Old trajectory cannot score after timed start without a new release")
	launch(game); advance(game,1.5)
	check(relay.ring_hits==1 and toy.throw_id==before+1,"A genuine post-start release still scores through real bell collision")
	launch(game); advance(game,.3); relay.act("restart"); advance(game,1.5)
	check(relay.ring_hits==0 and toy.state=="home","Restart also retires an in-flight throw from the preceding run")
	launch(game); advance(game,.1); toy.trigger(game.desktop_hand)
	check(toy.state=="returning","Returning-flight case uses actual trigger recall")
	relay.act("restart")
	check(toy.state=="home" and relay.ring_hits==0,"Restart retires old recall as well as outbound flight")
	toy.retrieve(game.desktop_hand); var same_ring=toy.ring
	relay.act("restart")
	check(toy.state=="held" and toy.holder==game.desktop_hand and toy.ring==same_ring,"Restart preserves the already held single ring and its hand ownership")
	toy.release(game.desktop_hand); advance(game,1.5)
	check(relay.ring_hits==1,"Preserved held ring can be released normally to score in the new run")
	check(not relay.state.medal and not relay.persistence_enabled and not game.playful_encounters.persistence_enabled,"No medal is invented and diagnostic checks never enable normal saves")
	toy.sound.stop(); await create_timer(.1).timeout
	game.free(); await create_timer(.1).timeout
	print("FESTIVAL_FLIGHT_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)
