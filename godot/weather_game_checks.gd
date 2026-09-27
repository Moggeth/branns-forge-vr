extends Node
var failures=[]
func check(ok,message):
	if not ok: failures.append(message)
func settle(game):
	for i in range(1000):
		await get_tree().process_frame
		if not game.weather.rebuilding: return
	failures.append("Surface scan timeout")
func run(game):
	game.set_process(false); game.smoke=true
	await settle(game)
	check(game.weather.zone=="forge_yard","Forge weather ready")
	game.weather.action("snow")
	for i in range(30): game.weather.tick(.1)
	check(game.weather.engine.snow[0]>0,"Native snow accumulation")
	var saved_snow=game.weather.engine.snow[0]
	game.weather.refresh()
	check(game.weather.rebuilding,"Surface scan yields for interruption test")
	game.weather.remember_zone()
	check(is_equal_approx(game.weather.zone_states.forge_yard.snow,saved_snow),"Scan scratch arrays cannot overwrite saved snow")
	game.weather.action("enabled")
	await settle(game)
	check(not game.weather.engine.visible,"Disabling during scan cannot reactivate weather")
	game.weather.action("enabled")
	await settle(game)
	check(is_equal_approx(game.weather.engine.snow[0],saved_snow),"Snow restored after interrupted scan")
	game.qol.page="weather"; game.qol._build()
	check(game.weather.rows().size()==9,"Palm controls available")
	game.weather.refresh()
	game.adventure.travel("crystal_hollow")
	await settle(game)
	await get_tree().process_frame
	await settle(game)
	check(game.weather.zone=="crystal_hollow","Travel during scan selects current zone")
	check(not game.weather.engine.visible,"Cave precipitation disabled")
	game.adventure.travel("pinewood_ruins")
	await game.weather.refresh()
	check(game.weather.engine.visible,"Outdoor precipitation restored")
	check(game.weather.engine.ORIGIN.distance_to(Vector2(-12,-12))>20,"Grid follows destination")
	game.weather.action("enabled")
	await settle(game)
	check(not game.weather.engine.visible,"Weather off")
	print("WEATHER_GAME_CHECK_RESULT ",JSON.stringify(failures))
	get_tree().quit(0 if failures.is_empty() else 1)
