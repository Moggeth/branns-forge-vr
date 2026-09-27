extends Node
## The authored lantern is art; these are its game-facing grip, shutter and light rules.
const MAX_OPEN := 1.72
const SHUTTER_REACH := 0.115
const RELEASE_DISTANCE := 0.28

var game
var id: String
var display_name: String
var item: Node3D
var hinge: Node3D
var thumb: Node3D
var flame: Node3D
var grip: Node3D
var light: OmniLight3D
var angle := 0.0
var target_angle := 0.0
var shutter_hand: Node3D
var grab_angle := 0.0
var grab_start := 0.0

func setup(owner_game, item_id: String, name: String, asset_path: String) -> void:
	game = owner_game
	id = item_id
	display_name = name
	item = Node3D.new()
	item.name = name
	item.set_meta("kind", "weapon")
	item.set_meta("id", id)
	item.set_meta("display_name", name)
	item.set_meta("ranged", true) # A lamp is not a melee weapon.
	item.set_meta("mass", 0.72)
	item.set_meta("display_height", 0.88) # Foot rests on the collection shelf.
	item.set_meta("display_yaw", PI / 2.0 if id.ends_with("sol") else -PI / 2.0)
	item.set_meta("grip_min", 0.12)
	item.set_meta("grip_max", 0.15)
	item.set_meta("use_instructions", "Grip: carry · other hand: grip brass shutter tab and pull · Trigger: toggle")
	item.add_to_group("pickup")
	game.add_child(item)
	var model := (load(asset_path) as PackedScene).instantiate() as Node3D
	model.name = "AuthoredLantern"
	item.add_child(model)
	hinge = model.find_child("ShutterHinge", true, false) as Node3D
	thumb = model.find_child("ShutterThumb", true, false) as Node3D
	flame = model.find_child("Flame", true, false) as Node3D
	grip = model.find_child("Grip", true, false) as Node3D
	if hinge == null or thumb == null or flame == null or grip == null:
		push_error("FORGE_LANTERN required exported socket missing")
		return
	var grip_offset: Vector3 = item.to_local(grip.global_position)
	var pose := Transform3D(Basis.IDENTITY, -grip_offset + Vector3(0, -0.02, 0))
	item.set_meta("grip_preferences", {"left_hand": pose, "right_hand": pose,
		"left": pose, "right": pose,
		"desktop": Transform3D(Basis.IDENTITY, Vector3(-0.11, -0.01, -0.28) - grip_offset)})
	light = OmniLight3D.new()
	light.name = "ShutteredFlameLight"
	flame.add_child(light)
	light.light_color = Color("ffbd73")
	light.omni_range = 4.2
	light.light_energy = 0.12
	light.shadow_enabled = false # One cheap light, even when the lantern is carried.
	var bounds: AABB = game.remains._bounds(item, Transform3D.IDENTITY)
	game._collider(item, bounds.size + Vector3.ONE * 0.012, bounds.get_center())
	game.collection.register(item)
	print("FORGE_LANTERN_READY id=", id, " asset=", asset_path, " home=", game.collection.order.find(id) + 1)

func busy(hand: Node3D) -> bool:
	return is_instance_valid(shutter_hand) and hand == shutter_hand

func _hand_angle(hand: Node3D) -> float:
	var offset: Vector3 = item.to_local(hand.global_position) - item.to_local(hinge.global_position)
	return atan2(-offset.z, offset.x)

func try_grab_shutter(hand: Node3D, desktop: bool) -> bool:
	if desktop or not is_instance_valid(item) or not is_instance_valid(thumb): return false
	if is_instance_valid(shutter_hand) or game.held.has(str(hand.get_instance_id())): return false
	if item not in game.held.values(): return false
	if hand.global_position.distance_to(thumb.global_position) > SHUTTER_REACH: return false
	shutter_hand = hand
	grab_angle = _hand_angle(hand)
	grab_start = target_angle
	game.adventure.haptic(hand, "ready")
	game._notice("Shutter in hand · pull the brass tab, then release to leave it there.", 4)
	return true

func release(hand: Node3D) -> bool:
	if not busy(hand): return false
	shutter_hand = null
	if target_angle < 0.12: target_angle = 0.0
	if target_angle > MAX_OPEN - 0.12: target_angle = MAX_OPEN
	game.adventure.haptic(hand, "ready")
	return true

func trigger(hand: Node3D) -> bool:
	if busy(hand): return true
	if not is_instance_valid(item) or game.held.get(str(hand.get_instance_id())) != item: return false
	target_angle = 0.0 if target_angle > MAX_OPEN * 0.45 else MAX_OPEN
	game.adventure.haptic(hand, "ready")
	game._notice("Lantern shutter "+("open · warm light" if target_angle > 0 else "closed · ember glow"), 3)
	return true

func tick(delta: float) -> void:
	if not is_instance_valid(item) or not is_instance_valid(hinge): return
	if is_instance_valid(shutter_hand):
		if shutter_hand.global_position.distance_to(thumb.global_position) > RELEASE_DISTANCE:
			release(shutter_hand)
		else:
			target_angle = clampf(grab_start + wrapf(_hand_angle(shutter_hand) - grab_angle, -PI, PI), 0.0, MAX_OPEN)
	angle = lerpf(angle, target_angle, 1.0 - exp(-22.0 * delta))
	hinge.rotation.y = angle
	var openness := clampf(angle / MAX_OPEN, 0.0, 1.0)
	light.light_energy = 0.12 + 2.0 * openness
	light.omni_range = 2.3 + 2.1 * openness
