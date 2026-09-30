extends RefCounted
## Native vector UI symbols for the RTS command panel. No fonts, no textures.
## Usage: UISymbols.draw(canvas_item, "clock", rect, color, line_width)
## Every symbol fits its rect (drawn on the shorter side, centred).

static func gesture_kind(text: String) -> String:
	var t := text.to_lower()
	if t.contains("drag") or t.contains("line") or t.contains("path") or t.contains("stroke") or t.contains("trace"):
		return "line"
	if t.contains("ring") or t.contains("circle") or t.contains("area") or t.contains("radius"):
		return "ring"
	if t.contains("click") or t.contains("tap") or t.contains("point") or t.contains("place") or t.contains("spot"):
		return "point"
	return "crosshair"


static func draw(ci: CanvasItem, kind: String, rect: Rect2, col: Color, lw: float = 1.5) -> void:
	var u := minf(rect.size.x, rect.size.y)
	var c := rect.get_center()
	var h := u * 0.5
	match kind:
		"land":     # mountain range
			ci.draw_colored_polygon(PackedVector2Array([c + Vector2(-h, h * 0.62), c + Vector2(-h * 0.35, -h * 0.55), c + Vector2(h * 0.02, h * 0.05), c + Vector2(h * 0.35, -h * 0.85), c + Vector2(h, h * 0.62)]), col)
		"life":     # leaf with midrib
			ci.draw_colored_polygon(_hull_leaf(c, h), col)
			ci.draw_line(c + Vector2(-h * 0.85, h * 0.8), c + Vector2(h * 0.45, -h * 0.45), col.darkened(0.55), maxf(lw * 0.8, 1.0), true)
		"construction":   # tower / gatehouse
			ci.draw_rect(Rect2(c + Vector2(-h * 0.7, -h * 0.15), Vector2(h * 1.4, h * 1.0)), col)
			for i in 3:
				ci.draw_rect(Rect2(c + Vector2(-h * 0.7 + i * h * 0.56, -h * 0.65), Vector2(h * 0.28, h * 0.5)), col)
			ci.draw_rect(Rect2(c + Vector2(-h * 0.2, h * 0.2), Vector2(h * 0.4, h * 0.65)), Color(0, 0, 0, 0.55))
		"encounters":   # crossed blades
			ci.draw_line(c + Vector2(-h * 0.8, -h * 0.8), c + Vector2(h * 0.8, h * 0.8), col, lw * 1.4, true)
			ci.draw_line(c + Vector2(h * 0.8, -h * 0.8), c + Vector2(-h * 0.8, h * 0.8), col, lw * 1.4, true)
			ci.draw_line(c + Vector2(-h * 0.55, h * 0.25), c + Vector2(-h * 0.25, h * 0.55), col, lw * 1.2, true)
			ci.draw_line(c + Vector2(h * 0.55, h * 0.25), c + Vector2(h * 0.25, h * 0.55), col, lw * 1.2, true)
		"mana":     # droplet
			ci.draw_colored_polygon(_hull_drop(c, h), col)
		"clock":
			ci.draw_arc(c, h * 0.82, 0, TAU, 28, col, lw, true)
			ci.draw_line(c, c + Vector2(0, -h * 0.55), col, lw, true)
			ci.draw_line(c, c + Vector2(h * 0.42, h * 0.18), col, lw, true)
		"crosshair":
			ci.draw_arc(c, h * 0.58, 0, TAU, 24, col, lw, true)
			ci.draw_line(c + Vector2(0, -h * 0.95), c + Vector2(0, -h * 0.3), col, lw, true)
			ci.draw_line(c + Vector2(0, h * 0.95), c + Vector2(0, h * 0.3), col, lw, true)
			ci.draw_line(c + Vector2(-h * 0.95, 0), c + Vector2(-h * 0.3, 0), col, lw, true)
			ci.draw_line(c + Vector2(h * 0.95, 0), c + Vector2(h * 0.3, 0), col, lw, true)
		"line":     # drag line: two end nodes joined
			ci.draw_line(c + Vector2(-h * 0.7, h * 0.5), c + Vector2(h * 0.7, -h * 0.5), col, lw, true)
			ci.draw_circle(c + Vector2(-h * 0.7, h * 0.5), h * 0.24, col)
			ci.draw_circle(c + Vector2(h * 0.7, -h * 0.5), h * 0.24, col)
		"ring":
			ci.draw_arc(c, h * 0.78, 0, TAU, 28, col, lw, true)
			ci.draw_circle(c, h * 0.16, col)
		"point":
			ci.draw_circle(c, h * 0.3, col)
			ci.draw_arc(c, h * 0.72, 0, TAU, 24, Color(col, col.a * 0.55), lw, true)
		"log":      # timber: side + cut end
			ci.draw_rect(Rect2(c + Vector2(-h * 0.9, -h * 0.4), Vector2(h * 1.4, h * 0.8)), col.darkened(0.25))
			ci.draw_circle(c + Vector2(h * 0.5, 0), h * 0.46, col)
			ci.draw_arc(c + Vector2(h * 0.5, 0), h * 0.24, 0, TAU, 14, col.darkened(0.5), maxf(lw * 0.7, 1.0), true)
			ci.draw_line(c + Vector2(-h * 0.6, -h * 0.1), c + Vector2(h * 0.1, -h * 0.1), col.darkened(0.5), maxf(lw * 0.6, 1.0))
		"worker":   # head + shoulders
			ci.draw_circle(c + Vector2(0, -h * 0.42), h * 0.34, col)
			ci.draw_colored_polygon(_hull_shoulders(c, h), col)
		_:
			ci.draw_circle(c, h * 0.4, col)


static func _hull_leaf(c: Vector2, h: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i in 13:   # upper edge, base bottom-left to tip top-right
		var s := i / 12.0
		pts.append(c + Vector2(-h * 0.85, h * 0.8).lerp(Vector2(h * 0.85, -h * 0.85), s) + Vector2(sin(s * PI) * h * 0.45, sin(s * PI) * h * 0.45))
	for i in 13:
		var s := 1.0 - i / 12.0
		pts.append(c + Vector2(-h * 0.85, h * 0.8).lerp(Vector2(h * 0.85, -h * 0.85), s) - Vector2(sin(s * PI) * h * 0.45, sin(s * PI) * h * 0.45))
	return pts


static func _hull_drop(c: Vector2, h: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	pts.append(c + Vector2(0, -h * 0.98))
	for i in 15:
		var a := -0.62 + (PI + 1.24) * i / 14.0     # sweep the belly from right shoulder round to left
		pts.append(c + Vector2(0, h * 0.28) + Vector2(cos(a), sin(a)) * h * 0.64)
	return pts


static func _hull_shoulders(c: Vector2, h: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	for i in 11:
		var a := PI + PI * i / 10.0
		pts.append(c + Vector2(h * 0.02, h * 0.92) + Vector2(cos(a) * h * 0.78, sin(a) * h * 0.72))
	return pts
