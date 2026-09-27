extends SceneTree
## Run: Godot --headless --xr-mode off --path godot --script res://desktop_hero_actions_checks.gd

class Harness:
	extends RefCounted
	var primary_count=0
	var alternate_count=0
	var bomb_count=0
	var alternate_claimed=true
	func primary(): primary_count+=1
	func alternate()->bool:
		alternate_count+=1
		return alternate_claimed

var failures=[]
var checks=0

func _initialize():
	var began=Time.get_ticks_usec()
	var actions=preload("res://desktop_hero_actions.gd")
	var h=Harness.new()
	var left=InputEventMouseButton.new(); left.button_index=MOUSE_BUTTON_LEFT; left.pressed=true
	var right=InputEventMouseButton.new(); right.button_index=MOUSE_BUTTON_RIGHT; right.pressed=true
	var primary=Callable(h,"primary"); var alternate=Callable(h,"alternate")
	var result=actions.route(left,false,false,primary,alternate)
	check(result.handled and result.action=="primary" and h.primary_count==1 and h.alternate_count==0,"LMB routes exactly one primary action")
	result=actions.route(right,false,false,primary,alternate)
	check(result.handled and result.action=="alternate" and h.primary_count==1 and h.alternate_count==1,"RMB routes alternate without primary")
	result=actions.route(left,false,true,primary,alternate)
	check(not result.handled and h.primary_count==1 and h.bomb_count==0,"Bomb-owned LMB never fires weapon or spurious bomb")
	left.pressed=false
	result=actions.route(left,false,true,primary,alternate)
	check(not result.handled and h.primary_count==1,"Bomb release remains available to adventure keyboard")
	left.pressed=true
	result=actions.route(left,true,false,primary,alternate)
	check(not result.handled and h.primary_count==1,"Modal UI blocks weapon primary")
	result=actions.route(right,true,false,primary,alternate)
	check(not result.handled and h.alternate_count==1,"Modal UI blocks alternate")
	var motion=InputEventMouseMotion.new()
	result=actions.route(motion,false,false,primary,alternate)
	check(not result.handled and h.alternate_count==1,"Mouse motion remains available for look")
	h.alternate_claimed=false
	result=actions.route(right,false,false,primary,alternate)
	check(not result.handled and h.alternate_count==2,"Unclaimed RMB remains unhandled")
	print("DESKTOP_HERO_ACTIONS_CHECKS checks=",checks," failures=",failures.size()," elapsed_seconds=",(Time.get_ticks_usec()-began)/1000000.0)
	quit(0 if failures.is_empty() else 1)

func check(condition:bool,message:String):
	checks+=1
	if not condition: failures.append(message); push_error(message)
