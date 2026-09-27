extends RefCounted
## Reusable visual attachment: tracked controllers remain untouched for input/physics.
var active={}
var returning={}
func attach(hand:Node3D,target:Node3D,pose:Transform3D,ease=0.08):
	var key=str(hand.get_instance_id())
	returning.erase(key)
	var visual=hand.get_meta("hand_visual") if hand.has_meta("hand_visual") else null
	active[key]={"hand":hand,"target":target,"pose":pose,"visual":visual,"rest":Transform3D.IDENTITY,"age":0.0,"away":0.0,"ease":ease}
	hand.set_meta("anchored_grip",true)
func detach(hand):
	var key=str(hand.get_instance_id())
	if not active.has(key): return
	var entry=active[key]; active.erase(key); hand.set_meta("anchored_grip",false)
	if is_instance_valid(entry.visual): returning[key]=entry
func distance(hand)->float:
	var entry=active.get(str(hand.get_instance_id()),{})
	if entry.is_empty() or not is_instance_valid(entry.target): return INF
	return hand.global_position.distance_to(entry.target.global_position)
func tick(delta):
	for key in active.keys():
		var e=active[key]
		if not is_instance_valid(e.hand) or not is_instance_valid(e.target):
			if is_instance_valid(e.hand): detach(e.hand)
			else: active.erase(key)
			continue
		e.age+=delta
		if is_instance_valid(e.visual):
			var desired=e.target.global_transform.orthonormalized()*e.pose
			e.visual.global_transform=e.visual.global_transform.interpolate_with(desired,clampf(e.age/maxf(0.01,e.ease),0,1))
	for key in returning.keys():
		var e=returning[key]
		if not is_instance_valid(e.visual): returning.erase(key); continue
		e.visual.transform=e.visual.transform.interpolate_with(e.rest,1-exp(-delta*32))
		if e.visual.position.length()<0.001: e.visual.transform=e.rest; returning.erase(key)
