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
	var full := Feedback.new()
	game.add_child(full)
	full.setup(game)
	var art_stats: Dictionary = full.art.stats()
	if art_stats.bad_windings != 0: failures.append("authored debris has reversed winding")
	if full.pools.size() > 24 or full.pools.size() < 12: failures.append("authored material pool count outside budget")
	for material in Feedback.MATERIALS:
		game.elapsed += 0.1
		hit.material = material
		if not full.emit_contact(hit): failures.append("material contact discarded: " + material)
		var count := 0
		for pool in full.pools.values():
			if pool.material == material: count += pool.particles.size()
		if count == 0: failures.append("missing authored response: " + material)
	var before_marks: int = full.marks.size()
	target.position.x += 2.0
	full.tick(0.016)
	if full.marks.is_empty() or full.marks[0].node.global_position.x < 1.0:
		failures.append("persistent contact scar did not follow target")
	# A bone/wood tool must not create metal sparks on a metal or stone target.
	for pool in full.pools.values(): pool.particles.clear()
	hit.tool = "skeleton_bone"
	hit.material = "stone"
	game.elapsed += 0.1
	full.emit_contact(hit)
	for pool in full.pools.values():
		if pool.spec.kind == "spark" and not pool.particles.is_empty(): failures.append("non-metal tool created strike sparks")
	hit.tool = "quarry_pick"
	game.elapsed += 0.1
	full.emit_contact(hit)
	var sparks := 0
	for pool in full.pools.values():
		if pool.spec.kind == "spark":
			sparks += pool.particles.size()
			for particle in pool.particles:
				if particle.basis.x.dot(particle.velocity.normalized()) < 0.99: failures.append("spark ribbon does not follow travel")
	if sparks == 0: failures.append("metal point on stone has no sparks")
	var peak := 0
	var usec := 0
	for frame in 100:
		game.elapsed += 0.08
		hit.material = Feedback.MATERIALS[frame % Feedback.MATERIALS.size()]
		hit.point = Vector3(frame % 8, 1, 0)
		full.emit_contact(hit)
		full.tick(0.0083)
		peak = maxi(peak, int(full.stats.active))
		usec = maxi(usec, int(full.stats.update_usec))
		for pool in full.pools.values():
			if pool.particles.size() > Feedback.CAPACITY: failures.append("debris pool exceeded capacity")
		if full.marks.size() > Feedback.MAX_MARKS: failures.append("scar ledger exceeded capacity")
	game.elapsed += 30.0
	full.tick(3.0)
	if full.stats.active != 0 or not full.marks.is_empty(): failures.append("material debris/scars did not expire")
	print("IMPACT_FEEDBACK_BUDGET ", {"peak_particles":peak,"worst_update_usec":usec,"pools":full.pools.size(),"source_triangles":art_stats.triangles,"marks_before_load":before_marks})
	print("IMPACT_FEEDBACK_CONTRACT_RESULT ",failures)
	quit(0 if failures.is_empty() else 1)
