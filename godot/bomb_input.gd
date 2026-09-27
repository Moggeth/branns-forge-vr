extends RefCounted
## Grip is always pickup. A fresh trigger press AFTER gripping arms the glove.
var hands={}
var arm_seconds=0.12

func tick(key,grip,was_grip,trigger,was_trigger,pickup,occupied,blocked,now)->bool:
	if not grip:
		hands.erase(key)
		return false
	if not was_grip: hands[key]={"pickup":pickup,"spent":false,"at":-1.0}
	if not hands.has(key): return false
	var hand=hands[key]
	if blocked or occupied or hand.pickup:
		hand.at=-1.0
		return false
	if not trigger: hand.at=-1.0
	if trigger and not was_trigger and was_grip and not hand.spent: hand.at=now
	if hand.at>=0 and trigger and now-hand.at>=arm_seconds:
		hand.spent=true
		hand.at=-1.0
		return true
	return false
