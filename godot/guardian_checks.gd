extends RefCounted

## Checks live scene ownership, a rim yank, rigid-body pickup/release and actions.
static func run(game):
	var failures=[]
	var actors={}
	for enemy in game.scene.enemies:
		var variant=str(enemy.get_meta("guardian_variant",""))
		if variant!="" and not actors.has(variant): actors[variant]=enemy
	for variant in ["mossward","prismwatch","cinderkeep"]:
		if not actors.has(variant): failures.append(variant+" absent from world"); continue
		var record=game.guardians.guardians.get(actors[variant].get_instance_id(),{})
		if record.is_empty(): failures.append(variant+" logic not attached"); continue
		var authored=game.guardian_authored.entries.get(actors[variant].get_instance_id(),{})
		if authored.is_empty(): failures.append(variant+" authored animation not attached")
		else:
			if not authored.visual.visible or not authored.shield.visible: failures.append(variant+" authored art hidden")
			for piece in record.rig.pieces:
				if is_instance_valid(piece) and piece.visible: failures.append(variant+" legacy art overlaps")
		if record.rig.homes.size()!=6 or not is_instance_valid(record.shield): failures.append(variant+" visual/death groups wrong")
		if record.shield.get_parent()!=record.rig.joints.arm_l: failures.append(variant+" shield not on arm")
	if actors.has("mossward"):
		var actor=actors.mossward
		var record=game.guardians.guardians[actor.get_instance_id()]
		var hand=game.desktop_hand
		var prior=hand.global_transform
		hand.global_position=actor.global_position+actor.global_basis.z*2+Vector3.UP
		var blocked=game.guardians.filter_damage(actor,20,hand)
		if blocked>=15 or blocked<=0: failures.append("frontal guard ineffective")
		if not is_equal_approx(game.guardians.filter_damage(actor,190,hand,"headshot"),190): failures.append("skull hit failed to clear raised shield")
		hand.global_position=actor.global_position-actor.global_basis.z*2+Vector3.UP
		if not is_equal_approx(game.guardians.filter_damage(actor,20,hand),20): failures.append("blocked attack from behind")
		hand.global_position=record.shield.global_position
		if not game.guardians.grip(hand): failures.append("living shield rim ungrabbable")
		hand.global_position+=Vector3.RIGHT*0.32
		game.guardians.tick(0.016)
		if record.state!="loose" or not is_instance_valid(record.item): failures.append("rim pull failed to release shield")
		else:
			game.guardian_authored.tick(0.0)
			var authored=game.guardian_authored.entries.get(actor.get_instance_id(),{})
			if not authored.is_empty() and authored.shield.visible: failures.append("authored shield stayed on stolen guardian")
			var item=record.item
			if not item is RigidBody3D or not item.is_in_group("pickup"): failures.append("stolen shield not retrievable")
			if game.guardians.yank(actor,hand)!=null: failures.append("shield duplicated by second yank")
			game.grips._attach(hand,item)
			if not item.freeze or game.held.get(str(hand.get_instance_id()))!=item: failures.append("shield did not freeze in hand")
			if item.global_basis.z.dot(-game.camera.global_basis.z)<0.98: failures.append("desktop shield face does not point forward")
			if item.global_basis.y.dot(game.camera.global_basis.y)<0.98: failures.append("desktop shield is not upright")
			if not (item.transform*game.guardians.SHIELD_HANDLE).is_equal_approx(game.guardians.PALM_GRIP): failures.append("desktop shield handle misses grip")
			var target=Node3D.new(); game.add_child(target)
			target.set_meta("kind","enemy"); target.set_meta("enemy_type","golem")
			target.set_meta("alive",true); target.set_meta("hp",100.0)
			var cfg=game.guardians.VARIANTS.mossward
			var face_point=item.to_global(cfg.box_center+Vector3(0,0,cfg.box.z*0.5))
			var reflected=game.guardians.deflect(face_point,-item.global_basis.z*3.0)
			if reflected.dot(item.global_basis.z)<1.1: failures.append("held shield did not deflect a frontal shot")
			target.global_position=face_point-Vector3.UP
			game.scene.enemies.append(target)
			game.adventure.motion[str(hand.get_instance_id())]={"velocity":item.global_basis.z*3.0}
			game.guardians._tick_bash(0.016)
			if float(target.get_meta("hp",100))>=100: failures.append("shield bash did no damage")
			game.guardians.bash_ready.erase(item.get_instance_id())
			if not game.guardians.desktop_bash(hand,game.camera) or float(game.guardians.bash_ready.get(item.get_instance_id(),0))<=game.elapsed:
				failures.append("desktop shield primary bash missing")
			game.scene.enemies.erase(target); target.queue_free()
			game.guardians.trigger(hand,game.camera)
			if float(item.get_meta("alt_ready",0))<=game.elapsed: failures.append("Rootbeat cooldown missing")
			game.adventure.release(hand,true)
			if item.freeze or not item.get_meta("player_thrown",false): failures.append("shield release lost rigid-body throw")
			game.adventure.motion.erase(str(hand.get_instance_id()))
		hand.global_transform=prior
		# Real authored rig + structural damage, rather than either module alone.
		var wound=actor.to_global(Vector3(0.43,1.12,0))
		var crack=game.skeleton_structure.hit(actor,wound,Vector3.RIGHT,1.0,"blade")
		var visual=game.guardian_authored.entries.get(actor.get_instance_id(),{})
		if not crack.cracked or visual.is_empty() or visual.marks.is_empty(): failures.append("Mossward authored crack missing")
		var sever=game.skeleton_structure.hit(actor,wound,Vector3.RIGHT,4.0,"blade")
		if not sever.detached or not is_instance_valid(sever.item) or visual.part_meshes.arm_r.visible:
			failures.append("Mossward authored arm did not become a physical bone")
	for variant in ["prismwatch","cinderkeep"]:
		if not actors.has(variant): continue
		var enemy=actors[variant]
		var record=game.guardians.guardians[enemy.get_instance_id()]
		var item=game.guardians.yank(enemy,game.desktop_hand)
		if not is_instance_valid(item): failures.append(variant+" yielded no shield"); continue
		var side_name="left_hand" if variant=="prismwatch" else "right_hand"
		var side=1.0 if variant=="prismwatch" else -1.0
		var tracked=XRController3D.new()
		tracked.tracker=side_name
		game.add_child(tracked)
		tracked.global_basis=game.rig.global_basis
		var socket=game.hand_socket(tracked)
		tracked.global_basis=game.rig.global_basis*Basis(Vector3.BACK,side*PI/2)*socket.basis.inverse()
		game.grips._attach(tracked,item)
		if item.basis.z.dot(Vector3.FORWARD)<0.98: failures.append(variant+" VR shield face sideways")
		if item.global_basis.z.dot(-game.rig.global_basis.z)<0.98: failures.append(variant+" VR shield face not ahead of hero")
		if item.global_basis.y.dot(game.rig.global_basis.y)<0.98: failures.append(variant+" VR shield not upright")
		if not (item.transform*game.guardians.SHIELD_HANDLE).is_equal_approx(game.guardians.PALM_GRIP): failures.append(variant+" VR shield handle misses grip")
		var tracked_key=str(tracked.get_instance_id())
		game.held.erase(tracked_key)
		game.grips.grips.erase(tracked_key)
		game.grips._attach(game.desktop_hand,item)
		game.hand_sockets.erase(tracked_key)
		tracked.queue_free()
		var ghost=null
		if variant == "cinderkeep":
			ghost=game.firecraft._ghost(game.adventure.zone,item.global_position+item.global_basis.z*1.7-Vector3.UP*0.6)
			ghost.set_meta("hp",20.0)
			game.adventure.hurt_enemy(ghost,100.0,game.desktop_hand,Vector3.ZERO,"physical")
			if not is_equal_approx(float(ghost.get_meta("hp")),20.0): failures.append("physical strike harmed ghost")
			game.item_actions.pulse(ghost.global_position,2.7,18.0,game.desktop_hand,Color("ff9b48"))
			if not is_equal_approx(float(ghost.get_meta("hp")),2.0): failures.append("starter Forge Pulse did not burn ghost")
		game.guardians.trigger(game.desktop_hand,game.camera)
		if float(item.get_meta("alt_ready",0))<=game.elapsed: failures.append(variant+" alternate action missing")
		if variant == "cinderkeep":
			if ghost.get_meta("alive",true): failures.append("Bellows Bash did not kill ghost with fire")
			game.scene.enemies.erase(ghost)
			game.firecraft.ghosts.erase(ghost)
			ghost.queue_free()
		game.adventure.release(game.desktop_hand,true)
	var other_moss=null
	for enemy in game.scene.enemies:
		if str(enemy.get_meta("guardian_variant",""))=="mossward" and enemy!=actors.get("mossward"):
			other_moss=enemy
			break
	if other_moss!=null:
		var corpse_record=game.guardians.guardians.get(other_moss.get_instance_id(),{})
		if not corpse_record.is_empty():
			other_moss.set_meta("alive",false)
			game.guardians.tick(0.016)
			if corpse_record.state!="loose" or not is_instance_valid(corpse_record.item): failures.append("death did not drop shield")
			var dropped=corpse_record.item
			game.guardians.tick(0.016)
			if corpse_record.item!=dropped: failures.append("death duplicated shield")
			game.remains.shatter(other_moss)
			var authored=game.guardian_authored.entries.get(other_moss.get_instance_id(),{})
			if not authored.is_empty() and (authored.visual.visible or not authored.shattered): failures.append("authored art did not yield to physical remains")
			game.animation.restore(other_moss)
			if not authored.is_empty() and (not authored.visual.visible or authored.shattered): failures.append("authored art did not return on respawn")
	print("GUARDIAN_RESULT ",JSON.stringify(failures))
	game.get_tree().quit(0 if failures.is_empty() else 1)
