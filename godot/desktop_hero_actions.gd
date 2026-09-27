extends RefCounted
## Routes desktop weapon presses after modal UI and adventure.keyboard have first refusal.
## The caller keeps weapon behavior in its existing _trigger / alternate dispatch.
## Right-button motion is deliberately untouched so hold-to-look still works.

static func route(event: InputEvent, blocked: bool, primary_owned: bool, primary: Callable, alternate: Callable) -> Dictionary:
	var result={"handled":false,"action":""}
	if blocked or not event is InputEventMouseButton or not event.pressed: return result
	if event.button_index==MOUSE_BUTTON_LEFT:
		# Bomb formation owns both edges of LMB. Its release must reach adventure.keyboard.
		if primary_owned or not primary.is_valid(): return result
		primary.call()
		return {"handled":true,"action":"primary"}
	if event.button_index==MOUSE_BUTTON_RIGHT and alternate.is_valid():
		# An unclaimed RMB press remains available to other input handlers.
		if alternate.call(): return {"handled":true,"action":"alternate"}
	return result
