extends Node
## Six compact entries for the existing palm Demo page. Root owns save/reset UI.
var game

func setup(owner_game): game=owner_game

func rows()->Array:
	return [["Ring & bells","demo:ring"],["Copper Kite","demo:cargo"],["Lullaby garden","demo:garden"],["Festival relay","demo:relay"],["Visit archive","demo:archive"],["Tune tools","demo:tuning"]]

func hint_text(action:String)->String:
	var vr=game!=null and game.get("vr")==true
	match action.trim_prefix("demo:"):
		"ring":
			return "SUNSKIPPER · Grip takes; release throws. Trigger: power/recall.\nFollow the bell board from behind the gold line.\nNext: Bankshot Bell. Bounce off its wall, then hit the target." if vr else "SUNSKIPPER · E takes/throws. Click: power/recall.\nFollow the bell board from behind the gold line.\nNext: Bankshot Bell. Bounce off its wall, then hit the target."
		"cargo":
			return "COPPER KITE · Grip equips; trigger pulls/drops.\nA flings. Settle SUN, LEAF and MOON in their nests.\nThen grip and pull the bloom lever." if vr else "COPPER KITE · E equips; click pulls/drops.\nX flings. Settle SUN, LEAF and MOON in their nests.\nThen click GROW COPPER BLOOM."
		"garden":
			return "LULLABY · Prepare in archive; wait for Ready; Enter Experiment.\nBring light and the warm pebble to matching buds.\nBring the handbell to SOUND; trigger/click rings it."
		"cinderloop":
			return "CINDERLOOP · Prepare in archive; take from stand near Brann.\nGrip/release (desktop E) takes/throws the ring.\nEmpty trigger/click recalls; impacts light its lantern."
		"relay":
			return "FESTIVAL RELAY · Choose Practice or Timed at the board.\nRing, cargo, then Lullaby light + sound.\nRestart or Abandon at the board; visiting does not start."
	return ""

func act(action:String)->bool:
	if game==null: return false
	action=action.trim_prefix("demo:")
	if action=="relay":
		if game.get("festival_relay")!=null:
			game.festival_relay.act("visit")
			game._notice(hint_text("relay"),12)
		else: game._notice("The festival relay board is not ready yet.",4)
		return true
	var message=hint_text(action)
	if not message.is_empty():
		game._notice(message,12)
		var stand=null
		if action=="ring" and game.get("playful_tools")!=null:
			stand=game.playful_tools.court_stand if game.camera.global_position.distance_to(game.playful_tools.court_stand.global_position)<20 else game.playful_tools.stand
		elif action=="cargo" and game.get("magnetic_wand")!=null: stand=game.magnetic_wand.stand
		if is_instance_valid(stand) and game.get("playful_feedback")!=null and game.camera.global_position.distance_to(stand.global_position)<12:
			game.playful_feedback.pulse(stand.global_position+Vector3.UP*1.2,"progress",.5)
		return true
	if action=="archive":
		if game.get("living")!=null and game.living.get("museum")!=null:
			game.living.museum.act("enter")
		else: game._notice("The archive is not ready yet.",4)
		return true
	if action=="tuning":
		if game.get("qol")!=null and game.get("tuning")!=null:
			game.qol.page="tuning"; game.tuning.action("playful")
		return true
	return false
