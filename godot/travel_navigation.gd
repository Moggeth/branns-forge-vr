extends Node
## One destination selection, displayed in each perspective; no separate world state.
const MapPanel = preload("res://travel_map_panel.gd")
const Guide = preload("res://resource_guide.gd")
const REGIONS := {
	"forge_yard": ["Brann, the Living Workshop, your collection and common goods.", "Hero pouch and donation buckets; settlement stock stays separate."],
	"orchard_highlands": ["One shared, editable landscape. Explore the hills, stream and magical landforms.", "Fallen logs: timber. Mine Starfall veins: star gems and star iron for world-building."],
	"sandstone_quarry": ["Mine the stone faces with Stonewhisper.", "Stone and iron for the Hero's workshop."],
	"pinewood_ruins": ["Gather timber, fight skeletons and collect their physical bones.", "Lumber and haunted bones; skulls belong in the quest basket."],
	"enchanted_kitchen": ["Explore the kitchen and gather supplies.", "Rat tails for workshop progression."],
	"mushroom_glade": ["Explore the glowing woodland with Mooncap Lantern.", "Spores for workshop progression."],
	"crystal_hollow": ["Experiment with Hollow's Song in the crystal chambers.", "Hero crystals are separate from the settlement's star gems."],
	"sky_garden": ["Explore the elevated garden and practise traversal.", "Sky blooms for workshop progression."],
	"ember_foundry": ["Explore the foundry and face its guardians.", "Ember cores for workshop progression."],
	"glowroot_grotto": ["Little Wing's glow wakes sleeping mushroom caps.", "Light and companionship; no travel cost."],
	"starlace_archive": ["Reveal the three hidden seals with Little Wing.", "Exploration and light puzzles."],
	"moonwater_causeway": ["Illuminate stepping stones to guide your companion.", "Fairy light reveals safe crossings."],
	"ember_creek": ["Pour, ignite and quench fuel. Carry a flame beyond the gate.", "Firecraft experiment; travel preserves puzzle progress."],
	"ember_gallery": ["Carry a match, strike it and experiment with spreading fire.", "Common goods and reusable firecraft experiments."],
}
var game
var selected := ""
var views := {}
var next_refresh := 0.0
var pulse_until := 0.0
var last_mouse_mode := Input.MOUSE_MODE_VISIBLE

func setup(owner_game) -> void:
	game = owner_game
	selected = game.adventure.zone

func destinations() -> Array:
	var result: Array = []
	for id in game.scene.zones:
		var data: Dictionary = game.scene.zones[id]
		var notes: Array = REGIONS.get(id, ["Explore, gather and try your inventions. Existing progress stays intact.", "Open Supplies for equipment, resources and their uses."])
		result.append({"id": str(id), "name": str(data.get("name", str(id).capitalize())),
			"description": notes[0], "resources": notes[1], "available": true, "reason": ""})
	return result

func model() -> Dictionary:
	var result: Dictionary = Guide.build(game)
	result.merge({"current": game.adventure.zone, "selected": selected, "destinations": destinations(),
		"notice": "Travel is free and moves both companions. Choose a destination, then G."}, true)
	if game.adventure.travelling: result.notice = "Finding a clear landing on the current terrain…"
	return result

func select_destination(id: String) -> void:
	if not game.scene.zones.has(id): return
	selected = id
	var index: int = game.adventure.ZONES.find(id)
	if index >= 0: game.adventure.destination_index = index
	pulse_until = game.elapsed + 1.1
	_refresh()
	game._notice("Travel target: " + destination_name() + " · G travel · M map", 4)

func destination_name() -> String:
	return str(game.scene.zones.get(selected, {}).get("name", selected.replace("_", " ").capitalize()))

func cycle(direction: int = 1) -> void:
	var ids: Array = game.scene.zones.keys()
	if not ids.is_empty(): select_destination(str(ids[posmod(ids.find(selected) + direction, ids.size())]))

func travel_selected() -> void:
	if game.adventure.travelling: return
	if not game.scene.zones.has(selected): return
	var id := selected
	close_all()
	if id == "ember_creek": game.ember_creek.visit()
	elif id == "ember_gallery": game.ember_gallery.act("visit")
	else: game.adventure.travel(id)

func on_travel(id: String) -> void:
	selected = id
	_refresh()

func is_open_for(target: Node) -> bool:
	return target != null and views.has(target.get_instance_id()) and bool(views[target.get_instance_id()].opened)

