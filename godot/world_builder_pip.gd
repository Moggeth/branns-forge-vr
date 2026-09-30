extends Control
## Interactive frame around the already-rendered Hero Window texture.
## This never creates another Camera3D, SubViewport, or World3D renderer.

signal return_requested
signal swap_requested
signal layout_changed

const HEADER := 32.0
const HANDLE := 22.0
const MINIMUM := Vector2(320, 202)

var picture: TextureRect
var return_button: Button
var swap_button: Button
var caption := "HERO · LIVE VIEW"
var dragging := false
var resizing := false
var drag_at := Vector2.ZERO
var initial_rect := Rect2()

func setup(hero_texture: Texture2D) -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	clip_contents = true
	picture = TextureRect.new()
	picture.texture = hero_texture
	picture.position = Vector2(3, HEADER)
	picture.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	picture.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	picture.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(picture)
	return_button = Button.new()
	return_button.text = "Focus Hero"
	return_button.tooltip_text = "Return input focus to the existing Hero window."
	return_button.pressed.connect(func() -> void: return_requested.emit())
	add_child(return_button)
	swap_button = Button.new()
	swap_button.text = "Swap views"
	swap_button.tooltip_text = "Swap which live camera fills this window; both remain visible."
	swap_button.pressed.connect(func() -> void: swap_requested.emit())
	add_child(swap_button)
	resized.connect(_place_children)
	_place_children()
	queue_redraw()

func keep_inside(bounds: Vector2) -> void:
	size = Vector2(minf(size.x, bounds.x - 16.0), minf(size.y, bounds.y - 16.0)).max(MINIMUM)
	position = position.clamp(Vector2(8, 8), (bounds - size - Vector2(8, 8)).max(Vector2(8, 8)))

func _place_children() -> void:
	if picture == null: return
	picture.size = Vector2(size.x - 6, size.y - HEADER - 3)
	return_button.position = Vector2(size.x - 105, 3)
	return_button.size = Vector2(100, HEADER - 6)
	swap_button.position = Vector2(size.x - 206, 3)
	swap_button.size = Vector2(96, HEADER - 6)
	queue_redraw()

func _draw() -> void:
	draw_rect(Rect2(Vector2.ZERO, size), Color(0.015, 0.023, 0.03, 0.98))
	draw_rect(Rect2(Vector2.ZERO, Vector2(size.x, HEADER)), Color(0.08, 0.14, 0.16, 0.98))
	draw_rect(Rect2(Vector2.ZERO, size), Color("b8d4bc"), false, 2.0)
	var font := ThemeDB.fallback_font
	draw_string(font, Vector2(11, 21), caption, HORIZONTAL_ALIGNMENT_LEFT, size.x - 214, 14, Color("e9e1bd"))
	draw_colored_polygon(PackedVector2Array([Vector2(size.x - 18, size.y - 4), Vector2(size.x - 4, size.y - 18), Vector2(size.x - 4, size.y - 4)]), Color("b8d4bc"))

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton:
		var button := event as InputEventMouseButton
		if button.button_index == MOUSE_BUTTON_LEFT:
			if button.pressed:
				dragging = button.position.y <= HEADER and button.position.x < size.x - 150
				resizing = button.position.x >= size.x - HANDLE and button.position.y >= size.y - HANDLE
				drag_at = get_global_mouse_position()
				initial_rect = Rect2(position, size)
			else:
				if dragging or resizing: layout_changed.emit()
				dragging = false
				resizing = false
			accept_event()
		elif button.pressed:
			accept_event()
	elif event is InputEventMouseMotion:
		if dragging:
			position = initial_rect.position + get_global_mouse_position() - drag_at
			keep_inside(get_parent_control().size)
			accept_event()
		elif resizing:
			size = (initial_rect.size + get_global_mouse_position() - drag_at).max(MINIMUM)
			keep_inside(get_parent_control().size)
			accept_event()

func contains_screen_point(point: Vector2) -> bool:
	return Rect2(global_position, size).has_point(point)

func content_rect_screen() -> Rect2:
	var source := picture.texture.get_size() if picture.texture != null else picture.size
	var fit := minf(picture.size.x / maxf(source.x, 1.0), picture.size.y / maxf(source.y, 1.0))
	var drawn := source * fit
	return Rect2(global_position + picture.position + (picture.size - drawn) * 0.5, drawn)
