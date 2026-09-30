extends SceneTree
## Run with --script res://supplies_toolbelt_checks.gd -- --world-builder-check.
## Real Main/QOL/Guide scene; diagnostic_offline prevents live service and saves.
const Guide = preload("res://resource_guide.gd")
var failures: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func check(ok: bool, message: String) -> void:
	if not ok: failures.append(message)

func _run() -> void:
	var game: Node3D = load("res://main.tscn").instantiate()
	root.add_child(game)
	await physics_frame
	game.set_process(false)
	check(game.diagnostic_offline and game.adventure.zone == "orchard_highlands", "fixture is not offline Orchard Main")
	var qol: Node = game.qol
	check(qol.page == "quick" and not qol.opened, "toolbelt default is not closed Quick")
	var tab := InputEventKey.new()
	tab.pressed = true
	tab.physical_keycode = KEY_TAB
	check(qol.keyboard(tab) and qol.opened and qol.page == "quick", "Tab did not open Quick")
	check(qol.allows_menu_button("left_hand") and not qol.allows_menu_button("right_hand"), "left B hand-menu binding changed")
	check(_has_action(qol, "qol:page:supplies") and _has_action(qol, "qol:page:quick"), "Quick lost useful page links")
	var hero_before := JSON.stringify(game.state)
	var settlement_before := JSON.stringify(game.world_builder.data)
	var guide: Dictionary = Guide.build(game)
	check(guide.wallets.size() >= 4 and not guide.items.is_empty() and not guide.costs.is_empty(), "Guide omitted ledger, equipment or actions")
	var hero_wallet: Dictionary = guide.wallets[0]
	var orchard_wallet: Dictionary = guide.wallets[1]
	check(str(hero_wallet.title).contains("Hero pouch") and str(orchard_wallet.title).contains("Orchard settlement"), "Hero and settlement ledgers merged")
	check(_row(orchard_wallet.rows, "Stockpile lumber").amount == str(game.world_builder.data.wood), "settlement timber did not use stockpile")
	check(_row(hero_wallet.rows, "Lumber").amount == "—" or _row(hero_wallet.rows, "Lumber").amount == str(game.state.get("resources", {}).get("lumber", 0)), "Hero lumber came from settlement")
	check(_row(orchard_wallet.rows, "Mana").purpose.contains("spells") and _row(hero_wallet.rows, "Lumber").purpose.contains("Separate"), "ledger descriptions conceal separation")
	qol.action("page:supplies")
	check(qol.page == "supplies" and qol.opened, "Supplies page did not open")
	var pages: Array = qol._supplies_pages()
	var expected := 0
	for wallet in guide.wallets: expected += wallet.rows.size()
	expected += guide.items.size() + guide.costs.size()
	var visited := 0
	for page_index in pages.size():
		check(qol.supplies_index == page_index, "next ledger skipped a page")
		var page: Dictionary = pages[page_index]
		check(not page.rows.is_empty() and page.rows.size() <= 8, "Supplies page exceeds eight rows or is empty")
		check(_selection_count(qol) == page.rows.size(), "selection colliders do not match visible rows")
		check(_has_action(qol, "qol:supply:next") and _has_action(qol, "qol:supply:previous"), "ledger pagination controls missing")
		for row_index in page.rows.size():
			var entry: Dictionary = page.rows[row_index]
			qol.action("supply:select:" + str(row_index))
			check(qol.supplies_selected == row_index, "row selection missed exact index")
			check(qol.detail.text.contains(str(entry.name)), "detail omitted selected name")
			if entry.has("cost"):
				check(qol.detail.text.contains("Cost: " + str(entry.cost)) and qol.detail.text.contains(str(entry.state)), "detail omitted exact cost or restriction")
			elif entry.has("amount"):
				check(qol.detail.text.contains(str(entry.amount)), "detail omitted amount")
			else: check(qol.detail.text.contains(str(entry.get("state", ""))), "detail omitted equipment state")
			var explanation := str(entry.get("purpose", entry.get("description", "")))
			check(not explanation.is_empty(), "Guide has no use description: " + str(entry.name))
			if not explanation.is_empty(): check(qol.detail.text.contains(explanation), "detail omitted use or description: " + str(entry.name))
			visited += 1
		await process_frame
		_check_bounds(qol, page_index)
		if page_index + 1 < pages.size(): qol.action("supply:next")
	check(visited == expected, "Supplies omitted or duplicated Guide rows")
	qol.action("supply:next")
	check(qol.supplies_index == 0, "next ledger did not wrap")
	qol.action("supply:previous")
	check(qol.supplies_index == pages.size() - 1, "previous ledger did not wrap")
	# A periodic sample may rewrite text, but must preserve physical hit targets.
	var wood_page := -1
	var wood_row := -1
	for page_index in pages.size():
		for row_index in pages[page_index].rows.size():
			if str(pages[page_index].rows[row_index].name) == "Stockpile lumber":
				wood_page = page_index
				wood_row = row_index
	check(wood_page >= 0, "settlement stockpile row absent")
	if wood_page >= 0:
		while qol.supplies_index != wood_page: qol.action("supply:next")
		qol.action("supply:select:" + str(wood_row))
	var collider: Node3D = _selection_button(qol, wood_row)
	var collider_id := collider.get_instance_id() if collider != null else 0
	var shape_id := collider.get_child(0).get_instance_id() if collider != null else 0
	var original_wood: int = int(game.world_builder.data.wood)
	game.world_builder.data.wood = original_wood + 3
	game.elapsed += 1.0
	qol._supplies_detail()
	var refreshed: Node3D = _selection_button(qol, wood_row)
	check(refreshed != null and refreshed.get_instance_id() == collider_id and refreshed.get_child(0).get_instance_id() == shape_id, "live label refresh replaced pointer collider")
	check(qol.detail.text.contains(str(original_wood + 3)) and _button_label(refreshed).contains(str(original_wood + 3)), "live stockpile label did not refresh")
	game.world_builder.data.wood = original_wood
	game.elapsed += 1.0
	qol._supplies_detail()
	check(JSON.stringify(game.state) == hero_before and JSON.stringify(game.world_builder.data) == settlement_before, "Guide or menu action changed a ledger")
	qol.action("page:quick")
	check(qol.page == "quick" and _has_action(qol, "qol:page:supplies"), "Quick tab cannot be recovered")
	qol.keyboard(tab)
	check(not qol.opened, "Tab did not close toolbelt")
	print("SUPPLIES_TOOLBELT_RESULT ", JSON.stringify({"failures": failures, "pages": pages.size(), "rows": visited}))
	quit(0 if failures.is_empty() else 1)

