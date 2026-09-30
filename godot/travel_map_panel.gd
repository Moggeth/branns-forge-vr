extends Control
## Travel folio overlay: Map (destination picker) and Supplies (read-only ledger).
## Read-only except for the three signals. Host wires input (M/F/G/Esc) and game behaviour.

signal destination_selected(zone_id: String)
signal travel_requested(zone_id: String)
signal closed
signal reset_requested

const C_DIM := Color(0.04, 0.035, 0.03, 0.72)
const C_PANEL := Color("1d1a17")
const C_TIMBER := Color("2b231c")
const C_TIMBER_HI := Color("3a2f25")
const C_BRASS := Color("b08d57")
const C_BRASS_DIM := Color("6e5a3a")
const C_CREAM := Color("efe6d2")
const C_MUTED := Color("b3a78f")
const C_TEAL := Color("3fa39a")
const C_TEAL_BG := Color("1f3a37")
const C_WARN := Color("d08a5c")

var _model: Dictionary = {}
var _page := "map"
var _selected := ""
var _s := 1.0
var _scaled: Array = []  # [{n, font, min}]
var _dest_ids: Array = []
var _dest_rows: Dictionary = {}  # id -> {btn, name, sub}
var _supplies_sig := ""

var _panel: PanelContainer
var _tab_map: Button
var _tab_sup: Button
var _notice: Label
var _map_page: HBoxContainer
var _dest_list: VBoxContainer
var _dest_empty: Label
var _d_name: Label
var _d_status: Label
var _d_desc: Label
var _d_res: Label
var _d_reason: Label
var _d_current: Label
var _travel_btn: Button
var _sup_scroll: ScrollContainer
var _sup_box: VBoxContainer


func _ready() -> void:
	set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP
	_build()
	resized.connect(_layout)
	_layout()
	set_page(_page)
	set_model(_model)


# ---------------------------------------------------------------- public API

func set_model(model: Dictionary) -> void:
	_model = model
	if not is_node_ready():
		return
	var sel := str(model.get("selected", ""))
	if sel != "":
		_selected = sel
	_sync_destinations()
	_sync_supplies()
	_layout.call_deferred()
	var n := str(model.get("notice", ""))
	_notice.text = n
	_notice.visible = n != ""


func set_page(page_id: String) -> void:
	_page = "supplies" if page_id == "supplies" else "map"
	if not is_node_ready():
		return
	_map_page.visible = _page == "map"
	_sup_scroll.visible = _page == "supplies"
	_tab_map.set_pressed_no_signal(_page == "map")
	_tab_sup.set_pressed_no_signal(_page == "supplies")


## Optional helpers for host input wiring (F / G).
func select_next() -> void:
	if _dest_ids.is_empty():
		return
	var i := _dest_ids.find(_selected)
	_select(str(_dest_ids[(i + 1) % _dest_ids.size()]))


func request_travel() -> void:
	if _can_travel():
		travel_requested.emit(_selected)


# ---------------------------------------------------------------- build (once)

