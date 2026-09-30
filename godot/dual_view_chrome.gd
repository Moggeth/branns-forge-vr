extends Control
## Opus's pine/brass view chrome; commands never go to either player's weapons.
signal command(action: String)
signal ratio_dragged(ratio: float)
const C_GOLD := Color("c9a24a")
const C_TEAL := Color("3fb6a8")
var mode := "pip"
var hero_focus := false
var captured := false
var ratio := 0.5
var ui_scale := 1.0
var panes := {}
var hit_boxes: Array[Dictionary] = []
var divider_hit := Rect2()
var divider := Rect2()
var divider_drag := false
var clock := 0.0

func setup() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	focus_mode = Control.FOCUS_NONE
	tooltip_text = "Tab switches Hero / RTS controls. Escape frees the mouse. Shift+F9 changes layout."

func update_layout(view_mode: String, focus: bool, locked: bool, left_ratio: float, layout: Dictionary, scale_value: float) -> void:
	mode = view_mode; hero_focus = focus; captured = locked; ratio = left_ratio
	panes = layout; ui_scale = scale_value
	divider = layout.get("divider", Rect2())
	divider_hit = layout.get("divider_hit", Rect2())
	queue_redraw()

func _has_point(point: Vector2) -> bool:
	return point.y < 34.0 * ui_scale or (mode == "split" and divider_hit.has_point(point))

func _draw() -> void:
	var font := ThemeDB.fallback_font
	var h := 34.0 * ui_scale
	var fs := maxi(12, roundi(13.0 * ui_scale))
	draw_rect(Rect2(0, 0, size.x, h), Color(0.045, 0.08, 0.07, 0.96))
	draw_line(Vector2(0,h), Vector2(size.x,h), Color(C_GOLD,0.65), 1)
	hit_boxes.clear()
	var x := 8.0 * ui_scale
	for item in [["focus", "HERO · Tab" if hero_focus else "RTS · Tab"], ["pip","Inset"], ["split","Split"], ["flip","Flip"]]:
		x = _draw_button(str(item[0]),str(item[1]),x,h,font,fs)
	if mode == "split":
		for percent in [40,50,60]: x = _draw_button("ratio:"+str(percent), str(percent)+"%",x,h,font,fs)
	x = _draw_button("fullscreen","F11 Fullscreen",x,h,font,fs)
	if size.x - x > 160.0 * ui_scale:
		draw_string(font,Vector2(x+14*ui_scale,h*0.66),"Esc · free mouse",HORIZONTAL_ALIGNMENT_LEFT,-1,fs,Color("b0c9be"))
	if mode == "split":
		draw_rect(divider,Color("23483c"))
		draw_line(Vector2(divider.get_center().x,divider.position.y),Vector2(divider.get_center().x,divider.end.y),C_GOLD,1.0)
		for i in 3: draw_circle(divider.get_center()+Vector2(0,(i-1)*7*ui_scale),1.5*ui_scale,C_GOLD)
	for id in ["fps","rts"]:
		var rect: Rect2 = panes.get(id,Rect2())
		if rect.size.x <= 0: continue
		var focused: bool = hero_focus if id == "fps" else not hero_focus
		var color := C_TEAL if focused and captured else C_GOLD if focused else Color("23483c")
		draw_rect(rect.grow(-1),color,false,2.0 if focused else 1.0)

func _draw_button(id: String, label: String, x: float, h: float, font: Font, fs: int) -> float:
	var w := font.get_string_size(label,HORIZONTAL_ALIGNMENT_LEFT,-1,fs).x + 18.0 * ui_scale
	var box := Rect2(x,4.0*ui_scale,w,h-8.0*ui_scale)
	var active := id == mode or (id.begins_with("ratio:") and is_equal_approx(ratio,float(id.trim_prefix("ratio:"))/100.0))
	draw_rect(box,Color(C_TEAL,0.22) if active else Color(0.08,0.13,0.11))
	draw_rect(box,Color(C_GOLD,0.6),false,1.0)
	draw_string(font,box.position+Vector2(9.0*ui_scale,box.size.y*0.72),label,HORIZONTAL_ALIGNMENT_LEFT,-1,fs,Color("e9ddbf"))
	hit_boxes.append({"id":id,"rect":box})
	return box.end.x + 5.0 * ui_scale

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.button_index == MOUSE_BUTTON_LEFT:
		if event.pressed:
			if mode == "split" and divider_hit.has_point(event.position):
				if event.double_click: command.emit("ratio:50")
				else: divider_drag = true
			else:
				for box in hit_boxes:
					if box.rect.has_point(event.position): command.emit(box.id); break
		else:
			divider_drag = false
		accept_event()
	elif event is InputEventMouseMotion:
		mouse_default_cursor_shape = Control.CURSOR_HSIZE if divider_hit.has_point(event.position) else Control.CURSOR_ARROW
		if divider_drag:
			ratio_dragged.emit(event.position.x/maxf(1.0,size.x-divider.size.x))
			accept_event()