func _row(rows: Array, name: String) -> Dictionary:
	for entry in rows:
		if str(entry.name) == name: return entry
	return {}

func _has_action(qol: Node, action: String) -> bool:
	for button in qol.buttons:
		if str(button.get_meta("action", "")) == action: return true
	return false

func _selection_count(qol: Node) -> int:
	var count := 0
	for button in qol.buttons:
		if str(button.get_meta("action", "")).begins_with("qol:supply:select:"): count += 1
	return count

func _selection_button(qol: Node, index: int) -> Node3D:
	for button in qol.buttons:
		if str(button.get_meta("action", "")) == "qol:supply:select:" + str(index): return button
	return null

func _button_label(button: Node3D) -> String:
	if button == null: return ""
	for child in button.get_children():
		if child is Label3D: return str(child.text)
	return ""

func _check_bounds(qol: Node, page_index: int) -> void:
	# Label3D reports its rendered text box in menu-local metres.
	if not qol.detail.has_method("get_aabb"): return
	var box: Variant = qol.detail.call("get_aabb")
	if not box is AABB: return
	var aabb: AABB = box
	var text_rect := Rect2(Vector2(aabb.position.x + qol.detail.position.x, aabb.position.y + qol.detail.position.y), Vector2(aabb.size.x, aabb.size.y))
	for button in qol.buttons:
		var action := str(button.get_meta("action", ""))
		if not action.begins_with("qol:supply:"): continue
		var hit: CollisionShape3D = button.get_node_or_null("CollisionShape3D")
		if hit == null or not hit.shape is BoxShape3D: continue
		var size: Vector3 = (hit.shape as BoxShape3D).size
		var rect := Rect2(Vector2(button.position.x - size.x * 0.5, button.position.y - size.y * 0.5), Vector2(size.x, size.y))
		check(not text_rect.intersects(rect), "Supplies detail overlaps button on ledger %d" % page_index)
