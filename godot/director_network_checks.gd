extends SceneTree
func _initialize(): run.call_deferred()
func run():
	var game = load("res://main.tscn").instantiate()
	root.add_child(game)
	game.set_process(false)
	var director = game.director
	for i in range(150):
		await create_timer(.1).timeout
		game.elapsed += .1
		director.tick(.1)
		if director.summons.size() >= 2 and director.gloom_until > game.elapsed:
			print("DIRECTOR_NETWORK_RESULT ",JSON.stringify({"session":director.session_id,"phase":director.phase,"summons":director.summons.size(),"gloom":true,"ack":director.last_ack}))
			quit(0)
			return
	print("DIRECTOR_NETWORK_RESULT ",JSON.stringify({"error":"timed out","session":director.session_id,"phase":director.phase,"summons":director.summons.size(),"ack":director.last_ack}))
	quit(1)
