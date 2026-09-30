extends SceneTree
## Audio-only fallback and bounded duplicate handling without loading Main.

const Feedback = preload("res://impact_feedback.gd")

class FakeGame extends Node3D:
	var elapsed := 10.0
	var diagnostic_offline := true
	var tuning = null

func _initialize() -> void: call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var game := FakeGame.new()
	root.add_child(game)
	var feedback := Feedback.new()
	game.add_child(feedback)
	feedback.setup(game)
	# The fallback must work before authored particle profiles are installed.
	feedback.art = null
	feedback.pools.clear()
	var target := Node3D.new()
	target.set_meta("kind","enemy")
	target.set_meta("enemy_type","skeleton")
	game.add_child(target)
	if Feedback.classify(target) != "bone": failures.append("bone material classification")
	var hit := {"target":target,"point":Vector3(0,1,0),"normal":Vector3.RIGHT,
		"material":"bone","tool":"woodland_axe","strike_region":"working",
		"relative_velocity":Vector3.LEFT*3.0,"energy":5.0}
	if not feedback.emit_contact(hit) or feedback.emitted != 1:
		failures.append("poolless contact was discarded")
	if feedback.sounds.get("bone",[]).is_empty() or feedback.voices.size() != 8:
		failures.append("poolless spatial audio was not provisioned")
	if feedback.emit_contact(hit): failures.append("same-frame duplicate was not suppressed")
	game.elapsed += 0.08
	if not feedback.emit_contact(hit) or feedback.emitted != 2:
		failures.append("next deliberate contact was throttled")
	feedback.tick(0.016)
	if feedback.stats.active != 0 or feedback.stats.draw_calls != 0:
		failures.append("poolless contact allocated visible debris")
	print("IMPACT_FEEDBACK_CONTRACT_RESULT ",failures)
	quit(0 if failures.is_empty() else 1)
