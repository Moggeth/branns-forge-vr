extends SceneTree

const Meteor = preload("res://landscape_meteor.gd")
const Ops = preload("res://landscape_operations.gd")

func _initialize() -> void:
	call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var source: Dictionary = Meteor.make_record(Vector2(10.0, -12.0), 421, 3.0)
	var roundtrip: Dictionary = JSON.parse_string(JSON.stringify(source))
	if int(roundtrip.ore) != int(source.ore) or roundtrip.veins.size() != source.veins.size(): failures.append("record JSON roundtrip")
	var op: Dictionary = Meteor.crater_operation(source)
	if not Ops.validate(op): failures.append("crater operation rejected")
	var event: Dictionary = Meteor.impact_event(source)
	if Meteor.damage_at(event, Vector3(10, 3, -12)) != 35.0: failures.append("impact center damage")
	if Meteor.damage_at(event, Vector3(19, 3, -12)) != 0.0: failures.append("impact escaped radius")
	if Meteor.damage_at(event, Vector3(10, 11, -12)) != 0.0: failures.append("impact crossed vertical limit")
	var meteor := Meteor.new()
	root.add_child(meteor)
	var impacts := [0]
	meteor.impact_ready.connect(func(_value): impacts[0] += 1)
	meteor.setup(source, true)
	if meteor.impacted or not meteor.strike(meteor.global_position, "quarry_pick").reason == "falling": failures.append("fall gate")
	meteor.advance(1.5)
	meteor.advance(1.5)
	if impacts[0] != 1 or not meteor.impacted: failures.append("impact emitted more or less than once: " + str(impacts[0]))
	var near: Vector3 = meteor.gems[0].global_position
	if meteor.strike(near, "woodland_axe").get("ok", false): failures.append("wrong tool mined")
	if meteor.strike(near, "quarry_pick", 0.2).get("ok", false): failures.append("weak strike mined")
	var mined := meteor.strike(near, "quarry_pick", 1.0)
	if mined.get("kind", "") != "meteor_gem" or meteor.remaining_gems() != 11: failures.append("gem extraction")
	var saved: Dictionary = JSON.parse_string(JSON.stringify(meteor.to_record()))
	meteor.queue_free()
	var restored := Meteor.new()
	root.add_child(restored)
	restored.setup(saved, false)
	if restored.remaining_gems() != 11 or not restored.impacted: failures.append("mined state restore")
	for gem in restored.gems:
		for i in 2: restored.strike(gem.global_position, "quarry_pick", 1.0)
	if restored.remaining_gems() != 0 or restored.gems[0].visible: failures.append("finite veins")
	var rock_top := restored.global_position + Vector3.UP * 2.55
	for i in 8: restored.strike(rock_top, "quarry_pick", 0.5)
	if restored.remaining_ore() != 0 or restored.strike(rock_top, "quarry_pick").get("reason", "") != "depleted": failures.append("finite ore")
	print("LANDSCAPE_METEOR_RESULT ", failures)
	quit(0 if failures.is_empty() else 1)