func _build() -> void:
	var dim := ColorRect.new()
	dim.color = C_DIM
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	add_child(dim)

	_panel = PanelContainer.new()
	_panel.add_theme_stylebox_override("panel", _box(C_PANEL, C_BRASS, 2, 10, 18))
	add_child(_panel)
	var root := VBoxContainer.new()
	root.add_theme_constant_override("separation", 10)
	_panel.add_child(root)

	# Header: title, tabs, close
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 10)
	root.add_child(head)
	var title := _label("Travel Folio", 26, C_BRASS)
	head.add_child(title)
	var gap := Control.new()
	gap.custom_minimum_size.x = 16
	head.add_child(gap)
	var group := ButtonGroup.new()
	_tab_map = _button("Map  [M]", 128)
	_tab_sup = _button("Supplies", 128)
	for t in [_tab_map, _tab_sup]:
		t.toggle_mode = true
		t.button_group = group
		t.add_theme_stylebox_override("pressed", _box(C_TEAL_BG, C_TEAL, 2, 6, 8))
		head.add_child(t)
	_tab_map.pressed.connect(func(): set_page("map"))
	_tab_sup.pressed.connect(func(): set_page("supplies"))
	var fill := Control.new()
	fill.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	head.add_child(fill)
	var close := _button("Close  [Esc]", 128)
	close.pressed.connect(func(): closed.emit())
	head.add_child(close)

	root.add_child(_rule())
	_notice = _label("", 15, C_WARN, true)
	_notice.visible = false
	root.add_child(_notice)

	# Map page: destination list | selected detail
	_map_page = HBoxContainer.new()
	_map_page.size_flags_vertical = Control.SIZE_EXPAND_FILL
	_map_page.add_theme_constant_override("separation", 14)
	root.add_child(_map_page)
	var list_scroll := _scroll()
	list_scroll.size_flags_stretch_ratio = 1.1
	_map_page.add_child(list_scroll)
	_dest_list = VBoxContainer.new()
	_dest_list.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_dest_list.add_theme_constant_override("separation", 6)
	list_scroll.add_child(_dest_list)
	_dest_empty = _label("No destinations are charted yet.", 16, C_MUTED, true)
	_dest_list.add_child(_dest_empty)

	var detail := PanelContainer.new()
	detail.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	detail.add_theme_stylebox_override("panel", _box(C_TIMBER, C_BRASS_DIM, 1, 8, 14))
	_map_page.add_child(detail)
	var dv := VBoxContainer.new()
	dv.add_theme_constant_override("separation", 8)
	detail.add_child(dv)
	dv.add_child(_label("SELECTED DESTINATION", 13, C_BRASS))
	var dscroll := _scroll()
	dscroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	dv.add_child(dscroll)
	var dinner := VBoxContainer.new()
	dinner.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	dinner.add_theme_constant_override("separation", 8)
	dscroll.add_child(dinner)
	_d_name = _label("", 24, C_CREAM, true)
	_d_status = _label("", 15, C_TEAL, true)
	_d_desc = _label("", 16, C_CREAM, true)
	_d_res = _label("", 15, C_MUTED, true)
	_d_reason = _label("", 15, C_WARN, true)
	for l in [_d_name, _d_status, _d_desc, _d_res, _d_reason]:
		dinner.add_child(l)
	_d_current = _label("", 14, C_MUTED, true)
	dv.add_child(_d_current)
	_travel_btn = _button("Travel  [G]", 0, 52, 20)
	_travel_btn.add_theme_stylebox_override("normal", _box(C_TEAL_BG, C_TEAL, 2, 6, 8))
	_travel_btn.add_theme_stylebox_override("hover", _box(C_TEAL.darkened(0.45), C_TEAL.lightened(0.2), 2, 6, 8))
	_travel_btn.pressed.connect(request_travel)
	dv.add_child(_travel_btn)

	# Supplies page
	_sup_scroll = _scroll()
	_sup_scroll.size_flags_vertical = Control.SIZE_EXPAND_FILL
	root.add_child(_sup_scroll)
	_sup_box = VBoxContainer.new()
	_sup_box.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_sup_box.add_theme_constant_override("separation", 10)
	_sup_scroll.add_child(_sup_box)

	root.add_child(_rule())
	var foot := HBoxContainer.new()
	root.add_child(foot)
	var shortcuts := _label("M  Map     F  Next destination     G  Travel     Esc  Close", 14, C_MUTED, true)
	shortcuts.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	foot.add_child(shortcuts)
	var reset := _button("Reset World…", 160, 40, 16)
	reset.tooltip_text = "Restore the Orchard. Keeps character progress and saves a backup. Confirmation required."
	reset.pressed.connect(func(): reset_requested.emit())
	foot.add_child(reset)
	_update_detail()


# ---------------------------------------------------------------- map sync

func _sync_destinations() -> void:
	var dests: Array = _model.get("destinations", [])
	var ids: Array = []
	for d in dests:
		ids.append(str(d.get("id", "")))
	if ids != _dest_ids:
		_dest_ids = ids
		for id in _dest_rows:
			_dest_rows[id].btn.queue_free()
		_dest_rows.clear()
		for id in ids:
			_dest_rows[id] = _make_dest_row(id)
	_dest_empty.visible = ids.is_empty()
	if _selected != "" and not ids.has(_selected):
		_selected = ""
	for d in dests:
		var row: Dictionary = _dest_rows[str(d.get("id", ""))]
		row.name.text = str(d.get("name", d.get("id", "")))
		row.sub.text = _status_text(d)
		row.sub.add_theme_color_override("font_color", C_MUTED if bool(d.get("available", false)) else C_WARN)
	_restyle_rows()
	_update_detail()