func any_open() -> bool:
	for view in views.values():
		if bool(view.opened): return true
	return false

func hero_modal_open() -> bool:
	# The fairy and strategic player own independent views of this same world.
	# Their folios must not cancel the VR player's draw or freeze Hero controls.
	if is_open_for(game) or is_open_for(game.get_window()): return true
	return is_instance_valid(game.world_builder_view) and game.world_builder_view.hero_primary and is_open_for(game.world_builder_view)

func _forget_view(key:int) -> void:
	views.erase(key)

func show_for(target: Node, page: String = "map", fairy_owner = null) -> void:
	close_all(false)
	var key := target.get_instance_id()
	if not views.has(key):
		var layer := CanvasLayer.new()
		layer.layer = 82
		target.add_child(layer)
		var panel := MapPanel.new()
		layer.add_child(panel)
		panel.destination_selected.connect(select_destination)
		panel.travel_requested.connect(func(id: String): select_destination(id); travel_selected())
		panel.closed.connect(close_all)
		panel.reset_requested.connect(func(): game.world_reset.request(target))
		views[key] = {"layer": layer, "panel": panel, "opened": false, "fairy": fairy_owner}
		target.tree_exiting.connect(_forget_view.bind(key),CONNECT_ONE_SHOT)
	var view: Dictionary = views[key]
	last_mouse_mode = Input.mouse_mode
	view.opened = true
	view.fairy = fairy_owner
	view.layer.show()
	view.panel.set_page(page)
	view.panel.set_model(model())
	if fairy_owner != null: fairy_owner._focus_lost(); fairy_owner.focused = true
	elif hero_modal_open() and game.desktop_look != null: game.desktop_look.release_capture()
	if hero_modal_open():
		if game.archery != null: game.archery.cancel_draw()
		game.desktop_swing_started = -1.0
		game.desktop_swing_item = null
		if game.melee != null: game.melee.clear_desktop_contact()
	Input.mouse_mode = Input.MOUSE_MODE_VISIBLE

func close_all(restore: bool = true) -> void:
	var fairy_owner = null
	var was_open := any_open()
	for view in views.values():
		if view.opened and view.fairy != null: fairy_owner = view.fairy
		view.opened = false
		view.layer.hide()
	if not was_open or not restore: return
	if fairy_owner != null:
		fairy_owner.keys.clear(); fairy_owner.pad_buttons.clear()
		fairy_owner.buttons = {"dart": true, "ping": true}
		fairy_owner._capture_mouse()
	elif last_mouse_mode == Input.MOUSE_MODE_CAPTURED and game.desktop_look != null:
		game.desktop_look.set_enabled(true)
		game.desktop_look.capture()

func input_event(event: InputEvent, target: Node, fairy_owner = null) -> bool:
	if event is InputEventKey and event.pressed and not event.echo:
		if event.physical_keycode in [KEY_M, KEY_I]:
			if is_open_for(target): close_all()
			else: show_for(target, "supplies" if event.physical_keycode == KEY_I else "map", fairy_owner)
			return true
	if not is_open_for(target): return false
	if event is InputEventKey and event.pressed and not event.echo:
		match event.physical_keycode:
			KEY_ESCAPE: close_all()
			KEY_F, KEY_DOWN: cycle()
			KEY_UP: cycle(-1)
			KEY_G: travel_selected()
	if event is InputEventJoypadButton and event.pressed:
		match event.button_index:
			JOY_BUTTON_B: close_all()
			JOY_BUTTON_DPAD_DOWN: cycle()
			JOY_BUTTON_DPAD_UP: cycle(-1)
			JOY_BUTTON_A: travel_selected()
	# Called by each window's input dispatcher. Native controls still receive GUI
	# clicks, while the world behind the folio receives none of them.
	return true

func _refresh() -> void:
	if not any_open(): return
	var snapshot := model()
	for view in views.values():
		if bool(view.opened): view.panel.set_model(snapshot)

func tick() -> void:
	if game.elapsed < next_refresh: return
	next_refresh = game.elapsed + 0.2
	_refresh()
	if game.travel_target != null:
		game.travel_target.text = "TRAVEL → " + destination_name() + "  ·  F next · G go · M map · I supplies"
		game.travel_target.modulate = Color("8de4d7") if game.elapsed < pulse_until else Color("d5e2d6")
