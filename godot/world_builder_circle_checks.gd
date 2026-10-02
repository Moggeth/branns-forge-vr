extends SceneTree
## Save-free CPU geometry benchmark; no Main, services, windows or GPU claims.
const Fields = preload("res://orchard_planet_fields.gd")

class Planet extends RefCounted:
	var fields = Fields.new()
	var center := Vector3(6000, 13, -27)

class Field extends RefCounted:
	func height_at(p: Vector2) -> float: return sin(p.x * 0.04) + cos(p.y * 0.03)

class Game extends Node3D:
	var orchard_planet := Planet.new()
	var landscape := Field.new()

class Builder extends Node:
	const ZONE = "orchard_highlands"
	var center := Vector3(170, 3, -90)

class Probe extends "res://world_builder_view.gd":
	var spherical := false
	var samples := 0
	var vertices := PackedVector3Array()
	func _planet_active() -> bool: return spherical
	func _ground_preview(point: Vector3) -> Vector3:
		samples += 1
		return super._ground_preview(point)
	func _boundary_line(_mesh: ImmediateMesh, a: Vector3, b: Vector3) -> void:
		vertices.append(a)
		vertices.append(b)
	func legacy(point: Vector3, radius: float, segments: int) -> void:
		if spherical:
			var direction := point.normalized()
			var east := direction.cross(Vector3.UP).normalized()
			if east.length_squared() < 0.0001: east = direction.cross(Vector3.RIGHT).normalized()
			var north := east.cross(direction).normalized()
			var angle: float = radius / game.orchard_planet.fields.radius
			for i in segments:
				var theta_a := TAU * float(i) / float(segments)
				var theta_b := TAU * float(i + 1) / float(segments)
				var a: Vector3 = (direction * cos(angle) + (east * cos(theta_a) + north * sin(theta_a)) * sin(angle)).normalized()
				var b: Vector3 = (direction * cos(angle) + (east * cos(theta_b) + north * sin(theta_b)) * sin(angle)).normalized()
				_boundary_line(null, _ground_preview(a), _ground_preview(b))
			return
		for i in segments:
			var a := point + Vector3(cos(TAU * i / segments), 0, sin(TAU * i / segments)) * radius
			var b := point + Vector3(cos(TAU * (i + 1) / segments), 0, sin(TAU * (i + 1) / segments)) * radius
			_boundary_line(null, _ground_preview(a), _ground_preview(b))

func _initialize() -> void: call_deferred("_run")

func _run() -> void:
	var failures: Array[String] = []
	var game := Game.new()
	var builder := Builder.new()
	var probe := Probe.new()
	probe.game = game
	probe.builder = builder
	game.orchard_planet.fields.setup(41)
	var reports := []
	for spherical in [false, true]:
		probe.spherical = spherical
		for point in [Vector3(12, 5, -9), Vector3.UP, Vector3.DOWN]:
			for segments in [0, 1, 16, 20, 48]:
				probe.vertices.clear()
				probe.legacy(point, 8.0, segments)
				var expected := probe.vertices.duplicate()
				probe.vertices.clear()
				probe.samples = 0
				probe._preview_circle(null, point, 8.0, segments)
				if probe.vertices != expected: failures.append("vertex mismatch: %s %s %s" % [spherical, point, segments])
				if probe.samples != (segments + 1 if segments > 0 else 0): failures.append("projection budget: %s %s" % [spherical, segments])
		var timings := []
		for legacy in [true, false]:
			var started := Time.get_ticks_usec()
			for i in 100:
				probe.vertices.clear()
				if legacy: probe.legacy(Vector3(12, 5, -9), 8.0, 48)
				else: probe._preview_circle(null, Vector3(12, 5, -9), 8.0, 48)
			timings.append((Time.get_ticks_usec() - started) / 100.0)
		reports.append({"spherical": spherical, "legacy_usec": timings[0], "current_usec": timings[1]})
	# Fresh projections must observe terrain edits, with no persistent stale cache.
	probe.vertices.clear()
	probe._preview_circle(null, Vector3.UP, 8.0, 48)
	var before := probe.vertices.duplicate()
	game.orchard_planet.fields.setup(93)
	probe.vertices.clear()
	probe._preview_circle(null, Vector3.UP, 8.0, 48)
	if probe.vertices == before: failures.append("terrain change did not invalidate geometry")
	print("CIRCLE_RESULT ", JSON.stringify({"failures": failures, "timings": reports}))
	probe.game = null
	probe.free()
	builder.free()
	game.free()
	quit(0 if failures.is_empty() else 1)
