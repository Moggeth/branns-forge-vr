extends SceneTree
## Pure panel geometry/input check: --headless --xr-mode off --path godot --script res://world_builder_narrow_panel_checks.gd

const PanelScript = preload("res://world_builder_command_panel.gd")
const Spells = preload("res://world_builder_spells.gd")

var failures: Array[String] = []
var checks := 0
var palette_events: Array[String] = []
var spell_events: Array[String] = []

func _initialize() -> void:
	call_deferred("_run")

func _check(ok: bool, message: String) -> void:
	checks += 1
	if not ok: failures.append(message)

func _run() -> void:
	var panel: Control = PanelScript.new()
	root.add_child(panel)
	panel.set_anchors_and_offsets_preset(Control.PRESET_TOP_LEFT)
	panel.setup(Spells.catalogue())
	panel.palette_selected.connect(func(id: String) -> void: palette_events.append(id))
	panel.spell_selected.connect(func(id: String) -> void: spell_events.append(id))
	for extent in [Vector2(410, 231), Vector2(480, 620), Vector2(700, 620), Vector2(960, 620)]:
		panel.size = extent
		panel.layout_for_size(extent)
		var bounds: Rect2 = panel._panel
		_check(bounds.position.x >= 0.0 and bounds.position.y >= 0.0 and bounds.end.x <= extent.x and bounds.end.y <= extent.y, "panel leaves pane at %s" % extent)
		_check(panel._stacked == (extent.x < 760.0 or extent.y < 360.0), "wrong density at %s" % extent)
		if panel._stacked: _check(panel._tab_fs >= 12, "tabs too small at %s" % extent)
		for tab in panel._tabs:
			_check(bounds.encloses(tab), "tab leaves panel at %s" % extent)
		for card in panel._cards:
			_check(bounds.encloses(card), "card leaves panel at %s" % extent)
			var parts: Dictionary = panel._card_parts(card)
			# Rect2 arithmetic at fractional thirds differs by <0.1 px at 700 px.
			# Test a real overflow, not float32 edge rounding.
			_check(card.grow(0.1).encloses(parts.icon_area) and card.grow(0.1).encloses(parts.label), "card content leaves cell at %s" % extent)
		if panel._stacked:
			_check(panel._info.end.x <= bounds.end.x and panel._info.end.y <= bounds.end.y, "selected info leaves panel at %s" % extent)
			_check(panel._orb_c.x - panel._orb_r - 4.0 >= bounds.position.x and panel._orb_c.y - panel._orb_r - 4.0 >= bounds.position.y, "mana orb leaves panel at %s" % extent)
			for regen in panel._regen:
				_check(panel._info.encloses(regen), "mana preset leaves selected info at %s" % extent)
			for id in panel._by_palette["construction"]:
				var index: int = (panel._by_palette["construction"] as Array).find(id)
				var label: Rect2 = panel._card_parts(panel._cards[index]).label
				var fit: Dictionary = panel._fit("%d %s" % [index + 1, panel._catalogue[id].title], label.size.x - 12.0, 12, 2, 12)
				_check(fit.fs >= 12 and panel._font.get_height(fit.fs) * fit.lines.size() <= label.size.y, "construction label unreadable at %s: %s" % [extent, id])
		_check(not panel._has_point(Vector2(3, 3)), "world above panel is blocked at %s" % extent)
		_check(panel._has_point(panel._cards[0].get_center()), "card misses panel hit region at %s" % extent)
	panel.size = Vector2(410, 231)
	panel.layout_for_size(panel.size)
	var click := InputEventMouseButton.new()
	click.pressed = true
	click.button_index = MOUSE_BUTTON_LEFT
	click.position = panel._tabs[1].get_center()
	panel._gui_input(click)
	_check(palette_events == ["life"], "narrow tab click did not select Life")
	click.position = panel._cards[0].get_center()
	panel._gui_input(click)
	_check(spell_events == ["grove"], "narrow first card click did not select Grove")
	print("WORLD_BUILDER_NARROW_PANEL_RESULT checks=", checks, " failures=", JSON.stringify(failures))
	quit(0 if failures.is_empty() else 1)