func _make_dest_row(id: String) -> Dictionary:
	var btn := _button("", 0, 60)
	btn.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var v := VBoxContainer.new()
	v.mouse_filter = Control.MOUSE_FILTER_IGNORE
	v.set_anchors_preset(Control.PRESET_FULL_RECT)
	v.offset_left = 12
	v.offset_right = -12
	v.alignment = BoxContainer.ALIGNMENT_CENTER
	v.add_theme_constant_override("separation", 0)
	btn.add_child(v)
	var nm := _label("", 17, C_CREAM)
	var sub := _label("", 13, C_MUTED)
	for l in [nm, sub]:
		l.mouse_filter = Control.MOUSE_FILTER_IGNORE
		l.clip_text = true
		l.text_overrun_behavior = TextServer.OVERRUN_TRIM_ELLIPSIS
		v.add_child(l)
	btn.pressed.connect(_select.bind(id))
	_dest_list.add_child(btn)
	return {"btn": btn, "name": nm, "sub": sub}


func _select(id: String) -> void:
	_selected = id
	_restyle_rows()
	_update_detail()
	destination_selected.emit(id)


func _restyle_rows() -> void:
	var cur := str(_model.get("current", ""))
	for id in _dest_rows:
		var btn: Button = _dest_rows[id].btn
		if id == _selected:
			btn.add_theme_stylebox_override("normal", _box(C_TEAL_BG, C_TEAL, 2, 6, 8))
			btn.add_theme_stylebox_override("hover", _box(C_TEAL_BG.lightened(0.08), C_TEAL, 2, 6, 8))
		elif id == cur:
			btn.add_theme_stylebox_override("normal", _box(C_TIMBER, C_BRASS, 1, 6, 8))
			btn.add_theme_stylebox_override("hover", _box(C_TIMBER_HI, C_BRASS, 1, 6, 8))
		else:
			btn.add_theme_stylebox_override("normal", _box(C_TIMBER, C_BRASS_DIM, 1, 6, 8))
			btn.add_theme_stylebox_override("hover", _box(C_TIMBER_HI, C_BRASS, 1, 6, 8))


func _update_detail() -> void:
	var cur := str(_model.get("current", ""))
	var cur_name := cur
	var d := {}
	for x in _model.get("destinations", []):
		if str(x.get("id", "")) == _selected:
			d = x
		if str(x.get("id", "")) == cur:
			cur_name = str(x.get("name", cur))
	_d_current.text = "You are at: %s" % (cur_name if cur_name != "" else "unknown")
	if d.is_empty():
		_d_name.text = "No destination selected"
		_d_status.text = ""
		_d_desc.text = "Choose a destination from the list, or press F to cycle. Selecting does not travel."
		_d_res.text = ""
		_d_reason.text = ""
	else:
		_d_name.text = str(d.get("name", _selected))
		_d_status.text = _status_text(d)
		_d_status.add_theme_color_override("font_color", C_TEAL if bool(d.get("available", false)) else C_WARN)
		_d_desc.text = str(d.get("description", ""))
		var res := _join(d.get("resources", ""))
		_d_res.text = ("Resources found here: " + res) if res != "" else "No notable resources recorded."
		_d_reason.text = str(d.get("reason", "")) if not bool(d.get("available", false)) else ""
	_d_reason.visible = _d_reason.text != ""
	_d_status.visible = _d_status.text != ""
	var ok := _can_travel()
	_travel_btn.disabled = not ok
	if d.is_empty():
		_travel_btn.text = "Travel  [G]  -  select a destination"
	elif _selected == cur:
		_travel_btn.text = "You are here"
	elif not ok:
		_travel_btn.text = "Travel unavailable"
	else:
		_travel_btn.text = "Travel to %s  [G]" % str(d.get("name", _selected))


func _can_travel() -> bool:
	if _selected == "" or _selected == str(_model.get("current", "")):
		return false
	for x in _model.get("destinations", []):
		if str(x.get("id", "")) == _selected:
			return bool(x.get("available", false))
	return false


func _status_text(d: Dictionary) -> String:
	if str(d.get("id", "")) == str(_model.get("current", "")):
		return "Current location"
	if bool(d.get("available", false)):
		return "Available"
	var r := str(d.get("reason", ""))
	return ("Unavailable - " + r) if r != "" else "Unavailable"


# ---------------------------------------------------------------- supplies sync

func _sync_supplies() -> void:
	var wallets: Array = _model.get("wallets", [])
	var items: Array = _model.get("items", [])
	var costs: Array = _model.get("costs", [])
	var sig := "%d|%d|%d" % [wallets.size(), items.size(), costs.size()]
	for w in wallets:
		sig += "|%d" % (w.get("rows", []) as Array).size()
	if sig != _supplies_sig:
		_supplies_sig = sig
		for c in _sup_box.get_children():
			c.queue_free()
		_scaled = _scaled.filter(func(e): return is_instance_valid(e.n) and not _sup_box.is_ancestor_of(e.n))
		_build_supplies(wallets, items, costs)
	_fill_supplies(wallets, items, costs)


