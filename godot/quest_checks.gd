extends Node
var failures=[]
func check(ok,message):
	if not ok: failures.append(message)
func run(game):
	if game.service=="http://127.0.0.1:8787":
		print("QUEST_CHECK_RESULT [\"Refusing live service; use scripts/check-quests.cjs for an isolated fixture\"]")
		get_tree().quit(2)
		return
	game.set_process(false); game.smoke=true; game.diagnostic_offline=false
	game.quests.test_events=true
	game.visiting=true; game.adventure.zone="forge_yard"
	game.camera.global_position=game.scene.brann.global_position+Vector3(0,1.6,1.5)
	await game._poll()
	if int(game.quests.data.get("xp",-1))!=0:
		print("QUEST_CHECK_RESULT [\"Requires an isolated fresh service with 0 XP; refusing to alter existing progression\"]")
		get_tree().quit(2)
		return
	check(game.quests.data.get("level")==1,"Initial level")
	game.quests.index=2 # Skull basket is the first job; the skeleton hunt follows rats.
	await game.quests.act("primary")
	check(game.quests.selected().get("status")=="active","Native accept action")
	var count=0
	for enemy in game.scene.enemies:
		if enemy.get_meta("enemy_type","")=="skeleton" and count<3:
			game.adventure.hurt_enemy(enemy,999)
			game.adventure.hurt_enemy(enemy,999)
			count+=1
	# World currently has two skeletons; simulate the normal 45-second respawn for a third life.
	for enemy in game.scene.enemies:
		if count<3 and enemy.get_meta("enemy_type","")=="skeleton":
			enemy.set_meta("alive",true); enemy.set_meta("hp",66); enemy.set_meta("quest_death_recorded",false)
			game.animation.restore(enemy)
			game.adventure.hurt_enemy(enemy,999); count+=1
	check(count==3,"Three skeleton lives")
	check(game.quests.outbox.size()==3,"One event per actual enemy death")
	var original_service=game.service
	game.service="http://127.0.0.1:1"
	await game.quests._flush()
	check(game.quests.outbox.size()==3,"Disconnected hunt progress retained")
	game.service=original_service
	while not game.quests.outbox.is_empty(): await game.quests._flush()
	check(game.quests.data.get("xp")==36,"Skeleton kill XP")
	check(game.quests.selected().get("status")=="ready","Hunt ready")
	await game.quests.act("primary")
	check(game.quests.data.get("xp")==91,"Claim awards once")
	check(game.quests.selected().get("status")=="available","Repeatable hunt")
	var gathered=await game._request("/api/vr/gather",{"id":"quest-native-stone","resource":"stone","amount":3})
	game.quests.ingest(gathered.get("rpg",{}))
	check(game.quests.data.get("level")==2,"Level two at 100 XP")
	check(game.quests.data.get("xp")==100,"Gather XP")
	game.qol.page="journal"; game.qol._build()
	check(game.quests.journal().contains("Level 2"),"Journal level")
	check(game.quests.rows()[2][0]=="Accept job","Journal action changes after reward")
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--quest-capture="):
			game.camera.global_position+=Vector3(0,0,3)
			game.qol.menu.visible=true
			game.qol.menu.global_transform=game.camera.global_transform*Transform3D(Basis.IDENTITY,Vector3(0,0,-1.25))
			game.qol.detail.text=game.quests.journal()
			for frame in range(8): await get_tree().process_frame
			await RenderingServer.frame_post_draw
			var output=arg.trim_prefix("--quest-capture=")
			check(get_viewport().get_texture().get_image().save_png(output)==OK,"Journal capture")
	print("QUEST_CHECK_RESULT ",JSON.stringify(failures))
	get_tree().quit(0 if failures.is_empty() else 1)
