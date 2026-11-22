# Secondary idle motion for brann.glb (blink / breath / settle).
# Attach to the instanced Brann scene root. Gaze, speech, hammer strike and the
# presence indicator stay game-driven; this only adds subtle life on top.
extends Node3D

@export var blink_interval := Vector2(2.5, 6.0)
@export var breath_rate := 0.22          # Hz
@export var breath_amount := 0.012       # Body Y-scale delta
@export var settle_amount := 0.025       # radians of head sway

@onready var body: Node3D = find_child("Body", true, false)
@onready var head: Node3D = find_child("HeadPivot", true, false)
@onready var lid_l: Node3D = find_child("LidL", true, false)
@onready var lid_r: Node3D = find_child("LidR", true, false)

var _t := 0.0
var _next_blink := 3.0
var _blink := -1.0
var _head_base := Basis.IDENTITY

func _ready() -> void:
	if head: _head_base = head.basis

func _process(dt: float) -> void:
	_t += dt
	# Breath: scale the rigid Body mesh about the floor origin.
	if body:
		var b := sin(_t * TAU * breath_rate) * breath_amount
		body.scale = Vector3(1.0 + b * 0.6, 1.0 + b * 0.25, 1.0 + b)
	# Settle: slow, low-amplitude head drift. Game gaze can overwrite HeadPivot,
	# so skip this if your gaze code owns HeadPivot rotation.
	if head:
		var e := Vector3(sin(_t * 0.37) * settle_amount * 0.5, sin(_t * 0.23) * settle_amount, sin(_t * 0.31) * settle_amount * 0.4)
		head.basis = _head_base * Basis.from_euler(e)
	# Blink: rotating the upper lid caps about +X sweeps them down over the eyes.
	_next_blink -= dt
	if _next_blink <= 0.0 and _blink < 0.0:
		_blink = 0.0
		_next_blink = randf_range(blink_interval.x, blink_interval.y)
	if _blink >= 0.0:
		_blink += dt / 0.16
		var k := sin(clampf(_blink, 0.0, 1.0) * PI)   # 0 -> 1 -> 0
		var ang := k * 1.35                           # ~77 deg closes the lid
		for lid in [lid_l, lid_r]:
			if lid: lid.rotation = Vector3(ang, 0, 0)
		if _blink >= 1.0: _blink = -1.0