func _build_supplies(wallets: Array, items: Array, costs: Array) -> void:
	_sup_box.add_child(_label("Read-only ledger. Each wallet keeps its own balance; its note explains who may spend from it. Nothing is charged here.", 14, C_MUTED, true))
	_section("HOLDING & EQUIPMENT")
	_sup_box.add_child(_tag(_label("", 16, C_CREAM, true), "equip"))
	if items.is_empty():
		_sup_box.add_child(_label("No items available.", 15, C_MUTED, true))
	for i in items.size():
		_sup_box.add_child(_entry("item%d" % i))
	_section("WALLETS")
	if wallets.is_empty():
		_sup_box.add_child(_label("No wallets recorded.", 15, C_MUTED, true))
	for w in wallets.size():
		var card := PanelContainer.new()
		card.add_theme_stylebox_override("panel", _box(C_TIMBER, C_BRASS_DIM, 1, 6, 10))
		var v := VBoxContainer.new()
		v.add_theme_constant_override("separation", 4)
		card.add_child(v)
		v.add_child(_tag(_label("", 18, C_BRASS, true), "wt%d" % w))
		v.add_child(_tag(_label("", 14, C_MUTED, true), "wd%d" % w))
		var rows: Array = wallets[w].get("rows", [])
		if rows.is_empty():
			v.add_child(_label("Empty.", 15, C_MUTED))
		for r in rows.size():
			var h := HBoxContainer.new()
			h.add_theme_constant_override("separation", 12)
			var nm := _tag(_label("", 16, C_CREAM, true), "rn%d_%d" % [w, r])
			_reg(nm, 16, Vector2(170, 0))
			var am := _tag(_label("", 16, C_TEAL), "ra%d_%d" % [w, r])
			am.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
			_reg(am, 16, Vector2(90, 0))
			var pu := _tag(_label("", 14, C_MUTED, true), "rp%d_%d" % [w, r])
			pu.size_flags_horizontal = Control.SIZE_EXPAND_FILL
			for x in [nm, am, pu]:
				h.add_child(x)
			v.add_child(h)
		_sup_box.add_child(card)
	_section("RECIPES & ACTIONS")
	if costs.is_empty():
		_sup_box.add_child(_label("No recipes or actions listed.", 15, C_MUTED, true))
	for i in costs.size():
		_sup_box.add_child(_entry("cost%d" % i))


func _fill_supplies(wallets: Array, items: Array, costs: Array) -> void:
	var t := {}
	var eq := str(_model.get("equipment_line", ""))
	t["equip"] = eq if eq != "" else "Nothing held or equipped."
	for i in items.size():
		t["item%d_h" % i] = str(items[i].get("name", ""))
		t["item%d_s" % i] = str(items[i].get("state", ""))
		t["item%d_d" % i] = str(items[i].get("description", ""))
	for w in wallets.size():
		t["wt%d" % w] = str(wallets[w].get("title", ""))
		t["wd%d" % w] = str(wallets[w].get("description", ""))
		var rows: Array = wallets[w].get("rows", [])
		for r in rows.size():
			t["rn%d_%d" % [w, r]] = str(rows[r].get("name", ""))
			t["ra%d_%d" % [w, r]] = str(rows[r].get("amount", ""))
			t["rp%d_%d" % [w, r]] = str(rows[r].get("purpose", ""))
	for i in costs.size():
		var c: Dictionary = costs[i]
		t["cost%d_h" % i] = "%s  -  %s" % [str(c.get("name", "")), str(c.get("cost", ""))]
		t["cost%d_s" % i] = str(c.get("state", ""))
		t["cost%d_d" % i] = str(c.get("description", ""))
	_fill_tags(_sup_box, t)


func _fill_tags(node: Node, t: Dictionary) -> void:
	for c in node.get_children():
		if c.is_queued_for_deletion():
			continue
		if c is Label and c.has_meta("k") and t.has(c.get_meta("k")):
			c.text = t[c.get_meta("k")]
			c.visible = c.text != ""
		_fill_tags(c, t)


func _entry(key: String) -> Control:
	var v := VBoxContainer.new()
	v.add_theme_constant_override("separation", 2)
	var h := HBoxContainer.new()
	var nm := _tag(_label("", 16, C_CREAM, true), key + "_h")
	nm.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	var st := _tag(_label("", 14, C_TEAL), key + "_s")
	h.add_child(nm)
	h.add_child(st)
	v.add_child(h)
	v.add_child(_tag(_label("", 14, C_MUTED, true), key + "_d"))
	v.add_child(_rule(C_TIMBER_HI))
	return v


func _section(text: String) -> void:
	var l := _label(text, 14, C_BRASS)
	_sup_box.add_child(l)
	_sup_box.add_child(_rule())


# ---------------------------------------------------------------- scaling & factories

func _layout() -> void:
	if _panel == null:
		return
	_s = clampf(minf(size.x / 960.0, size.y / 620.0), 1.0, 2.6)
	var w := minf(size.x - 32.0, 1120.0 * _s)
	var h := minf(size.y - 32.0, 760.0 * _s)
	_panel.position = ((size - Vector2(w, h)) * 0.5).round()
	_panel.size = Vector2(w, h)
	_scaled = _scaled.filter(func(e): return is_instance_valid(e.n))
	for e in _scaled:
		if e.font > 0:
			e.n.add_theme_font_size_override("font_size", int(round(e.font * _s)))
		if e.min != Vector2.ZERO:
			e.n.custom_minimum_size = e.min * _s
	# Container minimums settle after fonts and wrapped text are updated. Refit
	# once afterward, so an early oversized minimum cannot strand a small window.
	_fit_panel.call_deferred()

func _fit_panel() -> void:
	if _panel == null: return
	var extent := Vector2(minf(size.x-32.0,1120.0*_s),minf(size.y-32.0,760.0*_s))
	_panel.size=extent
	_panel.position=((size-extent)*0.5).round()


func _reg(n: Control, font: int, min_size := Vector2.ZERO) -> void:
	for e in _scaled:
		if e.n == n:
			e.font = font
			e.min = min_size
			_apply(e)
			return
	var e := {"n": n, "font": font, "min": min_size}
	_scaled.append(e)
	_apply(e)


func _apply(e: Dictionary) -> void:
	if e.font > 0:
		e.n.add_theme_font_size_override("font_size", int(round(e.font * _s)))
	if e.min != Vector2.ZERO:
		e.n.custom_minimum_size = e.min * _s


func _label(text: String, font: int, color: Color, wrap := false) -> Label:
	var l := Label.new()
	l.text = text
	l.add_theme_color_override("font_color", color)
	if wrap:
		l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		l.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_reg(l, font)
	return l


func _button(text: String, min_w: int, min_h := 40, font := 16) -> Button:
	var b := Button.new()
	b.text = text
	b.focus_mode = Control.FOCUS_ALL
	b.add_theme_color_override("font_color", C_CREAM)
	b.add_theme_color_override("font_hover_color", C_CREAM)
	b.add_theme_color_override("font_pressed_color", C_CREAM)
	b.add_theme_color_override("font_disabled_color", C_MUTED.darkened(0.3))
	b.add_theme_stylebox_override("normal", _box(C_TIMBER, C_BRASS_DIM, 1, 6, 8))
	b.add_theme_stylebox_override("hover", _box(C_TIMBER_HI, C_BRASS, 1, 6, 8))
	b.add_theme_stylebox_override("pressed", _box(C_TEAL_BG, C_TEAL, 2, 6, 8))
	b.add_theme_stylebox_override("disabled", _box(C_PANEL, C_TIMBER_HI, 1, 6, 8))
	var f := _box(Color(0, 0, 0, 0), C_TEAL.lightened(0.25), 2, 6, 8)
	f.draw_center = false
	b.add_theme_stylebox_override("focus", f)
	_reg(b, font, Vector2(min_w, maxi(min_h, 36)))
	return b


func _scroll() -> ScrollContainer:
	var s := ScrollContainer.new()
	s.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	s.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	s.size_flags_vertical = Control.SIZE_EXPAND_FILL
	return s


func _rule(color := C_BRASS_DIM) -> ColorRect:
	var r := ColorRect.new()
	r.color = color
	r.custom_minimum_size = Vector2(0, 1)
	return r


func _box(bg: Color, border: Color, bw: int, radius: int, pad: int) -> StyleBoxFlat:
	var b := StyleBoxFlat.new()
	b.bg_color = bg
	b.border_color = border
	b.set_border_width_all(bw)
	b.set_corner_radius_all(radius)
	b.set_content_margin_all(pad)
	return b


func _tag(l: Label, key: String) -> Label:
	l.set_meta("k", key)
	return l


func _join(v) -> String:
	if v is Array:
		return ", ".join(PackedStringArray(v.map(func(x): return str(x))))
	return str(v)
